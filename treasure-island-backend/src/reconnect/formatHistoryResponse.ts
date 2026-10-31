import { centsToDecimalString, decimalToCents } from "../domain/money"
import type { HistoryResponse, MatchHistoryRow } from "../types/history"

// the only way a history row reaches the frontend: no player ids, moves or fee
export function formatHistoryResponse(row: MatchHistoryRow, playerId: number): HistoryResponse {
  let winnings: string | null
  if (row.player1Id === playerId) winnings = row.p1Winnings
  else if (row.player2Id === playerId) winnings = row.p2Winnings
  else throw new Error("formatHistoryResponse: the player is not in this match")

  if (winnings === null || row.finishedAt === null) {
    throw new Error("formatHistoryResponse: the match row is not finished")
  }

  const netProfit = decimalToCents(winnings) - decimalToCents(row.bid)
  const outcome = netProfit > 0 ? "win" : netProfit === 0 ? "draw" : "loss"

  return {
    matchId: row.matchId,
    finishedAt: row.finishedAt.getTime(),
    outcome,
    netProfit: centsToDecimalString(netProfit),
  }
}
