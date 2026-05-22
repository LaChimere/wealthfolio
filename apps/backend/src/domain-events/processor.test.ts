import { describe, expect, test } from "bun:test";

import { createEventBus, type BackendEvent } from "../events";
import type { PortfolioJobConfig } from "../domains/portfolio-jobs";
import {
  ACTIVITIES_CHANGED_EVENT,
  ASSETS_CREATED_EVENT,
  TRACKING_MODE_CHANGED_EVENT,
} from "./planner";
import { processDomainEventBatch } from "./processor";

describe("TS domain event batch processor", () => {
  test("runs planned actions in Rust queue-worker order", async () => {
    const calls: string[] = [];
    const portfolioJobs: PortfolioJobConfig[] = [];

    const plan = await processDomainEventBatch(
      [
        event(ASSETS_CREATED_EVENT, { asset_ids: ["bond-1"] }),
        event(ACTIVITIES_CHANGED_EVENT, {
          account_ids: ["account-1"],
          asset_ids: ["asset-1"],
          earliest_activity_at_utc: "2025-01-01T01:30:00.000Z",
        }),
        event(TRACKING_MODE_CHANGED_EVENT, {
          account_id: "account-2",
          old_mode: "NOT_SET",
          new_mode: "TRANSACTIONS",
          is_connected: true,
        }),
      ],
      {
        enrichAssets(assetIds) {
          calls.push(`enrich:${assetIds.join(",")}`);
        },
        portfolioJobService: {
          enqueuePortfolioJob(config) {
            calls.push(`portfolio:${config.accountIds?.join(",") ?? "all"}`);
            portfolioJobs.push(config);
          },
        },
        refreshGoalSummaries() {
          calls.push("goals:refresh");
        },
        syncBrokerAccounts(accountIds) {
          calls.push(`broker:${accountIds.join(",")}`);
        },
        timezone: "America/Toronto",
      },
    );

    expect(calls).toEqual([
      "enrich:bond-1",
      "portfolio:account-1",
      "goals:refresh",
      "broker:account-2",
    ]);
    expect(plan).toEqual({
      assetEnrichmentIds: ["bond-1"],
      portfolioJob: {
        accountIds: ["account-1"],
        marketSyncMode: { type: "incremental", asset_ids: ["asset-1", "bond-1"] },
        snapshotMode: "full",
        valuationMode: "full",
        sinceDate: "2024-12-31",
      },
      brokerSyncAccountIds: ["account-2"],
    });
    expect(portfolioJobs).toEqual([plan.portfolioJob]);
  });

  test("returns a plan without requiring action callbacks", async () => {
    await expect(
      processDomainEventBatch([event(ASSETS_CREATED_EVENT, { asset_ids: ["asset-1"] })]),
    ).resolves.toEqual({
      assetEnrichmentIds: ["asset-1"],
      portfolioJob: null,
      brokerSyncAccountIds: [],
    });
  });

  test("publishes Rust-shaped asset enrichment lifecycle events", async () => {
    const eventBus = createEventBus();
    const published: BackendEvent[] = [];
    eventBus.subscribe((backendEvent) => {
      published.push(backendEvent);
    });

    const plan = await processDomainEventBatch(
      [event(ASSETS_CREATED_EVENT, { asset_ids: ["asset-1", "asset-2"] })],
      {
        enrichAssets(assetIds) {
          expect(assetIds).toEqual(["asset-1", "asset-2"]);
          return { enriched: 1, skipped: 1, failed: 0 };
        },
        eventBus,
      },
    );

    expect(plan.assetEnrichmentIds).toEqual(["asset-1", "asset-2"]);
    expect(published).toEqual([
      { name: "asset:enrichment-start", payload: { total: 2 } },
      { name: "asset:enrichment-progress", payload: { completed: 2, total: 2 } },
      { name: "asset:enrichment-complete", payload: { enriched: 1, skipped: 1, failed: 0 } },
    ]);
  });

  test("does not refresh goal summaries when portfolio jobs are only planned", async () => {
    const calls: string[] = [];

    const plan = await processDomainEventBatch(
      [
        event(ACTIVITIES_CHANGED_EVENT, {
          account_ids: ["account-1"],
          earliest_activity_at_utc: "2025-01-01T00:00:00.000Z",
        }),
      ],
      {
        refreshGoalSummaries() {
          calls.push("goals:refresh");
        },
        timezone: "UTC",
      },
    );

    expect(plan.portfolioJob?.accountIds).toEqual(["account-1"]);
    expect(calls).toEqual([]);
  });

  test("continues goal refresh and broker sync when a portfolio job fails", async () => {
    const calls: string[] = [];

    const plan = await processDomainEventBatch(
      [
        event(ACTIVITIES_CHANGED_EVENT, {
          account_ids: ["account-1"],
          asset_ids: ["asset-1"],
          earliest_activity_at_utc: "2025-01-01T01:30:00.000Z",
        }),
        event(TRACKING_MODE_CHANGED_EVENT, {
          account_id: "account-2",
          old_mode: "NOT_SET",
          new_mode: "TRANSACTIONS",
          is_connected: true,
        }),
      ],
      {
        portfolioJobService: {
          enqueuePortfolioJob() {
            calls.push("portfolio");
            throw new Error("portfolio failed");
          },
        },
        onPortfolioJobError(error, portfolioJob) {
          calls.push(
            `portfolio-error:${error instanceof Error ? error.message : String(error)}:${
              portfolioJob.accountIds?.join(",") ?? "all"
            }`,
          );
        },
        refreshGoalSummaries() {
          calls.push("goals:refresh");
        },
        syncBrokerAccounts(accountIds) {
          calls.push(`broker:${accountIds.join(",")}`);
        },
        timezone: "America/Toronto",
      },
    );

    expect(calls).toEqual([
      "portfolio",
      "portfolio-error:portfolio failed:account-1",
      "goals:refresh",
      "broker:account-2",
    ]);
    expect(plan.portfolioJob).toMatchObject({ accountIds: ["account-1"] });
    expect(plan.brokerSyncAccountIds).toEqual(["account-2"]);
  });

  test("logs portfolio job failures when no explicit error hook is provided", async () => {
    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    try {
      await expect(
        processDomainEventBatch(
          [
            event(ACTIVITIES_CHANGED_EVENT, {
              account_ids: ["account-1"],
              earliest_activity_at_utc: "2025-01-01T00:00:00.000Z",
            }),
          ],
          {
            portfolioJobService: {
              enqueuePortfolioJob() {
                throw new Error("portfolio failed");
              },
            },
            timezone: "UTC",
          },
        ),
      ).resolves.toMatchObject({
        portfolioJob: { accountIds: ["account-1"] },
      });
    } finally {
      console.warn = originalWarn;
    }

    expect(warnings).toEqual([
      ["Domain event portfolio job failed for accounts account-1: portfolio failed"],
    ]);
  });

  test("continues broker sync when goal summary refresh fails", async () => {
    const calls: string[] = [];

    const plan = await processDomainEventBatch(
      [
        event(ACTIVITIES_CHANGED_EVENT, {
          account_ids: ["account-1"],
          earliest_activity_at_utc: "2025-01-01T00:00:00.000Z",
        }),
        event(TRACKING_MODE_CHANGED_EVENT, {
          account_id: "account-2",
          old_mode: "NOT_SET",
          new_mode: "TRANSACTIONS",
          is_connected: true,
        }),
      ],
      {
        portfolioJobService: {
          enqueuePortfolioJob() {
            calls.push("portfolio");
          },
        },
        refreshGoalSummaries() {
          calls.push("goals:refresh");
          throw new Error("refresh failed");
        },
        onGoalSummaryRefreshError(error) {
          calls.push(`goals:error:${error instanceof Error ? error.message : String(error)}`);
        },
        syncBrokerAccounts(accountIds) {
          calls.push(`broker:${accountIds.join(",")}`);
        },
        timezone: "UTC",
      },
    );

    expect(calls).toEqual([
      "portfolio",
      "goals:refresh",
      "goals:error:refresh failed",
      "broker:account-2",
    ]);
    expect(plan.portfolioJob).toMatchObject({ accountIds: ["account-1"] });
    expect(plan.brokerSyncAccountIds).toEqual(["account-2"]);
  });

  test("reports broker sync failures without failing the batch", async () => {
    const calls: string[] = [];

    const plan = await processDomainEventBatch(
      [
        event(TRACKING_MODE_CHANGED_EVENT, {
          account_id: "account-1",
          old_mode: "NOT_SET",
          new_mode: "TRANSACTIONS",
          is_connected: true,
        }),
      ],
      {
        syncBrokerAccounts(accountIds) {
          calls.push(`broker:${accountIds.join(",")}`);
          throw new Error("broker failed");
        },
        onBrokerSyncError(error, accountIds) {
          calls.push(
            `broker-error:${error instanceof Error ? error.message : String(error)}:${accountIds.join(",")}`,
          );
        },
      },
    );

    expect(calls).toEqual(["broker:account-1", "broker-error:broker failed:account-1"]);
    expect(plan.brokerSyncAccountIds).toEqual(["account-1"]);
  });

  test("logs broker sync failures when no explicit error hook is provided", async () => {
    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    try {
      await expect(
        processDomainEventBatch(
          [
            event(TRACKING_MODE_CHANGED_EVENT, {
              account_id: "account-1",
              old_mode: "NOT_SET",
              new_mode: "TRANSACTIONS",
              is_connected: true,
            }),
          ],
          {
            syncBrokerAccounts() {
              throw new Error("broker failed");
            },
          },
        ),
      ).resolves.toMatchObject({
        brokerSyncAccountIds: ["account-1"],
      });
    } finally {
      console.warn = originalWarn;
    }

    expect(warnings).toEqual([
      ["Broker sync failed after tracking mode change for accounts account-1: broker failed"],
    ]);
  });

  test("continues after asset enrichment chunk failures like Rust", async () => {
    const eventBus = createEventBus();
    const published: BackendEvent[] = [];
    const calls: string[] = [];
    eventBus.subscribe((backendEvent) => {
      published.push(backendEvent);
    });

    const plan = await processDomainEventBatch(
      [
        event(ASSETS_CREATED_EVENT, {
          asset_ids: ["asset-1", "asset-2", "asset-3", "asset-4", "asset-5", "asset-6"],
        }),
        event(ACTIVITIES_CHANGED_EVENT, {
          account_ids: ["account-1"],
          asset_ids: ["activity-asset"],
        }),
      ],
      {
        assetEnrichmentChunkSize: 5,
        enrichAssets(assetIds) {
          calls.push(`enrich:${assetIds.join(",")}`);
          if (assetIds.includes("asset-1")) {
            throw new Error("enrichment failed");
          }
          return { enriched: 1, skipped: 0, failed: 0 };
        },
        eventBus,
        onAssetEnrichmentError(error, assetIds) {
          calls.push(
            `enrich-error:${assetIds.join(",")}:${error instanceof Error ? error.message : String(error)}`,
          );
        },
        portfolioJobService: {
          enqueuePortfolioJob(config) {
            calls.push(`portfolio:${config.accountIds?.join(",") ?? "all"}`);
          },
        },
        refreshGoalSummaries() {
          calls.push("goals:refresh");
        },
      },
    );

    expect(calls).toEqual([
      "enrich:asset-1,asset-2,asset-3,asset-4,asset-5",
      "enrich-error:asset-1,asset-2,asset-3,asset-4,asset-5:enrichment failed",
      "enrich:asset-6",
      "portfolio:account-1",
      "goals:refresh",
    ]);
    expect(plan.portfolioJob).toMatchObject({ accountIds: ["account-1"] });
    expect(published).toEqual([
      { name: "asset:enrichment-start", payload: { total: 6 } },
      { name: "asset:enrichment-progress", payload: { completed: 5, total: 6 } },
      { name: "asset:enrichment-progress", payload: { completed: 6, total: 6 } },
      { name: "asset:enrichment-complete", payload: { enriched: 1, skipped: 0, failed: 5 } },
    ]);
  });
});

function event(name: string, payload?: Record<string, unknown>): BackendEvent {
  return { name, payload };
}
