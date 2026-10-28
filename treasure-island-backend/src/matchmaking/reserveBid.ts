import { pool } from "../db/pool"
import { HOLD_SAFETY_TIMEOUT, MATCH_STAKE } from "../constants"

export async function reserveBid(playerId: number): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `INSERT INTO balance_holds ("playerId", type, amount, "expiresAt")
     VALUES ($1, 'match_bid', $2, NOW() + make_interval(secs => $3))
     RETURNING id`,
    [playerId, MATCH_STAKE, HOLD_SAFETY_TIMEOUT],
  )

  const row = result.rows[0]
  if (!row) throw new Error("reserveBid: the insert returned no row")
  return row.id
}
