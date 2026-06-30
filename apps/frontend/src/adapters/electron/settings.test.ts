import { ELECTRON_API_KEY, type WealthfolioElectronApi } from "@wealthfolio/electron/shared/ipc";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  backupDatabase,
  backupDatabaseToPath,
  checkForUpdates,
  deleteDatabaseBackup,
  getAppInfo,
  getPlatform,
  installUpdate,
  isAutoUpdateCheckEnabled,
  listDatabaseBackups,
  restoreDatabase,
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

  it("backs up and restores databases through the sidecar bridge", async () => {
    const bridgeInvoke = vi
      .fn()
      .mockResolvedValueOnce(["wealthfolio_backup.db", [0, 1, 255]])
      .mockResolvedValueOnce("/tmp/wealthfolio_backup.db")
      .mockResolvedValueOnce(undefined);
    installElectronApi({ invoke: bridgeInvoke });

    await expect(backupDatabase()).resolves.toEqual({
      filename: "wealthfolio_backup.db",
      data: new Uint8Array([0, 1, 255]),
    });
    await expect(backupDatabaseToPath("/tmp")).resolves.toBe("/tmp/wealthfolio_backup.db");
    await expect(restoreDatabase("/tmp/wealthfolio_backup.db")).resolves.toBeUndefined();
    expect(bridgeInvoke).toHaveBeenNthCalledWith(1, "backup_database", undefined);
    expect(bridgeInvoke).toHaveBeenNthCalledWith(2, "backup_database_to_path", {
      backupDir: "/tmp",
    });
    expect(bridgeInvoke).toHaveBeenNthCalledWith(3, "restore_database", {
      backupFilePath: "/tmp/wealthfolio_backup.db",
    });
  });

  it("delegates update commands and platform info through Electron runtime APIs", async () => {
    const updateInfo = { currentVersion: "3.4.0", latestVersion: "3.5.0" };
    const bridgeInvoke = vi.fn().mockResolvedValueOnce(updateInfo).mockResolvedValueOnce(undefined);
    const getRuntimeInfo = vi.fn().mockResolvedValue({
      platform: "darwin",
      appVersion: "3.4.0",
      isPackaged: true,
      sidecar: { ready: true },
    });
    installElectronApi({ invoke: bridgeInvoke, getRuntimeInfo });

    await expect(checkForUpdates({ force: true })).resolves.toBe(updateInfo);
    await expect(installUpdate()).resolves.toBeUndefined();
    await expect(getPlatform()).resolves.toEqual({
      os: "macos",
      is_mobile: false,
      is_desktop: true,
      is_electron: true,
      capabilities: {
        connect_sync: true,
        device_sync: true,
        cloud_sync: true,
      },
    });
    expect(bridgeInvoke).toHaveBeenNthCalledWith(1, "check_for_updates", { force: true });
    expect(bridgeInvoke).toHaveBeenNthCalledWith(2, "install_app_update", undefined);
    expect(getRuntimeInfo).toHaveBeenCalledOnce();
  });

  it("surfaces auto-update preference failures", async () => {
    const error = new Error("sidecar unavailable");
    vi.spyOn(console, "error").mockImplementation(() => {});
    installElectronApi({ invoke: vi.fn().mockRejectedValue(error) });

    await expect(isAutoUpdateCheckEnabled()).rejects.toBe(error);
  });
});
