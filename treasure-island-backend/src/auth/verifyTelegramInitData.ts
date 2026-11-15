import { createHmac, timingSafeEqual } from "node:crypto";
import { INITDATA_MAX_AGE } from "../constants";
import { AuthError } from "../errors";
import type { TelegramUser } from "./findOrCreatePlayer";

export interface VerifiedInitData {
  telegramUser: TelegramUser;
  authDate: number; // seconds
}

// checks the signature Telegram put on initData (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
export function verifyTelegramInitData(
  initData: unknown,
  botToken: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): VerifiedInitData {
  if (typeof initData !== "string" || initData === "") throw new AuthError("initData is missing");

  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  if (receivedHash === null || receivedHash === "") throw new AuthError("hash is missing");
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const calculated = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  const received = Buffer.from(receivedHash, "utf8");
  const expected = Buffer.from(calculated, "utf8");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new AuthError("bad signature");
  }

  const authDate = Number(params.get("auth_date"));
  if (!Number.isInteger(authDate) || authDate <= 0) throw new AuthError("auth_date is missing");
  if (authDate > nowSeconds) throw new AuthError("auth_date is in the future");
  if (nowSeconds - authDate > INITDATA_MAX_AGE) throw new AuthError("initData is too old");

  let telegramUser: unknown;
  try {
    telegramUser = JSON.parse(params.get("user") ?? "");
  } catch {
    throw new AuthError("user is missing");
  }
  if (
    typeof telegramUser !== "object" ||
    telegramUser === null ||
    !("id" in telegramUser) ||
    typeof telegramUser.id !== "number" ||
    !Number.isSafeInteger(telegramUser.id) ||
    telegramUser.id <= 0 ||
    !("first_name" in telegramUser) ||
    typeof telegramUser.first_name !== "string"
  ) {
    throw new AuthError("user is invalid");
  }
  return { telegramUser: telegramUser as TelegramUser, authDate };
}
