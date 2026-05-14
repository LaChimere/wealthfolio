import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { createMarketDataService } from "./market-data";

describe("TS market data domain", () => {
  test("lists exchanges and reads quote history with Rust-compatible mapping", () => {
    const db = createMarketDataDb();
    const service = createMarketDataService(db, { exchangeCatalogJson: testExchangeCatalogJson() });

    try {
      expect(service.getExchanges?.()).toEqual([
        {
          mic: "XNAS",
          name: "NASDAQ",
          longName: "NASDAQ Stock Market",
          currency: "USD",
        },
        {
          mic: "XTSE",
          name: "TSX",
          longName: "TSX",
          currency: "CAD",
        },
      ]);

      insertQuote(db, {
        id: "asset-1_2026-01-01_YAHOO",
        asset_id: "asset-1",
        day: "2026-01-01",
        source: "YAHOO",
        open: null,
        high: "11.50",
        low: null,
        close: "10.25",
        adjclose: null,
        volume: null,
        currency: "USD",
        notes: null,
        created_at: "2026-01-01 10:00:00",
        timestamp: "2026-01-01T16:00:00Z",
      });
      insertQuote(db, {
        id: "asset-1_2026-01-02_MANUAL",
        asset_id: "asset-1",
        day: "2026-01-02",
        source: "MANUAL",
        close: "12.00",
        currency: "USD",
      });

      expect(service.getQuoteHistory?.("asset-1")).toEqual([
        expect.objectContaining({
          id: "asset-1_2026-01-02_MANUAL",
          assetId: "asset-1",
          dataSource: "MANUAL",
          close: 12,
        }),
        {
          id: "asset-1_2026-01-01_YAHOO",
          assetId: "asset-1",
          createdAt: "2026-01-01T10:00:00.000Z",
          timestamp: "2026-01-01T16:00:00.000Z",
          dataSource: "YAHOO",
          open: 0,
          high: 11.5,
          low: 0,
          close: 10.25,
          adjclose: 0,
          volume: 0,
          currency: "USD",
          notes: null,
        },
      ]);
    } finally {
      db.close();
    }
  });

  test("updates and deletes manual quotes with deterministic Rust-compatible IDs", () => {
    const db = createMarketDataDb();
    const service = createMarketDataService(db);

    try {
      insertQuote(db, {
        id: "provider-id",
        asset_id: "EQUITY:AAPL@XNAS",
        day: "2026-01-02",
        source: "YAHOO",
        close: "10.00",
        currency: "USD",
      });

      service.updateQuote?.("EQUITY:AAPL@XNAS", {
        id: "provider-id",
        timestamp: "2026-01-02T15:30:00Z",
        dataSource: "MANUAL",
        open: 0,
        high: 12,
        low: 0,
        close: 10.25,
        adjclose: 0,
        volume: 0,
        currency: "GBp",
        notes: "manual close",
      });

      expect(readQuote(db, "provider-id")).toBeNull();
      expect(readQuote(db, "EQUITY:AAPL@XNAS_2026-01-02_MANUAL")).toMatchObject({
        id: "EQUITY:AAPL@XNAS_2026-01-02_MANUAL",
        asset_id: "EQUITY:AAPL@XNAS",
        day: "2026-01-02",
        source: "MANUAL",
        open: null,
        high: "12",
        low: null,
        close: "10.25",
        adjclose: null,
        volume: null,
        currency: "GBp",
        notes: "manual close",
      });

      insertQuote(db, {
        id: "legacy-manual-id",
        asset_id: "EQUITY:AAPL@XNAS",
        day: "2026-01-03",
        source: "MANUAL",
        close: "11.00",
        currency: "USD",
      });
      service.updateQuote?.("EQUITY:AAPL@XNAS", {
        id: "wrong-id",
        timestamp: "2026-01-03T15:30:00Z",
        dataSource: "MANUAL",
        close: "11.50",
        currency: "USD",
      });

      expect(readQuote(db, "legacy-manual-id")).toMatchObject({
        id: "legacy-manual-id",
        close: "11.50",
      });
      expect(readQuote(db, "EQUITY:AAPL@XNAS_2026-01-03_MANUAL")).toBeNull();

      service.deleteQuote?.("EQUITY:AAPL@XNAS_2026-01-02_MANUAL");
      expect(readQuote(db, "EQUITY:AAPL@XNAS_2026-01-02_MANUAL")).toBeNull();
    } finally {
      db.close();
    }
  });

  test("rejects invalid quote updates before writing", () => {
    const db = createMarketDataDb();
    const service = createMarketDataService(db);

    try {
      expect(() =>
        service.updateQuote?.("asset-1", {
          timestamp: "not-a-date",
          dataSource: "MANUAL",
          close: 10,
          currency: "USD",
        }),
      ).toThrow("Invalid timestamp");
      expect(() =>
        service.updateQuote?.("asset-1", {
          timestamp: "2026-01-01T00:00:00Z",
          dataSource: "MANUAL",
          close: Number.NaN,
          currency: "USD",
        }),
      ).toThrow("close");
      expect(
        db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM quotes").get()?.count,
      ).toBe(0);
    } finally {
      db.close();
    }
  });
});

function createMarketDataDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
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
    CREATE UNIQUE INDEX uq_quotes_asset_day_source ON quotes(asset_id, day, source);
  `);
  return db;
}

function insertQuote(
  db: Database,
  quote: {
    id: string;
    asset_id: string;
    day: string;
    source: string;
    open?: string | null;
    high?: string | null;
    low?: string | null;
    close: string;
    adjclose?: string | null;
    volume?: string | null;
    currency: string;
    notes?: string | null;
    created_at?: string;
    timestamp?: string;
  },
) {
  db.query(
    `
      INSERT INTO quotes (
        id, asset_id, day, source, open, high, low, close, adjclose, volume,
        currency, notes, created_at, timestamp
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    quote.id,
    quote.asset_id,
    quote.day,
    quote.source,
    quote.open ?? null,
    quote.high ?? null,
    quote.low ?? null,
    quote.close,
    quote.adjclose ?? null,
    quote.volume ?? null,
    quote.currency,
    quote.notes ?? null,
    quote.created_at ?? `${quote.day}T00:00:00Z`,
    quote.timestamp ?? `${quote.day}T16:00:00Z`,
  );
}

function readQuote(db: Database, id: string): Record<string, unknown> | null {
  return db.query<Record<string, unknown>, [string]>("SELECT * FROM quotes WHERE id = ?").get(id);
}

function testExchangeCatalogJson(): string {
  return JSON.stringify({
    exchanges: [
      {
        mic: "XNAS",
        name: "NASDAQ",
        long_name: "NASDAQ Stock Market",
        currency: "USD",
      },
      {
        mic: "XTSE",
        name: "TSX",
        currency: "CAD",
      },
      {
        mic: "NOCCY",
        name: "No Currency",
      },
    ],
  });
}
