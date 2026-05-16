import type { Database } from "bun:sqlite";

import Decimal from "decimal.js";

import type { BackendEventBus } from "../events";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN });

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
  getHistoricalExchangeRates(): ExchangeRate[];
  getLatestExchangeRate(fromCurrency: string, toCurrency: string): ExchangeRate | null;
  getLatestExchangeRateBySymbol(symbol: string): ExchangeRate | null;
  getHistoricalRatesBySymbol(symbol: string, start: Date, end: Date): ExchangeRate[];
  addExchangeRate(newRate: NewExchangeRate): ExchangeRate;
  updateExchangeRate(fromCurrency: string, toCurrency: string, rate: string): ExchangeRate;
  deleteExchangeRate(rateId: string): void;
  createFxAsset(fromCurrency: string, toCurrency: string, source: string): string;
}

export interface ExchangeRateService {
  initialize(): void;
  getHistoricalRates(fromCurrency: string, toCurrency: string, days: number): ExchangeRate[];
  getLatestExchangeRate(fromCurrency: string, toCurrency: string): string;
  getExchangeRateForDate(fromCurrency: string, toCurrency: string, date: string | Date): string;
  convertCurrency(amount: string, fromCurrency: string, toCurrency: string): string;
  convertCurrencyForDate(
    amount: string,
    fromCurrency: string,
    toCurrency: string,
    date: string | Date,
  ): string;
  getLatestExchangeRates(): ExchangeRate[];
  addExchangeRate(newRate: NewExchangeRate): Promise<ExchangeRate>;
  updateExchangeRate(fromCurrency: string, toCurrency: string, rate: string): Promise<ExchangeRate>;
  deleteExchangeRate(rateId: string): Promise<void>;
  registerCurrencyPair(fromCurrency: string, toCurrency: string): Promise<void>;
  registerCurrencyPairManual(fromCurrency: string, toCurrency: string): Promise<void>;
  ensureFxPairs(pairs: Array<[string, string]>): Promise<void>;
}

export interface ExchangeRateServiceOptions {
  eventBus?: BackendEventBus;
  now?: () => Date;
  warn?: (message: string) => void;
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

interface QuoteWithAssetRow extends QuoteRow {
  asset_instrument_symbol: string | null;
  asset_quote_ccy: string;
}

const ASSET_KIND_FX = "FX";
const DATA_SOURCE_MANUAL = "MANUAL";
const DATA_SOURCE_YAHOO = "YAHOO";
export const ASSETS_CREATED_EVENT = "assets_created";

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
    getHistoricalExchangeRates() {
      return db
        .query<QuoteWithAssetRow, [string]>(
          `
            SELECT ${quoteColumns("q")},
              a.instrument_symbol AS asset_instrument_symbol,
              a.quote_ccy AS asset_quote_ccy
            FROM quotes q
            INNER JOIN assets a ON q.asset_id = a.id
            WHERE a.kind = ?
            ORDER BY q.asset_id ASC, q.timestamp ASC
          `,
        )
        .all(ASSET_KIND_FX)
        .map(exchangeRateFromQuoteWithAsset);
    },
    getLatestExchangeRate(fromCurrency, toCurrency) {
      return getLatestExchangeRateByAssetIdentity(db, makeInstrumentKey(fromCurrency, toCurrency));
    },
    getLatestExchangeRateBySymbol(symbol) {
      return getLatestExchangeRateByAssetIdentity(db, symbol);
    },
    getHistoricalRatesBySymbol(symbol, start, end) {
      return db
        .query<QuoteWithAssetRow, [string, string, string, string]>(
          `
            SELECT ${quoteColumns("q")},
              a.instrument_symbol AS asset_instrument_symbol,
              a.quote_ccy AS asset_quote_ccy
            FROM quotes q
            INNER JOIN assets a ON q.asset_id = a.id
            WHERE (a.instrument_key = ? OR a.id = ?)
              AND q.timestamp >= ?
              AND q.timestamp <= ?
            ORDER BY q.timestamp ASC
          `,
        )
        .all(symbol, symbol, start.toISOString(), end.toISOString())
        .map(exchangeRateFromQuoteWithAsset);
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
    createFxAsset(fromCurrency, toCurrency, source) {
      return createFxAsset(db, fromCurrency, toCurrency, source, options);
    },
  };
}

