import type { Database } from "bun:sqlite";

import Decimal from "decimal.js";

export interface HoldingInput {
  assetId?: string;
  symbol: string;
  quantity: string;
  currency: string;
  averageCost?: string;
  exchangeMic?: string;
  name?: string;
  dataSource?: string;
  assetKind?: string;
}

export interface SaveManualHoldingsRequest {
  accountId: string;
  holdings: HoldingInput[];
  cashBalances: Record<string, string>;
  snapshotDate?: string;
}

export interface HoldingsPositionInput {
  symbol: string;
  quantity: string;
  avgCost?: string;
  currency: string;
  exchangeMic?: string;
  assetId?: string;
}

export interface HoldingsSnapshotInput {
  date: string;
  positions: HoldingsPositionInput[];
  cashBalances: Record<string, string>;
}

export interface HoldingsImportRequest {
  accountId: string;
  snapshots: HoldingsSnapshotInput[];
}

export interface HoldingsService {
  getHoldings(accountId: string): Promise<unknown[]> | unknown[];
  getHolding(accountId: string, assetId: string): Promise<unknown | null> | unknown | null;
  getAssetHoldings(assetId: string): Promise<unknown[]> | unknown[];
  getHistoricalValuations(
    accountId: string,
    startDate?: string,
    endDate?: string,
  ): Promise<unknown[]> | unknown[];
  getLatestValuations(accountIds?: string[]): Promise<unknown[]> | unknown[];
  getPortfolioAllocations(accountId: string): Promise<unknown> | unknown;
  getHoldingsByAllocation(
    accountId: string,
    taxonomyId: string,
    categoryId: string,
  ): Promise<unknown> | unknown;
  getSnapshots(
    accountId: string,
    dateFrom?: string,
    dateTo?: string,
  ): Promise<unknown[]> | unknown[];
  getSnapshotByDate(accountId: string, date: string): Promise<unknown[]> | unknown[];
  deleteSnapshot(accountId: string, date: string): Promise<void> | void;
  saveManualHoldings(request: SaveManualHoldingsRequest): Promise<void> | void;
  checkHoldingsImport(request: HoldingsImportRequest): Promise<unknown> | unknown;
  importHoldingsCsv(request: HoldingsImportRequest): Promise<unknown> | unknown;
}

export interface DailyAccountValuation {
  id: string;
  accountId: string;
  valuationDate: string;
  accountCurrency: string;
  baseCurrency: string;
  fxRateToBase: number;
  cashBalance: number;
  investmentMarketValue: number;
  totalValue: number;
  costBasis: number;
  netContribution: number;
  calculatedAt: string;
}

export class HoldingsNotImplementedError extends Error {
  readonly status = 501;
  readonly code = "not_implemented";

  constructor(message: string) {
    super(message);
    this.name = "HoldingsNotImplementedError";
  }
}

interface DailyAccountValuationRow {
  id: string;
  account_id: string;
  valuation_date: string;
  account_currency: string;
  base_currency: string;
  fx_rate_to_base: string;
  cash_balance: string;
  investment_market_value: string;
  total_value: string;
  cost_basis: string;
  net_contribution: string;
  calculated_at: string;
}

export function createHoldingsService(db: Database): HoldingsService {
  return {
    getHoldings() {
      return notImplemented("Holdings fan-out is not available in the TS runtime yet");
    },
    getHolding() {
      return notImplemented("Holding detail is not available in the TS runtime yet");
    },
    getAssetHoldings() {
      return notImplemented("Asset holdings are not available in the TS runtime yet");
    },
    getHistoricalValuations(accountId, startDate, endDate) {
      return readHistoricalValuations(db, accountId, startDate, endDate);
    },
    getLatestValuations(accountIds) {
      const ids = accountIds && accountIds.length > 0 ? accountIds : readActiveAccountIds(db);
      return ids.length === 0 ? [] : readLatestValuations(db, ids);
    },
    getPortfolioAllocations() {
      return notImplemented("Portfolio allocations are not available in the TS runtime yet");
    },
    getHoldingsByAllocation() {
      return notImplemented("Allocation holdings are not available in the TS runtime yet");
    },
    getSnapshots() {
      return notImplemented("Holdings snapshots are not available in the TS runtime yet");
    },
    getSnapshotByDate() {
      return notImplemented("Snapshot holdings are not available in the TS runtime yet");
    },
    deleteSnapshot() {
      return notImplemented("Snapshot deletion is not available in the TS runtime yet");
    },
    saveManualHoldings() {
      return notImplemented("Manual holdings save is not available in the TS runtime yet");
    },
    checkHoldingsImport() {
      return notImplemented("Holdings import validation is not available in the TS runtime yet");
    },
    importHoldingsCsv() {
      return notImplemented("Holdings import is not available in the TS runtime yet");
    },
  };
}

