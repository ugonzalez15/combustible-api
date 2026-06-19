import mariadb from 'mariadb'
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
  const conn = await pool.getConnection()
  try {
    return await conn.query(sql, params)
  } finally {
    conn.release()
  }
}

export async function execute(
  sql: string,
  params?: unknown[],
): Promise<mariadb.UpsertResult> {
  const conn = await pool.getConnection()
  try {
    return await conn.query(sql, params)
  } finally {
    conn.release()
  }
}
