import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import {
  ASSETS_CREATED_EVENT,
  createExchangeRateRepository,
  createExchangeRateService,
  type ExchangeRateAssetSyncEvent,
} from "./exchange-rates";
import { createEventBus, type BackendEvent } from "../events";

describe("TS exchange rates domain", () => {
  test("lists FX assets by display code with latest quote or provider fallback", () => {
    const db = createExchangeRatesDb();
    const service = createExchangeRateService(createExchangeRateRepository(db));

    try {
      seedFxAsset(db, {
        id: "usd-cad",
        from: "USD",
        to: "CAD",
        providerConfig: JSON.stringify({ preferred_provider: "YAHOO" }),
      });
      seedFxAsset(db, {
        id: "eur-usd",
        from: "EUR",
        to: "USD",
        providerConfig: JSON.stringify({ preferred_provider: "MANUAL" }),
      });
      seedQuote(db, {
        id: "old",
        assetId: "eur-usd",
        day: "2026-01-01",
        close: "1.10",
        source: "YAHOO",
      });
      seedQuote(db, {
        id: "latest",
        assetId: "eur-usd",
        day: "2026-01-02",
        close: "1.20",
        source: "MANUAL",
      });

      expect(service.getLatestExchangeRates()).toEqual([
        expect.objectContaining({
          id: "eur-usd",
          fromCurrency: "EUR",
          toCurrency: "USD",
          rate: "1.20",
          source: "MANUAL",
        }),
        expect.objectContaining({
          id: "usd-cad",
          fromCurrency: "USD",
          toCurrency: "CAD",
          rate: "0",
          source: "YAHOO",
        }),
      ]);
      expect(service.getLatestFxRateSnapshots()).toEqual([
        {
          assetId: "eur-usd",
          fromCurrency: "EUR",
          toCurrency: "USD",
          instrumentKey: "FX:EUR/USD",
          quoteTimestamp: "2026-01-02T16:00:00.000Z",
        },
        {
          assetId: "usd-cad",
          fromCurrency: "USD",
          toCurrency: "CAD",
          instrumentKey: "FX:USD/CAD",
          quoteTimestamp: null,
        },
      ]);
    } finally {
      db.close();
    }
  });

  test("adds exchange rates by creating FX assets and upserting quotes", async () => {
    const db = createExchangeRatesDb();
    const syncEvents: ExchangeRateAssetSyncEvent[] = [];
    const service = createExchangeRateService(
      createExchangeRateRepository(db, { queueAssetSyncEvent: (event) => syncEvents.push(event) }),
    );

    try {
      const added = await service.addExchangeRate({
        fromCurrency: "eur",
        toCurrency: "usd",
        rate: "1.23",
        source: "YAHOO",
      });

      expect(added).toMatchObject({
        fromCurrency: "eur",
        toCurrency: "usd",
        rate: "1.23",
        source: "YAHOO",
      });
      expect(readAsset(db, added.id)).toMatchObject({
        kind: "FX",
        display_code: "EUR/USD",
        quote_ccy: "USD",
        instrument_symbol: "EUR",
        instrument_key: "FX:EUR/USD",
      });
      expect(readQuote(db, added.id)).toMatchObject({
        close: "1.23",
        source: "YAHOO",
        currency: "eur",
      });
      expect(syncEvents).toEqual([
        expect.objectContaining({
          assetId: added.id,
          operation: "Create",
          payload: expect.objectContaining({ instrumentSymbol: "EUR" }),
        }),
      ]);
      expect(syncEvents[0]?.payload).not.toHaveProperty("instrumentKey");

      const second = await service.addExchangeRate({
        fromCurrency: "EUR",
        toCurrency: "USD",
        rate: "1.24",
        source: "YAHOO",
      });
      expect(second.id).toBe(added.id);
      expect(syncEvents).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  test("updates exchange rates as manual quotes and validates inputs", async () => {
    const db = createExchangeRatesDb();
    const service = createExchangeRateService(createExchangeRateRepository(db));

    try {
      await expect(
        service.addExchangeRate({
          fromCurrency: "",
          toCurrency: "USD",
          rate: "1.0",
          source: "MANUAL",
        }),
      ).rejects.toThrow("fromCurrency cannot be empty");
      await expect(
        service.addExchangeRate({
          fromCurrency: "EUR",
          toCurrency: "USD",
          rate: "not-a-number",
          source: "MANUAL",
        }),
      ).rejects.toThrow("rate must be a decimal string");

      const updated = await service.updateExchangeRate("EUR", "USD", "1.25");
      expect(updated).toMatchObject({ rate: "1.25", source: "MANUAL" });
      expect(readQuote(db, updated.id)).toMatchObject({
        close: "1.25",
        source: "MANUAL",
      });
    } finally {
      db.close();
    }
  });

  test("deletes exchange rates by removing quotes and asset with sync delete only when present", async () => {
    const db = createExchangeRatesDb();
    const syncEvents: ExchangeRateAssetSyncEvent[] = [];
    const service = createExchangeRateService(
      createExchangeRateRepository(db, { queueAssetSyncEvent: (event) => syncEvents.push(event) }),
    );

    try {
      seedFxAsset(db, { id: "eur-usd", from: "EUR", to: "USD" });
      seedQuote(db, {
        id: "quote",
        assetId: "eur-usd",
        day: "2026-01-02",
        close: "1.20",
        source: "MANUAL",
      });

      await service.deleteExchangeRate("missing");
      expect(syncEvents).toEqual([]);

      await service.deleteExchangeRate("eur-usd");
      expect(db.query("SELECT id FROM quotes WHERE asset_id = 'eur-usd'").all()).toEqual([]);
      expect(db.query("SELECT id FROM assets WHERE id = 'eur-usd'").all()).toEqual([]);
      expect(syncEvents).toEqual([
        { assetId: "eur-usd", operation: "Delete", payload: { id: "eur-usd" } },
      ]);
    } finally {
      db.close();
    }
  });

  test("converts currencies with initialized nearest-date graph, inverse rates, and paths", () => {
    const db = createExchangeRatesDb();
    const warnings: string[] = [];
    const service = createExchangeRateService(createExchangeRateRepository(db), {
      now: () => new Date("2023-10-27T12:00:00Z"),
      warn: (message) => warnings.push(message),
    });

    try {
      seedFxAsset(db, { id: "usd-cad", from: "USD", to: "CAD" });
      seedQuote(db, {
        id: "usd-cad-old",
        assetId: "usd-cad",
        day: "2023-10-20",
        close: "1.20",
        source: "MANUAL",
      });
      seedQuote(db, {
        id: "usd-cad-future",
        assetId: "usd-cad",
        day: "2023-10-30",
        close: "1.50",
        source: "MANUAL",
      });
      seedFxAsset(db, { id: "usd-eur", from: "USD", to: "EUR" });
      seedQuote(db, {
        id: "usd-eur",
        assetId: "usd-eur",
        day: "2023-10-25",
        close: "0.5",
        source: "MANUAL",
      });
      seedFxAsset(db, { id: "eur-chf", from: "EUR", to: "CHF" });
      seedQuote(db, {
        id: "eur-chf",
        assetId: "eur-chf",
        day: "2023-10-25",
        close: "4",
        source: "MANUAL",
      });
      seedFxAsset(db, { id: "eur-gbp", from: "EUR", to: "GBP" });
      seedQuote(db, {
        id: "eur-gbp",
        assetId: "eur-gbp",
        day: "2023-10-25",
        close: "3",
        source: "MANUAL",
      });

      service.initialize();

      expect(service.getExchangeRateForDate("USD", "CAD", "2023-10-27")).toBe("1.5");
      expect(service.getExchangeRateForDate("USD", "CAD", "2023-10-25")).toBe("1.2");
      expect(service.getLatestExchangeRate("CAD", "USD")).toBe("0.6666666666666666666666666667");
      expect(service.getExchangeRateForDate("USD", "CHF", "2023-10-26")).toBe("2");
      expect(service.convertCurrencyForDate("10", "USD", "CHF", "2023-10-26")).toBe("20");
      expect(service.convertCurrency("6", "EUR", "GBP")).toBe("18");
      expect(() => service.convertCurrency("1", "USD", "NOK")).toThrow("Exchange rate not found");
      expect(warnings).toEqual(["Exchange rate not available for USD/NOK"]);
    } finally {
      db.close();
    }
  });

  test("warns when dated conversion falls back to latest available rate", () => {
    const db = createExchangeRatesDb();
    const warnings: string[] = [];
    const service = createExchangeRateService(createExchangeRateRepository(db), {
      warn: (message) => warnings.push(message),
    });

    try {
      seedFxAsset(db, { id: "usd-cad", from: "USD", to: "CAD" });
      seedQuote(db, {
        id: "usd-cad",
        assetId: "usd-cad",
        day: "2026-01-01",
        close: "1.20",
        source: "MANUAL",
      });

      expect(service.getExchangeRateForDate("USD", "CAD", "2026-02-01")).toBe("1.2");
      expect(warnings).toEqual([
        "No exchange rate found for USD/CAD on 2026-02-01. Using fallback rate from 2026-01-01",
      ]);
    } finally {
      db.close();
    }
  });

  test("applies Rust-compatible minor currency normalization multipliers", () => {
    const db = createExchangeRatesDb();
    const service = createExchangeRateService(createExchangeRateRepository(db));

    try {
      seedFxAsset(db, { id: "gbp-usd", from: "GBP", to: "USD" });
      seedQuote(db, {
        id: "gbp-usd",
        assetId: "gbp-usd",
        day: "2026-01-01",
        close: "1.25",
        source: "MANUAL",
      });
      service.initialize();

      expect(service.getLatestExchangeRate("GBp", "USD")).toBe("0.0125");
      expect(service.getLatestExchangeRate("GBP", "GBp")).toBe("100");
      expect(service.getExchangeRateForDate("GBp", "USD", "2026-01-01")).toBe("0.0125");
    } finally {
      db.close();
    }
  });

  test("reads historical rates with full timestamp boundaries", () => {
    const db = createExchangeRatesDb();
    const service = createExchangeRateService(createExchangeRateRepository(db), {
      now: () => new Date("2026-05-04T16:00:00Z"),
    });

    try {
      seedFxAsset(db, { id: "usd-cad", from: "USD", to: "CAD" });
      seedQuote(db, {
        id: "excluded",
        assetId: "usd-cad",
        day: "2026-05-02",
        close: "1.10",
        source: "MANUAL",
      });
      seedQuote(db, {
        id: "included-start",
        assetId: "usd-cad",
        day: "2026-05-03",
        close: "1.20",
        source: "MANUAL",
      });
      seedQuote(db, {
        id: "included-end",
        assetId: "usd-cad",
        day: "2026-05-04",
        close: "1.30",
        source: "MANUAL",
      });

      expect(service.getHistoricalRates("USD", "CAD", 1).map((rate) => rate.rate)).toEqual([
        "1.20",
        "1.30",
      ]);
    } finally {
      db.close();
    }
  });

  test("registers missing FX pairs with provider source, events, and normalization skips", async () => {
    const db = createExchangeRatesDb();
    const eventBus = createEventBus();
    const events: BackendEvent[] = [];
    eventBus.subscribe((event) => events.push(event));
    const service = createExchangeRateService(createExchangeRateRepository(db), { eventBus });

    try {
      await service.registerCurrencyPair("GBp", "GBP");
      expect(db.query("SELECT id FROM assets").all()).toEqual([]);

      await service.registerCurrencyPair("USD", "CAD");
      const yahooAsset = db
        .query<
          { id: string; provider_config: string },
          []
        >("SELECT id, provider_config FROM assets WHERE instrument_key = 'FX:USD/CAD'")
        .get();
      expect(yahooAsset?.provider_config).toContain('"preferred_provider":"YAHOO"');
      expect(events).toEqual([
        {
          name: ASSETS_CREATED_EVENT,
          payload: { type: ASSETS_CREATED_EVENT, asset_ids: [yahooAsset?.id] },
        },
      ]);

      await service.registerCurrencyPairManual("EUR", "CHF");
      const manualAsset = db
        .query<
          { provider_config: string },
          []
        >("SELECT provider_config FROM assets WHERE instrument_key = 'FX:EUR/CHF'")
        .get();
      expect(manualAsset?.provider_config).toBe('{"preferred_provider":"MANUAL"}');

      const ensuredAssetIds = await service.ensureFxPairs([
        ["NOK", "SEK"],
        ["NOK", "SEK"],
        ["EUR", "EUR"],
        ["GBp", "GBP"],
      ]);
      const nokSekAsset = db
        .query<{ id: string }, []>("SELECT id FROM assets WHERE instrument_key = 'FX:NOK/SEK'")
        .get();
      expect(ensuredAssetIds).toEqual([nokSekAsset?.id]);
      expect(
        db
          .query<
            { count: number },
            []
          >("SELECT COUNT(*) AS count FROM assets WHERE instrument_key = 'FX:NOK/SEK'")
          .get()?.count,
      ).toBe(1);
    } finally {
      db.close();
    }
  });

  test("skips pair registration when inverse rates exist and refreshes converter after delete", async () => {
    const db = createExchangeRatesDb();
    const service = createExchangeRateService(createExchangeRateRepository(db), {
      now: () => new Date("2026-01-02T12:00:00Z"),
    });

    try {
      seedFxAsset(db, { id: "cad-usd", from: "CAD", to: "USD" });
      seedQuote(db, {
        id: "cad-usd",
        assetId: "cad-usd",
        day: "2026-01-01",
        close: "0.8",
        source: "MANUAL",
      });
      service.initialize();

      await service.registerCurrencyPair("USD", "CAD");
      expect(
        db
          .query<
            { count: number },
            []
          >("SELECT COUNT(*) AS count FROM assets WHERE instrument_key = 'FX:USD/CAD'")
          .get()?.count,
      ).toBe(0);
      expect(service.getLatestExchangeRate("USD", "CAD")).toBe("1.25");
      expect(await service.ensureFxPairs([["USD", "CAD"]])).toEqual(["cad-usd"]);

      await service.deleteExchangeRate("cad-usd");
      expect(() => service.getLatestExchangeRate("USD", "CAD")).toThrow("Exchange rate not found");
    } finally {
      db.close();
    }
  });
});

function createExchangeRatesDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE assets (
      id TEXT NOT NULL PRIMARY KEY,
      kind TEXT NOT NULL,
      name TEXT,
      display_code TEXT,
      notes TEXT,
      metadata TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      quote_mode TEXT NOT NULL DEFAULT 'MARKET',
      quote_ccy TEXT NOT NULL,
      instrument_type TEXT,
      instrument_symbol TEXT,
      instrument_exchange_mic TEXT,
      instrument_key TEXT GENERATED ALWAYS AS (
        CASE
          WHEN instrument_type = 'FX' AND instrument_symbol IS NOT NULL
          THEN 'FX:' || instrument_symbol || '/' || quote_ccy
          ELSE instrument_symbol
        END
      ) STORED,
      provider_config TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE quotes (
      id TEXT NOT NULL PRIMARY KEY,
      asset_id TEXT NOT NULL,
      day TEXT NOT NULL,
      source TEXT NOT NULL,
      open TEXT,
      high TEXT,
      low TEXT,
      close TEXT NOT NULL,
      adjclose TEXT,
      volume TEXT,
      currency TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );
  `);
  return db;
}

function seedFxAsset(
  db: Database,
  asset: {
    id: string;
    from: string;
    to: string;
    providerConfig?: string | null;
  },
): void {
  db.prepare(
    `
      INSERT INTO assets (
        id, kind, name, display_code, notes, metadata, is_active, quote_mode,
        quote_ccy, instrument_type, instrument_symbol, instrument_exchange_mic,
        provider_config, created_at, updated_at
      )
      VALUES (?, 'FX', ?, ?, NULL, NULL, 1, 'MARKET', ?, 'FX', ?, NULL, ?, ?, ?)
    `,
  ).run(
    asset.id,
    `${asset.from}/${asset.to} Exchange Rate`,
    `${asset.from}/${asset.to}`,
    asset.to,
    asset.from,
    asset.providerConfig ?? JSON.stringify({ preferred_provider: "MANUAL" }),
    "2026-01-01T00:00:00Z",
    "2026-01-01T00:00:00Z",
  );
}

function seedQuote(
  db: Database,
  quote: {
    id: string;
    assetId: string;
    day: string;
    close: string;
    source: string;
    timestamp?: string;
  },
): void {
  const timestamp = quote.timestamp ?? `${quote.day}T16:00:00.000Z`;
  db.prepare(
    `
      INSERT INTO quotes (
        id, asset_id, day, source, open, high, low, close, adjclose, volume,
        currency, notes, created_at, timestamp
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'EUR', NULL, ?, ?)
    `,
  ).run(
    quote.id,
    quote.assetId,
    quote.day,
    quote.source,
    quote.close,
    quote.close,
    quote.close,
    quote.close,
    quote.close,
    timestamp,
    timestamp,
  );
}

function readAsset(db: Database, assetId: string): Record<string, unknown> | null {
  return db.query("SELECT * FROM assets WHERE id = ?").get(assetId) as Record<
    string,
    unknown
  > | null;
}

function readQuote(db: Database, assetId: string): Record<string, unknown> | null {
  return db
    .query("SELECT * FROM quotes WHERE asset_id = ? ORDER BY timestamp DESC")
    .get(assetId) as Record<string, unknown> | null;
}
