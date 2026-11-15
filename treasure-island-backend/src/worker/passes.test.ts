import { MATCHMAKING_TIMEOUT, SETTLEMENT_MAX_FAILS } from "../constants"
import { pool } from "../db/pool"
import { redisClient } from "../redis/redisClient"
import * as resolveModule from "../reveal/resolveRevealTimeout"
import { resolveMove } from "../reveal/resolveMove"
import * as settleModule from "../settlement/settleMatch"
import { addHold, createPlayer, getHold, getPlayer } from "../testing/factories"
import { makeRevealMatch, makeStartedMatch, makeWaitingMatch } from "../testing/matchSetup"
import { closeRedis, resetRedis } from "../testing/resetRedis"
import { resetDb } from "../testing/resetDb"
import { fastPass, slowPass } from "./passes"
import { startWorker } from "./worker"
import * as passesModule from "./passes"

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

async function twoPlayers() {
  const a = await createPlayer(1)
  const b = await createPlayer(2)
  return { a, b, holdA: await addHold(a), holdB: await addHold(b) }
}

async function expireTurn(matchId: string) {
  const past = String(Date.now() - 1000)
  await redisClient.hset(`match:${matchId}`, "turnDeadline", past)
  await redisClient.zadd("reveal:matches", past, matchId)
}

describe("fastPass", () => {
  it("skips the move of a player whose turn is over", async () => {
    const { a, b, holdA, holdB } = await twoPlayers()
    const matchId = await makeRevealMatch(a, holdA, b, holdB)
    await expireTurn(matchId)

    await fastPass()

    expect(await redisClient.hget(`match:${matchId}:reveal`, "p1_move_1_result")).toBe("skipped")
    expect(await redisClient.hget(`match:${matchId}`, "currentTurn")).toBe(String(b))
  })

  it("does nothing while the turn has time", async () => {
    const { a, b, holdA, holdB } = await twoPlayers()
    const matchId = await makeRevealMatch(a, holdA, b, holdB)

    await fastPass()

    expect(await redisClient.exists(`match:${matchId}:reveal`)).toBe(0)
  })

  it("the skip of the last move ends the match and settles the money", async () => {
    const { a, b, holdA, holdB } = await twoPlayers()
    const matchId = await makeRevealMatch(a, holdA, b, holdB)
    await pool.query(`UPDATE balance_holds SET "refId" = $1 WHERE id IN ($2, $3)`, [matchId, holdA, holdB])
    for (const [p, zone] of [[a, 3], [b, 5], [a, 5]] as const) await resolveMove(matchId, String(p), zone)
    await expireTurn(matchId)

    await fastPass()

    expect((await getHold(holdA)).status).toBe("consumed")
    expect((await getPlayer(a)).balance).toBe("23.60")
  })

  it("an error with one match does not stop the others", async () => {
    const { a, b, holdA, holdB } = await twoPlayers()
    const c = await createPlayer(3)
    const d = await createPlayer(4)
    const first = await makeRevealMatch(a, holdA, b, holdB)
    const second = await makeRevealMatch(c, await addHold(c), d, await addHold(d))
    await expireTurn(first)
    await expireTurn(second)
    const real = resolveModule.resolveRevealTimeout
    jest.spyOn(resolveModule, "resolveRevealTimeout").mockImplementation(async (id) => {
      if (id === first) throw new Error("boom")
      return real(id)
    })

    await fastPass()

    expect(await redisClient.hget(`match:${second}:reveal`, "p1_move_1_result")).toBe("skipped")
  })
})

describe("slowPass", () => {
  it("cancels a waiting match nobody joined and releases the hold", async () => {
    const { a, holdA } = await twoPlayers()
    const matchId = await makeWaitingMatch(a, holdA)
    await redisClient.hset(`match:${matchId}`, "createdAt", String(Date.now() - (MATCHMAKING_TIMEOUT + 1) * 1000))

    await slowPass()

    expect(await redisClient.hget(`match:${matchId}`, "status")).toBe("cancelled")
    expect((await getHold(holdA)).status).toBe("released")
  })

  it("cancels a match whose chests were not placed in time and releases both holds", async () => {
    const { a, b, holdA, holdB } = await twoPlayers()
    const matchId = await makeStartedMatch(a, holdA, b, holdB)
    await redisClient.hset(`match:${matchId}`, "placementDeadline", String(Date.now() - 1000))

    await slowPass()

    expect(await redisClient.hget(`match:${matchId}`, "cancelReason")).toBe("placement_timeout")
    expect((await getHold(holdA)).status).toBe("released")
    expect((await getHold(holdB)).status).toBe("released")
  })

  it("leaves a healthy match alone", async () => {
    const { a, b, holdA, holdB } = await twoPlayers()
    const matchId = await makeStartedMatch(a, holdA, b, holdB)

    await slowPass()

    expect(await redisClient.hget(`match:${matchId}`, "status")).toBe("placement")
    expect((await getHold(holdA)).status).toBe("active")
  })

  it("repeats a settlement that failed earlier", async () => {
    const { a, b, holdA, holdB } = await twoPlayers()
    const matchId = await makeRevealMatch(a, holdA, b, holdB)
    await pool.query(`UPDATE balance_holds SET "refId" = $1 WHERE id IN ($2, $3)`, [matchId, holdA, holdB])
    for (const [p, zone] of [[a, 3], [b, 5], [a, 5], [b, 4]] as const) await resolveMove(matchId, String(p), zone)
    await pool.query(`UPDATE balance_holds SET status = 'released' WHERE id = $1`, [holdB])

    await slowPass()
    expect(await redisClient.zrange("settlement:matches", "0", "-1")).toEqual([matchId])

    await pool.query(`UPDATE balance_holds SET status = 'active' WHERE id = $1`, [holdB])
    await slowPass()
    expect(await redisClient.zrange("settlement:matches", "0", "-1")).toEqual([])
    expect((await getPlayer(a)).balance).toBe("23.60")
  })

  it("raises an alert after SETTLEMENT_MAX_FAILS failures in a row, and keeps retrying", async () => {
    const matchId = "550e8400-e29b-41d4-a716-446655440000"
    await redisClient.zadd("settlement:matches", Date.now(), matchId)
    const settle = jest.spyOn(settleModule, "settleMatch").mockRejectedValue(new Error("database is down"))
    const log = jest.spyOn(console, "error")

    for (let i = 0; i < SETTLEMENT_MAX_FAILS; i++) await slowPass()

    expect(settle).toHaveBeenCalledTimes(SETTLEMENT_MAX_FAILS)
    expect(log.mock.calls.filter((call) => String(call[0]).includes("ALERT"))).toHaveLength(1)
    await slowPass()
    expect(settle).toHaveBeenCalledTimes(SETTLEMENT_MAX_FAILS + 1)
  })

  it("runs the safety net for holds last", async () => {
    const a = await createPlayer(1)
    const stuck = await addHold(a, { expiresInSeconds: -5 })

    await slowPass()

    expect((await getHold(stuck)).status).toBe("released")
  })
})

describe("startWorker", () => {
  it("runs both passes at once, and after stop nothing runs again", async () => {
    const fast = jest.spyOn(passesModule, "fastPass").mockResolvedValue()
    const slow = jest.spyOn(passesModule, "slowPass").mockResolvedValue()

    const stop = startWorker()
    await stop()

    expect(fast).toHaveBeenCalledTimes(1)
    expect(slow).toHaveBeenCalledTimes(1)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fast).toHaveBeenCalledTimes(1)
  })
})
