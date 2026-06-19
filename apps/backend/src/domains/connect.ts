import { createHash, randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";

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
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
}

export interface LocalConnectDeviceSyncServiceDependencies {
  db: Database;
  secretService?: SecretService;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  restoreSyncSession?: () => Promise<unknown> | unknown;
  appVersion?: string;
  deviceDisplayName?: string;
  platform?: string;
  reinitializeDelayMs?: number;
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
  "Broker sync profile persistence is not yet available in the TS backend runtime";
const BROKER_ACTIVITY_MAX_PAGES = 10_000;
const CLOUD_REFRESH_TOKEN_KEY = "sync_refresh_token";
const CLOUD_ACCESS_TOKEN_KEY = "sync_access_token";
const DEVICE_SYNC_IDENTITY_KEY = "sync_identity";
const DEVICE_SYNC_DEVICE_ID_KEY = "sync_device_id";
const DEFAULT_CONNECT_AUTH_URL = "https://auth.wealthfolio.app";
const DEFAULT_CONNECT_AUTH_PUBLISHABLE_KEY = "sb_publishable_ZSZbXNtWtnh9i2nqJ2UL4A_NV8ZVutd";
const DEFAULT_CONNECT_API_URL = "https://api.wealthfolio.app";
const DEVICE_ENROLL_DISPLAY_NAME = "Wealthfolio Server";
const RESET_REASON_REINITIALIZE = "reinitialize";

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
      return await syncBrokerDataBounded(this);
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
      return plansResponseFromApi(
        await fetchAuthenticatedConnectJson(
          restoreSession,
          env,
          fetchImpl,
          "/api/v1/subscription/plans",
        ),
      );
    },
    async getUserInfo() {
      return userInfoFromApi(
        await fetchAuthenticatedConnectJson(restoreSession, env, fetchImpl, "/api/v1/user/me"),
      );
    },
    async listBrokerConnections() {
      return brokerConnectionsFromApi(
        await fetchAuthenticatedConnectJson(
          restoreSession,
          env,
          fetchImpl,
          "/api/v1/sync/brokerage/connections",
        ),
      );
    },
    async listBrokerAccounts() {
      return brokerAccountsFromApi(
        await fetchAuthenticatedConnectJson(
          restoreSession,
          env,
          fetchImpl,
          "/api/v1/sync/brokerage/accounts",
        ),
      );
    },
    async syncBrokerData() {
      try {
        if (!(await hasBrokerSyncEntitlement(restoreSession, env, fetchImpl))) {
          return { status: "forbidden" };
        }
      } catch {
        return { status: "forbidden" };
      }
      return await syncBrokerDataBounded(this);
    },
    async syncBrokerConnections() {
      const connections = brokerConnectionsFromApi(
        await fetchAuthenticatedConnectJson(
          restoreSession,
          env,
          fetchImpl,
          "/api/v1/sync/brokerage/connections",
        ),
      );
      return syncBrokerConnectionsToPlatforms(db, connections);
    },
    async syncBrokerAccounts() {
      const accounts = brokerAccountsFromApi(
        await fetchAuthenticatedConnectJson(
          restoreSession,
          env,
          fetchImpl,
          "/api/v1/sync/brokerage/accounts",
        ),
      );
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
    return plansResponseFromApi(parsed);
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

async function fetchAuthenticatedConnectJson(
  restoreSession: () => Promise<{ accessToken: string; refreshToken: string }>,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  path: string,
): Promise<unknown> {
  const { accessToken } = await restoreSession();
  return await fetchConnectJsonWithAccessToken(accessToken, env, fetchImpl, path);
}

async function fetchConnectJsonWithAccessToken(
  accessToken: string,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  path: string,
): Promise<unknown> {
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
    return JSON.parse(bodyText) as unknown;
  } catch (error) {
    throw new ConnectServiceError(
      "internal_error",
      `Failed to parse response: ${errorMessage(error)}`,
      500,
    );
  }
}

