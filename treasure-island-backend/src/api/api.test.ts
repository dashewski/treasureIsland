import { pool } from "../db/pool"
import * as startModule from "../matchmaking/startMatch"
import { redisClient } from "../redis/redisClient"
import { getPlayer } from "../testing/factories"
import { closeRedis, resetRedis } from "../testing/resetRedis"
import { resetDb } from "../testing/resetDb"
import { signInitData } from "../testing/telegram"
import { startTestApp, type TestApp } from "../testing/testApp"

let app: TestApp
const unknownMatch = "550e8400-e29b-41d4-a716-446655440000"

beforeAll(async () => {
  app = await startTestApp()
})
beforeEach(async () => {
  await resetDb()
  await resetRedis()
})
afterEach(() => {
  jest.restoreAllMocks()
})
afterAll(async () => {
  await app.close()
  await pool.end()
  await closeRedis()
})

describe("diagnostic routes", () => {
  it("health, database and redis answer", async () => {
    expect((await app.call("GET", "/health", null)).body).toEqual({ health: true })
    expect((await app.call("GET", "/database", null)).body).toEqual({ database: true })
    expect((await app.call("GET", "/redis", null)).body).toEqual({ redis: true })
  })
})

describe("POST /api/auth/telegram", () => {
  it("gives a token for valid initData and creates the player with the test balance", async () => {
    const answer = await app.call("POST", "/api/auth/telegram", null, {
      initData: signInitData({ id: 555, first_name: "Anna" }),
    })

    expect(answer.status).toBe(200)
    expect(typeof answer.body.token).toBe("string")
    expect((await getPlayer(1)).balance).toBe("100.00")
  })

  it("the same Telegram user logs in again as the same player", async () => {
    await app.login(555)
    await app.login(555)

    const { rows } = await pool.query("SELECT count(*)::int AS n FROM players")
    expect(rows[0].n).toBe(1)
  })

  it.each([
    ["a bad signature", { initData: "auth_date=1&hash=abc" }],
    ["no initData", {}],
    ["initData that is not a string", { initData: 5 }],
  ])("401 signIn error for %s", async (_name, body) => {
    const answer = await app.call("POST", "/api/auth/telegram", null, body)
    expect(answer.status).toBe(401)
    expect(answer.body).toEqual({ error: "signIn error" })
  })

  it("401 for an empty request without a body", async () => {
    expect((await app.call("POST", "/api/auth/telegram", null)).status).toBe(401)
  })

  it("400 for a body that is not JSON", async () => {
    const response = await fetch(`${app.baseUrl}/api/auth/telegram`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    })
    expect(response.status).toBe(400)
  })
})

describe("authentication of the other routes", () => {
  const routes: [string, string][] = [
    ["POST", "/api/match/start"],
    ["POST", "/api/match/place"],
    ["POST", "/api/match/move"],
    ["GET", `/api/match/${unknownMatch}`],
    ["GET", "/api/me/reconnect"],
  ]

  it.each(routes)("%s %s answers 401 without a token", async (method, path) => {
    expect((await app.call(method, path, null)).status).toBe(401)
  })

  it.each(routes)("%s %s answers 401 with a bad token", async (method, path) => {
    expect((await app.call(method, path, "garbage")).status).toBe(401)
  })

  it("401 when the scheme is not Bearer", async () => {
    const token = await app.login(1)
    const response = await fetch(`${app.baseUrl}/api/me/reconnect`, { headers: { Authorization: `Token ${token}` } })
    expect(response.status).toBe(401)
  })

  it("a bad token does not start a match", async () => {
    await app.call("POST", "/api/match/start", "garbage")
    expect(await redisClient.dbsize()).toBe(0)
  })
})

