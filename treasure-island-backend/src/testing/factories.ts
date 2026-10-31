import { pool } from "../db/pool"

export async function createPlayer(tgid: number, balance = 20): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    "INSERT INTO players (tgid, player, balance) VALUES ($1, 'test', $2) RETURNING id",
    [tgid, balance],
  )
  return rows[0]!.id
}

interface HoldOptions {
  type?: string
  amount?: number
  status?: string
  refId?: string | null
  expiresInSeconds?: number | null
}

export async function addHold(playerId: number, options: HoldOptions = {}): Promise<number> {
  const {
    type = "match_bid",
    amount = 5,
    status = "active",
    refId = null,
    expiresInSeconds = null,
  } = options
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO balance_holds ("playerId", type, amount, status, "refId", "expiresAt")
     VALUES ($1, $2, $3, $4, $5, NOW() + make_interval(secs => $6))
     RETURNING id`,
    [playerId, type, amount, status, refId, expiresInSeconds],
  )
  return rows[0]!.id
}

export async function getHold(holdId: number) {
  const { rows } = await pool.query("SELECT * FROM balance_holds WHERE id = $1", [holdId])
  return rows[0]
}

export async function getPlayer(playerId: number) {
  const { rows } = await pool.query("SELECT * FROM players WHERE id = $1", [playerId])
  return rows[0]
}

export async function holdsOf(playerId: number) {
  const { rows } = await pool.query(`SELECT * FROM balance_holds WHERE "playerId" = $1`, [playerId])
  return rows
}
