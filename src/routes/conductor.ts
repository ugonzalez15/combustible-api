import Elysia from 'elysia'
import { randomUUID } from 'crypto'
import { requireApiKey } from '../middleware/auth'
import { query, execute } from '../db'
import * as rendimiento from '../services/rendimiento.service'
import * as tanque from '../services/tanque.service'
import * as alertaSvc from '../services/alerta.service'

export const conductorRoutes = new Elysia({ prefix: '/conductor' })
  .use(requireApiKey('admin'))

  .post('/iniciar-dia', async ({ body, set }) => {
    const { conductor_id, unidad_id } = body as { conductor_id: string; unidad_id: number }

    const unidad = await rendimiento.getUnidad(unidad_id)
    if (!unidad || !unidad.activa) {
      set.status = 400
      return { ok: false, message: 'Unidad no existe o está inactiva' }
    }

    const existing = await query<{ id: string }>(
      'SELECT id FROM FUEL_ASIGNACIONES_DIA WHERE conductor_id = ? AND fecha = CURDATE()',
      [conductor_id],
    )
    if (existing.length > 0) {
      set.status = 409
      return { ok: false, message: 'El conductor ya tiene unidad asignada hoy' }
    }

    const asignacion_id = randomUUID()
    await execute(
      'INSERT INTO FUEL_ASIGNACIONES_DIA (id, conductor_id, unidad_id, fecha) VALUES (?, ?, ?, CURDATE())',
      [asignacion_id, conductor_id, unidad_id],
    )

    return { ok: true, asignacion_id, unidad: `${unidad.numero_identificador_activo ?? ''} ${unidad.placa ?? ''}`.trim() }
  })

  .post('/registrar-carga', async ({ body, set }) => {
    const {
      conductor_id, unidad_id, litros_cargados, km_odometro,
      foto_odometro_url, foto_surtidor_url,
    } = body as {
      conductor_id: string; unidad_id: number; litros_cargados: number
      km_odometro: number; foto_odometro_url: string; foto_surtidor_url: string
    }

    if (!foto_odometro_url || !foto_surtidor_url) {
      set.status = 400
      return { ok: false, message: 'Se requieren ambas fotos' }
    }

    const result = await rendimiento.calcularRendimiento(unidad_id, km_odometro, litros_cargados)

    if (result && result.km_recorridos < 0) {
      set.status = 400
      return { ok: false, message: 'km_odometro es menor al registro anterior' }
    }

    const cap    = await rendimiento.verificarCapacidad(unidad_id, litros_cargados)
    const salida = await rendimiento.tieneSalidaHoy(unidad_id)

    const registro_id = randomUUID()
    await execute(
      `INSERT INTO FUEL_REGISTROS_CARGA
         (id, conductor_id, unidad_id, litros_cargados, km_odometro, km_recorridos,
          rendimiento_real_kml, foto_odometro_url, foto_surtidor_url, alerta_generada)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [registro_id, conductor_id, unidad_id, litros_cargados, km_odometro,
       result?.km_recorridos ?? null, result?.rendimiento_real_kml ?? null,
       foto_odometro_url, foto_surtidor_url],
    )

    const conductor = await query<{ sucursal_id: string }>(
      'SELECT sucursal_id FROM FUEL_USUARIOS WHERE id = ?', [conductor_id],
    )
    const sucursal_id = conductor[0]?.sucursal_id ?? ''

    await tanque.registrarMovimiento({
      sucursal_id, tipo_movimiento: 'despacho',
      litros: -litros_cargados, referencia_id: registro_id, registrado_por: conductor_id,
    })

    const alertas: string[] = []
    let alerta_generada = false

    if (result?.alerta) {
      alerta_generada = true; alertas.push('rendimiento_anomalo')
      await alertaSvc.generarAlerta({ tipo_alerta: 'rendimiento_anomalo',
        descripcion: `Rendimiento ${result.rendimiento_real_kml} km/L vs ${result.rendimiento_esperado_kml} esperado (${result.porcentaje_vs_esperado}%)`,
        referencia_id: registro_id, sucursal_id })
    }
    if (cap.excede) {
      alerta_generada = true; alertas.push('carga_excesiva')
      await alertaSvc.generarAlerta({ tipo_alerta: 'carga_excesiva',
        descripcion: `Cargó ${litros_cargados} L superando la capacidad de ${cap.capacidad_litros} L`,
        referencia_id: registro_id, sucursal_id })
    }
    if (!salida) {
      alerta_generada = true; alertas.push('carga_sin_salida')
      await alertaSvc.generarAlerta({ tipo_alerta: 'carga_sin_salida',
        descripcion: 'Carga registrada sin movimiento de salida ese día',
        referencia_id: registro_id, sucursal_id })
    }

    if (alerta_generada) {
      await execute('UPDATE FUEL_REGISTROS_CARGA SET alerta_generada = 1 WHERE id = ?', [registro_id])
    }

    if (await tanque.estaBajoUmbral(sucursal_id)) {
      await alertaSvc.generarAlerta({ tipo_alerta: 'tanque_bajo',
        descripcion: `Tanque en ${sucursal_id} por debajo del umbral`, sucursal_id })
    }

    return {
      ok:                   true,
      registro_id,
      km_recorridos:        result?.km_recorridos        ?? null,
      rendimiento_real_kml: result?.rendimiento_real_kml ?? null,
      alertas_generadas:    alertas,
    }
  })

  .post('/movimiento-sucursal', async ({ body }) => {
    const { conductor_id, unidad_id, tipo, sucursal_id } = body as {
      conductor_id: string; unidad_id: number; tipo: 'entrada' | 'salida'; sucursal_id: string
    }
    const movimiento_id = randomUUID()
    await execute(
      'INSERT INTO FUEL_MOVIMIENTOS_SUCURSAL (id, unidad_id, tipo, registrado_por, sucursal_id) VALUES (?, ?, ?, ?, ?)',
      [movimiento_id, unidad_id, tipo, conductor_id, sucursal_id],
    )
    const rows = await query<{ timestamp: string }>(
      'SELECT timestamp FROM FUEL_MOVIMIENTOS_SUCURSAL WHERE id = ?', [movimiento_id],
    )
    return { ok: true, movimiento_id, tipo, timestamp: rows[0]?.timestamp }
  })

  .get('/:id/resumen-dia', async ({ params }) => {
    const rows = await query<Record<string, unknown>>(
      `SELECT u.nombre AS conductor,
               tv.numero_identificador_activo AS numero_unidad, tv.placa,
               COUNT(rc.id)                    AS cargas_hoy,
               COALESCE(SUM(rc.litros_cargados), 0) AS litros_total,
               COALESCE(SUM(rc.km_recorridos), 0)   AS km_recorridos,
               (SELECT COUNT(*) FROM FUEL_ALERTAS al
                JOIN FUEL_REGISTROS_CARGA rc2 ON rc2.id = al.referencia_id
                WHERE rc2.conductor_id = u.id AND DATE(al.timestamp) = CURDATE()) AS alertas_hoy
         FROM FUEL_USUARIOS u
         LEFT JOIN FUEL_ASIGNACIONES_DIA ad ON ad.conductor_id = u.id AND ad.fecha = CURDATE()
         LEFT JOIN FUEL_UNIDADES fu ON fu.id = ad.unidad_id
         LEFT JOIN tblvehiculosActivos tv ON tv.id = fu.vehiculo_activo_id
         LEFT JOIN FUEL_REGISTROS_CARGA rc ON rc.conductor_id = u.id AND DATE(rc.timestamp) = CURDATE()
         WHERE u.id = ?
         GROUP BY u.id, u.nombre, tv.numero_identificador_activo, tv.placa`,
      [params.id],
    )
    return rows[0] ?? { ok: false, message: 'Conductor no encontrado' }
  })

  .get('/:id/ultima-carga', async ({ params, set }) => {
    const rows = await query<Record<string, unknown>>(
      `SELECT DATE(rc.timestamp) AS fecha, rc.litros_cargados AS litros,
               rc.km_odometro, rc.rendimiento_real_kml,
               CONCAT(tv.numero_identificador_activo, ' — ', tv.placa) AS unidad
         FROM FUEL_REGISTROS_CARGA rc
         JOIN FUEL_UNIDADES fu ON fu.id = rc.unidad_id
         JOIN tblvehiculosActivos tv ON tv.id = fu.vehiculo_activo_id
         WHERE rc.conductor_id = ? ORDER BY rc.timestamp DESC LIMIT 1`,
      [params.id],
    )
    if (rows.length === 0) { set.status = 404; return { ok: false, message: 'Sin cargas registradas' } }
    return { ok: true, ...rows[0] }
  })

  .get('/:id/rendimiento', async ({ params, set }) => {
    const rows = await query<{ rendimiento_prom: number | null; mejor_kml: number | null; peor_kml: number | null; num_cargas: number }>(
      `SELECT ROUND(AVG(rendimiento_real_kml), 2) AS rendimiento_prom,
               ROUND(MAX(rendimiento_real_kml), 2) AS mejor_kml,
               ROUND(MIN(rendimiento_real_kml), 2) AS peor_kml,
               COUNT(*) AS num_cargas
         FROM FUEL_REGISTROS_CARGA
         WHERE conductor_id = ? AND rendimiento_real_kml IS NOT NULL`,
      [params.id],
    )
    const r = rows[0]
    if (!r || r.num_cargas === 0) { set.status = 404; return { ok: false, message: 'Sin datos de rendimiento aún' } }
    return { ok: true, ...r }
  })
