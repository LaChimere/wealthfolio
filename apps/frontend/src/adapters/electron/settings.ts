import type { Settings, UpdateInfo } from "@/lib/types";

import type { AppInfo, PlatformInfo } from "../types";
import { invoke, logger, getRuntimeInfo } from "./core";

export const getSettings = async (): Promise<Settings> => {
  try {
    return await invoke<Settings>("get_settings");
  } catch (error) {
    logger.error("Error fetching settings.");
    throw error;
  }
};

export const updateSettings = async (settingsUpdate: Partial<Settings>): Promise<Settings> => {
  try {
    return await invoke<Settings>("update_settings", { settingsUpdate });
  } catch (error) {
    logger.error("Error updating settings.");
    throw error;
  }
};

export const isAutoUpdateCheckEnabled = async (): Promise<boolean> => {
  try {
    return await invoke<boolean>("is_auto_update_check_enabled");
  } catch (_error) {
    logger.error("Error checking auto-update setting.");
    return true;
  }
};

export const backupDatabase = async (): Promise<{ filename: string; data: Uint8Array }> => {
  try {
    const [filename, data] = await invoke<[string, number[]]>("backup_database");
    return { filename, data: new Uint8Array(data) };
  } catch (error) {
    logger.error("Error backing up database.");
    throw error;
  }
};

export const backupDatabaseToPath = async (backupDir: string): Promise<string> => {
  try {
    return await invoke<string>("backup_database_to_path", { backupDir });
  } catch (error) {
    logger.error("Error backing up database to path.");
    throw error;
  }
};

export interface DatabaseBackup {
  filename: string;
  sizeBytes: number;
  modifiedAt: string;
}

export const listDatabaseBackups = (): Promise<DatabaseBackup[]> =>
  Promise.reject(new Error("Listing server-side database backups is only supported in web mode"));

export const deleteDatabaseBackup = (_filename: string): Promise<void> =>
  Promise.reject(new Error("Deleting server-side database backups is only supported in web mode"));

export const getDatabaseBackupDownloadUrl = (_filename: string): string => {
  throw new Error("Downloading server-side database backups is only supported in web mode");
};

export interface PendingExport {
  relativePath: string;
  filename: string;
}

export const backupDatabaseToPendingExport = (): Promise<PendingExport> =>
  Promise.reject(new Error("Pending backup exports are only supported on mobile"));

export const restoreDatabase = async (backupFilePath: string): Promise<void> => {
  try {
    await invoke<void>("restore_database", { backupFilePath });
  } catch (error) {
    logger.error("Error restoring database.");
    throw error;
  }
};

export const getAppInfo = async (): Promise<AppInfo> => {
  return await invoke<AppInfo>("get_app_info");
};

export const checkForUpdates = async (_options?: {
  force?: boolean;
}): Promise<UpdateInfo | null> => {
  return await invoke<UpdateInfo | null>("check_for_updates", {
    force: _options?.force,
  });
};

export const installUpdate = async (): Promise<void> => {
  await invoke("install_app_update");
};

export const getPlatform = async (): Promise<PlatformInfo> => {
  const runtime = await getRuntimeInfo();
  const osByPlatform: Record<string, string> = {
    darwin: "macos",
    linux: "linux",
    win32: "windows",
  };

  return {
    os: osByPlatform[runtime.platform] ?? runtime.platform,
    is_mobile: false,
    is_desktop: true,
    is_electron: true,
    capabilities: {
      connect_sync: true,
      device_sync: true,
      cloud_sync: true,
    },
  };
};
