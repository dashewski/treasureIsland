import { loadEnv } from "./env";

const full = {
  PORT: "4000",
  JWT_SECRET: "test-secret",
  TELEGRAM_BOT_TOKEN: "test-token",
  DATABASE_URL: "postgres://localhost/test",
  REDIS_URL: "redis://localhost:6379",
};

describe("loadEnv", () => {
  it("reads all required variables", () => {
    expect(loadEnv(full)).toEqual({
      port: 4000,
      jwtSecret: "test-secret",
      telegramBotToken: "test-token",
      databaseUrl: "postgres://localhost/test",
      redisUrl: "redis://localhost:6379",
    });
  });

  it("defaults the port to 3000", () => {
    const { PORT: _ignored, ...withoutPort } = full;
    expect(loadEnv(withoutPort).port).toBe(3000);
  });

  it.each(["JWT_SECRET", "TELEGRAM_BOT_TOKEN", "DATABASE_URL", "REDIS_URL"])(
    "throws when %s is missing",
    (name) => {
      const env: NodeJS.ProcessEnv = { ...full };
      delete env[name];
      expect(() => loadEnv(env)).toThrow(name);
    },
  );

  it("treats an empty string as missing", () => {
    expect(() => loadEnv({ ...full, JWT_SECRET: "" })).toThrow("JWT_SECRET");
  });

  it("rejects an invalid PORT", () => {
    expect(() => loadEnv({ ...full, PORT: "abc" })).toThrow("PORT");
  });
});
