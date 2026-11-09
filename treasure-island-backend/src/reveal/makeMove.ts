import { assertMatchId, validateMove } from "../domain/validate";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { formatMatchResponse, type MatchResponse } from "../matchmaking/formatMatchResponse";
import { loadMatch } from "../matchmaking/loadMatch";
import { trySettle } from "../settlement/trySettle";
import { resolveMove } from "./resolveMove";
import { resolveRevealTimeout } from "./resolveRevealTimeout";

async function answerFor(matchId: string, playerId: string): Promise<MatchResponse> {
  const match = await loadMatch(matchId);
  if (match === null) throw new NotFoundError("match not found");
  return formatMatchResponse(match, playerId);
}

// one move of the player; playerId comes from the verified token, never from the request body
export async function makeMove(
  matchId: unknown,
  playerId: string,
  zoneId: unknown,
): Promise<MatchResponse> {
  assertMatchId(matchId);
  let match = await loadMatch(matchId);
  if (match === null) throw new NotFoundError("match not found");
  if (match.player1 !== playerId && match.player2 !== playerId) {
    throw new ForbiddenError("not a participant");
  }
  if (match.status !== "reveal") throw new ConflictError("not in reveal phase");

  if (match.turnDeadline !== null && Date.now() >= match.turnDeadline) {
    const wasMyTurn = match.currentTurn === playerId;
    if ((await resolveRevealTimeout(matchId)) === "ended") await trySettle(matchId);
    if (wasMyTurn) throw new ConflictError("turn expired");
    // the turn of the opponent was skipped, so the turn may have passed to this player
    const fresh = await loadMatch(matchId);
    if (fresh === null || fresh.status !== "reveal") throw new ConflictError("match ended");
    match = fresh;
  }

  if (match.currentTurn !== playerId) throw new ConflictError("not your turn");
  const zone = validateMove(zoneId);

  const outcome = await resolveMove(matchId, playerId, zone);
  switch (outcome.status) {
    case "not_in_reveal":
      throw new ConflictError("not in reveal phase");
    case "not_a_participant":
      throw new ForbiddenError("not a participant");
    case "not_your_turn":
      throw new ConflictError("not your turn");
    case "turn_expired":
      if ((await resolveRevealTimeout(matchId)) === "ended") await trySettle(matchId);
      throw new ConflictError("turn expired");
    case "no_moves_left":
      throw new ConflictError("no moves left");
    case "zone_already_opened":
      throw new ConflictError("zone already opened");
    case "moved":
      return answerFor(matchId, playerId);
    case "ended":
      await trySettle(matchId);
      return answerFor(matchId, playerId);
  }
}
