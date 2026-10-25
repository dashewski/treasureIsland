import { ValidationError } from "../errors";
import { assertMatchId, isUuid, validateMove, validatePlacement } from "./validate";

describe("isUuid / assertMatchId", () => {
  it("accepts a v4 UUID", () => {
    expect(isUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });

  it("rejects the word current and other non-UUIDs", () => {
    expect(isUuid("current")).toBe(false);
    expect(isUuid("")).toBe(false);
    expect(isUuid("550e8400-e29b-41d4-a716-44665544000")).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isUuid(123)).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid({})).toBe(false);
  });

  it("rejects extra characters that could change a Redis key", () => {
    expect(isUuid("550e8400-e29b-41d4-a716-446655440000:placement")).toBe(false);
    expect(isUuid("*")).toBe(false);
  });

  it("assertMatchId throws invalid match id", () => {
    expect(() => assertMatchId("current")).toThrow(ValidationError);
    expect(() => assertMatchId("current")).toThrow("invalid match id");
    expect(() => assertMatchId("550e8400-e29b-41d4-a716-446655440000")).not.toThrow();
  });
});

describe("validatePlacement", () => {
  it("returns the checked values", () => {
    expect(validatePlacement(3, "big")).toEqual({ zoneId: 3, chestType: "big" });
    expect(validatePlacement(1, "small")).toEqual({ zoneId: 1, chestType: "small" });
    expect(validatePlacement(5, "big")).toEqual({ zoneId: 5, chestType: "big" });
  });

  it.each([0, 6, -1, 2.5, "3", null, undefined, NaN, Infinity])("rejects zone %p", (zone) => {
    expect(() => validatePlacement(zone, "big")).toThrow("invalid placement data");
  });

  it.each(["medium", "", "BIG", 1, null, undefined])("rejects chest type %p", (chest) => {
    expect(() => validatePlacement(2, chest)).toThrow("invalid placement data");
  });
});

describe("validateMove", () => {
  it("returns a zone from 1 to 5", () => {
    expect(validateMove(1)).toBe(1);
    expect(validateMove(5)).toBe(5);
  });

  it.each([0, 6, 1.5, "2", null, undefined, NaN])("rejects zone %p", (zone) => {
    expect(() => validateMove(zone)).toThrow(ValidationError);
    expect(() => validateMove(zone)).toThrow("invalid move data");
  });
});
