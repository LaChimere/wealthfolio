import type { Database } from "bun:sqlite";

export type CustomProviderSourceKind = "latest" | "historical";
export type CustomProviderSourceFormat = "json" | "html" | "html_table" | "csv";

export interface CustomProviderSource {
  id: string;
  providerId: string;
  kind: CustomProviderSourceKind;
  format: CustomProviderSourceFormat;
  url: string;
  pricePath: string;
  datePath: string | null;
  dateFormat: string | null;
  currencyPath: string | null;
  factor: number | null;
  invert: boolean | null;
  locale: string | null;
  headers: string | null;
  openPath: string | null;
  highPath: string | null;
  lowPath: string | null;
  volumePath: string | null;
  defaultPrice: number | null;
  dateTimezone: string | null;
}

export interface CustomProviderWithSources {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  priority: number;
  sources: CustomProviderSource[];
}

export interface NewCustomProvider {
  code: string;
  name: string;
  description?: string | null;
  priority?: number | null;
  sources: NewCustomProviderSource[];
}

export interface UpdateCustomProvider {
  name?: string | null;
  description?: string | null;
  enabled?: boolean | null;
  priority?: number | null;
  sources?: NewCustomProviderSource[] | null;
}

export interface NewCustomProviderSource {
  kind: CustomProviderSourceKind;
  format: CustomProviderSourceFormat;
  url: string;
  pricePath: string;
  datePath?: string | null;
  dateFormat?: string | null;
  currencyPath?: string | null;
  factor?: number | null;
  invert?: boolean | null;
  locale?: string | null;
  headers?: string | null;
  openPath?: string | null;
  highPath?: string | null;
  lowPath?: string | null;
  volumePath?: string | null;
  defaultPrice?: number | null;
  dateTimezone?: string | null;
}

export type CustomProviderSyncOperation = "Create" | "Update" | "Delete";

export interface CustomProviderSyncEvent {
  providerUuid: string;
  operation: CustomProviderSyncOperation;
  payload: CustomProviderRowPayload | { id: string };
}

export interface CustomProviderRepositoryOptions {
  queueSyncEvent?: (event: CustomProviderSyncEvent) => void;
  warn?: (message: string) => void;
}

export interface CustomProviderRepository {
  getAll(): CustomProviderWithSources[];
  getSourceByKind(
    providerCode: string,
    kind: CustomProviderSourceKind,
  ): CustomProviderSource | null;
  create(payload: NewCustomProvider): CustomProviderWithSources;
  update(providerCode: string, payload: UpdateCustomProvider): CustomProviderWithSources;
  delete(providerCode: string): void;
  getAssetCountForProvider(providerCode: string): number;
}

export interface CustomProviderService {
  getAll(): CustomProviderWithSources[];
  getSourceByKind(
    providerCode: string,
    kind: CustomProviderSourceKind,
  ): CustomProviderSource | null;
  create(payload: NewCustomProvider): Promise<CustomProviderWithSources>;
  update(providerCode: string, payload: UpdateCustomProvider): Promise<CustomProviderWithSources>;
  delete(providerCode: string): Promise<void>;
}

interface CustomProviderRow {
  id: string;
  code: string;
  name: string;
  description: string;
  enabled: number | boolean;
  priority: number;
  config: string | null;
  created_at: string;
  updated_at: string;
}

