import { ZONE_COUNT } from "../constants";
import { ValidationError } from "../errors";
import type { ChestType } from "../types/match";

// crypto.randomUUID() returns a v4 UUID
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_V4.test(value);
}

// matchId goes into Redis key names, so check it before touching Redis.
export function assertMatchId(matchId: unknown): asserts matchId is string {
  if (!isUuid(matchId)) {
    throw new ValidationError("invalid match id");
  }
}

function isZoneId(zoneId: unknown): zoneId is number {
  return (
    typeof zoneId === "number" &&
    Number.isInteger(zoneId) &&
    zoneId >= 1 &&
    zoneId <= ZONE_COUNT
  );
}

function isChestType(chestType: unknown): chestType is ChestType {
  return chestType === "big" || chestType === "small";
}

// Returns the checked values so callers don't have to cast.
export function validatePlacement(
  zoneId: unknown,
  chestType: unknown,
): { zoneId: number; chestType: ChestType } {
  if (!isZoneId(zoneId) || !isChestType(chestType)) {
    throw new ValidationError("invalid placement data");
  }
  return { zoneId, chestType };
}

export function validateMove(zoneId: unknown): number {
  if (!isZoneId(zoneId)) {
    throw new ValidationError("invalid move data");
  }
  return zoneId;
}
