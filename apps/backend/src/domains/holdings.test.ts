import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import {
  createHoldingsService,
  HOLDINGS_CHANGED_EVENT,
  MANUAL_SNAPSHOT_SAVED_EVENT,
} from "./holdings";
import type {
  AllocationHoldings,
  Holding,
  HoldingsSnapshotSyncEvent,
  HoldingsServiceOptions,
  PortfolioAllocations,
} from "./holdings";
import type { BackendEvent, BackendEventBus } from "../events";

describe("TS holdings domain", () => {
  test("reads historical and latest account valuations from SQLite", async () => {
    const db = createHoldingsDb();
    const service = createHoldingsService(db);

    try {
      insertAccount(db, { id: "a1", name: "Alpha" });
      insertAccount(db, { id: "a2", name: "Beta Archived", isArchived: 1 });
      insertAccount(db, { id: "inactive", name: "Inactive", isActive: 0 });
      insertAsset(db, {
        id: "asset-1",
        kind: "INVESTMENT",
        name: "Acme Corp",
        displayCode: "ACME",
        quoteMode: "MARKET",
      });
      insertValuation(db, {
        accountId: "a1",
        date: "2026-01-01",
        totalValue: "100.123456789",
        netContribution: "90",
      });
      insertValuation(db, {
        accountId: "a1",
        date: "2026-01-02",
        totalValue: "110",
        netContribution: "95",
        fxRateToBase: "1.2",
      });
      insertValuation(db, {
        accountId: "a2",
        date: "2026-01-03",
        totalValue: "50",
        netContribution: "50",
      });
      insertValuation(db, {
        accountId: "inactive",
        date: "2026-01-04",
        totalValue: "999",
        netContribution: "1",
      });
      insertSnapshot(db, {
        id: "a1-2026-01-01",
        accountId: "a1",
        date: "2026-01-01",
        source: "MANUAL_ENTRY",
        positions: {
          "asset-1": {
            assetId: "asset-1",
            quantity: "2",
            totalCostBasis: "150",
            currency: "USD",
            inceptionDate: "2025-12-31T00:00:00Z",
            contractMultiplier: "1",
          },
        },
        cashBalances: { USD: "10", CAD: "5" },
      });
      insertSnapshot(db, {
        id: "a1-2026-01-02",
        accountId: "a1",
        date: "2026-01-02",
        positions: {},
        cashBalances: {},
      });

      expect(service.getHistoricalValuations("a1", "2026-01-02")).toEqual([
        expect.objectContaining({
          id: "a1-2026-01-02",
          accountId: "a1",
          valuationDate: "2026-01-02",
          fxRateToBase: 1.2,
          totalValue: 110,
          netContribution: 95,
        }),
      ]);
      expect(service.getLatestValuations(["missing", "a1", "a2"])).toEqual([
        expect.objectContaining({ accountId: "a1", valuationDate: "2026-01-02" }),
        expect.objectContaining({ accountId: "a2", valuationDate: "2026-01-03" }),
      ]);
      expect(service.getLatestValuations()).toEqual([
        expect.objectContaining({ accountId: "a1" }),
        expect.objectContaining({ accountId: "a2" }),
      ]);
      expect(service.getSnapshots("a1", "2026-01-02")).toEqual([
        {
          id: "a1-2026-01-02",
          snapshotDate: "2026-01-02",
          source: "CALCULATED",
          positionCount: 0,
          cashCurrencyCount: 0,
        },
      ]);
      expect(service.getSnapshots("a1", "2026-01-01", "2026-01-01")).toEqual([
        {
          id: "a1-2026-01-01",
          snapshotDate: "2026-01-01",
          source: "MANUAL_ENTRY",
          positionCount: 1,
          cashCurrencyCount: 2,
        },
      ]);
      expect(service.getSnapshotByDate("a1", "2026-01-01")).toEqual([
        expect.objectContaining({
          id: "SEC-a1-asset-1",
          accountId: "a1",
          holdingType: "security",
          quantity: 2,
          openDate: "2025-12-31T00:00:00Z",
          localCurrency: "USD",
          baseCurrency: "USD",
          marketValue: { local: 0, base: 0 },
          costBasis: { local: 150, base: 0 },
          instrument: expect.objectContaining({
            id: "asset-1",
            symbol: "ACME",
            pricingMode: "MARKET",
          }),
        }),
        expect.objectContaining({
          id: "CASH-a1-USD",
          holdingType: "cash",
          instrument: expect.objectContaining({ id: "cash:USD", symbol: "USD" }),
          quantity: 10,
          marketValue: { local: 10, base: 0 },
          price: 1,
        }),
        expect.objectContaining({
          id: "CASH-a1-CAD",
          holdingType: "cash",
          quantity: 5,
        }),
      ]);
      await expect(service.getSnapshotByDate("a1", "2026-01-03")).rejects.toThrow(
        "No snapshot found for date 2026-01-03",
      );
      expect(
        await service.checkHoldingsImport({
          accountId: "a1",
          snapshots: [
            {
              date: "2026-01-01",
              positions: [
                { symbol: " acme ", quantity: "3", avgCost: "bad", currency: "USD" },
                { symbol: "UNKNOWN", quantity: "1", currency: "USD" },
              ],
              cashBalances: {},
            },
            {
              date: "not-a-date",
              positions: [{ symbol: "IGNORED", quantity: "bad", currency: "USD" }],
              cashBalances: {},
            },
            {
              date: "2026-01-05",
              positions: [{ symbol: "", quantity: "NaN", currency: "USD" }],
              cashBalances: {},
            },
          ],
        }),
      ).toEqual({
        existingDates: ["2026-01-01"],
        symbols: [
          {
            symbol: "ACME",
            found: true,
            assetName: "Acme Corp",
            assetId: "asset-1",
            currency: "USD",
            exchangeMic: null,
          },
          {
            symbol: "UNKNOWN",
            found: false,
            assetName: null,
            assetId: null,
            currency: null,
            exchangeMic: null,
          },
          {
            symbol: "",
            found: false,
            assetName: null,
            assetId: null,
            currency: null,
            exchangeMic: null,
          },
        ],
        validationErrors: [
          "Date 2026-01-01: invalid avg cost 'bad' for  acme ",
          "Invalid date format: 'not-a-date'",
          "Date 2026-01-05: empty symbol found",
          "Date 2026-01-05: invalid quantity 'NaN' for ",
        ],
      });
      await service.deleteSnapshot("a1", "2026-01-01");
      expect(service.getSnapshots("a1", "2026-01-01", "2026-01-01")).toEqual([]);
      await expect(service.deleteSnapshot("a1", "2026-01-02")).rejects.toThrow(
        "Cannot delete calculated snapshots. Only manual or imported snapshots can be deleted.",
      );
      await expect(service.deleteSnapshot("a1", "2026-01-03")).rejects.toThrow(
        "No snapshot found for date 2026-01-03",
      );
      expect(await service.getHoldings("a1")).toEqual([]);
    } finally {
      db.close();
    }
  });

  test("saves manual holdings snapshots and minimal manual assets", async () => {
    const db = createHoldingsDb();
    const service = createHoldingsService(db, { today: () => "2026-02-15" });

    try {
      insertAccount(db, { id: "a1", name: "Alpha", currency: "CAD" });

      await service.saveManualHoldings({
        accountId: "a1",
        snapshotDate: "2026-02-15",
        holdings: [
          {
            symbol: "MAN",
            quantity: "2",
            currency: "USD",
            averageCost: "5",
            name: "Manual Asset",
            dataSource: "MANUAL",
            assetKind: "INVESTMENT",
          },
          {
            symbol: "ZERO",
            quantity: "0",
            currency: "USD",
            averageCost: "1",
          },
          {
            symbol: "MAN",
            quantity: "1",
            currency: "USD",
            averageCost: "8",
          },
        ],
        cashBalances: { CAD: "100", USD: "0" },
      });

      expect(service.getSnapshots("a1")).toEqual([
        expect.objectContaining({
          snapshotDate: "2025-11-15",
          source: "SYNTHETIC",
          positionCount: 1,
          cashCurrencyCount: 1,
        }),
        expect.objectContaining({
          snapshotDate: "2026-02-15",
          source: "MANUAL_ENTRY",
          positionCount: 1,
          cashCurrencyCount: 1,
        }),
      ]);
      expect(
        db
          .query<
            { cost_basis: string; net_contribution: string },
            [string]
          >("SELECT cost_basis, net_contribution FROM holdings_snapshots WHERE snapshot_date = ?")
          .get("2025-11-15"),
      ).toEqual({ cost_basis: "18", net_contribution: "0" });

      const asset = db
        .query<
          { id: string; quote_mode: string; quote_ccy: string },
          [string]
        >("SELECT id, quote_mode, quote_ccy FROM assets WHERE display_code = ?")
        .get("MAN");
      expect(asset).toEqual(expect.objectContaining({ quote_mode: "MANUAL", quote_ccy: "USD" }));
      expect(
        db
          .query<
            { close: string; currency: string },
            [string]
          >("SELECT close, currency FROM quotes WHERE asset_id = ?")
          .get(asset?.id ?? ""),
      ).toEqual({ close: "6", currency: "USD" });

      expect(service.getSnapshotByDate("a1", "2026-02-15")).toEqual([
        expect.objectContaining({
          id: `SEC-a1-${asset?.id}`,
          quantity: 3,
          localCurrency: "USD",
          baseCurrency: "CAD",
          costBasis: { local: 18, base: 0 },
        }),
        expect.objectContaining({
          id: "CASH-a1-CAD",
          quantity: 100,
          baseCurrency: "CAD",
        }),
      ]);

      await service.saveManualHoldings({
        accountId: "a1",
        snapshotDate: "2026-02-15",
        holdings: [
          {
            assetId: asset?.id,
            symbol: "MAN",
            quantity: "3",
            currency: "USD",
            averageCost: "6",
          },
        ],
        cashBalances: {},
      });

      expect(service.getSnapshots("a1").map((snapshot) => snapshot.snapshotDate)).toEqual([
        "2025-11-15",
        "2026-02-15",
      ]);
      expect(service.getSnapshotByDate("a1", "2026-02-15")).toEqual([
        expect.objectContaining({
          id: `SEC-a1-${asset?.id}`,
          quantity: 3,
          costBasis: { local: 18, base: 0 },
        }),
      ]);
      await expect(
        service.saveManualHoldings({
          accountId: "missing",
          holdings: [],
          cashBalances: {},
        }),
      ).rejects.toThrow("Record not found: account missing");
    } finally {
      db.close();
    }
  });

  test("queues sync events for syncable holdings snapshots after successful writes", async () => {
    const db = createHoldingsDb();
    const syncEvents: HoldingsSnapshotSyncEvent[] = [];
    const service = createHoldingsService(db, {
      queueSnapshotSyncEvent: (event) => syncEvents.push(event),
      today: () => "2026-02-15",
    });

    try {
      insertAccount(db, { id: "a1", name: "Alpha", currency: "CAD" });

      await service.saveManualHoldings({
        accountId: "a1",
        snapshotDate: "2026-02-15",
        holdings: [
          {
            symbol: "MAN",
            quantity: "2",
            currency: "USD",
            averageCost: "5",
            name: "Manual Asset",
          },
        ],
        cashBalances: { CAD: "100" },
      });

      expect(syncEvents).toEqual([
        expect.objectContaining({
          operation: "Create",
          payload: expect.objectContaining({
            account_id: "a1",
            snapshot_date: "2026-02-15",
            source: "MANUAL_ENTRY",
            net_contribution_base: "0",
            cash_total_account_currency: "0",
            cash_total_base_currency: "0",
          }),
        }),
        expect.objectContaining({
          operation: "Create",
          payload: expect.objectContaining({
            account_id: "a1",
            snapshot_date: "2025-11-15",
            source: "SYNTHETIC",
          }),
        }),
      ]);
      expect(syncEvents[0]?.snapshotId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      const manualSnapshotId = syncEvents[0]?.snapshotId;

      syncEvents.length = 0;
      await service.deleteSnapshot("a1", "2026-02-15");
      expect(syncEvents).toEqual([
        {
          snapshotId: manualSnapshotId,
          operation: "Delete",
          payload: { id: manualSnapshotId },
        },
      ]);

      syncEvents.length = 0;
      insertSnapshot(db, {
        id: "not-a-uuid",
        accountId: "a1",
        date: "2026-02-14",
        source: "CSV_IMPORT",
        positions: {},
        cashBalances: {},
      });
      await service.deleteSnapshot("a1", "2026-02-14");
      expect(syncEvents).toEqual([]);
    } finally {
      db.close();
    }
  });

  test("imports holdings snapshots with per-date failures", async () => {
    const db = createHoldingsDb();
    const service = createHoldingsService(db, { today: () => "2026-03-15" });

    try {
      insertAccount(db, { id: "a1", name: "Alpha", currency: "CAD" });
      insertAsset(db, {
        id: "asset-1",
        kind: "INVESTMENT",
        name: "Acme Corp",
        displayCode: "ACME",
        quoteMode: "MARKET",
      });

      expect(
        await service.importHoldingsCsv({
          accountId: "a1",
          snapshots: [
            {
              date: "2026-03-01",
              positions: [
                {
                  assetId: "asset-1",
                  symbol: "ACME",
                  quantity: "2",
                  avgCost: "10",
                  currency: "USD",
                },
                { symbol: "acme", quantity: "1", avgCost: "7", currency: "USD" },
                {
                  symbol: "NEW",
                  quantity: "3",
                  avgCost: "bad",
                  currency: "USD",
                  exchangeMic: "XNYS",
                },
              ],
              cashBalances: { CAD: "50", USD: "0" },
            },
            {
              date: "2026-03-02",
              positions: [{ symbol: "BAD", quantity: "oops", currency: "USD" }],
              cashBalances: {},
            },
            {
              date: "not-a-date",
              positions: [{ symbol: "SKIP", quantity: "1", currency: "USD" }],
              cashBalances: {},
            },
          ],
        }),
      ).toEqual({
        snapshotsImported: 1,
        snapshotsFailed: 2,
        errors: [
          "Date 2026-03-02: Invalid quantity for BAD",
          "Date not-a-date: Invalid date format: not-a-date",
        ],
      });

      expect(service.getSnapshots("a1")).toEqual([
        expect.objectContaining({
          snapshotDate: "2025-12-01",
          source: "SYNTHETIC",
          positionCount: 2,
          cashCurrencyCount: 1,
        }),
        expect.objectContaining({
          snapshotDate: "2026-03-01",
          source: "CSV_IMPORT",
          positionCount: 2,
          cashCurrencyCount: 1,
        }),
      ]);

      const importedAsset = db
        .query<
          {
            id: string;
            quote_mode: string;
            quote_ccy: string;
            instrument_exchange_mic: string | null;
          },
          []
        >(
          "SELECT id, quote_mode, quote_ccy, instrument_exchange_mic FROM assets WHERE display_code = 'NEW'",
        )
        .get();
      expect(importedAsset).toEqual(
        expect.objectContaining({
          quote_mode: "MARKET",
          quote_ccy: "USD",
          instrument_exchange_mic: "XNYS",
        }),
      );
      expect(db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM quotes").get()).toEqual(
        {
          count: 0,
        },
      );
      expect(service.getSnapshotByDate("a1", "2026-03-01")).toEqual([
        expect.objectContaining({
          id: "SEC-a1-asset-1",
          quantity: 3,
          costBasis: { local: 27, base: 0 },
        }),
        expect.objectContaining({
          id: `SEC-a1-${importedAsset?.id}`,
          quantity: 3,
          costBasis: { local: 0, base: 0 },
        }),
        expect.objectContaining({
          id: "CASH-a1-CAD",
          quantity: 50,
        }),
      ]);
      await expect(
        service.importHoldingsCsv({ accountId: "missing", snapshots: [] }),
      ).rejects.toThrow("Record not found: account missing");
    } finally {
      db.close();
    }
  });

  test("uses provider-backed exact symbol matches for holdings import checks", async () => {
    const db = createHoldingsDb();
    const searchedSymbols: string[] = [];
    const service = createHoldingsService(db, {
      symbolSearch(symbol) {
        searchedSymbols.push(symbol);
        if (symbol === "FAIL") {
          throw new Error("provider unavailable");
        }
        return [
          {
            symbol: symbol === "FUZZY" ? "FUZZY.TO" : symbol,
            shortName: `${symbol} short`,
            longName: `${symbol} long`,
            exchange: "TOR",
            exchangeMic: "XTSE",
            exchangeName: "Toronto Stock Exchange",
            quoteType: "EQUITY",
            typeDisplay: "Equity",
            currency: "CAD",
            currencySource: "provider",
            dataSource: "YAHOO",
            isExisting: false,
            existingAssetId: null,
            index: "quotes",
            score: 100,
          },
        ];
      },
    });

    try {
      insertAccount(db, { id: "a1", name: "Alpha" });

      await expect(
        service.checkHoldingsImport({
          accountId: "a1",
          snapshots: [
            {
              date: "2026-03-01",
              positions: [
                { symbol: "SHOP", quantity: "1", currency: "CAD" },
                { symbol: "FUZZY", quantity: "1", currency: "CAD" },
                { symbol: "FAIL", quantity: "1", currency: "CAD" },
                { symbol: "", quantity: "1", currency: "CAD" },
              ],
              cashBalances: {},
            },
          ],
        }),
      ).resolves.toEqual({
        existingDates: [],
        validationErrors: ["Date 2026-03-01: empty symbol found"],
        symbols: [
          {
            symbol: "SHOP",
            found: true,
            assetName: "SHOP long",
            assetId: null,
            currency: "CAD",
            exchangeMic: "XTSE",
          },
          {
            symbol: "FUZZY",
            found: false,
            assetName: null,
            assetId: null,
            currency: null,
            exchangeMic: null,
          },
          {
            symbol: "FAIL",
            found: false,
            assetName: null,
            assetId: null,
            currency: null,
            exchangeMic: null,
          },
          {
            symbol: "",
            found: false,
            assetName: null,
            assetId: null,
            currency: null,
            exchangeMic: null,
          },
        ],
      });
      expect(searchedSymbols).toEqual(["SHOP", "FUZZY", "FAIL"]);
    } finally {
      db.close();
    }
  });

  test("ensures FX pairs before persisting manual and imported snapshots", async () => {
    const db = createHoldingsDb();
    const ensuredPairs: Array<[string, string]> = [];
    let failFxEnsure = true;
    const service = createHoldingsService(db, {
      baseCurrency: "USD",
      exchangeRateService: {
        getLatestExchangeRate() {
          return "1";
        },
        ensureFxPairs(pairs) {
          ensuredPairs.push(...pairs);
          if (failFxEnsure) {
            throw new Error("FX pair registration failed");
          }
        },
      },
    });

    try {
      insertAccount(db, { id: "a1", name: "Alpha", currency: "CAD" });
      insertAsset(db, {
        id: "asset-eur",
        kind: "INVESTMENT",
        name: "Euro Asset",
        displayCode: "EURA",
        quoteMode: "MARKET",
        quoteCcy: "EUR",
      });

      await expect(
        service.saveManualHoldings({
          accountId: "a1",
          snapshotDate: "2026-04-01",
          holdings: [
            {
              assetId: "asset-eur",
              symbol: "EURA",
              quantity: "2",
              currency: "GBP",
              averageCost: "5",
            },
          ],
          cashBalances: { JPY: "1000" },
        }),
      ).rejects.toThrow("FX pair registration failed");
      expect(service.getSnapshots("a1")).toEqual([]);
      expect(ensuredPairs).toEqual([
        ["GBP", "CAD"],
        ["EUR", "CAD"],
        ["JPY", "CAD"],
        ["CAD", "USD"],
      ]);

      failFxEnsure = false;
      ensuredPairs.length = 0;
      await expect(
        service.importHoldingsCsv({
          accountId: "a1",
          snapshots: [
            {
              date: "2026-04-01",
              positions: [
                {
                  assetId: "asset-eur",
                  symbol: "EURA",
                  quantity: "2",
                  avgCost: "5",
                  currency: "GBP",
                },
              ],
              cashBalances: { JPY: "1000" },
            },
          ],
        }),
      ).resolves.toEqual({ snapshotsImported: 1, snapshotsFailed: 0, errors: [] });
      expect(ensuredPairs).toEqual([
        ["GBP", "CAD"],
        ["EUR", "CAD"],
        ["JPY", "CAD"],
        ["CAD", "USD"],
      ]);
      expect(service.getSnapshots("a1")).toEqual([
        expect.objectContaining({ snapshotDate: "2026-01-01", source: "SYNTHETIC" }),
        expect.objectContaining({ snapshotDate: "2026-04-01", source: "CSV_IMPORT" }),
      ]);
    } finally {
      db.close();
    }
  });

  test("emits holdings mutation events after successful snapshot changes", async () => {
    const db = createHoldingsDb();
    const events: BackendEvent[] = [];
    const service = createHoldingsService(db, {
      eventBus: recordingEventBus(events),
      today: () => "2026-05-01",
    });

    try {
      insertAccount(db, { id: "a1", name: "Alpha", currency: "USD" });
      insertAsset(db, {
        id: "asset-1",
        kind: "INVESTMENT",
        name: "Acme Corp",
        displayCode: "ACME",
        quoteMode: "MARKET",
      });

      await service.saveManualHoldings({
        accountId: "a1",
        snapshotDate: "2026-05-01",
        holdings: [{ assetId: "asset-1", symbol: "ACME", quantity: "2", currency: "USD" }],
        cashBalances: {},
      });
      expect(events).toEqual([
        {
          name: HOLDINGS_CHANGED_EVENT,
          payload: {
            type: HOLDINGS_CHANGED_EVENT,
            account_ids: ["a1"],
            asset_ids: ["asset-1"],
          },
        },
        {
          name: MANUAL_SNAPSHOT_SAVED_EVENT,
          payload: {
            type: MANUAL_SNAPSHOT_SAVED_EVENT,
            account_id: "a1",
          },
        },
      ]);

      events.length = 0;
      await expect(
        service.importHoldingsCsv({
          accountId: "a1",
          snapshots: [
            {
              date: "2026-05-02",
              positions: [{ assetId: "asset-1", symbol: "ACME", quantity: "3", currency: "USD" }],
              cashBalances: {},
            },
            {
              date: "2026-05-03",
              positions: [{ symbol: "BAD", quantity: "oops", currency: "USD" }],
              cashBalances: {},
            },
          ],
        }),
      ).resolves.toEqual({
        snapshotsImported: 1,
        snapshotsFailed: 1,
        errors: ["Date 2026-05-03: Invalid quantity for BAD"],
      });
      expect(events).toEqual([
        {
          name: HOLDINGS_CHANGED_EVENT,
          payload: {
            type: HOLDINGS_CHANGED_EVENT,
            account_ids: ["a1"],
            asset_ids: ["asset-1"],
          },
        },
        {
          name: MANUAL_SNAPSHOT_SAVED_EVENT,
          payload: {
            type: MANUAL_SNAPSHOT_SAVED_EVENT,
            account_id: "a1",
          },
        },
      ]);

      events.length = 0;
      await service.deleteSnapshot("a1", "2026-05-02");
      expect(events).toEqual([
        {
          name: HOLDINGS_CHANGED_EVENT,
          payload: {
            type: HOLDINGS_CHANGED_EVENT,
            account_ids: ["a1"],
            asset_ids: ["asset-1"],
          },
        },
      ]);

      events.length = 0;
      insertSnapshot(db, {
        id: "a1-2026-05-04",
        accountId: "a1",
        date: "2026-05-04",
        source: "CALCULATED",
        positions: { "asset-1": snapshotPosition("asset-1", "1", "1", "USD", "1") },
        cashBalances: {},
      });
      await expect(service.deleteSnapshot("a1", "2026-05-04")).rejects.toThrow(
        "Cannot delete calculated snapshots. Only manual or imported snapshots can be deleted.",
      );
      expect(events).toEqual([]);
    } finally {
      db.close();
    }
  });

  test("calculates live holdings from the latest snapshot with quotes and FX", async () => {
    const db = createHoldingsDb();
    const service = createHoldingsService(db, {
      baseCurrency: "USD",
      exchangeRateService: fakeExchangeRateService({
        "CAD->USD": "0.75",
        "GBp->USD": "0.0125",
        "GBP->GBp": "100",
        "GBP->USD": "1.25",
      }),
      today: () => "2026-01-06",
    });

    try {
      insertAccount(db, { id: "a1", name: "Alpha" });
      insertAccount(db, { id: "a2", name: "Beta" });
      insertAsset(db, {
        id: "lse-share",
        kind: "INVESTMENT",
        name: "London Share",
        displayCode: "LSE",
        quoteMode: "MARKET",
        quoteCcy: "GBp",
        instrumentSymbol: "LSE",
      });
      insertAsset(db, {
        id: "no-quote",
        kind: "INVESTMENT",
        name: "No Quote",
        displayCode: "NOQ",
        quoteMode: "MARKET",
      });
      insertAsset(db, {
        id: "property",
        kind: "PROPERTY",
        name: "Rental Property",
        displayCode: "HOME",
        quoteMode: "MANUAL",
        metadata: { purchase_price: "80000" },
      });
      insertAsset(db, {
        id: "option-live",
        kind: "INVESTMENT",
        name: "Live Option",
        displayCode: "AAPL260117C00100000",
        quoteMode: "MARKET",
        instrumentType: "OPTION",
        instrumentSymbol: "AAPL260117C00100000",
      });
      insertAsset(db, {
        id: "option-expired",
        kind: "INVESTMENT",
        name: "Expired Option",
        displayCode: "AAPL250117C00100000",
        quoteMode: "MARKET",
        instrumentType: "OPTION",
        instrumentSymbol: "AAPL250117C00100000",
      });
      insertSnapshot(db, {
        id: "a1-2026-01-05",
        accountId: "a1",
        date: "2026-01-05",
        positions: {
          "lse-share": snapshotPosition("lse-share", "2", "600", "GBp", "1"),
          "no-quote": snapshotPosition("no-quote", "1", "20", "USD", "1"),
          property: snapshotPosition("property", "0.5", "40000", "USD", "1"),
          "option-live": snapshotPosition("option-live", "1", "50", "USD", "100"),
          "option-expired": snapshotPosition("option-expired", "1", "30", "USD", "100"),
          missing: snapshotPosition("missing", "1", "10", "USD", "1"),
        },
        cashBalances: { CAD: "10", USD: "0" },
      });
      insertSnapshot(db, {
        id: "a2-2026-01-05",
        accountId: "a2",
        date: "2026-01-05",
        positions: {
          "lse-share": snapshotPosition("lse-share", "1", "300", "GBp", "1"),
        },
        cashBalances: {},
      });
      insertQuote(db, {
        id: "lse-share-2026-01-05-broker",
        assetId: "lse-share",
        day: "2026-01-05",
        source: "BROKER",
        close: "1000",
        currency: "GBp",
      });
      insertQuote(db, {
        id: "lse-share-2026-01-05-manual",
        assetId: "lse-share",
        day: "2026-01-05",
        source: "MANUAL",
        close: "500",
        currency: "GBp",
      });
      insertQuote(db, {
        id: "property-2026-01-05",
        assetId: "property",
        day: "2026-01-05",
        source: "MANUAL",
        close: "100000",
        currency: "USD",
      });
      insertQuote(db, {
        id: "option-live-2026-01-04",
        assetId: "option-live",
        day: "2026-01-04",
        source: "YAHOO",
        close: "1.5",
        currency: "USD",
      });
      insertQuote(db, {
        id: "option-live-2026-01-05",
        assetId: "option-live",
        day: "2026-01-05",
        source: "YAHOO",
        close: "2",
        currency: "USD",
      });

      const holdings = (await service.getHoldings("a1")) as Holding[];

      expect(holdings.map((holding) => holding.id)).not.toContain("SEC-a1-option-expired");
      expect(holdings.map((holding) => holding.id)).not.toContain("SEC-a1-missing");

      const lse = holdingById(holdings, "SEC-a1-lse-share");
      expect(lse.localCurrency).toBe("GBP");
      expect(lse.instrument?.currency).toBe("GBP");
      expect(lse.fxRate).toBe(1.25);
      expect(lse.price).toBe(5);
      expect(lse.marketValue).toEqual({ local: 10, base: 12.5 });
      expect(lse.costBasis).toEqual({ local: 6, base: 7.5 });
      expect(lse.prevCloseValue).toEqual({ local: 20, base: 25 });
      expect(lse.dayChange).toEqual({ local: -10, base: -12.5 });
      expect(lse.dayChangePct).toBe(-0.5);
      expect(lse.unrealizedGain).toEqual({ local: 4, base: 5 });
      expect(lse.unrealizedGainPct).toBe(0.6667);

      const noQuote = holdingById(holdings, "SEC-a1-no-quote");
      expect(noQuote.fxRate).toBe(1);
      expect(noQuote.costBasis).toEqual({ local: 20, base: 20 });
      expect(noQuote.marketValue).toEqual({ local: 0, base: 0 });
      expect(noQuote.price).toBeNull();

      const property = holdingById(holdings, "ALT-a1-property");
      expect(property.holdingType).toBe("alternativeAsset");
      expect(property.marketValue).toEqual({ local: 50000, base: 50000 });
      expect(property.price).toBe(100000);
      expect(property.unrealizedGain).toEqual({ local: 10000, base: 10000 });
      expect(property.unrealizedGainPct).toBe(0.25);
      expect(property.dayChange).toBeNull();

      const option = holdingById(holdings, "SEC-a1-option-live");
      expect(option.contractMultiplier).toBe(100);
      expect(option.marketValue).toEqual({ local: 200, base: 200 });
      expect(option.prevCloseValue).toEqual({ local: 150, base: 150 });
      expect(option.dayChange).toEqual({ local: 50, base: 50 });
      expect(option.dayChangePct).toBe(0.3333);

      const cash = holdingById(holdings, "CASH-a1-CAD");
      expect(cash.fxRate).toBe(0.75);
      expect(cash.marketValue).toEqual({ local: 10, base: 7.5 });
      expect(cash.costBasis).toEqual({ local: 10, base: 7.5 });
      expect(cash.prevCloseValue).toEqual({ local: 10, base: 7.5 });
      expect(cash.totalGain).toEqual({ local: 0, base: 0 });

      const totalWeight = holdings.reduce((sum, holding) => sum + holding.weight, 0);
      expect(totalWeight).toBeCloseTo(1, 8);

      const detail = (await service.getHolding("a1", "lse-share")) as Holding;
      expect(detail.id).toBe("SEC-a1-lse-share");
      expect(detail.weight).toBe(lse.weight);
      await expect(service.getHolding("a1", "missing")).rejects.toThrow(
        "Failed to build holding view for missing",
      );
      expect(await service.getHolding("a1", "option-expired")).toBeNull();
      expect(await service.getHolding("a1", "not-in-snapshot")).toBeNull();

      const assetHoldings = (await service.getAssetHoldings("lse-share")) as Holding[];
      expect(assetHoldings.map((holding) => holding.accountId)).toEqual(["a1", "a2"]);
      expect(assetHoldings[1]?.weight).toBe(1);
    } finally {
      db.close();
    }
  });

  test("calculates taxonomy allocations and drill-down holdings from live holdings", async () => {
    const db = createHoldingsDb();
    const service = createHoldingsService(db, {
      baseCurrency: "USD",
      exchangeRateService: fakeExchangeRateService({}),
      today: () => "2026-01-06",
    });

    try {
      insertAccount(db, { id: "a1", name: "Alpha" });
      insertAsset(db, {
        id: "stock",
        kind: "INVESTMENT",
        name: "Stock Co",
        displayCode: "STK",
        quoteMode: "MARKET",
      });
      insertAsset(db, {
        id: "bond",
        kind: "INVESTMENT",
        name: "Bond Co",
        displayCode: "BND",
        quoteMode: "MARKET",
      });
      insertAsset(db, {
        id: "partial",
        kind: "INVESTMENT",
        name: "Partial ETF",
        displayCode: "PRT",
        quoteMode: "MARKET",
      });
      insertAsset(db, {
        id: "unknown",
        kind: "INVESTMENT",
        name: "Unclassified",
        displayCode: "UNK",
        quoteMode: "MARKET",
      });
      insertSnapshot(db, {
        id: "a1-2026-01-05",
        accountId: "a1",
        date: "2026-01-05",
        positions: {
          stock: snapshotPosition("stock", "1", "0", "USD", "1"),
          bond: snapshotPosition("bond", "1", "0", "USD", "1"),
          partial: snapshotPosition("partial", "1", "0", "USD", "1"),
          unknown: snapshotPosition("unknown", "1", "0", "USD", "1"),
        },
        cashBalances: { USD: "50" },
      });
      insertQuote(db, {
        id: "stock-2026-01-05",
        assetId: "stock",
        day: "2026-01-05",
        source: "MANUAL",
        close: "100",
        currency: "USD",
      });
      insertQuote(db, {
        id: "bond-2026-01-05",
        assetId: "bond",
        day: "2026-01-05",
        source: "MANUAL",
        close: "40",
        currency: "USD",
      });
      insertQuote(db, {
        id: "partial-2026-01-05",
        assetId: "partial",
        day: "2026-01-05",
        source: "MANUAL",
        close: "200",
        currency: "USD",
      });
      insertQuote(db, {
        id: "unknown-2026-01-05",
        assetId: "unknown",
        day: "2026-01-05",
        source: "MANUAL",
        close: "10",
        currency: "USD",
      });
      seedAllocationTaxonomies(db);
      insertAssignment(db, {
        assetId: "stock",
        taxonomyId: "asset_classes",
        categoryId: "EQUITY_US",
        weight: 10_000,
      });
      insertAssignment(db, {
        assetId: "partial",
        taxonomyId: "asset_classes",
        categoryId: "EQUITY_US",
        weight: 2_500,
      });
      insertAssignment(db, {
        assetId: "bond",
        taxonomyId: "asset_classes",
        categoryId: "DEBT",
        weight: 10_000,
      });
      insertAssignment(db, {
        assetId: "stock",
        taxonomyId: "industries_gics",
        categoryId: "SOFTWARE",
        weight: 10_000,
      });
      insertAssignment(db, {
        assetId: "stock",
        taxonomyId: "custom_theme",
        categoryId: "GROWTH",
        weight: 10_000,
      });

      const allocations = (await service.getPortfolioAllocations("a1")) as PortfolioAllocations;

      expect(allocations.totalValue).toBe(400);
      expect(allocations.assetClasses.taxonomyName).toBe("Asset Classes");
      expect(allocations.assetClasses.categories).toEqual([
        {
          categoryId: "EQUITY",
          categoryName: "Equity",
          color: "#00aa00",
          value: 150,
          percentage: 37.5,
          children: [
            {
              categoryId: "EQUITY_US",
              categoryName: "US Equity",
              color: "#00bb00",
              value: 150,
              percentage: 37.5,
            },
          ],
        },
        {
          categoryId: "CASH",
          categoryName: "Cash",
          color: "#999999",
          value: 50,
          percentage: 12.5,
          children: [
            {
              categoryId: "CASH_BANK_DEPOSITS",
              categoryName: "Bank Deposits",
              color: "#aaaaaa",
              value: 50,
              percentage: 12.5,
            },
          ],
        },
        {
          categoryId: "DEBT",
          categoryName: "Debt",
          color: "#0000aa",
          value: 40,
          percentage: 10,
        },
        {
          categoryId: "__UNKNOWN__",
          categoryName: "Unknown",
          color: "#878580",
          value: 10,
          percentage: 2.5,
        },
      ]);
      expect(allocations.assetClasses.categories[2]?.children).toBeUndefined();
      expect(allocations.sectors.taxonomyName).toBe("Sectors");
      expect(allocations.sectors.categories[0]).toMatchObject({
        categoryId: "__UNKNOWN__",
        value: 250,
        percentage: 71.43,
      });
      expect(allocations.customGroups.map((group) => group.taxonomyId)).toEqual([
        "custom_theme",
        "custom_unassigned",
      ]);
      expect(allocations.customGroups[1]?.categories).toEqual([
        {
          categoryId: "__UNKNOWN__",
          categoryName: "Unknown",
          color: "#878580",
          value: 350,
          percentage: 100,
        },
      ]);

      const equityHoldings = (await service.getHoldingsByAllocation(
        "a1",
        "asset_classes",
        "EQUITY",
      )) as AllocationHoldings;
      expect(equityHoldings).toMatchObject({
        taxonomyId: "asset_classes",
        taxonomyName: "Asset Classes",
        categoryId: "EQUITY",
        categoryName: "Equity",
        totalValue: 150,
        currency: "USD",
      });
      expect(equityHoldings.holdings).toEqual([
        expect.objectContaining({
          id: "stock",
          symbol: "STK",
          holdingType: "security",
          marketValue: 100,
          weightInCategory: 66.67,
        }),
        expect.objectContaining({
          id: "partial",
          symbol: "PRT",
          marketValue: 50,
          weightInCategory: 33.33,
        }),
      ]);

      const cashHoldings = (await service.getHoldingsByAllocation(
        "a1",
        "asset_classes",
        "CASH",
      )) as AllocationHoldings;
      expect(cashHoldings.totalValue).toBe(50);
      expect(cashHoldings.holdings).toEqual([
        expect.objectContaining({ id: "cash:USD", marketValue: 50, weightInCategory: 100 }),
      ]);

      const unknownAssetClassHoldings = (await service.getHoldingsByAllocation(
        "a1",
        "asset_classes",
        "__UNKNOWN__",
      )) as AllocationHoldings;
      expect(unknownAssetClassHoldings.totalValue).toBe(60);
      expect(unknownAssetClassHoldings.holdings.map((holding) => holding.id)).toEqual([
        "cash:USD",
        "unknown",
      ]);
    } finally {
      db.close();
    }
  });

  test("returns empty default allocations when no live holdings exist", async () => {
    const db = createHoldingsDb();
    const service = createHoldingsService(db);

    try {
      expect(await service.getPortfolioAllocations("missing")).toEqual({
        assetClasses: {
          taxonomyId: "asset_classes",
          taxonomyName: "Asset Classes",
          color: "#879a39",
          categories: [],
        },
        sectors: {
          taxonomyId: "industries_gics",
          taxonomyName: "Sectors",
          color: "#da702c",
          categories: [],
        },
        regions: {
          taxonomyId: "regions",
          taxonomyName: "Regions",
          color: "#8b7ec8",
          categories: [],
        },
        riskCategory: {
          taxonomyId: "risk_category",
          taxonomyName: "Risk Category",
          color: "#d14d41",
          categories: [],
        },
        securityTypes: {
          taxonomyId: "instrument_type",
          taxonomyName: "Instrument Type",
          color: "#4385be",
          categories: [],
        },
        customGroups: [],
        totalValue: 0,
      });
    } finally {
      db.close();
    }
  });
});

function createHoldingsDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      currency TEXT NOT NULL DEFAULT 'USD',
      is_active INTEGER NOT NULL DEFAULT 1,
      is_archived INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE assets (
      id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL,
      name TEXT,
      display_code TEXT,
      notes TEXT,
      metadata TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      quote_mode TEXT NOT NULL DEFAULT 'MARKET',
      quote_ccy TEXT NOT NULL DEFAULT 'USD',
      instrument_type TEXT,
      instrument_symbol TEXT,
      instrument_exchange_mic TEXT,
      provider_config TEXT
    );
    CREATE TABLE quotes (
      id TEXT PRIMARY KEY NOT NULL,
      asset_id TEXT NOT NULL,
      day TEXT NOT NULL,
      source TEXT NOT NULL,
      close TEXT NOT NULL,
      currency TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z',
      timestamp TEXT NOT NULL
    );
    CREATE TABLE daily_account_valuation (
      id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL,
      valuation_date TEXT NOT NULL,
      account_currency TEXT NOT NULL DEFAULT 'USD',
      base_currency TEXT NOT NULL DEFAULT 'USD',
      fx_rate_to_base TEXT NOT NULL DEFAULT '1',
      cash_balance TEXT NOT NULL DEFAULT '0',
      investment_market_value TEXT NOT NULL DEFAULT '0',
      total_value TEXT NOT NULL,
      cost_basis TEXT NOT NULL DEFAULT '0',
      net_contribution TEXT NOT NULL,
      calculated_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z'
    );
    CREATE TABLE holdings_snapshots (
      id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL,
      snapshot_date TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      positions TEXT NOT NULL DEFAULT '{}',
      cash_balances TEXT NOT NULL DEFAULT '{}',
      cost_basis TEXT NOT NULL DEFAULT '0',
      net_contribution TEXT NOT NULL DEFAULT '0',
      net_contribution_base TEXT NOT NULL DEFAULT '0',
      cash_total_account_currency TEXT NOT NULL DEFAULT '0',
      cash_total_base_currency TEXT NOT NULL DEFAULT '0',
      calculated_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z',
      source TEXT NOT NULL DEFAULT 'CALCULATED'
    );
    CREATE TABLE taxonomies (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      description TEXT,
      is_system INTEGER NOT NULL DEFAULT 0,
      is_single_select INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z',
      updated_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z'
    );
    CREATE TABLE taxonomy_categories (
      id TEXT PRIMARY KEY NOT NULL,
      taxonomy_id TEXT NOT NULL,
      parent_id TEXT,
      name TEXT NOT NULL,
      key TEXT NOT NULL,
      color TEXT NOT NULL,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z',
      updated_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z'
    );
    CREATE TABLE asset_taxonomy_assignments (
      id TEXT PRIMARY KEY NOT NULL,
      asset_id TEXT NOT NULL,
      taxonomy_id TEXT NOT NULL,
      category_id TEXT NOT NULL,
      weight INTEGER NOT NULL DEFAULT 10000,
      source TEXT NOT NULL DEFAULT 'MANUAL',
      created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z',
      updated_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z'
    );
  `);
  return db;
}

function recordingEventBus(events: BackendEvent[]): BackendEventBus {
  return {
    publish(event) {
      events.push(event);
    },
    subscribe() {
      return () => undefined;
    },
  };
}

function insertAccount(
  db: Database,
  account: { id: string; name: string; currency?: string; isActive?: number; isArchived?: number },
): void {
  db.prepare(
    "INSERT INTO accounts (id, name, currency, is_active, is_archived) VALUES (?, ?, ?, ?, ?)",
  ).run(
    account.id,
    account.name,
    account.currency ?? "USD",
    account.isActive ?? 1,
    account.isArchived ?? 0,
  );
}

function insertAsset(
  db: Database,
  asset: {
    id: string;
    kind: string;
    name: string;
    displayCode: string;
    quoteMode: string;
    quoteCcy?: string;
    metadata?: unknown;
    instrumentType?: string;
    instrumentSymbol?: string;
  },
): void {
  db.prepare(
    `
      INSERT INTO assets (
        id, kind, name, display_code, metadata, quote_mode, quote_ccy, instrument_type,
        instrument_symbol
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    asset.id,
    asset.kind,
    asset.name,
    asset.displayCode,
    asset.metadata === undefined ? null : JSON.stringify(asset.metadata),
    asset.quoteMode,
    asset.quoteCcy ?? "USD",
    asset.instrumentType ?? null,
    asset.instrumentSymbol ?? asset.displayCode,
  );
}

