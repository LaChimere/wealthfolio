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

export interface ActivityService {
  searchActivities?(
    request: ActivitySearchRequest,
  ): Promise<ActivitySearchResponse> | ActivitySearchResponse;
  createActivity?(activity: Record<string, unknown>): Promise<unknown> | unknown;
  updateActivity?(activity: Record<string, unknown>): Promise<unknown> | unknown;
  bulkMutateActivities?(request: Record<string, unknown>): Promise<unknown> | unknown;
  deleteActivity?(id: string): Promise<unknown> | unknown;
  linkTransferActivities?(activityAId: string, activityBId: string): Promise<unknown[]> | unknown[];
  unlinkTransferActivities?(
    activityAId: string,
    activityBId: string,
  ): Promise<unknown[]> | unknown[];
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

export function createActivityService(db: Database): ActivityService {
  return {
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

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid input: ${field} must be a string`);
  }
  return value;
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
