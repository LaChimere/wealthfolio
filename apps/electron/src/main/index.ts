import { app, BrowserWindow, ipcMain, session } from "electron";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { IPC_CHANNELS, type ElectronInvokeRequest, type RuntimeInfo } from "../shared/ipc";
import { invokeSidecarCommand } from "./commands";
import { resolveLegacyTauriPaths } from "./data-root";
import { validateElectronInvokeRequest } from "./ipc-validation";
import { startRustSidecar, toPublicSidecarStatus, type SidecarHandle } from "./sidecar";
import { createMainWindow } from "./window";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(currentDir, "..");
const packageRoot = path.resolve(currentDir, "../..");
const repositoryRoot = path.resolve(packageRoot, "../..");
let sidecarStatus = toPublicSidecarStatus({ ready: false });
let sidecarHandle: SidecarHandle | null = null;
let sidecarStopInProgress = false;
let sidecarStartController: AbortController | null = null;
let sidecarStartPromise: Promise<void> | null = null;

function configureAppPaths(): void {
  const legacyPaths = resolveLegacyTauriPaths();
  mkdirSync(legacyPaths.logRoot, { recursive: true });
  app.setPath("logs", legacyPaths.logRoot);
}

function configureSecurityHeaders(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const connectSources = app.isPackaged
      ? "'self'"
      : "'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*";
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          [
            "default-src 'self'",
            app.isPackaged
              ? "script-src 'self'"
              : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            `connect-src ${connectSources}`,
            "font-src 'self' data:",
            "object-src 'none'",
            "base-uri 'self'",
          ].join("; "),
        ],
      },
    });
  });
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.getRuntimeInfo, (): RuntimeInfo => {
    return {
      platform: process.platform,
      appVersion: app.getVersion(),
      isPackaged: app.isPackaged,
      sidecar: sidecarStatus,
    };
  });
  ipcMain.handle(
    IPC_CHANNELS.invoke,
    async (_event, request: ElectronInvokeRequest): Promise<unknown> => {
      const validatedRequest = validateElectronInvokeRequest(request);
      const sidecar = await getReadySidecarHandle();
      return await invokeSidecarCommand({
        command: validatedRequest.command,
        payload: validatedRequest.payload,
        sidecar,
      });
    },
  );
}

function handleFatal(error: unknown): void {
  console.error("Electron startup failed:", error);
  app.quit();
}

async function createWindow(): Promise<void> {
  const preloadPath = path.join(distRoot, "preload", "index.cjs");
  const rendererUrl = process.env.WF_ELECTRON_RENDERER_URL;
  const indexHtmlPath = path.join(repositoryRoot, "dist", "index.html");
  await createMainWindow({ preloadPath, rendererUrl, indexHtmlPath });
}

async function startSidecarBridge(): Promise<void> {
  const legacyPaths = resolveLegacyTauriPaths();
  const controller = new AbortController();
  sidecarStartController = controller;
  try {
    sidecarHandle = await startRustSidecar({
      legacyPaths,
      repositoryRoot,
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      signal: controller.signal,
    });
    const handle = sidecarHandle;
    handle.onExit((event) => {
      if (event.expected) {
        return;
      }
      if (sidecarHandle === handle) {
        sidecarHandle = null;
      }
      const exitReason =
        event.error ?? `process exited with ${event.signal ?? event.code ?? "unknown status"}`;
      sidecarStatus = toPublicSidecarStatus({
        ready: false,
        error: `Electron sidecar stopped unexpectedly: ${exitReason}`,
      });
      console.error("Electron sidecar stopped unexpectedly:", event);
    });
    sidecarStatus = toPublicSidecarStatus({ ready: true });
  } catch (error) {
    if (controller.signal.aborted) {
      return;
    }
    sidecarStatus = toPublicSidecarStatus({
      ready: false,
      error: error instanceof Error ? error.message : String(error),
    });
    console.error("Electron sidecar startup failed:", error);
  } finally {
    if (sidecarStartController === controller) {
      sidecarStartController = null;
    }
  }
}

async function stopSidecarBridge(): Promise<void> {
  sidecarStartController?.abort();
  await sidecarStartPromise;
  if (!sidecarHandle) {
    return;
  }

  const handle = sidecarHandle;
  sidecarHandle = null;
  sidecarStatus = toPublicSidecarStatus({ ready: false });
  await handle.stop();
}

async function getReadySidecarHandle(): Promise<SidecarHandle> {
  await sidecarStartPromise;
  if (!sidecarHandle || !sidecarStatus.ready) {
    const reason = sidecarStatus.error ? `: ${sidecarStatus.error}` : "";
    throw new Error(`Electron sidecar is not ready${reason}`);
  }
  return sidecarHandle;
}

async function start(): Promise<void> {
  configureAppPaths();

  await app.whenReady();
  configureSecurityHeaders();
  registerIpcHandlers();
  await createWindow();
  sidecarStartPromise = startSidecarBridge().finally(() => {
    sidecarStartPromise = null;
  });
  void sidecarStartPromise;

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow().catch(handleFatal);
    }
  });
}

void start().catch(handleFatal);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if ((!sidecarHandle && !sidecarStartPromise) || sidecarStopInProgress) {
    return;
  }

  event.preventDefault();
  sidecarStopInProgress = true;
  void stopSidecarBridge()
    .catch((error) => console.error("Electron sidecar shutdown failed:", error))
    .finally(() => {
      sidecarStopInProgress = false;
      app.quit();
    });
});
