import type { Database } from "bun:sqlite";

import Decimal from "decimal.js";

import type { BackendEventBus } from "../events";
import type { ExchangeRateService } from "./exchange-rates";
import type { HealthService } from "./health";
import type { MarketDataService, MarketDataSyncResult } from "./market-data";

export type MarketSyncMode =
  | { type: "none" }
  | { type: "incremental"; asset_ids: string[] | null }
  | { type: "refetch_recent"; asset_ids: string[] | null; days: number }
  | { type: "backfill_history"; asset_ids: string[] | null; days: number };

export type SnapshotRecalcMode = "incremental_from_last" | "full";
export type ValuationRecalcMode = "incremental_from_last" | "full";

export interface PortfolioRequestBody {
  accountIds?: string[] | null;
  marketSyncMode?: MarketSyncMode;
}

export interface PortfolioJobConfig {
  accountIds: string[] | null;
  marketSyncMode: MarketSyncMode;
  snapshotMode: SnapshotRecalcMode;
  valuationMode: ValuationRecalcMode;
  sinceDate: string | null;
}

export interface PortfolioJobService {
  enqueuePortfolioJob(config: PortfolioJobConfig): Promise<void> | void;
}

export interface LocalPortfolioJobServiceOptions {
  eventBus?: BackendEventBus;
  exchangeRateService?: Pick<ExchangeRateService, "getExchangeRateForDate" | "initialize">;
  healthService?: Pick<HealthService, "clearCache">;
  marketDataService?: Pick<
    MarketDataService,
    "syncMarketData" | "updatePositionStatusFromHoldings"
  >;
  baseCurrency?: string | (() => string | undefined);
  timezone?: string | (() => string | undefined);
  now?: () => Date;
  warn?: (message: string) => void;
}

export const DEFAULT_HISTORY_DAYS = 1_825;
const PORTFOLIO_TOTAL_ACCOUNT_ID = "TOTAL";
const MARKET_SYNC_START = "market:sync-start";
const MARKET_SYNC_COMPLETE = "market:sync-complete";
const MARKET_SYNC_ERROR = "market:sync-error";
const PORTFOLIO_UPDATE_START = "portfolio:update-start";
const PORTFOLIO_UPDATE_COMPLETE = "portfolio:update-complete";
const PORTFOLIO_UPDATE_ERROR = "portfolio:update-error";
const DECIMAL_PRECISION = 8;
const SNAPSHOT_SOURCE_CALCULATED = "CALCULATED";
const TRACKING_MODE_TRANSACTIONS = "TRANSACTIONS";
const POSTED_ACTIVITY_STATUS = "POSTED";

interface PortfolioAccountRow {
  id: string;
  currency: string;
  is_archived: number;
  tracking_mode: string;
}

interface SnapshotRow {
  id: string;
  account_id: string;
  snapshot_date: string;
  currency: string;
  positions: string;
  cash_balances: string;
  cost_basis: string;
  net_contribution: string;
  net_contribution_base: string | null;
  cash_total_account_currency?: string;
  cash_total_base_currency?: string;
  calculated_at?: string;
}

interface QuoteRow {
  asset_id: string;
  day: string;
  close: string;
  currency: string;
  timestamp: string;
}

interface SnapshotPosition {
  id?: unknown;
  accountId?: unknown;
  account_id?: unknown;
  assetId?: unknown;
  asset_id?: unknown;
  quantity?: unknown;
  averageCost?: unknown;
  average_cost?: unknown;
  totalCostBasis?: unknown;
  total_cost_basis?: unknown;
  currency?: unknown;
  inceptionDate?: unknown;
  inception_date?: unknown;
  createdAt?: unknown;
  created_at?: unknown;
  lastUpdated?: unknown;
  last_updated?: unknown;
  isAlternative?: unknown;
  is_alternative?: unknown;
  contractMultiplier?: unknown;
  contract_multiplier?: unknown;
  lots?: unknown;
}

interface ParsedSnapshot {
  row: SnapshotRow;
  positions: Map<string, NormalizedPosition>;
  cashBalances: Map<string, Decimal>;
  costBasis: Decimal;
  netContribution: Decimal;
  netContributionBase: Decimal | null;
}

interface NormalizedPosition {
  id: string;
  accountId: string;
  assetId: string;
  quantity: Decimal;
  averageCost: Decimal;
  totalCostBasis: Decimal;
  currency: string;
  inceptionDate: string;
  createdAt: string;
  lastUpdated: string;
  isAlternative: boolean;
  contractMultiplier: Decimal;
  lots: unknown[];
}

interface RebuildLot {
  id: string;
  quantity: Decimal;
  costBasis: Decimal;
  acquisitionPrice: Decimal;
  acquisitionFees: Decimal;
  acquisitionDate: string;
}

interface ActivityRebuildPosition extends NormalizedPosition {
  lots: RebuildLot[];
}

interface ActivityRebuildState {
  accountId: string;
  currency: string;
  positions: Map<string, ActivityRebuildPosition>;
  cashBalances: Map<string, Decimal>;
  netContribution: Decimal;
  netContributionBase: Decimal;
}

interface ActivityReplayContext {
  account: PortfolioAccountRow;
  state: ActivityRebuildState;
  startDate: string | null;
  activitiesByDate: Map<string, ActivityRebuildRow[]>;
}

interface ActivityRebuildRow {
  id: string;
  account_id: string;
  asset_id: string | null;
  activity_type: string;
  activity_type_override: string | null;
  subtype: string | null;
  status: string;
  activity_date: string;
  quantity: string | null;
  unit_price: string | null;
  amount: string | null;
  fee: string | null;
  currency: string;
  fx_rate: string | null;
  source_group_id: string | null;
}

type SplitFactorsByAsset = Map<string, Array<[string, Decimal]>>;
type TransferLotsCache = Map<string, TransferredLotBatch[]>;
const activityDateFormatters = new Map<string, Intl.DateTimeFormat>();

interface TransferredLotBatch {
  assetId: string;
  sourceActivityId: string;
  currency: string;
  isAlternative: boolean;
  contractMultiplier: Decimal;
  lots: RebuildLot[];
}

interface AssetInfoRow {
  id: string;
  kind: string;
  quote_ccy: string | null;
  instrument_type: string | null;
  metadata: string | null;
}

interface CalculatedValuation {
  id: string;
  accountId: string;
  valuationDate: string;
  accountCurrency: string;
  baseCurrency: string;
  fxRateToBase: Decimal;
  cashBalance: Decimal;
  investmentMarketValue: Decimal;
  totalValue: Decimal;
  costBasis: Decimal;
  netContribution: Decimal;
  calculatedAt: string;
}

export class PortfolioJobNotImplementedError extends Error {
  readonly status = 501;
  readonly code = "not_implemented";

  constructor(message: string) {
    super(message);
    this.name = "PortfolioJobNotImplementedError";
  }
}

const PORTFOLIO_JOB_DEFERRED_MESSAGE =
  "Portfolio job execution is not yet available in the TS backend runtime.";

export function createDeferredPortfolioJobService(): PortfolioJobService {
  return {
    async enqueuePortfolioJob() {
      throw new PortfolioJobNotImplementedError(PORTFOLIO_JOB_DEFERRED_MESSAGE);
    },
  };
}

export function createLocalPortfolioJobService(
  db: Database,
  options: LocalPortfolioJobServiceOptions = {},
): PortfolioJobService {
  return {
    async enqueuePortfolioJob(config) {
      await executePortfolioJob(db, config, options);
    },
  };
}

export function buildPortfolioUpdateConfig(body: PortfolioRequestBody = {}): PortfolioJobConfig {
  const marketSyncMode =
    body.marketSyncMode && body.marketSyncMode.type !== "none"
      ? body.marketSyncMode
      : { type: "incremental" as const, asset_ids: null };
  return {
    accountIds: body.accountIds ?? null,
    marketSyncMode,
    snapshotMode: "incremental_from_last",
    valuationMode: "incremental_from_last",
    sinceDate: null,
  };
}

async function executePortfolioJob(
  db: Database,
  config: PortfolioJobConfig,
  options: LocalPortfolioJobServiceOptions,
): Promise<void> {
  if (config.marketSyncMode.type !== "none" && options.marketDataService?.syncMarketData) {
    await reconcileQuoteSyncFromLatestTotalSnapshot(db, options, "latest holdings");
    options.eventBus?.publish({ name: MARKET_SYNC_START });
    let syncResult: MarketDataSyncResult | void;
    try {
      syncResult = await options.marketDataService.syncMarketData(config.marketSyncMode);
    } catch (error) {
      options.eventBus?.publish({
        name: MARKET_SYNC_ERROR,
        payload: errorMessage(error),
      });
      throw error;
    }
    options.eventBus?.publish({
      name: MARKET_SYNC_COMPLETE,
      payload: marketSyncCompletePayload(syncResult),
    });
    clearHealthCacheAfterMarketSync(options);
    try {
      options.exchangeRateService?.initialize();
    } catch (error) {
      options.warn?.(
        `Failed to initialize FxService after market data sync: ${errorMessage(error)}`,
      );
    }
  }

  options.eventBus?.publish({ name: PORTFOLIO_UPDATE_START });
  try {
    recalculatePortfolioFromExistingSnapshots(db, config, options);
    await reconcileQuoteSyncFromLatestTotalSnapshot(db, options, "holdings");
    options.eventBus?.publish({ name: PORTFOLIO_UPDATE_COMPLETE });
  } catch (error) {
    options.eventBus?.publish({
      name: PORTFOLIO_UPDATE_ERROR,
      payload: errorMessage(error),
    });
    throw error;
  }
}

function clearHealthCacheAfterMarketSync(options: LocalPortfolioJobServiceOptions): void {
  try {
    options.healthService?.clearCache();
  } catch (error) {
    options.warn?.(`Failed to clear health cache after market data sync: ${errorMessage(error)}`);
  }
}

function marketSyncCompletePayload(result: MarketDataSyncResult | void): {
  failed_syncs: Array<[string, string]>;
  skipped_reasons: Array<[string, string]>;
} {
  return {
    failed_syncs: result?.failures ?? [],
    skipped_reasons: result?.skippedReasons ?? [],
  };
}

function recalculatePortfolioFromExistingSnapshots(
  db: Database,
  config: PortfolioJobConfig,
  options: LocalPortfolioJobServiceOptions,
): void {
  const run = db.transaction(() => {
    const baseCurrency = resolveBaseCurrency(options);
    const nowIso = (options.now ?? (() => new Date()))().toISOString();
    const accounts = readPortfolioAccounts(db);
    const accountById = new Map(accounts.map((account) => [account.id, account]));
    const nonArchivedAccountIds = accounts
      .filter((account) => account.is_archived === 0)
      .map((account) => account.id);
    const targetAccountIds = (config.accountIds ?? nonArchivedAccountIds).filter(
      (accountId) => accountId !== PORTFOLIO_TOTAL_ACCOUNT_ID,
    );
    const targetAccounts = targetAccountIds.flatMap((accountId) => {
      const account = accountById.get(accountId);
      return account ? [account] : [];
    });

    rebuildCalculatedSnapshotsFromActivities(
      db,
      targetAccounts,
      config,
      baseCurrency,
      nowIso,
      options,
    );

    for (const accountId of targetAccountIds) {
      calculateAndStoreAccountValuations(db, accountId, config, baseCurrency, nowIso, options);
    }

    refreshTotalSnapshots(db, nonArchivedAccountIds, config, baseCurrency, nowIso, options);
    calculateAndStoreAccountValuations(
      db,
      PORTFOLIO_TOTAL_ACCOUNT_ID,
      config,
      baseCurrency,
      nowIso,
      options,
    );
  });
  run();
}

