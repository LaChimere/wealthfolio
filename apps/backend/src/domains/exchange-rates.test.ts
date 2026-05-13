import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import {
  createExchangeRateRepository,
  createExchangeRateService,
  type ExchangeRateAssetSyncEvent,
} from "./exchange-rates";

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
          payload: expect.objectContaining({ instrumentKey: "FX:EUR/USD" }),
        }),
      ]);

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
  },
): void {
  const timestamp = `${quote.day}T16:00:00Z`;
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
