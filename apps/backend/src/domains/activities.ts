import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import Decimal from "decimal.js";

import type { BackendEventBus } from "../events";
import type { ExchangeMetadata } from "./assets";
import { instrumentTypeFromQuoteType, type SymbolSearchResult } from "./market-data";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN });

export const ACTIVITIES_CHANGED_EVENT = "activities_changed";
const ASSETS_CREATED_EVENT = "assets_created";
export const ACTIVITY_IMPORT_CONTEXT_KIND = "ACTIVITY";
export const CSV_ACTIVITY_CONTEXT_KIND = "CSV_ACTIVITY";
export const CSV_HOLDINGS_CONTEXT_KIND = "CSV_HOLDINGS";
export const ACTIVITY_BULK_CREATED_ASSET_IDS = "__wealthfolioCreatedAssetIds";

export type FieldMappingValue = string | string[];
export type ImportTemplateScope = "SYSTEM" | "USER";
export type TemplateKind = "CSV_ACTIVITY" | "CSV_HOLDINGS" | "BROKER_ACTIVITY";

export interface SymbolMappingMeta extends Record<string, unknown> {
  exchangeMic?: string | null;
  symbolName?: string | null;
  quoteCcy?: string | null;
  instrumentType?: string | null;
  quoteMode?: string | null;
}

export interface ImportMappingConfig {
  fieldMappings: Record<string, FieldMappingValue>;
  activityMappings: Record<string, string[]>;
  symbolMappings: Record<string, string>;
  accountMappings: Record<string, string>;
  symbolMappingMeta: Record<string, SymbolMappingMeta>;
  parseConfig?: Record<string, unknown>;
}

export interface ImportMappingData extends ImportMappingConfig {
  accountId: string;
  contextKind: string;
  name: string;
  templateId?: string | null;
}

export interface ImportTemplateData extends ImportMappingConfig {
  id: string;
  name: string;
  scope: ImportTemplateScope;
  kind: TemplateKind;
}

export type BrokerProfileScope = "ACCOUNT" | "BROKER";

export interface BrokerSyncProfileData {
  id: string;
  name: string;
  scope: ImportTemplateScope;
  sourceSystem: string;
  activityMappings: Record<string, string[]>;
  symbolMappings: Record<string, string>;
  symbolMappingMeta: Record<string, SymbolMappingMeta>;
}

export interface SaveBrokerSyncProfileRulesRequest {
  accountId: string;
  sourceSystem: string;
  scope: BrokerProfileScope;
  activityRulePatches: Record<string, string[]>;
  securityRulePatches: Record<string, string>;
  securityRuleMetaPatches: Record<string, SymbolMappingMeta>;
}

export interface ActivitySearchRequest {
  page: number;
  pageSize: number;
  accountIds?: string[];
  activityTypes?: string[];
  assetIdKeyword?: string;
  sort?: { id: string; desc: boolean };
  needsReview?: boolean;
  dateFrom?: string;
  dateTo?: string;
  instrumentTypes?: string[];
}

export interface ActivityParseCsvRequest {
  content: Uint8Array;
  config: Record<string, unknown>;
}

interface ActivityParseConfig {
  hasHeaderRow?: boolean;
  headerRowIndex?: number;
  delimiter?: string;
  quoteChar?: string;
  skipTopRows?: number;
  skipBottomRows?: number;
  skipEmptyRows?: boolean;
  dateFormat?: string | null;
  decimalSeparator?: string | null;
  thousandsSeparator?: string | null;
  defaultCurrency?: string | null;
}

interface ActivityParseError {
  rowIndex: number | null;
  columnIndex: number | null;
  message: string;
  errorType: string;
}

interface ActivityParsedCsvResult {
  headers: string[];
  rows: string[][];
  detectedConfig: ActivityParseConfig;
  errors: ActivityParseError[];
  rowCount: number;
}

export interface ActivityDetails {
  id: string;
  accountId: string;
  assetId: string;
  activityType: string;
  subtype: string | null;
  status: string;
  date: string;
  quantity: string | null;
  unitPrice: string | null;
  currency: string;
  fee: string | null;
  amount: string | null;
  needsReview: boolean;
  comment: string | null;
  fxRate: string | null;
  createdAt: string;
  updatedAt: string;
  accountName: string;
  accountCurrency: string;
  assetSymbol: string;
  assetName: string | null;
  exchangeMic: string | null;
  assetPricingMode: string;
  instrumentType: string | null;
  sourceSystem: string | null;
  sourceRecordId: string | null;
  sourceGroupId: string | null;
  idempotencyKey: string | null;
  importRunId: string | null;
  isUserModified: boolean;
  metadata: unknown | null;
}

export interface ActivitySearchResponse {
  data: ActivityDetails[];
  meta: { totalRowCount: number };
}

export interface Activity {
  id: string;
  accountId: string;
  assetId: string | null;
  activityType: string;
  activityTypeOverride: string | null;
  sourceType: string | null;
  subtype: string | null;
  status: string;
  activityDate: string;
  settlementDate: string | null;
  quantity: string | null;
  unitPrice: string | null;
  amount: string | null;
  fee: string | null;
  currency: string;
  fxRate: string | null;
  notes: string | null;
  metadata: unknown | null;
  sourceSystem: string | null;
  sourceRecordId: string | null;
  sourceGroupId: string | null;
  idempotencyKey: string | null;
  importRunId: string | null;
  isUserModified: boolean;
  needsReview: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityBulkIdentifierMapping {
  tempId: string | null;
  activityId: string;
}

export interface ActivityBulkMutationError {
  id: string | null;
  action: string;
  message: string;
}

export interface ActivityBulkMutationResult {
  created: Activity[];
  updated: Activity[];
  deleted: Activity[];
  createdMappings: ActivityBulkIdentifierMapping[];
  errors: ActivityBulkMutationError[];
}

interface ImportActivitiesSummary {
  total: number;
  imported: number;
  skipped: number;
  duplicates: number;
  assetsCreated: number;
  success: boolean;
  errorMessage: string | null;
}

interface ImportActivitiesResult {
  activities: Array<Record<string, unknown>>;
  importRunId: string;
  summary: ImportActivitiesSummary;
}

type ActivityExchangeMetadata = Pick<ExchangeMetadata, "currencyByMic" | "yahooSuffixToMic">;

export interface ActivityServiceOptions {
  eventBus?: BackendEventBus;
  ensureFxPairs?: (pairs: Array<[string, string]>) => Promise<void> | void;
  queueSyncEvent?: (event: ActivitySyncEvent) => void;
  symbolSearch?: (query: string) => Promise<SymbolSearchResult[]> | SymbolSearchResult[];
  exchangeMetadata?: ActivityExchangeMetadata;
}

export type ActivitySyncOperation = "Create" | "Update" | "Delete";
export type ActivitySyncPayload =
  | ActivityRow
  | ImportRunRow
  | ActivityAssetSyncRow
  | ImportTemplateRow
  | ImportAccountTemplateRow;
export type ActivitySyncFilterInput = Pick<
  ActivityRow,
  "import_run_id" | "is_user_modified" | "source_record_id" | "source_system"
>;

export type ActivitySyncEvent =
  | ActivityRowSyncEvent
  | ActivityImportRunSyncEvent
  | ActivityAssetSyncEvent
  | ActivityImportTemplateSyncEvent
  | ActivityImportAccountTemplateSyncEvent;

export interface ActivityRowSyncEvent {
  entity: "activities";
  entityId: string;
  operation: ActivitySyncOperation;
  payload: ActivityRow | { id: string };
}

export interface ActivityImportRunSyncEvent {
  entity: "import_runs";
  entityId: string;
  operation: "Create";
  payload: ImportRunRow;
}

export interface ActivityAssetSyncEvent {
  entity: "assets";
  entityId: string;
  operation: "Create" | "Update";
  payload: ActivityAssetSyncRow;
}

export interface ActivityImportTemplateSyncEvent {
  entity: "import_templates";
  entityId: string;
  operation: "Update" | "Delete";
  payload: ImportTemplateRow | { id: string };
}

export interface ActivityImportAccountTemplateSyncEvent {
  entity: "import_account_templates";
  entityId: string;
  operation: "Update";
  payload: ImportAccountTemplateRow;
}

export interface ActivityService {
  searchActivities(
    request: ActivitySearchRequest,
  ): Promise<ActivitySearchResponse> | ActivitySearchResponse;
  createActivity(activity: Record<string, unknown>): Promise<Activity> | Activity;
  updateActivity(activity: Record<string, unknown>): Promise<Activity> | Activity;
  bulkMutateActivities(
    request: Record<string, unknown>,
  ): Promise<ActivityBulkMutationResult> | ActivityBulkMutationResult;
  deleteActivity(id: string): Promise<Activity> | Activity;
  linkTransferActivities(
    activityAId: string,
    activityBId: string,
  ): Promise<[Activity, Activity]> | [Activity, Activity];
  unlinkTransferActivities(
    activityAId: string,
    activityBId: string,
  ): Promise<[Activity, Activity]> | [Activity, Activity];
  checkActivitiesImport(activities: unknown[]): Promise<unknown[]> | unknown[];
  previewImportAssets(candidates: unknown[]): Promise<unknown[]> | unknown[];
  importActivities(activities: unknown[]): Promise<unknown> | unknown;
  parseCsv(request: ActivityParseCsvRequest): Promise<unknown> | unknown;
  getImportMapping(accountId: string, contextKind: string): Promise<ImportMappingData>;
  saveImportMapping(mapping: Record<string, unknown>): Promise<ImportMappingData>;
  listImportTemplates(): Promise<ImportTemplateData[]> | ImportTemplateData[];
  getImportTemplate(id: string): Promise<ImportTemplateData> | ImportTemplateData;
  saveImportTemplate(
    template: Record<string, unknown>,
  ): Promise<ImportTemplateData> | ImportTemplateData;
  deleteImportTemplate(id: string): Promise<void> | void;
  getBrokerSyncProfile(
    accountId: string,
    sourceSystem: string,
  ): Promise<BrokerSyncProfileData> | BrokerSyncProfileData;
  saveBrokerSyncProfileRules(
    request: Record<string, unknown>,
  ): Promise<BrokerSyncProfileData> | BrokerSyncProfileData;
  linkAccountTemplate(
    accountId: string,
    templateId: string,
    contextKind: string,
  ): Promise<void> | void;
  checkExistingDuplicates(
    idempotencyKeys: string[],
  ): Promise<Record<string, string>> | Record<string, string>;
}

interface ImportTemplateRow {
  id: string;
  name: string;
  scope: string;
  kind: string;
  source_system: string;
  config_version: number;
  config: string;
  created_at: string;
  updated_at: string;
}

interface ImportMappingJoinRow {
  account_id: string;
  context_kind: string;
  source_system: string;
  template_id: string;
  name: string;
  config: string;
  created_at: string;
  updated_at: string;
}

interface ImportAccountTemplateRow {
  id: string;
  account_id: string;
  context_kind: string;
  source_system: string;
  template_id: string;
  created_at: string;
  updated_at: string;
}

interface DuplicateRow {
  id: string;
  idempotency_key: string | null;
}

export interface ImportRunRow {
  id: string;
  account_id: string;
  source_system: string;
  run_type: string;
  mode: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  review_mode: string;
  applied_at: string | null;
  checkpoint_in: string | null;
  checkpoint_out: string | null;
  summary: string | null;
  warnings: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

interface ActivityDetailsRow {
  id: string;
  account_id: string;
  asset_id: string | null;
  activity_type: string;
  subtype: string | null;
  status: string;
  date: string;
  quantity: string | null;
  unit_price: string | null;
  currency: string;
  fee: string | null;
  amount: string | null;
  notes: string | null;
  fx_rate: string | null;
  needs_review: number;
  is_user_modified: number;
  source_system: string | null;
  source_record_id: string | null;
  source_group_id: string | null;
  idempotency_key: string | null;
  import_run_id: string | null;
  created_at: string;
  updated_at: string;
  account_name: string;
  account_currency: string;
  asset_symbol: string | null;
  asset_name: string | null;
  exchange_mic: string | null;
  asset_pricing_mode: string | null;
  instrument_type: string | null;
  metadata: string | null;
}

export interface ActivityRow {
  id: string;
  account_id: string;
  asset_id: string | null;
  activity_type: string;
  activity_type_override: string | null;
  source_type: string | null;
  subtype: string | null;
  status: string;
  activity_date: string;
  settlement_date: string | null;
  quantity: string | null;
  unit_price: string | null;
  amount: string | null;
  fee: string | null;
  currency: string;
  fx_rate: string | null;
  notes: string | null;
  metadata: string | null;
  source_system: string | null;
  source_record_id: string | null;
  source_group_id: string | null;
  idempotency_key: string | null;
  import_run_id: string | null;
  is_user_modified: number;
  needs_review: number;
  created_at: string;
  updated_at: string;
}

interface AccountRow {
  id: string;
  name: string;
  currency: string;
}

interface AssetRow {
  id: string;
  kind: string;
  name: string | null;
  is_active: number;
  quote_ccy: string;
  quote_mode: string;
  display_code: string | null;
  notes: string | null;
  metadata: string | null;
  provider_config: string | null;
  instrument_symbol: string | null;
  instrument_exchange_mic: string | null;
  instrument_type: string | null;
}

export interface ActivityAssetSyncRow {
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
  provider_config: string | null;
  created_at: string;
  updated_at: string;
}

interface ActivityAssetInput {
  id?: string;
  symbol?: string;
  exchangeMic?: string;
  instrumentType?: string;
  quoteCcy?: string;
  quoteMode?: string;
  kind?: string;
  name?: string;
}

interface PendingActivityAsset {
  id: string;
  kind: string;
  name: string | null;
  displayCode: string;
  metadata: string | null;
  quoteMode: string;
  quoteCcy: string;
  instrumentType: string;
  instrumentSymbol: string;
  instrumentExchangeMic: string | null;
}

interface ParsedActivityOccSymbol {
  underlying: string;
  expiration: string;
  right: "CALL" | "PUT";
  strike: number;
  occSymbol: string;
}

interface ActivityAssetResolutionContext {
  pendingAssetsById: Map<string, PendingActivityAsset>;
  pendingAssetIdByKey: Map<string, string>;
  createdAssetIds: Set<string>;
  exchangeMetadata?: ActivityExchangeMetadata;
}

interface ActivityCreateRowInput {
  id: string;
  accountId: string;
  assetId: string | null;
  activityType: string;
  subtype: string | null;
  status: string;
  activityDate: string;
  quoteActivityDate: string;
  quantity: Decimal | null;
  unitPrice: Decimal | null;
  amount: Decimal | null;
  fee: Decimal | null;
  currency: string;
  fxRate: Decimal | null;
  notes: string | null;
  metadata: string | null;
  sourceSystem: string | null;
  sourceRecordId: string | null;
  sourceGroupId: string | null;
  idempotencyKey: string | null;
  importRunId: string | null;
  needsReview: boolean;
  assetQuoteMode: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PreparedActivityCreateMutation {
  activity: ActivityCreateRowInput;
  tempId: string | null;
}

interface PreparedActivityUpdateMutation {
  activity: ActivityRow & ActivityQuoteDateInput;
  assetQuoteMode: string | null;
  shouldWriteQuote: boolean;
}

interface ActivityQuoteDateInput {
  quoteActivityDate?: string;
}

interface PreparedBulkActivityMutation {
  assetContext: ActivityAssetResolutionContext;
  preparedCreates: PreparedActivityCreateMutation[];
  preparedUpdates: PreparedActivityUpdateMutation[];
  preparedUpdateExistingRows: ActivityRow[];
  preparedDeletes: ActivityRow[];
  errors: ActivityBulkMutationError[];
}

type DecimalPatch = { kind: "omit" } | { kind: "clear" } | { kind: "set"; value: Decimal };

const SQLITE_MAX_PARAMS_CHUNK = 500;
const ACTIVITY_TYPES = [
  "BUY",
  "SELL",
  "DIVIDEND",
  "INTEREST",
  "DEPOSIT",
  "WITHDRAWAL",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "SPLIT",
  "FEE",
  "TAX",
  "CREDIT",
  "ADJUSTMENT",
] as const;
const SYMBOL_REQUIRED_ACTIVITY_TYPES = new Set(["BUY", "SELL", "SPLIT", "DIVIDEND", "ADJUSTMENT"]);
const PRICE_BEARING_ACTIVITY_TYPES = new Set(["BUY", "SELL", "TRANSFER_IN"]);
const NEVER_ASSET_ACTIVITY_TYPES = new Set(["DEPOSIT", "WITHDRAWAL", "FEE", "TAX", "CREDIT"]);
const TRANSFER_ACTIVITY_TYPES = new Set(["TRANSFER_IN", "TRANSFER_OUT"]);
const MANUAL_QUOTE_SOURCE = "MANUAL";
const CURRENCY_NORMALIZATION_RULES: Record<string, { majorCode: string; factor: Decimal }> = {
  GBp: { majorCode: "GBP", factor: new Decimal("0.01") },
  GBX: { majorCode: "GBP", factor: new Decimal("0.01") },
  KWF: { majorCode: "KWD", factor: new Decimal("0.01") },
  ZAc: { majorCode: "ZAR", factor: new Decimal("0.01") },
  ZAC: { majorCode: "ZAR", factor: new Decimal("0.01") },
  ILA: { majorCode: "ILS", factor: new Decimal("0.01") },
};
const CANONICAL_ACTIVITY_SUBTYPES = [
  "DRIP",
  "DIVIDEND_IN_KIND",
  "STAKING_REWARD",
  "BONUS",
  "REBATE",
  "REFUND",
  "OPTION_EXPIRY",
] as const;

export function createActivityService(
  db: Database,
  options: ActivityServiceOptions = {},
): ActivityService {
  return {
    createActivity(input) {
      if (options.ensureFxPairs) {
        return (async () => {
          const assetContext = createActivityAssetResolutionContext(options.exchangeMetadata);
          const activity = normalizeActivityCreateInput(db, input, assetContext);
          ensureActivityCreateIsUnique(db, activity);
          const fxPairs = collectActivityFxPairs(db, activity, assetContext);
          if (fxPairs.length > 0) {
            await options.ensureFxPairs?.(fxPairs);
          }

          const outcome = db.transaction(() => {
            ensureActivityCreateIsUnique(db, activity);
            return persistPreparedActivityCreate(db, activity, assetContext);
          })();
          publishAssetsCreated(options.eventBus, outcome.createdAssetIds);
          queueActivitySyncEvents(options, outcome.syncEvents);
          publishActivitiesChanged(options.eventBus, [activityEventRecord(outcome.created)]);
          return outcome.created;
        })();
      }

      const outcome = db.transaction(() => {
        const assetContext = createActivityAssetResolutionContext(options.exchangeMetadata);
        const activity = normalizeActivityCreateInput(db, input, assetContext);
        ensureActivityCreateIsUnique(db, activity);
        return persistPreparedActivityCreate(db, activity, assetContext);
      })();
      publishAssetsCreated(options.eventBus, outcome.createdAssetIds);
      queueActivitySyncEvents(options, outcome.syncEvents);
      publishActivitiesChanged(options.eventBus, [activityEventRecord(outcome.created)]);
      return outcome.created;
    },

    updateActivity(input) {
      if (options.ensureFxPairs) {
        return (async () => {
          const assetContext = createActivityAssetResolutionContext(options.exchangeMetadata);
          const activityId = requiredNonEmptyString(input.id, "id");
          const existing = readActivityRow(db, activityId);
          const update = normalizeActivityUpdateInput(db, input, existing, assetContext);
          const assetQuoteMode = activityAssetQuoteModeFromRecord(input);
          const shouldWriteQuote = shouldWriteManualQuoteForUpdate(input);
          const fxPairs = collectActivityFxPairs(db, update, assetContext);
          if (fxPairs.length > 0) {
            await options.ensureFxPairs?.(fxPairs);
          }

          const result = db.transaction(() =>
            persistPreparedActivityUpdate(
              db,
              existing,
              update,
              assetContext,
              assetQuoteMode,
              shouldWriteQuote,
            ),
          )();
          publishAssetsCreated(options.eventBus, result.createdAssetIds);
          queueActivitySyncEvents(options, result.syncEvents);
          publishActivitiesChanged(options.eventBus, [
            activityEventRecord(result.existing),
            activityEventRecord(result.updated),
          ]);
          return result.updated;
        })();
      }

      const result = db.transaction(() => {
        const assetContext = createActivityAssetResolutionContext(options.exchangeMetadata);
        const activityId = requiredNonEmptyString(input.id, "id");
        const existing = readActivityRow(db, activityId);
        const update = normalizeActivityUpdateInput(db, input, existing, assetContext);
        const assetQuoteMode = activityAssetQuoteModeFromRecord(input);
        const shouldWriteQuote = shouldWriteManualQuoteForUpdate(input);
        return persistPreparedActivityUpdate(
          db,
          existing,
          update,
          assetContext,
          assetQuoteMode,
          shouldWriteQuote,
        );
      })();
      publishAssetsCreated(options.eventBus, result.createdAssetIds);
      queueActivitySyncEvents(options, result.syncEvents);
      publishActivitiesChanged(options.eventBus, [
        activityEventRecord(result.existing),
        activityEventRecord(result.updated),
      ]);
      return result.updated;
    },

    bulkMutateActivities(input) {
      if (options.ensureFxPairs) {
        return (async () => {
          const prepared = prepareBulkActivityMutation(db, input, options.exchangeMetadata);
          if (prepared.errors.length > 0) {
            return emptyBulkMutationResult(prepared.errors);
          }

          const fxPairs = collectBulkActivityFxPairs(db, prepared);
          if (fxPairs.length > 0) {
            await options.ensureFxPairs?.(fxPairs);
          }

          const outcome = db.transaction(() => persistPreparedBulkActivityMutation(db, prepared))();
          publishAssetsCreated(options.eventBus, outcome.createdAssetIds);
          queueActivitySyncEvents(options, outcome.syncEvents);
          publishBulkActivitiesChanged(options.eventBus, outcome.oldRows, outcome.result);
          return outcome.result;
        })();
      }

      const prepared = prepareBulkActivityMutation(db, input, options.exchangeMetadata);
      const outcome =
        prepared.errors.length > 0
          ? {
              result: emptyBulkMutationResult(prepared.errors),
              oldRows: [] as ActivityRow[],
              createdAssetIds: [] as string[],
              syncEvents: [] as ActivitySyncEvent[],
            }
          : db.transaction(() => persistPreparedBulkActivityMutation(db, prepared))();
      publishAssetsCreated(options.eventBus, outcome.createdAssetIds);
      queueActivitySyncEvents(options, outcome.syncEvents);
      publishBulkActivitiesChanged(options.eventBus, outcome.oldRows, outcome.result);
      return outcome.result;
    },

    searchActivities(request) {
      validateActivitySearchPagination(request.page, request.pageSize);
      const pageSize = request.pageSize;
      const offset = request.page * pageSize;
      const { whereSql, params } = activitySearchWhereClause(request);
      const totalRow =
        db
          .query<{ count: number }, (string | number)[]>(
            `
              SELECT COUNT(*) AS count
              FROM activities
              INNER JOIN accounts ON activities.account_id = accounts.id
              LEFT JOIN assets ON activities.asset_id = assets.id
              ${whereSql}
            `,
          )
          .get(...params)?.count ?? 0;
      const rows = db
        .query<ActivityDetailsRow, (string | number)[]>(
          `
            SELECT
              activities.id,
              activities.account_id,
              activities.asset_id,
              activities.activity_type,
              activities.subtype,
              activities.status,
              activities.activity_date AS date,
              activities.quantity,
              activities.unit_price,
              activities.currency,
              activities.fee,
              activities.amount,
              activities.notes,
              activities.fx_rate,
              activities.needs_review,
              activities.is_user_modified,
              activities.source_system,
              activities.source_record_id,
              activities.source_group_id,
              activities.idempotency_key,
              activities.import_run_id,
              activities.created_at,
              activities.updated_at,
              accounts.name AS account_name,
              accounts.currency AS account_currency,
              assets.display_code AS asset_symbol,
              assets.name AS asset_name,
              assets.instrument_exchange_mic AS exchange_mic,
              assets.quote_mode AS asset_pricing_mode,
              assets.instrument_type,
              activities.metadata
            FROM activities
            INNER JOIN accounts ON activities.account_id = accounts.id
            LEFT JOIN assets ON activities.asset_id = assets.id
            ${whereSql}
            ${activitySearchOrderBy(request.sort)}
            LIMIT ? OFFSET ?
          `,
        )
        .all(...params, pageSize, offset);

      return {
        data: rows.map(activityDetailsFromRow),
        meta: { totalRowCount: totalRow },
      };
    },

    parseCsv(request) {
      return parseActivityCsv(request);
    },

    previewImportAssets(candidates) {
      return previewImportAssets(db, candidates, options);
    },

    checkActivitiesImport(activities) {
      return checkActivitiesImportRows(db, activities, options);
    },

    importActivities(activities) {
      return importActivityRows(db, activities, options);
    },

    linkTransferActivities(activityAId, activityBId) {
      if (activityAId === activityBId) {
        throw new Error("Cannot link an activity to itself");
      }

      const result = db.transaction(() => {
        const activityA = readActivityRow(db, activityAId);
        const activityB = readActivityRow(db, activityBId);
        const [transferIn, transferOut] = transferPairByType(
          activityA,
          activityB,
          "Linking requires one TRANSFER_IN and one TRANSFER_OUT activity",
        );

        if (transferIn.source_group_id !== null || transferOut.source_group_id !== null) {
          throw new Error("One or both activities are already linked to another transfer");
        }
        if (transferIn.account_id === transferOut.account_id) {
          throw new Error("Both transfer legs share the same account");
        }

        const groupId = crypto.randomUUID();
        const now = activityTimestampNow();
        updateTransferLink(
          db,
          transferIn.id,
          groupId,
          setTransferFlowExternal(transferIn.metadata, false),
          now,
        );
        updateTransferLink(
          db,
          transferOut.id,
          groupId,
          setTransferFlowExternal(transferOut.metadata, false),
          now,
        );
        const updatedRows: [ActivityRow, ActivityRow] = [
          readActivityRow(db, transferIn.id),
          readActivityRow(db, transferOut.id),
        ];
        return {
          updatedPair: updatedRows.map(activityFromRow) as [Activity, Activity],
          syncEvents: activitySyncEvents([
            { operation: "Update", row: updatedRows[0] },
            { operation: "Update", row: updatedRows[1] },
          ]),
        };
      })();
      queueActivitySyncEvents(options, result.syncEvents);
      publishActivitiesChanged(options.eventBus, result.updatedPair.map(activityEventRecord));
      return result.updatedPair;
    },

    unlinkTransferActivities(activityAId, activityBId) {
      if (activityAId === activityBId) {
        throw new Error("Cannot unlink an activity from itself");
      }

      const result = db.transaction(() => {
        const activityA = readActivityRow(db, activityAId);
        const activityB = readActivityRow(db, activityBId);
        const [transferIn, transferOut] = transferPairByType(
          activityA,
          activityB,
          "Unlinking requires one TRANSFER_IN and one TRANSFER_OUT activity",
        );

        if (transferIn.source_group_id === null || transferOut.source_group_id === null) {
          throw new Error("Both activities must already be linked");
        }
        if (transferIn.source_group_id !== transferOut.source_group_id) {
          throw new Error("Selected activities belong to different linked transfers");
        }

        const now = activityTimestampNow();
        updateTransferLink(
          db,
          transferIn.id,
          null,
          setTransferFlowExternal(transferIn.metadata, true),
          now,
        );
        updateTransferLink(
          db,
          transferOut.id,
          null,
          setTransferFlowExternal(transferOut.metadata, true),
          now,
        );
        const updatedRows: [ActivityRow, ActivityRow] = [
          readActivityRow(db, transferIn.id),
          readActivityRow(db, transferOut.id),
        ];
        return {
          updatedPair: updatedRows.map(activityFromRow) as [Activity, Activity],
          syncEvents: activitySyncEvents([
            { operation: "Update", row: updatedRows[0] },
            { operation: "Update", row: updatedRows[1] },
          ]),
        };
      })();
      queueActivitySyncEvents(options, result.syncEvents);
      publishActivitiesChanged(options.eventBus, result.updatedPair.map(activityEventRecord));
      return result.updatedPair;
    },

    deleteActivity(activityId) {
      const result = db.transaction(() => {
        const deleted = readActivityRow(db, activityId);
        db.query("DELETE FROM activities WHERE id = ?").run(activityId);
        return {
          deleted: activityFromRow(deleted),
          syncEvents: activitySyncEvents([{ operation: "Delete", row: deleted }]),
        };
      })();
      queueActivitySyncEvents(options, result.syncEvents);
      publishActivitiesChanged(options.eventBus, [activityEventRecord(result.deleted)]);
      return result.deleted;
    },

    async getImportMapping(accountId, contextKind) {
      const normalizedContextKind = normalizeContextKindValue(contextKind);
      const row = db
        .query<ImportMappingJoinRow, [string, string]>(
          `
            SELECT
              links.account_id,
              links.context_kind,
              links.source_system,
              templates.id AS template_id,
              templates.name,
              templates.config,
              links.created_at,
              links.updated_at
            FROM import_account_templates links
            INNER JOIN import_templates templates ON templates.id = links.template_id
            WHERE links.account_id = ? AND links.context_kind = ?
          `,
        )
        .get(accountId, normalizedContextKind);

      const mapping = row ? mappingDataFromRow(row) : defaultImportMappingData();
      return {
        ...mapping,
        accountId,
        contextKind: normalizedContextKind,
      };
    },

    async saveImportMapping(input) {
      const mapping = normalizeImportMappingInput(input);
      const config = serializeImportConfig(mapping);
      const now = sqliteNow();
      const accountTemplateId =
        mapping.contextKind === CSV_HOLDINGS_CONTEXT_KIND
          ? `acct_${mapping.accountId}_holdings`
          : `acct_${mapping.accountId}`;
      let saved: ImportMappingData | undefined;
      let syncEvent: ActivitySyncEvent | undefined;

      db.transaction(() => {
        const existingLink = readImportAccountTemplateLink(
          db,
          mapping.accountId,
          mapping.contextKind,
        );
        const existingLinkId = existingLink?.id;
        let templateId: string;

        if (existingLink?.template_id === accountTemplateId) {
          db.query(
            `
              UPDATE import_templates
              SET name = ?, config = ?, updated_at = ?
              WHERE id = ?
            `,
          ).run(mapping.name, config, now, existingLink.template_id);
          templateId = existingLink.template_id;
        } else {
          templateId = accountTemplateId;
          db.query(
            `
              INSERT INTO import_templates (
                id, name, scope, kind, source_system, config_version, config, created_at, updated_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                scope = excluded.scope,
                kind = excluded.kind,
                source_system = excluded.source_system,
                config_version = excluded.config_version,
                config = excluded.config,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at
            `,
          ).run(templateId, mapping.name, "user", mapping.contextKind, "", 1, config, now, now);
        }

        upsertImportAccountTemplateLink(db, {
          id: existingLinkId ?? crypto.randomUUID(),
          account_id: mapping.accountId,
          context_kind: mapping.contextKind,
          source_system: "",
          template_id: templateId,
          created_at: now,
          updated_at: now,
        });
        syncEvent = importAccountTemplateSyncEvent(
          readImportAccountTemplateLinkOrThrow(db, mapping.accountId, mapping.contextKind),
        );

        saved = { ...mapping, templateId: mapping.templateId ?? undefined };
      })();
      queueActivitySyncEvents(options, syncEvent ? [syncEvent] : []);

      if (!saved) {
        throw new Error("Failed to save import mapping");
      }
      return saved;
    },

    listImportTemplates() {
      return db
        .query<ImportTemplateRow, []>(
          `
            SELECT *
            FROM import_templates
            WHERE kind IN ('CSV_ACTIVITY', 'CSV_HOLDINGS')
            ORDER BY scope ASC, name ASC
          `,
        )
        .all()
        .map(templateDataFromRow);
    },

    getImportTemplate(id) {
      const row = readImportTemplateRow(db, id);
      return row ? templateDataFromRow(row) : { ...defaultImportTemplateData(), id };
    },

    saveImportTemplate(input) {
      const template = normalizeImportTemplateInput(input);
      const config = serializeImportConfig(template);
      const now = sqliteNow();
      let syncEvent: ActivitySyncEvent | undefined;
      db.transaction(() => {
        db.query(
          `
            INSERT INTO import_templates (
              id, name, scope, kind, source_system, config_version, config, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              scope = excluded.scope,
              kind = excluded.kind,
              source_system = excluded.source_system,
              config_version = excluded.config_version,
              config = excluded.config,
              created_at = excluded.created_at,
              updated_at = excluded.updated_at
          `,
        ).run(template.id, template.name, template.scope, template.kind, "", 1, config, now, now);
        syncEvent = importTemplateSyncEvent(readImportTemplateRowOrThrow(db, template.id));
      })();
      queueActivitySyncEvents(options, syncEvent ? [syncEvent] : []);
      return template;
    },

    deleteImportTemplate(id) {
      let syncEvent: ActivitySyncEvent | undefined;
      db.transaction(() => {
        db.query("DELETE FROM import_templates WHERE id = ?").run(id);
        syncEvent = importTemplateDeleteSyncEvent(id);
      })();
      queueActivitySyncEvents(options, syncEvent ? [syncEvent] : []);
    },

    getBrokerSyncProfile(accountId, sourceSystem) {
      return getBrokerSyncProfileData(db, accountId, sourceSystem);
    },

    saveBrokerSyncProfileRules(input) {
      const request = normalizeSaveBrokerSyncProfileRulesRequest(input);
      const templateId =
        request.scope === "ACCOUNT"
          ? `broker_${request.sourceSystem.toLowerCase()}_${request.accountId}`
          : `broker_${request.sourceSystem.toLowerCase()}`;
      const existingTemplate = readImportTemplateRow(db, templateId);
      const baseline =
        existingTemplate?.kind === "BROKER_ACTIVITY"
          ? brokerProfileDataFromRowOrDefault(existingTemplate)
          : getBrokerSyncProfileData(
              db,
              request.scope === "ACCOUNT" ? request.accountId : "",
              request.sourceSystem,
            );
      const activityMappings = { ...baseline.activityMappings };
      for (const [key, values] of Object.entries(request.activityRulePatches)) {
        activityMappings[key] = values;
      }
      const symbolMappings = { ...baseline.symbolMappings };
      for (const [key, value] of Object.entries(request.securityRulePatches)) {
        symbolMappings[key] = value;
      }
      const symbolMappingMeta = { ...baseline.symbolMappingMeta };
      for (const [key, value] of Object.entries(request.securityRuleMetaPatches)) {
        symbolMappingMeta[key] = value;
      }
      const profile: BrokerSyncProfileData = {
        id: templateId,
        name: `${request.sourceSystem} Profile`,
        scope: "USER",
        sourceSystem: request.sourceSystem,
        activityMappings,
        symbolMappings,
        symbolMappingMeta,
      };
      const config = serializeBrokerProfileConfig(profile);
      const syncEvents: ActivitySyncEvent[] = [];
      const now = sqliteNow();

      db.transaction(() => {
        db.query(
          `
            INSERT INTO import_templates (
              id, name, scope, kind, source_system, config_version, config, created_at, updated_at
            )
            VALUES (?, ?, 'USER', 'BROKER_ACTIVITY', ?, 1, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              scope = excluded.scope,
              kind = excluded.kind,
              source_system = excluded.source_system,
              config_version = excluded.config_version,
              config = excluded.config,
              created_at = excluded.created_at,
              updated_at = excluded.updated_at
          `,
        ).run(templateId, profile.name, request.sourceSystem, config, now, now);
        const templateEvent = importTemplateSyncEvent(readImportTemplateRowOrThrow(db, templateId));
        if (templateEvent) {
          syncEvents.push(templateEvent);
        }

        if (request.scope === "ACCOUNT") {
          const existingLink = readBrokerImportAccountTemplateLink(
            db,
            request.accountId,
            request.sourceSystem,
          );
          upsertImportAccountTemplateLink(db, {
            id: existingLink?.id ?? crypto.randomUUID(),
            account_id: request.accountId,
            context_kind: "BROKER_ACTIVITY",
            source_system: request.sourceSystem,
            template_id: templateId,
            created_at: now,
            updated_at: now,
          });
          syncEvents.push(
            importAccountTemplateSyncEvent(
              readBrokerImportAccountTemplateLinkOrThrow(
                db,
                request.accountId,
                request.sourceSystem,
              ),
            ),
          );
        }
      })();
      queueActivitySyncEvents(options, syncEvents);
      return profile;
    },

    linkAccountTemplate(accountId, templateId, contextKind) {
      const normalizedContextKind = normalizeContextKindValue(contextKind);
      const existingLink = readImportAccountTemplateLink(db, accountId, normalizedContextKind);
      const now = sqliteNow();
      let syncEvent: ActivitySyncEvent | undefined;
      db.transaction(() => {
        upsertImportAccountTemplateLink(db, {
          id: existingLink?.id ?? crypto.randomUUID(),
          account_id: accountId,
          context_kind: normalizedContextKind,
          source_system: "",
          template_id: templateId,
          created_at: now,
          updated_at: now,
        });
        syncEvent = importAccountTemplateSyncEvent(
          readImportAccountTemplateLinkOrThrow(db, accountId, normalizedContextKind),
        );
      })();
      queueActivitySyncEvents(options, syncEvent ? [syncEvent] : []);
    },

    checkExistingDuplicates(idempotencyKeys) {
      if (idempotencyKeys.length === 0) {
        return {};
      }
      const duplicates: Record<string, string> = {};
      for (const chunk of chunkForSqlite(idempotencyKeys)) {
        const placeholders = chunk.map(() => "?").join(", ");
        const rows = db
          .query<DuplicateRow, string[]>(
            `
              SELECT id, idempotency_key
              FROM activities
              WHERE idempotency_key IN (${placeholders})
            `,
          )
          .all(...chunk);
        for (const row of rows) {
          if (row.idempotency_key) {
            duplicates[row.idempotency_key] = row.id;
          }
        }
      }
      return duplicates;
    },
  };
}

interface ActivityEventRecord {
  accountId: string;
  assetId: string | null;
  currency: string;
  activityDate: string;
}

interface ActivitySyncInput {
  operation: ActivitySyncOperation;
  row: ActivityRow;
}

function queueActivitySyncEvents(
  options: ActivityServiceOptions,
  events: ActivitySyncEvent[],
): void {
  if (!options.queueSyncEvent) {
    return;
  }
  for (const event of events) {
    options.queueSyncEvent(event);
  }
}

function activitySyncEvents(inputs: ActivitySyncInput[]): ActivitySyncEvent[] {
  return inputs.flatMap(({ operation, row }) => {
    if (!shouldQueueActivitySyncEvent(operation, row)) {
      return [];
    }
    return [
      {
        entity: "activities" as const,
        entityId: row.id,
        operation,
        payload: operation === "Delete" ? { id: row.id } : { ...row },
      },
    ];
  });
}

function assetSyncEvents(
  rows: ActivityAssetSyncRow[],
  operation: ActivityAssetSyncEvent["operation"],
): ActivitySyncEvent[] {
  return rows.map((row) => ({
    entity: "assets" as const,
    entityId: row.id,
    operation,
    payload: { ...row },
  }));
}

function existingUpdatedAssetIds(
  updatedAssetIds: Set<string>,
  createdAssetIds: string[],
): string[] {
  const created = new Set(createdAssetIds);
  return [...updatedAssetIds].filter((assetId) => !created.has(assetId));
}

function importRunSyncEvents(row: ImportRunRow): ActivitySyncEvent[] {
  if (!shouldQueueImportRunSyncEvent(row)) {
    return [];
  }
  return [
    {
      entity: "import_runs",
      entityId: row.id,
      operation: "Create",
      payload: { ...row },
    },
  ];
}

function importTemplateSyncEvent(row: ImportTemplateRow): ActivitySyncEvent | undefined {
  if (!shouldQueueImportTemplateSyncEvent(row)) {
    return undefined;
  }
  return {
    entity: "import_templates",
    entityId: row.id,
    operation: "Update",
    payload: { ...row },
  };
}

function importTemplateDeleteSyncEvent(templateId: string): ActivitySyncEvent {
  return {
    entity: "import_templates",
    entityId: templateId,
    operation: "Delete",
    payload: { id: templateId },
  };
}

function importAccountTemplateSyncEvent(row: ImportAccountTemplateRow): ActivitySyncEvent {
  return {
    entity: "import_account_templates",
    entityId: row.id,
    operation: "Update",
    payload: { ...row },
  };
}

export function shouldQueueActivitySyncEvent(
  operation: ActivitySyncOperation,
  activity: ActivitySyncFilterInput,
): boolean {
  if (operation === "Delete") {
    return true;
  }
  if (activity.is_user_modified !== 0) {
    return true;
  }

  const sourceSystem = activity.source_system?.trim();
  if (sourceSystem) {
    const normalizedSource = sourceSystem.toUpperCase();
    return normalizedSource === "MANUAL" || normalizedSource === "CSV";
  }

  return isBlankSyncText(activity.import_run_id) && isBlankSyncText(activity.source_record_id);
}

function shouldQueueImportRunSyncEvent(row: ImportRunRow): boolean {
  const runType = row.run_type.trim().toUpperCase();
  const sourceSystem = row.source_system.trim().toUpperCase();
  return runType === "IMPORT" && (sourceSystem === "CSV" || sourceSystem === "MANUAL");
}

function shouldQueueImportTemplateSyncEvent(row: ImportTemplateRow): boolean {
  return row.scope.trim().toUpperCase() !== "SYSTEM";
}

function isBlankSyncText(value: string | null): boolean {
  return value === null || value.trim() === "";
}

function publishAssetsCreated(eventBus: BackendEventBus | undefined, assetIds: string[]): void {
  const createdAssetIds = uniqueSortedStrings(assetIds);
  if (!eventBus || createdAssetIds.length === 0) {
    return;
  }

  eventBus.publish({
    name: ASSETS_CREATED_EVENT,
    payload: { type: ASSETS_CREATED_EVENT, asset_ids: createdAssetIds },
  });
}

function publishActivitiesChanged(
  eventBus: BackendEventBus | undefined,
  activities: ActivityEventRecord[],
): void {
  if (!eventBus || activities.length === 0) {
    return;
  }

  const accountIds = uniqueSortedStrings(activities.map((activity) => activity.accountId));
  if (accountIds.length === 0) {
    return;
  }

  eventBus.publish({
    name: ACTIVITIES_CHANGED_EVENT,
    payload: {
      type: ACTIVITIES_CHANGED_EVENT,
      account_ids: accountIds,
      asset_ids: uniqueSortedStrings(
        activities.flatMap((activity) => (activity.assetId ? [activity.assetId] : [])),
      ),
      currencies: uniqueSortedStrings(activities.map((activity) => activity.currency)),
      earliest_activity_at_utc: earliestActivityAtUtc(activities),
    },
  });
}

function publishBulkActivitiesChanged(
  eventBus: BackendEventBus | undefined,
  oldRows: ActivityRow[],
  result: ActivityBulkMutationResult,
): void {
  if (!eventBus || result.errors.length > 0) {
    return;
  }

  const accountIds = uniqueSortedStrings([
    ...oldRows.map((row) => row.account_id),
    ...result.created.map((activity) => activity.accountId),
    ...result.updated.map((activity) => activity.accountId),
  ]);
  if (accountIds.length === 0) {
    return;
  }

  eventBus.publish({
    name: ACTIVITIES_CHANGED_EVENT,
    payload: {
      type: ACTIVITIES_CHANGED_EVENT,
      account_ids: accountIds,
      asset_ids: uniqueSortedStrings([
        ...oldRows.flatMap((row) => (row.asset_id ? [row.asset_id] : [])),
        ...result.created.flatMap((activity) => (activity.assetId ? [activity.assetId] : [])),
        ...result.updated.flatMap((activity) => (activity.assetId ? [activity.assetId] : [])),
      ]),
      currencies: uniqueSortedStrings([
        ...result.created.map((activity) => activity.currency),
        ...result.updated.map((activity) => activity.currency),
      ]),
      earliest_activity_at_utc: earliestActivityAtUtc([
        ...result.created.map(activityEventRecord),
        ...result.updated.map(activityEventRecord),
        ...result.deleted.map(activityEventRecord),
      ]),
    },
  });
}

function activityEventRecord(activity: Activity): ActivityEventRecord {
  return {
    accountId: activity.accountId,
    assetId: activity.assetId && activity.assetId.length > 0 ? activity.assetId : null,
    currency: activity.currency,
    activityDate: activity.activityDate,
  };
}

function activityEventRecordFromCreate(activity: ActivityCreateRowInput): ActivityEventRecord {
  return {
    accountId: activity.accountId,
    assetId: activity.assetId && activity.assetId.length > 0 ? activity.assetId : null,
    currency: activity.currency,
    activityDate: activity.activityDate,
  };
}

function earliestActivityAtUtc(activities: ActivityEventRecord[]): string | null {
  let earliest: number | null = null;
  for (const activity of activities) {
    const timestamp = new Date(activity.activityDate).getTime();
    if (!Number.isNaN(timestamp) && (earliest === null || timestamp < earliest)) {
      earliest = timestamp;
    }
  }
  return earliest === null ? null : new Date(earliest).toISOString();
}

function uniqueSortedStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0))).sort();
}

