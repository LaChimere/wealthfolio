import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, session, shell } from "electron";
import type { WebContents } from "electron";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  IPC_CHANNELS,
  type ElectronEventMessage,
  type ElectronInvokeRequest,
  type ElectronLogLevel,
  type RuntimeInfo,
} from "../shared/ipc";
import { createAiChatStreamManager } from "./ai-chat-stream-manager";
import { invokeSidecarCommand } from "./commands";
import { resolveLegacyTauriPaths } from "./data-root";
import {
  createSanitizedDeepLinkDescription,
  DEEP_LINK_SCHEME,
  findDeepLinkUrls,
  getProtocolClientRegistration,
  isDeepLinkUrl,
} from "./deep-links";
import { startSidecarEventBridge, type SidecarEventBridgeHandle } from "./events";
import { validateFileDropEventMessage } from "./file-drop";
import { validateElectronInvokeRequest } from "./ipc-validation";
import { createElectronLogWriter, type ElectronLogWriter, validateLogMessage } from "./logging";
import { installApplicationMenu } from "./menu";
import { registerNativeIpcHandlers } from "./native";
import { startRustSidecar, toPublicSidecarStatus, type SidecarHandle } from "./sidecar";
import { createMainWindow } from "./window";
import { createWindowStatePersistence } from "./window-state";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(currentDir, "..");
const packageRoot = path.resolve(currentDir, "../..");
const repositoryRoot = path.resolve(packageRoot, "../..");
let sidecarStatus = toPublicSidecarStatus({ ready: false });
let sidecarHandle: SidecarHandle | null = null;
let sidecarStopInProgress = false;
let sidecarStartController: AbortController | null = null;
let sidecarStartPromise: Promise<void> | null = null;
let sidecarEventBridge: SidecarEventBridgeHandle | null = null;
let electronLogWriter: ElectronLogWriter | null = null;
let nextRendererEventId = 0;
const pendingDeepLinkUrls: string[] = [];
const deepLinkListenerWebContentsIds = new Set<number>();
const deepLinkListenerCleanupWebContentsIds = new Set<number>();
const aiChatStreamManager = createAiChatStreamManager({ getSidecar: getReadySidecarHandle });

function configureAppPaths(): void {
  const legacyPaths = resolveLegacyTauriPaths();
  mkdirSync(legacyPaths.dataRoot, { recursive: true });
  mkdirSync(legacyPaths.logRoot, { recursive: true });
  app.setPath("logs", legacyPaths.logRoot);
  electronLogWriter = createElectronLogWriter(
    path.join(legacyPaths.logRoot, "wealthfolio-electron.log"),
  );
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
  ipcMain.handle(IPC_CHANNELS.startAiChatStream, async (event, request: unknown): Promise<void> => {
    await aiChatStreamManager.start(event.sender, request);
  });
  ipcMain.handle(IPC_CHANNELS.cancelAiChatStream, (_event, request: unknown): void => {
    aiChatStreamManager.cancel(request);
  });
  ipcMain.handle(IPC_CHANNELS.writeLog, async (_event, message: unknown): Promise<void> => {
    const { level, message: logMessage } = validateLogMessage(message);
    await writeElectronLog(level, logMessage);
  });
  ipcMain.handle(IPC_CHANNELS.startDeepLinkListener, (event): ElectronEventMessage<string>[] => {
    markDeepLinkListenerReady(event.sender);
    return drainPendingDeepLinkMessages();
  });
  ipcMain.handle(IPC_CHANNELS.stopDeepLinkListener, (event): void => {
    deepLinkListenerWebContentsIds.delete(event.sender.id);
  });
  ipcMain.on(IPC_CHANNELS.fileDropEvent, (event, message: unknown): void => {
    try {
      const fileDropEvent = validateFileDropEventMessage(message);
      if (!event.sender.isDestroyed()) {
        event.sender.send(
          IPC_CHANNELS.serverEvent,
          createRendererEventMessage(fileDropEvent.event, fileDropEvent.payload),
        );
      }
    } catch (error) {
      console.warn(
        "Rejected invalid Electron file-drop event:",
        error instanceof Error ? error.message : String(error),
      );
    }
  });
  registerNativeIpcHandlers({ ipcMain, dialog, shell, nativeTheme, getTargetWindow });
}

function handleFatal(error: unknown): void {
  console.error("Electron startup failed:", error);
  app.quit();
}

async function writeElectronLog(level: ElectronLogLevel, message: string): Promise<void> {
  if (!electronLogWriter) {
    throw new Error("Electron log writer is not configured.");
  }
  await electronLogWriter.write(level, message);
}

function recordElectronLog(level: ElectronLogLevel, message: string): void {
  void writeElectronLog(level, message).catch((error) => {
    console.warn("Failed to write Electron log:", error);
  });
}

function recordSidecarLog(level: "info" | "error", message: string): void {
  if (level === "error") {
    console.error(message);
  } else {
    console.info(message);
  }
  recordElectronLog(level, message);
}

function sendServerEventToWindows(message: ElectronEventMessage): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.webContents.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.serverEvent, message);
    }
  }
}

function sendRendererEvent(
  eventName: string,
  payload: unknown,
  targetWindow?: BrowserWindow | null,
): void {
  const message = createRendererEventMessage(eventName, payload);

  if (targetWindow && !targetWindow.webContents.isDestroyed()) {
    targetWindow.webContents.send(IPC_CHANNELS.serverEvent, message);
    return;
  }

  sendServerEventToWindows(message);
}

