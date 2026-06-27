import { copyFileSync, cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";

import type { BackendRuntimeConfig } from "./config";
import type { PortfolioJobConfig } from "./domains/portfolio-jobs";
import {
  createSqliteBackedBackendServices,
  resolveBackendAppDataDir,
  resolveBackendMigrationsDir,
} from "./runtime";
import { startBackendServer } from "./server";
import { openSqliteDatabase } from "./storage/sqlite";
import {
  ACTIVITIES_CHANGED_EVENT,
  ASSETS_CREATED_EVENT,
  ASSETS_UPDATED_EVENT,
  HOLDINGS_CHANGED_EVENT,
  MANUAL_SNAPSHOT_SAVED_EVENT,
} from "./domain-events/planner";

const repositoryRoot = path.resolve(import.meta.dir, "../../..");
const config: BackendRuntimeConfig = {
  listen: { host: "127.0.0.1", port: 0 },
  cors: { allowOrigins: ["*"] },
  requestTimeoutMs: 1_000,
  secretKey: new Uint8Array(32),
};

function connectSubscriptionPlan(id: string): Record<string, unknown> {
  return {
    id,
    name: `${id} plan`,
    tagline: null,
    description: `${id} description`,
    pricing: { monthly: 10, yearly: 100, yearlyPerMonth: 8.33 },
    limits: { householdSize: 4, institutionConnections: "unlimited", devices: 5 },
    features: ["sync"],
    featuresExtended: null,
    isAvailable: true,
    isComingSoon: false,
    badge: null,
    yearlyDiscountPercent: null,
  };
}

describe("TS backend runtime composition", () => {
  test("resolves runtime data and migration roots from explicit options and env", () => {
    const existingDbDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-db-dir-"));
    expect(resolveBackendAppDataDir({}, "/tmp/app-data")).toBe("/tmp/app-data");
    expect(resolveBackendAppDataDir({ WF_APP_DATA_DIR: "/tmp/env-data" })).toBe("/tmp/env-data");
    expect(resolveBackendAppDataDir({ WF_DB_PATH: "/tmp/custom-db/app.db" })).toBe(
      "/tmp/custom-db",
    );
    expect(resolveBackendAppDataDir({ WF_DB_PATH: "/tmp/custom-db" })).toBe("/tmp");
    expect(resolveBackendAppDataDir({ WF_DB_PATH: existingDbDir })).toBe(existingDbDir);
    expect(resolveBackendMigrationsDir({}, { repositoryRoot })).toBe(
      path.join(repositoryRoot, "crates/storage-sqlite/migrations"),
    );
    expect(resolveBackendMigrationsDir({ WF_MIGRATIONS_DIR: "/tmp/migrations" })).toBe(
      "/tmp/migrations",
    );
  });

  test("starts from packaged runtime resource paths without repository-relative catalogs", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-packaged-"));
    const resourceDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-resources-"));
    const migrationsDir = path.join(resourceDir, "migrations");
    const exchangeCatalogPath = path.join(resourceDir, "exchanges.json");
    const aiProviderCatalogPath = path.join(resourceDir, "ai_providers.json");
    cpSync(path.join(repositoryRoot, "crates/storage-sqlite/migrations"), migrationsDir, {
      recursive: true,
    });
    copyFileSync(
      path.join(repositoryRoot, "crates/market-data/src/resolver/exchanges.json"),
      exchangeCatalogPath,
    );
    copyFileSync(
      path.join(repositoryRoot, "crates/ai/src/ai_providers.json"),
      aiProviderCatalogPath,
    );

    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      env: {
        WF_MIGRATIONS_DIR: migrationsDir,
        WF_EXCHANGE_CATALOG_PATH: exchangeCatalogPath,
        WF_AI_PROVIDER_CATALOG_PATH: aiProviderCatalogPath,
      },
      repositoryRoot: path.join(resourceDir, "missing-repository"),
      secretKey: new Uint8Array(32),
    });

    try {
      expect(runtime.dbPath).toBe(path.join(appDataDir, "app.db"));
    } finally {
      await runtime.close();
    }
  });

  test("uses packaged app version env when repository package metadata is unavailable", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-version-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      env: { WF_APP_VERSION: "9.8.7" },
      secretKey: new Uint8Array(32),
    });

    try {
      expect(runtime.options.appDataDir).toBe(appDataDir);
      expect(runtime.options.appUtilityService?.getAppInfo()).toMatchObject({ version: "9.8.7" });
    } finally {
      await runtime.close();
    }
  });

  test("stores Connect refresh sessions through the runtime secret service", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-connect-session-"));
    const refreshRequests: string[] = [];
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      env: {
        CONNECT_AUTH_URL: "https://auth.example.test",
        CONNECT_AUTH_PUBLISHABLE_KEY: "publishable-key",
      },
      marketDataFetch: (async (input) => {
        refreshRequests.push(String(input));
        return Response.json({ access_token: "access-token", refresh_token: "rotated-refresh" });
      }) as typeof fetch,
      secretKey: new Uint8Array(32),
    });
    const server = startBackendServer(config, runtime.options);

    try {
      const initialStatusResponse = await fetch(`${server.baseUrl}/api/v1/connect/session/status`);
      expect(initialStatusResponse.status).toBe(200);
      await expect(initialStatusResponse.json()).resolves.toEqual({ isConfigured: false });

      const storeResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(storeResponse.status).toBe(200);

      const configuredStatusResponse = await fetch(
        `${server.baseUrl}/api/v1/connect/session/status`,
      );
      expect(configuredStatusResponse.status).toBe(200);
      await expect(configuredStatusResponse.json()).resolves.toEqual({ isConfigured: true });

      const restoreResponse = await fetch(`${server.baseUrl}/api/v1/connect/session/restore`);
      expect(restoreResponse.status).toBe(200);
      await expect(restoreResponse.json()).resolves.toEqual({
        accessToken: "access-token",
        refreshToken: "rotated-refresh",
      });
      expect(refreshRequests).toEqual([
        "https://auth.example.test/auth/v1/token?grant_type=refresh_token",
      ]);
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb
          .prepare(
            `
              INSERT INTO sync_device_config (
                device_id, key_version, trust_state, last_bootstrap_at, min_snapshot_created_at
              ) VALUES (
                'device-session', 2, 'trusted', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z'
              )
            `,
          )
          .run();
      } finally {
        seedDb.close();
      }

      const clearResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "DELETE",
      });
      expect(clearResponse.status).toBe(200);

      const clearedStatusResponse = await fetch(`${server.baseUrl}/api/v1/connect/session/status`);
      expect(clearedStatusResponse.status).toBe(200);
      await expect(clearedStatusResponse.json()).resolves.toEqual({ isConfigured: false });
      const clearedDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          clearedDb
            .query<
              { min_snapshot_created_at: string | null },
              []
            >("SELECT min_snapshot_created_at FROM sync_device_config WHERE device_id = 'device-session'")
            .get(),
        ).toEqual({ min_snapshot_created_at: null });
      } finally {
        clearedDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("starts a TS server with SQLite-backed low-risk services", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      marketDataFetch: ((input: RequestInfo | URL) => {
        const url = String(input);
        if (
          url === "https://query2.finance.yahoo.com/v1/finance/search?q=SHOP" ||
          url === "https://query1.finance.yahoo.com/v1/finance/search?q=SHOP"
        ) {
          return Promise.resolve(Response.json({ quotes: [] }));
        }
        if (url === "https://fc.yahoo.com") {
          return Promise.resolve(
            new Response("", { headers: { "set-cookie": "B=runtime-fx; Path=/; Secure" } }),
          );
        }
        if (url === "https://query1.finance.yahoo.com/v1/test/getcrumb") {
          return Promise.resolve(new Response("runtime-crumb"));
        }
        if (url.startsWith("https://query1.finance.yahoo.com/v8/finance/chart/EURUSD%3DX?")) {
          return Promise.resolve(
            Response.json({
              chart: {
                result: [
                  {
                    meta: { currency: "USD" },
                    timestamp: [1767571200],
                    indicators: {
                      quote: [{ close: [1.25] }],
                    },
                  },
                ],
                error: null,
              },
            }),
          );
        }
        if (url.startsWith("https://query1.finance.yahoo.com/v8/finance/chart/SHOP.TO?")) {
          return Promise.resolve(
            Response.json({
              chart: {
                result: null,
                error: {
                  code: "Bad Request",
                  description: "Data doesn't exist for startDate = 1609718400",
                },
              },
            }),
          );
        }
        throw new Error(`unexpected market data fetch: ${url}`);
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      expect(runtime.dbPath).toBe(path.join(appDataDir, "app.db"));
      expect(runtime.appliedMigrations.length).toBeGreaterThan(0);

      const settingsResponse = await fetch(`${server.baseUrl}/api/v1/settings`);
      expect(settingsResponse.status).toBe(200);
      await expect(settingsResponse.json()).resolves.toMatchObject({
        theme: "light",
        baseCurrency: "",
        onboardingCompleted: false,
      });

      const updateResponse = await fetch(`${server.baseUrl}/api/v1/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseCurrency: "USD", timezone: "UTC" }),
      });
      expect(updateResponse.status).toBe(200);
      await expect(updateResponse.json()).resolves.toMatchObject({
        baseCurrency: "USD",
        timezone: "UTC",
      });

      const netWorthResponse = await fetch(`${server.baseUrl}/api/v1/net-worth?date=2026-05-14`);
      expect(netWorthResponse.status).toBe(200);
      await expect(netWorthResponse.json()).resolves.toEqual({
        date: "2026-05-14",
        assets: { total: 0, breakdown: [] },
        liabilities: { total: 0, breakdown: [] },
        netWorth: 0,
        currency: "USD",
        oldestValuationDate: null,
        staleAssets: [],
      });

      const incomeSummaryResponse = await fetch(`${server.baseUrl}/api/v1/income/summary`);
      expect(incomeSummaryResponse.status).toBe(200);
      await expect(incomeSummaryResponse.json()).resolves.toEqual([]);

      const emptyAccountExportResponse = await fetch(
        `${server.baseUrl}/api/v1/utilities/export/accounts/csv`,
      );
      expect(emptyAccountExportResponse.status).toBe(204);

      const simplePerformanceResponse = await fetch(
        `${server.baseUrl}/api/v1/performance/accounts/simple`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      expect(simplePerformanceResponse.status).toBe(200);
      await expect(simplePerformanceResponse.json()).resolves.toEqual([]);

      const performanceHistoryResponse = await fetch(
        `${server.baseUrl}/api/v1/performance/history`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ itemType: "account", itemId: "missing" }),
        },
      );
      expect(performanceHistoryResponse.status).toBe(200);
      await expect(performanceHistoryResponse.json()).resolves.toMatchObject({
        id: "missing",
        returns: [],
        periodStartDate: null,
      });

      const symbolPerformanceHistoryResponse = await fetch(
        `${server.baseUrl}/api/v1/performance/history`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            itemType: "symbol",
            itemId: "SPY",
            startDate: "2026-01-01",
            endDate: "2026-01-05",
          }),
        },
      );
      expect(symbolPerformanceHistoryResponse.status).toBe(200);
      await expect(symbolPerformanceHistoryResponse.json()).resolves.toEqual({
        id: "SPY",
        returns: [],
        periodStartDate: null,
        periodEndDate: null,
        currency: "",
        periodGain: 0,
        periodReturn: 0,
        cumulativeTwr: 0,
        gainLossAmount: null,
        annualizedTwr: 0,
        simpleReturn: 0,
        annualizedSimpleReturn: 0,
        cumulativeMwr: 0,
        annualizedMwr: 0,
        volatility: 0,
        maxDrawdown: 0,
        isHoldingsMode: false,
      });

      const performanceSummaryResponse = await fetch(
        `${server.baseUrl}/api/v1/performance/summary`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ itemType: "symbol", itemId: "SPY" }),
        },
      );
      expect(performanceSummaryResponse.status).toBe(200);
      await expect(performanceSummaryResponse.json()).resolves.toMatchObject({
        id: "SPY",
        returns: [],
      });

      const latestValuationsResponse = await fetch(`${server.baseUrl}/api/v1/valuations/latest`);
      expect(latestValuationsResponse.status).toBe(200);
      await expect(latestValuationsResponse.json()).resolves.toEqual([]);

      const valuationHistoryResponse = await fetch(
        `${server.baseUrl}/api/v1/valuations/history?accountId=missing`,
      );
      expect(valuationHistoryResponse.status).toBe(200);
      await expect(valuationHistoryResponse.json()).resolves.toEqual([]);

      const snapshotsResponse = await fetch(`${server.baseUrl}/api/v1/snapshots?accountId=missing`);
      expect(snapshotsResponse.status).toBe(200);
      await expect(snapshotsResponse.json()).resolves.toEqual([]);

      const snapshotHoldingsResponse = await fetch(
        `${server.baseUrl}/api/v1/snapshots/holdings?accountId=missing&date=2026-01-01`,
      );
      expect(snapshotHoldingsResponse.status).toBe(400);
      await expect(snapshotHoldingsResponse.json()).resolves.toMatchObject({
        message: "No snapshot found for date 2026-01-01",
      });

      const deleteSnapshotResponse = await fetch(
        `${server.baseUrl}/api/v1/snapshots?accountId=missing&date=2026-01-01`,
        { method: "DELETE" },
      );
      expect(deleteSnapshotResponse.status).toBe(400);
      await expect(deleteSnapshotResponse.json()).resolves.toMatchObject({
        message: "No snapshot found for date 2026-01-01",
      });

      const saveManualSnapshotResponse = await fetch(`${server.baseUrl}/api/v1/snapshots`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId: "missing", holdings: [], cashBalances: {} }),
      });
      expect(saveManualSnapshotResponse.status).toBe(400);
      await expect(saveManualSnapshotResponse.json()).resolves.toMatchObject({
        message: "Record not found: account missing",
      });

      const holdingsImportCheckResponse = await fetch(
        `${server.baseUrl}/api/v1/snapshots/import/check`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ accountId: "missing", snapshots: [] }),
        },
      );
      expect(holdingsImportCheckResponse.status).toBe(400);
      await expect(holdingsImportCheckResponse.json()).resolves.toMatchObject({
        message: "Record not found: account missing",
      });

      const holdingsImportResponse = await fetch(`${server.baseUrl}/api/v1/snapshots/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId: "missing", snapshots: [] }),
      });
      expect(holdingsImportResponse.status).toBe(400);
      await expect(holdingsImportResponse.json()).resolves.toMatchObject({
        message: "Record not found: account missing",
      });

      const holdingsResponse = await fetch(`${server.baseUrl}/api/v1/holdings?accountId=missing`);
      expect(holdingsResponse.status).toBe(200);
      await expect(holdingsResponse.json()).resolves.toEqual([]);

      const holdingItemResponse = await fetch(
        `${server.baseUrl}/api/v1/holdings/item?accountId=missing&assetId=missing`,
      );
      expect(holdingItemResponse.status).toBe(200);
      await expect(holdingItemResponse.json()).resolves.toBeNull();

      const assetHoldingsResponse = await fetch(
        `${server.baseUrl}/api/v1/holdings/by-asset?assetId=missing`,
      );
      expect(assetHoldingsResponse.status).toBe(200);
      await expect(assetHoldingsResponse.json()).resolves.toEqual([]);

      const allocationsResponse = await fetch(
        `${server.baseUrl}/api/v1/allocations?accountId=missing`,
      );
      expect(allocationsResponse.status).toBe(200);
      await expect(allocationsResponse.json()).resolves.toMatchObject({
        assetClasses: { taxonomyId: "asset_classes", categories: [] },
        sectors: { taxonomyId: "industries_gics", categories: [] },
        regions: { taxonomyId: "regions", categories: [] },
        riskCategory: { taxonomyId: "risk_category", categories: [] },
        securityTypes: { taxonomyId: "instrument_type", categories: [] },
        customGroups: [],
        totalValue: 0,
      });

      const allocationHoldingsResponse = await fetch(
        `${server.baseUrl}/api/v1/allocations/holdings?accountId=missing&taxonomyId=asset_classes&categoryId=__UNKNOWN__`,
      );
      expect(allocationHoldingsResponse.status).toBe(200);
      await expect(allocationHoldingsResponse.json()).resolves.toMatchObject({
        taxonomyId: "asset_classes",
        categoryId: "__UNKNOWN__",
        categoryName: "Unknown",
        holdings: [],
        totalValue: 0,
      });

      const accountsResponse = await fetch(`${server.baseUrl}/api/v1/accounts`);
      expect(accountsResponse.status).toBe(200);
      await expect(accountsResponse.json()).resolves.toEqual([]);

      const activityTemplatesResponse = await fetch(
        `${server.baseUrl}/api/v1/activities/import/templates`,
      );
      expect(activityTemplatesResponse.status).toBe(200);
      await expect(activityTemplatesResponse.json()).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "system_schwab", kind: "CSV_ACTIVITY" }),
        ]),
      );

      const saveActivityMappingResponse = await fetch(
        `${server.baseUrl}/api/v1/activities/import/mapping`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mapping: {
              accountId: "runtime-account",
              contextKind: "ACTIVITY",
              name: "Runtime CSV",
              fieldMappings: { date: "Trade Date" },
              activityMappings: { BUY: ["Buy"] },
            },
          }),
        },
      );
      expect(saveActivityMappingResponse.status).toBe(200);
      await expect(saveActivityMappingResponse.json()).resolves.toMatchObject({
        accountId: "runtime-account",
        contextKind: "CSV_ACTIVITY",
        name: "Runtime CSV",
      });

      const activityMappingResponse = await fetch(
        `${server.baseUrl}/api/v1/activities/import/mapping?accountId=runtime-account&contextKind=ACTIVITY`,
      );
      expect(activityMappingResponse.status).toBe(200);
      await expect(activityMappingResponse.json()).resolves.toMatchObject({
        accountId: "runtime-account",
        contextKind: "CSV_ACTIVITY",
        templateId: "acct_runtime-account",
        fieldMappings: { date: "Trade Date" },
      });

      const activitySearchResponse = await fetch(`${server.baseUrl}/api/v1/activities/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ page: 0, pageSize: 25 }),
      });
      expect(activitySearchResponse.status).toBe(200);
      await expect(activitySearchResponse.json()).resolves.toEqual({
        data: [],
        meta: { totalRowCount: 0 },
      });

      const activityCsvForm = new FormData();
      activityCsvForm.append("file", new File(["Symbol;Amount\nSHOP;10"], "activities.csv"));
      activityCsvForm.append("config", JSON.stringify({ delimiter: "auto" }));
      const activityCsvParseResponse = await fetch(
        `${server.baseUrl}/api/v1/activities/import/parse`,
        {
          method: "POST",
          body: activityCsvForm,
        },
      );
      expect(activityCsvParseResponse.status).toBe(200);
      await expect(activityCsvParseResponse.json()).resolves.toMatchObject({
        headers: ["Symbol", "Amount"],
        rows: [["SHOP", "10"]],
        detectedConfig: { delimiter: ";" },
        rowCount: 1,
      });

      const activityImportCheckResponse = await fetch(
        `${server.baseUrl}/api/v1/activities/import/check`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            activities: [{ activityType: "DEPOSIT", date: "2025-01-01", amount: "10" }],
          }),
        },
      );
      expect(activityImportCheckResponse.status).toBe(200);
      await expect(activityImportCheckResponse.json()).resolves.toEqual([
        expect.objectContaining({
          isValid: false,
          errors: { accountId: ["Account is required before running backend validation."] },
        }),
      ]);

      const activityImportApplyResponse = await fetch(
        `${server.baseUrl}/api/v1/activities/import`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            activities: [{ activityType: "DEPOSIT", date: "2025-01-01", amount: "10" }],
          }),
        },
      );
      expect(activityImportApplyResponse.status).toBe(200);
      await expect(activityImportApplyResponse.json()).resolves.toMatchObject({
        importRunId: "",
        summary: {
          total: 1,
          imported: 0,
          skipped: 1,
          success: false,
          errorMessage: "Account is required for all activities.",
        },
      });

      const aiProvidersResponse = await fetch(`${server.baseUrl}/api/v1/ai/providers`);
      expect(aiProvidersResponse.status).toBe(200);
      await expect(aiProvidersResponse.json()).resolves.toMatchObject({
        capabilities: { tools: { name: "Tools" } },
        providers: expect.arrayContaining([expect.objectContaining({ id: "ollama" })]),
      });

      const aiThreadsResponse = await fetch(`${server.baseUrl}/api/v1/ai/threads`);
      expect(aiThreadsResponse.status).toBe(200);
      await expect(aiThreadsResponse.json()).resolves.toEqual({
        threads: [],
        nextCursor: null,
        hasMore: false,
      });
      const aiStreamResponse = await fetch(`${server.baseUrl}/api/v1/ai/chat/stream`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "hello" }),
      });
      expect(aiStreamResponse.status).toBe(400);
      await expect(aiStreamResponse.json()).resolves.toMatchObject({
        code: "provider_not_configured",
      });

      const healthStatusResponse = await fetch(`${server.baseUrl}/api/v1/health/status`, {
        headers: { "x-client-timezone": "UTC" },
      });
      expect(healthStatusResponse.status).toBe(200);
      await expect(healthStatusResponse.json()).resolves.toMatchObject({
        overallSeverity: "INFO",
        issueCounts: {},
        issues: [],
        isStale: false,
      });

      const healthCheckResponse = await fetch(`${server.baseUrl}/api/v1/health/check`, {
        method: "POST",
        headers: { "x-client-timezone": "America/Toronto" },
      });
      expect(healthCheckResponse.status).toBe(200);
      await expect(healthCheckResponse.json()).resolves.toMatchObject({
        overallSeverity: "WARNING",
        issueCounts: { WARNING: 1 },
        issues: [expect.objectContaining({ id: expect.stringMatching(/^timezone_mismatch:/) })],
      });

      const healthMigrationFixResponse = await fetch(`${server.baseUrl}/api/v1/health/fix`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "migrate_legacy_classifications",
          label: "Start Migration",
          payload: null,
        }),
      });
      expect(healthMigrationFixResponse.status).toBe(200);

      const healthTargetedMigrationFixResponse = await fetch(
        `${server.baseUrl}/api/v1/health/fix`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: "migrate_classifications",
            label: "Migrate Classifications",
            payload: [],
          }),
        },
      );
      expect(healthTargetedMigrationFixResponse.status).toBe(200);

      const healthEmptyPriceSyncFixResponse = await fetch(`${server.baseUrl}/api/v1/health/fix`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "sync_prices", label: "Sync Prices", payload: [] }),
      });
      expect(healthEmptyPriceSyncFixResponse.status).toBe(400);

      const healthDeferredFixResponse = await fetch(`${server.baseUrl}/api/v1/health/fix`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "sync_prices", label: "Sync Prices", payload: ["asset-1"] }),
      });
      expect(healthDeferredFixResponse.status).toBe(200);

      const healthFxFixResponse = await fetch(`${server.baseUrl}/api/v1/health/fix`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "fetch_fx",
          label: "Fetch Exchange Rates",
          payload: ["EUR:USD"],
        }),
      });
      expect(healthFxFixResponse.status).toBe(200);
      const fxDb = openSqliteDatabase(runtime.dbPath);
      try {
        const fxQuote = fxDb
          .query<
            { close: string; currency: string; source: string },
            []
          >("SELECT q.close, q.currency, q.source FROM quotes q INNER JOIN assets a ON a.id = q.asset_id WHERE a.instrument_key = 'FX:EUR/USD'")
          .get();
        expect(fxQuote).toEqual({ close: "1.25", currency: "USD", source: "YAHOO" });
      } finally {
        fxDb.close();
      }

      const portfolioUpdateResponse = await fetch(`${server.baseUrl}/api/v1/portfolio/update`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountIds: ["missing"] }),
      });
      expect(portfolioUpdateResponse.status).toBe(202);

      const portfolioRecalculateResponse = await fetch(
        `${server.baseUrl}/api/v1/portfolio/recalculate`,
        {
          method: "POST",
        },
      );
      expect(portfolioRecalculateResponse.status).toBe(202);

      const runtimeAddonDir = path.join(appDataDir, "addons", "runtime-addon");
      mkdirSync(runtimeAddonDir, { recursive: true });
      writeFileSync(
        path.join(runtimeAddonDir, "manifest.json"),
        JSON.stringify({
          id: "runtime-addon",
          name: "Runtime Addon",
          version: "1.0.0",
          main: "main.js",
          enabled: true,
        }),
      );
      writeFileSync(path.join(runtimeAddonDir, "main.js"), "export default {};");

      const installedAddonsResponse = await fetch(`${server.baseUrl}/api/v1/addons/installed`);
      expect(installedAddonsResponse.status).toBe(200);
      await expect(installedAddonsResponse.json()).resolves.toEqual([
        {
          metadata: expect.objectContaining({
            id: "runtime-addon",
            name: "Runtime Addon",
            version: "1.0.0",
            main: "main.js",
            enabled: true,
          }),
          filePath: runtimeAddonDir,
          isZipAddon: false,
        },
      ]);

      const runtimeAddonResponse = await fetch(
        `${server.baseUrl}/api/v1/addons/runtime/runtime-addon`,
      );
      expect(runtimeAddonResponse.status).toBe(200);
      await expect(runtimeAddonResponse.json()).resolves.toMatchObject({
        metadata: { id: "runtime-addon" },
        files: [{ name: "main.js", content: "export default {};", isMain: true }],
      });

      const addonToggleResponse = await fetch(`${server.baseUrl}/api/v1/addons/toggle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ addonId: "runtime-addon", enabled: false }),
      });
      expect(addonToggleResponse.status).toBe(204);

      const startupAddonsResponse = await fetch(
        `${server.baseUrl}/api/v1/addons/enabled-on-startup`,
      );
      expect(startupAddonsResponse.status).toBe(200);
      await expect(startupAddonsResponse.json()).resolves.toEqual([]);

      const addonZipData = addonZip({
        "manifest.json": JSON.stringify({
          id: "runtime-zip-addon",
          name: "Runtime ZIP Addon",
          version: "1.0.0",
          main: "main.js",
        }),
        "main.js": "ctx.api.portfolio.getHoldings();",
      });
      const addonExtractResponse = await fetch(`${server.baseUrl}/api/v1/addons/extract`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ zipData: Array.from(addonZipData) }),
      });
      expect(addonExtractResponse.status).toBe(200);
      await expect(addonExtractResponse.json()).resolves.toMatchObject({
        metadata: {
          id: "runtime-zip-addon",
          permissions: [
            {
              category: "portfolio",
              functions: [expect.objectContaining({ name: "getHoldings", isDetected: true })],
            },
          ],
        },
        files: [
          expect.objectContaining({ name: "manifest.json", isMain: false }),
          expect.objectContaining({ name: "main.js", isMain: true }),
        ],
      });

      const addonInstallResponse = await fetch(`${server.baseUrl}/api/v1/addons/install-zip`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ zipData: Array.from(addonZipData), enableAfterInstall: true }),
      });
      expect(addonInstallResponse.status).toBe(200);
      await expect(addonInstallResponse.json()).resolves.toMatchObject({
        id: "runtime-zip-addon",
        enabled: true,
        source: "local",
        installedAt: expect.any(String),
      });
      const installedRuntimeZipAddonResponse = await fetch(
        `${server.baseUrl}/api/v1/addons/runtime/runtime-zip-addon`,
      );
      expect(installedRuntimeZipAddonResponse.status).toBe(200);
      await expect(installedRuntimeZipAddonResponse.json()).resolves.toMatchObject({
        metadata: { id: "runtime-zip-addon" },
        files: [expect.objectContaining({ name: "main.js", isMain: true })],
      });

      const appInfoResponse = await fetch(`${server.baseUrl}/api/v1/app/info`);
      expect(appInfoResponse.status).toBe(200);
      await expect(appInfoResponse.json()).resolves.toMatchObject({
        dbPath: path.join(appDataDir, "app.db"),
        logsDir: path.join(appDataDir, "logs"),
        version: "3.4.0",
      });

      const alternativeAssetCreateResponse = await fetch(
        `${server.baseUrl}/api/v1/alternative-assets`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "property",
            name: "Cabin",
            currency: "USD",
            currentValue: "125000.00",
            valueDate: "2026-05-14",
            purchasePrice: "100000.00",
            purchaseDate: "2024-01-01",
            metadata: { sub_type: "vacation_home" },
          }),
        },
      );
      expect(alternativeAssetCreateResponse.status).toBe(200);
      const alternativeAsset = (await alternativeAssetCreateResponse.json()) as {
        assetId: string;
        quoteId: string;
      };
      expect(typeof alternativeAsset.assetId).toBe("string");
      expect(typeof alternativeAsset.quoteId).toBe("string");

      const alternativeHoldingsResponse = await fetch(
        `${server.baseUrl}/api/v1/alternative-holdings`,
      );
      expect(alternativeHoldingsResponse.status).toBe(200);
      await expect(alternativeHoldingsResponse.json()).resolves.toEqual([
        expect.objectContaining({
          id: alternativeAsset.assetId,
          kind: "property",
          name: "Cabin",
          symbol: "Vacation Home",
          currency: "USD",
          marketValue: "125000",
          purchasePrice: "100000.00",
          unrealizedGain: "25000",
          unrealizedGainPct: "0.25",
        }),
      ]);

      const assetsResponse = await fetch(`${server.baseUrl}/api/v1/assets`);
      expect(assetsResponse.status).toBe(200);
      await expect(assetsResponse.json()).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: alternativeAsset.assetId,
            kind: "PROPERTY",
            quoteMode: "MANUAL",
            exchangeName: null,
          }),
        ]),
      );

      const assetProfileResponse = await fetch(
        `${server.baseUrl}/api/v1/assets/profile?assetId=${alternativeAsset.assetId}`,
      );
      expect(assetProfileResponse.status).toBe(200);
      await expect(assetProfileResponse.json()).resolves.toMatchObject({
        id: alternativeAsset.assetId,
        displayCode: "Vacation Home",
      });

      const quoteModeResponse = await fetch(
        `${server.baseUrl}/api/v1/assets/pricing-mode/${alternativeAsset.assetId}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ quoteMode: "MANUAL" }),
        },
      );
      expect(quoteModeResponse.status).toBe(200);
      await expect(quoteModeResponse.json()).resolves.toMatchObject({
        id: alternativeAsset.assetId,
        quoteMode: "MANUAL",
      });

      const assetDeleteResponse = await fetch(
        `${server.baseUrl}/api/v1/assets/${alternativeAsset.assetId}`,
        { method: "DELETE" },
      );
      expect(assetDeleteResponse.status).toBe(204);

      const assetCreateResponse = await fetch(`${server.baseUrl}/api/v1/assets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "INVESTMENT",
          quoteMode: "MARKET",
          quoteCcy: "",
          instrumentType: "EQUITY",
          instrumentSymbol: "SHOP.TO",
          name: "Shopify",
        }),
      });
      expect(assetCreateResponse.status).toBe(200);
      const createdAsset = (await assetCreateResponse.json()) as { id: string };
      expect(createdAsset).toMatchObject({
        displayCode: "SHOP",
        quoteCcy: "CAD",
        instrumentExchangeMic: "XTSE",
        exchangeName: "TSX",
      });

      const assetProfileUpdateResponse = await fetch(
        `${server.baseUrl}/api/v1/assets/profile/${createdAsset.id}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ notes: "runtime note" }),
        },
      );
      expect(assetProfileUpdateResponse.status).toBe(200);
      await expect(assetProfileUpdateResponse.json()).resolves.toMatchObject({
        id: createdAsset.id,
        name: "Shopify",
        quoteMode: "MARKET",
        notes: "runtime note",
      });

      const exchangesResponse = await fetch(`${server.baseUrl}/api/v1/exchanges`);
      expect(exchangesResponse.status).toBe(200);
      await expect(exchangesResponse.json()).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ mic: "XTSE", name: "TSX", currency: "CAD" }),
        ]),
      );

      const updateQuoteResponse = await fetch(
        `${server.baseUrl}/api/v1/market-data/quotes/${createdAsset.id}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: "provider-quote",
            timestamp: "2026-05-14T16:00:00Z",
            dataSource: "MANUAL",
            close: 42.5,
            currency: "CAD",
          }),
        },
      );
      expect(updateQuoteResponse.status).toBe(204);
      const manualQuoteId = `${createdAsset.id}_2026-05-14_MANUAL`;
      const quoteHistoryResponse = await fetch(
        `${server.baseUrl}/api/v1/market-data/quotes/history?symbol=${createdAsset.id}`,
      );
      expect(quoteHistoryResponse.status).toBe(200);
      await expect(quoteHistoryResponse.json()).resolves.toEqual([
        expect.objectContaining({
          id: manualQuoteId,
          assetId: createdAsset.id,
          dataSource: "MANUAL",
          close: 42.5,
          currency: "CAD",
        }),
      ]);
      const latestQuotesResponse = await fetch(
        `${server.baseUrl}/api/v1/market-data/quotes/latest`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ assetIds: [createdAsset.id] }),
        },
      );
      expect(latestQuotesResponse.status).toBe(200);
      await expect(latestQuotesResponse.json()).resolves.toMatchObject({
        [createdAsset.id]: {
          quote: {
            id: manualQuoteId,
            assetId: createdAsset.id,
            dataSource: "MANUAL",
            close: 42.5,
            currency: "CAD",
          },
          quoteDate: "2026-05-14",
        },
      });
      const checkQuotesResponse = await fetch(`${server.baseUrl}/api/v1/market-data/quotes/check`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: Array.from(
            new TextEncoder().encode("symbol,date,close,currency\nSHOP.TO,2026-05-15,43.5,CAD"),
          ),
          hasHeaderRow: true,
        }),
      });
      expect(checkQuotesResponse.status).toBe(200);
      const checkedQuotes = (await checkQuotesResponse.json()) as unknown[];
      expect(checkedQuotes).toEqual([
        expect.objectContaining({
          symbol: createdAsset.id,
          displaySymbol: "SHOP",
          validationStatus: "valid",
        }),
      ]);
      const importQuotesResponse = await fetch(
        `${server.baseUrl}/api/v1/market-data/quotes/import`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ quotes: checkedQuotes, overwriteExisting: true }),
        },
      );
      expect(importQuotesResponse.status).toBe(200);
      await expect(importQuotesResponse.json()).resolves.toEqual([
        expect.objectContaining({ symbol: createdAsset.id, validationStatus: "valid" }),
      ]);
      const importedQuoteId = `${createdAsset.id}_2026-05-15_MANUAL`;
      const importedQuoteHistoryResponse = await fetch(
        `${server.baseUrl}/api/v1/market-data/quotes/history?symbol=${createdAsset.id}`,
      );
      expect(importedQuoteHistoryResponse.status).toBe(200);
      await expect(importedQuoteHistoryResponse.json()).resolves.toEqual([
        expect.objectContaining({
          id: importedQuoteId,
          close: 43.5,
          currency: "CAD",
        }),
        expect.objectContaining({ id: manualQuoteId }),
      ]);
      const searchResponse = await fetch(`${server.baseUrl}/api/v1/market-data/search?query=SHOP`);
      expect(searchResponse.status).toBe(200);
      await expect(searchResponse.json()).resolves.toEqual([
        expect.objectContaining({
          symbol: "SHOP",
          isExisting: true,
          existingAssetId: createdAsset.id,
          dataSource: "MANUAL",
        }),
      ]);
      const marketHistorySyncResponse = await fetch(
        `${server.baseUrl}/api/v1/market-data/sync/history`,
        { method: "POST" },
      );
      expect(marketHistorySyncResponse.status).toBe(204);
      const marketSyncResponse = await fetch(`${server.baseUrl}/api/v1/market-data/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refetchAll: false }),
      });
      expect(marketSyncResponse.status).toBe(204);
      const emptyTargetMarketSyncResponse = await fetch(
        `${server.baseUrl}/api/v1/market-data/sync`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ assetIds: [], refetchAll: false }),
        },
      );
      expect(emptyTargetMarketSyncResponse.status).toBe(204);
      const deleteQuoteResponse = await fetch(
        `${server.baseUrl}/api/v1/market-data/quotes/id/${encodeURIComponent(manualQuoteId)}`,
        { method: "DELETE" },
      );
      expect(deleteQuoteResponse.status).toBe(204);

      const secretSetResponse = await fetch(`${server.baseUrl}/api/v1/secrets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secretKey: "Provider/ApiKey", secret: "secret-value" }),
      });
      expect(secretSetResponse.status).toBe(204);
      const secretGetResponse = await fetch(
        `${server.baseUrl}/api/v1/secrets?secretKey=provider%2Fapikey`,
      );
      expect(secretGetResponse.status).toBe(200);
      await expect(secretGetResponse.json()).resolves.toBe("secret-value");

      const rootKeyResponse = await fetch(
        `${server.baseUrl}/api/v1/sync/crypto/generate-root-key`,
        { method: "POST" },
      );
      expect(rootKeyResponse.status).toBe(200);
      const rootKey = (await rootKeyResponse.json()) as { value: string };
      expect(Buffer.from(rootKey.value, "base64").byteLength).toBe(32);

      const classificationMigrationResponse = await fetch(
        `${server.baseUrl}/api/v1/taxonomies/migration/status`,
      );
      expect(classificationMigrationResponse.status).toBe(200);
      await expect(classificationMigrationResponse.json()).resolves.toEqual({
        needed: false,
        assetsWithLegacyData: 0,
        assetsAlreadyMigrated: 0,
      });

      const backupDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-backup-"));
      const backupResponse = await fetch(
        `${server.baseUrl}/api/v1/utilities/database/backup-to-path`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ backupDir }),
        },
      );
      expect(backupResponse.status).toBe(200);
      const backup = (await backupResponse.json()) as { path: string };

      const mutateAfterBackupResponse = await fetch(`${server.baseUrl}/api/v1/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseCurrency: "CAD", timezone: "UTC" }),
      });
      expect(mutateAfterBackupResponse.status).toBe(200);

      const restoreResponse = await fetch(`${server.baseUrl}/api/v1/utilities/database/restore`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ backupFilePath: `file://${backup.path}` }),
      });
      expect(restoreResponse.status).toBe(204);

      const readyAfterRestoreResponse = await fetch(`${server.baseUrl}/api/v1/readyz`);
      expect(readyAfterRestoreResponse.status).toBe(503);
      const settingsAfterRestoreResponse = await fetch(`${server.baseUrl}/api/v1/settings`);
      expect(settingsAfterRestoreResponse.status).toBe(503);
    } finally {
      server.stop();
      await runtime.close();
    }

    await expect(runtime.close()).resolves.toBeUndefined();
    const restoredDb = openSqliteDatabase(path.join(appDataDir, "app.db"));
    try {
      expect(
        restoredDb
          .query<
            { setting_value: string },
            []
          >("SELECT setting_value FROM app_settings WHERE setting_key = 'base_currency'")
          .get()?.setting_value,
      ).toBe("USD");
    } finally {
      restoredDb.close();
    }
  });

  test("surfaces runtime data consistency health issues from SQLite state", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-health-consistency-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const db = openSqliteDatabase(runtime.dbPath);
    try {
      seedRuntimeNegativePositionHealthInput(db);
    } finally {
      db.close();
    }
    const server = startBackendServer(config, runtime.options);

    try {
      const response = await fetch(`${server.baseUrl}/api/v1/health/check`, {
        method: "POST",
        headers: { "x-client-timezone": "UTC" },
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        overallSeverity: "WARNING",
        issueCounts: { WARNING: 1 },
        issues: [
          expect.objectContaining({
            id: expect.stringMatching(/^negative_position:/),
            category: "DATA_CONSISTENCY",
            title: "Holding has negative quantity",
            affectedCount: 1,
            navigateAction: {
              route: "/holdings",
              query: { filter: "negative" },
              label: "View Holdings",
            },
          }),
        ],
      });
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("surfaces runtime orphan activity health issues from SQLite state", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-health-orphans-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const db = openSqliteDatabase(runtime.dbPath);
    try {
      seedRuntimeOrphanActivityHealthInput(db);
    } finally {
      db.close();
    }
    const server = startBackendServer(config, runtime.options);

    try {
      const response = await fetch(`${server.baseUrl}/api/v1/health/check`, {
        method: "POST",
        headers: { "x-client-timezone": "UTC" },
      });
      expect(response.status).toBe(200);
      const status = (await response.json()) as { issues: Array<{ id: string; title: string }> };
      expect(status.issues).toEqual([
        expect.objectContaining({
          id: expect.stringMatching(/^orphan_activity_account:/),
          title: "Transaction references missing account",
        }),
        expect.objectContaining({
          id: expect.stringMatching(/^orphan_activity_asset:/),
          title: "Transaction references missing asset",
        }),
      ]);
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("surfaces runtime negative balance health issues from valuations", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-health-balances-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const db = openSqliteDatabase(runtime.dbPath);
    try {
      seedRuntimeNegativeBalanceHealthInput(db);
    } finally {
      db.close();
    }
    const server = startBackendServer(config, runtime.options);

    try {
      const response = await fetch(`${server.baseUrl}/api/v1/health/check`, {
        method: "POST",
        headers: { "x-client-timezone": "UTC" },
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        overallSeverity: "WARNING",
        issueCounts: { INFO: 1, WARNING: 1 },
        issues: [
          expect.objectContaining({
            id: expect.stringMatching(/^negative_account_balance:/),
            title: "Account has negative portfolio balance",
            affectedItems: [
              expect.objectContaining({ id: "negative-investment", name: "Negative Investment" }),
            ],
          }),
          expect.objectContaining({
            id: expect.stringMatching(/^negative_cash_balance:/),
            title: "Cash account had a negative balance",
            affectedItems: [
              expect.objectContaining({ id: "negative-cash", name: "Negative Cash" }),
            ],
          }),
        ],
      });
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("surfaces runtime quote sync health issues from sync state", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-health-quote-sync-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const db = openSqliteDatabase(runtime.dbPath);
    try {
      seedRuntimeQuoteSyncHealthInput(db);
    } finally {
      db.close();
    }
    const server = startBackendServer(config, runtime.options);

    try {
      const response = await fetch(`${server.baseUrl}/api/v1/health/check`, {
        method: "POST",
        headers: { "x-client-timezone": "UTC" },
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        overallSeverity: "ERROR",
        issueCounts: { ERROR: 1 },
        issues: [
          expect.objectContaining({
            id: expect.stringMatching(/^quote_sync:error:/),
            category: "PRICE_STALENESS",
            title: "Quotes sync failing for RUNTIME",
            affectedCount: 1,
            fixAction: { id: "retry_sync", label: "Retry Sync", payload: ["quote-sync-asset"] },
          }),
        ],
      });
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("surfaces runtime FX integrity health issues from holdings", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-health-fx-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const db = openSqliteDatabase(runtime.dbPath);
    try {
      seedRuntimeFxIntegrityHealthInput(db);
    } finally {
      db.close();
    }
    const server = startBackendServer(config, runtime.options);

    try {
      const response = await fetch(`${server.baseUrl}/api/v1/health/check`, {
        method: "POST",
        headers: { "x-client-timezone": "UTC" },
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        overallSeverity: "CRITICAL",
        issueCounts: { CRITICAL: 1 },
        issues: [
          expect.objectContaining({
            id: expect.stringMatching(/^fx_missing:/),
            category: "FX_INTEGRITY",
            title: "Missing exchange rate for EUR",
            affectedCount: 1,
            fixAction: { id: "fetch_fx", label: "Fetch Exchange Rates", payload: ["EUR:USD"] },
          }),
        ],
      });
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime database backup list download and delete routes", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-backup-routes-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      const backupResponse = await fetch(`${server.baseUrl}/api/v1/utilities/database/backup`, {
        method: "POST",
      });
      expect(backupResponse.status).toBe(200);
      const backup = (await backupResponse.json()) as { filename: string; dataB64: string };
      expect(backup.filename).toMatch(/^wealthfolio_backup_\d{8}_\d{6}\.db$/);
      expect(Buffer.from(backup.dataB64, "base64").byteLength).toBeGreaterThan(0);

      const listResponse = await fetch(`${server.baseUrl}/api/v1/utilities/database/backups`);
      expect(listResponse.status).toBe(200);
      await expect(listResponse.json()).resolves.toEqual([
        expect.objectContaining({
          filename: backup.filename,
          sizeBytes: expect.any(Number),
          modifiedAt: expect.stringMatching(/\+00:00$/),
        }),
      ]);

      const downloadResponse = await fetch(
        `${server.baseUrl}/api/v1/utilities/database/backups/${encodeURIComponent(backup.filename)}/download`,
      );
      expect(downloadResponse.status).toBe(200);
      expect(downloadResponse.headers.get("content-disposition")).toBe(
        `attachment; filename="${backup.filename}"`,
      );
      expect(Buffer.from(await downloadResponse.arrayBuffer()).toString("base64")).toBe(
        backup.dataB64,
      );

      const deleteResponse = await fetch(
        `${server.baseUrl}/api/v1/utilities/database/backups/${encodeURIComponent(backup.filename)}`,
        { method: "DELETE" },
      );
      expect(deleteResponse.status).toBe(204);
      const emptyListResponse = await fetch(`${server.baseUrl}/api/v1/utilities/database/backups`);
      expect(emptyListResponse.status).toBe(200);
      await expect(emptyListResponse.json()).resolves.toEqual([]);
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime settings timezone updates to portfolio job execution", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-settings-events-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);
    const events: string[] = [];
    const portfolioJobConfigs: PortfolioJobConfig[] = [];
    const originalPortfolioJobService = runtime.options.portfolioJobService;
    if (!originalPortfolioJobService) {
      throw new Error("Runtime settings timezone route test requires portfolio job service");
    }
    runtime.options.portfolioJobService = {
      enqueuePortfolioJob(jobConfig) {
        portfolioJobConfigs.push(jobConfig);
        return originalPortfolioJobService.enqueuePortfolioJob(jobConfig);
      },
    };
    const unsubscribe = runtime.options.eventBus?.subscribe((event) => {
      events.push(event.name);
    });

    try {
      const response = await fetch(`${server.baseUrl}/api/v1/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ timezone: "UTC" }),
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ timezone: "UTC" });
      await waitForEventCount(events, "portfolio:update-complete", 1);
      expect(portfolioJobConfigs).toEqual([
        {
          accountIds: null,
          marketSyncMode: { type: "none" },
          snapshotMode: "full",
          valuationMode: "full",
          sinceDate: null,
        },
      ]);
      expect(events).toEqual(["portfolio:update-start", "portfolio:update-complete"]);
    } finally {
      unsubscribe?.();
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime settings base-currency updates to full portfolio job execution", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-settings-base-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);
    const events: string[] = [];
    const portfolioJobConfigs: PortfolioJobConfig[] = [];
    const originalPortfolioJobService = runtime.options.portfolioJobService;
    if (!originalPortfolioJobService) {
      throw new Error("Runtime settings base-currency route test requires portfolio job service");
    }
    runtime.options.portfolioJobService = {
      enqueuePortfolioJob(jobConfig) {
        portfolioJobConfigs.push(jobConfig);
        return originalPortfolioJobService.enqueuePortfolioJob(jobConfig);
      },
    };
    const unsubscribe = runtime.options.eventBus?.subscribe((event) => {
      events.push(event.name);
    });

    try {
      const response = await fetch(`${server.baseUrl}/api/v1/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseCurrency: "USD" }),
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ baseCurrency: "USD" });
      await waitForEventCount(events, "portfolio:update-complete", 1);
      expect(portfolioJobConfigs).toEqual([
        {
          accountIds: null,
          marketSyncMode: { type: "backfill_history", asset_ids: null, days: 1825 },
          snapshotMode: "full",
          valuationMode: "full",
          sinceDate: null,
        },
      ]);
      expect(events).toEqual([
        "market:sync-start",
        "market:sync-complete",
        "portfolio:update-start",
        "portfolio:update-complete",
      ]);
    } finally {
      unsubscribe?.();
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime provider settings routes to SQLite persistence", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-provider-settings-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      const providersResponse = await fetch(`${server.baseUrl}/api/v1/providers/settings`);
      expect(providersResponse.status).toBe(200);
      await expect(providersResponse.json()).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "FINNHUB", enabled: expect.any(Boolean) }),
        ]),
      );

      const updateResponse = await fetch(`${server.baseUrl}/api/v1/providers/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerId: "FINNHUB", priority: 0, enabled: true }),
      });
      expect(updateResponse.status).toBe(204);

      const updatedResponse = await fetch(`${server.baseUrl}/api/v1/providers`);
      expect(updatedResponse.status).toBe(200);
      const updatedProviders = (await updatedResponse.json()) as Array<Record<string, unknown>>;
      expect(updatedProviders[0]).toMatchObject({ id: "FINNHUB", priority: 0, enabled: true });
      expect(updatedProviders).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "FINNHUB", priority: 0, enabled: true }),
        ]),
      );

      const db = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          db
            .query<
              { priority: number; enabled: number },
              []
            >("SELECT priority, enabled FROM market_data_providers WHERE id = 'FINNHUB'")
            .get(),
        ).toEqual({ priority: 0, enabled: 1 });
      } finally {
        db.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime AI provider settings routes to SQLite persistence", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-ai-provider-routes-"));
    const modelRequests: Array<{ url: string; headers?: HeadersInit }> = [];
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      aiProviderFetchModels: async (url, init) => {
        modelRequests.push({ url, headers: init?.headers });
        if (url.includes("openai")) {
          return Response.json({ data: [{ id: "runtime-gpt" }] });
        }
        return Response.json({ models: [{ name: "runtime-model" }] });
      },
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      const providersResponse = await fetch(`${server.baseUrl}/api/v1/ai/providers`);
      expect(providersResponse.status).toBe(200);
      const providers = (await providersResponse.json()) as {
        providers: Array<Record<string, unknown>>;
      };
      expect(providers.providers.find((provider) => provider.id === "ollama")).toMatchObject({
        id: "ollama",
        defaultModel: "gemma4:e4b",
      });

      const updateResponse = await fetch(`${server.baseUrl}/api/v1/ai/providers/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerId: "ollama",
          enabled: true,
          favorite: true,
          selectedModel: "qwen3.5:9b",
          priority: 1,
          favoriteModels: ["qwen3.5:9b"],
          toolsAllowlist: ["get_accounts"],
        }),
      });
      expect(updateResponse.status).toBe(200);
      await expect(updateResponse.json()).resolves.toBeNull();

      const defaultResponse = await fetch(`${server.baseUrl}/api/v1/ai/providers/default`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerId: "ollama" }),
      });
      expect(defaultResponse.status).toBe(200);
      await expect(defaultResponse.json()).resolves.toBeNull();

      const updatedResponse = await fetch(`${server.baseUrl}/api/v1/ai/providers`);
      expect(updatedResponse.status).toBe(200);
      const updatedProviders = (await updatedResponse.json()) as {
        defaultProvider: string;
        providers: Array<Record<string, unknown>>;
      };
      expect(updatedProviders.defaultProvider).toBe("ollama");
      expect(updatedProviders.providers.find((provider) => provider.id === "ollama")).toMatchObject(
        {
          id: "ollama",
          enabled: true,
          favorite: true,
          selectedModel: "qwen3.5:9b",
          priority: 1,
          favoriteModels: ["qwen3.5:9b"],
          toolsAllowlist: ["get_accounts", "get_cash_balances"],
        },
      );

      const modelsResponse = await fetch(`${server.baseUrl}/api/v1/ai/providers/ollama/models`);
      expect(modelsResponse.status).toBe(200);
      await expect(modelsResponse.json()).resolves.toEqual({
        models: [{ id: "runtime-model", name: "runtime-model" }],
        supportsListing: true,
      });
      expect(modelRequests[0]).toMatchObject({ url: "http://localhost:11434/api/tags" });

      const secretResponse = await fetch(`${server.baseUrl}/api/v1/secrets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secretKey: "ai_openai", secret: "openai-key" }),
      });
      expect(secretResponse.status).toBe(204);

      const openAiModelsResponse = await fetch(
        `${server.baseUrl}/api/v1/ai/providers/openai/models`,
      );
      expect(openAiModelsResponse.status).toBe(200);
      await expect(openAiModelsResponse.json()).resolves.toEqual({
        models: [{ id: "runtime-gpt", name: "runtime-gpt" }],
        supportsListing: true,
      });
      expect(modelRequests[1]).toMatchObject({
        url: "https://api.openai.com/v1/models",
        headers: { Authorization: "Bearer openai-key" },
      });

      const db = openSqliteDatabase(runtime.dbPath);
      try {
        const stored = db
          .query<
            { setting_value: string },
            []
          >("SELECT setting_value FROM app_settings WHERE setting_key = 'ai_provider_settings'")
          .get();
        expect(JSON.parse(String(stored?.setting_value))).toMatchObject({
          defaultProvider: "ollama",
          providers: {
            ollama: {
              enabled: true,
              favorite: true,
              selectedModel: "qwen3.5:9b",
              priority: 1,
              favoriteModels: ["qwen3.5:9b"],
              toolsAllowlist: ["get_accounts", "get_cash_balances"],
            },
          },
        });
      } finally {
        db.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("registers an FX asset when creating a non-base account in runtime", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-account-fx-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      marketDataFetch: (() =>
        Promise.reject(new Error("unexpected market data fetch"))) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      const settingsResponse = await fetch(`${server.baseUrl}/api/v1/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseCurrency: "USD", timezone: "UTC" }),
      });
      expect(settingsResponse.status).toBe(200);

      const accountResponse = await fetch(`${server.baseUrl}/api/v1/accounts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "CAD Brokerage",
          accountType: "SECURITIES",
          currency: "CAD",
          isDefault: false,
          isActive: true,
        }),
      });
      expect(accountResponse.status).toBe(200);
      await expect(accountResponse.json()).resolves.toMatchObject({ currency: "CAD" });

      const accountExportResponse = await fetch(
        `${server.baseUrl}/api/v1/utilities/export/accounts/json`,
      );
      expect(accountExportResponse.status).toBe(200);
      expect(accountExportResponse.headers.get("content-type")).toBe(
        "application/json; charset=utf-8",
      );
      await expect(accountExportResponse.json()).resolves.toEqual([
        expect.objectContaining({ name: "CAD Brokerage", currency: "CAD" }),
      ]);

      const db = openSqliteDatabase(runtime.dbPath);
      try {
        const fxAsset = db
          .query<
            {
              kind: string;
              display_code: string;
              quote_ccy: string;
              instrument_type: string | null;
              instrument_symbol: string | null;
            },
            []
          >(
            `
              SELECT kind, display_code, quote_ccy, instrument_type, instrument_symbol
              FROM assets
              WHERE instrument_key = 'FX:CAD/USD'
            `,
          )
          .get();
        expect(fxAsset).toEqual({
          kind: "FX",
          display_code: "CAD/USD",
          quote_ccy: "USD",
          instrument_type: "FX",
          instrument_symbol: "CAD",
        });
      } finally {
        db.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("exports runtime activities through SQLite-backed data export route", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-activity-export-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      marketDataFetch: (() =>
        Promise.reject(new Error("unexpected market data fetch"))) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    try {
      const db = openSqliteDatabase(runtime.dbPath);
      try {
        seedRuntimeTransactionActivityInput(db);
      } finally {
        db.close();
      }
      const server = startBackendServer(config, runtime.options);
      try {
        const activityExportResponse = await fetch(
          `${server.baseUrl}/api/v1/utilities/export/activities/json`,
        );
        expect(activityExportResponse.status).toBe(200);
        expect(activityExportResponse.headers.get("content-type")).toBe(
          "application/json; charset=utf-8",
        );
        await expect(activityExportResponse.json()).resolves.toEqual([
          expect.objectContaining({ id: "tx-buy", activityType: "BUY" }),
          expect.objectContaining({ id: "tx-deposit", activityType: "DEPOSIT" }),
        ]);
      } finally {
        server.stop();
      }
    } finally {
      await runtime.close();
    }
  });

  test("exports runtime portfolio history through SQLite-backed data export route", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-history-export-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      marketDataFetch: (() =>
        Promise.reject(new Error("unexpected market data fetch"))) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    try {
      const db = openSqliteDatabase(runtime.dbPath);
      try {
        seedRuntimeValuation(db, {
          accountId: "TOTAL",
          date: "2026-05-14",
          totalValue: "1234.56",
          fxRateToBase: "1",
        });
      } finally {
        db.close();
      }
      const server = startBackendServer(config, runtime.options);
      try {
        const historyExportResponse = await fetch(
          `${server.baseUrl}/api/v1/utilities/export/portfolio-history/json`,
        );
        expect(historyExportResponse.status).toBe(200);
        expect(historyExportResponse.headers.get("content-type")).toBe(
          "application/json; charset=utf-8",
        );
        await expect(historyExportResponse.json()).resolves.toEqual([
          expect.objectContaining({
            accountId: "TOTAL",
            valuationDate: "2026-05-14",
            totalValue: 1234.56,
          }),
        ]);
      } finally {
        server.stop();
      }
    } finally {
      await runtime.close();
    }
  });

  test("exports runtime goals through SQLite-backed data export route", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-goal-export-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      marketDataFetch: (() =>
        Promise.reject(new Error("unexpected market data fetch"))) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const { goalService } = runtime.options;
    if (!goalService) {
      await runtime.close();
      throw new Error("Runtime goal export test requires goal service");
    }
    const server = startBackendServer(config, runtime.options);

    try {
      const goal = await goalService.createGoal({
        goalType: "custom_save_up",
        title: "Runtime Export Goal",
        targetAmount: 5000,
        currency: "USD",
      });

      const goalExportResponse = await fetch(
        `${server.baseUrl}/api/v1/utilities/export/goals/json`,
      );
      expect(goalExportResponse.status).toBe(200);
      expect(goalExportResponse.headers.get("content-type")).toBe(
        "application/json; charset=utf-8",
      );
      await expect(goalExportResponse.json()).resolves.toEqual([
        expect.objectContaining({
          id: goal.id,
          title: "Runtime Export Goal",
          targetAmount: 5000,
        }),
      ]);
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires local Connect runtime behavior with disabled cloud routes", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-connect-disabled-"));
    const publicPlanRequests: string[] = [];
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      env: { CONNECT_API_URL: "https://api.example.test" },
      marketDataFetch: (async (input) => {
        publicPlanRequests.push(String(input));
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        if (String(input).endsWith("/api/v1/sync/brokerage/connections")) {
          return Response.json({
            connections: [
              { id: "connection-1", brokerage_name: "Brokerage", brokerage_slug: "brokerage" },
            ],
          });
        }
        if (String(input).endsWith("/api/v1/sync/brokerage/accounts")) {
          return Response.json({
            accounts: [
              {
                id: "broker-account-1",
                name: "Broker Account",
                type: "TFSA",
                currency: "CAD",
                brokerage_authorization: "brokerage",
                institution_name: "Brokerage",
              },
            ],
          });
        }
        if (String(input).endsWith("/api/v1/user/me")) {
          return Response.json({
            id: "user-1",
            email: "user@example.test",
            team: {
              id: "team-1",
              name: "Team",
              plan: "pro",
              subscriptionStatus: "active",
            },
          });
        }
        return Response.json({ plans: [connectSubscriptionPlan("free")] });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const db = openSqliteDatabase(runtime.dbPath);
    try {
      seedRuntimeConnectData(db);
    } finally {
      db.close();
    }
    const server = startBackendServer(config, runtime.options);
    const brokerSyncEvents: unknown[] = [];
    const unsubscribe = runtime.options.eventBus?.subscribe((event) => {
      if (event.name.startsWith("broker:sync")) {
        brokerSyncEvents.push(event);
      }
    });

    try {
      const publicPlansResponse = await fetch(`${server.baseUrl}/api/v1/connect/plans/public`);
      expect(publicPlansResponse.status).toBe(200);
      await expect(publicPlansResponse.json()).resolves.toEqual({
        plans: [connectSubscriptionPlan("free")],
      });
      expect(publicPlanRequests).toEqual(["https://api.example.test/api/v1/subscription/plans"]);
      publicPlanRequests.length = 0;

      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const syncConnectionsResponse = await fetch(
        `${server.baseUrl}/api/v1/connect/sync/connections`,
        { method: "POST" },
      );
      expect(syncConnectionsResponse.status).toBe(200);
      await expect(syncConnectionsResponse.json()).resolves.toEqual({
        synced: 1,
        platformsCreated: 1,
        platformsUpdated: 0,
      });

      const connectionsResponse = await fetch(`${server.baseUrl}/api/v1/connect/connections`);
      expect(connectionsResponse.status).toBe(200);
      await expect(connectionsResponse.json()).resolves.toEqual([
        expect.objectContaining({
          id: "connection-1",
          brokerage: expect.objectContaining({ name: "Brokerage" }),
        }),
      ]);

      const brokerAccountsResponse = await fetch(`${server.baseUrl}/api/v1/connect/accounts`);
      expect(brokerAccountsResponse.status).toBe(200);
      await expect(brokerAccountsResponse.json()).resolves.toEqual([
        {
          id: "broker-account-1",
          name: "Broker Account",
          type: "TFSA",
          currency: "CAD",
          brokerage_authorization: "brokerage",
          institution_name: "Brokerage",
        },
      ]);

      const syncAccountsResponse = await fetch(`${server.baseUrl}/api/v1/connect/sync/accounts`, {
        method: "POST",
      });
      expect(syncAccountsResponse.status).toBe(200);
      await expect(syncAccountsResponse.json()).resolves.toMatchObject({
        synced: 1,
        created: 1,
        updated: 0,
        skipped: 0,
        createdAccounts: [expect.arrayContaining([expect.any(String), "CAD"])],
        newAccountsInfo: [
          expect.objectContaining({
            providerAccountId: "broker-account-1",
            defaultName: "Broker Account",
            currency: "CAD",
          }),
        ],
      });
      const syncOutboxDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          readRuntimeSyncOutbox(syncOutboxDb).filter(
            (row) => row.entity === "platform" || row.entity === "account",
          ),
        ).toEqual([]);
      } finally {
        syncOutboxDb.close();
      }

      const authenticatedPlansResponse = await fetch(`${server.baseUrl}/api/v1/connect/plans`);
      expect(authenticatedPlansResponse.status).toBe(200);
      await expect(authenticatedPlansResponse.json()).resolves.toEqual({
        plans: [connectSubscriptionPlan("free")],
      });

      const userInfoResponse = await fetch(`${server.baseUrl}/api/v1/connect/user`);
      expect(userInfoResponse.status).toBe(200);
      await expect(userInfoResponse.json()).resolves.toMatchObject({
        id: "user-1",
        email: "user@example.test",
      });
      expect(publicPlanRequests).toEqual([
        "https://auth.wealthfolio.app/auth/v1/token?grant_type=refresh_token",
        "https://api.example.test/api/v1/sync/brokerage/connections",
        "https://auth.wealthfolio.app/auth/v1/token?grant_type=refresh_token",
        "https://api.example.test/api/v1/sync/brokerage/connections",
        "https://auth.wealthfolio.app/auth/v1/token?grant_type=refresh_token",
        "https://api.example.test/api/v1/sync/brokerage/accounts",
        "https://auth.wealthfolio.app/auth/v1/token?grant_type=refresh_token",
        "https://api.example.test/api/v1/sync/brokerage/accounts",
        "https://auth.wealthfolio.app/auth/v1/token?grant_type=refresh_token",
        "https://api.example.test/api/v1/subscription/plans",
        "https://auth.wealthfolio.app/auth/v1/token?grant_type=refresh_token",
        "https://api.example.test/api/v1/user/me",
      ]);

      const syncResponse = await fetch(`${server.baseUrl}/api/v1/connect/sync`, {
        method: "POST",
      });
      expect(syncResponse.status).toBe(202);
      expect(brokerSyncEvents).toEqual([
        { name: "broker:sync-start" },
        {
          name: "broker:sync-complete",
          payload: expect.objectContaining({
            success: true,
            connectionsSynced: expect.objectContaining({ synced: 1 }),
            accountsSynced: expect.objectContaining({ synced: 1 }),
            activitiesSynced: expect.objectContaining({ activitiesUpserted: 0 }),
          }),
        },
      ]);

      const syncActivitiesResponse = await fetch(
        `${server.baseUrl}/api/v1/connect/sync/activities`,
        {
          method: "POST",
        },
      );
      expect(syncActivitiesResponse.status).toBe(200);
      await expect(syncActivitiesResponse.json()).resolves.toEqual({
        accountsSynced: 0,
        activitiesUpserted: 0,
        assetsInserted: 0,
        accountsFailed: 0,
        accountsWarned: 0,
        newAssetIds: [],
      });

      const syncedAccountsResponse = await fetch(
        `${server.baseUrl}/api/v1/connect/synced-accounts`,
      );
      expect(syncedAccountsResponse.status).toBe(200);
      await expect(syncedAccountsResponse.json()).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "connect-account",
            name: "Snap Account",
            platformId: "SNAPTRADE",
            provider: "SNAPTRADE",
            providerAccountId: "provider-account-1",
            trackingMode: "HOLDINGS",
            isActive: true,
            isArchived: false,
          }),
          expect.objectContaining({
            name: "Broker Account",
            platformId: "brokerage",
            provider: "SNAPTRADE",
            providerAccountId: "broker-account-1",
            trackingMode: "HOLDINGS",
          }),
        ]),
      );

      const platformsResponse = await fetch(`${server.baseUrl}/api/v1/connect/platforms`);
      expect(platformsResponse.status).toBe(200);
      await expect(platformsResponse.json()).resolves.toEqual([
        {
          id: "brokerage",
          name: "Brokerage",
          url: "https://brokerage.com",
          externalId: null,
          kind: "BROKERAGE",
          websiteUrl: null,
          logoUrl: null,
        },
        {
          id: "SNAPTRADE",
          name: "SnapTrade",
          url: "https://snaptrade.com",
          externalId: "snaptrade-external",
          kind: "BROKERAGE",
          websiteUrl: "https://snaptrade.com",
          logoUrl: "https://cdn.example/snaptrade.png",
        },
      ]);

      const syncStatesResponse = await fetch(`${server.baseUrl}/api/v1/connect/sync-states`);
      expect(syncStatesResponse.status).toBe(200);
      await expect(syncStatesResponse.json()).resolves.toEqual([
        expect.objectContaining({
          accountId: "connect-account",
          provider: "PLAID",
          checkpointJson: null,
          lastAttemptedAt: null,
          syncStatus: "NEEDS_REVIEW",
          lastError: "mapping required",
          updatedAt: "2026-05-15T10:00:00Z",
        }),
        expect.objectContaining({
          accountId: "connect-account",
          provider: "SNAPTRADE",
          checkpointJson: { lastSyncedDate: "2026-05-14", lookbackDays: 30 },
          lastAttemptedAt: "2026-05-14T09:00:00Z",
          lastSuccessfulAt: "2026-05-14T10:00:00Z",
          syncStatus: "RUNNING",
          lastRunId: "import-run-1",
          updatedAt: "2026-05-14T10:00:00Z",
        }),
      ]);

      const importRunsResponse = await fetch(
        `${server.baseUrl}/api/v1/connect/import-runs?limit=10&offset=0`,
      );
      expect(importRunsResponse.status).toBe(200);
      await expect(importRunsResponse.json()).resolves.toEqual([
        expect.objectContaining({
          id: "import-run-invalid",
          runType: "SYNC",
          mode: "INCREMENTAL",
          status: "RUNNING",
          reviewMode: "NEVER",
          summary: null,
          warnings: null,
          finishedAt: null,
          appliedAt: null,
          startedAt: "2026-05-15T10:00:00Z",
        }),
        expect.objectContaining({
          id: "import-run-1",
          accountId: "connect-account",
          sourceSystem: "SNAPTRADE",
          runType: "SYNC",
          mode: "INCREMENTAL",
          status: "APPLIED",
          reviewMode: "NEVER",
          checkpointIn: { cursor: "in" },
          checkpointOut: { cursor: "out" },
          summary: {
            fetched: 2,
            inserted: 1,
            updated: 0,
            skipped: 1,
            warnings: 0,
            errors: 0,
            removed: 0,
            assetsCreated: 1,
          },
          warnings: ["minor"],
          error: null,
          startedAt: "2026-05-14T09:00:00Z",
          finishedAt: "2026-05-14T10:00:00Z",
        }),
      ]);

      const filteredImportRunsResponse = await fetch(
        `${server.baseUrl}/api/v1/connect/import-runs?runType=SYNC&limit=10&offset=0`,
      );
      expect(filteredImportRunsResponse.status).toBe(200);
      await expect(filteredImportRunsResponse.json()).resolves.toEqual([
        expect.objectContaining({ id: "import-run-1" }),
      ]);

      const emptyRunTypeImportRunsResponse = await fetch(
        `${server.baseUrl}/api/v1/connect/import-runs?runType=&limit=10&offset=0`,
      );
      expect(emptyRunTypeImportRunsResponse.status).toBe(400);
      await expect(emptyRunTypeImportRunsResponse.json()).resolves.toEqual({
        code: 400,
        message: "runType must be SYNC or IMPORT",
      });

      const defaultProfileResponse = await fetch(
        `${server.baseUrl}/api/v1/connect/broker-sync-profile?accountId=acct-1&sourceSystem=snaptrade`,
      );
      expect(defaultProfileResponse.status).toBe(200);
      await expect(defaultProfileResponse.json()).resolves.toEqual({
        id: "",
        name: "",
        scope: "USER",
        sourceSystem: "snaptrade",
        activityMappings: {},
        symbolMappings: {},
        symbolMappingMeta: {},
      });

      const jsonHeaders = { "content-type": "application/json" };
      const saveProfileResponse = await fetch(
        `${server.baseUrl}/api/v1/connect/broker-sync-profile`,
        {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({
            accountId: "acct-1",
            sourceSystem: "snaptrade",
            scope: "ACCOUNT",
            activityRulePatches: { BUY: ["Buy"] },
            securityRulePatches: { AAPL: "AAPL.US" },
            securityRuleMetaPatches: { AAPL: { exchangeMic: "XNAS" } },
          }),
        },
      );
      expect(saveProfileResponse.status).toBe(200);
      await expect(saveProfileResponse.json()).resolves.toMatchObject({
        id: "broker_snaptrade_acct-1",
        name: "snaptrade Profile",
        scope: "USER",
        sourceSystem: "snaptrade",
        activityMappings: { BUY: ["Buy"] },
        symbolMappings: { AAPL: "AAPL.US" },
        symbolMappingMeta: { AAPL: { exchangeMic: "XNAS" } },
      });
    } finally {
      unsubscribe?.();
      server.stop();
      await runtime.close();
    }
  });

  test("wires disabled device sync runtime behavior", async () => {
    const appDataDir = mkdtempSync(
      path.join(tmpdir(), "wealthfolio-runtime-device-sync-disabled-"),
    );
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      const jsonHeaders = { "content-type": "application/json" };
      const jsonRequest = (pathName: string, body: Record<string, unknown>) =>
        new Request(`${server.baseUrl}${pathName}`, {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify(body),
        });
      expect(runtime.options.secretService).toBeDefined();
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey: "root-key",
          keyVersion: 5,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
      );
      await runtime.options.secretService?.setSecret("sync_device_id", "device-runtime");
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.exec(`
          UPDATE sync_cursor SET cursor = 55 WHERE id = 1;
          UPDATE sync_engine_state SET
            lock_version = 8,
            last_error = 'stale',
            consecutive_failures = 2,
            last_cycle_status = 'failed',
            last_cycle_duration_ms = 99
          WHERE id = 1;
          INSERT INTO sync_device_config (
            device_id, key_version, trust_state, last_bootstrap_at, min_snapshot_created_at
          ) VALUES (
            'device-runtime', 5, 'trusted', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z'
          );
          INSERT INTO sync_table_state (table_name, enabled) VALUES ('accounts', 1);
        `);
      } finally {
        seedDb.close();
      }

      const clearSyncDataResponse = await fetch(
        `${server.baseUrl}/api/v1/connect/device/sync-data`,
        { method: "DELETE" },
      );
      expect(clearSyncDataResponse.status).toBe(200);
      await expect(clearSyncDataResponse.json()).resolves.toBeNull();
      expect(
        await Promise.resolve(runtime.options.secretService?.getSecret("sync_device_id")),
      ).toBeNull();
      expect(await Promise.resolve(runtime.options.secretService?.getSecret("sync_identity"))).toBe(
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: null,
          rootKey: null,
          keyVersion: null,
          deviceSecretKey: null,
          devicePublicKey: null,
        }),
      );

      const syncStateWithoutSessionResponse = await fetch(
        `${server.baseUrl}/api/v1/connect/device/sync-state`,
      );
      expect(syncStateWithoutSessionResponse.status).toBe(403);
      await expect(syncStateWithoutSessionResponse.json()).resolves.toMatchObject({
        message: "No sync session configured",
      });

      const reconcileWithoutSessionResponse = await fetch(
        jsonRequest("/api/v1/connect/device/reconcile-ready-state", { allowOverwrite: false }),
      );
      expect(reconcileWithoutSessionResponse.status).toBe(200);
      await expect(reconcileWithoutSessionResponse.json()).resolves.toMatchObject({
        status: "error",
        message: "Failed to read sync state: No sync session configured",
      });

      for (const request of [
        new Request(`${server.baseUrl}/api/v1/connect/device/enable`, { method: "POST" }),
        new Request(`${server.baseUrl}/api/v1/connect/device/reinitialize`, { method: "POST" }),
      ]) {
        const response = await fetch(request);
        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toMatchObject({
          message: "No sync session configured",
        });
      }

      const registerDeviceWithoutSessionResponse = await fetch(
        jsonRequest("/api/v1/sync/device/register", {
          displayName: "MacBook",
          platform: "macos",
          instanceId: "instance-1",
        }),
      );
      expect(registerDeviceWithoutSessionResponse.status).toBe(403);
      await expect(registerDeviceWithoutSessionResponse.json()).resolves.toMatchObject({
        message: "No sync session configured",
      });

      const currentDeviceWithoutSessionResponse = await fetch(
        `${server.baseUrl}/api/v1/sync/device/current`,
      );
      expect(currentDeviceWithoutSessionResponse.status).toBe(403);
      await expect(currentDeviceWithoutSessionResponse.json()).resolves.toMatchObject({
        message: "No sync session configured",
      });

      const listDevicesWithoutSessionResponse = await fetch(
        `${server.baseUrl}/api/v1/sync/devices?scope=team`,
      );
      expect(listDevicesWithoutSessionResponse.status).toBe(403);
      await expect(listDevicesWithoutSessionResponse.json()).resolves.toMatchObject({
        message: "No sync session configured",
      });

      for (const request of [
        new Request(`${server.baseUrl}/api/v1/sync/device/device-1`),
        new Request(`${server.baseUrl}/api/v1/sync/device/device-1`, {
          method: "PATCH",
          headers: jsonHeaders,
          body: JSON.stringify({ displayName: "Renamed" }),
        }),
        new Request(`${server.baseUrl}/api/v1/sync/device/device-1`, { method: "DELETE" }),
        new Request(`${server.baseUrl}/api/v1/sync/device/device-1/revoke`, { method: "POST" }),
      ]) {
        const response = await fetch(request);
        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toMatchObject({
          message: "No sync session configured",
        });
      }

      for (const request of [
        new Request(`${server.baseUrl}/api/v1/sync/keys/initialize`, { method: "POST" }),
        jsonRequest("/api/v1/sync/keys/initialize/commit", {
          keyVersion: 1,
          deviceKeyEnvelope: "envelope",
          signature: "signature",
        }),
        new Request(`${server.baseUrl}/api/v1/sync/keys/rotate`, { method: "POST" }),
        jsonRequest("/api/v1/sync/keys/rotate/commit", {
          newKeyVersion: 2,
          envelopes: [{ deviceId: "device-1", deviceKeyEnvelope: "envelope" }],
          signature: "signature",
        }),
        jsonRequest("/api/v1/sync/team/reset", { reason: "test" }),
      ]) {
        const response = await fetch(request);
        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toMatchObject({
          message: "No sync session configured",
        });
      }

      for (const request of [
        jsonRequest("/api/v1/sync/pairing", {
          codeHash: "hash",
          ephemeralPublicKey: "public-key",
        }),
        jsonRequest("/api/v1/sync/pairing/claim", {
          code: "123456",
          ephemeralPublicKey: "public-key",
        }),
        new Request(`${server.baseUrl}/api/v1/sync/pairing/pairing-1/messages`),
        new Request(`${server.baseUrl}/api/v1/sync/pairing/pairing-1/approve`, {
          method: "POST",
        }),
        jsonRequest("/api/v1/sync/pairing/pairing-1/complete", {
          encryptedKeyBundle: "bundle",
          sasProof: {},
          signature: "signature",
        }),
        new Request(`${server.baseUrl}/api/v1/sync/pairing/pairing-1/cancel`, {
          method: "POST",
        }),
        jsonRequest("/api/v1/sync/pairing/pairing-1/confirm", { proof: "proof" }),
        new Request(`${server.baseUrl}/api/v1/sync/pairing/pairing-1`),
      ]) {
        const response = await fetch(request);
        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toMatchObject({
          message: "No sync session configured",
        });
      }

      for (const request of [
        jsonRequest("/api/v1/sync/pairing/complete-with-transfer", {
          pairingId: "pairing-1",
          encryptedKeyBundle: "bundle",
          sasProof: {},
          signature: "signature",
        }),
        jsonRequest("/api/v1/sync/pairing/confirm-with-bootstrap", {
          pairingId: "pairing-1",
          allowOverwrite: false,
        }),
        jsonRequest("/api/v1/sync/pairing/flow/begin", {
          pairingId: "pairing-1",
          proof: "proof",
        }),
      ]) {
        const response = await fetch(request);
        expect(response.status).toBe(500);
        await expect(response.json()).resolves.toMatchObject({
          message: "No device ID configured",
        });
      }

      for (const request of [
        jsonRequest("/api/v1/sync/pairing/flow/state", { flowId: "flow-1" }),
        jsonRequest("/api/v1/sync/pairing/flow/approve-overwrite", { flowId: "flow-1" }),
      ]) {
        const response = await fetch(request);
        expect(response.status).toBe(500);
        await expect(response.json()).resolves.toMatchObject({
          message: "Flow not found",
        });
      }

      const cancelPairingFlowResponse = await fetch(
        jsonRequest("/api/v1/sync/pairing/flow/cancel", { flowId: "flow-1" }),
      );
      expect(cancelPairingFlowResponse.status).toBe(200);
      await expect(cancelPairingFlowResponse.json()).resolves.toEqual({
        flowId: "flow-1",
        phase: { phase: "success" },
      });

      const engineStatusResponse = await fetch(
        `${server.baseUrl}/api/v1/connect/device/engine-status`,
      );
      expect(engineStatusResponse.status).toBe(200);
      await expect(engineStatusResponse.json()).resolves.toMatchObject({
        cursor: 0,
        backgroundRunning: false,
        bootstrapRequired: true,
      });

      const pairingSourceResponse = await fetch(
        `${server.baseUrl}/api/v1/connect/device/pairing-source-status`,
      );
      expect(pairingSourceResponse.status).toBe(500);
      await expect(pairingSourceResponse.json()).resolves.toMatchObject({
        message: "No device ID configured",
      });

      const triggerCycleResponse = await fetch(
        `${server.baseUrl}/api/v1/connect/device/trigger-cycle`,
        { method: "POST" },
      );
      expect(triggerCycleResponse.status).toBe(200);
      await expect(triggerCycleResponse.json()).resolves.toMatchObject({
        status: "not_ready",
        pushedCount: 0,
        pulledCount: 0,
        cursor: 0,
        needsBootstrap: false,
      });

      const overwriteCheckResponse = await fetch(
        `${server.baseUrl}/api/v1/connect/device/bootstrap-overwrite-check`,
      );
      expect(overwriteCheckResponse.status).toBe(200);
      await expect(overwriteCheckResponse.json()).resolves.toMatchObject({
        bootstrapRequired: true,
        hasLocalData: false,
        localRows: 0,
        nonEmptyTables: [],
      });

      const startBackgroundResponse = await fetch(
        `${server.baseUrl}/api/v1/connect/device/start-background`,
        { method: "POST" },
      );
      expect(startBackgroundResponse.status).toBe(200);
      await expect(startBackgroundResponse.json()).resolves.toEqual({
        status: "skipped",
        message: "Background engine not started because sync identity is not configured",
      });

      const stopBackgroundResponse = await fetch(
        `${server.baseUrl}/api/v1/connect/device/stop-background`,
        { method: "POST" },
      );
      expect(stopBackgroundResponse.status).toBe(200);
      await expect(stopBackgroundResponse.json()).resolves.toEqual({
        status: "stopped",
        message: "Device sync background engine stopped",
      });

      for (const pathName of [
        "/api/v1/connect/device/bootstrap-snapshot",
        "/api/v1/connect/device/generate-snapshot",
      ]) {
        const response = await fetch(`${server.baseUrl}${pathName}`, { method: "POST" });
        expect(response.status).toBe(500);
        await expect(response.json()).resolves.toMatchObject({
          message: "No device ID configured",
        });
      }

      const cancelSnapshotResponse = await fetch(
        `${server.baseUrl}/api/v1/connect/device/cancel-snapshot`,
        { method: "POST" },
      );
      expect(cancelSnapshotResponse.status).toBe(200);
      await expect(cancelSnapshotResponse.json()).resolves.toEqual({
        status: "cancel_requested",
        message: "Snapshot upload cancellation requested",
      });
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime device cloud read routes", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-device-read-"));
    const deviceSyncRequests: Array<{ url: string; authorization: string; requestId: string }> = [];
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      env: {
        CONNECT_API_URL: "https://api.example.test",
        CONNECT_AUTH_URL: "https://auth.example.test",
      },
      marketDataFetch: (async (input, init) => {
        const url = String(input);
        if (url.includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token", refresh_token: "refresh-token" });
        }
        const headers = new Headers(init?.headers);
        deviceSyncRequests.push({
          url,
          authorization: headers.get("authorization") ?? "",
          requestId: headers.get("x-wf-client-request-id") ?? "",
        });
        if (url.includes("/api/v1/sync/team/devices?")) {
          return Response.json([
            {
              id: "device-runtime",
              user_id: "user-1",
              display_name: "MacBook",
              platform: "mac",
              trust_state: "trusted",
              trusted_key_version: 2,
              created_at: "2026-01-01T00:00:00Z",
              last_seen_at: null,
            },
          ]);
        }
        return Response.json({
          id: "device-runtime",
          user_id: "user-1",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 2,
          created_at: "2026-01-01T00:00:00Z",
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret("sync_device_id", "device-runtime");
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const listResponse = await fetch(`${server.baseUrl}/api/v1/sync/devices?scope=team`);
      expect(listResponse.status).toBe(200);
      await expect(listResponse.json()).resolves.toEqual([
        {
          id: "device-runtime",
          userId: "user-1",
          displayName: "MacBook",
          platform: "mac",
          devicePublicKey: null,
          trustState: "trusted",
          trustedKeyVersion: 2,
          osVersion: null,
          appVersion: null,
          lastSeenAt: null,
          createdAt: "2026-01-01T00:00:00Z",
        },
      ]);

      const currentResponse = await fetch(`${server.baseUrl}/api/v1/sync/device/current`);
      expect(currentResponse.status).toBe(200);
      await expect(currentResponse.json()).resolves.toMatchObject({
        id: "device-runtime",
        userId: "user-1",
        displayName: "MacBook",
        trustedKeyVersion: 2,
      });
      expect(deviceSyncRequests).toEqual([
        {
          url: "https://api.example.test/api/v1/sync/team/devices?scope=team",
          authorization: "Bearer access-token",
          requestId: expect.stringMatching(/^app:[0-9a-f-]{36}$/),
        },
        {
          url: "https://api.example.test/api/v1/sync/team/devices/device-runtime",
          authorization: "Bearer access-token",
          requestId: expect.stringMatching(/^app:[0-9a-f-]{36}$/),
        },
      ]);
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime device cloud mutation routes", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-device-mutate-"));
    const deviceSyncRequests: Array<{
      url: string;
      method: string;
      body: string | null;
      authorization: string;
      requestId: string;
    }> = [];
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      env: {
        CONNECT_API_URL: "https://api.example.test",
        CONNECT_AUTH_URL: "https://auth.example.test",
      },
      marketDataFetch: (async (input, init) => {
        const url = String(input);
        if (url.includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token", refresh_token: "refresh-token" });
        }
        const headers = new Headers(init?.headers);
        deviceSyncRequests.push({
          url,
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : null,
          authorization: headers.get("authorization") ?? "",
          requestId: headers.get("x-wf-client-request-id") ?? "",
        });
        return Response.json({ success: true });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const updateResponse = await fetch(`${server.baseUrl}/api/v1/sync/device/device-runtime`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: "Renamed Mac" }),
      });
      expect(updateResponse.status).toBe(200);
      await expect(updateResponse.json()).resolves.toEqual({ success: true });

      const deleteResponse = await fetch(`${server.baseUrl}/api/v1/sync/device/device-runtime`, {
        method: "DELETE",
      });
      expect(deleteResponse.status).toBe(200);
      await expect(deleteResponse.json()).resolves.toEqual({ success: true });

      const revokeResponse = await fetch(
        `${server.baseUrl}/api/v1/sync/device/device-runtime/revoke`,
        {
          method: "POST",
        },
      );
      expect(revokeResponse.status).toBe(200);
      await expect(revokeResponse.json()).resolves.toEqual({ success: true });

      expect(deviceSyncRequests).toEqual([
        {
          url: "https://api.example.test/api/v1/sync/team/devices/device-runtime",
          method: "PATCH",
          body: JSON.stringify({ display_name: "Renamed Mac" }),
          authorization: "Bearer access-token",
          requestId: expect.stringMatching(/^app:[0-9a-f-]{36}$/),
        },
        {
          url: "https://api.example.test/api/v1/sync/team/devices/device-runtime",
          method: "DELETE",
          body: null,
          authorization: "Bearer access-token",
          requestId: expect.stringMatching(/^app:[0-9a-f-]{36}$/),
        },
        {
          url: "https://api.example.test/api/v1/sync/team/devices/device-runtime/revoke",
          method: "POST",
          body: null,
          authorization: "Bearer access-token",
          requestId: expect.stringMatching(/^app:[0-9a-f-]{36}$/),
        },
      ]);
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime team-key cloud routes", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-team-key-"));
    const deviceSyncRequests: Array<{
      url: string;
      method: string;
      body: string | null;
      deviceId: string;
      requestId: string;
    }> = [];
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      env: {
        CONNECT_API_URL: "https://api.example.test",
        CONNECT_AUTH_URL: "https://auth.example.test",
      },
      marketDataFetch: (async (input, init) => {
        const url = String(input);
        if (url.includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token", refresh_token: "refresh-token" });
        }
        const headers = new Headers(init?.headers);
        deviceSyncRequests.push({
          url,
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : null,
          deviceId: headers.get("x-wf-device-id") ?? "",
          requestId: headers.get("x-wf-client-request-id") ?? "",
        });
        if (url.endsWith("/keys/rotate")) {
          return Response.json({ challenge: "challenge", nonce: "nonce", new_key_version: 3 });
        }
        if (url.endsWith("/keys/initialize/commit")) {
          return Response.json({ success: true, key_state: "ACTIVE" });
        }
        if (url.endsWith("/keys/rotate/commit")) {
          return Response.json({ success: true, key_version: 3 });
        }
        return Response.json({
          mode: "BOOTSTRAP",
          challenge: "challenge",
          nonce: "nonce",
          key_version: 2,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);
    const jsonRequest = (pathName: string, body: Record<string, unknown>) =>
      new Request(`${server.baseUrl}${pathName}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    try {
      await runtime.options.secretService?.setSecret("sync_device_id", "device-runtime");
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const initializeResponse = await fetch(
        new Request(`${server.baseUrl}/api/v1/sync/keys/initialize`, { method: "POST" }),
      );
      expect(initializeResponse.status).toBe(200);
      await expect(initializeResponse.json()).resolves.toEqual({
        mode: "BOOTSTRAP",
        challenge: "challenge",
        nonce: "nonce",
        key_version: 2,
      });

      const rotateResponse = await fetch(
        new Request(`${server.baseUrl}/api/v1/sync/keys/rotate`, { method: "POST" }),
      );
      expect(rotateResponse.status).toBe(200);
      await expect(rotateResponse.json()).resolves.toEqual({
        challenge: "challenge",
        nonce: "nonce",
        newKeyVersion: 3,
      });

      const commitInitializeResponse = await fetch(
        jsonRequest("/api/v1/sync/keys/initialize/commit", {
          keyVersion: 2,
          deviceKeyEnvelope: "envelope",
          signature: "signature",
          challengeResponse: "challenge",
          recoveryEnvelope: "recovery",
        }),
      );
      expect(commitInitializeResponse.status).toBe(200);
      await expect(commitInitializeResponse.json()).resolves.toEqual({
        success: true,
        keyState: "ACTIVE",
      });

      const commitRotateResponse = await fetch(
        jsonRequest("/api/v1/sync/keys/rotate/commit", {
          newKeyVersion: 3,
          envelopes: [{ deviceId: "device-2", deviceKeyEnvelope: "envelope-2" }],
          signature: "signature",
          challengeResponse: "challenge",
        }),
      );
      expect(commitRotateResponse.status).toBe(200);
      await expect(commitRotateResponse.json()).resolves.toEqual({ success: true, keyVersion: 3 });

      expect(
        deviceSyncRequests.map((request) => ({
          url: request.url,
          method: request.method,
          body: request.body,
          deviceId: request.deviceId,
        })),
      ).toEqual([
        {
          url: "https://api.example.test/api/v1/sync/team/keys/initialize",
          method: "POST",
          body: JSON.stringify({ device_id: "device-runtime" }),
          deviceId: "device-runtime",
        },
        {
          url: "https://api.example.test/api/v1/sync/team/keys/rotate",
          method: "POST",
          body: JSON.stringify({ initiator_device_id: "device-runtime" }),
          deviceId: "device-runtime",
        },
        {
          url: "https://api.example.test/api/v1/sync/team/keys/initialize/commit",
          method: "POST",
          body: JSON.stringify({
            device_id: "device-runtime",
            key_version: 2,
            device_key_envelope: "envelope",
            signature: "signature",
            challenge_response: "challenge",
            recovery_envelope: "recovery",
          }),
          deviceId: "device-runtime",
        },
        {
          url: "https://api.example.test/api/v1/sync/team/keys/rotate/commit",
          method: "POST",
          body: JSON.stringify({
            new_key_version: 3,
            envelopes: [{ device_id: "device-2", device_key_envelope: "envelope-2" }],
            signature: "signature",
            challenge_response: "challenge",
          }),
          deviceId: "device-runtime",
        },
      ]);
      expect(deviceSyncRequests.map((request) => request.requestId)).toEqual([
        expect.stringMatching(/^device-runtime:[0-9a-f-]{36}$/),
        expect.stringMatching(/^device-runtime:[0-9a-f-]{36}$/),
        expect.stringMatching(/^device-runtime:[0-9a-f-]{36}$/),
        expect.stringMatching(/^device-runtime:[0-9a-f-]{36}$/),
      ]);
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime reset-team cloud route", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-team-reset-"));
    const deviceSyncRequests: Array<{
      url: string;
      method: string;
      body: string | null;
      deviceId: string;
      requestId: string;
    }> = [];
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      env: {
        CONNECT_API_URL: "https://api.example.test",
        CONNECT_AUTH_URL: "https://auth.example.test",
      },
      marketDataFetch: (async (input, init) => {
        const url = String(input);
        if (url.includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token", refresh_token: "refresh-token" });
        }
        const headers = new Headers(init?.headers);
        deviceSyncRequests.push({
          url,
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : null,
          deviceId: headers.get("x-wf-device-id") ?? "",
          requestId: headers.get("x-wf-client-request-id") ?? "",
        });
        return Response.json({ success: true, key_version: 1, reset_at: "2026-01-01T00:00:00Z" });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const resetResponse = await fetch(`${server.baseUrl}/api/v1/sync/team/reset`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "test" }),
      });
      expect(resetResponse.status).toBe(200);
      await expect(resetResponse.json()).resolves.toEqual({
        success: true,
        keyVersion: 1,
        resetAt: "2026-01-01T00:00:00Z",
      });
      expect(deviceSyncRequests).toEqual([
        {
          url: "https://api.example.test/api/v1/sync/team/keys/reset",
          method: "POST",
          body: JSON.stringify({ reason: "test" }),
          deviceId: "",
          requestId: expect.stringMatching(/^app:[0-9a-f-]{36}$/),
        },
      ]);
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime pairing transfer route with pending outbox gate", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-pairing-transfer-"));
    const requests: string[] = [];
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      env: {
        CONNECT_API_URL: "https://api.example.test",
        CONNECT_AUTH_URL: "https://auth.example.test",
      },
      marketDataFetch: (async (input) => {
        const url = String(input);
        requests.push(url);
        if (url.includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token", refresh_token: "refresh-token" });
        }
        return Response.json({ success: true });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);
    const jsonRequest = (pathName: string, body: Record<string, unknown>) =>
      new Request(`${server.baseUrl}${pathName}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({ version: 2, deviceId: "device-runtime" }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb
          .prepare(
            `
            INSERT INTO sync_device_config (
              device_id, key_version, trust_state, last_bootstrap_at, min_snapshot_created_at
            )
            VALUES ('device-runtime', 2, 'trusted', '2026-05-14T00:00:00Z', NULL)
          `,
          )
          .run();
        seedDb.prepare("UPDATE sync_engine_state SET last_cycle_status = 'ok' WHERE id = 1").run();
      } finally {
        seedDb.close();
      }

      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const successResponse = await fetch(
        jsonRequest("/api/v1/sync/pairing/complete-with-transfer", {
          pairingId: "pairing-1",
          encryptedKeyBundle: "bundle",
          sasProof: { ok: true },
          signature: "signature",
        }),
      );
      expect(successResponse.status).toBe(200);
      await expect(successResponse.json()).resolves.toEqual({ success: true });
      expect(requests.map((request) => request.split("/").pop())).toEqual([
        "token?grant_type=refresh_token",
        "approve",
        "complete",
      ]);
      requests.length = 0;

      const db = openSqliteDatabase(runtime.dbPath);
      try {
        db.prepare(
          `
            INSERT INTO sync_outbox (
              event_id, entity, entity_id, op, client_timestamp, payload,
              payload_key_version, sent, status, retry_count, device_id, created_at
            )
            VALUES (
              'pending-event', 'account', 'account-1', 'create',
              '2026-05-14T00:00:00Z', '{}', 2, 0, 'pending', 0,
              'device-runtime', '2026-05-14T00:00:00Z'
            )
          `,
        ).run();
      } finally {
        db.close();
      }

      const blockedResponse = await fetch(
        jsonRequest("/api/v1/sync/pairing/complete-with-transfer", {
          pairingId: "pairing-1",
          encryptedKeyBundle: "bundle",
          sasProof: { ok: true },
          signature: "signature",
        }),
      );
      expect(blockedResponse.status).toBe(501);
      await expect(blockedResponse.json()).resolves.toMatchObject({
        code: "not_implemented",
      });
      expect(requests.map((request) => request.split("/").pop())).toEqual([
        "token?grant_type=refresh_token",
      ]);
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime pairing transfer route to bootstrap gate", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-pairing-bootstrap-"));
    const requests: string[] = [];
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      env: {
        CONNECT_API_URL: "https://api.example.test",
        CONNECT_AUTH_URL: "https://auth.example.test",
      },
      marketDataFetch: (async (input) => {
        const url = String(input);
        requests.push(url);
        if (url.includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token", refresh_token: "refresh-token" });
        }
        return Response.json({ success: true });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);
    const jsonRequest = (pathName: string, body: Record<string, unknown>) =>
      new Request(`${server.baseUrl}${pathName}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({ version: 2, deviceId: "device-runtime" }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb
          .prepare(
            `
            INSERT INTO sync_device_config (
              device_id, key_version, trust_state, last_bootstrap_at, min_snapshot_created_at
            )
            VALUES ('device-runtime', 2, 'trusted', NULL, NULL)
          `,
          )
          .run();
        seedDb.prepare("UPDATE sync_engine_state SET last_cycle_status = 'ok' WHERE id = 1").run();
      } finally {
        seedDb.close();
      }

      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);
      requests.length = 0;

      const blockedResponse = await fetch(
        jsonRequest("/api/v1/sync/pairing/complete-with-transfer", {
          pairingId: "pairing-1",
          encryptedKeyBundle: "bundle",
          sasProof: { ok: true },
          signature: "signature",
        }),
      );
      expect(blockedResponse.status).toBe(501);
      await expect(blockedResponse.json()).resolves.toMatchObject({
        code: "not_implemented",
      });
      expect(requests.map((request) => request.split("/").pop())).toEqual([
        "token?grant_type=refresh_token",
      ]);
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime pairing transfer route through already-approved retry", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-pairing-retry-"));
    const requests: string[] = [];
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      env: {
        CONNECT_API_URL: "https://api.example.test",
        CONNECT_AUTH_URL: "https://auth.example.test",
      },
      marketDataFetch: (async (input) => {
        const url = String(input);
        requests.push(url);
        if (url.includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token", refresh_token: "refresh-token" });
        }
        if (url.endsWith("/approve")) {
          return Response.json(
            { code: "ALREADY_APPROVED", message: "already approved" },
            { status: 409 },
          );
        }
        return Response.json({ success: true, remote_seed_present: true });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);
    const jsonRequest = (pathName: string, body: Record<string, unknown>) =>
      new Request(`${server.baseUrl}${pathName}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({ version: 2, deviceId: "device-runtime" }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb
          .prepare(
            `
            INSERT INTO sync_device_config (
              device_id, key_version, trust_state, last_bootstrap_at, min_snapshot_created_at
            )
            VALUES ('device-runtime', 2, 'trusted', '2026-05-14T00:00:00Z', NULL)
          `,
          )
          .run();
        seedDb.prepare("UPDATE sync_engine_state SET last_cycle_status = 'ok' WHERE id = 1").run();
      } finally {
        seedDb.close();
      }

      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);
      requests.length = 0;

      const successResponse = await fetch(
        jsonRequest("/api/v1/sync/pairing/complete-with-transfer", {
          pairingId: "pairing-1",
          encryptedKeyBundle: "bundle",
          sasProof: { ok: true },
          signature: "signature",
        }),
      );
      expect(successResponse.status).toBe(200);
      await expect(successResponse.json()).resolves.toEqual({ success: true });
      expect(requests.map((request) => request.split("/").pop())).toEqual([
        "token?grant_type=refresh_token",
        "approve",
        "complete",
      ]);
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime pairing transfer route to stop after approve failure", async () => {
    const appDataDir = mkdtempSync(
      path.join(tmpdir(), "wealthfolio-runtime-pairing-approve-fail-"),
    );
    const requests: string[] = [];
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      env: {
        CONNECT_API_URL: "https://api.example.test",
        CONNECT_AUTH_URL: "https://auth.example.test",
      },
      marketDataFetch: (async (input) => {
        const url = String(input);
        requests.push(url);
        if (url.includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token", refresh_token: "refresh-token" });
        }
        if (url.endsWith("/approve")) {
          return Response.json({ code: "PAIRING_CLOSED", message: "closed" }, { status: 409 });
        }
        return Response.json({ success: true, remote_seed_present: true });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);
    const jsonRequest = (pathName: string, body: Record<string, unknown>) =>
      new Request(`${server.baseUrl}${pathName}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({ version: 2, deviceId: "device-runtime" }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb
          .prepare(
            `
            INSERT INTO sync_device_config (
              device_id, key_version, trust_state, last_bootstrap_at, min_snapshot_created_at
            )
            VALUES ('device-runtime', 2, 'trusted', '2026-05-14T00:00:00Z', NULL)
          `,
          )
          .run();
        seedDb.prepare("UPDATE sync_engine_state SET last_cycle_status = 'ok' WHERE id = 1").run();
      } finally {
        seedDb.close();
      }

      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);
      requests.length = 0;

      const failureResponse = await fetch(
        jsonRequest("/api/v1/sync/pairing/complete-with-transfer", {
          pairingId: "pairing-1",
          encryptedKeyBundle: "bundle",
          sasProof: { ok: true },
          signature: "signature",
        }),
      );
      expect(failureResponse.status).toBe(500);
      await expect(failureResponse.json()).resolves.toMatchObject({
        code: "internal_error",
        message: expect.stringContaining("PAIRING_CLOSED"),
      });
      expect(requests.map((request) => request.split("/").pop())).toEqual([
        "token?grant_type=refresh_token",
        "approve",
      ]);
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime bootstrap confirm route when bootstrap is already complete", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-bootstrap-confirm-"));
    const requests: Array<{ url: string; method: string; body: string | null; deviceId: string }> =
      [];
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      env: {
        CONNECT_API_URL: "https://api.example.test",
        CONNECT_AUTH_URL: "https://auth.example.test",
      },
      marketDataFetch: (async (input, init) => {
        const url = String(input);
        const headers = new Headers(init?.headers);
        requests.push({
          url,
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : null,
          deviceId: headers.get("x-wf-device-id") ?? "",
        });
        if (url.includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token", refresh_token: "refresh-token" });
        }
        return Response.json(
          { code: "PAIRING_ALREADY_CONFIRMED", message: "already confirmed" },
          { status: 409 },
        );
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);
    const jsonRequest = (pathName: string, body: Record<string, unknown>) =>
      new Request(`${server.baseUrl}${pathName}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({ version: 2, deviceId: "device-runtime" }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb
          .prepare(
            `
            INSERT INTO sync_device_config (
              device_id, key_version, trust_state, last_bootstrap_at, min_snapshot_created_at
            )
            VALUES ('device-runtime', 2, 'trusted', '2026-05-14T00:00:00Z', NULL)
          `,
          )
          .run();
        seedDb.prepare("UPDATE sync_engine_state SET last_cycle_status = 'ok' WHERE id = 1").run();
      } finally {
        seedDb.close();
      }

      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const response = await fetch(
        jsonRequest("/api/v1/sync/pairing/confirm-with-bootstrap", {
          pairingId: "pairing-1",
          proof: "proof",
          minSnapshotCreatedAt: "2026-01-01T00:00:00Z",
          allowOverwrite: false,
        }),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        status: "already_complete",
        message: "No bootstrap needed",
        localRows: null,
        nonEmptyTables: null,
      });
      expect(requests).toEqual([
        expect.objectContaining({
          url: "https://auth.example.test/auth/v1/token?grant_type=refresh_token",
          method: "POST",
          deviceId: "",
        }),
        expect.objectContaining({
          url: "https://api.example.test/api/v1/sync/team/devices/device-runtime/pairings/pairing-1/confirm",
          method: "POST",
          body: JSON.stringify({ proof: "proof" }),
          deviceId: "device-runtime",
        }),
      ]);
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime bootstrap confirm route to overwrite-required branch", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-bootstrap-overwrite-"));
    const requests: Array<{ url: string; method: string; body: string | null; deviceId: string }> =
      [];
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      env: {
        CONNECT_API_URL: "https://api.example.test",
        CONNECT_AUTH_URL: "https://auth.example.test",
      },
      marketDataFetch: (async (input, init) => {
        const url = String(input);
        const headers = new Headers(init?.headers);
        requests.push({
          url,
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : null,
          deviceId: headers.get("x-wf-device-id") ?? "",
        });
        if (url.includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token", refresh_token: "refresh-token" });
        }
        return Response.json({ success: true, key_version: 2 });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);
    const jsonRequest = (pathName: string, body: Record<string, unknown>) =>
      new Request(`${server.baseUrl}${pathName}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({ version: 2, deviceId: "device-runtime" }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb
          .prepare(
            `
            INSERT INTO sync_device_config (
              device_id, key_version, trust_state, last_bootstrap_at, min_snapshot_created_at
            )
            VALUES ('device-runtime', 2, 'trusted', NULL, NULL)
          `,
          )
          .run();
        seedDb.prepare("UPDATE sync_engine_state SET last_cycle_status = 'ok' WHERE id = 1").run();
        seedDb
          .prepare(
            `
            INSERT INTO accounts (
              id, name, account_type, "group", currency, is_default, is_active,
              is_archived, tracking_mode
            )
            VALUES ('overwrite-account', 'Overwrite Account', 'CASH', NULL, 'USD', 0, 1, 0, 'HOLDINGS')
          `,
          )
          .run();
      } finally {
        seedDb.close();
      }

      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const response = await fetch(
        jsonRequest("/api/v1/sync/pairing/confirm-with-bootstrap", {
          pairingId: "pairing-1",
          proof: "proof",
          allowOverwrite: false,
        }),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        status: "overwrite_required",
        message: "Local data (1 rows) will be replaced by remote snapshot",
        localRows: 1,
        nonEmptyTables: [{ table: "accounts", rows: 1 }],
      });
      expect(requests).toEqual([
        expect.objectContaining({
          url: "https://auth.example.test/auth/v1/token?grant_type=refresh_token",
          method: "POST",
          deviceId: "",
        }),
        expect.objectContaining({
          url: "https://api.example.test/api/v1/sync/team/devices/device-runtime/pairings/pairing-1/confirm",
          method: "POST",
          body: JSON.stringify({ proof: "proof" }),
          deviceId: "device-runtime",
        }),
      ]);
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime bootstrap confirm route to waiting-snapshot branch", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-bootstrap-wait-"));
    const deviceSyncRequests: Array<{ url: string; method: string; body: string | null }> = [];
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      env: {
        CONNECT_API_URL: "https://api.example.test",
        CONNECT_AUTH_URL: "https://auth.example.test",
      },
      marketDataFetch: (async (input, init) => {
        const url = String(input);
        if (url.includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token", refresh_token: "refresh-token" });
        }
        deviceSyncRequests.push({
          url,
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : null,
        });
        if (url.endsWith("/api/v1/sync/snapshots/latest")) {
          return Response.json(
            { code: "SNAPSHOT_NOT_FOUND", message: "not found" },
            { status: 404 },
          );
        }
        return Response.json({ success: true, key_version: 2 });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({ version: 2, deviceId: "device-runtime" }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb
          .prepare(
            `
            INSERT INTO sync_device_config (
              device_id, key_version, trust_state, last_bootstrap_at, min_snapshot_created_at
            )
            VALUES ('device-runtime', 2, 'trusted', NULL, NULL)
          `,
          )
          .run();
        seedDb.prepare("UPDATE sync_engine_state SET last_cycle_status = 'ok' WHERE id = 1").run();
      } finally {
        seedDb.close();
      }

      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const confirmResponse = await fetch(
        `${server.baseUrl}/api/v1/sync/pairing/confirm-with-bootstrap`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            pairingId: "pairing-wait",
            proof: "proof",
            allowOverwrite: false,
          }),
        },
      );
      expect(confirmResponse.status).toBe(200);
      await expect(confirmResponse.json()).resolves.toEqual({
        status: "waiting_snapshot",
        message: "Snapshot is not available yet. Waiting for upload from a trusted device.",
        localRows: null,
        nonEmptyTables: null,
      });
      expect(deviceSyncRequests).toEqual([
        {
          url: "https://api.example.test/api/v1/sync/team/devices/device-runtime/pairings/pairing-wait/confirm",
          method: "POST",
          body: JSON.stringify({ proof: "proof" }),
        },
        {
          url: "https://api.example.test/api/v1/sync/snapshots/latest",
          method: "GET",
          body: null,
        },
      ]);
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime pairing flow begin when bootstrap is already complete", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-pairing-begin-"));
    const deviceSyncRequests: Array<{ url: string; method: string; body: string | null }> = [];
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      env: {
        CONNECT_API_URL: "https://api.example.test",
        CONNECT_AUTH_URL: "https://auth.example.test",
      },
      marketDataFetch: (async (input, init) => {
        const url = String(input);
        if (url.includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token", refresh_token: "refresh-token" });
        }
        deviceSyncRequests.push({
          url,
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : null,
        });
        return Response.json({ success: true, key_version: 2 });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);
    const jsonRequest = (pathName: string, body: Record<string, unknown>) =>
      new Request(`${server.baseUrl}${pathName}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({ version: 2, deviceId: "device-runtime" }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb
          .prepare(
            `
            INSERT INTO sync_device_config (
              device_id, key_version, trust_state, last_bootstrap_at, min_snapshot_created_at
            )
            VALUES ('device-runtime', 2, 'trusted', '2026-01-02T03:04:05Z', NULL)
          `,
          )
          .run();
        seedDb.prepare("UPDATE sync_engine_state SET last_cycle_status = 'ok' WHERE id = 1").run();
      } finally {
        seedDb.close();
      }

      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const beginResponse = await fetch(
        jsonRequest("/api/v1/sync/pairing/flow/begin", {
          pairingId: "pairing-complete",
          proof: "proof",
        }),
      );
      expect(beginResponse.status).toBe(200);
      const beginBody = await beginResponse.text();
      const begin = JSON.parse(beginBody) as { flowId?: unknown; phase?: unknown };
      const flowId = begin.flowId;
      expect(typeof flowId, beginBody).toBe("string");
      if (typeof flowId !== "string") {
        throw new Error("Expected pairing flow id");
      }
      expect(begin).toEqual({ flowId, phase: { phase: "success" } });
      expect(deviceSyncRequests).toEqual([
        {
          url: "https://api.example.test/api/v1/sync/team/devices/device-runtime/pairings/pairing-complete/confirm",
          method: "POST",
          body: JSON.stringify({ proof: "proof" }),
        },
      ]);
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime pairing flow begin to waiting snapshot", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-pairing-wait-"));
    const deviceSyncRequests: Array<{ url: string; method: string; body: string | null }> = [];
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      env: {
        CONNECT_API_URL: "https://api.example.test",
        CONNECT_AUTH_URL: "https://auth.example.test",
      },
      marketDataFetch: (async (input, init) => {
        const url = String(input);
        if (url.includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token", refresh_token: "refresh-token" });
        }
        deviceSyncRequests.push({
          url,
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : null,
        });
        if (url.endsWith("/api/v1/sync/snapshots/latest")) {
          return Response.json(
            { code: "SNAPSHOT_NOT_FOUND", message: "not found" },
            { status: 404 },
          );
        }
        return Response.json({ success: true, key_version: 2 });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);
    const jsonRequest = (pathName: string, body: Record<string, unknown>) =>
      new Request(`${server.baseUrl}${pathName}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({ version: 2, deviceId: "device-runtime" }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb
          .prepare(
            `
            INSERT INTO sync_device_config (
              device_id, key_version, trust_state, last_bootstrap_at, min_snapshot_created_at
            )
            VALUES ('device-runtime', 2, 'trusted', NULL, NULL)
          `,
          )
          .run();
        seedDb.prepare("UPDATE sync_engine_state SET last_cycle_status = 'ok' WHERE id = 1").run();
      } finally {
        seedDb.close();
      }

      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const beginResponse = await fetch(
        jsonRequest("/api/v1/sync/pairing/flow/begin", {
          pairingId: "pairing-wait",
          proof: "proof",
        }),
      );
      expect(beginResponse.status).toBe(200);
      const beginBody = await beginResponse.text();
      const begin = JSON.parse(beginBody) as { flowId?: unknown; phase?: unknown };
      const flowId = begin.flowId;
      expect(typeof flowId, beginBody).toBe("string");
      if (typeof flowId !== "string") {
        throw new Error("Expected pairing flow id");
      }
      expect(begin).toEqual({
        flowId,
        phase: { phase: "syncing", detail: "waiting_snapshot" },
      });
      expect(deviceSyncRequests).toEqual([
        {
          url: "https://api.example.test/api/v1/sync/team/devices/device-runtime/pairings/pairing-wait/confirm",
          method: "POST",
          body: JSON.stringify({ proof: "proof" }),
        },
        {
          url: "https://api.example.test/api/v1/sync/snapshots/latest",
          method: "GET",
          body: null,
        },
      ]);

      const stateResponse = await fetch(jsonRequest("/api/v1/sync/pairing/flow/state", { flowId }));
      expect(stateResponse.status).toBe(200);
      await expect(stateResponse.json()).resolves.toEqual({
        flowId,
        phase: { phase: "syncing", detail: "waiting_snapshot" },
      });
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime pairing flow overwrite approval to waiting snapshot", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-pairing-flow-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      env: {
        CONNECT_API_URL: "https://api.example.test",
        CONNECT_AUTH_URL: "https://auth.example.test",
      },
      marketDataFetch: (async (input) => {
        const url = String(input);
        if (url.includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token", refresh_token: "refresh-token" });
        }
        if (url.endsWith("/api/v1/sync/snapshots/latest")) {
          return Response.json(
            { code: "SNAPSHOT_NOT_FOUND", message: "not found" },
            { status: 404 },
          );
        }
        return Response.json({ success: true, key_version: 2 });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);
    const jsonRequest = (pathName: string, body: Record<string, unknown>) =>
      new Request(`${server.baseUrl}${pathName}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({ version: 2, deviceId: "device-runtime" }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb
          .prepare(
            `
            INSERT INTO sync_device_config (
              device_id, key_version, trust_state, last_bootstrap_at, min_snapshot_created_at
            )
            VALUES ('device-runtime', 2, 'trusted', NULL, NULL)
          `,
          )
          .run();
        seedDb.prepare("UPDATE sync_engine_state SET last_cycle_status = 'ok' WHERE id = 1").run();
        seedDb
          .prepare(
            `
            INSERT INTO accounts (
              id, name, account_type, "group", currency, is_default, is_active,
              is_archived, tracking_mode
            )
            VALUES ('flow-account', 'Flow Account', 'CASH', NULL, 'USD', 0, 1, 0, 'HOLDINGS')
          `,
          )
          .run();
      } finally {
        seedDb.close();
      }

      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const beginResponse = await fetch(
        jsonRequest("/api/v1/sync/pairing/flow/begin", {
          pairingId: "pairing-1",
          proof: "proof",
        }),
      );
      expect(beginResponse.status).toBe(200);
      const beginBody = await beginResponse.text();
      const begin = JSON.parse(beginBody) as { flowId?: unknown; phase?: unknown };
      const flowId = begin.flowId;
      expect(typeof flowId, beginBody).toBe("string");
      if (typeof flowId !== "string") {
        throw new Error("Expected pairing flow id");
      }
      expect(begin).toEqual({
        flowId,
        phase: {
          phase: "overwrite_required",
          info: { localRows: 1, nonEmptyTables: [{ table: "accounts", rows: 1 }] },
        },
      });

      const approveResponse = await fetch(
        jsonRequest("/api/v1/sync/pairing/flow/approve-overwrite", { flowId }),
      );
      const approveBody = await approveResponse.text();
      expect(approveResponse.status, approveBody).toBe(200);
      expect(JSON.parse(approveBody)).toEqual({
        flowId,
        phase: { phase: "syncing", detail: "waiting_snapshot" },
      });

      const stateResponse = await fetch(jsonRequest("/api/v1/sync/pairing/flow/state", { flowId }));
      expect(stateResponse.status).toBe(200);
      await expect(stateResponse.json()).resolves.toEqual({
        flowId,
        phase: { phase: "syncing", detail: "waiting_snapshot" },
      });
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime pairing flow approval to snapshot metadata error", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-pairing-snapshot-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      env: {
        CONNECT_API_URL: "https://api.example.test",
        CONNECT_AUTH_URL: "https://auth.example.test",
      },
      marketDataFetch: (async (input) => {
        const url = String(input);
        if (url.includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token", refresh_token: "refresh-token" });
        }
        if (url.endsWith("/api/v1/sync/snapshots/latest")) {
          return Response.json({
            snapshot_id: "snapshot-1",
            schema_version: 2,
            covers_tables: [],
            created_at: "2026-01-01T00:05:00Z",
            oplog_seq: 1,
            size_bytes: 0,
            checksum: "checksum-1",
          });
        }
        return Response.json({ success: true, key_version: 2 });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);
    const jsonRequest = (pathName: string, body: Record<string, unknown>) =>
      new Request(`${server.baseUrl}${pathName}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({ version: 2, deviceId: "device-runtime" }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb
          .prepare(
            `
            INSERT INTO sync_device_config (
              device_id, key_version, trust_state, last_bootstrap_at, min_snapshot_created_at
            )
            VALUES ('device-runtime', 2, 'trusted', NULL, NULL)
          `,
          )
          .run();
        seedDb.prepare("UPDATE sync_engine_state SET last_cycle_status = 'ok' WHERE id = 1").run();
        seedDb
          .prepare(
            `
            INSERT INTO accounts (
              id, name, account_type, "group", currency, is_default, is_active,
              is_archived, tracking_mode
            )
            VALUES ('schema-account', 'Schema Account', 'CASH', NULL, 'USD', 0, 1, 0, 'HOLDINGS')
          `,
          )
          .run();
      } finally {
        seedDb.close();
      }

      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const beginResponse = await fetch(
        jsonRequest("/api/v1/sync/pairing/flow/begin", {
          pairingId: "pairing-schema",
          proof: "proof",
        }),
      );
      expect(beginResponse.status).toBe(200);
      const begin = (await beginResponse.json()) as { flowId?: unknown };
      const flowId = begin.flowId;
      expect(typeof flowId).toBe("string");
      if (typeof flowId !== "string") {
        throw new Error("Expected pairing flow id");
      }

      const approveResponse = await fetch(
        jsonRequest("/api/v1/sync/pairing/flow/approve-overwrite", { flowId }),
      );
      expect(approveResponse.status).toBe(200);
      await expect(approveResponse.json()).resolves.toEqual({
        flowId,
        phase: {
          phase: "error",
          message:
            "Snapshot schema version 2 is newer than local version 1. Please update the app.",
        },
      });

      const stateResponse = await fetch(jsonRequest("/api/v1/sync/pairing/flow/state", { flowId }));
      expect(stateResponse.status).toBe(500);
      await expect(stateResponse.json()).resolves.toMatchObject({ message: "Flow not found" });
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime pairing flow cancel to local cleanup", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-pairing-cancel-"));
    const deviceSyncRequests: Array<{ url: string; method: string; deviceId: string }> = [];
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      env: {
        CONNECT_API_URL: "https://api.example.test",
        CONNECT_AUTH_URL: "https://auth.example.test",
      },
      marketDataFetch: (async (input, init) => {
        const url = String(input);
        if (url.includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token", refresh_token: "refresh-token" });
        }
        const headers = new Headers(init?.headers);
        deviceSyncRequests.push({
          url,
          method: init?.method ?? "GET",
          deviceId: headers.get("x-wf-device-id") ?? "",
        });
        return Response.json({ success: true, key_version: 2 });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);
    const jsonRequest = (pathName: string, body: Record<string, unknown>) =>
      new Request(`${server.baseUrl}${pathName}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey: "root-key",
          keyVersion: 2,
          deviceSecretKey: "device-secret",
          devicePublicKey: "device-public",
        }),
      );
      await runtime.options.secretService?.setSecret("sync_device_id", "device-runtime");
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb
          .prepare(
            `
            INSERT INTO sync_device_config (
              device_id, key_version, trust_state, last_bootstrap_at, min_snapshot_created_at
            )
            VALUES ('device-runtime', 2, 'trusted', NULL, NULL)
          `,
          )
          .run();
        seedDb
          .prepare(
            `
            INSERT INTO accounts (
              id, name, account_type, "group", currency, is_default, is_active,
              is_archived, tracking_mode
            )
            VALUES ('cancel-account', 'Cancel Account', 'CASH', NULL, 'USD', 0, 1, 0, 'HOLDINGS')
          `,
          )
          .run();
      } finally {
        seedDb.close();
      }

      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const beginResponse = await fetch(
        jsonRequest("/api/v1/sync/pairing/flow/begin", {
          pairingId: "pairing-cancel",
          proof: "proof",
        }),
      );
      expect(beginResponse.status).toBe(200);
      const begin = (await beginResponse.json()) as { flowId?: unknown };
      const flowId = begin.flowId;
      expect(typeof flowId).toBe("string");
      if (typeof flowId !== "string") {
        throw new Error("Expected pairing flow id");
      }

      const cancelResponse = await fetch(
        jsonRequest("/api/v1/sync/pairing/flow/cancel", { flowId }),
      );
      expect(cancelResponse.status).toBe(200);
      await expect(cancelResponse.json()).resolves.toEqual({
        flowId,
        phase: { phase: "success" },
      });

      const stateResponse = await fetch(jsonRequest("/api/v1/sync/pairing/flow/state", { flowId }));
      expect(stateResponse.status).toBe(500);
      await expect(stateResponse.json()).resolves.toMatchObject({ message: "Flow not found" });

      expect(deviceSyncRequests).toEqual([
        {
          url: "https://api.example.test/api/v1/sync/team/devices/device-runtime/pairings/pairing-cancel/confirm",
          method: "POST",
          deviceId: "device-runtime",
        },
        {
          url: "https://api.example.test/api/v1/sync/team/devices/device-runtime/pairings/pairing-cancel/cancel",
          method: "POST",
          deviceId: "device-runtime",
        },
        {
          url: "https://api.example.test/api/v1/sync/team/devices/device-runtime",
          method: "DELETE",
          deviceId: "",
        },
      ]);
      const clearedIdentityRaw = await runtime.options.secretService?.getSecret("sync_identity");
      expect(JSON.parse(clearedIdentityRaw ?? "{}")).toEqual({
        version: 2,
        deviceNonce: "nonce-runtime",
        deviceId: null,
        rootKey: null,
        keyVersion: null,
        deviceSecretKey: null,
        devicePublicKey: null,
      });
      expect(await runtime.options.secretService?.getSecret("sync_device_id")).toBeNull();
      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM sync_device_config")
            .get()?.count,
        ).toBe(0);
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("persists runtime FX asset sync callbacks to sync_outbox", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-fx-sync-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/v1/exchange-rates`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fromCurrency: "EUR",
          toCurrency: "USD",
          rate: "1.23",
          source: "YAHOO",
        }),
      });
      expect(createResponse.status).toBe(200);
      const createdRate = (await createResponse.json()) as { id: string };

      let db = openSqliteDatabase(runtime.dbPath);
      try {
        const assetRows = readRuntimeSyncOutbox(db).filter((row) => row.entity === "asset");
        expect(assetRows).toEqual([
          expect.objectContaining({
            entity: "asset",
            entity_id: createdRate.id,
            op: "create",
          }),
        ]);
        const createPayload = JSON.parse(String(assetRows[0]?.payload)) as Record<string, unknown>;
        expect(createPayload).toMatchObject({
          id: createdRate.id,
          kind: "FX",
          quote_ccy: "USD",
          instrument_type: "FX",
          instrument_symbol: "EUR",
        });
        expect(createPayload).not.toHaveProperty("instrument_key");
      } finally {
        db.close();
      }

      const deleteResponse = await fetch(
        `${server.baseUrl}/api/v1/exchange-rates/${encodeURIComponent(createdRate.id)}`,
        { method: "DELETE" },
      );
      expect(deleteResponse.status).toBe(204);

      db = openSqliteDatabase(runtime.dbPath);
      try {
        const assetRows = readRuntimeSyncOutbox(db).filter((row) => row.entity === "asset");
        expect(assetRows).toEqual([
          expect.objectContaining({
            entity_id: createdRate.id,
            op: "create",
          }),
          expect.objectContaining({
            entity_id: createdRate.id,
            op: "delete",
          }),
        ]);
        expect(JSON.parse(String(assetRows[1]?.payload))).toEqual({ id: createdRate.id });
      } finally {
        db.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime exchange-rate routes to portfolio job execution", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-fx-route-events-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);
    const events: string[] = [];
    const portfolioJobConfigs: PortfolioJobConfig[] = [];
    const originalPortfolioJobService = runtime.options.portfolioJobService;
    if (!originalPortfolioJobService) {
      throw new Error("Runtime exchange-rate route test requires portfolio job service");
    }
    runtime.options.portfolioJobService = {
      enqueuePortfolioJob(jobConfig) {
        portfolioJobConfigs.push(jobConfig);
        return originalPortfolioJobService.enqueuePortfolioJob(jobConfig);
      },
    };
    const unsubscribe = runtime.options.eventBus?.subscribe((event) => {
      events.push(event.name);
    });

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/v1/exchange-rates`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fromCurrency: "EUR",
          toCurrency: "USD",
          rate: "1.23",
          source: "YAHOO",
        }),
      });
      expect(createResponse.status).toBe(200);
      const createdRate = (await createResponse.json()) as { id: string };
      expect(typeof createdRate.id).toBe("string");
      await waitForEventCount(events, "portfolio:update-complete", 1);
      expect(events.filter((event) => event === "portfolio:update-complete")).toHaveLength(1);
      expect(portfolioJobConfigs).toEqual([
        {
          accountIds: null,
          marketSyncMode: { type: "none" },
          snapshotMode: "full",
          valuationMode: "full",
          sinceDate: null,
        },
      ]);

      const updateResponse = await fetch(`${server.baseUrl}/api/v1/exchange-rates`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: createdRate.id,
          fromCurrency: "EUR",
          toCurrency: "USD",
          rate: "1.24",
          source: "MANUAL",
          timestamp: "2026-05-14T16:00:00Z",
        }),
      });
      expect(updateResponse.status).toBe(200);
      await expect(updateResponse.json()).resolves.toMatchObject({
        id: createdRate.id,
        rate: "1.24",
        source: "MANUAL",
      });
      await waitForEventCount(events, "portfolio:update-complete", 2);
      expect(events.filter((event) => event === "portfolio:update-complete")).toHaveLength(2);
      expect(portfolioJobConfigs).toEqual([
        {
          accountIds: null,
          marketSyncMode: { type: "none" },
          snapshotMode: "full",
          valuationMode: "full",
          sinceDate: null,
        },
        {
          accountIds: null,
          marketSyncMode: { type: "none" },
          snapshotMode: "full",
          valuationMode: "full",
          sinceDate: null,
        },
      ]);

      const deleteResponse = await fetch(
        `${server.baseUrl}/api/v1/exchange-rates/${encodeURIComponent(createdRate.id)}`,
        { method: "DELETE" },
      );
      expect(deleteResponse.status).toBe(204);
      await waitForEventCount(events, "portfolio:update-complete", 3);
      expect(events.filter((event) => event === "portfolio:update-complete")).toHaveLength(3);
      expect(portfolioJobConfigs).toEqual([
        {
          accountIds: null,
          marketSyncMode: { type: "none" },
          snapshotMode: "full",
          valuationMode: "full",
          sinceDate: null,
        },
        {
          accountIds: null,
          marketSyncMode: { type: "none" },
          snapshotMode: "full",
          valuationMode: "full",
          sinceDate: null,
        },
        {
          accountIds: null,
          marketSyncMode: { type: "none" },
          snapshotMode: "full",
          valuationMode: "full",
          sinceDate: null,
        },
      ]);
    } finally {
      unsubscribe?.();
      server.stop();
      await runtime.close();
    }
  });

  test("persists runtime direct asset sync callbacks to sync_outbox", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-asset-sync-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });

    try {
      const { assetService } = runtime.options;
      const created = await assetService.createAsset({
        kind: "INVESTMENT",
        quoteMode: "MARKET",
        quoteCcy: "USD",
        name: "Runtime Asset",
        instrumentType: "EQUITY",
        instrumentSymbol: "AAPL",
        instrumentExchangeMic: "XNAS",
      });
      assetService.updateAssetProfile(created.id, {
        notes: "moved",
        instrumentExchangeMic: "XTSE",
      });
      assetService.updateQuoteMode(created.id, "MANUAL");
      assetService.deleteAsset(created.id);

      const db = openSqliteDatabase(runtime.dbPath);
      try {
        const assetRows = readRuntimeSyncOutbox(db).filter((row) => row.entity === "asset");
        expect(assetRows).toEqual([
          expect.objectContaining({
            entity_id: created.id,
            op: "create",
          }),
          expect.objectContaining({
            entity_id: created.id,
            op: "update",
          }),
          expect.objectContaining({
            entity_id: created.id,
            op: "update",
          }),
          expect.objectContaining({
            entity_id: created.id,
            op: "delete",
          }),
        ]);
        const createPayload = JSON.parse(String(assetRows[0]?.payload)) as Record<string, unknown>;
        expect(createPayload).toMatchObject({
          id: created.id,
          kind: "INVESTMENT",
          name: "Runtime Asset",
          quote_mode: "MARKET",
          quote_ccy: "USD",
          instrument_type: "EQUITY",
          instrument_symbol: "AAPL",
          instrument_exchange_mic: "XNAS",
        });
        expect(createPayload).not.toHaveProperty("instrument_key");
        const profilePayload = JSON.parse(String(assetRows[1]?.payload)) as Record<string, unknown>;
        expect(profilePayload).toMatchObject({
          notes: "moved",
          quote_ccy: "CAD",
          instrument_exchange_mic: "XTSE",
        });
        expect(profilePayload).not.toHaveProperty("instrument_key");
        expect(JSON.parse(String(assetRows[2]?.payload))).toMatchObject({ quote_mode: "MANUAL" });
        expect(JSON.parse(String(assetRows[3]?.payload))).toEqual({ id: created.id });

        const assignmentRows = readRuntimeSyncOutbox(db).filter(
          (row) => row.entity === "asset_taxonomy_assignment",
        );
        expect(assignmentRows).toEqual([
          expect.objectContaining({ entity_id: expect.any(String), op: "update" }),
          expect.objectContaining({ entity_id: expect.any(String), op: "update" }),
        ]);
        expect(JSON.parse(String(assignmentRows[0]?.payload))).toMatchObject({
          asset_id: created.id,
          taxonomy_id: "instrument_type",
          category_id: "STOCK_COMMON",
          weight: 10000,
          source: "AUTO",
        });
        expect(JSON.parse(String(assignmentRows[1]?.payload))).toMatchObject({
          asset_id: created.id,
          taxonomy_id: "asset_classes",
          category_id: "EQUITY",
          weight: 10000,
          source: "AUTO",
        });
      } finally {
        db.close();
      }
    } finally {
      await runtime.close();
    }
  });

  test("persists runtime asset route callbacks to sync_outbox", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-asset-routes-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      domainEventDebounceMs: 10_000,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/v1/assets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "PROPERTY",
          quoteMode: "MANUAL",
          quoteCcy: "USD",
          name: "Route Property",
          notes: "core",
          metadata: { location: "primary" },
        }),
      });
      expect(createResponse.status).toBe(200);
      const created = (await createResponse.json()) as { id: string };
      expect(created.id).toEqual(expect.any(String));

      const profileResponse = await fetch(`${server.baseUrl}/api/v1/assets/profile/${created.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Route Property Updated",
          notes: "updated",
          metadata: { location: "secondary" },
        }),
      });
      expect(profileResponse.status).toBe(200);
      await expect(profileResponse.json()).resolves.toMatchObject({
        id: created.id,
        name: "Route Property Updated",
        notes: "updated",
        metadata: { location: "secondary" },
      });

      const quoteModeResponse = await fetch(
        `${server.baseUrl}/api/v1/assets/pricing-mode/${created.id}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pricingMode: "MANUAL" }),
        },
      );
      expect(quoteModeResponse.status).toBe(200);
      await expect(quoteModeResponse.json()).resolves.toMatchObject({
        id: created.id,
        quoteMode: "MANUAL",
      });

      await runtime.domainEventWorker.flush();

      const deleteResponse = await fetch(`${server.baseUrl}/api/v1/assets/${created.id}`, {
        method: "DELETE",
      });
      expect(deleteResponse.status).toBe(204);

      const db = openSqliteDatabase(runtime.dbPath);
      try {
        const assetRows = readRuntimeSyncOutbox(db).filter((row) => row.entity === "asset");
        expect(assetRows.map((row) => [row.entity_id, row.op])).toEqual([
          [created.id, "create"],
          [created.id, "update"],
          [created.id, "update"],
          [created.id, "delete"],
        ]);
        expect(JSON.parse(String(assetRows[0]?.payload))).toMatchObject({
          id: created.id,
          kind: "PROPERTY",
          name: "Route Property",
          notes: "core",
          metadata: JSON.stringify({ location: "primary" }),
          quote_mode: "MANUAL",
          quote_ccy: "USD",
        });
        expect(JSON.parse(String(assetRows[1]?.payload))).toMatchObject({
          id: created.id,
          name: "Route Property Updated",
          notes: "updated",
          metadata: JSON.stringify({ location: "secondary" }),
          quote_mode: "MANUAL",
        });
        expect(JSON.parse(String(assetRows[2]?.payload))).toMatchObject({
          id: created.id,
          quote_mode: "MANUAL",
        });
        expect(JSON.parse(String(assetRows[3]?.payload))).toEqual({ id: created.id });
      } finally {
        db.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("persists runtime alternative asset and quote sync callbacks to sync_outbox", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-alt-asset-sync-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });

    try {
      const { alternativeAssetService } = runtime.options;
      const created = await alternativeAssetService.createAlternativeAsset({
        kind: "property",
        name: "Runtime Property",
        currency: "USD",
        currentValue: "125000.00",
        valueDate: "2026-05-14",
        purchasePrice: "100000.00",
        purchaseDate: "2024-01-01",
      });
      await alternativeAssetService.updateValuation(created.assetId, {
        value: "130000.00",
        date: "2026-05-14",
        notes: "Runtime appraisal",
      });

      const db = openSqliteDatabase(runtime.dbPath);
      try {
        const rows = readRuntimeSyncOutbox(db);
        expect(rows.map((row) => [row.entity, row.entity_id, row.op])).toEqual([
          ["asset", created.assetId, "create"],
          ["quote", expect.any(String), "create"],
          ["quote", created.quoteId, "create"],
          ["quote", created.quoteId, "update"],
        ]);

        const assetPayload = JSON.parse(String(rows[0]?.payload)) as Record<string, unknown>;
        expect(assetPayload).toMatchObject({
          id: created.assetId,
          kind: "PROPERTY",
          name: "Runtime Property",
          quote_mode: "MANUAL",
          quote_ccy: "USD",
        });
        expect(assetPayload).not.toHaveProperty("instrument_key");

        const purchaseQuotePayload = JSON.parse(String(rows[1]?.payload)) as Record<
          string,
          unknown
        >;
        expect(purchaseQuotePayload).toMatchObject({
          asset_id: created.assetId,
          day: "2024-01-01",
          close: "100000.00",
          source: "MANUAL",
        });

        const updatedQuotePayload = JSON.parse(String(rows[3]?.payload)) as Record<string, unknown>;
        expect(updatedQuotePayload).toMatchObject({
          id: created.quoteId,
          asset_id: created.assetId,
          close: "130000.00",
          notes: "Runtime appraisal",
        });
      } finally {
        db.close();
      }
    } finally {
      await runtime.close();
    }
  });

  test("persists runtime alternative asset route callbacks to sync_outbox", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-alt-asset-routes-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);
    const events: string[] = [];
    const unsubscribe = runtime.options.eventBus?.subscribe((event) => {
      events.push(event.name);
    });

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/v1/alternative-assets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "property",
          name: "Route Property",
          currency: "USD",
          currentValue: "125000.00",
          valueDate: "2026-05-14",
          purchasePrice: "100000.00",
          purchaseDate: "2024-01-01",
        }),
      });
      expect(createResponse.status).toBe(200);
      const created = (await createResponse.json()) as { assetId: string; quoteId: string };
      expect(created.assetId).toEqual(expect.any(String));
      expect(created.quoteId).toEqual(expect.any(String));

      const valuationResponse = await fetch(
        `${server.baseUrl}/api/v1/alternative-assets/${created.assetId}/valuation`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            value: "130000.00",
            date: "2026-05-14",
            notes: "Route appraisal",
          }),
        },
      );
      expect(valuationResponse.status).toBe(200);
      await expect(valuationResponse.json()).resolves.toMatchObject({
        quoteId: created.quoteId,
        valuationDate: "2026-05-14",
        value: "130000.00",
      });
      await runtime.domainEventWorker.flush();

      const deleteResponse = await fetch(
        `${server.baseUrl}/api/v1/alternative-assets/${created.assetId}`,
        { method: "DELETE" },
      );
      expect(deleteResponse.status).toBe(204);
      await waitForEventCount(events, "portfolio:update-complete", 3);

      const db = openSqliteDatabase(runtime.dbPath);
      try {
        const rows = readRuntimeSyncOutbox(db).filter(
          (row) => row.entity === "asset" || row.entity === "quote",
        );
        expect(rows.map((row) => [row.entity, row.entity_id, row.op])).toEqual([
          ["asset", created.assetId, "create"],
          ["quote", expect.any(String), "create"],
          ["quote", created.quoteId, "create"],
          ["quote", created.quoteId, "update"],
          ["asset", created.assetId, "delete"],
        ]);
        expect(JSON.parse(String(rows[0]?.payload))).toMatchObject({
          id: created.assetId,
          kind: "PROPERTY",
          name: "Route Property",
          quote_mode: "MANUAL",
          quote_ccy: "USD",
        });
        expect(JSON.parse(String(rows[1]?.payload))).toMatchObject({
          asset_id: created.assetId,
          day: "2024-01-01",
          close: "100000.00",
          source: "MANUAL",
        });
        expect(JSON.parse(String(rows[3]?.payload))).toMatchObject({
          id: created.quoteId,
          asset_id: created.assetId,
          close: "130000.00",
          notes: "Route appraisal",
        });
        expect(JSON.parse(String(rows[4]?.payload))).toEqual({ id: created.assetId });
      } finally {
        db.close();
      }
    } finally {
      unsubscribe?.();
      server.stop();
      await runtime.close();
    }
  });

  test("persists runtime liability link route callbacks to sync_outbox", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-liability-link-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb
          .prepare(
            `
            INSERT INTO assets (
              id, kind, name, display_code, notes, metadata, is_active, quote_mode,
              quote_ccy, instrument_type, instrument_symbol, instrument_exchange_mic,
              provider_config, created_at, updated_at
            )
            VALUES
              ('route-property', 'PROPERTY', 'Route Property', 'Property', NULL, NULL, 1, 'MANUAL',
                'USD', NULL, NULL, NULL, NULL, '2026-05-14T00:00:00Z', '2026-05-14T00:00:00Z'),
              ('route-liability', 'LIABILITY', 'Route Liability', 'Liability', NULL, NULL, 1, 'MANUAL',
                'USD', NULL, NULL, NULL, NULL, '2026-05-14T00:00:00Z', '2026-05-14T00:00:00Z')
          `,
          )
          .run();
      } finally {
        seedDb.close();
      }

      const linkResponse = await fetch(
        `${server.baseUrl}/api/v1/alternative-assets/route-liability/link-liability`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ targetAssetId: "route-property" }),
        },
      );
      expect(linkResponse.status).toBe(204);

      const unlinkResponse = await fetch(
        `${server.baseUrl}/api/v1/alternative-assets/route-liability/link-liability`,
        { method: "DELETE" },
      );
      expect(unlinkResponse.status).toBe(204);

      const db = openSqliteDatabase(runtime.dbPath);
      try {
        const assetRows = readRuntimeSyncOutbox(db).filter((row) => row.entity === "asset");
        expect(assetRows).toEqual([
          expect.objectContaining({
            entity_id: "route-liability",
            op: "update",
          }),
        ]);
        expect(JSON.parse(String(assetRows[0]?.payload))).toMatchObject({
          id: "route-liability",
          kind: "LIABILITY",
          metadata: JSON.stringify({ linked_asset_id: "route-property" }),
        });
      } finally {
        db.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("persists runtime alternative asset metadata route callbacks to sync_outbox", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-alt-metadata-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb
          .prepare(
            `
            INSERT INTO assets (
              id, kind, name, display_code, notes, metadata, is_active, quote_mode,
              quote_ccy, instrument_type, instrument_symbol, instrument_exchange_mic,
              provider_config, created_at, updated_at
            )
            VALUES ('route-collectible', 'COLLECTIBLE', 'Route Watch', 'Collectible', NULL, NULL, 1, 'MANUAL',
              'EUR', NULL, NULL, NULL, NULL, '2026-05-14T00:00:00Z', '2026-05-14T00:00:00Z')
          `,
          )
          .run();
      } finally {
        seedDb.close();
      }

      const updateResponse = await fetch(
        `${server.baseUrl}/api/v1/alternative-assets/route-collectible/metadata`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Route Watch II",
            notes: "insured",
            metadata: {
              purchase_price: "9000.00",
              purchase_date: "2025-01-01",
            },
          }),
        },
      );
      expect(updateResponse.status).toBe(204);

      const db = openSqliteDatabase(runtime.dbPath);
      try {
        const rows = readRuntimeSyncOutbox(db).filter(
          (row) => row.entity === "asset" || row.entity === "quote",
        );
        expect(rows.map((row) => [row.entity, row.op])).toEqual([
          ["asset", "update"],
          ["quote", "create"],
        ]);
        expect(JSON.parse(String(rows[0]?.payload))).toMatchObject({
          id: "route-collectible",
          name: "Route Watch II",
          notes: "insured",
          metadata: JSON.stringify({ purchase_price: "9000.00", purchase_date: "2025-01-01" }),
        });
        expect(JSON.parse(String(rows[1]?.payload))).toMatchObject({
          asset_id: "route-collectible",
          day: "2025-01-01",
          close: "9000.00",
          currency: "EUR",
          source: "MANUAL",
        });
      } finally {
        db.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("persists runtime market-data UUID manual quote deletes to sync_outbox", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-quote-sync-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const quoteId = "018f4b3a-90c4-7d8e-9a1b-3e2f4c5d6a7b";

    try {
      let db = openSqliteDatabase(runtime.dbPath);
      try {
        seedRuntimeAsset(db, "runtime-quote-asset");
        db.prepare(
          `
            INSERT INTO quotes (
              id, asset_id, day, source, close, currency, created_at, timestamp
            )
            VALUES (?, 'runtime-quote-asset', '2026-05-14', 'MANUAL', '10.00', 'USD',
              '2026-05-14T00:00:00Z', '2026-05-14T16:00:00Z')
          `,
        ).run(quoteId);
      } finally {
        db.close();
      }

      runtime.options.marketDataService.deleteQuote?.(quoteId);

      db = openSqliteDatabase(runtime.dbPath);
      try {
        const quoteRows = readRuntimeSyncOutbox(db).filter((row) => row.entity === "quote");
        expect(quoteRows).toEqual([
          expect.objectContaining({
            entity: "quote",
            entity_id: quoteId,
            op: "delete",
          }),
        ]);
        expect(JSON.parse(String(quoteRows[0]?.payload))).toEqual({ id: quoteId });
      } finally {
        db.close();
      }
    } finally {
      await runtime.close();
    }
  });

  test("persists runtime market-data quote delete route callbacks to sync_outbox", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-quote-route-sync-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);
    const quoteId = "018f4b3a-90c4-7d8e-9a1b-3e2f4c5d6a7c";
    const events: string[] = [];
    const unsubscribe = runtime.options.eventBus?.subscribe((event) => {
      events.push(event.name);
    });

    try {
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedRuntimeAsset(seedDb, "runtime-quote-route-asset");
        seedDb
          .prepare(
            `
            INSERT INTO quotes (
              id, asset_id, day, source, close, currency, created_at, timestamp
            )
            VALUES (?, 'runtime-quote-route-asset', '2026-05-14', 'MANUAL', '10.00', 'USD',
              '2026-05-14T00:00:00Z', '2026-05-14T16:00:00Z')
          `,
          )
          .run(quoteId);
      } finally {
        seedDb.close();
      }

      const deleteResponse = await fetch(
        `${server.baseUrl}/api/v1/market-data/quotes/id/${encodeURIComponent(quoteId)}`,
        { method: "DELETE" },
      );
      expect(deleteResponse.status).toBe(204);
      await waitForEventCount(events, "portfolio:update-complete", 1);

      const db = openSqliteDatabase(runtime.dbPath);
      try {
        const quoteRows = readRuntimeSyncOutbox(db).filter((row) => row.entity === "quote");
        expect(quoteRows).toEqual([
          expect.objectContaining({
            entity: "quote",
            entity_id: quoteId,
            op: "delete",
          }),
        ]);
        expect(JSON.parse(String(quoteRows[0]?.payload))).toEqual({ id: quoteId });
      } finally {
        db.close();
      }
    } finally {
      unsubscribe?.();
      server.stop();
      await runtime.close();
    }
  });

  test("persists runtime market-data quote update route callbacks to sync_outbox", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-quote-update-route-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);
    const quoteId = "018f4b3a-90c4-7d8e-9a1b-3e2f4c5d6a7d";
    const replacedQuoteId = "018f4b3a-90c4-7d8e-9a1b-3e2f4c5d6a7f";
    const events: string[] = [];
    const unsubscribe = runtime.options.eventBus?.subscribe((event) => {
      events.push(event.name);
    });

    try {
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedRuntimeAsset(seedDb, "runtime-quote-update-asset");
        seedDb
          .prepare(
            `
            INSERT INTO quotes (
              id, asset_id, day, source, close, currency, created_at, timestamp
            )
            VALUES (?, 'runtime-quote-update-asset', '2026-05-14', 'MANUAL', '10.00', 'USD',
              '2026-05-14T00:00:00Z', '2026-05-14T16:00:00Z')
          `,
          )
          .run(quoteId);
        seedDb
          .prepare(
            `
            INSERT INTO quotes (
              id, asset_id, day, source, close, currency, created_at, timestamp
            )
            VALUES (?, 'runtime-quote-update-asset', '2026-05-15', 'MANUAL', '11.00', 'USD',
              '2026-05-15T00:00:00Z', '2026-05-15T16:00:00Z')
          `,
          )
          .run(replacedQuoteId);
      } finally {
        seedDb.close();
      }

      const updateResponse = await fetch(
        `${server.baseUrl}/api/v1/market-data/quotes/runtime-quote-update-asset`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            timestamp: "2026-05-14T17:00:00Z",
            dataSource: "MANUAL",
            close: "10.25",
            currency: "USD",
            notes: "Route quote update",
          }),
        },
      );
      expect(updateResponse.status).toBe(204);

      const explicitIdUpdateResponse = await fetch(
        `${server.baseUrl}/api/v1/market-data/quotes/runtime-quote-update-asset`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: replacedQuoteId,
            timestamp: "2026-05-15T17:00:00Z",
            dataSource: "MANUAL",
            close: "11.25",
            currency: "USD",
          }),
        },
      );
      expect(explicitIdUpdateResponse.status).toBe(204);
      await waitForEventCount(events, "portfolio:update-complete", 2);

      const db = openSqliteDatabase(runtime.dbPath);
      try {
        const quoteRows = readRuntimeSyncOutbox(db).filter((row) => row.entity === "quote");
        expect(quoteRows).toEqual([
          expect.objectContaining({
            entity: "quote",
            entity_id: quoteId,
            op: "update",
          }),
          expect.objectContaining({
            entity: "quote",
            entity_id: replacedQuoteId,
            op: "delete",
          }),
        ]);
        expect(JSON.parse(String(quoteRows[0]?.payload))).toMatchObject({
          id: quoteId,
          asset_id: "runtime-quote-update-asset",
          day: "2026-05-14",
          source: "MANUAL",
          close: "10.25",
          notes: "Route quote update",
        });
        expect(JSON.parse(String(quoteRows[1]?.payload))).toEqual({ id: replacedQuoteId });
        expect(
          db
            .query<
              { id: string; close: string },
              [string]
            >("SELECT id, close FROM quotes WHERE id = ?")
            .get(replacedQuoteId),
        ).toBeNull();
        expect(
          db
            .query<
              { id: string; close: string },
              [string, string, string]
            >("SELECT id, close FROM quotes WHERE asset_id = ? AND day = ? AND source = ?")
            .get("runtime-quote-update-asset", "2026-05-15", "MANUAL"),
        ).toEqual({
          id: "runtime-quote-update-asset_2026-05-15_MANUAL",
          close: "11.25",
        });
      } finally {
        db.close();
      }
    } finally {
      unsubscribe?.();
      server.stop();
      await runtime.close();
    }
  });

  test("persists runtime market-data quote import route callbacks to sync_outbox", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-quote-import-route-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);
    const quoteId = "018f4b3a-90c4-7d8e-9a1b-3e2f4c5d6a7e";
    const events: string[] = [];
    const unsubscribe = runtime.options.eventBus?.subscribe((event) => {
      events.push(event.name);
    });

    try {
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedRuntimeAsset(seedDb, "runtime-quote-import-asset");
        seedDb
          .prepare(
            `
            INSERT INTO quotes (
              id, asset_id, day, source, close, currency, created_at, timestamp
            )
            VALUES (?, 'runtime-quote-import-asset', '2026-01-06', 'MANUAL', '12.00', 'USD',
              '2026-01-06T00:00:00Z', '2026-01-06T16:00:00Z')
          `,
          )
          .run(quoteId);
      } finally {
        seedDb.close();
      }

      const importResponse = await fetch(`${server.baseUrl}/api/v1/market-data/quotes/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          overwriteExisting: true,
          quotes: [
            {
              symbol: "runtime-quote-import-asset",
              date: "2026-01-05",
              close: 11,
              currency: "USD",
              validationStatus: "valid",
            },
            {
              symbol: "runtime-quote-import-asset",
              date: "2026-01-06",
              close: 12.5,
              currency: "USD",
              validationStatus: "valid",
            },
          ],
        }),
      });
      expect(importResponse.status).toBe(200);
      await expect(importResponse.json()).resolves.toEqual([
        expect.objectContaining({
          symbol: "runtime-quote-import-asset",
          validationStatus: "valid",
        }),
        expect.objectContaining({
          symbol: "runtime-quote-import-asset",
          validationStatus: "valid",
        }),
      ]);
      await waitForEventCount(events, "portfolio:update-complete", 1);

      const db = openSqliteDatabase(runtime.dbPath);
      try {
        const quoteRows = readRuntimeSyncOutbox(db).filter((row) => row.entity === "quote");
        expect(quoteRows).toEqual([
          expect.objectContaining({
            entity: "quote",
            entity_id: quoteId,
            op: "update",
          }),
        ]);
        expect(JSON.parse(String(quoteRows[0]?.payload))).toMatchObject({
          id: quoteId,
          asset_id: "runtime-quote-import-asset",
          day: "2026-01-06",
          source: "MANUAL",
          close: "12.5",
        });
      } finally {
        db.close();
      }
    } finally {
      unsubscribe?.();
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime market-data sync route to portfolio job execution", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-market-sync-route-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);
    const events: string[] = [];
    const portfolioJobConfigs: PortfolioJobConfig[] = [];
    const originalPortfolioJobService = runtime.options.portfolioJobService;
    if (!originalPortfolioJobService) {
      throw new Error("Runtime market-data sync route test requires portfolio job service");
    }
    runtime.options.portfolioJobService = {
      enqueuePortfolioJob(jobConfig) {
        portfolioJobConfigs.push(jobConfig);
        return originalPortfolioJobService.enqueuePortfolioJob(jobConfig);
      },
    };
    const unsubscribe = runtime.options.eventBus?.subscribe((event) => {
      events.push(event.name);
    });

    try {
      const response = await fetch(`${server.baseUrl}/api/v1/market-data/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assetIds: [], refetchAll: false }),
      });
      expect(response.status).toBe(204);
      await waitForEventCount(events, "portfolio:update-complete", 1);
      expect(portfolioJobConfigs).toEqual([
        {
          accountIds: null,
          marketSyncMode: { type: "incremental", asset_ids: [] },
          snapshotMode: "incremental_from_last",
          valuationMode: "incremental_from_last",
          sinceDate: null,
        },
      ]);
      expect(events).toEqual([
        "market:sync-start",
        "market:sync-complete",
        "portfolio:update-start",
        "portfolio:update-complete",
      ]);
    } finally {
      unsubscribe?.();
      server.stop();
      await runtime.close();
    }
  });

  test("persists runtime AI chat sync callbacks to sync_outbox", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-ai-sync-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });

    try {
      let db = openSqliteDatabase(runtime.dbPath);
      try {
        db.prepare(
          `
            INSERT INTO ai_threads (
              id, title, config_snapshot, is_pinned, created_at, updated_at
            )
            VALUES ('ai-thread-1', 'Original', NULL, 0, '2026-05-14T00:00:00Z',
              '2026-05-14T00:00:00Z')
          `,
        ).run();
        db.prepare(
          `
            INSERT INTO ai_messages (id, thread_id, role, content_json, created_at)
            VALUES (
              'ai-message-1',
              'ai-thread-1',
              'assistant',
              '{"schemaVersion":1,"parts":[{"type":"toolResult","toolCallId":"tool-1","data":{"status":"pending"}}]}',
              '2026-05-14T00:00:00Z'
            )
          `,
        ).run();
      } finally {
        db.close();
      }

      runtime.options.aiChatService.updateThread("ai-thread-1", {
        title: "Updated",
        isPinned: true,
      });
      runtime.options.aiChatService.addTag("ai-thread-1", "favorite");
      runtime.options.aiChatService.updateToolResult({
        threadId: "ai-thread-1",
        toolCallId: "tool-1",
        resultPatch: { status: "submitted" },
      });

      db = openSqliteDatabase(runtime.dbPath);
      try {
        const rows = readRuntimeSyncOutbox(db);
        expect(rows.map((row) => [row.entity, row.op])).toEqual([
          ["ai_thread", "update"],
          ["ai_thread_tag", "create"],
          ["ai_message", "update"],
        ]);
        expect(JSON.parse(String(rows[0]?.payload))).toMatchObject({
          id: "ai-thread-1",
          title: "Updated",
          is_pinned: 1,
        });
        expect(JSON.parse(String(rows[1]?.payload))).toMatchObject({
          thread_id: "ai-thread-1",
          tag: "favorite",
        });
        expect(JSON.parse(String(rows[2]?.payload))).toMatchObject({
          id: "ai-message-1",
          thread_id: "ai-thread-1",
        });
        expect(String(rows[2]?.payload)).toContain("submitted");
      } finally {
        db.close();
      }
    } finally {
      await runtime.close();
    }
  });

  test("persists runtime AI chat route callbacks to sync_outbox", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-ai-route-sync-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb
          .prepare(
            `
            INSERT INTO ai_threads (
              id, title, config_snapshot, is_pinned, created_at, updated_at
            )
            VALUES ('ai-thread-route', 'Original Route', NULL, 0, '2026-05-14T00:00:00Z',
              '2026-05-14T00:00:00Z')
          `,
          )
          .run();
        seedDb
          .prepare(
            `
            INSERT INTO ai_messages (id, thread_id, role, content_json, created_at)
            VALUES (
              'ai-message-route',
              'ai-thread-route',
              'assistant',
              '{"schemaVersion":1,"parts":[{"type":"toolResult","toolCallId":"tool-route","data":{"status":"pending"}}]}',
              '2026-05-14T00:00:00Z'
            )
          `,
          )
          .run();
      } finally {
        seedDb.close();
      }

      const updateThreadResponse = await fetch(
        `${server.baseUrl}/api/v1/ai/threads/ai-thread-route`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "Updated Route", isPinned: true }),
        },
      );
      expect(updateThreadResponse.status).toBe(200);
      await expect(updateThreadResponse.json()).resolves.toMatchObject({
        id: "ai-thread-route",
        title: "Updated Route",
        isPinned: true,
      });

      const addTagResponse = await fetch(
        `${server.baseUrl}/api/v1/ai/threads/ai-thread-route/tags`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tag: "favorite" }),
        },
      );
      expect(addTagResponse.status).toBe(204);

      const updateToolResultResponse = await fetch(`${server.baseUrl}/api/v1/ai/tool-result`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: "ai-thread-route",
          toolCallId: "tool-route",
          resultPatch: { status: "submitted" },
        }),
      });
      expect(updateToolResultResponse.status).toBe(200);
      await expect(updateToolResultResponse.json()).resolves.toMatchObject({
        id: "ai-message-route",
        threadId: "ai-thread-route",
      });

      const removeTagResponse = await fetch(
        `${server.baseUrl}/api/v1/ai/threads/ai-thread-route/tags/favorite`,
        { method: "DELETE" },
      );
      expect(removeTagResponse.status).toBe(204);

      const deleteThreadResponse = await fetch(
        `${server.baseUrl}/api/v1/ai/threads/ai-thread-route`,
        { method: "DELETE" },
      );
      expect(deleteThreadResponse.status).toBe(204);

      const db = openSqliteDatabase(runtime.dbPath);
      try {
        const rows = readRuntimeSyncOutbox(db);
        expect(rows.map((row) => [row.entity, row.op])).toEqual([
          ["ai_thread", "update"],
          ["ai_thread_tag", "create"],
          ["ai_message", "update"],
          ["ai_thread_tag", "delete"],
          ["ai_thread", "delete"],
        ]);
        expect(JSON.parse(String(rows[0]?.payload))).toMatchObject({
          id: "ai-thread-route",
          title: "Updated Route",
          is_pinned: 1,
        });
        expect(JSON.parse(String(rows[1]?.payload))).toMatchObject({
          thread_id: "ai-thread-route",
          tag: "favorite",
        });
        expect(JSON.parse(String(rows[2]?.payload))).toMatchObject({
          id: "ai-message-route",
          thread_id: "ai-thread-route",
        });
        expect(String(rows[2]?.payload)).toContain("submitted");
        expect(JSON.parse(String(rows[3]?.payload))).toEqual({ id: rows[1]?.entity_id });
        expect(JSON.parse(String(rows[4]?.payload))).toEqual({ id: "ai-thread-route" });
      } finally {
        db.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("persists runtime activity route callbacks to sync_outbox", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-activity-route-sync-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      domainEventDebounceMs: 10_000,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedRuntimeTransactionActivityHttpInput(seedDb);
      } finally {
        seedDb.close();
      }

      const createResponse = await fetch(`${server.baseUrl}/api/v1/activities`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountId: "tx-account",
          activityType: "DEPOSIT",
          activityDate: "2026-05-14T10:00:00.000Z",
          amount: "100",
          currency: "USD",
        }),
      });
      expect(createResponse.status).toBe(200);
      const created = (await createResponse.json()) as { id: string };
      expect(created.id).toEqual(expect.any(String));

      const updateResponse = await fetch(`${server.baseUrl}/api/v1/activities`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: created.id,
          accountId: "tx-account",
          activityType: "DEPOSIT",
          activityDate: "2026-05-14T10:00:00.000Z",
          amount: "125",
          currency: "USD",
        }),
      });
      expect(updateResponse.status).toBe(200);
      await expect(updateResponse.json()).resolves.toMatchObject({
        id: created.id,
        amount: "125",
        isUserModified: true,
      });

      const deleteResponse = await fetch(`${server.baseUrl}/api/v1/activities/${created.id}`, {
        method: "DELETE",
      });
      expect(deleteResponse.status).toBe(200);

      const db = openSqliteDatabase(runtime.dbPath);
      try {
        const rows = readRuntimeSyncOutbox(db).filter((row) => row.entity === "activity");
        expect(rows.map((row) => [row.entity_id, row.op])).toEqual([
          [created.id, "create"],
          [created.id, "update"],
          [created.id, "delete"],
        ]);
        expect(JSON.parse(String(rows[0]?.payload))).toMatchObject({
          id: created.id,
          account_id: "tx-account",
          activity_type: "DEPOSIT",
          amount: "100",
          source_system: "MANUAL",
          is_user_modified: 0,
        });
        expect(JSON.parse(String(rows[1]?.payload))).toMatchObject({
          id: created.id,
          account_id: "tx-account",
          activity_type: "DEPOSIT",
          amount: "125",
          source_system: "MANUAL",
          is_user_modified: 1,
        });
        expect(JSON.parse(String(rows[2]?.payload))).toEqual({ id: created.id });
      } finally {
        db.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("persists runtime bulk activity route callbacks to sync_outbox", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-bulk-activity-sync-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      domainEventDebounceMs: 10_000,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedRuntimeTransactionActivityInput(seedDb);
      } finally {
        seedDb.close();
      }

      const bulkResponse = await fetch(`${server.baseUrl}/api/v1/activities/bulk`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          creates: [
            {
              id: "bulk-route-temp",
              accountId: "tx-account",
              activityType: "DEPOSIT",
              activityDate: "2026-05-15T10:00:00.000Z",
              amount: "25",
              currency: "USD",
            },
          ],
          updates: [
            {
              id: "tx-deposit",
              accountId: "tx-account",
              activityType: "DEPOSIT",
              activityDate: "2026-05-14T10:00:00.000Z",
              amount: "120",
              currency: "USD",
            },
          ],
          deleteIds: ["tx-buy"],
        }),
      });
      expect(bulkResponse.status).toBe(200);
      const bulkResult = (await bulkResponse.json()) as {
        createdMappings: Array<{ tempId: string; activityId: string }>;
      };
      const createdId = bulkResult.createdMappings[0]?.activityId;
      expect(typeof createdId).toBe("string");
      expect(bulkResult).toMatchObject({
        created: [expect.objectContaining({ amount: "25" })],
        updated: [expect.objectContaining({ id: "tx-deposit", amount: "120" })],
        deleted: [expect.objectContaining({ id: "tx-buy" })],
        errors: [],
        createdMappings: [{ tempId: "bulk-route-temp", activityId: createdId }],
      });

      const db = openSqliteDatabase(runtime.dbPath);
      try {
        const rows = readRuntimeSyncOutbox(db).filter((row) => row.entity === "activity");
        expect(rows.map((row) => [row.entity_id, row.op])).toEqual([
          ["tx-buy", "delete"],
          ["tx-deposit", "update"],
          [createdId, "create"],
        ]);
        expect(JSON.parse(String(rows[0]?.payload))).toEqual({ id: "tx-buy" });
        expect(JSON.parse(String(rows[1]?.payload))).toMatchObject({
          id: "tx-deposit",
          amount: "120",
          is_user_modified: 1,
        });
        expect(JSON.parse(String(rows[2]?.payload))).toMatchObject({
          id: createdId,
          amount: "25",
          source_system: "MANUAL",
          is_user_modified: 0,
        });
      } finally {
        db.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("persists runtime activity import route callbacks to sync_outbox", async () => {
    const appDataDir = mkdtempSync(
      path.join(tmpdir(), "wealthfolio-runtime-activity-import-sync-"),
    );
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      domainEventDebounceMs: 10_000,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedRuntimeTransactionActivityHttpInput(seedDb);
      } finally {
        seedDb.close();
      }

      const importResponse = await fetch(`${server.baseUrl}/api/v1/activities/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          activities: [
            {
              accountId: "tx-account",
              assetId: "tx-asset",
              symbol: "TX",
              activityType: "BUY",
              date: "2026-05-14T12:00:00.000Z",
              quantity: "2",
              unitPrice: "10",
              fee: "1",
              currency: "USD",
              isDraft: false,
              lineNumber: 1,
            },
          ],
        }),
      });
      expect(importResponse.status).toBe(200);
      const importResult = (await importResponse.json()) as {
        importRunId: string;
        activities: Array<{ id: string }>;
      };
      expect(importResult).toMatchObject({
        summary: {
          total: 1,
          imported: 1,
          skipped: 0,
          success: true,
          errorMessage: null,
        },
      });
      expect(typeof importResult.importRunId).toBe("string");
      const activityId = importResult.activities[0]?.id;
      expect(typeof activityId).toBe("string");

      const db = openSqliteDatabase(runtime.dbPath);
      try {
        const rows = readRuntimeSyncOutbox(db).filter(
          (row) => row.entity === "import_run" || row.entity === "activity",
        );
        expect(rows.map((row) => [row.entity, row.entity_id, row.op])).toEqual([
          ["import_run", importResult.importRunId, "create"],
          ["activity", activityId, "create"],
          ["import_run", importResult.importRunId, "update"],
        ]);
        expect(JSON.parse(String(rows[0]?.payload))).toMatchObject({
          id: importResult.importRunId,
          source_system: "csv",
          run_type: "IMPORT",
          status: "RUNNING",
        });
        expect(JSON.parse(String(rows[1]?.payload))).toMatchObject({
          id: activityId,
          account_id: "tx-account",
          asset_id: "tx-asset",
          source_system: "CSV",
          import_run_id: importResult.importRunId,
        });
        expect(JSON.parse(String(rows[2]?.payload))).toMatchObject({
          id: importResult.importRunId,
          status: "APPLIED",
        });
      } finally {
        db.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("persists runtime transfer link route callbacks to sync_outbox", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-transfer-link-sync-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      domainEventDebounceMs: 10_000,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb
          .prepare(
            `
            INSERT INTO accounts (
              id, name, account_type, "group", currency, is_default, is_active,
              is_archived, tracking_mode
            )
            VALUES
              ('transfer-account-in', 'Transfer In', 'SECURITIES', NULL, 'USD', 0, 1, 0, 'TRANSACTIONS'),
              ('transfer-account-out', 'Transfer Out', 'SECURITIES', NULL, 'USD', 0, 1, 0, 'TRANSACTIONS')
          `,
          )
          .run();
        seedDb
          .prepare(
            `
            INSERT INTO activities (
              id, account_id, asset_id, activity_type, subtype, status, activity_date,
              quantity, unit_price, amount, fee, currency, notes, metadata,
              source_system, source_record_id, source_group_id, idempotency_key,
              import_run_id, is_user_modified, needs_review, created_at, updated_at
            )
            VALUES
              ('transfer-in', 'transfer-account-in', NULL, 'TRANSFER_IN', NULL, 'POSTED',
                '2026-05-14T10:00:00.000Z', NULL, NULL, '100', NULL, 'USD', NULL, NULL,
                'PLAID', 'transfer-in-row', NULL, NULL, NULL, 0, 0,
                '2026-05-14T10:00:00.000Z', '2026-05-14T10:00:00.000Z'),
              ('transfer-out', 'transfer-account-out', NULL, 'TRANSFER_OUT', NULL, 'POSTED',
                '2026-05-14T10:00:00.000Z', NULL, NULL, '100', NULL, 'USD', NULL, NULL,
                'PLAID', 'transfer-out-row', NULL, NULL, NULL, 0, 0,
                '2026-05-14T10:00:00.000Z', '2026-05-14T10:00:00.000Z')
          `,
          )
          .run();
      } finally {
        seedDb.close();
      }

      const linkResponse = await fetch(`${server.baseUrl}/api/v1/activities/link`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ activityAId: "transfer-in", activityBId: "transfer-out" }),
      });
      expect(linkResponse.status).toBe(200);
      await expect(linkResponse.json()).resolves.toEqual([
        expect.objectContaining({ id: "transfer-in", isUserModified: true }),
        expect.objectContaining({ id: "transfer-out", isUserModified: true }),
      ]);

      const unlinkResponse = await fetch(`${server.baseUrl}/api/v1/activities/unlink`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ activityAId: "transfer-in", activityBId: "transfer-out" }),
      });
      expect(unlinkResponse.status).toBe(200);
      await expect(unlinkResponse.json()).resolves.toEqual([
        expect.objectContaining({ id: "transfer-in", sourceGroupId: null }),
        expect.objectContaining({ id: "transfer-out", sourceGroupId: null }),
      ]);

      const db = openSqliteDatabase(runtime.dbPath);
      try {
        const rows = readRuntimeSyncOutbox(db).filter((row) => row.entity === "activity");
        expect(rows.map((row) => [row.entity_id, row.op])).toEqual([
          ["transfer-in", "update"],
          ["transfer-out", "update"],
          ["transfer-in", "update"],
          ["transfer-out", "update"],
        ]);
        const linkedGroupId = JSON.parse(String(rows[0]?.payload)).source_group_id;
        expect(typeof linkedGroupId).toBe("string");
        expect(JSON.parse(String(rows[0]?.payload))).toMatchObject({
          id: "transfer-in",
          source_group_id: linkedGroupId,
          is_user_modified: 1,
        });
        expect(JSON.parse(JSON.parse(String(rows[0]?.payload)).metadata).flow).toMatchObject({
          is_external: false,
        });
        expect(JSON.parse(String(rows[1]?.payload))).toMatchObject({
          id: "transfer-out",
          source_group_id: linkedGroupId,
          is_user_modified: 1,
        });
        expect(JSON.parse(JSON.parse(String(rows[1]?.payload)).metadata).flow).toMatchObject({
          is_external: false,
        });
        expect(JSON.parse(String(rows[2]?.payload))).toMatchObject({
          id: "transfer-in",
          source_group_id: null,
          is_user_modified: 1,
        });
        expect(JSON.parse(JSON.parse(String(rows[2]?.payload)).metadata).flow).toMatchObject({
          is_external: true,
        });
        expect(JSON.parse(String(rows[3]?.payload))).toMatchObject({
          id: "transfer-out",
          source_group_id: null,
          is_user_modified: 1,
        });
        expect(JSON.parse(JSON.parse(String(rows[3]?.payload)).metadata).flow).toMatchObject({
          is_external: true,
        });
      } finally {
        db.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("persists runtime account sync callbacks to sync_outbox", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-account-sync-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });

    try {
      const { accountService } = runtime.options;
      const brokerCreated = await accountService.createAccount({
        name: "Brokerage",
        accountType: "SECURITIES",
        group: "Investing",
        currency: "CAD",
        isDefault: true,
        isActive: true,
        trackingMode: "TRANSACTIONS",
        accountNumber: "broker-123",
        meta: '{"source":"broker"}',
        provider: "SNAPTRADE",
        providerAccountId: "provider-account-1",
      });
      const created = await accountService.createAccount({
        name: "Brokerage",
        accountType: "SECURITIES",
        group: "Investing",
        currency: "CAD",
        isDefault: true,
        isActive: true,
        trackingMode: "TRANSACTIONS",
        accountNumber: "123",
        meta: '{"source":"manual"}',
        provider: "MANUAL",
      });
      await accountService.updateAccount({
        id: created.id,
        name: "Brokerage Updated",
        accountType: "CASH",
        group: null,
        isDefault: false,
        isActive: false,
        isArchived: true,
        trackingMode: "HOLDINGS",
      });
      await accountService.deleteAccount(created.id);
      await accountService.deleteAccount("missing-account");

      const db = openSqliteDatabase(runtime.dbPath);
      try {
        const rows = readRuntimeSyncOutbox(db);
        expect(rows.some((row) => row.entity_id === brokerCreated.id)).toBe(false);
        expect(rows.map((row) => [row.entity, row.entity_id, row.op])).toEqual([
          ["account", created.id, "create"],
          ["account", created.id, "update"],
          ["account", created.id, "delete"],
        ]);
        expect(JSON.parse(String(rows[0]?.payload))).toMatchObject({
          id: created.id,
          name: "Brokerage",
          account_type: "SECURITIES",
          group: "Investing",
          currency: "CAD",
          is_default: true,
          is_active: true,
          platform_id: null,
          account_number: "123",
          meta: '{"source":"manual"}',
          provider: "MANUAL",
          provider_account_id: null,
          is_archived: false,
          tracking_mode: "TRANSACTIONS",
        });
        expect(JSON.parse(String(rows[1]?.payload))).toMatchObject({
          id: created.id,
          name: "Brokerage Updated",
          account_type: "CASH",
          group: null,
          currency: "CAD",
          is_default: false,
          is_active: false,
          platform_id: null,
          account_number: "123",
          meta: '{"source":"manual"}',
          provider: "MANUAL",
          provider_account_id: null,
          is_archived: true,
          tracking_mode: "HOLDINGS",
        });
        expect(JSON.parse(String(rows[2]?.payload))).toEqual({ id: created.id });
      } finally {
        db.close();
      }
    } finally {
      await runtime.close();
    }
  });

  test("persists runtime account route callbacks to sync_outbox", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-account-routes-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/v1/accounts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Route Brokerage",
          accountType: "SECURITIES",
          group: "Investing",
          currency: "CAD",
          isDefault: true,
          isActive: true,
          trackingMode: "HOLDINGS",
          accountNumber: "123",
          meta: '{"source":"route"}',
          provider: "MANUAL",
        }),
      });
      expect(createResponse.status).toBe(200);
      const created = (await createResponse.json()) as { id: string };
      expect(created.id).toEqual(expect.any(String));

      const updateResponse = await fetch(`${server.baseUrl}/api/v1/accounts/${created.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Route Brokerage Updated",
          accountType: "CASH",
          group: null,
          isDefault: false,
          isActive: false,
          isArchived: true,
          trackingMode: "HOLDINGS",
        }),
      });
      expect(updateResponse.status).toBe(200);
      await expect(updateResponse.json()).resolves.toMatchObject({
        id: created.id,
        name: "Route Brokerage Updated",
        accountType: "CASH",
        group: null,
        currency: "CAD",
        isDefault: false,
        isActive: false,
        isArchived: true,
        trackingMode: "HOLDINGS",
      });

      const listResponse = await fetch(`${server.baseUrl}/api/v1/accounts?includeArchived=true`);
      expect(listResponse.status).toBe(200);
      await expect(listResponse.json()).resolves.toEqual([
        expect.objectContaining({ id: created.id, name: "Route Brokerage Updated" }),
      ]);

      const deleteResponse = await fetch(`${server.baseUrl}/api/v1/accounts/${created.id}`, {
        method: "DELETE",
      });
      expect(deleteResponse.status).toBe(204);

      const brokerCreateResponse = await fetch(`${server.baseUrl}/api/v1/accounts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Route Broker Account",
          accountType: "SECURITIES",
          group: "Investing",
          currency: "CAD",
          isDefault: false,
          isActive: true,
          trackingMode: "HOLDINGS",
          accountNumber: "broker-123",
          meta: '{"source":"broker"}',
          provider: "SNAPTRADE",
          providerAccountId: "provider-account-route",
        }),
      });
      expect(brokerCreateResponse.status).toBe(200);
      const brokerCreated = (await brokerCreateResponse.json()) as { id: string };
      expect(brokerCreated.id).toEqual(expect.any(String));

      const db = openSqliteDatabase(runtime.dbPath);
      try {
        const rows = readRuntimeSyncOutbox(db).filter((row) => row.entity === "account");
        expect(rows.some((row) => row.entity_id === brokerCreated.id)).toBe(false);
        expect(rows.map((row) => [row.entity_id, row.op])).toEqual([
          [created.id, "create"],
          [created.id, "update"],
          [created.id, "delete"],
        ]);
        expect(JSON.parse(String(rows[0]?.payload))).toMatchObject({
          id: created.id,
          name: "Route Brokerage",
          account_type: "SECURITIES",
          group: "Investing",
          currency: "CAD",
          is_default: true,
          is_active: true,
          account_number: "123",
          meta: '{"source":"route"}',
          provider: "MANUAL",
          provider_account_id: null,
          is_archived: false,
          tracking_mode: "HOLDINGS",
        });
        expect(JSON.parse(String(rows[1]?.payload))).toMatchObject({
          id: created.id,
          name: "Route Brokerage Updated",
          account_type: "CASH",
          group: null,
          currency: "CAD",
          is_default: false,
          is_active: false,
          account_number: "123",
          meta: '{"source":"route"}',
          provider: "MANUAL",
          provider_account_id: null,
          is_archived: true,
          tracking_mode: "HOLDINGS",
        });
        expect(JSON.parse(String(rows[2]?.payload))).toEqual({ id: created.id });
      } finally {
        db.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("persists runtime portfolio route callbacks to sync_outbox", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-portfolio-routes-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      const db = openSqliteDatabase(runtime.dbPath);
      try {
        db.prepare(
          `
            INSERT INTO accounts (
              id, name, account_type, "group", currency, is_default, is_active,
              is_archived, tracking_mode
            )
            VALUES
              ('portfolio-account-1', 'Portfolio One', 'SECURITIES', NULL, 'USD', 0, 1, 0, 'HOLDINGS'),
              ('portfolio-account-2', 'Portfolio Two', 'CASH', NULL, 'USD', 0, 1, 0, 'HOLDINGS')
          `,
        ).run();
      } finally {
        db.close();
      }

      const createResponse = await fetch(`${server.baseUrl}/api/v1/portfolios`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Runtime Portfolio",
          description: null,
          sortOrder: 2,
          accountIds: ["portfolio-account-2", "portfolio-account-1"],
        }),
      });
      expect(createResponse.status).toBe(200);
      const created = (await createResponse.json()) as { id: string; accountIds: string[] };
      expect(created).toMatchObject({
        accountIds: ["portfolio-account-1", "portfolio-account-2"],
      });

      const listResponse = await fetch(`${server.baseUrl}/api/v1/portfolios`);
      expect(listResponse.status).toBe(200);
      await expect(listResponse.json()).resolves.toEqual([
        expect.objectContaining({ id: created.id, name: "Runtime Portfolio" }),
      ]);

      const updateResponse = await fetch(`${server.baseUrl}/api/v1/portfolios/${created.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Updated Portfolio",
          description: "runtime route",
          sortOrder: 1,
          accountIds: ["portfolio-account-1"],
        }),
      });
      expect(updateResponse.status).toBe(200);
      await expect(updateResponse.json()).resolves.toMatchObject({
        id: created.id,
        name: "Updated Portfolio",
        accountIds: ["portfolio-account-1"],
      });

      const deleteResponse = await fetch(`${server.baseUrl}/api/v1/portfolios/${created.id}`, {
        method: "DELETE",
      });
      expect(deleteResponse.status).toBe(204);

      const resultDb = openSqliteDatabase(runtime.dbPath);
      try {
        const rows = readRuntimeSyncOutbox(resultDb).filter(
          (row) => row.entity === "portfolio" || row.entity === "portfolio_account",
        );
        expect(rows.map((row) => [row.entity, row.op])).toEqual([
          ["portfolio", "create"],
          ["portfolio_account", "create"],
          ["portfolio_account", "create"],
          ["portfolio", "update"],
          ["portfolio_account", "delete"],
          ["portfolio_account", "delete"],
          ["portfolio_account", "create"],
          ["portfolio_account", "delete"],
          ["portfolio", "delete"],
        ]);
        expect(rows[0]).toMatchObject({ entity_id: created.id });
        expect(JSON.parse(String(rows.at(-1)?.payload))).toEqual({ id: created.id });
      } finally {
        resultDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("persists runtime holdings snapshot sync callbacks to sync_outbox", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-snapshot-sync-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      marketDataFetch: (() =>
        Promise.reject(new Error("unexpected market data fetch"))) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });

    try {
      let db = openSqliteDatabase(runtime.dbPath);
      try {
        db.prepare(
          `
            INSERT INTO accounts (
              id, name, account_type, "group", currency, is_default, is_active,
              is_archived, tracking_mode
            )
            VALUES ('account-1', 'Runtime Account', 'SECURITIES', NULL, 'USD', 0, 1, 0, 'HOLDINGS')
          `,
        ).run();
      } finally {
        db.close();
      }

      const { holdingsService } = runtime.options;
      if (!holdingsService) {
        throw new Error("Runtime holdings snapshot sync test requires holdings service");
      }

      await holdingsService.saveManualHoldings({
        accountId: "account-1",
        snapshotDate: "2026-04-02",
        holdings: [
          {
            symbol: "SNAP",
            quantity: "2",
            averageCost: "5",
            currency: "USD",
            name: "Runtime Snapshot Asset",
          },
        ],
        cashBalances: { USD: "25" },
      });
      await holdingsService.deleteSnapshot("account-1", "2026-04-02");

      db = openSqliteDatabase(runtime.dbPath);
      try {
        const rows = readRuntimeSyncOutbox(db);
        expect(rows.map((row) => [row.entity, row.op])).toEqual([
          ["asset", "create"],
          ["snapshot", "create"],
          ["snapshot", "create"],
          ["snapshot", "delete"],
        ]);
        expect(JSON.parse(String(rows[0]?.payload))).toMatchObject({
          display_code: "SNAP",
          quote_mode: "MARKET",
        });
        expect(JSON.parse(String(rows[1]?.payload))).toMatchObject({
          account_id: "account-1",
          snapshot_date: "2026-04-02",
          source: "MANUAL_ENTRY",
          net_contribution_base: "0",
          cash_total_account_currency: "0",
          cash_total_base_currency: "0",
        });
        expect(JSON.parse(String(rows[2]?.payload))).toMatchObject({
          account_id: "account-1",
          snapshot_date: "2026-01-02",
          source: "SYNTHETIC",
        });
        expect(JSON.parse(String(rows[3]?.payload))).toEqual({ id: rows[1]?.entity_id });
      } finally {
        db.close();
      }
    } finally {
      await runtime.close();
    }
  });

  test("persists runtime holdings snapshot route callbacks to sync_outbox", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-snapshot-route-sync-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      domainEventDebounceMs: 10_000,
      marketDataFetch: (() =>
        Promise.reject(new Error("unexpected market data fetch"))) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb
          .prepare(
            `
            INSERT INTO accounts (
              id, name, account_type, "group", currency, is_default, is_active,
              is_archived, tracking_mode
            )
            VALUES ('snapshot-route-account', 'Snapshot Route Account', 'SECURITIES', NULL, 'USD', 0, 1, 0, 'HOLDINGS')
          `,
          )
          .run();
        seedRuntimeAsset(seedDb, "snapshot-route-asset");
      } finally {
        seedDb.close();
      }

      const saveResponse = await fetch(`${server.baseUrl}/api/v1/snapshots`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountId: "snapshot-route-account",
          snapshotDate: "2026-04-02",
          holdings: [
            {
              assetId: "snapshot-route-asset",
              symbol: "SNAPROUTE",
              quantity: "2",
              averageCost: "5",
              currency: "USD",
            },
          ],
          cashBalances: { USD: "25" },
        }),
      });
      expect(saveResponse.status).toBe(200);

      const deleteResponse = await fetch(
        `${server.baseUrl}/api/v1/snapshots?accountId=snapshot-route-account&date=2026-04-02`,
        { method: "DELETE" },
      );
      expect(deleteResponse.status).toBe(204);

      const db = openSqliteDatabase(runtime.dbPath);
      try {
        const rows = readRuntimeSyncOutbox(db).filter((row) => row.entity === "snapshot");
        expect(rows.map((row) => [row.op, row.entity_id])).toEqual([
          ["create", expect.any(String)],
          ["create", expect.any(String)],
          ["delete", rows[0]?.entity_id],
        ]);
        expect(JSON.parse(String(rows[0]?.payload))).toMatchObject({
          account_id: "snapshot-route-account",
          snapshot_date: "2026-04-02",
          source: "MANUAL_ENTRY",
          cash_balances: '{"USD":"25"}',
        });
        expect(JSON.parse(String(rows[1]?.payload))).toMatchObject({
          account_id: "snapshot-route-account",
          snapshot_date: "2026-01-02",
          source: "SYNTHETIC",
        });
        expect(JSON.parse(String(rows[2]?.payload))).toEqual({ id: rows[0]?.entity_id });
      } finally {
        db.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("persists runtime import template sync callbacks to sync_outbox", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-template-sync-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });

    try {
      let db = openSqliteDatabase(runtime.dbPath);
      try {
        db.prepare(
          `
            INSERT INTO accounts (
              id, name, account_type, "group", currency, is_default, is_active,
              is_archived, tracking_mode
            )
            VALUES ('account-1', 'Runtime Account', 'SECURITIES', NULL, 'USD', 0, 1, 0, 'HOLDINGS')
          `,
        ).run();
      } finally {
        db.close();
      }

      const { activityService } = runtime.options;
      await activityService.saveImportTemplate?.({
        id: "system-template",
        name: "System",
        scope: "SYSTEM",
        kind: "CSV_ACTIVITY",
        fieldMappings: { date: "Date" },
      });
      await activityService.saveImportTemplate?.({
        id: "custom",
        name: "Custom",
        scope: "USER",
        kind: "CSV_HOLDINGS",
        fieldMappings: { symbol: "Ticker" },
      });
      await activityService.linkAccountTemplate?.("account-1", "custom", "HOLDINGS");
      await activityService.saveImportMapping?.({
        accountId: "account-1",
        contextKind: "CSV_HOLDINGS",
        name: "Account Local",
        fieldMappings: { symbol: "Symbol" },
      });
      await activityService.deleteImportTemplate?.("custom");

      db = openSqliteDatabase(runtime.dbPath);
      try {
        const rows = readRuntimeSyncOutbox(db);
        expect(rows.map((row) => [row.entity, row.op, row.entity_id])).toEqual([
          ["import_template", "update", "custom"],
          ["activity_import_profile", "update", expect.any(String)],
          ["activity_import_profile", "update", rows[1]?.entity_id],
          ["import_template", "delete", "custom"],
        ]);
        expect(JSON.parse(String(rows[0]?.payload))).toMatchObject({
          id: "custom",
          name: "Custom",
          scope: "USER",
          kind: "CSV_HOLDINGS",
          source_system: "",
          config_version: 1,
        });
        expect(JSON.parse(String(rows[1]?.payload))).toMatchObject({
          account_id: "account-1",
          context_kind: "CSV_HOLDINGS",
          source_system: "",
          template_id: "custom",
        });
        expect(JSON.parse(String(rows[2]?.payload))).toMatchObject({
          account_id: "account-1",
          context_kind: "CSV_HOLDINGS",
          source_system: "",
          template_id: "acct_account-1_holdings",
        });
        expect(JSON.parse(String(rows[3]?.payload))).toEqual({ id: "custom" });
      } finally {
        db.close();
      }
    } finally {
      await runtime.close();
    }
  });

  test("persists runtime import template route callbacks to sync_outbox", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-template-routes-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb
          .prepare(
            `
            INSERT INTO accounts (
              id, name, account_type, "group", currency, is_default, is_active,
              is_archived, tracking_mode
            )
            VALUES ('template-route-account', 'Template Route Account', 'SECURITIES', NULL, 'USD', 0, 1, 0, 'HOLDINGS')
          `,
          )
          .run();
      } finally {
        seedDb.close();
      }

      const createResponse = await fetch(`${server.baseUrl}/api/v1/activities/import/templates`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          template: {
            id: "route-custom",
            name: "Route Custom",
            scope: "USER",
            kind: "CSV_HOLDINGS",
            fieldMappings: { symbol: "Ticker" },
            parseConfig: { delimiter: ";" },
          },
        }),
      });
      expect(createResponse.status).toBe(200);
      await expect(createResponse.json()).resolves.toMatchObject({
        id: "route-custom",
        name: "Route Custom",
        kind: "CSV_HOLDINGS",
      });

      const listResponse = await fetch(`${server.baseUrl}/api/v1/activities/import/templates`);
      expect(listResponse.status).toBe(200);
      await expect(listResponse.json()).resolves.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "route-custom" })]),
      );

      const itemResponse = await fetch(
        `${server.baseUrl}/api/v1/activities/import/templates/item?id=route-custom`,
      );
      expect(itemResponse.status).toBe(200);
      await expect(itemResponse.json()).resolves.toMatchObject({
        id: "route-custom",
        parseConfig: expect.objectContaining({ delimiter: ";" }),
      });

      const linkResponse = await fetch(
        `${server.baseUrl}/api/v1/activities/import/templates/link`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            accountId: "template-route-account",
            templateId: "route-custom",
            contextKind: "HOLDINGS",
          }),
        },
      );
      expect(linkResponse.status).toBe(200);
      await expect(linkResponse.json()).resolves.toEqual({ success: true });

      const deleteResponse = await fetch(
        `${server.baseUrl}/api/v1/activities/import/templates?id=route-custom`,
        { method: "DELETE" },
      );
      expect(deleteResponse.status).toBe(200);
      await expect(deleteResponse.json()).resolves.toEqual({ success: true });

      const db = openSqliteDatabase(runtime.dbPath);
      try {
        const rows = readRuntimeSyncOutbox(db).filter(
          (row) => row.entity === "import_template" || row.entity === "activity_import_profile",
        );
        expect(rows.map((row) => [row.entity, row.op, row.entity_id])).toEqual([
          ["import_template", "update", "route-custom"],
          ["activity_import_profile", "update", expect.any(String)],
          ["import_template", "delete", "route-custom"],
        ]);
        expect(JSON.parse(String(rows[0]?.payload))).toMatchObject({
          id: "route-custom",
          name: "Route Custom",
          scope: "USER",
          kind: "CSV_HOLDINGS",
          source_system: "",
          config_version: 1,
        });
        expect(JSON.parse(String(rows[1]?.payload))).toMatchObject({
          account_id: "template-route-account",
          context_kind: "CSV_HOLDINGS",
          source_system: "",
          template_id: "route-custom",
        });
        expect(JSON.parse(String(rows[2]?.payload))).toEqual({ id: "route-custom" });
      } finally {
        db.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("persists runtime import mapping route callbacks to sync_outbox", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-mapping-routes-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb
          .prepare(
            `
            INSERT INTO accounts (
              id, name, account_type, "group", currency, is_default, is_active,
              is_archived, tracking_mode
            )
            VALUES ('mapping-route-account', 'Mapping Route Account', 'SECURITIES', NULL, 'USD', 0, 1, 0, 'HOLDINGS')
          `,
          )
          .run();
      } finally {
        seedDb.close();
      }

      const saveMapping = (fieldName: string) =>
        fetch(`${server.baseUrl}/api/v1/activities/import/mapping`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mapping: {
              accountId: "mapping-route-account",
              contextKind: "ACTIVITY",
              name: "Route Mapping",
              fieldMappings: { date: fieldName },
            },
          }),
        });

      const firstResponse = await saveMapping("Trade Date");
      expect(firstResponse.status).toBe(200);
      await expect(firstResponse.json()).resolves.toMatchObject({
        accountId: "mapping-route-account",
        contextKind: "CSV_ACTIVITY",
        name: "Route Mapping",
      });

      const secondResponse = await saveMapping("Settlement Date");
      expect(secondResponse.status).toBe(200);
      await expect(secondResponse.json()).resolves.toMatchObject({
        accountId: "mapping-route-account",
        contextKind: "CSV_ACTIVITY",
        name: "Route Mapping",
      });

      const getResponse = await fetch(
        `${server.baseUrl}/api/v1/activities/import/mapping?accountId=mapping-route-account&contextKind=ACTIVITY`,
      );
      expect(getResponse.status).toBe(200);
      await expect(getResponse.json()).resolves.toMatchObject({
        accountId: "mapping-route-account",
        contextKind: "CSV_ACTIVITY",
        templateId: "acct_mapping-route-account",
        fieldMappings: { date: "Settlement Date" },
      });

      const db = openSqliteDatabase(runtime.dbPath);
      try {
        const rows = readRuntimeSyncOutbox(db).filter(
          (row) => row.entity === "activity_import_profile",
        );
        expect(rows.map((row) => [row.entity, row.op, row.entity_id])).toEqual([
          ["activity_import_profile", "update", expect.any(String)],
          ["activity_import_profile", "update", rows[0]?.entity_id],
        ]);
        expect(JSON.parse(String(rows[0]?.payload))).toMatchObject({
          account_id: "mapping-route-account",
          context_kind: "CSV_ACTIVITY",
          source_system: "",
          template_id: "acct_mapping-route-account",
        });
        expect(JSON.parse(String(rows[1]?.payload))).toMatchObject({
          account_id: "mapping-route-account",
          context_kind: "CSV_ACTIVITY",
          source_system: "",
          template_id: "acct_mapping-route-account",
        });
      } finally {
        db.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("persists runtime broker sync profile callbacks to sync_outbox", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-broker-profile-sync-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      const response = await fetch(`${server.baseUrl}/api/v1/connect/broker-sync-profile`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountId: "account-1",
          sourceSystem: "snaptrade",
          scope: "ACCOUNT",
          activityRulePatches: { BUY: ["Buy"] },
          securityRulePatches: { AAPL: "AAPL.US" },
          securityRuleMetaPatches: { AAPL: { exchangeMic: "XNAS" } },
        }),
      });
      expect(response.status).toBe(200);

      const db = openSqliteDatabase(runtime.dbPath);
      try {
        const rows = readRuntimeSyncOutbox(db);
        expect(rows.map((row) => [row.entity, row.op, row.entity_id])).toEqual([
          ["import_template", "update", "broker_snaptrade_account-1"],
          ["activity_import_profile", "update", expect.any(String)],
        ]);
        expect(JSON.parse(String(rows[0]?.payload))).toMatchObject({
          id: "broker_snaptrade_account-1",
          name: "snaptrade Profile",
          scope: "USER",
          kind: "BROKER_ACTIVITY",
          source_system: "snaptrade",
        });
        expect(JSON.parse(String(rows[1]?.payload))).toMatchObject({
          account_id: "account-1",
          context_kind: "BROKER_ACTIVITY",
          source_system: "snaptrade",
          template_id: "broker_snaptrade_account-1",
        });
      } finally {
        db.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("persists runtime contribution-limit sync callbacks to sync_outbox", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-limit-sync-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const events: string[] = [];
    const unsubscribe = runtime.options.eventBus?.subscribe((event) => {
      events.push(event.name);
    });

    try {
      const { contributionLimitService } = runtime.options;
      const created = await contributionLimitService.createContributionLimit({
        groupName: "TFSA",
        contributionYear: 2027,
        limitAmount: 7_000,
        accountIds: "account-1",
        startDate: "2027-01-01",
        endDate: "2027-12-31",
      });
      await contributionLimitService.updateContributionLimit(created.id, {
        groupName: "FHSA",
        contributionYear: 2028,
        limitAmount: 8_000,
      });
      await contributionLimitService.deleteContributionLimit(created.id);
      await contributionLimitService.deleteContributionLimit("missing-limit");
      await waitForEventCount(events, "portfolio:update-complete", 4);

      const db = openSqliteDatabase(runtime.dbPath);
      try {
        const rows = readRuntimeSyncOutbox(db);
        expect(rows.map((row) => [row.entity, row.entity_id, row.op])).toEqual([
          ["contribution_limit", created.id, "create"],
          ["contribution_limit", created.id, "update"],
          ["contribution_limit", created.id, "delete"],
        ]);
        expect(JSON.parse(String(rows[0]?.payload))).toMatchObject({
          id: created.id,
          group_name: "TFSA",
          contribution_year: 2027,
          limit_amount: 7_000,
          account_ids: "account-1",
          start_date: "2027-01-01",
          end_date: "2027-12-31",
        });
        expect(JSON.parse(String(rows[1]?.payload))).toMatchObject({
          id: created.id,
          group_name: "FHSA",
          contribution_year: 2028,
          limit_amount: 8_000,
          account_ids: null,
          start_date: null,
          end_date: null,
        });
        expect(JSON.parse(String(rows[2]?.payload))).toEqual({ id: created.id });
        expect(events.filter((event) => event === "portfolio:update-start")).toHaveLength(4);
        expect(events.filter((event) => event === "portfolio:update-complete")).toHaveLength(4);
      } finally {
        db.close();
      }
    } finally {
      unsubscribe?.();
      await runtime.close();
    }
  });

  test("persists runtime contribution-limit route callbacks to sync_outbox", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-limit-routes-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const events: string[] = [];
    const unsubscribe = runtime.options.eventBus?.subscribe((event) => {
      events.push(event.name);
    });
    const server = startBackendServer(config, runtime.options);

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/v1/limits`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          groupName: "TFSA",
          contributionYear: 2027,
          limitAmount: 7_000,
          accountIds: "account-1",
          startDate: "2027-01-01",
          endDate: "2027-12-31",
        }),
      });
      expect(createResponse.status).toBe(200);
      const created = (await createResponse.json()) as { id: string };

      const listResponse = await fetch(`${server.baseUrl}/api/v1/limits`);
      expect(listResponse.status).toBe(200);
      await expect(listResponse.json()).resolves.toEqual([
        expect.objectContaining({ id: created.id, groupName: "TFSA" }),
      ]);

      const updateResponse = await fetch(`${server.baseUrl}/api/v1/limits/${created.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          groupName: "FHSA",
          contributionYear: 2028,
          limitAmount: 8_000,
          accountIds: null,
          startDate: null,
          endDate: null,
        }),
      });
      expect(updateResponse.status).toBe(200);
      await expect(updateResponse.json()).resolves.toMatchObject({
        id: created.id,
        groupName: "FHSA",
        contributionYear: 2028,
      });

      const deleteResponse = await fetch(`${server.baseUrl}/api/v1/limits/${created.id}`, {
        method: "DELETE",
      });
      expect(deleteResponse.status).toBe(204);
      await waitForEventCount(events, "portfolio:update-complete", 3);

      const db = openSqliteDatabase(runtime.dbPath);
      try {
        const rows = readRuntimeSyncOutbox(db).filter((row) => row.entity === "contribution_limit");
        expect(rows.map((row) => [row.entity_id, row.op])).toEqual([
          [created.id, "create"],
          [created.id, "update"],
          [created.id, "delete"],
        ]);
        expect(JSON.parse(String(rows[0]?.payload))).toMatchObject({
          id: created.id,
          group_name: "TFSA",
          contribution_year: 2027,
          limit_amount: 7_000,
          account_ids: "account-1",
        });
        expect(JSON.parse(String(rows[1]?.payload))).toMatchObject({
          id: created.id,
          group_name: "FHSA",
          contribution_year: 2028,
          limit_amount: 8_000,
          account_ids: null,
        });
        expect(JSON.parse(String(rows[2]?.payload))).toEqual({ id: created.id });
      } finally {
        db.close();
      }
    } finally {
      unsubscribe?.();
      server.stop();
      await runtime.close();
    }
  });

  test("persists runtime custom provider sync callbacks to sync_outbox", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-provider-sync-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/v1/custom-providers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: "runtime-provider",
          name: "Runtime Provider",
          sources: [
            {
              kind: "latest",
              format: "json",
              url: "https://example.test/latest/{SYMBOL}",
              pricePath: "$.price",
            },
          ],
        }),
      });
      expect(createResponse.status).toBe(200);
      await expect(createResponse.json()).resolves.toMatchObject({
        id: "runtime-provider",
        sources: [expect.objectContaining({ id: "runtime-provider:latest" })],
      });

      const updateResponse = await fetch(
        `${server.baseUrl}/api/v1/custom-providers/runtime-provider`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Runtime Provider Updated" }),
        },
      );
      expect(updateResponse.status).toBe(200);

      const deleteResponse = await fetch(
        `${server.baseUrl}/api/v1/custom-providers/runtime-provider`,
        { method: "DELETE" },
      );
      expect(deleteResponse.status).toBe(204);

      const db = openSqliteDatabase(runtime.dbPath);
      try {
        const providerRows = readRuntimeSyncOutbox(db).filter(
          (row) => row.entity === "custom_provider",
        );
        expect(providerRows).toEqual([
          expect.objectContaining({ op: "create" }),
          expect.objectContaining({ op: "update" }),
          expect.objectContaining({ op: "delete" }),
        ]);
        expect(new Set(providerRows.map((row) => row.entity_id)).size).toBe(1);
        const providerUuid = String(providerRows[0]?.entity_id);
        expect(JSON.parse(String(providerRows[0]?.payload))).toMatchObject({
          id: providerUuid,
          code: "runtime-provider",
          name: "Runtime Provider",
          enabled: true,
          priority: 50,
        });
        expect(JSON.parse(String(providerRows[1]?.payload))).toMatchObject({
          id: providerUuid,
          code: "runtime-provider",
          name: "Runtime Provider Updated",
        });
        expect(JSON.parse(String(providerRows[2]?.payload))).toEqual({ id: providerUuid });
      } finally {
        db.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime custom provider test-source route to fetch and extraction", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-provider-test-"));
    const fetchCalls: string[] = [];
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      marketDataFetch: ((input: RequestInfo | URL) => {
        fetchCalls.push(String(input));
        return Promise.resolve(
          new Response(JSON.stringify({ price: 123.45, currency: "USD" }), {
            headers: { "content-type": "application/json" },
          }),
        );
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      const response = await fetch(`${server.baseUrl}/api/v1/custom-providers/test-source`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          format: "json",
          url: "https://example.test/quote/{SYMBOL}",
          pricePath: "$.price",
          currencyPath: "$.currency",
          symbol: "AAPL",
        }),
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        success: true,
        statusCode: 200,
        price: 123.45,
        currency: "USD",
        error: null,
        rawResponse: '{"price":123.45,"currency":"USD"}',
      });
      expect(fetchCalls).toEqual(["https://example.test/quote/AAPL"]);
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("persists runtime taxonomy sync callbacks to sync_outbox", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-taxonomy-sync-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });

    try {
      const { taxonomyService } = runtime.options;
      if (!taxonomyService) {
        throw new Error("Runtime taxonomy sync test requires taxonomy service");
      }

      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedRuntimeAsset(seedDb, "runtime-taxonomy-asset");
      } finally {
        seedDb.close();
      }

      const taxonomy = await taxonomyService.createTaxonomy({
        id: "runtime-taxonomy",
        name: "Runtime Taxonomy",
        color: "#4385be",
        description: null,
        isSystem: false,
        isSingleSelect: false,
        sortOrder: 99,
      });
      const category = await taxonomyService.createCategory({
        id: "runtime-category",
        taxonomyId: taxonomy.id,
        name: "Runtime Category",
        key: "runtime",
        color: "#879a39",
        sortOrder: 1,
      });
      const assignment = await taxonomyService.assignAssetToCategory({
        id: "runtime-assignment",
        assetId: "runtime-taxonomy-asset",
        taxonomyId: taxonomy.id,
        categoryId: category.id,
        weight: 5_000,
        source: "manual",
      });
      await expect(taxonomyService.removeAssetAssignment(assignment.id)).resolves.toBe(1);
      await expect(taxonomyService.deleteTaxonomy(taxonomy.id)).resolves.toBeGreaterThan(0);

      const db = openSqliteDatabase(runtime.dbPath);
      try {
        const rows = readRuntimeSyncOutbox(db);
        const taxonomyRows = rows.filter((row) => row.entity === "custom_taxonomy");
        expect(taxonomyRows).toEqual([
          expect.objectContaining({ entity_id: taxonomy.id, op: "create" }),
          expect.objectContaining({ entity_id: taxonomy.id, op: "update" }),
          expect.objectContaining({ entity_id: taxonomy.id, op: "delete" }),
        ]);
        const createPayload = JSON.parse(String(taxonomyRows[0]?.payload));
        expect(createPayload).toMatchObject({
          taxonomy: {
            id: taxonomy.id,
            is_system: 0,
            is_single_select: 0,
            sort_order: 99,
          },
          categories: [],
        });
        const updatePayload = JSON.parse(String(taxonomyRows[1]?.payload));
        expect(updatePayload).toMatchObject({
          taxonomy: { id: taxonomy.id },
          categories: [
            expect.objectContaining({
              id: category.id,
              taxonomy_id: taxonomy.id,
              sort_order: 1,
            }),
          ],
        });
        expect(JSON.parse(String(taxonomyRows[2]?.payload))).toEqual({ id: taxonomy.id });

        const assignmentRows = rows.filter((row) => row.entity === "asset_taxonomy_assignment");
        expect(assignmentRows).toEqual([
          expect.objectContaining({ entity_id: assignment.id, op: "update" }),
          expect.objectContaining({ entity_id: assignment.id, op: "delete" }),
        ]);
        expect(JSON.parse(String(assignmentRows[0]?.payload))).toMatchObject({
          id: assignment.id,
          asset_id: "runtime-taxonomy-asset",
          taxonomy_id: taxonomy.id,
          category_id: category.id,
          weight: 5_000,
          source: "manual",
        });
        expect(JSON.parse(String(assignmentRows[1]?.payload))).toEqual({ id: assignment.id });
      } finally {
        db.close();
      }
    } finally {
      await runtime.close();
    }
  });

  test("persists runtime taxonomy route callbacks to sync_outbox", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-taxonomy-routes-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedRuntimeAsset(seedDb, "runtime-taxonomy-asset");
      } finally {
        seedDb.close();
      }

      const createResponse = await fetch(`${server.baseUrl}/api/v1/taxonomies`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "runtime-taxonomy-route",
          name: "Runtime Route Taxonomy",
          color: "#4385be",
          description: null,
          isSystem: false,
          isSingleSelect: false,
          sortOrder: 99,
        }),
      });
      expect(createResponse.status).toBe(200);
      const taxonomy = (await createResponse.json()) as { id: string };

      const categoryResponse = await fetch(`${server.baseUrl}/api/v1/taxonomies/categories`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "runtime-category-route",
          taxonomyId: taxonomy.id,
          name: "Runtime Route Category",
          key: "runtime",
          color: "#879a39",
          description: null,
          sortOrder: 1,
        }),
      });
      expect(categoryResponse.status).toBe(200);
      const category = (await categoryResponse.json()) as { id: string };

      const assignmentResponse = await fetch(`${server.baseUrl}/api/v1/taxonomies/assignments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "runtime-assignment-route",
          assetId: "runtime-taxonomy-asset",
          taxonomyId: taxonomy.id,
          categoryId: category.id,
          weight: 5_000,
          source: "manual",
        }),
      });
      expect(assignmentResponse.status).toBe(200);
      const assignment = (await assignmentResponse.json()) as { id: string };

      const deleteAssignmentResponse = await fetch(
        `${server.baseUrl}/api/v1/taxonomies/assignments/${assignment.id}`,
        { method: "DELETE" },
      );
      expect(deleteAssignmentResponse.status).toBe(204);
      const deleteTaxonomyResponse = await fetch(
        `${server.baseUrl}/api/v1/taxonomies/${taxonomy.id}`,
        {
          method: "DELETE",
        },
      );
      expect(deleteTaxonomyResponse.status).toBe(204);

      const db = openSqliteDatabase(runtime.dbPath);
      try {
        const rows = readRuntimeSyncOutbox(db);
        const taxonomyRows = rows.filter((row) => row.entity === "custom_taxonomy");
        expect(taxonomyRows).toEqual([
          expect.objectContaining({ entity_id: taxonomy.id, op: "create" }),
          expect.objectContaining({ entity_id: taxonomy.id, op: "update" }),
          expect.objectContaining({ entity_id: taxonomy.id, op: "delete" }),
        ]);
        const assignmentRows = rows.filter((row) => row.entity === "asset_taxonomy_assignment");
        expect(assignmentRows).toEqual([
          expect.objectContaining({ entity_id: assignment.id, op: "update" }),
          expect.objectContaining({ entity_id: assignment.id, op: "delete" }),
        ]);
      } finally {
        db.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("persists runtime goal route callbacks to sync_outbox", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-goal-routes-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb
          .prepare(
            `
            INSERT INTO accounts (
              id, name, account_type, "group", currency, is_default, is_active,
              is_archived, tracking_mode
            )
            VALUES ('goal-route-account', 'Goal Route Account', 'CASH', NULL, 'USD', 0, 1, 0, 'HOLDINGS')
          `,
          )
          .run();
      } finally {
        seedDb.close();
      }

      const createResponse = await fetch(`${server.baseUrl}/api/v1/goals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          goalType: "custom_save_up",
          title: "Goal Route",
          targetAmount: 1_000,
          currency: "USD",
        }),
      });
      expect(createResponse.status).toBe(200);
      const created = (await createResponse.json()) as { id: string };
      expect(created.id).toEqual(expect.any(String));
      const goalId = created.id;

      const fundingResponse = await fetch(`${server.baseUrl}/api/v1/goals/${goalId}/funding`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([{ accountId: "goal-route-account", sharePercent: 100 }]),
      });
      expect(fundingResponse.status).toBe(200);

      const updateResponse = await fetch(`${server.baseUrl}/api/v1/goals`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...created,
          title: "Goal Route Updated",
          targetAmount: 2_000,
        }),
      });
      expect(updateResponse.status).toBe(200);
      await expect(updateResponse.json()).resolves.toMatchObject({
        id: goalId,
        title: "Goal Route Updated",
        targetAmount: 2_000,
      });

      const clearFundingResponse = await fetch(`${server.baseUrl}/api/v1/goals/${goalId}/funding`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([]),
      });
      expect(clearFundingResponse.status).toBe(200);
      await expect(clearFundingResponse.json()).resolves.toEqual([]);

      const deleteResponse = await fetch(`${server.baseUrl}/api/v1/goals/${goalId}`, {
        method: "DELETE",
      });
      expect(deleteResponse.status).toBe(204);

      const db = openSqliteDatabase(runtime.dbPath);
      try {
        const rows = readRuntimeSyncOutbox(db).filter(
          (row) => row.entity === "goal" || row.entity === "goals_allocation",
        );
        expect(rows.map((row) => [row.entity, row.op])).toEqual([
          ["goal", "create"],
          ["goals_allocation", "create"],
          ["goal", "update"],
          ["goals_allocation", "delete"],
          ["goal", "delete"],
        ]);
        expect(JSON.parse(String(rows[0]?.payload))).toMatchObject({
          id: goalId,
          title: "Goal Route",
          target_amount: 1_000,
        });
        expect(JSON.parse(String(rows[1]?.payload))).toMatchObject({
          goal_id: goalId,
          account_id: "goal-route-account",
          share_percent: 100,
        });
        expect(JSON.parse(String(rows[2]?.payload))).toMatchObject({
          id: goalId,
          title: "Goal Route Updated",
          target_amount: 2_000,
        });
        expect(JSON.parse(String(rows[3]?.payload))).toEqual({
          id: rows[1]?.entity_id,
        });
        expect(JSON.parse(String(rows.at(-1)?.payload))).toEqual({ id: goalId });
      } finally {
        db.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("persists runtime goal plan route callbacks to sync_outbox", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-goal-plan-routes-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      const createResponse = await fetch(`${server.baseUrl}/api/v1/goals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          goalType: "custom_save_up",
          title: "Goal Plan Route",
          targetAmount: 1_000,
          currency: "USD",
        }),
      });
      expect(createResponse.status).toBe(200);
      const created = (await createResponse.json()) as { id: string };
      expect(created.id).toEqual(expect.any(String));
      const goalId = created.id;

      const settingsJson = JSON.stringify({
        monthlyContribution: 100,
        frontendOnly: { id: "draft-1", flags: ["keep"] },
      });
      const createPlanResponse = await fetch(`${server.baseUrl}/api/v1/goals/plan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          goalId,
          planKind: "save_up",
          settingsJson,
          summaryJson: null,
        }),
      });
      expect(createPlanResponse.status).toBe(200);
      await expect(createPlanResponse.json()).resolves.toMatchObject({
        goalId,
        planKind: "save_up",
        plannerMode: null,
        settingsJson,
        summaryJson: "{}",
        version: 1,
      });

      const getPlanResponse = await fetch(`${server.baseUrl}/api/v1/goals/${goalId}/plan`);
      expect(getPlanResponse.status).toBe(200);
      await expect(getPlanResponse.json()).resolves.toMatchObject({
        goalId,
        settingsJson,
        version: 1,
      });

      const updatedSettingsJson = JSON.stringify({
        monthlyContribution: 125,
        frontendOnly: { id: "draft-1", flags: ["keep", "updated"] },
      });
      const updatePlanResponse = await fetch(`${server.baseUrl}/api/v1/goals/plan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          goalId,
          planKind: "save_up",
          settingsJson: updatedSettingsJson,
          summaryJson: '{"progress":0.25}',
        }),
      });
      expect(updatePlanResponse.status).toBe(200);
      await expect(updatePlanResponse.json()).resolves.toMatchObject({
        goalId,
        settingsJson: updatedSettingsJson,
        summaryJson: '{"progress":0.25}',
        version: 2,
      });

      const deletePlanResponse = await fetch(`${server.baseUrl}/api/v1/goals/${goalId}/plan`, {
        method: "DELETE",
      });
      expect(deletePlanResponse.status).toBe(204);

      const getDeletedPlanResponse = await fetch(`${server.baseUrl}/api/v1/goals/${goalId}/plan`);
      expect(getDeletedPlanResponse.status).toBe(200);
      await expect(getDeletedPlanResponse.json()).resolves.toBeNull();

      const db = openSqliteDatabase(runtime.dbPath);
      try {
        const rows = readRuntimeSyncOutbox(db).filter((row) => row.entity === "goal_plan");
        expect(rows.map((row) => row.op)).toEqual(["create", "update", "delete"]);
        expect(JSON.parse(String(rows[0]?.payload))).toMatchObject({
          goal_id: goalId,
          plan_kind: "save_up",
          settings_json: settingsJson,
          summary_json: "{}",
          version: 1,
        });
        expect(JSON.parse(String(rows[1]?.payload))).toMatchObject({
          goal_id: goalId,
          plan_kind: "save_up",
          settings_json: updatedSettingsJson,
          summary_json: '{"progress":0.25}',
          version: 2,
        });
        expect(JSON.parse(String(rows[2]?.payload))).toEqual({ id: goalId });
      } finally {
        db.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime domain events to portfolio job execution", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-domain-events-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      domainEventDebounceMs: 10_000,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const events: string[] = [];
    const unsubscribe = runtime.options.eventBus?.subscribe((event) => {
      events.push(event.name);
    });

    try {
      const { goalService } = runtime.options;
      if (!goalService) {
        throw new Error("Runtime domain event test requires goal service");
      }
      const db = openSqliteDatabase(runtime.dbPath);
      try {
        seedRuntimePortfolioJobInput(db);
      } finally {
        db.close();
      }
      const goal = await goalService.createGoal({
        goalType: "custom_save_up",
        title: "Event Goal",
        targetAmount: 50,
        currency: "USD",
      });
      await goalService.saveGoalFunding(goal.id, [{ accountId: "account-1", sharePercent: 100 }]);

      runtime.options.eventBus?.publish({
        name: HOLDINGS_CHANGED_EVENT,
        payload: { account_ids: ["account-1"], asset_ids: ["asset-1"] },
      });
      await runtime.close();

      const resultDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(readRuntimeValuation(resultDb, "account-1", "2026-05-16")).toMatchObject({
          cash_balance: "5",
          investment_market_value: "20",
          total_value: "25",
        });
        expect(readRuntimeValuation(resultDb, "TOTAL", "2026-05-16")).toMatchObject({
          cash_balance: "5",
          investment_market_value: "20",
          total_value: "25",
        });
        expect(readRuntimeGoalSummary(resultDb, goal.id)).toEqual({
          summary_current_value: 25,
          summary_progress: 0.5,
        });
      } finally {
        resultDb.close();
      }
      expect(events).toEqual([
        HOLDINGS_CHANGED_EVENT,
        "market:sync-start",
        "market:sync-complete",
        "portfolio:update-start",
        "portfolio:update-complete",
      ]);
    } finally {
      unsubscribe?.();
      await runtime.close();
    }
  });

  test("wires runtime snapshot saves to portfolio job execution", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-snapshot-events-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      domainEventDebounceMs: 10_000,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const events: string[] = [];
    const unsubscribe = runtime.options.eventBus?.subscribe((event) => {
      events.push(event.name);
    });

    try {
      const { goalService } = runtime.options;
      if (!goalService) {
        throw new Error("Runtime snapshot event test requires goal service");
      }
      const db = openSqliteDatabase(runtime.dbPath);
      try {
        seedRuntimePortfolioJobInput(db);
      } finally {
        db.close();
      }
      const goal = await goalService.createGoal({
        goalType: "custom_save_up",
        title: "Snapshot Event Goal",
        targetAmount: 50,
        currency: "USD",
      });
      await goalService.saveGoalFunding(goal.id, [{ accountId: "account-1", sharePercent: 100 }]);

      const server = startBackendServer(config, runtime.options);
      try {
        const saveResponse = await fetch(`${server.baseUrl}/api/v1/snapshots`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            accountId: "account-1",
            snapshotDate: "2026-05-17",
            holdings: [
              {
                assetId: "asset-1",
                symbol: "RUNTIME",
                quantity: "3",
                currency: "USD",
                averageCost: "6",
              },
            ],
            cashBalances: { USD: "7" },
          }),
        });
        expect(saveResponse.status).toBe(200);
      } finally {
        server.stop();
      }

      await runtime.close();

      const resultDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(readRuntimeValuation(resultDb, "account-1", "2026-05-17")).toMatchObject({
          cash_balance: "7",
          investment_market_value: "18",
          total_value: "25",
        });
        expect(readRuntimeValuation(resultDb, "TOTAL", "2026-05-17")).toMatchObject({
          cash_balance: "7",
          investment_market_value: "18",
          total_value: "25",
        });
        expect(readRuntimeGoalSummary(resultDb, goal.id)).toEqual({
          summary_current_value: 25,
          summary_progress: 0.5,
        });
      } finally {
        resultDb.close();
      }
      expect(events).toEqual([
        HOLDINGS_CHANGED_EVENT,
        MANUAL_SNAPSHOT_SAVED_EVENT,
        "market:sync-start",
        "market:sync-complete",
        "portfolio:update-start",
        "portfolio:update-complete",
      ]);
    } finally {
      unsubscribe?.();
      await runtime.close();
    }
  });

  test("wires runtime snapshot imports to portfolio job execution", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-snapshot-imports-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      domainEventDebounceMs: 10_000,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const events: string[] = [];
    const unsubscribe = runtime.options.eventBus?.subscribe((event) => {
      events.push(event.name);
    });

    try {
      const db = openSqliteDatabase(runtime.dbPath);
      try {
        seedRuntimePortfolioJobInput(db);
      } finally {
        db.close();
      }

      const server = startBackendServer(config, runtime.options);
      try {
        const importResponse = await fetch(`${server.baseUrl}/api/v1/snapshots/import`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            accountId: "account-1",
            snapshots: [
              {
                date: "2026-05-17",
                positions: [
                  {
                    assetId: "asset-1",
                    symbol: "RUNTIME",
                    quantity: "3",
                    avgCost: "6",
                    currency: "USD",
                  },
                ],
                cashBalances: { USD: "7" },
              },
            ],
          }),
        });
        expect(importResponse.status).toBe(200);
        await expect(importResponse.json()).resolves.toEqual({
          snapshotsImported: 1,
          snapshotsFailed: 0,
          errors: [],
        });
      } finally {
        server.stop();
      }

      await runtime.close();

      const resultDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(readRuntimeValuation(resultDb, "account-1", "2026-05-17")).toMatchObject({
          cash_balance: "7",
          investment_market_value: "18",
          total_value: "25",
        });
        expect(readRuntimeValuation(resultDb, "TOTAL", "2026-05-17")).toMatchObject({
          cash_balance: "7",
          investment_market_value: "18",
          total_value: "25",
        });
      } finally {
        resultDb.close();
      }
      expect(events).toEqual([
        HOLDINGS_CHANGED_EVENT,
        MANUAL_SNAPSHOT_SAVED_EVENT,
        "market:sync-start",
        "market:sync-complete",
        "portfolio:update-start",
        "portfolio:update-complete",
      ]);
    } finally {
      unsubscribe?.();
      await runtime.close();
    }
  });

  test("wires runtime snapshot deletes to portfolio job execution", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-snapshot-deletes-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      domainEventDebounceMs: 10_000,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const events: string[] = [];
    const unsubscribe = runtime.options.eventBus?.subscribe((event) => {
      events.push(event.name);
    });

    try {
      const db = openSqliteDatabase(runtime.dbPath);
      try {
        seedRuntimePortfolioJobInput(db);
      } finally {
        db.close();
      }

      const server = startBackendServer(config, runtime.options);
      try {
        const saveResponse = await fetch(`${server.baseUrl}/api/v1/snapshots`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            accountId: "account-1",
            snapshotDate: "2026-05-17",
            holdings: [
              {
                assetId: "asset-1",
                symbol: "RUNTIME",
                quantity: "3",
                currency: "USD",
                averageCost: "6",
              },
            ],
            cashBalances: { USD: "7" },
          }),
        });
        expect(saveResponse.status).toBe(200);
        await runtime.domainEventWorker.flush();

        const savedDb = openSqliteDatabase(runtime.dbPath);
        try {
          expect(readRuntimeValuation(savedDb, "account-1", "2026-05-17")).toMatchObject({
            cash_balance: "7",
            investment_market_value: "18",
            total_value: "25",
          });
          expect(readRuntimeValuation(savedDb, "TOTAL", "2026-05-17")).toMatchObject({
            cash_balance: "7",
            investment_market_value: "18",
            total_value: "25",
          });
        } finally {
          savedDb.close();
        }

        const deleteResponse = await fetch(
          `${server.baseUrl}/api/v1/snapshots?accountId=account-1&date=2026-05-17`,
          { method: "DELETE" },
        );
        expect(deleteResponse.status).toBe(204);
        await runtime.domainEventWorker.flush();
      } finally {
        server.stop();
      }

      await runtime.close();

      const resultDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(readRuntimeSnapshot(resultDb, "account-1", "2026-05-17")).toBeNull();
        expect(readRuntimeValuation(resultDb, "account-1", "2026-05-17")).toBeNull();
        expect(readRuntimeSnapshot(resultDb, "TOTAL", "2026-05-17")).toBeNull();
        expect(readRuntimeValuation(resultDb, "TOTAL", "2026-05-17")).toBeNull();
        expect(readRuntimeValuation(resultDb, "account-1", "2026-05-16")).toMatchObject({
          cash_balance: "5",
          investment_market_value: "20",
          total_value: "25",
        });
      } finally {
        resultDb.close();
      }
      expect(events.filter((event) => event === HOLDINGS_CHANGED_EVENT)).toHaveLength(2);
      expect(events).toContain("portfolio:update-complete");
    } finally {
      unsubscribe?.();
      await runtime.close();
    }
  });

  test("wires runtime account updates to portfolio job execution", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-account-events-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      domainEventDebounceMs: 10_000,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const events: string[] = [];
    const unsubscribe = runtime.options.eventBus?.subscribe((event) => {
      events.push(event.name);
    });

    try {
      const { goalService } = runtime.options;
      if (!goalService) {
        throw new Error("Runtime account event test requires goal service");
      }
      const db = openSqliteDatabase(runtime.dbPath);
      try {
        seedRuntimePortfolioJobInput(db);
      } finally {
        db.close();
      }
      const goal = await goalService.createGoal({
        goalType: "custom_save_up",
        title: "Account Event Goal",
        targetAmount: 50,
        currency: "USD",
      });
      await goalService.saveGoalFunding(goal.id, [{ accountId: "account-1", sharePercent: 100 }]);

      const server = startBackendServer(config, runtime.options);
      try {
        const updateResponse = await fetch(`${server.baseUrl}/api/v1/accounts/account-1`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Updated Runtime Account",
            accountType: "SECURITIES",
            isDefault: false,
            isActive: true,
            isArchived: false,
            trackingMode: "HOLDINGS",
          }),
        });
        expect(updateResponse.status).toBe(200);
      } finally {
        server.stop();
      }

      await runtime.close();

      const resultDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(readRuntimeValuation(resultDb, "account-1", "2026-05-16")).toMatchObject({
          cash_balance: "5",
          investment_market_value: "20",
          total_value: "25",
        });
        expect(readRuntimeGoalSummary(resultDb, goal.id)).toEqual({
          summary_current_value: 25,
          summary_progress: 0.5,
        });
      } finally {
        resultDb.close();
      }
      expect(events).toEqual([
        "accounts_changed",
        "market:sync-start",
        "market:sync-complete",
        "portfolio:update-start",
        "portfolio:update-complete",
      ]);
    } finally {
      unsubscribe?.();
      await runtime.close();
    }
  });

  test("wires runtime tracking-mode changes to transaction snapshot rebuilds", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-tracking-mode-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      domainEventDebounceMs: 10_000,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const events: string[] = [];
    const unsubscribe = runtime.options.eventBus?.subscribe((event) => {
      events.push(event.name);
    });

    try {
      const db = openSqliteDatabase(runtime.dbPath);
      try {
        seedRuntimeTransactionActivityInput(db);
        db.prepare("UPDATE accounts SET tracking_mode = 'HOLDINGS' WHERE id = 'tx-account'").run();
      } finally {
        db.close();
      }

      const server = startBackendServer(config, runtime.options);
      try {
        const updateResponse = await fetch(`${server.baseUrl}/api/v1/accounts/tx-account`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Transaction Account",
            accountType: "SECURITIES",
            isDefault: false,
            isActive: true,
            isArchived: false,
            trackingMode: "TRANSACTIONS",
          }),
        });
        expect(updateResponse.status).toBe(200);
      } finally {
        server.stop();
      }

      await runtime.close();

      const resultDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(readRuntimeSnapshot(resultDb, "tx-account", "2026-05-14")).toMatchObject({
          source: "CALCULATED",
          cash_balances: '{"USD":"79"}',
          cost_basis: "21",
          net_contribution: "100",
        });
        expect(readRuntimeValuation(resultDb, "tx-account", "2026-05-14")).toMatchObject({
          cash_balance: "79",
          investment_market_value: "20",
          total_value: "99",
        });
      } finally {
        resultDb.close();
      }
      expect(events).toContain("tracking_mode_changed");
      expect(events).toContain("portfolio:update-complete");
    } finally {
      unsubscribe?.();
      await runtime.close();
    }
  });

  test("wires runtime asset-created events to asset enrichment", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-asset-enrichment-"));
    const fetchCalls: string[] = [];
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      domainEventDebounceMs: 10_000,
      marketDataFetch: ((input: RequestInfo | URL) => {
        fetchCalls.push(String(input));
        return Promise.reject(new Error("unexpected enrichment network call"));
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const events: unknown[] = [];
    const unsubscribe = runtime.options.eventBus?.subscribe((event) => {
      events.push(event);
    });

    try {
      const { assetService } = runtime.options;
      if (!assetService) {
        throw new Error("Runtime asset enrichment test requires asset service");
      }

      await assetService.createAsset({
        kind: "PROPERTY",
        quoteMode: "MANUAL",
        quoteCcy: "USD",
        name: "Manual Property",
      });
      await runtime.close();

      expect(events).toEqual([
        {
          name: ASSETS_CREATED_EVENT,
          payload: { type: ASSETS_CREATED_EVENT, asset_ids: [expect.any(String)] },
        },
        { name: "asset:enrichment-start", payload: { total: 1 } },
        { name: "asset:enrichment-progress", payload: { completed: 1, total: 1 } },
        { name: "asset:enrichment-complete", payload: { enriched: 1, skipped: 0, failed: 0 } },
      ]);
      expect(fetchCalls).toEqual([]);
    } finally {
      unsubscribe?.();
      await runtime.close();
    }
  });

  test("wires runtime asset creates to asset enrichment", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-asset-create-route-"));
    const fetchCalls: string[] = [];
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      domainEventDebounceMs: 10_000,
      marketDataFetch: ((input: RequestInfo | URL) => {
        fetchCalls.push(String(input));
        return Promise.reject(new Error("unexpected enrichment network call"));
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const events: unknown[] = [];
    const unsubscribe = runtime.options.eventBus?.subscribe((event) => {
      events.push(event);
    });

    try {
      const server = startBackendServer(config, runtime.options);
      try {
        const createResponse = await fetch(`${server.baseUrl}/api/v1/assets`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "PROPERTY",
            quoteMode: "MANUAL",
            quoteCcy: "USD",
            name: "HTTP Property",
          }),
        });
        expect(createResponse.status).toBe(200);
      } finally {
        server.stop();
      }

      await runtime.close();

      expect(events).toEqual([
        {
          name: ASSETS_CREATED_EVENT,
          payload: { type: ASSETS_CREATED_EVENT, asset_ids: [expect.any(String)] },
        },
        { name: "asset:enrichment-start", payload: { total: 1 } },
        { name: "asset:enrichment-progress", payload: { completed: 1, total: 1 } },
        { name: "asset:enrichment-complete", payload: { enriched: 1, skipped: 0, failed: 0 } },
      ]);
      expect(fetchCalls).toEqual([]);
    } finally {
      unsubscribe?.();
      await runtime.close();
    }
  });

  test("wires runtime asset-updated events to portfolio job execution", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-asset-updated-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      domainEventDebounceMs: 10_000,
      marketDataFetch: (() => {
        throw new Error("unexpected market data fetch");
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const events: string[] = [];
    const unsubscribe = runtime.options.eventBus?.subscribe((event) => {
      events.push(event.name);
    });

    try {
      const { assetService } = runtime.options;
      if (!assetService) {
        throw new Error("Runtime asset update test requires asset service");
      }

      const created = await assetService.createAsset({
        kind: "PROPERTY",
        quoteMode: "MANUAL",
        quoteCcy: "USD",
        name: "Manual Property",
      });
      await runtime.domainEventWorker.flush();

      events.length = 0;
      await assetService.updateAssetProfile(created.id, { notes: "updated profile" });
      await runtime.domainEventWorker.flush();
      expect(events).toEqual([
        ASSETS_UPDATED_EVENT,
        "market:sync-start",
        "market:sync-complete",
        "portfolio:update-start",
        "portfolio:update-complete",
      ]);

      events.length = 0;
      assetService.updateQuoteMode(created.id, "MARKET");
      await runtime.domainEventWorker.flush();
      expect(events).toEqual([
        ASSETS_UPDATED_EVENT,
        "market:sync-start",
        "market:sync-complete",
        "portfolio:update-start",
        "portfolio:update-complete",
      ]);
    } finally {
      unsubscribe?.();
      await runtime.close();
    }
  });

  test("wires runtime asset profile updates to portfolio job execution", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-asset-profile-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      domainEventDebounceMs: 10_000,
      marketDataFetch: (() => {
        throw new Error("unexpected market data fetch");
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const events: string[] = [];
    const unsubscribe = runtime.options.eventBus?.subscribe((event) => {
      events.push(event.name);
    });

    try {
      const db = openSqliteDatabase(runtime.dbPath);
      try {
        seedRuntimePortfolioJobInput(db);
      } finally {
        db.close();
      }

      const server = startBackendServer(config, runtime.options);
      try {
        const updateResponse = await fetch(`${server.baseUrl}/api/v1/assets/profile/asset-1`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ notes: "updated through HTTP" }),
        });
        expect(updateResponse.status).toBe(200);
      } finally {
        server.stop();
      }

      await runtime.close();

      const resultDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(readRuntimeValuation(resultDb, "account-1", "2026-05-16")).toMatchObject({
          cash_balance: "5",
          investment_market_value: "20",
          total_value: "25",
        });
      } finally {
        resultDb.close();
      }
      expect(events).toEqual([
        ASSETS_UPDATED_EVENT,
        "market:sync-start",
        "market:sync-complete",
        "portfolio:update-start",
        "portfolio:update-complete",
      ]);
    } finally {
      unsubscribe?.();
      await runtime.close();
    }
  });

  test("wires runtime asset quote-mode updates to portfolio job execution", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-asset-quote-mode-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      domainEventDebounceMs: 10_000,
      marketDataFetch: (() => {
        throw new Error("unexpected market data fetch");
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const events: string[] = [];
    const unsubscribe = runtime.options.eventBus?.subscribe((event) => {
      events.push(event.name);
    });

    try {
      const db = openSqliteDatabase(runtime.dbPath);
      try {
        seedRuntimePortfolioJobInput(db);
        db.prepare("UPDATE assets SET quote_mode = 'MARKET' WHERE id = 'asset-1'").run();
      } finally {
        db.close();
      }

      const server = startBackendServer(config, runtime.options);
      try {
        const updateResponse = await fetch(`${server.baseUrl}/api/v1/assets/pricing-mode/asset-1`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ quoteMode: "MANUAL" }),
        });
        expect(updateResponse.status).toBe(200);
      } finally {
        server.stop();
      }

      await runtime.close();

      const resultDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(readRuntimeValuation(resultDb, "account-1", "2026-05-16")).toMatchObject({
          cash_balance: "5",
          investment_market_value: "20",
          total_value: "25",
        });
      } finally {
        resultDb.close();
      }
      expect(events).toEqual([
        ASSETS_UPDATED_EVENT,
        "market:sync-start",
        "market:sync-complete",
        "portfolio:update-start",
        "portfolio:update-complete",
      ]);
    } finally {
      unsubscribe?.();
      await runtime.close();
    }
  });

  test("keeps domain event goal refresh best-effort when active goals cannot load", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-goal-refresh-error-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      domainEventDebounceMs: 10_000,
      repositoryRoot,
      secretKey: config.secretKey,
    });

    try {
      const { goalService } = runtime.options;
      if (!goalService) {
        throw new Error("Runtime domain event test requires goal service");
      }
      const db = openSqliteDatabase(runtime.dbPath);
      try {
        seedRuntimePortfolioJobInput(db);
      } finally {
        db.close();
      }

      const originalGetGoals = goalService.getGoals;
      const originalWarn = console.warn;
      const warnings: string[] = [];
      goalService.getGoals = () => {
        throw new Error("goal list failed");
      };
      console.warn = (...args) => {
        warnings.push(args.map(String).join(" "));
      };
      try {
        runtime.options.eventBus?.publish({
          name: HOLDINGS_CHANGED_EVENT,
          payload: { account_ids: ["account-1"], asset_ids: ["asset-1"] },
        });
        await runtime.close();
      } finally {
        goalService.getGoals = originalGetGoals;
        console.warn = originalWarn;
      }

      const resultDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(readRuntimeValuation(resultDb, "account-1", "2026-05-16")).toMatchObject({
          total_value: "25",
        });
      } finally {
        resultDb.close();
      }
      expect(warnings).toContain(
        "Failed to load active goals for summary refresh: goal list failed",
      );
    } finally {
      await runtime.close();
    }
  });

  test("wires activity domain events to transaction snapshot rebuilds", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-activity-events-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      domainEventDebounceMs: 10_000,
      repositoryRoot,
      secretKey: config.secretKey,
    });

    try {
      const db = openSqliteDatabase(runtime.dbPath);
      try {
        seedRuntimeTransactionActivityInput(db);
      } finally {
        db.close();
      }

      runtime.options.eventBus?.publish({
        name: ACTIVITIES_CHANGED_EVENT,
        payload: {
          account_ids: ["tx-account"],
          asset_ids: ["tx-asset"],
          earliest_activity_at_utc: "2026-05-14T10:00:00.000Z",
        },
      });
      await runtime.close();

      const resultDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(readRuntimeSnapshot(resultDb, "tx-account", "2026-05-14")).toMatchObject({
          source: "CALCULATED",
          cash_balances: '{"USD":"79"}',
          cost_basis: "21",
          net_contribution: "100",
        });
        expect(readRuntimeSnapshotPositions(resultDb, "tx-account", "2026-05-14")).toMatchObject({
          "tx-asset": expect.objectContaining({
            quantity: "2",
            totalCostBasis: "21",
          }),
        });
        expect(readRuntimeValuation(resultDb, "tx-account", "2026-05-14")).toMatchObject({
          cash_balance: "79",
          investment_market_value: "20",
          total_value: "99",
        });
        expect(readRuntimeValuation(resultDb, "TOTAL", "2026-05-14")).toMatchObject({
          total_value: "99",
        });
      } finally {
        resultDb.close();
      }
    } finally {
      await runtime.close();
    }
  });

  test("wires runtime activity creates to transaction snapshot rebuilds", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-activity-create-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      domainEventDebounceMs: 10_000,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const events: string[] = [];
    const unsubscribe = runtime.options.eventBus?.subscribe((event) => {
      events.push(event.name);
    });

    try {
      const db = openSqliteDatabase(runtime.dbPath);
      try {
        seedRuntimeTransactionActivityHttpInput(db);
      } finally {
        db.close();
      }

      const server = startBackendServer(config, runtime.options);
      try {
        const depositResponse = await fetch(`${server.baseUrl}/api/v1/activities`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            accountId: "tx-account",
            activityType: "DEPOSIT",
            activityDate: "2026-05-14T10:00:00.000Z",
            amount: "100",
            currency: "USD",
          }),
        });
        expect(depositResponse.status).toBe(200);
        const buyResponse = await fetch(`${server.baseUrl}/api/v1/activities`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            accountId: "tx-account",
            asset: { id: "tx-asset" },
            activityType: "BUY",
            activityDate: "2026-05-14T12:00:00.000Z",
            quantity: "2",
            unitPrice: "10",
            fee: "1",
            currency: "USD",
          }),
        });
        expect(buyResponse.status).toBe(200);
      } finally {
        server.stop();
      }

      await runtime.close();

      const resultDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(readRuntimeSnapshot(resultDb, "tx-account", "2026-05-14")).toMatchObject({
          source: "CALCULATED",
          cash_balances: '{"USD":"79"}',
          cost_basis: "21",
          net_contribution: "100",
        });
        expect(readRuntimeSnapshotPositions(resultDb, "tx-account", "2026-05-14")).toMatchObject({
          "tx-asset": expect.objectContaining({
            quantity: "2",
            totalCostBasis: "21",
          }),
        });
        expect(readRuntimeValuation(resultDb, "tx-account", "2026-05-14")).toMatchObject({
          cash_balance: "79",
          investment_market_value: "20",
          total_value: "99",
        });
        expect(readRuntimeValuation(resultDb, "TOTAL", "2026-05-14")).toMatchObject({
          total_value: "99",
        });
      } finally {
        resultDb.close();
      }
      expect(events.filter((event) => event === ACTIVITIES_CHANGED_EVENT)).toHaveLength(2);
      expect(events).toContain("portfolio:update-complete");
    } finally {
      unsubscribe?.();
      await runtime.close();
    }
  });

  test("wires runtime activity updates to transaction snapshot rebuilds", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-activity-update-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      domainEventDebounceMs: 10_000,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const events: string[] = [];
    const unsubscribe = runtime.options.eventBus?.subscribe((event) => {
      events.push(event.name);
    });

    try {
      const db = openSqliteDatabase(runtime.dbPath);
      try {
        seedRuntimeTransactionActivityInput(db);
      } finally {
        db.close();
      }

      const server = startBackendServer(config, runtime.options);
      try {
        const updateResponse = await fetch(`${server.baseUrl}/api/v1/activities`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: "tx-buy",
            accountId: "tx-account",
            asset: { id: "tx-asset" },
            activityType: "BUY",
            activityDate: "2026-05-14T12:00:00.000Z",
            quantity: "3",
            unitPrice: "10",
            fee: "1",
            currency: "USD",
          }),
        });
        expect(updateResponse.status).toBe(200);
      } finally {
        server.stop();
      }

      await runtime.close();

      const resultDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(readRuntimeSnapshot(resultDb, "tx-account", "2026-05-14")).toMatchObject({
          source: "CALCULATED",
          cash_balances: '{"USD":"69"}',
          cost_basis: "31",
          net_contribution: "100",
        });
        expect(readRuntimeSnapshotPositions(resultDb, "tx-account", "2026-05-14")).toMatchObject({
          "tx-asset": expect.objectContaining({
            quantity: "3",
            totalCostBasis: "31",
          }),
        });
        expect(readRuntimeValuation(resultDb, "tx-account", "2026-05-14")).toMatchObject({
          cash_balance: "69",
          investment_market_value: "30",
          total_value: "99",
        });
      } finally {
        resultDb.close();
      }
      expect(events).toContain(ACTIVITIES_CHANGED_EVENT);
      expect(events).toContain("portfolio:update-complete");
    } finally {
      unsubscribe?.();
      await runtime.close();
    }
  });

  test("wires runtime activity deletes to transaction snapshot rebuilds", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-activity-delete-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      domainEventDebounceMs: 10_000,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const events: string[] = [];
    const unsubscribe = runtime.options.eventBus?.subscribe((event) => {
      events.push(event.name);
    });

    try {
      const db = openSqliteDatabase(runtime.dbPath);
      try {
        seedRuntimeTransactionActivityInput(db);
      } finally {
        db.close();
      }

      const server = startBackendServer(config, runtime.options);
      try {
        const deleteResponse = await fetch(`${server.baseUrl}/api/v1/activities/tx-buy`, {
          method: "DELETE",
        });
        expect(deleteResponse.status).toBe(200);
      } finally {
        server.stop();
      }

      await runtime.close();

      const resultDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(readRuntimeSnapshot(resultDb, "tx-account", "2026-05-14")).toMatchObject({
          source: "CALCULATED",
          cash_balances: '{"USD":"100"}',
          cost_basis: "0",
          net_contribution: "100",
        });
        expect(readRuntimeSnapshotPositions(resultDb, "tx-account", "2026-05-14")).toEqual({});
        expect(readRuntimeValuation(resultDb, "tx-account", "2026-05-14")).toMatchObject({
          cash_balance: "100",
          investment_market_value: "0",
          total_value: "100",
        });
      } finally {
        resultDb.close();
      }
      expect(events).toContain(ACTIVITIES_CHANGED_EVENT);
      expect(events).toContain("portfolio:update-complete");
    } finally {
      unsubscribe?.();
      await runtime.close();
    }
  });

  test("wires runtime bulk activity creates to transaction snapshot rebuilds", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-activity-bulk-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      domainEventDebounceMs: 10_000,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const events: string[] = [];
    const unsubscribe = runtime.options.eventBus?.subscribe((event) => {
      events.push(event.name);
    });

    try {
      const db = openSqliteDatabase(runtime.dbPath);
      try {
        seedRuntimeTransactionActivityHttpInput(db);
      } finally {
        db.close();
      }

      const server = startBackendServer(config, runtime.options);
      try {
        const bulkResponse = await fetch(`${server.baseUrl}/api/v1/activities/bulk`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            creates: [
              {
                id: "bulk-deposit-temp",
                accountId: "tx-account",
                activityType: "DEPOSIT",
                activityDate: "2026-05-14T10:00:00.000Z",
                amount: "100",
                currency: "USD",
              },
              {
                id: "bulk-buy-temp",
                accountId: "tx-account",
                asset: { id: "tx-asset" },
                activityType: "BUY",
                activityDate: "2026-05-14T12:00:00.000Z",
                quantity: "2",
                unitPrice: "10",
                fee: "1",
                currency: "USD",
              },
            ],
            updates: [],
            deletes: [],
          }),
        });
        expect(bulkResponse.status).toBe(200);
        await expect(bulkResponse.json()).resolves.toMatchObject({
          created: [expect.any(Object), expect.any(Object)],
          updated: [],
          deleted: [],
          errors: [],
          createdMappings: [
            { tempId: "bulk-deposit-temp", activityId: expect.any(String) },
            { tempId: "bulk-buy-temp", activityId: expect.any(String) },
          ],
        });
      } finally {
        server.stop();
      }

      await runtime.close();

      const resultDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(readRuntimeSnapshot(resultDb, "tx-account", "2026-05-14")).toMatchObject({
          source: "CALCULATED",
          cash_balances: '{"USD":"79"}',
          cost_basis: "21",
          net_contribution: "100",
        });
        expect(readRuntimeValuation(resultDb, "tx-account", "2026-05-14")).toMatchObject({
          cash_balance: "79",
          investment_market_value: "20",
          total_value: "99",
        });
      } finally {
        resultDb.close();
      }
      expect(events.filter((event) => event === ACTIVITIES_CHANGED_EVENT)).toHaveLength(1);
      expect(events).toContain("portfolio:update-complete");
    } finally {
      unsubscribe?.();
      await runtime.close();
    }
  });

  test("wires runtime bulk activity updates and deletes to transaction snapshot rebuilds", async () => {
    const appDataDir = mkdtempSync(
      path.join(tmpdir(), "wealthfolio-runtime-activity-bulk-update-delete-"),
    );
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      domainEventDebounceMs: 10_000,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const events: string[] = [];
    const unsubscribe = runtime.options.eventBus?.subscribe((event) => {
      events.push(event.name);
    });

    try {
      const db = openSqliteDatabase(runtime.dbPath);
      try {
        seedRuntimeTransactionActivityInput(db);
      } finally {
        db.close();
      }

      const server = startBackendServer(config, runtime.options);
      try {
        const bulkResponse = await fetch(`${server.baseUrl}/api/v1/activities/bulk`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            creates: [],
            updates: [
              {
                id: "tx-deposit",
                accountId: "tx-account",
                activityType: "DEPOSIT",
                activityDate: "2026-05-14T10:00:00.000Z",
                amount: "120",
                currency: "USD",
              },
            ],
            deleteIds: ["tx-buy"],
          }),
        });
        expect(bulkResponse.status).toBe(200);
        await expect(bulkResponse.json()).resolves.toMatchObject({
          created: [],
          updated: [expect.objectContaining({ id: "tx-deposit", amount: "120" })],
          deleted: [expect.objectContaining({ id: "tx-buy" })],
          errors: [],
          createdMappings: [],
        });
      } finally {
        server.stop();
      }

      await runtime.close();

      const resultDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(readRuntimeSnapshot(resultDb, "tx-account", "2026-05-14")).toMatchObject({
          source: "CALCULATED",
          cash_balances: '{"USD":"120"}',
          cost_basis: "0",
          net_contribution: "120",
        });
        expect(readRuntimeSnapshotPositions(resultDb, "tx-account", "2026-05-14")).toEqual({});
        expect(readRuntimeValuation(resultDb, "tx-account", "2026-05-14")).toMatchObject({
          cash_balance: "120",
          investment_market_value: "0",
          total_value: "120",
        });
      } finally {
        resultDb.close();
      }
      expect(events.filter((event) => event === ACTIVITIES_CHANGED_EVENT)).toHaveLength(1);
      expect(events).toContain("portfolio:update-complete");
    } finally {
      unsubscribe?.();
      await runtime.close();
    }
  });

  test("wires runtime activity imports to transaction snapshot rebuilds", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-activity-import-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      domainEventDebounceMs: 10_000,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const events: string[] = [];
    const unsubscribe = runtime.options.eventBus?.subscribe((event) => {
      events.push(event.name);
    });

    try {
      const db = openSqliteDatabase(runtime.dbPath);
      try {
        seedRuntimeTransactionActivityHttpInput(db);
      } finally {
        db.close();
      }

      const server = startBackendServer(config, runtime.options);
      try {
        const importResponse = await fetch(`${server.baseUrl}/api/v1/activities/import`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            activities: [
              {
                accountId: "tx-account",
                activityType: "DEPOSIT",
                date: "2026-05-14T10:00:00.000Z",
                amount: "100",
                currency: "USD",
              },
              {
                accountId: "tx-account",
                assetId: "tx-asset",
                symbol: "TX",
                activityType: "BUY",
                date: "2026-05-14T12:00:00.000Z",
                quantity: "2",
                unitPrice: "10",
                fee: "1",
                currency: "USD",
              },
            ],
          }),
        });
        expect(importResponse.status).toBe(200);
        await expect(importResponse.json()).resolves.toMatchObject({
          summary: {
            total: 2,
            imported: 2,
            skipped: 0,
            success: true,
            errorMessage: null,
          },
        });
      } finally {
        server.stop();
      }

      await runtime.close();

      const resultDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(readRuntimeSnapshot(resultDb, "tx-account", "2026-05-14")).toMatchObject({
          source: "CALCULATED",
          cash_balances: '{"USD":"79"}',
          cost_basis: "21",
          net_contribution: "100",
        });
        expect(readRuntimeValuation(resultDb, "tx-account", "2026-05-14")).toMatchObject({
          cash_balance: "79",
          investment_market_value: "20",
          total_value: "99",
        });
      } finally {
        resultDb.close();
      }
      expect(events.filter((event) => event === ACTIVITIES_CHANGED_EVENT)).toHaveLength(1);
      expect(events).toContain("portfolio:update-complete");
    } finally {
      unsubscribe?.();
      await runtime.close();
    }
  });

  test("wires keyring secrets when requested", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-keyring-"));

    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      env: { WF_SECRET_BACKEND: "keyring" },
      repositoryRoot,
      secretKey: config.secretKey,
    });
    try {
      expect(runtime.options.secretService).toBeDefined();
    } finally {
      await runtime.close();
    }
  });

  test("wires goal valuation routes to latest SQLite account valuations", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-goals-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    try {
      const { accountService, goalService } = runtime.options;
      if (!accountService || !goalService) {
        throw new Error("Runtime goal valuation test requires account and goal services");
      }

      const account = await accountService.createAccount({
        name: "Goal Account",
        accountType: "CASH",
        currency: "USD",
        isDefault: false,
        isActive: true,
      });
      const ignoredAccount = await accountService.createAccount({
        name: "Archived Goal Account",
        accountType: "CASH",
        currency: "USD",
        isDefault: false,
        isActive: true,
        isArchived: true,
      });
      const goal = await goalService.createGoal({
        goalType: "custom_save_up",
        title: "Runtime Goal",
        targetAmount: 1000,
        currency: "USD",
      });
      await goalService.saveGoalFunding(goal.id, [
        { accountId: account.id, sharePercent: 40 },
        { accountId: ignoredAccount.id, sharePercent: 100 },
      ]);

      const db = openSqliteDatabase(runtime.dbPath);
      try {
        const initialSyncOutbox = readRuntimeSyncOutbox(db);
        const initialGoalSyncRows = initialSyncOutbox.filter(
          (row) => row.entity === "goal" || row.entity === "goals_allocation",
        );
        expect(initialGoalSyncRows).toEqual([
          expect.objectContaining({ entity: "goal", entity_id: goal.id, op: "create" }),
          expect.objectContaining({
            entity: "goals_allocation",
            entity_id: expect.any(String),
            op: "create",
          }),
          expect.objectContaining({
            entity: "goals_allocation",
            entity_id: expect.any(String),
            op: "create",
          }),
        ]);
        expect(JSON.parse(String(initialGoalSyncRows[0]?.payload))).toMatchObject({
          id: goal.id,
          goal_type: "custom_save_up",
          target_amount: 1000,
        });

        seedRuntimeValuation(db, {
          accountId: account.id,
          date: "2026-05-13",
          totalValue: "700",
          fxRateToBase: "9",
        });
        seedRuntimeValuation(db, {
          accountId: account.id,
          date: "2026-05-14",
          totalValue: "1000",
          fxRateToBase: "1.25",
        });
        seedRuntimeValuation(db, {
          accountId: ignoredAccount.id,
          date: "2026-05-14",
          totalValue: "1000000",
          fxRateToBase: "1",
        });
      } finally {
        db.close();
      }

      const server = startBackendServer(config, runtime.options);
      try {
        const refreshResponse = await fetch(
          `${server.baseUrl}/api/v1/goals/${goal.id}/refresh-summary`,
          { method: "POST" },
        );
        expect(refreshResponse.status).toBe(200);
        await expect(refreshResponse.json()).resolves.toMatchObject({
          id: goal.id,
          summaryCurrentValue: 500,
          summaryProgress: 0.5,
        });

        const overviewResponse = await fetch(
          `${server.baseUrl}/api/v1/goals/${goal.id}/save-up/overview`,
        );
        expect(overviewResponse.status).toBe(200);
        await expect(overviewResponse.json()).resolves.toMatchObject({
          currentValue: 500,
          targetAmount: 1000,
          progress: 0.5,
        });
        const postRefreshDb = openSqliteDatabase(runtime.dbPath);
        try {
          expect(
            readRuntimeSyncOutbox(postRefreshDb).filter(
              (row) => row.entity === "goal" || row.entity === "goals_allocation",
            ),
          ).toHaveLength(3);
        } finally {
          postRefreshDb.close();
        }
      } finally {
        server.stop();
      }
    } finally {
      await runtime.close();
    }
  });
});

