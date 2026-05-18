import type { Database } from "bun:sqlite";

import { parseCsvRecords } from "../csv";
import { DEFAULT_HISTORY_DAYS, type MarketSyncMode } from "./portfolio-jobs";
import {
  type QuoteSyncEvent,
  type QuoteSyncOperation,
  queueUserQuoteSyncEvent,
} from "./quote-sync";

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

export interface MarketDataService {
  getExchanges?(): Promise<ExchangeInfo[]> | ExchangeInfo[];
  searchSymbol?(query: string): Promise<SymbolSearchResult[]> | SymbolSearchResult[];
  resolveSymbolQuote?(request: ResolveSymbolQuoteRequest): Promise<ResolvedQuote> | ResolvedQuote;
  getQuoteHistory?(symbol: string): Promise<Quote[]> | Quote[];
  fetchYahooDividends?(symbol: string): Promise<YahooDividend[]> | YahooDividend[];
  getLatestQuotes?(
    assetIds: string[],
  ): Promise<Record<string, LatestQuoteSnapshot>> | Record<string, LatestQuoteSnapshot>;
  getQuoteSyncErrorSnapshots?(): Promise<QuoteSyncErrorSnapshot[]> | QuoteSyncErrorSnapshot[];
  updateQuote?(symbol: string, quote: Record<string, unknown>): Promise<void> | void;
  deleteQuote?(id: string): Promise<void> | void;
  checkQuotesImport?(
    content: Uint8Array,
    hasHeaderRow: boolean,
  ): Promise<QuoteImport[]> | QuoteImport[];
  importQuotesCsv?(
    quotes: unknown[],
    overwriteExisting: boolean,
  ): Promise<QuoteImport[]> | QuoteImport[];
  syncHistoryQuotes?(): Promise<void> | void;
  syncMarketData?(marketSyncMode: MarketSyncMode): Promise<void> | void;
}

export interface MarketDataServiceOptions {
  exchangeCatalogJson?: string;
  fetch?: typeof fetch;
  now?: () => Date;
  queueQuoteSyncEvent?: (event: QuoteSyncEvent) => void;
}

export class MarketDataNotImplementedError extends Error {
  readonly status = 501;
  readonly code = "not_implemented";

  constructor(message: string) {
    super(message);
    this.name = "MarketDataNotImplementedError";
  }
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
  last_synced_at: string | null;
  data_source: string | null;
  error_count: number;
  last_error: string | null;
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

class YahooUnauthorizedError extends Error {}

const MAX_SYNC_ERRORS = 10;
const MARKET_CLOSE_GRACE_MINUTES = 60;
const QUOTE_HISTORY_BUFFER_DAYS = 45;
const MIN_SYNC_LOOKBACK_DAYS = 5;
const DEFAULT_MARKET_DATA_PROVIDER = "YAHOO";
const MINOR_CURRENCY_MAJOR: Record<string, string> = {
  GBp: "GBP",
  GBX: "GBP",
  KWF: "KWD",
  ZAc: "ZAR",
  ZAC: "ZAR",
  ILA: "ILS",
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

  return {
    getExchanges() {
      return exchangeCatalog.exchanges;
    },

    searchSymbol(query) {
      return searchSymbols(db, query, exchangeCatalog, fetchImpl);
    },

    resolveSymbolQuote(request) {
      return resolveSymbolQuote(request, exchangeCatalog, fetchImpl, {
        get: () => yahooCrumb,
        set: (crumb) => {
          yahooCrumb = crumb;
        },
        clear: () => {
          yahooCrumb = null;
        },
      });
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
      await syncMarketDataExecution(
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
      );
    },

    async syncMarketData(marketSyncMode) {
      if (!marketDataSyncRequiresExecution(marketSyncMode)) {
        return;
      }
      await syncMarketDataExecution(
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
        now(),
        quoteSyncStateExists,
      );
    },
  };
}

function marketDataSyncRequiresExecution(marketSyncMode: MarketSyncMode): boolean {
  if (marketSyncMode.type === "none") {
    return false;
  }
  return !Array.isArray(marketSyncMode.asset_ids) || marketSyncMode.asset_ids.length > 0;
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
): Promise<void> {
  if (marketSyncMode.type === "none") {
    return;
  }
  const scope: MarketSyncScope = marketSyncMode.asset_ids === null ? "broad" : "targeted";
  const assetIds =
    marketSyncMode.asset_ids === null
      ? readBroadMarketSyncAssetIds(db, marketSyncMode)
      : dedupe(marketSyncMode.asset_ids);
  if (assetIds.length === 0) {
    return;
  }

  const assets = readAssetsForMarketSync(db, assetIds);
  const states = quoteSyncStateExists ? readQuoteSyncStates(db, assetIds) : new Map();

  for (const assetId of assetIds) {
    const asset = assets.get(assetId);
    if (!asset || shouldSkipMarketSyncAsset(asset, marketSyncMode, scope)) {
      continue;
    }

    const state = states.get(asset.id) ?? null;
    const provider = effectiveMarketDataProvider(state, asset);
    if (provider !== DEFAULT_MARKET_DATA_PROVIDER) {
      continue;
    }
    if (
      marketSyncMode.type !== "backfill_history" &&
      (states.get(asset.id)?.error_count ?? 0) >= MAX_SYNC_ERRORS
    ) {
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

      db.transaction(() => {
        if (purgeProviderQuotes && quotes.length > 0) {
          deleteProviderQuotesForAsset(db, asset.id, provider);
        }
        for (const quote of quotes) {
          upsertQuoteWrite(db, historicalQuoteToQuoteWrite(quote), undefined);
        }
        updateQuoteSyncStateAfterSync(db, quoteSyncStateExists, asset.id, provider);
      })();
    } catch (error) {
      updateQuoteSyncStateAfterFailure(
        db,
        quoteSyncStateExists,
        asset.id,
        provider,
        errorMessage(error),
      );
    }
  }
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
  };
}

