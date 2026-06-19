import Elysia from 'elysia'
import { createHash } from 'crypto'
import { query, execute } from '../db'

export type ApiKeyPermiso = 'admin' | 'internal' | 'cron'

export function requireApiKey(permiso: ApiKeyPermiso) {
  return new Elysia({ name: `auth-${permiso}` })
    .onBeforeHandle({ as: 'scoped' }, async ({ headers, set }) => {
      const authHeader = (headers['authorization'] ?? '') as string
      if (!authHeader.startsWith('ApiKey ')) {
        set.status = 401
        return { ok: false, message: 'No autorizado' }
      }

      const key     = authHeader.slice('ApiKey '.length).trim()
      const keyHash = createHash('sha256').update(key).digest('hex')

      const rows = await query<{ id: string; permisos: string }>(
        `SELECT id, permisos FROM FUEL_API_KEYS
         WHERE key_hash = ? AND activa = 1
           AND (expires_at IS NULL OR expires_at > NOW())`,
        [keyHash],
      )

      if (rows.length === 0) {
        set.status = 401
        return { ok: false, message: 'No autorizado' }
      }

      const permisos = String(rows[0]!.permisos).split(',')
      if (!permisos.includes(permiso)) {
        set.status = 401
        return { ok: false, message: 'No autorizado' }
      }

      execute('UPDATE FUEL_API_KEYS SET ultimo_uso = NOW() WHERE key_hash = ?', [keyHash]).catch(() => {})
    })
}
