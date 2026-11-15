import { MATCH_STAKE, MAX_MATCH_ATTEMPTS } from "../constants";
import { createWaitingMatch } from "./createWaitingMatch";
import { getMatchAction } from "./getMatchAction";
import { joinWaitingMatch } from "./joinWaitingMatch";
import { loadMatch } from "./loadMatch";
import { releaseHold } from "./releaseHold";
import { reserveBid } from "./reserveBid";
import type { Match } from "../types/match";

export class MatchNotFoundError extends Error {
  constructor(message = "could not find a game") {
    super(message);
    this.name = "MatchNotFoundError";
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// freezes the stake and puts the player into a match (new waiting one or somebody else's);
// retries a few times when another player wins the race for the same match
export async function joinQueue(playerId: number, pause: (ms: number) => Promise<void> = sleep): Promise<Match> {
  const holdId = await reserveBid(playerId);

  for (let attempt = 0; attempt < MAX_MATCH_ATTEMPTS; attempt++) {
    let action;
    try {
      action = await getMatchAction(playerId);
    } catch (error: unknown) {
      console.error("joinQueue: getMatchAction failed", error);
      await releaseHold(holdId, "released");
      throw new MatchNotFoundError();
    }

    if (action === null) {
      await pause(100 + Math.random() * 200);
      continue;
    }

    // a thrown error goes up as it is: joinWaitingMatch has already released the holds it owns.
    // After a failed create the hold stays active on purpose: the match may already be in Redis
    // with this hold, so it closes through expiresAt (checkExpiredHolds).
    if (action.action === "join") {
      const match = await joinWaitingMatch(playerId, holdId, action.matchId, action.token);
      if (match !== null) return match;
    } else {
      const matchId = await createWaitingMatch(playerId, holdId, action.token);
      if (matchId !== null) {
        const match = await loadMatch(matchId);
        if (match !== null) return match;
        throw new Error("joinQueue: the new match disappeared");
      }
    }
  }

  await releaseHold(holdId, "released");
  throw new MatchNotFoundError();
}
