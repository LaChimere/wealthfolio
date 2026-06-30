import {
  BrowserWindow,
  screen,
  shell,
  type BrowserWindowConstructorOptions,
  type Rectangle,
} from "electron";
import { pathToFileURL } from "node:url";

import { openExternalUrl } from "./native";
import type { PersistedWindowState, WindowStatePersistence } from "./window-state";

interface CreateMainWindowOptions {
  preloadPath: string;
  rendererUrl?: string;
  indexHtmlPath: string;
  windowState?: WindowStatePersistence;
}

function isAllowedNavigation(
  url: string,
  rendererUrl: string | undefined,
  indexHtmlPath: string,
): boolean {
  if (!rendererUrl) {
    return url === pathToFileURL(indexHtmlPath).href;
  }

  return new URL(url).origin === new URL(rendererUrl).origin;
}

export async function createMainWindow({
  preloadPath,
  rendererUrl,
  indexHtmlPath,
  windowState,
}: CreateMainWindowOptions): Promise<BrowserWindow> {
  const savedWindowState = await loadWindowState(windowState);
  const windowOptions: BrowserWindowConstructorOptions = {
    ...createWindowBounds(savedWindowState),
    title: "Wealthfolio",
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 16, y: 16 },
        }
      : {}),
    show: false,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  };
  const mainWindow = new BrowserWindow(windowOptions);
  if (savedWindowState?.maximized) {
    mainWindow.maximize();
  }
  registerWindowStatePersistence(mainWindow, windowState);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalUrl(url, shell).catch((error) => {
      console.error("Failed to open external URL:", error);
    });
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedNavigation(url, rendererUrl, indexHtmlPath)) {
      event.preventDefault();
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  if (rendererUrl) {
    await mainWindow.loadURL(rendererUrl);
  } else {
    await mainWindow.loadFile(indexHtmlPath);
  }

  return mainWindow;
}

function createWindowBounds(
  state: PersistedWindowState | null,
): Pick<BrowserWindowConstructorOptions, "height" | "width" | "x" | "y"> {
  return {
    height: state?.height ?? 960,
    width: state?.width ?? 1440,
    ...(state && isWindowStateVisible(state) ? { x: state.x, y: state.y } : {}),
  };
}

function isWindowStateVisible(
  state: PersistedWindowState,
): state is PersistedWindowState & Required<Pick<PersistedWindowState, "x" | "y">> {
  if (typeof state.x !== "number" || typeof state.y !== "number") {
    return false;
  }

  const windowBounds = {
    height: state.height,
    width: state.width,
    x: state.x,
    y: state.y,
  };
  return screen
    .getAllDisplays()
    .some((display) => rectanglesIntersect(display.workArea, windowBounds));
}

function rectanglesIntersect(a: Rectangle, b: Rectangle): boolean {
  const horizontalOverlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const verticalOverlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return horizontalOverlap > 0 && verticalOverlap > 0;
}

async function loadWindowState(
  windowState: WindowStatePersistence | undefined,
): Promise<PersistedWindowState | null> {
  if (!windowState) {
    return null;
  }

  try {
    return await windowState.load();
  } catch (error) {
    console.warn("Failed to load Electron window state:", error);
    return null;
  }
}

function registerWindowStatePersistence(
  mainWindow: BrowserWindow,
  windowState: WindowStatePersistence | undefined,
): void {
  if (!windowState) {
    return;
  }

  let saveTimer: NodeJS.Timeout | null = null;
  const getState = (): PersistedWindowState | null => {
    if (mainWindow.isDestroyed()) {
      return null;
    }

    const bounds = mainWindow.getNormalBounds();
    return {
      height: bounds.height,
      maximized: mainWindow.isMaximized(),
      width: bounds.width,
      x: bounds.x,
      y: bounds.y,
    };
  };
  const save = () => {
    const state = getState();
    if (!state) {
      return;
    }
    void windowState.save(state).catch((error) => {
      console.warn("Failed to save Electron window state:", error);
    });
  };
  const scheduleSave = () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(save, 500);
  };

  mainWindow.on("move", scheduleSave);
  mainWindow.on("resize", scheduleSave);
  mainWindow.on("maximize", scheduleSave);
  mainWindow.on("unmaximize", scheduleSave);
  mainWindow.on("close", () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
    }
    const state = getState();
    if (!state) {
      return;
    }
    try {
      windowState.saveSync(state);
    } catch (error) {
      console.warn("Failed to save Electron window state:", error);
    }
  });
}
