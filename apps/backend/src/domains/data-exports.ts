import type { Database } from "bun:sqlite";
import type { AccountService } from "./accounts";
import type { ActivityService } from "./activities";
import type { GoalService } from "./goals";

export type ExportDataType = "accounts" | "activities" | "goals" | "portfolio-history";
export type ExportFileFormat = "csv" | "json";

export interface DataExportService {
  exportData(dataType: ExportDataType, format: ExportFileFormat): Promise<Uint8Array | null>;
}

export interface DataExportServiceOptions {
  db: Database;
  accountService: AccountService;
  activityService: ActivityService;
  goalService?: GoalService;
  getHistoricalValuations?: (
    accountId: string,
    startDate?: string | null,
    endDate?: string | null,
  ) => Promise<unknown[]>;
}

const EXPORT_ACTIVITY_PAGE_SIZE = 9_007_199_254_740_991;
const PORTFOLIO_TOTAL_ACCOUNT_ID = "TOTAL";

export function parseExportDataType(value: string): ExportDataType {
  const normalized = value.toLowerCase();
  if (
    normalized === "accounts" ||
    normalized === "activities" ||
    normalized === "goals" ||
    normalized === "portfolio-history"
  ) {
    return normalized as ExportDataType;
  }
  throw new Error(`Unsupported export data type: ${value}`);
}

export function parseExportFileFormat(value: string): ExportFileFormat {
  const normalized = value.toLowerCase();
  if (normalized === "csv" || normalized === "json") {
    return normalized as ExportFileFormat;
  }
  throw new Error(`Unsupported export file format: ${value}`);
}

export function exportFileName(
  dataType: ExportDataType,
  format: ExportFileFormat,
  date: Date = new Date(),
): string {
  const stem = dataType === "portfolio-history" ? "portfolio-history" : dataType;
  const dateStr = date.toISOString().split("T")[0];
  const ext = format === "csv" ? "csv" : "json";
  return `${stem}_${dateStr}.${ext}`;
}

export function contentType(format: ExportFileFormat): string {
  return format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8";
}

export function createDataExportService(options: DataExportServiceOptions): DataExportService {
  const {
    accountService,
    activityService,
    goalService,
    getHistoricalValuations: valuationGetter,
  } = options;

  async function buildExportContent(dataType: ExportDataType): Promise<unknown[] | null> {
    switch (dataType) {
      case "accounts": {
        const accounts = await accountService.listAccounts({ isArchived: false });
        return accounts.length > 0 ? accounts : null;
      }
      case "activities": {
        const result = await activityService.searchActivities({
          page: 1,
          pageSize: EXPORT_ACTIVITY_PAGE_SIZE,
          sort: { id: "date", desc: true },
        });
        return result.data.length > 0 ? result.data : null;
      }
      case "goals": {
        if (!goalService) {
          throw new Error("Goal service not available for export");
        }
        const goals = await goalService.getGoals();
        return goals.length > 0 ? goals : null;
      }
      case "portfolio-history": {
        if (!valuationGetter) {
          throw new Error("Valuation service not available for export");
        }
        const records = await valuationGetter(PORTFOLIO_TOTAL_ACCOUNT_ID, null, null);
        return Array.isArray(records) && records.length > 0 ? records : null;
      }
    }
  }

  async function formatRecords(
    records: unknown[] | null,
    format: ExportFileFormat,
  ): Promise<Uint8Array | null> {
    if (!records || records.length === 0) {
      return null;
    }

    if (format === "json") {
      const json = JSON.stringify(records, null, 2);
      return new TextEncoder().encode(json);
    }

    const csv = recordsToCsv(records);
    return new TextEncoder().encode(csv);
  }

  return {
    async exportData(dataType, format) {
      const records = await buildExportContent(dataType);
      return formatRecords(records, format);
    },
  };
}

function recordsToCsv(records: unknown[]): string {
  const rows = records.map((record) => {
    if (typeof record !== "object" || record === null) {
      throw new Error("Export rows must be JSON objects");
    }
    return record as Record<string, unknown>;
  });

  if (rows.length === 0) {
    return "";
  }

  const sourceKeys = collectKeys(rows);
  const headers = sourceKeys
    .map((key) => (key === "assetId" ? "symbol" : key))
    .map(jsonString)
    .join(",");

  const dataRows = rows
    .map((row) =>
      sourceKeys
        .map((key) => cellValue(row[key]))
        .map(jsonString)
        .join(","),
    )
    .join("\n");

  return `${headers}\n${dataRows}`;
}

function collectKeys(rows: Record<string, unknown>[]): string[] {
  const keys: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!keys.includes(key)) {
        keys.push(key);
      }
    }
  }
  return keys;
}

function cellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function jsonString(value: string): string {
  return JSON.stringify(value);
}
