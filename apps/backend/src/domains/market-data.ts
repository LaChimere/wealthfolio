import type { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { STATUS_CODES } from "node:http";
import { join } from "node:path";
import Decimal from "decimal.js";

import { parseCsvRecords } from "../csv";
import { DEFAULT_HISTORY_DAYS, type MarketSyncMode } from "./portfolio-jobs";
import type { SecretService } from "./secrets";
import {
  type QuoteSyncEvent,
  type QuoteSyncOperation,
  queueUserQuoteSyncEvent,
} from "./quote-sync";
import type {
  CustomProviderService,
  CustomProviderWithSources,
  CustomProviderQuoteRow,
  CustomProviderRowsResult,
  CustomProviderSource,
  CustomProviderSourceKind,
  TestSourceRequest,
  TestSourceResult,
} from "./custom-providers";

type MarketDataCustomProviderService = Pick<
  CustomProviderService,
  "getSourceByKind" | "testSource"
> &
  Partial<Pick<CustomProviderService, "getAll" | "fetchSourceRows">>;

export interface ExchangeInfo {
  mic: string;
  name: string;
  longName: string;
  currency: string;
}

export interface Quote {
  id: string;
  createdAt: string;
  dataSource: string;
  timestamp: string;
  assetId: string;
  open: number;
  high: number;
  low: number;
  volume: number;
  close: number;
  adjclose: number;
  currency: string;
  notes: string | null;
}

export interface LatestQuoteSnapshot {
  quote: Quote | null;
  isStale: boolean;
  effectiveMarketDate: string;
  quoteDate: string | null;
  noQuoteReason?: NoQuoteReason;
}

export interface QuoteSyncErrorSnapshot {
  assetId: string;
  symbol: string;
  quoteMode: string;
  errorCount: number;
  lastError: string | null;
  hasSyncedBefore: boolean;
}

export interface NoQuoteReason {
  code: string;
  message: string;
}

export type ImportValidationStatus = "valid" | { warning: string } | { error: string };

export interface QuoteImport {
  symbol: string;
  displaySymbol: string | null;
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
  currency: string;
  validationStatus: ImportValidationStatus;
  errorMessage: string | null;
}

export interface YahooDividend {
  amount: number;
  date: number;
}

export interface SymbolSearchResult {
  symbol: string;
  shortName: string;
  longName: string;
  exchange: string;
  exchangeMic?: string | null;
  exchangeName?: string | null;
  quoteType: string;
  typeDisplay: string;
  currency?: string | null;
  currencySource?: string | null;
  dataSource?: string | null;
  isExisting: boolean;
  existingAssetId?: string | null;
  index: string;
  score: number;
}

export interface ResolveSymbolQuoteRequest {
  symbol: string;
  exchangeMic?: string;
  instrumentType?: string;
  quoteCcy?: string;
  providerId?: string;
}

export interface ResolvedQuote {
  currency: string | null;
  price: number | null;
  resolvedProviderId: string | null;
}

export interface MarketDataSyncResult {
  synced: number;
  failed: number;
  skipped: number;
  quotesSynced: number;
  failures: Array<[string, string]>;
  skippedReasons: Array<[string, string]>;
}

export interface MarketDataService {
  getExchanges(): Promise<ExchangeInfo[]> | ExchangeInfo[];
  searchSymbol(query: string): Promise<SymbolSearchResult[]> | SymbolSearchResult[];
  resolveSymbolQuote(request: ResolveSymbolQuoteRequest): Promise<ResolvedQuote> | ResolvedQuote;
  getQuoteHistory(symbol: string): Promise<Quote[]> | Quote[];
  fetchYahooDividends(symbol: string): Promise<YahooDividend[]> | YahooDividend[];
  getLatestQuotes(
    assetIds: string[],
  ): Promise<Record<string, LatestQuoteSnapshot>> | Record<string, LatestQuoteSnapshot>;
  getQuoteSyncErrorSnapshots?(): Promise<QuoteSyncErrorSnapshot[]> | QuoteSyncErrorSnapshot[];
  updateQuote(symbol: string, quote: Record<string, unknown>): Promise<void> | void;
  deleteQuote(id: string): Promise<void> | void;
  checkQuotesImport(
    content: Uint8Array,
    hasHeaderRow: boolean,
  ): Promise<QuoteImport[]> | QuoteImport[];
  importQuotesCsv(
    quotes: unknown[],
    overwriteExisting: boolean,
  ): Promise<QuoteImport[]> | QuoteImport[];
  syncHistoryQuotes(): Promise<MarketDataSyncResult | void> | MarketDataSyncResult | void;
  syncMarketData(
    marketSyncMode: MarketSyncMode,
  ): Promise<MarketDataSyncResult | void> | MarketDataSyncResult | void;
  updatePositionStatusFromHoldings?(
    currentHoldings: ReadonlyMap<string, Decimal.Value>,
  ): Promise<void> | void;
}

export interface MarketDataServiceOptions {
  exchangeCatalogJson?: string;
  fetch?: typeof fetch;
  now?: () => Date;
  queueQuoteSyncEvent?: (event: QuoteSyncEvent) => void;
  customProviderService?: MarketDataCustomProviderService;
  secretService?: SecretService;
}

interface QuoteRow {
  id: string;
  asset_id: string;
  day: string;
  source: string;
  open: string | null;
  high: string | null;
  low: string | null;
  close: string;
  adjclose: string | null;
  volume: string | null;
  currency: string;
  notes: string | null;
  created_at: string;
  timestamp: string;
}

interface QuoteWrite {
  id: string;
  assetId: string;
  day: string;
  source: string;
  open: string | null;
  high: string | null;
  low: string | null;
  close: string;
  adjclose: string | null;
  volume: string | null;
  currency: string;
  notes: string | null;
  createdAt: string;
  timestamp: string;
}

interface ExchangeCatalog {
  exchanges: ExchangeInfo[];
  currencyByMic: ReadonlyMap<string, string>;
  nameByMic: ReadonlyMap<string, string>;
  timezoneByMic: ReadonlyMap<string, string>;
  closeByMic: ReadonlyMap<string, readonly [number, number]>;
  yahooCodeToMic: ReadonlyMap<string, string>;
  yahooSuffixByMic: ReadonlyMap<string, string>;
  yahooSuffixToMic: ReadonlyMap<string, string>;
  alphaVantageSuffixByMic: ReadonlyMap<string, string>;
  alphaVantageCurrencyByMic: ReadonlyMap<string, string>;
}

interface AssetQuoteStateRow {
  id: string;
  quote_ccy: string;
  quote_mode: string;
  is_active: number;
  instrument_exchange_mic: string | null;
  instrument_type: string | null;
  metadata: string | null;
}

interface QuoteSyncStateRow {
  asset_id: string;
  position_closed_date: string | null;
  last_synced_at: string | null;
  data_source: string | null;
  sync_priority: number;
  error_count: number;
  last_error: string | null;
  profile_enriched_at: string | null;
  created_at: string;
  updated_at: string;
}

interface PositionStatusAssetRow {
  id: string;
  kind: string;
  quote_mode: string;
  is_active: number;
}

interface AssetMarketSyncRow {
  id: string;
  kind: string;
  display_code: string | null;
  quote_ccy: string;
  quote_mode: string;
  is_active: number;
  instrument_type: string | null;
  instrument_symbol: string | null;
  instrument_exchange_mic: string | null;
  provider_config: string | null;
  metadata: string | null;
}

interface ProviderQuoteValidationInput {
  open: string | null;
  high: string | null;
  low: string | null;
  close: string;
  volume: string | null;
}

type MarketSyncScope = "targeted" | "broad";

interface YahooHistoricalQuote {
  assetId: string;
  day: string;
  timestamp: string;
  source: string;
  open: string | null;
  high: string | null;
  low: string | null;
  close: string;
  adjclose: string | null;
  volume: string | null;
  currency: string;
}

interface CustomProviderHistoricalQuotes {
  source: string;
  quotes: QuoteWrite[];
  allowPurge: boolean;
}

interface QuoteImportAssetRow {
  id: string;
  display_code: string | null;
  instrument_exchange_mic: string | null;
}

interface AssetSearchRow {
  id: string;
  kind: string;
  name: string | null;
  display_code: string | null;
  quote_ccy: string;
  instrument_type: string | null;
  instrument_symbol: string | null;
  instrument_exchange_mic: string | null;
  instrument_key: string | null;
  provider_config: string | null;
}

interface NormalizedQuoteImport {
  symbol: string;
  displaySymbol: string | null;
  date: string;
  open: string | null;
  high: string | null;
  low: string | null;
  close: string;
  volume: string | null;
  currency: string;
  validationStatus: ImportValidationStatus;
  errorMessage: string | null;
}

interface YahooCrumbData {
  cookie: string;
  crumb: string;
}

interface YahooSearchQuoteRaw {
  symbol?: unknown;
  exchange?: unknown;
  quoteType?: unknown;
  shortname?: unknown;
  longname?: unknown;
  score?: unknown;
  currency?: unknown;
}

interface FixtureInstrument {
  symbol: string;
  aliases?: string[];
  name?: string;
  provider?: string;
  assetType?: string;
  currency?: string;
  exchange?: string;
  exchangeMic?: string;
  exchangeName?: string;
  basePrice?: number;
  baseVolume?: number;
  seed?: number;
}

interface FixtureCatalog {
  defaultAsOf?: string;
  default_as_of?: string;
  instruments?: FixtureInstrument[];
}

interface OpenFigiRecord {
  name?: unknown;
  ticker?: unknown;
  exchCode?: unknown;
  securityType?: unknown;
  marketSector?: unknown;
}

interface BoerseInstrumentIdentity {
  mic: string;
  symbol: string;
  isBond: boolean;
}

type AlphaVantageInstrument =
  | { kind: "equity"; symbol: string; currency: string }
  | { kind: "option"; symbol: string; underlying: string; currency: string }
  | { kind: "fx"; from: string; to: string; currency: string }
  | { kind: "crypto"; symbol: string; market: string; currency: string };

interface UsTreasuryBondInstrument {
  isin: string;
  maturityDate: string;
  couponRate: number;
  faceValue: number;
  couponFrequency: string;
  currency: string;
}

interface UsTreasuryYieldCurve {
  date: string;
  points: Array<{ tenorYears: number; yieldPercent: number }>;
}

class YahooUnauthorizedError extends Error {}

const MAX_SYNC_ERRORS = 10;
const MARKET_CLOSE_GRACE_MINUTES = 60;
const QUOTE_HISTORY_BUFFER_DAYS = 45;
const MIN_SYNC_LOOKBACK_DAYS = 5;
const QUANTITY_SIGNIFICANCE_THRESHOLD = new Decimal("0.00000001");
const DEFAULT_MARKET_DATA_PROVIDER = "YAHOO";
const ALPHA_VANTAGE_PROVIDER = "ALPHA_VANTAGE";
const ALPHA_VANTAGE_BASE_URL = "https://www.alphavantage.co/query";
const METAL_PRICE_API_PROVIDER = "METAL_PRICE_API";
const METAL_PRICE_API_BASE_URL = "https://api.metalpriceapi.com/v1";
const METAL_PRICE_API_SUPPORTED_METALS = new Set([
  "XAU",
  "XAG",
  "XPT",
  "XPD",
  "XRH",
  "XRU",
  "XIR",
  "XOS",
]);
const TROY_OZ_GRAMS = new Decimal("31.1034768");
const MARKETDATA_APP_PROVIDER = "MARKETDATA_APP";
const MARKETDATA_APP_BASE_URL = "https://api.marketdata.app/v1";
const FINNHUB_PROVIDER = "FINNHUB";
const FINNHUB_BASE_URL = "https://finnhub.io/api/v1";
const US_TREASURY_CALC_PROVIDER = "US_TREASURY_CALC";
const US_TREASURY_YIELD_CURVE_URL =
  "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml";
const OPENFIGI_PROVIDER = "OPENFIGI";
const OPENFIGI_MAPPING_URL = "https://api.openfigi.com/v3/mapping";
const OPENFIGI_SEARCH_URL = "https://api.openfigi.com/v3/search";
const OPENFIGI_BOND_MARKET_SECTORS = new Set(["Corp", "Govt", "Mtge", "Muni", "Pfd"]);
const BOERSE_FRANKFURT_PROVIDER = "BOERSE_FRANKFURT";
const BOERSE_FRANKFURT_BASE_URL = "https://api.live.deutsche-boerse.com/v1";
const BOERSE_FRANKFURT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const CUSTOM_SCRAPER_PROVIDER = "CUSTOM_SCRAPER";
const CUSTOM_PROVIDER_ISO_DATE_RE = /^(\d{4}-\d{2}-\d{2})$/;
const CUSTOM_PROVIDER_RFC3339_DATETIME_RE =
  /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const CUSTOM_PROVIDER_NAIVE_DATETIME_RE =
  /^(\d{4}-\d{2}-\d{2})[T ](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?$/;
const MINOR_CURRENCY_MAJOR: Record<string, string> = {
  GBp: "GBP",
  GBX: "GBP",
  KWF: "KWD",
  ZAc: "ZAR",
  ZAC: "ZAR",
  ILA: "ILS",
  USX: "USD",
};

export function createMarketDataService(
  db: Database,
  options: MarketDataServiceOptions = {},
): MarketDataService {
  const exchangeCatalog = options.exchangeCatalogJson
    ? parseExchangeCatalog(options.exchangeCatalogJson)
    : emptyExchangeCatalog();
  const quoteSyncStateExists = tableExists(db, "quote_sync_state");
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  let yahooCrumb: YahooCrumbData | null = null;
  const usTreasuryCurveCache = new Map<number, UsTreasuryYieldCurve[]>();

  return {
    getExchanges() {
      return exchangeCatalog.exchanges;
    },

    searchSymbol(query) {
      return searchSymbols(db, query, exchangeCatalog, fetchImpl, options.secretService);
    },

    resolveSymbolQuote(request) {
      return resolveSymbolQuote(
        db,
        request,
        exchangeCatalog,
        fetchImpl,
        {
          get: () => yahooCrumb,
          set: (crumb) => {
            yahooCrumb = crumb;
          },
          clear: () => {
            yahooCrumb = null;
          },
        },
        options.customProviderService,
        options.secretService,
        usTreasuryCurveCache,
        now(),
      );
    },

    getQuoteHistory(symbol) {
      return db
        .query<QuoteRow, [string]>(
          `
            SELECT *
            FROM quotes
            WHERE asset_id = ?
            ORDER BY day DESC
          `,
        )
        .all(symbol)
        .map(rowToQuote);
    },

    getLatestQuotes(assetIds) {
      return latestQuoteSnapshots(
        db,
        dedupe(assetIds),
        exchangeCatalog,
        quoteSyncStateExists,
        now(),
      );
    },

    getQuoteSyncErrorSnapshots() {
      return quoteSyncStateExists ? quoteSyncErrorSnapshots(db) : [];
    },

    fetchYahooDividends(symbol) {
      return fetchYahooDividends(symbol, fetchImpl, now(), {
        get: () => yahooCrumb,
        set: (crumb) => {
          yahooCrumb = crumb;
        },
        clear: () => {
          yahooCrumb = null;
        },
      });
    },

    updateQuote(symbol, quote) {
      const payload = normalizeQuoteWrite(symbol, quote);
      db.transaction(() => {
        if (payload.source === "MANUAL") {
          const oldId = optionalString(quote.id);
          if (oldId && oldId !== payload.id) {
            deleteQuoteWrite(db, oldId, options.queueQuoteSyncEvent);
          }
        }
        upsertQuoteWrite(db, payload, options.queueQuoteSyncEvent);
      })();
    },

    deleteQuote(id) {
      db.transaction(() => {
        deleteQuoteWrite(db, id, options.queueQuoteSyncEvent);
      })();
    },

    checkQuotesImport(content, hasHeaderRow) {
      return checkQuoteImports(db, content, hasHeaderRow, exchangeCatalog);
    },

    importQuotesCsv(quotes, overwriteExisting) {
      return importQuoteRows(db, quotes, overwriteExisting, options.queueQuoteSyncEvent);
    },

    async syncHistoryQuotes() {
      return syncMarketDataExecution(
        db,
        { type: "backfill_history", asset_ids: null, days: DEFAULT_HISTORY_DAYS },
        exchangeCatalog,
        fetchImpl,
        {
          get: () => yahooCrumb,
          set: (crumb) => {
            yahooCrumb = crumb;
          },
          clear: () => {
            yahooCrumb = null;
          },
        },
        now(),
        quoteSyncStateExists,
        options.customProviderService,
        options.secretService,
        usTreasuryCurveCache,
      );
    },

    async syncMarketData(marketSyncMode) {
      const currentTime = now();
      validateMarketSyncModeDays(marketSyncMode, currentTime);
      if (!marketDataSyncRequiresExecution(marketSyncMode)) {
        return emptyMarketDataSyncResult();
      }
      return syncMarketDataExecution(
        db,
        marketSyncMode,
        exchangeCatalog,
        fetchImpl,
        {
          get: () => yahooCrumb,
          set: (crumb) => {
            yahooCrumb = crumb;
          },
          clear: () => {
            yahooCrumb = null;
          },
        },
        currentTime,
        quoteSyncStateExists,
        options.customProviderService,
        options.secretService,
        usTreasuryCurveCache,
      );
    },

    updatePositionStatusFromHoldings(currentHoldings) {
      updatePositionStatusFromHoldings(db, quoteSyncStateExists, currentHoldings, now);
    },
  };
}

function validateMarketSyncModeDays(marketSyncMode: MarketSyncMode, currentTime: Date): void {
  if (marketSyncMode.type !== "refetch_recent" && marketSyncMode.type !== "backfill_history") {
    return;
  }
  if (!marketDataDaysSupported(marketSyncMode.days, currentTime)) {
    throw new Error("Invalid input: days is outside supported date range");
  }
}

function marketDataDaysSupported(days: number, currentTime: Date): boolean {
  if (!Number.isInteger(days)) {
    return false;
  }
  const endDate = isoDate(currentTime);
  return (
    marketDataStartDateSupported(endDate, days) &&
    marketDataStartDateSupported(addDays(endDate, -7), days)
  );
}

function marketDataStartDateSupported(endDate: string, days: number): boolean {
  try {
    const startDate = addDays(endDate, -days);
    return isIsoDate(startDate);
  } catch {
    return false;
  }
}

function marketDataSyncRequiresExecution(marketSyncMode: MarketSyncMode): boolean {
  if (marketSyncMode.type === "none") {
    return false;
  }
  return !Array.isArray(marketSyncMode.asset_ids) || marketSyncMode.asset_ids.length > 0;
}

function emptyMarketDataSyncResult(): MarketDataSyncResult {
  return {
    synced: 0,
    failed: 0,
    skipped: 0,
    quotesSynced: 0,
    failures: [],
    skippedReasons: [],
  };
}

function addMarketSyncFailure(
  result: MarketDataSyncResult,
  assetLabel: string,
  message: string,
): void {
  result.failed += 1;
  result.failures.push([assetLabel, message]);
}

function addMarketSyncSkip(result: MarketDataSyncResult, assetId: string, reason: string): void {
  result.skipped += 1;
  result.skippedReasons.push([assetId, reason]);
}

function validatedProviderQuoteWrite(asset: AssetMarketSyncRow, quote: QuoteWrite): QuoteWrite {
  const error = providerQuoteValidationError(asset.instrument_type, quote);
  if (error !== null) {
    throw new Error(`Quote validation failed: ${error}`);
  }
  return quote;
}

function validatedProviderQuoteWrites(
  asset: AssetMarketSyncRow,
  quotes: QuoteWrite[],
): QuoteWrite[] {
  const validQuotes = quotes.filter(
    (quote) => providerQuoteValidationError(asset.instrument_type, quote) === null,
  );
  if (validQuotes.length === 0 && quotes.length > 0) {
    throw new Error("All quotes failed validation");
  }
  return validQuotes;
}

function resolvedProviderQuoteFromHistoricalQuote(
  instrumentType: string | null | undefined,
  quote: YahooHistoricalQuote,
  resolvedProviderId: string,
): ResolvedQuote {
  const error = providerQuoteValidationError(instrumentType, quote);
  if (error !== null) {
    throw new Error(`Quote validation failed: ${error}`);
  }
  return {
    currency: quote.currency,
    price: quote.close === "0" ? null : Number(quote.close),
    resolvedProviderId,
  };
}

function validateResolvedProviderQuote(
  instrumentType: string | null | undefined,
  quote: ResolvedQuote,
): ResolvedQuote {
  if (quote.price === null) {
    return quote;
  }
  const error = providerQuoteValidationError(instrumentType, {
    open: null,
    high: null,
    low: null,
    close: storedNumber(quote.price),
    volume: null,
  });
  if (error !== null) {
    throw new Error(`Quote validation failed: ${error}`);
  }
  return quote;
}

function providerQuoteValidationInputFromCustomResult(
  result: TestSourceResult,
): ProviderQuoteValidationInput {
  return {
    open: result.open === null ? null : storedNumber(result.open),
    high: result.high === null ? null : storedNumber(result.high),
    low: result.low === null ? null : storedNumber(result.low),
    close: storedNumber(result.price ?? 0),
    volume: result.volume === null ? null : storedNumber(result.volume),
  };
}

function providerQuoteValidationError(
  instrumentType: string | null | undefined,
  quote: ProviderQuoteValidationInput,
): string | null {
  const errors: string[] = [];
  if (compareDecimals(quote.close, "0") < 0) {
    errors.push(`Negative close price: ${quote.close}`);
  }

  const hasOhlc = quote.open !== null || quote.high !== null || quote.low !== null;
  if (hasOhlc) {
    const open = quote.open ?? quote.close;
    const high = quote.high ?? quote.close;
    const low = quote.low ?? quote.close;
    if (compareDecimals(high, low) < 0) {
      errors.push(`High (${high}) is less than Low (${low})`);
    }
    if (compareDecimals(high, "0") < 0) {
      errors.push(`Negative high price: ${high}`);
    }
    if (compareDecimals(low, "0") < 0) {
      errors.push(`Negative low price: ${low}`);
    }
    if (compareDecimals(open, "0") < 0) {
      errors.push(`Negative open price: ${open}`);
    }
  }

  if (
    instrumentType?.toUpperCase() !== "FX" &&
    quote.volume !== null &&
    compareDecimals(quote.volume, "0") < 0
  ) {
    errors.push(`Negative volume: ${quote.volume}`);
  }

  return errors.length > 0 ? errors.join("; ") : null;
}

async function syncMarketDataExecution(
  db: Database,
  marketSyncMode: MarketSyncMode,
  exchangeCatalog: ExchangeCatalog,
  fetchImpl: typeof fetch,
  crumbCache: {
    get: () => YahooCrumbData | null;
    set: (crumb: YahooCrumbData) => void;
    clear: () => void;
  },
  now: Date,
  quoteSyncStateExists: boolean,
  customProviderService: MarketDataCustomProviderService | undefined,
  secretService: SecretService | undefined,
  usTreasuryCurveCache: Map<number, UsTreasuryYieldCurve[]>,
): Promise<MarketDataSyncResult> {
  const result = emptyMarketDataSyncResult();
  if (marketSyncMode.type === "none") {
    return result;
  }
  const scope: MarketSyncScope = marketSyncMode.asset_ids === null ? "broad" : "targeted";
  const assetIds =
    marketSyncMode.asset_ids === null
      ? readBroadMarketSyncAssetIds(db, marketSyncMode)
      : dedupe(marketSyncMode.asset_ids);
  if (assetIds.length === 0) {
    return result;
  }

  const assets = readAssetsForMarketSync(db, assetIds);
  const states = quoteSyncStateExists ? readQuoteSyncStates(db, assetIds) : new Map();
  const boerseIsinCache = new Map<string, string>();

  for (const assetId of assetIds) {
    const asset = assets.get(assetId);
    if (!asset) {
      addMarketSyncSkip(result, assetId, "Asset not found");
      continue;
    }
    const skipReason = marketSyncAssetSkipReason(asset, marketSyncMode, scope);
    if (skipReason) {
      addMarketSyncSkip(result, asset.id, skipReason);
      continue;
    }

    const state = states.get(asset.id) ?? null;
    const provider = quoteFetchProvider(effectiveMarketDataProvider(state, asset), asset);
    const customProviderCode = customProviderCodeForMarketSync(asset.provider_config);
    if (isCustomProviderSync(provider)) {
      const quoteSource = customProviderCode
        ? `${CUSTOM_SCRAPER_PROVIDER}:${customProviderCode}`
        : provider.startsWith(`${CUSTOM_SCRAPER_PROVIDER}:`)
          ? provider
          : CUSTOM_SCRAPER_PROVIDER;
      const customSymbol = customProviderCode
        ? customProviderSyncSymbol(asset, customProviderCode)
        : optionalString(asset.instrument_symbol);
      if (marketSyncMode.type === "backfill_history") {
        if (customSymbol === null) {
          updateQuoteSyncStateAfterFailure(
            db,
            quoteSyncStateExists,
            asset.id,
            quoteSource,
            "Asset cannot be mapped to a custom provider symbol",
          );
          addMarketSyncFailure(
            result,
            marketSyncResultAssetLabel(asset),
            "Asset cannot be mapped to a custom provider symbol",
          );
          continue;
        }
        const { startDate, endDate, purgeProviderQuotes } = marketSyncWindow(
          db,
          asset,
          quoteSource,
          marketSyncMode,
          now,
          exchangeCatalog,
          { scope, state },
        );
        if (startDate > endDate) {
          updateQuoteSyncStateAfterSync(db, quoteSyncStateExists, asset.id, quoteSource);
          addMarketSyncSkip(result, asset.id, "No quote refresh needed");
          continue;
        }
        try {
          const historicalQuotes = customProviderCode
            ? await fetchCustomProviderHistoricalQuotes(
                asset,
                customProviderCode,
                customSymbol,
                customProviderService,
                startDate,
                endDate,
                now,
              )
            : await fetchGeneralPurposeCustomProviderHistoricalQuotes(
                asset,
                customProviderService,
                startDate,
                endDate,
                now,
              );
          const validQuotes = validatedProviderQuoteWrites(asset, historicalQuotes.quotes);
          db.transaction(() => {
            if (purgeProviderQuotes && historicalQuotes.allowPurge && validQuotes.length > 0) {
              deleteProviderQuotesForAsset(db, asset.id, historicalQuotes.source);
            }
            for (const quote of validQuotes) {
              upsertQuoteWrite(db, quote, undefined);
            }
            updateQuoteSyncStateAfterSync(
              db,
              quoteSyncStateExists,
              asset.id,
              historicalQuotes.source,
            );
          })();
          result.synced += 1;
          result.quotesSynced += validQuotes.length;
        } catch (error) {
          const message = errorMessage(error);
          updateQuoteSyncStateAfterFailure(
            db,
            quoteSyncStateExists,
            asset.id,
            quoteSource,
            message,
          );
          addMarketSyncFailure(result, marketSyncResultAssetLabel(asset), message);
        }
        continue;
      }
      if (quoteSyncErrorCount(state, quoteSource) >= MAX_SYNC_ERRORS) {
        addMarketSyncSkip(result, asset.id, "Too many consecutive sync failures");
        continue;
      }
      if (customSymbol === null) {
        updateQuoteSyncStateAfterFailure(
          db,
          quoteSyncStateExists,
          asset.id,
          quoteSource,
          "Asset cannot be mapped to a custom provider symbol",
        );
        addMarketSyncFailure(
          result,
          marketSyncResultAssetLabel(asset),
          "Asset cannot be mapped to a custom provider symbol",
        );
        continue;
      }
      try {
        const quote = validatedProviderQuoteWrite(
          asset,
          await fetchCustomProviderSyncQuote(
            asset,
            customProviderCode,
            customSymbol,
            customProviderService,
            now,
          ),
        );
        db.transaction(() => {
          upsertQuoteWrite(db, quote, undefined);
          updateQuoteSyncStateAfterSync(db, quoteSyncStateExists, asset.id, quote.source);
        })();
        result.synced += 1;
        result.quotesSynced += 1;
      } catch (error) {
        const message = errorMessage(error);
        updateQuoteSyncStateAfterFailure(db, quoteSyncStateExists, asset.id, quoteSource, message);
        addMarketSyncFailure(result, marketSyncResultAssetLabel(asset), message);
      }
      continue;
    }
    if (provider === US_TREASURY_CALC_PROVIDER) {
      const { startDate, endDate, purgeProviderQuotes } = marketSyncWindow(
        db,
        asset,
        provider,
        marketSyncMode,
        now,
        exchangeCatalog,
        {
          scope,
          state,
        },
      );
      if (startDate > endDate) {
        updateQuoteSyncStateAfterSync(db, quoteSyncStateExists, asset.id, provider);
        addMarketSyncSkip(result, asset.id, "No quote refresh needed");
        continue;
      }
      if (
        marketSyncMode.type !== "backfill_history" &&
        quoteSyncErrorCount(state, provider) >= MAX_SYNC_ERRORS
      ) {
        addMarketSyncSkip(result, asset.id, "Too many consecutive sync failures");
        continue;
      }

      const instrument = usTreasuryInstrumentForAsset(asset, exchangeCatalog);
      if (instrument === null) {
        const message = usTreasuryInstrumentFailureMessage(asset);
        updateQuoteSyncStateAfterFailure(db, quoteSyncStateExists, asset.id, provider, message);
        addMarketSyncFailure(result, marketSyncResultAssetLabel(asset), message);
        continue;
      }

      try {
        const quotes = await fetchUsTreasuryHistoricalQuotes(
          asset.id,
          instrument,
          startDate,
          endDate,
          fetchImpl,
          usTreasuryCurveCache,
        );
        const validQuotes = validatedProviderQuoteWrites(
          asset,
          quotes.map(historicalQuoteToQuoteWrite),
        );
        db.transaction(() => {
          if (purgeProviderQuotes && validQuotes.length > 0) {
            deleteProviderQuotesForAsset(db, asset.id, provider);
          }
          for (const quote of validQuotes) {
            upsertQuoteWrite(db, quote, undefined);
          }
          updateQuoteSyncStateAfterSync(db, quoteSyncStateExists, asset.id, provider);
        })();
        result.synced += 1;
        result.quotesSynced += validQuotes.length;
      } catch (error) {
        const message = errorMessage(error);
        updateQuoteSyncStateAfterFailure(db, quoteSyncStateExists, asset.id, provider, message);
        addMarketSyncFailure(result, marketSyncResultAssetLabel(asset), message);
      }
      continue;
    }
    if (provider === ALPHA_VANTAGE_PROVIDER) {
      const { startDate, endDate, purgeProviderQuotes } = marketSyncWindow(
        db,
        asset,
        provider,
        marketSyncMode,
        now,
        exchangeCatalog,
        {
          scope,
          state,
        },
      );
      if (startDate > endDate) {
        updateQuoteSyncStateAfterSync(db, quoteSyncStateExists, asset.id, provider);
        addMarketSyncSkip(result, asset.id, "No quote refresh needed");
        continue;
      }
      if (
        marketSyncMode.type !== "backfill_history" &&
        quoteSyncErrorCount(state, provider) >= MAX_SYNC_ERRORS
      ) {
        addMarketSyncSkip(result, asset.id, "Too many consecutive sync failures");
        continue;
      }

      const apiKey = await marketDataProviderApiKey(secretService, provider);
      const instrument = alphaVantageInstrumentForAsset(asset, exchangeCatalog);
      const failureMessage =
        apiKey === null
          ? `${provider} API key not configured`
          : instrument === null
            ? "Asset cannot be mapped to an Alpha Vantage symbol"
            : null;
      if (failureMessage !== null || apiKey === null || instrument === null) {
        const message = failureMessage ?? "Asset cannot be mapped to an Alpha Vantage symbol";
        updateQuoteSyncStateAfterFailure(db, quoteSyncStateExists, asset.id, provider, message);
        addMarketSyncFailure(result, marketSyncResultAssetLabel(asset), message);
        continue;
      }

      try {
        const quotes = await fetchAlphaVantageHistoricalQuotes(
          asset.id,
          instrument,
          startDate,
          endDate,
          fetchImpl,
          apiKey,
        );
        const validQuotes = validatedProviderQuoteWrites(
          asset,
          quotes.map(historicalQuoteToQuoteWrite),
        );
        db.transaction(() => {
          if (purgeProviderQuotes && validQuotes.length > 0) {
            deleteProviderQuotesForAsset(db, asset.id, provider);
          }
          for (const quote of validQuotes) {
            upsertQuoteWrite(db, quote, undefined);
          }
          updateQuoteSyncStateAfterSync(db, quoteSyncStateExists, asset.id, provider);
        })();
        result.synced += 1;
        result.quotesSynced += validQuotes.length;
      } catch (error) {
        const message = errorMessage(error);
        updateQuoteSyncStateAfterFailure(db, quoteSyncStateExists, asset.id, provider, message);
        addMarketSyncFailure(result, marketSyncResultAssetLabel(asset), message);
      }
      continue;
    }
    if (provider === METAL_PRICE_API_PROVIDER) {
      const { startDate, endDate, purgeProviderQuotes } = marketSyncWindow(
        db,
        asset,
        provider,
        marketSyncMode,
        now,
        exchangeCatalog,
        {
          scope,
          state,
        },
      );
      if (startDate > endDate) {
        updateQuoteSyncStateAfterSync(db, quoteSyncStateExists, asset.id, provider);
        addMarketSyncSkip(result, asset.id, "No quote refresh needed");
        continue;
      }
      if (
        marketSyncMode.type !== "backfill_history" &&
        quoteSyncErrorCount(state, provider) >= MAX_SYNC_ERRORS
      ) {
        addMarketSyncSkip(result, asset.id, "Too many consecutive sync failures");
        continue;
      }

      const apiKey = await marketDataProviderApiKey(secretService, provider);
      const instrument = metalPriceApiInstrumentForAsset(asset);
      const failureMessage =
        apiKey === null
          ? `${provider} API key not configured`
          : instrument === null
            ? "Asset cannot be mapped to a Metal Price API symbol"
            : null;
      if (failureMessage !== null || apiKey === null || instrument === null) {
        const message = failureMessage ?? "Asset cannot be mapped to a Metal Price API symbol";
        updateQuoteSyncStateAfterFailure(db, quoteSyncStateExists, asset.id, provider, message);
        addMarketSyncFailure(result, marketSyncResultAssetLabel(asset), message);
        continue;
      }

      try {
        const quotes = await fetchMetalPriceApiHistoricalQuotes(
          asset.id,
          instrument,
          startDate,
          endDate,
          fetchImpl,
          apiKey,
        );
        const validQuotes = validatedProviderQuoteWrites(
          asset,
          quotes.map(historicalQuoteToQuoteWrite),
        );
        db.transaction(() => {
          if (purgeProviderQuotes && validQuotes.length > 0) {
            deleteProviderQuotesForAsset(db, asset.id, provider);
          }
          for (const quote of validQuotes) {
            upsertQuoteWrite(db, quote, undefined);
          }
          updateQuoteSyncStateAfterSync(db, quoteSyncStateExists, asset.id, provider);
        })();
        result.synced += 1;
        result.quotesSynced += validQuotes.length;
      } catch (error) {
        const message = errorMessage(error);
        updateQuoteSyncStateAfterFailure(db, quoteSyncStateExists, asset.id, provider, message);
        addMarketSyncFailure(result, marketSyncResultAssetLabel(asset), message);
      }
      continue;
    }
    if (provider === MARKETDATA_APP_PROVIDER) {
      const { startDate, endDate, purgeProviderQuotes } = marketSyncWindow(
        db,
        asset,
        provider,
        marketSyncMode,
        now,
        exchangeCatalog,
        {
          scope,
          state,
        },
      );
      if (startDate > endDate) {
        updateQuoteSyncStateAfterSync(db, quoteSyncStateExists, asset.id, provider);
        addMarketSyncSkip(result, asset.id, "No quote refresh needed");
        continue;
      }
      if (
        marketSyncMode.type !== "backfill_history" &&
        quoteSyncErrorCount(state, provider) >= MAX_SYNC_ERRORS
      ) {
        addMarketSyncSkip(result, asset.id, "Too many consecutive sync failures");
        continue;
      }

      const apiKey = await marketDataProviderApiKey(secretService, provider);
      const symbol = marketDataAppSyncSymbol(asset);
      const failureMessage =
        apiKey === null
          ? `${provider} API key not configured`
          : asset.instrument_type?.toUpperCase() !== "EQUITY"
            ? "MarketData.app only supports equities"
            : symbol === null
              ? "Asset cannot be mapped to a MarketData.app symbol"
              : null;
      if (failureMessage !== null || apiKey === null || symbol === null) {
        const message = failureMessage ?? "Asset cannot be mapped to a MarketData.app symbol";
        updateQuoteSyncStateAfterFailure(db, quoteSyncStateExists, asset.id, provider, message);
        addMarketSyncFailure(result, marketSyncResultAssetLabel(asset), message);
        continue;
      }

      try {
        const quotes = await fetchMarketDataAppHistoricalQuotes(
          asset,
          symbol,
          providerCurrencyFromExchange(
            asset.instrument_exchange_mic,
            asset.quote_ccy,
            exchangeCatalog,
          ),
          startDate,
          endDate,
          fetchImpl,
          apiKey,
          now,
        );
        const validQuotes = validatedProviderQuoteWrites(
          asset,
          quotes.map(historicalQuoteToQuoteWrite),
        );
        db.transaction(() => {
          if (purgeProviderQuotes && validQuotes.length > 0) {
            deleteProviderQuotesForAsset(db, asset.id, provider);
          }
          for (const quote of validQuotes) {
            upsertQuoteWrite(db, quote, undefined);
          }
          updateQuoteSyncStateAfterSync(db, quoteSyncStateExists, asset.id, provider);
        })();
        result.synced += 1;
        result.quotesSynced += validQuotes.length;
      } catch (error) {
        const message = errorMessage(error);
        updateQuoteSyncStateAfterFailure(db, quoteSyncStateExists, asset.id, provider, message);
        addMarketSyncFailure(result, marketSyncResultAssetLabel(asset), message);
      }
      continue;
    }
    if (provider === FINNHUB_PROVIDER) {
      const { startDate, endDate, purgeProviderQuotes } = marketSyncWindow(
        db,
        asset,
        provider,
        marketSyncMode,
        now,
        exchangeCatalog,
        {
          scope,
          state,
        },
      );
      if (startDate > endDate) {
        updateQuoteSyncStateAfterSync(db, quoteSyncStateExists, asset.id, provider);
        addMarketSyncSkip(result, asset.id, "No quote refresh needed");
        continue;
      }
      if (
        marketSyncMode.type !== "backfill_history" &&
        quoteSyncErrorCount(state, provider) >= MAX_SYNC_ERRORS
      ) {
        addMarketSyncSkip(result, asset.id, "Too many consecutive sync failures");
        continue;
      }

      const apiKey = await marketDataProviderApiKey(secretService, provider);
      const symbol = finnhubSyncSymbol(asset);
      const failureMessage =
        apiKey === null
          ? `${provider} API key not configured`
          : symbol === null
            ? "Asset cannot be mapped to a Finnhub symbol"
            : null;
      if (failureMessage !== null || apiKey === null || symbol === null) {
        const message = failureMessage ?? "Asset cannot be mapped to a Finnhub symbol";
        updateQuoteSyncStateAfterFailure(db, quoteSyncStateExists, asset.id, provider, message);
        addMarketSyncFailure(result, marketSyncResultAssetLabel(asset), message);
        continue;
      }

      try {
        const quotes = await fetchFinnhubHistoricalQuotes(
          asset,
          symbol,
          providerCurrencyFromExchange(
            asset.instrument_exchange_mic,
            asset.quote_ccy,
            exchangeCatalog,
          ),
          startDate,
          endDate,
          fetchImpl,
          apiKey,
        );
        const validQuotes = validatedProviderQuoteWrites(
          asset,
          quotes.map(historicalQuoteToQuoteWrite),
        );
        db.transaction(() => {
          if (purgeProviderQuotes && validQuotes.length > 0) {
            deleteProviderQuotesForAsset(db, asset.id, provider);
          }
          for (const quote of validQuotes) {
            upsertQuoteWrite(db, quote, undefined);
          }
          updateQuoteSyncStateAfterSync(db, quoteSyncStateExists, asset.id, provider);
        })();
        result.synced += 1;
        result.quotesSynced += validQuotes.length;
      } catch (error) {
        const message = errorMessage(error);
        updateQuoteSyncStateAfterFailure(db, quoteSyncStateExists, asset.id, provider, message);
        addMarketSyncFailure(result, marketSyncResultAssetLabel(asset), message);
      }
      continue;
    }
    if (provider === BOERSE_FRANKFURT_PROVIDER) {
      if (
        marketSyncMode.type !== "backfill_history" &&
        quoteSyncErrorCount(state, provider) >= MAX_SYNC_ERRORS
      ) {
        addMarketSyncSkip(result, asset.id, "Too many consecutive sync failures");
        continue;
      }

      const { startDate, endDate, purgeProviderQuotes } = marketSyncWindow(
        db,
        asset,
        provider,
        marketSyncMode,
        now,
        exchangeCatalog,
        {
          scope,
          state,
        },
      );
      if (startDate > endDate) {
        updateQuoteSyncStateAfterSync(db, quoteSyncStateExists, asset.id, provider);
        addMarketSyncSkip(result, asset.id, "No quote refresh needed");
        continue;
      }

      try {
        const identity = boerseInstrumentIdentity(asset);
        const quotes = await fetchBoerseHistoricalQuotes(
          asset,
          identity,
          startDate,
          endDate,
          fetchImpl,
          boerseIsinCache,
        );
        const validQuotes = validatedProviderQuoteWrites(
          asset,
          quotes.map(historicalQuoteToQuoteWrite),
        );
        db.transaction(() => {
          if (purgeProviderQuotes && validQuotes.length > 0) {
            deleteProviderQuotesForAsset(db, asset.id, provider);
          }
          for (const quote of validQuotes) {
            upsertQuoteWrite(db, quote, undefined);
          }
          updateQuoteSyncStateAfterSync(db, quoteSyncStateExists, asset.id, provider);
        })();
        result.synced += 1;
        result.quotesSynced += validQuotes.length;
      } catch (error) {
        const message = errorMessage(error);
        updateQuoteSyncStateAfterFailure(db, quoteSyncStateExists, asset.id, provider, message);
        addMarketSyncFailure(result, marketSyncResultAssetLabel(asset), message);
      }
      continue;
    }
    if (provider !== DEFAULT_MARKET_DATA_PROVIDER) {
      addMarketSyncSkip(result, asset.id, `Provider not implemented: ${provider}`);
      continue;
    }
    if (
      marketSyncMode.type !== "backfill_history" &&
      quoteSyncErrorCount(state, provider) >= MAX_SYNC_ERRORS
    ) {
      addMarketSyncSkip(result, asset.id, "Too many consecutive sync failures");
      continue;
    }

    const yahooSymbol = yahooSyncSymbol(asset, exchangeCatalog);
    if (yahooSymbol === null) {
      updateQuoteSyncStateAfterFailure(
        db,
        quoteSyncStateExists,
        asset.id,
        provider,
        "Asset cannot be mapped to a Yahoo symbol",
      );
      addMarketSyncFailure(
        result,
        marketSyncResultAssetLabel(asset),
        "Asset cannot be mapped to a Yahoo symbol",
      );
      continue;
    }

    const { startDate, endDate, purgeProviderQuotes } = marketSyncWindow(
      db,
      asset,
      provider,
      marketSyncMode,
      now,
      exchangeCatalog,
      {
        scope,
        state,
      },
    );
    if (startDate > endDate) {
      updateQuoteSyncStateAfterSync(db, quoteSyncStateExists, asset.id, provider);
      addMarketSyncSkip(result, asset.id, "No quote refresh needed");
      continue;
    }

    try {
      const quotes = await fetchYahooHistoricalQuotes(
        yahooSymbol,
        asset.id,
        asset.quote_ccy,
        startDate,
        endDate,
        fetchImpl,
        crumbCache,
      );
      const validQuotes = validatedProviderQuoteWrites(
        asset,
        quotes.map(historicalQuoteToQuoteWrite),
      );

      db.transaction(() => {
        if (purgeProviderQuotes && validQuotes.length > 0) {
          deleteProviderQuotesForAsset(db, asset.id, provider);
        }
        for (const quote of validQuotes) {
          upsertQuoteWrite(db, quote, undefined);
        }
        updateQuoteSyncStateAfterSync(db, quoteSyncStateExists, asset.id, provider);
      })();
      result.synced += 1;
      result.quotesSynced += validQuotes.length;
    } catch (error) {
      const message = errorMessage(error);
      updateQuoteSyncStateAfterFailure(db, quoteSyncStateExists, asset.id, provider, message);
      addMarketSyncFailure(result, marketSyncResultAssetLabel(asset), message);
    }
  }
  return result;
}

export function parseExchangeList(json: string): ExchangeInfo[] {
  return parseExchangeCatalog(json).exchanges;
}

function parseExchangeCatalog(json: string): ExchangeCatalog {
  const parsed: unknown = JSON.parse(json);
  if (!isRecord(parsed) || !Array.isArray(parsed.exchanges)) {
    throw new Error("Invalid exchange metadata catalog");
  }
  const exchanges: ExchangeInfo[] = [];
  const currencyByMic = new Map<string, string>();
  const nameByMic = new Map<string, string>();
  const timezoneByMic = new Map<string, string>();
  const closeByMic = new Map<string, readonly [number, number]>();
  const yahooCodeToMic = new Map<string, string>();
  const yahooSuffixByMic = new Map<string, string>();
  const suffixToMicCandidates = new Map<string, string>();
  const ambiguousSuffixes = new Set<string>();
  const alphaVantageSuffixByMic = new Map<string, string>();
  const alphaVantageCurrencyByMic = new Map<string, string>();
  for (const entry of parsed.exchanges) {
    if (!isRecord(entry) || typeof entry.mic !== "string") {
      continue;
    }
    const mic = entry.mic.toUpperCase();
    yahooCodeToMic.set(mic, mic);
    if (typeof entry.timezone === "string") {
      timezoneByMic.set(mic, entry.timezone);
    }
    if (
      Array.isArray(entry.close) &&
      typeof entry.close[0] === "number" &&
      typeof entry.close[1] === "number"
    ) {
      closeByMic.set(mic, [entry.close[0], entry.close[1]]);
    }
    if (typeof entry.name === "string" && typeof entry.currency === "string") {
      nameByMic.set(mic, entry.name);
      currencyByMic.set(mic, entry.currency);
      exchanges.push({
        mic: entry.mic,
        name: entry.name,
        longName: typeof entry.long_name === "string" ? entry.long_name : entry.name,
        currency: entry.currency,
      });
    }
    if (isRecord(entry.yahoo)) {
      if (Array.isArray(entry.yahoo.codes)) {
        for (const code of entry.yahoo.codes) {
          if (typeof code !== "string" || code.trim() === "") {
            continue;
          }
          yahooCodeToMic.set(code.trim().toUpperCase(), mic);
        }
      }
    }
    if (isRecord(entry.yahoo) && typeof entry.yahoo.suffix === "string") {
      const suffix = entry.yahoo.suffix.trim().replace(/^\./, "");
      if (suffix) {
        yahooSuffixByMic.set(mic, suffix);
        const suffixKey = suffix.toUpperCase();
        if (!ambiguousSuffixes.has(suffixKey)) {
          const existing = suffixToMicCandidates.get(suffixKey);
          if (existing && existing !== mic) {
            suffixToMicCandidates.delete(suffixKey);
            ambiguousSuffixes.add(suffixKey);
          } else {
            suffixToMicCandidates.set(suffixKey, mic);
          }
        }
      }
    }
    if (isRecord(entry.alpha_vantage)) {
      if (typeof entry.alpha_vantage.suffix === "string") {
        alphaVantageSuffixByMic.set(mic, entry.alpha_vantage.suffix.trim());
      }
      const alphaCurrency =
        typeof entry.alpha_vantage.currency === "string"
          ? entry.alpha_vantage.currency.trim()
          : typeof entry.currency === "string"
            ? entry.currency.trim()
            : "";
      if (alphaCurrency) {
        alphaVantageCurrencyByMic.set(mic, alphaCurrency);
      }
    }
  }
  return {
    exchanges,
    currencyByMic,
    nameByMic,
    timezoneByMic,
    closeByMic,
    yahooCodeToMic,
    yahooSuffixByMic,
    yahooSuffixToMic: suffixToMicCandidates,
    alphaVantageSuffixByMic,
    alphaVantageCurrencyByMic,
  };
}

function emptyExchangeCatalog(): ExchangeCatalog {
  return {
    exchanges: [],
    currencyByMic: new Map(),
    nameByMic: new Map(),
    timezoneByMic: new Map(),
    closeByMic: new Map(),
    yahooCodeToMic: new Map(),
    yahooSuffixByMic: new Map(),
    yahooSuffixToMic: new Map(),
    alphaVantageSuffixByMic: new Map(),
    alphaVantageCurrencyByMic: new Map(),
  };
}

let fixtureCatalogCache: { dir: string; catalog: FixtureCatalog } | null = null;

function e2eFixtureCatalog(): FixtureCatalog | null {
  if (process.env.WEALTHFOLIO_E2E !== "1") {
    return null;
  }
  const fixtureDir = process.env.WEALTHFOLIO_FIXTURE_DIR?.trim();
  if (!fixtureDir) {
    throw new Error("WEALTHFOLIO_FIXTURE_DIR must be set when WEALTHFOLIO_E2E=1");
  }
  if (fixtureCatalogCache?.dir === fixtureDir) {
    return fixtureCatalogCache.catalog;
  }
  const catalog = JSON.parse(
    readFileSync(join(fixtureDir, "instruments.json"), "utf8"),
  ) as FixtureCatalog;
  fixtureCatalogCache = { dir: fixtureDir, catalog };
  return catalog;
}

function e2eFixtureAsOf(catalog: FixtureCatalog): Date {
  const configured = process.env.WEALTHFOLIO_FIXTURE_AS_OF?.trim();
  const date =
    configured && configured !== "today"
      ? configured
      : configured === "today"
        ? new Date().toISOString().slice(0, 10)
        : (catalog.defaultAsOf ?? catalog.default_as_of ?? "2026-05-12");
  return new Date(`${date}T16:00:00.000Z`);
}

function parseFixtureFxPair(symbol: string): { base: string; quote: string } | null {
  const upper = symbol.trim().toUpperCase();
  if (!upper.startsWith("FX:") && !upper.endsWith("=X") && !upper.includes("/")) {
    return null;
  }
  const compact = upper
    .replace(/^FX:/, "")
    .replace(/=X$/, "")
    .replace("/", "")
    .replace(/[^A-Z]/g, "");
  return compact.length === 6 ? { base: compact.slice(0, 3), quote: compact.slice(3) } : null;
}

function fixtureFxUsdValue(currency: string): number {
  switch (currency) {
    case "CAD":
      return 0.74;
    case "EUR":
      return 1.09;
    case "GBP":
      return 1.27;
    case "CHF":
      return 1.11;
    case "JPY":
      return 0.0065;
    case "AUD":
      return 0.66;
    case "NZD":
      return 0.61;
    default:
      return 1;
  }
}

function syntheticFixtureFxInstrument(symbol: string): FixtureInstrument | null {
  const pair = parseFixtureFxPair(symbol);
  if (!pair) {
    return null;
  }
  return {
    symbol: `${pair.base}${pair.quote}=X`,
    aliases: [`${pair.base}/${pair.quote}`, `${pair.base}${pair.quote}`],
    name: `${pair.base}/${pair.quote}`,
    provider: "YAHOO",
    assetType: "FX",
    currency: pair.quote,
    basePrice: fixtureFxUsdValue(pair.base) / fixtureFxUsdValue(pair.quote),
    baseVolume: 0,
    seed: [...`${pair.base}${pair.quote}`].reduce(
      (seed, char) => seed * 131 + char.charCodeAt(0),
      20_000,
    ),
  };
}

function fixtureInstrument(symbol: string, provider = "YAHOO"): FixtureInstrument | null {
  const catalog = e2eFixtureCatalog();
  if (!catalog) {
    return null;
  }
  const normalized = symbol.trim().toUpperCase();
  const providerMatches = (instrument: FixtureInstrument) =>
    (instrument.provider ?? "YAHOO") === provider;
  return (
    catalog.instruments?.find(
      (instrument) => providerMatches(instrument) && instrument.symbol.toUpperCase() === normalized,
    ) ??
    catalog.instruments?.find(
      (instrument) =>
        providerMatches(instrument) &&
        (instrument.aliases ?? []).some((alias) => alias.toUpperCase() === normalized),
    ) ??
    (provider === "YAHOO" ? syntheticFixtureFxInstrument(symbol) : null)
  );
}

function fixturePrice(instrument: FixtureInstrument, date: Date): number {
  const basePrice = instrument.basePrice ?? 1;
  const seed = instrument.seed ?? 1;
  const day = Math.floor(date.getTime() / 86_400_000);
  const drift = (((day + seed) % 17) - 8) / 1000;
  return Number((basePrice * (1 + drift)).toFixed(6));
}

function fixtureQuote(
  instrument: FixtureInstrument,
  assetId: string,
  date: Date,
): YahooHistoricalQuote {
  const close = fixturePrice(instrument, date);
  const currency = instrument.currency ?? "USD";
  const timestamp = date.toISOString();
  return {
    assetId,
    day: timestamp.slice(0, 10),
    timestamp,
    source: DEFAULT_MARKET_DATA_PROVIDER,
    open: decimalString(close),
    high: decimalString(close * 1.002),
    low: decimalString(close * 0.998),
    close: decimalString(close) ?? "0",
    adjclose: decimalString(close),
    volume: decimalString(instrument.baseVolume ?? 0),
    currency,
  };
}

function fixtureSearchResults(
  query: string,
  exchangeCatalog: ExchangeCatalog,
): SymbolSearchResult[] | null {
  const catalog = e2eFixtureCatalog();
  if (!catalog) {
    return null;
  }
  const normalized = query.trim().toUpperCase();
  return (catalog.instruments ?? [])
    .map((instrument) => {
      if ((instrument.provider ?? "YAHOO") !== "YAHOO") {
        return { instrument, score: 0 };
      }
      const symbol = instrument.symbol.toUpperCase();
      const aliases = instrument.aliases ?? [];
      if (symbol === normalized) {
        return { instrument, score: 100 };
      }
      if (aliases.some((alias) => alias.toUpperCase() === normalized)) {
        return { instrument, score: 90 };
      }
      if (
        symbol.includes(normalized) ||
        aliases.some((alias) => alias.toUpperCase().includes(normalized))
      ) {
        return { instrument, score: 75 };
      }
      if ((instrument.name ?? "").toUpperCase().includes(normalized)) {
        return { instrument, score: 25 };
      }
      return { instrument, score: 0 };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 10)
    .map(({ instrument, score }, index) => {
      const exchangeMic = instrument.exchangeMic ?? null;
      return {
        symbol: instrument.symbol,
        shortName: instrument.name ?? instrument.symbol,
        longName: instrument.name ?? instrument.symbol,
        exchange: instrument.exchange ?? "",
        exchangeMic,
        exchangeName:
          instrument.exchangeName ??
          (exchangeMic ? (exchangeCatalog.nameByMic.get(exchangeMic) ?? null) : null),
        quoteType: instrument.assetType ?? "UNKNOWN",
        typeDisplay: instrument.assetType ?? "UNKNOWN",
        currency: instrument.currency ?? null,
        currencySource: instrument.currency ? "provider" : null,
        dataSource: "YAHOO",
        isExisting: false,
        existingAssetId: null,
        index: String(index),
        score,
      };
    });
}

async function searchSymbols(
  db: Database,
  query: string,
  exchangeCatalog: ExchangeCatalog,
  fetchImpl: typeof fetch,
  secretService: SecretService | undefined,
): Promise<SymbolSearchResult[]> {
  const existingSummaries = readSearchAssets(db, query).map((asset) =>
    assetToSearchResult(asset, exchangeCatalog),
  );
  const existingAssetIds = new Set(existingSummaries.map((summary) => summary.existingAssetId));
  const fixtureResults = fixtureSearchResults(query, exchangeCatalog);

  let providerResults: SymbolSearchResult[] = [];
  if (fixtureResults !== null) {
    providerResults = fixtureResults;
  } else {
    try {
      providerResults = await searchYahooSymbols(query, exchangeCatalog, fetchImpl);
    } catch {
      providerResults = [];
    }
  }

  if (
    fixtureResults === null &&
    (providerResults.length === 0 || !providerResults.some((result) => result.exchangeMic))
  ) {
    let fallbackResults = providerResults.length > 0 ? providerResults : null;
    for (const searchProvider of providerSearchFallbacks(
      secretService,
      exchangeCatalog,
      fetchImpl,
    )) {
      const results = await searchProvider(query).catch(() => []);
      if (results.length === 0) {
        continue;
      }
      if (results.some((result) => result.exchangeMic) || fallbackResults !== null) {
        providerResults = results;
        fallbackResults = null;
        break;
      }
      fallbackResults = results;
    }
    providerResults = fallbackResults ?? providerResults;
  }

  const providerKeys = dedupe(
    providerResults
      .map((result) => instrumentKeyFromSearchResult(result, exchangeCatalog))
      .filter((key): key is string => key !== null),
  );
  const existingByInstrumentKey = readAssetsByInstrumentKey(db, providerKeys);
  const unmatchedProviderResults: SymbolSearchResult[] = [];

  for (const result of providerResults) {
    const instrumentKey = instrumentKeyFromSearchResult(result, exchangeCatalog);
    const existingAsset = instrumentKey ? existingByInstrumentKey.get(instrumentKey) : undefined;
    if (existingAsset && existingAsset.kind !== "FX") {
      if (!existingAssetIds.has(existingAsset.id)) {
        existingSummaries.push(assetToSearchResult(existingAsset, exchangeCatalog));
        existingAssetIds.add(existingAsset.id);
      }
      continue;
    }
    unmatchedProviderResults.push(result);
  }

  const existingKeys = new Set(
    existingSummaries.map((summary) => searchResultDedupKey(summary.symbol, summary.exchangeMic)),
  );
  const newProviderResults = unmatchedProviderResults.filter(
    (result) => !existingKeys.has(searchResultDedupKey(result.symbol, result.exchangeMic)),
  );

  const merged = [...existingSummaries, ...newProviderResults];
  merged.sort((left, right) => {
    if (left.isExisting !== right.isExisting) {
      return left.isExisting ? -1 : 1;
    }
    return right.score - left.score;
  });
  return merged;
}

function providerSearchFallbacks(
  secretService: SecretService | undefined,
  exchangeCatalog: ExchangeCatalog,
  fetchImpl: typeof fetch,
): Array<(query: string) => Promise<SymbolSearchResult[]>> {
  const fallbacks: Array<(query: string) => Promise<SymbolSearchResult[]>> = [];
  fallbacks.push(async (query) => {
    const apiKey = await marketDataProviderApiKey(secretService, FINNHUB_PROVIDER);
    return apiKey === null ? [] : searchFinnhubSymbols(query, exchangeCatalog, fetchImpl, apiKey);
  });
  fallbacks.push(async (query) => {
    const apiKey = await marketDataProviderApiKey(secretService, ALPHA_VANTAGE_PROVIDER);
    return apiKey === null
      ? []
      : searchAlphaVantageSymbols(query, exchangeCatalog, fetchImpl, apiKey);
  });
  fallbacks.push((query) => searchOpenFigiSymbols(query, exchangeCatalog, fetchImpl));
  fallbacks.push((query) => searchBoerseSymbols(query, exchangeCatalog, fetchImpl));
  return fallbacks;
}

function readSearchAssets(db: Database, query: string): AssetSearchRow[] {
  const like = `%${query.toLowerCase()}%`;
  return db
    .query<AssetSearchRow, [string, string, string]>(
      `
        SELECT
          id, kind, name, display_code, quote_ccy, instrument_type, instrument_symbol,
          instrument_exchange_mic, instrument_key, provider_config
        FROM assets
        WHERE kind != 'FX'
          AND (
            lower(COALESCE(display_code, '')) LIKE ?
            OR lower(COALESCE(instrument_symbol, '')) LIKE ?
            OR lower(COALESCE(name, '')) LIKE ?
          )
        ORDER BY display_code ASC
        LIMIT 50
      `,
    )
    .all(like, like, like);
}

function readAssetsByInstrumentKey(
  db: Database,
  instrumentKeys: string[],
): Map<string, AssetSearchRow> {
  if (instrumentKeys.length === 0) {
    return new Map();
  }
  const placeholders = instrumentKeys.map(() => "?").join(", ");
  const rows = db
    .query<AssetSearchRow, string[]>(
      `
        SELECT
          id, kind, name, display_code, quote_ccy, instrument_type, instrument_symbol,
          instrument_exchange_mic, instrument_key, provider_config
        FROM assets
        WHERE instrument_key IN (${placeholders})
      `,
    )
    .all(...instrumentKeys);
  return new Map(
    rows
      .filter(
        (row): row is AssetSearchRow & { instrument_key: string } => row.instrument_key !== null,
      )
      .map((row) => [row.instrument_key, row]),
  );
}

function assetToSearchResult(
  asset: AssetSearchRow,
  exchangeCatalog: ExchangeCatalog,
): SymbolSearchResult {
  const display = asset.display_code ?? asset.instrument_symbol ?? "";
  const exchangeMic = asset.instrument_exchange_mic;
  const exchangeName = exchangeMic
    ? (exchangeCatalog.nameByMic.get(exchangeMic.toUpperCase()) ?? null)
    : null;
  const quoteType = quoteTypeForInstrumentType(asset.instrument_type);
  return {
    symbol: display,
    shortName: asset.name ?? display,
    longName: asset.name ?? display,
    exchange: exchangeName ?? "",
    exchangeMic,
    exchangeName,
    quoteType,
    typeDisplay: quoteType,
    currency: asset.quote_ccy,
    currencySource: null,
    dataSource: preferredProvider(asset.provider_config) ?? "MANUAL",
    isExisting: true,
    existingAssetId: asset.id,
    index: "",
    score: 100,
  };
}

async function searchYahooSymbols(
  query: string,
  exchangeCatalog: ExchangeCatalog,
  fetchImpl: typeof fetch,
): Promise<SymbolSearchResult[]> {
  const fixtureResults = fixtureSearchResults(query, exchangeCatalog);
  if (fixtureResults !== null) {
    return fixtureResults;
  }
  const query2Results = await searchYahooRawSymbols(
    "https://query2.finance.yahoo.com/v1/finance/search",
    query,
    exchangeCatalog,
    fetchImpl,
  ).catch(() => []);
  if (query2Results.length > 0) {
    return query2Results;
  }
  return searchYahooRawSymbols(
    "https://query1.finance.yahoo.com/v1/finance/search",
    query,
    exchangeCatalog,
    fetchImpl,
  );
}

async function searchYahooRawSymbols(
  endpoint: string,
  query: string,
  exchangeCatalog: ExchangeCatalog,
  fetchImpl: typeof fetch,
): Promise<SymbolSearchResult[]> {
  const response = await fetchImpl(`${endpoint}?q=${encodeURIComponent(query)}`, {
    headers: yahooSearchHeaders(),
  });
  const payload = await response.text();
  const parsed = parseYahooSearchPayload(payload);
  return parsed
    .map((quote) => yahooSearchQuoteToResult(quote, exchangeCatalog))
    .filter((result): result is SymbolSearchResult => result !== null);
}

function parseYahooSearchPayload(payload: string): YahooSearchQuoteRaw[] {
  const parsed: unknown = JSON.parse(payload);
  if (!isRecord(parsed) || !Array.isArray(parsed.quotes)) {
    return [];
  }
  return parsed.quotes.filter(isRecord);
}

function yahooSearchQuoteToResult(
  item: YahooSearchQuoteRaw,
  exchangeCatalog: ExchangeCatalog,
): SymbolSearchResult | null {
  if (typeof item.symbol !== "string" || item.symbol.trim() === "") {
    return null;
  }
  const symbol = item.symbol.trim();
  const exchange = typeof item.exchange === "string" ? item.exchange : "";
  const exchangeMic =
    yahooCodeToMic(exchange, exchangeCatalog) ?? yahooSuffixToMic(symbol, exchangeCatalog);
  const exchangeName = exchangeMic ? (exchangeCatalog.nameByMic.get(exchangeMic) ?? null) : null;
  const providerCurrency =
    typeof item.currency === "string" && item.currency.trim() !== "" ? item.currency : null;
  const inferredCurrency = exchangeMic
    ? (exchangeCatalog.currencyByMic.get(exchangeMic) ?? null)
    : null;
  const currency = providerCurrency ?? inferredCurrency;
  const name =
    (typeof item.longname === "string" && item.longname.trim() !== "" ? item.longname : null) ??
    (typeof item.shortname === "string" && item.shortname.trim() !== "" ? item.shortname : null) ??
    symbol;
  const quoteType =
    typeof item.quoteType === "string" && item.quoteType.trim() !== "" ? item.quoteType : "UNKNOWN";
  return {
    symbol,
    shortName: name,
    longName: name,
    exchange,
    exchangeMic,
    exchangeName,
    quoteType,
    typeDisplay: "",
    currency,
    currencySource: providerCurrency ? "provider" : inferredCurrency ? "exchange_inferred" : null,
    dataSource: "YAHOO",
    isExisting: false,
    existingAssetId: null,
    index: "",
    score: typeof item.score === "number" && Number.isFinite(item.score) ? item.score : 0,
  };
}

async function searchFinnhubSymbols(
  query: string,
  exchangeCatalog: ExchangeCatalog,
  fetchImpl: typeof fetch,
  apiKey: string,
): Promise<SymbolSearchResult[]> {
  const payload = await fetchFinnhubJson("/search", [["q", query]], fetchImpl, apiKey);
  if (!isRecord(payload) || !Array.isArray(payload.result)) {
    throw new Error(`${FINNHUB_PROVIDER}: Failed to parse search response`);
  }
  return payload.result
    .filter(isRecord)
    .map((item) => finnhubSearchItemToResult(item, exchangeCatalog))
    .filter((result): result is SymbolSearchResult => result !== null);
}

function finnhubSearchItemToResult(
  item: Record<string, unknown>,
  exchangeCatalog: ExchangeCatalog,
): SymbolSearchResult | null {
  const symbol = optionalString(item.symbol);
  const description = optionalString(item.description);
  if (!symbol || !description) {
    return null;
  }
  const exchangeMic = yahooSuffixToMic(symbol, exchangeCatalog);
  const exchangeName = exchangeMic ? (exchangeCatalog.nameByMic.get(exchangeMic) ?? null) : null;
  const currency = exchangeMic ? (exchangeCatalog.currencyByMic.get(exchangeMic) ?? null) : null;
  return {
    symbol,
    shortName: description,
    longName: description,
    exchange: "",
    exchangeMic,
    exchangeName,
    quoteType: finnhubSearchAssetType(optionalString(item.type) ?? ""),
    typeDisplay: "",
    currency,
    currencySource: currency ? "exchange_inferred" : null,
    dataSource: "YAHOO",
    isExisting: false,
    existingAssetId: null,
    index: "",
    score: 0,
  };
}

function finnhubSearchAssetType(securityType: string): string {
  switch (securityType.toLowerCase()) {
    case "common stock":
    case "stock":
      return "Stock";
    case "etf":
    case "etp":
      return "ETF";
    case "mutual fund":
    case "fund":
      return "Mutual Fund";
    case "adr":
    case "american depositary receipt":
      return "ADR";
    case "reit":
      return "REIT";
    case "warrant":
      return "Warrant";
    case "preferred stock":
    case "preferred":
      return "Preferred Stock";
    case "unit":
      return "Unit";
    case "closed-end fund":
      return "Closed-End Fund";
    default:
      return securityType;
  }
}

async function searchAlphaVantageSymbols(
  query: string,
  exchangeCatalog: ExchangeCatalog,
  fetchImpl: typeof fetch,
  apiKey: string,
): Promise<SymbolSearchResult[]> {
  const payload = await fetchAlphaVantageJson(
    [
      ["function", "SYMBOL_SEARCH"],
      ["keywords", query],
    ],
    fetchImpl,
    apiKey,
  );
  if (!isRecord(payload)) {
    throw new Error(`${ALPHA_VANTAGE_PROVIDER}: Failed to parse search response`);
  }
  checkAlphaVantageApiError(payload);
  const matches = Array.isArray(payload.bestMatches) ? payload.bestMatches.filter(isRecord) : [];
  return matches
    .map((match) => alphaVantageSearchMatchToResult(match, exchangeCatalog))
    .filter((result): result is SymbolSearchResult => result !== null);
}

function alphaVantageSearchMatchToResult(
  match: Record<string, unknown>,
  exchangeCatalog: ExchangeCatalog,
): SymbolSearchResult | null {
  const symbol = optionalString(match["1. symbol"]);
  const name = optionalString(match["2. name"]);
  if (!symbol || !name) {
    return null;
  }
  const exchange = optionalString(match["4. region"]) ?? "";
  const exchangeMic = yahooCodeToMic(exchange, exchangeCatalog);
  const exchangeName = exchangeMic ? (exchangeCatalog.nameByMic.get(exchangeMic) ?? null) : null;
  const currency = optionalString(match["8. currency"]);
  return {
    symbol,
    shortName: name,
    longName: name,
    exchange,
    exchangeMic,
    exchangeName,
    quoteType: alphaVantageSearchAssetType(optionalString(match["3. type"]) ?? ""),
    typeDisplay: "",
    currency,
    currencySource: currency ? "provider" : null,
    dataSource: ALPHA_VANTAGE_PROVIDER,
    isExisting: false,
    existingAssetId: null,
    index: "",
    score: decimalNumber(match["9. matchScore"]) ?? 0,
  };
}

function alphaVantageSearchAssetType(assetType: string): string {
  switch (assetType.toUpperCase()) {
    case "EQUITY":
      return "EQUITY";
    case "ETF":
      return "ETF";
    case "MUTUAL FUND":
      return "MUTUALFUND";
    default:
      return assetType.toUpperCase();
  }
}

async function searchBoerseSymbols(
  query: string,
  exchangeCatalog: ExchangeCatalog,
  fetchImpl: typeof fetch,
): Promise<SymbolSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }
  const url = new URL(`${BOERSE_FRANKFURT_BASE_URL}/tradingview/search`);
  url.searchParams.set("query", trimmed);
  url.searchParams.set("limit", "10");
  const payload = await fetchBoerseJson(url, fetchImpl);
  if (!Array.isArray(payload)) {
    throw new Error(`${BOERSE_FRANKFURT_PROVIDER}: Search JSON parse error`);
  }
  return payload
    .filter(isRecord)
    .map((item) => boerseSearchItemToResult(item, exchangeCatalog))
    .filter((result): result is SymbolSearchResult => result !== null);
}

function boerseSearchItemToResult(
  item: Record<string, unknown>,
  exchangeCatalog: ExchangeCatalog,
): SymbolSearchResult | null {
  const rawSymbol = optionalString(item.symbol);
  const description = optionalString(item.description);
  const rawType = optionalString(item.type);
  if (!rawSymbol || !description || !rawType) {
    return null;
  }
  const quoteType = boerseSearchAssetType(rawType);
  if (!quoteType) {
    return null;
  }
  const [rawMic, isin] = splitBoerseMicSymbol(rawSymbol);
  if (!rawMic || !isin) {
    return null;
  }
  const exchangeMic = rawMic.toUpperCase();
  const exchangeName = exchangeCatalog.nameByMic.get(exchangeMic) ?? null;
  const currency = exchangeCatalog.currencyByMic.get(exchangeMic) ?? null;
  return {
    symbol: isin,
    shortName: description,
    longName: description,
    exchange: optionalString(item.exchange) ?? "",
    exchangeMic,
    exchangeName,
    quoteType,
    typeDisplay: "",
    currency,
    currencySource: currency ? "exchange_inferred" : null,
    dataSource: BOERSE_FRANKFURT_PROVIDER,
    isExisting: false,
    existingAssetId: null,
    index: "",
    score: 0,
  };
}

function boerseSearchAssetType(value: string): string | null {
  switch (value) {
    case "Aktie":
      return "EQUITY";
    case "ETP":
      return "ETF";
    case "Anleihe":
      return "BOND";
    case "Fonds":
      return "MUTUALFUND";
    default:
      return null;
  }
}

async function searchOpenFigiSymbols(
  query: string,
  exchangeCatalog: ExchangeCatalog,
  fetchImpl: typeof fetch,
): Promise<SymbolSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }
  const symbol = trimmed.toUpperCase();
  const idTypes = openFigiDetectIdTypes(trimmed);
  if (idTypes !== null) {
    for (const idType of idTypes) {
      try {
        const records = await fetchOpenFigiMapping(idType, trimmed, fetchImpl);
        if (records.length > 0) {
          return openFigiRecordsToSearchResults(records, symbol, exchangeCatalog);
        }
      } catch {
        continue;
      }
    }
  }
  const records = await fetchOpenFigiSearch(trimmed, fetchImpl);
  return openFigiRecordsToSearchResults(
    records.filter(openFigiIsBondRecord),
    symbol,
    exchangeCatalog,
  );
}

