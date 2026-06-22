import mariadb, * as mariadbTypes from 'mariadb'
import { config } from './config'

const pool = mariadb.createPool({
  ...config.db,
  connectionLimit: 10,
  bigIntAsNumber:  true,
})

export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  let conn
  try {
    conn = await pool.getConnection()
    return await conn.query(sql, params)
  } catch (error) {
    console.error('[db] query failed', error)
    throw error
  } finally {
    if (conn) conn.release()
  }
}

export async function execute(
  sql: string,
  params?: unknown[],
): Promise<mariadbTypes.UpsertResult> {
  const conn = await pool.getConnection()
  try {
    return await conn.query(sql, params)
  } finally {
    conn.release()
  }
}
