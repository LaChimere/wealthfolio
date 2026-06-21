import type { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { STATUS_CODES } from "node:http";
import { join } from "node:path";

import type { BackendEventBus } from "../events";
import type { SecretService } from "./secrets";
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
  enrichAssets(assetIds: string[]): Promise<AssetEnrichmentResult> | AssetEnrichmentResult;
  deleteAsset(assetId: string): Promise<void> | void;
}

export interface AssetEnrichmentResult {
  enriched: number;
  skipped: number;
  failed: number;
}

export interface AssetServiceOptions {
  eventBus?: BackendEventBus;
  exchangeMetadata?: ExchangeMetadata;
  exchangeNameByMic?: ReadonlyMap<string, string> | Record<string, string>;
  fetch?: typeof fetch;
  fetchTreasuryBondDetails?: (
    isin: string,
  ) => Promise<TreasuryBondDetails | null> | TreasuryBondDetails | null;
  now?: () => string;
  queueSyncEvent?: (event: AssetSyncEvent) => void;
  secretService?: SecretService;
  taxonomyService?: Pick<TaxonomyService, "assignAssetToCategory">;
  warn?: (message: string) => void;
}

export interface TreasuryBondDetails {
  couponRate: number;
  maturityDate: string;
  faceValue: number;
  couponFrequency: string;
}

interface AssetProviderProfile {
  source: string;
  name?: string;
  assetType?: string;
  quoteCcy?: string;
  notes?: string;
  countries?: string;
  sectors?: string;
  industry?: string;
  url?: string;
  marketCap?: number;
  peRatio?: number;
  dividendYield?: number;
  week52High?: number;
  week52Low?: number;
}

interface FixtureCatalog {
  instruments?: FixtureInstrument[];
}

interface FixtureInstrument {
  symbol: string;
  aliases?: string[];
  name: string;
  provider?: string;
  assetType?: string;
  currency?: string;
  sector?: string;
  industry?: string;
  website?: string;
  country?: string;
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
  alphaVantageSuffixByMic: ReadonlyMap<string, string>;
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
const ALPHA_VANTAGE_PROVIDER = "ALPHA_VANTAGE";
const ALPHA_VANTAGE_BASE_URL = "https://www.alphavantage.co/query";
const BOERSE_FRANKFURT_PROVIDER = "BOERSE_FRANKFURT";
const BOERSE_FRANKFURT_BASE_URL = "https://api.live.deutsche-boerse.com/v1";
const BOERSE_FRANKFURT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const FINNHUB_PROVIDER = "FINNHUB";
const FINNHUB_BASE_URL = "https://finnhub.io/api/v1";
const OPENFIGI_PROVIDER = "OPENFIGI";
const OPENFIGI_MAPPING_URL = "https://api.openfigi.com/v3/mapping";
const yahooCrumbCache = new WeakMap<typeof fetch, { cookie: string; crumb: string }>();

export function createAssetService(db: Database, options: AssetServiceOptions = {}): AssetService {
  const exchangeMetadata =
    options.exchangeMetadata ?? exchangeNameMetadata(options.exchangeNameByMic);
  const quoteSyncStateExists = tableExists(db, "quote_sync_state");
  const quoteSyncProfileColumnExists =
    quoteSyncStateExists && columnExists(db, "quote_sync_state", "profile_enriched_at");

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
          .query<AssetRow, [string, string, string]>(
            `
              UPDATE assets
              SET quote_mode = ?, updated_at = ?
              WHERE id = ?
              RETURNING *
            `,
          )
          .get(normalizedQuoteMode, timestampNow(), assetId);
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

    async enrichAssets(assetIds) {
      return enrichAssets(db, assetIds, options, quoteSyncProfileColumnExists, exchangeMetadata);
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
  const alphaVantageSuffixByMic = new Map<string, string>();
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
    if (isRecord(entry.alpha_vantage) && typeof entry.alpha_vantage.suffix === "string") {
      const suffix = entry.alpha_vantage.suffix.trim();
      if (suffix) {
        alphaVantageSuffixByMic.set(mic, suffix);
      }
    }
  }
  return { nameByMic, currencyByMic, yahooSuffixToMic, alphaVantageSuffixByMic };
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

async function enrichAssets(
  db: Database,
  assetIds: string[],
  options: AssetServiceOptions,
  quoteSyncProfileColumnExists: boolean,
  exchangeMetadata: ExchangeMetadata,
): Promise<AssetEnrichmentResult> {
  const uniqueAssetIds = Array.from(new Set(assetIds));
  let enriched = 0;
  let skipped = 0;
  let failed = 0;

  for (const assetId of uniqueAssetIds) {
    if (!needsProfileEnrichment(db, assetId, quoteSyncProfileColumnExists)) {
      skipped += 1;
      continue;
    }

    try {
      const result = await enrichAssetProfile(
        db,
        assetId,
        options,
        quoteSyncProfileColumnExists,
        exchangeMetadata,
      );
      if (result === "enriched") {
        enriched += 1;
      } else {
        skipped += 1;
      }
    } catch (error) {
      failed += 1;
      options.warn?.(`Failed to enrich asset ${assetId}: ${errorMessage(error)}`);
    }
  }

  return { enriched, skipped, failed };
}

async function enrichAssetProfile(
  db: Database,
  assetId: string,
  options: AssetServiceOptions,
  quoteSyncProfileColumnExists: boolean,
  exchangeMetadata: ExchangeMetadata,
): Promise<"enriched" | "skipped"> {
  const asset = readAssetRow(db, assetId);
  if (asset.quote_mode !== "MARKET") {
    markProfileEnriched(db, assetId, options, quoteSyncProfileColumnExists);
    return "enriched";
  }

  const profile = await fetchAssetProviderProfile(asset, options);
  const shouldEnrichTreasuryBond = isUsTreasuryBondNeedingDetails(asset);
  if (!profile && !shouldEnrichTreasuryBond) {
    return "skipped";
  }

  const bondDetails = shouldEnrichTreasuryBond
    ? await fetchTreasuryBondDetails(asset.instrument_symbol?.toUpperCase() ?? "", options)
    : null;
  if (!profile && !bondDetails) {
    return "skipped";
  }

  const updated = updateEnrichedAssetProfile(db, asset, options, profile, bondDetails);
  const updatedAsset = rowToAsset(updated, exchangeMetadata.nameByMic);
  const classification = profile
    ? classifyProviderProfileAsset(options, updatedAsset, updated, profile)
    : classifyCreatedAsset(options, updatedAsset);
  if (classification) {
    await classification;
  }
  markProfileEnriched(db, assetId, options, quoteSyncProfileColumnExists);
  return "enriched";
}

async function fetchAssetProviderProfile(
  asset: AssetRow,
  options: AssetServiceOptions,
): Promise<AssetProviderProfile | null> {
  const provider = preferredProviderId(asset.provider_config);
  if (shouldFetchAlphaVantageProfile(asset, provider)) {
    return fetchAlphaVantageProfile(asset, options);
  }
  if (shouldFetchBoerseProfile(asset, provider)) {
    return fetchBoerseProfile(asset, options.fetch ?? fetch);
  }
  if (shouldFetchOpenFigiProfile(asset, provider)) {
    return fetchOpenFigiBondProfile(openFigiProfileSymbol(asset), options.fetch ?? fetch);
  }
  if (shouldFetchFinnhubProfile(asset, provider)) {
    return fetchFinnhubProfile(asset, options);
  }
  if (!shouldFetchYahooProfile(provider)) {
    return null;
  }
  const symbol = yahooProfileSymbol(asset, options);
  if (!symbol) {
    return null;
  }
  return fetchYahooProfile(symbol, options.fetch ?? fetch);
}

function shouldFetchYahooProfile(provider: string | null): boolean {
  return provider === null || provider === "YAHOO";
}

function shouldFetchOpenFigiProfile(asset: AssetRow, provider: string | null): boolean {
  return (provider === null || provider === OPENFIGI_PROVIDER) && asset.instrument_type === "BOND";
}

function shouldFetchAlphaVantageProfile(asset: AssetRow, provider: string | null): boolean {
  return provider === ALPHA_VANTAGE_PROVIDER && asset.instrument_type === "EQUITY";
}

function openFigiProfileSymbol(asset: AssetRow): string {
  return (
    providerOverrideSymbol(asset.provider_config, OPENFIGI_PROVIDER) ??
    metadataIdentifier(asset.metadata, "isin") ??
    asset.instrument_symbol?.trim() ??
    ""
  );
}

function shouldFetchBoerseProfile(asset: AssetRow, provider: string | null): boolean {
  return (
    provider === BOERSE_FRANKFURT_PROVIDER &&
    (asset.instrument_type === "EQUITY" || asset.instrument_type === "BOND")
  );
}

function shouldFetchFinnhubProfile(asset: AssetRow, provider: string | null): boolean {
  return provider === FINNHUB_PROVIDER && asset.instrument_type === "EQUITY";
}

function yahooProfileSymbol(asset: AssetRow, options: AssetServiceOptions): string | null {
  const symbol = asset.instrument_symbol?.trim();
  if (!symbol) {
    return null;
  }
  if (asset.instrument_type === null) {
    return symbol;
  }
  switch (asset.instrument_type) {
    case "CRYPTO":
      return asset.quote_ccy ? `${symbol}-${asset.quote_ccy}` : null;
    case "FX":
      return asset.quote_ccy ? `${symbol}${asset.quote_ccy}=X` : null;
    case "EQUITY":
    case "OPTION":
    case "METAL": {
      const suffix = yahooSuffixForMic(asset.instrument_exchange_mic, options);
      return suffix ? `${symbol}.${suffix}` : symbol;
    }
    default:
      return null;
  }
}

function yahooSuffixForMic(mic: string | null, options: AssetServiceOptions): string | null {
  if (!mic) {
    return null;
  }
  const exchangeMetadata =
    options.exchangeMetadata ?? exchangeNameMetadata(options.exchangeNameByMic);
  const normalizedMic = mic.toUpperCase();
  for (const [suffix, suffixMic] of exchangeMetadata.yahooSuffixToMic.entries()) {
    if (suffixMic.toUpperCase() === normalizedMic) {
      return suffix;
    }
  }
  return null;
}

function alphaVantageProfileSymbol(asset: AssetRow, options: AssetServiceOptions): string | null {
  const override = providerOverrideSymbol(asset.provider_config, ALPHA_VANTAGE_PROVIDER);
  if (override) {
    return override;
  }
  const symbol = optionalString(asset.instrument_symbol)?.toUpperCase();
  if (!symbol) {
    return null;
  }
  const mic = optionalString(asset.instrument_exchange_mic)?.toUpperCase();
  if (!mic) {
    return symbol;
  }
  const exchangeMetadata =
    options.exchangeMetadata ?? exchangeNameMetadata(options.exchangeNameByMic);
  const suffix = exchangeMetadata.alphaVantageSuffixByMic.get(mic);
  return suffix ? `${symbol}${suffix}` : symbol;
}

async function fetchYahooSearchProfile(
  symbol: string,
  fetchImpl: typeof fetch,
): Promise<AssetProviderProfile> {
  const query2Profile = await fetchYahooSearchProfileFromEndpoint(
    "https://query2.finance.yahoo.com/v1/finance/search",
    symbol,
    fetchImpl,
  ).catch(() => null);
  if (query2Profile) {
    return query2Profile;
  }
  const query1Profile = await fetchYahooSearchProfileFromEndpoint(
    "https://query1.finance.yahoo.com/v1/finance/search",
    symbol,
    fetchImpl,
  );
  if (!query1Profile) {
    throw new Error(`Symbol not found: ${symbol}`);
  }
  return query1Profile;
}

async function fetchAlphaVantageProfile(
  asset: AssetRow,
  options: AssetServiceOptions,
): Promise<AssetProviderProfile | null> {
  const apiKey = await providerApiKey(options.secretService, ALPHA_VANTAGE_PROVIDER);
  const symbol = alphaVantageProfileSymbol(asset, options);
  if (!apiKey || !symbol) {
    return null;
  }
  const overviewPayload = await fetchAlphaVantageJson(
    [
      ["function", "OVERVIEW"],
      ["symbol", symbol],
    ],
    options.fetch ?? fetch,
    apiKey,
  );
  let profile = alphaVantageOverviewProfile(overviewPayload, symbol);
  if (profile.assetType === "ETF" || profile.assetType === "MUTUALFUND") {
    try {
      const etfPayload = await fetchAlphaVantageJson(
        [
          ["function", "ETF_PROFILE"],
          ["symbol", symbol],
        ],
        options.fetch ?? fetch,
        apiKey,
      );
      const etfProfile = alphaVantageEtfProfile(etfPayload, symbol);
      profile = {
        ...profile,
        sectors: etfProfile.sectors ?? profile.sectors,
        dividendYield: etfProfile.dividendYield ?? profile.dividendYield,
      };
    } catch (error) {
      options.warn?.(
        `Alpha Vantage ETF_PROFILE failed for ${symbol}, using OVERVIEW only: ${errorMessage(error)}`,
      );
    }
  }
  return profile;
}

async function fetchAlphaVantageJson(
  params: Array<[string, string]>,
  fetchImpl: typeof fetch,
  apiKey: string,
): Promise<unknown> {
  const url = new URL(ALPHA_VANTAGE_BASE_URL);
  for (const [key, value] of params) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("apikey", apiKey);
  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch (error) {
    throw new Error(`${ALPHA_VANTAGE_PROVIDER}: Request failed: ${errorMessage(error)}`);
  }
  if (response.status === 429) {
    throw new Error(`${ALPHA_VANTAGE_PROVIDER}: rate limited`);
  }
  if (!response.ok) {
    throw new Error(`${ALPHA_VANTAGE_PROVIDER}: HTTP ${formatRustHttpStatus(response.status)}`);
  }
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`${ALPHA_VANTAGE_PROVIDER}: Failed to parse response: ${errorMessage(error)}`);
  }
}

