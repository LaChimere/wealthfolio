import { ELECTRON_API_KEY, type WealthfolioElectronApi } from "@wealthfolio/electron/shared/ipc";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getAppInfo, isAutoUpdateCheckEnabled } from "./settings";

function installElectronApi(api: Partial<WealthfolioElectronApi>) {
  window[ELECTRON_API_KEY] = {
    getRuntimeInfo: vi.fn(),
    invoke: vi.fn(),
    writeLog: vi.fn().mockResolvedValue(undefined),
    ...api,
  } as WealthfolioElectronApi;
}

afterEach(() => {
  delete window[ELECTRON_API_KEY];
  vi.restoreAllMocks();
});

describe("electron settings adapter", () => {
  it("loads app info through the sidecar bridge", async () => {
    const bridgeInvoke = vi.fn().mockResolvedValue({
      version: "3.4.0",
      dbPath: "/safe/app.db",
      logsDir: "/safe/logs",
    });
    installElectronApi({
      getRuntimeInfo: vi.fn().mockResolvedValue({
        platform: "darwin",
        appVersion: "3.4.0",
        isPackaged: false,
        sidecar: { ready: true },
      }),
      invoke: bridgeInvoke,
    });

    await expect(getAppInfo()).resolves.toEqual({
      version: "3.4.0",
      dbPath: "/safe/app.db",
      logsDir: "/safe/logs",
    });
    expect(bridgeInvoke).toHaveBeenCalledWith("get_app_info", undefined);
  });

  it("loads auto-update preference through the sidecar bridge", async () => {
    const bridgeInvoke = vi.fn().mockResolvedValue(false);
    installElectronApi({ invoke: bridgeInvoke });

    await expect(isAutoUpdateCheckEnabled()).resolves.toBe(false);
    expect(bridgeInvoke).toHaveBeenCalledWith("is_auto_update_check_enabled", undefined);
  });

  it("surfaces auto-update preference failures", async () => {
    const error = new Error("sidecar unavailable");
    vi.spyOn(console, "error").mockImplementation(() => {});
    installElectronApi({ invoke: vi.fn().mockRejectedValue(error) });

    await expect(isAutoUpdateCheckEnabled()).rejects.toBe(error);
  });
});
