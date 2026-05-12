import { ELECTRON_API_KEY, type WealthfolioElectronApi } from "@wealthfolio/electron/shared/ipc";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getAppInfo } from "./settings";

function installElectronApi(api: Partial<WealthfolioElectronApi>) {
  window[ELECTRON_API_KEY] = {
    getRuntimeInfo: vi.fn(),
    invoke: vi.fn(),
    ...api,
  } as WealthfolioElectronApi;
}

afterEach(() => {
  delete window[ELECTRON_API_KEY];
});

describe("electron settings adapter", () => {
  it("uses sanitized runtime info for app info paths", async () => {
    const bridgeInvoke = vi.fn();
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
      dbPath: "",
      logsDir: "",
    });
    expect(bridgeInvoke).not.toHaveBeenCalled();
  });
});