function plansResponseFromApi(value: unknown): unknown {
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
  assertOptionalConnectBooleanField(value, "isAvailable", "plans response");
  assertOptionalConnectBooleanField(value, "isComingSoon", "plans response");
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
      householdSize: requiredInteger(limits.householdSize, "plans response"),
      institutionConnections: planLimitValueFromApi(limits.institutionConnections),
      devices: requiredInteger(limits.devices, "plans response"),
    },
    features: features ?? [],
    featuresExtended: featuresExtended ?? null,
    isAvailable: optionalBoolean(value.isAvailable) ?? false,
    isComingSoon: optionalBoolean(value.isComingSoon) ?? false,
    badge: optionalString(value.badge),
    yearlyDiscountPercent:
      valueOrNull(value.yearlyDiscountPercent) === null
        ? null
        : requiredInteger(value.yearlyDiscountPercent, "plans response"),
  };
}

function planLimitValueFromApi(value: unknown): number | string {
  if (typeof value === "string") {
    return value;
  }
  return requiredInteger(value, "plans response");
}

function userInfoFromApi(value: unknown): unknown {
  if (!isRecord(value)) {
    throw new ConnectServiceError("internal_error", "No user info returned", 500);
  }
  validateUserInfoFromApi(value);
  const team = isRecord(value.team) ? value.team : null;
  return {
    id: requiredStringValue(value.id, "user info"),
    full_name: optionalString(value.fullName ?? value.full_name),
    email: optionalString(value.email),
    avatar_url: optionalString(value.avatarUrl ?? value.avatar_url),
    locale: optionalString(value.locale),
    week_starts_on_monday: optionalBoolean(value.weekStartsOnMonday ?? value.week_starts_on_monday),
    timezone: optionalString(value.timezone),
    timezone_auto_sync: optionalBoolean(value.timezoneAutoSync ?? value.timezone_auto_sync),
    time_format: optionalNumber(value.timeFormat ?? value.time_format),
    date_format: optionalString(value.dateFormat ?? value.date_format),
    team_id: optionalString(value.teamId ?? value.team_id),
    team_role: optionalString(value.teamRole ?? value.team_role),
    team: team
      ? {
          id: requiredStringValue(team.id, "team info"),
          name: optionalString(team.name) ?? "",
          logo_url: optionalString(team.logoUrl ?? team.logo_url),
          plan: optionalString(team.plan),
          subscription_status: optionalString(team.subscriptionStatus ?? team.subscription_status),
          subscription_current_period_end: optionalString(
            team.subscriptionCurrentPeriodEnd ?? team.subscription_current_period_end,
          ),
          subscription_cancel_at_period_end: optionalBoolean(
            team.subscriptionCancelAtPeriodEnd ?? team.subscription_cancel_at_period_end,
          ),
          canceled_at: optionalString(team.canceledAt ?? team.canceled_at),
          country_code: optionalString(team.countryCode ?? team.country_code),
          created_at: optionalString(team.createdAt ?? team.created_at),
        }
      : null,
  };
}

async function hasBrokerSyncEntitlement(
  restoreSession: () => Promise<{ accessToken: string; refreshToken: string }>,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  const userInfo = userInfoFromApi(
    await fetchAuthenticatedConnectJson(restoreSession, env, fetchImpl, "/api/v1/user/me"),
  );
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
    "full_name",
    "email",
    "avatarUrl",
    "avatar_url",
    "locale",
    "timezone",
    "dateFormat",
    "date_format",
    "teamId",
    "team_id",
    "teamRole",
    "team_role",
  ]) {
    assertOptionalConnectStringField(value, field, "user info");
  }
  for (const field of [
    "weekStartsOnMonday",
    "week_starts_on_monday",
    "timezoneAutoSync",
    "timezone_auto_sync",
  ]) {
    assertOptionalConnectBooleanField(value, field, "user info");
  }
  assertOptionalConnectNumberField(value, "timeFormat", "user info");
  assertOptionalConnectNumberField(value, "time_format", "user info");

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
    "logo_url",
    "plan",
    "subscriptionStatus",
    "subscription_status",
    "subscriptionCurrentPeriodEnd",
    "subscription_current_period_end",
    "canceledAt",
    "canceled_at",
    "countryCode",
    "country_code",
    "createdAt",
    "created_at",
  ]) {
    assertOptionalConnectStringField(team, field, "team info");
  }
  assertOptionalConnectBooleanField(team, "subscriptionCancelAtPeriodEnd", "team info");
  assertOptionalConnectBooleanField(team, "subscription_cancel_at_period_end", "team info");
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

