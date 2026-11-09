import { MATCH_KEY_TTL, TURN_TIMEOUT } from "../constants"
import { redisClient } from "../redis/redisClient"
import { makeRevealMatch, makeStartedMatch } from "../testing/matchSetup"
import { closeRedis, resetRedis } from "../testing/resetRedis"
import { resolveMove } from "./resolveMove"

beforeEach(resetRedis)
afterEach(() => {
  jest.restoreAllMocks()
})
afterAll(closeRedis)

// player 7 is p1 and moves first, player 8 is p2
// chests: p1 big 1, p1 small 2, p2 big 3, p2 small 4
const revealMatch = () => makeRevealMatch(7, 11, 8, 12)

// everything a refused move could touch, to compare before and after
async function snapshot(matchId: string) {
  return {
    match: await redisClient.hgetall(`match:${matchId}`),
    reveal: await redisClient.hgetall(`match:${matchId}:reveal`),
    revealQueue: await redisClient.zrange("reveal:matches", "0", "-1", "WITHSCORES"),
    settlementQueue: await redisClient.zrange("settlement:matches", "0", "-1"),
  }
}

describe("resolveMove: refusals change nothing", () => {
  it("not_in_reveal while the match is still in placement", async () => {
    const matchId = await makeStartedMatch(7, 11, 8, 12)
    const before = await snapshot(matchId)

    expect(await resolveMove(matchId, "7", 3)).toEqual({ status: "not_in_reveal" })

    expect(await snapshot(matchId)).toEqual(before)
  })

  it("not_in_reveal when the match does not exist, and nothing is created", async () => {
    expect(await resolveMove("550e8400-e29b-41d4-a716-446655440000", "7", 3)).toEqual({
      status: "not_in_reveal",
    })
    expect(await redisClient.dbsize()).toBe(0)
  })

  it("not_a_participant for a stranger", async () => {
    const matchId = await revealMatch()
    const before = await snapshot(matchId)

    expect(await resolveMove(matchId, "99", 3)).toEqual({ status: "not_a_participant" })

    expect(await snapshot(matchId)).toEqual(before)
  })

  it("not_your_turn for the second player at the start", async () => {
    const matchId = await revealMatch()
    const before = await snapshot(matchId)

    expect(await resolveMove(matchId, "8", 1)).toEqual({ status: "not_your_turn" })

    expect(await snapshot(matchId)).toEqual(before)
  })

  it("turn_expired once the turn deadline has come, even exactly at it", async () => {
    const matchId = await revealMatch()
    const deadline = Number(await redisClient.hget(`match:${matchId}`, "turnDeadline"))
    const before = await snapshot(matchId)
    jest.spyOn(Date, "now").mockReturnValue(deadline)

    expect(await resolveMove(matchId, "7", 3)).toEqual({ status: "turn_expired" })

    expect(await snapshot(matchId)).toEqual(before)
  })

  it("zone_already_opened when the player opens the same zone twice", async () => {
    const matchId = await revealMatch()
    await resolveMove(matchId, "7", 5)
    await resolveMove(matchId, "8", 5)
    const before = await snapshot(matchId)

    expect(await resolveMove(matchId, "7", 5)).toEqual({ status: "zone_already_opened" })

    expect(await snapshot(matchId)).toEqual(before)
  })

  it("no_moves_left when both moves of the player are already written", async () => {
    const matchId = await revealMatch()
    await redisClient.hset(
      `match:${matchId}:reveal`,
      "p1_move_1_zone", "5", "p1_move_1_result", "miss",
      "p1_move_2_zone", "4", "p1_move_2_result", "hit_small",
    )
    const before = await snapshot(matchId)

    expect(await resolveMove(matchId, "7", 3)).toEqual({ status: "no_moves_left" })

    expect(await snapshot(matchId)).toEqual(before)
  })
})

describe("resolveMove: what the move finds", () => {
  it.each([
    ["the big chest of the opponent", 3, "hit_big"],
    ["the small chest of the opponent", 4, "hit_small"],
    ["an empty zone", 5, "miss"],
    ["the own chest, which does not count", 1, "miss"],
  ])("player1 opens %s", async (_name, zone, expected) => {
    const matchId = await revealMatch()

    expect(await resolveMove(matchId, "7", zone)).toEqual({ status: "moved", moveResult: expected })
  })

  it("player2 is checked against the chests of player1", async () => {
    const matchId = await revealMatch()
    await resolveMove(matchId, "7", 5)

    expect(await resolveMove(matchId, "8", 1)).toEqual({ status: "moved", moveResult: "hit_big" })
  })
})

