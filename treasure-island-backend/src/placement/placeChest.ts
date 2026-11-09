import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { assertMatchId, validatePlacement } from "../domain/validate";
import { formatMatchResponse, type MatchResponse } from "../matchmaking/formatMatchResponse";
import { loadMatch } from "../matchmaking/loadMatch";
import { releaseHold } from "../matchmaking/releaseHold";
import type { PlayerSlot } from "../types/match";
import { checkPlacementTimeout } from "./checkPlacementTimeout";
import { resolvePlacement } from "./resolvePlacement";

// the placement time is over: cancel the match and give both stakes back
async function cancelExpiredPlacement(matchId: string): Promise<void> {
  const result = await checkPlacementTimeout(matchId);
  if (result.status === "cancelled") {
    await releaseHold(result.player1HoldId, "released");
    await releaseHold(result.player2HoldId, "released");
  }
}

// one chest of the player; playerId comes from the verified token, never from the request body
export async function placeChest(
  matchId: unknown,
  playerId: string,
  chestType: unknown,
  zoneId: unknown,
): Promise<MatchResponse> {
  assertMatchId(matchId);
  const match = await loadMatch(matchId);
  if (match === null) throw new NotFoundError("match not found");

  let playerSlot: PlayerSlot;
  if (match.player1 === playerId) playerSlot = "p1";
  else if (match.player2 === playerId) playerSlot = "p2";
  else throw new ForbiddenError("not a participant");

  if (match.status !== "placement") throw new ConflictError("not in placement phase");
  if (match.placementDeadline !== null && Date.now() > match.placementDeadline) {
    await cancelExpiredPlacement(matchId);
    throw new ConflictError("placement time expired");
  }

  const chest = validatePlacement(zoneId, chestType);
  const result = await resolvePlacement(matchId, playerSlot, chest.chestType, chest.zoneId);

  switch (result) {
    case "already_placed":
      throw new ConflictError("chest already placed");
    case "zone_already_used":
      throw new ConflictError("you already placed another chest in this zone");
    case "not_in_placement":
      throw new ConflictError("not in placement phase");
    case "placement_timeout":
      await cancelExpiredPlacement(matchId);
      throw new ConflictError("placement time expired");
    case "placed":
    case "completed": {
      const updated = await loadMatch(matchId);
      if (updated === null) throw new NotFoundError("match not found");
      return formatMatchResponse(updated, playerId);
    }
  }
}
