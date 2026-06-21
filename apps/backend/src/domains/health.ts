import type { Database } from "bun:sqlite";

import Decimal from "decimal.js";

import type { Account, AccountService } from "./accounts";
import type { ExchangeRateService, LatestFxRateSnapshot } from "./exchange-rates";
import type { HoldingsService } from "./holdings";
import type { LatestQuoteSnapshot, MarketDataService } from "./market-data";
import type { SettingsService } from "./settings";
import type { TaxonomyService } from "./taxonomies";

export interface IssueDismissal {
  issueId: string;
  dismissedAt: string;
  dataHash: string;
}

export interface HealthConfig {
  priceStaleWarningHours: number;
  priceStaleCriticalHours: number;
  fxStaleWarningHours: number;
  fxStaleCriticalHours: number;
  mvEscalationThreshold: number;
  classificationWarnThreshold: number;
}

export interface HealthFixAction {
  id: string;
  label: string;
  payload: unknown;
}

export type HealthSeverity = "INFO" | "WARNING" | "ERROR" | "CRITICAL";

export type HealthCategory =
  | "PRICE_STALENESS"
  | "FX_INTEGRITY"
  | "CLASSIFICATION"
  | "DATA_CONSISTENCY"
  | "ACCOUNT_CONFIGURATION"
  | "SETTINGS_CONFIGURATION";

export interface NavigateAction {
  route: string;
  query?: unknown;
  label: string;
}

export interface AffectedItem {
  id: string;
  name: string;
  symbol?: string;
  route?: string;
}

export interface HealthIssue {
  id: string;
  severity: HealthSeverity;
  category: HealthCategory;
  title: string;
  message: string;
  affectedCount: number;
  affectedMvPct?: number;
  fixAction?: HealthFixAction;
  navigateAction?: NavigateAction;
  details?: string;
  affectedItems?: AffectedItem[];
  dataHash: string;
  timestamp: string;
}

export interface HealthStatus {
  overallSeverity: HealthSeverity;
  issueCounts: Partial<Record<HealthSeverity, number>>;
  issues: HealthIssue[];
  checkedAt: string;
  isStale: boolean;
}

export interface HealthServiceOptions {
  accountProvider?: Partial<
    Pick<AccountService, "getActiveAccounts" | "getActiveNonArchivedAccounts">
  >;
  classificationMigrationProvider?: Pick<
    TaxonomyService,
    | "getMigrationStatus"
    | "getLegacyClassificationMigrationDetails"
    | "migrateLegacyClassifications"
  >;
  exchangeRateProvider?: Pick<ExchangeRateService, "ensureFxPairs"> &
    Partial<Pick<ExchangeRateService, "getLatestFxRateSnapshots">>;
  holdingsProvider?: Pick<HoldingsService, "getHoldings">;
  marketDataQuoteProvider?: Partial<
    Pick<MarketDataService, "getLatestQuotes" | "getQuoteSyncErrorSnapshots">
  >;
  marketDataSyncProvider?: Pick<MarketDataService, "syncMarketData">;
  settingsProvider?: Pick<SettingsService, "getSettings">;
  valuationProvider?: NegativeBalanceProvider;
  now?: () => Date;
  cacheTtlMs?: number;
  warn?: (message: string) => void;
}

export interface NegativeAccountBalanceInfo {
  accountId: string;
  firstNegativeDate: string;
  cashBalance: string;
  totalValue: string;
  accountCurrency: string;
}

export interface NegativeBalanceProvider {
  getAccountsWithNegativeBalance(
    accountIds: string[],
  ): Promise<NegativeAccountBalanceInfo[]> | NegativeAccountBalanceInfo[];
}

export interface DataConsistencyRecordIssue {
  recordId: string;
}

export interface HealthRepository {
  saveDismissal(issueId: string, dataHash: string): IssueDismissal;
  removeDismissal(issueId: string): void;
  getDismissals(): IssueDismissal[];
  getDismissal(issueId: string): IssueDismissal | null;
  getOrphanActivityAccountIssues(): DataConsistencyRecordIssue[];
  getOrphanActivityAssetIssues(): DataConsistencyRecordIssue[];
  getNegativePositionIssues(): DataConsistencyRecordIssue[];
}

export interface HealthService {
  dismissIssue(issueId: string, dataHash: string): Promise<void>;
  restoreIssue(issueId: string): Promise<void>;
  getDismissedIds(): Promise<string[]>;
  getConfig(): Promise<HealthConfig>;
  updateConfig(config: HealthConfig): Promise<void>;
  clearCache(): void;
  getCachedHealthStatus?(clientTimezone?: string): HealthStatus | null;
  getHealthStatus(clientTimezone?: string): Promise<HealthStatus> | HealthStatus;
  runHealthChecks(clientTimezone?: string): Promise<HealthStatus> | HealthStatus;
  executeFix(action: HealthFixAction): Promise<void> | void;
}

class HealthFixError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "HealthFixError";
    this.code = code;
    this.status = status;
  }
}

interface DismissalRow {
  issue_id: string;
  dismissed_at: string;
  data_hash: string;
}

interface DataConsistencyRecordIssueRow {
  record_id: string;
}

export const DEFAULT_HEALTH_CONFIG: HealthConfig = {
  priceStaleWarningHours: 24,
  priceStaleCriticalHours: 72,
  fxStaleWarningHours: 24,
  fxStaleCriticalHours: 72,
  mvEscalationThreshold: 0.3,
  classificationWarnThreshold: 0.05,
};

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const SEVERITY_ORDER: HealthSeverity[] = ["INFO", "WARNING", "ERROR", "CRITICAL"];
const U64_MASK = 0xffffffffffffffffn;
const RUST_HASH_STR_TERMINATOR = 0xff;
const RUST_HASH_U32_MAX = 0xffff_ffff;
const TEXT_ENCODER = new TextEncoder();

export function createHealthRepository(db: Database): HealthRepository {
  return {
    saveDismissal(issueId, dataHash) {
      const dismissal: IssueDismissal = {
        issueId,
        dismissedAt: timestampNow(),
        dataHash,
      };
      db.prepare(
        `
          INSERT INTO health_issue_dismissals (issue_id, dismissed_at, data_hash)
          VALUES (?, ?, ?)
          ON CONFLICT(issue_id) DO UPDATE SET
            dismissed_at = excluded.dismissed_at,
            data_hash = excluded.data_hash
        `,
      ).run(dismissal.issueId, dismissal.dismissedAt, dismissal.dataHash);
      return dismissal;
    },
    removeDismissal(issueId) {
      db.prepare("DELETE FROM health_issue_dismissals WHERE issue_id = ?").run(issueId);
    },
    getDismissals() {
      return db
        .query<DismissalRow, []>(
          `
            SELECT issue_id, dismissed_at, data_hash
            FROM health_issue_dismissals
          `,
        )
        .all()
        .map(dismissalFromRow);
    },
    getDismissal(issueId) {
      const row = db
        .query<DismissalRow, [string]>(
          `
            SELECT issue_id, dismissed_at, data_hash
            FROM health_issue_dismissals
            WHERE issue_id = ?
          `,
        )
        .get(issueId);
      return row ? dismissalFromRow(row) : null;
    },
    getOrphanActivityAccountIssues() {
      if (!tablesExist(db, ["activities", "accounts"])) {
        return [];
      }
      return db
        .query<DataConsistencyRecordIssueRow, []>(
          `
            SELECT a.id AS record_id
            FROM activities a
            LEFT JOIN accounts account ON account.id = a.account_id
            WHERE account.id IS NULL
            ORDER BY a.id
          `,
        )
        .all()
        .map(dataConsistencyRecordIssueFromRow);
    },
    getOrphanActivityAssetIssues() {
      if (!tablesExist(db, ["activities", "assets"])) {
        return [];
      }
      return db
        .query<DataConsistencyRecordIssueRow, []>(
          `
            SELECT a.id AS record_id
            FROM activities a
            LEFT JOIN assets asset ON asset.id = a.asset_id
            WHERE a.asset_id IS NOT NULL
              AND asset.id IS NULL
            ORDER BY a.id
          `,
        )
        .all()
        .map(dataConsistencyRecordIssueFromRow);
    },
    getNegativePositionIssues() {
      if (!tablesExist(db, ["holdings_snapshots", "assets"])) {
        return [];
      }
      return db
        .query<DataConsistencyRecordIssueRow, []>(
          `
            WITH latest_snapshots AS (
              SELECT account_id, MAX(snapshot_date) AS snapshot_date
              FROM holdings_snapshots
              WHERE account_id <> 'TOTAL'
              GROUP BY account_id
            )
            SELECT
              (CASE
                WHEN asset.kind IN ('PROPERTY', 'VEHICLE', 'COLLECTIBLE', 'PRECIOUS_METAL', 'OTHER')
                THEN 'ALT'
                ELSE 'SEC'
              END) || '-' || snapshot.account_id || '-' || asset.id AS record_id
            FROM holdings_snapshots snapshot
            INNER JOIN latest_snapshots latest
              ON latest.account_id = snapshot.account_id
              AND latest.snapshot_date = snapshot.snapshot_date
            INNER JOIN json_each(snapshot.positions) position
            INNER JOIN assets asset
              ON asset.id = COALESCE(NULLIF(json_extract(position.value, '$.assetId'), ''), position.key)
            WHERE asset.kind <> 'LIABILITY'
              AND CAST(json_extract(position.value, '$.quantity') AS REAL) < 0
            ORDER BY snapshot.account_id, asset.id
          `,
        )
        .all()
        .map(dataConsistencyRecordIssueFromRow);
    },
  };
}

