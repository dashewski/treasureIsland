import { pool } from "../db/pool";
import { findOrCreatePlayer } from "./findOrCreatePlayer";

function telegramUser(id: number, firstName = "Anna") {
  return {
    id,
    first_name: firstName,
    last_name: "Petrova",
    username: "anna_p",
    language_code: "ru",
  };
}

async function playersWithTgid(tgid: number) {
  const { rows } = await pool.query("SELECT * FROM players WHERE tgid = $1", [tgid]);
  return rows;
}

beforeAll(async () => {
  const { rows } = await pool.query("SELECT current_database() AS name");
  if (!String(rows[0].name).endsWith("_test")) {
    throw new Error(`Refusing to run against ${rows[0].name}`);
  }
});

beforeEach(async () => {
  await pool.query("TRUNCATE players RESTART IDENTITY CASCADE");
});

afterAll(async () => {
  await pool.end();
});

describe("findOrCreatePlayer", () => {
  it("creates a new player", async () => {
    const player = await findOrCreatePlayer(telegramUser(279058397));

    expect(player.id).toBe(1);
    expect(player.player).toBe("Anna");
    expect(player.balance).toBe("0.00");
    expect(await playersWithTgid(279058397)).toHaveLength(1);
  });

  it("returns tgid as a string, because the column is BIGINT", async () => {
    const player = await findOrCreatePlayer(telegramUser(279058397));
    expect(player.tgid).toBe("279058397");
  });

  it("returns the same player on the next login", async () => {
    const first = await findOrCreatePlayer(telegramUser(279058397));
    const second = await findOrCreatePlayer(telegramUser(279058397));

    expect(second.id).toBe(first.id);
    expect(await playersWithTgid(279058397)).toHaveLength(1);
  });

  it("updates the name of an existing player and keeps the balance", async () => {
    const first = await findOrCreatePlayer(telegramUser(279058397, "Anna"));
    await pool.query("UPDATE players SET balance = 50 WHERE id = $1", [first.id]);

    const second = await findOrCreatePlayer(telegramUser(279058397, "Anna New"));

    expect(second.id).toBe(first.id);
    expect(second.player).toBe("Anna New");
    expect(second.balance).toBe("50.00");
  });

  it("creates different players for different Telegram ids", async () => {
    const a = await findOrCreatePlayer(telegramUser(1));
    const b = await findOrCreatePlayer(telegramUser(2));
    expect(a.id).not.toBe(b.id);
  });

  it("many logins at the same moment give one player and no error", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => findOrCreatePlayer(telegramUser(555))),
    );

    expect(new Set(results.map((p) => p.id)).size).toBe(1);
    expect(await playersWithTgid(555)).toHaveLength(1);
  });

  it("stores a hostile name as plain text and keeps the table", async () => {
    const hostile = "x'); DROP TABLE players; --";
    const player = await findOrCreatePlayer(telegramUser(666, hostile));

    expect(player.player).toBe(hostile);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM players");
    expect(rows[0].n).toBe(1);
  });
});
