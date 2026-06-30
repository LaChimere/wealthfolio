import type { Database } from "bun:sqlite";

export interface ProviderCapabilities {
  instruments: string;
  coverage: string;
  features: string[];
}

export interface MarketDataProviderSetting {
  id: string;
  name: string;
  description: string;
  url: string | null;
  priority: number;
  enabled: boolean;
  logoFilename: string | null;
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  capabilities: ProviderCapabilities | null;
  providerType: string | null;
}

export interface ProviderInfo {
  id: string;
  name: string;
  description: string | null;
  url: string | null;
  enabled: boolean;
  priority: number;
  logoFilename: string | null;
  capabilities: ProviderCapabilities | null;
  requiresApiKey: boolean;
  hasApiKey: boolean;
  assetCount: number;
  errorCount: number;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  uniqueErrors: string[];
  providerType: string | null;
}

export interface ProviderUpdate {
  providerId: string;
  priority: number;
  enabled: boolean;
}

export interface ProviderSyncStats {
  providerId: string;
  assetCount: number;
  lastSyncedAt: string | null;
}

export interface ProviderSyncError {
  dataSource: string;
  lastError: string | null;
  updatedAt: string;
}

export interface MarketDataProviderRepository {
  getAllProviders(): MarketDataProviderSetting[];
  updateProvider(update: ProviderUpdate): MarketDataProviderSetting;
  getProviderSyncStats(): ProviderSyncStats[];
  getSyncStatesWithErrors(): ProviderSyncError[];
}

export interface MarketDataProviderService {
  getProvidersInfo(): Promise<ProviderInfo[]>;
  updateProviderSettings(providerId: string, priority: number, enabled: boolean): Promise<void>;
}

export interface MarketDataProviderServiceOptions {
  readSecret?: (providerId: string) => Promise<string | null> | string | null;
  refreshClient?: () => Promise<void> | void;
}

interface ProviderRow {
  id: string;
  name: string;
  description: string;
  url: string | null;
  priority: number;
  enabled: number;
  logo_filename: string | null;
  last_synced_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  provider_type: string | null;
}

interface ProviderSyncStatsRow {
  provider_id: string;
  asset_count: number;
  last_synced_at: string | null;
}

interface ProviderSyncErrorRow {
  data_source: string;
  last_error: string | null;
  updated_at: string;
}

const API_KEY_PROVIDER_IDS = new Set([
  "ALPHA_VANTAGE",
  "MARKETDATA_APP",
  "METAL_PRICE_API",
  "FINNHUB",
]);

const MARKET_DATA_PROVIDER_IDS = [
  "YAHOO",
  "ALPHA_VANTAGE",
  "MARKETDATA_APP",
  "METAL_PRICE_API",
  "FINNHUB",
  "OPENFIGI",
  "US_TREASURY_CALC",
  "BOERSE_FRANKFURT",
  "CUSTOM_SCRAPER",
] as const;

export function createMarketDataProviderRepository(db: Database): MarketDataProviderRepository {
  return {
    getAllProviders() {
      return db
        .query<ProviderRow, []>(
          `
            SELECT
              id,
              name,
              description,
              url,
              priority,
              enabled,
              logo_filename,
              last_synced_at,
              last_sync_status,
              last_sync_error,
              provider_type
            FROM market_data_providers
            ORDER BY priority DESC
          `,
        )
        .all()
        .map(providerFromRow);
    },
    updateProvider(update) {
      db.prepare(
        `
          UPDATE market_data_providers
          SET priority = ?, enabled = ?
          WHERE id = ?
        `,
      ).run(update.priority, update.enabled ? 1 : 0, update.providerId);
      const row = db
        .query<ProviderRow, [string]>(
          `
            SELECT
              id,
              name,
              description,
              url,
              priority,
              enabled,
              logo_filename,
              last_synced_at,
              last_sync_status,
              last_sync_error,
              provider_type
            FROM market_data_providers
            WHERE id = ?
          `,
        )
        .get(update.providerId);
      if (!row) {
        throw new Error(`Market data provider not found: ${update.providerId}`);
      }
      return providerFromRow(row);
    },
    getProviderSyncStats() {
      return db
        .query<ProviderSyncStatsRow, []>(
          `
            SELECT
              data_source AS provider_id,
              COUNT(*) AS asset_count,
              MAX(last_synced_at) AS last_synced_at
            FROM quote_sync_state
            GROUP BY data_source
            ORDER BY data_source
          `,
        )
        .all()
        .map((row) => ({
          providerId: row.provider_id,
          assetCount: row.asset_count,
          lastSyncedAt: parseTimestampOrNull(row.last_synced_at),
        }));
    },
    getSyncStatesWithErrors() {
      return db
        .query<ProviderSyncErrorRow, []>(
          `
            SELECT data_source, last_error, updated_at
            FROM quote_sync_state
            WHERE error_count > 0
            ORDER BY error_count DESC
          `,
        )
        .all()
        .map((row) => ({
          dataSource: row.data_source,
          lastError: row.last_error,
          updatedAt: parseTimestampOrNow(row.updated_at),
        }));
    },
  };
}

