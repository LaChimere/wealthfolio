import { createHash, randomUUID } from "node:crypto";

import type { Database } from "bun:sqlite";

import Decimal from "decimal.js";

import type { ExchangeRateService } from "./exchange-rates";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN });

export interface HoldingInput {
  assetId?: string;
  symbol: string;
  quantity: string;
  currency: string;
  averageCost?: string;
  exchangeMic?: string;
  name?: string;
  dataSource?: string;
  assetKind?: string;
}

export interface SaveManualHoldingsRequest {
  accountId: string;
  holdings: HoldingInput[];
  cashBalances: Record<string, string>;
  snapshotDate?: string;
}

export interface HoldingsPositionInput {
  symbol: string;
  quantity: string;
  avgCost?: string;
  currency: string;
  exchangeMic?: string;
  assetId?: string;
}

export interface HoldingsSnapshotInput {
  date: string;
  positions: HoldingsPositionInput[];
  cashBalances: Record<string, string>;
}

export interface HoldingsImportRequest {
  accountId: string;
  snapshots: HoldingsSnapshotInput[];
}

export interface SymbolCheckResult {
  symbol: string;
  found: boolean;
  assetName: string | null;
  assetId: string | null;
  currency: string | null;
  exchangeMic: string | null;
}

export interface CheckHoldingsImportResult {
  existingDates: string[];
  symbols: SymbolCheckResult[];
  validationErrors: string[];
}

export interface ImportHoldingsCsvResult {
  snapshotsImported: number;
  snapshotsFailed: number;
  errors: string[];
}

export interface HoldingsService {
  getHoldings(accountId: string): Promise<unknown[]> | unknown[];
  getHolding(accountId: string, assetId: string): Promise<unknown | null> | unknown | null;
  getAssetHoldings(assetId: string): Promise<unknown[]> | unknown[];
  getHistoricalValuations(
    accountId: string,
    startDate?: string,
    endDate?: string,
  ): Promise<unknown[]> | unknown[];
  getLatestValuations(accountIds?: string[]): Promise<unknown[]> | unknown[];
  getPortfolioAllocations(accountId: string): Promise<unknown> | unknown;
  getHoldingsByAllocation(
    accountId: string,
    taxonomyId: string,
    categoryId: string,
  ): Promise<unknown> | unknown;
  getSnapshots(
    accountId: string,
    dateFrom?: string,
    dateTo?: string,
  ): Promise<unknown[]> | unknown[];
  getSnapshotByDate(accountId: string, date: string): Promise<unknown[]> | unknown[];
  deleteSnapshot(accountId: string, date: string): Promise<void> | void;
  saveManualHoldings(request: SaveManualHoldingsRequest): Promise<void> | void;
  checkHoldingsImport(request: HoldingsImportRequest): Promise<unknown> | unknown;
  importHoldingsCsv(
    request: HoldingsImportRequest,
  ): Promise<ImportHoldingsCsvResult> | ImportHoldingsCsvResult;
}

export interface HoldingsServiceOptions {
  baseCurrency?: string | (() => string | undefined);
  exchangeRateService?: Pick<ExchangeRateService, "getLatestExchangeRate">;
  today?: () => string;
}

export interface DailyAccountValuation {
  id: string;
  accountId: string;
  valuationDate: string;
  accountCurrency: string;
  baseCurrency: string;
  fxRateToBase: number;
  cashBalance: number;
  investmentMarketValue: number;
  totalValue: number;
  costBasis: number;
  netContribution: number;
  calculatedAt: string;
}

export interface SnapshotInfo {
  id: string;
  snapshotDate: string;
  source: string;
  positionCount: number;
  cashCurrencyCount: number;
}

export interface MonetaryValue {
  local: number;
  base: number;
}

export interface Instrument {
  id: string;
  symbol: string;
  name: string | null;
  currency: string;
  notes: string | null;
  pricingMode: string;
  preferredProvider: string | null;
  exchangeMic: string | null;
  classifications: null;
}

export interface Holding {
  id: string;
  accountId: string;
  holdingType: "cash" | "security" | "alternativeAsset";
  instrument: Instrument | null;
  assetKind: string | null;
  quantity: number;
  openDate: string | null;
  lots: null;
  contractMultiplier: number;
  localCurrency: string;
  baseCurrency: string;
  fxRate: number | null;
  marketValue: MonetaryValue;
  costBasis: MonetaryValue | null;
  price: number | null;
  purchasePrice: number | null;
  unrealizedGain: MonetaryValue | null;
  unrealizedGainPct: number | null;
  realizedGain: MonetaryValue | null;
  realizedGainPct: number | null;
  totalGain: MonetaryValue | null;
  totalGainPct: number | null;
  dayChange: MonetaryValue | null;
  dayChangePct: number | null;
  prevCloseValue: MonetaryValue | null;
  weight: number;
  asOfDate: string;
  metadata: unknown | null;
}

export interface HoldingSummary {
  id: string;
  symbol: string;
  name: string | null;
  holdingType: Holding["holdingType"];
  quantity: number;
  marketValue: number;
  currency: string;
  weightInCategory: number;
}

export interface CategoryAllocation {
  categoryId: string;
  categoryName: string;
  color: string;
  value: number;
  percentage: number;
  children?: CategoryAllocation[];
}

export interface TaxonomyAllocation {
  taxonomyId: string;
  taxonomyName: string;
  color: string;
  categories: CategoryAllocation[];
}

export interface PortfolioAllocations {
  assetClasses: TaxonomyAllocation;
  sectors: TaxonomyAllocation;
  regions: TaxonomyAllocation;
  riskCategory: TaxonomyAllocation;
  securityTypes: TaxonomyAllocation;
  customGroups: TaxonomyAllocation[];
  totalValue: number;
}

export interface AllocationHoldings {
  taxonomyId: string;
  taxonomyName: string;
  categoryId: string;
  categoryName: string;
  color: string;
  holdings: HoldingSummary[];
  totalValue: number;
  currency: string;
}

export class HoldingsNotImplementedError extends Error {
  readonly status = 501;
  readonly code = "not_implemented";

  constructor(message: string) {
    super(message);
    this.name = "HoldingsNotImplementedError";
  }
}

interface DailyAccountValuationRow {
  id: string;
  account_id: string;
  valuation_date: string;
  account_currency: string;
  base_currency: string;
  fx_rate_to_base: string;
  cash_balance: string;
  investment_market_value: string;
  total_value: string;
  cost_basis: string;
  net_contribution: string;
  calculated_at: string;
}

interface SnapshotInfoRow {
  id: string;
  snapshot_date: string;
  source: string | null;
  positions: string;
  cash_balances: string;
}

interface SnapshotRow {
  id: string;
  account_id: string;
  snapshot_date: string;
  currency: string;
  positions: string;
  cash_balances: string;
}

interface SyntheticSnapshotSourceRow extends SnapshotRow {
  source: string;
  cost_basis: string;
  net_contribution: string;
}

interface SnapshotPosition {
  assetId: string;
  quantity: unknown;
  totalCostBasis: unknown;
  currency: string;
  inceptionDate: string;
  contractMultiplier?: unknown;
}

interface AssetRow {
  id: string;
  kind: string;
  name: string | null;
  display_code: string | null;
  notes: string | null;
  metadata: string | null;
  is_active: number;
  quote_mode: string;
  quote_ccy: string;
  instrument_type: string | null;
  instrument_symbol: string | null;
  instrument_exchange_mic: string | null;
  provider_config: string | null;
}

interface TaxonomyRow {
  id: string;
  name: string;
  color: string;
  is_system: number;
  sort_order: number;
}

interface TaxonomyCategoryRow {
  id: string;
  taxonomy_id: string;
  parent_id: string | null;
  name: string;
  color: string;
  sort_order: number;
}

interface AssetTaxonomyAssignmentRow {
  asset_id: string;
  taxonomy_id: string;
  category_id: string;
  weight: number;
}

interface Taxonomy {
  id: string;
  name: string;
  color: string;
  isSystem: boolean;
}

interface TaxonomyCategory {
  id: string;
  taxonomyId: string;
  parentId: string | null;
  name: string;
  color: string;
}

interface TaxonomyWithCategories {
  taxonomy: Taxonomy;
  categories: TaxonomyCategory[];
}

interface AssetTaxonomyAssignment {
  assetId: string;
  taxonomyId: string;
  categoryId: string;
  weight: number;
}

interface AccountExistsRow {
  count: number;
}

interface AccountCurrencyRow {
  currency: string;
}

interface PersistHoldingsSnapshotRequest {
  accountId: string;
  accountCurrency: string;
  snapshotDate: string;
  holdings: HoldingInput[];
  cashBalances: Record<string, string>;
  source: "MANUAL_ENTRY" | "CSV_IMPORT";
}

interface SnapshotDateRow {
  snapshot_date: string;
}

interface QuoteRow {
  asset_id: string;
  day: string;
  source: string;
  close: string;
  currency: string;
  timestamp: string;
}

interface LatestQuotePair {
  latest: QuoteRow;
  previous: QuoteRow | null;
}

interface CurrencyNormalizationRule {
  majorCode: string;
  factor: Decimal;
}

const ALTERNATIVE_ASSET_KINDS = new Set([
  "PROPERTY",
  "VEHICLE",
  "COLLECTIBLE",
  "PRECIOUS_METAL",
  "LIABILITY",
  "OTHER",
]);

const CURRENCY_NORMALIZATION_RULES = new Map<string, CurrencyNormalizationRule>([
  ["GBp", { majorCode: "GBP", factor: new Decimal("0.01") }],
  ["GBX", { majorCode: "GBP", factor: new Decimal("0.01") }],
  ["KWF", { majorCode: "KWD", factor: new Decimal("0.01") }],
  ["ZAc", { majorCode: "ZAR", factor: new Decimal("0.01") }],
  ["ZAC", { majorCode: "ZAR", factor: new Decimal("0.01") }],
  ["ILA", { majorCode: "ILS", factor: new Decimal("0.01") }],
]);

const DECIMAL_PRECISION = 8;

const UNKNOWN_CATEGORY_ID = "__UNKNOWN__";
const UNKNOWN_CATEGORY_NAME = "Unknown";
const UNKNOWN_CATEGORY_COLOR = "#878580";
const CASH_BANK_DEPOSITS_CATEGORY_ID = "CASH_BANK_DEPOSITS";
const CASH_CATEGORY_ID = "CASH";

