import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import type { AccountService } from "./accounts";
import type { ActivityService } from "./activities";
import {
  createDataExportService,
  exportFileName,
  parseExportDataType,
  parseExportFileFormat,
} from "./data-exports";

const unusedAccountService = {} as AccountService;
const unusedActivityService = {} as ActivityService;

describe("TS data export domain", () => {
  test("parses export route segments with Rust-compatible case sensitivity", () => {
    expect(parseExportDataType("accounts")).toBe("accounts");
    expect(() => parseExportDataType("Accounts")).toThrow("Unsupported export data type: Accounts");
    expect(parseExportFileFormat("CSV")).toBe("csv");
  });

  test("uses local dates for export filenames like Rust", () => {
    const localNextDay = {
      getFullYear: () => 2026,
      getMonth: () => 5,
      getDate: () => 20,
      toISOString: () => "2026-06-19T17:00:00.000Z",
    } as Date;

    expect(exportFileName("activities", "csv", localNextDay)).toBe("activities_2026-06-20.csv");
    expect(exportFileName("portfolio-history", "json", localNextDay)).toBe(
      "portfolio-history_2026-06-20.json",
    );
  });

  test("exports activities from the first search page like Rust", async () => {
    const db = new Database(":memory:");
    const searchRequests: unknown[] = [];
    const service = createDataExportService({
      db,
      accountService: unusedAccountService,
      activityService: {
        searchActivities(request) {
          searchRequests.push(request);
          return {
            data: [{ id: "activity-1", activityType: "BUY" }],
            meta: { totalRowCount: 1 },
          };
        },
      } as ActivityService,
    });

    try {
      const bytes = await service.exportData("activities", "json");
      if (!bytes) {
        throw new Error("Expected activity export content");
      }

      expect(searchRequests).toEqual([
        {
          page: 0,
          pageSize: Number.MAX_SAFE_INTEGER,
          sort: { id: "date", desc: true },
        },
      ]);
      expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual([
        { id: "activity-1", activityType: "BUY" },
      ]);
    } finally {
      db.close();
    }
  });

  test("exports portfolio history from the canonical total account snapshot", async () => {
    const db = new Database(":memory:");
    const valuationCalls: Array<{
      accountId: string;
      startDate?: string | null;
      endDate?: string | null;
    }> = [];
    const service = createDataExportService({
      db,
      accountService: unusedAccountService,
      activityService: unusedActivityService,
      getHistoricalValuations(accountId, startDate, endDate) {
        valuationCalls.push({ accountId, startDate, endDate });
        return Promise.resolve([{ accountId, date: "2026-06-17", value: "123.45" }]);
      },
    });

    try {
      const bytes = await service.exportData("portfolio-history", "json");
      if (!bytes) {
        throw new Error("Expected portfolio history export content");
      }

      expect(valuationCalls).toEqual([{ accountId: "TOTAL", startDate: null, endDate: null }]);
      expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual([
        { accountId: "TOTAL", date: "2026-06-17", value: "123.45" },
      ]);
    } finally {
      db.close();
    }
  });
});
