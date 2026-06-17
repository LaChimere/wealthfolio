import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { backupDatabaseToFile, restoreDatabase as restoreSqliteDatabase } from "../storage/sqlite";

export interface AppInfoResponse {
  version: string;
  dbPath: string;
  logsDir: string;
}

export interface UpdateCheckResponse {
  updateAvailable: boolean;
  latestVersion: string;
  notes?: string | null;
  pubDate?: string | null;
  downloadUrl?: string | null;
  changelogUrl?: string | null;
  screenshots?: string[] | null;
}

export interface BackupDatabaseResponse {
  filename: string;
  dataB64: string;
}

export interface BackupToPathResponse {
  path: string;
}

export interface BackupFileInfo {
  filename: string;
  sizeBytes: number;
  modifiedAt: string;
}

export interface AppUtilityService {
  getAppInfo(): Promise<AppInfoResponse> | AppInfoResponse;
  checkUpdate(force: boolean): Promise<UpdateCheckResponse> | UpdateCheckResponse;
  backupDatabase(): Promise<BackupDatabaseResponse> | BackupDatabaseResponse;
  backupDatabaseToPath(backupDir: string): Promise<BackupToPathResponse> | BackupToPathResponse;
  restoreDatabase(backupFilePath: string): Promise<void> | void;
  listDatabaseBackups(): Promise<BackupFileInfo[]> | BackupFileInfo[];
  deleteDatabaseBackup(filename: string): Promise<void> | void;
}

export interface AppUtilityServiceOptions {
  appDataDir: string;
  appVersion: string;
  dbPath: string;
  logsDir: string;
  arch?: string;
  env?: NodeJS.ProcessEnv;
  fetchUpdate?: FetchUpdate;
  instanceId?: string | (() => string | undefined);
  now?: () => Date;
  prepareDatabaseRestore?: () => Promise<void> | void;
  restoreSettleDelayMs?: number;
  target?: string;
  updateCacheTtlMs?: number;
  updateEndpointBase?: string;
  updateTimeoutMs?: number;
}

interface UpdatePlatformInfo {
  url?: string | null;
}

interface UpdateCheckResponseRaw {
  version?: unknown;
  notes?: unknown;
  pub_date?: unknown;
  pubDate?: unknown;
  platforms?: unknown;
  changelog_url?: unknown;
  changelogUrl?: unknown;
  screenshots?: unknown;
}

type FetchUpdate = (input: string, init?: RequestInit) => Promise<Response>;

const WEB_RUNTIME_TARGET = "web-docker";
const DEFAULT_RESTORE_SETTLE_DELAY_MS = 150;
const DEFAULT_UPDATE_CACHE_TTL_MS = 60 * 60 * 1_000;
const DEFAULT_UPDATE_ENDPOINT_BASE = "https://wealthfolio.app/releases";
const DEFAULT_UPDATE_TIMEOUT_MS = 10_000;
const BACKUP_FILENAME_PREFIX = "wealthfolio_backup_";
const BACKUP_FILENAME_SUFFIX = ".db";
const BACKUP_FILENAME_TIMESTAMP_FORMAT_PATTERN = /^\d{8}_\d{6}$/;

export function isValidBackupFilename(filename: string): boolean {
  const expectedLen =
    BACKUP_FILENAME_PREFIX.length + "YYYYMMDD_HHMMSS".length + BACKUP_FILENAME_SUFFIX.length;

  if (
    filename.length !== expectedLen ||
    !filename.startsWith(BACKUP_FILENAME_PREFIX) ||
    !filename.endsWith(BACKUP_FILENAME_SUFFIX)
  ) {
    return false;
  }

  const timestamp = filename.slice(
    BACKUP_FILENAME_PREFIX.length,
    filename.length - BACKUP_FILENAME_SUFFIX.length,
  );

  if (!BACKUP_FILENAME_TIMESTAMP_FORMAT_PATTERN.test(timestamp)) {
    return false;
  }

  const year = parseInt(timestamp.slice(0, 4), 10);
  const month = parseInt(timestamp.slice(4, 6), 10);
  const day = parseInt(timestamp.slice(6, 8), 10);
  const hour = parseInt(timestamp.slice(9, 11), 10);
  const minute = parseInt(timestamp.slice(11, 13), 10);
  const second = parseInt(timestamp.slice(13, 15), 10);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  if (hour > 23 || minute > 59 || second > 59) {
    return false;
  }

  const date = new Date(year, month - 1, day, hour, minute, second);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day &&
    date.getHours() === hour &&
    date.getMinutes() === minute &&
    date.getSeconds() === second
  );
}

