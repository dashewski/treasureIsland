import { MATCH_STAKE, MAX_MATCH_ATTEMPTS } from "../constants"
import { pool } from "../db/pool"
import { AlreadyInGameError, InsufficientBalanceError } from "../errors"
import { redisClient } from "../redis/redisClient"
import { createPlayer, getHold, holdsOf } from "../testing/factories"
import { closeRedis, resetRedis } from "../testing/resetRedis"
import { resetDb } from "../testing/resetDb"
import * as actionModule from "./getMatchAction"
import { joinQueue, MatchNotFoundError } from "./joinQueue"
import { startMatch } from "./startMatch"

beforeEach(async () => {
  await resetDb()
  await resetRedis()
  jest.spyOn(console, "error").mockImplementation(() => {})
})
afterEach(() => {
  jest.restoreAllMocks()
})
afterAll(async () => {
  await pool.end()
  await closeRedis()
})

describe("joinQueue", () => {
  it("the first player creates a waiting match and keeps the hold", async () => {
    const a = await createPlayer(1)

    const match = await joinQueue(a)

    expect(match.status).toBe("waiting")
    expect(match.player1).toBe(String(a))
    expect(match.player2).toBeNull()
    expect(await redisClient.get(`player:${a}:currentMatch`)).toBe(match.matchId)
    const holds = await holdsOf(a)
    expect(holds).toHaveLength(1)
    expect(holds[0]).toMatchObject({ status: "active", type: "match_bid", refId: null })
  })

  it("the second player joins that match and both holds are tied to it", async () => {
    const a = await createPlayer(1)
    const b = await createPlayer(2)
    const first = await joinQueue(a)

    const second = await joinQueue(b)

    expect(second.matchId).toBe(first.matchId)
    expect(second.status).toBe("placement")
    expect(second.player2).toBe(String(b))
    for (const id of [a, b]) {
      const [hold] = await holdsOf(id)
      expect(hold).toMatchObject({ status: "active", refId: first.matchId, expiresAt: null })
    }
    expect(await redisClient.zcard("waiting:matches")).toBe(0)
    expect(await redisClient.zcard("placement:matches")).toBe(1)
  })

  it("the third player gets a new waiting match", async () => {
    const [a, b, c] = [await createPlayer(1), await createPlayer(2), await createPlayer(3)] as [number, number, number]
    const first = await joinQueue(a)
    await joinQueue(b)

    const third = await joinQueue(c)

    expect(third.matchId).not.toBe(first.matchId)
    expect(third.status).toBe("waiting")
  })

  it("refuses a player without enough balance and creates no hold", async () => {
    const poor = await createPlayer(1, MATCH_STAKE - 1)

    await expect(joinQueue(poor)).rejects.toBeInstanceOf(InsufficientBalanceError)

    expect(await holdsOf(poor)).toHaveLength(0)
    expect(await redisClient.dbsize()).toBe(0)
  })

  it("refuses a player who is already in a match, and the old hold stays", async () => {
    const a = await createPlayer(1)
    const first = await joinQueue(a)

    await expect(joinQueue(a)).rejects.toBeInstanceOf(AlreadyInGameError)

    expect(await holdsOf(a)).toHaveLength(1)
    expect(await redisClient.zrange("waiting:matches", "0", "-1")).toEqual([first.matchId])
  })

  it("two players at the same moment end up in one match, never in two lonely ones", async () => {
    const a = await createPlayer(1)
    const b = await createPlayer(2)

    const [first, second] = await Promise.all([joinQueue(a), joinQueue(b)])

    expect(first.matchId).toBe(second.matchId)
    const matchIds = (await redisClient.keys("match:*")).filter((key) => key.split(":").length === 2)
    expect(matchIds).toHaveLength(1)
  })

  it("six players at the same moment make exactly three full matches", async () => {
    const ids = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => createPlayer(n)))

    const matches = await Promise.all(ids.map((id) => joinQueue(id)))

    const counts = new Map<string, number>()
    for (const match of matches) counts.set(match.matchId, (counts.get(match.matchId) ?? 0) + 1)
    expect([...counts.values()].sort()).toEqual([2, 2, 2])
    expect(await redisClient.zcard("waiting:matches")).toBe(0)
  })

  it("releases the hold and says no game was found when the attempts run out", async () => {
    const a = await createPlayer(1)
    const action = jest.spyOn(actionModule, "getMatchAction").mockResolvedValue(null)

    await expect(joinQueue(a, async () => {})).rejects.toBeInstanceOf(MatchNotFoundError)

    expect(action).toHaveBeenCalledTimes(MAX_MATCH_ATTEMPTS)
    expect((await holdsOf(a))[0]).toMatchObject({ status: "released" })
  })

  it("releases the hold when Redis fails during the search", async () => {
    const a = await createPlayer(1)
    jest.spyOn(actionModule, "getMatchAction").mockRejectedValue(new Error("redis is down"))

    await expect(joinQueue(a)).rejects.toBeInstanceOf(MatchNotFoundError)

    expect((await holdsOf(a))[0]).toMatchObject({ status: "released" })
  })

  it("a player whose search failed can search again", async () => {
    const a = await createPlayer(1)
    const spy = jest.spyOn(actionModule, "getMatchAction").mockRejectedValueOnce(new Error("redis is down"))
    await expect(joinQueue(a)).rejects.toThrow()
    spy.mockRestore()

    const match = await joinQueue(a)

    expect(match.status).toBe("waiting")
    const holds = await holdsOf(a)
    expect(holds.filter((h) => h.status === "active")).toHaveLength(1)
    expect((await getHold(holds[0].id)).status).toBe("released")
  })
})

describe("startMatch", () => {
  it("returns the filtered answer: no hold ids, the stake as a decimal string", async () => {
    const a = await createPlayer(1)

    const response = await startMatch(a)

    expect(response).toMatchObject({ status: "waiting", bid: "5.00" })
    expect(JSON.stringify(response)).not.toContain("HoldId")
  })
})
