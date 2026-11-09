import { ForbiddenError } from "../errors"
import type { Match } from "../types/match"
import { formatMatchResponse } from "./formatMatchResponse"

// player 7 is p1, player 8 is p2; bid 5 = big 4 + small 1
function makeMatch(overrides: Partial<Match> = {}): Match {
  return {
    matchId: "550e8400-e29b-41d4-a716-446655440000",
    status: "waiting",
    player1: "7",
    player2: null,
    player1HoldId: "101",
    player2HoldId: null,
    bid: "5",
    bigAmount: "4",
    smallAmount: "1",
    createdAt: 1000,
    updatedAt: 1000,
    placementDeadline: null,
    turnDeadline: null,
    currentTurn: null,
    cancelReason: null,
    stateVersion: 0,
    placement: null,
    reveal: null,
    ...overrides,
  }
}

const placementMatch = (overrides: Partial<Match> = {}) =>
  makeMatch({
    status: "placement",
    player2: "8",
    player2HoldId: "102",
    placementDeadline: 5000,
    placement: { p1_big: 1, p1_small: 2, p2_big: 3 },
    ...overrides,
  })

const endedMatch = () =>
  makeMatch({
    status: "ended",
    player2: "8",
    player2HoldId: "102",
    placement: { p1_big: 1, p1_small: 2, p2_big: 3, p2_small: 4 },
    reveal: {
      p1_move_1_zone: 4,
      p1_move_1_result: "hit_small",
      p2_move_1_zone: 5,
      p2_move_1_result: "miss",
      p1_move_2_zone: 5,
      p1_move_2_result: "miss",
      p2_move_2_zone: "skipped",
      p2_move_2_result: "skipped",
    },
  })

describe("formatMatchResponse: who may look", () => {
  it("refuses a player who is not in the match", () => {
    expect(() => formatMatchResponse(placementMatch(), "99")).toThrow(ForbiddenError)
  })

  it("refuses to treat a missing second player as a participant", () => {
    expect(() => formatMatchResponse(makeMatch(), "null")).toThrow(ForbiddenError)
  })
})

describe("formatMatchResponse: what is never shown", () => {
  it.each(["7", "8"])("no hold ids for player %s in any phase", (playerId) => {
    for (const match of [placementMatch(), endedMatch()]) {
      const text = JSON.stringify(formatMatchResponse(match, playerId))
      expect(text).not.toContain("HoldId")
      expect(text).not.toContain("101")
      expect(text).not.toContain("102")
    }
  })

  it("in placement the opponent only shows whether a chest is placed, not where", () => {
    const response = formatMatchResponse(placementMatch(), "7")

    expect(response.opponentPlaced).toEqual({ big: true, small: false })
    expect(response).not.toHaveProperty("opponentPlacement")
    expect(JSON.stringify(response)).not.toContain('"p2_big"')
  })

  it("in reveal the opponent chests stay hidden", () => {
    const match = makeMatch({
      status: "reveal",
      player2: "8",
      placement: { p1_big: 1, p1_small: 2, p2_big: 3, p2_small: 4 },
      reveal: {},
      turnDeadline: 9000,
      currentTurn: "7",
    })

    const response = formatMatchResponse(match, "7")

    expect(response).not.toHaveProperty("opponentPlacement")
    expect(response.myPlacement).toEqual({ big: 1, small: 2 })
  })

  it("the money of the settlement is hidden before the match ended", () => {
    expect(formatMatchResponse(placementMatch(), "7")).not.toHaveProperty("settlement")
  })
})

describe("formatMatchResponse: what each phase shows", () => {
  it("waiting: only the common fields, the bid as a decimal string", () => {
    expect(formatMatchResponse(makeMatch(), "7")).toEqual({
      matchId: "550e8400-e29b-41d4-a716-446655440000",
      status: "waiting",
      bid: "5.00",
      createdAt: 1000,
      stateVersion: 0,
    })
  })

  it("placement: the deadline and my own chests", () => {
    const response = formatMatchResponse(placementMatch(), "7")

    expect(response).toMatchObject({
      status: "placement",
      placementDeadline: 5000,
      myPlacement: { big: 1, small: 2 },
    })
  })

  it("placement: each player sees his own chests", () => {
    expect(formatMatchResponse(placementMatch(), "8").myPlacement).toEqual({ big: 3, small: null })
    expect(formatMatchResponse(placementMatch(), "8").opponentPlaced).toEqual({ big: true, small: true })
  })

  it("reveal: the turn, the deadline and the moves of both sides", () => {
    const match = makeMatch({
      status: "reveal",
      player2: "8",
      placement: { p1_big: 1, p1_small: 2, p2_big: 3, p2_small: 4 },
      reveal: {
        p1_move_1_zone: 4,
        p1_move_1_result: "hit_small",
        p2_move_1_zone: 1,
        p2_move_1_result: "hit_big",
      },
      turnDeadline: 9000,
      currentTurn: "7",
    })

    const response = formatMatchResponse(match, "7")

    expect(response).toMatchObject({
      status: "reveal",
      turnDeadline: 9000,
      currentTurn: "7",
      myMoves: [{ zone: 4, result: "hit_small" }],
      opponentMoves: [{ zone: 1, result: "hit_big" }],
    })
  })

  it("cancelled: shows the reason", () => {
    const response = formatMatchResponse(
      placementMatch({ status: "cancelled", cancelReason: "placement_timeout" }),
      "7",
    )

    expect(response.cancelReason).toBe("placement_timeout")
  })
})

describe("formatMatchResponse: ended", () => {
  it("shows the chests of the opponent and the moves, a skipped move stays skipped", () => {
    const response = formatMatchResponse(endedMatch(), "7")

    expect(response.opponentPlacement).toEqual({ big: 3, small: 4 })
    expect(response.opponentMoves).toEqual([
      { zone: 5, result: "miss" },
      { zone: "skipped", result: "skipped" },
    ])
    expect(response.myMoves).toEqual([
      { zone: 4, result: "hit_small" },
      { zone: 5, result: "miss" },
    ])
  })

  it("the winner of the example gets 5.90 and a profit of 0.90 after the fee", () => {
    expect(formatMatchResponse(endedMatch(), "7").settlement).toEqual({
      result: "6.00",
      netProfit: "0.90",
      fee: "0.10",
      payout: "5.90",
    })
  })

  it("the loser of the example gets 4.00, a loss of 1.00 and pays no fee", () => {
    expect(formatMatchResponse(endedMatch(), "8").settlement).toEqual({
      result: "4.00",
      netProfit: "-1.00",
      fee: "0.00",
      payout: "4.00",
    })
  })

  it("throws when the reveal data is missing, rather than inventing a result", () => {
    expect(() => formatMatchResponse({ ...endedMatch(), reveal: null }, "7")).toThrow()
  })
})
