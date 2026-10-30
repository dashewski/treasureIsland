import { pool } from "../db/pool"
import { InsufficientBalanceError } from "../errors"
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

describe("reserveBid balance check", () => {
  async function holdsOf(playerId: number) {
    const { rows } = await pool.query(`SELECT * FROM balance_holds WHERE "playerId" = $1`, [playerId])
    return rows
  }

  async function addHold(playerId: number, type: string, amount: number, status = "active") {
    await pool.query(
      `INSERT INTO balance_holds ("playerId", type, amount, status) VALUES ($1, $2, $3, $4)`,
      [playerId, type, amount, status],
    )
  }

  it("lets a player with exactly the stake in", async () => {
    const playerId = await createPlayer(1, 5)
    await expect(reserveBid(playerId)).resolves.toEqual(expect.any(Number))
  })

  it("refuses one cent less than the stake and creates no hold", async () => {
    const playerId = await createPlayer(1, 4.99)

    await expect(reserveBid(playerId)).rejects.toBeInstanceOf(InsufficientBalanceError)
    expect(await holdsOf(playerId)).toHaveLength(0)
  })

  it("refuses a player with a zero balance", async () => {
    const playerId = await createPlayer(1, 0)
    await expect(reserveBid(playerId)).rejects.toBeInstanceOf(InsufficientBalanceError)
  })

  it("does not count frozen money as free", async () => {
    const playerId = await createPlayer(1, 10)
    await addHold(playerId, "withdrawal", 7)

    await expect(reserveBid(playerId)).rejects.toBeInstanceOf(InsufficientBalanceError)
  })

  it("counts released and consumed holds as free money", async () => {
    const playerId = await createPlayer(1, 10)
    await addHold(playerId, "withdrawal", 7, "released")
    await addHold(playerId, "match_bid", 5, "consumed")

    await expect(reserveBid(playerId)).resolves.toEqual(expect.any(Number))
  })

  it("fails for a player that does not exist", async () => {
    await expect(reserveBid(999)).rejects.toThrow("not found")
  })
})
