import type { PoolClient } from "pg"
import { MAX_DEADLOCK_ATTEMPTS } from "../constants"
import { pool } from "../db/pool"
import { AlreadyInGameError, InsufficientBalanceError } from "../errors"
import { addHold, createPlayer, getPlayer, holdsOf } from "../testing/factories"
import { resetDb } from "../testing/resetDb"
import { releaseHold } from "./releaseHold"
import { reserveBid } from "./reserveBid"

beforeEach(resetDb)

afterAll(async () => {
  await pool.end()
})

// a connection whose queries fail with the given PostgreSQL error code
function failingClient(code: string): PoolClient {
  return {
    query: async (sql: string) => {
      if (sql === "BEGIN" || sql === "ROLLBACK") return {}
      throw Object.assign(new Error("simulated failure"), { code })
    },
    release: () => {},
  } as unknown as PoolClient
}

// the first `failures` calls of pool.connect return a failing client, then the real one
function breakConnections(code: string, failures: number) {
  const realConnect = pool.connect.bind(pool) as () => Promise<PoolClient>
  const state = { calls: 0 }
  const spy = jest.spyOn(pool, "connect").mockImplementation((() => {
    state.calls++
    return state.calls <= failures ? Promise.resolve(failingClient(code)) : realConnect()
  }) as never)
  return { state, restore: () => spy.mockRestore() }
}

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

    expect((await getPlayer(playerId)).balance).toBe("20.00")
  })

  it("different players each get their own hold", async () => {
    const a = await createPlayer(1)
    const b = await createPlayer(2)

    const holdA = await reserveBid(a)
    const holdB = await reserveBid(b)

    expect(holdA).not.toBe(holdB)
  })

  it("fails for a player that does not exist", async () => {
    await expect(reserveBid(999)).rejects.toThrow("not found")
  })
})

describe("reserveBid balance check", () => {
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
    await addHold(playerId, { type: "withdrawal", amount: 7 })

    await expect(reserveBid(playerId)).rejects.toBeInstanceOf(InsufficientBalanceError)
  })

  it("counts released and consumed holds as free money", async () => {
    const playerId = await createPlayer(1, 10)
    await addHold(playerId, { type: "withdrawal", amount: 7, status: "released" })
    await addHold(playerId, { status: "consumed" })

    await expect(reserveBid(playerId)).resolves.toEqual(expect.any(Number))
  })
})

describe("reserveBid already in game", () => {
  it("refuses a player that already has an active match_bid", async () => {
    const playerId = await createPlayer(1, 100)
    await reserveBid(playerId)

    await expect(reserveBid(playerId)).rejects.toBeInstanceOf(AlreadyInGameError)
    expect(await holdsOf(playerId)).toHaveLength(1)
  })

  it("answers already in game before not enough balance", async () => {
    const playerId = await createPlayer(1, 0)
    await addHold(playerId)

    await expect(reserveBid(playerId)).rejects.toBeInstanceOf(AlreadyInGameError)
  })

  it("lets the player search again after the hold is released", async () => {
    const playerId = await createPlayer(1, 100)
    const first = await reserveBid(playerId)
    await releaseHold(first, "released")

    const second = await reserveBid(playerId)

    expect(second).not.toBe(first)
  })

  it("an active withdrawal hold is not a game", async () => {
    const playerId = await createPlayer(1, 100)
    await addHold(playerId, { type: "withdrawal", amount: 10 })

    await expect(reserveBid(playerId)).resolves.toEqual(expect.any(Number))
  })
})

describe("reserveBid at the same moment", () => {
  it("five calls for one player create exactly one hold", async () => {
    const playerId = await createPlayer(1, 100)

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => reserveBid(playerId)),
    )

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
    for (const result of results) {
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(AlreadyInGameError)
      }
    }
    expect(await holdsOf(playerId)).toHaveLength(1)
  })

  it("calls for different players do not block each other", async () => {
    const players = await Promise.all([1, 2, 3, 4].map((tgid) => createPlayer(tgid, 100)))

    const holds = await Promise.all(players.map((id) => reserveBid(id)))

    expect(new Set(holds).size).toBe(4)
  })

  it("a player with exactly the stake cannot start two games", async () => {
    const playerId = await createPlayer(1, 5)

    const results = await Promise.allSettled([reserveBid(playerId), reserveBid(playerId)])

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
    expect(await holdsOf(playerId)).toHaveLength(1)
  })
})

describe("reserveBid database errors", () => {
  it("runs the whole transaction again after a deadlock", async () => {
    const playerId = await createPlayer(1, 100)
    const broken = breakConnections("40P01", 1)

    try {
      const holdId = await reserveBid(playerId)
      expect(typeof holdId).toBe("number")
      expect(broken.state.calls).toBe(2)
    } finally {
      broken.restore()
    }
    expect(await holdsOf(playerId)).toHaveLength(1)
  })

  it("gives up after the maximum number of deadlock attempts", async () => {
    const playerId = await createPlayer(1, 100)
    const broken = breakConnections("40P01", 100)

    try {
      await expect(reserveBid(playerId)).rejects.toMatchObject({ code: "40P01" })
      expect(broken.state.calls).toBe(MAX_DEADLOCK_ATTEMPTS)
    } finally {
      broken.restore()
    }
  })

  it("turns a unique index violation into already in game, without retries", async () => {
    const playerId = await createPlayer(1, 100)
    const broken = breakConnections("23505", 100)

    try {
      await expect(reserveBid(playerId)).rejects.toBeInstanceOf(AlreadyInGameError)
      expect(broken.state.calls).toBe(1)
    } finally {
      broken.restore()
    }
  })

  it("does not hide other database errors", async () => {
    const playerId = await createPlayer(1, 100)
    const broken = breakConnections("57P01", 100)

    try {
      await expect(reserveBid(playerId)).rejects.toMatchObject({ code: "57P01" })
      expect(broken.state.calls).toBe(1)
    } finally {
      broken.restore()
    }
  })
})
