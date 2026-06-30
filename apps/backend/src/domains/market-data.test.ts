import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import type {
  CustomProviderSource,
  CustomProviderSourceKind,
  CustomProviderWithSources,
  TestSourceRequest,
} from "./custom-providers";
import { createMarketDataService } from "./market-data";
import type { QuoteSyncEvent } from "./quote-sync";

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
        {
          mic: "XLON",
          name: "LSE",
          longName: "LSE",
          currency: "GBP",
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
        created_at: "2026-01-01T10:00:00Z",
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
          createdAt: "2026-01-01T10:00:00Z",
          timestamp: "2026-01-01T16:00:00Z",
          dataSource: "FINNHUB",
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

  test("stores manual quote timestamps like Rust", () => {
    const db = createMarketDataDb();
    const service = createMarketDataService(db);

    try {
      service.updateQuote("asset-1", {
        dataSource: "MANUAL",
        timestamp: "2026-01-02T18:30:00.123456+0230",
        close: "12.34",
        currency: "USD",
        createdAt: "2026-01-02T18:31:00.123456Z",
      });

      const row = db
        .query<
          { timestamp: string; created_at: string },
          []
        >("SELECT timestamp, created_at FROM quotes WHERE asset_id = 'asset-1'")
        .get();
      expect(row).toEqual({
        timestamp: "2026-01-02T16:00:00.123456+00:00",
        created_at: "2026-01-02T18:31:00.123456+00:00",
      });
      expect(service.getQuoteHistory?.("asset-1")[0]).toMatchObject({
        timestamp: "2026-01-02T16:00:00.123456Z",
        createdAt: "2026-01-02T18:31:00.123456Z",
      });

      service.updateQuote("asset-1", {
        dataSource: "MANUAL",
        timestamp: "2015-07-01T01:59:60+02:00",
        close: "12.35",
        currency: "USD",
        createdAt: "2015-06-30T23:59:60Z",
      });
      expect(
        service.getQuoteHistory?.("asset-1").find((quote) => quote.timestamp.includes(":60")),
      ).toMatchObject({
        timestamp: "2015-06-30T23:59:60Z",
        createdAt: "2015-06-30T23:59:60Z",
      });
    } finally {
      db.close();
    }
  });

  test("runs broad market sync as a no-op when no local assets qualify", async () => {
    const db = createMarketDataDb();
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: (() => Promise.reject(new Error("fetch should not be called"))) as typeof fetch,
    });

    try {
      await expect(service.syncHistoryQuotes?.()).resolves.toMatchObject(emptySyncResult());
      await expect(service.syncMarketData?.({ type: "none" })).resolves.toMatchObject(
        emptySyncResult(),
      );
      await expect(
        service.syncMarketData?.({ type: "incremental", asset_ids: [] }),
      ).resolves.toMatchObject(emptySyncResult());
      await expect(
        service.syncMarketData?.({ type: "refetch_recent", asset_ids: [], days: 7 }),
      ).resolves.toMatchObject(emptySyncResult());
      await expect(
        service.syncMarketData?.({ type: "backfill_history", asset_ids: [], days: 7 }),
      ).resolves.toMatchObject(emptySyncResult());
      await expect(
        service.syncMarketData?.({ type: "incremental", asset_ids: null }),
      ).resolves.toMatchObject(emptySyncResult());
      await expect(
        service.syncMarketData?.({ type: "refetch_recent", asset_ids: null, days: 7 }),
      ).resolves.toMatchObject(emptySyncResult());
      await expect(
        service.syncMarketData?.({
          type: "refetch_recent",
          asset_ids: [],
          days: 1.5,
        }),
      ).rejects.toThrow("days is outside supported date range");
      await expect(
        service.syncMarketData?.({
          type: "refetch_recent",
          asset_ids: [],
          days: 1_000_000,
        }),
      ).rejects.toThrow("days is outside supported date range");
      await expect(
        service.syncMarketData?.({
          type: "backfill_history",
          asset_ids: null,
          days: 100_000_000_000,
        }),
      ).rejects.toThrow("days is outside supported date range");
    } finally {
      db.close();
    }
  });

  test("skips unsupported preferred providers without migration-era wording", async () => {
    const db = createMarketDataDb();
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: (() => Promise.reject(new Error("fetch should not be called"))) as typeof fetch,
    });

    try {
      insertAsset(db, {
        id: "asset-unsupported-provider",
        display_code: "UNSUPPORTED",
        instrument_symbol: "UNSUPPORTED",
        instrument_exchange_mic: "XNAS",
        provider_config: JSON.stringify({ preferred_provider: "legacy_provider" }),
      });

      await expect(
        service.syncMarketData?.({
          type: "incremental",
          asset_ids: ["asset-unsupported-provider"],
        }),
      ).resolves.toMatchObject({
        synced: 0,
        failed: 0,
        skipped: 1,
        quotesSynced: 0,
        failures: [],
        skippedReasons: [
          ["asset-unsupported-provider", "Provider not supported for market sync: LEGACY_PROVIDER"],
        ],
      });
    } finally {
      db.close();
    }
  });

  test("syncs broad Yahoo and Boerse Frankfurt market assets", async () => {
    const db = createMarketDataDb();
    const chartSymbols: string[] = [];
    const fetchImpl = boerseTestFetch({
      fallback: yahooHistoryFetchBySymbol(
        {
          AAPL: {
            result: {
              meta: { currency: "USD" },
              timestamp: [1767571200],
              indicators: { quote: [{ close: [10.5] }] },
            },
          },
        },
        (symbol) => chartSymbols.push(symbol),
      ),
      search: {
        SAP: [
          {
            symbol: "XETR:DE0007164600",
            description: "SAP SE",
            exchange: "Xetra",
            type: "Aktie",
          },
        ],
      },
      history: {
        "XETR:DE0007164600": {
          s: "ok",
          t: [1767571200],
          c: [70.02],
        },
      },
    });
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: fetchImpl,
      now: () => new Date("2026-01-06T22:30:00Z"),
    });

    try {
      insertAsset(db, {
        id: "asset-aapl",
        display_code: "AAPL",
        instrument_symbol: "AAPL",
        instrument_exchange_mic: "XNAS",
      });
      insertAsset(db, {
        id: "asset-sap",
        display_code: "SAP",
        quote_ccy: "EUR",
        instrument_symbol: "SAP",
        instrument_exchange_mic: "XETR",
        provider_config: JSON.stringify({ preferred_provider: "BOERSE_FRANKFURT" }),
      });
      insertAsset(db, {
        id: "manual-asset",
        quote_mode: "MANUAL",
        instrument_symbol: "MANUAL",
        provider_config: JSON.stringify({ preferred_provider: "YAHOO" }),
      });

      await expect(
        service.syncMarketData?.({ type: "incremental", asset_ids: null }),
      ).resolves.toMatchObject({
        synced: 2,
        failed: 0,
        skipped: 0,
        quotesSynced: 2,
        failures: [],
        skippedReasons: [],
      });

      expect(chartSymbols).toEqual(["AAPL"]);
      expect(readQuoteByDay(db, "asset-aapl", "2026-01-05")).toMatchObject({
        source: "YAHOO",
        close: "10.5",
      });
      expect(readQuoteByDay(db, "asset-sap", "2026-01-05")).toMatchObject({
        source: "BOERSE_FRANKFURT",
        close: "70.02",
        currency: "EUR",
      });
      expect(readSyncState(db, "asset-aapl")).toMatchObject({
        data_source: "YAHOO",
        error_count: 0,
        last_error: null,
      });
      expect(readSyncState(db, "asset-sap")).toMatchObject({
        data_source: "BOERSE_FRANKFURT",
        error_count: 0,
        last_error: null,
      });
      expect(readSyncState(db, "manual-asset")).toBeNull();
    } finally {
      db.close();
    }
  });

  test("falls back from OpenFIGI profile provider to Yahoo for quote sync", async () => {
    const db = createMarketDataDb();
    const chartSymbols: string[] = [];
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: yahooHistoryFetchBySymbol(
        {
          AAPL: {
            result: {
              meta: { currency: "USD" },
              timestamp: [1767571200],
              indicators: { quote: [{ close: [10.5] }] },
            },
          },
        },
        (symbol) => chartSymbols.push(symbol),
      ),
      now: () => new Date("2026-01-06T22:30:00Z"),
    });

    try {
      insertAsset(db, {
        id: "openfigi-profile-asset",
        display_code: "AAPL",
        instrument_symbol: "AAPL",
        instrument_exchange_mic: "XNAS",
        provider_config: JSON.stringify({ preferred_provider: "OPENFIGI" }),
      });

      await expect(
        service.syncMarketData?.({ type: "incremental", asset_ids: ["openfigi-profile-asset"] }),
      ).resolves.toMatchObject({
        synced: 1,
        failed: 0,
        skipped: 0,
        quotesSynced: 1,
        skippedReasons: [],
      });

      expect(chartSymbols).toEqual(["AAPL"]);
      expect(readQuoteByDay(db, "openfigi-profile-asset", "2026-01-05")).toMatchObject({
        source: "YAHOO",
        close: "10.5",
      });
      expect(readSyncState(db, "openfigi-profile-asset")).toMatchObject({
        data_source: "YAHOO",
        error_count: 0,
        last_error: null,
      });
    } finally {
      db.close();
    }
  });

  test("falls back from unsupported preferred quote providers to Yahoo sync", async () => {
    const db = createMarketDataDb();
    const chartSymbols: string[] = [];
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: yahooHistoryFetchBySymbol(
        {
          "BTC-USD": {
            result: {
              meta: { currency: "USD" },
              timestamp: [1767571200],
              indicators: { quote: [{ close: [65000] }] },
            },
          },
          AAPL260117C00100000: {
            result: {
              meta: { currency: "USD" },
              timestamp: [1767571200],
              indicators: { quote: [{ close: [12.34] }] },
            },
          },
          AAPL: {
            result: {
              meta: { currency: "USD" },
              timestamp: [1767571200],
              indicators: { quote: [{ close: [10.5] }] },
            },
          },
          XAU: {
            result: {
              meta: { currency: "USD" },
              timestamp: [1767571200],
              indicators: { quote: [{ close: [2000] }] },
            },
          },
          "ETH-USD": {
            result: {
              meta: { currency: "USD" },
              timestamp: [1767571200],
              indicators: { quote: [{ close: [3500] }] },
            },
          },
        },
        (symbol) => chartSymbols.push(symbol),
      ),
      now: () => new Date("2026-01-06T22:30:00Z"),
    });

    try {
      insertAsset(db, {
        id: "marketdata-crypto",
        display_code: "BTC-USD",
        quote_ccy: "USD",
        instrument_type: "CRYPTO",
        instrument_symbol: "BTC",
        provider_config: JSON.stringify({ preferred_provider: "MARKETDATA_APP" }),
      });
      insertSyncState(db, {
        asset_id: "marketdata-crypto",
        data_source: "MARKETDATA_APP",
        error_count: 10,
        last_error: "old provider failure",
      });
      insertAsset(db, {
        id: "alpha-option",
        display_code: "AAPL option",
        quote_ccy: "USD",
        instrument_type: "OPTION",
        instrument_symbol: "AAPL260117C00100000",
        provider_config: JSON.stringify({ preferred_provider: "ALPHA_VANTAGE" }),
      });
      insertSyncState(db, {
        asset_id: "alpha-option",
        data_source: "ALPHA_VANTAGE",
        error_count: 10,
        last_error: "old provider failure",
      });
      insertAsset(db, {
        id: "metal-api-equity",
        display_code: "AAPL",
        quote_ccy: "USD",
        instrument_type: "EQUITY",
        instrument_symbol: "AAPL",
        provider_config: JSON.stringify({ preferred_provider: "METAL_PRICE_API" }),
      });
      insertAsset(db, {
        id: "finnhub-metal",
        display_code: "XAU",
        quote_ccy: "USD",
        instrument_type: "METAL",
        instrument_symbol: "XAU",
        provider_config: JSON.stringify({ preferred_provider: "FINNHUB" }),
      });
      insertAsset(db, {
        id: "boerse-crypto",
        display_code: "ETH-USD",
        quote_ccy: "USD",
        instrument_type: "CRYPTO",
        instrument_symbol: "ETH",
        provider_config: JSON.stringify({ preferred_provider: "BOERSE_FRANKFURT" }),
      });

      await expect(
        service.syncMarketData?.({
          type: "incremental",
          asset_ids: [
            "marketdata-crypto",
            "alpha-option",
            "metal-api-equity",
            "finnhub-metal",
            "boerse-crypto",
          ],
        }),
      ).resolves.toMatchObject({
        synced: 5,
        failed: 0,
        skipped: 0,
        quotesSynced: 5,
        skippedReasons: [],
      });

      expect(chartSymbols).toEqual(["BTC-USD", "AAPL260117C00100000", "AAPL", "XAU", "ETH-USD"]);
      expect(readQuoteByDay(db, "marketdata-crypto", "2026-01-05")).toMatchObject({
        source: "YAHOO",
        close: "65000",
      });
      expect(readQuoteByDay(db, "alpha-option", "2026-01-05")).toMatchObject({
        source: "YAHOO",
        close: "12.34",
      });
      expect(readQuoteByDay(db, "metal-api-equity", "2026-01-05")).toMatchObject({
        source: "YAHOO",
        close: "10.5",
      });
      expect(readQuoteByDay(db, "finnhub-metal", "2026-01-05")).toMatchObject({
        source: "YAHOO",
        close: "2000",
      });
      expect(readQuoteByDay(db, "boerse-crypto", "2026-01-05")).toMatchObject({
        source: "YAHOO",
        close: "3500",
      });
      expect(readSyncState(db, "marketdata-crypto")).toMatchObject({
        data_source: "YAHOO",
        error_count: 0,
        last_error: null,
      });
      expect(readSyncState(db, "alpha-option")).toMatchObject({
        data_source: "YAHOO",
        error_count: 0,
        last_error: null,
      });
      expect(readSyncState(db, "metal-api-equity")).toMatchObject({
        data_source: "YAHOO",
        error_count: 0,
        last_error: null,
      });
      expect(readSyncState(db, "finnhub-metal")).toMatchObject({
        data_source: "YAHOO",
        error_count: 0,
        last_error: null,
      });
      expect(readSyncState(db, "boerse-crypto")).toMatchObject({
        data_source: "YAHOO",
        error_count: 0,
        last_error: null,
      });
    } finally {
      db.close();
    }
  });

  test("starts a fresh error count when fallback provider fails", async () => {
    const db = createMarketDataDb();
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: yahooHistoryFetchBySymbol({}),
      now: () => new Date("2026-01-06T22:30:00Z"),
    });

    try {
      insertAsset(db, {
        id: "alpha-option-fallback-failure",
        display_code: "AAPL option",
        quote_ccy: "USD",
        instrument_type: "OPTION",
        instrument_symbol: "AAPL260117C00100000",
        provider_config: JSON.stringify({ preferred_provider: "ALPHA_VANTAGE" }),
      });
      insertSyncState(db, {
        asset_id: "alpha-option-fallback-failure",
        data_source: "ALPHA_VANTAGE",
        error_count: 10,
        last_error: "old provider failure",
      });

      await expect(
        service.syncMarketData?.({
          type: "incremental",
          asset_ids: ["alpha-option-fallback-failure"],
        }),
      ).resolves.toMatchObject({
        synced: 0,
        failed: 1,
        skipped: 0,
        quotesSynced: 0,
      });

      expect(readSyncState(db, "alpha-option-fallback-failure")).toMatchObject({
        data_source: "YAHOO",
        error_count: 1,
        last_error: expect.stringContaining("unexpected chart symbol: AAPL260117C00100000"),
      });
    } finally {
      db.close();
    }
  });

  test("syncs targeted custom provider latest quotes with source overrides", async () => {
    const db = createMarketDataDb();
    const yahooCalls: string[] = [];
    const requests: TestSourceRequest[] = [];
    const latestSource: CustomProviderSource = {
      id: "source-latest",
      providerId: "my-feed",
      kind: "latest",
      format: "json",
      url: "https://prices.example.test/latest/{SYMBOL}",
      pricePath: "$.price",
      datePath: "$.date",
      dateFormat: null,
      currencyPath: "$.currency",
      factor: null,
      invert: null,
      locale: null,
      headers: null,
      openPath: null,
      highPath: null,
      lowPath: null,
      volumePath: null,
      defaultPrice: null,
      dateTimezone: "Pacific/Kiritimati",
    };
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: (() => {
        yahooCalls.push("yahoo");
        throw new Error("Yahoo should not be called");
      }) as typeof fetch,
      now: () => new Date("2026-01-11T00:00:00Z"),
      customProviderService: {
        getSourceByKind(providerCode, kind) {
          expect(providerCode).toBe("my-feed");
          expect(kind).toBe("latest");
          return latestSource;
        },
        testSource(request) {
          requests.push(request);
          expect(request).toMatchObject({
            symbol: "FUND.TO",
            currency: "CAD",
            url: "https://prices.example.test/latest/{SYMBOL}",
          });
          return {
            success: true,
            statusCode: 200,
            price: 0,
            open: null,
            high: null,
            low: null,
            volume: null,
            currency: "CAD",
            date: "2026-01-10T23:00:00-05:00",
            error: null,
            rawResponse: null,
            detectedElements: null,
            detectedTables: null,
          };
        },
      },
    });

    try {
      insertAsset(db, {
        id: "asset-custom",
        display_code: "FUND",
        quote_ccy: "CAD",
        instrument_symbol: "FUND",
        instrument_exchange_mic: "XTSE",
        provider_config: JSON.stringify({
          preferred_provider: "CUSTOM_SCRAPER",
          custom_provider_code: "my-feed",
          overrides: {
            "CUSTOM:my-feed": { type: "equity_symbol", symbol: "FUND.TO" },
          },
        }),
      });

      await expect(
        service.syncMarketData?.({ type: "incremental", asset_ids: ["asset-custom"] }),
      ).resolves.toEqual({
        synced: 1,
        failed: 0,
        skipped: 0,
        quotesSynced: 1,
        failures: [],
        skippedReasons: [],
      });

      expect(requests).toHaveLength(1);
      expect(yahooCalls).toEqual([]);
      expect(readQuoteByDay(db, "asset-custom", "2026-01-09")).toMatchObject({
        id: "asset-custom_2026-01-09_CUSTOM_SCRAPER:my-feed",
        source: "CUSTOM_SCRAPER:my-feed",
        close: "0",
        open: null,
        high: null,
        low: null,
        adjclose: null,
        volume: null,
        currency: "CAD",
        timestamp: "2026-01-09T22:00:00.000Z",
      });
      expect(readSyncState(db, "asset-custom")).toMatchObject({
        data_source: "CUSTOM_SCRAPER:my-feed",
        error_count: 0,
        last_error: null,
      });
    } finally {
      db.close();
    }
  });

  test("rejects invalid synced custom provider latest quotes like Rust validation", async () => {
    const db = createMarketDataDb();
    const latestSource: CustomProviderSource = {
      id: "source-latest",
      providerId: "my-feed",
      kind: "latest",
      format: "json",
      url: "https://prices.example.test/latest/{SYMBOL}",
      pricePath: "$.price",
      datePath: "$.date",
      dateFormat: null,
      currencyPath: "$.currency",
      factor: null,
      invert: null,
      locale: null,
      headers: null,
      openPath: null,
      highPath: null,
      lowPath: null,
      volumePath: null,
      defaultPrice: null,
      dateTimezone: null,
    };
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: (() => {
        throw new Error("Yahoo should not be called");
      }) as typeof fetch,
      now: () => new Date("2026-01-11T00:00:00Z"),
      customProviderService: {
        getSourceByKind(providerCode, kind) {
          expect(providerCode).toBe("my-feed");
          expect(kind).toBe("latest");
          return latestSource;
        },
        testSource() {
          return {
            success: true,
            statusCode: 200,
            price: -5,
            open: null,
            high: null,
            low: null,
            volume: null,
            currency: "CAD",
            date: "2026-01-10",
            error: null,
            rawResponse: null,
            detectedElements: null,
            detectedTables: null,
          };
        },
      },
    });

    try {
      insertAsset(db, {
        id: "asset-custom",
        display_code: "FUND",
        quote_ccy: "CAD",
        instrument_symbol: "FUND",
        instrument_exchange_mic: "XTSE",
        provider_config: JSON.stringify({
          preferred_provider: "CUSTOM_SCRAPER",
          custom_provider_code: "my-feed",
        }),
      });

      await expect(
        service.syncMarketData?.({ type: "incremental", asset_ids: ["asset-custom"] }),
      ).resolves.toEqual({
        synced: 0,
        failed: 1,
        skipped: 0,
        quotesSynced: 0,
        failures: [["FUND", "Quote validation failed: Negative close price: -5"]],
        skippedReasons: [],
      });
      expect(readQuoteByDay(db, "asset-custom", "2026-01-10")).toBeNull();
      expect(readSyncState(db, "asset-custom")).toMatchObject({
        data_source: "CUSTOM_SCRAPER:my-feed",
        error_count: 1,
        last_error: "Quote validation failed: Negative close price: -5",
      });
    } finally {
      db.close();
    }
  });

  test("falls back to now for custom provider dates with invalid ISO prefixes", async () => {
    const db = createMarketDataDb();
    const latestSource: CustomProviderSource = {
      id: "source-latest",
      providerId: "my-feed",
      kind: "latest",
      format: "json",
      url: "https://prices.example.test/latest/{SYMBOL}",
      pricePath: "$.price",
      datePath: "$.date",
      dateFormat: null,
      currencyPath: "$.currency",
      factor: null,
      invert: null,
      locale: null,
      headers: null,
      openPath: null,
      highPath: null,
      lowPath: null,
      volumePath: null,
      defaultPrice: null,
      dateTimezone: null,
    };
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: (() => {
        throw new Error("Yahoo should not be called");
      }) as typeof fetch,
      now: () => new Date("2026-01-15T23:00:00Z"),
      customProviderService: {
        getSourceByKind() {
          return latestSource;
        },
        testSource() {
          return {
            success: true,
            statusCode: 200,
            price: 14.25,
            open: null,
            high: null,
            low: null,
            volume: null,
            currency: "CAD",
            date: "2026-01-10 closing price",
            error: null,
            rawResponse: null,
            detectedElements: null,
            detectedTables: null,
          };
        },
      },
    });

    try {
      insertAsset(db, {
        id: "asset-custom",
        display_code: "FUND",
        quote_ccy: "CAD",
        instrument_symbol: "FUND",
        instrument_exchange_mic: "XTSE",
        provider_config: JSON.stringify({
          preferred_provider: "CUSTOM_SCRAPER",
          custom_provider_code: "my-feed",
        }),
      });

      await expect(
        service.syncMarketData?.({ type: "incremental", asset_ids: ["asset-custom"] }),
      ).resolves.toMatchObject({
        synced: 1,
        failed: 0,
        quotesSynced: 1,
      });

      expect(readQuoteByDay(db, "asset-custom", "2026-01-10")).toBeNull();
      expect(readQuoteByDay(db, "asset-custom", "2026-01-15")).toMatchObject({
        id: "asset-custom_2026-01-15_CUSTOM_SCRAPER:my-feed",
        close: "14.25",
        currency: "CAD",
        timestamp: "2026-01-15T23:00:00.000Z",
      });
    } finally {
      db.close();
    }
  });

  test("backfills explicit custom provider historical quotes", async () => {
    const db = createMarketDataDb();
    const requests: TestSourceRequest[] = [];
    const historicalSource: CustomProviderSource = {
      id: "source-historical",
      providerId: "my-feed",
      kind: "historical",
      format: "json",
      url: "https://prices.example.test/history/{SYMBOL}?from={FROM}&to={TO}",
      pricePath: "$.prices[*].close",
      datePath: "$.prices[*].date",
      dateFormat: null,
      currencyPath: "$.currency",
      factor: null,
      invert: null,
      locale: null,
      headers: null,
      openPath: "$.prices[*].open",
      highPath: "$.prices[*].high",
      lowPath: "$.prices[*].low",
      volumePath: "$.prices[*].volume",
      defaultPrice: null,
      dateTimezone: "America/Toronto",
    };
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: (() => {
        throw new Error("Yahoo should not be called");
      }) as typeof fetch,
      now: () => new Date("2026-01-15T23:00:00Z"),
      customProviderService: {
        getSourceByKind(providerCode, kind) {
          expect(providerCode).toBe("my-feed");
          expect(kind).toBe("historical");
          return historicalSource;
        },
        testSource() {
          throw new Error("testSource should not be called for historical backfill");
        },
        fetchSourceRows(request) {
          requests.push(request);
          return {
            statusCode: 200,
            currency: "CAD",
            rows: [
              {
                price: -1,
                open: null,
                high: null,
                low: null,
                volume: null,
                date: "2026-01-12",
              },
              {
                price: 10.25,
                open: 10,
                high: 10.5,
                low: 9.75,
                volume: 1000,
                date: "2026-01-13",
              },
              {
                price: 11.5,
                open: null,
                high: null,
                low: null,
                volume: null,
                date: "2026-01-14",
              },
            ],
          };
        },
      },
    });

    try {
      insertAsset(db, {
        id: "asset-custom",
        display_code: "FUND",
        quote_ccy: "CAD",
        instrument_symbol: "FUND",
        instrument_exchange_mic: "XTSE",
        provider_config: JSON.stringify({
          preferred_provider: "CUSTOM_SCRAPER",
          custom_provider_code: "my-feed",
          overrides: {
            "CUSTOM:my-feed": { type: "equity_symbol", symbol: "FUND.TO" },
          },
        }),
      });
      insertQuote(db, {
        id: "stale-custom-quote",
        asset_id: "asset-custom",
        day: "2025-12-31",
        source: "CUSTOM_SCRAPER:my-feed",
        close: "99",
        currency: "CAD",
      });
      insertQuote(db, {
        id: "manual-custom-quote",
        asset_id: "asset-custom",
        day: "2025-12-30",
        source: "MANUAL",
        close: "88",
        currency: "CAD",
      });

      await expect(
        service.syncMarketData?.({
          type: "backfill_history",
          asset_ids: ["asset-custom"],
          days: 3,
        }),
      ).resolves.toEqual({
        synced: 1,
        failed: 0,
        skipped: 0,
        quotesSynced: 2,
        failures: [],
        skippedReasons: [],
      });

      expect(requests).toEqual([
        expect.objectContaining({
          url: "https://prices.example.test/history/{SYMBOL}?from={FROM}&to={TO}",
          symbol: "FUND.TO",
          currency: "CAD",
          from: "2026-01-12",
          to: "2026-01-15",
        }),
      ]);
      expect(readQuote(db, "stale-custom-quote")).toBeNull();
      expect(readQuote(db, "manual-custom-quote")).toMatchObject({ close: "88" });
      expect(readQuoteByDay(db, "asset-custom", "2026-01-12")).toBeNull();
      expect(readQuoteByDay(db, "asset-custom", "2026-01-13")).toMatchObject({
        id: "asset-custom_2026-01-13_CUSTOM_SCRAPER:my-feed",
        source: "CUSTOM_SCRAPER:my-feed",
        open: "10",
        high: "10.5",
        low: "9.75",
        close: "10.25",
        volume: "1000",
        currency: "CAD",
        timestamp: "2026-01-13T17:00:00.000Z",
      });
      expect(readQuoteByDay(db, "asset-custom", "2026-01-14")).toMatchObject({
        id: "asset-custom_2026-01-14_CUSTOM_SCRAPER:my-feed",
        close: "11.5",
      });
      expect(readSyncState(db, "asset-custom")).toMatchObject({
        data_source: "CUSTOM_SCRAPER:my-feed",
        error_count: 0,
        last_error: null,
      });
    } finally {
      db.close();
    }
  });

  test("falls back to latest custom provider sources during explicit historical backfill without purging history", async () => {
    const db = createMarketDataDb();
    const requests: TestSourceRequest[] = [];
    const latestSource: CustomProviderSource = {
      id: "source-latest",
      providerId: "my-feed",
      kind: "latest",
      format: "json",
      url: "https://prices.example.test/latest/{SYMBOL}",
      pricePath: "$.price",
      datePath: "$.date",
      dateFormat: null,
      currencyPath: "$.currency",
      factor: null,
      invert: null,
      locale: null,
      headers: null,
      openPath: null,
      highPath: null,
      lowPath: null,
      volumePath: null,
      defaultPrice: null,
      dateTimezone: null,
    };
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: (() => {
        throw new Error("Yahoo should not be called");
      }) as typeof fetch,
      now: () => new Date("2026-01-15T23:00:00Z"),
      customProviderService: {
        getSourceByKind(providerCode, kind) {
          expect(providerCode).toBe("my-feed");
          return kind === "latest" ? latestSource : null;
        },
        testSource(request) {
          requests.push(request);
          return {
            success: true,
            statusCode: 200,
            price: 12.75,
            open: null,
            high: null,
            low: null,
            volume: null,
            currency: "CAD",
            date: "2026-01-14",
            error: null,
            rawResponse: null,
            detectedElements: null,
            detectedTables: null,
          };
        },
      },
    });

    try {
      insertAsset(db, {
        id: "asset-custom",
        display_code: "FUND",
        quote_ccy: "CAD",
        instrument_symbol: "FUND",
        instrument_exchange_mic: "XTSE",
        provider_config: JSON.stringify({
          preferred_provider: "CUSTOM_SCRAPER",
          custom_provider_code: "my-feed",
        }),
      });
      insertQuote(db, {
        id: "old-custom-history",
        asset_id: "asset-custom",
        day: "2025-12-31",
        source: "CUSTOM_SCRAPER:my-feed",
        close: "99",
        currency: "CAD",
      });

      await expect(
        service.syncMarketData?.({
          type: "backfill_history",
          asset_ids: ["asset-custom"],
          days: 30,
        }),
      ).resolves.toEqual({
        synced: 1,
        failed: 0,
        skipped: 0,
        quotesSynced: 1,
        failures: [],
        skippedReasons: [],
      });

      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        url: "https://prices.example.test/latest/{SYMBOL}",
        symbol: "FUND",
      });
      expect(requests[0]?.from).toBeUndefined();
      expect(requests[0]?.to).toBeUndefined();
      expect(readQuote(db, "old-custom-history")).toMatchObject({ close: "99" });
      expect(readQuoteByDay(db, "asset-custom", "2026-01-14")).toMatchObject({
        id: "asset-custom_2026-01-14_CUSTOM_SCRAPER:my-feed",
        source: "CUSTOM_SCRAPER:my-feed",
        close: "12.75",
      });
    } finally {
      db.close();
    }
  });

  test("backfills general-purpose custom provider historical quotes by priority", async () => {
    const db = createMarketDataDb();
    const requests: Array<Pick<TestSourceRequest, "url" | "symbol" | "from" | "to">> = [];
    const baseSource: CustomProviderSource = {
      id: "history-base",
      providerId: "base-feed",
      kind: "historical",
      format: "json",
      url: "https://prices.example.test/history/base/{SYMBOL}?from={FROM}&to={TO}",
      pricePath: "$.prices[*].close",
      datePath: "$.prices[*].date",
      dateFormat: null,
      currencyPath: "$.currency",
      factor: null,
      invert: null,
      locale: null,
      headers: null,
      openPath: null,
      highPath: null,
      lowPath: null,
      volumePath: null,
      defaultPrice: null,
      dateTimezone: null,
    };
    const disabledSource: CustomProviderSource = {
      ...baseSource,
      id: "history-disabled",
      providerId: "disabled-feed",
      url: "https://prices.example.test/history/disabled/{SYMBOL}",
    };
    const fixedUrlSource: CustomProviderSource = {
      ...baseSource,
      id: "history-fixed",
      providerId: "fixed-feed",
      url: "https://prices.example.test/history/fixed",
    };
    const failingSource: CustomProviderSource = {
      ...baseSource,
      id: "history-failing",
      providerId: "failing-feed",
      url: "https://prices.example.test/history/failing/{SYMBOL}",
    };
    const successfulSource: CustomProviderSource = {
      ...baseSource,
      id: "history-successful",
      providerId: "successful-feed",
      url: "https://prices.example.test/history/successful/{SYMBOL}?from={FROM}&to={TO}",
    };
    const providers = [
      {
        id: "disabled-feed",
        name: "Disabled Feed",
        description: "",
        enabled: false,
        priority: 1,
        sources: [disabledSource],
      },
      {
        id: "fixed-feed",
        name: "Fixed Feed",
        description: "",
        enabled: true,
        priority: 2,
        sources: [fixedUrlSource],
      },
      {
        id: "failing-feed",
        name: "Failing Feed",
        description: "",
        enabled: true,
        priority: 3,
        sources: [failingSource],
      },
      {
        id: "successful-feed",
        name: "Successful Feed",
        description: "",
        enabled: true,
        priority: 4,
        sources: [successfulSource],
      },
    ];
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: (() => {
        throw new Error("fetch should not be called");
      }) as typeof fetch,
      now: () => new Date("2026-01-15T23:00:00Z"),
      customProviderService: {
        getAll() {
          return providers;
        },
        getSourceByKind() {
          throw new Error("getSourceByKind should not be called for general history");
        },
        testSource() {
          throw new Error("testSource should not be called");
        },
        fetchSourceRows(request) {
          requests.push({
            url: request.url,
            symbol: request.symbol,
            from: request.from,
            to: request.to,
          });
          if (request.url === failingSource.url) {
            return { statusCode: 200, currency: "CAD", rows: [] };
          }
          return {
            statusCode: 200,
            currency: "CAD",
            rows: [
              {
                price: 20.5,
                open: null,
                high: null,
                low: null,
                volume: null,
                date: "2026-01-14",
              },
            ],
          };
        },
      },
    });

    try {
      insertAsset(db, {
        id: "asset-custom",
        display_code: "FUND",
        quote_ccy: "CAD",
        instrument_symbol: "FUND",
        instrument_exchange_mic: "XTSE",
        provider_config: JSON.stringify({
          preferred_provider: "CUSTOM_SCRAPER",
          overrides: {
            "CUSTOM:successful-feed": { type: "equity_symbol", symbol: "FUND.TO" },
          },
        }),
      });
      insertQuote(db, {
        id: "stale-successful-quote",
        asset_id: "asset-custom",
        day: "2025-12-31",
        source: "CUSTOM_SCRAPER:successful-feed",
        close: "99",
        currency: "CAD",
      });

      await expect(
        service.syncMarketData?.({
          type: "backfill_history",
          asset_ids: ["asset-custom"],
          days: 30,
        }),
      ).resolves.toEqual({
        synced: 1,
        failed: 0,
        skipped: 0,
        quotesSynced: 1,
        failures: [],
        skippedReasons: [],
      });
      await expect(
        service.syncMarketData?.({
          type: "backfill_history",
          asset_ids: ["asset-custom"],
          days: 30,
        }),
      ).resolves.toEqual({
        synced: 1,
        failed: 0,
        skipped: 0,
        quotesSynced: 1,
        failures: [],
        skippedReasons: [],
      });
      expect(requests).toEqual([
        {
          url: "https://prices.example.test/history/failing/{SYMBOL}",
          symbol: "FUND",
          from: "2025-12-16",
          to: "2026-01-15",
        },
        {
          url: "https://prices.example.test/history/successful/{SYMBOL}?from={FROM}&to={TO}",
          symbol: "FUND.TO",
          from: "2025-12-16",
          to: "2026-01-15",
        },
        {
          url: "https://prices.example.test/history/failing/{SYMBOL}",
          symbol: "FUND",
          from: "2025-12-16",
          to: "2026-01-15",
        },
        {
          url: "https://prices.example.test/history/successful/{SYMBOL}?from={FROM}&to={TO}",
          symbol: "FUND.TO",
          from: "2025-12-16",
          to: "2026-01-15",
        },
      ]);
      expect(readQuote(db, "stale-successful-quote")).toBeNull();
      expect(readQuoteByDay(db, "asset-custom", "2026-01-14")).toMatchObject({
        id: "asset-custom_2026-01-14_CUSTOM_SCRAPER:successful-feed",
        source: "CUSTOM_SCRAPER:successful-feed",
        close: "20.5",
        currency: "CAD",
      });
      expect(readSyncState(db, "asset-custom")).toMatchObject({
        data_source: "CUSTOM_SCRAPER:successful-feed",
        error_count: 0,
        last_error: null,
      });
    } finally {
      db.close();
    }
  });

  test("falls back to latest general-purpose custom provider sources during historical backfill", async () => {
    const db = createMarketDataDb();
    const requests: TestSourceRequest[] = [];
    const latestSource: CustomProviderSource = {
      id: "latest-general",
      providerId: "general-feed",
      kind: "latest",
      format: "json",
      url: "https://prices.example.test/latest/{SYMBOL}",
      pricePath: "$.price",
      datePath: "$.date",
      dateFormat: null,
      currencyPath: "$.currency",
      factor: null,
      invert: null,
      locale: null,
      headers: null,
      openPath: null,
      highPath: null,
      lowPath: null,
      volumePath: null,
      defaultPrice: null,
      dateTimezone: null,
    };
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: (() => {
        throw new Error("Yahoo should not be called");
      }) as typeof fetch,
      now: () => new Date("2026-01-15T23:00:00Z"),
      customProviderService: {
        getAll() {
          return [
            {
              id: "general-feed",
              name: "General Feed",
              description: "",
              enabled: true,
              priority: 1,
              sources: [latestSource],
            },
          ];
        },
        getSourceByKind() {
          throw new Error("getSourceByKind should not be called for general fallback");
        },
        testSource(request) {
          requests.push(request);
          return {
            success: true,
            statusCode: 200,
            price: 22.25,
            open: null,
            high: null,
            low: null,
            volume: null,
            currency: "CAD",
            date: "2026-01-14",
            error: null,
            rawResponse: null,
            detectedElements: null,
            detectedTables: null,
          };
        },
      },
    });

    try {
      insertAsset(db, {
        id: "asset-custom",
        display_code: "FUND",
        quote_ccy: "CAD",
        instrument_symbol: "FUND",
        instrument_exchange_mic: "XTSE",
        provider_config: JSON.stringify({ preferred_provider: "CUSTOM_SCRAPER" }),
      });
      insertQuote(db, {
        id: "old-general-history",
        asset_id: "asset-custom",
        day: "2025-12-31",
        source: "CUSTOM_SCRAPER:general-feed",
        close: "99",
        currency: "CAD",
      });

      await expect(
        service.syncMarketData?.({
          type: "backfill_history",
          asset_ids: ["asset-custom"],
          days: 30,
        }),
      ).resolves.toMatchObject({
        synced: 1,
        failed: 0,
        skipped: 0,
        quotesSynced: 1,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        url: "https://prices.example.test/latest/{SYMBOL}",
        symbol: "FUND",
      });
      expect(requests[0]?.from).toBeUndefined();
      expect(requests[0]?.to).toBeUndefined();
      expect(readQuote(db, "old-general-history")).toMatchObject({ close: "99" });
      expect(readQuoteByDay(db, "asset-custom", "2026-01-14")).toMatchObject({
        id: "asset-custom_2026-01-14_CUSTOM_SCRAPER:general-feed",
        source: "CUSTOM_SCRAPER:general-feed",
        close: "22.25",
      });
    } finally {
      db.close();
    }
  });

  test("syncs general-purpose custom provider latest quotes by priority", async () => {
    const db = createMarketDataDb();
    const requests: Array<Pick<TestSourceRequest, "url" | "symbol">> = [];
    const baseSource: CustomProviderSource = {
      id: "source-base",
      providerId: "base-feed",
      kind: "latest",
      format: "json",
      url: "https://prices.example.test/base/{SYMBOL}",
      pricePath: "$.price",
      datePath: "$.date",
      dateFormat: null,
      currencyPath: "$.currency",
      factor: null,
      invert: null,
      locale: null,
      headers: null,
      openPath: null,
      highPath: null,
      lowPath: null,
      volumePath: null,
      defaultPrice: null,
      dateTimezone: null,
    };
    const disabledSource: CustomProviderSource = {
      ...baseSource,
      id: "source-disabled",
      providerId: "disabled-feed",
      url: "https://prices.example.test/disabled/{SYMBOL}",
    };
    const fixedUrlSource: CustomProviderSource = {
      ...baseSource,
      id: "source-fixed",
      providerId: "fixed-feed",
      url: "https://prices.example.test/fixed",
    };
    const failingSource: CustomProviderSource = {
      ...baseSource,
      id: "source-failing",
      providerId: "failing-feed",
      url: "https://prices.example.test/failing/{SYMBOL}",
    };
    const successfulSource: CustomProviderSource = {
      ...baseSource,
      id: "source-successful",
      providerId: "successful-feed",
      url: "https://prices.example.test/successful/{SYMBOL}",
    };
    const providers: CustomProviderWithSources[] = [
      {
        id: "disabled-feed",
        name: "Disabled Feed",
        description: "",
        enabled: false,
        priority: 1,
        sources: [disabledSource],
      },
      {
        id: "fixed-feed",
        name: "Fixed Feed",
        description: "",
        enabled: true,
        priority: 2,
        sources: [fixedUrlSource],
      },
      {
        id: "failing-feed",
        name: "Failing Feed",
        description: "",
        enabled: true,
        priority: 3,
        sources: [failingSource],
      },
      {
        id: "successful-feed",
        name: "Successful Feed",
        description: "",
        enabled: true,
        priority: 4,
        sources: [successfulSource],
      },
    ];
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: (() => {
        throw new Error("Yahoo should not be called");
      }) as typeof fetch,
      customProviderService: {
        getAll() {
          return providers;
        },
        getSourceByKind() {
          throw new Error("getSourceByKind should not be called for general-purpose sync");
        },
        testSource(request) {
          requests.push({ url: request.url, symbol: request.symbol });
          if (request.url === failingSource.url) {
            return {
              success: false,
              statusCode: 200,
              price: null,
              open: null,
              high: null,
              low: null,
              volume: null,
              currency: null,
              date: null,
              error: "missing price",
              rawResponse: null,
              detectedElements: null,
              detectedTables: null,
            };
          }
          return {
            success: true,
            statusCode: 200,
            price: 27.5,
            open: null,
            high: null,
            low: null,
            volume: null,
            currency: "CAD",
            date: "2026-01-10",
            error: null,
            rawResponse: null,
            detectedElements: null,
            detectedTables: null,
          };
        },
      },
    });

    try {
      insertAsset(db, {
        id: "asset-general-custom",
        display_code: "FUND",
        quote_ccy: "CAD",
        instrument_symbol: "FUND",
        instrument_exchange_mic: "XTSE",
        provider_config: JSON.stringify({
          preferred_provider: "CUSTOM_SCRAPER",
          overrides: {
            "CUSTOM:successful-feed": { type: "equity_symbol", symbol: "FUND.TO" },
          },
        }),
      });

      await expect(
        service.syncMarketData?.({ type: "incremental", asset_ids: ["asset-general-custom"] }),
      ).resolves.toEqual({
        synced: 1,
        failed: 0,
        skipped: 0,
        quotesSynced: 1,
        failures: [],
        skippedReasons: [],
      });

      expect(requests).toEqual([
        { url: "https://prices.example.test/failing/{SYMBOL}", symbol: "FUND" },
        { url: "https://prices.example.test/successful/{SYMBOL}", symbol: "FUND.TO" },
      ]);
      expect(readQuoteByDay(db, "asset-general-custom", "2026-01-10")).toMatchObject({
        id: "asset-general-custom_2026-01-10_CUSTOM_SCRAPER:successful-feed",
        source: "CUSTOM_SCRAPER:successful-feed",
        close: "27.5",
        currency: "CAD",
      });
      expect(readSyncState(db, "asset-general-custom")).toMatchObject({
        data_source: "CUSTOM_SCRAPER:successful-feed",
        error_count: 0,
        last_error: null,
      });
    } finally {
      db.close();
    }
  });

  test("syncs general-purpose latest quotes from latest historical custom rows", async () => {
    const db = createMarketDataDb();
    const requests: TestSourceRequest[] = [];
    const historicalSource: CustomProviderSource = {
      id: "history-source",
      providerId: "history-feed",
      kind: "historical",
      format: "json",
      url: "https://prices.example.test/history/{SYMBOL}?from={FROM}&to={TO}",
      pricePath: "$.prices[*].close",
      datePath: "$.prices[*].date",
      dateFormat: null,
      currencyPath: "$.currency",
      factor: null,
      invert: null,
      locale: null,
      headers: null,
      openPath: null,
      highPath: null,
      lowPath: null,
      volumePath: null,
      defaultPrice: null,
      dateTimezone: null,
    };
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: (() => {
        throw new Error("Yahoo should not be called");
      }) as typeof fetch,
      now: () => new Date("2026-01-10T00:00:00Z"),
      customProviderService: {
        getAll(): CustomProviderWithSources[] {
          return [
            {
              id: "history-feed",
              name: "History Feed",
              description: "",
              enabled: true,
              priority: 1,
              sources: [historicalSource],
            },
          ];
        },
        getSourceByKind() {
          throw new Error("getSourceByKind should not be called for general-purpose sync");
        },
        testSource() {
          throw new Error("historical latest fallback should use row fetches");
        },
        fetchSourceRows(request) {
          requests.push(request);
          return {
            statusCode: 200,
            currency: "CAD",
            rows: [
              {
                price: 20.5,
                open: null,
                high: null,
                low: null,
                volume: null,
                date: "2026-01-08",
              },
              {
                price: 22.5,
                open: null,
                high: null,
                low: null,
                volume: null,
                date: "2026-01-09",
              },
            ],
          };
        },
      },
    });

    try {
      insertAsset(db, {
        id: "asset-general-history",
        display_code: "FUND",
        quote_ccy: "CAD",
        instrument_symbol: "FUND",
        instrument_exchange_mic: "XTSE",
        provider_config: JSON.stringify({ preferred_provider: "CUSTOM_SCRAPER" }),
      });

      await expect(
        service.syncMarketData?.({ type: "incremental", asset_ids: ["asset-general-history"] }),
      ).resolves.toEqual({
        synced: 1,
        failed: 0,
        skipped: 0,
        quotesSynced: 1,
        failures: [],
        skippedReasons: [],
      });

      expect(requests).toEqual([
        expect.objectContaining({
          url: historicalSource.url,
          symbol: "FUND",
          currency: "CAD",
          from: "2025-10-12",
          to: "2026-01-10",
        }),
      ]);
      expect(readQuoteByDay(db, "asset-general-history", "2026-01-09")).toMatchObject({
        id: "asset-general-history_2026-01-09_CUSTOM_SCRAPER:history-feed",
        source: "CUSTOM_SCRAPER:history-feed",
        close: "22.5",
        currency: "CAD",
      });
      expect(readSyncState(db, "asset-general-history")).toMatchObject({
        data_source: "CUSTOM_SCRAPER:history-feed",
        error_count: 0,
        last_error: null,
      });
    } finally {
      db.close();
    }
  });

  test("syncs broad history for inactive referenced assets without catalog quote purges", async () => {
    const db = createMarketDataDb();
    const fetchImpl = yahooHistoryFetchBySymbol({
      AAPL: {
        result: {
          meta: { currency: "USD" },
          timestamp: [1767484800],
          indicators: { quote: [{ close: [12.5] }] },
        },
      },
      MSFT: {
        result: {
          meta: { currency: "USD" },
          timestamp: [1767484800],
          indicators: { quote: [{ close: [22.5] }] },
        },
      },
    });
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: fetchImpl,
      now: () => new Date("2026-01-06T22:30:00Z"),
    });

    try {
      insertAsset(db, {
        id: "catalog-asset",
        display_code: "AAPL",
        instrument_symbol: "AAPL",
        instrument_exchange_mic: "XNAS",
      });
      insertQuote(db, {
        id: "old-catalog-yahoo",
        asset_id: "catalog-asset",
        day: "2026-01-01",
        source: "YAHOO",
        close: "99",
        currency: "USD",
      });
      insertAsset(db, {
        id: "inactive-asset",
        display_code: "MSFT",
        instrument_symbol: "MSFT",
        instrument_exchange_mic: "XNAS",
        is_active: 0,
      });
      insertSyncState(db, {
        asset_id: "inactive-asset",
        last_synced_at: "2026-01-01T00:00:00.000Z",
      });

      await expect(service.syncHistoryQuotes?.()).resolves.toMatchObject({
        synced: 2,
        failed: 0,
        skipped: 0,
        quotesSynced: 2,
        failures: [],
        skippedReasons: [],
      });

      expect(readQuote(db, "old-catalog-yahoo")).toMatchObject({
        source: "YAHOO",
        close: "99",
      });
      expect(readQuoteByDay(db, "catalog-asset", "2026-01-04")).toMatchObject({
        source: "YAHOO",
        close: "12.5",
      });
      expect(readQuoteByDay(db, "inactive-asset", "2026-01-04")).toMatchObject({
        source: "YAHOO",
        close: "22.5",
      });
      expect(readSyncState(db, "catalog-asset")).toMatchObject({
        created_at: expect.stringMatching(/\+00:00$/),
        updated_at: expect.stringMatching(/\+00:00$/),
      });
      expect(readSyncState(db, "inactive-asset")).toMatchObject({
        data_source: "YAHOO",
        error_count: 0,
        last_error: null,
        updated_at: expect.stringMatching(/\+00:00$/),
      });
    } finally {
      db.close();
    }
  });

  test("syncs targeted Yahoo quotes and resets quote sync state", async () => {
    const db = createMarketDataDb();
    const fetchImpl = yahooHistoryFetch("AAPL", {
      meta: { currency: "USD" },
      timestamp: [1767571200],
      indicators: {
        quote: [{ open: [10], high: [11], low: [9], close: [10.5], volume: [12345] }],
        adjclose: [{ adjclose: [10.25] }],
      },
    });
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: fetchImpl,
      now: () => new Date("2026-01-06T22:30:00Z"),
    });

    try {
      insertAsset(db, {
        id: "asset-1",
        display_code: "AAPL",
        instrument_symbol: "AAPL",
        instrument_exchange_mic: "XNAS",
        provider_config: JSON.stringify({ preferred_provider: "YAHOO" }),
      });
      insertSyncState(db, {
        asset_id: "asset-1",
        data_source: "YAHOO",
        error_count: 2,
        last_error: "previous failure",
      });

      await expect(
        service.syncMarketData?.({ type: "incremental", asset_ids: ["asset-1"] }),
      ).resolves.toMatchObject({
        synced: 1,
        failed: 0,
        skipped: 0,
        quotesSynced: 1,
        failures: [],
        skippedReasons: [],
      });

      expect(readQuoteByDay(db, "asset-1", "2026-01-05")).toMatchObject({
        id: "asset-1_2026-01-05_YAHOO",
        source: "YAHOO",
        close: "10.5",
        adjclose: "10.25",
        volume: "12345",
        currency: "USD",
      });
      expect(readSyncState(db, "asset-1")).toMatchObject({
        asset_id: "asset-1",
        data_source: "YAHOO",
        error_count: 0,
        last_error: null,
        last_synced_at: expect.stringMatching(/\+00:00$/),
        updated_at: expect.stringMatching(/\+00:00$/),
      });
    } finally {
      db.close();
    }
  });

  test("backfill purges only provider quotes and normalizes Yahoo minor currencies", async () => {
    const db = createMarketDataDb();
    const fetchImpl = yahooHistoryFetch("VOD.L", {
      meta: { currency: "GBp" },
      timestamp: [1767484800],
      indicators: {
        quote: [{ open: [120], high: [130], low: [119], close: [123.45], volume: [987] }],
        adjclose: [{ adjclose: [121.5] }],
      },
    });
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: fetchImpl,
      now: () => new Date("2026-01-06T18:00:00Z"),
    });

    try {
      insertAsset(db, {
        id: "asset-1",
        display_code: "VOD",
        quote_ccy: "GBP",
        instrument_symbol: "VOD",
        instrument_exchange_mic: "XLON",
        provider_config: JSON.stringify({ preferred_provider: "YAHOO" }),
      });
      insertQuote(db, {
        id: "old-yahoo",
        asset_id: "asset-1",
        day: "2026-01-01",
        source: "YAHOO",
        close: "99",
        currency: "GBP",
      });
      insertQuote(db, {
        id: "broker-quote",
        asset_id: "asset-1",
        day: "2026-01-02",
        source: "BROKER",
        close: "88",
        currency: "GBP",
      });
      insertQuote(db, {
        id: "manual-quote",
        asset_id: "asset-1",
        day: "2026-01-03",
        source: "MANUAL",
        close: "77",
        currency: "GBP",
      });

      const syncResult = await service.syncMarketData?.({
        type: "backfill_history",
        asset_ids: ["asset-1"],
        days: 7,
      });
      expect(syncResult).toMatchObject({ synced: 1, failed: 0, failures: [] });

      expect(readQuote(db, "old-yahoo")).toBeNull();
      expect(readQuote(db, "broker-quote")).not.toBeNull();
      expect(readQuote(db, "manual-quote")).not.toBeNull();
      expect(readQuoteByDay(db, "asset-1", "2026-01-04")).toMatchObject({
        source: "YAHOO",
        open: "1.2",
        high: "1.3",
        low: "1.19",
        close: "1.2345",
        adjclose: "1.215",
        currency: "GBP",
      });
    } finally {
      db.close();
    }
  });

  test("normalizes Yahoo KWF historical prices with Rust factor", async () => {
    const db = createMarketDataDb();
    const fetchImpl = yahooHistoryFetch("KWFTEST", {
      meta: { currency: "KWF" },
      timestamp: [1767484800],
      indicators: {
        quote: [{ open: [1200], high: [1300], low: [1190], close: [1234], volume: [987] }],
        adjclose: [{ adjclose: [1215] }],
      },
    });
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: fetchImpl,
      now: () => new Date("2026-01-06T18:00:00Z"),
    });

    try {
      insertAsset(db, {
        id: "asset-kwf",
        display_code: "KWFTEST",
        quote_ccy: "KWD",
        instrument_symbol: "KWFTEST",
        instrument_exchange_mic: "XNAS",
        provider_config: JSON.stringify({ preferred_provider: "YAHOO" }),
      });

      const syncResult = await service.syncMarketData?.({
        type: "backfill_history",
        asset_ids: ["asset-kwf"],
        days: 7,
      });
      expect(syncResult).toMatchObject({ synced: 1, failed: 0, failures: [] });

      expect(readQuoteByDay(db, "asset-kwf", "2026-01-04")).toMatchObject({
        source: "YAHOO",
        open: "1.2",
        high: "1.3",
        low: "1.19",
        close: "1.234",
        adjclose: "1.215",
        currency: "KWD",
      });
    } finally {
      db.close();
    }
  });

  test("preserves provider quotes when backfill returns an empty provider window", async () => {
    const db = createMarketDataDb();
    const fetchImpl = yahooHistoryFetch("AAPL", null, {
      code: "Bad Request",
      description: "Data doesn't exist for startDate = 1767052800",
    });
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: fetchImpl,
      now: () => new Date("2026-01-06T22:30:00Z"),
    });

    try {
      insertAsset(db, {
        id: "asset-1",
        display_code: "AAPL",
        instrument_symbol: "AAPL",
        instrument_exchange_mic: "XNAS",
        provider_config: JSON.stringify({ preferred_provider: "YAHOO" }),
      });
      insertQuote(db, {
        id: "old-yahoo",
        asset_id: "asset-1",
        day: "2026-01-01",
        source: "YAHOO",
        close: "99",
        currency: "USD",
      });

      await service.syncMarketData?.({
        type: "backfill_history",
        asset_ids: ["asset-1"],
        days: 7,
      });

      expect(readQuote(db, "old-yahoo")).toMatchObject({
        source: "YAHOO",
        close: "99",
      });
      expect(readSyncState(db, "asset-1")).toMatchObject({
        error_count: 0,
        last_error: null,
      });
    } finally {
      db.close();
    }
  });

  test("records targeted Yahoo sync failures without throwing", async () => {
    const db = createMarketDataDb();
    const fetchImpl = yahooHistoryFetch("BAD", null, {
      code: "Not Found",
      description: "No data found, symbol may be delisted",
    });
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: fetchImpl,
      now: () => new Date("2026-01-06T22:30:00Z"),
    });

    try {
      insertAsset(db, {
        id: "asset-1",
        display_code: "BAD",
        instrument_symbol: "BAD",
        instrument_exchange_mic: "XNAS",
        provider_config: JSON.stringify({ preferred_provider: "YAHOO" }),
      });

      await expect(
        service.syncMarketData?.({ type: "incremental", asset_ids: ["asset-1"] }),
      ).resolves.toMatchObject({
        synced: 0,
        failed: 1,
        skipped: 0,
        quotesSynced: 0,
        failures: [["BAD", "Symbol not found: BAD"]],
        skippedReasons: [],
      });

      expect(
        db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM quotes").get()?.count,
      ).toBe(0);
      expect(readSyncState(db, "asset-1")).toMatchObject({
        data_source: "YAHOO",
        error_count: 1,
        last_error: "Symbol not found: BAD",
      });
    } finally {
      db.close();
    }
  });

  test("refreshes Yahoo crumbs after unauthorized targeted sync responses", async () => {
    const db = createMarketDataDb();
    let chartCalls = 0;
    let cookieCalls = 0;
    const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "https://fc.yahoo.com") {
        cookieCalls += 1;
        return Promise.resolve(
          new Response("", {
            headers: { "set-cookie": `B=yahoo-history-${cookieCalls}; Path=/; Secure` },
          }),
        );
      }
      if (url === "https://query1.finance.yahoo.com/v1/test/getcrumb") {
        return Promise.resolve(new Response(`history-crumb-${cookieCalls}`));
      }
      if (url.startsWith("https://query1.finance.yahoo.com/v8/finance/chart/AAPL?")) {
        chartCalls += 1;
        if (chartCalls === 1) {
          expect((init?.headers as Record<string, string>).Cookie).toBe("B=yahoo-history-1");
          return Promise.resolve(new Response("", { status: 401, statusText: "Unauthorized" }));
        }
        expect((init?.headers as Record<string, string>).Cookie).toBe("B=yahoo-history-2");
        return Promise.resolve(
          Response.json({
            chart: {
              result: [
                {
                  meta: { currency: "USD" },
                  timestamp: [1767571200],
                  indicators: {
                    quote: [{ close: [10] }],
                  },
                },
              ],
              error: null,
            },
          }),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: fetchImpl,
      now: () => new Date("2026-01-06T22:30:00Z"),
    });

    try {
      insertAsset(db, {
        id: "asset-1",
        display_code: "AAPL",
        instrument_symbol: "AAPL",
        instrument_exchange_mic: "XNAS",
        provider_config: JSON.stringify({ preferred_provider: "YAHOO" }),
      });

      await service.syncMarketData?.({ type: "incremental", asset_ids: ["asset-1"] });

      expect(cookieCalls).toBe(2);
      expect(chartCalls).toBe(2);
      expect(readQuoteByDay(db, "asset-1", "2026-01-05")).toMatchObject({
        close: "10",
      });
    } finally {
      db.close();
    }
  });

  test("syncs targeted Boerse Frankfurt quotes through exact-MIC ISIN search", async () => {
    const db = createMarketDataDb();
    const calls: string[] = [];
    const fetchImpl = boerseTestFetch({
      calls,
      search: {
        SAP: [
          {
            symbol: "XFRA:WRONG0000001",
            description: "Wrong venue",
            exchange: "Frankfurt",
            type: "Aktie",
          },
          {
            symbol: "XETR:DE0007164600",
            description: "SAP SE",
            exchange: "Xetra",
            type: "Aktie",
          },
        ],
      },
      history: {
        "XETR:DE0007164600": {
          s: "ok",
          t: [1767571200],
          o: [68.45],
          h: [70.2],
          l: [68.38],
          c: [70.02],
          v: [11292866.27],
        },
      },
    });
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: fetchImpl,
      now: () => new Date("2026-01-06T22:30:00Z"),
    });

    try {
      insertAsset(db, {
        id: "asset-sap",
        display_code: "SAP",
        quote_ccy: "EUR",
        instrument_symbol: "SAP",
        instrument_exchange_mic: "XETR",
        provider_config: JSON.stringify({ preferred_provider: "BOERSE_FRANKFURT" }),
      });

      await expect(
        service.syncMarketData?.({ type: "incremental", asset_ids: ["asset-sap"] }),
      ).resolves.toMatchObject({
        synced: 1,
        failed: 0,
        skipped: 0,
        quotesSynced: 1,
      });

      const historyUrl = new URL(calls[1] ?? "");
      expect(calls[0]).toBe(
        "https://api.live.deutsche-boerse.com/v1/tradingview/search?query=SAP&limit=5",
      );
      expect(historyUrl.pathname).toBe("/v1/tradingview/history");
      expect(historyUrl.searchParams.get("symbol")).toBe("XETR:DE0007164600");
      expect(historyUrl.searchParams.get("resolution")).toBe("1D");
      expect(historyUrl.searchParams.get("from")).toMatch(/^\d{10}$/);
      expect(historyUrl.searchParams.get("to")).toMatch(/^\d{10}$/);
      expect(readQuoteByDay(db, "asset-sap", "2026-01-05")).toMatchObject({
        id: "asset-sap_2026-01-05_BOERSE_FRANKFURT",
        source: "BOERSE_FRANKFURT",
        open: "68.45",
        high: "70.2",
        low: "68.38",
        close: "70.02",
        adjclose: "70.02",
        volume: "11292866.27",
        currency: "EUR",
      });
      expect(readSyncState(db, "asset-sap")).toMatchObject({
        data_source: "BOERSE_FRANKFURT",
        error_count: 0,
        last_error: null,
      });
    } finally {
      db.close();
    }
  });

  test("records Boerse Frankfurt search HTTP failures like Rust", async () => {
    const db = createMarketDataDb();
    const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(url).toBe(
        "https://api.live.deutsche-boerse.com/v1/tradingview/search?query=SAP&limit=5",
      );
      expect((init?.headers as Record<string, string>)["User-Agent"]).toContain("Mozilla");
      return Promise.resolve(
        new Response("", {
          status: 509,
          statusText: "Bandwidth Limit Exceeded",
        }),
      );
    }) as typeof fetch;
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: fetchImpl,
      now: () => new Date("2026-01-06T22:30:00Z"),
    });

    try {
      insertAsset(db, {
        id: "asset-sap",
        display_code: "SAP",
        quote_ccy: "EUR",
        instrument_symbol: "SAP",
        instrument_exchange_mic: "XETR",
        provider_config: JSON.stringify({ preferred_provider: "BOERSE_FRANKFURT" }),
      });

      await expect(
        service.syncMarketData?.({ type: "incremental", asset_ids: ["asset-sap"] }),
      ).resolves.toMatchObject({
        synced: 0,
        failed: 1,
        failures: [["SAP", "BOERSE_FRANKFURT: Search returned HTTP 509 <unknown status code>"]],
      });
      expect(readSyncState(db, "asset-sap")).toMatchObject({
        data_source: "BOERSE_FRANKFURT",
        error_count: 1,
        last_error: "BOERSE_FRANKFURT: Search returned HTTP 509 <unknown status code>",
      });
    } finally {
      db.close();
    }
  });

  test("treats Boerse Frankfurt no-data history as a clean zero-quote sync", async () => {
    const db = createMarketDataDb();
    const fetchImpl = boerseTestFetch({
      history: {
        "XETR:DE0007164600": {
          s: "no_data",
        },
      },
    });
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: fetchImpl,
      now: () => new Date("2026-01-06T22:30:00Z"),
    });

    try {
      insertAsset(db, {
        id: "asset-sap",
        display_code: "SAP",
        quote_ccy: "EUR",
        instrument_symbol: "DE0007164600",
        instrument_exchange_mic: "XETR",
        provider_config: JSON.stringify({ preferred_provider: "BOERSE_FRANKFURT" }),
      });

      await expect(
        service.syncMarketData?.({ type: "incremental", asset_ids: ["asset-sap"] }),
      ).resolves.toMatchObject({
        synced: 1,
        failed: 0,
        skipped: 0,
        quotesSynced: 0,
        failures: [],
        skippedReasons: [],
      });
      expect(
        db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM quotes").get()?.count,
      ).toBe(0);
      expect(readSyncState(db, "asset-sap")).toMatchObject({
        data_source: "BOERSE_FRANKFURT",
        error_count: 0,
        last_error: null,
      });
    } finally {
      db.close();
    }
  });

  test("scales Boerse Frankfurt bond percentages during historical sync", async () => {
    const db = createMarketDataDb();
    const calls: string[] = [];
    const fetchImpl = boerseTestFetch({
      calls,
      history: {
        "XFRA:XS2530331413": {
          s: "ok",
          t: [1767571200],
          o: [97],
          h: [98],
          l: [96],
          c: [97.025],
          v: [1000],
        },
      },
    });
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: fetchImpl,
      now: () => new Date("2026-01-06T22:30:00Z"),
    });

    try {
      insertAsset(db, {
        id: "bond-1",
        display_code: "XS2530331413",
        quote_ccy: "EUR",
        instrument_type: "BOND",
        instrument_symbol: "XS2530331413",
        provider_config: JSON.stringify({ preferred_provider: "BOERSE_FRANKFURT" }),
      });

      await service.syncMarketData?.({ type: "incremental", asset_ids: ["bond-1"] });

      expect(calls).toHaveLength(1);
      expect(new URL(calls[0] ?? "").searchParams.get("symbol")).toBe("XFRA:XS2530331413");
      expect(readQuoteByDay(db, "bond-1", "2026-01-05")).toMatchObject({
        source: "BOERSE_FRANKFURT",
        open: "0.97",
        high: "0.98",
        low: "0.96",
        close: "0.97025",
        adjclose: "0.97025",
        volume: "1000",
        currency: "EUR",
      });
    } finally {
      db.close();
    }
  });

  test("syncs MarketData.app history and current-day supplements with API key auth", async () => {
    const db = createMarketDataDb();
    const calls: string[] = [];
    const fetchImpl = marketDataAppTestFetch({
      calls,
      candles: {
        AAPL: {
          s: "ok",
          t: [1767571200],
          c: [10.5],
        },
      },
      prices: {
        AAPL: {
          s: "ok",
          mid: [11.25],
          updated: [1767657600],
        },
      },
    });
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: fetchImpl,
      now: () => new Date("2026-01-06T22:30:00Z"),
      secretService: testSecretService("MARKETDATA_APP", "test-key"),
    });

    try {
      insertAsset(db, {
        id: "asset-marketdata",
        display_code: "AAPL",
        quote_ccy: "EUR",
        instrument_symbol: "WRONG",
        instrument_exchange_mic: "XNAS",
        provider_config: JSON.stringify({
          preferred_provider: "MARKETDATA_APP",
          overrides: { MARKETDATA_APP: { symbol: "AAPL" } },
        }),
      });

      await expect(
        service.syncMarketData?.({ type: "incremental", asset_ids: ["asset-marketdata"] }),
      ).resolves.toMatchObject({
        synced: 1,
        failed: 0,
        skipped: 0,
        quotesSynced: 2,
      });

      const candlesUrl = new URL(calls[0] ?? "");
      const latestUrl = new URL(calls[1] ?? "");
      expect(candlesUrl.pathname).toBe("/v1/stocks/candles/D/AAPL");
      expect(candlesUrl.searchParams.get("from")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(candlesUrl.searchParams.get("to")).toBe("2026-01-06");
      expect(latestUrl.pathname).toBe("/v1/stocks/prices/AAPL/");
      expect(readQuoteByDay(db, "asset-marketdata", "2026-01-05")).toMatchObject({
        id: "asset-marketdata_2026-01-05_MARKETDATA_APP",
        source: "MARKETDATA_APP",
        open: "10.5",
        high: "10.5",
        low: "10.5",
        close: "10.5",
        adjclose: "10.5",
        volume: null,
        currency: "USD",
      });
      expect(readQuoteByDay(db, "asset-marketdata", "2026-01-06")).toMatchObject({
        source: "MARKETDATA_APP",
        close: "11.25",
        currency: "USD",
      });
      expect(readSyncState(db, "asset-marketdata")).toMatchObject({
        data_source: "MARKETDATA_APP",
        error_count: 0,
        last_error: null,
      });
    } finally {
      db.close();
    }
  });

  test("records MarketData.app sync failures when the API key is missing", async () => {
    const db = createMarketDataDb();
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: (() => Promise.reject(new Error("fetch should not be called"))) as typeof fetch,
      now: () => new Date("2026-01-06T22:30:00Z"),
    });

    try {
      insertAsset(db, {
        id: "asset-marketdata",
        display_code: "AAPL",
        instrument_symbol: "AAPL",
        instrument_exchange_mic: "XNAS",
        provider_config: JSON.stringify({ preferred_provider: "MARKETDATA_APP" }),
      });

      await expect(
        service.syncMarketData?.({ type: "incremental", asset_ids: ["asset-marketdata"] }),
      ).resolves.toMatchObject({
        synced: 0,
        failed: 1,
        skipped: 0,
        quotesSynced: 0,
        failures: [["AAPL", "MARKETDATA_APP API key not configured"]],
      });
      expect(readSyncState(db, "asset-marketdata")).toMatchObject({
        data_source: "MARKETDATA_APP",
        error_count: 1,
        last_error: "MARKETDATA_APP API key not configured",
      });
    } finally {
      db.close();
    }
  });

  test("syncs Alpha Vantage equity, FX, and crypto quotes with API key auth", async () => {
    const db = createMarketDataDb();
    const calls: string[] = [];
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: alphaVantageTestFetch({
        calls,
        responses: {
          "TIME_SERIES_DAILY:AAPL.TRT": {
            Information: "non-rate informational message",
            "Time Series (Daily)": {
              "not-a-date": {
                "1. open": "1",
                "2. high": "2",
                "3. low": "0.5",
                "4. close": "1.5",
                "5. volume": "100",
              },
              "2026-01-05": {
                "1. open": "10",
                "2. high": "12",
                "3. low": "9",
                "4. close": "11",
                "5. volume": "123456",
              },
            },
          },
          "FX_DAILY:EUR:USD": {
            "Time Series FX (Daily)": {
              "2026-01-05": {
                "1. open": "1.1",
                "2. high": "1.3",
                "3. low": "1.0",
                "4. close": "1.2",
              },
            },
          },
          "DIGITAL_CURRENCY_DAILY:BTC:CAD": {
            "Time Series (Digital Currency Daily)": {
              "2026-01-05": {
                "1a. open (CAD)": "140",
                "1b. open (USD)": "100",
                "2a. high (CAD)": "168",
                "2b. high (USD)": "120",
                "3a. low (CAD)": "126",
                "3b. low (USD)": "90",
                "4a. close (CAD)": "154",
                "4b. close (USD)": "110",
                "5. volume": "7",
              },
            },
          },
        },
      }),
      now: () => new Date("2026-01-06T22:30:00Z"),
      secretService: testSecretService("ALPHA_VANTAGE", "alpha-key"),
    });

    try {
      insertAsset(db, {
        id: "alpha-equity",
        display_code: "AAPL",
        quote_ccy: "USD",
        instrument_symbol: "AAPL",
        instrument_exchange_mic: "XTSE",
        provider_config: JSON.stringify({ preferred_provider: "ALPHA_VANTAGE" }),
      });
      insertAsset(db, {
        id: "alpha-fx",
        kind: "FX",
        display_code: "EUR/USD",
        quote_ccy: "USD",
        instrument_type: "FX",
        instrument_symbol: "EUR",
        provider_config: JSON.stringify({
          preferred_provider: "ALPHA_VANTAGE",
          overrides: { ALPHA_VANTAGE: { type: "fx_pair", from: "EUR", to: "USD" } },
        }),
      });
      insertAsset(db, {
        id: "alpha-crypto",
        display_code: "BTC-CAD",
        quote_ccy: "CAD",
        instrument_type: "CRYPTO",
        instrument_symbol: "BTC",
        provider_config: JSON.stringify({
          preferred_provider: "ALPHA_VANTAGE",
          overrides: { ALPHA_VANTAGE: { type: "crypto_pair", symbol: "BTC", market: "CAD" } },
        }),
      });
      await expect(
        service.syncMarketData?.({
          type: "incremental",
          asset_ids: ["alpha-equity", "alpha-fx", "alpha-crypto"],
        }),
      ).resolves.toMatchObject({
        synced: 3,
        failed: 0,
        skipped: 0,
        quotesSynced: 3,
        failures: [],
      });

      expect(calls).toEqual([
        "TIME_SERIES_DAILY:AAPL.TRT:compact",
        "FX_DAILY:EUR:USD:full",
        "DIGITAL_CURRENCY_DAILY:BTC:CAD",
      ]);
      expect(readQuoteByDay(db, "alpha-equity", "2026-01-05")).toMatchObject({
        id: "alpha-equity_2026-01-05_ALPHA_VANTAGE",
        source: "ALPHA_VANTAGE",
        open: "10",
        high: "12",
        low: "9",
        close: "11",
        volume: "123456",
        currency: "CAD",
      });
      expect(readQuoteByDay(db, "alpha-fx", "2026-01-05")).toMatchObject({
        source: "ALPHA_VANTAGE",
        close: "1.2",
        volume: null,
        currency: "USD",
      });
      expect(readQuoteByDay(db, "alpha-crypto", "2026-01-05")).toMatchObject({
        source: "ALPHA_VANTAGE",
        open: "140",
        high: "168",
        low: "126",
        close: "154",
        volume: "7",
        currency: "CAD",
      });
    } finally {
      db.close();
    }
  });

  test("syncs Finnhub FX and crypto candles with Rust provider symbols", async () => {
    const db = createMarketDataDb();
    const calls: string[] = [];
    const fetchImpl = finnhubTestFetch({
      calls,
      candles: {
        "OANDA:EUR_USD": {
          s: "ok",
          t: [1767571200],
          o: [1.1],
          h: [1.2],
          l: [1.0],
          c: [1.15],
          v: [0],
        },
        "BINANCE:BTCUSDT": {
          s: "ok",
          t: [1767571200],
          o: [43000],
          h: [45000],
          l: [42000],
          c: [44000],
          v: [12],
        },
      },
    });
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: fetchImpl,
      now: () => new Date("2026-01-06T22:30:00Z"),
      secretService: testSecretService("FINNHUB", "finnhub-key"),
    });

    try {
      insertAsset(db, {
        id: "asset-finnhub-fx",
        display_code: "EURUSD",
        quote_ccy: "USD",
        instrument_type: "FX",
        instrument_symbol: "EUR",
        provider_config: JSON.stringify({ preferred_provider: "FINNHUB" }),
      });
      insertAsset(db, {
        id: "asset-finnhub-crypto",
        display_code: "BTC-USDT",
        quote_ccy: "USDT",
        instrument_type: "CRYPTO",
        instrument_symbol: "BTC",
        provider_config: JSON.stringify({ preferred_provider: "FINNHUB" }),
      });

      await expect(
        service.syncMarketData?.({
          type: "incremental",
          asset_ids: ["asset-finnhub-fx", "asset-finnhub-crypto"],
        }),
      ).resolves.toMatchObject({
        synced: 2,
        failed: 0,
        skipped: 0,
        quotesSynced: 2,
      });

      expect(
        calls.map((call) => {
          const url = new URL(call);
          return `${url.pathname}:${url.searchParams.get("symbol") ?? ""}`;
        }),
      ).toEqual(["/api/v1/forex/candle:OANDA:EUR_USD", "/api/v1/crypto/candle:BINANCE:BTCUSDT"]);
      expect(readQuoteByDay(db, "asset-finnhub-fx", "2026-01-05")).toMatchObject({
        source: "FINNHUB",
        close: "1.15",
        currency: "USD",
      });
      expect(readQuoteByDay(db, "asset-finnhub-crypto", "2026-01-05")).toMatchObject({
        source: "FINNHUB",
        close: "44000",
        currency: "USDT",
      });
    } finally {
      db.close();
    }
  });

  test("records Alpha Vantage rate-limit sync failures", async () => {
    const db = createMarketDataDb();
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: alphaVantageTestFetch({
        responses: {
          "TIME_SERIES_DAILY:AAPL": {
            Information: "API call frequency is 5 calls per minute and 25 calls per day.",
          },
        },
      }),
      secretService: testSecretService("ALPHA_VANTAGE", "alpha-key"),
    });

    try {
      insertAsset(db, {
        id: "alpha-rate-limit",
        display_code: "AAPL",
        instrument_symbol: "AAPL",
        provider_config: JSON.stringify({ preferred_provider: "ALPHA_VANTAGE" }),
      });

      await expect(
        service.syncMarketData?.({ type: "incremental", asset_ids: ["alpha-rate-limit"] }),
      ).resolves.toMatchObject({
        synced: 0,
        failed: 1,
        quotesSynced: 0,
        failures: [["AAPL", "ALPHA_VANTAGE: rate limited"]],
      });
      expect(readSyncState(db, "alpha-rate-limit")).toMatchObject({
        data_source: "ALPHA_VANTAGE",
        error_count: 1,
        last_error: "ALPHA_VANTAGE: rate limited",
      });
    } finally {
      db.close();
    }
  });

  test("syncs Metal Price API timeframe quotes with API key auth", async () => {
    const db = createMarketDataDb();
    const calls: string[] = [];
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: metalPriceApiTestFetch({
        calls,
        responses: {
          "timeframe:USD:XAU": {
            success: true,
            rates: {
              "2026-01-05": { XAU: 0.0005 },
            },
          },
        },
      }),
      now: () => new Date("2026-01-06T22:30:00Z"),
      secretService: testSecretService("METAL_PRICE_API", "metal-key"),
    });

    try {
      insertAsset(db, {
        id: "metal-gold",
        display_code: "XAU",
        quote_ccy: "USD",
        instrument_type: "METAL",
        instrument_symbol: "XAU",
        provider_config: JSON.stringify({ preferred_provider: "METAL_PRICE_API" }),
      });

      await expect(
        service.syncMarketData?.({ type: "incremental", asset_ids: ["metal-gold"] }),
      ).resolves.toMatchObject({
        synced: 1,
        failed: 0,
        skipped: 0,
        quotesSynced: 1,
      });

      expect(calls).toEqual(["timeframe:USD:XAU:2025-11-22:2026-01-06"]);
      expect(readQuoteByDay(db, "metal-gold", "2026-01-05")).toMatchObject({
        id: "metal-gold_2026-01-05_METAL_PRICE_API",
        source: "METAL_PRICE_API",
        open: null,
        high: null,
        low: null,
        close: "2000",
        adjclose: "2000",
        volume: null,
        currency: "USD",
      });
      expect(readSyncState(db, "metal-gold")).toMatchObject({
        data_source: "METAL_PRICE_API",
        error_count: 0,
        last_error: null,
      });
    } finally {
      db.close();
    }
  });

  test("records Metal Price API empty timeframe responses as failures", async () => {
    const db = createMarketDataDb();
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: metalPriceApiTestFetch({
        responses: {
          "timeframe:USD:XAU": {
            success: true,
            rates: {},
          },
        },
      }),
      now: () => new Date("2026-01-06T22:30:00Z"),
      secretService: testSecretService("METAL_PRICE_API", "metal-key"),
    });

    try {
      insertAsset(db, {
        id: "metal-empty",
        display_code: "XAU",
        quote_ccy: "USD",
        instrument_type: "METAL",
        instrument_symbol: "XAU",
        provider_config: JSON.stringify({ preferred_provider: "METAL_PRICE_API" }),
      });

      await expect(
        service.syncMarketData?.({ type: "incremental", asset_ids: ["metal-empty"] }),
      ).resolves.toMatchObject({
        synced: 0,
        failed: 1,
        quotesSynced: 0,
      });
      expect(readSyncState(db, "metal-empty")?.last_error).toContain(
        "Timeframe API request failed",
      );
    } finally {
      db.close();
    }
  });

  test("syncs US Treasury calculated bond quotes from Treasury yield curves", async () => {
    const db = createMarketDataDb();
    const calls: string[] = [];
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: usTreasuryTestFetch({
        calls,
        responses: {
          "2026": treasuryCurveXml([
            { date: "bad-date", yields: { BC_1YEAR: 4 } },
            {
              date: "2026-01-05",
              yields: { BC_1YEAR: 4, BC_2YEAR: 4, BC_5YEAR: 4, BC_10YEAR: 4 },
            },
            {
              date: "2026-01-06",
              yields: { BC_1YEAR: 4.1, BC_2YEAR: 4.1, BC_5YEAR: 4.1, BC_10YEAR: 4.1 },
            },
          ]),
        },
      }),
      now: () => new Date("2026-01-06T22:30:00Z"),
    });

    try {
      insertAsset(db, {
        id: "treasury-note",
        display_code: "T 5%",
        quote_ccy: "USD",
        instrument_type: "BOND",
        instrument_symbol: "US912810TH12",
        metadata: JSON.stringify({
          bond: {
            maturityDate: "2031-01-05",
            couponRate: 0.05,
            faceValue: 1000,
            couponFrequency: "SEMI_ANNUAL",
          },
        }),
      });

      await expect(
        service.syncMarketData?.({
          type: "refetch_recent",
          asset_ids: ["treasury-note"],
          days: 2,
        }),
      ).resolves.toMatchObject({
        synced: 1,
        failed: 0,
        skipped: 0,
        quotesSynced: 2,
      });

      expect(calls).toEqual(["2026"]);
      const quote = readQuoteByDay(db, "treasury-note", "2026-01-05");
      expect(quote).toMatchObject({
        id: "treasury-note_2026-01-05_US_TREASURY_CALC",
        source: "US_TREASURY_CALC",
        currency: "USD",
        timestamp: "2026-01-05T16:00:00.000Z",
      });
      expect(Number(quote?.close)).toBeGreaterThan(1);
      expect(quote).toMatchObject({
        open: quote?.close,
        high: quote?.close,
        low: quote?.close,
        adjclose: quote?.close,
        volume: null,
      });
      expect(readSyncState(db, "treasury-note")).toMatchObject({
        data_source: "US_TREASURY_CALC",
        error_count: 0,
        last_error: null,
      });
    } finally {
      db.close();
    }
  });

  test("falls back from unsupported preferred provider to US Treasury calculated sync", async () => {
    const db = createMarketDataDb();
    const calls: string[] = [];
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: usTreasuryTestFetch({
        calls,
        responses: {
          "2026": treasuryCurveXml([
            {
              date: "2026-01-05",
              yields: { BC_1YEAR: 4, BC_2YEAR: 4, BC_5YEAR: 4, BC_10YEAR: 4 },
            },
          ]),
        },
      }),
      now: () => new Date("2026-01-06T22:30:00Z"),
    });

    try {
      insertAsset(db, {
        id: "treasury-marketdata-preferred",
        display_code: "T 5%",
        quote_ccy: "USD",
        instrument_type: "BOND",
        instrument_symbol: "US912810TH12",
        provider_config: JSON.stringify({ preferred_provider: "MARKETDATA_APP" }),
        metadata: JSON.stringify({
          bond: {
            maturityDate: "2031-01-05",
            couponRate: 0.05,
            faceValue: 1000,
            couponFrequency: "SEMI_ANNUAL",
          },
        }),
      });
      insertSyncState(db, {
        asset_id: "treasury-marketdata-preferred",
        data_source: "MARKETDATA_APP",
        error_count: 10,
        last_error: "old provider failure",
      });

      await expect(
        service.syncMarketData?.({
          type: "refetch_recent",
          asset_ids: ["treasury-marketdata-preferred"],
          days: 2,
        }),
      ).resolves.toMatchObject({
        synced: 1,
        failed: 0,
        skipped: 0,
        quotesSynced: 1,
        failures: [],
      });

      expect(calls).toEqual(["2026"]);
      expect(readQuoteByDay(db, "treasury-marketdata-preferred", "2026-01-05")).toMatchObject({
        source: "US_TREASURY_CALC",
        currency: "USD",
      });
      expect(readSyncState(db, "treasury-marketdata-preferred")).toMatchObject({
        data_source: "US_TREASURY_CALC",
        error_count: 0,
        last_error: null,
      });
    } finally {
      db.close();
    }
  });

  test("records US Treasury calculated pricing failures for invalid bond inputs", async () => {
    const db = createMarketDataDb();
    const service = createMarketDataService(db, {
      fetch: (() => Promise.reject(new Error("fetch should not be called"))) as typeof fetch,
    });

    try {
      insertAsset(db, {
        id: "treasury-missing-metadata",
        display_code: "US912 missing",
        instrument_type: "BOND",
        instrument_symbol: "US912810TH12",
      });
      insertAsset(db, {
        id: "corporate-explicit-provider",
        display_code: "Corporate",
        instrument_type: "BOND",
        instrument_symbol: "US0378331005",
        provider_config: JSON.stringify({ preferred_provider: "US_TREASURY_CALC" }),
        metadata: JSON.stringify({ bond: { maturityDate: "2031-01-05" } }),
      });

      await expect(
        service.syncMarketData?.({
          type: "incremental",
          asset_ids: ["treasury-missing-metadata", "corporate-explicit-provider"],
        }),
      ).resolves.toMatchObject({
        synced: 0,
        failed: 2,
        quotesSynced: 0,
        failures: [
          ["US912 missing", "Bond metadata (coupon, maturity) required for calculated pricing"],
          ["Corporate", "US0378331005 is not a US Treasury ISIN"],
        ],
      });
      expect(readSyncState(db, "treasury-missing-metadata")).toMatchObject({
        data_source: "US_TREASURY_CALC",
        error_count: 1,
        last_error: "Bond metadata (coupon, maturity) required for calculated pricing",
      });
      expect(readSyncState(db, "corporate-explicit-provider")).toMatchObject({
        data_source: "US_TREASURY_CALC",
        error_count: 1,
        last_error: "US0378331005 is not a US Treasury ISIN",
      });
    } finally {
      db.close();
    }
  });

  test("syncs Finnhub equity candles with token auth and exchange currency", async () => {
    const db = createMarketDataDb();
    const calls: string[] = [];
    const fetchImpl = finnhubTestFetch({
      calls,
      candles: {
        AAPL: {
          s: "ok",
          t: [8640000000001, 1767571200],
          o: [1, 10],
          h: [2, 12],
          l: [0.5, 9],
          c: [1.5, 11],
          v: [100, 123456],
        },
      },
    });
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: fetchImpl,
      now: () => new Date("2026-01-06T22:30:00Z"),
      secretService: testSecretService("FINNHUB", "finnhub-key"),
    });

    try {
      insertAsset(db, {
        id: "asset-finnhub",
        display_code: "AAPL",
        quote_ccy: "EUR",
        instrument_symbol: "WRONG",
        instrument_exchange_mic: "XNAS",
        provider_config: JSON.stringify({
          preferred_provider: "FINNHUB",
          overrides: { FINNHUB: { symbol: "AAPL" } },
        }),
      });

      await expect(
        service.syncMarketData?.({ type: "incremental", asset_ids: ["asset-finnhub"] }),
      ).resolves.toMatchObject({
        synced: 1,
        failed: 0,
        skipped: 0,
        quotesSynced: 1,
      });

      const candleUrl = new URL(calls[0] ?? "");
      expect(candleUrl.pathname).toBe("/api/v1/stock/candle");
      expect(candleUrl.searchParams.get("symbol")).toBe("AAPL");
      expect(candleUrl.searchParams.get("resolution")).toBe("D");
      expect(candleUrl.searchParams.get("from")).toMatch(/^\d{10}$/);
      expect(candleUrl.searchParams.get("to")).toMatch(/^\d{10}$/);
      expect(readQuoteByDay(db, "asset-finnhub", "2026-01-05")).toMatchObject({
        id: "asset-finnhub_2026-01-05_FINNHUB",
        source: "FINNHUB",
        open: "10",
        high: "12",
        low: "9",
        close: "11",
        adjclose: "11",
        volume: "123456",
        currency: "USD",
      });
      expect(readSyncState(db, "asset-finnhub")).toMatchObject({
        data_source: "FINNHUB",
        error_count: 0,
        last_error: null,
      });
    } finally {
      db.close();
    }
  });

  test("leaves manual and inactive assets untouched during targeted sync", async () => {
    const db = createMarketDataDb();
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: (() => Promise.reject(new Error("fetch should not be called"))) as typeof fetch,
    });

    try {
      insertAsset(db, {
        id: "manual-asset",
        quote_mode: "MANUAL",
        instrument_symbol: "MANUAL",
        provider_config: JSON.stringify({ preferred_provider: "YAHOO" }),
      });
      insertAsset(db, {
        id: "inactive-asset",
        is_active: 0,
        instrument_symbol: "INACTIVE",
        provider_config: JSON.stringify({ preferred_provider: "YAHOO" }),
      });
      insertSyncState(db, {
        asset_id: "inactive-asset",
        data_source: "YAHOO",
        error_count: 3,
        last_error: "still present",
      });

      await service.syncMarketData?.({
        type: "incremental",
        asset_ids: ["manual-asset", "inactive-asset"],
      });

      expect(readSyncState(db, "manual-asset")).toBeNull();
      expect(readSyncState(db, "inactive-asset")).toMatchObject({
        error_count: 3,
        last_error: "still present",
      });
    } finally {
      db.close();
    }
  });

  test("returns latest quote snapshots with source priority and market dates", async () => {
    const db = createMarketDataDb();
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      now: () => new Date("2026-01-06T18:00:00Z"),
    });

    try {
      insertAsset(db, {
        id: "asset-1",
        quote_ccy: "GBp",
        instrument_exchange_mic: "XLON",
      });
      insertQuote(db, {
        id: "asset-1_2026-01-06_YAHOO",
        asset_id: "asset-1",
        day: "2026-01-06",
        source: "YAHOO",
        close: "30.00",
        currency: "GBP",
        timestamp: "2026-01-06T16:00:00Z",
      });
      insertQuote(db, {
        id: "asset-1_2026-01-06_BROKER",
        asset_id: "asset-1",
        day: "2026-01-06",
        source: "BROKER",
        close: "35.00",
        currency: "GBP",
        timestamp: "2026-01-06T16:00:00Z",
      });
      insertQuote(db, {
        id: "asset-1_2026-01-06_MANUAL",
        asset_id: "asset-1",
        day: "2026-01-06",
        source: "MANUAL",
        close: "40.00",
        currency: "GBP",
        timestamp: "2026-01-06T16:00:00Z",
      });

      const snapshots = await Promise.resolve(service.getLatestQuotes?.(["asset-1", "asset-1"]));
      expect(snapshots).toEqual({
        "asset-1": {
          quote: expect.objectContaining({
            id: "asset-1_2026-01-06_MANUAL",
            close: 40,
            currency: "GBp",
          }),
          isStale: false,
          effectiveMarketDate: "2026-01-06",
          quoteDate: "2026-01-06",
        },
      });
    } finally {
      db.close();
    }
  });

  test("marks latest quote snapshots stale before market close and on weekends", async () => {
    const db = createMarketDataDb();
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      now: () => new Date("2026-01-10T12:00:00Z"),
    });

    try {
      insertAsset(db, { id: "asset-1", instrument_exchange_mic: "XNAS" });
      insertQuote(db, {
        id: "asset-1_2026-01-08_YAHOO",
        asset_id: "asset-1",
        day: "2026-01-08",
        source: "YAHOO",
        close: "10.00",
        currency: "USD",
        timestamp: "2026-01-08T21:00:00Z",
      });

      const snapshots = await Promise.resolve(service.getLatestQuotes?.(["asset-1"]));
      expect(snapshots).toMatchObject({
        "asset-1": {
          isStale: true,
          effectiveMarketDate: "2026-01-09",
          quoteDate: "2026-01-08",
        },
      });
    } finally {
      db.close();
    }
  });

  test("returns Rust-compatible no quote reasons", async () => {
    const db = createMarketDataDb();
    const service = createMarketDataService(db, { now: () => new Date("2026-01-06T00:00:00Z") });

    try {
      insertAsset(db, { id: "manual", quote_mode: "MANUAL" });
      insertAsset(db, { id: "inactive", is_active: 0 });
      insertAsset(db, {
        id: "matured-bond",
        instrument_type: "BOND",
        metadata: JSON.stringify({ bond: { maturityDate: "2026-01-05" } }),
      });
      insertAsset(db, {
        id: "expired-option",
        instrument_type: "OPTION",
        metadata: JSON.stringify({ option: { expiration: "2026-01-05" } }),
      });
      insertAsset(db, { id: "too-many-errors" });
      insertSyncState(db, { asset_id: "too-many-errors", error_count: 10 });
      insertAsset(db, { id: "last-error" });
      insertSyncState(db, { asset_id: "last-error", error_count: 1, last_error: "rate limited" });
      insertAsset(db, { id: "pending-sync" });
      insertSyncState(db, { asset_id: "pending-sync" });

      const snapshots = await Promise.resolve(
        service.getLatestQuotes?.([
          "manual",
          "inactive",
          "matured-bond",
          "expired-option",
          "too-many-errors",
          "last-error",
          "pending-sync",
          "missing",
        ]),
      );
      expect(
        Object.fromEntries(
          Object.entries(snapshots ?? {}).map(([id, snapshot]) => [
            id,
            snapshot.noQuoteReason?.code,
          ]),
        ),
      ).toEqual({
        manual: "MANUAL_PRICING",
        inactive: "INACTIVE",
        "matured-bond": "MATURED_BOND",
        "expired-option": "EXPIRED_OPTION",
        "too-many-errors": "TOO_MANY_ERRORS",
        "last-error": "LAST_ERROR",
        "pending-sync": "PENDING_SYNC",
        missing: "NO_DATA",
      });
    } finally {
      db.close();
    }
  });

  test("returns ordered quote sync error snapshots with asset fallbacks", () => {
    const db = createMarketDataDb();
    const service = createMarketDataService(db);

    try {
      insertAsset(db, { id: "manual", display_code: "MAN", quote_mode: "MANUAL" });
      insertSyncState(db, { asset_id: "manual", error_count: 9, last_error: "manual ignored" });
      insertSyncState(db, { asset_id: "missing-asset", error_count: 7, last_error: "not found" });
      insertAsset(db, { id: "aapl", display_code: "AAPL" });
      insertSyncState(db, { asset_id: "aapl", error_count: 6, last_error: "rate limited" });
      insertAsset(db, { id: "msft", display_code: null, instrument_symbol: "MSFT" });
      insertQuote(db, {
        id: "msft_2026-05-01_YAHOO",
        asset_id: "msft",
        day: "2026-05-01",
        source: "YAHOO",
        close: "420",
        currency: "USD",
      });
      insertSyncState(db, { asset_id: "msft", error_count: 3, last_error: null });

      expect(service.getQuoteSyncErrorSnapshots?.()).toEqual([
        {
          assetId: "manual",
          symbol: "MAN",
          quoteMode: "MANUAL",
          errorCount: 9,
          lastError: "manual ignored",
          hasSyncedBefore: false,
        },
        {
          assetId: "missing-asset",
          symbol: "missing-asset",
          quoteMode: "MARKET",
          errorCount: 7,
          lastError: "not found",
          hasSyncedBefore: false,
        },
        {
          assetId: "aapl",
          symbol: "AAPL",
          quoteMode: "MARKET",
          errorCount: 6,
          lastError: "rate limited",
          hasSyncedBefore: false,
        },
        {
          assetId: "msft",
          symbol: "MSFT",
          quoteMode: "MARKET",
          errorCount: 3,
          lastError: null,
          hasSyncedBefore: true,
        },
      ]);
    } finally {
      db.close();
    }
  });

  test("updates quote sync position status from current holdings", () => {
    const db = createMarketDataDb();
    const service = createMarketDataService(db, {
      now: () => new Date("2026-05-17T12:00:00Z"),
    });

    try {
      insertAsset(db, { id: "new-open" });
      insertAsset(db, { id: "reactivated-open", is_active: 0 });
      insertAsset(db, { id: "reopened" });
      insertSyncState(db, {
        asset_id: "reopened",
        position_closed_date: "2026-05-01",
        sync_priority: 50,
      });
      insertAsset(db, { id: "closed" });
      insertSyncState(db, { asset_id: "closed", position_closed_date: null, sync_priority: 100 });
      insertAsset(db, { id: "zero-closed" });
      insertSyncState(db, {
        asset_id: "zero-closed",
        position_closed_date: null,
        sync_priority: 100,
      });
      insertAsset(db, { id: "dust-new" });
      insertAsset(db, { id: "dust-closed" });
      insertSyncState(db, {
        asset_id: "dust-closed",
        position_closed_date: null,
        sync_priority: 100,
      });
      insertAsset(db, { id: "manual-open", quote_mode: "MANUAL" });
      insertAsset(db, { id: "fx-open", kind: "FX", is_active: 0 });
      insertSyncState(db, {
        asset_id: "fx-open",
        position_closed_date: "2026-05-01",
        sync_priority: 50,
      });
      insertSyncState(db, { asset_id: "missing-asset", position_closed_date: null });

      service.updatePositionStatusFromHoldings?.(
        new Map([
          ["new-open", "2"],
          ["reactivated-open", "1"],
          ["reopened", "-1"],
          ["zero-closed", "0"],
          ["dust-new", "0.000000001"],
          ["dust-closed", "-0.000000001"],
          ["manual-open", "3"],
          ["fx-open", "4"],
        ]),
      );

      expect(readSyncState(db, "new-open")).toMatchObject({
        position_closed_date: null,
        data_source: "",
        sync_priority: 100,
        error_count: 0,
      });
      expect(readAssetActive(db, "reactivated-open")).toBe(1);
      expect(readSyncState(db, "reactivated-open")).toMatchObject({
        position_closed_date: null,
        sync_priority: 100,
      });
      expect(readSyncState(db, "reopened")).toMatchObject({
        position_closed_date: null,
        sync_priority: 100,
      });
      expect(readSyncState(db, "closed")).toMatchObject({
        position_closed_date: "2026-05-17",
        sync_priority: 50,
      });
      expect(readSyncState(db, "zero-closed")).toMatchObject({
        position_closed_date: "2026-05-17",
        sync_priority: 50,
      });
      expect(readSyncState(db, "dust-new")).toBeNull();
      expect(readSyncState(db, "dust-closed")).toMatchObject({
        position_closed_date: "2026-05-17",
        sync_priority: 50,
      });
      expect(readSyncState(db, "manual-open")).toBeNull();
      expect(readAssetActive(db, "fx-open")).toBe(0);
      expect(readSyncState(db, "fx-open")).toMatchObject({
        position_closed_date: "2026-05-01",
        sync_priority: 50,
      });
      expect(readSyncState(db, "missing-asset")).toMatchObject({
        position_closed_date: null,
      });
    } finally {
      db.close();
    }
  });

  test("checks quote CSV imports with Rust-compatible validation and asset matching", async () => {
    const db = createMarketDataDb();
    const service = createMarketDataService(db, { exchangeCatalogJson: testExchangeCatalogJson() });

    try {
      insertAsset(db, {
        id: "asset-shop",
        display_code: "SHOP",
        instrument_exchange_mic: "XTSE",
      });
      insertAsset(db, { id: "asset-aapl", display_code: "AAPL", instrument_exchange_mic: "XNAS" });

      const quotes = await Promise.resolve(
        service.checkQuotesImport?.(
          bytes(
            [
              "Symbol,Date,Open,High,Low,Close,Volume,Currency",
              'SHOP.TO,2026-01-05,9,10,8,"1,234.56",100,CAD',
              "AAPL,2026-01-06,11,10,9,9.5,,",
              "UNKNOWN,2026-01-07,,,,12,,USD",
              "SHOP,2026-13-01,,,,12,,CAD",
              "SHOP,2026-01-08,,,,,100,CAD",
            ].join("\n"),
          ),
          true,
        ),
      );

      expect(quotes).toEqual([
        {
          symbol: "asset-shop",
          displaySymbol: "SHOP",
          date: "2026-01-05",
          open: 9,
          high: 10,
          low: 8,
          close: 1234.56,
          volume: 100,
          currency: "CAD",
          validationStatus: { warning: "Close price is outside high-low range" },
          errorMessage: null,
        },
        {
          symbol: "asset-aapl",
          displaySymbol: "AAPL",
          date: "2026-01-06",
          open: 11,
          high: 10,
          low: 9,
          close: 9.5,
          volume: null,
          currency: "USD",
          validationStatus: { warning: "Open price is outside high-low range" },
          errorMessage: null,
        },
        expect.objectContaining({
          symbol: "UNKNOWN",
          validationStatus: { error: "Asset not found: 'UNKNOWN'" },
          errorMessage: "Asset not found: 'UNKNOWN'",
        }),
        expect.objectContaining({
          symbol: "SHOP",
          validationStatus: { error: "Invalid date format. Expected YYYY-MM-DD" },
          errorMessage: "Invalid date format. Expected YYYY-MM-DD",
        }),
        expect.objectContaining({
          symbol: "SHOP",
          close: 0,
          validationStatus: { error: "Close price must be greater than 0" },
          errorMessage: "Close price must be greater than 0",
        }),
      ]);
    } finally {
      db.close();
    }
  });

  test("checks quote CSV imports without headers and rejects invalid files", async () => {
    const db = createMarketDataDb();
    const service = createMarketDataService(db, { exchangeCatalogJson: testExchangeCatalogJson() });

    try {
      insertAsset(db, { id: "asset-aapl", display_code: "AAPL", instrument_exchange_mic: "XNAS" });

      await expect(
        Promise.resolve(service.checkQuotesImport?.(bytes("AAPL,2026-01-05,.5"), false)),
      ).resolves.toEqual([
        expect.objectContaining({
          symbol: "asset-aapl",
          displaySymbol: "AAPL",
          close: 0.5,
          currency: "USD",
          validationStatus: "valid",
        }),
      ]);
      expect(() =>
        service.checkQuotesImport?.(bytes("symbol,date\nAAPL,2026-01-05"), true),
      ).toThrow("Missing required columns: close");
      expect(() => service.checkQuotesImport?.(bytes("symbol,date,close\n"), true)).toThrow(
        "CSV file must contain at least one data row",
      );
    } finally {
      db.close();
    }
  });

  test("imports manual quote CSV rows with Rust-compatible upsert semantics", async () => {
    const db = createMarketDataDb();
    const service = createMarketDataService(db);

    try {
      insertQuote(db, {
        id: "provider-existing",
        asset_id: "asset-1",
        day: "2026-01-05",
        source: "YAHOO",
        close: "9.00",
        currency: "USD",
      });
      insertQuote(db, {
        id: "legacy-manual-id",
        asset_id: "asset-1",
        day: "2026-01-06",
        source: "MANUAL",
        close: "10.00",
        currency: "USD",
      });

      await expect(
        Promise.resolve(
          service.importQuotesCsv?.(
            [
              {
                symbol: "asset-1",
                date: "2026-01-05",
                close: 11,
                currency: "USD",
                validationStatus: "valid",
              },
            ],
            false,
          ),
        ),
      ).resolves.toEqual([
        expect.objectContaining({
          symbol: "asset-1",
          validationStatus: { warning: "Quote already exists" },
          errorMessage: null,
        }),
      ]);
      expect(readQuote(db, "asset-1_2026-01-05_MANUAL")).toBeNull();

      await expect(
        Promise.resolve(
          service.importQuotesCsv?.(
            [
              {
                symbol: "asset-1",
                date: "2026-01-05",
                open: 0,
                high: 12,
                low: 10,
                close: 11,
                volume: 0,
                currency: "USD",
                validationStatus: "valid",
              },
              {
                symbol: "asset-1",
                date: "2026-01-06",
                close: 12.5,
                currency: "USD",
                validationStatus: "valid",
              },
            ],
            true,
          ),
        ),
      ).resolves.toEqual([
        expect.objectContaining({ symbol: "asset-1", validationStatus: "valid" }),
        expect.objectContaining({ symbol: "asset-1", validationStatus: "valid" }),
      ]);
      expect(readQuote(db, "provider-existing")).toMatchObject({ source: "YAHOO" });
      expect(readQuote(db, "asset-1_2026-01-05_MANUAL")).toMatchObject({
        id: "asset-1_2026-01-05_MANUAL",
        asset_id: "asset-1",
        day: "2026-01-05",
        source: "MANUAL",
        open: null,
        high: "12",
        low: "10",
        close: "11",
        adjclose: "11",
        volume: null,
        timestamp: "2026-01-05T12:00:00.000Z",
      });
      expect(readQuote(db, "legacy-manual-id")).toMatchObject({
        id: "legacy-manual-id",
        close: "12.5",
        timestamp: "2026-01-06T12:00:00.000Z",
      });
      expect(readQuote(db, "asset-1_2026-01-06_MANUAL")).toBeNull();
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

  test("queues market-data quote sync callbacks only for UUID manual quote rows", () => {
    const db = createMarketDataDb();
    const syncEvents: QuoteSyncEvent[] = [];
    const service = createMarketDataService(db, {
      queueQuoteSyncEvent: (event) => syncEvents.push(event),
    });

    try {
      const uuidManualId = crypto.randomUUID();
      insertQuote(db, {
        id: uuidManualId,
        asset_id: "EQUITY:AAPL@XNAS",
        day: "2026-01-02",
        source: "MANUAL",
        close: "10.00",
        currency: "USD",
      });
      service.updateQuote?.("EQUITY:AAPL@XNAS", {
        timestamp: "2026-01-02T15:30:00Z",
        dataSource: "MANUAL",
        close: "10.25",
        currency: "USD",
      });
      expect(syncEvents).toEqual([
        {
          quoteId: uuidManualId,
          operation: "Update",
          payload: expect.objectContaining({
            id: uuidManualId,
            assetId: "EQUITY:AAPL@XNAS",
            day: "2026-01-02",
            source: "MANUAL",
            close: "10.25",
          }),
        },
      ]);

      syncEvents.length = 0;
      service.deleteQuote?.(uuidManualId);
      expect(syncEvents).toEqual([
        {
          quoteId: uuidManualId,
          operation: "Delete",
          payload: { id: uuidManualId },
        },
      ]);

      syncEvents.length = 0;
      insertQuote(db, {
        id: "EQUITY:AAPL@XNAS_2026-01-03_MANUAL",
        asset_id: "EQUITY:AAPL@XNAS",
        day: "2026-01-03",
        source: "MANUAL",
        close: "11.00",
        currency: "USD",
      });
      insertQuote(db, {
        id: crypto.randomUUID(),
        asset_id: "EQUITY:AAPL@XNAS",
        day: "2026-01-04",
        source: "YAHOO",
        close: "12.00",
        currency: "USD",
      });
      service.deleteQuote?.("EQUITY:AAPL@XNAS_2026-01-03_MANUAL");
      service.deleteQuote?.(String(readQuoteByDay(db, "EQUITY:AAPL@XNAS", "2026-01-04")?.id));
      expect(syncEvents).toEqual([]);
    } finally {
      db.close();
    }
  });

  test("queues delete when market-data update replaces an explicit UUID manual quote", () => {
    const db = createMarketDataDb();
    const syncEvents: QuoteSyncEvent[] = [];
    const service = createMarketDataService(db, {
      queueQuoteSyncEvent: (event) => syncEvents.push(event),
    });

    try {
      const uuidManualId = crypto.randomUUID();
      insertQuote(db, {
        id: uuidManualId,
        asset_id: "EQUITY:AAPL@XNAS",
        day: "2026-01-02",
        source: "MANUAL",
        close: "10.00",
        currency: "USD",
      });

      service.updateQuote?.("EQUITY:AAPL@XNAS", {
        id: uuidManualId,
        timestamp: "2026-01-02T15:30:00Z",
        dataSource: "MANUAL",
        close: "10.25",
        currency: "USD",
      });

      expect(syncEvents).toEqual([
        {
          quoteId: uuidManualId,
          operation: "Delete",
          payload: { id: uuidManualId },
        },
      ]);
      expect(readQuote(db, uuidManualId)).toBeNull();
      expect(readQuote(db, "EQUITY:AAPL@XNAS_2026-01-02_MANUAL")).toMatchObject({
        close: "10.25",
      });
    } finally {
      db.close();
    }
  });

  test("queues quote sync callbacks for imported rows only when the persisted manual ID is UUID", () => {
    const db = createMarketDataDb();
    const syncEvents: QuoteSyncEvent[] = [];
    const service = createMarketDataService(db, {
      queueQuoteSyncEvent: (event) => syncEvents.push(event),
    });

    try {
      const uuidManualId = crypto.randomUUID();
      insertQuote(db, {
        id: uuidManualId,
        asset_id: "asset-1",
        day: "2026-01-06",
        source: "MANUAL",
        close: "12.00",
        currency: "USD",
      });

      service.importQuotesCsv?.(
        [
          {
            symbol: "asset-1",
            date: "2026-01-05",
            close: 11,
            currency: "USD",
            validationStatus: "valid",
          },
          {
            symbol: "asset-1",
            date: "2026-01-06",
            close: 12.5,
            currency: "USD",
            validationStatus: "valid",
          },
        ],
        true,
      );

      expect(syncEvents).toEqual([
        {
          quoteId: uuidManualId,
          operation: "Update",
          payload: expect.objectContaining({
            id: uuidManualId,
            assetId: "asset-1",
            day: "2026-01-06",
            close: "12.5",
          }),
        },
      ]);
      expect(readQuote(db, "asset-1_2026-01-05_MANUAL")).toMatchObject({ close: "11" });
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
          timestamp: "2026-02-30T00:00:00Z",
          dataSource: "MANUAL",
          close: 10,
          currency: "USD",
        }),
      ).toThrow("Invalid timestamp");
      expect(() =>
        service.updateQuote?.("asset-1", {
          timestamp: "2026-01-01",
          dataSource: "MANUAL",
          close: 10,
          currency: "USD",
        }),
      ).toThrow("Invalid timestamp");
      expect(() =>
        service.updateQuote?.("asset-1", {
          timestamp: "2026-01-01T00:00:00+00",
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

  test("fetches Yahoo dividends with Rust-compatible crumb reuse", async () => {
    const db = createMarketDataDb();
    const calls: string[] = [];
    const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);

      if (url === "https://fc.yahoo.com") {
        return Promise.resolve(
          new Response("", { headers: { "set-cookie": "B=yahoo-cookie; Path=/; Secure" } }),
        );
      }

      if (url === "https://query1.finance.yahoo.com/v1/test/getcrumb") {
        expect((init?.headers as Record<string, string>).Cookie).toBe("B=yahoo-cookie");
        return Promise.resolve(new Response("crumb value"));
      }

      if (url.startsWith("https://query1.finance.yahoo.com/v8/finance/chart/AAPL?")) {
        expect((init?.headers as Record<string, string>).Cookie).toBe("B=yahoo-cookie");
        const parsed = new URL(url);
        expect(parsed.searchParams.get("period1")).toBe("1704153600");
        expect(parsed.searchParams.get("period2")).toBe("1767225600");
        expect(parsed.searchParams.get("interval")).toBe("1d");
        expect(parsed.searchParams.get("events")).toBe("div");
        expect(parsed.searchParams.get("crumb")).toBe("crumb value");
        return Promise.resolve(
          Response.json({
            chart: {
              result: [
                {
                  events: {
                    dividends: {
                      latest: { amount: 0.24, date: 1735689600 },
                      earlier: { amount: 0.22, date: 1704067200 },
                    },
                  },
                },
              ],
              error: null,
            },
          }),
        );
      }

      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;
    const service = createMarketDataService(db, {
      fetch: fetchImpl,
      now: () => new Date("2026-01-01T00:00:00Z"),
    });

    try {
      expect(await service.fetchYahooDividends?.("AAPL")).toEqual([
        { amount: 0.22, date: 1704067200 },
        { amount: 0.24, date: 1735689600 },
      ]);
      expect(await service.fetchYahooDividends?.("AAPL")).toHaveLength(2);
      expect(calls.filter((url) => url === "https://fc.yahoo.com")).toHaveLength(1);
      expect(
        calls.filter((url) => url === "https://query1.finance.yahoo.com/v1/test/getcrumb"),
      ).toHaveLength(1);
      expect(
        calls.filter((url) =>
          url.startsWith("https://query1.finance.yahoo.com/v8/finance/chart/AAPL?"),
        ),
      ).toHaveLength(2);
    } finally {
      db.close();
    }
  });

  test("maps Yahoo dividend errors and clears unauthorized crumbs", async () => {
    const db = createMarketDataDb();
    let chartCallCount = 0;
    const calls: string[] = [];
    const fetchImpl = ((input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);

      if (url === "https://fc.yahoo.com") {
        return Promise.resolve(
          new Response("", { headers: { "set-cookie": `B=yahoo-cookie-${chartCallCount}` } }),
        );
      }
      if (url === "https://query1.finance.yahoo.com/v1/test/getcrumb") {
        return Promise.resolve(new Response(`crumb-${chartCallCount}`));
      }
      if (url.startsWith("https://query1.finance.yahoo.com/v8/finance/chart/AAPL?")) {
        chartCallCount += 1;
        if (chartCallCount === 1) {
          return Promise.resolve(new Response("", { status: 401, statusText: "Unauthorized" }));
        }
        if (chartCallCount === 2) {
          return Promise.resolve(
            Response.json({
              chart: {
                result: null,
                error: { code: "Not Found", description: "No data found, symbol may be delisted" },
              },
            }),
          );
        }
        return Promise.resolve(
          Response.json({
            chart: {
              result: null,
              error: {
                code: "Bad Request",
                description: "Data doesn't exist for startDate = 1704153600",
              },
            },
          }),
        );
      }

      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;
    const service = createMarketDataService(db, {
      fetch: fetchImpl,
      now: () => new Date("2026-01-01T00:00:00Z"),
    });

    try {
      await expect(service.fetchYahooDividends?.("AAPL")).rejects.toThrow(
        "Provider error: YAHOO - Yahoo returned 401 Unauthorized",
      );
      await expect(service.fetchYahooDividends?.("AAPL")).rejects.toThrow("Symbol not found: AAPL");
      await expect(service.fetchYahooDividends?.("AAPL")).rejects.toThrow("No data for date range");
      expect(calls.filter((url) => url === "https://fc.yahoo.com")).toHaveLength(2);
      expect(
        calls.filter((url) => url === "https://query1.finance.yahoo.com/v1/test/getcrumb"),
      ).toHaveLength(2);
    } finally {
      db.close();
    }
  });

  test("formats Yahoo HTTP status errors like Rust", async () => {
    for (const { status, statusText, expected } of [
      {
        status: 418,
        statusText: "Custom Teapot",
        expected: "Provider error: YAHOO - Yahoo returned 418 I'm a teapot",
      },
      {
        status: 509,
        statusText: "Bandwidth Limit Exceeded",
        expected: "Provider error: YAHOO - Yahoo returned 509 <unknown status code>",
      },
      {
        status: 520,
        statusText: "Custom Unknown",
        expected: "Provider error: YAHOO - Yahoo returned 520 <unknown status code>",
      },
    ]) {
      const db = createMarketDataDb();
      const fetchImpl = ((input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "https://fc.yahoo.com") {
          return Promise.resolve(new Response("", { headers: { "set-cookie": "B=yahoo-cookie" } }));
        }
        if (url === "https://query1.finance.yahoo.com/v1/test/getcrumb") {
          return Promise.resolve(new Response("crumb"));
        }
        if (url.startsWith("https://query1.finance.yahoo.com/v8/finance/chart/AAPL?")) {
          return Promise.resolve(new Response("", { status, statusText }));
        }
        throw new Error(`unexpected fetch: ${url}`);
      }) as typeof fetch;
      const service = createMarketDataService(db, {
        fetch: fetchImpl,
        now: () => new Date("2026-01-01T00:00:00Z"),
      });

      try {
        await expect(service.fetchYahooDividends?.("AAPL")).rejects.toThrow(expected);
      } finally {
        db.close();
      }
    }
  });

  test("searches existing assets and Yahoo raw results with canonical dedupe", async () => {
    const db = createMarketDataDb();
    const calls: string[] = [];
    const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      expect(url).toBe("https://query2.finance.yahoo.com/v1/finance/search?q=AZN");
      expect((init?.headers as Record<string, string>)["User-Agent"]).toContain("Mozilla/5.0");
      return Promise.resolve(
        Response.json({
          quotes: [
            {
              symbol: "AZN.L",
              exchange: "LSE",
              quoteType: "EQUITY",
              shortname: "AstraZeneca PLC",
              longname: "AstraZeneca PLC",
              score: 9000,
              currency: "GBp",
            },
            {
              symbol: "VFEG.L",
              exchange: "LSE",
              quoteType: "ETF",
              shortname: "Vanguard FTSE Emerging Markets",
              score: 20001,
              currency: "GBP",
            },
          ],
        }),
      );
    }) as typeof fetch;
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: fetchImpl,
    });

    try {
      insertAsset(db, {
        id: "EQUITY:AZN@XLON",
        name: "AstraZeneca existing",
        display_code: "AZN",
        instrument_type: "EQUITY",
        instrument_symbol: "AZN",
        instrument_exchange_mic: "XLON",
        instrument_key: "EQUITY:AZN@XLON",
        provider_config: JSON.stringify({ preferred_provider: "YAHOO" }),
        quote_ccy: "GBp",
      });

      expect(await service.searchSymbol?.("AZN")).toEqual([
        {
          symbol: "AZN",
          shortName: "AstraZeneca existing",
          longName: "AstraZeneca existing",
          exchange: "LSE",
          exchangeMic: "XLON",
          exchangeName: "LSE",
          quoteType: "EQUITY",
          typeDisplay: "EQUITY",
          currency: "GBp",
          currencySource: null,
          dataSource: "FINNHUB",
          isExisting: true,
          existingAssetId: "EQUITY:AZN@XLON",
          index: "",
          score: 100,
        },
        {
          symbol: "VFEG.L",
          shortName: "Vanguard FTSE Emerging Markets",
          longName: "Vanguard FTSE Emerging Markets",
          exchange: "LSE",
          exchangeMic: "XLON",
          exchangeName: "LSE",
          quoteType: "ETF",
          typeDisplay: "",
          currency: "GBP",
          currencySource: "provider",
          dataSource: "YAHOO",
          isExisting: false,
          existingAssetId: null,
          index: "",
          score: 20001,
        },
      ]);
      expect(calls).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  test("search falls back to existing assets when Yahoo search fails", async () => {
    const db = createMarketDataDb();
    const fetchImpl = (() => Promise.reject(new Error("network unavailable"))) as typeof fetch;
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: fetchImpl,
    });

    try {
      insertAsset(db, {
        id: "EQUITY:AAPL@XNAS",
        name: "Apple Inc.",
        display_code: "AAPL",
        instrument_type: "EQUITY",
        instrument_symbol: "AAPL",
        instrument_exchange_mic: "XNAS",
        instrument_key: "EQUITY:AAPL@XNAS",
        quote_ccy: "USD",
      });

      expect(await service.searchSymbol?.("apple")).toMatchObject([
        {
          symbol: "AAPL",
          isExisting: true,
          existingAssetId: "EQUITY:AAPL@XNAS",
          dataSource: "MANUAL",
        },
      ]);
    } finally {
      db.close();
    }
  });

  test("search falls back to secondary Yahoo endpoint when raw search is empty", async () => {
    const db = createMarketDataDb();
    const calls: string[] = [];
    const fetchImpl = ((input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url === "https://query2.finance.yahoo.com/v1/finance/search?q=SHOP") {
        return Promise.resolve(Response.json({ quotes: [] }));
      }
      if (url === "https://query1.finance.yahoo.com/v1/finance/search?q=SHOP") {
        return Promise.resolve(
          Response.json({
            quotes: [
              {
                symbol: "SHOP.TO",
                exchange: "TOR",
                quoteType: "EQUITY",
                longname: "Shopify Inc.",
                score: 42,
              },
            ],
          }),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: fetchImpl,
    });

    try {
      expect(await service.searchSymbol?.("SHOP")).toEqual([
        expect.objectContaining({
          symbol: "SHOP.TO",
          exchangeMic: "XTSE",
          exchangeName: "TSX",
          currency: "CAD",
          currencySource: "exchange_inferred",
          dataSource: "YAHOO",
          score: 42,
        }),
      ]);
      expect(calls).toEqual([
        "https://query2.finance.yahoo.com/v1/finance/search?q=SHOP",
        "https://query1.finance.yahoo.com/v1/finance/search?q=SHOP",
      ]);
    } finally {
      db.close();
    }
  });

  test("search falls back to Finnhub after Yahoo returns non-MIC results", async () => {
    const db = createMarketDataDb();
    const calls: string[] = [];
    const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url === "https://query2.finance.yahoo.com/v1/finance/search?q=SHOP") {
        return Promise.resolve(
          Response.json({
            quotes: [
              {
                symbol: "SHOP",
                exchange: "UNKNOWN",
                quoteType: "EQUITY",
                shortname: "Shopify no MIC",
              },
            ],
          }),
        );
      }
      if (url === "https://finnhub.io/api/v1/search?q=SHOP") {
        expect((init?.headers as Record<string, string>)["X-Finnhub-Token"]).toBe("finnhub-key");
        return Promise.resolve(
          Response.json({
            result: [
              {
                description: "Shopify Inc.",
                displaySymbol: "SHOP.TO",
                symbol: "SHOP.TO",
                type: "Common Stock",
              },
            ],
          }),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: fetchImpl,
      secretService: testSecretService("FINNHUB", "finnhub-key"),
    });

    try {
      expect(await service.searchSymbol?.("SHOP")).toEqual([
        expect.objectContaining({
          symbol: "SHOP.TO",
          shortName: "Shopify Inc.",
          exchangeMic: "XTSE",
          exchangeName: "TSX",
          quoteType: "Stock",
          currency: "CAD",
          currencySource: "exchange_inferred",
          dataSource: "FINNHUB",
        }),
      ]);
      expect(calls).toEqual([
        "https://query2.finance.yahoo.com/v1/finance/search?q=SHOP",
        "https://finnhub.io/api/v1/search?q=SHOP",
      ]);
    } finally {
      db.close();
    }
  });

  test("search keeps first non-empty provider result after a non-MIC Yahoo fallback", async () => {
    const db = createMarketDataDb();
    const calls: string[] = [];
    const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url === "https://query2.finance.yahoo.com/v1/finance/search?q=SHOP") {
        return Promise.resolve(
          Response.json({
            quotes: [
              {
                symbol: "SHOP",
                exchange: "UNKNOWN",
                quoteType: "EQUITY",
                shortname: "Shopify no MIC",
              },
            ],
          }),
        );
      }
      if (url === "https://finnhub.io/api/v1/search?q=SHOP") {
        expect((init?.headers as Record<string, string>)["X-Finnhub-Token"]).toBe("finnhub-key");
        return Promise.resolve(
          Response.json({
            result: [
              {
                description: "Shopify Inc.",
                displaySymbol: "SHOP",
                symbol: "SHOP",
                type: "Common Stock",
              },
            ],
          }),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: fetchImpl,
      secretService: {
        setSecret() {},
        getSecret(key: string) {
          return key === "FINNHUB" ? "finnhub-key" : key === "ALPHA_VANTAGE" ? "alpha-key" : null;
        },
        deleteSecret() {},
      },
    });

    try {
      expect(await service.searchSymbol?.("SHOP")).toEqual([
        expect.objectContaining({
          symbol: "SHOP",
          shortName: "Shopify Inc.",
          exchangeMic: null,
          quoteType: "Stock",
          dataSource: "YAHOO",
        }),
      ]);
      expect(calls).toEqual([
        "https://query2.finance.yahoo.com/v1/finance/search?q=SHOP",
        "https://finnhub.io/api/v1/search?q=SHOP",
      ]);
    } finally {
      db.close();
    }
  });

  test("search falls back to Alpha Vantage after empty Yahoo and Finnhub results", async () => {
    const db = createMarketDataDb();
    const calls: string[] = [];
    const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url === "https://query2.finance.yahoo.com/v1/finance/search?q=MSFT") {
        return Promise.resolve(Response.json({ quotes: [] }));
      }
      if (url === "https://query1.finance.yahoo.com/v1/finance/search?q=MSFT") {
        return Promise.resolve(Response.json({ quotes: [] }));
      }
      if (url === "https://finnhub.io/api/v1/search?q=MSFT") {
        expect((init?.headers as Record<string, string>)["X-Finnhub-Token"]).toBe("finnhub-key");
        return Promise.resolve(Response.json({ result: [] }));
      }
      if (url.startsWith("https://www.alphavantage.co/query?")) {
        const parsed = new URL(url);
        expect(parsed.searchParams.get("function")).toBe("SYMBOL_SEARCH");
        expect(parsed.searchParams.get("keywords")).toBe("MSFT");
        expect(parsed.searchParams.get("apikey")).toBe("alpha-key");
        return Promise.resolve(
          Response.json({
            bestMatches: [
              {
                "1. symbol": "MSFT",
                "2. name": "Microsoft Corporation",
                "3. type": "Equity",
                "4. region": "NMS",
                "8. currency": "USD",
                "9. matchScore": "0.8000",
              },
            ],
          }),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: fetchImpl,
      secretService: {
        setSecret() {},
        getSecret(key: string) {
          return key === "FINNHUB" ? "finnhub-key" : key === "ALPHA_VANTAGE" ? "alpha-key" : null;
        },
        deleteSecret() {},
      },
    });

    try {
      expect(await service.searchSymbol?.("MSFT")).toEqual([
        expect.objectContaining({
          symbol: "MSFT",
          shortName: "Microsoft Corporation",
          exchange: "NMS",
          exchangeMic: "XNAS",
          exchangeName: "NASDAQ",
          quoteType: "EQUITY",
          currency: "USD",
          currencySource: "provider",
          dataSource: "ALPHA_VANTAGE",
          score: 0.8,
        }),
      ]);
      expect(calls).toEqual([
        "https://query2.finance.yahoo.com/v1/finance/search?q=MSFT",
        "https://query1.finance.yahoo.com/v1/finance/search?q=MSFT",
        "https://finnhub.io/api/v1/search?q=MSFT",
        expect.stringContaining("https://www.alphavantage.co/query?"),
      ]);
    } finally {
      db.close();
    }
  });

  test("searches OpenFIGI mapping for exact bond identifiers after empty Yahoo results", async () => {
    const db = createMarketDataDb();
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://query")) {
        calls.push({ url, body: null });
        return Promise.resolve(Response.json({ quotes: [] }));
      }
      if (url === "https://api.openfigi.com/v3/mapping") {
        expect(init?.method).toBe("POST");
        expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
        const body = JSON.parse(String(init?.body)) as unknown;
        calls.push({ url, body });
        return Promise.resolve(
          Response.json([
            {
              data: [
                {
                  name: "United States Treasury Note",
                  ticker: "T 2.75 02/15/28",
                  exchCode: "TRACE",
                  marketSector: "Govt",
                },
                {
                  name: "United States Treasury Note",
                  ticker: "T 2.75 02/15/28",
                  exchCode: "TRACE",
                  marketSector: "Govt",
                },
              ],
            },
          ]),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: fetchImpl,
    });

    try {
      expect(await service.searchSymbol?.("US912810TH12")).toEqual([
        {
          symbol: "US912810TH12",
          shortName: "United States Treasury Note - T 2.75 02/15/28",
          longName: "United States Treasury Note - T 2.75 02/15/28",
          exchange: "TRACE",
          exchangeMic: null,
          exchangeName: null,
          quoteType: "BOND",
          typeDisplay: "",
          currency: null,
          currencySource: null,
          dataSource: "OPENFIGI",
          isExisting: false,
          existingAssetId: null,
          index: "",
          score: 0,
        },
      ]);
      expect(calls.map(({ url }) => url)).toEqual([
        "https://query2.finance.yahoo.com/v1/finance/search?q=US912810TH12",
        "https://query1.finance.yahoo.com/v1/finance/search?q=US912810TH12",
        "https://api.openfigi.com/v3/mapping",
      ]);
      expect(calls.at(-1)?.body).toEqual([{ idType: "ID_ISIN", idValue: "US912810TH12" }]);
    } finally {
      db.close();
    }
  });

  test("searches OpenFIGI free text and filters non-bond sectors", async () => {
    const db = createMarketDataDb();
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://query")) {
        calls.push({ url, body: null });
        return Promise.resolve(Response.json({ quotes: [] }));
      }
      if (url === "https://api.openfigi.com/v3/search") {
        const body = JSON.parse(String(init?.body)) as unknown;
        calls.push({ url, body });
        return Promise.resolve(
          Response.json({
            data: [
              {
                name: "JPMorgan Chase Bond",
                ticker: "JPM 4.0",
                exchCode: "TRACE",
                marketSector: "Corp",
              },
              {
                name: "JPMorgan Chase Equity",
                ticker: "JPM",
                exchCode: "NYS",
                marketSector: "Equity",
              },
            ],
          }),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: fetchImpl,
    });

    try {
      expect(await service.searchSymbol?.("JPMorgan bond")).toEqual([
        expect.objectContaining({
          symbol: "JPMORGAN BOND",
          shortName: "JPMorgan Chase Bond - JPM 4.0",
          quoteType: "BOND",
          dataSource: "OPENFIGI",
        }),
      ]);
      expect(calls.at(-1)).toEqual({
        url: "https://api.openfigi.com/v3/search",
        body: { query: "JPMorgan bond" },
      });
    } finally {
      db.close();
    }
  });

  test("search falls back to Boerse Frankfurt after OpenFIGI has no results", async () => {
    const db = createMarketDataDb();
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://query")) {
        calls.push({ url, body: null });
        return Promise.resolve(Response.json({ quotes: [] }));
      }
      if (url === "https://api.openfigi.com/v3/search") {
        const body = JSON.parse(String(init?.body)) as unknown;
        calls.push({ url, body });
        return Promise.resolve(Response.json({ data: [] }));
      }
      if (url.startsWith("https://api.live.deutsche-boerse.com/v1/tradingview/search?")) {
        const parsed = new URL(url);
        expect(parsed.searchParams.get("query")).toBe("SAP");
        expect(parsed.searchParams.get("limit")).toBe("10");
        expect((init?.headers as Record<string, string>)["User-Agent"]).toContain("Mozilla");
        calls.push({ url, body: null });
        return Promise.resolve(
          Response.json([
            {
              symbol: "XETR:DE0007164600",
              description: "SAP SE",
              exchange: "Xetra",
              type: "Aktie",
            },
            {
              symbol: "XETR:DAX",
              description: "DAX",
              exchange: "Xetra",
              type: "Index",
            },
          ]),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;
    const baseCatalog = JSON.parse(testExchangeCatalogJson()) as {
      exchanges: Array<Record<string, unknown>>;
    };
    const service = createMarketDataService(db, {
      exchangeCatalogJson: JSON.stringify({
        exchanges: [
          ...baseCatalog.exchanges,
          {
            mic: "XETR",
            name: "Xetra",
            currency: "EUR",
            timezone: "Europe/Berlin",
            close: [17, 30],
          },
        ],
      }),
      fetch: fetchImpl,
    });

    try {
      expect(await service.searchSymbol?.("SAP")).toEqual([
        {
          symbol: "DE0007164600",
          shortName: "SAP SE",
          longName: "SAP SE",
          exchange: "Xetra",
          exchangeMic: "XETR",
          exchangeName: "Xetra",
          quoteType: "EQUITY",
          typeDisplay: "",
          currency: "EUR",
          currencySource: "exchange_inferred",
          dataSource: "BOERSE_FRANKFURT",
          isExisting: false,
          existingAssetId: null,
          index: "",
          score: 0,
        },
      ]);
      expect(calls.map(({ url }) => url)).toEqual([
        "https://query2.finance.yahoo.com/v1/finance/search?q=SAP",
        "https://query1.finance.yahoo.com/v1/finance/search?q=SAP",
        "https://api.openfigi.com/v3/search",
        expect.stringContaining("https://api.live.deutsche-boerse.com/v1/tradingview/search?"),
      ]);
      expect(calls[2]?.body).toEqual({ query: "SAP" });
    } finally {
      db.close();
    }
  });

  test("resolves Yahoo quote summary with suffix stripping and auth retry", async () => {
    const db = createMarketDataDb();
    const calls: string[] = [];
    let cookieCount = 0;
    let quoteCount = 0;
    const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url === "https://fc.yahoo.com") {
        cookieCount += 1;
        return Promise.resolve(
          new Response("", { headers: { "set-cookie": `B=resolve-cookie-${cookieCount}` } }),
        );
      }
      if (url === "https://query1.finance.yahoo.com/v1/test/getcrumb") {
        return Promise.resolve(new Response(`resolve-crumb-${cookieCount}`));
      }
      if (url.startsWith("https://query1.finance.yahoo.com/v10/finance/quoteSummary/AZN.L?")) {
        expect((init?.headers as Record<string, string>).Cookie).toBe(
          `B=resolve-cookie-${cookieCount}`,
        );
        quoteCount += 1;
        const parsed = new URL(url);
        expect(parsed.searchParams.get("modules")).toBe("price");
        expect(parsed.searchParams.get("crumb")).toBe(`resolve-crumb-${cookieCount}`);
        if (quoteCount === 1) {
          return Promise.resolve(new Response("", { status: 401, statusText: "Unauthorized" }));
        }
        return Promise.resolve(
          Response.json({
            quoteSummary: {
              result: [
                {
                  price: {
                    currency: "GBp",
                    regularMarketPrice: { raw: 123.45 },
                  },
                },
              ],
            },
          }),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: fetchImpl,
    });

    try {
      await expect(
        service.resolveSymbolQuote?.({
          symbol: "AZN.L",
          exchangeMic: "xlon",
          instrumentType: "equity",
          quoteCcy: "GBP",
          providerId: "",
        }),
      ).resolves.toEqual({
        currency: "GBp",
        price: 123.45,
        resolvedProviderId: "YAHOO",
      });
      expect(calls.filter((url) => url === "https://fc.yahoo.com")).toHaveLength(2);
      expect(
        calls.filter((url) =>
          url.startsWith("https://query1.finance.yahoo.com/v10/finance/quoteSummary/AZN.L?"),
        ),
      ).toHaveLength(2);
    } finally {
      db.close();
    }
  });

  test("uses E2E fixture catalog for Yahoo search, resolve, and sync without network", async () => {
    const db = createMarketDataDb();
    const fixtureDir = mkdtempSync(join(tmpdir(), "wealthfolio-e2e-fixture-"));
    const previousE2E = process.env.WEALTHFOLIO_E2E;
    const previousFixtureDir = process.env.WEALTHFOLIO_FIXTURE_DIR;
    const previousAsOf = process.env.WEALTHFOLIO_FIXTURE_AS_OF;
    process.env.WEALTHFOLIO_E2E = "1";
    process.env.WEALTHFOLIO_FIXTURE_DIR = fixtureDir;
    process.env.WEALTHFOLIO_FIXTURE_AS_OF = "2026-05-12";
    writeFileSync(
      join(fixtureDir, "instruments.json"),
      JSON.stringify({
        defaultAsOf: "2026-05-12",
        instruments: [
          {
            symbol: "APC.DE",
            aliases: ["APC"],
            name: "Apple XETRA",
            provider: "YAHOO",
            assetType: "EQUITY",
            currency: "EUR",
            exchange: "GER",
            exchangeMic: "XETR",
            exchangeName: "XETRA",
            basePrice: 180,
            seed: 303,
          },
          {
            symbol: "APC",
            aliases: [],
            name: "APC US",
            provider: "YAHOO",
            assetType: "EQUITY",
            currency: "USD",
            exchange: "NMS",
            exchangeMic: "XNAS",
            exchangeName: "NASDAQ",
            basePrice: 30,
            seed: 304,
          },
          {
            symbol: "WSLV.MI",
            aliases: ["WSLV"],
            name: "WisdomTree Physical Silver",
            provider: "YAHOO",
            assetType: "EQUITY",
            currency: "EUR",
            exchange: "MIL",
            exchangeMic: "XMIL",
            exchangeName: "Borsa Italiana",
            basePrice: 28,
            seed: 301,
          },
          {
            symbol: "PHYS",
            aliases: [],
            name: "Sprott Physical Gold",
            provider: "YAHOO",
            assetType: "EQUITY",
            currency: "USD",
            exchange: "ASE",
            exchangeMic: "XASE",
            exchangeName: "NYSE American",
            basePrice: 18,
            seed: 302,
          },
          {
            symbol: "USDCAD=X",
            aliases: ["USD/CAD", "USDCAD"],
            name: "USD/CAD",
            provider: "YAHOO",
            assetType: "FX",
            currency: "CAD",
            basePrice: 1.36,
            seed: 201,
          },
        ],
      }),
    );
    let networkCalls = 0;
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: (async () => {
        networkCalls += 1;
        throw new Error("fixture mode should not call network");
      }) as typeof fetch,
      now: () => new Date("2026-05-12T22:00:00.000Z"),
    });

    try {
      await expect(service.searchSymbol?.("USDCAD")).resolves.toEqual([
        expect.objectContaining({
          symbol: "USDCAD=X",
          shortName: "USD/CAD",
          currency: "CAD",
          dataSource: "YAHOO",
        }),
      ]);
      expect(networkCalls).toBe(0);
      await expect(service.searchSymbol?.("PHYS")).resolves.toEqual([
        expect.objectContaining({
          symbol: "PHYS",
          exchangeMic: "XASE",
        }),
        expect.objectContaining({
          symbol: "WSLV.MI",
          exchangeMic: "XMIL",
        }),
      ]);
      await expect(service.searchSymbol?.("APC")).resolves.toEqual([
        expect.objectContaining({ symbol: "APC", exchangeMic: "XNAS" }),
        expect.objectContaining({ symbol: "APC.DE", exchangeMic: "XETR" }),
      ]);
      await expect(
        service.resolveSymbolQuote?.({
          symbol: "APC",
          instrumentType: "EQUITY",
          quoteCcy: "USD",
        }),
      ).resolves.toMatchObject({
        currency: "USD",
        resolvedProviderId: "YAHOO",
      });
      insertAsset(db, {
        id: "apc-us",
        display_code: "APC",
        quote_ccy: "USD",
        instrument_type: "EQUITY",
        instrument_symbol: "APC",
        instrument_exchange_mic: "XNAS",
        instrument_key: "EQUITY:APC@XNAS",
      });
      insertAsset(db, {
        id: "fx-usd-cad",
        display_code: "USD/CAD",
        quote_ccy: "CAD",
        instrument_type: "FX",
        instrument_symbol: "USD",
        instrument_key: "FX:USD/CAD",
      });
      await expect(
        service.resolveSymbolQuote?.({
          symbol: "USD",
          instrumentType: "FX",
          quoteCcy: "CAD",
        }),
      ).resolves.toMatchObject({
        currency: "CAD",
        resolvedProviderId: "YAHOO",
      });
      await service.syncMarketData?.({ type: "incremental", asset_ids: ["fx-usd-cad"] });
      await service.syncMarketData?.({ type: "incremental", asset_ids: ["apc-us"] });
      expect(readQuoteByDay(db, "apc-us", "2026-05-12")).toMatchObject({
        close: "30.15",
        currency: "USD",
      });
      expect(networkCalls).toBe(0);
      expect(
        db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM quotes").get()?.count,
      ).toBeGreaterThan(0);
    } finally {
      if (previousE2E === undefined) {
        delete process.env.WEALTHFOLIO_E2E;
      } else {
        process.env.WEALTHFOLIO_E2E = previousE2E;
      }
      if (previousFixtureDir === undefined) {
        delete process.env.WEALTHFOLIO_FIXTURE_DIR;
      } else {
        process.env.WEALTHFOLIO_FIXTURE_DIR = previousFixtureDir;
      }
      if (previousAsOf === undefined) {
        delete process.env.WEALTHFOLIO_FIXTURE_AS_OF;
      } else {
        process.env.WEALTHFOLIO_FIXTURE_AS_OF = previousAsOf;
      }
      rmSync(fixtureDir, { recursive: true, force: true });
      db.close();
    }
  });

  test("rejects invalid Yahoo quote summaries like Rust validation", async () => {
    const db = createMarketDataDb();
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://fc.yahoo.com") {
        return new Response(null, {
          headers: { "set-cookie": "B=resolve-cookie;" },
        });
      }
      if (url.startsWith("https://query1.finance.yahoo.com/v10/finance/quoteSummary/NEG?")) {
        return Response.json({
          quoteSummary: {
            result: [
              {
                price: {
                  currency: "USD",
                  regularMarketPrice: { raw: -12.34 },
                },
              },
            ],
          },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: fetchImpl,
    });

    try {
      await expect(
        service.resolveSymbolQuote?.({
          symbol: "NEG",
          instrumentType: "equity",
          quoteCcy: "USD",
          providerId: "YAHOO",
        }),
      ).resolves.toEqual({
        currency: null,
        price: null,
        resolvedProviderId: null,
      });
    } finally {
      db.close();
    }
  });

  test("resolves custom provider quote summaries without falling back to Yahoo", async () => {
    const db = createMarketDataDb();
    const calls: string[] = [];
    const service = createMarketDataService(db, {
      fetch: (() => {
        calls.push("yahoo");
        throw new Error("Yahoo should not be called");
      }) as typeof fetch,
      now: () => new Date("2026-01-10T00:00:00Z"),
      customProviderService: {
        getSourceByKind(providerCode, kind) {
          expect(providerCode).toBe("my-feed");
          expect(kind).toBe("latest");
          return {
            id: "source-1",
            providerId: "my-feed",
            kind: "latest",
            format: "json",
            url: "https://prices.example.test/{SYMBOL}",
            pricePath: "$.price",
            datePath: null,
            dateFormat: null,
            currencyPath: "$.currency",
            factor: null,
            invert: null,
            locale: null,
            headers: null,
            openPath: null,
            highPath: null,
            lowPath: null,
            volumePath: null,
            defaultPrice: null,
            dateTimezone: null,
          };
        },
        testSource(request) {
          expect(request).toMatchObject({
            format: "json",
            url: "https://prices.example.test/{SYMBOL}",
            pricePath: "$.price",
            currencyPath: "$.currency",
            symbol: "FUND",
            currency: "CAD",
          });
          return {
            success: true,
            statusCode: 200,
            price: 42.25,
            open: null,
            high: null,
            low: null,
            volume: null,
            currency: "CAD",
            date: null,
            error: null,
            rawResponse: null,
            detectedElements: null,
            detectedTables: null,
          };
        },
      },
    });

    try {
      await expect(
        service.resolveSymbolQuote?.({
          symbol: "FUND",
          instrumentType: "EQUITY",
          quoteCcy: "cad",
          providerId: "CUSTOM:my-feed",
        }),
      ).resolves.toEqual({
        currency: "CAD",
        price: 42.25,
        resolvedProviderId: "CUSTOM_SCRAPER:my-feed",
      });
      expect(calls).toEqual([]);
    } finally {
      db.close();
    }
  });

  test("rejects invalid custom provider quote summaries like Rust validation", async () => {
    const db = createMarketDataDb();
    const calls: string[] = [];
    const service = createMarketDataService(db, {
      fetch: (() => {
        calls.push("yahoo");
        throw new Error("Yahoo should not be called");
      }) as typeof fetch,
      now: () => new Date("2026-01-10T00:00:00Z"),
      customProviderService: {
        getSourceByKind(providerCode, kind) {
          expect(providerCode).toBe("my-feed");
          expect(kind).toBe("latest");
          return {
            id: "source-1",
            providerId: "my-feed",
            kind: "latest",
            format: "json",
            url: "https://prices.example.test/{SYMBOL}",
            pricePath: "$.price",
            datePath: null,
            dateFormat: null,
            currencyPath: "$.currency",
            factor: null,
            invert: null,
            locale: null,
            headers: null,
            openPath: null,
            highPath: null,
            lowPath: null,
            volumePath: null,
            defaultPrice: null,
            dateTimezone: null,
          };
        },
        testSource() {
          return {
            success: true,
            statusCode: 200,
            price: -42.25,
            open: null,
            high: null,
            low: null,
            volume: null,
            currency: "CAD",
            date: null,
            error: null,
            rawResponse: null,
            detectedElements: null,
            detectedTables: null,
          };
        },
      },
    });

    try {
      await expect(
        service.resolveSymbolQuote?.({
          symbol: "FUND",
          instrumentType: "EQUITY",
          quoteCcy: "cad",
          providerId: "CUSTOM:my-feed",
        }),
      ).resolves.toEqual({
        currency: null,
        price: null,
        resolvedProviderId: null,
      });
      expect(calls).toEqual([]);
    } finally {
      db.close();
    }
  });

  test("falls back to historical custom provider sources for quote summaries", async () => {
    const db = createMarketDataDb();
    const yahooCalls: string[] = [];
    const sourceKinds: CustomProviderSourceKind[] = [];
    const requests: TestSourceRequest[] = [];
    const latestSource: CustomProviderSource = {
      id: "source-latest",
      providerId: "my-feed",
      kind: "latest",
      format: "json",
      url: "https://prices.example.test/latest/{SYMBOL}",
      pricePath: "$.price",
      datePath: null,
      dateFormat: null,
      currencyPath: "$.currency",
      factor: null,
      invert: null,
      locale: null,
      headers: null,
      openPath: null,
      highPath: null,
      lowPath: null,
      volumePath: null,
      defaultPrice: null,
      dateTimezone: null,
    };
    const historicalSource: CustomProviderSource = {
      ...latestSource,
      id: "source-historical",
      kind: "historical",
      url: "https://prices.example.test/history/{SYMBOL}",
      pricePath: "$.close",
    };
    const service = createMarketDataService(db, {
      fetch: (() => {
        yahooCalls.push("yahoo");
        throw new Error("Yahoo should not be called");
      }) as typeof fetch,
      now: () => new Date("2026-01-10T00:00:00Z"),
      customProviderService: {
        getSourceByKind(providerCode, kind) {
          expect(providerCode).toBe("my-feed");
          sourceKinds.push(kind);
          return kind === "latest" ? latestSource : historicalSource;
        },
        testSource(request) {
          requests.push(request);
          expect(request.url).toBe(latestSource.url);
          if (request.url === latestSource.url) {
            return {
              success: false,
              statusCode: 200,
              price: null,
              open: null,
              high: null,
              low: null,
              volume: null,
              currency: null,
              date: null,
              error: "missing price",
              rawResponse: null,
              detectedElements: null,
              detectedTables: null,
            };
          }

          throw new Error("historical source should use row fetches");
        },
        fetchSourceRows(request) {
          requests.push(request);
          expect(request).toMatchObject({
            format: "json",
            url: "https://prices.example.test/history/{SYMBOL}",
            pricePath: "$.close",
            symbol: "FUND",
            currency: "CAD",
            from: "2025-10-12",
            to: "2026-01-10",
          });
          return {
            statusCode: 200,
            currency: "CAD",
            rows: [
              {
                price: 39.5,
                open: null,
                high: null,
                low: null,
                volume: null,
                date: "2026-01-07",
              },
              {
                price: 41.5,
                open: null,
                high: null,
                low: null,
                volume: null,
                date: "2026-01-09",
              },
              {
                price: 40.5,
                open: null,
                high: null,
                low: null,
                volume: null,
                date: "2026-01-08",
              },
            ],
          };
        },
      },
    });

    try {
      await expect(
        service.resolveSymbolQuote?.({
          symbol: "FUND",
          instrumentType: "EQUITY",
          quoteCcy: "cad",
          providerId: "CUSTOM:my-feed",
        }),
      ).resolves.toEqual({
        currency: "CAD",
        price: 41.5,
        resolvedProviderId: "CUSTOM_SCRAPER:my-feed",
      });
      expect(sourceKinds).toEqual(["latest", "historical"]);
      expect(requests.map(({ from, to }) => ({ from: from ?? null, to: to ?? null }))).toEqual([
        { from: null, to: null },
        { from: "2025-10-12", to: "2026-01-10" },
      ]);
      expect(yahooCalls).toEqual([]);
    } finally {
      db.close();
    }
  });

  test("resolves Alpha Vantage quote summaries through daily time series", async () => {
    const db = createMarketDataDb();
    const calls: string[] = [];
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: alphaVantageTestFetch({
        calls,
        responses: {
          "TIME_SERIES_DAILY:SHOP.TRT": {
            "Time Series (Daily)": {
              "2026-01-05": {
                "1. open": "25",
                "2. high": "26",
                "3. low": "24",
                "4. close": "25.5",
                "5. volume": "1000",
              },
              "2026-01-06": {
                "1. open": "26",
                "2. high": "27",
                "3. low": "25",
                "4. close": "26.5",
                "5. volume": "2000",
              },
            },
          },
          "TIME_SERIES_DAILY:ANCIENT.TRT": {
            "Time Series (Daily)": {
              "0004-02-29": {
                "1. open": "4",
                "2. high": "5",
                "3. low": "3",
                "4. close": "4.5",
                "5. volume": "40",
              },
            },
          },
        },
      }),
      secretService: testSecretService("ALPHA_VANTAGE", "alpha-key"),
    });

    try {
      await expect(
        service.resolveSymbolQuote?.({
          symbol: "SHOP",
          exchangeMic: "XTSE",
          instrumentType: "EQUITY",
          quoteCcy: "USD",
          providerId: "ALPHA_VANTAGE",
        }),
      ).resolves.toEqual({
        currency: "CAD",
        price: 26.5,
        resolvedProviderId: "ALPHA_VANTAGE",
      });
      await expect(
        service.resolveSymbolQuote?.({
          symbol: "ANCIENT",
          exchangeMic: "XTSE",
          instrumentType: "EQUITY",
          quoteCcy: "USD",
          providerId: "ALPHA_VANTAGE",
        }),
      ).resolves.toEqual({
        currency: "CAD",
        price: 4.5,
        resolvedProviderId: "ALPHA_VANTAGE",
      });
      expect(calls).toEqual([
        "TIME_SERIES_DAILY:SHOP.TRT:compact",
        "TIME_SERIES_DAILY:ANCIENT.TRT:compact",
      ]);
    } finally {
      db.close();
    }
  });

  test("resolves Alpha Vantage option quote summaries through realtime options", async () => {
    const db = createMarketDataDb();
    const calls: string[] = [];
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: alphaVantageTestFetch({
        calls,
        responses: {
          "REALTIME_OPTIONS:AAPL:AAPL260117C00100000": {
            data: [
              {
                contractID: "AAPL260117C00100000",
                last: "12.34",
                mark: "12.30",
                volume: "42",
                date: "2026-01-05",
              },
            ],
          },
          "REALTIME_OPTIONS:MSFT:MSFT260117P00200000": {
            data: [
              {
                contractID: "MSFT260117P00200000",
                last: "0",
                mark: "2.45",
                volume: "5",
                date: "2026-01-05",
              },
            ],
          },
        },
      }),
      secretService: testSecretService("ALPHA_VANTAGE", "alpha-key"),
    });

    try {
      await expect(
        service.resolveSymbolQuote?.({
          symbol: "AAPL260117C00100000",
          instrumentType: "OPTION",
          quoteCcy: "USD",
          providerId: "ALPHA_VANTAGE",
        }),
      ).resolves.toEqual({
        currency: "USD",
        price: 12.34,
        resolvedProviderId: "ALPHA_VANTAGE",
      });
      await expect(
        service.resolveSymbolQuote?.({
          symbol: "MSFT260117P00200000",
          instrumentType: "OPTION",
          quoteCcy: "USD",
          providerId: "ALPHA_VANTAGE",
        }),
      ).resolves.toEqual({
        currency: "USD",
        price: 2.45,
        resolvedProviderId: "ALPHA_VANTAGE",
      });
      expect(calls).toEqual([
        "REALTIME_OPTIONS:AAPL:AAPL260117C00100000",
        "REALTIME_OPTIONS:MSFT:MSFT260117P00200000",
      ]);
    } finally {
      db.close();
    }
  });

  test("resolves Metal Price API quote summaries through latest endpoint", async () => {
    const db = createMarketDataDb();
    const calls: string[] = [];
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: metalPriceApiTestFetch({
        calls,
        responses: {
          "latest:USD:XAG": {
            success: true,
            base: "USD",
            timestamp: 1767657600,
            rates: { XAG: 0.05 },
          },
        },
      }),
      now: () => new Date("2026-01-06T22:30:00Z"),
      secretService: testSecretService("METAL_PRICE_API", "metal-key"),
    });

    try {
      await expect(
        service.resolveSymbolQuote?.({
          symbol: "XAG",
          instrumentType: "METAL",
          quoteCcy: "USD",
          providerId: "METAL_PRICE_API",
        }),
      ).resolves.toEqual({
        currency: "USD",
        price: 20,
        resolvedProviderId: "METAL_PRICE_API",
      });
      expect(calls).toEqual(["latest:USD:XAG"]);
    } finally {
      db.close();
    }
  });

  test("resolves US Treasury quote summaries from existing bond metadata", async () => {
    const db = createMarketDataDb();
    const calls: string[] = [];
    const service = createMarketDataService(db, {
      fetch: usTreasuryTestFetch({
        calls,
        responses: {
          "2026": treasuryCurveXml([
            {
              date: "2026-01-05",
              yields: { BC_1YEAR: 4, BC_2YEAR: 4, BC_5YEAR: 4, BC_10YEAR: 4 },
            },
            {
              date: "2026-01-06",
              yields: { BC_1YEAR: 4.1, BC_2YEAR: 4.1, BC_5YEAR: 4.1, BC_10YEAR: 4.1 },
            },
          ]),
        },
      }),
      now: () => new Date("2026-01-06T22:30:00Z"),
    });

    try {
      insertAsset(db, {
        id: "treasury-note",
        display_code: "US912810TH12",
        quote_ccy: "USD",
        instrument_type: "BOND",
        instrument_symbol: "US912810TH12",
        metadata: JSON.stringify({
          bond: {
            maturityDate: "2031-01-05",
            couponRate: 0.05,
            faceValue: 1000,
            couponFrequency: "SEMI_ANNUAL",
          },
        }),
      });

      const resolved = await Promise.resolve(
        service.resolveSymbolQuote?.({
          symbol: "US912810TH12",
          instrumentType: "BOND",
          quoteCcy: "USD",
          providerId: "US_TREASURY_CALC",
        }),
      );

      expect(resolved?.currency).toBe("USD");
      expect(resolved?.resolvedProviderId).toBe("US_TREASURY_CALC");
      expect(resolved?.price ?? 0).toBeGreaterThan(1);
      expect(calls).toEqual(["2026"]);
    } finally {
      db.close();
    }
  });

  test("does not resolve US Treasury quotes across calendar years", async () => {
    const db = createMarketDataDb();
    const calls: string[] = [];
    const service = createMarketDataService(db, {
      fetch: usTreasuryTestFetch({
        calls,
        responses: {
          "2026": treasuryCurveXml([
            {
              date: "2026-01-05",
              yields: { BC_1YEAR: 4, BC_2YEAR: 4, BC_5YEAR: 4, BC_10YEAR: 4 },
            },
          ]),
        },
      }),
      now: () => new Date("2026-01-01T12:00:00Z"),
    });

    try {
      insertAsset(db, {
        id: "treasury-note",
        display_code: "US912810TH12",
        instrument_type: "BOND",
        instrument_symbol: "US912810TH12",
        metadata: JSON.stringify({
          bond: { maturityDate: "2031-01-05", couponRate: 0.05 },
        }),
      });

      await expect(
        service.resolveSymbolQuote?.({
          symbol: "US912810TH12",
          instrumentType: "BOND",
          providerId: "US_TREASURY_CALC",
        }),
      ).resolves.toEqual({ currency: null, price: null, resolvedProviderId: null });
      expect(calls).toEqual(["2026"]);
    } finally {
      db.close();
    }
  });

  test("records MarketData.app HTTP status failures like Rust", async () => {
    const db = createMarketDataDb();
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: ((input, init) => {
        const url = String(input);
        expect(url).toStartWith("https://api.marketdata.app/v1/stocks/candles/D/AAPL");
        expect((init?.headers as Record<string, string> | undefined)?.Authorization).toBe(
          "Bearer test-key",
        );
        return Promise.resolve(
          new Response("", {
            status: 509,
            statusText: "Bandwidth Limit Exceeded",
          }),
        );
      }) as typeof fetch,
      now: () => new Date("2026-01-06T22:30:00Z"),
      secretService: testSecretService("MARKETDATA_APP", "test-key"),
    });

    try {
      insertAsset(db, {
        id: "asset-marketdata",
        display_code: "AAPL",
        instrument_symbol: "AAPL",
        instrument_exchange_mic: "XNAS",
        provider_config: JSON.stringify({ preferred_provider: "MARKETDATA_APP" }),
      });

      await expect(
        service.syncMarketData?.({ type: "incremental", asset_ids: ["asset-marketdata"] }),
      ).resolves.toMatchObject({
        synced: 0,
        failed: 1,
        failures: [["AAPL", "MARKETDATA_APP: HTTP error: 509 <unknown status code>"]],
      });
      expect(readSyncState(db, "asset-marketdata")).toMatchObject({
        data_source: "MARKETDATA_APP",
        error_count: 1,
        last_error: "MARKETDATA_APP: HTTP error: 509 <unknown status code>",
      });
    } finally {
      db.close();
    }
  });

  test("resolves MarketData.app quote summaries through price information", async () => {
    const db = createMarketDataDb();
    const calls: string[] = [];
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: marketDataAppTestFetch({
        calls,
        prices: {
          SHOP: {
            s: "ok",
            mid: [25.5],
            updated: [1767657600],
          },
        },
      }),
      secretService: testSecretService("MARKETDATA_APP", "test-key"),
    });

    try {
      await expect(
        service.resolveSymbolQuote?.({
          symbol: "SHOP",
          exchangeMic: "XTSE",
          instrumentType: "EQUITY",
          quoteCcy: "EUR",
          providerId: "MARKETDATA_APP",
        }),
      ).resolves.toEqual({
        currency: "CAD",
        price: 25.5,
        resolvedProviderId: "MARKETDATA_APP",
      });
      expect(calls).toEqual(["https://api.marketdata.app/v1/stocks/prices/SHOP/"]);
    } finally {
      db.close();
    }
  });

  test("resolves Finnhub quote summaries through quote endpoint", async () => {
    const db = createMarketDataDb();
    const calls: string[] = [];
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: finnhubTestFetch({
        calls,
        quotes: {
          SHOP: {
            c: 25.5,
            o: 25,
            h: 26,
            l: 24.5,
            t: 1767657600,
          },
          "OANDA:EUR_USD": {
            c: 1.15,
            o: 1.1,
            h: 1.2,
            l: 1.0,
            t: 1767657600,
          },
          "BINANCE:BTCUSDT": {
            c: 44000,
            o: 43000,
            h: 45000,
            l: 42000,
            t: 1767657600,
          },
        },
      }),
      secretService: testSecretService("FINNHUB", "finnhub-key"),
    });

    try {
      await expect(
        service.resolveSymbolQuote?.({
          symbol: "SHOP",
          exchangeMic: "XTSE",
          instrumentType: "EQUITY",
          quoteCcy: "EUR",
          providerId: "FINNHUB",
        }),
      ).resolves.toEqual({
        currency: "CAD",
        price: 25.5,
        resolvedProviderId: "FINNHUB",
      });
      await expect(
        service.resolveSymbolQuote?.({
          symbol: "EUR",
          instrumentType: "FX",
          quoteCcy: "USD",
          providerId: "FINNHUB",
        }),
      ).resolves.toEqual({
        currency: "USD",
        price: 1.15,
        resolvedProviderId: "FINNHUB",
      });
      await expect(
        service.resolveSymbolQuote?.({
          symbol: "BTC",
          instrumentType: "CRYPTO",
          quoteCcy: "USDT",
          providerId: "FINNHUB",
        }),
      ).resolves.toEqual({
        currency: "USDT",
        price: 44000,
        resolvedProviderId: "FINNHUB",
      });
      await expect(
        service.resolveSymbolQuote?.({
          symbol: "EURUSD",
          instrumentType: "FX",
          providerId: "FINNHUB",
        }),
      ).resolves.toEqual({
        currency: "USD",
        price: 1.15,
        resolvedProviderId: "FINNHUB",
      });
      await expect(
        service.resolveSymbolQuote?.({
          symbol: "BTC-USDT",
          instrumentType: "CRYPTO",
          providerId: "FINNHUB",
        }),
      ).resolves.toEqual({
        currency: "USDT",
        price: 44000,
        resolvedProviderId: "FINNHUB",
      });
      expect(calls.map((call) => new URL(call).searchParams.get("symbol"))).toEqual([
        "SHOP",
        "OANDA:EUR_USD",
        "BINANCE:BTCUSDT",
        "OANDA:EUR_USD",
        "BINANCE:BTCUSDT",
      ]);
    } finally {
      db.close();
    }
  });

  test("resolves Boerse Frankfurt quote summaries through price information", async () => {
    const db = createMarketDataDb();
    const calls: string[] = [];
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: boerseTestFetch({
        calls,
        search: {
          SAP: [
            {
              symbol: "XETR:DE0007164600",
              description: "SAP SE",
              exchange: "Xetra",
              type: "Aktie",
            },
          ],
        },
        price: {
          "XETR:DE0007164600": {
            lastPrice: 70.02,
            timestampLastPrice: "2026-03-14T15:42:00+01:00",
            tradedInPercent: false,
            currency: { originalValue: "EUR" },
          },
          "XFRA:XS2530331413": {
            lastPrice: 97.025,
            timestampLastPrice: "2026-03-14T15:42:00+01:00",
            tradedInPercent: true,
            currency: { originalValue: "EUR" },
          },
        },
      }),
    });

    try {
      await expect(
        service.resolveSymbolQuote?.({
          symbol: "SAP",
          exchangeMic: "XETR",
          instrumentType: "EQUITY",
          providerId: "BOERSE_FRANKFURT",
        }),
      ).resolves.toEqual({
        currency: "EUR",
        price: 70.02,
        resolvedProviderId: "BOERSE_FRANKFURT",
      });
      await expect(
        service.resolveSymbolQuote?.({
          symbol: "XS2530331413",
          instrumentType: "BOND",
          providerId: "BOERSE_FRANKFURT",
        }),
      ).resolves.toEqual({
        currency: "EUR",
        price: 0.97025,
        resolvedProviderId: "BOERSE_FRANKFURT",
      });
      expect(calls.filter((url) => url.includes("/tradingview/search?"))).toHaveLength(1);
      expect(calls.filter((url) => url.includes("/data/price_information/single?"))).toHaveLength(
        2,
      );
    } finally {
      db.close();
    }
  });

  test("resolves Yahoo crypto pairs and respects non-Yahoo provider preferences", async () => {
    const db = createMarketDataDb();
    const calls: string[] = [];
    const fetchImpl = ((input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url === "https://fc.yahoo.com") {
        return Promise.resolve(new Response("", { headers: { "set-cookie": "B=crypto" } }));
      }
      if (url === "https://query1.finance.yahoo.com/v1/test/getcrumb") {
        return Promise.resolve(new Response("crypto-crumb"));
      }
      if (url.startsWith("https://query1.finance.yahoo.com/v10/finance/quoteSummary/BTC-USD?")) {
        return Promise.resolve(
          Response.json({
            quoteSummary: {
              result: [
                {
                  price: {
                    currency: "USD",
                    regularMarketPrice: 65000,
                  },
                },
              ],
            },
          }),
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;
    const service = createMarketDataService(db, {
      exchangeCatalogJson: testExchangeCatalogJson(),
      fetch: fetchImpl,
    });

    try {
      await expect(
        service.resolveSymbolQuote?.({
          symbol: "",
          instrumentType: "EQUITY",
        }),
      ).resolves.toEqual({ currency: null, price: null, resolvedProviderId: null });
      await expect(
        service.resolveSymbolQuote?.({
          symbol: "AAPL",
          instrumentType: "EQUITY",
          providerId: "ALPHA_VANTAGE",
        }),
      ).resolves.toEqual({ currency: null, price: null, resolvedProviderId: null });
      await expect(
        service.resolveSymbolQuote?.({
          symbol: "AAPL",
          instrumentType: "EQUITY",
          providerId: "yahoo",
        }),
      ).resolves.toEqual({ currency: null, price: null, resolvedProviderId: null });
      await expect(
        service.resolveSymbolQuote?.({
          symbol: "US912810UE10",
          instrumentType: "BOND",
        }),
      ).resolves.toEqual({ currency: null, price: null, resolvedProviderId: null });
      await expect(
        service.resolveSymbolQuote?.({
          symbol: "BTC-USD",
          instrumentType: "CRYPTO",
        }),
      ).resolves.toEqual({ currency: "USD", price: 65000, resolvedProviderId: "YAHOO" });
      expect(
        calls.filter((url) =>
          url.startsWith("https://query1.finance.yahoo.com/v10/finance/quoteSummary/BTC-USD?"),
        ),
      ).toHaveLength(1);
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
    CREATE TABLE assets (
      id TEXT NOT NULL PRIMARY KEY,
      kind TEXT NOT NULL,
      name TEXT,
      display_code TEXT,
      quote_ccy TEXT NOT NULL,
      quote_mode TEXT NOT NULL,
      is_active INTEGER NOT NULL,
      instrument_symbol TEXT,
      instrument_exchange_mic TEXT,
      instrument_type TEXT,
      instrument_key TEXT,
      provider_config TEXT,
      metadata TEXT
    );
    CREATE TABLE quote_sync_state (
      asset_id TEXT NOT NULL PRIMARY KEY,
      position_closed_date TEXT,
      last_synced_at TEXT,
      data_source TEXT NOT NULL DEFAULT 'YAHOO',
      sync_priority INTEGER NOT NULL DEFAULT 1,
      error_count INTEGER NOT NULL,
      last_error TEXT,
      profile_enriched_at TEXT,
      created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00.000Z',
      updated_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00.000Z'
    );
  `);
  return db;
}

function insertAsset(
  db: Database,
  asset: {
    id: string;
    kind?: string;
    name?: string | null;
    display_code?: string | null;
    quote_ccy?: string;
    quote_mode?: string;
    is_active?: number;
    instrument_symbol?: string | null;
    instrument_exchange_mic?: string | null;
    instrument_type?: string | null;
    instrument_key?: string | null;
    provider_config?: string | null;
    metadata?: string | null;
  },
) {
  db.query(
    `
      INSERT INTO assets (
        id, kind, name, display_code, quote_ccy, quote_mode, is_active, instrument_symbol,
        instrument_exchange_mic, instrument_type, instrument_key, provider_config, metadata
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    asset.id,
    asset.kind ?? "INVESTMENT",
    asset.name ?? null,
    asset.display_code ?? null,
    asset.quote_ccy ?? "USD",
    asset.quote_mode ?? "MARKET",
    asset.is_active ?? 1,
    asset.instrument_symbol ?? null,
    asset.instrument_exchange_mic ?? null,
    asset.instrument_type ?? "EQUITY",
    asset.instrument_key ?? null,
    asset.provider_config ?? null,
    asset.metadata ?? null,
  );
}

function insertSyncState(
  db: Database,
  state: {
    asset_id: string;
    position_closed_date?: string | null;
    data_source?: string;
    last_synced_at?: string | null;
    sync_priority?: number;
    error_count?: number;
    last_error?: string | null;
  },
) {
  db.query(
    `
      INSERT INTO quote_sync_state (
        asset_id, position_closed_date, last_synced_at, data_source, sync_priority, error_count,
        last_error
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    state.asset_id,
    state.position_closed_date ?? null,
    state.last_synced_at ?? null,
    state.data_source ?? "YAHOO",
    state.sync_priority ?? 1,
    state.error_count ?? 0,
    state.last_error ?? null,
  );
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

function readQuoteByDay(
  db: Database,
  assetId: string,
  day: string,
): Record<string, unknown> | null {
  return db
    .query<
      Record<string, unknown>,
      [string, string]
    >("SELECT * FROM quotes WHERE asset_id = ? AND day = ?")
    .get(assetId, day);
}

function readSyncState(db: Database, assetId: string): Record<string, unknown> | null {
  return db
    .query<Record<string, unknown>, [string]>("SELECT * FROM quote_sync_state WHERE asset_id = ?")
    .get(assetId);
}

function readAssetActive(db: Database, assetId: string): number | null {
  return (
    db
      .query<{ is_active: number }, [string]>("SELECT is_active FROM assets WHERE id = ?")
      .get(assetId)?.is_active ?? null
  );
}

function emptySyncResult() {
  return {
    synced: 0,
    failed: 0,
    skipped: 0,
    quotesSynced: 0,
    failures: [],
    skippedReasons: [],
  };
}

function yahooHistoryFetch(
  expectedSymbol: string,
  result: Record<string, unknown> | null,
  error: Record<string, unknown> | null = null,
): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://fc.yahoo.com") {
      return Promise.resolve(
        new Response("", { headers: { "set-cookie": "B=yahoo-history; Path=/; Secure" } }),
      );
    }
    if (url === "https://query1.finance.yahoo.com/v1/test/getcrumb") {
      expect((init?.headers as Record<string, string>).Cookie).toBe("B=yahoo-history");
      return Promise.resolve(new Response("history-crumb"));
    }
    if (
      url.startsWith(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(expectedSymbol)}?`,
      )
    ) {
      expect((init?.headers as Record<string, string>).Cookie).toBe("B=yahoo-history");
      const parsed = new URL(url);
      expect(parsed.searchParams.get("interval")).toBe("1d");
      expect(parsed.searchParams.get("events")).toBe("history");
      expect(parsed.searchParams.get("crumb")).toBe("history-crumb");
      return Promise.resolve(
        Response.json({
          chart: {
            result: result ? [result] : null,
            error,
          },
        }),
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
}

function yahooHistoryFetchBySymbol(
  responses: Record<
    string,
    { result?: Record<string, unknown> | null; error?: Record<string, unknown> | null }
  >,
  onChartSymbol: (symbol: string) => void = () => {},
): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://fc.yahoo.com") {
      return Promise.resolve(
        new Response("", { headers: { "set-cookie": "B=yahoo-history; Path=/; Secure" } }),
      );
    }
    if (url === "https://query1.finance.yahoo.com/v1/test/getcrumb") {
      expect((init?.headers as Record<string, string>).Cookie).toBe("B=yahoo-history");
      return Promise.resolve(new Response("history-crumb"));
    }
    if (url.startsWith("https://query1.finance.yahoo.com/v8/finance/chart/")) {
      expect((init?.headers as Record<string, string>).Cookie).toBe("B=yahoo-history");
      const parsed = new URL(url);
      const encodedSymbol = parsed.pathname.split("/").at(-1);
      const symbol = decodeURIComponent(encodedSymbol ?? "");
      const response = responses[symbol];
      if (!response) {
        throw new Error(`unexpected chart symbol: ${symbol}`);
      }
      onChartSymbol(symbol);
      expect(parsed.searchParams.get("interval")).toBe("1d");
      expect(parsed.searchParams.get("events")).toBe("history");
      expect(parsed.searchParams.get("crumb")).toBe("history-crumb");
      return Promise.resolve(
        Response.json({
          chart: {
            result: response.result ? [response.result] : null,
            error: response.error ?? null,
          },
        }),
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
}

function testSecretService(secretKey: string, secret: string) {
  return {
    setSecret() {},
    getSecret(key: string) {
      return key === secretKey ? secret : null;
    },
    deleteSecret() {},
  };
}

function alphaVantageTestFetch(options: {
  calls?: string[];
  responses: Record<string, unknown>;
  fallback?: typeof fetch;
}): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith("https://www.alphavantage.co/query")) {
      if (options.fallback) {
        return options.fallback(input, init);
      }
      throw new Error(`unexpected fetch: ${url}`);
    }
    expect(init).toBeUndefined();
    const parsed = new URL(url);
    expect(parsed.searchParams.get("apikey")).toBe("alpha-key");
    const fn = parsed.searchParams.get("function");
    let key: string | null = null;
    if (fn === "TIME_SERIES_DAILY") {
      expect(parsed.searchParams.get("outputsize")).toBe("compact");
      key = `${fn}:${parsed.searchParams.get("symbol") ?? ""}`;
      options.calls?.push(`${key}:compact`);
    } else if (fn === "FX_DAILY") {
      expect(parsed.searchParams.get("outputsize")).toBe("full");
      key = `${fn}:${parsed.searchParams.get("from_symbol") ?? ""}:${
        parsed.searchParams.get("to_symbol") ?? ""
      }`;
      options.calls?.push(`${key}:full`);
    } else if (fn === "DIGITAL_CURRENCY_DAILY") {
      expect(parsed.searchParams.has("outputsize")).toBe(false);
      key = `${fn}:${parsed.searchParams.get("symbol") ?? ""}:${
        parsed.searchParams.get("market") ?? ""
      }`;
      options.calls?.push(key);
    } else if (fn === "REALTIME_OPTIONS") {
      expect(parsed.searchParams.has("outputsize")).toBe(false);
      key = `${fn}:${parsed.searchParams.get("symbol") ?? ""}:${
        parsed.searchParams.get("contract") ?? ""
      }`;
      options.calls?.push(key);
    }
    if (key === null) {
      throw new Error(`unexpected Alpha Vantage function: ${fn ?? ""}`);
    }
    const response = options.responses[key];
    if (!response) {
      throw new Error(`unexpected Alpha Vantage request: ${key}`);
    }
    return Promise.resolve(Response.json(response));
  }) as typeof fetch;
}

function metalPriceApiTestFetch(options: {
  calls?: string[];
  responses: Record<string, unknown>;
  fallback?: typeof fetch;
}): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith("https://api.metalpriceapi.com/v1/")) {
      if (options.fallback) {
        return options.fallback(input, init);
      }
      throw new Error(`unexpected fetch: ${url}`);
    }
    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.["X-API-KEY"]).toBe("metal-key");
    const parsed = new URL(url);
    const endpoint = parsed.pathname.replace("/v1/", "");
    const base = parsed.searchParams.get("base") ?? "";
    const currencies = parsed.searchParams.get("currencies") ?? "";
    const key = `${endpoint}:${base}:${currencies}`;
    if (endpoint === "timeframe") {
      options.calls?.push(
        `${key}:${parsed.searchParams.get("start_date") ?? ""}:${
          parsed.searchParams.get("end_date") ?? ""
        }`,
      );
    } else {
      options.calls?.push(key);
    }
    const response = options.responses[key];
    if (!response) {
      throw new Error(`unexpected Metal Price API request: ${key}`);
    }
    return Promise.resolve(Response.json(response));
  }) as typeof fetch;
}

