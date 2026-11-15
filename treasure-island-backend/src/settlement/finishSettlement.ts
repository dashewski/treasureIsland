import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FINISHED_KEY_TTL } from "../constants";
import { redisClient } from "../redis/redisClient";

const FINISH_SETTLEMENT = readFileSync(join(__dirname, "finishSettlement.lua"), "utf8");

// Redis cleanup after the money is settled: pointers, queues, short lifetime of the match keys
export async function finishSettlement(matchId: string, player1: string, player2: string): Promise<void> {
  await redisClient.eval(
    FINISH_SETTLEMENT,
    7,
    `match:${matchId}`,
    `match:${matchId}:placement`,
    `match:${matchId}:reveal`,
    "reveal:matches",
    "settlement:matches",
    `player:${player1}:currentMatch`,
    `player:${player2}:currentMatch`,
    matchId,
    FINISHED_KEY_TTL,
  );
}