function alphaVantageOverviewProfile(payload: unknown, symbol: string): AssetProviderProfile {
  if (!isRecord(payload)) {
    throw new Error(`${ALPHA_VANTAGE_PROVIDER}: Failed to parse company overview response`);
  }
  checkAlphaVantageApiError(payload);
  if (optionalString(payload.Information)?.includes("demo") || !optionalString(payload.Symbol)) {
    throw new Error(`${ALPHA_VANTAGE_PROVIDER}: No company overview data for symbol: ${symbol}`);
  }

  const profile: AssetProviderProfile = {
    source: ALPHA_VANTAGE_PROVIDER,
  };
  const assetType = alphaVantageAssetType(optionalString(payload.AssetType));
  if (assetType) {
    profile.assetType = assetType;
  }
  const name = optionalString(payload.Name);
  if (name) {
    profile.name = name;
  }
  const sector = optionalString(payload.Sector);
  if (sector) {
    profile.sectors = weightedProfileJson(sector, 1);
  }
  const industry = optionalString(payload.Industry);
  if (industry) {
    profile.industry = industry;
  }
  const country = optionalString(payload.Country);
  if (country) {
    profile.countries = weightedProfileJson(country, 1);
  }
  const description = optionalString(payload.Description);
  if (description) {
    profile.notes = description;
  }
  const marketCap = alphaVantageNumber(payload.MarketCapitalization);
  if (marketCap !== null) {
    profile.marketCap = marketCap;
  }
  const peRatio = alphaVantageNumber(payload.PERatio) ?? alphaVantageNumber(payload.TrailingPE);
  if (peRatio !== null) {
    profile.peRatio = peRatio;
  }
  const dividendYield = alphaVantageNumber(payload.DividendYield);
  if (dividendYield !== null) {
    profile.dividendYield = dividendYield;
  }
  const week52High = alphaVantageNumber(payload["52WeekHigh"]);
  if (week52High !== null) {
    profile.week52High = week52High;
  }
  const week52Low = alphaVantageNumber(payload["52WeekLow"]);
  if (week52Low !== null) {
    profile.week52Low = week52Low;
  }
  return profile;
}

