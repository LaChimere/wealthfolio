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
  assetEnrichmentChunkSize?: number;
  assetEnrichmentTimeoutMs?: number;
  enrichAssets?: (
    assetIds: string[],
  ) => Promise<AssetEnrichmentResult | void> | AssetEnrichmentResult | void;
  eventBus?: BackendEventBus;
  onAssetEnrichmentError?: (error: unknown, assetIds: string[]) => void;
  onBrokerSyncError?: (error: unknown, accountIds: string[]) => void;
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
const DEFAULT_ASSET_ENRICHMENT_CHUNK_SIZE = 5;
const DEFAULT_ASSET_ENRICHMENT_TIMEOUT_MS = 30_000;

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
    try {
      await options.syncBrokerAccounts?.(brokerSyncAccountIds);
    } catch (error) {
      reportBrokerSyncError(error, brokerSyncAccountIds, options.onBrokerSyncError);
    }
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

  const chunkSize = positiveInteger(
    options.assetEnrichmentChunkSize,
    DEFAULT_ASSET_ENRICHMENT_CHUNK_SIZE,
  );
  const timeoutMs = positiveInteger(
    options.assetEnrichmentTimeoutMs,
    DEFAULT_ASSET_ENRICHMENT_TIMEOUT_MS,
  );
  const counts: AssetEnrichmentResult = { enriched: 0, skipped: 0, failed: 0 };
  for (const chunk of chunks(assetIds, chunkSize)) {
    const result = await runAssetEnrichmentChunk(chunk, timeoutMs, options);
    if (result) {
      counts.enriched += result.enriched;
      counts.skipped += result.skipped;
      counts.failed += result.failed;
    } else {
      counts.failed += chunk.length;
    }
    options.eventBus?.publish({
      name: ASSET_ENRICHMENT_PROGRESS,
      payload: { completed: counts.enriched + counts.skipped + counts.failed, total },
    });
  }
  options.eventBus?.publish({
    name: ASSET_ENRICHMENT_COMPLETE,
    payload: counts,
  });
}

async function runAssetEnrichmentChunk(
  assetIds: string[],
  timeoutMs: number,
  options: DomainEventProcessorOptions,
): Promise<AssetEnrichmentResult | null> {
  try {
    const result = await withTimeout(Promise.resolve(options.enrichAssets?.(assetIds)), timeoutMs);
    return normalizeAssetEnrichmentResult(result, assetIds.length);
  } catch (error) {
    reportAssetEnrichmentError(error, assetIds, options.onAssetEnrichmentError);
    return null;
  }
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

function chunks<T>(items: T[], chunkSize: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    result.push(items.slice(index, index + chunkSize));
  }
  return result;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`Asset enrichment chunk timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
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

function reportAssetEnrichmentError(
  error: unknown,
  assetIds: string[],
  onAssetEnrichmentError?: (error: unknown, assetIds: string[]) => void,
): void {
  if (onAssetEnrichmentError) {
    onAssetEnrichmentError(error, assetIds);
    return;
  }
  console.warn(`Asset enrichment chunk failed for ${assetIds.join(",")}: ${errorMessage(error)}`);
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

function reportBrokerSyncError(
  error: unknown,
  accountIds: string[],
  onBrokerSyncError?: (error: unknown, accountIds: string[]) => void,
): void {
  if (onBrokerSyncError) {
    onBrokerSyncError(error, accountIds);
    return;
  }
  console.warn(
    `Broker sync failed after tracking mode change for accounts ${accountIds.join(",")}: ${errorMessage(error)}`,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
