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
      repository.updateProvider({ providerId, priority, enabled });
      await options.refreshClient?.();
    },
  };
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
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

function parseTimestampOrNow(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? new Date().toISOString() : parsed.toISOString();
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
        instruments: "Stocks • Crypto • Forex",
        coverage: "Global",
        features: ["Real-time", "Historical", "Search", "Profiles"],
      };
    case "METAL_PRICE_API":
      return {
        instruments: "Metals",
        coverage: "USD only",
        features: ["Real-time"],
      };
    case "FINNHUB":
      return {
        instruments: "Stocks",
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
