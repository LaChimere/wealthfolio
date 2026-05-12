import { describe, expect, test } from "bun:test";

import { resolveLegacyTauriPaths } from "./data-root";

describe("resolveLegacyTauriPaths", () => {
  test("uses the legacy macOS Tauri app data and log roots", () => {
    expect(resolveLegacyTauriPaths("darwin", { HOME: "/Users/alex" })).toEqual({
      dataRoot: "/Users/alex/Library/Application Support/com.teymz.wealthfolio",
      dbPath: "/Users/alex/Library/Application Support/com.teymz.wealthfolio/app.db",
      logRoot: "/Users/alex/Library/Logs/com.teymz.wealthfolio",
    });
  });

  test("uses XDG_DATA_HOME on Linux when present", () => {
    expect(
      resolveLegacyTauriPaths("linux", {
        HOME: "/home/alex",
        XDG_DATA_HOME: "/var/data/alex",
      }),
    ).toEqual({
      dataRoot: "/var/data/alex/com.teymz.wealthfolio",
      dbPath: "/var/data/alex/com.teymz.wealthfolio/app.db",
      logRoot: "/var/data/alex/com.teymz.wealthfolio/logs",
    });
  });

  test("falls back to ~/.local/share on Linux", () => {
    expect(resolveLegacyTauriPaths("linux", { HOME: "/home/alex" })).toEqual({
      dataRoot: "/home/alex/.local/share/com.teymz.wealthfolio",
      dbPath: "/home/alex/.local/share/com.teymz.wealthfolio/app.db",
      logRoot: "/home/alex/.local/share/com.teymz.wealthfolio/logs",
    });
  });

  test("uses AppData roots on Windows", () => {
    expect(
      resolveLegacyTauriPaths("win32", {
        APPDATA: "C:\\Users\\Alex\\AppData\\Roaming",
        LOCALAPPDATA: "C:\\Users\\Alex\\AppData\\Local",
      }),
    ).toEqual({
      dataRoot: "C:\\Users\\Alex\\AppData\\Roaming\\com.teymz.wealthfolio",
      dbPath: "C:\\Users\\Alex\\AppData\\Roaming\\com.teymz.wealthfolio\\app.db",
      logRoot: "C:\\Users\\Alex\\AppData\\Local\\com.teymz.wealthfolio\\logs",
    });
  });
});