function usTreasuryTestFetch(options: {
  calls?: string[];
  responses: Record<string, string>;
}): typeof fetch {
  return ((input: RequestInfo | URL) => {
    const url = String(input);
    if (
      !url.startsWith(
        "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml",
      )
    ) {
      throw new Error(`unexpected fetch: ${url}`);
    }
    const parsed = new URL(url);
    expect(parsed.searchParams.get("data")).toBe("daily_treasury_yield_curve");
    const year = parsed.searchParams.get("field_tdr_date_value") ?? "";
    options.calls?.push(year);
    const response = options.responses[year];
    if (!response) {
      throw new Error(`unexpected US Treasury year: ${year}`);
    }
    return Promise.resolve(new Response(response));
  }) as typeof fetch;
}

function treasuryCurveXml(
  entries: Array<{ date: string; yields: Partial<Record<string, number>> }>,
): string {
  return `<feed>${entries
    .map(
      ({ date, yields }) => `<entry><content><m:properties>
        <d:NEW_DATE>${date}T00:00:00</d:NEW_DATE>
        <d:BC_1MONTH>${yields.BC_1MONTH ?? 3.8}</d:BC_1MONTH>
        <d:BC_2MONTH>${yields.BC_2MONTH ?? 3.85}</d:BC_2MONTH>
        <d:BC_3MONTH>${yields.BC_3MONTH ?? 3.9}</d:BC_3MONTH>
        <d:BC_4MONTH m:null="true" />
        <d:BC_6MONTH>${yields.BC_6MONTH ?? 3.95}</d:BC_6MONTH>
        <d:BC_1YEAR>${yields.BC_1YEAR ?? 4}</d:BC_1YEAR>
        <d:BC_2YEAR>${yields.BC_2YEAR ?? 4.1}</d:BC_2YEAR>
        <d:BC_3YEAR>${yields.BC_3YEAR ?? 4.2}</d:BC_3YEAR>
        <d:BC_5YEAR>${yields.BC_5YEAR ?? 4.3}</d:BC_5YEAR>
        <d:BC_7YEAR>${yields.BC_7YEAR ?? 4.4}</d:BC_7YEAR>
        <d:BC_10YEAR>${yields.BC_10YEAR ?? 4.5}</d:BC_10YEAR>
        <d:BC_20YEAR>${yields.BC_20YEAR ?? 4.6}</d:BC_20YEAR>
        <d:BC_30YEAR>${yields.BC_30YEAR ?? 4.7}</d:BC_30YEAR>
      </m:properties></content></entry>`,
    )
    .join("")}</feed>`;
}

