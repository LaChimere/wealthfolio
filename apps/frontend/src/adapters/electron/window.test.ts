import { ELECTRON_API_KEY, type WealthfolioElectronApi } from "@wealthfolio/electron/shared/ipc";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getWindowTheme,
  listenWindowThemeChanged,
  setWindowTheme,
  toggleWindowFullscreen,
} from "./window";

function installElectronApi(api: Partial<WealthfolioElectronApi>) {
  window[ELECTRON_API_KEY] = {
    getRuntimeInfo: vi.fn(),
    getWindowTheme: vi.fn(),
    invoke: vi.fn(),
    listen: vi.fn(),
    openAddonPackageDialog: vi.fn(),
    openCsvFileDialog: vi.fn(),
    openDatabaseFileDialog: vi.fn(),
    openExternalUrl: vi.fn(),
    openFolderDialog: vi.fn(),
    saveFileDialog: vi.fn(),
    setWindowTheme: vi.fn(),
    startAiChatStream: vi.fn(),
    cancelAiChatStream: vi.fn(),
    toggleWindowFullscreen: vi.fn(),
    ...api,
  } as WealthfolioElectronApi;
}

afterEach(() => {
  delete window[ELECTRON_API_KEY];
});

describe("electron window adapter", () => {
  it("delegates theme and fullscreen operations through preload", async () => {
    const getTheme = vi.fn().mockResolvedValue("dark");
    const setTheme = vi.fn().mockResolvedValue(undefined);
    const toggleFullscreen = vi.fn().mockResolvedValue(undefined);
    installElectronApi({
      getWindowTheme: getTheme,
      setWindowTheme: setTheme,
      toggleWindowFullscreen: toggleFullscreen,
    });

    await expect(getWindowTheme()).resolves.toBe("dark");
    await setWindowTheme(null);
    await toggleWindowFullscreen();

    expect(getTheme).toHaveBeenCalledOnce();
    expect(setTheme).toHaveBeenCalledWith(null);
    expect(toggleFullscreen).toHaveBeenCalledOnce();
  });

  it("delegates native theme-change listeners through preload", async () => {
    const listen = vi.fn().mockResolvedValue(vi.fn());
    installElectronApi({ listen });

    const handler = vi.fn();
    await listenWindowThemeChanged(handler);

    expect(listen).toHaveBeenCalledWith("window:theme-changed", expect.any(Function));
    const [, bridgeHandler] = listen.mock.calls[0];
    bridgeHandler({ event: "window:theme-changed", id: 3, payload: "light" });
    expect(handler).toHaveBeenCalledWith("light");
  });
});
