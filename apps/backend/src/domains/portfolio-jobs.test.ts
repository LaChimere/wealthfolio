import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";

import type { BackendEvent } from "../events";
import {
  DEFAULT_HISTORY_DAYS,
  buildPortfolioRecalculateConfig,
  buildPortfolioUpdateConfig,
  createDeferredPortfolioJobService,
  createLocalPortfolioJobService,
  type PortfolioJobConfig,
} from "./portfolio-jobs";

describe("TS portfolio job route config", () => {
  test("builds update jobs with Rust-compatible incremental defaults", () => {
    expect(buildPortfolioUpdateConfig()).toEqual({
      accountIds: null,
      marketSyncMode: { type: "incremental", asset_ids: null },
      snapshotMode: "incremental_from_last",
      valuationMode: "incremental_from_last",
      sinceDate: null,
    });
    expect(
      buildPortfolioUpdateConfig({
        accountIds: ["acc-1"],
        marketSyncMode: { type: "none" },
      }),
    ).toMatchObject({
      accountIds: ["acc-1"],
      marketSyncMode: { type: "incremental", asset_ids: null },
    });
  });

  test("builds recalculation jobs with Rust-compatible backfill defaults", () => {
    expect(buildPortfolioRecalculateConfig()).toEqual({
      accountIds: null,
      marketSyncMode: { type: "backfill_history", asset_ids: null, days: DEFAULT_HISTORY_DAYS },
      snapshotMode: "full",
      valuationMode: "full",
      sinceDate: null,
    });
    expect(
      buildPortfolioRecalculateConfig({
        marketSyncMode: { type: "refetch_recent", asset_ids: ["asset-1"], days: 7 },
      }),
    ).toMatchObject({
      marketSyncMode: { type: "refetch_recent", asset_ids: ["asset-1"], days: 7 },
      snapshotMode: "full",
      valuationMode: "full",
    });
    expect(buildPortfolioRecalculateConfig({ marketSyncMode: { type: "none" } })).toMatchObject({
      marketSyncMode: { type: "backfill_history", asset_ids: null, days: DEFAULT_HISTORY_DAYS },
    });
  });

  test("reports execution as an explicit deferred runtime", async () => {
    const service = createDeferredPortfolioJobService();

    await expect(service.enqueuePortfolioJob(buildPortfolioUpdateConfig())).rejects.toMatchObject({
      status: 501,
      code: "not_implemented",
    });
  });

  test("executes bounded portfolio valuation jobs from existing snapshots", async () => {
    const db = createPortfolioJobTestDb();
    try {
      seedAccount(db, "account-1", false);
      seedAccount(db, "archived-account", true);
      seedSnapshot(db, {
        accountId: "account-1",
        date: "2026-05-16",
        positions: {
          "asset-1": snapshotPosition("account-1", "asset-1", "2", "12", "USD"),
        },
        cashBalances: { USD: "5" },
        costBasis: "12",
        netContribution: "17",
      });
      seedSnapshot(db, {
        accountId: "archived-account",
        date: "2026-05-16",
        positions: {
          "asset-1": snapshotPosition("archived-account", "asset-1", "100", "100", "USD"),
        },
        cashBalances: {},
        costBasis: "100",
        netContribution: "100",
      });
      seedQuote(db, "asset-1", "2026-05-14", "10", "USD");
      const events: BackendEvent[] = [];
      const sideEffects: string[] = [];
      const synced: unknown[] = [];
      const warnings: string[] = [];
      const service = createLocalPortfolioJobService(db, {
        eventBus: {
          publish(event) {
            events.push(event);
            sideEffects.push(event.name);
          },
          subscribe() {
            return () => {};
          },
        },
        exchangeRateService: {
          getExchangeRateForDate() {
            return "1";
          },
          initialize() {
            sideEffects.push("fx-initialize");
            throw new Error("fx init failed");
          },
        },
        healthService: {
          clearCache() {
            sideEffects.push("health-cache-clear");
          },
        },
        marketDataService: {
          syncMarketData(mode) {
            synced.push(mode);
            sideEffects.push("market-sync");
            return {
              synced: 1,
              failed: 1,
              skipped: 1,
              quotesSynced: 2,
              failures: [["BAD", "timeout"]],
              skippedReasons: [["manual", "Manual pricing mode"]],
            };
          },
        },
        now: () => new Date("2026-05-17T00:00:00Z"),
        warn: (message) => warnings.push(message),
      });

      await service.enqueuePortfolioJob(buildPortfolioUpdateConfig());

      expect(synced).toEqual([{ type: "incremental", asset_ids: null }]);
      expect(events.map((event) => event.name)).toEqual([
        "market:sync-start",
        "market:sync-complete",
        "portfolio:update-start",
        "portfolio:update-complete",
      ]);
      expect(sideEffects).toEqual([
        "market:sync-start",
        "market-sync",
        "market:sync-complete",
        "health-cache-clear",
        "fx-initialize",
        "portfolio:update-start",
        "portfolio:update-complete",
      ]);
      expect(warnings).toEqual([
        "Failed to initialize FxService after market data sync: fx init failed",
      ]);
      expect(events[1]?.payload).toEqual({
        failed_syncs: [["BAD", "timeout"]],
        skipped_reasons: [["manual", "Manual pricing mode"]],
      });
      expect(readValuation(db, "account-1", "2026-05-16")).toMatchObject({
        cash_balance: "5",
        investment_market_value: "20",
        total_value: "25",
        cost_basis: "12",
        net_contribution: "17",
      });
      expect(readValuation(db, "archived-account", "2026-05-16")).toBeNull();
      expect(readValuation(db, "TOTAL", "2026-05-16")).toMatchObject({
        cash_balance: "5",
        investment_market_value: "20",
        total_value: "25",
      });
      expect(readSnapshotPositions(db, "TOTAL", "2026-05-16")).toMatchObject({
        "asset-1": expect.objectContaining({ quantity: "2" }),
      });
    } finally {
      db.close();
    }
  });

  test("reconciles quote sync position status before market sync and after recalculation", async () => {
    const db = createPortfolioJobTestDb();
    try {
      seedAccount(db, "account-1", false);
      seedSnapshot(db, {
        accountId: "TOTAL",
        date: "2026-05-15",
        positions: {
          "old-asset": snapshotPosition("TOTAL", "old-asset", "5", "50", "USD"),
        },
        cashBalances: {},
        costBasis: "50",
        netContribution: "50",
      });
      seedSnapshot(db, {
        accountId: "account-1",
        date: "2026-05-16",
        positions: {
          "new-asset": snapshotPosition("account-1", "new-asset", "2", "12", "USD"),
        },
        cashBalances: {},
        costBasis: "12",
        netContribution: "12",
      });
      seedQuote(db, "new-asset", "2026-05-16", "10", "USD");
      const calls: Array<{ kind: string; holdings?: Record<string, string> }> = [];
      const service = createLocalPortfolioJobService(db, {
        exchangeRateService: {
          getExchangeRateForDate() {
            return "1";
          },
          initialize() {},
        },
        marketDataService: {
          updatePositionStatusFromHoldings(holdings) {
            calls.push({ kind: "reconcile", holdings: decimalMapToRecord(holdings) });
          },
          syncMarketData() {
            calls.push({ kind: "sync" });
            return {
              synced: 0,
              failed: 0,
              skipped: 0,
              quotesSynced: 0,
              failures: [],
              skippedReasons: [],
            };
          },
        },
        now: () => new Date("2026-05-17T00:00:00Z"),
      });

      await service.enqueuePortfolioJob({
        accountIds: null,
        marketSyncMode: { type: "incremental", asset_ids: null },
        snapshotMode: "full",
        valuationMode: "full",
        sinceDate: null,
      });

      expect(calls).toEqual([
        { kind: "reconcile", holdings: { "old-asset": "5" } },
        { kind: "sync" },
        { kind: "reconcile", holdings: { "new-asset": "2" } },
      ]);
    } finally {
      db.close();
    }
  });

  test("continues portfolio jobs when quote sync position reconciliation fails", async () => {
    const db = createPortfolioJobTestDb();
    try {
      seedAccount(db, "account-1", false);
      seedSnapshot(db, {
        accountId: "TOTAL",
        date: "2026-05-15",
        positions: {
          "old-asset": snapshotPosition("TOTAL", "old-asset", "5", "50", "USD"),
        },
        cashBalances: {},
        costBasis: "50",
        netContribution: "50",
      });
      seedSnapshot(db, {
        accountId: "account-1",
        date: "2026-05-16",
        positions: {
          "new-asset": snapshotPosition("account-1", "new-asset", "2", "12", "USD"),
        },
        cashBalances: {},
        costBasis: "12",
        netContribution: "12",
      });
      seedQuote(db, "new-asset", "2026-05-16", "10", "USD");
      const warnings: string[] = [];
      const service = createLocalPortfolioJobService(db, {
        exchangeRateService: {
          getExchangeRateForDate() {
            return "1";
          },
          initialize() {},
        },
        marketDataService: {
          updatePositionStatusFromHoldings() {
            throw new Error("sync state unavailable");
          },
          syncMarketData() {
            return {
              synced: 0,
              failed: 0,
              skipped: 0,
              quotesSynced: 0,
              failures: [],
              skippedReasons: [],
            };
          },
        },
        warn: (message) => warnings.push(message),
      });

      await service.enqueuePortfolioJob({
        accountIds: null,
        marketSyncMode: { type: "incremental", asset_ids: null },
        snapshotMode: "full",
        valuationMode: "full",
        sinceDate: null,
      });

      expect(readValuation(db, "TOTAL", "2026-05-16")).toMatchObject({
        investment_market_value: "20",
      });
      expect(warnings).toEqual([
        "Failed to update position status from latest holdings: sync state unavailable. Quote sync planning may be affected.",
        "Failed to update position status from holdings: sync state unavailable. Quote sync planning may be affected.",
      ]);
    } finally {
      db.close();
    }
  });

  test("aborts portfolio update when market sync fails", async () => {
    const db = createPortfolioJobTestDb();
    try {
      const events: BackendEvent[] = [];
      const sideEffects: string[] = [];
      const service = createLocalPortfolioJobService(db, {
        eventBus: {
          publish(event) {
            events.push(event);
            sideEffects.push(event.name);
          },
          subscribe() {
            return () => {};
          },
        },
        exchangeRateService: {
          getExchangeRateForDate() {
            return "1";
          },
          initialize() {
            sideEffects.push("fx-initialize");
          },
        },
        healthService: {
          clearCache() {
            sideEffects.push("health-cache-clear");
          },
        },
        marketDataService: {
          syncMarketData() {
            sideEffects.push("market-sync");
            throw new Error("market sync failed");
          },
        },
      });

      await expect(service.enqueuePortfolioJob(buildPortfolioUpdateConfig())).rejects.toThrow(
        "market sync failed",
      );

      expect(events).toEqual([
        { name: "market:sync-start" },
        { name: "market:sync-error", payload: "market sync failed" },
      ]);
      expect(sideEffects).toEqual(["market:sync-start", "market-sync", "market:sync-error"]);
    } finally {
      db.close();
    }
  });

  test("continues portfolio update when health cache clear fails", async () => {
    const db = createPortfolioJobTestDb();
    try {
      const events: BackendEvent[] = [];
      const sideEffects: string[] = [];
      const warnings: string[] = [];
      const service = createLocalPortfolioJobService(db, {
        eventBus: {
          publish(event) {
            events.push(event);
            sideEffects.push(event.name);
          },
          subscribe() {
            return () => {};
          },
        },
        exchangeRateService: {
          getExchangeRateForDate() {
            return "1";
          },
          initialize() {
            sideEffects.push("fx-initialize");
          },
        },
        healthService: {
          clearCache() {
            sideEffects.push("health-cache-clear");
            throw new Error("cache clear failed");
          },
        },
        marketDataService: {
          syncMarketData() {
            sideEffects.push("market-sync");
          },
        },
        warn: (message) => warnings.push(message),
      });

      await service.enqueuePortfolioJob(buildPortfolioUpdateConfig());

      expect(events).toEqual([
        { name: "market:sync-start" },
        { name: "market:sync-complete", payload: { failed_syncs: [], skipped_reasons: [] } },
        { name: "portfolio:update-start" },
        { name: "portfolio:update-complete" },
      ]);
      expect(sideEffects).toEqual([
        "market:sync-start",
        "market-sync",
        "market:sync-complete",
        "health-cache-clear",
        "fx-initialize",
        "portfolio:update-start",
        "portfolio:update-complete",
      ]);
      expect(warnings).toEqual([
        "Failed to clear health cache after market data sync: cache clear failed",
      ]);
    } finally {
      db.close();
    }
  });

  test("rebuilds transaction account snapshots from posted activities before valuation", async () => {
    const db = createPortfolioJobTestDb();
    try {
      seedAccount(db, "account-1", false, "USD", "TRANSACTIONS");
      seedAsset(db, "asset-1", "USD");
      seedActivity(db, {
        id: "deposit-1",
        accountId: "account-1",
        type: "DEPOSIT",
        date: "2026-05-14T10:00:00Z",
        amount: "100",
        currency: "USD",
      });
      seedActivity(db, {
        id: "buy-1",
        accountId: "account-1",
        assetId: "asset-1",
        type: "BUY",
        date: "2026-05-14T12:00:00Z",
        quantity: "2",
        unitPrice: "10",
        fee: "1",
        currency: "USD",
      });
      seedActivity(db, {
        id: "dividend-1",
        accountId: "account-1",
        type: "DIVIDEND",
        date: "2026-05-15T12:00:00Z",
        amount: "3",
        currency: "USD",
      });
      seedActivity(db, {
        id: "draft-deposit",
        accountId: "account-1",
        type: "DEPOSIT",
        status: "DRAFT",
        date: "2026-05-15T13:00:00Z",
        amount: "999",
        currency: "USD",
      });
      seedQuote(db, "asset-1", "2026-05-15", "10", "USD");
      const service = createLocalPortfolioJobService(db, {
        now: () => new Date("2026-05-17T00:00:00Z"),
      });

      await service.enqueuePortfolioJob({
        ...buildPortfolioRecalculateConfig({ accountIds: ["account-1"] }),
        marketSyncMode: { type: "none" },
      });

      expect(readSnapshot(db, "account-1", "2026-05-14")).toMatchObject({
        source: "CALCULATED",
        cash_balances: '{"USD":"79"}',
        cost_basis: "21",
        net_contribution: "100",
      });
      expect(readSnapshotPositions(db, "account-1", "2026-05-14")).toMatchObject({
        "asset-1": expect.objectContaining({
          quantity: "2",
          totalCostBasis: "21",
          averageCost: "10.5",
        }),
      });
      expect(readSnapshot(db, "account-1", "2026-05-15")).toMatchObject({
        cash_balances: '{"USD":"82"}',
        net_contribution: "100",
      });
      expect(readValuation(db, "account-1", "2026-05-15")).toMatchObject({
        cash_balance: "82",
        investment_market_value: "20",
        total_value: "102",
      });
      expect(readValuation(db, "TOTAL", "2026-05-15")).toMatchObject({
        total_value: "102",
      });
      expect(readSnapshot(db, "account-1", "2026-05-16")).toMatchObject({
        source: "CALCULATED",
        cash_balances: '{"USD":"82"}',
        net_contribution: "100",
      });
      expect(readValuation(db, "account-1", "2026-05-16")).toMatchObject({
        cash_balance: "82",
        investment_market_value: "20",
        total_value: "102",
      });
      expect(readSnapshot(db, "account-1", "2026-05-17")).toMatchObject({
        source: "CALCULATED",
        cash_balances: '{"USD":"82"}',
        net_contribution: "100",
      });
      expect(readValuation(db, "TOTAL", "2026-05-17")).toMatchObject({
        total_value: "102",
      });
    } finally {
      db.close();
    }
  });

  test("groups transaction replay activities by user timezone like Rust", async () => {
    const db = createPortfolioJobTestDb();
    try {
      seedAccount(db, "account-1", false, "USD", "TRANSACTIONS");
      seedAsset(db, "asset-1", "USD");
      seedActivity(db, {
        id: "buy-timezone",
        accountId: "account-1",
        assetId: "asset-1",
        type: "BUY",
        date: "2025-01-01T07:30:00Z",
        quantity: "1",
        unitPrice: "100",
        currency: "USD",
      });
      seedQuote(db, "asset-1", "2024-12-31", "100", "USD");
      const service = createLocalPortfolioJobService(db, {
        now: () => new Date("2025-01-01T12:00:00Z"),
        timezone: "America/Los_Angeles",
      });

      await service.enqueuePortfolioJob({
        ...buildPortfolioRecalculateConfig({ accountIds: ["account-1"] }),
        marketSyncMode: { type: "none" },
      });

      expect(readSnapshotPositions(db, "account-1", "2024-12-31")).toMatchObject({
        "asset-1": expect.objectContaining({
          quantity: "1",
          totalCostBasis: "100",
        }),
      });
      expect(readSnapshot(db, "account-1", "2025-01-01")).toMatchObject({
        cash_balances: '{"USD":"-100"}',
        net_contribution: "0",
      });
    } finally {
      db.close();
    }
  });

  test("compiles asset income subtypes before transaction snapshot replay", async () => {
    const db = createPortfolioJobTestDb();
    try {
      seedAccount(db, "account-1", false, "USD", "TRANSACTIONS");
      seedAsset(db, "drip-asset", "USD");
      seedAsset(db, "kind-asset", "USD");
      seedAsset(db, "stake-asset", "USD");
      seedActivity(db, {
        id: "drip-1",
        accountId: "account-1",
        assetId: "drip-asset",
        type: "DIVIDEND",
        subtype: "DRIP",
        date: "2026-05-15T10:00:00Z",
        quantity: "5",
        unitPrice: "20",
        amount: "100",
        currency: "USD",
      });
      seedActivity(db, {
        id: "kind-1",
        accountId: "account-1",
        assetId: "kind-asset",
        type: "UNKNOWN",
        activityTypeOverride: "DIVIDEND",
        subtype: "DIVIDEND_IN_KIND",
        date: "2026-05-15T11:00:00Z",
        quantity: "2",
        unitPrice: "7",
        amount: null,
        currency: "USD",
      });
      seedActivity(db, {
        id: "stake-1",
        accountId: "account-1",
        assetId: "stake-asset",
        type: "INTEREST",
        subtype: "STAKING_REWARD",
        date: "2026-05-15T12:00:00Z",
        quantity: "0.01",
        unitPrice: "2000",
        amount: "20",
        currency: "USD",
      });
      seedQuote(db, "drip-asset", "2026-05-15", "20", "USD");
      seedQuote(db, "kind-asset", "2026-05-15", "7", "USD");
      seedQuote(db, "stake-asset", "2026-05-15", "2000", "USD");
      const service = createLocalPortfolioJobService(db, {
        now: () => new Date("2026-05-17T00:00:00Z"),
      });

      await service.enqueuePortfolioJob({
        ...buildPortfolioRecalculateConfig({ accountIds: ["account-1"] }),
        marketSyncMode: { type: "none" },
      });

      expect(readSnapshot(db, "account-1", "2026-05-15")).toMatchObject({
        cash_balances: '{"USD":"0"}',
        cost_basis: "134",
        net_contribution: "0",
      });
      expect(readSnapshotPositions(db, "account-1", "2026-05-15")).toMatchObject({
        "drip-asset": expect.objectContaining({
          quantity: "5",
          totalCostBasis: "100",
          lots: [expect.objectContaining({ id: "drip-1:buy", costBasis: "100" })],
        }),
        "kind-asset": expect.objectContaining({
          quantity: "2",
          totalCostBasis: "14",
          lots: [expect.objectContaining({ id: "kind-1:buy", costBasis: "14" })],
        }),
        "stake-asset": expect.objectContaining({
          quantity: "0.01",
          totalCostBasis: "20",
          lots: [expect.objectContaining({ id: "stake-1:buy", costBasis: "20" })],
        }),
      });
      expect(readValuation(db, "account-1", "2026-05-15")).toMatchObject({
        cash_balance: "0",
        investment_market_value: "134",
        total_value: "134",
      });
    } finally {
      db.close();
    }
  });

  test("keeps holdings-mode snapshots manual and skips activity replay", async () => {
    const db = createPortfolioJobTestDb();
    try {
      seedAccount(db, "account-1", false, "USD", "HOLDINGS");
      seedActivity(db, {
        id: "deposit-1",
        accountId: "account-1",
        type: "DEPOSIT",
        date: "2026-05-14T10:00:00Z",
        amount: "100",
        currency: "USD",
      });
      seedSnapshot(db, {
        accountId: "account-1",
        date: "2026-05-14",
        source: "MANUAL_ENTRY",
        positions: {},
        cashBalances: { USD: "5" },
        costBasis: "0",
        netContribution: "5",
      });
      const service = createLocalPortfolioJobService(db, {
        now: () => new Date("2026-05-17T00:00:00Z"),
      });

      await service.enqueuePortfolioJob({
        ...buildPortfolioRecalculateConfig({ accountIds: ["account-1"] }),
        marketSyncMode: { type: "none" },
      });

      expect(readSnapshot(db, "account-1", "2026-05-14")).toMatchObject({
        source: "MANUAL_ENTRY",
        cash_balances: '{"USD":"5"}',
      });
      expect(readCalculatedSnapshotCount(db, "account-1")).toBe(0);
      expect(readValuation(db, "account-1", "2026-05-14")).toMatchObject({
        total_value: "5",
      });
    } finally {
      db.close();
    }
  });

  test("continues transaction snapshot replay from the latest prior snapshot", async () => {
    const db = createPortfolioJobTestDb();
    try {
      seedAccount(db, "account-1", false, "USD", "TRANSACTIONS");
      seedAsset(db, "asset-1", "USD");
      seedSnapshot(db, {
        accountId: "account-1",
        date: "2026-05-10",
        positions: {
          "asset-1": snapshotPosition("account-1", "asset-1", "1", "10", "USD"),
        },
        cashBalances: { USD: "50" },
        costBasis: "10",
        netContribution: "60",
      });
      seedSnapshot(db, {
        accountId: "account-1",
        date: "2026-05-12",
        positions: {},
        cashBalances: { USD: "999" },
        costBasis: "0",
        netContribution: "999",
      });
      seedActivity(db, {
        id: "buy-1",
        accountId: "account-1",
        assetId: "asset-1",
        type: "BUY",
        date: "2026-05-12T12:00:00Z",
        quantity: "1",
        unitPrice: "10",
        currency: "USD",
      });
      seedQuote(db, "asset-1", "2026-05-12", "10", "USD");
      const service = createLocalPortfolioJobService(db, {
        now: () => new Date("2026-05-17T00:00:00Z"),
      });

      await service.enqueuePortfolioJob({
        accountIds: ["account-1"],
        marketSyncMode: { type: "none" },
        snapshotMode: "full",
        valuationMode: "full",
        sinceDate: "2026-05-12",
      });

      expect(readSnapshot(db, "account-1", "2026-05-10")).toMatchObject({
        cash_balances: '{"USD":"50"}',
      });
      expect(readSnapshot(db, "account-1", "2026-05-12")).toMatchObject({
        source: "CALCULATED",
        cash_balances: '{"USD":"40"}',
        cost_basis: "20",
        net_contribution: "60",
      });
      expect(readSnapshotPositions(db, "account-1", "2026-05-12")).toMatchObject({
        "asset-1": expect.objectContaining({ quantity: "2", totalCostBasis: "20" }),
      });
    } finally {
      db.close();
    }
  });

  test("converts multi-currency cash totals in activity-built snapshots", async () => {
    const db = createPortfolioJobTestDb();
    try {
      seedAccount(db, "account-1", false, "USD", "TRANSACTIONS");
      seedActivity(db, {
        id: "deposit-1",
        accountId: "account-1",
        type: "DEPOSIT",
        date: "2026-05-14T10:00:00Z",
        amount: "100",
        currency: "USD",
      });
      seedActivity(db, {
        id: "dividend-1",
        accountId: "account-1",
        type: "DIVIDEND",
        date: "2026-05-14T12:00:00Z",
        amount: "10",
        currency: "EUR",
      });
      const service = createLocalPortfolioJobService(db, {
        baseCurrency: "USD",
        exchangeRateService: {
          initialize() {},
          getExchangeRateForDate(fromCurrency, toCurrency) {
            if (fromCurrency === "EUR" && toCurrency === "USD") {
              return "2";
            }
            throw new Error(`unexpected FX pair ${fromCurrency}/${toCurrency}`);
          },
        },
        now: () => new Date("2026-05-17T00:00:00Z"),
      });

      await service.enqueuePortfolioJob({
        ...buildPortfolioRecalculateConfig({ accountIds: ["account-1"] }),
        marketSyncMode: { type: "none" },
      });

      expect(readSnapshot(db, "account-1", "2026-05-14")).toMatchObject({
        cash_balances: '{"USD":"100","EUR":"10"}',
        cash_total_account_currency: "120",
        cash_total_base_currency: "120",
      });
      expect(readValuation(db, "account-1", "2026-05-14")).toMatchObject({
        cash_balance: "120",
        total_value: "120",
      });
    } finally {
      db.close();
    }
  });

  test("uses Rust-compatible FX rules for cash contribution fields", async () => {
    const db = createPortfolioJobTestDb();
    try {
      seedAccount(db, "cad-with-fx", false, "CAD", "TRANSACTIONS");
      seedAccount(db, "cad-no-fx", false, "CAD", "TRANSACTIONS");
      seedActivity(db, {
        id: "deposit-with-fx",
        accountId: "cad-with-fx",
        type: "DEPOSIT",
        date: "2026-05-14T10:00:00Z",
        amount: "100",
        currency: "USD",
        fxRate: "1.3",
      });
      seedActivity(db, {
        id: "deposit-no-fx",
        accountId: "cad-no-fx",
        type: "DEPOSIT",
        date: "2026-05-14T10:00:00Z",
        amount: "80",
        currency: "USD",
      });
      const service = createLocalPortfolioJobService(db, {
        baseCurrency: "EUR",
        exchangeRateService: {
          initialize() {},
          getExchangeRateForDate(fromCurrency, toCurrency) {
            if (fromCurrency === "USD" && toCurrency === "CAD") {
              return "1.25";
            }
            if (fromCurrency === "USD" && toCurrency === "EUR") {
              return "0.9";
            }
            if (fromCurrency === "CAD" && toCurrency === "EUR") {
              return "0.7";
            }
            throw new Error(`unexpected FX pair ${fromCurrency}/${toCurrency}`);
          },
        },
        now: () => new Date("2026-05-17T00:00:00Z"),
      });

      await service.enqueuePortfolioJob({
        ...buildPortfolioRecalculateConfig(),
        marketSyncMode: { type: "none" },
      });

      expect(readSnapshot(db, "cad-with-fx", "2026-05-14")).toMatchObject({
        cash_balances: '{"USD":"100"}',
        cash_total_account_currency: "125",
        cash_total_base_currency: "90",
        net_contribution: "130",
        net_contribution_base: "90",
      });
      expect(readSnapshot(db, "cad-no-fx", "2026-05-14")).toMatchObject({
        cash_balances: '{"USD":"80"}',
        cash_total_account_currency: "100",
        cash_total_base_currency: "72",
        net_contribution: "100",
        net_contribution_base: "72",
      });
    } finally {
      db.close();
    }
  });

  test("uses unconverted cash totals for activity snapshots when FX is unavailable", async () => {
    const db = createPortfolioJobTestDb();
    try {
      seedAccount(db, "archived-cad", true, "CAD", "TRANSACTIONS");
      seedAsset(db, "usd-asset", "USD");
      seedActivity(db, {
        id: "deposit-missing-fx",
        accountId: "archived-cad",
        type: "DEPOSIT",
        date: "2026-05-14T10:00:00Z",
        amount: "100",
        currency: "USD",
      });
      seedActivity(db, {
        id: "buy-missing-fx",
        accountId: "archived-cad",
        assetId: "usd-asset",
        type: "BUY",
        date: "2026-05-14T12:00:00Z",
        quantity: "1",
        unitPrice: "40",
        currency: "USD",
      });
      const warnings: string[] = [];
      const service = createLocalPortfolioJobService(db, {
        baseCurrency: "EUR",
        now: () => new Date("2026-05-17T00:00:00Z"),
        warn: (message) => warnings.push(message),
      });

      await service.enqueuePortfolioJob({
        ...buildPortfolioRecalculateConfig({ accountIds: ["archived-cad"] }),
        marketSyncMode: { type: "none" },
      });

      expect(readSnapshot(db, "archived-cad", "2026-05-14")).toMatchObject({
        cash_balances: '{"USD":"60"}',
        cash_total_account_currency: "60",
        cash_total_base_currency: "60",
        cost_basis: "40",
        net_contribution: "100",
        net_contribution_base: "0",
      });
      expect(warnings).toContain("Missing exchange rate service for USD/CAD on 2026-05-14");
      expect(warnings).toContain("Missing exchange rate service for USD/EUR on 2026-05-14");
    } finally {
      db.close();
    }
  });

  test("converts cross-currency buy lots to position currency", async () => {
    const db = createPortfolioJobTestDb();
    try {
      seedAccount(db, "cad-account", false, "CAD", "TRANSACTIONS");
      seedAsset(db, "usd-asset", "USD");
      seedActivity(db, {
        id: "buy-1",
        accountId: "cad-account",
        assetId: "usd-asset",
        type: "BUY",
        date: "2026-05-14T12:00:00Z",
        quantity: "2",
        unitPrice: "10",
        fee: "1",
        currency: "EUR",
        fxRate: "1.5",
      });
      seedQuote(db, "usd-asset", "2026-05-14", "12", "USD");
      const warnings: string[] = [];
      const service = createLocalPortfolioJobService(db, {
        baseCurrency: "CAD",
        exchangeRateService: {
          initialize() {},
          getExchangeRateForDate(fromCurrency, toCurrency) {
            if (fromCurrency === "EUR" && toCurrency === "USD") {
              return "1.1";
            }
            if (fromCurrency === "USD" && toCurrency === "CAD") {
              return "1.3";
            }
            if (fromCurrency === "EUR" && toCurrency === "CAD") {
              return "1.5";
            }
            throw new Error(`unexpected FX pair ${fromCurrency}/${toCurrency}`);
          },
        },
        now: () => new Date("2026-05-17T00:00:00Z"),
        warn: (message) => warnings.push(message),
      });

      await service.enqueuePortfolioJob({
        ...buildPortfolioRecalculateConfig({ accountIds: ["cad-account"] }),
        marketSyncMode: { type: "none" },
      });

      expect(warnings).toEqual([]);
      expect(readSnapshot(db, "cad-account", "2026-05-14")).toMatchObject({
        cash_balances: '{"CAD":"-31.5"}',
        cost_basis: "30.03",
        cash_total_account_currency: "-31.5",
      });
      expect(readSnapshotPositions(db, "cad-account", "2026-05-14")).toMatchObject({
        "usd-asset": expect.objectContaining({
          quantity: "2",
          averageCost: "11.55",
          totalCostBasis: "23.1",
          lots: [
            expect.objectContaining({
              acquisitionPrice: "11",
              acquisitionFees: "1.1",
              costBasis: "23.1",
            }),
          ],
        }),
      });
      expect(readValuation(db, "cad-account", "2026-05-14")).toMatchObject({
        investment_market_value: "31.2",
        cash_balance: "-31.5",
        total_value: "-0.3",
      });
    } finally {
      db.close();
    }
  });

  test("books cross-currency sell proceeds in account currency when fx rate exists", async () => {
    const db = createPortfolioJobTestDb();
    try {
      seedAccount(db, "cad-account", false, "CAD", "TRANSACTIONS");
      seedAsset(db, "usd-asset", "USD");
      seedSnapshot(db, {
        accountId: "cad-account",
        date: "2026-05-10",
        currency: "CAD",
        positions: {
          "usd-asset": snapshotPosition("cad-account", "usd-asset", "2", "20", "USD"),
        },
        cashBalances: {},
        costBasis: "20",
        netContribution: "26",
      });
      seedActivity(db, {
        id: "sell-1",
        accountId: "cad-account",
        assetId: "usd-asset",
        type: "SELL",
        date: "2026-05-12T12:00:00Z",
        quantity: "1",
        unitPrice: "10",
        fee: "1",
        currency: "EUR",
        fxRate: "1.5",
      });
      seedQuote(db, "usd-asset", "2026-05-12", "10", "USD");
      const service = createLocalPortfolioJobService(db, {
        baseCurrency: "CAD",
        exchangeRateService: {
          initialize() {},
          getExchangeRateForDate(fromCurrency, toCurrency) {
            if (fromCurrency === "USD" && toCurrency === "CAD") {
              return "1.3";
            }
            throw new Error(`unexpected FX pair ${fromCurrency}/${toCurrency}`);
          },
        },
        now: () => new Date("2026-05-17T00:00:00Z"),
      });

      await service.enqueuePortfolioJob({
        accountIds: ["cad-account"],
        marketSyncMode: { type: "none" },
        snapshotMode: "full",
        valuationMode: "full",
        sinceDate: "2026-05-12",
      });

      expect(readSnapshot(db, "cad-account", "2026-05-12")).toMatchObject({
        cash_balances: '{"CAD":"13.5"}',
        cost_basis: "13",
        cash_total_account_currency: "13.5",
      });
      expect(readSnapshotPositions(db, "cad-account", "2026-05-12")).toMatchObject({
        "usd-asset": expect.objectContaining({ quantity: "1", totalCostBasis: "10" }),
      });
      expect(readValuation(db, "cad-account", "2026-05-12")).toMatchObject({
        investment_market_value: "13",
        cash_balance: "13.5",
        total_value: "26.5",
      });
    } finally {
      db.close();
    }
  });

  test("books option sell proceeds when the sold position is missing like Rust", async () => {
    const db = createPortfolioJobTestDb();
    const warnings: string[] = [];
    try {
      seedAccount(db, "account-1", false, "USD", "TRANSACTIONS");
      seedAsset(db, "option-asset", "USD", { instrumentType: "OPTION" });
      seedSnapshot(db, {
        accountId: "account-1",
        date: "2026-05-10",
        positions: {},
        cashBalances: { USD: "100" },
        costBasis: "0",
        netContribution: "100",
      });
      seedActivity(db, {
        id: "sell-missing-option",
        accountId: "account-1",
        assetId: "option-asset",
        type: "SELL",
        date: "2026-05-12T12:00:00Z",
        quantity: "1",
        unitPrice: "2",
        fee: "1",
        currency: "USD",
      });
      const service = createLocalPortfolioJobService(db, {
        now: () => new Date("2026-05-12T00:00:00Z"),
        warn: (message) => warnings.push(message),
      });

      await service.enqueuePortfolioJob({
        accountIds: ["account-1"],
        marketSyncMode: { type: "none" },
        snapshotMode: "full",
        valuationMode: "full",
        sinceDate: "2026-05-12",
      });

      expect(warnings).toEqual([
        "Activity sell-missing-option sold missing position option-asset; cash effect was still applied",
      ]);
      expect(readSnapshot(db, "account-1", "2026-05-12")).toMatchObject({
        cash_balances: '{"USD":"299"}',
        cash_total_account_currency: "299",
        cost_basis: "0",
      });
      expect(readSnapshotPositions(db, "account-1", "2026-05-12")).toEqual({});
      expect(readValuation(db, "account-1", "2026-05-12")).toMatchObject({
        cash_balance: "299",
        investment_market_value: "0",
        total_value: "299",
      });
    } finally {
      db.close();
    }
  });

  test("preserves zero-quantity positions in activity-derived snapshots", async () => {
    const db = createPortfolioJobTestDb();
    try {
      seedAccount(db, "account-1", false, "USD", "TRANSACTIONS");
      seedAsset(db, "asset-1", "USD");
      seedActivity(db, {
        id: "buy-1",
        accountId: "account-1",
        assetId: "asset-1",
        type: "BUY",
        date: "2026-05-14T12:00:00Z",
        quantity: "2",
        unitPrice: "10",
        currency: "USD",
      });
      seedActivity(db, {
        id: "sell-1",
        accountId: "account-1",
        assetId: "asset-1",
        type: "SELL",
        date: "2026-05-15T12:00:00Z",
        quantity: "2",
        unitPrice: "12",
        currency: "USD",
      });
      seedQuote(db, "asset-1", "2026-05-15", "12", "USD");
      const service = createLocalPortfolioJobService(db, {
        now: () => new Date("2026-05-15T00:00:00Z"),
      });

      await service.enqueuePortfolioJob({
        ...buildPortfolioRecalculateConfig({ accountIds: ["account-1"] }),
        marketSyncMode: { type: "none" },
      });

      expect(readSnapshotPositions(db, "account-1", "2026-05-15")).toMatchObject({
        "asset-1": expect.objectContaining({
          quantity: "0",
          averageCost: "0",
          totalCostBasis: "0",
          lots: [],
        }),
      });
      expect(readValuation(db, "account-1", "2026-05-15")).toMatchObject({
        cash_balance: "4",
        investment_market_value: "0",
        total_value: "4",
      });
    } finally {
      db.close();
    }
  });

  test("preserves zero-quantity seed positions without quote-gap skips", async () => {
    const db = createPortfolioJobTestDb();
    try {
      seedAccount(db, "account-1", false);
      seedAsset(db, "asset-1", "USD");
      seedSnapshot(db, {
        accountId: "account-1",
        date: "2026-05-10",
        positions: {
          "asset-1": snapshotPosition("account-1", "asset-1", "0", "0", "USD"),
        },
        cashBalances: { USD: "5" },
        costBasis: "0",
        netContribution: "5",
      });
      seedSnapshot(db, {
        accountId: "account-1",
        date: "2026-05-12",
        positions: {
          "asset-1": snapshotPosition("account-1", "asset-1", "0", "0", "USD"),
        },
        cashBalances: { USD: "7" },
        costBasis: "0",
        netContribution: "7",
      });
      seedQuote(db, "asset-1", "2026-05-12", "12", "USD");
      const service = createLocalPortfolioJobService(db, {
        now: () => new Date("2026-05-12T00:00:00Z"),
      });

      await service.enqueuePortfolioJob({
        ...buildPortfolioRecalculateConfig({ accountIds: ["account-1"] }),
        marketSyncMode: { type: "none" },
      });

      expect(readSnapshotPositions(db, "account-1", "2026-05-10")).toMatchObject({
        "asset-1": expect.objectContaining({ quantity: "0" }),
      });
      expect(readValuation(db, "account-1", "2026-05-10")).toMatchObject({
        cash_balance: "5",
        investment_market_value: "0",
        total_value: "5",
      });
      expect(readValuation(db, "account-1", "2026-05-12")).toMatchObject({
        cash_balance: "7",
        investment_market_value: "0",
        total_value: "7",
      });
    } finally {
      db.close();
    }
  });

  test("uses option contract multipliers from asset metadata", async () => {
    const db = createPortfolioJobTestDb();
    try {
      seedAccount(db, "account-1", false, "USD", "TRANSACTIONS");
      seedAsset(db, "option-1", "USD", {
        instrumentType: "OPTION",
        metadata: { option: { multiplier: "100" } },
      });
      seedActivity(db, {
        id: "deposit-1",
        accountId: "account-1",
        type: "DEPOSIT",
        date: "2026-05-14T10:00:00Z",
        amount: "1000",
        currency: "USD",
      });
      seedActivity(db, {
        id: "buy-1",
        accountId: "account-1",
        assetId: "option-1",
        type: "BUY",
        date: "2026-05-14T12:00:00Z",
        quantity: "2",
        unitPrice: "3",
        fee: "5",
        currency: "USD",
      });
      seedActivity(db, {
        id: "sell-1",
        accountId: "account-1",
        assetId: "option-1",
        type: "SELL",
        date: "2026-05-15T12:00:00Z",
        quantity: "1",
        unitPrice: "4",
        fee: "1",
        currency: "USD",
      });
      seedQuote(db, "option-1", "2026-05-14", "3", "USD");
      seedQuote(db, "option-1", "2026-05-15", "4", "USD");
      const service = createLocalPortfolioJobService(db, {
        now: () => new Date("2026-05-17T00:00:00Z"),
      });

      await service.enqueuePortfolioJob({
        ...buildPortfolioRecalculateConfig({ accountIds: ["account-1"] }),
        marketSyncMode: { type: "none" },
      });

      expect(readSnapshot(db, "account-1", "2026-05-15")).toMatchObject({
        cash_balances: '{"USD":"794"}',
        cost_basis: "302.5",
        net_contribution: "1000",
      });
      expect(readSnapshotPositions(db, "account-1", "2026-05-15")).toMatchObject({
        "option-1": expect.objectContaining({
          quantity: "1",
          averageCost: "302.5",
          totalCostBasis: "302.5",
          contractMultiplier: "100",
          lots: [expect.objectContaining({ quantity: "1", costBasis: "302.5" })],
        }),
      });
      expect(readValuation(db, "account-1", "2026-05-15")).toMatchObject({
        investment_market_value: "400",
        cash_balance: "794",
        total_value: "1194",
      });
    } finally {
      db.close();
    }
  });

  test("fails transaction snapshot replay for invalid activity dates", async () => {
    const db = createPortfolioJobTestDb();
    try {
      seedAccount(db, "account-1", false, "USD", "TRANSACTIONS");
      seedActivity(db, {
        id: "bad-date",
        accountId: "account-1",
        type: "DEPOSIT",
        date: "invalid-date",
        amount: "100",
        currency: "USD",
      });
      const service = createLocalPortfolioJobService(db, {
        now: () => new Date("2026-05-17T00:00:00Z"),
      });

      await expect(
        service.enqueuePortfolioJob({
          ...buildPortfolioRecalculateConfig({ accountIds: ["account-1"] }),
          marketSyncMode: { type: "none" },
        }),
      ).rejects.toThrow("Invalid activity date for activity bad-date: invalid-date");

      expect(readCalculatedSnapshotCount(db, "account-1")).toBe(0);
    } finally {
      db.close();
    }
  });

  test("carries lots across paired same-day asset transfers", async () => {
    const db = createPortfolioJobTestDb();
    try {
      seedAccount(db, "dest-account", false, "USD", "TRANSACTIONS");
      seedAccount(db, "source-account", false, "USD", "TRANSACTIONS");
      seedAsset(db, "asset-1", "USD");
      seedActivity(db, {
        id: "deposit-1",
        accountId: "source-account",
        type: "DEPOSIT",
        date: "2026-05-10T10:00:00Z",
        amount: "100",
        currency: "USD",
      });
      seedActivity(db, {
        id: "buy-1",
        accountId: "source-account",
        assetId: "asset-1",
        type: "BUY",
        date: "2026-05-10T12:00:00Z",
        quantity: "2",
        unitPrice: "10",
        currency: "USD",
      });
      seedActivity(db, {
        id: "transfer-out-1",
        accountId: "source-account",
        assetId: "asset-1",
        type: "TRANSFER_OUT",
        date: "2026-05-12T12:00:00Z",
        quantity: "1",
        fee: "1",
        currency: "USD",
        sourceGroupId: "transfer-group-1",
      });
      seedActivity(db, {
        id: "transfer-in-1",
        accountId: "dest-account",
        assetId: "asset-1",
        type: "TRANSFER_IN",
        date: "2026-05-12T12:00:00Z",
        quantity: "1",
        unitPrice: "999",
        fee: "2",
        currency: "USD",
        sourceGroupId: "transfer-group-1",
      });
      seedQuote(db, "asset-1", "2026-05-12", "10", "USD");
      const service = createLocalPortfolioJobService(db, {
        now: () => new Date("2026-05-17T00:00:00Z"),
      });

      await service.enqueuePortfolioJob({
        ...buildPortfolioRecalculateConfig(),
        marketSyncMode: { type: "none" },
      });

      expect(readSnapshot(db, "source-account", "2026-05-12")).toMatchObject({
        cash_balances: '{"USD":"79"}',
        cost_basis: "10",
        net_contribution: "90",
      });
      expect(readSnapshotPositions(db, "source-account", "2026-05-12")).toMatchObject({
        "asset-1": expect.objectContaining({
          quantity: "1",
          totalCostBasis: "10",
          lots: [expect.objectContaining({ id: "buy-1", quantity: "1", costBasis: "10" })],
        }),
      });
      expect(readSnapshot(db, "dest-account", "2026-05-12")).toMatchObject({
        cash_balances: '{"USD":"-2"}',
        cost_basis: "10",
        net_contribution: "10",
      });
      expect(readSnapshotPositions(db, "dest-account", "2026-05-12")).toMatchObject({
        "asset-1": expect.objectContaining({
          quantity: "1",
          totalCostBasis: "10",
          lots: [
            expect.objectContaining({
              id: "transfer-in-1",
              acquisitionDate: "2026-05-10T12:00:00Z",
              acquisitionPrice: "10",
              costBasis: "10",
            }),
          ],
        }),
      });
      expect(readSnapshotPositions(db, "TOTAL", "2026-05-12")).toMatchObject({
        "asset-1": expect.objectContaining({ quantity: "2", totalCostBasis: "20" }),
      });
      expect(readValuation(db, "TOTAL", "2026-05-12")).toMatchObject({
        investment_market_value: "20",
        cash_balance: "77",
        total_value: "97",
        net_contribution: "100",
      });
    } finally {
      db.close();
    }
  });

  test("falls back to unit-price lots for external asset transfer-ins", async () => {
    const db = createPortfolioJobTestDb();
    try {
      seedAccount(db, "account-1", false, "USD", "TRANSACTIONS");
      seedAsset(db, "asset-1", "USD");
      seedActivity(db, {
        id: "transfer-in-1",
        accountId: "account-1",
        assetId: "asset-1",
        type: "TRANSFER_IN",
        date: "2026-05-12T12:00:00Z",
        quantity: "2",
        unitPrice: "15",
        fee: "1",
        currency: "USD",
      });
      seedQuote(db, "asset-1", "2026-05-12", "15", "USD");
      const service = createLocalPortfolioJobService(db, {
        now: () => new Date("2026-05-17T00:00:00Z"),
      });

      await service.enqueuePortfolioJob({
        ...buildPortfolioRecalculateConfig({ accountIds: ["account-1"] }),
        marketSyncMode: { type: "none" },
      });

      expect(readSnapshot(db, "account-1", "2026-05-12")).toMatchObject({
        cash_balances: '{"USD":"-1"}',
        cost_basis: "31",
        net_contribution: "31",
      });
      expect(readSnapshotPositions(db, "account-1", "2026-05-12")).toMatchObject({
        "asset-1": expect.objectContaining({
          quantity: "2",
          averageCost: "15.5",
          totalCostBasis: "31",
          lots: [
            expect.objectContaining({
              id: "transfer-in-1",
              acquisitionFees: "1",
              costBasis: "31",
            }),
          ],
        }),
      });
      expect(readValuation(db, "account-1", "2026-05-12")).toMatchObject({
        investment_market_value: "30",
        cash_balance: "-1",
        total_value: "29",
      });
    } finally {
      db.close();
    }
  });

  test("converts external transfer-in fallback lots to position currency", async () => {
    const db = createPortfolioJobTestDb();
    try {
      seedAccount(db, "account-1", false, "CAD", "TRANSACTIONS");
      seedAsset(db, "usd-asset", "USD");
      seedActivity(db, {
        id: "transfer-in-1",
        accountId: "account-1",
        assetId: "usd-asset",
        type: "TRANSFER_IN",
        date: "2026-05-12T12:00:00Z",
        quantity: "2",
        unitPrice: "15",
        fee: "1",
        currency: "CAD",
        fxRate: "0.8",
      });
      seedQuote(db, "usd-asset", "2026-05-12", "12", "USD");
      const service = createLocalPortfolioJobService(db, {
        baseCurrency: "CAD",
        exchangeRateService: {
          initialize() {},
          getExchangeRateForDate(fromCurrency, toCurrency) {
            if (fromCurrency === "USD" && toCurrency === "CAD") {
              return "1.25";
            }
            throw new Error(`unexpected FX pair ${fromCurrency}/${toCurrency}`);
          },
        },
        now: () => new Date("2026-05-17T00:00:00Z"),
      });

      await service.enqueuePortfolioJob({
        ...buildPortfolioRecalculateConfig({ accountIds: ["account-1"] }),
        marketSyncMode: { type: "none" },
      });

      expect(readSnapshot(db, "account-1", "2026-05-12")).toMatchObject({
        cash_balances: '{"CAD":"-1"}',
        cost_basis: "31",
        net_contribution: "31",
        net_contribution_base: "31",
      });
      expect(readSnapshotPositions(db, "account-1", "2026-05-12")).toMatchObject({
        "usd-asset": expect.objectContaining({
          quantity: "2",
          averageCost: "12.4",
          totalCostBasis: "24.8",
          lots: [
            expect.objectContaining({
              acquisitionPrice: "12",
              acquisitionFees: "0.8",
              costBasis: "24.8",
            }),
          ],
        }),
      });
      expect(readValuation(db, "account-1", "2026-05-12")).toMatchObject({
        investment_market_value: "30",
        cash_balance: "-1",
        total_value: "29",
      });
    } finally {
      db.close();
    }
  });

  test("does not use transfer activity fx rate for base contribution conversion", async () => {
    const db = createPortfolioJobTestDb();
    try {
      seedAccount(db, "account-1", false, "CAD", "TRANSACTIONS");
      seedAsset(db, "usd-asset", "USD");
      seedActivity(db, {
        id: "transfer-in-1",
        accountId: "account-1",
        assetId: "usd-asset",
        type: "TRANSFER_IN",
        date: "2026-05-12T12:00:00Z",
        quantity: "2",
        unitPrice: "15",
        fee: "1",
        currency: "USD",
        fxRate: "1.3",
      });
      seedQuote(db, "usd-asset", "2026-05-12", "12", "USD");
      const service = createLocalPortfolioJobService(db, {
        baseCurrency: "CAD",
        exchangeRateService: {
          initialize() {},
          getExchangeRateForDate(fromCurrency, toCurrency) {
            if (fromCurrency === "USD" && toCurrency === "CAD") {
              return "1.25";
            }
            throw new Error(`unexpected FX pair ${fromCurrency}/${toCurrency}`);
          },
        },
        now: () => new Date("2026-05-17T00:00:00Z"),
      });

      await service.enqueuePortfolioJob({
        ...buildPortfolioRecalculateConfig({ accountIds: ["account-1"] }),
        marketSyncMode: { type: "none" },
      });

      expect(readSnapshot(db, "account-1", "2026-05-12")).toMatchObject({
        cash_balances: '{"USD":"-1"}',
        cost_basis: "38.75",
        net_contribution: "40.3",
        net_contribution_base: "38.75",
      });
    } finally {
      db.close();
    }
  });

  test("warns when transfer-out lots are never consumed", async () => {
    const db = createPortfolioJobTestDb();
    try {
      seedAccount(db, "account-1", false, "USD", "TRANSACTIONS");
      seedAsset(db, "asset-1", "USD");
      seedActivity(db, {
        id: "deposit-1",
        accountId: "account-1",
        type: "DEPOSIT",
        date: "2026-05-10T10:00:00Z",
        amount: "100",
        currency: "USD",
      });
      seedActivity(db, {
        id: "buy-1",
        accountId: "account-1",
        assetId: "asset-1",
        type: "BUY",
        date: "2026-05-10T12:00:00Z",
        quantity: "1",
        unitPrice: "10",
        currency: "USD",
      });
      seedActivity(db, {
        id: "transfer-out-1",
        accountId: "account-1",
        assetId: "asset-1",
        type: "TRANSFER_OUT",
        date: "2026-05-12T12:00:00Z",
        quantity: "1",
        currency: "USD",
        sourceGroupId: "missing-destination-group",
      });
      const warnings: string[] = [];
      const service = createLocalPortfolioJobService(db, {
        now: () => new Date("2026-05-17T00:00:00Z"),
        warn: (message) => warnings.push(message),
      });

      await service.enqueuePortfolioJob({
        ...buildPortfolioRecalculateConfig({ accountIds: ["account-1"] }),
        marketSyncMode: { type: "none" },
      });

      expect(warnings).toContain(
        "TransferOut transfer-out-1 cached lots for source_group_id missing-destination-group but no paired TransferIn consumed them",
      );
      expect(readSnapshot(db, "account-1", "2026-05-12")).toMatchObject({
        cost_basis: "0",
        net_contribution: "90",
      });
    } finally {
      db.close();
    }
  });

  test("converts transferred cost basis from position currency", async () => {
    const db = createPortfolioJobTestDb();
    try {
      seedAccount(db, "dest-account", false, "CAD", "TRANSACTIONS");
      seedAccount(db, "source-account", false, "CAD", "TRANSACTIONS");
      seedAsset(db, "usd-asset", "USD");
      seedSnapshot(db, {
        accountId: "source-account",
        date: "2026-05-10",
        currency: "CAD",
        positions: {
          "usd-asset": snapshotPosition("source-account", "usd-asset", "1", "10", "USD"),
        },
        cashBalances: {},
        costBasis: "10",
        netContribution: "13",
        netContributionBase: "9",
      });
      seedActivity(db, {
        id: "transfer-out-1",
        accountId: "source-account",
        assetId: "usd-asset",
        type: "TRANSFER_OUT",
        date: "2026-05-12T12:00:00Z",
        quantity: "1",
        currency: "USD",
        fxRate: "1.3",
        sourceGroupId: "cross-currency-group",
      });
      seedActivity(db, {
        id: "transfer-in-1",
        accountId: "dest-account",
        assetId: "usd-asset",
        type: "TRANSFER_IN",
        date: "2026-05-12T12:00:00Z",
        quantity: "1",
        unitPrice: "999",
        currency: "USD",
        fxRate: "1.3",
        sourceGroupId: "cross-currency-group",
      });
      seedQuote(db, "usd-asset", "2026-05-12", "10", "USD");
      const service = createLocalPortfolioJobService(db, {
        baseCurrency: "EUR",
        exchangeRateService: {
          initialize() {},
          getExchangeRateForDate(fromCurrency, toCurrency) {
            if (fromCurrency === "USD" && toCurrency === "CAD") {
              return "1.3";
            }
            if (fromCurrency === "USD" && toCurrency === "EUR") {
              return "0.9";
            }
            if (fromCurrency === "CAD" && toCurrency === "EUR") {
              return "0.7";
            }
            throw new Error(`unexpected FX pair ${fromCurrency}/${toCurrency}`);
          },
        },
        now: () => new Date("2026-05-17T00:00:00Z"),
      });

      await service.enqueuePortfolioJob({
        accountIds: ["source-account", "dest-account"],
        marketSyncMode: { type: "none" },
        snapshotMode: "full",
        valuationMode: "full",
        sinceDate: "2026-05-12",
      });

      expect(readSnapshot(db, "source-account", "2026-05-12")).toMatchObject({
        cost_basis: "0",
        net_contribution: "0",
        net_contribution_base: "0",
      });
      expect(readSnapshot(db, "dest-account", "2026-05-12")).toMatchObject({
        cost_basis: "13",
        net_contribution: "13",
        net_contribution_base: "9",
      });
      expect(readValuation(db, "dest-account", "2026-05-12")).toMatchObject({
        account_currency: "CAD",
        investment_market_value: "13",
        total_value: "13",
      });
    } finally {
      db.close();
    }
  });

  test("orders same-account paired transfers before unit-price fallback", async () => {
    const db = createPortfolioJobTestDb();
    try {
      seedAccount(db, "account-1", false, "USD", "TRANSACTIONS");
      seedAsset(db, "asset-1", "USD");
      seedActivity(db, {
        id: "deposit-1",
        accountId: "account-1",
        type: "DEPOSIT",
        date: "2026-05-10T10:00:00Z",
        amount: "100",
        currency: "USD",
      });
      seedActivity(db, {
        id: "buy-1",
        accountId: "account-1",
        assetId: "asset-1",
        type: "BUY",
        date: "2026-05-10T12:00:00Z",
        quantity: "1",
        unitPrice: "10",
        currency: "USD",
      });
      seedActivity(db, {
        id: "a-transfer-in",
        accountId: "account-1",
        assetId: "asset-1",
        type: "TRANSFER_IN",
        date: "2026-05-12T12:00:00Z",
        quantity: "1",
        unitPrice: "999",
        currency: "USD",
        sourceGroupId: "same-account-group",
      });
      seedActivity(db, {
        id: "z-transfer-out",
        accountId: "account-1",
        assetId: "asset-1",
        type: "TRANSFER_OUT",
        date: "2026-05-12T12:00:00Z",
        quantity: "1",
        currency: "USD",
        sourceGroupId: "same-account-group",
      });
      seedQuote(db, "asset-1", "2026-05-12", "10", "USD");
      const warnings: string[] = [];
      const service = createLocalPortfolioJobService(db, {
        now: () => new Date("2026-05-17T00:00:00Z"),
        warn: (message) => warnings.push(message),
      });

      await service.enqueuePortfolioJob({
        ...buildPortfolioRecalculateConfig({ accountIds: ["account-1"] }),
        marketSyncMode: { type: "none" },
      });

      expect(warnings).toEqual([]);
      expect(readSnapshot(db, "account-1", "2026-05-12")).toMatchObject({
        cash_balances: '{"USD":"90"}',
        cost_basis: "10",
        net_contribution: "100",
      });
      expect(readSnapshotPositions(db, "account-1", "2026-05-12")).toMatchObject({
        "asset-1": expect.objectContaining({
          quantity: "1",
          totalCostBasis: "10",
          lots: [expect.objectContaining({ id: "a-transfer-in", costBasis: "10" })],
        }),
      });
    } finally {
      db.close();
    }
  });

  test("leaves non-option adjustments as no-op without warnings", async () => {
    const db = createPortfolioJobTestDb();
    try {
      seedAccount(db, "account-1", false, "USD", "TRANSACTIONS");
      seedAsset(db, "asset-1", "USD");
      seedActivity(db, {
        id: "deposit-1",
        accountId: "account-1",
        type: "DEPOSIT",
        date: "2026-05-14T10:00:00Z",
        amount: "100",
        currency: "USD",
      });
      seedActivity(db, {
        id: "buy-1",
        accountId: "account-1",
        assetId: "asset-1",
        type: "BUY",
        date: "2026-05-14T12:00:00Z",
        quantity: "2",
        unitPrice: "10",
        currency: "USD",
      });
      seedActivity(db, {
        id: "adjustment-1",
        accountId: "account-1",
        assetId: "asset-1",
        type: "ADJUSTMENT",
        subtype: "RETURN_OF_CAPITAL",
        date: "2026-05-15T12:00:00Z",
        quantity: "1",
        amount: "5",
        currency: "USD",
      });
      seedQuote(db, "asset-1", "2026-05-15", "10", "USD");
      const warnings: string[] = [];
      const service = createLocalPortfolioJobService(db, {
        now: () => new Date("2026-05-17T00:00:00Z"),
        warn: (message) => warnings.push(message),
      });

      await service.enqueuePortfolioJob({
        ...buildPortfolioRecalculateConfig({ accountIds: ["account-1"] }),
        marketSyncMode: { type: "none" },
      });

      expect(warnings).toEqual([]);
      expect(readSnapshot(db, "account-1", "2026-05-15")).toMatchObject({
        cash_balances: '{"USD":"80"}',
        cost_basis: "20",
        net_contribution: "100",
      });
      expect(readSnapshotPositions(db, "account-1", "2026-05-15")).toMatchObject({
        "asset-1": expect.objectContaining({ quantity: "2", totalCostBasis: "20" }),
      });
      expect(readValuation(db, "account-1", "2026-05-15")).toMatchObject({
        investment_market_value: "20",
        total_value: "100",
      });
    } finally {
      db.close();
    }
  });

  test("applies option-expiry adjustments without cash effects", async () => {
    const db = createPortfolioJobTestDb();
    try {
      seedAccount(db, "account-1", false, "USD", "TRANSACTIONS");
      seedAsset(db, "option-1", "USD");
      seedActivity(db, {
        id: "deposit-1",
        accountId: "account-1",
        type: "DEPOSIT",
        date: "2026-05-14T10:00:00Z",
        amount: "30",
        currency: "USD",
      });
      seedActivity(db, {
        id: "buy-1",
        accountId: "account-1",
        assetId: "option-1",
        type: "BUY",
        date: "2026-05-14T12:00:00Z",
        quantity: "3",
        unitPrice: "10",
        currency: "USD",
      });
      seedActivity(db, {
        id: "expiry-1",
        accountId: "account-1",
        assetId: "option-1",
        type: "ADJUSTMENT",
        subtype: "OPTION_EXPIRY",
        date: "2026-05-15T12:00:00Z",
        quantity: "1",
        currency: "USD",
      });
      seedQuote(db, "option-1", "2026-05-15", "10", "USD");
      const service = createLocalPortfolioJobService(db, {
        now: () => new Date("2026-05-17T00:00:00Z"),
      });

      await service.enqueuePortfolioJob({
        ...buildPortfolioRecalculateConfig({ accountIds: ["account-1"] }),
        marketSyncMode: { type: "none" },
      });

      expect(readSnapshot(db, "account-1", "2026-05-15")).toMatchObject({
        cash_balances: '{"USD":"0"}',
        cost_basis: "20",
        net_contribution: "30",
      });
      expect(readSnapshotPositions(db, "account-1", "2026-05-15")).toMatchObject({
        "option-1": expect.objectContaining({
          quantity: "2",
          totalCostBasis: "20",
        }),
      });
      expect(readValuation(db, "account-1", "2026-05-15")).toMatchObject({
        cash_balance: "0",
        investment_market_value: "20",
        total_value: "20",
      });
    } finally {
      db.close();
    }
  });

  test("preprocesses split activities before transaction snapshot replay", async () => {
    const db = createPortfolioJobTestDb();
    try {
      seedAccount(db, "account-1", false, "USD", "TRANSACTIONS");
      seedAsset(db, "asset-1", "USD");
      seedActivity(db, {
        id: "deposit-1",
        accountId: "account-1",
        type: "DEPOSIT",
        date: "2026-05-14T10:00:00Z",
        amount: "2000",
        currency: "USD",
      });
      seedActivity(db, {
        id: "buy-1",
        accountId: "account-1",
        assetId: "asset-1",
        type: "BUY",
        date: "2026-05-14T12:00:00Z",
        quantity: "10",
        unitPrice: "200",
        currency: "USD",
      });
      seedActivity(db, {
        id: "split-1",
        accountId: "account-1",
        assetId: "asset-1",
        type: "SPLIT",
        date: "2026-05-15T12:00:00Z",
        amount: "2",
        currency: "USD",
      });
      seedQuote(db, "asset-1", "2026-05-15", "100", "USD");
      const warnings: string[] = [];
      const service = createLocalPortfolioJobService(db, {
        now: () => new Date("2026-05-17T00:00:00Z"),
        warn: (message) => warnings.push(message),
      });

      await service.enqueuePortfolioJob({
        ...buildPortfolioRecalculateConfig({ accountIds: ["account-1"] }),
        marketSyncMode: { type: "none" },
      });

      expect(readSnapshotPositions(db, "account-1", "2026-05-15")).toMatchObject({
        "asset-1": expect.objectContaining({
          quantity: "20",
          averageCost: "100",
          totalCostBasis: "2000",
        }),
      });
      expect(readValuation(db, "account-1", "2026-05-15")).toMatchObject({
        investment_market_value: "2000",
        total_value: "2000",
      });
      expect(warnings).toEqual([]);
    } finally {
      db.close();
    }
  });

  test("restarts since-date replay from earliest activity when a split is in range", async () => {
    const db = createPortfolioJobTestDb();
    try {
      seedAccount(db, "account-1", false, "USD", "TRANSACTIONS");
      seedAsset(db, "asset-1", "USD");
      seedSnapshot(db, {
        accountId: "account-1",
        date: "2026-05-14",
        positions: {
          "asset-1": snapshotPosition("account-1", "asset-1", "10", "1000", "USD"),
        },
        cashBalances: {},
        costBasis: "1000",
        netContribution: "1000",
      });
      seedActivity(db, {
        id: "deposit-1",
        accountId: "account-1",
        type: "DEPOSIT",
        date: "2026-05-14T10:00:00Z",
        amount: "1000",
        currency: "USD",
      });
      seedActivity(db, {
        id: "buy-1",
        accountId: "account-1",
        assetId: "asset-1",
        type: "BUY",
        date: "2026-05-14T12:00:00Z",
        quantity: "10",
        unitPrice: "100",
        currency: "USD",
      });
      seedActivity(db, {
        id: "split-1",
        accountId: "account-1",
        assetId: "asset-1",
        type: "SPLIT",
        date: "2026-05-15T12:00:00Z",
        amount: "5",
        currency: "USD",
      });
      seedQuote(db, "asset-1", "2026-05-15", "20", "USD");
      const service = createLocalPortfolioJobService(db, {
        now: () => new Date("2026-05-17T00:00:00Z"),
      });

      await service.enqueuePortfolioJob({
        accountIds: ["account-1"],
        marketSyncMode: { type: "none" },
        snapshotMode: "full",
        valuationMode: "full",
        sinceDate: "2026-05-15",
      });

      expect(readSnapshotPositions(db, "account-1", "2026-05-15")).toMatchObject({
        "asset-1": expect.objectContaining({
          quantity: "50",
          averageCost: "20",
          totalCostBasis: "1000",
        }),
      });
      expect(readValuation(db, "account-1", "2026-05-15")).toMatchObject({
        investment_market_value: "1000",
        total_value: "1000",
      });
    } finally {
      db.close();
    }
  });

  test("does not restart split since-date replay when no seed snapshot exists", async () => {
    const db = createPortfolioJobTestDb();
    try {
      seedAccount(db, "account-1", false, "USD", "TRANSACTIONS");
      seedAsset(db, "asset-1", "USD");
      seedActivity(db, {
        id: "deposit-1",
        accountId: "account-1",
        type: "DEPOSIT",
        date: "2026-05-14T10:00:00Z",
        amount: "1000",
        currency: "USD",
      });
      seedActivity(db, {
        id: "buy-1",
        accountId: "account-1",
        assetId: "asset-1",
        type: "BUY",
        date: "2026-05-14T12:00:00Z",
        quantity: "10",
        unitPrice: "100",
        currency: "USD",
      });
      seedActivity(db, {
        id: "split-1",
        accountId: "account-1",
        assetId: "asset-1",
        type: "SPLIT",
        date: "2026-05-15T12:00:00Z",
        amount: "5",
        currency: "USD",
      });
      const service = createLocalPortfolioJobService(db, {
        now: () => new Date("2026-05-17T00:00:00Z"),
      });

      await service.enqueuePortfolioJob({
        accountIds: ["account-1"],
        marketSyncMode: { type: "none" },
        snapshotMode: "full",
        valuationMode: "full",
        sinceDate: "2026-05-15",
      });

      expect(readSnapshot(db, "account-1", "2026-05-14")).toBeNull();
      expect(readSnapshot(db, "account-1", "2026-05-15")).toMatchObject({
        cash_balances: "{}",
        cost_basis: "0",
      });
      expect(readSnapshotPositions(db, "account-1", "2026-05-15")).toEqual({});
    } finally {
      db.close();
    }
  });

  test("deduplicates same-day split factors across transaction accounts", async () => {
    const db = createPortfolioJobTestDb();
    try {
      seedAccount(db, "account-1", false, "USD", "TRANSACTIONS");
      seedAccount(db, "account-2", false, "USD", "TRANSACTIONS");
      seedAsset(db, "asset-1", "USD");
      for (const accountId of ["account-1", "account-2"]) {
        seedActivity(db, {
          id: `${accountId}-deposit`,
          accountId,
          type: "DEPOSIT",
          date: "2026-05-14T10:00:00Z",
          amount: "2000",
          currency: "USD",
        });
        seedActivity(db, {
          id: `${accountId}-buy`,
          accountId,
          assetId: "asset-1",
          type: "BUY",
          date: "2026-05-14T12:00:00Z",
          quantity: "10",
          unitPrice: "200",
          currency: "USD",
        });
        seedActivity(db, {
          id: `${accountId}-split`,
          accountId,
          assetId: "asset-1",
          type: "SPLIT",
          date: "2026-05-15T12:00:00Z",
          amount: "2",
          currency: "USD",
        });
      }
      seedQuote(db, "asset-1", "2026-05-15", "100", "USD");
      const service = createLocalPortfolioJobService(db, {
        now: () => new Date("2026-05-17T00:00:00Z"),
      });

      await service.enqueuePortfolioJob({
        ...buildPortfolioRecalculateConfig(),
        marketSyncMode: { type: "none" },
      });

      expect(readSnapshotPositions(db, "account-1", "2026-05-15")).toMatchObject({
        "asset-1": expect.objectContaining({ quantity: "20" }),
      });
      expect(readSnapshotPositions(db, "account-2", "2026-05-15")).toMatchObject({
        "asset-1": expect.objectContaining({ quantity: "20" }),
      });
      expect(readSnapshotPositions(db, "TOTAL", "2026-05-15")).toMatchObject({
        "asset-1": expect.objectContaining({ quantity: "40" }),
      });
    } finally {
      db.close();
    }
  });

  test("full recalculation is transactional and honors explicit archived targets", async () => {
    const db = createPortfolioJobTestDb();
    try {
      seedAccount(db, "account-1", false);
      seedAccount(db, "archived-account", true);
      seedSnapshot(db, {
        accountId: "account-1",
        date: "2026-05-16",
        positions: {},
        cashBalances: { USD: "5" },
        costBasis: "0",
        netContribution: "5",
      });
      seedSnapshot(db, {
        accountId: "archived-account",
        date: "2026-05-16",
        positions: {},
        cashBalances: { USD: "7" },
        costBasis: "0",
        netContribution: "7",
      });
      seedValuation(db, "archived-account", "2026-05-01", "999");
      const service = createLocalPortfolioJobService(db, {
        now: () => new Date("2026-05-17T00:00:00Z"),
      });

      await service.enqueuePortfolioJob({
        ...buildPortfolioRecalculateConfig({ accountIds: ["archived-account"] }),
        marketSyncMode: { type: "none" },
      });

      expect(readValuation(db, "archived-account", "2026-05-01")).toBeNull();
      expect(readValuation(db, "archived-account", "2026-05-16")).toMatchObject({
        cash_balance: "7",
        total_value: "7",
      });
      expect(readValuation(db, "TOTAL", "2026-05-16")).toMatchObject({
        cash_balance: "5",
        total_value: "5",
      });
    } finally {
      db.close();
    }
  });

  test("keeps manual no-quote snapshots as cash-only valuations", async () => {
    const db = createPortfolioJobTestDb();
    try {
      seedAccount(db, "account-1", false);
      seedSnapshot(db, {
        accountId: "account-1",
        date: "2026-05-16",
        positions: {
          "manual-asset": snapshotPosition("account-1", "manual-asset", "1", "100", "USD"),
        },
        cashBalances: { USD: "3" },
        costBasis: "100",
        netContribution: "103",
      });
      const service = createLocalPortfolioJobService(db, {
        now: () => new Date("2026-05-17T00:00:00Z"),
      });

      await service.enqueuePortfolioJob({
        ...buildPortfolioUpdateConfig(),
        marketSyncMode: { type: "none" },
      });

      expect(readValuation(db, "account-1", "2026-05-16")).toMatchObject({
        investment_market_value: "0",
        cash_balance: "3",
        total_value: "3",
      });
    } finally {
      db.close();
    }
  });

  test("uses exchange-rate service for non-base account valuations", async () => {
    const db = createPortfolioJobTestDb();
    try {
      seedAccount(db, "cad-account", false, "CAD");
      seedSnapshot(db, {
        accountId: "cad-account",
        date: "2026-05-16",
        currency: "CAD",
        positions: {
          "usd-asset": snapshotPosition("cad-account", "usd-asset", "2", "12", "USD"),
        },
        cashBalances: { CAD: "5" },
        costBasis: "15.6",
        netContribution: "20.6",
        netContributionBase: "",
      });
      seedQuote(db, "usd-asset", "2026-05-16", "10", "USD");
      const service = createLocalPortfolioJobService(db, {
        baseCurrency: "USD",
        exchangeRateService: {
          initialize() {},
          getExchangeRateForDate(fromCurrency, toCurrency) {
            if (fromCurrency === "USD" && toCurrency === "CAD") {
              return "1.3";
            }
            if (fromCurrency === "CAD" && toCurrency === "USD") {
              return "0.75";
            }
            throw new Error(`unexpected FX pair ${fromCurrency}/${toCurrency}`);
          },
        },
        now: () => new Date("2026-05-17T00:00:00Z"),
      });

      await service.enqueuePortfolioJob({
        ...buildPortfolioUpdateConfig({ accountIds: ["cad-account"] }),
        marketSyncMode: { type: "none" },
      });

      expect(readValuation(db, "cad-account", "2026-05-16")).toMatchObject({
        account_currency: "CAD",
        base_currency: "USD",
        fx_rate_to_base: "0.75",
        investment_market_value: "26",
        cash_balance: "5",
        total_value: "31",
      });
      expect(readValuation(db, "TOTAL", "2026-05-16")).toMatchObject({
        net_contribution: "15.45",
      });
    } finally {
      db.close();
    }
  });

  test("rolls back TOTAL recalculation when required FX is unavailable", async () => {
    const db = createPortfolioJobTestDb();
    try {
      seedAccount(db, "cad-account", false, "CAD");
      seedSnapshot(db, {
        accountId: "cad-account",
        date: "2026-05-16",
        currency: "CAD",
        positions: {},
        cashBalances: { CAD: "5" },
        costBasis: "0",
        netContribution: "5",
      });
      seedValuation(db, "TOTAL", "2026-05-01", "999");
      const events: BackendEvent[] = [];
      const service = createLocalPortfolioJobService(db, {
        baseCurrency: "USD",
        eventBus: recordingEventBus(events),
        now: () => new Date("2026-05-17T00:00:00Z"),
      });

      await expect(
        service.enqueuePortfolioJob({
          ...buildPortfolioRecalculateConfig(),
          marketSyncMode: { type: "none" },
        }),
      ).rejects.toThrow("Missing exchange rate CAD/USD on 2026-05-16");

      expect(readValuation(db, "TOTAL", "2026-05-01")).toMatchObject({
        total_value: "999",
      });
      expect(events.map((event) => event.name)).toEqual([
        "portfolio:update-start",
        "portfolio:update-error",
      ]);
    } finally {
      db.close();
    }
  });
});

function createPortfolioJobTestDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      is_active INTEGER NOT NULL DEFAULT 1,
      is_archived INTEGER NOT NULL DEFAULT 0,
      tracking_mode TEXT NOT NULL DEFAULT 'HOLDINGS'
    );
    CREATE TABLE assets (
      id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL DEFAULT 'INVESTMENT',
      quote_ccy TEXT,
      instrument_type TEXT,
      metadata TEXT
    );
    CREATE TABLE activities (
      id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL,
      asset_id TEXT,
      activity_type TEXT NOT NULL,
      activity_type_override TEXT,
      subtype TEXT,
      status TEXT NOT NULL DEFAULT 'POSTED',
      activity_date TEXT NOT NULL,
      quantity TEXT,
      unit_price TEXT,
      amount TEXT,
      fee TEXT,
      currency TEXT NOT NULL,
      fx_rate TEXT,
      source_group_id TEXT
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
    CREATE TABLE quotes (
      id TEXT PRIMARY KEY NOT NULL,
      asset_id TEXT NOT NULL,
      day TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'MANUAL',
      close TEXT NOT NULL,
      currency TEXT NOT NULL,
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
  `);
  return db;
}

function seedAccount(
  db: Database,
  accountId: string,
  archived: boolean,
  currency = "USD",
  trackingMode = "HOLDINGS",
): void {
  db.query(
    `
      INSERT INTO accounts (id, name, currency, is_active, is_archived, tracking_mode)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
  ).run(accountId, accountId, currency, archived ? 0 : 1, archived ? 1 : 0, trackingMode);
}

