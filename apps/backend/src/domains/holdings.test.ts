import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { createHoldingsService } from "./holdings";

describe("TS holdings domain", () => {
  test("reads historical and latest account valuations from SQLite", async () => {
    const db = createHoldingsDb();
    const service = createHoldingsService(db);

    try {
      insertAccount(db, { id: "a1", name: "Alpha" });
      insertAccount(db, { id: "a2", name: "Beta Archived", isArchived: 1 });
      insertAccount(db, { id: "inactive", name: "Inactive", isActive: 0 });
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
      await expect(service.getHoldings("a1")).rejects.toThrow("Holdings fan-out is not available");
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
