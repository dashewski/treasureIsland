import { TEST_START_BALANCE } from "../constants"
import { pool } from "../db/pool"

export interface TelegramUser {
  id: number,
  first_name: string,
  last_name?: string,
  username?: string,
  language_code?: string
}

// pg returns BIGINT and NUMERIC as strings, TIMESTAMP as a Date
export interface Player {
  id: number,
  tgid: string,
  player: string | null,
  balance: string,
  matches: number,
  wins: number,
  score: number,
  createdAt: Date,
  lastPlays: Date | null
}

export async function findOrCreatePlayer(userData: TelegramUser): Promise<Player> {
  const result = await pool.query<Player>(
    "INSERT INTO players (tgid, player, balance) VALUES ($1, $2, $3) ON CONFLICT (tgid) DO UPDATE SET player = EXCLUDED.player RETURNING *",
    [userData.id, userData.first_name, TEST_START_BALANCE],
  )
  const player = result.rows[0]
  if (!player) { throw new Error("findOrCreatePlayer: the query returned no row") }
  return player
}
