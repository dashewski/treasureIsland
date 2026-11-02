import { redisClient } from "../redis/redisClient";
import { MATCH_KEY_TTL, MATCH_STAKE } from "../constants";

const CREATE_WAITING_MATCH = `
  if redis.call("GET", KEYS[1]) ~= ARGV[1] then
    return nil
  end

  redis.call("HSET", KEYS[2],
    "matchId", ARGV[2],
    "status", "waiting",
    "player1", ARGV[3],
    "player1HoldId", ARGV[4],
    "bid", ARGV[5],
    "bigAmount", ARGV[6],
    "smallAmount", ARGV[7],
    "createdAt", ARGV[8],
    "updatedAt", ARGV[8],
    "stateVersion", "0"
  )
  redis.call("EXPIRE", KEYS[2], ARGV[9])
  redis.call("ZADD", KEYS[3], ARGV[8], ARGV[2])
  redis.call("SET", KEYS[4], ARGV[2], "EX", ARGV[9])
  redis.call("DEL", KEYS[1])
  return ARGV[2]
`;

export async function createWaitingMatch(
  playerId: number,
  holdId: number,
  createLockToken: string,
): Promise<string | null> {
  const matchId = crypto.randomUUID();
  const now = Date.now();
  const result = await redisClient.eval(
    CREATE_WAITING_MATCH,
    4,
    "lock:create",
    `match:${matchId}`,
    "waiting:matches",
    `player:${playerId}:currentMatch`,
    createLockToken,
    matchId,
    playerId,
    holdId,
    MATCH_STAKE,
    0.8 * MATCH_STAKE,
    0.2 * MATCH_STAKE,
    now,
    MATCH_KEY_TTL,
  );
  return result as string | null;
}