function marketDataAppTestFetch(options: {
  calls?: string[];
  candles?: Record<string, unknown>;
  prices?: Record<string, unknown>;
  fallback?: typeof fetch;
}): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith("https://api.marketdata.app/v1/")) {
      if (options.fallback) {
        return options.fallback(input, init);
      }
      throw new Error(`unexpected fetch: ${url}`);
    }

    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe("Bearer test-key");
    options.calls?.push(url);
    const parsed = new URL(url);
    if (parsed.pathname.startsWith("/v1/stocks/candles/D/")) {
      const symbol = decodeURIComponent(parsed.pathname.slice("/v1/stocks/candles/D/".length));
      const result = options.candles?.[symbol];
      if (!result) {
        throw new Error(`unexpected MarketData.app candles symbol: ${symbol}`);
      }
      return Promise.resolve(Response.json(result));
    }
    if (parsed.pathname.startsWith("/v1/stocks/prices/")) {
      const symbol = decodeURIComponent(
        parsed.pathname.slice("/v1/stocks/prices/".length).replace(/\/$/, ""),
      );
      const result = options.prices?.[symbol];
      if (!result) {
        throw new Error(`unexpected MarketData.app prices symbol: ${symbol}`);
      }
      return Promise.resolve(Response.json(result));
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
}

