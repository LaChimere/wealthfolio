import type { Database } from "bun:sqlite";

import Decimal from "decimal.js";

import type { ExchangeRateService } from "./exchange-rates";

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

export interface ContributionLimitRepositoryOptions {
  queueSyncEvent?: (event: ContributionLimitSyncEvent) => void;
}

export type ContributionLimitSyncOperation = "Create" | "Update" | "Delete";

export interface ContributionLimitSyncEvent {
  limitId: string;
  operation: ContributionLimitSyncOperation;
  payload: ContributionLimitRowPayload | { id: string };
}

export interface ContributionLimitRowPayload {
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

interface ContributionActivityRow {
  account_id: string;
  activity_type: string;
  activity_date: string;
  amount: string | null;
  currency: string;
  metadata: string | null;
  source_group_id: string | null;
}

const CONTRIBUTION_ACTIVITY_TYPES = ["DEPOSIT", "TRANSFER_IN", "TRANSFER_OUT", "CREDIT"] as const;

export function createContributionLimitRepository(
  db: Database,
  options: ContributionLimitRepositoryOptions = {},
): ContributionLimitRepository {
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
        const row = readContributionLimitRowById(db, id);
        created = contributionLimitFromRow(row);
        queueContributionLimitSyncEvent(options, row, "Create");
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
        const row = readContributionLimitRowById(db, id);
        updated = contributionLimitFromRow(row);
        queueContributionLimitSyncEvent(options, row, "Update");
      })();
      if (!updated) {
        throw new Error(`Record not found: contribution limit ${id}`);
      }
      return updated;
    },
    deleteContributionLimit(id) {
      db.transaction(() => {
        const result = db.prepare("DELETE FROM contribution_limits WHERE id = ?").run(id);
        if (result.changes > 0) {
          queueContributionLimitSyncDelete(options, id);
        }
      })();
    },
  };
}

export function createContributionDepositCalculator(
  db: Database,
  exchangeRateService: Pick<ExchangeRateService, "convertCurrencyForDate">,
  timezoneProvider: () => string | undefined,
): NonNullable<ContributionLimitServiceOptions["calculateDeposits"]> {
  return (limit, accountIds, baseCurrency) =>
    calculateDeposits(db, exchangeRateService, timezoneProvider, limit, accountIds, baseCurrency);
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
      validateContributionLimitNumericFields(newLimit);
      const limit = repository.createContributionLimit(newLimit);
      await options.notifyPortfolioUpdate?.();
      return limit;
    },
    async updateContributionLimit(id, updatedLimit) {
      validateContributionLimitNumericFields(updatedLimit);
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
        throw new Error("Contribution deposit calculation is not configured");
      }
      return await options.calculateDeposits(limit, accountIds, baseCurrency);
    },
  };
}

function validateContributionLimitNumericFields(limit: NewContributionLimit): void {
  if (
    !Number.isInteger(limit.contributionYear) ||
    limit.contributionYear < -2_147_483_648 ||
    limit.contributionYear > 2_147_483_647
  ) {
    throw new Error(
      "Invalid input: contributionYear must be an integer between -2147483648 and 2147483647",
    );
  }
  if (!Number.isFinite(limit.limitAmount)) {
    throw new Error("Invalid input: limitAmount must be a finite number");
  }
}

export function parseContributionLimitAccountIds(accountIds: string | null | undefined): string[] {
  return parseAccountIds(accountIds);
}

function readContributionLimitById(db: Database, id: string): ContributionLimit {
  return contributionLimitFromRow(readContributionLimitRowById(db, id));
}

function readContributionLimitRowById(db: Database, id: string): ContributionLimitRow {
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
  return row;
}

function queueContributionLimitSyncEvent(
  options: ContributionLimitRepositoryOptions,
  row: ContributionLimitRow,
  operation: Exclude<ContributionLimitSyncOperation, "Delete">,
): void {
  options.queueSyncEvent?.({
    limitId: row.id,
    operation,
    payload: contributionLimitRowPayload(row),
  });
}

