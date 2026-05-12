import { BrowserWindow, shell, type BrowserWindowConstructorOptions } from "electron";
import { pathToFileURL } from "node:url";

interface CreateMainWindowOptions {
  preloadPath: string;
  rendererUrl?: string;
  indexHtmlPath: string;
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
}: CreateMainWindowOptions): Promise<BrowserWindow> {
  const windowOptions: BrowserWindowConstructorOptions = {
    width: 1440,
    height: 960,
    title: "Wealthfolio",
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

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      void shell.openExternal(url).catch((error) => {
        console.error("Failed to open external URL:", error);
      });
    }
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
