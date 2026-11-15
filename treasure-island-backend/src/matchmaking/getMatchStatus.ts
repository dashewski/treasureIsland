import { assertMatchId } from "../domain/validate";
import { ForbiddenError, NotFoundError } from "../errors";
import { formatMatchResponse, type MatchResponse } from "./formatMatchResponse";
import { loadMatch } from "./loadMatch";

// GET /api/match/:matchId, polled by the frontend
export async function getMatchStatus(matchId: unknown, playerId: string): Promise<MatchResponse> {
  assertMatchId(matchId);
  const match = await loadMatch(matchId);
  if (match === null) throw new NotFoundError("match not found");
  if (match.player1 !== playerId && match.player2 !== playerId) {
    throw new ForbiddenError("not a participant");
  }
  return formatMatchResponse(match, playerId);
}
