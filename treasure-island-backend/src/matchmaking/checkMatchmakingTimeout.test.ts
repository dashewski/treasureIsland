import { FINISHED_KEY_TTL, MATCHMAKING_TIMEOUT } from "../constants"
import { redisClient } from "../redis/redisClient"
import { makeStartedMatch, makeWaitingMatch } from "../testing/matchSetup"
import { closeRedis, resetRedis } from "../testing/resetRedis"
import { checkMatchmakingTimeout } from "./checkMatchmakingTimeout"
import { getWaitingMatchIds } from "./getWaitingMatchIds"

beforeEach(resetRedis)
afterEach(() => {
  jest.restoreAllMocks()
})
afterAll(closeRedis)

describe("checkMatchmakingTimeout", () => {
  it("still waiting while there is time, and changes nothing", async () => {
    const matchId = await makeWaitingMatch(7, 11)
    const before = await redisClient.hgetall(`match:${matchId}`)

    expect(await checkMatchmakingTimeout(matchId)).toEqual({ status: "still waiting" })

    expect(await redisClient.hgetall(`match:${matchId}`)).toEqual(before)
    expect(await redisClient.zcard("waiting:matches")).toBe(1)
    expect(await redisClient.get("player:7:currentMatch")).toBe(matchId)
  })

  it("cancels exactly at the timeout, one millisecond before it the match lives", async () => {
    const matchId = await makeWaitingMatch(7, 11)
    const createdAt = Number(await redisClient.hget(`match:${matchId}`, "createdAt"))
    const now = jest.spyOn(Date, "now")

    now.mockReturnValue(createdAt + MATCHMAKING_TIMEOUT * 1000 - 1)
    expect(await checkMatchmakingTimeout(matchId)).toEqual({ status: "still waiting" })

    now.mockReturnValue(createdAt + MATCHMAKING_TIMEOUT * 1000)
    expect(await checkMatchmakingTimeout(matchId)).toEqual({ status: "cancelled", player1HoldId: 11 })
  })

  it("after the cancel: status, reason, no pointer, out of the queue, short lifetime", async () => {
    const matchId = await makeWaitingMatch(7, 11)
    await redisClient.hset(`match:${matchId}`, "createdAt", String(Date.now() - 100_000))

    await checkMatchmakingTimeout(matchId)

    expect(await redisClient.hgetall(`match:${matchId}`)).toMatchObject({
      status: "cancelled",
      cancelReason: "matchmaking_timeout",
      stateVersion: "1",
    })
    expect(await redisClient.exists("player:7:currentMatch")).toBe(0)
    expect(await getWaitingMatchIds()).toEqual([])
    expect(await redisClient.ttl(`match:${matchId}`)).toBeLessThanOrEqual(FINISHED_KEY_TTL)
  })

  it("a second call gives no hold again", async () => {
    const matchId = await makeWaitingMatch(7, 11)
    await redisClient.hset(`match:${matchId}`, "createdAt", String(Date.now() - 100_000))
    await checkMatchmakingTimeout(matchId)

    expect(await checkMatchmakingTimeout(matchId)).toEqual({ status: "already processed" })
  })

  it("already processed and out of the queue when the match is gone", async () => {
    const matchId = "550e8400-e29b-41d4-a716-446655440000"
    await redisClient.zadd("waiting:matches", 1, matchId)

    expect(await checkMatchmakingTimeout(matchId)).toEqual({ status: "already processed" })

    expect(await redisClient.zcard("waiting:matches")).toBe(0)
  })

  it("does not cancel a match where the second player has already joined", async () => {
    const matchId = await makeStartedMatch(7, 11, 8, 12)
    await redisClient.hset(`match:${matchId}`, "createdAt", String(Date.now() - 100_000))

    expect(await checkMatchmakingTimeout(matchId)).toEqual({ status: "already processed" })

    expect(await redisClient.hget(`match:${matchId}`, "status")).toBe("placement")
    expect(await redisClient.get("player:8:currentMatch")).toBe(matchId)
  })
})

describe("getWaitingMatchIds", () => {
  it("lists the waiting matches", async () => {
    expect(await getWaitingMatchIds()).toEqual([])
    const matchId = await makeWaitingMatch(7, 11)
    expect(await getWaitingMatchIds()).toEqual([matchId])
  })
})
