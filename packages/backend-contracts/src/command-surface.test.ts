import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import { classifyCommandSurface, normalizeApiPath } from "./command-surface";
import { ADDON_HOST_CANARY_CONTRACT, PARITY_SMOKE_COMMANDS } from "./parity-fixtures";
import { parseCommandRoutesFromSource } from "./source-parsers";

const repoRoot = path.resolve(import.meta.dir, "../../..");
const webCorePath = path.join(repoRoot, "apps/frontend/src/adapters/web/core.ts");
const electronIpcPath = path.join(repoRoot, "apps/electron/src/shared/ipc.ts");
const webEventsPath = path.join(repoRoot, "apps/frontend/src/adapters/web/events.ts");
const electronEventsPath = path.join(repoRoot, "apps/frontend/src/adapters/electron/events.ts");
const portfolioJobsPath = path.join(repoRoot, "apps/backend/src/domains/portfolio-jobs.ts");

function readRoutes() {
  const web = parseCommandRoutesFromSource({
    source: readFileSync(webCorePath, "utf8"),
    exportName: "COMMANDS",
    sourceName: "web",
  });
  const electron = parseCommandRoutesFromSource({
    source: readFileSync(electronIpcPath, "utf8"),
    exportName: "ELECTRON_COMMANDS",
    sourceName: "electron",
  });
  return { web, electron };
}

describe("backend command surface contracts", () => {
  test("parses current web and Electron command registries without false positives", () => {
    const { web, electron } = readRoutes();

    expect(web).toHaveLength(249);
    expect(electron).toHaveLength(253);
    expect(electron.map((route) => route.command)).not.toContain("position");
    expect(web.find((route) => route.command === "get_accounts")).toEqual({
      command: "get_accounts",
      method: "GET",
      path: "/accounts",
      source: "web",
    });
  });

  test("classifies backend, native, and one-sided command contracts", () => {
    const surface = classifyCommandSurface(readRoutes());

    expect(surface.stats).toEqual({
      web: 249,
      electron: 253,
      shared: 249,
      electronOnly: 4,
      webOnly: 0,
      backend: 251,
      electronNative: 2,
    });
    expect(surface.commands.find((command) => command.command === "install_app_update")?.type).toBe(
      "electron-native",
    );
    expect(surface.commands.find((command) => command.command === "parse_csv")?.type).toBe(
      "backend",
    );
    expect(surface.commands.find((command) => command.command === "check_update")?.type).toBe(
      "backend",
    );
    expect(surface.commands.find((command) => command.command === "register_device")?.type).toBe(
      "backend",
    );
  });

  test("normalizes web and Electron API paths to the same backend namespace", () => {
    expect(normalizeApiPath({ source: "web", path: "/accounts" })).toBe("/api/v1/accounts");
    expect(normalizeApiPath({ source: "electron", path: "/api/v1/accounts" })).toBe(
      "/api/v1/accounts",
    );
    expect(
      normalizeApiPath({ source: "electron", path: "/__electron_native/install-update" }),
    ).toBe("/__electron_native/install-update");
  });

  test("keeps smoke parity and addon canary commands present in the current surface", () => {
    const surface = classifyCommandSurface(readRoutes());
    const commands = new Set(surface.commands.map((command) => command.command));

    for (const command of PARITY_SMOKE_COMMANDS) {
      expect(commands.has(command)).toBe(true);
    }
    for (const command of ADDON_HOST_CANARY_CONTRACT.requiredCommands) {
      expect(commands.has(command)).toBe(true);
    }
  });

  test("keeps addon canary event names present in backend and adapters", () => {
    const backendEvents = readFileSync(portfolioJobsPath, "utf8");
    const webEvents = readFileSync(webEventsPath, "utf8");
    const electronEvents = readFileSync(electronEventsPath, "utf8");

    for (const eventName of ADDON_HOST_CANARY_CONTRACT.requiredEvents) {
      expect(backendEvents).toContain(`"${eventName}"`);
      expect(webEvents).toContain(`"${eventName}"`);
      expect(electronEvents).toContain(`"${eventName}"`);
    }
  });
});
