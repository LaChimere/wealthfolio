import type { Database } from "bun:sqlite";

import type { AccountService } from "./accounts";
import type { ActivityService } from "./activities";

export interface ConnectImportRunsRequest {
  runType?: string;
  limit: number;
  offset: number;
}

export interface ConnectDeviceSyncReconcileReadyRequest {
  allowOverwrite: boolean;
}

export interface LocalConnectServiceDependencies {
  db: Database;
  activityService: ActivityService;
  accountService: Pick<AccountService, "getAllAccounts">;
}

export type ConnectSyncBrokerDataStatus = "accepted" | "forbidden" | "not_implemented";

export interface ConnectSyncBrokerDataResult {
  status: ConnectSyncBrokerDataStatus;
}

export interface ConnectService {
  storeSyncSession(refreshToken: string): Promise<void> | void;
  clearSyncSession(): Promise<void> | void;
  getSyncSessionStatus(): Promise<unknown> | unknown;
  restoreSyncSession(): Promise<unknown> | unknown;
  listBrokerConnections(): Promise<unknown[]> | unknown[];
  listBrokerAccounts(): Promise<unknown[]> | unknown[];
  syncBrokerData(): Promise<ConnectSyncBrokerDataResult> | ConnectSyncBrokerDataResult;
  syncBrokerConnections(): Promise<unknown> | unknown;
  syncBrokerAccounts(): Promise<unknown> | unknown;
  syncBrokerActivities(): Promise<unknown> | unknown;
  /**
   * Runtime implementations should preserve Rust feature-flag behavior by
   * returning an empty array when Connect sync is disabled.
   */
  getSyncedAccounts(): Promise<unknown[]> | unknown[];
  /**
   * Runtime implementations should preserve Rust feature-flag behavior by
   * returning an empty array when Connect sync is disabled.
   */
  getPlatforms(): Promise<unknown[]> | unknown[];
  /**
   * Runtime implementations should preserve Rust feature-flag behavior by
   * returning an empty array when Connect sync is disabled.
   */
  getBrokerSyncStates(): Promise<unknown[]> | unknown[];
  /**
   * Runtime implementations should preserve Rust feature-flag behavior by
   * returning an empty array when Connect sync is disabled.
   */
  getImportRuns(request: ConnectImportRunsRequest): Promise<unknown[]> | unknown[];
  getBrokerSyncProfile(accountId: string, sourceSystem: string): Promise<unknown> | unknown;
  saveBrokerSyncProfileRules(request: Record<string, unknown>): Promise<unknown> | unknown;
  getSubscriptionPlans(): Promise<unknown> | unknown;
  getSubscriptionPlansPublic(): Promise<unknown> | unknown;
  getUserInfo(): Promise<unknown> | unknown;
}

export class ConnectNotImplementedError extends Error {
  readonly status = 501;
  readonly code = "not_implemented";

  constructor(message: string) {
    super(message);
    this.name = "ConnectNotImplementedError";
  }
}

const CLOUD_SYNC_DISABLED_MESSAGE = "Cloud sync features are disabled in this build.";
const CONNECT_SYNC_DISABLED_MESSAGE = "Connect sync feature is disabled in this build.";
const DEVICE_SYNC_DISABLED_MESSAGE = "Device sync feature is disabled in this build.";
const BROKER_SYNC_PROFILE_DEFERRED_MESSAGE =
  "Broker sync profile persistence is not yet available in the TS backend runtime";

