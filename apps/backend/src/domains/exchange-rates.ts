import type { Database } from "bun:sqlite";

export interface ExchangeRate {
  id: string;
  fromCurrency: string;
  toCurrency: string;
  rate: string;
  source: string;
  timestamp: string;
}

export interface NewExchangeRate {
  fromCurrency: string;
  toCurrency: string;
  rate: string;
  source: string;
}

export interface ExchangeRateRepository {
  getLatestExchangeRates(): ExchangeRate[];
  addExchangeRate(newRate: NewExchangeRate): ExchangeRate;
  updateExchangeRate(fromCurrency: string, toCurrency: string, rate: string): ExchangeRate;
  deleteExchangeRate(rateId: string): void;
}

export interface ExchangeRateService {
  getLatestExchangeRates(): ExchangeRate[];
  addExchangeRate(newRate: NewExchangeRate): Promise<ExchangeRate>;
  updateExchangeRate(fromCurrency: string, toCurrency: string, rate: string): Promise<ExchangeRate>;
  deleteExchangeRate(rateId: string): Promise<void>;
}

export interface ExchangeRateRepositoryOptions {
  queueAssetSyncEvent?: (event: ExchangeRateAssetSyncEvent) => void;
}

export type ExchangeRateAssetSyncOperation = "Create" | "Delete";

export interface ExchangeRateAssetSyncEvent {
  assetId: string;
  operation: ExchangeRateAssetSyncOperation;
  payload: FxAssetPayload | { id: string };
}

