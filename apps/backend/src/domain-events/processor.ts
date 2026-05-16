import type { BackendEvent } from "../events";
import type { PortfolioJobConfig, PortfolioJobService } from "../domains/portfolio-jobs";
import { planAssetEnrichment, planBrokerSync, planPortfolioJob } from "./planner";

export interface DomainEventProcessorOptions {
  enrichAssets?: (assetIds: string[]) => Promise<void> | void;
  portfolioJobService?: PortfolioJobService;
  syncBrokerAccounts?: (accountIds: string[]) => Promise<void> | void;
  timezone?: string | (() => string | undefined);
}

export interface DomainEventProcessingPlan {
  assetEnrichmentIds: string[];
  portfolioJob: PortfolioJobConfig | null;
  brokerSyncAccountIds: string[];
}

export async function processDomainEventBatch(
  events: BackendEvent[],
  options: DomainEventProcessorOptions = {},
): Promise<DomainEventProcessingPlan> {
  const assetEnrichmentIds = planAssetEnrichment(events);
  if (assetEnrichmentIds.length > 0) {
    await options.enrichAssets?.(assetEnrichmentIds);
  }

  const portfolioJob = planPortfolioJob(events, resolveTimezone(options));
  if (portfolioJob) {
    await options.portfolioJobService?.enqueuePortfolioJob(portfolioJob);
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

function resolveTimezone(options: DomainEventProcessorOptions): string {
  if (typeof options.timezone === "function") {
    return options.timezone() ?? "UTC";
  }
  return options.timezone ?? "UTC";
}
