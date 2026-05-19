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
      const synced: unknown[] = [];
      const service = createLocalPortfolioJobService(db, {
        eventBus: recordingEventBus(events),
        marketDataService: {
          syncMarketData(mode) {
            synced.push(mode);
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
      });

      await service.enqueuePortfolioJob(buildPortfolioUpdateConfig());

      expect(synced).toEqual([{ type: "incremental", asset_ids: null }]);
      expect(events.map((event) => event.name)).toEqual([
        "market:sync-start",
        "market:sync-complete",
        "portfolio:update-start",
        "portfolio:update-complete",
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

  test("warns and preserves seeded positions for deferred asset transfers", async () => {
    const db = createPortfolioJobTestDb();
    try {
      seedAccount(db, "account-1", false, "USD", "TRANSACTIONS");
      seedAsset(db, "asset-1", "USD");
      seedSnapshot(db, {
        accountId: "account-1",
        date: "2026-05-10",
        positions: {
          "asset-1": snapshotPosition("account-1", "asset-1", "2", "20", "USD"),
        },
        cashBalances: {},
        costBasis: "20",
        netContribution: "20",
      });
      seedActivity(db, {
        id: "transfer-out-1",
        accountId: "account-1",
        assetId: "asset-1",
        type: "TRANSFER_OUT",
        date: "2026-05-12T12:00:00Z",
        quantity: "1",
        currency: "USD",
      });
      seedQuote(db, "asset-1", "2026-05-12", "10", "USD");
      const warnings: string[] = [];
      const service = createLocalPortfolioJobService(db, {
        now: () => new Date("2026-05-17T00:00:00Z"),
        warn: (message) => warnings.push(message),
      });

      await service.enqueuePortfolioJob({
        accountIds: ["account-1"],
        marketSyncMode: { type: "none" },
        snapshotMode: "full",
        valuationMode: "full",
        sinceDate: "2026-05-12",
      });

      expect(warnings).toContain(
        "Skipping asset transfer activity transfer-out-1 during TS snapshot rebuild; lot-level transfers remain deferred",
      );
      expect(readSnapshotPositions(db, "account-1", "2026-05-12")).toMatchObject({
        "asset-1": expect.objectContaining({ quantity: "2", totalCostBasis: "20" }),
      });
      expect(readValuation(db, "account-1", "2026-05-12")).toMatchObject({
        investment_market_value: "20",
        total_value: "20",
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
      quote_ccy TEXT
    );
    CREATE TABLE activities (
      id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL,
      asset_id TEXT,
      activity_type TEXT NOT NULL,
      subtype TEXT,
      status TEXT NOT NULL DEFAULT 'POSTED',
      activity_date TEXT NOT NULL,
      quantity TEXT,
      unit_price TEXT,
      amount TEXT,
      fee TEXT,
      currency TEXT NOT NULL,
      fx_rate TEXT
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

function seedAsset(db: Database, assetId: string, quoteCurrency: string): void {
  db.query(
    `
      INSERT INTO assets (id, kind, quote_ccy)
      VALUES (?, 'INVESTMENT', ?)
    `,
  ).run(assetId, quoteCurrency);
}

function seedActivity(
  db: Database,
  activity: {
    id: string;
    accountId: string;
    assetId?: string | null;
    type: string;
    subtype?: string | null;
    status?: string;
    date: string;
    quantity?: string | null;
    unitPrice?: string | null;
    amount?: string | null;
    fee?: string | null;
    currency: string;
    fxRate?: string | null;
  },
): void {
  db.query(
    `
      INSERT INTO activities (
        id, account_id, asset_id, activity_type, subtype, status, activity_date,
        quantity, unit_price, amount, fee, currency, fx_rate
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    activity.id,
    activity.accountId,
    activity.assetId ?? null,
    activity.type,
    activity.subtype ?? null,
    activity.status ?? "POSTED",
    activity.date,
    activity.quantity ?? null,
    activity.unitPrice ?? null,
    activity.amount ?? null,
    activity.fee ?? null,
    activity.currency,
    activity.fxRate ?? null,
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
