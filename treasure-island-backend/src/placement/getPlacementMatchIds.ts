import { redisClient } from "../redis/redisClient";

// matches in the placement phase, the worker checks their deadlines
export async function getPlacementMatchIds(): Promise<string[]> {
  return redisClient.zrange("placement:matches", "0", "-1");
}
