import type { Database } from "bun:sqlite";

import type { AccountService } from "./accounts";
import type { SettingsService } from "./settings";
import type { TaxonomyService } from "./taxonomies";

export interface IssueDismissal {
  issueId: string;
  dismissedAt: string;
  dataHash: string;
}

export interface HealthConfig {
  priceStaleWarningHours: number;
  priceStaleCriticalHours: number;
  fxStaleWarningHours: number;
  fxStaleCriticalHours: number;
  mvEscalationThreshold: number;
  classificationWarnThreshold: number;
}

export interface HealthFixAction {
  id: string;
  label: string;
  payload: unknown;
}

export type HealthSeverity = "INFO" | "WARNING" | "ERROR" | "CRITICAL";

export type HealthCategory =
  | "PRICE_STALENESS"
  | "FX_INTEGRITY"
  | "CLASSIFICATION"
  | "DATA_CONSISTENCY"
  | "ACCOUNT_CONFIGURATION"
  | "SETTINGS_CONFIGURATION";

export interface NavigateAction {
  route: string;
  query?: unknown;
  label: string;
}

export interface AffectedItem {
  id: string;
  name: string;
  symbol?: string;
  route?: string;
}

export interface HealthIssue {
  id: string;
  severity: HealthSeverity;
  category: HealthCategory;
  title: string;
  message: string;
  affectedCount: number;
  affectedMvPct?: number;
  fixAction?: HealthFixAction;
  navigateAction?: NavigateAction;
  details?: string;
  affectedItems?: AffectedItem[];
  dataHash: string;
  timestamp: string;
}

export interface HealthStatus {
  overallSeverity: HealthSeverity;
  issueCounts: Partial<Record<HealthSeverity, number>>;
  issues: HealthIssue[];
  checkedAt: string;
  isStale: boolean;
}

export interface HealthServiceOptions {
  accountProvider?: Pick<AccountService, "getActiveNonArchivedAccounts">;
  classificationMigrationProvider?: Pick<TaxonomyService, "getMigrationStatus">;
  settingsProvider?: Pick<SettingsService, "getSettings">;
  now?: () => Date;
  cacheTtlMs?: number;
}

export interface HealthRepository {
  saveDismissal(issueId: string, dataHash: string): IssueDismissal;
  removeDismissal(issueId: string): void;
  getDismissals(): IssueDismissal[];
  getDismissal(issueId: string): IssueDismissal | null;
}

export interface HealthService {
  dismissIssue(issueId: string, dataHash: string): Promise<void>;
  restoreIssue(issueId: string): Promise<void>;
  getDismissedIds(): Promise<string[]>;
  getConfig(): Promise<HealthConfig>;
  updateConfig(config: HealthConfig): Promise<void>;
  getCachedHealthStatus?(clientTimezone?: string): HealthStatus | null;
  getHealthStatus?(clientTimezone?: string): Promise<HealthStatus> | HealthStatus;
  runHealthChecks?(clientTimezone?: string): Promise<HealthStatus> | HealthStatus;
  executeFix?(action: HealthFixAction): Promise<void> | void;
}

interface DismissalRow {
  issue_id: string;
  dismissed_at: string;
  data_hash: string;
}

export const DEFAULT_HEALTH_CONFIG: HealthConfig = {
  priceStaleWarningHours: 24,
  priceStaleCriticalHours: 72,
  fxStaleWarningHours: 24,
  fxStaleCriticalHours: 72,
  mvEscalationThreshold: 0.3,
  classificationWarnThreshold: 0.05,
};

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const SEVERITY_ORDER: HealthSeverity[] = ["INFO", "WARNING", "ERROR", "CRITICAL"];
const HASH_OFFSET_BASIS = 0xcbf29ce484222325n;
const HASH_PRIME = 0x100000001b3n;
const HASH_MASK = 0xffffffffffffffffn;

