import type { Database } from "bun:sqlite";

import { load, type CheerioAPI } from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { JSONPath } from "jsonpath-plus";

import { parseCsvRecords } from "../csv";
import type { SecretService } from "./secrets";

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

export interface TestSourceRequest {
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
  symbol: string;
  currency?: string | null;
  from?: string | null;
  to?: string | null;
  openPath?: string | null;
  highPath?: string | null;
  lowPath?: string | null;
  volumePath?: string | null;
  defaultPrice?: number | null;
  dateTimezone?: string | null;
}

export interface DetectedHtmlElement {
  selector: string;
  value: number;
  text: string;
  label: string;
  htmlContext: string;
}

export interface DetectedColumn {
  index: number;
  header: string;
  role: string | null;
}

export interface DetectedHtmlTable {
  index: number;
  columns: DetectedColumn[];
  rowCount: number;
  sampleRows: string[][];
}

export interface TestSourceResult {
  success: boolean;
  statusCode: number | null;
  price: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  currency: string | null;
  date: string | null;
  error: string | null;
  rawResponse: string | null;
  detectedElements: DetectedHtmlElement[] | null;
  detectedTables: DetectedHtmlTable[] | null;
}

export interface CustomProviderQuoteRow {
  price: number;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  date: string | null;
}

export interface CustomProviderRowsResult {
  statusCode: number | null;
  currency: string | null;
  rows: CustomProviderQuoteRow[];
}

export interface CustomProviderServiceOptions {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  responseSizeLimitBytes?: number;
  secretService?: SecretService;
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
  testSource(payload: TestSourceRequest): Promise<TestSourceResult>;
  fetchSourceRows(payload: TestSourceRequest): Promise<CustomProviderRowsResult>;
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
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const CUSTOM_PROVIDER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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
  options: CustomProviderServiceOptions = {},
): CustomProviderService {
  const fetchImpl = options.fetchImpl ?? fetch;
  const responseSizeLimitBytes = options.responseSizeLimitBytes ?? MAX_RESPONSE_BYTES;
  const now = options.now ?? (() => new Date());

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
    async testSource(payload) {
      return testCustomProviderSource(payload, {
        fetchImpl,
        now,
        responseSizeLimitBytes,
        secretService: options.secretService,
      });
    },
    async fetchSourceRows(payload) {
      return fetchCustomProviderSourceRows(payload, {
        fetchImpl,
        now,
        responseSizeLimitBytes,
        secretService: options.secretService,
      });
    },
  };
}

async function testCustomProviderSource(
  payload: TestSourceRequest,
  options: Required<
    Pick<CustomProviderServiceOptions, "fetchImpl" | "now" | "responseSizeLimitBytes">
  > &
    Pick<CustomProviderServiceOptions, "secretService">,
): Promise<TestSourceResult> {
  const fetched = await fetchCustomProviderSourceBody(payload, options);
  if (isTestSourceResult(fetched)) {
    return fetched;
  }
  const { context, statusCode, body } = fetched;

  if (payload.format === "json") {
    return testJsonSource(payload, context, options.now(), statusCode, body);
  }
  if (payload.format === "html") {
    return testHtmlSource(payload, statusCode, body);
  }
  if (payload.format === "html_table") {
    return testHtmlTableSource(payload, statusCode, body);
  }
  if (payload.format === "csv") {
    return testCsvSource(payload, statusCode, body);
  }
  return testSourceResult({
    success: false,
    statusCode,
    error: `Unsupported format: ${payload.format}`,
  });
}

async function fetchCustomProviderSourceRows(
  payload: TestSourceRequest,
  options: Required<
    Pick<CustomProviderServiceOptions, "fetchImpl" | "now" | "responseSizeLimitBytes">
  > &
    Pick<CustomProviderServiceOptions, "secretService">,
): Promise<CustomProviderRowsResult> {
  const fetched = await fetchCustomProviderSourceBody(payload, options);
  if (isTestSourceResult(fetched)) {
    const rows = defaultPriceRows(fetched);
    if (rows) {
      return {
        statusCode: fetched.statusCode,
        currency: fetched.currency,
        rows,
      };
    }
    throw new Error(fetched.error ?? "Custom provider source fetch failed");
  }
  const { context, statusCode, body } = fetched;
  if (payload.format === "json") {
    return {
      statusCode,
      currency: resolveJsonCurrency(payload, context, body, options.now()),
      rows: extractJsonRows(payload, context, options.now(), body),
    };
  }
  if (payload.format === "csv") {
    return {
      statusCode,
      currency: payload.currency ?? null,
      rows: extractCsvRows(body, payload),
    };
  }
  if (payload.format === "html_table") {
    return {
      statusCode,
      currency: payload.currency ?? null,
      rows: extractHtmlTableRows(body, payload),
    };
  }
  if (payload.format === "html") {
    const result = testHtmlSource(payload, statusCode, body);
    return {
      statusCode,
      currency: payload.currency ?? null,
      rows:
        result.success && result.price !== null
          ? [
              {
                price: result.price,
                open: result.open,
                high: result.high,
                low: result.low,
                volume: result.volume,
                date: result.date,
              },
            ]
          : [],
    };
  }
  throw new Error(`Unsupported format: ${payload.format}`);
}

interface CustomProviderFetchedBody {
  context: TemplateContext;
  statusCode: number;
  body: string;
}