function notImplemented(message: string): Promise<never> {
  return Promise.reject(new HoldingsNotImplementedError(message));
}

function readHistoricalValuations(
  db: Database,
  accountId: string,
  startDate: string | undefined,
  endDate: string | undefined,
): DailyAccountValuation[] {
  const conditions = ["account_id = ?"];
  const params = [accountId];
  if (startDate) {
    conditions.push("valuation_date >= ?");
    params.push(startDate);
  }
  if (endDate) {
    conditions.push("valuation_date <= ?");
    params.push(endDate);
  }

  return db
    .query<DailyAccountValuationRow, string[]>(
      `
        SELECT *
        FROM daily_account_valuation
        WHERE ${conditions.join(" AND ")}
        ORDER BY valuation_date ASC
      `,
    )
    .all(...params)
    .map(valuationFromRow);
}

function readLatestValuations(db: Database, accountIds: string[]): DailyAccountValuation[] {
  const placeholders = accountIds.map(() => "?").join(", ");
  const rows = db
    .query<DailyAccountValuationRow, string[]>(
      `
        WITH ranked_valuations AS (
          SELECT
            *,
            ROW_NUMBER() OVER (
              PARTITION BY account_id
              ORDER BY valuation_date DESC
            ) AS rn
          FROM daily_account_valuation
          WHERE account_id IN (${placeholders})
        )
        SELECT
          id,
          account_id,
          valuation_date,
          account_currency,
          base_currency,
          fx_rate_to_base,
          cash_balance,
          investment_market_value,
          total_value,
          cost_basis,
          net_contribution,
          calculated_at
        FROM ranked_valuations
        WHERE rn = 1
      `,
    )
    .all(...accountIds);
  const byAccount = new Map(rows.map((row) => [row.account_id, valuationFromRow(row)]));
  return accountIds.flatMap((accountId) => {
    const valuation = byAccount.get(accountId);
    return valuation ? [valuation] : [];
  });
}

function readActiveAccountIds(db: Database): string[] {
  return db
    .query<{ id: string }, []>(
      `
        SELECT id
        FROM accounts
        WHERE is_active = 1
        ORDER BY is_active DESC, is_archived ASC, name ASC
      `,
    )
    .all()
    .map((account) => account.id);
}

function valuationFromRow(row: DailyAccountValuationRow): DailyAccountValuation {
  return {
    id: row.id,
    accountId: row.account_id,
    valuationDate: row.valuation_date,
    accountCurrency: row.account_currency,
    baseCurrency: row.base_currency,
    fxRateToBase: decimalToNumber(row.fx_rate_to_base, new Decimal(1)),
    cashBalance: decimalToNumber(row.cash_balance, new Decimal(0)),
    investmentMarketValue: decimalToNumber(row.investment_market_value, new Decimal(0)),
    totalValue: decimalToNumber(row.total_value, new Decimal(0)),
    costBasis: decimalToNumber(row.cost_basis, new Decimal(0)),
    netContribution: decimalToNumber(row.net_contribution, new Decimal(0)),
    calculatedAt: row.calculated_at,
  };
}

function decimalToNumber(value: unknown, fallback: Decimal): number {
  try {
    const decimal = new Decimal(value as Decimal.Value);
    return Number((decimal.isFinite() ? decimal : fallback).toString());
  } catch {
    return Number(fallback.toString());
  }
}
