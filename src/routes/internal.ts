import Elysia from 'elysia'
import { requireApiKey } from '../middleware/auth'
import { query } from '../db'
import * as alertaSvc from '../services/alerta.service'
import * as rendimiento from '../services/rendimiento.service'
import * as n8n from '../services/n8n.service'
import type { TipoAlerta } from '../types'

const internalProtected = new Elysia()
  .use(requireApiKey('internal'))

  .post('/generar-alerta', async ({ body }) => {
    const { tipo_alerta, descripcion, referencia_id, sucursal_id, notificar_a } = body as {
      tipo_alerta: TipoAlerta; descripcion: string
      referencia_id?: string; sucursal_id?: string; notificar_a?: string
    }
    const alerta_id = await alertaSvc.generarAlerta({ tipo_alerta, descripcion, referencia_id, sucursal_id, notificar_a })
    return { ok: true, alerta_id }
  })

  .post('/calcular-rendimiento', async ({ body }) => {
    const { unidad_id, km_actual, litros_cargados } = body as {
      unidad_id: number; km_actual: number; litros_cargados: number
    }
    const result = await rendimiento.calcularRendimiento(unidad_id, km_actual, litros_cargados)
    if (!result) return { ok: true, message: 'Sin carga anterior — primer registro de la unidad' }
    return { ok: true, ...result }
  })