async function reconcileQuoteSyncFromLatestTotalSnapshot(
  db: Database,
  options: LocalPortfolioJobServiceOptions,
  sourceLabel: string,
): Promise<void> {
  if (!options.marketDataService?.updatePositionStatusFromHoldings) {
    return;
  }
  const snapshot = readLatestTotalSnapshot(db);
  if (!snapshot) {
    return;
  }
  const holdings = new Map<string, Decimal>(
    Array.from(snapshot.positions, ([assetId, position]) => [assetId, position.quantity]),
  );
  try {
    await options.marketDataService.updatePositionStatusFromHoldings(holdings);
  } catch (error) {
    options.warn?.(
      `Failed to update position status from ${sourceLabel}: ${errorMessage(error)}. Quote sync planning may be affected.`,
    );
  }
}

function calculateAndStoreAccountValuations(
  db: Database,
  accountId: string,
  config: PortfolioJobConfig,
  baseCurrency: string,
  calculatedAt: string,
  options: LocalPortfolioJobServiceOptions,
): void {
  const startDate = valuationStartDate(db, accountId, config);
  const snapshots = readSnapshots(db, accountId, startDate);
  const assetIds = snapshotAssetIds(snapshots);
  const latestSnapshotDate = snapshots.at(-1)?.row.snapshot_date ?? startDate;
  const assetsWithQuotes = readAssetsWithQuotes(db, assetIds, latestSnapshotDate);
  const valuations = snapshots.flatMap((snapshot) => {
    const valuation = calculateValuationForSnapshot(
      db,
      snapshot,
      baseCurrency,
      calculatedAt,
      assetsWithQuotes,
      options,
    );
    return valuation ? [valuation] : [];
  });

  deleteValuationsForMode(db, accountId, config, startDate);
  for (const valuation of valuations) {
    upsertValuation(db, valuation);
  }
}

function refreshTotalSnapshots(
  db: Database,
  nonArchivedAccountIds: string[],
  config: PortfolioJobConfig,
  baseCurrency: string,
  calculatedAt: string,
  options: LocalPortfolioJobServiceOptions,
): void {
  const startDate = totalSnapshotStartDate(db, config);
  const existingSnapshots = readIndividualSnapshotsForTotal(db, nonArchivedAccountIds);
  const snapshotsByAccount = groupSnapshotsByAccount(existingSnapshots);
  const allDates = uniqueSortedDates(existingSnapshots).filter(
    (date) => !startDate || date >= startDate,
  );
  const totalSnapshots = allDates.flatMap((date) => {
    const snapshotsForDate = latestSnapshotsOnOrBeforeDate(snapshotsByAccount, date);
    if (snapshotsForDate.length === 0) {
      return [];
    }
    return [buildTotalSnapshot(date, snapshotsForDate, baseCurrency, calculatedAt, options)];
  });

  deleteTotalSnapshotsForMode(db, config, startDate, nonArchivedAccountIds.length);
  for (const snapshot of totalSnapshots) {
    upsertTotalSnapshot(db, snapshot);
  }
}

function readPortfolioAccounts(db: Database): PortfolioAccountRow[] {
  return db
    .query<PortfolioAccountRow, []>(
      `
        SELECT
          id,
          currency,
          is_archived,
          COALESCE(tracking_mode, 'NOT_SET') AS tracking_mode
        FROM accounts
        ORDER BY name ASC, id ASC
      `,
    )
    .all();
}

function readSnapshots(
  db: Database,
  accountId: string,
  startDate: string | null,
): ParsedSnapshot[] {
  const conditions = ["account_id = ?"];
  const params = [accountId];
  if (startDate) {
    conditions.push("snapshot_date >= ?");
    params.push(startDate);
  }

  return db
    .query<SnapshotRow, string[]>(
      `
        SELECT
          id,
          account_id,
          snapshot_date,
          currency,
          positions,
          cash_balances,
          cost_basis,
          net_contribution,
          net_contribution_base
        FROM holdings_snapshots
        WHERE ${conditions.join(" AND ")}
        ORDER BY snapshot_date ASC
      `,
    )
    .all(...params)
    .map(parseSnapshot);
}

function readLatestTotalSnapshot(db: Database): ParsedSnapshot | null {
  const row =
    db
      .query<SnapshotRow, [string]>(
        `
          SELECT
            id,
            account_id,
            snapshot_date,
            currency,
            positions,
            cash_balances,
            cost_basis,
            net_contribution,
            net_contribution_base
          FROM holdings_snapshots
          WHERE account_id = ?
          ORDER BY snapshot_date DESC, calculated_at DESC
          LIMIT 1
        `,
      )
      .get(PORTFOLIO_TOTAL_ACCOUNT_ID) ?? null;
  return row ? parseSnapshot(row) : null;
}

function readIndividualSnapshotsForTotal(db: Database, accountIds: string[]): ParsedSnapshot[] {
  if (accountIds.length === 0) {
    return [];
  }
  const placeholders = accountIds.map(() => "?").join(", ");
  return db
    .query<SnapshotRow, string[]>(
      `
        SELECT
          id,
          account_id,
          snapshot_date,
          currency,
          positions,
          cash_balances,
          cost_basis,
          net_contribution,
          net_contribution_base
        FROM holdings_snapshots
        WHERE account_id IN (${placeholders})
          AND account_id != ?
        ORDER BY account_id ASC, snapshot_date ASC
      `,
    )
    .all(...accountIds, PORTFOLIO_TOTAL_ACCOUNT_ID)
    .map(parseSnapshot);
}

function rebuildCalculatedSnapshotsFromActivities(
  db: Database,
  accounts: PortfolioAccountRow[],
  config: PortfolioJobConfig,
  baseCurrency: string,
  calculatedAt: string,
  options: LocalPortfolioJobServiceOptions,
): void {
  const transactionAccounts = accounts.filter(
    (account) => account.tracking_mode === TRACKING_MODE_TRANSACTIONS,
  );
  const activitiesByAccount = readPostedActivitiesForAccounts(
    db,
    transactionAccounts.map((account) => account.id),
  );
  const timezone = resolveTimezone(options);
  const splitFactors = calculateSplitFactors(
    Array.from(activitiesByAccount.values()).flat(),
    options,
    timezone,
  );
  const contexts = transactionAccounts.map((account) =>
    prepareAccountActivityReplayContext(
      db,
      account,
      activitiesByAccount.get(account.id) ?? [],
      splitFactors,
      config,
      timezone,
    ),
  );
  const replayContexts: Array<{ context: ActivityReplayContext; startDate: string }> = [];
  for (const context of contexts) {
    const startDate = activityReplayStartDate(context);
    if (startDate) {
      replayContexts.push({ context, startDate });
    }
  }
  const replayStartDate = replayContexts
    .map((entry) => entry.startDate)
    .sort()
    .at(0);
  const replayDates = replayStartDate
    ? dateRangeInclusive(replayStartDate, calculatedAt.slice(0, 10))
    : [];
  const transferLotsCache: TransferLotsCache = new Map();

  for (const context of contexts) {
    deleteCalculatedSnapshotsForActivityRebuild(db, context.account.id, context.startDate);
  }

  for (const date of replayDates) {
    const contextsForDate = replayContexts
      .filter((entry) => entry.startDate <= date)
      .map((entry) => entry.context);
    for (const context of orderReplayContextsByTransferDeps(contextsForDate, date, options)) {
      const activitiesForDate = orderActivitiesByTransferDeps(
        context.activitiesByDate.get(date) ?? [],
        options,
        timezone,
      );
      for (const activity of activitiesForDate) {
        processActivityForSnapshot(
          db,
          context.state,
          activity,
          baseCurrency,
          options,
          transferLotsCache,
        );
      }
      upsertActivityCalculatedSnapshot(
        db,
        context.state,
        date,
        baseCurrency,
        calculatedAt,
        options,
      );
    }
  }
  warnForUnpairedTransferredLots(transferLotsCache, options);
}

function activityReplayStartDate(context: ActivityReplayContext): string | null {
  if (context.startDate) {
    return context.startDate;
  }
  return Array.from(context.activitiesByDate.keys()).sort().at(0) ?? null;
}

function dateRangeInclusive(startDate: string, endDate: string): string[] {
  if (startDate > endDate) {
    return [];
  }
  const dates: string[] = [];
  for (let date = startDate; date <= endDate; date = nextDate(date)) {
    dates.push(date);
  }
  return dates;
}

function prepareAccountActivityReplayContext(
  db: Database,
  account: PortfolioAccountRow,
  allActivities: ActivityRebuildRow[],
  splitFactors: SplitFactorsByAsset,
  config: PortfolioJobConfig,
  timezone: string,
): ActivityReplayContext {
  const requestedStartDate = activityRebuildStartDate(db, account.id, config);
  const requestedSeedSnapshot = requestedStartDate
    ? readLatestSnapshotBeforeDate(db, account.id, requestedStartDate)
    : null;
  const { startDate, useSeedSnapshot } = splitAdjustedActivityStartDate(
    allActivities,
    requestedStartDate,
    requestedSeedSnapshot !== null,
    timezone,
  );
  const seedSnapshot = useSeedSnapshot
    ? requestedSeedSnapshot
    : startDate
      ? readLatestSnapshotBeforeDate(db, account.id, startDate)
      : null;
  const state = seedSnapshot
    ? activityStateFromSnapshot(account, parseSnapshot(seedSnapshot))
    : emptyActivityState(account);
  const activities = adjustActivitiesForSplits(
    compileActivitiesForReplay(filterActivitiesFromDate(allActivities, startDate, timezone)),
    splitFactors,
    timezone,
  );
  return {
    account,
    state,
    startDate,
    activitiesByDate: groupActivitiesByDate(activities, timezone),
  };
}

function activityRebuildStartDate(
  db: Database,
  accountId: string,
  config: PortfolioJobConfig,
): string | null {
  if (config.sinceDate) {
    return config.sinceDate;
  }
  if (config.snapshotMode === "full") {
    return null;
  }
  const latest = latestSnapshotDate(db, accountId);
  return latest ? nextDate(latest) : null;
}

function readLatestSnapshotBeforeDate(
  db: Database,
  accountId: string,
  date: string,
): SnapshotRow | null {
  return (
    db
      .query<SnapshotRow, [string, string]>(
        `
          SELECT
            id,
            account_id,
            snapshot_date,
            currency,
            positions,
            cash_balances,
            cost_basis,
            net_contribution,
            net_contribution_base
          FROM holdings_snapshots
          WHERE account_id = ?
            AND snapshot_date < ?
          ORDER BY snapshot_date DESC, calculated_at DESC
          LIMIT 1
        `,
      )
      .get(accountId, date) ?? null
  );
}