export function createHealthService(
  repository: HealthRepository,
  initialConfig: HealthConfig = DEFAULT_HEALTH_CONFIG,
  options: HealthServiceOptions = {},
): HealthService {
  validateHealthConfig(initialConfig);
  let config = { ...initialConfig };
  let cachedStatuses = new Map<string, { status: HealthStatus; cachedAt: Date }>();
  const now = options.now ?? timestampNowDate;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const clearCache = () => {
    cachedStatuses = new Map();
  };

  return {
    async dismissIssue(issueId, dataHash) {
      repository.saveDismissal(issueId, dataHash);
      clearCache();
    },
    async restoreIssue(issueId) {
      repository.removeDismissal(issueId);
      clearCache();
    },
    async getDismissedIds() {
      return repository.getDismissals().map((dismissal) => dismissal.issueId);
    },
    async getConfig() {
      return { ...config };
    },
    async updateConfig(nextConfig) {
      validateHealthConfig(nextConfig);
      config = { ...nextConfig };
      clearCache();
    },
    clearCache,
    getCachedHealthStatus(clientTimezone) {
      const cached = cachedStatuses.get(clientTimezone?.trim() ?? "");
      if (!cached) {
        return null;
      }
      const stale = now().getTime() - cached.cachedAt.getTime() > cacheTtlMs;
      return cloneStatus(cached.status, stale);
    },
    async getHealthStatus(clientTimezone) {
      const cacheKey = clientTimezone?.trim() ?? "";
      const cached = cachedStatuses.get(cacheKey);
      if (cached) {
        const stale = now().getTime() - cached.cachedAt.getTime() > cacheTtlMs;
        return cloneStatus(cached.status, stale);
      }
      return runChecks(repository, config, options, now, clientTimezone, cachedStatuses);
    },
    async runHealthChecks(clientTimezone) {
      return runChecks(repository, config, options, now, clientTimezone, cachedStatuses);
    },
    async executeFix(action) {
      if (action.id === "sync_prices" || action.id === "retry_sync") {
        const assetIds = parseHealthFixAssetIds(action);
        if (!options.marketDataSyncProvider?.syncMarketData) {
          throw new HealthFixError(
            "not_found",
            "Market data sync is not available for health fixes",
            404,
          );
        }
        await options.marketDataSyncProvider.syncMarketData({
          type: "incremental",
          asset_ids: assetIds,
        });
        clearCache();
        return;
      }
      if (action.id === "migrate_classifications") {
        const assetIds = parseHealthFixStringArray(action, "expected an array of asset IDs");
        if (!options.classificationMigrationProvider?.migrateLegacyClassifications) {
          throw new HealthFixError(
            "not_found",
            "Classification migration is not available for health fixes",
            404,
          );
        }
        await options.classificationMigrationProvider.migrateLegacyClassifications(assetIds);
        clearCache();
        return;
      }
      if (action.id === "migrate_legacy_classifications") {
        if (!options.classificationMigrationProvider?.migrateLegacyClassifications) {
          throw new HealthFixError(
            "not_found",
            "Classification migration is not available for health fixes",
            404,
          );
        }
        await options.classificationMigrationProvider.migrateLegacyClassifications();
        clearCache();
        return;
      }
      if (action.id === "fetch_fx") {
        const pairs = parseHealthFixCurrencyPairs(action);
        if (!options.exchangeRateProvider?.ensureFxPairs) {
          throw new HealthFixError(
            "not_found",
            "Exchange rate sync is not available for health fixes",
            404,
          );
        }
        const fxAssetIds = await options.exchangeRateProvider.ensureFxPairs(pairs);
        if (options.marketDataSyncProvider?.syncMarketData && fxAssetIds.length > 0) {
          await options.marketDataSyncProvider.syncMarketData({
            type: "incremental",
            asset_ids: fxAssetIds,
          });
        }
        clearCache();
        return;
      }
      throw new HealthFixError("not_found", `Unknown health fix action: ${action.id}`, 404);
    },
  };
}

function parseHealthFixAssetIds(action: HealthFixAction): string[] {
  const assetIds = parseHealthFixStringArray(action, "expected an array of asset IDs");
  if (assetIds.length === 0) {
    throw new HealthFixError("invalid_payload", "No assets selected for price sync", 400);
  }
  return assetIds;
}

function parseHealthFixCurrencyPairs(action: HealthFixAction): Array<[string, string]> {
  return parseHealthFixStringArray(action, "expected an array of currency pair IDs").map(
    (pairId) => {
      const parts = pairId.split(":");
      const fromCurrency = parts[0]?.trim();
      const toCurrency = parts[1]?.trim();
      if (parts.length !== 2 || !fromCurrency || !toCurrency) {
        throw new HealthFixError(
          "invalid_payload",
          `Invalid currency pair for ${action.id}: ${pairId}`,
          400,
        );
      }
      return [fromCurrency, toCurrency];
    },
  );
}

function parseHealthFixStringArray(action: HealthFixAction, expected: string): string[] {
  if (
    !Array.isArray(action.payload) ||
    !action.payload.every((value) => typeof value === "string")
  ) {
    throw new HealthFixError(
      "invalid_payload",
      `Invalid payload for ${action.id}: ${expected}`,
      400,
    );
  }
  return [...action.payload];
}

async function runChecks(
  repository: HealthRepository,
  config: HealthConfig,
  options: HealthServiceOptions,
  now: () => Date,
  clientTimezone: string | undefined,
  cache: Map<string, { status: HealthStatus; cachedAt: Date }>,
): Promise<HealthStatus> {
  const checkedAt = now();
  const issues = filterDismissedIssues(
    repository,
    [
      ...analyzeUnconfiguredAccounts(options, checkedAt),
      ...(await analyzePriceStaleness(options, config, checkedAt)),
      ...(await analyzeQuoteSyncErrors(options, config, checkedAt)),
      ...(await analyzeFxIntegrity(options, config, checkedAt)),
      ...(await analyzeDataConsistency(repository, options, checkedAt)),
      ...(await analyzeLegacyClassificationMigration(options, checkedAt)),
      ...analyzeTimezone(options, clientTimezone, checkedAt),
    ],
    options.warn,
  );
  const status = buildStatus(issues, checkedAt);
  cache.set(clientTimezone?.trim() ?? "", { status: cloneStatus(status), cachedAt: checkedAt });
  return status;
}

function analyzeUnconfiguredAccounts(
  options: HealthServiceOptions,
  timestamp: Date,
): HealthIssue[] {
  const accounts = options.accountProvider
    ?.getActiveNonArchivedAccounts?.()
    .filter((account) => account.trackingMode === "NOT_SET");

  if (!accounts || accounts.length === 0) {
    return [];
  }

  const accountIds = accounts.map((account) => account.id);
  const dataHash = computeDataHash(accountIds);
  const count = accounts.length;
  return [
    {
      id: `unconfigured_accounts:${dataHash}`,
      severity: "WARNING",
      category: "ACCOUNT_CONFIGURATION",
      title: count === 1 ? "1 account needs setup" : `${count} accounts need setup`,
      message:
        count === 1
          ? "Choose a tracking mode to start syncing data."
          : "Choose tracking modes to start syncing data.",
      affectedCount: count,
      navigateAction: { route: "/connect", label: "Configure Accounts" },
      affectedItems: accounts.map((account) => ({
        id: account.id,
        name: account.name,
        route: `/accounts/${encodeURIComponent(account.id)}`,
      })),
      dataHash,
      timestamp: toRustSerdeUtcRfc3339(timestamp),
    },
  ];
}