export function createHealthRepository(db: Database): HealthRepository {
  return {
    saveDismissal(issueId, dataHash) {
      const dismissal: IssueDismissal = {
        issueId,
        dismissedAt: timestampNow(),
        dataHash,
      };
      db.prepare(
        `
          INSERT INTO health_issue_dismissals (issue_id, dismissed_at, data_hash)
          VALUES (?, ?, ?)
          ON CONFLICT(issue_id) DO UPDATE SET
            dismissed_at = excluded.dismissed_at,
            data_hash = excluded.data_hash
        `,
      ).run(dismissal.issueId, dismissal.dismissedAt, dismissal.dataHash);
      return dismissal;
    },
    removeDismissal(issueId) {
      db.prepare("DELETE FROM health_issue_dismissals WHERE issue_id = ?").run(issueId);
    },
    getDismissals() {
      return db
        .query<DismissalRow, []>(
          `
            SELECT issue_id, dismissed_at, data_hash
            FROM health_issue_dismissals
          `,
        )
        .all()
        .map(dismissalFromRow);
    },
    getDismissal(issueId) {
      const row = db
        .query<DismissalRow, [string]>(
          `
            SELECT issue_id, dismissed_at, data_hash
            FROM health_issue_dismissals
            WHERE issue_id = ?
          `,
        )
        .get(issueId);
      return row ? dismissalFromRow(row) : null;
    },
  };
}

export function createHealthService(
  repository: HealthRepository,
  initialConfig: HealthConfig = DEFAULT_HEALTH_CONFIG,
  options: HealthServiceOptions = {},
): HealthService {
  let config = { ...initialConfig };
  let cachedStatuses = new Map<string, { status: HealthStatus; cachedAt: Date }>();
  const now = options.now ?? timestampNowDate;
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const clearCache = () => {
    cachedStatuses = new Map();
  };

  return {
    async dismissIssue(issueId, dataHash) {
      repository.saveDismissal(issueId, dataHash);
      clearCache();
    },
    async restoreIssue(issueId) {
      repository.removeDismissal(issueId);
      clearCache();
    },
    async getDismissedIds() {
      return repository.getDismissals().map((dismissal) => dismissal.issueId);
    },
    async getConfig() {
      return { ...config };
    },
    async updateConfig(nextConfig) {
      validateHealthConfig(nextConfig);
      config = { ...nextConfig };
      clearCache();
    },
    getCachedHealthStatus(clientTimezone) {
      const cached = cachedStatuses.get(clientTimezone?.trim() ?? "");
      if (!cached) {
        return null;
      }
      const stale = now().getTime() - cached.cachedAt.getTime() > cacheTtlMs;
      return cloneStatus(cached.status, stale);
    },
    async getHealthStatus(clientTimezone) {
      const cacheKey = clientTimezone?.trim() ?? "";
      const cached = cachedStatuses.get(cacheKey);
      if (cached) {
        const stale = now().getTime() - cached.cachedAt.getTime() > cacheTtlMs;
        return cloneStatus(cached.status, stale);
      }
      return runChecks(repository, options, now, clientTimezone, cachedStatuses);
    },
    async runHealthChecks(clientTimezone) {
      return runChecks(repository, options, now, clientTimezone, cachedStatuses);
    },
  };
}

async function runChecks(
  repository: HealthRepository,
  options: HealthServiceOptions,
  now: () => Date,
  clientTimezone: string | undefined,
  cache: Map<string, { status: HealthStatus; cachedAt: Date }>,
): Promise<HealthStatus> {
  const checkedAt = now();
  const issues = filterDismissedIssues(repository, [
    ...analyzeUnconfiguredAccounts(options, checkedAt),
    ...(await analyzeLegacyClassificationMigration(options, checkedAt)),
    ...analyzeTimezone(options, clientTimezone, checkedAt),
  ]);
  const status = buildStatus(issues, checkedAt);
  cache.set(clientTimezone?.trim() ?? "", { status: cloneStatus(status), cachedAt: checkedAt });
  return status;
}

function analyzeUnconfiguredAccounts(
  options: HealthServiceOptions,
  timestamp: Date,
): HealthIssue[] {
  const accounts = options.accountProvider
    ?.getActiveNonArchivedAccounts()
    .filter((account) => account.trackingMode === "NOT_SET");

  if (!accounts || accounts.length === 0) {
    return [];
  }

  const accountIds = accounts.map((account) => account.id);
  const dataHash = computeDataHash(accountIds);
  const count = accounts.length;
  return [
    {
      id: `unconfigured_accounts:${dataHash}`,
      severity: "WARNING",
      category: "ACCOUNT_CONFIGURATION",
      title: count === 1 ? "1 account needs setup" : `${count} accounts need setup`,
      message:
        count === 1
          ? "Choose a tracking mode to start syncing data."
          : "Choose tracking modes to start syncing data.",
      affectedCount: count,
      navigateAction: { route: "/connect", label: "Configure Accounts" },
      affectedItems: accounts.map((account) => ({
        id: account.id,
        name: account.name,
        route: `/accounts/${encodeURIComponent(account.id)}`,
      })),
      dataHash,
      timestamp: timestamp.toISOString(),
    },
  ];
}

