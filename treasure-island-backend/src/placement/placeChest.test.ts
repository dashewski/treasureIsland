import { pool } from "../db/pool"
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../errors"
import { redisClient } from "../redis/redisClient"
import { addHold, createPlayer, getHold } from "../testing/factories"
import { makeStartedMatch, makeWaitingMatch } from "../testing/matchSetup"
import { resetDb } from "../testing/resetDb"
import { closeRedis, resetRedis } from "../testing/resetRedis"
import { placeChest } from "./placeChest"
import * as resolveModule from "./resolvePlacement"

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

// two real players with stakes, the match is already in the placement phase
async function startedMatch() {
  const player1 = await createPlayer(1)
  const player2 = await createPlayer(2)
  const hold1 = await addHold(player1, { expiresInSeconds: 120 })
  const hold2 = await addHold(player2, { expiresInSeconds: 120 })
  const matchId = await makeStartedMatch(player1, hold1, player2, hold2)
  return { p1: String(player1), p2: String(player2), hold1, hold2, matchId }
}

describe("placeChest: who and what", () => {
  it("rejects a matchId that is not a UUID before touching Redis", async () => {
    await expect(placeChest("current", "1", "big", 3)).rejects.toThrow(ValidationError)
    await expect(placeChest("current", "1", "big", 3)).rejects.toThrow("invalid match id")
  })

  it("not found for an unknown match", async () => {
    await expect(
      placeChest("550e8400-e29b-41d4-a716-446655440000", "1", "big", 3),
    ).rejects.toThrow(NotFoundError)
  })

  it("forbidden for a player who is not in the match", async () => {
    const { matchId } = await startedMatch()

    await expect(placeChest(matchId, "999", "big", 3)).rejects.toThrow(ForbiddenError)
    expect(await redisClient.exists(`match:${matchId}:placement`)).toBe(0)
  })

  it("conflict when the match is not in the placement phase", async () => {
    const matchId = await makeWaitingMatch(7, 11)

    await expect(placeChest(matchId, "7", "big", 3)).rejects.toThrow("not in placement phase")
  })

  it.each([
    ["zone 0", "big", 0],
    ["zone 6", "big", 6],
    ["zone 2.5", "small", 2.5],
    ["zone as text", "small", "3"],
    ["unknown chest", "medium", 3],
  ])("validation error for %s, nothing written", async (_name, chest, zone) => {
    const { p1, matchId } = await startedMatch()

    await expect(placeChest(matchId, p1, chest, zone)).rejects.toThrow(ValidationError)
    expect(await redisClient.exists(`match:${matchId}:placement`)).toBe(0)
  })
})

describe("placeChest: placing", () => {
  it("returns my own chests and what the opponent has placed, no hold ids", async () => {
    const { p1, matchId } = await startedMatch()

    const response = await placeChest(matchId, p1, "big", 3)

    expect(response).toMatchObject({
      matchId,
      status: "placement",
      myPlacement: { big: 3, small: null },
      opponentPlaced: { big: false, small: false },
    })
    expect(JSON.stringify(response)).not.toContain("HoldId")
  })

  it("the opponent sees only that a chest exists, not its zone", async () => {
    const { p1, p2, matchId } = await startedMatch()
    await placeChest(matchId, p1, "big", 3)

    const response = await placeChest(matchId, p2, "small", 5)

    expect(response.opponentPlaced).toEqual({ big: true, small: false })
    expect(response).not.toHaveProperty("opponentPlacement")
  })

  it("conflict for a chest that is already placed, the first zone stays", async () => {
    const { p1, matchId } = await startedMatch()
    await placeChest(matchId, p1, "big", 3)

    await expect(placeChest(matchId, p1, "big", 4)).rejects.toThrow("chest already placed")

    expect(await redisClient.hget(`match:${matchId}:placement`, "p1_big")).toBe("3")
  })

  it("conflict when both chests of a player would be in one zone", async () => {
    const { p1, matchId } = await startedMatch()
    await placeChest(matchId, p1, "big", 3)

    await expect(placeChest(matchId, p1, "small", 3)).rejects.toThrow(
      "you already placed another chest in this zone",
    )
    await expect(placeChest(matchId, p1, "small", 3)).rejects.toThrow(ConflictError)
  })

  it("the fourth chest starts reveal: the first turn belongs to player1", async () => {
    const { p1, p2, matchId } = await startedMatch()
    await placeChest(matchId, p1, "big", 1)
    await placeChest(matchId, p1, "small", 2)
    await placeChest(matchId, p2, "big", 3)

    const response = await placeChest(matchId, p2, "small", 4)

    expect(response).toMatchObject({ status: "reveal", currentTurn: p1 })
    expect(response.turnDeadline).toEqual(expect.any(Number))
    expect(response).not.toHaveProperty("opponentPlacement")
  })
})

describe("placeChest: the time is over", () => {
  it("cancels the match, gives both stakes back and says the time expired", async () => {
    const { p1, hold1, hold2, matchId } = await startedMatch()
    await redisClient.hset(`match:${matchId}`, "placementDeadline", String(Date.now() - 1000))

    await expect(placeChest(matchId, p1, "big", 3)).rejects.toThrow("placement time expired")

    expect(await redisClient.hget(`match:${matchId}`, "status")).toBe("cancelled")
    expect((await getHold(hold1)).status).toBe("released")
    expect((await getHold(hold2)).status).toBe("released")
  })

  it("the same when the time runs out between the check and the write", async () => {
    const { p1, hold1, hold2, matchId } = await startedMatch()
    jest.spyOn(resolveModule, "resolvePlacement").mockImplementation(async () => {
      await redisClient.hset(`match:${matchId}`, "placementDeadline", String(Date.now() - 1000))
      return "placement_timeout"
    })

    await expect(placeChest(matchId, p1, "big", 3)).rejects.toThrow("placement time expired")

    expect(await redisClient.hget(`match:${matchId}`, "status")).toBe("cancelled")
    expect((await getHold(hold1)).status).toBe("released")
    expect((await getHold(hold2)).status).toBe("released")
  })

  it("a second request after the cancel does not release the holds again", async () => {
    const { p1, hold1, matchId } = await startedMatch()
    await redisClient.hset(`match:${matchId}`, "placementDeadline", String(Date.now() - 1000))
    await expect(placeChest(matchId, p1, "big", 3)).rejects.toThrow("placement time expired")

    await expect(placeChest(matchId, p1, "big", 3)).rejects.toThrow("not in placement phase")

    expect((await getHold(hold1)).status).toBe("released")
  })
})