function analyzeTimezone(
  options: HealthServiceOptions,
  clientTimezone: string | undefined,
  timestamp: Date,
): HealthIssue[] {
  if (!options.settingsProvider) {
    return [];
  }

  const configuredTimezone = options.settingsProvider.getSettings().timezone.trim();
  if (!configuredTimezone) {
    const dataHash = computeDataHash(["MISSING"]);
    return [
      {
        id: `timezone_missing:${dataHash}`,
        severity: "WARNING",
        category: "SETTINGS_CONFIGURATION",
        title: "Timezone not configured",
        message: "Set your timezone in General settings to ensure dates match your locale.",
        affectedCount: 1,
        navigateAction: { route: "/settings/general", label: "Open General Settings" },
        dataHash,
        timestamp: toRustSerdeUtcRfc3339(timestamp),
      },
    ];
  }

  const configured = normalizeTimezone(configuredTimezone);
  if (!configured) {
    const dataHash = computeDataHash([configuredTimezone]);
    return [
      {
        id: `timezone_invalid:${dataHash}`,
        severity: "ERROR",
        category: "SETTINGS_CONFIGURATION",
        title: "Configured timezone is invalid",
        message: `The configured timezone "${configuredTimezone}" is invalid. Update it in General settings.`,
        affectedCount: 1,
        navigateAction: { route: "/settings/general", label: "Open General Settings" },
        dataHash,
        timestamp: toRustSerdeUtcRfc3339(timestamp),
      },
    ];
  }

  const client = clientTimezone?.trim() ? normalizeTimezone(clientTimezone) : null;
  if (!client || areEffectivelySameTimezone(configured, client, timestamp)) {
    return [];
  }

  const dataHash = computeDataHash([configured, client]);
  return [
    {
      id: `timezone_mismatch:${dataHash}`,
      severity: "WARNING",
      category: "SETTINGS_CONFIGURATION",
      title: "Browser and app timezones differ",
      message: `Configured timezone is "${configured}" but browser timezone is "${client}". Dates follow the configured timezone.`,
      affectedCount: 1,
      navigateAction: { route: "/settings/general", label: "Open General Settings" },
      dataHash,
      timestamp: toRustSerdeUtcRfc3339(timestamp),
    },
  ];
}

interface PriceHealthHolding {
  assetId: string;
  symbol: string;
  name: string | null;
  marketValue: number;
  usesMarketPricing: boolean;
}

async function analyzePriceStaleness(
  options: HealthServiceOptions,
  config: HealthConfig,
  timestamp: Date,
): Promise<HealthIssue[]> {
  if (!options.holdingsProvider?.getHoldings || !options.marketDataQuoteProvider?.getLatestQuotes) {
    return [];
  }

  const accounts = getPortfolioHealthAccounts(options);
  if (!accounts) {
    return [];
  }
  const holdingsByAsset = new Map<string, PriceHealthHolding>();
  let totalPortfolioValue = 0;

  for (const account of accounts) {
    const holdings = await options.holdingsProvider.getHoldings(account.id);
    for (const holding of holdings) {
      const instrument = holding.instrument;
      if (!instrument) {
        continue;
      }
      const marketValue = holding.marketValue.base;
      totalPortfolioValue += marketValue;
      const existing = holdingsByAsset.get(instrument.id);
      if (existing) {
        existing.marketValue += marketValue;
        continue;
      }
      holdingsByAsset.set(instrument.id, {
        assetId: instrument.id,
        symbol: instrument.symbol,
        name: instrument.name,
        marketValue,
        usesMarketPricing: instrument.pricingMode.toUpperCase() === "MARKET",
      });
    }
  }

  const holdings = [...holdingsByAsset.values()];
  if (holdings.length === 0) {
    return [];
  }

  let latestQuotes: Record<string, LatestQuoteSnapshot>;
  try {
    latestQuotes = await options.marketDataQuoteProvider.getLatestQuotes(
      holdings.map((holding) => holding.assetId),
    );
  } catch (error) {
    options.warn?.(
      `Failed to load latest quotes for price staleness: ${formatErrorMessage(error)}`,
    );
    latestQuotes = {};
  }
  return analyzePriceStalenessFromSnapshots(holdings, latestQuotes, {
    config,
    timestamp,
    totalPortfolioValue,
  });
}

function analyzePriceStalenessFromSnapshots(
  holdings: PriceHealthHolding[],
  latestQuotes: Record<string, LatestQuoteSnapshot>,
  context: { config: HealthConfig; timestamp: Date; totalPortfolioValue: number },
): HealthIssue[] {
  const warningTradingDays = Math.max(Math.trunc(context.config.priceStaleWarningHours / 24), 1);
  const criticalTradingDays = Math.max(Math.trunc(context.config.priceStaleCriticalHours / 24), 1);
  const warningAssets: PriceHealthHolding[] = [];
  const errorAssets: PriceHealthHolding[] = [];
  let warningMarketValue = 0;
  let errorMarketValue = 0;

  for (const holding of holdings) {
    if (!holding.usesMarketPricing) {
      continue;
    }
    const latestQuote = latestQuotes[holding.assetId];
    if (!latestQuote) {
      errorAssets.push(holding);
      errorMarketValue += holding.marketValue;
      continue;
    }
    const quoteDate = latestQuoteDate(latestQuote);
    if (!quoteDate) {
      errorAssets.push(holding);
      errorMarketValue += holding.marketValue;
      continue;
    }
    if (holding.marketValue <= 0) {
      continue;
    }
    const daysStale = tradingDaysBetween(quoteDate, latestQuote.effectiveMarketDate);
    if (daysStale >= criticalTradingDays) {
      errorAssets.push(holding);
      errorMarketValue += holding.marketValue;
    } else if (daysStale >= warningTradingDays) {
      warningAssets.push(holding);
      warningMarketValue += holding.marketValue;
    }
  }

  return [
    ...buildPriceStalenessIssues({
      assets: errorAssets,
      issueLevel: "error",
      marketValue: errorMarketValue,
      latestQuotes,
      timestamp: context.timestamp,
      totalPortfolioValue: context.totalPortfolioValue,
      escalationThreshold: context.config.mvEscalationThreshold,
    }),
    ...buildPriceStalenessIssues({
      assets: warningAssets,
      issueLevel: "warning",
      marketValue: warningMarketValue,
      latestQuotes,
      timestamp: context.timestamp,
      totalPortfolioValue: context.totalPortfolioValue,
      escalationThreshold: context.config.mvEscalationThreshold,
    }),
  ];
}

function buildPriceStalenessIssues(input: {
  assets: PriceHealthHolding[];
  issueLevel: "error" | "warning";
  marketValue: number;
  latestQuotes: Record<string, LatestQuoteSnapshot>;
  timestamp: Date;
  totalPortfolioValue: number;
  escalationThreshold: number;
}): HealthIssue[] {
  if (input.assets.length === 0) {
    return [];
  }
  const affectedMvPct =
    input.totalPortfolioValue > 0 ? input.marketValue / input.totalPortfolioValue : 0;
  const escalated = affectedMvPct > input.escalationThreshold;
  const severity: HealthSeverity =
    input.issueLevel === "error"
      ? escalated
        ? "CRITICAL"
        : "ERROR"
      : escalated
        ? "CRITICAL"
        : "WARNING";
  const assetIds = input.assets.map((asset) => asset.assetId);
  const missingCount = input.assets.filter(
    (asset) => !latestQuoteDate(input.latestQuotes[asset.assetId]),
  ).length;
  const dataHash = computeDataHashWithSeverityAndMvPct(assetIds, severity, affectedMvPct);

  return [
    {
      id: `price_stale:${input.issueLevel}:${dataHash}`,
      severity,
      category: "PRICE_STALENESS",
      title: priceStalenessTitle(input.issueLevel, input.assets, missingCount),
      message:
        input.issueLevel === "error" && missingCount > 0
          ? "Unable to fetch market data for some holdings. This may be due to invalid symbols or provider issues. Your portfolio value may be inaccurate."
          : input.issueLevel === "error"
            ? "Some holdings haven't had prices updated in over 3 days. Your portfolio value may be inaccurate."
            : "Some holdings haven't had prices updated recently. Consider syncing prices.",
      affectedCount: input.assets.length,
      affectedMvPct,
      affectedItems: input.assets.map(priceStalenessAffectedItem),
      fixAction: { id: "sync_prices", label: "Sync Prices", payload: assetIds },
      details: priceStalenessDetails(input.assets, input.latestQuotes),
      dataHash,
      timestamp: toRustSerdeUtcRfc3339(input.timestamp),
    },
  ];
}