async function fetchOpenFigiMapping(
  idType: string,
  idValue: string,
  fetchImpl: typeof fetch,
): Promise<OpenFigiRecord[]> {
  const payload = await fetchOpenFigiJson(OPENFIGI_MAPPING_URL, [{ idType, idValue }], fetchImpl);
  if (!Array.isArray(payload)) {
    throw new Error(`${OPENFIGI_PROVIDER}: JSON parse error`);
  }
  const first = payload[0];
  if (!isRecord(first) || !Array.isArray(first.data)) {
    return [];
  }
  return first.data.filter(isRecord);
}

async function fetchOpenFigiSearch(
  query: string,
  fetchImpl: typeof fetch,
): Promise<OpenFigiRecord[]> {
  const payload = await fetchOpenFigiJson(OPENFIGI_SEARCH_URL, { query }, fetchImpl);
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    return [];
  }
  return payload.data.filter(isRecord);
}

async function fetchOpenFigiJson(
  url: string,
  body: unknown,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(`${OPENFIGI_PROVIDER}: HTTP request failed: ${errorMessage(error)}`);
  }
  if (!response.ok) {
    throw new Error(`${OPENFIGI_PROVIDER}: HTTP ${formatRustHttpStatus(response.status)}`);
  }
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${OPENFIGI_PROVIDER}: JSON parse error: ${errorMessage(error)}`);
  }
}

function openFigiDetectIdTypes(query: string): string[] | null {
  const trimmed = query.trim();
  if (
    trimmed.length === 12 &&
    trimmed.startsWith("BBG") &&
    [...trimmed].every((char) => /[A-Za-z0-9]/.test(char))
  ) {
    return ["COMPOSITE_FIGI", "ID_BB_GLOBAL"];
  }
  if (
    trimmed.length === 12 &&
    /^[A-Za-z]{2}/.test(trimmed) &&
    [...trimmed.slice(2)].every((char) => /[A-Za-z0-9]/.test(char))
  ) {
    return ["ID_ISIN"];
  }
  if (trimmed.length === 9 && [...trimmed].every((char) => /[A-Za-z0-9]/.test(char))) {
    return ["ID_CUSIP"];
  }
  return null;
}

function openFigiIsBondRecord(record: OpenFigiRecord): boolean {
  const marketSector = optionalString(record.marketSector);
  return marketSector === null ? false : OPENFIGI_BOND_MARKET_SECTORS.has(marketSector);
}

function openFigiRecordsToSearchResults(
  records: OpenFigiRecord[],
  symbol: string,
  exchangeCatalog: ExchangeCatalog,
): SymbolSearchResult[] {
  const seen = new Set<string>();
  const results: SymbolSearchResult[] = [];
  for (const record of records) {
    const name = optionalString(record.name);
    if (!name) {
      continue;
    }
    const ticker = optionalString(record.ticker);
    const displayName = ticker ? `${name} - ${ticker}` : name;
    const exchange = optionalString(record.exchCode) ?? "";
    const key = `${displayName}\u0000${exchange}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const exchangeMic = yahooCodeToMic(exchange, exchangeCatalog);
    const exchangeName = exchangeMic ? (exchangeCatalog.nameByMic.get(exchangeMic) ?? null) : null;
    const currency = exchangeMic ? (exchangeCatalog.currencyByMic.get(exchangeMic) ?? null) : null;
    results.push({
      symbol,
      shortName: displayName,
      longName: displayName,
      exchange,
      exchangeMic,
      exchangeName,
      quoteType: "BOND",
      typeDisplay: "",
      currency,
      currencySource: currency ? "exchange_inferred" : null,
      dataSource: OPENFIGI_PROVIDER,
      isExisting: false,
      existingAssetId: null,
      index: "",
      score: 0,
    });
  }
  return results;
}

