import type { Server } from "node:http"
import type { AddressInfo } from "node:net"
import { createApp } from "../api/createApp"
import { signInitData } from "./telegram"

const config = { jwtSecret: process.env["JWT_SECRET"] ?? "", telegramBotToken: process.env["TELEGRAM_BOT_TOKEN"] ?? "" }

export interface TestApp {
  baseUrl: string
  close: () => Promise<void>
  call: (method: string, path: string, token: string | null, body?: unknown) => Promise<{ status: number; body: any }>
  login: (telegramId: number) => Promise<string>
}

// the real Express app on a free port; requests go through the real HTTP stack
export async function startTestApp(): Promise<TestApp> {
  const app = createApp(config)
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  const call: TestApp["call"] = async (method, path, token, body) => {
    const response = await fetch(baseUrl + path, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
    })
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : null }
  }

  return {
    baseUrl,
    call,
    close: () => new Promise((resolve) => server.close(() => resolve())),
    login: async (telegramId) => {
      const answer = await call("POST", "/api/auth/telegram", null, {
        initData: signInitData({ id: telegramId, first_name: `Player${telegramId}` }),
      })
      if (answer.status !== 200) throw new Error(`login failed: ${answer.status}`)
      return answer.body.token
    },
  }
}
