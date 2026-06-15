import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import { resolveElectronBackendRuntimeKind, startElectronBackendRuntime } from "./backend-runtime";
import { createTsBackendCommand } from "./sidecar";

const legacyPaths = {
  dataRoot: "/tmp/wealthfolio",
  dbPath: "/tmp/wealthfolio/app.db",
  logRoot: "/tmp/wealthfolio/logs",
};
const repositoryRoot = path.resolve(import.meta.dir, "../../../..");

describe("Electron backend runtime selector", () => {
  test("defaults to the TypeScript backend and rejects removed Rust runtime selection", () => {
    expect(resolveElectronBackendRuntimeKind({})).toBe("ts");
    expect(resolveElectronBackendRuntimeKind({ WF_BACKEND_RUNTIME: "ts" })).toBe("ts");
    expect(resolveElectronBackendRuntimeKind({ WF_BACKEND_RUNTIME: "bun" })).toBe("ts");
    expect(() => resolveElectronBackendRuntimeKind({ WF_BACKEND_RUNTIME: "rust-sidecar" })).toThrow(
      "WF_BACKEND_RUNTIME=rust is no longer supported",
    );
    expect(() => resolveElectronBackendRuntimeKind({ WF_BACKEND_RUNTIME: "node" })).toThrow(
      'Unsupported WF_BACKEND_RUNTIME "node"',
    );
  });

  test("creates a Bun child-process command for the TS backend without importing it into Electron", () => {
    expect(createTsBackendCommand("/repo")).toEqual({
      command: "bun",
      args: ["run", "start"],
      cwd: "/repo/apps/backend",
    });
    expect(createTsBackendCommand("C:\\repo", "win32").command).toBe("bun.exe");
  });

  test("packaged builds default to the bundled TS backend runtime", async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "wealthfolio-electron-packaged-ts-test-"));

    try {
      await expect(
        startElectronBackendRuntime({
          legacyPaths,
          repositoryRoot: "/repo",
          packaged: true,
          resourcesPath: tempRoot,
          timeoutMs: 10,
        }),
      ).rejects.toThrow("Electron TypeScript backend is not bundled");
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });

  test("can start the explicitly selected TS backend through the shared sidecar lifecycle", async () => {
    const handle = await startElectronBackendRuntime({
      legacyPaths,
      repositoryRoot,
      packaged: false,
      resourcesPath: "/resources",
      timeoutMs: 10_000,
      runtime: "ts",
    });

    try {
      const ready = await fetch(`${handle.baseUrl}/api/v1/readyz`);
      const unauthorized = await fetch(`${handle.baseUrl}/api/v1/__ts-backend/protected-ping`);

      expect(ready.status).toBe(200);
      expect(handle.token).toBeTruthy();
      expect(unauthorized.status).toBe(404);
    } finally {
      await handle.stop();
    }
  });
});
