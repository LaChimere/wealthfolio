import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type { SidecarRuntimeStatus } from "../shared/ipc";
import type { LegacyTauriPaths } from "./data-root";

export interface SidecarHandle {
  pid: number | undefined;
  baseUrl: string;
  token: string;
  stop(): Promise<void>;
  onExit(listener: (event: SidecarExitEvent) => void): () => void;
}

export interface SidecarExitEvent {
  code: number | null;
  signal: NodeJS.Signals | null;
  expected: boolean;
  error?: string;
}

export interface SidecarCommand {
  command: string;
  args: string[];
}

export interface StartSidecarOptions {
  legacyPaths: LegacyTauriPaths;
  repositoryRoot: string;
  packaged: boolean;
  resourcesPath: string;
  timeoutMs?: number;
  command?: SidecarCommand;
  signal?: AbortSignal;
  log?: (level: "info" | "error", message: string) => void;
}

interface SidecarEnvironmentOptions {
  legacyPaths: LegacyTauriPaths;
  listenAddr: string;
  token: string;
  secretKey: string;
}

export function toPublicSidecarStatus(status: SidecarRuntimeStatus): SidecarRuntimeStatus {
  return status.error
    ? { ready: status.ready, error: sanitizeSidecarError(status.error) }
    : { ready: status.ready };
}

export function sanitizeSidecarError(error: string): string {
  return error
    .replace(/https?:\/\/(?:127\.0\.0\.1|localhost):\d+/gi, "[sidecar]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[redacted]")
    .replace(/(token=)[^&\s]+/gi, "$1[redacted]");
}

export function createSidecarEnvironment({
  legacyPaths,
  listenAddr,
  token,
  secretKey,
}: SidecarEnvironmentOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    WF_ADDONS_DIR: legacyPaths.dataRoot,
    WF_AUTH_REQUIRED: "false",
    WF_CORS_ALLOW_ORIGINS: "http://localhost:1420,http://127.0.0.1:1420",
    WF_DB_PATH: legacyPaths.dbPath,
    WF_LISTEN_ADDR: listenAddr,
    WF_SECRET_BACKEND: "keyring",
    WF_SECRET_KEY: secretKey,
    WF_SIDECAR_TOKEN: token,
  };
  delete env.WF_SECRET_FILE;
  if (legacyPaths.secretNamespace) {
    env.WF_SECRET_NAMESPACE = legacyPaths.secretNamespace;
  } else {
    delete env.WF_SECRET_NAMESPACE;
  }
  return env;
}

export function createRustSidecarCommand(repositoryRoot: string): SidecarCommand {
  return {
    command: "cargo",
    args: [
      "run",
      "--quiet",
      "--manifest-path",
      path.join(repositoryRoot, "apps/server/Cargo.toml"),
      "--features",
      "keyring-backend",
    ],
  };
}

export function createPackagedSidecarCommand(
  resourcesPath: string,
  platform: NodeJS.Platform = process.platform,
): SidecarCommand {
  const binaryName = platform === "win32" ? "wealthfolio-server.exe" : "wealthfolio-server";
  const command = path.join(resourcesPath, "sidecars", binaryName);
  if (!existsSync(command)) {
    throw new Error(`Electron sidecar binary is not bundled at ${command}.`);
  }
  return { command, args: [] };
}

export async function startRustSidecar(options: StartSidecarOptions): Promise<SidecarHandle> {
  assertNotAborted(options.signal);

  const port = await findAvailablePort();
  const listenAddr = `127.0.0.1:${port}`;
  const baseUrl = `http://${listenAddr}`;
  const token = randomBytes(32).toString("base64url");
  const secretKey = randomBytes(32).toString("base64");
  const env = createSidecarEnvironment({
    legacyPaths: options.legacyPaths,
    listenAddr,
    token,
    secretKey,
  });

  const sidecarCommand =
    options.command ??
    (options.packaged
      ? createPackagedSidecarCommand(options.resourcesPath)
      : createRustSidecarCommand(options.repositoryRoot));

  const child = spawn(sidecarCommand.command, sidecarCommand.args, {
    cwd: options.packaged ? path.dirname(sidecarCommand.command) : options.repositoryRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) =>
    recordSidecarLog(options, "info", `[sidecar] ${String(chunk).trimEnd()}`),
  );
  child.stderr.on("data", (chunk) =>
    recordSidecarLog(options, "error", `[sidecar] ${String(chunk).trimEnd()}`),
  );
  child.on("error", (error) =>
    recordSidecarLog(options, "error", `Electron sidecar process error: ${error.message}`),
  );

  const abort = watchAbort(options.signal);
  try {
    await Promise.race([waitForReady(baseUrl, options.timeoutMs ?? 120_000, child), abort.promise]);
  } catch (error) {
    await stopChild(child);
    throw error;
  } finally {
    abort.dispose();
  }

  const exitListeners = new Set<(event: SidecarExitEvent) => void>();
  let stopping = false;
  let exitNotified = false;
  const notifyExit = (event: SidecarExitEvent) => {
    if (exitNotified) {
      return;
    }
    exitNotified = true;
    for (const listener of exitListeners) {
      listener(event);
    }
  };

  child.once("exit", (code, signal) => {
    notifyExit({ code, signal, expected: stopping });
  });
  child.once("error", (error) => {
    notifyExit({
      code: null,
      signal: null,
      expected: stopping,
      error: error.message,
    });
  });

  return {
    pid: child.pid,
    baseUrl,
    token,
    async stop() {
      stopping = true;
      await stopChild(child);
    },
    onExit(listener) {
      exitListeners.add(listener);
      return () => exitListeners.delete(listener);
    },
  };
}

