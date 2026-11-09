import { pool } from "../db/pool"
import { redisClient } from "../redis/redisClient"
import { addHold, createPlayer, getHold } from "../testing/factories"
import { resetDb } from "../testing/resetDb"
import { closeRedis, resetRedis } from "../testing/resetRedis"
import { createWaitingMatch } from "./createWaitingMatch"
import { getMatchAction } from "./getMatchAction"
import { joinWaitingMatch } from "./joinWaitingMatch"

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

// a player with a stake, as reserveBid would leave him
async function searchingPlayer(tgid: number) {
  const playerId = await createPlayer(tgid)
  const holdId = await addHold(playerId, { expiresInSeconds: 120 })
  return { playerId, holdId }
}

// the first player asks for an action, gets the right to create and creates the match
async function firstPlayerCreatesMatch() {
  const first = await searchingPlayer(1)
  const action = await getMatchAction(first.playerId)
  if (action?.action !== "create") throw new Error("expected the right to create")
  const matchId = await createWaitingMatch(first.playerId, first.holdId, action.token)
  if (matchId === null) throw new Error("the match was not created")
  return { first, matchId }
}

describe("matchmaking, the whole way through the real functions", () => {
  it("the first player creates a match, the second finds it and joins", async () => {
    const { first, matchId } = await firstPlayerCreatesMatch()
    const second = await searchingPlayer(2)

    const action = await getMatchAction(second.playerId)
    if (action?.action !== "join") throw new Error("expected to be sent to the waiting match")
    const match = await joinWaitingMatch(second.playerId, second.holdId, action.matchId, action.token)

    expect(action.matchId).toBe(matchId)
    expect(match).toMatchObject({
      matchId,
      status: "placement",
      player1: String(first.playerId),
      player2: String(second.playerId),
    })
  })

  it("after the join both stakes are tied to the match and both players point to it", async () => {
    const { first, matchId } = await firstPlayerCreatesMatch()
    const second = await searchingPlayer(2)
    const action = await getMatchAction(second.playerId)
    if (action?.action !== "join") throw new Error("expected to be sent to the waiting match")

    await joinWaitingMatch(second.playerId, second.holdId, action.matchId, action.token)

    for (const hold of [first.holdId, second.holdId]) {
      const row = await getHold(hold)
      expect(row.refId).toBe(matchId)
      expect(row.expiresAt).toBeNull()
    }
    expect(await redisClient.get(`player:${first.playerId}:currentMatch`)).toBe(matchId)
    expect(await redisClient.get(`player:${second.playerId}:currentMatch`)).toBe(matchId)
  })

  it("the match is gone from the queue for the next player, who gets the right to create", async () => {
    await firstPlayerCreatesMatch()
    const second = await searchingPlayer(2)
    const action = await getMatchAction(second.playerId)
    if (action?.action !== "join") throw new Error("expected to be sent to the waiting match")
    await joinWaitingMatch(second.playerId, second.holdId, action.matchId, action.token)
    const third = await searchingPlayer(3)

    expect(await getMatchAction(third.playerId)).toMatchObject({ action: "create" })
  })

  it("two players ask at the same moment: only one is sent to the waiting match", async () => {
    await firstPlayerCreatesMatch()
    const second = await searchingPlayer(2)
    const third = await searchingPlayer(3)

    const actions = await Promise.all([
      getMatchAction(second.playerId),
      getMatchAction(third.playerId),
    ])

    expect(actions.filter((action) => action?.action === "join")).toHaveLength(1)
  })

  it("a failed join puts the match back, and the next player can join it", async () => {
    const { first, matchId } = await firstPlayerCreatesMatch()
    const second = await searchingPlayer(2)
    const action = await getMatchAction(second.playerId)
    if (action?.action !== "join") throw new Error("expected to be sent to the waiting match")
    // the stake of the second player was closed in the meantime, so linking the holds fails
    await pool.query(`UPDATE balance_holds SET status = 'released' WHERE id = $1`, [second.holdId])

    await expect(
      joinWaitingMatch(second.playerId, second.holdId, action.matchId, action.token),
    ).rejects.toThrow("could not join, try again")

    const third = await searchingPlayer(3)
    const next = await getMatchAction(third.playerId)
    if (next?.action !== "join") throw new Error("expected the match to be waiting again")
    const match = await joinWaitingMatch(third.playerId, third.holdId, next.matchId, next.token)
    expect(next.matchId).toBe(matchId)
    expect(match).toMatchObject({
      status: "placement",
      player1: String(first.playerId),
      player2: String(third.playerId),
    })
  })
})
