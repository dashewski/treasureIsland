
import { redisClient } from "../redis/redisClient";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const GET_MATCH_ACTION = readFileSync(join(__dirname, "getMatchAction.lua"), "utf8");
type MatchAction =
  | { action: "join"; matchId: string; token: string }
  | { action: "create"; token: string };

export async function getMatchAction(playerId: number): Promise<MatchAction | null> {
  const tokenTest = crypto.randomUUID()
  const result = await redisClient.eval(GET_MATCH_ACTION, 2, "waiting:matches", "lock:create", tokenTest, 5000, 2000)
  if (result === null) return null

  if (Array.isArray(result)) {
    if (result[0] === "join") return { action: "join", matchId: result[1], token: result[2] }
    if (result[0] === "create") return { action: "create", token: result[1] }
  }

  throw new Error("getMatchAction: unexpected answer from the script")
}
