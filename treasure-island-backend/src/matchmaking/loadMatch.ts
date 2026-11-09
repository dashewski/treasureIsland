import { redisClient } from "../redis/redisClient";
import type { Match, Placement, Reveal } from "../types/match";

const NUMBER_FIELDS = ["createdAt", "updatedAt", "placementDeadline", "turnDeadline"] as const;

function toNumberOrNull(value: string | undefined): number | null {
  return value === undefined ? null : Number(value);
}

function toStringOrNull(value: string | undefined): string | null {
  return value === undefined ? null : value;
}

// the placement hash keeps only zone numbers
function parsePlacement(raw: Record<string, string>): Placement | null {
  const entries = Object.entries(raw);
  if (entries.length === 0) return null;
  return Object.fromEntries(entries.map(([field, value]) => [field, Number(value)])) as Placement;
}

// a zone is a number or "skipped", a result is a plain string
function parseReveal(raw: Record<string, string>): Reveal | null {
  const entries = Object.entries(raw);
  if (entries.length === 0) return null;
  return Object.fromEntries(
    entries.map(([field, value]) => [
      field,
      field.endsWith("_zone") && value !== "skipped" ? Number(value) : value,
    ]),
  ) as Reveal;
}

// the whole raw match from Redis with the types restored, null if there is no such match
export async function loadMatch(matchId: string): Promise<Match | null> {
  const raw = await redisClient.hgetall(`match:${matchId}`);
  if (Object.keys(raw).length === 0) return null;

  const status = raw["status"] as Match["status"];
  const [placement, reveal] = await Promise.all([
    status === "placement" || status === "reveal" || status === "ended"
      ? redisClient.hgetall(`match:${matchId}:placement`)
      : {},
    status === "reveal" || status === "ended"
      ? redisClient.hgetall(`match:${matchId}:reveal`)
      : {},
  ]);

  const numbers = Object.fromEntries(NUMBER_FIELDS.map((field) => [field, toNumberOrNull(raw[field])]));

  return {
    matchId: raw["matchId"] as string,
    status,
    player1: raw["player1"] as string,
    player2: toStringOrNull(raw["player2"]),
    player1HoldId: raw["player1HoldId"] as string,
    player2HoldId: toStringOrNull(raw["player2HoldId"]),
    bid: raw["bid"] as string,
    bigAmount: raw["bigAmount"] as string,
    smallAmount: raw["smallAmount"] as string,
    ...numbers,
    currentTurn: toStringOrNull(raw["currentTurn"]),
    cancelReason: toStringOrNull(raw["cancelReason"]),
    stateVersion: Number(raw["stateVersion"]),
    placement: parsePlacement(placement),
    reveal: parseReveal(reveal),
  } as Match;
}
