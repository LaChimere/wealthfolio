import { afterEach, describe, expect, it, vi } from "vitest";

import type { Settings } from "@/lib/types";
import {
  backupDatabase,
  backupDatabaseToPath,
  backupDatabaseToPendingExport,
  checkForUpdates,
  deleteDatabaseBackup,
  getAppInfo,
  getDatabaseBackupDownloadUrl,
  getSettings,
  isAutoUpdateCheckEnabled,
  listDatabaseBackups,
  restoreDatabase,
} from "./settings";
import { invoke } from "./core";

vi.mock("./core", () => ({
  API_PREFIX: "/api/v1",
  invoke: vi.fn(),
  logger: {
    error: vi.fn(),
  },
}));

const invokeMock = vi.mocked(invoke);

afterEach(() => {
  vi.clearAllMocks();
});

describe("web settings adapter", () => {
  it("loads settings through the backend", async () => {
    const settings = { baseCurrency: "USD" } as Settings;
    invokeMock.mockResolvedValueOnce(settings);

    await expect(getSettings()).resolves.toBe(settings);
    expect(invokeMock).toHaveBeenCalledWith("get_settings");
  });

  it("surfaces settings fetch failures", async () => {
    const error = new Error("backend unavailable");
    invokeMock.mockRejectedValueOnce(error);

    await expect(getSettings()).rejects.toBe(error);
  });

  it("loads app info through the backend", async () => {
    const appInfo = {
      version: "3.4.0",
      dbPath: "/safe/app.db",
      logsDir: "/safe/logs",
    };
    invokeMock.mockResolvedValueOnce(appInfo);

    await expect(getAppInfo()).resolves.toBe(appInfo);
    expect(invokeMock).toHaveBeenCalledWith("get_app_info");
  });

  it("surfaces app info fetch failures", async () => {
    const error = new Error("backend unavailable");
    invokeMock.mockRejectedValueOnce(error);

    await expect(getAppInfo()).rejects.toBe(error);
  });

  it("loads the auto-update preference through the backend", async () => {
    invokeMock.mockResolvedValueOnce(false);

    await expect(isAutoUpdateCheckEnabled()).resolves.toBe(false);
    expect(invokeMock).toHaveBeenCalledWith("is_auto_update_check_enabled");
  });

  it("surfaces auto-update preference failures", async () => {
    const error = new Error("backend unavailable");
    invokeMock.mockRejectedValueOnce(error);

    await expect(isAutoUpdateCheckEnabled()).rejects.toBe(error);
  });

  it("manages server-side database backups through the backend", async () => {
    const backups = [
      {
        filename: "wealthfolio_backup_20260621_120000.db",
        sizeBytes: 1234,
        modifiedAt: "2026-06-21T04:00:00Z",
      },
    ];
    invokeMock
      .mockResolvedValueOnce({ filename: "wealthfolio_backup_20260621_120000.db" })
      .mockResolvedValueOnce(backups)
      .mockResolvedValueOnce(undefined);

    await expect(backupDatabase()).resolves.toEqual({
      filename: "wealthfolio_backup_20260621_120000.db",
    });
    await expect(listDatabaseBackups()).resolves.toEqual(backups);
    await expect(deleteDatabaseBackup("wealthfolio_backup_20260621_120000.db")).resolves.toBe(
      undefined,
    );
    expect(getDatabaseBackupDownloadUrl("wealthfolio backup.db")).toBe(
      "/api/v1/utilities/database/backups/wealthfolio%20backup.db/download",
    );
    expect(invokeMock).toHaveBeenNthCalledWith(1, "backup_database");
    expect(invokeMock).toHaveBeenNthCalledWith(2, "list_database_backups");
    expect(invokeMock).toHaveBeenNthCalledWith(3, "delete_database_backup", {
      filename: "wealthfolio_backup_20260621_120000.db",
    });
  });

  it("rejects desktop/native-only database backup helpers in web mode", async () => {
    await expect(backupDatabaseToPath("/tmp")).rejects.toThrow(
      "Backing up to a local path is only supported in the desktop app",
    );
    await expect(backupDatabaseToPendingExport()).rejects.toThrow(
      "Pending backup exports are only supported in a native app",
    );
    await expect(restoreDatabase("/tmp/app.db")).rejects.toThrow(
      "Restore in web mode requires stopping Wealthfolio and replacing app.db",
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("maps web update checks with the current app version", async () => {
    invokeMock
      .mockResolvedValueOnce({
        updateAvailable: true,
        latestVersion: "3.5.0",
        notes: "Release notes",
        pubDate: "2026-05-06",
        downloadUrl: "https://example.test/download",
        changelogUrl: "https://example.test/changelog",
        screenshots: ["https://example.test/screenshot.png"],
      })
      .mockResolvedValueOnce({
        version: "3.4.0",
        dbPath: "/safe/app.db",
        logsDir: "/safe/logs",
      });

    await expect(checkForUpdates({ force: true })).resolves.toEqual({
      currentVersion: "3.4.0",
      latestVersion: "3.5.0",
      notes: "Release notes",
      pubDate: "2026-05-06",
      isAppStoreBuild: false,
      storeUrl: "https://example.test/download",
      changelogUrl: "https://example.test/changelog",
      screenshots: ["https://example.test/screenshot.png"],
    });
    expect(invokeMock).toHaveBeenNthCalledWith(1, "check_update", { force: true });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "get_app_info");
  });

  it("does not load app info when no web update is available", async () => {
    invokeMock.mockResolvedValueOnce({
      updateAvailable: false,
      latestVersion: "3.4.0",
    });

    await expect(checkForUpdates()).resolves.toBeNull();
    expect(invokeMock).toHaveBeenCalledOnce();
    expect(invokeMock).toHaveBeenCalledWith("check_update", {});
  });
});
