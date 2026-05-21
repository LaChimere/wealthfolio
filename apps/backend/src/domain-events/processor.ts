import type { BackendEvent } from "../events";
import type { BackendEventBus } from "../events";
import type { PortfolioJobConfig, PortfolioJobService } from "../domains/portfolio-jobs";
import { planAssetEnrichment, planBrokerSync, planPortfolioJob } from "./planner";

export interface AssetEnrichmentResult {
  enriched: number;
  skipped: number;
  failed: number;
}

export interface DomainEventProcessorOptions {
  enrichAssets?: (
    assetIds: string[],
  ) => Promise<AssetEnrichmentResult | void> | AssetEnrichmentResult | void;
  eventBus?: BackendEventBus;
  onGoalSummaryRefreshError?: (error: unknown) => void;
  onPortfolioJobError?: (error: unknown, portfolioJob: PortfolioJobConfig) => void;
  portfolioJobService?: PortfolioJobService;
  refreshGoalSummaries?: () => Promise<void> | void;
  syncBrokerAccounts?: (accountIds: string[]) => Promise<void> | void;
  timezone?: string | (() => string | undefined);
}

export interface DomainEventProcessingPlan {
  assetEnrichmentIds: string[];
  portfolioJob: PortfolioJobConfig | null;
  brokerSyncAccountIds: string[];
}

const ASSET_ENRICHMENT_START = "asset:enrichment-start";
const ASSET_ENRICHMENT_PROGRESS = "asset:enrichment-progress";
const ASSET_ENRICHMENT_COMPLETE = "asset:enrichment-complete";

export async function processDomainEventBatch(
  events: BackendEvent[],
  options: DomainEventProcessorOptions = {},
): Promise<DomainEventProcessingPlan> {
  const assetEnrichmentIds = planAssetEnrichment(events);
  if (assetEnrichmentIds.length > 0) {
    await runAssetEnrichment(assetEnrichmentIds, options);
  }

  const portfolioJob = planPortfolioJob(events, resolveTimezone(options));
  if (portfolioJob) {
    if (options.portfolioJobService) {
      try {
        await options.portfolioJobService.enqueuePortfolioJob(portfolioJob);
      } catch (error) {
        reportPortfolioJobError(error, portfolioJob, options.onPortfolioJobError);
      }
      try {
        await options.refreshGoalSummaries?.();
      } catch (error) {
        reportGoalSummaryRefreshError(error, options.onGoalSummaryRefreshError);
      }
    }
  }

  const brokerSyncAccountIds = planBrokerSync(events);
  if (brokerSyncAccountIds.length > 0) {
    await options.syncBrokerAccounts?.(brokerSyncAccountIds);
  }

  return {
    assetEnrichmentIds,
    portfolioJob,
    brokerSyncAccountIds,
  };
}

async function runAssetEnrichment(
  assetIds: string[],
  options: DomainEventProcessorOptions,
): Promise<void> {
  if (!options.enrichAssets) {
    return;
  }
  const total = assetIds.length;
  options.eventBus?.publish({
    name: ASSET_ENRICHMENT_START,
    payload: { total },
  });
  const result = await options.enrichAssets(assetIds);
  const counts = normalizeAssetEnrichmentResult(result, total);
  options.eventBus?.publish({
    name: ASSET_ENRICHMENT_PROGRESS,
    payload: { completed: counts.enriched + counts.skipped + counts.failed, total },
  });
  options.eventBus?.publish({
    name: ASSET_ENRICHMENT_COMPLETE,
    payload: counts,
  });
}

function normalizeAssetEnrichmentResult(
  result: AssetEnrichmentResult | void,
  total: number,
): AssetEnrichmentResult {
  if (!result) {
    return { enriched: total, skipped: 0, failed: 0 };
  }
  return result;
}

function resolveTimezone(options: DomainEventProcessorOptions): string {
  if (typeof options.timezone === "function") {
    return options.timezone() ?? "UTC";
  }
  return options.timezone ?? "UTC";
}

function reportPortfolioJobError(
  error: unknown,
  portfolioJob: PortfolioJobConfig,
  onPortfolioJobError?: (error: unknown, portfolioJob: PortfolioJobConfig) => void,
): void {
  if (onPortfolioJobError) {
    onPortfolioJobError(error, portfolioJob);
    return;
  }
  console.warn(
    `Domain event portfolio job failed for accounts ${portfolioJob.accountIds?.join(",") ?? "all"}: ${errorMessage(error)}`,
  );
}

function reportGoalSummaryRefreshError(
  error: unknown,
  onGoalSummaryRefreshError?: (error: unknown) => void,
): void {
  if (onGoalSummaryRefreshError) {
    onGoalSummaryRefreshError(error);
    return;
  }
  console.warn(`Failed to refresh goal summaries after domain events: ${errorMessage(error)}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
