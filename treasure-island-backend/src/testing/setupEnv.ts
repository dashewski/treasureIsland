// Runs before every test file. Tests always use the test database,
// whatever DATABASE_URL the shell or .env has.
import { userInfo } from "node:os";

process.env["DATABASE_URL"] =
  process.env["TEST_DATABASE_URL"] ??
  `postgresql://${userInfo().username}@localhost:5432/treasure_island_test`;
