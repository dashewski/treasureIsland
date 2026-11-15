import { INITDATA_MAX_AGE } from "../constants"
import { AuthError } from "../errors"
import { signInitData, TEST_BOT_TOKEN } from "../testing/telegram"
import { verifyTelegramInitData } from "./verifyTelegramInitData"

const user = { id: 279058397, first_name: "Anna" }
const now = 1_800_000_000

describe("verifyTelegramInitData", () => {
  it("accepts correctly signed data and returns the user and the date", () => {
    const initData = signInitData(user, { authDate: now - 10 })
    expect(verifyTelegramInitData(initData, TEST_BOT_TOKEN, now)).toEqual({
      telegramUser: user,
      authDate: now - 10,
    })
  })

  it.each([
    ["is missing", undefined],
    ["is not a string", 42],
    ["is empty", ""],
    ["has no hash", "auth_date=1&user=%7B%7D"],
  ])("rejects initData that %s", (_name, initData) => {
    expect(() => verifyTelegramInitData(initData, TEST_BOT_TOKEN, now)).toThrow(AuthError)
  })

  it("rejects data signed with another bot token", () => {
    const initData = signInitData(user, { botToken: "999:other", authDate: now - 10 })
    expect(() => verifyTelegramInitData(initData, TEST_BOT_TOKEN, now)).toThrow("bad signature")
  })

  it("rejects data changed after signing", () => {
    const initData = signInitData(user, { authDate: now - 10 })
    const params = new URLSearchParams(initData)
    params.set("user", JSON.stringify({ id: 1, first_name: "Hacker" }))
    expect(() => verifyTelegramInitData(params.toString(), TEST_BOT_TOKEN, now)).toThrow("bad signature")
  })

  it("rejects a hash of the wrong length without crashing", () => {
    const params = new URLSearchParams(signInitData(user, { authDate: now - 10 }))
    params.set("hash", "abc")
    expect(() => verifyTelegramInitData(params.toString(), TEST_BOT_TOKEN, now)).toThrow("bad signature")
  })

  it("accepts data exactly INITDATA_MAX_AGE old and rejects one second older", () => {
    const edge = signInitData(user, { authDate: now - INITDATA_MAX_AGE })
    expect(() => verifyTelegramInitData(edge, TEST_BOT_TOKEN, now)).not.toThrow()
    const old = signInitData(user, { authDate: now - INITDATA_MAX_AGE - 1 })
    expect(() => verifyTelegramInitData(old, TEST_BOT_TOKEN, now)).toThrow("too old")
  })

  it("rejects an auth_date in the future", () => {
    const initData = signInitData(user, { authDate: now + 60 })
    expect(() => verifyTelegramInitData(initData, TEST_BOT_TOKEN, now)).toThrow("future")
  })

  it("rejects data without auth_date or without user, even when correctly signed", () => {
    expect(() =>
      verifyTelegramInitData(signInitData(user, { omit: ["auth_date"] }), TEST_BOT_TOKEN, now),
    ).toThrow("auth_date")
    expect(() =>
      verifyTelegramInitData(signInitData(user, { omit: ["user"], authDate: now - 1 }), TEST_BOT_TOKEN, now),
    ).toThrow("user")
  })

  it.each([
    ["a string id", { id: "5", first_name: "A" }],
    ["id zero", { id: 0, first_name: "A" }],
    ["a negative id", { id: -5, first_name: "A" }],
    ["a fractional id", { id: 1.5, first_name: "A" }],
    ["no first name", { id: 5 }],
  ])("rejects a user with %s", (_name, badUser) => {
    const initData = signInitData(badUser as { id: number; first_name: string }, { authDate: now - 1 })
    expect(() => verifyTelegramInitData(initData, TEST_BOT_TOKEN, now)).toThrow("user is invalid")
  })
})