function insertSnapshot(
  db: Database,
  snapshot: {
    id: string;
    accountId: string;
    date: string;
    source?: string;
    positions: Record<string, unknown>;
    cashBalances: Record<string, unknown>;
  },
): void {
  db.prepare(
    `
      INSERT INTO holdings_snapshots (
        id, account_id, snapshot_date, source, positions, cash_balances
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `,
  ).run(
    snapshot.id,
    snapshot.accountId,
    snapshot.date,
    snapshot.source ?? "CALCULATED",
    JSON.stringify(snapshot.positions),
    JSON.stringify(snapshot.cashBalances),
  );
}

function snapshotPosition(
  assetId: string,
  quantity: string,
  totalCostBasis: string,
  currency: string,
  contractMultiplier: string,
): Record<string, string> {
  return {
    assetId,
    quantity,
    totalCostBasis,
    currency,
    inceptionDate: "2025-12-31T00:00:00Z",
    contractMultiplier,
  };
}

function insertQuote(
  db: Database,
  quote: {
    id: string;
    assetId: string;
    day: string;
    source: string;
    close: string;
    currency: string;
  },
): void {
  db.prepare(
    `
      INSERT INTO quotes (id, asset_id, day, source, close, currency, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    quote.id,
    quote.assetId,
    quote.day,
    quote.source,
    quote.close,
    quote.currency,
    `${quote.day}T00:00:00Z`,
  );
}

function seedAllocationTaxonomies(db: Database): void {
  insertTaxonomy(db, {
    id: "asset_classes",
    name: "Asset Classes",
    color: "#879a39",
    isSystem: 1,
    sortOrder: 1,
  });
  insertCategory(db, {
    id: "EQUITY",
    taxonomyId: "asset_classes",
    name: "Equity",
    color: "#00aa00",
    sortOrder: 1,
  });
  insertCategory(db, {
    id: "EQUITY_US",
    taxonomyId: "asset_classes",
    parentId: "EQUITY",
    name: "US Equity",
    color: "#00bb00",
    sortOrder: 2,
  });
  insertCategory(db, {
    id: "DEBT",
    taxonomyId: "asset_classes",
    name: "Debt",
    color: "#0000aa",
    sortOrder: 3,
  });
  insertCategory(db, {
    id: "CASH",
    taxonomyId: "asset_classes",
    name: "Cash",
    color: "#999999",
    sortOrder: 4,
  });
  insertCategory(db, {
    id: "CASH_BANK_DEPOSITS",
    taxonomyId: "asset_classes",
    parentId: "CASH",
    name: "Bank Deposits",
    color: "#aaaaaa",
    sortOrder: 5,
  });
  insertTaxonomy(db, {
    id: "industries_gics",
    name: "Industries",
    color: "#da702c",
    isSystem: 1,
    sortOrder: 2,
  });
  insertCategory(db, {
    id: "TECH",
    taxonomyId: "industries_gics",
    name: "Technology",
    color: "#ff8800",
    sortOrder: 1,
  });
  insertCategory(db, {
    id: "SOFTWARE",
    taxonomyId: "industries_gics",
    parentId: "TECH",
    name: "Software",
    color: "#ffaa00",
    sortOrder: 2,
  });
  insertTaxonomy(db, {
    id: "regions",
    name: "Regions",
    color: "#8b7ec8",
    isSystem: 1,
    sortOrder: 3,
  });
  insertTaxonomy(db, {
    id: "risk_category",
    name: "Risk",
    color: "#d14d41",
    isSystem: 1,
    sortOrder: 4,
  });
  insertTaxonomy(db, {
    id: "instrument_type",
    name: "Types",
    color: "#4385be",
    isSystem: 1,
    sortOrder: 5,
  });
  insertTaxonomy(db, {
    id: "custom_theme",
    name: "Theme",
    color: "#123456",
    isSystem: 0,
    sortOrder: 6,
  });
  insertCategory(db, {
    id: "GROWTH",
    taxonomyId: "custom_theme",
    name: "Growth",
    color: "#654321",
    sortOrder: 1,
  });
  insertTaxonomy(db, {
    id: "custom_unassigned",
    name: "Unassigned Theme",
    color: "#abcdef",
    isSystem: 0,
    sortOrder: 7,
  });
  insertCategory(db, {
    id: "UNUSED",
    taxonomyId: "custom_unassigned",
    name: "Unused",
    color: "#fedcba",
    sortOrder: 1,
  });
}

function insertTaxonomy(
  db: Database,
  taxonomy: { id: string; name: string; color: string; isSystem: number; sortOrder: number },
): void {
  db.prepare(
    `
      INSERT INTO taxonomies (id, name, color, is_system, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `,
  ).run(taxonomy.id, taxonomy.name, taxonomy.color, taxonomy.isSystem, taxonomy.sortOrder);
}

function insertCategory(
  db: Database,
  category: {
    id: string;
    taxonomyId: string;
    parentId?: string;
    name: string;
    color: string;
    sortOrder: number;
  },
): void {
  db.prepare(
    `
      INSERT INTO taxonomy_categories (id, taxonomy_id, parent_id, name, key, color, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    category.id,
    category.taxonomyId,
    category.parentId ?? null,
    category.name,
    category.id,
    category.color,
    category.sortOrder,
  );
}

function insertAssignment(
  db: Database,
  assignment: { assetId: string; taxonomyId: string; categoryId: string; weight: number },
): void {
  db.prepare(
    `
      INSERT INTO asset_taxonomy_assignments (
        id, asset_id, taxonomy_id, category_id, weight, source
      )
      VALUES (?, ?, ?, ?, ?, 'MANUAL')
    `,
  ).run(
    `${assignment.assetId}-${assignment.taxonomyId}-${assignment.categoryId}`,
    assignment.assetId,
    assignment.taxonomyId,
    assignment.categoryId,
    assignment.weight,
  );
}

function fakeExchangeRateService(
  rates: Record<string, string>,
): NonNullable<HoldingsServiceOptions["exchangeRateService"]> {
  return {
    getLatestExchangeRate(fromCurrency, toCurrency) {
      if (fromCurrency === toCurrency) {
        return "1";
      }
      const rate = rates[`${fromCurrency}->${toCurrency}`];
      if (rate === undefined) {
        throw new Error(`Missing FX rate ${fromCurrency}->${toCurrency}`);
      }
      return rate;
    },
  };
}

function holdingById(holdings: Holding[], id: string): Holding {
  const holding = holdings.find((candidate) => candidate.id === id);
  expect(holding).toBeDefined();
  return holding as Holding;
}

function insertValuation(
  db: Database,
  valuation: {
    accountId: string;
    date: string;
    totalValue: string;
    netContribution: string;
    fxRateToBase?: string;
  },
): void {
  db.prepare(
    `
      INSERT INTO daily_account_valuation (
        id, account_id, valuation_date, account_currency, base_currency,
        fx_rate_to_base, cash_balance, investment_market_value, total_value,
        cost_basis, net_contribution, calculated_at
      )
      VALUES (?, ?, ?, 'USD', 'USD', ?, '0', ?, ?, ?, ?, ?)
    `,
  ).run(
    `${valuation.accountId}-${valuation.date}`,
    valuation.accountId,
    valuation.date,
    valuation.fxRateToBase ?? "1",
    valuation.totalValue,
    valuation.totalValue,
    valuation.netContribution,
    valuation.netContribution,
    `${valuation.date}T00:00:00Z`,
  );
}