async function waitForEventCount(
  events: string[],
  eventName: string,
  count: number,
): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (events.filter((event) => event === eventName).length >= count) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(events.filter((event) => event === eventName)).toHaveLength(count);
}

function readRuntimeSyncOutbox(
  db: ReturnType<typeof openSqliteDatabase>,
): Array<Record<string, unknown>> {
  return db.query<Record<string, unknown>, []>("SELECT * FROM sync_outbox ORDER BY rowid").all();
}

function addonZip(files: Record<string, string | Uint8Array>): Uint8Array {
  return zipSync(
    Object.fromEntries(
      Object.entries(files).map(([name, content]) => [
        name,
        typeof content === "string" ? strToU8(content) : content,
      ]),
    ),
  );
}

function seedRuntimeAsset(db: ReturnType<typeof openSqliteDatabase>, assetId: string): void {
  db.prepare(
    `
      INSERT INTO assets (
        id, kind, name, display_code, notes, metadata, is_active, quote_mode,
        quote_ccy, instrument_type, instrument_symbol, instrument_exchange_mic,
        provider_config, created_at, updated_at
      )
      VALUES (?, 'INVESTMENT', 'Runtime Asset', 'RUNTIME', NULL, NULL, 1, 'MARKET',
        'USD', 'EQUITY', 'RUNTIME', NULL, NULL, '2026-05-14T00:00:00Z', '2026-05-14T00:00:00Z')
    `,
  ).run(assetId);
}

