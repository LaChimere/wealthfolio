import type { Database } from "bun:sqlite";

import Decimal from "decimal.js";

import type { ExchangeRateService } from "./exchange-rates";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN });

export interface PerformanceRequest {
  itemType: string;
  itemId: string;
  startDate?: string;
  endDate?: string;
  trackingMode?: "HOLDINGS" | "TRANSACTIONS";
}

export interface PortfolioMetricsService {
  getNetWorth(date?: string): Promise<unknown> | unknown;
  getNetWorthHistory(startDate: string, endDate: string): Promise<unknown[]> | unknown[];
  calculateAccountsSimplePerformance?(accountIds?: string[]): Promise<unknown[]> | unknown[];
  calculatePerformanceHistory?(request: PerformanceRequest): Promise<unknown> | unknown;
  calculatePerformanceSummary?(request: PerformanceRequest): Promise<unknown> | unknown;
  getIncomeSummary?(accountId?: string): Promise<unknown[]> | unknown[];
}

export interface NetWorthHistoryPoint {
  date: string;
  portfolioValue: number;
  alternativeAssetsValue: number;
  totalLiabilities: number;
  totalAssets: number;
  netWorth: number;
  netContribution: number;
  currency: string;
}

export interface BreakdownItem {
  category: string;
  name: string;
  value: number;
  assetId?: string;
}

export interface BalanceSheetSection {
  total: number;
  breakdown: BreakdownItem[];
}

export interface StaleAssetInfo {
  assetId: string;
  name: string | null;
  valuationDate: string;
  daysStale: number;
}

export interface NetWorthResponse {
  date: string;
  assets: BalanceSheetSection;
  liabilities: BalanceSheetSection;
  netWorth: number;
  currency: string;
  oldestValuationDate: string | null;
  staleAssets: StaleAssetInfo[];
}

export interface PortfolioMetricsServiceOptions {
  baseCurrency?: string | (() => string | undefined);
  exchangeRateService: Pick<ExchangeRateService, "convertCurrencyForDate">;
  now?: () => Date;
  warn?: (message: string) => void;
}

interface AccountRow {
  id: string;
  account_type: string;
  currency: string;
}

interface AssetRow {
  id: string;
  kind: string;
  name: string | null;
  display_code: string | null;
  quote_ccy: string;
}

interface SnapshotRow {
  account_id: string;
  snapshot_date: string;
  positions: string;
  cash_balances: string;
}

interface QuoteRow {
  asset_id: string;
  day: string;
  close: string;
  currency: string;
  timestamp: string;
}

interface DailyAccountValuationRow {
  valuation_date: string;
  total_value: string;
  net_contribution: string;
}

interface PositionSnapshot {
  quantity: Decimal;
  totalCostBasis: Decimal;
  currency: string;
  contractMultiplier: Decimal;
}

interface ValuationInfo {
  assetId: string;
  name: string | null;
  marketValueBase: Decimal;
  valuationDate: string;
  category: AssetCategory;
}

type AssetCategory =
  | "cash"
  | "investments"
  | "properties"
  | "vehicles"
  | "collectibles"
  | "preciousMetals"
  | "liabilities"
  | "otherAssets";

interface CategoryMetadata {
  key: AssetCategory;
  name: string;
}

const DECIMAL_PRECISION = 8;
const PORTFOLIO_TOTAL_ACCOUNT_ID = "TOTAL";
const STALENESS_THRESHOLD_DAYS = 90;
const QUOTE_LOOKBACK_DAYS = 30;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const CATEGORY_METADATA: Record<AssetCategory, CategoryMetadata> = {
  cash: { key: "cash", name: "Cash" },
  investments: { key: "investments", name: "Investments" },
  properties: { key: "properties", name: "Properties" },
  vehicles: { key: "vehicles", name: "Vehicles" },
  collectibles: { key: "collectibles", name: "Collectibles" },
  preciousMetals: { key: "preciousMetals", name: "Precious Metals" },
  liabilities: { key: "liabilities", name: "Liabilities" },
  otherAssets: { key: "otherAssets", name: "Other Assets" },
};

