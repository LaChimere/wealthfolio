import { posix, win32 } from "node:path";

export const LEGACY_TAURI_IDENTIFIER = "com.teymz.wealthfolio";

export interface LegacyTauriPaths {
  dataRoot: string;
  dbPath: string;
  logRoot: string;
}

type SupportedPlatform = NodeJS.Platform;

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`Cannot resolve legacy Tauri data root: ${key} is not set`);
  }
  return value;
}

export function resolveLegacyTauriPaths(
  platform: SupportedPlatform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): LegacyTauriPaths {
  if (platform === "darwin") {
    const home = requireEnv(env, "HOME");
    const dataRoot = posix.join(home, "Library", "Application Support", LEGACY_TAURI_IDENTIFIER);
    return {
      dataRoot,
      dbPath: posix.join(dataRoot, "app.db"),
      logRoot: posix.join(home, "Library", "Logs", LEGACY_TAURI_IDENTIFIER),
    };
  }

  if (platform === "win32") {
    const userProfile = env.USERPROFILE;
    const appData = env.APPDATA ?? (userProfile && win32.join(userProfile, "AppData", "Roaming"));
    const localAppData =
      env.LOCALAPPDATA ?? (userProfile && win32.join(userProfile, "AppData", "Local"));
    if (!appData || !localAppData) {
      throw new Error(
        "Cannot resolve legacy Tauri data root: APPDATA/LOCALAPPDATA or USERPROFILE is not set",
      );
    }

    const dataRoot = win32.join(appData, LEGACY_TAURI_IDENTIFIER);
    return {
      dataRoot,
      dbPath: win32.join(dataRoot, "app.db"),
      logRoot: win32.join(localAppData, LEGACY_TAURI_IDENTIFIER, "logs"),
    };
  }

  const home = requireEnv(env, "HOME");
  const dataRoot = posix.join(
    env.XDG_DATA_HOME ?? posix.join(home, ".local", "share"),
    LEGACY_TAURI_IDENTIFIER,
  );
  return {
    dataRoot,
    dbPath: posix.join(dataRoot, "app.db"),
    logRoot: posix.join(dataRoot, "logs"),
  };
}
