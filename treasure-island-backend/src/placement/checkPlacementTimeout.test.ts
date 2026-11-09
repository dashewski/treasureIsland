import { FINISHED_KEY_TTL } from "../constants"
import { redisClient } from "../redis/redisClient"
import { makeStartedMatch, makeWaitingMatch } from "../testing/matchSetup"
import { closeRedis, resetRedis } from "../testing/resetRedis"
import { checkPlacementTimeout } from "./checkPlacementTimeout"
import { getPlacementMatchIds } from "./getPlacementMatchIds"
import { resolvePlacement } from "./resolvePlacement"

beforeEach(resetRedis)
afterEach(() => {
  jest.restoreAllMocks()
})
afterAll(closeRedis)

async function expiredPlacementMatch() {
  const matchId = await makeStartedMatch(7, 11, 8, 12)
  await redisClient.hset(`match:${matchId}`, "placementDeadline", String(Date.now() - 1000))
  return matchId
}

describe("checkPlacementTimeout", () => {
  it("still placement while there is time, and changes nothing", async () => {
    const matchId = await makeStartedMatch(7, 11, 8, 12)
    const before = await redisClient.hgetall(`match:${matchId}`)

    expect(await checkPlacementTimeout(matchId)).toEqual({ status: "still placement" })

    expect(await redisClient.hgetall(`match:${matchId}`)).toEqual(before)
    expect(await redisClient.zcard("placement:matches")).toBe(1)
  })

  it("the time is over only after the deadline: exactly at it the match is still alive", async () => {
    const matchId = await makeStartedMatch(7, 11, 8, 12)
    const deadline = Number(await redisClient.hget(`match:${matchId}`, "placementDeadline"))
    const now = jest.spyOn(Date, "now")

    now.mockReturnValue(deadline)
    expect(await checkPlacementTimeout(matchId)).toEqual({ status: "still placement" })

    now.mockReturnValue(deadline + 1)
    expect(await checkPlacementTimeout(matchId)).toMatchObject({ status: "cancelled" })
  })

  it("cancels an expired match and returns both holds for the caller to release", async () => {
    const matchId = await expiredPlacementMatch()

    expect(await checkPlacementTimeout(matchId)).toEqual({
      status: "cancelled",
      player1HoldId: 11,
      player2HoldId: 12,
    })

    expect(await redisClient.hgetall(`match:${matchId}`)).toMatchObject({
      status: "cancelled",
      cancelReason: "placement_timeout",
      stateVersion: "2",
    })
  })

  it("after the cancel: out of the queue, no pointers, a short lifetime", async () => {
    const matchId = await expiredPlacementMatch()

    await checkPlacementTimeout(matchId)

    expect(await redisClient.zcard("placement:matches")).toBe(0)
    expect(await redisClient.exists("player:7:currentMatch", "player:8:currentMatch")).toBe(0)
    expect(await redisClient.ttl(`match:${matchId}`)).toBeLessThanOrEqual(FINISHED_KEY_TTL)
  })

  it("shortens the life of the placement hash when chests were already placed", async () => {
    const matchId = await makeStartedMatch(7, 11, 8, 12)
    await resolvePlacement(matchId, "p1", "big", 3)
    await redisClient.hset(`match:${matchId}`, "placementDeadline", String(Date.now() - 1000))

    await checkPlacementTimeout(matchId)

    expect(await redisClient.ttl(`match:${matchId}:placement`)).toBeLessThanOrEqual(FINISHED_KEY_TTL)
  })

  it("a second call after the cancel is already processed and gives no holds again", async () => {
    const matchId = await expiredPlacementMatch()
    await checkPlacementTimeout(matchId)

    expect(await checkPlacementTimeout(matchId)).toEqual({ status: "already processed" })
  })

  it("already processed and out of the queue when the match is gone", async () => {
    await redisClient.zadd("placement:matches", 1, "550e8400-e29b-41d4-a716-446655440000")

    expect(await checkPlacementTimeout("550e8400-e29b-41d4-a716-446655440000")).toEqual({
      status: "already processed",
    })

    expect(await redisClient.zcard("placement:matches")).toBe(0)
  })

  it("already processed and out of the queue when the status is not placement", async () => {
    const matchId = await makeStartedMatch(7, 11, 8, 12)
    await redisClient.hset(`match:${matchId}`, "status", "reveal")

    expect(await checkPlacementTimeout(matchId)).toEqual({ status: "already processed" })

    expect(await redisClient.zcard("placement:matches")).toBe(0)
    expect(await redisClient.hget(`match:${matchId}`, "status")).toBe("reveal")
  })

  it("invalid_state when the time is over but all four chests are there, and changes nothing", async () => {
    const matchId = await expiredPlacementMatch()
    await redisClient.hset(
      `match:${matchId}:placement`,
      "p1_big", "1", "p1_small", "2", "p2_big", "3", "p2_small", "4",
    )
    const before = await redisClient.hgetall(`match:${matchId}`)

    expect(await checkPlacementTimeout(matchId)).toEqual({ status: "invalid_state" })

    expect(await redisClient.hgetall(`match:${matchId}`)).toEqual(before)
  })

  it("does not touch a waiting match", async () => {
    const matchId = await makeWaitingMatch(7, 11)

    expect(await checkPlacementTimeout(matchId)).toEqual({ status: "already processed" })

    expect(await redisClient.hget(`match:${matchId}`, "status")).toBe("waiting")
  })
})

describe("getPlacementMatchIds", () => {
  it("is empty when no match is in placement", async () => {
    expect(await getPlacementMatchIds()).toEqual([])
  })

  it("lists the matches in the placement phase", async () => {
    const first = await makeStartedMatch(7, 11, 8, 12)
    const second = await makeStartedMatch(9, 13, 10, 14)

    expect([...(await getPlacementMatchIds())].sort()).toEqual([first, second].sort())
  })
})
