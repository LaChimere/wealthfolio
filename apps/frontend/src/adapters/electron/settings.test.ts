import { ELECTRON_API_KEY, type WealthfolioElectronApi } from "@wealthfolio/electron/shared/ipc";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deleteDatabaseBackup,
  getAppInfo,
  isAutoUpdateCheckEnabled,
  listDatabaseBackups,
} from "./settings";

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

  it("lists and deletes database backups through the sidecar bridge", async () => {
    const backups = [
      {
        filename: "wealthfolio_backup_20260621_120000.db",
        sizeBytes: 1234,
        modifiedAt: "2026-06-21T04:00:00Z",
      },
    ];
    const bridgeInvoke = vi.fn().mockResolvedValueOnce(backups).mockResolvedValueOnce(undefined);
    installElectronApi({ invoke: bridgeInvoke });

    await expect(listDatabaseBackups()).resolves.toEqual(backups);
    await expect(deleteDatabaseBackup("wealthfolio_backup_20260621_120000.db")).resolves.toBe(
      undefined,
    );
    expect(bridgeInvoke).toHaveBeenNthCalledWith(1, "list_database_backups", undefined);
    expect(bridgeInvoke).toHaveBeenNthCalledWith(2, "delete_database_backup", {
      filename: "wealthfolio_backup_20260621_120000.db",
    });
  });

  it("surfaces auto-update preference failures", async () => {
    const error = new Error("sidecar unavailable");
    vi.spyOn(console, "error").mockImplementation(() => {});
    installElectronApi({ invoke: vi.fn().mockRejectedValue(error) });

    await expect(isAutoUpdateCheckEnabled()).rejects.toBe(error);
  });
});
