import { redisClient } from "../redis/redisClient";

// matches whose current turn is over, the worker counts a skipped move for them
export async function getExpiredRevealMatchIds(now: number): Promise<string[]> {
  return redisClient.zrangebyscore("reveal:matches", "-inf", now);
}
