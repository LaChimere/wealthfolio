import type { Database } from "bun:sqlite";

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
  fetchYahooDividends?(symbol: string): Promise<unknown[]> | unknown[];
  getLatestQuotes?(assetIds: string[]): Promise<unknown> | unknown;
  updateQuote?(symbol: string, quote: Record<string, unknown>): Promise<void> | void;
  deleteQuote?(id: string): Promise<void> | void;
  checkQuotesImport?(content: Uint8Array, hasHeaderRow: boolean): Promise<unknown[]> | unknown[];
  importQuotesCsv?(quotes: unknown[], overwriteExisting: boolean): Promise<unknown[]> | unknown[];
  syncHistoryQuotes?(): Promise<void> | void;
  syncMarketData?(marketSyncMode: MarketSyncMode): Promise<void> | void;
}

export interface MarketDataServiceOptions {
  exchangeCatalogJson?: string;
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

export function createMarketDataService(
  db: Database,
  options: MarketDataServiceOptions = {},
): MarketDataService {
  const exchanges = options.exchangeCatalogJson
    ? parseExchangeList(options.exchangeCatalogJson)
    : [];

  return {
    getExchanges() {
      return exchanges;
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

    updateQuote(symbol, quote) {
      const payload = normalizeQuoteWrite(symbol, quote);
      db.transaction(() => {
        if (payload.source === "MANUAL") {
          const oldId = optionalString(quote.id);
          if (oldId && oldId !== payload.id) {
            db.query("DELETE FROM quotes WHERE id = ?").run(oldId);
          }
        }

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
              id, asset_id, day, source, open, high, low, close, adjclose,
              volume, currency, notes, created_at, timestamp
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
      })();
    },

    deleteQuote(id) {
      db.query("DELETE FROM quotes WHERE id = ?").run(id);
    },
  };
}

export function parseExchangeList(json: string): ExchangeInfo[] {
  const parsed: unknown = JSON.parse(json);
  if (!isRecord(parsed) || !Array.isArray(parsed.exchanges)) {
    throw new Error("Invalid exchange metadata catalog");
  }
  return parsed.exchanges.flatMap((entry): ExchangeInfo[] => {
    if (
      !isRecord(entry) ||
      typeof entry.mic !== "string" ||
      typeof entry.name !== "string" ||
      typeof entry.currency !== "string"
    ) {
      return [];
    }
    return [
      {
        mic: entry.mic,
        name: entry.name,
        longName: typeof entry.long_name === "string" ? entry.long_name : entry.name,
        currency: entry.currency,
      },
    ];
  });
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

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
