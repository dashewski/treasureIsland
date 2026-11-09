import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors"
import { formatMatchResponse } from "../matchmaking/formatMatchResponse"
import { loadMatch } from "../matchmaking/loadMatch"
import { redisClient } from "../redis/redisClient"
import * as settleModule from "../settlement/settleMatch"
import { makeRevealMatch, makeStartedMatch } from "../testing/matchSetup"
import { closeRedis, resetRedis } from "../testing/resetRedis"
import { makeMove } from "./makeMove"

let settleMatch: jest.SpyInstance

beforeEach(async () => {
  await resetRedis()
  // the real settlement is a separate piece of work, here we only check that it is asked for
  settleMatch = jest.spyOn(settleModule, "settleMatch").mockResolvedValue(undefined)
  jest.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
})

afterAll(closeRedis)

// player "7" is p1 and moves first, player "8" is p2
// chests: p1 big 1, p1 small 2, p2 big 3, p2 small 4
const revealMatch = () => makeRevealMatch(7, 11, 8, 12)

async function expire(matchId: string) {
  const past = String(Date.now() - 1000)
  await redisClient.hset(`match:${matchId}`, "turnDeadline", past)
  await redisClient.zadd("reveal:matches", past, matchId)
}

describe("makeMove: who and what", () => {
  it("rejects a matchId that is not a UUID", async () => {
    await expect(makeMove("current", "7", 3)).rejects.toThrow("invalid match id")
  })

  it("not found for an unknown match", async () => {
    await expect(makeMove("550e8400-e29b-41d4-a716-446655440000", "7", 3)).rejects.toThrow(NotFoundError)
  })

  it("forbidden for a stranger", async () => {
    const matchId = await revealMatch()

    await expect(makeMove(matchId, "99", 3)).rejects.toThrow(ForbiddenError)
  })

  it("conflict while the match is still in placement", async () => {
    const matchId = await makeStartedMatch(7, 11, 8, 12)

    await expect(makeMove(matchId, "7", 3)).rejects.toThrow("not in reveal phase")
  })

  it("conflict when it is not the turn of the player", async () => {
    const matchId = await revealMatch()

    await expect(makeMove(matchId, "8", 1)).rejects.toThrow("not your turn")
    await expect(makeMove(matchId, "8", 1)).rejects.toThrow(ConflictError)
  })

  it.each([0, 6, 2.5, "3", null])("validation error for the zone %p, nothing written", async (zone) => {
    const matchId = await revealMatch()

    await expect(makeMove(matchId, "7", zone)).rejects.toThrow(ValidationError)
    expect(await redisClient.exists(`match:${matchId}:reveal`)).toBe(0)
  })

  it("conflict when the same zone is opened twice", async () => {
    const matchId = await revealMatch()
    await makeMove(matchId, "7", 5)
    await makeMove(matchId, "8", 5)

    await expect(makeMove(matchId, "7", 5)).rejects.toThrow("zone already opened")
  })
})

describe("makeMove: a normal move", () => {
  it("returns my move and the turn of the opponent, nothing about his chests", async () => {
    const matchId = await revealMatch()

    const response = await makeMove(matchId, "7", 3)

    expect(response).toMatchObject({
      status: "reveal",
      currentTurn: "8",
      myMoves: [{ zone: 3, result: "hit_big" }],
      opponentMoves: [],
      myPlacement: { big: 1, small: 2 },
    })
    expect(response).not.toHaveProperty("opponentPlacement")
    expect(JSON.stringify(response)).not.toContain("HoldId")
  })

  it("the opponent sees the move on his own field", async () => {
    const matchId = await revealMatch()
    await makeMove(matchId, "7", 3)

    const response = await makeMove(matchId, "8", 1)

    expect(response.opponentMoves).toEqual([{ zone: 3, result: "hit_big" }])
    expect(response.myMoves).toEqual([{ zone: 1, result: "hit_big" }])
    expect(settleMatch).not.toHaveBeenCalled()
  })
})

