import { pool } from "../db/pool"
import { resetDb } from "../testing/resetDb"
import { reserveBid } from "./reserveBid"

async function createPlayer(tgid: number, balance = 20): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    "INSERT INTO players (tgid, player, balance) VALUES ($1, 'test', $2) RETURNING id",
    [tgid, balance],
  )
  return rows[0]!.id
}

beforeEach(resetDb)

afterAll(async () => {
  await pool.end()
})

describe("reserveBid", () => {
  it("creates an active match_bid hold and returns its id", async () => {
    const playerId = await createPlayer(1)

    const holdId = await reserveBid(playerId)

    expect(typeof holdId).toBe("number")
    const { rows } = await pool.query("SELECT * FROM balance_holds WHERE id = $1", [holdId])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      playerId,
      type: "match_bid",
      amount: "5.00",
      status: "active",
      refId: null,
    })
  })

  it("sets expiresAt about two minutes ahead", async () => {
    const playerId = await createPlayer(1)
    const holdId = await reserveBid(playerId)

    const { rows } = await pool.query<{ seconds: number }>(
      `SELECT EXTRACT(EPOCH FROM ("expiresAt" - NOW()))::int AS seconds
       FROM balance_holds WHERE id = $1`,
      [holdId],
    )
    expect(rows[0]!.seconds).toBeGreaterThan(110)
    expect(rows[0]!.seconds).toBeLessThanOrEqual(120)
  })

  it("does not change the balance, it only freezes the stake", async () => {
    const playerId = await createPlayer(1, 20)
    await reserveBid(playerId)

    const { rows } = await pool.query("SELECT balance FROM players WHERE id = $1", [playerId])
    expect(rows[0].balance).toBe("20.00")
  })

  it("different players each get their own hold", async () => {
    const a = await createPlayer(1)
    const b = await createPlayer(2)

    const holdA = await reserveBid(a)
    const holdB = await reserveBid(b)

    expect(holdA).not.toBe(holdB)
  })
})