const CURRENCY_NORMALIZATION_RULES: Record<string, { majorCode: string; factor: Decimal }> = {
  GBp: { majorCode: "GBP", factor: new Decimal("0.01") },
  GBX: { majorCode: "GBP", factor: new Decimal("0.01") },
  KWF: { majorCode: "KWD", factor: new Decimal("0.01") },
  ZAc: { majorCode: "ZAR", factor: new Decimal("0.01") },
  ZAC: { majorCode: "ZAR", factor: new Decimal("0.01") },
  ILA: { majorCode: "ILS", factor: new Decimal("0.01") },
};

export function createPortfolioMetricsService(
  db: Database,
  options: PortfolioMetricsServiceOptions,
): PortfolioMetricsService {
  return {
    getNetWorth(date) {
      return calculateNetWorth(db, resolveDate(date, options.now), options);
    },
    getNetWorthHistory(startDate, endDate) {
      return calculateNetWorthHistory(db, startDate, endDate, options);
    },
  };
}

function calculateNetWorth(
  db: Database,
  date: string,
  options: PortfolioMetricsServiceOptions,
): NetWorthResponse {
  const baseCurrency = resolveBaseCurrency(options);
  const accounts = readNonArchivedAccounts(db);
  if (accounts.length === 0) {
    return emptyNetWorthResponse(date, baseCurrency);
  }

  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const snapshots = readLatestSnapshotsBeforeDate(
    db,
    accounts.map((account) => account.id),
    date,
  );
  const assetById = readAssetsById(db);
  const valuations: ValuationInfo[] = [];

  for (const snapshot of snapshots) {
    const account = accountById.get(snapshot.account_id);
    if (!account) {
      options.warn?.(`Account ${snapshot.account_id} not found in account map`);
      continue;
    }
    const accountCategory = categorizeByAccountType(account.account_type);
    const positions = parsePositionMap(snapshot.positions);
    for (const [assetId, position] of positions) {
      if (position.quantity.isZero()) {
        continue;
      }

      const asset = assetById.get(assetId) ?? null;
      const category = asset ? categorizeByAssetKind(asset.kind) : accountCategory;
      const quote = latestQuoteAsOf(db, assetId, date, asset);
      let price: Decimal;
      let quoteCurrency: string;
      let valuationDate: string;

      if (quote) {
        price = parseStoredDecimal(quote.close, "quote.close");
        quoteCurrency = quote.currency;
        valuationDate = quote.day;
      } else if (position.quantity.gt(0)) {
        price = position.totalCostBasis.div(position.quantity);
        quoteCurrency = position.currency;
        valuationDate = snapshot.snapshot_date;
      } else {
        options.warn?.(`No quote found for ${assetId} and cannot derive from cost basis`);
        continue;
      }

      const normalized = normalizeAmountAndCurrency(price, quoteCurrency);
      let marketValueBase: Decimal;
      try {
        marketValueBase = calculateMarketValueBase(
          options,
          position.quantity,
          normalized.amount,
          position.contractMultiplier,
          normalized.currency,
          baseCurrency,
          date,
        );
      } catch (error) {
        options.warn?.(
          `Failed to calculate market value for ${assetId}: ${errorMessage(
            error,
          )}. Using local value.`,
        );
        marketValueBase = position.quantity.mul(price).mul(position.contractMultiplier);
      }

      valuations.push({
        assetId,
        name: assetDisplayName(asset),
        marketValueBase,
        valuationDate,
        category,
      });
    }

    const cashBalances = parseCashBalances(snapshot.cash_balances);
    for (const [currency, amount] of cashBalances) {
      if (amount.isZero()) {
        continue;
      }
      let cashBase: Decimal;
      if (currency === baseCurrency) {
        cashBase = amount;
      } else {
        try {
          cashBase = convertCurrencyForDate(options, amount, currency, baseCurrency, date);
        } catch (error) {
          options.warn?.(
            `Failed to convert cash ${amount.toString()} ${currency} to ${baseCurrency}: ${errorMessage(
              error,
            )}. Using unconverted.`,
          );
          cashBase = amount;
        }
      }
      valuations.push({
        assetId: `CASH:${currency}`,
        name: `Cash (${currency})`,
        marketValueBase: roundDecimal(cashBase),
        valuationDate: snapshot.snapshot_date,
        category: "cash",
      });
    }
  }

  for (const asset of Array.from(assetById.values()).filter((candidate) =>
    isAlternativeAssetKind(candidate.kind),
  )) {
    if (valuations.some((valuation) => valuation.assetId === asset.id)) {
      continue;
    }
    const quote = latestQuoteAsOf(db, asset.id, date, asset);
    if (!quote) {
      options.warn?.(`No quote found for alternative asset ${asset.id}, skipping`);
      continue;
    }
    const price = parseStoredDecimal(quote.close, "quote.close");
    const normalized = normalizeAmountAndCurrency(price, quote.currency);
    let marketValueBase: Decimal;
    try {
      marketValueBase = calculateMarketValueBase(
        options,
        new Decimal(1),
        normalized.amount,
        new Decimal(1),
        normalized.currency,
        baseCurrency,
        date,
      );
    } catch (error) {
      options.warn?.(
        `Failed to convert alternative asset ${asset.id} value to base currency: ${errorMessage(
          error,
        )}. Using local value.`,
      );
      marketValueBase = price;
    }

    valuations.push({
      assetId: asset.id,
      name: assetDisplayName(asset),
      marketValueBase,
      valuationDate: quote.day,
      category: categorizeByAssetKind(asset.kind),
    });
  }

  const assets = buildAssetsSection(valuations);
  const liabilities = buildLiabilitiesSection(valuations);
  const netWorth = roundDecimal(decimalFromJsonNumber(assets.total).minus(liabilities.total));
  const staleness = calculateStaleness(valuations, date);

  return {
    date,
    assets,
    liabilities,
    netWorth: decimalToJsonNumber(netWorth),
    currency: baseCurrency,
    oldestValuationDate: staleness.oldestValuationDate,
    staleAssets: staleness.staleAssets,
  };
}

