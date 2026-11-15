import { redisClient } from "../redis/redisClient";

// matches that are played to the end but not settled in PostgreSQL yet
export async function getSettlementMatchIds(): Promise<string[]> {
  return redisClient.zrange("settlement:matches", "0", "-1");
}
