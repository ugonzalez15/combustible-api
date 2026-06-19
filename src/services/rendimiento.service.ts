import { query } from '../db'
import { config } from '../config'
import type { ResultadoRendimiento, FuelUnidad } from '../types'

export async function getUnidad(unidad_id: number): Promise<FuelUnidad | null> {
  const rows = await query<FuelUnidad>(
    `SELECT fu.id, fu.vehiculo_activo_id, fu.capacidad_litros,
            fu.rendimiento_esperado_kml, fu.activa,
            tv.placa, tv.numero_identificador_activo, tv.marca, tv.modelo
     FROM FUEL_UNIDADES fu
     JOIN tblvehiculosActivos tv ON tv.id = fu.vehiculo_activo_id
     WHERE fu.id = ?`,
    [unidad_id],
  )
  return rows[0] ?? null
}

export async function calcularRendimiento(
  unidad_id:       number,
  km_actual:       number,
  litros_cargados: number,
): Promise<ResultadoRendimiento | null> {
  const unidad = await getUnidad(unidad_id)
  if (!unidad) return null

  const prevRows = await query<{ km_odometro: number; litros_cargados: number }>(
    `SELECT km_odometro, litros_cargados
     FROM FUEL_REGISTROS_CARGA
     WHERE unidad_id = ?
     ORDER BY timestamp DESC LIMIT 1`,
    [unidad_id],
  )

  if (prevRows.length === 0) return null  // primera carga, sin comparación

  const prev = prevRows[0]!
  const km_recorridos = km_actual - prev.km_odometro

  if (km_recorridos < 0) return null  // km regresivo — alerta en la ruta, no aquí

  const litros_anterior          = Number(prev.litros_cargados)
  const rendimiento_real_kml     = litros_anterior > 0 ? km_recorridos / litros_anterior : 0
  const rendimiento_esperado_kml = Number(unidad.rendimiento_esperado_kml)
  const porcentaje_vs_esperado   = rendimiento_esperado_kml > 0
    ? Math.round((rendimiento_real_kml / rendimiento_esperado_kml) * 100)
    : 100
  const alerta = porcentaje_vs_esperado < config.umbrales.rendimientoPct

  return {
    km_recorridos,
    rendimiento_real_kml:    Math.round(rendimiento_real_kml * 100) / 100,
    rendimiento_esperado_kml,
    porcentaje_vs_esperado,
    alerta,
  }
}

export async function verificarCapacidad(
  unidad_id:       number,
  litros_cargados: number,
): Promise<{ excede: boolean; capacidad_litros: number }> {
  const rows = await query<{ capacidad_litros: number }>(
    'SELECT capacidad_litros FROM FUEL_UNIDADES WHERE id = ?',
    [unidad_id],
  )
  const capacidad_litros = Number(rows[0]?.capacidad_litros ?? 0)
  return { excede: litros_cargados > capacidad_litros, capacidad_litros }
}

export async function tieneSalidaHoy(unidad_id: number): Promise<boolean> {
  const rows = await query<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM FUEL_MOVIMIENTOS_SUCURSAL
     WHERE unidad_id = ? AND tipo = 'salida' AND DATE(timestamp) = CURDATE()`,
    [unidad_id],
  )
  return Number(rows[0]?.cnt ?? 0) > 0
}
