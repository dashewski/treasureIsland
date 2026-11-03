import { isUuid } from "../domain/validate"
import { redisClient } from "../redis/redisClient"
import { closeRedis, resetRedis } from "../testing/resetRedis"
import { getMatchAction } from "./getMatchAction"

// a match that is waiting for an opponent: the hash exists and it stands in the queue
async function addWaitingMatch(matchId: string, score: number) {
  await redisClient.hset(`match:${matchId}`, { matchId, status: "waiting" })
  await redisClient.zadd("waiting:matches", score, matchId)
}

// someone else already reserved the match
async function bookMatch(matchId: string) {
  await redisClient.set(`match:${matchId}:trylock`, "someone-else", "PX", 5000)
}

beforeEach(resetRedis)
afterAll(closeRedis)

describe("getMatchAction with an empty queue", () => {
  it("gives the right to create a match, with a fresh token", async () => {
    const action = await getMatchAction(7)

    expect(action).toMatchObject({ action: "create" })
    expect(isUuid((action as { token: string }).token)).toBe(true)
  })

  it("leaves the token in lock:create for about two seconds", async () => {
    const action = await getMatchAction(7)

    expect(await redisClient.get("lock:create")).toBe((action as { token: string }).token)
    const ttl = await redisClient.pttl("lock:create")
    expect(ttl).toBeGreaterThan(1000)
    expect(ttl).toBeLessThanOrEqual(2000)
  })

  it("returns null while somebody else holds the right to create", async () => {
    await redisClient.set("lock:create", "another-token", "PX", 2000)

    expect(await getMatchAction(7)).toBeNull()

    expect(await redisClient.get("lock:create")).toBe("another-token")
  })

  it("every call gets its own token", async () => {
    const first = await getMatchAction(7)
    await redisClient.del("lock:create")
    const second = await getMatchAction(8)

    expect((first as { token: string }).token).not.toBe((second as { token: string }).token)
  })
})

describe("getMatchAction with waiting matches", () => {
  it("joins a live match and reserves it with the token", async () => {
    await addWaitingMatch("m1", 100)

    const action = await getMatchAction(7)

    expect(action).toMatchObject({ action: "join", matchId: "m1" })
    expect(await redisClient.get("match:m1:trylock")).toBe((action as { token: string }).token)
  })

  it("the reservation lasts about five seconds", async () => {
    await addWaitingMatch("m1", 100)

    await getMatchAction(7)

    const ttl = await redisClient.pttl("match:m1:trylock")
    expect(ttl).toBeGreaterThan(4000)
    expect(ttl).toBeLessThanOrEqual(5000)
  })

  it("does not touch lock:create when it joins", async () => {
    await addWaitingMatch("m1", 100)

    await getMatchAction(7)

    expect(await redisClient.exists("lock:create")).toBe(0)
  })

  it("does not change the match or take it out of the queue", async () => {
    await addWaitingMatch("m1", 100)

    await getMatchAction(7)

    expect(await redisClient.hgetall("match:m1")).toEqual({ matchId: "m1", status: "waiting" })
    expect(await redisClient.zrange("waiting:matches", "0", "-1")).toEqual(["m1"])
  })

  it("takes the oldest match first", async () => {
    await addWaitingMatch("newer", 300)
    await addWaitingMatch("oldest", 100)
    await addWaitingMatch("middle", 200)

    expect(await getMatchAction(7)).toMatchObject({ action: "join", matchId: "oldest" })
  })

  it("skips a match that someone else has reserved", async () => {
    await addWaitingMatch("m1", 100)
    await addWaitingMatch("m2", 200)
    await bookMatch("m1")

    expect(await getMatchAction(7)).toMatchObject({ action: "join", matchId: "m2" })
    expect(await redisClient.get("match:m1:trylock")).toBe("someone-else")
  })

  it("asks to create a match when every waiting match is reserved", async () => {
    await addWaitingMatch("m1", 100)
    await addWaitingMatch("m2", 200)
    await bookMatch("m1")
    await bookMatch("m2")

    expect(await getMatchAction(7)).toMatchObject({ action: "create" })
  })

  it("looks only at the first ten matches", async () => {
    for (let i = 1; i <= 10; i++) {
      await addWaitingMatch(`m${i}`, i)
      await bookMatch(`m${i}`)
    }
    await addWaitingMatch("m11", 11)

    expect(await getMatchAction(7)).toMatchObject({ action: "create" })
    expect(await redisClient.exists("match:m11:trylock")).toBe(0)
  })
})

describe("getMatchAction with dead matches in the queue", () => {
  it("removes a dead id from the queue and joins the next live match", async () => {
    await redisClient.zadd("waiting:matches", 100, "dead")
    await addWaitingMatch("alive", 200)

    expect(await getMatchAction(7)).toMatchObject({ action: "join", matchId: "alive" })
    expect(await redisClient.zrange("waiting:matches", "0", "-1")).toEqual(["alive"])
  })

  it("cleans a queue that holds only dead ids and asks to create", async () => {
    await redisClient.zadd("waiting:matches", 100, "dead1", 200, "dead2")

    expect(await getMatchAction(7)).toMatchObject({ action: "create" })
    expect(await redisClient.zcard("waiting:matches")).toBe(0)
  })

  it("returns null when the queue only had dead ids but somebody holds the right to create", async () => {
    await redisClient.zadd("waiting:matches", 100, "dead")
    await redisClient.set("lock:create", "another-token", "PX", 2000)

    expect(await getMatchAction(7)).toBeNull()
    expect(await redisClient.zcard("waiting:matches")).toBe(0)
  })
})

describe("getMatchAction at the same moment", () => {
  it("one live match and ten callers: one joins, one may create, the rest get null", async () => {
    await addWaitingMatch("m1", 100)

    const actions = await Promise.all(Array.from({ length: 10 }, (_, i) => getMatchAction(i)))

    expect(actions.filter((a) => a?.action === "join")).toHaveLength(1)
    expect(actions.filter((a) => a?.action === "create")).toHaveLength(1)
    expect(actions.filter((a) => a === null)).toHaveLength(8)
  })

  it("an empty queue and ten callers: exactly one gets the right to create", async () => {
    const actions = await Promise.all(Array.from({ length: 10 }, (_, i) => getMatchAction(i)))

    expect(actions.filter((a) => a?.action === "create")).toHaveLength(1)
    expect(actions.filter((a) => a === null)).toHaveLength(9)
  })

  it("two live matches and five callers: no match is joined twice", async () => {
    await addWaitingMatch("m1", 100)
    await addWaitingMatch("m2", 200)

    const actions = await Promise.all(Array.from({ length: 5 }, (_, i) => getMatchAction(i)))

    const joined = actions.flatMap((a) => (a?.action === "join" ? [a.matchId] : []))
    expect(joined.sort()).toEqual(["m1", "m2"])
  })
})

describe("getMatchAction answers it does not understand", () => {
  it("throws on an unexpected answer from the script", async () => {
    const spy = jest.spyOn(redisClient, "eval").mockResolvedValueOnce(["surprise"] as never)

    try {
      await expect(getMatchAction(7)).rejects.toThrow("unexpected answer")
    } finally {
      spy.mockRestore()
    }
  })
})