export interface FxAssetPayload {
  id: string;
  kind: "FX";
  name: string | null;
  displayCode: string | null;
  notes: string | null;
  metadata: string | null;
  isActive: boolean;
  quoteMode: "MARKET";
  quoteCcy: string;
  instrumentType: "FX";
  instrumentSymbol: string;
  instrumentExchangeMic: string | null;
  instrumentKey: string | null;
  providerConfig: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AssetRow {
  id: string;
  kind: string;
  name: string | null;
  display_code: string | null;
  notes: string | null;
  metadata: string | null;
  is_active: number | boolean;
  quote_mode: string;
  quote_ccy: string;
  instrument_type: string | null;
  instrument_symbol: string | null;
  instrument_exchange_mic: string | null;
  instrument_key: string | null;
  provider_config: string | null;
  created_at: string;
  updated_at: string;
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

const ASSET_KIND_FX = "FX";
const DATA_SOURCE_MANUAL = "MANUAL";

export function createExchangeRateRepository(
  db: Database,
  options: ExchangeRateRepositoryOptions = {},
): ExchangeRateRepository {
  return {
    getLatestExchangeRates() {
      const assets = db
        .query<AssetRow, [string]>(
          `
            SELECT ${assetColumns()}
            FROM assets
            WHERE kind = ?
            ORDER BY display_code ASC
          `,
        )
        .all(ASSET_KIND_FX);
      if (assets.length === 0) {
        return [];
      }
      const latestQuotes = latestFxQuotesByAssetId(db);
      return assets.map((asset) =>
        exchangeRateFromAssetAndQuote(asset, latestQuotes.get(asset.id)),
      );
    },
    addExchangeRate(newRate) {
      const assetId = createFxAsset(
        db,
        newRate.fromCurrency,
        newRate.toCurrency,
        newRate.source,
        options,
      );
      const rate = buildExchangeRate(
        assetId,
        newRate.fromCurrency,
        newRate.toCurrency,
        newRate.rate,
        newRate.source,
      );
      saveExchangeRateQuote(db, rate);
      return rate;
    },
    updateExchangeRate(fromCurrency, toCurrency, rate) {
      return this.addExchangeRate({
        fromCurrency,
        toCurrency,
        rate,
        source: DATA_SOURCE_MANUAL,
      });
    },
    deleteExchangeRate(rateId) {
      db.transaction(() => {
        db.prepare("DELETE FROM quotes WHERE asset_id = ?").run(rateId);
        const result = db.prepare("DELETE FROM assets WHERE id = ?").run(rateId);
        if (result.changes > 0) {
          options.queueAssetSyncEvent?.({
            assetId: rateId,
            operation: "Delete",
            payload: { id: rateId },
          });
        }
      })();
    },
  };
}

export function createExchangeRateService(repository: ExchangeRateRepository): ExchangeRateService {
  return {
    getLatestExchangeRates() {
      return repository.getLatestExchangeRates();
    },
    async addExchangeRate(newRate) {
      validateCurrency(newRate.fromCurrency, "fromCurrency");
      validateCurrency(newRate.toCurrency, "toCurrency");
      validateRate(newRate.rate);
      if (!newRate.source.trim()) {
        throw new Error("Invalid input: source cannot be empty");
      }
      return repository.addExchangeRate(newRate);
    },
    async updateExchangeRate(fromCurrency, toCurrency, rate) {
      validateCurrency(fromCurrency, "fromCurrency");
      validateCurrency(toCurrency, "toCurrency");
      validateRate(rate);
      return repository.updateExchangeRate(fromCurrency, toCurrency, rate);
    },
    async deleteExchangeRate(rateId) {
      repository.deleteExchangeRate(rateId);
    },
  };
}

function createFxAsset(
  db: Database,
  fromCurrency: string,
  toCurrency: string,
  source: string,
  options: ExchangeRateRepositoryOptions,
): string {
  let assetId: string | undefined;
  db.transaction(() => {
    const from = fromCurrency.toUpperCase();
    const to = toCurrency.toUpperCase();
    const instrumentKey = makeInstrumentKey(from, to);
    const existing = db
      .query<{ id: string }, [string]>("SELECT id FROM assets WHERE instrument_key = ?")
      .get(instrumentKey);
    if (existing) {
      assetId = existing.id;
      return;
    }

    const id = crypto.randomUUID();
    const now = timestampNow();
    const providerConfig = providerConfigJson(source, from, to);
    db.prepare(
      `
        INSERT INTO assets (
          id, kind, name, display_code, notes, metadata, is_active, quote_mode,
          quote_ccy, instrument_type, instrument_symbol, instrument_exchange_mic,
          provider_config, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, NULL, NULL, 1, ?, ?, ?, ?, NULL, ?, ?, ?)
      `,
    ).run(
      id,
      ASSET_KIND_FX,
      `${from}/${to} Exchange Rate`,
      `${from}/${to}`,
      "MARKET",
      to,
      "FX",
      from,
      providerConfig,
      now,
      now,
    );
    const inserted = readAssetById(db, id);
    options.queueAssetSyncEvent?.({
      assetId: id,
      operation: "Create",
      payload: assetPayload(inserted),
    });
    assetId = id;
  })();
  if (!assetId) {
    throw new Error(`Record not found: FX asset ${fromCurrency}/${toCurrency}`);
  }
  return assetId;
}

function saveExchangeRateQuote(db: Database, rate: ExchangeRate): void {
  const day = rate.timestamp.slice(0, 10);
  db.prepare(
    `
      INSERT INTO quotes (
        id, asset_id, day, source, open, high, low, close, adjclose, volume,
        currency, notes, created_at, timestamp
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        open = excluded.open,
        high = excluded.high,
        low = excluded.low,
        close = excluded.close,
        adjclose = excluded.adjclose,
        source = excluded.source
    `,
  ).run(
    `${rate.id}_${day}_${rate.source}`,
    rate.id,
    day,
    rate.source,
    rate.rate === "0" ? null : rate.rate,
    rate.rate === "0" ? null : rate.rate,
    rate.rate === "0" ? null : rate.rate,
    rate.rate,
    rate.rate === "0" ? null : rate.rate,
    rate.fromCurrency,
    rate.timestamp,
    rate.timestamp,
  );
}

function latestFxQuotesByAssetId(db: Database): Map<string, QuoteRow> {
  const rows = db
    .query<QuoteRow, [string]>(
      `
        SELECT ${quoteColumns("q")}
        FROM quotes q
        WHERE q.asset_id IN (SELECT id FROM assets WHERE kind = ?)
          AND (q.asset_id, q.timestamp) IN (
            SELECT asset_id, MAX(timestamp)
            FROM quotes
            GROUP BY asset_id
          )
        ORDER BY q.asset_id
      `,
    )
    .all(ASSET_KIND_FX);
  return new Map(rows.map((row) => [row.asset_id, row]));
}

function exchangeRateFromAssetAndQuote(asset: AssetRow, quote: QuoteRow | undefined): ExchangeRate {
  const fromCurrency = asset.instrument_symbol ?? "";
  const toCurrency = asset.quote_ccy;
  if (!quote) {
    return {
      id: asset.id,
      fromCurrency,
      toCurrency,
      rate: "0",
      source: preferredProvider(asset.provider_config) ?? DATA_SOURCE_MANUAL,
      timestamp: parseTimestampOrNow(asset.updated_at),
    };
  }
  return {
    id: asset.id,
    fromCurrency,
    toCurrency,
    rate: decimalStringOrZero(quote.close),
    source: quote.source,
    timestamp: parseTimestampOrNow(quote.timestamp),
  };
}

function buildExchangeRate(
  assetId: string,
  fromCurrency: string,
  toCurrency: string,
  rate: string,
  source: string,
): ExchangeRate {
  return {
    id: assetId,
    fromCurrency,
    toCurrency,
    rate: decimalStringOrZero(rate),
    source,
    timestamp: timestampNow(),
  };
}

function readAssetById(db: Database, assetId: string): AssetRow {
  const row = db
    .query<AssetRow, [string]>(
      `
        SELECT ${assetColumns()}
        FROM assets
        WHERE id = ?
      `,
    )
    .get(assetId);
  if (!row) {
    throw new Error(`Record not found: FX asset ${assetId}`);
  }
  return row;
}

function assetColumns(): string {
  return [
    "id",
    "kind",
    "name",
    "display_code",
    "notes",
    "metadata",
    "is_active",
    "quote_mode",
    "quote_ccy",
    "instrument_type",
    "instrument_symbol",
    "instrument_exchange_mic",
    "instrument_key",
    "provider_config",
    "created_at",
    "updated_at",
  ].join(", ");
}

function quoteColumns(alias: string): string {
  return [
    "id",
    "asset_id",
    "day",
    "source",
    "open",
    "high",
    "low",
    "close",
    "adjclose",
    "volume",
    "currency",
    "notes",
    "created_at",
    "timestamp",
  ]
    .map((column) => `${alias}.${column}`)
    .join(", ");
}

function assetPayload(row: AssetRow): FxAssetPayload {
  return {
    id: row.id,
    kind: "FX",
    name: row.name,
    displayCode: row.display_code,
    notes: row.notes,
    metadata: row.metadata,
    isActive: Boolean(row.is_active),
    quoteMode: "MARKET",
    quoteCcy: row.quote_ccy,
    instrumentType: "FX",
    instrumentSymbol: row.instrument_symbol ?? "",
    instrumentExchangeMic: row.instrument_exchange_mic,
    instrumentKey: row.instrument_key,
    providerConfig: row.provider_config,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function providerConfigJson(source: string, from: string, to: string): string {
  if (source === "YAHOO") {
    return JSON.stringify({
      preferred_provider: "YAHOO",
      overrides: { YAHOO: { type: "fx_symbol", symbol: `${from}${to}=X` } },
    });
  }
  if (source === "ALPHA_VANTAGE") {
    return JSON.stringify({
      preferred_provider: "ALPHA_VANTAGE",
      overrides: { ALPHA_VANTAGE: { type: "fx_pair", from, to } },
    });
  }
  const customPrefix = "CUSTOM_SCRAPER:";
  if (source.startsWith(customPrefix)) {
    return JSON.stringify({
      preferred_provider: "CUSTOM_SCRAPER",
      custom_provider_code: source.slice(customPrefix.length),
    });
  }
  return JSON.stringify({ preferred_provider: source });
}

function preferredProvider(providerConfig: string | null): string | undefined {
  if (!providerConfig) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(providerConfig) as { preferred_provider?: unknown };
    return typeof parsed.preferred_provider === "string" ? parsed.preferred_provider : undefined;
  } catch {
    return undefined;
  }
}

function makeInstrumentKey(from: string, to: string): string {
  return `FX:${from}/${to}`;
}

function validateCurrency(currency: string, field: string): void {
  if (!currency.trim()) {
    throw new Error(`Invalid input: ${field} cannot be empty`);
  }
}

function validateRate(rate: string): void {
  if (!isDecimalString(rate)) {
    throw new Error("Invalid input: rate must be a decimal string");
  }
}

function decimalStringOrZero(value: string): string {
  return isDecimalString(value) ? value : "0";
}

function isDecimalString(value: string): boolean {
  return /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim());
}

function parseTimestampOrNow(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? timestampNow() : parsed.toISOString();
}

function timestampNow(): string {
  return new Date().toISOString();
}