describe("makeMove: the last move", () => {
  async function playThreeMoves() {
    const matchId = await revealMatch()
    await makeMove(matchId, "7", 4)
    await makeMove(matchId, "8", 1)
    await makeMove(matchId, "7", 5)
    return matchId
  }

  it("ends the match, asks for the settlement once and shows the result with the chests", async () => {
    const matchId = await playThreeMoves()

    const response = await makeMove(matchId, "8", 2)

    expect(settleMatch).toHaveBeenCalledTimes(1)
    expect(settleMatch).toHaveBeenCalledWith(matchId)
    expect(response.status).toBe("ended")
    expect(response.opponentPlacement).toEqual({ big: 1, small: 2 })
    // player 8 found both chests (4 and 1), player 7 found only the small one (1)
    expect(response.settlement).toEqual({
      result: "9.00",
      netProfit: "3.60",
      fee: "0.40",
      payout: "8.60",
    })
  })

  it("the loser sees his own result of the same match, no fee", async () => {
    const matchId = await playThreeMoves()
    await makeMove(matchId, "8", 2)

    const match = await loadMatch(matchId)

    expect(formatMatchResponse(match!, "7").settlement).toEqual({
      result: "1.00",
      netProfit: "-4.00",
      fee: "0.00",
      payout: "1.00",
    })
  })

  it("a failing settlement does not break the answer: the move is written, the worker retries", async () => {
    const matchId = await playThreeMoves()
    settleMatch.mockRejectedValue(new Error("database is down"))

    const response = await makeMove(matchId, "8", 2)

    expect(response.status).toBe("ended")
    expect(await redisClient.zrange("settlement:matches", "0", "-1")).toEqual([matchId])
  })

  it("no more moves after the end", async () => {
    const matchId = await playThreeMoves()
    await makeMove(matchId, "8", 2)

    await expect(makeMove(matchId, "7", 3)).rejects.toThrow("not in reveal phase")
  })
})

describe("makeMove: the turn is over", () => {
  it("my own turn expired: the move is counted as skipped and the player is told", async () => {
    const matchId = await revealMatch()
    await expire(matchId)

    await expect(makeMove(matchId, "7", 3)).rejects.toThrow("turn expired")

    expect(await redisClient.hget(`match:${matchId}:reveal`, "p1_move_1_result")).toBe("skipped")
    expect(await redisClient.hget(`match:${matchId}`, "currentTurn")).toBe("8")
  })

  it("the opponent's turn expired: it is skipped and my move goes through", async () => {
    const matchId = await revealMatch()
    await expire(matchId)

    const response = await makeMove(matchId, "8", 1)

    expect(response.myMoves).toEqual([{ zone: 1, result: "hit_big" }])
    expect(response.opponentMoves).toEqual([{ zone: "skipped", result: "skipped" }])
  })

  it("the skip that ends the match asks for the settlement", async () => {
    const matchId = await revealMatch()
    await makeMove(matchId, "7", 4)
    await makeMove(matchId, "8", 1)
    await makeMove(matchId, "7", 5)
    await expire(matchId)

    await expect(makeMove(matchId, "8", 2)).rejects.toThrow("turn expired")

    expect(settleMatch).toHaveBeenCalledWith(matchId)
    expect(await redisClient.hget(`match:${matchId}`, "status")).toBe("ended")
  })

  it("the opponent's skip that ends the match: the late player is told that the match ended", async () => {
    const matchId = await revealMatch()
    await makeMove(matchId, "7", 4)
    await makeMove(matchId, "8", 1)
    await makeMove(matchId, "7", 5)
    await expire(matchId)

    await expect(makeMove(matchId, "7", 3)).rejects.toThrow("match ended")

    expect(settleMatch).toHaveBeenCalledWith(matchId)
  })
})
