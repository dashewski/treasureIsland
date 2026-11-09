import { readFileSync } from "node:fs";
import { join } from "node:path";
import { redisClient } from "../redis/redisClient";

const ROLLBACK_REDIS_JOIN = readFileSync(join(__dirname, "rollbackRedisJoin.lua"), "utf8");

// puts a match that was just joined back into the waiting state
export async function rollbackRedisJoin(
  matchId: string,
  player2Id: number,
): Promise<"ok" | "not_rollbackable"> {
  const result = await redisClient.eval(
    ROLLBACK_REDIS_JOIN,
    4,
    `match:${matchId}`,
    `match:${matchId}:placement`,
    "waiting:matches",
    "placement:matches",
    player2Id,
    matchId,
    Date.now(),
  );
  if (result !== "ok" && result !== "not_rollbackable") {
    throw new Error("rollbackRedisJoin: unexpected answer from the script");
  }
  return result;
}