function quoteTypeForInstrumentType(instrumentType: string | null): string {
  switch (instrumentType) {
    case "EQUITY":
      return "EQUITY";
    case "CRYPTO":
      return "CRYPTOCURRENCY";
    case "METAL":
      return "COMMODITY";
    case "OPTION":
      return "OPTION";
    case "BOND":
      return "BOND";
    case "FX":
      return "FOREX";
    default:
      return "OTHER";
  }
}

export function instrumentTypeFromQuoteType(quoteType: string): string | null {
  switch (quoteType.toUpperCase()) {
    case "EQUITY":
    case "STOCK":
    case "ETF":
    case "MUTUALFUND":
    case "MUTUAL FUND":
    case "INDEX":
    case "ECNQUOTE":
      return "EQUITY";
    case "CRYPTOCURRENCY":
    case "CRYPTO":
      return "CRYPTO";
    case "CURRENCY":
    case "FOREX":
    case "FX":
      return "FX";
    case "OPTION":
      return "OPTION";
    case "COMMODITY":
      return "METAL";
    case "BOND":
    case "MONEYMARKET":
      return "BOND";
    default:
      return null;
  }
}

function instrumentKeyFromSearchResult(
  result: SymbolSearchResult,
  exchangeCatalog: ExchangeCatalog,
): string | null {
  const instrumentType = instrumentTypeFromQuoteType(result.quoteType);
  if (!instrumentType || result.symbol.trim() === "") {
    return null;
  }
  const canonical = canonicalizeSearchIdentity(
    instrumentType,
    result.symbol,
    result.exchangeMic ?? null,
    result.currency ?? null,
    exchangeCatalog,
  );
  return generatedInstrumentKey({
    instrumentType,
    instrumentSymbol: canonical.instrumentSymbol,
    instrumentExchangeMic: canonical.instrumentExchangeMic,
    quoteCcy: canonical.quoteCcy ?? "",
  });
}

function canonicalizeSearchIdentity(
  instrumentType: string,
  symbol: string,
  exchangeMic: string | null,
  quoteCcy: string | null,
  exchangeCatalog: ExchangeCatalog,
): {
  instrumentSymbol: string | null;
  instrumentExchangeMic: string | null;
  quoteCcy: string | null;
} {
  let instrumentSymbol: string | null = symbol.trim();
  let instrumentExchangeMic = exchangeMic?.trim().toUpperCase() || null;
  let normalizedQuote = quoteCcy?.trim().toUpperCase() || null;

  switch (instrumentType) {
    case "EQUITY":
    case "OPTION":
    case "METAL": {
      const parsed = parseSymbolWithYahooSuffix(instrumentSymbol, exchangeCatalog);
      instrumentSymbol = parsed.baseSymbol.toUpperCase();
      instrumentExchangeMic ??= parsed.mic;
      normalizedQuote ??= instrumentExchangeMic
        ? (exchangeCatalog.currencyByMic.get(instrumentExchangeMic) ?? null)
        : null;
      return { instrumentSymbol, instrumentExchangeMic, quoteCcy: normalizedQuote };
    }
    case "CRYPTO": {
      const parsed = parseCryptoPairSymbol(instrumentSymbol);
      if (parsed) {
        instrumentSymbol = parsed.base.toUpperCase();
        normalizedQuote ??= parsed.quote;
      } else {
        instrumentSymbol = instrumentSymbol.toUpperCase();
      }
      return { instrumentSymbol, instrumentExchangeMic: null, quoteCcy: normalizedQuote };
    }
    case "FX": {
      const parsed = parseFxSymbolParts(instrumentSymbol);
      if (parsed) {
        instrumentSymbol = parsed.base;
        normalizedQuote = parsed.quote;
      } else {
        instrumentSymbol = instrumentSymbol.toUpperCase();
      }
      return { instrumentSymbol, instrumentExchangeMic: null, quoteCcy: normalizedQuote };
    }
    case "BOND":
      return {
        instrumentSymbol: instrumentSymbol.toUpperCase(),
        instrumentExchangeMic: null,
        quoteCcy: normalizedQuote,
      };
    default:
      return { instrumentSymbol, instrumentExchangeMic, quoteCcy: normalizedQuote };
  }
}

function generatedInstrumentKey(asset: {
  instrumentType: string | null;
  instrumentSymbol: string | null;
  instrumentExchangeMic: string | null;
  quoteCcy: string;
}): string | null {
  if (!asset.instrumentType || !asset.instrumentSymbol) {
    return null;
  }
  if (asset.instrumentType === "CRYPTO" || asset.instrumentType === "FX") {
    return `${asset.instrumentType}:${asset.instrumentSymbol.toUpperCase()}/${asset.quoteCcy.toUpperCase()}`;
  }
  if (asset.instrumentExchangeMic) {
    return `${asset.instrumentType}:${asset.instrumentSymbol.toUpperCase()}@${asset.instrumentExchangeMic.toUpperCase()}`;
  }
  return `${asset.instrumentType}:${asset.instrumentSymbol.toUpperCase()}`;
}

function parseSymbolWithYahooSuffix(
  symbol: string,
  exchangeCatalog: ExchangeCatalog,
): { baseSymbol: string; mic: string | null } {
  const trimmed = symbol.trim();
  const suffixes = [...exchangeCatalog.yahooSuffixToMic.entries()].sort(
    ([left], [right]) => right.length - left.length,
  );
  for (const [suffix, mic] of suffixes) {
    const dottedSuffix = `.${suffix}`;
    if (
      trimmed.length >= dottedSuffix.length &&
      trimmed.slice(trimmed.length - dottedSuffix.length).toUpperCase() ===
        dottedSuffix.toUpperCase()
    ) {
      return { baseSymbol: trimmed.slice(0, -dottedSuffix.length), mic };
    }
  }
  return { baseSymbol: trimmed, mic: null };
}

function parseCryptoPairSymbol(symbol: string): { base: string; quote: string } | null {
  const separator = symbol.trim().lastIndexOf("-");
  if (separator <= 0 || separator === symbol.trim().length - 1) {
    return null;
  }
  const base = symbol.trim().slice(0, separator).trim();
  const quote = symbol
    .trim()
    .slice(separator + 1)
    .trim()
    .toUpperCase();
  if (base === "" || quote.length < 3 || quote.length > 5 || !/^[A-Z]+$/.test(quote)) {
    return null;
  }
  return { base, quote };
}

function parseFxSymbolParts(symbol: string): { base: string; quote: string } | null {
  const cleaned = symbol.trim().toUpperCase().replace(/=X$/, "");
  const slashParts = cleaned.split("/");
  if (
    slashParts.length === 2 &&
    /^[A-Z]{3}$/.test(slashParts[0] ?? "") &&
    /^[A-Z]{3}$/.test(slashParts[1] ?? "")
  ) {
    return { base: slashParts[0] ?? "", quote: slashParts[1] ?? "" };
  }
  if (/^[A-Z]{6}$/.test(cleaned)) {
    return { base: cleaned.slice(0, 3), quote: cleaned.slice(3) };
  }
  return null;
}

function yahooCodeToMic(code: string, exchangeCatalog: ExchangeCatalog): string | null {
  const normalized = code.trim().toUpperCase();
  return normalized ? (exchangeCatalog.yahooCodeToMic.get(normalized) ?? null) : null;
}

function yahooSuffixToMic(symbol: string, exchangeCatalog: ExchangeCatalog): string | null {
  const dotIndex = symbol.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === symbol.length - 1) {
    return null;
  }
  const suffix = symbol.slice(dotIndex + 1).toUpperCase();
  return exchangeCatalog.yahooSuffixToMic.get(suffix) ?? null;
}

function preferredProvider(providerConfig: string | null): string | null {
  const parsed = parseJsonValue(providerConfig);
  if (!isRecord(parsed)) {
    return null;
  }
  return typeof parsed.preferred_provider === "string" && parsed.preferred_provider.trim() !== ""
    ? parsed.preferred_provider
    : null;
}

function searchResultDedupKey(symbol: string, exchangeMic: string | null | undefined): string {
  return `${symbol}\u0000${exchangeMic ?? ""}`;
}

async function resolveSymbolQuote(
  db: Database,
  request: ResolveSymbolQuoteRequest,
  exchangeCatalog: ExchangeCatalog,
  fetchImpl: typeof fetch,
  crumbCache: {
    get: () => YahooCrumbData | null;
    set: (crumb: YahooCrumbData) => void;
    clear: () => void;
  },
  customProviderService: MarketDataCustomProviderService | undefined,
  secretService: SecretService | undefined,
  usTreasuryCurveCache: Map<number, UsTreasuryYieldCurve[]>,
  now: Date,
): Promise<ResolvedQuote> {
  const trimmedSymbol = request.symbol.trim();
  if (trimmedSymbol === "") {
    return defaultResolvedQuote();
  }

  const preferredProvider = normalizePreferredProvider(request.providerId);
  const instrumentType = normalizeInstrumentType(request.instrumentType) ?? "EQUITY";
  const exchangeMic = optionalString(request.exchangeMic)?.toUpperCase() ?? null;
  const requestedQuoteCcy = optionalString(request.quoteCcy)?.toUpperCase() ?? null;
  if (preferredProvider?.startsWith("CUSTOM:")) {
    const customProviderCode = preferredProvider.slice("CUSTOM:".length).trim();
    if (!customProviderCode) {
      return defaultResolvedQuote();
    }
    return resolveCustomProviderSymbolQuote(
      customProviderCode,
      trimmedSymbol,
      requestedQuoteCcy,
      instrumentType,
      customProviderService,
      now,
    );
  }
  if (preferredProvider === US_TREASURY_CALC_PROVIDER) {
    if (instrumentType !== "BOND") {
      return defaultResolvedQuote();
    }
    const asset = readUsTreasuryResolveAsset(db, trimmedSymbol);
    if (asset === null) {
      return defaultResolvedQuote();
    }
    const instrument = usTreasuryInstrumentForAsset(asset, exchangeCatalog);
    if (instrument === null) {
      return defaultResolvedQuote();
    }
    try {
      const quote = await fetchUsTreasuryLatestQuote(
        asset.id,
        instrument,
        fetchImpl,
        usTreasuryCurveCache,
        now,
      );
      return resolvedProviderQuoteFromHistoricalQuote(
        instrumentType,
        quote,
        US_TREASURY_CALC_PROVIDER,
      );
    } catch {
      return defaultResolvedQuote();
    }
  }
  if (preferredProvider === ALPHA_VANTAGE_PROVIDER) {
    const apiKey = await marketDataProviderApiKey(secretService, ALPHA_VANTAGE_PROVIDER);
    if (apiKey === null) {
      return defaultResolvedQuote();
    }
    const instrument = alphaVantageInstrumentForResolve(
      trimmedSymbol,
      instrumentType,
      exchangeMic,
      requestedQuoteCcy,
      exchangeCatalog,
    );
    if (instrument === null) {
      return defaultResolvedQuote();
    }
    try {
      const quote = await fetchAlphaVantageLatestQuote(
        `_QUOTE_RESOLVE_${trimmedSymbol}`,
        instrument,
        fetchImpl,
        apiKey,
      );
      return resolvedProviderQuoteFromHistoricalQuote(
        instrumentType,
        quote,
        ALPHA_VANTAGE_PROVIDER,
      );
    } catch {
      return defaultResolvedQuote();
    }
  }
  if (preferredProvider === METAL_PRICE_API_PROVIDER) {
    if (instrumentType !== "METAL") {
      return defaultResolvedQuote();
    }
    const apiKey = await marketDataProviderApiKey(secretService, METAL_PRICE_API_PROVIDER);
    const instrument = metalPriceApiInstrumentForSymbol(trimmedSymbol, requestedQuoteCcy);
    if (apiKey === null || instrument === null) {
      return defaultResolvedQuote();
    }
    try {
      const quote = await fetchMetalPriceApiLatestQuote(
        `_QUOTE_RESOLVE_${trimmedSymbol}`,
        instrument,
        fetchImpl,
        apiKey,
        now,
      );
      return resolvedProviderQuoteFromHistoricalQuote(
        instrumentType,
        quote,
        METAL_PRICE_API_PROVIDER,
      );
    } catch {
      return defaultResolvedQuote();
    }
  }
  if (preferredProvider === MARKETDATA_APP_PROVIDER) {
    if (instrumentType !== "EQUITY") {
      return defaultResolvedQuote();
    }
    const apiKey = await marketDataProviderApiKey(secretService, MARKETDATA_APP_PROVIDER);
    if (apiKey === null) {
      return defaultResolvedQuote();
    }
    const currency = providerCurrencyFromExchange(exchangeMic, requestedQuoteCcy, exchangeCatalog);
    for (const candidate of symbolResolutionCandidates(trimmedSymbol)) {
      try {
        const quote = await fetchMarketDataAppLatestQuote(
          `_QUOTE_RESOLVE_${candidate}`,
          candidate,
          currency,
          fetchImpl,
          apiKey,
        );
        return resolvedProviderQuoteFromHistoricalQuote(
          instrumentType,
          quote,
          MARKETDATA_APP_PROVIDER,
        );
      } catch {
        continue;
      }
    }
    return defaultResolvedQuote();
  }
  if (preferredProvider === FINNHUB_PROVIDER) {
    const apiKey = await marketDataProviderApiKey(secretService, FINNHUB_PROVIDER);
    if (apiKey === null) {
      return defaultResolvedQuote();
    }
    const currency = providerCurrencyFromExchange(exchangeMic, requestedQuoteCcy, exchangeCatalog);
    const candidates =
      instrumentType === "EQUITY"
        ? symbolResolutionCandidates(trimmedSymbol).map((symbol) => ({ symbol, currency }))
        : finnhubResolveCandidates(
            trimmedSymbol,
            instrumentType,
            requestedQuoteCcy,
            exchangeCatalog,
          );
    for (const candidate of candidates) {
      try {
        const quote = await fetchFinnhubLatestQuote(
          `_QUOTE_RESOLVE_${candidate.symbol}`,
          candidate.symbol,
          candidate.currency,
          fetchImpl,
          apiKey,
          now,
        );
        return resolvedProviderQuoteFromHistoricalQuote(instrumentType, quote, FINNHUB_PROVIDER);
      } catch {
        continue;
      }
    }
    return defaultResolvedQuote();
  }
  if (preferredProvider === BOERSE_FRANKFURT_PROVIDER) {
    if (instrumentType !== "EQUITY" && instrumentType !== "BOND") {
      return defaultResolvedQuote();
    }
    const cleanSymbol = stripMatchingYahooSuffix(trimmedSymbol, exchangeMic, exchangeCatalog);
    const boerseIsinCache = new Map<string, string>();
    for (const candidate of symbolResolutionCandidates(cleanSymbol)) {
      try {
        return validateResolvedProviderQuote(
          instrumentType,
          await fetchBoerseResolvedQuote(
            boerseInstrumentIdentityFromSymbol(candidate, exchangeMic, instrumentType),
            requestedQuoteCcy,
            fetchImpl,
            boerseIsinCache,
          ),
        );
      } catch {
        continue;
      }
    }
    return defaultResolvedQuote();
  }
  if (preferredProvider !== null && preferredProvider !== "YAHOO") {
    return defaultResolvedQuote();
  }

  if (instrumentType === "BOND") {
    return defaultResolvedQuote();
  }

  const cleanSymbol = stripMatchingYahooSuffix(trimmedSymbol, exchangeMic, exchangeCatalog);

  for (const candidate of symbolResolutionCandidates(cleanSymbol)) {
    const canonical = canonicalizeSearchIdentity(
      instrumentType,
      candidate,
      exchangeMic,
      requestedQuoteCcy,
      exchangeCatalog,
    );
    if (
      (instrumentType === "CRYPTO" || instrumentType === "FX") &&
      (canonical.quoteCcy === null || canonical.quoteCcy === "")
    ) {
      continue;
    }
    const yahooSymbol = yahooProviderSymbol(instrumentType, canonical, exchangeCatalog);
    if (yahooSymbol === null) {
      continue;
    }

    for (const retry of [0, 1]) {
      try {
        return validateResolvedProviderQuote(
          instrumentType,
          await fetchYahooResolvedQuote(yahooSymbol, canonical.quoteCcy, fetchImpl, crumbCache),
        );
      } catch (error) {
        if (error instanceof YahooUnauthorizedError && retry === 0) {
          continue;
        }
        break;
      }
    }
  }

  return defaultResolvedQuote();
}

