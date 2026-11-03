import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MATCH_KEY_TTL, MATCH_STAKE } from "../constants";
import { redisClient } from "../redis/redisClient";

const CREATE_WAITING_MATCH = readFileSync(join(__dirname, "createWaitingMatch.lua"), "utf8");

export async function createWaitingMatch(
  playerId: number,
  holdId: number,
  createLockToken: string,
): Promise<string | null> {
  const matchId = crypto.randomUUID();
  const now = Date.now();
  const result = await redisClient.eval(
    CREATE_WAITING_MATCH,
    4,
    "lock:create",
    `match:${matchId}`,
    "waiting:matches",
    `player:${playerId}:currentMatch`,
    createLockToken,
    matchId,
    playerId,
    holdId,
    MATCH_STAKE,
    0.8 * MATCH_STAKE,
    0.2 * MATCH_STAKE,
    now,
    MATCH_KEY_TTL,
  );
  return result as string | null;
}