function brokerConnectionsFromApi(value: unknown): unknown[] {
  if (!isRecord(value)) {
    throw new ConnectServiceError("internal_error", "Failed to parse connections response", 500);
  }
  if (value.connections === undefined) {
    return [];
  }
  if (!Array.isArray(value.connections)) {
    throw new ConnectServiceError("internal_error", "Failed to parse connections response", 500);
  }
  return value.connections.map(brokerConnectionFromApi);
}

function brokerConnectionFromApi(value: unknown): unknown {
  if (!isRecord(value)) {
    throw new ConnectServiceError("internal_error", "Failed to parse connection response", 500);
  }
  validateBrokerConnectionFromApi(value);
  const brokerage = brokerageFromApi(value);
  const id = requiredStringValue(value.id, "connection response");
  return {
    id: optionalString(value.authorization_id ?? value.authorizationId) ?? id,
    brokerage,
    type: null,
    status: optionalString(value.status),
    disabled: optionalBoolean(value.disabled) ?? false,
    disabled_date: null,
    updated_at: optionalString(value.updated_at ?? value.updatedAt),
    name: optionalString(value.name),
  };
}

function validateBrokerConnectionFromApi(value: Record<string, unknown>): void {
  for (const field of [
    "authorization_id",
    "authorizationId",
    "status",
    "updated_at",
    "updatedAt",
    "name",
  ]) {
    assertOptionalConnectStringField(value, field, "connection response");
  }
  assertOptionalConnectBooleanField(value, "disabled", "connection response");
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
      display_name: optionalString(nested.display_name ?? nested.displayName) ?? name,
      aws_s3_logo_url: optionalString(nested.aws_s3_logo_url ?? nested.awsS3LogoUrl),
      aws_s3_square_logo_url: optionalString(
        nested.aws_s3_square_logo_url ?? nested.awsS3SquareLogoUrl,
      ),
    };
  }
  assertOptionalConnectStringField(value, "brokerage_name", "connection response");
  assertOptionalConnectStringField(value, "brokerageName", "connection response");
  assertOptionalConnectStringField(value, "brokerage_slug", "connection response");
  assertOptionalConnectStringField(value, "brokerageSlug", "connection response");
  const brokerageName = optionalString(value.brokerage_name ?? value.brokerageName);
  const brokerageSlug = optionalString(value.brokerage_slug ?? value.brokerageSlug);
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
    "displayName",
    "aws_s3_logo_url",
    "awsS3LogoUrl",
    "aws_s3_square_logo_url",
    "awsS3SquareLogoUrl",
  ]) {
    assertOptionalConnectStringField(brokerage, field, "brokerage response");
  }
}