function priceStalenessTitle(
  issueLevel: "error" | "warning",
  assets: PriceHealthHolding[],
  missingCount: number,
): string {
  const count = assets.length;
  if (issueLevel === "warning") {
    return count === 1
      ? "Price update needed for 1 holding"
      : `Price updates needed for ${count} holdings`;
  }
  if (missingCount === count) {
    return count === 1
      ? `No market data for ${assets[0]?.symbol ?? ""}`
      : `No market data for ${count} holdings`;
  }
  return count === 1 ? "Outdated price for 1 holding" : `Outdated prices for ${count} holdings`;
}

function priceStalenessAffectedItem(asset: PriceHealthHolding): AffectedItem {
  return {
    id: asset.assetId,
    name: asset.name ?? asset.symbol,
    symbol: asset.symbol,
    route: `/holdings/${encodeURIComponent(asset.assetId)}`,
  };
}

function priceStalenessDetails(
  assets: PriceHealthHolding[],
  latestQuotes: Record<string, LatestQuoteSnapshot>,
): string {
  const lines = assets.slice(0, 5).map((asset, index) => {
    const name = asset.name ? ` (${asset.name})` : "";
    const status = latestQuoteDate(latestQuotes[asset.assetId]) ? "outdated" : "no data";
    return `${index + 1}. ${asset.symbol}${name} - ${status}`;
  });
  if (assets.length > 5) {
    lines.push(`... and ${assets.length - 5} more`);
  }
  return lines.join("\n");
}

function latestQuoteDate(snapshot: LatestQuoteSnapshot | undefined): string | null {
  return snapshot?.quote?.timestamp.slice(0, 10) ?? snapshot?.quoteDate ?? null;
}

function tradingDaysBetween(fromDate: string, toDate: string): number {
  let current = parseDateOnlyUtc(fromDate);
  const end = parseDateOnlyUtc(toDate);
  if (end.getTime() <= current.getTime()) {
    return 0;
  }

  let tradingDays = 0;
  current = addUtcDays(current, 1);
  while (current.getTime() <= end.getTime()) {
    const day = current.getUTCDay();
    if (day !== 0 && day !== 6) {
      tradingDays += 1;
    }
    current = addUtcDays(current, 1);
  }
  return tradingDays;
}

function parseDateOnlyUtc(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`Invalid date: ${value}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = utcDateFromParts(year, month - 1, day);
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid date: ${value}`);
  }
  return date;
}

function addUtcDays(date: Date, days: number): Date {
  return utcDateFromParts(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days);
}

function utcDateFromParts(year: number, monthIndex: number, day: number): Date {
  const date = new Date(Date.UTC(2000, 0, 1));
  date.setUTCFullYear(year, monthIndex, day);
  return date;
}

interface QuoteSyncHealthError {
  assetId: string;
  symbol: string;
  errorCount: number;
  lastError: string | null;
  marketValue: number;
  hasSyncedBefore: boolean;
}

async function analyzeQuoteSyncErrors(
  options: HealthServiceOptions,
  config: HealthConfig,
  timestamp: Date,
): Promise<HealthIssue[]> {
  if (
    !options.holdingsProvider?.getHoldings ||
    !options.marketDataQuoteProvider?.getQuoteSyncErrorSnapshots
  ) {
    return [];
  }

  const accounts = getPortfolioHealthAccounts(options);
  if (!accounts) {
    return [];
  }
  const { holdingMarketValues, totalPortfolioValue } = await gatherInstrumentMarketValues(
    accounts,
    options.holdingsProvider,
  );
  let snapshots: Awaited<ReturnType<NonNullable<MarketDataService["getQuoteSyncErrorSnapshots"]>>>;
  try {
    snapshots = await options.marketDataQuoteProvider.getQuoteSyncErrorSnapshots();
  } catch (error) {
    options.warn?.(`Failed to load quote sync error snapshots: ${formatErrorMessage(error)}`);
    return [];
  }

  const syncErrors = snapshots
    .filter((snapshot) => snapshot.quoteMode.toUpperCase() !== "MANUAL")
    .map((snapshot) => ({
      assetId: snapshot.assetId,
      symbol: snapshot.symbol,
      errorCount: snapshot.errorCount,
      lastError: snapshot.lastError,
      marketValue: holdingMarketValues.get(snapshot.assetId) ?? 0,
      hasSyncedBefore: snapshot.hasSyncedBefore,
    }));

  return analyzeQuoteSyncErrorsFromSnapshots(syncErrors, {
    config,
    timestamp,
    totalPortfolioValue,
  });
}

async function gatherInstrumentMarketValues(
  accounts: Account[],
  holdingsProvider: Pick<HoldingsService, "getHoldings">,
): Promise<{ holdingMarketValues: Map<string, number>; totalPortfolioValue: number }> {
  const holdingMarketValues = new Map<string, number>();
  let totalPortfolioValue = 0;

  for (const account of accounts) {
    const holdings = await holdingsProvider.getHoldings(account.id);
    for (const holding of holdings) {
      const instrument = holding.instrument;
      if (!instrument) {
        continue;
      }
      const marketValue = holding.marketValue.base;
      totalPortfolioValue += marketValue;
      holdingMarketValues.set(
        instrument.id,
        (holdingMarketValues.get(instrument.id) ?? 0) + marketValue,
      );
    }
  }

  return { holdingMarketValues, totalPortfolioValue };
}

function analyzeQuoteSyncErrorsFromSnapshots(
  syncErrors: QuoteSyncHealthError[],
  context: { config: HealthConfig; timestamp: Date; totalPortfolioValue: number },
): HealthIssue[] {
  if (syncErrors.length === 0) {
    return [];
  }

  const warningErrors = syncErrors.filter((error) => error.errorCount >= 1 && error.errorCount < 6);
  const persistentErrors = syncErrors.filter((error) => error.errorCount >= 6);

  return [
    ...buildQuoteSyncIssues({
      errors: persistentErrors,
      issueLevel: "error",
      timestamp: context.timestamp,
      totalPortfolioValue: context.totalPortfolioValue,
      escalationThreshold: context.config.mvEscalationThreshold,
    }),
    ...buildQuoteSyncIssues({
      errors: warningErrors,
      issueLevel: "warning",
      timestamp: context.timestamp,
      totalPortfolioValue: context.totalPortfolioValue,
      escalationThreshold: context.config.mvEscalationThreshold,
    }),
  ];
}

function buildQuoteSyncIssues(input: {
  errors: QuoteSyncHealthError[];
  issueLevel: "error" | "warning";
  timestamp: Date;
  totalPortfolioValue: number;
  escalationThreshold: number;
}): HealthIssue[] {
  if (input.errors.length === 0) {
    return [];
  }

  const marketValue = input.errors.reduce((total, error) => total + error.marketValue, 0);
  const affectedMvPct = input.totalPortfolioValue > 0 ? marketValue / input.totalPortfolioValue : 0;
  const severity: HealthSeverity =
    input.issueLevel === "error" && affectedMvPct > input.escalationThreshold
      ? "CRITICAL"
      : input.issueLevel === "error"
        ? "ERROR"
        : "WARNING";
  const assetIds = input.errors.map((error) => error.assetId);
  const dataHash = computeDataHashWithSeverity(assetIds, severity);

  return [
    {
      id: `quote_sync:${input.issueLevel}:${dataHash}`,
      severity,
      category: "PRICE_STALENESS",
      title: quoteSyncTitle(input.issueLevel, input.errors),
      message:
        input.issueLevel === "error"
          ? "These assets have repeatedly failed to sync prices. Check the symbols or data provider settings."
          : "Some assets are having trouble syncing prices. This may resolve automatically.",
      affectedCount: input.errors.length,
      affectedMvPct,
      affectedItems: input.errors.map(quoteSyncAffectedItem),
      fixAction: { id: "retry_sync", label: "Retry Sync", payload: assetIds },
      navigateAction:
        input.issueLevel === "error"
          ? { route: "/settings/market-data", label: "View Market Data" }
          : undefined,
      details: quoteSyncDetails(input.errors),
      dataHash,
      timestamp: toRustSerdeUtcRfc3339(input.timestamp),
    },
  ];
}

function quoteSyncTitle(issueLevel: "error" | "warning", errors: QuoteSyncHealthError[]): string {
  const count = errors.length;
  if (issueLevel === "error") {
    return count === 1
      ? `Quotes sync failing for ${errors[0]?.symbol ?? ""}`
      : `Quotes sync failing for ${count} assets`;
  }
  return count === 1
    ? `Sync issues for ${errors[0]?.symbol ?? ""}`
    : `Sync issues for ${count} assets`;
}

function quoteSyncAffectedItem(error: QuoteSyncHealthError): AffectedItem {
  return {
    id: error.assetId,
    name: error.symbol,
    symbol: error.symbol,
    route: `/holdings/${encodeURIComponent(error.assetId)}`,
  };
}

