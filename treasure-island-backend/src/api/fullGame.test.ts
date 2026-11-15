import { PLACEMENT_TIMEOUT, TURN_TIMEOUT } from "../constants"
import { pool } from "../db/pool"
import { redisClient } from "../redis/redisClient"
import { getHold, getPlayer, holdsOf } from "../testing/factories"
import { closeRedis, resetRedis } from "../testing/resetRedis"
import { resetDb } from "../testing/resetDb"
import { startTestApp, type TestApp } from "../testing/testApp"
import { fastPass, slowPass } from "../worker/passes"

let app: TestApp

beforeAll(async () => {
  app = await startTestApp()
})
beforeEach(async () => {
  await resetDb()
  await resetRedis()
  jest.spyOn(console, "error").mockImplementation(() => {})
})
afterEach(() => {
  jest.restoreAllMocks()
})
afterAll(async () => {
  await app.close()
  await pool.end()
  await closeRedis()
})

interface Duel {
  tokenA: string
  tokenB: string
  idA: number
  idB: number
  matchId: string
}

// two players find each other through the API; the one who searched first is player 1
async function startDuel(): Promise<Duel> {
  const tokenA = await app.login(1001)
  const tokenB = await app.login(1002)
  const first = await app.call("POST", "/api/match/start", tokenA)
  const second = await app.call("POST", "/api/match/start", tokenB)
  expect(first.status).toBe(200)
  expect(second.status).toBe(200)
  expect(second.body.matchId).toBe(first.body.matchId)
  const { rows } = await pool.query("SELECT id, tgid FROM players ORDER BY tgid")
  return { tokenA, tokenB, idA: rows[0].id, idB: rows[1].id, matchId: first.body.matchId }
}

const place = (d: Duel, token: string, chestType: string, zoneId: number) =>
  app.call("POST", "/api/match/place", token, { matchId: d.matchId, chestType, zoneId })
const move = (d: Duel, token: string, zoneId: number) =>
  app.call("POST", "/api/match/move", token, { matchId: d.matchId, zoneId })
const status = (d: Duel, token: string) => app.call("GET", `/api/match/${d.matchId}`, token)

// A: big 1, small 2. B: big 3, small 4
async function placeAll(d: Duel) {
  await place(d, d.tokenA, "big", 1)
  await place(d, d.tokenA, "small", 2)
  await place(d, d.tokenB, "big", 3)
  return place(d, d.tokenB, "small", 4)
}