function brokerAccountsFromApi(value: unknown): unknown[] {
  if (!isRecord(value)) {
    throw new ConnectServiceError("internal_error", "Failed to parse accounts response", 500);
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

function validateBrokerAccountFromApi(account: Record<string, unknown>): void {
  for (const field of [
    "id",
    "name",
    "account_number",
    "accountNumber",
    "number",
    "type",
    "currency",
    "brokerage_authorization",
    "brokerageAuthorization",
    "institution_name",
    "institutionName",
    "created_date",
    "createdDate",
    "status",
    "raw_type",
    "rawType",
  ]) {
    assertOptionalConnectStringField(account, field, "accounts response");
  }
  for (const field of [
    "is_paper",
    "isPaper",
    "sync_enabled",
    "syncEnabled",
    "shared_with_household",
    "sharedWithHousehold",
  ]) {
    assertOptionalConnectBooleanField(account, field, "accounts response");
  }
  validateBrokerAccountBalance(account.balance);
  validateBrokerAccountOwner(account.owner);
  validateBrokerAccountSyncStatus(account.sync_status ?? account.syncStatus);
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
  for (const field of [
    "user_id",
    "userId",
    "full_name",
    "fullName",
    "user_full_name",
    "email",
    "avatar_url",
    "avatarUrl",
  ]) {
    assertOptionalConnectStringField(value, field, "accounts response");
  }
  assertOptionalConnectBooleanField(value, "is_own_account", "accounts response");
  assertOptionalConnectBooleanField(value, "isOwnAccount", "accounts response");
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
  assertOptionalConnectBooleanField(value, "initialSyncCompleted", "accounts response");
  assertOptionalConnectStringField(value, "last_successful_sync", "accounts response");
  assertOptionalConnectStringField(value, "lastSuccessfulSync", "accounts response");
  assertOptionalConnectStringField(value, "first_transaction_date", "accounts response");
  assertOptionalConnectStringField(value, "firstTransactionDate", "accounts response");
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
      accountNumber: optionalString(
        brokerAccount.account_number ?? brokerAccount.accountNumber ?? brokerAccount.number,
      ),
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
      institutionName: optionalString(
        brokerAccount.institution_name ?? brokerAccount.institutionName,
      ),
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
      let page: unknown;
      try {
        page = await fetchConnectJsonWithAccessToken(accessToken, env, fetchImpl, path);
      } catch (error) {
        const message = errorMessage(error);
        upsertBrokerSyncFailure(db, account.id, message);
        summary.accountsFailed += 1;
        accountFailed = true;
        break;
      }
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
          ));
        if (createInput === null) {
          hasUnsupportedMappableActivity = true;
        } else if (!brokerActivityAlreadyImported(db, activity, createInput)) {
          cashActivityCreates.push(createInput);
        }
      }
      if (hasUnsupportedMappableActivity) {
        const message = "Broker activity mapping is not yet available in the TS backend runtime";
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
  const hasMore = optionalBoolean(pagination.has_more ?? pagination.hasMore);
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

  const currency =
    brokerActivityCurrency(activity) ??
    optionalString(accountCurrency) ??
    optionalString(baseCurrency) ??
    "USD";
  const needsReview = brokerActivityNeedsReview(activity);
  return {
    accountId,
    activityType,
    subtype: optionalString(
      activity.subtype ??
        activity.option_type ??
        activity.optionType ??
        activity.raw_type ??
        activity.rawType,
    ),
    activityDate:
      optionalString(
        activity.trade_date ??
          activity.tradeDate ??
          activity.settlement_date ??
          activity.settlementDate,
      ) ?? new Date().toISOString(),
    amount: brokerActivityAbsoluteNumberString(activity.amount),
    fee: brokerActivityAbsoluteNumberString(activity.fee),
    currency,
    comment: optionalString(
      activity.description ?? activity.external_reference_id ?? activity.externalReferenceId,
    ),
    fxRate: brokerActivityNumberString(activity.fx_rate ?? activity.fxRate),
    sourceSystem:
      optionalString(
        activity.source_system ??
          activity.sourceSystem ??
          activity.provider_type ??
          activity.providerType,
      ) ?? "SNAPTRADE",
    sourceRecordId,
    sourceGroupId: optionalString(activity.source_group_id ?? activity.sourceGroupId),
    idempotencyKey: brokerActivityIdempotencyKey(
      accountId,
      optionalString(
        activity.source_system ??
          activity.sourceSystem ??
          activity.provider_type ??
          activity.providerType,
      ) ?? "SNAPTRADE",
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
    if (
      optionalNonEmptyString(symbol.raw_symbol) ||
      optionalNonEmptyString(symbol.rawSymbol) ||
      optionalNonEmptyString(symbol.symbol)
    ) {
      return true;
    }
  }
  const optionSymbol = activity.option_symbol ?? activity.optionSymbol;
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
  const currency =
    brokerActivityCurrency(activity) ??
    optionalString(accountCurrency) ??
    optionalString(baseCurrency) ??
    "USD";
  const sourceSystem =
    optionalString(
      activity.source_system ??
        activity.sourceSystem ??
        activity.provider_type ??
        activity.providerType,
    ) ?? "SNAPTRADE";
  const needsReview = brokerActivityNeedsReview(activity);
  return {
    accountId,
    activityType,
    subtype: optionalString(
      activity.subtype ??
        activity.option_type ??
        activity.optionType ??
        activity.raw_type ??
        activity.rawType,
    ),
    activityDate:
      optionalString(
        activity.trade_date ??
          activity.tradeDate ??
          activity.settlement_date ??
          activity.settlementDate,
      ) ?? new Date().toISOString(),
    quantity: brokerActivityAbsoluteNumberString(activity.units),
    unitPrice: brokerActivityAbsoluteNumberString(activity.price),
    amount: brokerActivityAbsoluteNumberString(activity.amount),
    fee: brokerActivityAbsoluteNumberString(activity.fee),
    currency,
    asset: { id: assetId, symbol: assetSymbol.symbol },
    comment: optionalString(
      activity.description ?? activity.external_reference_id ?? activity.externalReferenceId,
    ),
    fxRate: brokerActivityNumberString(activity.fx_rate ?? activity.fxRate),
    sourceSystem,
    sourceRecordId,
    sourceGroupId: optionalString(activity.source_group_id ?? activity.sourceGroupId),
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
  const currency =
    brokerActivityCurrency(activity) ??
    optionalString(accountCurrency) ??
    optionalString(baseCurrency) ??
    "USD";
  const sourceSystem =
    optionalString(
      activity.source_system ??
        activity.sourceSystem ??
        activity.provider_type ??
        activity.providerType,
    ) ?? "SNAPTRADE";
  const needsReview = brokerActivityNeedsReview(activity);
  return {
    accountId,
    activityType,
    subtype: optionalString(
      activity.subtype ??
        activity.option_type ??
        activity.optionType ??
        activity.raw_type ??
        activity.rawType,
    ),
    activityDate:
      optionalString(
        activity.trade_date ??
          activity.tradeDate ??
          activity.settlement_date ??
          activity.settlementDate,
      ) ?? new Date().toISOString(),
    quantity: brokerActivityAbsoluteNumberString(activity.units),
    unitPrice: brokerActivityAbsoluteNumberString(activity.price),
    amount: brokerActivityAbsoluteNumberString(activity.amount),
    fee: brokerActivityAbsoluteNumberString(activity.fee),
    currency,
    asset: providerAsset,
    comment: optionalString(
      activity.description ?? activity.external_reference_id ?? activity.externalReferenceId,
    ),
    fxRate: brokerActivityNumberString(activity.fx_rate ?? activity.fxRate),
    sourceSystem,
    sourceRecordId,
    sourceGroupId: optionalString(activity.source_group_id ?? activity.sourceGroupId),
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
  const optionSymbol = activity.option_symbol ?? activity.optionSymbol;
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
  const symbolType = symbol.type ?? symbol.symbol_type ?? symbol.symbolType;
  const symbolTypeCode = isRecord(symbolType)
    ? optionalString(symbolType.code)?.toUpperCase()
    : null;
  const exchangeMic = brokerActivitySymbolExchangeMic(symbol);
  if (symbolTypeCode === "CRYPTOCURRENCY" || symbolTypeCode === "CRYPTO") {
    const cryptoSymbol =
      parseCryptoBrokerPair(optionalNonEmptyString(symbol.raw_symbol ?? symbol.rawSymbol))?.base ??
      parseCryptoBrokerPair(optionalNonEmptyString(symbol.symbol))?.base ??
      null;
    return cryptoSymbol ? { symbol: cryptoSymbol.toUpperCase(), exchangeMic: null } : null;
  }
  const rawSymbol = optionalNonEmptyString(symbol.raw_symbol ?? symbol.rawSymbol);
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

function brokerActivitySymbolExchangeMic(symbol: Record<string, unknown>): string | null {
  const exchange = symbol.exchange;
  if (!isRecord(exchange)) {
    return null;
  }
  return (
    optionalNonEmptyString(exchange.mic_code ?? exchange.micCode ?? exchange.code)?.toUpperCase() ??
    null
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
  if (optionalBoolean(activity.needs_review ?? activity.needsReview) === true) {
    return true;
  }
  const activityType = brokerActivityType(activity)?.toUpperCase();
  if (!activityType || activityType === "UNKNOWN") {
    return true;
  }
  const metadata = activity.mapping_metadata ?? activity.mappingMetadata;
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
  return optionalString(activity.activity_type ?? activity.activityType ?? activity.type);
}

function brokerActivitySourceRecordId(activity: Record<string, unknown>): string | null {
  return optionalString(
    activity.source_record_id ??
      activity.sourceRecordId ??
      activity.external_reference_id ??
      activity.externalReferenceId ??
      activity.id,
  );
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
  const mappingMetadata = activity.mapping_metadata ?? activity.mappingMetadata;
  const metadata: Record<string, unknown> = {
    source: "broker",
    raw_type: optionalString(activity.raw_type ?? activity.rawType),
    source_system: optionalString(activity.source_system ?? activity.sourceSystem),
    provider_type: optionalString(activity.provider_type ?? activity.providerType),
    source_record_id: optionalString(activity.source_record_id ?? activity.sourceRecordId),
    source_group_id: optionalString(activity.source_group_id ?? activity.sourceGroupId),
    external_reference_id: optionalString(
      activity.external_reference_id ?? activity.externalReferenceId,
    ),
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
      ? { is_external: optionalBoolean(flow.is_external ?? flow.isExternal) === true }
      : undefined;
  }
  const symbolMetadata = brokerActivitySymbolMetadata(activity.symbol);
  if (symbolMetadata) {
    metadata.symbol = symbolMetadata;
  }
  const optionSymbol = activity.option_symbol ?? activity.optionSymbol;
  const optionLegType = optionalString(activity.option_type ?? activity.optionType);
  if (optionLegType) {
    metadata.option_leg_type = optionLegType;
  }
  if (isRecord(optionSymbol)) {
    metadata.option_contract_type = optionalString(
      optionSymbol.option_type ?? optionSymbol.optionType,
    );
    metadata.option_ticker = optionalString(optionSymbol.ticker);
    const underlying = optionSymbol.underlying_symbol ?? optionSymbol.underlyingSymbol;
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
  const symbolType = symbol.type ?? symbol.symbol_type ?? symbol.symbolType;
  const currency = symbol.currency;
  const metadata: Record<string, unknown> = {
    id: optionalString(symbol.id),
    symbol: optionalString(symbol.symbol),
    raw_symbol: optionalString(symbol.raw_symbol ?? symbol.rawSymbol),
    figi_code: optionalString(symbol.figi_code ?? symbol.figiCode),
    exchange_mic: isRecord(exchange)
      ? optionalString(exchange.mic_code ?? exchange.micCode)
      : undefined,
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
  const now = new Date().toISOString();
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
  const now = new Date().toISOString();
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
  const now = new Date().toISOString();
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

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function syncBrokerDataBounded(
  service: Pick<
    ConnectService,
    "syncBrokerConnections" | "syncBrokerAccounts" | "syncBrokerActivities"
  >,
): Promise<ConnectSyncBrokerDataResult> {
  await service.syncBrokerConnections();
  await service.syncBrokerAccounts();
  await service.syncBrokerActivities();
  return { status: "accepted" };
}

function brokerAccountDisplayName(account: Record<string, unknown>): string {
  const name = optionalString(account.name);
  if (name) {
    return name;
  }
  const institution =
    optionalString(account.institution_name ?? account.institutionName) ?? "Unknown";
  const accountNumber =
    optionalString(account.account_number ?? account.accountNumber ?? account.number) ?? "Account";
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
  const accountType = optionalString(account.type ?? account.account_type ?? account.accountType);
  if (accountType) {
    return accountType;
  }
  const rawType = (optionalString(account.raw_type ?? account.rawType) ?? "").toUpperCase();
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
    account.institutionName,
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
    account.brokerageAuthorization,
  ].flatMap((value) => {
    const parsed = optionalString(value);
    return parsed ? [parsed] : [];
  });
  return [...new Set(values)].sort();
}

function brokerAccountMeta(account: Record<string, unknown>): Record<string, unknown> {
  return {
    institution_name: optionalString(account.institution_name ?? account.institutionName),
    brokerage_authorization: optionalString(
      account.brokerage_authorization ?? account.brokerageAuthorization,
    ),
    created_date: optionalString(account.created_date ?? account.createdDate),
    status: optionalString(account.status),
    raw_type: optionalString(account.raw_type ?? account.rawType),
    is_paper: optionalBoolean(account.is_paper ?? account.isPaper) ?? false,
    sync_enabled: optionalBoolean(account.sync_enabled ?? account.syncEnabled) ?? true,
    shared_with_household:
      optionalBoolean(account.shared_with_household ?? account.sharedWithHousehold) ?? false,
    sync_status: account.sync_status ?? account.syncStatus ?? null,
    owner: account.owner ?? null,
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

function assertOptionalConnectNumberField(
  record: Record<string, unknown>,
  key: string,
  context: string,
): void {
  const value = record[key];
  if (value !== undefined && value !== null && typeof value !== "number") {
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
  if (
    parsed.expires_in !== undefined &&
    parsed.expires_in !== null &&
    !isSafeI64Integer(parsed.expires_in)
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
      const message = optionalString(parsed.message) ?? optionalString(parsed.error);
      return `API error ${status}: ${message ?? `HTTP ${status}`}`;
    }
  } catch {
    return `API error ${status}`;
  }
  return `API error ${status}`;
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
  appVersion,
  deviceDisplayName = DEVICE_ENROLL_DISPLAY_NAME,
  platform = detectDevicePlatform(process.platform),
  reinitializeDelayMs = 350,
}: LocalConnectDeviceSyncServiceDependencies): ConnectDeviceSyncService {
  const disabledService = createDisabledConnectDeviceSyncService();
  const runWithEnrollLock = createAsyncOperationLock();
  const runWithSessionRestoreLock = createAsyncOperationLock();
  const readyStateOverwriteApprovals = new Set<string>();
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
      return getLocalDeviceSyncEngineStatus(db, secretService);
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
      );
    },
    async generateDeviceSnapshotNow() {
      return await generateSnapshotIfTrusted(
        db,
        secretService,
        env,
        fetchImpl,
        restoreDeviceSyncSession,
      );
    },
    async startDeviceSyncBackgroundEngine() {
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
      if (state.state !== "READY") {
        return {
          status: "skipped",
          message: "Background engine not started because device is not in READY state",
        };
      }
      throw deviceSyncDisabled();
    },
    stopDeviceSyncBackgroundEngine() {
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
      const code = optionalString(parsed.code) ?? optionalString(parsed.error) ?? "";
      const message = optionalString(parsed.message) ?? `HTTP ${status}`;
      return `API error (${status}): ${code}: ${message}`;
    }
  } catch {
    return `API error (${status}): Request failed: ${trimmed}`;
  }
  return `API error (${status}): Request failed: ${trimmed}`;
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
  if (typeof value !== "number") {
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
    await assertLocalSnapshotDownloadPreconditions(
      env,
      fetchImpl,
      session.accessToken,
      deviceId,
      latestSnapshotStatus,
    );
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
      oplogSeq: number;
      createdAt: string;
      checksum: string | null;
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
        oplogSeq: requiredInteger(parsed.oplogSeq ?? parsed.oplog_seq, "snapshot metadata"),
        createdAt: requiredStringValue(parsed.createdAt ?? parsed.created_at, "snapshot metadata"),
        checksum: optionalString(parsed.checksum),
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
    if (!validSyncCursorShape(parsed) || !validSyncCursorRawShape(responseText)) {
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
      oplogSeq: requiredInteger(
        (latestSnapshot as Record<string, unknown>).oplogSeq ??
          (latestSnapshot as Record<string, unknown>).oplog_seq,
        "cursor latest snapshot",
      ),
      createdAt: "",
      checksum: null,
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
  return remoteCursor !== null && latest.oplogSeq >= remoteCursor;
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
): Promise<number | null> {
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
    if (!isRecord(parsed) || !validSyncCursorShape(parsed) || !validSyncCursorRawShape(bodyText)) {
      return null;
    }
    return requiredInteger(parsed.cursor, "cursor response");
  } catch {
    return null;
  }
}

async function assertLocalSnapshotDownloadPreconditions(
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  accessToken: string,
  deviceId: string,
  latest: Extract<LocalLatestSnapshotStatus, { kind: "present" }>,
): Promise<void> {
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
  if (cursorLatest.oplogSeq > latest.oplogSeq) {
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
    isSafeI64Integer(value.oplogSeq ?? value.oplog_seq) &&
    isSafeI64Integer(value.sizeBytes ?? value.size_bytes) &&
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

function validSyncLatestSnapshotRefShape(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }
  return (
    optionalString(value.snapshotId ?? value.snapshot_id) !== null &&
    isI32Integer(value.schemaVersion ?? value.schema_version) &&
    isSafeI64Integer(value.oplogSeq ?? value.oplog_seq)
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
      latestSnapshotSeq: parsedLatestSnapshot.oplogSeq,
      latestSnapshotInvalid: latestSnapshotRawTokens.length > 1 || parsedLatestSnapshot.invalid,
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
): Promise<Record<string, unknown>> {
  if (!secretService) {
    throw deviceSyncDisabled();
  }
  const deviceId = await requireLocalSyncIdentityDeviceId(secretService);
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
  if (latestSnapshotStatus.kind === "present" && latestSnapshotStatus.oplogSeq >= localCursor) {
    return {
      status: "uploaded",
      snapshotId: latestSnapshotStatus.snapshotId,
      oplogSeq: latestSnapshotStatus.oplogSeq,
      message: "Latest remote snapshot already covers current cursor",
    };
  }
  throw deviceSyncDisabled();
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
    try {
      persistReadyDeviceConfigFromIdentity(db, await requireLocalSyncIdentity(secretService));
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
      return localSyncCycleResult("ok", acquiredLockVersion, cursor);
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
): Record<string, unknown> {
  return {
    status,
    lockVersion,
    pushedCount: 0,
    pulledCount: 0,
    cursor,
    needsBootstrap: status === "stale_cursor",
    bootstrapSnapshotId,
    bootstrapSnapshotSeq,
    deadLetterCount: 0,
  };
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

function rawJsonI64TokenIsValid(token: string): boolean {
  return /^-?(?:0|[1-9]\d*)$/.test(token.trim());
}

function rawJsonI32TokenIsValid(token: string): boolean {
  return /^-?(?:0|[1-9]\d*)$/.test(token.trim());
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
): { snapshotId: string | null; oplogSeq: number | null; invalid: boolean } {
  if (value === undefined || value === null) {
    return { snapshotId: null, oplogSeq: null, invalid: false };
  }
  if (!isRecord(value) || rawToken === undefined || rawToken.trim() === "null") {
    return { snapshotId: null, oplogSeq: null, invalid: true };
  }
  const snapshotIdValue = value.snapshotId ?? value.snapshot_id;
  const schemaVersionValue = value.schemaVersion ?? value.schema_version;
  const oplogSeqValue = value.oplogSeq ?? value.oplog_seq;
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
  const oplogSeq = isSafeI64Integer(oplogSeqValue) ? oplogSeqValue : null;
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
    !rawJsonI64OptionTokenIsValid(oplogSeqRawToken);
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
