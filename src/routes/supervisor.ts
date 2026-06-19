import Elysia from 'elysia'
import { requireApiKey } from '../middleware/auth'
import { query } from '../db'
import * as tanque from '../services/tanque.service'

export const supervisorRoutes = new Elysia({ prefix: '/supervisor' })
  .use(requireApiKey('admin'))

  .post('/registrar-recarga', async ({ body }) => {
    const { supervisor_id, sucursal_id, litros } = body as {
      supervisor_id: string; sucursal_id: string; litros: number
    }

    await tanque.registrarMovimiento({
      sucursal_id,
      tipo_movimiento: 'recarga',
      litros:          +litros,
      registrado_por:  supervisor_id,
    })

    const nivelActual = await tanque.getNivelActual(sucursal_id)
    const tanqueRows  = await query<{ id: string }>(
      `SELECT id FROM FUEL_INVENTARIO_TANQUE WHERE sucursal_id = ? AND registrado_por = ?
       ORDER BY timestamp DESC LIMIT 1`,
      [sucursal_id, supervisor_id],
    )

    return { ok: true, registro_id: tanqueRows[0]?.id, litros_agregados: litros, nivel_actual: nivelActual }
  })

  .get('/nivel-tanque/:sucursal_id', async ({ params }) => {
    const { sucursal_id } = params
    const nivel  = await tanque.getNivelActual(sucursal_id)
    const ultimo = await query<{ timestamp: string }>(
      'SELECT timestamp FROM FUEL_INVENTARIO_TANQUE WHERE sucursal_id = ? ORDER BY timestamp DESC LIMIT 1',
      [sucursal_id],
    )
    return { sucursal_id, nivel_actual_litros: nivel, ultimo_movimiento: ultimo[0]?.timestamp ?? null }
  })
