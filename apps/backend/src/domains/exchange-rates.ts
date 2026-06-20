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

export interface LatestFxRateSnapshot {
  assetId: string;
  fromCurrency: string;
  toCurrency: string;
  instrumentKey: string | null;
  quoteTimestamp: string | null;
}

export interface NewExchangeRate {
  fromCurrency: string;
  toCurrency: string;
  rate: string;
  source: string;
}

export interface ExchangeRateRepository {
  getLatestExchangeRates(): ExchangeRate[];
  getLatestFxRateSnapshots(): LatestFxRateSnapshot[];
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
  ensureFxPairs(pairs: Array<[string, string]>): Promise<string[]>;
  getLatestFxRateSnapshots(): LatestFxRateSnapshot[];
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
    getLatestFxRateSnapshots() {
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
        latestFxRateSnapshotFromAsset(asset, latestQuotes.get(asset.id)),
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
        .filter((row) => timestampSortValue(row.timestamp) !== Number.NEGATIVE_INFINITY)
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
        .query<QuoteWithAssetRow, [string, string]>(
          `
            SELECT ${quoteColumns("q")},
              a.instrument_symbol AS asset_instrument_symbol,
              a.quote_ccy AS asset_quote_ccy
            FROM quotes q
            INNER JOIN assets a ON q.asset_id = a.id
            WHERE (a.instrument_key = ? OR a.id = ?)
            ORDER BY q.timestamp ASC
          `,
        )
        .all(symbol, symbol)
        .filter((row) => timestampInRange(row.timestamp, start, end))
        .filter((row) => timestampSortValue(row.timestamp) !== Number.NEGATIVE_INFINITY)
        .sort(
          (left, right) => timestampSortValue(left.timestamp) - timestampSortValue(right.timestamp),
        )
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
    let baseRate: Decimal;
    try {
      baseRate = getLatestRateBetweenNormalized(normalizedFrom, normalizedTo);
    } catch (error) {
      options.warn?.(`Exchange rate not available for ${normalizedFrom}/${normalizedTo}`);
      throw error;
    }
    return sourceMultiplier.mul(baseRate).mul(targetMultiplier);
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
  ): Promise<string | null> => {
    if (fromCurrency === toCurrency || fromCurrency === "" || toCurrency === "") {
      return null;
    }

    const normalizedFrom = normalizeCurrencyCode(fromCurrency);
    const normalizedTo = normalizeCurrencyCode(toCurrency);
    if (!normalizedFrom || !normalizedTo || normalizedFrom === normalizedTo) {
      return null;
    }

    try {
      return loadLatestExchangeRate(normalizedFrom, normalizedTo).id;
    } catch (error) {
      if (!(error instanceof ExchangeRateNotFoundError)) {
        throw error;
      }
      const assetId = repository.createFxAsset(normalizedFrom, normalizedTo, source);
      publishAssetsCreated(options.eventBus, assetId);
      return assetId;
    }
  };