export function createDisabledConnectService(): ConnectService {
  return {
    async storeSyncSession() {
      throw cloudSyncDisabled();
    },
    async clearSyncSession() {
      throw cloudSyncDisabled();
    },
    async getSyncSessionStatus() {
      throw cloudSyncDisabled();
    },
    async restoreSyncSession() {
      throw cloudSyncDisabled();
    },
    async listBrokerConnections() {
      throw connectSyncDisabled();
    },
    async listBrokerAccounts() {
      throw connectSyncDisabled();
    },
    syncBrokerData() {
      return { status: "not_implemented" };
    },
    async syncBrokerConnections() {
      throw connectSyncDisabled();
    },
    async syncBrokerAccounts() {
      throw connectSyncDisabled();
    },
    async syncBrokerActivities() {
      throw connectSyncDisabled();
    },
    getSyncedAccounts() {
      return [];
    },
    getPlatforms() {
      return [];
    },
    getBrokerSyncStates() {
      return [];
    },
    getImportRuns() {
      return [];
    },
    async getBrokerSyncProfile() {
      throw new ConnectNotImplementedError(BROKER_SYNC_PROFILE_DEFERRED_MESSAGE);
    },
    async saveBrokerSyncProfileRules() {
      throw new ConnectNotImplementedError(BROKER_SYNC_PROFILE_DEFERRED_MESSAGE);
    },
    async getSubscriptionPlans() {
      throw cloudSyncDisabled();
    },
    async getSubscriptionPlansPublic() {
      throw cloudSyncDisabled();
    },
    async getUserInfo() {
      throw cloudSyncDisabled();
    },
  };
}

export function createLocalConnectService({
  db,
  activityService,
  accountService,
}: LocalConnectServiceDependencies): ConnectService {
  const disabledService = createDisabledConnectService();
  return {
    ...disabledService,
    getSyncedAccounts() {
      return accountService
        .getAllAccounts()
        .filter((account) => account.providerAccountId !== null);
    },
    getPlatforms() {
      return getLocalConnectPlatforms(db);
    },
    getBrokerSyncStates() {
      return getLocalBrokerSyncStates(db);
    },
    getImportRuns(request) {
      return getLocalImportRuns(db, request);
    },
    async getBrokerSyncProfile(accountId, sourceSystem) {
      if (!activityService.getBrokerSyncProfile) {
        throw new ConnectNotImplementedError(BROKER_SYNC_PROFILE_DEFERRED_MESSAGE);
      }
      return await activityService.getBrokerSyncProfile(accountId, sourceSystem);
    },
    async saveBrokerSyncProfileRules(request) {
      if (!activityService.saveBrokerSyncProfileRules) {
        throw new ConnectNotImplementedError(BROKER_SYNC_PROFILE_DEFERRED_MESSAGE);
      }
      return await activityService.saveBrokerSyncProfileRules(request);
    },
  };
}

interface ConnectPlatformRow {
  id: string;
  name: string | null;
  url: string;
  external_id: string | null;
  kind: string;
  website_url: string | null;
  logo_url: string | null;
}

interface BrokerSyncStateRow {
  account_id: string;
  provider: string;
  checkpoint_json: string | null;
  last_attempted_at: string | null;
  last_successful_at: string | null;
  last_error: string | null;
  last_run_id: string | null;
  sync_status: string;
  created_at: string;
  updated_at: string;
}

interface ImportRunRow {
  id: string;
  account_id: string;
  source_system: string;
  run_type: string;
  mode: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  review_mode: string;
  applied_at: string | null;
  checkpoint_in: string | null;
  checkpoint_out: string | null;
  summary: string | null;
  warnings: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

interface ImportRunSummary {
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  warnings: number;
  errors: number;
  removed: number;
  assetsCreated: number;
}

type BrokerSyncStatus = "IDLE" | "RUNNING" | "NEEDS_REVIEW" | "FAILED";
type ImportRunType = "SYNC" | "IMPORT";
type ImportRunMode = "INITIAL" | "INCREMENTAL" | "BACKFILL" | "REPAIR";
type ImportRunStatus = "RUNNING" | "APPLIED" | "NEEDS_REVIEW" | "FAILED" | "CANCELLED";
type ImportRunReviewMode = "NEVER" | "ALWAYS" | "IF_WARNINGS";

function getLocalConnectPlatforms(db: Database): unknown[] {
  return db
    .query<ConnectPlatformRow, []>(
      `
        SELECT id, name, url, external_id, kind, website_url, logo_url
        FROM platforms
        ORDER BY name ASC
      `,
    )
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      url: row.url,
      externalId: row.external_id,
      kind: row.kind,
      websiteUrl: row.website_url,
      logoUrl: row.logo_url,
    }));
}

