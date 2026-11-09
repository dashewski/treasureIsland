import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MATCH_KEY_TTL, TURN_TIMEOUT } from "../constants";
import { redisClient } from "../redis/redisClient";
import type { ChestType, PlayerSlot } from "../types/match";

const RESOLVE_PLACEMENT = readFileSync(join(__dirname, "resolvePlacement.lua"), "utf8");

const RESULTS = [
  "placed",
  "completed",
  "already_placed",
  "zone_already_used",
  "not_in_placement",
  "placement_timeout",
] as const;

export type PlacementResult = (typeof RESULTS)[number];

// writes one chest; the fourth chest moves the match to reveal in the same script
export async function resolvePlacement(
  matchId: string,
  playerSlot: PlayerSlot,
  chestType: ChestType,
  zoneId: number,
): Promise<PlacementResult> {
  const now = Date.now();
  const result = await redisClient.eval(
    RESOLVE_PLACEMENT,
    4,
    `match:${matchId}`,
    `match:${matchId}:placement`,
    "placement:matches",
    "reveal:matches",
    playerSlot,
    chestType,
    zoneId,
    now,
    now + TURN_TIMEOUT * 1000,
    matchId,
    MATCH_KEY_TTL,
  );
  if (!RESULTS.includes(result as PlacementResult)) {
    throw new Error("resolvePlacement: unexpected answer from the script");
  }
  return result as PlacementResult;
}
