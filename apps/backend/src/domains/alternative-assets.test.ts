import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { createEventBus } from "../events";
import { createAlternativeAssetService } from "./alternative-assets";

describe("TS alternative assets domain", () => {
  test("creates assets, manual quotes, events, and holdings with Rust-compatible metadata", async () => {
    const db = createAlternativeAssetsDb();
    const eventBus = createEventBus();
    const events: unknown[] = [];
    eventBus.subscribe((event) => events.push(event));
    const service = createAlternativeAssetService(db, {
      eventBus,
      now: fixedNow,
    });

    try {
      const created = await service.createAlternativeAsset({
        kind: "property",
        name: "Cabin",
        currency: "USD",
        currentValue: "125000.00",
        valueDate: "2026-05-14",
        purchasePrice: "100000.00",
        purchaseDate: "2024-01-01",
        metadata: { sub_type: "vacation_home", city: "Paris", appraised: true },
      });

      expect(created.assetId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(typeof created.quoteId).toBe("string");
      expect(events).toEqual([
        {
          name: "assets_created",
          payload: { type: "assets_created", asset_ids: [created.assetId] },
        },
      ]);
      expect(readAsset(db, created.assetId)).toMatchObject({
        kind: "PROPERTY",
        name: "Cabin",
        display_code: "Vacation Home",
        quote_mode: "MANUAL",
        quote_ccy: "USD",
        is_active: 1,
      });
      expect(JSON.parse(readAsset(db, created.assetId).metadata ?? "{}")).toEqual({
        sub_type: "vacation_home",
        city: "Paris",
        appraised: true,
        purchase_price: "100000.00",
        purchase_date: "2024-01-01",
      });
      expect(readQuotes(db, created.assetId)).toEqual([
        expect.objectContaining({
          day: "2024-01-01",
          close: "100000.00",
          timestamp: "2024-01-01T12:00:00+00:00",
          source: "MANUAL",
        }),
        expect.objectContaining({
          id: created.quoteId,
          day: "2026-05-14",
          close: "125000.00",
          timestamp: "2026-05-14T12:00:00+00:00",
          source: "MANUAL",
        }),
      ]);

      expect(await Promise.resolve(service.getAlternativeHoldings())).toEqual([
        {
          id: created.assetId,
          kind: "property",
          name: "Cabin",
          symbol: "Vacation Home",
          currency: "USD",
          marketValue: "125000",
          purchasePrice: "100000.00",
          purchaseDate: "2024-01-01",
          unrealizedGain: "25000",
          unrealizedGainPct: "0.25",
          valuationDate: "2026-05-14T12:00:00+00:00",
          metadata: {
            sub_type: "vacation_home",
            city: "Paris",
            appraised: true,
            purchase_price: "100000.00",
            purchase_date: "2024-01-01",
          },
          linkedAssetId: null,
          notes: null,
        },
      ]);
    } finally {
      db.close();
    }
  });

  test("updates valuations by reusing existing manual quotes for the same asset day and source", async () => {
    const db = createAlternativeAssetsDb();
    const service = createAlternativeAssetService(db, { now: fixedNow });

    try {
      const created = await service.createAlternativeAsset({
        kind: "vehicle",
        name: "Truck",
        currency: "CAD",
        currentValue: "40000.00",
        valueDate: "2026-05-14",
      });

      expect(
        await Promise.resolve(
          service.updateValuation(created.assetId, {
            value: "41000.00",
            date: "2026-05-14",
            notes: "Appraisal",
          }),
        ),
      ).toEqual({
        quoteId: created.quoteId,
        valuationDate: "2026-05-14",
        value: "41000.00",
      });
      expect(readQuotes(db, created.assetId)).toEqual([
        expect.objectContaining({
          id: created.quoteId,
          close: "41000.00",
          currency: "CAD",
          notes: "Appraisal",
        }),
      ]);
    } finally {
      db.close();
    }
  });

  test("links, unlinks, and deletes liabilities with Rust-compatible metadata quirks", async () => {
    const db = createAlternativeAssetsDb();
    const service = createAlternativeAssetService(db, { now: fixedNow });

    try {
      const property = await service.createAlternativeAsset({
        kind: "property",
        name: "Home",
        currency: "USD",
        currentValue: "500000",
        valueDate: "2026-05-14",
      });
      const liability = await service.createAlternativeAsset({
        kind: "liability",
        name: "Mortgage",
        currency: "USD",
        currentValue: "300000",
        valueDate: "2026-05-14",
        metadata: { sub_type: "mortgage", lender: "Bank" },
      });

      await service.linkLiability(liability.assetId, { targetAssetId: property.assetId });
      expect(JSON.parse(readAsset(db, liability.assetId).metadata ?? "{}")).toEqual({
        linked_asset_id: property.assetId,
      });

      await service.unlinkLiability(liability.assetId);
      expect(JSON.parse(readAsset(db, liability.assetId).metadata ?? "{}")).toEqual({
        linked_asset_id: property.assetId,
      });

      await service.deleteAlternativeAsset(property.assetId);
      expect(readAssetOrNull(db, property.assetId)).toBeNull();
      expect(readQuotes(db, property.assetId)).toEqual([]);
      expect(JSON.parse(readAsset(db, liability.assetId).metadata ?? "{}")).toEqual({});
    } finally {
      db.close();
    }
  });

  test("updates details, purchase quotes, and all-metadata removal with Rust-compatible asymmetry", async () => {
    const db = createAlternativeAssetsDb();
    const service = createAlternativeAssetService(db, { now: fixedNow });

    try {
      const asset = await service.createAlternativeAsset({
        kind: "collectible",
        name: "Watch",
        currency: "EUR",
        currentValue: "10000",
        valueDate: "2026-05-14",
        metadata: { sub_type: "luxury_watch", limited: true },
      });

      await service.updateAssetDetails({
        assetId: asset.assetId,
        name: "Watch II",
        notes: "",
        metadata: {
          sub_type: "GOLD_BAR",
          purchase_price: "9000.00",
          purchase_date: "2025-01-01",
        },
      });
      expect(readAsset(db, asset.assetId)).toMatchObject({
        name: "Watch II",
        display_code: "GOLD BAR",
        notes: "",
      });
      expect(JSON.parse(readAsset(db, asset.assetId).metadata ?? "{}")).toEqual({
        sub_type: "GOLD_BAR",
        limited: true,
        purchase_price: "9000.00",
        purchase_date: "2025-01-01",
      });
      expect(readQuotes(db, asset.assetId)).toEqual([
        expect.objectContaining({ day: "2025-01-01", close: "9000.00", currency: "EUR" }),
        expect.objectContaining({ day: "2026-05-14", close: "10000" }),
      ]);

      await service.updateAssetDetails({
        assetId: asset.assetId,
        metadata: {
          sub_type: null,
          limited: null,
          purchase_price: null,
          purchase_date: null,
        },
      });
      expect(readAsset(db, asset.assetId)).toMatchObject({
        display_code: "Collectible",
      });
      expect(JSON.parse(readAsset(db, asset.assetId).metadata ?? "{}")).toEqual({
        sub_type: "GOLD_BAR",
        limited: true,
        purchase_price: "9000.00",
        purchase_date: "2025-01-01",
      });
    } finally {
      db.close();
    }
  });

  test("validates alternative asset inputs before writing", async () => {
    const db = createAlternativeAssetsDb();
    const service = createAlternativeAssetService(db);

    try {
      expect(() =>
        service.createAlternativeAsset({
          kind: "property",
          name: "Home",
          currency: "USD",
          currentValue: "100",
          valueDate: "2026-01-01",
          purchasePrice: "50",
          purchaseDate: "2026-01-01",
        }),
      ).toThrow("Purchase/origination date must be before current value date");
      expect(() =>
        service.createAlternativeAsset({
          kind: "property",
          name: "",
          currency: "USD",
          currentValue: "100",
          valueDate: "2026-01-01",
        }),
      ).toThrow("Asset name cannot be empty");
      expect(readAllAssets(db)).toEqual([]);
    } finally {
      db.close();
    }
  });
});

function createAlternativeAssetsDb(): Database {
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
      instrument_key TEXT,
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
  `);
  return db;
}

function fixedNow(): Date {
  return new Date("2026-05-14T09:00:00.000Z");
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

function readAllAssets(db: Database): Array<Record<string, unknown>> {
  return db.query<Record<string, unknown>, []>("SELECT * FROM assets").all();
}

function readQuotes(db: Database, assetId: string): Array<Record<string, unknown>> {
  return db
    .query<
      Record<string, unknown>,
      [string]
    >("SELECT * FROM quotes WHERE asset_id = ? ORDER BY day ASC")
    .all(assetId);
}