const DEFAULT_TAXONOMY_ALLOCATIONS = {
  assetClasses: { taxonomyId: "asset_classes", taxonomyName: "Asset Classes", color: "#879a39" },
  sectors: { taxonomyId: "industries_gics", taxonomyName: "Sectors", color: "#da702c" },
  regions: { taxonomyId: "regions", taxonomyName: "Regions", color: "#8b7ec8" },
  riskCategory: { taxonomyId: "risk_category", taxonomyName: "Risk Category", color: "#d14d41" },
  securityTypes: {
    taxonomyId: "instrument_type",
    taxonomyName: "Instrument Type",
    color: "#4385be",
  },
} as const;

export function createHoldingsService(
  db: Database,
  options: HoldingsServiceOptions = {},
): HoldingsService {
  return {
    getHoldings(accountId) {
      try {
        return readLiveHoldings(db, accountId, options);
      } catch (error) {
        return Promise.reject(error);
      }
    },
    getHolding(accountId, assetId) {
      try {
        return readLiveHolding(db, accountId, assetId, options);
      } catch (error) {
        return Promise.reject(error);
      }
    },
    getAssetHoldings(assetId) {
      try {
        return readAssetHoldings(db, assetId, options);
      } catch (error) {
        return Promise.reject(error);
      }
    },
    getHistoricalValuations(accountId, startDate, endDate) {
      return readHistoricalValuations(db, accountId, startDate, endDate);
    },
    getLatestValuations(accountIds) {
      const ids = accountIds && accountIds.length > 0 ? accountIds : readActiveAccountIds(db);
      return ids.length === 0 ? [] : readLatestValuations(db, ids);
    },
    getPortfolioAllocations(accountId) {
      try {
        return readPortfolioAllocations(db, accountId, options);
      } catch (error) {
        return Promise.reject(error);
      }
    },
    getHoldingsByAllocation(accountId, taxonomyId, categoryId) {
      try {
        return readHoldingsByAllocation(db, accountId, taxonomyId, categoryId, options);
      } catch (error) {
        return Promise.reject(error);
      }
    },
    getSnapshots(accountId, dateFrom, dateTo) {
      return readSnapshotInfo(db, accountId, dateFrom, dateTo);
    },
    getSnapshotByDate(accountId, date) {
      try {
        return readSnapshotHoldings(db, accountId, date, resolveBaseCurrency(options));
      } catch (error) {
        return Promise.reject(error);
      }
    },
    deleteSnapshot(accountId, date) {
      try {
        deleteSnapshot(db, accountId, date);
      } catch (error) {
        return Promise.reject(error);
      }
    },
    saveManualHoldings(request) {
      try {
        saveManualHoldings(db, request, options);
      } catch (error) {
        return Promise.reject(error);
      }
    },
    checkHoldingsImport(request) {
      try {
        return checkHoldingsImport(db, request);
      } catch (error) {
        return Promise.reject(error);
      }
    },
    importHoldingsCsv(request) {
      try {
        return importHoldingsCsv(db, request);
      } catch (error) {
        return Promise.reject(error);
      }
    },
  };
}

function readSnapshotInfo(
  db: Database,
  accountId: string,
  dateFrom: string | undefined,
  dateTo: string | undefined,
): SnapshotInfo[] {
  const conditions = ["account_id = ?"];
  const params = [accountId];
  if (dateFrom) {
    conditions.push("snapshot_date >= ?");
    params.push(dateFrom);
  }
  if (dateTo) {
    conditions.push("snapshot_date <= ?");
    params.push(dateTo);
  }

  return db
    .query<SnapshotInfoRow, string[]>(
      `
        SELECT id, snapshot_date, source, positions, cash_balances
        FROM holdings_snapshots
        WHERE ${conditions.join(" AND ")}
        ORDER BY snapshot_date ASC
      `,
    )
    .all(...params)
    .map((row) => ({
      id: row.id,
      snapshotDate: row.snapshot_date,
      source: row.source ?? "CALCULATED",
      positionCount: Object.keys(parseJsonObjectOrEmpty(row.positions)).length,
      cashCurrencyCount: Object.keys(parseJsonObjectOrEmpty(row.cash_balances)).length,
    }));
}

function readSnapshotHoldings(
  db: Database,
  accountId: string,
  date: string,
  baseCurrency: string | undefined,
): Holding[] {
  const snapshot = readSnapshotByDate(db, accountId, date);
  if (!snapshot) {
    throw new Error(`No snapshot found for date ${date}`);
  }

  return buildHoldingsFromSnapshot(
    db,
    snapshot,
    baseCurrency ?? snapshot.currency,
    snapshot.snapshot_date,
    false,
  );
}

function deleteSnapshot(db: Database, accountId: string, date: string): void {
  const snapshot = db
    .query<{ id: string; source: string | null }, [string, string]>(
      `
        SELECT id, source
        FROM holdings_snapshots
        WHERE account_id = ? AND snapshot_date = ?
      `,
    )
    .get(accountId, date);
  if (!snapshot) {
    throw new Error(`No snapshot found for date ${date}`);
  }
  if ((snapshot.source ?? "CALCULATED") === "CALCULATED") {
    throw new Error(
      "Cannot delete calculated snapshots. Only manual or imported snapshots can be deleted.",
    );
  }

  db.prepare("DELETE FROM holdings_snapshots WHERE account_id = ? AND snapshot_date = ?").run(
    accountId,
    date,
  );
}

function saveManualHoldings(
  db: Database,
  request: SaveManualHoldingsRequest,
  options: HoldingsServiceOptions,
): void {
  const accountCurrency = readAccountCurrency(db, request.accountId);
  const snapshotDate = request.snapshotDate ?? resolveToday(options);
  persistHoldingsSnapshot(db, {
    accountId: request.accountId,
    accountCurrency,
    snapshotDate,
    holdings: request.holdings,
    cashBalances: request.cashBalances,
    source: "MANUAL_ENTRY",
  });
}

function importHoldingsCsv(db: Database, request: HoldingsImportRequest): ImportHoldingsCsvResult {
  const accountCurrency = readAccountCurrency(db, request.accountId);
  const result: ImportHoldingsCsvResult = {
    snapshotsImported: 0,
    snapshotsFailed: 0,
    errors: [],
  };

  for (const snapshot of request.snapshots) {
    try {
      persistHoldingsSnapshot(db, {
        accountId: request.accountId,
        accountCurrency,
        snapshotDate: snapshot.date,
        holdings: snapshot.positions.map(importPositionToHoldingInput),
        cashBalances: snapshot.cashBalances,
        source: "CSV_IMPORT",
      });
      result.snapshotsImported += 1;
    } catch (error) {
      result.snapshotsFailed += 1;
      result.errors.push(`Date ${snapshot.date}: ${errorMessage(error)}`);
    }
  }

  return result;
}

function importPositionToHoldingInput(position: HoldingsPositionInput): HoldingInput {
  const holding: HoldingInput = {
    symbol: position.symbol,
    quantity: position.quantity,
    currency: position.currency,
  };
  if (position.assetId !== undefined) {
    holding.assetId = position.assetId;
  }
  if (position.exchangeMic !== undefined) {
    holding.exchangeMic = position.exchangeMic;
  }
  if (position.avgCost !== undefined && isValidFiniteDecimalString(position.avgCost)) {
    holding.averageCost = position.avgCost;
  }
  return holding;
}

function persistHoldingsSnapshot(db: Database, request: PersistHoldingsSnapshotRequest): void {
  if (!isValidDateString(request.snapshotDate)) {
    throw new Error(`Invalid date format: ${request.snapshotDate}`);
  }

  const now = new Date().toISOString();
  const positions: Record<string, SnapshotPosition> = {};

  db.transaction(() => {
    const manualQuotesByAsset = new Map<
      string,
      { quantity: Decimal; totalCostBasis: Decimal; currency: string }
    >();
    for (const holding of request.holdings) {
      const quantity = decimalOrThrow(holding.quantity, `Invalid quantity for ${holding.symbol}`);
      if (quantity.isZero()) {
        continue;
      }
      const averageCost = holding.averageCost
        ? decimalOrThrow(holding.averageCost, `Invalid average cost for ${holding.symbol}`)
        : new Decimal(0);
      const asset = getOrCreateManualSnapshotAsset(db, holding);
      if (holding.dataSource === "MANUAL" && asset.quote_mode !== "MANUAL") {
        db.prepare("UPDATE assets SET quote_mode = 'MANUAL' WHERE id = ?").run(asset.id);
        asset.quote_mode = "MANUAL";
      }

      const totalCostBasis = quantity.mul(averageCost);
      if (
        (asset.quote_mode === "MANUAL" || holding.dataSource === "MANUAL") &&
        !averageCost.isZero()
      ) {
        const existingQuote = manualQuotesByAsset.get(asset.id);
        if (existingQuote && existingQuote.currency !== holding.currency) {
          throw new Error(`Conflicting currencies for duplicate holding ${holding.symbol}`);
        }
        manualQuotesByAsset.set(asset.id, {
          quantity: (existingQuote?.quantity ?? new Decimal(0)).add(quantity),
          totalCostBasis: (existingQuote?.totalCostBasis ?? new Decimal(0)).add(totalCostBasis),
          currency: holding.currency,
        });
      }

      const existingPosition = positions[asset.id];
      if (existingPosition) {
        if (existingPosition.currency !== holding.currency) {
          throw new Error(`Conflicting currencies for duplicate holding ${holding.symbol}`);
        }
        existingPosition.quantity = decimalOrFallback(existingPosition.quantity, new Decimal(0))
          .add(quantity)
          .toString();
        existingPosition.totalCostBasis = decimalOrFallback(
          existingPosition.totalCostBasis,
          new Decimal(0),
        )
          .add(totalCostBasis)
          .toString();
      } else {
        positions[asset.id] = {
          assetId: asset.id,
          quantity: quantity.toString(),
          totalCostBasis: totalCostBasis.toString(),
          currency: holding.currency,
          inceptionDate: now,
          contractMultiplier: "1",
        };
      }
    }

    for (const [assetId, quote] of manualQuotesByAsset) {
      const weightedAverageCost = quote.quantity.isZero()
        ? new Decimal(0)
        : quote.totalCostBasis.div(quote.quantity);
      if (!weightedAverageCost.isZero()) {
        upsertManualQuote(
          db,
          assetId,
          request.snapshotDate,
          weightedAverageCost,
          quote.currency,
          now,
        );
      }
    }

    const cashBalances = Object.fromEntries(
      Object.entries(request.cashBalances)
        .map(([currency, amount]) => [
          currency,
          decimalOrThrow(amount, `Invalid cash amount for ${currency}`).toString(),
        ])
        .filter(([, amount]) => !new Decimal(amount).isZero()),
    );
    const costBasis = Object.values(positions)
      .reduce(
        (sum, position) => sum.add(decimalOrFallback(position.totalCostBasis, new Decimal(0))),
        new Decimal(0),
      )
      .toString();
    upsertHoldingsSnapshot(db, {
      id: stableSnapshotId(request.accountId, request.snapshotDate),
      accountId: request.accountId,
      snapshotDate: request.snapshotDate,
      currency: request.accountCurrency,
      positions,
      cashBalances,
      costBasis,
      source: request.source,
      calculatedAt: now,
    });
    ensureSyntheticHoldingsSnapshot(db, request.accountId, now);
  })();
}

