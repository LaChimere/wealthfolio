import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { createHealthRepository, createHealthService, DEFAULT_HEALTH_CONFIG } from "./health";

describe("TS health domain", () => {
  test("dismisses, replaces, restores, and lists health issue dismissals", async () => {
    const db = createHealthDb();
    const service = createHealthService(createHealthRepository(db));

    try {
      await service.dismissIssue("price_stale:AAPL", "hash-1");
      await service.dismissIssue("fx_missing:EUR/USD", "hash-2");
      expect(await service.getDismissedIds()).toEqual(["price_stale:AAPL", "fx_missing:EUR/USD"]);

      await service.dismissIssue("price_stale:AAPL", "hash-3");
      expect(readDismissalHash(db, "price_stale:AAPL")).toBe("hash-3");

      await service.restoreIssue("price_stale:AAPL");
      expect(await service.getDismissedIds()).toEqual(["fx_missing:EUR/USD"]);
    } finally {
      db.close();
    }
  });

  test("reads and validates in-memory health config", async () => {
    const db = createHealthDb();
    const service = createHealthService(createHealthRepository(db));

    try {
      expect(await service.getConfig()).toEqual(DEFAULT_HEALTH_CONFIG);

      await service.updateConfig({
        ...DEFAULT_HEALTH_CONFIG,
        priceStaleWarningHours: 12,
        priceStaleCriticalHours: 48,
      });
      expect(await service.getConfig()).toMatchObject({
        priceStaleWarningHours: 12,
        priceStaleCriticalHours: 48,
      });

      await expect(
        service.updateConfig({
          ...DEFAULT_HEALTH_CONFIG,
          priceStaleWarningHours: 72,
          priceStaleCriticalHours: 24,
        }),
      ).rejects.toThrow("price_stale_warning_hours must be < price_stale_critical_hours");
      await expect(
        service.updateConfig({
          ...DEFAULT_HEALTH_CONFIG,
          fxStaleWarningHours: 0,
        }),
      ).rejects.toThrow("fx_stale_warning_hours must be > 0");
    } finally {
      db.close();
    }
  });
});

function createHealthDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE health_issue_dismissals (
      issue_id TEXT NOT NULL PRIMARY KEY,
      dismissed_at TEXT NOT NULL,
      data_hash TEXT NOT NULL
    );
  `);
  return db;
}

function readDismissalHash(db: Database, issueId: string): string | null {
  const row = db
    .query<
      { data_hash: string },
      [string]
    >("SELECT data_hash FROM health_issue_dismissals WHERE issue_id = ?")
    .get(issueId);
  return row?.data_hash ?? null;
}