function getLocalBrokerSyncStates(db: Database): unknown[] {
  return db
    .query<BrokerSyncStateRow, []>(
      `
        SELECT
          account_id, provider, checkpoint_json, last_attempted_at, last_successful_at,
          last_error, last_run_id, sync_status, created_at, updated_at
        FROM brokers_sync_state
        ORDER BY updated_at DESC
      `,
    )
    .all()
    .map((row) => ({
      accountId: row.account_id,
      provider: row.provider,
      checkpointJson: parseJsonOrNull(row.checkpoint_json),
      lastAttemptedAt: optionalRustDateTime(row.last_attempted_at),
      lastSuccessfulAt: optionalRustDateTime(row.last_successful_at),
      lastError: row.last_error,
      lastRunId: row.last_run_id,
      syncStatus: brokerSyncStatus(row.sync_status),
      createdAt: rustDateTime(row.created_at),
      updatedAt: rustDateTime(row.updated_at),
    }));
}

function getLocalImportRuns(db: Database, request: ConnectImportRunsRequest): unknown[] {
  const params: Array<string | number> = [];
  const whereSql = request.runType ? "WHERE run_type = ?" : "";
  if (request.runType) {
    params.push(request.runType);
  }
  params.push(request.limit, request.offset);

  return db
    .query<ImportRunRow, Array<string | number>>(
      `
        SELECT
          id, account_id, source_system, run_type, mode, status, started_at, finished_at,
          review_mode, applied_at, checkpoint_in, checkpoint_out, summary, warnings, error,
          created_at, updated_at
        FROM import_runs
        ${whereSql}
        ORDER BY started_at DESC
        LIMIT ? OFFSET ?
      `,
    )
    .all(...params)
    .map(importRunFromRow);
}

function importRunFromRow(row: ImportRunRow): unknown {
  return {
    id: row.id,
    accountId: row.account_id,
    sourceSystem: row.source_system,
    runType: enumValue<ImportRunType>(row.run_type, ["SYNC", "IMPORT"], "SYNC"),
    mode: enumValue<ImportRunMode>(
      row.mode,
      ["INITIAL", "INCREMENTAL", "BACKFILL", "REPAIR"],
      "INCREMENTAL",
    ),
    status: enumValue<ImportRunStatus>(
      row.status,
      ["RUNNING", "APPLIED", "NEEDS_REVIEW", "FAILED", "CANCELLED"],
      "RUNNING",
    ),
    startedAt: rustDateTime(row.started_at),
    finishedAt: optionalRustDateTime(row.finished_at),
    reviewMode: enumValue<ImportRunReviewMode>(
      row.review_mode,
      ["NEVER", "ALWAYS", "IF_WARNINGS"],
      "NEVER",
    ),
    appliedAt: optionalRustDateTime(row.applied_at),
    checkpointIn: parseJsonOrNull(row.checkpoint_in),
    checkpointOut: parseJsonOrNull(row.checkpoint_out),
    summary: parseImportRunSummary(row.summary),
    warnings: parseStringArrayOrNull(row.warnings),
    error: row.error,
    createdAt: rustDateTime(row.created_at),
    updatedAt: rustDateTime(row.updated_at),
  };
}

function brokerSyncStatus(value: string): BrokerSyncStatus {
  switch (value) {
    case "RUNNING":
    case "SYNCING":
      return "RUNNING";
    case "NEEDS_REVIEW":
      return "NEEDS_REVIEW";
    case "FAILED":
      return "FAILED";
    case "IDLE":
    default:
      return "IDLE";
  }
}

function enumValue<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function parseImportRunSummary(value: string | null): ImportRunSummary | null {
  const parsed = parseJsonOrNull(value);
  if (!isRecord(parsed)) {
    return null;
  }
  const fetched = readU32(parsed, "fetched");
  const inserted = readU32(parsed, "inserted");
  const updated = readU32(parsed, "updated");
  const skipped = readU32(parsed, "skipped");
  const warnings = readU32(parsed, "warnings");
  const errors = readU32(parsed, "errors");
  const removed = readU32(parsed, "removed");
  const assetsCreated = readU32(parsed, "assetsCreated");
  if (
    fetched === null ||
    inserted === null ||
    updated === null ||
    skipped === null ||
    warnings === null ||
    errors === null ||
    removed === null ||
    assetsCreated === null
  ) {
    return null;
  }
  return {
    fetched,
    inserted,
    updated,
    skipped,
    warnings,
    errors,
    removed,
    assetsCreated,
  };
}

