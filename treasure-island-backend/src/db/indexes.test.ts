import { addHold, createPlayer } from "../testing/factories"
import { resetDb } from "../testing/resetDb"
import { pool } from "./pool"

beforeEach(resetDb)

afterAll(async () => {
  await pool.end()
})

// Fails until db/indexes.sql is written and applied to the test database.
describe("indexes", () => {
  it("all expected indexes exist", async () => {
    const { rows } = await pool.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'public'",
    )
    const names = rows.map((row) => row.indexname)

    for (const name of [
      "idx_holds_player_active",
      "idx_holds_expired",
      "unique_active_match_hold_per_player",
      "idx_history_player1",
      "idx_history_player2",
    ]) {
      expect(names).toContain(name)
    }
  })
})

describe("unique_active_match_hold_per_player", () => {
  it("rejects a second active match_bid of the same player", async () => {
    const playerId = await createPlayer(1)
    await addHold(playerId)

    await expect(addHold(playerId)).rejects.toMatchObject({ code: "23505" })
  })

  it("allows a new match_bid after the old one is released or consumed", async () => {
    const playerId = await createPlayer(1)
    await addHold(playerId, { status: "released" })
    await addHold(playerId, { status: "consumed" })

    await expect(addHold(playerId)).resolves.toEqual(expect.any(Number))
  })

  it("does not apply to withdrawal holds", async () => {
    const playerId = await createPlayer(1)
    await addHold(playerId)
    await addHold(playerId, { type: "withdrawal" })
    await expect(addHold(playerId, { type: "withdrawal" })).resolves.toEqual(expect.any(Number))
  })

  it("lets different players have an active match_bid each", async () => {
    await addHold(await createPlayer(1))
    await expect(addHold(await createPlayer(2))).resolves.toEqual(expect.any(Number))
  })
})