function getOrCreateManualSnapshotAsset(db: Database, holding: HoldingInput): AssetRow {
  const explicitAssetId = holding.assetId?.trim();
  const existingAsset = explicitAssetId
    ? readAssetsById(db, [explicitAssetId]).get(explicitAssetId)
    : readExactAssetSymbol(db, holding.symbol.trim().toUpperCase());
  if (existingAsset) {
    if (existingAsset.is_active === 0) {
      db.prepare("UPDATE assets SET is_active = 1 WHERE id = ?").run(existingAsset.id);
      existingAsset.is_active = 1;
    }
    return existingAsset;
  }

  const assetId = explicitAssetId && explicitAssetId.length > 0 ? explicitAssetId : randomUUID();
  const assetKind = holding.assetKind === "OTHER" ? "OTHER" : "INVESTMENT";
  const quoteMode = holding.dataSource === "MANUAL" ? "MANUAL" : "MARKET";
  const symbol = holding.symbol.trim();
  db.prepare(
    `
      INSERT INTO assets (
        id, kind, name, display_code, metadata, is_active, quote_mode, quote_ccy,
        instrument_type, instrument_symbol, instrument_exchange_mic, provider_config
      )
      VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    assetId,
    assetKind,
    holding.name ?? null,
    symbol,
    null,
    quoteMode,
    holding.currency,
    symbol ? "EQUITY" : null,
    symbol || null,
    holding.exchangeMic ?? null,
    quoteMode === "MARKET" ? JSON.stringify({ preferred_provider: "YAHOO" }) : null,
  );
  const created = readAssetsById(db, [assetId]).get(assetId);
  if (!created) {
    throw new Error(`Failed to create asset ${assetId}`);
  }
  return created;
}

function upsertManualQuote(
  db: Database,
  assetId: string,
  day: string,
  close: Decimal,
  currency: string,
  now: string,
): void {
  db.prepare(
    `
      INSERT OR REPLACE INTO quotes (
        id, asset_id, day, source, close, currency, created_at, timestamp
      )
      VALUES (?, ?, ?, 'MANUAL', ?, ?, ?, ?)
    `,
  ).run(
    `${assetId}_${day}_MANUAL`,
    assetId,
    day,
    close.toString(),
    currency,
    now,
    `${day}T00:00:00Z`,
  );
}

function upsertHoldingsSnapshot(
  db: Database,
  snapshot: {
    id: string;
    accountId: string;
    snapshotDate: string;
    currency: string;
    positions: Record<string, SnapshotPosition>;
    cashBalances: Record<string, string>;
    costBasis: string;
    source: string;
    calculatedAt: string;
  },
): void {
  db.prepare(
    `
      INSERT OR REPLACE INTO holdings_snapshots (
        id, account_id, snapshot_date, currency, positions, cash_balances, cost_basis,
        net_contribution, calculated_at, source
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, '0', ?, ?)
    `,
  ).run(
    snapshot.id,
    snapshot.accountId,
    snapshot.snapshotDate,
    snapshot.currency,
    JSON.stringify(snapshot.positions),
    JSON.stringify(snapshot.cashBalances),
    snapshot.costBasis,
    snapshot.calculatedAt,
    snapshot.source,
  );
}

function ensureSyntheticHoldingsSnapshot(db: Database, accountId: string, now: string): void {
  const row = db
    .query<SyntheticSnapshotSourceRow, [string]>(
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
          source
        FROM holdings_snapshots
        WHERE account_id = ? AND source != 'CALCULATED'
        ORDER BY snapshot_date ASC
      `,
    )
    .all(accountId);
  if (row.length !== 1) {
    return;
  }

  const earliest = row[0];
  if (!earliest) {
    return;
  }
  const syntheticDate = subtractMonths(earliest.snapshot_date, 3);
  if (syntheticDate === earliest.snapshot_date) {
    return;
  }
  const existingSynthetic = db
    .query<
      { count: number },
      [string, string]
    >("SELECT COUNT(*) AS count FROM holdings_snapshots WHERE account_id = ? AND snapshot_date = ?")
    .get(accountId, syntheticDate);
  if (existingSynthetic && existingSynthetic.count > 0) {
    return;
  }
  db.prepare(
    `
      INSERT INTO holdings_snapshots (
        id, account_id, snapshot_date, currency, positions, cash_balances, cost_basis,
        net_contribution, calculated_at, source
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'SYNTHETIC')
    `,
  ).run(
    stableSnapshotId(accountId, syntheticDate),
    accountId,
    syntheticDate,
    earliest.currency,
    earliest.positions,
    earliest.cash_balances,
    earliest.cost_basis,
    earliest.net_contribution,
    now,
  );
}

function readLiveHoldings(
  db: Database,
  accountId: string,
  options: HoldingsServiceOptions,
): Holding[] {
  const snapshot = readLatestSnapshot(db, accountId);
  if (!snapshot) {
    return [];
  }
  return readLiveHoldingsFromSnapshot(db, snapshot, options);
}

function readLiveHolding(
  db: Database,
  accountId: string,
  assetId: string,
  options: HoldingsServiceOptions,
): Holding | null {
  const snapshot = readLatestSnapshot(db, accountId);
  if (!snapshot) {
    return null;
  }

  const position = snapshotPositionsFromJson(snapshot.positions).find(
    (candidate) => candidate.assetId === assetId,
  );
  if (!position || decimalToNumber(position.quantity, new Decimal(0)) === 0) {
    return null;
  }

  const holdings = readLiveHoldingsFromSnapshot(db, snapshot, options);
  const holding = holdings.find((candidate) => candidate.instrument?.id === assetId);
  if (holding) {
    return holding;
  }

  const today = resolveToday(options);
  const asset = readAssetsById(db, [assetId]).get(assetId);
  if (asset && isExpiredOptionAsset(asset, today)) {
    return null;
  }
  throw new Error(`Failed to build holding view for ${assetId}`);
}

function readAssetHoldings(
  db: Database,
  assetId: string,
  options: HoldingsServiceOptions,
): Holding[] {
  const holdings: Holding[] = [];
  for (const accountId of readActiveAccountIds(db)) {
    try {
      const holding = readLiveHolding(db, accountId, assetId, options);
      if (holding) {
        holdings.push(holding);
      }
    } catch {
      // Rust ignores per-account failures for this aggregate route.
    }
  }
  return holdings;
}

function readPortfolioAllocations(
  db: Database,
  accountId: string,
  options: HoldingsServiceOptions,
): PortfolioAllocations {
  const holdings = readLiveHoldings(db, accountId, options);
  if (holdings.length === 0) {
    return defaultPortfolioAllocations();
  }

  const totalValue = sumHoldingValues(holdings.filter((holding) => holding.holdingType !== "cash"));
  const totalWithCash = sumHoldingValues(holdings);
  const taxonomies = readTaxonomiesWithCategories(db);
  const assetIds = holdings.flatMap((holding) =>
    holding.instrument ? [holding.instrument.id] : [],
  );
  const assignmentsByAsset = readAssignmentsByAsset(db, assetIds);

  let assetClasses = emptyTaxonomyAllocation(DEFAULT_TAXONOMY_ALLOCATIONS.assetClasses);
  let sectors = emptyTaxonomyAllocation(DEFAULT_TAXONOMY_ALLOCATIONS.sectors);
  let regions = emptyTaxonomyAllocation(DEFAULT_TAXONOMY_ALLOCATIONS.regions);
  let riskCategory = emptyTaxonomyAllocation(DEFAULT_TAXONOMY_ALLOCATIONS.riskCategory);
  let securityTypes = emptyTaxonomyAllocation(DEFAULT_TAXONOMY_ALLOCATIONS.securityTypes);
  const customGroups: TaxonomyAllocation[] = [];

  for (const taxonomyWithCategories of taxonomies) {
    const { taxonomy, categories } = taxonomyWithCategories;
    switch (taxonomy.id) {
      case "asset_classes":
        assetClasses = aggregateByTaxonomy(
          holdings,
          taxonomy,
          categories,
          assignmentsByAsset,
          totalWithCash,
          true,
        );
        break;
      case "industries_gics":
        sectors = aggregateByTaxonomy(
          holdings,
          { ...taxonomy, name: DEFAULT_TAXONOMY_ALLOCATIONS.sectors.taxonomyName },
          categories,
          assignmentsByAsset,
          totalValue,
          true,
        );
        break;
      case "regions":
        regions = aggregateByTaxonomy(
          holdings,
          { ...taxonomy, name: DEFAULT_TAXONOMY_ALLOCATIONS.regions.taxonomyName },
          categories,
          assignmentsByAsset,
          totalValue,
          true,
        );
        break;
      case "risk_category":
        riskCategory = aggregateByTaxonomy(
          holdings,
          { ...taxonomy, name: DEFAULT_TAXONOMY_ALLOCATIONS.riskCategory.taxonomyName },
          categories,
          assignmentsByAsset,
          totalValue,
          false,
        );
        break;
      case "instrument_type":
        securityTypes = aggregateByTaxonomy(
          holdings,
          { ...taxonomy, name: DEFAULT_TAXONOMY_ALLOCATIONS.securityTypes.taxonomyName },
          categories,
          assignmentsByAsset,
          totalValue,
          true,
        );
        break;
      default:
        if (!taxonomy.isSystem) {
          const customAllocation = aggregateByTaxonomy(
            holdings,
            taxonomy,
            categories,
            assignmentsByAsset,
            totalValue,
            false,
          );
          if (customAllocation.categories.length > 0) {
            customGroups.push(customAllocation);
          }
        }
    }
  }

  return {
    assetClasses,
    sectors,
    regions,
    riskCategory,
    securityTypes,
    customGroups,
    totalValue: decimalToNumber(totalWithCash, new Decimal(0)),
  };
}

