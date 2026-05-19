import type { Database } from "bun:sqlite";

import Decimal from "decimal.js";

import type { BackendEventBus } from "../events";
import type { ExchangeRateService } from "./exchange-rates";
import type { MarketDataService } from "./market-data";

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
  marketDataService?: Pick<MarketDataService, "syncMarketData">;
  baseCurrency?: string | (() => string | undefined);
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

interface AccountRow {
  id: string;
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
    options.eventBus?.publish({ name: MARKET_SYNC_START });
    try {
      await options.marketDataService.syncMarketData(config.marketSyncMode);
      options.exchangeRateService?.initialize();
      options.eventBus?.publish({
        name: MARKET_SYNC_COMPLETE,
        payload: { failed_syncs: [], skipped_reasons: [] },
      });
    } catch (error) {
      options.eventBus?.publish({
        name: MARKET_SYNC_ERROR,
        payload: errorMessage(error),
      });
      throw error;
    }
  }

  options.eventBus?.publish({ name: PORTFOLIO_UPDATE_START });
  try {
    recalculatePortfolioFromExistingSnapshots(db, config, options);
    options.eventBus?.publish({ name: PORTFOLIO_UPDATE_COMPLETE });
  } catch (error) {
    options.eventBus?.publish({
      name: PORTFOLIO_UPDATE_ERROR,
      payload: errorMessage(error),
    });
    throw error;
  }
}

function recalculatePortfolioFromExistingSnapshots(
  db: Database,
  config: PortfolioJobConfig,
  options: LocalPortfolioJobServiceOptions,
): void {
  const run = db.transaction(() => {
    const baseCurrency = resolveBaseCurrency(options);
    const nowIso = (options.now ?? (() => new Date()))().toISOString();
    const nonArchivedAccountIds = readNonArchivedAccountIds(db);
    const targetAccountIds = (config.accountIds ?? nonArchivedAccountIds).filter(
      (accountId) => accountId !== PORTFOLIO_TOTAL_ACCOUNT_ID,
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

function readNonArchivedAccountIds(db: Database): string[] {
  return db
    .query<AccountRow, []>(
      `
        SELECT id
        FROM accounts
        WHERE is_archived = 0
        ORDER BY name ASC, id ASC
      `,
    )
    .all()
    .map((account) => account.id);
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
    if (!position.quantity.isZero()) {
      positions.set(position.assetId, position);
    }
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
    if (assetsWithQuotes.has(position.assetId)) {
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
