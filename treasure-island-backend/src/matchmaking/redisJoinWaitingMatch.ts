import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MATCH_KEY_TTL, PLACEMENT_TIMEOUT } from "../constants";
import { redisClient } from "../redis/redisClient";

const REDIS_JOIN_WAITING_MATCH = readFileSync(join(__dirname, "redisJoinWaitingMatch.lua"), "utf8");

export async function redisJoinWaitingMatch(
  playerId: number,
  holdId: number,
  matchId: string,
  lockToken: string,
): Promise<string | null> {
  const now = Date.now();
  const result = await redisClient.eval(
    REDIS_JOIN_WAITING_MATCH,
    4,
    `match:${matchId}`,
    `match:${matchId}:trylock`,
    "waiting:matches",
    "placement:matches",
    holdId,
    lockToken,
    playerId,
    matchId,
    now,
    now + PLACEMENT_TIMEOUT * 1000,
    MATCH_KEY_TTL,
  );
  return result as string | null;
}
