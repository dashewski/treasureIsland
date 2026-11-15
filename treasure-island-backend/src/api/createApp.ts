import express, { type Express, type Request } from "express";
import { authMiddleware } from "../auth/authMiddleware";
import { authTelegram } from "../auth/authTelegram";
import { pool } from "../db/pool";
import { AuthError } from "../errors";
import { getMatchStatus } from "../matchmaking/getMatchStatus";
import { startMatch } from "../matchmaking/startMatch";
import { placeChest } from "../placement/placeChest";
import { redisClient } from "../redis/redisClient";
import { reconnect } from "../reconnect/reconnect";
import { makeMove } from "../reveal/makeMove";
import { errorHandler } from "./errorHandler";

export interface AppConfig {
  jwtSecret: string;
  telegramBotToken: string;
  corsOrigin?: string;
}

// the player id is set by authMiddleware; a missing one means the route was wired without it
function playerOf(req: Request): string {
  if (req.playerId === undefined) throw new AuthError("no player");
  return req.playerId;
}

function bodyOf(req: Request): Record<string, unknown> {
  const body: unknown = req.body;
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
}

export function createApp(config: AppConfig): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "10kb" }));

  const origin = config.corsOrigin;
  if (origin !== undefined) {
    app.use((req, res, next) => {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      if (req.method === "OPTIONS") {
        res.sendStatus(204);
        return;
      }
      next();
    });
  }

  app.get("/health", (_req, res) => {
    res.json({ health: true });
  });

  app.get("/database", async (_req, res) => {
    await pool.query("SELECT 1");
    res.json({ database: true });
  });
  app.get("/redis", async (_req, res) => {
    await redisClient.ping();
    res.json({ redis: true });
  });

  app.post("/api/auth/telegram", async (req, res) => {
    try {
      res.json(
        await authTelegram(bodyOf(req)["initData"], {
          botToken: config.telegramBotToken,
          jwtSecret: config.jwtSecret,
        }),
      );
    } catch (error) {
      if (error instanceof AuthError) {
        res.status(401).json({ error: "signIn error" });
        return;
      }
      throw error;
    }
  });

  const api = express.Router();
  api.use(authMiddleware(config.jwtSecret));

  api.post("/match/start", async (req, res) => {
    res.json(await startMatch(Number(playerOf(req))));
  });
  api.post("/match/place", async (req, res) => {
    const { matchId, chestType, zoneId } = bodyOf(req);
    res.json(await placeChest(matchId, playerOf(req), chestType, zoneId));
  });
  api.post("/match/move", async (req, res) => {
    const { matchId, zoneId } = bodyOf(req);
    res.json(await makeMove(matchId, playerOf(req), zoneId));
  });
  api.get("/match/:matchId", async (req, res) => {
    res.json(await getMatchStatus(req.params["matchId"], playerOf(req)));
  });
  api.get("/me/reconnect", async (req, res) => {
    res.json(await reconnect(playerOf(req)));
  });
  app.use("/api", api);

  app.use((_req, res) => {
    res.status(404).json({ error: "not found" });
  });
  app.use(errorHandler);
  return app;
}