export function createExchangeRateService(
  repository: ExchangeRateRepository,
  options: ExchangeRateServiceOptions = {},
): ExchangeRateService {
  let converter: CurrencyConverter | null = null;
  const now = options.now ?? (() => new Date());

  const initializeConverter = () => {
    const historicalRates = repository.getHistoricalExchangeRates();
    converter = historicalRates.length === 0 ? null : new CurrencyConverter(historicalRates);
  };

  const loadLatestExchangeRate = (fromCurrency: string, toCurrency: string): ExchangeRate => {
    const directRate = repository.getLatestExchangeRate(fromCurrency, toCurrency);
    if (directRate) {
      return directRate;
    }

    const inverseRate = repository.getLatestExchangeRateBySymbol(
      makeInstrumentKey(toCurrency, fromCurrency),
    );
    if (inverseRate) {
      const inverseDecimal = decimalOrZero(inverseRate.rate);
      if (!inverseDecimal.isZero()) {
        return {
          ...inverseRate,
          fromCurrency,
          toCurrency,
          rate: decimalToString(new Decimal(1).div(inverseDecimal)),
        };
      }
    }

    throw new ExchangeRateNotFoundError(fromCurrency, toCurrency);
  };

  const getLatestRateBetweenNormalized = (fromCurrency: string, toCurrency: string): Decimal => {
    if (fromCurrency === toCurrency) {
      return new Decimal(1);
    }

    if (converter) {
      const rate = converter.getRateNearest(fromCurrency, toCurrency, utcDateString(now()));
      if (rate) {
        return rate;
      }
    }

    return decimalOrZero(loadLatestExchangeRate(fromCurrency, toCurrency).rate);
  };

  const getRateForDateBetweenNormalized = (
    fromCurrency: string,
    toCurrency: string,
    date: string,
  ): Decimal => {
    if (fromCurrency === toCurrency) {
      return new Decimal(1);
    }

    if (converter) {
      const rate = converter.getRateNearest(fromCurrency, toCurrency, date);
      if (rate) {
        return rate;
      }
    }

    const fallbackRate = loadLatestExchangeRate(fromCurrency, toCurrency);
    options.warn?.(
      `No exchange rate found for ${fromCurrency}/${toCurrency} on ${date}. Using fallback rate from ${dateStringFromTimestamp(
        fallbackRate.timestamp,
      )}`,
    );
    return decimalOrZero(fallbackRate.rate);
  };

  const latestExchangeRate = (fromCurrency: string, toCurrency: string): Decimal => {
    const [normalizedFrom, normalizedTo, sourceMultiplier, targetMultiplier] =
      normalizeCurrencyPair(fromCurrency, toCurrency);
    if (normalizedFrom === normalizedTo) {
      return sourceMultiplier.mul(targetMultiplier);
    }
    return sourceMultiplier
      .mul(getLatestRateBetweenNormalized(normalizedFrom, normalizedTo))
      .mul(targetMultiplier);
  };

  const exchangeRateForDate = (
    fromCurrency: string,
    toCurrency: string,
    date: string | Date,
  ): Decimal => {
    validateIsoCurrencyCode(fromCurrency);
    validateIsoCurrencyCode(toCurrency);
    const [normalizedFrom, normalizedTo, sourceMultiplier, targetMultiplier] =
      normalizeCurrencyPair(fromCurrency, toCurrency);
    if (normalizedFrom === normalizedTo) {
      return sourceMultiplier.mul(targetMultiplier);
    }
    return sourceMultiplier
      .mul(getRateForDateBetweenNormalized(normalizedFrom, normalizedTo, parseDateInput(date)))
      .mul(targetMultiplier);
  };

  const registerCurrencyPairWithSource = async (
    fromCurrency: string,
    toCurrency: string,
    source: string,
  ) => {
    if (fromCurrency === toCurrency || fromCurrency === "" || toCurrency === "") {
      return;
    }

    const normalizedFrom = normalizeCurrencyCode(fromCurrency);
    const normalizedTo = normalizeCurrencyCode(toCurrency);
    if (!normalizedFrom || !normalizedTo || normalizedFrom === normalizedTo) {
      return;
    }

    try {
      loadLatestExchangeRate(normalizedFrom, normalizedTo);
      return;
    } catch (error) {
      if (!(error instanceof ExchangeRateNotFoundError)) {
        throw error;
      }
      const assetId = repository.createFxAsset(normalizedFrom, normalizedTo, source);
      publishAssetsCreated(options.eventBus, assetId);
    }
  };

  return {
    initialize() {
      initializeConverter();
    },
    getHistoricalRates(fromCurrency, toCurrency, days) {
      const normalizedFrom = normalizeCurrencyCode(fromCurrency);
      const normalizedTo = normalizeCurrencyCode(toCurrency);
      const end = now();
      const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
      return repository.getHistoricalRatesBySymbol(
        makeInstrumentKey(normalizedFrom, normalizedTo),
        start,
        end,
      );
    },
    getLatestExchangeRate(fromCurrency, toCurrency) {
      return decimalToString(latestExchangeRate(fromCurrency, toCurrency));
    },
    getExchangeRateForDate(fromCurrency, toCurrency, date) {
      return decimalToString(exchangeRateForDate(fromCurrency, toCurrency, date));
    },
    convertCurrency(amount, fromCurrency, toCurrency) {
      if (fromCurrency === toCurrency) {
        return decimalToString(decimalOrZero(amount));
      }
      return decimalToString(
        decimalOrZero(amount).mul(latestExchangeRate(fromCurrency, toCurrency)),
      );
    },
    convertCurrencyForDate(amount, fromCurrency, toCurrency, date) {
      if (fromCurrency === toCurrency) {
        return decimalToString(decimalOrZero(amount));
      }
      return decimalToString(
        decimalOrZero(amount).mul(exchangeRateForDate(fromCurrency, toCurrency, date)),
      );
    },
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
      initializeConverter();
    },
    async registerCurrencyPair(fromCurrency, toCurrency) {
      await registerCurrencyPairWithSource(fromCurrency, toCurrency, DATA_SOURCE_YAHOO);
    },
    async registerCurrencyPairManual(fromCurrency, toCurrency) {
      await registerCurrencyPairWithSource(fromCurrency, toCurrency, DATA_SOURCE_MANUAL);
    },
    async ensureFxPairs(pairs) {
      const uniquePairs = new Set(
        pairs.map(([fromCurrency, toCurrency]) => `${fromCurrency}\0${toCurrency}`),
      );
      for (const pair of uniquePairs) {
        const [fromCurrency, toCurrency] = pair.split("\0");
        if (fromCurrency !== undefined && toCurrency !== undefined && fromCurrency !== toCurrency) {
          await registerCurrencyPairWithSource(fromCurrency, toCurrency, DATA_SOURCE_YAHOO);
        }
      }
    },
  };
}

