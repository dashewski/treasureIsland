import { redisClient } from "../redis/redisClient"

// wipes the test Redis db, refuses to touch db 0
export async function resetRedis(): Promise<void> {
  if (!redisClient.options.db) {
    throw new Error("Refusing to flush Redis db 0, tests must use another db")
  }
  await redisClient.flushdb()
}

export async function closeRedis(): Promise<void> {
  await redisClient.quit()
}
