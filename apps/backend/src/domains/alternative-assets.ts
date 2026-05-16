import type { Database } from "bun:sqlite";

import Decimal from "decimal.js";

import type { BackendEventBus } from "../events";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN });

export type AlternativeAssetKindApi =
  | "property"
  | "vehicle"
  | "collectible"
  | "precious"
  | "liability"
  | "other";

export interface CreateAlternativeAssetRequest {
  kind: AlternativeAssetKindApi;
  name: string;
  currency: string;
  currentValue: string;
  valueDate: string;
  purchasePrice?: string;
  purchaseDate?: string;
  metadata?: Record<string, unknown>;
  linkedAssetId?: string;
}

export interface CreateAlternativeAssetResponse {
  assetId: string;
  quoteId: string;
}

export interface UpdateAlternativeAssetValuationRequest {
  value: string;
  date: string;
  notes?: string;
}

export interface UpdateAlternativeAssetValuationResponse {
  quoteId: string;
  valuationDate: string;
  value: string;
}

export interface LinkLiabilityRequest {
  targetAssetId: string;
}

export interface UpdateAlternativeAssetDetailsRequest {
  assetId: string;
  name?: string;
  metadata: Record<string, string | null>;
  notes?: string;
}

export interface AlternativeAssetHolding {
  id: string;
  kind: string;
  name: string;
  symbol: string;
  currency: string;
  marketValue: string;
  purchasePrice?: string | null;
  purchaseDate?: string | null;
  unrealizedGain?: string | null;
  unrealizedGainPct?: string | null;
  valuationDate: string;
  metadata?: Record<string, unknown> | null;
  linkedAssetId?: string | null;
  notes?: string | null;
}

export interface AlternativeAssetService {
  createAlternativeAsset(
    request: CreateAlternativeAssetRequest,
  ): Promise<CreateAlternativeAssetResponse> | CreateAlternativeAssetResponse;
  updateValuation(
    assetId: string,
    request: UpdateAlternativeAssetValuationRequest,
  ): Promise<UpdateAlternativeAssetValuationResponse> | UpdateAlternativeAssetValuationResponse;
  deleteAlternativeAsset(assetId: string): Promise<void> | void;
  linkLiability(liabilityId: string, request: LinkLiabilityRequest): Promise<void> | void;
  unlinkLiability(liabilityId: string): Promise<void> | void;
  updateAssetDetails(request: UpdateAlternativeAssetDetailsRequest): Promise<void> | void;
  getAlternativeHoldings(): Promise<AlternativeAssetHolding[]> | AlternativeAssetHolding[];
}

export interface AlternativeAssetServiceOptions {
  eventBus?: BackendEventBus;
  now?: () => Date;
  queueAssetSyncEvent?: (event: AlternativeAssetSyncEvent) => void;
  queueQuoteSyncEvent?: (event: AlternativeQuoteSyncEvent) => void;
}

export type AlternativeSyncOperation = "Create" | "Update" | "Delete";

export interface AlternativeAssetSyncEvent {
  assetId: string;
  operation: AlternativeSyncOperation;
  payload: AlternativeAssetRowPayload | { id: string };
}

export interface AlternativeQuoteSyncEvent {
  quoteId: string;
  operation: Exclude<AlternativeSyncOperation, "Delete">;
  payload: AlternativeQuoteRowPayload;
}

