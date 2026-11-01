import { redisClient } from "../redis/redisClient";
import { MATCH_KEY_TTL, MATCH_STAKE } from "../constants";


export async function createWaitingMatch(
  playerId: number,
  holdId: number,
  createLockToken: string,
): Promise<string> {
  const matchId: string = crypto.randomUUID();
  const now = Date.now();
  await redisClient
    .multi()
    .hset(`match:${matchId}`, {
      matchId: matchId,
      status: "waiting",
      player1: playerId,
      player1HoldId: holdId,
      bid: MATCH_STAKE,
      bigAmount: 0.8 * MATCH_STAKE,
      smallAmount: 0.2 * MATCH_STAKE,
      createdAt: now,
      updatedAt: now,
      stateVersion: 0,
    })
    .expire(`match:${matchId}`, MATCH_KEY_TTL)
    .zadd("waiting:matches", now, matchId)
    .set(`player:${playerId}:currentMatch`, matchId, "EX", MATCH_KEY_TTL)
    .exec();
  return matchId;
}
