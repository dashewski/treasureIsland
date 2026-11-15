import { pool } from "../db/pool";
import { checkMatchmakingTimeout } from "./checkMatchmakingTimeout";
import { checkPlayerInLiveMatch } from "./checkPlayerInLiveMatch";
import { linkHoldsToMatch } from "./linkHoldsToMatch";
import { recoverOrphanedHold } from "./recoverOrphanedHold";
import { releaseHold } from "./releaseHold";

// step 1: a hold whose safety timer ran out
async function handleExpiredHold(holdId: number, playerId: number): Promise<void> {
  const live = await checkPlayerInLiveMatch(playerId);
  if (live === null) {
    await releaseHold(holdId, "released");
    return;
  }
  if (live.status === "waiting") {
    const timeout = await checkMatchmakingTimeout(live.matchId);
    if (timeout.status === "cancelled") await releaseHold(holdId, "released");
    return;
  }
  if (live.status === "placement" || live.status === "reveal") {
    if (live.player2HoldId !== null && [live.player1HoldId, live.player2HoldId].includes(String(holdId))) {
      // the match runs, only the link in PostgreSQL got lost: repair it, do not release
      await linkHoldsToMatch(live.matchId, Number(live.player1HoldId), Number(live.player2HoldId));
      return;
    }
    console.error("checkExpiredHolds: expired hold is not part of the live match", holdId, live.matchId);
  }
}

// safety net for holds that hang (backend crashed, Redis state lost). Returns how many holds it handled.
export async function checkExpiredHolds(): Promise<number> {
  let handled = 0;

  const expired = await pool.query<{ holdId: number; playerId: number }>(
    `SELECT id AS "holdId", "playerId" FROM balance_holds
     WHERE status = 'active' AND "expiresAt" IS NOT NULL AND "expiresAt" < NOW()`,
  );
  for (const { holdId, playerId } of expired.rows) {
    try {
      await handleExpiredHold(holdId, playerId);
      handled++;
    } catch (error: unknown) {
      console.error("checkExpiredHolds: expired hold failed", holdId, error);
    }
  }

  const linked = await pool.query<{ holdId: number; matchId: string }>(
    `SELECT id AS "holdId", "refId" AS "matchId" FROM balance_holds
     WHERE status = 'active' AND type = 'match_bid' AND "refId" IS NOT NULL`,
  );
  for (const { holdId, matchId } of linked.rows) {
    try {
      if ((await recoverOrphanedHold(holdId, matchId)) === "orphaned_recovered") handled++;
    } catch (error: unknown) {
      console.error("checkExpiredHolds: orphaned hold failed", holdId, error);
    }
  }
  return handled;
}
