import { pool } from "../db/pool"
import type { MatchHistoryRow } from "../types/history"

// newest played match of the player, or null; cancelled rows are skipped
export async function getLastFinishedMatch(playerId: number): Promise<MatchHistoryRow | null> {
  const result = await pool.query<MatchHistoryRow>(
    `SELECT * FROM match_history
     WHERE ("player1Id" = $1 OR "player2Id" = $1) AND result = 'played'
     ORDER BY "finishedAt" DESC
     LIMIT 1`,
    [playerId],
  )
  return result.rows[0] ?? null
}
