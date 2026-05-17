import { describe, expect, test } from "bun:test";

import {
  DEFAULT_HISTORY_DAYS,
  buildPortfolioRecalculateConfig,
  buildPortfolioUpdateConfig,
  createDeferredPortfolioJobService,
} from "./portfolio-jobs";

describe("TS portfolio job route config", () => {
  test("builds update jobs with Rust-compatible incremental defaults", () => {
    expect(buildPortfolioUpdateConfig()).toEqual({
      accountIds: null,
      marketSyncMode: { type: "incremental", asset_ids: null },
      snapshotMode: "incremental_from_last",
      valuationMode: "incremental_from_last",
      sinceDate: null,
    });
    expect(
      buildPortfolioUpdateConfig({
        accountIds: ["acc-1"],
        marketSyncMode: { type: "none" },
      }),
    ).toMatchObject({
      accountIds: ["acc-1"],
      marketSyncMode: { type: "incremental", asset_ids: null },
    });
  });

  test("builds recalculation jobs with Rust-compatible backfill defaults", () => {
    expect(buildPortfolioRecalculateConfig()).toEqual({
      accountIds: null,
      marketSyncMode: { type: "backfill_history", asset_ids: null, days: DEFAULT_HISTORY_DAYS },
      snapshotMode: "full",
      valuationMode: "full",
      sinceDate: null,
    });
    expect(
      buildPortfolioRecalculateConfig({
        marketSyncMode: { type: "refetch_recent", asset_ids: ["asset-1"], days: 7 },
      }),
    ).toMatchObject({
      marketSyncMode: { type: "refetch_recent", asset_ids: ["asset-1"], days: 7 },
      snapshotMode: "full",
      valuationMode: "full",
    });
    expect(buildPortfolioRecalculateConfig({ marketSyncMode: { type: "none" } })).toMatchObject({
      marketSyncMode: { type: "backfill_history", asset_ids: null, days: DEFAULT_HISTORY_DAYS },
    });
  });

  test("reports execution as an explicit deferred runtime", async () => {
    const service = createDeferredPortfolioJobService();

    await expect(service.enqueuePortfolioJob(buildPortfolioUpdateConfig())).rejects.toMatchObject({
      status: 501,
      code: "not_implemented",
    });
  });
});