export function normalizeContextKindValue(raw: string): string {
  if (raw === ACTIVITY_IMPORT_CONTEXT_KIND) {
    return CSV_ACTIVITY_CONTEXT_KIND;
  }
  if (raw === "HOLDINGS") {
    return CSV_HOLDINGS_CONTEXT_KIND;
  }
  return raw;
}

function parseActivityCsv(request: ActivityParseCsvRequest): ActivityParsedCsvResult {
  const config = normalizeActivityParseConfig(request.config);
  const errors: ActivityParseError[] = [];
  const text = decodeActivityCsvContent(request.content, errors);
  const delimiter = detectActivityCsvDelimiter(text, config);
  const { headers, rows } = parseActivityCsvContent(text, delimiter, config, errors);

  return {
    headers,
    rows,
    detectedConfig: {
      ...config,
      delimiter,
      hasHeaderRow: effectiveHasHeaderRow(config),
      headerRowIndex: effectiveHeaderRowIndex(config),
      skipTopRows: effectiveSkipTopRows(config),
      skipBottomRows: effectiveSkipBottomRows(config),
      skipEmptyRows: effectiveSkipEmptyRows(config),
      quoteChar: effectiveQuoteChar(config),
    },
    errors,
    rowCount: rows.length,
  };
}

function normalizeActivityParseConfig(input: Record<string, unknown>): ActivityParseConfig {
  return {
    hasHeaderRow: optionalBooleanConfig(input, "hasHeaderRow"),
    headerRowIndex: optionalNonNegativeIntegerConfig(input, "headerRowIndex"),
    delimiter: optionalStringConfig(input, "delimiter"),
    quoteChar: optionalStringConfig(input, "quoteChar"),
    skipTopRows: optionalNonNegativeIntegerConfig(input, "skipTopRows"),
    skipBottomRows: optionalNonNegativeIntegerConfig(input, "skipBottomRows"),
    skipEmptyRows: optionalBooleanConfig(input, "skipEmptyRows"),
    dateFormat: optionalNullableStringConfig(input, "dateFormat"),
    decimalSeparator: optionalNullableStringConfig(input, "decimalSeparator"),
    thousandsSeparator: optionalNullableStringConfig(input, "thousandsSeparator"),
    defaultCurrency: optionalNullableStringConfig(input, "defaultCurrency"),
  };
}