export function createMarketDataProviderService(
  repository: MarketDataProviderRepository,
  options: MarketDataProviderServiceOptions = {},
): MarketDataProviderService {
  return {
    async getProvidersInfo() {
      const syncStats = new Map(
        repository.getProviderSyncStats().map((stats) => [stats.providerId, stats]),
      );
      const errorStats = buildProviderErrorStats(repository.getSyncStatesWithErrors());
      const providers: ProviderInfo[] = [];

      for (const provider of repository.getAllProviders()) {
        const requiresApiKey = API_KEY_PROVIDER_IDS.has(provider.id);
        const hasApiKey =
          requiresApiKey && provider.enabled
            ? await providerHasSecret(provider.id, options.readSecret)
            : !requiresApiKey;
        const stats = syncStats.get(provider.id);
        const errors = errorStats.get(provider.id);
        providers.push({
          id: provider.id,
          name: provider.name,
          description: provider.description,
          url: provider.url,
          enabled: provider.enabled,
          priority: provider.priority,
          logoFilename: provider.logoFilename,
          capabilities: provider.capabilities,
          requiresApiKey,
          hasApiKey,
          assetCount: stats?.assetCount ?? 0,
          errorCount: errors?.errorCount ?? 0,
          lastSyncedAt: stats?.lastSyncedAt ?? null,
          lastSyncError: errors?.lastSyncError ?? null,
          uniqueErrors: Array.from(errors?.uniqueErrors ?? []).sort(),
          providerType: provider.providerType,
        });
      }

      return providers.sort((a, b) => a.priority - b.priority);
    },
    async updateProviderSettings(providerId, priority, enabled) {
      validateI32Priority(priority);
      repository.updateProvider({ providerId, priority, enabled });
      await options.refreshClient?.();
    },
  };
}

function validateI32Priority(priority: number): void {
  if (!Number.isInteger(priority) || priority < -2_147_483_648 || priority > 2_147_483_647) {
    throw new Error(
      "Invalid input: Priority must be an integer between -2147483648 and 2147483647",
    );
  }
}

function providerFromRow(row: ProviderRow): MarketDataProviderSetting {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    url: row.url,
    priority: row.priority,
    enabled: Boolean(row.enabled),
    logoFilename: row.logo_filename,
    lastSyncedAt: row.last_synced_at,
    lastSyncStatus: row.last_sync_status,
    lastSyncError: row.last_sync_error,
    capabilities: capabilitiesForProvider(row.id),
    providerType: row.provider_type,
  };
}

async function providerHasSecret(
  providerId: string,
  readSecret: MarketDataProviderServiceOptions["readSecret"],
): Promise<boolean> {
  if (!readSecret) {
    return false;
  }
  const secret = await readSecret(providerId);
  return typeof secret === "string" && secret.length > 0;
}

interface ProviderErrorStats {
  errorCount: number;
  lastSyncError: string | null;
  lastErrorAtMillis: number | null;
  uniqueErrors: Set<string>;
}

function buildProviderErrorStats(syncErrors: ProviderSyncError[]): Map<string, ProviderErrorStats> {
  const stats = new Map<string, ProviderErrorStats>();
  for (const state of syncErrors) {
    if (!state.lastError) {
      continue;
    }
    const providerId = extractProviderIdFromSyncError(state.lastError) ?? state.dataSource;
    if (!providerId) {
      continue;
    }
    const entry =
      stats.get(providerId) ??
      ({
        errorCount: 0,
        lastSyncError: null,
        lastErrorAtMillis: null,
        uniqueErrors: new Set<string>(),
      } satisfies ProviderErrorStats);
    entry.errorCount += 1;
    entry.uniqueErrors.add(state.lastError);
    const updatedAtMillis = new Date(state.updatedAt).valueOf();
    if (entry.lastErrorAtMillis === null || updatedAtMillis > entry.lastErrorAtMillis) {
      entry.lastErrorAtMillis = updatedAtMillis;
      entry.lastSyncError = state.lastError;
    }
    stats.set(providerId, entry);
  }
  return stats;
}

function extractProviderIdFromSyncError(error: string): string | null {
  return MARKET_DATA_PROVIDER_IDS.find((providerId) => error.includes(providerId)) ?? null;
}

function parseTimestampOrNull(value: string | null): string | null {
  if (!value) {
    return null;
  }
  return normalizeUtcTimestamp(value, true);
}

