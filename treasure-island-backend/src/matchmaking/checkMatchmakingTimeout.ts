import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FINISHED_KEY_TTL, MATCHMAKING_TIMEOUT } from "../constants";
import { redisClient } from "../redis/redisClient";

const CHECK_MATCHMAKING_TIMEOUT = readFileSync(join(__dirname, "checkMatchmakingTimeout.lua"), "utf8");

export type MatchmakingTimeoutResult =
  | { status: "cancelled"; player1HoldId: number }
  | { status: "already processed" | "still waiting" };

// cancels a waiting match nobody joined in time; the caller must release the returned hold
export async function checkMatchmakingTimeout(matchId: string): Promise<MatchmakingTimeoutResult> {
  const result = await redisClient.eval(
    CHECK_MATCHMAKING_TIMEOUT,
    2,
    `match:${matchId}`,
    "waiting:matches",
    matchId,
    Date.now(),
    MATCHMAKING_TIMEOUT * 1000,
    FINISHED_KEY_TTL,
  );
  if (Array.isArray(result) && result[0] === "cancelled") {
    return { status: "cancelled", player1HoldId: Number(result[1]) };
  }
  if (result === "already processed" || result === "still waiting") return { status: result };
  throw new Error("checkMatchmakingTimeout: unexpected answer from the script");
}