function readHoldingsByAllocation(
  db: Database,
  accountId: string,
  taxonomyId: string,
  categoryId: string,
  options: HoldingsServiceOptions,
): AllocationHoldings {
  const taxonomyWithCategories = readTaxonomyWithCategories(db, taxonomyId);
  const taxonomy = taxonomyWithCategories?.taxonomy ?? {
    id: taxonomyId,
    name: UNKNOWN_CATEGORY_NAME,
    color: "#808080",
    isSystem: true,
  };
  const categories = taxonomyWithCategories?.categories ?? [];
  const category = categories.find((candidate) => candidate.id === categoryId);
  const categoryName =
    categoryId === UNKNOWN_CATEGORY_ID ? UNKNOWN_CATEGORY_NAME : (category?.name ?? categoryId);
  const categoryColor =
    categoryId === UNKNOWN_CATEGORY_ID
      ? UNKNOWN_CATEGORY_COLOR
      : (category?.color ?? taxonomy.color);
  const holdings = readLiveHoldings(db, accountId, options);
  const currency = holdings[0]?.baseCurrency ?? resolveBaseCurrency(options) ?? "";

  if (holdings.length === 0) {
    return {
      taxonomyId,
      taxonomyName: taxonomy.name,
      categoryId,
      categoryName,
      color: categoryColor,
      holdings: [],
      totalValue: 0,
      currency,
    };
  }

  const topLevelMap = buildTopLevelMap(categories);
  const matchingCategoryIds =
    categoryId === UNKNOWN_CATEGORY_ID
      ? [UNKNOWN_CATEGORY_ID]
      : categories
          .filter(
            (candidate) =>
              candidate.id === categoryId || topLevelMap.get(candidate.id) === categoryId,
          )
          .map((candidate) => candidate.id);
  const categoryAssignments = readAssignmentsByTaxonomyAndCategories(
    db,
    taxonomyId,
    matchingCategoryIds.filter((id) => id !== UNKNOWN_CATEGORY_ID),
  );
  const assetToWeight = new Map<string, Decimal>();
  for (const assignment of categoryAssignments) {
    assetToWeight.set(
      assignment.assetId,
      (assetToWeight.get(assignment.assetId) ?? new Decimal(0)).add(assignment.weight),
    );
  }

  const assetIds = holdings.flatMap((holding) =>
    holding.instrument ? [holding.instrument.id] : [],
  );
  const assignmentsByAsset = readAssignmentsByAsset(db, assetIds);
  const matchedHoldings: { holding: Holding; weight: Decimal }[] = [];

  for (const holding of holdings) {
    const assetId = holding.instrument?.id;
    if (!assetId) {
      continue;
    }

    if (
      holding.holdingType === "cash" &&
      taxonomyId === "asset_classes" &&
      matchingCategoryIds.some(
        (id) => id === CASH_CATEGORY_ID || id === CASH_BANK_DEPOSITS_CATEGORY_ID,
      )
    ) {
      matchedHoldings.push({ holding, weight: new Decimal(10_000) });
      continue;
    }

    if (categoryId === UNKNOWN_CATEGORY_ID) {
      const hasTaxonomyAssignment = (assignmentsByAsset.get(assetId) ?? []).some(
        (assignment) => assignment.taxonomyId === taxonomyId,
      );
      if (!hasTaxonomyAssignment) {
        matchedHoldings.push({ holding, weight: new Decimal(10_000) });
      }
      continue;
    }

    const weight = assetToWeight.get(assetId);
    if (weight) {
      matchedHoldings.push({ holding, weight });
    }
  }

  const totalMatchedValue = matchedHoldings.reduce(
    (sum, matched) => sum.add(weightedHoldingValue(matched.holding, matched.weight)),
    new Decimal(0),
  );
  const summaries = matchedHoldings
    .map(({ holding, weight }) => {
      const weightedValue = weightedHoldingValue(holding, weight);
      const weightInCategory = totalMatchedValue.gt(0)
        ? weightedValue.div(totalMatchedValue).mul(100).toDecimalPlaces(2)
        : new Decimal(0);
      return {
        id: holding.instrument?.id ?? holding.id,
        symbol: holding.instrument?.symbol ?? "",
        name: holding.instrument?.name ?? null,
        holdingType: holding.holdingType,
        quantity: holding.quantity,
        marketValue: decimalToNumber(weightedValue, new Decimal(0)),
        currency: holding.baseCurrency,
        weightInCategory: decimalToNumber(weightInCategory, new Decimal(0)),
      };
    })
    .sort((left, right) => right.marketValue - left.marketValue);

  return {
    taxonomyId,
    taxonomyName: taxonomy.name,
    categoryId,
    categoryName,
    color: categoryColor,
    holdings: summaries,
    totalValue: decimalToNumber(totalMatchedValue, new Decimal(0)),
    currency,
  };
}

function aggregateByTaxonomy(
  holdings: Holding[],
  taxonomy: Taxonomy,
  categories: TaxonomyCategory[],
  assignmentsByAsset: Map<string, AssetTaxonomyAssignment[]>,
  totalValue: Decimal,
  rollupToTopLevel: boolean,
): TaxonomyAllocation {
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const topLevelMap = rollupToTopLevel
    ? buildTopLevelMap(categories)
    : new Map(categories.map((category) => [category.id, category.id]));
  const originalValues = new Map<string, { value: Decimal; topLevelId: string }>();
  const rolledUpValues = new Map<string, Decimal>();

  for (const holding of holdings) {
    if (holding.holdingType === "cash" && taxonomy.id !== "asset_classes") {
      continue;
    }

    const assetId = holding.instrument?.id;
    if (!assetId) {
      continue;
    }

    const marketValue = decimalOrFallback(holding.marketValue.base, new Decimal(0));
    if (holding.holdingType === "cash" && taxonomy.id === "asset_classes") {
      const topLevelId = rollupToTopLevel
        ? (topLevelMap.get(CASH_BANK_DEPOSITS_CATEGORY_ID) ?? CASH_BANK_DEPOSITS_CATEGORY_ID)
        : CASH_BANK_DEPOSITS_CATEGORY_ID;
      addOriginalAllocationValue(
        originalValues,
        CASH_BANK_DEPOSITS_CATEGORY_ID,
        marketValue,
        topLevelId,
      );
      addRolledAllocationValue(rolledUpValues, topLevelId, marketValue);
      continue;
    }

    const taxonomyAssignments = (assignmentsByAsset.get(assetId) ?? []).filter(
      (assignment) => assignment.taxonomyId === taxonomy.id,
    );
    if (taxonomyAssignments.length === 0) {
      addRolledAllocationValue(rolledUpValues, UNKNOWN_CATEGORY_ID, marketValue);
      continue;
    }

    for (const assignment of taxonomyAssignments) {
      const weightedValue = marketValue.mul(new Decimal(assignment.weight).div(10_000));
      const topLevelId = rollupToTopLevel
        ? (topLevelMap.get(assignment.categoryId) ?? assignment.categoryId)
        : assignment.categoryId;
      addOriginalAllocationValue(originalValues, assignment.categoryId, weightedValue, topLevelId);
      addRolledAllocationValue(rolledUpValues, topLevelId, weightedValue);
    }
  }

  const childrenByTopLevel = new Map<string, CategoryAllocation[]>();
  if (rollupToTopLevel) {
    for (const [categoryId, allocationValue] of originalValues) {
      if (categoryId === allocationValue.topLevelId || !allocationValue.value.gt(0)) {
        continue;
      }
      const category = categoryById.get(categoryId);
      const children = childrenByTopLevel.get(allocationValue.topLevelId) ?? [];
      children.push(
        categoryAllocationFromValue(
          categoryId,
          category?.name ?? categoryId,
          category?.color ?? "#808080",
          allocationValue.value,
          totalValue,
        ),
      );
      childrenByTopLevel.set(allocationValue.topLevelId, children);
    }
    for (const children of childrenByTopLevel.values()) {
      children.sort((left, right) => right.value - left.value);
    }
  }

  const categoriesOut = [...rolledUpValues.entries()]
    .filter(([, value]) => value.gt(0))
    .map(([categoryId, value]) => {
      const category = categoryById.get(categoryId);
      const children = childrenByTopLevel.get(categoryId) ?? [];
      return categoryAllocationFromValue(
        categoryId,
        categoryId === UNKNOWN_CATEGORY_ID ? UNKNOWN_CATEGORY_NAME : (category?.name ?? categoryId),
        categoryId === UNKNOWN_CATEGORY_ID
          ? UNKNOWN_CATEGORY_COLOR
          : (category?.color ?? "#808080"),
        value,
        totalValue,
        children,
      );
    })
    .sort((left, right) => right.value - left.value);

  return {
    taxonomyId: taxonomy.id,
    taxonomyName: taxonomy.name,
    color: taxonomy.color,
    categories: categoriesOut,
  };
}

function addOriginalAllocationValue(
  values: Map<string, { value: Decimal; topLevelId: string }>,
  categoryId: string,
  value: Decimal,
  topLevelId: string,
): void {
  const existing = values.get(categoryId);
  values.set(categoryId, {
    value: (existing?.value ?? new Decimal(0)).add(value),
    topLevelId,
  });
}

function addRolledAllocationValue(
  values: Map<string, Decimal>,
  categoryId: string,
  value: Decimal,
): void {
  values.set(categoryId, (values.get(categoryId) ?? new Decimal(0)).add(value));
}

function categoryAllocationFromValue(
  categoryId: string,
  categoryName: string,
  color: string,
  value: Decimal,
  totalValue: Decimal,
  children: CategoryAllocation[] = [],
): CategoryAllocation {
  const percentage = totalValue.gt(0)
    ? value.div(totalValue).mul(100).toDecimalPlaces(2)
    : new Decimal(0);
  return {
    categoryId,
    categoryName,
    color,
    value: decimalToNumber(value, new Decimal(0)),
    percentage: decimalToNumber(percentage, new Decimal(0)),
    ...(children.length > 0 ? { children } : {}),
  };
}

