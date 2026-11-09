import { pool } from "../db/pool"
import { redisClient } from "../redis/redisClient"
import { addHold, createPlayer, getHold } from "../testing/factories"
import { joinToken, makeWaitingMatch, reserveForJoin } from "../testing/matchSetup"
import { resetDb } from "../testing/resetDb"
import { closeRedis, resetRedis } from "../testing/resetRedis"
import { joinWaitingMatch } from "./joinWaitingMatch"
import * as rollbackModule from "./rollbackRedisJoin"

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

// player 1 waits in a match, player 2 is searching and holds a stake
async function waitingCreatorAndSearcher() {
  const player1 = await createPlayer(1)
  const player2 = await createPlayer(2)
  const hold1 = await addHold(player1, { expiresInSeconds: 120 })
  const hold2 = await addHold(player2, { expiresInSeconds: 120 })
  const matchId = await makeWaitingMatch(player1, hold1)
  await reserveForJoin(matchId)
  return { player1, player2, hold1, hold2, matchId }
}

describe("joinWaitingMatch: success", () => {
  it("returns the match in placement with both players", async () => {
    const { player1, player2, hold1, hold2, matchId } = await waitingCreatorAndSearcher()

    const match = await joinWaitingMatch(player2, hold2, matchId, joinToken)

    expect(match).toMatchObject({
      matchId,
      status: "placement",
      player1: String(player1),
      player2: String(player2),
      player1HoldId: String(hold1),
      player2HoldId: String(hold2),
    })
  })

  it("ties both holds to the match and removes their safety timers", async () => {
    const { hold1, hold2, matchId } = await waitingCreatorAndSearcher()
    const player2 = (await getHold(hold2)).playerId

    await joinWaitingMatch(player2, hold2, matchId, joinToken)

    for (const id of [hold1, hold2]) {
      const hold = await getHold(id)
      expect(hold.refId).toBe(matchId)
      expect(hold.expiresAt).toBeNull()
      expect(hold.status).toBe("active")
    }
  })
})

describe("joinWaitingMatch: cannot join", () => {
  it("returns null with the wrong token and touches neither Redis nor the holds", async () => {
    const { player2, hold1, hold2, matchId } = await waitingCreatorAndSearcher()

    expect(await joinWaitingMatch(player2, hold2, matchId, "another-token")).toBeNull()

    expect(await redisClient.hget(`match:${matchId}`, "status")).toBe("waiting")
    for (const id of [hold1, hold2]) {
      expect((await getHold(id)).refId).toBeNull()
    }
  })

  it("returns null when the match does not exist", async () => {
    const player2 = await createPlayer(2)
    const hold2 = await addHold(player2, { expiresInSeconds: 120 })

    expect(await joinWaitingMatch(player2, hold2, "550e8400-e29b-41d4-a716-446655440000", joinToken)).toBeNull()

    expect((await getHold(hold2)).status).toBe("active")
  })

  it("two players race for one match: one wins, the other gets null and keeps an untouched hold", async () => {
    const { player2, hold2, matchId } = await waitingCreatorAndSearcher()
    const player3 = await createPlayer(3)
    const hold3 = await addHold(player3, { expiresInSeconds: 120 })

    const results = await Promise.all([
      joinWaitingMatch(player2, hold2, matchId, joinToken),
      joinWaitingMatch(player3, hold3, matchId, joinToken),
    ])

    expect(results.filter((match) => match !== null)).toHaveLength(1)
    const winnerHold = results[0] !== null ? hold2 : hold3
    const loserHold = results[0] !== null ? hold3 : hold2
    expect((await getHold(winnerHold)).refId).toBe(matchId)
    expect((await getHold(loserHold)).refId).toBeNull()
    expect((await getHold(loserHold)).status).toBe("active")
  })
})

describe("joinWaitingMatch: linking the holds fails", () => {
  // the joining player's hold was already closed, so linkHoldsToMatch finds only one active hold
  async function closedSearcherHold() {
    const setup = await waitingCreatorAndSearcher()
    await pool.query(`UPDATE balance_holds SET status = 'released' WHERE id = $1`, [setup.hold2])
    return setup
  }

  it("puts the match back to waiting for the creator and says to try again", async () => {
    const { player1, player2, hold1, hold2, matchId } = await closedSearcherHold()

    await expect(joinWaitingMatch(player2, hold2, matchId, joinToken)).rejects.toThrow(
      "could not join, try again",
    )

    expect(await redisClient.hget(`match:${matchId}`, "status")).toBe("waiting")
    expect(await redisClient.hget(`match:${matchId}`, "player2")).toBeNull()
    expect(await redisClient.zscore("waiting:matches", matchId)).not.toBeNull()
    expect(await redisClient.zcard("placement:matches")).toBe(0)
    expect(await redisClient.get(`player:${player1}:currentMatch`)).toBe(matchId)
    expect(await redisClient.exists(`player:${player2}:currentMatch`)).toBe(0)
    const creatorHold = await getHold(hold1)
    expect(creatorHold.status).toBe("active")
    expect(creatorHold.refId).toBeNull()
    expect(creatorHold.expiresAt).not.toBeNull()
  })

  it("cancels the match and closes both holds when the rollback is not possible", async () => {
    const { player1, player2, hold1, hold2, matchId } = await waitingCreatorAndSearcher()
    await pool.query(`UPDATE balance_holds SET status = 'consumed' WHERE id = $1`, [hold2])
    jest.spyOn(rollbackModule, "rollbackRedisJoin").mockResolvedValue("not_rollbackable")

    await expect(joinWaitingMatch(player2, hold2, matchId, joinToken)).rejects.toThrow(
      "match cancelled due to internal error",
    )

    expect(await redisClient.hget(`match:${matchId}`, "status")).toBe("cancelled")
    expect(await redisClient.exists(`player:${player1}:currentMatch`, `player:${player2}:currentMatch`)).toBe(0)
    expect(await redisClient.zcard("waiting:matches")).toBe(0)
    expect(await redisClient.zcard("placement:matches")).toBe(0)
    expect((await getHold(hold1)).status).toBe("released")
  })

  it("cancels the match when the rollback itself fails with a Redis error", async () => {
    const { player2, hold1, hold2, matchId } = await closedSearcherHold()
    jest.spyOn(rollbackModule, "rollbackRedisJoin").mockRejectedValue(new Error("redis down"))

    await expect(joinWaitingMatch(player2, hold2, matchId, joinToken)).rejects.toThrow(
      "match cancelled due to internal error",
    )

    expect(await redisClient.hget(`match:${matchId}`, "status")).toBe("cancelled")
    expect((await getHold(hold1)).status).toBe("released")
  })
})
