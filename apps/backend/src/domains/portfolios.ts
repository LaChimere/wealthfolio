import { randomUUID } from "node:crypto";

import type { Database } from "bun:sqlite";

import type { AccountService } from "./accounts";

export interface PortfolioWithAccounts {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  accountIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface NewPortfolio {
  name: string;
  description?: string | null;
  sortOrder?: number;
  accountIds: string[];
}

export interface PortfolioUpdate {
  id: string;
  name: string;
  description?: string | null;
  sortOrder?: number;
  accountIds: string[];
}

export type PortfolioSyncOperation = "Create" | "Update" | "Delete";

export interface PortfolioSyncEvent {
  entity: "portfolios" | "portfolio_accounts";
  entityId: string;
  operation: PortfolioSyncOperation;
  payload: Record<string, unknown>;
}

export interface PortfolioService {
  listPortfolios(): PortfolioWithAccounts[];
  getPortfolio(id: string): PortfolioWithAccounts;
  createPortfolio(portfolio: NewPortfolio): Promise<PortfolioWithAccounts>;
  updatePortfolio(portfolio: PortfolioUpdate): Promise<PortfolioWithAccounts>;
  deletePortfolio(id: string): Promise<void>;
}

export interface PortfolioServiceOptions {
  accountService?: Pick<AccountService, "getAllAccounts">;
  queueSyncEvent?: (event: PortfolioSyncEvent) => void;
}

interface PortfolioRow {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface PortfolioAccountRow {
  id: string;
  portfolio_id: string;
  account_id: string;
  sort_order: number;
  created_at: string;
}

export function createPortfolioService(
  db: Database,
  options: PortfolioServiceOptions = {},
): PortfolioService {
  return {
    listPortfolios() {
      return listPortfolios(db);
    },
    getPortfolio(id) {
      return getPortfolio(db, id);
    },
    async createPortfolio(portfolio) {
      const input = normalizeNewPortfolio(portfolio);
      validatePortfolioInput(input);
      validateAccountIdsExist(input.accountIds, options.accountService);
      const now = timestampNow();
      const portfolioId = randomUUID();
      const row: PortfolioRow = {
        id: portfolioId,
        name: input.name,
        description: input.description,
        sort_order: input.sortOrder,
        created_at: now,
        updated_at: now,
      };
      const memberships = input.accountIds.map((accountId, index) =>
        portfolioAccountRow(portfolioId, accountId, index, now),
      );

      try {
        db.transaction(() => {
          insertPortfolioRow(db, row);
          for (const membership of memberships) {
            insertPortfolioAccountRow(db, membership);
          }
          queuePortfolioSyncEvents(options, row, "Create", memberships, [], now);
        })();
      } catch (error) {
        throw portfolioDbError(error);
      }

      return buildPortfolio(row, memberships);
    },
    async updatePortfolio(portfolio) {
      const input = normalizePortfolioUpdate(portfolio);
      validatePortfolioInput(input, true);
      validateAccountIdsExist(input.accountIds, options.accountService);
      const existing = readPortfolioRow(db, input.id);
      const oldMemberships = readPortfolioAccountRows(db, [input.id]);
      const now = timestampNow();
      const row: PortfolioRow = {
        id: input.id,
        name: input.name,
        description: input.description,
        sort_order: input.sortOrder,
        created_at: existing.created_at,
        updated_at: now,
      };
      const memberships = input.accountIds.map((accountId, index) =>
        portfolioAccountRow(input.id, accountId, index, now),
      );

      try {
        db.transaction(() => {
          updatePortfolioRow(db, row);
          deletePortfolioAccountRows(db, input.id);
          for (const membership of memberships) {
            insertPortfolioAccountRow(db, membership);
          }
          queuePortfolioSyncEvents(options, row, "Update", memberships, oldMemberships, now);
        })();
      } catch (error) {
        throw portfolioDbError(error);
      }

      return buildPortfolio(row, memberships);
    },
    async deletePortfolio(id) {
      const existingRow = db
        .query<PortfolioRow, [string]>(
          `
            SELECT id, name, description, sort_order, created_at, updated_at
            FROM portfolios
            WHERE id = ?
          `,
        )
        .get(id);
      if (!existingRow) {
        return;
      }
      const memberships = readPortfolioAccountRows(db, [id]);
      db.transaction(() => {
        deletePortfolioAccountRows(db, id);
        db.prepare("DELETE FROM portfolios WHERE id = ?").run(id);
        queuePortfolioDeleteEvents(options, existingRow, memberships);
      })();
    },
  };
}

function listPortfolios(db: Database): PortfolioWithAccounts[] {
  const rows = db
    .query<PortfolioRow, []>(
      `
        SELECT id, name, description, sort_order, created_at, updated_at
        FROM portfolios
        ORDER BY sort_order ASC, name ASC
      `,
    )
    .all();
  if (rows.length === 0) {
    return [];
  }
  const memberships = readPortfolioAccountRows(
    db,
    rows.map((row) => row.id),
  );
  const membershipsByPortfolio = new Map<string, PortfolioAccountRow[]>();
  for (const membership of memberships) {
    const existing = membershipsByPortfolio.get(membership.portfolio_id) ?? [];
    existing.push(membership);
    membershipsByPortfolio.set(membership.portfolio_id, existing);
  }
  return rows.map((row) => buildPortfolio(row, membershipsByPortfolio.get(row.id) ?? []));
}

function getPortfolio(db: Database, id: string): PortfolioWithAccounts {
  const row = readPortfolioRow(db, id);
  return buildPortfolio(row, readPortfolioAccountRows(db, [id]));
}

function readPortfolioRow(db: Database, id: string): PortfolioRow {
  const row = db
    .query<PortfolioRow, [string]>(
      `
        SELECT id, name, description, sort_order, created_at, updated_at
        FROM portfolios
        WHERE id = ?
      `,
    )
    .get(id);
  if (!row) {
    throw new Error(`Portfolio not found: ${id}`);
  }
  return row;
}

function readPortfolioAccountRows(db: Database, portfolioIds: string[]): PortfolioAccountRow[] {
  if (portfolioIds.length === 0) {
    return [];
  }
  const placeholders = portfolioIds.map(() => "?").join(", ");
  return db
    .query<PortfolioAccountRow, string[]>(
      `
        SELECT id, portfolio_id, account_id, sort_order, created_at
        FROM portfolio_accounts
        WHERE portfolio_id IN (${placeholders})
        ORDER BY portfolio_id ASC, sort_order ASC, account_id ASC
      `,
    )
    .all(...portfolioIds);
}

function insertPortfolioRow(db: Database, row: PortfolioRow): void {
  db.prepare(
    `
      INSERT INTO portfolios (id, name, description, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
  ).run(row.id, row.name, row.description, row.sort_order, row.created_at, row.updated_at);
}

function updatePortfolioRow(db: Database, row: PortfolioRow): void {
  const result = db
    .prepare(
      `
        UPDATE portfolios
        SET name = ?, description = ?, sort_order = ?, created_at = ?, updated_at = ?
        WHERE id = ?
      `,
    )
    .run(row.name, row.description, row.sort_order, row.created_at, row.updated_at, row.id);
  if (result.changes === 0) {
    throw new Error(`Portfolio not found: ${row.id}`);
  }
}

function insertPortfolioAccountRow(db: Database, row: PortfolioAccountRow): void {
  db.prepare(
    `
      INSERT INTO portfolio_accounts (id, portfolio_id, account_id, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?)
    `,
  ).run(row.id, row.portfolio_id, row.account_id, row.sort_order, row.created_at);
}

function deletePortfolioAccountRows(db: Database, portfolioId: string): void {
  db.prepare("DELETE FROM portfolio_accounts WHERE portfolio_id = ?").run(portfolioId);
}

function buildPortfolio(
  row: PortfolioRow,
  memberships: PortfolioAccountRow[],
): PortfolioWithAccounts {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    sortOrder: row.sort_order,
    accountIds: memberships.map((membership) => membership.account_id).sort(),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function portfolioAccountRow(
  portfolioId: string,
  accountId: string,
  sortOrder: number,
  createdAt: string,
): PortfolioAccountRow {
  return {
    id: `pfm_${portfolioId}_${accountId}`,
    portfolio_id: portfolioId,
    account_id: accountId,
    sort_order: sortOrder,
    created_at: createdAt,
  };
}

function normalizeNewPortfolio(portfolio: NewPortfolio): Required<NewPortfolio> {
  return {
    name: portfolio.name.trim(),
    description: portfolio.description ?? null,
    sortOrder: portfolio.sortOrder ?? 0,
    accountIds: [...portfolio.accountIds],
  };
}

function normalizePortfolioUpdate(portfolio: PortfolioUpdate): Required<PortfolioUpdate> {
  return {
    id: portfolio.id,
    name: portfolio.name.trim(),
    description: portfolio.description ?? null,
    sortOrder: portfolio.sortOrder ?? 0,
    accountIds: [...portfolio.accountIds],
  };
}

function validatePortfolioInput(
  portfolio: { id?: string; name: string; sortOrder: number; accountIds: string[] },
  requireId = false,
): void {
  if (requireId && !portfolio.id?.trim()) {
    throw new Error("Portfolio ID is required for updates");
  }
  if (!portfolio.name) {
    throw new Error("Portfolio name cannot be empty");
  }
  if (portfolio.accountIds.length === 0) {
    throw new Error("Portfolio must contain at least one account");
  }
  if (
    !Number.isInteger(portfolio.sortOrder) ||
    portfolio.sortOrder < -2_147_483_648 ||
    portfolio.sortOrder > 2_147_483_647
  ) {
    throw new Error("sortOrder must be an integer between -2147483648 and 2147483647");
  }
  const seen = new Set<string>();
  for (const accountId of portfolio.accountIds) {
    if (seen.has(accountId)) {
      throw new Error(`Duplicate account ID: ${accountId}`);
    }
    seen.add(accountId);
  }
}

function validateAccountIdsExist(
  accountIds: string[],
  accountService: Pick<AccountService, "getAllAccounts"> | undefined,
): void {
  if (!accountService) {
    return;
  }
  const existing = new Set(accountService.getAllAccounts().map((account) => account.id));
  for (const accountId of accountIds) {
    if (!existing.has(accountId)) {
      throw new Error(`Account '${accountId}' does not exist`);
    }
  }
}

function portfolioDbError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return /unique|constraint/i.test(message)
    ? new Error("Portfolio name already exists")
    : new Error(message);
}

function queuePortfolioSyncEvents(
  options: PortfolioServiceOptions,
  row: PortfolioRow,
  operation: "Create" | "Update",
  memberships: PortfolioAccountRow[],
  oldMemberships: PortfolioAccountRow[],
  now: string,
): void {
  options.queueSyncEvent?.({
    entity: "portfolios",
    entityId: row.id,
    operation,
    payload: portfolioPayload(row),
  });
  for (const oldMembership of oldMemberships) {
    options.queueSyncEvent?.({
      entity: "portfolio_accounts",
      entityId: oldMembership.id,
      operation: "Delete",
      payload: { id: oldMembership.id },
    });
  }
  for (const membership of memberships) {
    options.queueSyncEvent?.({
      entity: "portfolio_accounts",
      entityId: membership.id,
      operation: "Create",
      payload: portfolioAccountPayload(membership, now),
    });
  }
}

function queuePortfolioDeleteEvents(
  options: PortfolioServiceOptions,
  row: PortfolioRow,
  memberships: PortfolioAccountRow[],
): void {
  for (const membership of memberships) {
    options.queueSyncEvent?.({
      entity: "portfolio_accounts",
      entityId: membership.id,
      operation: "Delete",
      payload: { id: membership.id },
    });
  }
  options.queueSyncEvent?.({
    entity: "portfolios",
    entityId: row.id,
    operation: "Delete",
    payload: { id: row.id },
  });
}

function portfolioPayload(row: PortfolioRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function portfolioAccountPayload(
  row: PortfolioAccountRow,
  createdAt = row.created_at,
): Record<string, unknown> {
  return {
    id: row.id,
    portfolioId: row.portfolio_id,
    accountId: row.account_id,
    sortOrder: row.sort_order,
    createdAt,
  };
}

function timestampNow(): string {
  return new Date().toISOString();
}
