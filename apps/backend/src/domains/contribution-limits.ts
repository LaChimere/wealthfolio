import type { Database } from "bun:sqlite";

export interface ContributionLimit {
  id: string;
  groupName: string;
  contributionYear: number;
  limitAmount: number;
  accountIds: string | null;
  createdAt: string;
  updatedAt: string;
  startDate: string | null;
  endDate: string | null;
}

export interface NewContributionLimit {
  id?: string;
  groupName: string;
  contributionYear: number;
  limitAmount: number;
  accountIds?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}

export interface AccountDeposit {
  amount: number;
  currency: string;
  convertedAmount: number;
}

export interface DepositsCalculation {
  total: number;
  baseCurrency: string;
  byAccount: Record<string, AccountDeposit>;
}

export interface ContributionLimitRepository {
  getContributionLimit(id: string): ContributionLimit;
  getContributionLimits(): ContributionLimit[];
  createContributionLimit(newLimit: NewContributionLimit): ContributionLimit;
  updateContributionLimit(id: string, updatedLimit: NewContributionLimit): ContributionLimit;
  deleteContributionLimit(id: string): void;
}

export interface ContributionLimitService {
  getContributionLimits(): ContributionLimit[];
  createContributionLimit(newLimit: NewContributionLimit): Promise<ContributionLimit>;
  updateContributionLimit(
    id: string,
    updatedLimit: NewContributionLimit,
  ): Promise<ContributionLimit>;
  deleteContributionLimit(id: string): Promise<void>;
  calculateDepositsForContributionLimit(
    limitId: string,
    baseCurrency?: string,
  ): Promise<DepositsCalculation>;
}

export interface ContributionLimitServiceOptions {
  baseCurrency?: string | (() => string | undefined);
  notifyPortfolioUpdate?: () => void | Promise<void>;
  calculateDeposits?: (
    limit: ContributionLimit,
    accountIds: string[],
    baseCurrency: string,
  ) => DepositsCalculation | Promise<DepositsCalculation>;
}

interface ContributionLimitRow {
  id: string;
  group_name: string;
  contribution_year: number;
  limit_amount: number;
  account_ids: string | null;
  created_at: string;
  updated_at: string;
  start_date: string | null;
  end_date: string | null;
}

