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

export interface ActivityService {
  searchActivities?(
    request: ActivitySearchRequest,
  ): Promise<ActivitySearchResponse> | ActivitySearchResponse;
  createActivity?(activity: Record<string, unknown>): Promise<unknown> | unknown;
  updateActivity?(activity: Record<string, unknown>): Promise<unknown> | unknown;
  bulkMutateActivities?(request: Record<string, unknown>): Promise<unknown> | unknown;
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
  currency: string;
}

interface AssetRow {
  id: string;
  quote_ccy: string;
}

interface ActivityAssetInput {
  id?: string;
  symbol?: string;
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
            update.account_id,
            update.asset_id,
            update.activity_type,
            update.activity_type_override,
            update.source_type,
            update.subtype,
            update.status,
            update.activity_date,
            update.settlement_date,
            update.quantity,
            update.unit_price,
            update.amount,
            update.fee,
            update.currency,
            update.fx_rate,
            update.notes,
            update.metadata,
            update.source_system,
            update.source_record_id,
            update.source_group_id,
            update.idempotency_key,
            update.import_run_id,
            update.created_at,
            update.updated_at,
            update.id,
          );
        } catch (error) {
          throw mapActivitySqliteError(error);
        }

        return activityFromRow(readActivityRow(db, activityId));
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
    throw new Error(
      "Symbol-based activity asset resolution is not yet implemented in the TS runtime",
    );
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
  return id || symbol ? { id, symbol } : null;
}

function readAccountRow(db: Database, accountId: string): AccountRow {
  const row = db
    .query<AccountRow, [string]>(
      `
        SELECT id, currency
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
        SELECT id, quote_ccy
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

function insertActivityRow(db: Database, activity: ActivityCreateRowInput): void {
  db.query(
    `
      INSERT INTO activities (
        id, account_id, asset_id, activity_type, activity_type_override, source_type, subtype,
        status, activity_date, settlement_date, quantity, unit_price, amount, fee, currency,
        fx_rate, notes, metadata, source_system, source_record_id, source_group_id,
        idempotency_key, import_run_id, is_user_modified, needs_review, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, ?)
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
    activity.needsReview ? 1 : 0,
    activity.createdAt,
    activity.updatedAt,
  );
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