export function createAppUtilityService(options: AppUtilityServiceOptions): AppUtilityService {
  const now = options.now ?? (() => new Date());
  const fetchUpdate = options.fetchUpdate ?? fetch;
  const updateCacheTtlMs = options.updateCacheTtlMs ?? DEFAULT_UPDATE_CACHE_TTL_MS;
  const updateEndpointBase = options.updateEndpointBase ?? DEFAULT_UPDATE_ENDPOINT_BASE;
  let cachedUpdate: { cachedAt: number; response: UpdateCheckResponse } | undefined;

  return {
    getAppInfo() {
      return {
        version: options.appVersion,
        dbPath: options.dbPath,
        logsDir: options.logsDir,
      };
    },
    async checkUpdate(force) {
      const nowMs = now().getTime();
      if (!force && cachedUpdate && nowMs - cachedUpdate.cachedAt < updateCacheTtlMs) {
        return cachedUpdate.response;
      }

      const target = normalizeTarget(options.target);
      const arch = normalizeArch(options.arch);
      const response = await fetchUpdate(
        `${updateEndpointBase}/${target}/${arch}/${options.appVersion}`,
        {
          headers: updateHeaders(resolveInstanceId(options.instanceId)),
          signal: AbortSignal.timeout(options.updateTimeoutMs ?? DEFAULT_UPDATE_TIMEOUT_MS),
        },
      );

      const updateResponse = await parseUpdateResponse(
        response,
        options.appVersion,
        `${target}-${arch}`,
      );
      cachedUpdate = { cachedAt: nowMs, response: updateResponse };
      return updateResponse;
    },
    backupDatabase() {
      const backupPath = path.join(options.appDataDir, "backups", backupFilename(now()));
      backupDatabaseToFile(options.appDataDir, backupPath, options.env);
      return {
        filename: path.basename(backupPath),
        dataB64: Buffer.from(readFileSync(backupPath)).toString("base64"),
      };
    },
    backupDatabaseToPath(backupDir) {
      const normalizedBackupDir = normalizeFilePath(backupDir);
      mkdirSync(normalizedBackupDir, { recursive: true });
      const backupPath = path.join(normalizedBackupDir, backupFilename(now()));
      backupDatabaseToFile(options.appDataDir, backupPath, options.env);
      return { path: backupPath };
    },
    async restoreDatabase(backupFilePath) {
      const normalizedBackupPath = normalizeFilePath(backupFilePath);
      if (!existsSync(normalizedBackupPath)) {
        throw new Error("Backup file not found");
      }
      await options.prepareDatabaseRestore?.();
      await sleep(options.restoreSettleDelayMs ?? DEFAULT_RESTORE_SETTLE_DELAY_MS);
      restoreSqliteDatabase(options.appDataDir, normalizedBackupPath, options.env);
    },
    async listDatabaseBackups() {
      const { readdirSync, statSync } = await import("node:fs");
      const backupDir = path.resolve(options.appDataDir, "backups");

      let entries: string[];
      try {
        entries = readdirSync(backupDir);
      } catch (error: any) {
        if (error.code === "ENOENT") {
          return [];
        }
        throw error;
      }

      const backups: BackupFileInfo[] = [];
      for (const filename of entries) {
        if (!isValidBackupFilename(filename)) {
          continue;
        }

        const filePath = path.resolve(backupDir, filename);
        let stats;
        try {
          stats = statSync(filePath);
        } catch {
          continue;
        }

        if (!stats.isFile()) {
          continue;
        }

        backups.push({
          filename,
          sizeBytes: stats.size,
          modifiedAt: stats.mtime.toISOString(),
        });
      }

      backups.sort((a, b) => b.filename.localeCompare(a.filename));
      return backups;
    },
    async deleteDatabaseBackup(filename) {
      if (!isValidBackupFilename(filename)) {
        throw new Error("Invalid backup filename");
      }

      const { unlinkSync, realpathSync } = await import("node:fs");
      const backupDir = path.resolve(options.appDataDir, "backups");
      const filePath = path.resolve(backupDir, filename);

      const canonicalDir = realpathSync(backupDir);
      const canonicalFile = realpathSync(filePath);

      if (!canonicalFile.startsWith(canonicalDir + path.sep)) {
        throw new Error("Invalid backup filename");
      }

      unlinkSync(canonicalFile);
    },
  };
}

