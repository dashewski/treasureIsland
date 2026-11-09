import { redisClient } from "../redis/redisClient"
import { createWaitingMatch } from "../matchmaking/createWaitingMatch"
import { redisJoinWaitingMatch } from "../matchmaking/redisJoinWaitingMatch"

export const createToken = "test-create-token"
export const joinToken = "test-join-token"

// a waiting match, created the way a real call would leave it
export async function makeWaitingMatch(playerId: number, holdId: number): Promise<string> {
  await redisClient.set("lock:create", createToken, "PX", 2000)
  const matchId = await createWaitingMatch(playerId, holdId, createToken)
  if (matchId === null) throw new Error("the match was not created")
  return matchId
}

// the reservation that getMatchAction leaves on a match it hands out
export async function reserveForJoin(matchId: string, token = joinToken): Promise<void> {
  await redisClient.set(`match:${matchId}:trylock`, token, "PX", 5000)
}

// a match where the second player has joined in Redis (status placement)
export async function makeStartedMatch(
  player1: number,
  hold1: number,
  player2: number,
  hold2: number,
): Promise<string> {
  const matchId = await makeWaitingMatch(player1, hold1)
  await reserveForJoin(matchId)
  const joined = await redisJoinWaitingMatch(player2, hold2, matchId, joinToken)
  if (joined === null) throw new Error("the second player did not join")
  return matchId
}