function finnhubTestFetch(options: {
  calls?: string[];
  candles?: Record<string, unknown>;
  quotes?: Record<string, unknown>;
  fallback?: typeof fetch;
}): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith("https://finnhub.io/api/v1/")) {
      if (options.fallback) {
        return options.fallback(input, init);
      }
      throw new Error(`unexpected fetch: ${url}`);
    }

    const headers = init?.headers as Record<string, string> | undefined;
    expect(headers?.["X-Finnhub-Token"]).toBe("finnhub-key");
    options.calls?.push(url);
    const parsed = new URL(url);
    if (
      parsed.pathname === "/api/v1/stock/candle" ||
      parsed.pathname === "/api/v1/forex/candle" ||
      parsed.pathname === "/api/v1/crypto/candle"
    ) {
      const symbol = parsed.searchParams.get("symbol") ?? "";
      expect(parsed.searchParams.get("resolution")).toBe("D");
      const result = options.candles?.[symbol];
      if (!result) {
        throw new Error(`unexpected Finnhub candle symbol: ${symbol}`);
      }
      return Promise.resolve(Response.json(result));
    }
    if (parsed.pathname === "/api/v1/quote") {
      const symbol = parsed.searchParams.get("symbol") ?? "";
      const result = options.quotes?.[symbol];
      if (!result) {
        throw new Error(`unexpected Finnhub quote symbol: ${symbol}`);
      }
      return Promise.resolve(Response.json(result));
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
}

