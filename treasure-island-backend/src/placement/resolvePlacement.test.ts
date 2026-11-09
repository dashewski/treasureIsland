import { MATCH_KEY_TTL, TURN_TIMEOUT } from "../constants"
import { redisClient } from "../redis/redisClient"
import { makeStartedMatch, makeWaitingMatch } from "../testing/matchSetup"
import { closeRedis, resetRedis } from "../testing/resetRedis"
import { resolvePlacement } from "./resolvePlacement"

beforeEach(resetRedis)
afterEach(() => {
  jest.restoreAllMocks()
})
afterAll(closeRedis)

// a match in the placement phase: creator 7, second player 8
const startedMatch = () => makeStartedMatch(7, 11, 8, 12)

async function placeAll(matchId: string, except?: string) {
  const chests: [Parameters<typeof resolvePlacement>[1], Parameters<typeof resolvePlacement>[2], number][] = [
    ["p1", "big", 1],
    ["p1", "small", 2],
    ["p2", "big", 3],
    ["p2", "small", 4],
  ]
  for (const [slot, type, zone] of chests) {
    if (`${slot}_${type}` !== except) await resolvePlacement(matchId, slot, type, zone)
  }
}

describe("resolvePlacement: refusals change nothing", () => {
  it("not_in_placement when the match is not in the placement phase", async () => {
    const matchId = await makeWaitingMatch(7, 11)
    const before = await redisClient.hgetall(`match:${matchId}`)

    expect(await resolvePlacement(matchId, "p1", "big", 3)).toBe("not_in_placement")

    expect(await redisClient.hgetall(`match:${matchId}`)).toEqual(before)
    expect(await redisClient.exists(`match:${matchId}:placement`)).toBe(0)
  })

  it("not_in_placement when the match does not exist", async () => {
    expect(await resolvePlacement("550e8400-e29b-41d4-a716-446655440000", "p1", "big", 3)).toBe(
      "not_in_placement",
    )
    expect(await redisClient.dbsize()).toBe(0)
  })

  it("placement_timeout after the deadline", async () => {
    const matchId = await startedMatch()
    const deadline = Number(await redisClient.hget(`match:${matchId}`, "placementDeadline"))
    jest.spyOn(Date, "now").mockReturnValue(deadline + 1)

    expect(await resolvePlacement(matchId, "p1", "big", 3)).toBe("placement_timeout")

    expect(await redisClient.exists(`match:${matchId}:placement`)).toBe(0)
  })

  it("exactly at the deadline is still allowed", async () => {
    const matchId = await startedMatch()
    const deadline = Number(await redisClient.hget(`match:${matchId}`, "placementDeadline"))
    jest.spyOn(Date, "now").mockReturnValue(deadline)

    expect(await resolvePlacement(matchId, "p1", "big", 3)).toBe("placed")
  })

  it("zone_already_used when the other chest of the player is in that zone", async () => {
    const matchId = await startedMatch()
    await resolvePlacement(matchId, "p1", "small", 3)
    const before = await redisClient.hgetall(`match:${matchId}`)

    expect(await resolvePlacement(matchId, "p1", "big", 3)).toBe("zone_already_used")

    expect(await redisClient.hgetall(`match:${matchId}:placement`)).toEqual({ p1_small: "3" })
    expect(await redisClient.hgetall(`match:${matchId}`)).toEqual(before)
  })

  it("already_placed keeps the first zone and does not change the match", async () => {
    const matchId = await startedMatch()
    await resolvePlacement(matchId, "p1", "big", 3)
    const before = await redisClient.hgetall(`match:${matchId}`)

    expect(await resolvePlacement(matchId, "p1", "big", 5)).toBe("already_placed")

    expect(await redisClient.hget(`match:${matchId}:placement`, "p1_big")).toBe("3")
    expect(await redisClient.hgetall(`match:${matchId}`)).toEqual(before)
  })
})