function quoteSyncDetails(errors: QuoteSyncHealthError[]): string {
  const lines = errors.slice(0, 5).map((error, index) => {
    const message = truncateQuoteSyncError(error.lastError?.trim() || "Unknown error");
    return `${index + 1}. ${error.symbol} - ${error.errorCount} failures: ${message}`;
  });
  if (errors.length > 5) {
    lines.push(`... and ${errors.length - 5} more`);
  }
  return lines.join("\n");
}

function truncateQuoteSyncError(message: string): string {
  return message.length > 80 ? message.slice(0, 80) : message;
}

interface FxHealthPair {
  pairId: string;
  fromCurrency: string;
  toCurrency: string;
  affectedMarketValue: number;
  latestQuoteTimestamp: string | null;
}

async function analyzeFxIntegrity(
  options: HealthServiceOptions,
  config: HealthConfig,
  timestamp: Date,
): Promise<HealthIssue[]> {
  if (
    !options.holdingsProvider?.getHoldings ||
    !options.exchangeRateProvider?.getLatestFxRateSnapshots
  ) {
    return [];
  }

  const accounts = getPortfolioHealthAccounts(options);
  if (!accounts) {
    return [];
  }

  const pairMarketValues = new Map<
    string,
    { fromCurrency: string; toCurrency: string; affectedMarketValue: number }
  >();
  let totalPortfolioValue = 0;

  for (const account of accounts) {
    const holdings = await options.holdingsProvider.getHoldings(account.id);
    for (const holding of holdings) {
      const marketValue = holding.marketValue.base;
      if (holding.localCurrency !== holding.baseCurrency) {
        const pairId = `${holding.localCurrency}:${holding.baseCurrency}`;
        const existing = pairMarketValues.get(pairId);
        if (existing) {
          existing.affectedMarketValue += Math.abs(marketValue);
        } else {
          pairMarketValues.set(pairId, {
            fromCurrency: holding.localCurrency,
            toCurrency: holding.baseCurrency,
            affectedMarketValue: Math.abs(marketValue),
          });
        }
      }
      if (holding.instrument) {
        totalPortfolioValue += marketValue;
      }
    }
  }

  if (pairMarketValues.size === 0) {
    return [];
  }

  let latestFxRates = new Map<string, LatestFxRateSnapshot>();
  try {
    latestFxRates = fxSnapshotsByPair(options.exchangeRateProvider.getLatestFxRateSnapshots());
  } catch (error) {
    options.warn?.(`Failed to load latest FX rate snapshots: ${formatErrorMessage(error)}`);
  }
  const pairs = [...pairMarketValues.values()].map((pair) => ({
    ...pair,
    pairId: `${pair.fromCurrency}:${pair.toCurrency}`,
    latestQuoteTimestamp: latestFxQuoteTimestamp(pair, latestFxRates),
  }));

  return analyzeFxIntegrityFromPairs(pairs, {
    config,
    timestamp,
    totalPortfolioValue,
  });
}

function analyzeFxIntegrityFromPairs(
  pairs: FxHealthPair[],
  context: { config: HealthConfig; timestamp: Date; totalPortfolioValue: number },
): HealthIssue[] {
  const warningThreshold = new Date(
    context.timestamp.getTime() - context.config.fxStaleWarningHours * 60 * 60 * 1000,
  );
  const criticalThreshold = new Date(
    context.timestamp.getTime() - context.config.fxStaleCriticalHours * 60 * 60 * 1000,
  );
  const missingPairs: FxHealthPair[] = [];
  const staleErrorPairs: FxHealthPair[] = [];
  const staleWarningPairs: FxHealthPair[] = [];
  let missingMarketValue = 0;
  let staleErrorMarketValue = 0;
  let staleWarningMarketValue = 0;

  for (const pair of pairs) {
    if (!pair.latestQuoteTimestamp) {
      missingPairs.push(pair);
      missingMarketValue += pair.affectedMarketValue;
      continue;
    }
    const quoteTime = parseRustRfc3339Timestamp(pair.latestQuoteTimestamp) ?? context.timestamp;
    if (quoteTime < criticalThreshold) {
      staleErrorPairs.push(pair);
      staleErrorMarketValue += pair.affectedMarketValue;
    } else if (quoteTime < warningThreshold) {
      staleWarningPairs.push(pair);
      staleWarningMarketValue += pair.affectedMarketValue;
    }
  }

  return [
    ...buildFxIntegrityIssues({
      pairs: missingPairs,
      issueLevel: "missing",
      marketValue: missingMarketValue,
      timestamp: context.timestamp,
      totalPortfolioValue: context.totalPortfolioValue,
      escalationThreshold: context.config.mvEscalationThreshold,
    }),
    ...buildFxIntegrityIssues({
      pairs: staleErrorPairs,
      issueLevel: "error",
      marketValue: staleErrorMarketValue,
      timestamp: context.timestamp,
      totalPortfolioValue: context.totalPortfolioValue,
      escalationThreshold: context.config.mvEscalationThreshold,
    }),
    ...buildFxIntegrityIssues({
      pairs: staleWarningPairs,
      issueLevel: "warning",
      marketValue: staleWarningMarketValue,
      timestamp: context.timestamp,
      totalPortfolioValue: context.totalPortfolioValue,
      escalationThreshold: context.config.mvEscalationThreshold,
    }),
  ];
}

function buildFxIntegrityIssues(input: {
  pairs: FxHealthPair[];
  issueLevel: "missing" | "error" | "warning";
  marketValue: number;
  timestamp: Date;
  totalPortfolioValue: number;
  escalationThreshold: number;
}): HealthIssue[] {
  if (input.pairs.length === 0) {
    return [];
  }
  const affectedMvPct =
    input.totalPortfolioValue > 0 ? input.marketValue / input.totalPortfolioValue : 0;
  const escalated = affectedMvPct > input.escalationThreshold;
  const severity: HealthSeverity =
    input.issueLevel === "warning"
      ? escalated
        ? "CRITICAL"
        : "WARNING"
      : escalated
        ? "CRITICAL"
        : "ERROR";
  const pairIds = input.pairs.map((pair) => pair.pairId);
  const dataHash = computeDataHashWithSeverityAndMvPct(pairIds, severity, affectedMvPct);

  return [
    {
      id: fxIssueId(input.issueLevel, dataHash),
      severity,
      category: "FX_INTEGRITY",
      title: fxIntegrityTitle(input.issueLevel, input.pairs),
      message: fxIntegrityMessage(input.issueLevel),
      affectedCount: input.pairs.length,
      affectedMvPct,
      fixAction: { id: "fetch_fx", label: "Fetch Exchange Rates", payload: pairIds },
      affectedItems: input.pairs.map(fxAffectedItem),
      dataHash,
      timestamp: toRustSerdeUtcRfc3339(input.timestamp),
    },
  ];
}

function fxIssueId(issueLevel: "missing" | "error" | "warning", dataHash: string): string {
  return issueLevel === "missing" ? `fx_missing:${dataHash}` : `fx_stale:${issueLevel}:${dataHash}`;
}

function fxIntegrityTitle(
  issueLevel: "missing" | "error" | "warning",
  pairs: FxHealthPair[],
): string {
  const count = pairs.length;
  if (issueLevel === "missing") {
    return count === 1
      ? `Missing exchange rate for ${pairs[0]?.fromCurrency ?? ""}`
      : `Missing exchange rates for ${count} currencies`;
  }
  if (issueLevel === "error") {
    return count === 1
      ? "Outdated exchange rate"
      : `Outdated exchange rates for ${count} currencies`;
  }
  return count === 1
    ? "Exchange rate update needed"
    : `Exchange rate updates needed for ${count} currencies`;
}

function fxIntegrityMessage(issueLevel: "missing" | "error" | "warning"): string {
  if (issueLevel === "missing") {
    return "We can't convert some holdings to your base currency. This affects your total portfolio value.";
  }
  if (issueLevel === "error") {
    return "Some exchange rates haven't been updated in over 3 days. Currency conversions may be inaccurate.";
  }
  return "Some exchange rates haven't been updated recently. Consider refreshing rates.";
}

function fxAffectedItem(pair: FxHealthPair): AffectedItem {
  return {
    id: pair.pairId,
    name: `${pair.fromCurrency} \u2192 ${pair.toCurrency}`,
  };
}

function fxSnapshotsByPair(snapshots: LatestFxRateSnapshot[]): Map<string, LatestFxRateSnapshot> {
  return new Map(snapshots.map((snapshot) => [fxSnapshotPairKey(snapshot), snapshot]));
}