export function createContributionLimitRepository(db: Database): ContributionLimitRepository {
  return {
    getContributionLimit(id) {
      return readContributionLimitById(db, id);
    },
    getContributionLimits() {
      return db
        .query<ContributionLimitRow, []>(
          `
            SELECT ${contributionLimitColumns()}
            FROM contribution_limits
          `,
        )
        .all()
        .map(contributionLimitFromRow);
    },
    createContributionLimit(newLimit) {
      const id = crypto.randomUUID();
      let created: ContributionLimit | undefined;
      db.transaction(() => {
        db.prepare(
          `
            INSERT INTO contribution_limits (
              id, group_name, contribution_year, limit_amount, account_ids,
              start_date, end_date, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        ).run(
          id,
          newLimit.groupName,
          newLimit.contributionYear,
          newLimit.limitAmount,
          newLimit.accountIds ?? null,
          newLimit.startDate ?? null,
          newLimit.endDate ?? null,
          sqliteNow(),
          sqliteNow(),
        );
        created = readContributionLimitById(db, id);
      })();
      if (!created) {
        throw new Error(`Record not found: contribution limit ${id}`);
      }
      return created;
    },
    updateContributionLimit(id, updatedLimit) {
      let updated: ContributionLimit | undefined;
      db.transaction(() => {
        const result = db
          .prepare(
            `
              UPDATE contribution_limits
              SET
                group_name = ?,
                contribution_year = ?,
                limit_amount = ?,
                account_ids = ?,
                start_date = ?,
                end_date = ?,
                updated_at = ?
              WHERE id = ?
            `,
          )
          .run(
            updatedLimit.groupName,
            updatedLimit.contributionYear,
            updatedLimit.limitAmount,
            updatedLimit.accountIds ?? null,
            updatedLimit.startDate ?? null,
            updatedLimit.endDate ?? null,
            sqliteNow(),
            id,
          );
        if (result.changes === 0) {
          throw new Error(`Record not found: contribution limit ${id}`);
        }
        updated = readContributionLimitById(db, id);
      })();
      if (!updated) {
        throw new Error(`Record not found: contribution limit ${id}`);
      }
      return updated;
    },
    deleteContributionLimit(id) {
      db.prepare("DELETE FROM contribution_limits WHERE id = ?").run(id);
    },
  };
}

export function createContributionLimitService(
  repository: ContributionLimitRepository,
  options: ContributionLimitServiceOptions = {},
): ContributionLimitService {
  return {
    getContributionLimits() {
      return repository.getContributionLimits();
    },
    async createContributionLimit(newLimit) {
      const limit = repository.createContributionLimit(newLimit);
      await options.notifyPortfolioUpdate?.();
      return limit;
    },
    async updateContributionLimit(id, updatedLimit) {
      const limit = repository.updateContributionLimit(id, updatedLimit);
      await options.notifyPortfolioUpdate?.();
      return limit;
    },
    async deleteContributionLimit(id) {
      repository.deleteContributionLimit(id);
      await options.notifyPortfolioUpdate?.();
    },
    async calculateDepositsForContributionLimit(limitId, baseCurrencyOverride) {
      const limit = repository.getContributionLimit(limitId);
      const baseCurrency = baseCurrencyOverride ?? resolveBaseCurrency(options) ?? "";
      const accountIds = parseAccountIds(limit.accountIds);
      if (accountIds.length === 0) {
        return zeroDepositsCalculation(baseCurrency);
      }
      if (!options.calculateDeposits) {
        throw new Error("Contribution deposit calculation is not available in the TS backend yet");
      }
      return await options.calculateDeposits(limit, accountIds, baseCurrency);
    },
  };
}

export function parseContributionLimitAccountIds(accountIds: string | null | undefined): string[] {
  return parseAccountIds(accountIds);
}

function readContributionLimitById(db: Database, id: string): ContributionLimit {
  const row = db
    .query<ContributionLimitRow, [string]>(
      `
        SELECT ${contributionLimitColumns()}
        FROM contribution_limits
        WHERE id = ?
      `,
    )
    .get(id);
  if (!row) {
    throw new Error(`Record not found: contribution limit ${id}`);
  }
  return contributionLimitFromRow(row);
}

function contributionLimitColumns(): string {
  return [
    "id",
    "group_name",
    "contribution_year",
    "limit_amount",
    "account_ids",
    "created_at",
    "updated_at",
    "start_date",
    "end_date",
  ].join(", ");
}

function contributionLimitFromRow(row: ContributionLimitRow): ContributionLimit {
  return {
    id: row.id,
    groupName: row.group_name,
    contributionYear: row.contribution_year,
    limitAmount: Number(row.limit_amount),
    accountIds: row.account_ids,
    createdAt: toApiDate(row.created_at),
    updatedAt: toApiDate(row.updated_at),
    startDate: row.start_date,
    endDate: row.end_date,
  };
}

function parseAccountIds(accountIds: string | null | undefined): string[] {
  if (!accountIds?.trim()) {
    return [];
  }
  return accountIds
    .split(",")
    .map((accountId) => accountId.trim())
    .filter(Boolean);
}

function zeroDepositsCalculation(baseCurrency: string): DepositsCalculation {
  return {
    total: 0,
    baseCurrency,
    byAccount: {},
  };
}

function resolveBaseCurrency(options: ContributionLimitServiceOptions): string | undefined {
  if (typeof options.baseCurrency === "function") {
    return options.baseCurrency();
  }
  return options.baseCurrency;
}

function sqliteNow(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function toApiDate(value: string): string {
  return value.includes(" ") ? value.replace(" ", "T") : value;
}