function calculateNetWorthHistory(
  db: Database,
  startDate: string,
  endDate: string,
  options: PortfolioMetricsServiceOptions,
): NetWorthHistoryPoint[] {
  const baseCurrency = resolveBaseCurrency(options);
  const portfolioByDate = new Map(
    readTotalAccountValuations(db, startDate, endDate).map((valuation) => [
      valuation.valuation_date,
      {
        value: parseStoredDecimal(valuation.total_value, "daily_account_valuation.total_value"),
        netContribution: parseStoredDecimal(
          valuation.net_contribution,
          "daily_account_valuation.net_contribution",
        ),
      },
    ]),
  );

  const alternativeAssets = Array.from(readAssetsById(db).values()).filter((asset) =>
    isAlternativeAssetKind(asset.kind),
  );
  const assetIds = new Set(
    alternativeAssets.filter((asset) => asset.kind !== "LIABILITY").map((asset) => asset.id),
  );
  const liabilityIds = new Set(
    alternativeAssets.filter((asset) => asset.kind === "LIABILITY").map((asset) => asset.id),
  );
  const assetById = new Map(alternativeAssets.map((asset) => [asset.id, asset]));
  const quoteValuesByDate = readFilledAlternativeQuoteValues(
    db,
    alternativeAssets,
    startDate,
    endDate,
    baseCurrency,
    options,
  );

  const firstPortfolioDate = firstMapKey(portfolioByDate);
  const allDates = new Set<string>();
  if (firstPortfolioDate) {
    for (const date of portfolioByDate.keys()) {
      allDates.add(date);
    }
    for (const date of quoteValuesByDate.keys()) {
      if (compareIsoDates(date, firstPortfolioDate) >= 0) {
        allDates.add(date);
      }
    }
  } else {
    for (const date of quoteValuesByDate.keys()) {
      allDates.add(date);
    }
    if (
      allDates.size === 0 &&
      alternativeAssets.some((asset) => latestQuoteAsOf(db, asset.id, startDate, asset))
    ) {
      allDates.add(startDate);
    }
  }

  const sortedDates = Array.from(allDates).sort(compareIsoDates);
  let currentPortfolio = { value: new Decimal(0), netContribution: new Decimal(0) };
  let portfolioInitialized = false;
  const currentAssetValues = new Map<string, Decimal>();
  const history: NetWorthHistoryPoint[] = [];

  for (const date of sortedDates) {
    const portfolio = portfolioByDate.get(date);
    if (portfolio) {
      currentPortfolio = portfolio;
      portfolioInitialized = true;
    }

    const quoteValues = quoteValuesByDate.get(date);
    if (quoteValues) {
      for (const [assetId, value] of quoteValues) {
        if (assetById.has(assetId)) {
          currentAssetValues.set(assetId, value);
        }
      }
    }

    if (!portfolioInitialized && firstPortfolioDate) {
      continue;
    }

    let alternativeAssetsValue = new Decimal(0);
    let liabilitiesValue = new Decimal(0);
    for (const [assetId, value] of currentAssetValues) {
      if (liabilityIds.has(assetId)) {
        liabilitiesValue = liabilitiesValue.plus(value);
      } else if (assetIds.has(assetId)) {
        alternativeAssetsValue = alternativeAssetsValue.plus(value);
      }
    }

    const totalAssets = currentPortfolio.value.plus(alternativeAssetsValue);
    const netWorth = totalAssets.minus(liabilitiesValue);

    history.push({
      date,
      portfolioValue: decimalToJsonNumber(currentPortfolio.value),
      alternativeAssetsValue: decimalToJsonNumber(alternativeAssetsValue),
      totalLiabilities: decimalToJsonNumber(liabilitiesValue),
      totalAssets: decimalToJsonNumber(totalAssets),
      netWorth: decimalToJsonNumber(netWorth),
      netContribution: decimalToJsonNumber(currentPortfolio.netContribution),
      currency: baseCurrency,
    });
  }

  return history;
}

