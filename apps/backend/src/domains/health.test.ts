import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { createHealthRepository, createHealthService, DEFAULT_HEALTH_CONFIG } from "./health";
import type { Account } from "./accounts";
import type { Holding } from "./holdings";
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

  test("adds legacy classification affected items from taxonomy migration details", async () => {
    const db = createHealthDb();
    let assetsNeedingMigration = [
      { id: "asset:one", symbol: "AAPL", name: null },
      { id: "asset/two", symbol: "MSFT", name: "Microsoft" },
    ];
    let assetsAlreadyMigrated = 1;
    const service = createHealthService(createHealthRepository(db), DEFAULT_HEALTH_CONFIG, {
      classificationMigrationProvider: {
        getMigrationStatus: () => {
          throw new Error("details provider should avoid a second status scan");
        },
        getLegacyClassificationMigrationDetails: () => ({
          assetsNeedingMigration,
          assetsAlreadyMigrated,
        }),
      },
      settingsProvider: { getSettings: () => settings({ timezone: "UTC" }) },
      now: () => new Date("2026-05-14T12:00:00.000Z"),
    });

    try {
      const firstStatus = await service.runHealthChecks?.("UTC");
      const firstIssue = firstStatus?.issues[0];
      expect(firstIssue).toMatchObject({
        id: expect.stringMatching(/^classification:legacy_migration:/),
        affectedCount: 2,
        affectedItems: [
          {
            id: "asset:one",
            name: "AAPL",
            symbol: "AAPL",
            route: "/holdings/asset%3Aone",
          },
          {
            id: "asset/two",
            name: "Microsoft",
            symbol: "MSFT",
            route: "/holdings/asset%2Ftwo",
          },
        ],
      });

      assetsNeedingMigration = [
        { id: "asset:three", symbol: "GOOG", name: null },
        { id: "asset/two", symbol: "MSFT", name: "Microsoft" },
      ];
      const changedAssetStatus = await service.runHealthChecks?.("UTC");
      expect(changedAssetStatus?.issues[0]?.dataHash).not.toBe(firstIssue?.dataHash);

      assetsAlreadyMigrated = 2;
      const changedMigratedStatus = await service.runHealthChecks?.("UTC");
      expect(changedMigratedStatus?.issues[0]?.dataHash).not.toBe(
        changedAssetStatus?.issues[0]?.dataHash,
      );
    } finally {
      db.close();
    }
  });

  test("adds bounded price staleness health issues from holdings and latest quotes", async () => {
    const db = createHealthDb();
    const service = createHealthService(
      createHealthRepository(db),
      {
        ...DEFAULT_HEALTH_CONFIG,
        priceStaleWarningHours: 24,
        priceStaleCriticalHours: 72,
        mvEscalationThreshold: 0.3,
      },
      {
        accountProvider: {
          getActiveAccounts: () => [
            account({ id: "account-b", isArchived: true }),
            account({ id: "account-a" }),
          ],
          getActiveNonArchivedAccounts: () => [account({ id: "account-a" })],
        },
        holdingsProvider: {
          getHoldings: (accountId) =>
            accountId === "account-a"
              ? [
                  holding({
                    assetId: "asset:warning",
                    symbol: "WARN-A",
                    name: "Warning First",
                    marketValue: 40,
                    pricingMode: "market",
                  }),
                  holding({
                    assetId: "asset/missing",
                    symbol: "MISS",
                    marketValue: 70,
                    pricingMode: "MARKET",
                  }),
                  holding({
                    assetId: "asset-zero-missing",
                    symbol: "ZERO",
                    marketValue: 0,
                    pricingMode: "MARKET",
                  }),
                  holding({
                    assetId: "asset-zero-stale",
                    symbol: "ZSTALE",
                    marketValue: 0,
                    pricingMode: "MARKET",
                  }),
                  holding({
                    assetId: "asset-manual",
                    symbol: "MAN",
                    marketValue: 80,
                    pricingMode: "MANUAL",
                  }),
                ]
              : [
                  holding({
                    assetId: "asset:warning",
                    symbol: "WARN-B",
                    name: "Warning Second",
                    marketValue: 10,
                    pricingMode: "MARKET",
                  }),
                ],
        },
        marketDataQuoteProvider: {
          getLatestQuotes: () => ({
            "asset:warning": latestQuote({ quoteDate: "2026-05-15" }),
            "asset-zero-stale": latestQuote({ quoteDate: "2026-05-01" }),
          }),
        },
        settingsProvider: { getSettings: () => settings({ timezone: "UTC" }) },
        now: () => new Date("2026-05-18T12:00:00.000Z"),
      },
    );

    try {
      const status = await service.runHealthChecks?.("UTC");

      expect(status?.overallSeverity).toBe("CRITICAL");
      expect(status?.issues).toEqual([
        expect.objectContaining({
          id: expect.stringMatching(/^price_stale:error:/),
          severity: "CRITICAL",
          category: "PRICE_STALENESS",
          title: "No market data for 2 holdings",
          message: expect.stringContaining("Unable to fetch market data"),
          affectedCount: 2,
          affectedMvPct: 0.35,
          fixAction: {
            id: "sync_prices",
            label: "Sync Prices",
            payload: ["asset/missing", "asset-zero-missing"],
          },
          affectedItems: [
            {
              id: "asset/missing",
              name: "MISS",
              symbol: "MISS",
              route: "/holdings/asset%2Fmissing",
            },
            {
              id: "asset-zero-missing",
              name: "ZERO",
              symbol: "ZERO",
              route: "/holdings/asset-zero-missing",
            },
          ],
          details: "1. MISS - no data\n2. ZERO - no data",
        }),
        expect.objectContaining({
          id: expect.stringMatching(/^price_stale:warning:/),
          severity: "WARNING",
          category: "PRICE_STALENESS",
          title: "Price update needed for 1 holding",
          affectedCount: 1,
          affectedMvPct: 0.25,
          fixAction: {
            id: "sync_prices",
            label: "Sync Prices",
            payload: ["asset:warning"],
          },
          affectedItems: [
            {
              id: "asset:warning",
              name: "Warning First",
              symbol: "WARN-A",
              route: "/holdings/asset%3Awarning",
            },
          ],
          details: "1. WARN-A (Warning First) - outdated",
        }),
      ]);
    } finally {
      db.close();
    }
  });

  test("keeps price staleness severity below critical at the MV threshold", async () => {
    const db = createHealthDb();
    const service = createHealthService(createHealthRepository(db), DEFAULT_HEALTH_CONFIG, {
      accountProvider: {
        getActiveAccounts: () => [account({ id: "account-a" })],
        getActiveNonArchivedAccounts: () => [account({ id: "account-a" })],
      },
      holdingsProvider: {
        getHoldings: () => [
          holding({ assetId: "asset-warning", symbol: "WARN", marketValue: 30 }),
          holding({
            assetId: "asset-manual",
            symbol: "MAN",
            marketValue: 70,
            pricingMode: "MANUAL",
          }),
        ],
      },
      marketDataQuoteProvider: {
        getLatestQuotes: () => ({
          "asset-warning": latestQuote({ quoteDate: "2026-05-15" }),
        }),
      },
      settingsProvider: { getSettings: () => settings({ timezone: "UTC" }) },
      now: () => new Date("2026-05-18T12:00:00.000Z"),
    });

    try {
      const status = await service.runHealthChecks?.("UTC");

      expect(status?.issues[0]).toMatchObject({
        severity: "WARNING",
        affectedMvPct: 0.3,
      });
    } finally {
      db.close();
    }
  });

  test("adds bounded quote sync health issues from sync error snapshots", async () => {
    const db = createHealthDb();
    const longError = "x".repeat(90);
    const service = createHealthService(
      createHealthRepository(db),
      { ...DEFAULT_HEALTH_CONFIG, mvEscalationThreshold: 0.3 },
      {
        accountProvider: {
          getActiveAccounts: () => [account({ id: "account-a" })],
          getActiveNonArchivedAccounts: () => [account({ id: "account-a" })],
        },
        holdingsProvider: {
          getHoldings: () => [
            holding({ assetId: "asset-error", symbol: "ERR", marketValue: 30 }),
            holding({ assetId: "asset-warning", symbol: "WARN", marketValue: 70 }),
          ],
        },
        marketDataQuoteProvider: {
          getQuoteSyncErrorSnapshots: () => [
            quoteSyncError({
              assetId: "asset-manual",
              symbol: "MAN",
              errorCount: 11,
              quoteMode: "MANUAL",
            }),
            quoteSyncError({
              assetId: "asset-error",
              symbol: "ERR",
              errorCount: 10,
              lastError: "provider unavailable",
            }),
            quoteSyncError({
              assetId: "unheld-1",
              symbol: "U1",
              errorCount: 9,
              lastError: longError,
            }),
            quoteSyncError({ assetId: "unheld-2", symbol: "U2", errorCount: 8, lastError: null }),
            quoteSyncError({
              assetId: "unheld-3",
              symbol: "U3",
              errorCount: 7,
              lastError: "symbol not found",
            }),
            quoteSyncError({
              assetId: "unheld-4",
              symbol: "U4",
              errorCount: 6,
              lastError: "rate limited",
            }),
            quoteSyncError({
              assetId: "unheld-5",
              symbol: "U5",
              errorCount: 6,
              lastError: "provider down",
            }),
            quoteSyncError({
              assetId: "asset-warning",
              symbol: "WARN",
              errorCount: 2,
              lastError: "timeout",
            }),
          ],
        },
        settingsProvider: { getSettings: () => settings({ timezone: "UTC" }) },
        now: () => new Date("2026-05-18T12:00:00.000Z"),
      },
    );

    try {
      const status = await service.runHealthChecks?.("UTC");

      expect(status?.issues).toEqual([
        expect.objectContaining({
          id: expect.stringMatching(/^quote_sync:error:/),
          severity: "ERROR",
          category: "PRICE_STALENESS",
          title: "Quotes sync failing for 6 assets",
          affectedCount: 6,
          affectedMvPct: 0.3,
          fixAction: {
            id: "retry_sync",
            label: "Retry Sync",
            payload: ["asset-error", "unheld-1", "unheld-2", "unheld-3", "unheld-4", "unheld-5"],
          },
          navigateAction: { route: "/settings/market-data", label: "View Market Data" },
          affectedItems: [
            {
              id: "asset-error",
              name: "ERR",
              symbol: "ERR",
              route: "/holdings/asset-error",
            },
            {
              id: "unheld-1",
              name: "U1",
              symbol: "U1",
              route: "/holdings/unheld-1",
            },
            {
              id: "unheld-2",
              name: "U2",
              symbol: "U2",
              route: "/holdings/unheld-2",
            },
            {
              id: "unheld-3",
              name: "U3",
              symbol: "U3",
              route: "/holdings/unheld-3",
            },
            {
              id: "unheld-4",
              name: "U4",
              symbol: "U4",
              route: "/holdings/unheld-4",
            },
            {
              id: "unheld-5",
              name: "U5",
              symbol: "U5",
              route: "/holdings/unheld-5",
            },
          ],
          details: [
            "1. ERR - 10 failures: provider unavailable",
            `2. U1 - 9 failures: ${"x".repeat(80)}`,
            "3. U2 - 8 failures: Unknown error",
            "4. U3 - 7 failures: symbol not found",
            "5. U4 - 6 failures: rate limited",
            "... and 1 more",
          ].join("\n"),
        }),
        expect.objectContaining({
          id: expect.stringMatching(/^quote_sync:warning:/),
          severity: "WARNING",
          category: "PRICE_STALENESS",
          title: "Sync issues for WARN",
          affectedCount: 1,
          affectedMvPct: 0.7,
          fixAction: { id: "retry_sync", label: "Retry Sync", payload: ["asset-warning"] },
          navigateAction: undefined,
          affectedItems: [
            {
              id: "asset-warning",
              name: "WARN",
              symbol: "WARN",
              route: "/holdings/asset-warning",
            },
          ],
          details: "1. WARN - 2 failures: timeout",
        }),
      ]);
    } finally {
      db.close();
    }
  });

  test("reports quote sync errors with zero MV when there are no active holdings", async () => {
    const db = createHealthDb();
    const service = createHealthService(createHealthRepository(db), DEFAULT_HEALTH_CONFIG, {
      accountProvider: {
        getActiveAccounts: () => [],
        getActiveNonArchivedAccounts: () => [],
      },
      holdingsProvider: {
        getHoldings: () => {
          throw new Error("should not load holdings when there are no active accounts");
        },
      },
      marketDataQuoteProvider: {
        getQuoteSyncErrorSnapshots: () => [
          quoteSyncError({ assetId: "unheld", symbol: "UNHELD", errorCount: 6 }),
        ],
      },
      settingsProvider: { getSettings: () => settings({ timezone: "UTC" }) },
    });

    try {
      const status = await service.runHealthChecks?.("UTC");

      expect(status?.issues).toEqual([
        expect.objectContaining({
          id: expect.stringMatching(/^quote_sync:error:/),
          severity: "ERROR",
          affectedMvPct: 0,
          fixAction: { id: "retry_sync", label: "Retry Sync", payload: ["unheld"] },
        }),
      ]);
    } finally {
      db.close();
    }
  });

  test("adds bounded FX integrity health issues from holdings and FX rate snapshots", async () => {
    const db = createHealthDb();
    const service = createHealthService(
      createHealthRepository(db),
      {
        ...DEFAULT_HEALTH_CONFIG,
        fxStaleWarningHours: 24,
        fxStaleCriticalHours: 72,
        mvEscalationThreshold: 0.3,
      },
      {
        accountProvider: {
          getActiveAccounts: () => [account({ id: "account-a" })],
          getActiveNonArchivedAccounts: () => [account({ id: "account-a" })],
        },
        holdingsProvider: {
          getHoldings: () => [
            holding({
              assetId: "asset-eur",
              symbol: "EURSEC",
              marketValue: 40,
              localCurrency: "EUR",
              baseCurrency: "USD",
            }),
            holding({
              assetId: "cash-gbp",
              symbol: "GBP",
              marketValue: 20,
              localCurrency: "GBP",
              baseCurrency: "USD",
              instrument: false,
            }),
            holding({
              assetId: "asset-cad",
              symbol: "CADSEC",
              marketValue: 20,
              localCurrency: "CAD",
              baseCurrency: "USD",
            }),
            holding({
              assetId: "asset-chf",
              symbol: "CHFSEC",
              marketValue: 10,
              localCurrency: "CHF",
              baseCurrency: "USD",
            }),
            holding({ assetId: "asset-usd", symbol: "USDSEC", marketValue: 130 }),
          ],
        },
        exchangeRateProvider: {
          ensureFxPairs: () => {},
          getLatestFxRateSnapshots: () => [
            fxSnapshot({ fromCurrency: "EUR", toCurrency: "USD", quoteTimestamp: null }),
            fxSnapshot({
              fromCurrency: "USD",
              toCurrency: "EUR",
              quoteTimestamp: "2026-05-18T12:00:00.000Z",
            }),
            fxSnapshot({
              fromCurrency: "CAD",
              toCurrency: "USD",
              quoteTimestamp: "2026-05-14T00:00:00.000Z",
            }),
            fxSnapshot({
              fromCurrency: "CHF",
              toCurrency: "USD",
              quoteTimestamp: "2026-05-17T00:00:00.000Z",
            }),
          ],
        },
        settingsProvider: { getSettings: () => settings({ timezone: "UTC" }) },
        now: () => new Date("2026-05-18T12:00:00.000Z"),
      },
    );

    try {
      const status = await service.runHealthChecks?.("UTC");

      expect(status?.issues).toEqual([
        expect.objectContaining({
          id: expect.stringMatching(/^fx_missing:/),
          severity: "ERROR",
          category: "FX_INTEGRITY",
          title: "Missing exchange rates for 2 currencies",
          affectedCount: 2,
          affectedMvPct: 0.3,
          fixAction: {
            id: "fetch_fx",
            label: "Fetch Exchange Rates",
            payload: ["EUR:USD", "GBP:USD"],
          },
          affectedItems: [
            { id: "EUR:USD", name: "EUR \u2192 USD" },
            { id: "GBP:USD", name: "GBP \u2192 USD" },
          ],
        }),
        expect.objectContaining({
          id: expect.stringMatching(/^fx_stale:error:/),
          severity: "ERROR",
          category: "FX_INTEGRITY",
          title: "Outdated exchange rate",
          affectedCount: 1,
          affectedMvPct: 0.1,
          fixAction: {
            id: "fetch_fx",
            label: "Fetch Exchange Rates",
            payload: ["CAD:USD"],
          },
          affectedItems: [{ id: "CAD:USD", name: "CAD \u2192 USD" }],
        }),
        expect.objectContaining({
          id: expect.stringMatching(/^fx_stale:warning:/),
          severity: "WARNING",
          category: "FX_INTEGRITY",
          title: "Exchange rate update needed",
          affectedCount: 1,
          affectedMvPct: 0.05,
          fixAction: {
            id: "fetch_fx",
            label: "Fetch Exchange Rates",
            payload: ["CHF:USD"],
          },
          affectedItems: [{ id: "CHF:USD", name: "CHF \u2192 USD" }],
        }),
      ]);
    } finally {
      db.close();
    }
  });

  test("adds bounded data consistency issues for negative account balances", async () => {
    const db = createHealthDb();
    const requestedAccountIds: string[][] = [];
    const service = createHealthService(createHealthRepository(db), DEFAULT_HEALTH_CONFIG, {
      accountProvider: {
        getActiveAccounts: () => [
          account({ id: "account-b", name: "Investments B", accountType: "SECURITIES" }),
          account({ id: "cash-a", name: "Cash A", accountType: "CASH" }),
          account({ id: "account-a", name: "Investments A", accountType: "SECURITIES" }),
        ],
        getActiveNonArchivedAccounts: () => [],
      },
      valuationProvider: {
        getAccountsWithNegativeBalance: (accountIds) => {
          requestedAccountIds.push(accountIds);
          return accountIds
            .map((accountId) => {
              if (accountId === "account-a") {
                return {
                  accountId,
                  firstNegativeDate: "2026-05-01",
                  cashBalance: "-50.205",
                  totalValue: "-20.100",
                  accountCurrency: "USD",
                };
              }
              if (accountId === "account-b") {
                return {
                  accountId,
                  firstNegativeDate: "2026-05-02",
                  cashBalance: "10",
                  totalValue: "-5",
                  accountCurrency: "CAD",
                };
              }
              if (accountId === "cash-a") {
                return {
                  accountId,
                  firstNegativeDate: "2026-05-03",
                  cashBalance: "-25.1",
                  totalValue: "-25.1",
                  accountCurrency: "USD",
                };
              }
              return null;
            })
            .filter((value) => value !== null);
        },
      },
      settingsProvider: { getSettings: () => settings({ timezone: "UTC" }) },
      now: () => new Date("2026-05-18T12:00:00.000Z"),
    });

    try {
      const status = await service.runHealthChecks?.("UTC");

      expect(requestedAccountIds).toEqual([["account-a", "account-b"], ["cash-a"]]);
      expect(status?.issues).toEqual([
        expect.objectContaining({
          id: expect.stringMatching(/^negative_account_balance:/),
          severity: "WARNING",
          category: "DATA_CONSISTENCY",
          title: "2 accounts have negative portfolio balance",
          message:
            "One or more accounts show a negative total value in their history. This is usually caused by missing buy transactions. Review your activities to fix this.",
          affectedCount: 2,
          affectedItems: [
            {
              id: "account-a",
              name: "Investments A",
              route: "/accounts/account-a",
            },
            {
              id: "account-b",
              name: "Investments B",
              route: "/accounts/account-b",
            },
          ],
          navigateAction: { route: "/activities", label: "View Activities" },
          details: [
            "Investments A",
            "First went negative on 2026-05-01.",
            "Cash: -50.21 USD | Investments: 30.11 USD",
            "\u2192 Likely missing Transfer In or deposit before a buy transaction.",
            "",
            "Investments B",
            "First went negative on 2026-05-02.",
            "Cash: 10.00 CAD | Investments: -15.00 CAD",
            "\u2192 Likely missing Buy transaction before a Sell.",
          ].join("\n"),
        }),
        expect.objectContaining({
          id: expect.stringMatching(/^negative_cash_balance:/),
          severity: "INFO",
          category: "DATA_CONSISTENCY",
          title: "Cash account had a negative balance",
          message:
            "One or more cash accounts show a negative balance in their history. This may be a normal bank overdraft or a missing deposit entry.",
          affectedCount: 1,
          affectedItems: [{ id: "cash-a", name: "Cash A", route: "/accounts/cash-a" }],
          navigateAction: { route: "/activities", label: "View Activities" },
          details: [
            "Cash A",
            "First went negative on 2026-05-03.",
            "Cash: -25.10 USD",
            "\u2192 This may be a bank overdraft or a missing deposit entry.",
          ].join("\n"),
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

  test("executes classification migration fixes through taxonomy migration", async () => {
    const db = createHealthDb();
    let settingsReads = 0;
    const migrationAssetIds: (readonly string[] | undefined)[] = [];
    const service = createHealthService(createHealthRepository(db), DEFAULT_HEALTH_CONFIG, {
      classificationMigrationProvider: {
        migrateLegacyClassifications: (assetIds) => {
          migrationAssetIds.push(assetIds);
          return {
            sectorsMigrated: 0,
            countriesMigrated: 0,
            assetsProcessed: 0,
            errors: [],
          };
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
        id: "migrate_classifications",
        label: "Migrate Classifications",
        payload: ["asset-1", "asset-2"],
      });
      await service.executeFix?.({
        id: "migrate_classifications",
        label: "Migrate Classifications",
        payload: [],
      });

      expect(migrationAssetIds).toEqual([["asset-1", "asset-2"], []]);

      await service.getHealthStatus?.("UTC");
      expect(settingsReads).toBe(2);
    } finally {
      db.close();
    }
  });

  test("rejects unsupported or malformed health fix actions before syncing", async () => {
    const db = createHealthDb();
    const service = createHealthService(createHealthRepository(db), DEFAULT_HEALTH_CONFIG, {
      classificationMigrationProvider: {
        migrateLegacyClassifications: () => {
          throw new Error("should not migrate invalid classification fixes");
        },
      },
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
          payload: ["asset-1", 1],
        }),
      ).rejects.toMatchObject({ status: 400, code: "invalid_payload" });
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
      await expect(
        serviceWithoutSync.executeFix?.({
          id: "migrate_classifications",
          label: "Migrate Classifications",
          payload: ["asset-1"],
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

function holding(update: {
  assetId: string;
  symbol: string;
  name?: string | null;
  marketValue: number;
  pricingMode?: string;
  localCurrency?: string;
  baseCurrency?: string;
  instrument?: boolean;
}): Holding {
  const hasInstrument = update.instrument ?? true;
  return {
    id: `${update.assetId}:holding`,
    accountId: "account",
    holdingType: hasInstrument ? "security" : "cash",
    instrument: hasInstrument
      ? {
          id: update.assetId,
          symbol: update.symbol,
          name: update.name ?? null,
          currency: update.localCurrency ?? "USD",
          notes: null,
          pricingMode: update.pricingMode ?? "MARKET",
          preferredProvider: null,
          exchangeMic: "XNAS",
          classifications: null,
        }
      : null,
    assetKind: hasInstrument ? "STOCK" : null,
    quantity: 1,
    openDate: null,
    lots: null,
    contractMultiplier: 1,
    localCurrency: update.localCurrency ?? "USD",
    baseCurrency: update.baseCurrency ?? "USD",
    fxRate: 1,
    marketValue: { local: update.marketValue, base: update.marketValue },
    costBasis: null,
    price: update.marketValue,
    purchasePrice: null,
    unrealizedGain: null,
    unrealizedGainPct: null,
    realizedGain: null,
    realizedGainPct: null,
    totalGain: null,
    totalGainPct: null,
    dayChange: null,
    dayChangePct: null,
    prevCloseValue: null,
    weight: 0,
    asOfDate: "2026-05-18",
    metadata: null,
  };
}

function latestQuote(update: { quoteDate: string }) {
  return {
    quote: null,
    isStale: true,
    effectiveMarketDate: "2026-05-18",
    quoteDate: update.quoteDate,
  };
}

function fxSnapshot(update: {
  fromCurrency: string;
  toCurrency: string;
  quoteTimestamp: string | null;
}) {
  return {
    assetId: `${update.fromCurrency}-${update.toCurrency}`,
    fromCurrency: update.fromCurrency,
    toCurrency: update.toCurrency,
    instrumentKey: `FX:${update.fromCurrency}/${update.toCurrency}`,
    quoteTimestamp: update.quoteTimestamp,
  };
}

function quoteSyncError(update: {
  assetId: string;
  symbol: string;
  errorCount: number;
  quoteMode?: string;
  lastError?: string | null;
}) {
  return {
    assetId: update.assetId,
    symbol: update.symbol,
    quoteMode: update.quoteMode ?? "MARKET",
    errorCount: update.errorCount,
    lastError: update.lastError ?? null,
  };
}
