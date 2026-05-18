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

export interface HealthRepository {
  saveDismissal(issueId: string, dataHash: string): IssueDismissal;
  removeDismissal(issueId: string): void;
  getDismissals(): IssueDismissal[];
  getDismissal(issueId: string): IssueDismissal | null;
}

export interface HealthService {
  dismissIssue(issueId: string, dataHash: string): Promise<void>;
  restoreIssue(issueId: string): Promise<void>;
  getDismissedIds(): Promise<string[]>;
  getConfig(): Promise<HealthConfig>;
  updateConfig(config: HealthConfig): Promise<void>;
  getCachedHealthStatus?(clientTimezone?: string): HealthStatus | null;
  getHealthStatus?(clientTimezone?: string): Promise<HealthStatus> | HealthStatus;
  runHealthChecks?(clientTimezone?: string): Promise<HealthStatus> | HealthStatus;
  executeFix?(action: HealthFixAction): Promise<void> | void;
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
const HASH_OFFSET_BASIS = 0xcbf29ce484222325n;
const HASH_PRIME = 0x100000001b3n;
const HASH_MASK = 0xffffffffffffffffn;

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
  };
}

export function createHealthService(
  repository: HealthRepository,
  initialConfig: HealthConfig = DEFAULT_HEALTH_CONFIG,
  options: HealthServiceOptions = {},
): HealthService {
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
  const issues = filterDismissedIssues(repository, [
    ...analyzeUnconfiguredAccounts(options, checkedAt),
    ...(await analyzePriceStaleness(options, config, checkedAt)),
    ...(await analyzeQuoteSyncErrors(options, config, checkedAt)),
    ...(await analyzeFxIntegrity(options, config, checkedAt)),
    ...(await analyzeDataConsistency(options, checkedAt)),
    ...(await analyzeLegacyClassificationMigration(options, checkedAt)),
    ...analyzeTimezone(options, clientTimezone, checkedAt),
  ]);
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
      timestamp: timestamp.toISOString(),
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
        timestamp: timestamp.toISOString(),
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
        timestamp: timestamp.toISOString(),
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
      timestamp: timestamp.toISOString(),
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

  const latestQuotes = await options.marketDataQuoteProvider.getLatestQuotes(
    holdings.map((holding) => holding.assetId),
  );
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
  const dataHash = computeDataHash([
    ...assetIds,
    severity,
    String(Math.trunc(affectedMvPct * 100)),
  ]);

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
      timestamp: input.timestamp.toISOString(),
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
  const parts = value.split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error(`Invalid date: ${value}`);
  }
  return new Date(Date.UTC(year, month - 1, day));
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

interface QuoteSyncHealthError {
  assetId: string;
  symbol: string;
  errorCount: number;
  lastError: string | null;
  marketValue: number;
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
  const syncErrors = (await options.marketDataQuoteProvider.getQuoteSyncErrorSnapshots())
    .filter((snapshot) => snapshot.quoteMode.toUpperCase() !== "MANUAL")
    .map((snapshot) => ({
      assetId: snapshot.assetId,
      symbol: snapshot.symbol,
      errorCount: snapshot.errorCount,
      lastError: snapshot.lastError,
      marketValue: holdingMarketValues.get(snapshot.assetId) ?? 0,
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
  const dataHash = computeDataHash([...assetIds, severity]);

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
      timestamp: input.timestamp.toISOString(),
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

  const latestFxRates = fxSnapshotsByPair(options.exchangeRateProvider.getLatestFxRateSnapshots());
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
    const quoteTime = new Date(pair.latestQuoteTimestamp);
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
  const dataHash = computeDataHash([...pairIds, severity, String(Math.trunc(affectedMvPct * 100))]);

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
      timestamp: input.timestamp.toISOString(),
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
  options: HealthServiceOptions,
  timestamp: Date,
): Promise<HealthIssue[]> {
  if (!options.valuationProvider?.getAccountsWithNegativeBalance) {
    return [];
  }
  const accounts = getPortfolioHealthAccounts(options);
  if (!accounts) {
    return [];
  }
  const accountNameById = new Map(accounts.map((account) => [account.id, account.name]));
  const investmentAccountIds = accounts
    .filter((account) => account.accountType !== "CASH")
    .map((account) => account.id);
  const cashAccountIds = accounts
    .filter((account) => account.accountType === "CASH")
    .map((account) => account.id);
  const [negativeInvestmentAccounts, negativeCashAccounts] = await Promise.all([
    getNegativeBalanceIssues(options.valuationProvider, investmentAccountIds, accountNameById),
    getNegativeBalanceIssues(options.valuationProvider, cashAccountIds, accountNameById),
  ]);

  return [
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

async function getNegativeBalanceIssues(
  provider: NegativeBalanceProvider,
  accountIds: string[],
  accountNameById: Map<string, string>,
): Promise<NegativeBalanceIssue[]> {
  if (accountIds.length === 0) {
    return [];
  }
  const rows = await provider.getAccountsWithNegativeBalance(accountIds);
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
      timestamp: input.timestamp.toISOString(),
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

async function analyzeLegacyClassificationMigration(
  options: HealthServiceOptions,
  timestamp: Date,
): Promise<HealthIssue[]> {
  if (options.classificationMigrationProvider?.getLegacyClassificationMigrationDetails) {
    const details =
      await options.classificationMigrationProvider.getLegacyClassificationMigrationDetails();
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
        dataHash: computeDataHash([
          "legacy_migration",
          ...details.assetsNeedingMigration.map((asset) => asset.id).sort(),
          String(details.assetsAlreadyMigrated),
        ]),
        timestamp,
        affectedItems,
      }),
    ];
  }

  if (!options.classificationMigrationProvider?.getMigrationStatus) {
    return [];
  }

  const status = await options.classificationMigrationProvider.getMigrationStatus();
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
    timestamp: input.timestamp.toISOString(),
  };
}

function filterDismissedIssues(repository: HealthRepository, issues: HealthIssue[]): HealthIssue[] {
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
      repository.removeDismissal(issue.id);
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
    checkedAt: checkedAt.toISOString(),
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
  const encoder = new TextEncoder();
  let hash = HASH_OFFSET_BASIS;
  for (const value of [...values].sort()) {
    for (const byte of encoder.encode(`${value}\0`)) {
      hash ^= BigInt(byte);
      hash = (hash * HASH_PRIME) & HASH_MASK;
    }
  }
  return hash.toString(16).padStart(16, "0");
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
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? timestampNow() : parsed.toISOString();
}

function timestampNow(): string {
  return new Date().toISOString();
}

function timestampNowDate(): Date {
  return new Date();
}