function sumHoldingValues(holdings: Holding[]): Decimal {
  return holdings.reduce(
    (sum, holding) => sum.add(decimalOrFallback(holding.marketValue.base, new Decimal(0))),
    new Decimal(0),
  );
}

function weightedHoldingValue(holding: Holding, weight: Decimal): Decimal {
  return decimalOrFallback(holding.marketValue.base, new Decimal(0)).mul(weight.div(10_000));
}

function defaultPortfolioAllocations(): PortfolioAllocations {
  return {
    assetClasses: emptyTaxonomyAllocation(DEFAULT_TAXONOMY_ALLOCATIONS.assetClasses),
    sectors: emptyTaxonomyAllocation(DEFAULT_TAXONOMY_ALLOCATIONS.sectors),
    regions: emptyTaxonomyAllocation(DEFAULT_TAXONOMY_ALLOCATIONS.regions),
    riskCategory: emptyTaxonomyAllocation(DEFAULT_TAXONOMY_ALLOCATIONS.riskCategory),
    securityTypes: emptyTaxonomyAllocation(DEFAULT_TAXONOMY_ALLOCATIONS.securityTypes),
    customGroups: [],
    totalValue: 0,
  };
}

function emptyTaxonomyAllocation(input: {
  taxonomyId: string;
  taxonomyName: string;
  color: string;
}): TaxonomyAllocation {
  return { ...input, categories: [] };
}

function buildTopLevelMap(categories: TaxonomyCategory[]): Map<string, string> {
  const parentById = new Map(categories.map((category) => [category.id, category.parentId]));
  return new Map(
    categories.map((category) => [category.id, findTopLevelAncestor(category.id, parentById)]),
  );
}

function findTopLevelAncestor(categoryId: string, parentById: Map<string, string | null>): string {
  const parentId = parentById.get(categoryId);
  return parentId ? findTopLevelAncestor(parentId, parentById) : categoryId;
}

function readLiveHoldingsFromSnapshot(
  db: Database,
  snapshot: SnapshotRow,
  options: HoldingsServiceOptions,
): Holding[] {
  const resolvedBaseCurrency = resolveBaseCurrency(options) ?? snapshot.currency;
  const today = resolveToday(options);
  const holdings = buildHoldingsFromSnapshot(db, snapshot, resolvedBaseCurrency, today, true);
  valueHoldings(holdings, readLatestQuotePairs(db, holdings), options, today);
  applyPortfolioWeights(holdings);
  for (const holding of holdings) {
    normalizeHoldingCurrency(holding);
  }
  return holdings;
}

function readSnapshotByDate(db: Database, accountId: string, date: string): SnapshotRow | null {
  return db
    .query<SnapshotRow, [string, string]>(
      `
        SELECT id, account_id, snapshot_date, currency, positions, cash_balances
        FROM holdings_snapshots
        WHERE account_id = ? AND snapshot_date = ?
      `,
    )
    .get(accountId, date);
}

function readLatestSnapshot(db: Database, accountId: string): SnapshotRow | null {
  return db
    .query<SnapshotRow, [string]>(
      `
        SELECT id, account_id, snapshot_date, currency, positions, cash_balances
        FROM holdings_snapshots
        WHERE account_id = ?
        ORDER BY snapshot_date DESC, calculated_at DESC
        LIMIT 1
      `,
    )
    .get(accountId);
}

function buildHoldingsFromSnapshot(
  db: Database,
  snapshot: SnapshotRow,
  baseCurrency: string,
  asOfDate: string,
  skipExpiredOptions: boolean,
): Holding[] {
  const positions = snapshotPositionsFromJson(snapshot.positions);
  const assetIds = positions.map((position) => position.assetId);
  const assetsById = readAssetsById(db, assetIds);
  const holdings: Holding[] = [];

  for (const position of positions) {
    const quantity = decimalToNumber(position.quantity, new Decimal(0));
    if (quantity === 0) {
      continue;
    }
    const asset = assetsById.get(position.assetId);
    if (!asset) {
      continue;
    }
    if (skipExpiredOptions && isExpiredOptionAsset(asset, asOfDate)) {
      continue;
    }
    holdings.push(holdingFromPosition(snapshot, position, asset, quantity, baseCurrency, asOfDate));
  }

  for (const [currency, amountValue] of Object.entries(
    parseJsonObjectOrEmpty(snapshot.cash_balances),
  )) {
    const amount = decimalToNumber(amountValue, new Decimal(0));
    if (amount === 0) {
      continue;
    }
    holdings.push(cashHoldingFromSnapshot(snapshot, currency, amount, baseCurrency, asOfDate));
  }

  return holdings;
}

function valueHoldings(
  holdings: Holding[],
  quotePairs: Map<string, LatestQuotePair>,
  options: HoldingsServiceOptions,
  today: string,
): void {
  for (const holding of holdings) {
    if (holding.holdingType === "cash") {
      holding.asOfDate = today;
      calculateCashValuation(holding, options);
      continue;
    }

    const assetId = holding.instrument?.id;
    const quotePair = assetId ? quotePairs.get(assetId) : undefined;
    holding.asOfDate = quotePair ? dateStringFromTimestamp(quotePair.latest.timestamp) : today;
    if (holding.holdingType === "alternativeAsset") {
      calculateAlternativeAssetValuation(holding, quotePair, options);
    } else {
      calculateSecurityValuation(holding, quotePair, options);
    }
  }
}

function calculateSecurityValuation(
  holding: Holding,
  quotePair: LatestQuotePair | undefined,
  options: HoldingsServiceOptions,
): void {
  const quantity = decimalOrFallback(holding.quantity, new Decimal(0));
  const contractMultiplier = decimalOrFallback(holding.contractMultiplier, new Decimal(1));
  const positionCurrency = holding.localCurrency;
  const fxRateLocalToBase = getFxRateOrFallback(options, positionCurrency, holding.baseCurrency);
  holding.fxRate = decimalToNumber(fxRateLocalToBase, new Decimal(1));

  const costBasis = holding.costBasis;
  if (costBasis) {
    costBasis.base = decimalToNumber(
      decimalOrFallback(costBasis.local, new Decimal(0)).mul(fxRateLocalToBase),
      new Decimal(0),
    );
  }

  if (!quotePair) {
    holding.marketValue = zeroMonetaryValue();
    holding.price = null;
    holding.unrealizedGain = null;
    holding.unrealizedGainPct = null;
    holding.dayChange = null;
    holding.dayChangePct = null;
    holding.prevCloseValue = null;
    holding.realizedGain = null;
    holding.realizedGainPct = null;
    holding.totalGain = null;
    holding.totalGainPct = null;
    return;
  }

  const [normalizedPrice, normalizedQuoteCurrency] = normalizeAmount(
    quotePair.latest.close,
    quotePair.latest.currency,
  );
  const fxRateQuoteToBase = getFxRateOrFallback(
    options,
    normalizedQuoteCurrency,
    holding.baseCurrency,
  );
  const fxRateQuoteToLocal = getFxRateOrFallback(
    options,
    normalizedQuoteCurrency,
    positionCurrency,
  );
  const marketValueQuoteMajor = normalizedPrice.mul(quantity).mul(contractMultiplier);
  const marketValueLocal = marketValueQuoteMajor.mul(fxRateQuoteToLocal);
  const marketValueBase = marketValueQuoteMajor.mul(fxRateQuoteToBase);

  holding.price = decimalToNumber(normalizedPrice.mul(fxRateQuoteToLocal), new Decimal(0));
  holding.marketValue = monetaryValue(marketValueLocal, marketValueBase);

  if (costBasis) {
    const costBasisLocal = decimalOrFallback(costBasis.local, new Decimal(0));
    const costBasisBase = decimalOrFallback(costBasis.base, new Decimal(0));
    const unrealizedGainLocal = marketValueLocal.sub(costBasisLocal);
    const unrealizedGainBase = marketValueBase.sub(costBasisBase);
    holding.unrealizedGain = monetaryValue(unrealizedGainLocal, unrealizedGainBase);
    holding.unrealizedGainPct = gainPct(unrealizedGainBase, costBasisBase);
  } else {
    holding.unrealizedGain = null;
    holding.unrealizedGainPct = null;
  }

  if (quotePair.previous) {
    const [previousPrice, previousQuoteCurrency] = normalizeAmount(
      quotePair.previous.close,
      quotePair.previous.currency,
    );
    if (previousQuoteCurrency === normalizedQuoteCurrency) {
      const previousValueQuoteMajor = previousPrice.mul(quantity).mul(contractMultiplier);
      const previousValueLocal = previousValueQuoteMajor.mul(fxRateQuoteToLocal);
      const previousValueBase = previousValueQuoteMajor.mul(fxRateQuoteToBase);
      const dayChangeQuoteMajor = marketValueQuoteMajor.sub(previousValueQuoteMajor);
      const dayChangeBase = dayChangeQuoteMajor.mul(fxRateQuoteToBase);

      holding.prevCloseValue = monetaryValue(previousValueLocal, previousValueBase);
      holding.dayChange = monetaryValue(dayChangeQuoteMajor.mul(fxRateQuoteToLocal), dayChangeBase);
      holding.dayChangePct = previousValueBase.isZero()
        ? dayChangeBase.isZero()
          ? 0
          : null
        : decimalToNumber(dayChangeBase.div(previousValueBase).toDecimalPlaces(4), new Decimal(0));
    } else {
      holding.prevCloseValue = null;
      holding.dayChange = null;
      holding.dayChangePct = null;
    }
  } else {
    holding.prevCloseValue = null;
    holding.dayChange = null;
    holding.dayChangePct = null;
  }

  holding.realizedGain = null;
  holding.realizedGainPct = null;
  holding.totalGain = cloneMonetaryValue(holding.unrealizedGain);
  holding.totalGainPct = holding.unrealizedGainPct;
}

