import { app, BrowserWindow, ipcMain, session } from "electron";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { IPC_CHANNELS, type RuntimeInfo } from "../shared/ipc";
import { resolveLegacyTauriPaths } from "./data-root";
import { createMainWindow } from "./window";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(currentDir, "..");
const packageRoot = path.resolve(currentDir, "../..");
const repositoryRoot = path.resolve(packageRoot, "../..");

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
    };
  });
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

async function start(): Promise<void> {
  configureAppPaths();

  await app.whenReady();
  configureSecurityHeaders();
  registerIpcHandlers();
  await createWindow();

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
