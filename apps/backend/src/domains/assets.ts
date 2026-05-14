import type { Database } from "bun:sqlite";

import type { BackendEventBus } from "../events";

export interface Asset extends Record<string, unknown> {
  id: string;
  kind: string;
  name: string | null;
  displayCode: string | null;
  notes: string | null;
  metadata: unknown | null;
  isActive: boolean;
  quoteMode: string;
  quoteCcy: string;
  instrumentType: string | null;
  instrumentSymbol: string | null;
  instrumentExchangeMic: string | null;
  instrumentKey: string | null;
  providerConfig: unknown | null;
  exchangeName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewAsset extends Record<string, unknown> {
  id?: string;
  kind: string;
  name?: string;
  displayCode?: string;
  notes?: string;
  isActive?: boolean;
  quoteMode: string;
  quoteCcy: string;
  instrumentType?: string;
  instrumentSymbol?: string;
  instrumentExchangeMic?: string;
  providerConfig?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface UpdateAssetProfile extends Record<string, unknown> {
  name?: string;
  displayCode?: string;
  notes: string;
  kind?: string;
  quoteMode?: string;
  quoteCcy?: string;
  instrumentType?: string;
  instrumentSymbol?: string;
  instrumentExchangeMic?: string;
  providerConfig?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface AssetService {
  listAssets(): Promise<Asset[]> | Asset[];
  getAssetProfile(assetId: string): Promise<Asset> | Asset;
  createAsset(asset: NewAsset): Promise<Asset> | Asset;
  updateAssetProfile(assetId: string, profile: UpdateAssetProfile): Promise<Asset> | Asset;
  updateQuoteMode(assetId: string, quoteMode: string): Promise<Asset> | Asset;
  deleteAsset(assetId: string): Promise<void> | void;
}

export interface AssetServiceOptions {
  eventBus?: BackendEventBus;
  exchangeNameByMic?: ReadonlyMap<string, string> | Record<string, string>;
}

interface AssetRow {
  id: string;
  kind: string;
  name: string | null;
  display_code: string | null;
  notes: string | null;
  metadata: string | null;
  is_active: number;
  quote_mode: string;
  quote_ccy: string;
  instrument_type: string | null;
  instrument_symbol: string | null;
  instrument_exchange_mic: string | null;
  instrument_key: string | null;
  provider_config: string | null;
  created_at: string;
  updated_at: string;
}

interface CountRow {
  count: number;
}

const ASSETS_UPDATED_EVENT = "assets_updated";
const VALID_QUOTE_MODES = new Set(["MARKET", "MANUAL"]);

export function createAssetService(db: Database, options: AssetServiceOptions = {}): AssetService {
  const exchangeNameByMic = normalizeExchangeLookup(options.exchangeNameByMic);
  const quoteSyncStateExists = tableExists(db, "quote_sync_state");

  return {
    listAssets() {
      return db
        .query<AssetRow, []>("SELECT * FROM assets")
        .all()
        .map((row) => rowToAsset(row, exchangeNameByMic));
    },

    getAssetProfile(assetId) {
      return rowToAsset(readAssetRow(db, assetId), exchangeNameByMic);
    },

    createAsset() {
      throw new Error(
        "Asset creation is not available in the TS backend until market identity canonicalization is migrated",
      );
    },

    updateAssetProfile() {
      throw new Error(
        "Asset profile updates are not available in the TS backend until market identity canonicalization is migrated",
      );
    },

    updateQuoteMode(assetId, quoteMode) {
      const normalizedQuoteMode = normalizeQuoteMode(quoteMode);
      const updateAssetQuoteMode = db.transaction(() => {
        const updated = db
          .query<AssetRow, [string, string]>(
            `
              UPDATE assets
              SET quote_mode = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
              WHERE id = ?
              RETURNING *
            `,
          )
          .get(normalizedQuoteMode, assetId);
        if (!updated) {
          throw new Error(`Record not found: asset ${assetId}`);
        }
        if (normalizedQuoteMode === "MANUAL" && quoteSyncStateExists) {
          db.query("DELETE FROM quote_sync_state WHERE asset_id = ?").run(assetId);
        }
        return rowToAsset(updated, exchangeNameByMic);
      });
      const asset = updateAssetQuoteMode();
      options.eventBus?.publish({
        name: ASSETS_UPDATED_EVENT,
        payload: { type: ASSETS_UPDATED_EVENT, asset_ids: [asset.id] },
      });
      return asset;
    },

    deleteAsset(assetId) {
      const deleteAsset = db.transaction(() => {
        const existing = db
          .query<{ id: string }, [string]>("SELECT id FROM assets WHERE id = ?")
          .get(assetId);
        if (!existing) {
          throw new Error(`Record not found: asset ${assetId}`);
        }
        const activityCount =
          db
            .query<
              CountRow,
              [string]
            >("SELECT COUNT(*) AS count FROM activities WHERE asset_id = ?")
            .get(assetId)?.count ?? 0;
        if (activityCount > 0) {
          throw new Error(
            "Cannot delete asset: it has existing activities. Please delete all associated activities first.",
          );
        }
        if (quoteSyncStateExists) {
          db.query("DELETE FROM quote_sync_state WHERE asset_id = ?").run(assetId);
        }
        db.query("DELETE FROM quotes WHERE asset_id = ?").run(assetId);
        db.query("DELETE FROM assets WHERE id = ?").run(assetId);
      });
      deleteAsset();
    },
  };
}

export function parseExchangeNameLookup(json: string): Map<string, string> {
  const parsed: unknown = JSON.parse(json);
  if (!isRecord(parsed) || !Array.isArray(parsed.exchanges)) {
    throw new Error("Invalid exchange metadata catalog");
  }
  const lookup = new Map<string, string>();
  for (const entry of parsed.exchanges) {
    if (!isRecord(entry) || typeof entry.mic !== "string" || typeof entry.name !== "string") {
      continue;
    }
    lookup.set(entry.mic.toUpperCase(), entry.name);
  }
  return lookup;
}

function readAssetRow(db: Database, assetId: string): AssetRow {
  const asset = db.query<AssetRow, [string]>("SELECT * FROM assets WHERE id = ?").get(assetId);
  if (!asset) {
    throw new Error(`Record not found: asset ${assetId}`);
  }
  return asset;
}

function rowToAsset(row: AssetRow, exchangeNameByMic: ReadonlyMap<string, string>): Asset {
  const instrumentExchangeMic = row.instrument_exchange_mic;
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    displayCode: row.display_code,
    notes: row.notes,
    metadata: parseJsonValue(row.metadata),
    isActive: row.is_active !== 0,
    quoteMode: row.quote_mode,
    quoteCcy: row.quote_ccy,
    instrumentType: row.instrument_type,
    instrumentSymbol: row.instrument_symbol,
    instrumentExchangeMic,
    instrumentKey: row.instrument_key,
    providerConfig: parseJsonValue(row.provider_config),
    exchangeName: instrumentExchangeMic
      ? (exchangeNameByMic.get(instrumentExchangeMic.toUpperCase()) ?? null)
      : null,
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
  };
}

function normalizeQuoteMode(value: string): string {
  if (!VALID_QUOTE_MODES.has(value)) {
    throw new Error(`Invalid input: Unsupported quote mode '${value}'`);
  }
  return value;
}

function parseJsonValue(value: string | null): unknown | null {
  if (value === null) {
    return null;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function normalizeTimestamp(value: string): string {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    return `${trimmed.replace(" ", "T")}Z`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T00:00:00Z`;
  }
  return trimmed;
}

function normalizeExchangeLookup(
  lookup: AssetServiceOptions["exchangeNameByMic"],
): ReadonlyMap<string, string> {
  if (!lookup) {
    return new Map();
  }
  if (lookup instanceof Map) {
    return new Map([...lookup.entries()].map(([mic, name]) => [mic.toUpperCase(), name]));
  }
  return new Map(Object.entries(lookup).map(([mic, name]) => [mic.toUpperCase(), name]));
}

function tableExists(db: Database, tableName: string): boolean {
  return (
    db
      .query<
        { name: string },
        [string]
      >("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName) !== null
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