describe("resolvePlacement: placing a chest", () => {
  it("placed: writes the chest, keeps the match in placement, bumps the version", async () => {
    const matchId = await startedMatch()

    expect(await resolvePlacement(matchId, "p1", "big", 3)).toBe("placed")

    expect(await redisClient.hgetall(`match:${matchId}:placement`)).toEqual({ p1_big: "3" })
    const match = await redisClient.hgetall(`match:${matchId}`)
    expect(match["status"]).toBe("placement")
    expect(match["stateVersion"]).toBe("2")
    expect(await redisClient.zscore("placement:matches", matchId)).not.toBeNull()
  })

  it("gives the placement hash a lifetime", async () => {
    const matchId = await startedMatch()

    await resolvePlacement(matchId, "p1", "big", 3)

    const ttl = await redisClient.ttl(`match:${matchId}:placement`)
    expect(ttl).toBeGreaterThan(MATCH_KEY_TTL - 10)
    expect(ttl).toBeLessThanOrEqual(MATCH_KEY_TTL)
  })

  it("two players may use the same zone, one player may not use it twice", async () => {
    const matchId = await startedMatch()

    expect(await resolvePlacement(matchId, "p1", "big", 3)).toBe("placed")
    expect(await resolvePlacement(matchId, "p2", "big", 3)).toBe("placed")
    expect(await resolvePlacement(matchId, "p1", "small", 3)).toBe("zone_already_used")
  })

  it("the same chest twice at the same moment: one placed, one already_placed", async () => {
    const matchId = await startedMatch()

    const results = await Promise.all([
      resolvePlacement(matchId, "p1", "big", 1),
      resolvePlacement(matchId, "p1", "big", 2),
    ])

    expect([...results].sort()).toEqual(["already_placed", "placed"])
    expect(await redisClient.hget(`match:${matchId}`, "stateVersion")).toBe("2")
  })
})

describe("resolvePlacement: the fourth chest starts reveal", () => {
  it("completed: status reveal, the first turn is player1, a fresh turn deadline", async () => {
    const matchId = await startedMatch()
    await placeAll(matchId, "p2_small")
    const before = Date.now()

    expect(await resolvePlacement(matchId, "p2", "small", 4)).toBe("completed")

    const after = Date.now()
    const match = await redisClient.hgetall(`match:${matchId}`)
    expect(match).toMatchObject({ status: "reveal", currentTurn: "7", stateVersion: "5" })
    expect(Number(match["turnDeadline"])).toBeGreaterThanOrEqual(before + TURN_TIMEOUT * 1000)
    expect(Number(match["turnDeadline"])).toBeLessThanOrEqual(after + TURN_TIMEOUT * 1000)
    expect(await redisClient.hlen(`match:${matchId}:placement`)).toBe(4)
  })

  it("the match moves from the placement queue to the reveal queue, scored by the turn deadline", async () => {
    const matchId = await startedMatch()
    await placeAll(matchId)

    const turnDeadline = await redisClient.hget(`match:${matchId}`, "turnDeadline")
    expect(await redisClient.zcard("placement:matches")).toBe(0)
    expect(await redisClient.zrange("reveal:matches", "0", "-1", "WITHSCORES")).toEqual([
      matchId,
      turnDeadline,
    ])
  })

  it("after reveal has started no more chests are accepted", async () => {
    const matchId = await startedMatch()
    await placeAll(matchId)

    expect(await resolvePlacement(matchId, "p1", "big", 5)).toBe("not_in_placement")
  })

  it("the last chest asked twice at once: exactly one completed, the other is late", async () => {
    const matchId = await startedMatch()
    await placeAll(matchId, "p2_small")

    const results = await Promise.all([
      resolvePlacement(matchId, "p2", "small", 4),
      resolvePlacement(matchId, "p2", "small", 5),
    ])

    expect([...results].sort()).toEqual(["completed", "not_in_placement"])
    expect(await redisClient.zcard("reveal:matches")).toBe(1)
  })
})
