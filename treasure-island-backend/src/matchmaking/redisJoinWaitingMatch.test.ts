import { MATCH_KEY_TTL, PLACEMENT_TIMEOUT } from "../constants";
import { closeRedis, resetRedis } from "../testing/resetRedis";
import { redisClient } from "../redis/redisClient";
import {
  joinToken,
  makeWaitingMatch,
  reserveForJoin,
} from "../testing/matchSetup";
import { redisJoinWaitingMatch } from "./redisJoinWaitingMatch";
import { createPlayer, addHold } from "../testing/factories";
import { resetDb } from "../testing/resetDb";

beforeEach(async () => {
  await resetRedis();
  await resetDb();
});

afterAll(async () => {
  await closeRedis();
  await resetDb();
});

async function waitingCreatorAndSearcher() {
  const player1 = await createPlayer(1);
  const player2 = await createPlayer(2);
  const hold1 = await addHold(player1, { expiresInSeconds: 120 });
  const hold2 = await addHold(player2, { expiresInSeconds: 120 });
  const matchId = await makeWaitingMatch(player1, hold1);
  await reserveForJoin(matchId);
  return { player1, player2, hold1, hold2, matchId };
}

describe("redisJoinWaitingMatch", () => {
  it("returns null when the lock token is wrong", async () => {
    const { player2, hold2, matchId } = await waitingCreatorAndSearcher();
    const result = await redisJoinWaitingMatch(
      player2,
      hold2,
      matchId,
      "another-token",
    );
    expect(result).toBeNull();
  });

  it("returns null when match doesn't exist", async () => {
    const { player2, hold2, matchId } = await waitingCreatorAndSearcher();
    await redisClient.del(`match:${matchId}`);
    const result = await redisJoinWaitingMatch(
      player2,
      hold2,
      matchId,
      joinToken,
    );
    expect(result).toBeNull();
  });

  it("returns null when match status != waiting", async () => {
    const { player2, hold2, matchId } = await waitingCreatorAndSearcher();
    await redisClient.hset(`match:${matchId}`, "status", "placement");
    const result = await redisJoinWaitingMatch(
      player2,
      hold2,
      matchId,
      joinToken,
    );
    expect(result).toBeNull();
    expect(await redisClient.hget(`match:${matchId}`, "player2")).toBeNull();
  });

  it("returns null when player2 already taken", async () => {
    const { player2, hold2, matchId } = await waitingCreatorAndSearcher();
    await redisClient.hset(`match:${matchId}`, "player2", "99");
    const result = await redisJoinWaitingMatch(
      player2,
      hold2,
      matchId,
      joinToken,
    );
    expect(result).toBeNull();
    expect(await redisClient.hget(`match:${matchId}`, "player2")).toBe("99");
  });

  it("returns null when player1 == player 2", async () => {
    const { player2, hold2, matchId } = await waitingCreatorAndSearcher();
    await redisClient.hset(`match:${matchId}`, "player1", `${player2}`);
    const result = await redisJoinWaitingMatch(
      player2,
      hold2,
      matchId,
      joinToken,
    );
    expect(result).toBeNull();
    expect(await redisClient.hget(`match:${matchId}`, "player2")).toBeNull();
  });

  it("refusals do not touch the reservation: the lock stays for its owner", async () => {
    const { player2, hold2, matchId } = await waitingCreatorAndSearcher();
    await redisClient.hset(`match:${matchId}`, "player2", "99");

    await redisJoinWaitingMatch(player2, hold2, matchId, joinToken);

    expect(await redisClient.get(`match:${matchId}:trylock`)).toBe(joinToken);
  });
});