function alphaVantageEtfProfile(payload: unknown, symbol: string): Partial<AssetProviderProfile> {
  if (!isRecord(payload)) {
    throw new Error(`${ALPHA_VANTAGE_PROVIDER}: Failed to parse ETF profile response`);
  }
  checkAlphaVantageApiError(payload);
  const sectorsPayload = payload.sectors;
  if (!Array.isArray(sectorsPayload) || sectorsPayload.length === 0) {
    throw new Error(`${ALPHA_VANTAGE_PROVIDER}: No ETF profile data for symbol: ${symbol}`);
  }
  const sectors: Array<{ name: string; weight: number }> = [];
  for (const sectorPayload of sectorsPayload) {
    if (!isRecord(sectorPayload)) {
      continue;
    }
    const name = optionalString(sectorPayload.sector);
    const weight = alphaVantageWeight(sectorPayload.weight);
    if (name && weight !== null) {
      sectors.push({ name, weight });
    }
  }
  return {
    sectors: sectors.length > 0 ? JSON.stringify(sectors) : undefined,
    dividendYield: alphaVantageWeight(payload.dividend_yield) ?? undefined,
  };
}

function checkAlphaVantageApiError(payload: Record<string, unknown>): void {
  const apiError = optionalString(payload["Error Message"]);
  if (apiError) {
    if (apiError.includes("Invalid API call") || apiError.includes("not found")) {
      throw new Error(`Symbol not found: ${apiError}`);
    }
    throw new Error(`${ALPHA_VANTAGE_PROVIDER}: ${apiError}`);
  }
  for (const key of ["Note", "Information"]) {
    const message = optionalString(payload[key]);
    if (message && alphaVantageRateLimitedMessage(message)) {
      throw new Error(`${ALPHA_VANTAGE_PROVIDER}: rate limited`);
    }
  }
}

function alphaVantageAssetType(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  const upper = value.toUpperCase();
  switch (upper) {
    case "COMMON STOCK":
      return "EQUITY";
    case "MUTUAL FUND":
      return "MUTUALFUND";
    default:
      return upper;
  }
}

function alphaVantageNumber(value: unknown): number | null {
  const text = optionalString(value);
  if (!text || text === "None" || text === "-" || text === "0") {
    return null;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function alphaVantageWeight(value: unknown): number | null {
  const text = optionalString(value);
  if (!text) {
    return null;
  }
  const parsed = text.endsWith("%") ? Number(text.slice(0, -1)) / 100 : Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function alphaVantageRateLimitedMessage(message: string): boolean {
  return message.includes("API call frequency") || message.includes("rate limit");
}

async function fetchOpenFigiBondProfile(
  isin: string,
  fetchImpl: typeof fetch,
): Promise<AssetProviderProfile> {
  if (!isin) {
    throw new Error(`${OPENFIGI_PROVIDER}: Symbol not found`);
  }
  const payload = await fetchOpenFigiMapping(isin, fetchImpl);
  const first = payload[0];
  if (!isRecord(first)) {
    throw new Error(`${OPENFIGI_PROVIDER}: Symbol not found: ${isin}`);
  }
  const name = optionalString(first.name);
  if (!name) {
    throw new Error(`${OPENFIGI_PROVIDER}: No name found for ${isin}`);
  }
  const ticker = optionalString(first.ticker);
  return {
    source: OPENFIGI_PROVIDER,
    name: ticker ? `${name} - ${ticker}` : name,
  };
}

async function fetchOpenFigiMapping(
  isin: string,
  fetchImpl: typeof fetch,
): Promise<Record<string, unknown>[]> {
  let response: Response;
  try {
    response = await fetchImpl(OPENFIGI_MAPPING_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ idType: "ID_ISIN", idValue: isin }]),
    });
  } catch (error) {
    throw new Error(`${OPENFIGI_PROVIDER}: HTTP request failed: ${errorMessage(error)}`);
  }
  if (!response.ok) {
    throw new Error(`${OPENFIGI_PROVIDER}: HTTP ${formatRustHttpStatus(response.status)}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error(`${OPENFIGI_PROVIDER}: JSON parse error: ${errorMessage(error)}`);
  }
  if (!Array.isArray(payload)) {
    throw new Error(`${OPENFIGI_PROVIDER}: JSON parse error`);
  }
  const first = payload[0];
  if (!isRecord(first) || !Array.isArray(first.data)) {
    return [];
  }
  return first.data.filter(isRecord);
}

async function fetchBoerseProfile(
  asset: AssetRow,
  fetchImpl: typeof fetch,
): Promise<AssetProviderProfile> {
  const identity = boerseProfileIdentity(asset);
  const isin = await resolveBoerseProfileIsin(identity.symbol, identity.mic, fetchImpl);
  const url = new URL(`${BOERSE_FRANKFURT_BASE_URL}/tradingview/symbols`);
  url.searchParams.set("symbol", `${identity.mic}:${isin}`);
  const payload = await fetchBoerseJson(url, fetchImpl);
  if (!isRecord(payload)) {
    throw new Error(`${BOERSE_FRANKFURT_PROVIDER}: invalid profile response`);
  }
  const name = optionalString(payload.description);
  if (!name) {
    throw new Error(`${BOERSE_FRANKFURT_PROVIDER}: No name found for ${isin}`);
  }
  return { source: BOERSE_FRANKFURT_PROVIDER, name };
}

function boerseProfileIdentity(asset: AssetRow): { mic: string; symbol: string } {
  if (asset.instrument_type === "BOND") {
    const symbol =
      providerOverrideSymbol(asset.provider_config, BOERSE_FRANKFURT_PROVIDER) ??
      metadataIdentifier(asset.metadata, "isin") ??
      asset.instrument_symbol;
    if (!symbol) {
      throw new Error("Bond has no ISIN");
    }
    return parseBoerseMicSymbol(symbol, "XFRA");
  }
  if (asset.instrument_type === "EQUITY") {
    const symbol =
      providerOverrideSymbol(asset.provider_config, BOERSE_FRANKFURT_PROVIDER) ??
      asset.instrument_symbol;
    if (!symbol) {
      throw new Error("Asset cannot be mapped to a Boerse Frankfurt symbol");
    }
    return parseBoerseMicSymbol(symbol, asset.instrument_exchange_mic ?? "XETR");
  }
  throw new Error(`Boerse Frankfurt does not support ${asset.instrument_type ?? "unknown"} assets`);
}

async function resolveBoerseProfileIsin(
  symbol: string,
  mic: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const trimmedSymbol = symbol.trim();
  if (looksLikeIsin(trimmedSymbol)) {
    return trimmedSymbol;
  }

  const url = new URL(`${BOERSE_FRANKFURT_BASE_URL}/tradingview/search`);
  url.searchParams.set("query", trimmedSymbol);
  url.searchParams.set("limit", "5");
  const payload = await fetchBoerseJson(url, fetchImpl, "Search returned HTTP ");
  if (!Array.isArray(payload)) {
    throw new Error(`${BOERSE_FRANKFURT_PROVIDER}: Search JSON parse error`);
  }
  for (const item of payload) {
    if (!isRecord(item)) {
      continue;
    }
    const instrumentType = optionalString(item.type);
    const rawResultSymbol = optionalString(item.symbol);
    if (!instrumentType || !rawResultSymbol || !boerseSupportedGermanType(instrumentType)) {
      continue;
    }
    const [resultMic, resultIsin] = splitBoerseMicSymbol(rawResultSymbol);
    if (resultMic === mic && resultIsin) {
      return resultIsin;
    }
  }
  throw new Error(`Symbol not found: ${trimmedSymbol}@${mic}`);
}

async function fetchBoerseJson(
  url: URL,
  fetchImpl: typeof fetch,
  httpStatusPrefix = "HTTP ",
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { "User-Agent": BOERSE_FRANKFURT_USER_AGENT },
    });
  } catch (error) {
    throw new Error(`${BOERSE_FRANKFURT_PROVIDER}: HTTP request failed: ${errorMessage(error)}`);
  }
  if (!response.ok) {
    throw new Error(
      `${BOERSE_FRANKFURT_PROVIDER}: ${httpStatusPrefix}${formatRustHttpStatus(response.status)}`,
    );
  }
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${BOERSE_FRANKFURT_PROVIDER}: JSON parse error: ${errorMessage(error)}`);
  }
}

function parseBoerseMicSymbol(value: string, fallbackMic: string): { mic: string; symbol: string } {
  const trimmed = value.trim();
  const [mic, symbol] = splitBoerseMicSymbol(trimmed);
  if (mic && symbol) {
    return { mic, symbol };
  }
  return { mic: fallbackMic.trim().toUpperCase() || "XETR", symbol: trimmed };
}

function splitBoerseMicSymbol(value: string): [string | null, string | null] {
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) {
    return [null, null];
  }
  return [value.slice(0, separator).trim().toUpperCase(), value.slice(separator + 1).trim()];
}