describe("a full match through the API", () => {
  it("search, placement, reveal, settlement: money, history and reconnect are right", async () => {
    const d = await startDuel()

    // both holds are tied to the match and frozen
    for (const id of [d.idA, d.idB]) {
      expect((await holdsOf(id))[0]).toMatchObject({ status: "active", refId: d.matchId, expiresAt: null })
    }
    expect((await status(d, d.tokenB)).body.status).toBe("placement")

    // placement: each sees only own chests
    const afterFirst = await place(d, d.tokenA, "big", 1)
    expect(afterFirst.body.myPlacement).toEqual({ big: 1, small: null })
    const forB = (await status(d, d.tokenB)).body
    expect(forB.opponentPlaced).toEqual({ big: true, small: false })
    expect(JSON.stringify(forB)).not.toContain('"zone":1')
    expect(forB.myPlacement).toEqual({ big: null, small: null })
    await place(d, d.tokenA, "small", 2)
    await place(d, d.tokenB, "big", 3)
    const last = await place(d, d.tokenB, "small", 4)

    // reveal starts, player 1 moves first
    expect(last.body.status).toBe("reveal")
    expect(last.body.currentTurn).toBe(String(d.idA))
    expect((await move(d, d.tokenB, 1)).status).toBe(409)

    const m1 = await move(d, d.tokenA, 3)
    expect(m1.body.myMoves).toEqual([{ zone: 3, result: "hit_big" }])
    expect(m1.body.currentTurn).toBe(String(d.idB))
    expect((await move(d, d.tokenB, 5)).status).toBe(200)
    expect((await move(d, d.tokenA, 5)).status).toBe(200)
    const ended = await move(d, d.tokenB, 4)

    expect(ended.status).toBe(200)
    expect(ended.body.status).toBe("ended")
    expect(ended.body.opponentPlacement).toEqual({ big: 1, small: 2 })
    expect(ended.body.settlement).toEqual({ result: "1.00", netProfit: "-4.00", fee: "0.00", payout: "1.00" })
    const winnerView = (await status(d, d.tokenA)).body
    expect(winnerView.settlement).toEqual({ result: "9.00", netProfit: "3.60", fee: "0.40", payout: "8.60" })
    expect(JSON.stringify(winnerView)).not.toContain("HoldId")

    // the money is already settled in PostgreSQL
    expect((await getPlayer(d.idA)).balance).toBe("103.60")
    expect((await getPlayer(d.idB)).balance).toBe("96.00")
    expect((await getHold((await holdsOf(d.idA))[0].id)).status).toBe("consumed")
    const history = await pool.query("SELECT * FROM match_history")
    expect(history.rows).toHaveLength(1)
    expect(history.rows[0]).toMatchObject({ result: "played", fee: "0.40", p1Winnings: "8.60", p2Winnings: "1.00" })
    // total money is conserved except for the fee
    const total = await pool.query("SELECT SUM(balance)::text AS sum FROM players")
    expect(total.rows[0].sum).toBe("199.60")

    // reconnect now shows the finished match from history, and a new search is allowed
    expect((await app.call("GET", "/api/me/reconnect", d.tokenA)).body).toEqual({
      reconnectResult: "lastFinishedMatch",
      match: { matchId: d.matchId, finishedAt: expect.any(Number), outcome: "win", netProfit: "3.60" },
    })
    expect((await app.call("GET", "/api/me/reconnect", d.tokenB)).body.match.outcome).toBe("loss")
    expect((await app.call("POST", "/api/match/start", d.tokenA)).status).toBe(200)
  })

  it("a draw returns both stakes and takes no fee", async () => {
    const d = await startDuel()
    await placeAll(d)
    // nobody hits anything: chests of B are in 3 and 4, chests of A in 1 and 2
    await move(d, d.tokenA, 5)
    await move(d, d.tokenB, 5)
    await move(d, d.tokenA, 2)
    expect((await move(d, d.tokenB, 4)).body.status).toBe("ended")

    expect((await getPlayer(d.idA)).balance).toBe("100.00")
    expect((await getPlayer(d.idB)).balance).toBe("100.00")
    expect((await pool.query("SELECT fee FROM match_history")).rows[0].fee).toBe("0.00")
  })

  it("both players place their chests at the same moment", async () => {
    const d = await startDuel()

    const answers = await Promise.all([
      place(d, d.tokenA, "big", 1),
      place(d, d.tokenB, "big", 3),
      place(d, d.tokenA, "small", 2),
      place(d, d.tokenB, "small", 4),
    ])

    expect(answers.map((a) => a.status)).toEqual([200, 200, 200, 200])
    expect((await status(d, d.tokenA)).body.status).toBe("reveal")
  })

  it("a chest cannot be placed twice, nor two chests in one zone, nor outside the field", async () => {
    const d = await startDuel()
    await place(d, d.tokenA, "big", 1)

    expect((await place(d, d.tokenA, "big", 2)).status).toBe(409)
    expect((await place(d, d.tokenA, "small", 1)).status).toBe(409)
    expect((await place(d, d.tokenA, "small", 6)).status).toBe(400)
    expect((await place(d, d.tokenA, "medium", 2)).status).toBe(400)
    expect((await status(d, d.tokenA)).body.myPlacement).toEqual({ big: 1, small: null })
  })

  it("a zone cannot be opened twice, and a third move is refused", async () => {
    const d = await startDuel()
    await placeAll(d)
    await move(d, d.tokenA, 5)
    await move(d, d.tokenB, 5)

    expect((await move(d, d.tokenA, 5)).status).toBe(409)
    expect((await move(d, d.tokenA, 6)).status).toBe(400)
    await move(d, d.tokenA, 4)
    await move(d, d.tokenB, 4)
    expect((await move(d, d.tokenA, 1)).status).toBe(409)
  })

  it("moves cannot be made during placement", async () => {
    const d = await startDuel()
    expect((await move(d, d.tokenA, 1)).status).toBe(409)
  })
})

