import type { Database } from "bun:sqlite";

import type { BackendEventBus } from "../events";

export type TrackingMode = "TRANSACTIONS" | "HOLDINGS" | "NOT_SET";

export interface Account {
  id: string;
  name: string;
  accountType: string;
  group: string | null;
  currency: string;
  isDefault: boolean;
  isActive: boolean;
  isArchived: boolean;
  trackingMode: TrackingMode;
  createdAt: string;
  updatedAt: string;
  platformId: string | null;
  accountNumber: string | null;
  meta: string | null;
  provider: string | null;
  providerAccountId: string | null;
}

export interface NewAccount {
  id?: string;
  name: string;
  accountType: string;
  group?: string | null;
  currency: string;
  isDefault: boolean;
  isActive: boolean;
  isArchived?: boolean;
  trackingMode?: TrackingMode;
  platformId?: string | null;
  accountNumber?: string | null;
  meta?: string | null;
  provider?: string | null;
  providerAccountId?: string | null;
}

export interface AccountUpdate {
  id: string;
  name: string;
  accountType: string;
  group?: string | null;
  isDefault: boolean;
  isActive: boolean;
  isArchived?: boolean;
  trackingMode?: TrackingMode;
  platformId?: string | null;
  accountNumber?: string | null;
  meta?: string | null;
  provider?: string | null;
  providerAccountId?: string | null;
}

export interface AccountListFilters {
  isActive?: boolean;
  isArchived?: boolean;
  accountIds?: string[];
}

export interface AccountUpdateResult {
  previousAccount: Account;
  account: Account;
}

export interface AccountRepository {
  create(newAccount: NewAccount): Account;
  update(accountUpdate: AccountUpdate): AccountUpdateResult;
  delete(accountId: string): number;
  getById(accountId: string): Account;
  list(filters?: AccountListFilters): Account[];
}

export interface AccountService {
  createAccount(newAccount: NewAccount): Promise<Account>;
  updateAccount(accountUpdate: AccountUpdate): Promise<Account>;
  deleteAccount(accountId: string): Promise<void>;
  getAccount(accountId: string): Account;
  listAccounts(filters?: AccountListFilters): Account[];
  getAllAccounts(): Account[];
  getActiveAccounts(): Account[];
  getAccountsByIds(accountIds: string[]): Account[];
  getNonArchivedAccounts(): Account[];
  getActiveNonArchivedAccounts(): Account[];
  getBaseCurrency(): string | undefined;
}

export interface AccountServiceOptions {
  baseCurrency?: string | (() => string | undefined);
  eventBus?: BackendEventBus;
  registerCurrencyPair?: (currency: string, baseCurrency: string) => Promise<void>;
  deactivateOrphanedInvestments?: () => Promise<string[]>;
  deleteSyncState?: (assetId: string) => Promise<void>;
  warn?: (message: string) => void;
}

interface AccountRow {
  id: string;
  name: string;
  account_type: string;
  group: string | null;
  currency: string;
  is_default: number | boolean;
  is_active: number | boolean;
  created_at: string;
  updated_at: string;
  platform_id: string | null;
  account_number: string | null;
  meta: string | null;
  provider: string | null;
  provider_account_id: string | null;
  is_archived: number | boolean;
  tracking_mode: string;
}

export const ACCOUNTS_CHANGED_EVENT = "accounts_changed";
export const TRACKING_MODE_CHANGED_EVENT = "tracking_mode_changed";