function analyzeTimezone(
  options: HealthServiceOptions,
  clientTimezone: string | undefined,
  timestamp: Date,
): HealthIssue[] {
  if (!options.settingsProvider) {
    return [];
  }

  const configuredTimezone = options.settingsProvider.getSettings().timezone.trim();
  if (!configuredTimezone) {
    const dataHash = computeDataHash(["MISSING"]);
    return [
      {
        id: `timezone_missing:${dataHash}`,
        severity: "WARNING",
        category: "SETTINGS_CONFIGURATION",
        title: "Timezone not configured",
        message: "Set your timezone in General settings to ensure dates match your locale.",
        affectedCount: 1,
        navigateAction: { route: "/settings/general", label: "Open General Settings" },
        dataHash,
        timestamp: timestamp.toISOString(),
      },
    ];
  }

  const configured = normalizeTimezone(configuredTimezone);
  if (!configured) {
    const dataHash = computeDataHash([configuredTimezone]);
    return [
      {
        id: `timezone_invalid:${dataHash}`,
        severity: "ERROR",
        category: "SETTINGS_CONFIGURATION",
        title: "Configured timezone is invalid",
        message: `The configured timezone "${configuredTimezone}" is invalid. Update it in General settings.`,
        affectedCount: 1,
        navigateAction: { route: "/settings/general", label: "Open General Settings" },
        dataHash,
        timestamp: timestamp.toISOString(),
      },
    ];
  }

  const client = clientTimezone?.trim() ? normalizeTimezone(clientTimezone) : null;
  if (!client || areEffectivelySameTimezone(configured, client, timestamp)) {
    return [];
  }

  const dataHash = computeDataHash([configured, client]);
  return [
    {
      id: `timezone_mismatch:${dataHash}`,
      severity: "WARNING",
      category: "SETTINGS_CONFIGURATION",
      title: "Browser and app timezones differ",
      message: `Configured timezone is "${configured}" but browser timezone is "${client}". Dates follow the configured timezone.`,
      affectedCount: 1,
      navigateAction: { route: "/settings/general", label: "Open General Settings" },
      dataHash,
      timestamp: timestamp.toISOString(),
    },
  ];
}

async function analyzeLegacyClassificationMigration(
  options: HealthServiceOptions,
  timestamp: Date,
): Promise<HealthIssue[]> {
  if (!options.classificationMigrationProvider?.getMigrationStatus) {
    return [];
  }

  const status = await options.classificationMigrationProvider.getMigrationStatus();
  if (!status.needed || status.assetsWithLegacyData <= 0) {
    return [];
  }

  const count = status.assetsWithLegacyData;
  const dataHash = computeDataHash([
    "legacy_migration",
    String(status.assetsWithLegacyData),
    String(status.assetsAlreadyMigrated),
  ]);

  return [
    {
      id: `classification:legacy_migration:${dataHash}`,
      severity: "WARNING",
      category: "CLASSIFICATION",
      title:
        count === 1
          ? "1 asset has legacy classification data"
          : `${count} assets have legacy classification data`,
      message:
        "Some assets have sector/country data from the old format. Migrate to the new taxonomy system for better allocation tracking.",
      affectedCount: count,
      fixAction: { id: "migrate_legacy_classifications", label: "Start Migration", payload: null },
      navigateAction: { route: "/settings/taxonomies", label: "View Classifications" },
      dataHash,
      timestamp: timestamp.toISOString(),
    },
  ];
}

function filterDismissedIssues(repository: HealthRepository, issues: HealthIssue[]): HealthIssue[] {
  const dismissals = new Map(
    repository.getDismissals().map((dismissal) => [dismissal.issueId, dismissal]),
  );
  const filtered: HealthIssue[] = [];
  for (const issue of issues) {
    const dismissal = dismissals.get(issue.id);
    if (!dismissal) {
      filtered.push(issue);
      continue;
    }
    if (dismissal.dataHash !== issue.dataHash) {
      repository.removeDismissal(issue.id);
      filtered.push(issue);
    }
  }
  return filtered;
}