function seedRuntimePortfolioJobInput(db: ReturnType<typeof openSqliteDatabase>): void {
  db.prepare(
    `
      INSERT INTO accounts (
        id, name, account_type, "group", currency, is_default, is_active,
        is_archived, tracking_mode
      )
      VALUES ('account-1', 'Runtime Account', 'SECURITIES', NULL, 'USD', 0, 1, 0, 'HOLDINGS')
    `,
  ).run();
  db.prepare(
    `
      INSERT INTO assets (
        id, kind, name, display_code, notes, metadata, is_active, quote_mode,
        quote_ccy, instrument_type, instrument_symbol, instrument_exchange_mic,
        provider_config, created_at, updated_at
      )
      VALUES ('asset-1', 'INVESTMENT', 'Runtime Asset', 'RUNTIME', NULL, NULL, 1, 'MANUAL',
        'USD', 'EQUITY', 'RUNTIME', NULL, NULL, '2026-05-14T00:00:00Z', '2026-05-14T00:00:00Z')
    `,
  ).run();
  db.prepare(
    `
      INSERT INTO quotes (
        id, asset_id, day, source, close, currency, created_at, timestamp
      )
      VALUES ('asset-1_2026-05-14_MANUAL', 'asset-1', '2026-05-14', 'MANUAL',
        '10', 'USD', '2026-05-14T16:00:00Z', '2026-05-14T16:00:00Z')
    `,
  ).run();
  db.prepare(
    `
      INSERT INTO holdings_snapshots (
        id, account_id, snapshot_date, currency, positions, cash_balances,
        cost_basis, net_contribution, net_contribution_base, source
      )
      VALUES ('account-1_2026-05-16', 'account-1', '2026-05-16', 'USD',
        ?, '{"USD":"5"}', '12', '17', '17', 'MANUAL_ENTRY')
    `,
  ).run(
    JSON.stringify({
      "asset-1": {
        id: "asset-1_account-1",
        accountId: "account-1",
        assetId: "asset-1",
        quantity: "2",
        averageCost: "6",
        totalCostBasis: "12",
        currency: "USD",
        inceptionDate: "2026-01-01T00:00:00Z",
        createdAt: "2026-01-01T00:00:00Z",
        lastUpdated: "2026-01-01T00:00:00Z",
        isAlternative: false,
        contractMultiplier: "1",
        lots: [],
      },
    }),
  );
}

