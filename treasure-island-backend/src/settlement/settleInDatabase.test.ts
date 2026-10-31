import { pool } from "../db/pool"
import { calcSettlement } from "../domain/calcSettlement"
import type { MoveResult } from "../types/match"
import { addHold, createPlayer, getHold, getPlayer } from "../testing/factories"
import { resetDb } from "../testing/resetDb"
import { settleInDatabase, type SettleInDatabaseInput } from "./settleInDatabase"

const matchId = "550e8400-e29b-41d4-a716-446655440000"

beforeEach(resetDb)

afterAll(async () => {
  await pool.end()
})

// stake 5, chests 4 and 1; p1 and p2 are the results of the two players' moves
function settlementFor(p1: [MoveResult, MoveResult], p2: [MoveResult, MoveResult]) {
  return calcSettlement({
    status: "ended",
    bid: "5",
    bigAmount: "4",
    smallAmount: "1",
    reveal: {
      p1_move_1_result: p1[0],
      p1_move_2_result: p1[1],
      p2_move_1_result: p2[0],
      p2_move_2_result: p2[1],
    },
  })
}

// two players with 20 each, both stakes frozen and linked to the match
async function matchReadyToSettle(settlement = settlementFor(["hit_big", "miss"], ["miss", "miss"])) {
  const player1Id = await createPlayer(1, 20)
  const player2Id = await createPlayer(2, 20)
  const player1HoldId = await addHold(player1Id, { refId: matchId })
  const player2HoldId = await addHold(player2Id, { refId: matchId })
  const input: SettleInDatabaseInput = {
    matchId,
    player1Id,
    player2Id,
    player1HoldId,
    player2HoldId,
    bidCents: 500,
    settlement,
    moves: { placement: { p1_big: 1 }, reveal: { p1_move_1_result: "hit_big" } },
  }
  return input
}

async function historyRows() {
  const { rows } = await pool.query(`SELECT * FROM match_history WHERE "matchId" = $1`, [matchId])
  return rows
}

