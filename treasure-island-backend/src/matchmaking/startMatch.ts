import { formatMatchResponse, type MatchResponse } from "./formatMatchResponse";
import { joinQueue } from "./joinQueue";

// POST /api/match/start: the stake comes from a constant, the player from the verified token
export async function startMatch(playerId: number): Promise<MatchResponse> {
  const match = await joinQueue(playerId);
  return formatMatchResponse(match, String(playerId));
}