describe("redisJoinWaitingMatch: successful join", () => {
  it("returns the matchId", async () => {
    const { player2, hold2, matchId } = await waitingCreatorAndSearcher();

    const result = await redisJoinWaitingMatch(player2, hold2, matchId, joinToken);

    expect(result).toBe(matchId);
  });

  it("writes the second player and starts the placement phase", async () => {
    const { player1, player2, hold1, hold2, matchId } = await waitingCreatorAndSearcher();
    const before = Date.now();

    await redisJoinWaitingMatch(player2, hold2, matchId, joinToken);

    const after = Date.now();
    const match = await redisClient.hgetall(`match:${matchId}`);
    expect(match).toEqual({
      matchId,
      status: "placement",
      player1: String(player1),
      player1HoldId: String(hold1),
      player2: String(player2),
      player2HoldId: String(hold2),
      bid: "5",
      bigAmount: "4",
      smallAmount: "1",
      createdAt: expect.stringMatching(/^\d+$/),
      updatedAt: expect.stringMatching(/^\d+$/),
      placementDeadline: expect.stringMatching(/^\d+$/),
      stateVersion: "1",
    });
    expect(Number(match["updatedAt"])).toBeGreaterThanOrEqual(before);
    expect(Number(match["updatedAt"])).toBeLessThanOrEqual(after);
    expect(Number(match["placementDeadline"])).toBeGreaterThanOrEqual(
      before + PLACEMENT_TIMEOUT * 1000,
    );
    expect(Number(match["placementDeadline"])).toBeLessThanOrEqual(
      after + PLACEMENT_TIMEOUT * 1000,
    );
  });

  it("keeps the fields of the creator unchanged", async () => {
    const { player2, hold2, matchId } = await waitingCreatorAndSearcher();
    const before = await redisClient.hgetall(`match:${matchId}`);

    await redisJoinWaitingMatch(player2, hold2, matchId, joinToken);

    const after = await redisClient.hgetall(`match:${matchId}`);
    for (const field of ["matchId", "player1", "player1HoldId", "bid", "bigAmount", "smallAmount", "createdAt"]) {
      expect(after[field]).toBe(before[field]);
    }
  });

  it("moves the match from the waiting queue to the placement queue, scored by the deadline", async () => {
    const { player2, hold2, matchId } = await waitingCreatorAndSearcher();

    await redisJoinWaitingMatch(player2, hold2, matchId, joinToken);

    const deadline = await redisClient.hget(`match:${matchId}`, "placementDeadline");
    expect(await redisClient.zcard("waiting:matches")).toBe(0);
    expect(await redisClient.zrange("placement:matches", "0", "-1", "WITHSCORES")).toEqual([
      matchId,
      deadline,
    ]);
  });

  it("points both players to the match, with a fresh lifetime for each", async () => {
    const { player1, player2, hold2, matchId } = await waitingCreatorAndSearcher();
    await redisClient.expire(`player:${player1}:currentMatch`, 100);

    await redisJoinWaitingMatch(player2, hold2, matchId, joinToken);

    for (const player of [player1, player2]) {
      expect(await redisClient.get(`player:${player}:currentMatch`)).toBe(matchId);
      const ttl = await redisClient.ttl(`player:${player}:currentMatch`);
      expect(ttl).toBeGreaterThan(MATCH_KEY_TTL - 10);
      expect(ttl).toBeLessThanOrEqual(MATCH_KEY_TTL);
    }
  });

  it("gives the match key a fresh lifetime", async () => {
    const { player2, hold2, matchId } = await waitingCreatorAndSearcher();
    await redisClient.expire(`match:${matchId}`, 100);

    await redisJoinWaitingMatch(player2, hold2, matchId, joinToken);

    const ttl = await redisClient.ttl(`match:${matchId}`);
    expect(ttl).toBeGreaterThan(MATCH_KEY_TTL - 10);
    expect(ttl).toBeLessThanOrEqual(MATCH_KEY_TTL);
  });

  it("removes the reservation", async () => {
    const { player2, hold2, matchId } = await waitingCreatorAndSearcher();

    await redisJoinWaitingMatch(player2, hold2, matchId, joinToken);

    expect(await redisClient.exists(`match:${matchId}:trylock`)).toBe(0);
  });

  it("leaves exactly four keys: match, placement queue and two pointers", async () => {
    const { player1, player2, hold2, matchId } = await waitingCreatorAndSearcher();

    await redisJoinWaitingMatch(player2, hold2, matchId, joinToken);

    expect((await redisClient.keys("*")).sort()).toEqual(
      [
        `match:${matchId}`,
        "placement:matches",
        `player:${player1}:currentMatch`,
        `player:${player2}:currentMatch`,
      ].sort(),
    );
  });
});

describe("redisJoinWaitingMatch: repeated and simultaneous calls", () => {
  it("a second call with the same token gets nothing: the reservation is used up", async () => {
    const { player2, hold2, matchId } = await waitingCreatorAndSearcher();
    const player3 = await createPlayer(3);
    const hold3 = await addHold(player3, { expiresInSeconds: 120 });

    const first = await redisJoinWaitingMatch(player2, hold2, matchId, joinToken);
    const second = await redisJoinWaitingMatch(player3, hold3, matchId, joinToken);

    expect(first).toBe(matchId);
    expect(second).toBeNull();
    expect(await redisClient.hget(`match:${matchId}`, "player2")).toBe(String(player2));
  });

  it("the same player calling twice does not change the match", async () => {
    const { player2, hold2, matchId } = await waitingCreatorAndSearcher();

    await redisJoinWaitingMatch(player2, hold2, matchId, joinToken);
    const version = await redisClient.hget(`match:${matchId}`, "stateVersion");
    const again = await redisJoinWaitingMatch(player2, hold2, matchId, joinToken);

    expect(again).toBeNull();
    expect(await redisClient.hget(`match:${matchId}`, "stateVersion")).toBe(version);
  });

  it("two players join at the same moment: exactly one gets the match", async () => {
    const { player2, hold2, matchId } = await waitingCreatorAndSearcher();
    const player3 = await createPlayer(3);
    const hold3 = await addHold(player3, { expiresInSeconds: 120 });

    const results = await Promise.all([
      redisJoinWaitingMatch(player2, hold2, matchId, joinToken),
      redisJoinWaitingMatch(player3, hold3, matchId, joinToken),
    ]);

    expect(results.filter((id) => id !== null)).toEqual([matchId]);
    const winner = results[0] !== null ? player2 : player3;
    const winnerHold = results[0] !== null ? hold2 : hold3;
    const match = await redisClient.hgetall(`match:${matchId}`);
    expect(match["player2"]).toBe(String(winner));
    expect(match["player2HoldId"]).toBe(String(winnerHold));
    expect(match["stateVersion"]).toBe("1");
    expect(await redisClient.zcard("placement:matches")).toBe(1);
  });
});