describe("settleInDatabase", () => {
  it("pays both players and consumes both holds", async () => {
    const input = await matchReadyToSettle()

    expect(await settleInDatabase(input)).toBe("settled")

    // player 1 found the big chest: result 9, fee 0.40, payout 8.60; player 2 gets 1.00
    const p1 = await getPlayer(input.player1Id)
    const p2 = await getPlayer(input.player2Id)
    expect(p1.balance).toBe("23.60")
    expect(p2.balance).toBe("16.00")
    expect(p1.matches).toBe(1)
    expect(p2.matches).toBe(1)
    expect(p1.wins).toBe(1)
    expect(p2.wins).toBe(0)
    expect(p1.lastPlays).not.toBeNull()
    expect((await getHold(input.player1HoldId)).status).toBe("consumed")
    expect((await getHold(input.player2HoldId)).status).toBe("consumed")
  })

  it("writes one history row with the payouts, the fee and the moves", async () => {
    const input = await matchReadyToSettle()
    await settleInDatabase(input)

    const rows = await historyRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      player1Id: input.player1Id,
      player2Id: input.player2Id,
      bid: "5.00",
      result: "played",
      p1Winnings: "8.60",
      p2Winnings: "1.00",
      fee: "0.40",
      moves: input.moves,
    })
    expect(rows[0].finishedAt).not.toBeNull()
  })

  it("a second call pays nothing more", async () => {
    const input = await matchReadyToSettle()
    await settleInDatabase(input)

    expect(await settleInDatabase(input)).toBe("already_settled")

    expect((await getPlayer(input.player1Id)).balance).toBe("23.60")
    expect((await getPlayer(input.player2Id)).balance).toBe("16.00")
    expect((await getPlayer(input.player1Id)).matches).toBe(1)
    expect(await historyRows()).toHaveLength(1)
  })

  it("five calls at the same moment pay exactly once", async () => {
    const input = await matchReadyToSettle()

    const results = await Promise.all(Array.from({ length: 5 }, () => settleInDatabase(input)))

    expect(results.filter((r) => r === "settled")).toHaveLength(1)
    expect(results.filter((r) => r === "already_settled")).toHaveLength(4)
    expect((await getPlayer(input.player1Id)).balance).toBe("23.60")
    expect((await getPlayer(input.player2Id)).balance).toBe("16.00")
    expect(await historyRows()).toHaveLength(1)
  })

  it("works when player 1 has the larger id", async () => {
    const input = await matchReadyToSettle()
    const swapped: SettleInDatabaseInput = {
      ...input,
      player1Id: input.player2Id,
      player2Id: input.player1Id,
      player1HoldId: input.player2HoldId,
      player2HoldId: input.player1HoldId,
    }

    expect(await settleInDatabase(swapped)).toBe("settled")

    // the player with the larger id is now "player 1" and found the big chest
    expect((await getPlayer(input.player2Id)).balance).toBe("23.60")
    expect((await getPlayer(input.player1Id)).balance).toBe("16.00")
  })

  it("a draw pays the stakes back and counts no win", async () => {
    const input = await matchReadyToSettle(settlementFor(["miss", "miss"], ["miss", "miss"]))

    await settleInDatabase(input)

    for (const id of [input.player1Id, input.player2Id]) {
      const player = await getPlayer(id)
      expect(player.balance).toBe("20.00")
      expect(player.matches).toBe(1)
      expect(player.wins).toBe(0)
    }
    expect((await historyRows())[0].fee).toBe("0.00")
  })

  it("rolls everything back when a hold is not active", async () => {
    const input = await matchReadyToSettle()
    await pool.query("UPDATE balance_holds SET status = 'released' WHERE id = $1", [input.player2HoldId])

    await expect(settleInDatabase(input)).rejects.toThrow("not active")

    expect(await historyRows()).toHaveLength(0)
    expect((await getPlayer(input.player1Id)).balance).toBe("20.00")
    expect((await getPlayer(input.player1Id)).matches).toBe(0)
    expect((await getHold(input.player1HoldId)).status).toBe("active")
  })

  it("rolls everything back when a hold is linked to another match", async () => {
    const input = await matchReadyToSettle()
    await pool.query(`UPDATE balance_holds SET "refId" = 'another-match' WHERE id = $1`, [input.player1HoldId])

    await expect(settleInDatabase(input)).rejects.toThrow("another match")

    expect(await historyRows()).toHaveLength(0)
    expect((await getPlayer(input.player2Id)).balance).toBe("20.00")
  })

  it("rolls everything back when a hold belongs to another player", async () => {
    const input = await matchReadyToSettle()
    const stranger = await createPlayer(3, 20)
    await pool.query(`UPDATE balance_holds SET "playerId" = $1 WHERE id = $2`, [stranger, input.player1HoldId])

    await expect(settleInDatabase(input)).rejects.toThrow("another player")

    expect(await historyRows()).toHaveLength(0)
    expect((await getPlayer(input.player1Id)).balance).toBe("20.00")
    expect((await getPlayer(stranger)).balance).toBe("20.00")
  })

  it("rolls everything back when a hold does not exist", async () => {
    const input = await matchReadyToSettle()

    await expect(settleInDatabase({ ...input, player1HoldId: 9999 })).rejects.toThrow("not found")

    expect(await historyRows()).toHaveLength(0)
    expect((await getPlayer(input.player2Id)).balance).toBe("20.00")
  })

  it("can be repeated after a failed attempt once the problem is fixed", async () => {
    const input = await matchReadyToSettle()
    await pool.query("UPDATE balance_holds SET status = 'released' WHERE id = $1", [input.player2HoldId])
    await expect(settleInDatabase(input)).rejects.toThrow()

    await pool.query("UPDATE balance_holds SET status = 'active' WHERE id = $1", [input.player2HoldId])

    expect(await settleInDatabase(input)).toBe("settled")
    expect((await getPlayer(input.player1Id)).balance).toBe("23.60")
  })
})
