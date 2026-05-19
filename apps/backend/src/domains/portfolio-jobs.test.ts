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
      is_archived INTEGER NOT NULL DEFAULT 0
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

function seedAccount(db: Database, accountId: string, archived: boolean, currency = "USD"): void {
  db.query(
    `
      INSERT INTO accounts (id, name, currency, is_active, is_archived)
      VALUES (?, ?, ?, ?, ?)
    `,
  ).run(accountId, accountId, currency, archived ? 0 : 1, archived ? 1 : 0);
}

function seedSnapshot(
  db: Database,
  snapshot: {
    accountId: string;
    date: string;
    currency?: string;
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
        cost_basis, net_contribution, net_contribution_base
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
