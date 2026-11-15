import { createHmac } from "node:crypto"

export const TEST_BOT_TOKEN = process.env["TELEGRAM_BOT_TOKEN"] ?? "123456:test-bot-token"

// initData signed the way Telegram does it
export function signInitData(
  user: { id: number; first_name: string },
  options: { botToken?: string; authDate?: number; omit?: string[] } = {},
): string {
  const { botToken = TEST_BOT_TOKEN, authDate = Math.floor(Date.now() / 1000), omit = [] } = options
  const fields: Record<string, string> = {
    auth_date: String(authDate),
    query_id: "AAH-test",
    user: JSON.stringify(user),
  }
  for (const name of omit) delete fields[name]
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join("\n")
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest()
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex")
  return new URLSearchParams({ ...fields, hash }).toString()
}