function calculateAlternativeAssetValuation(
  holding: Holding,
  quotePair: LatestQuotePair | undefined,
  options: HoldingsServiceOptions,
): void {
  const quantity = decimalOrFallback(holding.quantity, new Decimal(0));
  const positionCurrency = holding.localCurrency;
  const fxRateLocalToBase = getFxRateOrFallback(options, positionCurrency, holding.baseCurrency);
  holding.fxRate = decimalToNumber(fxRateLocalToBase, new Decimal(1));

  const costBasis = holding.costBasis;
  if (costBasis) {
    costBasis.base = decimalToNumber(
      decimalOrFallback(costBasis.local, new Decimal(0)).mul(fxRateLocalToBase),
      new Decimal(0),
    );
  }

  if (!quotePair) {
    holding.marketValue = zeroMonetaryValue();
    holding.price = null;
    holding.unrealizedGain = null;
    holding.unrealizedGainPct = null;
    holding.dayChange = null;
    holding.dayChangePct = null;
    holding.prevCloseValue = null;
    holding.realizedGain = null;
    holding.realizedGainPct = null;
    holding.totalGain = null;
    holding.totalGainPct = null;
    return;
  }

  const [normalizedPrice, normalizedQuoteCurrency] = normalizeAmount(
    quotePair.latest.close,
    quotePair.latest.currency,
  );
  const fxRateQuoteToBase = getFxRateOrFallback(
    options,
    normalizedQuoteCurrency,
    holding.baseCurrency,
  );
  const fxRateQuoteToLocal = getFxRateOrFallback(
    options,
    normalizedQuoteCurrency,
    positionCurrency,
  );
  const marketValueQuoteMajor = normalizedPrice.mul(quantity);
  const marketValueLocal = marketValueQuoteMajor.mul(fxRateQuoteToLocal);
  const marketValueBase = marketValueQuoteMajor.mul(fxRateQuoteToBase);

  holding.price = decimalToNumber(normalizedPrice.mul(fxRateQuoteToLocal), new Decimal(0));
  holding.marketValue = monetaryValue(marketValueLocal, marketValueBase);

  const purchasePrice =
    holding.purchasePrice === null
      ? null
      : decimalOrFallback(holding.purchasePrice, new Decimal(0));
  if (purchasePrice) {
    const totalCostLocal = quantity.mul(purchasePrice);
    const totalCostBase = totalCostLocal.mul(fxRateLocalToBase);
    const unrealizedGainLocal = marketValueLocal.sub(totalCostLocal);
    const unrealizedGainBase = marketValueBase.sub(totalCostBase);
    holding.unrealizedGain = monetaryValue(unrealizedGainLocal, unrealizedGainBase);
    holding.unrealizedGainPct = gainPct(unrealizedGainBase, totalCostBase);
  } else if (costBasis) {
    const costBasisLocal = decimalOrFallback(costBasis.local, new Decimal(0));
    const costBasisBase = decimalOrFallback(costBasis.base, new Decimal(0));
    const unrealizedGainLocal = marketValueLocal.sub(costBasisLocal);
    const unrealizedGainBase = marketValueBase.sub(costBasisBase);
    holding.unrealizedGain = monetaryValue(unrealizedGainLocal, unrealizedGainBase);
    holding.unrealizedGainPct = gainPct(unrealizedGainBase, costBasisBase);
  } else {
    holding.unrealizedGain = null;
    holding.unrealizedGainPct = null;
  }

  holding.dayChange = null;
  holding.dayChangePct = null;
  holding.prevCloseValue = null;
  holding.realizedGain = null;
  holding.realizedGainPct = null;
  holding.totalGain = cloneMonetaryValue(holding.unrealizedGain);
  holding.totalGainPct = holding.unrealizedGainPct;
}

function calculateCashValuation(holding: Holding, options: HoldingsServiceOptions): void {
  const amount = decimalOrFallback(holding.quantity, new Decimal(0));
  const fxRateCashToBase = getFxRateOrFallback(
    options,
    holding.localCurrency,
    holding.baseCurrency,
  );
  const valueBase = amount.mul(fxRateCashToBase);

  holding.price = 1;
  holding.fxRate = decimalToNumber(fxRateCashToBase, new Decimal(1));
  holding.marketValue = monetaryValue(amount, valueBase);
  holding.costBasis = monetaryValue(amount, valueBase);
  holding.prevCloseValue = monetaryValue(amount, valueBase);
  holding.unrealizedGain = zeroMonetaryValue();
  holding.unrealizedGainPct = 0;
  holding.realizedGain = zeroMonetaryValue();
  holding.realizedGainPct = 0;
  holding.totalGain = zeroMonetaryValue();
  holding.totalGainPct = 0;
  holding.dayChange = zeroMonetaryValue();
  holding.dayChangePct = 0;
}

function readLatestQuotePairs(db: Database, holdings: Holding[]): Map<string, LatestQuotePair> {
  const assetIds = [
    ...new Set(
      holdings
        .filter(
          (holding) =>
            holding.holdingType === "security" || holding.holdingType === "alternativeAsset",
        )
        .flatMap((holding) => (holding.instrument ? [holding.instrument.id] : [])),
    ),
  ];
  if (assetIds.length === 0) {
    return new Map();
  }

  const placeholders = assetIds.map(() => "?").join(", ");
  const rows = db
    .query<QuoteRow & { rn: number }, string[]>(
      `
        WITH ranked_quotes AS (
          SELECT
            asset_id,
            day,
            source,
            close,
            currency,
            timestamp,
            ROW_NUMBER() OVER (
              PARTITION BY asset_id
              ORDER BY
                day DESC,
                CASE source
                  WHEN 'MANUAL' THEN 1
                  WHEN 'BROKER' THEN 2
                  ELSE 3
                END ASC
            ) AS rn
          FROM quotes
          WHERE asset_id IN (${placeholders})
        )
        SELECT asset_id, day, source, close, currency, timestamp, rn
        FROM ranked_quotes
        WHERE rn <= 2
        ORDER BY asset_id ASC, rn ASC
      `,
    )
    .all(...assetIds);

  const quotesByAssetId = new Map<string, QuoteRow[]>();
  for (const row of rows) {
    const quoteRows = quotesByAssetId.get(row.asset_id) ?? [];
    quoteRows.push(row);
    quotesByAssetId.set(row.asset_id, quoteRows);
  }

  const quotePairs = new Map<string, LatestQuotePair>();
  for (const [assetId, quoteRows] of quotesByAssetId) {
    const latest = quoteRows[0];
    if (latest) {
      quotePairs.set(assetId, {
        latest,
        previous: quoteRows[1] ?? null,
      });
    }
  }
  return quotePairs;
}

function getFxRateOrFallback(
  options: HoldingsServiceOptions,
  fromCurrency: string,
  toCurrency: string,
): Decimal {
  try {
    return decimalOrFallback(
      options.exchangeRateService?.getLatestExchangeRate(fromCurrency, toCurrency) ?? 1,
      new Decimal(1),
    );
  } catch {
    return new Decimal(1);
  }
}

function gainPct(gainBase: Decimal, costBase: Decimal): number {
  if (!costBase.isZero()) {
    return decimalToNumber(gainBase.div(costBase).toDecimalPlaces(4), new Decimal(0));
  }
  return gainBase.isZero() ? 0 : 1;
}

function applyPortfolioWeights(holdings: Holding[]): void {
  const totalBaseValue = holdings.reduce(
    (total, holding) => total.add(decimalOrFallback(holding.marketValue.base, new Decimal(0))),
    new Decimal(0),
  );
  if (totalBaseValue.lte(0)) {
    for (const holding of holdings) {
      holding.weight = 0;
    }
    return;
  }
  for (const holding of holdings) {
    holding.weight = decimalToNumber(
      decimalOrFallback(holding.marketValue.base, new Decimal(0))
        .div(totalBaseValue)
        .toDecimalPlaces(DECIMAL_PRECISION),
      new Decimal(0),
    );
  }
}

function checkHoldingsImport(
  db: Database,
  request: HoldingsImportRequest,
): CheckHoldingsImportResult {
  assertAccountExists(db, request.accountId);

  const validationErrors: string[] = [];
  const validDates: string[] = [];
  const uniqueSymbols = new Set<string>();

  for (const snapshot of request.snapshots) {
    if (!isValidDateString(snapshot.date)) {
      validationErrors.push(`Invalid date format: '${snapshot.date}'`);
      continue;
    }
    validDates.push(snapshot.date);

    for (const position of snapshot.positions) {
      if (position.symbol.trim() === "") {
        validationErrors.push(`Date ${snapshot.date}: empty symbol found`);
      }
      if (!isValidFiniteDecimalString(position.quantity)) {
        validationErrors.push(
          `Date ${snapshot.date}: invalid quantity '${position.quantity}' for ${position.symbol}`,
        );
      }
      if (position.avgCost !== undefined && position.avgCost !== "") {
        if (!isValidFiniteDecimalString(position.avgCost)) {
          validationErrors.push(
            `Date ${snapshot.date}: invalid avg cost '${position.avgCost}' for ${position.symbol}`,
          );
        }
      }
      uniqueSymbols.add(position.symbol.trim().toUpperCase());
    }
  }

  return {
    existingDates: readExistingSnapshotDates(db, request.accountId, validDates),
    symbols: [...uniqueSymbols].map((symbol) => symbolCheckResult(db, symbol)),
    validationErrors,
  };
}

function readHistoricalValuations(
  db: Database,
  accountId: string,
  startDate: string | undefined,
  endDate: string | undefined,
): DailyAccountValuation[] {
  const conditions = ["account_id = ?"];
  const params = [accountId];
  if (startDate) {
    conditions.push("valuation_date >= ?");
    params.push(startDate);
  }
  if (endDate) {
    conditions.push("valuation_date <= ?");
    params.push(endDate);
  }

  return db
    .query<DailyAccountValuationRow, string[]>(
      `
        SELECT *
        FROM daily_account_valuation
        WHERE ${conditions.join(" AND ")}
        ORDER BY valuation_date ASC
      `,
    )
    .all(...params)
    .map(valuationFromRow);
}

function readLatestValuations(db: Database, accountIds: string[]): DailyAccountValuation[] {
  const placeholders = accountIds.map(() => "?").join(", ");
  const rows = db
    .query<DailyAccountValuationRow, string[]>(
      `
        WITH ranked_valuations AS (
          SELECT
            *,
            ROW_NUMBER() OVER (
              PARTITION BY account_id
              ORDER BY valuation_date DESC
            ) AS rn
          FROM daily_account_valuation
          WHERE account_id IN (${placeholders})
        )
        SELECT
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
        FROM ranked_valuations
        WHERE rn = 1
      `,
    )
    .all(...accountIds);
  const byAccount = new Map(rows.map((row) => [row.account_id, valuationFromRow(row)]));
  return accountIds.flatMap((accountId) => {
    const valuation = byAccount.get(accountId);
    return valuation ? [valuation] : [];
  });
}