function seedRuntimeTransactionActivityInput(db: ReturnType<typeof openSqliteDatabase>): void {
  db.prepare(
    `
      INSERT INTO accounts (
        id, name, account_type, "group", currency, is_default, is_active,
        is_archived, tracking_mode
      )
      VALUES ('tx-account', 'Transaction Account', 'SECURITIES', NULL, 'USD', 0, 1, 0, 'TRANSACTIONS')
    `,
  ).run();
  db.prepare(
    `
      INSERT INTO assets (
        id, kind, name, display_code, notes, metadata, is_active, quote_mode,
        quote_ccy, instrument_type, instrument_symbol, instrument_exchange_mic,
        provider_config, created_at, updated_at
      )
      VALUES ('tx-asset', 'INVESTMENT', 'Transaction Asset', 'TX', NULL, NULL, 1, 'MANUAL',
        'USD', 'EQUITY', 'TX', NULL, NULL, '2026-05-14T00:00:00Z', '2026-05-14T00:00:00Z')
    `,
  ).run();
  db.prepare(
    `
      INSERT INTO quotes (
        id, asset_id, day, source, close, currency, created_at, timestamp
      )
      VALUES ('tx-asset_2026-05-14_MANUAL', 'tx-asset', '2026-05-14', 'MANUAL',
        '10', 'USD', '2026-05-14T16:00:00Z', '2026-05-14T16:00:00Z')
    `,
  ).run();
  db.prepare(
    `
      INSERT INTO activities (
        id, account_id, asset_id, activity_type, subtype, status, activity_date,
        quantity, unit_price, amount, fee, currency, notes, metadata,
        source_system, source_record_id, source_group_id, idempotency_key,
        import_run_id, is_user_modified, needs_review, created_at, updated_at
      )
      VALUES
        ('tx-deposit', 'tx-account', NULL, 'DEPOSIT', NULL, 'POSTED',
          '2026-05-14T10:00:00.000Z', NULL, NULL, '100', NULL, 'USD', NULL, NULL,
          NULL, NULL, NULL, NULL, NULL, 0, 0, '2026-05-14T10:00:00.000Z', '2026-05-14T10:00:00.000Z'),
        ('tx-buy', 'tx-account', 'tx-asset', 'BUY', NULL, 'POSTED',
          '2026-05-14T12:00:00.000Z', '2', '10', NULL, '1', 'USD', NULL, NULL,
          NULL, NULL, NULL, NULL, NULL, 0, 0, '2026-05-14T12:00:00.000Z', '2026-05-14T12:00:00.000Z')
    `,
  ).run();
}

