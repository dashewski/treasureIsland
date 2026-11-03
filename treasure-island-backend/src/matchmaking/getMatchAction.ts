import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CREATE_LOCK_TTL_MS, TRYLOCK_TTL_MS } from "../constants";
import { redisClient } from "../redis/redisClient";

const GET_MATCH_ACTION = readFileSync(join(__dirname, "getMatchAction.lua"), "utf8");

export type MatchAction =
  | { action: "join"; matchId: string; token: string }
  | { action: "create"; token: string };

// playerId is not used by the script yet
export async function getMatchAction(playerId: number): Promise<MatchAction | null> {
  const token = crypto.randomUUID();
  const result = await redisClient.eval(
    GET_MATCH_ACTION,
    2,
    "waiting:matches",
    "lock:create",
    token,
    TRYLOCK_TTL_MS,
    CREATE_LOCK_TTL_MS,
  );
  if (result === null) return null;

  if (Array.isArray(result)) {
    if (result[0] === "join") return { action: "join", matchId: result[1], token: result[2] };
    if (result[0] === "create") return { action: "create", token: result[1] };
  }

  throw new Error("getMatchAction: unexpected answer from the script");
}