function readPostedActivitiesForAccounts(
  db: Database,
  accountIds: string[],
): Map<string, ActivityRebuildRow[]> {
  if (accountIds.length === 0) {
    return new Map();
  }
  const placeholders = accountIds.map(() => "?").join(", ");
  const activities = db
    .query<ActivityRebuildRow, string[]>(
      `
        SELECT
          id,
          account_id,
          asset_id,
          activity_type,
          activity_type_override,
          subtype,
          status,
          activity_date,
          quantity,
          unit_price,
          amount,
          fee,
          currency,
          fx_rate,
          source_group_id
        FROM activities
        WHERE account_id IN (${placeholders})
          AND status = '${POSTED_ACTIVITY_STATUS}'
        ORDER BY account_id ASC, activity_date ASC, id ASC
      `,
    )
    .all(...accountIds);
  const grouped = new Map<string, ActivityRebuildRow[]>();
  for (const activity of activities) {
    const existing = grouped.get(activity.account_id) ?? [];
    existing.push(activity);
    grouped.set(activity.account_id, existing);
  }
  return grouped;
}

function filterActivitiesFromDate(
  activities: ActivityRebuildRow[],
  startDate: string | null,
  timezone: string,
): ActivityRebuildRow[] {
  if (!startDate) {
    return activities;
  }
  return activities.filter((activity) => activityLocalDate(activity, timezone) >= startDate);
}

function splitAdjustedActivityStartDate(
  activities: ActivityRebuildRow[],
  requestedStartDate: string | null,
  hasSeedSnapshot: boolean,
  timezone: string,
): { startDate: string | null; useSeedSnapshot: boolean } {
  if (!requestedStartDate) {
    return { startDate: null, useSeedSnapshot: false };
  }
  const earliestActivityDate = activities.at(0) ? activityLocalDate(activities[0], timezone) : null;
  if (!hasSeedSnapshot || !earliestActivityDate || earliestActivityDate >= requestedStartDate) {
    return { startDate: requestedStartDate, useSeedSnapshot: hasSeedSnapshot };
  }
  const hasSplitInRange = activities.some(
    (activity) =>
      activity.activity_type === "SPLIT" &&
      activityLocalDate(activity, timezone) >= requestedStartDate,
  );
  return hasSplitInRange
    ? { startDate: earliestActivityDate, useSeedSnapshot: false }
    : { startDate: requestedStartDate, useSeedSnapshot: true };
}

function compileActivitiesForReplay(activities: ActivityRebuildRow[]): ActivityRebuildRow[] {
  return activities.flatMap((activity) => compileActivityForReplay(activity));
}

function compileActivityForReplay(activity: ActivityRebuildRow): ActivityRebuildRow[] {
  const activityType = activityEffectiveType(activity);
  const subtype = activity.subtype?.toUpperCase() ?? null;

  if (activityType === "DIVIDEND" && (subtype === "DRIP" || subtype === "DIVIDEND_IN_KIND")) {
    return compileAssetIncomeActivity(activity, "DIVIDEND", "dividend");
  }
  if (activityType === "INTEREST" && subtype === "STAKING_REWARD") {
    return compileAssetIncomeActivity(activity, "INTEREST", "interest");
  }
  return [activity];
}

function compileAssetIncomeActivity(
  activity: ActivityRebuildRow,
  incomeActivityType: "DIVIDEND" | "INTEREST",
  incomeIdSuffix: "dividend" | "interest",
): ActivityRebuildRow[] {
  const quantity = decimalOptionalOrDefault(
    activity.quantity,
    new Decimal(0),
    `Invalid quantity for activity ${activity.id}`,
  );
  const unitPrice =
    activity.unit_price === null || activity.unit_price === ""
      ? null
      : decimalOrThrow(activity.unit_price, `Invalid unit price for activity ${activity.id}`);
  const amount =
    activity.amount === null || activity.amount === ""
      ? null
      : decimalOrThrow(activity.amount, `Invalid amount for activity ${activity.id}`);
  const derivedAmount = unitPrice?.mul(quantity) ?? null;
  const incomeAmount = amount?.isZero() === false ? amount : (derivedAmount ?? amount);
  const acquisitionUnitPrice =
    incomeAmount && !quantity.isZero() ? incomeAmount.div(quantity) : unitPrice;

  const incomeLeg: ActivityRebuildRow = {
    ...activity,
    id: `${activity.id}:${incomeIdSuffix}`,
    activity_type: incomeActivityType,
    activity_type_override: null,
    subtype: null,
    quantity: null,
    unit_price: null,
    amount: incomeAmount ? decimalToString(incomeAmount) : null,
  };
  const buyLeg: ActivityRebuildRow = {
    ...activity,
    id: `${activity.id}:buy`,
    activity_type: "BUY",
    activity_type_override: null,
    subtype: null,
    unit_price: acquisitionUnitPrice ? decimalToString(acquisitionUnitPrice) : null,
    amount: null,
    fee: "0",
  };
  return [incomeLeg, buyLeg];
}

function activityEffectiveType(activity: ActivityRebuildRow): string {
  return (activity.activity_type_override ?? activity.activity_type).toUpperCase();
}

function calculateSplitFactors(
  activities: ActivityRebuildRow[],
  options: LocalPortfolioJobServiceOptions,
  timezone: string,
): SplitFactorsByAsset {
  const factors = new Map<string, Array<[string, Decimal]>>();
  for (const activity of activities) {
    if (activityEffectiveType(activity) !== "SPLIT") {
      continue;
    }
    const assetId = activity.asset_id?.trim();
    if (!assetId) {
      warnPortfolioJob(
        options,
        `Missing asset_id for split activity ${activity.id}; split adjustment ignored`,
      );
      continue;
    }
    if (activity.amount === null || activity.amount === "") {
      warnPortfolioJob(
        options,
        `Missing amount for split activity ${activity.id}; split adjustment ignored`,
      );
      continue;
    }
    const splitRatio = decimalOrThrow(
      activity.amount,
      `Invalid split ratio for activity ${activity.id}`,
    );
    if (!splitRatio.isPositive()) {
      warnPortfolioJob(
        options,
        `Invalid split ratio ${activity.amount} for split activity ${activity.id}; split adjustment ignored`,
      );
      continue;
    }
    const existing = factors.get(assetId) ?? [];
    existing.push([activityLocalDate(activity, timezone), splitRatio]);
    factors.set(assetId, existing);
  }

  for (const splits of factors.values()) {
    splits.sort(([dateA], [dateB]) => dateA.localeCompare(dateB));
    const seenDates = new Set<string>();
    for (let index = 0; index < splits.length; index += 1) {
      const [date] = splits[index];
      if (seenDates.has(date)) {
        splits.splice(index, 1);
        index -= 1;
      } else {
        seenDates.add(date);
      }
    }
  }
  return factors;
}

function adjustActivitiesForSplits(
  activities: ActivityRebuildRow[],
  splitFactors: SplitFactorsByAsset,
  timezone: string,
): ActivityRebuildRow[] {
  return activities.map((activity) => {
    if (!activity.asset_id || activityEffectiveType(activity) === "SPLIT") {
      return activity;
    }
    const splits = splitFactors.get(activity.asset_id);
    if (!splits) {
      return activity;
    }
    const activityDate = activityLocalDate(activity, timezone);
    const cumulativeFactor = splits.reduce((factor, [splitDate, splitRatio]) => {
      return splitDate > activityDate ? factor.mul(splitRatio) : factor;
    }, new Decimal(1));
    if (cumulativeFactor.eq(1)) {
      return activity;
    }

    const adjustedQuantity =
      activity.quantity === null || activity.quantity === ""
        ? activity.quantity
        : decimalToString(
            decimalOrThrow(activity.quantity, `Invalid quantity for activity ${activity.id}`)
              .abs()
              .mul(cumulativeFactor),
          );
    const adjustedUnitPrice =
      activity.unit_price === null || activity.unit_price === ""
        ? activity.unit_price
        : decimalToString(
            decimalOrThrow(activity.unit_price, `Invalid unit price for activity ${activity.id}`)
              .abs()
              .div(cumulativeFactor),
          );

    return {
      ...activity,
      quantity: adjustedQuantity,
      unit_price: adjustedUnitPrice,
    };
  });
}

function groupActivitiesByDate(
  activities: ActivityRebuildRow[],
  timezone: string,
): Map<string, ActivityRebuildRow[]> {
  const grouped = new Map<string, ActivityRebuildRow[]>();
  for (const activity of activities) {
    const date = activityLocalDate(activity, timezone);
    const existing = grouped.get(date) ?? [];
    existing.push(activity);
    grouped.set(date, existing);
  }
  return grouped;
}

function orderReplayContextsByTransferDeps(
  contexts: ActivityReplayContext[],
  date: string,
  options: LocalPortfolioJobServiceOptions,
): ActivityReplayContext[] {
  if (contexts.length <= 1) {
    return contexts;
  }

  const outIndexByGroup = new Map<string, number>();
  const inIndexByGroup = new Map<string, number>();
  for (const [index, context] of contexts.entries()) {
    for (const activity of context.activitiesByDate.get(date) ?? []) {
      const groupId = activitySourceGroupId(activity);
      if (!groupId) {
        continue;
      }
      if (activity.activity_type === "TRANSFER_OUT") {
        outIndexByGroup.set(groupId, index);
      } else if (activity.activity_type === "TRANSFER_IN") {
        inIndexByGroup.set(groupId, index);
      }
    }
  }

  const successors = Array.from({ length: contexts.length }, () => new Set<number>());
  const inDegree = Array.from({ length: contexts.length }, () => 0);
  for (const [groupId, outIndex] of outIndexByGroup) {
    const inIndex = inIndexByGroup.get(groupId);
    if (inIndex === undefined || inIndex === outIndex || successors[outIndex].has(inIndex)) {
      continue;
    }
    successors[outIndex].add(inIndex);
    inDegree[inIndex] += 1;
  }
  if (successors.every((edges) => edges.size === 0)) {
    return contexts;
  }

  return stableTopologicalOrder(contexts, successors, inDegree, () =>
    warnPortfolioJob(
      options,
      `Detected cyclic same-day transfer dependencies on ${date}; preserving input account order for remaining accounts`,
    ),
  );
}

function orderActivitiesByTransferDeps(
  activities: ActivityRebuildRow[],
  options: LocalPortfolioJobServiceOptions,
  timezone: string,
): ActivityRebuildRow[] {
  if (activities.length <= 1) {
    return activities;
  }

  const outIndexByGroup = new Map<string, number>();
  const inIndexByGroup = new Map<string, number>();
  for (const [index, activity] of activities.entries()) {
    const groupId = activitySourceGroupId(activity);
    if (!groupId) {
      continue;
    }
    if (activity.activity_type === "TRANSFER_OUT") {
      outIndexByGroup.set(groupId, index);
    } else if (activity.activity_type === "TRANSFER_IN") {
      inIndexByGroup.set(groupId, index);
    }
  }

  const successors = Array.from({ length: activities.length }, () => new Set<number>());
  const inDegree = Array.from({ length: activities.length }, () => 0);
  for (const [groupId, outIndex] of outIndexByGroup) {
    const inIndex = inIndexByGroup.get(groupId);
    if (inIndex === undefined || inIndex === outIndex || successors[outIndex].has(inIndex)) {
      continue;
    }
    successors[outIndex].add(inIndex);
    inDegree[inIndex] += 1;
  }
  if (successors.every((edges) => edges.size === 0)) {
    return activities;
  }

  return stableTopologicalOrder(activities, successors, inDegree, () =>
    warnPortfolioJob(
      options,
      `Detected cyclic same-account transfer dependencies on ${activityLocalDate(activities[0], timezone)}; preserving input activity order for remaining activities`,
    ),
  );
}