async function searchSymbols(
  db: Database,
  query: string,
  exchangeCatalog: ExchangeCatalog,
  fetchImpl: typeof fetch,
): Promise<SymbolSearchResult[]> {
  const existingSummaries = readSearchAssets(db, query).map((asset) =>
    assetToSearchResult(asset, exchangeCatalog),
  );
  const existingAssetIds = new Set(existingSummaries.map((summary) => summary.existingAssetId));

  let providerResults: SymbolSearchResult[] = [];
  try {
    providerResults = await searchYahooSymbols(query, exchangeCatalog, fetchImpl);
  } catch {
    providerResults = [];
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

function instrumentTypeFromQuoteType(quoteType: string): string | null {
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
  request: ResolveSymbolQuoteRequest,
  exchangeCatalog: ExchangeCatalog,
  fetchImpl: typeof fetch,
  crumbCache: {
    get: () => YahooCrumbData | null;
    set: (crumb: YahooCrumbData) => void;
    clear: () => void;
  },
): Promise<ResolvedQuote> {
  const trimmedSymbol = request.symbol.trim();
  if (trimmedSymbol === "") {
    return defaultResolvedQuote();
  }

  const preferredProvider = normalizePreferredProvider(request.providerId);
  if (preferredProvider !== null && preferredProvider !== "YAHOO") {
    return defaultResolvedQuote();
  }

  const instrumentType = normalizeInstrumentType(request.instrumentType) ?? "EQUITY";
  if (instrumentType === "BOND") {
    return defaultResolvedQuote();
  }

  const exchangeMic = optionalString(request.exchangeMic)?.toUpperCase() ?? null;
  const requestedQuoteCcy = optionalString(request.quoteCcy)?.toUpperCase() ?? null;
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
        return await fetchYahooResolvedQuote(
          yahooSymbol,
          canonical.quoteCcy,
          fetchImpl,
          crumbCache,
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
        SELECT asset_id, last_synced_at, data_source, error_count, last_error
        FROM quote_sync_state
        WHERE asset_id IN (${placeholders})
      `,
    )
    .all(...assetIds);
  return new Map(rows.map((row) => [row.asset_id, row]));
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

function shouldSkipMarketSyncAsset(
  asset: AssetMarketSyncRow,
  marketSyncMode: Exclude<MarketSyncMode, { type: "none" }>,
  scope: MarketSyncScope,
): boolean {
  if (asset.quote_mode.toUpperCase() !== "MARKET") {
    return true;
  }
  const allowInactive = scope === "broad" && marketSyncMode.type === "backfill_history";
  if (asset.is_active === 0 && !allowInactive) {
    return true;
  }
  if (asset.instrument_type === null || asset.instrument_symbol === null) {
    return true;
  }
  return false;
}

function effectiveMarketDataProvider(
  state: QuoteSyncStateRow | null,
  asset: AssetMarketSyncRow,
): string {
  const stateProvider = optionalString(state?.data_source);
  return (stateProvider ?? preferredProvider(asset.provider_config) ?? DEFAULT_MARKET_DATA_PROVIDER)
    .trim()
    .toUpperCase();
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
  const parsed = parseJsonValue(providerConfig);
  if (!isRecord(parsed) || !isRecord(parsed.overrides)) {
    return null;
  }
  const override = parsed.overrides[provider];
  if (!isRecord(override)) {
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
        error_count = quote_sync_state.error_count + 1,
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
      },
      []
    >(
      `
        SELECT qss.asset_id,
          COALESCE(a.display_code, a.instrument_symbol, qss.asset_id) AS symbol,
          COALESCE(a.quote_mode, 'MARKET') AS quote_mode,
          qss.error_count,
          qss.last_error
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
  const reason = response.statusText.trim();
  return reason
    ? `Yahoo returned ${response.status} ${reason}`
    : `Yahoo returned ${response.status}`;
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
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid input: Invalid timestamp '${value}'`);
  }
  return date.toISOString();
}

function normalizeStoredTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? timestampNow() : date.toISOString();
}

function timestampNow(): string {
  return new Date().toISOString();
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