  return {
    initialize() {
      initializeConverter();
    },
    getHistoricalRates(fromCurrency, toCurrency, days) {
      validateIntegerDays(days);
      const normalizedFrom = normalizeCurrencyCode(fromCurrency);
      const normalizedTo = normalizeCurrencyCode(toCurrency);
      const end = now();
      const start = historicalStartDate(end, days);
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
      const decimalAmount = parseDecimalInput(amount, "amount");
      if (fromCurrency === toCurrency) {
        return decimalToString(decimalAmount);
      }
      return decimalToString(decimalAmount.mul(latestExchangeRate(fromCurrency, toCurrency)));
    },
    convertCurrencyForDate(amount, fromCurrency, toCurrency, date) {
      const decimalAmount = parseDecimalInput(amount, "amount");
      if (fromCurrency === toCurrency) {
        return decimalToString(decimalAmount);
      }
      return decimalToString(
        decimalAmount.mul(exchangeRateForDate(fromCurrency, toCurrency, date)),
      );
    },
    getLatestExchangeRates() {
      return repository.getLatestExchangeRates();
    },
    getLatestFxRateSnapshots() {
      return repository.getLatestFxRateSnapshots();
    },
    async addExchangeRate(newRate) {
      validateCurrency(newRate.fromCurrency, "fromCurrency");
      validateCurrency(newRate.toCurrency, "toCurrency");
      validateRate(newRate.rate);
      if (!newRate.source.trim()) {
        throw new Error("Invalid input: source cannot be empty");
      }
      const exchangeRate = repository.addExchangeRate(newRate);
      initializeConverter();
      return exchangeRate;
    },
    async updateExchangeRate(fromCurrency, toCurrency, rate) {
      validateCurrency(fromCurrency, "fromCurrency");
      validateCurrency(toCurrency, "toCurrency");
      validateRate(rate);
      const exchangeRate = repository.updateExchangeRate(fromCurrency, toCurrency, rate);
      initializeConverter();
      return exchangeRate;
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
      const assetIds: string[] = [];
      for (const pair of uniquePairs) {
        const [fromCurrency, toCurrency] = pair.split("\0");
        if (fromCurrency !== undefined && toCurrency !== undefined && fromCurrency !== toCurrency) {
          const assetId = await registerCurrencyPairWithSource(
            fromCurrency,
            toCurrency,
            DATA_SOURCE_YAHOO,
          );
          if (assetId) {
            assetIds.push(assetId);
          }
        }
      }
      return [...new Set(assetIds)];
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
      if (!date) {
        continue;
      }
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
      history.sort((left, right) => dateOnlyToUtcMs(left.date) - dateOnlyToUtcMs(right.date));
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
    const targetMs = dateOnlyToUtcMs(date);
    for (const entry of history) {
      const entryMs = dateOnlyToUtcMs(entry.date);
      if (entryMs <= targetMs) {
        previous = entry;
      }
      if (entryMs >= targetMs) {
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
    try {
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
    } catch (error) {
      if (!String(error).includes("UNIQUE constraint failed: assets.instrument_key")) {
        throw error;
      }
      const existingAfterConflict = db
        .query<{ id: string }, [string]>("SELECT id FROM assets WHERE instrument_key = ?")
        .get(instrumentKey);
      if (!existingAfterConflict) {
        throw error;
      }
      assetId = existingAfterConflict.id;
      return;
    }
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
        ORDER BY q.asset_id ASC
      `,
    )
    .all(ASSET_KIND_FX);
  const latest = new Map<string, QuoteRow>();
  for (const row of rows) {
    const existing = latest.get(row.asset_id);
    if (!existing || timestampSortValue(row.timestamp) > timestampSortValue(existing.timestamp)) {
      latest.set(row.asset_id, row);
    }
  }
  return latest;
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

function latestFxRateSnapshotFromAsset(
  asset: AssetRow,
  quote: QuoteRow | undefined,
): LatestFxRateSnapshot {
  return {
    assetId: asset.id,
    fromCurrency: asset.instrument_symbol ?? "",
    toCurrency: asset.quote_ccy,
    instrumentKey: asset.instrument_key,
    quoteTimestamp: quote?.timestamp ?? null,
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
  const rows = db
    .query<QuoteWithAssetRow, [string, string]>(
      `
        SELECT ${quoteColumns("q")},
          a.instrument_symbol AS asset_instrument_symbol,
          a.quote_ccy AS asset_quote_ccy
        FROM quotes q
        INNER JOIN assets a ON q.asset_id = a.id
        WHERE a.instrument_key = ? OR a.id = ?
        ORDER BY q.timestamp DESC
      `,
    )
    .all(identity, identity);
  const row = rows.reduce<QuoteWithAssetRow | null>(
    (latest, candidate) =>
      latest && timestampSortValue(latest.timestamp) >= timestampSortValue(candidate.timestamp)
        ? latest
        : candidate,
    null,
  );
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
  validateDecimalString(rate, "rate");
}

function validateDecimalString(value: string, field: string): void {
  if (!isDecimalString(value)) {
    throw new Error(`Invalid input: ${field} must be a decimal string`);
  }
}

function parseDecimalInput(value: string, field: string): Decimal {
  const trimmed = value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid input: ${field} must be a decimal string`);
  }
  const decimal = new Decimal(trimmed);
  if (!decimal.isFinite()) {
    throw new Error(`Invalid input: ${field} must be a decimal string`);
  }
  return decimal;
}

function validateIntegerDays(days: number): void {
  if (!Number.isInteger(days)) {
    throw new Error("Invalid input: days must be an integer");
  }
}

function historicalStartDate(end: Date, days: number): Date {
  const startMs = end.getTime() - days * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(startMs)) {
    throw new Error("Invalid input: days is outside supported date range");
  }
  const start = new Date(startMs);
  if (Number.isNaN(start.valueOf())) {
    throw new Error("Invalid input: days is outside supported date range");
  }
  return start;
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
  const parsed = parseTimestampDate(value);
  if (!parsed) {
    return timestampNow();
  }
  return timestampToString(parsed);
}

function parseDateInput(date: string | Date): string {
  const parsed = date instanceof Date ? date : dateOnlyToDate(date);
  if (Number.isNaN(parsed.valueOf())) {
    throw new Error(`Invalid date: ${String(date)}`);
  }
  return utcDateString(parsed);
}

function utcDateString(date: Date): string {
  return `${chronoYearString(date.getUTCFullYear())}-${String(date.getUTCMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function dateStringFromTimestamp(timestamp: string): string {
  const parsed = parseTimestampDate(timestamp);
  return parsed ? utcDateString(parsed) : "";
}

function daysBetween(left: string, right: string): number {
  const leftMs = dateOnlyToUtcMs(left);
  const rightMs = dateOnlyToUtcMs(right);
  return Math.round((rightMs - leftMs) / (24 * 60 * 60 * 1000));
}

function dateOnlyToDate(value: string): Date {
  return new Date(dateOnlyToUtcMs(value));
}

function dateOnlyToUtcMs(value: string): number {
  const match = /^([+-]?\d{4,})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return Number.NaN;
  }
  const [, yearRaw, monthRaw, dayRaw] = match;
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const date = new Date(Date.UTC(2000, 0, 1));
  date.setUTCFullYear(year, month - 1, day);
  if (
    Number.isNaN(date.valueOf()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return Number.NaN;
  }
  return date.getTime();
}

function chronoYearString(year: number): string {
  if (year >= 0 && year <= 9999) {
    return year.toString().padStart(4, "0");
  }
  if (year > 9999) {
    return `+${year}`;
  }
  const absolute = Math.abs(year);
  return `-${absolute < 10_000 ? absolute.toString().padStart(4, "0") : absolute}`;
}

function parseTimestampDate(value: string): Date | null {
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.valueOf())) {
    return parsed;
  }
  return parseExpandedRfc3339DateTime(value);
}

function timestampSortValue(value: string): number {
  return parseTimestampDate(value)?.getTime() ?? Number.NEGATIVE_INFINITY;
}

function timestampInRange(value: string, start: Date, end: Date): boolean {
  const parsed = parseTimestampDate(value);
  return parsed !== null && parsed >= start && parsed <= end;
}

function parseExpandedRfc3339DateTime(value: string): Date | null {
  const match =
    /^([+-]?\d{4,})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(
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
  const millisecond = Number((fractionRaw ?? "").padEnd(3, "0").slice(0, 3));
  const zoneHour = Number(zoneHourRaw);
  const zoneMinute = Number(zoneMinuteRaw);
  const offsetMinutes = zoneRaw === "Z" ? 0 : zoneHour * 60 + zoneMinute;
  const offset = signRaw === "-" ? -offsetMinutes : offsetMinutes;
  const local = new Date(Date.UTC(2000, 0, 1, hour, minute, second, millisecond));
  local.setUTCFullYear(year, month - 1, day);
  if (
    Number.isNaN(local.valueOf()) ||
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() !== month - 1 ||
    local.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    zoneHour > 23 ||
    zoneMinute > 59
  ) {
    return null;
  }
  return new Date(local.getTime() - offset * 60_000);
}

function timestampToString(date: Date): string {
  const year = date.getUTCFullYear();
  if (year >= 0 && year <= 9999) {
    return date.toISOString();
  }
  const millisecond = date.getUTCMilliseconds();
  const fractional = millisecond === 0 ? "" : `.${millisecond.toString().padStart(3, "0")}`;
  return `${chronoYearString(year)}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(
    date.getUTCDate(),
  ).padStart(2, "0")}T${String(date.getUTCHours()).padStart(2, "0")}:${String(
    date.getUTCMinutes(),
  ).padStart(2, "0")}:${String(date.getUTCSeconds()).padStart(2, "0")}${fractional}+00:00`;
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
