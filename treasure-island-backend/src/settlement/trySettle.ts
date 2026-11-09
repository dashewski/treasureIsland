import { settleMatch } from "./settleMatch";

// the move is already written, so a settlement error must not break the answer to the player;
// the worker repeats a failed settlement later
export async function trySettle(matchId: string): Promise<void> {
  try {
    await settleMatch(matchId);
  } catch (error: unknown) {
    console.error("trySettle: settlement failed, the worker will retry", matchId, error);
  }
}
