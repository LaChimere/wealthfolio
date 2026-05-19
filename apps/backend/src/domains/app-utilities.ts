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

export interface AppUtilityService {
  getAppInfo(): Promise<AppInfoResponse> | AppInfoResponse;
  checkUpdate(force: boolean): Promise<UpdateCheckResponse> | UpdateCheckResponse;
  backupDatabase(): Promise<BackupDatabaseResponse> | BackupDatabaseResponse;
  backupDatabaseToPath(backupDir: string): Promise<BackupToPathResponse> | BackupToPathResponse;
  restoreDatabase?(backupFilePath: string): Promise<void> | void;
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
    ...(instanceId ? { "X-Instance-Id": instanceId } : {}),
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