function stableTopologicalOrder<T>(
  items: T[],
  successors: Array<Set<number>>,
  inDegree: number[],
  onCycle?: () => void,
): T[] {
  const queue = inDegree.flatMap((degree, index) => (degree === 0 ? [index] : []));
  const orderedIndexes: number[] = [];

  while (queue.length > 0) {
    const index = queue.shift();
    if (index === undefined) {
      break;
    }
    orderedIndexes.push(index);
    for (const successor of successors[index]) {
      inDegree[successor] -= 1;
      if (inDegree[successor] === 0) {
        queue.push(successor);
      }
    }
  }

  if (orderedIndexes.length < items.length) {
    onCycle?.();
    const seen = new Set(orderedIndexes);
    for (let index = 0; index < items.length; index += 1) {
      if (!seen.has(index)) {
        orderedIndexes.push(index);
      }
    }
  }
  return orderedIndexes.map((index) => items[index]);
}

function deleteCalculatedSnapshotsForActivityRebuild(
  db: Database,
  accountId: string,
  startDate: string | null,
): void {
  if (startDate) {
    db.query(
      "DELETE FROM holdings_snapshots WHERE account_id = ? AND source = ? AND snapshot_date >= ?",
    ).run(accountId, SNAPSHOT_SOURCE_CALCULATED, startDate);
    return;
  }
  db.query("DELETE FROM holdings_snapshots WHERE account_id = ? AND source = ?").run(
    accountId,
    SNAPSHOT_SOURCE_CALCULATED,
  );
}

function emptyActivityState(account: PortfolioAccountRow): ActivityRebuildState {
  return {
    accountId: account.id,
    currency: account.currency,
    positions: new Map(),
    cashBalances: new Map(),
    netContribution: new Decimal(0),
    netContributionBase: new Decimal(0),
  };
}

function activityStateFromSnapshot(
  account: PortfolioAccountRow,
  snapshot: ParsedSnapshot,
): ActivityRebuildState {
  return {
    accountId: account.id,
    currency: account.currency,
    positions: new Map(
      Array.from(snapshot.positions.entries()).map(([assetId, position]) => [
        assetId,
        rebuildPositionFromSnapshot(position),
      ]),
    ),
    cashBalances: new Map(snapshot.cashBalances),
    netContribution: snapshot.netContribution,
    netContributionBase: snapshot.netContributionBase ?? snapshot.netContribution,
  };
}

function rebuildPositionFromSnapshot(position: NormalizedPosition): ActivityRebuildPosition {
  const lots = normalizeRebuildLots(position);
  return {
    ...position,
    quantity: new Decimal(position.quantity),
    averageCost: new Decimal(position.averageCost),
    totalCostBasis: new Decimal(position.totalCostBasis),
    contractMultiplier: new Decimal(position.contractMultiplier),
    lots,
  };
}

function normalizeRebuildLots(position: NormalizedPosition): RebuildLot[] {
  const lots = position.lots.flatMap((lot, index) => {
    if (!isRecord(lot)) {
      return [];
    }
    return [
      {
        id: stringValue(lot.id ?? `${position.assetId}_seed_${index}`),
        quantity: decimalOptionalOrDefault(lot.quantity, new Decimal(0), "Invalid lot quantity"),
        costBasis: decimalOptionalOrDefault(lot.costBasis, new Decimal(0), "Invalid lot cost"),
        acquisitionPrice: decimalOptionalOrDefault(
          lot.acquisitionPrice,
          new Decimal(0),
          "Invalid lot price",
        ),
        acquisitionFees: decimalOptionalOrDefault(
          lot.acquisitionFees,
          new Decimal(0),
          "Invalid lot fees",
        ),
        acquisitionDate: stringValue(lot.acquisitionDate ?? position.inceptionDate),
      },
    ];
  });
  if (lots.length > 0) {
    return lots;
  }
  if (position.quantity.lte(0)) {
    return [];
  }
  return [
    {
      id: `${position.assetId}_seed`,
      quantity: position.quantity,
      costBasis: position.totalCostBasis,
      acquisitionPrice: position.averageCost,
      acquisitionFees: new Decimal(0),
      acquisitionDate: position.inceptionDate,
    },
  ];
}

function parseSnapshot(row: SnapshotRow): ParsedSnapshot {
  return {
    row,
    positions: parsePositions(row.positions, row.account_id),
    cashBalances: parseCashBalances(row.cash_balances),
    costBasis: decimalOrThrow(
      row.cost_basis,
      `Invalid cost basis for snapshot ${row.account_id}/${row.snapshot_date}`,
    ),
    netContribution: decimalOrThrow(
      row.net_contribution,
      `Invalid net contribution for snapshot ${row.account_id}/${row.snapshot_date}`,
    ),
    netContributionBase: row.net_contribution_base?.trim()
      ? decimalOrThrow(
          row.net_contribution_base,
          `Invalid base net contribution for snapshot ${row.account_id}/${row.snapshot_date}`,
        )
      : null,
  };
}

function parsePositions(serialized: string, accountId: string): Map<string, NormalizedPosition> {
  const parsed = parseJsonRecord(serialized);
  const positions = new Map<string, NormalizedPosition>();
  for (const [key, rawPosition] of Object.entries(parsed)) {
    if (!isRecord(rawPosition)) {
      throw new Error(`Invalid holdings snapshot position for ${accountId}: ${key}`);
    }
    const position = normalizePosition(rawPosition, key, accountId);
    positions.set(position.assetId, position);
  }
  return positions;
}

function normalizePosition(
  rawPosition: SnapshotPosition,
  fallbackAssetId: string,
  fallbackAccountId: string,
): NormalizedPosition {
  const assetId = stringValue(rawPosition.assetId ?? rawPosition.asset_id ?? fallbackAssetId);
  const accountId = stringValue(
    rawPosition.accountId ?? rawPosition.account_id ?? fallbackAccountId,
  );
  const totalCostBasis = decimalOrThrow(
    rawPosition.totalCostBasis ?? rawPosition.total_cost_basis,
    `Invalid total cost basis for position ${assetId}`,
  );
  const quantity = decimalOrThrow(rawPosition.quantity, `Invalid quantity for position ${assetId}`);
  const averageCost = decimalOptionalOrDefault(
    rawPosition.averageCost ?? rawPosition.average_cost,
    new Decimal(0),
    `Invalid average cost for position ${assetId}`,
  );
  const currency = stringValue(rawPosition.currency ?? "USD");
  const timestamp = new Date(0).toISOString();
  const inceptionDate = stringValue(
    rawPosition.inceptionDate ?? rawPosition.inception_date ?? timestamp,
  );
  const createdAt = stringValue(rawPosition.createdAt ?? rawPosition.created_at ?? timestamp);
  const lastUpdated = stringValue(rawPosition.lastUpdated ?? rawPosition.last_updated ?? timestamp);
  const contractMultiplier = decimalOptionalOrDefault(
    rawPosition.contractMultiplier ?? rawPosition.contract_multiplier,
    new Decimal(1),
    `Invalid contract multiplier for position ${assetId}`,
  );
  return {
    id: stringValue(rawPosition.id ?? `${assetId}_${accountId}`),
    accountId,
    assetId,
    quantity,
    averageCost,
    totalCostBasis,
    currency,
    inceptionDate,
    createdAt,
    lastUpdated,
    isAlternative: Boolean(rawPosition.isAlternative ?? rawPosition.is_alternative ?? false),
    contractMultiplier,
    lots: Array.isArray(rawPosition.lots) ? rawPosition.lots : [],
  };
}

function parseCashBalances(serialized: string): Map<string, Decimal> {
  const parsed = parseJsonRecord(serialized);
  const balances = new Map<string, Decimal>();
  for (const [currency, amount] of Object.entries(parsed)) {
    balances.set(currency, decimalOrThrow(amount, `Invalid cash balance for ${currency}`));
  }
  return balances;
}

function calculateValuationForSnapshot(
  db: Database,
  snapshot: ParsedSnapshot,
  baseCurrency: string,
  calculatedAt: string,
  assetsWithQuotes: Set<string>,
  options: LocalPortfolioJobServiceOptions,
): CalculatedValuation | null {
  const accountCurrency = snapshot.row.currency;
  const fxRateToBase = exchangeRateForDate(
    accountCurrency,
    baseCurrency,
    snapshot.row.snapshot_date,
    options,
  );
  if (!fxRateToBase) {
    return null;
  }

  let investmentMarketValue = new Decimal(0);
  let quotablePositions = 0;
  let missingQuotePositions = 0;
  for (const position of snapshot.positions.values()) {
    const quote = latestQuoteAsOf(db, position.assetId, snapshot.row.snapshot_date);
    if (!position.quantity.isZero() && assetsWithQuotes.has(position.assetId)) {
      quotablePositions += 1;
      if (!quote) {
        missingQuotePositions += 1;
      }
    }
    if (!quote) {
      continue;
    }
    const [normalizedPrice, normalizedQuoteCurrency] = normalizeAmount(quote.close, quote.currency);
    const quoteFx = exchangeRateForDate(
      normalizedQuoteCurrency,
      accountCurrency,
      snapshot.row.snapshot_date,
      options,
    );
    if (!quoteFx) {
      return null;
    }
    investmentMarketValue = investmentMarketValue.plus(
      position.quantity.mul(normalizedPrice).mul(position.contractMultiplier).mul(quoteFx),
    );
  }

  if (quotablePositions > 0 && missingQuotePositions === quotablePositions) {
    return null;
  }

  let cashBalance = new Decimal(0);
  for (const [currency, amount] of snapshot.cashBalances) {
    const [normalizedAmount, normalizedCashCurrency] = normalizeAmount(amount, currency);
    const cashFx = exchangeRateForDate(
      normalizedCashCurrency,
      accountCurrency,
      snapshot.row.snapshot_date,
      options,
    );
    if (!cashFx) {
      return null;
    }
    cashBalance = cashBalance.plus(normalizedAmount.mul(cashFx));
  }

  return {
    id: `${snapshot.row.account_id}_${snapshot.row.snapshot_date}`,
    accountId: snapshot.row.account_id,
    valuationDate: snapshot.row.snapshot_date,
    accountCurrency,
    baseCurrency,
    fxRateToBase,
    cashBalance: roundDecimal(cashBalance),
    investmentMarketValue: roundDecimal(investmentMarketValue),
    totalValue: roundDecimal(investmentMarketValue.plus(cashBalance)),
    costBasis: roundDecimal(snapshot.costBasis),
    netContribution: roundDecimal(snapshot.netContribution),
    calculatedAt,
  };
}

function processActivityForSnapshot(
  db: Database,
  state: ActivityRebuildState,
  activity: ActivityRebuildRow,
  baseCurrency: string,
  options: LocalPortfolioJobServiceOptions,
  transferLotsCache: TransferLotsCache,
): void {
  switch (activityEffectiveType(activity)) {
    case "BUY":
      applyBuyActivity(db, state, activity, options);
      break;
    case "SELL":
      applySellActivity(db, state, activity, options);
      break;
    case "DEPOSIT":
      applyContributionActivity(state, activity, baseCurrency, options, 1);
      break;
    case "WITHDRAWAL":
      applyContributionActivity(state, activity, baseCurrency, options, -1);
      break;
    case "DIVIDEND":
    case "INTEREST":
      addCash(state, activity.currency, activityAmount(activity).minus(activityFee(activity)));
      break;
    case "CREDIT":
      applyCreditActivity(state, activity, baseCurrency, options);
      break;
    case "FEE":
    case "TAX":
      applyChargeActivity(state, activity);
      break;
    case "TRANSFER_IN":
    case "TRANSFER_OUT":
      applyTransferActivity(db, state, activity, baseCurrency, options, transferLotsCache);
      break;
    case "ADJUSTMENT":
      applyAdjustmentActivity(state, activity, options);
      break;
    case "SPLIT":
      break;
    case "UNKNOWN":
      warnPortfolioJob(
        options,
        `Skipping unsupported activity ${activity.id} (${activity.activity_type}) during TS snapshot rebuild`,
      );
      break;
    default:
      warnPortfolioJob(
        options,
        `Skipping unknown activity ${activity.id} (${activity.activity_type}) during TS snapshot rebuild`,
      );
  }
}

