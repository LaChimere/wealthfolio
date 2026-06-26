import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import { classifyCommandSurface } from "./command-surface";
import {
  ADDON_HOST_PREFLIGHT,
  EXPECTED_ELECTRON_NATIVE_COMMANDS,
  MIXED_VERSION_SYNC_PREFLIGHT_COMMANDS,
  SECRET_ENTRY_USERNAME,
  assertExpectedCompatibilityPreflights,
  createCommandCompatibilityReport,
  formatDesktopSecretServiceId,
  normalizeSecretNamespace,
} from "./compatibility-preflights";
import { parseCommandRoutesFromSource } from "./source-parsers";

const repoRoot = path.resolve(import.meta.dir, "../../..");

function readSurface() {
  const web = parseCommandRoutesFromSource({
    source: readFileSync(path.join(repoRoot, "apps/frontend/src/adapters/web/core.ts"), "utf8"),
    exportName: "COMMANDS",
    sourceName: "web",
  });
  const electron = parseCommandRoutesFromSource({
    source: readFileSync(path.join(repoRoot, "apps/electron/src/shared/ipc.ts"), "utf8"),
    exportName: "ELECTRON_COMMANDS",
    sourceName: "electron",
  });
  return classifyCommandSurface({ web, electron });
}

describe("full-stack TS compatibility preflights", () => {
  test("matches current desktop keyring service IDs and dev namespace behavior", () => {
    expect(SECRET_ENTRY_USERNAME).toBe("default");
    expect(formatDesktopSecretServiceId("OPENFIGI")).toBe("wealthfolio_openfigi");
    expect(formatDesktopSecretServiceId("OPENFIGI", "")).toBe("wealthfolio_openfigi");
    expect(formatDesktopSecretServiceId("OPENFIGI", "dev")).toBe("wealthfolio_dev_openfigi");
    expect(formatDesktopSecretServiceId("OPENFIGI", "Dev-Test")).toBe(
      "wealthfolio_dev_test_openfigi",
    );
    expect(normalizeSecretNamespace(" prod ⚠️ beta ")).toBe("prodbeta");
  });

  test("keeps the current web/Electron command deltas explicit", () => {
    const surface = readSurface();
    const report = createCommandCompatibilityReport(surface);

    expect(report.electronNative).toEqual([...EXPECTED_ELECTRON_NATIVE_COMMANDS].sort());
    expect(report.electronOnlyBackend).not.toContain("export_data_file");
    expect(report.electronOnlyBackend).not.toContain("parse_csv");
    expect(report.electronOnlyBackend).not.toContain("sync_encrypt");
    expect(report.electronOnlyBackend).not.toContain("backup_database_to_path");
    expect(report.electronOnlyBackend).not.toContain("restore_database");
    expect(report.webOnlyBackend).not.toContain("list_database_backups");
    expect(report.webOnlyBackend).not.toContain("delete_database_backup");
    expect(report.webOnlyBackend).not.toContain("check_update");
    expect(() => assertExpectedCompatibilityPreflights(surface)).not.toThrow();
  });

  test("keeps addon host canary backend commands present before TS domain cutover", () => {
    const commands = new Set(readSurface().commands.map((command) => command.command));

    for (const command of ADDON_HOST_PREFLIGHT.requiredBackendCommands) {
      expect(commands.has(command)).toBe(true);
    }
    expect(ADDON_HOST_PREFLIGHT.requiredGlobals).toEqual(["React", "ReactDOM.createPortal"]);
  });

  test("keeps mixed-version sync preflight commands visible in the current command surface", () => {
    const commands = new Set(readSurface().commands.map((command) => command.command));

    for (const command of MIXED_VERSION_SYNC_PREFLIGHT_COMMANDS) {
      expect(commands.has(command)).toBe(true);
    }
  });
});
