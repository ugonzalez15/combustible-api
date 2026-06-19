const required = [
  'DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME',
]

for (const key of required) {
  if (!process.env[key]) {
    console.error(`[config] Falta variable de entorno requerida: ${key}`)
    process.exit(1)
  }
}

export const config = {
  port:     Number(process.env.PORT ?? 3000),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  db: {
    host:     process.env.DB_HOST!,
    port:     Number(process.env.DB_PORT ?? 3306),
    user:     process.env.DB_USER!,
    password: process.env.DB_PASSWORD!,
    database: process.env.DB_NAME!,
  },
  umbrales: {
    rendimientoPct: Number(process.env.UMBRAL_RENDIMIENTO_PCT ?? 70),
    tanquePct:      Number(process.env.UMBRAL_TANQUE_PCT ?? 20),
  },
  horario: {
    inicio: process.env.HORARIO_INICIO ?? '06:00',
    fin:    process.env.HORARIO_FIN    ?? '22:00',
  },
}
