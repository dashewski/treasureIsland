import jwt from "jsonwebtoken"
import { AuthError } from "../errors"
import { issueJWT, verifyJWT } from "./jwt"

const secret = "unit-test-secret"

describe("jwt", () => {
  it("issues a token that gives back the same player id as a string", () => {
    expect(verifyJWT(issueJWT(42, secret), secret)).toBe("42")
  })

  it("rejects a token signed with another secret", () => {
    expect(() => verifyJWT(issueJWT(42, "other"), secret)).toThrow(AuthError)
  })

  it("rejects an expired token", () => {
    const expired = jwt.sign({ sub: "42" }, secret, { algorithm: "HS256", expiresIn: -10 })
    expect(() => verifyJWT(expired, secret)).toThrow(AuthError)
  })

  it("rejects an unsigned token (algorithm none)", () => {
    const none = jwt.sign({ sub: "42" }, "", { algorithm: "none" })
    expect(() => verifyJWT(none, secret)).toThrow(AuthError)
  })

  it("rejects a token signed with another algorithm", () => {
    const hs512 = jwt.sign({ sub: "42" }, secret, { algorithm: "HS512" })
    expect(() => verifyJWT(hs512, secret)).toThrow(AuthError)
  })

  it.each([["no sub", {}], ["a number sub", { sub: 42 }], ["a text sub", { sub: "abc" }], ["sub 0", { sub: "0" }]])(
    "rejects a valid signature with %s",
    (_name, payload) => {
      const token = jwt.sign(payload, secret, { algorithm: "HS256" })
      expect(() => verifyJWT(token, secret)).toThrow(AuthError)
    },
  )

  it("rejects garbage", () => {
    expect(() => verifyJWT("not-a-token", secret)).toThrow(AuthError)
  })
})
