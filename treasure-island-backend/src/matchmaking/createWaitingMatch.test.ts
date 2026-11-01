import { MATCH_KEY_TTL } from "../constants"
import { isUuid } from "../domain/validate"
import { redisClient } from "../redis/redisClient"
import { closeRedis, resetRedis } from "../testing/resetRedis"
import { createWaitingMatch } from "./createWaitingMatch"

const token = "test-lock-token"

beforeEach(resetRedis)
afterAll(closeRedis)

describe("createWaitingMatch", () => {
  it("returns the id of the new match", async () => {
    const matchId = await createWaitingMatch(7, 11, token)
    expect(isUuid(matchId)).toBe(true)
  })

  it("writes the match hash with all ten fields", async () => {
    const matchId = await createWaitingMatch(7, 11, token)

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
    const matchId = await createWaitingMatch(7, 11, token)

    const fields = Object.keys(await redisClient.hgetall(`match:${matchId}`))

    for (const later of ["player2", "player2HoldId", "placementDeadline", "turnDeadline", "currentTurn", "cancelReason"]) {
      expect(fields).not.toContain(later)
    }
  })

  it("createdAt and updatedAt are the same and close to now", async () => {
    const before = Date.now()
    const matchId = await createWaitingMatch(7, 11, token)
    const after = Date.now()

    const match = await redisClient.hgetall(`match:${matchId}`)

    expect(match["createdAt"]).toBe(match["updatedAt"])
    expect(Number(match["createdAt"])).toBeGreaterThanOrEqual(before)
    expect(Number(match["createdAt"])).toBeLessThanOrEqual(after)
  })

  it("the chests add up to the stake", async () => {
    const matchId = await createWaitingMatch(7, 11, token)

    const match = await redisClient.hgetall(`match:${matchId}`)

    expect(Number(match["bigAmount"]) + Number(match["smallAmount"])).toBe(Number(match["bid"]))
  })

  it("gives the match key a lifetime", async () => {
    const matchId = await createWaitingMatch(7, 11, token)

    const ttl = await redisClient.ttl(`match:${matchId}`)

    expect(ttl).toBeGreaterThan(MATCH_KEY_TTL - 10)
    expect(ttl).toBeLessThanOrEqual(MATCH_KEY_TTL)
  })

  it("puts the match into the waiting queue, scored by its creation time", async () => {
    const matchId = await createWaitingMatch(7, 11, token)

    const queue = await redisClient.zrange("waiting:matches", "0", "-1", "WITHSCORES")
    const match = await redisClient.hgetall(`match:${matchId}`)

    expect(queue).toEqual([matchId, match["createdAt"]])
  })

  it("points the player to the match, with a lifetime", async () => {
    const matchId = await createWaitingMatch(7, 11, token)

    expect(await redisClient.get("player:7:currentMatch")).toBe(matchId)
    const ttl = await redisClient.ttl("player:7:currentMatch")
    expect(ttl).toBeGreaterThan(MATCH_KEY_TTL - 10)
    expect(ttl).toBeLessThanOrEqual(MATCH_KEY_TTL)
  })

  it("writes exactly three keys and nothing else", async () => {
    await createWaitingMatch(7, 11, token)

    expect(await redisClient.dbsize()).toBe(3)
  })

  it("two players get two separate matches and pointers", async () => {
    const first = await createWaitingMatch(7, 11, token)
    const second = await createWaitingMatch(8, 12, token)

    expect(first).not.toBe(second)
    expect(await redisClient.get("player:7:currentMatch")).toBe(first)
    expect(await redisClient.get("player:8:currentMatch")).toBe(second)
    expect(await redisClient.zcard("waiting:matches")).toBe(2)
  })

  it("ten calls at the same moment create ten different matches", async () => {
    const ids = await Promise.all(
      Array.from({ length: 10 }, (_, i) => createWaitingMatch(100 + i, 200 + i, token)),
    )

    expect(new Set(ids).size).toBe(10)
    expect(await redisClient.zcard("waiting:matches")).toBe(10)
    for (let i = 0; i < 10; i++) {
      expect(await redisClient.get(`player:${100 + i}:currentMatch`)).toBe(ids[i])
    }
  })

  it.todo("throws when a command inside the transaction fails")
  it.todo("returns null when the lock token is not the current one (after the Lua step)")
})
