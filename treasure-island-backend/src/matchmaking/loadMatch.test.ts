import { redisClient } from "../redis/redisClient"
import { makeStartedMatch, makeWaitingMatch } from "../testing/matchSetup"
import { closeRedis, resetRedis } from "../testing/resetRedis"
import { loadMatch } from "./loadMatch"

beforeEach(resetRedis)
afterAll(closeRedis)

describe("loadMatch", () => {
  it("returns null when there is no such match", async () => {
    expect(await loadMatch("550e8400-e29b-41d4-a716-446655440000")).toBeNull()
  })

  it("restores the types of a waiting match: numbers are numbers, absent fields are null", async () => {
    const matchId = await makeWaitingMatch(7, 11)

    const match = await loadMatch(matchId)

    expect(match).toEqual({
      matchId,
      status: "waiting",
      player1: "7",
      player2: null,
      player1HoldId: "11",
      player2HoldId: null,
      bid: "5",
      bigAmount: "4",
      smallAmount: "1",
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
      placementDeadline: null,
      turnDeadline: null,
      currentTurn: null,
      cancelReason: null,
      stateVersion: 0,
      placement: null,
      reveal: null,
    })
  })

  it("shows the second player and the deadline after the join", async () => {
    const matchId = await makeStartedMatch(7, 11, 8, 12)

    const match = await loadMatch(matchId)

    expect(match).toMatchObject({
      status: "placement",
      player2: "8",
      player2HoldId: "12",
      placementDeadline: expect.any(Number),
      stateVersion: 1,
      placement: null,
    })
  })

  it("loads the placement hash when the status is placement and turns zone ids into numbers", async () => {
    const matchId = await makeStartedMatch(7, 11, 8, 12)
    await redisClient.hset(`match:${matchId}:placement`, "p1_big", "2", "p1_small", "4")

    const match = await loadMatch(matchId)

    expect(match?.placement).toEqual({ p1_big: 2, p1_small: 4 })
  })

  it("does not read the placement hash of a waiting match", async () => {
    const matchId = await makeWaitingMatch(7, 11)
    await redisClient.hset(`match:${matchId}:placement`, "p1_big", "2")

    expect((await loadMatch(matchId))?.placement).toBeNull()
  })

  it("loads the reveal hash only in reveal and ended, keeping 'skipped' as text", async () => {
    const matchId = await makeStartedMatch(7, 11, 8, 12)
    await redisClient.hset(`match:${matchId}`, "status", "reveal")
    await redisClient.hset(
      `match:${matchId}:reveal`,
      "p1_move_1_zone", "3",
      "p1_move_1_result", "miss",
      "p2_move_1_zone", "skipped",
      "p2_move_1_result", "skipped",
    )

    const match = await loadMatch(matchId)

    expect(match?.reveal).toEqual({
      p1_move_1_zone: 3,
      p1_move_1_result: "miss",
      p2_move_1_zone: "skipped",
      p2_move_1_result: "skipped",
    })
  })

  it("does not read the reveal hash while the match is still in placement", async () => {
    const matchId = await makeStartedMatch(7, 11, 8, 12)
    await redisClient.hset(`match:${matchId}:reveal`, "p1_move_1_zone", "3")

    expect((await loadMatch(matchId))?.reveal).toBeNull()
  })
})
