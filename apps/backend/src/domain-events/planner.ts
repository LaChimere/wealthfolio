import type { BackendEvent } from "../events";
import type { PortfolioJobConfig } from "../domains/portfolio-jobs";

export const DEVICE_SYNC_PULL_COMPLETE_EVENT = "device_sync_pull_complete";
export const ASSETS_CREATED_EVENT = "assets_created";
export const ASSETS_UPDATED_EVENT = "assets_updated";
export const ASSETS_MERGED_EVENT = "assets_merged";
export const ACCOUNTS_CHANGED_EVENT = "accounts_changed";
export const ACTIVITIES_CHANGED_EVENT = "activities_changed";
export const HOLDINGS_CHANGED_EVENT = "holdings_changed";
export const MANUAL_SNAPSHOT_SAVED_EVENT = "manual_snapshot_saved";
export const TRACKING_MODE_CHANGED_EVENT = "tracking_mode_changed";

type TrackingMode = "NOT_SET" | "TRANSACTIONS" | "HOLDINGS";

interface ActivityChangedPayload {
  account_ids?: unknown;
  asset_ids?: unknown;
  earliest_activity_at_utc?: unknown;
}

interface IdsPayload {
  account_ids?: unknown;
  asset_ids?: unknown;
}

interface TrackingModeChangedPayload {
  account_id?: unknown;
  old_mode?: unknown;
  new_mode?: unknown;
  is_connected?: unknown;
}

interface ManualSnapshotSavedPayload {
  account_id?: unknown;
}

export function planPortfolioJob(
  events: BackendEvent[],
  timezone = "UTC",
): PortfolioJobConfig | null {
  const accountIds = new Set<string>();
  const assetIds = new Set<string>();
  let hasRecalcEvent = false;
  let earliestActivityAtUtc: Date | null = null;

  for (const event of events) {
    const payload = eventPayload(event);
    switch (event.name) {
      case ACTIVITIES_CHANGED_EVENT: {
        hasRecalcEvent = true;
        for (const id of stringArray((payload as ActivityChangedPayload).account_ids)) {
          accountIds.add(id);
        }
        for (const id of stringArray((payload as ActivityChangedPayload).asset_ids)) {
          assetIds.add(id);
        }
        const activityDate = dateField(
          (payload as ActivityChangedPayload).earliest_activity_at_utc,
        );
        if (activityDate && (!earliestActivityAtUtc || activityDate < earliestActivityAtUtc)) {
          earliestActivityAtUtc = activityDate;
        }
        break;
      }
      case HOLDINGS_CHANGED_EVENT: {
        hasRecalcEvent = true;
        for (const id of stringArray((payload as IdsPayload).account_ids)) {
          accountIds.add(id);
        }
        for (const id of stringArray((payload as IdsPayload).asset_ids)) {
          assetIds.add(id);
        }
        break;
      }
      case ACCOUNTS_CHANGED_EVENT: {
        hasRecalcEvent = true;
        for (const id of stringArray((payload as IdsPayload).account_ids)) {
          accountIds.add(id);
        }
        break;
      }
      case MANUAL_SNAPSHOT_SAVED_EVENT: {
        const accountId = stringField((payload as ManualSnapshotSavedPayload).account_id);
        if (accountId) {
          accountIds.add(accountId);
        }
        hasRecalcEvent = true;
        break;
      }
      case DEVICE_SYNC_PULL_COMPLETE_EVENT:
        hasRecalcEvent = true;
        break;
      case ASSETS_UPDATED_EVENT:
        hasRecalcEvent = true;
        for (const id of stringArray((payload as IdsPayload).asset_ids)) {
          assetIds.add(id);
        }
        break;
      case ASSETS_CREATED_EVENT:
        for (const id of stringArray((payload as IdsPayload).asset_ids)) {
          assetIds.add(id);
        }
        break;
      case TRACKING_MODE_CHANGED_EVENT: {
        const tracking = payload as TrackingModeChangedPayload;
        if (tracking.old_mode === "HOLDINGS" && tracking.new_mode === "TRANSACTIONS") {
          const accountId = stringField(tracking.account_id);
          if (accountId) {
            accountIds.add(accountId);
          }
          hasRecalcEvent = true;
        }
        break;
      }
      case ASSETS_MERGED_EVENT:
        break;
    }
  }

  if (!hasRecalcEvent) {
    return null;
  }

  const sortedAccountIds = sorted(accountIds);
  const sortedAssetIds = sorted(assetIds);
  return {
    accountIds: sortedAccountIds.length > 0 ? sortedAccountIds : null,
    marketSyncMode: {
      type: "incremental",
      asset_ids: sortedAssetIds.length > 0 ? sortedAssetIds : null,
    },
    snapshotMode: "full",
    valuationMode: "full",
    sinceDate: earliestActivityAtUtc ? dateInTimezone(earliestActivityAtUtc, timezone) : null,
  };
}

export function planBrokerSync(events: BackendEvent[]): string[] {
  const accountIds: string[] = [];
  for (const event of events) {
    if (event.name !== TRACKING_MODE_CHANGED_EVENT) {
      continue;
    }
    const payload = eventPayload(event) as TrackingModeChangedPayload;
    if (payload.is_connected !== true || payload.old_mode === payload.new_mode) {
      continue;
    }

    const oldMode = trackingMode(payload.old_mode);
    const newMode = trackingMode(payload.new_mode);
    const needsSync =
      (oldMode === "NOT_SET" && (newMode === "TRANSACTIONS" || newMode === "HOLDINGS")) ||
      (oldMode === "HOLDINGS" && newMode === "TRANSACTIONS");
    const accountId = stringField(payload.account_id);
    if (needsSync && accountId) {
      accountIds.push(accountId);
    }
  }
  return accountIds;
}

export function planAssetEnrichment(events: BackendEvent[]): string[] {
  const assetIds = new Set<string>();
  for (const event of events) {
    if (event.name !== ASSETS_CREATED_EVENT) {
      continue;
    }
    const payload = eventPayload(event) as IdsPayload;
    for (const id of stringArray(payload.asset_ids)) {
      assetIds.add(id);
    }
  }
  return sorted(assetIds);
}

function eventPayload(event: BackendEvent): Record<string, unknown> {
  return event.payload && typeof event.payload === "object"
    ? (event.payload as Record<string, unknown>)
    : {};
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const id = stringField(entry);
    return id ? [id] : [];
  });
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function trackingMode(value: unknown): TrackingMode | null {
  return value === "NOT_SET" || value === "TRANSACTIONS" || value === "HOLDINGS" ? value : null;
}

function dateField(value: unknown): Date | null {
  if (typeof value !== "string") {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateInTimezone(date: Date, timezone: string): string {
  const timeZone = timezone.trim() || "UTC";
  try {
    return formatDateInTimezone(date, timeZone);
  } catch {
    return formatDateInTimezone(date, "UTC");
  }
}

function formatDateInTimezone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function sorted(values: Set<string>): string[] {
  return Array.from(values).sort();
}
