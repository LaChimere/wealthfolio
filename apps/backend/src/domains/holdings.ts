import type { Database } from "bun:sqlite";

import Decimal from "decimal.js";

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
  importHoldingsCsv(request: HoldingsImportRequest): Promise<unknown> | unknown;
}

export interface HoldingsServiceOptions {
  baseCurrency?: string | (() => string | undefined);
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
  fxRate: null;
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
  quote_mode: string;
  quote_ccy: string;
  instrument_exchange_mic: string | null;
  provider_config: string | null;
}

interface AccountExistsRow {
  count: number;
}

interface SnapshotDateRow {
  snapshot_date: string;
}

const ALTERNATIVE_ASSET_KINDS = new Set([
  "PROPERTY",
  "VEHICLE",
  "COLLECTIBLE",
  "PRECIOUS_METAL",
  "LIABILITY",
  "OTHER",
]);

export function createHoldingsService(
  db: Database,
  options: HoldingsServiceOptions = {},
): HoldingsService {
  return {
    getHoldings() {
      return notImplemented("Holdings fan-out is not available in the TS runtime yet");
    },
    getHolding() {
      return notImplemented("Holding detail is not available in the TS runtime yet");
    },
    getAssetHoldings() {
      return notImplemented("Asset holdings are not available in the TS runtime yet");
    },
    getHistoricalValuations(accountId, startDate, endDate) {
      return readHistoricalValuations(db, accountId, startDate, endDate);
    },
    getLatestValuations(accountIds) {
      const ids = accountIds && accountIds.length > 0 ? accountIds : readActiveAccountIds(db);
      return ids.length === 0 ? [] : readLatestValuations(db, ids);
    },
    getPortfolioAllocations() {
      return notImplemented("Portfolio allocations are not available in the TS runtime yet");
    },
    getHoldingsByAllocation() {
      return notImplemented("Allocation holdings are not available in the TS runtime yet");
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
    deleteSnapshot() {
      return notImplemented("Snapshot deletion is not available in the TS runtime yet");
    },
    saveManualHoldings() {
      return notImplemented("Manual holdings save is not available in the TS runtime yet");
    },
    checkHoldingsImport(request) {
      try {
        return checkHoldingsImport(db, request);
      } catch (error) {
        return Promise.reject(error);
      }
    },
    importHoldingsCsv() {
      return notImplemented("Holdings import is not available in the TS runtime yet");
    },
  };
}

function notImplemented(message: string): Promise<never> {
  return Promise.reject(new HoldingsNotImplementedError(message));
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
  const snapshot = db
    .query<SnapshotRow, [string, string]>(
      `
        SELECT id, account_id, snapshot_date, currency, positions, cash_balances
        FROM holdings_snapshots
        WHERE account_id = ? AND snapshot_date = ?
      `,
    )
    .get(accountId, date);
  if (!snapshot) {
    throw new Error(`No snapshot found for date ${date}`);
  }

  const resolvedBaseCurrency = baseCurrency ?? snapshot.currency;
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
    holdings.push(holdingFromPosition(snapshot, position, asset, quantity, resolvedBaseCurrency));
  }

  for (const [currency, amountValue] of Object.entries(
    parseJsonObjectOrEmpty(snapshot.cash_balances),
  )) {
    const amount = decimalToNumber(amountValue, new Decimal(0));
    if (amount === 0) {
      continue;
    }
    holdings.push(cashHoldingFromSnapshot(snapshot, currency, amount, resolvedBaseCurrency));
  }

  return holdings;
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
    asOfDate: snapshot.snapshot_date,
    metadata: parseNullableJson(asset.metadata),
  };
}

function cashHoldingFromSnapshot(
  snapshot: SnapshotRow,
  currency: string,
  amount: number,
  baseCurrency: string,
): Holding {
  return {
    id: `CASH-${snapshot.account_id}-${currency}`,
    accountId: snapshot.account_id,
    holdingType: "cash",
    instrument: null,
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
    asOfDate: snapshot.snapshot_date,
    metadata: null,
  };
}

function zeroMonetaryValue(): MonetaryValue {
  return { local: 0, base: 0 };
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
          quote_mode,
          quote_ccy,
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
          quote_mode,
          quote_ccy,
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

function decimalToNumber(value: unknown, fallback: Decimal): number {
  try {
    const decimal = new Decimal(value as Decimal.Value);
    return Number((decimal.isFinite() ? decimal : fallback).toString());
  } catch {
    return Number(fallback.toString());
  }
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