function applyBuyActivity(
  db: Database,
  state: ActivityRebuildState,
  activity: ActivityRebuildRow,
  options: LocalPortfolioJobServiceOptions,
): void {
  const assetId = requiredActivityAssetId(activity);
  const quantity = positiveActivityQuantity(activity);
  const unitPrice = activityUnitPrice(activity);
  const fee = activityFee(activity);
  const position = getOrCreateActivityPosition(db, state, activity, assetId);
  const unitPriceWithMultiplier = unitPrice.mul(position.contractMultiplier);
  const unitPriceForLot =
    position.currency === activity.currency
      ? unitPriceWithMultiplier
      : convertActivityAmountToPositionCurrency(
          unitPriceWithMultiplier,
          activity,
          position,
          state.currency,
          options,
        );
  const feeForLot =
    position.currency === activity.currency
      ? fee
      : convertActivityAmountToPositionCurrency(fee, activity, position, state.currency, options);
  const costBasis = quantity.mul(unitPriceForLot).plus(feeForLot);

  position.lots.push({
    id: activity.id,
    quantity,
    costBasis,
    acquisitionPrice: unitPriceForLot,
    acquisitionFees: feeForLot,
    acquisitionDate: activity.activity_date,
  });
  recalculateActivityPosition(position, activity.activity_date);
  addBrokerConvertedCash(
    state,
    activity,
    quantity.mul(unitPriceWithMultiplier).plus(fee).negated(),
  );
}

function applySellActivity(
  db: Database,
  state: ActivityRebuildState,
  activity: ActivityRebuildRow,
  options: LocalPortfolioJobServiceOptions,
): void {
  const assetId = requiredActivityAssetId(activity);
  const quantity = positiveActivityQuantity(activity);
  const fee = activityFee(activity);
  const position = state.positions.get(assetId);
  const asset = position ? null : readAssetInfo(db, assetId);
  const multiplier =
    position?.contractMultiplier ?? (asset ? assetContractMultiplier(asset) : new Decimal(1));
  const proceeds = quantity.mul(activityUnitPrice(activity)).mul(multiplier).minus(fee);
  addBrokerConvertedCash(state, activity, proceeds);

  if (!position) {
    warnPortfolioJob(
      options,
      `Activity ${activity.id} sold missing position ${assetId}; cash effect was still applied`,
    );
    return;
  }
  reducePositionLotsFifo(position, quantity, options, activity.id, activity.activity_date);
}

function applyContributionActivity(
  state: ActivityRebuildState,
  activity: ActivityRebuildRow,
  baseCurrency: string,
  options: LocalPortfolioJobServiceOptions,
  direction: 1 | -1,
): void {
  const amount = activityAmount(activity).abs().mul(direction);
  const cashDelta = amount.minus(activityFee(activity));
  addCash(state, activity.currency, cashDelta);
  addContribution(state, activity, amount, baseCurrency, options);
}

function applyCreditActivity(
  state: ActivityRebuildState,
  activity: ActivityRebuildRow,
  baseCurrency: string,
  options: LocalPortfolioJobServiceOptions,
): void {
  const amount = activityAmount(activity);
  addCash(state, activity.currency, amount.minus(activityFee(activity)));
  if (activity.subtype === "BONUS") {
    addContribution(state, activity, amount, baseCurrency, options);
  }
}

function applyChargeActivity(state: ActivityRebuildState, activity: ActivityRebuildRow): void {
  const charge = activityFee(activity).isZero() ? activityAmount(activity) : activityFee(activity);
  if (charge.isZero()) {
    return;
  }
  addCash(state, activity.currency, charge.abs().negated());
}

function applyTransferActivity(
  db: Database,
  state: ActivityRebuildState,
  activity: ActivityRebuildRow,
  baseCurrency: string,
  options: LocalPortfolioJobServiceOptions,
  transferLotsCache: TransferLotsCache,
): void {
  if (!activity.asset_id) {
    applyContributionActivity(
      state,
      activity,
      baseCurrency,
      options,
      activity.activity_type === "TRANSFER_IN" ? 1 : -1,
    );
    return;
  }
  if (activity.activity_type === "TRANSFER_IN") {
    applyAssetTransferIn(db, state, activity, baseCurrency, options, transferLotsCache);
  } else {
    applyAssetTransferOut(state, activity, baseCurrency, options, transferLotsCache);
  }
}

function applyAssetTransferOut(
  state: ActivityRebuildState,
  activity: ActivityRebuildRow,
  baseCurrency: string,
  options: LocalPortfolioJobServiceOptions,
  transferLotsCache: TransferLotsCache,
): void {
  const assetId = requiredActivityAssetId(activity);
  applyTransferFeeCash(state, activity);

  const position = state.positions.get(assetId);
  if (!position) {
    warnPortfolioJob(
      options,
      `Attempted to transfer out non-existent position ${assetId} via activity ${activity.id}; fee applied only`,
    );
    return;
  }

  const removedLots = reducePositionLotsFifo(
    position,
    positiveActivityQuantity(activity),
    options,
    activity.id,
    activity.activity_date,
    "transferred out",
  );
  if (removedLots.length === 0) {
    return;
  }

  const groupId = activitySourceGroupId(activity);
  if (groupId) {
    const existing = transferLotsCache.get(groupId) ?? [];
    existing.push({
      assetId,
      sourceActivityId: activity.id,
      currency: position.currency,
      isAlternative: position.isAlternative,
      contractMultiplier: position.contractMultiplier,
      lots: removedLots.map(cloneRebuildLot),
    });
    transferLotsCache.set(groupId, existing);
  }

  const removedCostBasis = sumLotCostBasis(removedLots);
  addPositionContribution(
    state,
    activity,
    removedCostBasis.negated(),
    position.currency,
    baseCurrency,
    options,
  );
}

function applyAssetTransferIn(
  db: Database,
  state: ActivityRebuildState,
  activity: ActivityRebuildRow,
  baseCurrency: string,
  options: LocalPortfolioJobServiceOptions,
  transferLotsCache: TransferLotsCache,
): void {
  const assetId = requiredActivityAssetId(activity);
  const position = getOrCreateActivityPosition(db, state, activity, assetId);
  const groupId = activitySourceGroupId(activity);
  const cachedBatch = groupId
    ? takeCachedTransferredLotBatch(transferLotsCache, groupId, assetId)
    : null;
  const addedCostBasis = cachedBatch
    ? addTransferredLots(position, activity, cachedBatch)
    : addFallbackTransferLot(position, activity, state.currency, options);

  if (groupId && !cachedBatch) {
    warnPortfolioJob(
      options,
      `TransferIn ${activity.id} has source_group_id but no cached lots from paired TransferOut; using unit_price fallback`,
    );
  }

  applyTransferFeeCash(state, activity);
  addPositionContribution(
    state,
    activity,
    addedCostBasis,
    position.currency,
    baseCurrency,
    options,
  );
}

function applyAdjustmentActivity(
  state: ActivityRebuildState,
  activity: ActivityRebuildRow,
  options: LocalPortfolioJobServiceOptions,
): void {
  if (!activity.subtype || activity.subtype.toUpperCase() !== "OPTION_EXPIRY") {
    return;
  }

  const assetId = requiredActivityAssetId(activity);
  const position = state.positions.get(assetId);
  if (!position) {
    warnPortfolioJob(
      options,
      `Option expiry activity ${activity.id} found no position ${assetId}; no holdings changed`,
    );
    return;
  }
  reducePositionLotsFifo(
    position,
    positiveActivityQuantity(activity),
    options,
    activity.id,
    activity.activity_date,
  );
}

function addCash(state: ActivityRebuildState, currency: string, delta: Decimal): void {
  state.cashBalances.set(
    currency,
    (state.cashBalances.get(currency) ?? new Decimal(0)).plus(delta),
  );
}

function addBrokerConvertedCash(
  state: ActivityRebuildState,
  activity: ActivityRebuildRow,
  activityCurrencyDelta: Decimal,
): void {
  if (activity.currency !== state.currency) {
    const activityFxRate = decimalOptionalOrDefault(
      activity.fx_rate,
      new Decimal(0),
      `Invalid activity FX rate for activity ${activity.id}`,
    );
    if (!activityFxRate.isZero()) {
      addCash(state, state.currency, activityCurrencyDelta.mul(activityFxRate));
      return;
    }
  }
  addCash(state, activity.currency, activityCurrencyDelta);
}

function addContribution(
  state: ActivityRebuildState,
  activity: ActivityRebuildRow,
  amount: Decimal,
  baseCurrency: string,
  options: LocalPortfolioJobServiceOptions,
): void {
  state.netContribution = state.netContribution.plus(
    convertActivityAmountForAccountContribution(activity, amount, state.currency, options),
  );
  state.netContributionBase = state.netContributionBase.plus(
    convertActivityAmountForBaseContribution(activity, amount, baseCurrency, options),
  );
}

function addPositionContribution(
  state: ActivityRebuildState,
  activity: ActivityRebuildRow,
  amount: Decimal,
  positionCurrency: string,
  baseCurrency: string,
  options: LocalPortfolioJobServiceOptions,
): void {
  state.netContribution = state.netContribution.plus(
    convertPositionAmountForAccountContribution(
      activity,
      amount,
      positionCurrency,
      state.currency,
      options,
    ),
  );
  state.netContributionBase = state.netContributionBase.plus(
    convertPositionAmountForBaseContribution(
      activity,
      amount,
      positionCurrency,
      baseCurrency,
      options,
    ),
  );
}

function convertPositionAmountForAccountContribution(
  activity: ActivityRebuildRow,
  amount: Decimal,
  positionCurrency: string,
  accountCurrency: string,
  options: LocalPortfolioJobServiceOptions,
): Decimal {
  if (positionCurrency === accountCurrency) {
    return amount;
  }
  const activityFxRate = decimalOptionalOrDefault(
    activity.fx_rate,
    new Decimal(0),
    `Invalid activity FX rate for activity ${activity.id}`,
  );
  if (activity.currency === positionCurrency && !activityFxRate.isZero()) {
    return amount.mul(activityFxRate);
  }
  return convertAmountWithFallback(
    amount,
    positionCurrency,
    accountCurrency,
    activityLocalDateForOptions(activity, options),
    options,
    amount,
  );
}

function convertPositionAmountForBaseContribution(
  activity: ActivityRebuildRow,
  amount: Decimal,
  positionCurrency: string,
  baseCurrency: string,
  options: LocalPortfolioJobServiceOptions,
): Decimal {
  if (positionCurrency === baseCurrency) {
    return amount;
  }
  return convertAmountWithFallback(
    amount,
    positionCurrency,
    baseCurrency,
    activityLocalDateForOptions(activity, options),
    options,
    amount,
  );
}

