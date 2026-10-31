import { pool } from "../db/pool"

// true if this call closed the hold, false if it was already closed
export async function releaseHold(
  holdId: number,
  finalStatus: "released" | "consumed",
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE balance_holds SET status = $2 WHERE id = $1 AND status = 'active'`,
    [holdId, finalStatus],
  )
  return result.rowCount === 1
}