function seedRuntimeTransactionActivityHttpInput(db: ReturnType<typeof openSqliteDatabase>): void {
  db.prepare(
    `
      INSERT INTO accounts (
        id, name, account_type, "group", currency, is_default, is_active,
        is_archived, tracking_mode
      )
      VALUES ('tx-account', 'Transaction Account', 'SECURITIES', NULL, 'USD', 0, 1, 0, 'TRANSACTIONS')
    `,
  ).run();
  db.prepare(
    `
      INSERT INTO assets (
        id, kind, name, display_code, notes, metadata, is_active, quote_mode,
        quote_ccy, instrument_type, instrument_symbol, instrument_exchange_mic,
        provider_config, created_at, updated_at
      )
      VALUES ('tx-asset', 'INVESTMENT', 'Transaction Asset', 'TX', NULL, NULL, 1, 'MANUAL',
        'USD', 'EQUITY', 'TX', NULL, NULL, '2026-05-14T00:00:00Z', '2026-05-14T00:00:00Z')
    `,
  ).run();
  db.prepare(
    `
      INSERT INTO quotes (
        id, asset_id, day, source, close, currency, created_at, timestamp
      )
      VALUES ('tx-asset_2026-05-14_MANUAL', 'tx-asset', '2026-05-14', 'MANUAL',
        '10', 'USD', '2026-05-14T16:00:00Z', '2026-05-14T16:00:00Z')
    `,
  ).run();
}

