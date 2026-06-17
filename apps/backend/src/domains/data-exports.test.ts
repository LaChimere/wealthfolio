import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import type { AccountService } from "./accounts";
import type { ActivityService } from "./activities";
import { createDataExportService } from "./data-exports";

const unusedAccountService = {} as AccountService;
const unusedActivityService = {} as ActivityService;

describe("TS data export domain", () => {
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
