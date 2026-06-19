export type Rol = 'conductor' | 'vigilante' | 'supervisor_gasolina' | 'admin'

export type EstadoConversacion =
  | 'idle'
  | 'esperando_unidad'
  | 'esperando_litros'
  | 'esperando_km'
  | 'esperando_foto_odometro'
  | 'esperando_foto_surtidor'
  | 'esperando_tipo_movimiento'
  | 'esperando_numero_unidad'
  | 'esperando_litros_recarga'

export type TipoAlerta =
  | 'rendimiento_anomalo'
  | 'carga_excesiva'
  | 'carga_sin_salida'
  | 'foto_faltante'
  | 'carga_fuera_horario'
  | 'tanque_bajo'
  | 'usuario_no_registrado'

export interface FuelUsuario {
  id:               string
  www_user_id:      string | null
  nombre:           string
  celular_whatsapp: string
  rol:              Rol
  activo:           boolean | number
  sucursal_id:      string
}

export interface FuelUnidad {
  id:                       number
  vehiculo_activo_id:       number
  capacidad_litros:         number
  rendimiento_esperado_kml: number
  activa:                   boolean | number
  placa?:                   string
  numero_identificador_activo?: string
  marca?:                   string
  modelo?:                  string
}

export interface ConversacionEstado {
  celular:       string
  estado:        EstadoConversacion
  contexto:      Record<string, unknown> | null
  ultimo_update: string
}

export interface ResultadoRendimiento {
  km_recorridos:            number
  rendimiento_real_kml:     number
  rendimiento_esperado_kml: number
  porcentaje_vs_esperado:   number
  alerta:                   boolean
}

export interface N8nMessagePayload {
  to:      string
  message: string
}

export interface N8nAlertPayload {
  tipo_alerta:  string
  descripcion:  string
  sucursal_id?: string
  to_admin?:    string
}

// Normaliza el número de celular de Twilio.
// Resuelve el edge case donde Twilio manda "+521XXXXXXXXXX" (14 chars con prefijo móvil)
// en lugar del correcto "+52XXXXXXXXXX" (13 chars).
export function normalizarTelefono(raw: string): string {
  let t = String(raw ?? '').replace('whatsapp:', '').trim()
  if (t.startsWith('+521') && t.length === 14) {
    t = '+52' + t.slice(4)
  }
  return t
}
