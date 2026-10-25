export interface Env {
  port: number;
  jwtSecret: string;
  telegramBotToken: string;
  databaseUrl: string;
  redisUrl: string;
}

function required(source: NodeJS.ProcessEnv, name: string): string {
  const value = source[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Fail at startup, not in the middle of a request.
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const port = Number(source["PORT"] ?? "3000");
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("PORT must be a positive integer");
  }
  return {
    port,
    jwtSecret: required(source, "JWT_SECRET"),
    telegramBotToken: required(source, "TELEGRAM_BOT_TOKEN"),
    databaseUrl: required(source, "DATABASE_URL"),
    redisUrl: required(source, "REDIS_URL"),
  };
}
