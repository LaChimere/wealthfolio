import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { createHealthRepository, createHealthService, DEFAULT_HEALTH_CONFIG } from "./health";
import type { Account } from "./accounts";
import type { Settings } from "./settings";

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

  test("reads cached health status without running checks", async () => {
    const db = createHealthDb();
    let nowMs = Date.parse("2026-05-14T12:00:00.000Z");
    let settingsReads = 0;
    const service = createHealthService(createHealthRepository(db), DEFAULT_HEALTH_CONFIG, {
      settingsProvider: {
        getSettings: () => {
          settingsReads += 1;
          return settings({ timezone: "UTC" });
        },
      },
      now: () => new Date(nowMs),
    });

    try {
      expect(service.getCachedHealthStatus?.()).toBeNull();
      expect(settingsReads).toBe(0);

      await service.runHealthChecks?.();
      const cached = service.getCachedHealthStatus?.();
      expect(cached).toMatchObject({
        overallSeverity: "INFO",
        isStale: false,
      });
      expect(settingsReads).toBe(1);

      nowMs += 6 * 60 * 1000;
      const stale = service.getCachedHealthStatus?.();
      expect(stale).toMatchObject({
        overallSeverity: "INFO",
        isStale: true,
      });
      expect(settingsReads).toBe(1);
    } finally {
      db.close();
    }
  });

  test("runs bounded account and timezone health checks with severity rollup", async () => {
    const db = createHealthDb();
    const accounts = [
      account({ id: "account-2", name: "Two", trackingMode: "NOT_SET" }),
      account({ id: "account-1", name: "One", trackingMode: "NOT_SET" }),
      account({ id: "inactive", isActive: false, trackingMode: "NOT_SET" }),
      account({ id: "archived", isArchived: true, trackingMode: "NOT_SET" }),
      account({ id: "configured", trackingMode: "TRANSACTIONS" }),
    ];
    const service = createHealthService(createHealthRepository(db), DEFAULT_HEALTH_CONFIG, {
      accountProvider: {
        getActiveNonArchivedAccounts: () =>
          accounts.filter((candidate) => candidate.isActive && !candidate.isArchived),
      },
      settingsProvider: { getSettings: () => settings({ timezone: "" }) },
      now: () => new Date("2026-05-14T12:00:00.000Z"),
    });

    try {
      const status = await service.runHealthChecks?.();
      expect(status).toMatchObject({
        overallSeverity: "WARNING",
        issueCounts: { WARNING: 2 },
        checkedAt: "2026-05-14T12:00:00.000Z",
        isStale: false,
      });
      expect(status?.issues).toHaveLength(2);
      expect(status?.issues[0]).toMatchObject({
        id: expect.stringMatching(/^unconfigured_accounts:/),
        category: "ACCOUNT_CONFIGURATION",
        title: "2 accounts need setup",
        affectedCount: 2,
        affectedItems: [
          { id: "account-2", name: "Two", route: "/accounts/account-2" },
          { id: "account-1", name: "One", route: "/accounts/account-1" },
        ],
        navigateAction: { route: "/connect", label: "Configure Accounts" },
      });
      expect(status?.issues[1]).toMatchObject({
        id: expect.stringMatching(/^timezone_missing:/),
        category: "SETTINGS_CONFIGURATION",
        title: "Timezone not configured",
      });
    } finally {
      db.close();
    }
  });

  test("adds bounded legacy classification migration issue from taxonomy status", async () => {
    const db = createHealthDb();
    const service = createHealthService(createHealthRepository(db), DEFAULT_HEALTH_CONFIG, {
      classificationMigrationProvider: {
        getMigrationStatus: async () => ({
          needed: true,
          assetsWithLegacyData: 2,
          assetsAlreadyMigrated: 1,
        }),
      },
      settingsProvider: { getSettings: () => settings({ timezone: "UTC" }) },
      now: () => new Date("2026-05-14T12:00:00.000Z"),
    });

    try {
      const status = await service.runHealthChecks?.("UTC");
      expect(status).toMatchObject({
        overallSeverity: "WARNING",
        issueCounts: { WARNING: 1 },
      });
      expect(status?.issues).toEqual([
        expect.objectContaining({
          id: expect.stringMatching(/^classification:legacy_migration:/),
          severity: "WARNING",
          category: "CLASSIFICATION",
          title: "2 assets have legacy classification data",
          affectedCount: 2,
          fixAction: {
            id: "migrate_legacy_classifications",
            label: "Start Migration",
            payload: null,
          },
          navigateAction: { route: "/settings/taxonomies", label: "View Classifications" },
        }),
      ]);
    } finally {
      db.close();
    }
  });

  test("matches Rust timezone validity and offset-equivalence behavior", async () => {
    const db = createHealthDb();
    try {
      const invalidTimezoneService = createHealthService(
        createHealthRepository(db),
        DEFAULT_HEALTH_CONFIG,
        {
          settingsProvider: { getSettings: () => settings({ timezone: "Mars/Phobos" }) },
          now: () => new Date("2026-01-01T12:00:00.000Z"),
        },
      );
      const invalidStatus = await invalidTimezoneService.runHealthChecks?.();
      expect(invalidStatus?.overallSeverity).toBe("ERROR");
      expect(invalidStatus?.issues[0]).toMatchObject({
        id: expect.stringMatching(/^timezone_invalid:/),
        severity: "ERROR",
      });

      const equivalentTimezoneService = createHealthService(
        createHealthRepository(db),
        DEFAULT_HEALTH_CONFIG,
        {
          settingsProvider: { getSettings: () => settings({ timezone: "Europe/Berlin" }) },
          now: () => new Date("2026-01-01T12:00:00.000Z"),
        },
      );
      const equivalentStatus = await equivalentTimezoneService.runHealthChecks?.("Europe/Paris");
      expect(equivalentStatus).toMatchObject({
        overallSeverity: "INFO",
        issues: [],
      });

      const mismatchTimezoneService = createHealthService(
        createHealthRepository(db),
        DEFAULT_HEALTH_CONFIG,
        {
          settingsProvider: { getSettings: () => settings({ timezone: "UTC" }) },
          now: () => new Date("2026-01-01T12:00:00.000Z"),
        },
      );
      const mismatchStatus = await mismatchTimezoneService.runHealthChecks?.("America/Toronto");
      expect(mismatchStatus?.issues[0]).toMatchObject({
        id: expect.stringMatching(/^timezone_mismatch:/),
        severity: "WARNING",
        title: "Browser and app timezones differ",
      });
    } finally {
      db.close();
    }
  });

  test("filters matching dismissals and restores stale dismissal hashes", async () => {
    const db = createHealthDb();
    let accounts = [account({ id: "account-1", trackingMode: "NOT_SET" })];
    const repository = createHealthRepository(db);
    const service = createHealthService(repository, DEFAULT_HEALTH_CONFIG, {
      accountProvider: { getActiveNonArchivedAccounts: () => accounts },
      settingsProvider: { getSettings: () => settings({ timezone: "UTC" }) },
      now: () => new Date("2026-05-14T12:00:00.000Z"),
    });

    try {
      const initialStatus = await service.runHealthChecks?.();
      const issue = initialStatus?.issues[0];
      expect(issue).toBeDefined();

      await service.dismissIssue(issue!.id, "stale-hash");
      const restoredStatus = await service.runHealthChecks?.();
      expect(restoredStatus?.issues).toHaveLength(1);
      expect(readDismissalHash(db, issue!.id)).toBeNull();

      await service.dismissIssue(issue!.id, issue!.dataHash);
      const dismissedStatus = await service.getHealthStatus?.();
      expect(dismissedStatus).toMatchObject({ issues: [] });

      accounts = [...accounts, account({ id: "account-2", trackingMode: "NOT_SET" })];
      const changedDataStatus = await service.runHealthChecks?.();
      expect(changedDataStatus?.issues).toHaveLength(1);
      expect(changedDataStatus?.issues[0]?.id).not.toBe(issue!.id);
      expect(changedDataStatus?.issues[0]?.dataHash).not.toBe(issue!.dataHash);
    } finally {
      db.close();
    }
  });

  test("caches status per client timezone and invalidates cache after mutations", async () => {
    const db = createHealthDb();
    let nowMs = Date.parse("2026-05-14T12:00:00.000Z");
    let settingsReads = 0;
    const service = createHealthService(createHealthRepository(db), DEFAULT_HEALTH_CONFIG, {
      settingsProvider: {
        getSettings: () => {
          settingsReads += 1;
          return settings({ timezone: "UTC" });
        },
      },
      now: () => new Date(nowMs),
    });

    try {
      const first = await service.getHealthStatus?.("America/Toronto");
      const second = await service.getHealthStatus?.("America/Toronto");
      expect(settingsReads).toBe(1);
      expect(second?.checkedAt).toBe(first?.checkedAt);

      await service.getHealthStatus?.("Europe/London");
      expect(settingsReads).toBe(2);

      nowMs += 6 * 60 * 1000;
      const stale = await service.getHealthStatus?.("America/Toronto");
      expect(settingsReads).toBe(2);
      expect(stale?.isStale).toBe(true);

      const refreshed = await service.runHealthChecks?.("America/Toronto");
      expect(settingsReads).toBe(3);
      expect(refreshed?.isStale).toBe(false);
      expect(refreshed?.checkedAt).toBe("2026-05-14T12:06:00.000Z");

      await service.dismissIssue("not-real", "hash");
      await service.getHealthStatus?.("America/Toronto");
      expect(settingsReads).toBe(4);
    } finally {
      db.close();
    }
  });

  test("executes price health fixes through market data sync and clears cached status", async () => {
    const db = createHealthDb();
    let settingsReads = 0;
    const syncModes: unknown[] = [];
    const service = createHealthService(createHealthRepository(db), DEFAULT_HEALTH_CONFIG, {
      marketDataSyncProvider: {
        syncMarketData: (mode) => {
          syncModes.push(mode);
        },
      },
      settingsProvider: {
        getSettings: () => {
          settingsReads += 1;
          return settings({ timezone: "UTC" });
        },
      },
      now: () => new Date("2026-05-14T12:00:00.000Z"),
    });

    try {
      await service.getHealthStatus?.("UTC");
      await service.getHealthStatus?.("UTC");
      expect(settingsReads).toBe(1);

      await service.executeFix?.({
        id: "sync_prices",
        label: "Sync Prices",
        payload: ["asset-1", ""],
      });
      await service.executeFix?.({
        id: "retry_sync",
        label: "Retry Sync",
        payload: ["asset-2"],
      });

      expect(syncModes).toEqual([
        { type: "incremental", asset_ids: ["asset-1", ""] },
        { type: "incremental", asset_ids: ["asset-2"] },
      ]);

      await service.getHealthStatus?.("UTC");
      expect(settingsReads).toBe(2);
    } finally {
      db.close();
    }
  });

  test("executes FX health fixes through exchange-rate pair registration", async () => {
    const db = createHealthDb();
    let settingsReads = 0;
    const fxPairs: Array<[string, string]>[] = [];
    const service = createHealthService(createHealthRepository(db), DEFAULT_HEALTH_CONFIG, {
      exchangeRateProvider: {
        ensureFxPairs: (pairs) => {
          fxPairs.push(pairs);
        },
      },
      settingsProvider: {
        getSettings: () => {
          settingsReads += 1;
          return settings({ timezone: "UTC" });
        },
      },
      now: () => new Date("2026-05-14T12:00:00.000Z"),
    });

    try {
      await service.getHealthStatus?.("UTC");
      await service.getHealthStatus?.("UTC");
      expect(settingsReads).toBe(1);

      await service.executeFix?.({
        id: "fetch_fx",
        label: "Fetch Exchange Rates",
        payload: ["eur:usd", " CAD : USD "],
      });
      await service.executeFix?.({
        id: "fetch_fx",
        label: "Fetch Exchange Rates",
        payload: [],
      });

      expect(fxPairs).toEqual([
        [
          ["eur", "usd"],
          ["CAD", "USD"],
        ],
        [],
      ]);

      await service.getHealthStatus?.("UTC");
      expect(settingsReads).toBe(2);
    } finally {
      db.close();
    }
  });

  test("rejects unsupported or malformed health fix actions before syncing", async () => {
    const db = createHealthDb();
    const service = createHealthService(createHealthRepository(db), DEFAULT_HEALTH_CONFIG, {
      exchangeRateProvider: {
        ensureFxPairs: () => {
          throw new Error("should not register invalid FX fixes");
        },
      },
      marketDataSyncProvider: {
        syncMarketData: () => {
          throw new Error("should not sync invalid health fixes");
        },
      },
    });
    const serviceWithoutSync = createHealthService(createHealthRepository(db));

    try {
      await expect(
        service.executeFix?.({ id: "sync_prices", label: "Sync Prices", payload: [] }),
      ).rejects.toMatchObject({ status: 400, code: "invalid_payload" });
      await expect(
        service.executeFix?.({ id: "retry_sync", label: "Retry Sync", payload: ["asset-1", 1] }),
      ).rejects.toMatchObject({ status: 400, code: "invalid_payload" });
      await expect(
        service.executeFix?.({
          id: "fetch_fx",
          label: "Fetch Exchange Rates",
          payload: ["EUR"],
        }),
      ).rejects.toMatchObject({ status: 400, code: "invalid_payload" });
      await expect(
        service.executeFix?.({
          id: "migrate_classifications",
          label: "Migrate Classifications",
          payload: [],
        }),
      ).rejects.toMatchObject({ status: 404, code: "not_found" });
      await expect(
        serviceWithoutSync.executeFix?.({
          id: "sync_prices",
          label: "Sync Prices",
          payload: ["asset-1"],
        }),
      ).rejects.toMatchObject({ status: 404, code: "not_found" });
      await expect(
        serviceWithoutSync.executeFix?.({
          id: "fetch_fx",
          label: "Fetch Exchange Rates",
          payload: ["EUR:USD"],
        }),
      ).rejects.toMatchObject({ status: 404, code: "not_found" });
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

function settings(update: Partial<Settings>): Settings {
  return {
    theme: "light",
    font: "font-mono",
    baseCurrency: "USD",
    timezone: "UTC",
    instanceId: "",
    onboardingCompleted: false,
    autoUpdateCheckEnabled: true,
    menuBarVisible: true,
    syncEnabled: true,
    ...update,
  };
}

function account(update: Partial<Account>): Account {
  return {
    id: "account",
    name: "Account",
    accountType: "INVESTMENT",
    group: null,
    currency: "USD",
    isDefault: false,
    isActive: true,
    isArchived: false,
    trackingMode: "TRANSACTIONS",
    createdAt: "2026-05-14T12:00:00.000Z",
    updatedAt: "2026-05-14T12:00:00.000Z",
    platformId: null,
    accountNumber: null,
    meta: null,
    provider: null,
    providerAccountId: null,
    ...update,
  };
}
