import { pool } from "../db/pool"
import { HOLD_SAFETY_TIMEOUT, MATCH_STAKE } from "../constants"
import { InsufficientBalanceError } from "../errors"
import { decimalToCents } from "../domain/money"

export async function reserveBid(playerId: number): Promise<number> {
  const enoughBalance = (await availableBalance(playerId)) >= decimalToCents(MATCH_STAKE)
  if (!enoughBalance) {
    throw new InsufficientBalanceError("not enough balance")
  }

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

// free balance in cents: balance minus the active holds
async function availableBalance(playerId: number): Promise<number> {
  const result = await pool.query<{ available: string }>(
    `SELECT balance - COALESCE((SELECT SUM(amount) FROM balance_holds
                                WHERE "playerId" = $1 AND status = 'active'), 0) AS available
     FROM players WHERE id = $1`,
    [playerId],
  )

  const row = result.rows[0]
  if (!row) throw new Error("availableBalance: player not found")
  return decimalToCents(row.available)
}