describe("errors of the game routes", () => {
  it("402 when the balance is too low", async () => {
    const token = await app.login(1)
    await pool.query("UPDATE players SET balance = 4")
    expect((await app.call("POST", "/api/match/start", token)).status).toBe(402)
  })

  it("409 when the player is already in a match", async () => {
    const token = await app.login(1)
    expect((await app.call("POST", "/api/match/start", token)).status).toBe(200)
    expect((await app.call("POST", "/api/match/start", token)).status).toBe(409)
  })

  it("two start requests of one player at the same moment: one match, one 409", async () => {
    const token = await app.login(1)
    jest.spyOn(console, "error").mockImplementation(() => {})

    const answers = await Promise.all([app.call("POST", "/api/match/start", token), app.call("POST", "/api/match/start", token)])

    expect(answers.map((a) => a.status).sort()).toEqual([200, 409])
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM balance_holds WHERE status = 'active'")
    expect(rows[0].n).toBe(1)
  })

  it("start ignores any stake or player id in the body", async () => {
    const token = await app.login(1)
    const answer = await app.call("POST", "/api/match/start", token, { bid: 100, playerId: 99 })
    expect(answer.body.bid).toBe("5.00")
  })

  it("400 for invalid match ids and invalid chest data", async () => {
    const token = await app.login(1)
    expect((await app.call("GET", "/api/match/not-a-uuid", token)).status).toBe(400)
    expect((await app.call("POST", "/api/match/place", token, { matchId: "x", chestType: "big", zoneId: 1 })).status).toBe(400)
    expect((await app.call("POST", "/api/match/move", token, { matchId: unknownMatch, zoneId: 9 })).status).toBe(404)
    expect((await app.call("POST", "/api/match/place", token, {})).status).toBe(400)
  })

  it("404 for a match that does not exist", async () => {
    const token = await app.login(1)
    expect((await app.call("GET", `/api/match/${unknownMatch}`, token)).status).toBe(404)
    expect((await app.call("POST", "/api/match/place", token, { matchId: unknownMatch, chestType: "big", zoneId: 1 })).status).toBe(404)
  })

  it("403 for a player who is not in the match, and nothing leaks", async () => {
    const owner = await app.login(1)
    const stranger = await app.login(2)
    const match = (await app.call("POST", "/api/match/start", owner)).body

    const answer = await app.call("GET", `/api/match/${match.matchId}`, stranger)

    expect(answer.status).toBe(403)
    expect(JSON.stringify(answer.body)).not.toContain(match.matchId)
    expect((await app.call("POST", "/api/match/move", stranger, { matchId: match.matchId, zoneId: 1 })).status).toBe(403)
  })

  it("409 for a chest while the match still waits for an opponent", async () => {
    const token = await app.login(1)
    const match = (await app.call("POST", "/api/match/start", token)).body
    const answer = await app.call("POST", "/api/match/place", token, { matchId: match.matchId, chestType: "big", zoneId: 1 })
    expect(answer.status).toBe(409)
  })

  it("an internal error becomes 500 without details", async () => {
    const token = await app.login(1)
    jest.spyOn(console, "error").mockImplementation(() => {})
    jest.spyOn(startModule, "startMatch").mockRejectedValue(new Error("password=secret host=db.internal"))

    const answer = await app.call("POST", "/api/match/start", token)

    expect(answer.status).toBe(500)
    expect(answer.body).toEqual({ error: "internal error" })
  })

  it("404 for an unknown route", async () => {
    const token = await app.login(1)
    expect((await app.call("GET", "/api/nothing", token)).status).toBe(404)
    expect((await app.call("GET", "/nothing", null)).status).toBe(404)
  })
})

describe("GET /api/me/reconnect", () => {
  it("none for a new player, currentMatch after start", async () => {
    const token = await app.login(1)
    expect((await app.call("GET", "/api/me/reconnect", token)).body).toEqual({ reconnectResult: "none" })

    const match = (await app.call("POST", "/api/match/start", token)).body
    const answer = await app.call("GET", "/api/me/reconnect", token)

    expect(answer.status).toBe(200)
    expect(answer.body).toMatchObject({ reconnectResult: "currentMatch", match: { matchId: match.matchId, status: "waiting" } })
  })
})