async function resolveCustomProviderSymbolQuote(
  providerCode: string,
  symbol: string,
  quoteCcy: string | null,
  instrumentType: string | null,
  customProviderService: MarketDataCustomProviderService | undefined,
  now: Date,
): Promise<ResolvedQuote> {
  if (!customProviderService) {
    return defaultResolvedQuote();
  }

  const resolved = await fetchCustomProviderQuote(
    providerCode,
    symbol,
    quoteCcy,
    customProviderService,
    now,
  );
  if (!resolved) {
    return defaultResolvedQuote();
  }
  if (
    providerQuoteValidationError(
      instrumentType,
      providerQuoteValidationInputFromCustomResult(resolved.result),
    ) !== null
  ) {
    return defaultResolvedQuote();
  }
  return {
    currency: resolved.result.currency ?? quoteCcy ?? "USD",
    price: resolved.result.price === 0 ? null : resolved.result.price,
    resolvedProviderId: `CUSTOM_SCRAPER:${resolved.source.providerId}`,
  };
}

async function fetchCustomProviderQuote(
  providerCode: string,
  symbol: string,
  quoteCcy: string | null,
  customProviderService: MarketDataCustomProviderService,
  now: Date,
): Promise<{ source: CustomProviderSource; result: TestSourceResult } | null> {
  const latestSource = await Promise.resolve(
    customProviderService.getSourceByKind(providerCode, "latest"),
  );
  if (latestSource) {
    const quote = await fetchCustomProviderSourceQuote(
      latestSource,
      symbol,
      quoteCcy,
      customProviderService,
      now,
    );
    if (quote) {
      return quote;
    }
  }

  const historicalSource = await Promise.resolve(
    customProviderService.getSourceByKind(providerCode, "historical"),
  );
  if (historicalSource) {
    return fetchCustomProviderHistoricalSourceQuote(
      historicalSource,
      symbol,
      quoteCcy,
      customProviderService,
      now,
    );
  }
  return null;
}

async function fetchCustomProviderSyncQuote(
  asset: AssetMarketSyncRow,
  providerCode: string | null,
  symbol: string,
  customProviderService: MarketDataCustomProviderService | undefined,
  now: Date,
): Promise<QuoteWrite> {
  if (!customProviderService) {
    throw new Error("Custom provider service is not available for market sync");
  }
  const resolved = providerCode
    ? await fetchCustomProviderQuote(
        providerCode,
        symbol,
        asset.quote_ccy || null,
        customProviderService,
        now,
      )
    : await fetchGeneralPurposeCustomProviderQuote(asset, customProviderService, now);
  if (!resolved) {
    throw new Error(`No custom provider quote extracted for ${symbol}`);
  }
  return customProviderQuoteToQuoteWrite(asset, resolved.source, resolved.result, now);
}

async function fetchCustomProviderHistoricalQuotes(
  asset: AssetMarketSyncRow,
  providerCode: string,
  symbol: string,
  customProviderService: MarketDataCustomProviderService | undefined,
  from: string,
  to: string,
  now: Date,
): Promise<CustomProviderHistoricalQuotes> {
  if (!customProviderService) {
    throw new Error("Custom provider service is not available for market sync");
  }
  const source = await Promise.resolve(
    customProviderService.getSourceByKind(providerCode, "historical"),
  );
  if (!source) {
    return fetchCustomProviderLatestFallbackQuote(
      asset,
      providerCode,
      symbol,
      customProviderService,
      now,
    );
  }
  if (!customProviderService.fetchSourceRows) {
    throw new Error("Custom provider service cannot fetch historical rows for market sync");
  }
  const result = await Promise.resolve(
    customProviderService.fetchSourceRows(
      customProviderTestSourceRequest(source, symbol, asset.quote_ccy || null, now, { from, to }),
    ),
  );
  const quotes = customProviderRowsToQuoteWrites(asset, source, result, now);
  if (quotes.length === 0) {
    throw new Error(`No historical custom provider quotes extracted for ${symbol}`);
  }
  return { source: `${CUSTOM_SCRAPER_PROVIDER}:${source.providerId}`, quotes, allowPurge: true };
}

async function fetchCustomProviderLatestFallbackQuote(
  asset: AssetMarketSyncRow,
  providerCode: string,
  symbol: string,
  customProviderService: MarketDataCustomProviderService,
  now: Date,
): Promise<CustomProviderHistoricalQuotes> {
  const source = await Promise.resolve(
    customProviderService.getSourceByKind(providerCode, "latest"),
  );
  if (!source) {
    throw new Error(
      `No historical or latest custom provider source configured for ${providerCode}`,
    );
  }
  const quote = await fetchCustomProviderSourceQuote(
    source,
    symbol,
    asset.quote_ccy || null,
    customProviderService,
    now,
  );
  if (!quote) {
    throw new Error(`No latest custom provider quote extracted for ${symbol}`);
  }
  return {
    source: `${CUSTOM_SCRAPER_PROVIDER}:${source.providerId}`,
    quotes: [customProviderQuoteToQuoteWrite(asset, source, quote.result, now)],
    allowPurge: false,
  };
}

async function fetchGeneralPurposeCustomProviderHistoricalQuotes(
  asset: AssetMarketSyncRow,
  customProviderService: MarketDataCustomProviderService | undefined,
  from: string,
  to: string,
  now: Date,
): Promise<CustomProviderHistoricalQuotes> {
  if (!customProviderService) {
    throw new Error("Custom provider service is not available for market sync");
  }
  if (!customProviderService.getAll) {
    throw new Error("Custom provider service cannot list general-purpose sources for market sync");
  }
  let lastError: string | null = null;
  const providers = customProviderService.getAll();
  const historicalSources = generalPurposeCustomProviderSources(providers, "historical");
  if (historicalSources.length === 0) {
    return fetchGeneralPurposeCustomProviderLatestFallbackQuote(asset, customProviderService, now);
  }
  if (!customProviderService.fetchSourceRows) {
    throw new Error("Custom provider service cannot fetch historical rows for market sync");
  }
  for (const source of historicalSources) {
    const symbol = customProviderSourceSymbol(asset, source);
    if (symbol === null) {
      continue;
    }
    try {
      const result = await Promise.resolve(
        customProviderService.fetchSourceRows(
          customProviderTestSourceRequest(source, symbol, asset.quote_ccy || null, now, {
            from,
            to,
          }),
        ),
      );
      const quotes = customProviderRowsToQuoteWrites(asset, source, result, now);
      if (quotes.length > 0) {
        return {
          source: `${CUSTOM_SCRAPER_PROVIDER}:${source.providerId}`,
          quotes,
          allowPurge: true,
        };
      }
      lastError = `No historical custom provider quotes extracted for ${symbol}`;
    } catch (error) {
      lastError = errorMessage(error);
    }
  }
  throw new Error(lastError ?? `No historical custom provider quotes extracted for ${asset.id}`);
}

async function fetchGeneralPurposeCustomProviderLatestFallbackQuote(
  asset: AssetMarketSyncRow,
  customProviderService: MarketDataCustomProviderService,
  now: Date,
): Promise<CustomProviderHistoricalQuotes> {
  const quote = await fetchGeneralPurposeCustomProviderQuote(asset, customProviderService, now);
  if (!quote) {
    throw new Error(`No latest custom provider quote extracted for ${asset.id}`);
  }
  return {
    source: `${CUSTOM_SCRAPER_PROVIDER}:${quote.source.providerId}`,
    quotes: [customProviderQuoteToQuoteWrite(asset, quote.source, quote.result, now)],
    allowPurge: false,
  };
}

async function fetchGeneralPurposeCustomProviderQuote(
  asset: AssetMarketSyncRow,
  customProviderService: MarketDataCustomProviderService,
  now: Date,
): Promise<{ source: CustomProviderSource; result: TestSourceResult } | null> {
  const providers = customProviderService.getAll?.();
  if (!providers) {
    throw new Error("Custom provider service cannot list general-purpose sources for market sync");
  }

  for (const source of generalPurposeCustomProviderSources(providers, "latest")) {
    const symbol = customProviderSourceSymbol(asset, source);
    if (symbol === null) {
      continue;
    }
    const quote = await fetchCustomProviderSourceQuote(
      source,
      symbol,
      asset.quote_ccy || null,
      customProviderService,
      now,
    );
    if (quote) {
      return quote;
    }
  }

  for (const source of generalPurposeCustomProviderSources(providers, "historical")) {
    const symbol = customProviderSourceSymbol(asset, source);
    if (symbol === null) {
      continue;
    }
    const quote = await fetchCustomProviderHistoricalSourceQuote(
      source,
      symbol,
      asset.quote_ccy || null,
      customProviderService,
      now,
    );
    if (quote) {
      return quote;
    }
  }
  return null;
}

function generalPurposeCustomProviderSources(
  providers: CustomProviderWithSources[],
  kind: CustomProviderSourceKind,
): CustomProviderSource[] {
  return providers
    .filter((provider) => provider.enabled)
    .flatMap((provider) =>
      provider.sources.filter((source) => source.kind === kind && source.url.includes("{SYMBOL}")),
    );
}

async function fetchCustomProviderSourceQuote(
  source: CustomProviderSource,
  symbol: string,
  quoteCcy: string | null,
  customProviderService: MarketDataCustomProviderService,
  now: Date,
): Promise<{ source: CustomProviderSource; result: TestSourceResult } | null> {
  try {
    const result = await Promise.resolve(
      customProviderService.testSource(
        customProviderTestSourceRequest(source, symbol, quoteCcy, now),
      ),
    );
    if (!result.success || result.price === null || !Number.isFinite(result.price)) {
      return null;
    }
    return { source, result };
  } catch {
    return null;
  }
}

async function fetchCustomProviderHistoricalSourceQuote(
  source: CustomProviderSource,
  symbol: string,
  quoteCcy: string | null,
  customProviderService: MarketDataCustomProviderService,
  now: Date,
): Promise<{ source: CustomProviderSource; result: TestSourceResult } | null> {
  if (!customProviderService.fetchSourceRows) {
    return null;
  }
  try {
    const result = await Promise.resolve(
      customProviderService.fetchSourceRows(
        customProviderTestSourceRequest(source, symbol, quoteCcy, now),
      ),
    );
    const latestRow = latestCustomProviderQuoteRow(source, result, now);
    if (!latestRow) {
      return null;
    }
    return {
      source,
      result: customProviderQuoteRowToTestResult(latestRow, result),
    };
  } catch {
    return null;
  }
}

function latestCustomProviderQuoteRow(
  source: CustomProviderSource,
  result: CustomProviderRowsResult,
  now: Date,
): CustomProviderQuoteRow | null {
  let latest: { row: CustomProviderQuoteRow; timestamp: string } | null = null;
  for (const row of result.rows) {
    if (!Number.isFinite(row.price)) {
      continue;
    }
    const timestamp = customProviderQuoteTimestamp(row.date, source, now);
    if (!latest || timestamp >= latest.timestamp) {
      latest = { row, timestamp };
    }
  }
  return latest?.row ?? null;
}

function customProviderQuoteRowToTestResult(
  row: CustomProviderQuoteRow,
  result: CustomProviderRowsResult,
): TestSourceResult {
  return {
    success: true,
    statusCode: result.statusCode,
    price: row.price,
    open: row.open,
    high: row.high,
    low: row.low,
    volume: row.volume,
    currency: result.currency,
    date: row.date,
    error: null,
    rawResponse: null,
    detectedElements: null,
    detectedTables: null,
  };
}

function customProviderTestSourceRequest(
  source: CustomProviderSource,
  symbol: string,
  quoteCcy: string | null,
  now: Date,
  range?: { from: string; to: string },
): TestSourceRequest {
  const request: TestSourceRequest = {
    format: source.format,
    url: source.url,
    pricePath: source.pricePath,
    symbol,
    currency: quoteCcy ?? "USD",
    datePath: source.datePath ?? undefined,
    dateFormat: source.dateFormat ?? undefined,
    currencyPath: source.currencyPath ?? undefined,
    factor: source.factor ?? undefined,
    invert: source.invert ?? undefined,
    locale: source.locale ?? undefined,
    headers: source.headers ?? undefined,
    openPath: source.openPath ?? undefined,
    highPath: source.highPath ?? undefined,
    lowPath: source.lowPath ?? undefined,
    volumePath: source.volumePath ?? undefined,
    defaultPrice: source.defaultPrice ?? undefined,
    dateTimezone: source.dateTimezone ?? undefined,
  };
  if (source.kind === "historical") {
    const to = range?.to ?? isoDate(now);
    request.to = to;
    request.from = range?.from ?? addDays(to, -90);
  }
  return request;
}

function customProviderQuoteToQuoteWrite(
  asset: AssetMarketSyncRow,
  source: CustomProviderSource,
  result: TestSourceResult,
  now: Date,
): QuoteWrite {
  if (result.price === null || !Number.isFinite(result.price)) {
    throw new Error(`No custom provider quote extracted for ${asset.display_code ?? asset.id}`);
  }
  const timestamp = customProviderQuoteTimestamp(result.date, source, now);
  const day = timestamp.slice(0, 10);
  const close = storedNumber(result.price);
  const quoteSource = `${CUSTOM_SCRAPER_PROVIDER}:${source.providerId}`;
  return {
    id: quoteId(asset.id, day, quoteSource),
    assetId: asset.id,
    day,
    source: quoteSource,
    open: result.open === null ? null : storedNumber(result.open),
    high: result.high === null ? null : storedNumber(result.high),
    low: result.low === null ? null : storedNumber(result.low),
    close,
    adjclose: null,
    volume: result.volume === null ? null : storedNumber(result.volume),
    currency: result.currency ?? asset.quote_ccy,
    notes: null,
    createdAt: timestampNow(),
    timestamp,
  };
}

function customProviderRowsToQuoteWrites(
  asset: AssetMarketSyncRow,
  source: CustomProviderSource,
  result: CustomProviderRowsResult,
  now: Date,
): QuoteWrite[] {
  return result.rows
    .filter((row) => Number.isFinite(row.price))
    .map((row) =>
      customProviderRowToQuoteWrite(asset, source, row, result.currency ?? asset.quote_ccy, now),
    );
}

function customProviderRowToQuoteWrite(
  asset: AssetMarketSyncRow,
  source: CustomProviderSource,
  row: CustomProviderQuoteRow,
  currency: string,
  now: Date,
): QuoteWrite {
  const timestamp = customProviderQuoteTimestamp(row.date, source, now);
  const day = timestamp.slice(0, 10);
  const quoteSource = `${CUSTOM_SCRAPER_PROVIDER}:${source.providerId}`;
  return {
    id: quoteId(asset.id, day, quoteSource),
    assetId: asset.id,
    day,
    source: quoteSource,
    open: row.open === null ? null : storedNumber(row.open),
    high: row.high === null ? null : storedNumber(row.high),
    low: row.low === null ? null : storedNumber(row.low),
    close: storedNumber(row.price),
    adjclose: null,
    volume: row.volume === null ? null : storedNumber(row.volume),
    currency,
    notes: null,
    createdAt: timestampNow(),
    timestamp,
  };
}

function storedNumber(value: number): string {
  return String(value);
}

function customProviderQuoteTimestamp(
  value: string | null,
  source: CustomProviderSource,
  now: Date,
): string {
  const parsed = value ? parseCustomProviderDate(value, source.dateFormat) : null;
  if (!parsed) {
    return now.toISOString();
  }
  return localNoonToUtc(parsed, source.dateTimezone).toISOString();
}

function parseCustomProviderDate(value: string, explicitFormat: string | null): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (explicitFormat) {
    return parseCustomProviderDateFormat(trimmed, explicitFormat);
  }
  const numericDate = parseCustomProviderNumericDate(trimmed);
  if (numericDate) {
    return numericDate;
  }
  const isoDateTime = parseCustomProviderIsoDateTime(trimmed);
  if (isoDateTime) {
    return isoDateTime;
  }
  for (const format of [
    "%d/%m/%Y",
    "%m/%d/%Y",
    "%d.%m.%Y",
    "%d-%m-%Y",
    "%B %d, %Y",
    "%A, %B %d, %Y",
    "%b %d, %Y",
    "%a, %b %d, %Y",
    "%d %b %Y",
    "%d %B %Y",
    "%Y%m%d",
  ]) {
    const parsed = parseCustomProviderDateFormat(trimmed, format);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

function parseCustomProviderIsoDateTime(value: string): string | null {
  const dateOnlyMatch = CUSTOM_PROVIDER_ISO_DATE_RE.exec(value);
  if (dateOnlyMatch?.[1] && isIsoDate(dateOnlyMatch[1])) {
    return dateOnlyMatch[1];
  }

  const rfc3339Match = CUSTOM_PROVIDER_RFC3339_DATETIME_RE.exec(value);
  if (rfc3339Match?.[1] && isIsoDate(rfc3339Match[1])) {
    return rfc3339Match[1];
  }

  const naiveDateTimeMatch = CUSTOM_PROVIDER_NAIVE_DATETIME_RE.exec(value);
  if (naiveDateTimeMatch?.[1] && isIsoDate(naiveDateTimeMatch[1])) {
    return naiveDateTimeMatch[1];
  }

  return null;
}

function parseCustomProviderNumericDate(value: string): string | null {
  if (!/^-?\d+$/.test(value)) {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric)) {
    return null;
  }
  if (numeric > 0 && numeric < 100_000) {
    const date = new Date("1899-12-30T00:00:00Z");
    date.setUTCDate(date.getUTCDate() + numeric);
    return isoDate(date);
  }
  const seconds = numeric > 9_999_999_999 ? Math.trunc(numeric / 1000) : numeric;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : isoDate(date);
}

function parseCustomProviderDateFormat(value: string, format: string): string | null {
  if (format === "%Y-%m-%d") {
    return isIsoDate(value) ? value : null;
  }
  if (format === "%Y%m%d") {
    const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
    return match ? isoDateFromParts(match[1], match[2], match[3]) : null;
  }
  const numericFormats: Record<string, RegExp> = {
    "%d/%m/%Y": /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
    "%m/%d/%Y": /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
    "%d.%m.%Y": /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/,
    "%d-%m-%Y": /^(\d{1,2})-(\d{1,2})-(\d{4})$/,
  };
  const numericMatch = numericFormats[format]?.exec(value);
  if (numericMatch) {
    const [, first, second, year] = numericMatch;
    const dayFirst = format !== "%m/%d/%Y";
    return dayFirst ? isoDateFromParts(year, second, first) : isoDateFromParts(year, first, second);
  }
  return parseNamedMonthDate(value, format);
}

function parseNamedMonthDate(value: string, format: string): string | null {
  const monthNames = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ];
  const monthLookup = new Map<string, number>();
  monthNames.forEach((name, index) => {
    monthLookup.set(name, index + 1);
    monthLookup.set(name.slice(0, 3), index + 1);
  });
  const withoutWeekday = value.replace(/^[A-Za-z]+,\s*/, "").trim();
  let match: RegExpExecArray | null = null;
  if (["%B %d, %Y", "%A, %B %d, %Y", "%b %d, %Y", "%a, %b %d, %Y"].includes(format)) {
    match = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(withoutWeekday);
    if (match) {
      const month = monthLookup.get(match[1].toLowerCase());
      return month ? isoDateFromParts(match[3], String(month), match[2]) : null;
    }
  }
  if (["%d %b %Y", "%d %B %Y"].includes(format)) {
    match = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(value);
    if (match) {
      const month = monthLookup.get(match[2].toLowerCase());
      return month ? isoDateFromParts(match[3], String(month), match[1]) : null;
    }
  }
  return null;
}

function isoDateFromParts(
  yearValue: string | undefined,
  monthValue: string | undefined,
  dayValue: string | undefined,
): string | null {
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  const candidate = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isIsoDate(candidate) ? candidate : null;
}

function localNoonToUtc(date: string, timeZone: string | null): Date {
  const targetUtcMs = Date.parse(`${date}T12:00:00Z`);
  if (!timeZone) {
    return new Date(targetUtcMs);
  }
  try {
    const local = localTimeParts(new Date(targetUtcMs), timeZone);
    const localAsUtcMs = Date.parse(
      `${local.date}T${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}:00Z`,
    );
    return new Date(targetUtcMs - (localAsUtcMs - targetUtcMs));
  } catch {
    return new Date(targetUtcMs);
  }
}

