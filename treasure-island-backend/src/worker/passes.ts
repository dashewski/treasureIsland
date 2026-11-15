import { checkExpiredHolds } from "../matchmaking/checkExpiredHolds";
import { checkMatchmakingTimeout } from "../matchmaking/checkMatchmakingTimeout";
import { getWaitingMatchIds } from "../matchmaking/getWaitingMatchIds";
import { releaseHold } from "../matchmaking/releaseHold";
import { checkPlacementTimeout } from "../placement/checkPlacementTimeout";
import { getPlacementMatchIds } from "../placement/getPlacementMatchIds";
import { getExpiredRevealMatchIds } from "../reveal/getExpiredRevealMatchIds";
import { resolveRevealTimeout } from "../reveal/resolveRevealTimeout";
import { getSettlementMatchIds } from "../settlement/getSettlementMatchIds";
import { settleMatch } from "../settlement/settleMatch";
import { trySettle } from "../settlement/trySettle";
import { SETTLEMENT_MAX_FAILS } from "../constants";

// one failing match must not stop the others
async function eachMatch(ids: string[], what: string, work: (matchId: string) => Promise<void>): Promise<void> {
  for (const matchId of ids) {
    try {
      await work(matchId);
    } catch (error: unknown) {
      console.error(`worker: ${what} failed`, matchId, error);
    }
  }
}

// fast pass: turns in reveal whose time is over
export async function fastPass(now = Date.now()): Promise<void> {
  await eachMatch(await getExpiredRevealMatchIds(now), "reveal timeout", async (matchId) => {
    const result = await resolveRevealTimeout(matchId);
    if (result === "ended") await trySettle(matchId);
    if (result === "invalid_current_turn" || result === "no_moves_left") {
      console.error("worker: reveal match in a bad state", matchId, result);
    }
  });
}

// failed settlements in memory of this process; after a restart the counter starts again
const settlementFails = new Map<string, number>();

// slow pass: matchmaking, placement, settlement retries, and the safety net for holds
export async function slowPass(): Promise<void> {
  await eachMatch(await getWaitingMatchIds(), "matchmaking timeout", async (matchId) => {
    const result = await checkMatchmakingTimeout(matchId);
    if (result.status === "cancelled") await releaseHold(result.player1HoldId, "released");
  });

  await eachMatch(await getPlacementMatchIds(), "placement timeout", async (matchId) => {
    const result = await checkPlacementTimeout(matchId);
    if (result.status === "cancelled") {
      await releaseHold(result.player1HoldId, "released");
      await releaseHold(result.player2HoldId, "released");
    } else if (result.status === "invalid_state") {
      console.error("worker: placement match in a bad state", matchId);
    }
  });

  await eachMatch(await getSettlementMatchIds(), "settlement", async (matchId) => {
    try {
      await settleMatch(matchId);
      settlementFails.delete(matchId);
    } catch (error: unknown) {
      const fails = (settlementFails.get(matchId) ?? 0) + 1;
      settlementFails.set(matchId, fails);
      if (fails >= SETTLEMENT_MAX_FAILS) {
        console.error(`worker: ALERT settlement failed ${fails} times in a row`, matchId);
      }
      throw error; // eachMatch logs it; the matchId stays in the queue
    }
  });

  try {
    await checkExpiredHolds();
  } catch (error: unknown) {
    console.error("worker: checkExpiredHolds failed", error);
  }
}