export function createAccountRepository(db: Database): AccountRepository {
  return {
    create(newAccount) {
      validateNewAccount(newAccount);
      const id = crypto.randomUUID();
      let created: Account | undefined;
      db.transaction(() => {
        db.prepare(
          `
            INSERT INTO accounts (
              id, name, account_type, "group", currency, is_default, is_active,
              platform_id, account_number, meta, provider, provider_account_id,
              is_archived, tracking_mode
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        ).run(
          id,
          newAccount.name,
          newAccount.accountType,
          newAccount.group ?? null,
          newAccount.currency,
          boolToInt(newAccount.isDefault),
          boolToInt(newAccount.isActive),
          newAccount.platformId ?? null,
          newAccount.accountNumber ?? null,
          newAccount.meta ?? null,
          newAccount.provider ?? null,
          newAccount.providerAccountId ?? null,
          boolToInt(newAccount.isArchived ?? false),
          newAccount.trackingMode ?? "NOT_SET",
        );
        created = readAccountById(db, id);
      })();
      if (!created) {
        throw new Error(`Record not found: account ${id}`);
      }
      return created;
    },
    update(accountUpdate) {
      validateAccountUpdate(accountUpdate);
      const accountId = accountUpdate.id;
      if (!accountId) {
        throw new Error("Invalid input: Account ID is required for updates");
      }
      let previousAccount: Account | undefined;
      let updated: Account | undefined;

      db.transaction(() => {
        const existing = readAccountById(db, accountId);
        previousAccount = existing;
        const trackingMode = accountUpdate.trackingMode ?? existing.trackingMode;
        const isArchived = accountUpdate.isArchived ?? existing.isArchived;
        const updatedAt = sqliteNow();

        db.prepare(
          `
            UPDATE accounts
            SET
              name = ?,
              account_type = ?,
              "group" = ?,
              currency = ?,
              is_default = ?,
              is_active = ?,
              updated_at = ?,
              platform_id = ?,
              account_number = ?,
              meta = ?,
              provider = ?,
              provider_account_id = ?,
              is_archived = ?,
              tracking_mode = ?
            WHERE id = ?
          `,
        ).run(
          accountUpdate.name,
          accountUpdate.accountType,
          accountUpdate.group ?? null,
          existing.currency,
          boolToInt(accountUpdate.isDefault),
          boolToInt(accountUpdate.isActive),
          updatedAt,
          existing.platformId,
          existing.accountNumber,
          existing.meta,
          existing.provider,
          existing.providerAccountId,
          boolToInt(isArchived),
          trackingMode,
          accountId,
        );
        updated = readAccountById(db, accountId);
      })();
      if (!previousAccount || !updated) {
        throw new Error(`Record not found: account ${accountId}`);
      }
      return { previousAccount, account: updated };
    },
    delete(accountId) {
      const result = db.prepare("DELETE FROM accounts WHERE id = ?").run(accountId);
      return result.changes;
    },
    getById(accountId) {
      return readAccountById(db, accountId);
    },
    list(filters = {}) {
      return listAccounts(db, filters);
    },
  };
}

export function createAccountService(
  repository: AccountRepository,
  options: AccountServiceOptions = {},
): AccountService {
  return {
    async createAccount(newAccount) {
      const baseCurrency = resolveBaseCurrency(options);
      if (baseCurrency && newAccount.currency !== baseCurrency) {
        await options.registerCurrencyPair?.(newAccount.currency, baseCurrency);
      }

      const account = repository.create(newAccount);
      publishAccountsChanged(options.eventBus, account.id, [
        {
          account_id: account.id,
          old_currency: null,
          new_currency: account.currency,
        },
      ]);
      return account;
    },
    async updateAccount(accountUpdate) {
      const accountId = accountUpdate.id;
      if (!accountId) {
        throw new Error("Account ID is required");
      }

      const { previousAccount, account } = repository.update(accountUpdate);
      publishAccountsChanged(options.eventBus, account.id, []);

      if (previousAccount.trackingMode !== account.trackingMode) {
        options.eventBus?.publish({
          name: TRACKING_MODE_CHANGED_EVENT,
          payload: {
            type: TRACKING_MODE_CHANGED_EVENT,
            account_id: account.id,
            old_mode: previousAccount.trackingMode,
            new_mode: account.trackingMode,
            is_connected: account.providerAccountId !== null,
          },
        });
      }
      return account;
    },
    async deleteAccount(accountId) {
      repository.delete(accountId);
      await deactivateOrphanedInvestments(options);
      publishAccountsChanged(options.eventBus, accountId, []);
    },
    getAccount(accountId) {
      return repository.getById(accountId);
    },
    listAccounts(filters = {}) {
      return repository.list(filters);
    },
    getAllAccounts() {
      return repository.list();
    },
    getActiveAccounts() {
      return repository.list({ isActive: true });
    },
    getAccountsByIds(accountIds) {
      return repository.list({ accountIds });
    },
    getNonArchivedAccounts() {
      return repository.list({ isArchived: false });
    },
    getActiveNonArchivedAccounts() {
      return repository.list({ isActive: true, isArchived: false });
    },
    getBaseCurrency() {
      const baseCurrency = resolveBaseCurrency(options);
      return baseCurrency && baseCurrency.trim() ? baseCurrency : undefined;
    },
  };
}

export function parseTrackingMode(value: unknown): TrackingMode {
  if (value === "TRANSACTIONS" || value === "HOLDINGS") {
    return value;
  }
  return "NOT_SET";
}

function listAccounts(db: Database, filters: AccountListFilters): Account[] {
  if (filters.accountIds?.length === 0) {
    return [];
  }

  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (filters.isActive !== undefined) {
    clauses.push("is_active = ?");
    params.push(boolToInt(filters.isActive));
  }
  if (filters.isArchived !== undefined) {
    clauses.push("is_archived = ?");
    params.push(boolToInt(filters.isArchived));
  }
  if (filters.accountIds) {
    clauses.push(`id IN (${filters.accountIds.map(() => "?").join(", ")})`);
    params.push(...filters.accountIds);
  }

  const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
  return db
    .query<AccountRow, (string | number)[]>(
      `
        SELECT ${accountSelectColumns()}
        FROM accounts
        ${where}
        ORDER BY is_active DESC, is_archived ASC, name ASC
      `,
    )
    .all(...params)
    .map(accountFromRow);
}

function readAccountById(db: Database, accountId: string | undefined): Account {
  if (!accountId) {
    throw new Error("Account ID is required");
  }
  const row = db
    .query<AccountRow, [string]>(
      `
        SELECT ${accountSelectColumns()}
        FROM accounts
        WHERE id = ?
      `,
    )
    .get(accountId);
  if (!row) {
    throw new Error(`Record not found: account ${accountId}`);
  }
  return accountFromRow(row);
}

function accountSelectColumns(): string {
  return [
    "id",
    "name",
    "account_type",
    '"group"',
    "currency",
    "is_default",
    "is_active",
    "created_at",
    "updated_at",
    "platform_id",
    "account_number",
    "meta",
    "provider",
    "provider_account_id",
    "is_archived",
    "tracking_mode",
  ].join(", ");
}

function accountFromRow(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    accountType: row.account_type,
    group: row.group,
    currency: row.currency,
    isDefault: Boolean(row.is_default),
    isActive: Boolean(row.is_active),
    createdAt: toApiDate(row.created_at),
    updatedAt: toApiDate(row.updated_at),
    platformId: row.platform_id,
    accountNumber: row.account_number,
    meta: row.meta,
    provider: row.provider,
    providerAccountId: row.provider_account_id,
    isArchived: Boolean(row.is_archived),
    trackingMode: parseTrackingMode(row.tracking_mode),
  };
}

function validateNewAccount(newAccount: NewAccount): void {
  if (!newAccount.name.trim()) {
    throw new Error("Invalid input: Account name cannot be empty");
  }
  if (!newAccount.currency.trim()) {
    throw new Error("Invalid input: Currency cannot be empty");
  }
}

function validateAccountUpdate(accountUpdate: AccountUpdate): void {
  if (!accountUpdate.id) {
    throw new Error("Invalid input: Account ID is required for updates");
  }
  if (!accountUpdate.name.trim()) {
    throw new Error("Invalid input: Account name cannot be empty");
  }
}

function publishAccountsChanged(
  eventBus: BackendEventBus | undefined,
  accountId: string,
  currencyChanges: { account_id: string; old_currency: string | null; new_currency: string }[],
): void {
  eventBus?.publish({
    name: ACCOUNTS_CHANGED_EVENT,
    payload: {
      type: ACCOUNTS_CHANGED_EVENT,
      account_ids: [accountId],
      currency_changes: currencyChanges,
    },
  });
}

async function deactivateOrphanedInvestments(options: AccountServiceOptions): Promise<void> {
  if (!options.deactivateOrphanedInvestments) {
    return;
  }
  try {
    const deactivatedAssetIds = await options.deactivateOrphanedInvestments();
    for (const assetId of deactivatedAssetIds) {
      if (!options.deleteSyncState) {
        continue;
      }
      try {
        await options.deleteSyncState(assetId);
      } catch (error) {
        warn(
          options,
          `Failed to delete sync state for orphaned asset ${assetId}: ${stringifyError(error)}`,
        );
      }
    }
  } catch (error) {
    warn(
      options,
      `Failed to deactivate orphaned assets after account deletion: ${stringifyError(error)}`,
    );
  }
}

function resolveBaseCurrency(options: AccountServiceOptions): string | undefined {
  if (typeof options.baseCurrency === "function") {
    return options.baseCurrency();
  }
  return options.baseCurrency;
}

function boolToInt(value: boolean): number {
  return value ? 1 : 0;
}

function sqliteNow(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function toApiDate(value: string): string {
  return value.includes(" ") ? value.replace(" ", "T") : value;
}

function warn(options: AccountServiceOptions, message: string): void {
  if (options.warn) {
    options.warn(message);
    return;
  }
  console.warn(message);
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