function buildStatus(issues: HealthIssue[], checkedAt: Date): HealthStatus {
  const issueCounts: Partial<Record<HealthSeverity, number>> = {};
  let overallSeverity: HealthSeverity = "INFO";

  for (const issue of issues) {
    issueCounts[issue.severity] = (issueCounts[issue.severity] ?? 0) + 1;
    if (severityRank(issue.severity) > severityRank(overallSeverity)) {
      overallSeverity = issue.severity;
    }
  }

  return {
    overallSeverity,
    issueCounts,
    issues,
    checkedAt: checkedAt.toISOString(),
    isStale: false,
  };
}

function cloneStatus(status: HealthStatus, isStale = status.isStale): HealthStatus {
  return {
    ...status,
    issueCounts: { ...status.issueCounts },
    issues: status.issues.map((issue) => ({
      ...issue,
      fixAction: issue.fixAction ? { ...issue.fixAction } : undefined,
      navigateAction: issue.navigateAction ? { ...issue.navigateAction } : undefined,
      affectedItems: issue.affectedItems?.map((item) => ({ ...item })),
    })),
    isStale,
  };
}

function severityRank(severity: HealthSeverity): number {
  return SEVERITY_ORDER.indexOf(severity);
}

function normalizeTimezone(timezone: string | undefined): string | null {
  const trimmed = timezone?.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: trimmed }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

function areEffectivelySameTimezone(
  configuredTimezone: string,
  clientTimezone: string,
  now: Date,
): boolean {
  if (configuredTimezone === clientTimezone) {
    return true;
  }
  const currentYear = now.getUTCFullYear();
  for (const year of [currentYear, currentYear + 1]) {
    for (let month = 0; month < 12; month += 1) {
      const sample = new Date(Date.UTC(year, month, 1, 12, 0, 0));
      if (timezoneOffset(configuredTimezone, sample) !== timezoneOffset(clientTimezone, sample)) {
        return false;
      }
    }
  }
  return true;
}

function timezoneOffset(timezone: string, date: Date): string {
  const timeZoneName = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "longOffset",
  })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value;
  return timeZoneName ?? "";
}

function computeDataHash(values: string[]): string {
  const encoder = new TextEncoder();
  let hash = HASH_OFFSET_BASIS;
  for (const value of [...values].sort()) {
    for (const byte of encoder.encode(`${value}\0`)) {
      hash ^= BigInt(byte);
      hash = (hash * HASH_PRIME) & HASH_MASK;
    }
  }
  return hash.toString(16).padStart(16, "0");
}

function validateHealthConfig(config: HealthConfig): void {
  validateU32(config.priceStaleWarningHours, "price_stale_warning_hours");
  validateU32(config.priceStaleCriticalHours, "price_stale_critical_hours");
  validateU32(config.fxStaleWarningHours, "fx_stale_warning_hours");
  validateU32(config.fxStaleCriticalHours, "fx_stale_critical_hours");
  validateFinite(config.mvEscalationThreshold, "mv_escalation_threshold");
  validateFinite(config.classificationWarnThreshold, "classification_warn_threshold");

  if (config.priceStaleWarningHours === 0) {
    throw new Error("Invalid input: price_stale_warning_hours must be > 0");
  }
  if (config.priceStaleWarningHours >= config.priceStaleCriticalHours) {
    throw new Error(
      "Invalid input: price_stale_warning_hours must be < price_stale_critical_hours",
    );
  }
  if (config.fxStaleWarningHours === 0) {
    throw new Error("Invalid input: fx_stale_warning_hours must be > 0");
  }
  if (config.fxStaleWarningHours >= config.fxStaleCriticalHours) {
    throw new Error("Invalid input: fx_stale_warning_hours must be < fx_stale_critical_hours");
  }
}

function validateU32(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 4_294_967_295) {
    throw new Error(`Invalid input: ${field} must be a u32 integer`);
  }
}

function validateFinite(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid input: ${field} must be finite`);
  }
}

function dismissalFromRow(row: DismissalRow): IssueDismissal {
  return {
    issueId: row.issue_id,
    dismissedAt: parseTimestampOrNow(row.dismissed_at),
    dataHash: row.data_hash,
  };
}

function parseTimestampOrNow(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? timestampNow() : parsed.toISOString();
}

function timestampNow(): string {
  return new Date().toISOString();
}

function timestampNowDate(): Date {
  return new Date();
}
