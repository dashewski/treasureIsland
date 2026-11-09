import { hasPgCode } from "./pgError"

describe("hasPgCode", () => {
  it("is true for an error object with the same code", () => {
    expect(hasPgCode({ code: "23505" }, "23505")).toBe(true)
  })

  it("is true for a real Error that carries a code", () => {
    const error = Object.assign(new Error("deadlock"), { code: "40P01" })

    expect(hasPgCode(error, "40P01")).toBe(true)
  })

  it("is false for another code", () => {
    expect(hasPgCode({ code: "23505" }, "40P01")).toBe(false)
  })

  it("is false for an error without a code", () => {
    expect(hasPgCode(new Error("plain"), "23505")).toBe(false)
  })

  it.each([null, undefined, "23505", 23505])("is false for %p, which is not an object", (value) => {
    expect(hasPgCode(value, "23505")).toBe(false)
  })
})
