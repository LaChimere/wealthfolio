import { describe, expect, test } from "bun:test";

import {
  normalizeDecimalString,
  normalizeErrorEnvelope,
  normalizeOutputForParity,
  normalizeTemporalString,
} from "./normalization";

describe("parity normalization contracts", () => {
  test("normalizes decimal strings without falling back to JavaScript number semantics", () => {
    expect(normalizeDecimalString("001.2300")).toBe("1.23");
    expect(normalizeDecimalString("-0.0000")).toBe("0");
    expect(normalizeDecimalString("1e-7")).toBe("1e-7");
    expect(() => normalizeDecimalString(Number.POSITIVE_INFINITY)).toThrow(
      "Cannot normalize non-finite decimal value",
    );
  });

  test("normalizes date-only and instant strings with explicit precision semantics", () => {
    expect(normalizeTemporalString("2026-03-30")).toBe("2026-03-30");
    expect(normalizeTemporalString("2026-03-30T10:20:30.123456Z")).toBe("2026-03-30T10:20:30.123Z");
    expect(() => normalizeTemporalString("not-a-date")).toThrow(
      "Cannot normalize invalid temporal value",
    );
  });

  test("normalizes error envelopes to comparable fields", () => {
    expect(normalizeErrorEnvelope(new Error("boom"))).toEqual({ message: "boom" });
    expect(normalizeErrorEnvelope({ message: "denied", code: "AUTH", status: 401 })).toEqual({
      message: "denied",
      code: "AUTH",
      status: 401,
    });
  });

  test("normalizes object key ordering recursively for parity snapshots", () => {
    expect(normalizeOutputForParity({ z: 1, a: { y: 2, b: 3 } })).toEqual({
      a: { b: 3, y: 2 },
      z: 1,
    });
  });
});
