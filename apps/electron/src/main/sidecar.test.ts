import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { describe, expect, spyOn, test } from "bun:test";

import {
  createPackagedSidecarCommand,
  createRustSidecarCommand,
  createSidecarEnvironment,
  startRustSidecar,
  toPublicSidecarStatus,
} from "./sidecar";

const legacyPaths = {
  dataRoot: "/Users/alex/Library/Application Support/com.teymz.wealthfolio",
  dbPath: "/Users/alex/Library/Application Support/com.teymz.wealthfolio/app.db",
  logRoot: "/Users/alex/Library/Logs/com.teymz.wealthfolio",
};

function bunEval(source: string): { command: string; args: string[] } {
  return {
    command: process.execPath,
    args: ["-e", source],
  };
}

describe("Electron sidecar configuration", () => {
  test("keeps sidecar token and base URL out of public runtime status", () => {
    const publicStatus = toPublicSidecarStatus({
      ready: false,
      error:
        "Timed out waiting for Electron sidecar at http://127.0.0.1:18444 with token=sidecar-token",
    });

    expect(publicStatus).toEqual({
      ready: false,
      error: "Timed out waiting for Electron sidecar at [sidecar] with token=[redacted]",
    });
    expect("baseUrl" in publicStatus).toBe(false);
    expect("token" in publicStatus).toBe(false);
    expect(publicStatus.error).not.toContain("127.0.0.1");
    expect(publicStatus.error).not.toContain("sidecar-token");
  });

  test("uses the legacy Tauri data root and durable keyring secret backend", () => {
    const previousSecretFile = process.env.WF_SECRET_FILE;
    process.env.WF_SECRET_FILE = "/tmp/wealthfolio-sidecar-secrets.json";
    try {
      const env = createSidecarEnvironment({
        legacyPaths,
        listenAddr: "127.0.0.1:12000",
        token: "sidecar-token",
        secretKey: "secret-key",
      });

      expect(env.WF_LISTEN_ADDR).toBe("127.0.0.1:12000");
      expect(env.WF_DB_PATH).toBe(
        "/Users/alex/Library/Application Support/com.teymz.wealthfolio/app.db",
      );
      expect(env.WF_ADDONS_DIR).toBe(
        "/Users/alex/Library/Application Support/com.teymz.wealthfolio",
      );
      expect(env.WF_SECRET_BACKEND).toBe("keyring");
      expect(env.WF_SECRET_FILE).toBeUndefined();
      expect(env.WF_SIDECAR_TOKEN).toBe("sidecar-token");
    } finally {
      if (previousSecretFile === undefined) {
        delete process.env.WF_SECRET_FILE;
      } else {
        process.env.WF_SECRET_FILE = previousSecretFile;
      }
    }
  });

  test("starts the development sidecar with the keyring backend feature", () => {
    const command = createRustSidecarCommand("/repo");

    expect(command.command).toBe("cargo");
    expect(command.args).toContain("keyring-backend");
    expect(command.args).toContain(path.join("/repo", "apps/server/Cargo.toml"));
  });

  test("resolves the packaged sidecar from Electron resources", () => {
    const tempRoot = mkdtempSync(
      path.join(tmpdir(), "wealthfolio-electron-sidecar-resource-test-"),
    );
    const sidecarDir = path.join(tempRoot, "sidecars");
    const sidecarPath = path.join(
      sidecarDir,
      process.platform === "win32" ? "wealthfolio-server.exe" : "wealthfolio-server",
    );
    mkdirSync(sidecarDir, { recursive: true });
    writeFileSync(sidecarPath, "");

    try {
      const command = createPackagedSidecarCommand(tempRoot);

      expect(command).toEqual({ command: sidecarPath, args: [] });
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });

  test("reports missing packaged sidecar binaries explicitly", () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "wealthfolio-electron-sidecar-missing-test-"));

    try {
      expect(() => createPackagedSidecarCommand(tempRoot)).toThrow(
        /Electron sidecar binary is not bundled/,
      );
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });

  test("starts and stops with keyring-backed sidecar environment", async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "wealthfolio-electron-sidecar-test-"));
    const envCapture = path.join(tempRoot, "sidecar-env.json");
    process.env.WF_SIDECAR_TEST_ENV_CAPTURE = envCapture;

    try {
      const handle = await startRustSidecar({
        legacyPaths,
        repositoryRoot: process.cwd(),
        packaged: false,
        resourcesPath: tempRoot,
        timeoutMs: 5_000,
        command: bunEval(`
          const fs = require("node:fs");
          const http = require("node:http");
          const [host, port] = process.env.WF_LISTEN_ADDR.split(":");
          fs.writeFileSync(process.env.WF_SIDECAR_TEST_ENV_CAPTURE, JSON.stringify({
            backend: process.env.WF_SECRET_BACKEND,
            secretFile: process.env.WF_SECRET_FILE ?? null,
            hasSecretKey: Boolean(process.env.WF_SECRET_KEY),
          }));
          const server = http.createServer((request, response) => {
            if (request.url === "/api/v1/readyz") {
              response.writeHead(200);
              response.end("ok");
              return;
            }
            response.writeHead(404);
            response.end();
          });
          server.listen(Number(port), host);
          process.on("SIGTERM", () => server.close(() => process.exit(0)));
          setInterval(() => {}, 1000);
        `),
      });
      const exitEvents: unknown[] = [];
      handle.onExit((event) => exitEvents.push(event));
      const capturedEnv = JSON.parse(readFileSync(envCapture, "utf8"));

      expect(capturedEnv).toEqual({
        backend: "keyring",
        secretFile: null,
        hasSecretKey: true,
      });
      await handle.stop();
      expect(exitEvents).toEqual([{ code: 0, signal: null, expected: true }]);
    } finally {
      delete process.env.WF_SIDECAR_TEST_ENV_CAPTURE;
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });

  test("fails fast when the sidecar exits before readiness", async () => {
    const startedAt = Date.now();

    await expect(
      startRustSidecar({
        legacyPaths,
        repositoryRoot: process.cwd(),
        packaged: false,
        resourcesPath: tmpdir(),
        timeoutMs: 10_000,
        command: bunEval("process.exit(7);"),
      }),
    ).rejects.toThrow(/exited before readiness \(code 7\)/);

    expect(Date.now() - startedAt).toBeLessThan(3_000);
  });

  test("cancels startup and stops the sidecar when Electron quits before readiness", async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "wealthfolio-electron-sidecar-abort-test-"));
    const envCapture = path.join(tempRoot, "sidecar-env.json");
    process.env.WF_SIDECAR_TEST_ENV_CAPTURE = envCapture;
    const controller = new AbortController();

    try {
      const startPromise = startRustSidecar({
        legacyPaths,
        repositoryRoot: process.cwd(),
        packaged: false,
        resourcesPath: tempRoot,
        timeoutMs: 10_000,
        signal: controller.signal,
        command: bunEval(`
          const fs = require("node:fs");
          fs.writeFileSync(process.env.WF_SIDECAR_TEST_ENV_CAPTURE, JSON.stringify({
            backend: process.env.WF_SECRET_BACKEND,
            secretFile: process.env.WF_SECRET_FILE ?? null,
          }));
          process.on("SIGTERM", () => process.exit(0));
          setInterval(() => {}, 1000);
        `),
      });

      for (let attempt = 0; attempt < 20 && !existsSync(envCapture); attempt += 1) {
        await delay(25);
      }
      const capturedEnv = JSON.parse(readFileSync(envCapture, "utf8"));
      expect(capturedEnv).toEqual({ backend: "keyring", secretFile: null });

      controller.abort();
      await expect(startPromise).rejects.toThrow(/startup was cancelled/);
    } finally {
      delete process.env.WF_SIDECAR_TEST_ENV_CAPTURE;
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });

  test("reports process spawn failures without waiting for readiness timeout", async () => {
    const startedAt = Date.now();
    const consoleError = spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(
        startRustSidecar({
          legacyPaths,
          repositoryRoot: process.cwd(),
          packaged: false,
          resourcesPath: tmpdir(),
          timeoutMs: 10_000,
          command: {
            command: "wealthfolio-missing-sidecar-command",
            args: [],
          },
        }),
      ).rejects.toThrow(/Failed to start Electron sidecar/);

      expect(Date.now() - startedAt).toBeLessThan(3_000);
    } finally {
      consoleError.mockRestore();
    }
  });
});
