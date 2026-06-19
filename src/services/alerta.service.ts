import { randomUUID } from 'crypto'
import { execute, query } from '../db'
import * as n8n from './n8n.service'
import type { TipoAlerta } from '../types'

export async function generarAlerta(params: {
  tipo_alerta:        TipoAlerta
  descripcion:        string
  referencia_id?:     string | null
  sucursal_id?:       string
  notificar_a?:       string   // celular del admin a notificar (sin "whatsapp:")
  foto_surtidor_url?: string
  foto_odometro_url?: string
}): Promise<string> {
  const { tipo_alerta, descripcion, referencia_id = null, sucursal_id, notificar_a,
          foto_surtidor_url, foto_odometro_url } = params

  const id = randomUUID()
  await execute(
    `INSERT INTO FUEL_ALERTAS (id, tipo_alerta, descripcion, referencia_id)
     VALUES (?, ?, ?, ?)`,
    [id, tipo_alerta, descripcion, referencia_id],
  )

  // Determinar a quién notificar
  let adminTel = notificar_a
  if (!adminTel && sucursal_id) {
    const admins = await query<{ celular_whatsapp: string }>(
      `SELECT celular_whatsapp FROM FUEL_USUARIOS
       WHERE rol = 'admin' AND activo = 1 AND sucursal_id = ? LIMIT 1`,
      [sucursal_id],
    )
    adminTel = admins[0]?.celular_whatsapp
  }

  // Notificar via n8n (falla silenciosamente si n8n no está disponible)
  await n8n.sendAlert({
    tipo_alerta,
    descripcion,
    to_admin:          adminTel ? `whatsapp:${adminTel}` : undefined,
    sucursal_id,
    foto_surtidor_url,
    foto_odometro_url,
  })

  return id
}
