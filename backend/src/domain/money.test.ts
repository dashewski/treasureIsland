import { centsToDecimalString, decimalToCents } from "./money";

describe("decimalToCents", () => {
  it("converts strings and numbers to integer cents", () => {
    expect(decimalToCents("5")).toBe(500);
    expect(decimalToCents("5.00")).toBe(500);
    expect(decimalToCents("0.45")).toBe(45);
    expect(decimalToCents(4)).toBe(400);
  });

  it("is not thrown off by float error like 0.1 + 0.2", () => {
    expect(decimalToCents(0.1 + 0.2)).toBe(30);
  });

  it("throws on garbage", () => {
    expect(() => decimalToCents("abc")).toThrow();
    expect(() => decimalToCents(Number.NaN)).toThrow();
  });
});

describe("centsToDecimalString", () => {
  it("formats with two digits", () => {
    expect(centsToDecimalString(360)).toBe("3.60");
    expect(centsToDecimalString(500)).toBe("5.00");
    expect(centsToDecimalString(5)).toBe("0.05");
    expect(centsToDecimalString(0)).toBe("0.00");
  });

  it("keeps the minus sign", () => {
    expect(centsToDecimalString(-360)).toBe("-3.60");
    expect(centsToDecimalString(-5)).toBe("-0.05");
  });

  it("rejects fractional cents", () => {
    expect(() => centsToDecimalString(1.5)).toThrow();
  });
});
