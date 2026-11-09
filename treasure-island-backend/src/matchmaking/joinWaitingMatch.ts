import type { Match } from "../types/match";
import { forceCancelMatch } from "./forceCancelMatch";
import { linkHoldsToMatch } from "./linkHoldsToMatch";
import { loadMatch } from "./loadMatch";
import { redisJoinWaitingMatch } from "./redisJoinWaitingMatch";
import { releaseHold } from "./releaseHold";
import { rollbackRedisJoin } from "./rollbackRedisJoin";

// joins the waiting match in Redis, then ties both holds to it in PostgreSQL.
// null: could not join, the caller may look for another match.
// throws: the join failed after Redis was changed, Redis is already put back or cancelled
export async function joinWaitingMatch(
  playerId: number,
  holdId: number,
  matchId: string,
  lockToken: string,
): Promise<Match | null> {
  const joinedMatchId = await redisJoinWaitingMatch(playerId, holdId, matchId, lockToken);
  if (joinedMatchId === null) return null;

  let match: Match | null = null;
  try {
    match = await loadMatch(matchId);
    if (match === null) throw new Error("the match disappeared after the join");
    await linkHoldsToMatch(matchId, Number(match.player1HoldId), holdId);
    return match;
  } catch (error: unknown) {
    // the money side failed, so Redis must not keep a started match
    console.error("joinWaitingMatch: could not link the holds", error);
  }

  let rolledBack = false;
  try {
    rolledBack = (await rollbackRedisJoin(matchId, playerId)) === "ok";
  } catch (error: unknown) {
    console.error("joinWaitingMatch: rollback failed, cancelling the match", error);
  }

  if (rolledBack) {
    // the creator's hold stays active, the creator is waiting again
    await releaseHold(holdId, "released");
    throw new Error("could not join, try again");
  }

  await forceCancelMatch(matchId, playerId);
  await releaseHold(holdId, "released");
  if (match !== null) await releaseHold(Number(match.player1HoldId), "released");
  throw new Error("match cancelled due to internal error");
}