function readNonArchivedAccounts(db: Database): AccountRow[] {
  return db
    .query<AccountRow, []>(
      `
        SELECT id, account_type, currency
        FROM accounts
        WHERE COALESCE(is_archived, 0) = 0
        ORDER BY id ASC
      `,
    )
    .all();
}

function readLatestSnapshotsBeforeDate(
  db: Database,
  accountIds: string[],
  date: string,
): SnapshotRow[] {
  if (accountIds.length === 0) {
    return [];
  }
  const placeholders = accountIds.map(() => "?").join(", ");
  return db
    .query<SnapshotRow, string[]>(
      `
        WITH ranked_snapshots AS (
          SELECT
            account_id,
            snapshot_date,
            positions,
            cash_balances,
            ROW_NUMBER() OVER (
              PARTITION BY account_id
              ORDER BY snapshot_date DESC
            ) AS rn
          FROM holdings_snapshots
          WHERE account_id IN (${placeholders})
            AND snapshot_date <= ?
        )
        SELECT account_id, snapshot_date, positions, cash_balances
        FROM ranked_snapshots
        WHERE rn = 1
        ORDER BY account_id ASC
      `,
    )
    .all(...accountIds, date);
}

function readAssetsById(db: Database): Map<string, AssetRow> {
  const rows = db
    .query<AssetRow, []>(
      `
        SELECT id, kind, name, display_code, quote_ccy
        FROM assets
        ORDER BY id ASC
      `,
    )
    .all();
  return new Map(rows.map((asset) => [asset.id, asset]));
}

function latestQuoteAsOf(
  db: Database,
  assetId: string,
  date: string,
  asset: AssetRow | null,
): QuoteRow | null {
  const row = db
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
    .get(assetId, date);
  return row ? reconcileQuoteCurrency(row, asset) : null;
}

function readTotalAccountValuations(
  db: Database,
  startDate: string,
  endDate: string,
): DailyAccountValuationRow[] {
  return db
    .query<DailyAccountValuationRow, [string, string, string]>(
      `
        SELECT valuation_date, total_value, net_contribution
        FROM daily_account_valuation
        WHERE account_id = ?
          AND valuation_date >= ?
          AND valuation_date <= ?
        ORDER BY valuation_date ASC
      `,
    )
    .all(PORTFOLIO_TOTAL_ACCOUNT_ID, startDate, endDate);
}