function boerseSupportedGermanType(value: string): boolean {
  return value === "Aktie" || value === "ETP" || value === "Anleihe" || value === "Fonds";
}

async function fetchFinnhubProfile(
  asset: AssetRow,
  options: AssetServiceOptions,
): Promise<AssetProviderProfile | null> {
  const apiKey = await providerApiKey(options.secretService, FINNHUB_PROVIDER);
  const symbol =
    providerOverrideSymbol(asset.provider_config, FINNHUB_PROVIDER) ??
    optionalString(asset.instrument_symbol);
  if (!apiKey || !symbol) {
    return null;
  }

  const payload = await fetchFinnhubJson(
    "/stock/profile2",
    [["symbol", symbol]],
    options.fetch ?? fetch,
    apiKey,
  );
  if (!isRecord(payload) || Object.keys(payload).length === 0) {
    return null;
  }
  const name = optionalString(payload.name);
  const ticker = optionalString(payload.ticker);
  if (!name && !ticker) {
    return null;
  }

  const profile: AssetProviderProfile = {
    source: FINNHUB_PROVIDER,
    assetType: "EQUITY",
  };
  if (name) {
    profile.name = name;
  }
  const industry = optionalString(payload.finnhubIndustry);
  if (industry) {
    profile.sectors = weightedProfileJson(industry, 1);
    profile.industry = industry;
  }
  const country = optionalString(payload.country);
  if (country) {
    profile.countries = weightedProfileJson(country, 1);
  }
  const webUrl = optionalString(payload.weburl);
  if (webUrl) {
    profile.url = webUrl;
  }
  const description = optionalString(payload.description);
  if (description) {
    profile.notes = description;
  }
  const marketCapitalization = decimalNumber(payload.marketCapitalization);
  if (marketCapitalization !== null) {
    profile.marketCap = marketCapitalization * 1_000_000;
  }
  return profile;
}

async function fetchFinnhubJson(
  endpoint: string,
  params: Array<[string, string]>,
  fetchImpl: typeof fetch,
  apiKey: string,
): Promise<unknown> {
  const url = new URL(`${FINNHUB_BASE_URL}${endpoint}`);
  for (const [key, value] of params) {
    url.searchParams.set(key, value);
  }
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { "X-Finnhub-Token": apiKey } });
  } catch (error) {
    throw new Error(`${FINNHUB_PROVIDER}: Request failed: ${errorMessage(error)}`);
  }
  if (response.status === 429) {
    throw new Error(`${FINNHUB_PROVIDER}: rate limited`);
  }
  if (response.status === 401) {
    throw new Error(`${FINNHUB_PROVIDER}: Invalid or missing API key`);
  }
  const text = await response.text();
  if (response.status === 403) {
    throw new Error(`${FINNHUB_PROVIDER}: Access forbidden - check API key: ${text}`);
  }
  if (!response.ok) {
    const parsedError = parseFinnhubError(text);
    throw new Error(
      `${FINNHUB_PROVIDER}: ${parsedError ?? `HTTP ${formatRustHttpStatus(response.status)} - ${text}`}`,
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`${FINNHUB_PROVIDER}: Failed to parse response: ${errorMessage(error)}`);
  }
}

function parseFinnhubError(text: string): string | null {
  const parsed = parseJsonValue(text);
  if (!isRecord(parsed)) {
    return null;
  }
  return optionalString(parsed.error);
}

async function fetchYahooSearchProfileFromEndpoint(
  endpoint: string,
  symbol: string,
  fetchImpl: typeof fetch,
): Promise<AssetProviderProfile | null> {
  const response = await fetchImpl(`${endpoint}?q=${encodeURIComponent(symbol)}`, {
    headers: yahooHeaders(),
  });
  if (!response.ok) {
    throw new Error(`YAHOO: HTTP ${formatRustHttpStatus(response.status)}`);
  }
  const payload = (await response.json()) as unknown;
  if (!isRecord(payload) || !Array.isArray(payload.quotes)) {
    return null;
  }
  const quote = payload.quotes.find((item): item is Record<string, unknown> => {
    return isRecord(item) && item.symbol === symbol;
  });
  if (!quote) {
    return null;
  }
  const assetType = optionalString(quote.quoteType)?.toUpperCase();
  const name =
    optionalString(quote.longname) ??
    optionalString(quote.shortname) ??
    optionalString(quote.symbol);
  return {
    source: "YAHOO",
    ...(name ? { name } : {}),
    ...(assetType ? { assetType } : {}),
  };
}

async function fetchTreasuryBondDetails(
  isin: string,
  options: AssetServiceOptions,
): Promise<TreasuryBondDetails | null> {
  const fetchBondDetails =
    options.fetchTreasuryBondDetails ??
    ((value: string) => fetchUsTreasuryBondDetails(value, options.fetch));
  const details = await fetchBondDetails(isin);
  if (!details) {
    return null;
  }
  if (!validTreasuryBondDetails(details)) {
    options.warn?.(`Ignoring invalid Treasury bond details for ${isin}`);
    return null;
  }
  return details;
}

function validTreasuryBondDetails(details: TreasuryBondDetails): boolean {
  return (
    Number.isFinite(details.couponRate) &&
    Number.isFinite(details.faceValue) &&
    isIsoDate(details.maturityDate)
  );
}

function needsProfileEnrichment(
  db: Database,
  assetId: string,
  quoteSyncProfileColumnExists: boolean,
): boolean {
  if (!quoteSyncProfileColumnExists) {
    return true;
  }
  const state = db
    .query<
      { profile_enriched_at: string | null },
      [string]
    >("SELECT profile_enriched_at FROM quote_sync_state WHERE asset_id = ?")
    .get(assetId);
  return !state || state.profile_enriched_at === null;
}

function markProfileEnriched(
  db: Database,
  assetId: string,
  options: AssetServiceOptions,
  quoteSyncProfileColumnExists: boolean,
): void {
  if (!quoteSyncProfileColumnExists) {
    return;
  }
  const now = currentTimestamp(options);
  db.query(
    `
      UPDATE quote_sync_state
      SET profile_enriched_at = ?, updated_at = ?
      WHERE asset_id = ?
    `,
  ).run(now, now, assetId);
}

function isUsTreasuryBondNeedingDetails(asset: AssetRow): boolean {
  const isin = asset.instrument_symbol?.toUpperCase();
  if (asset.instrument_type !== "BOND" || !isin?.startsWith("US912")) {
    return false;
  }
  const metadata = parseJsonValue(asset.metadata);
  if (!isRecord(metadata) || !isRecord(metadata.bond)) {
    return true;
  }
  return typeof metadata.bond.maturityDate !== "string" || !isIsoDate(metadata.bond.maturityDate);
}

function updateEnrichedAssetProfile(
  db: Database,
  asset: AssetRow,
  options: AssetServiceOptions,
  profile: AssetProviderProfile | null,
  bondDetails: TreasuryBondDetails | null,
): AssetRow {
  const metadata = parseJsonValue(asset.metadata);
  const metadataObject = isRecord(metadata) ? { ...metadata } : {};
  let metadataChanged = false;
  if (profile) {
    metadataChanged = mergeProviderProfileMetadata(metadataObject, profile);
  }
  if (bondDetails) {
    const existingBond = isRecord(metadataObject.bond) ? metadataObject.bond : {};
    metadataObject.bond = {
      ...existingBond,
      isin: asset.instrument_symbol?.toUpperCase(),
      couponRate: bondDetails.couponRate,
      maturityDate: bondDetails.maturityDate,
      faceValue: bondDetails.faceValue,
      couponFrequency: normalizeCouponFrequency(bondDetails.couponFrequency),
    };
    metadataChanged = true;
  }

  const instrumentType =
    asset.instrument_type ??
    (profile?.assetType ? instrumentTypeFromProvider(profile.assetType) : null);
  const notes =
    (asset.notes === null || asset.notes.trim() === "") && profile?.notes
      ? profile.notes
      : asset.notes;
  const quoteCcy = profile?.quoteCcy ?? asset.quote_ccy;
  const updated = db
    .query<
      AssetRow,
      [string | null, string | null, string | null, string | null, string, string, string]
    >(
      `
        UPDATE assets
        SET name = ?, notes = ?, metadata = ?, instrument_type = ?, quote_ccy = ?, updated_at = ?
        WHERE id = ?
        RETURNING *
      `,
    )
    .get(
      profile?.name ?? asset.name,
      notes,
      metadataChanged ? serializeJsonValue(metadataObject) : asset.metadata,
      instrumentType,
      quoteCcy,
      currentTimestamp(options),
      asset.id,
    );
  if (!updated) {
    throw new Error(`Record not found: asset ${asset.id}`);
  }
  queueAssetSyncEvent(options, updated, "Update");
  return updated;
}

