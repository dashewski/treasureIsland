import { pool } from "../db/pool";
import { redisClient } from "../redis/redisClient";
import { releaseHold } from "./releaseHold";

export type RecoverResult = "match_exists" | "orphaned_recovered";

// Redis lost the match: release the stake and write the cancel to the history.
// MVP policy: lost live state means cancel, not restore.
export async function recoverOrphanedHold(holdId: number, matchId: string): Promise<RecoverResult> {
  if ((await redisClient.exists(`match:${matchId}`)) === 1) return "match_exists";
  const hold = await pool.query<{ playerId: number }>(
    `SELECT "playerId" FROM balance_holds WHERE id = $1`,
    [holdId],
  );
  const playerId = hold.rows[0]?.playerId;
  if (playerId === undefined) throw new Error(`recoverOrphanedHold: hold ${holdId} not found`);
  await releaseHold(holdId, "released");
  // the second hold of the same match must not fail on UNIQUE("matchId")
  await pool.query(
    `INSERT INTO match_history ("matchId", "player1Id", result, "cancelReason", "finishedAt")
     VALUES ($1, $2, 'cancelled', 'redis_state_lost', NOW())
     ON CONFLICT ("matchId") DO NOTHING`,
    [matchId, playerId],
  );
  return "orphaned_recovered";
}
