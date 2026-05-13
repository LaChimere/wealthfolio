import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import {
  createContributionLimitRepository,
  createContributionLimitService,
  parseContributionLimitAccountIds,
  type NewContributionLimit,
} from "./contribution-limits";

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
});

export function createContributionLimitsDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
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
  `);
  return db;
}

function newLimit(overrides?: Partial<NewContributionLimit>): NewContributionLimit {
  return {
    groupName: "Limit",
    contributionYear: 2026,
    limitAmount: 1_000,
    ...overrides,
  };
}
