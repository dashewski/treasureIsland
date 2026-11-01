// tests always run against the test database, whatever DATABASE_URL says
import { userInfo } from "node:os";

process.env["DATABASE_URL"] =
  process.env["TEST_DATABASE_URL"] ??
  `postgresql://${userInfo().username}@localhost:5432/treasure_island_test`;

// Redis db 1 is for tests, db 0 holds the real data
process.env["REDIS_URL"] = process.env["TEST_REDIS_URL"] ?? "redis://localhost:6379/1";
