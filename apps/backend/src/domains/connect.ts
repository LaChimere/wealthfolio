import type { Database } from "bun:sqlite";

import type { AccountService } from "./accounts";
import type { ActivityService } from "./activities";
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
      return await fetchAuthenticatedConnectJson(
        restoreSession,
        env,
        fetchImpl,
        "/api/v1/subscription/plans",
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
      return syncBrokerActivitiesForHoldingsOnly(accountService);
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
      headers: { "content-type": "application/json" },
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
    if (!isRecord(parsed) || !Array.isArray(parsed.plans)) {
      throw new Error("missing plans array");
    }
    return parsed;
  } catch (error) {
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
  const baseUrl = normalizeConnectApiUrl(env.CONNECT_API_URL);
  const url = `${baseUrl}${path}`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
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
    throw new ConnectServiceError("internal_error", `API error ${response.status}`, 500);
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

function userInfoFromApi(value: unknown): unknown {
  if (!isRecord(value)) {
    throw new ConnectServiceError("internal_error", "No user info returned", 500);
  }
  const team = isRecord(value.team) ? value.team : null;
  return {
    id: stringValue(value.id),
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
          id: stringValue(team.id),
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

function brokerConnectionsFromApi(value: unknown): unknown[] {
  if (!isRecord(value) || !Array.isArray(value.connections)) {
    throw new ConnectServiceError("internal_error", "Failed to parse connections response", 500);
  }
  return value.connections.map(brokerConnectionFromApi);
}

function brokerConnectionFromApi(value: unknown): unknown {
  if (!isRecord(value)) {
    throw new ConnectServiceError("internal_error", "Failed to parse connection response", 500);
  }
  const brokerage = brokerageFromApi(value);
  return {
    id: optionalString(value.authorization_id ?? value.authorizationId) ?? stringValue(value.id),
    brokerage,
    type: null,
    status: optionalString(value.status),
    disabled: optionalBoolean(value.disabled) ?? false,
    disabled_date: null,
    updated_at: optionalString(value.updated_at ?? value.updatedAt),
    name: optionalString(value.name),
  };
}

function brokerageFromApi(value: Record<string, unknown>): unknown | null {
  const nested = isRecord(value.brokerage) ? value.brokerage : null;
  if (nested) {
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

function brokerAccountsFromApi(value: unknown): unknown[] {
  if (!isRecord(value) || !Array.isArray(value.accounts)) {
    throw new ConnectServiceError("internal_error", "Failed to parse accounts response", 500);
  }
  return value.accounts;
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
): {
  accountsSynced: number;
  activitiesUpserted: number;
  assetsInserted: number;
  accountsFailed: number;
  accountsWarned: number;
  newAssetIds: string[];
} {
  const hasTransactionsAccount = accountService
    .getAllAccounts()
    .some(
      (account) => account.providerAccountId !== null && account.trackingMode === "TRANSACTIONS",
    );
  if (hasTransactionsAccount) {
    throw connectSyncDisabled();
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

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
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
}: LocalConnectDeviceSyncServiceDependencies): ConnectDeviceSyncService {
  const disabledService = createDisabledConnectDeviceSyncService();
  return {
    ...disabledService,
    getDeviceSyncEngineStatus() {
      return getLocalDeviceSyncEngineStatus(db);
    },
    getDeviceSyncBootstrapOverwriteCheck() {
      return getLocalDeviceSyncBootstrapOverwriteCheck(db);
    },
    startDeviceSyncBackgroundEngine() {
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
  };
}

function getLocalDeviceSyncEngineStatus(db: Database): Record<string, unknown> {
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
  const deviceConfig = db
    .query<SyncDeviceConfigRow, []>(
      `
      SELECT device_id, last_bootstrap_at
      FROM sync_device_config
      ORDER BY device_id
      LIMIT 1
    `,
    )
    .get();
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

const OVERWRITE_RISK_TABLE_COUNTS: ReadonlyArray<readonly [string, string | null]> = [
  ["platforms", null],
  ["market_data_custom_providers", null],
  ["accounts", null],
  [
    "assets",
    "kind IN ('PROPERTY', 'VEHICLE', 'COLLECTIBLE', 'PRECIOUS_METAL', 'PRIVATE_EQUITY', 'LIABILITY', 'OTHER')",
  ],
  ["quotes", "source = 'MANUAL'"],
  ["goals", null],
  ["goal_plans", null],
  ["ai_threads", null],
  ["ai_messages", null],
  ["ai_thread_tags", null],
  ["contribution_limits", null],
  ["import_runs", "UPPER(run_type) = 'IMPORT' AND UPPER(source_system) IN ('CSV', 'MANUAL')"],
  [
    "activities",
    "is_user_modified = 1 OR UPPER(COALESCE(source_system, '')) IN ('MANUAL', 'CSV') OR ((import_run_id IS NULL OR TRIM(import_run_id) = '') AND (source_record_id IS NULL OR TRIM(source_record_id) = ''))",
  ],
  ["import_templates", "UPPER(scope) != 'SYSTEM'"],
  ["import_account_templates", null],
  ["taxonomies", "is_system = 0"],
  ["taxonomy_categories", "taxonomy_id = 'custom_groups'"],
  ["asset_taxonomy_assignments", null],
  ["goals_allocation", null],
];

function getLocalDeviceSyncBootstrapOverwriteCheck(db: Database): Record<string, unknown> {
  const engineStatus = getLocalDeviceSyncEngineStatus(db);
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

function localOverwriteRiskSummary(db: Database): {
  totalRows: number;
  nonEmptyTables: Array<{ table: string; rows: number }>;
} {
  let totalRows = 0;
  const nonEmptyTables: Array<{ table: string; rows: number }> = [];
  for (const [table, filter] of OVERWRITE_RISK_TABLE_COUNTS) {
    if (!sqliteTableExists(db, table)) {
      continue;
    }
    const sql = `SELECT COUNT(*) AS count FROM "${table}"${filter ? ` WHERE ${filter}` : ""}`;
    const row = db.query<{ count: number }, []>(sql).get();
    const count = row?.count ?? 0;
    totalRows += count;
    if (count > 0) {
      nonEmptyTables.push({ table, rows: count });
    }
  }
  nonEmptyTables.sort(
    (left, right) => right.rows - left.rows || left.table.localeCompare(right.table),
  );
  return { totalRows, nonEmptyTables };
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

function deviceSyncDisabled(): ConnectNotImplementedError {
  return new ConnectNotImplementedError(DEVICE_SYNC_DISABLED_MESSAGE);
}