describe("timeouts", () => {
  it("nobody joins: the worker cancels the match, the stake comes back, a new search works", async () => {
    const token = await app.login(1001)
    const match = (await app.call("POST", "/api/match/start", token)).body
    await redisClient.hset(`match:${match.matchId}`, "createdAt", String(Date.now() - 200_000))

    await slowPass()

    const view = await app.call("GET", `/api/match/${match.matchId}`, token)
    expect(view.body).toMatchObject({ status: "cancelled", cancelReason: "matchmaking_timeout" })
    expect((await app.call("GET", "/api/me/reconnect", token)).body).toEqual({ reconnectResult: "none" })
    expect((await app.call("POST", "/api/match/start", token)).status).toBe(200)
    expect((await getPlayer(1)).balance).toBe("100.00")
  })

  it(`chests not placed in ${PLACEMENT_TIMEOUT} s: the match is cancelled and both stakes are released`, async () => {
    const d = await startDuel()
    await place(d, d.tokenA, "big", 1)
    await redisClient.hset(`match:${d.matchId}`, "placementDeadline", String(Date.now() - 1000))

    const late = await place(d, d.tokenB, "big", 3)

    expect(late.status).toBe(409)
    expect((await status(d, d.tokenA)).body).toMatchObject({ status: "cancelled", cancelReason: "placement_timeout" })
    for (const id of [d.idA, d.idB]) expect((await holdsOf(id))[0].status).toBe("released")
    expect((await getPlayer(d.idA)).balance).toBe("100.00")
    expect((await app.call("POST", "/api/match/start", d.tokenA)).status).toBe(200)
  })

  it("placement timeout found by the worker alone, without any request", async () => {
    const d = await startDuel()
    await redisClient.hset(`match:${d.matchId}`, "placementDeadline", String(Date.now() - 1000))

    await slowPass()

    expect((await holdsOf(d.idA))[0].status).toBe("released")
    expect((await holdsOf(d.idB))[0].status).toBe("released")
  })

  it(`a player who does not move for ${TURN_TIMEOUT} s loses the move, the opponent plays on`, async () => {
    const d = await startDuel()
    await placeAll(d)
    const past = String(Date.now() - 1000)
    await redisClient.hset(`match:${d.matchId}`, "turnDeadline", past)
    await redisClient.zadd("reveal:matches", past, d.matchId)

    await fastPass()

    const view = (await status(d, d.tokenB)).body
    expect(view.currentTurn).toBe(String(d.idB))
    expect(view.opponentMoves).toEqual([{ zone: "skipped", result: "skipped" }])
    expect((await move(d, d.tokenB, 1)).status).toBe(200)
  })

  it("a match where nobody moves at all ends by timeouts and pays the stakes back", async () => {
    const d = await startDuel()
    await placeAll(d)

    for (let i = 0; i < 4; i++) {
      const past = String(Date.now() - 1000)
      await redisClient.hset(`match:${d.matchId}`, "turnDeadline", past)
      await redisClient.zadd("reveal:matches", past, d.matchId)
      await fastPass()
    }

    expect((await status(d, d.tokenA)).body.status).toBe("ended")
    expect((await getPlayer(d.idA)).balance).toBe("100.00")
    expect((await getPlayer(d.idB)).balance).toBe("100.00")
  })

  it("a move after the own turn expired is refused", async () => {
    const d = await startDuel()
    await placeAll(d)
    await redisClient.hset(`match:${d.matchId}`, "turnDeadline", String(Date.now() - 1000))

    expect((await move(d, d.tokenA, 5)).status).toBe(409)
  })
})

describe("settlement survives a PostgreSQL failure", () => {
  it("the last move answers 200 even when settlement fails; the worker pays later, once", async () => {
    const d = await startDuel()
    await placeAll(d)
    await move(d, d.tokenA, 3)
    await move(d, d.tokenB, 5)
    await move(d, d.tokenA, 5)
    await pool.query("UPDATE balance_holds SET status = 'released' WHERE id = $1", [(await holdsOf(d.idB))[0].id])

    const ended = await move(d, d.tokenB, 4)

    expect(ended.status).toBe(200)
    expect(ended.body.status).toBe("ended")
    expect((await getPlayer(d.idA)).balance).toBe("100.00")
    expect(await redisClient.zcard("settlement:matches")).toBe(1)

    await pool.query("UPDATE balance_holds SET status = 'active' WHERE id = $1", [(await holdsOf(d.idB))[0].id])
    await slowPass()
    await slowPass()

    expect((await getPlayer(d.idA)).balance).toBe("103.60")
    expect((await pool.query("SELECT 1 FROM match_history")).rowCount).toBe(1)
  })
})
