import { createHash, randomUUID } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "bun:sqlite";

import { DEVICE_SYNC_PULL_COMPLETE_EVENT } from "../domain-events/planner";
import type { BackendEventBus } from "../events";
import type { AccountService } from "./accounts";
import { ACTIVITY_BULK_CREATED_ASSET_IDS, type ActivityService } from "./activities";
import type { ExchangeMetadata } from "./assets";
import { localOverwriteRiskSummary } from "./device-sync-overwrite-risk";
import { normalizeSyncDatetime } from "./device-sync-time";
import { instrumentTypeFromQuoteType, type SymbolSearchResult } from "./market-data";
import type { SecretService } from "./secrets";
import { createSyncCryptoService } from "./sync-crypto";

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
  activityService: Pick<ActivityService, "getBrokerSyncProfile" | "saveBrokerSyncProfileRules"> &
    Partial<Pick<ActivityService, "bulkMutateActivities" | "checkExistingDuplicates">>;
  accountService: Pick<AccountService, "createAccount" | "getAllAccounts" | "getBaseCurrency">;
  exchangeMetadata?: Pick<ExchangeMetadata, "yahooSuffixToMic">;
  symbolSearch?: (query: string) => Promise<SymbolSearchResult[]> | SymbolSearchResult[];
  secretService?: SecretService;
  eventBus?: BackendEventBus;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
}

export interface LocalConnectDeviceSyncServiceDependencies {
  db: Database;
  secretService?: SecretService;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  restoreSyncSession?: () => Promise<unknown> | unknown;
  eventBus?: BackendEventBus;
  appVersion?: string;
  deviceDisplayName?: string;
  platform?: string;
  reinitializeDelayMs?: number;
  backgroundOutboxPruneIntervalMs?: number;
}

export type ConnectSyncBrokerDataStatus = "accepted" | "forbidden" | "not_implemented";

export interface ConnectSyncBrokerDataResult {
  status: ConnectSyncBrokerDataStatus;
}

interface BrokerSyncEventPayload {
  success: boolean;
  message: string;
  connectionsSynced?: {
    synced: number;
    platformsCreated: number;
    platformsUpdated: number;
  };
  accountsSynced?: {
    synced: number;
    created: number;
    updated: number;
    skipped: number;
    createdAccounts: Array<[string, string]>;
    newAccountsInfo: Array<{
      localAccountId: string;
      providerAccountId: string;
      defaultName: string;
      currency: string;
      institutionName: string | null;
    }>;
  };
  activitiesSynced?: {
    accountsSynced: number;
    activitiesUpserted: number;
    assetsInserted: number;
    accountsFailed: number;
    accountsWarned: number;
    newAssetIds: string[];
  };
  holdingsSynced?: {
    accountsSynced: number;
    snapshotsUpserted: number;
    positionsUpserted: number;
    assetsInserted: number;
    accountsFailed: number;
    newAssetIds: string[];
  };
  newAccounts?: Array<{
    localAccountId: string;
    providerAccountId: string;
    defaultName: string;
    currency: string;
    institutionName: string | null;
  }>;
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

export class ConnectServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ConnectServiceError";
    this.code = code;
    this.status = status;
  }
}

export class ConnectNotImplementedError extends ConnectServiceError {
  constructor(message: string) {
    super("not_implemented", message, 501);
    this.name = "ConnectNotImplementedError";
  }
}

const CLOUD_SYNC_DISABLED_MESSAGE = "Cloud sync features are disabled in this build.";
const CONNECT_SYNC_DISABLED_MESSAGE = "Connect sync feature is disabled in this build.";
const DEVICE_SYNC_DISABLED_MESSAGE = "Device sync feature is disabled in this build.";
const BROKER_SYNC_PROFILE_DEFERRED_MESSAGE =
  "Broker sync profile persistence is not available in this build.";
const BROKER_ACTIVITY_MAX_PAGES = 10_000;
const BROKER_SYNC_START = "broker:sync-start";
const BROKER_SYNC_COMPLETE = "broker:sync-complete";
const BROKER_SYNC_ERROR = "broker:sync-error";
const CLOUD_REFRESH_TOKEN_KEY = "sync_refresh_token";
const CLOUD_ACCESS_TOKEN_KEY = "sync_access_token";
const DEVICE_SYNC_IDENTITY_KEY = "sync_identity";
const DEVICE_SYNC_DEVICE_ID_KEY = "sync_device_id";
const DEFAULT_CONNECT_AUTH_URL = "https://auth.wealthfolio.app";
const DEFAULT_CONNECT_AUTH_PUBLISHABLE_KEY = "sb_publishable_ZSZbXNtWtnh9i2nqJ2UL4A_NV8ZVutd";
const DEFAULT_CONNECT_API_URL = "https://api.wealthfolio.app";
const DEVICE_ENROLL_DISPLAY_NAME = "Wealthfolio Server";
const RESET_REASON_REINITIALIZE = "reinitialize";
const MIN_SAFE_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

type I64Value = number | bigint;

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
    async syncBrokerData() {
      return (await syncBrokerDataBounded(this)).result;
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
  exchangeMetadata,
  symbolSearch,
  secretService,
  eventBus,
  env = process.env,
  fetch: fetchImpl = fetch,
}: LocalConnectServiceDependencies): ConnectService {
  const disabledService = createDisabledConnectService();
  let restorePromise: Promise<{ accessToken: string; refreshToken: string }> | null = null;
  let sessionGeneration = 0;
  const restoreSession = async () => {
    if (!secretService) {
      throw cloudSyncDisabled();
    }
    restorePromise ??= restoreLocalSyncSession(
      secretService,
      env,
      fetchImpl,
      () => sessionGeneration,
    ).finally(() => {
      restorePromise = null;
    });
    return await restorePromise;
  };
  return {
    ...disabledService,
    async storeSyncSession(refreshToken) {
      if (!secretService) {
        throw cloudSyncDisabled();
      }
      sessionGeneration += 1;
      await secretService.setSecret(CLOUD_REFRESH_TOKEN_KEY, refreshToken);
      await secretService.deleteSecret(CLOUD_ACCESS_TOKEN_KEY);
    },
    async clearSyncSession() {
      if (!secretService) {
        throw cloudSyncDisabled();
      }
      sessionGeneration += 1;
      await secretService.deleteSecret(CLOUD_REFRESH_TOKEN_KEY);
      await secretService.deleteSecret(CLOUD_ACCESS_TOKEN_KEY);
      clearAllDeviceSyncFreshnessGates(db);
    },
    async getSyncSessionStatus() {
      if (!secretService) {
        throw cloudSyncDisabled();
      }
      return { isConfigured: (await secretService.getSecret(CLOUD_REFRESH_TOKEN_KEY)) !== null };
    },
    async restoreSyncSession() {
      return await restoreSession();
    },
    async getSubscriptionPlansPublic() {
      return await fetchPublicSubscriptionPlans(env, fetchImpl);
    },
    async getSubscriptionPlans() {
      const response = await fetchAuthenticatedConnectJsonRaw(
        restoreSession,
        env,
        fetchImpl,
        "/api/v1/subscription/plans",
      );
      return plansResponseFromApi(response.value, response.bodyText);
    },
    async getUserInfo() {
      const response = await fetchAuthenticatedConnectJsonRaw(
        restoreSession,
        env,
        fetchImpl,
        "/api/v1/user/me",
      );
      return userInfoFromApi(response.value, response.bodyText);
    },
    async listBrokerConnections() {
      const response = await fetchAuthenticatedConnectJsonRaw(
        restoreSession,
        env,
        fetchImpl,
        "/api/v1/sync/brokerage/connections",
      );
      return brokerConnectionsFromApi(response.value, response.bodyText);
    },
    async listBrokerAccounts() {
      const response = await fetchAuthenticatedConnectJsonRaw(
        restoreSession,
        env,
        fetchImpl,
        "/api/v1/sync/brokerage/accounts",
      );
      return brokerAccountsFromApi(response.value, response.bodyText);
    },
    async syncBrokerData() {
      try {
        if (!(await hasBrokerSyncEntitlement(restoreSession, env, fetchImpl))) {
          return { status: "forbidden" };
        }
      } catch {
        return { status: "forbidden" };
      }
      eventBus?.publish({ name: BROKER_SYNC_START });
      try {
        const { result, eventPayload } = await syncBrokerDataBounded(this);
        if (eventPayload.success) {
          eventBus?.publish({
            name: BROKER_SYNC_COMPLETE,
            payload: eventPayload,
          });
        } else {
          eventBus?.publish({
            name: BROKER_SYNC_ERROR,
            payload: { error: eventPayload.message },
          });
        }
        return result;
      } catch (error) {
        const message = errorMessage(error);
        eventBus?.publish({
          name: BROKER_SYNC_ERROR,
          payload: { error: message },
        });
        throw error;
      }
    },
    async syncBrokerConnections() {
      const response = await fetchAuthenticatedConnectJsonRaw(
        restoreSession,
        env,
        fetchImpl,
        "/api/v1/sync/brokerage/connections",
      );
      const connections = brokerConnectionsFromApi(response.value, response.bodyText);
      return syncBrokerConnectionsToPlatforms(db, connections);
    },
    async syncBrokerAccounts() {
      const response = await fetchAuthenticatedConnectJsonRaw(
        restoreSession,
        env,
        fetchImpl,
        "/api/v1/sync/brokerage/accounts",
      );
      const accounts = brokerAccountsFromApi(response.value, response.bodyText);
      return await syncBrokerAccountsToLocal(db, accountService, accounts);
    },
    async syncBrokerActivities() {
      return syncBrokerActivitiesForHoldingsOnly(
        accountService,
        activityService,
        db,
        restoreSession,
        env,
        fetchImpl,
        exchangeMetadata,
        symbolSearch,
      );
    },
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
      return await activityService.getBrokerSyncProfile(accountId, sourceSystem);
    },
    async saveBrokerSyncProfileRules(request) {
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
  validateConnectImportRunsPagination(request);
  const params: Array<string | number> = [];
  const runType = request.runType;
  const hasRunTypeFilter = runType !== undefined;
  const whereSql = hasRunTypeFilter ? "WHERE run_type = ?" : "";
  if (hasRunTypeFilter) {
    params.push(runType);
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

function validateConnectImportRunsPagination(request: ConnectImportRunsRequest): void {
  if (request.runType !== undefined && request.runType !== "SYNC" && request.runType !== "IMPORT") {
    throw new ConnectServiceError("bad_request", "import run type must be SYNC or IMPORT", 400);
  }
  if (!Number.isSafeInteger(request.limit) || !Number.isSafeInteger(request.offset)) {
    throw new ConnectServiceError(
      "bad_request",
      "import run pagination values must be safe integers",
      400,
    );
  }
  if (request.limit <= 0) {
    throw new ConnectServiceError(
      "bad_request",
      "import run pagination limit must be greater than 0",
      400,
    );
  }
  if (request.offset < 0) {
    throw new ConnectServiceError(
      "bad_request",
      "import run pagination offset must be greater than or equal to 0",
      400,
    );
  }
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

async function restoreLocalSyncSession(
  secretService: SecretService,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  sessionGeneration: () => number,
): Promise<{ accessToken: string; refreshToken: string }> {
  const startedAtGeneration = sessionGeneration();
  const refreshToken = await secretService.getSecret(CLOUD_REFRESH_TOKEN_KEY);
  if (!refreshToken) {
    throw new ConnectServiceError("forbidden", "No sync session configured", 403);
  }

  const authUrl = normalizeConnectAuthUrl(env.CONNECT_AUTH_URL);
  const publishableKey = normalizeConnectPublishableKey(env.CONNECT_AUTH_PUBLISHABLE_KEY);
  const tokenUrl = `${authUrl}/auth/v1/token?grant_type=refresh_token`;
  let response: Response;
  try {
    response = await fetchImpl(tokenUrl, {
      method: "POST",
      headers: {
        apikey: publishableKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  } catch (error) {
    throw new ConnectServiceError(
      "internal_error",
      `Failed to refresh token: ${errorMessage(error)}`,
      500,
    );
  }

  let bodyText: string;
  try {
    bodyText = await response.text();
  } catch (error) {
    throw new ConnectServiceError(
      "internal_error",
      `Failed to read token response: ${errorMessage(error)}`,
      500,
    );
  }

  if (!response.ok) {
    const refreshError = parseRefreshError(response.status, bodyText);
    if (isSessionInvalid(response.status, refreshError.message, refreshError.code)) {
      await secretService.deleteSecret(CLOUD_ACCESS_TOKEN_KEY);
      if (
        sessionGeneration() === startedAtGeneration &&
        (await secretService.getSecret(CLOUD_REFRESH_TOKEN_KEY)) === refreshToken
      ) {
        await secretService.deleteSecret(CLOUD_REFRESH_TOKEN_KEY);
      }
      throw new ConnectServiceError(
        "forbidden",
        `Session expired. Please sign in again. (${refreshError.message})`,
        403,
      );
    }
    throw new ConnectServiceError("internal_error", refreshError.message, 500);
  }

  const payload = parseRefreshTokenResponse(bodyText);
  const rotatedRefreshToken = payload.refreshToken || refreshToken;
  if (
    sessionGeneration() !== startedAtGeneration ||
    (await secretService.getSecret(CLOUD_REFRESH_TOKEN_KEY)) !== refreshToken
  ) {
    throw new ConnectServiceError("forbidden", "Sync session changed during token refresh", 403);
  }
  await secretService.setSecret(CLOUD_REFRESH_TOKEN_KEY, rotatedRefreshToken);
  await secretService.deleteSecret(CLOUD_ACCESS_TOKEN_KEY);
  return { accessToken: payload.accessToken, refreshToken: rotatedRefreshToken };
}

async function fetchPublicSubscriptionPlans(
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const baseUrl = normalizeConnectApiUrl(env.CONNECT_API_URL);
  const url = `${baseUrl}/api/v1/subscription/plans`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: connectRequestHeaders(),
    });
  } catch (error) {
    throw new ConnectServiceError("internal_error", `Request failed: ${errorMessage(error)}`, 500);
  }

  let bodyText: string;
  try {
    bodyText = await response.text();
  } catch (error) {
    throw new ConnectServiceError(
      "internal_error",
      `Failed to read response: ${errorMessage(error)}`,
      500,
    );
  }
  if (!response.ok) {
    throw new ConnectServiceError("internal_error", `API error ${response.status}`, 500);
  }
  try {
    const parsed = JSON.parse(bodyText) as unknown;
    return plansResponseFromApi(parsed, bodyText);
  } catch (error) {
    if (error instanceof ConnectServiceError) {
      throw error;
    }
    throw new ConnectServiceError(
      "internal_error",
      `Failed to parse plans response: ${errorMessage(error)}`,
      500,
    );
  }
}

async function fetchAuthenticatedConnectJsonRaw(
  restoreSession: () => Promise<{ accessToken: string; refreshToken: string }>,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  path: string,
): Promise<{ value: unknown; bodyText: string }> {
  const { accessToken } = await restoreSession();
  return await fetchConnectJsonWithAccessTokenRaw(accessToken, env, fetchImpl, path);
}

async function fetchConnectJsonWithAccessTokenRaw(
  accessToken: string,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  path: string,
): Promise<{ value: unknown; bodyText: string }> {
  const baseUrl = normalizeConnectApiUrl(env.CONNECT_API_URL);
  const url = `${baseUrl}${path}`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...connectRequestHeaders(),
      },
    });
  } catch (error) {
    throw new ConnectServiceError("internal_error", `Request failed: ${errorMessage(error)}`, 500);
  }

  let bodyText: string;
  try {
    bodyText = await response.text();
  } catch (error) {
    throw new ConnectServiceError(
      "internal_error",
      `Failed to read response: ${errorMessage(error)}`,
      500,
    );
  }
  if (!response.ok) {
    throw new ConnectServiceError(
      "internal_error",
      connectApiErrorMessage(response.status, bodyText),
      500,
    );
  }
  try {
    return { value: JSON.parse(bodyText) as unknown, bodyText };
  } catch (error) {
    throw new ConnectServiceError(
      "internal_error",
      `Failed to parse response: ${errorMessage(error)}`,
      500,
    );
  }
}

function plansResponseFromApi(value: unknown, rawJson: string | null = null): unknown {
  if (rawJson !== null) {
    assertPlansResponseRawShape(rawJson);
  }
  if (!isRecord(value) || !Array.isArray(value.plans)) {
    throw new ConnectServiceError("internal_error", "Failed to parse plans response", 500);
  }
  return { plans: value.plans.map(subscriptionPlanFromApi) };
}

function subscriptionPlanFromApi(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ConnectServiceError("internal_error", "Failed to parse plans response", 500);
  }
  const pricing = value.pricing;
  const limits = value.limits;
  if (!isRecord(pricing) || !isRecord(limits)) {
    throw new ConnectServiceError("internal_error", "Failed to parse plans response", 500);
  }
  assertOptionalConnectStringField(value, "tagline", "plans response");
  assertDefaultConnectBooleanField(value, "isAvailable", "plans response");
  assertDefaultConnectBooleanField(value, "isComingSoon", "plans response");
  assertOptionalConnectStringField(value, "badge", "plans response");
  assertOptionalConnectNumberField(value, "yearlyDiscountPercent", "plans response");
  assertOptionalConnectNumberField(pricing, "yearlyPerMonth", "plans response");
  const features = value.features;
  const featuresExtended = value.featuresExtended;
  if (features !== undefined && (!Array.isArray(features) || !features.every(isStringValue))) {
    throw new ConnectServiceError("internal_error", "Failed to parse plans response", 500);
  }
  if (
    featuresExtended !== undefined &&
    featuresExtended !== null &&
    (!Array.isArray(featuresExtended) || !featuresExtended.every(isStringValue))
  ) {
    throw new ConnectServiceError("internal_error", "Failed to parse plans response", 500);
  }
  return {
    id: requiredStringValue(value.id, "plans response"),
    name: requiredStringValue(value.name, "plans response"),
    tagline: optionalString(value.tagline),
    description: requiredStringValue(value.description, "plans response"),
    pricing: {
      monthly: requiredFiniteNumber(pricing.monthly, "plans response"),
      yearly: requiredFiniteNumber(pricing.yearly, "plans response"),
      yearlyPerMonth:
        valueOrNull(pricing.yearlyPerMonth) === null
          ? null
          : requiredFiniteNumber(pricing.yearlyPerMonth, "plans response"),
    },
    limits: {
      householdSize: requiredI32Value(limits.householdSize, "plans response"),
      institutionConnections: planLimitValueFromApi(limits.institutionConnections),
      devices: requiredI32Value(limits.devices, "plans response"),
    },
    features: features ?? [],
    featuresExtended: featuresExtended ?? null,
    isAvailable: optionalBoolean(value.isAvailable) ?? false,
    isComingSoon: optionalBoolean(value.isComingSoon) ?? false,
    badge: optionalString(value.badge),
    yearlyDiscountPercent:
      valueOrNull(value.yearlyDiscountPercent) === null
        ? null
        : requiredI32Value(value.yearlyDiscountPercent, "plans response"),
  };
}

function planLimitValueFromApi(value: unknown): number | string {
  if (typeof value === "string") {
    return value;
  }
  return requiredI32Value(value, "plans response");
}

function assertPlansResponseRawShape(rawJson: string): void {
  const plansTokens = rawTokensForAliases(rawJson, ["plans"]);
  if (plansTokens.length > 1) {
    throw new ConnectServiceError("internal_error", "Failed to parse plans response", 500);
  }
  const plansToken = plansTokens[0];
  if (plansToken === undefined || !plansToken.trim().startsWith("[")) {
    return;
  }
  for (const planToken of topLevelJsonArrayElementTokens(plansToken)) {
    if (planToken.trim().startsWith("{")) {
      assertSubscriptionPlanRawShape(planToken);
    }
  }
}

function assertSubscriptionPlanRawShape(rawJson: string): void {
  assertNoDuplicateConnectAliases(
    rawJson,
    [
      ["id"],
      ["name"],
      ["tagline"],
      ["description"],
      ["pricing"],
      ["limits"],
      ["features"],
      ["featuresExtended"],
      ["isAvailable"],
      ["isComingSoon"],
      ["badge"],
      ["yearlyDiscountPercent"],
    ],
    "plans response",
  );
  const pricingTokens = rawTokensForAliases(rawJson, ["pricing"]);
  const limitsTokens = rawTokensForAliases(rawJson, ["limits"]);
  const yearlyDiscountPercentTokens = rawTokensForAliases(rawJson, ["yearlyDiscountPercent"]);
  if (
    yearlyDiscountPercentTokens.length === 1 &&
    !rawJsonI32OptionTokenIsValid(yearlyDiscountPercentTokens[0] ?? "")
  ) {
    throw new ConnectServiceError("internal_error", "Failed to parse plans response", 500);
  }
  const pricingToken = pricingTokens[0];
  if (pricingToken !== undefined && pricingToken.trim().startsWith("{")) {
    assertSubscriptionPlanPricingRawShape(pricingToken);
  }
  const limitsToken = limitsTokens[0];
  if (limitsToken !== undefined && limitsToken.trim().startsWith("{")) {
    assertSubscriptionPlanLimitsRawShape(limitsToken);
  }
}

function assertSubscriptionPlanPricingRawShape(rawJson: string): void {
  assertNoDuplicateConnectAliases(
    rawJson,
    [["monthly"], ["yearly"], ["yearlyPerMonth"]],
    "plans response",
  );
}

function assertSubscriptionPlanLimitsRawShape(rawJson: string): void {
  for (const field of ["householdSize", "devices"]) {
    const tokens = rawTokensForAliases(rawJson, [field]);
    if (tokens.length > 1 || (tokens.length === 1 && !rawJsonI32TokenIsValid(tokens[0] ?? ""))) {
      throw new ConnectServiceError("internal_error", "Failed to parse plans response", 500);
    }
  }
  const institutionConnectionsTokens = rawTokensForAliases(rawJson, ["institutionConnections"]);
  if (
    institutionConnectionsTokens.length > 1 ||
    (institutionConnectionsTokens.length === 1 &&
      !rawJsonPlanLimitTokenIsValid(institutionConnectionsTokens[0] ?? ""))
  ) {
    throw new ConnectServiceError("internal_error", "Failed to parse plans response", 500);
  }
}

function userInfoFromApi(value: unknown, rawJson: string | null = null): unknown {
  if (!isRecord(value)) {
    throw new ConnectServiceError("internal_error", "No user info returned", 500);
  }
  if (rawJson !== null) {
    assertUserInfoRawShape(rawJson);
  }
  validateUserInfoFromApi(value);
  const team = isRecord(value.team) ? value.team : null;
  return {
    id: requiredStringValue(value.id, "user info"),
    full_name: optionalString(value.fullName),
    email: optionalString(value.email),
    avatar_url: optionalString(value.avatarUrl),
    locale: optionalString(value.locale),
    week_starts_on_monday: optionalBoolean(value.weekStartsOnMonday),
    timezone: optionalString(value.timezone),
    timezone_auto_sync: optionalBoolean(value.timezoneAutoSync),
    time_format:
      value.timeFormat === undefined || value.timeFormat === null
        ? null
        : requiredI32Value(value.timeFormat, "user info"),
    date_format: optionalString(value.dateFormat),
    team_id: optionalString(value.teamId),
    team_role: optionalString(value.teamRole),
    team: team
      ? {
          id: requiredStringValue(team.id, "team info"),
          name: optionalString(team.name) ?? "",
          logo_url: optionalString(team.logoUrl),
          plan: optionalString(team.plan),
          subscription_status: optionalString(team.subscriptionStatus),
          subscription_current_period_end: optionalString(team.subscriptionCurrentPeriodEnd),
          subscription_cancel_at_period_end: optionalBoolean(team.subscriptionCancelAtPeriodEnd),
          canceled_at: optionalString(team.canceledAt),
          country_code: optionalString(team.countryCode),
          created_at: optionalString(team.createdAt),
        }
      : null,
  };
}

function assertUserInfoRawShape(rawJson: string): void {
  assertNoDuplicateConnectAliases(
    rawJson,
    [
      ["id"],
      ["fullName"],
      ["email"],
      ["avatarUrl"],
      ["locale"],
      ["weekStartsOnMonday"],
      ["timezone"],
      ["timezoneAutoSync"],
      ["timeFormat"],
      ["dateFormat"],
      ["teamId"],
      ["teamRole"],
      ["team"],
    ],
    "user info",
  );
  const teamTokens = rawTokensForAliases(rawJson, ["team"]);
  if (teamTokens.length === 1 && teamTokens[0]?.trim().startsWith("{")) {
    assertNoDuplicateConnectAliases(
      teamTokens[0],
      [
        ["id"],
        ["name"],
        ["logoUrl"],
        ["plan"],
        ["subscriptionStatus"],
        ["subscriptionCurrentPeriodEnd"],
        ["subscriptionCancelAtPeriodEnd"],
        ["canceledAt"],
        ["countryCode"],
        ["createdAt"],
      ],
      "team info",
    );
  }
  const timeFormatTokens = rawTokensForAliases(rawJson, ["timeFormat"]);
  if (timeFormatTokens.length === 1 && !rawJsonI32OptionTokenIsValid(timeFormatTokens[0] ?? "")) {
    throw new ConnectServiceError("internal_error", "Failed to parse user info", 500);
  }
}

function assertNoDuplicateConnectAliases(
  rawJson: string,
  aliasGroups: string[][],
  context: string,
): void {
  for (const aliases of aliasGroups) {
    if (rawTokensForAliases(rawJson, aliases).length > 1) {
      throw new ConnectServiceError("internal_error", `Failed to parse ${context}`, 500);
    }
  }
}

async function hasBrokerSyncEntitlement(
  restoreSession: () => Promise<{ accessToken: string; refreshToken: string }>,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  const response = await fetchAuthenticatedConnectJsonRaw(
    restoreSession,
    env,
    fetchImpl,
    "/api/v1/user/me",
  );
  const userInfo = userInfoFromApi(response.value, response.bodyText);
  if (!isRecord(userInfo) || !isRecord(userInfo.team)) {
    return false;
  }
  const subscriptionStatus = optionalString(userInfo.team.subscription_status);
  if (subscriptionStatus !== "active" && subscriptionStatus !== "trialing") {
    return false;
  }
  const plan = optionalString(userInfo.team.plan);
  return plan !== null && plan !== "basic";
}

function validateUserInfoFromApi(value: Record<string, unknown>): void {
  for (const field of [
    "fullName",
    "email",
    "avatarUrl",
    "locale",
    "timezone",
    "dateFormat",
    "teamId",
    "teamRole",
  ]) {
    assertOptionalConnectStringField(value, field, "user info");
  }
  for (const field of ["weekStartsOnMonday", "timezoneAutoSync"]) {
    assertOptionalConnectBooleanField(value, field, "user info");
  }
  assertOptionalConnectI32Field(value, "timeFormat", "user info");

  const team = value.team;
  if (team !== undefined && team !== null && !isRecord(team)) {
    throw new ConnectServiceError("internal_error", "Failed to parse user info", 500);
  }
  if (isRecord(team)) {
    validateUserTeamFromApi(team);
  }
}

function validateUserTeamFromApi(team: Record<string, unknown>): void {
  for (const field of [
    "name",
    "logoUrl",
    "plan",
    "subscriptionStatus",
    "subscriptionCurrentPeriodEnd",
    "canceledAt",
    "countryCode",
    "createdAt",
  ]) {
    assertOptionalConnectStringField(team, field, "team info");
  }
  assertOptionalConnectBooleanField(team, "subscriptionCancelAtPeriodEnd", "team info");
}

function requiredStringValue(value: unknown, context: string): string {
  if (typeof value !== "string") {
    throw new ConnectServiceError("internal_error", `Failed to parse ${context}`, 500);
  }
  return value;
}

function requiredFiniteNumber(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ConnectServiceError("internal_error", `Failed to parse ${context}`, 500);
  }
  return value;
}

function requiredInteger(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ConnectServiceError("internal_error", `Failed to parse ${context}`, 500);
  }
  return value;
}

function isStringValue(value: unknown): value is string {
  return typeof value === "string";
}

function valueOrNull(value: unknown): unknown | null {
  return value === undefined ? null : value;
}

function brokerConnectionsFromApi(value: unknown, rawJson: string | null = null): unknown[] {
  if (!isRecord(value)) {
    throw new ConnectServiceError("internal_error", "Failed to parse connections response", 500);
  }
  if (rawJson !== null) {
    assertBrokerConnectionsRawShape(rawJson);
  }
  if (value.connections === undefined) {
    return [];
  }
  if (!Array.isArray(value.connections)) {
    throw new ConnectServiceError("internal_error", "Failed to parse connections response", 500);
  }
  return value.connections.map(brokerConnectionFromApi);
}

function assertBrokerConnectionsRawShape(rawJson: string): void {
  assertNoDuplicateConnectAliases(rawJson, [["connections"]], "connections response");
  const connectionTokens = rawTokensForAliases(rawJson, ["connections"]);
  if (connectionTokens.length !== 1 || !connectionTokens[0]?.trim().startsWith("[")) {
    return;
  }
  for (const connectionToken of topLevelArrayValueTokens(connectionTokens[0])) {
    if (!connectionToken.startsWith("{")) {
      continue;
    }
    assertNoDuplicateConnectAliases(
      connectionToken,
      [
        ["id"],
        ["authorization_id"],
        ["brokerage_name"],
        ["brokerage_slug"],
        ["brokerage"],
        ["disabled"],
        ["updated_at"],
        ["name"],
        ["status"],
      ],
      "connection response",
    );
    const brokerageTokens = rawTokensForAliases(connectionToken, ["brokerage"]);
    if (
      brokerageTokens.length === 1 &&
      !brokerActivityOptionalObjectRawTokenIsValid(connectionToken, ["brokerage"])
    ) {
      throw new ConnectServiceError("internal_error", "Failed to parse connection response", 500);
    }
    if (brokerageTokens.length === 1 && brokerageTokens[0]?.trim().startsWith("{")) {
      assertNoDuplicateConnectAliases(
        brokerageTokens[0],
        [
          ["id"],
          ["slug"],
          ["name"],
          ["display_name"],
          ["aws_s3_logo_url"],
          ["aws_s3_square_logo_url"],
        ],
        "brokerage response",
      );
    }
  }
}

function brokerConnectionFromApi(value: unknown): unknown {
  if (!isRecord(value)) {
    throw new ConnectServiceError("internal_error", "Failed to parse connection response", 500);
  }
  validateBrokerConnectionFromApi(value);
  const brokerage = brokerageFromApi(value);
  const id = requiredStringValue(value.id, "connection response");
  return {
    id: optionalString(value.authorization_id) ?? id,
    brokerage,
    type: null,
    status: optionalString(value.status),
    disabled: optionalBoolean(value.disabled) ?? false,
    disabled_date: null,
    updated_at: optionalString(value.updated_at),
    name: optionalString(value.name),
  };
}

function validateBrokerConnectionFromApi(value: Record<string, unknown>): void {
  for (const field of ["authorization_id", "status", "updated_at", "name"]) {
    assertOptionalConnectStringField(value, field, "connection response");
  }
  assertOptionalConnectBooleanField(value, "disabled", "connection response");
  assertOptionalConnectObjectField(value, "brokerage", "connection response");
}

function brokerageFromApi(value: Record<string, unknown>): unknown | null {
  const nested = isRecord(value.brokerage) ? value.brokerage : null;
  if (nested) {
    validateBrokerageFromApi(nested);
    const name = optionalString(nested.name);
    return {
      id: optionalString(nested.id),
      slug: optionalString(nested.slug),
      name,
      display_name: optionalString(nested.display_name) ?? name,
      aws_s3_logo_url: optionalString(nested.aws_s3_logo_url),
      aws_s3_square_logo_url: optionalString(nested.aws_s3_square_logo_url),
    };
  }
  assertOptionalConnectStringField(value, "brokerage_name", "connection response");
  assertOptionalConnectStringField(value, "brokerage_slug", "connection response");
  const brokerageName = optionalString(value.brokerage_name);
  const brokerageSlug = optionalString(value.brokerage_slug);
  if (brokerageName !== null || brokerageSlug !== null) {
    return {
      id: null,
      slug: brokerageSlug,
      name: brokerageName,
      display_name: brokerageName,
      aws_s3_logo_url: null,
      aws_s3_square_logo_url: null,
    };
  }
  return null;
}

function validateBrokerageFromApi(brokerage: Record<string, unknown>): void {
  for (const field of [
    "id",
    "slug",
    "name",
    "display_name",
    "aws_s3_logo_url",
    "aws_s3_square_logo_url",
  ]) {
    assertOptionalConnectStringField(brokerage, field, "brokerage response");
  }
}

function brokerAccountsFromApi(value: unknown, rawJson: string | null = null): unknown[] {
  if (!isRecord(value)) {
    throw new ConnectServiceError("internal_error", "Failed to parse accounts response", 500);
  }
  if (rawJson !== null) {
    assertBrokerAccountsRawShape(rawJson);
  }
  if (value.accounts === undefined) {
    return [];
  }
  if (!Array.isArray(value.accounts)) {
    throw new ConnectServiceError("internal_error", "Failed to parse accounts response", 500);
  }
  if (!value.accounts.every(isRecord)) {
    throw new ConnectServiceError("internal_error", "Failed to parse accounts response", 500);
  }
  for (const account of value.accounts) {
    validateBrokerAccountFromApi(account);
  }
  return value.accounts;
}

function assertBrokerAccountsRawShape(rawJson: string): void {
  assertNoDuplicateConnectAliases(rawJson, [["accounts"]], "accounts response");
  const accountTokens = rawTokensForAliases(rawJson, ["accounts"]);
  if (accountTokens.length !== 1 || !accountTokens[0]?.trim().startsWith("[")) {
    return;
  }
  for (const accountToken of topLevelArrayValueTokens(accountTokens[0])) {
    if (!accountToken.startsWith("{")) {
      continue;
    }
    assertNoDuplicateConnectAliases(
      accountToken,
      [
        ["id"],
        ["name"],
        ["account_number", "number"],
        ["type"],
        ["currency"],
        ["balance"],
        ["meta"],
        ["owner"],
        ["brokerage_authorization"],
        ["institution_name"],
        ["created_date"],
        ["sync_status"],
        ["status"],
        ["raw_type"],
        ["is_paper"],
        ["sync_enabled"],
        ["shared_with_household"],
      ],
      "accounts response",
    );
    assertBrokerAccountNestedRawShape(accountToken);
  }
}

function assertBrokerAccountNestedRawShape(accountToken: string): void {
  const balanceTokens = rawTokensForAliases(accountToken, ["balance"]);
  if (balanceTokens.length === 1 && balanceTokens[0]?.trim().startsWith("{")) {
    assertNoDuplicateConnectAliases(balanceTokens[0], [["total"]], "accounts response");
    const totalTokens = rawTokensForAliases(balanceTokens[0], ["total"]);
    if (totalTokens.length === 1 && totalTokens[0]?.trim().startsWith("{")) {
      assertNoDuplicateConnectAliases(
        totalTokens[0],
        [["amount"], ["currency"]],
        "accounts response",
      );
    }
  }
  const ownerTokens = rawTokensForAliases(accountToken, ["owner"]);
  if (ownerTokens.length === 1 && ownerTokens[0]?.trim().startsWith("{")) {
    assertNoDuplicateConnectAliases(
      ownerTokens[0],
      [["user_id"], ["full_name", "user_full_name"], ["email"], ["avatar_url"], ["is_own_account"]],
      "accounts response",
    );
  }
  const syncStatusTokens = rawTokensForAliases(accountToken, ["sync_status"]);
  if (syncStatusTokens.length === 1 && syncStatusTokens[0]?.trim().startsWith("{")) {
    assertNoDuplicateConnectAliases(
      syncStatusTokens[0],
      [["transactions"], ["holdings"]],
      "accounts response",
    );
    for (const detailKey of ["transactions", "holdings"]) {
      const detailTokens = rawTokensForAliases(syncStatusTokens[0], [detailKey]);
      if (detailTokens.length === 1 && detailTokens[0]?.trim().startsWith("{")) {
        assertNoDuplicateConnectAliases(
          detailTokens[0],
          [["initial_sync_completed"], ["last_successful_sync"], ["first_transaction_date"]],
          "accounts response",
        );
      }
    }
  }
}

function validateBrokerAccountFromApi(account: Record<string, unknown>): void {
  for (const field of [
    "id",
    "name",
    "account_number",
    "number",
    "type",
    "currency",
    "brokerage_authorization",
    "institution_name",
    "created_date",
    "status",
    "raw_type",
  ]) {
    assertOptionalConnectStringField(account, field, "accounts response");
  }
  for (const field of ["is_paper", "sync_enabled", "shared_with_household"]) {
    assertDefaultConnectBooleanField(account, field, "accounts response");
  }
  validateBrokerAccountBalance(account.balance);
  validateBrokerAccountOwner(account.owner);
  validateBrokerAccountSyncStatus(account.sync_status);
}

function validateBrokerAccountBalance(value: unknown): void {
  if (value === undefined || value === null) {
    return;
  }
  if (!isRecord(value)) {
    throw new ConnectServiceError("internal_error", "Failed to parse accounts response", 500);
  }
  const total = value.total;
  if (total === undefined || total === null) {
    return;
  }
  if (!isRecord(total)) {
    throw new ConnectServiceError("internal_error", "Failed to parse accounts response", 500);
  }
  assertOptionalConnectNumberField(total, "amount", "accounts response");
  assertOptionalConnectStringField(total, "currency", "accounts response");
}

function validateBrokerAccountOwner(value: unknown): void {
  if (value === undefined || value === null) {
    return;
  }
  if (!isRecord(value)) {
    throw new ConnectServiceError("internal_error", "Failed to parse accounts response", 500);
  }
  for (const field of ["user_id", "full_name", "user_full_name", "email", "avatar_url"]) {
    assertOptionalConnectStringField(value, field, "accounts response");
  }
  assertDefaultConnectBooleanField(value, "is_own_account", "accounts response");
}

function validateBrokerAccountSyncStatus(value: unknown): void {
  if (value === undefined || value === null) {
    return;
  }
  if (!isRecord(value)) {
    throw new ConnectServiceError("internal_error", "Failed to parse accounts response", 500);
  }
  validateBrokerSyncStatusDetail(value.transactions);
  validateBrokerSyncStatusDetail(value.holdings);
}

function validateBrokerSyncStatusDetail(value: unknown): void {
  if (value === undefined || value === null) {
    return;
  }
  if (!isRecord(value)) {
    throw new ConnectServiceError("internal_error", "Failed to parse accounts response", 500);
  }
  assertOptionalConnectBooleanField(value, "initial_sync_completed", "accounts response");
  assertOptionalConnectStringField(value, "last_successful_sync", "accounts response");
  assertOptionalConnectStringField(value, "first_transaction_date", "accounts response");
}

function syncBrokerConnectionsToPlatforms(
  db: Database,
  connections: unknown[],
): { synced: number; platformsCreated: number; platformsUpdated: number } {
  let platformsCreated = 0;
  let platformsUpdated = 0;

  db.transaction(() => {
    for (const connection of connections) {
      if (!isRecord(connection) || !isRecord(connection.brokerage)) {
        continue;
      }
      const brokerage = connection.brokerage;
      const platformId = optionalString(brokerage.slug) ?? optionalString(brokerage.id) ?? "";
      if (!platformId) {
        continue;
      }
      const existing = db
        .query<{ id: string }, [string]>("SELECT id FROM platforms WHERE id = ?")
        .get(platformId);
      const name = optionalString(brokerage.display_name) ?? optionalString(brokerage.name);
      const url = `https://${platformId.toLowerCase().replaceAll("_", "")}.com`;
      const externalId = optionalString(brokerage.id);
      const logoUrl =
        optionalString(brokerage.aws_s3_square_logo_url) ??
        optionalString(brokerage.aws_s3_logo_url);
      db.prepare(
        `
          INSERT INTO platforms (id, name, url, external_id, kind, website_url, logo_url)
          VALUES (?, ?, ?, ?, 'BROKERAGE', NULL, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            url = excluded.url,
            external_id = excluded.external_id,
            kind = excluded.kind,
            website_url = excluded.website_url,
            logo_url = excluded.logo_url
        `,
      ).run(platformId, name, url, externalId, logoUrl);
      if (existing) {
        platformsUpdated += 1;
      } else {
        platformsCreated += 1;
      }
    }
  })();

  return { synced: connections.length, platformsCreated, platformsUpdated };
}

async function syncBrokerAccountsToLocal(
  db: Database,
  accountService: Pick<AccountService, "createAccount" | "getAllAccounts" | "getBaseCurrency">,
  brokerAccounts: unknown[],
): Promise<{
  synced: number;
  created: number;
  updated: number;
  skipped: number;
  createdAccounts: Array<[string, string]>;
  newAccountsInfo: Array<{
    localAccountId: string;
    providerAccountId: string;
    defaultName: string;
    currency: string;
    institutionName: string | null;
  }>;
}> {
  let created = 0;
  let skipped = 0;
  const createdAccounts: Array<[string, string]> = [];
  const newAccountsInfo: Array<{
    localAccountId: string;
    providerAccountId: string;
    defaultName: string;
    currency: string;
    institutionName: string | null;
  }> = [];
  const existingProviderAccountIds = new Set(
    accountService
      .getAllAccounts()
      .map((account) => account.providerAccountId)
      .filter((id): id is string => id !== null && id.trim() !== ""),
  );

  for (const brokerAccount of brokerAccounts) {
    if (!isRecord(brokerAccount)) {
      skipped += 1;
      continue;
    }
    const providerAccountId = optionalString(brokerAccount.id);
    if (!providerAccountId) {
      skipped += 1;
      continue;
    }
    if (existingProviderAccountIds.has(providerAccountId)) {
      skipped += 1;
      continue;
    }

    const defaultName = brokerAccountDisplayName(brokerAccount);
    const currency = brokerAccountCurrency(brokerAccount, accountService.getBaseCurrency());
    const account = await accountService.createAccount({
      name: defaultName,
      accountType: brokerAccountType(brokerAccount),
      group: null,
      currency,
      isDefault: false,
      isActive: optionalString(brokerAccount.status) !== "closed",
      isArchived: false,
      trackingMode: "HOLDINGS",
      platformId: findPlatformForBrokerAccount(db, brokerAccount),
      accountNumber: optionalString(brokerAccount.account_number ?? brokerAccount.number),
      meta: JSON.stringify(brokerAccountMeta(brokerAccount)),
      provider: "SNAPTRADE",
      providerAccountId,
    });
    existingProviderAccountIds.add(providerAccountId);
    createdAccounts.push([account.id, account.currency]);
    newAccountsInfo.push({
      localAccountId: account.id,
      providerAccountId,
      defaultName,
      currency: account.currency,
      institutionName: optionalString(brokerAccount.institution_name),
    });
    created += 1;
  }

  return {
    synced: brokerAccounts.length,
    created,
    updated: 0,
    skipped,
    createdAccounts,
    newAccountsInfo,
  };
}

function syncBrokerActivitiesForHoldingsOnly(
  accountService: Pick<AccountService, "getAllAccounts" | "getBaseCurrency">,
  activityService: LocalConnectServiceDependencies["activityService"],
  db?: Database,
  restoreSession?: () => Promise<{ accessToken: string; refreshToken: string }>,
  env?: NodeJS.ProcessEnv,
  fetchImpl?: typeof fetch,
  exchangeMetadata?: Pick<ExchangeMetadata, "yahooSuffixToMic">,
  symbolSearch?: LocalConnectServiceDependencies["symbolSearch"],
):
  | Promise<{
      accountsSynced: number;
      activitiesUpserted: number;
      assetsInserted: number;
      accountsFailed: number;
      accountsWarned: number;
      newAssetIds: string[];
    }>
  | {
      accountsSynced: number;
      activitiesUpserted: number;
      assetsInserted: number;
      accountsFailed: number;
      accountsWarned: number;
      newAssetIds: string[];
    } {
  const transactionAccounts = accountService
    .getAllAccounts()
    .filter(
      (account) => account.providerAccountId !== null && account.trackingMode === "TRANSACTIONS",
    );
  if (transactionAccounts.length > 0 && (!db || !restoreSession || !env || !fetchImpl)) {
    throw connectSyncDisabled();
  }
  if (transactionAccounts.length > 0) {
    return syncEmptyTransactionActivityPages(
      db!,
      activityService,
      restoreSession!,
      env!,
      fetchImpl!,
      transactionAccounts,
      accountService.getBaseCurrency() ?? "USD",
      exchangeMetadata,
      symbolSearch,
    );
  }
  return {
    accountsSynced: 0,
    activitiesUpserted: 0,
    assetsInserted: 0,
    accountsFailed: 0,
    accountsWarned: 0,
    newAssetIds: [],
  };
}

async function syncEmptyTransactionActivityPages(
  db: Database,
  activityService: LocalConnectServiceDependencies["activityService"],
  restoreSession: () => Promise<{ accessToken: string; refreshToken: string }>,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  accounts: ReturnType<AccountService["getAllAccounts"]>,
  baseCurrency: string,
  exchangeMetadata: Pick<ExchangeMetadata, "yahooSuffixToMic"> | undefined,
  symbolSearch: LocalConnectServiceDependencies["symbolSearch"] | undefined,
): Promise<{
  accountsSynced: number;
  activitiesUpserted: number;
  assetsInserted: number;
  accountsFailed: number;
  accountsWarned: number;
  newAssetIds: string[];
}> {
  const summary = {
    accountsSynced: 0,
    activitiesUpserted: 0,
    assetsInserted: 0,
    accountsFailed: 0,
    accountsWarned: 0,
    newAssetIds: [] as string[],
  };
  const providerSearchCache = new Map<string, Promise<SymbolSearchResult[]>>();
  const endDate = dateOnly(new Date());
  const pageLimit = 1000;
  for (const account of accounts) {
    if (!account.providerAccountId) {
      continue;
    }
    upsertBrokerSyncAttempt(db, account.id);
    const { accessToken } = await restoreSession();
    const startDate = brokerActivitySyncStartDate(db, account.id, endDate);
    let offset = 0;
    let accountFailed = false;
    let pagesFetched = 0;
    let lastPageFirstId: string | null = null;
    for (;;) {
      if (pagesFetched >= BROKER_ACTIVITY_MAX_PAGES) {
        const message = `Pagination exceeded max pages (${BROKER_ACTIVITY_MAX_PAGES}). Aborting.`;
        upsertBrokerSyncFailure(db, account.id, message);
        summary.accountsFailed += 1;
        accountFailed = true;
        break;
      }
      const path = brokerActivitiesPath(
        account.providerAccountId,
        startDate,
        endDate,
        offset,
        pageLimit,
      );
      let pageResponse: { value: unknown; bodyText: string };
      try {
        pageResponse = await fetchConnectJsonWithAccessTokenRaw(accessToken, env, fetchImpl, path);
      } catch (error) {
        const message = errorMessage(error);
        upsertBrokerSyncFailure(db, account.id, message);
        summary.accountsFailed += 1;
        accountFailed = true;
        break;
      }
      if (!validBrokerActivityPageShape(pageResponse.value, pageResponse.bodyText)) {
        const message = "Failed to parse broker activity page response";
        upsertBrokerSyncFailure(db, account.id, message);
        summary.accountsFailed += 1;
        accountFailed = true;
        break;
      }
      const page = pageResponse.value;
      const data = brokerActivityPageData(page);
      pagesFetched += 1;
      const received = data.length;
      if (received === 0) {
        break;
      }
      const cashActivityCreates: Record<string, unknown>[] = [];
      let hasUnsupportedMappableActivity = false;
      for (const activity of data) {
        if (!hasBrokerActivityMappableId(activity)) {
          continue;
        }
        const createInput =
          brokerCashActivityCreateInput(activity, account.id, account.currency, baseCurrency) ??
          brokerExistingAssetActivityCreateInput(
            db,
            activity,
            account.id,
            account.currency,
            baseCurrency,
            exchangeMetadata,
          ) ??
          (await brokerProviderAssetActivityCreateInput(
            activity,
            account.id,
            account.currency,
            baseCurrency,
            exchangeMetadata,
            symbolSearch,
            providerSearchCache,
          )) ??
          brokerUnresolvedAssetActivityCreateInput(
            activity,
            account.id,
            account.currency,
            baseCurrency,
            exchangeMetadata,
          );
        if (createInput === null) {
          hasUnsupportedMappableActivity = true;
        } else if (!brokerActivityAlreadyImported(db, activity, createInput)) {
          cashActivityCreates.push(createInput);
        }
      }
      if (hasUnsupportedMappableActivity) {
        const message = "Broker activity mapping is not available in this build.";
        upsertBrokerSyncFailure(db, account.id, message);
        throw new ConnectNotImplementedError(message);
      }
      if (cashActivityCreates.length > 0) {
        if (!activityService.bulkMutateActivities) {
          throw connectSyncDisabled();
        }
        const newCashActivityCreates = await filterExistingBrokerCashActivities(
          activityService,
          cashActivityCreates,
        );
        if (newCashActivityCreates.length === 0) {
          const firstId = brokerActivityFirstId(data);
          if (firstId !== null) {
            if (offset > 0 && lastPageFirstId === firstId) {
              const message =
                "Pagination appears stuck (same first activity id returned for multiple pages).";
              upsertBrokerSyncFailure(db, account.id, message);
              summary.accountsFailed += 1;
              accountFailed = true;
              break;
            }
            lastPageFirstId = firstId;
          }
          offset += received;
          if (!brokerActivityPageHasMore(page, received, offset, pageLimit)) {
            break;
          }
          continue;
        }
        const result = await activityService.bulkMutateActivities({
          creates: newCashActivityCreates,
          updates: [],
          deleteIds: [],
        });
        const errors = bulkMutationErrors(result);
        const nonDuplicateErrors = errors.filter((error) => !bulkMutationDuplicateError(error));
        if (nonDuplicateErrors.length > 0) {
          const message = nonDuplicateErrors[0]?.message ?? "Broker activity import failed";
          upsertBrokerSyncFailure(db, account.id, message);
          summary.accountsFailed += 1;
          accountFailed = true;
          break;
        }
        summary.activitiesUpserted += bulkMutationCreatedCount(result);
        const createdAssetIds = bulkMutationCreatedAssetIds(result);
        summary.assetsInserted += createdAssetIds.length;
        summary.newAssetIds.push(...createdAssetIds);
      }
      const firstId = brokerActivityFirstId(data);
      if (firstId !== null) {
        if (offset > 0 && lastPageFirstId === firstId) {
          const message =
            "Pagination appears stuck (same first activity id returned for multiple pages).";
          upsertBrokerSyncFailure(db, account.id, message);
          summary.accountsFailed += 1;
          accountFailed = true;
          break;
        }
        lastPageFirstId = firstId;
      }
      offset += received;
      if (!brokerActivityPageHasMore(page, received, offset, pageLimit)) {
        break;
      }
    }
    if (accountFailed) {
      continue;
    }
    upsertBrokerSyncSuccess(db, account.id);
    summary.accountsSynced += 1;
  }
  return summary;
}

function brokerActivityPageData(page: unknown): unknown[] {
  if (!isRecord(page)) {
    return [];
  }
  for (const key of ["data", "activities", "universalActivities", "universal_activities"]) {
    const value = page[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [];
}

function brokerActivityPageHasMore(
  page: unknown,
  received: number,
  nextOffset: number,
  pageLimit: number,
): boolean {
  const pagination = brokerActivityPagePagination(page);
  if (!pagination) {
    return received >= pageLimit;
  }
  const hasMore = optionalBoolean(pagination.has_more);
  if (hasMore !== null) {
    return hasMore;
  }
  const total = optionalNumber(pagination.total);
  if (total !== null) {
    return nextOffset < total;
  }
  const limit = optionalNumber(pagination.limit);
  if (limit !== null) {
    return received >= limit;
  }
  return received >= pageLimit;
}

function brokerActivityPagePagination(page: unknown): Record<string, unknown> | null {
  if (!isRecord(page)) {
    return null;
  }
  const pagination = page.pagination ?? page.paginationDetails ?? page.page;
  return isRecord(pagination) ? pagination : null;
}

function validBrokerActivityPageShape(value: unknown, rawJson: string): boolean {
  if (!isRecord(value)) {
    return false;
  }
  if (
    rawTokensForAliases(rawJson, [
      "data",
      "activities",
      "universalActivities",
      "universal_activities",
    ]).length > 1 ||
    rawTokensForAliases(rawJson, ["pagination", "paginationDetails", "page"]).length > 1
  ) {
    return false;
  }
  const dataTokens = rawTokensForAliases(rawJson, [
    "data",
    "activities",
    "universalActivities",
    "universal_activities",
  ]);
  if (dataTokens.length === 1) {
    const dataToken = dataTokens[0]?.trim() ?? "";
    if (!dataToken.startsWith("[")) {
      return false;
    }
    for (const activityToken of topLevelArrayValueTokens(dataToken)) {
      if (!activityToken.startsWith("{") || !validBrokerActivityRawShape(activityToken)) {
        return false;
      }
    }
  }
  if (brokerActivityPageData(value).some((activity) => !validBrokerActivityParsedShape(activity))) {
    return false;
  }
  const paginationTokens = rawTokensForAliases(rawJson, [
    "pagination",
    "paginationDetails",
    "page",
  ]);
  if (paginationTokens.length === 1) {
    const paginationToken = paginationTokens[0]?.trim() ?? "";
    if (
      !brokerActivityOptionalObjectRawTokenIsValid(rawJson, [
        "pagination",
        "paginationDetails",
        "page",
      ])
    ) {
      return false;
    }
    if (!paginationToken.startsWith("{")) {
      return true;
    }
    if (
      !(
        rawTokensForAliases(paginationToken, ["has_more"]).length <= 1 &&
        rawTokensForAliases(paginationToken, ["total"]).length <= 1 &&
        rawTokensForAliases(paginationToken, ["limit"]).length <= 1 &&
        rawTokensForAliases(paginationToken, ["offset"]).length <= 1
      )
    ) {
      return false;
    }
    if (
      !brokerActivityPaginationRawTokenIsValid(paginationToken, ["has_more"], "bool") ||
      !brokerActivityPaginationRawTokenIsValid(paginationToken, ["total"], "i64") ||
      !brokerActivityPaginationRawTokenIsValid(paginationToken, ["limit"], "i64") ||
      !brokerActivityPaginationRawTokenIsValid(paginationToken, ["offset"], "i64")
    ) {
      return false;
    }
  }
  const pagination = brokerActivityPagePagination(value);
  if (pagination) {
    const hasMore = pagination.has_more;
    if (hasMore !== undefined && hasMore !== null && typeof hasMore !== "boolean") {
      return false;
    }
    for (const key of ["total", "limit", "offset"]) {
      const entry = pagination[key];
      if (entry !== undefined && entry !== null && !isSafeI64Integer(entry)) {
        return false;
      }
    }
  }
  return true;
}

function validBrokerActivityParsedShape(activity: unknown): boolean {
  if (!isRecord(activity)) {
    return true;
  }
  for (const value of [activity.price, activity.units, activity.amount, activity.fee]) {
    if (value !== undefined && value !== null && !Number.isFinite(value)) {
      return false;
    }
  }
  const fxRate = activity.fx_rate;
  if (fxRate !== undefined && fxRate !== null && !Number.isFinite(fxRate)) {
    return false;
  }
  const needsReview = activity.needs_review;
  if (needsReview !== undefined && typeof needsReview !== "boolean") {
    return false;
  }
  const mappingMetadata = activity.mapping_metadata;
  if (isRecord(mappingMetadata)) {
    const confidence = mappingMetadata.confidence;
    if (confidence !== undefined && confidence !== null && !Number.isFinite(confidence)) {
      return false;
    }
  }
  return validBrokerActivityCurrencyShape(activity.currency);
}

function validBrokerActivityCurrencyShape(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }
  if (!isRecord(value)) {
    return false;
  }
  for (const key of ["id", "code", "name"]) {
    const entry = value[key];
    if (entry !== undefined && entry !== null && typeof entry !== "string") {
      return false;
    }
  }
  return true;
}

function validBrokerActivityRawShape(rawJson: string): boolean {
  for (const aliases of [
    ["id"],
    ["symbol"],
    ["option_symbol"],
    ["price"],
    ["units"],
    ["amount"],
    ["currency"],
    ["type"],
    ["subtype"],
    ["raw_type"],
    ["option_type"],
    ["description"],
    ["trade_date"],
    ["settlement_date"],
    ["fee"],
    ["fx_rate"],
    ["institution"],
    ["external_reference_id"],
    ["provider_type"],
    ["source_system"],
    ["source_record_id"],
    ["source_group_id"],
    ["mapping_metadata"],
    ["needs_review"],
  ]) {
    if (rawTokensForAliases(rawJson, aliases).length > 1) {
      return false;
    }
  }
  if (!validBrokerActivityScalarRawShape(rawJson)) {
    return false;
  }
  return validBrokerActivityNestedRawShape(rawJson);
}

function validBrokerActivityScalarRawShape(rawJson: string): boolean {
  for (const aliases of [
    ["id"],
    ["type"],
    ["subtype"],
    ["raw_type"],
    ["option_type"],
    ["description"],
    ["trade_date"],
    ["settlement_date"],
    ["institution"],
    ["external_reference_id"],
    ["provider_type"],
    ["source_system"],
    ["source_record_id"],
    ["source_group_id"],
  ]) {
    if (!brokerActivityOptionalRawTokenIsValid(rawJson, aliases, "string")) {
      return false;
    }
  }
  for (const aliases of [["price"], ["units"], ["amount"], ["fee"], ["fx_rate"]]) {
    if (!brokerActivityOptionalRawTokenIsValid(rawJson, aliases, "number")) {
      return false;
    }
  }
  return brokerActivityDefaultBoolRawTokenIsValid(rawJson, ["needs_review"]);
}

function validBrokerActivityNestedRawShape(rawJson: string): boolean {
  const currencyTokens = rawTokensForAliases(rawJson, ["currency"]);
  if (currencyTokens.length === 1) {
    const currencyToken = currencyTokens[0];
    if (!brokerActivityOptionalObjectRawTokenIsValid(rawJson, ["currency"])) {
      return false;
    }
    if (
      currencyToken?.trim().startsWith("{") &&
      (!validBrokerActivityAliasGroups(currencyToken, [["id"], ["code"], ["name"]]) ||
        !validBrokerActivityNestedScalarRawShape(currencyToken, "currency"))
    ) {
      return false;
    }
  }
  const symbolTokens = rawTokensForAliases(rawJson, ["symbol"]);
  if (symbolTokens.length === 1) {
    const symbolToken = symbolTokens[0];
    if (!brokerActivityOptionalObjectRawTokenIsValid(rawJson, ["symbol"])) {
      return false;
    }
    if (symbolToken?.trim().startsWith("{") && !validBrokerActivitySymbolRawShape(symbolToken)) {
      return false;
    }
  }
  const optionSymbolTokens = rawTokensForAliases(rawJson, ["option_symbol"]);
  if (optionSymbolTokens.length === 1) {
    const optionSymbolToken = optionSymbolTokens[0];
    if (!brokerActivityOptionalObjectRawTokenIsValid(rawJson, ["option_symbol"])) {
      return false;
    }
    if (
      optionSymbolToken?.trim().startsWith("{") &&
      !validBrokerActivityOptionSymbolRawShape(optionSymbolToken)
    ) {
      return false;
    }
  }
  const metadataTokens = rawTokensForAliases(rawJson, ["mapping_metadata"]);
  if (metadataTokens.length === 1) {
    const metadataToken = metadataTokens[0];
    if (!brokerActivityOptionalObjectRawTokenIsValid(rawJson, ["mapping_metadata"])) {
      return false;
    }
    if (
      metadataToken?.trim().startsWith("{") &&
      !validBrokerActivityMappingMetadataRawShape(metadataToken)
    ) {
      return false;
    }
  }
  return true;
}

function validBrokerActivitySymbolRawShape(rawJson: string): boolean {
  for (const aliases of [
    ["id"],
    ["symbol"],
    ["raw_symbol"],
    ["description"],
    ["type"],
    ["exchange"],
    ["currency"],
    ["figi_code"],
  ]) {
    if (rawTokensForAliases(rawJson, aliases).length > 1) {
      return false;
    }
  }
  for (const aliases of [["id"], ["symbol"], ["raw_symbol"], ["description"], ["figi_code"]]) {
    if (!brokerActivityOptionalRawTokenIsValid(rawJson, aliases, "string")) {
      return false;
    }
  }
  for (const nestedKey of ["exchange", "currency", "type"]) {
    const nestedTokens = rawTokensForAliases(rawJson, [nestedKey]);
    if (nestedTokens.length === 1) {
      const nestedToken = nestedTokens[0];
      if (!brokerActivityOptionalObjectRawTokenIsValid(rawJson, [nestedKey])) {
        return false;
      }
      if (!nestedToken?.trim().startsWith("{")) {
        continue;
      }
      const aliases =
        nestedKey === "exchange"
          ? [["id"], ["code"], ["mic_code"], ["name"]]
          : nestedKey === "currency"
            ? [["id"], ["code"], ["name"]]
            : [["id"], ["code"], ["description"], ["is_supported"]];
      if (!validBrokerActivityAliasGroups(nestedToken, aliases)) {
        return false;
      }
      const nestedKind =
        nestedKey === "exchange"
          ? "exchange"
          : nestedKey === "currency"
            ? "currency"
            : "symbol-type";
      if (!validBrokerActivityNestedScalarRawShape(nestedToken, nestedKind)) {
        return false;
      }
    }
  }
  return true;
}

function validBrokerActivityOptionSymbolRawShape(rawJson: string): boolean {
  if (
    !validBrokerActivityAliasGroups(rawJson, [
      ["id"],
      ["ticker"],
      ["option_type"],
      ["strike_price"],
      ["expiration_date"],
      ["is_mini_option"],
      ["underlying_symbol"],
    ])
  ) {
    return false;
  }
  for (const aliases of [["id"], ["ticker"], ["option_type"], ["expiration_date"]]) {
    if (!brokerActivityOptionalRawTokenIsValid(rawJson, aliases, "string")) {
      return false;
    }
  }
  if (
    !brokerActivityOptionalRawTokenIsValid(rawJson, ["strike_price"], "number") ||
    !brokerActivityOptionalRawTokenIsValid(rawJson, ["is_mini_option"], "bool")
  ) {
    return false;
  }
  const underlyingTokens = rawTokensForAliases(rawJson, ["underlying_symbol"]);
  if (underlyingTokens.length === 1) {
    const underlyingToken = underlyingTokens[0];
    if (!brokerActivityOptionalObjectRawTokenIsValid(rawJson, ["underlying_symbol"])) {
      return false;
    }
    if (underlyingToken?.trim().startsWith("{")) {
      return validBrokerActivitySymbolRawShape(underlyingToken);
    }
  }
  return true;
}

function brokerActivityOptionalObjectRawTokenIsValid(rawJson: string, aliases: string[]): boolean {
  const token = rawTokensForAliases(rawJson, aliases)[0];
  if (token === undefined) {
    return true;
  }
  const trimmed = token.trim();
  return trimmed === "null" || trimmed.startsWith("{");
}

function brokerActivityDefaultBoolRawTokenIsValid(rawJson: string, aliases: string[]): boolean {
  const token = rawTokensForAliases(rawJson, aliases)[0];
  if (token === undefined) {
    return true;
  }
  const trimmed = token.trim();
  return trimmed === "true" || trimmed === "false";
}

function validBrokerActivityNestedScalarRawShape(
  rawJson: string,
  kind: "currency" | "exchange" | "symbol-type",
): boolean {
  const stringGroups =
    kind === "exchange"
      ? [["id"], ["code"], ["mic_code"], ["name"]]
      : kind === "currency"
        ? [["id"], ["code"], ["name"]]
        : [["id"], ["code"], ["description"]];
  for (const aliases of stringGroups) {
    if (!brokerActivityOptionalRawTokenIsValid(rawJson, aliases, "string")) {
      return false;
    }
  }
  return (
    kind !== "symbol-type" ||
    brokerActivityOptionalRawTokenIsValid(rawJson, ["is_supported"], "bool")
  );
}

function validBrokerActivityAliasGroups(rawJson: string, aliasGroups: string[][]): boolean {
  return aliasGroups.every((aliases) => rawTokensForAliases(rawJson, aliases).length <= 1);
}

function validBrokerActivityMappingMetadataRawShape(rawJson: string): boolean {
  if (
    !validBrokerActivityAliasGroups(rawJson, [["flow"], ["reasons"], ["confidence"]]) ||
    !brokerActivityPaginationRawTokenIsValid(rawJson, ["confidence"], "number") ||
    !brokerActivityStringArrayRawTokenIsValid(rawJson, ["reasons"])
  ) {
    return false;
  }
  const flowTokens = rawTokensForAliases(rawJson, ["flow"]);
  if (flowTokens.length === 1) {
    const flowToken = flowTokens[0]?.trim() ?? "";
    if (flowToken === "null") {
      return true;
    }
    if (!flowToken.startsWith("{")) {
      return false;
    }
    if (!validBrokerActivityAliasGroups(flowToken, [["is_external"]])) {
      return false;
    }
    const isExternalToken = rawTokensForAliases(flowToken, ["is_external"])[0]?.trim();
    return (
      isExternalToken === undefined || isExternalToken === "true" || isExternalToken === "false"
    );
  }
  return true;
}

function brokerActivityStringArrayRawTokenIsValid(rawJson: string, aliases: string[]): boolean {
  const token = rawTokensForAliases(rawJson, aliases)[0];
  if (token === undefined) {
    return true;
  }
  const trimmed = token.trim();
  if (!trimmed.startsWith("[")) {
    return false;
  }
  return topLevelArrayValueTokens(trimmed).every((item) => rawJsonStringTokenIsValid(item));
}

function brokerActivityOptionalRawTokenIsValid(
  rawJson: string,
  aliases: string[],
  kind: "bool" | "number" | "string",
): boolean {
  const token = rawTokensForAliases(rawJson, aliases)[0];
  if (token === undefined) {
    return true;
  }
  const trimmed = token.trim();
  if (trimmed === "null") {
    return true;
  }
  if (kind === "string") {
    return rawJsonStringTokenIsValid(trimmed);
  }
  if (kind === "bool") {
    return trimmed === "true" || trimmed === "false";
  }
  return (
    /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(trimmed) &&
    Number.isFinite(Number(trimmed))
  );
}

function brokerActivityPaginationRawTokenIsValid(
  rawJson: string,
  aliases: string[],
  kind: "bool" | "i64" | "number",
): boolean {
  const token = rawTokensForAliases(rawJson, aliases)[0];
  if (token === undefined) {
    return true;
  }
  const trimmed = token.trim();
  if (trimmed === "null") {
    return true;
  }
  if (kind === "bool") {
    return trimmed === "true" || trimmed === "false";
  }
  if (kind === "number") {
    return (
      /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(trimmed) &&
      Number.isFinite(Number(trimmed))
    );
  }
  return rawJsonI64TokenIsValid(trimmed);
}

function hasBrokerActivityMappableId(activity: unknown): boolean {
  return isRecord(activity) && typeof activity.id === "string" && activity.id.trim().length > 0;
}

function brokerActivityFirstId(data: unknown[]): string | null {
  const first = data[0];
  if (!isRecord(first) || typeof first.id !== "string") {
    return null;
  }
  return first.id;
}

const BROKER_NEVER_ASSET_ACTIVITY_TYPES = new Set([
  "DEPOSIT",
  "WITHDRAWAL",
  "FEE",
  "TAX",
  "CREDIT",
]);

const BROKER_CASH_LIKE_ACTIVITY_TYPES = new Set([
  ...BROKER_NEVER_ASSET_ACTIVITY_TYPES,
  "ADJUSTMENT",
  "DIVIDEND",
  "INTEREST",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "UNKNOWN",
]);

const BROKER_ASSET_BACKED_CASH_LIKE_ACTIVITY_TYPES = new Set([
  "ADJUSTMENT",
  "DIVIDEND",
  "INTEREST",
  "TRANSFER_IN",
  "TRANSFER_OUT",
]);

function brokerCashActivityCreateInput(
  activity: unknown,
  accountId: string,
  accountCurrency: string | null,
  baseCurrency: string | null,
): Record<string, unknown> | null {
  if (!isRecord(activity)) {
    return null;
  }
  const activityId = optionalString(activity.id);
  if (!activityId) {
    return null;
  }
  const rawActivityType = brokerActivityType(activity) ?? "UNKNOWN";
  const sourceRecordId = brokerActivitySourceRecordId(activity) ?? activityId;
  const activityType = rawActivityType.toUpperCase();
  const isNeverAsset = BROKER_NEVER_ASSET_ACTIVITY_TYPES.has(activityType);
  if (
    !isNeverAsset &&
    (!BROKER_CASH_LIKE_ACTIVITY_TYPES.has(activityType) || brokerActivityHasSymbol(activity))
  ) {
    return null;
  }

  const currency = brokerActivityResolvedCurrency(activity, accountCurrency, baseCurrency);
  const needsReview = brokerActivityNeedsReview(activity);
  return {
    accountId,
    activityType,
    subtype: optionalString(activity.subtype ?? activity.option_type ?? activity.raw_type),
    activityDate:
      optionalString(activity.trade_date ?? activity.settlement_date) ?? new Date().toISOString(),
    amount: brokerActivityAbsoluteNumberString(activity.amount),
    fee: brokerActivityAbsoluteNumberString(activity.fee),
    currency,
    comment: optionalString(activity.description ?? activity.external_reference_id),
    fxRate: brokerActivityNumberString(activity.fx_rate),
    sourceSystem: optionalString(activity.source_system ?? activity.provider_type) ?? "SNAPTRADE",
    sourceRecordId,
    sourceGroupId: optionalString(activity.source_group_id),
    idempotencyKey: brokerActivityIdempotencyKey(
      accountId,
      optionalString(activity.source_system ?? activity.provider_type) ?? "SNAPTRADE",
      sourceRecordId,
    ),
    status: needsReview ? "DRAFT" : "POSTED",
    needsReview,
    metadata: brokerActivityMetadata(activity),
    allowMissingAsset: true,
  };
}

function brokerActivityHasSymbol(activity: Record<string, unknown>): boolean {
  const symbol = activity.symbol;
  if (isRecord(symbol)) {
    if (optionalNonEmptyString(symbol.raw_symbol) || optionalNonEmptyString(symbol.symbol)) {
      return true;
    }
  }
  const optionSymbol = activity.option_symbol;
  return isRecord(optionSymbol) && optionalNonEmptyString(optionSymbol.ticker) !== null;
}

function brokerExistingAssetActivityCreateInput(
  db: Database,
  activity: unknown,
  accountId: string,
  accountCurrency: string | null,
  baseCurrency: string | null,
  exchangeMetadata: Pick<ExchangeMetadata, "yahooSuffixToMic"> | undefined,
): Record<string, unknown> | null {
  if (!isRecord(activity)) {
    return null;
  }
  const activityId = optionalString(activity.id);
  const rawActivityType = brokerActivityType(activity) ?? "UNKNOWN";
  const assetSymbol = brokerActivitySymbol(activity, exchangeMetadata);
  if (!activityId || !assetSymbol) {
    return null;
  }
  const sourceRecordId = brokerActivitySourceRecordId(activity) ?? activityId;
  const activityType = rawActivityType.toUpperCase();
  if (
    BROKER_CASH_LIKE_ACTIVITY_TYPES.has(activityType) &&
    !BROKER_ASSET_BACKED_CASH_LIKE_ACTIVITY_TYPES.has(activityType) &&
    activityType !== "UNKNOWN"
  ) {
    return null;
  }
  const assetId = findExistingBrokerActivityAssetId(db, assetSymbol);
  if (assetId === null) {
    return null;
  }
  const currency = brokerActivityResolvedCurrency(activity, accountCurrency, baseCurrency);
  const sourceSystem =
    optionalString(activity.source_system ?? activity.provider_type) ?? "SNAPTRADE";
  const needsReview = brokerActivityNeedsReview(activity);
  return {
    accountId,
    activityType,
    subtype: optionalString(activity.subtype ?? activity.option_type ?? activity.raw_type),
    activityDate:
      optionalString(activity.trade_date ?? activity.settlement_date) ?? new Date().toISOString(),
    quantity: brokerActivityAbsoluteNumberString(activity.units),
    unitPrice: brokerActivityAbsoluteNumberString(activity.price),
    amount: brokerActivityAbsoluteNumberString(activity.amount),
    fee: brokerActivityAbsoluteNumberString(activity.fee),
    currency,
    asset: { id: assetId, symbol: assetSymbol.symbol },
    comment: optionalString(activity.description ?? activity.external_reference_id),
    fxRate: brokerActivityNumberString(activity.fx_rate),
    sourceSystem,
    sourceRecordId,
    sourceGroupId: optionalString(activity.source_group_id),
    idempotencyKey: brokerActivityIdempotencyKey(accountId, sourceSystem, sourceRecordId),
    status: needsReview ? "DRAFT" : "POSTED",
    needsReview,
    metadata: brokerActivityMetadata(activity),
  };
}

async function brokerProviderAssetActivityCreateInput(
  activity: unknown,
  accountId: string,
  accountCurrency: string | null,
  baseCurrency: string | null,
  exchangeMetadata: Pick<ExchangeMetadata, "yahooSuffixToMic"> | undefined,
  symbolSearch: LocalConnectServiceDependencies["symbolSearch"] | undefined,
  providerSearchCache: Map<string, Promise<SymbolSearchResult[]>>,
): Promise<Record<string, unknown> | null> {
  if (!symbolSearch || !isRecord(activity)) {
    return null;
  }
  const activityId = optionalString(activity.id);
  const rawActivityType = brokerActivityType(activity) ?? "UNKNOWN";
  const assetSymbol = brokerActivitySymbol(activity, exchangeMetadata);
  if (!activityId || !assetSymbol) {
    return null;
  }
  const sourceRecordId = brokerActivitySourceRecordId(activity) ?? activityId;
  const activityType = rawActivityType.toUpperCase();
  if (
    BROKER_CASH_LIKE_ACTIVITY_TYPES.has(activityType) &&
    !BROKER_ASSET_BACKED_CASH_LIKE_ACTIVITY_TYPES.has(activityType) &&
    activityType !== "UNKNOWN"
  ) {
    return null;
  }

  const providerAsset = await resolveBrokerProviderAsset(
    assetSymbol,
    symbolSearch,
    exchangeMetadata,
    providerSearchCache,
  );
  if (!providerAsset) {
    return null;
  }
  const currency = brokerActivityResolvedCurrency(activity, accountCurrency, baseCurrency);
  const sourceSystem =
    optionalString(activity.source_system ?? activity.provider_type) ?? "SNAPTRADE";
  const needsReview = brokerActivityNeedsReview(activity);
  return {
    accountId,
    activityType,
    subtype: optionalString(activity.subtype ?? activity.option_type ?? activity.raw_type),
    activityDate:
      optionalString(activity.trade_date ?? activity.settlement_date) ?? new Date().toISOString(),
    quantity: brokerActivityAbsoluteNumberString(activity.units),
    unitPrice: brokerActivityAbsoluteNumberString(activity.price),
    amount: brokerActivityAbsoluteNumberString(activity.amount),
    fee: brokerActivityAbsoluteNumberString(activity.fee),
    currency,
    asset: providerAsset,
    comment: optionalString(activity.description ?? activity.external_reference_id),
    fxRate: brokerActivityNumberString(activity.fx_rate),
    sourceSystem,
    sourceRecordId,
    sourceGroupId: optionalString(activity.source_group_id),
    idempotencyKey: brokerActivityIdempotencyKey(accountId, sourceSystem, sourceRecordId),
    status: needsReview ? "DRAFT" : "POSTED",
    needsReview,
    metadata: brokerActivityMetadata(activity),
  };
}

function brokerUnresolvedAssetActivityCreateInput(
  activity: unknown,
  accountId: string,
  accountCurrency: string | null,
  baseCurrency: string | null,
  exchangeMetadata: Pick<ExchangeMetadata, "yahooSuffixToMic"> | undefined,
): Record<string, unknown> | null {
  if (!isRecord(activity)) {
    return null;
  }
  const activityId = optionalString(activity.id);
  const rawActivityType = brokerActivityType(activity) ?? "UNKNOWN";
  const assetSymbol = brokerActivitySymbol(activity, exchangeMetadata);
  if (!activityId || !assetSymbol) {
    return null;
  }
  const sourceRecordId = brokerActivitySourceRecordId(activity) ?? activityId;
  const activityType = rawActivityType.toUpperCase();
  if (
    BROKER_CASH_LIKE_ACTIVITY_TYPES.has(activityType) &&
    !BROKER_ASSET_BACKED_CASH_LIKE_ACTIVITY_TYPES.has(activityType) &&
    activityType !== "UNKNOWN"
  ) {
    return null;
  }
  const instrumentType = brokerActivityInstrumentType(activity, assetSymbol);
  if (!instrumentType) {
    return null;
  }
  const currency = brokerActivityResolvedCurrency(activity, accountCurrency, baseCurrency);
  const sourceSystem =
    optionalString(activity.source_system ?? activity.provider_type) ?? "SNAPTRADE";
  const needsReview = brokerActivityNeedsReview(activity);
  const asset: Record<string, unknown> = {
    symbol: assetSymbol.symbol,
    instrumentType,
  };
  if (assetSymbol.exchangeMic) {
    asset.exchangeMic = assetSymbol.exchangeMic;
  }
  const quoteCcy = brokerActivitySymbolCurrency(activity);
  if (quoteCcy) {
    asset.quoteCcy = quoteCcy;
  }
  const name = brokerActivityAssetName(activity);
  if (name) {
    asset.name = name;
  }
  return {
    accountId,
    activityType,
    subtype: optionalString(activity.subtype ?? activity.option_type ?? activity.raw_type),
    activityDate:
      optionalString(activity.trade_date ?? activity.settlement_date) ?? new Date().toISOString(),
    quantity: brokerActivityAbsoluteNumberString(activity.units),
    unitPrice: brokerActivityAbsoluteNumberString(activity.price),
    amount: brokerActivityAbsoluteNumberString(activity.amount),
    fee: brokerActivityAbsoluteNumberString(activity.fee),
    currency,
    asset,
    comment: optionalString(activity.description ?? activity.external_reference_id),
    fxRate: brokerActivityNumberString(activity.fx_rate),
    sourceSystem,
    sourceRecordId,
    sourceGroupId: optionalString(activity.source_group_id),
    idempotencyKey: brokerActivityIdempotencyKey(accountId, sourceSystem, sourceRecordId),
    status: needsReview ? "DRAFT" : "POSTED",
    needsReview,
    metadata: brokerActivityMetadata(activity),
  };
}

async function resolveBrokerProviderAsset(
  assetSymbol: BrokerActivityAssetSymbol,
  symbolSearch: NonNullable<LocalConnectServiceDependencies["symbolSearch"]>,
  exchangeMetadata: Pick<ExchangeMetadata, "yahooSuffixToMic"> | undefined,
  providerSearchCache: Map<string, Promise<SymbolSearchResult[]>>,
): Promise<Record<string, unknown> | null> {
  const query = assetSymbol.symbol.trim().toUpperCase();
  if (!query) {
    return null;
  }
  const cached =
    providerSearchCache.get(query) ??
    Promise.resolve(symbolSearch(query)).catch((): SymbolSearchResult[] => []);
  providerSearchCache.set(query, cached);
  const results = await cached;
  const match = results.find((result) =>
    brokerProviderSearchResultMatches(result, assetSymbol, exchangeMetadata),
  );
  if (!match) {
    return null;
  }
  if (match.existingAssetId) {
    return { id: match.existingAssetId, symbol: assetSymbol.symbol };
  }
  const instrumentType = instrumentTypeFromQuoteType(match.quoteType);
  const exchangeMic = match.exchangeMic?.trim().toUpperCase() || undefined;
  const quoteCcy = match.currency?.trim().toUpperCase();
  if (!instrumentType || !quoteCcy) {
    return null;
  }
  if (instrumentType === "EQUITY" && !exchangeMic) {
    return null;
  }
  return {
    symbol: match.symbol,
    exchangeMic,
    instrumentType,
    quoteCcy,
    quoteMode: "MARKET",
    name: providerSearchResultName(match, assetSymbol.symbol),
  };
}

function brokerProviderSearchResultMatches(
  result: SymbolSearchResult,
  assetSymbol: BrokerActivityAssetSymbol,
  exchangeMetadata: Pick<ExchangeMetadata, "yahooSuffixToMic"> | undefined,
): boolean {
  const resultMic = result.exchangeMic?.trim().toUpperCase() || null;
  const parsedResult = parseKnownYahooSuffix(result.symbol, exchangeMetadata);
  const parsedBroker = parseKnownYahooSuffix(assetSymbol.symbol, exchangeMetadata);
  const resultSymbol = parsedResult.symbol.trim().toUpperCase();
  const brokerSymbol = parsedBroker.symbol.trim().toUpperCase();
  const brokerMic = assetSymbol.exchangeMic ?? parsedBroker.exchangeMic;
  if (instrumentTypeFromQuoteType(result.quoteType) === "CRYPTO") {
    const cryptoBase = parseCryptoBrokerPair(result.symbol)?.base.trim().toUpperCase();
    if (cryptoBase !== brokerSymbol) {
      return false;
    }
    return brokerMic ? resultMic === brokerMic.toUpperCase() : true;
  }
  if (brokerMic) {
    return resultMic === brokerMic.toUpperCase() && resultSymbol === brokerSymbol;
  }
  return resultSymbol === brokerSymbol;
}

function providerSearchResultName(result: SymbolSearchResult, fallback: string): string {
  return result.longName?.trim() || result.shortName?.trim() || fallback;
}

interface BrokerActivityAssetSymbol {
  symbol: string;
  exchangeMic: string | null;
}

function brokerActivitySymbol(
  activity: Record<string, unknown>,
  exchangeMetadata: Pick<ExchangeMetadata, "yahooSuffixToMic"> | undefined,
): BrokerActivityAssetSymbol | null {
  const optionSymbol = activity.option_symbol;
  if (isRecord(optionSymbol)) {
    const ticker = optionalNonEmptyString(optionSymbol.ticker);
    if (ticker) {
      return { symbol: ticker.replace(/\s+/g, "").toUpperCase(), exchangeMic: null };
    }
  }
  const symbol = activity.symbol;
  if (!isRecord(symbol)) {
    return null;
  }
  const symbolType = symbol.type;
  const symbolTypeCode = isRecord(symbolType)
    ? optionalString(symbolType.code)?.toUpperCase()
    : null;
  const exchangeMic = brokerActivitySymbolExchangeMic(symbol);
  if (symbolTypeCode === "CRYPTOCURRENCY" || symbolTypeCode === "CRYPTO") {
    const cryptoSymbol =
      parseCryptoBrokerPair(optionalNonEmptyString(symbol.raw_symbol))?.base ??
      parseCryptoBrokerPair(optionalNonEmptyString(symbol.symbol))?.base ??
      null;
    return cryptoSymbol ? { symbol: cryptoSymbol.toUpperCase(), exchangeMic: null } : null;
  }
  const rawSymbol = optionalNonEmptyString(symbol.raw_symbol);
  if (rawSymbol) {
    return { symbol: rawSymbol.toUpperCase(), exchangeMic };
  }
  const displaySymbol = optionalNonEmptyString(symbol.symbol);
  if (!displaySymbol) {
    return null;
  }
  const parsed = parseKnownYahooSuffix(displaySymbol, exchangeMetadata);
  return { symbol: parsed.symbol.toUpperCase(), exchangeMic: parsed.exchangeMic ?? exchangeMic };
}

function brokerActivityInstrumentType(
  activity: Record<string, unknown>,
  assetSymbol: BrokerActivityAssetSymbol,
): string | null {
  const optionSymbol = activity.option_symbol;
  if (isRecord(optionSymbol) && optionalNonEmptyString(optionSymbol.ticker)) {
    return "OPTION";
  }
  if (optionalNonEmptyString(activity.option_type)) {
    return "OPTION";
  }
  const symbol = activity.symbol;
  if (isRecord(symbol)) {
    const symbolType = symbol.type;
    const symbolTypeCode = isRecord(symbolType)
      ? optionalString(symbolType.code)?.toUpperCase()
      : null;
    if (symbolTypeCode === "CRYPTOCURRENCY" || symbolTypeCode === "CRYPTO") {
      return "CRYPTO";
    }
  }
  return assetSymbol.exchangeMic ? "EQUITY" : null;
}

function brokerActivitySymbolCurrency(activity: Record<string, unknown>): string | null {
  const symbol = activity.symbol;
  if (!isRecord(symbol)) {
    return null;
  }
  const currency = symbol.currency;
  return isRecord(currency) ? optionalNonEmptyString(currency.code) : null;
}

function brokerActivityAssetName(activity: Record<string, unknown>): string | null {
  const symbol = activity.symbol;
  if (isRecord(symbol)) {
    const description = optionalNonEmptyString(symbol.description);
    if (description) {
      return description;
    }
  }
  const optionSymbol = activity.option_symbol;
  if (isRecord(optionSymbol)) {
    const underlying = optionSymbol.underlying_symbol;
    if (isRecord(underlying)) {
      return optionalNonEmptyString(underlying.description);
    }
  }
  return null;
}

function brokerActivitySymbolExchangeMic(symbol: Record<string, unknown>): string | null {
  const exchange = symbol.exchange;
  if (!isRecord(exchange)) {
    return null;
  }
  return optionalNonEmptyString(exchange.mic_code ?? exchange.code)?.toUpperCase() ?? null;
}

function brokerActivityResolvedCurrency(
  activity: Record<string, unknown>,
  accountCurrency: string | null,
  baseCurrency: string | null,
): string {
  return (
    brokerActivityCurrency(activity) ??
    brokerActivitySymbolCurrency(activity) ??
    optionalString(accountCurrency) ??
    optionalString(baseCurrency) ??
    "USD"
  );
}

function optionalNonEmptyString(value: unknown): string | null {
  const text = optionalString(value)?.trim();
  return text ? text : null;
}

function parseCryptoBrokerPair(symbol: string | null): { base: string; quote: string } | null {
  if (!symbol) {
    return null;
  }
  const separator = symbol.lastIndexOf("-");
  if (separator <= 0 || separator === symbol.length - 1) {
    return { base: symbol, quote: "" };
  }
  const base = symbol.slice(0, separator).trim();
  const quote = symbol
    .slice(separator + 1)
    .trim()
    .toUpperCase();
  if (!base || quote.length < 3 || quote.length > 5 || !/^[A-Z]+$/.test(quote)) {
    return { base: symbol, quote: "" };
  }
  return { base, quote };
}

function parseKnownYahooSuffix(
  symbol: string,
  exchangeMetadata: Pick<ExchangeMetadata, "yahooSuffixToMic"> | undefined,
): BrokerActivityAssetSymbol {
  const trimmed = symbol.trim();
  if (!exchangeMetadata) {
    return { symbol: trimmed, exchangeMic: null };
  }
  const suffixes = [...exchangeMetadata.yahooSuffixToMic.entries()].sort(
    ([left], [right]) => right.length - left.length,
  );
  for (const [suffix, exchangeMic] of suffixes) {
    const dottedSuffix = `.${suffix}`;
    if (
      trimmed.length >= dottedSuffix.length &&
      trimmed.slice(trimmed.length - dottedSuffix.length).toUpperCase() === dottedSuffix
    ) {
      return { symbol: trimmed.slice(0, -dottedSuffix.length), exchangeMic };
    }
  }
  return { symbol: trimmed, exchangeMic: null };
}

function findExistingBrokerActivityAssetId(
  db: Database,
  assetSymbol: BrokerActivityAssetSymbol,
): string | null {
  if (!sqliteTableExists(db, "assets")) {
    return null;
  }
  const symbol = assetSymbol.symbol;
  if (assetSymbol.exchangeMic && sqliteColumnExists(db, "assets", "instrument_exchange_mic")) {
    const exchangeRow = db
      .query<{ id: string }, [string, string, string]>(
        `
          SELECT id
          FROM assets
          WHERE (upper(display_code) = ? OR upper(instrument_symbol) = ?)
            AND upper(instrument_exchange_mic) = ?
          ORDER BY id
          LIMIT 1
        `,
      )
      .get(symbol, symbol, assetSymbol.exchangeMic.toUpperCase());
    if (exchangeRow) {
      return exchangeRow.id;
    }
    return null;
  }
  const row = db
    .query<{ id: string }, [string, string, string, string]>(
      `
        SELECT id
        FROM assets
        WHERE upper(id) = ? OR upper(display_code) = ? OR upper(instrument_symbol) = ?
        ORDER BY CASE WHEN upper(id) = ? THEN 0 ELSE 1 END
        LIMIT 1
      `,
    )
    .get(symbol, symbol, symbol, symbol);
  return row?.id ?? null;
}

function brokerActivityCurrency(activity: Record<string, unknown>): string | null {
  const currency = activity.currency;
  if (isRecord(currency)) {
    return optionalString(currency.code);
  }
  return optionalString(currency);
}

function brokerActivityNeedsReview(activity: Record<string, unknown>): boolean {
  if (optionalBoolean(activity.needs_review) === true) {
    return true;
  }
  const activityType = brokerActivityType(activity)?.toUpperCase();
  if (!activityType || activityType === "UNKNOWN") {
    return true;
  }
  const metadata = activity.mapping_metadata;
  if (!isRecord(metadata)) {
    return false;
  }
  const confidence = optionalNumber(metadata.confidence);
  if (confidence !== null && confidence < 0.7) {
    return true;
  }
  const reasons = metadata.reasons;
  return Array.isArray(reasons) && reasons.some((reason) => brokerActivityWarningReason(reason));
}

function brokerActivityWarningReason(reason: unknown): boolean {
  const normalized = optionalString(reason)?.toLowerCase() ?? "";
  return [
    "unknown",
    "unrecognized",
    "ambiguous",
    "multiple",
    "conflict",
    "manual",
    "review",
    "unsupported",
  ].some((pattern) => normalized.includes(pattern));
}

function brokerActivityType(activity: Record<string, unknown>): string | null {
  return optionalString(activity.type);
}

function brokerActivitySourceRecordId(activity: Record<string, unknown>): string | null {
  return optionalString(activity.source_record_id ?? activity.external_reference_id ?? activity.id);
}

function brokerActivityAbsoluteNumberString(value: unknown): string | null {
  const number = optionalNumber(value);
  return number === null ? null : String(Math.abs(number));
}

function brokerActivityNumberString(value: unknown): string | null {
  const number = optionalNumber(value);
  return number === null ? null : String(number);
}

function brokerActivityMetadata(activity: Record<string, unknown>): Record<string, unknown> {
  const mappingMetadata = activity.mapping_metadata;
  const metadata: Record<string, unknown> = {
    source: "broker",
    raw_type: optionalString(activity.raw_type),
    source_system: optionalString(activity.source_system),
    provider_type: optionalString(activity.provider_type),
    source_record_id: optionalString(activity.source_record_id),
    source_group_id: optionalString(activity.source_group_id),
    external_reference_id: optionalString(activity.external_reference_id),
    institution: optionalString(activity.institution),
  };
  if (isRecord(mappingMetadata)) {
    const flow = mappingMetadata.flow;
    const mappingReasons = Array.isArray(mappingMetadata.reasons)
      ? mappingMetadata.reasons.filter((reason): reason is string => typeof reason === "string")
      : [];
    metadata.mapping_metadata = mappingMetadata;
    metadata.confidence = optionalNumber(mappingMetadata.confidence) ?? undefined;
    metadata.mapping_reasons = mappingReasons.length > 0 ? mappingReasons : undefined;
    metadata.flow = isRecord(flow)
      ? { is_external: optionalBoolean(flow.is_external) === true }
      : undefined;
  }
  const symbolMetadata = brokerActivitySymbolMetadata(activity.symbol);
  if (symbolMetadata) {
    metadata.symbol = symbolMetadata;
  }
  const optionSymbol = activity.option_symbol;
  const optionLegType = optionalString(activity.option_type);
  if (optionLegType) {
    metadata.option_leg_type = optionLegType;
  }
  if (isRecord(optionSymbol)) {
    metadata.option_contract_type = optionalString(optionSymbol.option_type);
    metadata.option_ticker = optionalString(optionSymbol.ticker);
    const underlying = optionSymbol.underlying_symbol;
    metadata.option_underlying_symbol = isRecord(underlying)
      ? optionalString(underlying.symbol)
      : undefined;
  }
  return metadata;
}

function brokerActivitySymbolMetadata(symbol: unknown): Record<string, unknown> | undefined {
  if (!isRecord(symbol)) {
    return undefined;
  }
  const exchange = symbol.exchange;
  const symbolType = symbol.type;
  const currency = symbol.currency;
  const metadata: Record<string, unknown> = {
    id: optionalString(symbol.id),
    symbol: optionalString(symbol.symbol),
    raw_symbol: optionalString(symbol.raw_symbol),
    figi_code: optionalString(symbol.figi_code),
    exchange_mic: isRecord(exchange) ? optionalString(exchange.mic_code) : undefined,
    symbol_type_code: isRecord(symbolType) ? optionalString(symbolType.code) : undefined,
    currency_code: isRecord(currency) ? optionalString(currency.code) : undefined,
  };
  return Object.values(metadata).some((value) => value !== undefined && value !== null)
    ? metadata
    : undefined;
}

function brokerActivityIdempotencyKey(
  accountId: string,
  sourceSystem: string,
  sourceRecordId: string,
): string {
  return `broker:${sourceSystem}:${accountId}:${sourceRecordId}`;
}

async function filterExistingBrokerCashActivities(
  activityService: LocalConnectServiceDependencies["activityService"],
  creates: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  if (!activityService.checkExistingDuplicates) {
    return creates;
  }
  const keys = creates
    .map((create) => optionalString(create.idempotencyKey))
    .filter((key): key is string => key !== null);
  if (keys.length === 0) {
    return creates;
  }
  const duplicates = await activityService.checkExistingDuplicates(keys);
  if (!isRecord(duplicates)) {
    return creates;
  }
  return creates.filter((create) => {
    const key = optionalString(create.idempotencyKey);
    return key === null || duplicates[key] === undefined;
  });
}

function brokerActivityAlreadyImported(
  db: Database,
  activity: unknown,
  createInput: Record<string, unknown>,
): boolean {
  if (
    !isRecord(activity) ||
    !sqliteTableExists(db, "activities") ||
    !sqliteColumnExists(db, "activities", "account_id")
  ) {
    return false;
  }

  const accountId = optionalString(createInput.accountId);
  if (!accountId) {
    return false;
  }

  const activityId = optionalString(activity.id);
  if (activityId && sqliteColumnExists(db, "activities", "id")) {
    const row = db
      .query<
        { id: string },
        [string, string]
      >("SELECT id FROM activities WHERE account_id = ? AND id = ? LIMIT 1")
      .get(accountId, activityId);
    if (row) {
      return true;
    }
  }

  const sourceSystem = optionalString(createInput.sourceSystem);
  const sourceRecordId = optionalString(createInput.sourceRecordId);
  if (
    sourceSystem &&
    sourceRecordId &&
    sqliteColumnExists(db, "activities", "source_system") &&
    sqliteColumnExists(db, "activities", "source_record_id")
  ) {
    const row = db
      .query<{ id: string }, [string, string, string]>(
        `
          SELECT id
          FROM activities
          WHERE account_id = ?
            AND source_system = ?
            AND source_record_id = ?
          LIMIT 1
        `,
      )
      .get(accountId, sourceSystem, sourceRecordId);
    return row !== null;
  }

  return false;
}

function bulkMutationErrors(result: unknown): Array<{ message: string }> {
  return isRecord(result) && Array.isArray(result.errors)
    ? result.errors.filter(
        (error): error is { message: string } =>
          isRecord(error) && typeof error.message === "string",
      )
    : [];
}

function bulkMutationDuplicateError(error: { message: string }): boolean {
  return error.message.toLowerCase().includes("duplicate activity");
}

function bulkMutationCreatedCount(result: unknown): number {
  return isRecord(result) && Array.isArray(result.created) ? result.created.length : 0;
}

function bulkMutationCreatedAssetIds(result: unknown): string[] {
  const createdAssetIds = isRecord(result) ? result[ACTIVITY_BULK_CREATED_ASSET_IDS] : undefined;
  return Array.isArray(createdAssetIds)
    ? createdAssetIds.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
}

function brokerActivitiesPath(
  providerAccountId: string,
  startDate: string | null,
  endDate: string,
  offset: number,
  limit: number,
): string {
  const params = new URLSearchParams({
    offset: String(offset),
    limit: String(limit),
  });
  if (startDate) {
    params.set("start_date", startDate);
  }
  params.set("end_date", endDate);
  return `/api/v1/sync/brokerage/accounts/${encodeURIComponent(providerAccountId)}/activities?${params}`;
}

function brokerActivitySyncStartDate(
  db: Database,
  accountId: string,
  endDate: string,
): string | null {
  const row = db
    .query<{ last_successful_at: string | null }, [string, string]>(
      `
        SELECT last_successful_at
        FROM brokers_sync_state
        WHERE account_id = ? AND provider = ?
      `,
    )
    .get(accountId, "SNAPTRADE");
  if (!row?.last_successful_at) {
    return null;
  }
  const parsed = new Date(row.last_successful_at);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  const startDate = dateOnly(parsed);
  return startDate > endDate ? endDate : startDate;
}

function upsertBrokerSyncAttempt(db: Database, accountId: string): void {
  const now = brokerSyncTimestampNow();
  db.prepare(
    `
      INSERT INTO brokers_sync_state (
        account_id, provider, checkpoint_json, last_attempted_at, last_successful_at,
        last_error, last_run_id, sync_status, created_at, updated_at
      )
      VALUES (?, 'SNAPTRADE', NULL, ?, NULL, NULL, NULL, 'RUNNING', ?, ?)
      ON CONFLICT(account_id, provider) DO UPDATE SET
        last_attempted_at = excluded.last_attempted_at,
        sync_status = excluded.sync_status,
        updated_at = excluded.updated_at
    `,
  ).run(accountId, now, now, now);
}

function upsertBrokerSyncSuccess(db: Database, accountId: string): void {
  const now = brokerSyncTimestampNow();
  db.prepare(
    `
      INSERT INTO brokers_sync_state (
        account_id, provider, checkpoint_json, last_attempted_at, last_successful_at,
        last_error, last_run_id, sync_status, created_at, updated_at
      )
      VALUES (?, 'SNAPTRADE', NULL, ?, ?, NULL, NULL, 'IDLE', ?, ?)
      ON CONFLICT(account_id, provider) DO UPDATE SET
        last_successful_at = excluded.last_successful_at,
        last_error = NULL,
        last_run_id = NULL,
        sync_status = excluded.sync_status,
        updated_at = excluded.updated_at
    `,
  ).run(accountId, now, now, now, now);
}

function upsertBrokerSyncFailure(db: Database, accountId: string, error: string): void {
  const now = brokerSyncTimestampNow();
  db.prepare(
    `
      INSERT INTO brokers_sync_state (
        account_id, provider, checkpoint_json, last_attempted_at, last_successful_at,
        last_error, last_run_id, sync_status, created_at, updated_at
      )
      VALUES (?, 'SNAPTRADE', NULL, ?, NULL, ?, NULL, 'FAILED', ?, ?)
      ON CONFLICT(account_id, provider) DO UPDATE SET
        sync_status = excluded.sync_status,
        last_error = excluded.last_error,
        last_run_id = NULL,
        updated_at = excluded.updated_at
    `,
  ).run(accountId, now, error, now, now);
}

function brokerSyncTimestampNow(): string {
  const iso = new Date().toISOString();
  return iso.endsWith(".000Z") ? `${iso.slice(0, -5)}+00:00` : iso.replace(/Z$/u, "+00:00");
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function syncBrokerDataBounded(
  service: Pick<
    ConnectService,
    "syncBrokerConnections" | "syncBrokerAccounts" | "syncBrokerActivities" | "getSyncedAccounts"
  >,
): Promise<{ result: ConnectSyncBrokerDataResult; eventPayload: BrokerSyncEventPayload }> {
  const connectionsSynced = (await service.syncBrokerConnections()) as
    | BrokerSyncEventPayload["connectionsSynced"]
    | undefined;
  const accountsSynced = (await service.syncBrokerAccounts()) as
    | BrokerSyncEventPayload["accountsSynced"]
    | undefined;
  const activitiesSynced = (await service.syncBrokerActivities()) as
    | BrokerSyncEventPayload["activitiesSynced"]
    | undefined;
  const holdingsSynced = {
    accountsSynced: 0,
    snapshotsUpserted: 0,
    positionsUpserted: 0,
    assetsInserted: 0,
    accountsFailed: 0,
    newAssetIds: [],
  };
  const totalFailed = (activitiesSynced?.accountsFailed ?? 0) + holdingsSynced.accountsFailed;
  const totalWarnings = activitiesSynced?.accountsWarned ?? 0;
  const newAccounts = brokerSyncNewAccountsFromSyncedAccounts(await service.getSyncedAccounts());
  const eventPayload: BrokerSyncEventPayload = {
    success: totalFailed === 0,
    message: brokerSyncSummaryMessage({
      accountsCreated: accountsSynced?.created ?? 0,
      activitiesUpserted: activitiesSynced?.activitiesUpserted ?? 0,
      holdingsUpserted: holdingsSynced.positionsUpserted,
      totalFailed,
      totalWarnings,
    }),
    connectionsSynced,
    accountsSynced,
    activitiesSynced,
    holdingsSynced,
    ...(newAccounts ? { newAccounts } : {}),
  };
  return { result: { status: "accepted" }, eventPayload };
}

function brokerSyncNewAccountsFromSyncedAccounts(
  accounts: unknown[],
): BrokerSyncEventPayload["newAccounts"] {
  const newAccounts = accounts
    .filter((account): account is Record<string, unknown> => isRecord(account))
    .filter((account) => optionalString(account.trackingMode) === "NOT_SET")
    .map((account) => {
      const providerAccountId = optionalString(account.providerAccountId);
      const localAccountId = optionalString(account.id);
      if (!providerAccountId || !localAccountId) {
        return null;
      }
      return {
        localAccountId,
        providerAccountId,
        defaultName: optionalString(account.name) ?? "Broker Account",
        currency: optionalString(account.currency) ?? "USD",
        institutionName: optionalString(account.platformId),
      };
    })
    .filter((account): account is NonNullable<typeof account> => account !== null);
  return newAccounts.length > 0 ? newAccounts : undefined;
}

function brokerSyncSummaryMessage({
  accountsCreated,
  activitiesUpserted,
  holdingsUpserted,
  totalFailed,
  totalWarnings,
}: {
  accountsCreated: number;
  activitiesUpserted: number;
  holdingsUpserted: number;
  totalFailed: number;
  totalWarnings: number;
}): string {
  return `Sync completed. ${accountsCreated} accounts created, ${activitiesUpserted} activities synced, ${holdingsUpserted} holdings synced${
    totalFailed === 0 ? "." : ` (${totalFailed} failed).`
  }${totalWarnings === 0 ? "" : ` (${totalWarnings} warning${totalWarnings === 1 ? "" : "s"}).`}`;
}

function brokerAccountDisplayName(account: Record<string, unknown>): string {
  const name = optionalString(account.name);
  if (name) {
    return name;
  }
  const institution = optionalString(account.institution_name) ?? "Unknown";
  const accountNumber = optionalString(account.account_number ?? account.number) ?? "Account";
  return `${institution} - ${accountNumber}`;
}

function brokerAccountCurrency(
  account: Record<string, unknown>,
  baseCurrency: string | undefined,
): string {
  const currency = optionalString(account.currency);
  if (currency) {
    return currency;
  }
  const balance = isRecord(account.balance) ? account.balance : null;
  const total = balance && isRecord(balance.total) ? balance.total : null;
  const balanceCurrency = total ? optionalString(total.currency) : null;
  return balanceCurrency || baseCurrency?.trim() || "USD";
}

function brokerAccountType(account: Record<string, unknown>): string {
  const accountType = optionalString(account.type);
  if (accountType) {
    return accountType;
  }
  const rawType = (optionalString(account.raw_type) ?? "").toUpperCase();
  switch (rawType) {
    case "RRSP":
    case "RSP":
      return "RRSP";
    case "TFSA":
      return "TFSA";
    case "FHSA":
      return "FHSA";
    case "RESP":
      return "RESP";
    case "LIRA":
    case "LRSP":
      return "LIRA";
    case "RRIF":
      return "RRIF";
    case "LIF":
      return "LIF";
    case "DPSP":
      return "DPSP";
    case "IRA":
    case "TRADITIONAL_IRA":
    case "TRADITIONAL IRA":
      return "IRA";
    case "ROTH_IRA":
    case "ROTH IRA":
    case "ROTH":
      return "ROTH_IRA";
    case "401K":
    case "401(K)":
      return "401K";
    case "403B":
    case "403(B)":
      return "403B";
    case "SEP_IRA":
    case "SEP IRA":
    case "SEP":
      return "SEP_IRA";
    case "SIMPLE_IRA":
    case "SIMPLE IRA":
      return "SIMPLE_IRA";
    case "529":
      return "529";
    case "HSA":
      return "HSA";
    case "MARGIN":
    case "MARGIN_ACCOUNT":
      return "MARGIN";
    case "CASH":
    case "CASH_ACCOUNT":
      return "CASH";
    case "INVESTMENT":
    case "BROKERAGE":
    case "INDIVIDUAL":
      return "INVESTMENT";
    case "JOINT":
    case "JOINT_ACCOUNT":
      return "JOINT";
    case "CORPORATE":
    case "BUSINESS":
      return "CORPORATE";
    case "TRUST":
      return "TRUST";
    default:
      if (rawType.includes("RRSP")) return "RRSP";
      if (rawType.includes("TFSA")) return "TFSA";
      if (rawType.includes("MARGIN")) return "MARGIN";
      if (rawType.includes("CASH")) return "CASH";
      if (rawType.includes("IRA")) return "IRA";
      if (rawType.includes("401")) return "401K";
      return "SECURITIES";
  }
}

function findPlatformForBrokerAccount(
  db: Database,
  account: Record<string, unknown>,
): string | null {
  const platforms = db
    .query<
      { id: string; name: string | null; external_id: string | null },
      []
    >("SELECT id, name, external_id FROM platforms")
    .all();
  const externalIds = brokerAccountExternalIdCandidates(account);
  for (const candidate of externalIds) {
    const match = platforms.find((platform) => platform.external_id === candidate);
    if (match) return match.id;
  }
  const names = brokerAccountNameCandidates(account);
  for (const candidate of names) {
    const candidateNorm = normalizePlatformMatch(candidate);
    for (const platform of platforms) {
      if (
        normalizePlatformMatch(platform.id) === candidateNorm ||
        isConfidentPlatformPartialMatch(candidateNorm, normalizePlatformMatch(platform.id)) ||
        (platform.name !== null &&
          (normalizePlatformMatch(platform.name) === candidateNorm ||
            isConfidentPlatformPartialMatch(candidateNorm, normalizePlatformMatch(platform.name))))
      ) {
        return platform.id;
      }
    }
  }
  return null;
}

function brokerAccountNameCandidates(account: Record<string, unknown>): string[] {
  const meta = isRecord(account.meta) ? account.meta : {};
  const values = [
    account.institution_name,
    readPath(meta, ["institution_name"]),
    readPath(meta, ["institutionName"]),
    readPath(meta, ["brokerage_name"]),
    readPath(meta, ["brokerageName"]),
    readPath(meta, ["institution", "name"]),
    readPath(meta, ["brokerage", "name"]),
    readPath(meta, ["brokerage", "display_name"]),
    readPath(meta, ["brokerage", "displayName"]),
  ].flatMap((value) => {
    const parsed = optionalString(value);
    return parsed ? [parsed] : [];
  });
  return [...new Set(values)].sort();
}

function brokerAccountExternalIdCandidates(account: Record<string, unknown>): string[] {
  const meta = isRecord(account.meta) ? account.meta : {};
  const values = [
    readPath(meta, ["brokerage_id"]),
    readPath(meta, ["brokerageId"]),
    readPath(meta, ["brokerage", "id"]),
    readPath(meta, ["brokerage", "uuid"]),
    account.brokerage_authorization,
  ].flatMap((value) => {
    const parsed = optionalString(value);
    return parsed ? [parsed] : [];
  });
  return [...new Set(values)].sort();
}

function brokerAccountMeta(account: Record<string, unknown>): Record<string, unknown> {
  return {
    institution_name: optionalString(account.institution_name),
    brokerage_authorization: optionalString(account.brokerage_authorization),
    created_date: optionalString(account.created_date),
    status: optionalString(account.status),
    raw_type: optionalString(account.raw_type),
    is_paper: optionalBoolean(account.is_paper) ?? false,
    sync_enabled: optionalBoolean(account.sync_enabled) ?? true,
    shared_with_household: optionalBoolean(account.shared_with_household) ?? false,
    sync_status: account.sync_status ?? null,
    owner: brokerAccountOwnerMeta(account.owner),
  };
}

function brokerAccountOwnerMeta(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    user_id: optionalString(value.user_id),
    full_name: optionalString(value.full_name ?? value.user_full_name),
    email: optionalString(value.email),
    avatar_url: optionalString(value.avatar_url),
    is_own_account: optionalBoolean(value.is_own_account) ?? false,
  };
}

function normalizePlatformMatch(value: string): string {
  return value.toUpperCase().replace(/[ -]/g, "_");
}

function isConfidentPlatformPartialMatch(left: string, right: string): boolean {
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  if (shorter.length < 6 || !longer.includes(shorter)) {
    return false;
  }
  return shorter.split("_").some((token) => token.length >= 3 && longer.includes(token));
}

function readPath(record: Record<string, unknown>, path: string[]): unknown {
  let value: unknown = record;
  for (const key of path) {
    if (!isRecord(value)) {
      return undefined;
    }
    value = value[key];
  }
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function assertOptionalConnectStringField(
  record: Record<string, unknown>,
  key: string,
  context: string,
): void {
  const value = record[key];
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw new ConnectServiceError("internal_error", `Failed to parse ${context}`, 500);
  }
}

function assertOptionalConnectBooleanField(
  record: Record<string, unknown>,
  key: string,
  context: string,
): void {
  const value = record[key];
  if (value !== undefined && value !== null && typeof value !== "boolean") {
    throw new ConnectServiceError("internal_error", `Failed to parse ${context}`, 500);
  }
}

function assertDefaultConnectBooleanField(
  record: Record<string, unknown>,
  key: string,
  context: string,
): void {
  const value = record[key];
  if (value !== undefined && typeof value !== "boolean") {
    throw new ConnectServiceError("internal_error", `Failed to parse ${context}`, 500);
  }
}

function assertOptionalConnectObjectField(
  record: Record<string, unknown>,
  key: string,
  context: string,
): void {
  const value = record[key];
  if (value !== undefined && value !== null && !isRecord(value)) {
    throw new ConnectServiceError("internal_error", `Failed to parse ${context}`, 500);
  }
}

function assertOptionalConnectNumberField(
  record: Record<string, unknown>,
  key: string,
  context: string,
): void {
  const value = record[key];
  if (
    value !== undefined &&
    value !== null &&
    (typeof value !== "number" || !Number.isFinite(value))
  ) {
    throw new ConnectServiceError("internal_error", `Failed to parse ${context}`, 500);
  }
}

function assertOptionalConnectI32Field(
  record: Record<string, unknown>,
  key: string,
  context: string,
): void {
  const value = record[key];
  if (value !== undefined && value !== null && !isI32Integer(value)) {
    throw new ConnectServiceError("internal_error", `Failed to parse ${context}`, 500);
  }
}

function normalizeConnectApiUrl(value: string | undefined): string {
  const trimmed = value?.trim().replace(/\/+$/, "");
  return trimmed || DEFAULT_CONNECT_API_URL;
}

function normalizeConnectAuthUrl(value: string | undefined): string {
  const trimmed = value?.trim().replace(/\/+$/, "");
  return trimmed || DEFAULT_CONNECT_AUTH_URL;
}

function normalizeConnectPublishableKey(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed || DEFAULT_CONNECT_AUTH_PUBLISHABLE_KEY;
}

function parseRefreshTokenResponse(bodyText: string): {
  accessToken: string;
  refreshToken: string | null;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch (error) {
    throw new ConnectServiceError(
      "internal_error",
      `Failed to parse token response: ${errorMessage(error)}`,
      500,
    );
  }
  if (!isRecord(parsed) || typeof parsed.access_token !== "string" || !parsed.access_token.trim()) {
    throw new ConnectServiceError("internal_error", "Failed to parse token response", 500);
  }
  assertRefreshTokenResponseRawShape(bodyText);
  if (
    parsed.refresh_token !== undefined &&
    parsed.refresh_token !== null &&
    typeof parsed.refresh_token !== "string"
  ) {
    throw new ConnectServiceError("internal_error", "Failed to parse token response", 500);
  }
  const refreshToken =
    typeof parsed.refresh_token === "string" && parsed.refresh_token.trim()
      ? parsed.refresh_token.trim()
      : null;
  return { accessToken: parsed.access_token, refreshToken };
}

function assertRefreshTokenResponseRawShape(rawJson: string): void {
  for (const aliases of [["access_token"], ["refresh_token"], ["expires_in"]]) {
    if (rawTokensForAliases(rawJson, aliases).length > 1) {
      throw new ConnectServiceError("internal_error", "Failed to parse token response", 500);
    }
  }
  for (const token of rawTokensForAliases(rawJson, ["access_token"])) {
    if (!rawJsonStringTokenIsValid(token)) {
      throw new ConnectServiceError("internal_error", "Failed to parse token response", 500);
    }
  }
  for (const token of rawTokensForAliases(rawJson, ["refresh_token"])) {
    const trimmed = token.trim();
    if (trimmed !== "null" && !rawJsonStringTokenIsValid(trimmed)) {
      throw new ConnectServiceError("internal_error", "Failed to parse token response", 500);
    }
  }
  for (const token of rawTokensForAliases(rawJson, ["expires_in"])) {
    if (!rawJsonI64OptionTokenIsValid(token)) {
      throw new ConnectServiceError("internal_error", "Failed to parse token response", 500);
    }
  }
}

function parseRefreshError(status: number, bodyText: string): { code: string; message: string } {
  const trimmed = bodyText.trim();
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed);
      if (isRecord(parsed)) {
        if (!validRefreshErrorResponseShape(trimmed, parsed)) {
          return { code: "", message: trimmed };
        }
        const description =
          typeof parsed.error_description === "string" ? parsed.error_description.trim() : "";
        const error = typeof parsed.error === "string" ? parsed.error.trim() : "";
        const errorCode = typeof parsed.error_code === "string" ? parsed.error_code.trim() : error;
        const message = typeof parsed.msg === "string" ? parsed.msg.trim() : "";
        return { code: errorCode, message: description || message || error || trimmed };
      }
    } catch {
      return { code: "", message: trimmed };
    }
  }
  return { code: "", message: `HTTP ${status}` };
}

function validRefreshErrorResponseShape(rawJson: string, parsed: Record<string, unknown>): boolean {
  if (
    rawTokensForAliases(rawJson, ["error"]).length > 1 ||
    rawTokensForAliases(rawJson, ["error_description"]).length > 1
  ) {
    return false;
  }
  return (
    (parsed.error === undefined || parsed.error === null || typeof parsed.error === "string") &&
    (parsed.error_description === undefined ||
      parsed.error_description === null ||
      typeof parsed.error_description === "string")
  );
}

function connectApiErrorMessage(status: number, bodyText: string): string {
  const trimmed = bodyText.trim();
  if (!trimmed) {
    return `API error ${status}`;
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (isRecord(parsed)) {
      if (!validConnectApiErrorResponseShape(trimmed, parsed)) {
        return `API error ${status}`;
      }
      const message = optionalString(parsed.message) ?? optionalString(parsed.error);
      return `API error ${status}: ${message ?? `HTTP ${status}`}`;
    }
  } catch {
    return `API error ${status}`;
  }
  return `API error ${status}`;
}

function validConnectApiErrorResponseShape(
  rawJson: string,
  parsed: Record<string, unknown>,
): boolean {
  if (
    rawTokensForAliases(rawJson, ["error"]).length > 1 ||
    rawTokensForAliases(rawJson, ["code"]).length > 1 ||
    rawTokensForAliases(rawJson, ["message"]).length > 1
  ) {
    return false;
  }
  return (
    (parsed.error === undefined || parsed.error === null || typeof parsed.error === "string") &&
    (parsed.code === undefined || parsed.code === null || typeof parsed.code === "string") &&
    (parsed.message === undefined || parsed.message === null || typeof parsed.message === "string")
  );
}

function connectRequestHeaders(): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-wf-client-request-id": `app:${randomUUID()}`,
  };
}

function isSessionInvalid(status: number, message: string, code = ""): boolean {
  if (status === 401 || status === 403) {
    return true;
  }
  return (
    /(invalid[_\s-]?grant|refresh_token_not_found)/i.test(code) ||
    /(invalid[_\s-]?grant|invalid refresh|refresh token.*not found|jwt.*expired|expired)/i.test(
      message,
    )
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

interface SyncEngineStateRow {
  last_push_at: string | null;
  last_pull_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
  next_retry_at: string | null;
  last_cycle_status: string | null;
  last_cycle_duration_ms: number | null;
}

interface SyncCursorRow {
  cursor: number;
}

interface LocalSyncOutboxRow {
  event_id: string;
  entity: string;
  entity_id: string;
  op: string;
  client_timestamp: string;
  payload: string;
  payload_key_version: number;
  retry_count: number;
}

type LocalReplayEntity =
  | "account"
  | "platform"
  | "portfolio"
  | "portfolio_account"
  | "contribution_limit"
  | "custom_provider"
  | "custom_taxonomy"
  | "goal"
  | "goal_plan"
  | "goals_allocation"
  | "import_template"
  | "activity"
  | "activity_import_profile"
  | "import_run"
  | "ai_thread"
  | "ai_message"
  | "ai_thread_tag"
  | "asset_taxonomy_assignment"
  | "quote"
  | "snapshot"
  | "asset";

const APP_SYNC_TABLES = [
  "platforms",
  "assets",
  "market_data_custom_providers",
  "quotes",
  "goals",
  "goal_plans",
  "ai_threads",
  "contribution_limits",
  "accounts",
  "import_runs",
  "activities",
  "import_templates",
  "import_account_templates",
  "taxonomies",
  "taxonomy_categories",
  "asset_taxonomy_assignments",
  "goals_allocation",
  "ai_messages",
  "ai_thread_tags",
  "holdings_snapshots",
  "portfolios",
  "portfolio_accounts",
] as const;

const SNAPSHOT_EXPORT_FILTERS: Partial<Record<(typeof APP_SYNC_TABLES)[number], string>> = {
  holdings_snapshots: "source IN ('MANUAL_ENTRY', 'CSV_IMPORT', 'SYNTHETIC', 'BROKER_IMPORTED')",
  quotes: "source = 'MANUAL'",
  taxonomies: "is_system = 0",
  taxonomy_categories: "taxonomy_id = 'custom_groups'",
  import_runs: "UPPER(run_type) = 'IMPORT' AND UPPER(source_system) IN ('CSV', 'MANUAL')",
  activities:
    "is_user_modified = 1 OR UPPER(COALESCE(source_system, '')) IN ('MANUAL', 'CSV') OR ((import_run_id IS NULL OR TRIM(import_run_id) = '') AND (source_record_id IS NULL OR TRIM(source_record_id) = ''))",
};

const SNAPSHOT_UPLOAD_MAX_ATTEMPTS = 5;
const SNAPSHOT_UPLOAD_BASE_BACKOFF_MS = 250;
const SNAPSHOT_UPLOAD_MAX_BACKOFF_MS = 8_000;
const DEVICE_SYNC_BACKGROUND_INTERVAL_MS = 5 * 60 * 1000;
const DEVICE_SYNC_OUTBOX_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEVICE_SYNC_SENT_OUTBOX_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DEVICE_SYNC_DEAD_OUTBOX_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

class LocalPullStaleCursorError extends Error {
  constructor(
    message: string,
    readonly snapshotId: string | null = null,
    readonly snapshotSeq: number | null = null,
  ) {
    super(message);
    this.name = "LocalPullStaleCursorError";
  }
}

class LocalPushSyncFailureError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errorCode: string | null,
  ) {
    super(message);
    this.name = "LocalPushSyncFailureError";
  }
}

class LocalSnapshotUploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly cloudMessage: string | null,
  ) {
    super(message);
    this.name = "LocalSnapshotUploadError";
  }
}

class LocalReplayApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalReplayApplyError";
  }
}

const STALE_PULL_ERROR_CODES = new Set([
  "SYNC_CURSOR_TOO_OLD",
  "SYNC_SEGMENT_OBJECT_MISSING",
  "SYNC_SEGMENT_OFFSET_INVALID",
  "SYNC_SEGMENT_CHECKSUM_MISMATCH",
  "SYNC_SEGMENT_STREAM_MISMATCH",
  "SYNC_EVENT_INDEX_MISMATCH",
  "SYNC_SNAPSHOT_OBJECT_MISSING",
  "SYNC_SNAPSHOT_CHECKSUM_MISMATCH",
]);

interface SyncDeviceConfigRow {
  device_id: string;
  last_bootstrap_at: string | null;
}

export function createLocalConnectDeviceSyncService({
  db,
  secretService,
  env = process.env,
  fetch: fetchImpl = fetch,
  restoreSyncSession,
  eventBus,
  appVersion,
  deviceDisplayName = DEVICE_ENROLL_DISPLAY_NAME,
  platform = detectDevicePlatform(process.platform),
  reinitializeDelayMs = 350,
  backgroundOutboxPruneIntervalMs = DEVICE_SYNC_OUTBOX_PRUNE_INTERVAL_MS,
}: LocalConnectDeviceSyncServiceDependencies): ConnectDeviceSyncService {
  const disabledService = createDisabledConnectDeviceSyncService();
  const runWithEnrollLock = createAsyncOperationLock();
  const runWithSessionRestoreLock = createAsyncOperationLock();
  const runWithSnapshotGenerationLock = createAsyncOperationLock();
  const readyStateOverwriteApprovals = new Set<string>();
  let snapshotUploadCancelled = false;
  let backgroundRunning = false;
  let backgroundCycleInFlight = false;
  let backgroundCyclePromise: Promise<void> | null = null;
  let backgroundLifecycleVersion = 0;
  let backgroundNextOutboxPruneAt = Date.now() + backgroundOutboxPruneIntervalMs;
  let backgroundTimer: ReturnType<typeof setTimeout> | null = null;
  const clearBackgroundTimer = () => {
    if (backgroundTimer !== null) {
      clearTimeout(backgroundTimer);
      backgroundTimer = null;
    }
  };
  const scheduleBackgroundCycle = (delayMs: number) => {
    clearBackgroundTimer();
    backgroundTimer = setTimeout(() => {
      backgroundTimer = null;
      void runBackgroundCycle();
    }, delayMs);
    unrefTimer(backgroundTimer);
  };
  const runBackgroundCycle = async () => {
    if (!backgroundRunning || backgroundCycleInFlight) {
      return;
    }
    backgroundCycleInFlight = true;
    const cycle = (async () => {
      let shouldPruneAfterCycle = false;
      try {
        if (!(await localSyncIdentityCanRunBackground(secretService))) {
          backgroundRunning = false;
          clearBackgroundTimer();
          return;
        }
        shouldPruneAfterCycle = true;
        await triggerLocalDeviceSyncCycle(
          db,
          secretService,
          env,
          fetchImpl,
          restoreDeviceSyncSession,
        );
      } catch (error) {
        console.warn(`[Connect] Device sync background cycle failed: ${errorMessage(error)}`);
      } finally {
        if (shouldPruneAfterCycle) {
          try {
            const now = Date.now();
            if (now >= backgroundNextOutboxPruneAt) {
              backgroundNextOutboxPruneAt = now + backgroundOutboxPruneIntervalMs;
              localPruneSyncOutbox(db, now);
            }
          } catch (error) {
            console.warn(`[Connect] Failed to prune sync outbox: ${errorMessage(error)}`);
          }
        }
        backgroundCycleInFlight = false;
        if (backgroundRunning) {
          scheduleBackgroundCycle(DEVICE_SYNC_BACKGROUND_INTERVAL_MS);
        }
      }
    })();
    backgroundCyclePromise = cycle;
    try {
      await cycle;
    } finally {
      if (backgroundCyclePromise === cycle) {
        backgroundCyclePromise = null;
      }
    }
  };
  const stopBackgroundEngine = async () => {
    backgroundLifecycleVersion += 1;
    backgroundRunning = false;
    clearBackgroundTimer();
    const cycle = backgroundCyclePromise;
    if (cycle) {
      await cycle;
    }
  };
  const restoreDeviceSyncSession = () => {
    if (!secretService) {
      throw deviceSyncDisabled();
    }
    if (restoreSyncSession) {
      return Promise.resolve(restoreSyncSession()).then(restoredConnectSessionFromValue);
    }
    return runWithSessionRestoreLock(() =>
      restoreLocalSyncSession(secretService, env, fetchImpl, () => 0),
    );
  };
  return {
    ...disabledService,
    async getDeviceSyncState() {
      if (!secretService) {
        throw deviceSyncDisabled();
      }
      const session = await restoreDeviceSyncSession();
      return await getLocalDeviceSyncState(secretService, env, fetchImpl, session.accessToken);
    },
    async enableDeviceSync() {
      if (!secretService) {
        throw deviceSyncDisabled();
      }
      return await runWithEnrollLock(async () => {
        const session = await restoreDeviceSyncSession();
        return await enableLocalDeviceSync({
          db,
          secretService,
          env,
          fetchImpl,
          accessToken: session.accessToken,
          deviceDisplayName,
          platform,
          appVersion,
        });
      });
    },
    async reinitializeDeviceSync() {
      if (!secretService) {
        throw deviceSyncDisabled();
      }
      return await runWithEnrollLock(async () => {
        const session = await restoreDeviceSyncSession();
        return await reinitializeLocalDeviceSync({
          db,
          secretService,
          env,
          fetchImpl,
          accessToken: session.accessToken,
          deviceDisplayName,
          platform,
          appVersion,
          delayMs: reinitializeDelayMs,
        });
      });
    },
    async reconcileDeviceSyncReadyState(request) {
      if (!secretService) {
        throw deviceSyncDisabled();
      }
      const approvalDeviceId = await readLocalSyncIdentityDeviceIdBestEffort(secretService);
      const hadOverwriteApproval =
        approvalDeviceId !== undefined &&
        approvalDeviceId !== null &&
        readyStateOverwriteApprovals.has(approvalDeviceId);
      if (request.allowOverwrite && approvalDeviceId) {
        readyStateOverwriteApprovals.add(approvalDeviceId);
      }
      let result: Record<string, unknown> = localReadyReconcileBase();
      try {
        const session = await restoreDeviceSyncSession();
        const state = await getLocalDeviceSyncState(
          secretService,
          env,
          fetchImpl,
          session.accessToken,
        );
        if (state.state !== "READY") {
          result = {
            ...localReadyReconcileBase(),
            status: "skipped_not_ready",
            message: "Device is not in READY state",
          };
          return result;
        }
        const bootstrap = await bootstrapSnapshotIfNotReady(
          db,
          secretService,
          env,
          fetchImpl,
          restoreDeviceSyncSession,
          eventBus,
        );
        const bootstrapStatus = optionalString(bootstrap.status) ?? "not_attempted";
        const bootstrapSnapshotId = optionalString(bootstrap.snapshotId);
        result = {
          ...localReadyReconcileBase(),
          bootstrapStatus,
          bootstrapMessage: optionalString(bootstrap.message),
          bootstrapSnapshotId,
          bootstrapAction: localReadyReconcileBootstrapAction(bootstrapStatus, bootstrapSnapshotId),
        };
        return result;
      } catch (error) {
        if (error instanceof ConnectNotImplementedError) {
          result = localReadyReconcileError(`Snapshot bootstrap failed: ${error.message}`);
          return result;
        }
        result = localReadyReconcileError(`Failed to read sync state: ${errorMessage(error)}`);
        return result;
      } finally {
        if (approvalDeviceId) {
          if (
            (request.allowOverwrite || hadOverwriteApproval) &&
            localReadyReconcileShouldKeepOverwriteApproval(result!)
          ) {
            readyStateOverwriteApprovals.add(approvalDeviceId);
          } else {
            readyStateOverwriteApprovals.delete(approvalDeviceId);
          }
        }
      }
    },
    async getDeviceSyncEngineStatus() {
      return {
        ...(await getLocalDeviceSyncEngineStatus(db, secretService)),
        backgroundRunning,
      };
    },
    async getDeviceSyncBootstrapOverwriteCheck() {
      return getLocalDeviceSyncBootstrapOverwriteCheck(
        db,
        secretService,
        readyStateOverwriteApprovals,
      );
    },
    async clearDeviceSyncData() {
      if (!secretService) {
        throw deviceSyncDisabled();
      }
      await stopBackgroundEngine();
      await runWithEnrollLock(() => clearLocalDeviceSyncData(db, secretService));
    },
    async getDeviceSyncPairingSourceStatus() {
      return await getLocalDeviceSyncPairingSourceStatus(
        db,
        secretService,
        env,
        fetchImpl,
        restoreDeviceSyncSession,
      );
    },
    async bootstrapDeviceSnapshot() {
      return await bootstrapSnapshotIfNotReady(
        db,
        secretService,
        env,
        fetchImpl,
        restoreDeviceSyncSession,
        eventBus,
      );
    },
    async generateDeviceSnapshotNow() {
      return await runWithSnapshotGenerationLock(async () => {
        snapshotUploadCancelled = false;
        return await generateSnapshotIfTrusted(
          db,
          secretService,
          env,
          fetchImpl,
          restoreDeviceSyncSession,
          () => snapshotUploadCancelled,
        );
      });
    },
    async startDeviceSyncBackgroundEngine() {
      const startVersion = ++backgroundLifecycleVersion;
      if (!(await localSyncIdentityCanRunBackground(secretService))) {
        return {
          status: "skipped",
          message: "Background engine not started because sync identity is not configured",
        };
      }
      if (!secretService) {
        return {
          status: "skipped",
          message: "Background engine not started because sync identity is not configured",
        };
      }
      let session: { accessToken: string; refreshToken: string };
      try {
        session = await restoreDeviceSyncSession();
      } catch (error) {
        return {
          status: "skipped",
          message: `Background engine not started: ${errorMessage(error)}`,
        };
      }
      const state = await getLocalDeviceSyncState(
        secretService,
        env,
        fetchImpl,
        session.accessToken,
      );
      if (startVersion !== backgroundLifecycleVersion) {
        return {
          status: "skipped",
          message: "Background engine not started because start was cancelled",
        };
      }
      if (state.state !== "READY") {
        return {
          status: "skipped",
          message: "Background engine not started because device is not in READY state",
        };
      }
      if (!backgroundRunning) {
        backgroundRunning = true;
        scheduleBackgroundCycle(0);
      }
      return {
        status: "started",
        message: "Device sync background engine started",
      };
    },
    async stopDeviceSyncBackgroundEngine() {
      await stopBackgroundEngine();
      return {
        status: "stopped",
        message: "Device sync background engine stopped",
      };
    },
    async triggerDeviceSyncCycle() {
      return await triggerLocalDeviceSyncCycle(
        db,
        secretService,
        env,
        fetchImpl,
        restoreDeviceSyncSession,
      );
    },
    cancelDeviceSnapshotUpload() {
      snapshotUploadCancelled = true;
      return {
        status: "cancel_requested",
        message: "Snapshot upload cancellation requested",
      };
    },
  };
}

interface EnableLocalDeviceSyncOptions {
  db: Database;
  secretService: SecretService;
  env: NodeJS.ProcessEnv;
  fetchImpl: typeof fetch;
  accessToken: string;
  deviceDisplayName: string;
  platform: string;
  appVersion?: string;
}

interface ReinitializeLocalDeviceSyncOptions extends EnableLocalDeviceSyncOptions {
  delayMs: number;
}

interface StoredSyncIdentity {
  version: number;
  deviceNonce: string | null;
  deviceId: string | null;
  rootKey: string | null;
  keyVersion: number | null;
  deviceSecretKey: string | null;
  devicePublicKey: string | null;
}

type EnrollDeviceResponse =
  | { mode: "BOOTSTRAP"; deviceId: string; e2eeKeyVersion: number }
  | {
      mode: "PAIR";
      deviceId: string;
      e2eeKeyVersion: number;
      requireSas: boolean;
      pairingTtlSeconds: number;
      trustedDevices: Array<Record<string, unknown>>;
    }
  | { mode: "READY"; deviceId: string; e2eeKeyVersion: number; trustState: string };

type InitializeTeamKeysResult =
  | { mode: "BOOTSTRAP"; challenge: string; nonce: string; keyVersion: number }
  | {
      mode: "PAIRING_REQUIRED";
      e2eeKeyVersion: number;
      requireSas: boolean;
      pairingTtlSeconds: number;
      trustedDevices: Array<Record<string, unknown>>;
    }
  | { mode: "READY"; e2eeKeyVersion: number };

type KeyInitializationOutcome =
  | { kind: "initialized"; keyVersion: number }
  | {
      kind: "pairing_required";
      serverKeyVersion: number;
      trustedDevices: Array<Record<string, unknown>>;
    };

type RestoredConnectSession = { accessToken: string; refreshToken: string };

type RestoreConnectSession = () => Promise<RestoredConnectSession>;

function createAsyncOperationLock(): <T>(operation: () => Promise<T>) => Promise<T> {
  let tail: Promise<void> = Promise.resolve();
  return async (operation) => {
    const previous = tail;
    let release: () => void = () => undefined;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  };
}

function restoredConnectSessionFromValue(value: unknown): RestoredConnectSession {
  if (!isRecord(value) || typeof value.accessToken !== "string" || !value.accessToken.trim()) {
    throw new ConnectServiceError("internal_error", "Failed to restore Connect access token", 500);
  }
  return {
    accessToken: value.accessToken,
    refreshToken: typeof value.refreshToken === "string" ? value.refreshToken : "",
  };
}

async function enableLocalDeviceSync(
  options: EnableLocalDeviceSyncOptions,
): Promise<Record<string, unknown>> {
  const identity = await readStoredSyncIdentityOrDefault(options.secretService);
  await ensureLocalDeviceNonce(options.secretService, identity);
  const existingResult = await tryResumeExistingLocalSync(options);
  if (existingResult) {
    await applyLocalEnableSyncSideEffects(options.db, options.secretService, existingResult);
    return existingResult;
  }

  return await enableLocalDeviceSyncInner(options);
}

async function reinitializeLocalDeviceSync(
  options: ReinitializeLocalDeviceSyncOptions,
): Promise<Record<string, unknown>> {
  const existingIdentity = await readStoredSyncIdentityOrDefault(options.secretService);
  const deviceNonce = existingIdentity.deviceNonce ?? randomUUID();
  await resetLocalTeamSyncChecked(options);
  if (options.delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, options.delayMs));
  }
  await saveStoredSyncIdentity(options.secretService, freshSyncIdentity(deviceNonce));
  return await enableLocalDeviceSyncInner(options);
}

async function enableLocalDeviceSyncInner(
  options: EnableLocalDeviceSyncOptions,
): Promise<Record<string, unknown>> {
  const identity = await readStoredSyncIdentityOrDefault(options.secretService);
  const deviceNonce = await ensureLocalDeviceNonce(options.secretService, identity);
  const enrollResponse = await enrollLocalDevice(options, deviceNonce);

  if (enrollResponse.mode === "PAIR") {
    await saveEnrolledSyncIdentity(options.secretService, deviceNonce, enrollResponse.deviceId);
    if (enrollResponse.trustedDevices.length > 0) {
      const result = {
        deviceId: enrollResponse.deviceId,
        state: "REGISTERED",
        keyVersion: null,
        serverKeyVersion: enrollResponse.e2eeKeyVersion,
        needsPairing: true,
        trustedDevices: enrollResponse.trustedDevices,
      };
      await applyLocalEnableSyncSideEffects(options.db, options.secretService, result);
      return result;
    }
    const outcome = await initializeLocalE2eeKeys(options, enrollResponse.deviceId);
    const result = localEnableResultFromKeyInitialization(enrollResponse.deviceId, outcome);
    await applyLocalEnableSyncSideEffects(options.db, options.secretService, result);
    return result;
  }

  await saveEnrolledSyncIdentity(options.secretService, deviceNonce, enrollResponse.deviceId);
  const outcome = await initializeLocalE2eeKeys(options, enrollResponse.deviceId);
  const result = localEnableResultFromKeyInitialization(enrollResponse.deviceId, outcome);
  await applyLocalEnableSyncSideEffects(options.db, options.secretService, result);
  return result;
}

async function tryResumeExistingLocalSync(
  options: EnableLocalDeviceSyncOptions,
): Promise<Record<string, unknown> | null> {
  const identity = await readStoredSyncIdentityOrDefault(options.secretService);
  if (!identity.deviceId) {
    return null;
  }
  const state = await getLocalDeviceSyncState(
    options.secretService,
    options.env,
    options.fetchImpl,
    options.accessToken,
  );
  if (state.state === "READY" || state.state === "REGISTERED" || state.state === "STALE") {
    return enableSyncResultFromState(state);
  }
  return null;
}

async function ensureLocalDeviceNonce(
  secretService: SecretService,
  identity: StoredSyncIdentity,
): Promise<string> {
  if (identity.deviceNonce) {
    return identity.deviceNonce;
  }
  const deviceNonce = randomUUID();
  await saveStoredSyncIdentity(secretService, { ...identity, version: 2, deviceNonce });
  return deviceNonce;
}

async function enrollLocalDevice(
  options: EnableLocalDeviceSyncOptions,
  deviceNonce: string,
): Promise<EnrollDeviceResponse> {
  const response = await fetchConnectDeviceSyncJsonRaw(
    options.env,
    options.fetchImpl,
    options.accessToken,
    "/api/v1/sync/team/devices",
    {
      method: "POST",
      body: {
        device_nonce: deviceNonce,
        display_name: options.deviceDisplayName,
        platform: options.platform,
        os_version: undefined,
        app_version: options.appVersion,
      },
    },
  );
  return enrollDeviceResponseFromCloud(response.value, response.bodyText);
}

async function initializeLocalE2eeKeys(
  options: EnableLocalDeviceSyncOptions,
  deviceId: string,
): Promise<KeyInitializationOutcome> {
  const initResponse = await fetchConnectDeviceSyncJsonRaw(
    options.env,
    options.fetchImpl,
    options.accessToken,
    "/api/v1/sync/team/keys/initialize",
    {
      method: "POST",
      deviceId,
      body: { device_id: deviceId },
    },
  );
  const initResult = initializeTeamKeysResultFromCloud(initResponse.value, initResponse.bodyText);

  if (initResult.mode === "PAIRING_REQUIRED") {
    return {
      kind: "pairing_required",
      serverKeyVersion: initResult.e2eeKeyVersion,
      trustedDevices: initResult.trustedDevices,
    };
  }
  if (initResult.mode === "READY") {
    return {
      kind: "pairing_required",
      serverKeyVersion: initResult.e2eeKeyVersion,
      trustedDevices: await getTrustedDevicesBestEffort(
        options.env,
        options.fetchImpl,
        options.accessToken,
      ),
    };
  }

  const crypto = createSyncCryptoService();
  const rootKey = (await crypto.generateRootKey()).value;
  const deviceKeypair = await crypto.generateKeypair();
  const envelopeKey = (await crypto.deriveSessionKey(rootKey, "envelope")).value;
  const deviceKeyEnvelope = (await crypto.encrypt(envelopeKey, rootKey)).value;
  const signature = (
    await crypto.hmacSha256(
      rootKey,
      `${initResult.challenge}:${initResult.keyVersion}:${deviceKeyEnvelope}`,
    )
  ).value;
  const challengeResponse = createHash("sha256")
    .update(`${initResult.challenge}:${initResult.nonce}`, "utf8")
    .digest("hex");

  const commitResponse = await fetchConnectDeviceSyncJsonRaw(
    options.env,
    options.fetchImpl,
    options.accessToken,
    "/api/v1/sync/team/keys/initialize/commit",
    {
      method: "POST",
      deviceId,
      body: {
        device_id: deviceId,
        key_version: initResult.keyVersion,
        device_key_envelope: deviceKeyEnvelope,
        signature,
        challenge_response: challengeResponse,
      },
    },
  );
  const commitResult = commitInitializeKeysResponseFromCloud(
    commitResponse.value,
    commitResponse.bodyText,
  );
  if (!commitResult.success) {
    throw new ConnectServiceError("internal_error", "Server rejected key commitment", 500);
  }

  const identity = await readStoredSyncIdentityOrDefault(options.secretService);
  await saveStoredSyncIdentity(options.secretService, {
    ...identity,
    deviceId,
    rootKey,
    keyVersion: initResult.keyVersion,
    deviceSecretKey: deviceKeypair.secretKey,
    devicePublicKey: deviceKeypair.publicKey,
  });
  return { kind: "initialized", keyVersion: initResult.keyVersion };
}

function localEnableResultFromKeyInitialization(
  deviceId: string,
  outcome: KeyInitializationOutcome,
): Record<string, unknown> {
  if (outcome.kind === "initialized") {
    return {
      deviceId,
      state: "READY",
      keyVersion: outcome.keyVersion,
      serverKeyVersion: outcome.keyVersion,
      needsPairing: false,
      trustedDevices: [],
    };
  }
  const orphaned = outcome.trustedDevices.length === 0 && outcome.serverKeyVersion > 0;
  return {
    deviceId,
    state: orphaned ? "ORPHANED" : "REGISTERED",
    keyVersion: null,
    serverKeyVersion: outcome.serverKeyVersion,
    needsPairing: !orphaned,
    trustedDevices: outcome.trustedDevices,
  };
}

async function applyLocalEnableSyncSideEffects(
  db: Database,
  secretService: SecretService,
  result: Record<string, unknown>,
): Promise<void> {
  const deviceId = requiredStringValue(result.deviceId, "enable sync response");
  await secretService.setSecret(DEVICE_SYNC_DEVICE_ID_KEY, deviceId);
  clearAllDeviceSyncFreshnessGates(db);
  if (result.state !== "READY" || !sqliteTableExists(db, "sync_device_config")) {
    return;
  }
  const keyVersion = optionalNumber(result.keyVersion);
  if (keyVersion === null) {
    throw new ConnectServiceError(
      "internal_error",
      "Missing key version in enable sync result",
      500,
    );
  }
  resetAndMarkLocalBootstrapComplete(db, {
    deviceNonce: null,
    deviceId,
    rootKey: null,
    keyVersion,
  });
}

async function resetLocalTeamSyncChecked(
  options: ReinitializeLocalDeviceSyncOptions,
): Promise<void> {
  const resetResponse = await fetchConnectDeviceSyncJsonRaw(
    options.env,
    options.fetchImpl,
    options.accessToken,
    "/api/v1/sync/team/keys/reset",
    {
      method: "POST",
      body: { reason: RESET_REASON_REINITIALIZE },
    },
  );
  const resetResult = resetTeamSyncResponseFromCloud(resetResponse.value, resetResponse.bodyText);
  if (!resetResult.success) {
    throw new ConnectServiceError(
      "internal_error",
      "Team sync reset was not accepted. Please verify account permissions and try again.",
      500,
    );
  }
}

async function readStoredSyncIdentityOrDefault(
  secretService: SecretService,
): Promise<StoredSyncIdentity> {
  const rawIdentity = await secretService.getSecret(DEVICE_SYNC_IDENTITY_KEY);
  if (rawIdentity === null) {
    return freshSyncIdentity(null);
  }
  const parsed = parseStoredSyncIdentity(rawIdentity);
  return {
    version: 2,
    deviceNonce: parsed.deviceNonce,
    deviceId: parsed.deviceId,
    rootKey: parsed.rootKey,
    keyVersion: parsed.keyVersion,
    deviceSecretKey: optionalString(
      (JSON.parse(rawIdentity) as Record<string, unknown>).deviceSecretKey,
    ),
    devicePublicKey: optionalString(
      (JSON.parse(rawIdentity) as Record<string, unknown>).devicePublicKey,
    ),
  };
}

function freshSyncIdentity(deviceNonce: string | null): StoredSyncIdentity {
  return {
    version: 2,
    deviceNonce,
    deviceId: null,
    rootKey: null,
    keyVersion: null,
    deviceSecretKey: null,
    devicePublicKey: null,
  };
}

async function saveEnrolledSyncIdentity(
  secretService: SecretService,
  deviceNonce: string,
  deviceId: string,
): Promise<void> {
  await saveStoredSyncIdentity(secretService, {
    ...freshSyncIdentity(deviceNonce),
    deviceId,
  });
}

async function saveStoredSyncIdentity(
  secretService: SecretService,
  identity: StoredSyncIdentity,
): Promise<void> {
  await secretService.setSecret(
    DEVICE_SYNC_IDENTITY_KEY,
    JSON.stringify({
      version: 2,
      deviceNonce: identity.deviceNonce,
      deviceId: identity.deviceId,
      rootKey: identity.rootKey,
      keyVersion: identity.keyVersion,
      deviceSecretKey: identity.deviceSecretKey,
      devicePublicKey: identity.devicePublicKey,
    }),
  );
}

async function fetchConnectDeviceSyncJsonRaw(
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  accessToken: string,
  path: string,
  options: { method?: string; body?: unknown; deviceId?: string } = {},
): Promise<{ value: unknown; bodyText: string }> {
  let response: Response;
  try {
    const headers: Record<string, string> = {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      "x-wf-client-request-id": deviceSyncClientRequestId(options.deviceId),
    };
    if (options.deviceId !== undefined) {
      headers["x-wf-device-id"] = options.deviceId;
    }
    response = await fetchImpl(`${normalizeConnectApiUrl(env.CONNECT_API_URL)}${path}`, {
      method: options.method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (error) {
    throw new ConnectServiceError("internal_error", errorMessage(error), 500);
  }
  const bodyText = await response.text();
  if (!response.ok) {
    throw new ConnectServiceError(
      "internal_error",
      connectDeviceSyncApiErrorMessage(response.status, bodyText),
      500,
    );
  }
  try {
    return { value: JSON.parse(bodyText) as unknown, bodyText };
  } catch (error) {
    throw new ConnectServiceError(
      "internal_error",
      `Failed to parse device sync response: ${errorMessage(error)}`,
      500,
    );
  }
}

function enrollDeviceResponseFromCloud(
  value: unknown,
  rawJson: string | null = null,
): EnrollDeviceResponse {
  if (!isRecord(value)) {
    throw enrollResponseParseError();
  }
  if (rawJson !== null) {
    assertEnrollResponseRawShape(rawJson);
  }
  const mode = requiredStringValue(value.mode, "enroll response");
  if (mode === "BOOTSTRAP") {
    return {
      mode,
      deviceId: requiredStringValue(value.deviceId ?? value.device_id, "enroll response"),
      e2eeKeyVersion: requiredI32Value(
        value.e2eeKeyVersion ?? value.e2ee_key_version,
        "enroll response",
      ),
    };
  }
  if (mode === "PAIR") {
    return {
      mode,
      deviceId: requiredStringValue(value.deviceId ?? value.device_id, "enroll response"),
      e2eeKeyVersion: requiredI32Value(
        value.e2eeKeyVersion ?? value.e2ee_key_version,
        "enroll response",
      ),
      requireSas: requiredBooleanValue(value.requireSas ?? value.require_sas, "enroll response"),
      pairingTtlSeconds: requiredI32Value(
        value.pairingTtlSeconds ?? value.pairing_ttl_seconds,
        "enroll response",
      ),
      trustedDevices: trustedDevicesFromCloud(value.trustedDevices ?? value.trusted_devices),
    };
  }
  if (mode === "READY") {
    return {
      mode,
      deviceId: requiredStringValue(value.deviceId ?? value.device_id, "enroll response"),
      e2eeKeyVersion: requiredI32Value(
        value.e2eeKeyVersion ?? value.e2ee_key_version,
        "enroll response",
      ),
      trustState: requiredDeviceTrustState(value.trustState ?? value.trust_state),
    };
  }
  throw enrollResponseParseError();
}

function assertEnrollResponseRawShape(rawJson: string): void {
  const modeTokens = rawTokensForAliases(rawJson, ["mode"]);
  if (modeTokens.length !== 1 || !rawJsonStringTokenIsValid(modeTokens[0] ?? "")) {
    throw enrollResponseParseError();
  }
  for (const aliases of [
    ["deviceId", "device_id"],
    ["e2eeKeyVersion", "e2ee_key_version"],
    ["requireSas", "require_sas"],
    ["pairingTtlSeconds", "pairing_ttl_seconds"],
    ["trustedDevices", "trusted_devices"],
    ["trustState", "trust_state"],
  ]) {
    if (rawTokensForAliases(rawJson, aliases).length > 1) {
      throw enrollResponseParseError();
    }
  }
  assertEnrollRawI32Token(rawJson, "e2eeKeyVersion");
  assertEnrollRawI32Token(rawJson, "e2ee_key_version");
  assertEnrollRawI32Token(rawJson, "pairingTtlSeconds");
  assertEnrollRawI32Token(rawJson, "pairing_ttl_seconds");
  assertTrustedDeviceSummariesRawShape(
    rawJson,
    ["trustedDevices", "trusted_devices"],
    "enroll response",
  );
}

function assertEnrollRawI32Token(rawJson: string, key: string): void {
  for (const token of rawTokensForAliases(rawJson, [key])) {
    if (!rawJsonI32TokenIsValid(token)) {
      throw enrollResponseParseError();
    }
  }
}

function enrollResponseParseError(): ConnectServiceError {
  return new ConnectServiceError("internal_error", "Failed to parse enroll response", 500);
}

function initializeTeamKeysResultFromCloud(
  value: unknown,
  rawJson: string | null = null,
): InitializeTeamKeysResult {
  if (!isRecord(value)) {
    throw initializeKeysResponseParseError();
  }
  if (rawJson !== null) {
    assertInitializeKeysResponseRawShape(rawJson);
  }
  const mode = requiredStringValue(value.mode, "initialize keys response");
  if (mode === "BOOTSTRAP") {
    return {
      mode,
      challenge: requiredStringValue(value.challenge, "initialize keys response"),
      nonce: requiredStringValue(value.nonce, "initialize keys response"),
      keyVersion: requiredI32Value(
        value.keyVersion ?? value.key_version,
        "initialize keys response",
      ),
    };
  }
  if (mode === "PAIRING_REQUIRED") {
    return {
      mode,
      e2eeKeyVersion: requiredI32Value(
        value.e2eeKeyVersion ?? value.e2ee_key_version,
        "initialize keys response",
      ),
      requireSas: requiredBooleanValue(
        value.requireSas ?? value.require_sas,
        "initialize keys response",
      ),
      pairingTtlSeconds: requiredI32Value(
        value.pairingTtlSeconds ?? value.pairing_ttl_seconds,
        "initialize keys response",
      ),
      trustedDevices: trustedDevicesFromCloud(value.trustedDevices ?? value.trusted_devices),
    };
  }
  if (mode === "READY") {
    return {
      mode,
      e2eeKeyVersion: requiredI32Value(
        value.e2eeKeyVersion ?? value.e2ee_key_version,
        "initialize keys response",
      ),
    };
  }
  throw initializeKeysResponseParseError();
}

function assertInitializeKeysResponseRawShape(rawJson: string): void {
  const modeTokens = rawTokensForAliases(rawJson, ["mode"]);
  if (modeTokens.length !== 1 || !rawJsonStringTokenIsValid(modeTokens[0] ?? "")) {
    throw initializeKeysResponseParseError();
  }
  for (const aliases of [
    ["challenge"],
    ["nonce"],
    ["keyVersion", "key_version"],
    ["e2eeKeyVersion", "e2ee_key_version"],
    ["requireSas", "require_sas"],
    ["pairingTtlSeconds", "pairing_ttl_seconds"],
    ["trustedDevices", "trusted_devices"],
  ]) {
    if (rawTokensForAliases(rawJson, aliases).length > 1) {
      throw initializeKeysResponseParseError();
    }
  }
  assertInitializeKeysRawI32Token(rawJson, "keyVersion");
  assertInitializeKeysRawI32Token(rawJson, "key_version");
  assertInitializeKeysRawI32Token(rawJson, "e2eeKeyVersion");
  assertInitializeKeysRawI32Token(rawJson, "e2ee_key_version");
  assertInitializeKeysRawI32Token(rawJson, "pairingTtlSeconds");
  assertInitializeKeysRawI32Token(rawJson, "pairing_ttl_seconds");
  assertTrustedDeviceSummariesRawShape(
    rawJson,
    ["trustedDevices", "trusted_devices"],
    "initialize keys response",
  );
}

function assertTrustedDeviceSummariesRawShape(
  rawJson: string,
  aliases: string[],
  context: string,
): void {
  const tokens = rawTokensForAliases(rawJson, aliases);
  if (tokens.length !== 1 || !tokens[0]?.trim().startsWith("[")) {
    return;
  }
  for (const token of topLevelArrayValueTokens(tokens[0])) {
    if (token.startsWith("{")) {
      assertNoDuplicateConnectAliases(
        token,
        [["id"], ["name"], ["platform"], ["lastSeenAt", "last_seen_at"]],
        context,
      );
    }
  }
}

function assertInitializeKeysRawI32Token(rawJson: string, key: string): void {
  for (const token of rawTokensForAliases(rawJson, [key])) {
    if (!rawJsonI32TokenIsValid(token)) {
      throw initializeKeysResponseParseError();
    }
  }
}

function initializeKeysResponseParseError(): ConnectServiceError {
  return new ConnectServiceError("internal_error", "Failed to parse initialize keys response", 500);
}

function commitInitializeKeysResponseFromCloud(
  value: unknown,
  rawJson: string | null = null,
): { success: boolean; keyState: string } {
  if (!isRecord(value) || typeof value.success !== "boolean") {
    throw commitInitializeKeysResponseParseError();
  }
  if (rawJson !== null) {
    assertCommitInitializeKeysResponseRawShape(rawJson);
  }
  return {
    success: value.success,
    keyState: requiredKeyStateValue(
      value.keyState ?? value.key_state,
      "commit initialize keys response",
    ),
  };
}

function assertCommitInitializeKeysResponseRawShape(rawJson: string): void {
  for (const aliases of [["success"], ["keyState", "key_state"]]) {
    if (rawTokensForAliases(rawJson, aliases).length > 1) {
      throw commitInitializeKeysResponseParseError();
    }
  }
}

function commitInitializeKeysResponseParseError(): ConnectServiceError {
  return new ConnectServiceError(
    "internal_error",
    "Failed to parse commit initialize keys response",
    500,
  );
}

function resetTeamSyncResponseFromCloud(
  value: unknown,
  rawJson: string | null = null,
): { success: boolean; keyVersion: number; resetAt: string | null } {
  if (!isRecord(value) || typeof value.success !== "boolean") {
    throw resetTeamSyncResponseParseError();
  }
  if (rawJson !== null) {
    assertResetTeamSyncResponseRawShape(rawJson);
  }
  return {
    success: value.success,
    keyVersion: requiredI32Value(value.keyVersion ?? value.key_version, "reset team sync response"),
    resetAt: optionalResetTeamSyncStringValue(value.resetAt ?? value.reset_at),
  };
}

function assertResetTeamSyncResponseRawShape(rawJson: string): void {
  for (const aliases of [["success"], ["keyVersion", "key_version"], ["resetAt", "reset_at"]]) {
    if (rawTokensForAliases(rawJson, aliases).length > 1) {
      throw resetTeamSyncResponseParseError();
    }
  }
  assertResetTeamSyncRawI32Token(rawJson, "keyVersion");
  assertResetTeamSyncRawI32Token(rawJson, "key_version");
}

function assertResetTeamSyncRawI32Token(rawJson: string, key: string): void {
  for (const token of rawTokensForAliases(rawJson, [key])) {
    if (!rawJsonI32TokenIsValid(token)) {
      throw resetTeamSyncResponseParseError();
    }
  }
}

function resetTeamSyncResponseParseError(): ConnectServiceError {
  return new ConnectServiceError("internal_error", "Failed to parse reset team sync response", 500);
}

function optionalResetTeamSyncStringValue(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw resetTeamSyncResponseParseError();
  }
  return value;
}

function trustedDevicesFromCloud(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    throw new ConnectServiceError(
      "internal_error",
      "Failed to parse initialize keys response",
      500,
    );
  }
  return value.map((entry) => {
    if (!isRecord(entry)) {
      throw new ConnectServiceError(
        "internal_error",
        "Failed to parse initialize keys response",
        500,
      );
    }
    return {
      id: requiredStringValue(entry.id, "initialize keys response"),
      name: requiredStringValue(entry.name, "initialize keys response"),
      platform: requiredStringValue(entry.platform, "initialize keys response"),
      lastSeenAt: optionalTrustedDeviceSummaryStringValue(entry.lastSeenAt ?? entry.last_seen_at),
    };
  });
}

function optionalTrustedDeviceSummaryStringValue(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new ConnectServiceError(
      "internal_error",
      "Failed to parse initialize keys response",
      500,
    );
  }
  return value;
}

function requiredBooleanValue(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") {
    throw new ConnectServiceError("internal_error", `Failed to parse ${context}`, 500);
  }
  return value;
}

function requiredKeyStateValue(value: unknown, context: string): string {
  if (value !== "ACTIVE" && value !== "PENDING") {
    throw new ConnectServiceError("internal_error", `Failed to parse ${context}`, 500);
  }
  return value;
}

function requiredI32Value(value: unknown, context: string): number {
  if (!isI32Integer(value)) {
    throw new ConnectServiceError("internal_error", `Failed to parse ${context}`, 500);
  }
  return value;
}

function detectDevicePlatform(platform: NodeJS.Platform): string {
  switch (platform) {
    case "darwin":
      return "mac";
    case "win32":
      return "windows";
    case "linux":
      return "linux";
    default:
      return "web";
  }
}

async function localSyncIdentityCanRunBackground(
  secretService: SecretService | undefined,
): Promise<boolean> {
  if (!secretService) {
    return false;
  }
  const rawIdentity = await secretService.getSecret(DEVICE_SYNC_IDENTITY_KEY);
  if (rawIdentity === null) {
    return false;
  }
  try {
    const parsed = parseStoredSyncIdentity(rawIdentity);
    return parsed.deviceId !== null && parsed.rootKey !== null;
  } catch {
    return false;
  }
}

async function localSyncIdentityDeviceId(
  secretService: SecretService | undefined,
): Promise<string | null> {
  const deviceId = await readLocalSyncIdentityDeviceId(secretService);
  return deviceId ?? null;
}

async function readLocalSyncIdentityDeviceId(
  secretService: SecretService | undefined,
): Promise<string | null | undefined> {
  if (!secretService) {
    return undefined;
  }
  const rawIdentity = await secretService.getSecret(DEVICE_SYNC_IDENTITY_KEY);
  if (rawIdentity === null) {
    return undefined;
  }
  try {
    return parseStoredSyncIdentity(rawIdentity).deviceId;
  } catch {
    return undefined;
  }
}

async function readLocalSyncIdentityDeviceIdBestEffort(
  secretService: SecretService | undefined,
): Promise<string | null | undefined> {
  try {
    return await readLocalSyncIdentityDeviceId(secretService);
  } catch {
    return undefined;
  }
}

async function getLocalDeviceSyncState(
  secretService: SecretService,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  accessToken: string,
): Promise<Record<string, unknown>> {
  const rawIdentity = await secretService.getSecret(DEVICE_SYNC_IDENTITY_KEY);
  if (rawIdentity === null) {
    return freshDeviceSyncState();
  }
  let identity: ReturnType<typeof parseSyncIdentity>;
  try {
    identity = parseStoredSyncIdentity(rawIdentity);
  } catch (error) {
    if (error instanceof ConnectServiceError) {
      throw error;
    }
    throw new ConnectServiceError(
      "internal_error",
      `Failed to parse identity: ${errorMessage(error)}`,
      500,
    );
  }
  if (!identity.deviceNonce || !identity.deviceId) {
    return freshDeviceSyncState();
  }
  let device: Record<string, unknown>;
  try {
    device = await fetchLocalDeviceSyncDevice(env, fetchImpl, accessToken, identity.deviceId);
  } catch (error) {
    const message = errorMessage(error);
    if (message.includes("404") || message.toLowerCase().includes("not found")) {
      return {
        state: "RECOVERY",
        deviceId: identity.deviceId,
        deviceName: null,
        keyVersion: identity.keyVersion,
        serverKeyVersion: null,
        isTrusted: false,
        trustedDevices: [],
      };
    }

    throw error;
  }
  const trustedKeyVersion = optionalNumber(device.trustedKeyVersion);
  if (device.trustState === "revoked") {
    return {
      state: "RECOVERY",
      deviceId: identity.deviceId,
      deviceName: optionalString(device.displayName),
      keyVersion: identity.keyVersion,
      serverKeyVersion: trustedKeyVersion,
      isTrusted: false,
      trustedDevices: [],
    };
  }
  const isTrusted = device.trustState === "trusted";
  if (!identity.rootKey || identity.keyVersion === null || !isTrusted) {
    const trustedDevices = isTrusted
      ? []
      : await getTrustedDevicesBestEffort(env, fetchImpl, accessToken);
    let orphaned = !isTrusted && trustedDevices.length === 0 && (trustedKeyVersion ?? 0) > 0;
    if (!orphaned && !isTrusted && trustedDevices.length === 0) {
      orphaned = await detectOrphanedWithoutTrustedDevicesBestEffort(
        env,
        fetchImpl,
        accessToken,
        identity.deviceId,
      );
    }
    return {
      state: orphaned ? "ORPHANED" : "REGISTERED",
      deviceId: identity.deviceId,
      deviceName: optionalString(device.displayName),
      keyVersion: null,
      serverKeyVersion: trustedKeyVersion,
      isTrusted,
      trustedDevices,
    };
  }
  if (trustedKeyVersion !== null && identity.keyVersion !== trustedKeyVersion) {
    const trustedDevices = await getTrustedDevicesBestEffort(env, fetchImpl, accessToken);
    return {
      state: "STALE",
      deviceId: identity.deviceId,
      deviceName: optionalString(device.displayName),
      keyVersion: identity.keyVersion,
      serverKeyVersion: trustedKeyVersion,
      isTrusted,
      trustedDevices,
    };
  }
  return {
    state: "READY",
    deviceId: identity.deviceId,
    deviceName: optionalString(device.displayName),
    keyVersion: identity.keyVersion,
    serverKeyVersion: trustedKeyVersion,
    isTrusted,
    trustedDevices: [],
  };
}

async function fetchLocalDeviceSyncDevice(
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  accessToken: string,
  deviceId: string,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetchImpl(
      `${normalizeConnectApiUrl(env.CONNECT_API_URL)}/api/v1/sync/team/devices/${encodeURIComponent(deviceId)}`,
      {
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          "x-wf-client-request-id": `app:${randomUUID()}`,
        },
      },
    );
  } catch (error) {
    throw new ConnectServiceError("internal_error", errorMessage(error), 500);
  }
  let bodyText: string;
  try {
    bodyText = await response.text();
  } catch (error) {
    throw new ConnectServiceError("internal_error", errorMessage(error), 500);
  }
  if (!response.ok) {
    throw new ConnectServiceError(
      "internal_error",
      connectDeviceSyncApiErrorMessage(response.status, bodyText),
      500,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch (error) {
    throw new ConnectServiceError(
      "internal_error",
      `Failed to parse device response: ${errorMessage(error)}`,
      500,
    );
  }
  if (!isRecord(parsed)) {
    throw new ConnectServiceError("internal_error", "Failed to parse device response", 500);
  }
  assertDeviceResponseRawShape(bodyText);
  assertOptionalDeviceResponseStringFields(parsed);
  return {
    id: requiredStringValue(parsed.id, "device response"),
    displayName: requiredStringValue(parsed.displayName ?? parsed.display_name, "device response"),
    trustState: requiredDeviceTrustState(parsed.trustState ?? parsed.trust_state),
    trustedKeyVersion: optionalDeviceNumber(
      parsed.trustedKeyVersion ?? parsed.trusted_key_version,
      "device response",
    ),
  };
}

function assertOptionalDeviceResponseStringFields(parsed: Record<string, unknown>): void {
  optionalDeviceStringValue(parsed.devicePublicKey ?? parsed.device_public_key);
  optionalDeviceStringValue(parsed.osVersion ?? parsed.os_version);
  optionalDeviceStringValue(parsed.appVersion ?? parsed.app_version);
  optionalDeviceStringValue(parsed.lastSeenAt ?? parsed.last_seen_at);
}

async function getTrustedDevicesBestEffort(
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  accessToken: string,
): Promise<Array<Record<string, unknown>>> {
  try {
    const response = await fetchImpl(
      `${normalizeConnectApiUrl(env.CONNECT_API_URL)}/api/v1/sync/team/devices?scope=my`,
      {
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          "x-wf-client-request-id": `app:${randomUUID()}`,
        },
      },
    );
    if (!response.ok) {
      return [];
    }
    const bodyText = await response.text();
    const parsed = JSON.parse(bodyText) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    const rawDeviceTokens = topLevelArrayValueTokens(bodyText);
    return parsed
      .map((device, index): Record<string, unknown> | null => {
        if (!isRecord(device)) {
          return null;
        }
        assertDeviceResponseRawShape(rawDeviceTokens[index] ?? "");
        assertOptionalDeviceResponseStringFields(device);
        return device;
      })
      .filter((device): device is Record<string, unknown> => device !== null)
      .filter((device) => (device.trustState ?? device.trust_state) === "trusted")
      .map((device) => ({
        id: requiredStringValue(device.id, "device response"),
        name: requiredStringValue(device.displayName ?? device.display_name, "device response"),
        platform: requiredStringValue(device.platform, "device response"),
        lastSeenAt: optionalDeviceStringValue(device.lastSeenAt ?? device.last_seen_at),
      }));
  } catch {
    return [];
  }
}

async function detectOrphanedWithoutTrustedDevicesBestEffort(
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  accessToken: string,
  deviceId: string,
): Promise<boolean> {
  try {
    const response = await fetchImpl(
      `${normalizeConnectApiUrl(env.CONNECT_API_URL)}/api/v1/sync/team/keys/initialize`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          "x-wf-client-request-id": deviceSyncClientRequestId(deviceId),
          "x-wf-device-id": deviceId,
        },
        body: JSON.stringify({ device_id: deviceId }),
      },
    );
    if (!response.ok) {
      return false;
    }
    const bodyText = await response.text();
    const parsed = JSON.parse(bodyText) as unknown;
    const initResult = initializeTeamKeysResultFromCloud(parsed, bodyText);
    if (initResult.mode !== "PAIRING_REQUIRED") {
      return false;
    }
    return initResult.e2eeKeyVersion > 0 && initResult.trustedDevices.length === 0;
  } catch {
    return false;
  }
}

function deviceSyncClientRequestId(deviceId: string | undefined): string {
  const requestUuid = randomUUID();
  const trimmedDeviceId = deviceId?.trim();
  if (trimmedDeviceId && isLogSafeRequestId(trimmedDeviceId)) {
    const candidate = `${trimmedDeviceId}:${requestUuid}`;
    if (isLogSafeRequestId(candidate)) {
      return candidate;
    }
  }
  return `app:${requestUuid}`;
}

function isLogSafeRequestId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 128 &&
    [...value].every((char) => /[A-Za-z0-9._:-]/.test(char))
  );
}

function enableSyncResultFromState(state: Record<string, unknown>): Record<string, unknown> {
  const deviceId = optionalString(state.deviceId);
  if (!deviceId) {
    throw new ConnectServiceError("internal_error", "Missing device ID in sync state", 500);
  }
  const stateName = requiredSyncState(state.state);
  return {
    deviceId,
    state: stateName,
    keyVersion: optionalNumber(state.keyVersion),
    serverKeyVersion: optionalNumber(state.serverKeyVersion),
    needsPairing: stateName === "REGISTERED" || stateName === "STALE",
    trustedDevices: Array.isArray(state.trustedDevices) ? state.trustedDevices : [],
  };
}

function requiredSyncState(value: unknown): string {
  if (
    value !== "FRESH" &&
    value !== "REGISTERED" &&
    value !== "READY" &&
    value !== "STALE" &&
    value !== "RECOVERY" &&
    value !== "ORPHANED"
  ) {
    throw new ConnectServiceError("internal_error", "Failed to parse sync state", 500);
  }
  return value;
}

function connectDeviceSyncApiErrorMessage(status: number, bodyText: string): string {
  const trimmed = bodyText.trim();
  if (!trimmed) {
    return `API error (${status}): Request failed`;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (isRecord(parsed)) {
      if (!validDeviceSyncApiErrorResponseShape(trimmed, parsed)) {
        return `API error (${status}): Request failed: ${trimmed}`;
      }
      const code = optionalString(parsed.code) ?? optionalString(parsed.error) ?? "";
      const message = parsed.message;
      return `API error (${status}): ${code}: ${message}`;
    }
  } catch {
    return `API error (${status}): Request failed: ${trimmed}`;
  }
  return `API error (${status}): Request failed: ${trimmed}`;
}

function validDeviceSyncApiErrorResponseShape(
  rawJson: string,
  parsed: Record<string, unknown>,
): parsed is Record<string, unknown> & { message: string } {
  if (
    rawTokensForAliases(rawJson, ["error"]).length > 1 ||
    rawTokensForAliases(rawJson, ["code"]).length > 1 ||
    rawTokensForAliases(rawJson, ["message"]).length > 1 ||
    rawTokensForAliases(rawJson, ["details"]).length > 1
  ) {
    return false;
  }
  return (
    (parsed.error === undefined || typeof parsed.error === "string") &&
    (parsed.code === undefined || typeof parsed.code === "string") &&
    typeof parsed.message === "string"
  );
}

function requiredDeviceTrustState(value: unknown): string {
  if (value !== "untrusted" && value !== "trusted" && value !== "revoked") {
    throw new ConnectServiceError("internal_error", "Failed to parse device response", 500);
  }
  return value;
}

function assertDeviceResponseRawShape(rawJson: string): void {
  for (const aliases of [
    ["id"],
    ["userId", "user_id"],
    ["displayName", "display_name"],
    ["platform"],
    ["devicePublicKey", "device_public_key"],
    ["trustState", "trust_state"],
    ["trustedKeyVersion", "trusted_key_version"],
    ["osVersion", "os_version"],
    ["appVersion", "app_version"],
    ["lastSeenAt", "last_seen_at"],
    ["createdAt", "created_at"],
  ]) {
    if (rawTokensForAliases(rawJson, aliases).length > 1) {
      throw new ConnectServiceError("internal_error", "Failed to parse device response", 500);
    }
  }
}

function optionalDeviceStringValue(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new ConnectServiceError("internal_error", "Failed to parse device response", 500);
  }
  return value;
}

function optionalDeviceNumber(value: unknown, context: string): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ConnectServiceError("internal_error", `Failed to parse ${context}`, 500);
  }
  return value;
}

function topLevelArrayValueTokens(rawJson: string | undefined): string[] {
  const trimmed = rawJson?.trim() ?? "";
  if (!trimmed.startsWith("[")) {
    return [];
  }
  const tokens: string[] = [];
  let index = 1;
  while (index < trimmed.length) {
    index = skipJsonWhitespace(trimmed, index);
    if (trimmed[index] === "]") {
      break;
    }
    const start = index;
    index = skipJsonValue(trimmed, index);
    if (index < 0) {
      return [];
    }
    tokens.push(trimmed.slice(start, index).trim());
    index = skipJsonWhitespace(trimmed, index);
    if (trimmed[index] === ",") {
      index += 1;
    }
  }
  return tokens;
}

function freshDeviceSyncState(): Record<string, unknown> {
  return {
    state: "FRESH",
    deviceId: null,
    deviceName: null,
    keyVersion: null,
    serverKeyVersion: null,
    isTrusted: false,
    trustedDevices: [],
  };
}

async function clearLocalDeviceSyncData(db: Database, secretService: SecretService): Promise<void> {
  await clearLocalSyncIdentity(secretService);
  resetLocalSyncSession(db);
  await secretService.deleteSecret(DEVICE_SYNC_DEVICE_ID_KEY);
}

async function clearLocalSyncIdentity(secretService: SecretService): Promise<void> {
  const rawIdentity = await secretService.getSecret(DEVICE_SYNC_IDENTITY_KEY);
  let deviceNonce: string | null = null;
  if (rawIdentity !== null) {
    try {
      deviceNonce = parseStoredSyncIdentity(rawIdentity).deviceNonce;
    } catch (error) {
      if (error instanceof ConnectServiceError) {
        throw error;
      }
      throw new ConnectServiceError(
        "internal_error",
        `Failed to parse identity: ${errorMessage(error)}`,
        500,
      );
    }
  }
  await secretService.setSecret(
    DEVICE_SYNC_IDENTITY_KEY,
    JSON.stringify({
      version: 2,
      deviceNonce,
      deviceId: null,
      rootKey: null,
      keyVersion: null,
      deviceSecretKey: null,
      devicePublicKey: null,
    }),
  );
}

function parseSyncIdentity(identity: unknown): {
  deviceNonce: string | null;
  deviceId: string | null;
  rootKey: string | null;
  keyVersion: number | null;
} {
  if (!isRecord(identity)) {
    throw new ConnectServiceError("internal_error", "Failed to parse identity", 500);
  }

  assertDefaultedI32Field(identity, "version");
  assertOptionalStringField(identity, "deviceNonce");
  assertOptionalStringField(identity, "deviceId");
  assertOptionalStringField(identity, "rootKey");
  assertOptionalI32Field(identity, "keyVersion");
  assertOptionalStringField(identity, "deviceSecretKey");
  assertOptionalStringField(identity, "devicePublicKey");
  return {
    deviceNonce: optionalString(identity.deviceNonce),
    deviceId: optionalString(identity.deviceId),
    rootKey: optionalString(identity.rootKey),
    keyVersion: optionalNumber(identity.keyVersion),
  };
}

function parseStoredSyncIdentity(rawIdentity: string): ReturnType<typeof parseSyncIdentity> {
  assertNoDuplicateSyncIdentityFields(rawIdentity);
  assertRawI32Token(rawIdentity, "version", false);
  assertRawI32Token(rawIdentity, "keyVersion", true);
  return parseSyncIdentity(JSON.parse(rawIdentity) as unknown);
}

const SYNC_IDENTITY_FIELDS = new Set([
  "version",
  "deviceNonce",
  "deviceId",
  "rootKey",
  "keyVersion",
  "deviceSecretKey",
  "devicePublicKey",
]);

function assertNoDuplicateSyncIdentityFields(rawJson: string): void {
  const seen = new Set<string>();
  for (const key of topLevelJsonKeys(rawJson)) {
    if (!SYNC_IDENTITY_FIELDS.has(key)) {
      continue;
    }
    if (seen.has(key)) {
      throw new ConnectServiceError("internal_error", "Failed to parse identity", 500);
    }
    seen.add(key);
  }
}

function assertOptionalStringField(record: Record<string, unknown>, key: string): void {
  const value = record[key];
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw new ConnectServiceError("internal_error", "Failed to parse identity", 500);
  }
}

function assertDefaultedI32Field(record: Record<string, unknown>, key: string): void {
  const value = record[key];
  if (value !== undefined && !isI32Integer(value)) {
    throw new ConnectServiceError("internal_error", "Failed to parse identity", 500);
  }
}

function assertOptionalI32Field(record: Record<string, unknown>, key: string): void {
  const value = record[key];
  if (value !== undefined && value !== null && !isI32Integer(value)) {
    throw new ConnectServiceError("internal_error", "Failed to parse identity", 500);
  }
}

function isI32Integer(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= -2_147_483_648 &&
    value <= 2_147_483_647
  );
}

function assertRawI32Token(rawJson: string, key: string, allowNull: boolean): void {
  for (const token of topLevelJsonValueTokens(rawJson, key)) {
    if (token === "null") {
      if (allowNull) {
        continue;
      }
      throw new ConnectServiceError("internal_error", "Failed to parse identity", 500);
    }
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(token) && /[.eE]/.test(token)) {
      throw new ConnectServiceError("internal_error", "Failed to parse identity", 500);
    }
  }
}

function topLevelJsonValueTokens(rawJson: string, targetKey: string): string[] {
  const tokens: string[] = [];
  for (const entry of topLevelJsonEntries(rawJson)) {
    if (entry.key === targetKey) {
      tokens.push(entry.valueToken);
    }
  }
  return tokens;
}

function topLevelJsonArrayElementTokens(rawJson: string): string[] {
  const elements: string[] = [];
  let index = skipJsonWhitespace(rawJson, 0);
  if (rawJson[index] !== "[") {
    return elements;
  }
  index += 1;
  while (index < rawJson.length) {
    index = skipJsonWhitespace(rawJson, index);
    if (rawJson[index] === "]") {
      break;
    }
    const valueStart = index;
    index = skipJsonArrayValue(rawJson, index);
    if (index < 0) {
      return elements;
    }
    elements.push(rawJson.slice(valueStart, index).trim());
    index = skipJsonWhitespace(rawJson, index);
    if (rawJson[index] === ",") {
      index += 1;
      continue;
    }
    if (rawJson[index] === "]") {
      break;
    }
    return elements;
  }
  return elements;
}

function topLevelJsonKeys(rawJson: string): string[] {
  return topLevelJsonEntries(rawJson).map((entry) => entry.key);
}

function topLevelJsonEntries(rawJson: string): Array<{ key: string; valueToken: string }> {
  const entries: Array<{ key: string; valueToken: string }> = [];
  let index = skipJsonWhitespace(rawJson, 0);
  if (rawJson[index] !== "{") {
    return entries;
  }
  index += 1;
  while (index < rawJson.length) {
    index = skipJsonWhitespace(rawJson, index);
    if (rawJson[index] === "}") {
      break;
    }
    if (rawJson[index] !== '"') {
      return entries;
    }
    const keyStart = index;
    index = skipJsonString(rawJson, index);
    if (index < 0) {
      return entries;
    }
    let key: string;
    try {
      key = JSON.parse(rawJson.slice(keyStart, index)) as string;
    } catch {
      return entries;
    }
    index = skipJsonWhitespace(rawJson, index);
    if (rawJson[index] !== ":") {
      return entries;
    }
    index = skipJsonWhitespace(rawJson, index + 1);
    const valueStart = index;
    index = skipJsonValue(rawJson, index);
    if (index < 0) {
      return entries;
    }
    entries.push({ key, valueToken: rawJson.slice(valueStart, index).trim() });
    index = skipJsonWhitespace(rawJson, index);
    if (rawJson[index] === ",") {
      index += 1;
      continue;
    }
    if (rawJson[index] === "}") {
      break;
    }
    return entries;
  }
  return entries;
}

function skipJsonWhitespace(rawJson: string, index: number): number {
  while (/\s/.test(rawJson[index] ?? "")) {
    index += 1;
  }
  return index;
}

function skipJsonString(rawJson: string, index: number): number {
  index += 1;
  while (index < rawJson.length) {
    const char = rawJson[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === '"') {
      return index + 1;
    }
    index += 1;
  }
  return -1;
}

function skipJsonValue(rawJson: string, index: number): number {
  const char = rawJson[index];
  if (char === '"') {
    return skipJsonString(rawJson, index);
  }
  if (char === "{" || char === "[") {
    return skipJsonComposite(rawJson, index);
  }
  while (index < rawJson.length && rawJson[index] !== "," && rawJson[index] !== "}") {
    index += 1;
  }
  return index;
}

function skipJsonArrayValue(rawJson: string, index: number): number {
  const char = rawJson[index];
  if (char === '"') {
    return skipJsonString(rawJson, index);
  }
  if (char === "{" || char === "[") {
    return skipJsonComposite(rawJson, index);
  }
  while (index < rawJson.length && rawJson[index] !== "," && rawJson[index] !== "]") {
    index += 1;
  }
  return index;
}

function skipJsonComposite(rawJson: string, index: number): number {
  const stack: string[] = [];
  while (index < rawJson.length) {
    const char = rawJson[index];
    if (char === '"') {
      index = skipJsonString(rawJson, index);
      if (index < 0) {
        return -1;
      }
      continue;
    }
    if (char === "{" || char === "[") {
      stack.push(char === "{" ? "}" : "]");
    } else if (char === "}" || char === "]") {
      if (stack.pop() !== char) {
        return -1;
      }
      if (stack.length === 0) {
        return index + 1;
      }
    }
    index += 1;
  }
  return -1;
}

function resetLocalSyncSession(db: Database): void {
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const tableName of [
      "sync_outbox",
      "sync_entity_metadata",
      "sync_applied_events",
      "sync_table_state",
      "sync_device_config",
    ]) {
      if (sqliteTableExists(db, tableName)) {
        db.prepare(`DELETE FROM "${tableName}"`).run();
      }
    }
    if (sqliteTableExists(db, "sync_cursor")) {
      db.prepare(
        `
          INSERT INTO sync_cursor (id, cursor, updated_at)
          VALUES (1, 0, ?)
          ON CONFLICT(id) DO UPDATE SET
            cursor = excluded.cursor,
            updated_at = excluded.updated_at
        `,
      ).run(now);
    }
    if (sqliteTableExists(db, "sync_engine_state")) {
      db.prepare(
        `
          INSERT INTO sync_engine_state (
            id, lock_version, last_push_at, last_pull_at, last_error,
            consecutive_failures, next_retry_at, last_cycle_status, last_cycle_duration_ms
          )
          VALUES (1, 0, NULL, NULL, NULL, 0, NULL, NULL, NULL)
          ON CONFLICT(id) DO UPDATE SET
            lock_version = excluded.lock_version,
            last_push_at = excluded.last_push_at,
            last_pull_at = excluded.last_pull_at,
            last_error = excluded.last_error,
            consecutive_failures = excluded.consecutive_failures,
            next_retry_at = excluded.next_retry_at,
            last_cycle_status = excluded.last_cycle_status,
            last_cycle_duration_ms = excluded.last_cycle_duration_ms
        `,
      ).run();
    }
  })();
}

function clearAllDeviceSyncFreshnessGates(db: Database): void {
  if (!sqliteColumnExists(db, "sync_device_config", "min_snapshot_created_at")) {
    return;
  }
  db.prepare("UPDATE sync_device_config SET min_snapshot_created_at = NULL").run();
}

async function getLocalDeviceSyncEngineStatus(
  db: Database,
  secretService: SecretService | undefined,
): Promise<Record<string, unknown>> {
  const cursor =
    db.query<SyncCursorRow, []>("SELECT cursor FROM sync_cursor WHERE id = 1").get()?.cursor ?? 0;
  const state = db
    .query<SyncEngineStateRow, []>(
      `
      SELECT
        last_push_at, last_pull_at, last_error, consecutive_failures, next_retry_at,
        last_cycle_status, last_cycle_duration_ms
      FROM sync_engine_state
      WHERE id = 1
    `,
    )
    .get();
  const deviceId = await localSyncIdentityDeviceId(secretService);
  const deviceConfig = deviceId
    ? db
        .query<SyncDeviceConfigRow, [string]>(
          `
            SELECT device_id, last_bootstrap_at
            FROM sync_device_config
            WHERE device_id = ?
          `,
        )
        .get(deviceId)
    : null;
  const staleCursor = state?.last_cycle_status === "stale_cursor";
  return {
    cursor,
    lastPushAt: state?.last_push_at ?? null,
    lastPullAt: state?.last_pull_at ?? null,
    lastError: state?.last_error ?? null,
    consecutiveFailures: state?.consecutive_failures ?? 0,
    nextRetryAt: state?.next_retry_at ?? null,
    lastCycleStatus: state?.last_cycle_status ?? null,
    lastCycleDurationMs: state?.last_cycle_duration_ms ?? null,
    backgroundRunning: false,
    bootstrapRequired:
      deviceConfig === null || deviceConfig.last_bootstrap_at === null || staleCursor,
  };
}

async function getLocalDeviceSyncBootstrapOverwriteCheck(
  db: Database,
  secretService: SecretService | undefined,
  readyStateOverwriteApprovals: Set<string> = new Set(),
): Promise<Record<string, unknown>> {
  const engineStatus = await getLocalDeviceSyncEngineStatus(db, secretService);
  const bootstrapRequired = engineStatus.bootstrapRequired === true;
  const deviceId = secretService
    ? await readLocalSyncIdentityDeviceIdBestEffort(secretService)
    : undefined;
  if (!bootstrapRequired) {
    if (deviceId) {
      readyStateOverwriteApprovals.delete(deviceId);
    }
    return {
      bootstrapRequired: false,
      hasLocalData: false,
      localRows: 0,
      nonEmptyTables: [],
    };
  }
  if (deviceId && readyStateOverwriteApprovals.has(deviceId)) {
    return {
      bootstrapRequired: true,
      hasLocalData: false,
      localRows: 0,
      nonEmptyTables: [],
    };
  }
  const summary = localOverwriteRiskSummary(db);
  return {
    bootstrapRequired: true,
    hasLocalData: summary.totalRows > 0,
    localRows: summary.totalRows,
    nonEmptyTables: summary.nonEmptyTables,
  };
}

function localReadyReconcileBase(): Record<string, unknown> {
  return {
    status: "ok",
    message: "Device sync reconcile completed",
    bootstrapAction: "NO_BOOTSTRAP",
    bootstrapStatus: "not_attempted",
    bootstrapMessage: null,
    bootstrapSnapshotId: null,
    cycleStatus: null,
    cycleNeedsBootstrap: false,
    retryAttempted: false,
    retryCycleStatus: null,
    backgroundStatus: "skipped",
  };
}

function localReadyReconcileBootstrapAction(
  bootstrapStatus: string,
  bootstrapSnapshotId: string | null,
): string {
  if (bootstrapStatus === "applied") {
    return "PULL_REMOTE_OVERWRITE";
  }
  if (bootstrapStatus === "requested") {
    return "WAIT_REMOTE_SNAPSHOT";
  }
  if (bootstrapSnapshotId?.trim()) {
    return "PULL_REMOTE_OVERWRITE";
  }
  return "NO_BOOTSTRAP";
}

function localReadyReconcileError(message: string): Record<string, unknown> {
  return {
    ...localReadyReconcileBase(),
    status: "error",
    message,
  };
}

function localReadyReconcileShouldKeepOverwriteApproval(result: Record<string, unknown>): boolean {
  if (optionalString(result.status) === "error") {
    return true;
  }
  return (
    optionalString(result.bootstrapStatus) === "requested" ||
    optionalBoolean(result.cycleNeedsBootstrap) === true ||
    ["wait_snapshot", "stale_cursor"].includes(optionalString(result.cycleStatus) ?? "") ||
    ["wait_snapshot", "stale_cursor"].includes(optionalString(result.retryCycleStatus) ?? "")
  );
}

async function getLocalDeviceSyncPairingSourceStatus(
  db: Database,
  secretService: SecretService | undefined,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  restoreSession?: RestoreConnectSession,
): Promise<Record<string, unknown>> {
  if (!secretService) {
    throw deviceSyncDisabled();
  }
  const deviceId = await requireLocalSyncIdentityDeviceId(secretService);
  let session: { accessToken: string; refreshToken: string };
  try {
    session = restoreSession
      ? await restoreSession()
      : await restoreLocalSyncSession(secretService, env, fetchImpl, () => 0);
  } catch (error) {
    throw new ConnectServiceError("internal_error", errorMessage(error), 500);
  }
  const device = await fetchLocalDeviceSyncDevice(env, fetchImpl, session.accessToken, deviceId);
  if (device.trustState !== "trusted") {
    throw new ConnectServiceError(
      "internal_error",
      "Current device is not ready to connect another device yet.",
      500,
    );
  }
  const localCursor = getLocalSyncCursor(db);
  const serverCursor = await fetchLocalEventsCursorOrThrow(
    env,
    fetchImpl,
    session.accessToken,
    deviceId,
  );
  if (localCursor > serverCursor) {
    return {
      status: "restore_required",
      message: "This device needs to set up sync again before you add another device.",
      localCursor,
      serverCursor,
    };
  }
  return {
    status: "ready",
    message: "This device is ready to connect another device.",
    localCursor,
    serverCursor,
  };
}

async function bootstrapSnapshotIfNotReady(
  db: Database,
  secretService: SecretService | undefined,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  restoreSession?: RestoreConnectSession,
  eventBus?: BackendEventBus,
): Promise<Record<string, unknown>> {
  if (!secretService) {
    throw deviceSyncDisabled();
  }
  const identity = await requireLocalSyncIdentity(secretService);
  const deviceId = identity.deviceId;
  const session = restoreSession
    ? await restoreSession()
    : await restoreLocalSyncSession(secretService, env, fetchImpl, () => 0);
  const state = await getLocalDeviceSyncState(secretService, env, fetchImpl, session.accessToken);
  if (state.state !== "READY") {
    return {
      status: "skipped_not_ready",
      message: "Device is not in READY state",
      snapshotId: null,
      cursor: null,
    };
  }
  try {
    persistReadyDeviceConfigFromIdentity(db, identity);
  } catch (error) {
    console.warn(`[Connect] Failed to persist READY device sync config: ${errorMessage(error)}`);
  }
  const engineStatus = await getLocalDeviceSyncEngineStatus(db, secretService);
  const freshnessGate = localMinSnapshotFreshnessGate(db, deviceId);
  const freshnessGateExists = freshnessGate.kind !== "none";
  let reconcileAction: string | null = null;
  if (!freshnessGateExists) {
    reconcileAction = await fetchLocalReconcileReadyActionBestEffort(
      env,
      fetchImpl,
      session.accessToken,
      deviceId,
    );
  }
  if (engineStatus.bootstrapRequired !== true && !freshnessGateExists) {
    if (!reconcileActionRequiresSnapshot(reconcileAction)) {
      return {
        status: "skipped",
        message: "Snapshot bootstrap already completed",
        snapshotId: null,
        cursor: optionalNumber(engineStatus.cursor),
      };
    }
  }
  const latestSnapshotStatus = await localLatestSnapshotStatusBestEffort(
    env,
    fetchImpl,
    session.accessToken,
    deviceId,
  );
  if (latestSnapshotStatus.kind === "present" && latestSnapshotStatus.schemaVersion > 1) {
    throw new ConnectServiceError(
      "internal_error",
      `Snapshot schema version ${latestSnapshotStatus.schemaVersion} is newer than local version 1. Please update the app.`,
      500,
    );
  }
  const latestSnapshotMissing = latestSnapshotStatus.kind === "missing";
  if (freshnessGate.kind === "present" && latestSnapshotMissing) {
    return {
      status: "requested",
      message: "Waiting for a snapshot generated after pairing confirmation",
      snapshotId: null,
      cursor: optionalNumber(engineStatus.cursor),
    };
  }
  if (
    freshnessGate.kind === "present" &&
    latestSnapshotStatus.kind === "present" &&
    !(await localSnapshotSatisfiesFreshnessGate(
      env,
      fetchImpl,
      session.accessToken,
      deviceId,
      latestSnapshotStatus,
      freshnessGate.value,
    ))
  ) {
    return {
      status: "requested",
      message: "Waiting for a snapshot generated after pairing confirmation",
      snapshotId: null,
      cursor: optionalNumber(engineStatus.cursor),
    };
  }
  if (
    !freshnessGateExists &&
    (engineStatus.bootstrapRequired === true || reconcileActionRequiresSnapshot(reconcileAction)) &&
    latestSnapshotMissing
  ) {
    const missingSnapshotAction = await fetchLocalReconcileReadyActionBestEffort(
      env,
      fetchImpl,
      session.accessToken,
      deviceId,
    );
    if (missingSnapshotAction === "NOOP" || missingSnapshotAction === "PULL_TAIL") {
      resetAndMarkLocalBootstrapComplete(db, identity);
      return {
        status: "skipped",
        message: "No remote snapshot is required for this device",
        snapshotId: null,
        cursor: getLocalSyncCursor(db),
      };
    }
    return {
      status: "requested",
      message:
        missingSnapshotAction === "WAIT_SNAPSHOT" || missingSnapshotAction === "BOOTSTRAP_SNAPSHOT"
          ? "Waiting for a trusted device to upload a snapshot"
          : "Snapshot is not available yet. Waiting for upload from a trusted device.",
      snapshotId: null,
      cursor: optionalNumber(engineStatus.cursor),
    };
  }
  if (latestSnapshotStatus.kind === "present") {
    const safeSnapshotCursor = i64ToSafeNumberOrNull(latestSnapshotStatus.oplogSeq);
    if (safeSnapshotCursor === null) {
      throw new ConnectServiceError(
        "internal_error",
        "Snapshot oplog_seq is outside JavaScript safe integer range",
        500,
      );
    }
    const blob = await downloadLocalSnapshotWithPreconditions(
      env,
      fetchImpl,
      session.accessToken,
      deviceId,
      latestSnapshotStatus,
    );
    const sqliteImage = await decodeLocalSnapshotSqlitePayload(blob, identity);
    const tablesToRestore = localSnapshotTablesToRestore(latestSnapshotStatus.coversTables);
    const snapshotPath = join(tmpdir(), `wf_snapshot_server_${randomUUID()}.db`);
    try {
      writeFileSync(snapshotPath, sqliteImage);
      restoreLocalSnapshotTablesFromFile(
        db,
        snapshotPath,
        tablesToRestore,
        safeSnapshotCursor,
        identity,
      );
      eventBus?.publish({ name: DEVICE_SYNC_PULL_COMPLETE_EVENT });
      try {
        clearLocalMinSnapshotCreatedAt(db, deviceId);
      } catch (error) {
        console.warn(`[Connect] Failed to clear snapshot freshness gate: ${errorMessage(error)}`);
      }
    } finally {
      try {
        rmSync(snapshotPath, { force: true });
      } catch (error) {
        console.warn(`[Connect] Failed to remove temporary snapshot file: ${errorMessage(error)}`);
      }
    }
    return {
      status: "applied",
      message: "Snapshot bootstrap completed",
      snapshotId: latestSnapshotStatus.snapshotId,
      cursor: safeSnapshotCursor,
    };
  }
  throw deviceSyncDisabled();
}

function persistReadyDeviceConfigFromIdentity(
  db: Database,
  identity: ReturnType<typeof parseSyncIdentity> & { deviceId: string },
): void {
  if (!sqliteTableExists(db, "sync_device_config")) {
    return;
  }
  const hasFreshnessGateColumn = sqliteColumnExists(
    db,
    "sync_device_config",
    "min_snapshot_created_at",
  );
  if (hasFreshnessGateColumn) {
    db.prepare(
      `
        INSERT INTO sync_device_config (
          device_id, key_version, trust_state, last_bootstrap_at, min_snapshot_created_at
        )
        VALUES (?, ?, 'trusted', NULL, NULL)
        ON CONFLICT(device_id) DO UPDATE SET
          key_version = excluded.key_version,
          trust_state = excluded.trust_state
      `,
    ).run(identity.deviceId, identity.keyVersion);
    return;
  }
  db.prepare(
    `
      INSERT INTO sync_device_config (device_id, key_version, trust_state, last_bootstrap_at)
      VALUES (?, ?, 'trusted', NULL)
      ON CONFLICT(device_id) DO UPDATE SET
        key_version = excluded.key_version,
        trust_state = excluded.trust_state
    `,
  ).run(identity.deviceId, identity.keyVersion);
}

type LocalFreshnessGate =
  | { kind: "none" }
  | { kind: "present"; value: string }
  | { kind: "unknown" };

function localMinSnapshotFreshnessGate(db: Database, deviceId: string): LocalFreshnessGate {
  if (!sqliteColumnExists(db, "sync_device_config", "min_snapshot_created_at")) {
    return { kind: "none" };
  }
  try {
    const value = db
      .query<{ min_snapshot_created_at: string | null }, [string]>(
        `
          SELECT min_snapshot_created_at
          FROM sync_device_config
          WHERE device_id = ?
        `,
      )
      .get(deviceId)?.min_snapshot_created_at;
    if (value === undefined || value === null) {
      return { kind: "none" };
    }
    const normalized = normalizeSyncDatetime(value);
    if (normalized !== null) {
      return { kind: "present", value: normalized };
    }
    db.prepare(
      `
        UPDATE sync_device_config
        SET min_snapshot_created_at = NULL
        WHERE device_id = ?
      `,
    ).run(deviceId);
    return { kind: "none" };
  } catch {
    return { kind: "unknown" };
  }
}

type LocalLatestSnapshotStatus =
  | { kind: "missing" }
  | {
      kind: "present";
      snapshotId: string;
      schemaVersion: number;
      oplogSeq: I64Value;
      createdAt: string;
      checksum: string | null;
      coversTables: string[];
    }
  | { kind: "unknown" };

async function localLatestSnapshotStatusBestEffort(
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  accessToken: string,
  deviceId: string,
): Promise<LocalLatestSnapshotStatus> {
  try {
    const response = await fetchImpl(
      `${normalizeConnectApiUrl(env.CONNECT_API_URL)}/api/v1/sync/snapshots/latest`,
      {
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          "x-wf-client-request-id": deviceSyncClientRequestId(deviceId),
          "x-wf-device-id": deviceId,
        },
      },
    );
    if (response.status === 404) {
      return { kind: "missing" };
    }
    const bodyText = await response.text();
    if (response.status === 400 && isSnapshotIdValidationErrorBody(bodyText)) {
      return await localCursorLatestSnapshotStatusBestEffort(env, fetchImpl, accessToken, deviceId);
    }
    if (!response.ok) {
      return { kind: "unknown" };
    }
    const parsed = JSON.parse(bodyText) as unknown;
    if (!isRecord(parsed)) {
      return { kind: "unknown" };
    }
    if (
      !validSnapshotLatestMetadataShape(parsed) ||
      !validSnapshotLatestMetadataRawShape(bodyText)
    ) {
      return { kind: "unknown" };
    }
    const snapshotId = optionalString(parsed.snapshotId ?? parsed.snapshot_id);
    if (snapshotId === null || snapshotId.trim() !== "") {
      const latestStatus: LocalLatestSnapshotStatus = {
        kind: "present",
        snapshotId: snapshotId ?? "",
        schemaVersion: requiredInteger(
          parsed.schemaVersion ?? parsed.schema_version,
          "snapshot metadata",
        ),
        oplogSeq: requiredI64FromRawJson(bodyText, ["oplogSeq", "oplog_seq"]),
        createdAt: requiredStringValue(parsed.createdAt ?? parsed.created_at, "snapshot metadata"),
        checksum: optionalString(parsed.checksum),
        coversTables: parseSnapshotCoversTables(parsed.coversTables ?? parsed.covers_tables),
      };
      if (snapshotId !== null && isBackendStrictUuid(snapshotId)) {
        return latestStatus;
      }
      const cursorStatus = await localCursorLatestSnapshotStatusBestEffort(
        env,
        fetchImpl,
        accessToken,
        deviceId,
      );
      if (cursorStatus.kind !== "present") {
        return latestStatus;
      }
      return chooseLocalSnapshotStatus(latestStatus, cursorStatus);
    }
    return await localCursorLatestSnapshotStatusBestEffort(env, fetchImpl, accessToken, deviceId);
  } catch {
    return { kind: "unknown" };
  }
}

async function localCursorLatestSnapshotStatusBestEffort(
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  accessToken: string,
  deviceId: string,
): Promise<LocalLatestSnapshotStatus> {
  try {
    const response = await fetchImpl(
      `${normalizeConnectApiUrl(env.CONNECT_API_URL)}/api/v1/sync/events/cursor`,
      {
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          "x-wf-client-request-id": deviceSyncClientRequestId(deviceId),
          "x-wf-device-id": deviceId,
        },
      },
    );
    if (!response.ok) {
      return { kind: "unknown" };
    }
    const responseText = await response.text();
    const parsed = JSON.parse(responseText) as unknown;
    if (!isRecord(parsed)) {
      return { kind: "unknown" };
    }
    if (!validSyncCursorRawShape(responseText)) {
      return { kind: "unknown" };
    }
    const latestSnapshotRawTokens = [
      ...topLevelJsonPropertyRawTokens(responseText, "latestSnapshot"),
      ...topLevelJsonPropertyRawTokens(responseText, "latest_snapshot"),
    ];
    if (latestSnapshotRawTokens.length > 1) {
      return { kind: "unknown" };
    }
    const latestSnapshot = parsed.latestSnapshot ?? parsed.latest_snapshot;
    if (latestSnapshot == null) {
      if (latestSnapshotRawTokens.length === 1 && latestSnapshotRawTokens[0]?.trim() !== "null") {
        return { kind: "unknown" };
      }
      return { kind: "missing" };
    }
    const latestSnapshotRawToken = latestSnapshotRawTokens[0];
    const parsedLatestSnapshot = parseLocalReconcileLatestSnapshot(
      latestSnapshot,
      latestSnapshotRawToken,
    );
    if (
      latestSnapshotRawTokens.length !== 1 ||
      !validSyncLatestSnapshotRefShape(latestSnapshot) ||
      parsedLatestSnapshot.invalid
    ) {
      return { kind: "unknown" };
    }
    return {
      kind: "present",
      snapshotId:
        optionalString(
          (latestSnapshot as Record<string, unknown>).snapshotId ??
            (latestSnapshot as Record<string, unknown>).snapshot_id,
        ) ?? "",
      schemaVersion: requiredInteger(
        (latestSnapshot as Record<string, unknown>).schemaVersion ??
          (latestSnapshot as Record<string, unknown>).schema_version,
        "cursor latest snapshot",
      ),
      oplogSeq: requiredI64FromRawJson(latestSnapshotRawToken ?? "", ["oplogSeq", "oplog_seq"]),
      createdAt: "",
      checksum: null,
      coversTables: [],
    };
  } catch {
    return { kind: "unknown" };
  }
}

async function localSnapshotSatisfiesFreshnessGate(
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  accessToken: string,
  deviceId: string,
  latest: Extract<LocalLatestSnapshotStatus, { kind: "present" }>,
  minSnapshotCreatedAt: string,
): Promise<boolean> {
  const latestCreatedAt = normalizeSyncDatetime(latest.createdAt);
  if (latestCreatedAt === null) {
    throw new ConnectServiceError(
      "internal_error",
      "Invalid snapshot created_at in metadata: invalid datetime",
      500,
    );
  }
  const latestTime = new Date(latestCreatedAt).getTime();
  const minTime = new Date(minSnapshotCreatedAt).getTime();
  if (latestTime + 120 * 1000 > minTime) {
    return true;
  }
  const remoteCursor = await localEventsCursorBestEffort(env, fetchImpl, accessToken, deviceId);
  return remoteCursor !== null && compareI64Values(latest.oplogSeq, remoteCursor) >= 0;
}

async function fetchLocalEventsCursorOrThrow(
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  accessToken: string,
  deviceId: string,
): Promise<number> {
  let response: Response;
  try {
    response = await fetchImpl(
      `${normalizeConnectApiUrl(env.CONNECT_API_URL)}/api/v1/sync/events/cursor`,
      {
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          "x-wf-client-request-id": deviceSyncClientRequestId(deviceId),
          "x-wf-device-id": deviceId,
        },
      },
    );
  } catch (error) {
    throw new ConnectServiceError("internal_error", errorMessage(error), 500);
  }
  let bodyText: string;
  try {
    bodyText = await response.text();
  } catch (error) {
    throw new ConnectServiceError("internal_error", errorMessage(error), 500);
  }
  if (!response.ok) {
    throw new ConnectServiceError(
      "internal_error",
      connectDeviceSyncApiErrorMessage(response.status, bodyText),
      500,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch (error) {
    throw new ConnectServiceError(
      "internal_error",
      `Failed to parse cursor response: ${errorMessage(error)}`,
      500,
    );
  }
  if (!isRecord(parsed) || !validSyncCursorShape(parsed) || !validSyncCursorRawShape(bodyText)) {
    throw new ConnectServiceError("internal_error", "Failed to parse cursor response", 500);
  }
  return requiredInteger(parsed.cursor, "cursor response");
}

async function localEventsCursorBestEffort(
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  accessToken: string,
  deviceId: string,
): Promise<I64Value | null> {
  try {
    const response = await fetchImpl(
      `${normalizeConnectApiUrl(env.CONNECT_API_URL)}/api/v1/sync/events/cursor`,
      {
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          "x-wf-client-request-id": deviceSyncClientRequestId(deviceId),
          "x-wf-device-id": deviceId,
        },
      },
    );
    if (!response.ok) {
      return null;
    }
    const bodyText = await response.text();
    const parsed = JSON.parse(bodyText) as unknown;
    if (!isRecord(parsed) || !validSyncCursorRawShape(bodyText)) {
      return null;
    }
    return requiredI64FromRawJson(bodyText, ["cursor"]);
  } catch {
    return null;
  }
}

async function downloadLocalSnapshotWithPreconditions(
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  accessToken: string,
  deviceId: string,
  latest: Extract<LocalLatestSnapshotStatus, { kind: "present" }>,
): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetchImpl(
      `${normalizeConnectApiUrl(env.CONNECT_API_URL)}/api/v1/sync/snapshots/${encodeURIComponent(latest.snapshotId.trim())}`,
      {
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/octet-stream",
          "x-wf-client-request-id": deviceSyncClientRequestId(deviceId),
          "x-wf-device-id": deviceId,
        },
      },
    );
  } catch (error) {
    throw new ConnectServiceError("internal_error", errorMessage(error), 500);
  }
  if (response.status === 404) {
    throw new ConnectServiceError(
      "internal_error",
      `Snapshot ${latest.snapshotId.trim()} is no longer available. No valid snapshot to download.`,
      500,
    );
  }
  if (!response.ok) {
    let bodyText = "";
    try {
      bodyText = await response.text();
    } catch {
      bodyText = "";
    }
    throw new ConnectServiceError(
      "internal_error",
      connectDeviceSyncApiErrorMessage(response.status, bodyText),
      500,
    );
  }
  parseRequiredSnapshotI32Header(response.headers, "x-snapshot-schema-version");
  parseRequiredSnapshotStringHeader(response.headers, "x-snapshot-covers-tables");
  const expectedHeaderChecksum = parseRequiredSnapshotStringHeader(
    response.headers,
    "x-snapshot-checksum",
  );
  let blob: Uint8Array;
  try {
    blob = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    throw new ConnectServiceError("internal_error", errorMessage(error), 500);
  }
  const actualChecksum = `sha256:${createHash("sha256").update(blob).digest("hex")}`;
  if (expectedHeaderChecksum !== actualChecksum) {
    throw new ConnectServiceError(
      "internal_error",
      `Snapshot checksum mismatch (download header): expected=${expectedHeaderChecksum}, got=${actualChecksum}`,
      500,
    );
  }
  if (latest.checksum !== null && latest.checksum.trim() && latest.checksum !== actualChecksum) {
    throw new ConnectServiceError(
      "internal_error",
      `Snapshot checksum mismatch (latest metadata): expected=${latest.checksum}, got=${actualChecksum}`,
      500,
    );
  }
  return blob;
}

function parseRequiredSnapshotStringHeader(headers: Headers, name: string): string {
  const value = headers.get(name);
  if (value === null) {
    throw new ConnectServiceError("internal_error", `Invalid request: Missing header ${name}`, 500);
  }
  return value;
}

function parseRequiredSnapshotI32Header(headers: Headers, name: string): number {
  const value = parseRequiredSnapshotStringHeader(headers, name);
  if (!/^[+-]?\d+$/.test(value)) {
    throw new ConnectServiceError("internal_error", `Invalid request: Invalid header ${name}`, 500);
  }
  const parsed = Number(value);
  if (!isI32Integer(parsed)) {
    throw new ConnectServiceError("internal_error", `Invalid request: Invalid header ${name}`, 500);
  }
  return parsed;
}

async function decodeLocalSnapshotSqlitePayload(
  blob: Uint8Array,
  identity: ReturnType<typeof parseSyncIdentity> & { deviceId: string },
): Promise<Buffer> {
  if (!identity.rootKey) {
    throw new ConnectServiceError("internal_error", "Missing root_key in sync identity", 500);
  }
  if (!identity.keyVersion || identity.keyVersion <= 0) {
    throw new ConnectServiceError("internal_error", "Invalid key version in sync identity", 500);
  }
  const encryptedPayload = Buffer.from(blob).toString("utf8").trim();
  const crypto = createSyncCryptoService();
  let dek: string;
  try {
    dek = (await crypto.deriveDek(identity.rootKey, identity.keyVersion)).value;
  } catch (error) {
    throw new ConnectServiceError(
      "internal_error",
      `Failed to derive snapshot DEK: ${errorMessage(error)}`,
      500,
    );
  }
  let decrypted: string;
  try {
    decrypted = (await crypto.decrypt(dek, encryptedPayload)).value;
  } catch (error) {
    throw new ConnectServiceError(
      "internal_error",
      `Failed to decrypt snapshot payload: ${errorMessage(error)}`,
      500,
    );
  }
  const sqliteBytes = Buffer.from(decrypted.trim(), "base64");
  if (sqliteBytes.subarray(0, 16).toString("utf8") !== "SQLite format 3\u0000") {
    throw new ConnectServiceError(
      "internal_error",
      "Decrypted snapshot is not a valid SQLite image",
      500,
    );
  }
  return sqliteBytes;
}

function localSnapshotTablesToRestore(
  coversTables: string[],
): Array<(typeof APP_SYNC_TABLES)[number]> {
  const tables = coversTables.filter((table): table is (typeof APP_SYNC_TABLES)[number] =>
    (APP_SYNC_TABLES as readonly string[]).includes(table),
  );
  return tables.length > 0 ? tables : [...APP_SYNC_TABLES];
}

function restoreLocalSnapshotTablesFromFile(
  db: Database,
  snapshotPath: string,
  tablesToRestore: Array<(typeof APP_SYNC_TABLES)[number]>,
  cursor: number,
  identity: ReturnType<typeof parseSyncIdentity> & { deviceId: string },
): void {
  const alias = `snapshot_${randomUUID().replaceAll("-", "")}`;
  let attached = false;
  try {
    db.prepare(
      `ATTACH DATABASE '${escapeSqliteString(snapshotPath)}' AS ${quoteReplayIdentifier(alias)}`,
    ).run();
    attached = true;
    const restoreTransaction = db.transaction(() => {
      db.prepare("PRAGMA defer_foreign_keys = ON").run();
      const now = snapshotMetadataTimestampNow();
      db.prepare("DELETE FROM sync_outbox").run();
      db.prepare("DELETE FROM sync_entity_metadata").run();
      db.prepare("DELETE FROM sync_applied_events").run();
      db.prepare("DELETE FROM sync_table_state").run();
      db.prepare("DELETE FROM sync_device_config WHERE device_id <> ?").run(identity.deviceId);

      for (const table of tablesToRestore) {
        const targetColumns = localVisibleTableColumns(db, "main", table);
        const sourceColumns = localVisibleTableColumns(db, alias, table);
        if (sourceColumns.length === 0) {
          continue;
        }
        const sourceColumnSet = new Set(sourceColumns);
        const commonColumns = targetColumns.filter((column) => sourceColumnSet.has(column));
        if (commonColumns.length === 0) {
          throw new ConnectServiceError(
            "internal_error",
            `Snapshot table '${table}' has no compatible columns to restore`,
            500,
          );
        }
        const tableIdent = quoteReplayIdentifier(table);
        const aliasIdent = quoteReplayIdentifier(alias);
        const columnsSql = commonColumns.map(quoteReplayIdentifier).join(", ");
        const filter = SNAPSHOT_EXPORT_FILTERS[table];
        const clearSql =
          filter === undefined
            ? `DELETE FROM ${tableIdent}`
            : `DELETE FROM ${tableIdent} WHERE ${filter}`;
        db.prepare(clearSql).run();
        db.prepare(
          `
            INSERT INTO ${tableIdent} (${columnsSql})
            SELECT ${columnsSql} FROM ${aliasIdent}.${tableIdent}
          `,
        ).run();
        db.prepare(
          `
            INSERT INTO sync_table_state (
              table_name, enabled, last_snapshot_restore_at, last_incremental_apply_at
            )
            VALUES (?, 1, ?, NULL)
            ON CONFLICT(table_name) DO UPDATE SET
              enabled = 1,
              last_snapshot_restore_at = excluded.last_snapshot_restore_at
          `,
        ).run(table, now);
      }

      db.prepare(
        `
          INSERT INTO sync_cursor (id, cursor, updated_at)
          VALUES (1, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            cursor = excluded.cursor,
            updated_at = excluded.updated_at
        `,
      ).run(cursor, now);
      upsertRestoredLocalDeviceConfig(db, identity, now);
      db.prepare(
        `
          INSERT INTO sync_engine_state (
            id, lock_version, last_push_at, last_pull_at, last_error,
            consecutive_failures, next_retry_at, last_cycle_status, last_cycle_duration_ms
          )
          VALUES (1, 0, NULL, ?, NULL, 0, NULL, 'ok', NULL)
          ON CONFLICT(id) DO UPDATE SET
            last_pull_at = excluded.last_pull_at,
            last_error = NULL,
            consecutive_failures = 0,
            next_retry_at = NULL,
            last_cycle_status = 'ok'
        `,
      ).run(now);
    });
    restoreTransaction();
    try {
      db.prepare(`DETACH DATABASE ${quoteReplayIdentifier(alias)}`).run();
      attached = false;
    } catch (error) {
      console.warn(`[Connect] Failed to detach restored snapshot database: ${errorMessage(error)}`);
    }
  } catch (error) {
    throw new ConnectServiceError(
      "internal_error",
      `Failed to restore snapshot SQLite image: ${errorMessage(error)}`,
      500,
    );
  } finally {
    if (attached) {
      try {
        db.prepare(`DETACH DATABASE ${quoteReplayIdentifier(alias)}`).run();
      } catch {
        // Best-effort cleanup mirrors Rust's detach-on-error behavior.
      }
    }
  }
}

function localVisibleTableColumns(db: Database, schema: "main" | string, table: string): string[] {
  return db
    .query<{ name: string; hidden: number }, [string]>(
      `SELECT name, hidden FROM ${quoteReplayIdentifier(schema)}.pragma_table_xinfo(?)`,
    )
    .all(table)
    .filter((column) => column.hidden === 0)
    .map((column) => column.name);
}

function upsertRestoredLocalDeviceConfig(
  db: Database,
  identity: ReturnType<typeof parseSyncIdentity> & { deviceId: string },
  now: string,
): void {
  if (sqliteColumnExists(db, "sync_device_config", "min_snapshot_created_at")) {
    db.prepare(
      `
        INSERT INTO sync_device_config (
          device_id, key_version, trust_state, last_bootstrap_at, min_snapshot_created_at
        )
        VALUES (?, ?, 'trusted', ?, NULL)
        ON CONFLICT(device_id) DO UPDATE SET
          key_version = excluded.key_version,
          trust_state = 'trusted',
          last_bootstrap_at = excluded.last_bootstrap_at
      `,
    ).run(identity.deviceId, identity.keyVersion, now);
    return;
  }
  db.prepare(
    `
      INSERT INTO sync_device_config (device_id, key_version, trust_state, last_bootstrap_at)
      VALUES (?, ?, 'trusted', ?)
      ON CONFLICT(device_id) DO UPDATE SET
        key_version = excluded.key_version,
        trust_state = 'trusted',
        last_bootstrap_at = excluded.last_bootstrap_at
    `,
  ).run(identity.deviceId, identity.keyVersion, now);
}

function clearLocalMinSnapshotCreatedAt(db: Database, deviceId: string): void {
  if (!sqliteColumnExists(db, "sync_device_config", "min_snapshot_created_at")) {
    return;
  }
  db.prepare(
    `
      UPDATE sync_device_config
      SET min_snapshot_created_at = NULL
      WHERE device_id = ?
    `,
  ).run(deviceId);
}

function chooseLocalSnapshotStatus(
  latest: Extract<LocalLatestSnapshotStatus, { kind: "present" }>,
  cursorLatest: Extract<LocalLatestSnapshotStatus, { kind: "present" }>,
): Extract<LocalLatestSnapshotStatus, { kind: "present" }> {
  const latestId = latest.snapshotId.trim();
  const cursorId = cursorLatest.snapshotId.trim();
  if (!cursorId) {
    return latest;
  }
  if (!isBackendStrictUuid(latestId) && isBackendStrictUuid(cursorId)) {
    return cursorLatest;
  }
  if (compareI64Values(cursorLatest.oplogSeq, latest.oplogSeq) > 0) {
    return cursorLatest;
  }
  return latest;
}

function isBackendStrictUuid(input: string): boolean {
  const value = input.trim();
  if (
    value.toLowerCase() === "00000000-0000-0000-0000-000000000000" ||
    value.toLowerCase() === "ffffffff-ffff-ffff-ffff-ffffffffffff"
  ) {
    return true;
  }
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(
    value,
  );
}

function isSnapshotIdValidationErrorBody(bodyText: string): boolean {
  const lower = bodyText.toLowerCase();
  return (
    bodyText.includes("snapshotId") &&
    (lower.includes("invalid uuid") || lower.includes("invalid_format"))
  );
}

function validSnapshotLatestMetadataShape(value: Record<string, unknown>): boolean {
  const coversTables = value.coversTables ?? value.covers_tables;
  return (
    optionalString(value.snapshotId ?? value.snapshot_id) !== null &&
    isI32Integer(value.schemaVersion ?? value.schema_version) &&
    Array.isArray(coversTables) &&
    coversTables.every((entry) => typeof entry === "string") &&
    isJsonParsedInteger(value.oplogSeq ?? value.oplog_seq) &&
    isJsonParsedInteger(value.sizeBytes ?? value.size_bytes) &&
    optionalString(value.checksum) !== null &&
    optionalString(value.createdAt ?? value.created_at) !== null
  );
}

function validSnapshotLatestMetadataRawShape(text: string): boolean {
  const snapshotIdTokens = rawTokensForAliases(text, ["snapshotId", "snapshot_id"]);
  const schemaVersionTokens = rawTokensForAliases(text, ["schemaVersion", "schema_version"]);
  const coversTablesTokens = rawTokensForAliases(text, ["coversTables", "covers_tables"]);
  const oplogSeqTokens = rawTokensForAliases(text, ["oplogSeq", "oplog_seq"]);
  const sizeBytesTokens = rawTokensForAliases(text, ["sizeBytes", "size_bytes"]);
  const checksumTokens = rawTokensForAliases(text, ["checksum"]);
  const createdAtTokens = rawTokensForAliases(text, ["createdAt", "created_at"]);
  return (
    snapshotIdTokens.length === 1 &&
    schemaVersionTokens.length === 1 &&
    coversTablesTokens.length === 1 &&
    oplogSeqTokens.length === 1 &&
    sizeBytesTokens.length === 1 &&
    checksumTokens.length === 1 &&
    createdAtTokens.length === 1 &&
    rawJsonStringTokenIsValid(snapshotIdTokens[0] ?? "") &&
    rawJsonI32TokenIsValid(schemaVersionTokens[0] ?? "") &&
    (coversTablesTokens[0] ?? "").trim().startsWith("[") &&
    rawJsonI64TokenIsValid(oplogSeqTokens[0] ?? "") &&
    rawJsonI64TokenIsValid(sizeBytesTokens[0] ?? "") &&
    rawJsonStringTokenIsValid(checksumTokens[0] ?? "") &&
    rawJsonStringTokenIsValid(createdAtTokens[0] ?? "")
  );
}

function parseSnapshotCoversTables(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function validSyncLatestSnapshotRefShape(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }
  return (
    optionalString(value.snapshotId ?? value.snapshot_id) !== null &&
    isI32Integer(value.schemaVersion ?? value.schema_version) &&
    isJsonParsedInteger(value.oplogSeq ?? value.oplog_seq)
  );
}

function validSyncCursorShape(value: Record<string, unknown>): boolean {
  const gcWatermark = value.gcWatermark ?? value.gc_watermark;
  return (
    isSafeI64Integer(value.cursor) &&
    (gcWatermark === undefined || gcWatermark === null || isSafeI64Integer(gcWatermark))
  );
}

function validSyncCursorRawShape(text: string): boolean {
  const cursorTokens = rawTokensForAliases(text, ["cursor"]);
  const gcWatermarkTokens = rawTokensForAliases(text, ["gcWatermark", "gc_watermark"]);
  return (
    cursorTokens.length === 1 &&
    rawJsonI64TokenIsValid(cursorTokens[0] ?? "") &&
    gcWatermarkTokens.length <= 1 &&
    (gcWatermarkTokens.length === 0 || rawJsonI64OptionTokenIsValid(gcWatermarkTokens[0] ?? ""))
  );
}

function isSafeI64Integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isJsonParsedInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function requiredI64FromRawJson(rawJson: string, aliases: string[]): I64Value {
  const tokens = rawTokensForAliases(rawJson, aliases);
  const parsed = i64FromRawToken(tokens[0] ?? "");
  if (tokens.length !== 1 || parsed === null) {
    throw new ConnectServiceError("internal_error", "Failed to parse snapshot metadata", 500);
  }
  return parsed;
}

function i64FromRawToken(token: string): I64Value | null {
  if (!rawJsonI64TokenIsValid(token)) {
    return null;
  }
  const parsed = BigInt(token.trim());
  if (parsed >= MIN_SAFE_BIGINT && parsed <= MAX_SAFE_BIGINT) {
    return Number(parsed);
  }
  return parsed;
}

function i64ToSafeNumberOrNull(value: I64Value | null): number | null {
  return typeof value === "number" ? value : null;
}

function compareI64Values(left: I64Value, right: I64Value): number {
  const leftBigInt = typeof left === "bigint" ? left : BigInt(left);
  const rightBigInt = typeof right === "bigint" ? right : BigInt(right);
  if (leftBigInt === rightBigInt) {
    return 0;
  }
  return leftBigInt > rightBigInt ? 1 : -1;
}

function resetAndMarkLocalBootstrapComplete(
  db: Database,
  identity: ReturnType<typeof parseSyncIdentity> & { deviceId: string },
): void {
  resetLocalSyncSession(db);
  const now = new Date().toISOString();
  if (sqliteColumnExists(db, "sync_device_config", "min_snapshot_created_at")) {
    db.prepare(
      `
        INSERT INTO sync_device_config (
          device_id, key_version, trust_state, last_bootstrap_at, min_snapshot_created_at
        )
        VALUES (?, ?, 'trusted', ?, NULL)
        ON CONFLICT(device_id) DO UPDATE SET
          key_version = excluded.key_version,
          trust_state = excluded.trust_state,
          last_bootstrap_at = excluded.last_bootstrap_at,
          min_snapshot_created_at = excluded.min_snapshot_created_at
      `,
    ).run(identity.deviceId, identity.keyVersion, now);
    return;
  }
  db.prepare(
    `
      INSERT INTO sync_device_config (device_id, key_version, trust_state, last_bootstrap_at)
      VALUES (?, ?, 'trusted', ?)
      ON CONFLICT(device_id) DO UPDATE SET
        key_version = excluded.key_version,
        trust_state = excluded.trust_state,
        last_bootstrap_at = excluded.last_bootstrap_at
    `,
  ).run(identity.deviceId, identity.keyVersion, now);
}

function getLocalSyncCursor(db: Database): number {
  return (
    db.query<SyncCursorRow, []>("SELECT cursor FROM sync_cursor WHERE id = 1").get()?.cursor ?? 0
  );
}

interface LocalReconcileReadyState {
  action: string | null;
  actionInvalid: boolean;
  cursor: number | null;
  cursorInvalid: boolean;
  latestSnapshotId: string | null;
  latestSnapshotSeq: number | null;
  latestSnapshotInvalid: boolean;
}

async function fetchLocalReconcileReadyStateBestEffort(
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  accessToken: string,
  deviceId: string,
): Promise<LocalReconcileReadyState> {
  try {
    const response = await fetchImpl(
      `${normalizeConnectApiUrl(env.CONNECT_API_URL)}/api/v1/sync/events/reconcile-ready-state`,
      {
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          "x-wf-client-request-id": deviceSyncClientRequestId(deviceId),
          "x-wf-device-id": deviceId,
        },
      },
    );
    if (!response.ok) {
      return emptyLocalReconcileReadyState();
    }
    const responseText = await response.text();
    const rawActionTokens = topLevelJsonPropertyRawTokens(responseText, "action");
    const rawActionToken = rawActionTokens[0];
    const rawCursorTokens = topLevelJsonPropertyRawTokens(responseText, "cursor");
    const rawCursorToken = rawCursorTokens[0];
    const parsed = JSON.parse(responseText) as unknown;
    if (!isRecord(parsed)) {
      return emptyLocalReconcileReadyState();
    }
    const latestSnapshot = parsed.latestSnapshot ?? parsed.latest_snapshot;
    const latestSnapshotRawTokens = [
      ...topLevelJsonPropertyRawTokens(responseText, "latestSnapshot"),
      ...topLevelJsonPropertyRawTokens(responseText, "latest_snapshot"),
    ];
    const latestSnapshotRawToken = latestSnapshotRawTokens[0];
    const cursorValue = parsed.cursor;
    const cursor =
      cursorValue === undefined || cursorValue === null
        ? null
        : isSafeI64Integer(cursorValue)
          ? cursorValue
          : null;
    const parsedLatestSnapshot = parseLocalReconcileLatestSnapshot(
      latestSnapshot,
      latestSnapshotRawToken,
    );
    return {
      action: optionalString(parsed.action),
      actionInvalid:
        rawActionTokens.length !== 1 ||
        rawActionToken === undefined ||
        !rawJsonStringTokenIsValid(rawActionToken) ||
        optionalString(parsed.action) === null,
      cursor,
      cursorInvalid:
        rawCursorTokens.length > 1 ||
        (rawCursorToken !== undefined && !rawJsonI64OptionTokenIsValid(rawCursorToken)) ||
        (cursorValue !== undefined && cursorValue !== null && cursor === null),
      latestSnapshotId: parsedLatestSnapshot.snapshotId,
      latestSnapshotSeq: i64ToSafeNumberOrNull(parsedLatestSnapshot.oplogSeq),
      latestSnapshotInvalid:
        latestSnapshotRawTokens.length > 1 ||
        parsedLatestSnapshot.invalid ||
        (parsedLatestSnapshot.oplogSeq !== null &&
          i64ToSafeNumberOrNull(parsedLatestSnapshot.oplogSeq) === null),
    };
  } catch {
    return emptyLocalReconcileReadyState();
  }
}

async function fetchLocalReconcileReadyActionBestEffort(
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  accessToken: string,
  deviceId: string,
): Promise<string | null> {
  const state = await fetchLocalReconcileReadyStateBestEffort(
    env,
    fetchImpl,
    accessToken,
    deviceId,
  );
  return state.actionInvalid || state.cursorInvalid || state.latestSnapshotInvalid
    ? null
    : state.action;
}

function emptyLocalReconcileReadyState(): LocalReconcileReadyState {
  return {
    action: null,
    actionInvalid: false,
    cursor: null,
    cursorInvalid: false,
    latestSnapshotId: null,
    latestSnapshotSeq: null,
    latestSnapshotInvalid: false,
  };
}

function reconcileActionRequiresSnapshot(action: string | null): boolean {
  return action === "WAIT_SNAPSHOT" || action === "BOOTSTRAP_SNAPSHOT";
}

async function generateSnapshotIfTrusted(
  db: Database,
  secretService: SecretService | undefined,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  restoreSession?: RestoreConnectSession,
  isSnapshotUploadCancelled: () => boolean = () => false,
): Promise<Record<string, unknown>> {
  if (!secretService) {
    throw deviceSyncDisabled();
  }
  const identity = await requireLocalSyncIdentity(secretService);
  const deviceId = identity.deviceId;
  const session = restoreSession
    ? await restoreSession()
    : await restoreLocalSyncSession(secretService, env, fetchImpl, () => 0);
  const device = await fetchLocalDeviceSyncDevice(env, fetchImpl, session.accessToken, deviceId);
  if (device.trustState !== "trusted") {
    return {
      status: "skipped",
      snapshotId: null,
      oplogSeq: null,
      message: "Current device is not trusted",
    };
  }
  if (isSnapshotUploadCancelled()) {
    return snapshotUploadCancelledResult("Snapshot upload cancelled before export");
  }
  const localCursor = getLocalSyncCursor(db);
  const serverCursor = await fetchLocalEventsCursorOrThrow(
    env,
    fetchImpl,
    session.accessToken,
    deviceId,
  );
  if (localCursor > serverCursor) {
    throw new ConnectServiceError(
      "internal_error",
      "SYNC_SOURCE_RESTORE_REQUIRED: This device needs to set up sync again before you add another device.",
      500,
    );
  }
  const latestSnapshotStatus = await localLatestSnapshotStatusBestEffort(
    env,
    fetchImpl,
    session.accessToken,
    deviceId,
  );
  if (
    latestSnapshotStatus.kind === "present" &&
    compareI64Values(latestSnapshotStatus.oplogSeq, localCursor) >= 0
  ) {
    return {
      status: "uploaded",
      snapshotId: latestSnapshotStatus.snapshotId,
      oplogSeq: i64ToSafeNumberOrNull(latestSnapshotStatus.oplogSeq),
      message: "Latest remote snapshot already covers current cursor",
    };
  }
  return await uploadLocalDeviceSnapshot(
    db,
    env,
    fetchImpl,
    session.accessToken,
    identity,
    localCursor,
    isSnapshotUploadCancelled,
  );
}

async function uploadLocalDeviceSnapshot(
  db: Database,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  accessToken: string,
  identity: ReturnType<typeof parseSyncIdentity> & { deviceId: string },
  baseSeq: number,
  isSnapshotUploadCancelled: () => boolean,
): Promise<Record<string, unknown>> {
  if (!identity.rootKey) {
    throw new ConnectServiceError(
      "internal_error",
      "Snapshot export failed: No root key configured",
      500,
    );
  }
  const keyVersion = Math.max(1, identity.keyVersion ?? 1);
  if (isSnapshotUploadCancelled()) {
    return snapshotUploadCancelledResult("Snapshot upload cancelled before export");
  }
  const sqliteBytes = exportLocalSnapshotSqliteImage(db);
  if (isSnapshotUploadCancelled()) {
    return snapshotUploadCancelledResult("Snapshot upload cancelled after export");
  }
  const crypto = createSyncCryptoService();
  let dek: string;
  try {
    dek = (await crypto.deriveDek(identity.rootKey, keyVersion)).value;
  } catch (error) {
    throw new ConnectServiceError(
      "internal_error",
      `Failed to derive snapshot DEK: ${errorMessage(error)}`,
      500,
    );
  }
  const encryptedSnapshot = (await crypto.encrypt(dek, sqliteBytes.toString("base64"))).value;
  const payload = Buffer.from(encryptedSnapshot, "utf8");
  const checksum = `sha256:${createHash("sha256").update(payload).digest("hex")}`;
  const metadataPayload = (
    await crypto.encrypt(
      dek,
      JSON.stringify({
        schemaVersion: 1,
        coversTables: APP_SYNC_TABLES,
        generatedAt: snapshotMetadataTimestampNow(),
      }),
    )
  ).value;
  const uploadHeaders = {
    eventId: randomUUID(),
    schemaVersion: 1,
    coversTables: APP_SYNC_TABLES,
    sizeBytes: payload.byteLength,
    checksum,
    metadataPayload,
    payloadKeyVersion: keyVersion,
    baseSeq,
  };
  let response: { snapshotId: string; oplogSeq: I64Value };
  for (let attempt = 1; ; attempt += 1) {
    if (isSnapshotUploadCancelled()) {
      return snapshotUploadCancelledResult("Snapshot upload cancelled during transfer");
    }
    try {
      response = await postLocalSnapshotUpload(
        env,
        fetchImpl,
        accessToken,
        identity.deviceId,
        uploadHeaders,
        payload,
      );
      break;
    } catch (error) {
      if (
        error instanceof LocalSnapshotUploadError &&
        localSnapshotUploadErrorIsRetryable(error) &&
        attempt < SNAPSHOT_UPLOAD_MAX_ATTEMPTS
      ) {
        if (isSnapshotUploadCancelled()) {
          return snapshotUploadCancelledResult("Snapshot upload cancelled during transfer");
        }
        await delay(snapshotUploadBackoffMs(attempt));
        continue;
      }
      if (localSnapshotUploadErrorIsIndexConflict(error)) {
        const latestSnapshotStatus = await localLatestSnapshotStatusBestEffort(
          env,
          fetchImpl,
          accessToken,
          identity.deviceId,
        );
        if (
          latestSnapshotStatus.kind === "present" &&
          compareI64Values(latestSnapshotStatus.oplogSeq, baseSeq) >= 0
        ) {
          return {
            status: "uploaded",
            snapshotId: latestSnapshotStatus.snapshotId,
            oplogSeq: i64ToSafeNumberOrNull(latestSnapshotStatus.oplogSeq),
            message: "Latest remote snapshot already covers current cursor",
          };
        }
      }
      throw error;
    }
  }
  return {
    status: "uploaded",
    snapshotId: response.snapshotId,
    oplogSeq: i64ToSafeNumberOrNull(response.oplogSeq),
    message: "Snapshot uploaded",
  };
}

function exportLocalSnapshotSqliteImage(db: Database): Buffer {
  const snapshotPath = join(tmpdir(), `wf_snapshot_export_${randomUUID()}.db`);
  const alias = `snapshot_export_${randomUUID().replaceAll("-", "")}`;
  let attached = false;
  try {
    db.prepare(
      `ATTACH DATABASE '${escapeSqliteString(snapshotPath)}' AS ${quoteReplayIdentifier(alias)}`,
    ).run();
    attached = true;
    const exportTransaction = db.transaction(() => {
      for (const table of APP_SYNC_TABLES) {
        const filter = SNAPSHOT_EXPORT_FILTERS[table];
        const sql =
          filter === undefined
            ? `CREATE TABLE ${quoteReplayIdentifier(alias)}.${quoteReplayIdentifier(table)} AS SELECT * FROM main.${quoteReplayIdentifier(table)}`
            : `CREATE TABLE ${quoteReplayIdentifier(alias)}.${quoteReplayIdentifier(table)} AS SELECT * FROM main.${quoteReplayIdentifier(table)} WHERE ${filter}`;
        db.prepare(sql).run();
      }
    });
    exportTransaction();
    db.prepare(`DETACH DATABASE ${quoteReplayIdentifier(alias)}`).run();
    attached = false;
    return readFileSync(snapshotPath);
  } catch (error) {
    throw new ConnectServiceError(
      "internal_error",
      `Failed to export snapshot SQLite image: ${errorMessage(error)}`,
      500,
    );
  } finally {
    if (attached) {
      try {
        db.prepare(`DETACH DATABASE ${quoteReplayIdentifier(alias)}`).run();
      } catch {
        // Best-effort cleanup mirrors Rust's detach-on-error behavior.
      }
    }
    rmSync(snapshotPath, { force: true });
  }
}

async function postLocalSnapshotUpload(
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  accessToken: string,
  deviceId: string,
  headers: {
    eventId: string;
    schemaVersion: number;
    coversTables: readonly string[];
    sizeBytes: number;
    checksum: string;
    metadataPayload: string;
    payloadKeyVersion: number;
    baseSeq: number;
  },
  payload: Buffer,
): Promise<{ snapshotId: string; oplogSeq: I64Value }> {
  let response: Response;
  try {
    response = await fetchImpl(
      `${normalizeConnectApiUrl(env.CONNECT_API_URL)}/api/v1/sync/snapshots/upload`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/octet-stream",
          "content-length": String(headers.sizeBytes),
          "x-wf-client-request-id": deviceSyncClientRequestId(deviceId),
          "x-wf-device-id": deviceId,
          "x-snapshot-event-id": headers.eventId,
          "x-snapshot-schema-version": String(headers.schemaVersion),
          "x-snapshot-covers-tables": headers.coversTables.join(","),
          "x-snapshot-size-bytes": String(headers.sizeBytes),
          "x-snapshot-checksum": headers.checksum,
          "x-snapshot-metadata-payload": headers.metadataPayload,
          "x-snapshot-payload-key-version": String(headers.payloadKeyVersion),
          "x-snapshot-base-seq": String(headers.baseSeq),
        },
        body: new Uint8Array(payload),
      },
    );
  } catch (error) {
    throw new LocalSnapshotUploadError(`Request failed: ${errorMessage(error)}`, 0, null, null);
  }
  const bodyText = await response.text();
  if (!response.ok) {
    const parsedError = parseLocalSnapshotUploadError(response.status, bodyText);
    throw new LocalSnapshotUploadError(
      connectDeviceSyncApiErrorMessage(response.status, bodyText),
      response.status,
      parsedError.code,
      parsedError.message,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText) as unknown;
  } catch (error) {
    throw new ConnectServiceError(
      "internal_error",
      `Failed to parse snapshot upload response: ${errorMessage(error)}`,
      500,
    );
  }
  if (!isRecord(parsed)) {
    throw new ConnectServiceError(
      "internal_error",
      "Failed to parse snapshot upload response",
      500,
    );
  }
  const snapshotId = requiredStringValue(
    parsed.snapshotId ?? parsed.snapshot_id,
    "snapshot upload response",
  );
  requiredStringValue(parsed.r2Key ?? parsed.r2_key, "snapshot upload response");
  requiredStringValue(parsed.createdAt ?? parsed.created_at, "snapshot upload response");
  return {
    snapshotId,
    oplogSeq: requiredI64FromRawJson(bodyText, ["oplogSeq", "oplog_seq"]),
  };
}

function escapeSqliteString(value: string): string {
  return value.replaceAll("'", "''");
}

function snapshotMetadataTimestampNow(): string {
  const iso = new Date().toISOString();
  return iso.endsWith(".000Z") ? `${iso.slice(0, -5)}+00:00` : iso.replace(/Z$/u, "+00:00");
}

function parseLocalSnapshotUploadError(
  status: number,
  bodyText: string,
): { code: string | null; message: string | null } {
  try {
    const parsed = JSON.parse(bodyText) as unknown;
    if (!isRecord(parsed)) {
      return { code: null, message: null };
    }
    return {
      code: optionalString(parsed.code) ?? optionalString(parsed.error),
      message: optionalString(parsed.message) ?? `HTTP ${status}`,
    };
  } catch {
    return { code: null, message: bodyText.trim() || `HTTP ${status}` };
  }
}

function snapshotUploadCancelledResult(message: string): Record<string, unknown> {
  return {
    status: "cancelled",
    snapshotId: null,
    oplogSeq: null,
    message,
  };
}

function localSnapshotUploadErrorIsRetryable(error: LocalSnapshotUploadError): boolean {
  if (error.status === 0) {
    return true;
  }
  if (error.status === 408 || error.status === 429 || error.status >= 500) {
    return true;
  }
  if (error.code === "SYNC_TRANSACTION_FAILED") {
    return !error.cloudMessage?.toLowerCase().includes("snapshot index conflict");
  }
  return false;
}

function localSnapshotUploadErrorIsIndexConflict(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return message.includes("sync_transaction_failed") && message.includes("snapshot index conflict");
}

function snapshotUploadBackoffMs(attempt: number): number {
  const exponent = Math.min(Math.max(attempt - 1, 0), 8);
  return Math.min(SNAPSHOT_UPLOAD_BASE_BACKOFF_MS * 2 ** exponent, SNAPSHOT_UPLOAD_MAX_BACKOFF_MS);
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  const maybeUnref = (timer as { unref?: () => void }).unref;
  if (typeof maybeUnref === "function") {
    maybeUnref.call(timer);
  }
}

async function requireLocalSyncIdentityDeviceId(
  secretService: SecretService | undefined,
): Promise<string> {
  return (await requireLocalSyncIdentity(secretService)).deviceId;
}

async function requireLocalSyncIdentity(
  secretService: SecretService | undefined,
): Promise<ReturnType<typeof parseSyncIdentity> & { deviceId: string }> {
  if (!secretService) {
    throw deviceSyncDisabled();
  }
  const rawIdentity = await secretService.getSecret(DEVICE_SYNC_IDENTITY_KEY);
  if (rawIdentity === null) {
    throw new ConnectServiceError(
      "internal_error",
      "No sync identity configured. Please enable sync first.",
      500,
    );
  }
  let identity: ReturnType<typeof parseSyncIdentity>;
  try {
    identity = parseStoredSyncIdentity(rawIdentity);
  } catch {
    throw new ConnectServiceError(
      "internal_error",
      "No sync identity configured. Please enable sync first.",
      500,
    );
  }
  if (!identity.deviceId) {
    throw new ConnectServiceError("internal_error", "No device ID configured", 500);
  }
  return { ...identity, deviceId: identity.deviceId };
}

async function triggerLocalDeviceSyncCycle(
  db: Database,
  secretService: SecretService | undefined,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  restoreSession?: RestoreConnectSession,
): Promise<Record<string, unknown>> {
  const cursor =
    db.query<SyncCursorRow, []>("SELECT cursor FROM sync_cursor WHERE id = 1").get()?.cursor ?? 0;
  const lockVersion =
    db
      .query<
        { lock_version: number },
        []
      >("SELECT lock_version FROM sync_engine_state WHERE id = 1")
      .get()?.lock_version ?? 0;
  if (!secretService) {
    markLocalSyncCycleError(
      db,
      "config_error",
      "No sync identity configured. Please enable sync first.",
    );
    return localSyncCycleResult("config_error", lockVersion, cursor);
  }
  const deviceId = await readLocalSyncIdentityDeviceId(secretService);
  if (deviceId === undefined) {
    markLocalSyncCycleError(
      db,
      "config_error",
      "No sync identity configured. Please enable sync first.",
    );
    return localSyncCycleResult("config_error", lockVersion, cursor);
  }
  if (deviceId === null) {
    markLocalSyncCycleOutcome(db, "not_ready");
    return localSyncCycleResult("not_ready", lockVersion, cursor);
  }
  try {
    let session: { accessToken: string; refreshToken: string };
    if (restoreSession) {
      session = await restoreSession();
    } else {
      session = await restoreLocalSyncSession(secretService, env, fetchImpl, () => 0);
    }
    const state = await getLocalDeviceSyncState(secretService, env, fetchImpl, session.accessToken);
    if (state.state !== "READY") {
      persistNotReadyDeviceConfigBestEffort(db, state, deviceId);
      markLocalSyncCycleOutcome(db, "not_ready");
      return localSyncCycleResult("not_ready", lockVersion, cursor);
    }
    const identity = await requireLocalSyncIdentity(secretService);
    try {
      persistReadyDeviceConfigFromIdentity(db, identity);
    } catch (error) {
      console.warn(`[Connect] Failed to persist READY device sync config: ${errorMessage(error)}`);
    }
    const reconcile = await fetchLocalReconcileReadyStateBestEffort(
      env,
      fetchImpl,
      session.accessToken,
      deviceId,
    );
    if (reconcile.actionInvalid || reconcile.cursorInvalid || reconcile.latestSnapshotInvalid) {
      throw deviceSyncDisabled();
    }
    if (reconcile.action === "NOOP" && !localHasPendingSyncOutbox(db)) {
      markLocalSyncCycleOutcome(db, "ok");
      localPruneAppliedEventsAfterSuccessfulCycle(db, cursor);
      return localSyncCycleResult("ok", 0, cursor);
    }
    if (reconcile.action === "WAIT_SNAPSHOT") {
      markLocalSyncCycleOutcome(db, "wait_snapshot", null, localWaitSnapshotRetryAt());
      return localSyncCycleResult("wait_snapshot", 0, cursor);
    }
    if (reconcile.action === "BOOTSTRAP_SNAPSHOT") {
      markLocalSyncCycleOutcome(db, "stale_cursor");
      return localSyncCycleResult(
        "stale_cursor",
        0,
        cursor,
        reconcile.latestSnapshotId,
        reconcile.latestSnapshotSeq,
      );
    }
    if (
      reconcile.action === "PULL_TAIL" &&
      !reconcile.cursorInvalid &&
      localReconcileCursorOrDefault(reconcile) <= cursor &&
      !localHasPendingSyncOutbox(db)
    ) {
      const acquiredLockVersion = localAcquireSyncCycleLock(db);
      markLocalSyncCycleOutcome(db, "ok");
      localPruneAppliedEventsAfterSuccessfulCycle(db, cursor);
      return localSyncCycleResult("ok", acquiredLockVersion, cursor);
    }
    if (
      reconcile.action === "PULL_TAIL" &&
      !reconcile.cursorInvalid &&
      localReconcileCursorOrDefault(reconcile) > cursor &&
      !localHasPendingSyncOutbox(db)
    ) {
      const acquiredLockVersion = localAcquireSyncCycleLock(db);
      let pullResult: { pulledCount: number; cursor: number };
      try {
        pullResult = await localPullRemoteSyncEvents(
          db,
          env,
          fetchImpl,
          session.accessToken,
          identity,
          cursor,
        );
      } catch (error) {
        if (error instanceof ConnectNotImplementedError) {
          throw error;
        }
        if (error instanceof LocalPullStaleCursorError) {
          markLocalSyncCycleError(db, "stale_cursor", error.message);
          return localSyncCycleResult(
            "stale_cursor",
            acquiredLockVersion,
            cursor,
            error.snapshotId,
            error.snapshotSeq,
          );
        }
        markLocalSyncCycleError(db, "pull_error", `Pull failed: ${errorMessage(error)}`);
        return localSyncCycleResult("pull_error", acquiredLockVersion, cursor);
      }
      markLocalSyncCycleOutcome(db, "ok");
      localPruneAppliedEventsAfterSuccessfulCycle(db, pullResult.cursor);
      return localSyncCycleResult("ok", acquiredLockVersion, pullResult.cursor, null, null, {
        pulledCount: pullResult.pulledCount,
      });
    }
    if (
      (reconcile.action === "NOOP" || reconcile.action === "PULL_TAIL") &&
      localHasPendingSyncOutbox(db)
    ) {
      const acquiredLockVersion = localAcquireSyncCycleLock(db);
      let pushResult: {
        pushedCount: number;
        serverCursor: number;
        deadLetterCount: number;
        status?: "ok" | "key_version_mismatch";
      };
      try {
        pushResult = await localPushPendingSyncOutbox(
          db,
          env,
          fetchImpl,
          session.accessToken,
          identity,
          cursor,
        );
      } catch (error) {
        markLocalSyncCycleError(db, "push_error", `Push failed: ${errorMessage(error)}`);
        return localSyncCycleResult("push_error", acquiredLockVersion, cursor);
      }
      if (pushResult.status !== undefined) {
        if (pushResult.status === "ok") {
          markLocalSyncCycleOutcome(db, "ok");
          localPruneAppliedEventsAfterSuccessfulCycle(db, cursor);
        } else {
          markLocalSyncCycleError(
            db,
            pushResult.status,
            "Key version mismatch — re-pairing required",
          );
        }
        return localSyncCycleResult(pushResult.status, acquiredLockVersion, cursor, null, null, {
          pushedCount: pushResult.pushedCount,
          deadLetterCount: pushResult.deadLetterCount,
        });
      }
      const followUpCursor = Math.max(
        pushResult.serverCursor,
        localReconcileCursorOrDefault(reconcile),
      );
      if (followUpCursor > cursor) {
        let pullResult: { pulledCount: number; cursor: number };
        try {
          pullResult = await localPullRemoteSyncEvents(
            db,
            env,
            fetchImpl,
            session.accessToken,
            identity,
            cursor,
          );
        } catch (error) {
          if (error instanceof ConnectNotImplementedError) {
            throw error;
          }
          if (error instanceof LocalPullStaleCursorError) {
            markLocalSyncCycleError(db, "stale_cursor", error.message);
            return localSyncCycleResult(
              "stale_cursor",
              acquiredLockVersion,
              cursor,
              error.snapshotId,
              error.snapshotSeq,
              {
                pushedCount: pushResult.pushedCount,
                deadLetterCount: pushResult.deadLetterCount,
              },
            );
          }
          markLocalSyncCycleError(db, "pull_error", `Pull failed: ${errorMessage(error)}`);
          return localSyncCycleResult("pull_error", acquiredLockVersion, cursor, null, null, {
            pushedCount: pushResult.pushedCount,
          });
        }
        markLocalSyncCycleOutcome(db, "ok");
        localPruneAppliedEventsAfterSuccessfulCycle(db, pullResult.cursor);
        return localSyncCycleResult("ok", acquiredLockVersion, pullResult.cursor, null, null, {
          pushedCount: pushResult.pushedCount,
          pulledCount: pullResult.pulledCount,
          deadLetterCount: pushResult.deadLetterCount,
        });
      }
      markLocalSyncCycleOutcome(db, "ok");
      localPruneAppliedEventsAfterSuccessfulCycle(db, cursor);
      return localSyncCycleResult("ok", acquiredLockVersion, cursor, null, null, {
        pushedCount: pushResult.pushedCount,
        deadLetterCount: pushResult.deadLetterCount,
      });
    }
    throw deviceSyncDisabled();
  } catch (error) {
    if (error instanceof ConnectNotImplementedError) {
      throw error;
    }
    markLocalSyncCycleError(db, "state_error", `Failed to read sync state: ${errorMessage(error)}`);
    return localSyncCycleResult("state_error", lockVersion, cursor);
  }
}

function persistNotReadyDeviceConfigBestEffort(
  db: Database,
  state: Record<string, unknown>,
  fallbackDeviceId: string | null = null,
): void {
  if (!sqliteTableExists(db, "sync_device_config")) {
    return;
  }
  const deviceId = optionalString(state.deviceId) ?? fallbackDeviceId;
  if (!deviceId) {
    return;
  }
  const keyVersion = optionalNumber(state.keyVersion);
  try {
    if (sqliteColumnExists(db, "sync_device_config", "min_snapshot_created_at")) {
      db.prepare(
        `
          INSERT INTO sync_device_config (
            device_id, key_version, trust_state, last_bootstrap_at, min_snapshot_created_at
          )
          VALUES (?, ?, 'untrusted', NULL, NULL)
          ON CONFLICT(device_id) DO UPDATE SET
            key_version = excluded.key_version,
            trust_state = excluded.trust_state,
            last_bootstrap_at = excluded.last_bootstrap_at,
            min_snapshot_created_at = excluded.min_snapshot_created_at
        `,
      ).run(deviceId, keyVersion);
      return;
    }
    db.prepare(
      `
        INSERT INTO sync_device_config (device_id, key_version, trust_state, last_bootstrap_at)
        VALUES (?, ?, 'untrusted', NULL)
        ON CONFLICT(device_id) DO UPDATE SET
          key_version = excluded.key_version,
          trust_state = excluded.trust_state,
          last_bootstrap_at = excluded.last_bootstrap_at
      `,
    ).run(deviceId, keyVersion);
  } catch (error) {
    console.warn(
      `[Connect] Failed to persist non-ready device sync config: ${errorMessage(error)}`,
    );
  }
}

function localSyncCycleResult(
  status: string,
  lockVersion: number,
  cursor: number,
  bootstrapSnapshotId: string | null = null,
  bootstrapSnapshotSeq: number | null = null,
  counts: { pushedCount?: number; pulledCount?: number; deadLetterCount?: number } = {},
): Record<string, unknown> {
  return {
    status,
    lockVersion,
    pushedCount: counts.pushedCount ?? 0,
    pulledCount: counts.pulledCount ?? 0,
    cursor,
    needsBootstrap: status === "stale_cursor",
    bootstrapSnapshotId,
    bootstrapSnapshotSeq,
    deadLetterCount: counts.deadLetterCount ?? 0,
  };
}

async function localPushPendingSyncOutbox(
  db: Database,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  accessToken: string,
  identity: ReturnType<typeof parseSyncIdentity> & { deviceId: string },
  localCursor: number,
): Promise<{
  pushedCount: number;
  serverCursor: number;
  deadLetterCount: number;
  status?: "ok" | "key_version_mismatch";
}> {
  const pending = localPendingSyncOutboxRows(db, 500);
  if (pending.length === 0) {
    return { pushedCount: 0, serverCursor: localCursor, deadLetterCount: 0 };
  }
  const crypto = createSyncCryptoService();
  const events: Array<Record<string, unknown>> = [];
  const eventIds: string[] = [];
  const staleKeyVersionEventIds: string[] = [];
  const futureKeyVersionEventIds: string[] = [];
  const invalidEntityIds: string[] = [];
  let maxRetryCount = 0;
  const currentKeyVersion = Math.max(identity.keyVersion ?? 1, 1);
  for (const row of pending) {
    if (!localRemoteEntityIdIsValid(row.entity_id)) {
      invalidEntityIds.push(row.event_id);
      continue;
    }
    maxRetryCount = Math.max(maxRetryCount, row.retry_count);
    const payloadKeyVersion = Math.max(row.payload_key_version, 1);
    if (payloadKeyVersion < currentKeyVersion) {
      staleKeyVersionEventIds.push(row.event_id);
    } else if (payloadKeyVersion > currentKeyVersion) {
      futureKeyVersionEventIds.push(row.event_id);
    }
    if (!identity.rootKey) {
      throw new ConnectServiceError(
        "internal_error",
        "Push payload encryption failed: No root key configured",
        500,
      );
    }
    const dek = (await crypto.deriveDek(identity.rootKey, payloadKeyVersion)).value;
    const encryptedPayload = (await crypto.encrypt(dek, row.payload)).value;
    events.push({
      event_id: row.event_id,
      device_id: identity.deviceId,
      type: `${row.entity}.${row.op}.v1`,
      entity: row.entity,
      entity_id: row.entity_id,
      client_timestamp: row.client_timestamp,
      payload: encryptedPayload,
      payload_key_version: payloadKeyVersion,
    });
    eventIds.push(row.event_id);
  }
  if (invalidEntityIds.length > 0) {
    localMarkSyncOutboxDead(
      db,
      invalidEntityIds,
      "Remote sync requires UUID entity_id",
      "invalid_entity_id",
    );
  }
  if (events.length === 0) {
    return { pushedCount: 0, serverCursor: localCursor, deadLetterCount: 0 };
  }
  let response: { sentEventIds: string[]; serverCursor: number };
  try {
    response = await localPushSyncEvents(env, fetchImpl, accessToken, identity.deviceId, events);
  } catch (error) {
    if (error instanceof LocalPushSyncFailureError) {
      const handled = localApplyPushFailureToOutbox(
        db,
        eventIds,
        staleKeyVersionEventIds,
        futureKeyVersionEventIds,
        error,
        maxRetryCount,
      );
      if (handled) {
        return { pushedCount: 0, serverCursor: localCursor, ...handled };
      }
    }
    throw error;
  }
  localMarkSyncOutboxSent(db, response.sentEventIds);
  localMarkPushCompleted(db);
  return {
    pushedCount: response.sentEventIds.length,
    serverCursor: response.serverCursor,
    deadLetterCount: 0,
  };
}

function localPendingSyncOutboxRows(db: Database, limit: number): LocalSyncOutboxRow[] {
  const now = new Date().toISOString();
  return db
    .query<LocalSyncOutboxRow, [string, number]>(
      `
        SELECT
          event_id, entity, entity_id, op, client_timestamp, payload,
          payload_key_version, retry_count
        FROM sync_outbox
        WHERE status = 'pending'
          AND sent = 0
          AND (next_retry_at IS NULL OR next_retry_at <= ?)
        ORDER BY created_at ASC
        LIMIT ?
      `,
    )
    .all(now, limit);
}

async function localPushSyncEvents(
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  accessToken: string,
  deviceId: string,
  events: Array<Record<string, unknown>>,
): Promise<{ sentEventIds: string[]; serverCursor: number }> {
  let response: Response;
  try {
    response = await fetchImpl(
      `${normalizeConnectApiUrl(env.CONNECT_API_URL)}/api/v1/sync/events/push`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          "x-wf-client-request-id": deviceSyncClientRequestId(deviceId),
          "x-wf-device-id": deviceId,
        },
        body: JSON.stringify({ events }),
      },
    );
  } catch (error) {
    throw new LocalPushSyncFailureError(`Push failed: ${errorMessage(error)}`, 0, null);
  }
  let bodyText: string;
  try {
    bodyText = await response.text();
  } catch (error) {
    throw new LocalPushSyncFailureError(`Push failed: ${errorMessage(error)}`, 0, null);
  }
  if (!response.ok) {
    const parsedError = parseDeviceSyncApiError(bodyText);
    throw new LocalPushSyncFailureError(
      `Push failed: ${connectDeviceSyncApiErrorMessage(response.status, bodyText)}`,
      response.status,
      parsedError?.code ?? null,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch (error) {
    throw new ConnectServiceError(
      "internal_error",
      `Failed to parse push response: ${errorMessage(error)}`,
      500,
    );
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.accepted) || !Array.isArray(parsed.duplicate)) {
    throw new ConnectServiceError("internal_error", "Failed to parse push response", 500);
  }
  const serverCursor = requiredSafeI64FromRawJson(
    bodyText,
    ["server_cursor", "serverCursor"],
    "push response",
  );
  const sentEventIds = [...parsed.accepted, ...parsed.duplicate]
    .map((item) => (isRecord(item) ? optionalString(item.event_id ?? item.eventId) : null))
    .filter((eventId): eventId is string => eventId !== null);
  return { sentEventIds, serverCursor };
}

function localMarkSyncOutboxSent(db: Database, eventIds: string[]): void {
  if (eventIds.length === 0) {
    return;
  }
  const placeholders = eventIds.map(() => "?").join(", ");
  db.prepare(
    `
      UPDATE sync_outbox
      SET sent = 1,
          status = 'sent',
          last_error = NULL,
          last_error_code = NULL
      WHERE event_id IN (${placeholders})
    `,
  ).run(...eventIds);
}

function localMarkSyncOutboxDead(
  db: Database,
  eventIds: string[],
  lastError: string,
  lastErrorCode: string,
): void {
  if (eventIds.length === 0) {
    return;
  }
  const placeholders = eventIds.map(() => "?").join(", ");
  db.prepare(
    `
      UPDATE sync_outbox
      SET status = 'dead',
          last_error = ?,
          last_error_code = ?
      WHERE event_id IN (${placeholders})
    `,
  ).run(lastError, lastErrorCode, ...eventIds);
}

function localPruneSyncOutbox(db: Database, nowMs = Date.now()): number {
  if (!sqliteTableExists(db, "sync_outbox")) {
    return 0;
  }
  const sentCutoff = new Date(nowMs - DEVICE_SYNC_SENT_OUTBOX_RETENTION_MS).toISOString();
  const deadCutoff = new Date(nowMs - DEVICE_SYNC_DEAD_OUTBOX_RETENTION_MS).toISOString();
  const sentDeleted = db
    .prepare(
      `
        DELETE FROM sync_outbox
        WHERE status = 'sent'
          AND created_at < ?
      `,
    )
    .run(sentCutoff).changes;
  const deadDeleted = db
    .prepare(
      `
        DELETE FROM sync_outbox
        WHERE status = 'dead'
          AND created_at < ?
      `,
    )
    .run(deadCutoff).changes;
  return sentDeleted + deadDeleted;
}

function localPruneAppliedEventsUpToSeq(db: Database, seqCutoff: number): number {
  if (!sqliteTableExists(db, "sync_applied_events")) {
    return 0;
  }
  return db
    .prepare(
      `
        DELETE FROM sync_applied_events
        WHERE seq <= ?
      `,
    )
    .run(seqCutoff).changes;
}

function localPruneAppliedEventsAfterSuccessfulCycle(db: Database, cursor: number): void {
  if (cursor <= 20_000) {
    return;
  }
  try {
    localPruneAppliedEventsUpToSeq(db, cursor - 10_000);
  } catch (error) {
    console.warn(`[Connect] Failed to prune applied sync events: ${errorMessage(error)}`);
  }
}

function localApplyPushFailureToOutbox(
  db: Database,
  eventIds: string[],
  staleKeyVersionEventIds: string[],
  futureKeyVersionEventIds: string[],
  error: LocalPushSyncFailureError,
  maxRetryCount: number,
): { status: "ok" | "key_version_mismatch"; deadLetterCount: number } | null {
  if (eventIds.length === 0) {
    return null;
  }
  if (localPushErrorIsKeyVersionMismatch(error)) {
    if (staleKeyVersionEventIds.length > 0 && futureKeyVersionEventIds.length === 0) {
      localMarkSyncOutboxDead(db, staleKeyVersionEventIds, error.message, "key_version_mismatch");
      return { status: "ok", deadLetterCount: staleKeyVersionEventIds.length };
    }
    localMarkSyncOutboxDead(db, eventIds, error.message, "key_version_mismatch");
    return { status: "key_version_mismatch", deadLetterCount: eventIds.length };
  }
  if (error.status === 401 || error.status === 403) {
    localScheduleSyncOutboxRetry(db, eventIds, 30, error.message, "reauth_required");
    return null;
  }
  if (localPushErrorIsRetryable(error.status)) {
    localScheduleSyncOutboxRetry(
      db,
      eventIds,
      localBackoffSeconds(maxRetryCount),
      error.message,
      "retryable",
    );
    return null;
  }
  localMarkSyncOutboxDead(db, eventIds, error.message, "permanent");
  return null;
}

function localPushErrorIsKeyVersionMismatch(error: LocalPushSyncFailureError): boolean {
  return (
    error.errorCode?.includes("KEY_VERSION_MISMATCH") === true ||
    error.message.includes("KEY_VERSION_MISMATCH")
  );
}

function localPushErrorIsRetryable(status: number): boolean {
  return (
    status === 0 ||
    status === 408 ||
    status === 409 ||
    status === 423 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
}

function localScheduleSyncOutboxRetry(
  db: Database,
  eventIds: string[],
  delaySeconds: number,
  lastError: string,
  lastErrorCode: string,
): void {
  if (eventIds.length === 0) {
    return;
  }
  const retryAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
  const placeholders = eventIds.map(() => "?").join(", ");
  db.prepare(
    `
      UPDATE sync_outbox
      SET retry_count = retry_count + 1,
          next_retry_at = ?,
          last_error = ?,
          last_error_code = ?
      WHERE event_id IN (${placeholders})
    `,
  ).run(retryAt, lastError, lastErrorCode, ...eventIds);
}

function localBackoffSeconds(retryCount: number): number {
  const capped = Math.max(0, Math.min(Math.trunc(retryCount), 8));
  return 2 ** capped * 5;
}

function localMarkPushCompleted(db: Database): void {
  const now = new Date().toISOString();
  db.prepare(
    `
      INSERT INTO sync_engine_state (
        id, last_push_at, last_error, consecutive_failures, next_retry_at
      )
      VALUES (1, ?, NULL, 0, NULL)
      ON CONFLICT(id) DO UPDATE SET
        last_push_at = excluded.last_push_at,
        last_error = NULL,
        consecutive_failures = 0,
        next_retry_at = NULL
    `,
  ).run(now);
}

function localRemoteEntityIdIsValid(entityId: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entityId);
}

async function localPullRemoteSyncEvents(
  db: Database,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  accessToken: string,
  identity: ReturnType<typeof parseSyncIdentity> & { deviceId: string },
  localCursor: number,
): Promise<{ pulledCount: number; cursor: number }> {
  let cursor = localCursor;
  let pulledCount = 0;
  for (;;) {
    const response = await localPullSyncEvents(
      env,
      fetchImpl,
      accessToken,
      identity.deviceId,
      cursor,
      500,
    );
    if (response.gcWatermark !== null && cursor < response.gcWatermark) {
      throw new LocalPullStaleCursorError(
        `Cursor ${cursor} is older than pull GC watermark ${response.gcWatermark}`,
      );
    }
    pulledCount += await localApplyReplayEventsPage(db, response.events, identity);
    if (response.nextCursor < cursor || (response.hasMore && response.nextCursor <= cursor)) {
      throw new ConnectServiceError(
        "internal_error",
        `Server returned non-monotonic cursor (${response.nextCursor} <= ${cursor})`,
        500,
      );
    }
    cursor = response.nextCursor;
    localSetSyncCursor(db, cursor);
    if (!response.hasMore) {
      break;
    }
  }
  localMarkPullCompleted(db);
  return { pulledCount, cursor };
}

async function localPullSyncEvents(
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  accessToken: string,
  deviceId: string,
  since: number,
  limit: number,
): Promise<{
  nextCursor: number;
  hasMore: boolean;
  events: Array<Record<string, unknown>>;
  gcWatermark: number | null;
}> {
  const url = `${normalizeConnectApiUrl(env.CONNECT_API_URL)}/api/v1/sync/events/pull?since=${since}&limit=${limit}`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "x-wf-client-request-id": deviceSyncClientRequestId(deviceId),
        "x-wf-device-id": deviceId,
      },
    });
  } catch (error) {
    throw new ConnectServiceError("internal_error", errorMessage(error), 500);
  }
  let bodyText: string;
  try {
    bodyText = await response.text();
  } catch (error) {
    throw new ConnectServiceError("internal_error", errorMessage(error), 500);
  }
  if (!response.ok) {
    const parsedError = parseDeviceSyncApiError(bodyText);
    if (parsedError?.code && STALE_PULL_ERROR_CODES.has(parsedError.code)) {
      const hints = localBootstrapHintsFromErrorDetails(parsedError.details);
      throw new LocalPullStaleCursorError(
        connectDeviceSyncApiErrorMessage(response.status, bodyText),
        hints.snapshotId,
        hints.snapshotSeq,
      );
    }
    throw new ConnectServiceError(
      "internal_error",
      connectDeviceSyncApiErrorMessage(response.status, bodyText),
      500,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch (error) {
    throw new ConnectServiceError(
      "internal_error",
      `Failed to parse pull response: ${errorMessage(error)}`,
      500,
    );
  }
  if (
    !isRecord(parsed) ||
    !Array.isArray(parsed.events) ||
    parsed.events.some((event) => !isRecord(event)) ||
    !validLocalPullEventShapes(parsed.events as Array<Record<string, unknown>>, bodyText)
  ) {
    throw new ConnectServiceError("internal_error", "Failed to parse pull response", 500);
  }
  const hasMore = optionalBoolean(parsed.has_more ?? parsed.hasMore);
  if (hasMore === null) {
    throw new ConnectServiceError("internal_error", "Failed to parse pull response", 500);
  }
  const gcWatermark = optionalSafeI64FromRawJson(
    bodyText,
    ["gc_watermark", "gcWatermark"],
    "pull response",
  );
  return {
    nextCursor: requiredSafeI64FromRawJson(
      bodyText,
      ["next_cursor", "nextCursor"],
      "pull response",
    ),
    hasMore,
    events: parsed.events as Array<Record<string, unknown>>,
    gcWatermark,
  };
}

function validLocalPullEventShapes(
  events: Array<Record<string, unknown>>,
  responseText: string,
): boolean {
  const eventTokens = rawTokensForAliases(responseText, ["events"])[0];
  const rawEventTokens = eventTokens ? topLevelArrayValueTokens(eventTokens) : [];
  return events.every((event, index) => {
    const rawEvent = rawEventTokens[index];
    return rawEvent !== undefined && validLocalPullEventShape(event, rawEvent);
  });
}

function validLocalPullEventShape(event: Record<string, unknown>, rawEvent: string): boolean {
  for (const aliases of [
    ["event_id", "eventId"],
    ["device_id", "deviceId"],
    ["type"],
    ["entity"],
    ["entity_id", "entityId"],
    ["client_timestamp", "clientTimestamp"],
    ["payload"],
    ["user_id", "userId"],
    ["team_id", "teamId"],
    ["server_timestamp", "serverTimestamp"],
  ]) {
    if (
      rawTokensForAliases(rawEvent, aliases).length !== 1 ||
      optionalString(event[aliases[0]!] ?? event[aliases[1] ?? aliases[0]!]) === null
    ) {
      return false;
    }
  }
  return (
    rawTokensForAliases(rawEvent, ["payload_key_version", "payloadKeyVersion"]).length === 1 &&
    rawTokensForAliases(rawEvent, ["seq"]).length === 1 &&
    rawJsonI32TokenIsValid(
      rawTokensForAliases(rawEvent, ["payload_key_version", "payloadKeyVersion"])[0] ?? "",
    ) &&
    rawJsonSafeI64TokenIsValid(rawTokensForAliases(rawEvent, ["seq"])[0] ?? "")
  );
}

function localRemoteEventIsIgnorable(event: Record<string, unknown>, deviceId: string): boolean {
  const remoteDeviceId = optionalString(event.device_id ?? event.deviceId);
  const entity = optionalString(event.entity);
  const eventType = optionalString(event.type);
  if (remoteDeviceId === deviceId) {
    return (
      entity !== "ai_thread_tag" ||
      !/^ai_thread_tag\.(create|update|delete)\.v1$/.test(eventType ?? "")
    );
  }
  return (
    entity === "snapshot" &&
    (eventType === null || !/\.(create|update|delete)\.v1$/.test(eventType))
  );
}

function localCanReplayAccountEvent(event: Record<string, unknown>): boolean {
  const entity = optionalString(event.entity);
  const eventType = optionalString(event.type);
  return (
    entity === "account" &&
    eventType !== null &&
    /^account\.(create|update|delete)\.v1$/.test(eventType)
  );
}

function localCanReplayPlatformEvent(event: Record<string, unknown>): boolean {
  const entity = optionalString(event.entity);
  const eventType = optionalString(event.type);
  return (
    entity === "platform" &&
    eventType !== null &&
    /^platform\.(create|update|delete)\.v1$/.test(eventType)
  );
}

function localCanReplayPortfolioEvent(event: Record<string, unknown>): boolean {
  const entity = optionalString(event.entity);
  const eventType = optionalString(event.type);
  return (
    entity === "portfolio" &&
    eventType !== null &&
    /^portfolio\.(create|update|delete)\.v1$/.test(eventType)
  );
}

function localCanReplayPortfolioAccountEvent(event: Record<string, unknown>): boolean {
  const entity = optionalString(event.entity);
  const eventType = optionalString(event.type);
  return (
    entity === "portfolio_account" &&
    eventType !== null &&
    /^portfolio_account\.(create|update|delete)\.v1$/.test(eventType)
  );
}

function localCanReplayContributionLimitEvent(event: Record<string, unknown>): boolean {
  const entity = optionalString(event.entity);
  const eventType = optionalString(event.type);
  return (
    entity === "contribution_limit" &&
    eventType !== null &&
    /^contribution_limit\.(create|update|delete)\.v1$/.test(eventType)
  );
}

function localCanReplayCustomProviderEvent(event: Record<string, unknown>): boolean {
  const entity = optionalString(event.entity);
  const eventType = optionalString(event.type);
  return (
    entity === "custom_provider" &&
    eventType !== null &&
    /^custom_provider\.(create|update|delete)\.v1$/.test(eventType)
  );
}

function localCanReplayCustomTaxonomyEvent(event: Record<string, unknown>): boolean {
  const entity = optionalString(event.entity);
  const eventType = optionalString(event.type);
  return (
    entity === "custom_taxonomy" &&
    eventType !== null &&
    /^custom_taxonomy\.(create|update|delete)\.v1$/.test(eventType)
  );
}

function localCanReplayGoalEvent(event: Record<string, unknown>): boolean {
  const entity = optionalString(event.entity);
  const eventType = optionalString(event.type);
  return (
    entity === "goal" && eventType !== null && /^goal\.(create|update|delete)\.v1$/.test(eventType)
  );
}

function localCanReplayGoalPlanEvent(event: Record<string, unknown>): boolean {
  const entity = optionalString(event.entity);
  const eventType = optionalString(event.type);
  return (
    entity === "goal_plan" &&
    eventType !== null &&
    /^goal_plan\.(create|update|delete)\.v1$/.test(eventType)
  );
}

function localCanReplayGoalsAllocationEvent(event: Record<string, unknown>): boolean {
  const entity = optionalString(event.entity);
  const eventType = optionalString(event.type);
  return (
    entity === "goals_allocation" &&
    eventType !== null &&
    /^goals_allocation\.(create|update|delete)\.v1$/.test(eventType)
  );
}

function localCanReplayImportTemplateEvent(event: Record<string, unknown>): boolean {
  const entity = optionalString(event.entity);
  const eventType = optionalString(event.type);
  return (
    entity === "import_template" &&
    eventType !== null &&
    /^import_template\.(create|update|delete)\.v1$/.test(eventType)
  );
}

function localCanReplayActivityEvent(event: Record<string, unknown>): boolean {
  const entity = optionalString(event.entity);
  const eventType = optionalString(event.type);
  return (
    entity === "activity" &&
    eventType !== null &&
    /^activity\.(create|update|delete)\.v1$/.test(eventType)
  );
}

function localCanReplayActivityImportProfileEvent(event: Record<string, unknown>): boolean {
  const entity = optionalString(event.entity);
  const eventType = optionalString(event.type);
  return (
    entity === "activity_import_profile" &&
    eventType !== null &&
    /^activity_import_profile\.(create|update|delete)\.v1$/.test(eventType)
  );
}

function localCanReplayImportRunEvent(event: Record<string, unknown>): boolean {
  const entity = optionalString(event.entity);
  const eventType = optionalString(event.type);
  return (
    entity === "import_run" &&
    eventType !== null &&
    /^import_run\.(create|update|delete)\.v1$/.test(eventType)
  );
}

function localCanReplayAiThreadEvent(event: Record<string, unknown>): boolean {
  const entity = optionalString(event.entity);
  const eventType = optionalString(event.type);
  return (
    entity === "ai_thread" &&
    eventType !== null &&
    /^ai_thread\.(create|update|delete)\.v1$/.test(eventType)
  );
}

function localCanReplayAiMessageEvent(event: Record<string, unknown>): boolean {
  const entity = optionalString(event.entity);
  const eventType = optionalString(event.type);
  return (
    entity === "ai_message" &&
    eventType !== null &&
    /^ai_message\.(create|update|delete)\.v1$/.test(eventType)
  );
}

function localCanReplayAiThreadTagEvent(event: Record<string, unknown>): boolean {
  const entity = optionalString(event.entity);
  const eventType = optionalString(event.type);
  return (
    entity === "ai_thread_tag" &&
    eventType !== null &&
    /^ai_thread_tag\.(create|update|delete)\.v1$/.test(eventType)
  );
}

function localCanReplayAssetTaxonomyAssignmentEvent(event: Record<string, unknown>): boolean {
  const entity = optionalString(event.entity);
  const eventType = optionalString(event.type);
  return (
    entity === "asset_taxonomy_assignment" &&
    eventType !== null &&
    /^asset_taxonomy_assignment\.(create|update|delete)\.v1$/.test(eventType)
  );
}

function localCanReplayQuoteEvent(event: Record<string, unknown>): boolean {
  const entity = optionalString(event.entity);
  const eventType = optionalString(event.type);
  return (
    entity === "quote" &&
    eventType !== null &&
    /^quote\.(create|update|delete)\.v1$/.test(eventType)
  );
}

function localCanReplaySnapshotEvent(event: Record<string, unknown>): boolean {
  const entity = optionalString(event.entity);
  const eventType = optionalString(event.type);
  return (
    entity === "snapshot" &&
    eventType !== null &&
    /^snapshot\.(create|update|delete)\.v1$/.test(eventType)
  );
}

function localCanReplayAssetEvent(event: Record<string, unknown>): boolean {
  const entity = optionalString(event.entity);
  const eventType = optionalString(event.type);
  return (
    entity === "asset" &&
    eventType !== null &&
    /^asset\.(create|update|delete)\.v1$/.test(eventType)
  );
}

function localReplayEntity(event: Record<string, unknown>): LocalReplayEntity | null {
  if (localCanReplayAccountEvent(event)) {
    return "account";
  }
  if (localCanReplayPlatformEvent(event)) {
    return "platform";
  }
  if (localCanReplayPortfolioEvent(event)) {
    return "portfolio";
  }
  if (localCanReplayPortfolioAccountEvent(event)) {
    return "portfolio_account";
  }
  if (localCanReplayContributionLimitEvent(event)) {
    return "contribution_limit";
  }
  if (localCanReplayCustomProviderEvent(event)) {
    return "custom_provider";
  }
  if (localCanReplayCustomTaxonomyEvent(event)) {
    return "custom_taxonomy";
  }
  if (localCanReplayGoalEvent(event)) {
    return "goal";
  }
  if (localCanReplayGoalPlanEvent(event)) {
    return "goal_plan";
  }
  if (localCanReplayGoalsAllocationEvent(event)) {
    return "goals_allocation";
  }
  if (localCanReplayImportTemplateEvent(event)) {
    return "import_template";
  }
  if (localCanReplayActivityEvent(event)) {
    return "activity";
  }
  if (localCanReplayActivityImportProfileEvent(event)) {
    return "activity_import_profile";
  }
  if (localCanReplayImportRunEvent(event)) {
    return "import_run";
  }
  if (localCanReplayAiThreadEvent(event)) {
    return "ai_thread";
  }
  if (localCanReplayAiMessageEvent(event)) {
    return "ai_message";
  }
  if (localCanReplayAiThreadTagEvent(event)) {
    return "ai_thread_tag";
  }
  if (localCanReplayAssetTaxonomyAssignmentEvent(event)) {
    return "asset_taxonomy_assignment";
  }
  if (localCanReplayQuoteEvent(event)) {
    return "quote";
  }
  if (localCanReplaySnapshotEvent(event)) {
    return "snapshot";
  }
  if (localCanReplayAssetEvent(event)) {
    return "asset";
  }
  return null;
}

async function localApplyReplayEventsPage(
  db: Database,
  events: Array<Record<string, unknown>>,
  identity: ReturnType<typeof parseSyncIdentity> & { deviceId: string },
): Promise<number> {
  const replayEvents: Array<{
    event: Record<string, unknown>;
    replayEntity: LocalReplayEntity;
  }> = [];
  for (const event of events) {
    if (localRemoteEventIsIgnorable(event, identity.deviceId)) {
      continue;
    }
    const replayEntity = localReplayEntity(event);
    if (replayEntity === null) {
      throw deviceSyncDisabled();
    }
    replayEvents.push({ event, replayEntity });
  }
  if (replayEvents.length === 0) {
    return 0;
  }

  try {
    return await localApplyReplayEventsBatch(db, replayEvents, identity);
  } catch (error) {
    return await localApplyReplayEventsIndividually(db, replayEvents, identity);
  }
}

async function localApplyReplayEventsIndividually(
  db: Database,
  replayEvents: Array<{
    event: Record<string, unknown>;
    replayEntity: LocalReplayEntity;
  }>,
  identity: ReturnType<typeof parseSyncIdentity> & { deviceId: string },
): Promise<number> {
  let applied = 0;
  let pending = replayEvents;
  const lastErrors = new Map<string, string>();
  for (let pass = 0; pass < replayEvents.length; pass += 1) {
    const failed: typeof pending = [];
    let completedThisPass = 0;
    for (const replayEvent of pending) {
      try {
        if (await localApplyReplayEvent(db, replayEvent, identity)) {
          applied += 1;
        }
        completedThisPass += 1;
      } catch (eventError) {
        if (eventError instanceof LocalReplayApplyError) {
          const eventId = requiredLocalPullEventString(replayEvent.event, "event_id", "eventId");
          lastErrors.set(eventId, eventError.message);
          failed.push(replayEvent);
          continue;
        }
        throw eventError;
      }
    }
    if (failed.length === 0) {
      return applied;
    }
    if (completedThisPass === 0) {
      localThrowIfTransientReplayDependencyFailure(failed, lastErrors);
      localWarnDeadLetteredReplayEvents(failed, lastErrors);
      return applied;
    }
    pending = failed;
  }
  localThrowIfTransientReplayDependencyFailure(pending, lastErrors);
  localWarnDeadLetteredReplayEvents(pending, lastErrors);
  return applied;
}

function localThrowIfTransientReplayDependencyFailure(
  replayEvents: Array<{
    event: Record<string, unknown>;
    replayEntity: LocalReplayEntity;
  }>,
  lastErrors: Map<string, string>,
): void {
  for (const replayEvent of replayEvents) {
    const eventId = requiredLocalPullEventString(replayEvent.event, "event_id", "eventId");
    const message = lastErrors.get(eventId);
    if (message && localReplayApplyErrorIsTransientDependency(message)) {
      throw new LocalReplayApplyError(message);
    }
  }
}

function localReplayApplyErrorIsTransientDependency(message: string): boolean {
  return /foreign key/i.test(message);
}

function localWarnDeadLetteredReplayEvents(
  replayEvents: Array<{
    event: Record<string, unknown>;
    replayEntity: LocalReplayEntity;
  }>,
  lastErrors: Map<string, string>,
): void {
  for (const replayEvent of replayEvents) {
    const eventId = requiredLocalPullEventString(replayEvent.event, "event_id", "eventId");
    console.warn(
      `[Connect] Dead-lettering replay event due to apply error: ${
        lastErrors.get(eventId) ?? "unknown replay apply error"
      }`,
    );
  }
}

async function localApplyReplayEventsBatch(
  db: Database,
  replayEvents: Array<{
    event: Record<string, unknown>;
    replayEntity: LocalReplayEntity;
  }>,
  identity: ReturnType<typeof parseSyncIdentity> & { deviceId: string },
): Promise<number> {
  const payloads = new Map<string, Record<string, unknown>>();
  for (const { event } of replayEvents) {
    payloads.set(
      requiredLocalPullEventString(event, "event_id", "eventId"),
      await localDecryptReplayPayload(event, identity),
    );
  }
  const applyTransaction = db.transaction(() => {
    db.prepare("PRAGMA defer_foreign_keys = ON").run();
    let applied = 0;
    for (const replayEvent of replayEvents) {
      if (localApplyReplayEventPrepared(db, replayEvent, payloads)) {
        applied += 1;
      }
    }
    return applied;
  });
  try {
    return applyTransaction();
  } catch (error) {
    throw new LocalReplayApplyError(errorMessage(error));
  }
}

async function localApplyReplayEvent(
  db: Database,
  replayEvent: {
    event: Record<string, unknown>;
    replayEntity: LocalReplayEntity;
  },
  identity: ReturnType<typeof parseSyncIdentity> & { deviceId: string },
): Promise<boolean> {
  const eventId = requiredLocalPullEventString(replayEvent.event, "event_id", "eventId");
  const payloads = new Map<string, Record<string, unknown>>();
  payloads.set(eventId, await localDecryptReplayPayload(replayEvent.event, identity));
  const applyTransaction = db.transaction(() => {
    db.prepare("PRAGMA defer_foreign_keys = ON").run();
    return localApplyReplayEventPrepared(db, replayEvent, payloads);
  });
  try {
    return applyTransaction();
  } catch (error) {
    throw new LocalReplayApplyError(errorMessage(error));
  }
}

function localApplyReplayEventPrepared(
  db: Database,
  replayEvent: {
    event: Record<string, unknown>;
    replayEntity: LocalReplayEntity;
  },
  payloads: Map<string, Record<string, unknown>>,
): boolean {
  switch (replayEvent.replayEntity) {
    case "account":
      return localApplyAccountReplayEvent(db, replayEvent.event, payloads);
    case "platform":
      return localApplyPlatformReplayEvent(db, replayEvent.event, payloads);
    case "portfolio":
      return localApplyPortfolioReplayEvent(db, replayEvent.event, payloads);
    case "portfolio_account":
      return localApplyPortfolioAccountReplayEvent(db, replayEvent.event, payloads);
    case "contribution_limit":
      return localApplyContributionLimitReplayEvent(db, replayEvent.event, payloads);
    case "custom_provider":
      return localApplyCustomProviderReplayEvent(db, replayEvent.event, payloads);
    case "custom_taxonomy":
      return localApplyCustomTaxonomyReplayEvent(db, replayEvent.event, payloads);
    case "goal":
      return localApplyGoalReplayEvent(db, replayEvent.event, payloads);
    case "goal_plan":
      return localApplyGoalPlanReplayEvent(db, replayEvent.event, payloads);
    case "goals_allocation":
      return localApplyGoalsAllocationReplayEvent(db, replayEvent.event, payloads);
    case "import_template":
      return localApplyImportTemplateReplayEvent(db, replayEvent.event, payloads);
    case "activity":
      return localApplyActivityReplayEvent(db, replayEvent.event, payloads);
    case "activity_import_profile":
      return localApplyActivityImportProfileReplayEvent(db, replayEvent.event, payloads);
    case "import_run":
      return localApplyImportRunReplayEvent(db, replayEvent.event, payloads);
    case "ai_thread":
      return localApplyAiThreadReplayEvent(db, replayEvent.event, payloads);
    case "ai_message":
      return localApplyAiMessageReplayEvent(db, replayEvent.event, payloads);
    case "ai_thread_tag":
      return localApplyAiThreadTagReplayEvent(db, replayEvent.event, payloads);
    case "asset_taxonomy_assignment":
      return localApplyAssetTaxonomyAssignmentReplayEvent(db, replayEvent.event, payloads);
    case "quote":
      return localApplyQuoteReplayEvent(db, replayEvent.event, payloads);
    case "snapshot":
      return localApplySnapshotReplayEvent(db, replayEvent.event, payloads);
    case "asset":
      return localApplyAssetReplayEvent(db, replayEvent.event, payloads);
  }
}

function localApplyAccountReplayEvent(
  db: Database,
  event: Record<string, unknown>,
  payloads: Map<string, Record<string, unknown>>,
): boolean {
  const eventId = requiredLocalPullEventString(event, "event_id", "eventId");
  const entityId = requiredLocalPullEventString(event, "entity_id", "entityId");
  const eventType = requiredLocalPullEventString(event, "type");
  const operation = localSyncOperationFromEventType(eventType);
  const clientTimestamp = requiredLocalPullEventString(
    event,
    "client_timestamp",
    "clientTimestamp",
  );
  const seq = requiredInteger(event.seq, "pull event");
  const payload = payloads.get(eventId);
  if (!payload) {
    throw new ConnectServiceError("internal_error", "Replay payload missing", 500);
  }
  if (
    db
      .query<
        { count: number },
        [string]
      >("SELECT COUNT(*) AS count FROM sync_applied_events WHERE event_id = ?")
      .get(eventId)?.count
  ) {
    return false;
  }
  const metadata = db
    .query<
      { last_event_id: string; last_client_timestamp: string; last_op: string | null },
      [string]
    >(
      `
        SELECT last_event_id, last_client_timestamp, last_op
        FROM sync_entity_metadata
        WHERE entity = 'account' AND entity_id = ?
      `,
    )
    .get(entityId);
  const previousOperation = metadata?.last_op ?? "update";
  const shouldApply =
    metadata === null || metadata === undefined
      ? true
      : operation === "delete" && previousOperation !== "delete"
        ? true
        : previousOperation === "delete" && (operation === "create" || operation === "update")
          ? false
          : localShouldApplyLww(
              metadata.last_client_timestamp,
              metadata.last_event_id,
              clientTimestamp,
              eventId,
            );
  if (shouldApply) {
    if (operation === "delete") {
      db.prepare("DELETE FROM accounts WHERE id = ?").run(entityId);
    } else {
      localUpsertAccountReplayPayload(db, entityId, payload, clientTimestamp);
    }
    localUpsertSyncEntityMetadata(
      db,
      "account",
      entityId,
      eventId,
      clientTimestamp,
      operation,
      seq,
    );
    localMarkReplayTableState(db, "accounts");
    localInsertSyncAppliedEvent(db, eventId, seq, "account", entityId);
  } else {
    localInsertSyncAppliedEvent(db, eventId, seq, "account", entityId);
  }
  return shouldApply;
}

function localApplyPlatformReplayEvent(
  db: Database,
  event: Record<string, unknown>,
  payloads: Map<string, Record<string, unknown>>,
): boolean {
  const eventId = requiredLocalPullEventString(event, "event_id", "eventId");
  const entityId = requiredLocalPullEventString(event, "entity_id", "entityId");
  const eventType = requiredLocalPullEventString(event, "type");
  const operation = localPlatformSyncOperationFromEventType(eventType);
  const clientTimestamp = requiredLocalPullEventString(
    event,
    "client_timestamp",
    "clientTimestamp",
  );
  const seq = requiredInteger(event.seq, "pull event");
  const payload = payloads.get(eventId);
  if (!payload) {
    throw new ConnectServiceError("internal_error", "Replay payload missing", 500);
  }
  if (
    db
      .query<
        { count: number },
        [string]
      >("SELECT COUNT(*) AS count FROM sync_applied_events WHERE event_id = ?")
      .get(eventId)?.count
  ) {
    return false;
  }
  const metadata = db
    .query<
      { last_event_id: string; last_client_timestamp: string; last_op: string | null },
      [string]
    >(
      `
        SELECT last_event_id, last_client_timestamp, last_op
        FROM sync_entity_metadata
        WHERE entity = 'platform' AND entity_id = ?
      `,
    )
    .get(entityId);
  const previousOperation = metadata?.last_op ?? "update";
  const shouldApply =
    metadata === null || metadata === undefined
      ? true
      : operation === "delete" && previousOperation !== "delete"
        ? true
        : previousOperation === "delete" && (operation === "create" || operation === "update")
          ? false
          : localShouldApplyLww(
              metadata.last_client_timestamp,
              metadata.last_event_id,
              clientTimestamp,
              eventId,
            );
  if (shouldApply) {
    if (operation === "delete") {
      db.prepare("DELETE FROM platforms WHERE id = ?").run(entityId);
    } else {
      localUpsertPlatformReplayPayload(db, entityId, payload);
    }
    localUpsertSyncEntityMetadata(
      db,
      "platform",
      entityId,
      eventId,
      clientTimestamp,
      operation,
      seq,
    );
    localMarkReplayTableState(db, "platforms");
    localInsertSyncAppliedEvent(db, eventId, seq, "platform", entityId);
  } else {
    localInsertSyncAppliedEvent(db, eventId, seq, "platform", entityId);
  }
  return shouldApply;
}

function localApplyPortfolioReplayEvent(
  db: Database,
  event: Record<string, unknown>,
  payloads: Map<string, Record<string, unknown>>,
): boolean {
  const eventId = requiredLocalPullEventString(event, "event_id", "eventId");
  const entityId = requiredLocalPullEventString(event, "entity_id", "entityId");
  const eventType = requiredLocalPullEventString(event, "type");
  const operation = localPortfolioSyncOperationFromEventType(eventType);
  const clientTimestamp = requiredLocalPullEventString(
    event,
    "client_timestamp",
    "clientTimestamp",
  );
  const seq = requiredInteger(event.seq, "pull event");
  const payload = payloads.get(eventId);
  if (!payload) {
    throw new ConnectServiceError("internal_error", "Replay payload missing", 500);
  }
  if (
    db
      .query<
        { count: number },
        [string]
      >("SELECT COUNT(*) AS count FROM sync_applied_events WHERE event_id = ?")
      .get(eventId)?.count
  ) {
    return false;
  }
  const metadata = db
    .query<
      { last_event_id: string; last_client_timestamp: string; last_op: string | null },
      [string]
    >(
      `
        SELECT last_event_id, last_client_timestamp, last_op
        FROM sync_entity_metadata
        WHERE entity = 'portfolio' AND entity_id = ?
      `,
    )
    .get(entityId);
  const previousOperation = metadata?.last_op ?? "update";
  const shouldApply =
    metadata === null || metadata === undefined
      ? true
      : operation === "delete" && previousOperation !== "delete"
        ? true
        : previousOperation === "delete" && (operation === "create" || operation === "update")
          ? false
          : localShouldApplyLww(
              metadata.last_client_timestamp,
              metadata.last_event_id,
              clientTimestamp,
              eventId,
            );
  if (shouldApply) {
    if (operation === "delete") {
      db.prepare("DELETE FROM portfolios WHERE id = ?").run(entityId);
    } else {
      localUpsertPortfolioReplayPayload(db, entityId, payload, clientTimestamp);
    }
    localUpsertSyncEntityMetadata(
      db,
      "portfolio",
      entityId,
      eventId,
      clientTimestamp,
      operation,
      seq,
    );
    localMarkReplayTableState(db, "portfolios");
    localInsertSyncAppliedEvent(db, eventId, seq, "portfolio", entityId);
  } else {
    localInsertSyncAppliedEvent(db, eventId, seq, "portfolio", entityId);
  }
  return shouldApply;
}

function localApplyPortfolioAccountReplayEvent(
  db: Database,
  event: Record<string, unknown>,
  payloads: Map<string, Record<string, unknown>>,
): boolean {
  const eventId = requiredLocalPullEventString(event, "event_id", "eventId");
  const entityId = requiredLocalPullEventString(event, "entity_id", "entityId");
  const eventType = requiredLocalPullEventString(event, "type");
  const operation = localPortfolioAccountSyncOperationFromEventType(eventType);
  const clientTimestamp = requiredLocalPullEventString(
    event,
    "client_timestamp",
    "clientTimestamp",
  );
  const seq = requiredInteger(event.seq, "pull event");
  const payload = payloads.get(eventId);
  if (!payload) {
    throw new ConnectServiceError("internal_error", "Replay payload missing", 500);
  }
  if (
    db
      .query<
        { count: number },
        [string]
      >("SELECT COUNT(*) AS count FROM sync_applied_events WHERE event_id = ?")
      .get(eventId)?.count
  ) {
    return false;
  }
  const metadata = db
    .query<
      { last_event_id: string; last_client_timestamp: string; last_op: string | null },
      [string]
    >(
      `
        SELECT last_event_id, last_client_timestamp, last_op
        FROM sync_entity_metadata
        WHERE entity = 'portfolio_account' AND entity_id = ?
      `,
    )
    .get(entityId);
  const previousOperation = metadata?.last_op ?? "update";
  const shouldApply =
    metadata === null || metadata === undefined
      ? true
      : operation === "delete" && previousOperation !== "delete"
        ? true
        : previousOperation === "delete" && (operation === "create" || operation === "update")
          ? false
          : localShouldApplyLww(
              metadata.last_client_timestamp,
              metadata.last_event_id,
              clientTimestamp,
              eventId,
            );
  if (shouldApply) {
    if (operation === "delete") {
      db.prepare("DELETE FROM portfolio_accounts WHERE id = ?").run(entityId);
    } else {
      localUpsertPortfolioAccountReplayPayload(db, entityId, payload, clientTimestamp);
    }
    localUpsertSyncEntityMetadata(
      db,
      "portfolio_account",
      entityId,
      eventId,
      clientTimestamp,
      operation,
      seq,
    );
    localMarkReplayTableState(db, "portfolio_accounts");
    localInsertSyncAppliedEvent(db, eventId, seq, "portfolio_account", entityId);
  } else {
    localInsertSyncAppliedEvent(db, eventId, seq, "portfolio_account", entityId);
  }
  return shouldApply;
}

function localApplyContributionLimitReplayEvent(
  db: Database,
  event: Record<string, unknown>,
  payloads: Map<string, Record<string, unknown>>,
): boolean {
  const eventId = requiredLocalPullEventString(event, "event_id", "eventId");
  const entityId = requiredLocalPullEventString(event, "entity_id", "entityId");
  const eventType = requiredLocalPullEventString(event, "type");
  const operation = localContributionLimitSyncOperationFromEventType(eventType);
  const clientTimestamp = requiredLocalPullEventString(
    event,
    "client_timestamp",
    "clientTimestamp",
  );
  const seq = requiredInteger(event.seq, "pull event");
  const payload = payloads.get(eventId);
  if (!payload) {
    throw new ConnectServiceError("internal_error", "Replay payload missing", 500);
  }
  if (
    db
      .query<
        { count: number },
        [string]
      >("SELECT COUNT(*) AS count FROM sync_applied_events WHERE event_id = ?")
      .get(eventId)?.count
  ) {
    return false;
  }
  const metadata = db
    .query<
      { last_event_id: string; last_client_timestamp: string; last_op: string | null },
      [string]
    >(
      `
        SELECT last_event_id, last_client_timestamp, last_op
        FROM sync_entity_metadata
        WHERE entity = 'contribution_limit' AND entity_id = ?
      `,
    )
    .get(entityId);
  const previousOperation = metadata?.last_op ?? "update";
  const shouldApply =
    metadata === null || metadata === undefined
      ? true
      : operation === "delete" && previousOperation !== "delete"
        ? true
        : previousOperation === "delete" && (operation === "create" || operation === "update")
          ? false
          : localShouldApplyLww(
              metadata.last_client_timestamp,
              metadata.last_event_id,
              clientTimestamp,
              eventId,
            );
  if (shouldApply) {
    if (operation === "delete") {
      db.prepare("DELETE FROM contribution_limits WHERE id = ?").run(entityId);
    } else {
      localUpsertContributionLimitReplayPayload(db, entityId, payload, clientTimestamp);
    }
    localUpsertSyncEntityMetadata(
      db,
      "contribution_limit",
      entityId,
      eventId,
      clientTimestamp,
      operation,
      seq,
    );
    localMarkReplayTableState(db, "contribution_limits");
    localInsertSyncAppliedEvent(db, eventId, seq, "contribution_limit", entityId);
  } else {
    localInsertSyncAppliedEvent(db, eventId, seq, "contribution_limit", entityId);
  }
  return shouldApply;
}

function localApplyCustomProviderReplayEvent(
  db: Database,
  event: Record<string, unknown>,
  payloads: Map<string, Record<string, unknown>>,
): boolean {
  const eventId = requiredLocalPullEventString(event, "event_id", "eventId");
  const entityId = requiredLocalPullEventString(event, "entity_id", "entityId");
  const eventType = requiredLocalPullEventString(event, "type");
  const operation = localCustomProviderSyncOperationFromEventType(eventType);
  const clientTimestamp = requiredLocalPullEventString(
    event,
    "client_timestamp",
    "clientTimestamp",
  );
  const seq = requiredInteger(event.seq, "pull event");
  const payload = payloads.get(eventId);
  if (!payload) {
    throw new ConnectServiceError("internal_error", "Replay payload missing", 500);
  }
  if (
    db
      .query<
        { count: number },
        [string]
      >("SELECT COUNT(*) AS count FROM sync_applied_events WHERE event_id = ?")
      .get(eventId)?.count
  ) {
    return false;
  }
  const metadata = db
    .query<
      { last_event_id: string; last_client_timestamp: string; last_op: string | null },
      [string]
    >(
      `
        SELECT last_event_id, last_client_timestamp, last_op
        FROM sync_entity_metadata
        WHERE entity = 'custom_provider' AND entity_id = ?
      `,
    )
    .get(entityId);
  const previousOperation = metadata?.last_op ?? "update";
  const shouldApply =
    metadata === null || metadata === undefined
      ? true
      : operation === "delete" && previousOperation !== "delete"
        ? true
        : previousOperation === "delete" && (operation === "create" || operation === "update")
          ? false
          : localShouldApplyLww(
              metadata.last_client_timestamp,
              metadata.last_event_id,
              clientTimestamp,
              eventId,
            );
  if (shouldApply) {
    if (operation === "delete") {
      db.prepare("DELETE FROM market_data_custom_providers WHERE id = ?").run(entityId);
    } else {
      localUpsertCustomProviderReplayPayload(db, entityId, payload, clientTimestamp);
    }
    localUpsertSyncEntityMetadata(
      db,
      "custom_provider",
      entityId,
      eventId,
      clientTimestamp,
      operation,
      seq,
    );
    localMarkReplayTableState(db, "market_data_custom_providers");
    localInsertSyncAppliedEvent(db, eventId, seq, "custom_provider", entityId);
  } else {
    localInsertSyncAppliedEvent(db, eventId, seq, "custom_provider", entityId);
  }
  return shouldApply;
}

function localApplyCustomTaxonomyReplayEvent(
  db: Database,
  event: Record<string, unknown>,
  payloads: Map<string, Record<string, unknown>>,
): boolean {
  const eventId = requiredLocalPullEventString(event, "event_id", "eventId");
  const entityId = requiredLocalPullEventString(event, "entity_id", "entityId");
  const eventType = requiredLocalPullEventString(event, "type");
  const operation = localCustomTaxonomySyncOperationFromEventType(eventType);
  const clientTimestamp = requiredLocalPullEventString(
    event,
    "client_timestamp",
    "clientTimestamp",
  );
  const seq = requiredInteger(event.seq, "pull event");
  const payload = payloads.get(eventId);
  if (!payload) {
    throw new ConnectServiceError("internal_error", "Replay payload missing", 500);
  }
  if (
    db
      .query<
        { count: number },
        [string]
      >("SELECT COUNT(*) AS count FROM sync_applied_events WHERE event_id = ?")
      .get(eventId)?.count
  ) {
    return false;
  }
  const metadata = db
    .query<
      { last_event_id: string; last_client_timestamp: string; last_op: string | null },
      [string]
    >(
      `
        SELECT last_event_id, last_client_timestamp, last_op
        FROM sync_entity_metadata
        WHERE entity = 'custom_taxonomy' AND entity_id = ?
      `,
    )
    .get(entityId);
  const previousOperation = metadata?.last_op ?? "update";
  const shouldApply =
    metadata === null || metadata === undefined
      ? true
      : operation === "delete" && previousOperation !== "delete"
        ? true
        : previousOperation === "delete" && (operation === "create" || operation === "update")
          ? false
          : localShouldApplyLww(
              metadata.last_client_timestamp,
              metadata.last_event_id,
              clientTimestamp,
              eventId,
            );
  if (shouldApply) {
    localApplyCustomTaxonomyReplayPayload(db, entityId, operation, payload);
    localUpsertSyncEntityMetadata(
      db,
      "custom_taxonomy",
      entityId,
      eventId,
      clientTimestamp,
      operation,
      seq,
    );
    localMarkReplayTableState(db, "taxonomies");
    localMarkReplayTableState(db, "taxonomy_categories");
    localInsertSyncAppliedEvent(db, eventId, seq, "custom_taxonomy", entityId);
  } else {
    localInsertSyncAppliedEvent(db, eventId, seq, "custom_taxonomy", entityId);
  }
  return shouldApply;
}

function localApplyGoalReplayEvent(
  db: Database,
  event: Record<string, unknown>,
  payloads: Map<string, Record<string, unknown>>,
): boolean {
  const eventId = requiredLocalPullEventString(event, "event_id", "eventId");
  const entityId = requiredLocalPullEventString(event, "entity_id", "entityId");
  const eventType = requiredLocalPullEventString(event, "type");
  const operation = localGoalSyncOperationFromEventType(eventType);
  const clientTimestamp = requiredLocalPullEventString(
    event,
    "client_timestamp",
    "clientTimestamp",
  );
  const seq = requiredInteger(event.seq, "pull event");
  const payload = payloads.get(eventId);
  if (!payload) {
    throw new ConnectServiceError("internal_error", "Replay payload missing", 500);
  }
  if (
    db
      .query<
        { count: number },
        [string]
      >("SELECT COUNT(*) AS count FROM sync_applied_events WHERE event_id = ?")
      .get(eventId)?.count
  ) {
    return false;
  }
  const metadata = db
    .query<
      { last_event_id: string; last_client_timestamp: string; last_op: string | null },
      [string]
    >(
      `
        SELECT last_event_id, last_client_timestamp, last_op
        FROM sync_entity_metadata
        WHERE entity = 'goal' AND entity_id = ?
      `,
    )
    .get(entityId);
  const previousOperation = metadata?.last_op ?? "update";
  const shouldApply =
    metadata === null || metadata === undefined
      ? true
      : operation === "delete" && previousOperation !== "delete"
        ? true
        : previousOperation === "delete" && (operation === "create" || operation === "update")
          ? false
          : localShouldApplyLww(
              metadata.last_client_timestamp,
              metadata.last_event_id,
              clientTimestamp,
              eventId,
            );
  if (shouldApply) {
    if (operation === "delete") {
      db.prepare("DELETE FROM goals WHERE id = ?").run(entityId);
    } else {
      localUpsertGoalReplayPayload(db, entityId, payload);
    }
    localUpsertSyncEntityMetadata(db, "goal", entityId, eventId, clientTimestamp, operation, seq);
    localMarkReplayTableState(db, "goals");
    localInsertSyncAppliedEvent(db, eventId, seq, "goal", entityId);
  } else {
    localInsertSyncAppliedEvent(db, eventId, seq, "goal", entityId);
  }
  return shouldApply;
}

function localApplyGoalPlanReplayEvent(
  db: Database,
  event: Record<string, unknown>,
  payloads: Map<string, Record<string, unknown>>,
): boolean {
  const eventId = requiredLocalPullEventString(event, "event_id", "eventId");
  const entityId = requiredLocalPullEventString(event, "entity_id", "entityId");
  const eventType = requiredLocalPullEventString(event, "type");
  const operation = localGoalPlanSyncOperationFromEventType(eventType);
  const clientTimestamp = requiredLocalPullEventString(
    event,
    "client_timestamp",
    "clientTimestamp",
  );
  const seq = requiredInteger(event.seq, "pull event");
  const payload = payloads.get(eventId);
  if (!payload) {
    throw new ConnectServiceError("internal_error", "Replay payload missing", 500);
  }
  if (
    db
      .query<
        { count: number },
        [string]
      >("SELECT COUNT(*) AS count FROM sync_applied_events WHERE event_id = ?")
      .get(eventId)?.count
  ) {
    return false;
  }
  const metadata = db
    .query<
      { last_event_id: string; last_client_timestamp: string; last_op: string | null },
      [string]
    >(
      `
        SELECT last_event_id, last_client_timestamp, last_op
        FROM sync_entity_metadata
        WHERE entity = 'goal_plan' AND entity_id = ?
      `,
    )
    .get(entityId);
  const previousOperation = metadata?.last_op ?? "update";
  const shouldApply =
    metadata === null || metadata === undefined
      ? true
      : operation === "delete" && previousOperation !== "delete"
        ? true
        : previousOperation === "delete" && (operation === "create" || operation === "update")
          ? false
          : localShouldApplyLww(
              metadata.last_client_timestamp,
              metadata.last_event_id,
              clientTimestamp,
              eventId,
            );
  if (shouldApply) {
    if (operation === "delete") {
      db.prepare("DELETE FROM goal_plans WHERE goal_id = ?").run(entityId);
    } else {
      localUpsertGoalPlanReplayPayload(db, entityId, payload);
    }
    localUpsertSyncEntityMetadata(
      db,
      "goal_plan",
      entityId,
      eventId,
      clientTimestamp,
      operation,
      seq,
    );
    localMarkReplayTableState(db, "goal_plans");
    localInsertSyncAppliedEvent(db, eventId, seq, "goal_plan", entityId);
  } else {
    localInsertSyncAppliedEvent(db, eventId, seq, "goal_plan", entityId);
  }
  return shouldApply;
}

function localApplyGoalsAllocationReplayEvent(
  db: Database,
  event: Record<string, unknown>,
  payloads: Map<string, Record<string, unknown>>,
): boolean {
  const eventId = requiredLocalPullEventString(event, "event_id", "eventId");
  const entityId = requiredLocalPullEventString(event, "entity_id", "entityId");
  const eventType = requiredLocalPullEventString(event, "type");
  const operation = localGoalsAllocationSyncOperationFromEventType(eventType);
  const clientTimestamp = requiredLocalPullEventString(
    event,
    "client_timestamp",
    "clientTimestamp",
  );
  const seq = requiredInteger(event.seq, "pull event");
  const payload = payloads.get(eventId);
  if (!payload) {
    throw new ConnectServiceError("internal_error", "Replay payload missing", 500);
  }
  if (
    db
      .query<
        { count: number },
        [string]
      >("SELECT COUNT(*) AS count FROM sync_applied_events WHERE event_id = ?")
      .get(eventId)?.count
  ) {
    return false;
  }
  const metadata = db
    .query<
      { last_event_id: string; last_client_timestamp: string; last_op: string | null },
      [string]
    >(
      `
        SELECT last_event_id, last_client_timestamp, last_op
        FROM sync_entity_metadata
        WHERE entity = 'goals_allocation' AND entity_id = ?
      `,
    )
    .get(entityId);
  const previousOperation = metadata?.last_op ?? "update";
  const shouldApply =
    metadata === null || metadata === undefined
      ? true
      : operation === "delete" && previousOperation !== "delete"
        ? true
        : previousOperation === "delete" && (operation === "create" || operation === "update")
          ? false
          : localShouldApplyLww(
              metadata.last_client_timestamp,
              metadata.last_event_id,
              clientTimestamp,
              eventId,
            );
  if (shouldApply) {
    if (operation === "delete") {
      db.prepare("DELETE FROM goals_allocation WHERE id = ?").run(entityId);
    } else {
      localUpsertGoalsAllocationReplayPayload(db, entityId, payload);
    }
    localUpsertSyncEntityMetadata(
      db,
      "goals_allocation",
      entityId,
      eventId,
      clientTimestamp,
      operation,
      seq,
    );
    localMarkReplayTableState(db, "goals_allocation");
    localInsertSyncAppliedEvent(db, eventId, seq, "goals_allocation", entityId);
  } else {
    localInsertSyncAppliedEvent(db, eventId, seq, "goals_allocation", entityId);
  }
  return shouldApply;
}

function localApplyImportTemplateReplayEvent(
  db: Database,
  event: Record<string, unknown>,
  payloads: Map<string, Record<string, unknown>>,
): boolean {
  const eventId = requiredLocalPullEventString(event, "event_id", "eventId");
  const entityId = requiredLocalPullEventString(event, "entity_id", "entityId");
  const eventType = requiredLocalPullEventString(event, "type");
  const operation = localImportTemplateSyncOperationFromEventType(eventType);
  const clientTimestamp = requiredLocalPullEventString(
    event,
    "client_timestamp",
    "clientTimestamp",
  );
  const seq = requiredInteger(event.seq, "pull event");
  const payload = payloads.get(eventId);
  if (!payload) {
    throw new ConnectServiceError("internal_error", "Replay payload missing", 500);
  }
  if (
    db
      .query<
        { count: number },
        [string]
      >("SELECT COUNT(*) AS count FROM sync_applied_events WHERE event_id = ?")
      .get(eventId)?.count
  ) {
    return false;
  }
  const metadata = db
    .query<
      { last_event_id: string; last_client_timestamp: string; last_op: string | null },
      [string]
    >(
      `
        SELECT last_event_id, last_client_timestamp, last_op
        FROM sync_entity_metadata
        WHERE entity = 'import_template' AND entity_id = ?
      `,
    )
    .get(entityId);
  const previousOperation = metadata?.last_op ?? "update";
  const shouldApply =
    metadata === null || metadata === undefined
      ? true
      : operation === "delete" && previousOperation !== "delete"
        ? true
        : previousOperation === "delete" && (operation === "create" || operation === "update")
          ? false
          : localShouldApplyLww(
              metadata.last_client_timestamp,
              metadata.last_event_id,
              clientTimestamp,
              eventId,
            );
  if (shouldApply) {
    if (operation === "delete") {
      db.prepare("DELETE FROM import_templates WHERE id = ?").run(entityId);
    } else {
      localUpsertImportTemplateReplayPayload(db, entityId, payload);
    }
    localUpsertSyncEntityMetadata(
      db,
      "import_template",
      entityId,
      eventId,
      clientTimestamp,
      operation,
      seq,
    );
    localMarkReplayTableState(db, "import_templates");
    localInsertSyncAppliedEvent(db, eventId, seq, "import_template", entityId);
  } else {
    localInsertSyncAppliedEvent(db, eventId, seq, "import_template", entityId);
  }
  return shouldApply;
}

function localApplyActivityReplayEvent(
  db: Database,
  event: Record<string, unknown>,
  payloads: Map<string, Record<string, unknown>>,
): boolean {
  const eventId = requiredLocalPullEventString(event, "event_id", "eventId");
  const entityId = requiredLocalPullEventString(event, "entity_id", "entityId");
  const eventType = requiredLocalPullEventString(event, "type");
  const operation = localActivitySyncOperationFromEventType(eventType);
  const clientTimestamp = requiredLocalPullEventString(
    event,
    "client_timestamp",
    "clientTimestamp",
  );
  const seq = requiredInteger(event.seq, "pull event");
  const payload = payloads.get(eventId);
  if (!payload) {
    throw new ConnectServiceError("internal_error", "Replay payload missing", 500);
  }
  if (
    db
      .query<
        { count: number },
        [string]
      >("SELECT COUNT(*) AS count FROM sync_applied_events WHERE event_id = ?")
      .get(eventId)?.count
  ) {
    return false;
  }
  const metadata = db
    .query<
      { last_event_id: string; last_client_timestamp: string; last_op: string | null },
      [string]
    >(
      `
        SELECT last_event_id, last_client_timestamp, last_op
        FROM sync_entity_metadata
        WHERE entity = 'activity' AND entity_id = ?
      `,
    )
    .get(entityId);
  const previousOperation = metadata?.last_op ?? "update";
  const shouldApply =
    metadata === null || metadata === undefined
      ? true
      : operation === "delete" && previousOperation !== "delete"
        ? true
        : previousOperation === "delete" && (operation === "create" || operation === "update")
          ? false
          : localShouldApplyLww(
              metadata.last_client_timestamp,
              metadata.last_event_id,
              clientTimestamp,
              eventId,
            );
  if (shouldApply) {
    if (operation === "delete") {
      db.prepare("DELETE FROM activities WHERE id = ?").run(entityId);
    } else {
      localUpsertActivityReplayPayload(db, entityId, payload);
    }
    localUpsertSyncEntityMetadata(
      db,
      "activity",
      entityId,
      eventId,
      clientTimestamp,
      operation,
      seq,
    );
    localMarkReplayTableState(db, "activities");
    localInsertSyncAppliedEvent(db, eventId, seq, "activity", entityId);
  } else {
    localInsertSyncAppliedEvent(db, eventId, seq, "activity", entityId);
  }
  return shouldApply;
}

function localApplyActivityImportProfileReplayEvent(
  db: Database,
  event: Record<string, unknown>,
  payloads: Map<string, Record<string, unknown>>,
): boolean {
  const eventId = requiredLocalPullEventString(event, "event_id", "eventId");
  const entityId = requiredLocalPullEventString(event, "entity_id", "entityId");
  const eventType = requiredLocalPullEventString(event, "type");
  const operation = localActivityImportProfileSyncOperationFromEventType(eventType);
  const clientTimestamp = requiredLocalPullEventString(
    event,
    "client_timestamp",
    "clientTimestamp",
  );
  const seq = requiredInteger(event.seq, "pull event");
  const payload = payloads.get(eventId);
  if (!payload) {
    throw new ConnectServiceError("internal_error", "Replay payload missing", 500);
  }
  if (
    db
      .query<
        { count: number },
        [string]
      >("SELECT COUNT(*) AS count FROM sync_applied_events WHERE event_id = ?")
      .get(eventId)?.count
  ) {
    return false;
  }
  const metadata = db
    .query<
      { last_event_id: string; last_client_timestamp: string; last_op: string | null },
      [string]
    >(
      `
        SELECT last_event_id, last_client_timestamp, last_op
        FROM sync_entity_metadata
        WHERE entity = 'activity_import_profile' AND entity_id = ?
      `,
    )
    .get(entityId);
  const previousOperation = metadata?.last_op ?? "update";
  const shouldApply =
    metadata === null || metadata === undefined
      ? true
      : operation === "delete" && previousOperation !== "delete"
        ? true
        : previousOperation === "delete" && (operation === "create" || operation === "update")
          ? false
          : localShouldApplyLww(
              metadata.last_client_timestamp,
              metadata.last_event_id,
              clientTimestamp,
              eventId,
            );
  if (shouldApply) {
    if (operation === "delete") {
      db.prepare("DELETE FROM import_account_templates WHERE id = ?").run(entityId);
    } else {
      localUpsertActivityImportProfileReplayPayload(db, entityId, payload);
    }
    localUpsertSyncEntityMetadata(
      db,
      "activity_import_profile",
      entityId,
      eventId,
      clientTimestamp,
      operation,
      seq,
    );
    localMarkReplayTableState(db, "import_account_templates");
    localInsertSyncAppliedEvent(db, eventId, seq, "activity_import_profile", entityId);
  } else {
    localInsertSyncAppliedEvent(db, eventId, seq, "activity_import_profile", entityId);
  }
  return shouldApply;
}

function localApplyImportRunReplayEvent(
  db: Database,
  event: Record<string, unknown>,
  payloads: Map<string, Record<string, unknown>>,
): boolean {
  const eventId = requiredLocalPullEventString(event, "event_id", "eventId");
  const entityId = requiredLocalPullEventString(event, "entity_id", "entityId");
  const eventType = requiredLocalPullEventString(event, "type");
  const operation = localImportRunSyncOperationFromEventType(eventType);
  const clientTimestamp = requiredLocalPullEventString(
    event,
    "client_timestamp",
    "clientTimestamp",
  );
  const seq = requiredInteger(event.seq, "pull event");
  const payload = payloads.get(eventId);
  if (!payload) {
    throw new ConnectServiceError("internal_error", "Replay payload missing", 500);
  }
  if (
    db
      .query<
        { count: number },
        [string]
      >("SELECT COUNT(*) AS count FROM sync_applied_events WHERE event_id = ?")
      .get(eventId)?.count
  ) {
    return false;
  }
  const metadata = db
    .query<
      { last_event_id: string; last_client_timestamp: string; last_op: string | null },
      [string]
    >(
      `
        SELECT last_event_id, last_client_timestamp, last_op
        FROM sync_entity_metadata
        WHERE entity = 'import_run' AND entity_id = ?
      `,
    )
    .get(entityId);
  const previousOperation = metadata?.last_op ?? "update";
  const shouldApply =
    metadata === null || metadata === undefined
      ? true
      : operation === "delete" && previousOperation !== "delete"
        ? true
        : previousOperation === "delete" && (operation === "create" || operation === "update")
          ? false
          : localShouldApplyLww(
              metadata.last_client_timestamp,
              metadata.last_event_id,
              clientTimestamp,
              eventId,
            );
  if (shouldApply) {
    if (operation === "delete") {
      db.prepare("DELETE FROM import_runs WHERE id = ?").run(entityId);
    } else {
      localUpsertImportRunReplayPayload(db, entityId, payload);
    }
    localUpsertSyncEntityMetadata(
      db,
      "import_run",
      entityId,
      eventId,
      clientTimestamp,
      operation,
      seq,
    );
    localMarkReplayTableState(db, "import_runs");
    localInsertSyncAppliedEvent(db, eventId, seq, "import_run", entityId);
  } else {
    localInsertSyncAppliedEvent(db, eventId, seq, "import_run", entityId);
  }
  return shouldApply;
}

function localApplyAiThreadReplayEvent(
  db: Database,
  event: Record<string, unknown>,
  payloads: Map<string, Record<string, unknown>>,
): boolean {
  const eventId = requiredLocalPullEventString(event, "event_id", "eventId");
  const entityId = requiredLocalPullEventString(event, "entity_id", "entityId");
  const eventType = requiredLocalPullEventString(event, "type");
  const operation = localAiThreadSyncOperationFromEventType(eventType);
  const clientTimestamp = requiredLocalPullEventString(
    event,
    "client_timestamp",
    "clientTimestamp",
  );
  const seq = requiredInteger(event.seq, "pull event");
  const payload = payloads.get(eventId);
  if (!payload) {
    throw new ConnectServiceError("internal_error", "Replay payload missing", 500);
  }
  if (
    db
      .query<
        { count: number },
        [string]
      >("SELECT COUNT(*) AS count FROM sync_applied_events WHERE event_id = ?")
      .get(eventId)?.count
  ) {
    return false;
  }
  const metadata = db
    .query<
      { last_event_id: string; last_client_timestamp: string; last_op: string | null },
      [string]
    >(
      `
        SELECT last_event_id, last_client_timestamp, last_op
        FROM sync_entity_metadata
        WHERE entity = 'ai_thread' AND entity_id = ?
      `,
    )
    .get(entityId);
  const previousOperation = metadata?.last_op ?? "update";
  const shouldApply =
    metadata === null || metadata === undefined
      ? true
      : operation === "delete" && previousOperation !== "delete"
        ? true
        : previousOperation === "delete" && (operation === "create" || operation === "update")
          ? false
          : localShouldApplyLww(
              metadata.last_client_timestamp,
              metadata.last_event_id,
              clientTimestamp,
              eventId,
            );
  if (shouldApply) {
    if (operation === "delete") {
      const childIds = localAiThreadChildIds(db, entityId);
      db.prepare("DELETE FROM ai_threads WHERE id = ?").run(entityId);
      localTombstoneAiThreadChildren(db, childIds, eventId, clientTimestamp, seq);
    } else {
      localUpsertAiThreadReplayPayload(db, entityId, payload);
    }
    localUpsertSyncEntityMetadata(
      db,
      "ai_thread",
      entityId,
      eventId,
      clientTimestamp,
      operation,
      seq,
    );
    localMarkReplayTableState(db, "ai_threads");
    localInsertSyncAppliedEvent(db, eventId, seq, "ai_thread", entityId);
  } else {
    localInsertSyncAppliedEvent(db, eventId, seq, "ai_thread", entityId);
  }
  return shouldApply;
}

function localApplyAiMessageReplayEvent(
  db: Database,
  event: Record<string, unknown>,
  payloads: Map<string, Record<string, unknown>>,
): boolean {
  const eventId = requiredLocalPullEventString(event, "event_id", "eventId");
  const entityId = requiredLocalPullEventString(event, "entity_id", "entityId");
  const eventType = requiredLocalPullEventString(event, "type");
  const operation = localAiMessageSyncOperationFromEventType(eventType);
  const clientTimestamp = requiredLocalPullEventString(
    event,
    "client_timestamp",
    "clientTimestamp",
  );
  const seq = requiredInteger(event.seq, "pull event");
  const payload = payloads.get(eventId);
  if (!payload) {
    throw new ConnectServiceError("internal_error", "Replay payload missing", 500);
  }
  if (
    db
      .query<
        { count: number },
        [string]
      >("SELECT COUNT(*) AS count FROM sync_applied_events WHERE event_id = ?")
      .get(eventId)?.count
  ) {
    return false;
  }
  const metadata = db
    .query<
      { last_event_id: string; last_client_timestamp: string; last_op: string | null },
      [string]
    >(
      `
        SELECT last_event_id, last_client_timestamp, last_op
        FROM sync_entity_metadata
        WHERE entity = 'ai_message' AND entity_id = ?
      `,
    )
    .get(entityId);
  const previousOperation = metadata?.last_op ?? "update";
  const shouldApply =
    metadata === null || metadata === undefined
      ? true
      : operation === "delete" && previousOperation !== "delete"
        ? true
        : previousOperation === "delete" && (operation === "create" || operation === "update")
          ? false
          : localShouldApplyLww(
              metadata.last_client_timestamp,
              metadata.last_event_id,
              clientTimestamp,
              eventId,
            );
  if (shouldApply) {
    if (operation === "delete") {
      db.prepare("DELETE FROM ai_messages WHERE id = ?").run(entityId);
    } else if (
      localSkipAiChildReplayForDeletedThread(
        db,
        "ai_message",
        "ai_messages",
        entityId,
        payload,
        eventId,
        clientTimestamp,
        seq,
      )
    ) {
      return false;
    } else {
      localUpsertAiMessageReplayPayload(db, entityId, payload);
    }
    localUpsertSyncEntityMetadata(
      db,
      "ai_message",
      entityId,
      eventId,
      clientTimestamp,
      operation,
      seq,
    );
    localMarkReplayTableState(db, "ai_messages");
    localInsertSyncAppliedEvent(db, eventId, seq, "ai_message", entityId);
  } else {
    localInsertSyncAppliedEvent(db, eventId, seq, "ai_message", entityId);
  }
  return shouldApply;
}

function localApplyAiThreadTagReplayEvent(
  db: Database,
  event: Record<string, unknown>,
  payloads: Map<string, Record<string, unknown>>,
): boolean {
  const eventId = requiredLocalPullEventString(event, "event_id", "eventId");
  const entityId = requiredLocalPullEventString(event, "entity_id", "entityId");
  const eventType = requiredLocalPullEventString(event, "type");
  const operation = localAiThreadTagSyncOperationFromEventType(eventType);
  const clientTimestamp = requiredLocalPullEventString(
    event,
    "client_timestamp",
    "clientTimestamp",
  );
  const seq = requiredInteger(event.seq, "pull event");
  const payload = payloads.get(eventId);
  if (!payload) {
    throw new ConnectServiceError("internal_error", "Replay payload missing", 500);
  }
  if (
    db
      .query<
        { count: number },
        [string]
      >("SELECT COUNT(*) AS count FROM sync_applied_events WHERE event_id = ?")
      .get(eventId)?.count
  ) {
    return false;
  }
  const metadata = db
    .query<
      { last_event_id: string; last_client_timestamp: string; last_op: string | null },
      [string]
    >(
      `
        SELECT last_event_id, last_client_timestamp, last_op
        FROM sync_entity_metadata
        WHERE entity = 'ai_thread_tag' AND entity_id = ?
      `,
    )
    .get(entityId);
  const previousOperation = metadata?.last_op ?? "update";
  const shouldApply =
    metadata === null || metadata === undefined
      ? true
      : operation === "delete" && previousOperation !== "delete"
        ? true
        : previousOperation === "delete" && (operation === "create" || operation === "update")
          ? false
          : localShouldApplyLww(
              metadata.last_client_timestamp,
              metadata.last_event_id,
              clientTimestamp,
              eventId,
            );
  if (shouldApply) {
    if (operation === "delete") {
      db.prepare("DELETE FROM ai_thread_tags WHERE id = ?").run(entityId);
    } else if (
      localSkipAiChildReplayForDeletedThread(
        db,
        "ai_thread_tag",
        "ai_thread_tags",
        entityId,
        payload,
        eventId,
        clientTimestamp,
        seq,
      )
    ) {
      return false;
    } else {
      localUpsertAiThreadTagReplayPayload(db, entityId, payload);
    }
    localUpsertSyncEntityMetadata(
      db,
      "ai_thread_tag",
      entityId,
      eventId,
      clientTimestamp,
      operation,
      seq,
    );
    localMarkReplayTableState(db, "ai_thread_tags");
    localInsertSyncAppliedEvent(db, eventId, seq, "ai_thread_tag", entityId);
  } else {
    localInsertSyncAppliedEvent(db, eventId, seq, "ai_thread_tag", entityId);
  }
  return shouldApply;
}

function localApplyAssetTaxonomyAssignmentReplayEvent(
  db: Database,
  event: Record<string, unknown>,
  payloads: Map<string, Record<string, unknown>>,
): boolean {
  const eventId = requiredLocalPullEventString(event, "event_id", "eventId");
  const entityId = requiredLocalPullEventString(event, "entity_id", "entityId");
  const eventType = requiredLocalPullEventString(event, "type");
  const operation = localAssetTaxonomyAssignmentSyncOperationFromEventType(eventType);
  const clientTimestamp = requiredLocalPullEventString(
    event,
    "client_timestamp",
    "clientTimestamp",
  );
  const seq = requiredInteger(event.seq, "pull event");
  const payload = payloads.get(eventId);
  if (!payload) {
    throw new ConnectServiceError("internal_error", "Replay payload missing", 500);
  }
  if (
    db
      .query<
        { count: number },
        [string]
      >("SELECT COUNT(*) AS count FROM sync_applied_events WHERE event_id = ?")
      .get(eventId)?.count
  ) {
    return false;
  }
  const replayIdentity = localResolveAssetTaxonomyAssignmentReplayIdentity(db, entityId, payload);
  const metadata = db
    .query<
      { last_event_id: string; last_client_timestamp: string; last_op: string | null },
      [string]
    >(
      `
        SELECT last_event_id, last_client_timestamp, last_op
        FROM sync_entity_metadata
        WHERE entity = 'asset_taxonomy_assignment' AND entity_id = ?
      `,
    )
    .get(replayIdentity.metadataEntityId);
  const metadataWriteEntityId =
    operation === "delete" ? replayIdentity.metadataEntityId : replayIdentity.entityId;
  const previousOperation = metadata?.last_op ?? "update";
  const shouldApply =
    metadata === null || metadata === undefined
      ? true
      : operation === "delete" && previousOperation !== "delete"
        ? true
        : previousOperation === "delete" && (operation === "create" || operation === "update")
          ? false
          : localShouldApplyLww(
              metadata.last_client_timestamp,
              metadata.last_event_id,
              clientTimestamp,
              eventId,
            );
  if (shouldApply) {
    if (operation === "delete") {
      db.prepare("DELETE FROM asset_taxonomy_assignments WHERE id = ?").run(
        replayIdentity.metadataEntityId,
      );
    } else {
      localUpsertAssetTaxonomyAssignmentReplayPayload(
        db,
        replayIdentity.entityId,
        replayIdentity.payload,
      );
    }
    if (operation !== "delete") {
      for (const staleMetadataId of new Set([entityId, replayIdentity.metadataEntityId])) {
        if (staleMetadataId !== replayIdentity.entityId) {
          db.prepare(
            `
              DELETE FROM sync_entity_metadata
              WHERE entity = 'asset_taxonomy_assignment' AND entity_id = ?
            `,
          ).run(staleMetadataId);
        }
      }
    }
    localUpsertSyncEntityMetadata(
      db,
      "asset_taxonomy_assignment",
      metadataWriteEntityId,
      eventId,
      clientTimestamp,
      operation,
      seq,
    );
    if (operation === "delete" && entityId !== metadataWriteEntityId) {
      localUpsertSyncEntityMetadata(
        db,
        "asset_taxonomy_assignment",
        entityId,
        eventId,
        clientTimestamp,
        operation,
        seq,
      );
    }
    localMarkReplayTableState(db, "asset_taxonomy_assignments");
    localInsertSyncAppliedEvent(
      db,
      eventId,
      seq,
      "asset_taxonomy_assignment",
      metadataWriteEntityId,
    );
  } else {
    if (operation === "delete" && entityId !== metadataWriteEntityId) {
      localUpsertSyncEntityMetadata(
        db,
        "asset_taxonomy_assignment",
        entityId,
        eventId,
        clientTimestamp,
        "delete",
        seq,
      );
    }
    localInsertSyncAppliedEvent(
      db,
      eventId,
      seq,
      "asset_taxonomy_assignment",
      metadataWriteEntityId,
    );
  }
  return shouldApply;
}

function localApplyQuoteReplayEvent(
  db: Database,
  event: Record<string, unknown>,
  payloads: Map<string, Record<string, unknown>>,
): boolean {
  const eventId = requiredLocalPullEventString(event, "event_id", "eventId");
  const entityId = requiredLocalPullEventString(event, "entity_id", "entityId");
  const eventType = requiredLocalPullEventString(event, "type");
  const operation = localQuoteSyncOperationFromEventType(eventType);
  const clientTimestamp = requiredLocalPullEventString(
    event,
    "client_timestamp",
    "clientTimestamp",
  );
  const seq = requiredInteger(event.seq, "pull event");
  const payload = payloads.get(eventId);
  if (!payload) {
    throw new ConnectServiceError("internal_error", "Replay payload missing", 500);
  }
  if (
    db
      .query<
        { count: number },
        [string]
      >("SELECT COUNT(*) AS count FROM sync_applied_events WHERE event_id = ?")
      .get(eventId)?.count
  ) {
    return false;
  }
  const metadata = db
    .query<
      { last_event_id: string; last_client_timestamp: string; last_op: string | null },
      [string]
    >(
      `
        SELECT last_event_id, last_client_timestamp, last_op
        FROM sync_entity_metadata
        WHERE entity = 'quote' AND entity_id = ?
      `,
    )
    .get(entityId);
  const previousOperation = metadata?.last_op ?? "update";
  const shouldApply =
    metadata === null || metadata === undefined
      ? true
      : operation === "delete" && previousOperation !== "delete"
        ? true
        : previousOperation === "delete" && (operation === "create" || operation === "update")
          ? false
          : localShouldApplyLww(
              metadata.last_client_timestamp,
              metadata.last_event_id,
              clientTimestamp,
              eventId,
            );
  if (shouldApply) {
    if (operation === "delete") {
      db.prepare("DELETE FROM quotes WHERE id = ?").run(entityId);
    } else {
      localUpsertQuoteReplayPayload(db, entityId, payload);
    }
    localUpsertSyncEntityMetadata(db, "quote", entityId, eventId, clientTimestamp, operation, seq);
    localMarkReplayTableState(db, "quotes");
    localInsertSyncAppliedEvent(db, eventId, seq, "quote", entityId);
  } else {
    localInsertSyncAppliedEvent(db, eventId, seq, "quote", entityId);
  }
  return shouldApply;
}

function localApplySnapshotReplayEvent(
  db: Database,
  event: Record<string, unknown>,
  payloads: Map<string, Record<string, unknown>>,
): boolean {
  const eventId = requiredLocalPullEventString(event, "event_id", "eventId");
  const entityId = requiredLocalPullEventString(event, "entity_id", "entityId");
  const eventType = requiredLocalPullEventString(event, "type");
  const operation = localSnapshotSyncOperationFromEventType(eventType);
  const clientTimestamp = requiredLocalPullEventString(
    event,
    "client_timestamp",
    "clientTimestamp",
  );
  const seq = requiredInteger(event.seq, "pull event");
  const payload = payloads.get(eventId);
  if (!payload) {
    throw new ConnectServiceError("internal_error", "Replay payload missing", 500);
  }
  if (
    db
      .query<
        { count: number },
        [string]
      >("SELECT COUNT(*) AS count FROM sync_applied_events WHERE event_id = ?")
      .get(eventId)?.count
  ) {
    return false;
  }
  const metadata = db
    .query<
      { last_event_id: string; last_client_timestamp: string; last_op: string | null },
      [string]
    >(
      `
        SELECT last_event_id, last_client_timestamp, last_op
        FROM sync_entity_metadata
        WHERE entity = 'snapshot' AND entity_id = ?
      `,
    )
    .get(entityId);
  const previousOperation = metadata?.last_op ?? "update";
  const shouldApply =
    metadata === null || metadata === undefined
      ? true
      : operation === "delete" && previousOperation !== "delete"
        ? true
        : previousOperation === "delete" && (operation === "create" || operation === "update")
          ? false
          : localShouldApplyLww(
              metadata.last_client_timestamp,
              metadata.last_event_id,
              clientTimestamp,
              eventId,
            );
  if (shouldApply) {
    if (operation === "delete") {
      db.prepare("DELETE FROM holdings_snapshots WHERE id = ?").run(entityId);
    } else {
      localUpsertSnapshotReplayPayload(db, entityId, payload);
      db.prepare("DELETE FROM snapshot_positions WHERE snapshot_id = ?").run(entityId);
    }
    localUpsertSyncEntityMetadata(
      db,
      "snapshot",
      entityId,
      eventId,
      clientTimestamp,
      operation,
      seq,
    );
    localMarkReplayTableState(db, "holdings_snapshots");
    localInsertSyncAppliedEvent(db, eventId, seq, "snapshot", entityId);
  } else {
    localInsertSyncAppliedEvent(db, eventId, seq, "snapshot", entityId);
  }
  return shouldApply;
}

function localApplyAssetReplayEvent(
  db: Database,
  event: Record<string, unknown>,
  payloads: Map<string, Record<string, unknown>>,
): boolean {
  const eventId = requiredLocalPullEventString(event, "event_id", "eventId");
  const entityId = requiredLocalPullEventString(event, "entity_id", "entityId");
  const eventType = requiredLocalPullEventString(event, "type");
  const operation = localAssetSyncOperationFromEventType(eventType);
  const clientTimestamp = requiredLocalPullEventString(
    event,
    "client_timestamp",
    "clientTimestamp",
  );
  const seq = requiredInteger(event.seq, "pull event");
  const payload = payloads.get(eventId);
  if (!payload) {
    throw new ConnectServiceError("internal_error", "Replay payload missing", 500);
  }
  if (
    db
      .query<
        { count: number },
        [string]
      >("SELECT COUNT(*) AS count FROM sync_applied_events WHERE event_id = ?")
      .get(eventId)?.count
  ) {
    return false;
  }
  const metadata = db
    .query<
      { last_event_id: string; last_client_timestamp: string; last_op: string | null },
      [string]
    >(
      `
        SELECT last_event_id, last_client_timestamp, last_op
        FROM sync_entity_metadata
        WHERE entity = 'asset' AND entity_id = ?
      `,
    )
    .get(entityId);
  const previousOperation = metadata?.last_op ?? "update";
  const shouldApply =
    metadata === null || metadata === undefined
      ? true
      : operation === "delete" && previousOperation !== "delete"
        ? true
        : previousOperation === "delete" && (operation === "create" || operation === "update")
          ? false
          : localShouldApplyLww(
              metadata.last_client_timestamp,
              metadata.last_event_id,
              clientTimestamp,
              eventId,
            );
  if (shouldApply) {
    if (operation === "delete") {
      db.prepare("DELETE FROM assets WHERE id = ?").run(entityId);
    } else {
      localUpsertAssetReplayPayload(db, entityId, payload);
    }
    localUpsertSyncEntityMetadata(db, "asset", entityId, eventId, clientTimestamp, operation, seq);
    localMarkReplayTableState(db, "assets");
    localInsertSyncAppliedEvent(db, eventId, seq, "asset", entityId);
  } else {
    localInsertSyncAppliedEvent(db, eventId, seq, "asset", entityId);
  }
  return shouldApply;
}

function localSyncOperationFromEventType(eventType: string): "create" | "update" | "delete" {
  const match = /^account\.(create|update|delete)\.v1$/.exec(eventType);
  if (!match) {
    throw deviceSyncDisabled();
  }
  return match[1] as "create" | "update" | "delete";
}

function localPlatformSyncOperationFromEventType(
  eventType: string,
): "create" | "update" | "delete" {
  const match = /^platform\.(create|update|delete)\.v1$/.exec(eventType);
  if (!match) {
    throw deviceSyncDisabled();
  }
  return match[1] as "create" | "update" | "delete";
}

function localPortfolioSyncOperationFromEventType(
  eventType: string,
): "create" | "update" | "delete" {
  const match = /^portfolio\.(create|update|delete)\.v1$/.exec(eventType);
  if (!match) {
    throw deviceSyncDisabled();
  }
  return match[1] as "create" | "update" | "delete";
}

function localPortfolioAccountSyncOperationFromEventType(
  eventType: string,
): "create" | "update" | "delete" {
  const match = /^portfolio_account\.(create|update|delete)\.v1$/.exec(eventType);
  if (!match) {
    throw deviceSyncDisabled();
  }
  return match[1] as "create" | "update" | "delete";
}

function localContributionLimitSyncOperationFromEventType(
  eventType: string,
): "create" | "update" | "delete" {
  const match = /^contribution_limit\.(create|update|delete)\.v1$/.exec(eventType);
  if (!match) {
    throw deviceSyncDisabled();
  }
  return match[1] as "create" | "update" | "delete";
}

function localCustomProviderSyncOperationFromEventType(
  eventType: string,
): "create" | "update" | "delete" {
  const match = /^custom_provider\.(create|update|delete)\.v1$/.exec(eventType);
  if (!match) {
    throw deviceSyncDisabled();
  }
  return match[1] as "create" | "update" | "delete";
}

function localCustomTaxonomySyncOperationFromEventType(
  eventType: string,
): "create" | "update" | "delete" {
  const match = /^custom_taxonomy\.(create|update|delete)\.v1$/.exec(eventType);
  if (!match) {
    throw deviceSyncDisabled();
  }
  return match[1] as "create" | "update" | "delete";
}

function localGoalSyncOperationFromEventType(eventType: string): "create" | "update" | "delete" {
  const match = /^goal\.(create|update|delete)\.v1$/.exec(eventType);
  if (!match) {
    throw deviceSyncDisabled();
  }
  return match[1] as "create" | "update" | "delete";
}

function localGoalPlanSyncOperationFromEventType(
  eventType: string,
): "create" | "update" | "delete" {
  const match = /^goal_plan\.(create|update|delete)\.v1$/.exec(eventType);
  if (!match) {
    throw deviceSyncDisabled();
  }
  return match[1] as "create" | "update" | "delete";
}

function localGoalsAllocationSyncOperationFromEventType(
  eventType: string,
): "create" | "update" | "delete" {
  const match = /^goals_allocation\.(create|update|delete)\.v1$/.exec(eventType);
  if (!match) {
    throw deviceSyncDisabled();
  }
  return match[1] as "create" | "update" | "delete";
}

function localImportTemplateSyncOperationFromEventType(
  eventType: string,
): "create" | "update" | "delete" {
  const match = /^import_template\.(create|update|delete)\.v1$/.exec(eventType);
  if (!match) {
    throw deviceSyncDisabled();
  }
  return match[1] as "create" | "update" | "delete";
}

function localActivitySyncOperationFromEventType(
  eventType: string,
): "create" | "update" | "delete" {
  const match = /^activity\.(create|update|delete)\.v1$/.exec(eventType);
  if (!match) {
    throw deviceSyncDisabled();
  }
  return match[1] as "create" | "update" | "delete";
}

function localActivityImportProfileSyncOperationFromEventType(
  eventType: string,
): "create" | "update" | "delete" {
  const match = /^activity_import_profile\.(create|update|delete)\.v1$/.exec(eventType);
  if (!match) {
    throw deviceSyncDisabled();
  }
  return match[1] as "create" | "update" | "delete";
}

function localImportRunSyncOperationFromEventType(
  eventType: string,
): "create" | "update" | "delete" {
  const match = /^import_run\.(create|update|delete)\.v1$/.exec(eventType);
  if (!match) {
    throw deviceSyncDisabled();
  }
  return match[1] as "create" | "update" | "delete";
}

function localAiThreadSyncOperationFromEventType(
  eventType: string,
): "create" | "update" | "delete" {
  const match = /^ai_thread\.(create|update|delete)\.v1$/.exec(eventType);
  if (!match) {
    throw deviceSyncDisabled();
  }
  return match[1] as "create" | "update" | "delete";
}

function localAiMessageSyncOperationFromEventType(
  eventType: string,
): "create" | "update" | "delete" {
  const match = /^ai_message\.(create|update|delete)\.v1$/.exec(eventType);
  if (!match) {
    throw deviceSyncDisabled();
  }
  return match[1] as "create" | "update" | "delete";
}

function localAiThreadTagSyncOperationFromEventType(
  eventType: string,
): "create" | "update" | "delete" {
  const match = /^ai_thread_tag\.(create|update|delete)\.v1$/.exec(eventType);
  if (!match) {
    throw deviceSyncDisabled();
  }
  return match[1] as "create" | "update" | "delete";
}

function localAssetTaxonomyAssignmentSyncOperationFromEventType(
  eventType: string,
): "create" | "update" | "delete" {
  const match = /^asset_taxonomy_assignment\.(create|update|delete)\.v1$/.exec(eventType);
  if (!match) {
    throw deviceSyncDisabled();
  }
  return match[1] as "create" | "update" | "delete";
}

function localQuoteSyncOperationFromEventType(eventType: string): "create" | "update" | "delete" {
  const match = /^quote\.(create|update|delete)\.v1$/.exec(eventType);
  if (!match) {
    throw deviceSyncDisabled();
  }
  return match[1] as "create" | "update" | "delete";
}

function localSnapshotSyncOperationFromEventType(
  eventType: string,
): "create" | "update" | "delete" {
  const match = /^snapshot\.(create|update|delete)\.v1$/.exec(eventType);
  if (!match) {
    throw deviceSyncDisabled();
  }
  return match[1] as "create" | "update" | "delete";
}

function localAssetSyncOperationFromEventType(eventType: string): "create" | "update" | "delete" {
  const match = /^asset\.(create|update|delete)\.v1$/.exec(eventType);
  if (!match) {
    throw deviceSyncDisabled();
  }
  return match[1] as "create" | "update" | "delete";
}

function requiredLocalPullEventString(
  event: Record<string, unknown>,
  primary: string,
  alias?: string,
): string {
  const value = optionalString(event[primary] ?? (alias ? event[alias] : undefined));
  if (value === null) {
    throw new ConnectServiceError("internal_error", "Failed to parse pull response", 500);
  }
  return value;
}

async function localDecryptReplayPayload(
  event: Record<string, unknown>,
  identity: ReturnType<typeof parseSyncIdentity>,
): Promise<Record<string, unknown>> {
  const encryptedPayload = requiredLocalPullEventString(event, "payload");
  const payloadKeyVersion = requiredInteger(
    event.payload_key_version ?? event.payloadKeyVersion,
    "pull event",
  );
  if (!identity.rootKey) {
    throw new ConnectServiceError(
      "internal_error",
      "Replay decrypt failed: No root key configured",
      500,
    );
  }
  const crypto = createSyncCryptoService();
  const dek = (await crypto.deriveDek(identity.rootKey, payloadKeyVersion)).value;
  const decrypted = (await crypto.decrypt(dek, encryptedPayload)).value;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decrypted);
  } catch (error) {
    throw new ConnectServiceError(
      "internal_error",
      `Replay payload decode failed: ${errorMessage(error)}`,
      500,
    );
  }
  if (!isRecord(parsed)) {
    throw new ConnectServiceError("internal_error", "Replay payload must be a JSON object", 500);
  }
  return parsed;
}

function localUpsertAccountReplayPayload(
  db: Database,
  entityId: string,
  rawPayload: Record<string, unknown>,
  fallbackTimestamp: string,
): void {
  const payload = normalizeReplayPayload("account", rawPayload);
  const id = optionalString(payload.id) ?? entityId;
  if (id !== entityId) {
    throw new ConnectServiceError(
      "internal_error",
      `Sync payload PK 'id' does not match entity_id '${entityId}'`,
      500,
    );
  }
  const name = requiredReplayString(payload.name, "account.name");
  const accountType = requiredReplayString(payload.account_type, "account.account_type");
  const currency = requiredReplayString(payload.currency, "account.currency");
  const createdAt = optionalString(payload.created_at) ?? fallbackTimestamp;
  const updatedAt = optionalString(payload.updated_at) ?? fallbackTimestamp;
  db.prepare(
    `
      INSERT INTO accounts (
        id, name, account_type, "group", currency, is_default, is_active,
        created_at, updated_at, platform_id, account_number, meta, provider,
        provider_account_id, is_archived, tracking_mode
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        account_type = excluded.account_type,
        "group" = excluded."group",
        currency = excluded.currency,
        is_default = excluded.is_default,
        is_active = excluded.is_active,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        platform_id = excluded.platform_id,
        account_number = excluded.account_number,
        meta = excluded.meta,
        provider = excluded.provider,
        provider_account_id = excluded.provider_account_id,
        is_archived = excluded.is_archived,
        tracking_mode = excluded.tracking_mode
    `,
  ).run(
    entityId,
    name,
    accountType,
    optionalString(payload.group) ?? null,
    currency,
    replayBooleanToInteger(payload.is_default),
    replayBooleanToInteger(payload.is_active, true),
    createdAt,
    updatedAt,
    optionalString(payload.platform_id) ?? null,
    optionalString(payload.account_number) ?? null,
    optionalString(payload.meta) ?? null,
    optionalString(payload.provider) ?? null,
    optionalString(payload.provider_account_id) ?? null,
    replayBooleanToInteger(payload.is_archived),
    optionalString(payload.tracking_mode) ?? "NOT_SET",
  );
}

function localUpsertPlatformReplayPayload(
  db: Database,
  entityId: string,
  rawPayload: Record<string, unknown>,
): void {
  const payload = normalizeReplayPayload("platform", rawPayload);
  const id = optionalString(payload.id) ?? entityId;
  if (id !== entityId) {
    throw new ConnectServiceError(
      "internal_error",
      `Sync payload PK 'id' does not match entity_id '${entityId}'`,
      500,
    );
  }
  const url = requiredReplayString(payload.url, "platform.url");
  db.prepare(
    `
      INSERT INTO platforms (id, name, url, external_id, kind, website_url, logo_url)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        url = excluded.url,
        external_id = excluded.external_id,
        kind = excluded.kind,
        website_url = excluded.website_url,
        logo_url = excluded.logo_url
    `,
  ).run(
    entityId,
    optionalString(payload.name) ?? null,
    url,
    optionalString(payload.external_id) ?? null,
    optionalString(payload.kind) ?? "BROKERAGE",
    optionalString(payload.website_url) ?? null,
    optionalString(payload.logo_url) ?? null,
  );
}

function localUpsertPortfolioReplayPayload(
  db: Database,
  entityId: string,
  rawPayload: Record<string, unknown>,
  fallbackTimestamp: string,
): void {
  const payload = normalizeReplayPayload("portfolio", rawPayload);
  const id = optionalString(payload.id) ?? entityId;
  if (id !== entityId) {
    throw new ConnectServiceError(
      "internal_error",
      `Sync payload PK 'id' does not match entity_id '${entityId}'`,
      500,
    );
  }
  const name = requiredReplayString(payload.name, "portfolio.name");
  const sortOrderValue = payload.sort_order ?? 0;
  const sortOrder = requiredInteger(sortOrderValue, "portfolio.sort_order");
  const createdAt = optionalString(payload.created_at) ?? fallbackTimestamp;
  const updatedAt = optionalString(payload.updated_at) ?? fallbackTimestamp;
  db.prepare(
    `
      INSERT INTO portfolios (id, name, description, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        sort_order = excluded.sort_order,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `,
  ).run(
    entityId,
    name,
    optionalString(payload.description) ?? null,
    sortOrder,
    createdAt,
    updatedAt,
  );
}

function localUpsertPortfolioAccountReplayPayload(
  db: Database,
  entityId: string,
  rawPayload: Record<string, unknown>,
  fallbackTimestamp: string,
): void {
  const payload = normalizeReplayPayload("portfolio_account", rawPayload);
  const id = optionalString(payload.id) ?? entityId;
  if (id !== entityId) {
    throw new ConnectServiceError(
      "internal_error",
      `Sync payload PK 'id' does not match entity_id '${entityId}'`,
      500,
    );
  }
  const portfolioId = requiredReplayString(payload.portfolio_id, "portfolio_account.portfolio_id");
  const accountId = requiredReplayString(payload.account_id, "portfolio_account.account_id");
  const sortOrder = requiredInteger(payload.sort_order ?? 0, "portfolio_account.sort_order");
  const createdAt = optionalString(payload.created_at) ?? fallbackTimestamp;
  db.prepare(
    `
      INSERT INTO portfolio_accounts (id, portfolio_id, account_id, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        portfolio_id = excluded.portfolio_id,
        account_id = excluded.account_id,
        sort_order = excluded.sort_order,
        created_at = excluded.created_at
    `,
  ).run(entityId, portfolioId, accountId, sortOrder, createdAt);
}

function localUpsertContributionLimitReplayPayload(
  db: Database,
  entityId: string,
  rawPayload: Record<string, unknown>,
  fallbackTimestamp: string,
): void {
  const payload = normalizeReplayPayload("contribution_limit", rawPayload);
  const id = optionalString(payload.id) ?? entityId;
  if (id !== entityId) {
    throw new ConnectServiceError(
      "internal_error",
      `Sync payload PK 'id' does not match entity_id '${entityId}'`,
      500,
    );
  }
  const groupName = requiredReplayString(payload.group_name, "contribution_limit.group_name");
  const contributionYear = requiredInteger(
    payload.contribution_year,
    "contribution_limit.contribution_year",
  );
  const limitAmount = requiredFiniteNumber(payload.limit_amount, "contribution_limit.limit_amount");
  const createdAt = optionalString(payload.created_at) ?? fallbackTimestamp;
  const updatedAt = optionalString(payload.updated_at) ?? fallbackTimestamp;
  db.prepare(
    `
      INSERT INTO contribution_limits (
        id, group_name, contribution_year, limit_amount, account_ids,
        created_at, updated_at, start_date, end_date
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        group_name = excluded.group_name,
        contribution_year = excluded.contribution_year,
        limit_amount = excluded.limit_amount,
        account_ids = excluded.account_ids,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        start_date = excluded.start_date,
        end_date = excluded.end_date
    `,
  ).run(
    entityId,
    groupName,
    contributionYear,
    limitAmount,
    optionalString(payload.account_ids) ?? null,
    createdAt,
    updatedAt,
    optionalString(payload.start_date) ?? null,
    optionalString(payload.end_date) ?? null,
  );
}

function localUpsertCustomProviderReplayPayload(
  db: Database,
  entityId: string,
  rawPayload: Record<string, unknown>,
  fallbackTimestamp: string,
): void {
  const payload = normalizeReplayPayload("custom_provider", rawPayload);
  const id = optionalString(payload.id) ?? entityId;
  if (id !== entityId) {
    throw new ConnectServiceError(
      "internal_error",
      `Sync payload PK 'id' does not match entity_id '${entityId}'`,
      500,
    );
  }
  const code = requiredReplayString(payload.code, "custom_provider.code");
  const name = requiredReplayString(payload.name, "custom_provider.name");
  const priority = requiredInteger(payload.priority ?? 50, "custom_provider.priority");
  const createdAt = optionalString(payload.created_at) ?? fallbackTimestamp;
  const updatedAt = optionalString(payload.updated_at) ?? fallbackTimestamp;
  db.prepare(
    `
      INSERT INTO market_data_custom_providers (
        id, code, name, description, enabled, priority, config, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        code = excluded.code,
        name = excluded.name,
        description = excluded.description,
        enabled = excluded.enabled,
        priority = excluded.priority,
        config = excluded.config,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `,
  ).run(
    entityId,
    code,
    name,
    optionalString(payload.description) ?? "",
    replayBooleanToInteger(payload.enabled, true),
    priority,
    replayOptionalTextValue(payload.config),
    createdAt,
    updatedAt,
  );
}

function localApplyCustomTaxonomyReplayPayload(
  db: Database,
  entityId: string,
  operation: "create" | "update" | "delete",
  rawPayload: Record<string, unknown>,
): void {
  if (operation === "delete") {
    db.prepare("DELETE FROM taxonomies WHERE id = ?").run(entityId);
    return;
  }

  const bundle = normalizeCustomTaxonomyReplayBundle(entityId, rawPayload);
  if (bundle.taxonomy.is_system !== 0 && bundle.taxonomy.id !== "custom_groups") {
    throw new ConnectServiceError("internal_error", "Cannot sync system taxonomy", 500);
  }
  if (bundle.taxonomy.id !== entityId) {
    throw new ConnectServiceError(
      "internal_error",
      `custom_taxonomy payload id '${bundle.taxonomy.id}' does not match entity_id '${entityId}'`,
      500,
    );
  }
  for (const category of bundle.categories) {
    if (category.taxonomy_id !== entityId) {
      throw new ConnectServiceError(
        "internal_error",
        `custom_taxonomy category '${category.id}' has taxonomy_id '${category.taxonomy_id}', expected '${entityId}'`,
        500,
      );
    }
  }

  if (entityId !== "custom_groups") {
    localUpsertReplayPayloadFields(db, "taxonomies", "id", entityId, bundle.taxonomy);
  }
  for (const category of bundle.categories) {
    localUpsertCustomTaxonomyCategoryReplayPayload(db, entityId, category);
  }
  const categoryIds = bundle.categories.map((category) => category.id);
  if (categoryIds.length === 0) {
    db.prepare("DELETE FROM taxonomy_categories WHERE taxonomy_id = ?").run(entityId);
    return;
  }
  db.prepare(
    `
      DELETE FROM taxonomy_categories
      WHERE taxonomy_id = ?
        AND id NOT IN (${categoryIds.map(() => "?").join(", ")})
    `,
  ).run(entityId, ...categoryIds);
}

function localUpsertGoalReplayPayload(
  db: Database,
  entityId: string,
  rawPayload: Record<string, unknown>,
): void {
  const payload = normalizeReplayPayload("goal", rawPayload);
  validateGoalReplayPayloadFields(payload);
  localUpsertReplayPayloadFields(db, "goals", "id", entityId, payload);
}

function localUpsertGoalPlanReplayPayload(
  db: Database,
  entityId: string,
  rawPayload: Record<string, unknown>,
): void {
  const payload = normalizeReplayPayload("goal_plan", rawPayload);
  validateGoalPlanReplayPayloadFields(payload);
  localUpsertReplayPayloadFields(db, "goal_plans", "goal_id", entityId, payload);
}

function localUpsertGoalsAllocationReplayPayload(
  db: Database,
  entityId: string,
  rawPayload: Record<string, unknown>,
): void {
  const payload = normalizeReplayPayload("goals_allocation", rawPayload);
  validateGoalsAllocationReplayPayloadFields(payload);
  localUpsertReplayPayloadFields(db, "goals_allocation", "id", entityId, payload);
}

function localUpsertImportTemplateReplayPayload(
  db: Database,
  entityId: string,
  rawPayload: Record<string, unknown>,
): void {
  const payload = normalizeReplayPayload("import_template", rawPayload);
  validateImportTemplateReplayPayloadFields(payload);
  localUpsertReplayPayloadFields(db, "import_templates", "id", entityId, payload);
}

function localUpsertActivityReplayPayload(
  db: Database,
  entityId: string,
  rawPayload: Record<string, unknown>,
): void {
  const payload = normalizeReplayPayload("activity", rawPayload);
  validateActivityReplayPayloadFields(payload);
  localUpsertReplayPayloadFields(db, "activities", "id", entityId, payload);
}

function localUpsertActivityImportProfileReplayPayload(
  db: Database,
  entityId: string,
  rawPayload: Record<string, unknown>,
): void {
  const payload = normalizeReplayPayload("activity_import_profile", rawPayload);
  localUpsertReplayPayloadFields(db, "import_account_templates", "id", entityId, payload);
}

function localUpsertImportRunReplayPayload(
  db: Database,
  entityId: string,
  rawPayload: Record<string, unknown>,
): void {
  const payload = normalizeReplayPayload("import_run", rawPayload);
  localUpsertReplayPayloadFields(db, "import_runs", "id", entityId, payload);
}

function localUpsertAiThreadReplayPayload(
  db: Database,
  entityId: string,
  rawPayload: Record<string, unknown>,
): void {
  const payload = normalizeReplayPayload("ai_thread", rawPayload);
  localUpsertReplayPayloadFields(db, "ai_threads", "id", entityId, payload);
}

function localUpsertAiMessageReplayPayload(
  db: Database,
  entityId: string,
  rawPayload: Record<string, unknown>,
): void {
  const payload = normalizeReplayPayload("ai_message", rawPayload);
  localUpsertReplayPayloadFields(db, "ai_messages", "id", entityId, payload);
}

function localUpsertAiThreadTagReplayPayload(
  db: Database,
  entityId: string,
  rawPayload: Record<string, unknown>,
): void {
  const payload = normalizeReplayPayload("ai_thread_tag", rawPayload);
  const id = optionalString(payload.id) ?? entityId;
  if (id !== entityId) {
    throw new ConnectServiceError(
      "internal_error",
      `Sync payload PK 'id' does not match entity_id '${entityId}'`,
      500,
    );
  }
  const threadId = optionalString(payload.thread_id);
  const tag = optionalString(payload.tag);
  if (threadId !== null && tag !== null) {
    const duplicate = db
      .query<{ id: string }, [string, string, string]>(
        `
          SELECT id
          FROM ai_thread_tags
          WHERE thread_id = ? AND tag = ? AND id <> ?
        `,
      )
      .get(threadId, tag, entityId);
    if (duplicate) {
      const canonicalId = duplicate.id > entityId ? duplicate.id : entityId;
      const assignments: string[] = [];
      const values: Array<string | number | null> = [];
      if (duplicate.id !== canonicalId) {
        assignments.push("id = ?");
        values.push(canonicalId);
      }
      for (const [column, value] of Object.entries(payload)) {
        if (column === "id") {
          continue;
        }
        if (column === "created_at" && duplicate.id === canonicalId) {
          continue;
        }
        assignments.push(`${quoteReplayIdentifier(column)} = ?`);
        values.push(replayValueToSqlite(value));
      }
      if (assignments.length === 0) {
        return;
      }
      values.push(duplicate.id);
      db.prepare(
        `
          UPDATE ai_thread_tags
          SET ${assignments.join(", ")}
          WHERE id = ?
        `,
      ).run(...values);
      if (duplicate.id !== canonicalId) {
        db.prepare(
          "DELETE FROM sync_entity_metadata WHERE entity = 'ai_thread_tag' AND entity_id = ?",
        ).run(duplicate.id);
      }
      return;
    }
  }
  localUpsertReplayPayloadFields(db, "ai_thread_tags", "id", entityId, payload);
}

function localUpsertAssetTaxonomyAssignmentReplayPayload(
  db: Database,
  entityId: string,
  payload: Record<string, unknown>,
): void {
  const canonicalPayload = { ...payload, id: entityId };
  localUpsertNaturalKeyedReplayPayloadFields(db, {
    tableName: "asset_taxonomy_assignments",
    pkColumn: "id",
    entityId,
    payload: canonicalPayload,
    naturalKeyColumns: ["asset_id", "taxonomy_id", "category_id"],
    preserveCanonicalColumns: ["created_at"],
  });
}

function localResolveAssetTaxonomyAssignmentReplayIdentity(
  db: Database,
  entityId: string,
  rawPayload: Record<string, unknown>,
): { entityId: string; metadataEntityId: string; payload: Record<string, unknown> } {
  const payload = normalizeReplayPayload("asset_taxonomy_assignment", rawPayload);
  if (Object.hasOwn(payload, "id") && !replayPayloadValueMatchesEntityId(payload.id, entityId)) {
    throw new ConnectServiceError(
      "internal_error",
      `Sync payload PK 'id' does not match entity_id '${entityId}'`,
      500,
    );
  }
  validateAssetTaxonomyAssignmentReplayPayloadFields(payload);
  const assetId = payload.asset_id;
  const taxonomyId = payload.taxonomy_id;
  const categoryId = payload.category_id;
  if (assetId === undefined || taxonomyId === undefined || categoryId === undefined) {
    return { entityId, metadataEntityId: entityId, payload };
  }
  const duplicate = db
    .query<
      { id: string },
      [string | number | null, string | number | null, string | number | null, string]
    >(
      `
        SELECT id
        FROM asset_taxonomy_assignments
        WHERE asset_id = ? AND taxonomy_id = ? AND category_id = ? AND id <> ?
      `,
    )
    .get(
      replayValueToSqlite(assetId),
      replayValueToSqlite(taxonomyId),
      replayValueToSqlite(categoryId),
      entityId,
    );
  if (!duplicate) {
    return { entityId, metadataEntityId: entityId, payload };
  }
  return {
    entityId: duplicate.id > entityId ? duplicate.id : entityId,
    metadataEntityId: duplicate.id,
    payload,
  };
}

function localUpsertQuoteReplayPayload(
  db: Database,
  entityId: string,
  rawPayload: Record<string, unknown>,
): void {
  const payload = normalizeReplayPayload("quote", rawPayload);
  localUpsertReplayPayloadFields(db, "quotes", "id", entityId, payload);
}

function localUpsertSnapshotReplayPayload(
  db: Database,
  entityId: string,
  rawPayload: Record<string, unknown>,
): void {
  const payload = normalizeReplayPayload("snapshot", rawPayload);
  localUpsertReplayPayloadFields(db, "holdings_snapshots", "id", entityId, payload);
}

function localUpsertAssetReplayPayload(
  db: Database,
  entityId: string,
  rawPayload: Record<string, unknown>,
): void {
  const payload = normalizeReplayPayload("asset", rawPayload);
  validateAssetReplayPayloadFields(payload);
  localUpsertReplayPayloadFields(db, "assets", "id", entityId, payload);
}

function localAiThreadChildIds(
  db: Database,
  threadId: string,
): { messageIds: string[]; tagIds: string[] } {
  return {
    messageIds: db
      .query<{ id: string }, [string]>("SELECT id FROM ai_messages WHERE thread_id = ?")
      .all(threadId)
      .map((row) => row.id),
    tagIds: db
      .query<{ id: string }, [string]>("SELECT id FROM ai_thread_tags WHERE thread_id = ?")
      .all(threadId)
      .map((row) => row.id),
  };
}

function localTombstoneAiThreadChildren(
  db: Database,
  childIds: { messageIds: string[]; tagIds: string[] },
  eventId: string,
  clientTimestamp: string,
  seq: number,
): void {
  for (const messageId of childIds.messageIds) {
    localUpsertSyncEntityMetadata(
      db,
      "ai_message",
      messageId,
      eventId,
      clientTimestamp,
      "delete",
      seq,
    );
  }
  for (const tagId of childIds.tagIds) {
    localUpsertSyncEntityMetadata(
      db,
      "ai_thread_tag",
      tagId,
      eventId,
      clientTimestamp,
      "delete",
      seq,
    );
  }
  if (childIds.messageIds.length > 0) {
    localMarkReplayTableState(db, "ai_messages");
  }
  if (childIds.tagIds.length > 0) {
    localMarkReplayTableState(db, "ai_thread_tags");
  }
}

function localSkipAiChildReplayForDeletedThread(
  db: Database,
  entity: "ai_message" | "ai_thread_tag",
  tableName: "ai_messages" | "ai_thread_tags",
  entityId: string,
  rawPayload: Record<string, unknown>,
  eventId: string,
  clientTimestamp: string,
  seq: number,
): boolean {
  const payload = normalizeReplayPayload(entity, rawPayload);
  const threadId = optionalString(payload.thread_id);
  if (threadId === null || !localAiThreadIsDeleted(db, threadId)) {
    return false;
  }
  db.prepare(`DELETE FROM ${quoteReplayIdentifier(tableName)} WHERE id = ?`).run(entityId);
  localUpsertSyncEntityMetadata(db, entity, entityId, eventId, clientTimestamp, "delete", seq);
  localMarkReplayTableState(db, tableName);
  localInsertSyncAppliedEvent(db, eventId, seq, entity, entityId);
  return true;
}

function localAiThreadIsDeleted(db: Database, threadId: string): boolean {
  return (
    db
      .query<{ last_op: string | null }, [string]>(
        `
          SELECT last_op
          FROM sync_entity_metadata
          WHERE entity = 'ai_thread' AND entity_id = ?
        `,
      )
      .get(threadId)?.last_op === "delete"
  );
}

const CUSTOM_TAXONOMY_REPLAY_TAXONOMY_COLUMNS: ReadonlyArray<readonly string[]> = [
  ["id"],
  ["name"],
  ["color"],
  ["description"],
  ["is_system", "isSystem"],
  ["is_single_select", "isSingleSelect"],
  ["sort_order", "sortOrder"],
  ["created_at", "createdAt"],
  ["updated_at", "updatedAt"],
];

const CUSTOM_TAXONOMY_REPLAY_CATEGORY_COLUMNS: ReadonlyArray<readonly string[]> = [
  ["id"],
  ["taxonomy_id", "taxonomyId"],
  ["parent_id", "parentId"],
  ["name"],
  ["key"],
  ["color"],
  ["description"],
  ["sort_order", "sortOrder"],
  ["created_at", "createdAt"],
  ["updated_at", "updatedAt"],
];

function normalizeCustomTaxonomyReplayBundle(
  entityId: string,
  rawPayload: Record<string, unknown>,
): {
  taxonomy: Record<string, unknown> & { id: string; is_system: number };
  categories: Array<Record<string, unknown> & { id: string; taxonomy_id: string }>;
} {
  const taxonomy = rawPayload.taxonomy;
  const categories = rawPayload.categories;
  if (!isRecord(taxonomy) || !Array.isArray(categories) || !categories.every(isRecord)) {
    throw new ConnectServiceError("internal_error", "Invalid custom_taxonomy payload", 500);
  }
  const normalizedTaxonomy = normalizeCustomTaxonomyReplayTaxonomyRow(taxonomy);
  if (normalizedTaxonomy.id !== entityId) {
    throw new ConnectServiceError(
      "internal_error",
      `custom_taxonomy payload id '${normalizedTaxonomy.id}' does not match entity_id '${entityId}'`,
      500,
    );
  }
  return {
    taxonomy: normalizedTaxonomy,
    categories: categories.map((category) => normalizeCustomTaxonomyReplayCategoryRow(category)),
  };
}

function normalizeCustomTaxonomyReplayTaxonomyRow(
  rawPayload: Record<string, unknown>,
): Record<string, unknown> & { id: string; is_system: number } {
  const payload = normalizeCustomTaxonomyReplayRowPayload(
    "taxonomies",
    CUSTOM_TAXONOMY_REPLAY_TAXONOMY_COLUMNS,
    rawPayload,
  );
  const id = requiredStringValue(payload.id, "custom_taxonomy.taxonomy.id");
  const isSystem = requiredInteger(payload.is_system, "custom_taxonomy.taxonomy.is_system");
  return {
    id,
    name: requiredStringValue(payload.name, "custom_taxonomy.taxonomy.name"),
    color: requiredStringValue(payload.color, "custom_taxonomy.taxonomy.color"),
    description: optionalReplayStringValue(
      payload.description,
      "custom_taxonomy.taxonomy.description",
    ),
    is_system: isSystem,
    is_single_select: requiredInteger(
      payload.is_single_select,
      "custom_taxonomy.taxonomy.is_single_select",
    ),
    sort_order: requiredInteger(payload.sort_order, "custom_taxonomy.taxonomy.sort_order"),
    created_at: requiredStringValue(payload.created_at, "custom_taxonomy.taxonomy.created_at"),
    updated_at: requiredStringValue(payload.updated_at, "custom_taxonomy.taxonomy.updated_at"),
  };
}

function normalizeCustomTaxonomyReplayCategoryRow(
  rawPayload: Record<string, unknown>,
): Record<string, unknown> & { id: string; taxonomy_id: string } {
  const payload = normalizeCustomTaxonomyReplayRowPayload(
    "taxonomy_categories",
    CUSTOM_TAXONOMY_REPLAY_CATEGORY_COLUMNS,
    rawPayload,
  );
  const id = requiredStringValue(payload.id, "custom_taxonomy.category.id");
  const taxonomyId = requiredStringValue(
    payload.taxonomy_id,
    "custom_taxonomy.category.taxonomy_id",
  );
  return {
    id,
    taxonomy_id: taxonomyId,
    parent_id: optionalReplayStringValue(payload.parent_id, "custom_taxonomy.category.parent_id"),
    name: requiredStringValue(payload.name, "custom_taxonomy.category.name"),
    key: requiredStringValue(payload.key, "custom_taxonomy.category.key"),
    color: requiredStringValue(payload.color, "custom_taxonomy.category.color"),
    description: optionalReplayStringValue(
      payload.description,
      "custom_taxonomy.category.description",
    ),
    sort_order: requiredInteger(payload.sort_order, "custom_taxonomy.category.sort_order"),
    created_at: requiredStringValue(payload.created_at, "custom_taxonomy.category.created_at"),
    updated_at: requiredStringValue(payload.updated_at, "custom_taxonomy.category.updated_at"),
  };
}

function normalizeCustomTaxonomyReplayRowPayload(
  tableName: string,
  columns: ReadonlyArray<readonly string[]>,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [rawKey, value] of Object.entries(payload)) {
    const aliases = columns.find((candidate) => candidate.includes(rawKey));
    if (!aliases) {
      continue;
    }
    const column = aliases[0] ?? rawKey;
    if (Object.hasOwn(normalized, column)) {
      if (!replayJsonValuesEqual(normalized[column], value)) {
        throw new ConnectServiceError(
          "internal_error",
          `Sync payload maps multiple values to column '${column}' for table '${tableName}'`,
          500,
        );
      }
      continue;
    }
    normalized[column] = value;
  }
  return normalized;
}

function optionalReplayStringValue(value: unknown, context: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return requiredStringValue(value, context);
}

function localUpsertCustomTaxonomyCategoryReplayPayload(
  db: Database,
  entityId: string,
  payload: Record<string, unknown> & { id: string; taxonomy_id: string },
): void {
  const existing = db
    .query<{ count: number }, [string, string]>(
      `
        SELECT COUNT(*) AS count
        FROM taxonomy_categories
        WHERE taxonomy_id = ? AND id = ?
      `,
    )
    .get(entityId, payload.id);
  const entries = Object.entries(payload);
  if ((existing?.count ?? 0) > 0) {
    const updateEntries = entries.filter(([column]) => column !== "id" && column !== "taxonomy_id");
    if (updateEntries.length === 0) {
      return;
    }
    db.prepare(
      `
        UPDATE taxonomy_categories
        SET ${updateEntries.map(([column]) => `${quoteReplayIdentifier(column)} = ?`).join(", ")}
        WHERE taxonomy_id = ? AND id = ?
      `,
    ).run(...updateEntries.map(([, value]) => replayValueToSqlite(value)), entityId, payload.id);
    return;
  }
  const columns = entries.map(([column]) => quoteReplayIdentifier(column)).join(", ");
  const placeholders = entries.map(() => "?").join(", ");
  db.prepare(
    `
      INSERT INTO taxonomy_categories (${columns})
      VALUES (${placeholders})
    `,
  ).run(...entries.map(([, value]) => replayValueToSqlite(value)));
}

function validateGoalReplayPayloadFields(payload: Record<string, unknown>): void {
  validateReplayFiniteNumberIfPresent(payload, "target_amount", "goal.target_amount");
  validateReplayIntegerIfPresent(payload, "priority", "goal.priority");
  validateReplayFiniteNumberIfPresent(
    payload,
    "summary_current_value",
    "goal.summary_current_value",
  );
  validateReplayFiniteNumberIfPresent(payload, "summary_progress", "goal.summary_progress");
  validateReplayFiniteNumberIfPresent(
    payload,
    "projected_value_at_target_date",
    "goal.projected_value_at_target_date",
  );
  validateReplayFiniteNumberIfPresent(
    payload,
    "summary_target_amount",
    "goal.summary_target_amount",
  );
}

function validateGoalPlanReplayPayloadFields(payload: Record<string, unknown>): void {
  validateReplayIntegerIfPresent(payload, "version", "goal_plan.version");
}

function validateGoalsAllocationReplayPayloadFields(payload: Record<string, unknown>): void {
  validateReplayFiniteNumberIfPresent(payload, "share_percent", "goals_allocation.share_percent");
}

function validateImportTemplateReplayPayloadFields(payload: Record<string, unknown>): void {
  validateReplayIntegerIfPresent(payload, "config_version", "import_template.config_version");
}

function validateActivityReplayPayloadFields(payload: Record<string, unknown>): void {
  validateReplayIntegerIfPresent(payload, "is_user_modified", "activity.is_user_modified");
  validateReplayIntegerIfPresent(payload, "needs_review", "activity.needs_review");
}

function validateAssetTaxonomyAssignmentReplayPayloadFields(
  payload: Record<string, unknown>,
): void {
  validateReplayIntegerIfPresent(payload, "weight", "asset_taxonomy_assignment.weight");
}

function validateAssetReplayPayloadFields(payload: Record<string, unknown>): void {
  validateReplayIntegerIfPresent(payload, "is_active", "asset.is_active");
}

function validateReplayFiniteNumberIfPresent(
  payload: Record<string, unknown>,
  column: string,
  context: string,
): void {
  if (Object.hasOwn(payload, column)) {
    requiredFiniteNumber(payload[column], context);
  }
}

function validateReplayIntegerIfPresent(
  payload: Record<string, unknown>,
  column: string,
  context: string,
): void {
  if (Object.hasOwn(payload, column)) {
    requiredInteger(payload[column], context);
  }
}

function localUpsertReplayPayloadFields(
  db: Database,
  tableName: string,
  pkColumn: string,
  entityId: string,
  payload: Record<string, unknown>,
): void {
  const fields = { ...payload };
  if (Object.hasOwn(fields, pkColumn)) {
    const pkValue = fields[pkColumn];
    if (!replayPayloadValueMatchesEntityId(pkValue, entityId)) {
      throw new ConnectServiceError(
        "internal_error",
        `Sync payload PK '${pkColumn}' does not match entity_id '${entityId}'`,
        500,
      );
    }
  } else {
    fields[pkColumn] = entityId;
  }
  const existing = db
    .query<{ count: number }, [string]>(
      `
        SELECT COUNT(*) AS count
        FROM ${quoteReplayIdentifier(tableName)}
        WHERE ${quoteReplayIdentifier(pkColumn)} = ?
      `,
    )
    .get(entityId);
  const entries = Object.entries(fields);
  if ((existing?.count ?? 0) > 0) {
    const updateEntries = entries.filter(([column]) => column !== pkColumn);
    if (updateEntries.length === 0) {
      return;
    }
    const assignments = updateEntries
      .map(([column]) => `${quoteReplayIdentifier(column)} = ?`)
      .join(", ");
    db.prepare(
      `
        UPDATE ${quoteReplayIdentifier(tableName)}
        SET ${assignments}
        WHERE ${quoteReplayIdentifier(pkColumn)} = ?
      `,
    ).run(...updateEntries.map(([, value]) => replayValueToSqlite(value)), entityId);
    return;
  }
  const columns = entries.map(([column]) => quoteReplayIdentifier(column)).join(", ");
  const placeholders = entries.map(() => "?").join(", ");
  db.prepare(
    `
      INSERT INTO ${quoteReplayIdentifier(tableName)} (${columns})
      VALUES (${placeholders})
    `,
  ).run(...entries.map(([, value]) => replayValueToSqlite(value)));
}

function localUpsertNaturalKeyedReplayPayloadFields(
  db: Database,
  options: {
    tableName: string;
    pkColumn: string;
    entityId: string;
    payload: Record<string, unknown>;
    naturalKeyColumns: string[];
    preserveCanonicalColumns: string[];
  },
): void {
  const naturalKeyValues = options.naturalKeyColumns.map((column) => options.payload[column]);
  if (naturalKeyValues.every((value) => value !== undefined && value !== null)) {
    const duplicate = db
      .query<{ id: string }, [...Array<string | number | null>, string]>(
        `
          SELECT ${quoteReplayIdentifier(options.pkColumn)} AS id
          FROM ${quoteReplayIdentifier(options.tableName)}
          WHERE ${options.naturalKeyColumns
            .map((column) => `${quoteReplayIdentifier(column)} = ?`)
            .join(" AND ")}
            AND ${quoteReplayIdentifier(options.pkColumn)} <> ?
        `,
      )
      .get(...naturalKeyValues.map((value) => replayValueToSqlite(value)), options.entityId);
    if (duplicate) {
      localMergeNaturalKeyedReplayDuplicate(db, options, duplicate.id);
      return;
    }
  }
  localUpsertReplayPayloadFields(
    db,
    options.tableName,
    options.pkColumn,
    options.entityId,
    options.payload,
  );
}

function localMergeNaturalKeyedReplayDuplicate(
  db: Database,
  options: {
    tableName: string;
    pkColumn: string;
    entityId: string;
    payload: Record<string, unknown>;
    preserveCanonicalColumns: string[];
  },
  duplicateId: string,
): void {
  const canonicalId = duplicateId > options.entityId ? duplicateId : options.entityId;
  const assignments: string[] = [];
  const values: Array<string | number | null> = [];
  if (duplicateId !== canonicalId) {
    assignments.push(`${quoteReplayIdentifier(options.pkColumn)} = ?`);
    values.push(canonicalId);
  }
  for (const [column, value] of Object.entries(options.payload)) {
    if (column === options.pkColumn) {
      continue;
    }
    if (duplicateId === canonicalId && options.preserveCanonicalColumns.includes(column)) {
      continue;
    }
    assignments.push(`${quoteReplayIdentifier(column)} = ?`);
    values.push(replayValueToSqlite(value));
  }
  if (assignments.length === 0) {
    return;
  }
  values.push(duplicateId);
  db.prepare(
    `
      UPDATE ${quoteReplayIdentifier(options.tableName)}
      SET ${assignments.join(", ")}
      WHERE ${quoteReplayIdentifier(options.pkColumn)} = ?
    `,
  ).run(...values);
  if (duplicateId !== canonicalId) {
    db.prepare(
      `
        DELETE FROM sync_entity_metadata
        WHERE entity = 'asset_taxonomy_assignment' AND entity_id = ?
      `,
    ).run(duplicateId);
  }
}

function replayPayloadValueMatchesEntityId(value: unknown, entityId: string): boolean {
  if (typeof value === "string") {
    return value === entityId;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value) === entityId;
  }
  return false;
}

function replayValueToSqlite(value: unknown): string | number | null {
  if (value === null) {
    return null;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (typeof value === "string" || typeof value === "number") {
    return value;
  }
  return JSON.stringify(value);
}

function quoteReplayIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function requiredReplayString(value: unknown, context: string): string {
  const parsed = optionalString(value);
  if (parsed === null) {
    throw new ConnectServiceError("internal_error", `Failed to parse ${context}`, 500);
  }
  return parsed;
}

function replayBooleanToInteger(value: unknown, defaultValue = false): number {
  if (value === undefined || value === null) {
    return defaultValue ? 1 : 0;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (value === 0 || value === 1) {
    return value;
  }
  throw new ConnectServiceError("internal_error", "Failed to parse account replay payload", 500);
}

function replayOptionalTextValue(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

const REPLAY_ENTITY_TABLE_NAMES: Record<LocalReplayEntity, string> = {
  account: "accounts",
  platform: "platforms",
  portfolio: "portfolios",
  portfolio_account: "portfolio_accounts",
  contribution_limit: "contribution_limits",
  custom_provider: "market_data_custom_providers",
  custom_taxonomy: "taxonomies",
  goal: "goals",
  goal_plan: "goal_plans",
  goals_allocation: "goals_allocation",
  import_template: "import_templates",
  activity: "activities",
  activity_import_profile: "import_account_templates",
  import_run: "import_runs",
  ai_thread: "ai_threads",
  ai_message: "ai_messages",
  ai_thread_tag: "ai_thread_tags",
  asset_taxonomy_assignment: "asset_taxonomy_assignments",
  quote: "quotes",
  snapshot: "holdings_snapshots",
  asset: "assets",
};

const REPLAY_PAYLOAD_COLUMNS: Record<LocalReplayEntity, ReadonlyArray<readonly string[]>> = {
  account: [
    ["id"],
    ["name"],
    ["account_type", "accountType"],
    ["group"],
    ["currency"],
    ["is_default", "isDefault"],
    ["is_active", "isActive"],
    ["created_at", "createdAt"],
    ["updated_at", "updatedAt"],
    ["platform_id", "platformId"],
    ["account_number", "accountNumber"],
    ["meta"],
    ["provider"],
    ["provider_account_id", "providerAccountId"],
    ["is_archived", "isArchived"],
    ["tracking_mode", "trackingMode"],
  ],
  platform: [
    ["id"],
    ["name"],
    ["url"],
    ["external_id", "externalId"],
    ["kind"],
    ["website_url", "websiteUrl"],
    ["logo_url", "logoUrl"],
  ],
  portfolio: [
    ["id"],
    ["name"],
    ["description"],
    ["sort_order", "sortOrder"],
    ["created_at", "createdAt"],
    ["updated_at", "updatedAt"],
  ],
  portfolio_account: [
    ["id"],
    ["portfolio_id", "portfolioId"],
    ["account_id", "accountId"],
    ["sort_order", "sortOrder"],
    ["created_at", "createdAt"],
  ],
  contribution_limit: [
    ["id"],
    ["group_name", "groupName"],
    ["contribution_year", "contributionYear"],
    ["limit_amount", "limitAmount"],
    ["account_ids", "accountIds"],
    ["created_at", "createdAt"],
    ["updated_at", "updatedAt"],
    ["start_date", "startDate"],
    ["end_date", "endDate"],
  ],
  custom_provider: [
    ["id"],
    ["code"],
    ["name"],
    ["description"],
    ["enabled"],
    ["priority"],
    ["config"],
    ["created_at", "createdAt"],
    ["updated_at", "updatedAt"],
  ],
  custom_taxonomy: [["id"], ["taxonomy"], ["categories"]],
  goal: [
    ["id"],
    ["title"],
    ["description"],
    ["target_amount", "targetAmount"],
    ["goal_type", "goalType"],
    ["status_lifecycle", "statusLifecycle", "is_achieved", "isAchieved"],
    ["status_health", "statusHealth"],
    ["priority"],
    ["cover_image_key", "coverImageKey"],
    ["currency"],
    ["start_date", "startDate"],
    ["target_date", "targetDate"],
    ["summary_current_value", "summaryCurrentValue"],
    ["summary_progress", "summaryProgress"],
    ["projected_completion_date", "projectedCompletionDate"],
    ["projected_value_at_target_date", "projectedValueAtTargetDate"],
    ["created_at", "createdAt"],
    ["updated_at", "updatedAt"],
    ["summary_target_amount", "summaryTargetAmount"],
  ],
  goal_plan: [
    ["goal_id", "goalId"],
    ["plan_kind", "planKind"],
    ["planner_mode", "plannerMode"],
    ["settings_json", "settingsJson"],
    ["summary_json", "summaryJson"],
    ["version"],
    ["created_at", "createdAt"],
    ["updated_at", "updatedAt"],
  ],
  goals_allocation: [
    ["id"],
    ["goal_id", "goalId"],
    ["account_id", "accountId"],
    ["share_percent", "sharePercent", "percent_allocation", "percentAllocation"],
    ["tax_bucket", "taxBucket"],
    ["created_at", "createdAt"],
    ["updated_at", "updatedAt"],
  ],
  import_template: [
    ["id"],
    ["name"],
    ["scope"],
    ["kind"],
    ["source_system", "sourceSystem"],
    ["config_version", "configVersion"],
    ["config"],
    ["created_at", "createdAt"],
    ["updated_at", "updatedAt"],
  ],
  activity: [
    ["id"],
    ["account_id", "accountId"],
    ["asset_id", "assetId"],
    ["activity_type", "activityType"],
    ["activity_type_override", "activityTypeOverride"],
    ["source_type", "sourceType"],
    ["subtype"],
    ["status"],
    ["activity_date", "activityDate"],
    ["settlement_date", "settlementDate"],
    ["quantity"],
    ["unit_price", "unitPrice"],
    ["amount"],
    ["fee"],
    ["currency"],
    ["fx_rate", "fxRate"],
    ["notes"],
    ["metadata"],
    ["source_system", "sourceSystem"],
    ["source_record_id", "sourceRecordId"],
    ["source_group_id", "sourceGroupId"],
    ["idempotency_key", "idempotencyKey"],
    ["import_run_id", "importRunId"],
    ["is_user_modified", "isUserModified"],
    ["needs_review", "needsReview"],
    ["created_at", "createdAt"],
    ["updated_at", "updatedAt"],
  ],
  activity_import_profile: [
    ["id"],
    ["account_id", "accountId"],
    ["context_kind", "contextKind", "import_type", "importType"],
    ["source_system", "sourceSystem"],
    ["template_id", "templateId"],
    ["created_at", "createdAt"],
    ["updated_at", "updatedAt"],
  ],
  import_run: [
    ["id"],
    ["account_id", "accountId"],
    ["source_system", "sourceSystem"],
    ["run_type", "runType"],
    ["mode"],
    ["status"],
    ["started_at", "startedAt"],
    ["finished_at", "finishedAt"],
    ["review_mode", "reviewMode"],
    ["applied_at", "appliedAt"],
    ["checkpoint_in", "checkpointIn"],
    ["checkpoint_out", "checkpointOut"],
    ["summary"],
    ["warnings"],
    ["error"],
    ["created_at", "createdAt"],
    ["updated_at", "updatedAt"],
  ],
  ai_thread: [
    ["id"],
    ["title"],
    ["config_snapshot", "configSnapshot"],
    ["is_pinned", "isPinned"],
    ["created_at", "createdAt"],
    ["updated_at", "updatedAt"],
  ],
  ai_message: [
    ["id"],
    ["thread_id", "threadId"],
    ["role"],
    ["content_json", "contentJson"],
    ["created_at", "createdAt"],
  ],
  ai_thread_tag: [["id"], ["thread_id", "threadId"], ["tag"], ["created_at", "createdAt"]],
  asset_taxonomy_assignment: [
    ["id"],
    ["asset_id", "assetId"],
    ["taxonomy_id", "taxonomyId"],
    ["category_id", "categoryId"],
    ["weight"],
    ["source"],
    ["created_at", "createdAt"],
    ["updated_at", "updatedAt"],
  ],
  quote: [
    ["id"],
    ["asset_id", "assetId"],
    ["day"],
    ["source"],
    ["open"],
    ["high"],
    ["low"],
    ["close"],
    ["adjclose"],
    ["volume"],
    ["currency"],
    ["notes"],
    ["created_at", "createdAt"],
    ["timestamp"],
  ],
  snapshot: [
    ["id"],
    ["account_id", "accountId"],
    ["snapshot_date", "snapshotDate"],
    ["currency"],
    ["positions"],
    ["cash_balances", "cashBalances"],
    ["cost_basis", "costBasis"],
    ["net_contribution", "netContribution"],
    ["calculated_at", "calculatedAt"],
    ["net_contribution_base", "netContributionBase"],
    ["cash_total_account_currency", "cashTotalAccountCurrency"],
    ["cash_total_base_currency", "cashTotalBaseCurrency"],
    ["source"],
  ],
  asset: [
    ["id"],
    ["kind"],
    ["name"],
    ["display_code", "displayCode"],
    ["notes"],
    ["metadata"],
    ["is_active", "isActive"],
    ["quote_mode", "quoteMode"],
    ["quote_ccy", "quoteCcy"],
    ["instrument_type", "instrumentType"],
    ["instrument_symbol", "instrumentSymbol"],
    ["instrument_exchange_mic", "instrumentExchangeMic"],
    ["instrument_key", "instrumentKey"],
    ["provider_config", "providerConfig"],
    ["created_at", "createdAt"],
    ["updated_at", "updatedAt"],
  ],
};

const REPLAY_READONLY_PAYLOAD_COLUMNS: Partial<Record<LocalReplayEntity, ReadonlySet<string>>> = {
  asset: new Set(["instrument_key"]),
};

function normalizeReplayPayload(
  entity: LocalReplayEntity,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  const tableName = REPLAY_ENTITY_TABLE_NAMES[entity];
  for (const [rawKey, value] of Object.entries(payload)) {
    const column = replayPayloadColumnForKey(entity, rawKey);
    if (column === null) {
      throw new ConnectServiceError(
        "internal_error",
        `Sync payload column '${rawKey}' is not valid for table '${tableName}'`,
        500,
      );
    }
    if (REPLAY_READONLY_PAYLOAD_COLUMNS[entity]?.has(column)) {
      continue;
    }
    const migratedValue = migrateReplayPayloadValue(entity, column, value);
    if (Object.hasOwn(normalized, column)) {
      if (!replayJsonValuesEqual(normalized[column], migratedValue)) {
        throw new ConnectServiceError(
          "internal_error",
          `Sync payload maps multiple values to column '${column}' for table '${tableName}'`,
          500,
        );
      }
      continue;
    }
    normalized[column] = migratedValue;
  }
  return normalized;
}

function replayPayloadColumnForKey(entity: LocalReplayEntity, rawKey: string): string | null {
  for (const aliases of REPLAY_PAYLOAD_COLUMNS[entity]) {
    if (aliases.includes(rawKey)) {
      return aliases[0] ?? rawKey;
    }
  }
  return null;
}

function replayJsonValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(replayJsonComparable(left)) === JSON.stringify(replayJsonComparable(right));
}

function migrateReplayPayloadValue(
  entity: LocalReplayEntity,
  column: string,
  value: unknown,
): unknown {
  if (entity !== "goal" || column !== "status_lifecycle") {
    if (entity === "activity_import_profile" && column === "context_kind") {
      return migrateReplayContextKindValue(value);
    }
    return value;
  }
  if (value === true || value === 1) {
    return "achieved";
  }
  if (value === false || value === 0 || value === null) {
    return "active";
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") {
      return "achieved";
    }
    if (normalized === "false" || normalized === "0") {
      return "active";
    }
  }
  return value;
}

function migrateReplayContextKindValue(value: unknown): unknown {
  if (value === "ACTIVITY") {
    return "CSV_ACTIVITY";
  }
  if (value === "HOLDINGS") {
    return "CSV_HOLDINGS";
  }
  return value;
}

function replayJsonComparable(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => replayJsonComparable(entry));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, entry]) => [key, replayJsonComparable(entry)]),
    );
  }
  return value;
}

function localShouldApplyLww(
  localClientTimestamp: string,
  localEventId: string,
  remoteClientTimestamp: string,
  remoteEventId: string,
): boolean {
  const localTime = Date.parse(localClientTimestamp);
  const remoteTime = Date.parse(remoteClientTimestamp);
  if (!Number.isNaN(localTime) && !Number.isNaN(remoteTime)) {
    if (remoteTime > localTime) {
      return true;
    }
    if (remoteTime === localTime) {
      return remoteEventId > localEventId;
    }
    return false;
  }
  if (remoteClientTimestamp > localClientTimestamp) {
    return true;
  }
  if (remoteClientTimestamp === localClientTimestamp) {
    return remoteEventId > localEventId;
  }
  return false;
}

function localUpsertSyncEntityMetadata(
  db: Database,
  entity: string,
  entityId: string,
  eventId: string,
  clientTimestamp: string,
  operation: string,
  seq: number,
): void {
  db.prepare(
    `
      INSERT INTO sync_entity_metadata (
        entity, entity_id, last_event_id, last_client_timestamp, last_op, last_seq
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(entity, entity_id) DO UPDATE SET
        last_event_id = excluded.last_event_id,
        last_client_timestamp = excluded.last_client_timestamp,
        last_op = excluded.last_op,
        last_seq = excluded.last_seq
    `,
  ).run(entity, entityId, eventId, clientTimestamp, operation, seq);
}

function localInsertSyncAppliedEvent(
  db: Database,
  eventId: string,
  seq: number,
  entity: string,
  entityId: string,
): void {
  db.prepare(
    `
      INSERT INTO sync_applied_events (event_id, seq, entity, entity_id, applied_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(event_id) DO NOTHING
    `,
  ).run(eventId, seq, entity, entityId, new Date().toISOString());
}

function localMarkReplayTableState(
  db: Database,
  tableName:
    | "accounts"
    | "platforms"
    | "portfolios"
    | "portfolio_accounts"
    | "contribution_limits"
    | "market_data_custom_providers"
    | "taxonomies"
    | "taxonomy_categories"
    | "goals"
    | "goal_plans"
    | "goals_allocation"
    | "import_templates"
    | "activities"
    | "import_account_templates"
    | "import_runs"
    | "ai_threads"
    | "ai_messages"
    | "ai_thread_tags"
    | "asset_taxonomy_assignments"
    | "quotes"
    | "holdings_snapshots"
    | "assets",
): void {
  db.prepare(
    `
      INSERT INTO sync_table_state (table_name, enabled, last_incremental_apply_at)
      VALUES (?, 1, ?)
      ON CONFLICT(table_name) DO UPDATE SET
        enabled = 1,
        last_incremental_apply_at = excluded.last_incremental_apply_at
    `,
  ).run(tableName, new Date().toISOString());
}

function localSetSyncCursor(db: Database, cursor: number): void {
  const now = new Date().toISOString();
  db.prepare(
    `
      INSERT INTO sync_cursor (id, cursor, updated_at)
      VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        cursor = excluded.cursor,
        updated_at = excluded.updated_at
    `,
  ).run(cursor, now);
}

function localMarkPullCompleted(db: Database): void {
  const now = new Date().toISOString();
  db.prepare(
    `
      INSERT INTO sync_engine_state (
        id, last_pull_at, last_error, consecutive_failures, next_retry_at
      )
      VALUES (1, ?, NULL, 0, NULL)
      ON CONFLICT(id) DO UPDATE SET
        last_pull_at = excluded.last_pull_at,
        last_error = NULL,
        consecutive_failures = 0,
        next_retry_at = NULL
    `,
  ).run(now);
}

function parseDeviceSyncApiError(
  bodyText: string,
): { code: string | null; details: unknown } | null {
  const trimmed = bodyText.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!isRecord(parsed) || !validDeviceSyncApiErrorResponseShape(trimmed, parsed)) {
      return null;
    }
    return {
      code: optionalString(parsed.code) ?? optionalString(parsed.error),
      details: parsed.details,
    };
  } catch {
    return null;
  }
}

function localBootstrapHintsFromErrorDetails(details: unknown): {
  snapshotId: string | null;
  snapshotSeq: number | null;
} {
  if (!isRecord(details)) {
    return { snapshotId: null, snapshotSeq: null };
  }
  const snapshotId = optionalString(details.latestSnapshotId);
  const snapshotSeqValue = details.latestSnapshotSeq;
  const snapshotSeq =
    typeof snapshotSeqValue === "number" &&
    Number.isSafeInteger(snapshotSeqValue) &&
    snapshotSeqValue >= 0
      ? snapshotSeqValue
      : null;
  return { snapshotId, snapshotSeq };
}

function requiredSafeI64FromRawJson(text: string, aliases: string[], context: string): number {
  const tokens = rawTokensForAliases(text, aliases);
  if (tokens.length !== 1 || !rawJsonSafeI64TokenIsValid(tokens[0] ?? "")) {
    throw new ConnectServiceError("internal_error", `Failed to parse ${context}`, 500);
  }
  return Number(tokens[0]!.trim());
}

function optionalSafeI64FromRawJson(
  text: string,
  aliases: string[],
  context: string,
): number | null {
  const tokens = rawTokensForAliases(text, aliases);
  if (tokens.length === 0) {
    return null;
  }
  const token = tokens[0] ?? "";
  if (tokens.length !== 1) {
    throw new ConnectServiceError("internal_error", `Failed to parse ${context}`, 500);
  }
  if (token.trim() === "null") {
    return null;
  }
  if (!rawJsonSafeI64TokenIsValid(token)) {
    throw new ConnectServiceError("internal_error", `Failed to parse ${context}`, 500);
  }
  return Number(token.trim());
}

function rawJsonSafeI64TokenIsValid(token: string): boolean {
  const trimmed = token.trim();
  if (!rawJsonI64TokenIsValid(trimmed)) {
    return false;
  }
  const parsed = BigInt(trimmed);
  return parsed >= BigInt(Number.MIN_SAFE_INTEGER) && parsed <= BigInt(Number.MAX_SAFE_INTEGER);
}

function markLocalSyncCycleError(db: Database, status: string, message: string): void {
  markLocalSyncCycleOutcome(db, status, message);
}

function markLocalSyncCycleOutcome(
  db: Database,
  status: string,
  lastError: string | null = null,
  nextRetryAt: string | null = null,
): void {
  const durationMs = 0;
  db.prepare(
    `
      INSERT INTO sync_engine_state (
        id, lock_version, last_error, consecutive_failures, next_retry_at,
        last_cycle_status, last_cycle_duration_ms
      )
      VALUES (1, 0, ?, 0, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        last_error = CASE
          WHEN excluded.last_error IS NOT NULL OR excluded.last_cycle_status = 'ok'
            THEN excluded.last_error
          ELSE last_error
        END,
        consecutive_failures = CASE
          WHEN excluded.last_cycle_status = 'ok' THEN 0
          ELSE consecutive_failures
        END,
        next_retry_at = excluded.next_retry_at,
        last_cycle_status = excluded.last_cycle_status,
        last_cycle_duration_ms = excluded.last_cycle_duration_ms
    `,
  ).run(lastError, nextRetryAt, status, durationMs);
}

function localWaitSnapshotRetryAt(): string {
  return new Date(Date.now() + 30_000).toISOString();
}

function localReconcileCursorOrDefault(reconcile: LocalReconcileReadyState): number {
  return reconcile.cursor ?? 0;
}

function rawJsonI64OptionTokenIsValid(token: string): boolean {
  const trimmed = token.trim();
  return trimmed === "null" || rawJsonI64TokenIsValid(trimmed);
}

function rawJsonI32OptionTokenIsValid(token: string): boolean {
  const trimmed = token.trim();
  return trimmed === "null" || rawJsonI32TokenIsValid(trimmed);
}

function rawJsonI64TokenIsValid(token: string): boolean {
  const trimmed = token.trim();
  if (!/^-?(?:0|[1-9]\d*)$/.test(trimmed)) {
    return false;
  }
  const parsed = BigInt(trimmed);
  return parsed >= -9_223_372_036_854_775_808n && parsed <= 9_223_372_036_854_775_807n;
}

function rawJsonI32TokenIsValid(token: string): boolean {
  const trimmed = token.trim();
  return /^-?(?:0|[1-9]\d*)$/.test(trimmed) && isI32Integer(Number(trimmed));
}

function rawJsonPlanLimitTokenIsValid(token: string): boolean {
  const trimmed = token.trim();
  return rawJsonStringTokenIsValid(trimmed) || rawJsonI32TokenIsValid(trimmed);
}

function rawJsonStringTokenIsValid(token: string): boolean {
  return token.trim().startsWith('"');
}

function rawTokensForAliases(text: string, aliases: string[]): string[] {
  return aliases.flatMap((alias) => topLevelJsonPropertyRawTokens(text, alias));
}

function parseLocalReconcileLatestSnapshot(
  value: unknown,
  rawToken: string | undefined,
): { snapshotId: string | null; oplogSeq: I64Value | null; invalid: boolean } {
  if (value === undefined || value === null) {
    return { snapshotId: null, oplogSeq: null, invalid: false };
  }
  if (!isRecord(value) || rawToken === undefined || rawToken.trim() === "null") {
    return { snapshotId: null, oplogSeq: null, invalid: true };
  }
  const snapshotIdValue = value.snapshotId ?? value.snapshot_id;
  const schemaVersionValue = value.schemaVersion ?? value.schema_version;
  const snapshotIdRawTokens = [
    ...topLevelJsonPropertyRawTokens(rawToken, "snapshotId"),
    ...topLevelJsonPropertyRawTokens(rawToken, "snapshot_id"),
  ];
  const schemaVersionRawTokens = [
    ...topLevelJsonPropertyRawTokens(rawToken, "schemaVersion"),
    ...topLevelJsonPropertyRawTokens(rawToken, "schema_version"),
  ];
  const oplogSeqRawTokens = [
    ...topLevelJsonPropertyRawTokens(rawToken, "oplogSeq"),
    ...topLevelJsonPropertyRawTokens(rawToken, "oplog_seq"),
  ];
  const snapshotIdRawToken = snapshotIdRawTokens[0];
  const schemaVersionRawToken = schemaVersionRawTokens[0];
  const oplogSeqRawToken = oplogSeqRawTokens[0];
  const snapshotId = typeof snapshotIdValue === "string" ? snapshotIdValue : null;
  const schemaVersion = isI32Integer(schemaVersionValue) ? schemaVersionValue : null;
  const oplogSeq = oplogSeqRawToken === undefined ? null : i64FromRawToken(oplogSeqRawToken);
  const invalid =
    snapshotId === null ||
    schemaVersion === null ||
    oplogSeq === null ||
    snapshotIdRawTokens.length !== 1 ||
    schemaVersionRawTokens.length !== 1 ||
    oplogSeqRawTokens.length !== 1 ||
    snapshotIdRawToken === undefined ||
    schemaVersionRawToken === undefined ||
    oplogSeqRawToken === undefined ||
    !rawJsonStringTokenIsValid(snapshotIdRawToken) ||
    !rawJsonI32TokenIsValid(schemaVersionRawToken) ||
    !rawJsonI64TokenIsValid(oplogSeqRawToken);
  return { snapshotId, oplogSeq, invalid };
}

function topLevelJsonPropertyRawTokens(text: string, property: string): string[] {
  let index = 0;
  const tokens: string[] = [];
  const skipWhitespace = () => {
    while (index < text.length && /\s/.test(text[index] ?? "")) {
      index += 1;
    }
  };
  const readStringToken = (): string | null => {
    const start = index;
    index += 1;
    let escaped = false;
    while (index < text.length) {
      const char = text[index];
      index += 1;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        return text.slice(start, index);
      }
    }
    return null;
  };
  const readValueToken = (): string => {
    const start = index;
    if (text[index] === '"') {
      readStringToken();
      return text.slice(start, index);
    }
    let depth = 0;
    let inString = false;
    let escaped = false;
    while (index < text.length) {
      const char = text[index];
      if (inString) {
        index += 1;
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }
      if (char === '"') {
        inString = true;
        index += 1;
        continue;
      }
      if (char === "{" || char === "[") {
        depth += 1;
        index += 1;
        continue;
      }
      if (char === "}" || char === "]") {
        if (depth === 0) {
          break;
        }
        depth -= 1;
        index += 1;
        continue;
      }
      if (depth === 0 && char === ",") {
        break;
      }
      index += 1;
    }
    return text.slice(start, index).trim();
  };

  skipWhitespace();
  if (text[index] !== "{") {
    return tokens;
  }
  index += 1;
  while (index < text.length) {
    skipWhitespace();
    if (text[index] === "}") {
      return tokens;
    }
    if (text[index] !== '"') {
      return tokens;
    }
    const keyToken = readStringToken();
    if (keyToken === null) {
      return tokens;
    }
    skipWhitespace();
    if (text[index] !== ":") {
      return tokens;
    }
    index += 1;
    skipWhitespace();
    if (JSON.parse(keyToken) === property) {
      tokens.push(readValueToken());
    } else {
      readValueToken();
    }
    skipWhitespace();
    if (text[index] === ",") {
      index += 1;
    }
  }
  return tokens;
}

function localAcquireSyncCycleLock(db: Database): number {
  const current =
    db
      .query<
        { lock_version: number },
        []
      >("SELECT lock_version FROM sync_engine_state WHERE id = 1")
      .get()?.lock_version ?? 0;
  const next = current + 1;
  db.prepare(
    `
      INSERT INTO sync_engine_state (
        id, lock_version, last_error, consecutive_failures, next_retry_at,
        last_cycle_status, last_cycle_duration_ms
      )
      VALUES (1, ?, NULL, 0, NULL, NULL, NULL)
      ON CONFLICT(id) DO UPDATE SET
        lock_version = excluded.lock_version
    `,
  ).run(next);
  return next;
}

function localHasPendingSyncOutbox(db: Database): boolean {
  if (!sqliteTableExists(db, "sync_outbox")) {
    return false;
  }
  if (
    sqliteColumnExists(db, "sync_outbox", "status") &&
    sqliteColumnExists(db, "sync_outbox", "sent") &&
    sqliteColumnExists(db, "sync_outbox", "next_retry_at")
  ) {
    const now = new Date().toISOString();
    return (
      (db
        .query<{ count: number }, [string]>(
          `
            SELECT COUNT(*) AS count
            FROM sync_outbox
            WHERE status = 'pending'
              AND sent = 0
              AND (next_retry_at IS NULL OR next_retry_at <= ?)
          `,
        )
        .get(now)?.count ?? 0) > 0
    );
  }
  return (
    (db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM sync_outbox").get()?.count ??
      0) > 0
  );
}

function sqliteTableExists(db: Database, tableName: string): boolean {
  return (
    db
      .query<
        { name: string },
        [string]
      >("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName) !== null
  );
}

function sqliteColumnExists(db: Database, tableName: string, columnName: string): boolean {
  if (!sqliteTableExists(db, tableName)) {
    return false;
  }
  return db
    .query<{ name: string }, [string]>("SELECT name FROM pragma_table_info(?)")
    .all(tableName)
    .some((column) => column.name === columnName);
}

function deviceSyncDisabled(): ConnectNotImplementedError {
  return new ConnectNotImplementedError(DEVICE_SYNC_DISABLED_MESSAGE);
}
