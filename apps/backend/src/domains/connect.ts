import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";

import type { AccountService } from "./accounts";
import type { ActivityService } from "./activities";
import { localOverwriteRiskSummary } from "./device-sync-overwrite-risk";
import type { SecretService } from "./secrets";

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
  activityService: Pick<ActivityService, "getBrokerSyncProfile" | "saveBrokerSyncProfileRules">;
  accountService: Pick<AccountService, "createAccount" | "getAllAccounts" | "getBaseCurrency">;
  secretService?: SecretService;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
}

export interface LocalConnectDeviceSyncServiceDependencies {
  db: Database;
  secretService?: SecretService;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
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
const CLOUD_REFRESH_TOKEN_KEY = "sync_refresh_token";
const CLOUD_ACCESS_TOKEN_KEY = "sync_access_token";
const DEVICE_SYNC_IDENTITY_KEY = "sync_identity";
const DEVICE_SYNC_DEVICE_ID_KEY = "sync_device_id";
const DEFAULT_CONNECT_AUTH_URL = "https://auth.wealthfolio.app";
const DEFAULT_CONNECT_AUTH_PUBLISHABLE_KEY = "sb_publishable_ZSZbXNtWtnh9i2nqJ2UL4A_NV8ZVutd";
const DEFAULT_CONNECT_API_URL = "https://api.wealthfolio.app";

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
        db,
        restoreSession,
        env,
        fetchImpl,
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
  accountService: Pick<AccountService, "getAllAccounts">,
  db?: Database,
  restoreSession?: () => Promise<{ accessToken: string; refreshToken: string }>,
  env?: NodeJS.ProcessEnv,
  fetchImpl?: typeof fetch,
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
      restoreSession!,
      env!,
      fetchImpl!,
      transactionAccounts,
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
  restoreSession: () => Promise<{ accessToken: string; refreshToken: string }>,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  accounts: ReturnType<AccountService["getAllAccounts"]>,
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
    for (;;) {
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
      const received = data.length;
      if (received === 0) {
        break;
      }
      if (data.some(hasBrokerActivityMappableId)) {
        const message = "Broker activity mapping is not yet available in the TS backend runtime";
        upsertBrokerSyncFailure(db, account.id, message);
        throw new ConnectNotImplementedError(message);
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
  const refreshToken =
    typeof parsed.refresh_token === "string" && parsed.refresh_token.trim()
      ? parsed.refresh_token.trim()
      : null;
  return { accessToken: parsed.access_token, refreshToken };
}

function parseRefreshError(status: number, bodyText: string): { code: string; message: string } {
  const trimmed = bodyText.trim();
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed);
      if (isRecord(parsed)) {
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
}: LocalConnectDeviceSyncServiceDependencies): ConnectDeviceSyncService {
  const disabledService = createDisabledConnectDeviceSyncService();
  return {
    ...disabledService,
    async getDeviceSyncState() {
      if (!secretService) {
        throw deviceSyncDisabled();
      }
      const session = await restoreLocalSyncSession(secretService, env, fetchImpl, () => 0);
      return await getLocalDeviceSyncState(secretService, env, fetchImpl, session.accessToken);
    },
    async enableDeviceSync() {
      if (!secretService) {
        throw deviceSyncDisabled();
      }
      const session = await restoreLocalSyncSession(secretService, env, fetchImpl, () => 0);
      const state = await getLocalDeviceSyncState(
        secretService,
        env,
        fetchImpl,
        session.accessToken,
      );
      if (state.state === "READY" || state.state === "REGISTERED" || state.state === "STALE") {
        return enableSyncResultFromState(state);
      }
      throw deviceSyncDisabled();
    },
    async reinitializeDeviceSync() {
      if (!secretService) {
        throw deviceSyncDisabled();
      }
      await restoreLocalSyncSession(secretService, env, fetchImpl, () => 0);
      throw deviceSyncDisabled();
    },
    async reconcileDeviceSyncReadyState() {
      if (!secretService) {
        throw deviceSyncDisabled();
      }
      try {
        await restoreLocalSyncSession(secretService, env, fetchImpl, () => 0);
        await getLocalDeviceSyncFreshStateOrThrow(secretService);
      } catch (error) {
        if (error instanceof ConnectNotImplementedError) {
          throw error;
        }
        return localReadyReconcileError(`Failed to read sync state: ${errorMessage(error)}`);
      }
      return {
        ...localReadyReconcileBase(),
        status: "skipped_not_ready",
        message: "Device is not in READY state",
      };
    },
    async getDeviceSyncEngineStatus() {
      return getLocalDeviceSyncEngineStatus(db, secretService);
    },
    async getDeviceSyncBootstrapOverwriteCheck() {
      return getLocalDeviceSyncBootstrapOverwriteCheck(db, secretService);
    },
    async clearDeviceSyncData() {
      if (!secretService) {
        throw deviceSyncDisabled();
      }
      await clearLocalDeviceSyncData(db, secretService);
    },
    async getDeviceSyncPairingSourceStatus() {
      return await getLocalDeviceSyncPairingSourceStatus(secretService, env, fetchImpl);
    },
    async bootstrapDeviceSnapshot() {
      return await bootstrapSnapshotIfNotReady(secretService, env, fetchImpl);
    },
    async generateDeviceSnapshotNow() {
      return await generateSnapshotIfTrusted(secretService, env, fetchImpl);
    },
    async startDeviceSyncBackgroundEngine() {
      if (await localSyncIdentityCanRunBackground(secretService)) {
        throw deviceSyncDisabled();
      }
      return {
        status: "skipped",
        message: "Background engine not started because sync identity is not configured",
      };
    },
    stopDeviceSyncBackgroundEngine() {
      return {
        status: "stopped",
        message: "Device sync background engine stopped",
      };
    },
    async triggerDeviceSyncCycle() {
      return await triggerLocalDeviceSyncCycle(db, secretService, env, fetchImpl);
    },
    cancelDeviceSnapshotUpload() {
      return {
        status: "cancel_requested",
        message: "Snapshot upload cancellation requested",
      };
    },
  };
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

async function getLocalDeviceSyncFreshStateOrThrow(
  secretService: SecretService,
): Promise<Record<string, unknown>> {
  const rawIdentity = await secretService.getSecret(DEVICE_SYNC_IDENTITY_KEY);
  if (rawIdentity === null) {
    return freshDeviceSyncState();
  }
  try {
    const parsed = parseStoredSyncIdentity(rawIdentity);
    if (!parsed.deviceNonce || !parsed.deviceId) {
      return freshDeviceSyncState();
    }
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
  throw deviceSyncDisabled();
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
  const response = await fetchImpl(
    `${normalizeConnectApiUrl(env.CONNECT_API_URL)}/api/v1/sync/team/devices/${encodeURIComponent(deviceId)}`,
    {
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "x-wf-client-request-id": `app:${randomUUID()}`,
      },
    },
  );
  const bodyText = await response.text();
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
    const parsed = JSON.parse(await response.text()) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(isRecord)
      .filter((device) => (device.trustState ?? device.trust_state) === "trusted")
      .map((device) => ({
        id: requiredStringValue(device.id, "device response"),
        name: requiredStringValue(device.displayName ?? device.display_name, "device response"),
        platform: requiredStringValue(device.platform, "device response"),
        lastSeenAt: optionalString(device.lastSeenAt ?? device.last_seen_at),
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
    const parsed = JSON.parse(await response.text()) as unknown;
    if (!isRecord(parsed) || parsed.mode !== "PAIRING_REQUIRED") {
      return false;
    }
    const e2eeKeyVersion = optionalNumber(parsed.e2eeKeyVersion ?? parsed.e2ee_key_version);
    const trustedDevicesValue = parsed.trustedDevices ?? parsed.trusted_devices;
    const trustedDevices = Array.isArray(trustedDevicesValue) ? trustedDevicesValue : [];
    return (e2eeKeyVersion ?? 0) > 0 && trustedDevices.length === 0;
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

function optionalDeviceNumber(value: unknown, context: string): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number") {
    throw new ConnectServiceError("internal_error", `Failed to parse ${context}`, 500);
  }
  return value;
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
): Promise<Record<string, unknown>> {
  const engineStatus = await getLocalDeviceSyncEngineStatus(db, secretService);
  const bootstrapRequired = engineStatus.bootstrapRequired === true;
  if (!bootstrapRequired) {
    return {
      bootstrapRequired: false,
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

function localReadyReconcileError(message: string): Record<string, unknown> {
  return {
    ...localReadyReconcileBase(),
    status: "error",
    message,
  };
}

async function getLocalDeviceSyncPairingSourceStatus(
  secretService: SecretService | undefined,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
): Promise<never> {
  if (!secretService) {
    throw deviceSyncDisabled();
  }
  await requireLocalSyncIdentityDeviceId(secretService);
  try {
    await restoreLocalSyncSession(secretService, env, fetchImpl, () => 0);
  } catch (error) {
    throw new ConnectServiceError("internal_error", errorMessage(error), 500);
  }
  throw deviceSyncDisabled();
}

async function bootstrapSnapshotIfNotReady(
  secretService: SecretService | undefined,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
): Promise<Record<string, unknown>> {
  if (!secretService) {
    throw deviceSyncDisabled();
  }
  await requireLocalSyncIdentityDeviceId(secretService);
  const session = await restoreLocalSyncSession(secretService, env, fetchImpl, () => 0);
  const state = await getLocalDeviceSyncState(secretService, env, fetchImpl, session.accessToken);
  if (state.state !== "READY") {
    return {
      status: "skipped_not_ready",
      message: "Device is not in READY state",
      snapshotId: null,
      cursor: null,
    };
  }
  throw deviceSyncDisabled();
}

async function generateSnapshotIfTrusted(
  secretService: SecretService | undefined,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
): Promise<Record<string, unknown>> {
  if (!secretService) {
    throw deviceSyncDisabled();
  }
  const deviceId = await requireLocalSyncIdentityDeviceId(secretService);
  const session = await restoreLocalSyncSession(secretService, env, fetchImpl, () => 0);
  const device = await fetchLocalDeviceSyncDevice(env, fetchImpl, session.accessToken, deviceId);
  if (device.trustState !== "trusted") {
    return {
      status: "skipped",
      snapshotId: null,
      oplogSeq: null,
      message: "Current device is not trusted",
    };
  }
  throw deviceSyncDisabled();
}

async function requireLocalSyncIdentityDeviceId(
  secretService: SecretService | undefined,
): Promise<string> {
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
  return identity.deviceId;
}

async function triggerLocalDeviceSyncCycle(
  db: Database,
  secretService: SecretService | undefined,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
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
    await restoreLocalSyncSession(secretService, env, fetchImpl, () => 0);
    await getLocalDeviceSyncFreshStateOrThrow(secretService);
  } catch (error) {
    if (error instanceof ConnectNotImplementedError) {
      throw error;
    }
    markLocalSyncCycleError(db, "state_error", `Failed to read sync state: ${errorMessage(error)}`);
    return localSyncCycleResult("state_error", lockVersion, cursor);
  }
  markLocalSyncCycleOutcome(db, "not_ready");
  return localSyncCycleResult("not_ready", lockVersion, cursor);
}

function localSyncCycleResult(
  status: string,
  lockVersion: number,
  cursor: number,
): Record<string, unknown> {
  return {
    status,
    lockVersion,
    pushedCount: 0,
    pulledCount: 0,
    cursor,
    needsBootstrap: status === "stale_cursor",
    bootstrapSnapshotId: null,
    bootstrapSnapshotSeq: null,
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
): void {
  const durationMs = 0;
  db.prepare(
    `
      INSERT INTO sync_engine_state (
        id, lock_version, last_error, consecutive_failures, next_retry_at,
        last_cycle_status, last_cycle_duration_ms
      )
      VALUES (1, 0, ?, 0, NULL, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        last_error = excluded.last_error,
        next_retry_at = excluded.next_retry_at,
        last_cycle_status = excluded.last_cycle_status,
        last_cycle_duration_ms = excluded.last_cycle_duration_ms
    `,
  ).run(lastError, status, durationMs);
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