function createRendererEventMessage<T>(eventName: string, payload: T): ElectronEventMessage<T> {
  return {
    event: eventName,
    id: ++nextRendererEventId,
    payload,
  };
}

function getTargetWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
}

function markDeepLinkListenerReady(webContents: WebContents): void {
  deepLinkListenerWebContentsIds.add(webContents.id);
  if (deepLinkListenerCleanupWebContentsIds.has(webContents.id)) {
    return;
  }

  deepLinkListenerCleanupWebContentsIds.add(webContents.id);
  webContents.once("destroyed", () => {
    deepLinkListenerWebContentsIds.delete(webContents.id);
    deepLinkListenerCleanupWebContentsIds.delete(webContents.id);
  });
}

function drainPendingDeepLinkMessages(): ElectronEventMessage<string>[] {
  return pendingDeepLinkUrls
    .splice(0, pendingDeepLinkUrls.length)
    .map((url) => createRendererEventMessage("deep-link-received", url));
}

function focusTargetWindow(targetWindow: BrowserWindow | null = getTargetWindow()): void {
  if (!targetWindow || targetWindow.isDestroyed()) {
    return;
  }

  if (targetWindow.isMinimized()) {
    targetWindow.restore();
  }
  targetWindow.focus();
}

function dispatchDeepLink(url: string): void {
  if (!isDeepLinkUrl(url)) {
    return;
  }

  const targetWindow = getTargetWindow();
  focusTargetWindow(targetWindow);
  if (
    targetWindow &&
    !targetWindow.webContents.isDestroyed() &&
    deepLinkListenerWebContentsIds.has(targetWindow.webContents.id)
  ) {
    sendRendererEvent("deep-link-received", url, targetWindow);
    return;
  }

  pendingDeepLinkUrls.push(url);
  console.info(
    "Queued deep link until renderer listener is ready:",
    createSanitizedDeepLinkDescription(url),
  );
}

function configureDeepLinkProtocolClient(): void {
  const electronProcess = process as NodeJS.Process & { defaultApp?: boolean };
  const registration = getProtocolClientRegistration(
    Boolean(electronProcess.defaultApp),
    process.platform,
    process.argv,
    process.execPath,
  );
  if (!registration) {
    return;
  }

  const registered = registration.executablePath
    ? app.setAsDefaultProtocolClient(
        DEEP_LINK_SCHEME,
        registration.executablePath,
        registration.args ?? [],
      )
    : app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
  if (!registered) {
    console.warn(`Failed to register ${DEEP_LINK_SCHEME} protocol handler.`);
  }
}

function registerDeepLinkProcessHandlers(): void {
  if (process.platform !== "darwin") {
    for (const url of findDeepLinkUrls(process.argv)) {
      dispatchDeepLink(url);
    }
  }

  app.on("will-finish-launching", () => {
    app.on("open-url", (event, url) => {
      event.preventDefault();
      dispatchDeepLink(url);
    });
  });

  app.on("second-instance", (_event, argv) => {
    const urls = findDeepLinkUrls(argv);
    if (urls.length === 0) {
      focusTargetWindow();
      return;
    }

    for (const url of urls) {
      dispatchDeepLink(url);
    }
  });
}

function configureApplicationMenu(): void {
  installApplicationMenu({
    appName: app.getName() || "Wealthfolio",
    appVersion: app.getVersion(),
    menu: Menu,
    getTargetWindow,
    async showMessageBox(options, parent) {
      if (parent && !parent.isDestroyed()) {
        await dialog.showMessageBox(parent, options);
        return;
      }
      await dialog.showMessageBox(options);
    },
    async checkForUpdates() {
      const sidecar = await getReadySidecarHandle();
      return await invokeSidecarCommand({
        command: "check_for_updates",
        payload: { force: true },
        sidecar,
      });
    },
    sendRendererEvent,
  });
}

function configureWindowThemeEvents(): void {
  nativeTheme.on("updated", () => {
    sendRendererEvent("window:theme-changed", nativeTheme.shouldUseDarkColors ? "dark" : "light");
  });
}

function resolveRendererIndexHtmlPath(): string {
  if (app.isPackaged) {
    return path.join(app.getAppPath(), "dist", "renderer", "index.html");
  }

  return path.join(repositoryRoot, "dist", "index.html");
}

async function createWindow(): Promise<void> {
  const legacyPaths = resolveLegacyTauriPaths();
  const preloadPath = path.join(distRoot, "preload", "index.cjs");
  const rendererUrl = process.env.WF_ELECTRON_RENDERER_URL;
  const indexHtmlPath = resolveRendererIndexHtmlPath();
  await createMainWindow({
    preloadPath,
    rendererUrl,
    indexHtmlPath,
    windowState: createWindowStatePersistence(
      path.join(legacyPaths.dataRoot, "electron-window-state.json"),
    ),
  });
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
      log: recordSidecarLog,
    });
    const handle = sidecarHandle;
    sidecarEventBridge?.stop();
    sidecarEventBridge = startSidecarEventBridge({
      sidecar: handle,
      send: sendServerEventToWindows,
    });
    handle.onExit((event) => {
      if (event.expected) {
        return;
      }
      sidecarEventBridge?.stop();
      sidecarEventBridge = null;
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
  aiChatStreamManager.cancelAll();
  sidecarEventBridge?.stop();
  sidecarEventBridge = null;
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
  configureWindowThemeEvents();
  configureApplicationMenu();
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

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  configureDeepLinkProtocolClient();
  registerDeepLinkProcessHandlers();
  void start().catch(handleFatal);
}

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
