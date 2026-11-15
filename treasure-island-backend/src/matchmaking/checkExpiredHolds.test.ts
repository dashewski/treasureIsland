import { pool } from "../db/pool"
import { redisClient } from "../redis/redisClient"
import { addHold, createPlayer, getHold } from "../testing/factories"
import { makeStartedMatch, makeWaitingMatch } from "../testing/matchSetup"
import { closeRedis, resetRedis } from "../testing/resetRedis"
import { resetDb } from "../testing/resetDb"
import { checkExpiredHolds } from "./checkExpiredHolds"
import { checkPlayerInLiveMatch } from "./checkPlayerInLiveMatch"
import { recoverOrphanedHold } from "./recoverOrphanedHold"

const gone = "550e8400-e29b-41d4-a716-446655440000"

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

async function historyOf(matchId: string) {
  const { rows } = await pool.query(`SELECT * FROM match_history WHERE "matchId" = $1`, [matchId])
  return rows
}

describe("checkPlayerInLiveMatch", () => {
  it("null without a pointer, null when the pointer leads nowhere", async () => {
    expect(await checkPlayerInLiveMatch(7)).toBeNull()
    await redisClient.set("player:7:currentMatch", gone)
    expect(await checkPlayerInLiveMatch(7)).toBeNull()
  })

  it("gives the match and the hold ids", async () => {
    const matchId = await makeStartedMatch(7, 11, 8, 12)
    expect(await checkPlayerInLiveMatch("8")).toEqual({
      matchId,
      status: "placement",
      player1HoldId: "11",
      player2HoldId: "12",
    })
  })
})

describe("recoverOrphanedHold", () => {
  it("does nothing while the match is still in Redis", async () => {
    const p = await createPlayer(1)
    const holdId = await addHold(p, { refId: gone })
    await redisClient.hset(`match:${gone}`, "status", "reveal")

    expect(await recoverOrphanedHold(holdId, gone)).toBe("match_exists")

    expect((await getHold(holdId)).status).toBe("active")
    expect(await historyOf(gone)).toHaveLength(0)
  })

  it("releases the stake and writes a cancelled history row when the match is gone", async () => {
    const p = await createPlayer(1)
    const holdId = await addHold(p, { refId: gone })

    expect(await recoverOrphanedHold(holdId, gone)).toBe("orphaned_recovered")

    expect((await getHold(holdId)).status).toBe("released")
    const rows = await historyOf(gone)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ result: "cancelled", cancelReason: "redis_state_lost" })
  })

  it("the second hold of the same match does not fail on the unique matchId", async () => {
    const a = await createPlayer(1)
    const b = await createPlayer(2)
    const holdA = await addHold(a, { refId: gone })
    const holdB = await addHold(b, { refId: gone })

    await recoverOrphanedHold(holdA, gone)
    await recoverOrphanedHold(holdB, gone)

    expect((await getHold(holdB)).status).toBe("released")
    expect(await historyOf(gone)).toHaveLength(1)
  })
})