function latestFxQuoteTimestamp(
  pair: { fromCurrency: string; toCurrency: string },
  snapshotsByPair: Map<string, LatestFxRateSnapshot>,
): string | null {
  const direct = snapshotsByPair.get(fxPairKey(pair.fromCurrency, pair.toCurrency));
  if (direct) {
    return direct.quoteTimestamp;
  }
  return snapshotsByPair.get(fxPairKey(pair.toCurrency, pair.fromCurrency))?.quoteTimestamp ?? null;
}

function fxSnapshotPairKey(snapshot: LatestFxRateSnapshot): string {
  return fxPairKey(snapshot.fromCurrency, snapshot.toCurrency);
}

function fxPairKey(fromCurrency: string, toCurrency: string): string {
  return `${fromCurrency.toUpperCase()}:${toCurrency.toUpperCase()}`;
}

function getPortfolioHealthAccounts(options: HealthServiceOptions): Account[] | null {
  const accounts = options.accountProvider?.getActiveAccounts?.();
  return accounts ? [...accounts].sort((a, b) => a.id.localeCompare(b.id)) : null;
}

interface NegativeBalanceIssue {
  recordId: string;
  description: string;
  firstNegativeDate: string;
  cashBalance: Decimal;
  totalValue: Decimal;
  accountCurrency: string;
}

async function analyzeDataConsistency(
  repository: HealthRepository,
  options: HealthServiceOptions,
  timestamp: Date,
): Promise<HealthIssue[]> {
  const orphanActivityAccountIssues = getDataConsistencyRecordIssues(
    () => repository.getOrphanActivityAccountIssues(),
    options.warn,
    "orphan activity account references",
  );
  const orphanActivityAssetIssues = getDataConsistencyRecordIssues(
    () => repository.getOrphanActivityAssetIssues(),
    options.warn,
    "orphan activity asset references",
  );
  const negativePositionIssues = getDataConsistencyRecordIssues(
    () => repository.getNegativePositionIssues(),
    options.warn,
    "negative positions",
  );
  const { negativeInvestmentAccounts, negativeCashAccounts } =
    await getNegativeBalanceGroups(options);

  return [
    ...buildOrphanActivityIssues({
      issues: orphanActivityAccountIssues,
      issueLevel: "account",
      timestamp,
    }),
    ...buildOrphanActivityIssues({
      issues: orphanActivityAssetIssues,
      issueLevel: "asset",
      timestamp,
    }),
    ...buildNegativePositionIssues({ issues: negativePositionIssues, timestamp }),
    ...buildNegativeBalanceIssues({
      issues: negativeInvestmentAccounts,
      issueLevel: "account",
      timestamp,
    }),
    ...buildNegativeBalanceIssues({
      issues: negativeCashAccounts,
      issueLevel: "cash",
      timestamp,
    }),
  ];
}

async function getNegativeBalanceGroups(options: HealthServiceOptions): Promise<{
  negativeInvestmentAccounts: NegativeBalanceIssue[];
  negativeCashAccounts: NegativeBalanceIssue[];
}> {
  if (!options.valuationProvider?.getAccountsWithNegativeBalance) {
    return { negativeInvestmentAccounts: [], negativeCashAccounts: [] };
  }
  const accounts = getPortfolioHealthAccounts(options);
  if (!accounts) {
    return { negativeInvestmentAccounts: [], negativeCashAccounts: [] };
  }
  const accountNameById = new Map(accounts.map((account) => [account.id, account.name]));
  const investmentAccountIds = accounts
    .filter((account) => account.accountType !== "CASH")
    .map((account) => account.id);
  const cashAccountIds = accounts
    .filter((account) => account.accountType === "CASH")
    .map((account) => account.id);
  const [negativeInvestmentAccounts, negativeCashAccounts] = await Promise.all([
    getNegativeBalanceIssues(
      options.valuationProvider,
      investmentAccountIds,
      accountNameById,
      options.warn,
      "negative account balances",
    ),
    getNegativeBalanceIssues(
      options.valuationProvider,
      cashAccountIds,
      accountNameById,
      options.warn,
      "negative cash balances",
    ),
  ]);

  return { negativeInvestmentAccounts, negativeCashAccounts };
}

function getDataConsistencyRecordIssues(
  readIssues: () => DataConsistencyRecordIssue[],
  warn: ((message: string) => void) | undefined,
  failureLabel: string,
): DataConsistencyRecordIssue[] {
  try {
    return readIssues();
  } catch (error) {
    warn?.(`Failed to check for ${failureLabel}: ${formatErrorMessage(error)}`);
    return [];
  }
}

function buildOrphanActivityIssues(input: {
  issues: DataConsistencyRecordIssue[];
  issueLevel: "account" | "asset";
  timestamp: Date;
}): HealthIssue[] {
  if (input.issues.length === 0) {
    return [];
  }
  const recordIds = input.issues.map((issue) => issue.recordId);
  const dataHash = computeDataHash(recordIds);
  const count = input.issues.length;
  const isAccount = input.issueLevel === "account";

  return [
    {
      id: `orphan_activity_${input.issueLevel}:${dataHash}`,
      severity: "ERROR",
      category: "DATA_CONSISTENCY",
      title: isAccount
        ? count === 1
          ? "Transaction references missing account"
          : `${count} transactions reference missing accounts`
        : count === 1
          ? "Transaction references missing asset"
          : `${count} transactions reference missing assets`,
      message: isAccount
        ? "Some transactions point to accounts that no longer exist. This may cause calculation errors."
        : "Some transactions point to assets that no longer exist. This may cause calculation errors.",
      affectedCount: count,
      navigateAction: {
        route: "/activities",
        query: { filter: "orphan" },
        label: "View Activities",
      },
      dataHash,
      timestamp: toRustSerdeUtcRfc3339(input.timestamp),
    },
  ];
}

function buildNegativePositionIssues(input: {
  issues: DataConsistencyRecordIssue[];
  timestamp: Date;
}): HealthIssue[] {
  if (input.issues.length === 0) {
    return [];
  }
  const recordIds = input.issues.map((issue) => issue.recordId);
  const dataHash = computeDataHash(recordIds);
  const count = input.issues.length;

  return [
    {
      id: `negative_position:${dataHash}`,
      severity: "WARNING",
      category: "DATA_CONSISTENCY",
      title:
        count === 1
          ? "Holding has negative quantity"
          : `${count} holdings have negative quantities`,
      message:
        "Some holdings show negative quantities, which usually indicates missing or incorrect transactions.",
      affectedCount: count,
      navigateAction: {
        route: "/holdings",
        query: { filter: "negative" },
        label: "View Holdings",
      },
      dataHash,
      timestamp: toRustSerdeUtcRfc3339(input.timestamp),
    },
  ];
}

async function getNegativeBalanceIssues(
  provider: NegativeBalanceProvider,
  accountIds: string[],
  accountNameById: Map<string, string>,
  warn: ((message: string) => void) | undefined,
  failureLabel: string,
): Promise<NegativeBalanceIssue[]> {
  if (accountIds.length === 0) {
    return [];
  }
  let rows: NegativeAccountBalanceInfo[];
  try {
    rows = await provider.getAccountsWithNegativeBalance(accountIds);
  } catch (error) {
    warn?.(`Failed to check for ${failureLabel}: ${formatErrorMessage(error)}`);
    return [];
  }
  return rows
    .map((row) => ({
      recordId: row.accountId,
      description: accountNameById.get(row.accountId) ?? row.accountId,
      firstNegativeDate: row.firstNegativeDate,
      cashBalance: new Decimal(row.cashBalance),
      totalValue: new Decimal(row.totalValue),
      accountCurrency: row.accountCurrency,
    }))
    .sort((a, b) => a.recordId.localeCompare(b.recordId));
}

function buildNegativeBalanceIssues(input: {
  issues: NegativeBalanceIssue[];
  issueLevel: "account" | "cash";
  timestamp: Date;
}): HealthIssue[] {
  if (input.issues.length === 0) {
    return [];
  }
  const accountIds = input.issues.map((issue) => issue.recordId);
  const dataHash = computeDataHash(accountIds);
  const count = input.issues.length;
  const isCash = input.issueLevel === "cash";

  return [
    {
      id: `${isCash ? "negative_cash_balance" : "negative_account_balance"}:${dataHash}`,
      severity: isCash ? "INFO" : "WARNING",
      category: "DATA_CONSISTENCY",
      title: negativeBalanceTitle(input.issueLevel, count),
      message: isCash
        ? "One or more cash accounts show a negative balance in their history. This may be a normal bank overdraft or a missing deposit entry."
        : "One or more accounts show a negative total value in their history. This is usually caused by missing buy transactions. Review your activities to fix this.",
      affectedCount: count,
      affectedItems: input.issues.map(negativeBalanceAffectedItem),
      navigateAction: { route: "/activities", label: "View Activities" },
      details: negativeBalanceDetails(input.issues, input.issueLevel),
      dataHash,
      timestamp: toRustSerdeUtcRfc3339(input.timestamp),
    },
  ];
}