function parseStringArrayOrNull(value: string | null): string[] | null {
  const parsed = parseJsonOrNull(value);
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    return null;
  }
  return parsed;
}

function parseJsonOrNull(value: string | null): unknown | null {
  if (value === null) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isU32(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}

function readU32(record: Record<string, unknown>, field: string): number | null {
  const value = record[field];
  return isU32(value) ? value : null;
}

function optionalRustDateTime(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return rustUtcString(date);
}

function rustDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return rustUtcString(new Date());
  }
  return rustUtcString(date);
}

function rustUtcString(date: Date): string {
  return date.toISOString().replace(".000Z", "Z");
}

function cloudSyncDisabled(): ConnectNotImplementedError {
  return new ConnectNotImplementedError(CLOUD_SYNC_DISABLED_MESSAGE);
}

function connectSyncDisabled(): ConnectNotImplementedError {
  return new ConnectNotImplementedError(CONNECT_SYNC_DISABLED_MESSAGE);
}

export interface ConnectDeviceSyncService {
  getDeviceSyncState(): Promise<unknown> | unknown;
  /**
   * Runtime implementations own all Rust-equivalent side effects, including
   * device-id secrets, snapshot cursors, repository resets, and engine startup.
   */
  enableDeviceSync(): Promise<unknown> | unknown;
  /**
   * Runtime implementations own all Rust-equivalent side effects, including
   * device-id secret cleanup, snapshot cursor cleanup, repository reset, and
   * engine shutdown.
   */
  clearDeviceSyncData(): Promise<void> | void;
  /**
   * Runtime implementations own all Rust-equivalent side effects, including
   * device-id secrets, snapshot cursors, repository resets, and engine startup.
   */
  reinitializeDeviceSync(): Promise<unknown> | unknown;
  getDeviceSyncEngineStatus(): Promise<unknown> | unknown;
  getDeviceSyncPairingSourceStatus(): Promise<unknown> | unknown;
  getDeviceSyncBootstrapOverwriteCheck(): Promise<unknown> | unknown;
  reconcileDeviceSyncReadyState(
    request: ConnectDeviceSyncReconcileReadyRequest,
  ): Promise<unknown> | unknown;
  bootstrapDeviceSnapshot(): Promise<unknown> | unknown;
  triggerDeviceSyncCycle(): Promise<unknown> | unknown;
  startDeviceSyncBackgroundEngine(): Promise<unknown> | unknown;
  stopDeviceSyncBackgroundEngine(): Promise<unknown> | unknown;
  generateDeviceSnapshotNow(): Promise<unknown> | unknown;
  cancelDeviceSnapshotUpload(): Promise<unknown> | unknown;
}

export function createDisabledConnectDeviceSyncService(): ConnectDeviceSyncService {
  return {
    async getDeviceSyncState() {
      throw deviceSyncDisabled();
    },
    async enableDeviceSync() {
      throw deviceSyncDisabled();
    },
    async clearDeviceSyncData() {
      throw deviceSyncDisabled();
    },
    async reinitializeDeviceSync() {
      throw deviceSyncDisabled();
    },
    async getDeviceSyncEngineStatus() {
      throw deviceSyncDisabled();
    },
    async getDeviceSyncPairingSourceStatus() {
      throw deviceSyncDisabled();
    },
    async getDeviceSyncBootstrapOverwriteCheck() {
      throw deviceSyncDisabled();
    },
    async reconcileDeviceSyncReadyState() {
      throw deviceSyncDisabled();
    },
    async bootstrapDeviceSnapshot() {
      throw deviceSyncDisabled();
    },
    async triggerDeviceSyncCycle() {
      throw deviceSyncDisabled();
    },
    async startDeviceSyncBackgroundEngine() {
      throw deviceSyncDisabled();
    },
    async stopDeviceSyncBackgroundEngine() {
      throw deviceSyncDisabled();
    },
    async generateDeviceSnapshotNow() {
      throw deviceSyncDisabled();
    },
    async cancelDeviceSnapshotUpload() {
      throw deviceSyncDisabled();
    },
  };
}

function deviceSyncDisabled(): ConnectNotImplementedError {
  return new ConnectNotImplementedError(DEVICE_SYNC_DISABLED_MESSAGE);
}