describe("checkExpiredHolds: expired holds", () => {
  it("releases an expired hold when the player has no match", async () => {
    const p = await createPlayer(1)
    const holdId = await addHold(p, { expiresInSeconds: -5 })

    expect(await checkExpiredHolds()).toBe(1)

    expect((await getHold(holdId)).status).toBe("released")
  })

  it("leaves a hold alone while its time is not over", async () => {
    const p = await createPlayer(1)
    const holdId = await addHold(p, { expiresInSeconds: 60 })

    expect(await checkExpiredHolds()).toBe(0)

    expect((await getHold(holdId)).status).toBe("active")
  })

  it("keeps the hold of a player who still waits for an opponent", async () => {
    const p = await createPlayer(1)
    const holdId = await addHold(p, { expiresInSeconds: -5 })
    await makeWaitingMatch(p, holdId)

    await checkExpiredHolds()

    expect((await getHold(holdId)).status).toBe("active")
    expect(await redisClient.exists(`player:${p}:currentMatch`)).toBe(1)
  })

  it("cancels a waiting match that is too old and releases its hold", async () => {
    const p = await createPlayer(1)
    const holdId = await addHold(p, { expiresInSeconds: -5 })
    const matchId = await makeWaitingMatch(p, holdId)
    await redisClient.hset(`match:${matchId}`, "createdAt", String(Date.now() - 200_000))

    await checkExpiredHolds()

    expect((await getHold(holdId)).status).toBe("released")
    expect(await redisClient.hget(`match:${matchId}`, "status")).toBe("cancelled")
  })

  it("repairs the link of a running match instead of releasing the hold", async () => {
    const a = await createPlayer(1)
    const b = await createPlayer(2)
    const holdA = await addHold(a, { expiresInSeconds: -5 })
    const holdB = await addHold(b, { expiresInSeconds: -5 })
    const matchId = await makeStartedMatch(a, holdA, b, holdB)

    await checkExpiredHolds()

    for (const id of [holdA, holdB]) {
      const hold = await getHold(id)
      expect(hold.status).toBe("active")
      expect(hold.refId).toBe(matchId)
      expect(hold.expiresAt).toBeNull()
    }
  })

  it("does not touch a hold that is not part of the live match of the player", async () => {
    const a = await createPlayer(1)
    const b = await createPlayer(2)
    const holdA = await addHold(a)
    const holdB = await addHold(b)
    await makeStartedMatch(a, holdA, b, holdB)
    await pool.query(`UPDATE balance_holds SET status = 'released' WHERE id = $1`, [holdB])
    const stray = await addHold(b, { expiresInSeconds: -5 })

    await checkExpiredHolds()

    expect((await getHold(stray)).status).toBe("active")
  })

  it("an error with one hold does not stop the others", async () => {
    const a = await createPlayer(1)
    const b = await createPlayer(2)
    const holdA = await addHold(a, { expiresInSeconds: -5 })
    const holdB = await addHold(b, { expiresInSeconds: -5 })
    // a pointer to a match whose hash is broken makes the check of player 1 fail
    await redisClient.set(`player:${a}:currentMatch`, gone)
    await redisClient.hset(`match:${gone}`, "status", "waiting")
    await redisClient.hset(`match:${gone}`, "createdAt", "not-a-number")

    await checkExpiredHolds()

    expect((await getHold(holdB)).status).toBe("released")
    expect((await getHold(holdA)).status).toBe("active")
  })
})

describe("checkExpiredHolds: holds tied to a match that is gone", () => {
  it("returns the stakes of both players and writes one history row", async () => {
    const a = await createPlayer(1)
    const b = await createPlayer(2)
    const holdA = await addHold(a, { refId: gone })
    const holdB = await addHold(b, { refId: gone })

    expect(await checkExpiredHolds()).toBe(2)

    expect((await getHold(holdA)).status).toBe("released")
    expect((await getHold(holdB)).status).toBe("released")
    expect(await historyOf(gone)).toHaveLength(1)
  })

  it("leaves holds of a match that still exists in Redis", async () => {
    const a = await createPlayer(1)
    const b = await createPlayer(2)
    const holdA = await addHold(a)
    const holdB = await addHold(b)
    const matchId = await makeStartedMatch(a, holdA, b, holdB)
    await pool.query(`UPDATE balance_holds SET "refId" = $1 WHERE id IN ($2, $3)`, [matchId, holdA, holdB])

    expect(await checkExpiredHolds()).toBe(0)

    expect((await getHold(holdA)).status).toBe("active")
  })

  it("does not touch withdrawal holds", async () => {
    const a = await createPlayer(1)
    const holdId = await addHold(a, { type: "withdrawal", refId: "15" })

    await checkExpiredHolds()

    expect((await getHold(holdId)).status).toBe("active")
  })
})
