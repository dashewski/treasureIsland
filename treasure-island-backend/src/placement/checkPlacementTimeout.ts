import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FINISHED_KEY_TTL } from "../constants";
import { redisClient } from "../redis/redisClient";

const CHECK_PLACEMENT_TIMEOUT = readFileSync(join(__dirname, "checkPlacementTimeout.lua"), "utf8");

export type PlacementTimeoutResult =
  | { status: "cancelled"; player1HoldId: number; player2HoldId: number }
  | { status: "already processed" | "still placement" | "invalid_state" };

// cancels a match whose placement time is over; the caller must release the returned holds
export async function checkPlacementTimeout(matchId: string): Promise<PlacementTimeoutResult> {
  const result = await redisClient.eval(
    CHECK_PLACEMENT_TIMEOUT,
    3,
    `match:${matchId}`,
    `match:${matchId}:placement`,
    "placement:matches",
    matchId,
    Date.now(),
    FINISHED_KEY_TTL,
  );
  if (Array.isArray(result) && result[0] === "cancelled") {
    return {
      status: "cancelled",
      player1HoldId: Number(result[1]),
      player2HoldId: Number(result[2]),
    };
  }
  if (result === "already processed" || result === "still placement" || result === "invalid_state") {
    return { status: result };
  }
  throw new Error("checkPlacementTimeout: unexpected answer from the script");
}