export interface CustomProviderRowPayload {
  id: string;
  code: string;
  name: string;
  description: string;
  enabled: boolean;
  priority: number;
  config: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ProviderConfig {
  sources?: unknown;
}

const RESERVED_CODES = [
  "yahoo",
  "alpha_vantage",
  "marketdata_app",
  "metal_price_api",
  "finnhub",
  "openfigi",
  "us_treasury_calc",
  "boerse_frankfurt",
  "custom_scraper",
  "manual",
  "broker",
] as const;

const VALID_SOURCE_KINDS = ["latest", "historical"] as const;
const VALID_SOURCE_FORMATS = ["json", "html", "html_table", "csv"] as const;

export function createCustomProviderRepository(
  db: Database,
  options: CustomProviderRepositoryOptions = {},
): CustomProviderRepository {
  return {
    getAll() {
      return db
        .query<CustomProviderRow, []>(
          `
            SELECT ${customProviderColumns()}
            FROM market_data_custom_providers
            ORDER BY priority ASC
          `,
        )
        .all()
        .map((row) => customProviderFromRow(row, options));
    },
    getSourceByKind(providerCode, kind) {
      const row = db
        .query<CustomProviderRow, [string]>(
          `
            SELECT ${customProviderColumns()}
            FROM market_data_custom_providers
            WHERE code = ?
          `,
        )
        .get(providerCode);
      if (!row || !Boolean(row.enabled)) {
        return null;
      }
      return (
        parseSources(row.config, row.code, options).find((source) => source.kind === kind) ?? null
      );
    },
    create(payload) {
      const id = crypto.randomUUID();
      const now = timestampNow();
      const row: CustomProviderRow = {
        id,
        code: payload.code,
        name: payload.name,
        description: payload.description ?? "",
        enabled: true,
        priority: payload.priority ?? 50,
        config: sourcesToConfigJson(payload.sources),
        created_at: now,
        updated_at: now,
      };
      db.transaction(() => {
        db.prepare(
          `
            INSERT INTO market_data_custom_providers (
              id, code, name, description, enabled, priority, config, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        ).run(
          row.id,
          row.code,
          row.name,
          row.description,
          boolToInt(Boolean(row.enabled)),
          row.priority,
          row.config,
          row.created_at,
          row.updated_at,
        );
        queueSyncEvent(options, row, "Create");
      })();
      return customProviderFromRow(row, options);
    },
    update(providerCode, payload) {
      let updated: CustomProviderRow | undefined;
      db.transaction(() => {
        const existing = readProviderRowByCode(db, providerCode);
        const now = timestampNow();
        updated = {
          ...existing,
          name: payload.name ?? existing.name,
          description: payload.description ?? existing.description,
          enabled: payload.enabled ?? Boolean(existing.enabled),
          priority: payload.priority ?? existing.priority,
          config:
            payload.sources === undefined || payload.sources === null
              ? existing.config
              : sourcesToConfigJson(payload.sources),
          updated_at: now,
        };
        db.prepare(
          `
            UPDATE market_data_custom_providers
            SET
              name = ?,
              description = ?,
              enabled = ?,
              priority = ?,
              config = ?,
              updated_at = ?
            WHERE code = ?
          `,
        ).run(
          updated.name,
          updated.description,
          boolToInt(Boolean(updated.enabled)),
          updated.priority,
          updated.config,
          updated.updated_at,
          providerCode,
        );
        queueSyncEvent(options, updated, "Update");
      })();
      if (!updated) {
        throw new Error(`Record not found: custom provider ${providerCode}`);
      }
      return customProviderFromRow(updated, options);
    },
    delete(providerCode) {
      db.transaction(() => {
        const existing = readProviderRowByCode(db, providerCode);
        db.prepare("DELETE FROM market_data_custom_providers WHERE code = ?").run(providerCode);
        queueSyncDelete(options, existing.id);
      })();
    },
    getAssetCountForProvider(providerCode) {
      const escapedCode = providerCode.replaceAll("%", "\\%").replaceAll("_", "\\_");
      const overridePattern = `%"CUSTOM:${escapedCode}":%`;
      const row = db
        .query<{ count: number }, [string, string]>(
          `
            SELECT COUNT(*) AS count
            FROM assets
            WHERE json_extract(provider_config, '$.custom_provider_code') = ?
              OR provider_config LIKE ? ESCAPE '\\'
          `,
        )
        .get(providerCode, overridePattern);
      return row?.count ?? 0;
    },
  };
}

export function createCustomProviderService(
  repository: CustomProviderRepository,
): CustomProviderService {
  return {
    getAll() {
      return repository.getAll();
    },
    getSourceByKind(providerCode, kind) {
      return repository.getSourceByKind(providerCode, kind);
    },
    async create(payload) {
      const code = normalizeNewProviderCode(payload.code);
      validateSourceDefinitions(payload.sources);
      return repository.create({
        ...payload,
        code,
      });
    },
    async update(providerCode, payload) {
      if (payload.sources !== undefined && payload.sources !== null) {
        validateSourceDefinitions(payload.sources);
      }
      return repository.update(providerCode, payload);
    },
    async delete(providerCode) {
      const exists = repository.getAll().some((provider) => provider.id === providerCode);
      if (!exists) {
        throw new Error(
          `Invalid input: Provider '${providerCode}' not found or is not a custom provider.`,
        );
      }
      const assetCount = repository.getAssetCountForProvider(providerCode);
      if (assetCount > 0) {
        throw new Error(
          `Invalid input: Cannot delete '${providerCode}': ${assetCount} asset(s) still use it as preferred provider. Change their preferred provider first, then try again.`,
        );
      }
      repository.delete(providerCode);
    },
  };
}

function normalizeNewProviderCode(rawCode: string): string {
  const code = rawCode.trim().toLowerCase();
  if (code.length === 0) {
    throw new Error("Invalid input: Code cannot be empty");
  }
  if (!/^[a-z0-9-]+$/.test(code)) {
    throw new Error(
      "Invalid input: Code must contain only lowercase letters, numbers, and hyphens",
    );
  }
  if ((RESERVED_CODES as readonly string[]).includes(code)) {
    throw new Error(`Invalid input: Code '${code}' is reserved`);
  }
  return code;
}

function validateSourceDefinitions(sources: NewCustomProviderSource[]): void {
  for (const source of sources) {
    if (!(VALID_SOURCE_KINDS as readonly string[]).includes(source.kind)) {
      throw new Error(`Invalid input: Invalid source kind '${source.kind}'`);
    }
    if (!(VALID_SOURCE_FORMATS as readonly string[]).includes(source.format)) {
      throw new Error(`Invalid input: Invalid source format '${source.format}'`);
    }
  }
}

function customProviderColumns(): string {
  return [
    "id",
    "code",
    "name",
    "description",
    "enabled",
    "priority",
    "config",
    "created_at",
    "updated_at",
  ].join(", ");
}

function readProviderRowByCode(db: Database, code: string): CustomProviderRow {
  const row = db
    .query<CustomProviderRow, [string]>(
      `
        SELECT ${customProviderColumns()}
        FROM market_data_custom_providers
        WHERE code = ?
      `,
    )
    .get(code);
  if (!row) {
    throw new Error(`Record not found: custom provider ${code}`);
  }
  return row;
}

function customProviderFromRow(
  row: CustomProviderRow,
  options: CustomProviderRepositoryOptions,
): CustomProviderWithSources {
  return {
    id: row.code,
    name: row.name,
    description: row.description,
    enabled: Boolean(row.enabled),
    priority: row.priority,
    sources: parseSources(row.config, row.code, options),
  };
}

function parseSources(
  configJson: string | null,
  providerCode: string,
  options: CustomProviderRepositoryOptions,
): CustomProviderSource[] {
  if (!configJson) {
    return [];
  }
  let parsed: ProviderConfig;
  try {
    parsed = JSON.parse(configJson) as ProviderConfig;
  } catch (error) {
    warn(
      options,
      `Failed to parse config JSON for provider '${providerCode}': ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
  if (!Array.isArray(parsed.sources)) {
    return [];
  }
  return parsed.sources
    .filter(isNewSourceRecord)
    .map((source) => newSourceToSource(providerCode, source));
}

function isNewSourceRecord(value: unknown): value is NewCustomProviderSource {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.kind === "string" &&
    typeof candidate.format === "string" &&
    typeof candidate.url === "string" &&
    typeof candidate.pricePath === "string"
  );
}

function newSourceToSource(
  providerCode: string,
  source: NewCustomProviderSource,
): CustomProviderSource {
  return {
    id: `${providerCode}:${source.kind}`,
    providerId: providerCode,
    kind: source.kind,
    format: source.format,
    url: source.url,
    pricePath: source.pricePath,
    datePath: source.datePath ?? null,
    dateFormat: source.dateFormat ?? null,
    currencyPath: source.currencyPath ?? null,
    factor: source.factor ?? null,
    invert: source.invert ?? null,
    locale: source.locale ?? null,
    headers: source.headers ?? null,
    openPath: source.openPath ?? null,
    highPath: source.highPath ?? null,
    lowPath: source.lowPath ?? null,
    volumePath: source.volumePath ?? null,
    defaultPrice: source.defaultPrice ?? null,
    dateTimezone: source.dateTimezone ?? null,
  };
}

function sourcesToConfigJson(sources: NewCustomProviderSource[]): string {
  return JSON.stringify({
    sources: sources.map(normalizeNewSourceForConfig),
  });
}

function normalizeNewSourceForConfig(
  source: NewCustomProviderSource,
): Required<NewCustomProviderSource> {
  return {
    kind: source.kind,
    format: source.format,
    url: source.url,
    pricePath: source.pricePath,
    datePath: source.datePath ?? null,
    dateFormat: source.dateFormat ?? null,
    currencyPath: source.currencyPath ?? null,
    factor: source.factor ?? null,
    invert: source.invert ?? null,
    locale: source.locale ?? null,
    headers: source.headers ?? null,
    openPath: source.openPath ?? null,
    highPath: source.highPath ?? null,
    lowPath: source.lowPath ?? null,
    volumePath: source.volumePath ?? null,
    defaultPrice: source.defaultPrice ?? null,
    dateTimezone: source.dateTimezone ?? null,
  };
}

function queueSyncEvent(
  options: CustomProviderRepositoryOptions,
  row: CustomProviderRow,
  operation: Exclude<CustomProviderSyncOperation, "Delete">,
): void {
  options.queueSyncEvent?.({
    providerUuid: row.id,
    operation,
    payload: rowPayload(row),
  });
}

function queueSyncDelete(options: CustomProviderRepositoryOptions, providerUuid: string): void {
  options.queueSyncEvent?.({
    providerUuid,
    operation: "Delete",
    payload: { id: providerUuid },
  });
}

function rowPayload(row: CustomProviderRow): CustomProviderRowPayload {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    enabled: Boolean(row.enabled),
    priority: row.priority,
    config: row.config,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function boolToInt(value: boolean): number {
  return value ? 1 : 0;
}

function timestampNow(): string {
  return new Date().toISOString();
}

function warn(options: CustomProviderRepositoryOptions, message: string): void {
  if (options.warn) {
    options.warn(message);
    return;
  }
  console.warn(message);
}
