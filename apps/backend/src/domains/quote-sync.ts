export type QuoteSyncOperation = "Create" | "Update" | "Delete";

export interface QuoteSyncRow {
  id: string;
  asset_id: string;
  day: string;
  source: string;
  open: string | null;
  high: string | null;
  low: string | null;
  close: string;
  adjclose: string | null;
  volume: string | null;
  currency: string;
  notes: string | null;
  created_at: string;
  timestamp: string;
}

export interface QuoteRowPayload {
  id: string;
  assetId: string;
  day: string;
  source: string;
  open: string | null;
  high: string | null;
  low: string | null;
  close: string;
  adjclose: string | null;
  volume: string | null;
  currency: string;
  notes: string | null;
  createdAt: string;
  timestamp: string;
}

export interface QuoteSyncEvent {
  quoteId: string;
  operation: QuoteSyncOperation;
  payload: QuoteRowPayload | { id: string };
}

export function queueUserQuoteSyncEvent(
  queueSyncEvent: ((event: QuoteSyncEvent) => void) | undefined,
  row: QuoteSyncRow,
  operation: QuoteSyncOperation,
): void {
  if (!isUserSyncableQuote(row)) {
    return;
  }
  queueSyncEvent?.({
    quoteId: row.id,
    operation,
    payload: operation === "Delete" ? { id: row.id } : quoteRowPayload(row),
  });
}

export function isUserSyncableQuote(row: Pick<QuoteSyncRow, "id" | "source">): boolean {
  return row.source.toUpperCase() === "MANUAL" && isUuid(row.id);
}

export function quoteRowPayload(row: QuoteSyncRow): QuoteRowPayload {
  return {
    id: row.id,
    assetId: row.asset_id,
    day: row.day,
    source: row.source,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    adjclose: row.adjclose,
    volume: row.volume,
    currency: row.currency,
    notes: row.notes,
    createdAt: row.created_at,
    timestamp: row.timestamp,
  };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
