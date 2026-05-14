import type { Database } from "bun:sqlite";

import { parseCsvRecords } from "../csv";
import type { MarketSyncMode } from "./portfolio-jobs";

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

export interface ResolveSymbolQuoteRequest {
  symbol: string;
  exchangeMic?: string;
  instrumentType?: string;
  quoteCcy?: string;
  providerId?: string;
}

export interface MarketDataService {
  getExchanges?(): Promise<ExchangeInfo[]> | ExchangeInfo[];
  searchSymbol?(query: string): Promise<unknown[]> | unknown[];
  resolveSymbolQuote?(request: ResolveSymbolQuoteRequest): Promise<unknown> | unknown;
  getQuoteHistory?(symbol: string): Promise<Quote[]> | Quote[];
  fetchYahooDividends?(symbol: string): Promise<YahooDividend[]> | YahooDividend[];
  getLatestQuotes?(
    assetIds: string[],
  ): Promise<Record<string, LatestQuoteSnapshot>> | Record<string, LatestQuoteSnapshot>;
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
  timezoneByMic: ReadonlyMap<string, string>;
  closeByMic: ReadonlyMap<string, readonly [number, number]>;
  yahooSuffixByMic: ReadonlyMap<string, string>;
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
  error_count: number;
  last_error: string | null;
}

interface QuoteImportAssetRow {
  id: string;
  display_code: string | null;
  instrument_exchange_mic: string | null;
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

const MAX_SYNC_ERRORS = 10;
const MARKET_CLOSE_GRACE_MINUTES = 60;
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
            db.query("DELETE FROM quotes WHERE id = ?").run(oldId);
          }
        }
        upsertQuoteWrite(db, payload);
      })();
    },

    deleteQuote(id) {
      db.query("DELETE FROM quotes WHERE id = ?").run(id);
    },

    checkQuotesImport(content, hasHeaderRow) {
      return checkQuoteImports(db, content, hasHeaderRow, exchangeCatalog);
    },

    importQuotesCsv(quotes, overwriteExisting) {
      return importQuoteRows(db, quotes, overwriteExisting);
    },
  };
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
  const timezoneByMic = new Map<string, string>();
  const closeByMic = new Map<string, readonly [number, number]>();
  const yahooSuffixByMic = new Map<string, string>();
  for (const entry of parsed.exchanges) {
    if (!isRecord(entry) || typeof entry.mic !== "string") {
      continue;
    }
    const mic = entry.mic.toUpperCase();
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
      exchanges.push({
        mic: entry.mic,
        name: entry.name,
        longName: typeof entry.long_name === "string" ? entry.long_name : entry.name,
        currency: entry.currency,
      });
    }
    if (isRecord(entry.yahoo) && typeof entry.yahoo.suffix === "string") {
      const suffix = entry.yahoo.suffix.trim().replace(/^\./, "");
      if (suffix) {
        yahooSuffixByMic.set(mic, suffix);
      }
    }
  }
  return { exchanges, timezoneByMic, closeByMic, yahooSuffixByMic };
}

function emptyExchangeCatalog(): ExchangeCatalog {
  return {
    exchanges: [],
    timezoneByMic: new Map(),
    closeByMic: new Map(),
    yahooSuffixByMic: new Map(),
  };
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
        SELECT asset_id, last_synced_at, error_count, last_error
        FROM quote_sync_state
        WHERE asset_id IN (${placeholders})
      `,
    )
    .all(...assetIds);
  return new Map(rows.map((row) => [row.asset_id, row]));
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
      upsertQuoteWrite(db, payload);
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

function upsertQuoteWrite(db: Database, payload: QuoteWrite): void {
  const existing = db
    .query<
      { id: string },
      [string, string, string]
    >("SELECT id FROM quotes WHERE asset_id = ? AND day = ? AND source = ?")
    .get(payload.assetId, payload.day, payload.source);
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