const cronProtected = new Elysia()
  .use(requireApiKey('cron'))

  .post('/reportes/diario', async () => {
    const admins = await query<{ celular_whatsapp: string; sucursal_id: string }>(
      `SELECT celular_whatsapp, sucursal_id FROM FUEL_USUARIOS WHERE rol = 'admin' AND activo = 1`,
    )
    const reportes: { sucursal_id: string; to: string }[] = []

    for (const admin of admins) {
      const rows = await query<Record<string, unknown>>(
        `SELECT u.nombre,
                COUNT(rc.id)                              AS cargas,
                COALESCE(SUM(rc.litros_cargados), 0)      AS total_litros,
                COALESCE(SUM(rc.km_recorridos), 0)        AS total_km,
                ROUND(AVG(rc.rendimiento_real_kml), 2)    AS rendimiento_prom,
                fu2.rendimiento_esperado_kml              AS rendimiento_esperado,
                SUM(rc.alerta_generada)                   AS alertas,
                CASE
                  WHEN SUM(rc.alerta_generada) > 0 THEN 'rojo'
                  WHEN AVG(rc.rendimiento_real_kml) IS NULL THEN 'amarillo'
                  ELSE 'verde'
                END AS semaforo
         FROM FUEL_REGISTROS_CARGA rc
         JOIN FUEL_USUARIOS u ON u.id = rc.conductor_id
         LEFT JOIN FUEL_ASIGNACIONES_DIA ad ON ad.conductor_id = u.id AND ad.fecha = CURDATE()
         LEFT JOIN FUEL_UNIDADES fu2 ON fu2.id = ad.unidad_id
         WHERE u.sucursal_id = ? AND DATE(rc.timestamp) = CURDATE()
         GROUP BY u.id, u.nombre, fu2.rendimiento_esperado_kml
         ORDER BY total_litros DESC`,
        [admin.sucursal_id],
      )
      if (rows.length === 0) continue

      const lineas = (rows as Array<Record<string, unknown>>).map(r => {
        const s = r.semaforo === 'verde' ? '🟢' : r.semaforo === 'amarillo' ? '🟡' : '🔴'
        return `${s} ${r.nombre}: ${r.total_litros}L · ${r.total_km}km · ${r.rendimiento_prom ?? '—'} km/L`
      })
      const texto = `📊 Reporte diario ${new Date().toLocaleDateString('es-MX')}\n\n${lineas.join('\n')}`

      await n8n.sendReport({ tipo: 'diario', to_admin: `whatsapp:${admin.celular_whatsapp}`, sucursal_id: admin.sucursal_id, texto })
      reportes.push({ sucursal_id: admin.sucursal_id, to: admin.celular_whatsapp })
    }

    return { ok: true, reportes_enviados: reportes.length, reportes }
  })

  .post('/reportes/semanal', async () => {
    const admins = await query<{ celular_whatsapp: string; sucursal_id: string }>(
      `SELECT celular_whatsapp, sucursal_id FROM FUEL_USUARIOS WHERE rol = 'admin' AND activo = 1`,
    )
    const reportes: { sucursal_id: string; to: string; conductores: Record<string, unknown>[] }[] = []

    for (const admin of admins) {
      const rows = await query<Record<string, unknown>>(
        `SELECT u.nombre,
                COUNT(rc.id)                              AS cargas,
                COALESCE(SUM(rc.litros_cargados), 0)      AS total_litros,
                COALESCE(SUM(rc.km_recorridos), 0)        AS total_km,
                ROUND(AVG(rc.rendimiento_real_kml), 2)    AS rendimiento_prom,
                SUM(rc.alerta_generada)                   AS alertas,
                CASE WHEN SUM(rc.alerta_generada) > 0 THEN 'rojo' ELSE 'verde' END AS semaforo
         FROM FUEL_REGISTROS_CARGA rc
         JOIN FUEL_USUARIOS u ON u.id = rc.conductor_id
         WHERE u.sucursal_id = ? AND rc.timestamp >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
         GROUP BY u.id, u.nombre ORDER BY total_litros DESC`,
        [admin.sucursal_id],
      )
      if (rows.length === 0) continue

      const lineas = (rows as Array<Record<string, unknown>>).map(r => {
        const s = r.semaforo === 'verde' ? '🟢' : '🔴'
        return `${s} ${r.nombre}: ${r.total_litros}L · ${r.total_km}km · ${r.rendimiento_prom ?? '—'} km/L · ${r.alertas} alertas`
      })
      const texto = `📊 Reporte semanal\n\n${lineas.join('\n')}`

      await n8n.sendReport({ tipo: 'semanal', to_admin: `whatsapp:${admin.celular_whatsapp}`, sucursal_id: admin.sucursal_id, texto })
      reportes.push({ sucursal_id: admin.sucursal_id, to: admin.celular_whatsapp, conductores: rows })
    }

    return { ok: true, reportes }
  })

  .post('/reportes/mensual', async ({ query: qs }) => {
    const mes    = (qs.mes as string | undefined) ?? new Date().toISOString().substring(0, 7)
    const admins = await query<{ celular_whatsapp: string; sucursal_id: string }>(
      `SELECT celular_whatsapp, sucursal_id FROM FUEL_USUARIOS WHERE rol = 'admin' AND activo = 1`,
    )
    const reportes: { sucursal_id: string; to: string; conductores: Record<string, unknown>[] }[] = []

    for (const admin of admins) {
      const rows = await query<Record<string, unknown>>(
        `SELECT u.nombre,
                COUNT(rc.id) AS cargas,
                COALESCE(SUM(rc.litros_cargados), 0)   AS total_litros,
                ROUND(AVG(rc.rendimiento_real_kml), 2) AS rendimiento_prom,
                SUM(rc.alerta_generada)                AS alertas
         FROM FUEL_REGISTROS_CARGA rc
         JOIN FUEL_USUARIOS u ON u.id = rc.conductor_id
         WHERE u.sucursal_id = ? AND DATE_FORMAT(rc.timestamp, '%Y-%m') = ?
         GROUP BY u.id, u.nombre ORDER BY total_litros DESC`,
        [admin.sucursal_id, mes],
      )
      if (rows.length === 0) continue

      const lineas = (rows as Array<Record<string, unknown>>).map(r =>
        `• ${r.nombre}: ${r.total_litros}L · ${r.rendimiento_prom ?? '—'} km/L · ${r.alertas} alertas`,
      )
      const texto = `📊 Reporte mensual ${mes}\n\n${lineas.join('\n')}`

      await n8n.sendReport({ tipo: 'mensual', to_admin: `whatsapp:${admin.celular_whatsapp}`, sucursal_id: admin.sucursal_id, texto })
      reportes.push({ sucursal_id: admin.sucursal_id, to: admin.celular_whatsapp, conductores: rows })
    }

    return { ok: true, mes, reportes }
  })

export const internalRoutes = new Elysia({ prefix: '/internal' })
  .use(internalProtected)
  .use(cronProtected)