describe("resolveMove: a normal move", () => {
  it("writes the zone and the result into the reveal hash with a lifetime", async () => {
    const matchId = await revealMatch()

    await resolveMove(matchId, "7", 3)

    expect(await redisClient.hgetall(`match:${matchId}:reveal`)).toEqual({
      p1_move_1_zone: "3",
      p1_move_1_result: "hit_big",
    })
    const ttl = await redisClient.ttl(`match:${matchId}:reveal`)
    expect(ttl).toBeGreaterThan(MATCH_KEY_TTL - 10)
    expect(ttl).toBeLessThanOrEqual(MATCH_KEY_TTL)
  })

  it("passes the turn to the opponent with a fresh deadline and bumps the version", async () => {
    const matchId = await revealMatch()
    const versionBefore = Number(await redisClient.hget(`match:${matchId}`, "stateVersion"))
    const before = Date.now()

    await resolveMove(matchId, "7", 3)

    const after = Date.now()
    const match = await redisClient.hgetall(`match:${matchId}`)
    expect(match["status"]).toBe("reveal")
    expect(match["currentTurn"]).toBe("8")
    expect(Number(match["turnDeadline"])).toBeGreaterThanOrEqual(before + TURN_TIMEOUT * 1000)
    expect(Number(match["turnDeadline"])).toBeLessThanOrEqual(after + TURN_TIMEOUT * 1000)
    expect(Number(match["stateVersion"])).toBe(versionBefore + 1)
  })

  it("moves the match in the reveal queue to the new deadline", async () => {
    const matchId = await revealMatch()

    await resolveMove(matchId, "7", 3)

    const turnDeadline = await redisClient.hget(`match:${matchId}`, "turnDeadline")
    expect(await redisClient.zrange("reveal:matches", "0", "-1", "WITHSCORES")).toEqual([
      matchId,
      turnDeadline,
    ])
  })

  it("the turns go p1, p2, p1, p2", async () => {
    const matchId = await revealMatch()
    const order: (string | null)[] = []

    for (const [player, zone] of [["7", 5], ["8", 5], ["7", 4], ["8", 3]] as const) {
      order.push(await redisClient.hget(`match:${matchId}`, "currentTurn"))
      await resolveMove(matchId, player, zone)
    }

    expect(order).toEqual(["7", "8", "7", "8"])
  })

  it("the same move asked twice at once: one moved, one not_your_turn", async () => {
    const matchId = await revealMatch()

    const results = await Promise.all([resolveMove(matchId, "7", 3), resolveMove(matchId, "7", 4)])

    expect(results.map((r) => r.status).sort()).toEqual(["moved", "not_your_turn"])
    expect(await redisClient.hlen(`match:${matchId}:reveal`)).toBe(2)
  })
})

describe("resolveMove: the fourth move ends the match", () => {
  async function playThreeMoves() {
    const matchId = await revealMatch()
    await resolveMove(matchId, "7", 4)
    await resolveMove(matchId, "8", 1)
    await resolveMove(matchId, "7", 5)
    return matchId
  }

  it("ended: status, no turn fields, version bumped", async () => {
    const matchId = await playThreeMoves()
    const versionBefore = Number(await redisClient.hget(`match:${matchId}`, "stateVersion"))

    expect(await resolveMove(matchId, "8", 2)).toEqual({ status: "ended", moveResult: "hit_small" })

    const match = await redisClient.hgetall(`match:${matchId}`)
    expect(match["status"]).toBe("ended")
    expect(match).not.toHaveProperty("currentTurn")
    expect(match).not.toHaveProperty("turnDeadline")
    expect(Number(match["stateVersion"])).toBe(versionBefore + 1)
    expect(await redisClient.hlen(`match:${matchId}:reveal`)).toBe(8)
  })

  it("leaves the reveal queue and enters the settlement queue", async () => {
    const matchId = await playThreeMoves()
    const before = Date.now()

    await resolveMove(matchId, "8", 2)

    expect(await redisClient.zcard("reveal:matches")).toBe(0)
    expect(await redisClient.zrange("settlement:matches", "0", "-1")).toEqual([matchId])
    expect(Number(await redisClient.zscore("settlement:matches", matchId))).toBeGreaterThanOrEqual(before)
  })

  it("the finished match accepts no more moves", async () => {
    const matchId = await playThreeMoves()
    await resolveMove(matchId, "8", 2)

    expect(await resolveMove(matchId, "7", 3)).toEqual({ status: "not_in_reveal" })
  })
})