function backupFilename(now: Date): string {
  return `wealthfolio_backup_${formatLocalTimestamp(now)}.db`;
}

function formatLocalTimestamp(date: Date): string {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "_",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

async function parseUpdateResponse(
  response: Response,
  currentVersion: string,
  platformKey: string,
): Promise<UpdateCheckResponse> {
  if (response.status === 404) {
    return noUpdateResponse(currentVersion);
  }
  if (!response.ok) {
    throw new Error(`Failed to query update endpoint: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as UpdateCheckResponseRaw;
  const latestVersion = typeof payload.version === "string" ? payload.version : currentVersion;
  const platforms =
    payload.platforms && typeof payload.platforms === "object"
      ? (payload.platforms as Record<string, UpdatePlatformInfo>)
      : {};
  return {
    updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
    latestVersion,
    notes: optionalString(payload.notes),
    pubDate: optionalString(payload.pubDate ?? payload.pub_date),
    downloadUrl: optionalString(platforms[platformKey]?.url),
    changelogUrl: optionalString(payload.changelogUrl ?? payload.changelog_url),
    screenshots: Array.isArray(payload.screenshots)
      ? payload.screenshots.filter((item): item is string => typeof item === "string")
      : null,
  };
}

function noUpdateResponse(version: string): UpdateCheckResponse {
  return {
    updateAvailable: false,
    latestVersion: version,
    notes: null,
    pubDate: null,
    downloadUrl: null,
    changelogUrl: null,
    screenshots: null,
  };
}

function updateHeaders(instanceId: string | undefined): HeadersInit {
  return {
    "X-Client-Runtime": WEB_RUNTIME_TARGET,
    "X-Instance-Id": instanceId ?? "",
  };
}

function resolveInstanceId(
  instanceId: string | (() => string | undefined) | undefined,
): string | undefined {
  return typeof instanceId === "function" ? instanceId() : instanceId;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeTarget(target: string | undefined): string {
  switch ((target ?? WEB_RUNTIME_TARGET).toLowerCase()) {
    case "macos":
    case "darwin":
      return "darwin";
    case "windows":
    case "win32":
      return "windows";
    case "linux":
      return "linux";
    case "web-docker":
      return WEB_RUNTIME_TARGET;
    default:
      return target?.toLowerCase() || WEB_RUNTIME_TARGET;
  }
}

function normalizeArch(arch: string | undefined): string {
  switch ((arch ?? process.arch).toLowerCase()) {
    case "arm64":
    case "aarch64":
      return "aarch64";
    case "x86_64":
    case "x64":
    case "amd64":
      return "x86_64";
    default:
      return arch?.toLowerCase() || "x86_64";
  }
}

function compareVersions(left: string, right: string): number {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  const maxLength = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < maxLength; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function versionParts(value: string): number[] {
  return value
    .split(/[+-]/, 1)[0]
    .split(".")
    .map((part) => {
      const parsed = Number(part);
      return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
    });
}

function normalizeFilePath(filePath: string): string {
  return filePath.startsWith("file://") ? filePath.slice("file://".length) : filePath;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