function convertActivityAmountForAccountContribution(
  activity: ActivityRebuildRow,
  amount: Decimal,
  targetCurrency: string,
  options: LocalPortfolioJobServiceOptions,
): Decimal {
  if (activity.currency === targetCurrency) {
    return amount;
  }
  const rate = decimalOptionalOrDefault(
    activity.fx_rate,
    new Decimal(0),
    "Invalid activity FX rate",
  );
  if (!rate.isZero()) {
    return amount.mul(rate);
  }
  return convertAmountWithFallback(
    amount,
    activity.currency,
    targetCurrency,
    activityLocalDateForOptions(activity, options),
    options,
    amount,
  );
}

function convertActivityAmountForBaseContribution(
  activity: ActivityRebuildRow,
  amount: Decimal,
  baseCurrency: string,
  options: LocalPortfolioJobServiceOptions,
): Decimal {
  if (activity.currency === baseCurrency) {
    return amount;
  }
  return convertAmountWithFallback(
    amount,
    activity.currency,
    baseCurrency,
    activityLocalDateForOptions(activity, options),
    options,
    new Decimal(0),
  );
}

function convertAmountWithFallback(
  amount: Decimal,
  fromCurrency: string,
  toCurrency: string,
  date: string,
  options: LocalPortfolioJobServiceOptions,
  fallback: Decimal,
): Decimal {
  const rate = exchangeRateForDate(fromCurrency, toCurrency, date, options);
  return rate ? amount.mul(rate) : fallback;
}

function getOrCreateActivityPosition(
  db: Database,
  state: ActivityRebuildState,
  activity: ActivityRebuildRow,
  assetId: string,
): ActivityRebuildPosition {
  const existing = state.positions.get(assetId);
  if (existing) {
    return existing;
  }
  const asset = readAssetInfo(db, assetId);
  const currency = asset?.quote_ccy?.trim() || activity.currency;
  const position: ActivityRebuildPosition = {
    id: `${assetId}_${state.accountId}`,
    accountId: state.accountId,
    assetId,
    quantity: new Decimal(0),
    averageCost: new Decimal(0),
    totalCostBasis: new Decimal(0),
    currency,
    inceptionDate: activity.activity_date,
    createdAt: activity.activity_date,
    lastUpdated: activity.activity_date,
    isAlternative: asset ? asset.kind !== "INVESTMENT" : false,
    contractMultiplier: asset ? assetContractMultiplier(asset) : new Decimal(1),
    lots: [],
  };
  state.positions.set(assetId, position);
  return position;
}

function applyTransferFeeCash(state: ActivityRebuildState, activity: ActivityRebuildRow): void {
  const fee = activityFee(activity);
  if (!fee.isZero()) {
    addCash(state, activity.currency, fee.negated());
  }
}

function takeCachedTransferredLotBatch(
  transferLotsCache: TransferLotsCache,
  groupId: string,
  assetId: string,
): TransferredLotBatch | null {
  const batches = transferLotsCache.get(groupId);
  if (!batches) {
    return null;
  }
  const batchIndex = batches.findIndex((batch) => batch.assetId === assetId);
  if (batchIndex < 0) {
    return null;
  }
  const [batch] = batches.splice(batchIndex, 1);
  if (batches.length === 0) {
    transferLotsCache.delete(groupId);
  }
  return batch ?? null;
}

function warnForUnpairedTransferredLots(
  transferLotsCache: TransferLotsCache,
  options: LocalPortfolioJobServiceOptions,
): void {
  for (const [groupId, batches] of transferLotsCache) {
    for (const batch of batches) {
      warnPortfolioJob(
        options,
        `TransferOut ${batch.sourceActivityId} cached lots for source_group_id ${groupId} but no paired TransferIn consumed them`,
      );
    }
  }
}

function addTransferredLots(
  position: ActivityRebuildPosition,
  activity: ActivityRebuildRow,
  batch: TransferredLotBatch,
): Decimal {
  position.currency = batch.currency;
  position.isAlternative = batch.isAlternative;
  position.contractMultiplier = batch.contractMultiplier;
  const transferredLots = batch.lots
    .filter((lot) => lot.quantity.gt(0))
    .map((lot, index, lots) => ({
      ...cloneRebuildLot(lot),
      id: lots.length === 1 ? activity.id : `${activity.id}_lot${index}`,
    }));
  position.lots.push(...transferredLots);
  sortPositionLots(position);
  updatePositionInceptionFromLots(position);
  recalculateActivityPosition(position, activity.activity_date);
  return sumLotCostBasis(transferredLots);
}

function addFallbackTransferLot(
  position: ActivityRebuildPosition,
  activity: ActivityRebuildRow,
  accountCurrency: string,
  options: LocalPortfolioJobServiceOptions,
): Decimal {
  const quantity = positiveActivityQuantity(activity);
  const unitPrice = activityUnitPrice(activity).mul(position.contractMultiplier);
  const fee = activityFee(activity);
  const unitPriceForLot =
    position.currency === activity.currency
      ? unitPrice
      : convertActivityAmountToPositionCurrency(
          unitPrice,
          activity,
          position,
          accountCurrency,
          options,
        );
  const feeForLot =
    position.currency === activity.currency
      ? fee
      : convertActivityAmountToPositionCurrency(fee, activity, position, accountCurrency, options);
  const costBasis = quantity.mul(unitPriceForLot).plus(feeForLot);
  position.lots.push({
    id: activity.id,
    quantity,
    costBasis,
    acquisitionPrice: unitPriceForLot,
    acquisitionFees: feeForLot,
    acquisitionDate: activity.activity_date,
  });
  sortPositionLots(position);
  updatePositionInceptionFromLots(position);
  recalculateActivityPosition(position, activity.activity_date);
  return costBasis;
}

function convertActivityAmountToPositionCurrency(
  amount: Decimal,
  activity: ActivityRebuildRow,
  position: ActivityRebuildPosition,
  accountCurrency: string,
  options: LocalPortfolioJobServiceOptions,
): Decimal {
  if (activity.currency === position.currency) {
    return amount;
  }
  const activityFxRate = decimalOptionalOrDefault(
    activity.fx_rate,
    new Decimal(0),
    `Invalid activity FX rate for activity ${activity.id}`,
  );
  const canUseActivityFxRate =
    position.currency === accountCurrency || activity.currency === accountCurrency;
  if (canUseActivityFxRate && !activityFxRate.isZero()) {
    return amount.mul(activityFxRate);
  }
  return convertRequired(
    amount,
    activity.currency,
    position.currency,
    activityLocalDateForOptions(activity, options),
    options,
  );
}

function cloneRebuildLot(lot: RebuildLot): RebuildLot {
  return {
    id: lot.id,
    quantity: lot.quantity,
    costBasis: lot.costBasis,
    acquisitionPrice: lot.acquisitionPrice,
    acquisitionFees: lot.acquisitionFees,
    acquisitionDate: lot.acquisitionDate,
  };
}

function sumLotCostBasis(lots: RebuildLot[]): Decimal {
  return lots.reduce((total, lot) => total.plus(lot.costBasis), new Decimal(0));
}

function sortPositionLots(position: ActivityRebuildPosition): void {
  position.lots.sort((a, b) => a.acquisitionDate.localeCompare(b.acquisitionDate));
}

function updatePositionInceptionFromLots(position: ActivityRebuildPosition): void {
  const earliestLot = position.lots.at(0);
  if (earliestLot && earliestLot.acquisitionDate < position.inceptionDate) {
    position.inceptionDate = earliestLot.acquisitionDate;
    position.createdAt = earliestLot.acquisitionDate;
  }
}

function readAssetInfo(db: Database, assetId: string): AssetInfoRow | null {
  return (
    db
      .query<AssetInfoRow, [string]>(
        `
          SELECT id, kind, quote_ccy, instrument_type, metadata
          FROM assets
          WHERE id = ?
        `,
      )
      .get(assetId) ?? null
  );
}

function assetContractMultiplier(asset: AssetInfoRow): Decimal {
  if (asset.instrument_type !== "OPTION") {
    return new Decimal(1);
  }
  if (asset.metadata?.trim()) {
    const metadata = parseJsonRecord(asset.metadata);
    const option = metadata.option;
    if (isRecord(option) && option.multiplier !== undefined && option.multiplier !== null) {
      return decimalOptionalOrDefault(
        option.multiplier,
        new Decimal(100),
        `Invalid option multiplier for asset ${asset.id}`,
      );
    }
  }
  return new Decimal(100);
}

function reducePositionLotsFifo(
  position: ActivityRebuildPosition,
  requestedQuantity: Decimal,
  options: LocalPortfolioJobServiceOptions,
  activityId: string,
  activityDate: string,
  operation = "sold",
): RebuildLot[] {
  let remaining = requestedQuantity;
  const nextLots: RebuildLot[] = [];
  const removedLots: RebuildLot[] = [];
  for (const lot of position.lots.sort((a, b) =>
    a.acquisitionDate.localeCompare(b.acquisitionDate),
  )) {
    if (remaining.lte(0)) {
      nextLots.push(lot);
      continue;
    }
    const quantityFromLot = Decimal.min(lot.quantity, remaining);
    remaining = remaining.minus(quantityFromLot);
    const quantityLeft = lot.quantity.minus(quantityFromLot);
    const removedRatio = quantityFromLot.div(lot.quantity);
    removedLots.push({
      ...lot,
      quantity: quantityFromLot,
      costBasis: lot.costBasis.mul(removedRatio),
      acquisitionFees: lot.acquisitionFees.mul(removedRatio),
    });
    if (quantityLeft.gt(0)) {
      const ratio = quantityLeft.div(lot.quantity);
      nextLots.push({
        ...lot,
        quantity: quantityLeft,
        costBasis: lot.costBasis.mul(ratio),
        acquisitionFees: lot.acquisitionFees.mul(ratio),
      });
    }
  }
  if (remaining.gt(0)) {
    warnPortfolioJob(
      options,
      `Activity ${activityId} ${operation} more ${position.assetId} than available; reduced only available quantity`,
    );
  }
  position.lots = nextLots;
  recalculateActivityPosition(position, activityDate);
  return removedLots;
}

function recalculateActivityPosition(position: ActivityRebuildPosition, updatedAt: string): void {
  position.quantity = position.lots.reduce(
    (total, lot) => total.plus(lot.quantity),
    new Decimal(0),
  );
  position.totalCostBasis = position.lots.reduce(
    (total, lot) => total.plus(lot.costBasis),
    new Decimal(0),
  );
  position.averageCost = position.quantity.isZero()
    ? new Decimal(0)
    : position.totalCostBasis.div(position.quantity);
  position.lastUpdated = updatedAt;
}