function queueContributionLimitSyncDelete(
  options: ContributionLimitRepositoryOptions,
  limitId: string,
): void {
  options.queueSyncEvent?.({
    limitId,
    operation: "Delete",
    payload: { id: limitId },
  });
}

function contributionLimitRowPayload(row: ContributionLimitRow): ContributionLimitRowPayload {
  return {
    id: row.id,
    groupName: row.group_name,
    contributionYear: row.contribution_year,
    limitAmount: row.limit_amount,
    accountIds: row.account_ids,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startDate: row.start_date,
    endDate: row.end_date,
  };
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

function calculateDeposits(
  db: Database,
  exchangeRateService: Pick<ExchangeRateService, "convertCurrencyForDate">,
  timezoneProvider: () => string | undefined,
  limit: ContributionLimit,
  accountIds: string[],
  baseCurrency: string,
): DepositsCalculation {
  if (accountIds.length === 0) {
    return zeroDepositsCalculation(baseCurrency);
  }

  const timezone = normalizeTimezone(timezoneProvider());
  const [startUtc, endExclusiveUtc] =
    limit.startDate && limit.endDate
      ? explicitContributionRange(limit.startDate, limit.endDate)
      : localYearUtcBounds(limit.contributionYear, timezone);
  const activities = getContributionActivities(db, accountIds, startUtc, endExclusiveUtc);
  const limitAccounts = new Set(accountIds);
  const transferOutAccounts = new Map(
    activities
      .filter((activity) => activity.activity_type === "TRANSFER_OUT")
      .flatMap((activity) =>
        activity.source_group_id ? [[activity.source_group_id, activity.account_id]] : [],
      ),
  );

  let total = new Decimal(0);
  const byAccount = new Map<
    string,
    { amount: Decimal; currency: string; convertedAmount: Decimal }
  >();

  for (const activity of activities) {
    if (!shouldCountContribution(activity, limitAccounts, transferOutAccounts)) {
      continue;
    }

    const amount = parseDecimalOrNull(activity.amount);
    if (!amount) {
      throw new Error(`Amount missing in ${activity.activity_type} activity`);
    }

    const activityDate = activityDateInTimezone(
      parseActivityInstant(activity.activity_date),
      timezone,
    );
    const convertedAmount = new Decimal(
      exchangeRateService.convertCurrencyForDate(
        amount.toString(),
        activity.currency,
        baseCurrency,
        activityDate,
      ),
    );
    total = total.plus(convertedAmount);

    const accountDeposit = byAccount.get(activity.account_id) ?? {
      amount: new Decimal(0),
      currency: activity.currency,
      convertedAmount: new Decimal(0),
    };
    accountDeposit.amount = accountDeposit.amount.plus(amount);
    accountDeposit.convertedAmount = accountDeposit.convertedAmount.plus(convertedAmount);
    accountDeposit.currency = activity.currency;
    byAccount.set(activity.account_id, accountDeposit);
  }

  return {
    total: total.toNumber(),
    baseCurrency,
    byAccount: Object.fromEntries(
      [...byAccount].map(([accountId, deposit]) => [
        accountId,
        {
          amount: deposit.amount.toNumber(),
          currency: deposit.currency,
          convertedAmount: deposit.convertedAmount.toNumber(),
        },
      ]),
    ),
  };
}

function getContributionActivities(
  db: Database,
  accountIds: string[],
  startUtc: Date,
  endExclusiveUtc: Date,
): ContributionActivityRow[] {
  const accountPlaceholders = accountIds.map(() => "?").join(", ");
  const typePlaceholders = CONTRIBUTION_ACTIVITY_TYPES.map(() => "?").join(", ");
  return db
    .query<ContributionActivityRow, string[]>(
      `
        SELECT
          activities.account_id,
          activities.activity_type,
          activities.activity_date,
          activities.amount,
          activities.currency,
          activities.metadata,
          activities.source_group_id
        FROM activities
        INNER JOIN accounts ON activities.account_id = accounts.id
        WHERE accounts.id IN (${accountPlaceholders})
          AND accounts.is_archived = 0
          AND activities.activity_type IN (${typePlaceholders})
          AND activities.activity_date >= ?
          AND activities.activity_date < ?
      `,
    )
    .all(
      ...accountIds,
      ...CONTRIBUTION_ACTIVITY_TYPES,
      toRustUtcRfc3339(startUtc),
      toRustUtcRfc3339(endExclusiveUtc),
    );
}

function shouldCountContribution(
  activity: ContributionActivityRow,
  limitAccounts: Set<string>,
  transferOutAccounts: Map<string, string>,
): boolean {
  switch (activity.activity_type) {
    case "DEPOSIT":
      return true;
    case "TRANSFER_IN":
      if (activity.source_group_id) {
        const sourceAccount = transferOutAccounts.get(activity.source_group_id);
        return !sourceAccount || !limitAccounts.has(sourceAccount);
      }
      return isExternalActivity(activity);
    case "CREDIT":
      return isExternalActivity(activity);
    default:
      return false;
  }
}

function isExternalActivity(activity: ContributionActivityRow): boolean {
  if (!activity.metadata) {
    return false;
  }
  try {
    const parsed = JSON.parse(activity.metadata) as {
      flow?: { is_external?: unknown };
    };
    return parsed.flow?.is_external === true;
  } catch {
    return false;
  }
}

function explicitContributionRange(startDate: string, endDate: string): [Date, Date] {
  const start = parseRfc3339DateTime(startDate);
  const endInclusive = parseRfc3339DateTime(endDate);
  return [start, new Date(endInclusive.getTime() + 1_000)];
}

function localYearUtcBounds(year: number, timezone: string): [Date, Date] {
  return [
    zonedDateTimeToUtc(year, 1, 1, 0, 0, 0, timezone),
    zonedDateTimeToUtc(year + 1, 1, 1, 0, 0, 0, timezone),
  ];
}

function activityDateInTimezone(activityInstant: Date, timezone: string): string {
  const parts = zonedDateParts(activityInstant, timezone);
  return `${padYear(parts.year)}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

function zonedDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timezone: string,
): Date {
  const targetUtcMs = utcMsFromParts(year, month - 1, day, hour, minute, second);
  let utcMs = targetUtcMs;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = zonedDateParts(new Date(utcMs), timezone);
    const actualUtcMs = utcMsFromParts(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const difference = targetUtcMs - actualUtcMs;
    if (difference === 0) {
      break;
    }
    utcMs += difference;
  }
  return new Date(utcMs);
}

function utcMsFromParts(
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): number {
  const date = new Date(Date.UTC(2000, 0, 1, hour, minute, second));
  date.setUTCFullYear(year, monthIndex, day);
  return date.getTime();
}

function zonedDateParts(
  date: Date,
  timezone: string,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  if (timezone === "UTC" || timezone === "Etc/UTC") {
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      second: date.getUTCSeconds(),
    };
  }
  const formatter = new Intl.DateTimeFormat("en-US", {
    calendar: "gregory",
    day: "2-digit",
    era: "short",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone: timezone,
    year: "numeric",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const eraYear = Number(parts.year);
  return {
    year: parts.era === "BC" ? 1 - eraYear : eraYear,
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function normalizeTimezone(timezone: string | undefined): string {
  const normalized = timezone?.trim();
  if (!normalized) {
    return "UTC";
  }
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: normalized }).resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

function parseActivityInstant(value: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return parseDateTime(`${value}T00:00:00Z`);
  }
  return parseDateTime(value);
}

function parseDateTime(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return parsed;
}

function parseRfc3339DateTime(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error(`Invalid date: ${value}`);
  }
  return parseDateTime(value);
}

function parseDecimalOrNull(value: string | null): Decimal | null {
  if (!value || !isDecimalString(value)) {
    return null;
  }
  return new Decimal(value);
}

function isDecimalString(value: string): boolean {
  return /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim());
}

function toRustUtcRfc3339(date: Date): string {
  const iso = date.toISOString();
  return iso.endsWith(".000Z") ? iso.replace(".000Z", "+00:00") : iso.replace("Z", "+00:00");
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function padYear(value: number): string {
  return value >= 0 && value <= 9999 ? value.toString().padStart(4, "0") : value.toString();
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
