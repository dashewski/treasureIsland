import { findOrCreatePlayer } from "./findOrCreatePlayer";
import { issueJWT } from "./jwt";
import { verifyTelegramInitData } from "./verifyTelegramInitData";

// POST /api/auth/telegram: the only route without a token
export async function authTelegram(
  initData: unknown,
  config: { botToken: string; jwtSecret: string },
): Promise<{ token: string }> {
  const { telegramUser } = verifyTelegramInitData(initData, config.botToken);
  const player = await findOrCreatePlayer(telegramUser);
  return { token: issueJWT(player.id, config.jwtSecret) };
}
