import { redisClient } from "../redis/redisClient";
import { loadMatch } from "./loadMatch";
import type { MatchStatus } from "../types/match";

export interface LiveMatchSummary {
  matchId: string;
  status: MatchStatus;
  player1HoldId: string;
  player2HoldId: string | null;
}

// the match the player's pointer leads to, or null if there is no pointer or no match
export async function checkPlayerInLiveMatch(playerId: number | string): Promise<LiveMatchSummary | null> {
  const matchId = await redisClient.get(`player:${playerId}:currentMatch`);
  if (matchId === null) return null;
  const match = await loadMatch(matchId);
  if (match === null) return null;
  return {
    matchId: match.matchId,
    status: match.status,
    player1HoldId: match.player1HoldId,
    player2HoldId: match.player2HoldId,
  };
}
