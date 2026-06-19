import { logger } from '../logger'

const SEND_ALERT  = process.env.N8N_WEBHOOK_SEND_ALERT  ?? ''
const SEND_REPORT = process.env.N8N_WEBHOOK_SEND_REPORT ?? ''

// Falla silenciosamente: una falla de n8n no debe revertir una operación de BD ya exitosa
async function post(url: string, body: unknown): Promise<void> {
  if (!url) {
    logger.warn({ body }, 'n8n.service: URL no configurada, se omite el envío')
    return
  }
  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      logger.warn({ url, status: res.status }, 'n8n respondió con error')
    }
  } catch (err) {
    logger.error({ url, err }, 'n8n.service: error al llamar webhook')
  }
}

export async function sendAlert(payload: {
  tipo_alerta:        string
  descripcion:        string
  to_admin?:          string   // "whatsapp:+52..." — si viene del servicio
  sucursal_id?:       string
  foto_surtidor_url?: string
  foto_odometro_url?: string
}): Promise<void> {
  await post(SEND_ALERT, payload)
}

export async function sendReport(payload: {
  tipo:        'diario' | 'semanal' | 'mensual'
  to_admin:    string   // "whatsapp:+52..."
  sucursal_id: string
  texto:       string  // resumen en texto plano para WhatsApp
  html?:       string  // tabla HTML para el email
}): Promise<void> {
  await post(SEND_REPORT, payload)
}