function readActiveAccountIds(db: Database): string[] {
  return db
    .query<{ id: string }, []>(
      `
        SELECT id
        FROM accounts
        WHERE is_active = 1
        ORDER BY is_active DESC, is_archived ASC, name ASC
      `,
    )
    .all()
    .map((account) => account.id);
}

function valuationFromRow(row: DailyAccountValuationRow): DailyAccountValuation {
  return {
    id: row.id,
    accountId: row.account_id,
    valuationDate: row.valuation_date,
    accountCurrency: row.account_currency,
    baseCurrency: row.base_currency,
    fxRateToBase: decimalToNumber(row.fx_rate_to_base, new Decimal(1)),
    cashBalance: decimalToNumber(row.cash_balance, new Decimal(0)),
    investmentMarketValue: decimalToNumber(row.investment_market_value, new Decimal(0)),
    totalValue: decimalToNumber(row.total_value, new Decimal(0)),
    costBasis: decimalToNumber(row.cost_basis, new Decimal(0)),
    netContribution: decimalToNumber(row.net_contribution, new Decimal(0)),
    calculatedAt: row.calculated_at,
  };
}

function holdingFromPosition(
  snapshot: SnapshotRow,
  position: SnapshotPosition,
  asset: AssetRow,
  quantity: number,
  baseCurrency: string,
  asOfDate: string,
): Holding {
  const isAlternative = ALTERNATIVE_ASSET_KINDS.has(asset.kind);
  return {
    id: `${isAlternative ? "ALT" : "SEC"}-${snapshot.account_id}-${position.assetId}`,
    accountId: snapshot.account_id,
    holdingType: isAlternative ? "alternativeAsset" : "security",
    instrument: {
      id: asset.id,
      symbol: asset.display_code ?? "",
      name: asset.name,
      currency: asset.quote_ccy,
      notes: asset.notes,
      pricingMode: asset.quote_mode,
      preferredProvider: preferredProvider(asset.provider_config),
      exchangeMic: asset.instrument_exchange_mic,
      classifications: null,
    },
    assetKind: asset.kind,
    quantity,
    openDate: position.inceptionDate,
    lots: null,
    contractMultiplier: decimalToNumber(position.contractMultiplier ?? 1, new Decimal(1)),
    localCurrency: position.currency,
    baseCurrency,
    fxRate: null,
    marketValue: zeroMonetaryValue(),
    costBasis: {
      local: decimalToNumber(position.totalCostBasis, new Decimal(0)),
      base: 0,
    },
    price: null,
    purchasePrice: purchasePrice(asset.metadata),
    unrealizedGain: null,
    unrealizedGainPct: null,
    realizedGain: null,
    realizedGainPct: null,
    totalGain: null,
    totalGainPct: null,
    dayChange: null,
    dayChangePct: null,
    prevCloseValue: null,
    weight: 0,
    asOfDate,
    metadata: parseNullableJson(asset.metadata),
  };
}

function cashHoldingFromSnapshot(
  snapshot: SnapshotRow,
  currency: string,
  amount: number,
  baseCurrency: string,
  asOfDate: string,
): Holding {
  return {
    id: `CASH-${snapshot.account_id}-${currency}`,
    accountId: snapshot.account_id,
    holdingType: "cash",
    instrument: {
      id: `cash:${currency}`,
      symbol: currency,
      name: `Cash (${currency})`,
      currency,
      notes: null,
      pricingMode: "MANUAL",
      preferredProvider: null,
      exchangeMic: null,
      classifications: null,
    },
    assetKind: null,
    quantity: amount,
    openDate: null,
    lots: null,
    contractMultiplier: 1,
    localCurrency: currency,
    baseCurrency,
    fxRate: null,
    marketValue: {
      local: amount,
      base: 0,
    },
    costBasis: {
      local: amount,
      base: 0,
    },
    price: 1,
    purchasePrice: null,
    unrealizedGain: zeroMonetaryValue(),
    unrealizedGainPct: 0,
    realizedGain: zeroMonetaryValue(),
    realizedGainPct: 0,
    totalGain: zeroMonetaryValue(),
    totalGainPct: 0,
    dayChange: zeroMonetaryValue(),
    dayChangePct: 0,
    prevCloseValue: null,
    weight: 0,
    asOfDate,
    metadata: null,
  };
}

function zeroMonetaryValue(): MonetaryValue {
  return { local: 0, base: 0 };
}

function monetaryValue(local: Decimal, base: Decimal): MonetaryValue {
  return {
    local: decimalToNumber(local, new Decimal(0)),
    base: decimalToNumber(base, new Decimal(0)),
  };
}

function cloneMonetaryValue(value: MonetaryValue | null): MonetaryValue | null {
  return value ? { ...value } : null;
}

function normalizeHoldingCurrency(holding: Holding): void {
  if (holding.instrument) {
    holding.instrument.currency = normalizeCurrencyCode(holding.instrument.currency);
  }

  const rule = CURRENCY_NORMALIZATION_RULES.get(holding.localCurrency);
  if (!rule) {
    return;
  }

  holding.localCurrency = rule.majorCode;
  if (holding.fxRate !== null) {
    holding.fxRate = decimalToNumber(
      decimalOrFallback(holding.fxRate, new Decimal(1)).div(rule.factor),
      new Decimal(1),
    );
  }

  if (holding.holdingType === "cash") {
    holding.price = 1;
  } else {
    if (holding.price !== null) {
      holding.price = decimalToNumber(
        decimalOrFallback(holding.price, new Decimal(0)).mul(rule.factor),
        new Decimal(0),
      );
    }
    if (holding.purchasePrice !== null) {
      holding.purchasePrice = decimalToNumber(
        decimalOrFallback(holding.purchasePrice, new Decimal(0)).mul(rule.factor),
        new Decimal(0),
      );
    }
  }

  applyLocalCurrencyFactor(holding.marketValue, rule.factor);
  applyLocalCurrencyFactor(holding.costBasis, rule.factor);
  applyLocalCurrencyFactor(holding.unrealizedGain, rule.factor);
  applyLocalCurrencyFactor(holding.realizedGain, rule.factor);
  applyLocalCurrencyFactor(holding.totalGain, rule.factor);
  applyLocalCurrencyFactor(holding.dayChange, rule.factor);
  applyLocalCurrencyFactor(holding.prevCloseValue, rule.factor);
}

function applyLocalCurrencyFactor(value: MonetaryValue | null, factor: Decimal): void {
  if (!value) {
    return;
  }
  value.local = decimalToNumber(
    decimalOrFallback(value.local, new Decimal(0)).mul(factor),
    new Decimal(0),
  );
}

function normalizeAmount(value: unknown, currency: string): [Decimal, string] {
  const amount = decimalOrFallback(value, new Decimal(0));
  const rule = CURRENCY_NORMALIZATION_RULES.get(currency);
  return rule ? [amount.mul(rule.factor), rule.majorCode] : [amount, currency];
}

function normalizeCurrencyCode(currency: string): string {
  return CURRENCY_NORMALIZATION_RULES.get(currency)?.majorCode ?? currency;
}

function readTaxonomiesWithCategories(db: Database): TaxonomyWithCategories[] {
  const taxonomies = db
    .query<TaxonomyRow, []>(
      `
        SELECT id, name, color, is_system, sort_order
        FROM taxonomies
        ORDER BY sort_order ASC
      `,
    )
    .all()
    .map(taxonomyFromRow);
  const categoriesByTaxonomyId = readCategoriesByTaxonomyId(db);
  return taxonomies.map((taxonomy) => ({
    taxonomy,
    categories: categoriesByTaxonomyId.get(taxonomy.id) ?? [],
  }));
}

function readTaxonomyWithCategories(
  db: Database,
  taxonomyId: string,
): TaxonomyWithCategories | null {
  const row = db
    .query<TaxonomyRow, [string]>(
      `
        SELECT id, name, color, is_system, sort_order
        FROM taxonomies
        WHERE id = ?
      `,
    )
    .get(taxonomyId);
  if (!row) {
    return null;
  }
  return {
    taxonomy: taxonomyFromRow(row),
    categories: readCategoriesForTaxonomy(db, taxonomyId),
  };
}

function readCategoriesByTaxonomyId(db: Database): Map<string, TaxonomyCategory[]> {
  const rows = db
    .query<TaxonomyCategoryRow, []>(
      `
        SELECT id, taxonomy_id, parent_id, name, color, sort_order
        FROM taxonomy_categories
        ORDER BY taxonomy_id ASC, sort_order ASC
      `,
    )
    .all();
  const categoriesByTaxonomyId = new Map<string, TaxonomyCategory[]>();
  for (const row of rows) {
    const category = taxonomyCategoryFromRow(row);
    const categories = categoriesByTaxonomyId.get(category.taxonomyId) ?? [];
    categories.push(category);
    categoriesByTaxonomyId.set(category.taxonomyId, categories);
  }
  return categoriesByTaxonomyId;
}

function readCategoriesForTaxonomy(db: Database, taxonomyId: string): TaxonomyCategory[] {
  return db
    .query<TaxonomyCategoryRow, [string]>(
      `
        SELECT id, taxonomy_id, parent_id, name, color, sort_order
        FROM taxonomy_categories
        WHERE taxonomy_id = ?
        ORDER BY sort_order ASC
      `,
    )
    .all(taxonomyId)
    .map(taxonomyCategoryFromRow);
}

function readAssignmentsByAsset(
  db: Database,
  assetIds: string[],
): Map<string, AssetTaxonomyAssignment[]> {
  const uniqueAssetIds = [...new Set(assetIds)];
  if (uniqueAssetIds.length === 0) {
    return new Map();
  }
  const placeholders = uniqueAssetIds.map(() => "?").join(", ");
  const rows = db
    .query<AssetTaxonomyAssignmentRow, string[]>(
      `
        SELECT asset_id, taxonomy_id, category_id, weight
        FROM asset_taxonomy_assignments
        WHERE asset_id IN (${placeholders})
      `,
    )
    .all(...uniqueAssetIds);
  return assignmentsByAssetFromRows(rows);
}