function mergeProviderProfileMetadata(
  metadataObject: Record<string, unknown>,
  profile: AssetProviderProfile,
): boolean {
  const profileMetadata: Record<string, unknown> = {};
  if (profile.sectors) {
    profileMetadata.sectors = profile.sectors;
  }
  if (profile.industry) {
    profileMetadata.industry = profile.industry;
  }
  if (profile.countries) {
    profileMetadata.countries = profile.countries;
  }
  if (profile.assetType) {
    profileMetadata.quoteType = profile.assetType;
  }
  if (profile.url) {
    profileMetadata.website = profile.url;
  }
  if (profile.marketCap !== undefined) {
    profileMetadata.marketCap = profile.marketCap;
  }
  if (profile.peRatio !== undefined) {
    profileMetadata.peRatio = profile.peRatio;
  }
  if (profile.dividendYield !== undefined) {
    profileMetadata.dividendYield = profile.dividendYield;
  }
  if (profile.week52High !== undefined) {
    profileMetadata.week52High = profile.week52High;
  }
  if (profile.week52Low !== undefined) {
    profileMetadata.week52Low = profile.week52Low;
  }
  if (Object.keys(profileMetadata).length > 0) {
    metadataObject.profile = profileMetadata;
    return true;
  }
  return false;
}

