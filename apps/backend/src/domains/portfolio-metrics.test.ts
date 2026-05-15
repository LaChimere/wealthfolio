import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { createPortfolioMetricsService } from "./portfolio-metrics";

describe("TS portfolio metrics domain", () => {
  test("calculates current net worth from snapshots, cash, alternative assets, and liabilities", () => {
    const db = createPortfolioMetricsDb();
    const service = createPortfolioMetricsService(db, {
      baseCurrency: "USD",
      exchangeRateService: fakeExchangeRateService({
        "GBP/USD": "2",
        "EUR/USD": "1.5",
        "CAD/USD": "0.8",
      }),
    });

    try {
      insertAccount(db, { id: "brokerage", accountType: "SECURITIES" });
      insertAccount(db, { id: "archived", accountType: "CASH", isArchived: 1 });
      insertAsset(db, {
        id: "lse",
        kind: "INVESTMENT",
        name: "",
        displayCode: "LSE",
        quoteCcy: "GBp",
      });
      insertAsset(db, { id: "home", kind: "PROPERTY", name: "Home", quoteCcy: "CAD" });
      insertAsset(db, { id: "loan", kind: "LIABILITY", name: "Mortgage", quoteCcy: "USD" });
      insertSnapshot(db, {
        accountId: "brokerage",
        date: "2026-01-09",
        positions: {
          lse: {
            quantity: "10",
            totalCostBasis: "1000",
            currency: "GBp",
            contractMultiplier: "1",
          },
          missing: {
            quantity: "2",
            totalCostBasis: "50",
            currency: "USD",
          },
        },
        cashBalances: { EUR: "50" },
      });
      insertSnapshot(db, {
        accountId: "archived",
        date: "2026-01-09",
        positions: {},
        cashBalances: { USD: "999999" },
      });
      insertQuote(db, {
        assetId: "lse",
        day: "2026-01-10",
        close: "1234",
        currency: "GBP",
      });
      insertQuote(db, {
        assetId: "home",
        day: "2026-01-01",
        close: "1000",
        currency: "CAD",
      });
      insertQuote(db, {
        assetId: "loan",
        day: "2025-09-01",
        close: "300",
        currency: "USD",
      });

      expect(service.getNetWorth("2026-01-10")).toEqual({
        date: "2026-01-10",
        assets: {
          total: 1171.8,
          breakdown: [
            { category: "properties", name: "Properties", value: 800 },
            { category: "investments", name: "Investments", value: 296.8 },
            { category: "cash", name: "Cash", value: 75 },
          ],
        },
        liabilities: {
          total: 300,
          breakdown: [{ category: "liability", name: "Mortgage", value: 300, assetId: "loan" }],
        },
        netWorth: 871.8,
        currency: "USD",
        oldestValuationDate: "2025-09-01",
        staleAssets: [
          {
            assetId: "loan",
            name: "Mortgage",
            valuationDate: "2025-09-01",
            daysStale: 131,
          },
        ],
      });
    } finally {
      db.close();
    }
  });

  test("preserves Rust-compatible empty response when there are no non-archived accounts", () => {
    const db = createPortfolioMetricsDb();
    const service = createPortfolioMetricsService(db, {
      baseCurrency: "USD",
      exchangeRateService: fakeExchangeRateService({}),
    });

    try {
      insertAsset(db, { id: "home", kind: "PROPERTY", name: "Home" });
      insertQuote(db, { assetId: "home", day: "2026-01-01", close: "1000", currency: "USD" });

      expect(service.getNetWorth("2026-01-10")).toEqual({
        date: "2026-01-10",
        assets: { total: 0, breakdown: [] },
        liabilities: { total: 0, breakdown: [] },
        netWorth: 0,
        currency: "USD",
        oldestValuationDate: null,
        staleAssets: [],
      });
    } finally {
      db.close();
    }
  });

  test("uses Rust-compatible local-value fallbacks when FX conversion fails", () => {
    const db = createPortfolioMetricsDb();
    const warnings: string[] = [];
    const service = createPortfolioMetricsService(db, {
      baseCurrency: "USD",
      exchangeRateService: fakeExchangeRateService({}),
      warn: (message) => warnings.push(message),
    });

    try {
      insertAccount(db, { id: "brokerage", accountType: "SECURITIES" });
      insertAsset(db, { id: "lse", kind: "INVESTMENT", quoteCcy: "GBp" });
      insertAsset(db, { id: "collectible", kind: "COLLECTIBLE", quoteCcy: "GBp" });
      insertSnapshot(db, {
        accountId: "brokerage",
        date: "2026-01-09",
        positions: {
          lse: {
            quantity: "2",
            totalCostBasis: "1000",
            currency: "GBp",
            contractMultiplier: "1",
          },
        },
        cashBalances: { EUR: "20" },
      });
      insertQuote(db, {
        assetId: "lse",
        day: "2026-01-10",
        close: "1234",
        currency: "GBP",
      });
      insertQuote(db, {
        assetId: "collectible",
        day: "2026-01-10",
        close: "500",
        currency: "GBP",
      });

      expect(service.getNetWorth("2026-01-10")).toMatchObject({
        assets: {
          total: 2988,
          breakdown: [
            { category: "investments", name: "Investments", value: 2468 },
            { category: "collectibles", name: "Collectibles", value: 500 },
            { category: "cash", name: "Cash", value: 20 },
          ],
        },
        netWorth: 2988,
      });
      expect(warnings).toEqual([
        expect.stringContaining("Failed to calculate market value for lse"),
        expect.stringContaining("Failed to convert cash 20 EUR to USD"),
        expect.stringContaining("Failed to convert alternative asset collectible value"),
      ]);
    } finally {
      db.close();
    }
  });

  test("builds net worth history from TOTAL valuations and filled alternative asset quotes", () => {
    const db = createPortfolioMetricsDb();
    const service = createPortfolioMetricsService(db, {
      baseCurrency: "USD",
      exchangeRateService: fakeExchangeRateService({ "CAD/USD": "0.8" }),
    });

    try {
      insertAsset(db, { id: "home", kind: "PROPERTY", name: "Home", quoteCcy: "CAD" });
      insertAsset(db, { id: "loan", kind: "LIABILITY", name: "Mortgage", quoteCcy: "USD" });
      insertDailyAccountValuation(db, {
        accountId: "TOTAL",
        date: "2026-01-01",
        totalValue: "100",
        netContribution: "80",
      });
      insertDailyAccountValuation(db, {
        accountId: "TOTAL",
        date: "2026-01-03",
        totalValue: "150",
        netContribution: "100",
      });
      insertQuote(db, { assetId: "home", day: "2025-12-31", close: "10", currency: "CAD" });
      insertQuote(db, { assetId: "home", day: "2026-01-02", close: "20", currency: "CAD" });
      insertQuote(db, { assetId: "loan", day: "2026-01-02", close: "5", currency: "USD" });

      expect(service.getNetWorthHistory("2026-01-01", "2026-01-03")).toEqual([
        {
          date: "2026-01-01",
          portfolioValue: 100,
          alternativeAssetsValue: 8,
          totalLiabilities: 0,
          totalAssets: 108,
          netWorth: 108,
          netContribution: 80,
          currency: "USD",
        },
        {
          date: "2026-01-02",
          portfolioValue: 100,
          alternativeAssetsValue: 16,
          totalLiabilities: 5,
          totalAssets: 116,
          netWorth: 111,
          netContribution: 80,
          currency: "USD",
        },
        {
          date: "2026-01-03",
          portfolioValue: 150,
          alternativeAssetsValue: 16,
          totalLiabilities: 5,
          totalAssets: 166,
          netWorth: 161,
          netContribution: 100,
          currency: "USD",
        },
      ]);
    } finally {
      db.close();
    }
  });
});

function createPortfolioMetricsDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY NOT NULL,
      account_type TEXT NOT NULL DEFAULT 'SECURITIES',
      currency TEXT NOT NULL DEFAULT 'USD',
      is_archived INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE assets (
      id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL DEFAULT 'INVESTMENT',
      name TEXT,
      display_code TEXT,
      quote_ccy TEXT NOT NULL DEFAULT 'USD'
    );
    CREATE TABLE holdings_snapshots (
      account_id TEXT NOT NULL,
      snapshot_date TEXT NOT NULL,
      positions TEXT NOT NULL DEFAULT '{}',
      cash_balances TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE quotes (
      asset_id TEXT NOT NULL,
      day TEXT NOT NULL,
      close TEXT NOT NULL,
      currency TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );
    CREATE TABLE daily_account_valuation (
      account_id TEXT NOT NULL,
      valuation_date TEXT NOT NULL,
      total_value TEXT NOT NULL,
      net_contribution TEXT NOT NULL
    );
  `);
  return db;
}

function fakeExchangeRateService(rates: Record<string, string>) {
  return {
    convertCurrencyForDate(
      amount: string,
      fromCurrency: string,
      toCurrency: string,
      _date: string | Date,
    ): string {
      const rate = rates[`${fromCurrency}/${toCurrency}`];
      if (!rate) {
        throw new Error(`No exchange rate found for ${fromCurrency}/${toCurrency}`);
      }
      return (Number(amount) * Number(rate)).toString();
    },
  };
}

function insertAccount(
  db: Database,
  account: { id: string; accountType: string; currency?: string; isArchived?: number },
): void {
  db.prepare(
    "INSERT INTO accounts (id, account_type, currency, is_archived) VALUES (?, ?, ?, ?)",
  ).run(account.id, account.accountType, account.currency ?? "USD", account.isArchived ?? 0);
}

function insertAsset(
  db: Database,
  asset: {
    id: string;
    kind: string;
    name?: string | null;
    displayCode?: string | null;
    quoteCcy?: string;
  },
): void {
  db.prepare(
    "INSERT INTO assets (id, kind, name, display_code, quote_ccy) VALUES (?, ?, ?, ?, ?)",
  ).run(
    asset.id,
    asset.kind,
    asset.name ?? null,
    asset.displayCode ?? null,
    asset.quoteCcy ?? "USD",
  );
}

function insertSnapshot(
  db: Database,
  snapshot: {
    accountId: string;
    date: string;
    positions: Record<string, unknown>;
    cashBalances: Record<string, unknown>;
  },
): void {
  db.prepare(
    `
      INSERT INTO holdings_snapshots (account_id, snapshot_date, positions, cash_balances)
      VALUES (?, ?, ?, ?)
    `,
  ).run(
    snapshot.accountId,
    snapshot.date,
    JSON.stringify(snapshot.positions),
    JSON.stringify(snapshot.cashBalances),
  );
}

function insertQuote(
  db: Database,
  quote: { assetId: string; day: string; close: string; currency: string },
): void {
  db.prepare(
    "INSERT INTO quotes (asset_id, day, close, currency, timestamp) VALUES (?, ?, ?, ?, ?)",
  ).run(quote.assetId, quote.day, quote.close, quote.currency, `${quote.day}T12:00:00Z`);
}

function insertDailyAccountValuation(
  db: Database,
  valuation: { accountId: string; date: string; totalValue: string; netContribution: string },
): void {
  db.prepare(
    `
      INSERT INTO daily_account_valuation (
        account_id, valuation_date, total_value, net_contribution
      )
      VALUES (?, ?, ?, ?)
    `,
  ).run(valuation.accountId, valuation.date, valuation.totalValue, valuation.netContribution);
}
