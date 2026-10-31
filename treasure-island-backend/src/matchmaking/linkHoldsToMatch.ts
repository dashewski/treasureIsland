import { withTransaction } from "../db/transaction"

// ties both stakes to the match and stops the safety timer; throws if a hold is not active
export async function linkHoldsToMatch(
  matchId: string,
  player1HoldId: number,
  player2HoldId: number,
): Promise<void> {
  await withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE balance_holds SET "refId" = $1, "expiresAt" = NULL
       WHERE id IN ($2, $3) AND status = 'active'`,
      [matchId, player1HoldId, player2HoldId],
    )
    if (result.rowCount !== 2) {
      throw new Error("linkHoldsToMatch: one of the holds is not active")
    }
  })
}
