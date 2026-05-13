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
