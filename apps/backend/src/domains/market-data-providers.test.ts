import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import {
  createMarketDataProviderRepository,
  createMarketDataProviderService,
} from "./market-data-providers";

describe("TS market data provider settings domain", () => {
  test("lists provider info with Rust-compatible ordering, capabilities, secrets, and sync stats", async () => {
    const db = createMarketDataProvidersDb();
    const service = createMarketDataProviderService(createMarketDataProviderRepository(db), {
      readSecret: (providerId) => (providerId === "ALPHA_VANTAGE" ? "secret" : null),
    });

    try {
      const providers = await service.getProvidersInfo();

      expect(providers.map((provider) => provider.id)).toEqual([
        "YAHOO",
        "ALPHA_VANTAGE",
        "FINNHUB",
      ]);
      expect(providers[0]).toMatchObject({
        id: "YAHOO",
        priority: 1,
        requiresApiKey: false,
        hasApiKey: true,
        assetCount: 3,
        lastSyncedAt: "2026-01-03T00:00:00.123456+00:00",
        errorCount: 0,
        uniqueErrors: [],
        capabilities: expect.objectContaining({ coverage: "Global" }),
      });
      expect(providers[1]).toMatchObject({
        id: "ALPHA_VANTAGE",
        requiresApiKey: true,
        hasApiKey: true,
        assetCount: 1,
        errorCount: 1,
        lastSyncError: "ALPHA_VANTAGE quota exceeded",
        uniqueErrors: ["ALPHA_VANTAGE quota exceeded"],
      });
      expect(providers[2]).toMatchObject({
        id: "FINNHUB",
        requiresApiKey: true,
        hasApiKey: false,
        errorCount: 1,
        lastSyncError: "Provider FINNHUB failed",
        uniqueErrors: ["Provider FINNHUB failed"],
      });
    } finally {
      db.close();
    }
  });

  test("parses provider sync timestamps like Rust", async () => {
    const db = createMarketDataProvidersDb();
    const service = createMarketDataProviderService(createMarketDataProviderRepository(db));

    try {
      db.query("UPDATE quote_sync_state SET last_synced_at = ? WHERE asset_id = ?").run(
        "2026-02-30T00:00:00Z",
        "asset-2",
      );
      db.query("UPDATE quote_sync_state SET updated_at = ? WHERE asset_id = ?").run(
        "2026-01-05T04:30:00+02:30",
        "asset-4",
      );
      db.query(
        `
          INSERT INTO quote_sync_state (
            asset_id, last_synced_at, data_source, error_count, last_error, updated_at
          )
          VALUES (?, ?, ?, 0, NULL, ?)
        `,
      ).run("asset-5", "2026-01-06T04:30:00.123456+02:30", "FINNHUB", "2026-01-06T00:00:00Z");

      const providers = await service.getProvidersInfo();
      expect(providers.find((provider) => provider.id === "YAHOO")).toMatchObject({
        lastSyncedAt: null,
      });
      expect(providers.find((provider) => provider.id === "FINNHUB")).toMatchObject({
        lastSyncedAt: "2026-01-06T02:00:00.123456+00:00",
        lastSyncError: "Provider FINNHUB failed",
      });
    } finally {
      db.close();
    }
  });

  test("updates priority and enabled state then refreshes the quote client", async () => {
    const db = createMarketDataProvidersDb();
    let refreshCount = 0;
    const service = createMarketDataProviderService(createMarketDataProviderRepository(db), {
      refreshClient: () => {
        refreshCount += 1;
      },
    });

    try {
      await service.updateProviderSettings("FINNHUB", 0, true);
      const providers = await service.getProvidersInfo();

      expect(providers[0]).toMatchObject({
        id: "FINNHUB",
        priority: 0,
        enabled: true,
      });
      expect(refreshCount).toBe(1);
      await expect(service.updateProviderSettings("FINNHUB", 4.5, true)).rejects.toThrow(
        "Priority must be an integer between -2147483648 and 2147483647",
      );
      await expect(service.updateProviderSettings("FINNHUB", 2_147_483_648, true)).rejects.toThrow(
        "Priority must be an integer between -2147483648 and 2147483647",
      );
      expect(refreshCount).toBe(1);
      await expect(service.updateProviderSettings("MISSING", 99, true)).rejects.toThrow(
        "Market data provider not found: MISSING",
      );
    } finally {
      db.close();
    }
  });
});

export function createMarketDataProvidersDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE market_data_providers (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      url TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      logo_filename TEXT,
      last_synced_at TEXT,
      last_sync_status TEXT,
      last_sync_error TEXT,
      provider_type TEXT NOT NULL DEFAULT 'builtin',
      config TEXT
    );

    CREATE TABLE quote_sync_state (
      asset_id TEXT PRIMARY KEY NOT NULL,
      last_synced_at TEXT,
      data_source TEXT NOT NULL,
      error_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      updated_at TEXT NOT NULL
    );

    INSERT INTO market_data_providers (
      id, name, description, url, priority, enabled, logo_filename, provider_type
    )
    VALUES
      ('YAHOO', 'Yahoo Finance', 'Yahoo provider', 'https://finance.yahoo.com/', 1, 1, 'yahoo-finance.png', 'builtin'),
      ('ALPHA_VANTAGE', 'Alpha Vantage', 'Alpha provider', 'https://www.alphavantage.co/', 3, 1, 'alpha-vantage.png', 'builtin'),
      ('FINNHUB', 'Finnhub', 'Finnhub provider', 'https://finnhub.io/', 4, 0, 'finnhub.png', 'builtin');

    INSERT INTO quote_sync_state (
      asset_id, last_synced_at, data_source, error_count, last_error, updated_at
    )
    VALUES
      ('asset-1', '2026-01-01T00:00:00Z', 'YAHOO', 0, NULL, '2026-01-01T00:00:00Z'),
      ('asset-2', '2026-01-03T00:00:00.123456Z', 'YAHOO', 0, NULL, '2026-01-03T00:00:00Z'),
      ('asset-3', '2026-01-02T00:00:00Z', 'ALPHA_VANTAGE', 1, 'ALPHA_VANTAGE quota exceeded', '2026-01-04T00:00:00Z'),
      ('asset-4', NULL, 'YAHOO', 2, 'Provider FINNHUB failed', '2026-01-05T00:00:00Z');
  `);
  return db;
}