async function fetchYahooResolvedQuote(
  symbol: string,
  fallbackCurrency: string | null,
  fetchImpl: typeof fetch,
  crumbCache: {
    get: () => YahooCrumbData | null;
    set: (crumb: YahooCrumbData) => void;
    clear: () => void;
  },
): Promise<ResolvedQuote> {
  const fixture = fixtureInstrument(symbol);
  if (fixture) {
    const catalog = e2eFixtureCatalog();
    return {
      currency: fixture.currency ?? fallbackCurrency,
      price: fixturePrice(fixture, e2eFixtureAsOf(catalog ?? {})),
      resolvedProviderId: "YAHOO",
    };
  }
  const crumb = await getYahooCrumb(fetchImpl, crumbCache);
  const url = new URL(
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}`,
  );
  url.searchParams.set("modules", "price");
  url.searchParams.set("crumb", crumb.crumb);

  let response: Response;
  try {
    response = await fetchImpl(url, { headers: yahooHeaders(crumb.cookie) });
  } catch (error) {
    throw yahooProviderError(`Backup quote request failed: ${errorMessage(error)}`);
  }
  if (response.status === 401) {
    crumbCache.clear();
    throw new YahooUnauthorizedError("Yahoo authentication expired");
  }
  if (!response.ok) {
    throw yahooProviderError(yahooStatusMessage(response));
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw yahooProviderError(`Failed to parse backup quote response: ${errorMessage(error)}`);
  }
  const price = parseYahooQuoteSummaryPrice(payload);
  const rawPrice = yahooPriceNumber(
    price.regularMarketPrice ?? price.regularMarketPreviousClose ?? price.previousClose,
  );
  if (rawPrice === null) {
    throw yahooProviderError("No valid price in backup response");
  }
  const currency =
    typeof price.currency === "string" && price.currency.trim() !== ""
      ? price.currency.trim()
      : fallbackCurrency;
  return {
    currency,
    price: rawPrice === 0 ? null : rawPrice,
    resolvedProviderId: "YAHOO",
  };
}

function parseYahooQuoteSummaryPrice(payload: unknown): Record<string, unknown> {
  if (!isRecord(payload) || !isRecord(payload.quoteSummary)) {
    throw yahooProviderError("Failed to parse backup quote response: missing quoteSummary");
  }
  const result = payload.quoteSummary.result;
  if (!Array.isArray(result) || result.length === 0 || !isRecord(result[0])) {
    throw new Error("Symbol not found");
  }
  const price = result[0].price;
  if (!isRecord(price)) {
    throw new Error("Symbol not found");
  }
  return price;
}

function yahooPriceNumber(value: unknown): number | null {
  const raw = isRecord(value) ? value.raw : value;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function yahooProviderSymbol(
  instrumentType: string,
  canonical: {
    instrumentSymbol: string | null;
    instrumentExchangeMic: string | null;
    quoteCcy: string | null;
  },
  exchangeCatalog: ExchangeCatalog,
): string | null {
  const symbol = canonical.instrumentSymbol;
  if (!symbol) {
    return null;
  }
  switch (instrumentType) {
    case "CRYPTO":
      return canonical.quoteCcy ? `${symbol}-${canonical.quoteCcy}` : null;
    case "FX":
      return canonical.quoteCcy ? `${symbol}${canonical.quoteCcy}=X` : null;
    case "EQUITY":
    case "OPTION":
    case "METAL": {
      const mic = canonical.instrumentExchangeMic?.toUpperCase();
      const suffix = mic ? exchangeCatalog.yahooSuffixByMic.get(mic) : undefined;
      return suffix ? `${symbol}.${suffix}` : symbol;
    }
    default:
      return symbol;
  }
}

function stripMatchingYahooSuffix(
  symbol: string,
  exchangeMic: string | null,
  exchangeCatalog: ExchangeCatalog,
): string {
  if (!exchangeMic) {
    return symbol;
  }
  const suffix = exchangeCatalog.yahooSuffixByMic.get(exchangeMic.toUpperCase());
  if (!suffix) {
    return symbol;
  }
  const dottedSuffix = `.${suffix}`;
  return symbol.slice(-dottedSuffix.length).toUpperCase() === dottedSuffix.toUpperCase()
    ? symbol.slice(0, -dottedSuffix.length)
    : symbol;
}

function symbolResolutionCandidates(symbol: string): string[] {
  const candidates = [symbol];
  const dotIndex = symbol.lastIndexOf(".");
  if (dotIndex > 0) {
    candidates.push(symbol.slice(0, dotIndex));
  }
  return dedupe(candidates);
}

function normalizePreferredProvider(providerId: string | undefined): string | null {
  const trimmed = providerId?.trim();
  return trimmed ? trimmed : null;
}

function normalizeInstrumentType(instrumentType: string | undefined): string | null {
  const normalized = instrumentType?.trim().toUpperCase();
  if (!normalized) {
    return null;
  }
  return instrumentTypeFromQuoteType(normalized) ?? (normalized === "METAL" ? "METAL" : null);
}

function defaultResolvedQuote(): ResolvedQuote {
  return { currency: null, price: null, resolvedProviderId: null };
}

function latestQuoteSnapshots(
  db: Database,
  assetIds: string[],
  exchangeCatalog: ExchangeCatalog,
  quoteSyncStateExists: boolean,
  now: Date,
): Record<string, LatestQuoteSnapshot> {
  if (assetIds.length === 0) {
    return {};
  }

  const latestQuotes = readLatestQuotes(db, assetIds);
  const assets = readAssetsForQuotes(db, assetIds);
  const syncStates = quoteSyncStateExists ? readQuoteSyncStates(db, assetIds) : new Map();
  const snapshots: Record<string, LatestQuoteSnapshot> = {};

  for (const assetId of assetIds) {
    const asset = assets.get(assetId) ?? null;
    const effectiveMarketDate = marketEffectiveDate(
      now,
      asset?.instrument_exchange_mic ?? null,
      exchangeCatalog,
    );
    const quote = latestQuotes.get(assetId) ?? null;
    if (quote) {
      const reconciledQuote = asset ? reconcileQuoteCurrency(quote, asset) : quote;
      const quoteDate = reconciledQuote.timestamp.slice(0, 10);
      snapshots[assetId] = {
        quote: reconciledQuote,
        isStale: asset?.is_active === 0 || quoteDate < effectiveMarketDate,
        effectiveMarketDate,
        quoteDate,
      };
    } else {
      snapshots[assetId] = {
        quote: null,
        isStale: true,
        effectiveMarketDate,
        quoteDate: null,
        noQuoteReason: noQuoteReason(asset, syncStates.get(assetId) ?? null, now),
      };
    }
  }

  return snapshots;
}

function readLatestQuotes(db: Database, assetIds: string[]): Map<string, Quote> {
  const placeholders = assetIds.map(() => "?").join(", ");
  const rows = db
    .query<QuoteRow, string[]>(
      `
        WITH ranked_quotes AS (
          SELECT
            q.*,
            ROW_NUMBER() OVER (
              PARTITION BY q.asset_id
              ORDER BY
                q.day DESC,
                CASE q.source WHEN 'MANUAL' THEN 1 WHEN 'BROKER' THEN 2 ELSE 3 END ASC
            ) AS rn
          FROM quotes q
          WHERE q.asset_id IN (${placeholders})
        )
        SELECT *
        FROM ranked_quotes
        WHERE rn = 1
        ORDER BY asset_id
      `,
    )
    .all(...assetIds);
  return new Map(rows.map((row) => [row.asset_id, rowToQuote(row)]));
}

function readAssetsForQuotes(db: Database, assetIds: string[]): Map<string, AssetQuoteStateRow> {
  const placeholders = assetIds.map(() => "?").join(", ");
  const rows = db
    .query<AssetQuoteStateRow, string[]>(
      `
        SELECT
          id, quote_ccy, quote_mode, is_active, instrument_exchange_mic,
          instrument_type, metadata
        FROM assets
        WHERE id IN (${placeholders})
      `,
    )
    .all(...assetIds);
  return new Map(rows.map((row) => [row.id, row]));
}

function readQuoteSyncStates(db: Database, assetIds: string[]): Map<string, QuoteSyncStateRow> {
  const placeholders = assetIds.map(() => "?").join(", ");
  const rows = db
    .query<QuoteSyncStateRow, string[]>(
      `
        SELECT
          asset_id, position_closed_date, last_synced_at, data_source,
          sync_priority, error_count, last_error, profile_enriched_at,
          created_at, updated_at
        FROM quote_sync_state
        WHERE asset_id IN (${placeholders})
      `,
    )
    .all(...assetIds);
  return new Map(rows.map((row) => [row.asset_id, row]));
}

function updatePositionStatusFromHoldings(
  db: Database,
  quoteSyncStateExists: boolean,
  currentHoldings: ReadonlyMap<string, Decimal.Value>,
  now: () => Date,
): void {
  if (!quoteSyncStateExists) {
    return;
  }

  db.transaction(() => {
    const holdings = normalizedPositionQuantities(currentHoldings);
    const openAssetIds = Array.from(holdings)
      .filter(([, quantity]) => hasOpenPositionQuantity(quantity))
      .map(([assetId]) => assetId);

    if (openAssetIds.length > 0) {
      const openAssets = readPositionStatusAssets(db, openAssetIds);
      const openSyncStates = readQuoteSyncStates(db, openAssetIds);
      const assetsToReactivate: string[] = [];
      const statesToMarkActive: string[] = [];
      const statesToCreate: string[] = [];

      for (const asset of openAssets.values()) {
        if (asset.kind === "FX") {
          continue;
        }
        if (asset.is_active === 0) {
          assetsToReactivate.push(asset.id);
        }
        if (asset.quote_mode !== "MARKET") {
          continue;
        }

        const state = openSyncStates.get(asset.id);
        if (!state) {
          statesToCreate.push(asset.id);
        } else if (state.position_closed_date !== null) {
          statesToMarkActive.push(asset.id);
        }
      }

      reactivateAssets(db, assetsToReactivate);
      markQuoteSyncStatesActive(db, statesToMarkActive, now);
      createOpenQuoteSyncStates(db, statesToCreate, now);
    }

    const allStates = readAllQuoteSyncStates(db);
    const assets = readPositionStatusAssets(
      db,
      allStates.map((state) => state.asset_id),
    );
    const statesToMarkActive: string[] = [];
    const statesToMarkInactive: string[] = [];

    for (const state of allStates) {
      const asset = assets.get(state.asset_id);
      if (!asset || asset.kind === "FX") {
        continue;
      }

      const hasOpenPosition = hasOpenPositionQuantity(
        holdings.get(state.asset_id) ?? new Decimal(0),
      );
      const stateIsActive = state.position_closed_date === null;
      if (hasOpenPosition && !stateIsActive) {
        statesToMarkActive.push(state.asset_id);
      } else if (!hasOpenPosition && stateIsActive) {
        statesToMarkInactive.push(state.asset_id);
      }
    }

    markQuoteSyncStatesActive(db, statesToMarkActive, now);
    markQuoteSyncStatesInactive(db, statesToMarkInactive, now);
  })();
}

function normalizedPositionQuantities(
  currentHoldings: ReadonlyMap<string, Decimal.Value>,
): Map<string, Decimal> {
  const quantities = new Map<string, Decimal>();
  for (const [assetId, quantity] of currentHoldings) {
    quantities.set(assetId, new Decimal(quantity));
  }
  return quantities;
}

function hasOpenPositionQuantity(quantity: Decimal): boolean {
  return !quantity.isZero() && quantity.abs().gte(QUANTITY_SIGNIFICANCE_THRESHOLD);
}

function readPositionStatusAssets(
  db: Database,
  assetIds: string[],
): Map<string, PositionStatusAssetRow> {
  if (assetIds.length === 0) {
    return new Map();
  }
  const placeholders = assetIds.map(() => "?").join(", ");
  const rows = db
    .query<PositionStatusAssetRow, string[]>(
      `
        SELECT id, kind, quote_mode, is_active
        FROM assets
        WHERE id IN (${placeholders})
      `,
    )
    .all(...assetIds);
  return new Map(rows.map((row) => [row.id, row]));
}

function readAllQuoteSyncStates(db: Database): QuoteSyncStateRow[] {
  return db
    .query<QuoteSyncStateRow, []>(
      `
        SELECT
          asset_id, position_closed_date, last_synced_at, data_source,
          sync_priority, error_count, last_error, profile_enriched_at,
          created_at, updated_at
        FROM quote_sync_state
        ORDER BY sync_priority DESC
      `,
    )
    .all();
}

function reactivateAssets(db: Database, assetIds: string[]): void {
  if (assetIds.length === 0) {
    return;
  }
  const placeholders = assetIds.map(() => "?").join(", ");
  db.query(`UPDATE assets SET is_active = 1 WHERE id IN (${placeholders})`).run(...assetIds);
}

function markQuoteSyncStatesActive(db: Database, assetIds: string[], now: () => Date): void {
  if (assetIds.length === 0) {
    return;
  }
  const timestamp = toRustUtcRfc3339(now());
  const placeholders = assetIds.map(() => "?").join(", ");
  db.query(
    `
      UPDATE quote_sync_state
      SET position_closed_date = NULL, sync_priority = 100, updated_at = ?
      WHERE asset_id IN (${placeholders})
    `,
  ).run(timestamp, ...assetIds);
}

function markQuoteSyncStatesInactive(db: Database, assetIds: string[], now: () => Date): void {
  if (assetIds.length === 0) {
    return;
  }
  const currentTimestamp = toRustUtcRfc3339(now());
  const currentDate = currentTimestamp.slice(0, 10);
  const placeholders = assetIds.map(() => "?").join(", ");
  db.query(
    `
      UPDATE quote_sync_state
      SET position_closed_date = ?, sync_priority = 50, updated_at = ?
      WHERE asset_id IN (${placeholders})
    `,
  ).run(currentDate, currentTimestamp, ...assetIds);
}

function createOpenQuoteSyncStates(db: Database, assetIds: string[], now: () => Date): void {
  if (assetIds.length === 0) {
    return;
  }
  const timestamp = toRustUtcRfc3339(now());
  const statement = db.query(
    `
      INSERT INTO quote_sync_state (
        asset_id, position_closed_date, last_synced_at, data_source, sync_priority,
        error_count, last_error, profile_enriched_at, created_at, updated_at
      )
      VALUES (?, NULL, NULL, '', 100, 0, NULL, NULL, ?, ?)
    `,
  );
  for (const assetId of assetIds) {
    statement.run(assetId, timestamp, timestamp);
  }
}

function readAssetsForMarketSync(
  db: Database,
  assetIds: string[],
): Map<string, AssetMarketSyncRow> {
  const placeholders = assetIds.map(() => "?").join(", ");
  const rows = db
    .query<AssetMarketSyncRow, string[]>(
      `
        SELECT
          id, kind, display_code, quote_ccy, quote_mode, is_active,
          instrument_type, instrument_symbol, instrument_exchange_mic,
          provider_config, metadata
        FROM assets
        WHERE id IN (${placeholders})
      `,
    )
    .all(...assetIds);
  return new Map(rows.map((row) => [row.id, row]));
}

function readUsTreasuryResolveAsset(db: Database, symbol: string): AssetMarketSyncRow | null {
  const normalized = symbol.trim().toUpperCase();
  return db
    .query<AssetMarketSyncRow, [string, string, string]>(
      `
        SELECT
          id, kind, display_code, quote_ccy, quote_mode, is_active,
          instrument_type, instrument_symbol, instrument_exchange_mic,
          provider_config, metadata
        FROM assets
        WHERE UPPER(instrument_type) = 'BOND'
          AND (
            UPPER(instrument_symbol) = ?
            OR UPPER(display_code) = ?
            OR UPPER(instrument_key) = ?
          )
        ORDER BY id ASC
        LIMIT 1
      `,
    )
    .get(normalized, normalized, normalized);
}

function readBroadMarketSyncAssetIds(
  db: Database,
  marketSyncMode: Exclude<MarketSyncMode, { type: "none" }>,
): string[] {
  const activeFilter = marketSyncMode.type === "backfill_history" ? "" : "AND is_active != 0";
  return db
    .query<{ id: string }, []>(
      `
        SELECT id
        FROM assets
        WHERE UPPER(quote_mode) = 'MARKET'
          AND instrument_type IS NOT NULL
          AND instrument_symbol IS NOT NULL
          ${activeFilter}
        ORDER BY id ASC
      `,
    )
    .all()
    .map((row) => row.id);
}

function marketSyncAssetSkipReason(
  asset: AssetMarketSyncRow,
  marketSyncMode: Exclude<MarketSyncMode, { type: "none" }>,
  scope: MarketSyncScope,
): string | null {
  if (asset.quote_mode.toUpperCase() !== "MARKET") {
    return "Manual pricing mode";
  }
  const allowInactive = scope === "broad" && marketSyncMode.type === "backfill_history";
  if (asset.is_active === 0 && !allowInactive) {
    return "Inactive asset";
  }
  if (asset.instrument_type === null || asset.instrument_symbol === null) {
    return "Asset has no instrument mapping";
  }
  return null;
}

function marketSyncResultAssetLabel(asset: AssetMarketSyncRow): string {
  return asset.display_code ?? asset.instrument_symbol ?? asset.id;
}

function effectiveMarketDataProvider(
  state: QuoteSyncStateRow | null,
  asset: AssetMarketSyncRow,
): string {
  const stateProvider = optionalString(state?.data_source);
  const provider =
    stateProvider ??
    preferredProvider(asset.provider_config) ??
    (isUsTreasuryBondAsset(asset) ? US_TREASURY_CALC_PROVIDER : DEFAULT_MARKET_DATA_PROVIDER);
  const trimmed = provider.trim();
  if (isCustomProviderSync(trimmed)) {
    return trimmed;
  }
  return trimmed.toUpperCase();
}

function quoteFetchProvider(provider: string, asset: AssetMarketSyncRow): string {
  const instrumentType = normalizeInstrumentType(asset.instrument_type ?? undefined) ?? "";
  const fallbackProvider = defaultQuoteFetchProvider(asset);
  if (provider === OPENFIGI_PROVIDER) {
    return fallbackProvider;
  }
  if (provider === ALPHA_VANTAGE_PROVIDER && !["EQUITY", "CRYPTO", "FX"].includes(instrumentType)) {
    return fallbackProvider;
  }
  if (provider === MARKETDATA_APP_PROVIDER && instrumentType !== "EQUITY") {
    return fallbackProvider;
  }
  if (provider === METAL_PRICE_API_PROVIDER && instrumentType !== "METAL") {
    return fallbackProvider;
  }
  if (provider === FINNHUB_PROVIDER && !["EQUITY", "CRYPTO", "FX"].includes(instrumentType)) {
    return fallbackProvider;
  }
  if (provider === BOERSE_FRANKFURT_PROVIDER && !["EQUITY", "BOND"].includes(instrumentType)) {
    return fallbackProvider;
  }
  return provider;
}

function defaultQuoteFetchProvider(asset: AssetMarketSyncRow): string {
  return isUsTreasuryBondAsset(asset) ? US_TREASURY_CALC_PROVIDER : DEFAULT_MARKET_DATA_PROVIDER;
}

function quoteSyncErrorCount(state: QuoteSyncStateRow | null, provider: string): number {
  return quoteSyncStateProviderMatches(state, provider) ? (state?.error_count ?? 0) : 0;
}

function quoteSyncStateProviderMatches(state: QuoteSyncStateRow | null, provider: string): boolean {
  const stateProvider = optionalString(state?.data_source);
  if (stateProvider === null) {
    return false;
  }
  if (isCustomProviderSync(provider) || isCustomProviderSync(stateProvider)) {
    return stateProvider.trim() === provider.trim();
  }
  return stateProvider.trim().toUpperCase() === provider.trim().toUpperCase();
}

function isCustomProviderSync(provider: string): boolean {
  return (
    provider === CUSTOM_SCRAPER_PROVIDER ||
    provider.startsWith(`${CUSTOM_SCRAPER_PROVIDER}:`) ||
    provider.startsWith("CUSTOM:")
  );
}

function customProviderCodeForMarketSync(providerConfig: string | null): string | null {
  const parsed = parseJsonValue(providerConfig);
  if (!isRecord(parsed)) {
    return null;
  }
  const codeFromConfig = optionalString(parsed.custom_provider_code);
  if (codeFromConfig) {
    return codeFromConfig;
  }
  const configuredProvider = preferredProvider(providerConfig);
  return configuredProvider ? customProviderCodeFromProviderId(configuredProvider) : null;
}

function customProviderCodeFromProviderId(provider: string): string | null {
  for (const prefix of [`${CUSTOM_SCRAPER_PROVIDER}:`, "CUSTOM:"]) {
    if (provider.startsWith(prefix)) {
      const code = provider.slice(prefix.length).trim();
      return code || null;
    }
  }
  return null;
}

function customProviderSyncSymbol(asset: AssetMarketSyncRow, providerCode: string): string | null {
  return (
    providerOverrideSymbol(asset.provider_config, `CUSTOM:${providerCode}`) ??
    optionalString(asset.instrument_symbol)
  );
}

function customProviderSourceSymbol(
  asset: AssetMarketSyncRow,
  source: CustomProviderSource,
): string | null {
  return (
    providerOverrideSymbol(asset.provider_config, `CUSTOM:${source.providerId}`) ??
    optionalString(asset.instrument_symbol)
  );
}

function yahooSyncSymbol(
  asset: AssetMarketSyncRow,
  exchangeCatalog: ExchangeCatalog,
): string | null {
  const override = providerOverrideSymbol(asset.provider_config, DEFAULT_MARKET_DATA_PROVIDER);
  if (override) {
    return override;
  }
  return yahooProviderSymbol(
    asset.instrument_type ?? "",
    {
      instrumentSymbol: asset.instrument_symbol,
      instrumentExchangeMic: asset.instrument_exchange_mic,
      quoteCcy: asset.quote_ccy,
    },
    exchangeCatalog,
  );
}

function providerOverrideSymbol(providerConfig: string | null, provider: string): string | null {
  const override = providerOverrideRecord(providerConfig, provider);
  if (!override) {
    return null;
  }
  const type = optionalString(override.type);
  const symbol = optionalString(override.symbol);
  if (symbol && type !== "crypto_pair" && type !== "fx_pair") {
    return symbol;
  }
  const from = optionalString(override.from);
  const to = optionalString(override.to);
  if (type === "fx_pair" && from && to) {
    return `${from}${to}=X`;
  }
  const market = optionalString(override.market);
  if (type === "crypto_pair" && symbol && market) {
    return `${symbol}-${market}`;
  }
  return null;
}

function providerOverrideRecord(
  providerConfig: string | null,
  provider: string,
): Record<string, unknown> | null {
  const parsed = parseJsonValue(providerConfig);
  if (!isRecord(parsed) || !isRecord(parsed.overrides)) {
    return null;
  }
  const override = parsed.overrides[provider];
  if (!isRecord(override)) {
    return null;
  }
  return override;
}

function marketSyncWindow(
  db: Database,
  asset: AssetMarketSyncRow,
  provider: string,
  marketSyncMode: Exclude<MarketSyncMode, { type: "none" }>,
  now: Date,
  exchangeCatalog: ExchangeCatalog,
  options: { scope: MarketSyncScope; state: QuoteSyncStateRow | null },
): { startDate: string; endDate: string; purgeProviderQuotes: boolean } {
  const endDate = marketEffectiveDate(now, asset.instrument_exchange_mic, exchangeCatalog);
  if (marketSyncMode.type === "refetch_recent") {
    return {
      startDate: addDays(endDate, -marketSyncMode.days),
      endDate,
      purgeProviderQuotes: false,
    };
  }
  if (marketSyncMode.type === "backfill_history") {
    return {
      startDate: addDays(endDate, -marketSyncMode.days),
      endDate,
      purgeProviderQuotes: shouldPurgeProviderQuotesForBackfill(db, asset.id, options),
    };
  }

  const latestProviderDay = readLatestProviderQuoteDay(db, asset.id, provider);
  const startDate = latestProviderDay
    ? minIsoDate(
        addDays(latestProviderDay, -MIN_SYNC_LOOKBACK_DAYS),
        addDays(endDate, -QUOTE_HISTORY_BUFFER_DAYS),
      )
    : addDays(endDate, -QUOTE_HISTORY_BUFFER_DAYS);
  return { startDate, endDate, purgeProviderQuotes: false };
}

function shouldPurgeProviderQuotesForBackfill(
  db: Database,
  assetId: string,
  options: { scope: MarketSyncScope; state: QuoteSyncStateRow | null },
): boolean {
  if (options.scope === "targeted") {
    return true;
  }
  if (options.state?.last_synced_at !== null && options.state?.last_synced_at !== undefined) {
    return true;
  }
  return assetHasActivityReference(db, assetId);
}

function assetHasActivityReference(db: Database, assetId: string): boolean {
  if (!tableExists(db, "activities")) {
    return false;
  }
  const row = db
    .query<{ found: number }, [string]>(
      `
        SELECT 1 AS found
        FROM activities
        WHERE asset_id = ?
        LIMIT 1
      `,
    )
    .get(assetId);
  return row != null;
}

function readLatestProviderQuoteDay(
  db: Database,
  assetId: string,
  provider: string,
): string | null {
  const row = db
    .query<{ day: string }, [string, string]>(
      `
        SELECT day
        FROM quotes
        WHERE asset_id = ? AND source = ?
        ORDER BY day DESC
        LIMIT 1
      `,
    )
    .get(assetId, provider);
  return row?.day ?? null;
}

function deleteProviderQuotesForAsset(db: Database, assetId: string, provider: string): void {
  db.query("DELETE FROM quotes WHERE asset_id = ? AND source = ?").run(assetId, provider);
}

function updateQuoteSyncStateAfterSync(
  db: Database,
  quoteSyncStateExists: boolean,
  assetId: string,
  provider: string,
): void {
  if (!quoteSyncStateExists) {
    return;
  }
  const timestamp = timestampNow();
  db.query(
    `
      INSERT INTO quote_sync_state (
        asset_id, last_synced_at, data_source, sync_priority, error_count,
        last_error, created_at, updated_at
      )
      VALUES (?, ?, ?, 1, 0, NULL, ?, ?)
      ON CONFLICT(asset_id) DO UPDATE SET
        last_synced_at = excluded.last_synced_at,
        data_source = excluded.data_source,
        error_count = 0,
        last_error = NULL,
        updated_at = excluded.updated_at
    `,
  ).run(assetId, timestamp, provider, timestamp, timestamp);
}

function updateQuoteSyncStateAfterFailure(
  db: Database,
  quoteSyncStateExists: boolean,
  assetId: string,
  provider: string,
  error: string,
): void {
  if (!quoteSyncStateExists) {
    return;
  }
  const timestamp = timestampNow();
  db.query(
    `
      INSERT INTO quote_sync_state (
        asset_id, last_synced_at, data_source, sync_priority, error_count,
        last_error, created_at, updated_at
      )
      VALUES (?, NULL, ?, 1, 1, ?, ?, ?)
      ON CONFLICT(asset_id) DO UPDATE SET
        data_source = excluded.data_source,
        error_count = CASE
          WHEN quote_sync_state.data_source = excluded.data_source
            THEN quote_sync_state.error_count + 1
          ELSE 1
        END,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at
    `,
  ).run(assetId, provider, error, timestamp, timestamp);
}

function quoteSyncErrorSnapshots(db: Database): QuoteSyncErrorSnapshot[] {
  return db
    .query<
      {
        asset_id: string;
        symbol: string | null;
        quote_mode: string | null;
        error_count: number;
        last_error: string | null;
        has_synced_before: number;
      },
      []
    >(
      `
        SELECT qss.asset_id,
          COALESCE(a.display_code, a.instrument_symbol, qss.asset_id) AS symbol,
          COALESCE(a.quote_mode, 'MARKET') AS quote_mode,
          qss.error_count,
          qss.last_error,
          EXISTS (
            SELECT 1
            FROM quotes q
            WHERE q.asset_id = qss.asset_id
          ) AS has_synced_before
        FROM quote_sync_state qss
        LEFT JOIN assets a ON a.id = qss.asset_id
        WHERE qss.error_count > 0
        ORDER BY qss.error_count DESC, qss.asset_id ASC
      `,
    )
    .all()
    .map((row) => ({
      assetId: row.asset_id,
      symbol: row.symbol ?? row.asset_id,
      quoteMode: row.quote_mode ?? "MARKET",
      errorCount: row.error_count,
      lastError: row.last_error,
      hasSyncedBefore: row.has_synced_before !== 0,
    }));
}

function reconcileQuoteCurrency(quote: Quote, asset: AssetQuoteStateRow): Quote {
  const effectiveCurrency = resolveEffectiveQuoteCurrency(asset.quote_ccy, quote.currency);
  return effectiveCurrency ? { ...quote, currency: effectiveCurrency } : quote;
}

function resolveEffectiveQuoteCurrency(
  assetQuoteCcy: string,
  quoteCurrency: string,
): string | null {
  if (!assetQuoteCcy || !quoteCurrency || assetQuoteCcy === quoteCurrency) {
    return null;
  }
  if (normalizeCurrencyCode(assetQuoteCcy) !== normalizeCurrencyCode(quoteCurrency)) {
    return null;
  }
  const assetIsMinor = isMinorCurrency(assetQuoteCcy);
  const quoteIsMinor = isMinorCurrency(quoteCurrency);
  if (assetIsMinor && !quoteIsMinor) {
    return assetQuoteCcy;
  }
  if (quoteIsMinor && !assetIsMinor) {
    return quoteCurrency;
  }
  return assetQuoteCcy;
}

function noQuoteReason(
  asset: AssetQuoteStateRow | null,
  state: QuoteSyncStateRow | null,
  now: Date,
): NoQuoteReason {
  if (asset) {
    if (asset.quote_mode === "MANUAL") {
      return { code: "MANUAL_PRICING", message: "Quote mode is Manual" };
    }
    if (asset.is_active === 0) {
      return { code: "INACTIVE", message: "Asset is inactive" };
    }
    const bondMaturity = metadataDate(asset.metadata, "bond", "maturityDate");
    if (asset.instrument_type === "BOND" && bondMaturity !== null && bondMaturity < today(now)) {
      return { code: "MATURED_BOND", message: "Bond has matured" };
    }
    const optionExpiration = metadataDate(asset.metadata, "option", "expiration");
    if (
      asset.instrument_type === "OPTION" &&
      optionExpiration !== null &&
      optionExpiration < today(now)
    ) {
      return { code: "EXPIRED_OPTION", message: "Option has expired" };
    }
  }

  if (state) {
    if (state.error_count >= MAX_SYNC_ERRORS) {
      return { code: "TOO_MANY_ERRORS", message: "Sync paused after repeated errors" };
    }
    const lastError = state.last_error?.trim();
    if (lastError) {
      return { code: "LAST_ERROR", message: `Last sync error: ${lastError}` };
    }
    if (state.last_synced_at === null) {
      return { code: "PENDING_SYNC", message: "No provider quote has been synced yet" };
    }
  }

  return { code: "NO_DATA", message: "No data available from provider yet" };
}

async function marketDataProviderApiKey(
  secretService: SecretService | undefined,
  provider: string,
): Promise<string | null> {
  const apiKey = (await secretService?.getSecret(provider)) ?? null;
  if (apiKey === null) {
    return null;
  }
  const trimmed = apiKey.trim();
  return trimmed === "" ? null : trimmed;
}

async function fetchUsTreasuryHistoricalQuotes(
  assetId: string,
  instrument: UsTreasuryBondInstrument,
  startDate: string,
  endDate: string,
  fetchImpl: typeof fetch,
  curveCache: Map<number, UsTreasuryYieldCurve[]>,
): Promise<YahooHistoricalQuote[]> {
  for (let year = Number(startDate.slice(0, 4)); year <= Number(endDate.slice(0, 4)); year += 1) {
    await ensureUsTreasuryCurves(year, fetchImpl, curveCache);
  }

  const quotes: YahooHistoricalQuote[] = [];
  for (let year = Number(startDate.slice(0, 4)); year <= Number(endDate.slice(0, 4)); year += 1) {
    for (const curve of curveCache.get(year) ?? []) {
      if (curve.date < startDate || curve.date > endDate) {
        continue;
      }
      const quote = usTreasuryQuoteForCurve(assetId, instrument, curve);
      if (quote !== null) {
        quotes.push(quote);
      }
    }
  }

  return quotes.sort((left, right) => left.day.localeCompare(right.day));
}

async function fetchUsTreasuryLatestQuote(
  assetId: string,
  instrument: UsTreasuryBondInstrument,
  fetchImpl: typeof fetch,
  curveCache: Map<number, UsTreasuryYieldCurve[]>,
  now: Date,
): Promise<YahooHistoricalQuote> {
  const quoteDate = today(now);
  const curve = await usTreasuryCurveForDate(quoteDate, fetchImpl, curveCache);
  const quote = usTreasuryQuoteForCurve(assetId, instrument, curve);
  if (quote === null) {
    throw new Error("Could not calculate US Treasury price");
  }
  return quote;
}

async function usTreasuryCurveForDate(
  date: string,
  fetchImpl: typeof fetch,
  curveCache: Map<number, UsTreasuryYieldCurve[]>,
): Promise<UsTreasuryYieldCurve> {
  const year = Number(date.slice(0, 4));
  await ensureUsTreasuryCurves(year, fetchImpl, curveCache);
  let best: UsTreasuryYieldCurve | null = null;
  for (const curve of curveCache.get(year) ?? []) {
    if (curve.date <= date && (best === null || curve.date > best.date)) {
      best = curve;
    }
  }
  if (best === null) {
    throw new Error("No data for date range");
  }
  return best;
}

async function ensureUsTreasuryCurves(
  year: number,
  fetchImpl: typeof fetch,
  curveCache: Map<number, UsTreasuryYieldCurve[]>,
): Promise<void> {
  if (curveCache.has(year)) {
    return;
  }
  const url = new URL(US_TREASURY_YIELD_CURVE_URL);
  url.searchParams.set("data", "daily_treasury_yield_curve");
  url.searchParams.set("field_tdr_date_value", String(year));

  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch (error) {
    throw new Error(`${US_TREASURY_CALC_PROVIDER}: HTTP request failed: ${errorMessage(error)}`);
  }
  if (!response.ok) {
    throw new Error(`${US_TREASURY_CALC_PROVIDER}: HTTP ${formatRustHttpStatus(response.status)}`);
  }
  let xml: string;
  try {
    xml = await response.text();
  } catch (error) {
    throw new Error(
      `${US_TREASURY_CALC_PROVIDER}: Failed to read response: ${errorMessage(error)}`,
    );
  }
  curveCache.set(year, parseUsTreasuryYieldCurveXml(xml));
}

function usTreasuryQuoteForCurve(
  assetId: string,
  instrument: UsTreasuryBondInstrument,
  curve: UsTreasuryYieldCurve,
): YahooHistoricalQuote | null {
  const price = calculateUsTreasuryPrice(
    curve,
    curve.date,
    instrument.maturityDate,
    instrument.couponRate,
    instrument.couponFrequency,
    instrument.faceValue,
  );
  if (price === null) {
    return null;
  }
  const close = decimalString(price);
  if (close === null) {
    return null;
  }
  const timestamp = `${curve.date}T16:00:00.000Z`;
  return {
    assetId,
    day: curve.date,
    timestamp,
    source: US_TREASURY_CALC_PROVIDER,
    open: close,
    high: close,
    low: close,
    close,
    adjclose: close,
    volume: "0",
    currency: instrument.currency,
  };
}

function calculateUsTreasuryPrice(
  curve: UsTreasuryYieldCurve,
  settlementDate: string,
  maturityDate: string,
  couponRate: number,
  couponFrequency: string,
  faceValue: number,
): number | null {
  const daysToMaturity = daysBetweenIsoDates(settlementDate, maturityDate);
  if (daysToMaturity === null) {
    return null;
  }
  const yearsToMaturity = daysToMaturity / 365.25;
  if (yearsToMaturity <= 0) {
    return 1;
  }
  const yieldPercent = interpolateUsTreasuryYield(curve, yearsToMaturity);
  if (yieldPercent === null) {
    return null;
  }
  const yieldDecimal = yieldPercent / 100;
  let price: number;
  if (couponFrequency === "ZERO" || couponRate === 0) {
    price = faceValue / (1 + yieldDecimal * (daysToMaturity / 360));
  } else {
    const frequency = usTreasuryCouponFrequencyPerYear(couponFrequency);
    const couponPayment = (faceValue * couponRate) / frequency;
    const periods = Math.ceil(yearsToMaturity * frequency);
    const periodYield = yieldDecimal / frequency;
    let presentValue = 0;
    for (let period = 1; period <= periods; period += 1) {
      presentValue += couponPayment / (1 + periodYield) ** period;
    }
    presentValue += faceValue / (1 + periodYield) ** periods;
    price = presentValue;
  }
  const fractionOfPar = price / faceValue;
  return Number.isFinite(fractionOfPar) ? fractionOfPar : null;
}

function interpolateUsTreasuryYield(curve: UsTreasuryYieldCurve, years: number): number | null {
  const points = curve.points;
  if (points.length === 0) {
    return null;
  }
  if (years <= (points[0]?.tenorYears ?? 0)) {
    return points[0]?.yieldPercent ?? null;
  }
  const last = points.at(-1);
  if (last && years >= last.tenorYears) {
    return last.yieldPercent;
  }
  for (let index = 0; index < points.length - 1; index += 1) {
    const left = points[index];
    const right = points[index + 1];
    if (!left || !right) {
      continue;
    }
    if (left.tenorYears <= years && years <= right.tenorYears) {
      const ratio = (years - left.tenorYears) / (right.tenorYears - left.tenorYears);
      return left.yieldPercent + ratio * (right.yieldPercent - left.yieldPercent);
    }
  }
  return null;
}

function usTreasuryCouponFrequencyPerYear(couponFrequency: string): number {
  if (couponFrequency === "ANNUAL") {
    return 1;
  }
  if (couponFrequency === "QUARTERLY") {
    return 4;
  }
  return 2;
}

function parseUsTreasuryYieldCurveXml(xml: string): UsTreasuryYieldCurve[] {
  const curves: UsTreasuryYieldCurve[] = [];
  for (const rawEntry of xml.split("<entry>").slice(1)) {
    const entryEnd = rawEntry.indexOf("</entry>");
    const entry = rawEntry.slice(0, entryEnd < 0 ? rawEntry.length : entryEnd);
    const contentStart = entry.indexOf("<content");
    if (contentStart < 0) {
      continue;
    }
    const content = entry.slice(contentStart);
    const dateValue = extractUsTreasuryXmlValue(content, "NEW_DATE");
    const date = dateValue?.slice(0, 10) ?? null;
    if (date === null || !isIsoDate(date)) {
      continue;
    }
    const points: UsTreasuryYieldCurve["points"] = [];
    for (const [label, tenorYears] of US_TREASURY_TENORS) {
      const value = extractUsTreasuryXmlValue(content, label);
      const yieldPercent = value === null ? null : Number(value);
      if (yieldPercent !== null && Number.isFinite(yieldPercent)) {
        points.push({ tenorYears, yieldPercent });
      }
    }
    if (points.length > 0) {
      points.sort((left, right) => left.tenorYears - right.tenorYears);
      curves.push({ date, points });
    }
  }
  if (curves.length === 0) {
    throw new Error(`${US_TREASURY_CALC_PROVIDER}: No yield curve data found in XML`);
  }
  return curves;
}

const US_TREASURY_TENORS: ReadonlyArray<readonly [string, number]> = [
  ["BC_1MONTH", 1 / 12],
  ["BC_2MONTH", 2 / 12],
  ["BC_3MONTH", 3 / 12],
  ["BC_4MONTH", 4 / 12],
  ["BC_6MONTH", 6 / 12],
  ["BC_1YEAR", 1],
  ["BC_2YEAR", 2],
  ["BC_3YEAR", 3],
  ["BC_5YEAR", 5],
  ["BC_7YEAR", 7],
  ["BC_10YEAR", 10],
  ["BC_20YEAR", 20],
  ["BC_30YEAR", 30],
];

function extractUsTreasuryXmlValue(xml: string, tag: string): string | null {
  for (const pattern of [`d:${tag}`, tag]) {
    const openPrefix = `<${pattern}`;
    const tagStart = xml.indexOf(openPrefix);
    if (tagStart < 0) {
      continue;
    }
    const afterTag = xml.slice(tagStart + openPrefix.length);
    const contentStart = afterTag.indexOf(">");
    if (contentStart < 0) {
      continue;
    }
    const afterOpen = afterTag.slice(contentStart + 1);
    const close = `</${pattern}>`;
    const end = afterOpen.indexOf(close);
    if (end >= 0) {
      return afterOpen.slice(0, end).trim();
    }
  }
  return null;
}

function usTreasuryInstrumentForAsset(
  asset: AssetMarketSyncRow,
  exchangeCatalog: ExchangeCatalog,
): UsTreasuryBondInstrument | null {
  if (normalizeInstrumentType(asset.instrument_type ?? undefined) !== "BOND") {
    return null;
  }
  const metadata = usTreasuryBondMetadata(asset.metadata);
  const isin = (
    providerOverrideSymbol(asset.provider_config, US_TREASURY_CALC_PROVIDER) ??
    metadata?.isin ??
    metadataIdentifier(asset.metadata, "isin") ??
    optionalString(asset.instrument_symbol)
  )?.toUpperCase();
  if (!isin || !isUsTreasuryIsin(isin)) {
    return null;
  }
  if (metadata?.maturityDate === undefined) {
    return null;
  }
  return {
    isin,
    maturityDate: metadata.maturityDate,
    couponRate: metadata.couponRate ?? 0,
    faceValue: metadata.faceValue ?? 1000,
    couponFrequency: metadata.couponFrequency ?? "SEMI_ANNUAL",
    currency: providerCurrencyFromExchange(
      asset.instrument_exchange_mic,
      asset.quote_ccy,
      exchangeCatalog,
    ),
  };
}

function usTreasuryInstrumentFailureMessage(asset: AssetMarketSyncRow): string {
  if (normalizeInstrumentType(asset.instrument_type ?? undefined) !== "BOND") {
    return "US_TREASURY_CALC only supports bonds";
  }
  const metadata = usTreasuryBondMetadata(asset.metadata);
  const isin = (
    providerOverrideSymbol(asset.provider_config, US_TREASURY_CALC_PROVIDER) ??
    metadata?.isin ??
    metadataIdentifier(asset.metadata, "isin") ??
    optionalString(asset.instrument_symbol)
  )?.toUpperCase();
  if (!isin || !isUsTreasuryIsin(isin)) {
    return `${isin ?? asset.instrument_symbol ?? asset.id} is not a US Treasury ISIN`;
  }
  return "Bond metadata (coupon, maturity) required for calculated pricing";
}

function isUsTreasuryBondAsset(asset: AssetMarketSyncRow): boolean {
  if (normalizeInstrumentType(asset.instrument_type ?? undefined) !== "BOND") {
    return false;
  }
  const metadata = usTreasuryBondMetadata(asset.metadata);
  const isin =
    metadata?.isin ??
    metadataIdentifier(asset.metadata, "isin") ??
    optionalString(asset.instrument_symbol);
  return isin === null ? false : isUsTreasuryIsin(isin.toUpperCase());
}

function isUsTreasuryIsin(isin: string): boolean {
  return isin.startsWith("US912");
}

function usTreasuryBondMetadata(metadata: string | null): {
  maturityDate?: string;
  couponRate?: number;
  faceValue?: number;
  couponFrequency?: string;
  isin?: string;
} | null {
  const parsed = parseJsonValue(metadata);
  if (!isRecord(parsed) || !isRecord(parsed.bond)) {
    return null;
  }
  const maturityDate = optionalString(parsed.bond.maturityDate ?? parsed.bond.maturity_date);
  const couponRate = decimalNumber(parsed.bond.couponRate ?? parsed.bond.coupon_rate);
  const faceValue = decimalNumber(parsed.bond.faceValue ?? parsed.bond.face_value);
  const couponFrequency = optionalString(
    parsed.bond.couponFrequency ?? parsed.bond.coupon_frequency,
  );
  const isin = optionalString(parsed.bond.isin);
  return {
    ...(maturityDate && isIsoDate(maturityDate) ? { maturityDate } : {}),
    ...(couponRate !== null ? { couponRate } : {}),
    ...(faceValue !== null ? { faceValue } : {}),
    ...(couponFrequency
      ? { couponFrequency: normalizeUsTreasuryCouponFrequency(couponFrequency) }
      : {}),
    ...(isin ? { isin: isin.toUpperCase() } : {}),
  };
}

function normalizeUsTreasuryCouponFrequency(couponFrequency: string): string {
  const normalized = couponFrequency.trim().toUpperCase().replace("-", "_");
  if (normalized === "SEMIANNUAL") {
    return "SEMI_ANNUAL";
  }
  return normalized || "SEMI_ANNUAL";
}

function decimalNumber(value: unknown): number | null {
  const decimal = decimalString(value);
  if (decimal === null) {
    return null;
  }
  const parsed = Number(decimal);
  return Number.isFinite(parsed) ? parsed : null;
}

function daysBetweenIsoDates(start: string, end: string): number | null {
  if (!isIsoDate(start) || !isIsoDate(end)) {
    return null;
  }
  return Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
}

async function fetchAlphaVantageHistoricalQuotes(
  assetId: string,
  instrument: AlphaVantageInstrument,
  startDate: string,
  endDate: string,
  fetchImpl: typeof fetch,
  apiKey: string,
): Promise<YahooHistoricalQuote[]> {
  const quotes = await fetchAlphaVantageQuotes(assetId, instrument, fetchImpl, apiKey);
  const filtered = quotes.filter((quote) => quote.day >= startDate && quote.day <= endDate);
  if (filtered.length === 0) {
    throw new Error("No data for date range");
  }
  return filtered;
}

async function fetchAlphaVantageLatestQuote(
  assetId: string,
  instrument: AlphaVantageInstrument,
  fetchImpl: typeof fetch,
  apiKey: string,
): Promise<YahooHistoricalQuote> {
  const quotes = await fetchAlphaVantageQuotes(assetId, instrument, fetchImpl, apiKey);
  const quote = quotes.at(-1);
  if (!quote) {
    throw new Error("No data for date range");
  }
  return quote;
}

async function fetchAlphaVantageQuotes(
  assetId: string,
  instrument: AlphaVantageInstrument,
  fetchImpl: typeof fetch,
  apiKey: string,
): Promise<YahooHistoricalQuote[]> {
  if (instrument.kind === "equity") {
    const payload = await fetchAlphaVantageJson(
      [
        ["function", "TIME_SERIES_DAILY"],
        ["symbol", instrument.symbol],
        ["outputsize", "compact"],
      ],
      fetchImpl,
      apiKey,
    );
    return parseAlphaVantageEquityQuotes(payload, assetId, instrument.symbol, instrument.currency);
  }
  if (instrument.kind === "option") {
    const payload = await fetchAlphaVantageJson(
      [
        ["function", "REALTIME_OPTIONS"],
        ["symbol", instrument.underlying],
        ["contract", instrument.symbol],
      ],
      fetchImpl,
      apiKey,
    );
    return [parseAlphaVantageOptionQuote(payload, assetId, instrument.symbol, instrument.currency)];
  }
  if (instrument.kind === "fx") {
    const payload = await fetchAlphaVantageJson(
      [
        ["function", "FX_DAILY"],
        ["from_symbol", instrument.from],
        ["to_symbol", instrument.to],
        ["outputsize", "full"],
      ],
      fetchImpl,
      apiKey,
    );
    return parseAlphaVantageFxQuotes(payload, assetId, instrument.from, instrument.to);
  }
  const payload = await fetchAlphaVantageJson(
    [
      ["function", "DIGITAL_CURRENCY_DAILY"],
      ["symbol", instrument.symbol],
      ["market", instrument.market],
    ],
    fetchImpl,
    apiKey,
  );
  return parseAlphaVantageCryptoQuotes(payload, assetId, instrument.symbol, instrument.market);
}

async function fetchAlphaVantageJson(
  params: Array<[string, string]>,
  fetchImpl: typeof fetch,
  apiKey: string,
): Promise<unknown> {
  const url = new URL(ALPHA_VANTAGE_BASE_URL);
  for (const [key, value] of params) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("apikey", apiKey);
  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch (error) {
    throw new Error(`${ALPHA_VANTAGE_PROVIDER}: Request failed: ${errorMessage(error)}`);
  }
  if (response.status === 429) {
    throw new Error(`${ALPHA_VANTAGE_PROVIDER}: rate limited`);
  }
  if (!response.ok) {
    throw new Error(`${ALPHA_VANTAGE_PROVIDER}: HTTP ${formatRustHttpStatus(response.status)}`);
  }
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`${ALPHA_VANTAGE_PROVIDER}: Failed to parse response: ${errorMessage(error)}`);
  }
}

function parseAlphaVantageEquityQuotes(
  payload: unknown,
  assetId: string,
  symbol: string,
  currency: string,
): YahooHistoricalQuote[] {
  if (!isRecord(payload)) {
    throw new Error(`${ALPHA_VANTAGE_PROVIDER}: Failed to parse response`);
  }
  checkAlphaVantageApiError(payload);
  const timeSeries = payload["Time Series (Daily)"];
  if (!isRecord(timeSeries)) {
    throw new Error(`No data for symbol: ${symbol}`);
  }
  const quotes: YahooHistoricalQuote[] = [];
  for (const [date, value] of Object.entries(timeSeries)) {
    if (!isRecord(value)) {
      continue;
    }
    const timestamp = alphaVantageDateTimestamp(date);
    const open = decimalString(value["1. open"]);
    const high = decimalString(value["2. high"]);
    const low = decimalString(value["3. low"]);
    const close = decimalString(value["4. close"]);
    const volume = decimalString(value["5. volume"]);
    if (
      timestamp === null ||
      open === null ||
      high === null ||
      low === null ||
      close === null ||
      volume === null
    ) {
      continue;
    }
    quotes.push(
      alphaVantageQuoteFromDecimals(assetId, timestamp, open, high, low, close, volume, currency),
    );
  }
  return alphaVantageSortedQuotes(quotes);
}

function parseAlphaVantageOptionQuote(
  payload: unknown,
  assetId: string,
  occSymbol: string,
  currency: string,
): YahooHistoricalQuote {
  if (!isRecord(payload)) {
    throw new Error(`${ALPHA_VANTAGE_PROVIDER}: Failed to parse options response`);
  }
  checkAlphaVantageApiError(payload);
  const contracts = payload.data;
  if (!Array.isArray(contracts) || contracts.length === 0) {
    throw new Error(`No options data for: ${occSymbol}`);
  }
  const contract = contracts[0];
  if (!isRecord(contract)) {
    throw new Error(`${ALPHA_VANTAGE_PROVIDER}: Failed to parse options response`);
  }
  const close = optionalDecimal(contract.last) ?? optionalDecimal(contract.mark);
  if (close === null) {
    throw new Error(`${ALPHA_VANTAGE_PROVIDER}: No price data for contract: ${occSymbol}`);
  }
  const timestamp =
    alphaVantageDateTimestamp(optionalString(contract.date) ?? "") ?? new Date().toISOString();
  return alphaVantageQuoteFromDecimals(
    assetId,
    timestamp,
    null,
    null,
    null,
    close,
    decimalString(contract.volume),
    currency,
  );
}

function parseAlphaVantageFxQuotes(
  payload: unknown,
  assetId: string,
  from: string,
  to: string,
): YahooHistoricalQuote[] {
  if (!isRecord(payload)) {
    throw new Error(`${ALPHA_VANTAGE_PROVIDER}: Failed to parse response`);
  }
  checkAlphaVantageApiError(payload);
  const timeSeries = payload["Time Series FX (Daily)"];
  if (!isRecord(timeSeries)) {
    throw new Error(`No data for FX pair: ${from}/${to}`);
  }
  const quotes: YahooHistoricalQuote[] = [];
  for (const [date, value] of Object.entries(timeSeries)) {
    if (!isRecord(value)) {
      continue;
    }
    const timestamp = alphaVantageDateTimestamp(date);
    const open = decimalString(value["1. open"]);
    const high = decimalString(value["2. high"]);
    const low = decimalString(value["3. low"]);
    const close = decimalString(value["4. close"]);
    if (timestamp === null || open === null || high === null || low === null || close === null) {
      continue;
    }
    quotes.push(
      alphaVantageQuoteFromDecimals(assetId, timestamp, open, high, low, close, null, to),
    );
  }
  return alphaVantageSortedQuotes(quotes);
}

function parseAlphaVantageCryptoQuotes(
  payload: unknown,
  assetId: string,
  symbol: string,
  market: string,
): YahooHistoricalQuote[] {
  if (!isRecord(payload)) {
    throw new Error(`${ALPHA_VANTAGE_PROVIDER}: Failed to parse response`);
  }
  checkAlphaVantageApiError(payload);
  const timeSeries = payload["Time Series (Digital Currency Daily)"];
  if (!isRecord(timeSeries)) {
    throw new Error(`No data for crypto: ${symbol}/${market}`);
  }
  const quotes: YahooHistoricalQuote[] = [];
  for (const [date, value] of Object.entries(timeSeries)) {
    if (!isRecord(value)) {
      continue;
    }
    const timestamp = alphaVantageDateTimestamp(date);
    const close = alphaVantageDynamicDecimal(value, ["4a. close", "4b. close"]);
    if (timestamp === null || close === null) {
      continue;
    }
    quotes.push(
      alphaVantageQuoteFromDecimals(
        assetId,
        timestamp,
        alphaVantageDynamicDecimal(value, ["1a. open", "1b. open"]),
        alphaVantageDynamicDecimal(value, ["2a. high", "2b. high"]),
        alphaVantageDynamicDecimal(value, ["3a. low", "3b. low"]),
        close,
        alphaVantageDynamicDecimal(value, ["5. volume"]),
        market,
      ),
    );
  }
  return alphaVantageSortedQuotes(quotes);
}

function alphaVantageQuoteFromDecimals(
  assetId: string,
  timestamp: string,
  open: string | null,
  high: string | null,
  low: string | null,
  close: string,
  volume: string | null,
  currency: string,
): YahooHistoricalQuote {
  return {
    assetId,
    day: timestamp.slice(0, 10),
    timestamp,
    source: ALPHA_VANTAGE_PROVIDER,
    open: open ?? close,
    high: high ?? close,
    low: low ?? close,
    close,
    adjclose: close,
    volume,
    currency,
  };
}

function alphaVantageSortedQuotes(quotes: YahooHistoricalQuote[]): YahooHistoricalQuote[] {
  return quotes.sort((left, right) => left.day.localeCompare(right.day));
}

function alphaVantageDateTimestamp(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null;
  }
  const [year, month, day] = date.split("-").map((part) => Number(part));
  const timestamp = new Date(Date.UTC(2000, 0, 1));
  timestamp.setUTCFullYear(year ?? 0, (month ?? 0) - 1, day ?? 0);
  if (
    Number.isNaN(timestamp.getTime()) ||
    timestamp.getUTCFullYear() !== year ||
    timestamp.getUTCMonth() + 1 !== month ||
    timestamp.getUTCDate() !== day
  ) {
    return null;
  }
  return timestamp.toISOString();
}

function checkAlphaVantageApiError(payload: Record<string, unknown>): void {
  const apiError = optionalString(payload["Error Message"]);
  if (apiError) {
    if (apiError.includes("Invalid API call") || apiError.includes("not found")) {
      throw new Error(`Symbol not found: ${apiError}`);
    }
    throw new Error(`${ALPHA_VANTAGE_PROVIDER}: ${apiError}`);
  }
  for (const key of ["Note", "Information"]) {
    const message = optionalString(payload[key]);
    if (message && alphaVantageRateLimitedMessage(message)) {
      throw new Error(`${ALPHA_VANTAGE_PROVIDER}: rate limited`);
    }
  }
}

function alphaVantageRateLimitedMessage(message: string): boolean {
  return message.includes("API call frequency") || message.includes("rate limit");
}

function alphaVantageDynamicDecimal(
  record: Record<string, unknown>,
  prefixes: string[],
): string | null {
  for (const prefix of prefixes) {
    for (const [key, value] of Object.entries(record)) {
      if (key.startsWith(prefix)) {
        const parsed = decimalString(value);
        if (parsed !== null) {
          return parsed;
        }
      }
    }
  }
  return null;
}

function alphaVantageInstrumentForAsset(
  asset: AssetMarketSyncRow,
  exchangeCatalog: ExchangeCatalog,
): AlphaVantageInstrument | null {
  const instrumentType = normalizeInstrumentType(asset.instrument_type ?? undefined);
  if (instrumentType === "EQUITY") {
    const symbol = alphaVantageEquitySymbol(
      asset.instrument_symbol,
      asset.instrument_exchange_mic,
      asset.provider_config,
      exchangeCatalog,
    );
    return symbol
      ? {
          kind: "equity",
          symbol,
          currency: alphaVantageCurrency(
            asset.instrument_exchange_mic,
            asset.quote_ccy,
            exchangeCatalog,
          ),
        }
      : null;
  }
  if (instrumentType === "FX") {
    const pair = alphaVantageFxPair(asset.provider_config) ?? {
      from: optionalString(asset.instrument_symbol)?.toUpperCase() ?? "",
      to: asset.quote_ccy.toUpperCase(),
    };
    return pair.from && pair.to ? { kind: "fx", ...pair, currency: pair.to } : null;
  }
  if (instrumentType === "CRYPTO") {
    const pair = alphaVantageCryptoPair(asset.provider_config) ?? {
      symbol: optionalString(asset.instrument_symbol)?.toUpperCase() ?? "",
      market: asset.quote_ccy.toUpperCase(),
    };
    return pair.symbol && pair.market ? { kind: "crypto", ...pair, currency: pair.market } : null;
  }
  return null;
}

function alphaVantageInstrumentForResolve(
  symbol: string,
  instrumentType: string,
  exchangeMic: string | null,
  quoteCcy: string | null,
  exchangeCatalog: ExchangeCatalog,
): AlphaVantageInstrument | null {
  const canonical = canonicalizeSearchIdentity(
    instrumentType,
    symbol,
    exchangeMic,
    quoteCcy,
    exchangeCatalog,
  );
  const instrumentSymbol = optionalString(canonical.instrumentSymbol);
  if (instrumentType === "EQUITY") {
    const alphaSymbol = alphaVantageEquitySymbol(
      instrumentSymbol,
      canonical.instrumentExchangeMic,
      null,
      exchangeCatalog,
    );
    return alphaSymbol
      ? {
          kind: "equity",
          symbol: alphaSymbol,
          currency: alphaVantageCurrency(
            canonical.instrumentExchangeMic,
            canonical.quoteCcy,
            exchangeCatalog,
          ),
        }
      : null;
  }
  if (instrumentType === "OPTION") {
    const occSymbol = instrumentSymbol?.toUpperCase() ?? "";
    const underlying = alphaVantageUnderlyingFromOccSymbol(occSymbol);
    return occSymbol && underlying
      ? { kind: "option", symbol: occSymbol, underlying, currency: "USD" }
      : null;
  }
  if (instrumentType === "FX") {
    const from = instrumentSymbol?.toUpperCase() ?? "";
    const to = optionalString(canonical.quoteCcy)?.toUpperCase() ?? "";
    return from && to ? { kind: "fx", from, to, currency: to } : null;
  }
  if (instrumentType === "CRYPTO") {
    const cryptoSymbol = instrumentSymbol?.toUpperCase() ?? "";
    const market = optionalString(canonical.quoteCcy)?.toUpperCase() ?? "";
    return cryptoSymbol && market
      ? { kind: "crypto", symbol: cryptoSymbol, market, currency: market }
      : null;
  }
  return null;
}

function alphaVantageUnderlyingFromOccSymbol(occSymbol: string): string | null {
  const trimmed = occSymbol.trim();
  if (trimmed.length <= 15) {
    return null;
  }
  const underlying = trimmed.slice(0, -15).trim();
  return underlying || null;
}

function alphaVantageEquitySymbol(
  instrumentSymbol: string | null,
  exchangeMic: string | null,
  providerConfig: string | null,
  exchangeCatalog: ExchangeCatalog,
): string | null {
  const override = providerOverrideSymbol(providerConfig, ALPHA_VANTAGE_PROVIDER);
  if (override) {
    return override;
  }
  const symbol = optionalString(instrumentSymbol)?.toUpperCase();
  if (!symbol) {
    return null;
  }
  const mic = optionalString(exchangeMic)?.toUpperCase();
  const suffix = mic ? exchangeCatalog.alphaVantageSuffixByMic.get(mic) : undefined;
  return suffix === undefined ? symbol : `${symbol}${suffix}`;
}

function alphaVantageCurrency(
  exchangeMic: string | null,
  currencyHint: string | null,
  exchangeCatalog: ExchangeCatalog,
): string {
  const mic = optionalString(exchangeMic)?.toUpperCase();
  if (mic) {
    const alphaCurrency = exchangeCatalog.alphaVantageCurrencyByMic.get(mic);
    if (alphaCurrency) {
      return alphaCurrency;
    }
    const exchangeCurrency = exchangeCatalog.currencyByMic.get(mic);
    if (exchangeCurrency) {
      return exchangeCurrency;
    }
  }
  return optionalString(currencyHint)?.toUpperCase() ?? "USD";
}

function alphaVantageFxPair(providerConfig: string | null): { from: string; to: string } | null {
  const override = providerOverrideRecord(providerConfig, ALPHA_VANTAGE_PROVIDER);
  if (!override || optionalString(override.type) !== "fx_pair") {
    return null;
  }
  const from = optionalString(override.from)?.toUpperCase();
  const to = optionalString(override.to)?.toUpperCase();
  return from && to ? { from, to } : null;
}

function alphaVantageCryptoPair(
  providerConfig: string | null,
): { symbol: string; market: string } | null {
  const override = providerOverrideRecord(providerConfig, ALPHA_VANTAGE_PROVIDER);
  if (!override || optionalString(override.type) !== "crypto_pair") {
    return null;
  }
  const symbol = optionalString(override.symbol)?.toUpperCase();
  const market = optionalString(override.market)?.toUpperCase();
  return symbol && market ? { symbol, market } : null;
}

async function fetchMetalPriceApiHistoricalQuotes(
  assetId: string,
  instrument: { symbol: string; quote: string },
  startDate: string,
  endDate: string,
  fetchImpl: typeof fetch,
  apiKey: string,
): Promise<YahooHistoricalQuote[]> {
  const parsed = parseMetalPriceApiSymbol(instrument.symbol);
  if (parsed === null) {
    throw new Error(`Symbol not found: ${instrument.symbol}`);
  }
  const payload = await fetchMetalPriceApiJson(
    "/timeframe",
    [
      ["base", instrument.quote],
      ["currencies", parsed.base],
      ["start_date", startDate],
      ["end_date", endDate],
    ],
    fetchImpl,
    apiKey,
  );
  return parseMetalPriceApiTimeframeQuotes(payload, assetId, instrument, parsed);
}

async function fetchMetalPriceApiLatestQuote(
  assetId: string,
  instrument: { symbol: string; quote: string },
  fetchImpl: typeof fetch,
  apiKey: string,
  now: Date,
): Promise<YahooHistoricalQuote> {
  const parsed = parseMetalPriceApiSymbol(instrument.symbol);
  if (parsed === null) {
    throw new Error(`Symbol not found: ${instrument.symbol}`);
  }
  const payload = await fetchMetalPriceApiJson(
    "/latest",
    [
      ["base", instrument.quote],
      ["currencies", parsed.base],
    ],
    fetchImpl,
    apiKey,
  );
  return parseMetalPriceApiLatestQuote(payload, assetId, instrument, parsed, now);
}

async function fetchMetalPriceApiJson(
  endpoint: string,
  params: Array<[string, string]>,
  fetchImpl: typeof fetch,
  apiKey: string,
): Promise<unknown> {
  const url = new URL(`${METAL_PRICE_API_BASE_URL}${endpoint}`);
  for (const [key, value] of params) {
    url.searchParams.set(key, value);
  }
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { "X-API-KEY": apiKey } });
  } catch (error) {
    throw new Error(`${METAL_PRICE_API_PROVIDER}: Request failed: ${errorMessage(error)}`);
  }
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(
      `${METAL_PRICE_API_PROVIDER}: Failed to parse response: ${errorMessage(error)}`,
    );
  }
}

function parseMetalPriceApiLatestQuote(
  payload: unknown,
  assetId: string,
  instrument: { symbol: string; quote: string },
  parsed: { base: string; multiplier: Decimal },
  now: Date,
): YahooHistoricalQuote {
  if (
    !isRecord(payload) ||
    payload.success !== true ||
    !isRecord(payload.rates) ||
    Object.keys(payload.rates).length === 0
  ) {
    throw new Error(`${METAL_PRICE_API_PROVIDER}: API request failed`);
  }
  const rate = numberValue(payload.rates[parsed.base]);
  if (rate === null) {
    throw new Error(`Symbol not found: ${instrument.symbol}`);
  }
  return metalPriceApiQuoteFromRate(
    assetId,
    now.toISOString(),
    rate,
    parsed.multiplier,
    instrument.quote,
  );
}

function parseMetalPriceApiTimeframeQuotes(
  payload: unknown,
  assetId: string,
  instrument: { symbol: string; quote: string },
  parsed: { base: string; multiplier: Decimal },
): YahooHistoricalQuote[] {
  if (
    !isRecord(payload) ||
    payload.success !== true ||
    !isRecord(payload.rates) ||
    Object.keys(payload.rates).length === 0
  ) {
    throw new Error(
      `${METAL_PRICE_API_PROVIDER}: Timeframe API request failed (body: ${JSON.stringify(payload).slice(0, 300)})`,
    );
  }
  const quotes: YahooHistoricalQuote[] = [];
  for (const [date, rates] of Object.entries(payload.rates)) {
    if (!isRecord(rates)) {
      continue;
    }
    const timestamp = metalPriceApiDateTimestamp(date);
    if (timestamp === null) {
      throw new Error(`${METAL_PRICE_API_PROVIDER}: Invalid date '${date}'`);
    }
    const rate = numberValue(rates[parsed.base]);
    if (rate === null) {
      continue;
    }
    quotes.push(
      metalPriceApiQuoteFromRate(assetId, timestamp, rate, parsed.multiplier, instrument.quote),
    );
  }
  return quotes.sort((left, right) => left.day.localeCompare(right.day));
}

function metalPriceApiQuoteFromRate(
  assetId: string,
  timestamp: string,
  rate: number,
  multiplier: Decimal,
  currency: string,
): YahooHistoricalQuote {
  const close = metalPriceApiRateToPrice(rate, multiplier);
  return {
    assetId,
    day: timestamp.slice(0, 10),
    timestamp,
    source: METAL_PRICE_API_PROVIDER,
    open: null,
    high: null,
    low: null,
    close,
    adjclose: close,
    volume: null,
    currency,
  };
}

function metalPriceApiRateToPrice(rate: number, multiplier: Decimal): string {
  if (!Number.isFinite(rate)) {
    throw new Error(`${METAL_PRICE_API_PROVIDER}: Failed to convert rate to decimal`);
  }
  const rateDecimal = new Decimal(rate);
  if (rateDecimal.isZero()) {
    throw new Error(`${METAL_PRICE_API_PROVIDER}: Invalid rate (zero)`);
  }
  return new Decimal(1).div(rateDecimal).times(multiplier).toString();
}

function metalPriceApiDateTimestamp(date: string): string | null {
  const timestamp = alphaVantageDateTimestamp(date);
  return timestamp === null ? null : `${timestamp.slice(0, 11)}12:00:00.000Z`;
}

function metalPriceApiInstrumentForAsset(
  asset: AssetMarketSyncRow,
): { symbol: string; quote: string } | null {
  const instrumentType = normalizeInstrumentType(asset.instrument_type ?? undefined);
  if (instrumentType !== "METAL") {
    return null;
  }
  return metalPriceApiInstrumentForSymbol(
    providerOverrideSymbol(asset.provider_config, METAL_PRICE_API_PROVIDER) ??
      asset.instrument_symbol ??
      "",
    asset.quote_ccy,
  );
}

function metalPriceApiInstrumentForSymbol(
  symbol: string,
  quoteCurrency: string | null,
): { symbol: string; quote: string } | null {
  const normalizedSymbol = optionalString(symbol)?.toUpperCase();
  const quote = optionalString(quoteCurrency)?.toUpperCase() ?? "USD";
  return normalizedSymbol ? { symbol: normalizedSymbol, quote } : null;
}

function parseMetalPriceApiSymbol(symbol: string): { base: string; multiplier: Decimal } | null {
  const [base, suffix] = symbol.toUpperCase().split("-", 2);
  if (!base || !METAL_PRICE_API_SUPPORTED_METALS.has(base)) {
    return null;
  }
  if (!suffix) {
    return { base, multiplier: new Decimal(1) };
  }
  const grams =
    suffix === "1KG"
      ? new Decimal(1000)
      : suffix === "500G"
        ? new Decimal(500)
        : suffix === "250G"
          ? new Decimal(250)
          : suffix === "100G"
            ? new Decimal(100)
            : suffix === "50G"
              ? new Decimal(50)
              : suffix === "10G"
                ? new Decimal(10)
                : suffix === "1OZ"
                  ? TROY_OZ_GRAMS
                  : null;
  return grams === null ? null : { base, multiplier: grams.div(TROY_OZ_GRAMS) };
}

async function fetchMarketDataAppHistoricalQuotes(
  asset: AssetMarketSyncRow,
  symbol: string,
  currency: string,
  startDate: string,
  endDate: string,
  fetchImpl: typeof fetch,
  apiKey: string,
  now: Date,
): Promise<YahooHistoricalQuote[]> {
  const url = new URL(`${MARKETDATA_APP_BASE_URL}/stocks/candles/D/${encodeURIComponent(symbol)}`);
  url.searchParams.set("from", startDate);
  url.searchParams.set("to", endDate);
  const payload = await fetchMarketDataAppJson(url, fetchImpl, apiKey);
  const quotes = parseMarketDataAppHistoricalQuotes(payload, asset, currency);
  const today = isoDate(now);
  const lastCandleDate = quotes.at(-1)?.day ?? null;
  if (endDate >= today && lastCandleDate !== null && lastCandleDate < today) {
    try {
      const latest = await fetchMarketDataAppLatestQuote(
        asset.id,
        symbol,
        currency,
        fetchImpl,
        apiKey,
      );
      if (latest.day > lastCandleDate) {
        quotes.push(latest);
      }
    } catch {
      // Rust logs and preserves the successful candle response when the realtime supplement fails.
    }
  }
  return quotes;
}

async function fetchMarketDataAppLatestQuote(
  assetId: string,
  symbol: string,
  currency: string,
  fetchImpl: typeof fetch,
  apiKey: string,
): Promise<YahooHistoricalQuote> {
  const url = new URL(`${MARKETDATA_APP_BASE_URL}/stocks/prices/${encodeURIComponent(symbol)}/`);
  const payload = await fetchMarketDataAppJson(url, fetchImpl, apiKey);
  if (!isRecord(payload)) {
    throw new Error(`${MARKETDATA_APP_PROVIDER}: Failed to parse response`);
  }
  const status = optionalString(payload.s);
  if (status !== "ok") {
    throw new Error(`${MARKETDATA_APP_PROVIDER}: API returned status: ${status ?? ""}`);
  }
  const price = numberValue(arrayValue(payload.mid, 0));
  if (price === null) {
    throw new Error(`${MARKETDATA_APP_PROVIDER}: No price data in response`);
  }
  const timestampSeconds = numberValue(arrayValue(payload.updated, 0));
  if (timestampSeconds === null) {
    throw new Error(`${MARKETDATA_APP_PROVIDER}: No timestamp in response`);
  }
  return marketDataAppQuoteFromValues(
    assetId,
    timestampSeconds,
    price,
    price,
    price,
    price,
    0,
    currency,
  );
}

async function fetchMarketDataAppJson(
  url: URL,
  fetchImpl: typeof fetch,
  apiKey: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
  } catch (error) {
    throw new Error(`${MARKETDATA_APP_PROVIDER}: ${errorMessage(error)}`);
  }
  if (response.status === 429) {
    throw new Error(`${MARKETDATA_APP_PROVIDER}: rate limited`);
  }
  if (!response.ok) {
    throw new Error(
      `${MARKETDATA_APP_PROVIDER}: HTTP error: ${formatRustHttpStatus(response.status)}`,
    );
  }
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`${MARKETDATA_APP_PROVIDER}: Failed to parse response: ${errorMessage(error)}`);
  }
}

function parseMarketDataAppHistoricalQuotes(
  payload: unknown,
  asset: AssetMarketSyncRow,
  currency: string,
): YahooHistoricalQuote[] {
  if (!isRecord(payload)) {
    throw new Error(`${MARKETDATA_APP_PROVIDER}: Failed to parse response`);
  }
  const status = optionalString(payload.s);
  if (status !== "ok") {
    throw new Error(`${MARKETDATA_APP_PROVIDER}: API returned status: ${status ?? ""}`);
  }
  if (!Array.isArray(payload.c)) {
    throw new Error(`${MARKETDATA_APP_PROVIDER}: No close prices in response`);
  }
  if (payload.c.length === 0) {
    throw new Error("No data for date range");
  }
  const quotes: YahooHistoricalQuote[] = [];
  for (let index = 0; index < payload.c.length; index += 1) {
    const close = numberValue(payload.c[index]);
    const timestampSeconds = numberValue(arrayValue(payload.t, index));
    if (close === null || timestampSeconds === null || timestampSeconds <= 0) {
      continue;
    }
    quotes.push(
      marketDataAppQuoteFromValues(
        asset.id,
        timestampSeconds,
        numberValue(arrayValue(payload.o, index)) ?? close,
        numberValue(arrayValue(payload.h, index)) ?? close,
        numberValue(arrayValue(payload.l, index)) ?? close,
        close,
        numberValue(arrayValue(payload.v, index)) ?? 0,
        currency,
      ),
    );
  }
  if (quotes.length === 0) {
    throw new Error("No data for date range");
  }
  return quotes.sort((left, right) => left.day.localeCompare(right.day));
}

function marketDataAppQuoteFromValues(
  assetId: string,
  timestampSeconds: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number,
  currency: string,
): YahooHistoricalQuote {
  const timestamp = new Date(timestampSeconds * 1000).toISOString();
  const closeDecimal = decimalString(close) ?? "0";
  return {
    assetId,
    day: timestamp.slice(0, 10),
    timestamp,
    source: MARKETDATA_APP_PROVIDER,
    open: decimalString(open) ?? closeDecimal,
    high: decimalString(high) ?? closeDecimal,
    low: decimalString(low) ?? closeDecimal,
    close: closeDecimal,
    adjclose: closeDecimal,
    volume: decimalString(volume) ?? "0",
    currency,
  };
}

function marketDataAppSyncSymbol(asset: AssetMarketSyncRow): string | null {
  return (
    providerOverrideSymbol(asset.provider_config, MARKETDATA_APP_PROVIDER) ??
    optionalString(asset.instrument_symbol)
  );
}

function providerCurrencyFromExchange(
  exchangeMic: string | null,
  currencyHint: string | null,
  exchangeCatalog: ExchangeCatalog,
): string {
  const mic = optionalString(exchangeMic)?.toUpperCase() ?? null;
  if (mic) {
    const exchangeCurrency = exchangeCatalog.currencyByMic.get(mic);
    if (exchangeCurrency) {
      return exchangeCurrency;
    }
  }
  return optionalString(currencyHint) ?? "USD";
}

async function fetchFinnhubHistoricalQuotes(
  asset: AssetMarketSyncRow,
  symbol: string,
  currency: string,
  startDate: string,
  endDate: string,
  fetchImpl: typeof fetch,
  apiKey: string,
): Promise<YahooHistoricalQuote[]> {
  const payload = await fetchFinnhubJson(
    finnhubCandleEndpoint(asset),
    [
      ["symbol", symbol],
      ["resolution", "D"],
      ["from", String(epochSeconds(startDate, "start"))],
      ["to", String(epochSeconds(endDate, "end"))],
    ],
    fetchImpl,
    apiKey,
  );
  return parseFinnhubHistoricalQuotes(payload, asset, currency);
}

function finnhubCandleEndpoint(asset: AssetMarketSyncRow): string {
  const instrumentType = normalizeInstrumentType(asset.instrument_type ?? undefined);
  if (instrumentType === "CRYPTO") {
    return "/crypto/candle";
  }
  if (instrumentType === "FX") {
    return "/forex/candle";
  }
  return "/stock/candle";
}

async function fetchFinnhubLatestQuote(
  assetId: string,
  symbol: string,
  currency: string,
  fetchImpl: typeof fetch,
  apiKey: string,
  now: Date,
): Promise<YahooHistoricalQuote> {
  const payload = await fetchFinnhubJson("/quote", [["symbol", symbol]], fetchImpl, apiKey);
  if (!isRecord(payload)) {
    throw new Error(`${FINNHUB_PROVIDER}: Failed to parse quote response`);
  }
  const close = numberValue(payload.c);
  if (close === null || (close === 0 && (numberValue(payload.o) ?? 0) === 0)) {
    throw new Error(`Symbol not found or no trading data: ${symbol}`);
  }
  const timestampSeconds = numberValue(payload.t);
  const timestamp =
    (timestampSeconds === null ? null : finnhubTimestampFromSeconds(timestampSeconds)) ??
    finnhubTimestampFromSeconds(Math.floor(now.getTime() / 1000)) ??
    timestampNow();
  return finnhubQuoteFromValues(
    assetId,
    timestamp,
    numberValue(payload.o),
    numberValue(payload.h),
    numberValue(payload.l),
    close,
    null,
    currency,
  );
}

async function fetchFinnhubJson(
  endpoint: string,
  params: Array<[string, string]>,
  fetchImpl: typeof fetch,
  apiKey: string,
): Promise<unknown> {
  const url = new URL(`${FINNHUB_BASE_URL}${endpoint}`);
  for (const [key, value] of params) {
    url.searchParams.set(key, value);
  }
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { "X-Finnhub-Token": apiKey } });
  } catch (error) {
    throw new Error(`${FINNHUB_PROVIDER}: Request failed: ${errorMessage(error)}`);
  }
  if (response.status === 429) {
    throw new Error(`${FINNHUB_PROVIDER}: rate limited`);
  }
  if (response.status === 401) {
    throw new Error(`${FINNHUB_PROVIDER}: Invalid or missing API key`);
  }
  const text = await response.text();
  if (response.status === 403) {
    throw new Error(`${FINNHUB_PROVIDER}: Access forbidden - check API key: ${text}`);
  }
  if (!response.ok) {
    const parsedError = parseFinnhubError(text);
    throw new Error(
      `${FINNHUB_PROVIDER}: ${parsedError ?? `HTTP ${formatRustHttpStatus(response.status)} - ${text}`}`,
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`${FINNHUB_PROVIDER}: Failed to parse response: ${errorMessage(error)}`);
  }
}

function parseFinnhubHistoricalQuotes(
  payload: unknown,
  asset: AssetMarketSyncRow,
  currency: string,
): YahooHistoricalQuote[] {
  if (!isRecord(payload)) {
    throw new Error(`${FINNHUB_PROVIDER}: Failed to parse candle response`);
  }
  const status = optionalString(payload.s);
  if (status === "no_data") {
    throw new Error("No data for date range");
  }
  if (status !== "ok") {
    throw new Error(`${FINNHUB_PROVIDER}: Unexpected candle status: ${status ?? ""}`);
  }
  const timestamps = numericArray(payload.t);
  const closes = numericArray(payload.c);
  const opens = numericArray(payload.o);
  const highs = numericArray(payload.h);
  const lows = numericArray(payload.l);
  if (
    timestamps === null ||
    closes === null ||
    opens === null ||
    highs === null ||
    lows === null ||
    closes.length !== timestamps.length ||
    opens.length !== timestamps.length ||
    highs.length !== timestamps.length ||
    lows.length !== timestamps.length
  ) {
    throw new Error(`${FINNHUB_PROVIDER}: Mismatched array lengths in candle response`);
  }
  if (timestamps.length === 0) {
    throw new Error("No data for date range");
  }
  const volumes = numericArray(payload.v);
  const quotes: YahooHistoricalQuote[] = [];
  for (let index = 0; index < timestamps.length; index += 1) {
    const timestamp = finnhubTimestampFromSeconds(timestamps[index] ?? 0);
    if (timestamp === null) {
      continue;
    }
    quotes.push(
      finnhubQuoteFromValues(
        asset.id,
        timestamp,
        opens[index] ?? null,
        highs[index] ?? null,
        lows[index] ?? null,
        closes[index] ?? 0,
        volumes?.[index] ?? null,
        currency,
      ),
    );
  }
  return quotes
    .filter((quote) => isIsoDate(quote.day))
    .sort((left, right) => left.day.localeCompare(right.day));
}

function finnhubQuoteFromValues(
  assetId: string,
  timestamp: string,
  open: number | null,
  high: number | null,
  low: number | null,
  close: number,
  volume: number | null,
  currency: string,
): YahooHistoricalQuote {
  const closeDecimal = decimalString(close) ?? "0";
  return {
    assetId,
    day: timestamp.slice(0, 10),
    timestamp,
    source: FINNHUB_PROVIDER,
    open: decimalString(open) ?? closeDecimal,
    high: decimalString(high) ?? closeDecimal,
    low: decimalString(low) ?? closeDecimal,
    close: closeDecimal,
    adjclose: closeDecimal,
    volume: decimalString(volume),
    currency,
  };
}

function finnhubTimestampFromSeconds(timestampSeconds: number): string | null {
  const date = new Date(timestampSeconds * 1000);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function finnhubSyncSymbol(asset: AssetMarketSyncRow): string | null {
  const override = providerOverrideRecord(asset.provider_config, FINNHUB_PROVIDER);
  const overrideType = optionalString(override?.type);
  const overrideSymbol = optionalString(override?.symbol);
  if (overrideSymbol && overrideType !== "crypto_pair" && overrideType !== "fx_pair") {
    return overrideSymbol;
  }
  const overrideFrom = optionalString(override?.from)?.toUpperCase();
  const overrideTo = optionalString(override?.to)?.toUpperCase();
  if (overrideType === "fx_pair" && overrideFrom && overrideTo) {
    return `OANDA:${overrideFrom}_${overrideTo}`;
  }
  const overrideMarket = optionalString(override?.market)?.toUpperCase();
  if (overrideType === "crypto_pair" && overrideSymbol && overrideMarket) {
    return `BINANCE:${overrideSymbol.toUpperCase()}${overrideMarket}`;
  }

  const instrumentType = normalizeInstrumentType(asset.instrument_type ?? undefined);
  const symbol = optionalString(asset.instrument_symbol);
  if (!symbol) {
    return null;
  }
  if (instrumentType === "EQUITY") {
    return symbol;
  }
  if (instrumentType === "FX") {
    const quoteCcy = asset.quote_ccy.toUpperCase();
    return quoteCcy ? `OANDA:${symbol.toUpperCase()}_${quoteCcy}` : null;
  }
  if (instrumentType === "CRYPTO") {
    const quoteCcy = asset.quote_ccy.toUpperCase();
    return quoteCcy ? `BINANCE:${symbol.toUpperCase()}${quoteCcy}` : null;
  }
  return null;
}

function finnhubResolveCandidates(
  symbol: string,
  instrumentType: string,
  quoteCcy: string | null,
  exchangeCatalog: ExchangeCatalog,
): Array<{ symbol: string; currency: string }> {
  const canonical = canonicalizeSearchIdentity(
    instrumentType,
    symbol,
    null,
    quoteCcy,
    exchangeCatalog,
  );
  const normalizedSymbol = canonical.instrumentSymbol?.trim().toUpperCase() ?? "";
  const normalizedQuote = canonical.quoteCcy?.trim().toUpperCase() ?? "";
  if (!normalizedSymbol) {
    return [];
  }
  if (instrumentType === "FX" && normalizedQuote) {
    return [{ symbol: `OANDA:${normalizedSymbol}_${normalizedQuote}`, currency: normalizedQuote }];
  }
  if (instrumentType === "CRYPTO" && normalizedQuote) {
    return [{ symbol: `BINANCE:${normalizedSymbol}${normalizedQuote}`, currency: normalizedQuote }];
  }
  return [];
}

function parseFinnhubError(text: string): string | null {
  const parsed = parseJsonValue(text);
  if (!isRecord(parsed)) {
    return null;
  }
  return optionalString(parsed.error);
}

function numericArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const numbers: number[] = [];
  for (const item of value) {
    if (typeof item !== "number" || !Number.isFinite(item)) {
      return null;
    }
    numbers.push(item);
  }
  return numbers;
}

async function fetchBoerseHistoricalQuotes(
  asset: AssetMarketSyncRow,
  identity: BoerseInstrumentIdentity,
  startDate: string,
  endDate: string,
  fetchImpl: typeof fetch,
  isinCache: Map<string, string>,
): Promise<YahooHistoricalQuote[]> {
  const isin = await resolveBoerseIsin(identity.symbol, identity.mic, fetchImpl, isinCache);
  const tvSymbol = `${identity.mic}:${isin}`;
  const url = new URL(`${BOERSE_FRANKFURT_BASE_URL}/tradingview/history`);
  url.searchParams.set("symbol", tvSymbol);
  url.searchParams.set("resolution", "1D");
  url.searchParams.set("from", String(epochSeconds(startDate, "start")));
  url.searchParams.set("to", String(epochSeconds(endDate, "end")));

  const payload = await fetchBoerseJson(url, fetchImpl);
  return parseBoerseHistoricalQuotes(payload, asset, identity, tvSymbol);
}

async function fetchBoerseResolvedQuote(
  identity: BoerseInstrumentIdentity,
  fallbackCurrency: string | null,
  fetchImpl: typeof fetch,
  isinCache: Map<string, string>,
): Promise<ResolvedQuote> {
  const isin = await resolveBoerseIsin(identity.symbol, identity.mic, fetchImpl, isinCache);
  const url = new URL(`${BOERSE_FRANKFURT_BASE_URL}/data/price_information/single`);
  url.searchParams.set("isin", isin);
  url.searchParams.set("mic", identity.mic);

  const payload = await fetchBoerseJson(url, fetchImpl);
  if (!isRecord(payload)) {
    throw new Error(`${BOERSE_FRANKFURT_PROVIDER}: invalid price response`);
  }
  const rawPrice = numberValue(payload.lastPrice);
  if (rawPrice === null) {
    throw new Error(`${BOERSE_FRANKFURT_PROVIDER}: No lastPrice in response`);
  }
  const price = boersePrice(rawPrice, payload.tradedInPercent === true);
  const currency =
    isRecord(payload.currency) && typeof payload.currency.originalValue === "string"
      ? payload.currency.originalValue.trim() || fallbackCurrency || "EUR"
      : (fallbackCurrency ?? "EUR");
  return {
    currency,
    price: price === 0 ? null : price,
    resolvedProviderId: BOERSE_FRANKFURT_PROVIDER,
  };
}

async function resolveBoerseIsin(
  symbol: string,
  mic: string,
  fetchImpl: typeof fetch,
  cache: Map<string, string>,
): Promise<string> {
  const trimmedSymbol = symbol.trim();
  if (looksLikeIsin(trimmedSymbol)) {
    return trimmedSymbol;
  }

  const cacheKey = `${mic}:${trimmedSymbol.toUpperCase()}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const url = new URL(`${BOERSE_FRANKFURT_BASE_URL}/tradingview/search`);
  url.searchParams.set("query", trimmedSymbol);
  url.searchParams.set("limit", "5");
  const payload = await fetchBoerseJson(url, fetchImpl, "Search returned HTTP ");
  if (!Array.isArray(payload)) {
    throw new Error(`${BOERSE_FRANKFURT_PROVIDER}: Search JSON parse error`);
  }

  for (const item of payload) {
    if (!isRecord(item)) {
      continue;
    }
    const instrumentType = optionalString(item.type);
    const rawResultSymbol = optionalString(item.symbol);
    if (!instrumentType || !rawResultSymbol || !boerseSupportedGermanType(instrumentType)) {
      continue;
    }
    const [resultMic, resultIsin] = splitBoerseMicSymbol(rawResultSymbol);
    if (resultMic === mic && resultIsin) {
      cache.set(cacheKey, resultIsin);
      return resultIsin;
    }
  }

  throw new Error(`Symbol not found: ${trimmedSymbol}@${mic}`);
}

