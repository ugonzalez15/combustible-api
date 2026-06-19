import Elysia from 'elysia'
import { randomUUID } from 'crypto'
import { requireApiKey } from '../middleware/auth'
import { query, execute } from '../db'

export const vigilanteRoutes = new Elysia({ prefix: '/vigilante' })
  .use(requireApiKey('admin'))

  .post('/registrar-movimiento', async ({ body, set }) => {
    const { vigilante_id, unidad_id, tipo, sucursal_id } = body as {
      vigilante_id: string; unidad_id: number; tipo: 'entrada' | 'salida'; sucursal_id: string
    }

    const unidad = await query<{ activa: number }>(
      'SELECT activa FROM FUEL_UNIDADES WHERE id = ?', [unidad_id],
    )
    if (unidad.length === 0 || !unidad[0]!.activa) {
      set.status = 400
      return { ok: false, message: 'Unidad no existe o está inactiva' }
    }

    const movimiento_id = randomUUID()
    await execute(
      'INSERT INTO FUEL_MOVIMIENTOS_SUCURSAL (id, unidad_id, tipo, registrado_por, sucursal_id) VALUES (?, ?, ?, ?, ?)',
      [movimiento_id, unidad_id, tipo, vigilante_id, sucursal_id],
    )

    const rows = await query<{ timestamp: string }>(
      'SELECT timestamp FROM FUEL_MOVIMIENTOS_SUCURSAL WHERE id = ?', [movimiento_id],
    )
    const unidadInfo = await query<{ numero_identificador_activo: string; placa: string }>(
      `SELECT tv.numero_identificador_activo, tv.placa
       FROM FUEL_UNIDADES fu JOIN tblvehiculosActivos tv ON tv.id = fu.vehiculo_activo_id
       WHERE fu.id = ?`, [unidad_id],
    )

    return { ok: true, movimiento_id, unidad: unidadInfo[0]?.placa ?? `#${unidad_id}`, tipo, timestamp: rows[0]?.timestamp }
  })

  .get('/unidades-activas', async ({ query: qs }) => {
    const sucursal_id = qs.sucursal_id as string
    if (!sucursal_id) return { ok: false, message: 'sucursal_id requerido' }

    const rows = await query<{ unidad_id: number; placa: string; numero_identificador_activo: string; entrada_desde: string }>(
      `SELECT ms.unidad_id, tv.placa, tv.numero_identificador_activo,
              MAX(ms.timestamp) AS entrada_desde
       FROM FUEL_MOVIMIENTOS_SUCURSAL ms
       JOIN FUEL_UNIDADES fu ON fu.id = ms.unidad_id
       JOIN tblvehiculosActivos tv ON tv.id = fu.vehiculo_activo_id
       WHERE ms.sucursal_id = ?
       GROUP BY ms.unidad_id, tv.placa, tv.numero_identificador_activo
       HAVING MAX(CASE WHEN ms.tipo = 'entrada' THEN ms.timestamp END) = MAX(ms.timestamp)`,
      [sucursal_id],
    )

    return { sucursal_id, unidades_dentro: rows }
  })