function seedAsset(
  db: Database,
  assetId: string,
  quoteCurrency: string,
  options: { instrumentType?: string | null; metadata?: Record<string, unknown> | null } = {},
): void {
  db.query(
    `
      INSERT INTO assets (id, kind, quote_ccy, instrument_type, metadata)
      VALUES (?, 'INVESTMENT', ?, ?, ?)
    `,
  ).run(
    assetId,
    quoteCurrency,
    options.instrumentType ?? null,
    options.metadata ? JSON.stringify(options.metadata) : null,
  );
}

function seedActivity(
  db: Database,
  activity: {
    id: string;
    accountId: string;
    assetId?: string | null;
    type: string;
    activityTypeOverride?: string | null;
    subtype?: string | null;
    status?: string;
    date: string;
    quantity?: string | null;
    unitPrice?: string | null;
    amount?: string | null;
    fee?: string | null;
    currency: string;
    fxRate?: string | null;
    sourceGroupId?: string | null;
  },
): void {
  db.query(
    `
      INSERT INTO activities (
        id, account_id, asset_id, activity_type, activity_type_override, subtype, status, activity_date,
        quantity, unit_price, amount, fee, currency, fx_rate, source_group_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    activity.id,
    activity.accountId,
    activity.assetId ?? null,
    activity.type,
    activity.activityTypeOverride ?? null,
    activity.subtype ?? null,
    activity.status ?? "POSTED",
    activity.date,
    activity.quantity ?? null,
    activity.unitPrice ?? null,
    activity.amount ?? null,
    activity.fee ?? null,
    activity.currency,
    activity.fxRate ?? null,
    activity.sourceGroupId ?? null,
  );
}

function seedSnapshot(
  db: Database,
  snapshot: {
    accountId: string;
    date: string;
    currency?: string;
    source?: string;
    positions: Record<string, unknown>;
    cashBalances: Record<string, string>;
    costBasis: string;
    netContribution: string;
    netContributionBase?: string;
  },
): void {
  db.query(
    `
      INSERT INTO holdings_snapshots (
        id, account_id, snapshot_date, currency, positions, cash_balances,
        cost_basis, net_contribution, net_contribution_base, source
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    `${snapshot.accountId}_${snapshot.date}`,
    snapshot.accountId,
    snapshot.date,
    snapshot.currency ?? "USD",
    JSON.stringify(snapshot.positions),
    JSON.stringify(snapshot.cashBalances),
    snapshot.costBasis,
    snapshot.netContribution,
    snapshot.netContributionBase ?? snapshot.netContribution,
    snapshot.source ?? "CALCULATED",
  );
}

function snapshotPosition(
  accountId: string,
  assetId: string,
  quantity: string,
  totalCostBasis: string,
  currency: string,
): Record<string, string | boolean | unknown[]> {
  return {
    id: `${assetId}_${accountId}`,
    accountId,
    assetId,
    quantity,
    averageCost: quantity === "0" ? "0" : totalCostBasis,
    totalCostBasis,
    currency,
    inceptionDate: "2026-01-01T00:00:00Z",
    lots: [],
    createdAt: "2026-01-01T00:00:00Z",
    lastUpdated: "2026-01-01T00:00:00Z",
    isAlternative: false,
    contractMultiplier: "1",
  };
}

function seedQuote(
  db: Database,
  assetId: string,
  day: string,
  close: string,
  currency: string,
): void {
  db.query(
    `
      INSERT INTO quotes (id, asset_id, day, source, close, currency, timestamp)
      VALUES (?, ?, ?, 'MANUAL', ?, ?, ?)
    `,
  ).run(`${assetId}_${day}_MANUAL`, assetId, day, close, currency, `${day}T16:00:00Z`);
}

function seedValuation(db: Database, accountId: string, date: string, totalValue: string): void {
  db.query(
    `
      INSERT INTO daily_account_valuation (
        id, account_id, valuation_date, account_currency, base_currency,
        fx_rate_to_base, cash_balance, investment_market_value, total_value,
        cost_basis, net_contribution, calculated_at
      )
      VALUES (?, ?, ?, 'USD', 'USD', '1', '0', '0', ?, '0', '0', ?)
    `,
  ).run(`${accountId}_${date}`, accountId, date, totalValue, `${date}T00:00:00Z`);
}

function readValuation(
  db: Database,
  accountId: string,
  date: string,
): Record<string, string> | null {
  return (
    db
      .query<Record<string, string>, [string, string]>(
        `
          SELECT *
          FROM daily_account_valuation
          WHERE account_id = ?
            AND valuation_date = ?
        `,
      )
      .get(accountId, date) ?? null
  );
}

function readSnapshotPositions(
  db: Database,
  accountId: string,
  date: string,
): Record<string, unknown> {
  const row = db
    .query<{ positions: string }, [string, string]>(
      `
        SELECT positions
        FROM holdings_snapshots
        WHERE account_id = ?
          AND snapshot_date = ?
      `,
    )
    .get(accountId, date);
  return row ? (JSON.parse(row.positions) as Record<string, unknown>) : {};
}

function decimalMapToRecord(
  holdings: ReadonlyMap<string, { toString(): string }>,
): Record<string, string> {
  return Object.fromEntries(
    Array.from(holdings, ([assetId, quantity]) => [assetId, quantity.toString()]),
  );
}

function readSnapshot(
  db: Database,
  accountId: string,
  date: string,
): Record<string, string> | null {
  return (
    db
      .query<Record<string, string>, [string, string]>(
        `
          SELECT *
          FROM holdings_snapshots
          WHERE account_id = ?
            AND snapshot_date = ?
        `,
      )
      .get(accountId, date) ?? null
  );
}

function readCalculatedSnapshotCount(db: Database, accountId: string): number {
  return (
    db
      .query<{ count: number }, [string]>(
        `
          SELECT COUNT(*) AS count
          FROM holdings_snapshots
          WHERE account_id = ?
            AND source = 'CALCULATED'
        `,
      )
      .get(accountId)?.count ?? 0
  );
}

function recordingEventBus(events: BackendEvent[]) {
  return {
    publish(event: BackendEvent) {
      events.push(event);
    },
    subscribe() {
      return () => {};
    },
  };
}
