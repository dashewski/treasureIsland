import { pool } from "../db/pool"
import { addHold, createPlayer, getHold } from "../testing/factories"
import { resetDb } from "../testing/resetDb"
import { linkHoldsToMatch } from "./linkHoldsToMatch"

const matchId = "550e8400-e29b-41d4-a716-446655440000"

beforeEach(resetDb)

afterAll(async () => {
  await pool.end()
})

async function twoSearchingPlayers() {
  const first = await addHold(await createPlayer(1), { expiresInSeconds: 120 })
  const second = await addHold(await createPlayer(2), { expiresInSeconds: 120 })
  return { first, second }
}

describe("linkHoldsToMatch", () => {
  it("ties both holds to the match and removes the safety timer", async () => {
    const { first, second } = await twoSearchingPlayers()

    await linkHoldsToMatch(matchId, first, second)

    for (const id of [first, second]) {
      const hold = await getHold(id)
      expect(hold.refId).toBe(matchId)
      expect(hold.expiresAt).toBeNull()
      expect(hold.status).toBe("active")
    }
  })

  it("leaves other holds alone", async () => {
    const { first, second } = await twoSearchingPlayers()
    const other = await addHold(await createPlayer(3), { expiresInSeconds: 120 })

    await linkHoldsToMatch(matchId, first, second)

    const hold = await getHold(other)
    expect(hold.refId).toBeNull()
    expect(hold.expiresAt).not.toBeNull()
  })

  it("changes nothing and throws when one hold is no longer active", async () => {
    const { first, second } = await twoSearchingPlayers()
    await pool.query("UPDATE balance_holds SET status = 'released' WHERE id = $1", [second])

    await expect(linkHoldsToMatch(matchId, first, second)).rejects.toThrow("not active")

    const hold = await getHold(first)
    expect(hold.refId).toBeNull()
    expect(hold.expiresAt).not.toBeNull()
  })

  it("throws when a hold does not exist and links nothing", async () => {
    const { first } = await twoSearchingPlayers()

    await expect(linkHoldsToMatch(matchId, first, 999)).rejects.toThrow("not active")

    expect((await getHold(first)).refId).toBeNull()
  })

  it("throws when the same hold is given twice", async () => {
    const { first } = await twoSearchingPlayers()

    await expect(linkHoldsToMatch(matchId, first, first)).rejects.toThrow("not active")

    expect((await getHold(first)).refId).toBeNull()
  })
})