function decodeActivityCsvContent(content: Uint8Array, errors: ActivityParseError[]): string {
  if (content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(content.subarray(3));
  }
  if (content[0] === 0xff && content[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(content.subarray(2));
  }
  if (content[0] === 0xfe && content[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(content.subarray(2));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    errors.push({
      rowIndex: null,
      columnIndex: null,
      message: "Detected non-UTF-8 CSV content; decoded as windows-1252.",
      errorType: "encoding",
    });
    return new TextDecoder("windows-1252").decode(content);
  }
}

function detectActivityCsvDelimiter(content: string, config: ActivityParseConfig): string {
  const delimiter = config.delimiter ?? "auto";
  if (delimiter !== "auto") {
    if (delimiter === "\\t" || delimiter === "\t") {
      return "\t";
    }
    return delimiter === "" ? "," : (delimiter[0] ?? ",");
  }

  const candidates = [",", ";", "\t"];
  let bestDelimiter = ",";
  let bestScore = 0;
  for (const candidate of candidates) {
    const score = scoreActivityCsvDelimiter(content, candidate);
    if (score > bestScore) {
      bestScore = score;
      bestDelimiter = candidate;
    }
  }
  return bestDelimiter;
}

function scoreActivityCsvDelimiter(content: string, delimiter: string): number {
  const lines = content.split(/\r?\n/).slice(0, 10);
  if (lines.length === 0) {
    return 0;
  }
  const counts = lines.map((line) => countCharacter(line, delimiter));
  const firstCount = counts[0] ?? 0;
  if (firstCount === 0) {
    return 0;
  }
  return firstCount * counts.filter((count) => count === firstCount).length;
}

function parseActivityCsvContent(
  content: string,
  delimiter: string,
  config: ActivityParseConfig,
  errors: ActivityParseError[],
): { headers: string[]; rows: string[][] } {
  const allRecords = readActivityCsvRecords(content, delimiter, effectiveQuoteChar(config));
  if (allRecords.length === 0) {
    throw new Error("CSV file is empty or contains no valid records");
  }

  const skipTopRows = effectiveSkipTopRows(config);
  if (skipTopRows >= allRecords.length) {
    throw new Error(`Cannot skip ${skipTopRows} rows from a file with ${allRecords.length} rows`);
  }
  const endIndex =
    effectiveSkipBottomRows(config) > 0
      ? allRecords.length - effectiveSkipBottomRows(config)
      : allRecords.length;
  if (skipTopRows >= endIndex) {
    throw new Error("No rows remaining after applying skip settings");
  }

  const workingRecords = allRecords.slice(skipTopRows, endIndex);
  const filteredRecords = effectiveSkipEmptyRows(config)
    ? workingRecords.filter((row) => !row.every((cell) => cell.trim() === ""))
    : workingRecords;
  if (filteredRecords.length === 0) {
    throw new Error("No non-empty rows found in CSV");
  }

  const hasHeader = effectiveHasHeaderRow(config);
  if (!hasHeader) {
    const maxColumns = Math.max(...filteredRecords.map((row) => row.length), 0);
    return {
      headers: Array.from({ length: maxColumns }, (_, index) => `Column${index + 1}`),
      rows: filteredRecords,
    };
  }

  const headerIndex = Math.min(effectiveHeaderRowIndex(config), filteredRecords.length - 1);
  const headers = (filteredRecords[headerIndex] ?? []).map((header) => header.trim());
  const dataRows = filteredRecords.filter((_, index) => index !== headerIndex);
  return { headers, rows: normalizeActivityCsvRows(dataRows, headers.length, errors) };
}

function readActivityCsvRecords(content: string, delimiter: string, quoteChar: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let lastWasTerminator = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (char === quoteChar) {
      if (inQuotes && content[index + 1] === quoteChar) {
        field += quoteChar;
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      lastWasTerminator = false;
      continue;
    }
    if (char === delimiter && !inQuotes) {
      row.push(field);
      field = "";
      lastWasTerminator = false;
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && content[index + 1] === "\n") {
        index += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      lastWasTerminator = true;
      continue;
    }
    field += char;
    lastWasTerminator = false;
  }

  row.push(field);
  if (!lastWasTerminator && (row.length > 1 || row[0] !== "" || content.length > 0)) {
    rows.push(row);
  }
  return rows;
}

function normalizeActivityCsvRows(
  rows: string[][],
  headerCount: number,
  errors: ActivityParseError[],
): string[][] {
  return rows.map((row, index) => {
    if (row.length < headerCount) {
      return [...row, ...Array.from({ length: headerCount - row.length }, () => "")];
    }
    if (row.length > headerCount) {
      errors.push({
        rowIndex: null,
        columnIndex: null,
        message: `Row ${index + 1} has ${row.length} columns, expected ${headerCount}. Extra columns ignored.`,
        errorType: "structure",
      });
      return row.slice(0, headerCount);
    }
    return row;
  });
}

function effectiveHasHeaderRow(config: ActivityParseConfig): boolean {
  return config.hasHeaderRow ?? true;
}

function effectiveHeaderRowIndex(config: ActivityParseConfig): number {
  return config.headerRowIndex ?? 0;
}

function effectiveSkipTopRows(config: ActivityParseConfig): number {
  return config.skipTopRows ?? 0;
}

function effectiveSkipBottomRows(config: ActivityParseConfig): number {
  return config.skipBottomRows ?? 0;
}

function effectiveSkipEmptyRows(config: ActivityParseConfig): boolean {
  return config.skipEmptyRows ?? true;
}

function effectiveQuoteChar(config: ActivityParseConfig): string {
  return config.quoteChar?.[0] ?? '"';
}

function optionalBooleanConfig(input: Record<string, unknown>, field: string): boolean | undefined {
  const value = input[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`Invalid input: config.${field} must be a boolean`);
  }
  return value;
}

function optionalNonNegativeIntegerConfig(
  input: Record<string, unknown>,
  field: string,
): number | undefined {
  const value = input[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid input: config.${field} must be a non-negative integer`);
  }
  return value;
}

function optionalStringConfig(input: Record<string, unknown>, field: string): string | undefined {
  const value = input[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`Invalid input: config.${field} must be a string`);
  }
  return value;
}

function optionalNullableStringConfig(
  input: Record<string, unknown>,
  field: string,
): string | null | undefined {
  const value = input[field];
  if (value === undefined) {
    return null;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`Invalid input: config.${field} must be a string`);
  }
  return value;
}

function countCharacter(input: string, character: string): number {
  let count = 0;
  for (const value of input) {
    if (value === character) {
      count += 1;
    }
  }
  return count;
}

async function previewImportAssets(
  db: Database,
  candidates: unknown[],
  options: ActivityServiceOptions,
): Promise<Record<string, unknown>[]> {
  const searchCache = new Map<string, Promise<SymbolSearchResult[]>>();
  return Promise.all(
    candidates.map((candidate, index) =>
      previewImportAsset(db, candidate, index, options, searchCache),
    ),
  );
}

async function previewImportAsset(
  db: Database,
  input: unknown,
  index: number,
  options: ActivityServiceOptions,
  searchCache: Map<string, Promise<SymbolSearchResult[]>>,
): Promise<Record<string, unknown>> {
  const candidate = isRecord(input) ? input : {};
  const key = optionalTrimmedString(candidate.key) ?? `candidate-${index + 1}`;
  const accountId = optionalTrimmedString(candidate.accountId);
  const symbol = optionalTrimmedString(candidate.symbol);
  const isin = normalizeIsinKey(optionalTrimmedString(candidate.isin));
  const exchangeMic = optionalTrimmedString(candidate.exchangeMic)?.toUpperCase();
  const instrumentType = normalizeInstrumentType(optionalTrimmedString(candidate.instrumentType));
  const rawQuoteMode = typeof candidate.quoteMode === "string" ? candidate.quoteMode : undefined;
  const isManualPreviewQuoteMode = rawQuoteMode?.toUpperCase() === "MANUAL";
  const draftQuoteMode = rawQuoteMode === "MANUAL" ? "MANUAL" : "MARKET";
  const quoteCcy = normalizeImportQuoteCurrency(
    optionalTrimmedString(candidate.quoteCcy) ?? optionalTrimmedString(candidate.currency),
  );
  const errors: Record<string, string[]> = {};
  let accountCurrency: string | undefined;

  if (!accountId) {
    addFieldMessage(errors, "accountId", "Account is required before running backend validation.");
  } else {
    try {
      accountCurrency = normalizeImportQuoteCurrency(readAccountRow(db, accountId).currency);
    } catch (error) {
      addFieldMessage(errors, "general", `Validation failed: ${errorMessage(error)}`);
    }
  }
  if (!symbol) {
    addFieldMessage(errors, "symbol", "Symbol is required for asset preview.");
  } else if (isGarbageSymbol(symbol)) {
    addFieldMessage(errors, "symbol", `Invalid symbol '${symbol}'. Please correct or remove it.`);
  }

  if (Object.keys(errors).length > 0 || !symbol) {
    return importAssetPreviewItem(key, "NEEDS_FIXING", "validation_error", { errors });
  }

  const previewAssetInput = normalizeActivityAssetInputForLookup(
    {
      symbol,
      exchangeMic,
      instrumentType,
      quoteCcy,
    },
    options.exchangeMetadata,
  );
  const previewSymbol = previewAssetInput.symbol ?? symbol;

  try {
    const existingAsset = isin
      ? findExistingAssetByIsin(db, isin)
      : findExistingAssetBySymbol(db, previewAssetInput);
    if (existingAsset) {
      const draft = newAssetDraftFromAssetRow(existingAsset);
      const shouldPreserveImportSymbol =
        previewAssetInput.symbol !== undefined &&
        previewAssetInput.symbol.toUpperCase() !== symbol.toUpperCase();
      return importAssetPreviewItem(key, "EXISTING_ASSET", "existing_asset", {
        assetId: existingAsset.id,
        draft: shouldPreserveImportSymbol
          ? { ...draft, displayCode: symbol, instrumentSymbol: symbol }
          : draft,
      });
    }
  } catch (error) {
    addFieldMessage(errors, "symbol", errorMessage(error));
    return importAssetPreviewItem(key, "NEEDS_FIXING", "ambiguous_existing_asset", { errors });
  }

  let resolvedExchangeMic = previewAssetInput.exchangeMic;
  let resolvedInstrumentType = previewAssetInput.instrumentType;
  let resolvedQuoteCcy = previewAssetInput.quoteCcy;
  let resolvedName: string | undefined;
  const shouldResolveWithProvider =
    !isManualPreviewQuoteMode &&
    (!resolvedInstrumentType ||
      !resolvedQuoteCcy ||
      (resolvedInstrumentType === "EQUITY" && !resolvedExchangeMic) ||
      (resolvedInstrumentType === "EQUITY" && resolvedName === undefined));
  if (shouldResolveWithProvider) {
    const resolution = await resolveImportAssetSymbol(
      previewSymbol,
      resolvedQuoteCcy ?? accountCurrency,
      options,
      searchCache,
      isin,
    );
    resolvedExchangeMic = resolvedExchangeMic ?? resolution?.exchangeMic;
    resolvedInstrumentType = resolvedInstrumentType ?? resolution?.instrumentType;
    resolvedQuoteCcy = resolvedQuoteCcy ?? resolution?.quoteCcy;
    resolvedName = resolution?.name;
  }

  if (!resolvedInstrumentType) {
    addFieldMessage(
      errors,
      "instrumentType",
      "Instrument type is required to preview a new asset.",
    );
  }
  if (!resolvedQuoteCcy) {
    addFieldMessage(errors, "quoteCcy", "Quote currency is required to preview a new asset.");
  }
  if (Object.keys(errors).length > 0 || !resolvedInstrumentType || !resolvedQuoteCcy) {
    return importAssetPreviewItem(key, "NEEDS_FIXING", "validation_error", { errors });
  }

  const draft = newAssetDraftFromImport({
    symbol:
      resolvedInstrumentType === "CRYPTO" || resolvedInstrumentType === "FX"
        ? previewSymbol
        : symbol,
    quoteCcy: resolvedQuoteCcy,
    instrumentType: resolvedInstrumentType,
    exchangeMic: resolvedExchangeMic,
    quoteMode: draftQuoteMode,
    name: resolvedName,
  });
  if (resolvedInstrumentType === "EQUITY" && !resolvedExchangeMic && !isManualPreviewQuoteMode) {
    addFieldMessage(
      errors,
      "symbol",
      `Could not determine the exchange for '${previewSymbol}'. Please search for the correct ticker.`,
    );
    return importAssetPreviewItem(key, "NEEDS_FIXING", "missing_exchange", { draft, errors });
  }

  return importAssetPreviewItem(key, "AUTO_RESOLVED_NEW_ASSET", "provider_resolution", { draft });
}

function importAssetPreviewItem(
  key: string,
  status: string,
  resolutionSource: string,
  options: {
    assetId?: string;
    draft?: Record<string, unknown>;
    errors?: Record<string, string[]>;
    warnings?: Record<string, string[]>;
  } = {},
): Record<string, unknown> {
  return {
    key,
    status,
    resolutionSource,
    ...(options.assetId ? { assetId: options.assetId } : {}),
    ...(options.draft ? { draft: options.draft } : {}),
    ...(options.errors && Object.keys(options.errors).length > 0 ? { errors: options.errors } : {}),
    ...(options.warnings && Object.keys(options.warnings).length > 0
      ? { warnings: options.warnings }
      : {}),
  };
}

interface ImportAssetSymbolResolution {
  symbol?: string;
  exchangeMic: string;
  instrumentType?: string;
  name?: string;
  quoteCcy?: string;
}

async function resolveImportAssetSymbol(
  symbol: string,
  preferredCurrency: string | undefined,
  options: ActivityServiceOptions,
  searchCache: Map<string, Promise<SymbolSearchResult[]>>,
  isin?: string,
): Promise<ImportAssetSymbolResolution | null> {
  if (!options.symbolSearch) {
    return null;
  }

  if (isin) {
    const isinResults = await cachedSymbolSearch(isin, options.symbolSearch, searchCache);
    const isinMatch = isinResults.find((result) => result.exchangeMic?.trim());
    const exchangeMic = isinMatch?.exchangeMic?.trim().toUpperCase();
    if (isinMatch && exchangeMic) {
      return {
        exchangeMic,
        instrumentType: instrumentTypeFromQuoteType(isinMatch.quoteType) ?? undefined,
        name: providerSymbolName(isinMatch, symbol),
        quoteCcy: providerSymbolQuoteCcy(isinMatch, exchangeMic, options.exchangeMetadata),
      };
    }
  }

  const candidates = importAssetSymbolSearchCandidates(
    symbol,
    preferredCurrency,
    options.exchangeMetadata,
  );
  let fallback: ImportAssetSymbolResolution | null = null;
  const preferred = normalizeCurrencyForComparison(preferredCurrency);

  for (const candidate of candidates) {
    const results = await cachedSymbolSearch(candidate, options.symbolSearch, searchCache);
    const first = results[0];
    const exchangeMic = first?.exchangeMic?.trim().toUpperCase();
    if (!exchangeMic) {
      continue;
    }
    const resolution = {
      exchangeMic,
      instrumentType: instrumentTypeFromQuoteType(first.quoteType) ?? undefined,
      name: providerSymbolName(first, symbol),
      quoteCcy: providerSymbolQuoteCcy(first, exchangeMic, options.exchangeMetadata),
    };
    if (preferred && resultMatchesCurrency(first, preferred, options.exchangeMetadata)) {
      return resolution;
    }
    fallback ??= resolution;
  }

  return fallback;
}

function importAssetSymbolSearchCandidates(
  symbol: string,
  preferredCurrency: string | undefined,
  exchangeMetadata: Pick<ExchangeMetadata, "currencyByMic" | "yahooSuffixToMic"> | undefined,
): string[] {
  const trimmed = symbol.trim();
  const candidates = [trimmed];
  const preferred = normalizeCurrencyForComparison(preferredCurrency);
  if (!preferred || trimmed.includes(".") || !exchangeMetadata) {
    return candidates;
  }

  for (const [suffix, mic] of exchangeMetadata.yahooSuffixToMic) {
    const micCurrency = normalizeCurrencyForComparison(exchangeMetadata.currencyByMic.get(mic));
    if (micCurrency !== preferred) {
      continue;
    }
    const suffixed = `${trimmed}.${suffix}`;
    if (!candidates.some((candidate) => candidate.toUpperCase() === suffixed.toUpperCase())) {
      candidates.push(suffixed);
    }
  }
  return candidates;
}

async function cachedSymbolSearch(
  query: string,
  symbolSearch: NonNullable<ActivityServiceOptions["symbolSearch"]>,
  searchCache: Map<string, Promise<SymbolSearchResult[]>>,
): Promise<SymbolSearchResult[]> {
  const key = query.trim().toUpperCase();
  let cached = searchCache.get(key);
  if (!cached) {
    cached = Promise.resolve(symbolSearch(query)).catch(() => []);
    searchCache.set(key, cached);
  }
  return cached;
}

function resultMatchesCurrency(
  result: SymbolSearchResult,
  preferredCurrency: string,
  exchangeMetadata: Pick<ExchangeMetadata, "currencyByMic"> | undefined,
): boolean {
  const micCurrency = result.exchangeMic
    ? exchangeMetadata?.currencyByMic.get(result.exchangeMic.toUpperCase())
    : undefined;
  return (
    normalizeCurrencyForComparison(micCurrency) === preferredCurrency ||
    normalizeCurrencyForComparison(result.currency ?? undefined) === preferredCurrency
  );
}

function providerSymbolQuoteCcy(
  result: SymbolSearchResult,
  exchangeMic: string,
  exchangeMetadata: Pick<ExchangeMetadata, "currencyByMic"> | undefined,
): string | undefined {
  return (
    normalizeImportQuoteCurrency(result.currency ?? undefined) ??
    normalizeImportQuoteCurrency(exchangeMetadata?.currencyByMic.get(exchangeMic))
  );
}

function providerSymbolName(result: SymbolSearchResult, symbol: string): string | undefined {
  const name = result.longName?.trim() || result.shortName?.trim();
  if (!name || name.toUpperCase() === symbol.trim().toUpperCase()) {
    return undefined;
  }
  return name;
}

function normalizeCurrencyForComparison(currency: string | undefined): string | undefined {
  const trimmed = currency?.trim();
  return trimmed ? normalizedCurrencyCode(trimmed).toUpperCase() : undefined;
}

function newAssetDraftFromAssetRow(asset: AssetRow): Record<string, unknown> {
  return {
    id: asset.id,
    kind: asset.kind,
    name: asset.name ?? undefined,
    displayCode: asset.display_code ?? undefined,
    isActive: asset.is_active === 1,
    quoteMode: asset.quote_mode,
    quoteCcy: asset.quote_ccy,
    instrumentType: asset.instrument_type ?? undefined,
    instrumentSymbol: asset.instrument_symbol ?? undefined,
    instrumentExchangeMic: asset.instrument_exchange_mic ?? undefined,
    providerConfig: parseJsonOrNull(asset.provider_config),
    notes: asset.notes ?? undefined,
    metadata: parseJsonOrNull(asset.metadata),
  };
}

function newAssetDraftFromImport(input: {
  symbol: string;
  quoteCcy: string;
  instrumentType: string;
  exchangeMic?: string;
  quoteMode: string;
  name?: string;
}): Record<string, unknown> {
  return {
    id: null,
    kind: input.instrumentType === "FX" ? "FX" : "INVESTMENT",
    name: input.name ?? null,
    displayCode: input.symbol,
    isActive: true,
    quoteMode: input.quoteMode,
    quoteCcy: input.quoteCcy,
    instrumentType: input.instrumentType,
    instrumentSymbol: input.symbol,
    instrumentExchangeMic: input.exchangeMic ?? null,
    providerConfig: null,
    notes: null,
    metadata: null,
  };
}

function normalizeInstrumentType(value: string | undefined): string | undefined {
  switch (value?.trim().toUpperCase()) {
    case "EQUITY":
    case "STOCK":
    case "ETF":
    case "MUTUALFUND":
    case "MUTUAL_FUND":
    case "INDEX":
    case "FUTURE":
    case "FUTURES":
      return "EQUITY";
    case "CRYPTO":
    case "CRYPTOCURRENCY":
      return "CRYPTO";
    case "FX":
    case "FOREX":
    case "CURRENCY":
      return "FX";
    case "OPTION":
      return "OPTION";
    case "METAL":
    case "COMMODITY":
      return "METAL";
    case "BOND":
    case "FIXEDINCOME":
    case "FIXED_INCOME":
    case "DEBT":
    case "MONEYMARKET":
      return "BOND";
    default:
      return undefined;
  }
}

function normalizeQuoteMode(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.toUpperCase() === "MANUAL" ? "MANUAL" : "MARKET";
}

function normalizeImportQuoteCurrency(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return undefined;
  }
  if (trimmed.toUpperCase() === "GBP") {
    return "GBP";
  }
  if (trimmed.toUpperCase() === "GBX") {
    return "GBX";
  }
  if (trimmed === "ZAc" || trimmed.toUpperCase() === "ZAC") {
    return "ZAc";
  }
  if (!/^[A-Za-z]{3,5}$/.test(trimmed)) {
    return undefined;
  }
  return trimmed.toUpperCase();
}

function addFieldMessage(messages: Record<string, string[]>, field: string, message: string): void {
  messages[field] = [...(messages[field] ?? []), message];
}

async function checkActivitiesImportRows(
  db: Database,
  activities: unknown[],
  options: ActivityServiceOptions,
): Promise<Array<Record<string, unknown>>> {
  const assetContext = createActivityAssetResolutionContext(options.exchangeMetadata);
  const searchCache = new Map<string, Promise<SymbolSearchResult[]>>();
  const resolvedActivities = await Promise.all(
    activities.map((activity) =>
      activityImportInputWithProviderResolution(db, activity, options, searchCache),
    ),
  );
  const checked = resolvedActivities.map((activity, index) =>
    checkActivityImportRow(db, activity, index, assetContext),
  );
  const firstIndexByKey = new Map<string, number>();
  const existingByKey = new Map<string, string>();

  for (const [index, row] of checked.entries()) {
    if (!row.idempotencyKey || hasMessageMapEntries(row.activity.errors)) {
      continue;
    }
    const key = row.idempotencyKey;
    if (!firstIndexByKey.has(key)) {
      firstIndexByKey.set(key, index);
      const existingId = findActivityIdByIdempotencyKey(db, key);
      if (existingId) {
        existingByKey.set(key, existingId);
      }
    }
  }

  for (const [index, row] of checked.entries()) {
    if (!row.idempotencyKey || hasMessageMapEntries(row.activity.errors)) {
      continue;
    }
    const existingId = existingByKey.get(row.idempotencyKey);
    if (existingId) {
      addImportWarning(row.activity, "_duplicate", "Duplicate activity already exists");
      row.activity.duplicateOfId = existingId;
      continue;
    }
    const firstIndex = firstIndexByKey.get(row.idempotencyKey);
    if (firstIndex !== undefined && firstIndex !== index) {
      const duplicateLineNumber =
        numericField(checked[firstIndex]?.activity.lineNumber) ?? firstIndex + 1;
      addImportWarning(
        row.activity,
        "_duplicate",
        `Duplicate of line ${duplicateLineNumber} in this import batch`,
      );
      row.activity.duplicateOfLineNumber = duplicateLineNumber;
    }
  }

  return checked.map(({ activity }) => finalizeImportActivity(activity));
}

async function activityImportInputWithProviderResolution(
  db: Database,
  input: unknown,
  options: ActivityServiceOptions,
  searchCache: Map<string, Promise<SymbolSearchResult[]>>,
): Promise<unknown> {
  if (!options.symbolSearch || !isRecord(input)) {
    return input;
  }

  const accountId = optionalTrimmedString(input.accountId);
  const activityType = optionalTrimmedString(input.activityType);
  const subtype = optionalTrimmedString(input.subtype);
  const symbol = optionalTrimmedString(input.symbol);
  const assetId = optionalTrimmedString(input.assetId);
  const exchangeMic = optionalTrimmedString(input.exchangeMic);
  const quoteMode = normalizeQuoteMode(
    typeof input.quoteMode === "string" ? input.quoteMode : undefined,
  );
  const disposition: ImportSymbolDisposition =
    activityType && symbol
      ? importSymbolDisposition(
          activityType,
          subtype ?? null,
          symbol,
          parseOptionalImportDecimal(input.quantity),
          parseOptionalImportDecimal(input.unitPrice),
        )
      : { kind: "cash" };
  if (
    !accountId ||
    !activityType ||
    !symbol ||
    assetId ||
    exchangeMic ||
    quoteMode === "MANUAL" ||
    disposition.kind !== "resolve"
  ) {
    return input;
  }

  let accountCurrency: string;
  try {
    accountCurrency = readAccountRow(db, accountId).currency;
  } catch (error) {
    if (!errorMessage(error).startsWith("Record not found: account ")) {
      throw error;
    }
    return input;
  }

  const preferredCurrency =
    normalizeImportQuoteCurrency(optionalTrimmedString(input.currency)) ??
    normalizeImportQuoteCurrency(accountCurrency);
  const isin = normalizeIsinKey(optionalTrimmedString(input.isin));
  if (isin) {
    const existingIsinAsset = findExistingAssetByIsin(db, isin);
    const existingIsinResolution = existingIsinAsset
      ? importAssetSymbolResolutionFromAsset(existingIsinAsset)
      : null;
    if (existingIsinResolution) {
      return importInputWithSymbolResolution(input, existingIsinResolution, preferredCurrency);
    }
  } else {
    try {
      const existingAssetInput = normalizeActivityAssetInputForLookup(
        {
          symbol,
          instrumentType: normalizeInstrumentType(optionalTrimmedString(input.instrumentType)),
          quoteCcy: normalizeImportQuoteCurrency(optionalTrimmedString(input.quoteCcy)),
        },
        options.exchangeMetadata,
      );
      const existingAsset = findExistingAssetBySymbol(db, existingAssetInput);
      if (existingAsset) {
        const existingResolution = importAssetSymbolResolutionFromAsset(
          existingAsset,
          existingAssetInput.symbol,
        );
        return existingResolution
          ? importInputWithSymbolResolution(input, existingResolution, preferredCurrency)
          : input;
      }
    } catch (error) {
      if (!errorMessage(error).startsWith("Multiple existing assets match symbol ")) {
        throw error;
      }
    }
  }

  const resolution = await resolveImportAssetSymbol(
    symbol,
    preferredCurrency,
    options,
    searchCache,
    isin,
  );
  if (!resolution) {
    return input;
  }

  return importInputWithSymbolResolution(input, resolution, preferredCurrency);
}

function normalizeIsinKey(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toUpperCase() : undefined;
}

function importInputWithSymbolResolution(
  input: Record<string, unknown>,
  resolution: ImportAssetSymbolResolution,
  preferredCurrency: string | undefined,
): Record<string, unknown> {
  return {
    ...input,
    ...(resolution.symbol ? { symbol: resolution.symbol } : {}),
    exchangeMic: resolution.exchangeMic,
    instrumentType:
      optionalTrimmedString(input.instrumentType) ?? resolution.instrumentType ?? "EQUITY",
    quoteCcy: optionalTrimmedString(input.quoteCcy) ?? resolution.quoteCcy ?? preferredCurrency,
    ...(!optionalTrimmedString(input.symbolName) &&
    !optionalTrimmedString(input.assetName) &&
    !optionalTrimmedString(input.name) &&
    resolution.name
      ? { symbolName: resolution.name }
      : {}),
  };
}

function importAssetSymbolResolutionFromAsset(
  asset: AssetRow,
  symbol?: string,
): ImportAssetSymbolResolution | null {
  const exchangeMic = asset.instrument_exchange_mic?.trim().toUpperCase();
  if (!exchangeMic) {
    return null;
  }
  return {
    symbol,
    exchangeMic,
    instrumentType: normalizeInstrumentType(asset.instrument_type ?? undefined),
    name: asset.name ?? undefined,
    quoteCcy: normalizeImportQuoteCurrency(asset.quote_ccy),
  };
}

function checkActivityImportRow(
  db: Database,
  input: unknown,
  index: number,
  assetContext: ActivityAssetResolutionContext,
): { activity: Record<string, unknown>; idempotencyKey: string | null } {
  const activity = isRecord(input) ? { ...input } : {};
  const errors = cloneMessageMap(activity.errors);
  const accountId = optionalTrimmedString(activity.accountId);
  const activityType = optionalTrimmedString(activity.activityType);
  const assetId = optionalTrimmedString(activity.assetId);
  let account: AccountRow | null = null;

  activity.lineNumber = numericField(activity.lineNumber) ?? index + 1;

  if (!accountId) {
    addFieldMessage(errors, "accountId", "Account is required before running backend validation.");
  } else {
    try {
      account = readAccountRow(db, accountId);
      activity.accountId = account.id;
      if (!optionalTrimmedString(activity.accountName)) {
        activity.accountName = account.name;
      }
    } catch (error) {
      addFieldMessage(errors, "general", `Validation failed: ${errorMessage(error)}`);
    }
  }
  if (!activityType) {
    addFieldMessage(errors, "activityType", "Activity type is required.");
  }
  if (assetId) {
    const existingAsset = findAssetRowById(db, assetId);
    if (existingAsset) {
      hydrateImportActivityFromAssetRow(activity, existingAsset);
    }
  }
  if (activityType) {
    normalizeImportActivitySubtype(activity, activityType);
  }

  if (Object.keys(errors).length > 0 || !accountId || !activityType) {
    activity.isValid = false;
    activity.errors = errors;
    return { activity, idempotencyKey: null };
  }

  const symbol = optionalTrimmedString(activity.symbol);
  const subtype = optionalTrimmedString(activity.subtype);
  const quantity = parseOptionalImportDecimal(activity.quantity);
  const unitPrice = parseOptionalImportDecimal(activity.unitPrice);
  const disposition = importSymbolDisposition(
    activityType,
    subtype ?? null,
    symbol ?? "",
    quantity,
    unitPrice,
  );
  if (disposition.kind === "needs_review") {
    addFieldMessage(errors, "symbol", disposition.message);
    activity.isValid = false;
    activity.errors = errors;
    return { activity, idempotencyKey: null };
  }
  const needsAsset = disposition.kind === "resolve";
  if (needsAsset && !symbol && !assetId) {
    addFieldMessage(errors, "symbol", `Symbol is required for ${activityType} activities.`);
    activity.isValid = false;
    activity.errors = errors;
    return { activity, idempotencyKey: null };
  }
  if (needsAsset && symbol && !assetId && isGarbageSymbol(symbol)) {
    addFieldMessage(errors, "symbol", `Invalid symbol '${symbol}'. Please correct or remove it.`);
    activity.isValid = false;
    activity.errors = errors;
    return { activity, idempotencyKey: null };
  }
  const createInput: Record<string, unknown> = {
    id: optionalTrimmedString(activity.id),
    accountId,
    activityType,
    subtype,
    activityDate: activity.quoteActivityDate ?? activity.date ?? activity.activityDate,
    quantity: activity.quantity,
    unitPrice: activity.unitPrice,
    amount: activity.amount,
    fee: activity.fee,
    currency: optionalTrimmedString(activity.currency) ?? account?.currency,
    comment: activity.comment,
    fxRate: activity.fxRate,
    allowMissingAsset: !needsAsset,
  };
  if (assetId) {
    createInput.asset = activityAssetInputFromImportFields(activity, assetId, symbol);
  } else if (needsAsset && symbol) {
    createInput.asset = activityAssetInputFromImportFields(activity, undefined, symbol);
  }

  try {
    const normalized = normalizeActivityCreateInput(db, createInput, assetContext);
    activity.id = optionalTrimmedString(activity.id) ?? normalized.id;
    activity.accountId = normalized.accountId;
    activity.date = normalized.activityDate;
    activity.quoteActivityDate = normalized.quoteActivityDate;
    activity.currency = normalized.currency;
    validateImportActivityCurrency(errors, activity.currency, account?.currency ?? "");
    activity.amount = normalized.amount?.toString() ?? null;
    activity.quantity = normalized.quantity?.toString() ?? null;
    activity.unitPrice = normalized.unitPrice?.toString() ?? null;
    activity.fee = normalized.fee?.toString() ?? null;
    activity.fxRate = normalized.fxRate?.toString() ?? null;
    activity.assetId = normalized.assetId ?? undefined;
    if (normalized.assetId) {
      const normalizedAssetInput = symbol
        ? normalizeActivityAssetInputForLookup(
            activityAssetInputFromImportFields(activity, undefined, symbol),
            assetContext.exchangeMetadata,
          )
        : undefined;
      const existingAsset = findAssetRowById(db, normalized.assetId);
      if (existingAsset) {
        hydrateImportActivityFromAssetRow(activity, existingAsset, normalizedAssetInput?.symbol);
      } else {
        const pendingAsset = assetContext.pendingAssetsById.get(normalized.assetId);
        if (pendingAsset) {
          hydrateImportActivityFromPendingAsset(
            activity,
            pendingAsset,
            normalizedAssetInput?.symbol,
          );
        } else if (!optionalTrimmedString(activity.symbolName) && normalizedAssetInput?.symbol) {
          activity.symbolName = normalizedAssetInput.symbol;
        }
      }
    }
    if (normalized.assetId === null && !needsAsset) {
      activity.symbol = "";
      activity.exchangeMic = undefined;
      activity.quoteCcy = undefined;
      activity.instrumentType = undefined;
    }
    activity.isValid = true;
    activity.errors = errors;
    return { activity, idempotencyKey: normalized.idempotencyKey };
  } catch (error) {
    const message = errorMessage(error);
    if (message.startsWith("Exchange MIC is required to create market asset ") && symbol) {
      addFieldMessage(
        errors,
        "symbol",
        `Could not find '${symbol}' in market data. Please search for the correct ticker symbol.`,
      );
    } else {
      addFieldMessage(errors, importValidationField(error), message);
    }
    activity.isValid = false;
    activity.errors = errors;
    return { activity, idempotencyKey: null };
  }
}

function normalizeImportActivitySubtype(
  activity: Record<string, unknown>,
  activityType: string,
): void {
  const rawSubtype = optionalTrimmedString(activity.subtype);
  if (!rawSubtype) {
    delete activity.subtype;
    return;
  }
  const subtype = canonicalizeActivitySubtype(rawSubtype);
  if (subtype.toUpperCase() === activityType.toUpperCase()) {
    delete activity.subtype;
    return;
  }
  activity.subtype = subtype;
}

function validateImportActivityCurrency(
  errors: Record<string, string[]>,
  currency: unknown,
  accountCurrency: string,
): void {
  const activityCurrency = optionalTrimmedString(currency) ?? "";
  if (!activityCurrency) {
    addFieldMessage(errors, "currency", "Activity currency is missing in the import data.");
    return;
  }
  if (activityCurrency === accountCurrency) {
    return;
  }
  if (
    !isThreeLetterAlphabeticCurrency(accountCurrency) ||
    !isThreeLetterAlphabeticCurrency(activityCurrency)
  ) {
    addFieldMessage(
      errors,
      "currency",
      `Invalid currency code: ${accountCurrency} or ${activityCurrency}`,
    );
  }
}

function isThreeLetterAlphabeticCurrency(value: string): boolean {
  return /^[A-Za-z]{3}$/.test(value);
}

function hydrateImportActivityFromAssetRow(
  activity: Record<string, unknown>,
  asset: AssetRow,
  normalizedSymbol?: string,
): void {
  const symbol =
    normalizedSymbol ??
    optionalTrimmedString(activity.symbol) ??
    asset.display_code ??
    asset.instrument_symbol ??
    undefined;
  if (normalizedSymbol || !optionalTrimmedString(activity.symbol)) {
    activity.symbol = symbol;
  }
  if (!optionalTrimmedString(activity.symbolName) && asset.name) {
    activity.symbolName = asset.name;
  }
  if (!optionalTrimmedString(activity.exchangeMic) && asset.instrument_exchange_mic) {
    activity.exchangeMic = asset.instrument_exchange_mic;
  }
  if (!optionalTrimmedString(activity.quoteCcy)) {
    activity.quoteCcy = asset.quote_ccy;
  }
  if (!optionalTrimmedString(activity.instrumentType) && asset.instrument_type) {
    activity.instrumentType = asset.instrument_type;
  }
  if (!optionalTrimmedString(activity.quoteMode)) {
    activity.quoteMode = asset.quote_mode;
  }
  if (!optionalTrimmedString(activity.currency)) {
    activity.currency = asset.quote_ccy;
  }
}

function hydrateImportActivityFromPendingAsset(
  activity: Record<string, unknown>,
  asset: PendingActivityAsset,
  normalizedSymbol?: string,
): void {
  if (normalizedSymbol || !optionalTrimmedString(activity.symbol)) {
    activity.symbol = normalizedSymbol ?? asset.displayCode;
  }
  if (!optionalTrimmedString(activity.symbolName)) {
    activity.symbolName = asset.name ?? normalizedSymbol ?? asset.displayCode;
  }
  if (!optionalTrimmedString(activity.exchangeMic) && asset.instrumentExchangeMic) {
    activity.exchangeMic = asset.instrumentExchangeMic;
  }
  if (!optionalTrimmedString(activity.quoteCcy)) {
    activity.quoteCcy = asset.quoteCcy;
  }
  if (!optionalTrimmedString(activity.instrumentType)) {
    activity.instrumentType = asset.instrumentType;
  }
}

function finalizeImportActivity(activity: Record<string, unknown>): Record<string, unknown> {
  if (!hasMessageMapEntries(activity.errors)) {
    delete activity.errors;
    activity.isValid = true;
  } else {
    activity.isValid = false;
  }
  if (!hasMessageMapEntries(activity.warnings)) {
    delete activity.warnings;
  }
  return activity;
}

function addImportWarning(activity: Record<string, unknown>, field: string, message: string): void {
  const warnings = cloneMessageMap(activity.warnings);
  addFieldMessage(warnings, field, message);
  activity.warnings = warnings;
}

function cloneMessageMap(value: unknown): Record<string, string[]> {
  if (!isRecord(value)) {
    return {};
  }
  const messages: Record<string, string[]> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!Array.isArray(entry)) {
      continue;
    }
    const strings = entry.filter((message): message is string => typeof message === "string");
    if (strings.length > 0) {
      messages[key] = strings;
    }
  }
  return messages;
}

function hasMessageMapEntries(value: unknown): boolean {
  return Object.keys(cloneMessageMap(value)).length > 0;
}

function numericField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function importValidationField(error: unknown): string {
  const message = errorMessage(error);
  if (/account/i.test(message)) {
    return "accountId";
  }
  if (/symbol|asset/i.test(message)) {
    return "symbol";
  }
  if (/date/i.test(message)) {
    return "date";
  }
  if (/quantity/i.test(message)) {
    return "quantity";
  }
  if (/price|amount|cash|split/i.test(message)) {
    return "amount";
  }
  return "general";
}

interface PreparedImportActivity {
  index: number;
  activity: Record<string, unknown>;
  create: ActivityCreateRowInput;
  forceImport: boolean;
}

async function importActivityRows(
  db: Database,
  activities: unknown[],
  options: ActivityServiceOptions,
): Promise<ImportActivitiesResult> {
  const total = activities.length;
  const ordered: Array<Record<string, unknown> | null> = Array.from({ length: total }, () => null);
  const validInputs: Array<{ index: number; activity: Record<string, unknown> }> = [];
  const assetContext = createActivityAssetResolutionContext(options.exchangeMetadata);
  const searchCache = new Map<string, Promise<SymbolSearchResult[]>>();
  let hasValidationErrors = false;

  for (const [index, input] of activities.entries()) {
    const activity = isRecord(input) ? { ...input } : {};
    activity.lineNumber = numericField(activity.lineNumber) ?? index + 1;
    const accountId = optionalTrimmedString(activity.accountId);
    if (!accountId) {
      addImportError(activity, "accountId", "Account is required before importing activities.");
      activity.isValid = false;
      ordered[index] = activity;
      hasValidationErrors = true;
      continue;
    }
    activity.accountId = accountId;
    validInputs.push({ index, activity });
  }

  if (validInputs.length === 0) {
    return {
      activities: ordered.flatMap((activity) => (activity === null ? [] : [activity])),
      importRunId: "",
      summary: {
        total,
        imported: 0,
        skipped: total,
        duplicates: 0,
        assetsCreated: 0,
        success: false,
        errorMessage: "Account is required for all activities.",
      },
    };
  }

  const prepared: PreparedImportActivity[] = [];
  for (const { index, activity } of validInputs) {
    const errors = cloneMessageMap(activity.errors);
    try {
      const resolvedActivity = await activityImportInputWithProviderResolution(
        db,
        activity,
        options,
        searchCache,
      );
      if (isRecord(resolvedActivity)) {
        Object.assign(activity, resolvedActivity);
      }
      const accountCurrency = readAccountRow(
        db,
        optionalTrimmedString(activity.accountId) ?? "",
      ).currency;
      normalizeImportActivityForApply(activity, accountCurrency);
      const createInput = importActivityCreateInput(activity);
      collectImportApplyPreflightErrors(activity, errors);

      if (hasMessageMapEntries(errors)) {
        activity.errors = errors;
        activity.isValid = false;
        ordered[index] = activity;
        hasValidationErrors = true;
        continue;
      }

      const create = normalizeActivityCreateInput(db, createInput, assetContext);
      const explicitId = optionalTrimmedString(activity.id);
      if (explicitId) {
        create.id = explicitId;
      }
      create.sourceSystem = "CSV";
      create.importRunId = null;
      copyNormalizedImportFields(activity, create);
      prepared.push({
        index,
        activity,
        create,
        forceImport: activity.forceImport === true,
      });
      ordered[index] = activity;
    } catch (error) {
      addFieldMessage(errors, importValidationField(error), errorMessage(error));
      activity.errors = errors;
      activity.isValid = false;
      ordered[index] = activity;
      hasValidationErrors = true;
    }
  }

  if (hasValidationErrors) {
    return {
      activities: ordered.flatMap((activity) =>
        activity === null ? [] : [finalizeImportActivity(activity)],
      ),
      importRunId: "",
      summary: {
        total,
        imported: 0,
        skipped: ordered.filter(
          (activity) => activity === null || !finalizeImportActivity(activity).isValid,
        ).length,
        duplicates: 0,
        assetsCreated: 0,
        success: false,
        errorMessage: "Validation errors found in activities.",
      },
    };
  }

  const firstPositionByKey = new Map<string, number>();
  const existingByKey = new Map<string, string>();
  for (const [position, row] of prepared.entries()) {
    const key = row.create.idempotencyKey;
    if (!key || firstPositionByKey.has(key)) {
      continue;
    }
    firstPositionByKey.set(key, position);
    const existingId = findActivityIdByIdempotencyKey(db, key);
    if (existingId) {
      existingByKey.set(key, existingId);
    }
  }

  let duplicateCount = 0;
  const insertable: PreparedImportActivity[] = [];
  for (const [position, row] of prepared.entries()) {
    const key = row.create.idempotencyKey;
    if (!key) {
      insertable.push(row);
      continue;
    }

    const existingId = existingByKey.get(key);
    if (existingId) {
      if (row.forceImport) {
        row.create.idempotencyKey = null;
        insertable.push(row);
      } else {
        addImportWarning(row.activity, "_duplicate", "Duplicate activity already exists");
        row.activity.duplicateOfId = existingId;
        duplicateCount += 1;
      }
      continue;
    }

    const firstPosition = firstPositionByKey.get(key);
    if (firstPosition !== undefined && firstPosition !== position) {
      if (row.forceImport) {
        row.create.idempotencyKey = null;
        insertable.push(row);
      } else {
        const duplicateLineNumber =
          numericField(prepared[firstPosition]?.activity.lineNumber) ?? firstPosition + 1;
        addImportWarning(
          row.activity,
          "_duplicate",
          `Duplicate of line ${duplicateLineNumber} in this import batch`,
        );
        row.activity.duplicateOfLineNumber = duplicateLineNumber;
        duplicateCount += 1;
      }
      continue;
    }

    insertable.push(row);
  }

  linkImportedTransferPairs(insertable);
  reuseExistingAssetsForPendingImports(db, assetContext, insertable);
  const fxPairs = collectImportFxPairs(db, insertable, assetContext);
  if (fxPairs.length > 0 && options.ensureFxPairs) {
    await options.ensureFxPairs(fxPairs);
    reuseExistingAssetsForPendingImports(db, assetContext, insertable);
  }

  const summary: ImportActivitiesSummary = {
    total,
    imported: insertable.length,
    skipped: duplicateCount,
    duplicates: duplicateCount,
    assetsCreated: pendingActivityAssetIdsForCreates(assetContext, insertable).size,
    success: true,
    errorMessage: null,
  };
  const pendingAssetIds = pendingActivityAssetIdsForCreates(assetContext, insertable);

  const result = db.transaction(() => {
    ensurePendingActivityAssets(db, assetContext, pendingAssetIds, insertable);
    const createdAssetIds = [...assetContext.createdAssetIds];
    const importRun = insertCompletedImportRun(db, prepared[0]?.create.accountId ?? "", summary);
    const syncInputs: ActivitySyncInput[] = [];
    const quoteModeUpdatedAssetIds = new Set<string>();

    try {
      for (const row of insertable) {
        row.create.importRunId = importRun.id;
        applyActivityQuoteSideEffects(
          db,
          row.create,
          row.create.assetQuoteMode,
          true,
          quoteModeUpdatedAssetIds,
        );
        insertActivityRow(db, row.create);
        syncInputs.push({ operation: "Create", row: readActivityRow(db, row.create.id) });
      }
    } catch (error) {
      throw mapActivitySqliteError(error);
    }

    for (const row of prepared) {
      ordered[row.index] = finalizeImportActivity(row.activity);
    }

    return {
      activities: ordered.flatMap((activity) => (activity === null ? [] : [activity])),
      importRunId: importRun.id,
      summary,
      syncEvents: [
        ...assetSyncEvents(readAssetSyncRows(db, createdAssetIds), "Create"),
        ...assetSyncEvents(
          readAssetSyncRows(db, existingUpdatedAssetIds(quoteModeUpdatedAssetIds, createdAssetIds)),
          "Update",
        ),
        ...importRunSyncEvents(importRun),
        ...activitySyncEvents(syncInputs),
      ],
    };
  })();
  if (summary.imported > 0) {
    publishAssetsCreated(options.eventBus, [...assetContext.createdAssetIds]);
    queueActivitySyncEvents(options, result.syncEvents);
    publishActivitiesChanged(
      options.eventBus,
      insertable.map((row) => activityEventRecordFromCreate(row.create)),
    );
  }
  return result;
}

function importActivityCreateInput(activity: Record<string, unknown>): Record<string, unknown> {
  const activityType = optionalTrimmedString(activity.activityType);
  const subtype = optionalTrimmedString(activity.subtype);
  const symbol = optionalTrimmedString(activity.symbol);
  const assetId = optionalTrimmedString(activity.assetId);
  const disposition: ImportSymbolDisposition =
    activityType && symbol
      ? importSymbolDisposition(
          activityType,
          subtype ?? null,
          symbol,
          parseOptionalImportDecimal(activity.quantity),
          parseOptionalImportDecimal(activity.unitPrice),
        )
      : { kind: "cash" };
  const shouldResolveAsset = disposition.kind === "resolve";
  const createInput: Record<string, unknown> = {
    id: optionalTrimmedString(activity.id),
    accountId: optionalTrimmedString(activity.accountId),
    activityType,
    subtype,
    activityDate: activity.quoteActivityDate ?? activity.date ?? activity.activityDate,
    quantity: activity.quantity,
    unitPrice: activity.unitPrice,
    amount: activity.amount,
    fee: activity.fee,
    currency: activity.currency,
    comment: activity.comment,
    fxRate: activity.fxRate,
    sourceSystem: "CSV",
    status: activity.isDraft === true ? "DRAFT" : "POSTED",
    metadata: importActivityMetadata(activity),
    allowMissingAsset: disposition.kind === "cash",
  };
  if (assetId) {
    createInput.asset = activityAssetInputFromImportFields(activity, assetId, symbol);
  } else if (shouldResolveAsset && symbol) {
    createInput.asset = activityAssetInputFromImportFields(activity, undefined, symbol);
  }
  return createInput;
}

function activityAssetInputFromImportFields(
  activity: Record<string, unknown>,
  id: string | undefined,
  symbol: string | undefined,
): Record<string, unknown> {
  return {
    id,
    symbol,
    exchangeMic: optionalTrimmedString(activity.exchangeMic),
    instrumentType: optionalTrimmedString(activity.instrumentType),
    quoteCcy: optionalTrimmedString(activity.quoteCcy),
    quoteMode: typeof activity.quoteMode === "string" ? activity.quoteMode : undefined,
    kind: optionalTrimmedString(activity.assetKind) ?? optionalTrimmedString(activity.kind),
    name:
      optionalTrimmedString(activity.assetName) ??
      optionalTrimmedString(activity.symbolName) ??
      optionalTrimmedString(activity.name),
  };
}

function importActivityMetadata(activity: Record<string, unknown>): Record<string, unknown> | null {
  const activityType = optionalTrimmedString(activity.activityType);
  if (
    activity.isExternal === true &&
    (activityType === "TRANSFER_IN" || activityType === "TRANSFER_OUT")
  ) {
    return { flow: { is_external: true } };
  }
  return null;
}

function collectImportApplyPreflightErrors(
  activity: Record<string, unknown>,
  errors: Record<string, string[]>,
): void {
  const rawDate = activity.date ?? activity.activityDate;
  try {
    normalizeActivityDateInput(rawDate);
  } catch {
    addFieldMessage(errors, "symbol", `Invalid date '${String(rawDate ?? "")}'.`);
  }

  const activityType = optionalTrimmedString(activity.activityType);
  if (!activityType) {
    addFieldMessage(errors, "activityType", "Activity type is required.");
    return;
  }

  const subtype = normalizeCreateSubtype(activity.subtype);
  const symbol = optionalTrimmedString(activity.symbol);
  const assetId = optionalTrimmedString(activity.assetId);
  const quantity = parseOptionalImportDecimal(activity.quantity);
  const unitPrice = parseOptionalImportDecimal(activity.unitPrice);
  const amount = parseOptionalImportDecimal(activity.amount);

  if (isAssetBackedIncomeSubtype(activityType, subtype)) {
    try {
      validateAssetBackedIncomeValues(
        activityType,
        subtype,
        quantity?.abs() ?? null,
        unitPrice?.abs() ?? null,
        amount?.abs() ?? null,
      );
    } catch (error) {
      const message = errorMessage(error);
      addFieldMessage(errors, importAssetBackedIncomeField(message), message);
    }
  }

  const disposition = importSymbolDisposition(
    activityType,
    subtype,
    symbol ?? "",
    quantity,
    unitPrice,
  );
  if (disposition.kind === "needs_review") {
    addFieldMessage(errors, "symbol", disposition.message);
    return;
  }
  const needsAsset = disposition.kind === "resolve";

  if (needsAsset && !symbol && !assetId) {
    addFieldMessage(errors, "symbol", "Symbol or asset_id is required to import this activity.");
    return;
  }

  if (needsAsset && symbol && !assetId) {
    if (isGarbageSymbol(symbol)) {
      addFieldMessage(errors, "symbol", `Invalid symbol '${symbol}'. Please correct or remove it.`);
      return;
    }
    if (!optionalTrimmedString(activity.quoteCcy)) {
      addFieldMessage(
        errors,
        "quoteCcy",
        "Price currency (quoteCcy) is required to import this activity.",
      );
    }
    if (!optionalTrimmedString(activity.instrumentType)) {
      addFieldMessage(
        errors,
        "instrumentType",
        "Instrument type is required to import this activity.",
      );
    }
  }
}

function normalizeImportActivityForApply(
  activity: Record<string, unknown>,
  accountCurrency: string,
): void {
  const activityType = optionalTrimmedString(activity.activityType);
  if (!activityType) {
    return;
  }

  normalizeImportActivitySubtype(activity, activityType);
  if (activityType === "SPLIT") {
    const currency = optionalTrimmedString(activity.currency) ?? "";
    if (!isThreeLetterAlphabeticCurrency(currency)) {
      activity.currency = accountCurrency;
    }
  }
}

function parseOptionalImportDecimal(value: unknown): Decimal | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string" && typeof value !== "number" && !(value instanceof Decimal)) {
    return null;
  }
  try {
    return new Decimal(value);
  } catch {
    return null;
  }
}

function importAssetBackedIncomeField(message: string): string {
  if (message.includes("positive quantity")) {
    return "quantity";
  }
  if (message.includes("Income amount")) {
    return "amount";
  }
  return "unitPrice";
}

function copyNormalizedImportFields(
  activity: Record<string, unknown>,
  create: ActivityCreateRowInput,
): void {
  activity.id = create.id;
  activity.accountId = create.accountId;
  activity.assetId = create.assetId ?? undefined;
  activity.date = create.activityDate;
  activity.quoteActivityDate = activity.quoteActivityDate ?? create.quoteActivityDate;
  activity.currency = create.currency;
  activity.amount = create.amount?.toString() ?? null;
  activity.quantity = create.quantity?.toString() ?? null;
  activity.unitPrice = create.unitPrice?.toString() ?? null;
  activity.fee = create.fee?.toString() ?? null;
  activity.fxRate = create.fxRate?.toString() ?? null;
  if (create.assetId === null && !requiresAssetIdentity(create.activityType, create.subtype)) {
    activity.symbol = "";
    activity.exchangeMic = undefined;
    activity.quoteCcy = undefined;
    activity.instrumentType = undefined;
  }
  activity.isValid = true;
  delete activity.errors;
}

function linkImportedTransferPairs(rows: PreparedImportActivity[]): void {
  const grouped = new Map<string, { transferIn: number[]; transferOut: number[] }>();

  for (const [index, row] of rows.entries()) {
    const key = importTransferMatchKey(row);
    if (!key) {
      continue;
    }
    const group = grouped.get(key) ?? { transferIn: [], transferOut: [] };
    if (row.create.activityType === "TRANSFER_IN") {
      group.transferIn.push(index);
    } else {
      group.transferOut.push(index);
    }
    grouped.set(key, group);
  }

  for (const group of grouped.values()) {
    const usedTransferOut = new Set<number>();
    for (const transferInIndex of group.transferIn) {
      const transferOutIndex = group.transferOut.find((candidate) => {
        const inRow = rows[transferInIndex];
        const outRow = rows[candidate];
        return (
          !usedTransferOut.has(candidate) &&
          inRow !== undefined &&
          outRow !== undefined &&
          inRow.create.accountId !== outRow.create.accountId
        );
      });
      if (transferOutIndex === undefined) {
        continue;
      }
      const transferInRow = rows[transferInIndex];
      const transferOutRow = rows[transferOutIndex];
      if (!transferInRow || !transferOutRow) {
        continue;
      }
      usedTransferOut.add(transferOutIndex);
      const sourceGroupId = crypto.randomUUID();
      applyImportedTransferLink(transferInRow, sourceGroupId);
      applyImportedTransferLink(transferOutRow, sourceGroupId);
    }
  }
}

function importTransferMatchKey(row: PreparedImportActivity): string | null {
  if (row.create.activityType !== "TRANSFER_IN" && row.create.activityType !== "TRANSFER_OUT") {
    return null;
  }
  const amount =
    row.create.amount ??
    (row.create.quantity !== null && row.create.unitPrice !== null
      ? row.create.quantity.mul(row.create.unitPrice)
      : null);
  if (amount === null || amount.isZero()) {
    return null;
  }
  const symbol = typeof row.activity.symbol === "string" ? row.activity.symbol : "";
  return [
    row.create.activityDate.slice(0, 10),
    row.create.currency,
    symbol,
    decimalToCanonicalString(amount),
  ].join("\u001f");
}

function applyImportedTransferLink(row: PreparedImportActivity, sourceGroupId: string): void {
  row.create.sourceGroupId = sourceGroupId;
  row.create.metadata = setTransferFlowExternal(row.create.metadata, false);
  row.activity.sourceGroupId = sourceGroupId;
}

function collectImportFxPairs(
  db: Database,
  rows: PreparedImportActivity[],
  assetContext?: ActivityAssetResolutionContext,
): Array<[string, string]> {
  const pairs = new Map<string, [string, string]>();
  for (const row of rows) {
    const account = readAccountRow(db, row.create.accountId);
    const accountCurrency = resolveCurrency([account.currency]);
    const activityCurrency = row.create.currency;
    addImportFxPair(pairs, activityCurrency, accountCurrency);

    if (row.create.assetId) {
      const asset = readResolvedActivityAssetRow(db, row.create.assetId, assetContext);
      addImportFxPair(pairs, asset.quote_ccy, accountCurrency, activityCurrency);
    }
  }
  return [...pairs.values()];
}

function collectActivityFxPairs(
  db: Database,
  activity: ActivityCreateRowInput | ActivityRow,
  assetContext?: ActivityAssetResolutionContext,
): Array<[string, string]> {
  const pairs = new Map<string, [string, string]>();
  const accountId = "accountId" in activity ? activity.accountId : activity.account_id;
  const assetId = "assetId" in activity ? activity.assetId : activity.asset_id;
  const account = readAccountRow(db, accountId);
  const accountCurrency = resolveCurrency([account.currency]);
  const activityCurrency = activity.currency;
  addImportFxPair(pairs, activityCurrency, accountCurrency);

  if (assetId) {
    const asset = readResolvedActivityAssetRow(db, assetId, assetContext);
    addImportFxPair(pairs, asset.quote_ccy, accountCurrency, activityCurrency);
  }

  return [...pairs.values()];
}

function collectBulkActivityFxPairs(
  db: Database,
  prepared: PreparedBulkActivityMutation,
): Array<[string, string]> {
  const pairs = new Map<string, [string, string]>();
  for (const { activity } of prepared.preparedUpdates) {
    for (const pair of collectActivityFxPairs(db, activity, prepared.assetContext)) {
      addImportFxPair(pairs, pair[0], pair[1]);
    }
  }
  for (const { activity } of prepared.preparedCreates) {
    for (const pair of collectActivityFxPairs(db, activity, prepared.assetContext)) {
      addImportFxPair(pairs, pair[0], pair[1]);
    }
  }
  return [...pairs.values()];
}

function addImportFxPair(
  pairs: Map<string, [string, string]>,
  fromCurrency: string,
  toCurrency: string,
  skipCurrency?: string,
): void {
  if (
    !fromCurrency ||
    !toCurrency ||
    fromCurrency === toCurrency ||
    fromCurrency === skipCurrency
  ) {
    return;
  }
  pairs.set(`${fromCurrency}\0${toCurrency}`, [fromCurrency, toCurrency]);
}

function addImportError(activity: Record<string, unknown>, field: string, message: string): void {
  const errors = cloneMessageMap(activity.errors);
  addFieldMessage(errors, field, message);
  activity.errors = errors;
}

function insertCompletedImportRun(
  db: Database,
  accountId: string,
  summary: ImportActivitiesSummary,
): ImportRunRow {
  const id = crypto.randomUUID();
  const now = activityStorageTimestampNow();
  const row: ImportRunRow = {
    id,
    account_id: accountId,
    source_system: "csv",
    run_type: "IMPORT",
    mode: "INCREMENTAL",
    status: "APPLIED",
    started_at: now,
    finished_at: now,
    review_mode: "NEVER",
    applied_at: now,
    checkpoint_in: null,
    checkpoint_out: null,
    summary: JSON.stringify({
      fetched: summary.total,
      inserted: summary.imported,
      updated: 0,
      skipped: summary.skipped,
      warnings: summary.duplicates,
      errors: 0,
      removed: 0,
      assetsCreated: summary.assetsCreated,
    }),
    warnings: null,
    error: null,
    created_at: now,
    updated_at: now,
  };
  db.query(
    `
      INSERT INTO import_runs (
        id, account_id, source_system, run_type, mode, status, started_at, finished_at,
        review_mode, applied_at, checkpoint_in, checkpoint_out, summary, warnings, error,
        created_at, updated_at
      )
      VALUES (?, ?, 'csv', 'IMPORT', 'INCREMENTAL', 'APPLIED', ?, ?, 'NEVER', ?, NULL, NULL, ?, NULL, NULL, ?, ?)
    `,
  ).run(
    row.id,
    row.account_id,
    row.started_at,
    row.finished_at,
    row.applied_at,
    row.summary,
    row.created_at,
    row.updated_at,
  );
  return row;
}

function ensureActivityCreateIsUnique(db: Database, activity: ActivityCreateRowInput): void {
  if (activity.idempotencyKey === null) {
    return;
  }
  const existingId = findActivityIdByIdempotencyKey(db, activity.idempotencyKey);
  if (existingId !== null) {
    throw duplicateActivityError(existingId);
  }
}

function persistPreparedActivityCreate(
  db: Database,
  activity: ActivityCreateRowInput,
  assetContext: ActivityAssetResolutionContext,
): {
  created: Activity;
  createdAssetIds: string[];
  syncEvents: ActivitySyncEvent[];
} {
  try {
    ensurePendingActivityAssets(db, assetContext);
    const quoteModeUpdatedAssetIds = new Set<string>();
    applyActivityQuoteSideEffects(
      db,
      activity,
      activity.assetQuoteMode,
      true,
      quoteModeUpdatedAssetIds,
    );
    insertActivityRow(db, activity);

    const createdRow = readActivityRow(db, activity.id);
    const createdAssetIds = [...assetContext.createdAssetIds];
    const updatedAssetIds = existingUpdatedAssetIds(quoteModeUpdatedAssetIds, createdAssetIds);
    return {
      created: activityFromRow(createdRow),
      createdAssetIds,
      syncEvents: [
        ...assetSyncEvents(readAssetSyncRows(db, createdAssetIds), "Create"),
        ...assetSyncEvents(readAssetSyncRows(db, updatedAssetIds), "Update"),
        ...activitySyncEvents([{ operation: "Create", row: createdRow }]),
      ],
    };
  } catch (error) {
    throw mapActivitySqliteError(error);
  }
}

function persistPreparedActivityUpdate(
  db: Database,
  existing: ActivityRow,
  update: ActivityRow & ActivityQuoteDateInput,
  assetContext: ActivityAssetResolutionContext,
  assetQuoteMode: string | null,
  shouldWriteQuote: boolean,
): {
  existing: Activity;
  updated: Activity;
  createdAssetIds: string[];
  syncEvents: ActivitySyncEvent[];
} {
  try {
    ensurePendingActivityAssets(db, assetContext);
    const quoteModeUpdatedAssetIds = new Set<string>();
    applyActivityQuoteSideEffects(
      db,
      update,
      assetQuoteMode,
      shouldWriteQuote,
      quoteModeUpdatedAssetIds,
    );
    updateActivityRow(db, update);

    const updatedRow = readActivityRow(db, update.id);
    const createdAssetIds = [...assetContext.createdAssetIds];
    const updatedAssetIds = existingUpdatedAssetIds(quoteModeUpdatedAssetIds, createdAssetIds);
    return {
      existing: activityFromRow(existing),
      updated: activityFromRow(updatedRow),
      createdAssetIds,
      syncEvents: [
        ...assetSyncEvents(readAssetSyncRows(db, createdAssetIds), "Create"),
        ...assetSyncEvents(readAssetSyncRows(db, updatedAssetIds), "Update"),
        ...activitySyncEvents([{ operation: "Update", row: updatedRow }]),
      ],
    };
  } catch (error) {
    throw mapActivitySqliteError(error);
  }
}

function prepareBulkActivityMutation(
  db: Database,
  input: Record<string, unknown>,
  exchangeMetadata?: ActivityExchangeMetadata,
): PreparedBulkActivityMutation {
  const assetContext = createActivityAssetResolutionContext(exchangeMetadata);
  const creates = recordArrayField(input, "creates");
  const updates = recordArrayField(input, "updates");
  const deleteIds = stringArrayField(input, "deleteIds");
  const errors: ActivityBulkMutationError[] = [];
  const preparedCreates: PreparedActivityCreateMutation[] = [];
  const preparedUpdates: PreparedActivityUpdateMutation[] = [];
  const preparedUpdateExistingRows: ActivityRow[] = [];
  const preparedDeletes: ActivityRow[] = [];
  const createIdempotencyKeys = new Set<string>();
  const deleteIdSet = new Set(deleteIds);

  for (const createInput of creates) {
    const tempId = stringFieldOrNull(createInput.id)?.trim() || null;
    try {
      const activity = normalizeActivityCreateInput(db, createInput, assetContext);
      if (activity.idempotencyKey !== null) {
        const existingId = findActivityIdByIdempotencyKey(db, activity.idempotencyKey);
        if (existingId !== null && !deleteIdSet.has(existingId)) {
          throw duplicateActivityError(existingId);
        }
        if (createIdempotencyKeys.has(activity.idempotencyKey)) {
          throw duplicateActivityError(null);
        }
        createIdempotencyKeys.add(activity.idempotencyKey);
      }
      preparedCreates.push({ activity, tempId });
    } catch (error) {
      errors.push({ id: tempId, action: "create", message: errorMessage(error) });
    }
  }

  for (const updateInput of updates) {
    const targetId = stringFieldOrNull(updateInput.id);
    try {
      const activityId = requiredNonEmptyString(updateInput.id, "id");
      if (deleteIdSet.has(activityId)) {
        throw new Error("Cannot update and delete the same activity");
      }
      const existing = readActivityRow(db, activityId);
      preparedUpdateExistingRows.push(existing);
      preparedUpdates.push({
        activity: normalizeActivityUpdateInput(db, updateInput, existing, assetContext),
        assetQuoteMode: activityAssetQuoteModeFromRecord(updateInput),
        shouldWriteQuote: shouldWriteManualQuoteForUpdate(updateInput),
      });
    } catch (error) {
      errors.push({ id: targetId, action: "update", message: errorMessage(error) });
    }
  }

  for (const deleteId of deleteIds) {
    try {
      preparedDeletes.push(readActivityRow(db, deleteId));
    } catch (error) {
      errors.push({ id: deleteId, action: "delete", message: errorMessage(error) });
    }
  }

  return {
    assetContext,
    preparedCreates,
    preparedUpdates,
    preparedUpdateExistingRows,
    preparedDeletes,
    errors,
  };
}

function persistPreparedBulkActivityMutation(
  db: Database,
  prepared: PreparedBulkActivityMutation,
): {
  result: ActivityBulkMutationResult;
  oldRows: ActivityRow[];
  createdAssetIds: string[];
  syncEvents: ActivitySyncEvent[];
} {
  const result = emptyBulkMutationResult([]);
  const syncInputs: ActivitySyncInput[] = [];
  const quoteModeUpdatedAssetIds = new Set<string>();
  try {
    ensurePendingActivityAssets(db, prepared.assetContext);
    for (const activity of prepared.preparedDeletes) {
      db.query("DELETE FROM activities WHERE id = ?").run(activity.id);
      result.deleted.push(activityFromRow(activity));
      syncInputs.push({ operation: "Delete", row: activity });
    }
    for (const { activity, assetQuoteMode, shouldWriteQuote } of prepared.preparedUpdates) {
      applyActivityQuoteSideEffects(
        db,
        activity,
        assetQuoteMode,
        shouldWriteQuote,
        quoteModeUpdatedAssetIds,
      );
      updateActivityRow(db, activity);
      const updatedRow = readActivityRow(db, activity.id);
      result.updated.push(activityFromRow(updatedRow));
      syncInputs.push({ operation: "Update", row: updatedRow });
    }
    for (const { activity, tempId } of prepared.preparedCreates) {
      applyActivityQuoteSideEffects(
        db,
        activity,
        activity.assetQuoteMode,
        true,
        quoteModeUpdatedAssetIds,
      );
      insertActivityRow(db, activity);
      const createdRow = readActivityRow(db, activity.id);
      result.created.push(activityFromRow(createdRow));
      result.createdMappings.push({ tempId, activityId: activity.id });
      syncInputs.push({ operation: "Create", row: createdRow });
    }
  } catch (error) {
    throw mapActivitySqliteError(error);
  }

  const createdAssetIds = [...prepared.assetContext.createdAssetIds];
  Object.defineProperty(result, ACTIVITY_BULK_CREATED_ASSET_IDS, {
    value: createdAssetIds,
    enumerable: false,
    configurable: true,
  });
  const updatedAssetIds = existingUpdatedAssetIds(quoteModeUpdatedAssetIds, createdAssetIds);
  return {
    result,
    oldRows: [...prepared.preparedUpdateExistingRows, ...prepared.preparedDeletes],
    createdAssetIds,
    syncEvents: [
      ...assetSyncEvents(readAssetSyncRows(db, createdAssetIds), "Create"),
      ...assetSyncEvents(readAssetSyncRows(db, updatedAssetIds), "Update"),
      ...activitySyncEvents(syncInputs),
    ],
  };
}

function normalizeActivityCreateInput(
  db: Database,
  input: Record<string, unknown>,
  assetContext?: ActivityAssetResolutionContext,
): ActivityCreateRowInput {
  const accountId = requiredNonEmptyString(input.accountId, "accountId");
  const account = readAccountRow(db, accountId);
  const activityType = requiredNonEmptyString(input.activityType, "activityType");
  const subtype = normalizeCreateSubtype(input.subtype);
  const activityDate = normalizeActivityDateInput(input.activityDate);
  const quoteActivityDate = activityQuoteDateInput(input.activityDate, activityDate);
  let quantity = parseOptionalDecimal(input.quantity, "quantity")?.abs() ?? null;
  let unitPrice = parseOptionalDecimal(input.unitPrice, "unitPrice")?.abs() ?? null;
  let amount = parseOptionalDecimal(input.amount, "amount")?.abs() ?? null;
  let fee = parseOptionalDecimal(input.fee, "fee")?.abs() ?? null;
  const fxRate = parseOptionalDecimal(input.fxRate, "fxRate");
  validateAssetBackedIncomeValues(activityType, subtype, quantity, unitPrice, amount);
  validateSplitRatio(activityType, amount);

  const assetId = resolveActivityAssetId(
    db,
    input,
    activityType,
    subtype,
    assetContext,
    [stringFieldOrEmpty(input.currency), account.currency],
    input.metadata,
  );
  const asset = assetId === null ? null : readResolvedActivityAssetRow(db, assetId, assetContext);
  let currency = resolveCurrency([
    stringFieldOrEmpty(input.currency),
    asset?.quote_ccy ?? "",
    account.currency,
  ]);

  if (isSecuritiesTransfer(activityType, assetId) && unitPrice !== null) {
    amount = null;
  }

  if (hasCurrencyNormalizationRule(currency)) {
    unitPrice = unitPrice === null ? null : normalizeAmount(unitPrice, currency);
    amount = amount === null ? null : normalizeAmount(amount, currency);
    fee = fee === null ? null : normalizeAmount(fee, currency);
    currency = normalizedCurrencyCode(currency);
  }

  const notes = stringFieldOrNull(input.notes ?? input.comment);
  const sourceRecordId = stringFieldOrNull(input.sourceRecordId);
  const explicitIdempotencyKey = optionalTrimmedString(input.idempotencyKey);
  const idempotencyKey =
    explicitIdempotencyKey ??
    computeActivityIdempotencyKey({
      accountId,
      activityType,
      activityDate,
      assetId,
      quantity,
      unitPrice,
      amount,
      currency,
      sourceRecordId,
      notes,
    });
  const now = activityTimestampNow();

  return {
    id: crypto.randomUUID(),
    accountId,
    assetId,
    activityType,
    subtype,
    status: parseActivityStatus(input.status, "POSTED"),
    activityDate,
    quoteActivityDate,
    quantity,
    unitPrice,
    amount,
    fee,
    currency,
    fxRate,
    notes,
    metadata: serializeActivityMetadata(input.metadata),
    sourceSystem: stringFieldOrNull(input.sourceSystem) ?? "MANUAL",
    sourceRecordId,
    sourceGroupId: stringFieldOrNull(input.sourceGroupId),
    idempotencyKey,
    importRunId: stringFieldOrNull(input.importRunId),
    needsReview: input.needsReview === true,
    assetQuoteMode: activityAssetQuoteModeFromRecord(input),
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeActivityUpdateInput(
  db: Database,
  input: Record<string, unknown>,
  existing: ActivityRow,
  assetContext?: ActivityAssetResolutionContext,
): ActivityRow & ActivityQuoteDateInput {
  const accountId = requiredNonEmptyString(input.accountId, "accountId");
  const account = readAccountRow(db, accountId);
  const activityType = requiredNonEmptyString(input.activityType, "activityType");
  const activityDate = normalizeActivityDateInput(input.activityDate);
  const quoteActivityDate = activityQuoteDateInput(input.activityDate, activityDate);
  const subtypePatch = parseSubtypePatch(input);
  const effectiveSubtype =
    subtypePatch.kind === "omit"
      ? existing.subtype
      : subtypePatch.kind === "clear"
        ? null
        : subtypePatch.value;

  const quantityPatch = parseDecimalPatch(input, "quantity");
  let unitPricePatch = parseDecimalPatch(input, "unitPrice");
  let amountPatch = parseDecimalPatch(input, "amount");
  let feePatch = parseDecimalPatch(input, "fee");
  const fxRatePatch = parseDecimalPatch(input, "fxRate");
  const effectiveQuantity = applyDecimalPatchForValidation(existing.quantity, quantityPatch);
  const effectiveUnitPrice = applyDecimalPatchForValidation(existing.unit_price, unitPricePatch);
  const effectiveAmount = applyDecimalPatchForValidation(existing.amount, amountPatch);
  validateAssetBackedIncomeValues(
    activityType,
    effectiveSubtype,
    effectiveQuantity,
    effectiveUnitPrice,
    effectiveAmount,
  );
  validateSplitRatio(activityType, effectiveAmount);

  const assetMetadataForNewAsset =
    hasOwn(input, "metadata") && input.metadata !== null && input.metadata !== undefined
      ? input.metadata
      : existing.metadata;
  const assetId = resolveActivityAssetId(
    db,
    input,
    activityType,
    effectiveSubtype,
    assetContext,
    [stringFieldOrEmpty(input.currency), account.currency],
    assetMetadataForNewAsset,
  );
  const asset = assetId === null ? null : readResolvedActivityAssetRow(db, assetId, assetContext);
  let currency = resolveCurrency([
    stringFieldOrEmpty(input.currency),
    asset?.quote_ccy ?? "",
    account.currency,
  ]);

  if (isSecuritiesTransfer(activityType, assetId) && unitPricePatch.kind === "set") {
    amountPatch = { kind: "clear" };
  }

  if (hasCurrencyNormalizationRule(currency)) {
    unitPricePatch = normalizeDecimalPatch(unitPricePatch, currency);
    amountPatch = normalizeDecimalPatch(amountPatch, currency);
    feePatch = normalizeDecimalPatch(feePatch, currency);
    currency = normalizedCurrencyCode(currency);
  }

  return {
    ...existing,
    account_id: accountId,
    asset_id: assetId,
    activity_type: activityType,
    subtype:
      subtypePatch.kind === "omit"
        ? existing.subtype
        : subtypePatch.kind === "clear"
          ? null
          : subtypePatch.value,
    status: parseActivityStatus(input.status, "POSTED"),
    activity_date: activityDate,
    quoteActivityDate,
    quantity: applyDecimalPatchForStorage(existing.quantity, quantityPatch),
    unit_price: applyDecimalPatchForStorage(existing.unit_price, unitPricePatch),
    amount: applyDecimalPatchForStorage(existing.amount, amountPatch),
    fee: applyDecimalPatchForStorage(existing.fee, feePatch),
    currency,
    fx_rate: applyDecimalPatchForStorage(existing.fx_rate, fxRatePatch),
    notes: stringFieldOrNull(input.notes ?? input.comment),
    metadata:
      hasOwn(input, "metadata") && input.metadata !== null && input.metadata !== undefined
        ? serializeActivityMetadata(input.metadata)
        : existing.metadata,
    source_system: existing.source_system,
    source_record_id: existing.source_record_id,
    source_group_id: existing.source_group_id,
    idempotency_key: existing.idempotency_key,
    import_run_id: existing.import_run_id,
    activity_type_override: existing.activity_type_override,
    source_type: existing.source_type,
    settlement_date: existing.settlement_date,
    is_user_modified: 1,
    needs_review: 0,
    created_at: existing.created_at,
    updated_at: activityTimestampNow(),
  };
}

function resolveActivityAssetId(
  db: Database,
  input: Record<string, unknown>,
  activityType: string,
  subtype: string | null,
  assetContext: ActivityAssetResolutionContext | undefined,
  fallbackCurrencies: string[] = [],
  activityMetadata?: unknown,
): string | null {
  const assetInput = activityAssetInputFromRecord(input);
  if (assetInput?.id) {
    const existingAsset = findAssetRowById(db, assetInput.id);
    if (existingAsset) {
      return existingAsset.id;
    }
    if (!assetInput.symbol) {
      readAssetRow(db, assetInput.id);
    }
  }
  if (assetInput?.symbol) {
    const normalizedAssetInput = normalizeActivityAssetInputForLookup(
      assetInput,
      assetContext?.exchangeMetadata,
    );
    const existingAsset = findExistingAssetBySymbol(db, normalizedAssetInput);
    if (existingAsset) {
      return existingAsset.id;
    }
    if (!assetContext) {
      throw new Error("Symbol-based asset creation requires an asset resolution context");
    }
    return stageActivityAsset(
      normalizedAssetInput,
      fallbackCurrencies,
      assetContext,
      activityMetadata,
    );
  }
  if (requiresAssetIdentity(activityType, subtype) && input.allowMissingAsset !== true) {
    throw new Error("Asset-backed activities need either asset_id or symbol");
  }
  return null;
}

function normalizeActivityAssetInputForLookup(
  asset: ActivityAssetInput,
  exchangeMetadata: ActivityExchangeMetadata | undefined,
): ActivityAssetInput {
  if (!asset.symbol) {
    return asset;
  }
  const instrumentType =
    normalizeInstrumentType(asset.instrumentType) ??
    inferActivityInstrumentType(asset, asset.symbol);
  if (!instrumentType) {
    return asset;
  }
  const typedAsset =
    asset.instrumentType === undefined && instrumentType === "CRYPTO"
      ? { ...asset, instrumentType }
      : asset;
  if (instrumentType === "CRYPTO") {
    const parsed = parseActivityCryptoPairSymbol(asset.symbol);
    return parsed
      ? { ...typedAsset, symbol: parsed.base, quoteCcy: typedAsset.quoteCcy ?? parsed.quote }
      : typedAsset;
  }
  if (instrumentType === "FX") {
    const parsed = parseActivityFxSymbol(asset.symbol);
    return parsed
      ? { ...typedAsset, symbol: parsed.base, quoteCcy: typedAsset.quoteCcy ?? parsed.quote }
      : typedAsset;
  }
  if (!exchangeMetadata || !isMicBackedActivityInstrument(instrumentType)) {
    return typedAsset;
  }

  const parsed = parseActivitySymbolWithExchangeSuffix(asset.symbol, exchangeMetadata);
  if (!parsed.mic && parsed.baseSymbol === asset.symbol.trim()) {
    return typedAsset;
  }

  const exchangeMic = asset.exchangeMic?.trim() || parsed.mic || undefined;
  const quoteCcy =
    asset.quoteCcy ??
    (exchangeMic ? exchangeMetadata.currencyByMic.get(exchangeMic.toUpperCase()) : undefined);
  return {
    ...typedAsset,
    symbol: parsed.baseSymbol,
    exchangeMic,
    quoteCcy,
  };
}

function activityAssetInputFromRecord(input: Record<string, unknown>): ActivityAssetInput | null {
  const assetRecord = isRecord(input.asset)
    ? input.asset
    : isRecord(input.symbol)
      ? input.symbol
      : null;
  const directAssetId = optionalTrimmedString(input.assetId);
  const id = directAssetId ?? (assetRecord ? optionalTrimmedString(assetRecord.id) : undefined);
  const symbol =
    (assetRecord ? optionalTrimmedString(assetRecord.symbol) : undefined) ??
    (typeof input.symbol === "string" ? optionalTrimmedString(input.symbol) : undefined);
  const exchangeMic = assetRecord ? optionalTrimmedString(assetRecord.exchangeMic) : undefined;
  const instrumentType = assetRecord
    ? optionalTrimmedString(assetRecord.instrumentType)
    : undefined;
  const quoteCcy = assetRecord ? optionalTrimmedString(assetRecord.quoteCcy) : undefined;
  const quoteMode =
    assetRecord && typeof assetRecord.quoteMode === "string" ? assetRecord.quoteMode : undefined;
  const kind = assetRecord ? optionalTrimmedString(assetRecord.kind) : undefined;
  const name = assetRecord ? optionalTrimmedString(assetRecord.name) : undefined;
  return id || symbol
    ? { id, symbol, exchangeMic, instrumentType, quoteCcy, quoteMode, kind, name }
    : null;
}

function activityAssetQuoteModeFromRecord(input: Record<string, unknown>): string | null {
  return normalizeRequestedQuoteMode(activityAssetInputFromRecord(input)?.quoteMode);
}

function createActivityAssetResolutionContext(
  exchangeMetadata?: ActivityExchangeMetadata,
): ActivityAssetResolutionContext {
  return {
    pendingAssetsById: new Map(),
    pendingAssetIdByKey: new Map(),
    createdAssetIds: new Set(),
    exchangeMetadata,
  };
}

function readResolvedActivityAssetRow(
  db: Database,
  assetId: string,
  assetContext: ActivityAssetResolutionContext | undefined,
): AssetRow {
  const pending = assetContext?.pendingAssetsById.get(assetId);
  if (pending) {
    return pendingActivityAssetToRow(pending);
  }
  return readAssetRow(db, assetId);
}

function stageActivityAsset(
  asset: ActivityAssetInput,
  fallbackCurrencies: string[],
  assetContext: ActivityAssetResolutionContext,
  activityMetadata?: unknown,
): string {
  const pending = pendingActivityAssetFromInput(
    asset,
    fallbackCurrencies,
    activityMetadata,
    assetContext.exchangeMetadata,
  );
  const key = generatedActivityInstrumentKey(pending);
  const existingPendingId = assetContext.pendingAssetIdByKey.get(key);
  if (existingPendingId) {
    return existingPendingId;
  }

  const existingById = assetContext.pendingAssetsById.get(pending.id);
  if (existingById && generatedActivityInstrumentKey(existingById) !== key) {
    throw new Error(`Conflicting asset identity for pending asset ${pending.id}`);
  }

  assetContext.pendingAssetsById.set(pending.id, pending);
  assetContext.pendingAssetIdByKey.set(key, pending.id);
  return pending.id;
}

function pendingActivityAssetFromInput(
  asset: ActivityAssetInput,
  fallbackCurrencies: string[],
  activityMetadata?: unknown,
  exchangeMetadata?: ActivityExchangeMetadata,
): PendingActivityAsset {
  const rawSymbol = asset.symbol?.trim();
  if (!rawSymbol) {
    throw new Error("Invalid input: symbol is required to create an asset");
  }
  if (isGarbageSymbol(rawSymbol)) {
    throw new Error(`Invalid symbol '${rawSymbol}'. Please search for a valid ticker.`);
  }

  const instrumentType =
    normalizeInstrumentType(asset.instrumentType) ?? inferActivityInstrumentType(asset, rawSymbol);
  if (!instrumentType) {
    throw new Error(`Instrument type is required to create asset from symbol ${rawSymbol}`);
  }

  const quoteMode = normalizeRequestedQuoteMode(asset.quoteMode) ?? "MARKET";
  let symbolForStorage = rawSymbol.trim();
  let exchangeMic = asset.exchangeMic?.trim().toUpperCase() || null;
  if (isMicBackedActivityInstrument(instrumentType) && exchangeMetadata) {
    const parsed = parseActivitySymbolWithExchangeSuffix(symbolForStorage, exchangeMetadata);
    symbolForStorage = parsed.baseSymbol;
    if (!exchangeMic && parsed.mic) {
      exchangeMic = parsed.mic.toUpperCase();
    }
  }
  let instrumentSymbol = symbolForStorage.toUpperCase();
  let displayCode = instrumentSymbol;
  let parsedQuoteCcy: string | undefined;

  if (instrumentType === "CRYPTO") {
    const parsed = parseActivityCryptoPairSymbol(rawSymbol);
    if (parsed) {
      instrumentSymbol = parsed.base;
      displayCode = parsed.base;
      parsedQuoteCcy = parsed.quote;
    }
    exchangeMic = null;
  } else if (instrumentType === "FX") {
    const parsed = parseActivityFxSymbol(rawSymbol);
    if (parsed) {
      instrumentSymbol = parsed.base;
      displayCode = `${parsed.base}/${parsed.quote}`;
      parsedQuoteCcy = parsed.quote;
    }
    exchangeMic = null;
  } else if (instrumentType === "OPTION") {
    const normalizedOptionSymbol = normalizeActivityOptionSymbol(rawSymbol);
    if (normalizedOptionSymbol) {
      instrumentSymbol = normalizedOptionSymbol;
      displayCode = normalizedOptionSymbol;
    }
    exchangeMic = null;
  } else if (instrumentType === "BOND") {
    exchangeMic = null;
  }

  const quoteCcy = normalizeActivityAssetQuoteCcyForNewAsset(
    parsedQuoteCcy,
    asset.quoteCcy,
    exchangeMetadata && exchangeMic ? exchangeMetadata.currencyByMic.get(exchangeMic) : undefined,
    [...fallbackCurrencies],
    instrumentType,
    quoteMode,
  );
  if (instrumentType === "EQUITY" && quoteMode === "MARKET" && !exchangeMic) {
    throw new Error(`Exchange MIC is required to create market asset ${instrumentSymbol}`);
  }
  if (instrumentType === "BOND") {
    instrumentSymbol = normalizeActivityBondSymbol(instrumentSymbol, quoteCcy);
    displayCode = instrumentSymbol;
  }

  return {
    id: asset.id ?? crypto.randomUUID(),
    kind: normalizeActivityAssetKind(asset.kind, instrumentType),
    name: asset.name ?? null,
    displayCode,
    metadata: buildActivityAssetMetadata(instrumentType, instrumentSymbol, activityMetadata),
    quoteMode,
    quoteCcy,
    instrumentType,
    instrumentSymbol,
    instrumentExchangeMic: exchangeMic,
  };
}

function inferActivityInstrumentType(
  asset: ActivityAssetInput,
  rawSymbol: string,
): string | undefined {
  switch (asset.kind?.trim().toUpperCase()) {
    case "SECURITY":
    case "INVESTMENT":
    case "EQUITY":
      return "EQUITY";
    case "CRYPTO":
      return "CRYPTO";
    case "FX_RATE":
    case "FX":
      return "FX";
    case "OPTION":
    case "OPT":
      return "OPTION";
    case "BOND":
      return "BOND";
    case "COMMODITY":
    case "CMDTY":
    case "METAL":
      return "METAL";
    case "PROPERTY":
    case "PROP":
    case "VEHICLE":
    case "VEH":
    case "COLLECTIBLE":
    case "COLL":
    case "PRECIOUS_METAL":
    case "PREC":
    case "PRIVATE_EQUITY":
    case "PEQ":
    case "LIABILITY":
    case "LIAB":
    case "OTHER":
    case "ALT":
      return undefined;
  }

  const upperSymbol = rawSymbol.trim().toUpperCase();
  const cryptoPair = parseActivityCryptoPairSymbol(upperSymbol);
  if (cryptoPair && isActivityCryptoPairInferenceQuote(cryptoPair.quote)) {
    return "CRYPTO";
  }
  if (looksLikeActivityOccSymbol(upperSymbol)) {
    return "OPTION";
  }
  if (asset.exchangeMic?.trim()) {
    return "EQUITY";
  }
  if (isCommonCryptoSymbol(upperSymbol)) {
    return "CRYPTO";
  }
  return "EQUITY";
}

function normalizeActivityAssetKind(_kind: string | undefined, instrumentType: string): string {
  return instrumentType === "FX" ? "FX" : "INVESTMENT";
}

function normalizeActivityAssetQuoteCcyForNewAsset(
  parsedQuoteCcy: string | undefined,
  quoteCcy: string | undefined,
  micQuoteCcy: string | undefined,
  fallbackCurrencies: string[],
  instrumentType: string,
  quoteMode: string,
): string {
  const explicitQuoteCcy = parsedQuoteCcy ?? quoteCcy ?? micQuoteCcy;
  if (explicitQuoteCcy !== undefined) {
    const normalized = normalizeImportQuoteCurrency(explicitQuoteCcy);
    if (!normalized) {
      throw new Error(`Invalid input: quote currency '${explicitQuoteCcy}' is not supported`);
    }
    return normalized;
  }

  if (quoteMode === "MARKET" && instrumentType !== "CRYPTO" && instrumentType !== "FX") {
    throw new Error("Quote currency is required. Please re-select the symbol.");
  }

  return normalizeActivityAssetQuoteCcy(undefined, fallbackCurrencies);
}

function isMicBackedActivityInstrument(instrumentType: string): boolean {
  return instrumentType === "EQUITY" || instrumentType === "OPTION" || instrumentType === "METAL";
}

function parseActivitySymbolWithExchangeSuffix(
  symbol: string,
  exchangeMetadata: ActivityExchangeMetadata,
): { baseSymbol: string; mic: string | null } {
  const trimmed = symbol.trim();
  if (trimmed.length >= 2 && trimmed.slice(-2).toUpperCase() === "=F") {
    return { baseSymbol: trimmed.slice(0, -2), mic: null };
  }
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

function normalizeActivityAssetQuoteCcy(
  quoteCcy: string | undefined,
  fallbackCurrencies: string[],
): string {
  if (quoteCcy !== undefined) {
    const normalized = normalizeImportQuoteCurrency(quoteCcy);
    if (!normalized) {
      throw new Error(`Invalid input: quote currency '${quoteCcy}' is not supported`);
    }
    return normalized;
  }

  for (const fallback of fallbackCurrencies) {
    const normalized = normalizeImportQuoteCurrency(fallback);
    if (normalized) {
      return normalized;
    }
  }

  throw new Error("Quote currency is required to create asset from symbol");
}

function normalizeRequestedQuoteMode(value: string | undefined): string | null {
  switch (value?.toUpperCase()) {
    case "MANUAL":
      return "MANUAL";
    case "MARKET":
      return "MARKET";
    default:
      return null;
  }
}

function shouldWriteManualQuoteForUpdate(input: Record<string, unknown>): boolean {
  return parseDecimalPatch(input, "unitPrice").kind === "set";
}

type ActivityQuoteInput = ActivityCreateRowInput | (ActivityRow & ActivityQuoteDateInput);

function applyActivityQuoteSideEffects(
  db: Database,
  activity: ActivityQuoteInput,
  requestedQuoteMode: string | null,
  shouldWriteQuote: boolean,
  quoteModeUpdatedAssetIds?: Set<string>,
): void {
  const assetId = activityQuoteAssetId(activity);
  if (!assetId) {
    return;
  }

  if (requestedQuoteMode) {
    if (updateActivityAssetQuoteMode(db, assetId, requestedQuoteMode)) {
      quoteModeUpdatedAssetIds?.add(assetId);
    }
  }

  const unitPrice = activityQuoteUnitPrice(activity);
  if (
    !shouldWriteQuote ||
    unitPrice === null ||
    !PRICE_BEARING_ACTIVITY_TYPES.has(activityQuoteType(activity)) ||
    readActivityAssetQuoteMode(db, assetId) !== "MANUAL"
  ) {
    return;
  }

  upsertManualQuoteFromActivity(db, {
    assetId,
    activityDate: activityQuoteDate(activity),
    unitPrice,
    currency: activity.currency,
  });
}

function activityQuoteAssetId(activity: ActivityQuoteInput): string | null {
  return "assetId" in activity ? activity.assetId : activity.asset_id;
}

function activityQuoteType(activity: ActivityQuoteInput): string {
  return "activityType" in activity ? activity.activityType : activity.activity_type;
}

function activityQuoteDate(activity: ActivityQuoteInput): string {
  return (
    activity.quoteActivityDate ??
    ("activityDate" in activity ? activity.activityDate : activity.activity_date)
  );
}

function activityQuoteUnitPrice(activity: ActivityQuoteInput): Decimal | null {
  if ("unitPrice" in activity) {
    return activity.unitPrice;
  }
  return activity.unit_price === null ? null : new Decimal(activity.unit_price);
}

function updateActivityAssetQuoteMode(db: Database, assetId: string, quoteMode: string): boolean {
  const updated = db
    .query<{ id: string }, [string, string, string]>(
      `
        UPDATE assets
        SET quote_mode = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND UPPER(COALESCE(quote_mode, '')) <> UPPER(?)
        RETURNING id
      `,
    )
    .get(quoteMode, assetId, quoteMode);
  if (!updated) {
    return false;
  }
  if (quoteMode.toUpperCase() === "MANUAL" && tableExists(db, "quote_sync_state")) {
    db.query("DELETE FROM quote_sync_state WHERE asset_id = ?").run(assetId);
  }
  return true;
}

function readActivityAssetQuoteMode(db: Database, assetId: string): string {
  const row = db
    .query<{ quote_mode: string | null }, [string]>("SELECT quote_mode FROM assets WHERE id = ?")
    .get(assetId);
  return row?.quote_mode?.toUpperCase() ?? "MARKET";
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

function upsertManualQuoteFromActivity(
  db: Database,
  input: { assetId: string; activityDate: string; unitPrice: Decimal; currency: string },
): void {
  const timestamp = activityQuoteTimestamp(input.activityDate);
  const day = datePartFromRfc3339Timestamp(timestamp);
  const quoteId = `${input.assetId}_${day}_${MANUAL_QUOTE_SOURCE}`;
  const price = decimalToStorage(input.unitPrice);
  const optionalPrice = input.unitPrice.isZero() ? null : price;
  const now = activityStorageTimestampNow();

  db.query(
    `
      INSERT INTO quotes (
        id, asset_id, day, source, open, high, low, close, adjclose, volume,
        currency, notes, created_at, timestamp
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)
      ON CONFLICT(asset_id, day, source) DO UPDATE SET
        id = excluded.id,
        open = excluded.open,
        high = excluded.high,
        low = excluded.low,
        close = excluded.close,
        adjclose = excluded.adjclose,
        volume = excluded.volume,
        currency = excluded.currency,
        notes = excluded.notes,
        created_at = excluded.created_at,
        timestamp = excluded.timestamp
    `,
  ).run(
    quoteId,
    input.assetId,
    day,
    MANUAL_QUOTE_SOURCE,
    optionalPrice,
    optionalPrice,
    optionalPrice,
    price,
    optionalPrice,
    input.currency,
    now,
    timestamp,
  );
}

function activityQuoteTimestamp(activityDate: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/u.test(activityDate)) {
    return `${activityDate}T12:00:00+00:00`;
  }
  return normalizeRfc3339ActivityDate(activityDate) ?? activityDate;
}

function datePartFromRfc3339Timestamp(timestamp: string): string {
  const match = /^([+-]?\d{4,}-\d{2}-\d{2})T/u.exec(timestamp);
  return match?.[1] ?? timestamp.slice(0, 10);
}

function activityQuoteDateInput(value: unknown, normalizedActivityDate: string): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return normalizedActivityDate;
}

function parseActivityCryptoPairSymbol(symbol: string): { base: string; quote: string } | null {
  const trimmed = symbol.trim();
  const separator = trimmed.lastIndexOf("-");
  if (separator <= 0 || separator === trimmed.length - 1) {
    return null;
  }
  const base = trimmed.slice(0, separator).trim().toUpperCase();
  const quote = trimmed
    .slice(separator + 1)
    .trim()
    .toUpperCase();
  if (base === "" || quote.length < 3 || quote.length > 5 || !/^[A-Z]+$/u.test(quote)) {
    return null;
  }
  return { base, quote };
}

function parseActivityFxSymbol(symbol: string): { base: string; quote: string } | null {
  const cleaned = symbol.trim().toUpperCase().replace(/=X$/u, "");
  const slashParts = cleaned.split("/");
  if (
    slashParts.length === 2 &&
    /^[A-Z]{3}$/u.test(slashParts[0] ?? "") &&
    /^[A-Z]{3}$/u.test(slashParts[1] ?? "")
  ) {
    return { base: slashParts[0] ?? "", quote: slashParts[1] ?? "" };
  }
  if (/^[A-Z]{6}$/u.test(cleaned)) {
    return { base: cleaned.slice(0, 3), quote: cleaned.slice(3) };
  }
  return null;
}

function buildActivityAssetMetadata(
  instrumentType: string,
  instrumentSymbol: string,
  activityMetadata: unknown,
): string | null {
  if (instrumentType === "OPTION") {
    const parsed = parseActivityOccSymbol(instrumentSymbol);
    if (!parsed) {
      return null;
    }
    return JSON.stringify({
      option: {
        underlyingAssetId: parsed.underlying,
        expiration: parsed.expiration,
        right: parsed.right,
        strike: parsed.strike,
        multiplier: customActivityOptionMultiplier(activityMetadata) ?? 100,
        occSymbol: parsed.occSymbol,
      },
    });
  }

  if (instrumentType === "BOND") {
    const isin = instrumentSymbol.toUpperCase();
    const isTreasuryBill = isin.startsWith("US912797") || isin.startsWith("912797");
    return JSON.stringify({
      bond: {
        maturityDate: null,
        couponRate: isTreasuryBill ? 0 : null,
        faceValue: null,
        couponFrequency: isTreasuryBill ? "ZERO" : null,
        isin,
      },
    });
  }

  return null;
}

function customActivityOptionMultiplier(activityMetadata: unknown): number | null {
  const metadata =
    typeof activityMetadata === "string" ? parseJsonOrNull(activityMetadata) : activityMetadata;
  if (!isRecord(metadata)) {
    return null;
  }
  const multiplier = metadata.contract_multiplier;
  return typeof multiplier === "number" && Number.isFinite(multiplier) && multiplier > 0
    ? multiplier
    : null;
}

function normalizeActivityOptionSymbol(symbol: string): string | null {
  const trimmed = symbol.trim();
  const standard = trimmed.startsWith("-") ? trimmed.slice(1).trim() : trimmed;
  if (!standard) {
    return null;
  }
  const parsedStandard = parseActivityOccSymbol(standard);
  if (parsedStandard) {
    return parsedStandard.occSymbol;
  }

  const digitStart = standard.search(/\d/u);
  if (digitStart <= 0) {
    return null;
  }
  const underlying = standard.slice(0, digitStart);
  const rest = standard.slice(digitStart);
  if (rest.length < 8) {
    return null;
  }
  const datePart = rest.slice(0, 6);
  const optionType = rest[6]?.toUpperCase();
  const strike = rest.slice(7);
  if (
    !/^\d{6}$/u.test(datePart) ||
    (optionType !== "C" && optionType !== "P") ||
    !/^\d+$/u.test(strike) ||
    !activityOccExpirationDate(datePart)
  ) {
    return null;
  }

  const scaledStrike = Number(strike) * 1000;
  const paddedStrike = String(scaledStrike).padStart(8, "0");
  if (!Number.isSafeInteger(scaledStrike) || paddedStrike.length > 8) {
    return null;
  }
  return `${underlying.toUpperCase()}${datePart}${optionType}${paddedStrike}`;
}

function parseActivityOccSymbol(symbol: string): ParsedActivityOccSymbol | null {
  const trimmed = symbol.trim();
  if (!looksLikeActivityOccSymbol(trimmed)) {
    return null;
  }

  const strikePart = trimmed.slice(-8);
  const dateStart = trimmed.length - 15;
  const typeIndex = trimmed.length - 9;
  const underlying = trimmed.slice(0, dateStart).trim().toUpperCase();
  const expiration = activityOccExpirationDate(trimmed.slice(dateStart, typeIndex));
  const optionType = trimmed[typeIndex]?.toUpperCase();
  if (!underlying || !expiration || (optionType !== "C" && optionType !== "P")) {
    return null;
  }

  return {
    underlying,
    expiration,
    right: optionType === "C" ? "CALL" : "PUT",
    strike: Number(strikePart) / 1000,
    occSymbol: `${underlying}${trimmed.slice(dateStart, typeIndex)}${optionType}${strikePart}`,
  };
}

function looksLikeActivityOccSymbol(symbol: string): boolean {
  const trimmed = symbol.trim();
  const length = trimmed.length;
  if (length < 15 || length > 21) {
    return false;
  }
  const optionType = trimmed[length - 9]?.toUpperCase();
  return (
    (optionType === "C" || optionType === "P") &&
    /^\d{8}$/u.test(trimmed.slice(-8)) &&
    /^\d{6}$/u.test(trimmed.slice(length - 15, length - 9))
  );
}

function activityOccExpirationDate(value: string): string | null {
  if (!/^\d{6}$/u.test(value)) {
    return null;
  }
  const year = 2000 + Number(value.slice(0, 2));
  const month = Number(value.slice(2, 4));
  const day = Number(value.slice(4, 6));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeActivityBondSymbol(symbol: string, quoteCcy: string): string {
  const upper = symbol.toUpperCase();
  if (!looksLikeActivityCusip(upper)) {
    return upper;
  }
  const country = quoteCcy === "CAD" ? "CA" : quoteCcy === "BMD" ? "BM" : "US";
  return activityCusipToIsin(upper, country);
}

function looksLikeActivityCusip(value: string): boolean {
  return /^[A-Z0-9]{8}\d$/u.test(value.trim());
}

function activityCusipToIsin(cusip: string, countryCode: string): string {
  const body = `${countryCode}${cusip.slice(0, 9)}`;
  return `${body}${computeActivityIsinCheckDigit(body)}`;
}

function computeActivityIsinCheckDigit(firstEleven: string): number {
  const digits: number[] = [];
  for (const char of firstEleven) {
    if (/\d/u.test(char)) {
      digits.push(Number(char));
    } else if (/[A-Z]/iu.test(char)) {
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

function isCommonCryptoSymbol(symbol: string): boolean {
  return [
    "BTC",
    "ETH",
    "XRP",
    "LTC",
    "BCH",
    "ADA",
    "DOT",
    "LINK",
    "XLM",
    "DOGE",
    "UNI",
    "SOL",
    "AVAX",
    "MATIC",
    "ATOM",
    "ALGO",
    "VET",
    "FIL",
    "TRX",
    "ETC",
    "XMR",
    "AAVE",
    "MKR",
    "COMP",
    "SNX",
    "YFI",
    "SUSHI",
    "CRV",
  ].includes(symbol);
}

function isActivityCryptoPairInferenceQuote(quote: string): boolean {
  return [
    "USD",
    "CAD",
    "EUR",
    "GBP",
    "JPY",
    "CHF",
    "AUD",
    "NZD",
    "HKD",
    "SGD",
    "CNY",
    "SEK",
    "NOK",
    "DKK",
    "PLN",
    "CZK",
    "HUF",
    "TRY",
    "MXN",
    "BRL",
    "KRW",
    "INR",
    "ZAR",
    "BTC",
    "ETH",
    "USDT",
    "USDC",
    "DAI",
    "BUSD",
    "USDP",
    "TUSD",
    "FDUSD",
  ].includes(quote.trim().toUpperCase());
}

function generatedActivityInstrumentKey(asset: PendingActivityAsset): string {
  if (asset.instrumentType === "CRYPTO" || asset.instrumentType === "FX") {
    return `${asset.instrumentType}:${asset.instrumentSymbol.toUpperCase()}/${asset.quoteCcy.toUpperCase()}`;
  }
  if (asset.instrumentExchangeMic) {
    return `${asset.instrumentType}:${asset.instrumentSymbol.toUpperCase()}@${asset.instrumentExchangeMic.toUpperCase()}`;
  }
  return `${asset.instrumentType}:${asset.instrumentSymbol.toUpperCase()}`;
}

function pendingActivityAssetToRow(asset: PendingActivityAsset): AssetRow {
  return {
    id: asset.id,
    kind: asset.kind,
    name: asset.name,
    is_active: 1,
    quote_ccy: asset.quoteCcy,
    quote_mode: asset.quoteMode,
    display_code: asset.displayCode,
    notes: null,
    metadata: asset.metadata,
    provider_config: null,
    instrument_symbol: asset.instrumentSymbol,
    instrument_exchange_mic: asset.instrumentExchangeMic,
    instrument_type: asset.instrumentType,
  };
}

function ensurePendingActivityAssets(
  db: Database,
  assetContext: ActivityAssetResolutionContext,
  onlyAssetIds?: Set<string>,
  importRows?: PreparedImportActivity[],
): void {
  for (const asset of assetContext.pendingAssetsById.values()) {
    if (onlyAssetIds && !onlyAssetIds.has(asset.id)) {
      continue;
    }
    try {
      insertPendingActivityAssetRow(db, asset);
    } catch (error) {
      if (
        !importRows ||
        !String(error).includes("UNIQUE constraint failed: assets.instrument_key")
      ) {
        throw error;
      }
      const existing = db
        .query<{ id: string }, [string]>("SELECT id FROM assets WHERE instrument_key = ? LIMIT 1")
        .get(generatedActivityInstrumentKey(asset));
      if (!existing) {
        throw error;
      }
      for (const row of importRows) {
        if (row.create.assetId === asset.id) {
          row.create.assetId = existing.id;
        }
      }
      continue;
    }
    assetContext.createdAssetIds.add(asset.id);
  }
}

function insertPendingActivityAssetRow(db: Database, asset: PendingActivityAsset): void {
  const columns = [
    "id",
    "kind",
    "name",
    "display_code",
    "metadata",
    "is_active",
    "quote_mode",
    "quote_ccy",
    "instrument_type",
    "instrument_symbol",
    "instrument_exchange_mic",
  ];
  const values: Array<string | number | null> = [
    asset.id,
    asset.kind,
    asset.name,
    asset.displayCode,
    asset.metadata,
    1,
    asset.quoteMode,
    asset.quoteCcy,
    asset.instrumentType,
    asset.instrumentSymbol,
    asset.instrumentExchangeMic,
  ];
  if (assetTableColumns(db).has("provider_config")) {
    columns.push("provider_config");
    values.push(activityProviderConfigForPendingAsset(asset));
  }

  db.query(
    `
      INSERT INTO assets (${columns.join(", ")})
      VALUES (${columns.map(() => "?").join(", ")})
    `,
  ).run(...values);
}

function activityProviderConfigForPendingAsset(asset: PendingActivityAsset): string | null {
  if (asset.quoteMode !== "MARKET" || asset.instrumentType === "BOND") {
    return null;
  }
  if (
    asset.instrumentType === "EQUITY" &&
    (asset.instrumentExchangeMic === "XETR" || asset.instrumentExchangeMic === "XFRA") &&
    looksLikeActivityIsin(asset.instrumentSymbol)
  ) {
    return JSON.stringify({ preferred_provider: "BOERSE_FRANKFURT" });
  }
  return JSON.stringify({ preferred_provider: "YAHOO" });
}

function looksLikeActivityIsin(value: string): boolean {
  return /^[A-Z]{2}[A-Z0-9]{9}\d$/u.test(value.trim().toUpperCase());
}

function assetTableColumns(db: Database): Set<string> {
  return new Set(
    db
      .query<{ name: string }, []>("PRAGMA table_info(assets)")
      .all()
      .map((row) => row.name),
  );
}

function pendingActivityAssetIdsForCreates(
  assetContext: ActivityAssetResolutionContext,
  rows: PreparedImportActivity[],
): Set<string> {
  const assetIds = new Set<string>();
  for (const row of rows) {
    if (row.create.assetId && assetContext.pendingAssetsById.has(row.create.assetId)) {
      assetIds.add(row.create.assetId);
    }
  }
  return assetIds;
}

function reuseExistingAssetsForPendingImports(
  db: Database,
  assetContext: ActivityAssetResolutionContext,
  rows: PreparedImportActivity[],
): void {
  if (!assetTableColumns(db).has("instrument_key")) {
    return;
  }
  for (const asset of [...assetContext.pendingAssetsById.values()]) {
    const instrumentKey = generatedActivityInstrumentKey(asset);
    const requiresQuoteCurrencyMatch =
      asset.instrumentType === "FX" || asset.instrumentType === "CRYPTO";
    const existing = db
      .query<
        { id: string },
        [string, string, string, string, string | null, string | null, number, string, string]
      >(
        `
          SELECT id
          FROM assets
          WHERE instrument_key = ?
             OR (
               (upper(display_code) = ? OR upper(instrument_symbol) = ?)
               AND upper(coalesce(instrument_type, '')) = ?
               AND (
                 (? IS NULL AND instrument_exchange_mic IS NULL)
                 OR upper(instrument_exchange_mic) = ?
               )
               AND (? = 0 OR upper(quote_ccy) = ?)
             )
          ORDER BY CASE WHEN instrument_key = ? THEN 0 ELSE 1 END, id
          LIMIT 1
        `,
      )
      .get(
        instrumentKey,
        asset.instrumentSymbol.toUpperCase(),
        asset.instrumentSymbol.toUpperCase(),
        asset.instrumentType.toUpperCase(),
        asset.instrumentExchangeMic?.toUpperCase() ?? null,
        asset.instrumentExchangeMic?.toUpperCase() ?? null,
        requiresQuoteCurrencyMatch ? 1 : 0,
        asset.quoteCcy.toUpperCase(),
        instrumentKey,
      );
    if (!existing) {
      continue;
    }
    for (const row of rows) {
      if (row.create.assetId === asset.id) {
        row.create.assetId = existing.id;
      }
    }
    assetContext.pendingAssetsById.delete(asset.id);
    assetContext.pendingAssetIdByKey.delete(instrumentKey);
  }
}

function readAccountRow(db: Database, accountId: string): AccountRow {
  const row = db
    .query<AccountRow, [string]>(
      `
        SELECT id, name, currency
        FROM accounts
        WHERE id = ?
      `,
    )
    .get(accountId);
  if (!row) {
    throw new Error(`Record not found: account ${accountId}`);
  }
  return row;
}

function readAssetRow(db: Database, assetId: string): AssetRow {
  const row = findAssetRowById(db, assetId);
  if (!row) {
    throw new Error(`Record not found: asset ${assetId}`);
  }
  return row;
}

function readAssetSyncRows(db: Database, assetIds: string[]): ActivityAssetSyncRow[] {
  return assetIds.map((assetId) => readAssetSyncRow(db, assetId));
}

function readAssetSyncRow(db: Database, assetId: string): ActivityAssetSyncRow {
  const row = db
    .query<ActivityAssetSyncRow, [string]>(
      `
        SELECT
          id,
          kind,
          name,
          display_code,
          notes,
          metadata,
          is_active,
          quote_mode,
          quote_ccy,
          instrument_type,
          instrument_symbol,
          instrument_exchange_mic,
          provider_config,
          created_at,
          updated_at
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

function findAssetRowById(db: Database, assetId: string): AssetRow | null {
  return (
    db
      .query<AssetRow, [string]>(
        `
          SELECT
            id,
            kind,
            name,
            is_active,
            quote_ccy,
            quote_mode,
            display_code,
            notes,
            metadata,
            provider_config,
            instrument_symbol,
            instrument_exchange_mic,
            instrument_type
          FROM assets
          WHERE id = ?
        `,
      )
      .get(assetId) ?? null
  );
}

function findExistingAssetBySymbol(db: Database, asset: ActivityAssetInput): AssetRow | null {
  if (!asset.symbol) {
    return null;
  }
  const symbol = asset.symbol.trim();
  const instrumentType = asset.instrumentType?.trim().toUpperCase();
  const exchangeMic = asset.exchangeMic?.trim().toUpperCase();
  const quoteCcy = asset.quoteCcy ? normalizedCurrencyCode(asset.quoteCcy.trim()) : undefined;
  const clauses = [
    "(UPPER(COALESCE(instrument_symbol, '')) = UPPER(?) OR UPPER(COALESCE(display_code, '')) = UPPER(?) OR id = ?)",
    "instrument_symbol IS NOT NULL AND TRIM(instrument_symbol) != ''",
    "instrument_type IS NOT NULL AND TRIM(instrument_type) != ''",
  ];
  const params: string[] = [symbol, symbol, symbol];

  if (instrumentType) {
    clauses.push("UPPER(COALESCE(instrument_type, '')) = ?");
    params.push(instrumentType);
  }
  if (exchangeMic) {
    clauses.push("UPPER(COALESCE(instrument_exchange_mic, '')) = ?");
    params.push(exchangeMic);
  } else if (instrumentType && instrumentType !== "OPTION") {
    clauses.push("(instrument_exchange_mic IS NULL OR TRIM(instrument_exchange_mic) = '')");
  } else if (!instrumentType) {
    clauses.push(
      "(UPPER(COALESCE(instrument_type, '')) = 'OPTION' OR instrument_exchange_mic IS NULL OR TRIM(instrument_exchange_mic) = '')",
    );
  }
  if (quoteCcy) {
    clauses.push("UPPER(quote_ccy) = UPPER(?)");
    params.push(quoteCcy);
  }

  const rows = db
    .query<AssetRow, string[]>(
      `
        SELECT
          id,
          kind,
          name,
          is_active,
          quote_ccy,
          quote_mode,
          display_code,
          notes,
          metadata,
          provider_config,
          instrument_symbol,
          instrument_exchange_mic,
          instrument_type
        FROM assets
        WHERE ${clauses.join(" AND ")}
        ORDER BY
          CASE WHEN UPPER(COALESCE(display_code, '')) = UPPER(?) THEN 0 ELSE 1 END,
          id ASC
        LIMIT 2
      `,
    )
    .all(...params, symbol);
  if (rows.length > 1) {
    throw new Error(
      `Multiple existing assets match symbol ${symbol}; provide asset.id or more disambiguation`,
    );
  }
  return rows[0] ?? null;
}

function findExistingAssetByIsin(db: Database, isin: string): AssetRow | null {
  return (
    db
      .query<AssetRow, [string]>(
        `
          SELECT
            id,
            kind,
            name,
            is_active,
            quote_ccy,
            quote_mode,
            display_code,
            notes,
            metadata,
            provider_config,
            instrument_symbol,
            instrument_exchange_mic,
            instrument_type
          FROM assets
          WHERE metadata IS NOT NULL
            AND json_valid(metadata)
            AND UPPER(json_extract(metadata, '$.identifiers.isin')) = ?
          ORDER BY id ASC
          LIMIT 1
        `,
      )
      .get(isin) ?? null
  );
}

function insertActivityRow(db: Database, activity: ActivityCreateRowInput): void {
  db.query(
    `
      INSERT INTO activities (
        id, account_id, asset_id, activity_type, activity_type_override, source_type, subtype,
        status, activity_date, settlement_date, quantity, unit_price, amount, fee, currency,
        fx_rate, notes, metadata, source_system, source_record_id, source_group_id,
        idempotency_key, import_run_id, is_user_modified, needs_review, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `,
  ).run(
    activity.id,
    activity.accountId,
    activity.assetId,
    activity.activityType,
    activity.subtype,
    activity.status,
    activity.activityDate,
    decimalToStorage(activity.quantity),
    decimalToStorage(activity.unitPrice),
    decimalToStorage(activity.amount),
    decimalToStorage(activity.fee),
    activity.currency,
    decimalToStorage(activity.fxRate),
    activity.notes,
    activity.metadata,
    activity.sourceSystem,
    activity.sourceRecordId,
    activity.sourceGroupId,
    activity.idempotencyKey,
    activity.importRunId,
    activity.needsReview ? 1 : 0,
    activity.createdAt,
    activity.updatedAt,
  );
}

function updateActivityRow(db: Database, activity: ActivityRow): void {
  db.query(
    `
      UPDATE activities
      SET
        account_id = ?,
        asset_id = ?,
        activity_type = ?,
        activity_type_override = ?,
        source_type = ?,
        subtype = ?,
        status = ?,
        activity_date = ?,
        settlement_date = ?,
        quantity = ?,
        unit_price = ?,
        amount = ?,
        fee = ?,
        currency = ?,
        fx_rate = ?,
        notes = ?,
        metadata = ?,
        source_system = ?,
        source_record_id = ?,
        source_group_id = ?,
        idempotency_key = ?,
        import_run_id = ?,
        is_user_modified = 1,
        needs_review = 0,
        created_at = ?,
        updated_at = ?
      WHERE id = ?
    `,
  ).run(
    activity.account_id,
    activity.asset_id,
    activity.activity_type,
    activity.activity_type_override,
    activity.source_type,
    activity.subtype,
    activity.status,
    activity.activity_date,
    activity.settlement_date,
    activity.quantity,
    activity.unit_price,
    activity.amount,
    activity.fee,
    activity.currency,
    activity.fx_rate,
    activity.notes,
    activity.metadata,
    activity.source_system,
    activity.source_record_id,
    activity.source_group_id,
    activity.idempotency_key,
    activity.import_run_id,
    activity.created_at,
    activity.updated_at,
    activity.id,
  );
}

function emptyBulkMutationResult(errors: ActivityBulkMutationError[]): ActivityBulkMutationResult {
  return {
    created: [],
    updated: [],
    deleted: [],
    createdMappings: [],
    errors,
  };
}

function findActivityIdByIdempotencyKey(db: Database, idempotencyKey: string): string | null {
  const row = db
    .query<{ id: string }, [string]>("SELECT id FROM activities WHERE idempotency_key = ?")
    .get(idempotencyKey);
  return row?.id ?? null;
}

function duplicateActivityError(existingActivityId: string | null): Error {
  return new Error(
    existingActivityId
      ? `Duplicate activity detected. A matching activity already exists (id: ${existingActivityId}).`
      : "Duplicate activity detected. A matching activity already exists.",
  );
}

function mapActivitySqliteError(error: unknown): Error {
  const message = errorMessage(error);
  if (message.includes("UNIQUE constraint failed: activities.idempotency_key")) {
    return duplicateActivityError(null);
  }
  return error instanceof Error ? error : new Error(message);
}

function computeActivityIdempotencyKey(input: {
  accountId: string;
  activityType: string;
  activityDate: string;
  assetId: string | null;
  quantity: Decimal | null;
  unitPrice: Decimal | null;
  amount: Decimal | null;
  currency: string;
  sourceRecordId: string | null;
  notes: string | null;
}): string {
  const hash = createHash("sha256");
  hash.update(input.accountId);
  hash.update("|");
  hash.update(input.activityType);
  hash.update("|");
  hash.update(datePartFromRfc3339Timestamp(input.activityDate));
  hash.update("|");
  if (input.assetId !== null) {
    hash.update(input.assetId);
  }
  hash.update("|");
  if (input.quantity !== null) {
    hash.update(decimalToCanonicalString(input.quantity));
  }
  hash.update("|");
  if (input.unitPrice !== null) {
    hash.update(decimalToCanonicalString(input.unitPrice));
  }
  hash.update("|");
  if (input.amount !== null) {
    hash.update(decimalToCanonicalString(input.amount));
  }
  hash.update("|");
  hash.update(input.currency);
  hash.update("|");
  if (input.sourceRecordId !== null) {
    hash.update(input.sourceRecordId);
  }
  hash.update("|");
  if (input.notes !== null) {
    hash.update(normalizeDescription(input.notes));
  }
  return hash.digest("hex");
}

function normalizeDescription(value: string): string {
  return value.split(/\s+/u).filter(Boolean).join(" ");
}

function validateActivitySearchPagination(page: number, pageSize: number): void {
  if (!Number.isSafeInteger(page) || !Number.isSafeInteger(pageSize)) {
    throw new Error("Invalid input: pagination values must be safe integers");
  }
  const offset = page * pageSize;
  if (!Number.isSafeInteger(offset)) {
    throw new Error("Invalid input: pagination offset must be a safe integer");
  }
}

function activitySearchWhereClause(request: ActivitySearchRequest): {
  whereSql: string;
  params: (string | number)[];
} {
  const clauses = ["accounts.is_archived = 0"];
  const params: (string | number)[] = [];

  addInClause(clauses, params, "activities.account_id", request.accountIds);
  addInClause(clauses, params, "activities.activity_type", request.activityTypes);
  if (request.assetIdKeyword !== undefined) {
    const pattern = `%${request.assetIdKeyword}%`;
    clauses.push(
      "(assets.id LIKE ? OR assets.name LIKE ? OR assets.display_code LIKE ? OR activities.notes LIKE ?)",
    );
    params.push(pattern, pattern, pattern, pattern);
  }
  if (request.needsReview !== undefined) {
    clauses.push(
      request.needsReview ? "activities.status = 'DRAFT'" : "activities.status != 'DRAFT'",
    );
  }
  if (request.dateFrom !== undefined) {
    clauses.push("activities.activity_date >= ?");
    params.push(`${request.dateFrom}T00:00:00`);
  }
  if (request.dateTo !== undefined) {
    clauses.push("activities.activity_date <= ?");
    params.push(`${request.dateTo}T23:59:59`);
  }
  addInClause(clauses, params, "assets.instrument_type", request.instrumentTypes);

  return { whereSql: `WHERE ${clauses.join(" AND ")}`, params };
}

function addInClause(
  clauses: string[],
  params: (string | number)[],
  column: string,
  values: string[] | undefined,
): void {
  if (values === undefined) {
    return;
  }
  if (values.length === 0) {
    clauses.push("1 = 0");
    return;
  }
  clauses.push(`${column} IN (${values.map(() => "?").join(", ")})`);
  params.push(...values);
}

function activitySearchOrderBy(sort: ActivitySearchRequest["sort"]): string {
  if (!sort) {
    return "ORDER BY activities.activity_date DESC, activities.created_at ASC";
  }
  const direction = sort.desc ? "DESC" : "ASC";
  switch (sort.id) {
    case "date":
      return `ORDER BY activities.activity_date ${direction}, activities.created_at ASC`;
    case "activityType":
      return `ORDER BY activities.activity_type ${direction}`;
    case "assetSymbol":
      return `ORDER BY activities.asset_id ${direction}`;
    case "accountName":
      return `ORDER BY accounts.name ${direction}`;
    default:
      return "ORDER BY activities.activity_date DESC, activities.created_at ASC";
  }
}

function readActivityRow(db: Database, activityId: string): ActivityRow {
  const row = db
    .query<ActivityRow, [string]>(
      `
        SELECT ${activitySelectColumns()}
        FROM activities
        WHERE id = ?
      `,
    )
    .get(activityId);
  if (!row) {
    throw new Error(`Record not found: activity ${activityId}`);
  }
  return row;
}

function activitySelectColumns(): string {
  return `
    id, account_id, asset_id, activity_type, activity_type_override, source_type, subtype,
    status, activity_date, settlement_date, quantity, unit_price, amount, fee, currency,
    fx_rate, notes, metadata, source_system, source_record_id, source_group_id,
    idempotency_key, import_run_id, is_user_modified, needs_review, created_at, updated_at
  `;
}

function transferPairByType(
  activityA: ActivityRow,
  activityB: ActivityRow,
  errorMessage: string,
): [ActivityRow, ActivityRow] {
  if (activityA.activity_type === "TRANSFER_IN" && activityB.activity_type === "TRANSFER_OUT") {
    return [activityA, activityB];
  }
  if (activityA.activity_type === "TRANSFER_OUT" && activityB.activity_type === "TRANSFER_IN") {
    return [activityB, activityA];
  }
  throw new Error(errorMessage);
}

function updateTransferLink(
  db: Database,
  activityId: string,
  sourceGroupId: string | null,
  metadata: string,
  updatedAt: string,
): void {
  db.query(
    `
      UPDATE activities
      SET source_group_id = ?, metadata = ?, is_user_modified = 1, updated_at = ?
      WHERE id = ?
    `,
  ).run(sourceGroupId, metadata, updatedAt, activityId);
}

function setTransferFlowExternal(metadata: string | null, isExternal: boolean): string {
  const parsed = parseJsonOrNull(metadata);
  const value: Record<string, unknown> = isRecord(parsed) ? { ...parsed } : {};
  const flow = isRecord(value.flow) ? { ...value.flow } : {};
  flow.is_external = isExternal;
  value.flow = flow;
  return JSON.stringify(value);
}

function activityFromRow(row: ActivityRow): Activity {
  return {
    id: row.id,
    accountId: row.account_id,
    assetId: row.asset_id,
    activityType: row.activity_type,
    activityTypeOverride: row.activity_type_override,
    sourceType: row.source_type,
    subtype: row.subtype,
    status: normalizeActivityStatus(row.status),
    activityDate: row.activity_date,
    settlementDate: row.settlement_date,
    quantity: row.quantity,
    unitPrice: row.unit_price,
    amount: row.amount,
    fee: row.fee,
    currency: row.currency,
    fxRate: row.fx_rate,
    notes: row.notes,
    metadata: parseJsonOrNull(row.metadata),
    sourceSystem: row.source_system,
    sourceRecordId: row.source_record_id,
    sourceGroupId: row.source_group_id,
    idempotencyKey: row.idempotency_key,
    importRunId: row.import_run_id,
    isUserModified: row.is_user_modified !== 0,
    needsReview: row.needs_review !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function activityDetailsFromRow(row: ActivityDetailsRow): ActivityDetails {
  return {
    id: row.id,
    accountId: row.account_id,
    assetId: row.asset_id ?? "",
    activityType: row.activity_type,
    subtype: row.subtype,
    status: normalizeActivityStatus(row.status),
    date: row.date,
    quantity: row.quantity,
    unitPrice: row.unit_price,
    currency: row.currency,
    fee: row.fee,
    amount: row.amount ?? fallbackActivityAmount(row.quantity, row.unit_price),
    needsReview: row.needs_review !== 0,
    comment: row.notes,
    fxRate: row.fx_rate,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    accountName: row.account_name,
    accountCurrency: row.account_currency,
    assetSymbol: row.asset_symbol ?? "",
    assetName: row.asset_name,
    exchangeMic: row.exchange_mic,
    assetPricingMode: row.asset_pricing_mode ?? "MARKET",
    instrumentType: row.instrument_type,
    sourceSystem: row.source_system,
    sourceRecordId: row.source_record_id,
    sourceGroupId: row.source_group_id,
    idempotencyKey: row.idempotency_key,
    importRunId: row.import_run_id,
    isUserModified: row.is_user_modified !== 0,
    metadata: parseJsonOrNull(row.metadata),
  };
}

function normalizeActivityStatus(status: string): string {
  return status === "POSTED" || status === "PENDING" || status === "DRAFT" || status === "VOID"
    ? status
    : "POSTED";
}

function fallbackActivityAmount(quantity: string | null, unitPrice: string | null): string | null {
  if (quantity === null || unitPrice === null) {
    return null;
  }
  return decimalOrZero(quantity).mul(decimalOrZero(unitPrice)).toString();
}

function decimalOrZero(value: string): Decimal {
  try {
    return new Decimal(value);
  } catch {
    return new Decimal(0);
  }
}

function parseJsonOrNull(value: string | null): unknown | null {
  if (value === null) {
    return null;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function normalizeImportMappingInput(input: Record<string, unknown>): ImportMappingData {
  const accountId = requiredString(input.accountId, "accountId");
  const rawContextKind =
    typeof input.contextKind === "string"
      ? input.contextKind
      : typeof input.importType === "string"
        ? input.importType
        : CSV_ACTIVITY_CONTEXT_KIND;
  return {
    ...importConfigFromRecord(input),
    accountId,
    contextKind: normalizeContextKindValue(rawContextKind),
    name: typeof input.name === "string" ? input.name : "",
    templateId:
      typeof input.templateId === "string" || input.templateId === null
        ? input.templateId
        : undefined,
  };
}

function normalizeImportTemplateInput(input: Record<string, unknown>): ImportTemplateData {
  return {
    ...importConfigFromRecord(input),
    id: requiredString(input.id, "id"),
    name: requiredString(input.name, "name"),
    scope: normalizeTemplateScope(input.scope),
    kind: normalizeTemplateKind(input.kind),
  };
}

function normalizeSaveBrokerSyncProfileRulesRequest(
  input: Record<string, unknown>,
): SaveBrokerSyncProfileRulesRequest {
  return {
    accountId: requiredString(input.accountId, "accountId"),
    sourceSystem: requiredString(input.sourceSystem, "sourceSystem"),
    scope: normalizeBrokerProfileScope(input.scope),
    activityRulePatches:
      input.activityRulePatches === undefined
        ? {}
        : parseStringArrayRecord(input.activityRulePatches, "activityRulePatches"),
    securityRulePatches:
      input.securityRulePatches === undefined
        ? {}
        : parseStringRecord(input.securityRulePatches, "securityRulePatches"),
    securityRuleMetaPatches:
      input.securityRuleMetaPatches === undefined
        ? {}
        : parseSymbolMappingMetaRecord(input.securityRuleMetaPatches, "securityRuleMetaPatches"),
  };
}

function readImportTemplateRow(db: Database, id: string): ImportTemplateRow | null {
  return db
    .query<ImportTemplateRow, [string]>("SELECT * FROM import_templates WHERE id = ?")
    .get(id);
}

function readImportTemplateRowOrThrow(db: Database, id: string): ImportTemplateRow {
  const row = readImportTemplateRow(db, id);
  if (!row) {
    throw new Error(`Record not found: import template ${id}`);
  }
  return row;
}

function getBrokerSyncProfileData(
  db: Database,
  accountId: string,
  sourceSystem: string,
): BrokerSyncProfileData {
  const accountTemplate = db
    .query<ImportTemplateRow, [string, string]>(
      `
        SELECT templates.*
        FROM import_account_templates links
        INNER JOIN import_templates templates ON templates.id = links.template_id
        WHERE links.account_id = ?
          AND links.context_kind = 'BROKER_ACTIVITY'
          AND links.source_system = ?
          AND templates.scope = 'USER'
        LIMIT 1
      `,
    )
    .get(accountId, sourceSystem);
  if (accountTemplate) {
    return brokerProfileDataFromRow(accountTemplate);
  }

  const brokerTemplate = db
    .query<ImportTemplateRow, [string, string]>(
      `
        SELECT *
        FROM import_templates templates
        WHERE templates.kind = 'BROKER_ACTIVITY'
          AND templates.source_system = ?
          AND templates.scope = 'USER'
          AND NOT EXISTS (
            SELECT 1
            FROM import_account_templates links
            WHERE links.context_kind = 'BROKER_ACTIVITY'
              AND links.source_system = ?
              AND links.template_id = templates.id
          )
        LIMIT 1
      `,
    )
    .get(sourceSystem, sourceSystem);
  if (brokerTemplate) {
    return brokerProfileDataFromRow(brokerTemplate);
  }

  const systemTemplate = db
    .query<ImportTemplateRow, [string]>(
      `
        SELECT *
        FROM import_templates
        WHERE kind = 'BROKER_ACTIVITY'
          AND source_system = ?
          AND scope = 'SYSTEM'
        LIMIT 1
      `,
    )
    .get(sourceSystem);
  if (systemTemplate) {
    return brokerProfileDataFromRow(systemTemplate);
  }

  return defaultBrokerSyncProfileData(sourceSystem);
}

function readImportAccountTemplateLink(
  db: Database,
  accountId: string,
  contextKind: string,
): ImportAccountTemplateRow | null {
  return db
    .query<ImportAccountTemplateRow, [string, string]>(
      `
        SELECT *
        FROM import_account_templates
        WHERE account_id = ? AND context_kind = ?
      `,
    )
    .get(accountId, contextKind);
}

function readBrokerImportAccountTemplateLink(
  db: Database,
  accountId: string,
  sourceSystem: string,
): ImportAccountTemplateRow | null {
  return db
    .query<ImportAccountTemplateRow, [string, string]>(
      `
        SELECT *
        FROM import_account_templates
        WHERE account_id = ?
          AND context_kind = 'BROKER_ACTIVITY'
          AND source_system = ?
      `,
    )
    .get(accountId, sourceSystem);
}

function readImportAccountTemplateLinkOrThrow(
  db: Database,
  accountId: string,
  contextKind: string,
): ImportAccountTemplateRow {
  const row = readImportAccountTemplateLink(db, accountId, contextKind);
  if (!row) {
    throw new Error(`Record not found: import account template ${accountId}/${contextKind}`);
  }
  return row;
}

function readBrokerImportAccountTemplateLinkOrThrow(
  db: Database,
  accountId: string,
  sourceSystem: string,
): ImportAccountTemplateRow {
  const row = readBrokerImportAccountTemplateLink(db, accountId, sourceSystem);
  if (!row) {
    throw new Error(`Record not found: import account template ${accountId}/BROKER_ACTIVITY`);
  }
  return row;
}

function upsertImportAccountTemplateLink(db: Database, row: ImportAccountTemplateRow): void {
  db.query(
    `
      INSERT INTO import_account_templates (
        id, account_id, context_kind, source_system, template_id, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, context_kind, source_system) DO UPDATE SET
        id = excluded.id,
        account_id = excluded.account_id,
        context_kind = excluded.context_kind,
        source_system = excluded.source_system,
        template_id = excluded.template_id,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `,
  ).run(
    row.id,
    row.account_id,
    row.context_kind,
    row.source_system,
    row.template_id,
    row.created_at,
    row.updated_at,
  );
}

function mappingDataFromRow(row: ImportMappingJoinRow): ImportMappingData {
  return {
    ...parseStoredImportConfig(row.config, "mapping data"),
    accountId: row.account_id,
    contextKind: row.context_kind,
    templateId: row.template_id,
    name: row.name,
  };
}

function templateDataFromRow(row: ImportTemplateRow): ImportTemplateData {
  return {
    ...parseStoredImportConfig(row.config, "import template data"),
    id: row.id,
    name: row.name,
    scope: row.scope === "SYSTEM" ? "SYSTEM" : "USER",
    kind: row.kind === "CSV_HOLDINGS" || row.kind === "BROKER_ACTIVITY" ? row.kind : "CSV_ACTIVITY",
  };
}

function brokerProfileDataFromRow(row: ImportTemplateRow): BrokerSyncProfileData {
  const config = parseStoredBrokerProfileConfig(row.config, "broker profile data");
  return {
    id: row.id,
    name: row.name,
    scope: row.scope === "SYSTEM" ? "SYSTEM" : "USER",
    sourceSystem: row.source_system,
    ...config,
  };
}

function brokerProfileDataFromRowOrDefault(row: ImportTemplateRow): BrokerSyncProfileData {
  try {
    return brokerProfileDataFromRow(row);
  } catch {
    return defaultBrokerSyncProfileData("");
  }
}

function defaultImportMappingData(): ImportMappingData {
  return {
    ...defaultImportConfig(),
    accountId: "",
    contextKind: CSV_ACTIVITY_CONTEXT_KIND,
    templateId: undefined,
    name: "",
  };
}

function defaultImportTemplateData(): ImportTemplateData {
  return {
    ...defaultImportConfig(),
    id: "",
    name: "",
    scope: "USER",
    kind: "CSV_ACTIVITY",
  };
}

function defaultBrokerSyncProfileData(sourceSystem: string): BrokerSyncProfileData {
  return {
    id: "",
    name: "",
    scope: "USER",
    sourceSystem,
    activityMappings: {},
    symbolMappings: {},
    symbolMappingMeta: {},
  };
}

function defaultImportConfig(): ImportMappingConfig {
  const activityMappings: Record<string, string[]> = {};
  for (const activityType of ACTIVITY_TYPES) {
    activityMappings[activityType] = [activityType];
  }
  return {
    fieldMappings: {
      date: "date",
      symbol: "symbol",
      quantity: "quantity",
      activityType: "activityType",
      unitPrice: "unitPrice",
      amount: "amount",
      comment: "comment",
      currency: "currency",
      fee: "fee",
      account: "account",
    },
    activityMappings,
    symbolMappings: {},
    accountMappings: {},
    symbolMappingMeta: {},
    parseConfig: undefined,
  };
}

function parseStoredImportConfig(configJson: string, context: string): ImportMappingConfig {
  try {
    const parsed = JSON.parse(configJson) as unknown;
    if (!isRecord(parsed)) {
      throw new Error("config must be an object");
    }
    return importConfigFromRecord(parsed);
  } catch (error) {
    throw new Error(`Failed to parse ${context}: ${errorMessage(error)}`);
  }
}

function parseStoredBrokerProfileConfig(
  configJson: string,
  context: string,
): Pick<BrokerSyncProfileData, "activityMappings" | "symbolMappings" | "symbolMappingMeta"> {
  try {
    const parsed = JSON.parse(configJson) as unknown;
    if (!isRecord(parsed)) {
      throw new Error("config must be an object");
    }
    return brokerProfileConfigFromRecord(parsed);
  } catch (error) {
    throw new Error(`Failed to parse ${context}: ${errorMessage(error)}`);
  }
}

function importConfigFromRecord(record: Record<string, unknown>): ImportMappingConfig {
  const defaults = defaultImportConfig();
  return {
    fieldMappings:
      record.fieldMappings === undefined
        ? defaults.fieldMappings
        : parseFieldMappings(record.fieldMappings, "fieldMappings"),
    activityMappings:
      record.activityMappings === undefined
        ? defaults.activityMappings
        : parseStringArrayRecord(record.activityMappings, "activityMappings"),
    symbolMappings:
      record.symbolMappings === undefined
        ? defaults.symbolMappings
        : parseStringRecord(record.symbolMappings, "symbolMappings"),
    accountMappings:
      record.accountMappings === undefined
        ? defaults.accountMappings
        : parseStringRecord(record.accountMappings, "accountMappings"),
    symbolMappingMeta:
      record.symbolMappingMeta === undefined
        ? defaults.symbolMappingMeta
        : parseSymbolMappingMetaRecord(record.symbolMappingMeta, "symbolMappingMeta"),
    parseConfig:
      record.parseConfig === undefined || record.parseConfig === null
        ? undefined
        : parsePlainRecord(record.parseConfig, "parseConfig"),
  };
}

function brokerProfileConfigFromRecord(
  record: Record<string, unknown>,
): Pick<BrokerSyncProfileData, "activityMappings" | "symbolMappings" | "symbolMappingMeta"> {
  return {
    activityMappings:
      record.activityMappings === undefined
        ? {}
        : parseStringArrayRecord(record.activityMappings, "activityMappings"),
    symbolMappings:
      record.symbolMappings === undefined
        ? {}
        : parseStringRecord(record.symbolMappings, "symbolMappings"),
    symbolMappingMeta:
      record.symbolMappingMeta === undefined
        ? {}
        : parseSymbolMappingMetaRecord(record.symbolMappingMeta, "symbolMappingMeta"),
  };
}

function serializeImportConfig(config: ImportMappingConfig): string {
  const payload: Record<string, unknown> = {
    fieldMappings: config.fieldMappings,
    activityMappings: config.activityMappings,
    symbolMappings: config.symbolMappings,
    accountMappings: config.accountMappings,
  };
  if (Object.keys(config.symbolMappingMeta).length > 0) {
    payload.symbolMappingMeta = config.symbolMappingMeta;
  }
  if (config.parseConfig !== undefined) {
    payload.parseConfig = config.parseConfig;
  }
  return JSON.stringify(payload);
}

function serializeBrokerProfileConfig(profile: BrokerSyncProfileData): string {
  const payload: Record<string, unknown> = {
    activityMappings: profile.activityMappings,
    symbolMappings: profile.symbolMappings,
  };
  if (Object.keys(profile.symbolMappingMeta).length > 0) {
    payload.symbolMappingMeta = profile.symbolMappingMeta;
  }
  return JSON.stringify(payload);
}

function parseFieldMappings(value: unknown, field: string): Record<string, FieldMappingValue> {
  const record = parsePlainRecord(value, field);
  const parsed: Record<string, FieldMappingValue> = {};
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === "string") {
      parsed[key] = item;
    } else if (Array.isArray(item) && item.every((entry) => typeof entry === "string")) {
      parsed[key] = item;
    } else {
      throw new Error(`Invalid input: ${field}.${key} must be a string or string array`);
    }
  }
  return parsed;
}

function parseStringArrayRecord(value: unknown, field: string): Record<string, string[]> {
  const record = parsePlainRecord(value, field);
  const parsed: Record<string, string[]> = {};
  for (const [key, item] of Object.entries(record)) {
    if (!Array.isArray(item) || !item.every((entry) => typeof entry === "string")) {
      throw new Error(`Invalid input: ${field}.${key} must be a string array`);
    }
    parsed[key] = item;
  }
  return parsed;
}

function parseStringRecord(value: unknown, field: string): Record<string, string> {
  const record = parsePlainRecord(value, field);
  const parsed: Record<string, string> = {};
  for (const [key, item] of Object.entries(record)) {
    if (typeof item !== "string") {
      throw new Error(`Invalid input: ${field}.${key} must be a string`);
    }
    parsed[key] = item;
  }
  return parsed;
}

function parseSymbolMappingMetaRecord(
  value: unknown,
  field: string,
): Record<string, SymbolMappingMeta> {
  const record = parsePlainRecord(value, field);
  const parsed: Record<string, SymbolMappingMeta> = {};
  for (const [key, item] of Object.entries(record)) {
    parsed[key] = parsePlainRecord(item, `${field}.${key}`) as SymbolMappingMeta;
  }
  return parsed;
}

function parsePlainRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Invalid input: ${field} must be an object`);
  }
  return value;
}

function normalizeTemplateScope(value: unknown): ImportTemplateScope {
  if (value === "SYSTEM" || value === "USER") {
    return value;
  }
  throw new Error("Invalid input: scope must be SYSTEM or USER");
}

function normalizeTemplateKind(value: unknown): TemplateKind {
  if (value === "CSV_ACTIVITY" || value === "CSV_HOLDINGS" || value === "BROKER_ACTIVITY") {
    return value;
  }
  if (value === undefined) {
    return "CSV_ACTIVITY";
  }
  throw new Error("Invalid input: kind must be CSV_ACTIVITY, CSV_HOLDINGS, or BROKER_ACTIVITY");
}

function normalizeBrokerProfileScope(value: unknown): BrokerProfileScope {
  if (value === "ACCOUNT" || value === "BROKER") {
    return value;
  }
  throw new Error("Invalid input: scope must be ACCOUNT or BROKER");
}

function normalizeCreateSubtype(value: unknown): string | null {
  const subtype = stringFieldOrNull(value)?.trim();
  return subtype ? canonicalizeActivitySubtype(subtype) : null;
}

function parseSubtypePatch(
  input: Record<string, unknown>,
): { kind: "omit" } | { kind: "clear" } | { kind: "set"; value: string } {
  if (!hasOwn(input, "subtype") || input.subtype === null || input.subtype === undefined) {
    return { kind: "omit" };
  }
  const subtype = requiredString(input.subtype, "subtype").trim();
  return subtype ? { kind: "set", value: canonicalizeActivitySubtype(subtype) } : { kind: "clear" };
}

function canonicalizeActivitySubtype(value: string): string {
  for (const subtype of CANONICAL_ACTIVITY_SUBTYPES) {
    if (value.toUpperCase() === subtype) {
      return subtype;
    }
  }
  return value;
}

function parseActivityStatus(value: unknown, defaultStatus: string): string {
  if (value === undefined || value === null) {
    return defaultStatus;
  }
  if (value === "POSTED" || value === "PENDING" || value === "DRAFT" || value === "VOID") {
    return value;
  }
  throw new Error("Invalid input: status must be POSTED, PENDING, DRAFT, or VOID");
}

function normalizeActivityDateInput(value: unknown): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error("Invalid date format. Expected ISO 8601/RFC3339 or YYYY-MM-DD");
    }
    return dateToUtcRfc3339(value);
  }
  const raw = requiredString(value, "activityDate").trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(raw);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    assertValidDateParts(Number(year), Number(month), Number(day));
    return `${year}-${month}-${day}T00:00:00+00:00`;
  }
  const rfc3339 =
    /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.exec(raw);
  if (!rfc3339) {
    throw new Error("Invalid date format. Expected ISO 8601/RFC3339 or YYYY-MM-DD");
  }
  const [, year, month, day] = rfc3339;
  assertValidDateParts(Number(year), Number(month), Number(day));
  const normalized = normalizeRfc3339ActivityDate(raw);
  if (normalized === null) {
    throw new Error("Invalid date format. Expected ISO 8601/RFC3339 or YYYY-MM-DD");
  }
  return normalized;
}

function assertValidDateParts(year: number, month: number, day: number): void {
  const monthEnd = new Date(Date.UTC(2000, 0, 1));
  monthEnd.setUTCFullYear(year, month, 0);
  const daysInMonth = monthEnd.getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) {
    throw new Error("Invalid date format. Expected ISO 8601/RFC3339 or YYYY-MM-DD");
  }
}

function dateToUtcRfc3339(date: Date): string {
  const iso = date.toISOString();
  return iso.endsWith(".000Z") ? `${iso.slice(0, -5)}+00:00` : iso.replace("Z", "+00:00");
}

function normalizeRfc3339ActivityDate(value: string): string | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2}):(\d{2}))$/u.exec(
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
  if (hour > 23 || minute > 59 || second > 59 || zoneHour > 23 || zoneMinute > 59) {
    return null;
  }
  const local = new Date(Date.UTC(2000, 0, 1, hour, minute, second, millisecond));
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
    zoneRaw === "Z" ? 0 : Number(`${signRaw ?? "+"}1`) * (zoneHour * 60 + zoneMinute);
  const parsed = new Date(local.getTime() - offsetMinutes * 60_000);
  if (Number.isNaN(parsed.valueOf())) {
    return null;
  }
  const base = `${chronoYearString(parsed.getUTCFullYear())}-${String(
    parsed.getUTCMonth() + 1,
  ).padStart(2, "0")}-${String(parsed.getUTCDate()).padStart(2, "0")}T${String(
    parsed.getUTCHours(),
  ).padStart(2, "0")}:${String(parsed.getUTCMinutes()).padStart(2, "0")}:${String(
    parsed.getUTCSeconds(),
  ).padStart(2, "0")}`;
  return `${base}${normalizeRustFraction(fractionRaw)}+00:00`;
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

function parseOptionalDecimal(value: unknown, field: string): Decimal | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`Invalid input: ${field} must be a decimal`);
  }
  try {
    const decimal = new Decimal(value);
    if (!decimal.isFinite()) {
      throw new Error("non-finite decimal");
    }
    return decimal;
  } catch {
    throw new Error(`Invalid input: ${field} must be a decimal`);
  }
}

function parseDecimalPatch(input: Record<string, unknown>, field: string): DecimalPatch {
  if (!hasOwn(input, field) || input[field] === undefined) {
    return { kind: "omit" };
  }
  if (input[field] === null || input[field] === "") {
    return { kind: "clear" };
  }
  return { kind: "set", value: requiredDecimal(input[field], field).abs() };
}

function requiredDecimal(value: unknown, field: string): Decimal {
  const decimal = parseOptionalDecimal(value, field);
  if (decimal === null) {
    throw new Error(`Invalid input: ${field} must be a decimal`);
  }
  return decimal;
}

function applyDecimalPatchForValidation(
  existing: string | null,
  patch: DecimalPatch,
): Decimal | null {
  switch (patch.kind) {
    case "omit":
      return parseStoredDecimalOrNull(existing)?.abs() ?? null;
    case "clear":
      return null;
    case "set":
      return patch.value.abs();
  }
}

function applyDecimalPatchForStorage(existing: string | null, patch: DecimalPatch): string | null {
  switch (patch.kind) {
    case "omit":
      return existing;
    case "clear":
      return null;
    case "set":
      return decimalToStorage(patch.value);
  }
}

function normalizeDecimalPatch(patch: DecimalPatch, currency: string): DecimalPatch {
  return patch.kind === "set"
    ? { kind: "set", value: normalizeAmount(patch.value, currency) }
    : patch;
}

function parseStoredDecimalOrNull(value: string | null): Decimal | null {
  if (value === null) {
    return null;
  }
  try {
    return new Decimal(value);
  } catch {
    return new Decimal(0);
  }
}

function decimalToStorage(value: Decimal | null): string | null {
  return value === null ? null : decimalToCanonicalString(value);
}

function decimalToCanonicalString(value: Decimal): string {
  const normalized = value.isZero() ? new Decimal(0) : value;
  const fixed = normalized.toFixed();
  return fixed.includes(".") ? fixed.replace(/\.?0+$/u, "") : fixed;
}

function validateAssetBackedIncomeValues(
  activityType: string,
  subtype: string | null,
  quantity: Decimal | null,
  unitPrice: Decimal | null,
  amount: Decimal | null,
): void {
  if (!isAssetBackedIncomeSubtype(activityType, subtype)) {
    return;
  }
  if (quantity === null || !quantity.gt(0)) {
    throw new Error("Asset-backed income activities require a positive quantity");
  }
  const hasPositiveUnitPrice = unitPrice !== null && unitPrice.gt(0);
  const hasPositiveAmount = amount !== null && amount.gt(0);
  if (!hasPositiveUnitPrice && !hasPositiveAmount) {
    throw new Error("Asset-backed income activities require an amount or FMV per unit");
  }
  if (unitPrice !== null && unitPrice.isNegative()) {
    throw new Error("FMV per unit cannot be negative");
  }
  if (amount !== null && amount.isNegative()) {
    throw new Error("Income amount cannot be negative");
  }
}

function validateSplitRatio(activityType: string, amount: Decimal | null): void {
  if (activityType === "SPLIT" && (amount === null || !amount.gt(0))) {
    throw new Error("Split activities require a positive amount ratio");
  }
}

function isAssetBackedIncomeSubtype(activityType: string, subtype: string | null): boolean {
  if (!subtype) {
    return false;
  }
  return (
    (activityType.toUpperCase() === "DIVIDEND" &&
      (subtype.toUpperCase() === "DRIP" || subtype.toUpperCase() === "DIVIDEND_IN_KIND")) ||
    (activityType.toUpperCase() === "INTEREST" && subtype.toUpperCase() === "STAKING_REWARD")
  );
}

function requiresAssetIdentity(activityType: string, subtype: string | null): boolean {
  return (
    SYMBOL_REQUIRED_ACTIVITY_TYPES.has(activityType) ||
    isAssetBackedIncomeSubtype(activityType, subtype)
  );
}

type ImportSymbolDisposition =
  | { kind: "resolve" }
  | { kind: "cash" }
  | { kind: "needs_review"; message: string };

function importSymbolDisposition(
  activityType: string,
  subtype: string | null,
  symbol: string,
  quantity: Decimal | null,
  unitPrice: Decimal | null,
): ImportSymbolDisposition {
  if (isAssetBackedIncomeSubtype(activityType, subtype)) {
    return { kind: "resolve" };
  }

  const trimmedSymbol = symbol.trim();
  if (activityType === "DIVIDEND" || activityType === "ADJUSTMENT") {
    if (!trimmedSymbol || isCashSymbol(trimmedSymbol) || isGarbageSymbol(trimmedSymbol)) {
      return { kind: "cash" };
    }
    return { kind: "resolve" };
  }

  if (SYMBOL_REQUIRED_ACTIVITY_TYPES.has(activityType)) {
    return { kind: "resolve" };
  }

  if (!trimmedSymbol || isCashSymbol(trimmedSymbol) || isGarbageSymbol(trimmedSymbol)) {
    return { kind: "cash" };
  }

  if (NEVER_ASSET_ACTIVITY_TYPES.has(activityType)) {
    return { kind: "cash" };
  }

  if (TRANSFER_ACTIVITY_TYPES.has(activityType)) {
    const hasQuantity = quantity !== null && !quantity.isZero();
    const hasUnitPrice = unitPrice !== null && !unitPrice.isZero();
    if (hasQuantity || hasUnitPrice) {
      return { kind: "resolve" };
    }
    return {
      kind: "needs_review",
      message: `Symbol '${trimmedSymbol}' on ${activityType} with no quantity or price. Remove the symbol for a cash transfer, or add quantity for an asset transfer.`,
    };
  }

  return { kind: "resolve" };
}

function isSecuritiesTransfer(activityType: string, assetId: string | null): boolean {
  return (
    (activityType === "TRANSFER_IN" || activityType === "TRANSFER_OUT") &&
    assetId !== null &&
    !isCashSymbol(assetId)
  );
}

function isCashSymbol(symbol: string): boolean {
  const stripped = symbol.trim().toUpperCase().replace(/^\$/u, "");
  const currency = stripped.match(/^CASH[-_:]([A-Z]{3})$/u)?.[1];
  return currency !== undefined;
}

function isGarbageSymbol(symbol: string): boolean {
  const trimmed = symbol.trim();
  if (!trimmed) {
    return false;
  }
  return (
    [...trimmed].every((char) => char === "-") ||
    (trimmed.startsWith("$") && !isCashSymbol(trimmed))
  );
}

function resolveCurrency(candidates: string[]): string {
  return candidates.find((candidate) => candidate.trim() !== "") ?? "USD";
}

function hasCurrencyNormalizationRule(currency: string): boolean {
  return CURRENCY_NORMALIZATION_RULES[currency] !== undefined;
}

function normalizeAmount(value: Decimal, currency: string): Decimal {
  const rule = CURRENCY_NORMALIZATION_RULES[currency];
  return rule ? value.mul(rule.factor) : value;
}

function normalizedCurrencyCode(currency: string): string {
  return CURRENCY_NORMALIZATION_RULES[currency]?.majorCode ?? currency;
}

function serializeActivityMetadata(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}

function recordArrayField(
  input: Record<string, unknown>,
  field: string,
): Record<string, unknown>[] {
  const value = input[field];
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || !value.every(isRecord)) {
    throw new Error(`Invalid input: ${field} must be an array of objects`);
  }
  return value;
}

function stringArrayField(input: Record<string, unknown>, field: string): string[] {
  const value = input[field];
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error(`Invalid input: ${field} must be a string array`);
  }
  return value;
}

function stringFieldOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringFieldOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function optionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function requiredNonEmptyString(value: unknown, field: string): string {
  const raw = requiredString(value, field);
  if (raw.trim() === "") {
    throw new Error(`Invalid input: ${field} cannot be empty`);
  }
  return raw;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid input: ${field} must be a string`);
  }
  return value;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function chunkForSqlite<T>(items: T[]): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += SQLITE_MAX_PARAMS_CHUNK) {
    chunks.push(items.slice(index, index + SQLITE_MAX_PARAMS_CHUNK));
  }
  return chunks;
}

function sqliteNow(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function activityTimestampNow(): string {
  return new Date().toISOString();
}

function activityStorageTimestampNow(): string {
  return dateToUtcRfc3339(new Date());
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
