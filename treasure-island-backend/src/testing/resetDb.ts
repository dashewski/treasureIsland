import { pool } from "../db/pool"

// wipes the money tables, only on a database whose name ends with _test
export async function resetDb(): Promise<void> {
  const { rows } = await pool.query<{ name: string }>("SELECT current_database() AS name")
  const name = rows[0]?.name
  if (!name || !name.endsWith("_test")) {
    throw new Error(`Refusing to reset the database ${String(name)}`)
  }
  await pool.query(
    "TRUNCATE players, balance_holds, withdrawals, match_history RESTART IDENTITY CASCADE",
  )
}