async function fetchUsTreasuryBondDetails(
  isin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TreasuryBondDetails | null> {
  if (!isin.startsWith("US912") || isin.length < 11) {
    return null;
  }
  const cusip = isin.slice(2, 11);
  let response: Response;
  try {
    response = await fetchImpl(
      `https://www.treasurydirect.gov/TA_WS/securities/search?cusip=${encodeURIComponent(cusip)}&format=json`,
    );
  } catch {
    return null;
  }
  if (!response.ok) {
    return null;
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }
  if (!Array.isArray(body) || !isRecord(body[0])) {
    return null;
  }
  const item = body[0];
  const maturityDate = stringPrefix(item.maturityDate, 10);
  if (!maturityDate || !isIsoDate(maturityDate)) {
    return null;
  }
  const couponRate = decimalNumber(item.interestRate);
  const normalizedCouponRate = couponRate === null ? 0 : couponRate / 100;
  const rawFrequency =
    typeof item.interestPaymentFrequency === "string" ? item.interestPaymentFrequency : "";

  return {
    couponRate: normalizedCouponRate,
    maturityDate,
    faceValue: 1000,
    couponFrequency:
      rawFrequency.trim() !== "" && rawFrequency !== "None"
        ? normalizeCouponFrequency(rawFrequency)
        : normalizedCouponRate === 0
          ? "ZERO"
          : "SEMI_ANNUAL",
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
  return classifyCreatedAssetAsync(
    options.taxonomyService,
    assignments,
    options.warn,
    "Initial classification",
  );
}

function classifyProviderProfileAsset(
  options: AssetServiceOptions,
  asset: Asset,
  row: AssetRow,
  profile: AssetProviderProfile,
): Promise<void> | undefined {
  if (!options.taxonomyService) {
    return undefined;
  }
  const assignments = providerProfileClassificationAssignments(asset, row, profile);
  if (assignments.length === 0) {
    return undefined;
  }
  return classifyCreatedAssetAsync(
    options.taxonomyService,
    assignments,
    options.warn,
    "Auto-classification",
  );
}

async function classifyCreatedAssetAsync(
  taxonomyService: Pick<TaxonomyService, "assignAssetToCategory">,
  assignments: NewAssetTaxonomyAssignment[],
  warn: ((message: string) => void) | undefined,
  label: string,
): Promise<void> {
  for (const assignment of assignments) {
    try {
      await taxonomyService.assignAssetToCategory(assignment);
    } catch (error) {
      warn?.(
        `${label} of asset ${assignment.assetId} ${assignment.taxonomyId} failed: ${errorMessage(error)}`,
      );
    }
  }
}

function providerProfileClassificationAssignments(
  asset: Asset,
  row: AssetRow,
  profile: AssetProviderProfile,
): NewAssetTaxonomyAssignment[] {
  const assignments: NewAssetTaxonomyAssignment[] = [];
  if (profile.assetType) {
    const instrumentTypeCategory = providerQuoteTypeInstrumentCategory(
      profile.assetType,
      profile.name ?? asset.name,
    );
    if (instrumentTypeCategory) {
      assignments.push(taxonomyAssignment(asset.id, "instrument_type", instrumentTypeCategory));
    }

    const assetClassCategory = providerQuoteTypeAssetClass(profile.assetType);
    if (assetClassCategory) {
      assignments.push(taxonomyAssignment(asset.id, "asset_classes", assetClassCategory));
    }
  }

  for (const sector of providerProfileSectors(profile.sectors)) {
    const categoryId = providerSectorGicsCategory(sector.name);
    if (categoryId) {
      assignments.push(
        taxonomyAssignment(
          asset.id,
          "industries_gics",
          categoryId,
          Math.round(sector.weight * 10000),
        ),
      );
    }
  }

  const country =
    providerProfileCountry(profile.countries) ?? countryForMic(row.instrument_exchange_mic);
  const regionCategory = country ? providerCountryRegionCategory(country) : null;
  if (regionCategory) {
    assignments.push(taxonomyAssignment(asset.id, "regions", regionCategory));
  }
  return assignments;
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
  weight = 10000,
): NewAssetTaxonomyAssignment {
  return {
    assetId,
    taxonomyId,
    categoryId,
    weight,
    source: "AUTO",
  };
}

function providerQuoteTypeInstrumentCategory(
  quoteType: string,
  name: string | null | undefined,
): string | null {
  switch (quoteType.trim().toUpperCase()) {
    case "EQUITY":
      return "STOCK_COMMON";
    case "ETF":
    case "INDEX":
      return "ETF";
    case "MUTUALFUND":
    case "MUTUAL FUND":
      return "FUND_MUTUAL";
    case "CRYPTOCURRENCY":
    case "CRYPTO":
      return "CRYPTO_NATIVE";
    case "OPTION":
      return "OPTION";
    case "BOND":
      return name && isGovernmentBondName(name) ? "BOND_GOVERNMENT" : "BOND_CORPORATE";
    case "MONEYMARKET":
      return "MONEY_MARKET_DEBT";
    case "FUTURE":
    case "FUTURES":
      return "FUTURE";
    default:
      return null;
  }
}

function providerQuoteTypeAssetClass(quoteType: string): string | null {
  switch (quoteType.trim().toUpperCase()) {
    case "EQUITY":
    case "ETF":
    case "MUTUALFUND":
    case "MUTUAL FUND":
    case "INDEX":
    case "OPTION":
      return "EQUITY";
    case "BOND":
    case "MONEYMARKET":
      return "FIXED_INCOME";
    case "CURRENCY":
    case "FOREX":
    case "FX":
    case "CASH":
      return "CASH_BANK_DEPOSITS";
    case "CRYPTOCURRENCY":
    case "CRYPTO":
      return "DIGITAL_ASSETS";
    case "COMMODITY":
    case "FUTURE":
    case "FUTURES":
      return "COMMODITIES";
    default:
      return null;
  }
}

function isGovernmentBondName(name: string): boolean {
  const normalized = name.toUpperCase();
  return (
    normalized.includes("TREASURY") ||
    normalized.includes("T-BILL") ||
    normalized.includes("T-NOTE") ||
    normalized.includes("T-BOND") ||
    normalized.includes("GOVT OF CANADA") ||
    normalized.includes("GOVERNMENT OF CANADA") ||
    normalized.includes("CANADA GOVT") ||
    normalized.includes(" GILT") ||
    normalized.includes("BUNDESREPUBLIK") ||
    normalized.includes("BUNDESOBLIGATION") ||
    normalized.includes("OAT ") ||
    normalized.startsWith("OAT ") ||
    normalized.includes("JAPAN GOVT") ||
    normalized.includes("JAPANESE GOVERNMENT") ||
    normalized.includes("SOVEREIGN")
  );
}

function providerProfileSectors(
  value: string | undefined,
): Array<{ name: string; weight: number }> {
  if (!value) {
    return [];
  }
  const parsed = parseWeightedProfileEntries(value);
  return parsed.filter((entry) => entry !== null);
}

function providerProfileCountry(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  return parseWeightedProfileEntries(value)[0]?.name ?? null;
}

function parseWeightedProfileEntries(
  value: string,
): Array<{ name: string; weight: number } | null> {
  const parsed = parseJsonValue(value);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.map((entry) => {
    if (!isRecord(entry) || typeof entry.name !== "string" || typeof entry.weight !== "number") {
      return null;
    }
    if (entry.name.trim() === "" || !Number.isFinite(entry.weight)) {
      return null;
    }
    return { name: entry.name, weight: entry.weight };
  });
}

function providerSectorGicsCategory(sector: string): string | null {
  switch (sector.toLowerCase()) {
    case "energy":
      return "10";
    case "materials":
    case "basic materials":
      return "15";
    case "industrials":
      return "20";
    case "consumer discretionary":
    case "consumer cyclical":
      return "25";
    case "consumer staples":
    case "consumer defensive":
      return "30";
    case "health care":
    case "healthcare":
      return "35";
    case "financials":
    case "financial services":
    case "financial":
      return "40";
    case "information technology":
    case "technology":
      return "45";
    case "communication services":
    case "communication":
    case "telecommunications":
      return "50";
    case "utilities":
      return "55";
    case "real estate":
    case "realestate":
      return "60";
    default:
      return null;
  }
}

function countryForMic(mic: string | null): string | null {
  switch (mic) {
    case "XNYS":
    case "XNAS":
    case "XASE":
    case "ARCX":
    case "BATS":
      return "United States";
    case "XTSE":
    case "XTSX":
    case "XCNQ":
      return "Canada";
    case "XMEX":
      return "Mexico";
    case "XLON":
      return "United Kingdom";
    case "XDUB":
      return "Ireland";
    case "XETR":
    case "XFRA":
    case "XSTU":
    case "XHAM":
    case "XDUS":
    case "XMUN":
    case "XBER":
    case "XHAN":
      return "Germany";
    case "XPAR":
      return "France";
    case "XAMS":
      return "Netherlands";
    case "XBRU":
      return "Belgium";
    case "XLIS":
      return "Portugal";
    case "XMIL":
      return "Italy";
    case "XMAD":
      return "Spain";
    case "XATH":
      return "Greece";
    case "XSTO":
      return "Sweden";
    case "XHEL":
      return "Finland";
    case "XCSE":
      return "Denmark";
    case "XOSL":
      return "Norway";
    case "XSWX":
      return "Switzerland";
    case "XWBO":
      return "Austria";
    case "XWAR":
      return "Poland";
    case "XSHG":
    case "XSHE":
      return "China";
    case "XHKG":
      return "Hong Kong";
    case "XTKS":
      return "Japan";
    case "XKRX":
    case "XKOS":
      return "South Korea";
    case "XSES":
      return "Singapore";
    case "XBOM":
    case "XNSE":
      return "India";
    case "XTAI":
      return "Taiwan";
    case "XASX":
      return "Australia";
    case "XNZE":
      return "New Zealand";
    case "BVMF":
      return "Brazil";
    case "XTAE":
      return "Israel";
    case "XJSE":
      return "South Africa";
    default:
      return null;
  }
}

function providerCountryRegionCategory(country: string): string | null {
  switch (country.toLowerCase()) {
    case "united states":
    case "usa":
    case "us":
      return "country_US";
    case "canada":
      return "country_CA";
    case "japan":
    case "\u65e5\u672c":
      return "country_JP";
    case "china":
    case "\u4e2d\u56fd":
      return "country_CN";
    case "hong kong":
    case "\u9999\u6e2f":
      return "country_HK";
    case "australia":
      return "country_AU";
    case "united kingdom":
    case "uk":
    case "great britain":
    case "england":
    case "germany":
    case "deutschland":
    case "france":
    case "switzerland":
    case "schweiz":
    case "netherlands":
    case "holland":
    case "spain":
    case "espa\u00f1a":
    case "italy":
    case "italia":
    case "sweden":
    case "sverige":
    case "ireland":
    case "belgium":
    case "denmark":
    case "danmark":
    case "norway":
    case "norge":
    case "finland":
    case "suomi":
    case "austria":
    case "\u00f6sterreich":
    case "portugal":
    case "poland":
    case "polska":
    case "greece":
    case "czech republic":
    case "czechia":
    case "russia":
      return "R10";
    case "mexico":
    case "m\u00e9xico":
      return "R2010";
    case "brazil":
    case "brasil":
    case "argentina":
    case "chile":
    case "colombia":
    case "peru":
      return "R2040";
    case "south korea":
    case "korea":
    case "\ub300\ud55c\ubbfc\uad6d":
    case "taiwan":
    case "\u81fa\u7063":
      return "R3030";
    case "singapore":
    case "india":
    case "\u092d\u093e\u0930\u0924":
    case "indonesia":
    case "malaysia":
    case "thailand":
    case "vietnam":
    case "philippines":
      return "R30";
    case "new zealand":
      return "R50";
    case "south africa":
    case "nigeria":
    case "egypt":
      return "R40";
    default:
      return null;
  }
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

const RUST_HTTP_STATUS_REASON_OVERRIDES: Record<number, string> = {
  418: "I'm a teapot",
  509: "<unknown status code>",
};

function formatRustHttpStatus(status: number): string {
  const reason =
    RUST_HTTP_STATUS_REASON_OVERRIDES[status] ?? STATUS_CODES[status] ?? "<unknown status code>";
  return `${status} ${reason}`;
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
  return (
    normalizeRfc3339NaiveTimestamp(trimmed) ??
    normalizeNaiveTimestamp(trimmed) ??
    normalizeRfc3339NaiveTimestamp(timestampNow()) ??
    timestampNow()
  );
}

function normalizeRfc3339NaiveTimestamp(value: string): string | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?([Zz]|([+-])(\d{2}):(\d{2}))$/u.exec(
      value,
    );
  if (!match) {
    return null;
  }
  const [
    ,
    yearRaw,
    monthRaw,
    dayRaw,
    hourRaw,
    minuteRaw,
    secondRaw,
    fractionRaw,
    zoneRaw,
    signRaw,
    zoneHourRaw,
    zoneMinuteRaw,
  ] = match;
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const second = Number(secondRaw);
  const millisecond = Number((fractionRaw ?? "").padEnd(3, "0").slice(0, 3));
  const zoneHour = Number(zoneHourRaw);
  const zoneMinute = Number(zoneMinuteRaw);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 60 ||
    zoneHour > 23 ||
    zoneMinute > 59
  ) {
    return null;
  }
  const local = new Date(Date.UTC(2000, 0, 1, hour, minute, Math.min(second, 59), millisecond));
  local.setUTCFullYear(year, month - 1, day);
  if (
    Number.isNaN(local.valueOf()) ||
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() !== month - 1 ||
    local.getUTCDate() !== day
  ) {
    return null;
  }
  const offsetMinutes =
    zoneRaw.toUpperCase() === "Z" ? 0 : Number(`${signRaw ?? "+"}1`) * (zoneHour * 60 + zoneMinute);
  const parsed = new Date(local.getTime() - offsetMinutes * 60_000);
  if (Number.isNaN(parsed.valueOf())) {
    return null;
  }
  return naiveTimestampFromDate(parsed, fractionRaw, second === 60 ? "60" : undefined);
}

function normalizeNaiveTimestamp(value: string): string | null {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return validDateParts(Number(year), Number(month), Number(day))
      ? `${year}-${month}-${day}T00:00:00`
      : null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})(?: |T)(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/u.exec(value);
  if (!match) {
    return null;
  }
  const [, yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw, fractionRaw] = match;
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const second = Number(secondRaw);
  if (!validDateParts(year, month, day) || hour > 23 || minute > 59 || second > 60) {
    return null;
  }
  return `${yearRaw}-${monthRaw}-${dayRaw}T${hourRaw}:${minuteRaw}:${secondRaw}${normalizeRustFraction(
    fractionRaw,
  )}`;
}

