import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { createHoldingsService } from "./holdings";
import type { Holding, HoldingsServiceOptions } from "./holdings";

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
        service.checkHoldingsImport({
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
      expect(await service.getHoldings("a1")).toEqual([]);
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
      calculated_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z',
      source TEXT NOT NULL DEFAULT 'CALCULATED'
    );
  `);
  return db;
}

function insertAccount(
  db: Database,
  account: { id: string; name: string; isActive?: number; isArchived?: number },
): void {
  db.prepare("INSERT INTO accounts (id, name, is_active, is_archived) VALUES (?, ?, ?, ?)").run(
    account.id,
    account.name,
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