function seedRuntimeNegativePositionHealthInput(db: ReturnType<typeof openSqliteDatabase>): void {
  db.prepare(
    "INSERT OR REPLACE INTO app_settings (setting_key, setting_value) VALUES ('timezone', 'UTC')",
  ).run();
  db.prepare(
    `
      INSERT INTO accounts (
        id, name, account_type, "group", currency, is_default, is_active,
        is_archived, tracking_mode
      )
      VALUES ('health-account', 'Health Account', 'SECURITIES', NULL, 'USD', 0, 1, 0, 'HOLDINGS')
    `,
  ).run();
  db.prepare(
    `
      INSERT INTO assets (
        id, kind, name, display_code, notes, metadata, is_active, quote_mode,
        quote_ccy, instrument_type, instrument_symbol, instrument_exchange_mic,
        provider_config, created_at, updated_at
      )
      VALUES ('health-asset', 'INVESTMENT', 'Health Asset', 'HEALTH', NULL, NULL, 1, 'MANUAL',
        'USD', 'EQUITY', 'HEALTH', NULL, NULL, '2026-05-14T00:00:00Z', '2026-05-14T00:00:00Z')
    `,
  ).run();
  db.prepare(
    `
      INSERT INTO holdings_snapshots (
        id, account_id, snapshot_date, currency, positions, cash_balances,
        cost_basis, net_contribution, net_contribution_base, source
      )
      VALUES ('health-account_2026-05-18', 'health-account', '2026-05-18', 'USD',
        ?, '{}', '0', '0', '0', 'MANUAL_ENTRY')
    `,
  ).run(
    JSON.stringify({
      "health-asset": {
        id: "health-asset_health-account",
        accountId: "health-account",
        assetId: "health-asset",
        quantity: "-1",
        averageCost: "0",
        totalCostBasis: "0",
        currency: "USD",
        inceptionDate: "2026-05-18T00:00:00Z",
        createdAt: "2026-05-18T00:00:00Z",
        lastUpdated: "2026-05-18T00:00:00Z",
        isAlternative: false,
        contractMultiplier: "1",
        lots: [],
      },
    }),
  );
}

