import path from "node:path";

import { describe, expect, test } from "bun:test";

import { resolveElectronBackendRuntimeKind, startElectronBackendRuntime } from "./backend-runtime";
import { createTsBackendCommand, startTsBackendSidecar } from "./sidecar";

const legacyPaths = {
  dataRoot: "/tmp/wealthfolio",
  dbPath: "/tmp/wealthfolio/app.db",
  logRoot: "/tmp/wealthfolio/logs",
};
const repositoryRoot = path.resolve(import.meta.dir, "../../../..");

describe("Electron backend runtime selector", () => {
  test("defaults to the TypeScript backend unless Rust sidecar is explicitly selected", () => {
    expect(resolveElectronBackendRuntimeKind({})).toBe("ts");
    expect(resolveElectronBackendRuntimeKind({}, "rust")).toBe("rust");
    expect(resolveElectronBackendRuntimeKind({ WF_BACKEND_RUNTIME: "rust-sidecar" })).toBe("rust");
    expect(resolveElectronBackendRuntimeKind({ WF_BACKEND_RUNTIME: "ts" })).toBe("ts");
    expect(resolveElectronBackendRuntimeKind({ WF_BACKEND_RUNTIME: "bun" })).toBe("ts");
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

  test("guards packaged builds from selecting the unbundled TS backend runtime", async () => {
    await expect(
      startTsBackendSidecar({
        legacyPaths,
        repositoryRoot: "/repo",
        packaged: true,
        resourcesPath: "/resources",
      }),
    ).rejects.toThrow("The TypeScript backend runtime is not packaged yet");
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
