import { describe, expect, test } from "bun:test";

import type { BackendEvent } from "../events";
import {
  ACCOUNTS_CHANGED_EVENT,
  ACTIVITIES_CHANGED_EVENT,
  ASSETS_CREATED_EVENT,
  ASSETS_UPDATED_EVENT,
  DEVICE_SYNC_PULL_COMPLETE_EVENT,
  HOLDINGS_CHANGED_EVENT,
  MANUAL_SNAPSHOT_SAVED_EVENT,
  TRACKING_MODE_CHANGED_EVENT,
  planAssetEnrichment,
  planBrokerSync,
  planPortfolioJob,
} from "./planner";

describe("TS domain event planner", () => {
  test("plans portfolio jobs by merging recalculation events", () => {
    const config = planPortfolioJob(
      [
        event(ACTIVITIES_CHANGED_EVENT, {
          account_ids: ["acc-2", "", "acc-1"],
          asset_ids: ["MSFT", "AAPL"],
          currencies: ["USD"],
          earliest_activity_at_utc: "2025-01-01T01:30:00.000Z",
        }),
        event(HOLDINGS_CHANGED_EVENT, {
          account_ids: ["acc-3"],
          asset_ids: ["CASH"],
        }),
        event(ACCOUNTS_CHANGED_EVENT, {
          account_ids: ["acc-4"],
          currency_changes: [],
        }),
        event(ASSETS_CREATED_EVENT, {
          asset_ids: ["FX-USD-CAD"],
        }),
        event(ASSETS_UPDATED_EVENT, {
          asset_ids: ["AAPL", "SHOP"],
        }),
        event(MANUAL_SNAPSHOT_SAVED_EVENT, {
          account_id: "acc-5",
        }),
      ],
      "America/Toronto",
    );

    expect(config).toEqual({
      accountIds: ["acc-1", "acc-2", "acc-3", "acc-4", "acc-5"],
      marketSyncMode: {
        type: "incremental",
        asset_ids: ["AAPL", "CASH", "FX-USD-CAD", "MSFT", "SHOP"],
      },
      snapshotMode: "full",
      valuationMode: "full",
      sinceDate: "2024-12-31",
    });
  });

  test("uses the earliest activity timestamp across activity events", () => {
    const config = planPortfolioJob(
      [
        event(ACTIVITIES_CHANGED_EVENT, {
          account_ids: ["acc-1"],
          asset_ids: ["AAPL"],
          earliest_activity_at_utc: "2025-02-01T00:00:00.000Z",
        }),
        event(ACTIVITIES_CHANGED_EVENT, {
          account_ids: ["acc-2"],
          asset_ids: ["MSFT"],
          earliest_activity_at_utc: "2025-01-31T23:00:00.000Z",
        }),
      ],
      "UTC",
    );

    expect(config?.sinceDate).toBe("2025-01-31");
  });

  test("does not plan a portfolio job for asset creation alone", () => {
    expect(
      planPortfolioJob([
        event(ASSETS_CREATED_EVENT, {
          asset_ids: ["AAPL"],
        }),
      ]),
    ).toBeNull();
  });

  test("plans full portfolio job for device-sync pull without account or asset filters", () => {
    expect(planPortfolioJob([event(DEVICE_SYNC_PULL_COMPLETE_EVENT)])).toEqual({
      accountIds: null,
      marketSyncMode: { type: "incremental", asset_ids: null },
      snapshotMode: "full",
      valuationMode: "full",
      sinceDate: null,
    });
  });

  test("only holdings-to-transactions tracking changes trigger portfolio recalculation", () => {
    expect(
      planPortfolioJob([
        event(TRACKING_MODE_CHANGED_EVENT, {
          account_id: "acc-1",
          old_mode: "HOLDINGS",
          new_mode: "TRANSACTIONS",
          is_connected: true,
        }),
      ])?.accountIds,
    ).toEqual(["acc-1"]);

    expect(
      planPortfolioJob([
        event(TRACKING_MODE_CHANGED_EVENT, {
          account_id: "acc-1",
          old_mode: "TRANSACTIONS",
          new_mode: "HOLDINGS",
          is_connected: true,
        }),
      ]),
    ).toBeNull();
  });

  test("plans broker sync for Rust-compatible tracking-mode transitions", () => {
    const accounts = planBrokerSync([
      event(TRACKING_MODE_CHANGED_EVENT, {
        account_id: "acc-1",
        old_mode: "NOT_SET",
        new_mode: "TRANSACTIONS",
        is_connected: true,
      }),
      event(TRACKING_MODE_CHANGED_EVENT, {
        account_id: "acc-2",
        old_mode: "HOLDINGS",
        new_mode: "HOLDINGS",
        is_connected: true,
      }),
      event(TRACKING_MODE_CHANGED_EVENT, {
        account_id: "acc-3",
        old_mode: "NOT_SET",
        new_mode: "TRANSACTIONS",
        is_connected: false,
      }),
      event(TRACKING_MODE_CHANGED_EVENT, {
        account_id: "acc-4",
        old_mode: "HOLDINGS",
        new_mode: "TRANSACTIONS",
        is_connected: true,
      }),
      event(TRACKING_MODE_CHANGED_EVENT, {
        account_id: "acc-5",
        old_mode: "TRANSACTIONS",
        new_mode: "HOLDINGS",
        is_connected: true,
      }),
    ]);

    expect(accounts).toEqual(["acc-1", "acc-4"]);
  });

  test("deduplicates asset enrichment IDs", () => {
    expect(
      planAssetEnrichment([
        event(ASSETS_CREATED_EVENT, {
          asset_ids: ["AAPL", "MSFT"],
        }),
        event(ASSETS_CREATED_EVENT, {
          asset_ids: ["AAPL", "GOOG", ""],
        }),
      ]),
    ).toEqual(["AAPL", "GOOG", "MSFT"]);
  });
});

function event(name: string, payload?: Record<string, unknown>): BackendEvent {
  return { name, payload };
}
