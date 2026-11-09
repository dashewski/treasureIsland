import { MATCH_KEY_TTL } from "../constants"
import { redisClient } from "../redis/redisClient"
import { makeRevealMatch, makeStartedMatch } from "../testing/matchSetup"
import { closeRedis, resetRedis } from "../testing/resetRedis"
import { getExpiredRevealMatchIds } from "./getExpiredRevealMatchIds"
import { resolveMove } from "./resolveMove"
import { resolveRevealTimeout } from "./resolveRevealTimeout"

beforeEach(resetRedis)
afterEach(() => {
  jest.restoreAllMocks()
})
afterAll(closeRedis)

// player 7 is p1 and moves first, player 8 is p2
const revealMatch = () => makeRevealMatch(7, 11, 8, 12)

// the turn of the current player is over
async function expire(matchId: string) {
  const past = String(Date.now() - 1000)
  await redisClient.hset(`match:${matchId}`, "turnDeadline", past)
  await redisClient.zadd("reveal:matches", past, matchId)
}

async function snapshot(matchId: string) {
  return {
    match: await redisClient.hgetall(`match:${matchId}`),
    reveal: await redisClient.hgetall(`match:${matchId}:reveal`),
    revealQueue: await redisClient.zrange("reveal:matches", "0", "-1", "WITHSCORES"),
    settlementQueue: await redisClient.zrange("settlement:matches", "0", "-1"),
  }
}

describe("resolveRevealTimeout: nothing to do", () => {
  it("not_expired while there is time, and nothing changes", async () => {
    const matchId = await revealMatch()
    const before = await snapshot(matchId)

    expect(await resolveRevealTimeout(matchId)).toBe("not_expired")

    expect(await snapshot(matchId)).toEqual(before)
  })

  it("already_processed and out of the queue when the match is gone", async () => {
    const matchId = "550e8400-e29b-41d4-a716-446655440000"
    await redisClient.zadd("reveal:matches", 1, matchId)

    expect(await resolveRevealTimeout(matchId)).toBe("already_processed")

    expect(await redisClient.zcard("reveal:matches")).toBe(0)
  })

  it("already_processed and out of the queue when the match is not in reveal", async () => {
    const matchId = await makeStartedMatch(7, 11, 8, 12)
    await redisClient.zadd("reveal:matches", 1, matchId)

    expect(await resolveRevealTimeout(matchId)).toBe("already_processed")

    expect(await redisClient.zcard("reveal:matches")).toBe(0)
    expect(await redisClient.hget(`match:${matchId}`, "status")).toBe("placement")
  })

  it.each([
    ["the current player is nobody of the match", { currentTurn: "999" }, "invalid_current_turn"],
    ["the turn deadline is missing", {}, "invalid_current_turn"],
  ])("%s: %s", async (_name, fields, expected) => {
    const matchId = await revealMatch()
    if ("currentTurn" in fields) {
      await expire(matchId)
      await redisClient.hset(`match:${matchId}`, fields)
    } else {
      await redisClient.hdel(`match:${matchId}`, "turnDeadline")
    }
    const before = await snapshot(matchId)

    expect(await resolveRevealTimeout(matchId)).toBe(expected)

    expect(await snapshot(matchId)).toEqual(before)
  })

  it("no_moves_left when the current player has no moves, and the match stays in the queue", async () => {
    const matchId = await revealMatch()
    await redisClient.hset(
      `match:${matchId}:reveal`,
      "p1_move_1_zone", "5", "p1_move_1_result", "miss",
      "p1_move_2_zone", "4", "p1_move_2_result", "hit_small",
    )
    await expire(matchId)
    const before = await snapshot(matchId)

    expect(await resolveRevealTimeout(matchId)).toBe("no_moves_left")

    expect(await snapshot(matchId)).toEqual(before)
    expect(await redisClient.zcard("reveal:matches")).toBe(1)
  })
})