async function fetchBoerseJson(
  url: URL,
  fetchImpl: typeof fetch,
  httpStatusPrefix = "HTTP ",
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { "User-Agent": BOERSE_FRANKFURT_USER_AGENT },
    });
  } catch (error) {
    throw new Error(`${BOERSE_FRANKFURT_PROVIDER}: HTTP request failed: ${errorMessage(error)}`);
  }
  if (!response.ok) {
    throw new Error(
      `${BOERSE_FRANKFURT_PROVIDER}: ${httpStatusPrefix}${formatRustHttpStatus(response.status)}`,
    );
  }
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${BOERSE_FRANKFURT_PROVIDER}: JSON parse error: ${errorMessage(error)}`);
  }
}

function parseBoerseHistoricalQuotes(
  payload: unknown,
  asset: AssetMarketSyncRow,
  identity: BoerseInstrumentIdentity,
  tvSymbol: string,
): YahooHistoricalQuote[] {
  if (!isRecord(payload)) {
    throw new Error(`${BOERSE_FRANKFURT_PROVIDER}: invalid history response`);
  }
  const status = optionalString(payload.s);
  if (status === "no_data") {
    return [];
  }
  if (status !== "ok") {
    throw new Error(`Symbol not found: ${tvSymbol}`);
  }

  const timestamps = Array.isArray(payload.t) ? payload.t : [];
  const divisor = identity.isBond ? 100 : 1;
  const currency = asset.quote_ccy || "EUR";
  const quotes: YahooHistoricalQuote[] = [];

  for (let index = 0; index < timestamps.length; index += 1) {
    const timestampSeconds = timestamps[index];
    if (typeof timestampSeconds !== "number" || !Number.isFinite(timestampSeconds)) {
      continue;
    }
    const rawClose = numberValue(arrayValue(payload.c, index)) ?? 0;
    const close = boerseDecimal(rawClose, divisor) ?? "0";
    const timestamp = new Date(timestampSeconds * 1000).toISOString();
    quotes.push({
      assetId: asset.id,
      day: timestamp.slice(0, 10),
      timestamp,
      source: BOERSE_FRANKFURT_PROVIDER,
      open: boerseDecimal(numberValue(arrayValue(payload.o, index)) ?? rawClose, divisor),
      high: boerseDecimal(numberValue(arrayValue(payload.h, index)) ?? rawClose, divisor),
      low: boerseDecimal(numberValue(arrayValue(payload.l, index)) ?? rawClose, divisor),
      close,
      adjclose: close,
      volume: decimalString(arrayValue(payload.v, index)),
      currency,
    });
  }

  return quotes.sort((left, right) => left.day.localeCompare(right.day));
}

function boerseInstrumentIdentity(asset: AssetMarketSyncRow): BoerseInstrumentIdentity {
  const instrumentType = asset.instrument_type?.toUpperCase() ?? "";
  if (instrumentType === "BOND") {
    const override = providerOverrideSymbol(asset.provider_config, BOERSE_FRANKFURT_PROVIDER);
    const symbol =
      override ?? metadataIdentifier(asset.metadata, "isin") ?? asset.instrument_symbol;
    if (!symbol || !looksLikeIsin(symbol.trim())) {
      throw new Error("Bond has no ISIN");
    }
    const parsed = parseBoerseMicSymbol(symbol, "XFRA");
    return { ...parsed, isBond: true };
  }
  if (instrumentType === "EQUITY") {
    const override = providerOverrideSymbol(asset.provider_config, BOERSE_FRANKFURT_PROVIDER);
    const symbol = override ?? asset.instrument_symbol;
    if (!symbol) {
      throw new Error("Asset cannot be mapped to a Boerse Frankfurt symbol");
    }
    return {
      ...parseBoerseMicSymbol(symbol, asset.instrument_exchange_mic ?? "XETR"),
      isBond: false,
    };
  }
  throw new Error(`Boerse Frankfurt does not support ${asset.instrument_type ?? "unknown"} assets`);
}

function boerseInstrumentIdentityFromSymbol(
  symbol: string,
  exchangeMic: string | null,
  instrumentType: string,
): BoerseInstrumentIdentity {
  if (instrumentType === "BOND") {
    const parsed = parseBoerseMicSymbol(symbol.toUpperCase(), "XFRA");
    return { ...parsed, isBond: true };
  }
  return { ...parseBoerseMicSymbol(symbol, exchangeMic ?? "XETR"), isBond: false };
}

function parseBoerseMicSymbol(
  value: string,
  fallbackMic: string,
): Pick<BoerseInstrumentIdentity, "mic" | "symbol"> {
  const trimmed = value.trim();
  const [mic, symbol] = splitBoerseMicSymbol(trimmed);
  if (mic && symbol) {
    return { mic, symbol };
  }
  return { mic: fallbackMic.trim().toUpperCase() || "XETR", symbol: trimmed };
}

function splitBoerseMicSymbol(value: string): [string | null, string | null] {
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) {
    return [null, null];
  }
  return [value.slice(0, separator).trim().toUpperCase(), value.slice(separator + 1).trim()];
}

function boerseSupportedGermanType(value: string): boolean {
  return value === "Aktie" || value === "ETP" || value === "Anleihe" || value === "Fonds";
}

function metadataIdentifier(metadata: string | null, key: string): string | null {
  const parsed = parseJsonValue(metadata);
  if (!isRecord(parsed) || !isRecord(parsed.identifiers)) {
    return null;
  }
  return optionalString(parsed.identifiers[key]);
}

function looksLikeIsin(value: string): boolean {
  return /^[A-Z]{2}[A-Z0-9]{10}$/.test(value);
}

function boerseDecimal(value: number | null, divisor: number): string | null {
  if (value === null) {
    return null;
  }
  const decimal = decimalString(value);
  if (decimal === null || divisor === 1) {
    return decimal;
  }
  if (divisor === 100) {
    return shiftDecimalLeft(decimal, 2);
  }
  return decimalString(value / divisor);
}

function boersePrice(value: number, tradedInPercent: boolean): number {
  const decimal = boerseDecimal(value, tradedInPercent ? 100 : 1);
  return decimal === null ? value : Number(decimal);
}

function shiftDecimalLeft(value: string, places: number): string {
  const parts = decimalParts(value);
  const digits = `${parts.integer}${parts.fraction}`;
  const splitIndex = parts.integer.length - places;
  const integer =
    splitIndex > 0 ? digits.slice(0, splitIndex).replace(/^0+(?=\d)/, "") || "0" : "0";
  const fraction =
    splitIndex > 0 ? digits.slice(splitIndex) : `${"0".repeat(Math.abs(splitIndex))}${digits}`;
  const trimmedFraction = fraction.replace(/0+$/, "");
  const shifted = `${parts.sign < 0 ? "-" : ""}${integer}${trimmedFraction ? `.${trimmedFraction}` : ""}`;
  return shifted === "-0" ? "0" : shifted;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function fetchYahooHistoricalQuotes(
  symbol: string,
  assetId: string,
  fallbackCurrency: string,
  startDate: string,
  endDate: string,
  fetchImpl: typeof fetch,
  crumbCache: {
    get: () => YahooCrumbData | null;
    set: (crumb: YahooCrumbData) => void;
    clear: () => void;
  },
): Promise<YahooHistoricalQuote[]> {
  const fixture = fixtureInstrument(symbol);
  const catalog = e2eFixtureCatalog();
  if (fixture && catalog) {
    const start = new Date(`${startDate}T16:00:00.000Z`);
    const end = new Date(`${endDate}T16:00:00.000Z`);
    const asOf = e2eFixtureAsOf(catalog);
    const finalDate = asOf < end ? asOf : end;
    const quotes: YahooHistoricalQuote[] = [];
    for (let time = start.getTime(); time <= finalDate.getTime(); time += 86_400_000) {
      const date = new Date(time);
      const day = date.getUTCDay();
      const assetType = fixture.assetType ?? "";
      if (assetType !== "FX" && assetType !== "CRYPTOCURRENCY" && (day === 0 || day === 6)) {
        continue;
      }
      quotes.push(fixtureQuote(fixture, assetId, date));
    }
    return quotes;
  }
  for (const retry of [0, 1]) {
    const crumb = await getYahooCrumb(fetchImpl, crumbCache);
    const url = new URL(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`,
    );
    url.searchParams.set("period1", String(epochSeconds(startDate, "start")));
    url.searchParams.set("period2", String(epochSeconds(endDate, "end")));
    url.searchParams.set("interval", "1d");
    url.searchParams.set("events", "history");
    url.searchParams.set("crumb", crumb.crumb);

    let response: Response;
    try {
      response = await fetchImpl(url, { headers: yahooHeaders(crumb.cookie) });
    } catch (error) {
      throw yahooProviderError(`Failed to fetch historical quotes: ${errorMessage(error)}`);
    }
    if (response.status === 401 && retry === 0) {
      crumbCache.clear();
      continue;
    }
    if (!response.ok) {
      throw yahooProviderError(yahooStatusMessage(response));
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw yahooProviderError(`Failed to parse historical quotes: ${errorMessage(error)}`);
    }
    return parseYahooHistoricalQuotes(payload, symbol, assetId, fallbackCurrency);
  }

  throw yahooProviderError("Yahoo returned 401 Unauthorized");
}

