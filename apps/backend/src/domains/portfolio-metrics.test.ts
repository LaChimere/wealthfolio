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

  test("calculates simple account performance with active-account defaulting and exact previous dates", () => {
    const db = createPortfolioMetricsDb();
    const service = createPortfolioMetricsService(db, {
      baseCurrency: "USD",
      exchangeRateService: fakeExchangeRateService({}),
    });

    try {
      insertAccount(db, { id: "a1", accountType: "SECURITIES", name: "Alpha" });
      insertAccount(db, {
        id: "a2",
        accountType: "SECURITIES",
        name: "Beta Archived",
        isArchived: 1,
      });
      insertAccount(db, {
        id: "inactive",
        accountType: "SECURITIES",
        name: "Inactive",
        isActive: 0,
      });
      insertDailyAccountValuation(db, {
        accountId: "a1",
        date: "2024-03-09",
        totalValue: "100.456789",
        netContribution: "90",
        accountCurrency: "CAD",
        baseCurrency: "USD",
        fxRateToBase: "1.5",
      });
      insertDailyAccountValuation(db, {
        accountId: "a1",
        date: "2024-03-10",
        totalValue: "123.456789",
        netContribution: "100",
        accountCurrency: "CAD",
        baseCurrency: "USD",
        fxRateToBase: "1.5",
      });
      insertDailyAccountValuation(db, {
        accountId: "a2",
        date: "2024-03-10",
        totalValue: "50",
        netContribution: "0",
        accountCurrency: "USD",
        baseCurrency: "USD",
      });
      insertDailyAccountValuation(db, {
        accountId: "inactive",
        date: "2024-03-10",
        totalValue: "999",
        netContribution: "1",
      });
      insertDailyAccountValuation(db, {
        accountId: "TOTAL",
        date: "2024-03-10",
        totalValue: "150",
        netContribution: "150",
        accountCurrency: "USD",
        baseCurrency: "USD",
      });

      expect(
        service.calculateAccountsSimplePerformance?.(["a2", "missing", "TOTAL", "a1"]),
      ).toEqual([
        {
          accountId: "a2",
          accountCurrency: "USD",
          baseCurrency: "USD",
          fxRateToBase: 1,
          totalValue: 50,
          totalGainLossAmount: 50,
          cumulativeReturnPercent: null,
          dayGainLossAmount: null,
          dayReturnPercentModDietz: null,
          portfolioWeight: 0.3333,
        },
        {
          accountId: "TOTAL",
          accountCurrency: "USD",
          baseCurrency: "USD",
          fxRateToBase: 1,
          totalValue: 150,
          totalGainLossAmount: 0,
          cumulativeReturnPercent: 0,
          dayGainLossAmount: null,
          dayReturnPercentModDietz: null,
          portfolioWeight: 1,
        },
        {
          accountId: "a1",
          accountCurrency: "CAD",
          baseCurrency: "USD",
          fxRateToBase: 1.5,
          totalValue: 123.456789,
          totalGainLossAmount: 23.46,
          cumulativeReturnPercent: 0.2346,
          dayGainLossAmount: 13,
          dayReturnPercentModDietz: 0.1233,
          portfolioWeight: 1,
        },
      ]);
      expect(service.calculateAccountsSimplePerformance?.()).toEqual([
        expect.objectContaining({ accountId: "a1" }),
        expect.objectContaining({ accountId: "a2" }),
      ]);
    } finally {
      db.close();
    }
  });

  test("returns null simple performance weights when TOTAL valuation is missing", () => {
    const db = createPortfolioMetricsDb();
    const service = createPortfolioMetricsService(db, {
      baseCurrency: "USD",
      exchangeRateService: fakeExchangeRateService({}),
    });

    try {
      insertDailyAccountValuation(db, {
        accountId: "a1",
        date: "2026-01-10",
        totalValue: "10",
        netContribution: "10",
      });

      expect(service.calculateAccountsSimplePerformance?.(["a1"])).toEqual([
        expect.objectContaining({
          accountId: "a1",
          portfolioWeight: null,
        }),
      ]);
    } finally {
      db.close();
    }
  });

  test("calculates account performance history and summary from daily valuations", () => {
    const db = createPortfolioMetricsDb();
    const service = createPortfolioMetricsService(db, {
      baseCurrency: "USD",
      exchangeRateService: fakeExchangeRateService({}),
    });

    try {
      insertDailyAccountValuation(db, {
        accountId: "a1",
        date: "2026-01-01",
        totalValue: "100",
        netContribution: "100",
        investmentMarketValue: "100",
        costBasis: "100",
      });
      insertDailyAccountValuation(db, {
        accountId: "a1",
        date: "2026-01-02",
        totalValue: "110",
        netContribution: "100",
        investmentMarketValue: "110",
        costBasis: "100",
      });
      insertDailyAccountValuation(db, {
        accountId: "a1",
        date: "2026-01-03",
        totalValue: "120",
        netContribution: "110",
        investmentMarketValue: "120",
        costBasis: "110",
      });

      const history = service.calculatePerformanceHistory?.({
        itemType: "account",
        itemId: "a1",
        trackingMode: "TRANSACTIONS",
      });
      expect(history).toMatchObject({
        id: "a1",
        returns: [
          { date: "2026-01-01", value: 0 },
          { date: "2026-01-02", value: 0.1 },
          { date: "2026-01-03", value: 0.1 },
        ],
        periodStartDate: "2026-01-01",
        periodEndDate: "2026-01-03",
        currency: "USD",
        periodGain: 10,
        periodReturn: 0.1,
        cumulativeTwr: 0.1,
        gainLossAmount: 10,
        annualizedTwr: 0.1,
        simpleReturn: 0.1,
        annualizedSimpleReturn: 0.1,
        cumulativeMwr: 0.1,
        annualizedMwr: 0.1,
        maxDrawdown: 0,
        isHoldingsMode: false,
      });
      expect(history?.volatility).toBeCloseTo(1.12249722, 8);

      expect(
        service.calculatePerformanceSummary?.({
          itemType: "account",
          itemId: "a1",
          trackingMode: "TRANSACTIONS",
        }),
      ).toMatchObject({
        id: "a1",
        returns: [],
        periodReturn: 0.1,
        cumulativeTwr: 0.1,
        simpleReturn: 0.1,
        volatility: 0,
        maxDrawdown: 0,
      });
    } finally {
      db.close();
    }
  });

  test("calculates holdings-mode account performance and rejects invalid histories", () => {
    const db = createPortfolioMetricsDb();
    const service = createPortfolioMetricsService(db, {
      baseCurrency: "USD",
      exchangeRateService: fakeExchangeRateService({}),
    });

    try {
      insertDailyAccountValuation(db, {
        accountId: "holdings",
        date: "2026-01-01",
        totalValue: "100",
        netContribution: "100",
        investmentMarketValue: "100",
        costBasis: "100",
      });
      insertDailyAccountValuation(db, {
        accountId: "holdings",
        date: "2026-01-02",
        totalValue: "125",
        netContribution: "110",
        investmentMarketValue: "125",
        costBasis: "110",
      });
      insertDailyAccountValuation(db, {
        accountId: "negative",
        date: "2026-01-01",
        totalValue: "10",
        netContribution: "10",
      });
      insertDailyAccountValuation(db, {
        accountId: "negative",
        date: "2026-01-02",
        totalValue: "-1",
        netContribution: "10",
      });

      expect(
        service.calculatePerformanceHistory?.({
          itemType: "account",
          itemId: "holdings",
          trackingMode: "HOLDINGS",
        }),
      ).toMatchObject({
        id: "holdings",
        periodGain: 15,
        periodReturn: 0.13636364,
        cumulativeTwr: null,
        annualizedTwr: null,
        cumulativeMwr: null,
        annualizedMwr: null,
        gainLossAmount: 15,
        isHoldingsMode: true,
      });
      expect(() =>
        service.calculatePerformanceHistory?.({
          itemType: "account",
          itemId: "negative",
        }),
      ).toThrow("Account has negative portfolio value in its history");
    } finally {
      db.close();
    }
  });

  test("calculates local quote-backed symbol performance history and empty responses", () => {
    const db = createPortfolioMetricsDb();
    const service = createPortfolioMetricsService(db, {
      baseCurrency: "USD",
      exchangeRateService: fakeExchangeRateService({}),
    });

    try {
      expect(
        service.calculatePerformanceHistory?.({ itemType: "account", itemId: "missing" }),
      ).toEqual({
        id: "missing",
        returns: [],
        periodStartDate: null,
        periodEndDate: null,
        currency: "",
        periodGain: 0,
        periodReturn: 0,
        cumulativeTwr: 0,
        gainLossAmount: null,
        annualizedTwr: 0,
        simpleReturn: 0,
        annualizedSimpleReturn: 0,
        cumulativeMwr: 0,
        annualizedMwr: 0,
        volatility: 0,
        maxDrawdown: 0,
        isHoldingsMode: false,
      });
      expect(
        service.calculatePerformanceHistory?.({
          itemType: "symbol",
          itemId: "SPY",
          startDate: "2026-01-01",
          endDate: "2026-01-05",
        }),
      ).toEqual(service.calculatePerformanceHistory?.({ itemType: "account", itemId: "SPY" }));

      insertQuote(db, { assetId: "SPY", day: "2026-01-01", close: "100", currency: "USD" });
      insertQuote(db, { assetId: "SPY", day: "2026-01-03", close: "110", currency: "USD" });
      insertQuote(db, { assetId: "SPY", day: "2026-01-05", close: "121", currency: "USD" });
      expect(
        service.calculatePerformanceHistory?.({
          itemType: "symbol",
          itemId: "SPY",
          startDate: "2026-01-01",
          endDate: "2026-01-05",
        }),
      ).toMatchObject({
        id: "SPY",
        returns: [
          { date: "2026-01-01", value: 0 },
          { date: "2026-01-02", value: 0 },
          { date: "2026-01-03", value: 0.1 },
          { date: "2026-01-04", value: 0.1 },
          { date: "2026-01-05", value: 0.21 },
        ],
        periodStartDate: "2026-01-01",
        periodEndDate: "2026-01-05",
        currency: "USD",
        periodReturn: 0.21,
        cumulativeTwr: 0.21,
        gainLossAmount: null,
        annualizedTwr: 0.21,
        simpleReturn: 0,
        annualizedSimpleReturn: 0,
        cumulativeMwr: 0,
        annualizedMwr: 0,
        maxDrawdown: 0,
        isHoldingsMode: false,
      });
      expect(() =>
        service.calculatePerformanceHistory?.({
          itemType: "symbol",
          itemId: "SPY",
          startDate: "2026-01-06",
          endDate: "2026-01-05",
        }),
      ).toThrow("Effective start date 2026-01-06 must be before effective end date 2026-01-05");
    } finally {
      db.close();
    }
  });

  test("calculates income summaries with asset-backed income, FX fallback, and account filtering", () => {
    const db = createPortfolioMetricsDb();
    const warnings: string[] = [];
    const service = createPortfolioMetricsService(db, {
      baseCurrency: "USD",
      exchangeRateService: fakeExchangeRateService({
        "CAD/USD": "0.8",
        "EUR/USD": "2",
      }),
      now: () => new Date("2026-05-16T00:00:00Z"),
      timezone: "UTC",
      warn: (message) => warnings.push(message),
    });

    try {
      insertAccount(db, { id: "taxable", accountType: "SECURITIES", name: "Taxable" });
      insertAccount(db, {
        id: "archived",
        accountType: "SECURITIES",
        name: "Archived",
        isArchived: 1,
      });
      insertAsset(db, {
        id: "stock",
        kind: "INVESTMENT",
        name: "Alpha Inc",
        displayCode: "AAA",
      });
      insertQuote(db, { assetId: "stock", day: "2024-03-10", close: "5", currency: "USD" });
      insertActivity(db, {
        id: "dividend-ytd",
        accountId: "taxable",
        assetId: "stock",
        activityType: "DIVIDEND",
        activityDate: "2026-05-01T00:00:00+00:00",
        amount: "10",
        currency: "CAD",
      });
      insertActivity(db, {
        id: "dividend-ytd-fallback",
        accountId: "taxable",
        assetId: "stock",
        activityType: "DIVIDEND",
        activityDate: "2026-04-01T00:00:00+00:00",
        amount: "7",
        currency: "GBP",
      });
      insertActivity(db, {
        id: "staking-last-year",
        accountId: "taxable",
        assetId: "stock",
        activityType: "INTEREST",
        subtype: "STAKING_REWARD",
        activityDate: "2025-02-10T00:00:00+00:00",
        quantity: "2",
        unitPrice: "3",
        amount: "0",
        currency: "EUR",
      });
      insertActivity(db, {
        id: "drip-two-years-ago",
        accountId: "taxable",
        assetId: "stock",
        activityType: "DIVIDEND",
        subtype: "DRIP",
        activityDate: "2024-03-10T00:00:00+00:00",
        quantity: "4",
        amount: "0",
        currency: "USD",
      });
      insertActivity(db, {
        id: "archived-dividend",
        accountId: "archived",
        assetId: "stock",
        activityType: "DIVIDEND",
        activityDate: "2026-05-01T00:00:00+00:00",
        amount: "1000",
        currency: "USD",
      });

      const summaries = service.getIncomeSummary("taxable");
      expect(summaries).toHaveLength(4);
      expect(summaries[0]).toMatchObject({
        period: "TOTAL",
        totalIncome: 47,
        monthlyAverage: 1.81,
        yoyGrowth: null,
        currency: "USD",
        byMonth: {
          "2026-05": 8,
          "2026-04": 7,
          "2025-02": 12,
          "2024-03": 20,
        },
        byType: { DIVIDEND: 35, INTEREST: 12 },
        byCurrency: { CAD: 10, GBP: 7, EUR: 6, USD: 20 },
        byAsset: {
          stock: {
            assetId: "stock",
            kind: "INVESTMENT",
            symbol: "AAA",
            name: "Alpha Inc",
            income: 47,
          },
        },
        byAccount: {
          taxable: {
            accountId: "taxable",
            accountName: "Taxable",
            total: 47,
            byMonth: {
              "2026-05": 8,
              "2026-04": 7,
              "2025-02": 12,
              "2024-03": 20,
            },
          },
        },
      });
      expect(summaries[1]).toMatchObject({
        period: "YTD",
        totalIncome: 15,
        monthlyAverage: 3,
        yoyGrowth: 0.25,
      });
      expect(summaries[2]).toMatchObject({
        period: "LAST_YEAR",
        totalIncome: 12,
        monthlyAverage: 1,
        yoyGrowth: -0.4,
      });
      expect(summaries[3]).toMatchObject({
        period: "TWO_YEARS_AGO",
        totalIncome: 20,
        monthlyAverage: 2,
        yoyGrowth: null,
      });
      expect(service.getIncomeSummary("missing")).toEqual([]);
      expect(warnings).toEqual([expect.stringContaining("No exchange rate found for GBP/USD")]);
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
      name TEXT NOT NULL DEFAULT '',
      account_type TEXT NOT NULL DEFAULT 'SECURITIES',
      currency TEXT NOT NULL DEFAULT 'USD',
      is_active INTEGER NOT NULL DEFAULT 1,
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
      calculated_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z',
      net_contribution TEXT NOT NULL
    );
    CREATE TABLE activities (
      id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL,
      asset_id TEXT,
      activity_type TEXT NOT NULL,
      subtype TEXT,
      activity_date TEXT NOT NULL,
      quantity TEXT,
      unit_price TEXT,
      amount TEXT,
      currency TEXT NOT NULL
    );
  `);
  return db;
}

function fakeExchangeRateService(rates: Record<string, string>) {
  const convert = (amount: string, fromCurrency: string, toCurrency: string): string => {
    const rate = rates[`${fromCurrency}/${toCurrency}`];
    if (!rate) {
      throw new Error(`No exchange rate found for ${fromCurrency}/${toCurrency}`);
    }
    return (Number(amount) * Number(rate)).toString();
  };
  return {
    convertCurrency(amount: string, fromCurrency: string, toCurrency: string): string {
      return convert(amount, fromCurrency, toCurrency);
    },
    convertCurrencyForDate(
      amount: string,
      fromCurrency: string,
      toCurrency: string,
      _date: string | Date,
    ): string {
      return convert(amount, fromCurrency, toCurrency);
    },
  };
}

function insertAccount(
  db: Database,
  account: {
    id: string;
    accountType: string;
    name?: string;
    currency?: string;
    isActive?: number;
    isArchived?: number;
  },
): void {
  db.prepare(
    "INSERT INTO accounts (id, name, account_type, currency, is_active, is_archived) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    account.id,
    account.name ?? account.id,
    account.accountType,
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
  valuation: {
    accountId: string;
    date: string;
    totalValue: string;
    netContribution: string;
    accountCurrency?: string;
    baseCurrency?: string;
    fxRateToBase?: string;
    cashBalance?: string;
    investmentMarketValue?: string;
    costBasis?: string;
    calculatedAt?: string;
  },
): void {
  db.prepare(
    `
      INSERT INTO daily_account_valuation (
        id, account_id, valuation_date, account_currency, base_currency,
        fx_rate_to_base, cash_balance, investment_market_value, total_value,
        cost_basis, net_contribution, calculated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    `${valuation.accountId}-${valuation.date}`,
    valuation.accountId,
    valuation.date,
    valuation.accountCurrency ?? "USD",
    valuation.baseCurrency ?? "USD",
    valuation.fxRateToBase ?? "1",
    valuation.cashBalance ?? "0",
    valuation.investmentMarketValue ?? valuation.totalValue,
    valuation.totalValue,
    valuation.costBasis ?? valuation.netContribution,
    valuation.netContribution,
    valuation.calculatedAt ?? `${valuation.date}T00:00:00Z`,
  );
}

function insertActivity(
  db: Database,
  activity: {
    id: string;
    accountId: string;
    assetId?: string | null;
    activityType: string;
    subtype?: string | null;
    activityDate: string;
    quantity?: string | null;
    unitPrice?: string | null;
    amount?: string | null;
    currency: string;
  },
): void {
  db.prepare(
    `
      INSERT INTO activities (
        id, account_id, asset_id, activity_type, subtype, activity_date,
        quantity, unit_price, amount, currency
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    activity.id,
    activity.accountId,
    activity.assetId ?? null,
    activity.activityType,
    activity.subtype ?? null,
    activity.activityDate,
    activity.quantity ?? null,
    activity.unitPrice ?? null,
    activity.amount ?? null,
    activity.currency,
  );
}
