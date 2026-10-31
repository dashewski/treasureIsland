import { pool } from "../db/pool"
import { addHold, createPlayer, getHold } from "../testing/factories"
import { resetDb } from "../testing/resetDb"
import { releaseHold } from "./releaseHold"

beforeEach(resetDb)

afterAll(async () => {
  await pool.end()
})

describe("releaseHold", () => {
  it("closes an active hold and returns true", async () => {
    const holdId = await addHold(await createPlayer(1))

    expect(await releaseHold(holdId, "released")).toBe(true)
    expect((await getHold(holdId)).status).toBe("released")
  })

  it("can close a hold as consumed", async () => {
    const holdId = await addHold(await createPlayer(1))

    expect(await releaseHold(holdId, "consumed")).toBe(true)
    expect((await getHold(holdId)).status).toBe("consumed")
  })

  it("a second call returns false and changes nothing", async () => {
    const holdId = await addHold(await createPlayer(1))
    await releaseHold(holdId, "released")

    expect(await releaseHold(holdId, "released")).toBe(false)
    expect((await getHold(holdId)).status).toBe("released")
  })

  it("does not turn a consumed hold into a released one", async () => {
    const holdId = await addHold(await createPlayer(1), { status: "consumed" })

    expect(await releaseHold(holdId, "released")).toBe(false)
    expect((await getHold(holdId)).status).toBe("consumed")
  })

  it("returns false for a hold that does not exist", async () => {
    expect(await releaseHold(999, "released")).toBe(false)
  })

  it("touches only the hold it was asked about", async () => {
    const first = await addHold(await createPlayer(1))
    const second = await addHold(await createPlayer(2))

    await releaseHold(first, "released")

    expect((await getHold(second)).status).toBe("active")
  })

  it("two calls at the same moment: exactly one closes the hold", async () => {
    const holdId = await addHold(await createPlayer(1))

    const results = await Promise.all([
      releaseHold(holdId, "released"),
      releaseHold(holdId, "released"),
      releaseHold(holdId, "released"),
    ])

    expect(results.filter(Boolean)).toHaveLength(1)
  })
})
