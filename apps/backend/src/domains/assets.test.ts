import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { createEventBus } from "../events";
import { createAssetService, parseExchangeMetadataLookup, parseExchangeNameLookup } from "./assets";

describe("TS assets domain", () => {
  test("lists and reads assets with Rust-compatible response shape and exchange names", () => {
    const db = createAssetsDb();
    const service = createAssetService(db, {
      exchangeNameByMic: new Map([
        ["XNAS", "NASDAQ"],
        ["XTSE", "TSX"],
      ]),
    });

    try {
      insertAsset(db, {
        id: "asset-1",
        kind: "INVESTMENT",
        name: "Apple Inc.",
        display_code: "AAPL",
        notes: "core position",
        metadata: JSON.stringify({ sector: "technology" }),
        is_active: 1,
        quote_mode: "MARKET",
        quote_ccy: "USD",
        instrument_type: "EQUITY",
        instrument_symbol: "AAPL",
        instrument_exchange_mic: "XNAS",
        provider_config: JSON.stringify({ preferredProvider: "YAHOO" }),
        created_at: "2026-01-02 03:04:05",
        updated_at: "2026-01-02T03:04:05.123Z",
      });

      expect(service.listAssets()).toEqual([
        {
          id: "asset-1",
          kind: "INVESTMENT",
          name: "Apple Inc.",
          displayCode: "AAPL",
          notes: "core position",
          metadata: { sector: "technology" },
          isActive: true,
          quoteMode: "MARKET",
          quoteCcy: "USD",
          instrumentType: "EQUITY",
          instrumentSymbol: "AAPL",
          instrumentExchangeMic: "XNAS",
          instrumentKey: "EQUITY:AAPL@XNAS",
          providerConfig: { preferredProvider: "YAHOO" },
          exchangeName: "NASDAQ",
          createdAt: "2026-01-02T03:04:05Z",
          updatedAt: "2026-01-02T03:04:05.123Z",
        },
      ]);
      expect(service.getAssetProfile("asset-1")).toMatchObject({
        id: "asset-1",
        exchangeName: "NASDAQ",
      });
    } finally {
      db.close();
    }
  });

  test("updates quote mode, emits assets_updated, and clears manual sync state", () => {
    const db = createAssetsDb();
    const eventBus = createEventBus();
    const events: unknown[] = [];
    eventBus.subscribe((event) => events.push(event));
    const service = createAssetService(db, { eventBus });

    try {
      insertAsset(db, {
        id: "asset-1",
        kind: "INVESTMENT",
        quote_mode: "MARKET",
        quote_ccy: "USD",
      });
      db.query(
        "INSERT INTO quote_sync_state (asset_id, updated_at) VALUES ('asset-1', '2026-01-01T00:00:00Z')",
      ).run();

      expect(() => service.updateQuoteMode("asset-1", "manual")).toThrow(
        "Unsupported quote mode 'manual'",
      );

      const updated = service.updateQuoteMode("asset-1", "MANUAL");

      expect(updated.quoteMode).toBe("MANUAL");
      expect(readAsset(db, "asset-1").quote_mode).toBe("MANUAL");
      expect(
        db
          .query<
            { count: number },
            []
          >("SELECT COUNT(*) AS count FROM quote_sync_state WHERE asset_id = 'asset-1'")
          .get()?.count,
      ).toBe(0);
      expect(events).toEqual([
        {
          name: "assets_updated",
          payload: { type: "assets_updated", asset_ids: ["asset-1"] },
        },
      ]);
    } finally {
      db.close();
    }
  });

  test("maps invalid JSON metadata to null like the Rust model", () => {
    const db = createAssetsDb();
    const service = createAssetService(db);

    try {
      insertAsset(db, {
        id: "asset-1",
        kind: "INVESTMENT",
        metadata: "{bad",
        provider_config: "{bad",
        quote_mode: "MARKET",
        quote_ccy: "USD",
      });

      expect(service.getAssetProfile("asset-1")).toMatchObject({
        metadata: null,
        providerConfig: null,
      });
    } finally {
      db.close();
    }
  });

  test("deletes assets with quotes and sync state but rejects assets with activities", () => {
    const db = createAssetsDb();
    const service = createAssetService(db);

    try {
      insertAsset(db, {
        id: "deletable",
        kind: "INVESTMENT",
        quote_mode: "MARKET",
        quote_ccy: "USD",
      });
      insertAsset(db, {
        id: "in-use",
        kind: "INVESTMENT",
        quote_mode: "MARKET",
        quote_ccy: "USD",
      });
      db.exec(`
        INSERT INTO quotes (
          id, asset_id, day, source, close, currency, created_at, timestamp
        )
        VALUES (
          'quote-1', 'deletable', '2026-01-01', 'MANUAL', '100', 'USD',
          '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
        );
        INSERT INTO quote_sync_state (asset_id, updated_at)
        VALUES ('deletable', '2026-01-01T00:00:00Z');
        INSERT INTO activities (id, asset_id)
        VALUES ('activity-1', 'in-use');
      `);

      expect(() => service.deleteAsset("in-use")).toThrow(
        "Cannot delete asset: it has existing activities",
      );
      service.deleteAsset("deletable");

      expect(readAssetOrNull(db, "deletable")).toBeNull();
      expect(
        db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM quotes").get()?.count,
      ).toBe(0);
      expect(
        db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM quote_sync_state").get()
          ?.count,
      ).toBe(0);
      expect(readAssetOrNull(db, "in-use")).toMatchObject({ id: "in-use" });
    } finally {
      db.close();
    }
  });

  test("creates assets with Rust-compatible market identity canonicalization", () => {
    const db = createAssetsDb();
    const eventBus = createEventBus();
    const events: unknown[] = [];
    eventBus.subscribe((event) => events.push(event));
    const service = createAssetService(db, {
      eventBus,
      exchangeMetadata: testExchangeMetadata(),
    });

    try {
      const shop = service.createAsset({
        kind: "INVESTMENT",
        quoteMode: "MARKET",
        quoteCcy: "",
        instrumentType: "EQUITY",
        instrumentSymbol: "shop.to",
        name: "Shopify",
      });
      expect(shop).toMatchObject({
        kind: "INVESTMENT",
        displayCode: "SHOP",
        quoteCcy: "CAD",
        instrumentType: "EQUITY",
        instrumentSymbol: "SHOP",
        instrumentExchangeMic: "XTSE",
        instrumentKey: "EQUITY:SHOP@XTSE",
        exchangeName: "TSX",
      });

      const duplicate = service.createAsset({
        kind: "INVESTMENT",
        quoteMode: "MARKET",
        quoteCcy: "CAD",
        instrumentType: "EQUITY",
        instrumentSymbol: "SHOP",
        instrumentExchangeMic: "XTSE",
      });
      expect(duplicate.id).toBe(shop.id);

      expect(
        service.createAsset({
          kind: "INVESTMENT",
          quoteMode: "MARKET",
          quoteCcy: "USD",
          instrumentType: "CRYPTO",
          instrumentSymbol: "BTC-USD",
        }),
      ).toMatchObject({
        displayCode: "BTC",
        instrumentSymbol: "BTC",
        instrumentExchangeMic: null,
        instrumentKey: "CRYPTO:BTC/USD",
      });

      expect(
        service.createAsset({
          kind: "FX",
          quoteMode: "MARKET",
          quoteCcy: "USD",
          instrumentType: "FX",
          instrumentSymbol: "eurusd=x",
        }),
      ).toMatchObject({
        displayCode: "EUR/USD",
        instrumentSymbol: "EUR",
        quoteCcy: "USD",
        instrumentKey: "FX:EUR/USD",
      });

      expect(
        service.createAsset({
          kind: "INVESTMENT",
          quoteMode: "MARKET",
          quoteCcy: "USD",
          instrumentType: "BOND",
          instrumentSymbol: "912810TH1",
        }),
      ).toMatchObject({
        displayCode: "US912810TH14",
        instrumentSymbol: "US912810TH14",
        instrumentKey: "BOND:US912810TH14",
      });

      expect(
        service.createAsset({
          kind: "INVESTMENT",
          quoteMode: "MARKET",
          quoteCcy: "EUR",
          instrumentType: "EQUITY",
          instrumentSymbol: "DE000BASF111",
          instrumentExchangeMic: "xetr",
        }),
      ).toMatchObject({
        providerConfig: { preferred_provider: "BOERSE_FRANKFURT" },
        instrumentExchangeMic: "XETR",
      });

      expect(events).toHaveLength(5);
      expect(events[0]).toMatchObject({
        name: "assets_created",
        payload: { type: "assets_created", asset_ids: [shop.id] },
      });
      expect(() =>
        service.createAsset({ kind: "INVESTMENT", quoteMode: "MARKET", quoteCcy: "USD" }),
      ).toThrow("instrument_symbol");
    } finally {
      db.close();
    }
  });

  test("updates asset profiles while preserving omitted fields and resetting sync state", () => {
    const db = createAssetsDb();
    const eventBus = createEventBus();
    const events: unknown[] = [];
    eventBus.subscribe((event) => events.push(event));
    const service = createAssetService(db, {
      eventBus,
      exchangeMetadata: testExchangeMetadata(),
    });

    try {
      insertAsset(db, {
        id: "asset-1",
        kind: "INVESTMENT",
        name: "Apple Inc.",
        display_code: "AAPL",
        notes: "old",
        metadata: JSON.stringify({ identifiers: { isin: "US0378331005" } }),
        quote_mode: "MARKET",
        quote_ccy: "USD",
        instrument_type: "EQUITY",
        instrument_symbol: "AAPL",
        instrument_exchange_mic: "XNAS",
        provider_config: JSON.stringify({ preferred_provider: "YAHOO" }),
      });
      db.query(
        `
          INSERT INTO quote_sync_state (
            asset_id, data_source, error_count, last_error, updated_at
          )
          VALUES ('asset-1', 'YAHOO', 3, 'old failure', '2026-01-01T00:00:00Z')
        `,
      ).run();

      const notesOnly = service.updateAssetProfile("asset-1", { notes: "new notes" });
      expect(notesOnly).toMatchObject({
        name: "Apple Inc.",
        displayCode: "AAPL",
        notes: "new notes",
        quoteMode: "MARKET",
        quoteCcy: "USD",
        providerConfig: { preferred_provider: "YAHOO" },
      });
      expect(readSyncState(db, "asset-1")).toMatchObject({
        data_source: "YAHOO",
        error_count: 3,
        last_error: "old failure",
      });

      const moved = service.updateAssetProfile("asset-1", {
        instrumentExchangeMic: "xtse",
      });
      expect(moved).toMatchObject({
        instrumentSymbol: "AAPL",
        instrumentExchangeMic: "XTSE",
        quoteCcy: "CAD",
        instrumentKey: "EQUITY:AAPL@XTSE",
        exchangeName: "TSX",
      });
      expect(readSyncState(db, "asset-1")).toMatchObject({
        data_source: "",
        error_count: 0,
        last_error: null,
      });
      const clearedMic = service.updateAssetProfile("asset-1", {
        instrumentExchangeMic: "",
        quoteCcy: "usd",
      });
      expect(clearedMic).toMatchObject({
        instrumentExchangeMic: null,
        quoteCcy: "USD",
        instrumentKey: "EQUITY:AAPL",
      });
      expect(() =>
        service.updateAssetProfile("asset-1", {
          instrumentType: "BOND",
          instrumentSymbol: "US912810TH14",
          quoteCcy: "",
        }),
      ).toThrow("quote_ccy");
      expect(events).toEqual([
        {
          name: "assets_updated",
          payload: { type: "assets_updated", asset_ids: ["asset-1"] },
        },
        {
          name: "assets_updated",
          payload: { type: "assets_updated", asset_ids: ["asset-1"] },
        },
        {
          name: "assets_updated",
          payload: { type: "assets_updated", asset_ids: ["asset-1"] },
        },
      ]);
    } finally {
      db.close();
    }
  });

  test("parses exchange names from the Rust exchange metadata catalog", () => {
    const lookup = parseExchangeNameLookup(
      JSON.stringify({
        exchanges: [{ mic: "XNYS", name: "NYSE" }, { mic: "XNAS", name: "NASDAQ" }, { mic: "BAD" }],
      }),
    );

    expect(lookup.get("XNYS")).toBe("NYSE");
    expect(lookup.get("XNAS")).toBe("NASDAQ");
    expect(lookup.has("BAD")).toBe(false);
  });
});

function createAssetsDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE assets (
      id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL,
      name TEXT,
      display_code TEXT,
      notes TEXT,
      metadata TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      quote_mode TEXT NOT NULL,
      quote_ccy TEXT NOT NULL,
      instrument_type TEXT,
      instrument_symbol TEXT,
      instrument_exchange_mic TEXT,
      instrument_key TEXT GENERATED ALWAYS AS (
        CASE
          WHEN instrument_type IS NULL OR instrument_symbol IS NULL THEN NULL
          WHEN instrument_type IN ('FX', 'CRYPTO')
            THEN instrument_type || ':' || instrument_symbol || '/' || quote_ccy
          WHEN instrument_exchange_mic IS NOT NULL
            THEN instrument_type || ':' || instrument_symbol || '@' || instrument_exchange_mic
          ELSE instrument_type || ':' || instrument_symbol
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
      timestamp TEXT NOT NULL,
      CONSTRAINT quotes_asset_fkey FOREIGN KEY (asset_id)
        REFERENCES assets (id) ON DELETE CASCADE ON UPDATE CASCADE
    );

    CREATE TABLE quote_sync_state (
      asset_id TEXT PRIMARY KEY NOT NULL,
      data_source TEXT NOT NULL DEFAULT 'YAHOO',
      error_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE activities (
      id TEXT PRIMARY KEY NOT NULL,
      asset_id TEXT,
      CONSTRAINT activities_asset_fkey FOREIGN KEY (asset_id)
        REFERENCES assets (id) ON DELETE SET NULL ON UPDATE CASCADE
    );
  `);
  return db;
}

function insertAsset(
  db: Database,
  asset: {
    id: string;
    kind: string;
    name?: string | null;
    display_code?: string | null;
    notes?: string | null;
    metadata?: string | null;
    is_active?: number;
    quote_mode: string;
    quote_ccy: string;
    instrument_type?: string | null;
    instrument_symbol?: string | null;
    instrument_exchange_mic?: string | null;
    provider_config?: string | null;
    created_at?: string;
    updated_at?: string;
  },
): void {
  db.query(
    `
      INSERT INTO assets (
        id, kind, name, display_code, notes, metadata, is_active, quote_mode,
        quote_ccy, instrument_type, instrument_symbol, instrument_exchange_mic,
        provider_config, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    asset.id,
    asset.kind,
    asset.name ?? null,
    asset.display_code ?? null,
    asset.notes ?? null,
    asset.metadata ?? null,
    asset.is_active ?? 1,
    asset.quote_mode,
    asset.quote_ccy,
    asset.instrument_type ?? null,
    asset.instrument_symbol ?? null,
    asset.instrument_exchange_mic ?? null,
    asset.provider_config ?? null,
    asset.created_at ?? "2026-01-01T00:00:00Z",
    asset.updated_at ?? "2026-01-01T00:00:00Z",
  );
}

function readAsset(db: Database, assetId: string): Record<string, unknown> {
  const asset = readAssetOrNull(db, assetId);
  if (!asset) {
    throw new Error(`missing asset ${assetId}`);
  }
  return asset;
}

function readAssetOrNull(db: Database, assetId: string): Record<string, unknown> | null {
  return db
    .query<Record<string, unknown>, [string]>("SELECT * FROM assets WHERE id = ?")
    .get(assetId);
}

function readSyncState(db: Database, assetId: string): Record<string, unknown> | null {
  return db
    .query<Record<string, unknown>, [string]>("SELECT * FROM quote_sync_state WHERE asset_id = ?")
    .get(assetId);
}

function testExchangeMetadata() {
  return parseExchangeMetadataLookup(
    JSON.stringify({
      exchanges: [
        {
          mic: "XNAS",
          name: "NASDAQ",
          currency: "USD",
          yahoo: { suffix: "" },
        },
        {
          mic: "XTSE",
          name: "TSX",
          currency: "CAD",
          yahoo: { suffix: "TO" },
        },
        {
          mic: "XETR",
          name: "XETRA",
          currency: "EUR",
          yahoo: { suffix: "DE" },
        },
        {
          mic: "XFRA",
          name: "Frankfurt",
          currency: "EUR",
          yahoo: { suffix: "F" },
        },
        {
          mic: "CXE",
          name: "Cboe UK",
          currency: "GBp",
          yahoo: { suffix: "XC" },
        },
      ],
    }),
  );
}
