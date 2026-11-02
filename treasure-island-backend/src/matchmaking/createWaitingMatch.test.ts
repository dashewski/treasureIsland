import { MATCH_KEY_TTL } from "../constants"
import { isUuid } from "../domain/validate"
import { redisClient } from "../redis/redisClient"
import { closeRedis, resetRedis } from "../testing/resetRedis"
import { createWaitingMatch } from "./createWaitingMatch"

const token = "test-lock-token"

// the right to create a match, as getMatchAction will leave it in Redis
async function takeLock(lockToken = token) {
  await redisClient.set("lock:create", lockToken, "PX", 2000)
}

// takes the lock and creates a match, the way a real call would
async function create(playerId: number, holdId: number) {
  await takeLock()
  const matchId = await createWaitingMatch(playerId, holdId, token)
  if (matchId === null) throw new Error("the match was not created")
  return matchId
}

beforeEach(resetRedis)
afterAll(closeRedis)

describe("createWaitingMatch", () => {
  it("returns the id of the new match", async () => {
    expect(isUuid(await create(7, 11))).toBe(true)
  })

  it("writes the match hash with all ten fields", async () => {
    const matchId = await create(7, 11)

    const match = await redisClient.hgetall(`match:${matchId}`)

    expect(match).toEqual({
      matchId,
      status: "waiting",
      player1: "7",
      player1HoldId: "11",
      bid: "5",
      bigAmount: "4",
      smallAmount: "1",
      createdAt: expect.stringMatching(/^\d+$/),
      updatedAt: expect.stringMatching(/^\d+$/),
      stateVersion: "0",
    })
  })

  it("does not write fields that only exist later (second player, deadlines)", async () => {
    const matchId = await create(7, 11)

    const fields = Object.keys(await redisClient.hgetall(`match:${matchId}`))

    for (const later of ["player2", "player2HoldId", "placementDeadline", "turnDeadline", "currentTurn", "cancelReason"]) {
      expect(fields).not.toContain(later)
    }
  })

  it("createdAt and updatedAt are the same and close to now", async () => {
    const before = Date.now()
    const matchId = await create(7, 11)
    const after = Date.now()

    const match = await redisClient.hgetall(`match:${matchId}`)

    expect(match["createdAt"]).toBe(match["updatedAt"])
    expect(Number(match["createdAt"])).toBeGreaterThanOrEqual(before)
    expect(Number(match["createdAt"])).toBeLessThanOrEqual(after)
  })

  it("the chests add up to the stake", async () => {
    const matchId = await create(7, 11)

    const match = await redisClient.hgetall(`match:${matchId}`)

    expect(Number(match["bigAmount"]) + Number(match["smallAmount"])).toBe(Number(match["bid"]))
  })

  it("gives the match key a lifetime", async () => {
    const matchId = await create(7, 11)

    const ttl = await redisClient.ttl(`match:${matchId}`)

    expect(ttl).toBeGreaterThan(MATCH_KEY_TTL - 10)
    expect(ttl).toBeLessThanOrEqual(MATCH_KEY_TTL)
  })

  it("puts the match into the waiting queue, scored by its creation time", async () => {
    const matchId = await create(7, 11)

    const queue = await redisClient.zrange("waiting:matches", "0", "-1", "WITHSCORES")
    const match = await redisClient.hgetall(`match:${matchId}`)

    expect(queue).toEqual([matchId, match["createdAt"]])
  })

  it("points the player to the match, with a lifetime", async () => {
    const matchId = await create(7, 11)

    expect(await redisClient.get("player:7:currentMatch")).toBe(matchId)
    const ttl = await redisClient.ttl("player:7:currentMatch")
    expect(ttl).toBeGreaterThan(MATCH_KEY_TTL - 10)
    expect(ttl).toBeLessThanOrEqual(MATCH_KEY_TTL)
  })

  it("writes exactly three keys and nothing else (the lock is gone)", async () => {
    await create(7, 11)

    expect(await redisClient.dbsize()).toBe(3)
  })

  it("two players, one after another, get two separate matches and pointers", async () => {
    const first = await create(7, 11)
    const second = await create(8, 12)

    expect(first).not.toBe(second)
    expect(await redisClient.get("player:7:currentMatch")).toBe(first)
    expect(await redisClient.get("player:8:currentMatch")).toBe(second)
    expect(await redisClient.zcard("waiting:matches")).toBe(2)
  })
})

describe("createWaitingMatch lock", () => {
  it("releases the lock after the match is created", async () => {
    await create(7, 11)

    expect(await redisClient.exists("lock:create")).toBe(0)
  })

  it("returns null and writes nothing when nobody holds the lock", async () => {
    expect(await createWaitingMatch(7, 11, token)).toBeNull()

    expect(await redisClient.dbsize()).toBe(0)
  })

  it("returns null and writes nothing when the lock belongs to someone else", async () => {
    await takeLock("token-of-another-player")

    expect(await createWaitingMatch(7, 11, token)).toBeNull()

    expect(await redisClient.dbsize()).toBe(1)
    expect(await redisClient.get("lock:create")).toBe("token-of-another-player")
  })

  it("returns null when the lock has expired", async () => {
    await redisClient.set("lock:create", token, "PX", 100)
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(await createWaitingMatch(7, 11, token)).toBeNull()
    expect(await redisClient.dbsize()).toBe(0)
  })

  it("the second call with the same token gets nothing: the lock is used up", async () => {
    await takeLock()

    const first = await createWaitingMatch(7, 11, token)
    const second = await createWaitingMatch(8, 12, token)

    expect(first).not.toBeNull()
    expect(second).toBeNull()
    expect(await redisClient.zcard("waiting:matches")).toBe(1)
    expect(await redisClient.exists("player:8:currentMatch")).toBe(0)
  })

  it("ten calls at the same moment: exactly one match is created", async () => {
    await takeLock()

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => createWaitingMatch(100 + i, 200 + i, token)),
    )

    expect(results.filter((id) => id !== null)).toHaveLength(1)
    expect(await redisClient.zcard("waiting:matches")).toBe(1)
    expect(await redisClient.dbsize()).toBe(3)
  })
})
