import { query, execute } from '../db'
import type { EstadoConversacion, ConversacionEstado } from '../types'

export async function getEstado(celular: string): Promise<ConversacionEstado | null> {
  const rows = await query<ConversacionEstado>(
    'SELECT celular, estado, contexto, ultimo_update FROM FUEL_CONVERSACION_ESTADO WHERE celular = ?',
    [celular],
  )
  if (rows.length === 0) return null
  const row = rows[0]!
  if (typeof row.contexto === 'string') {
    try { (row as any).contexto = JSON.parse(row.contexto) } catch { (row as any).contexto = null }
  }
  return row
}

export async function setEstado(
  celular:  string,
  estado:   EstadoConversacion,
  contexto: Record<string, unknown> = {},
): Promise<void> {
  const ctx = JSON.stringify(contexto)
  await execute(
    `INSERT INTO FUEL_CONVERSACION_ESTADO (celular, estado, contexto)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE estado = VALUES(estado), contexto = VALUES(contexto)`,
    [celular, estado, ctx],
  )
}

export async function resetEstado(celular: string): Promise<void> {
  await setEstado(celular, 'idle', {})
}