function parseTimestampOrNow(value: string): string {
  return normalizeUtcTimestamp(value, true) ?? new Date().toISOString();
}

function toRustUtcRfc3339(date: Date): string {
  const iso = date.toISOString();
  if (iso.endsWith(".000Z")) {
    return `${iso.slice(0, -5)}+00:00`;
  }
  return iso.replace(/Z$/u, "+00:00");
}

function normalizeUtcTimestamp(value: string, allowOffset: boolean): string | null {
  const utcMatch = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|\+00:00)$/u.exec(
    value,
  );
  if (utcMatch) {
    if (parseRustRfc3339Timestamp(value) === null) {
      return null;
    }
    const parsed = new Date(`${utcMatch[1]}.${(utcMatch[2] ?? "0").slice(0, 3).padEnd(3, "0")}Z`);
    if (Number.isNaN(parsed.valueOf())) {
      return null;
    }
    const fractional = normalizeRustFraction(utcMatch[2]);
    return `${utcMatch[1]}${fractional}+00:00`;
  }

  if (!allowOffset) {
    return null;
  }
  return normalizeOffsetTimestamp(value);
}

function normalizeOffsetTimestamp(value: string): string | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?([+-])(\d{2}):(\d{2})$/u.exec(
      value,
    );
  if (!match) {
    const parsed = parseRustRfc3339Timestamp(value);
    return parsed === null ? null : toRustUtcRfc3339(parsed);
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
  const zoneHour = Number(zoneHourRaw);
  const zoneMinute = Number(zoneMinuteRaw);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    zoneHour > 23 ||
    zoneMinute > 59
  ) {
    return null;
  }
  const local = new Date(Date.UTC(2000, 0, 1, hour, minute, second, 0));
  local.setUTCFullYear(year, month - 1, day);
  if (
    Number.isNaN(local.valueOf()) ||
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() !== month - 1 ||
    local.getUTCDate() !== day
  ) {
    return null;
  }
  const offsetMinutes = Number(`${signRaw}1`) * (zoneHour * 60 + zoneMinute);
  const parsed = new Date(local.getTime() - offsetMinutes * 60_000);
  if (Number.isNaN(parsed.valueOf())) {
    return null;
  }
  const base = parsed.toISOString().slice(0, 19);
  return `${base}${normalizeRustFraction(fractionRaw)}+00:00`;
}

function parseRustRfc3339Timestamp(value: string): Date | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/u.exec(
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
    second > 59 ||
    zoneHour > 23 ||
    zoneMinute > 59
  ) {
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
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function normalizeRustFraction(value: string | undefined): string {
  if (value === undefined || /^0+$/u.test(value)) {
    return "";
  }
  const nanos = value.padEnd(9, "0");
  if (nanos.endsWith("000000")) {
    return `.${nanos.slice(0, 3)}`;
  }
  if (nanos.endsWith("000")) {
    return `.${nanos.slice(0, 6)}`;
  }
  return `.${nanos}`;
}

function capabilitiesForProvider(providerId: string): ProviderCapabilities | null {
  switch (providerId) {
    case "YAHOO":
      return {
        instruments: "Stocks • Crypto • Forex • Metals",
        coverage: "Global",
        features: ["Real-time", "Historical", "Search", "Profiles"],
      };
    case "MARKETDATA_APP":
      return {
        instruments: "Stocks",
        coverage: "US only",
        features: ["Real-time", "Historical"],
      };
    case "ALPHA_VANTAGE":
      return {
        instruments: "Stocks • Crypto • Forex • Options (real-time only)",
        coverage: "Global",
        features: ["Real-time", "Historical", "Search", "Profiles"],
      };
    case "METAL_PRICE_API":
      return {
        instruments: "Metals",
        coverage: "USD only",
        features: ["Real-time", "Historical"],
      };
    case "FINNHUB":
      return {
        instruments: "Stocks • Crypto • Forex",
        coverage: "Global",
        features: ["Real-time", "Historical", "Search", "Profiles"],
      };
    case "BOERSE_FRANKFURT":
      return {
        instruments: "Stocks • ETFs • Bonds",
        coverage: "XETR • XFRA",
        features: ["Real-time", "Historical", "Profiles"],
      };
    case "OPENFIGI":
      return {
        instruments: "Bonds",
        coverage: "Global",
        features: ["Search", "Profiles"],
      };
    case "US_TREASURY_CALC":
      return {
        instruments: "US Treasuries",
        coverage: "US Treasury",
        features: ["Real-time", "Historical", "No API key"],
      };
    case "CUSTOM_SCRAPER":
      return {
        instruments: "Any",
        coverage: "User-defined",
        features: ["Real-time", "Historical"],
      };
    default:
      return null;
  }
}
