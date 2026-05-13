import { describe, expect, test } from "bun:test";

import { createElectronLogWriter, formatLogEntry, validateLogMessage } from "./logging";

describe("Electron logging", () => {
  test("validates renderer log messages", () => {
    expect(validateLogMessage({ level: "info", message: "hello" })).toEqual({
      level: "info",
      message: "hello",
    });

    expect(() => validateLogMessage({ level: "fatal", message: "hello" })).toThrow(
      "Invalid Electron log message.",
    );
    expect(() => validateLogMessage({ level: "info", message: 42 })).toThrow(
      "Invalid Electron log message.",
    );
  });

  test("formats entries with timestamps and upper-case levels", () => {
    expect(formatLogEntry("warn", "careful", new Date("2026-01-02T03:04:05.000Z"))).toBe(
      "2026-01-02T03:04:05.000Z [WARN] careful\n",
    );
  });

  test("writes formatted log entries to the configured file", async () => {
    const writes: Array<{ path: string; content: string; encoding: string }> = [];
    const writer = createElectronLogWriter("/logs/wealthfolio-electron.log", async (...args) => {
      const [path, content, encoding] = args;
      writes.push({
        path: String(path),
        content: String(content),
        encoding: String(encoding ?? "utf8"),
      });
    });

    await writer.write("error", "boom");

    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe("/logs/wealthfolio-electron.log");
    expect(writes[0].encoding).toBe("utf8");
    expect(writes[0].content).toContain("[ERROR] boom\n");
  });
});
