import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEventBus } from "../events";
import {
  createAssetService,
  parseExchangeMetadataLookup,
  parseExchangeNameLookup,
  type AssetSyncEvent,
} from "./assets";
import type { NewAssetTaxonomyAssignment } from "./taxonomies";

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
        updated_at: "2026-01-02T05:34:05.123456+02:30",
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
          createdAt: "2026-01-02T03:04:05",
          updatedAt: "2026-01-02T03:04:05.123456",
        },
      ]);
      expect(service.getAssetProfile("asset-1")).toMatchObject({
        id: "asset-1",
        exchangeName: "NASDAQ",
      });
      insertAsset(db, {
        id: "asset-date-only",
        kind: "INVESTMENT",
        quote_mode: "MANUAL",
        quote_ccy: "USD",
        created_at: "2026-01-03",
        updated_at: "2026-01-03",
      });
      expect(service.getAssetProfile("asset-date-only")).toMatchObject({
        createdAt: "2026-01-03T00:00:00",
        updatedAt: "2026-01-03T00:00:00",
      });
      insertAsset(db, {
        id: "asset-chrono-rfc3339",
        kind: "INVESTMENT",
        quote_mode: "MANUAL",
        quote_ccy: "USD",
        created_at: "2026-01-02 05:34:05.123456+02:30",
        updated_at: "2026-01-02t03:04:05z",
      });
      expect(service.getAssetProfile("asset-chrono-rfc3339")).toMatchObject({
        createdAt: "2026-01-02T03:04:05.123456",
        updatedAt: "2026-01-02T03:04:05",
      });
      insertAsset(db, {
        id: "asset-expanded-year",
        kind: "INVESTMENT",
        quote_mode: "MANUAL",
        quote_ccy: "USD",
        created_at: "9999-12-31T23:59:59-05:00",
        updated_at: "0000-01-01T00:00:00+05:00",
      });
      expect(service.getAssetProfile("asset-expanded-year")).toMatchObject({
        createdAt: "+10000-01-01T04:59:59",
        updatedAt: "-0001-12-31T19:00:00",
      });
      insertAsset(db, {
        id: "asset-leap-second",
        kind: "INVESTMENT",
        quote_mode: "MANUAL",
        quote_ccy: "USD",
        created_at: "2015-06-30T23:59:60Z",
        updated_at: "2015-07-01T00:59:60+01:00",
      });
      insertAsset(db, {
        id: "asset-bare-leap-second",
        kind: "INVESTMENT",
        quote_mode: "MANUAL",
        quote_ccy: "USD",
        created_at: "2015-06-30 23:59:60",
        updated_at: "2015-06-30T23:59:60",
      });
      expect(service.getAssetProfile("asset-leap-second")).toMatchObject({
        createdAt: "2015-06-30T23:59:60",
        updatedAt: "2015-06-30T23:59:60",
      });
      expect(service.getAssetProfile("asset-bare-leap-second")).toMatchObject({
        createdAt: "2015-06-30T23:59:60",
        updatedAt: "2015-06-30T23:59:60",
      });
      insertAsset(db, {
        id: "asset-invalid-time",
        kind: "INVESTMENT",
        quote_mode: "MANUAL",
        quote_ccy: "USD",
        created_at: "not-a-date",
        updated_at: "2026-02-30T00:00:00Z",
      });
      expect(service.getAssetProfile("asset-invalid-time").createdAt).not.toEndWith("Z");
      expect(service.getAssetProfile("asset-invalid-time").updatedAt).not.toBe(
        "2026-03-02T00:00:00",
      );
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
        updated_at: "2026-01-01T00:00:00Z",
      });
      db.query(
        "INSERT INTO quote_sync_state (asset_id, updated_at) VALUES ('asset-1', '2026-01-01T00:00:00Z')",
      ).run();

      expect(() => service.updateQuoteMode("asset-1", "manual")).toThrow(
        "Unsupported quote mode 'manual'",
      );

      const updated = service.updateQuoteMode("asset-1", "MANUAL");

      expect(updated.quoteMode).toBe("MANUAL");
      expect(readAsset(db, "asset-1")).toMatchObject({
        quote_mode: "MANUAL",
        updated_at: "2026-01-01T00:00:00Z",
      });
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

  test("queues Rust-compatible asset sync callbacks after successful writes", () => {
    const db = createAssetsDb();
    const syncEvents: AssetSyncEvent[] = [];
    const service = createAssetService(db, {
      exchangeMetadata: testExchangeMetadata(),
      queueSyncEvent: (event) => syncEvents.push(event),
    });

    try {
      const created = service.createAsset({
        kind: "INVESTMENT",
        quoteMode: "MARKET",
        quoteCcy: "usd",
        name: "Apple",
        notes: "core",
        metadata: { sector: "technology" },
        instrumentType: "equity",
        instrumentSymbol: "aapl",
        instrumentExchangeMic: "xnas",
        providerConfig: { preferred_provider: "YAHOO" },
      });
      service.createAsset({
        kind: "INVESTMENT",
        quoteMode: "MARKET",
        quoteCcy: "USD",
        instrumentType: "EQUITY",
        instrumentSymbol: "AAPL",
        instrumentExchangeMic: "XNAS",
      });
      service.updateAssetProfile(created.id, { notes: "updated", instrumentExchangeMic: "xtse" });
      service.updateQuoteMode(created.id, "MANUAL");
      service.deleteAsset(created.id);
      expect(() => service.deleteAsset("missing")).toThrow("Record not found");

      expect(syncEvents.map((event) => event.operation)).toEqual([
        "Create",
        "Update",
        "Update",
        "Delete",
      ]);
      expect(syncEvents.map((event) => event.assetId)).toEqual([
        created.id,
        created.id,
        created.id,
        created.id,
      ]);
      expect(syncEvents[0].payload).toMatchObject({
        id: created.id,
        kind: "INVESTMENT",
        name: "Apple",
        displayCode: "AAPL",
        notes: "core",
        metadata: JSON.stringify({ sector: "technology" }),
        isActive: 1,
        quoteMode: "MARKET",
        quoteCcy: "USD",
        instrumentType: "EQUITY",
        instrumentSymbol: "AAPL",
        instrumentExchangeMic: "XNAS",
        providerConfig: JSON.stringify({ preferred_provider: "YAHOO" }),
        createdAt: expect.stringMatching(/\+00:00$/),
        updatedAt: expect.stringMatching(/\+00:00$/),
      });
      expect(created.createdAt).not.toEndWith("Z");
      expect(created.updatedAt).not.toEndWith("Z");
      const createPayload = syncEvents[0].payload as { createdAt: string; updatedAt: string };
      expect(createPayload.createdAt).not.toEndWith("Z");
      expect(createPayload.updatedAt).not.toEndWith("Z");
      const profileUpdatedAt = (syncEvents[1].payload as { updatedAt: string }).updatedAt;
      expect(syncEvents[1].payload).toMatchObject({
        notes: "updated",
        quoteCcy: "CAD",
        instrumentExchangeMic: "XTSE",
        updatedAt: expect.stringMatching(/\+00:00$/),
      });
      expect(syncEvents[2].payload).toMatchObject({ quoteMode: "MANUAL" });
      expect((syncEvents[2].payload as { updatedAt: string }).updatedAt).toBe(profileUpdatedAt);
      expect(syncEvents[3].payload).toEqual({ id: created.id });
      expect("instrumentKey" in syncEvents[0].payload).toBe(false);
      expect("instrumentKey" in syncEvents[1].payload).toBe(false);
      expect("instrumentKey" in syncEvents[2].payload).toBe(false);
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

  test("auto-classifies newly created assets like Rust", async () => {
    const db = createAssetsDb();
    const assignments: NewAssetTaxonomyAssignment[] = [];
    const warnings: string[] = [];
    const service = createAssetService(db, {
      taxonomyService: {
        async assignAssetToCategory(assignment) {
          assignments.push(assignment);
        },
      },
      warn: (message) => warnings.push(message),
    });

    try {
      const equity = await service.createAsset({
        kind: "INVESTMENT",
        quoteMode: "MARKET",
        quoteCcy: "USD",
        instrumentType: "EQUITY",
        instrumentSymbol: "AAPL",
      });
      const property = await service.createAsset({
        kind: "PROPERTY",
        quoteMode: "MANUAL",
        quoteCcy: "USD",
        name: "Rental",
      });
      await service.createAsset({
        kind: "INVESTMENT",
        quoteMode: "MARKET",
        quoteCcy: "USD",
        instrumentType: "EQUITY",
        instrumentSymbol: "AAPL",
      });

      expect(assignments).toEqual([
        {
          assetId: equity.id,
          taxonomyId: "instrument_type",
          categoryId: "STOCK_COMMON",
          weight: 10000,
          source: "AUTO",
        },
        {
          assetId: equity.id,
          taxonomyId: "asset_classes",
          categoryId: "EQUITY",
          weight: 10000,
          source: "AUTO",
        },
        {
          assetId: property.id,
          taxonomyId: "asset_classes",
          categoryId: "REAL_ESTATE",
          weight: 10000,
          source: "AUTO",
        },
      ]);
      expect(warnings).toEqual([]);
    } finally {
      db.close();
    }
  });

  test("keeps asset creation successful when auto-classification fails", async () => {
    const db = createAssetsDb();
    const warnings: string[] = [];
    const service = createAssetService(db, {
      taxonomyService: {
        async assignAssetToCategory(assignment) {
          if (assignment.taxonomyId === "instrument_type") {
            throw new Error("taxonomy missing");
          }
        },
      },
      warn: (message) => warnings.push(message),
    });

    try {
      const created = await service.createAsset({
        kind: "INVESTMENT",
        quoteMode: "MARKET",
        quoteCcy: "USD",
        instrumentType: "EQUITY",
        instrumentSymbol: "MSFT",
      });

      expect(created).toMatchObject({
        instrumentSymbol: "MSFT",
        instrumentType: "EQUITY",
      });
      expect(warnings).toEqual([
        `Initial classification of asset ${created.id} instrument_type failed: taxonomy missing`,
      ]);
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
        updated_at: expect.stringMatching(/\+00:00$/),
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

  test("enriches explicit OpenFIGI bond profiles without metadata churn", async () => {
    const db = createAssetsDb();
    const requests: Array<{ url: string; body: unknown }> = [];
    const service = createAssetService(db, {
      now: () => "2026-05-22T00:00:00.000Z",
      fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
        requests.push({ url, body });
        if (url === "https://api.openfigi.com/v3/mapping") {
          return Promise.resolve(
            Response.json([
              {
                data: [
                  {
                    name: "ACME CORP BOND",
                    ticker: "ACME 4 02/15/44",
                  },
                ],
              },
            ]),
          );
        }
        return Promise.reject(new Error(`unexpected fetch: ${url}`));
      }) as typeof fetch,
    });

    try {
      insertAsset(db, {
        id: "bond-openfigi",
        kind: "INVESTMENT",
        name: "Old Bond",
        quote_mode: "MARKET",
        quote_ccy: "USD",
        instrument_type: "BOND",
        instrument_symbol: "XS1234567890",
        provider_config: JSON.stringify({
          preferred_provider: "OPENFIGI",
          overrides: { OPENFIGI: { symbol: "XS0987654321" } },
        }),
      });
      db.query(
        `
          INSERT INTO quote_sync_state (
            asset_id, profile_enriched_at, updated_at
          )
          VALUES ('bond-openfigi', NULL, '2026-01-01T00:00:00Z')
        `,
      ).run();

      const result = await service.enrichAssets(["bond-openfigi"]);

      expect(result).toEqual({ enriched: 1, skipped: 0, failed: 0 });
      expect(requests).toEqual([
        {
          url: "https://api.openfigi.com/v3/mapping",
          body: [{ idType: "ID_ISIN", idValue: "XS0987654321" }],
        },
      ]);
      expect(service.getAssetProfile("bond-openfigi")).toMatchObject({
        name: "ACME CORP BOND - ACME 4 02/15/44",
        metadata: null,
        quoteCcy: "USD",
        instrumentType: "BOND",
      });
      expect(readSyncState(db, "bond-openfigi")).toMatchObject({
        profile_enriched_at: "2026-05-22T00:00:00.000Z",
      });
    } finally {
      db.close();
    }
  });

  test("enriches explicit Boerse Frankfurt equity profiles", async () => {
    const db = createAssetsDb();
    const requests: Array<{ url: string; userAgent: string | null }> = [];
    const service = createAssetService(db, {
      now: () => "2026-05-22T00:00:00.000Z",
      fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const headers = new Headers(init?.headers);
        requests.push({ url, userAgent: headers.get("User-Agent") });
        if (
          url === "https://api.live.deutsche-boerse.com/v1/tradingview/search?query=BAS&limit=5"
        ) {
          return Promise.resolve(
            Response.json([
              {
                symbol: "XETR:DE000BASF111",
                description: "BASF SE",
                exchange: "XETR",
                type: "Aktie",
              },
            ]),
          );
        }
        if (
          url ===
          "https://api.live.deutsche-boerse.com/v1/tradingview/symbols?symbol=XETR%3ADE000BASF111"
        ) {
          return Promise.resolve(
            Response.json({
              name: "BAS",
              exchange: "XETR",
              description: "BASF SE",
              currency_code: "EUR",
            }),
          );
        }
        return Promise.reject(new Error(`unexpected fetch: ${url}`));
      }) as typeof fetch,
    });

    try {
      insertAsset(db, {
        id: "equity-boerse",
        kind: "INVESTMENT",
        name: "Old BASF",
        quote_mode: "MARKET",
        quote_ccy: "EUR",
        instrument_type: "EQUITY",
        instrument_symbol: "BAS",
        instrument_exchange_mic: "XETR",
        provider_config: JSON.stringify({ preferred_provider: "BOERSE_FRANKFURT" }),
      });
      db.query(
        `
          INSERT INTO quote_sync_state (
            asset_id, profile_enriched_at, updated_at
          )
          VALUES ('equity-boerse', NULL, '2026-01-01T00:00:00Z')
        `,
      ).run();

      const result = await service.enrichAssets(["equity-boerse"]);

      expect(result).toEqual({ enriched: 1, skipped: 0, failed: 0 });
      expect(requests.map((request) => request.url)).toEqual([
        "https://api.live.deutsche-boerse.com/v1/tradingview/search?query=BAS&limit=5",
        "https://api.live.deutsche-boerse.com/v1/tradingview/symbols?symbol=XETR%3ADE000BASF111",
      ]);
      expect(requests.every((request) => request.userAgent?.includes("Chrome/"))).toBe(true);
      expect(service.getAssetProfile("equity-boerse")).toMatchObject({
        name: "BASF SE",
        metadata: null,
        quoteCcy: "EUR",
        instrumentType: "EQUITY",
      });
      expect(readSyncState(db, "equity-boerse")).toMatchObject({
        profile_enriched_at: "2026-05-22T00:00:00.000Z",
      });
    } finally {
      db.close();
    }
  });

  test("reports Boerse Frankfurt search HTTP failures like Rust", async () => {
    const db = createAssetsDb();
    const warnings: string[] = [];
    const service = createAssetService(db, {
      now: () => "2026-05-22T00:00:00.000Z",
      warn: (message) => warnings.push(message),
      fetch: ((input: RequestInfo | URL) => {
        const url = String(input);
        expect(url).toBe(
          "https://api.live.deutsche-boerse.com/v1/tradingview/search?query=BAS&limit=5",
        );
        return Promise.resolve(
          new Response("", {
            status: 509,
            statusText: "Bandwidth Limit Exceeded",
          }),
        );
      }) as typeof fetch,
    });

    try {
      insertAsset(db, {
        id: "equity-boerse-error",
        kind: "INVESTMENT",
        quote_mode: "MARKET",
        quote_ccy: "EUR",
        instrument_type: "EQUITY",
        instrument_symbol: "BAS",
        instrument_exchange_mic: "XETR",
        provider_config: JSON.stringify({ preferred_provider: "BOERSE_FRANKFURT" }),
      });

      await expect(service.enrichAssets(["equity-boerse-error"])).resolves.toEqual({
        enriched: 0,
        skipped: 0,
        failed: 1,
      });
      expect(warnings).toEqual([
        "Failed to enrich asset equity-boerse-error: BOERSE_FRANKFURT: Search returned HTTP 509 <unknown status code>",
      ]);
    } finally {
      db.close();
    }
  });

  test("enriches explicit Boerse Frankfurt bond profiles from metadata ISINs", async () => {
    const db = createAssetsDb();
    const fetched: string[] = [];
    const service = createAssetService(db, {
      now: () => "2026-05-22T00:00:00.000Z",
      fetch: ((input: RequestInfo | URL) => {
        const url = String(input);
        fetched.push(url);
        if (
          url ===
          "https://api.live.deutsche-boerse.com/v1/tradingview/symbols?symbol=XFRA%3ADE0001102341"
        ) {
          return Promise.resolve(
            Response.json({
              name: "DE0001102341",
              exchange: "XFRA",
              description: "Bundesrepublik Deutschland 4.75%",
              currency_code: "EUR",
            }),
          );
        }
        return Promise.reject(new Error(`unexpected fetch: ${url}`));
      }) as typeof fetch,
    });

    try {
      insertAsset(db, {
        id: "bond-boerse",
        kind: "INVESTMENT",
        name: "Old Bund",
        metadata: JSON.stringify({ identifiers: { isin: "DE0001102341" } }),
        quote_mode: "MARKET",
        quote_ccy: "EUR",
        instrument_type: "BOND",
        provider_config: JSON.stringify({ preferred_provider: "BOERSE_FRANKFURT" }),
      });
      db.query(
        `
          INSERT INTO quote_sync_state (
            asset_id, profile_enriched_at, updated_at
          )
          VALUES ('bond-boerse', NULL, '2026-01-01T00:00:00Z')
        `,
      ).run();

      const result = await service.enrichAssets(["bond-boerse"]);

      expect(result).toEqual({ enriched: 1, skipped: 0, failed: 0 });
      expect(fetched).toEqual([
        "https://api.live.deutsche-boerse.com/v1/tradingview/symbols?symbol=XFRA%3ADE0001102341",
      ]);
      expect(service.getAssetProfile("bond-boerse")).toMatchObject({
        name: "Bundesrepublik Deutschland 4.75%",
        metadata: { identifiers: { isin: "DE0001102341" } },
        quoteCcy: "EUR",
        instrumentType: "BOND",
      });
      expect(readSyncState(db, "bond-boerse")).toMatchObject({
        profile_enriched_at: "2026-05-22T00:00:00.000Z",
      });
    } finally {
      db.close();
    }
  });

  test("enriches explicit Finnhub equity profiles with secret API keys", async () => {
    const db = createAssetsDb();
    const secretKeys: string[] = [];
    const requests: Array<{ url: string; token: string | null }> = [];
    const service = createAssetService(db, {
      now: () => "2026-05-22T00:00:00.000Z",
      secretService: {
        setSecret() {},
        getSecret(secretKey) {
          secretKeys.push(secretKey);
          return secretKey === "FINNHUB" ? "finnhub-key" : null;
        },
        deleteSecret() {},
      },
      fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const headers = new Headers(init?.headers);
        requests.push({ url, token: headers.get("X-Finnhub-Token") });
        if (url === "https://finnhub.io/api/v1/stock/profile2?symbol=AAPL.US") {
          return Promise.resolve(
            Response.json({
              name: "Apple Inc",
              ticker: "AAPL",
              description: "Designs consumer devices.",
              finnhubIndustry: "Technology",
              country: "US",
              weburl: "https://www.apple.com",
              marketCapitalization: 2800000,
            }),
          );
        }
        if (url === "https://finnhub.io/api/v1/stock/profile2?symbol=EMPTY.US") {
          return Promise.resolve(Response.json({}));
        }
        return Promise.reject(new Error(`unexpected fetch: ${url}`));
      }) as typeof fetch,
    });

    try {
      insertAsset(db, {
        id: "equity-finnhub",
        kind: "INVESTMENT",
        name: "Old Apple",
        quote_mode: "MARKET",
        quote_ccy: "USD",
        instrument_type: "EQUITY",
        instrument_symbol: "AAPL",
        provider_config: JSON.stringify({
          preferred_provider: "FINNHUB",
          overrides: { FINNHUB: { symbol: "AAPL.US" } },
        }),
      });
      db.query(
        `
          INSERT INTO quote_sync_state (
            asset_id, profile_enriched_at, updated_at
          )
          VALUES ('equity-finnhub', NULL, '2026-01-01T00:00:00Z')
        `,
      ).run();

      const result = await service.enrichAssets(["equity-finnhub"]);

      expect(result).toEqual({ enriched: 1, skipped: 0, failed: 0 });
      insertAsset(db, {
        id: "equity-finnhub-empty",
        kind: "INVESTMENT",
        name: "Empty profile",
        quote_mode: "MARKET",
        quote_ccy: "USD",
        instrument_type: "EQUITY",
        instrument_symbol: "EMPTY",
        provider_config: JSON.stringify({
          preferred_provider: "FINNHUB",
          overrides: { FINNHUB: { symbol: "EMPTY.US" } },
        }),
      });
      db.query(
        `
          INSERT INTO quote_sync_state (
            asset_id, profile_enriched_at, updated_at
          )
          VALUES ('equity-finnhub-empty', NULL, '2026-01-01T00:00:00Z')
        `,
      ).run();

      const emptyResult = await service.enrichAssets(["equity-finnhub-empty"]);

      expect(emptyResult).toEqual({ enriched: 0, skipped: 1, failed: 0 });
      expect(readSyncState(db, "equity-finnhub-empty")).toMatchObject({
        profile_enriched_at: null,
      });
      expect(secretKeys).toEqual(["FINNHUB", "FINNHUB"]);
      expect(requests).toEqual([
        {
          url: "https://finnhub.io/api/v1/stock/profile2?symbol=AAPL.US",
          token: "finnhub-key",
        },
        {
          url: "https://finnhub.io/api/v1/stock/profile2?symbol=EMPTY.US",
          token: "finnhub-key",
        },
      ]);
      expect(service.getAssetProfile("equity-finnhub")).toMatchObject({
        name: "Apple Inc",
        notes: "Designs consumer devices.",
        metadata: {
          profile: {
            quoteType: "EQUITY",
            sectors: JSON.stringify([{ name: "Technology", weight: 1 }]),
            industry: "Technology",
            countries: JSON.stringify([{ name: "US", weight: 1 }]),
            website: "https://www.apple.com",
            marketCap: 2_800_000_000_000,
          },
        },
        instrumentType: "EQUITY",
      });
      expect(readSyncState(db, "equity-finnhub")).toMatchObject({
        profile_enriched_at: "2026-05-22T00:00:00.000Z",
      });
    } finally {
      db.close();
    }
  });

  test("reports Finnhub JSON error responses like Rust", async () => {
    const db = createAssetsDb();
    const warnings: string[] = [];
    const service = createAssetService(db, {
      now: () => "2026-05-22T00:00:00.000Z",
      warn: (message) => warnings.push(message),
      secretService: {
        setSecret() {},
        getSecret(secretKey) {
          return secretKey === "FINNHUB" ? "finnhub-key" : null;
        },
        deleteSecret() {},
      },
      fetch: ((input: RequestInfo | URL) => {
        expect(String(input)).toBe("https://finnhub.io/api/v1/stock/profile2?symbol=AAPL");
        return Promise.resolve(
          Response.json(
            { error: "Invalid Finnhub symbol" },
            {
              status: 500,
              statusText: "Internal Server Error",
            },
          ),
        );
      }) as typeof fetch,
    });

    try {
      insertAsset(db, {
        id: "equity-finnhub-error",
        kind: "INVESTMENT",
        quote_mode: "MARKET",
        quote_ccy: "USD",
        instrument_type: "EQUITY",
        instrument_symbol: "AAPL",
        provider_config: JSON.stringify({ preferred_provider: "FINNHUB" }),
      });

      await expect(service.enrichAssets(["equity-finnhub-error"])).resolves.toEqual({
        enriched: 0,
        skipped: 0,
        failed: 1,
      });
      expect(warnings).toEqual([
        "Failed to enrich asset equity-finnhub-error: FINNHUB: Invalid Finnhub symbol",
      ]);
    } finally {
      db.close();
    }
  });

  test("enriches explicit Alpha Vantage equity profiles with secret API keys", async () => {
    const db = createAssetsDb();
    const secretKeys: string[] = [];
    const requests: Array<{
      functionName: string | null;
      symbol: string | null;
      apiKey: string | null;
    }> = [];
    const service = createAssetService(db, {
      exchangeMetadata: testExchangeMetadata(),
      now: () => "2026-05-22T00:00:00.000Z",
      secretService: {
        setSecret() {},
        getSecret(secretKey) {
          secretKeys.push(secretKey);
          return secretKey === "ALPHA_VANTAGE" ? "alpha-key" : null;
        },
        deleteSecret() {},
      },
      fetch: ((input: RequestInfo | URL) => {
        const url = new URL(String(input));
        requests.push({
          functionName: url.searchParams.get("function"),
          symbol: url.searchParams.get("symbol"),
          apiKey: url.searchParams.get("apikey"),
        });
        const functionName = url.searchParams.get("function");
        const symbol = url.searchParams.get("symbol");
        if (functionName === "OVERVIEW" && symbol === "AAPL.US") {
          return Promise.resolve(
            Response.json({
              Symbol: "AAPL.US",
              AssetType: "Common Stock",
              Name: "Apple Inc",
              Description: "Designs consumer devices.",
              Country: "US",
              Sector: "Technology",
              Industry: "Consumer Electronics",
              MarketCapitalization: "2800000000000",
              PERatio: "29.5",
              TrailingPE: "30.5",
              DividendYield: "0.005",
              "52WeekHigh": "200.00",
              "52WeekLow": "150.00",
            }),
          );
        }
        if (functionName === "OVERVIEW" && symbol === "VTI") {
          return Promise.resolve(
            Response.json({
              Symbol: "VTI",
              AssetType: "ETF",
              Name: "Vanguard Total Stock Market ETF",
              Description: "Tracks the US equity market.",
              Country: "US",
              Sector: "Financial Services",
              DividendYield: "0",
            }),
          );
        }
        if (functionName === "ETF_PROFILE" && symbol === "VTI") {
          return Promise.resolve(
            Response.json({
              sectors: [
                { sector: "Technology", weight: "51.1%" },
                { sector: "Healthcare", weight: "0.46%" },
              ],
              dividend_yield: "1.50%",
            }),
          );
        }
        return Promise.reject(new Error(`unexpected fetch: ${url.toString()}`));
      }) as typeof fetch,
    });

    try {
      insertAsset(db, {
        id: "equity-alpha",
        kind: "INVESTMENT",
        name: "Old Apple",
        quote_mode: "MARKET",
        quote_ccy: "USD",
        instrument_type: "EQUITY",
        instrument_symbol: "AAPL",
        instrument_exchange_mic: "XTSE",
        provider_config: JSON.stringify({
          preferred_provider: "ALPHA_VANTAGE",
          overrides: { ALPHA_VANTAGE: { symbol: "AAPL.US" } },
        }),
      });
      insertAsset(db, {
        id: "etf-alpha",
        kind: "INVESTMENT",
        name: "Old ETF",
        quote_mode: "MARKET",
        quote_ccy: "USD",
        instrument_type: "EQUITY",
        instrument_symbol: "VTI",
        instrument_exchange_mic: "XNAS",
        provider_config: JSON.stringify({ preferred_provider: "ALPHA_VANTAGE" }),
      });
      db.exec(`
        INSERT INTO quote_sync_state (
          asset_id, profile_enriched_at, updated_at
        )
        VALUES
          ('equity-alpha', NULL, '2026-01-01T00:00:00Z'),
          ('etf-alpha', NULL, '2026-01-01T00:00:00Z');
      `);

      const result = await service.enrichAssets(["equity-alpha", "etf-alpha"]);

      expect(result).toEqual({ enriched: 2, skipped: 0, failed: 0 });
      expect(secretKeys).toEqual(["ALPHA_VANTAGE", "ALPHA_VANTAGE"]);
      expect(requests).toEqual([
        { functionName: "OVERVIEW", symbol: "AAPL.US", apiKey: "alpha-key" },
        { functionName: "OVERVIEW", symbol: "VTI", apiKey: "alpha-key" },
        { functionName: "ETF_PROFILE", symbol: "VTI", apiKey: "alpha-key" },
      ]);
      expect(service.getAssetProfile("equity-alpha")).toMatchObject({
        name: "Apple Inc",
        notes: "Designs consumer devices.",
        metadata: {
          profile: {
            quoteType: "EQUITY",
            sectors: JSON.stringify([{ name: "Technology", weight: 1 }]),
            industry: "Consumer Electronics",
            countries: JSON.stringify([{ name: "US", weight: 1 }]),
            marketCap: 2_800_000_000_000,
            peRatio: 29.5,
            dividendYield: 0.005,
            week52High: 200,
            week52Low: 150,
          },
        },
        instrumentType: "EQUITY",
      });
      expect(service.getAssetProfile("etf-alpha")).toMatchObject({
        name: "Vanguard Total Stock Market ETF",
        notes: "Tracks the US equity market.",
        metadata: {
          profile: {
            quoteType: "ETF",
            sectors: JSON.stringify([
              { name: "Technology", weight: 0.511 },
              { name: "Healthcare", weight: 0.0046 },
            ]),
            countries: JSON.stringify([{ name: "US", weight: 1 }]),
            dividendYield: 0.015,
          },
        },
        instrumentType: "EQUITY",
      });
      expect(readSyncState(db, "equity-alpha")).toMatchObject({
        profile_enriched_at: "2026-05-22T00:00:00.000Z",
      });
      expect(readSyncState(db, "etf-alpha")).toMatchObject({
        profile_enriched_at: "2026-05-22T00:00:00.000Z",
      });
    } finally {
      db.close();
    }
  });

  test("records asset provider HTTP status failures like Rust", async () => {
    const db = createAssetsDb();
    const warnings: string[] = [];
    const service = createAssetService(db, {
      exchangeMetadata: testExchangeMetadata(),
      now: () => "2026-05-22T00:00:00.000Z",
      warn: (message) => warnings.push(message),
      secretService: {
        setSecret() {},
        getSecret(secretKey) {
          return secretKey === "ALPHA_VANTAGE" ? "alpha-key" : null;
        },
        deleteSecret() {},
      },
      fetch: ((input: RequestInfo | URL) => {
        const url = new URL(String(input));
        expect(url.searchParams.get("function")).toBe("OVERVIEW");
        expect(url.searchParams.get("symbol")).toBe("AAPL");
        expect(url.searchParams.get("apikey")).toBe("alpha-key");
        return Promise.resolve(
          new Response("", {
            status: 509,
            statusText: "Bandwidth Limit Exceeded",
          }),
        );
      }) as typeof fetch,
    });

    try {
      insertAsset(db, {
        id: "equity-alpha-error",
        kind: "INVESTMENT",
        quote_mode: "MARKET",
        quote_ccy: "USD",
        instrument_type: "EQUITY",
        instrument_symbol: "AAPL",
        instrument_exchange_mic: "XNAS",
        provider_config: JSON.stringify({ preferred_provider: "ALPHA_VANTAGE" }),
      });

      await expect(service.enrichAssets(["equity-alpha-error"])).resolves.toEqual({
        enriched: 0,
        skipped: 0,
        failed: 1,
      });
      expect(warnings).toEqual([
        "Failed to enrich asset equity-alpha-error: ALPHA_VANTAGE: HTTP 509 <unknown status code>",
      ]);
    } finally {
      db.close();
    }
  });

  test("enriches US Treasury bond metadata and marks profile enriched", async () => {
    const db = createAssetsDb();
    const fetched: string[] = [];
    const profileRequests: Array<{ url: string; body: unknown }> = [];
    const service = createAssetService(db, {
      now: () => "2026-05-22T00:00:00.000Z",
      fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
        profileRequests.push({ url, body });
        if (url === "https://api.openfigi.com/v3/mapping") {
          return Promise.resolve(
            Response.json([
              {
                data: [
                  {
                    name: "US TREASURY N/B",
                    ticker: "T 4.5 05/15/43",
                  },
                ],
              },
            ]),
          );
        }
        return Promise.reject(new Error(`unexpected fetch: ${url}`));
      }) as typeof fetch,
      fetchTreasuryBondDetails(isin) {
        fetched.push(isin);
        return {
          couponRate: 0.045,
          maturityDate: "2043-05-15",
          faceValue: 1000,
          couponFrequency: "Semi-Annual",
        };
      },
    });

    try {
      insertAsset(db, {
        id: "bond-1",
        kind: "INVESTMENT",
        metadata: JSON.stringify({ identifiers: { isin: "US912810TH14" } }),
        quote_mode: "MARKET",
        quote_ccy: "USD",
        instrument_type: "BOND",
        instrument_symbol: "US912810TH14",
      });
      db.query(
        `
          INSERT INTO quote_sync_state (
            asset_id, profile_enriched_at, updated_at
          )
          VALUES ('bond-1', NULL, '2026-01-01T00:00:00Z')
        `,
      ).run();

      const result = await service.enrichAssets(["bond-1", "bond-1"]);

      expect(result).toEqual({ enriched: 1, skipped: 0, failed: 0 });
      expect(profileRequests).toEqual([
        {
          url: "https://api.openfigi.com/v3/mapping",
          body: [{ idType: "ID_ISIN", idValue: "US912810TH14" }],
        },
      ]);
      expect(fetched).toEqual(["US912810TH14"]);
      expect(service.getAssetProfile("bond-1")).toMatchObject({
        name: "US TREASURY N/B - T 4.5 05/15/43",
        metadata: {
          identifiers: { isin: "US912810TH14" },
          bond: {
            isin: "US912810TH14",
            couponRate: 0.045,
            maturityDate: "2043-05-15",
            faceValue: 1000,
            couponFrequency: "SEMI_ANNUAL",
          },
        },
      });
      expect(readSyncState(db, "bond-1")).toMatchObject({
        profile_enriched_at: "2026-05-22T00:00:00.000Z",
        updated_at: "2026-05-22T00:00:00.000Z",
      });
    } finally {
      db.close();
    }
  });

  test("skips invalid Treasury bond details without persisting non-finite metadata", async () => {
    const db = createAssetsDb();
    const warnings: string[] = [];
    const service = createAssetService(db, {
      now: () => "2026-05-22T00:00:00.000Z",
      warn: (message) => warnings.push(message),
      fetch: (() =>
        Promise.resolve(
          Response.json([
            {
              data: [
                {
                  name: "US TREASURY N/B",
                  ticker: "T 4.5 05/15/43",
                },
              ],
            },
          ]),
        )) as typeof fetch,
      fetchTreasuryBondDetails() {
        return {
          couponRate: Number.POSITIVE_INFINITY,
          maturityDate: "2043-05-15",
          faceValue: 1000,
          couponFrequency: "Semi-Annual",
        };
      },
    });

    try {
      insertAsset(db, {
        id: "bond-1",
        kind: "INVESTMENT",
        metadata: JSON.stringify({ identifiers: { isin: "US912810TH14" } }),
        quote_mode: "MARKET",
        quote_ccy: "USD",
        instrument_type: "BOND",
        instrument_symbol: "US912810TH14",
      });

      await expect(service.enrichAssets(["bond-1"])).resolves.toEqual({
        enriched: 1,
        skipped: 0,
        failed: 0,
      });
      expect(service.getAssetProfile("bond-1").metadata).toEqual({
        identifiers: { isin: "US912810TH14" },
      });
      expect(warnings).toContain("Ignoring invalid Treasury bond details for US912810TH14");
    } finally {
      db.close();
    }
  });

  test("enriches Yahoo quoteSummary profiles and marks profile enriched", async () => {
    const db = createAssetsDb();
    const fetched: string[] = [];
    const syncEvents: AssetSyncEvent[] = [];
    const service = createAssetService(db, {
      now: () => "2026-05-22T00:00:00.000Z",
      queueSyncEvent: (event) => syncEvents.push(event),
      fetch: ((input: RequestInfo | URL) => {
        const url = String(input);
        fetched.push(url);
        if (url === "https://fc.yahoo.com") {
          return Promise.resolve(
            new Response("", { headers: { "set-cookie": "B=crumb-cookie; Path=/" } }),
          );
        }
        if (url === "https://query1.finance.yahoo.com/v1/test/getcrumb") {
          return Promise.resolve(new Response("crumb-token"));
        }
        if (
          url ===
          "https://query1.finance.yahoo.com/v10/finance/quoteSummary/AAPL?modules=price,summaryProfile,summaryDetail,topHoldings&crumb=crumb-token"
        ) {
          return Promise.resolve(
            Response.json({
              quoteSummary: {
                result: [
                  {
                    price: {
                      currency: "USD",
                      longName: "Apple Inc.",
                      shortName: "Apple",
                      quoteType: "EQUITY",
                    },
                    summaryProfile: {
                      sector: "Technology",
                      industry: "Consumer Electronics",
                      website: "https://www.apple.com",
                      longBusinessSummary: "Apple designs devices.",
                      country: "United States",
                      fullTimeEmployees: 164000,
                    },
                    summaryDetail: {
                      marketCap: { raw: 2800000000000 },
                      trailingPE: { raw: 28.5 },
                      dividendYield: { raw: 0.005 },
                      fiftyTwoWeekHigh: { raw: 199.62 },
                      fiftyTwoWeekLow: { raw: 124.17 },
                    },
                    topHoldings: { sectorWeightings: [] },
                  },
                ],
              },
            }),
          );
        }
        return Promise.reject(new Error(`unexpected fetch: ${url}`));
      }) as typeof fetch,
    });

    try {
      insertAsset(db, {
        id: "equity-1",
        kind: "INVESTMENT",
        name: "Old Apple",
        quote_mode: "MARKET",
        quote_ccy: "CAD",
        instrument_symbol: "AAPL",
      });
      db.query(
        `
          INSERT INTO quote_sync_state (
            asset_id, profile_enriched_at, updated_at
          )
          VALUES ('equity-1', NULL, '2026-01-01T00:00:00Z')
        `,
      ).run();

      const result = await service.enrichAssets(["equity-1"]);

      expect(result).toEqual({ enriched: 1, skipped: 0, failed: 0 });
      expect(fetched).toEqual([
        "https://fc.yahoo.com",
        "https://query1.finance.yahoo.com/v1/test/getcrumb",
        "https://query1.finance.yahoo.com/v10/finance/quoteSummary/AAPL?modules=price,summaryProfile,summaryDetail,topHoldings&crumb=crumb-token",
      ]);
      expect(service.getAssetProfile("equity-1")).toMatchObject({
        name: "Apple Inc.",
        notes: "Apple designs devices.",
        quoteCcy: "USD",
        instrumentType: "EQUITY",
        metadata: {
          profile: {
            quoteType: "EQUITY",
            sectors: '[{"name":"Technology","weight":1}]',
            industry: "Consumer Electronics",
            countries: '[{"name":"United States","weight":1}]',
            website: "https://www.apple.com",
            marketCap: 2800000000000,
            peRatio: 28.5,
            dividendYield: 0.005,
            week52High: 199.62,
            week52Low: 124.17,
          },
        },
      });
      expect(readSyncState(db, "equity-1")).toMatchObject({
        profile_enriched_at: "2026-05-22T00:00:00.000Z",
      });
      expect(syncEvents).toHaveLength(1);
      expect(syncEvents[0]).toMatchObject({
        assetId: "equity-1",
        operation: "Update",
        payload: {
          id: "equity-1",
          name: "Apple Inc.",
          quoteCcy: "USD",
          instrumentType: "EQUITY",
        },
      });
      expect("instrumentKey" in syncEvents[0].payload).toBe(false);
    } finally {
      db.close();
    }
  });

  test("reuses Yahoo quoteSummary crumbs while enriching a batch", async () => {
    const db = createAssetsDb();
    const fetched: string[] = [];
    const service = createAssetService(db, {
      fetch: ((input: RequestInfo | URL) => {
        const url = String(input);
        fetched.push(url);
        if (url === "https://fc.yahoo.com") {
          return Promise.resolve(
            new Response("", { headers: { "set-cookie": "B=crumb-cookie; Path=/" } }),
          );
        }
        if (url === "https://query1.finance.yahoo.com/v1/test/getcrumb") {
          return Promise.resolve(new Response("crumb-token"));
        }
        if (
          url ===
          "https://query1.finance.yahoo.com/v10/finance/quoteSummary/AAPL?modules=price,summaryProfile,summaryDetail,topHoldings&crumb=crumb-token"
        ) {
          return Promise.resolve(
            Response.json({
              quoteSummary: {
                result: [{ price: { longName: "Apple Inc.", quoteType: "EQUITY" } }],
              },
            }),
          );
        }
        if (
          url ===
          "https://query1.finance.yahoo.com/v10/finance/quoteSummary/MSFT?modules=price,summaryProfile,summaryDetail,topHoldings&crumb=crumb-token"
        ) {
          return Promise.resolve(
            Response.json({
              quoteSummary: {
                result: [{ price: { longName: "Microsoft Corporation", quoteType: "EQUITY" } }],
              },
            }),
          );
        }
        return Promise.reject(new Error(`unexpected fetch: ${url}`));
      }) as typeof fetch,
    });

    try {
      for (const [id, symbol] of [
        ["equity-1", "AAPL"],
        ["equity-2", "MSFT"],
      ]) {
        insertAsset(db, {
          id,
          kind: "INVESTMENT",
          quote_mode: "MARKET",
          quote_ccy: "USD",
          instrument_symbol: symbol,
        });
        db.query(
          `
            INSERT INTO quote_sync_state (
              asset_id, profile_enriched_at, updated_at
            )
            VALUES (?, NULL, '2026-01-01T00:00:00Z')
          `,
        ).run(id);
      }

      const result = await service.enrichAssets(["equity-1", "equity-2"]);

      expect(result).toEqual({ enriched: 2, skipped: 0, failed: 0 });
      expect(fetched).toEqual([
        "https://fc.yahoo.com",
        "https://query1.finance.yahoo.com/v1/test/getcrumb",
        "https://query1.finance.yahoo.com/v10/finance/quoteSummary/AAPL?modules=price,summaryProfile,summaryDetail,topHoldings&crumb=crumb-token",
        "https://query1.finance.yahoo.com/v10/finance/quoteSummary/MSFT?modules=price,summaryProfile,summaryDetail,topHoldings&crumb=crumb-token",
      ]);
    } finally {
      db.close();
    }
  });

  test("uses e2e fixture profiles for Yahoo and FX enrichment without live fetches", async () => {
    const db = createAssetsDb();
    const previousE2e = process.env.WEALTHFOLIO_E2E;
    const previousFixtureDir = process.env.WEALTHFOLIO_FIXTURE_DIR;
    const fixtureDir = mkdtempSync(join(tmpdir(), "wealthfolio-asset-fixtures-"));
    writeFileSync(
      join(fixtureDir, "instruments.json"),
      JSON.stringify({
        instruments: [
          {
            symbol: "BRK-B",
            aliases: ["BRK.B"],
            name: "Berkshire Hathaway Inc.",
            provider: "YAHOO",
            assetType: "EQUITY",
            currency: "USD",
            basePrice: 440,
            seed: 134,
            sector: "Financial Services",
            industry: "Insurance - Diversified",
            country: "United States",
          },
          {
            symbol: "APC.DE",
            aliases: ["APC"],
            name: "Apple Inc.",
            provider: "YAHOO",
            assetType: "EQUITY",
            currency: "EUR",
            basePrice: 180,
            seed: 123,
          },
          {
            symbol: "APC",
            name: "ARKO Petroleum Corp.",
            provider: "YAHOO",
            assetType: "EQUITY",
            currency: "USD",
            basePrice: 12,
            seed: 124,
            country: "Canada",
          },
        ],
      }),
    );
    process.env.WEALTHFOLIO_E2E = "1";
    process.env.WEALTHFOLIO_FIXTURE_DIR = fixtureDir;
    const fetched: string[] = [];
    const service = createAssetService(db, {
      fetch: ((input: RequestInfo | URL) => {
        fetched.push(String(input));
        return Promise.reject(new Error("live Yahoo fetch should not run"));
      }) as typeof fetch,
      now: () => "2026-05-22T00:00:00.000Z",
    });
    insertAsset(db, {
      id: "brk",
      kind: "INVESTMENT",
      name: null,
      quote_mode: "MARKET",
      quote_ccy: "USD",
      instrument_type: "EQUITY",
      instrument_symbol: "BRK.B",
    });
    insertAsset(db, {
      id: "usd-cad",
      kind: "FX",
      name: null,
      quote_mode: "MARKET",
      quote_ccy: "CAD",
      instrument_type: "FX",
      instrument_symbol: "USD",
    });
    insertAsset(db, {
      id: "apc",
      kind: "INVESTMENT",
      name: null,
      quote_mode: "MARKET",
      quote_ccy: "USD",
      instrument_type: "EQUITY",
      instrument_symbol: "APC",
    });
    insertAsset(db, {
      id: "missing",
      kind: "INVESTMENT",
      name: null,
      quote_mode: "MARKET",
      quote_ccy: "USD",
      instrument_type: "EQUITY",
      instrument_symbol: "MISSING",
    });
    db.query(
      `
        INSERT INTO quote_sync_state (
          asset_id, profile_enriched_at, updated_at
        )
        VALUES
          ('brk', NULL, '2026-01-01T00:00:00Z'),
          ('usd-cad', NULL, '2026-01-01T00:00:00Z'),
          ('apc', NULL, '2026-01-01T00:00:00Z'),
          ('missing', NULL, '2026-01-01T00:00:00Z')
      `,
    ).run();

    try {
      const result = await service.enrichAssets(["brk", "usd-cad", "apc", "missing"]);

      expect(result).toEqual({ enriched: 3, skipped: 0, failed: 1 });
      expect(fetched).toEqual([]);
      expect(service.getAssetProfile("brk")).toMatchObject({
        name: "Berkshire Hathaway Inc.",
        notes: "Synthetic e2e profile for Berkshire Hathaway Inc.",
        metadata: {
          profile: {
            quoteType: "EQUITY",
            sectors: '[{"name":"Financial Services","weight":1}]',
            industry: "Insurance - Diversified",
            countries: '[{"name":"United States","weight":1}]',
          },
        },
      });
      expect(service.getAssetProfile("apc")).toMatchObject({
        name: "ARKO Petroleum Corp.",
        quoteCcy: "USD",
        metadata: {
          profile: {
            quoteType: "EQUITY",
            countries: '[{"name":"Canada","weight":1}]',
          },
        },
      });
      expect(service.getAssetProfile("usd-cad")).toMatchObject({
        name: "USD/CAD",
        notes: "Synthetic e2e profile for USD/CAD",
        metadata: {
          profile: {
            quoteType: "FX",
          },
        },
      });
      expect(readSyncState(db, "brk")).toMatchObject({
        profile_enriched_at: "2026-05-22T00:00:00.000Z",
      });
      expect(readSyncState(db, "usd-cad")).toMatchObject({
        profile_enriched_at: "2026-05-22T00:00:00.000Z",
      });
      expect(readSyncState(db, "apc")).toMatchObject({
        profile_enriched_at: "2026-05-22T00:00:00.000Z",
      });
      expect(readSyncState(db, "missing")).toMatchObject({
        profile_enriched_at: null,
      });
    } finally {
      if (previousE2e === undefined) {
        delete process.env.WEALTHFOLIO_E2E;
      } else {
        process.env.WEALTHFOLIO_E2E = previousE2e;
      }
      if (previousFixtureDir === undefined) {
        delete process.env.WEALTHFOLIO_FIXTURE_DIR;
      } else {
        process.env.WEALTHFOLIO_FIXTURE_DIR = previousFixtureDir;
      }
      rmSync(fixtureDir, { recursive: true, force: true });
      db.close();
    }
  });

  test("auto-classifies Yahoo provider sectors and region", async () => {
    const db = createAssetsDb();
    const assignments: NewAssetTaxonomyAssignment[] = [];
    const service = createAssetService(db, {
      fetch: ((input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "https://fc.yahoo.com") {
          return Promise.resolve(
            new Response("", { headers: { "set-cookie": "B=crumb-cookie; Path=/" } }),
          );
        }
        if (url === "https://query1.finance.yahoo.com/v1/test/getcrumb") {
          return Promise.resolve(new Response("crumb-token"));
        }
        if (
          url ===
          "https://query1.finance.yahoo.com/v10/finance/quoteSummary/VTI?modules=price,summaryProfile,summaryDetail,topHoldings&crumb=crumb-token"
        ) {
          return Promise.resolve(
            Response.json({
              quoteSummary: {
                result: [
                  {
                    price: {
                      currency: "USD",
                      longName: "Vanguard Total Stock Market ETF",
                      quoteType: "ETF",
                    },
                    topHoldings: {
                      sectorWeightings: [
                        { technology: { raw: 0.2915 } },
                        { healthcare: { raw: 0.128 } },
                      ],
                    },
                  },
                ],
              },
            }),
          );
        }
        return Promise.reject(new Error(`unexpected fetch: ${url}`));
      }) as typeof fetch,
      taxonomyService: {
        assignAssetToCategory(assignment) {
          assignments.push(assignment);
        },
      },
    });

    try {
      insertAsset(db, {
        id: "etf-1",
        kind: "INVESTMENT",
        quote_mode: "MARKET",
        quote_ccy: "USD",
        instrument_symbol: "VTI",
        instrument_exchange_mic: "XNAS",
      });
      db.query(
        `
          INSERT INTO quote_sync_state (
            asset_id, profile_enriched_at, updated_at
          )
          VALUES ('etf-1', NULL, '2026-01-01T00:00:00Z')
        `,
      ).run();

      const result = await service.enrichAssets(["etf-1"]);

      expect(result).toEqual({ enriched: 1, skipped: 0, failed: 0 });
      expect(service.getAssetProfile("etf-1")).toMatchObject({
        name: "Vanguard Total Stock Market ETF",
        instrumentType: "EQUITY",
        metadata: {
          profile: {
            quoteType: "ETF",
            sectors: '[{"name":"Technology","weight":0.2915},{"name":"Healthcare","weight":0.128}]',
          },
        },
      });
      expect(assignments).toEqual([
        {
          assetId: "etf-1",
          taxonomyId: "instrument_type",
          categoryId: "ETF",
          weight: 10000,
          source: "AUTO",
        },
        {
          assetId: "etf-1",
          taxonomyId: "asset_classes",
          categoryId: "EQUITY",
          weight: 10000,
          source: "AUTO",
        },
        {
          assetId: "etf-1",
          taxonomyId: "industries_gics",
          categoryId: "45",
          weight: 2915,
          source: "AUTO",
        },
        {
          assetId: "etf-1",
          taxonomyId: "industries_gics",
          categoryId: "35",
          weight: 1280,
          source: "AUTO",
        },
        {
          assetId: "etf-1",
          taxonomyId: "regions",
          categoryId: "country_US",
          weight: 10000,
          source: "AUTO",
        },
      ]);
    } finally {
      db.close();
    }
  });

  test("falls back to Yahoo search profiles and marks profile enriched", async () => {
    const db = createAssetsDb();
    const fetched: string[] = [];
    const assignments: NewAssetTaxonomyAssignment[] = [];
    const service = createAssetService(db, {
      now: () => "2026-05-22T00:00:00.000Z",
      fetch: ((input: RequestInfo | URL) => {
        const url = String(input);
        fetched.push(url);
        if (url === "https://fc.yahoo.com") {
          return Promise.resolve(new Response("", { status: 500 }));
        }
        if (url === "https://query2.finance.yahoo.com/v1/finance/search?q=AAPL") {
          return Promise.resolve(
            Response.json({
              quotes: [
                {
                  symbol: "AAPL",
                  longname: "Apple Inc.",
                  shortname: "Apple",
                  quoteType: "EQUITY",
                },
              ],
            }),
          );
        }
        return Promise.reject(new Error(`unexpected fetch: ${url}`));
      }) as typeof fetch,
      taxonomyService: {
        assignAssetToCategory(assignment) {
          assignments.push(assignment);
        },
      },
    });

    try {
      insertAsset(db, {
        id: "equity-1",
        kind: "INVESTMENT",
        name: "Old Apple",
        quote_mode: "MARKET",
        quote_ccy: "USD",
        instrument_symbol: "AAPL",
      });
      db.query(
        `
          INSERT INTO quote_sync_state (
            asset_id, profile_enriched_at, updated_at
          )
          VALUES ('equity-1', NULL, '2026-01-01T00:00:00Z')
        `,
      ).run();

      const result = await service.enrichAssets(["equity-1"]);

      expect(result).toEqual({ enriched: 1, skipped: 0, failed: 0 });
      expect(fetched).toEqual([
        "https://fc.yahoo.com",
        "https://query2.finance.yahoo.com/v1/finance/search?q=AAPL",
      ]);
      expect(service.getAssetProfile("equity-1")).toMatchObject({
        name: "Apple Inc.",
        instrumentType: "EQUITY",
        metadata: {
          profile: { quoteType: "EQUITY" },
        },
      });
      expect(readSyncState(db, "equity-1")).toMatchObject({
        profile_enriched_at: "2026-05-22T00:00:00.000Z",
      });
      expect(assignments).toEqual([
        {
          assetId: "equity-1",
          taxonomyId: "instrument_type",
          categoryId: "STOCK_COMMON",
          weight: 10000,
          source: "AUTO",
        },
        {
          assetId: "equity-1",
          taxonomyId: "asset_classes",
          categoryId: "EQUITY",
          weight: 10000,
          source: "AUTO",
        },
      ]);
    } finally {
      db.close();
    }
  });

  test("skips already profile-enriched assets and unsupported market profiles", async () => {
    const db = createAssetsDb();
    const fetched: string[] = [];
    const service = createAssetService(db, {
      fetch: ((input: RequestInfo | URL) => {
        fetched.push(String(input));
        throw new Error("should not fetch skipped profiles");
      }) as typeof fetch,
      fetchTreasuryBondDetails(isin) {
        fetched.push(isin);
        throw new Error("should not fetch skipped bonds");
      },
    });

    try {
      insertAsset(db, {
        id: "bond-1",
        kind: "INVESTMENT",
        quote_mode: "MARKET",
        quote_ccy: "USD",
        instrument_type: "BOND",
        instrument_symbol: "US912810TH14",
      });
      insertAsset(db, {
        id: "equity-1",
        kind: "INVESTMENT",
        quote_mode: "MARKET",
        quote_ccy: "USD",
        instrument_type: "EQUITY",
        instrument_symbol: "AAPL",
        provider_config: JSON.stringify({ preferred_provider: "CUSTOM_SCRAPER" }),
      });
      insertAsset(db, {
        id: "finnhub-no-key",
        kind: "INVESTMENT",
        quote_mode: "MARKET",
        quote_ccy: "USD",
        instrument_type: "EQUITY",
        instrument_symbol: "AAPL",
        provider_config: JSON.stringify({ preferred_provider: "FINNHUB" }),
      });
      insertAsset(db, {
        id: "alpha-no-key",
        kind: "INVESTMENT",
        quote_mode: "MARKET",
        quote_ccy: "USD",
        instrument_type: "EQUITY",
        instrument_symbol: "AAPL",
        provider_config: JSON.stringify({ preferred_provider: "ALPHA_VANTAGE" }),
      });
      db.exec(`
        INSERT INTO quote_sync_state (
          asset_id, profile_enriched_at, updated_at
        )
        VALUES ('bond-1', '2026-05-21T00:00:00Z', '2026-05-21T00:00:00Z');
      `);

      const result = await service.enrichAssets([
        "bond-1",
        "equity-1",
        "finnhub-no-key",
        "alpha-no-key",
      ]);

      expect(result).toEqual({ enriched: 0, skipped: 4, failed: 0 });
      expect(fetched).toEqual([]);
      expect(readSyncState(db, "bond-1")).toMatchObject({
        profile_enriched_at: "2026-05-21T00:00:00Z",
      });
    } finally {
      db.close();
    }
  });

  test("keeps enrichment batches best-effort when an asset fails", async () => {
    const db = createAssetsDb();
    const warnings: string[] = [];
    const service = createAssetService(db, {
      now: () => "2026-05-22T00:00:00.000Z",
      warn: (message) => warnings.push(message),
    });

    try {
      insertAsset(db, {
        id: "manual-1",
        kind: "INVESTMENT",
        quote_mode: "MANUAL",
        quote_ccy: "USD",
      });
      db.query(
        `
          INSERT INTO quote_sync_state (
            asset_id, profile_enriched_at, updated_at
          )
          VALUES ('manual-1', NULL, '2026-01-01T00:00:00Z')
        `,
      ).run();

      const result = await service.enrichAssets(["missing-asset", "manual-1"]);

      expect(result).toEqual({ enriched: 1, skipped: 0, failed: 1 });
      expect(warnings).toEqual([
        "Failed to enrich asset missing-asset: Record not found: asset missing-asset",
      ]);
      expect(readSyncState(db, "manual-1")).toMatchObject({
        profile_enriched_at: "2026-05-22T00:00:00.000Z",
      });
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
      profile_enriched_at TEXT,
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
          alpha_vantage: { suffix: "" },
        },
        {
          mic: "XTSE",
          name: "TSX",
          currency: "CAD",
          yahoo: { suffix: "TO" },
          alpha_vantage: { suffix: ".TRT" },
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
