import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MATCH_KEY_TTL, TURN_TIMEOUT } from "../constants";
import { redisClient } from "../redis/redisClient";

const RESOLVE_REVEAL_TIMEOUT = readFileSync(join(__dirname, "resolveRevealTimeout.lua"), "utf8");

const RESULTS = [
  "skipped",
  "ended",
  "not_expired",
  "already_processed",
  "invalid_current_turn",
  "no_moves_left",
] as const;

export type RevealTimeoutResult = (typeof RESULTS)[number];

// counts a skipped move when the player did not choose a zone in time
export async function resolveRevealTimeout(matchId: string): Promise<RevealTimeoutResult> {
  const now = Date.now();
  const result = await redisClient.eval(
    RESOLVE_REVEAL_TIMEOUT,
    4,
    `match:${matchId}`,
    `match:${matchId}:reveal`,
    "reveal:matches",
    "settlement:matches",
    matchId,
    now,
    now + TURN_TIMEOUT * 1000,
    MATCH_KEY_TTL,
  );
  if (!RESULTS.includes(result as RevealTimeoutResult)) {
    throw new Error("resolveRevealTimeout: unexpected answer from the script");
  }
  return result as RevealTimeoutResult;
}
