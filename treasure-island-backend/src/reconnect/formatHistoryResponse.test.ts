import type { MatchHistoryRow } from "../types/history"
import { formatHistoryResponse } from "./formatHistoryResponse"

const finishedAt = new Date("2026-10-24T17:11:00.000Z")

// stake 5; player 1 got 8.60 and player 2 got 1.00
function row(overrides: Partial<MatchHistoryRow> = {}): MatchHistoryRow {
  return {
    id: 1,
    matchId: "550e8400-e29b-41d4-a716-446655440000",
    player1Id: 7,
    player2Id: 8,
    bid: "5.00",
    result: "played",
    p1Winnings: "8.60",
    p2Winnings: "1.00",
    fee: "0.40",
    cancelReason: null,
    moves: { secret: "placement" },
    createdAt: new Date("2026-10-24T17:00:00.000Z"),
    finishedAt,
    ...overrides,
  }
}

describe("formatHistoryResponse", () => {
  it("shows a win to player 1 with the profit after the fee", () => {
    expect(formatHistoryResponse(row(), 7)).toEqual({
      matchId: "550e8400-e29b-41d4-a716-446655440000",
      finishedAt: finishedAt.getTime(),
      outcome: "win",
      netProfit: "3.60",
    })
  })

  it("shows a loss to player 2 with a negative profit", () => {
    const response = formatHistoryResponse(row(), 8)
    expect(response.outcome).toBe("loss")
    expect(response.netProfit).toBe("-4.00")
  })

  it("shows a draw when the payout equals the stake", () => {
    const draw = row({ p1Winnings: "5.00", p2Winnings: "5.00", fee: "0.00" })

    expect(formatHistoryResponse(draw, 7)).toMatchObject({ outcome: "draw", netProfit: "0.00" })
    expect(formatHistoryResponse(draw, 8)).toMatchObject({ outcome: "draw", netProfit: "0.00" })
  })

  it("returns the time in milliseconds", () => {
    expect(formatHistoryResponse(row(), 7).finishedAt).toBe(1792861860000)
  })

  it("exposes only four fields: no player ids, moves, fee or raw winnings", () => {
    const response = formatHistoryResponse(row(), 7)

    expect(Object.keys(response).sort()).toEqual(["finishedAt", "matchId", "netProfit", "outcome"])
    expect(JSON.stringify(response)).not.toContain("secret")
  })

  it("throws when the player did not play this match", () => {
    expect(() => formatHistoryResponse(row(), 99)).toThrow("not in this match")
  })

  it("throws on a row that is not finished", () => {
    expect(() => formatHistoryResponse(row({ finishedAt: null }), 7)).toThrow("not finished")
    expect(() => formatHistoryResponse(row({ p1Winnings: null }), 7)).toThrow("not finished")
  })
})
