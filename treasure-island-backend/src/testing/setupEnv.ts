// tests always run against the test database, whatever DATABASE_URL says
import { userInfo } from "node:os";

process.env["DATABASE_URL"] =
  process.env["TEST_DATABASE_URL"] ??
  `postgresql://${userInfo().username}@localhost:5432/treasure_island_test`;
