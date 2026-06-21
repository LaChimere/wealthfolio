import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import {
  createContributionDepositCalculator,
  createContributionLimitRepository,
  createContributionLimitService,
  parseContributionLimitAccountIds,
  type ContributionLimitSyncEvent,
  type NewContributionLimit,
} from "./contribution-limits";
import type { ExchangeRateService } from "./exchange-rates";

describe("TS contribution limits domain", () => {
  test("creates limits with generated IDs and reads them back", async () => {
    const db = createContributionLimitsDb();
    const repository = createContributionLimitRepository(db);
    const service = createContributionLimitService(repository);

    try {
      const created = await service.createContributionLimit({
        id: "client-supplied-id",
        groupName: "RRSP",
        contributionYear: 2026,
        limitAmount: 31_560,
        accountIds: "account-1,account-2",
        startDate: "2026-01-01T00:00:00Z",
        endDate: "2026-12-31T23:59:59Z",
      });

      expect(created).toMatchObject({
        groupName: "RRSP",
        contributionYear: 2026,
        limitAmount: 31_560,
        accountIds: "account-1,account-2",
        startDate: "2026-01-01T00:00:00Z",
        endDate: "2026-12-31T23:59:59Z",
      });
      expect(created.id).not.toBe("client-supplied-id");
      expect(service.getContributionLimits()).toEqual([created]);
      await expect(
        service.createContributionLimit({
          groupName: "Bad Year",
          contributionYear: 4.5,
          limitAmount: 1_000,
        }),
      ).rejects.toThrow("contributionYear must be an integer between -2147483648 and 2147483647");
      await expect(
        service.createContributionLimit({
          groupName: "Bad Amount",
          contributionYear: 2026,
          limitAmount: Number.POSITIVE_INFINITY,
        }),
      ).rejects.toThrow("limitAmount must be a finite number");
      expect(service.getContributionLimits()).toEqual([created]);
    } finally {
      db.close();
    }
  });

  test("updates fields and maps omitted optional fields to null like Rust", async () => {
    const db = createContributionLimitsDb();
    const service = createContributionLimitService(createContributionLimitRepository(db));

    try {
      const created = await service.createContributionLimit(
        newLimit({
          groupName: "TFSA",
          accountIds: "account-1",
          startDate: "2026-01-01T00:00:00Z",
          endDate: "2026-12-31T23:59:59Z",
        }),
      );
      const updated = await service.updateContributionLimit(created.id, {
        groupName: "FHSA",
        contributionYear: 2027,
        limitAmount: 8_000,
      });

      expect(updated).toMatchObject({
        id: created.id,
        groupName: "FHSA",
        contributionYear: 2027,
        limitAmount: 8_000,
        accountIds: null,
        startDate: null,
        endDate: null,
      });
      expect(() =>
        createContributionLimitRepository(db).updateContributionLimit(
          "missing-limit",
          newLimit({ groupName: "Missing" }),
        ),
      ).toThrow("Record not found: contribution limit missing-limit");
      await expect(
        service.updateContributionLimit(created.id, {
          groupName: "Bad Year",
          contributionYear: 2_147_483_648,
          limitAmount: 1_000,
        }),
      ).rejects.toThrow("contributionYear must be an integer between -2147483648 and 2147483647");
      await expect(
        service.updateContributionLimit(created.id, {
          groupName: "Bad Amount",
          contributionYear: 2026,
          limitAmount: Number.NaN,
        }),
      ).rejects.toThrow("limitAmount must be a finite number");
    } finally {
      db.close();
    }
  });

  test("deletes limits idempotently and notifies lightweight portfolio updates", async () => {
    const db = createContributionLimitsDb();
    const notifications: string[] = [];
    const service = createContributionLimitService(createContributionLimitRepository(db), {
      notifyPortfolioUpdate: () => notifications.push("updated"),
    });

    try {
      const created = await service.createContributionLimit(newLimit({ groupName: "RESP" }));
      await service.updateContributionLimit(created.id, newLimit({ groupName: "RESP updated" }));
      await service.deleteContributionLimit(created.id);
      await service.deleteContributionLimit("missing-limit");

      expect(service.getContributionLimits()).toEqual([]);
      expect(notifications).toEqual(["updated", "updated", "updated", "updated"]);
    } finally {
      db.close();
    }
  });

  test("queues contribution-limit sync callbacks for create, update, and existing deletes", async () => {
    const db = createContributionLimitsDb();
    const syncEvents: ContributionLimitSyncEvent[] = [];
    const service = createContributionLimitService(
      createContributionLimitRepository(db, {
        queueSyncEvent: (event) => syncEvents.push(event),
      }),
    );

    try {
      const created = await service.createContributionLimit(
        newLimit({
          groupName: "TFSA",
          contributionYear: 2027,
          limitAmount: 7_000,
          accountIds: "account-1,account-2",
          startDate: "2027-01-01",
          endDate: "2027-12-31",
        }),
      );
      const updated = await service.updateContributionLimit(
        created.id,
        newLimit({
          groupName: "FHSA",
          contributionYear: 2028,
          limitAmount: 8_000,
        }),
      );
      await service.deleteContributionLimit(created.id);
      await service.deleteContributionLimit("missing-limit");

      expect(updated.groupName).toBe("FHSA");
      expect(syncEvents).toHaveLength(3);
      expect(syncEvents.map((event) => [event.operation, event.limitId])).toEqual([
        ["Create", created.id],
        ["Update", created.id],
        ["Delete", created.id],
      ]);
      expect(syncEvents[0]?.payload).toMatchObject({
        id: created.id,
        groupName: "TFSA",
        contributionYear: 2027,
        limitAmount: 7_000,
        accountIds: "account-1,account-2",
        startDate: "2027-01-01",
        endDate: "2027-12-31",
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/),
        updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/),
      });
      expect(syncEvents[1]?.payload).toMatchObject({
        id: created.id,
        groupName: "FHSA",
        contributionYear: 2028,
        limitAmount: 8_000,
        accountIds: null,
        startDate: null,
        endDate: null,
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/),
        updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/),
      });
      expect(syncEvents[2]?.payload).toEqual({ id: created.id });
    } finally {
      db.close();
    }
  });

  test("calculates deposits as zero for empty account selections", async () => {
    const db = createContributionLimitsDb();
    const service = createContributionLimitService(createContributionLimitRepository(db), {
      baseCurrency: "CAD",
    });

    try {
      const created = await service.createContributionLimit(newLimit({ accountIds: "  " }));
      await expect(service.calculateDepositsForContributionLimit(created.id)).resolves.toEqual({
        total: 0,
        baseCurrency: "CAD",
        byAccount: {},
      });
    } finally {
      db.close();
    }
  });

  test("reports missing contribution deposit calculator as configuration error", async () => {
    const db = createContributionLimitsDb();
    const service = createContributionLimitService(createContributionLimitRepository(db), {
      baseCurrency: "CAD",
    });

    try {
      const created = await service.createContributionLimit(newLimit({ accountIds: "account-1" }));
      await expect(service.calculateDepositsForContributionLimit(created.id)).rejects.toThrow(
        "Contribution deposit calculation is not configured",
      );
    } finally {
      db.close();
    }
  });

  test("delegates non-empty deposit calculations with trimmed account IDs", async () => {
    const db = createContributionLimitsDb();
    const seen: { accountIds: string[]; baseCurrency: string }[] = [];
    const service = createContributionLimitService(createContributionLimitRepository(db), {
      baseCurrency: () => "USD",
      calculateDeposits: (_limit, accountIds, baseCurrency) => {
        seen.push({ accountIds, baseCurrency });
        return {
          total: 100,
          baseCurrency,
          byAccount: {
            "account-1": {
              amount: 100,
              currency: "USD",
              convertedAmount: 100,
            },
          },
        };
      },
    });

    try {
      const created = await service.createContributionLimit(
        newLimit({ accountIds: " account-1, account-2 ,, " }),
      );
      const calculation = await service.calculateDepositsForContributionLimit(created.id);

      expect(seen).toEqual([{ accountIds: ["account-1", "account-2"], baseCurrency: "USD" }]);
      expect(calculation.total).toBe(100);
      expect(parseContributionLimitAccountIds(" a, b ,, ")).toEqual(["a", "b"]);
    } finally {
      db.close();
    }
  });

  test("calculates deposits from activities with Rust-compatible contribution rules", async () => {
    const db = createContributionLimitsDb();
    const fxDates: string[] = [];
    const fx = exchangeRateStub((amount, _from, _to, date) => {
      fxDates.push(date);
      return String(Number(amount) * 0.5);
    });
    const service = createContributionLimitService(createContributionLimitRepository(db), {
      baseCurrency: "USD",
      calculateDeposits: createContributionDepositCalculator(db, fx, () => "UTC"),
    });

    try {
      seedAccount(db, "acc1");
      seedAccount(db, "acc2");
      seedAccount(db, "archived", true);
      seedActivity(db, {
        id: "deposit",
        accountId: "acc1",
        type: "DEPOSIT",
        amount: "100",
        currency: "CAD",
      });
      seedActivity(db, {
        id: "internal-out",
        accountId: "acc1",
        type: "TRANSFER_OUT",
        amount: "300",
        currency: "CAD",
        sourceGroupId: "internal",
        metadata: externalMetadata(),
      });
      seedActivity(db, {
        id: "internal-in",
        accountId: "acc2",
        type: "TRANSFER_IN",
        amount: "300",
        currency: "CAD",
        sourceGroupId: "internal",
        metadata: externalMetadata(),
      });
      seedActivity(db, {
        id: "external-linked-in",
        accountId: "acc2",
        type: "TRANSFER_IN",
        amount: "200",
        currency: "CAD",
        sourceGroupId: "external",
      });
      seedActivity(db, {
        id: "external-unlinked-in",
        accountId: "acc1",
        type: "TRANSFER_IN",
        amount: "25",
        currency: "CAD",
        metadata: externalMetadata(),
      });
      seedActivity(db, {
        id: "external-credit",
        accountId: "acc1",
        type: "CREDIT",
        amount: "50",
        currency: "CAD",
        metadata: externalMetadata(),
      });
      seedActivity(db, {
        id: "internal-credit",
        accountId: "acc1",
        type: "CREDIT",
        amount: "40",
        currency: "CAD",
      });
      seedActivity(db, {
        id: "camelcase-external-credit",
        accountId: "acc1",
        type: "CREDIT",
        amount: "80",
        currency: "CAD",
        metadata: JSON.stringify({ flow: { isExternal: true } }),
      });
      seedActivity(db, {
        id: "archived-deposit",
        accountId: "archived",
        type: "DEPOSIT",
        amount: "999",
        currency: "CAD",
      });

      const created = await service.createContributionLimit(
        newLimit({ accountIds: "acc1, acc2, archived" }),
      );
      await expect(service.calculateDepositsForContributionLimit(created.id)).resolves.toEqual({
        total: 187.5,
        baseCurrency: "USD",
        byAccount: {
          acc1: { amount: 175, currency: "CAD", convertedAmount: 87.5 },
          acc2: { amount: 200, currency: "CAD", convertedAmount: 100 },
        },
      });
      expect(fxDates).toEqual(["2026-06-15", "2026-06-15", "2026-06-15", "2026-06-15"]);
    } finally {
      db.close();
    }
  });

  test("uses explicit inclusive date ranges and errors on missing counted amounts", async () => {
    const db = createContributionLimitsDb();
    const service = createContributionLimitService(createContributionLimitRepository(db), {
      baseCurrency: "USD",
      calculateDeposits: createContributionDepositCalculator(
        db,
        exchangeRateStub((amount) => amount),
        () => "UTC",
      ),
    });

    try {
      seedAccount(db, "acc1");
      seedActivity(db, {
        id: "before",
        accountId: "acc1",
        type: "DEPOSIT",
        amount: "1",
        currency: "USD",
        activityDate: "2026-03-31T23:59:58.000Z",
      });
      seedActivity(db, {
        id: "included-end",
        accountId: "acc1",
        type: "DEPOSIT",
        amount: "2",
        currency: "USD",
        activityDate: "2026-03-31T23:59:59.000Z",
      });
      seedActivity(db, {
        id: "excluded-end",
        accountId: "acc1",
        type: "DEPOSIT",
        amount: "4",
        currency: "USD",
        activityDate: "2026-04-01T00:00:00.000Z",
      });
      const ranged = await service.createContributionLimit(
        newLimit({
          accountIds: "acc1",
          startDate: "2026-03-31T23:59:59Z",
          endDate: "2026-03-31T23:59:59Z",
        }),
      );
      await expect(service.calculateDepositsForContributionLimit(ranged.id)).resolves.toMatchObject(
        {
          total: 2,
        },
      );
      seedActivity(db, {
        id: "included-fractional-start",
        accountId: "acc1",
        type: "DEPOSIT",
        amount: "8",
        currency: "USD",
        activityDate: "2026-05-01T00:00:00.500+00:00",
      });
      const fractional = await service.createContributionLimit(
        newLimit({
          accountIds: "acc1",
          startDate: "2026-05-01T00:00:00.500Z",
          endDate: "2026-05-01T00:00:00.500Z",
        }),
      );
      await expect(
        service.calculateDepositsForContributionLimit(fractional.id),
      ).resolves.toMatchObject({
        total: 8,
      });
      const dateOnly = await service.createContributionLimit(
        newLimit({
          accountIds: "acc1",
          startDate: "2026-03-31",
          endDate: "2026-03-31T23:59:59Z",
        }),
      );
      await expect(service.calculateDepositsForContributionLimit(dateOnly.id)).rejects.toThrow(
        "Invalid date: 2026-03-31",
      );
      const invalidExpanded = await service.createContributionLimit(
        newLimit({
          accountIds: "acc1",
          startDate: "+10000-02-30T00:00:00Z",
          endDate: "+10000-02-30T00:00:00Z",
        }),
      );
      await expect(
        service.calculateDepositsForContributionLimit(invalidExpanded.id),
      ).rejects.toThrow("Invalid date: +10000-02-30T00:00:00Z");
      const invalidFourDigit = await service.createContributionLimit(
        newLimit({
          accountIds: "acc1",
          startDate: "2026-04-31T00:00:00Z",
          endDate: "2026-04-31T00:00:00Z",
        }),
      );
      await expect(
        service.calculateDepositsForContributionLimit(invalidFourDigit.id),
      ).rejects.toThrow("Invalid date: 2026-04-31T00:00:00Z");
      const invalidOffset = await service.createContributionLimit(
        newLimit({
          accountIds: "acc1",
          startDate: "2026-01-01T00:00:00+24:00",
          endDate: "2026-01-01T00:00:00+24:00",
        }),
      );
      await expect(service.calculateDepositsForContributionLimit(invalidOffset.id)).rejects.toThrow(
        "Invalid date: 2026-01-01T00:00:00+24:00",
      );

      seedActivity(db, {
        id: "missing-amount",
        accountId: "acc1",
        type: "DEPOSIT",
        amount: null,
        currency: "USD",
      });
      const missingAmount = await service.createContributionLimit(newLimit({ accountIds: "acc1" }));
      await expect(service.calculateDepositsForContributionLimit(missingAmount.id)).rejects.toThrow(
        "Amount missing in DEPOSIT activity",
      );
    } finally {
      db.close();
    }
  });

  test("uses user timezone for default year ranges and FX conversion dates", async () => {
    const db = createContributionLimitsDb();
    const fxDates: string[] = [];
    const service = createContributionLimitService(createContributionLimitRepository(db), {
      baseCurrency: "USD",
      calculateDeposits: createContributionDepositCalculator(
        db,
        exchangeRateStub((amount, _from, _to, date) => {
          fxDates.push(date);
          return amount;
        }),
        () => "America/Los_Angeles",
      ),
    });

    try {
      seedAccount(db, "acc1");
      seedActivity(db, {
        id: "previous-local-year",
        accountId: "acc1",
        type: "DEPOSIT",
        amount: "1",
        currency: "USD",
        activityDate: "2026-01-01T03:00:00.000Z",
      });
      seedActivity(db, {
        id: "start-local-year",
        accountId: "acc1",
        type: "DEPOSIT",
        amount: "2",
        currency: "USD",
        activityDate: "2026-01-01T08:00:00.000Z",
      });
      seedActivity(db, {
        id: "end-local-year",
        accountId: "acc1",
        type: "DEPOSIT",
        amount: "3",
        currency: "USD",
        activityDate: "2027-01-01T07:59:59.000Z",
      });
      seedActivity(db, {
        id: "next-local-year",
        accountId: "acc1",
        type: "DEPOSIT",
        amount: "4",
        currency: "USD",
        activityDate: "2027-01-01T08:00:00.000Z",
      });

      const created = await service.createContributionLimit(newLimit({ accountIds: "acc1" }));
      await expect(
        service.calculateDepositsForContributionLimit(created.id),
      ).resolves.toMatchObject({
        total: 5,
      });
      expect(fxDates).toEqual(["2026-01-01", "2026-12-31"]);
    } finally {
      db.close();
    }
  });

  test("uses proleptic early contribution years without 1900 remapping", async () => {
    const db = createContributionLimitsDb();
    const fxDates: string[] = [];
    const service = createContributionLimitService(createContributionLimitRepository(db), {
      baseCurrency: "USD",
      calculateDeposits: createContributionDepositCalculator(
        db,
        exchangeRateStub((amount, _from, _to, date) => {
          fxDates.push(date);
          return amount;
        }),
        () => "UTC",
      ),
    });

    try {
      seedAccount(db, "acc1");
      seedActivity(db, {
        id: "early-start",
        accountId: "acc1",
        type: "DEPOSIT",
        amount: "2",
        currency: "USD",
        activityDate: "0000-01-01T00:00:00.000Z",
      });
      seedActivity(db, {
        id: "early-end",
        accountId: "acc1",
        type: "DEPOSIT",
        amount: "3",
        currency: "USD",
        activityDate: "0000-12-31T23:59:59.000Z",
      });
      seedActivity(db, {
        id: "next-year",
        accountId: "acc1",
        type: "DEPOSIT",
        amount: "5",
        currency: "USD",
        activityDate: "0001-01-01T00:00:00.000Z",
      });

      const created = await service.createContributionLimit(
        newLimit({ accountIds: "acc1", contributionYear: 0 }),
      );
      await expect(
        service.calculateDepositsForContributionLimit(created.id),
      ).resolves.toMatchObject({
        total: 5,
      });
      expect(fxDates).toEqual(["0000-01-01", "0000-12-31"]);
    } finally {
      db.close();
    }
  });

  test("preserves proleptic local years for non-UTC contribution ranges", async () => {
    const db = createContributionLimitsDb();
    const fxDates: string[] = [];
    const service = createContributionLimitService(createContributionLimitRepository(db), {
      baseCurrency: "USD",
      calculateDeposits: createContributionDepositCalculator(
        db,
        exchangeRateStub((amount, _from, _to, date) => {
          fxDates.push(date);
          return amount;
        }),
        () => "America/Los_Angeles",
      ),
    });

    try {
      seedAccount(db, "acc1");
      seedActivity(db, {
        id: "la-midyear",
        accountId: "acc1",
        type: "DEPOSIT",
        amount: "7",
        currency: "USD",
        activityDate: "0000-06-15T12:00:00.000Z",
      });

      const created = await service.createContributionLimit(
        newLimit({ accountIds: "acc1", contributionYear: 0 }),
      );
      await expect(
        service.calculateDepositsForContributionLimit(created.id),
      ).resolves.toMatchObject({
        total: 7,
      });
      expect(fxDates).toEqual(["0000-06-15"]);
    } finally {
      db.close();
    }
  });

  test("formats expanded contribution years like Rust chrono", async () => {
    const db = createContributionLimitsDb();
    const fxDates: string[] = [];
    const service = createContributionLimitService(createContributionLimitRepository(db), {
      baseCurrency: "USD",
      calculateDeposits: createContributionDepositCalculator(
        db,
        exchangeRateStub((amount, _from, _to, date) => {
          fxDates.push(date);
          return amount;
        }),
        () => "UTC",
      ),
    });

    try {
      seedAccount(db, "acc1");
      seedActivity(db, {
        id: "expanded-start",
        accountId: "acc1",
        type: "DEPOSIT",
        amount: "11",
        currency: "USD",
        activityDate: "+10000-01-01T00:00:00+00:00",
      });
      seedActivity(db, {
        id: "expanded-date-only",
        accountId: "acc1",
        type: "DEPOSIT",
        amount: "17",
        currency: "USD",
        activityDate: "+10000-01-01",
      });
      seedActivity(db, {
        id: "expanded-next",
        accountId: "acc1",
        type: "DEPOSIT",
        amount: "13",
        currency: "USD",
        activityDate: "+10001-01-01T00:00:00+00:00",
      });

      const created = await service.createContributionLimit(
        newLimit({ accountIds: "acc1", contributionYear: 10_000 }),
      );
      await expect(
        service.calculateDepositsForContributionLimit(created.id),
      ).resolves.toMatchObject({
        total: 28,
      });
      expect(fxDates).toEqual(["+10000-01-01", "+10000-01-01"]);
    } finally {
      db.close();
    }
  });
});

