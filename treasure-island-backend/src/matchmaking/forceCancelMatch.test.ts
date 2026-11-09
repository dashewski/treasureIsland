import { FINISHED_KEY_TTL } from "../constants"
import { redisClient } from "../redis/redisClient"
import { makeStartedMatch, makeWaitingMatch } from "../testing/matchSetup"
import { closeRedis, resetRedis } from "../testing/resetRedis"
import { forceCancelMatch } from "./forceCancelMatch"

beforeEach(resetRedis)
afterAll(closeRedis)

describe("forceCancelMatch", () => {
  it("marks a joined match as cancelled with a reason and bumps the version", async () => {
    const matchId = await makeStartedMatch(7, 11, 8, 12)

    expect(await forceCancelMatch(matchId, 8)).toBe(true)

    expect(await redisClient.hgetall(`match:${matchId}`)).toMatchObject({
      status: "cancelled",
      cancelReason: "internal_error",
      stateVersion: "2",
    })
  })

  it("shortens the life of the match key to the finished-match lifetime", async () => {
    const matchId = await makeStartedMatch(7, 11, 8, 12)

    await forceCancelMatch(matchId, 8)

    const ttl = await redisClient.ttl(`match:${matchId}`)
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(FINISHED_KEY_TTL)
  })

  it("removes the match from both queues and deletes the placement hash", async () => {
    const matchId = await makeStartedMatch(7, 11, 8, 12)
    await redisClient.hset(`match:${matchId}:placement`, "p1_big", "2")

    await forceCancelMatch(matchId, 8)

    expect(await redisClient.zcard("waiting:matches")).toBe(0)
    expect(await redisClient.zcard("placement:matches")).toBe(0)
    expect(await redisClient.exists(`match:${matchId}:placement`)).toBe(0)
  })

  it("frees both players: their pointers are gone", async () => {
    const matchId = await makeStartedMatch(7, 11, 8, 12)

    await forceCancelMatch(matchId, 8)

    expect(await redisClient.exists("player:7:currentMatch", "player:8:currentMatch")).toBe(0)
  })

  it("cancels a match that nobody joined and takes it out of the waiting queue", async () => {
    const matchId = await makeWaitingMatch(7, 11)

    expect(await forceCancelMatch(matchId, 8)).toBe(true)

    expect(await redisClient.hget(`match:${matchId}`, "status")).toBe("cancelled")
    expect(await redisClient.zcard("waiting:matches")).toBe(0)
    expect(await redisClient.exists("player:7:currentMatch")).toBe(0)
  })

  it("returns false and creates nothing when the match does not exist", async () => {
    expect(await forceCancelMatch("550e8400-e29b-41d4-a716-446655440000", 8)).toBe(false)

    expect(await redisClient.dbsize()).toBe(0)
  })

  it.each(["cancelled", "ended"])("changes nothing in a match that is already %s", async (status) => {
    const matchId = await makeStartedMatch(7, 11, 8, 12)
    await redisClient.hset(`match:${matchId}`, "status", status)
    const before = await redisClient.hgetall(`match:${matchId}`)

    expect(await forceCancelMatch(matchId, 8)).toBe(true)

    expect(await redisClient.hgetall(`match:${matchId}`)).toEqual(before)
    expect(await redisClient.ttl(`match:${matchId}`)).toBeGreaterThan(FINISHED_KEY_TTL)
  })

  it("is safe to call twice", async () => {
    const matchId = await makeStartedMatch(7, 11, 8, 12)
    await forceCancelMatch(matchId, 8)
    const before = await redisClient.hgetall(`match:${matchId}`)

    expect(await forceCancelMatch(matchId, 8)).toBe(true)

    expect(await redisClient.hgetall(`match:${matchId}`)).toEqual(before)
  })
})
