export type MarketSyncMode =
  | { type: "none" }
  | { type: "incremental"; asset_ids: string[] | null }
  | { type: "refetch_recent"; asset_ids: string[] | null; days: number }
  | { type: "backfill_history"; asset_ids: string[] | null; days: number };

export type SnapshotRecalcMode = "incremental_from_last" | "full";
export type ValuationRecalcMode = "incremental_from_last" | "full";

export interface PortfolioRequestBody {
  accountIds?: string[] | null;
  marketSyncMode?: MarketSyncMode;
}

export interface PortfolioJobConfig {
  accountIds: string[] | null;
  marketSyncMode: MarketSyncMode;
  snapshotMode: SnapshotRecalcMode;
  valuationMode: ValuationRecalcMode;
  sinceDate: string | null;
}

export interface PortfolioJobService {
  enqueuePortfolioJob(config: PortfolioJobConfig): Promise<void> | void;
}

export const DEFAULT_HISTORY_DAYS = 1_825;

export class PortfolioJobNotImplementedError extends Error {
  readonly status = 501;
  readonly code = "not_implemented";

  constructor(message: string) {
    super(message);
    this.name = "PortfolioJobNotImplementedError";
  }
}

const PORTFOLIO_JOB_DEFERRED_MESSAGE =
  "Portfolio job execution is not yet available in the TS backend runtime.";

export function createDeferredPortfolioJobService(): PortfolioJobService {
  return {
    async enqueuePortfolioJob() {
      throw new PortfolioJobNotImplementedError(PORTFOLIO_JOB_DEFERRED_MESSAGE);
    },
  };
}

export function buildPortfolioUpdateConfig(body: PortfolioRequestBody = {}): PortfolioJobConfig {
  const marketSyncMode =
    body.marketSyncMode && body.marketSyncMode.type !== "none"
      ? body.marketSyncMode
      : { type: "incremental" as const, asset_ids: null };
  return {
    accountIds: body.accountIds ?? null,
    marketSyncMode,
    snapshotMode: "incremental_from_last",
    valuationMode: "incremental_from_last",
    sinceDate: null,
  };
}

export function buildPortfolioRecalculateConfig(
  body: PortfolioRequestBody = {},
): PortfolioJobConfig {
  const marketSyncMode =
    body.marketSyncMode && body.marketSyncMode.type !== "none"
      ? body.marketSyncMode
      : { type: "backfill_history" as const, asset_ids: null, days: DEFAULT_HISTORY_DAYS };
  return {
    accountIds: body.accountIds ?? null,
    marketSyncMode,
    snapshotMode: "full",
    valuationMode: "full",
    sinceDate: null,
  };
}
