import { calcSettlement } from "../domain/calcSettlement";
import { decimalToCents } from "../domain/money";
import { loadMatch } from "../matchmaking/loadMatch";
import { redisClient } from "../redis/redisClient";
import { finishSettlement } from "./finishSettlement";
import { settleInDatabase } from "./settleInDatabase";

export type SettleMatchResult = "settled" | "already_settled" | "match_missing";

// the money part of a played match. Safe to call again: PostgreSQL pays once (UNIQUE matchId),
// the Redis cleanup is repeatable. On any error the matchId stays in settlement:matches.
export async function settleMatch(matchId: string): Promise<SettleMatchResult> {
  const match = await loadMatch(matchId);
  if (match === null) {
    // the holds stay active with refId, recoverOrphanedHold returns the stakes
    await redisClient.zrem("settlement:matches", matchId);
    console.error("settleMatch: the match is not in Redis", matchId);
    return "match_missing";
  }
  if (match.status !== "ended") throw new Error("match not ended");
  if (match.player2 === null || match.player2HoldId === null) {
    throw new Error("settleMatch: the match has no second player");
  }

  const settlement = calcSettlement(match);
  const result = await settleInDatabase({
    matchId,
    player1Id: Number(match.player1),
    player2Id: Number(match.player2),
    player1HoldId: Number(match.player1HoldId),
    player2HoldId: Number(match.player2HoldId),
    bidCents: decimalToCents(match.bid),
    settlement,
    moves: { placement: match.placement, reveal: match.reveal },
  });

  await finishSettlement(matchId, match.player1, match.player2);
  return result;
}