async function fetchCustomProviderSourceBody(
  payload: TestSourceRequest,
  options: Required<
    Pick<CustomProviderServiceOptions, "fetchImpl" | "now" | "responseSizeLimitBytes">
  > &
    Pick<CustomProviderServiceOptions, "secretService">,
): Promise<CustomProviderFetchedBody | TestSourceResult> {
  const context = {
    symbol: payload.symbol,
    currency: payload.currency ?? "usd",
    isin: undefined,
    mic: undefined,
    from: payload.from ?? undefined,
    to: payload.to ?? undefined,
  };
  const url = expandTemplate(payload.url, context, options.now());
  if (url === "") {
    const fallback = defaultPriceResult(payload);
    if (fallback) {
      return fallback;
    }
  }
  validateHttpUrl(url);

  const headers = await buildTestSourceHeaders(payload, url, options.secretService);
  const response = await fetchWithRedirects(url, headers, options.fetchImpl);
  if (response instanceof Error) {
    const fallback = defaultPriceResult(payload);
    if (fallback) {
      return fallback;
    }
    return testSourceResult({
      success: false,
      error: `HTTP request failed: ${response.message}`,
    });
  }

  const statusCode = response.status;
  if (!response.ok) {
    const fallback = defaultPriceResult(payload, statusCode);
    if (fallback) {
      return fallback;
    }
  }
  const contentLength = parseContentLength(response.headers.get("content-length"));
  if (contentLength !== null && contentLength > options.responseSizeLimitBytes) {
    const fallback = defaultPriceResult(payload, statusCode);
    if (fallback) {
      return fallback;
    }
    return testSourceResult({
      success: false,
      statusCode,
      error: `Response body too large (${contentLength} bytes, max ${options.responseSizeLimitBytes})`,
    });
  }

  let bodyBytes: ArrayBuffer;
  try {
    bodyBytes = await response.arrayBuffer();
  } catch (error) {
    const fallback = defaultPriceResult(payload, statusCode);
    if (fallback) {
      return fallback;
    }
    return testSourceResult({
      success: false,
      statusCode,
      error: `Failed to read response body: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  if (bodyBytes.byteLength > options.responseSizeLimitBytes) {
    const fallback = defaultPriceResult(payload, statusCode);
    if (fallback) {
      return fallback;
    }
    return testSourceResult({
      success: false,
      statusCode,
      error: `Response body too large (${bodyBytes.byteLength} bytes, max ${options.responseSizeLimitBytes})`,
    });
  }
  const body = new TextDecoder().decode(bodyBytes);

  if (!response.ok) {
    return testSourceResult({
      success: false,
      statusCode,
      error: `HTTP ${formatHttpStatus(response)}: ${body.slice(0, 500)}`,
      rawResponse: body,
    });
  }

  return { context, statusCode, body };
}

function isTestSourceResult(
  value: CustomProviderFetchedBody | TestSourceResult,
): value is TestSourceResult {
  return "success" in value;
}

function testJsonSource(
  payload: TestSourceRequest,
  context: TemplateContext,
  now: Date,
  statusCode: number,
  body: string,
): TestSourceResult {
  const expandPath = (path: string): string => expandTemplate(path, context, now);
  const pricePath = expandPath(payload.pricePath);
  const price = extractJsonValue(body, pricePath);
  if (price === null) {
    return testSourceResult({
      success: false,
      statusCode,
      error: `Could not extract price using path '${pricePath}'`,
      rawResponse: body,
    });
  }

  return testSourceResult({
    success: true,
    statusCode,
    price: applyTestFactorInvert(price, payload),
    open: extractOptionalJsonNumber(body, payload.openPath, expandPath, payload),
    high: extractOptionalJsonNumber(body, payload.highPath, expandPath, payload),
    low: extractOptionalJsonNumber(body, payload.lowPath, expandPath, payload),
    volume: payload.volumePath ? extractJsonValue(body, expandPath(payload.volumePath)) : null,
    currency: payload.currencyPath
      ? extractJsonString(body, expandPath(payload.currencyPath))
      : null,
    date: payload.datePath ? extractJsonString(body, expandPath(payload.datePath)) : null,
    rawResponse: body,
  });
}

function testHtmlSource(
  payload: TestSourceRequest,
  statusCode: number,
  body: string,
): TestSourceResult {
  const detectedElements = detectHtmlElements(body, payload.locale ?? undefined);
  const price = extractHtmlValue(body, payload.pricePath, payload.locale ?? undefined);
  if (price === null) {
    return testSourceResult({
      success: false,
      statusCode,
      error: `Could not extract price using CSS selector '${payload.pricePath}'`,
      detectedElements,
    });
  }

  return testSourceResult({
    success: true,
    statusCode,
    price: applyTestFactorInvert(price, payload),
    high: extractOptionalHtmlNumber(body, payload.highPath, payload),
    low: extractOptionalHtmlNumber(body, payload.lowPath, payload),
    volume: payload.volumePath
      ? extractHtmlValue(body, payload.volumePath, payload.locale ?? undefined)
      : null,
    detectedElements,
  });
}

function testHtmlTableSource(
  payload: TestSourceRequest,
  statusCode: number,
  body: string,
): TestSourceResult {
  const detectedTables = detectHtmlTables(body);
  const price = payload.pricePath
    ? extractTableValue(body, payload.pricePath, payload.locale ?? undefined)
    : null;
  if (price === null) {
    return testSourceResult({
      success: detectedTables.length > 0,
      statusCode,
      error: detectedTables.length === 0 ? "No HTML tables found on page" : null,
      detectedTables,
    });
  }

  return testSourceResult({
    success: true,
    statusCode,
    price: applyTestFactorInvert(price, payload),
    open: extractOptionalTableNumber(body, payload.openPath, payload),
    high: extractOptionalTableNumber(body, payload.highPath, payload),
    low: extractOptionalTableNumber(body, payload.lowPath, payload),
    volume: payload.volumePath
      ? extractTableValue(body, payload.volumePath, payload.locale ?? undefined)
      : null,
    date: payload.datePath ? extractTableString(body, payload.datePath) : null,
    detectedTables,
  });
}

function testCsvSource(
  payload: TestSourceRequest,
  statusCode: number,
  body: string,
): TestSourceResult {
  const price = parseCsvTest(body, payload.pricePath, payload.locale ?? undefined);
  if (price === null) {
    return testSourceResult({
      success: false,
      statusCode,
      error: `Could not extract price from CSV using column '${payload.pricePath}'`,
      rawResponse: body,
    });
  }

  return testSourceResult({
    success: true,
    statusCode,
    price: applyTestFactorInvert(price, payload),
    open: extractOptionalCsvNumber(body, payload.openPath, payload),
    high: extractOptionalCsvNumber(body, payload.highPath, payload),
    low: extractOptionalCsvNumber(body, payload.lowPath, payload),
    volume: payload.volumePath
      ? parseCsvTest(body, payload.volumePath, payload.locale ?? undefined)
      : null,
    date: payload.datePath ? extractCsvString(body, payload.datePath) : null,
    rawResponse: body,
  });
}

function extractJsonRows(
  payload: TestSourceRequest,
  context: TemplateContext,
  now: Date,
  body: string,
): CustomProviderQuoteRow[] {
  const expandPath = (path: string): string => expandTemplate(path, context, now);
  const prices = extractJsonMatches(body, expandPath(payload.pricePath)).slice(0, 10_000);
  const dates = payload.datePath
    ? extractJsonMatches(body, expandPath(payload.datePath)).map(jsonValueToString)
    : [];
  const opens = extractJsonNumberArray(body, payload.openPath, expandPath, payload);
  const highs = extractJsonNumberArray(body, payload.highPath, expandPath, payload);
  const lows = extractJsonNumberArray(body, payload.lowPath, expandPath, payload);
  const volumes = extractJsonNumberArray(body, payload.volumePath, expandPath);
  const rows: CustomProviderQuoteRow[] = [];
  for (const [index, priceValue] of prices.entries()) {
    const price = jsonValueToNumber(priceValue, payload.locale ?? undefined);
    if (price === null) {
      continue;
    }
    rows.push({
      price: applyTestFactorInvert(price, payload),
      open: opens[index] ?? null,
      high: highs[index] ?? null,
      low: lows[index] ?? null,
      volume: volumes[index] ?? null,
      date: dates[index] ?? null,
    });
  }
  return rows;
}

function resolveJsonCurrency(
  payload: TestSourceRequest,
  context: TemplateContext,
  body: string,
  now: Date,
): string | null {
  if (!payload.currencyPath) {
    return payload.currency ?? null;
  }
  return (
    extractJsonString(body, expandTemplate(payload.currencyPath, context, now)) ??
    payload.currency ??
    null
  );
}

function extractJsonNumberArray(
  body: string,
  path: string | null | undefined,
  expandPath: (path: string) => string,
  payload?: TestSourceRequest,
): Array<number | null> {
  if (!path) {
    return [];
  }
  return extractJsonMatches(body, expandPath(path)).map((value) => {
    const parsed = jsonValueToNumber(value, payload?.locale ?? undefined);
    if (parsed === null) {
      return null;
    }
    return payload ? applyTestFactorInvert(parsed, payload) : parsed;
  });
}

function extractJsonMatches(body: string, path: string): unknown[] {
  let json: JsonPathInput;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!isJsonPathInput(parsed)) {
      return [];
    }
    json = parsed;
  } catch {
    return [];
  }
  try {
    const result = JSONPath({ path, json, wrap: true }) as unknown as unknown[];
    return result.length === 1 && Array.isArray(result[0]) ? result[0] : result;
  } catch {
    return [];
  }
}

function jsonValueToNumber(value: unknown, locale: string | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    return parseNumberString(value, locale);
  }
  return null;
}

function jsonValueToString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}

function extractCsvRows(body: string, payload: TestSourceRequest): CustomProviderQuoteRow[] {
  const records = parseCsvRecords(body);
  const [headers, ...dataRows] = records;
  if (!headers || dataRows.length === 0) {
    return [];
  }
  const closeColumn = resolveCsvColumn(headers, payload.pricePath);
  if (closeColumn === null) {
    return [];
  }
  const dateColumn = payload.datePath ? resolveCsvColumn(headers, payload.datePath) : null;
  const openColumn = payload.openPath ? resolveCsvColumn(headers, payload.openPath) : null;
  const highColumn = payload.highPath ? resolveCsvColumn(headers, payload.highPath) : null;
  const lowColumn = payload.lowPath ? resolveCsvColumn(headers, payload.lowPath) : null;
  const volumeColumn = payload.volumePath ? resolveCsvColumn(headers, payload.volumePath) : null;
  return dataRows.flatMap((row) => {
    const price = parseOptionalRowNumber(row, closeColumn, payload.locale ?? undefined);
    if (price === null) {
      return [];
    }
    return [
      {
        price: applyTestFactorInvert(price, payload),
        open: parseOptionalRowNumber(row, openColumn, payload.locale ?? undefined, payload),
        high: parseOptionalRowNumber(row, highColumn, payload.locale ?? undefined, payload),
        low: parseOptionalRowNumber(row, lowColumn, payload.locale ?? undefined, payload),
        volume: parseOptionalRowNumber(row, volumeColumn, payload.locale ?? undefined),
        date: dateColumn === null ? null : row[dateColumn]?.trim() || null,
      },
    ];
  });
}

function extractHtmlTableRows(body: string, payload: TestSourceRequest): CustomProviderQuoteRow[] {
  const pricePath = parseTablePath(payload.pricePath);
  if (!pricePath) {
    return [];
  }
  const [tableIndex, closeColumn] = pricePath;
  const rows = extractTableDataRows(body, tableIndex);
  const dateColumn = payload.datePath ? (parseTablePath(payload.datePath)?.[1] ?? null) : null;
  const openColumn = payload.openPath ? (parseTablePath(payload.openPath)?.[1] ?? null) : null;
  const highColumn = payload.highPath ? (parseTablePath(payload.highPath)?.[1] ?? null) : null;
  const lowColumn = payload.lowPath ? (parseTablePath(payload.lowPath)?.[1] ?? null) : null;
  const volumeColumn = payload.volumePath
    ? (parseTablePath(payload.volumePath)?.[1] ?? null)
    : null;
  return rows.flatMap((row) => {
    const price = parseOptionalRowNumber(row, closeColumn, payload.locale ?? undefined);
    if (price === null) {
      return [];
    }
    return [
      {
        price: applyTestFactorInvert(price, payload),
        open: parseOptionalRowNumber(row, openColumn, payload.locale ?? undefined, payload),
        high: parseOptionalRowNumber(row, highColumn, payload.locale ?? undefined, payload),
        low: parseOptionalRowNumber(row, lowColumn, payload.locale ?? undefined, payload),
        volume: parseOptionalRowNumber(row, volumeColumn, payload.locale ?? undefined),
        date: dateColumn === null ? null : row[dateColumn]?.trim() || null,
      },
    ];
  });
}

function parseOptionalRowNumber(
  row: string[],
  column: number | null,
  locale: string | undefined,
  payload?: TestSourceRequest,
): number | null {
  if (column === null) {
    return null;
  }
  const value = row[column];
  if (value === undefined) {
    return null;
  }
  const parsed = parseNumberString(value, locale);
  if (parsed === null) {
    return null;
  }
  return payload ? applyTestFactorInvert(parsed, payload) : parsed;
}

function testSourceResult(overrides: Partial<TestSourceResult>): TestSourceResult {
  return {
    success: false,
    statusCode: null,
    price: null,
    open: null,
    high: null,
    low: null,
    volume: null,
    currency: null,
    date: null,
    error: null,
    rawResponse: null,
    detectedElements: null,
    detectedTables: null,
    ...overrides,
  };
}

function defaultPriceResult(
  payload: TestSourceRequest,
  statusCode: number | null = null,
): TestSourceResult | null {
  const price = payload.defaultPrice;
  if (price === null || price === undefined || !Number.isFinite(price)) {
    return null;
  }
  return testSourceResult({
    success: true,
    statusCode,
    price,
    currency: payload.currency ?? "USD",
  });
}

function defaultPriceRows(result: TestSourceResult): CustomProviderQuoteRow[] | null {
  if (!result.success || result.price === null || !Number.isFinite(result.price)) {
    return null;
  }
  return [
    {
      price: result.price,
      open: null,
      high: null,
      low: null,
      volume: null,
      date: null,
    },
  ];
}

interface TemplateContext {
  symbol: string;
  currency: string;
  isin?: string;
  mic?: string;
  from?: string;
  to?: string;
}

type JsonPathInput = null | boolean | number | string | object | unknown[];

function expandTemplate(template: string, context: TemplateContext, now: Date): string {
  const today = formatUtcDate(now, "%Y-%m-%d");
  let output = template
    .replaceAll("{SYMBOL}", context.symbol)
    .replaceAll("{currency}", context.currency.toLowerCase())
    .replaceAll("{CURRENCY}", context.currency.toUpperCase())
    .replaceAll("{TODAY}", today)
    .replaceAll("{FROM}", context.from ?? today)
    .replaceAll("{TO}", context.to ?? today);

  if (output.includes("{ISIN}")) {
    output = output.replaceAll("{ISIN}", context.isin ?? context.symbol);
  }
  if (output.includes("{MIC}")) {
    output = output.replaceAll("{MIC}", context.mic ?? "");
  }
  return output.replace(/\{DATE:([^}]+)\}/g, (_match, format: string) =>
    formatUtcDate(now, format),
  );
}

function formatUtcDate(date: Date, format: string): string {
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const shortMonthNames = monthNames.map((name) => name.slice(0, 3));
  const pad = (value: number, size = 2): string => value.toString().padStart(size, "0");
  const replacements: Record<string, string> = {
    "%Y": date.getUTCFullYear().toString(),
    "%y": pad(date.getUTCFullYear() % 100),
    "%m": pad(date.getUTCMonth() + 1),
    "%d": pad(date.getUTCDate()),
    "%e": date.getUTCDate().toString().padStart(2, " "),
    "%H": pad(date.getUTCHours()),
    "%M": pad(date.getUTCMinutes()),
    "%S": pad(date.getUTCSeconds()),
    "%F": `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
    "%T": `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`,
    "%s": Math.floor(date.getTime() / 1000).toString(),
    "%z": "+0000",
    "%Z": "UTC",
    "%b": shortMonthNames[date.getUTCMonth()] ?? "",
    "%B": monthNames[date.getUTCMonth()] ?? "",
    "%%": "%",
  };
  return format.replace(/%[YymdeHMSFTszZbB%]/g, (token) => replacements[token] ?? token);
}

function validateHttpUrl(raw: string): void {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch (error) {
    throw new Error(
      `Invalid URL '${raw}': ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `Unsupported URL scheme '${parsed.protocol.replace(":", "")}' (only http/https allowed)`,
    );
  }
  if (!parsed.hostname) {
    throw new Error(`URL '${raw}' has no host`);
  }
}

async function buildTestSourceHeaders(
  payload: TestSourceRequest,
  url: string,
  secretService: SecretService | undefined,
): Promise<Headers> {
  const headers = buildBrowserLikeHeaders(payload.format, url);
  const rawHeaders = payload.headers?.trim();
  if (!rawHeaders) {
    return headers;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawHeaders);
  } catch {
    return headers;
  }
  if (!isRecord(parsed)) {
    return headers;
  }

  for (const [name, value] of Object.entries(parsed)) {
    if (typeof value !== "string") {
      continue;
    }
    const resolved = value.startsWith("__SECRET__")
      ? await resolveSecretHeaderValue(value.slice("__SECRET__".length), secretService)
      : value;
    headers.set(name, resolved);
  }
  return headers;
}

function buildBrowserLikeHeaders(format: CustomProviderSourceFormat, url: string): Headers {
  const defaultAccept =
    format === "json"
      ? "application/json, text/plain, */*"
      : format === "csv"
        ? "text/csv, text/plain, */*"
        : "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";
  const headers = new Headers({
    accept: defaultAccept,
    "accept-language": "en-US,en;q=0.9",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "sec-ch-ua": '"Chromium";v="131", "Not_A Brand";v="24"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "upgrade-insecure-requests": "1",
    "user-agent": CUSTOM_PROVIDER_USER_AGENT,
  });
  const parsed = new URL(url);
  headers.set("referer", `${parsed.origin}/`);
  return headers;
}

async function resolveSecretHeaderValue(
  key: string,
  secretService: SecretService | undefined,
): Promise<string> {
  if (!secretService) {
    throw new Error(`Secret '${key}' not found`);
  }
  const secret = await secretService.getSecret(key);
  if (secret === null) {
    throw new Error(`Secret '${key}' not found`);
  }
  return secret;
}

async function fetchWithRedirects(
  initialUrl: string,
  headers: Headers,
  fetchImpl: typeof fetch,
): Promise<Response | Error> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("custom provider test-source timeout"), 15_000);
  try {
    let url = initialUrl;
    for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
      const response = await fetchImpl(url, {
        headers,
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
      });
      if (!isRedirectStatus(response.status)) {
        return response;
      }
      const location = response.headers.get("location");
      if (!location) {
        return response;
      }
      if (redirectCount === 5) {
        return new Error("redirect limit exceeded");
      }
      url = new URL(location, url).toString();
      headers.set("referer", `${new URL(url).origin}/`);
    }
    return new Error("redirect limit exceeded");
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  } finally {
    clearTimeout(timeout);
  }
}

function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

function parseContentLength(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function formatHttpStatus(response: Response): string {
  return response.statusText
    ? `${response.status} ${response.statusText}`
    : response.status.toString();
}

function extractOptionalJsonNumber(
  body: string,
  path: string | null | undefined,
  expandPath: (path: string) => string,
  payload: TestSourceRequest,
): number | null {
  if (!path) {
    return null;
  }
  const value = extractJsonValue(body, expandPath(path));
  return value === null ? null : applyTestFactorInvert(value, payload);
}

function extractJsonValue(body: string, path: string): number | null {
  const first = extractJsonFirstMatch(body, path);
  if (typeof first === "number") {
    return Number.isFinite(first) ? first : null;
  }
  if (typeof first === "string") {
    return parseNumberString(first);
  }
  return null;
}

function extractJsonString(body: string, path: string): string | null {
  const first = extractJsonFirstMatch(body, path);
  if (first === undefined) {
    return null;
  }
  return typeof first === "string" ? first : JSON.stringify(first);
}

function extractJsonFirstMatch(body: string, path: string): unknown {
  let json: JsonPathInput;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!isJsonPathInput(parsed)) {
      return undefined;
    }
    json = parsed;
  } catch {
    return undefined;
  }
  try {
    const result = JSONPath({ path, json, wrap: true }) as unknown as unknown[];
    return result[0];
  } catch {
    return undefined;
  }
}

function extractOptionalHtmlNumber(
  body: string,
  selector: string | null | undefined,
  payload: TestSourceRequest,
): number | null {
  if (!selector) {
    return null;
  }
  const value = extractHtmlValue(body, selector, payload.locale ?? undefined);
  return value === null ? null : applyTestFactorInvert(value, payload);
}

function extractHtmlValue(
  body: string,
  selector: string,
  locale: string | undefined,
): number | null {
  const $ = load(body);
  const element = $(selector).first();
  if (element.length === 0) {
    return null;
  }
  return parseNumberString(element.text().trim(), locale);
}

function detectHtmlElements(body: string, locale: string | undefined): DetectedHtmlElement[] {
  const $ = load(body);
  const results: DetectedHtmlElement[] = [];
  const seenSelectors = new Set<string>();
  const skipTags = new Set(["script", "style", "meta", "link", "noscript", "head", "title"]);

  for (const node of $("*").toArray()) {
    if (!isElementNode(node)) {
      continue;
    }
    const element = node;
    if (results.length >= 50) {
      break;
    }
    if (skipTags.has(element.name)) {
      continue;
    }
    const text = directText(element).trim();
    if (!text || text.length > 30) {
      continue;
    }
    const value = parseNumberString(text, locale);
    if (value === null) {
      continue;
    }
    const selector = buildCssSelector($, element);
    if (seenSelectors.has(selector)) {
      continue;
    }
    seenSelectors.add(selector);
    results.push({
      selector,
      value,
      text,
      label: findContextLabel($, element),
      htmlContext: extractHtmlContext($, element),
    });
  }
  return results;
}

function buildCssSelector($: CheerioAPI, element: Element): string {
  const tag = element.name;
  const id = $(element).attr("id");
  if (id) {
    return `#${cssEscapeIdent(id)}`;
  }

  const classes = classList($(element).attr("class"))
    .filter((className) => className.length > 1)
    .slice(0, 3);
  const selfPart = classes.length > 0 ? `${tag}.${classes.map(cssEscapeIdent).join(".")}` : tag;
  const parent = element.parent;
  if (isElementNode(parent) && parent.name !== "body" && parent.name !== "html") {
    const parentId = $(parent).attr("id");
    if (parentId) {
      return `#${cssEscapeIdent(parentId)} > ${selfPart}`;
    }
    const parentClasses = classList($(parent).attr("class"))
      .filter((className) => className.length > 1)
      .slice(0, 2);
    if (parentClasses.length > 0) {
      return `${parent.name}.${parentClasses.map(cssEscapeIdent).join(".")} > ${selfPart}`;
    }
    return `${parent.name} > ${selfPart}`;
  }
  return selfPart;
}

function findContextLabel($: CheerioAPI, element: Element): string {
  let previous: AnyNode | null = element.prev ?? null;
  while (previous) {
    if (isElementNode(previous)) {
      const text = $(previous).text().trim();
      if (isShortNonNumericLabel(text)) {
        return text;
      }
      break;
    }
    if (isTextNode(previous)) {
      const text = previous.data.trim();
      if (isShortNonNumericLabel(text)) {
        return text;
      }
    }
    previous = previous.prev ?? null;
  }

  const tableCell =
    element.name === "td"
      ? element
      : isElementNode(element.parent) && element.parent.name === "td"
        ? element.parent
        : null;
  if (tableCell) {
    let current: AnyNode | null = tableCell.parent ?? null;
    while (current) {
      if (isElementNode(current) && current.name === "tr") {
        const firstCell = $(current).find("th, td").first().get(0);
        if (isElementNode(firstCell) && firstCell !== tableCell) {
          const text = $(firstCell).text().trim();
          if (text && text.length < 40) {
            return text;
          }
        }
        break;
      }
      current = isElementNode(current) ? (current.parent ?? null) : null;
    }
  }

  if (isElementNode(element.parent)) {
    for (const child of element.parent.children) {
      if (child === element) {
        continue;
      }
      if (isElementNode(child)) {
        const text = $(child).text().trim();
        if (isShortNonNumericLabel(text)) {
          return text;
        }
      }
      break;
    }
  }
  return "";
}

function extractHtmlContext($: CheerioAPI, element: Element): string {
  const skip = (name: string): boolean => name === "body" || name === "html";
  const parent = element.parent;
  if (isElementNode(parent) && !skip(parent.name)) {
    const grandparent = parent.parent;
    if (isElementNode(grandparent) && !skip(grandparent.name)) {
      return truncateUtf8($.html(grandparent), 500);
    }
    return truncateUtf8($.html(parent), 500);
  }
  return truncateUtf8($.html(element), 500);
}

function extractOptionalTableNumber(
  body: string,
  path: string | null | undefined,
  payload: TestSourceRequest,
): number | null {
  if (!path) {
    return null;
  }
  const value = extractTableValue(body, path, payload.locale ?? undefined);
  return value === null ? null : applyTestFactorInvert(value, payload);
}

function detectHtmlTables(body: string): DetectedHtmlTable[] {
  const $ = load(body);
  const tables: DetectedHtmlTable[] = [];
  $("table")
    .slice(0, 10)
    .each((tableIndex, tableElement) => {
      let headers = $(tableElement)
        .find("thead th")
        .toArray()
        .map((cell) => extractCellText($, cell));
      const rows: string[][] = [];
      let bodyStart = 0;
      const trElements = $(tableElement).find("tr").toArray();

      trElements.forEach((rowElement, rowIndex) => {
        const cells = $(rowElement)
          .find("td")
          .toArray()
          .map((cell) => extractCellText($, cell));
        if (cells.length === 0) {
          if (headers.length === 0) {
            headers = $(rowElement)
              .find("th")
              .toArray()
              .map((cell) => extractCellText($, cell));
          }
          return;
        }
        if (headers.length === 0 && rowIndex === 0) {
          headers = cells;
          bodyStart = 1;
          return;
        }
        if (rows.length < 5) {
          rows.push(cells);
        }
      });

      if (headers.length < 2 && rows.length === 0) {
        return;
      }

      const rowCount = Math.max(Math.max(0, trElements.length - (bodyStart + 1)), rows.length);
      tables.push({
        index: tableIndex,
        columns: headers.map((header, index) => ({
          index,
          header,
          role: detectColumnRole(header),
        })),
        rowCount,
        sampleRows: rows,
      });
    });
  return tables;
}

function extractTableValue(body: string, path: string, locale: string | undefined): number | null {
  const cell = extractTableCell(body, path);
  return cell === null ? null : parseNumberString(cell, locale);
}

function extractTableString(body: string, path: string): string | null {
  const cell = extractTableCell(body, path)?.trim();
  return cell ? cell : null;
}

function extractTableCell(body: string, path: string): string | null {
  const parsedPath = parseTablePath(path);
  if (!parsedPath) {
    return null;
  }
  const [tableIndex, columnIndex] = parsedPath;
  const rows = extractTableDataRows(body, tableIndex);
  return rows[0]?.[columnIndex] ?? null;
}

function extractTableDataRows(body: string, tableIndex: number): string[][] {
  const $ = load(body);
  const table = $("table").eq(tableIndex);
  if (table.length === 0) {
    return [];
  }

  let headersSeen = table.find("thead th").length > 0;
  const rows: string[][] = [];
  table.find("tr").each((rowIndex, rowElement) => {
    const cells = $(rowElement)
      .find("td")
      .toArray()
      .map((cell) => extractCellText($, cell));
    if (cells.length === 0) {
      if (!headersSeen && $(rowElement).find("th").length > 0) {
        headersSeen = true;
      }
      return;
    }
    if (!headersSeen && rowIndex === 0) {
      headersSeen = true;
      return;
    }
    rows.push(cells);
  });
  return rows;
}

function parseTablePath(path: string): [number, number] | null {
  const parts = path.split(":");
  if (parts.length !== 2) {
    return null;
  }
  const tableIndex = Number(parts[0]);
  const columnIndex = Number(parts[1]);
  if (
    !Number.isInteger(tableIndex) ||
    !Number.isInteger(columnIndex) ||
    tableIndex < 0 ||
    columnIndex < 0
  ) {
    return null;
  }
  return [tableIndex, columnIndex];
}

function extractCellText($: CheerioAPI, element: Element): string {
  for (const child of element.children) {
    if (isElementNode(child)) {
      const text = $(child).text().trim();
      if (text) {
        return text;
      }
    }
  }
  return $(element).text().trim();
}

function detectColumnRole(header: string): string | null {
  const lower = header.toLowerCase();
  if (["date", "datum", "fecha", "data", "tag"].some((keyword) => lower.includes(keyword))) {
    return "date";
  }
  if (
    ["close", "price", "last", "schluss", "clôture", "chiusura", "kurs", "precio"].some((keyword) =>
      lower.includes(keyword),
    )
  ) {
    return "close";
  }
  if (["high", "hoch", "max", "alto", "máximo"].some((keyword) => lower.includes(keyword))) {
    return "high";
  }
  if (
    ["low", "tief", "min", "bajo", "basso", "mínimo"].some((keyword) => lower.includes(keyword))
  ) {
    return "low";
  }
  if (["volume", "vol", "volumen"].some((keyword) => lower.includes(keyword))) {
    return "volume";
  }
  if (["open", "apertura", "ouverture", "eröffnung"].some((keyword) => lower.includes(keyword))) {
    return "open";
  }
  return null;
}

function extractOptionalCsvNumber(
  body: string,
  column: string | null | undefined,
  payload: TestSourceRequest,
): number | null {
  if (!column) {
    return null;
  }
  const value = parseCsvTest(body, column, payload.locale ?? undefined);
  return value === null ? null : applyTestFactorInvert(value, payload);
}

function parseCsvTest(
  body: string,
  priceColumn: string,
  locale: string | undefined,
): number | null {
  const records = parseCsvRecords(body);
  if (records.length === 0) {
    return null;
  }
  const [headers, ...dataRows] = records;
  const lastRow = dataRows.at(-1);
  if (!headers || !lastRow) {
    return null;
  }
  const columnIndex = resolveCsvColumn(headers, priceColumn);
  const value = columnIndex === null ? undefined : lastRow[columnIndex];
  return value === undefined ? null : parseNumberString(value, locale);
}

function extractCsvString(body: string, column: string): string | null {
  const records = parseCsvRecords(body);
  if (records.length === 0) {
    return null;
  }
  const [headers, ...dataRows] = records;
  const lastRow = dataRows.at(-1);
  if (!headers || !lastRow) {
    return null;
  }
  const columnIndex = resolveCsvColumn(headers, column);
  const value = columnIndex === null ? undefined : lastRow[columnIndex]?.trim();
  return value ? value : null;
}

function resolveCsvColumn(headers: string[], column: string): number | null {
  if (/^\d+$/.test(column)) {
    const index = Number(column);
    return index < headers.length ? index : null;
  }
  const lower = column.toLowerCase();
  const index = headers.findIndex((header) => header.trim().toLowerCase() === lower);
  return index >= 0 ? index : null;
}

function parseNumberString(raw: string, locale?: string): number | null {
  const cleaned = raw.trim();
  if (!cleaned) {
    return null;
  }
  const stripped = [...cleaned]
    .filter(
      (char) =>
        !["$", "€", "£", "¥", "₹", "₽", "₿", "%", "+", "\u00a0"].includes(char) &&
        !/\s/u.test(char),
    )
    .join("");
  if (!stripped || !/^[\d-]/.test(stripped)) {
    return null;
  }

  const normalized = normalizeNumericString(stripped, locale);
  const numeric = [...normalized].filter((char) => /[\d.-]/.test(char)).join("");
  const parsed = Number(numeric);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeNumericString(stripped: string, locale?: string): string {
  if (
    locale?.startsWith("de") ||
    locale?.startsWith("fr") ||
    locale?.startsWith("es") ||
    locale?.startsWith("it")
  ) {
    return stripped.replaceAll(".", "").replaceAll(",", ".");
  }
  if (
    locale?.startsWith("en") ||
    locale?.startsWith("ja") ||
    locale?.startsWith("ko") ||
    locale?.startsWith("zh") ||
    locale === "C"
  ) {
    return stripped.replaceAll(",", "");
  }

  const lastComma = stripped.lastIndexOf(",");
  const hasEuropeanComma =
    lastComma >= 0 &&
    [...stripped.slice(lastComma + 1)].every((char) => /\d/.test(char)) &&
    [1, 2].includes(stripped.length - lastComma - 1);
  const decimalCommaDigits = lastComma >= 0 ? stripped.length - lastComma - 1 : 0;
  const hasLongDecimalComma =
    lastComma >= 0 &&
    decimalCommaDigits >= 4 &&
    decimalCommaDigits <= 8 &&
    [...stripped.slice(lastComma + 1)].every((char) => /\d/.test(char));
  const lastDot = stripped.lastIndexOf(".");
  const hasTrailingDot =
    lastDot >= 0 &&
    stripped.length - lastDot - 1 >= 1 &&
    stripped.length - lastDot - 1 <= 8 &&
    [...stripped.slice(lastDot + 1)].every((char) => /\d/.test(char));

  if ((hasEuropeanComma || hasLongDecimalComma) && !hasTrailingDot) {
    return stripped.replaceAll(".", "").replaceAll(",", ".");
  }
  if (stripped.includes(",") && !stripped.includes(".")) {
    const digitsAfterLastComma = stripped.length - lastComma - 1;
    if (
      digitsAfterLastComma === 3 &&
      [...stripped.slice(lastComma + 1)].every((char) => /\d/.test(char))
    ) {
      return stripped.replaceAll(",", "");
    }
    return stripped.replaceAll(",", ".");
  }
  return stripped.replaceAll(",", "");
}

function applyTestFactorInvert(value: number, payload: TestSourceRequest): number {
  let result = value;
  if (payload.factor !== null && payload.factor !== undefined) {
    result *= payload.factor;
  }
  if (payload.invert === true && result !== 0) {
    result = 1 / result;
  }
  return result;
}

function isShortNonNumericLabel(text: string): boolean {
  return Boolean(text) && text.length < 40 && !/^\d/.test(text);
}

function classList(value: string | undefined): string[] {
  return value?.split(/\s+/).filter(Boolean) ?? [];
}

function cssEscapeIdent(value: string): string {
  let result = "";
  let index = 0;
  for (const char of value) {
    const isAsciiAlphanumeric = /^[a-zA-Z0-9]$/.test(char);
    if (isAsciiAlphanumeric || char === "-" || char === "_") {
      if (index === 0 && /^\d$/.test(char)) {
        result += "\\";
      }
      result += char;
    } else if (/^[\x00-\x7F]$/.test(char)) {
      result += `\\${char}`;
    } else {
      result += `\\${char.codePointAt(0)?.toString(16) ?? ""} `;
    }
    index += 1;
  }
  return result;
}

function truncateUtf8(value: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(value).byteLength <= maxBytes) {
    return value;
  }
  let output = "";
  let bytes = 0;
  for (const char of value) {
    const byteLength = encoder.encode(char).byteLength;
    if (bytes + byteLength > maxBytes) {
      break;
    }
    output += char;
    bytes += byteLength;
  }
  return `${output}...`;
}

function directText(element: Element): string {
  return element.children
    .filter(isTextNode)
    .map((child) => child.data)
    .join("");
}

function isElementNode(node: AnyNode | null | undefined): node is Element {
  return node?.type === "tag" || node?.type === "script" || node?.type === "style";
}

function isTextNode(node: AnyNode | null | undefined): node is Extract<AnyNode, { type: "text" }> {
  return node?.type === "text";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonPathInput(value: unknown): value is JsonPathInput {
  return (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string" ||
    typeof value === "object"
  );
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