export interface AlternativeAssetRowPayload {
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

export interface AlternativeQuoteRowPayload {
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

interface AlternativeAssetRow {
  id: string;
  kind: string;
  name: string | null;
  display_code: string | null;
  notes: string | null;
  metadata: string | null;
  is_active: number | boolean;
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

interface AlternativeQuoteRow {
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

const DATA_SOURCE_MANUAL = "MANUAL";
const ASSETS_CREATED_EVENT = "assets_created";
const ALTERNATIVE_KINDS = new Set([
  "PROPERTY",
  "VEHICLE",
  "COLLECTIBLE",
  "PRECIOUS_METAL",
  "LIABILITY",
  "OTHER",
]);

const kindToDb = {
  collectible: "COLLECTIBLE",
  liability: "LIABILITY",
  other: "OTHER",
  precious: "PRECIOUS_METAL",
  property: "PROPERTY",
  vehicle: "VEHICLE",
} satisfies Record<AlternativeAssetKindApi, string>;

const kindToApi: Record<string, AlternativeAssetKindApi> = {
  COLLECTIBLE: "collectible",
  LIABILITY: "liability",
  OTHER: "other",
  PRECIOUS_METAL: "precious",
  PROPERTY: "property",
  VEHICLE: "vehicle",
};

const kindDisplayName: Record<string, string> = {
  COLLECTIBLE: "Collectible",
  LIABILITY: "Liability",
  OTHER: "Other",
  PRECIOUS_METAL: "Precious Metal",
  PROPERTY: "Property",
  VEHICLE: "Vehicle",
};

export function createAlternativeAssetService(
  db: Database,
  options: AlternativeAssetServiceOptions = {},
): AlternativeAssetService {
  const now = options.now ?? (() => new Date());

  return {
    createAlternativeAsset(request) {
      const kind = dbKindFromApi(request.kind);
      validateAlternativeAssetKind(kind);
      if (!request.name.trim()) {
        throw new Error("Invalid input: Asset name cannot be empty");
      }
      if (!request.currency.trim()) {
        throw new Error("Invalid input: Currency cannot be empty");
      }

      const currentValue = parseDecimalString(request.currentValue, "current value");
      const valueDate = parseDateOnly(request.valueDate, "value date");
      const purchasePrice =
        request.purchasePrice === undefined
          ? undefined
          : parseDecimalString(request.purchasePrice, "purchase price");
      const purchaseDate =
        request.purchaseDate === undefined
          ? undefined
          : parseDateOnly(request.purchaseDate, "purchase date");
      if (purchaseDate && purchaseDate >= valueDate) {
        throw new Error(
          "Invalid input: Purchase/origination date must be before current value date",
        );
      }

      let response: CreateAlternativeAssetResponse | undefined;
      db.transaction(() => {
        const assetId = crypto.randomUUID();
        const metadata = buildAssetMetadata(request, purchasePrice, purchaseDate);
        const displayCode = deriveDisplayCode(kind, metadata);
        const timestamp = timestampNow(now);
        db.prepare(
          `
            INSERT INTO assets (
              id, kind, name, display_code, notes, metadata, is_active, quote_mode,
              quote_ccy, instrument_type, instrument_symbol, instrument_exchange_mic,
              provider_config, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, NULL, ?, 1, ?, ?, NULL, NULL, NULL, NULL, ?, ?)
          `,
        ).run(
          assetId,
          kind,
          request.name,
          displayCode,
          metadata ? JSON.stringify(metadata) : null,
          "MANUAL",
          request.currency,
          timestamp,
          timestamp,
        );
        queueAlternativeAssetSyncEvent(options, readAlternativeAssetById(db, assetId), "Create");

        publishAssetsCreated(options.eventBus, assetId);

        if (purchasePrice && purchaseDate) {
          saveManualQuote(
            db,
            {
              assetId,
              currency: request.currency,
              day: purchaseDate,
              id: crypto.randomUUID(),
              notes: null,
              timestamp: dateToNoonUtcTimestamp(purchaseDate),
              value: purchasePrice,
              now,
            },
            options.queueQuoteSyncEvent,
          );
        }

        const quote = saveManualQuote(
          db,
          {
            assetId,
            currency: request.currency,
            day: valueDate,
            id: crypto.randomUUID(),
            notes: null,
            timestamp: dateToNoonUtcTimestamp(valueDate),
            value: currentValue,
            now,
          },
          options.queueQuoteSyncEvent,
        );
        response = { assetId, quoteId: quote.id };
      })();

      if (!response) {
        throw new Error("Record not found: alternative asset");
      }
      return response;
    },
    updateValuation(assetId, request) {
      const value = parseDecimalString(request.value, "value");
      const date = parseDateOnly(request.date, "date");
      return db.transaction(() => {
        readAlternativeAssetById(db, assetId);
        const latestQuote = readLatestQuoteByAssetId(db, assetId);
        if (!latestQuote) {
          throw new Error(
            `Invalid input: Cannot find existing valuation for asset: ${assetId}. Please check the asset exists.`,
          );
        }
        const quote = saveManualQuote(
          db,
          {
            assetId,
            currency: latestQuote.currency,
            day: date,
            id: crypto.randomUUID(),
            notes: request.notes ?? null,
            timestamp: dateToNoonUtcTimestamp(date),
            value,
            now,
          },
          options.queueQuoteSyncEvent,
        );
        return {
          quoteId: quote.id,
          valuationDate: date,
          value,
        };
      })();
    },
    deleteAlternativeAsset(assetId) {
      const asset = readAlternativeAssetById(db, assetId);
      assertAlternativeAsset(asset, assetId);
      db.transaction(() => {
        unlinkLiabilitiesReferencing(db, assetId, now, options.queueAssetSyncEvent);
        db.prepare("DELETE FROM quotes WHERE asset_id = ? AND source = ?").run(
          assetId,
          DATA_SOURCE_MANUAL,
        );
        const result = db.prepare("DELETE FROM assets WHERE id = ?").run(assetId);
        if (result.changes === 0) {
          throw new Error(`Record not found: Alternative asset not found: ${assetId}`);
        }
        queueAlternativeAssetSyncDelete(options, assetId);
      })();
    },
    linkLiability(liabilityId, request) {
      db.transaction(() => {
        const liability = readAlternativeAssetById(db, liabilityId);
        if (liability.kind !== "LIABILITY") {
          throw new Error(
            `Invalid input: Asset ${liabilityId} is not a liability (kind: ${liability.kind})`,
          );
        }
        const target = readAlternativeAssetById(db, request.targetAssetId);
        assertAlternativeAsset(target, request.targetAssetId, "Target asset");
        updateAssetMetadata(db, liabilityId, { linked_asset_id: request.targetAssetId }, now);
        queueAlternativeAssetSyncEvent(
          options,
          readAlternativeAssetById(db, liabilityId),
          "Update",
        );
      })();
    },
    unlinkLiability(liabilityId) {
      const liability = readAlternativeAssetById(db, liabilityId);
      if (liability.kind !== "LIABILITY") {
        throw new Error(
          `Invalid input: Asset ${liabilityId} is not a liability (kind: ${liability.kind})`,
        );
      }
      // Rust passes None through update_asset_metadata, which the repository treats as no update.
    },
    updateAssetDetails(request) {
      db.transaction(() => {
        const asset = readAlternativeAssetById(db, request.assetId);
        assertAlternativeAsset(asset, request.assetId);
        const metadata = parseMetadataObject(asset.metadata);
        const oldPurchasePrice = stringFromMetadata(metadata, "purchase_price");
        const oldPurchaseDate = stringFromMetadata(metadata, "purchase_date");

        for (const [key, value] of Object.entries(request.metadata)) {
          if (value !== null && value !== "") {
            metadata[key] = value;
          } else {
            delete metadata[key];
          }
        }

        const newPurchasePrice = stringFromMetadata(metadata, "purchase_price");
        const newPurchaseDate = stringFromMetadata(metadata, "purchase_date");
        const updatedMetadata = Object.keys(metadata).length === 0 ? null : metadata;
        const displayCode = deriveDisplayCode(asset.kind, updatedMetadata);
        db.prepare(
          `
            UPDATE assets
            SET name = ?,
                display_code = ?,
                metadata = ?,
                notes = ?,
                updated_at = ?
            WHERE id = ?
          `,
        ).run(
          request.name ?? asset.name,
          displayCode,
          updatedMetadata ? JSON.stringify(updatedMetadata) : asset.metadata,
          request.notes !== undefined ? request.notes : asset.notes,
          timestampNow(now),
          request.assetId,
        );
        queueAlternativeAssetSyncEvent(
          options,
          readAlternativeAssetById(db, request.assetId),
          "Update",
        );

        if (
          (oldPurchasePrice !== newPurchasePrice || oldPurchaseDate !== newPurchaseDate) &&
          newPurchasePrice &&
          newPurchaseDate
        ) {
          saveManualQuote(
            db,
            {
              assetId: request.assetId,
              currency: asset.quote_ccy,
              day: parseDateOnly(newPurchaseDate, "purchase date"),
              id: crypto.randomUUID(),
              notes: null,
              timestamp: dateToNoonUtcTimestamp(newPurchaseDate),
              value: parseDecimalString(newPurchasePrice, "purchase price"),
              now,
            },
            options.queueQuoteSyncEvent,
          );
        }
      })();
    },
    getAlternativeHoldings() {
      const assets = db
        .query<AlternativeAssetRow, []>(
          `
            SELECT ${assetColumns()}
            FROM assets
            WHERE kind IN ('PROPERTY', 'VEHICLE', 'COLLECTIBLE', 'PRECIOUS_METAL', 'LIABILITY', 'OTHER')
          `,
        )
        .all();
      if (assets.length === 0) {
        return [];
      }

      const quotes = latestQuotesByAssetId(
        db,
        assets.map((asset) => asset.id),
      );
      return assets.flatMap((asset) => {
        const quote = quotes.get(asset.id);
        if (!quote) {
          return [];
        }
        const metadata = parseMetadataObjectOrNull(asset.metadata);
        const purchasePrice = metadataStringOrNull(metadata, "purchase_price");
        const purchaseDate = metadataStringOrNull(metadata, "purchase_date");
        const linkedAssetId = metadataStringOrNull(metadata, "linked_asset_id");
        const { unrealizedGain, unrealizedGainPct } = calculateUnrealizedGain(
          quote.close,
          purchasePrice,
        );
        return [
          {
            id: asset.id,
            kind: apiKindFromDb(asset.kind),
            name: asset.name ?? asset.display_code ?? "",
            symbol: asset.display_code ?? "",
            currency: asset.quote_ccy,
            marketValue: decimalStringOrZero(quote.close),
            purchasePrice,
            purchaseDate,
            unrealizedGain,
            unrealizedGainPct,
            valuationDate: quote.timestamp,
            metadata,
            linkedAssetId,
            notes: asset.notes,
          },
        ];
      });
    },
  };
}

function dbKindFromApi(kind: AlternativeAssetKindApi): string {
  return kindToDb[kind];
}

function apiKindFromDb(kind: string): AlternativeAssetKindApi {
  const apiKind = kindToApi[kind];
  if (!apiKind) {
    throw new Error(`Invalid input: Asset kind ${kind} is not an alternative asset type`);
  }
  return apiKind;
}

function validateAlternativeAssetKind(kind: string): void {
  if (!ALTERNATIVE_KINDS.has(kind)) {
    throw new Error(`Invalid input: Asset kind ${kind} is not an alternative asset type`);
  }
}

function assertAlternativeAsset(
  asset: AlternativeAssetRow,
  assetId: string,
  label = "Asset",
): void {
  if (!ALTERNATIVE_KINDS.has(asset.kind)) {
    throw new Error(
      `Invalid input: ${label} ${assetId} is not an alternative asset (kind: ${asset.kind})`,
    );
  }
}

function buildAssetMetadata(
  request: CreateAlternativeAssetRequest,
  purchasePrice: string | undefined,
  purchaseDate: string | undefined,
): Record<string, unknown> | null {
  const metadata = { ...(request.metadata ?? {}) };
  if (purchasePrice !== undefined) {
    metadata.purchase_price = purchasePrice;
  }
  if (purchaseDate !== undefined) {
    metadata.purchase_date = purchaseDate;
  }
  if (request.kind === "liability" && request.linkedAssetId) {
    metadata.linked_asset_id = request.linkedAssetId;
  }
  return Object.keys(metadata).length === 0 ? null : metadata;
}

function deriveDisplayCode(kind: string, metadata: Record<string, unknown> | null): string {
  const subtype = metadata?.sub_type;
  return typeof subtype === "string" && subtype !== ""
    ? formatSubtype(subtype)
    : (kindDisplayName[kind] ?? kind);
}

function formatSubtype(subtype: string): string {
  return subtype
    .split("_")
    .map((word) => (word ? `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}` : ""))
    .join(" ");
}

function saveManualQuote(
  db: Database,
  quote: {
    id: string;
    assetId: string;
    day: string;
    timestamp: string;
    value: string;
    currency: string;
    notes: string | null;
    now: () => Date;
  },
  queueSyncEvent?: (event: AlternativeQuoteSyncEvent) => void,
): AlternativeQuoteRow {
  const existing = db
    .query<
      { id: string },
      [string, string, string]
    >("SELECT id FROM quotes WHERE asset_id = ? AND day = ? AND source = ?")
    .get(quote.assetId, quote.day, DATA_SOURCE_MANUAL);
  const quoteId = existing?.id ?? quote.id;
  const operation = existing ? "Update" : "Create";
  const createdAt = timestampNow(quote.now);
  const optionalValue = decimalOrZero(quote.value).isZero() ? null : quote.value;
  db.prepare(
    `
      INSERT OR REPLACE INTO quotes (
        id, asset_id, day, source, open, high, low, close, adjclose, volume,
        currency, notes, created_at, timestamp
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
    `,
  ).run(
    quoteId,
    quote.assetId,
    quote.day,
    DATA_SOURCE_MANUAL,
    optionalValue,
    optionalValue,
    optionalValue,
    quote.value,
    optionalValue,
    quote.currency,
    quote.notes,
    createdAt,
    quote.timestamp,
  );
  const row = readQuoteById(db, quoteId);
  queueAlternativeQuoteSyncEvent(queueSyncEvent, row, operation);
  return row;
}

function queueAlternativeAssetSyncEvent(
  options: AlternativeAssetServiceOptions,
  row: AlternativeAssetRow,
  operation: Exclude<AlternativeSyncOperation, "Delete">,
): void {
  options.queueAssetSyncEvent?.({
    assetId: row.id,
    operation,
    payload: alternativeAssetRowPayload(row),
  });
}

function queueAlternativeAssetSyncDelete(
  options: AlternativeAssetServiceOptions,
  assetId: string,
): void {
  options.queueAssetSyncEvent?.({
    assetId,
    operation: "Delete",
    payload: { id: assetId },
  });
}

function queueAlternativeQuoteSyncEvent(
  queueSyncEvent: ((event: AlternativeQuoteSyncEvent) => void) | undefined,
  row: AlternativeQuoteRow,
  operation: Exclude<AlternativeSyncOperation, "Delete">,
): void {
  if (!isUserSyncableQuote(row)) {
    return;
  }
  queueSyncEvent?.({
    quoteId: row.id,
    operation,
    payload: alternativeQuoteRowPayload(row),
  });
}

function isUserSyncableQuote(row: AlternativeQuoteRow): boolean {
  return row.source.toUpperCase() === DATA_SOURCE_MANUAL && isUuid(row.id);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function alternativeAssetRowPayload(row: AlternativeAssetRow): AlternativeAssetRowPayload {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    displayCode: row.display_code,
    notes: row.notes,
    metadata: row.metadata,
    isActive: row.is_active ? 1 : 0,
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

function alternativeQuoteRowPayload(row: AlternativeQuoteRow): AlternativeQuoteRowPayload {
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

function readAlternativeAssetById(db: Database, assetId: string): AlternativeAssetRow {
  const row = db
    .query<AlternativeAssetRow, [string]>(
      `
        SELECT ${assetColumns()}
        FROM assets
        WHERE id = ?
      `,
    )
    .get(assetId);
  if (!row) {
    throw new Error(`Record not found: asset ${assetId}`);
  }
  return row;
}

function readQuoteById(db: Database, quoteId: string): AlternativeQuoteRow {
  const row = db
    .query<AlternativeQuoteRow, [string]>(
      `
        SELECT ${quoteColumns("q")}
        FROM quotes q
        WHERE q.id = ?
      `,
    )
    .get(quoteId);
  if (!row) {
    throw new Error(`Record not found: quote ${quoteId}`);
  }
  return row;
}

function readLatestQuoteByAssetId(db: Database, assetId: string): AlternativeQuoteRow | null {
  return db
    .query<AlternativeQuoteRow, [string]>(
      `
        SELECT ${quoteColumns("q")}
        FROM quotes q
        WHERE q.asset_id = ?
        ORDER BY q.day DESC,
          CASE q.source WHEN 'MANUAL' THEN 1 WHEN 'BROKER' THEN 2 ELSE 3 END ASC
        LIMIT 1
      `,
    )
    .get(assetId);
}

function latestQuotesByAssetId(db: Database, assetIds: string[]): Map<string, AlternativeQuoteRow> {
  if (assetIds.length === 0) {
    return new Map();
  }
  const placeholders = assetIds.map(() => "?").join(", ");
  const rows = db
    .query<AlternativeQuoteRow, string[]>(
      `
        WITH RankedQuotes AS (
          SELECT ${quoteColumns("q")},
            ROW_NUMBER() OVER (
              PARTITION BY q.asset_id
              ORDER BY q.day DESC,
                CASE q.source WHEN 'MANUAL' THEN 1 WHEN 'BROKER' THEN 2 ELSE 3 END ASC
            ) AS rn
          FROM quotes q
          WHERE q.asset_id IN (${placeholders})
        )
        SELECT id, asset_id, day, source, open, high, low, close, adjclose, volume,
          currency, notes, created_at, timestamp
        FROM RankedQuotes
        WHERE rn = 1
        ORDER BY asset_id
      `,
    )
    .all(...assetIds);
  return new Map(rows.map((row) => [row.asset_id, row]));
}

function unlinkLiabilitiesReferencing(
  db: Database,
  assetId: string,
  now: () => Date,
  queueSyncEvent?: (event: AlternativeAssetSyncEvent) => void,
): void {
  const linkedPattern = `%"linked_asset_id":"${assetId}"%`;
  const linkedLiabilities = db
    .query<
      { id: string; metadata: string | null },
      [string]
    >("SELECT id, metadata FROM assets WHERE metadata LIKE ?")
    .all(linkedPattern);
  for (const liability of linkedLiabilities) {
    const metadata = parseMetadataObjectOrNull(liability.metadata);
    if (!metadata) {
      continue;
    }
    delete metadata.linked_asset_id;
    db.prepare("UPDATE assets SET metadata = ?, updated_at = ? WHERE id = ?").run(
      JSON.stringify(metadata),
      timestampNow(now),
      liability.id,
    );
    const updatedLiability = readAlternativeAssetById(db, liability.id);
    queueSyncEvent?.({
      assetId: updatedLiability.id,
      operation: "Update",
      payload: alternativeAssetRowPayload(updatedLiability),
    });
  }
}

function updateAssetMetadata(
  db: Database,
  assetId: string,
  metadata: Record<string, unknown>,
  now: () => Date,
): void {
  const result = db
    .prepare("UPDATE assets SET metadata = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(metadata), timestampNow(now), assetId);
  if (result.changes === 0) {
    throw new Error(`Record not found: asset ${assetId}`);
  }
}

function parseMetadataObject(metadata: string | null): Record<string, unknown> {
  return parseMetadataObjectOrNull(metadata) ?? {};
}

function parseMetadataObjectOrNull(metadata: string | null): Record<string, unknown> | null {
  if (!metadata) {
    return null;
  }
  try {
    const parsed = JSON.parse(metadata) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ...(parsed as Record<string, unknown>) };
    }
  } catch {
    return null;
  }
  return null;
}

function stringFromMetadata(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" ? value : undefined;
}

function metadataStringOrNull(
  metadata: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" ? value : null;
}

function calculateUnrealizedGain(
  marketValue: string,
  purchasePrice: string | null,
): { unrealizedGain: string | null; unrealizedGainPct: string | null } {
  if (!purchasePrice || !isDecimalString(purchasePrice)) {
    return { unrealizedGain: null, unrealizedGainPct: null };
  }
  const purchase = new Decimal(purchasePrice);
  const gain = decimalOrZero(marketValue).minus(purchase);
  return {
    unrealizedGain: decimalToString(gain),
    unrealizedGainPct: purchase.isZero() ? null : decimalToString(gain.div(purchase)),
  };
}

function parseDecimalString(value: string, label: string): string {
  const trimmed = value.trim();
  if (!isDecimalString(trimmed)) {
    throw new Error(`Invalid input: Invalid ${label} format`);
  }
  return trimmed;
}

function parseDateOnly(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid input: Invalid ${label} format`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || value !== date.toISOString().slice(0, 10)) {
    throw new Error(`Invalid input: Invalid ${label} format`);
  }
  return value;
}

function dateToNoonUtcTimestamp(date: string): string {
  return `${date}T12:00:00+00:00`;
}

function timestampNow(now: () => Date): string {
  return toRustUtcRfc3339(now());
}

function toRustUtcRfc3339(date: Date): string {
  const iso = date.toISOString();
  return iso.endsWith(".000Z") ? iso.replace(".000Z", "+00:00") : iso.replace("Z", "+00:00");
}

function decimalOrZero(value: string | null | undefined): Decimal {
  if (!value || !isDecimalString(value)) {
    return new Decimal(0);
  }
  return new Decimal(value);
}

function decimalStringOrZero(value: string | null | undefined): string {
  return decimalToString(decimalOrZero(value));
}

function decimalToString(value: Decimal): string {
  return value.toString();
}

function isDecimalString(value: string): boolean {
  return /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim());
}

function assetColumns(): string {
  return [
    "id",
    "kind",
    "name",
    "display_code",
    "notes",
    "metadata",
    "is_active",
    "quote_mode",
    "quote_ccy",
    "instrument_type",
    "instrument_symbol",
    "instrument_exchange_mic",
    "instrument_key",
    "provider_config",
    "created_at",
    "updated_at",
  ].join(", ");
}

function quoteColumns(alias: string): string {
  return [
    "id",
    "asset_id",
    "day",
    "source",
    "open",
    "high",
    "low",
    "close",
    "adjclose",
    "volume",
    "currency",
    "notes",
    "created_at",
    "timestamp",
  ]
    .map((column) => `${alias}.${column}`)
    .join(", ");
}

function publishAssetsCreated(eventBus: BackendEventBus | undefined, assetId: string): void {
  eventBus?.publish({
    name: ASSETS_CREATED_EVENT,
    payload: { type: ASSETS_CREATED_EVENT, asset_ids: [assetId] },
  });
}