class CurrencyConverter {
  private readonly adjacent = new Map<string, Set<string>>();
  private readonly rates = new Map<string, Array<{ date: string; rate: Decimal }>>();

  constructor(exchangeRates: ExchangeRate[]) {
    this.addHistoricalRates(exchangeRates);
  }

  getRateNearest(fromCurrency: string, toCurrency: string, date: string): Decimal | null {
    return this.convertAmount(new Decimal(1), fromCurrency, toCurrency, date);
  }

  private addHistoricalRates(exchangeRates: ExchangeRate[]): void {
    for (const exchangeRate of exchangeRates) {
      if (exchangeRate.fromCurrency === exchangeRate.toCurrency) {
        continue;
      }

      const date = dateStringFromTimestamp(exchangeRate.timestamp);
      const forwardRate = decimalOrZero(exchangeRate.rate);
      this.addRate(exchangeRate.fromCurrency, exchangeRate.toCurrency, date, forwardRate);
      if (!forwardRate.isZero()) {
        this.addRate(
          exchangeRate.toCurrency,
          exchangeRate.fromCurrency,
          date,
          new Decimal(1).div(forwardRate),
        );
      }
    }

    for (const history of this.rates.values()) {
      history.sort((left, right) => left.date.localeCompare(right.date));
    }
  }

