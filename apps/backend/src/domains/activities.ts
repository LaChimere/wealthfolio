import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import Decimal from "decimal.js";

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN });

export const ACTIVITY_IMPORT_CONTEXT_KIND = "ACTIVITY";
export const CSV_ACTIVITY_CONTEXT_KIND = "CSV_ACTIVITY";
export const CSV_HOLDINGS_CONTEXT_KIND = "CSV_HOLDINGS";

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

export interface ActivityService {
  searchActivities?(
    request: ActivitySearchRequest,
  ): Promise<ActivitySearchResponse> | ActivitySearchResponse;
  createActivity?(activity: Record<string, unknown>): Promise<Activity> | Activity;
  updateActivity?(activity: Record<string, unknown>): Promise<Activity> | Activity;
  bulkMutateActivities?(
    request: Record<string, unknown>,
  ): Promise<ActivityBulkMutationResult> | ActivityBulkMutationResult;
  deleteActivity?(id: string): Promise<Activity> | Activity;
  linkTransferActivities?(
    activityAId: string,
    activityBId: string,
  ): Promise<[Activity, Activity]> | [Activity, Activity];
  unlinkTransferActivities?(
    activityAId: string,
    activityBId: string,
  ): Promise<[Activity, Activity]> | [Activity, Activity];
  checkActivitiesImport?(activities: unknown[]): Promise<unknown[]> | unknown[];
  previewImportAssets?(candidates: unknown[]): Promise<unknown[]> | unknown[];
  importActivities?(activities: unknown[]): Promise<unknown> | unknown;
  parseCsv?(request: ActivityParseCsvRequest): Promise<unknown> | unknown;
  getImportMapping?(accountId: string, contextKind: string): Promise<ImportMappingData>;
  saveImportMapping?(mapping: Record<string, unknown>): Promise<ImportMappingData>;
  listImportTemplates?(): Promise<ImportTemplateData[]> | ImportTemplateData[];
  getImportTemplate?(id: string): Promise<ImportTemplateData> | ImportTemplateData;
  saveImportTemplate?(
    template: Record<string, unknown>,
  ): Promise<ImportTemplateData> | ImportTemplateData;
  deleteImportTemplate?(id: string): Promise<void> | void;
  linkAccountTemplate?(
    accountId: string,
    templateId: string,
    contextKind: string,
  ): Promise<void> | void;
  checkExistingDuplicates?(
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

interface ActivityRow {
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
  instrument_symbol: string | null;
  instrument_exchange_mic: string | null;
  instrument_type: string | null;
}

interface ActivityAssetInput {
  id?: string;
  symbol?: string;
  exchangeMic?: string;
  instrumentType?: string;
  quoteCcy?: string;
}

interface ActivityCreateRowInput {
  id: string;
  accountId: string;
  assetId: string | null;
  activityType: string;
  subtype: string | null;
  status: string;
  activityDate: string;
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
  createdAt: string;
  updatedAt: string;
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

export function createActivityService(db: Database): ActivityService {
  return {
    createActivity(input) {
      return db.transaction(() => {
        const activity = normalizeActivityCreateInput(db, input);
        if (activity.idempotencyKey !== null) {
          const existingId = findActivityIdByIdempotencyKey(db, activity.idempotencyKey);
          if (existingId !== null) {
            throw duplicateActivityError(existingId);
          }
        }

        try {
          insertActivityRow(db, activity);
        } catch (error) {
          throw mapActivitySqliteError(error);
        }

        return activityFromRow(readActivityRow(db, activity.id));
      })();
    },

    updateActivity(input) {
      return db.transaction(() => {
        const activityId = requiredNonEmptyString(input.id, "id");
        const existing = readActivityRow(db, activityId);
        const update = normalizeActivityUpdateInput(db, input, existing);

        try {
          updateActivityRow(db, update);
        } catch (error) {
          throw mapActivitySqliteError(error);
        }

        return activityFromRow(readActivityRow(db, activityId));
      })();
    },

    bulkMutateActivities(input) {
      return db.transaction(() => {
        const creates = recordArrayField(input, "creates");
        const updates = recordArrayField(input, "updates");
        const deleteIds = stringArrayField(input, "deleteIds");
        const errors: ActivityBulkMutationError[] = [];
        const preparedCreates: Array<{
          activity: ActivityCreateRowInput;
          tempId: string | null;
        }> = [];
        const preparedUpdates: ActivityRow[] = [];
        const preparedDeletes: ActivityRow[] = [];
        const createIdempotencyKeys = new Set<string>();
        const deleteIdSet = new Set(deleteIds);

        for (const createInput of creates) {
          const tempId = stringFieldOrNull(createInput.id)?.trim() || null;
          try {
            const activity = normalizeActivityCreateInput(db, createInput);
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
            preparedUpdates.push(normalizeActivityUpdateInput(db, updateInput, existing));
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

        if (errors.length > 0) {
          return emptyBulkMutationResult(errors);
        }

        const result = emptyBulkMutationResult([]);
        try {
          for (const activity of preparedDeletes) {
            db.query("DELETE FROM activities WHERE id = ?").run(activity.id);
            result.deleted.push(activityFromRow(activity));
          }
          for (const activity of preparedUpdates) {
            updateActivityRow(db, activity);
            result.updated.push(activityFromRow(readActivityRow(db, activity.id)));
          }
          for (const { activity, tempId } of preparedCreates) {
            insertActivityRow(db, activity);
            result.created.push(activityFromRow(readActivityRow(db, activity.id)));
            result.createdMappings.push({ tempId, activityId: activity.id });
          }
        } catch (error) {
          throw mapActivitySqliteError(error);
        }

        return result;
      })();
    },

    searchActivities(request) {
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
      return candidates.map((candidate, index) => previewImportAsset(db, candidate, index));
    },

    checkActivitiesImport(activities) {
      return checkActivitiesImportRows(db, activities);
    },

    importActivities(activities) {
      return importActivityRows(db, activities);
    },

    linkTransferActivities(activityAId, activityBId) {
      if (activityAId === activityBId) {
        throw new Error("Cannot link an activity to itself");
      }

      return db.transaction(() => {
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
        const updatedPair: [Activity, Activity] = [
          activityFromRow(readActivityRow(db, transferIn.id)),
          activityFromRow(readActivityRow(db, transferOut.id)),
        ];
        return updatedPair;
      })();
    },

    unlinkTransferActivities(activityAId, activityBId) {
      if (activityAId === activityBId) {
        throw new Error("Cannot unlink an activity from itself");
      }

      return db.transaction(() => {
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
        const updatedPair: [Activity, Activity] = [
          activityFromRow(readActivityRow(db, transferIn.id)),
          activityFromRow(readActivityRow(db, transferOut.id)),
        ];
        return updatedPair;
      })();
    },

    deleteActivity(activityId) {
      return db.transaction(() => {
        const deleted = readActivityRow(db, activityId);
        db.query("DELETE FROM activities WHERE id = ?").run(activityId);
        return activityFromRow(deleted);
      })();
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

        saved = { ...mapping, templateId: mapping.templateId ?? undefined };
      })();

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
      return template;
    },

    deleteImportTemplate(id) {
      db.query("DELETE FROM import_templates WHERE id = ?").run(id);
    },

    linkAccountTemplate(accountId, templateId, contextKind) {
      const normalizedContextKind = normalizeContextKindValue(contextKind);
      const existingLink = readImportAccountTemplateLink(db, accountId, normalizedContextKind);
      const now = sqliteNow();
      upsertImportAccountTemplateLink(db, {
        id: existingLink?.id ?? crypto.randomUUID(),
        account_id: accountId,
        context_kind: normalizedContextKind,
        source_system: "",
        template_id: templateId,
        created_at: now,
        updated_at: now,
      });
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

function previewImportAsset(db: Database, input: unknown, index: number): Record<string, unknown> {
  const candidate = isRecord(input) ? input : {};
  const key = optionalTrimmedString(candidate.key) ?? `candidate-${index + 1}`;
  const accountId = optionalTrimmedString(candidate.accountId);
  const symbol = optionalTrimmedString(candidate.symbol);
  const exchangeMic = optionalTrimmedString(candidate.exchangeMic)?.toUpperCase();
  const instrumentType = normalizeInstrumentType(optionalTrimmedString(candidate.instrumentType));
  const quoteMode = normalizeQuoteMode(optionalTrimmedString(candidate.quoteMode));
  const quoteCcy = normalizeImportQuoteCurrency(
    optionalTrimmedString(candidate.quoteCcy) ?? optionalTrimmedString(candidate.currency),
  );
  const errors: Record<string, string[]> = {};

  if (!accountId) {
    addFieldMessage(errors, "accountId", "Account is required before running backend validation.");
  } else {
    try {
      readAccountRow(db, accountId);
    } catch (error) {
      addFieldMessage(errors, "general", `Validation failed: ${errorMessage(error)}`);
    }
  }
  if (!symbol) {
    addFieldMessage(errors, "symbol", "Symbol is required for asset preview.");
  }

  if (Object.keys(errors).length > 0 || !symbol) {
    return importAssetPreviewItem(key, "NEEDS_FIXING", "validation_error", { errors });
  }

  try {
    const existingAsset = findExistingAssetBySymbol(db, {
      symbol,
      exchangeMic,
      instrumentType,
      quoteCcy,
    });
    if (existingAsset) {
      return importAssetPreviewItem(key, "EXISTING_ASSET", "existing_asset", {
        assetId: existingAsset.id,
        draft: newAssetDraftFromAssetRow(existingAsset),
      });
    }
  } catch (error) {
    addFieldMessage(errors, "symbol", errorMessage(error));
    return importAssetPreviewItem(key, "NEEDS_FIXING", "ambiguous_existing_asset", { errors });
  }

  if (!instrumentType) {
    addFieldMessage(
      errors,
      "instrumentType",
      "Instrument type is required to preview a new asset.",
    );
  }
  if (!quoteCcy) {
    addFieldMessage(errors, "quoteCcy", "Quote currency is required to preview a new asset.");
  }
  if (Object.keys(errors).length > 0 || !instrumentType || !quoteCcy) {
    return importAssetPreviewItem(key, "NEEDS_FIXING", "validation_error", { errors });
  }

  const draft = newAssetDraftFromImport({
    symbol,
    quoteCcy,
    instrumentType,
    exchangeMic,
    quoteMode: quoteMode ?? "MARKET",
  });
  if (instrumentType === "EQUITY" && !exchangeMic && quoteMode !== "MANUAL") {
    addFieldMessage(
      errors,
      "symbol",
      `Could not determine the exchange for '${symbol}'. Please search for the correct ticker.`,
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
    notes: asset.notes ?? undefined,
  };
}

function newAssetDraftFromImport(input: {
  symbol: string;
  quoteCcy: string;
  instrumentType: string;
  exchangeMic?: string;
  quoteMode: string;
}): Record<string, unknown> {
  return {
    kind: input.instrumentType === "FX" ? "FX" : "INVESTMENT",
    displayCode: input.symbol,
    isActive: true,
    quoteMode: input.quoteMode,
    quoteCcy: input.quoteCcy,
    instrumentType: input.instrumentType,
    instrumentSymbol: input.symbol,
    instrumentExchangeMic: input.exchangeMic,
  };
}

function normalizeInstrumentType(value: string | undefined): string | undefined {
  switch (value?.toUpperCase()) {
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
  if (trimmed === "GBp") {
    return "GBp";
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

function checkActivitiesImportRows(
  db: Database,
  activities: unknown[],
): Array<Record<string, unknown>> {
  const checked = activities.map((activity, index) => checkActivityImportRow(db, activity, index));
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

function checkActivityImportRow(
  db: Database,
  input: unknown,
  index: number,
): { activity: Record<string, unknown>; idempotencyKey: string | null } {
  const activity = isRecord(input) ? { ...input } : {};
  const errors = cloneMessageMap(activity.errors);
  const accountId = optionalTrimmedString(activity.accountId);
  const activityType = optionalTrimmedString(activity.activityType);
  const subtype = optionalTrimmedString(activity.subtype);
  const symbol = optionalTrimmedString(activity.symbol);
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

  if (Object.keys(errors).length > 0 || !accountId || !activityType) {
    activity.isValid = false;
    activity.errors = errors;
    return { activity, idempotencyKey: null };
  }

  const needsAsset = requiresAssetIdentity(activityType, subtype ?? null);
  const createInput: Record<string, unknown> = {
    id: optionalTrimmedString(activity.id),
    accountId,
    activityType,
    subtype,
    activityDate: activity.date ?? activity.activityDate,
    quantity: activity.quantity,
    unitPrice: activity.unitPrice,
    amount: activity.amount,
    fee: activity.fee,
    currency: optionalTrimmedString(activity.currency) ?? account?.currency,
    comment: activity.comment,
    fxRate: activity.fxRate,
  };
  if (assetId) {
    createInput.asset = { id: assetId };
  } else if (needsAsset && symbol) {
    createInput.asset = {
      symbol,
      exchangeMic: optionalTrimmedString(activity.exchangeMic),
      instrumentType: optionalTrimmedString(activity.instrumentType),
      quoteCcy: optionalTrimmedString(activity.quoteCcy),
    };
  }

  try {
    const normalized = normalizeActivityCreateInput(db, createInput);
    activity.id = optionalTrimmedString(activity.id) ?? normalized.id;
    activity.accountId = normalized.accountId;
    activity.date = normalized.activityDate;
    activity.currency = normalized.currency;
    activity.amount = normalized.amount?.toString() ?? null;
    activity.quantity = normalized.quantity?.toString() ?? null;
    activity.unitPrice = normalized.unitPrice?.toString() ?? null;
    activity.fee = normalized.fee?.toString() ?? null;
    activity.fxRate = normalized.fxRate?.toString() ?? null;
    activity.assetId = normalized.assetId ?? undefined;
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
    addFieldMessage(errors, importValidationField(error), errorMessage(error));
    activity.isValid = false;
    activity.errors = errors;
    return { activity, idempotencyKey: null };
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

function importActivityRows(db: Database, activities: unknown[]): ImportActivitiesResult {
  return db.transaction(() => {
    const total = activities.length;
    const ordered: Array<Record<string, unknown> | null> = Array.from(
      { length: total },
      () => null,
    );
    const validInputs: Array<{ index: number; activity: Record<string, unknown> }> = [];
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
      const createInput = importActivityCreateInput(activity);
      collectImportApplyPreflightErrors(activity, errors);

      if (hasMessageMapEntries(errors)) {
        activity.errors = errors;
        activity.isValid = false;
        ordered[index] = activity;
        hasValidationErrors = true;
        continue;
      }

      try {
        const create = normalizeActivityCreateInput(db, createInput);
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

    const summary: ImportActivitiesSummary = {
      total,
      imported: insertable.length,
      skipped: duplicateCount,
      duplicates: duplicateCount,
      assetsCreated: 0,
      success: true,
      errorMessage: null,
    };
    const importRunId = insertCompletedImportRun(db, prepared[0]?.create.accountId ?? "", summary);

    try {
      for (const row of insertable) {
        row.create.importRunId = importRunId;
        insertActivityRow(db, row.create);
      }
    } catch (error) {
      throw mapActivitySqliteError(error);
    }

    for (const row of prepared) {
      ordered[row.index] = finalizeImportActivity(row.activity);
    }

    return {
      activities: ordered.flatMap((activity) => (activity === null ? [] : [activity])),
      importRunId,
      summary,
    };
  })();
}

function importActivityCreateInput(activity: Record<string, unknown>): Record<string, unknown> {
  const activityType = optionalTrimmedString(activity.activityType);
  const subtype = optionalTrimmedString(activity.subtype);
  const symbol = optionalTrimmedString(activity.symbol);
  const assetId = optionalTrimmedString(activity.assetId);
  const createInput: Record<string, unknown> = {
    id: optionalTrimmedString(activity.id),
    accountId: optionalTrimmedString(activity.accountId),
    activityType,
    subtype,
    activityDate: activity.date ?? activity.activityDate,
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
  };
  if (assetId) {
    createInput.asset = { id: assetId };
  } else if (symbol) {
    createInput.asset = {
      symbol,
      exchangeMic: optionalTrimmedString(activity.exchangeMic),
      instrumentType: optionalTrimmedString(activity.instrumentType),
      quoteCcy: optionalTrimmedString(activity.quoteCcy),
    };
  }
  return createInput;
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

  if (requiresAssetIdentity(activityType, subtype) && !symbol && !assetId) {
    addFieldMessage(errors, "symbol", "Symbol or asset_id is required to import this activity.");
    return;
  }

  if (requiresAssetIdentity(activityType, subtype) && symbol && !assetId) {
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

function addImportError(activity: Record<string, unknown>, field: string, message: string): void {
  const errors = cloneMessageMap(activity.errors);
  addFieldMessage(errors, field, message);
  activity.errors = errors;
}

function insertCompletedImportRun(
  db: Database,
  accountId: string,
  summary: ImportActivitiesSummary,
): string {
  const id = crypto.randomUUID();
  const now = activityTimestampNow();
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
    id,
    accountId,
    now,
    now,
    now,
    JSON.stringify({
      fetched: summary.total,
      inserted: summary.imported,
      updated: 0,
      skipped: summary.skipped,
      warnings: summary.duplicates,
      errors: 0,
      removed: 0,
      assetsCreated: summary.assetsCreated,
    }),
    now,
    now,
  );
  return id;
}

function normalizeActivityCreateInput(
  db: Database,
  input: Record<string, unknown>,
): ActivityCreateRowInput {
  const accountId = requiredNonEmptyString(input.accountId, "accountId");
  const account = readAccountRow(db, accountId);
  const activityType = requiredNonEmptyString(input.activityType, "activityType");
  const subtype = normalizeCreateSubtype(input.subtype);
  const activityDate = normalizeActivityDateInput(input.activityDate);
  let quantity = parseOptionalDecimal(input.quantity, "quantity")?.abs() ?? null;
  let unitPrice = parseOptionalDecimal(input.unitPrice, "unitPrice")?.abs() ?? null;
  let amount = parseOptionalDecimal(input.amount, "amount")?.abs() ?? null;
  let fee = parseOptionalDecimal(input.fee, "fee")?.abs() ?? null;
  const fxRate = parseOptionalDecimal(input.fxRate, "fxRate");
  validateAssetBackedIncomeValues(activityType, subtype, quantity, unitPrice, amount);
  validateSplitRatio(activityType, amount);

  const assetId = resolveActivityAssetId(db, input, activityType, subtype);
  const asset = assetId === null ? null : readAssetRow(db, assetId);
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
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeActivityUpdateInput(
  db: Database,
  input: Record<string, unknown>,
  existing: ActivityRow,
): ActivityRow {
  const accountId = requiredNonEmptyString(input.accountId, "accountId");
  const account = readAccountRow(db, accountId);
  const activityType = requiredNonEmptyString(input.activityType, "activityType");
  const activityDate = normalizeActivityDateInput(input.activityDate);
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

  const assetId = resolveActivityAssetId(db, input, activityType, effectiveSubtype);
  const asset = assetId === null ? null : readAssetRow(db, assetId);
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
): string | null {
  const assetInput = activityAssetInputFromRecord(input);
  if (assetInput?.id) {
    readAssetRow(db, assetInput.id);
    return assetInput.id;
  }
  if (assetInput?.symbol) {
    const existingAsset = findExistingAssetBySymbol(db, assetInput);
    if (existingAsset) {
      return existingAsset.id;
    }
    throw new Error("Symbol-based asset creation is not yet implemented in the TS runtime");
  }
  if (requiresAssetIdentity(activityType, subtype)) {
    throw new Error("Asset-backed activities need either asset_id or symbol");
  }
  return null;
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
  return id || symbol ? { id, symbol, exchangeMic, instrumentType, quoteCcy } : null;
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
  const row = db
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
          instrument_symbol,
          instrument_exchange_mic,
          instrument_type
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
  ];
  const params: string[] = [symbol, symbol, symbol];

  if (instrumentType) {
    clauses.push("UPPER(COALESCE(instrument_type, '')) = ?");
    params.push(instrumentType);
  }
  if (exchangeMic) {
    clauses.push("UPPER(COALESCE(instrument_exchange_mic, '')) = ?");
    params.push(exchangeMic);
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
  hash.update(input.activityDate.slice(0, 10));
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

function readImportTemplateRow(db: Database, id: string): ImportTemplateRow | null {
  return db
    .query<ImportTemplateRow, [string]>("SELECT * FROM import_templates WHERE id = ?")
    .get(id);
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
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid date format. Expected ISO 8601/RFC3339 or YYYY-MM-DD");
  }
  return dateToUtcRfc3339(date);
}

function assertValidDateParts(year: number, month: number, day: number): void {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) {
    throw new Error("Invalid date format. Expected ISO 8601/RFC3339 or YYYY-MM-DD");
  }
}

function dateToUtcRfc3339(date: Date): string {
  const iso = date.toISOString();
  return iso.endsWith(".000Z") ? `${iso.slice(0, -5)}+00:00` : iso.replace("Z", "+00:00");
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