function naiveTimestampFromDate(
  date: Date,
  fractionRaw: string | undefined,
  secondOverride?: string,
): string {
  return `${chronoYearString(date.getUTCFullYear())}-${String(date.getUTCMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getUTCDate()).padStart(2, "0")}T${String(date.getUTCHours()).padStart(
    2,
    "0",
  )}:${String(date.getUTCMinutes()).padStart(2, "0")}:${
    secondOverride ?? String(date.getUTCSeconds()).padStart(2, "0")
  }${normalizeRustFraction(fractionRaw)}`;
}

function validDateParts(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(2000, 0, 1));
  date.setUTCFullYear(year, month - 1, day);
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= 31 &&
    !Number.isNaN(date.valueOf()) &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function normalizeRustFraction(value: string | undefined): string {
  if (value === undefined) {
    return "";
  }
  const nanos = value.slice(0, 9).padEnd(9, "0");
  if (/^0+$/u.test(nanos)) {
    return "";
  }
  if (nanos.endsWith("000000")) {
    return `.${nanos.slice(0, 3)}`;
  }
  if (nanos.endsWith("000")) {
    return `.${nanos.slice(0, 6)}`;
  }
  return `.${nanos}`;
}

function chronoYearString(year: number): string {
  if (year >= 0 && year <= 9999) {
    return year.toString().padStart(4, "0");
  }
  if (year > 9999) {
    return `+${year}`;
  }
  const absolute = Math.abs(year);
  return `-${absolute < 10_000 ? absolute.toString().padStart(4, "0") : absolute}`;
}

function currentTimestamp(options: AssetServiceOptions): string {
  return options.now?.() ?? timestampNow();
}