function readFilledAlternativeQuoteValues(
  db: Database,
  assets: AssetRow[],
  startDate: string,
  endDate: string,
  baseCurrency: string,
  options: PortfolioMetricsServiceOptions,
): Map<string, Map<string, Decimal>> {
  if (assets.length === 0 || compareIsoDates(startDate, endDate) > 0) {
    return new Map();
  }

  const assetIds = assets.map((asset) => asset.id);
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const lookbackStart = addDays(startDate, -QUOTE_LOOKBACK_DAYS);
  const placeholders = assetIds.map(() => "?").join(", ");
  const rows = db
    .query<QuoteRow, string[]>(
      `
        SELECT asset_id, day, close, currency, timestamp
        FROM quotes
        WHERE asset_id IN (${placeholders})
          AND day >= ?
          AND day <= ?
        ORDER BY day ASC, timestamp ASC
      `,
    )
    .all(...assetIds, lookbackStart, endDate)
    .map((row) => reconcileQuoteCurrency(row, assetById.get(row.asset_id) ?? null));

  const symbolsWithSeed = new Set(
    rows.filter((row) => compareIsoDates(row.day, startDate) < 0).map((row) => row.asset_id),
  );
  for (const assetId of assetIds) {
    if (symbolsWithSeed.has(assetId)) {
      continue;
    }
    const seed = latestQuoteAsOf(
      db,
      assetId,
      addDays(startDate, -1),
      assetById.get(assetId) ?? null,
    );
    if (seed) {
      rows.push(seed);
    }
  }

  const quotesByDate = new Map<string, Map<string, QuoteRow>>();
  rows.sort((left, right) => {
    const dateCompare = compareIsoDates(left.day, right.day);
    return dateCompare !== 0 ? dateCompare : left.timestamp.localeCompare(right.timestamp);
  });
  for (const row of rows) {
    let dailyQuotes = quotesByDate.get(row.day);
    if (!dailyQuotes) {
      dailyQuotes = new Map();
      quotesByDate.set(row.day, dailyQuotes);
    }
    dailyQuotes.set(row.asset_id, row);
  }

  const preStartDates = Array.from(quotesByDate.keys())
    .filter((date) => compareIsoDates(date, startDate) < 0)
    .sort(compareIsoDates);
  const lastKnownQuotes = new Map<string, QuoteRow>();
  for (const date of preStartDates) {
    const dailyQuotes = quotesByDate.get(date);
    if (!dailyQuotes) {
      continue;
    }
    for (const [assetId, quote] of dailyQuotes) {
      lastKnownQuotes.set(assetId, quote);
    }
  }

  const valuesByDate = new Map<string, Map<string, Decimal>>();
  for (const date of datesBetween(startDate, endDate)) {
    const dailyQuotes = quotesByDate.get(date);
    if (dailyQuotes) {
      for (const [assetId, quote] of dailyQuotes) {
        lastKnownQuotes.set(assetId, quote);
      }
    }

    for (const [assetId, quote] of lastKnownQuotes) {
      const price = parseStoredDecimal(quote.close, "quote.close");
      const normalized = normalizeAmountAndCurrency(price, quote.currency);
      let valueBase: Decimal;
      if (normalized.currency === baseCurrency) {
        valueBase = normalized.amount;
      } else {
        try {
          valueBase = convertCurrencyForDate(
            options,
            normalized.amount,
            normalized.currency,
            baseCurrency,
            date,
          );
        } catch {
          valueBase = normalized.amount;
        }
      }
      let values = valuesByDate.get(date);
      if (!values) {
        values = new Map();
        valuesByDate.set(date, values);
      }
      values.set(assetId, valueBase);
    }
  }

  return valuesByDate;
}

function calculateMarketValueBase(
  options: PortfolioMetricsServiceOptions,
  quantity: Decimal,
  price: Decimal,
  contractMultiplier: Decimal,
  assetCurrency: string,
  baseCurrency: string,
  date: string,
): Decimal {
  const localValue = quantity.mul(price).mul(contractMultiplier);
  if (assetCurrency === baseCurrency) {
    return roundDecimal(localValue);
  }
  return roundDecimal(
    convertCurrencyForDate(options, localValue, assetCurrency, baseCurrency, date),
  );
}

function convertCurrencyForDate(
  options: PortfolioMetricsServiceOptions,
  amount: Decimal,
  fromCurrency: string,
  toCurrency: string,
  date: string,
): Decimal {
  if (fromCurrency === toCurrency) {
    return amount;
  }
  return parseStoredDecimal(
    options.exchangeRateService.convertCurrencyForDate(
      amount.toString(),
      fromCurrency,
      toCurrency,
      date,
    ),
    "converted currency amount",
  );
}

function buildAssetsSection(valuations: ValuationInfo[]): BalanceSheetSection {
  const totals = new Map<AssetCategory, Decimal>();
  for (const valuation of valuations) {
    if (valuation.category === "liabilities") {
      continue;
    }
    totals.set(
      valuation.category,
      (totals.get(valuation.category) ?? new Decimal(0)).plus(valuation.marketValueBase),
    );
  }

  const breakdown = Array.from(totals)
    .filter(([, value]) => value.gt(0))
    .map(([category, value]) => {
      const metadata = CATEGORY_METADATA[category];
      return {
        category: metadata.key,
        name: metadata.name,
        value: decimalToJsonNumber(value),
      };
    })
    .sort((left, right) => right.value - left.value);
  const total = breakdown.reduce((sum, item) => sum.plus(item.value), new Decimal(0));
  return { total: decimalToJsonNumber(total), breakdown };
}

