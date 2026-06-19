import Elysia from 'elysia'
import { randomUUID } from 'crypto'
import { requireApiKey } from '../middleware/auth'
import { query, execute } from '../db'
import { normalizarTelefono } from '../types'

export const adminRoutes = new Elysia({ prefix: '/admin' })
  .use(requireApiKey('admin'))

  .get('/alertas', async ({ query: qs }) => {
    const conditions: string[] = []
    const params: unknown[]    = []

    if (qs.resuelta !== undefined) {
      conditions.push('resuelta = ?')
      params.push(qs.resuelta === 'false' || qs.resuelta === '0' ? 0 : 1)
    }
    if (qs.tipo)  { conditions.push('tipo_alerta = ?'); params.push(qs.tipo) }
    if (qs.desde) { conditions.push('timestamp >= ?');  params.push(qs.desde) }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const rows  = await query<Record<string, unknown>>(
      `SELECT id, tipo_alerta, descripcion, referencia_id, timestamp, resuelta
       FROM FUEL_ALERTAS ${where} ORDER BY timestamp DESC LIMIT 100`,
      params,
    )
    return { total: rows.length, alertas: rows }
  })

  .patch('/alertas/:id/resolver', async ({ params, set }) => {
    const result = await execute('UPDATE FUEL_ALERTAS SET resuelta = 1 WHERE id = ?', [params.id])
    if (result.affectedRows === 0) { set.status = 404; return { ok: false, message: 'Alerta no encontrada' } }
    return { ok: true, id: params.id, resuelta: true }
  })

  .get('/reporte/semanal', async ({ query: qs }) => {
    const sucursal_id = qs.sucursal_id as string | undefined
    const cond   = sucursal_id ? 'AND u.sucursal_id = ?' : ''
    const params  = sucursal_id ? [sucursal_id] : []

    const rows = await query<Record<string, unknown>>(
      `SELECT u.nombre,
              COUNT(rc.id) AS cargas,
              COALESCE(SUM(rc.litros_cargados), 0)   AS total_litros,
              COALESCE(SUM(rc.km_recorridos), 0)     AS total_km,
              ROUND(AVG(rc.rendimiento_real_kml), 2) AS rendimiento_prom,
              SUM(rc.alerta_generada) AS alertas
       FROM FUEL_REGISTROS_CARGA rc
       JOIN FUEL_USUARIOS u ON u.id = rc.conductor_id
       WHERE rc.timestamp >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY) ${cond}
       GROUP BY u.id, u.nombre ORDER BY total_litros DESC`,
      params,
    )
    const totales = await query<{ litros: number; km: number; alertas: number }>(
      `SELECT COALESCE(SUM(rc.litros_cargados), 0) AS litros,
              COALESCE(SUM(rc.km_recorridos), 0) AS km,
              SUM(rc.alerta_generada) AS alertas
       FROM FUEL_REGISTROS_CARGA rc
       JOIN FUEL_USUARIOS u ON u.id = rc.conductor_id
       WHERE rc.timestamp >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY) ${cond}`,
      params,
    )
    return {
      semana: new Date().toISOString().substring(0, 10),
      total_litros_despachados: totales[0]?.litros  ?? 0,
      total_km_recorridos:      totales[0]?.km      ?? 0,
      alertas_generadas:        totales[0]?.alertas ?? 0,
      conductores: rows,
    }
  })

  .get('/reporte/mensual', async ({ query: qs }) => {
    const sucursal_id = qs.sucursal_id as string | undefined
    const mes         = (qs.mes as string | undefined) ?? new Date().toISOString().substring(0, 7)
    const cond   = sucursal_id ? 'AND u.sucursal_id = ?' : ''
    const params: unknown[] = sucursal_id ? [mes, sucursal_id] : [mes]

    const rows = await query<Record<string, unknown>>(
      `SELECT u.nombre,
              COUNT(rc.id) AS cargas,
              COALESCE(SUM(rc.litros_cargados), 0)   AS total_litros,
              COALESCE(SUM(rc.km_recorridos), 0)     AS total_km,
              ROUND(AVG(rc.rendimiento_real_kml), 2) AS rendimiento_prom,
              SUM(rc.alerta_generada) AS alertas
       FROM FUEL_REGISTROS_CARGA rc
       JOIN FUEL_USUARIOS u ON u.id = rc.conductor_id
       WHERE DATE_FORMAT(rc.timestamp, '%Y-%m') = ? ${cond}
       GROUP BY u.id, u.nombre ORDER BY total_litros DESC`,
      params,
    )
    return { mes, conductores: rows }
  })

  .post('/usuarios', async ({ body, set }) => {
    const { www_user_id, nombre, celular_whatsapp, rol, sucursal_id } = body as {
      www_user_id?: string; nombre: string; celular_whatsapp: string; rol: string; sucursal_id: string
    }

    if (www_user_id) {
      const exists = await query('SELECT userid FROM www_users WHERE userid = ?', [www_user_id])
      if (exists.length === 0) { set.status = 400; return { ok: false, message: 'www_user_id no existe en www_users' } }
    }

    const loc = await query('SELECT loccode FROM locations WHERE loccode = ?', [sucursal_id])
    if (loc.length === 0) { set.status = 400; return { ok: false, message: 'sucursal_id no existe en locations' } }

    const tel = normalizarTelefono(celular_whatsapp)
    const id  = randomUUID()
    await execute(
      'INSERT INTO FUEL_USUARIOS (id, www_user_id, nombre, celular_whatsapp, rol, sucursal_id) VALUES (?, ?, ?, ?, ?, ?)',
      [id, www_user_id ?? null, nombre, tel, rol, sucursal_id],
    )
    return { ok: true, id }
  })

  .patch('/usuarios/:id', async ({ params, body, set }) => {
    const updates = body as Record<string, unknown>
    const allowed = ['rol', 'activo', 'sucursal_id', 'nombre']
    const fields  = Object.keys(updates).filter(k => allowed.includes(k))

    if (fields.length === 0) { set.status = 400; return { ok: false, message: 'Sin campos a actualizar' } }

    const setClause = fields.map(f => `${f} = ?`).join(', ')
    const values    = [...fields.map(f => updates[f]), params.id]

    await execute(`UPDATE FUEL_USUARIOS SET ${setClause} WHERE id = ?`, values)
    return { ok: true, id: params.id }
  })

  .post('/unidades', async ({ body, set }) => {
    const { vehiculo_activo_id, capacidad_litros, rendimiento_esperado_kml } = body as {
      vehiculo_activo_id: number; capacidad_litros: number; rendimiento_esperado_kml: number
    }

    const exists = await query('SELECT id FROM tblvehiculosActivos WHERE id = ?', [vehiculo_activo_id])
    if (exists.length === 0) { set.status = 400; return { ok: false, message: 'vehiculo_activo_id no existe en tblvehiculosActivos' } }

    await execute(
      'INSERT INTO FUEL_UNIDADES (vehiculo_activo_id, capacidad_litros, rendimiento_esperado_kml) VALUES (?, ?, ?)',
      [vehiculo_activo_id, capacidad_litros, rendimiento_esperado_kml],
    )
    const rows = await query<{ id: number }>('SELECT LAST_INSERT_ID() AS id')
    return { ok: true, id: rows[0]?.id }
  })

  .patch('/unidades/:id', async ({ params, body, set }) => {
    const updates = body as Record<string, unknown>
    const allowed = ['capacidad_litros', 'rendimiento_esperado_kml', 'activa']
    const fields  = Object.keys(updates).filter(k => allowed.includes(k))

    if (fields.length === 0) { set.status = 400; return { ok: false, message: 'Sin campos a actualizar' } }

    const setClause = fields.map(f => `${f} = ?`).join(', ')
    const values    = [...fields.map(f => updates[f]), params.id]

    await execute(`UPDATE FUEL_UNIDADES SET ${setClause} WHERE id = ?`, values)
    return { ok: true, id: params.id }
  })
