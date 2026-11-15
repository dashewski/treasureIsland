import { pool } from "../db/pool"
import * as liveModule from "../matchmaking/checkPlayerInLiveMatch"
import { redisClient } from "../redis/redisClient"
import { addHold, createPlayer } from "../testing/factories"
import { makeRevealMatch, makeStartedMatch, makeWaitingMatch } from "../testing/matchSetup"
import { closeRedis, resetRedis } from "../testing/resetRedis"
import { resetDb } from "../testing/resetDb"
import { resolveMove } from "../reveal/resolveMove"
import { settleMatch } from "../settlement/settleMatch"
import { reconnect } from "./reconnect"

beforeEach(async () => {
  await resetDb()
  await resetRedis()
})
afterEach(() => {
  jest.restoreAllMocks()
})
afterAll(async () => {
  await pool.end()
  await closeRedis()
})

describe("reconnect", () => {
  it("none for a player who never played", async () => {
    const a = await createPlayer(1)
    expect(await reconnect(String(a))).toEqual({ reconnectResult: "none" })
  })

  it("currentMatch while the player waits for an opponent", async () => {
    const a = await createPlayer(1)
    const matchId = await makeWaitingMatch(a, await addHold(a))

    const answer = await reconnect(String(a))

    expect(answer).toMatchObject({ reconnectResult: "currentMatch", match: { matchId, status: "waiting" } })
  })

  it("currentMatch in placement shows own chests and hides the ones of the opponent", async () => {
    const a = await createPlayer(1)
    const b = await createPlayer(2)
    const matchId = await makeStartedMatch(a, await addHold(a), b, await addHold(b))
    await redisClient.hset(`match:${matchId}:placement`, "p1_big", "3", "p2_big", "4")

    const answer = await reconnect(String(a))

    expect(answer).toMatchObject({
      reconnectResult: "currentMatch",
      match: { status: "placement", myPlacement: { big: 3, small: null }, opponentPlaced: { big: true, small: false } },
    })
    expect(JSON.stringify(answer)).not.toContain("HoldId")
  })

  it("currentMatch in reveal for both players, each sees own view", async () => {
    const a = await createPlayer(1)
    const b = await createPlayer(2)
    await makeRevealMatch(a, await addHold(a), b, await addHold(b))

    const forA = await reconnect(String(a))
    const forB = await reconnect(String(b))

    expect(forA).toMatchObject({ match: { status: "reveal", myPlacement: { big: 1, small: 2 } } })
    expect(forB).toMatchObject({ match: { status: "reveal", myPlacement: { big: 3, small: 4 } } })
  })

  it("an ended match that is not settled yet is still the current match", async () => {
    const a = await createPlayer(1)
    const b = await createPlayer(2)
    const matchId = await makeRevealMatch(a, await addHold(a), b, await addHold(b))
    for (const [p, zone] of [[a, 3], [b, 5], [a, 5], [b, 4]] as const) await resolveMove(matchId, String(p), zone)

    const answer = await reconnect(String(a))

    expect(answer).toMatchObject({ reconnectResult: "currentMatch", match: { status: "ended" } })
  })

  it("lastFinishedMatch after the settlement, with the profit after the fee", async () => {
    const a = await createPlayer(1)
    const b = await createPlayer(2)
    const holdA = await addHold(a)
    const holdB = await addHold(b)
    const matchId = await makeRevealMatch(a, holdA, b, holdB)
    await pool.query(`UPDATE balance_holds SET "refId" = $1 WHERE id IN ($2, $3)`, [matchId, holdA, holdB])
    for (const [p, zone] of [[a, 3], [b, 5], [a, 5], [b, 4]] as const) await resolveMove(matchId, String(p), zone)
    await settleMatch(matchId)

    expect(await reconnect(String(a))).toMatchObject({
      reconnectResult: "lastFinishedMatch",
      match: { matchId, outcome: "win", netProfit: "3.60" },
    })
    expect(await reconnect(String(b))).toMatchObject({
      reconnectResult: "lastFinishedMatch",
      match: { matchId, outcome: "loss", netProfit: "-4.00" },
    })
  })

  it("falls back to the history when the pointer leads to a match that is gone", async () => {
    const a = await createPlayer(1)
    await redisClient.set(`player:${a}:currentMatch`, "550e8400-e29b-41d4-a716-446655440000")

    expect(await reconnect(String(a))).toEqual({ reconnectResult: "none" })
  })

  it("a technical error is thrown and never turned into none", async () => {
    const a = await createPlayer(1)
    jest.spyOn(liveModule, "checkPlayerInLiveMatch").mockRejectedValue(new Error("redis is down"))

    await expect(reconnect(String(a))).rejects.toThrow("redis is down")
  })
})