describe("resolveRevealTimeout: a skipped move", () => {
  it("the turn is over exactly at the deadline, one millisecond before it is not", async () => {
    const matchId = await revealMatch()
    const deadline = Number(await redisClient.hget(`match:${matchId}`, "turnDeadline"))
    const now = jest.spyOn(Date, "now")

    now.mockReturnValue(deadline - 1)
    expect(await resolveRevealTimeout(matchId)).toBe("not_expired")

    now.mockReturnValue(deadline)
    expect(await resolveRevealTimeout(matchId)).toBe("skipped")
  })

  it("writes skipped for the player whose turn it was and passes the turn", async () => {
    const matchId = await revealMatch()
    await expire(matchId)
    const versionBefore = Number(await redisClient.hget(`match:${matchId}`, "stateVersion"))

    expect(await resolveRevealTimeout(matchId)).toBe("skipped")

    expect(await redisClient.hgetall(`match:${matchId}:reveal`)).toEqual({
      p1_move_1_zone: "skipped",
      p1_move_1_result: "skipped",
    })
    const match = await redisClient.hgetall(`match:${matchId}`)
    expect(match["currentTurn"]).toBe("8")
    expect(Number(match["turnDeadline"])).toBeGreaterThan(Date.now())
    expect(Number(match["stateVersion"])).toBe(versionBefore + 1)
  })

  it("gives the reveal hash a lifetime", async () => {
    const matchId = await revealMatch()
    await expire(matchId)

    await resolveRevealTimeout(matchId)

    const ttl = await redisClient.ttl(`match:${matchId}:reveal`)
    expect(ttl).toBeGreaterThan(MATCH_KEY_TTL - 10)
    expect(ttl).toBeLessThanOrEqual(MATCH_KEY_TTL)
  })

  it("the queue entry gets the new deadline", async () => {
    const matchId = await revealMatch()
    await expire(matchId)

    await resolveRevealTimeout(matchId)

    const turnDeadline = await redisClient.hget(`match:${matchId}`, "turnDeadline")
    expect(await redisClient.zrange("reveal:matches", "0", "-1", "WITHSCORES")).toEqual([
      matchId,
      turnDeadline,
    ])
  })

  it("a skipped move uses up one of the two moves of the player", async () => {
    const matchId = await revealMatch()
    await expire(matchId)
    await resolveRevealTimeout(matchId)
    await resolveMove(matchId, "8", 5)

    expect(await resolveMove(matchId, "7", 5)).toEqual({ status: "moved", moveResult: "miss" })
    expect(await redisClient.hget(`match:${matchId}:reveal`, "p1_move_2_zone")).toBe("5")
  })

  it("two checks at the same moment: one skip, the other finds a fresh turn", async () => {
    const matchId = await revealMatch()
    await expire(matchId)

    const results = await Promise.all([resolveRevealTimeout(matchId), resolveRevealTimeout(matchId)])

    expect([...results].sort()).toEqual(["not_expired", "skipped"])
    expect(await redisClient.hlen(`match:${matchId}:reveal`)).toBe(2)
  })

  it("the skip of the last move ends the match and sends it to settlement", async () => {
    const matchId = await revealMatch()
    await resolveMove(matchId, "7", 4)
    await resolveMove(matchId, "8", 1)
    await resolveMove(matchId, "7", 5)
    await expire(matchId)

    expect(await resolveRevealTimeout(matchId)).toBe("ended")

    const match = await redisClient.hgetall(`match:${matchId}`)
    expect(match["status"]).toBe("ended")
    expect(match).not.toHaveProperty("currentTurn")
    expect(match).not.toHaveProperty("turnDeadline")
    expect(await redisClient.hget(`match:${matchId}:reveal`, "p2_move_2_result")).toBe("skipped")
    expect(await redisClient.zcard("reveal:matches")).toBe(0)
    expect(await redisClient.zrange("settlement:matches", "0", "-1")).toEqual([matchId])
  })

  it("a finished match is not processed twice", async () => {
    const matchId = await revealMatch()
    await resolveMove(matchId, "7", 4)
    await resolveMove(matchId, "8", 1)
    await resolveMove(matchId, "7", 5)
    await expire(matchId)
    await resolveRevealTimeout(matchId)

    expect(await resolveRevealTimeout(matchId)).toBe("already_processed")
  })
})

describe("getExpiredRevealMatchIds", () => {
  it("is empty when nothing is in reveal", async () => {
    expect(await getExpiredRevealMatchIds(Date.now())).toEqual([])
  })

  it("returns only the matches whose turn is over, including exactly now", async () => {
    await redisClient.zadd("reveal:matches", 1000, "expired", 2000, "exactly-now", 3000, "later")

    expect(await getExpiredRevealMatchIds(2000)).toEqual(["expired", "exactly-now"])
  })
})
