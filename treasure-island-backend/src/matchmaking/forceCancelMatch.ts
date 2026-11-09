import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FINISHED_KEY_TTL } from "../constants";
import { redisClient } from "../redis/redisClient";

const FORCE_CANCEL_MATCH = readFileSync(join(__dirname, "forceCancelMatch.lua"), "utf8");

// cancels the match in Redis whatever state it is in; false if there is no such match
export async function forceCancelMatch(matchId: string, player2Id: number): Promise<boolean> {
  const result = await redisClient.eval(
    FORCE_CANCEL_MATCH,
    4,
    `match:${matchId}`,
    `match:${matchId}:placement`,
    "waiting:matches",
    "placement:matches",
    player2Id,
    matchId,
    Date.now(),
    FINISHED_KEY_TTL,
  );
  return result === 1;
}
