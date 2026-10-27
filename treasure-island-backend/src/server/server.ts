import express from "express";
import { pool } from "../db/pool";
import { redisClient } from "../redis/redisClient";

const app = express();

app.get("/health", (req, res) => {
  res.json({ health: true });
});

app.get("/database", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ database: true });
  } catch (error: unknown) {
    console.error(error);
    res.status(500).json({ database: false });
  }
});

app.get("/redisClient", async (req, res) => {
  try {
    await redisClient.ping();
    res.json({ redis: true });
  } catch (error: unknown) {
    console.error(error);
    res.status(500).json({ redis: false });
  }
});

app.listen(3000, () => {
  console.log("server live");
});