  private addRate(fromCurrency: string, toCurrency: string, date: string, rate: Decimal): void {
    const key = pairKey(fromCurrency, toCurrency);
    const history = this.rates.get(key) ?? [];
    const existing = history.find((entry) => entry.date === date);
    if (existing) {
      existing.rate = rate;
    } else {
      history.push({ date, rate });
    }
    this.rates.set(key, history);

    const neighbors = this.adjacent.get(fromCurrency) ?? new Set<string>();
    neighbors.add(toCurrency);
    this.adjacent.set(fromCurrency, neighbors);
  }

  private convertAmount(
    amount: Decimal,
    fromCurrency: string,
    toCurrency: string,
    date: string,
  ): Decimal | null {
    if (fromCurrency === toCurrency) {
      return amount;
    }

    const queue: Array<{ currency: string; rate: Decimal }> = [
      { currency: fromCurrency, rate: new Decimal(1) },
    ];
    const visited = new Set([fromCurrency]);

    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      if (!current) {
        continue;
      }
      if (current.currency === toCurrency) {
        return amount.mul(current.rate);
      }

      for (const neighbor of this.adjacent.get(current.currency) ?? []) {
        if (visited.has(neighbor)) {
          continue;
        }
        const edgeRate = this.getDirectRate(current.currency, neighbor, date);
        if (!edgeRate) {
          continue;
        }
        visited.add(neighbor);
        queue.push({ currency: neighbor, rate: current.rate.mul(edgeRate) });
      }
    }

    return null;
  }

  private getDirectRate(fromCurrency: string, toCurrency: string, date: string): Decimal | null {
    const history = this.rates.get(pairKey(fromCurrency, toCurrency));
    if (!history || history.length === 0) {
      return null;
    }

    let previous: { date: string; rate: Decimal } | undefined;
    let next: { date: string; rate: Decimal } | undefined;
    for (const entry of history) {
      if (entry.date <= date) {
        previous = entry;
      }
      if (entry.date >= date) {
        next = entry;
        break;
      }
    }

    if (previous && next) {
      if (previous.date === next.date) {
        return previous.rate;
      }
      const previousDistance = Math.abs(daysBetween(previous.date, date));
      const nextDistance = Math.abs(daysBetween(next.date, date));
      return previousDistance <= nextDistance ? previous.rate : next.rate;
    }
    return previous?.rate ?? next?.rate ?? null;
  }
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

function exchangeRateFromQuoteWithAsset(row: QuoteWithAssetRow): ExchangeRate {
  return {
    id: row.asset_id,
    fromCurrency: row.asset_instrument_symbol ?? "",
    toCurrency: row.asset_quote_ccy,
    rate: decimalStringOrZero(row.close),
    source: row.source,
    timestamp: parseTimestampOrNow(row.timestamp),
  };
}

