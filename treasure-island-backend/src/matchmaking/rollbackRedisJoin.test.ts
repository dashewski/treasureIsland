import { redisClient } from "../redis/redisClient"
import { joinToken, makeStartedMatch, makeWaitingMatch, reserveForJoin } from "../testing/matchSetup"
import { closeRedis, resetRedis } from "../testing/resetRedis"
import { redisJoinWaitingMatch } from "./redisJoinWaitingMatch"
import { rollbackRedisJoin } from "./rollbackRedisJoin"

beforeEach(resetRedis)
afterAll(closeRedis)

// everything in Redis that a rollback could touch, to compare before and after
async function snapshot(matchId: string) {
  return {
    match: await redisClient.hgetall(`match:${matchId}`),
    waiting: await redisClient.zrange("waiting:matches", "0", "-1", "WITHSCORES"),
    placementQueue: await redisClient.zrange("placement:matches", "0", "-1", "WITHSCORES"),
    pointers: [
      await redisClient.get("player:7:currentMatch"),
      await redisClient.get("player:8:currentMatch"),
    ],
    keys: (await redisClient.keys("*")).sort(),
  }
}

describe("rollbackRedisJoin", () => {
  it("puts a joined match back to waiting and removes everything the second player added", async () => {
    const matchId = await makeStartedMatch(7, 11, 8, 12)
    const createdAt = (await redisClient.hget(`match:${matchId}`, "createdAt")) as string

    expect(await rollbackRedisJoin(matchId, 8)).toBe("ok")

    expect(await redisClient.hgetall(`match:${matchId}`)).toEqual({
      matchId,
      status: "waiting",
      player1: "7",
      player1HoldId: "11",
      bid: "5",
      bigAmount: "4",
      smallAmount: "1",
      createdAt,
      updatedAt: expect.stringMatching(/^\d+$/),
      stateVersion: "2",
    })
  })

  it("returns the match to the waiting queue with its old score and leaves the placement queue", async () => {
    const matchId = await makeStartedMatch(7, 11, 8, 12)
    const createdAt = (await redisClient.hget(`match:${matchId}`, "createdAt")) as string

    await rollbackRedisJoin(matchId, 8)

    expect(await redisClient.zrange("waiting:matches", "0", "-1", "WITHSCORES")).toEqual([matchId, createdAt])
    expect(await redisClient.zcard("placement:matches")).toBe(0)
  })

  it("removes the pointer of the second player and keeps the pointer of the creator", async () => {
    const matchId = await makeStartedMatch(7, 11, 8, 12)

    await rollbackRedisJoin(matchId, 8)

    expect(await redisClient.exists("player:8:currentMatch")).toBe(0)
    expect(await redisClient.get("player:7:currentMatch")).toBe(matchId)
  })

  it("lets another player join the match afterwards", async () => {
    const matchId = await makeStartedMatch(7, 11, 8, 12)
    await rollbackRedisJoin(matchId, 8)

    await reserveForJoin(matchId)
    const joined = await redisJoinWaitingMatch(9, 13, matchId, joinToken)

    expect(joined).toBe(matchId)
    expect(await redisClient.hget(`match:${matchId}`, "player2")).toBe("9")
  })

  it("does not roll back twice: the second call changes nothing", async () => {
    const matchId = await makeStartedMatch(7, 11, 8, 12)
    await rollbackRedisJoin(matchId, 8)
    const before = await snapshot(matchId)

    expect(await rollbackRedisJoin(matchId, 8)).toBe("not_rollbackable")

    expect(await snapshot(matchId)).toEqual(before)
  })

  it("refuses when the game has started (a placement hash exists) and changes nothing", async () => {
    const matchId = await makeStartedMatch(7, 11, 8, 12)
    await redisClient.hset(`match:${matchId}:placement`, "p1_big", "2")
    const before = await snapshot(matchId)

    expect(await rollbackRedisJoin(matchId, 8)).toBe("not_rollbackable")

    expect(await snapshot(matchId)).toEqual(before)
    expect(await redisClient.hget(`match:${matchId}:placement`, "p1_big")).toBe("2")
  })

  it("refuses to roll back for a player who is not the second player and changes nothing", async () => {
    const matchId = await makeStartedMatch(7, 11, 8, 12)
    const before = await snapshot(matchId)

    expect(await rollbackRedisJoin(matchId, 99)).toBe("not_rollbackable")

    expect(await snapshot(matchId)).toEqual(before)
  })

  it("refuses when nobody has joined yet", async () => {
    const matchId = await makeWaitingMatch(7, 11)
    const before = await snapshot(matchId)

    expect(await rollbackRedisJoin(matchId, 8)).toBe("not_rollbackable")

    expect(await snapshot(matchId)).toEqual(before)
  })

  it("refuses when the status is no longer placement", async () => {
    const matchId = await makeStartedMatch(7, 11, 8, 12)
    await redisClient.hset(`match:${matchId}`, "status", "cancelled")

    expect(await rollbackRedisJoin(matchId, 8)).toBe("not_rollbackable")

    expect(await redisClient.hget(`match:${matchId}`, "status")).toBe("cancelled")
  })

  it("refuses for a match that does not exist and creates nothing", async () => {
    expect(await rollbackRedisJoin("550e8400-e29b-41d4-a716-446655440000", 8)).toBe("not_rollbackable")

    expect(await redisClient.dbsize()).toBe(0)
  })
})
