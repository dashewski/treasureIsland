import { pool } from "../db/pool"
import { createPlayer } from "../testing/factories"
import { resetDb } from "../testing/resetDb"
import { getLastFinishedMatch } from "./getLastFinishedMatch"

beforeEach(resetDb)

afterAll(async () => {
  await pool.end()
})

async function addMatch(
  matchId: string,
  player1Id: number,
  player2Id: number,
  minutesAgo: number,
  result = "played",
) {
  await pool.query(
    `INSERT INTO match_history ("matchId", "player1Id", "player2Id", bid, result, "finishedAt")
     VALUES ($1, $2, $3, 5, $4, NOW() - make_interval(mins => $5))`,
    [matchId, player1Id, player2Id, result, minutesAgo],
  )
}

describe("getLastFinishedMatch", () => {
  it("returns null for a player without matches", async () => {
    const playerId = await createPlayer(1)
    expect(await getLastFinishedMatch(playerId)).toBeNull()
  })

  it("returns the newest match of the player", async () => {
    const a = await createPlayer(1)
    const b = await createPlayer(2)
    await addMatch("old", a, b, 60)
    await addMatch("newest", a, b, 5)
    await addMatch("middle", a, b, 30)

    expect((await getLastFinishedMatch(a))?.matchId).toBe("newest")
  })

  it("finds the match whether the player was first or second", async () => {
    const a = await createPlayer(1)
    const b = await createPlayer(2)
    await addMatch("m1", a, b, 5)

    expect((await getLastFinishedMatch(a))?.matchId).toBe("m1")
    expect((await getLastFinishedMatch(b))?.matchId).toBe("m1")
  })

  it("skips cancelled matches", async () => {
    const a = await createPlayer(1)
    const b = await createPlayer(2)
    await addMatch("played", a, b, 60)
    await addMatch("cancelled", a, b, 1, "cancelled")

    expect((await getLastFinishedMatch(a))?.matchId).toBe("played")
  })

  it("returns null when the only match is cancelled", async () => {
    const a = await createPlayer(1)
    const b = await createPlayer(2)
    await addMatch("cancelled", a, b, 1, "cancelled")

    expect(await getLastFinishedMatch(a)).toBeNull()
  })

  it("ignores the matches of other players", async () => {
    const a = await createPlayer(1)
    const b = await createPlayer(2)
    const c = await createPlayer(3)
    await addMatch("not-mine", b, c, 1)

    expect(await getLastFinishedMatch(a)).toBeNull()
  })

  it("returns the amounts as strings and the time as a Date", async () => {
    const a = await createPlayer(1)
    const b = await createPlayer(2)
    await addMatch("m1", a, b, 1)

    const row = await getLastFinishedMatch(a)
    expect(row?.bid).toBe("5.00")
    expect(row?.finishedAt).toBeInstanceOf(Date)
  })
})