export function createContributionLimitsDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY NOT NULL,
      is_archived INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE contribution_limits (
      id TEXT PRIMARY KEY NOT NULL,
      group_name TEXT NOT NULL,
      contribution_year INTEGER NOT NULL,
      limit_amount NUMERIC NOT NULL,
      account_ids TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      start_date TIMESTAMP NULL,
      end_date TIMESTAMP NULL
    );

    CREATE TABLE activities (
      id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL,
      activity_type TEXT NOT NULL,
      activity_date TEXT NOT NULL,
      amount TEXT,
      currency TEXT NOT NULL,
      metadata TEXT,
      source_group_id TEXT
    );
  `);
  return db;
}

function exchangeRateStub(
  convertCurrencyForDate: (
    amount: string,
    fromCurrency: string,
    toCurrency: string,
    date: string,
  ) => string,
): Pick<ExchangeRateService, "convertCurrencyForDate"> {
  return { convertCurrencyForDate };
}

function seedAccount(db: Database, id: string, isArchived = false): void {
  db.prepare("INSERT INTO accounts (id, is_archived) VALUES (?, ?)").run(id, isArchived ? 1 : 0);
}

function seedActivity(
  db: Database,
  activity: {
    id: string;
    accountId: string;
    type: string;
    amount: string | null;
    currency: string;
    activityDate?: string;
    metadata?: string | null;
    sourceGroupId?: string | null;
  },
): void {
  db.prepare(
    `
      INSERT INTO activities (
        id, account_id, activity_type, activity_date, amount, currency, metadata, source_group_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    activity.id,
    activity.accountId,
    activity.type,
    activity.activityDate ?? "2026-06-15T12:00:00.000Z",
    activity.amount,
    activity.currency,
    activity.metadata ?? null,
    activity.sourceGroupId ?? null,
  );
}

function externalMetadata(): string {
  return JSON.stringify({ flow: { is_external: true } });
}

function newLimit(overrides?: Partial<NewContributionLimit>): NewContributionLimit {
  return {
    groupName: "Limit",
    contributionYear: 2026,
    limitAmount: 1_000,
    ...overrides,
  };
}
