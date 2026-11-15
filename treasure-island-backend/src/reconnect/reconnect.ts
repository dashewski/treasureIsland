import { formatMatchResponse, type MatchResponse } from "../matchmaking/formatMatchResponse";
import { checkPlayerInLiveMatch } from "../matchmaking/checkPlayerInLiveMatch";
import { loadMatch } from "../matchmaking/loadMatch";
import type { HistoryResponse } from "../types/history";
import { formatHistoryResponse } from "./formatHistoryResponse";
import { getLastFinishedMatch } from "./getLastFinishedMatch";

export type ReconnectResponse =
  | { reconnectResult: "currentMatch"; match: MatchResponse }
  | { reconnectResult: "lastFinishedMatch"; match: HistoryResponse }
  | { reconnectResult: "none" };

// GET /api/me/reconnect: what the frontend should show after it opened. A technical error
// is thrown, never turned into "none": a player in a match would see the start screen.
export async function reconnect(playerId: string): Promise<ReconnectResponse> {
  const live = await checkPlayerInLiveMatch(playerId);
  if (live !== null) {
    const match = await loadMatch(live.matchId);
    if (match !== null) {
      return { reconnectResult: "currentMatch", match: formatMatchResponse(match, playerId) };
    }
  }
  const row = await getLastFinishedMatch(Number(playerId));
  if (row === null) return { reconnectResult: "none" };
  return { reconnectResult: "lastFinishedMatch", match: formatHistoryResponse(row, Number(playerId)) };
}
