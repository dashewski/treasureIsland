import type { PoolClient } from "pg"
import { createPlayer, getPlayer } from "../testing/factories"
import { resetDb } from "../testing/resetDb"
import { pool } from "./pool"
import { withTransaction } from "./transaction"

beforeEach(resetDb)

afterAll(async () => {
  await pool.end()
})

describe("withTransaction", () => {
  it("commits the work and returns its result", async () => {
    const playerId = await createPlayer(1, 20)

    const result = await withTransaction(async (client) => {
      await client.query("UPDATE players SET balance = 50 WHERE id = $1", [playerId])
      return "done"
    })

    expect(result).toBe("done")
    expect((await getPlayer(playerId)).balance).toBe("50.00")
  })

  it("rolls the work back and rethrows when it fails", async () => {
    const playerId = await createPlayer(1, 20)

    await expect(
      withTransaction(async (client) => {
        await client.query("UPDATE players SET balance = 50 WHERE id = $1", [playerId])
        throw new Error("boom")
      }),
    ).rejects.toThrow("boom")

    expect((await getPlayer(playerId)).balance).toBe("20.00")
  })

  it("discards a connection that cannot roll back", async () => {
    const release = jest.fn()
    const dead = {
      query: async (sql: string) => {
        if (sql === "BEGIN") return {}
        throw new Error("connection lost")
      },
      release,
    }
    const spy = jest.spyOn(pool, "connect").mockImplementation((async () => dead) as never)

    try {
      await expect(withTransaction(async () => "never")).rejects.toThrow()
      expect(release).toHaveBeenCalledWith(true)
    } finally {
      spy.mockRestore()
    }
  })

  it("returns a healthy connection to the pool", async () => {
    const realConnect = pool.connect.bind(pool) as () => Promise<PoolClient>
    let release: jest.SpyInstance | undefined
    const spy = jest.spyOn(pool, "connect").mockImplementation((async () => {
      const client = await realConnect()
      release = jest.spyOn(client, "release")
      return client
    }) as never)

    try {
      await withTransaction(async () => "ok")
      expect(release).toHaveBeenCalledWith(false)
    } finally {
      spy.mockRestore()
    }
  })

  it("gives the connection back, even after many failures", async () => {
    // the pool has 10 connections, a leak would hang after the tenth failure
    for (let i = 0; i < 15; i++) {
      await expect(
        withTransaction(async () => {
          throw new Error("boom")
        }),
      ).rejects.toThrow("boom")
    }

    expect(await withTransaction(async () => "still works")).toBe("still works")
  })
})
