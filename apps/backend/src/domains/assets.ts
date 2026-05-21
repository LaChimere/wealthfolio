import type { Database } from "bun:sqlite";

import type { BackendEventBus } from "../events";
import type { NewAssetTaxonomyAssignment, TaxonomyService } from "./taxonomies";

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
  notes?: string;
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
  exchangeMetadata?: ExchangeMetadata;
  exchangeNameByMic?: ReadonlyMap<string, string> | Record<string, string>;
  queueSyncEvent?: (event: AssetSyncEvent) => void;
  taxonomyService?: Pick<TaxonomyService, "assignAssetToCategory">;
  warn?: (message: string) => void;
}

export type AssetSyncOperation = "Create" | "Update" | "Delete";

export interface AssetSyncEvent {
  assetId: string;
  operation: AssetSyncOperation;
  payload: AssetRowPayload | { id: string };
}

export interface AssetRowPayload {
  id: string;
  kind: string;
  name: string | null;
  displayCode: string | null;
  notes: string | null;
  metadata: string | null;
  isActive: number;
  quoteMode: string;
  quoteCcy: string;
  instrumentType: string | null;
  instrumentSymbol: string | null;
  instrumentExchangeMic: string | null;
  providerConfig: string | null;
  createdAt: string;
  updatedAt: string;
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

interface CanonicalMarketIdentity {
  instrumentSymbol: string | null;
  instrumentExchangeMic: string | null;
  displayCode: string | null;
  quoteCcy: string | null;
}

export interface ExchangeMetadata {
  nameByMic: ReadonlyMap<string, string>;
  currencyByMic: ReadonlyMap<string, string>;
  yahooSuffixToMic: ReadonlyMap<string, string>;
}

const ASSETS_CREATED_EVENT = "assets_created";
const ASSETS_UPDATED_EVENT = "assets_updated";
const VALID_ASSET_KINDS = new Set([
  "INVESTMENT",
  "PROPERTY",
  "VEHICLE",
  "COLLECTIBLE",
  "PRECIOUS_METAL",
  "PRIVATE_EQUITY",
  "LIABILITY",
  "OTHER",
  "FX",
]);
const VALID_QUOTE_MODES = new Set(["MARKET", "MANUAL"]);
const VALID_INSTRUMENT_TYPES = new Set(["EQUITY", "CRYPTO", "FX", "OPTION", "METAL", "BOND"]);

export function createAssetService(db: Database, options: AssetServiceOptions = {}): AssetService {
  const exchangeMetadata =
    options.exchangeMetadata ?? exchangeNameMetadata(options.exchangeNameByMic);
  const quoteSyncStateExists = tableExists(db, "quote_sync_state");

  return {
    listAssets() {
      return db
        .query<AssetRow, []>("SELECT * FROM assets")
        .all()
        .map((row) => rowToAsset(row, exchangeMetadata.nameByMic));
    },

    getAssetProfile(assetId) {
      return rowToAsset(readAssetRow(db, assetId), exchangeMetadata.nameByMic);
    },

    createAsset(asset) {
      const createAssetRow = db.transaction(() => {
        const newAsset = normalizeNewAsset(asset, exchangeMetadata);
        const instrumentKey = generatedInstrumentKey(newAsset);
        if (instrumentKey) {
          const existing = db
            .query<AssetRow, [string]>("SELECT * FROM assets WHERE instrument_key = ?")
            .get(instrumentKey);
          if (existing) {
            return { created: false, row: existing };
          }
        }

        const now = timestampNow();
        const assetId = newAsset.id ?? crypto.randomUUID();
        db.query(
          `
            INSERT INTO assets (
              id, kind, name, display_code, notes, metadata, is_active, quote_mode,
              quote_ccy, instrument_type, instrument_symbol, instrument_exchange_mic,
              provider_config, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        ).run(
          assetId,
          newAsset.kind,
          newAsset.name ?? null,
          newAsset.displayCode ?? null,
          newAsset.notes ?? null,
          serializeJsonValue(newAsset.metadata),
          boolToInt(newAsset.isActive ?? true),
          newAsset.quoteMode,
          newAsset.quoteCcy,
          newAsset.instrumentType ?? null,
          newAsset.instrumentSymbol ?? null,
          newAsset.instrumentExchangeMic ?? null,
          serializeJsonValue(newAsset.providerConfig),
          now,
          now,
        );
        const row = readAssetRow(db, assetId);
        queueAssetSyncEvent(options, row, "Create");
        return { created: true, row };
      });
      const result = createAssetRow();
      const created = rowToAsset(result.row, exchangeMetadata.nameByMic);
      if (result.created) {
        const publishCreated = () => {
          options.eventBus?.publish({
            name: ASSETS_CREATED_EVENT,
            payload: { type: ASSETS_CREATED_EVENT, asset_ids: [created.id] },
          });
        };
        const classification = classifyCreatedAsset(options, created);
        if (classification) {
          return classification.then(() => {
            publishCreated();
            return created;
          });
        }
        publishCreated();
      }
      return created;
    },

    updateAssetProfile(assetId, profile) {
      const updateAssetProfileRow = db.transaction(() => {
        const existing = readAssetRow(db, assetId);
        const update = normalizeAssetProfileUpdate(existing, profile, exchangeMetadata);
        db.query(
          `
            UPDATE assets
            SET
              name = ?,
              kind = ?,
              display_code = ?,
              notes = ?,
              metadata = ?,
              quote_mode = ?,
              quote_ccy = ?,
              instrument_type = ?,
              instrument_symbol = ?,
              instrument_exchange_mic = ?,
              provider_config = ?,
              updated_at = ?
            WHERE id = ?
          `,
        ).run(
          update.name,
          update.kind,
          update.displayCode,
          update.notes,
          update.metadata,
          update.quoteMode,
          update.quoteCcy,
          update.instrumentType,
          update.instrumentSymbol,
          update.instrumentExchangeMic,
          update.providerConfig,
          timestampNow(),
          assetId,
        );
        const updated = readAssetRow(db, assetId);
        if (quoteSyncStateExists && shouldResetSyncStateAfterProfileChange(existing, updated)) {
          resetQuoteSyncStateForProfileChange(db, assetId);
        }
        queueAssetSyncEvent(options, updated, "Update");
        return updated;
      });
      const asset = rowToAsset(updateAssetProfileRow(), exchangeMetadata.nameByMic);
      options.eventBus?.publish({
        name: ASSETS_UPDATED_EVENT,
        payload: { type: ASSETS_UPDATED_EVENT, asset_ids: [asset.id] },
      });
      return asset;
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
        queueAssetSyncEvent(options, updated, "Update");
        return rowToAsset(updated, exchangeMetadata.nameByMic);
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
        queueAssetSyncDelete(options, assetId);
      });
      deleteAsset();
    },
  };
}

export function parseExchangeNameLookup(json: string): Map<string, string> {
  return new Map(parseExchangeMetadataLookup(json).nameByMic);
}

export function parseExchangeMetadataLookup(json: string): ExchangeMetadata {
  const parsed: unknown = JSON.parse(json);
  if (!isRecord(parsed) || !Array.isArray(parsed.exchanges)) {
    throw new Error("Invalid exchange metadata catalog");
  }
  const nameByMic = new Map<string, string>();
  const currencyByMic = new Map<string, string>();
  const yahooSuffixToMic = new Map<string, string>();
  for (const entry of parsed.exchanges) {
    if (!isRecord(entry) || typeof entry.mic !== "string") {
      continue;
    }
    const mic = entry.mic.toUpperCase();
    if (typeof entry.name === "string") {
      nameByMic.set(mic, entry.name);
    }
    if (typeof entry.currency === "string") {
      currencyByMic.set(mic, entry.currency);
    }
    if (isRecord(entry.yahoo) && typeof entry.yahoo.suffix === "string") {
      const suffix = entry.yahoo.suffix.trim();
      if (suffix) {
        yahooSuffixToMic.set(suffix.replace(/^\./, "").toUpperCase(), mic);
      }
    }
  }
  return { nameByMic, currencyByMic, yahooSuffixToMic };
}

function normalizeNewAsset(asset: NewAsset, exchangeMetadata: ExchangeMetadata): NewAsset {
  const kind = normalizeAssetKind(asset.kind);
  const quoteMode = normalizeQuoteMode(asset.quoteMode);
  const instrumentType = normalizeOptionalInstrumentType(asset.instrumentType);
  const canonical = canonicalizeMarketIdentity(
    instrumentType,
    asset.instrumentSymbol ?? asset.displayCode,
    asset.instrumentExchangeMic,
    asset.quoteCcy,
    exchangeMetadata,
  );
  const instrumentExchangeMic =
    canonical.instrumentExchangeMic ?? normalizeOptional(asset.instrumentExchangeMic);
  const quoteCcy =
    canonical.quoteCcy ??
    expectedMarketQuoteCcy(instrumentType, quoteMode, instrumentExchangeMic, exchangeMetadata) ??
    asset.quoteCcy;
  const normalized: NewAsset = {
    ...asset,
    kind,
    quoteMode,
    quoteCcy,
    instrumentType: instrumentType ?? undefined,
    displayCode: canonical.displayCode ?? asset.displayCode,
    instrumentSymbol:
      canonical.instrumentSymbol ?? normalizeOptional(asset.instrumentSymbol) ?? undefined,
    instrumentExchangeMic: instrumentExchangeMic ?? undefined,
  };
  if (normalized.providerConfig === undefined) {
    const inferred = inferProviderConfig(
      quoteMode,
      instrumentType,
      normalized.instrumentSymbol,
      normalized.instrumentExchangeMic,
    );
    if (inferred) {
      normalized.providerConfig = inferred;
    }
  }
  validateNewAsset(normalized);
  return normalized;
}

function normalizeAssetProfileUpdate(
  existing: AssetRow,
  profile: UpdateAssetProfile,
  exchangeMetadata: ExchangeMetadata,
): {
  name: string | null;
  kind: string;
  displayCode: string | null;
  notes: string | null;
  metadata: string | null;
  quoteMode: string;
  quoteCcy: string;
  instrumentType: string | null;
  instrumentSymbol: string | null;
  instrumentExchangeMic: string | null;
  providerConfig: string | null;
} {
  const quoteMode = hasDefined(profile, "quoteMode")
    ? normalizeQuoteMode(profile.quoteMode)
    : existing.quote_mode;
  const instrumentType = hasDefined(profile, "instrumentType")
    ? normalizeOptionalInstrumentType(profile.instrumentType)
    : existing.instrument_type;
  const rawProfileMic = hasDefined(profile, "instrumentExchangeMic")
    ? profile.instrumentExchangeMic
    : undefined;
  const profileMic = normalizeProfileMic(rawProfileMic);
  const shouldRefreshQuoteCcy =
    quoteMode === "MARKET" &&
    !hasDefined(profile, "quoteCcy") &&
    rawProfileMic !== undefined &&
    normalizeOptional(rawProfileMic) !== normalizeOptional(existing.instrument_exchange_mic);

  let instrumentSymbol = hasDefined(profile, "instrumentSymbol")
    ? normalizeOptional(profile.instrumentSymbol)
    : existing.instrument_symbol;
  let displayCode = hasDefined(profile, "displayCode")
    ? profile.displayCode
    : existing.display_code;
  let instrumentExchangeMic =
    rawProfileMic !== undefined ? profileMic : existing.instrument_exchange_mic;
  let quoteCcy = hasDefined(profile, "quoteCcy") ? profile.quoteCcy : existing.quote_ccy;

  if (instrumentType !== null) {
    const canonical = canonicalizeMarketIdentity(
      instrumentType,
      firstDefined(
        profile.instrumentSymbol,
        profile.displayCode,
        existing.instrument_symbol,
        existing.display_code,
      ),
      rawProfileMic !== undefined ? profileMic : existing.instrument_exchange_mic,
      shouldRefreshQuoteCcy ? undefined : quoteCcy,
      exchangeMetadata,
    );
    instrumentSymbol = canonical.instrumentSymbol ?? instrumentSymbol;
    displayCode = canonical.displayCode ?? displayCode;
    instrumentExchangeMic = canonical.instrumentExchangeMic ?? instrumentExchangeMic;
    if (quoteMode === "MARKET") {
      quoteCcy = canonical.quoteCcy ?? quoteCcy;
    }
  }

  const normalized = {
    name: hasDefined(profile, "name") ? profile.name : existing.name,
    kind: hasDefined(profile, "kind") ? normalizeAssetKind(profile.kind) : existing.kind,
    displayCode,
    notes: hasDefined(profile, "notes") ? profile.notes : existing.notes,
    metadata: hasDefined(profile, "metadata")
      ? serializeJsonValue(profile.metadata)
      : existing.metadata,
    quoteMode,
    quoteCcy,
    instrumentType,
    instrumentSymbol,
    instrumentExchangeMic,
    providerConfig: hasDefined(profile, "providerConfig")
      ? serializeJsonValue(profile.providerConfig)
      : existing.provider_config,
  };
  validateAssetProfileUpdate(normalized);
  return normalized;
}

function canonicalizeMarketIdentity(
  instrumentType: string | null,
  symbol: string | null | undefined,
  exchangeMic: string | null | undefined,
  quoteCcy: string | null | undefined,
  exchangeMetadata: ExchangeMetadata,
): CanonicalMarketIdentity {
  let instrumentSymbol = normalizeOptional(symbol);
  let instrumentExchangeMic = normalizeOptional(exchangeMic);
  let normalizedQuote = normalizeQuoteCcy(quoteCcy);

  switch (instrumentType) {
    case "EQUITY":
    case "OPTION":
    case "METAL": {
      if (instrumentSymbol) {
        const parsed = parseSymbolWithExchangeSuffix(instrumentSymbol, exchangeMetadata);
        instrumentSymbol = parsed.baseSymbol.toUpperCase();
        instrumentExchangeMic ??= parsed.mic;
      }
      normalizedQuote ??= micToCurrency(instrumentExchangeMic, exchangeMetadata);
      return {
        displayCode: instrumentSymbol,
        instrumentSymbol,
        instrumentExchangeMic,
        quoteCcy: normalizedQuote,
      };
    }
    case "CRYPTO": {
      if (instrumentSymbol) {
        const parsed = parseCryptoPairSymbol(instrumentSymbol);
        if (parsed) {
          instrumentSymbol = parsed.base.toUpperCase();
          normalizedQuote ??= parsed.quote;
        }
      }
      return {
        displayCode: instrumentSymbol,
        instrumentSymbol,
        instrumentExchangeMic: null,
        quoteCcy: normalizedQuote,
      };
    }
    case "FX": {
      if (instrumentSymbol) {
        const parsed = parseFxSymbolParts(instrumentSymbol);
        if (parsed) {
          instrumentSymbol = parsed.base;
          normalizedQuote = parsed.quote;
        }
      }
      return {
        displayCode:
          instrumentSymbol && normalizedQuote
            ? `${instrumentSymbol}/${normalizedQuote}`
            : instrumentSymbol,
        instrumentSymbol,
        instrumentExchangeMic: null,
        quoteCcy: normalizedQuote,
      };
    }
    case "BOND": {
      if (instrumentSymbol) {
        const upper = instrumentSymbol.toUpperCase();
        if (looksLikeCusip(upper)) {
          const country =
            normalizedQuote === "CAD" ? "CA" : normalizedQuote === "BMD" ? "BM" : "US";
          instrumentSymbol = cusipToIsin(upper, country);
        } else {
          instrumentSymbol = upper;
        }
      }
      return {
        displayCode: instrumentSymbol,
        instrumentSymbol,
        instrumentExchangeMic: null,
        quoteCcy: normalizedQuote,
      };
    }
    default:
      return {
        displayCode: normalizeOptional(symbol),
        instrumentSymbol: normalizeOptional(symbol),
        instrumentExchangeMic,
        quoteCcy: normalizedQuote,
      };
  }
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

function classifyCreatedAsset(
  options: AssetServiceOptions,
  asset: Asset,
): Promise<void> | undefined {
  if (!options.taxonomyService) {
    return undefined;
  }
  const assignments = initialClassificationAssignments(asset);
  if (assignments.length === 0) {
    return undefined;
  }
  return classifyCreatedAssetAsync(options.taxonomyService, assignments, options.warn);
}

async function classifyCreatedAssetAsync(
  taxonomyService: Pick<TaxonomyService, "assignAssetToCategory">,
  assignments: NewAssetTaxonomyAssignment[],
  warn: ((message: string) => void) | undefined,
): Promise<void> {
  for (const assignment of assignments) {
    try {
      await taxonomyService.assignAssetToCategory(assignment);
    } catch (error) {
      warn?.(
        `Initial classification of asset ${assignment.assetId} ${assignment.taxonomyId} failed: ${errorMessage(error)}`,
      );
    }
  }
}

function initialClassificationAssignments(asset: Asset): NewAssetTaxonomyAssignment[] {
  const assignments: NewAssetTaxonomyAssignment[] = [];
  const instrumentTypeCategory = instrumentTypeTaxonomyCategory(asset.instrumentType);
  if (instrumentTypeCategory) {
    assignments.push(taxonomyAssignment(asset.id, "instrument_type", instrumentTypeCategory));
  }

  const assetClassCategory =
    instrumentTypeAssetClass(asset.instrumentType) ?? kindAssetClass(asset.kind);
  if (assetClassCategory) {
    assignments.push(taxonomyAssignment(asset.id, "asset_classes", assetClassCategory));
  }
  return assignments;
}

function taxonomyAssignment(
  assetId: string,
  taxonomyId: string,
  categoryId: string,
): NewAssetTaxonomyAssignment {
  return {
    assetId,
    taxonomyId,
    categoryId,
    weight: 10000,
    source: "AUTO",
  };
}

function instrumentTypeTaxonomyCategory(instrumentType: string | null): string | null {
  switch (instrumentType) {
    case "EQUITY":
      return "STOCK_COMMON";
    case "CRYPTO":
      return "CRYPTO_NATIVE";
    case "OPTION":
      return "OPTION";
    case "BOND":
      return "BOND_CORPORATE";
    case "METAL":
      return "PHYSICAL_METAL";
    default:
      return null;
  }
}

function instrumentTypeAssetClass(instrumentType: string | null): string | null {
  switch (instrumentType) {
    case "EQUITY":
    case "OPTION":
      return "EQUITY";
    case "CRYPTO":
      return "DIGITAL_ASSETS";
    case "BOND":
      return "FIXED_INCOME";
    case "METAL":
      return "COMMODITIES";
    default:
      return null;
  }
}

function kindAssetClass(kind: string): string | null {
  switch (kind) {
    case "PROPERTY":
      return "REAL_ESTATE";
    case "PRECIOUS_METAL":
      return "COMMODITIES";
    case "PRIVATE_EQUITY":
    case "VEHICLE":
    case "COLLECTIBLE":
    case "OTHER":
      return "ALTERNATIVES";
    default:
      return null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function queueAssetSyncEvent(
  options: AssetServiceOptions,
  row: AssetRow,
  operation: Exclude<AssetSyncOperation, "Delete">,
): void {
  options.queueSyncEvent?.({
    assetId: row.id,
    operation,
    payload: assetRowPayload(row),
  });
}

function queueAssetSyncDelete(options: AssetServiceOptions, assetId: string): void {
  options.queueSyncEvent?.({
    assetId,
    operation: "Delete",
    payload: { id: assetId },
  });
}

function assetRowPayload(row: AssetRow): AssetRowPayload {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    displayCode: row.display_code,
    notes: row.notes,
    metadata: row.metadata,
    isActive: row.is_active,
    quoteMode: row.quote_mode,
    quoteCcy: row.quote_ccy,
    instrumentType: row.instrument_type,
    instrumentSymbol: row.instrument_symbol,
    instrumentExchangeMic: row.instrument_exchange_mic,
    providerConfig: row.provider_config,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeQuoteMode(value: string): string {
  if (!VALID_QUOTE_MODES.has(value)) {
    throw new Error(`Invalid input: Unsupported quote mode '${value}'`);
  }
  return value;
}

function normalizeAssetKind(value: string): string {
  if (!VALID_ASSET_KINDS.has(value)) {
    throw new Error(`Invalid input: Unsupported asset kind '${value}'`);
  }
  return value;
}

function normalizeOptionalInstrumentType(value: string | null | undefined): string | null {
  const normalized = normalizeOptional(value);
  if (normalized === null) {
    return null;
  }
  if (!VALID_INSTRUMENT_TYPES.has(normalized)) {
    throw new Error(`Invalid input: Unsupported instrument type '${value}'`);
  }
  return normalized;
}

function validateNewAsset(asset: NewAsset): void {
  if (asset.quoteCcy.trim() === "") {
    throw new Error("Invalid input: Currency (quote_ccy) cannot be empty");
  }
  if (
    asset.kind === "INVESTMENT" &&
    asset.quoteMode === "MARKET" &&
    (asset.instrumentSymbol === undefined || asset.instrumentSymbol.trim() === "")
  ) {
    throw new Error("Invalid input: Investments with MARKET pricing require an instrument_symbol");
  }
}

function validateAssetProfileUpdate(profile: { quoteCcy: string }): void {
  if (profile.quoteCcy.trim() === "") {
    throw new Error("Invalid input: Currency (quote_ccy) cannot be empty");
  }
}

function inferProviderConfig(
  quoteMode: string,
  instrumentType: string | null,
  instrumentSymbol: string | null | undefined,
  exchangeMic: string | null | undefined,
): Record<string, unknown> | null {
  if (quoteMode !== "MARKET") {
    return null;
  }
  if (
    instrumentType === "EQUITY" &&
    (exchangeMic === "XETR" || exchangeMic === "XFRA") &&
    instrumentSymbol !== undefined &&
    instrumentSymbol !== null &&
    looksLikeIsin(instrumentSymbol)
  ) {
    return { preferred_provider: "BOERSE_FRANKFURT" };
  }
  return null;
}

function expectedMarketQuoteCcy(
  instrumentType: string | null,
  quoteMode: string,
  exchangeMic: string | null,
  exchangeMetadata: ExchangeMetadata,
): string | null {
  if (
    quoteMode !== "MARKET" ||
    (instrumentType !== "EQUITY" && instrumentType !== "OPTION" && instrumentType !== "METAL")
  ) {
    return null;
  }
  return micToCurrency(exchangeMic, exchangeMetadata);
}

function parseSymbolWithExchangeSuffix(
  symbol: string,
  exchangeMetadata: ExchangeMetadata,
): { baseSymbol: string; mic: string | null } {
  const trimmed = symbol.trim();
  const suffixes = [...exchangeMetadata.yahooSuffixToMic.entries()].sort(
    ([left], [right]) => right.length - left.length,
  );
  for (const [suffix, mic] of suffixes) {
    const dottedSuffix = `.${suffix}`;
    if (
      trimmed.length >= dottedSuffix.length &&
      trimmed.slice(trimmed.length - dottedSuffix.length).toUpperCase() === dottedSuffix
    ) {
      return { baseSymbol: trimmed.slice(0, -dottedSuffix.length), mic };
    }
  }
  return { baseSymbol: trimmed, mic: null };
}

function parseCryptoPairSymbol(symbol: string): { base: string; quote: string } | null {
  const trimmed = symbol.trim();
  const separator = trimmed.lastIndexOf("-");
  if (separator <= 0 || separator === trimmed.length - 1) {
    return null;
  }
  const base = trimmed.slice(0, separator).trim();
  const quote = trimmed
    .slice(separator + 1)
    .trim()
    .toUpperCase();
  if (base === "" || quote.length < 3 || quote.length > 5 || !/^[A-Z]+$/.test(quote)) {
    return null;
  }
  return { base, quote };
}

function parseFxSymbolParts(symbol: string): { base: string; quote: string } | null {
  const cleaned = symbol.trim().toUpperCase().replace(/=X$/, "");
  const slashParts = cleaned.split("/");
  if (
    slashParts.length === 2 &&
    /^[A-Z]{3}$/.test(slashParts[0] ?? "") &&
    /^[A-Z]{3}$/.test(slashParts[1] ?? "")
  ) {
    return { base: slashParts[0] ?? "", quote: slashParts[1] ?? "" };
  }
  if (/^[A-Z]{6}$/.test(cleaned)) {
    return { base: cleaned.slice(0, 3), quote: cleaned.slice(3) };
  }
  return null;
}

function generatedInstrumentKey(asset: {
  instrumentType?: string | null;
  instrumentSymbol?: string | null;
  instrumentExchangeMic?: string | null;
  quoteCcy: string;
}): string | null {
  if (!asset.instrumentType || !asset.instrumentSymbol) {
    return null;
  }
  if (asset.instrumentType === "CRYPTO" || asset.instrumentType === "FX") {
    return `${asset.instrumentType}:${asset.instrumentSymbol.toUpperCase()}/${asset.quoteCcy.toUpperCase()}`;
  }
  if (asset.instrumentExchangeMic) {
    return `${asset.instrumentType}:${asset.instrumentSymbol.toUpperCase()}@${asset.instrumentExchangeMic.toUpperCase()}`;
  }
  return `${asset.instrumentType}:${asset.instrumentSymbol.toUpperCase()}`;
}

function shouldResetSyncStateAfterProfileChange(before: AssetRow, after: AssetRow): boolean {
  return (
    before.quote_mode !== after.quote_mode ||
    before.quote_ccy !== after.quote_ccy ||
    before.instrument_type !== after.instrument_type ||
    before.instrument_symbol !== after.instrument_symbol ||
    before.instrument_exchange_mic !== after.instrument_exchange_mic ||
    before.provider_config !== after.provider_config ||
    ((before.instrument_type === "BOND" || after.instrument_type === "BOND") &&
      metadataIdentifier(before.metadata, "isin") !== metadataIdentifier(after.metadata, "isin"))
  );
}

function resetQuoteSyncStateForProfileChange(db: Database, assetId: string): void {
  db.query(
    `
      UPDATE quote_sync_state
      SET data_source = '', error_count = 0, last_error = NULL,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE asset_id = ?
    `,
  ).run(assetId);
}

function metadataIdentifier(metadata: string | null, key: string): string | null {
  const parsed = parseJsonValue(metadata);
  if (!isRecord(parsed) || !isRecord(parsed.identifiers)) {
    return null;
  }
  const value = parsed.identifiers[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function normalizeOptional(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed.toUpperCase();
}

function normalizeProfileMic(value: string | null | undefined): string | null {
  const normalized = normalizeOptional(value);
  return normalized === null ? null : normalized;
}

function normalizeQuoteCcy(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }
  if (trimmed === "GBp") {
    return "GBp";
  }
  if (trimmed.toUpperCase() === "GBX") {
    return "GBX";
  }
  if (trimmed === "ZAc" || trimmed.toUpperCase() === "ZAC") {
    return "ZAc";
  }
  return trimmed.toUpperCase();
}

function micToCurrency(
  mic: string | null | undefined,
  exchangeMetadata: ExchangeMetadata,
): string | null {
  if (!mic) {
    return null;
  }
  return normalizeQuoteCcy(exchangeMetadata.currencyByMic.get(mic.toUpperCase())) ?? null;
}

function looksLikeIsin(value: string): boolean {
  const trimmed = value.trim();
  return /^[A-Za-z]{2}[A-Za-z0-9]{9}\d$/.test(trimmed);
}

function looksLikeCusip(value: string): boolean {
  const trimmed = value.trim();
  return /^[A-Za-z0-9]{8}\d$/.test(trimmed);
}

function cusipToIsin(cusip: string, countryCode: string): string {
  const body = `${countryCode}${cusip.slice(0, 9)}`;
  return `${body}${computeIsinCheckDigit(body)}`;
}

function computeIsinCheckDigit(firstEleven: string): number {
  const digits: number[] = [];
  for (const char of firstEleven) {
    if (/\d/.test(char)) {
      digits.push(Number(char));
    } else if (/[A-Za-z]/.test(char)) {
      const value = char.toUpperCase().charCodeAt(0) - "A".charCodeAt(0) + 10;
      digits.push(Math.floor(value / 10), value % 10);
    }
  }
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    let value = digits[digits.length - 1 - index] ?? 0;
    if (index % 2 === 0) {
      value *= 2;
      if (value > 9) {
        value -= 9;
      }
    }
    sum += value;
  }
  return (10 - (sum % 10)) % 10;
}

function serializeJsonValue(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
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

function exchangeNameMetadata(lookup: AssetServiceOptions["exchangeNameByMic"]): ExchangeMetadata {
  return {
    nameByMic: normalizeExchangeLookup(lookup),
    currencyByMic: new Map(),
    yahooSuffixToMic: new Map(),
  };
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

function boolToInt(value: boolean): number {
  return value ? 1 : 0;
}

function timestampNow(): string {
  return new Date().toISOString();
}

function hasDefined<T extends object, K extends keyof T>(
  value: T,
  key: K,
): value is T & Record<K, Exclude<T[K], undefined>> {
  return Object.prototype.hasOwnProperty.call(value, key) && value[key] !== undefined;
}

function firstDefined<T>(...values: Array<T | null | undefined>): T | null {
  for (const value of values) {
    if (value !== null && value !== undefined) {
      return value;
    }
  }
  return null;
}
