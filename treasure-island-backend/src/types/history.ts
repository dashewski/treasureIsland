// a row of match_history as pg returns it: NUMERIC as string, TIMESTAMP as Date
export interface MatchHistoryRow {
  id: number
  matchId: string
  player1Id: number
  player2Id: number
  bid: string
  result: "played" | "cancelled"
  p1Winnings: string | null
  p2Winnings: string | null
  fee: string | null
  cancelReason: string | null
  moves: unknown
  createdAt: Date
  finishedAt: Date | null
}

export interface HistoryResponse {
  matchId: string
  finishedAt: number // ms
  outcome: "win" | "draw" | "loss"
  netProfit: string // after the fee, "3.60"
}