function buildLiabilitiesSection(valuations: ValuationInfo[]): BalanceSheetSection {
  const breakdown = valuations
    .filter((valuation) => valuation.category === "liabilities")
    .map((valuation) => ({
      category: "liability",
      name: valuation.name ?? valuation.assetId,
      value: decimalToJsonNumber(valuation.marketValueBase),
      assetId: valuation.assetId,
    }))
    .sort((left, right) => right.value - left.value);
  const total = breakdown.reduce((sum, item) => sum.plus(item.value), new Decimal(0));
  return { total: decimalToJsonNumber(total), breakdown };
}

function calculateStaleness(
  valuations: ValuationInfo[],
  referenceDate: string,
): { oldestValuationDate: string | null; staleAssets: StaleAssetInfo[] } {
  const nonCashValuations = valuations.filter((valuation) => valuation.category !== "cash");
  const oldestValuationDate =
    nonCashValuations.length === 0
      ? null
      : (nonCashValuations
          .map((valuation) => valuation.valuationDate)
          .sort(compareIsoDates)
          .at(0) ?? null);
  const staleAssets = nonCashValuations
    .map((valuation) => ({
      valuation,
      daysStale: daysBetween(valuation.valuationDate, referenceDate),
    }))
    .filter(({ daysStale }) => daysStale > STALENESS_THRESHOLD_DAYS)
    .map(({ valuation, daysStale }) => ({
      assetId: valuation.assetId,
      name: valuation.name,
      valuationDate: valuation.valuationDate,
      daysStale,
    }));
  return { oldestValuationDate, staleAssets };
}

function parsePositionMap(rawJson: string): Map<string, PositionSnapshot> {
  const parsed = parseJsonObject(rawJson, "positions");
  return new Map(
    Object.entries(parsed).map(([assetId, rawPosition]) => {
      const position = objectRecord(rawPosition, `positions.${assetId}`);
      return [
        assetId,
        {
          quantity: parseStoredDecimal(position.quantity ?? 0, `positions.${assetId}.quantity`),
          totalCostBasis: parseStoredDecimal(
            position.totalCostBasis ?? position.total_cost_basis ?? 0,
            `positions.${assetId}.totalCostBasis`,
          ),
          currency: typeof position.currency === "string" ? position.currency : "",
          contractMultiplier: parseStoredDecimal(
            position.contractMultiplier ?? position.contract_multiplier ?? 1,
            `positions.${assetId}.contractMultiplier`,
          ),
        },
      ];
    }),
  );
}

function parseCashBalances(rawJson: string): Map<string, Decimal> {
  const parsed = parseJsonObject(rawJson, "cash_balances");
  return new Map(
    Object.entries(parsed).map(([currency, amount]) => [
      currency,
      parseStoredDecimal(amount, `cash_balances.${currency}`),
    ]),
  );
}