function upsertActivityCalculatedSnapshot(
  db: Database,
  state: ActivityRebuildState,
  date: string,
  baseCurrency: string,
  calculatedAt: string,
  options: LocalPortfolioJobServiceOptions,
): void {
  const id = `${state.accountId}_${date}`;
  const existing = db
    .query<{ source: string }, [string]>("SELECT source FROM holdings_snapshots WHERE id = ?")
    .get(id);
  if (existing && existing.source !== SNAPSHOT_SOURCE_CALCULATED) {
    warnPortfolioJob(
      options,
      `Skipping calculated snapshot ${id}; existing ${existing.source} snapshot is preserved`,
    );
    return;
  }

  const costBasis = costBasisInAccountCurrency(state.positions, state.currency, date, options);
  const cashTotalAccountCurrency = totalCashInCurrencyWithFallback(
    state.cashBalances,
    state.currency,
    date,
    options,
  );
  const cashTotalBaseCurrency = totalCashInCurrencyWithFallback(
    state.cashBalances,
    baseCurrency,
    date,
    options,
  );
  db.query(
    `
      INSERT INTO holdings_snapshots (
        id,
        account_id,
        snapshot_date,
        currency,
        positions,
        cash_balances,
        cost_basis,
        net_contribution,
        net_contribution_base,
        cash_total_account_currency,
        cash_total_base_currency,
        calculated_at,
        source
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        account_id = excluded.account_id,
        snapshot_date = excluded.snapshot_date,
        currency = excluded.currency,
        positions = excluded.positions,
        cash_balances = excluded.cash_balances,
        cost_basis = excluded.cost_basis,
        net_contribution = excluded.net_contribution,
        net_contribution_base = excluded.net_contribution_base,
        cash_total_account_currency = excluded.cash_total_account_currency,
        cash_total_base_currency = excluded.cash_total_base_currency,
        calculated_at = excluded.calculated_at,
        source = excluded.source
    `,
  ).run(
    id,
    state.accountId,
    date,
    state.currency,
    serializeActivityPositions(state.positions),
    serializeDecimalRecord(state.cashBalances),
    decimalToString(costBasis),
    decimalToString(state.netContribution),
    decimalToString(state.netContributionBase),
    decimalToString(cashTotalAccountCurrency),
    decimalToString(cashTotalBaseCurrency),
    calculatedAt,
    SNAPSHOT_SOURCE_CALCULATED,
  );
}

function serializeActivityPositions(positions: Map<string, ActivityRebuildPosition>): string {
  return JSON.stringify(
    Object.fromEntries(
      Array.from(positions.entries()).map(([assetId, position]) => [
        assetId,
        {
          id: position.id,
          accountId: position.accountId,
          assetId: position.assetId,
          quantity: decimalToString(position.quantity),
          averageCost: decimalToString(position.averageCost),
          totalCostBasis: decimalToString(position.totalCostBasis),
          currency: position.currency,
          inceptionDate: position.inceptionDate,
          lots: position.lots.map((lot) => ({
            id: lot.id,
            quantity: decimalToString(lot.quantity),
            costBasis: decimalToString(lot.costBasis),
            acquisitionPrice: decimalToString(lot.acquisitionPrice),
            acquisitionFees: decimalToString(lot.acquisitionFees),
            acquisitionDate: lot.acquisitionDate,
          })),
          createdAt: position.createdAt,
          lastUpdated: position.lastUpdated,
          isAlternative: position.isAlternative,
          contractMultiplier: decimalToString(position.contractMultiplier),
        },
      ]),
    ),
  );
}

function costBasisInAccountCurrency(
  positions: Map<string, ActivityRebuildPosition>,
  accountCurrency: string,
  date: string,
  options: LocalPortfolioJobServiceOptions,
): Decimal {
  return roundDecimal(
    Array.from(positions.values()).reduce(
      (total, position) =>
        total.plus(
          convertAmountWithFallback(
            position.totalCostBasis,
            position.currency,
            accountCurrency,
            date,
            options,
            position.totalCostBasis,
          ),
        ),
      new Decimal(0),
    ),
  );
}

