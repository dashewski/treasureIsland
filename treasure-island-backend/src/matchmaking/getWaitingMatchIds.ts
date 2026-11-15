import { redisClient } from "../redis/redisClient";

// matches waiting for a second player, the worker checks their age
export async function getWaitingMatchIds(): Promise<string[]> {
  return redisClient.zrange("waiting:matches", "0", "-1");
}
