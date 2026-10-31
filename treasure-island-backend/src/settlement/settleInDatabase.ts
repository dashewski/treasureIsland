import type { PoolClient } from "pg"
import { withTransaction } from "../db/transaction"
import type { Settlement } from "../domain/calcSettlement"

export type SettleInDatabaseResult = "settled" | "already_settled"

export interface SettleInDatabaseInput {
  matchId: string
  player1Id: number
  player2Id: number
  player1HoldId: number
  player2HoldId: number
  bidCents: number
  settlement: Settlement // amounts in cents
  moves: unknown // placement and reveal, stored for audit
}

// money part of settleMatch in one transaction; the UNIQUE matchId stops a second payout
export async function settleInDatabase(
  input: SettleInDatabaseInput,
): Promise<SettleInDatabaseResult> {
  return withTransaction(async (client) => {
    const history = await client.query<{ id: number }>(
      `INSERT INTO match_history
         ("matchId", "player1Id", "player2Id", bid, result, "p1Winnings", "p2Winnings", fee, moves, "finishedAt")
       VALUES ($1, $2, $3, $4::numeric / 100, 'played', $5::numeric / 100, $6::numeric / 100,
               $7::numeric / 100, $8::jsonb, NOW())
       ON CONFLICT ("matchId") DO NOTHING
       RETURNING id`,
      [
        input.matchId,
        input.player1Id,
        input.player2Id,
        input.bidCents,
        input.settlement.p1.payout,
        input.settlement.p2.payout,
        input.settlement.totalFee,
        JSON.stringify(input.moves),
      ],
    )
    if (history.rowCount === 0) return "already_settled"

    // always the lower player id first, so two settlements cannot lock each other
    const [firstId, secondId] = [input.player1Id, input.player2Id].sort((a, b) => a - b)
    await client.query("SELECT id FROM players WHERE id = $1 FOR UPDATE", [firstId])
    await client.query("SELECT id FROM players WHERE id = $1 FOR UPDATE", [secondId])

    await lockAndCheckHolds(client, input)

    await creditPlayer(client, input.player1Id, input.bidCents, input.settlement.p1)
    await creditPlayer(client, input.player2Id, input.bidCents, input.settlement.p2)

    const consumed = await client.query(
      `UPDATE balance_holds SET status = 'consumed'
       WHERE id IN ($1, $2) AND status = 'active'`,
      [input.player1HoldId, input.player2HoldId],
    )
    if (consumed.rowCount !== 2) throw new Error("settleInDatabase: could not consume both holds")

    return "settled"
  })
}

async function lockAndCheckHolds(client: PoolClient, input: SettleInDatabaseInput): Promise<void> {
  const result = await client.query<{ id: number; playerId: number; status: string; refId: string | null }>(
    `SELECT id, "playerId", status, "refId" FROM balance_holds
     WHERE id IN ($1, $2) ORDER BY id FOR UPDATE`,
    [input.player1HoldId, input.player2HoldId],
  )

  const byId = new Map(result.rows.map((row) => [row.id, row]))
  const expected = [
    { holdId: input.player1HoldId, playerId: input.player1Id },
    { holdId: input.player2HoldId, playerId: input.player2Id },
  ]
  for (const { holdId, playerId } of expected) {
    const hold = byId.get(holdId)
    if (!hold) throw new Error(`settleInDatabase: hold ${holdId} not found`)
    if (hold.status !== "active") throw new Error(`settleInDatabase: hold ${holdId} is not active`)
    if (hold.refId !== input.matchId) throw new Error(`settleInDatabase: hold ${holdId} is linked to another match`)
    if (hold.playerId !== playerId) throw new Error(`settleInDatabase: hold ${holdId} belongs to another player`)
  }
}

async function creditPlayer(
  client: PoolClient,
  playerId: number,
  bidCents: number,
  side: { payout: number; profit: number },
): Promise<void> {
  const win = side.profit > 0 ? 1 : 0
  const result = await client.query(
    `UPDATE players
     SET balance = balance - $2::numeric / 100 + $3::numeric / 100,
         matches = matches + 1,
         wins = wins + $4,
         "lastPlays" = NOW()
     WHERE id = $1`,
    [playerId, bidCents, side.payout, win],
  )
  if (result.rowCount !== 1) throw new Error(`settleInDatabase: player ${playerId} not found`)
}
