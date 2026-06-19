import Elysia from 'elysia'
import { config } from './config'
import { logger } from './logger'
import { publicRoutes } from './routes/public'
import { conductorRoutes } from './routes/conductor'
import { vigilanteRoutes } from './routes/vigilante'
import { supervisorRoutes } from './routes/supervisor'
import { adminRoutes } from './routes/admin'
import { internalRoutes } from './routes/internal'

const app = new Elysia()
  .use(publicRoutes)
  .use(conductorRoutes)
  .use(vigilanteRoutes)
  .use(supervisorRoutes)
  .use(adminRoutes)
  .use(internalRoutes)
  .onError(({ error, code }) => {
    logger.error({ err: error, code }, 'Unhandled error')
    return new Response(JSON.stringify({ ok: false, message: 'Error interno del servidor' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  .listen(config.port)

logger.info({ port: config.port }, 'combustible-api iniciado')