function seedRuntimeOrphanActivityHealthInput(db: ReturnType<typeof openSqliteDatabase>): void {
  db.prepare(
    "INSERT OR REPLACE INTO app_settings (setting_key, setting_value) VALUES ('timezone', 'UTC')",
  ).run();
  db.prepare(
    `
      INSERT INTO accounts (
        id, name, account_type, "group", currency, is_default, is_active,
        is_archived, tracking_mode
      )
      VALUES ('orphan-existing-account', 'Existing Account', 'SECURITIES', NULL, 'USD', 0, 1, 0, 'HOLDINGS')
    `,
  ).run();
  db.prepare(
    `
      INSERT INTO assets (
        id, kind, name, display_code, notes, metadata, is_active, quote_mode,
        quote_ccy, instrument_type, instrument_symbol, instrument_exchange_mic,
        provider_config, created_at, updated_at
      )
      VALUES ('orphan-existing-asset', 'INVESTMENT', 'Existing Asset', 'EXIST', NULL, NULL, 1, 'MANUAL',
        'USD', 'EQUITY', 'EXIST', NULL, NULL, '2026-05-14T00:00:00Z', '2026-05-14T00:00:00Z')
    `,
  ).run();
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.prepare(
      `
        INSERT INTO activities (
          id, account_id, asset_id, activity_type, subtype, status, activity_date,
          quantity, unit_price, amount, fee, currency, notes, metadata,
          source_system, source_record_id, source_group_id, idempotency_key,
          import_run_id, is_user_modified, needs_review, created_at, updated_at
        )
        VALUES
          ('orphan-account-activity', 'missing-account', 'orphan-existing-asset', 'BUY', NULL, 'POSTED',
            '2026-05-14T12:00:00.000Z', '1', '10', NULL, NULL, 'USD', NULL, NULL,
            NULL, NULL, NULL, NULL, NULL, 0, 0, '2026-05-14T12:00:00.000Z', '2026-05-14T12:00:00.000Z'),
          ('orphan-asset-activity', 'orphan-existing-account', 'missing-asset', 'BUY', NULL, 'POSTED',
            '2026-05-15T12:00:00.000Z', '1', '10', NULL, NULL, 'USD', NULL, NULL,
            NULL, NULL, NULL, NULL, NULL, 0, 0, '2026-05-15T12:00:00.000Z', '2026-05-15T12:00:00.000Z')
      `,
    ).run();
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

function seedRuntimeNegativeBalanceHealthInput(db: ReturnType<typeof openSqliteDatabase>): void {
  db.prepare(
    "INSERT OR REPLACE INTO app_settings (setting_key, setting_value) VALUES ('timezone', 'UTC')",
  ).run();
  db.prepare(
    `
      INSERT INTO accounts (
        id, name, account_type, "group", currency, is_default, is_active,
        is_archived, tracking_mode
      )
      VALUES
        ('negative-investment', 'Negative Investment', 'SECURITIES', NULL, 'USD', 0, 1, 0, 'HOLDINGS'),
        ('negative-cash', 'Negative Cash', 'CASH', NULL, 'USD', 0, 1, 0, 'HOLDINGS')
    `,
  ).run();
  db.prepare(
    `
      INSERT INTO daily_account_valuation (
        id, account_id, valuation_date, account_currency, base_currency,
        fx_rate_to_base, cash_balance, investment_market_value, total_value,
        cost_basis, net_contribution, calculated_at
      )
      VALUES
        ('negative-investment_2026-05-18', 'negative-investment', '2026-05-18', 'USD', 'USD',
          '1', '-50', '25', '-25', '0', '0', '2026-05-18T00:00:00Z'),
        ('negative-cash_2026-05-18', 'negative-cash', '2026-05-18', 'USD', 'USD',
          '1', '-10', '0', '-10', '0', '0', '2026-05-18T00:00:00Z')
    `,
  ).run();
}

function seedRuntimeQuoteSyncHealthInput(db: ReturnType<typeof openSqliteDatabase>): void {
  db.prepare(
    "INSERT OR REPLACE INTO app_settings (setting_key, setting_value) VALUES ('timezone', 'UTC')",
  ).run();
  db.prepare(
    `
      INSERT INTO accounts (
        id, name, account_type, "group", currency, is_default, is_active,
        is_archived, tracking_mode
      )
      VALUES ('quote-sync-account', 'Quote Sync Account', 'SECURITIES', NULL, 'USD', 0, 1, 0, 'HOLDINGS')
    `,
  ).run();
  db.prepare(
    `
      INSERT INTO assets (
        id, kind, name, display_code, notes, metadata, is_active, quote_mode,
        quote_ccy, instrument_type, instrument_symbol, instrument_exchange_mic,
        provider_config, created_at, updated_at
      )
      VALUES ('quote-sync-asset', 'INVESTMENT', 'Quote Sync Asset', 'RUNTIME', NULL, NULL, 1, 'MARKET',
        'USD', 'EQUITY', 'RUNTIME', NULL, NULL, '2026-05-14T00:00:00Z', '2026-05-14T00:00:00Z')
    `,
  ).run();
  db.prepare(
    `
      INSERT INTO quote_sync_state (
        asset_id, last_synced_at, data_source, sync_priority, error_count,
        last_error, created_at, updated_at
      )
      VALUES (
        'quote-sync-asset',
        NULL,
        'YAHOO',
        1,
        6,
        'provider unavailable',
        '2026-05-18T00:00:00Z',
        '2026-05-18T00:00:00Z'
      )
    `,
  ).run();
}

function seedRuntimeFxIntegrityHealthInput(db: ReturnType<typeof openSqliteDatabase>): void {
  db.prepare(
    "INSERT OR REPLACE INTO app_settings (setting_key, setting_value) VALUES ('timezone', 'UTC')",
  ).run();
  db.prepare(
    "INSERT OR REPLACE INTO app_settings (setting_key, setting_value) VALUES ('base_currency', 'USD')",
  ).run();
  db.prepare(
    `
      INSERT INTO accounts (
        id, name, account_type, "group", currency, is_default, is_active,
        is_archived, tracking_mode
      )
      VALUES ('fx-health-account', 'FX Health Account', 'SECURITIES', NULL, 'EUR', 0, 1, 0, 'HOLDINGS')
    `,
  ).run();
  db.prepare(
    `
      INSERT INTO assets (
        id, kind, name, display_code, notes, metadata, is_active, quote_mode,
        quote_ccy, instrument_type, instrument_symbol, instrument_exchange_mic,
        provider_config, created_at, updated_at
      )
      VALUES ('fx-health-asset', 'INVESTMENT', 'Euro Asset', 'EURSEC', NULL, NULL, 1, 'MANUAL',
        'EUR', 'EQUITY', 'EURSEC', NULL, NULL, '2026-05-14T00:00:00Z', '2026-05-14T00:00:00Z')
    `,
  ).run();
  db.prepare(
    `
      INSERT INTO holdings_snapshots (
        id, account_id, snapshot_date, currency, positions, cash_balances,
        cost_basis, net_contribution, net_contribution_base, source
      )
      VALUES ('fx-health-account_2026-05-18', 'fx-health-account', '2026-05-18', 'EUR',
        ?, '{}', '0', '0', '0', 'MANUAL_ENTRY')
    `,
  ).run(
    JSON.stringify({
      "fx-health-asset": {
        id: "fx-health-asset_fx-health-account",
        accountId: "fx-health-account",
        assetId: "fx-health-asset",
        quantity: "10",
        averageCost: "0",
        totalCostBasis: "0",
        currency: "EUR",
        inceptionDate: "2026-05-18T00:00:00Z",
        createdAt: "2026-05-18T00:00:00Z",
        lastUpdated: "2026-05-18T00:00:00Z",
        isAlternative: false,
        contractMultiplier: "1",
        lots: [],
      },
    }),
  );
  db.prepare(
    `
      INSERT INTO quotes (
        id, asset_id, day, source, close, currency, created_at, timestamp
      )
      VALUES ('fx-health-asset_2026-05-18_MANUAL', 'fx-health-asset', '2026-05-18',
        'MANUAL', '10', 'EUR', '2026-05-18T00:00:00Z', '2026-05-18T00:00:00Z')
    `,
  ).run();
}

function seedRuntimeConnectData(db: ReturnType<typeof openSqliteDatabase>): void {
  db.prepare(
    `
      INSERT INTO platforms (
        id, name, url, external_id, kind, website_url, logo_url
      )
      VALUES (
        'SNAPTRADE',
        'SnapTrade',
        'https://snaptrade.com',
        'snaptrade-external',
        'BROKERAGE',
        'https://snaptrade.com',
        'https://cdn.example/snaptrade.png'
      )
    `,
  ).run();
  db.prepare(
    `
      INSERT INTO accounts (
        id, name, account_type, "group", currency, is_default, is_active,
        created_at, updated_at, platform_id, account_number, meta, provider,
        provider_account_id, is_archived, tracking_mode
      )
      VALUES (
        'connect-account',
        'Snap Account',
        'SECURITIES',
        NULL,
        'USD',
        0,
        1,
        '2026-05-14 08:00:00',
        '2026-05-14 08:30:00',
        'SNAPTRADE',
        '****1234',
        '{"institution":"SnapTrade"}',
        'SNAPTRADE',
        'provider-account-1',
        0,
        'HOLDINGS'
      )
    `,
  ).run();
  db.prepare(
    `
      INSERT INTO import_runs (
        id, account_id, source_system, run_type, mode, status, started_at, finished_at,
        review_mode, applied_at, checkpoint_in, checkpoint_out, summary, warnings, error,
        created_at, updated_at
      )
      VALUES
        (
          'import-run-1',
          'connect-account',
          'SNAPTRADE',
          'SYNC',
          'INCREMENTAL',
          'APPLIED',
          '2026-05-14T09:00:00+00:00',
          '2026-05-14T10:00:00+00:00',
          'NEVER',
          '2026-05-14T10:00:00+00:00',
          '{"cursor":"in"}',
          '{"cursor":"out"}',
          '{"fetched":2,"inserted":1,"updated":0,"skipped":1,"warnings":0,"errors":0,"removed":0,"assetsCreated":1}',
          '["minor"]',
          NULL,
          '2026-05-14T09:00:00+00:00',
          '2026-05-14T10:00:00+00:00'
        ),
        (
          'import-run-invalid',
          'connect-account',
          'SNAPTRADE',
          'BROKEN',
          'BROKEN',
          'BROKEN',
          '2026-05-15T10:00:00+00:00',
          'not-a-date',
          'BROKEN',
          'not-a-date',
          'not-json',
          NULL,
          '{"fetched":1}',
          '[1]',
          'bad enum row',
          '2026-05-15T10:00:00+00:00',
          '2026-05-15T10:00:00+00:00'
        )
    `,
  ).run();
  db.prepare(
    `
      INSERT INTO brokers_sync_state (
        account_id, provider, checkpoint_json, last_attempted_at, last_successful_at,
        last_error, last_run_id, sync_status, created_at, updated_at
      )
      VALUES
        (
          'connect-account',
          'SNAPTRADE',
          '{"lastSyncedDate":"2026-05-14","lookbackDays":30}',
          '2026-05-14T09:00:00+00:00',
          '2026-05-14T10:00:00+00:00',
          NULL,
          'import-run-1',
          'SYNCING',
          '2026-05-14T09:00:00+00:00',
          '2026-05-14T10:00:00+00:00'
        ),
        (
          'connect-account',
          'PLAID',
          NULL,
          'not-a-date',
          NULL,
          'mapping required',
          NULL,
          'NEEDS_REVIEW',
          '2026-05-15T09:00:00+00:00',
          '2026-05-15T10:00:00+00:00'
        )
    `,
  ).run();
}

function seedRuntimeValuation(
  db: ReturnType<typeof openSqliteDatabase>,
  valuation: {
    accountId: string;
    date: string;
    totalValue: string;
    fxRateToBase: string;
  },
): void {
  db.prepare(
    `
      INSERT INTO daily_account_valuation (
        id, account_id, valuation_date, account_currency, base_currency,
        fx_rate_to_base, cash_balance, investment_market_value, total_value,
        cost_basis, net_contribution, calculated_at
      )
      VALUES (?, ?, ?, 'USD', 'USD', ?, '0', '0', ?, '0', '0', ?)
    `,
  ).run(
    `${valuation.accountId}_${valuation.date}`,
    valuation.accountId,
    valuation.date,
    valuation.fxRateToBase,
    valuation.totalValue,
    `${valuation.date}T00:00:00Z`,
  );
}

function readRuntimeValuation(
  db: ReturnType<typeof openSqliteDatabase>,
  accountId: string,
  date: string,
): Record<string, string> | null {
  return (
    db
      .query<Record<string, string>, [string, string]>(
        `
          SELECT *
          FROM daily_account_valuation
          WHERE account_id = ?
            AND valuation_date = ?
        `,
      )
      .get(accountId, date) ?? null
  );
}

function readRuntimeSnapshot(
  db: ReturnType<typeof openSqliteDatabase>,
  accountId: string,
  date: string,
): Record<string, string> | null {
  return (
    db
      .query<Record<string, string>, [string, string]>(
        `
          SELECT *
          FROM holdings_snapshots
          WHERE account_id = ?
            AND snapshot_date = ?
        `,
      )
      .get(accountId, date) ?? null
  );
}

function readRuntimeSnapshotPositions(
  db: ReturnType<typeof openSqliteDatabase>,
  accountId: string,
  date: string,
): Record<string, { quantity: string; totalCostBasis: string }> {
  const snapshot = readRuntimeSnapshot(db, accountId, date);
  if (!snapshot) {
    return {};
  }
  return JSON.parse(snapshot.positions);
}

function readRuntimeGoalSummary(
  db: ReturnType<typeof openSqliteDatabase>,
  goalId: string,
): Record<string, number | null> | null {
  return (
    db
      .query<Record<string, number | null>, [string]>(
        `
          SELECT summary_current_value, summary_progress
          FROM goals
          WHERE id = ?
        `,
      )
      .get(goalId) ?? null
  );
}