function parseYahooHistoricalQuotes(
  payload: unknown,
  symbol: string,
  assetId: string,
  fallbackCurrency: string,
): YahooHistoricalQuote[] {
  if (!isRecord(payload) || !isRecord(payload.chart)) {
    throw yahooProviderError("Failed to parse historical quotes: missing chart");
  }

  const chartError = payload.chart.error;
  if (isRecord(chartError)) {
    const code = typeof chartError.code === "string" ? chartError.code : "";
    const description = typeof chartError.description === "string" ? chartError.description : null;
    const normalized = `${code} ${description ?? ""}`.toLowerCase();
    if (description?.includes("Data doesn't exist for startDate")) {
      return [];
    }
    if (normalized.includes("not found") || normalized.includes("no data")) {
      throw new Error(`Symbol not found: ${symbol}`);
    }
    throw yahooProviderError(`chart error ${code}: ${description ?? code}`);
  }

  if (!Array.isArray(payload.chart.result) || payload.chart.result.length === 0) {
    return [];
  }
  const [firstResult] = payload.chart.result;
  if (!isRecord(firstResult)) {
    throw yahooProviderError("Failed to parse historical quotes: invalid result");
  }
  const timestamps = firstResult.timestamp;
  if (!Array.isArray(timestamps)) {
    return [];
  }
  const indicators = isRecord(firstResult.indicators) ? firstResult.indicators : null;
  const quote = Array.isArray(indicators?.quote) ? indicators.quote[0] : null;
  if (!isRecord(quote)) {
    return [];
  }
  const adjclose = Array.isArray(indicators?.adjclose) ? indicators.adjclose[0] : null;
  const adjcloseValues =
    isRecord(adjclose) && Array.isArray(adjclose.adjclose) ? adjclose.adjclose : [];
  const currency = yahooHistoricalCurrency(firstResult, fallbackCurrency);
  const normalizePrice = yahooHistoricalPriceNormalizer(currency);

  const result: YahooHistoricalQuote[] = [];
  for (let index = 0; index < timestamps.length; index += 1) {
    const timestampSeconds = timestamps[index];
    const close = yahooPriceNumber(arrayValue(quote.close, index));
    if (typeof timestampSeconds !== "number" || close === null) {
      continue;
    }
    const timestamp = new Date(timestampSeconds * 1000).toISOString();
    result.push({
      assetId,
      day: timestamp.slice(0, 10),
      timestamp,
      source: DEFAULT_MARKET_DATA_PROVIDER,
      open: normalizePrice(yahooPriceNumber(arrayValue(quote.open, index))),
      high: normalizePrice(yahooPriceNumber(arrayValue(quote.high, index))),
      low: normalizePrice(yahooPriceNumber(arrayValue(quote.low, index))),
      close: normalizePrice(close) ?? "0",
      adjclose: normalizePrice(yahooPriceNumber(arrayValue(adjcloseValues, index))),
      volume: decimalString(arrayValue(quote.volume, index)),
      currency: normalizeCurrencyCode(currency),
    });
  }
  return result.sort((left, right) => left.day.localeCompare(right.day));
}

