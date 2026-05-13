import { existsSync } from "node:fs";
import path from "node:path";

import type {
  AppUpdater,
  ProgressInfo,
  UpdateCheckResult,
  UpdateInfo as ElectronUpdateInfo,
} from "electron-updater";

export interface FrontendUpdateInfo {
  currentVersion: string;
  latestVersion: string;
  notes?: string;
  pubDate?: string;
  isAppStoreBuild: boolean;
  storeUrl?: string;
  changelogUrl?: string;
  screenshots?: string[];
}

export interface UpdateDownloadProgress {
  downloaded: number;
  total: number | null;
  phase: "downloading" | "installing";
}

export interface CheckForUpdatesOptions {
  force?: boolean;
}

export interface ElectronUpdaterApp {
  isPackaged: boolean;
  getVersion(): string;
}

export interface ElectronUpdaterServiceDeps {
  app: ElectronUpdaterApp;
  resourcesPath: string;
  updater: Pick<
    AppUpdater,
    | "autoDownload"
    | "autoInstallOnAppQuit"
    | "checkForUpdates"
    | "downloadUpdate"
    | "logger"
    | "off"
    | "on"
    | "quitAndInstall"
  >;
  sendProgress(progress: UpdateDownloadProgress): void;
}

export interface ElectronUpdaterService {
  checkForUpdates(options?: CheckForUpdatesOptions): Promise<FrontendUpdateInfo | null>;
  installUpdate(): Promise<void>;
}

export function validateCheckForUpdatesOptions(payload: unknown): CheckForUpdatesOptions {
  if (payload === undefined || payload === null) {
    return {};
  }
  if (typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Electron update check requires an object payload.");
  }
  const force = (payload as { force?: unknown }).force;
  if (force === undefined) {
    return {};
  }
  if (typeof force !== "boolean") {
    throw new Error('Electron update check requires boolean payload field "force".');
  }
  return { force };
}

export function createElectronUpdaterService({
  app,
  resourcesPath,
  updater,
  sendProgress,
}: ElectronUpdaterServiceDeps): ElectronUpdaterService {
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.logger = null;

  let installPromise: Promise<void> | null = null;

  async function checkForUpdates(
    options: CheckForUpdatesOptions = {},
  ): Promise<FrontendUpdateInfo | null> {
    if (!ensureUpdaterAvailable({ app, resourcesPath, force: options.force ?? false })) {
      return null;
    }

    const result = await updater.checkForUpdates();
    if (!result?.isUpdateAvailable) {
      return null;
    }

    return toFrontendUpdateInfo(result.updateInfo, app.getVersion());
  }

  async function installUpdate(): Promise<void> {
    if (!installPromise) {
      installPromise = downloadAndInstallUpdate().finally(() => {
        installPromise = null;
      });
    }
    return await installPromise;
  }

  async function downloadAndInstallUpdate(): Promise<void> {
    ensureUpdaterAvailable({ app, resourcesPath, force: true });
    const result = await updater.checkForUpdates();
    if (!result?.isUpdateAvailable) {
      throw new Error("No update available.");
    }

    const onProgress = (progress: ProgressInfo) => {
      sendProgress({
        downloaded: progress.transferred,
        total: Number.isFinite(progress.total) ? progress.total : null,
        phase: "downloading",
      });
    };

    updater.on("download-progress", onProgress);
    try {
      await updater.downloadUpdate();
    } finally {
      updater.off("download-progress", onProgress);
    }

    sendProgress({ downloaded: 0, total: null, phase: "installing" });
    updater.quitAndInstall();
  }

  return { checkForUpdates, installUpdate };
}

function ensureUpdaterAvailable({
  app,
  resourcesPath,
  force,
}: {
  app: ElectronUpdaterApp;
  resourcesPath: string;
  force: boolean;
}): boolean {
  if (!app.isPackaged) {
    if (force) {
      throw new Error("Electron auto-update requires a packaged build.");
    }
    return false;
  }

  const configPath = path.join(resourcesPath, "app-update.yml");
  if (!existsSync(configPath)) {
    throw new Error(`Electron auto-update is not configured. Missing ${configPath}.`);
  }

  return true;
}

function toFrontendUpdateInfo(
  updateInfo: UpdateCheckResult["updateInfo"],
  currentVersion: string,
): FrontendUpdateInfo | null {
  if (updateInfo.version === currentVersion) {
    return null;
  }

  return {
    currentVersion,
    latestVersion: updateInfo.version,
    notes: normalizeReleaseNotes(updateInfo.releaseNotes),
    pubDate: updateInfo.releaseDate,
    isAppStoreBuild: false,
    changelogUrl: optionalStringExtra(updateInfo, "changelogUrl", "changelog_url"),
    screenshots: optionalStringArrayExtra(updateInfo, "screenshots"),
  };
}

function normalizeReleaseNotes(notes: ElectronUpdateInfo["releaseNotes"]): string | undefined {
  if (typeof notes === "string") {
    return notes || undefined;
  }
  if (!Array.isArray(notes)) {
    return undefined;
  }

  const joined = notes
    .map((note) => note.note)
    .filter((note): note is string => Boolean(note))
    .join("\n\n");
  return joined || undefined;
}

function optionalStringExtra(
  updateInfo: ElectronUpdateInfo,
  camelKey: string,
  snakeKey: string,
): string | undefined {
  const extra = updateInfo as ElectronUpdateInfo & Record<string, unknown>;
  const value = extra[camelKey] ?? extra[snakeKey];
  return typeof value === "string" && value ? value : undefined;
}

function optionalStringArrayExtra(
  updateInfo: ElectronUpdateInfo,
  key: string,
): string[] | undefined {
  const value = (updateInfo as ElectronUpdateInfo & Record<string, unknown>)[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return undefined;
  }
  return value;
}
