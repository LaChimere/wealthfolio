import type { Database } from "bun:sqlite";

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
  getHealthStatus?(clientTimezone?: string): Promise<unknown> | unknown;
  runHealthChecks?(clientTimezone?: string): Promise<unknown> | unknown;
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
): HealthService {
  let config = { ...initialConfig };
  return {
    async dismissIssue(issueId, dataHash) {
      repository.saveDismissal(issueId, dataHash);
    },
    async restoreIssue(issueId) {
      repository.removeDismissal(issueId);
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
    },
  };
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