function recordSidecarLog(
  options: StartSidecarOptions,
  level: "info" | "error",
  message: string,
): void {
  if (options.log) {
    options.log(level, message);
    return;
  }

  if (level === "error") {
    console.error(message);
  } else {
    console.info(message);
  }
}

async function waitForReady(
  baseUrl: string,
  timeoutMs: number,
  child: ChildProcess,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  const childFailure = watchChildFailure(child);
  try {
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${baseUrl}/api/v1/readyz`);
        if (response.ok) {
          return;
        }
        lastError = new Error(`readyz returned ${response.status}`);
      } catch (error) {
        lastError = error;
      }
      await Promise.race([delay(500), childFailure.promise]);
    }
  } finally {
    childFailure.dispose();
  }

  throw new Error(
    `Timed out waiting for Electron sidecar at ${baseUrl}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

async function findAvailablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
        } else {
          reject(new Error("Failed to resolve an available sidecar port."));
        }
      });
    });
  });
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error("Electron sidecar startup was cancelled.");
  }
}

function watchAbort(signal: AbortSignal | undefined): { promise: Promise<never>; dispose(): void } {
  if (!signal) {
    return {
      promise: new Promise<never>(() => {}),
      dispose() {},
    };
  }
  if (signal.aborted) {
    return {
      promise: Promise.reject(new Error("Electron sidecar startup was cancelled.")),
      dispose() {},
    };
  }

  let onAbort!: () => void;
  const promise = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Error("Electron sidecar startup was cancelled."));
    signal.addEventListener("abort", onAbort, { once: true });
  });

  return {
    promise,
    dispose() {
      signal.removeEventListener("abort", onAbort);
    },
  };
}

function watchChildFailure(child: ChildProcess): { promise: Promise<never>; dispose(): void } {
  let onExit!: (code: number | null, signal: NodeJS.Signals | null) => void;
  let onError!: (error: Error) => void;
  const promise = new Promise<never>((_resolve, reject) => {
    onExit = (code, signal) => {
      reject(new Error(`Electron sidecar exited before readiness (${formatExit(code, signal)}).`));
    };
    onError = (error) => {
      reject(new Error(`Failed to start Electron sidecar: ${error.message}`));
    };
    child.once("exit", onExit);
    child.once("error", onError);
  });
  void promise.catch(() => undefined);

  return {
    promise,
    dispose() {
      child.off("exit", onExit);
      child.off("error", onError);
    },
  };
}

function formatExit(code: number | null, signal: NodeJS.Signals | null): string {
  if (code !== null) {
    return `code ${code}`;
  }
  if (signal !== null) {
    return `signal ${signal}`;
  }
  return "unknown exit status";
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  if (!child.pid) {
    return;
  }

  if (!sendSignal(child, "SIGTERM")) {
    return;
  }
  const exited = await Promise.race([
    new Promise<boolean>((resolve) => child.once("exit", () => resolve(true))),
    delay(2_000).then(() => false),
  ]);

  if (!exited && child.exitCode === null && child.signalCode === null) {
    if (!sendSignal(child, "SIGKILL")) {
      return;
    }
    const killed = await Promise.race([
      new Promise<boolean>((resolve) => child.once("exit", () => resolve(true))),
      delay(500).then(() => false),
    ]);
    if (!killed && child.exitCode === null && child.signalCode === null) {
      console.warn(`Electron sidecar process ${child.pid} did not exit after SIGKILL.`);
    }
  }
}

function sendSignal(child: ChildProcess, signal: NodeJS.Signals): boolean {
  try {
    return child.kill(signal);
  } catch (error) {
    console.warn(`Failed to send ${signal} to Electron sidecar process ${child.pid}:`, error);
    return false;
  }
}