function negativeBalanceTitle(issueLevel: "account" | "cash", count: number): string {
  if (issueLevel === "cash") {
    return count === 1
      ? "Cash account had a negative balance"
      : `${count} cash accounts had a negative balance`;
  }
  return count === 1
    ? "Account has negative portfolio balance"
    : `${count} accounts have negative portfolio balance`;
}

function negativeBalanceAffectedItem(issue: NegativeBalanceIssue): AffectedItem {
  return {
    id: issue.recordId,
    name: issue.description,
    route: `/accounts/${encodeURIComponent(issue.recordId)}`,
  };
}

function negativeBalanceDetails(
  issues: NegativeBalanceIssue[],
  issueLevel: "account" | "cash",
): string {
  return issues
    .map((issue) =>
      issueLevel === "cash" ? negativeCashDetails(issue) : negativeAccountDetails(issue),
    )
    .join("\n\n");
}

function negativeAccountDetails(issue: NegativeBalanceIssue): string {
  const investments = issue.totalValue.minus(issue.cashBalance);
  return [
    issue.description,
    `First went negative on ${issue.firstNegativeDate}.`,
    `Cash: ${formatHealthDecimal(issue.cashBalance)} ${issue.accountCurrency} | Investments: ${formatHealthDecimal(investments)} ${issue.accountCurrency}`,
    negativeBalanceLikelyCause(issue.cashBalance, investments),
  ].join("\n");
}

function negativeCashDetails(issue: NegativeBalanceIssue): string {
  return [
    issue.description,
    `First went negative on ${issue.firstNegativeDate}.`,
    `Cash: ${formatHealthDecimal(issue.cashBalance)} ${issue.accountCurrency}`,
    "\u2192 This may be a bank overdraft or a missing deposit entry.",
  ].join("\n");
}

function negativeBalanceLikelyCause(cash: Decimal, investments: Decimal): string {
  if (cash.isNegative() && !investments.isNegative()) {
    return "\u2192 Likely missing Transfer In or deposit before a buy transaction.";
  }
  if (!cash.isNegative() && investments.isNegative()) {
    return "\u2192 Likely missing Buy transaction before a Sell.";
  }
  return "\u2192 Multiple data issues \u2014 check activities around this date.";
}

function formatHealthDecimal(value: Decimal): string {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function dataConsistencyRecordIssueFromRow(
  row: DataConsistencyRecordIssueRow,
): DataConsistencyRecordIssue {
  return { recordId: row.record_id };
}

function tablesExist(db: Database, tableNames: string[]): boolean {
  return tableNames.every((tableName) => tableExists(db, tableName));
}

function tableExists(db: Database, tableName: string): boolean {
  const row = db
    .query<
      { count: number },
      [string]
    >("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);
  return (row?.count ?? 0) > 0;
}

async function analyzeLegacyClassificationMigration(
  options: HealthServiceOptions,
  timestamp: Date,
): Promise<HealthIssue[]> {
  if (options.classificationMigrationProvider?.getLegacyClassificationMigrationDetails) {
    let details: Awaited<
      ReturnType<NonNullable<TaxonomyService["getLegacyClassificationMigrationDetails"]>>
    >;
    try {
      details =
        await options.classificationMigrationProvider.getLegacyClassificationMigrationDetails();
    } catch (error) {
      options.warn?.(
        `Failed to load legacy classification migration details: ${formatErrorMessage(error)}`,
      );
      return [];
    }
    if (details.assetsNeedingMigration.length === 0) {
      return [];
    }
    const affectedItems = details.assetsNeedingMigration.map((asset) => ({
      id: asset.id,
      name: asset.name ?? asset.symbol,
      symbol: asset.symbol,
      route: `/holdings/${encodeURIComponent(asset.id)}`,
    }));
    return [
      legacyClassificationMigrationIssue({
        count: details.assetsNeedingMigration.length,
        dataHash: computeDataHashWithI32(
          details.assetsNeedingMigration.map((asset) => asset.id),
          details.assetsAlreadyMigrated,
        ),
        timestamp,
        affectedItems,
      }),
    ];
  }

  if (!options.classificationMigrationProvider?.getMigrationStatus) {
    return [];
  }

  let status: Awaited<ReturnType<NonNullable<TaxonomyService["getMigrationStatus"]>>>;
  try {
    status = await options.classificationMigrationProvider.getMigrationStatus();
  } catch (error) {
    options.warn?.(
      `Failed to load legacy classification migration status: ${formatErrorMessage(error)}`,
    );
    return [];
  }
  if (!status.needed || status.assetsWithLegacyData <= 0) {
    return [];
  }

  const count = status.assetsWithLegacyData;
  const dataHash = computeDataHash([
    "legacy_migration",
    String(status.assetsWithLegacyData),
    String(status.assetsAlreadyMigrated),
  ]);

  return [legacyClassificationMigrationIssue({ count, dataHash, timestamp })];
}

function legacyClassificationMigrationIssue(input: {
  count: number;
  dataHash: string;
  timestamp: Date;
  affectedItems?: AffectedItem[];
}): HealthIssue {
  return {
    id: `classification:legacy_migration:${input.dataHash}`,
    severity: "WARNING",
    category: "CLASSIFICATION",
    title:
      input.count === 1
        ? "1 asset has legacy classification data"
        : `${input.count} assets have legacy classification data`,
    message:
      "Some assets have sector/country data from the old format. Migrate to the new taxonomy system for better allocation tracking.",
    affectedCount: input.count,
    affectedItems: input.affectedItems,
    fixAction: { id: "migrate_legacy_classifications", label: "Start Migration", payload: null },
    navigateAction: { route: "/settings/taxonomies", label: "View Classifications" },
    dataHash: input.dataHash,
    timestamp: toRustSerdeUtcRfc3339(input.timestamp),
  };
}

function filterDismissedIssues(
  repository: HealthRepository,
  issues: HealthIssue[],
  warn?: (message: string) => void,
): HealthIssue[] {
  const dismissals = new Map(
    repository.getDismissals().map((dismissal) => [dismissal.issueId, dismissal]),
  );
  const filtered: HealthIssue[] = [];
  for (const issue of issues) {
    const dismissal = dismissals.get(issue.id);
    if (!dismissal) {
      filtered.push(issue);
      continue;
    }
    if (dismissal.dataHash !== issue.dataHash) {
      try {
        repository.removeDismissal(issue.id);
      } catch (error) {
        warn?.(`Failed to remove stale dismissal: ${formatErrorMessage(error)}`);
      }
      filtered.push(issue);
    }
  }
  return filtered;
}

function buildStatus(issues: HealthIssue[], checkedAt: Date): HealthStatus {
  const issueCounts: Partial<Record<HealthSeverity, number>> = {};
  let overallSeverity: HealthSeverity = "INFO";

  for (const issue of issues) {
    issueCounts[issue.severity] = (issueCounts[issue.severity] ?? 0) + 1;
    if (severityRank(issue.severity) > severityRank(overallSeverity)) {
      overallSeverity = issue.severity;
    }
  }

  return {
    overallSeverity,
    issueCounts,
    issues,
    checkedAt: toRustSerdeUtcRfc3339(checkedAt),
    isStale: false,
  };
}

function cloneStatus(status: HealthStatus, isStale = status.isStale): HealthStatus {
  return {
    ...status,
    issueCounts: { ...status.issueCounts },
    issues: status.issues.map((issue) => ({
      ...issue,
      fixAction: issue.fixAction ? { ...issue.fixAction } : undefined,
      navigateAction: issue.navigateAction ? { ...issue.navigateAction } : undefined,
      affectedItems: issue.affectedItems?.map((item) => ({ ...item })),
    })),
    isStale,
  };
}

function severityRank(severity: HealthSeverity): number {
  return SEVERITY_ORDER.indexOf(severity);
}

function normalizeTimezone(timezone: string | undefined): string | null {
  const trimmed = timezone?.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: trimmed }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

function areEffectivelySameTimezone(
  configuredTimezone: string,
  clientTimezone: string,
  now: Date,
): boolean {
  if (configuredTimezone === clientTimezone) {
    return true;
  }
  const currentYear = now.getUTCFullYear();
  for (const year of [currentYear, currentYear + 1]) {
    for (let month = 0; month < 12; month += 1) {
      const sample = new Date(Date.UTC(year, month, 1, 12, 0, 0));
      if (timezoneOffset(configuredTimezone, sample) !== timezoneOffset(clientTimezone, sample)) {
        return false;
      }
    }
  }
  return true;
}

function timezoneOffset(timezone: string, date: Date): string {
  const timeZoneName = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "longOffset",
  })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value;
  return timeZoneName ?? "";
}

