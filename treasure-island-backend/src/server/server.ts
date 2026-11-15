import { createApp } from "../api/createApp";
import { pool } from "../db/pool";
import { loadEnv } from "../env";
import { redisClient } from "../redis/redisClient";
import { startWorker } from "../worker/worker";

const env = loadEnv();
const corsOrigin = process.env["CORS_ORIGIN"];
const app = createApp({
  jwtSecret: env.jwtSecret,
  telegramBotToken: env.telegramBotToken,
  ...(corsOrigin ? { corsOrigin } : {}),
});

const server = app.listen(env.port, () => {
  console.log(`server live on ${env.port}`);
});
const stopWorker = startWorker();

// finish the running pass and the open requests before the connections close
async function shutdown(): Promise<void> {
  server.close();
  await stopWorker();
  await pool.end();
  await redisClient.quit();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