function stringPrefix(value: unknown, length: number): string | null {
  return typeof value === "string" && value.length >= length ? value.slice(0, length) : null;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function decimalNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCouponFrequency(frequency: string): string {
  switch (frequency.trim().toUpperCase()) {
    case "SEMI-ANNUAL":
    case "SEMI_ANNUAL":
    case "SEMIANNUAL":
      return "SEMI_ANNUAL";
    case "ANNUAL":
      return "ANNUAL";
    case "QUARTERLY":
      return "QUARTERLY";
    case "NONE":
    case "ZERO":
      return "ZERO";
    default:
      return "SEMI_ANNUAL";
  }
}

function instrumentTypeFromProvider(assetType: string): string | null {
  switch (assetType.trim().toUpperCase()) {
    case "CRYPTOCURRENCY":
    case "CRYPTO":
      return "CRYPTO";
    case "EQUITY":
    case "STOCK":
    case "ETF":
    case "MUTUALFUND":
    case "MUTUAL FUND":
    case "INDEX":
      return "EQUITY";
    case "CURRENCY":
    case "FOREX":
    case "FX":
      return "FX";
    case "OPTION":
      return "OPTION";
    case "COMMODITY":
      return "METAL";
    default:
      return null;
  }
}

function preferredProviderId(providerConfig: string | null): string | null {
  const parsed = parseJsonValue(providerConfig);
  if (!isRecord(parsed)) {
    return null;
  }
  const value = parsed.preferred_provider ?? parsed.preferredProvider;
  return typeof value === "string" && value.trim() !== "" ? value.trim().toUpperCase() : null;
}

function providerOverrideSymbol(providerConfig: string | null, provider: string): string | null {
  const override = providerOverrideRecord(providerConfig, provider);
  if (!override) {
    return null;
  }
  const type = optionalString(override.type);
  const symbol = optionalString(override.symbol);
  if (symbol && type !== "crypto_pair" && type !== "fx_pair") {
    return symbol;
  }
  const from = optionalString(override.from);
  const to = optionalString(override.to);
  if (type === "fx_pair" && from && to) {
    return `${from}${to}=X`;
  }
  const market = optionalString(override.market);
  if (type === "crypto_pair" && symbol && market) {
    return `${symbol}-${market}`;
  }
  return null;
}

function providerOverrideRecord(
  providerConfig: string | null,
  provider: string,
): Record<string, unknown> | null {
  const parsed = parseJsonValue(providerConfig);
  if (!isRecord(parsed) || !isRecord(parsed.overrides)) {
    return null;
  }
  const override = parsed.overrides[provider];
  return isRecord(override) ? override : null;
}

async function providerApiKey(
  secretService: SecretService | undefined,
  provider: string,
): Promise<string | null> {
  const apiKey = (await secretService?.getSecret(provider)) ?? null;
  if (apiKey === null) {
    return null;
  }
  const trimmed = apiKey.trim();
  return trimmed === "" ? null : trimmed;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

async function fetchYahooProfile(
  symbol: string,
  fetchImpl: typeof fetch,
): Promise<AssetProviderProfile> {
  if (isE2eFixtureMode()) {
    const fixtureProfile = e2eFixtureProfile(symbol);
    if (!fixtureProfile) {
      throw new Error(`Symbol not found: ${symbol}`);
    }
    return fixtureProfile;
  }
  const quoteSummaryProfile = await fetchYahooQuoteSummaryProfile(symbol, fetchImpl).catch(
    () => null,
  );
  if (quoteSummaryProfile) {
    return quoteSummaryProfile;
  }
  return fetchYahooSearchProfile(symbol, fetchImpl);
}

let fixtureCatalogCache: { dir: string; catalog: FixtureCatalog } | null = null;

function isE2eFixtureMode(): boolean {
  return process.env.WEALTHFOLIO_E2E === "1";
}

function e2eFixtureCatalog(): FixtureCatalog | null {
  if (!isE2eFixtureMode()) {
    return null;
  }
  const fixtureDir = process.env.WEALTHFOLIO_FIXTURE_DIR?.trim();
  if (!fixtureDir) {
    throw new Error("WEALTHFOLIO_FIXTURE_DIR must be set when WEALTHFOLIO_E2E=1");
  }
  if (fixtureCatalogCache?.dir === fixtureDir) {
    return fixtureCatalogCache.catalog;
  }
  const catalog = JSON.parse(
    readFileSync(join(fixtureDir, "instruments.json"), "utf8"),
  ) as FixtureCatalog;
  fixtureCatalogCache = { dir: fixtureDir, catalog };
  return catalog;
}

function e2eFixtureProfile(symbol: string): AssetProviderProfile | null {
  const instrument = e2eFixtureInstrument(symbol);
  if (!instrument) {
    return null;
  }
  const source = instrument.provider ?? "YAHOO";
  const profile: AssetProviderProfile = {
    source,
    name: instrument.name,
    notes: `Synthetic e2e profile for ${instrument.name}`,
  };
  if (instrument.assetType) {
    profile.assetType = instrument.assetType;
  }
  if (instrument.currency) {
    profile.quoteCcy = instrument.currency;
  }
  if (instrument.sector) {
    profile.sectors = `[{\"name\":\"${instrument.sector}\",\"weight\":1}]`;
  }
  if (instrument.industry) {
    profile.industry = instrument.industry;
  }
  if (instrument.website) {
    profile.url = instrument.website;
  }
  if (instrument.country) {
    profile.countries = weightedProfileJson(instrument.country, 1);
  }
  return profile;
}

function e2eFixtureInstrument(symbol: string, provider = "YAHOO"): FixtureInstrument | null {
  const catalog = e2eFixtureCatalog();
  if (!catalog) {
    return null;
  }
  const normalized = symbol.trim().toUpperCase();
  return (
    catalog.instruments?.find(
      (instrument) =>
        (instrument.provider ?? "YAHOO") === provider &&
        instrument.symbol.toUpperCase() === normalized,
    ) ??
    catalog.instruments?.find(
      (instrument) =>
        (instrument.provider ?? "YAHOO") === provider &&
        (instrument.aliases ?? []).some((alias) => alias.toUpperCase() === normalized),
    ) ??
    (provider === "YAHOO" ? syntheticFixtureFxInstrument(symbol) : null)
  );
}

function syntheticFixtureFxInstrument(symbol: string): FixtureInstrument | null {
  const pair = parseFixtureFxPair(symbol);
  if (!pair) {
    return null;
  }
  return {
    symbol: `${pair.base}${pair.quote}=X`,
    aliases: [`${pair.base}/${pair.quote}`, `${pair.base}${pair.quote}`],
    name: `${pair.base}/${pair.quote}`,
    provider: "YAHOO",
    assetType: "FX",
    currency: pair.quote,
  };
}

function parseFixtureFxPair(symbol: string): { base: string; quote: string } | null {
  const upper = symbol.trim().toUpperCase();
  if (!upper.startsWith("FX:") && !upper.endsWith("=X") && !upper.includes("/")) {
    return null;
  }
  const compact = upper
    .replace(/^FX:/, "")
    .replace(/=X$/, "")
    .replace("/", "")
    .replace(/[^A-Z]/g, "");
  return compact.length === 6 ? { base: compact.slice(0, 3), quote: compact.slice(3) } : null;
}

async function fetchYahooQuoteSummaryProfile(
  symbol: string,
  fetchImpl: typeof fetch,
): Promise<AssetProviderProfile> {
  const crumb = await fetchYahooCrumb(fetchImpl);
  const response = await fetchImpl(
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=price,summaryProfile,summaryDetail,topHoldings&crumb=${encodeURIComponent(crumb.crumb)}`,
    {
      headers: {
        ...yahooHeaders(),
        Cookie: crumb.cookie,
      },
    },
  );
  if (response.status === 401) {
    yahooCrumbCache.delete(fetchImpl);
    throw new Error("YAHOO: authentication expired");
  }
  if (!response.ok) {
    throw new Error(`YAHOO: HTTP ${formatRustHttpStatus(response.status)}`);
  }
  const payload = (await response.json()) as unknown;
  const profile = mapYahooQuoteSummaryProfile(symbol, payload);
  if (!profile) {
    throw new Error(`Symbol not found: ${symbol}`);
  }
  return profile;
}

async function fetchYahooCrumb(
  fetchImpl: typeof fetch,
): Promise<{ cookie: string; crumb: string }> {
  const cached = yahooCrumbCache.get(fetchImpl);
  if (cached) {
    return cached;
  }

  const cookieResponse = await fetchImpl("https://fc.yahoo.com");
  if (!cookieResponse.ok) {
    throw new Error(`YAHOO: HTTP ${formatRustHttpStatus(cookieResponse.status)}`);
  }
  const cookie = cookieResponse.headers.get("set-cookie")?.split(";")[0]?.trim();
  if (!cookie) {
    throw new Error("YAHOO: Failed to parse Yahoo cookie");
  }

  const crumbResponse = await fetchImpl("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: {
      ...yahooHeaders(),
      Cookie: cookie,
    },
  });
  if (!crumbResponse.ok) {
    throw new Error(`YAHOO: HTTP ${formatRustHttpStatus(crumbResponse.status)}`);
  }
  const crumb = (await crumbResponse.text()).trim();
  if (!crumb) {
    throw new Error("YAHOO: Failed to parse Yahoo crumb");
  }
  const crumbData = { cookie, crumb };
  yahooCrumbCache.set(fetchImpl, crumbData);
  return crumbData;
}

function mapYahooQuoteSummaryProfile(
  symbol: string,
  payload: unknown,
): AssetProviderProfile | null {
  if (!isRecord(payload) || !isRecord(payload.quoteSummary)) {
    return null;
  }
  const results = payload.quoteSummary.result;
  if (!Array.isArray(results) || !isRecord(results[0])) {
    return null;
  }
  const result = results[0];
  const price = isRecord(result.price) ? result.price : {};
  const summary = isRecord(result.summaryProfile) ? result.summaryProfile : {};
  const detail = isRecord(result.summaryDetail) ? result.summaryDetail : {};
  const topHoldings = isRecord(result.topHoldings) ? result.topHoldings : {};
  const assetType = optionalString(price.quoteType)?.toUpperCase();
  const name = formatYahooName(
    optionalString(price.longName),
    assetType ?? "",
    optionalString(price.shortName),
    symbol,
  );
  const quoteCcy = normalizeQuoteCcy(optionalString(price.currency));
  const sectors = yahooSectorsJson(assetType, summary, topHoldings);
  const country = optionalString(summary.country);
  const industry = optionalString(summary.industry);
  const website = optionalString(summary.website);
  const description =
    optionalString(summary.longBusinessSummary) ?? optionalString(summary.description);

  const profile: AssetProviderProfile = { source: "YAHOO" };
  if (name) {
    profile.name = name;
  }
  if (assetType) {
    profile.assetType = assetType;
  }
  if (quoteCcy) {
    profile.quoteCcy = quoteCcy;
  }
  if (description) {
    profile.notes = description;
  }
  if (country) {
    profile.countries = weightedProfileJson(country, 1);
  }
  if (sectors) {
    profile.sectors = sectors;
  }
  if (industry) {
    profile.industry = industry;
  }
  if (website) {
    profile.url = website;
  }

  const marketCap = yahooRawNumber(detail.marketCap);
  if (marketCap !== undefined) {
    profile.marketCap = marketCap;
  }
  const peRatio = yahooRawNumber(detail.trailingPE);
  if (peRatio !== undefined) {
    profile.peRatio = peRatio;
  }
  const dividendYield = yahooRawNumber(detail.dividendYield);
  if (dividendYield !== undefined) {
    profile.dividendYield = dividendYield;
  }
  const week52High = yahooRawNumber(detail.fiftyTwoWeekHigh);
  if (week52High !== undefined) {
    profile.week52High = week52High;
  }
  const week52Low = yahooRawNumber(detail.fiftyTwoWeekLow);
  if (week52Low !== undefined) {
    profile.week52Low = week52Low;
  }
  return profile;
}

function yahooSectorsJson(
  assetType: string | undefined,
  summary: Record<string, unknown>,
  topHoldings: Record<string, unknown>,
): string | undefined {
  if (assetType === "ETF" || assetType === "MUTUALFUND") {
    const sectorWeightings = topHoldings.sectorWeightings;
    if (!Array.isArray(sectorWeightings)) {
      return undefined;
    }
    const sectors: Array<{ name: string; weight: number }> = [];
    for (const weighting of sectorWeightings) {
      if (!isRecord(weighting)) {
        continue;
      }
      for (const [sectorName, value] of Object.entries(weighting)) {
        const weight = yahooRawNumber(value);
        if (weight !== undefined) {
          sectors.push({ name: formatYahooSector(sectorName), weight });
        }
      }
    }
    return sectors.length > 0 ? JSON.stringify(sectors) : undefined;
  }

  const sector = optionalString(summary.sector);
  return sector ? weightedProfileJson(formatYahooSector(sector), 1) : undefined;
}

function yahooRawNumber(value: unknown): number | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return decimalNumber(value.raw) ?? undefined;
}

function weightedProfileJson(name: string, weight: number): string {
  return JSON.stringify([{ name, weight }]);
}

function formatYahooName(
  longName: string | null,
  quoteType: string,
  shortName: string | null,
  symbol: string,
): string {
  let name = longName ?? "";
  if (name) {
    const replacements: Array<[string, string]> = [
      ["&amp;", "&"],
      ["Amundi Index Solutions - ", ""],
      ["iShares ETF (CH) - ", ""],
      ["iShares III Public Limited Company - ", ""],
      ["iShares V PLC - ", ""],
      ["iShares VI Public Limited Company - ", ""],
      ["iShares VII PLC - ", ""],
      ["Multi Units Luxembourg - ", ""],
      ["VanEck ETFs N.V. - ", ""],
      ["Vaneck Vectors Ucits Etfs Plc - ", ""],
      ["Vanguard Funds Public Limited Company - ", ""],
      ["Vanguard Index Funds - ", ""],
      ["Xtrackers (IE) Plc - ", ""],
    ];
    for (const [from, to] of replacements) {
      name = name.replaceAll(from, to);
    }
  }
  if (quoteType.toUpperCase() === "FUTURE" && shortName && shortName.length >= 7) {
    return shortName.slice(0, -7);
  }
  return name || shortName || symbol;
}

function formatYahooSector(sector: string): string {
  return sector
    .split("_")
    .map((word) => (word ? `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}` : ""))
    .join(" ");
}

function yahooHeaders(): HeadersInit {
  return {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  };
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
    alphaVantageSuffixByMic: new Map(),
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

function columnExists(db: Database, tableName: string, columnName: string): boolean {
  return db
    .query<{ name: string }, []>(`PRAGMA table_info(${tableName})`)
    .all()
    .some((column) => {
      return column.name === columnName;
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boolToInt(value: boolean): number {
  return value ? 1 : 0;
}

function timestampNow(): string {
  const iso = new Date().toISOString();
  return iso.endsWith(".000Z") ? `${iso.slice(0, -5)}+00:00` : iso.replace(/Z$/u, "+00:00");
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
