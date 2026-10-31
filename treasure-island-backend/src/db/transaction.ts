import type { PoolClient } from "pg"
import { pool } from "./pool"

// all queries of one transaction must go through the same connection
export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  let broken = false
  try {
    await client.query("BEGIN")
    const result = await work(client)
    await client.query("COMMIT")
    return result
  } catch (error) {
    try {
      await client.query("ROLLBACK")
    } catch {
      broken = true
    }
    throw error
  } finally {
    // a connection that could not even roll back is thrown away, not reused
    client.release(broken)
  }
}
