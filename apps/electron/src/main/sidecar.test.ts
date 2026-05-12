import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { describe, expect, spyOn, test } from "bun:test";

import { createSidecarEnvironment, startRustSidecar, toPublicSidecarStatus } from "./sidecar";

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
      ready: true,
      error: undefined,
    });

    expect(publicStatus).toEqual({ ready: true });
    expect("baseUrl" in publicStatus).toBe(false);
    expect("token" in publicStatus).toBe(false);
  });

  test("uses the legacy Tauri data root and an isolated temporary secret file", () => {
    const env = createSidecarEnvironment({
      legacyPaths,
      listenAddr: "127.0.0.1:12000",
      token: "sidecar-token",
      secretKey: "secret-key",
      secretFile: "/tmp/wealthfolio-sidecar-secrets.json",
    });

    expect(env.WF_LISTEN_ADDR).toBe("127.0.0.1:12000");
    expect(env.WF_DB_PATH).toBe(
      "/Users/alex/Library/Application Support/com.teymz.wealthfolio/app.db",
    );
    expect(env.WF_ADDONS_DIR).toBe("/Users/alex/Library/Application Support/com.teymz.wealthfolio");
    expect(env.WF_SECRET_FILE).toBe("/tmp/wealthfolio-sidecar-secrets.json");
    expect(env.WF_SIDECAR_TOKEN).toBe("sidecar-token");
  });

  test("starts, stops, and removes the temporary secret file", async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "wealthfolio-electron-sidecar-test-"));
    const secretPathCapture = path.join(tempRoot, "secret-path.txt");
    process.env.WF_SIDECAR_TEST_SECRET_CAPTURE = secretPathCapture;

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
          fs.writeFileSync(process.env.WF_SIDECAR_TEST_SECRET_CAPTURE, process.env.WF_SECRET_FILE);
          fs.writeFileSync(process.env.WF_SECRET_FILE, JSON.stringify({ ok: true }));
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
      const secretFile = readFileSync(secretPathCapture, "utf8");

      expect(existsSync(secretFile)).toBe(true);
      await handle.stop();
      expect(existsSync(secretFile)).toBe(false);
      expect(exitEvents).toEqual([{ code: 0, signal: null, expected: true }]);
    } finally {
      delete process.env.WF_SIDECAR_TEST_SECRET_CAPTURE;
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

  test("cancels startup and cleans up when Electron quits before readiness", async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "wealthfolio-electron-sidecar-abort-test-"));
    const secretPathCapture = path.join(tempRoot, "secret-path.txt");
    process.env.WF_SIDECAR_TEST_SECRET_CAPTURE = secretPathCapture;
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
          fs.writeFileSync(process.env.WF_SIDECAR_TEST_SECRET_CAPTURE, process.env.WF_SECRET_FILE);
          fs.writeFileSync(process.env.WF_SECRET_FILE, JSON.stringify({ ok: true }));
          process.on("SIGTERM", () => process.exit(0));
          setInterval(() => {}, 1000);
        `),
      });

      for (let attempt = 0; attempt < 20 && !existsSync(secretPathCapture); attempt += 1) {
        await delay(25);
      }
      const secretFile = readFileSync(secretPathCapture, "utf8");

      controller.abort();
      await expect(startPromise).rejects.toThrow(/startup was cancelled/);
      expect(existsSync(secretFile)).toBe(false);
    } finally {
      delete process.env.WF_SIDECAR_TEST_SECRET_CAPTURE;
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
