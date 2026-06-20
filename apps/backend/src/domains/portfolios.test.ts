import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import type { Account } from "./accounts";
import { createPortfolioService, type PortfolioSyncEvent } from "./portfolios";

describe("TS portfolios domain", () => {
  test("creates, lists, updates, and deletes portfolios with sync events", async () => {
    const db = createPortfoliosDb();
    const syncEvents: PortfolioSyncEvent[] = [];
    const service = createPortfolioService(db, {
      accountService: {
        getAllAccounts: () => [account("a2"), account("a1")],
      },
      queueSyncEvent: (event) => syncEvents.push(event),
    });

    try {
      const created = await service.createPortfolio({
        name: "  Core  ",
        description: null,
        sortOrder: 2,
        accountIds: ["a2", "a1"],
      });

      expect(created).toMatchObject({
        name: "Core",
        description: null,
        sortOrder: 2,
        accountIds: ["a1", "a2"],
      });
      expect(service.listPortfolios()).toEqual([created]);
      expect(service.getPortfolio(created.id)).toEqual(created);
      expect(syncEvents).toEqual([
        expect.objectContaining({
          entity: "portfolios",
          entityId: created.id,
          operation: "Create",
          payload: expect.objectContaining({ id: created.id, name: "Core", sortOrder: 2 }),
        }),
        expect.objectContaining({
          entity: "portfolio_accounts",
          entityId: `pfm_${created.id}_a2`,
          operation: "Create",
        }),
        expect.objectContaining({
          entity: "portfolio_accounts",
          entityId: `pfm_${created.id}_a1`,
          operation: "Create",
        }),
      ]);

      syncEvents.length = 0;
      const updated = await service.updatePortfolio({
        id: created.id,
        name: "Updated",
        description: "Reporting scope",
        sortOrder: 1,
        accountIds: ["a1"],
      });

      expect(updated).toMatchObject({
        id: created.id,
        name: "Updated",
        description: "Reporting scope",
        sortOrder: 1,
        accountIds: ["a1"],
        createdAt: created.createdAt,
      });
      expect(service.listPortfolios()).toEqual([updated]);
      expect(syncEvents).toEqual([
        expect.objectContaining({
          entity: "portfolios",
          entityId: created.id,
          operation: "Update",
        }),
        expect.objectContaining({
          entity: "portfolio_accounts",
          entityId: `pfm_${created.id}_a2`,
          operation: "Delete",
        }),
        expect.objectContaining({
          entity: "portfolio_accounts",
          entityId: `pfm_${created.id}_a1`,
          operation: "Delete",
        }),
        expect.objectContaining({
          entity: "portfolio_accounts",
          entityId: `pfm_${created.id}_a1`,
          operation: "Create",
        }),
      ]);

      syncEvents.length = 0;
      await service.deletePortfolio(created.id);
      expect(service.listPortfolios()).toEqual([]);
      expect(syncEvents).toEqual([
        expect.objectContaining({
          entity: "portfolio_accounts",
          entityId: `pfm_${created.id}_a1`,
          operation: "Delete",
        }),
        expect.objectContaining({
          entity: "portfolios",
          entityId: created.id,
          operation: "Delete",
        }),
      ]);
    } finally {
      db.close();
    }
  });

  test("delete is idempotent and succeeds when portfolio does not exist", async () => {
    const db = createPortfoliosDb();
    const syncEvents: PortfolioSyncEvent[] = [];
    const service = createPortfolioService(db, {
      accountService: {
        getAllAccounts: () => [account("a1")],
      },
      queueSyncEvent: (event) => syncEvents.push(event),
    });

    try {
      await service.deletePortfolio("missing");
      expect(syncEvents).toEqual([]);

      const created = await service.createPortfolio({
        name: "Test",
        accountIds: ["a1"],
      });
      syncEvents.length = 0;

      await service.deletePortfolio(created.id);
      expect(syncEvents).toHaveLength(2);

      syncEvents.length = 0;
      await service.deletePortfolio(created.id);
      expect(syncEvents).toEqual([]);
    } finally {
      db.close();
    }
  });

  test("validates portfolio input like Rust service", async () => {
    const db = createPortfoliosDb();
    const service = createPortfolioService(db, {
      accountService: { getAllAccounts: () => [account("a1")] },
    });

    try {
      await expect(service.createPortfolio({ name: " ", accountIds: ["a1"] })).rejects.toThrow(
        "Portfolio name cannot be empty",
      );
      await expect(service.createPortfolio({ name: "P", accountIds: [] })).rejects.toThrow(
        "Portfolio must contain at least one account",
      );
      await expect(
        service.createPortfolio({ name: "P", accountIds: ["a1", "a1"] }),
      ).rejects.toThrow("Duplicate account ID: a1");
      await expect(
        service.createPortfolio({ name: "P", accountIds: ["a1"], sortOrder: 2_147_483_648 }),
      ).rejects.toThrow("sortOrder must be an integer between -2147483648 and 2147483647");
      await expect(
        service.updatePortfolio({
          id: "missing",
          name: "P",
          accountIds: ["a1"],
          sortOrder: 1.5,
        }),
      ).rejects.toThrow("sortOrder must be an integer between -2147483648 and 2147483647");
      await expect(service.createPortfolio({ name: "P", accountIds: ["missing"] })).rejects.toThrow(
        "Account 'missing' does not exist",
      );
    } finally {
      db.close();
    }
  });

  test("delete removes memberships explicitly before portfolio with FK enabled", async () => {
    const db = Database.open(":memory:");
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE portfolios (
        id TEXT NOT NULL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE portfolio_accounts (
        id TEXT NOT NULL PRIMARY KEY,
        portfolio_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE,
        FOREIGN KEY (account_id) REFERENCES accounts(id)
      );
    `);
    db.prepare("INSERT INTO accounts (id, name) VALUES (?, ?)").run("a1", "Account 1");

    const syncEvents: PortfolioSyncEvent[] = [];
    const service = createPortfolioService(db, {
      accountService: {
        getAllAccounts: () => [account("a1")],
      },
      queueSyncEvent: (event) => syncEvents.push(event),
    });

    try {
      const created = await service.createPortfolio({
        name: "Test",
        accountIds: ["a1"],
      });

      const membershipsBeforeDelete = db
        .query<{ id: string }, []>("SELECT id FROM portfolio_accounts")
        .all();
      expect(membershipsBeforeDelete).toHaveLength(1);

      await service.deletePortfolio(created.id);

      const membershipsAfterDelete = db
        .query<{ id: string }, []>("SELECT id FROM portfolio_accounts")
        .all();
      expect(membershipsAfterDelete).toEqual([]);
    } finally {
      db.close();
    }
  });
});

function account(id: string): Account {
  return {
    id,
    name: id,
    accountType: "SECURITIES",
    group: null,
    currency: "USD",
    isDefault: false,
    isActive: true,
    isArchived: false,
    trackingMode: "HOLDINGS",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    platformId: null,
    accountNumber: null,
    meta: null,
    provider: null,
    providerAccountId: null,
  };
}

function createPortfoliosDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE portfolios (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE portfolio_accounts (
      id TEXT PRIMARY KEY NOT NULL,
      portfolio_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}
