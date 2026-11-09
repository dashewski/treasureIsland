import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MATCH_KEY_TTL, TURN_TIMEOUT } from "../constants";
import { redisClient } from "../redis/redisClient";

const RESOLVE_MOVE = readFileSync(join(__dirname, "resolveMove.lua"), "utf8");

export type FoundResult = "hit_big" | "hit_small" | "miss";

export type MoveOutcome =
  | { status: "moved" | "ended"; moveResult: FoundResult }
  | {
      status:
        | "not_in_reveal"
        | "not_a_participant"
        | "not_your_turn"
        | "turn_expired"
        | "no_moves_left"
        | "zone_already_opened";
    };

const REFUSALS = [
  "not_in_reveal",
  "not_a_participant",
  "not_your_turn",
  "turn_expired",
  "no_moves_left",
  "zone_already_opened",
] as const;

const FOUND_RESULTS: readonly string[] = ["hit_big", "hit_small", "miss"];

// opens one zone of the opponent; the fourth move of the match ends the reveal phase
export async function resolveMove(
  matchId: string,
  playerId: string,
  zoneId: number,
): Promise<MoveOutcome> {
  const now = Date.now();
  const result = await redisClient.eval(
    RESOLVE_MOVE,
    5,
    `match:${matchId}`,
    `match:${matchId}:placement`,
    `match:${matchId}:reveal`,
    "reveal:matches",
    "settlement:matches",
    playerId,
    zoneId,
    now,
    now + TURN_TIMEOUT * 1000,
    matchId,
    MATCH_KEY_TTL,
  );
  if (
    Array.isArray(result) &&
    (result[0] === "moved" || result[0] === "ended") &&
    FOUND_RESULTS.includes(result[1] as string)
  ) {
    return { status: result[0], moveResult: result[1] as FoundResult };
  }
  const refusal = REFUSALS.find((name) => name === result);
  if (refusal !== undefined) return { status: refusal };
  throw new Error("resolveMove: unexpected answer from the script");
}