function getLatestExchangeRateByAssetIdentity(db: Database, identity: string): ExchangeRate | null {
  const row = db
    .query<QuoteWithAssetRow, [string, string]>(
      `
        SELECT ${quoteColumns("q")},
          a.instrument_symbol AS asset_instrument_symbol,
          a.quote_ccy AS asset_quote_ccy
        FROM quotes q
        INNER JOIN assets a ON q.asset_id = a.id
        WHERE a.instrument_key = ? OR a.id = ?
        ORDER BY q.timestamp DESC
        LIMIT 1
      `,
    )
    .get(identity, identity);
  return row ? exchangeRateFromQuoteWithAsset(row) : null;
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

function normalizeCurrencyPair(
  fromCurrency: string,
  toCurrency: string,
): [string, string, Decimal, Decimal] {
  const normalizedFrom = normalizeCurrencyCode(fromCurrency);
  const normalizedTo = normalizeCurrencyCode(toCurrency);
  const sourceMultiplier =
    normalizedFrom === fromCurrency
      ? new Decimal(1)
      : new Decimal(1).div(denormalizationMultiplier(fromCurrency));
  const targetMultiplier = denormalizationMultiplier(toCurrency);
  return [normalizedFrom, normalizedTo, sourceMultiplier, targetMultiplier];
}

function normalizeCurrencyCode(currency: string): string {
  return CURRENCY_NORMALIZATION_RULES[currency]?.majorCode ?? currency;
}

function denormalizationMultiplier(currency: string): Decimal {
  const rule = CURRENCY_NORMALIZATION_RULES[currency];
  return rule ? new Decimal(1).div(rule.factor) : new Decimal(1);
}

const CURRENCY_NORMALIZATION_RULES: Record<string, { majorCode: string; factor: Decimal }> = {
  GBp: { majorCode: "GBP", factor: new Decimal("0.01") },
  GBX: { majorCode: "GBP", factor: new Decimal("0.01") },
  KWF: { majorCode: "KWD", factor: new Decimal("0.01") },
  ZAc: { majorCode: "ZAR", factor: new Decimal("0.01") },
  ZAC: { majorCode: "ZAR", factor: new Decimal("0.01") },
  ILA: { majorCode: "ILS", factor: new Decimal("0.01") },
};

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

function validateIsoCurrencyCode(currency: string): void {
  if (currency.length !== 3 || !/^[A-Za-z]+$/.test(currency)) {
    throw new Error(`Invalid currency code: ${currency}`);
  }
}

function decimalStringOrZero(value: string): string {
  return isDecimalString(value) ? value : "0";
}

function decimalOrZero(value: string): Decimal {
  return isDecimalString(value) ? new Decimal(value) : new Decimal(0);
}

function decimalToString(value: Decimal): string {
  return value.toString();
}

function isDecimalString(value: string): boolean {
  return /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim());
}

class ExchangeRateNotFoundError extends Error {
  constructor(fromCurrency: string, toCurrency: string) {
    super(`Exchange rate not found: Exchange rate not found for ${fromCurrency}/${toCurrency}`);
  }
}

function pairKey(fromCurrency: string, toCurrency: string): string {
  return `${fromCurrency}\0${toCurrency}`;
}

function parseTimestampOrNow(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? timestampNow() : parsed.toISOString();
}

function parseDateInput(date: string | Date): string {
  const parsed = date instanceof Date ? date : new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf())) {
    throw new Error(`Invalid date: ${String(date)}`);
  }
  return utcDateString(parsed);
}

function utcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dateStringFromTimestamp(timestamp: string): string {
  return parseTimestampOrNow(timestamp).slice(0, 10);
}

function daysBetween(left: string, right: string): number {
  const leftMs = Date.parse(`${left}T00:00:00.000Z`);
  const rightMs = Date.parse(`${right}T00:00:00.000Z`);
  return Math.round((rightMs - leftMs) / (24 * 60 * 60 * 1000));
}

function publishAssetsCreated(eventBus: BackendEventBus | undefined, assetId: string): void {
  eventBus?.publish({
    name: ASSETS_CREATED_EVENT,
    payload: {
      type: ASSETS_CREATED_EVENT,
      asset_ids: [assetId],
    },
  });
}

function timestampNow(): string {
  return new Date().toISOString();
}