function activityLocalDate(activity: ActivityRebuildRow, timezone: string): string {
  const date = activity.activity_date.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return date;
  }
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid activity date for activity ${activity.id}: ${date}`);
  }
  const formatter = activityDateFormatters.get(timezone) ?? createActivityDateFormatter(timezone);
  activityDateFormatters.set(timezone, formatter);
  const parts = formatter.formatToParts(parsed);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error(`Failed to format activity date for activity ${activity.id}: ${date}`);
  }
  return `${year}-${month}-${day}`;
}

function activityLocalDateForOptions(
  activity: ActivityRebuildRow,
  options: LocalPortfolioJobServiceOptions,
): string {
  return activityLocalDate(activity, resolveTimezone(options));
}

function activitySourceGroupId(activity: ActivityRebuildRow): string | null {
  return activity.source_group_id?.trim() || null;
}

function requiredActivityAssetId(activity: ActivityRebuildRow): string {
  const assetId = activity.asset_id?.trim();
  if (!assetId) {
    throw new Error(`Activity ${activity.id} requires an asset`);
  }
  return assetId;
}

function positiveActivityQuantity(activity: ActivityRebuildRow): Decimal {
  const quantity = decimalOptionalOrDefault(
    activity.quantity,
    new Decimal(0),
    `Invalid quantity for activity ${activity.id}`,
  ).abs();
  if (quantity.isZero()) {
    throw new Error(`Activity ${activity.id} requires a non-zero quantity`);
  }
  return quantity;
}

function activityUnitPrice(activity: ActivityRebuildRow): Decimal {
  return decimalOptionalOrDefault(
    activity.unit_price,
    new Decimal(0),
    `Invalid unit price for activity ${activity.id}`,
  );
}

function activityAmount(activity: ActivityRebuildRow): Decimal {
  return decimalOptionalOrDefault(
    activity.amount,
    new Decimal(0),
    `Invalid amount for activity ${activity.id}`,
  );
}

function activityFee(activity: ActivityRebuildRow): Decimal {
  return decimalOptionalOrDefault(
    activity.fee,
    new Decimal(0),
    `Invalid fee for activity ${activity.id}`,
  ).abs();
}

function warnPortfolioJob(options: LocalPortfolioJobServiceOptions, message: string): void {
  options.warn?.(message);
}

function buildTotalSnapshot(
  date: string,
  snapshots: ParsedSnapshot[],
  baseCurrency: string,
  calculatedAt: string,
  options: LocalPortfolioJobServiceOptions,
): ParsedSnapshot {
  const cashBalances = new Map<string, Decimal>();
  const positions = new Map<string, NormalizedPosition>();
  let costBasis = new Decimal(0);
  let netContributionBase = new Decimal(0);

  for (const snapshot of snapshots) {
    for (const [currency, amount] of snapshot.cashBalances) {
      cashBalances.set(currency, (cashBalances.get(currency) ?? new Decimal(0)).plus(amount));
    }
    const contributionBase =
      snapshot.netContributionBase ??
      convertRequired(snapshot.netContribution, snapshot.row.currency, baseCurrency, date, options);
    netContributionBase = netContributionBase.plus(contributionBase);
    for (const position of snapshot.positions.values()) {
      const existing = positions.get(position.assetId);
      if (existing) {
        existing.quantity = existing.quantity.plus(position.quantity);
        existing.totalCostBasis = existing.totalCostBasis.plus(position.totalCostBasis);
        existing.averageCost = existing.quantity.isZero()
          ? new Decimal(0)
          : roundDecimal(existing.totalCostBasis.div(existing.quantity));
        existing.lots = [...existing.lots, ...position.lots];
        if (position.inceptionDate < existing.inceptionDate) {
          existing.inceptionDate = position.inceptionDate;
        }
      } else {
        positions.set(position.assetId, {
          ...position,
          id: `${position.assetId}_${PORTFOLIO_TOTAL_ACCOUNT_ID}`,
          accountId: PORTFOLIO_TOTAL_ACCOUNT_ID,
        });
      }
      const convertedCostBasis = convertRequired(
        position.totalCostBasis,
        position.currency,
        baseCurrency,
        date,
        options,
      );
      costBasis = costBasis.plus(convertedCostBasis);
    }
  }

  const cashTotalBase = totalCashInCurrency(cashBalances, baseCurrency, date, options);
  const row: SnapshotRow = {
    id: `${PORTFOLIO_TOTAL_ACCOUNT_ID}_${date}`,
    account_id: PORTFOLIO_TOTAL_ACCOUNT_ID,
    snapshot_date: date,
    currency: baseCurrency,
    positions: serializePositions(positions),
    cash_balances: serializeDecimalRecord(cashBalances),
    cost_basis: decimalToString(roundDecimal(costBasis)),
    net_contribution: decimalToString(roundDecimal(netContributionBase)),
    net_contribution_base: decimalToString(roundDecimal(netContributionBase)),
    cash_total_account_currency: decimalToString(cashTotalBase),
    cash_total_base_currency: decimalToString(cashTotalBase),
    calculated_at: calculatedAt,
  };
  return {
    row,
    positions,
    cashBalances,
    costBasis: roundDecimal(costBasis),
    netContribution: roundDecimal(netContributionBase),
    netContributionBase: roundDecimal(netContributionBase),
  };
}

function totalCashInCurrency(
  cashBalances: Map<string, Decimal>,
  targetCurrency: string,
  date: string,
  options: LocalPortfolioJobServiceOptions,
): Decimal {
  let total = new Decimal(0);
  for (const [currency, amount] of cashBalances) {
    total = total.plus(convertRequired(amount, currency, targetCurrency, date, options));
  }
  return roundDecimal(total);
}

function totalCashInCurrencyWithFallback(
  cashBalances: Map<string, Decimal>,
  targetCurrency: string,
  date: string,
  options: LocalPortfolioJobServiceOptions,
): Decimal {
  let total = new Decimal(0);
  for (const [currency, amount] of cashBalances) {
    total = total.plus(
      convertAmountWithFallback(amount, currency, targetCurrency, date, options, amount),
    );
  }
  return roundDecimal(total);
}

function groupSnapshotsByAccount(snapshots: ParsedSnapshot[]): Map<string, ParsedSnapshot[]> {
  const grouped = new Map<string, ParsedSnapshot[]>();
  for (const snapshot of snapshots) {
    const existing = grouped.get(snapshot.row.account_id) ?? [];
    existing.push(snapshot);
    grouped.set(snapshot.row.account_id, existing);
  }
  return grouped;
}

function uniqueSortedDates(snapshots: ParsedSnapshot[]): string[] {
  return Array.from(new Set(snapshots.map((snapshot) => snapshot.row.snapshot_date))).sort();
}

function latestSnapshotsOnOrBeforeDate(
  snapshotsByAccount: Map<string, ParsedSnapshot[]>,
  date: string,
): ParsedSnapshot[] {
  const snapshots: ParsedSnapshot[] = [];
  for (const accountSnapshots of snapshotsByAccount.values()) {
    const latest = accountSnapshots.filter((snapshot) => snapshot.row.snapshot_date <= date).at(-1);
    if (latest) {
      snapshots.push(latest);
    }
  }
  return snapshots;
}

function snapshotAssetIds(snapshots: ParsedSnapshot[]): string[] {
  const assetIds = new Set<string>();
  for (const snapshot of snapshots) {
    for (const assetId of snapshot.positions.keys()) {
      assetIds.add(assetId);
    }
  }
  return Array.from(assetIds);
}

function readAssetsWithQuotes(
  db: Database,
  assetIds: string[],
  endDate: string | null,
): Set<string> {
  if (assetIds.length === 0 || !endDate) {
    return new Set();
  }
  const placeholders = assetIds.map(() => "?").join(", ");
  const rows = db
    .query<{ asset_id: string }, string[]>(
      `
        SELECT DISTINCT asset_id
        FROM quotes
        WHERE asset_id IN (${placeholders})
          AND day <= ?
      `,
    )
    .all(...assetIds, endDate);
  return new Set(rows.map((row) => row.asset_id));
}

function latestQuoteAsOf(db: Database, assetId: string, date: string): QuoteRow | null {
  return (
    db
      .query<QuoteRow, [string, string]>(
        `
          SELECT asset_id, day, close, currency, timestamp
          FROM quotes
          WHERE asset_id = ?
            AND day <= ?
          ORDER BY day DESC, timestamp DESC
          LIMIT 1
        `,
      )
      .get(assetId, date) ?? null
  );
}

function valuationStartDate(
  db: Database,
  accountId: string,
  config: PortfolioJobConfig,
): string | null {
  if (config.sinceDate) {
    return config.sinceDate;
  }
  if (config.valuationMode === "full") {
    return null;
  }
  return latestValuationDate(db, accountId);
}

function totalSnapshotStartDate(db: Database, config: PortfolioJobConfig): string | null {
  if (config.sinceDate) {
    return config.sinceDate;
  }
  if (config.snapshotMode === "full") {
    return null;
  }
  const latest = latestSnapshotDate(db, PORTFOLIO_TOTAL_ACCOUNT_ID);
  return latest ? nextDate(latest) : null;
}

function latestValuationDate(db: Database, accountId: string): string | null {
  return (
    db
      .query<{ valuation_date: string }, [string]>(
        `
          SELECT valuation_date
          FROM daily_account_valuation
          WHERE account_id = ?
          ORDER BY valuation_date DESC
          LIMIT 1
        `,
      )
      .get(accountId)?.valuation_date ?? null
  );
}

function latestSnapshotDate(db: Database, accountId: string): string | null {
  return (
    db
      .query<{ snapshot_date: string }, [string]>(
        `
          SELECT snapshot_date
          FROM holdings_snapshots
          WHERE account_id = ?
          ORDER BY snapshot_date DESC
          LIMIT 1
        `,
      )
      .get(accountId)?.snapshot_date ?? null
  );
}

function deleteValuationsForMode(
  db: Database,
  accountId: string,
  config: PortfolioJobConfig,
  startDate: string | null,
): void {
  if (config.valuationMode !== "full" && !config.sinceDate) {
    return;
  }
  if (startDate) {
    db.query(
      "DELETE FROM daily_account_valuation WHERE account_id = ? AND valuation_date >= ?",
    ).run(accountId, startDate);
    return;
  }
  db.query("DELETE FROM daily_account_valuation WHERE account_id = ?").run(accountId);
}

function deleteTotalSnapshotsForMode(
  db: Database,
  config: PortfolioJobConfig,
  startDate: string | null,
  nonArchivedAccountCount: number,
): void {
  if (config.snapshotMode === "full" || config.sinceDate || nonArchivedAccountCount === 0) {
    if (startDate) {
      db.query("DELETE FROM holdings_snapshots WHERE account_id = ? AND snapshot_date >= ?").run(
        PORTFOLIO_TOTAL_ACCOUNT_ID,
        startDate,
      );
      return;
    }
    db.query("DELETE FROM holdings_snapshots WHERE account_id = ?").run(PORTFOLIO_TOTAL_ACCOUNT_ID);
  }
}

function upsertValuation(db: Database, valuation: CalculatedValuation): void {
  db.query(
    `
      INSERT INTO daily_account_valuation (
        id,
        account_id,
        valuation_date,
        account_currency,
        base_currency,
        fx_rate_to_base,
        cash_balance,
        investment_market_value,
        total_value,
        cost_basis,
        net_contribution,
        calculated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        account_id = excluded.account_id,
        valuation_date = excluded.valuation_date,
        account_currency = excluded.account_currency,
        base_currency = excluded.base_currency,
        fx_rate_to_base = excluded.fx_rate_to_base,
        cash_balance = excluded.cash_balance,
        investment_market_value = excluded.investment_market_value,
        total_value = excluded.total_value,
        cost_basis = excluded.cost_basis,
        net_contribution = excluded.net_contribution,
        calculated_at = excluded.calculated_at
    `,
  ).run(
    valuation.id,
    valuation.accountId,
    valuation.valuationDate,
    valuation.accountCurrency,
    valuation.baseCurrency,
    decimalToString(valuation.fxRateToBase),
    decimalToString(valuation.cashBalance),
    decimalToString(valuation.investmentMarketValue),
    decimalToString(valuation.totalValue),
    decimalToString(valuation.costBasis),
    decimalToString(valuation.netContribution),
    valuation.calculatedAt,
  );
}

function upsertTotalSnapshot(db: Database, snapshot: ParsedSnapshot): void {
  db.query(
    `
      INSERT INTO holdings_snapshots (
        id,
        account_id,
        snapshot_date,
        currency,
        positions,
        cash_balances,
        cost_basis,
        net_contribution,
        net_contribution_base,
        cash_total_account_currency,
        cash_total_base_currency,
        calculated_at,
        source
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CALCULATED')
      ON CONFLICT(id) DO UPDATE SET
        account_id = excluded.account_id,
        snapshot_date = excluded.snapshot_date,
        currency = excluded.currency,
        positions = excluded.positions,
        cash_balances = excluded.cash_balances,
        cost_basis = excluded.cost_basis,
        net_contribution = excluded.net_contribution,
        net_contribution_base = excluded.net_contribution_base,
        cash_total_account_currency = excluded.cash_total_account_currency,
        cash_total_base_currency = excluded.cash_total_base_currency,
        calculated_at = excluded.calculated_at,
        source = excluded.source
    `,
  ).run(
    snapshot.row.id,
    snapshot.row.account_id,
    snapshot.row.snapshot_date,
    snapshot.row.currency,
    snapshot.row.positions,
    snapshot.row.cash_balances,
    snapshot.row.cost_basis,
    snapshot.row.net_contribution,
    snapshot.row.net_contribution_base ?? snapshot.row.net_contribution,
    snapshot.row.cash_total_account_currency ??
      decimalToString(totalCashInSnapshotCurrency(snapshot)),
    snapshot.row.cash_total_base_currency ?? decimalToString(totalCashInSnapshotCurrency(snapshot)),
    snapshot.row.calculated_at ?? new Date().toISOString(),
  );
}

function totalCashInSnapshotCurrency(snapshot: ParsedSnapshot): Decimal {
  return roundDecimal(
    Array.from(snapshot.cashBalances.values()).reduce(
      (total, amount) => total.plus(amount),
      new Decimal(0),
    ),
  );
}

function exchangeRateForDate(
  fromCurrency: string,
  toCurrency: string,
  date: string,
  options: LocalPortfolioJobServiceOptions,
): Decimal | null {
  if (fromCurrency === toCurrency) {
    return new Decimal(1);
  }
  if (!options.exchangeRateService) {
    options.warn?.(`Missing exchange rate service for ${fromCurrency}/${toCurrency} on ${date}`);
    return null;
  }
  try {
    return decimalOrThrow(
      options.exchangeRateService.getExchangeRateForDate(fromCurrency, toCurrency, date),
      `Invalid exchange rate ${fromCurrency}/${toCurrency} on ${date}`,
    );
  } catch (error) {
    options.warn?.(
      `Missing exchange rate ${fromCurrency}/${toCurrency} on ${date}: ${errorMessage(error)}`,
    );
    return null;
  }
}

function convertRequired(
  amount: Decimal,
  fromCurrency: string,
  toCurrency: string,
  date: string,
  options: LocalPortfolioJobServiceOptions,
): Decimal {
  const rate = exchangeRateForDate(fromCurrency, toCurrency, date, options);
  if (!rate) {
    throw new Error(`Missing exchange rate ${fromCurrency}/${toCurrency} on ${date}`);
  }
  return amount.mul(rate);
}

function resolveBaseCurrency(options: LocalPortfolioJobServiceOptions): string {
  const value =
    typeof options.baseCurrency === "function" ? options.baseCurrency() : options.baseCurrency;
  return value?.trim() || "USD";
}

function resolveTimezone(options: LocalPortfolioJobServiceOptions): string {
  const value = typeof options.timezone === "function" ? options.timezone() : options.timezone;
  const timezone = value?.trim() || "UTC";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: timezone }).resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

function createActivityDateFormatter(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function nextDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

function parseJsonRecord(serialized: string): Record<string, unknown> {
  const parsed = JSON.parse(serialized) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("Expected JSON object in holdings snapshot");
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : String(value);
}

function decimalOptionalOrDefault(value: unknown, fallback: Decimal, message: string): Decimal {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return decimalOrThrow(value, message);
}

function decimalOrThrow(value: unknown, message: string): Decimal {
  try {
    const decimal = new Decimal(value as Decimal.Value);
    if (decimal.isFinite()) {
      return decimal;
    }
  } catch {
    // Fall through to the uniform domain error below.
  }
  throw new Error(message);
}

function roundDecimal(value: Decimal): Decimal {
  return value.toDecimalPlaces(DECIMAL_PRECISION);
}

function decimalToString(value: Decimal): string {
  return roundDecimal(value).toString();
}

function normalizeAmount(value: unknown, currency: string): [Decimal, string] {
  const amount = decimalOrThrow(value, `Invalid amount for ${currency}`);
  const rule = CURRENCY_NORMALIZATION_RULES[currency];
  return rule ? [amount.mul(rule.factor), rule.majorCode] : [amount, currency];
}

const CURRENCY_NORMALIZATION_RULES: Record<string, { majorCode: string; factor: Decimal }> = {
  GBp: { majorCode: "GBP", factor: new Decimal("0.01") },
  GBX: { majorCode: "GBP", factor: new Decimal("0.01") },
  KWF: { majorCode: "KWD", factor: new Decimal("0.01") },
  ZAc: { majorCode: "ZAR", factor: new Decimal("0.01") },
  ZAC: { majorCode: "ZAR", factor: new Decimal("0.01") },
  ILA: { majorCode: "ILS", factor: new Decimal("0.01") },
};

function serializePositions(positions: Map<string, NormalizedPosition>): string {
  return JSON.stringify(
    Object.fromEntries(
      Array.from(positions.entries()).map(([assetId, position]) => [
        assetId,
        {
          id: position.id,
          accountId: position.accountId,
          assetId: position.assetId,
          quantity: decimalToString(position.quantity),
          averageCost: decimalToString(position.averageCost),
          totalCostBasis: decimalToString(position.totalCostBasis),
          currency: position.currency,
          inceptionDate: position.inceptionDate,
          lots: position.lots,
          createdAt: position.createdAt,
          lastUpdated: position.lastUpdated,
          isAlternative: position.isAlternative,
          contractMultiplier: decimalToString(position.contractMultiplier),
        },
      ]),
    ),
  );
}

function serializeDecimalRecord(values: Map<string, Decimal>): string {
  return JSON.stringify(
    Object.fromEntries(
      Array.from(values.entries()).map(([key, value]) => [key, decimalToString(value)]),
    ),
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function buildPortfolioRecalculateConfig(
  body: PortfolioRequestBody = {},
): PortfolioJobConfig {
  const marketSyncMode =
    body.marketSyncMode && body.marketSyncMode.type !== "none"
      ? body.marketSyncMode
      : { type: "backfill_history" as const, asset_ids: null, days: DEFAULT_HISTORY_DAYS };
  return {
    accountIds: body.accountIds ?? null,
    marketSyncMode,
    snapshotMode: "full",
    valuationMode: "full",
    sinceDate: null,
  };
}
