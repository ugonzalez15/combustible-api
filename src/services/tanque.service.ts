import { randomUUID } from 'crypto'
import { query, execute } from '../db'
import { config } from '../config'

export async function getNivelActual(sucursal_id: string): Promise<number> {
  const rows = await query<{ nivel: number | null }>(
    'SELECT SUM(litros) AS nivel FROM FUEL_INVENTARIO_TANQUE WHERE sucursal_id = ?',
    [sucursal_id],
  )
  return Number(rows[0]?.nivel ?? 0)
}

export async function estaBajoUmbral(sucursal_id: string): Promise<boolean> {
  const CAPACIDAD_REF = 20000
  const nivel  = await getNivelActual(sucursal_id)
  const umbral = CAPACIDAD_REF * (config.umbrales.tanquePct / 100)
  return nivel < umbral
}

export async function registrarMovimiento(params: {
  sucursal_id:     string
  tipo_movimiento: 'recarga' | 'despacho'
  litros:          number
  referencia_id?:  string | null
  registrado_por:  string
}): Promise<string> {
  const { sucursal_id, tipo_movimiento, litros, referencia_id = null, registrado_por } = params
  const id = randomUUID()

  await execute(
    `INSERT INTO FUEL_INVENTARIO_TANQUE
       (id, sucursal_id, tipo_movimiento, litros, referencia_id, registrado_por)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, sucursal_id, tipo_movimiento, litros, referencia_id, registrado_por],
  )

  return id
}
