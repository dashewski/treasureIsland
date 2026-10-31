import type { PoolClient } from "pg"
import { HOLD_SAFETY_TIMEOUT, MATCH_STAKE, MAX_DEADLOCK_ATTEMPTS } from "../constants"
import { hasPgCode } from "../db/pgError"
import { withTransaction } from "../db/transaction"
import { decimalToCents } from "../domain/money"
import { AlreadyInGameError, InsufficientBalanceError } from "../errors"

export async function reserveBid(playerId: number): Promise<number> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await withTransaction((client) => reserveInTransaction(client, playerId))
    } catch (error) {
      // deadlock: PostgreSQL killed this transaction, run it again from the start
      if (hasPgCode(error, "40P01") && attempt < MAX_DEADLOCK_ATTEMPTS) continue
      // the unique index caught a second active bid that the checks missed
      if (hasPgCode(error, "23505")) throw new AlreadyInGameError("already in game")
      throw error
    }
  }
}

async function reserveInTransaction(client: PoolClient, playerId: number): Promise<number> {
  // the row lock makes two calls for one player run one after another
  const player = await client.query("SELECT id FROM players WHERE id = $1 FOR UPDATE", [playerId])
  if (player.rowCount === 0) throw new Error("reserveBid: player not found")

  if (await hasActiveMatchBid(client, playerId)) {
    throw new AlreadyInGameError("already in game")
  }

  const enoughBalance = (await availableBalance(client, playerId)) >= decimalToCents(MATCH_STAKE)
  if (!enoughBalance) {
    throw new InsufficientBalanceError("not enough balance")
  }

  const result = await client.query<{ id: number }>(
    `INSERT INTO balance_holds ("playerId", type, amount, "expiresAt")
     VALUES ($1, 'match_bid', $2, NOW() + make_interval(secs => $3))
     RETURNING id`,
    [playerId, MATCH_STAKE, HOLD_SAFETY_TIMEOUT],
  )

  const row = result.rows[0]
  if (!row) throw new Error("reserveBid: the insert returned no row")
  return row.id
}

async function hasActiveMatchBid(client: PoolClient, playerId: number): Promise<boolean> {
  const result = await client.query(
    `SELECT 1 FROM balance_holds
     WHERE "playerId" = $1 AND type = 'match_bid' AND status = 'active'`,
    [playerId],
  )
  return (result.rowCount ?? 0) > 0
}

// free balance in cents: balance minus the active holds
async function availableBalance(client: PoolClient, playerId: number): Promise<number> {
  const result = await client.query<{ available: string }>(
    `SELECT balance - COALESCE((SELECT SUM(amount) FROM balance_holds
                                WHERE "playerId" = $1 AND status = 'active'), 0) AS available
     FROM players WHERE id = $1`,
    [playerId],
  )

  const row = result.rows[0]
  if (!row) throw new Error("availableBalance: player not found")
  return decimalToCents(row.available)
}