function readAssignmentsByTaxonomyAndCategories(
  db: Database,
  taxonomyId: string,
  categoryIds: string[],
): AssetTaxonomyAssignment[] {
  const uniqueCategoryIds = [...new Set(categoryIds)];
  if (uniqueCategoryIds.length === 0) {
    return [];
  }
  const placeholders = uniqueCategoryIds.map(() => "?").join(", ");
  return db
    .query<AssetTaxonomyAssignmentRow, string[]>(
      `
        SELECT asset_id, taxonomy_id, category_id, weight
        FROM asset_taxonomy_assignments
        WHERE taxonomy_id = ? AND category_id IN (${placeholders})
      `,
    )
    .all(taxonomyId, ...uniqueCategoryIds)
    .map(assetTaxonomyAssignmentFromRow);
}

function assignmentsByAssetFromRows(
  rows: AssetTaxonomyAssignmentRow[],
): Map<string, AssetTaxonomyAssignment[]> {
  const assignmentsByAsset = new Map<string, AssetTaxonomyAssignment[]>();
  for (const row of rows) {
    const assignment = assetTaxonomyAssignmentFromRow(row);
    const assignments = assignmentsByAsset.get(assignment.assetId) ?? [];
    assignments.push(assignment);
    assignmentsByAsset.set(assignment.assetId, assignments);
  }
  return assignmentsByAsset;
}

function taxonomyFromRow(row: TaxonomyRow): Taxonomy {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    isSystem: row.is_system !== 0,
  };
}

function taxonomyCategoryFromRow(row: TaxonomyCategoryRow): TaxonomyCategory {
  return {
    id: row.id,
    taxonomyId: row.taxonomy_id,
    parentId: row.parent_id,
    name: row.name,
    color: row.color,
  };
}

function assetTaxonomyAssignmentFromRow(row: AssetTaxonomyAssignmentRow): AssetTaxonomyAssignment {
  return {
    assetId: row.asset_id,
    taxonomyId: row.taxonomy_id,
    categoryId: row.category_id,
    weight: row.weight,
  };
}

function readAssetsById(db: Database, assetIds: string[]): Map<string, AssetRow> {
  const uniqueAssetIds = [...new Set(assetIds)];
  if (uniqueAssetIds.length === 0) {
    return new Map();
  }
  const placeholders = uniqueAssetIds.map(() => "?").join(", ");
  const rows = db
    .query<AssetRow, string[]>(
      `
        SELECT
          id,
          kind,
          name,
          display_code,
          notes,
          metadata,
          is_active,
          quote_mode,
          quote_ccy,
          instrument_type,
          instrument_symbol,
          instrument_exchange_mic,
          provider_config
        FROM assets
        WHERE id IN (${placeholders})
      `,
    )
    .all(...uniqueAssetIds);
  return new Map(rows.map((row) => [row.id, row]));
}

function assertAccountExists(db: Database, accountId: string): void {
  const row = db
    .query<AccountExistsRow, [string]>("SELECT COUNT(*) AS count FROM accounts WHERE id = ?")
    .get(accountId);
  if (!row || row.count === 0) {
    throw new Error(`Record not found: account ${accountId}`);
  }
}

function readAccountCurrency(db: Database, accountId: string): string {
  const row = db
    .query<AccountCurrencyRow, [string]>("SELECT currency FROM accounts WHERE id = ?")
    .get(accountId);
  if (!row) {
    throw new Error(`Record not found: account ${accountId}`);
  }
  return row.currency;
}

function stableSnapshotId(accountId: string, snapshotDate: string): string {
  const digest = createHash("sha256")
    .update(`wealthfolio:snapshot:${accountId}:${snapshotDate}`)
    .digest();
  const bytes = Uint8Array.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return [
    bytesToHex(bytes.subarray(0, 4)),
    bytesToHex(bytes.subarray(4, 6)),
    bytesToHex(bytes.subarray(6, 8)),
    bytesToHex(bytes.subarray(8, 10)),
    bytesToHex(bytes.subarray(10, 16)),
  ].join("-");
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function subtractMonths(date: string, months: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const targetMonthIndex = (year ?? 1970) * 12 + ((month ?? 1) - 1) - months;
  const targetYear = Math.floor(targetMonthIndex / 12);
  const targetMonth = (targetMonthIndex % 12) + 1;
  const clampedDay = Math.min(day ?? 1, daysInMonth(targetYear, targetMonth));
  return `${targetYear.toString().padStart(4, "0")}-${targetMonth
    .toString()
    .padStart(2, "0")}-${clampedDay.toString().padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function readExistingSnapshotDates(
  db: Database,
  accountId: string,
  validDates: string[],
): string[] {
  if (validDates.length === 0) {
    return [];
  }
  const importDates = new Set(validDates);
  const minDate = validDates.reduce((min, date) => (date < min ? date : min), validDates[0]);
  const maxDate = validDates.reduce((max, date) => (date > max ? date : max), validDates[0]);
  return db
    .query<SnapshotDateRow, [string, string, string]>(
      `
        SELECT snapshot_date
        FROM holdings_snapshots
        WHERE account_id = ? AND snapshot_date >= ? AND snapshot_date <= ?
        ORDER BY snapshot_date ASC
      `,
    )
    .all(accountId, minDate, maxDate)
    .filter((row) => importDates.has(row.snapshot_date))
    .map((row) => row.snapshot_date);
}

function symbolCheckResult(db: Database, symbol: string): SymbolCheckResult {
  const row = readExactAssetSymbol(db, symbol);
  if (!row) {
    return {
      symbol,
      found: false,
      assetName: null,
      assetId: null,
      currency: null,
      exchangeMic: null,
    };
  }
  return {
    symbol,
    found: true,
    assetName: row.name,
    assetId: row.id,
    currency: row.quote_ccy,
    exchangeMic: row.instrument_exchange_mic,
  };
}

function readExactAssetSymbol(db: Database, symbol: string): AssetRow | null {
  if (symbol.trim() === "") {
    return null;
  }
  return db
    .query<AssetRow, [string, string]>(
      `
        SELECT
          id,
          kind,
          name,
          display_code,
          notes,
          metadata,
          is_active,
          quote_mode,
          quote_ccy,
          instrument_type,
          instrument_symbol,
          instrument_exchange_mic,
          provider_config
        FROM assets
        WHERE UPPER(display_code) = ?
           OR UPPER(instrument_symbol) = ?
        ORDER BY is_active DESC, name ASC, id ASC
        LIMIT 1
      `,
    )
    .get(symbol, symbol);
}

function decimalOrFallback(value: unknown, fallback: Decimal): Decimal {
  try {
    const decimal = new Decimal(value as Decimal.Value);
    return decimal.isFinite() ? decimal : fallback;
  } catch {
    return fallback;
  }
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

function decimalToNumber(value: unknown, fallback: Decimal): number {
  try {
    const decimal = new Decimal(value as Decimal.Value);
    return Number((decimal.isFinite() ? decimal : fallback).toString());
  } catch {
    return Number(fallback.toString());
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isValidFiniteDecimalString(value: string): boolean {
  try {
    return new Decimal(value).isFinite();
  } catch {
    return false;
  }
}

function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseJsonObjectOrEmpty(rawJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawJson);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

function snapshotPositionsFromJson(rawJson: string): SnapshotPosition[] {
  return Object.values(parseJsonObjectOrEmpty(rawJson)).filter(isSnapshotPosition);
}

function isSnapshotPosition(value: unknown): value is SnapshotPosition {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { assetId?: unknown }).assetId === "string" &&
    typeof (value as { currency?: unknown }).currency === "string" &&
    typeof (value as { inceptionDate?: unknown }).inceptionDate === "string"
  );
}

function parseNullableJson(rawJson: string | null): unknown | null {
  if (!rawJson) {
    return null;
  }
  try {
    return JSON.parse(rawJson);
  } catch {
    return null;
  }
}

function preferredProvider(rawJson: string | null): string | null {
  const providerConfig = parseNullableJson(rawJson);
  if (
    providerConfig &&
    typeof providerConfig === "object" &&
    !Array.isArray(providerConfig) &&
    typeof (providerConfig as { preferred_provider?: unknown }).preferred_provider === "string"
  ) {
    return (providerConfig as { preferred_provider: string }).preferred_provider;
  }
  return null;
}

function purchasePrice(rawJson: string | null): number | null {
  const metadata = parseNullableJson(rawJson);
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const value = (metadata as { purchase_price?: unknown }).purchase_price;
  if (value === undefined || value === null) {
    return null;
  }
  return decimalToNumber(value, new Decimal(0));
}

function resolveBaseCurrency(options: HoldingsServiceOptions): string | undefined {
  const baseCurrency =
    typeof options.baseCurrency === "function" ? options.baseCurrency() : options.baseCurrency;
  return baseCurrency && baseCurrency.trim() ? baseCurrency : undefined;
}

function resolveToday(options: HoldingsServiceOptions): string {
  const today = options.today?.();
  return today && isValidDateString(today) ? today : resolveUtcDateString();
}

function resolveUtcDateString(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function dateStringFromTimestamp(timestamp: string): string {
  const dateString = timestamp.slice(0, 10);
  return isValidDateString(dateString) ? dateString : resolveUtcDateString();
}

function isExpiredOptionAsset(asset: AssetRow, today: string): boolean {
  if (asset.instrument_type !== "OPTION") {
    return false;
  }
  const expiration =
    optionExpirationFromMetadata(asset.metadata) ??
    parseOccExpiration(asset.instrument_symbol ?? "") ??
    parseOccExpiration(asset.display_code ?? "");
  return expiration !== null && expiration < today;
}

function optionExpirationFromMetadata(rawJson: string | null): string | null {
  const metadata = parseNullableJson(rawJson);
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const option = (metadata as { option?: unknown }).option;
  if (!option || typeof option !== "object" || Array.isArray(option)) {
    return null;
  }
  const expiration = (option as { expiration?: unknown }).expiration;
  return typeof expiration === "string" && isValidDateString(expiration) ? expiration : null;
}

function parseOccExpiration(symbol: string): string | null {
  const trimmed = symbol.trim();
  if (trimmed.length < 15 || trimmed.length > 21) {
    return null;
  }
  const dateStart = trimmed.length - 15;
  const dateEnd = trimmed.length - 9;
  const datePart = trimmed.slice(dateStart, dateEnd);
  const optionType = trimmed[dateEnd];
  if (!/^\d{6}$/.test(datePart) || (optionType !== "C" && optionType !== "P")) {
    return null;
  }
  const year = 2000 + Number(datePart.slice(0, 2));
  const month = datePart.slice(2, 4);
  const day = datePart.slice(4, 6);
  const expiration = `${year}-${month}-${day}`;
  return isValidDateString(expiration) ? expiration : null;
}
