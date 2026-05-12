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

export const restoreDatabase = async (backupFilePath: string): Promise<void> => {
  try {
    await invoke<void>("restore_database", { backupFilePath });
  } catch (error) {
    logger.error("Error restoring database.");
    throw error;
  }
};

export const getAppInfo = async (): Promise<AppInfo> => {
  const runtime = await getRuntimeInfo();
  return {
    version: runtime.appVersion,
    dbPath: "",
    logsDir: "",
  };
};

export const checkForUpdates = async (_options?: {
  force?: boolean;
}): Promise<UpdateInfo | null> => {
  return await invoke<UpdateInfo | null>("check_for_updates");
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
    is_tauri: false,
    is_electron: true,
    capabilities: {
      connect_sync: true,
      device_sync: true,
      cloud_sync: true,
    },
  };
};