function boerseTestFetch(options: {
  calls?: string[];
  fallback?: typeof fetch;
  search?: Record<string, unknown[]>;
  history?: Record<string, unknown>;
  price?: Record<string, unknown>;
}): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith("https://api.live.deutsche-boerse.com/v1/")) {
      if (options.fallback) {
        return options.fallback(input, init);
      }
      throw new Error(`unexpected fetch: ${url}`);
    }

    options.calls?.push(url);
    expect((init?.headers as Record<string, string>)["User-Agent"]).toContain("Chrome/131.0.0.0");
    const parsed = new URL(url);
    if (parsed.pathname === "/v1/tradingview/search") {
      const query = parsed.searchParams.get("query") ?? "";
      expect(parsed.searchParams.get("limit")).toBe("5");
      const result = options.search?.[query];
      if (!result) {
        throw new Error(`unexpected Boerse search query: ${query}`);
      }
      return Promise.resolve(Response.json(result));
    }
    if (parsed.pathname === "/v1/tradingview/history") {
      const symbol = parsed.searchParams.get("symbol") ?? "";
      expect(parsed.searchParams.get("resolution")).toBe("1D");
      const result = options.history?.[symbol];
      if (!result) {
        throw new Error(`unexpected Boerse history symbol: ${symbol}`);
      }
      return Promise.resolve(Response.json(result));
    }
    if (parsed.pathname === "/v1/data/price_information/single") {
      const key = `${parsed.searchParams.get("mic")}:${parsed.searchParams.get("isin")}`;
      const result = options.price?.[key];
      if (!result) {
        throw new Error(`unexpected Boerse price key: ${key}`);
      }
      return Promise.resolve(Response.json(result));
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function testExchangeCatalogJson(): string {
  return JSON.stringify({
    exchanges: [
      {
        mic: "XNAS",
        name: "NASDAQ",
        long_name: "NASDAQ Stock Market",
        currency: "USD",
        timezone: "America/New_York",
        close: [16, 0],
        yahoo: { suffix: "", codes: ["NMS", "NGM", "NCM"] },
        alpha_vantage: { suffix: "", currency: "USD" },
      },
      {
        mic: "XTSE",
        name: "TSX",
        currency: "CAD",
        timezone: "America/Toronto",
        close: [16, 0],
        yahoo: { suffix: "TO", codes: ["TOR"] },
        alpha_vantage: { suffix: ".TRT", currency: "CAD" },
      },
      {
        mic: "XLON",
        name: "LSE",
        currency: "GBP",
        timezone: "Europe/London",
        close: [16, 30],
        yahoo: { suffix: "L", codes: ["LSE"] },
        alpha_vantage: { suffix: ".LON", currency: "GBP" },
      },
      {
        mic: "NOCCY",
        name: "No Currency",
      },
    ],
  });
}