function parseJsonObject(rawJson: string, field: string): Record<string, unknown> {
  try {
    return objectRecord(JSON.parse(rawJson), field);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid stored JSON: ${field}`);
    }
    throw error;
  }
}

function objectRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid stored JSON: ${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function parseStoredDecimal(value: unknown, field: string): Decimal {
  try {
    const decimal = new Decimal(value as Decimal.Value);
    if (!decimal.isFinite()) {
      throw new Error("non-finite decimal");
    }
    return decimal;
  } catch {
    throw new Error(`Invalid stored decimal: ${field}`);
  }
}

function decimalFromJsonNumber(value: number): Decimal {
  return new Decimal(value);
}

function roundDecimal(value: Decimal): Decimal {
  return value.toDecimalPlaces(DECIMAL_PRECISION, Decimal.ROUND_HALF_EVEN);
}

function decimalToJsonNumber(value: Decimal): number {
  return Number(roundDecimal(value).toString());
}

function normalizeAmountAndCurrency(
  amount: Decimal,
  currency: string,
): {
  amount: Decimal;
  currency: string;
} {
  const rule = CURRENCY_NORMALIZATION_RULES[currency];
  return rule
    ? { amount: amount.mul(rule.factor), currency: rule.majorCode }
    : { amount, currency };
}

function normalizeCurrencyCode(currency: string): string {
  return CURRENCY_NORMALIZATION_RULES[currency]?.majorCode ?? currency;
}

function reconcileQuoteCurrency(row: QuoteRow, asset: AssetRow | null): QuoteRow {
  if (!asset) {
    return row;
  }
  const effectiveCurrency = resolveEffectiveQuoteCurrency(asset.quote_ccy, row.currency);
  return effectiveCurrency ? { ...row, currency: effectiveCurrency } : row;
}

function resolveEffectiveQuoteCurrency(
  assetQuoteCurrency: string,
  quoteCurrency: string,
): string | null {
  if (
    assetQuoteCurrency === "" ||
    quoteCurrency === "" ||
    assetQuoteCurrency === quoteCurrency ||
    normalizeCurrencyCode(assetQuoteCurrency) !== normalizeCurrencyCode(quoteCurrency)
  ) {
    return null;
  }
  const assetIsMinor = CURRENCY_NORMALIZATION_RULES[assetQuoteCurrency] !== undefined;
  const quoteIsMinor = CURRENCY_NORMALIZATION_RULES[quoteCurrency] !== undefined;
  if (assetIsMinor && !quoteIsMinor) {
    return assetQuoteCurrency;
  }
  if (quoteIsMinor && !assetIsMinor) {
    return quoteCurrency;
  }
  return assetQuoteCurrency;
}

function categorizeByAccountType(accountType: string): AssetCategory {
  return accountType === "CASH" ? "cash" : "investments";
}

function categorizeByAssetKind(kind: string): AssetCategory {
  switch (kind) {
    case "PROPERTY":
      return "properties";
    case "VEHICLE":
      return "vehicles";
    case "COLLECTIBLE":
      return "collectibles";
    case "PRECIOUS_METAL":
      return "preciousMetals";
    case "LIABILITY":
      return "liabilities";
    case "FX":
    case "OTHER":
      return "otherAssets";
    case "PRIVATE_EQUITY":
    case "INVESTMENT":
    default:
      return "investments";
  }
}

function isAlternativeAssetKind(kind: string): boolean {
  return (
    kind === "PROPERTY" ||
    kind === "VEHICLE" ||
    kind === "COLLECTIBLE" ||
    kind === "PRECIOUS_METAL" ||
    kind === "LIABILITY" ||
    kind === "OTHER"
  );
}

function assetDisplayName(asset: AssetRow | null): string | null {
  if (!asset) {
    return null;
  }
  const name = asset.name?.trim();
  if (name) {
    return name;
  }
  return asset.display_code?.trim() || null;
}

function emptyNetWorthResponse(date: string, currency: string): NetWorthResponse {
  return {
    date,
    assets: { total: 0, breakdown: [] },
    liabilities: { total: 0, breakdown: [] },
    netWorth: 0,
    currency,
    oldestValuationDate: null,
    staleAssets: [],
  };
}

function resolveBaseCurrency(options: PortfolioMetricsServiceOptions): string {
  if (typeof options.baseCurrency === "function") {
    return options.baseCurrency() ?? "";
  }
  return options.baseCurrency ?? "";
}

function resolveDate(date: string | undefined, now: (() => Date) | undefined): string {
  return date ?? isoDate(now?.() ?? new Date());
}

function firstMapKey<T>(map: Map<string, T>): string | null {
  return Array.from(map.keys()).sort(compareIsoDates).at(0) ?? null;
}

function datesBetween(startDate: string, endDate: string): string[] {
  if (compareIsoDates(startDate, endDate) > 0) {
    return [];
  }
  const dates: string[] = [];
  let cursor = isoDateToUtcMs(startDate);
  const end = isoDateToUtcMs(endDate);
  while (cursor <= end) {
    dates.push(isoDate(new Date(cursor)));
    cursor += ONE_DAY_MS;
  }
  return dates;
}

function addDays(date: string, days: number): string {
  return isoDate(new Date(isoDateToUtcMs(date) + days * ONE_DAY_MS));
}

function daysBetween(startDate: string, endDate: string): number {
  return Math.floor((isoDateToUtcMs(endDate) - isoDateToUtcMs(startDate)) / ONE_DAY_MS);
}

function compareIsoDates(left: string, right: string): number {
  return left.localeCompare(right);
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isoDateToUtcMs(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