function computeDataHash(values: string[]): string {
  return computeRustHealthDataHash((hasher) => writeSortedRustStrings(hasher, values));
}

function computeDataHashWithSeverity(values: string[], severity: HealthSeverity): string {
  return computeRustHealthDataHash((hasher) => {
    writeSortedRustStrings(hasher, values);
    hasher.writeString(severity);
  });
}

function computeDataHashWithSeverityAndMvPct(
  values: string[],
  severity: HealthSeverity,
  mvPct: number,
): string {
  return computeRustHealthDataHash((hasher) => {
    writeSortedRustStrings(hasher, values);
    hasher.writeString(severity);
    hasher.writeU32(saturatingF64ToU32(mvPct * 100));
  });
}

function computeDataHashWithI32(values: string[], value: number): string {
  return computeRustHealthDataHash((hasher) => {
    writeSortedRustStrings(hasher, values);
    hasher.writeI32(value);
  });
}

function writeSortedRustStrings(hasher: RustDefaultHasher, values: string[]): void {
  for (const value of [...values].sort()) {
    hasher.writeString(value);
  }
}

function computeRustHealthDataHash(write: (hasher: RustDefaultHasher) => void): string {
  const hasher = new RustDefaultHasher();
  write(hasher);
  return hasher.finish();
}

function saturatingF64ToU32(value: number): number {
  if (Number.isNaN(value) || value <= 0) {
    return 0;
  }
  if (value >= RUST_HASH_U32_MAX) {
    return RUST_HASH_U32_MAX;
  }
  return Math.trunc(value);
}

// Matches Rust's current `DefaultHasher` so issue IDs and dismissal hashes
// created by the Rust backend carry over into the TS runtime.
class RustDefaultHasher {
  private v0 = 0x736f6d6570736575n;
  private v1 = 0x646f72616e646f6dn;
  private v2 = 0x6c7967656e657261n;
  private v3 = 0x7465646279746573n;
  private byteLength = 0;
  private tail = 0n;
  private tailLength = 0;

  writeString(value: string): void {
    this.writeBytes(TEXT_ENCODER.encode(value));
    this.writeByte(RUST_HASH_STR_TERMINATOR);
  }

  writeU32(value: number): void {
    const normalized = value >>> 0;
    this.writeByte(normalized & 0xff);
    this.writeByte((normalized >>> 8) & 0xff);
    this.writeByte((normalized >>> 16) & 0xff);
    this.writeByte((normalized >>> 24) & 0xff);
  }

  writeI32(value: number): void {
    const normalized = value | 0;
    this.writeByte(normalized & 0xff);
    this.writeByte((normalized >> 8) & 0xff);
    this.writeByte((normalized >> 16) & 0xff);
    this.writeByte((normalized >> 24) & 0xff);
  }

  finish(): string {
    const finalBlock = ((BigInt(this.byteLength) & 0xffn) << 56n) | this.tail;
    this.compress(finalBlock);
    this.v2 ^= 0xffn;
    this.sipRound();
    this.sipRound();
    this.sipRound();
    return (this.v0 ^ this.v1 ^ this.v2 ^ this.v3).toString(16);
  }

  private writeBytes(bytes: Uint8Array): void {
    for (const byte of bytes) {
      this.writeByte(byte);
    }
  }

  private writeByte(byte: number): void {
    this.tail |= BigInt(byte & 0xff) << BigInt(this.tailLength * 8);
    this.tailLength += 1;
    this.byteLength += 1;
    if (this.tailLength === 8) {
      this.compress(this.tail);
      this.tail = 0n;
      this.tailLength = 0;
    }
  }

  private compress(block: bigint): void {
    this.v3 ^= block;
    this.sipRound();
    this.v0 ^= block;
  }

  private sipRound(): void {
    this.v0 = u64(this.v0 + this.v1);
    this.v1 = rotateLeft64(this.v1, 13n);
    this.v1 ^= this.v0;
    this.v0 = rotateLeft64(this.v0, 32n);

    this.v2 = u64(this.v2 + this.v3);
    this.v3 = rotateLeft64(this.v3, 16n);
    this.v3 ^= this.v2;

    this.v0 = u64(this.v0 + this.v3);
    this.v3 = rotateLeft64(this.v3, 21n);
    this.v3 ^= this.v0;

    this.v2 = u64(this.v2 + this.v1);
    this.v1 = rotateLeft64(this.v1, 17n);
    this.v1 ^= this.v2;
    this.v2 = rotateLeft64(this.v2, 32n);
  }
}

function rotateLeft64(value: bigint, shift: bigint): bigint {
  return u64((value << shift) | (value >> (64n - shift)));
}

function u64(value: bigint): bigint {
  return value & U64_MASK;
}

function validateHealthConfig(config: HealthConfig): void {
  validateU32(config.priceStaleWarningHours, "price_stale_warning_hours");
  validateU32(config.priceStaleCriticalHours, "price_stale_critical_hours");
  validateU32(config.fxStaleWarningHours, "fx_stale_warning_hours");
  validateU32(config.fxStaleCriticalHours, "fx_stale_critical_hours");
  validateFinite(config.mvEscalationThreshold, "mv_escalation_threshold");
  validateFinite(config.classificationWarnThreshold, "classification_warn_threshold");

  if (config.priceStaleWarningHours === 0) {
    throw new Error("Invalid input: price_stale_warning_hours must be > 0");
  }
  if (config.priceStaleWarningHours >= config.priceStaleCriticalHours) {
    throw new Error(
      "Invalid input: price_stale_warning_hours must be < price_stale_critical_hours",
    );
  }
  if (config.fxStaleWarningHours === 0) {
    throw new Error("Invalid input: fx_stale_warning_hours must be > 0");
  }
  if (config.fxStaleWarningHours >= config.fxStaleCriticalHours) {
    throw new Error("Invalid input: fx_stale_warning_hours must be < fx_stale_critical_hours");
  }
}

function validateU32(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 4_294_967_295) {
    throw new Error(`Invalid input: ${field} must be a u32 integer`);
  }
}

function validateFinite(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid input: ${field} must be finite`);
  }
}

function dismissalFromRow(row: DismissalRow): IssueDismissal {
  return {
    issueId: row.issue_id,
    dismissedAt: parseTimestampOrNow(row.dismissed_at),
    dataHash: row.data_hash,
  };
}

function parseTimestampOrNow(value: string): string {
  const parsed = parseRustRfc3339Timestamp(value);
  return parsed === null ? timestampNow() : toRustUtcRfc3339(parsed);
}

function timestampNow(): string {
  return toRustUtcRfc3339(new Date());
}

function parseRustRfc3339Timestamp(value: string): Date | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?([Zz]|([+-])(\d{2}):?(\d{2}))$/u.exec(
      value,
    );
  if (!match) {
    return null;
  }
  const [
    ,
    yearRaw,
    monthRaw,
    dayRaw,
    hourRaw,
    minuteRaw,
    secondRaw,
    fractionRaw,
    zoneRaw,
    signRaw,
    zoneHourRaw,
    zoneMinuteRaw,
  ] = match;
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const second = Number(secondRaw);
  const millisecond = Number((fractionRaw ?? "").padEnd(3, "0").slice(0, 3));
  const zoneHour = Number(zoneHourRaw);
  const zoneMinute = Number(zoneMinuteRaw ?? "0");
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 60 ||
    zoneHour > 23 ||
    zoneMinute > 59
  ) {
    return null;
  }
  const localMs = Date.UTC(2000, 0, 1, hour, minute, Math.min(second, 59), millisecond);
  const local = new Date(localMs);
  local.setUTCFullYear(year, month - 1, day);
  if (
    Number.isNaN(local.valueOf()) ||
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() !== month - 1 ||
    local.getUTCDate() !== day
  ) {
    return null;
  }
  const offsetMinutes = /^[Zz]$/u.test(zoneRaw)
    ? 0
    : Number(`${signRaw ?? "+"}1`) * (zoneHour * 60 + zoneMinute);
  const parsed = new Date(local.getTime() - offsetMinutes * 60_000);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function toRustUtcRfc3339(date: Date): string {
  const iso = date.toISOString();
  if (iso.endsWith(".000Z")) {
    return `${iso.slice(0, -5)}+00:00`;
  }
  return iso.replace(/Z$/u, "+00:00");
}

function toRustSerdeUtcRfc3339(date: Date): string {
  const iso = date.toISOString();
  if (iso.endsWith(".000Z")) {
    return `${iso.slice(0, -5)}Z`;
  }
  return iso;
}

function timestampNowDate(): Date {
  return new Date();
}
