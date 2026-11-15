import { pool } from "../db/pool"
import { redisClient } from "../redis/redisClient"
import { addHold, createPlayer, getHold, getPlayer } from "../testing/factories"
import { makeRevealMatch } from "../testing/matchSetup"
import { closeRedis, resetRedis } from "../testing/resetRedis"
import { resetDb } from "../testing/resetDb"
import { resolveMove } from "../reveal/resolveMove"
import { FINISHED_KEY_TTL } from "../constants"
import { getSettlementMatchIds } from "./getSettlementMatchIds"
import { settleMatch } from "./settleMatch"

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

// chests: p1 big 1, small 2; p2 big 3, small 4. Player 1 finds the big chest and misses,
// player 2 misses twice: results 9.00 and 1.00, fee 0.40
async function playedMatch() {
  const a = await createPlayer(1)
  const b = await createPlayer(2)
  const holdA = await addHold(a)
  const holdB = await addHold(b)
  const matchId = await makeRevealMatch(a, holdA, b, holdB)
  await pool.query(`UPDATE balance_holds SET "refId" = $1, "expiresAt" = NULL WHERE id IN ($2, $3)`, [matchId, holdA, holdB])
  await resolveMove(matchId, String(a), 3)
  await resolveMove(matchId, String(b), 5)
  await resolveMove(matchId, String(a), 5)
  const last = await resolveMove(matchId, String(b), 4)
  expect(last.status).toBe("ended")
  return { a, b, holdA, holdB, matchId }
}

describe("settleMatch", () => {
  it("pays both players, consumes the holds and cleans Redis", async () => {
    const { a, b, holdA, holdB, matchId } = await playedMatch()
    expect(await getSettlementMatchIds()).toEqual([matchId])

    expect(await settleMatch(matchId)).toBe("settled")

    expect((await getPlayer(a)).balance).toBe("23.60")
    expect((await getPlayer(b)).balance).toBe("16.00")
    expect((await getHold(holdA)).status).toBe("consumed")
    expect((await getHold(holdB)).status).toBe("consumed")
    expect(await getSettlementMatchIds()).toEqual([])
    expect(await redisClient.exists(`player:${a}:currentMatch`, `player:${b}:currentMatch`)).toBe(0)
    expect(await redisClient.zcard("reveal:matches")).toBe(0)
    for (const key of [`match:${matchId}`, `match:${matchId}:placement`, `match:${matchId}:reveal`]) {
      const ttl = await redisClient.ttl(key)
      expect(ttl).toBeGreaterThan(0)
      expect(ttl).toBeLessThanOrEqual(FINISHED_KEY_TTL)
    }
  })

  it("stores the placement and the moves for audit", async () => {
    const { matchId } = await playedMatch()
    await settleMatch(matchId)

    const { rows } = await pool.query(`SELECT moves FROM match_history WHERE "matchId" = $1`, [matchId])
    expect(rows[0].moves.placement).toMatchObject({ p1_big: 1, p2_small: 4 })
    expect(rows[0].moves.reveal).toMatchObject({ p1_move_1_zone: 3, p1_move_1_result: "hit_big" })
  })

  it("a second call pays nothing more", async () => {
    const { a, matchId } = await playedMatch()
    await settleMatch(matchId)

    expect(await settleMatch(matchId)).toBe("already_settled")
    expect((await getPlayer(a)).balance).toBe("23.60")
  })

  it("a repeat after the money is paid but the Redis cleanup failed finishes the cleanup", async () => {
    const { a, matchId } = await playedMatch()
    await settleMatch(matchId)
    await redisClient.zadd("settlement:matches", Date.now(), matchId)
    await redisClient.set(`player:${a}:currentMatch`, matchId)

    expect(await settleMatch(matchId)).toBe("already_settled")

    expect(await getSettlementMatchIds()).toEqual([])
    expect(await redisClient.exists(`player:${a}:currentMatch`)).toBe(0)
  })

  it("a repeat does not delete the pointer to the NEXT match of the player", async () => {
    const { a, matchId } = await playedMatch()
    await settleMatch(matchId)
    await redisClient.set(`player:${a}:currentMatch`, "the-next-match")

    await settleMatch(matchId)

    expect(await redisClient.get(`player:${a}:currentMatch`)).toBe("the-next-match")
  })

  it("five calls at the same moment pay exactly once", async () => {
    const { a, matchId } = await playedMatch()

    const results = await Promise.all(Array.from({ length: 5 }, () => settleMatch(matchId)))

    expect(results.filter((r) => r === "settled")).toHaveLength(1)
    expect((await getPlayer(a)).balance).toBe("23.60")
  })

  it("keeps the match in the queue when PostgreSQL refuses, and works on the next try", async () => {
    const { a, holdB, matchId } = await playedMatch()
    await pool.query(`UPDATE balance_holds SET status = 'released' WHERE id = $1`, [holdB])

    await expect(settleMatch(matchId)).rejects.toThrow("not active")

    expect(await getSettlementMatchIds()).toEqual([matchId])
    expect((await getPlayer(a)).balance).toBe("20.00")
    await pool.query(`UPDATE balance_holds SET status = 'active' WHERE id = $1`, [holdB])
    expect(await settleMatch(matchId)).toBe("settled")
  })

  it("match_missing and out of the queue when the Redis keys are gone; the holds stay for recovery", async () => {
    const { holdA, matchId } = await playedMatch()
    await redisClient.del(`match:${matchId}`)

    expect(await settleMatch(matchId)).toBe("match_missing")

    expect(await getSettlementMatchIds()).toEqual([])
    expect((await getHold(holdA)).status).toBe("active")
  })

  it("refuses a match that is not ended", async () => {
    const a = await createPlayer(1)
    const b = await createPlayer(2)
    const matchId = await makeRevealMatch(a, await addHold(a), b, await addHold(b))

    await expect(settleMatch(matchId)).rejects.toThrow("not ended")
  })
})
