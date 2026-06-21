import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { createEventBus } from "../events";
import {
  ACCOUNTS_CHANGED_EVENT,
  TRACKING_MODE_CHANGED_EVENT,
  type AccountSyncEvent,
  type NewAccount,
  createAccountRepository,
  createAccountService,
  parseTrackingMode,
} from "./accounts";

describe("TS accounts domain", () => {
  test("creates accounts with Rust-compatible validation, generated IDs, FX registration, and events", async () => {
    const db = createAccountsDb();
    const events: unknown[] = [];
    const registeredPairs: [string, string][] = [];
    const eventBus = createEventBus();
    eventBus.subscribe((event) => events.push(event));
    const service = createAccountService(createAccountRepository(db), {
      baseCurrency: "USD",
      eventBus,
      registerCurrencyPair: async (currency, baseCurrency) => {
        registeredPairs.push([currency, baseCurrency]);
      },
    });

    try {
      await expect(
        service.createAccount({
          name: " ",
          accountType: "SECURITIES",
          currency: "USD",
          isDefault: false,
          isActive: true,
        }),
      ).rejects.toThrow("Invalid input: Account name cannot be empty");

      const account = await service.createAccount({
        id: "client-supplied-id",
        name: "Brokerage",
        accountType: "SECURITIES",
        group: "Investing",
        currency: "CAD",
        isDefault: true,
        isActive: true,
        trackingMode: "HOLDINGS",
      });

      expect(account).toMatchObject({
        name: "Brokerage",
        accountType: "SECURITIES",
        group: "Investing",
        currency: "CAD",
        isDefault: true,
        isActive: true,
        isArchived: false,
        trackingMode: "HOLDINGS",
      });
      expect(account.id).not.toBe("client-supplied-id");
      expect(registeredPairs).toEqual([["CAD", "USD"]]);
      expect(events).toEqual([
        {
          name: ACCOUNTS_CHANGED_EVENT,
          payload: {
            type: ACCOUNTS_CHANGED_EVENT,
            account_ids: [account.id],
            currency_changes: [
              {
                account_id: account.id,
                old_currency: null,
                new_currency: "CAD",
              },
            ],
          },
        },
      ]);
    } finally {
      db.close();
    }
  });

  test("lists accounts with Rust filters and ordering", async () => {
    const db = createAccountsDb();
    const repository = createAccountRepository(db);
    const service = createAccountService(repository);

    try {
      const inactive = repository.create(newAccount({ name: "Beta", isActive: false }));
      const archived = repository.create(newAccount({ name: "Alpha", isArchived: true }));
      const active = repository.create(newAccount({ name: "Gamma" }));

      expect(service.getAllAccounts().map((account) => account.id)).toEqual([
        active.id,
        archived.id,
        inactive.id,
      ]);
      expect(service.getNonArchivedAccounts().map((account) => account.id)).toEqual([
        active.id,
        inactive.id,
      ]);
      expect(service.getActiveNonArchivedAccounts().map((account) => account.id)).toEqual([
        active.id,
      ]);
      expect(
        service.getAccountsByIds([inactive.id, active.id]).map((account) => account.id),
      ).toEqual([active.id, inactive.id]);
      expect(service.getAccountsByIds([])).toEqual([]);
    } finally {
      db.close();
    }
  });

  test("updates accounts while preserving immutable and broker-managed fields", async () => {
    const db = createAccountsDb();
    const events: unknown[] = [];
    const eventBus = createEventBus();
    eventBus.subscribe((event) => events.push(event));
    const service = createAccountService(createAccountRepository(db), { eventBus });

    try {
      const created = await service.createAccount({
        ...newAccount({
          name: "Managed",
          currency: "USD",
          trackingMode: "TRANSACTIONS",
        }),
        platformId: "platform-1",
        accountNumber: "123",
        meta: '{"source":"broker"}',
        provider: "SNAPTRADE",
        providerAccountId: "provider-account-1",
      });
      events.length = 0;

      const updated = await service.updateAccount({
        id: created.id,
        name: "Renamed",
        accountType: "CASH",
        group: null,
        isDefault: false,
        isActive: false,
        isArchived: true,
        trackingMode: "HOLDINGS",
        platformId: "platform-2",
        accountNumber: "456",
        meta: '{"source":"form"}',
        provider: "MANUAL",
        providerAccountId: "provider-account-2",
      });

      expect(updated).toMatchObject({
        id: created.id,
        name: "Renamed",
        accountType: "CASH",
        currency: "USD",
        isDefault: false,
        isActive: false,
        isArchived: true,
        trackingMode: "HOLDINGS",
        platformId: "platform-1",
        accountNumber: "123",
        meta: '{"source":"broker"}',
        provider: "SNAPTRADE",
        providerAccountId: "provider-account-1",
      });
      expect(events).toEqual([
        {
          name: ACCOUNTS_CHANGED_EVENT,
          payload: {
            type: ACCOUNTS_CHANGED_EVENT,
            account_ids: [created.id],
            currency_changes: [],
          },
        },
        {
          name: TRACKING_MODE_CHANGED_EVENT,
          payload: {
            type: TRACKING_MODE_CHANGED_EVENT,
            account_id: created.id,
            old_mode: "TRANSACTIONS",
            new_mode: "HOLDINGS",
            is_connected: true,
          },
        },
      ]);
    } finally {
      db.close();
    }
  });

  test("preserves archived and tracking mode fields when update omits them", async () => {
    const db = createAccountsDb();
    const service = createAccountService(createAccountRepository(db));

    try {
      const created = await service.createAccount(
        newAccount({ name: "Archive", isArchived: true, trackingMode: "HOLDINGS" }),
      );
      const updated = await service.updateAccount({
        id: created.id,
        name: "Archive Updated",
        accountType: "SECURITIES",
        group: null,
        isDefault: false,
        isActive: true,
      });

      expect(updated.isArchived).toBe(true);
      expect(updated.trackingMode).toBe("HOLDINGS");
    } finally {
      db.close();
    }
  });

  test("clears group when update omits it like Rust AccountUpdate Option handling", async () => {
    const db = createAccountsDb();
    const service = createAccountService(createAccountRepository(db));

    try {
      const created = await service.createAccount(
        newAccount({ name: "Grouped", group: "Investing" }),
      );
      const updated = await service.updateAccount({
        id: created.id,
        name: "Grouped Updated",
        accountType: "SECURITIES",
        isDefault: false,
        isActive: true,
      });

      expect(updated.group).toBeNull();
    } finally {
      db.close();
    }
  });

  test("deletes accounts and emits change events", async () => {
    const db = createAccountsDb();
    const events: unknown[] = [];
    const eventBus = createEventBus();
    eventBus.subscribe((event) => events.push(event));
    const service = createAccountService(createAccountRepository(db), { eventBus });

    try {
      const created = await service.createAccount(newAccount({ name: "Disposable" }));
      events.length = 0;
      await service.deleteAccount(created.id);

      expect(() => service.getAccount(created.id)).toThrow(
        `Record not found: account ${created.id}`,
      );
      expect(events).toEqual([
        {
          name: ACCOUNTS_CHANGED_EVENT,
          payload: {
            type: ACCOUNTS_CHANGED_EVENT,
            account_ids: [created.id],
            currency_changes: [],
          },
        },
      ]);
    } finally {
      db.close();
    }
  });

  test("queues account sync callbacks for create, update, and existing deletes", async () => {
    const db = createAccountsDb();
    const syncEvents: AccountSyncEvent[] = [];
    const service = createAccountService(
      createAccountRepository(db, {
        queueSyncEvent: (event) => syncEvents.push(event),
      }),
    );

    try {
      const created = await service.createAccount({
        ...newAccount({
          name: "Synced",
          group: "Investing",
          currency: "CAD",
          isDefault: true,
          trackingMode: "TRANSACTIONS",
        }),
        platformId: "platform-1",
        accountNumber: "123",
        meta: '{"source":"broker"}',
        provider: "SNAPTRADE",
        providerAccountId: "provider-account-1",
      });
      await service.updateAccount({
        id: created.id,
        name: "Synced Updated",
        accountType: "CASH",
        group: null,
        isDefault: false,
        isActive: false,
        isArchived: true,
        trackingMode: "HOLDINGS",
        platformId: "ignored-platform",
        accountNumber: "ignored-number",
        meta: '{"source":"form"}',
        provider: "MANUAL",
        providerAccountId: "ignored-provider-account",
      });
      await service.deleteAccount(created.id);
      await service.deleteAccount("missing-account");

      expect(syncEvents).toHaveLength(3);
      expect(syncEvents.map((event) => [event.operation, event.accountId])).toEqual([
        ["Create", created.id],
        ["Update", created.id],
        ["Delete", created.id],
      ]);
      expect(syncEvents[0]?.payload).toMatchObject({
        id: created.id,
        name: "Synced",
        accountType: "SECURITIES",
        group: "Investing",
        currency: "CAD",
        isDefault: true,
        isActive: true,
        platformId: "platform-1",
        accountNumber: "123",
        meta: '{"source":"broker"}',
        provider: "SNAPTRADE",
        providerAccountId: "provider-account-1",
        isArchived: false,
        trackingMode: "TRANSACTIONS",
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/),
        updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/),
      });
      expect(syncEvents[1]?.payload).toMatchObject({
        id: created.id,
        name: "Synced Updated",
        accountType: "CASH",
        group: null,
        currency: "CAD",
        isDefault: false,
        isActive: false,
        platformId: "platform-1",
        accountNumber: "123",
        meta: '{"source":"broker"}',
        provider: "SNAPTRADE",
        providerAccountId: "provider-account-1",
        isArchived: true,
        trackingMode: "HOLDINGS",
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/),
        updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/),
      });
      expect(syncEvents[2]?.payload).toEqual({ id: created.id });
    } finally {
      db.close();
    }
  });

  test("deactivates orphaned investments after account deletion and surfaces cleanup warnings", async () => {
    const db = createAccountsDb();
    const deletedSyncStates: string[] = [];
    const warnings: string[] = [];
    const service = createAccountService(createAccountRepository(db), {
      deactivateOrphanedInvestments: async () => ["asset-1", "asset-2"],
      deleteSyncState: async (assetId) => {
        deletedSyncStates.push(assetId);
        if (assetId === "asset-2") {
          throw new Error("keyring unavailable");
        }
      },
      warn: (message) => warnings.push(message),
    });

    try {
      const created = await service.createAccount(newAccount({ name: "Cleanup" }));
      await service.deleteAccount(created.id);

      expect(deletedSyncStates).toEqual(["asset-1", "asset-2"]);
      expect(warnings).toEqual([
        "Failed to delete sync state for orphaned asset asset-2: keyring unavailable",
      ]);
    } finally {
      db.close();
    }
  });

  test("maps unknown tracking modes to NOT_SET like the Rust API model", () => {
    expect(parseTrackingMode("TRANSACTIONS")).toBe("TRANSACTIONS");
    expect(parseTrackingMode("HOLDINGS")).toBe("HOLDINGS");
    expect(parseTrackingMode("unexpected")).toBe("NOT_SET");
  });
});

function createAccountsDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE accounts (
      id TEXT NOT NULL PRIMARY KEY,
      name TEXT NOT NULL,
      account_type TEXT NOT NULL DEFAULT 'SECURITIES',
      "group" TEXT,
      currency TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      platform_id TEXT,
      account_number TEXT,
      meta TEXT,
      provider TEXT,
      provider_account_id TEXT,
      is_archived INTEGER NOT NULL DEFAULT 0,
      tracking_mode TEXT NOT NULL DEFAULT 'NOT_SET'
    );
  `);
  return db;
}

function newAccount(overrides?: Partial<NewAccount>): {
  name: string;
  accountType: string;
  group?: string | null;
  currency: string;
  isDefault: boolean;
  isActive: boolean;
  isArchived?: boolean;
  trackingMode?: "TRANSACTIONS" | "HOLDINGS" | "NOT_SET";
} {
  return {
    name: "Account",
    accountType: "SECURITIES",
    currency: "USD",
    isDefault: false,
    isActive: true,
    ...overrides,
  };
}