function yahooHistoricalCurrency(
  result: Record<string, unknown>,
  fallbackCurrency: string,
): string {
  if (isRecord(result.meta) && typeof result.meta.currency === "string") {
    return result.meta.currency.trim() || fallbackCurrency;
  }
  return fallbackCurrency;
}

function yahooHistoricalPriceNormalizer(currency: string): (value: number | null) => string | null {
  const divisor = isMinorCurrency(currency) ? 100 : 1;
  return (value) => {
    if (value === null) {
      return null;
    }
    return decimalString(divisor === 1 ? value : value / divisor);
  };
}

function arrayValue(value: unknown, index: number): unknown {
  return Array.isArray(value) ? value[index] : null;
}

function historicalQuoteToQuoteWrite(quote: YahooHistoricalQuote): QuoteWrite {
  return {
    id: quoteId(quote.assetId, quote.day, quote.source),
    assetId: quote.assetId,
    day: quote.day,
    source: quote.source,
    open: optionalStoredDecimal(quote.open),
    high: optionalStoredDecimal(quote.high),
    low: optionalStoredDecimal(quote.low),
    close: quote.close,
    adjclose: optionalStoredDecimal(quote.adjclose),
    volume: optionalStoredDecimal(quote.volume),
    currency: quote.currency,
    notes: null,
    createdAt: timestampNow(),
    timestamp: quote.timestamp,
  };
}

async function fetchYahooDividends(
  symbol: string,
  fetchImpl: typeof fetch,
  now: Date,
  crumbCache: {
    get: () => YahooCrumbData | null;
    set: (crumb: YahooCrumbData) => void;
    clear: () => void;
  },
): Promise<YahooDividend[]> {
  const period2 = Math.floor(now.getTime() / 1000);
  const period1 = period2 - 2 * 365 * 24 * 60 * 60;
  const crumb = await getYahooCrumb(fetchImpl, crumbCache);
  const url = new URL(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`,
  );
  url.searchParams.set("period1", String(period1));
  url.searchParams.set("period2", String(period2));
  url.searchParams.set("interval", "1d");
  url.searchParams.set("events", "div");
  url.searchParams.set("crumb", crumb.crumb);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: yahooHeaders(crumb.cookie),
    });
  } catch (error) {
    throw yahooProviderError(`Failed to fetch dividends: ${errorMessage(error)}`);
  }

  if (response.status === 401) {
    crumbCache.clear();
    throw yahooProviderError(yahooStatusMessage(response));
  }
  if (!response.ok) {
    throw yahooProviderError(yahooStatusMessage(response));
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw yahooProviderError(`Failed to parse dividends: ${errorMessage(error)}`);
  }

  return parseYahooDividends(payload, symbol);
}

async function getYahooCrumb(
  fetchImpl: typeof fetch,
  crumbCache: {
    get: () => YahooCrumbData | null;
    set: (crumb: YahooCrumbData) => void;
  },
): Promise<YahooCrumbData> {
  const cached = crumbCache.get();
  if (cached) {
    return cached;
  }

  let cookieResponse: Response;
  try {
    cookieResponse = await fetchImpl("https://fc.yahoo.com");
  } catch (error) {
    throw yahooProviderError(`Failed to get cookie: ${errorMessage(error)}`);
  }
  const setCookie = cookieResponse.headers.get("set-cookie");
  const cookie = setCookie?.split(";")[0]?.trim();
  if (!cookie) {
    throw yahooProviderError("Failed to parse Yahoo cookie");
  }

  let crumbResponse: Response;
  try {
    crumbResponse = await fetchImpl("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: yahooHeaders(cookie),
    });
  } catch (error) {
    throw yahooProviderError(`Failed to get crumb: ${errorMessage(error)}`);
  }
  let crumb: string;
  try {
    crumb = (await crumbResponse.text()).trim();
  } catch (error) {
    throw yahooProviderError(`Failed to read crumb: ${errorMessage(error)}`);
  }
  if (!crumb) {
    throw yahooProviderError("Failed to parse Yahoo crumb");
  }

  const crumbData = { cookie, crumb };
  crumbCache.set(crumbData);
  return crumbData;
}

function yahooHeaders(cookie: string): HeadersInit {
  return {
    Accept: "application/json",
    Cookie: cookie,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  };
}

function yahooSearchHeaders(): HeadersInit {
  return {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  };
}

function parseYahooDividends(payload: unknown, symbol: string): YahooDividend[] {
  if (!isRecord(payload) || !isRecord(payload.chart)) {
    throw yahooProviderError("Failed to parse dividends: missing chart");
  }

  const chartError = payload.chart.error;
  if (isRecord(chartError)) {
    const code = typeof chartError.code === "string" ? chartError.code : "";
    const description = typeof chartError.description === "string" ? chartError.description : null;
    const codeLower = code.toLowerCase();
    if (description?.includes("Data doesn't exist for startDate")) {
      throw new Error("No data for date range");
    }
    if (codeLower.includes("not found") || codeLower.includes("no data")) {
      throw new Error(`Symbol not found: ${symbol}`);
    }
    const displayDescription = description && description !== "" ? description : code;
    throw yahooProviderError(`chart error ${code}: ${displayDescription}`);
  }

  if (!Array.isArray(payload.chart.result) || payload.chart.result.length === 0) {
    return [];
  }

  const [firstResult] = payload.chart.result;
  if (!isRecord(firstResult) || !isRecord(firstResult.events)) {
    return [];
  }
  const { dividends } = firstResult.events;
  if (!isRecord(dividends)) {
    return [];
  }

  return Object.values(dividends)
    .map((value) => {
      if (!isRecord(value) || typeof value.amount !== "number" || typeof value.date !== "number") {
        throw yahooProviderError("Failed to parse dividends: invalid dividend event");
      }
      return { amount: value.amount, date: value.date };
    })
    .sort((left, right) => left.date - right.date);
}

function yahooStatusMessage(response: Response): string {
  return `Yahoo returned ${formatRustHttpStatus(response.status)}`;
}

const RUST_HTTP_STATUS_REASON_OVERRIDES: Record<number, string> = {
  418: "I'm a teapot",
  509: "<unknown status code>",
};

function formatRustHttpStatus(status: number): string {
  const reason =
    RUST_HTTP_STATUS_REASON_OVERRIDES[status] ?? STATUS_CODES[status] ?? "<unknown status code>";
  return `${status} ${reason}`;
}

function yahooProviderError(message: string): Error {
  return new Error(`Provider error: YAHOO - ${message}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function checkQuoteImports(
  db: Database,
  content: Uint8Array,
  hasHeaderRow: boolean,
  exchangeCatalog: ExchangeCatalog,
): QuoteImport[] {
  const text = new TextDecoder().decode(content);
  const records = parseCsvRecords(text, { delimiter: "," });
  const [rawHeaders, ...rawRows] = hasHeaderRow
    ? records
    : [["symbol", "date", "close"], ...records];
  const headers = (rawHeaders ?? []).map((header) => header.trim().toLowerCase());
  const missing = ["symbol", "date", "close"].filter((header) => !headers.includes(header));
  if (missing.length > 0) {
    throw new Error(`Missing required columns: ${missing.join(", ")}`);
  }

  const columnIndex = (name: string) => headers.indexOf(name);
  const symbolIndex = columnIndex("symbol");
  const dateIndex = columnIndex("date");
  const closeIndex = columnIndex("close");
  const openIndex = optionalColumnIndex(headers, "open");
  const highIndex = optionalColumnIndex(headers, "high");
  const lowIndex = optionalColumnIndex(headers, "low");
  const volumeIndex = optionalColumnIndex(headers, "volume");
  const currencyIndex = optionalColumnIndex(headers, "currency");

  const quotes = rawRows.map((row): NormalizedQuoteImport => {
    const getField = (index: number | null): string | null => {
      if (index === null) {
        return null;
      }
      const value = row[index]?.trim();
      return value ? value : null;
    };
    return {
      symbol: getField(symbolIndex) ?? "",
      displaySymbol: null,
      date: getField(dateIndex) ?? "",
      open: parseCsvDecimal(getField(openIndex)),
      high: parseCsvDecimal(getField(highIndex)),
      low: parseCsvDecimal(getField(lowIndex)),
      close: parseCsvDecimal(getField(closeIndex)) ?? "0",
      volume: parseCsvDecimal(getField(volumeIndex)),
      currency: getField(currencyIndex) ?? "USD",
      validationStatus: "valid",
      errorMessage: null,
    };
  });

  if (quotes.length === 0) {
    throw new Error("CSV file must contain at least one data row");
  }

  const assets = readQuoteImportAssets(db);
  const assetById = new Map(assets.map((asset) => [asset.id.toLowerCase(), asset]));
  const assetByDisplayCode = new Map<string, QuoteImportAssetRow>();
  const assetByDisplayCodeExchange = new Map<string, QuoteImportAssetRow>();
  for (const asset of assets) {
    const displayCode = asset.display_code ?? "";
    assetByDisplayCode.set(displayCode.toLowerCase(), asset);
    const suffix = asset.instrument_exchange_mic
      ? exchangeCatalog.yahooSuffixByMic.get(asset.instrument_exchange_mic.toUpperCase())
      : undefined;
    if (suffix) {
      assetByDisplayCodeExchange.set(`${displayCode}.${suffix}`.toLowerCase(), asset);
    }
  }

  for (const quote of quotes) {
    quote.validationStatus = validateQuoteImport(quote);
    if (!isImportable(quote.validationStatus)) {
      const message = validationMessage(quote.validationStatus);
      if (message) {
        quote.errorMessage = message;
      }
      continue;
    }

    const symbol = quote.symbol.toLowerCase();
    const asset =
      assetById.get(symbol) ??
      assetByDisplayCode.get(symbol) ??
      assetByDisplayCodeExchange.get(symbol);
    if (asset) {
      quote.displaySymbol = asset.display_code ?? quote.symbol;
      quote.symbol = asset.id;
    } else {
      const message = `Asset not found: '${quote.symbol}'`;
      quote.validationStatus = { error: message };
      quote.errorMessage = message;
    }
  }

  return quotes.map(quoteImportResponse);
}

function importQuoteRows(
  db: Database,
  quotes: unknown[],
  overwriteExisting: boolean,
  queueSyncEvent?: (event: QuoteSyncEvent) => void,
): QuoteImport[] {
  const normalizedQuotes = quotes.map(normalizeQuoteImportInput);
  db.transaction(() => {
    for (const quote of normalizedQuotes) {
      quote.validationStatus = validateQuoteImport(quote);
      if (!isImportable(quote.validationStatus)) {
        continue;
      }

      if (!overwriteExisting && quoteExistsForDay(db, quote.symbol, quote.date)) {
        quote.validationStatus = { warning: "Quote already exists" };
        continue;
      }

      const payload = quoteImportToQuoteWrite(quote);
      upsertQuoteWrite(db, payload, queueSyncEvent);
      quote.validationStatus = "valid";
    }
  })();
  return normalizedQuotes.map(quoteImportResponse);
}

function readQuoteImportAssets(db: Database): QuoteImportAssetRow[] {
  return db
    .query<QuoteImportAssetRow, []>("SELECT id, display_code, instrument_exchange_mic FROM assets")
    .all();
}

function optionalColumnIndex(headers: string[], name: string): number | null {
  const index = headers.indexOf(name);
  return index >= 0 ? index : null;
}

function normalizeQuoteImportInput(value: unknown): NormalizedQuoteImport {
  if (!isRecord(value)) {
    throw new Error("Invalid quote import row");
  }
  return {
    symbol: requiredString(value.symbol, "symbol"),
    displaySymbol: optionalString(value.displaySymbol),
    date: requiredString(value.date, "date"),
    open: parseCsvDecimal(value.open),
    high: parseCsvDecimal(value.high),
    low: parseCsvDecimal(value.low),
    close: parseCsvDecimal(value.close) ?? "0",
    volume: parseCsvDecimal(value.volume),
    currency: requiredString(value.currency, "currency"),
    validationStatus: "valid",
    errorMessage: optionalString(value.errorMessage),
  };
}

function validateQuoteImport(quote: NormalizedQuoteImport): ImportValidationStatus {
  if (quote.symbol.trim() === "") {
    return { error: "Symbol is required" };
  }
  if (!isIsoDate(quote.date)) {
    return { error: "Invalid date format. Expected YYYY-MM-DD" };
  }
  if (compareDecimals(quote.close, "0") <= 0) {
    return { error: "Close price must be greater than 0" };
  }
  if (quote.open !== null && quote.high !== null && quote.low !== null) {
    if (compareDecimals(quote.high, quote.low) < 0) {
      return { error: "High price cannot be less than low price" };
    }
    if (compareDecimals(quote.open, quote.high) > 0 || compareDecimals(quote.open, quote.low) < 0) {
      return { warning: "Open price is outside high-low range" };
    }
    if (
      compareDecimals(quote.close, quote.high) > 0 ||
      compareDecimals(quote.close, quote.low) < 0
    ) {
      return { warning: "Close price is outside high-low range" };
    }
  }
  return "valid";
}

function isImportable(status: ImportValidationStatus): boolean {
  return status === "valid" || isWarningStatus(status);
}

function validationMessage(status: ImportValidationStatus): string | null {
  if (isWarningStatus(status)) {
    return status.warning;
  }
  return isErrorStatus(status) ? status.error : null;
}

function isWarningStatus(status: ImportValidationStatus): status is { warning: string } {
  return typeof status === "object" && status !== null && "warning" in status;
}

function isErrorStatus(status: ImportValidationStatus): status is { error: string } {
  return typeof status === "object" && status !== null && "error" in status;
}

function quoteImportToQuoteWrite(quote: NormalizedQuoteImport): QuoteWrite {
  const timestamp = `${quote.date}T12:00:00.000Z`;
  return {
    id: quoteId(quote.symbol, quote.date, "MANUAL"),
    assetId: quote.symbol,
    day: quote.date,
    source: "MANUAL",
    open: optionalStoredDecimal(quote.open ?? quote.close),
    high: optionalStoredDecimal(quote.high ?? quote.close),
    low: optionalStoredDecimal(quote.low ?? quote.close),
    close: quote.close,
    adjclose: optionalStoredDecimal(quote.close),
    volume: optionalStoredDecimal(quote.volume),
    currency: quote.currency,
    notes: null,
    createdAt: timestampNow(),
    timestamp,
  };
}

function optionalStoredDecimal(value: string | null): string | null {
  return value !== null && compareDecimals(value, "0") !== 0 ? value : null;
}

function quoteExistsForDay(db: Database, assetId: string, day: string): boolean {
  const row = db
    .query<
      { id: string },
      [string, string]
    >("SELECT id FROM quotes WHERE asset_id = ? AND day = ? LIMIT 1")
    .get(assetId, day);
  return row !== null && row !== undefined;
}

function quoteImportResponse(quote: NormalizedQuoteImport): QuoteImport {
  return {
    symbol: quote.symbol,
    displaySymbol: quote.displaySymbol,
    date: quote.date,
    open: decimalToJsonNumber(quote.open),
    high: decimalToJsonNumber(quote.high),
    low: decimalToJsonNumber(quote.low),
    close: decimalToJsonNumber(quote.close) ?? 0,
    volume: decimalToJsonNumber(quote.volume),
    currency: quote.currency,
    validationStatus: quote.validationStatus,
    errorMessage: quote.errorMessage,
  };
}

function normalizeQuoteWrite(symbol: string, quote: Record<string, unknown>): QuoteWrite {
  const timestamp = normalizeQuoteTimestamp(requiredString(quote.timestamp, "timestamp"));
  const day = timestamp.slice(0, 10);
  const source = requiredString(
    firstDefined(quote.dataSource, quote.data_source, quote.source),
    "dataSource",
  );
  const close = requiredDecimal(quote.close, "close");
  const assetId = symbol;
  const normalizedSource = source.trim();
  const id =
    normalizedSource === "MANUAL"
      ? quoteId(assetId, day, normalizedSource)
      : (optionalString(quote.id) ?? quoteId(assetId, day, normalizedSource));

  return {
    id,
    assetId,
    day,
    source: normalizedSource,
    open: optionalDecimal(quote.open),
    high: optionalDecimal(quote.high),
    low: optionalDecimal(quote.low),
    close,
    adjclose: optionalDecimal(quote.adjclose),
    volume: optionalDecimal(quote.volume),
    currency: requiredString(quote.currency, "currency").trim(),
    notes: optionalString(quote.notes),
    createdAt: normalizeQuoteTimestamp(optionalString(quote.createdAt) ?? timestampNow()),
    timestamp,
  };
}

function upsertQuoteWrite(
  db: Database,
  payload: QuoteWrite,
  queueSyncEvent?: (event: QuoteSyncEvent) => void,
): void {
  const existing = db
    .query<
      { id: string },
      [string, string, string]
    >("SELECT id FROM quotes WHERE asset_id = ? AND day = ? AND source = ?")
    .get(payload.assetId, payload.day, payload.source);
  const operation: Exclude<QuoteSyncOperation, "Delete"> = existing ? "Update" : "Create";
  if (existing) {
    payload.id = existing.id;
  }

  db.query(
    `
      INSERT INTO quotes (
        id, asset_id, day, source, open, high, low, close, adjclose, volume,
        currency, notes, created_at, timestamp
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(asset_id, day, source) DO UPDATE SET
        id = excluded.id,
        open = excluded.open,
        high = excluded.high,
        low = excluded.low,
        close = excluded.close,
        adjclose = excluded.adjclose,
        volume = excluded.volume,
        currency = excluded.currency,
        notes = excluded.notes,
        created_at = excluded.created_at,
        timestamp = excluded.timestamp
    `,
  ).run(
    payload.id,
    payload.assetId,
    payload.day,
    payload.source,
    payload.open,
    payload.high,
    payload.low,
    payload.close,
    payload.adjclose,
    payload.volume,
    payload.currency,
    payload.notes,
    payload.createdAt,
    payload.timestamp,
  );
  const row = readQuoteRowById(db, payload.id);
  if (row) {
    queueUserQuoteSyncEvent(queueSyncEvent, row, operation);
  }
}

function deleteQuoteWrite(
  db: Database,
  id: string,
  queueSyncEvent?: (event: QuoteSyncEvent) => void,
): void {
  const existing = readQuoteRowById(db, id);
  db.query("DELETE FROM quotes WHERE id = ?").run(id);
  if (existing) {
    queueUserQuoteSyncEvent(queueSyncEvent, existing, "Delete");
  }
}

function readQuoteRowById(db: Database, id: string): QuoteRow | null {
  return db.query<QuoteRow, [string]>("SELECT * FROM quotes WHERE id = ?").get(id);
}

function rowToQuote(row: QuoteRow): Quote {
  return {
    id: row.id,
    createdAt: normalizeStoredTimestamp(row.created_at),
    dataSource: row.source,
    timestamp: normalizeStoredTimestamp(row.timestamp),
    assetId: row.asset_id,
    open: decimalToNumber(row.open),
    high: decimalToNumber(row.high),
    low: decimalToNumber(row.low),
    volume: decimalToNumber(row.volume),
    close: decimalToNumber(row.close),
    adjclose: decimalToNumber(row.adjclose),
    currency: row.currency,
    notes: row.notes,
  };
}

function marketEffectiveDate(
  now: Date,
  mic: string | null,
  exchangeCatalog: ExchangeCatalog,
): string {
  const normalizedMic = mic?.toUpperCase() ?? null;
  const timezone = normalizedMic ? exchangeCatalog.timezoneByMic.get(normalizedMic) : undefined;
  if (!timezone) {
    return isoDate(now);
  }

  const local = localTimeParts(now, timezone);
  if (isWeekend(local.date)) {
    return previousTradingDay(local.date);
  }

  const close = normalizedMic ? exchangeCatalog.closeByMic.get(normalizedMic) : undefined;
  if (!close) {
    return local.date;
  }

  const localMinutes = local.hour * 60 + local.minute;
  const closeMinutes = close[0] * 60 + close[1] + MARKET_CLOSE_GRACE_MINUTES;
  return localMinutes < closeMinutes ? previousTradingDay(local.date) : local.date;
}

function localTimeParts(
  instant: Date,
  timeZone: string,
): { date: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    hour: Number(value("hour")),
    minute: Number(value("minute")),
  };
}

function previousTradingDay(date: string): string {
  const current = new Date(`${date}T00:00:00Z`);
  do {
    current.setUTCDate(current.getUTCDate() - 1);
  } while (isWeekend(isoDate(current)));
  return isoDate(current);
}

function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const current = new Date(`${date}T00:00:00Z`);
  current.setUTCDate(current.getUTCDate() + days);
  return isoDate(current);
}

function minIsoDate(left: string, right: string): string {
  return left <= right ? left : right;
}

function epochSeconds(date: string, boundary: "start" | "end"): number {
  const time = boundary === "start" ? "00:00:00Z" : "23:59:59Z";
  return Math.floor(new Date(`${date}T${time}`).getTime() / 1000);
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && isoDate(date) === value;
}

function today(now: Date): string {
  return isoDate(now);
}

function metadataDate(metadata: string | null, section: string, key: string): string | null {
  const parsed = parseJsonValue(metadata);
  if (!isRecord(parsed) || !isRecord(parsed[section])) {
    return null;
  }
  const value = parsed[section][key] ?? parsed[section][snakeCase(key)];
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function normalizeCurrencyCode(currency: string): string {
  return MINOR_CURRENCY_MAJOR[currency] ?? currency;
}

function isMinorCurrency(currency: string): boolean {
  return MINOR_CURRENCY_MAJOR[currency] !== undefined;
}

function quoteId(assetId: string, day: string, source: string): string {
  return `${assetId}_${day}_${source}`;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid input: ${field} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function requiredDecimal(value: unknown, field: string): string {
  const parsed = decimalString(value);
  if (parsed === null) {
    throw new Error(`Invalid input: ${field} must be a number`);
  }
  return parsed;
}

function optionalDecimal(value: unknown): string | null {
  const parsed = decimalString(value);
  if (parsed === null || Number(parsed) === 0) {
    return null;
  }
  return parsed;
}

function decimalString(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (
    trimmed === "" ||
    !/^-?(?:\d+|\d*\.\d+)$/.test(trimmed) ||
    !Number.isFinite(Number(trimmed))
  ) {
    return null;
  }
  return trimmed;
}

function parseCsvDecimal(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value : null;
  if (raw === null) {
    return null;
  }
  const trimmed = raw.trim().replaceAll(",", "");
  if (trimmed === "" || !/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed)) {
    return null;
  }
  const sign = trimmed.startsWith("-") ? "-" : "";
  const unsigned = sign ? trimmed.slice(1) : trimmed;
  const [rawInteger, rawFraction = ""] = unsigned.split(".");
  const integer = rawInteger === "" ? "0" : rawInteger.replace(/^0+(?=\d)/, "");
  const fraction = rawFraction.replace(/0+$/, "");
  const normalized = `${sign}${integer || "0"}${fraction ? `.${fraction}` : ""}`;
  return normalized === "-0" ? "0" : normalized;
}

function compareDecimals(left: string, right: string): number {
  const leftParts = decimalParts(left);
  const rightParts = decimalParts(right);
  if (leftParts.sign !== rightParts.sign) {
    return leftParts.sign > rightParts.sign ? 1 : -1;
  }
  const abs = compareDecimalAbs(leftParts, rightParts);
  return leftParts.sign > 0 ? abs : -abs;
}

function decimalParts(value: string): { sign: 1 | -1; integer: string; fraction: string } {
  const sign = value.startsWith("-") ? -1 : 1;
  const unsigned = sign < 0 ? value.slice(1) : value;
  const [rawInteger, rawFraction = ""] = unsigned.split(".");
  return {
    sign,
    integer: rawInteger.replace(/^0+(?=\d)/, "") || "0",
    fraction: rawFraction.replace(/0+$/, ""),
  };
}

function compareDecimalAbs(
  left: { integer: string; fraction: string },
  right: { integer: string; fraction: string },
): number {
  if (left.integer.length !== right.integer.length) {
    return left.integer.length > right.integer.length ? 1 : -1;
  }
  if (left.integer !== right.integer) {
    return left.integer > right.integer ? 1 : -1;
  }
  const maxFractionLength = Math.max(left.fraction.length, right.fraction.length);
  const leftFraction = left.fraction.padEnd(maxFractionLength, "0");
  const rightFraction = right.fraction.padEnd(maxFractionLength, "0");
  if (leftFraction === rightFraction) {
    return 0;
  }
  return leftFraction > rightFraction ? 1 : -1;
}

function decimalToJsonNumber(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function decimalToNumber(value: string | null): number {
  if (value === null) {
    return 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeQuoteTimestamp(value: string): string {
  const parsed = parseQuoteTimestamp(value);
  if (parsed === null) {
    throw new Error(`Invalid input: Invalid timestamp '${value}'`);
  }
  return `${parsed.utcSecond}${parsed.fraction}+00:00`;
}

function normalizeStoredTimestamp(value: string): string {
  const parsed = parseQuoteTimestamp(value);
  return parsed === null
    ? toRustUtcSerdeRfc3339(new Date())
    : `${parsed.utcSecond}${parsed.fraction}Z`;
}

function timestampNow(): string {
  return toRustUtcRfc3339(new Date());
}

function toRustUtcRfc3339(date: Date): string {
  const iso = date.toISOString();
  return iso.endsWith(".000Z") ? `${iso.slice(0, -5)}+00:00` : iso.replace(/Z$/u, "+00:00");
}

function toRustUtcSerdeRfc3339(date: Date): string {
  const iso = date.toISOString();
  return iso.endsWith(".000Z") ? iso.slice(0, -5) + "Z" : iso;
}

function parseQuoteTimestamp(value: string): { utcSecond: string; fraction: string } | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?([Zz]|([+-])(\d{2}):?(\d{2}))$/u.exec(
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
  const zoneHour = Number(zoneHourRaw);
  const zoneMinute = Number(zoneMinuteRaw);
  if (
    month < 1 ||
    month > 12 ||
    hour > 23 ||
    minute > 59 ||
    second > 60 ||
    zoneHour > 23 ||
    zoneMinute > 59
  ) {
    return null;
  }

  const local = new Date(
    Date.UTC(
      2000,
      0,
      1,
      hour,
      minute,
      Math.min(second, 59),
      timestampFractionMilliseconds(fractionRaw),
    ),
  );
  local.setUTCFullYear(year, month - 1, day);
  if (
    Number.isNaN(local.valueOf()) ||
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() !== month - 1 ||
    local.getUTCDate() !== day
  ) {
    return null;
  }

  const offsetMinutes =
    zoneRaw === "Z" || zoneRaw === "z"
      ? 0
      : Number(`${signRaw ?? "+"}1`) * (zoneHour * 60 + zoneMinute);
  const utc = new Date(local.getTime() - offsetMinutes * 60_000);
  if (Number.isNaN(utc.valueOf())) {
    return null;
  }
  return {
    utcSecond:
      second === 60 ? `${utc.toISOString().slice(0, 17)}60` : utc.toISOString().slice(0, 19),
    fraction: normalizeQuoteTimestampFraction(fractionRaw),
  };
}

function timestampFractionMilliseconds(value: string | undefined): number {
  return Number((value ?? "").padEnd(3, "0").slice(0, 3) || "0");
}

function normalizeQuoteTimestampFraction(value: string | undefined): string {
  if (value === undefined || /^0+$/u.test(value)) {
    return "";
  }
  const nanos = value.slice(0, 9).padEnd(9, "0");
  if (nanos.endsWith("000000")) {
    return `.${nanos.slice(0, 3)}`;
  }
  if (nanos.endsWith("000")) {
    return `.${nanos.slice(0, 6)}`;
  }
  return `.${nanos}`;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null);
}

function parseJsonValue(value: string | null): unknown | null {
  if (value === null) {
    return null;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function snakeCase(value: string): string {
  return value.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
