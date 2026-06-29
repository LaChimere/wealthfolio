import { createHash } from "node:crypto";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
  DEVICE_SYNC_PULL_COMPLETE_EVENT,
  HOLDINGS_CHANGED_EVENT,
  MANUAL_SNAPSHOT_SAVED_EVENT,
} from "./domain-events/planner";
import { createSyncCryptoService } from "./domains/sync-crypto";

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

  test("wires runtime targeted classification health fix to selected legacy assets", async () => {
    const appDataDir = mkdtempSync(
      path.join(tmpdir(), "wealthfolio-runtime-health-classification-fix-"),
    );
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedRuntimeAsset(seedDb, "target-legacy-asset");
        seedDb
          .prepare("UPDATE assets SET instrument_symbol = ?, display_code = ? WHERE id = ?")
          .run("TARGET", "TARGET", "target-legacy-asset");
        seedRuntimeAsset(seedDb, "other-legacy-asset");
        const legacyMetadata = JSON.stringify({
          identifiers: { symbol: "LEGACY" },
          legacy: {
            sectors: [{ name: "Technology", weight: 1 }],
            countries: [{ name: "United States", weight: 1 }],
          },
        });
        seedDb
          .prepare("UPDATE assets SET metadata = ? WHERE id = ?")
          .run(legacyMetadata, "target-legacy-asset");
        seedDb
          .prepare(
            "UPDATE assets SET metadata = ?, display_code = ?, instrument_symbol = ? WHERE id = ?",
          )
          .run(legacyMetadata, "OTHER", "OTHER", "other-legacy-asset");
      } finally {
        seedDb.close();
      }

      const response = await fetch(`${server.baseUrl}/api/v1/health/fix`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "migrate_classifications",
          label: "Migrate Classifications",
          payload: ["target-legacy-asset"],
        }),
      });
      expect(response.status).toBe(200);

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              { taxonomy_id: string; category_id: string; weight: number; source: string },
              []
            >(
              `
                SELECT taxonomy_id, category_id, weight, source
                FROM asset_taxonomy_assignments
                WHERE asset_id = 'target-legacy-asset'
                ORDER BY taxonomy_id ASC
              `,
            )
            .all(),
        ).toEqual([
          {
            taxonomy_id: "industries_gics",
            category_id: "45",
            weight: 10000,
            source: "migrated",
          },
          {
            taxonomy_id: "regions",
            category_id: "country_US",
            weight: 10000,
            source: "migrated",
          },
        ]);
        expect(
          verifyDb
            .query<
              { count: number },
              []
            >("SELECT COUNT(*) AS count FROM asset_taxonomy_assignments WHERE asset_id = 'other-legacy-asset'")
            .get()?.count,
        ).toBe(0);
        const targetMetadata = verifyDb
          .query<
            { metadata: string | null },
            []
          >("SELECT metadata FROM assets WHERE id = 'target-legacy-asset'")
          .get()?.metadata;
        const otherMetadata = verifyDb
          .query<
            { metadata: string | null },
            []
          >("SELECT metadata FROM assets WHERE id = 'other-legacy-asset'")
          .get()?.metadata;
        expect(JSON.parse(targetMetadata ?? "{}")).toEqual({ identifiers: { symbol: "LEGACY" } });
        expect(JSON.parse(otherMetadata ?? "{}")).toMatchObject({ legacy: expect.any(Object) });
        expect(
          readRuntimeSyncOutbox(verifyDb)
            .filter((row) => row.entity === "asset_taxonomy_assignment")
            .map((row) => ({
              entity: row.entity,
              op: row.op,
              payload: JSON.parse(String(row.payload)),
            })),
        ).toEqual([
          {
            entity: "asset_taxonomy_assignment",
            op: "update",
            payload: expect.objectContaining({
              asset_id: "target-legacy-asset",
              category_id: "45",
              taxonomy_id: "industries_gics",
            }),
          },
          {
            entity: "asset_taxonomy_assignment",
            op: "update",
            payload: expect.objectContaining({
              asset_id: "target-legacy-asset",
              category_id: "country_US",
              taxonomy_id: "regions",
            }),
          },
        ]);
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime health price sync fix to provider quote persistence", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-health-price-fix-"));
    const chartSymbols: string[] = [];
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      marketDataFetch: ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "https://fc.yahoo.com") {
          return Promise.resolve(
            new Response("", { headers: { "set-cookie": "B=health-sync; Path=/; Secure" } }),
          );
        }
        if (url === "https://query1.finance.yahoo.com/v1/test/getcrumb") {
          expect((init?.headers as Record<string, string>).Cookie).toBe("B=health-sync");
          return Promise.resolve(new Response("health-crumb"));
        }
        if (url.startsWith("https://query1.finance.yahoo.com/v8/finance/chart/HEALTH?")) {
          expect((init?.headers as Record<string, string>).Cookie).toBe("B=health-sync");
          const parsed = new URL(url);
          expect(parsed.searchParams.get("crumb")).toBe("health-crumb");
          chartSymbols.push("HEALTH");
          return Promise.resolve(
            Response.json({
              chart: {
                result: [
                  {
                    meta: { currency: "USD" },
                    timestamp: [1767571200],
                    indicators: { quote: [{ close: [12.34] }] },
                  },
                ],
                error: null,
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
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedRuntimeAsset(seedDb, "health-price-asset");
        seedDb
          .prepare(
            "UPDATE assets SET display_code = ?, instrument_symbol = ?, instrument_exchange_mic = ? WHERE id = ?",
          )
          .run("HEALTH", "HEALTH", "XNAS", "health-price-asset");
      } finally {
        seedDb.close();
      }

      const response = await fetch(`${server.baseUrl}/api/v1/health/fix`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "sync_prices",
          label: "Sync Prices",
          payload: ["health-price-asset"],
        }),
      });
      expect(response.status).toBe(200);
      expect(chartSymbols).toEqual(["HEALTH"]);

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              { asset_id: string; source: string; close: string; currency: string },
              []
            >("SELECT asset_id, source, close, currency FROM quotes WHERE asset_id = 'health-price-asset'")
            .get(),
        ).toEqual({
          asset_id: "health-price-asset",
          source: "YAHOO",
          close: "12.34",
          currency: "USD",
        });
      } finally {
        verifyDb.close();
      }
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

  test("wires runtime Connect broker activity sync to broker-described asset creation", async () => {
    const appDataDir = mkdtempSync(
      path.join(tmpdir(), "wealthfolio-runtime-connect-broker-activity-asset-"),
    );
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      domainEventDebounceMs: 10_000,
      env: {
        CONNECT_API_URL: "https://api.example.test",
      },
      marketDataFetch: (async (input) => {
        const url = String(input);
        if (url.includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token", refresh_token: "refresh-token" });
        }
        if (url.includes("/api/v1/sync/brokerage/accounts/provider-account-activity/activities")) {
          return Response.json({
            data: [
              {
                id: "broker-buy-1",
                type: "BUY",
                trade_date: "2026-01-05T10:00:00Z",
                units: 2,
                price: 150,
                amount: 300,
                provider_type: "SNAPTRADE",
                symbol: {
                  symbol: "AAPL",
                  raw_symbol: "AAPL",
                  description: "Apple Inc.",
                  exchange: { mic_code: "XNAS" },
                  currency: { code: "USD" },
                },
              },
            ],
            pagination: { has_more: false, total: 1, limit: 1000 },
          });
        }
        if (url.includes("query1.finance.yahoo.com/v1/finance/search")) {
          return Response.json({ quotes: [] });
        }
        return Response.json({});
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const seedDb = openSqliteDatabase(runtime.dbPath);
    try {
      seedDb
        .prepare(
          `
            INSERT INTO accounts (
              id, name, account_type, "group", currency, is_default, is_active,
              is_archived, tracking_mode, provider, provider_account_id
            )
            VALUES (
              'broker-activity-account', 'Broker Activity Account', 'SECURITIES', NULL,
              'USD', 0, 1, 0, 'TRANSACTIONS', 'SNAPTRADE', 'provider-account-activity'
            )
          `,
        )
        .run();
    } finally {
      seedDb.close();
    }
    const server = startBackendServer(config, runtime.options);

    try {
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const syncActivitiesResponse = await fetch(
        `${server.baseUrl}/api/v1/connect/sync/activities`,
        { method: "POST" },
      );
      expect(syncActivitiesResponse.status).toBe(200);
      await expect(syncActivitiesResponse.json()).resolves.toMatchObject({
        accountsSynced: 1,
        activitiesUpserted: 1,
        assetsInserted: 1,
        accountsFailed: 0,
        accountsWarned: 0,
        newAssetIds: [expect.any(String)],
      });

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        const asset = verifyDb
          .query<
            {
              id: string;
              display_code: string;
              quote_ccy: string;
              instrument_type: string | null;
              instrument_symbol: string | null;
              instrument_exchange_mic: string | null;
            },
            []
          >(
            `
              SELECT id, display_code, quote_ccy, instrument_type, instrument_symbol, instrument_exchange_mic
              FROM assets
              WHERE instrument_symbol = 'AAPL'
            `,
          )
          .get();
        expect(asset).toEqual({
          id: expect.any(String),
          display_code: "AAPL",
          quote_ccy: "USD",
          instrument_type: "EQUITY",
          instrument_symbol: "AAPL",
          instrument_exchange_mic: "XNAS",
        });
        expect(
          verifyDb
            .query<
              {
                activity_type: string;
                asset_id: string | null;
                quantity: string | null;
                unit_price: string | null;
                amount: string | null;
                currency: string;
                source_record_id: string | null;
              },
              []
            >(
              `
                SELECT activity_type, asset_id, quantity, unit_price, amount, currency, source_record_id
                FROM activities
                WHERE source_record_id = 'broker-buy-1'
              `,
            )
            .get(),
        ).toEqual({
          activity_type: "BUY",
          asset_id: asset?.id,
          quantity: "2",
          unit_price: "150",
          amount: "300",
          currency: "USD",
          source_record_id: "broker-buy-1",
        });
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect broker activity sync to provider-resolved asset creation", async () => {
    const appDataDir = mkdtempSync(
      path.join(tmpdir(), "wealthfolio-runtime-connect-broker-provider-asset-"),
    );
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      domainEventDebounceMs: 10_000,
      env: {
        CONNECT_API_URL: "https://api.example.test",
      },
      marketDataFetch: (async (input) => {
        const url = String(input);
        if (url.includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token", refresh_token: "refresh-token" });
        }
        if (url.includes("/api/v1/sync/brokerage/accounts/provider-account-provider/activities")) {
          return Response.json({
            data: [
              {
                id: "broker-buy-provider-1",
                type: "BUY",
                trade_date: "2026-01-05T10:00:00Z",
                units: 3,
                price: 420,
                amount: 1260,
                currency: { code: "USD" },
                provider_type: "SNAPTRADE",
                symbol: {
                  symbol: "MSFT",
                  raw_symbol: "MSFT",
                },
              },
            ],
            pagination: { has_more: false, total: 1, limit: 1000 },
          });
        }
        if (url === "https://query2.finance.yahoo.com/v1/finance/search?q=MSFT") {
          return Response.json({
            quotes: [
              {
                symbol: "MSFT",
                exchange: "NMS",
                quoteType: "EQUITY",
                shortname: "Microsoft Corporation",
                score: 99,
              },
            ],
          });
        }
        return Response.json({});
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const seedDb = openSqliteDatabase(runtime.dbPath);
    try {
      seedDb
        .prepare(
          `
            INSERT INTO accounts (
              id, name, account_type, "group", currency, is_default, is_active,
              is_archived, tracking_mode, provider, provider_account_id
            )
            VALUES (
              'broker-provider-account', 'Broker Provider Account', 'SECURITIES', NULL,
              'USD', 0, 1, 0, 'TRANSACTIONS', 'SNAPTRADE', 'provider-account-provider'
            )
          `,
        )
        .run();
    } finally {
      seedDb.close();
    }
    const server = startBackendServer(config, runtime.options);

    try {
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const syncActivitiesResponse = await fetch(
        `${server.baseUrl}/api/v1/connect/sync/activities`,
        { method: "POST" },
      );
      expect(syncActivitiesResponse.status).toBe(200);
      await expect(syncActivitiesResponse.json()).resolves.toMatchObject({
        accountsSynced: 1,
        activitiesUpserted: 1,
        assetsInserted: 1,
        accountsFailed: 0,
        accountsWarned: 0,
        newAssetIds: [expect.any(String)],
      });

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        const asset = verifyDb
          .query<
            {
              id: string;
              name: string | null;
              display_code: string;
              quote_ccy: string;
              instrument_type: string | null;
              instrument_symbol: string | null;
              instrument_exchange_mic: string | null;
            },
            []
          >(
            `
              SELECT id, name, display_code, quote_ccy, instrument_type, instrument_symbol, instrument_exchange_mic
              FROM assets
              WHERE instrument_symbol = 'MSFT'
            `,
          )
          .get();
        expect(asset).toEqual({
          id: expect.any(String),
          name: "Microsoft Corporation",
          display_code: "MSFT",
          quote_ccy: "USD",
          instrument_type: "EQUITY",
          instrument_symbol: "MSFT",
          instrument_exchange_mic: "XNAS",
        });
        expect(
          verifyDb
            .query<
              {
                activity_type: string;
                asset_id: string | null;
                quantity: string | null;
                unit_price: string | null;
                amount: string | null;
                currency: string;
                source_record_id: string | null;
              },
              []
            >(
              `
                SELECT activity_type, asset_id, quantity, unit_price, amount, currency, source_record_id
                FROM activities
                WHERE source_record_id = 'broker-buy-provider-1'
              `,
            )
            .get(),
        ).toEqual({
          activity_type: "BUY",
          asset_id: asset?.id,
          quantity: "3",
          unit_price: "420",
          amount: "1260",
          currency: "USD",
          source_record_id: "broker-buy-provider-1",
        });
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect broker activity sync to unresolved review draft", async () => {
    const appDataDir = mkdtempSync(
      path.join(tmpdir(), "wealthfolio-runtime-connect-broker-review-draft-"),
    );
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      domainEventDebounceMs: 10_000,
      env: {
        CONNECT_API_URL: "https://api.example.test",
      },
      marketDataFetch: (async (input) => {
        const url = String(input);
        if (url.includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token", refresh_token: "refresh-token" });
        }
        if (url.includes("/api/v1/sync/brokerage/accounts/provider-account-review/activities")) {
          return Response.json({
            data: [
              {
                id: "broker-review-1",
                type: "BUY",
                trade_date: "2026-01-05T10:00:00Z",
                units: 4,
                price: 25,
                amount: 100,
                currency: { code: "USD" },
                provider_type: "SNAPTRADE",
                symbol: {
                  symbol: "UNLISTED",
                  raw_symbol: "UNLISTED",
                  description: "Unlisted Security",
                },
              },
              {
                id: "broker-review-2",
                type: "BUY",
                trade_date: "2026-01-06T10:00:00Z",
                units: 3,
                price: 40,
                amount: 120,
                currency: { code: "USD" },
                provider_type: "SNAPTRADE",
              },
            ],
            pagination: { has_more: false, total: 1, limit: 1000 },
          });
        }
        if (url.includes("finance/search")) {
          return Response.json({ quotes: [] });
        }
        return Response.json({});
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const seedDb = openSqliteDatabase(runtime.dbPath);
    try {
      seedDb
        .prepare(
          `
            INSERT INTO accounts (
              id, name, account_type, "group", currency, is_default, is_active,
              is_archived, tracking_mode, provider, provider_account_id
            )
            VALUES (
              'broker-review-account', 'Broker Review Account', 'SECURITIES', NULL,
              'USD', 0, 1, 0, 'TRANSACTIONS', 'SNAPTRADE', 'provider-account-review'
            )
          `,
        )
        .run();
    } finally {
      seedDb.close();
    }
    const server = startBackendServer(config, runtime.options);

    try {
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const syncActivitiesResponse = await fetch(
        `${server.baseUrl}/api/v1/connect/sync/activities`,
        { method: "POST" },
      );
      expect(syncActivitiesResponse.status).toBe(200);
      await expect(syncActivitiesResponse.json()).resolves.toMatchObject({
        accountsSynced: 1,
        activitiesUpserted: 2,
        assetsInserted: 0,
        accountsFailed: 0,
        accountsWarned: 0,
        newAssetIds: [],
      });

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              {
                activity_type: string;
                asset_id: string | null;
                quantity: string | null;
                unit_price: string | null;
                amount: string | null;
                currency: string;
                status: string;
                needs_review: number;
                source_record_id: string | null;
              },
              []
            >(
              `
                SELECT activity_type, asset_id, quantity, unit_price, amount, currency, status, needs_review, source_record_id
                FROM activities
                WHERE source_record_id IN ('broker-review-1', 'broker-review-2')
                ORDER BY source_record_id
              `,
            )
            .all(),
        ).toEqual([
          {
            activity_type: "BUY",
            asset_id: null,
            quantity: "4",
            unit_price: "25",
            amount: "100",
            currency: "USD",
            status: "DRAFT",
            needs_review: 1,
            source_record_id: "broker-review-1",
          },
          {
            activity_type: "BUY",
            asset_id: null,
            quantity: "3",
            unit_price: "40",
            amount: "120",
            currency: "USD",
            status: "DRAFT",
            needs_review: 1,
            source_record_id: "broker-review-2",
          },
        ]);
      } finally {
        verifyDb.close();
      }
    } finally {
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

  test("wires runtime Connect device sync-state route for ready device", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-connect-ready-"));
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
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
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
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const syncStateResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/sync-state`);
      expect(syncStateResponse.status).toBe(200);
      await expect(syncStateResponse.json()).resolves.toEqual({
        state: "READY",
        deviceId: "device-runtime",
        deviceName: "MacBook",
        keyVersion: 5,
        serverKeyVersion: 5,
        isTrusted: true,
        trustedDevices: [],
      });
      expect(deviceSyncRequests).toEqual([
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

  test("wires runtime Connect device sync-state route for stale device", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-connect-stale-"));
    const deviceSyncRequests: string[] = [];
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
        deviceSyncRequests.push(url);
        if (url.endsWith("/api/v1/sync/team/devices?scope=my")) {
          return Response.json([
            {
              id: "trusted-device",
              display_name: "iPhone",
              platform: "ios",
              trust_state: "trusted",
              last_seen_at: null,
            },
          ]);
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 6,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
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
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const syncStateResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/sync-state`);
      expect(syncStateResponse.status).toBe(200);
      await expect(syncStateResponse.json()).resolves.toEqual({
        state: "STALE",
        deviceId: "device-runtime",
        deviceName: "MacBook",
        keyVersion: 5,
        serverKeyVersion: 6,
        isTrusted: true,
        trustedDevices: [
          {
            id: "trusted-device",
            name: "iPhone",
            platform: "ios",
            lastSeenAt: null,
          },
        ],
      });
      expect(deviceSyncRequests).toEqual([
        "https://api.example.test/api/v1/sync/team/devices/device-runtime",
        "https://api.example.test/api/v1/sync/team/devices?scope=my",
      ]);
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect device sync-state route for registered device", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-connect-registered-"));
    const deviceSyncRequests: string[] = [];
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
        deviceSyncRequests.push(url);
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "NOOP", cursor: 0 });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "untrusted",
          trusted_key_version: 0,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
        }),
      );
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const syncStateResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/sync-state`);
      expect(syncStateResponse.status).toBe(200);
      await expect(syncStateResponse.json()).resolves.toEqual({
        state: "REGISTERED",
        deviceId: "device-runtime",
        deviceName: "MacBook",
        keyVersion: null,
        serverKeyVersion: 0,
        isTrusted: false,
        trustedDevices: [],
      });
      expect(deviceSyncRequests).toEqual([
        "https://api.example.test/api/v1/sync/team/devices/device-runtime",
        "https://api.example.test/api/v1/sync/team/devices?scope=my",
        "https://api.example.test/api/v1/sync/team/keys/initialize",
      ]);
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect pairing-source status ready route", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-pairing-source-"));
    const deviceSyncRequests: Array<{ url: string; deviceId: string; requestId: string }> = [];
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
          deviceId: headers.get("x-wf-device-id") ?? "",
          requestId: headers.get("x-wf-client-request-id") ?? "",
        });
        if (url.endsWith("/api/v1/sync/events/cursor")) {
          return Response.json({ cursor: 10 });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
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
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.prepare("UPDATE sync_cursor SET cursor = 10 WHERE id = 1").run();
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const sourceResponse = await fetch(
        `${server.baseUrl}/api/v1/connect/device/pairing-source-status`,
      );
      expect(sourceResponse.status).toBe(200);
      await expect(sourceResponse.json()).resolves.toEqual({
        status: "ready",
        message: "This device is ready to connect another device.",
        localCursor: 10,
        serverCursor: 10,
      });
      expect(deviceSyncRequests).toEqual([
        {
          url: "https://api.example.test/api/v1/sync/team/devices/device-runtime",
          deviceId: "",
          requestId: expect.stringMatching(/^app:[0-9a-f-]{36}$/),
        },
        {
          url: "https://api.example.test/api/v1/sync/events/cursor",
          deviceId: "device-runtime",
          requestId: expect.stringMatching(/^device-runtime:[0-9a-f-]{36}$/),
        },
      ]);
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect pairing-source status restore-required route", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-pairing-restore-"));
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
        if (url.endsWith("/api/v1/sync/events/cursor")) {
          return Response.json({ cursor: 8 });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
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
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.prepare("UPDATE sync_cursor SET cursor = 10 WHERE id = 1").run();
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const sourceResponse = await fetch(
        `${server.baseUrl}/api/v1/connect/device/pairing-source-status`,
      );
      expect(sourceResponse.status).toBe(200);
      await expect(sourceResponse.json()).resolves.toEqual({
        status: "restore_required",
        message: "This device needs to set up sync again before you add another device.",
        localCursor: 10,
        serverCursor: 8,
      });
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect trigger-cycle route for ready noop", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-trigger-noop-"));
    const deviceSyncRequests: string[] = [];
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
        deviceSyncRequests.push(url);
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "NOOP" });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
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
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.exec(`
          UPDATE sync_cursor SET cursor = 9 WHERE id = 1;
          UPDATE sync_engine_state SET
            lock_version = 4,
            last_cycle_status = 'stale_cursor',
            last_error = 'stale',
            consecutive_failures = 3
          WHERE id = 1;
        `);
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const triggerResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/trigger-cycle`, {
        method: "POST",
      });
      expect(triggerResponse.status).toBe(200);
      await expect(triggerResponse.json()).resolves.toEqual({
        status: "ok",
        lockVersion: 0,
        pushedCount: 0,
        pulledCount: 0,
        cursor: 9,
        needsBootstrap: false,
        bootstrapSnapshotId: null,
        bootstrapSnapshotSeq: null,
        deadLetterCount: 0,
      });
      expect(deviceSyncRequests).toEqual([
        "https://api.example.test/api/v1/sync/team/devices/device-runtime",
        "https://api.example.test/api/v1/sync/events/reconcile-ready-state",
      ]);
      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              {
                last_cycle_status: string | null;
                last_error: string | null;
                consecutive_failures: number;
              },
              []
            >(
              "SELECT last_cycle_status, last_error, consecutive_failures FROM sync_engine_state WHERE id = 1",
            )
            .get(),
        ).toEqual({ last_cycle_status: "ok", last_error: null, consecutive_failures: 0 });
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect trigger-cycle route to malformed reconcile state error", async () => {
    const appDataDir = mkdtempSync(
      path.join(tmpdir(), "wealthfolio-runtime-trigger-reconcile-parse-"),
    );
    const deviceSyncRequests: string[] = [];
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
        deviceSyncRequests.push(url);
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return new Response('{"\\uZZZZ":"NOOP"}', {
            headers: { "content-type": "application/json" },
          });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
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
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.exec(`
          UPDATE sync_cursor SET cursor = 9 WHERE id = 1;
          UPDATE sync_engine_state SET
            lock_version = 4,
            last_cycle_status = 'ok',
            last_error = NULL,
            consecutive_failures = 0
          WHERE id = 1;
        `);
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const triggerResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/trigger-cycle`, {
        method: "POST",
      });
      expect(triggerResponse.status).toBe(200);
      await expect(triggerResponse.json()).resolves.toMatchObject({
        status: "state_error",
        lockVersion: 4,
        cursor: 9,
      });
      expect(deviceSyncRequests).toEqual([
        "https://api.example.test/api/v1/sync/team/devices/device-runtime",
        "https://api.example.test/api/v1/sync/events/reconcile-ready-state",
      ]);
      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              {
                last_cycle_status: string | null;
                last_error: string | null;
                consecutive_failures: number;
              },
              []
            >(
              "SELECT last_cycle_status, last_error, consecutive_failures FROM sync_engine_state WHERE id = 1",
            )
            .get(),
        ).toEqual({
          last_cycle_status: "state_error",
          last_error: "Failed to read sync state: Failed to parse reconcile-ready-state response",
          consecutive_failures: 0,
        });
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect trigger-cycle route to push pending outbox", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-trigger-push-"));
    const rootKey = Buffer.alloc(32, 7).toString("base64");
    const deviceSyncRequests: string[] = [];
    const pushBodies: Array<Record<string, unknown>> = [];
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
        deviceSyncRequests.push(url);
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "NOOP" });
        }
        if (url.endsWith("/api/v1/sync/events/push")) {
          pushBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          return Response.json({
            accepted: [{ event_id: "11111111-1111-4111-8111-111111111111", seq: 8 }],
            duplicate: [],
            server_cursor: 7,
          });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 2,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey,
          keyVersion: 2,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb
          .prepare(
            `
            UPDATE sync_cursor
            SET cursor = 7
            WHERE id = 1
          `,
          )
          .run();
        seedDb
          .prepare(
            `
            INSERT INTO sync_outbox (
              event_id, entity, entity_id, op, client_timestamp, payload,
              payload_key_version, sent, status, retry_count, device_id, created_at
            )
            VALUES (
              '11111111-1111-4111-8111-111111111111',
              'account',
              '22222222-2222-4222-8222-222222222222',
              'update',
              '2026-01-01T00:00:00Z',
              '{"id":"22222222-2222-4222-8222-222222222222","name":"Synced"}',
              2,
              0,
              'pending',
              0,
              'device-runtime',
              '2026-01-01T00:00:00Z'
            )
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

      const triggerResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/trigger-cycle`, {
        method: "POST",
      });
      expect(triggerResponse.status).toBe(200);
      await expect(triggerResponse.json()).resolves.toEqual({
        status: "ok",
        lockVersion: 1,
        pushedCount: 1,
        pulledCount: 0,
        cursor: 7,
        needsBootstrap: false,
        bootstrapSnapshotId: null,
        bootstrapSnapshotSeq: null,
        deadLetterCount: 0,
      });
      expect(deviceSyncRequests).toEqual([
        "https://api.example.test/api/v1/sync/team/devices/device-runtime",
        "https://api.example.test/api/v1/sync/events/reconcile-ready-state",
        "https://api.example.test/api/v1/sync/events/push",
      ]);
      expect(pushBodies).toHaveLength(1);
      const pushedEvent = (pushBodies[0]?.events as Array<Record<string, unknown>>)[0];
      expect(pushedEvent).toMatchObject({
        event_id: "11111111-1111-4111-8111-111111111111",
        device_id: "device-runtime",
        type: "account.update.v1",
        entity: "account",
        entity_id: "22222222-2222-4222-8222-222222222222",
        client_timestamp: "2026-01-01T00:00:00Z",
        payload_key_version: 2,
      });
      const crypto = createSyncCryptoService();
      const dek = (await crypto.deriveDek(rootKey, 2)).value;
      expect(await crypto.decrypt(dek, String(pushedEvent?.payload))).toEqual({
        value: '{"id":"22222222-2222-4222-8222-222222222222","name":"Synced"}',
      });

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<{ sent: number; status: string; last_error: string | null }, []>(
              `
                SELECT sent, status, last_error
                FROM sync_outbox
                WHERE event_id = '11111111-1111-4111-8111-111111111111'
              `,
            )
            .get(),
        ).toEqual({ sent: 1, status: "sent", last_error: null });
        expect(
          verifyDb
            .query<
              {
                last_push_at: string | null;
                last_cycle_status: string | null;
                last_error: string | null;
              },
              []
            >(
              "SELECT last_push_at, last_cycle_status, last_error FROM sync_engine_state WHERE id = 1",
            )
            .get(),
        ).toEqual({
          last_push_at: expect.any(String),
          last_cycle_status: "ok",
          last_error: null,
        });
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect trigger-cycle route to schedule push retry", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-trigger-push-retry-"));
    const rootKey = Buffer.alloc(32, 8).toString("base64");
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
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "NOOP" });
        }
        if (url.endsWith("/api/v1/sync/events/push")) {
          return Response.json({ code: "TEMPORARY", message: "try later" }, { status: 409 });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 2,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey,
          keyVersion: 2,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.exec(`
          UPDATE sync_cursor SET cursor = 7 WHERE id = 1;
          INSERT INTO sync_outbox (
            event_id, entity, entity_id, op, client_timestamp, payload,
            payload_key_version, sent, status, retry_count, device_id, created_at
          )
          VALUES (
            '44444444-4444-4444-8444-444444444444',
            'account',
            '55555555-5555-4555-8555-555555555555',
            'update',
            '2026-01-01T00:00:00Z',
            '{"id":"55555555-5555-4555-8555-555555555555","name":"Retry"}',
            2,
            0,
            'pending',
            2,
            'device-runtime',
            '2026-01-01T00:00:00Z'
          );
        `);
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const triggerResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/trigger-cycle`, {
        method: "POST",
      });
      expect(triggerResponse.status).toBe(200);
      await expect(triggerResponse.json()).resolves.toMatchObject({
        status: "push_error",
        lockVersion: 1,
        pushedCount: 0,
        cursor: 7,
      });

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              {
                status: string;
                sent: number;
                retry_count: number;
                next_retry_at: string | null;
                last_error_code: string | null;
              },
              []
            >(
              `
                SELECT status, sent, retry_count, next_retry_at, last_error_code
                FROM sync_outbox
                WHERE event_id = '44444444-4444-4444-8444-444444444444'
              `,
            )
            .get(),
        ).toEqual({
          status: "pending",
          sent: 0,
          retry_count: 3,
          next_retry_at: expect.any(String),
          last_error_code: "retryable",
        });
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect trigger-cycle route to drop stale key-version events", async () => {
    const appDataDir = mkdtempSync(
      path.join(tmpdir(), "wealthfolio-runtime-trigger-key-mismatch-"),
    );
    const rootKey = Buffer.alloc(32, 10).toString("base64");
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
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "NOOP" });
        }
        if (url.endsWith("/api/v1/sync/events/push")) {
          return Response.json(
            { code: "SYNC_KEY_VERSION_MISMATCH", message: "key mismatch" },
            { status: 409 },
          );
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 2,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey,
          keyVersion: 2,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.exec(`
          UPDATE sync_cursor SET cursor = 7 WHERE id = 1;
          INSERT INTO sync_outbox (
            event_id, entity, entity_id, op, client_timestamp, payload,
            payload_key_version, sent, status, retry_count, device_id, created_at
          )
          VALUES
            (
              'aaaaaaaa-1111-4111-8111-111111111111',
              'account',
              'bbbbbbbb-2222-4222-8222-222222222222',
              'update',
              '2026-01-01T00:00:00Z',
              '{}',
              1,
              0,
              'pending',
              0,
              'device-runtime',
              '2026-01-01T00:00:00Z'
            ),
            (
              'cccccccc-3333-4333-8333-333333333333',
              'account',
              'dddddddd-4444-4444-8444-444444444444',
              'update',
              '2026-01-01T00:00:00Z',
              '{}',
              2,
              0,
              'pending',
              0,
              'device-runtime',
              '2026-01-01T00:00:00Z'
            );
        `);
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const triggerResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/trigger-cycle`, {
        method: "POST",
      });
      expect(triggerResponse.status).toBe(200);
      await expect(triggerResponse.json()).resolves.toMatchObject({
        status: "ok",
        deadLetterCount: 1,
      });

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<{ event_id: string; status: string; last_error_code: string | null }, []>(
              `
                SELECT event_id, status, last_error_code
                FROM sync_outbox
                ORDER BY event_id
              `,
            )
            .all(),
        ).toEqual([
          {
            event_id: "aaaaaaaa-1111-4111-8111-111111111111",
            status: "dead",
            last_error_code: "key_version_mismatch",
          },
          {
            event_id: "cccccccc-3333-4333-8333-333333333333",
            status: "pending",
            last_error_code: null,
          },
        ]);
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect trigger-cycle route to wait-snapshot state", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-trigger-wait-"));
    const deviceSyncRequests: string[] = [];
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
        deviceSyncRequests.push(url);
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "WAIT_SNAPSHOT" });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
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
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.exec(`
          UPDATE sync_cursor SET cursor = 11 WHERE id = 1;
          UPDATE sync_engine_state SET
            lock_version = 4,
            last_cycle_status = 'state_error',
            last_error = 'stale error',
            consecutive_failures = 3,
            next_retry_at = NULL
          WHERE id = 1;
        `);
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const triggerResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/trigger-cycle`, {
        method: "POST",
      });
      expect(triggerResponse.status).toBe(200);
      await expect(triggerResponse.json()).resolves.toEqual({
        status: "wait_snapshot",
        lockVersion: 0,
        pushedCount: 0,
        pulledCount: 0,
        cursor: 11,
        needsBootstrap: false,
        bootstrapSnapshotId: null,
        bootstrapSnapshotSeq: null,
        deadLetterCount: 0,
      });
      expect(deviceSyncRequests).toEqual([
        "https://api.example.test/api/v1/sync/team/devices/device-runtime",
        "https://api.example.test/api/v1/sync/events/reconcile-ready-state",
      ]);
      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              {
                last_cycle_status: string | null;
                last_error: string | null;
                consecutive_failures: number;
                next_retry_at: string | null;
              },
              []
            >(
              "SELECT last_cycle_status, last_error, consecutive_failures, next_retry_at FROM sync_engine_state WHERE id = 1",
            )
            .get(),
        ).toMatchObject({
          last_cycle_status: "wait_snapshot",
          last_error: "stale error",
          consecutive_failures: 3,
          next_retry_at: expect.any(String),
        });
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect trigger-cycle route to stale-cursor state", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-trigger-stale-"));
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
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({
            action: "BOOTSTRAP_SNAPSHOT",
            latest_snapshot: {
              snapshot_id: "snapshot-1",
              schema_version: 1,
              oplog_seq: 99,
            },
          });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
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
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.exec(`
          UPDATE sync_cursor SET cursor = 12 WHERE id = 1;
          UPDATE sync_engine_state SET
            lock_version = 4,
            last_cycle_status = 'state_error',
            last_error = 'stale error',
            consecutive_failures = 3,
            next_retry_at = '2030-01-01T00:00:00Z'
          WHERE id = 1;
        `);
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const triggerResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/trigger-cycle`, {
        method: "POST",
      });
      expect(triggerResponse.status).toBe(200);
      await expect(triggerResponse.json()).resolves.toEqual({
        status: "stale_cursor",
        lockVersion: 0,
        pushedCount: 0,
        pulledCount: 0,
        cursor: 12,
        needsBootstrap: true,
        bootstrapSnapshotId: "snapshot-1",
        bootstrapSnapshotSeq: 99,
        deadLetterCount: 0,
      });
      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              {
                last_cycle_status: string | null;
                last_error: string | null;
                consecutive_failures: number;
                next_retry_at: string | null;
              },
              []
            >(
              "SELECT last_cycle_status, last_error, consecutive_failures, next_retry_at FROM sync_engine_state WHERE id = 1",
            )
            .get(),
        ).toEqual({
          last_cycle_status: "stale_cursor",
          last_error: "stale error",
          consecutive_failures: 3,
          next_retry_at: null,
        });
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect trigger-cycle route for covered pull-tail", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-trigger-pull-tail-"));
    const deviceSyncRequests: string[] = [];
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
        deviceSyncRequests.push(url);
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "PULL_TAIL", cursor: 25001 });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
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
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.exec(`
          UPDATE sync_cursor SET cursor = 25001 WHERE id = 1;
          UPDATE sync_engine_state SET
            lock_version = 4,
            last_cycle_status = 'state_error',
            last_error = 'stale error',
            consecutive_failures = 3,
            next_retry_at = '2030-01-01T00:00:00Z'
          WHERE id = 1;
          INSERT INTO sync_applied_events (event_id, seq, entity, entity_id, applied_at)
          VALUES
            ('covered-pruned', 15001, 'account', 'account-pruned', '2026-01-01T00:00:00Z'),
            ('covered-kept', 15002, 'account', 'account-kept', '2026-01-01T00:00:00Z');
        `);
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const triggerResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/trigger-cycle`, {
        method: "POST",
      });
      expect(triggerResponse.status).toBe(200);
      await expect(triggerResponse.json()).resolves.toEqual({
        status: "ok",
        lockVersion: 5,
        pushedCount: 0,
        pulledCount: 0,
        cursor: 25001,
        needsBootstrap: false,
        bootstrapSnapshotId: null,
        bootstrapSnapshotSeq: null,
        deadLetterCount: 0,
      });
      expect(deviceSyncRequests).toEqual([
        "https://api.example.test/api/v1/sync/team/devices/device-runtime",
        "https://api.example.test/api/v1/sync/events/reconcile-ready-state",
      ]);
      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              {
                lock_version: number;
                last_cycle_status: string | null;
                last_error: string | null;
                consecutive_failures: number;
                next_retry_at: string | null;
              },
              []
            >(
              "SELECT lock_version, last_cycle_status, last_error, consecutive_failures, next_retry_at FROM sync_engine_state WHERE id = 1",
            )
            .get(),
        ).toEqual({
          lock_version: 5,
          last_cycle_status: "ok",
          last_error: null,
          consecutive_failures: 0,
          next_retry_at: null,
        });
        expect(
          verifyDb
            .query<
              { event_id: string; seq: number },
              []
            >("SELECT event_id, seq FROM sync_applied_events ORDER BY event_id ASC")
            .all(),
        ).toEqual([{ event_id: "covered-kept", seq: 15002 }]);
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect trigger-cycle route to empty pull-tail", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-trigger-empty-pull-"));
    const deviceSyncRequests: string[] = [];
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
        deviceSyncRequests.push(url);
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "PULL_TAIL", cursor: 15 });
        }
        if (url.endsWith("/api/v1/sync/events/pull?since=12&limit=500")) {
          return Response.json({
            from: 12,
            to: 15,
            next_cursor: 15,
            has_more: false,
            events: [
              {
                event_id: "66666666-6666-4666-8666-666666666666",
                device_id: "device-runtime",
                type: "account.update.v1",
                entity: "account",
                entity_id: "77777777-7777-4777-8777-777777777777",
                client_timestamp: "2026-01-01T00:00:00Z",
                payload: "{}",
                payload_key_version: 5,
                seq: 13,
                user_id: "user-1",
                team_id: "team-1",
                server_timestamp: "2026-01-01T00:00:01Z",
              },
              {
                event_id: "88888888-8888-4888-8888-888888888888",
                device_id: "other-device",
                type: "snapshot.gc.v1",
                entity: "snapshot",
                entity_id: "99999999-9999-4999-8999-999999999999",
                client_timestamp: "2026-01-01T00:00:00Z",
                payload: "{}",
                payload_key_version: 5,
                seq: 14,
                user_id: "user-1",
                team_id: "team-1",
                server_timestamp: "2026-01-01T00:00:01Z",
              },
            ],
          });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
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
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.exec(`
          UPDATE sync_cursor SET cursor = 12 WHERE id = 1;
          UPDATE sync_engine_state SET
            lock_version = 4,
            last_cycle_status = 'state_error',
            last_error = 'stale error',
            consecutive_failures = 3,
            next_retry_at = '2030-01-01T00:00:00Z'
          WHERE id = 1;
          INSERT INTO sync_outbox (
            event_id, entity, entity_id, op, client_timestamp, payload,
            payload_key_version, sent, status, retry_count, device_id, created_at
          )
          VALUES (
            '33333333-3333-4333-8333-333333333333',
            'account',
            'not-a-uuid',
            'update',
            '2026-01-01T00:00:00Z',
            '{}',
            5,
            0,
            'pending',
            0,
            'device-runtime',
            '2026-01-01T00:00:00Z'
          );
        `);
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const triggerResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/trigger-cycle`, {
        method: "POST",
      });
      expect(triggerResponse.status).toBe(200);
      await expect(triggerResponse.json()).resolves.toEqual({
        status: "ok",
        lockVersion: 5,
        pushedCount: 0,
        pulledCount: 0,
        cursor: 15,
        needsBootstrap: false,
        bootstrapSnapshotId: null,
        bootstrapSnapshotSeq: null,
        deadLetterCount: 1,
      });
      expect(deviceSyncRequests).toEqual([
        "https://api.example.test/api/v1/sync/team/devices/device-runtime",
        "https://api.example.test/api/v1/sync/events/reconcile-ready-state",
        "https://api.example.test/api/v1/sync/events/pull?since=12&limit=500",
      ]);
      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              {
                cursor: number;
                last_pull_at: string | null;
                last_cycle_status: string | null;
                last_error: string | null;
                consecutive_failures: number;
                next_retry_at: string | null;
              },
              []
            >(
              `
                SELECT sync_cursor.cursor,
                       sync_engine_state.last_pull_at,
                       sync_engine_state.last_cycle_status,
                       sync_engine_state.last_error,
                       sync_engine_state.consecutive_failures,
                       sync_engine_state.next_retry_at,
                       sync_outbox.status AS outbox_status,
                       sync_outbox.last_error_code AS outbox_error
                FROM sync_cursor
                JOIN sync_engine_state ON sync_engine_state.id = sync_cursor.id
                LEFT JOIN sync_outbox
                  ON sync_outbox.event_id = '33333333-3333-4333-8333-333333333333'
                WHERE sync_cursor.id = 1
              `,
            )
            .get(),
        ).toEqual({
          cursor: 15,
          last_pull_at: expect.any(String),
          last_cycle_status: "ok",
          last_error: null,
          consecutive_failures: 0,
          next_retry_at: null,
          outbox_status: "dead",
          outbox_error: "invalid_entity_id",
        });
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect pull-tail to prune old applied events", async () => {
    const appDataDir = mkdtempSync(
      path.join(tmpdir(), "wealthfolio-runtime-trigger-applied-prune-"),
    );
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
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "PULL_TAIL", cursor: 25001 });
        }
        if (url.endsWith("/api/v1/sync/events/pull?since=20000&limit=500")) {
          return Response.json({
            from: 20000,
            to: 25001,
            next_cursor: 25001,
            has_more: false,
            events: [],
          });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
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
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.exec(`
          UPDATE sync_cursor SET cursor = 20000 WHERE id = 1;
          INSERT INTO sync_applied_events (event_id, seq, entity, entity_id, applied_at)
          VALUES
            ('applied-pruned', 15001, 'account', 'account-pruned', '2026-01-01T00:00:00Z'),
            ('applied-kept', 15002, 'account', 'account-kept', '2026-01-01T00:00:00Z');
        `);
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const triggerResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/trigger-cycle`, {
        method: "POST",
      });
      expect(triggerResponse.status).toBe(200);
      await expect(triggerResponse.json()).resolves.toMatchObject({
        status: "ok",
        cursor: 25001,
      });
      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              { event_id: string; seq: number },
              []
            >("SELECT event_id, seq FROM sync_applied_events ORDER BY event_id ASC")
            .all(),
        ).toEqual([{ event_id: "applied-kept", seq: 15002 }]);
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect trigger-cycle route to account replay", async () => {
    const appDataDir = mkdtempSync(
      path.join(tmpdir(), "wealthfolio-runtime-trigger-account-replay-"),
    );
    const rootKey = Buffer.alloc(32, 9).toString("base64");
    const crypto = createSyncCryptoService();
    const dek = (await crypto.deriveDek(rootKey, 5)).value;
    const encryptedPayload = (
      await crypto.encrypt(
        dek,
        JSON.stringify({
          id: "77777777-7777-4777-8777-777777777777",
          name: "Remote Account",
          account_type: "SECURITIES",
          group: null,
          currency: "USD",
          is_default: false,
          is_active: true,
          created_at: "2026-01-01T00:00:00",
          updated_at: "2026-01-01T00:00:00",
          platform_id: null,
          account_number: null,
          meta: null,
          provider: null,
          provider_account_id: null,
          is_archived: false,
          tracking_mode: "TRANSACTIONS",
        }),
      )
    ).value;
    const malformedEncryptedPayload = (
      await crypto.encrypt(
        dek,
        JSON.stringify({
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          account_type: "SECURITIES",
          currency: "USD",
        }),
      )
    ).value;
    const deviceSyncRequests: string[] = [];
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
        deviceSyncRequests.push(url);
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "PULL_TAIL", cursor: 16 });
        }
        if (url.endsWith("/api/v1/sync/events/pull?since=12&limit=500")) {
          return Response.json({
            from: 12,
            to: 16,
            next_cursor: 16,
            has_more: false,
            events: [
              {
                event_id: "99999999-9999-4999-8999-999999999999",
                device_id: "other-device",
                type: "account.create.v1",
                entity: "account",
                entity_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                client_timestamp: "2026-01-01T00:00:00Z",
                payload: malformedEncryptedPayload,
                payload_key_version: 5,
                seq: 15,
                user_id: "user-1",
                team_id: "team-1",
                server_timestamp: "2026-01-01T00:00:01Z",
              },
              {
                event_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                device_id: "other-device",
                type: "account.create.v1",
                entity: "account",
                entity_id: "77777777-7777-4777-8777-777777777777",
                client_timestamp: "2026-01-01T00:00:00Z",
                payload: encryptedPayload,
                payload_key_version: 5,
                seq: 16,
                user_id: "user-1",
                team_id: "team-1",
                server_timestamp: "2026-01-01T00:00:01Z",
              },
            ],
          });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey,
          keyVersion: 5,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.prepare("UPDATE sync_cursor SET cursor = 12 WHERE id = 1").run();
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const triggerResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/trigger-cycle`, {
        method: "POST",
      });
      expect(triggerResponse.status).toBe(200);
      await expect(triggerResponse.json()).resolves.toMatchObject({
        status: "ok",
        pushedCount: 0,
        pulledCount: 1,
        cursor: 16,
      });

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              {
                name: string;
                account_type: string;
                currency: string;
                tracking_mode: string;
              },
              []
            >(
              `
                SELECT name, account_type, currency, tracking_mode
                FROM accounts
                WHERE id = '77777777-7777-4777-8777-777777777777'
              `,
            )
            .get(),
        ).toEqual({
          name: "Remote Account",
          account_type: "SECURITIES",
          currency: "USD",
          tracking_mode: "TRANSACTIONS",
        });
        expect(
          verifyDb
            .query<{ last_event_id: string; last_op: string; last_seq: number }, []>(
              `
                SELECT last_event_id, last_op, last_seq
                FROM sync_entity_metadata
                WHERE entity = 'account'
                  AND entity_id = '77777777-7777-4777-8777-777777777777'
              `,
            )
            .get(),
        ).toEqual({
          last_event_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          last_op: "create",
          last_seq: 16,
        });
        expect(
          verifyDb
            .query<
              { count: number },
              []
            >("SELECT COUNT(*) AS count FROM accounts WHERE id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'")
            .get(),
        ).toEqual({ count: 0 });
        expect(
          verifyDb
            .query<
              { event_id: string; seq: number },
              []
            >("SELECT event_id, seq FROM sync_applied_events WHERE event_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'")
            .get(),
        ).toEqual({ event_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", seq: 16 });
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect trigger-cycle route to platform replay", async () => {
    const appDataDir = mkdtempSync(
      path.join(tmpdir(), "wealthfolio-runtime-trigger-platform-replay-"),
    );
    const rootKey = Buffer.alloc(32, 12).toString("base64");
    const crypto = createSyncCryptoService();
    const dek = (await crypto.deriveDek(rootKey, 5)).value;
    const encryptedPayload = (
      await crypto.encrypt(
        dek,
        JSON.stringify({
          id: "platform-replay",
          name: "Replay Broker",
          url: "https://replay.example",
          external_id: "brokerage-external",
          kind: "BROKERAGE",
          website_url: "https://broker.example",
          logo_url: "https://broker.example/logo.png",
        }),
      )
    ).value;
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
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "PULL_TAIL", cursor: 18 });
        }
        if (url.endsWith("/api/v1/sync/events/pull?since=12&limit=500")) {
          return Response.json({
            from: 12,
            to: 18,
            next_cursor: 18,
            has_more: false,
            events: [
              {
                event_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                device_id: "other-device",
                type: "platform.create.v1",
                entity: "platform",
                entity_id: "platform-replay",
                client_timestamp: "2026-01-01T00:00:00Z",
                payload: encryptedPayload,
                payload_key_version: 5,
                seq: 18,
                user_id: "user-1",
                team_id: "team-1",
                server_timestamp: "2026-01-01T00:00:01Z",
              },
            ],
          });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey,
          keyVersion: 5,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.prepare("UPDATE sync_cursor SET cursor = 12 WHERE id = 1").run();
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const triggerResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/trigger-cycle`, {
        method: "POST",
      });
      expect(triggerResponse.status).toBe(200);
      await expect(triggerResponse.json()).resolves.toMatchObject({
        status: "ok",
        pulledCount: 1,
        cursor: 18,
      });

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              {
                name: string | null;
                url: string;
                external_id: string | null;
                kind: string;
                website_url: string | null;
                logo_url: string | null;
              },
              []
            >(
              `
                SELECT name, url, external_id, kind, website_url, logo_url
                FROM platforms
                WHERE id = 'platform-replay'
              `,
            )
            .get(),
        ).toEqual({
          name: "Replay Broker",
          url: "https://replay.example",
          external_id: "brokerage-external",
          kind: "BROKERAGE",
          website_url: "https://broker.example",
          logo_url: "https://broker.example/logo.png",
        });
        expect(
          verifyDb
            .query<{ last_event_id: string; last_op: string; last_seq: number }, []>(
              `
                SELECT last_event_id, last_op, last_seq
                FROM sync_entity_metadata
                WHERE entity = 'platform'
                  AND entity_id = 'platform-replay'
              `,
            )
            .get(),
        ).toEqual({
          last_event_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          last_op: "create",
          last_seq: 18,
        });
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect trigger-cycle route to portfolio replay", async () => {
    const appDataDir = mkdtempSync(
      path.join(tmpdir(), "wealthfolio-runtime-trigger-portfolio-replay-"),
    );
    const rootKey = Buffer.alloc(32, 13).toString("base64");
    const crypto = createSyncCryptoService();
    const dek = (await crypto.deriveDek(rootKey, 5)).value;
    const encryptedPayload = (
      await crypto.encrypt(
        dek,
        JSON.stringify({
          id: "portfolio-replay",
          name: "Replay Portfolio",
          description: "Remote portfolio",
          sortOrder: 7,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        }),
      )
    ).value;
    const encryptedMembershipPayload = (
      await crypto.encrypt(
        dek,
        JSON.stringify({
          id: "pfm_portfolio-replay_replay-account",
          portfolioId: "portfolio-replay",
          accountId: "replay-account",
          sortOrder: 0,
          createdAt: "2026-01-01T00:00:00Z",
        }),
      )
    ).value;
    const encryptedInvalidPayload = (
      await crypto.encrypt(dek, JSON.stringify({ id: "invalid-replay-account" }))
    ).value;
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
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "PULL_TAIL", cursor: 20 });
        }
        if (url.endsWith("/api/v1/sync/events/pull?since=12&limit=500")) {
          return Response.json({
            from: 12,
            to: 20,
            next_cursor: 20,
            has_more: false,
            events: [
              {
                event_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                device_id: "other-device",
                type: "portfolio_account.create.v1",
                entity: "portfolio_account",
                entity_id: "pfm_portfolio-replay_replay-account",
                client_timestamp: "2026-01-01T00:00:00Z",
                payload: encryptedMembershipPayload,
                payload_key_version: 5,
                seq: 18,
                user_id: "user-1",
                team_id: "team-1",
                server_timestamp: "2026-01-01T00:00:01Z",
              },
              {
                event_id: "dadadada-dada-4dad-8dad-dadadadadada",
                device_id: "other-device",
                type: "account.create.v1",
                entity: "account",
                entity_id: "invalid-replay-account",
                client_timestamp: "2026-01-01T00:00:00Z",
                payload: encryptedInvalidPayload,
                payload_key_version: 5,
                seq: 19,
                user_id: "user-1",
                team_id: "team-1",
                server_timestamp: "2026-01-01T00:00:01Z",
              },
              {
                event_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                device_id: "other-device",
                type: "portfolio.create.v1",
                entity: "portfolio",
                entity_id: "portfolio-replay",
                client_timestamp: "2026-01-01T00:00:00Z",
                payload: encryptedPayload,
                payload_key_version: 5,
                seq: 20,
                user_id: "user-1",
                team_id: "team-1",
                server_timestamp: "2026-01-01T00:00:01Z",
              },
            ],
          });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey,
          keyVersion: 5,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.exec(`
          UPDATE sync_cursor SET cursor = 12 WHERE id = 1;
          INSERT INTO accounts (
            id, name, account_type, "group", currency, is_default, is_active,
            is_archived, tracking_mode
          )
          VALUES ('replay-account', 'Replay Account', 'CASH', NULL, 'USD', 0, 1, 0, 'HOLDINGS');
        `);
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const triggerResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/trigger-cycle`, {
        method: "POST",
      });
      expect(triggerResponse.status).toBe(200);
      await expect(triggerResponse.json()).resolves.toMatchObject({
        status: "ok",
        pulledCount: 2,
        cursor: 20,
      });

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              {
                name: string;
                description: string | null;
                sort_order: number;
                created_at: string;
                updated_at: string;
              },
              []
            >(
              `
                SELECT name, description, sort_order, created_at, updated_at
                FROM portfolios
                WHERE id = 'portfolio-replay'
              `,
            )
            .get(),
        ).toEqual({
          name: "Replay Portfolio",
          description: "Remote portfolio",
          sort_order: 7,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        });
        expect(
          verifyDb
            .query<{ last_event_id: string; last_op: string; last_seq: number }, []>(
              `
                SELECT last_event_id, last_op, last_seq
                FROM sync_entity_metadata
                WHERE entity = 'portfolio'
                  AND entity_id = 'portfolio-replay'
              `,
            )
            .get(),
        ).toEqual({
          last_event_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          last_op: "create",
          last_seq: 20,
        });
        expect(
          verifyDb
            .query<{ portfolio_id: string; account_id: string; sort_order: number }, []>(
              `
                SELECT portfolio_id, account_id, sort_order
                FROM portfolio_accounts
                WHERE id = 'pfm_portfolio-replay_replay-account'
              `,
            )
            .get(),
        ).toEqual({
          portfolio_id: "portfolio-replay",
          account_id: "replay-account",
          sort_order: 0,
        });
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect trigger-cycle route to contribution-limit replay", async () => {
    const appDataDir = mkdtempSync(
      path.join(tmpdir(), "wealthfolio-runtime-trigger-contribution-replay-"),
    );
    const rootKey = Buffer.alloc(32, 14).toString("base64");
    const crypto = createSyncCryptoService();
    const dek = (await crypto.deriveDek(rootKey, 5)).value;
    const encryptedPayload = (
      await crypto.encrypt(
        dek,
        JSON.stringify({
          id: "limit-replay",
          groupName: "RRSP",
          contributionYear: 2026,
          limitAmount: 31560,
          accountIds: "account-one,account-two",
          createdAt: "2026-01-01T00:00:00",
          updatedAt: "2026-01-01T00:00:00",
          startDate: "2026-01-01T00:00:00Z",
          endDate: "2026-12-31T23:59:59Z",
        }),
      )
    ).value;
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
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "PULL_TAIL", cursor: 23 });
        }
        if (url.endsWith("/api/v1/sync/events/pull?since=12&limit=500")) {
          return Response.json({
            from: 12,
            to: 23,
            next_cursor: 23,
            has_more: false,
            events: [
              {
                event_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                device_id: "other-device",
                type: "contribution_limit.create.v1",
                entity: "contribution_limit",
                entity_id: "limit-replay",
                client_timestamp: "2026-01-01T00:00:00Z",
                payload: encryptedPayload,
                payload_key_version: 5,
                seq: 23,
                user_id: "user-1",
                team_id: "team-1",
                server_timestamp: "2026-01-01T00:00:01Z",
              },
            ],
          });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey,
          keyVersion: 5,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.prepare("UPDATE sync_cursor SET cursor = 12 WHERE id = 1").run();
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const triggerResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/trigger-cycle`, {
        method: "POST",
      });
      expect(triggerResponse.status).toBe(200);
      await expect(triggerResponse.json()).resolves.toMatchObject({
        status: "ok",
        pulledCount: 1,
        cursor: 23,
      });

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              {
                group_name: string;
                contribution_year: number;
                limit_amount: number;
                account_ids: string | null;
                start_date: string | null;
                end_date: string | null;
              },
              []
            >(
              `
                SELECT group_name, contribution_year, limit_amount, account_ids, start_date, end_date
                FROM contribution_limits
                WHERE id = 'limit-replay'
              `,
            )
            .get(),
        ).toEqual({
          group_name: "RRSP",
          contribution_year: 2026,
          limit_amount: 31560,
          account_ids: "account-one,account-two",
          start_date: "2026-01-01T00:00:00Z",
          end_date: "2026-12-31T23:59:59Z",
        });
        expect(
          verifyDb
            .query<{ last_event_id: string; last_op: string; last_seq: number }, []>(
              `
                SELECT last_event_id, last_op, last_seq
                FROM sync_entity_metadata
                WHERE entity = 'contribution_limit'
                  AND entity_id = 'limit-replay'
              `,
            )
            .get(),
        ).toEqual({
          last_event_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          last_op: "create",
          last_seq: 23,
        });
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect trigger-cycle route to custom-provider replay", async () => {
    const appDataDir = mkdtempSync(
      path.join(tmpdir(), "wealthfolio-runtime-trigger-custom-provider-replay-"),
    );
    const rootKey = Buffer.alloc(32, 15).toString("base64");
    const crypto = createSyncCryptoService();
    const dek = (await crypto.deriveDek(rootKey, 5)).value;
    const configJson = JSON.stringify({
      sources: [
        {
          id: "remote-provider:latest",
          kind: "latest",
          format: "json",
          url: "https://prices.example/latest",
          pricePath: "$.price",
        },
      ],
    });
    const encryptedPayload = (
      await crypto.encrypt(
        dek,
        JSON.stringify({
          id: "provider-replay",
          code: "remote-provider",
          name: "Remote Provider",
          description: "Remote custom source",
          enabled: false,
          priority: 17,
          config: configJson,
          createdAt: "2026-01-01T00:00:00+00:00",
          updatedAt: "2026-01-02T00:00:00+00:00",
        }),
      )
    ).value;
    const encryptedUnknownPayload = (
      await crypto.encrypt(
        dek,
        JSON.stringify({
          id: "provider-replay",
          code: "remote-provider",
          name: "Unknown Column Provider",
          description: "Remote custom source",
          enabled: true,
          priority: 18,
          config: configJson,
          createdAt: "2026-01-01T00:00:00+00:00",
          updatedAt: "2026-01-03T00:00:00+00:00",
          unknownField: "must reject",
        }),
      )
    ).value;
    const encryptedConflictingAliasPayload = (
      await crypto.encrypt(
        dek,
        JSON.stringify({
          id: "provider-replay",
          code: "remote-provider",
          name: "Conflicting Alias Provider",
          description: "Remote custom source",
          enabled: true,
          priority: 19,
          config: configJson,
          createdAt: "2026-01-01T00:00:00+00:00",
          created_at: "2025-01-01T00:00:00+00:00",
          updatedAt: "2026-01-04T00:00:00+00:00",
        }),
      )
    ).value;
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
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "PULL_TAIL", cursor: 26 });
        }
        if (url.endsWith("/api/v1/sync/events/pull?since=12&limit=500")) {
          return Response.json({
            from: 12,
            to: 26,
            next_cursor: 26,
            has_more: false,
            events: [
              {
                event_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
                device_id: "other-device",
                type: "custom_provider.create.v1",
                entity: "custom_provider",
                entity_id: "provider-replay",
                client_timestamp: "2026-01-02T00:00:00Z",
                payload: encryptedPayload,
                payload_key_version: 5,
                seq: 24,
                user_id: "user-1",
                team_id: "team-1",
                server_timestamp: "2026-01-02T00:00:01Z",
              },
              {
                event_id: "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1",
                device_id: "other-device",
                type: "custom_provider.update.v1",
                entity: "custom_provider",
                entity_id: "provider-replay",
                client_timestamp: "2026-01-03T00:00:00Z",
                payload: encryptedUnknownPayload,
                payload_key_version: 5,
                seq: 25,
                user_id: "user-1",
                team_id: "team-1",
                server_timestamp: "2026-01-03T00:00:01Z",
              },
              {
                event_id: "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2",
                device_id: "other-device",
                type: "custom_provider.update.v1",
                entity: "custom_provider",
                entity_id: "provider-replay",
                client_timestamp: "2026-01-04T00:00:00Z",
                payload: encryptedConflictingAliasPayload,
                payload_key_version: 5,
                seq: 26,
                user_id: "user-1",
                team_id: "team-1",
                server_timestamp: "2026-01-04T00:00:01Z",
              },
            ],
          });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey,
          keyVersion: 5,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.prepare("UPDATE sync_cursor SET cursor = 12 WHERE id = 1").run();
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const triggerResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/trigger-cycle`, {
        method: "POST",
      });
      expect(triggerResponse.status).toBe(200);
      await expect(triggerResponse.json()).resolves.toMatchObject({
        status: "ok",
        pulledCount: 1,
        cursor: 26,
      });

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              {
                code: string;
                name: string;
                description: string;
                enabled: number;
                priority: number;
                config: string | null;
              },
              []
            >(
              `
                SELECT code, name, description, enabled, priority, config
                FROM market_data_custom_providers
                WHERE id = 'provider-replay'
              `,
            )
            .get(),
        ).toEqual({
          code: "remote-provider",
          name: "Remote Provider",
          description: "Remote custom source",
          enabled: 0,
          priority: 17,
          config: configJson,
        });
        expect(
          verifyDb
            .query<{ last_event_id: string; last_op: string; last_seq: number }, []>(
              `
                SELECT last_event_id, last_op, last_seq
                FROM sync_entity_metadata
                WHERE entity = 'custom_provider'
                  AND entity_id = 'provider-replay'
              `,
            )
            .get(),
        ).toEqual({
          last_event_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          last_op: "create",
          last_seq: 24,
        });
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect trigger-cycle route to goal replay", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-trigger-goal-replay-"));
    const rootKey = Buffer.alloc(32, 16).toString("base64");
    const crypto = createSyncCryptoService();
    const dek = (await crypto.deriveDek(rootKey, 5)).value;
    const encryptedPayload = (
      await crypto.encrypt(
        dek,
        JSON.stringify({
          id: "goal-replay",
          title: "Remote Goal",
          description: "Remote save-up goal",
          targetAmount: 50000,
          goalType: "custom_save_up",
          isAchieved: " TRUE ",
          statusLifecycle: "achieved",
          statusHealth: "on_track",
          priority: 4,
          coverImageKey: "cover-key",
          currency: "USD",
          startDate: "2026-01-01",
          targetDate: "2026-12-31",
          summaryCurrentValue: 1250.5,
          summaryProgress: 2.5,
          projectedCompletionDate: "2026-11-30",
          projectedValueAtTargetDate: 52000,
          summaryTargetAmount: 50000,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-02T00:00:00Z",
        }),
      )
    ).value;
    const encryptedUpdatePayload = (
      await crypto.encrypt(
        dek,
        JSON.stringify({
          id: "goal-replay",
          title: "Remote Goal Updated",
          targetAmount: 60000,
          isAchieved: false,
        }),
      )
    ).value;
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
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "PULL_TAIL", cursor: 28 });
        }
        if (url.endsWith("/api/v1/sync/events/pull?since=12&limit=500")) {
          return Response.json({
            from: 12,
            to: 28,
            next_cursor: 28,
            has_more: false,
            events: [
              {
                event_id: "12121212-1212-4212-8212-121212121212",
                device_id: "other-device",
                type: "goal.create.v1",
                entity: "goal",
                entity_id: "goal-replay",
                client_timestamp: "2026-01-02T00:00:00Z",
                payload: encryptedPayload,
                payload_key_version: 5,
                seq: 27,
                user_id: "user-1",
                team_id: "team-1",
                server_timestamp: "2026-01-02T00:00:01Z",
              },
              {
                event_id: "13131313-1313-4313-8313-131313131313",
                device_id: "other-device",
                type: "goal.update.v1",
                entity: "goal",
                entity_id: "goal-replay",
                client_timestamp: "2026-01-03T00:00:00Z",
                payload: encryptedUpdatePayload,
                payload_key_version: 5,
                seq: 28,
                user_id: "user-1",
                team_id: "team-1",
                server_timestamp: "2026-01-03T00:00:01Z",
              },
            ],
          });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey,
          keyVersion: 5,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.prepare("UPDATE sync_cursor SET cursor = 12 WHERE id = 1").run();
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const triggerResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/trigger-cycle`, {
        method: "POST",
      });
      expect(triggerResponse.status).toBe(200);
      await expect(triggerResponse.json()).resolves.toMatchObject({
        status: "ok",
        pulledCount: 2,
        cursor: 28,
      });

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              {
                title: string;
                target_amount: number;
                status_lifecycle: string;
                status_health: string;
                priority: number;
                summary_current_value: number | null;
                summary_target_amount: number | null;
              },
              []
            >(
              `
                SELECT title, target_amount, status_lifecycle, status_health, priority,
                  summary_current_value, summary_target_amount
                FROM goals
                WHERE id = 'goal-replay'
              `,
            )
            .get(),
        ).toEqual({
          title: "Remote Goal Updated",
          target_amount: 60000,
          status_lifecycle: "active",
          status_health: "on_track",
          priority: 4,
          summary_current_value: 1250.5,
          summary_target_amount: 50000,
        });
        expect(
          verifyDb
            .query<{ last_event_id: string; last_op: string; last_seq: number }, []>(
              `
                SELECT last_event_id, last_op, last_seq
                FROM sync_entity_metadata
                WHERE entity = 'goal'
                  AND entity_id = 'goal-replay'
              `,
            )
            .get(),
        ).toEqual({
          last_event_id: "13131313-1313-4313-8313-131313131313",
          last_op: "update",
          last_seq: 28,
        });
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect trigger-cycle route to goal-plan replay", async () => {
    const appDataDir = mkdtempSync(
      path.join(tmpdir(), "wealthfolio-runtime-trigger-goal-plan-replay-"),
    );
    const rootKey = Buffer.alloc(32, 17).toString("base64");
    const crypto = createSyncCryptoService();
    const dek = (await crypto.deriveDek(rootKey, 5)).value;
    const settingsJson = JSON.stringify({ targetDate: "2026-12-31", monthlyContribution: 250 });
    const summaryJson = JSON.stringify({ status: "on_track" });
    const encryptedPayload = (
      await crypto.encrypt(
        dek,
        JSON.stringify({
          goalId: "goal-plan-replay",
          planKind: "save_up",
          plannerMode: "simple",
          settingsJson,
          summaryJson,
          version: 3,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-02T00:00:00Z",
        }),
      )
    ).value;
    const updatedSettingsJson = JSON.stringify({ targetDate: "2027-12-31" });
    const encryptedUpdatePayload = (
      await crypto.encrypt(
        dek,
        JSON.stringify({
          goalId: "goal-plan-replay",
          settingsJson: updatedSettingsJson,
          version: 4,
        }),
      )
    ).value;
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
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "PULL_TAIL", cursor: 29 });
        }
        if (url.endsWith("/api/v1/sync/events/pull?since=12&limit=500")) {
          return Response.json({
            from: 12,
            to: 29,
            next_cursor: 29,
            has_more: false,
            events: [
              {
                event_id: "23232323-2323-4232-8232-232323232323",
                device_id: "other-device",
                type: "goal_plan.create.v1",
                entity: "goal_plan",
                entity_id: "goal-plan-replay",
                client_timestamp: "2026-01-02T00:00:00Z",
                payload: encryptedPayload,
                payload_key_version: 5,
                seq: 28,
                user_id: "user-1",
                team_id: "team-1",
                server_timestamp: "2026-01-02T00:00:01Z",
              },
              {
                event_id: "24242424-2424-4242-8242-242424242424",
                device_id: "other-device",
                type: "goal_plan.update.v1",
                entity: "goal_plan",
                entity_id: "goal-plan-replay",
                client_timestamp: "2026-01-03T00:00:00Z",
                payload: encryptedUpdatePayload,
                payload_key_version: 5,
                seq: 29,
                user_id: "user-1",
                team_id: "team-1",
                server_timestamp: "2026-01-03T00:00:01Z",
              },
            ],
          });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey,
          keyVersion: 5,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.exec(`
          UPDATE sync_cursor SET cursor = 12 WHERE id = 1;
          INSERT INTO goals (
            id, title, description, target_amount, goal_type, status_lifecycle,
            status_health, priority, cover_image_key, currency, start_date,
            target_date, summary_current_value, summary_progress,
            projected_completion_date, projected_value_at_target_date,
            created_at, updated_at, summary_target_amount
          )
          VALUES (
            'goal-plan-replay', 'Parent Goal', NULL, 1000, 'custom_save_up', 'active',
            'not_applicable', 0, NULL, 'USD', NULL, NULL, NULL, NULL, NULL, NULL,
            '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 1000
          );
        `);
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const triggerResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/trigger-cycle`, {
        method: "POST",
      });
      expect(triggerResponse.status).toBe(200);
      await expect(triggerResponse.json()).resolves.toMatchObject({
        status: "ok",
        pulledCount: 2,
        cursor: 29,
      });

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              {
                plan_kind: string;
                planner_mode: string | null;
                settings_json: string;
                summary_json: string;
                version: number;
              },
              []
            >(
              `
                SELECT plan_kind, planner_mode, settings_json, summary_json, version
                FROM goal_plans
                WHERE goal_id = 'goal-plan-replay'
              `,
            )
            .get(),
        ).toEqual({
          plan_kind: "save_up",
          planner_mode: "simple",
          settings_json: updatedSettingsJson,
          summary_json: summaryJson,
          version: 4,
        });
        expect(
          verifyDb
            .query<{ last_event_id: string; last_op: string; last_seq: number }, []>(
              `
                SELECT last_event_id, last_op, last_seq
                FROM sync_entity_metadata
                WHERE entity = 'goal_plan'
                  AND entity_id = 'goal-plan-replay'
              `,
            )
            .get(),
        ).toEqual({
          last_event_id: "24242424-2424-4242-8242-242424242424",
          last_op: "update",
          last_seq: 29,
        });
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect trigger-cycle route to goals-allocation replay", async () => {
    const appDataDir = mkdtempSync(
      path.join(tmpdir(), "wealthfolio-runtime-trigger-goals-allocation-replay-"),
    );
    const rootKey = Buffer.alloc(32, 18).toString("base64");
    const crypto = createSyncCryptoService();
    const dek = (await crypto.deriveDek(rootKey, 5)).value;
    const encryptedPayload = (
      await crypto.encrypt(
        dek,
        JSON.stringify({
          id: "allocation-replay",
          goalId: "allocation-goal",
          accountId: "allocation-account",
          percentAllocation: 33.5,
          taxBucket: "tfsa",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-02T00:00:00Z",
        }),
      )
    ).value;
    const encryptedUpdatePayload = (
      await crypto.encrypt(
        dek,
        JSON.stringify({
          id: "allocation-replay",
          percentAllocation: 44.5,
        }),
      )
    ).value;
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
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "PULL_TAIL", cursor: 30 });
        }
        if (url.endsWith("/api/v1/sync/events/pull?since=12&limit=500")) {
          return Response.json({
            from: 12,
            to: 30,
            next_cursor: 30,
            has_more: false,
            events: [
              {
                event_id: "34343434-3434-4343-8343-343434343434",
                device_id: "other-device",
                type: "goals_allocation.create.v1",
                entity: "goals_allocation",
                entity_id: "allocation-replay",
                client_timestamp: "2026-01-02T00:00:00Z",
                payload: encryptedPayload,
                payload_key_version: 5,
                seq: 29,
                user_id: "user-1",
                team_id: "team-1",
                server_timestamp: "2026-01-02T00:00:01Z",
              },
              {
                event_id: "35353535-3535-4353-8353-353535353535",
                device_id: "other-device",
                type: "goals_allocation.update.v1",
                entity: "goals_allocation",
                entity_id: "allocation-replay",
                client_timestamp: "2026-01-03T00:00:00Z",
                payload: encryptedUpdatePayload,
                payload_key_version: 5,
                seq: 30,
                user_id: "user-1",
                team_id: "team-1",
                server_timestamp: "2026-01-03T00:00:01Z",
              },
            ],
          });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey,
          keyVersion: 5,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.exec(`
          UPDATE sync_cursor SET cursor = 12 WHERE id = 1;
          INSERT INTO accounts (
            id, name, account_type, "group", currency, is_default, is_active,
            is_archived, tracking_mode
          )
          VALUES ('allocation-account', 'Allocation Account', 'CASH', NULL, 'USD', 0, 1, 0, 'HOLDINGS');
          INSERT INTO goals (
            id, title, description, target_amount, goal_type, status_lifecycle,
            status_health, priority, cover_image_key, currency, start_date,
            target_date, summary_current_value, summary_progress,
            projected_completion_date, projected_value_at_target_date,
            created_at, updated_at, summary_target_amount
          )
          VALUES (
            'allocation-goal', 'Allocation Goal', NULL, 1000, 'custom_save_up', 'active',
            'not_applicable', 0, NULL, 'USD', NULL, NULL, NULL, NULL, NULL, NULL,
            '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 1000
          );
        `);
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const triggerResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/trigger-cycle`, {
        method: "POST",
      });
      expect(triggerResponse.status).toBe(200);
      await expect(triggerResponse.json()).resolves.toMatchObject({
        status: "ok",
        pulledCount: 2,
        cursor: 30,
      });

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              {
                goal_id: string;
                account_id: string;
                share_percent: number;
                tax_bucket: string | null;
              },
              []
            >(
              `
                SELECT goal_id, account_id, share_percent, tax_bucket
                FROM goals_allocation
                WHERE id = 'allocation-replay'
              `,
            )
            .get(),
        ).toEqual({
          goal_id: "allocation-goal",
          account_id: "allocation-account",
          share_percent: 44.5,
          tax_bucket: "tfsa",
        });
        expect(
          verifyDb
            .query<{ last_event_id: string; last_op: string; last_seq: number }, []>(
              `
                SELECT last_event_id, last_op, last_seq
                FROM sync_entity_metadata
                WHERE entity = 'goals_allocation'
                  AND entity_id = 'allocation-replay'
              `,
            )
            .get(),
        ).toEqual({
          last_event_id: "35353535-3535-4353-8353-353535353535",
          last_op: "update",
          last_seq: 30,
        });
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect trigger-cycle route to import-template replay", async () => {
    const appDataDir = mkdtempSync(
      path.join(tmpdir(), "wealthfolio-runtime-trigger-import-template-replay-"),
    );
    const rootKey = Buffer.alloc(32, 19).toString("base64");
    const crypto = createSyncCryptoService();
    const dek = (await crypto.deriveDek(rootKey, 5)).value;
    const configJson = JSON.stringify({ fieldMappings: { date: "Date" } });
    const encryptedPayload = (
      await crypto.encrypt(
        dek,
        JSON.stringify({
          id: "template-replay",
          name: "Remote Template",
          scope: "USER",
          kind: "CSV_ACTIVITY",
          sourceSystem: "",
          configVersion: 2,
          config: configJson,
          createdAt: "2026-01-01T00:00:00",
          updatedAt: "2026-01-02T00:00:00",
        }),
      )
    ).value;
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
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "PULL_TAIL", cursor: 31 });
        }
        if (url.endsWith("/api/v1/sync/events/pull?since=12&limit=500")) {
          return Response.json({
            from: 12,
            to: 31,
            next_cursor: 31,
            has_more: false,
            events: [
              {
                event_id: "46464646-4646-4464-8464-464646464646",
                device_id: "other-device",
                type: "import_template.create.v1",
                entity: "import_template",
                entity_id: "template-replay",
                client_timestamp: "2026-01-02T00:00:00Z",
                payload: encryptedPayload,
                payload_key_version: 5,
                seq: 31,
                user_id: "user-1",
                team_id: "team-1",
                server_timestamp: "2026-01-02T00:00:01Z",
              },
            ],
          });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey,
          keyVersion: 5,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.prepare("UPDATE sync_cursor SET cursor = 12 WHERE id = 1").run();
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const triggerResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/trigger-cycle`, {
        method: "POST",
      });
      expect(triggerResponse.status).toBe(200);
      await expect(triggerResponse.json()).resolves.toMatchObject({
        status: "ok",
        pulledCount: 1,
        cursor: 31,
      });

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              {
                name: string;
                scope: string;
                kind: string;
                source_system: string;
                config_version: number;
                config: string;
              },
              []
            >(
              `
                SELECT name, scope, kind, source_system, config_version, config
                FROM import_templates
                WHERE id = 'template-replay'
              `,
            )
            .get(),
        ).toEqual({
          name: "Remote Template",
          scope: "USER",
          kind: "CSV_ACTIVITY",
          source_system: "",
          config_version: 2,
          config: configJson,
        });
        expect(
          verifyDb
            .query<{ last_event_id: string; last_op: string; last_seq: number }, []>(
              `
                SELECT last_event_id, last_op, last_seq
                FROM sync_entity_metadata
                WHERE entity = 'import_template'
                  AND entity_id = 'template-replay'
              `,
            )
            .get(),
        ).toEqual({
          last_event_id: "46464646-4646-4464-8464-464646464646",
          last_op: "create",
          last_seq: 31,
        });
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect trigger-cycle route to activity replay", async () => {
    const appDataDir = mkdtempSync(
      path.join(tmpdir(), "wealthfolio-runtime-trigger-activity-replay-"),
    );
    const rootKey = Buffer.alloc(32, 33).toString("base64");
    const crypto = createSyncCryptoService();
    const dek = (await crypto.deriveDek(rootKey, 5)).value;
    const encryptedPayload = (
      await crypto.encrypt(
        dek,
        JSON.stringify({
          id: "activity-replay",
          account_id: "activity-account",
          asset_id: "activity-asset",
          activity_type: "BUY",
          activity_type_override: null,
          source_type: null,
          subtype: null,
          status: "POSTED",
          activity_date: "2026-01-02T00:00:00",
          settlement_date: null,
          quantity: "3",
          unit_price: "12.50",
          amount: "37.50",
          fee: "1.00",
          currency: "USD",
          fx_rate: null,
          notes: "remote activity",
          metadata: JSON.stringify({ broker: "remote" }),
          source_system: "broker",
          source_record_id: "remote-activity-1",
          source_group_id: null,
          idempotency_key: "broker:remote-activity-1",
          import_run_id: null,
          is_user_modified: 1,
          needs_review: 0,
          created_at: "2026-01-02T00:00:00+00:00",
          updated_at: "2026-01-02T00:00:00+00:00",
        }),
      )
    ).value;
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
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "PULL_TAIL", cursor: 32 });
        }
        if (url.endsWith("/api/v1/sync/events/pull?since=12&limit=500")) {
          return Response.json({
            from: 12,
            to: 32,
            next_cursor: 32,
            has_more: false,
            events: [
              {
                event_id: "53535353-5353-4535-8535-535353535353",
                device_id: "other-device",
                type: "activity.create.v1",
                entity: "activity",
                entity_id: "activity-replay",
                client_timestamp: "2026-01-02T00:00:00Z",
                payload: encryptedPayload,
                payload_key_version: 5,
                seq: 32,
                user_id: "user-1",
                team_id: "team-1",
                server_timestamp: "2026-01-02T00:00:01Z",
              },
            ],
          });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey,
          keyVersion: 5,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.exec(`
          UPDATE sync_cursor SET cursor = 12 WHERE id = 1;
          INSERT INTO accounts (
            id, name, account_type, "group", currency, is_default, is_active,
            is_archived, tracking_mode
          )
          VALUES ('activity-account', 'Activity Account', 'SECURITIES', NULL, 'USD', 0, 1, 0, 'TRANSACTIONS');
        `);
        seedRuntimeAsset(seedDb, "activity-asset");
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const triggerResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/trigger-cycle`, {
        method: "POST",
      });
      expect(triggerResponse.status).toBe(200);
      await expect(triggerResponse.json()).resolves.toMatchObject({
        status: "ok",
        pulledCount: 1,
        cursor: 32,
      });

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              {
                account_id: string;
                asset_id: string | null;
                activity_type: string;
                quantity: string | null;
                unit_price: string | null;
                amount: string | null;
                fee: string | null;
                source_record_id: string | null;
                is_user_modified: number;
              },
              []
            >(
              `
                SELECT account_id, asset_id, activity_type, quantity, unit_price,
                  amount, fee, source_record_id, is_user_modified
                FROM activities
                WHERE id = 'activity-replay'
              `,
            )
            .get(),
        ).toEqual({
          account_id: "activity-account",
          asset_id: "activity-asset",
          activity_type: "BUY",
          quantity: "3",
          unit_price: "12.50",
          amount: "37.50",
          fee: "1.00",
          source_record_id: "remote-activity-1",
          is_user_modified: 1,
        });
        expect(
          verifyDb
            .query<{ last_event_id: string; last_op: string; last_seq: number }, []>(
              `
                SELECT last_event_id, last_op, last_seq
                FROM sync_entity_metadata
                WHERE entity = 'activity'
                  AND entity_id = 'activity-replay'
              `,
            )
            .get(),
        ).toEqual({
          last_event_id: "53535353-5353-4535-8535-535353535353",
          last_op: "create",
          last_seq: 32,
        });
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect trigger-cycle route to activity-import-profile replay", async () => {
    const appDataDir = mkdtempSync(
      path.join(tmpdir(), "wealthfolio-runtime-trigger-import-profile-replay-"),
    );
    const rootKey = Buffer.alloc(32, 20).toString("base64");
    const crypto = createSyncCryptoService();
    const dek = (await crypto.deriveDek(rootKey, 5)).value;
    const encryptedPayload = (
      await crypto.encrypt(
        dek,
        JSON.stringify({
          id: "link-replay",
          accountId: "profile-account",
          importType: "ACTIVITY",
          templateId: "profile-template",
          createdAt: "2026-01-01T00:00:00",
          updatedAt: "2026-01-02T00:00:00",
        }),
      )
    ).value;
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
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "PULL_TAIL", cursor: 32 });
        }
        if (url.endsWith("/api/v1/sync/events/pull?since=12&limit=500")) {
          return Response.json({
            from: 12,
            to: 32,
            next_cursor: 32,
            has_more: false,
            events: [
              {
                event_id: "57575757-5757-4575-8575-575757575757",
                device_id: "other-device",
                type: "activity_import_profile.create.v1",
                entity: "activity_import_profile",
                entity_id: "link-replay",
                client_timestamp: "2026-01-02T00:00:00Z",
                payload: encryptedPayload,
                payload_key_version: 5,
                seq: 32,
                user_id: "user-1",
                team_id: "team-1",
                server_timestamp: "2026-01-02T00:00:01Z",
              },
            ],
          });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey,
          keyVersion: 5,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.exec(`
          UPDATE sync_cursor SET cursor = 12 WHERE id = 1;
          INSERT INTO accounts (
            id, name, account_type, "group", currency, is_default, is_active,
            is_archived, tracking_mode
          )
          VALUES ('profile-account', 'Profile Account', 'CASH', NULL, 'USD', 0, 1, 0, 'HOLDINGS');
          INSERT INTO import_templates (
            id, name, scope, kind, source_system, config_version, config, created_at, updated_at
          )
          VALUES (
            'profile-template', 'Profile Template', 'USER', 'CSV_ACTIVITY', '', 1, '{}',
            '2026-01-01T00:00:00', '2026-01-01T00:00:00'
          );
        `);
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const triggerResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/trigger-cycle`, {
        method: "POST",
      });
      expect(triggerResponse.status).toBe(200);
      await expect(triggerResponse.json()).resolves.toMatchObject({
        status: "ok",
        pulledCount: 1,
        cursor: 32,
      });

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              {
                account_id: string;
                context_kind: string;
                source_system: string;
                template_id: string;
              },
              []
            >(
              `
                SELECT account_id, context_kind, source_system, template_id
                FROM import_account_templates
                WHERE id = 'link-replay'
              `,
            )
            .get(),
        ).toEqual({
          account_id: "profile-account",
          context_kind: "CSV_ACTIVITY",
          source_system: "",
          template_id: "profile-template",
        });
        expect(
          verifyDb
            .query<{ last_event_id: string; last_op: string; last_seq: number }, []>(
              `
                SELECT last_event_id, last_op, last_seq
                FROM sync_entity_metadata
                WHERE entity = 'activity_import_profile'
                  AND entity_id = 'link-replay'
              `,
            )
            .get(),
        ).toEqual({
          last_event_id: "57575757-5757-4575-8575-575757575757",
          last_op: "create",
          last_seq: 32,
        });
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("keeps Connect trigger-cycle cursor pinned on missing replay dependencies", async () => {
    const appDataDir = mkdtempSync(
      path.join(tmpdir(), "wealthfolio-runtime-trigger-replay-missing-dependency-"),
    );
    const rootKey = Buffer.alloc(32, 22).toString("base64");
    const crypto = createSyncCryptoService();
    const dek = (await crypto.deriveDek(rootKey, 5)).value;
    const encryptedPayload = (
      await crypto.encrypt(
        dek,
        JSON.stringify({
          id: "missing-dependency-link",
          accountId: "missing-dependency-account",
          importType: "ACTIVITY",
          templateId: "missing-template",
          createdAt: "2026-01-01T00:00:00",
          updatedAt: "2026-01-02T00:00:00",
        }),
      )
    ).value;
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
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "PULL_TAIL", cursor: 34 });
        }
        if (url.endsWith("/api/v1/sync/events/pull?since=12&limit=500")) {
          return Response.json({
            from: 12,
            to: 34,
            next_cursor: 34,
            has_more: false,
            events: [
              {
                event_id: "79797979-7979-4797-8797-797979797979",
                device_id: "other-device",
                type: "activity_import_profile.create.v1",
                entity: "activity_import_profile",
                entity_id: "missing-dependency-link",
                client_timestamp: "2026-01-02T00:00:00Z",
                payload: encryptedPayload,
                payload_key_version: 5,
                seq: 34,
                user_id: "user-1",
                team_id: "team-1",
                server_timestamp: "2026-01-02T00:00:01Z",
              },
            ],
          });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey,
          keyVersion: 5,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.exec(`
          UPDATE sync_cursor SET cursor = 12 WHERE id = 1;
          INSERT INTO accounts (
            id, name, account_type, "group", currency, is_default, is_active,
            is_archived, tracking_mode
          )
          VALUES ('missing-dependency-account', 'Missing Dependency Account', 'CASH', NULL, 'USD', 0, 1, 0, 'HOLDINGS');
        `);
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const triggerResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/trigger-cycle`, {
        method: "POST",
      });
      expect(triggerResponse.status).toBe(200);
      await expect(triggerResponse.json()).resolves.toMatchObject({
        status: "pull_error",
        pulledCount: 0,
        cursor: 12,
      });

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<{ cursor: number }, []>("SELECT cursor FROM sync_cursor WHERE id = 1")
            .get(),
        ).toEqual({ cursor: 12 });
        expect(
          verifyDb
            .query<
              { count: number },
              []
            >("SELECT COUNT(*) AS count FROM sync_applied_events WHERE event_id = '79797979-7979-4797-8797-797979797979'")
            .get(),
        ).toEqual({ count: 0 });
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect trigger-cycle route to import-run replay", async () => {
    const appDataDir = mkdtempSync(
      path.join(tmpdir(), "wealthfolio-runtime-trigger-import-run-replay-"),
    );
    const rootKey = Buffer.alloc(32, 21).toString("base64");
    const crypto = createSyncCryptoService();
    const dek = (await crypto.deriveDek(rootKey, 5)).value;
    const encryptedPayload = (
      await crypto.encrypt(
        dek,
        JSON.stringify({
          id: "run-replay",
          accountId: "run-account",
          sourceSystem: "csv",
          runType: "IMPORT",
          mode: "INCREMENTAL",
          status: "APPLIED",
          startedAt: "2026-03-01T00:00:00+00:00",
          finishedAt: "2026-03-01T00:01:00+00:00",
          reviewMode: "NEVER",
          appliedAt: "2026-03-01T00:01:00+00:00",
          checkpointIn: null,
          checkpointOut: null,
          summary: null,
          warnings: null,
          error: null,
          createdAt: "2026-03-01T00:00:00+00:00",
          updatedAt: "2026-03-01T00:01:00+00:00",
        }),
      )
    ).value;
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
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "PULL_TAIL", cursor: 33 });
        }
        if (url.endsWith("/api/v1/sync/events/pull?since=12&limit=500")) {
          return Response.json({
            from: 12,
            to: 33,
            next_cursor: 33,
            has_more: false,
            events: [
              {
                event_id: "68686868-6868-4686-8686-686868686868",
                device_id: "other-device",
                type: "import_run.create.v1",
                entity: "import_run",
                entity_id: "run-replay",
                client_timestamp: "2026-03-01T00:01:00Z",
                payload: encryptedPayload,
                payload_key_version: 5,
                seq: 33,
                user_id: "user-1",
                team_id: "team-1",
                server_timestamp: "2026-03-01T00:01:01Z",
              },
            ],
          });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey,
          keyVersion: 5,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.exec(`
          UPDATE sync_cursor SET cursor = 12 WHERE id = 1;
          INSERT INTO accounts (
            id, name, account_type, "group", currency, is_default, is_active,
            is_archived, tracking_mode
          )
          VALUES ('run-account', 'Run Account', 'CASH', NULL, 'USD', 0, 1, 0, 'HOLDINGS');
        `);
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const triggerResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/trigger-cycle`, {
        method: "POST",
      });
      expect(triggerResponse.status).toBe(200);
      await expect(triggerResponse.json()).resolves.toMatchObject({
        status: "ok",
        pulledCount: 1,
        cursor: 33,
      });

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              {
                account_id: string;
                source_system: string;
                run_type: string;
                status: string;
                review_mode: string;
              },
              []
            >(
              `
                SELECT account_id, source_system, run_type, status, review_mode
                FROM import_runs
                WHERE id = 'run-replay'
              `,
            )
            .get(),
        ).toEqual({
          account_id: "run-account",
          source_system: "csv",
          run_type: "IMPORT",
          status: "APPLIED",
          review_mode: "NEVER",
        });
        expect(
          verifyDb
            .query<{ last_event_id: string; last_op: string; last_seq: number }, []>(
              `
                SELECT last_event_id, last_op, last_seq
                FROM sync_entity_metadata
                WHERE entity = 'import_run'
                  AND entity_id = 'run-replay'
              `,
            )
            .get(),
        ).toEqual({
          last_event_id: "68686868-6868-4686-8686-686868686868",
          last_op: "create",
          last_seq: 33,
        });
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect trigger-cycle route to AI thread replay", async () => {
    const appDataDir = mkdtempSync(
      path.join(tmpdir(), "wealthfolio-runtime-trigger-ai-thread-replay-"),
    );
    const rootKey = Buffer.alloc(32, 23).toString("base64");
    const crypto = createSyncCryptoService();
    const dek = (await crypto.deriveDek(rootKey, 5)).value;
    const configSnapshot = JSON.stringify({ providerId: "openai", modelId: "gpt-4o" });
    const encryptedPayload = (
      await crypto.encrypt(
        dek,
        JSON.stringify({
          id: "thread-replay",
          title: "Remote Thread",
          configSnapshot,
          isPinned: 1,
          createdAt: "2026-01-01T00:00:00+00:00",
          updatedAt: "2026-01-02T00:00:00+00:00",
        }),
      )
    ).value;
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
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "PULL_TAIL", cursor: 35 });
        }
        if (url.endsWith("/api/v1/sync/events/pull?since=12&limit=500")) {
          return Response.json({
            from: 12,
            to: 35,
            next_cursor: 35,
            has_more: false,
            events: [
              {
                event_id: "8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a",
                device_id: "other-device",
                type: "ai_thread.create.v1",
                entity: "ai_thread",
                entity_id: "thread-replay",
                client_timestamp: "2026-01-02T00:00:00Z",
                payload: encryptedPayload,
                payload_key_version: 5,
                seq: 35,
                user_id: "user-1",
                team_id: "team-1",
                server_timestamp: "2026-01-02T00:00:01Z",
              },
            ],
          });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey,
          keyVersion: 5,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.prepare("UPDATE sync_cursor SET cursor = 12 WHERE id = 1").run();
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const triggerResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/trigger-cycle`, {
        method: "POST",
      });
      expect(triggerResponse.status).toBe(200);
      await expect(triggerResponse.json()).resolves.toMatchObject({
        status: "ok",
        pulledCount: 1,
        cursor: 35,
      });

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              {
                title: string | null;
                config_snapshot: string | null;
                is_pinned: number;
              },
              []
            >(
              `
                SELECT title, config_snapshot, is_pinned
                FROM ai_threads
                WHERE id = 'thread-replay'
              `,
            )
            .get(),
        ).toEqual({
          title: "Remote Thread",
          config_snapshot: configSnapshot,
          is_pinned: 1,
        });
        expect(
          verifyDb
            .query<{ last_event_id: string; last_op: string; last_seq: number }, []>(
              `
                SELECT last_event_id, last_op, last_seq
                FROM sync_entity_metadata
                WHERE entity = 'ai_thread'
                  AND entity_id = 'thread-replay'
              `,
            )
            .get(),
        ).toEqual({
          last_event_id: "8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a",
          last_op: "create",
          last_seq: 35,
        });
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect trigger-cycle route to AI message replay", async () => {
    const appDataDir = mkdtempSync(
      path.join(tmpdir(), "wealthfolio-runtime-trigger-ai-message-replay-"),
    );
    const rootKey = Buffer.alloc(32, 24).toString("base64");
    const crypto = createSyncCryptoService();
    const dek = (await crypto.deriveDek(rootKey, 5)).value;
    const contentJson = JSON.stringify({
      schemaVersion: 1,
      parts: [{ type: "text", text: "Remote message" }],
    });
    const encryptedPayload = (
      await crypto.encrypt(
        dek,
        JSON.stringify({
          id: "message-replay",
          threadId: "message-thread",
          role: "user",
          contentJson,
          createdAt: "2026-01-02T00:00:00+00:00",
        }),
      )
    ).value;
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
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "PULL_TAIL", cursor: 36 });
        }
        if (url.endsWith("/api/v1/sync/events/pull?since=12&limit=500")) {
          return Response.json({
            from: 12,
            to: 36,
            next_cursor: 36,
            has_more: false,
            events: [
              {
                event_id: "9b9b9b9b-9b9b-4b9b-9b9b-9b9b9b9b9b9b",
                device_id: "other-device",
                type: "ai_message.create.v1",
                entity: "ai_message",
                entity_id: "message-replay",
                client_timestamp: "2026-01-02T00:00:00Z",
                payload: encryptedPayload,
                payload_key_version: 5,
                seq: 36,
                user_id: "user-1",
                team_id: "team-1",
                server_timestamp: "2026-01-02T00:00:01Z",
              },
            ],
          });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey,
          keyVersion: 5,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.exec(`
          UPDATE sync_cursor SET cursor = 12 WHERE id = 1;
          INSERT INTO ai_threads (id, title, config_snapshot, is_pinned, created_at, updated_at)
          VALUES (
            'message-thread', 'Parent Thread', NULL, 0,
            '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00+00:00'
          );
        `);
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const triggerResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/trigger-cycle`, {
        method: "POST",
      });
      expect(triggerResponse.status).toBe(200);
      await expect(triggerResponse.json()).resolves.toMatchObject({
        status: "ok",
        pulledCount: 1,
        cursor: 36,
      });

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              {
                thread_id: string;
                role: string;
                content_json: string;
              },
              []
            >(
              `
                SELECT thread_id, role, content_json
                FROM ai_messages
                WHERE id = 'message-replay'
              `,
            )
            .get(),
        ).toEqual({
          thread_id: "message-thread",
          role: "user",
          content_json: contentJson,
        });
        expect(
          verifyDb
            .query<{ last_event_id: string; last_op: string; last_seq: number }, []>(
              `
                SELECT last_event_id, last_op, last_seq
                FROM sync_entity_metadata
                WHERE entity = 'ai_message'
                  AND entity_id = 'message-replay'
              `,
            )
            .get(),
        ).toEqual({
          last_event_id: "9b9b9b9b-9b9b-4b9b-9b9b-9b9b9b9b9b9b",
          last_op: "create",
          last_seq: 36,
        });
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("skips stale AI child replay after parent thread tombstone", async () => {
    const appDataDir = mkdtempSync(
      path.join(tmpdir(), "wealthfolio-runtime-trigger-ai-child-tombstone-"),
    );
    const rootKey = Buffer.alloc(32, 26).toString("base64");
    const crypto = createSyncCryptoService();
    const dek = (await crypto.deriveDek(rootKey, 5)).value;
    const encryptedPayload = (
      await crypto.encrypt(
        dek,
        JSON.stringify({
          id: "deleted-thread-message",
          threadId: "deleted-thread",
          role: "user",
          contentJson: JSON.stringify({
            schemaVersion: 1,
            parts: [{ type: "text", text: "stale" }],
          }),
          createdAt: "2026-01-02T00:00:00+00:00",
        }),
      )
    ).value;
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
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "PULL_TAIL", cursor: 38 });
        }
        if (url.endsWith("/api/v1/sync/events/pull?since=12&limit=500")) {
          return Response.json({
            from: 12,
            to: 38,
            next_cursor: 38,
            has_more: false,
            events: [
              {
                event_id: "bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbcbc",
                device_id: "other-device",
                type: "ai_message.create.v1",
                entity: "ai_message",
                entity_id: "deleted-thread-message",
                client_timestamp: "2026-01-02T00:00:00Z",
                payload: encryptedPayload,
                payload_key_version: 5,
                seq: 38,
                user_id: "user-1",
                team_id: "team-1",
                server_timestamp: "2026-01-02T00:00:01Z",
              },
            ],
          });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey,
          keyVersion: 5,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.exec(`
          UPDATE sync_cursor SET cursor = 12 WHERE id = 1;
          INSERT INTO sync_entity_metadata (
            entity, entity_id, last_event_id, last_client_timestamp, last_op, last_seq
          )
          VALUES (
            'ai_thread', 'deleted-thread', 'thread-delete-event',
            '2026-01-03T00:00:00Z', 'delete', 37
          );
        `);
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const triggerResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/trigger-cycle`, {
        method: "POST",
      });
      expect(triggerResponse.status).toBe(200);
      await expect(triggerResponse.json()).resolves.toMatchObject({
        status: "ok",
        pulledCount: 0,
        cursor: 38,
      });

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              { count: number },
              []
            >("SELECT COUNT(*) AS count FROM ai_messages WHERE id = 'deleted-thread-message'")
            .get(),
        ).toEqual({ count: 0 });
        expect(
          verifyDb
            .query<
              { count: number },
              []
            >("SELECT COUNT(*) AS count FROM sync_applied_events WHERE event_id = 'bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbcbc'")
            .get(),
        ).toEqual({ count: 1 });
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect trigger-cycle route to AI thread-tag replay", async () => {
    const appDataDir = mkdtempSync(
      path.join(tmpdir(), "wealthfolio-runtime-trigger-ai-tag-replay-"),
    );
    const rootKey = Buffer.alloc(32, 25).toString("base64");
    const crypto = createSyncCryptoService();
    const dek = (await crypto.deriveDek(rootKey, 5)).value;
    const encryptedPayload = (
      await crypto.encrypt(
        dek,
        JSON.stringify({
          id: "tag-replay",
          threadId: "tag-thread",
          tag: "planning",
          createdAt: "2026-01-02T00:00:00+00:00",
        }),
      )
    ).value;
    const encryptedOwnPayload = (
      await crypto.encrypt(
        dek,
        JSON.stringify({
          id: "local-tag-same-value",
          threadId: "tag-thread",
          tag: "planning",
          createdAt: "2026-01-01T00:00:00+00:00",
        }),
      )
    ).value;
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
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "PULL_TAIL", cursor: 37 });
        }
        if (url.endsWith("/api/v1/sync/events/pull?since=12&limit=500")) {
          return Response.json({
            from: 12,
            to: 37,
            next_cursor: 37,
            has_more: false,
            events: [
              {
                event_id: "abababab-abab-4aba-8bab-abababababab",
                device_id: "other-device",
                type: "ai_thread_tag.create.v1",
                entity: "ai_thread_tag",
                entity_id: "tag-replay",
                client_timestamp: "2026-01-02T00:00:00Z",
                payload: encryptedPayload,
                payload_key_version: 5,
                seq: 37,
                user_id: "user-1",
                team_id: "team-1",
                server_timestamp: "2026-01-02T00:00:01Z",
              },
              {
                event_id: "acacacac-acac-4aca-8cac-acacacacacac",
                device_id: "device-runtime",
                type: "ai_thread_tag.create.v1",
                entity: "ai_thread_tag",
                entity_id: "local-tag-same-value",
                client_timestamp: "2026-01-01T00:00:00Z",
                payload: encryptedOwnPayload,
                payload_key_version: 5,
                seq: 36,
                user_id: "user-1",
                team_id: "team-1",
                server_timestamp: "2026-01-01T00:00:01Z",
              },
            ],
          });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey,
          keyVersion: 5,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.exec(`
          UPDATE sync_cursor SET cursor = 12 WHERE id = 1;
          INSERT INTO ai_threads (id, title, config_snapshot, is_pinned, created_at, updated_at)
          VALUES (
            'tag-thread', 'Tagged Thread', NULL, 0,
            '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00+00:00'
          );
          INSERT INTO ai_thread_tags (id, thread_id, tag, created_at)
          VALUES ('local-tag-same-value', 'tag-thread', 'planning', '2026-01-01T00:00:00+00:00');
        `);
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const triggerResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/trigger-cycle`, {
        method: "POST",
      });
      expect(triggerResponse.status).toBe(200);
      await expect(triggerResponse.json()).resolves.toMatchObject({
        status: "ok",
        pulledCount: 2,
        cursor: 37,
      });

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              {
                thread_id: string;
                tag: string;
                created_at: string;
              },
              []
            >(
              `
                SELECT thread_id, tag, created_at
                FROM ai_thread_tags
                WHERE id = 'tag-replay'
              `,
            )
            .get(),
        ).toEqual({
          thread_id: "tag-thread",
          tag: "planning",
          created_at: "2026-01-02T00:00:00+00:00",
        });
        expect(
          verifyDb
            .query<
              { count: number },
              []
            >("SELECT COUNT(*) AS count FROM ai_thread_tags WHERE thread_id = 'tag-thread' AND tag = 'planning'")
            .get(),
        ).toEqual({ count: 1 });
        expect(
          verifyDb
            .query<{ last_event_id: string; last_op: string; last_seq: number }, []>(
              `
                SELECT last_event_id, last_op, last_seq
                FROM sync_entity_metadata
                WHERE entity = 'ai_thread_tag'
                  AND entity_id = 'tag-replay'
              `,
            )
            .get(),
        ).toEqual({
          last_event_id: "abababab-abab-4aba-8bab-abababababab",
          last_op: "create",
          last_seq: 37,
        });
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect trigger-cycle route to custom taxonomy replay", async () => {
    const appDataDir = mkdtempSync(
      path.join(tmpdir(), "wealthfolio-runtime-trigger-custom-taxonomy-replay-"),
    );
    const rootKey = Buffer.alloc(32, 31).toString("base64");
    const crypto = createSyncCryptoService();
    const dek = (await crypto.deriveDek(rootKey, 5)).value;
    const encryptedUpdatePayload = (
      await crypto.encrypt(
        dek,
        JSON.stringify({
          taxonomy: {
            id: "custom-taxonomy-replay",
            name: "Remote Taxonomy",
            color: "#654321",
            description: "Synced taxonomy",
            is_system: 0,
            is_single_select: 1,
            sort_order: 12,
            created_at: "2026-01-01T00:00:00",
            updated_at: "2026-01-02T00:00:00",
          },
          categories: [
            {
              id: "remote-category-existing",
              taxonomy_id: "custom-taxonomy-replay",
              parent_id: null,
              name: "Updated Category",
              key: "updated_category",
              color: "#111111",
              description: null,
              sort_order: 1,
              created_at: "2026-01-01T00:00:00",
              updated_at: "2026-01-02T00:00:00",
            },
            {
              id: "remote-category-new",
              taxonomy_id: "custom-taxonomy-replay",
              parent_id: "remote-category-existing",
              name: "New Child",
              key: "new_child",
              color: "#222222",
              description: "Child category",
              sort_order: 2,
              created_at: "2026-01-02T00:00:00",
              updated_at: "2026-01-02T00:00:00",
            },
          ],
        }),
      )
    ).value;
    const encryptedDeletePayload = (
      await crypto.encrypt(dek, JSON.stringify({ id: "custom-taxonomy-delete" }))
    ).value;
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
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "PULL_TAIL", cursor: 43 });
        }
        if (url.endsWith("/api/v1/sync/events/pull?since=12&limit=500")) {
          return Response.json({
            from: 12,
            to: 43,
            next_cursor: 43,
            has_more: false,
            events: [
              {
                event_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                device_id: "other-device",
                type: "custom_taxonomy.update.v1",
                entity: "custom_taxonomy",
                entity_id: "custom-taxonomy-replay",
                client_timestamp: "2026-01-02T00:00:00Z",
                payload: encryptedUpdatePayload,
                payload_key_version: 5,
                seq: 42,
                user_id: "user-1",
                team_id: "team-1",
                server_timestamp: "2026-01-02T00:00:01Z",
              },
              {
                event_id: "dededede-dede-4ded-8ede-dededededede",
                device_id: "other-device",
                type: "custom_taxonomy.delete.v1",
                entity: "custom_taxonomy",
                entity_id: "custom-taxonomy-delete",
                client_timestamp: "2026-01-02T00:00:01Z",
                payload: encryptedDeletePayload,
                payload_key_version: 5,
                seq: 43,
                user_id: "user-1",
                team_id: "team-1",
                server_timestamp: "2026-01-02T00:00:02Z",
              },
            ],
          });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey,
          keyVersion: 5,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.exec(`
          UPDATE sync_cursor SET cursor = 12 WHERE id = 1;
          INSERT INTO taxonomies (
            id, name, color, description, is_system, is_single_select, sort_order, created_at, updated_at
          )
          VALUES
            (
              'custom-taxonomy-replay', 'Local Taxonomy', '#000000', NULL,
              0, 0, 1, '2026-01-01T00:00:00', '2026-01-01T00:00:00'
            ),
            (
              'custom-taxonomy-delete', 'Delete Taxonomy', '#000000', NULL,
              0, 0, 2, '2026-01-01T00:00:00', '2026-01-01T00:00:00'
            );
          INSERT INTO taxonomy_categories (
            id, taxonomy_id, parent_id, name, key, color, description, sort_order, created_at, updated_at
          )
          VALUES
            (
              'remote-category-existing', 'custom-taxonomy-replay', NULL, 'Old Category',
              'old_category', '#000000', NULL, 1, '2026-01-01T00:00:00', '2026-01-01T00:00:00'
            ),
            (
              'stale-category', 'custom-taxonomy-replay', NULL, 'Stale Category',
              'stale_category', '#000000', NULL, 99, '2026-01-01T00:00:00', '2026-01-01T00:00:00'
            ),
            (
              'delete-category', 'custom-taxonomy-delete', NULL, 'Delete Category',
              'delete_category', '#000000', NULL, 1, '2026-01-01T00:00:00', '2026-01-01T00:00:00'
            );
        `);
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const triggerResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/trigger-cycle`, {
        method: "POST",
      });
      expect(triggerResponse.status).toBe(200);
      await expect(triggerResponse.json()).resolves.toMatchObject({
        status: "ok",
        pulledCount: 2,
        cursor: 43,
      });

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              {
                name: string;
                color: string;
                description: string | null;
                is_single_select: number;
                sort_order: number;
              },
              []
            >(
              `
                SELECT name, color, description, is_single_select, sort_order
                FROM taxonomies
                WHERE id = 'custom-taxonomy-replay'
              `,
            )
            .get(),
        ).toEqual({
          name: "Remote Taxonomy",
          color: "#654321",
          description: "Synced taxonomy",
          is_single_select: 1,
          sort_order: 12,
        });
        expect(
          verifyDb
            .query<{ id: string; name: string; parent_id: string | null; sort_order: number }, []>(
              `
                SELECT id, name, parent_id, sort_order
                FROM taxonomy_categories
                WHERE taxonomy_id = 'custom-taxonomy-replay'
                ORDER BY sort_order ASC
              `,
            )
            .all(),
        ).toEqual([
          {
            id: "remote-category-existing",
            name: "Updated Category",
            parent_id: null,
            sort_order: 1,
          },
          {
            id: "remote-category-new",
            name: "New Child",
            parent_id: "remote-category-existing",
            sort_order: 2,
          },
        ]);
        expect(
          verifyDb
            .query<{ taxonomy_count: number; category_count: number }, []>(
              `
                SELECT
                  (SELECT COUNT(*) FROM taxonomies WHERE id = 'custom-taxonomy-delete') AS taxonomy_count,
                  (SELECT COUNT(*) FROM taxonomy_categories WHERE taxonomy_id = 'custom-taxonomy-delete') AS category_count
              `,
            )
            .get(),
        ).toEqual({ taxonomy_count: 0, category_count: 0 });
        expect(
          verifyDb
            .query<{ last_event_id: string; last_op: string; last_seq: number }, []>(
              `
                SELECT last_event_id, last_op, last_seq
                FROM sync_entity_metadata
                WHERE entity = 'custom_taxonomy'
                  AND entity_id = 'custom-taxonomy-replay'
              `,
            )
            .get(),
        ).toEqual({
          last_event_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          last_op: "update",
          last_seq: 42,
        });
        expect(
          verifyDb
            .query<{ last_event_id: string; last_op: string; last_seq: number }, []>(
              `
                SELECT last_event_id, last_op, last_seq
                FROM sync_entity_metadata
                WHERE entity = 'custom_taxonomy'
                  AND entity_id = 'custom-taxonomy-delete'
              `,
            )
            .get(),
        ).toEqual({
          last_event_id: "dededede-dede-4ded-8ede-dededededede",
          last_op: "delete",
          last_seq: 43,
        });
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect trigger-cycle route to asset taxonomy assignment replay", async () => {
    const appDataDir = mkdtempSync(
      path.join(tmpdir(), "wealthfolio-runtime-trigger-taxonomy-assignment-replay-"),
    );
    const rootKey = Buffer.alloc(32, 27).toString("base64");
    const crypto = createSyncCryptoService();
    const dek = (await crypto.deriveDek(rootKey, 5)).value;
    const encryptedPayload = (
      await crypto.encrypt(
        dek,
        JSON.stringify({
          id: "remote-assignment",
          assetId: "assignment-asset",
          taxonomyId: "custom_groups",
          categoryId: "replay-category",
          weight: 7500,
          source: "manual",
          createdAt: "2026-01-02T00:00:00+00:00",
          updatedAt: "2026-01-02T00:00:00+00:00",
        }),
      )
    ).value;
    const encryptedStalePayload = (
      await crypto.encrypt(
        dek,
        JSON.stringify({
          id: "local-assignment",
          assetId: "assignment-asset",
          taxonomyId: "custom_groups",
          categoryId: "replay-category",
          weight: 2500,
          source: "manual",
          updatedAt: "2026-01-01T00:00:00+00:00",
        }),
      )
    ).value;
    const encryptedHighIdStalePayload = (
      await crypto.encrypt(
        dek,
        JSON.stringify({
          id: "zzz-assignment",
          assetId: "assignment-asset",
          taxonomyId: "custom_groups",
          categoryId: "replay-category",
          weight: 1250,
          source: "manual",
          updatedAt: "2026-01-01T00:00:00+00:00",
        }),
      )
    ).value;
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
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "PULL_TAIL", cursor: 41 });
        }
        if (url.endsWith("/api/v1/sync/events/pull?since=12&limit=500")) {
          return Response.json({
            from: 12,
            to: 41,
            next_cursor: 41,
            has_more: false,
            events: [
              {
                event_id: "cdcdcdcd-cdcd-4cdc-8dcd-cdcdcdcdcdcd",
                device_id: "other-device",
                type: "asset_taxonomy_assignment.update.v1",
                entity: "asset_taxonomy_assignment",
                entity_id: "remote-assignment",
                client_timestamp: "2026-01-02T00:00:00Z",
                payload: encryptedPayload,
                payload_key_version: 5,
                seq: 39,
                user_id: "user-1",
                team_id: "team-1",
                server_timestamp: "2026-01-02T00:00:01Z",
              },
              {
                event_id: "cececece-cece-4cec-8ece-cececececece",
                device_id: "other-device",
                type: "asset_taxonomy_assignment.update.v1",
                entity: "asset_taxonomy_assignment",
                entity_id: "local-assignment",
                client_timestamp: "2026-01-01T00:00:00Z",
                payload: encryptedStalePayload,
                payload_key_version: 5,
                seq: 40,
                user_id: "user-1",
                team_id: "team-1",
                server_timestamp: "2026-01-02T00:00:02Z",
              },
              {
                event_id: "cfcfcfcf-cfcf-4cfc-8fcf-cfcfcfcfcfcf",
                device_id: "other-device",
                type: "asset_taxonomy_assignment.update.v1",
                entity: "asset_taxonomy_assignment",
                entity_id: "zzz-assignment",
                client_timestamp: "2026-01-01T00:00:00Z",
                payload: encryptedHighIdStalePayload,
                payload_key_version: 5,
                seq: 41,
                user_id: "user-1",
                team_id: "team-1",
                server_timestamp: "2026-01-02T00:00:03Z",
              },
            ],
          });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey,
          keyVersion: 5,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.exec("UPDATE sync_cursor SET cursor = 12 WHERE id = 1;");
        seedRuntimeAsset(seedDb, "assignment-asset");
        seedDb.exec(`
          INSERT OR IGNORE INTO taxonomy_categories (
            id, taxonomy_id, parent_id, name, key, color, description, sort_order, created_at, updated_at
          )
          VALUES (
            'replay-category', 'custom_groups', NULL, 'Replay Category',
            'replay_category', '#123456', NULL, 0,
            '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00+00:00'
          );
          INSERT INTO asset_taxonomy_assignments (
            id, asset_id, taxonomy_id, category_id, weight, source, created_at, updated_at
          )
          VALUES (
            'local-assignment', 'assignment-asset', 'custom_groups', 'replay-category',
            5000, 'manual', '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00+00:00'
          );
        `);
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const triggerResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/trigger-cycle`, {
        method: "POST",
      });
      expect(triggerResponse.status).toBe(200);
      await expect(triggerResponse.json()).resolves.toMatchObject({
        status: "ok",
        pulledCount: 1,
        cursor: 41,
      });

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              {
                id: string;
                weight: number;
                created_at: string;
              },
              []
            >(
              `
                SELECT id, weight, created_at
                FROM asset_taxonomy_assignments
                WHERE asset_id = 'assignment-asset'
                  AND taxonomy_id = 'custom_groups'
                  AND category_id = 'replay-category'
              `,
            )
            .get(),
        ).toEqual({
          id: "remote-assignment",
          weight: 7500,
          created_at: "2026-01-02T00:00:00+00:00",
        });
        expect(
          verifyDb
            .query<{ count: number }, []>(
              `
                SELECT COUNT(*) AS count
                FROM asset_taxonomy_assignments
                WHERE asset_id = 'assignment-asset'
                  AND taxonomy_id = 'custom_groups'
                  AND category_id = 'replay-category'
              `,
            )
            .get(),
        ).toEqual({ count: 1 });
        expect(
          verifyDb
            .query<{ last_event_id: string; last_op: string; last_seq: number }, []>(
              `
                SELECT last_event_id, last_op, last_seq
                FROM sync_entity_metadata
                WHERE entity = 'asset_taxonomy_assignment'
                  AND entity_id = 'remote-assignment'
              `,
            )
            .get(),
        ).toEqual({
          last_event_id: "cdcdcdcd-cdcd-4cdc-8dcd-cdcdcdcdcdcd",
          last_op: "update",
          last_seq: 39,
        });
        expect(
          verifyDb
            .query<
              { count: number },
              []
            >("SELECT COUNT(*) AS count FROM sync_applied_events WHERE event_id = 'cececece-cece-4cec-8ece-cececececece'")
            .get(),
        ).toEqual({ count: 1 });
        expect(
          verifyDb
            .query<
              { count: number },
              []
            >("SELECT COUNT(*) AS count FROM sync_applied_events WHERE event_id = 'cfcfcfcf-cfcf-4cfc-8fcf-cfcfcfcfcfcf'")
            .get(),
        ).toEqual({ count: 1 });
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("deletes canonical asset taxonomy assignment by natural-key replay payload", async () => {
    const appDataDir = mkdtempSync(
      path.join(tmpdir(), "wealthfolio-runtime-trigger-taxonomy-assignment-delete-replay-"),
    );
    const rootKey = Buffer.alloc(32, 30).toString("base64");
    const crypto = createSyncCryptoService();
    const dek = (await crypto.deriveDek(rootKey, 5)).value;
    const encryptedPayload = (
      await crypto.encrypt(
        dek,
        JSON.stringify({
          id: "local-delete-assignment",
          assetId: "assignment-delete-asset",
          taxonomyId: "custom_groups",
          categoryId: "delete-replay-category",
          weight: 5000,
          source: "manual",
          createdAt: "2026-01-01T00:00:00+00:00",
          updatedAt: "2026-01-01T00:00:00+00:00",
        }),
      )
    ).value;
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
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "PULL_TAIL", cursor: 42 });
        }
        if (url.endsWith("/api/v1/sync/events/pull?since=12&limit=500")) {
          return Response.json({
            from: 12,
            to: 42,
            next_cursor: 42,
            has_more: false,
            events: [
              {
                event_id: "dfdfdfdf-dfdf-4dfd-8fdf-dfdfdfdfdfdf",
                device_id: "other-device",
                type: "asset_taxonomy_assignment.delete.v1",
                entity: "asset_taxonomy_assignment",
                entity_id: "local-delete-assignment",
                client_timestamp: "2026-01-02T00:00:00Z",
                payload: encryptedPayload,
                payload_key_version: 5,
                seq: 42,
                user_id: "user-1",
                team_id: "team-1",
                server_timestamp: "2026-01-02T00:00:01Z",
              },
            ],
          });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey,
          keyVersion: 5,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.exec("UPDATE sync_cursor SET cursor = 12 WHERE id = 1;");
        seedRuntimeAsset(seedDb, "assignment-delete-asset");
        seedDb.exec(`
          INSERT OR IGNORE INTO taxonomy_categories (
            id, taxonomy_id, parent_id, name, key, color, description, sort_order, created_at, updated_at
          )
          VALUES (
            'delete-replay-category', 'custom_groups', NULL, 'Delete Replay Category',
            'delete_replay_category', '#654321', NULL, 0,
            '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00+00:00'
          );
          INSERT INTO asset_taxonomy_assignments (
            id, asset_id, taxonomy_id, category_id, weight, source, created_at, updated_at
          )
          VALUES (
            'remote-delete-assignment', 'assignment-delete-asset', 'custom_groups', 'delete-replay-category',
            5000, 'manual', '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00+00:00'
          );
          INSERT INTO sync_entity_metadata (
            entity, entity_id, last_event_id, last_client_timestamp, last_op, last_seq
          )
          VALUES (
            'asset_taxonomy_assignment', 'remote-delete-assignment', 'remote-create-event',
            '2026-01-01T00:00:00Z', 'update', 41
          );
        `);
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const triggerResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/trigger-cycle`, {
        method: "POST",
      });
      expect(triggerResponse.status).toBe(200);
      await expect(triggerResponse.json()).resolves.toMatchObject({
        status: "ok",
        pulledCount: 1,
        cursor: 42,
      });

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              { count: number },
              []
            >("SELECT COUNT(*) AS count FROM asset_taxonomy_assignments WHERE id = 'remote-delete-assignment'")
            .get(),
        ).toEqual({ count: 0 });
        expect(
          verifyDb
            .query<{ last_op: string; last_seq: number }, []>(
              `
                SELECT last_op, last_seq
                FROM sync_entity_metadata
                WHERE entity = 'asset_taxonomy_assignment'
                  AND entity_id = 'remote-delete-assignment'
              `,
            )
            .get(),
        ).toEqual({ last_op: "delete", last_seq: 42 });
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect trigger-cycle route to quote replay", async () => {
    const appDataDir = mkdtempSync(
      path.join(tmpdir(), "wealthfolio-runtime-trigger-quote-replay-"),
    );
    const rootKey = Buffer.alloc(32, 28).toString("base64");
    const crypto = createSyncCryptoService();
    const dek = (await crypto.deriveDek(rootKey, 5)).value;
    const encryptedPayload = (
      await crypto.encrypt(
        dek,
        JSON.stringify({
          id: "a1b2c3d4-e5f6-47a8-9b0c-d1e2f3a4b5c6",
          assetId: "quote-replay-asset",
          day: "2026-01-02",
          source: "MANUAL",
          open: null,
          high: null,
          low: null,
          close: "123.45",
          adjclose: null,
          volume: null,
          currency: "USD",
          notes: "remote manual quote",
          createdAt: "2026-01-02T00:00:00+00:00",
          timestamp: "2026-01-02T12:00:00+00:00",
        }),
      )
    ).value;
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
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "PULL_TAIL", cursor: 40 });
        }
        if (url.endsWith("/api/v1/sync/events/pull?since=12&limit=500")) {
          return Response.json({
            from: 12,
            to: 40,
            next_cursor: 40,
            has_more: false,
            events: [
              {
                event_id: "dededede-dede-4ded-8ede-dededededede",
                device_id: "other-device",
                type: "quote.create.v1",
                entity: "quote",
                entity_id: "a1b2c3d4-e5f6-47a8-9b0c-d1e2f3a4b5c6",
                client_timestamp: "2026-01-02T00:00:00Z",
                payload: encryptedPayload,
                payload_key_version: 5,
                seq: 40,
                user_id: "user-1",
                team_id: "team-1",
                server_timestamp: "2026-01-02T00:00:01Z",
              },
            ],
          });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey,
          keyVersion: 5,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.prepare("UPDATE sync_cursor SET cursor = 12 WHERE id = 1").run();
        seedRuntimeAsset(seedDb, "quote-replay-asset");
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const triggerResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/trigger-cycle`, {
        method: "POST",
      });
      expect(triggerResponse.status).toBe(200);
      await expect(triggerResponse.json()).resolves.toMatchObject({
        status: "ok",
        pulledCount: 1,
        cursor: 40,
      });

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              {
                asset_id: string;
                day: string;
                source: string;
                close: string;
                currency: string;
                notes: string | null;
              },
              []
            >(
              `
                SELECT asset_id, day, source, close, currency, notes
                FROM quotes
                WHERE id = 'a1b2c3d4-e5f6-47a8-9b0c-d1e2f3a4b5c6'
              `,
            )
            .get(),
        ).toEqual({
          asset_id: "quote-replay-asset",
          day: "2026-01-02",
          source: "MANUAL",
          close: "123.45",
          currency: "USD",
          notes: "remote manual quote",
        });
        expect(
          verifyDb
            .query<{ last_event_id: string; last_op: string; last_seq: number }, []>(
              `
                SELECT last_event_id, last_op, last_seq
                FROM sync_entity_metadata
                WHERE entity = 'quote'
                  AND entity_id = 'a1b2c3d4-e5f6-47a8-9b0c-d1e2f3a4b5c6'
              `,
            )
            .get(),
        ).toEqual({
          last_event_id: "dededede-dede-4ded-8ede-dededededede",
          last_op: "create",
          last_seq: 40,
        });
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect trigger-cycle route to snapshot replay", async () => {
    const appDataDir = mkdtempSync(
      path.join(tmpdir(), "wealthfolio-runtime-trigger-snapshot-replay-"),
    );
    const rootKey = Buffer.alloc(32, 32).toString("base64");
    const crypto = createSyncCryptoService();
    const dek = (await crypto.deriveDek(rootKey, 5)).value;
    const snapshotId = "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2";
    const remotePositions = JSON.stringify({
      "snapshot-new-asset": {
        assetId: "snapshot-new-asset",
        quantity: "7",
        averageCost: "110",
        totalCostBasis: "770",
        currency: "USD",
        inceptionDate: "2026-01-01T00:00:00Z",
        contractMultiplier: "1",
        createdAt: "2026-01-02T00:00:00Z",
        lastUpdated: "2026-01-02T00:00:00Z",
      },
    });
    const encryptedPayload = (
      await crypto.encrypt(
        dek,
        JSON.stringify({
          id: snapshotId,
          accountId: "snapshot-account",
          snapshotDate: "2026-01-01",
          currency: "USD",
          positions: remotePositions,
          cashBalances: "{}",
          costBasis: "770",
          netContribution: "700",
          calculatedAt: "2026-02-01T00:00:00Z",
          netContributionBase: "700",
          cashTotalAccountCurrency: "0",
          cashTotalBaseCurrency: "0",
          source: "MANUAL_ENTRY",
        }),
      )
    ).value;
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
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "PULL_TAIL", cursor: 44 });
        }
        if (url.endsWith("/api/v1/sync/events/pull?since=12&limit=500")) {
          return Response.json({
            from: 12,
            to: 44,
            next_cursor: 44,
            has_more: false,
            events: [
              {
                event_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                device_id: "other-device",
                type: "snapshot.update.v1",
                entity: "snapshot",
                entity_id: snapshotId,
                client_timestamp: "2026-02-01T00:00:00Z",
                payload: encryptedPayload,
                payload_key_version: 5,
                seq: 44,
                user_id: "user-1",
                team_id: "team-1",
                server_timestamp: "2026-02-01T00:00:01Z",
              },
            ],
          });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey,
          keyVersion: 5,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.exec(`
          UPDATE sync_cursor SET cursor = 12 WHERE id = 1;
          INSERT INTO accounts (
            id, name, account_type, "group", currency, is_default, is_active,
            is_archived, tracking_mode
          )
          VALUES ('snapshot-account', 'Snapshot Account', 'SECURITIES', NULL, 'USD', 0, 1, 0, 'HOLDINGS');
          INSERT INTO assets (
            id, kind, name, display_code, notes, metadata, is_active, quote_mode,
            quote_ccy, instrument_type, instrument_symbol, instrument_exchange_mic,
            provider_config, created_at, updated_at
          )
          VALUES
            ('snapshot-old-asset', 'INVESTMENT', 'Old Asset', 'OLD', NULL, NULL, 1, 'MANUAL',
              'USD', 'EQUITY', 'OLD', NULL, NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
            ('snapshot-new-asset', 'INVESTMENT', 'New Asset', 'NEW', NULL, NULL, 1, 'MANUAL',
              'USD', 'EQUITY', 'NEW', NULL, NULL, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
          INSERT INTO holdings_snapshots (
            id, account_id, snapshot_date, currency, positions, cash_balances,
            cost_basis, net_contribution, calculated_at, net_contribution_base,
            cash_total_account_currency, cash_total_base_currency, source
          )
          VALUES (
            '${snapshotId}', 'snapshot-account', '2026-01-01', 'USD', '{}', '{}',
            '0', '0', '2026-01-01T00:00:00Z', '0', '0', '0', 'MANUAL_ENTRY'
          );
          INSERT INTO snapshot_positions (
            snapshot_id, asset_id, quantity, average_cost, total_cost_basis, currency,
            inception_date, is_alternative, contract_multiplier, created_at, last_updated
          )
          VALUES (
            '${snapshotId}', 'snapshot-old-asset', '5', '100', '500', 'USD',
            '2026-01-01T00:00:00Z', 0, '1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
          );
        `);
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const triggerResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/trigger-cycle`, {
        method: "POST",
      });
      expect(triggerResponse.status).toBe(200);
      await expect(triggerResponse.json()).resolves.toMatchObject({
        status: "ok",
        pulledCount: 1,
        cursor: 44,
      });

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              {
                positions: string;
                cost_basis: string;
                net_contribution: string;
                calculated_at: string;
              },
              []
            >(
              `
                SELECT positions, cost_basis, net_contribution, calculated_at
                FROM holdings_snapshots
                WHERE id = ?
              `,
            )
            .get(snapshotId),
        ).toEqual({
          positions: remotePositions,
          cost_basis: "770",
          net_contribution: "700",
          calculated_at: "2026-02-01T00:00:00Z",
        });
        expect(
          verifyDb
            .query<
              { count: number },
              [string]
            >("SELECT COUNT(*) AS count FROM snapshot_positions WHERE snapshot_id = ?")
            .get(snapshotId),
        ).toEqual({ count: 0 });
        expect(
          verifyDb
            .query<{ last_event_id: string; last_op: string; last_seq: number }, [string]>(
              `
                SELECT last_event_id, last_op, last_seq
                FROM sync_entity_metadata
                WHERE entity = 'snapshot'
                  AND entity_id = ?
              `,
            )
            .get(snapshotId),
        ).toEqual({
          last_event_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          last_op: "update",
          last_seq: 44,
        });
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect trigger-cycle route to asset replay", async () => {
    const appDataDir = mkdtempSync(
      path.join(tmpdir(), "wealthfolio-runtime-trigger-asset-replay-"),
    );
    const rootKey = Buffer.alloc(32, 29).toString("base64");
    const crypto = createSyncCryptoService();
    const dek = (await crypto.deriveDek(rootKey, 5)).value;
    const encryptedPayload = (
      await crypto.encrypt(
        dek,
        JSON.stringify({
          id: "asset-replay",
          kind: "INVESTMENT",
          name: "Remote Asset",
          displayCode: "REMOTE",
          notes: "remote note",
          metadata: JSON.stringify({ sector: "Technology" }),
          isActive: 1,
          quoteMode: "MARKET",
          quoteCcy: "USD",
          instrumentType: "EQUITY",
          instrumentSymbol: "REMOTE",
          instrumentExchangeMic: "XNAS",
          instrumentKey: "EQUITY:REMOTE@XNAS",
          providerConfig: JSON.stringify({ preferred_provider: "YAHOO" }),
          createdAt: "2026-01-02T00:00:00+00:00",
          updatedAt: "2026-01-02T00:00:00+00:00",
        }),
      )
    ).value;
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
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "PULL_TAIL", cursor: 41 });
        }
        if (url.endsWith("/api/v1/sync/events/pull?since=12&limit=500")) {
          return Response.json({
            from: 12,
            to: 41,
            next_cursor: 41,
            has_more: false,
            events: [
              {
                event_id: "efefefef-efef-4efe-8fef-efefefefefef",
                device_id: "other-device",
                type: "asset.create.v1",
                entity: "asset",
                entity_id: "asset-replay",
                client_timestamp: "2026-01-02T00:00:00Z",
                payload: encryptedPayload,
                payload_key_version: 5,
                seq: 41,
                user_id: "user-1",
                team_id: "team-1",
                server_timestamp: "2026-01-02T00:00:01Z",
              },
            ],
          });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey,
          keyVersion: 5,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.prepare("UPDATE sync_cursor SET cursor = 12 WHERE id = 1").run();
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const triggerResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/trigger-cycle`, {
        method: "POST",
      });
      expect(triggerResponse.status).toBe(200);
      await expect(triggerResponse.json()).resolves.toMatchObject({
        status: "ok",
        pulledCount: 1,
        cursor: 41,
      });

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              {
                name: string | null;
                display_code: string | null;
                instrument_key: string | null;
                provider_config: string | null;
              },
              []
            >(
              `
                SELECT name, display_code, instrument_key, provider_config
                FROM assets
                WHERE id = 'asset-replay'
              `,
            )
            .get(),
        ).toEqual({
          name: "Remote Asset",
          display_code: "REMOTE",
          instrument_key: "EQUITY:REMOTE@XNAS",
          provider_config: JSON.stringify({ preferred_provider: "YAHOO" }),
        });
        expect(
          verifyDb
            .query<{ last_event_id: string; last_op: string; last_seq: number }, []>(
              `
                SELECT last_event_id, last_op, last_seq
                FROM sync_entity_metadata
                WHERE entity = 'asset'
                  AND entity_id = 'asset-replay'
              `,
            )
            .get(),
        ).toEqual({
          last_event_id: "efefefef-efef-4efe-8fef-efefefefefef",
          last_op: "create",
          last_seq: 41,
        });
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect account replay LWW and tombstones", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-trigger-account-lww-"));
    const rootKey = Buffer.alloc(32, 11).toString("base64");
    const crypto = createSyncCryptoService();
    const dek = (await crypto.deriveDek(rootKey, 5)).value;
    const skippedPayload = (
      await crypto.encrypt(
        dek,
        JSON.stringify({
          id: "88888888-8888-4888-8888-888888888888",
          name: "Stale Remote",
          account_type: "CASH",
          currency: "USD",
        }),
      )
    ).value;
    const deletePayload = (
      await crypto.encrypt(dek, JSON.stringify({ id: "99999999-9999-4999-8999-999999999999" }))
    ).value;
    const blockedPayload = (
      await crypto.encrypt(
        dek,
        JSON.stringify({
          id: "99999999-9999-4999-8999-999999999999",
          name: "Resurrected",
          account_type: "CASH",
          currency: "USD",
        }),
      )
    ).value;
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
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "PULL_TAIL", cursor: 22 });
        }
        if (url.endsWith("/api/v1/sync/events/pull?since=12&limit=500")) {
          return Response.json({
            from: 12,
            to: 22,
            next_cursor: 22,
            has_more: false,
            events: [
              {
                event_id: "10000000-0000-4000-8000-000000000000",
                device_id: "other-device",
                type: "account.update.v1",
                entity: "account",
                entity_id: "88888888-8888-4888-8888-888888888888",
                client_timestamp: "2026-01-01T00:00:00Z",
                payload: skippedPayload,
                payload_key_version: 5,
                seq: 20,
                user_id: "user-1",
                team_id: "team-1",
                server_timestamp: "2026-01-01T00:00:01Z",
              },
              {
                event_id: "20000000-0000-4000-8000-000000000000",
                device_id: "other-device",
                type: "account.delete.v1",
                entity: "account",
                entity_id: "99999999-9999-4999-8999-999999999999",
                client_timestamp: "2025-12-31T00:00:00Z",
                payload: deletePayload,
                payload_key_version: 5,
                seq: 21,
                user_id: "user-1",
                team_id: "team-1",
                server_timestamp: "2026-01-01T00:00:01Z",
              },
              {
                event_id: "30000000-0000-4000-8000-000000000000",
                device_id: "other-device",
                type: "account.update.v1",
                entity: "account",
                entity_id: "99999999-9999-4999-8999-999999999999",
                client_timestamp: "2027-01-01T00:00:00Z",
                payload: blockedPayload,
                payload_key_version: 5,
                seq: 22,
                user_id: "user-1",
                team_id: "team-1",
                server_timestamp: "2027-01-01T00:00:01Z",
              },
            ],
          });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey,
          keyVersion: 5,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.exec(`
          UPDATE sync_cursor SET cursor = 12 WHERE id = 1;
          INSERT INTO accounts (
            id, name, account_type, "group", currency, is_default, is_active,
            is_archived, tracking_mode
          )
          VALUES
            ('88888888-8888-4888-8888-888888888888', 'Local Wins', 'CASH', NULL, 'USD', 0, 1, 0, 'HOLDINGS'),
            ('99999999-9999-4999-8999-999999999999', 'Delete Me', 'CASH', NULL, 'USD', 0, 1, 0, 'HOLDINGS');
          INSERT INTO sync_entity_metadata (
            entity, entity_id, last_event_id, last_client_timestamp, last_op, last_seq
          )
          VALUES (
            'account',
            '88888888-8888-4888-8888-888888888888',
            '90000000-0000-4000-8000-000000000000',
            '2026-02-01T00:00:00Z',
            'update',
            19
          );
        `);
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const triggerResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/trigger-cycle`, {
        method: "POST",
      });
      expect(triggerResponse.status).toBe(200);
      await expect(triggerResponse.json()).resolves.toMatchObject({
        status: "ok",
        pulledCount: 1,
        cursor: 22,
      });
      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<{ id: string; name: string }, []>(
              `
                SELECT id, name
                FROM accounts
                WHERE id IN (
                  '88888888-8888-4888-8888-888888888888',
                  '99999999-9999-4999-8999-999999999999'
                )
                ORDER BY id
              `,
            )
            .all(),
        ).toEqual([{ id: "88888888-8888-4888-8888-888888888888", name: "Local Wins" }]);
        expect(
          verifyDb
            .query<{ last_op: string; last_seq: number }, []>(
              `
                SELECT last_op, last_seq
                FROM sync_entity_metadata
                WHERE entity = 'account'
                  AND entity_id = '99999999-9999-4999-8999-999999999999'
              `,
            )
            .get(),
        ).toEqual({ last_op: "delete", last_seq: 21 });
        expect(
          verifyDb
            .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM sync_applied_events")
            .get(),
        ).toEqual({ count: 3 });
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect bootstrap-snapshot route for not-ready device", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-bootstrap-not-ready-"));
    const deviceSyncRequests: string[] = [];
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
        deviceSyncRequests.push(url);
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "untrusted",
          trusted_key_version: 0,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
        }),
      );
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const bootstrapResponse = await fetch(
        `${server.baseUrl}/api/v1/connect/device/bootstrap-snapshot`,
        { method: "POST" },
      );
      expect(bootstrapResponse.status).toBe(200);
      await expect(bootstrapResponse.json()).resolves.toEqual({
        status: "skipped_not_ready",
        message: "Device is not in READY state",
        snapshotId: null,
        cursor: null,
      });
      expect(deviceSyncRequests).toEqual([
        "https://api.example.test/api/v1/sync/team/devices/device-runtime",
        "https://api.example.test/api/v1/sync/team/devices?scope=my",
        "https://api.example.test/api/v1/sync/team/keys/initialize",
      ]);
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect bootstrap-snapshot route when already complete", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-bootstrap-complete-"));
    const deviceSyncRequests: string[] = [];
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
        deviceSyncRequests.push(url);
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "NOOP" });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
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
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.exec(`
          UPDATE sync_cursor SET cursor = 9 WHERE id = 1;
          UPDATE sync_engine_state SET last_cycle_status = 'ok' WHERE id = 1;
          INSERT INTO sync_device_config (
            device_id, key_version, trust_state, last_bootstrap_at, min_snapshot_created_at
          )
          VALUES ('device-runtime', 5, 'trusted', '2026-01-01T00:00:00Z', NULL)
          ON CONFLICT(device_id) DO UPDATE SET
            key_version = excluded.key_version,
            trust_state = excluded.trust_state,
            last_bootstrap_at = excluded.last_bootstrap_at,
            min_snapshot_created_at = excluded.min_snapshot_created_at;
        `);
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const bootstrapResponse = await fetch(
        `${server.baseUrl}/api/v1/connect/device/bootstrap-snapshot`,
        { method: "POST" },
      );
      expect(bootstrapResponse.status).toBe(200);
      await expect(bootstrapResponse.json()).resolves.toEqual({
        status: "skipped",
        message: "Snapshot bootstrap already completed",
        snapshotId: null,
        cursor: 9,
      });
      expect(deviceSyncRequests).toEqual([
        "https://api.example.test/api/v1/sync/team/devices/device-runtime",
        "https://api.example.test/api/v1/sync/events/reconcile-ready-state",
        "https://api.example.test/api/v1/sync/team/devices/device-runtime",
      ]);
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect bootstrap-snapshot route while waiting for snapshot", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-bootstrap-wait-"));
    const deviceSyncRequests: string[] = [];
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
        deviceSyncRequests.push(url);
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "WAIT_SNAPSHOT" });
        }
        if (url.endsWith("/api/v1/sync/snapshots/latest")) {
          return Response.json(
            { code: "SNAPSHOT_NOT_FOUND", message: "not found" },
            { status: 404 },
          );
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
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
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.prepare("UPDATE sync_cursor SET cursor = 13 WHERE id = 1").run();
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const bootstrapResponse = await fetch(
        `${server.baseUrl}/api/v1/connect/device/bootstrap-snapshot`,
        { method: "POST" },
      );
      expect(bootstrapResponse.status).toBe(200);
      await expect(bootstrapResponse.json()).resolves.toEqual({
        status: "requested",
        message: "Waiting for a trusted device to upload a snapshot",
        snapshotId: null,
        cursor: 13,
      });
      expect(deviceSyncRequests).toEqual([
        "https://api.example.test/api/v1/sync/team/devices/device-runtime",
        "https://api.example.test/api/v1/sync/events/reconcile-ready-state",
        "https://api.example.test/api/v1/sync/snapshots/latest",
        "https://api.example.test/api/v1/sync/events/reconcile-ready-state",
        "https://api.example.test/api/v1/sync/team/devices/device-runtime",
      ]);
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect bootstrap-snapshot route when no remote snapshot is required", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-bootstrap-no-remote-"));
    const deviceSyncRequests: string[] = [];
    let reconcileCalls = 0;
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
        deviceSyncRequests.push(url);
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          reconcileCalls += 1;
          return Response.json({ action: reconcileCalls === 1 ? "WAIT_SNAPSHOT" : "NOOP" });
        }
        if (url.endsWith("/api/v1/sync/snapshots/latest")) {
          return Response.json(
            { code: "SNAPSHOT_NOT_FOUND", message: "not found" },
            { status: 404 },
          );
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
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
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.prepare("UPDATE sync_cursor SET cursor = 42 WHERE id = 1").run();
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const bootstrapResponse = await fetch(
        `${server.baseUrl}/api/v1/connect/device/bootstrap-snapshot`,
        { method: "POST" },
      );
      expect(bootstrapResponse.status).toBe(200);
      await expect(bootstrapResponse.json()).resolves.toEqual({
        status: "skipped",
        message: "No remote snapshot is required for this device",
        snapshotId: null,
        cursor: 0,
      });
      expect(deviceSyncRequests).toEqual([
        "https://api.example.test/api/v1/sync/team/devices/device-runtime",
        "https://api.example.test/api/v1/sync/events/reconcile-ready-state",
        "https://api.example.test/api/v1/sync/snapshots/latest",
        "https://api.example.test/api/v1/sync/events/reconcile-ready-state",
        "https://api.example.test/api/v1/sync/team/devices/device-runtime",
      ]);
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect bootstrap-snapshot route to newer-schema error", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-bootstrap-schema-"));
    const deviceSyncRequests: string[] = [];
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
        deviceSyncRequests.push(url);
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "NOOP" });
        }
        if (url.endsWith("/api/v1/sync/snapshots/latest")) {
          return Response.json({
            snapshot_id: "019bb9fe-f707-71e9-a40d-733575f4f246",
            oplog_seq: 13,
            created_at: "2026-01-01T00:00:00Z",
            schema_version: 2,
            covers_tables: [],
            size_bytes: 128,
            checksum: "sha256:snapshot",
          });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
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
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const bootstrapResponse = await fetch(
        `${server.baseUrl}/api/v1/connect/device/bootstrap-snapshot`,
        { method: "POST" },
      );
      expect(bootstrapResponse.status).toBe(500);
      await expect(bootstrapResponse.json()).resolves.toMatchObject({
        code: "internal_error",
        message: "Snapshot schema version 2 is newer than local version 1. Please update the app.",
      });
      expect(deviceSyncRequests).toEqual([
        "https://api.example.test/api/v1/sync/team/devices/device-runtime",
        "https://api.example.test/api/v1/sync/events/reconcile-ready-state",
        "https://api.example.test/api/v1/sync/snapshots/latest",
      ]);
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect bootstrap-snapshot route to apply downloaded snapshot", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-bootstrap-apply-"));
    const rootKey = Buffer.alloc(32, 35).toString("base64");
    const crypto = createSyncCryptoService();
    const dek = (await crypto.deriveDek(rootKey, 5)).value;
    const snapshotPath = path.join(appDataDir, "remote-snapshot.db");
    let encryptedBlob = Buffer.alloc(0);
    let checksum = "";
    const deviceSyncRequests: string[] = [];
    let reconcileCalls = 0;
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
        deviceSyncRequests.push(url);
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          reconcileCalls += 1;
          return Response.json({ action: reconcileCalls === 1 ? "BOOTSTRAP_SNAPSHOT" : "NOOP" });
        }
        if (url.endsWith("/api/v1/sync/snapshots/latest")) {
          return Response.json({
            snapshot_id: "019bb9fe-f707-71e9-a40d-733575f4f246",
            oplog_seq: 77,
            created_at: "2026-01-02T00:00:00Z",
            schema_version: 1,
            covers_tables: ["quotes"],
            size_bytes: encryptedBlob.byteLength,
            checksum,
          });
        }
        if (url.endsWith("/api/v1/sync/snapshots/019bb9fe-f707-71e9-a40d-733575f4f246")) {
          return new Response(new Uint8Array(encryptedBlob), {
            headers: {
              "content-type": "application/octet-stream",
              "x-snapshot-schema-version": "1",
              "x-snapshot-covers-tables": "quotes",
              "x-snapshot-checksum": checksum,
            },
          });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    copyFileSync(runtime.dbPath, snapshotPath);
    const snapshotDb = openSqliteDatabase(snapshotPath);
    try {
      seedRuntimeAsset(snapshotDb, "bootstrap-asset");
      snapshotDb.exec(`
        INSERT INTO quotes (
          id, asset_id, day, source, close, currency, created_at, timestamp
        )
        VALUES (
          'bootstrap-remote-manual', 'bootstrap-asset', '2026-01-02',
          'MANUAL', '123', 'USD', '2026-01-02T00:00:00+00:00',
          '2026-01-02T00:00:00+00:00'
        );
      `);
      snapshotDb.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } finally {
      snapshotDb.close();
    }
    const snapshotBytes = readFileSync(snapshotPath);
    encryptedBlob = Buffer.from(
      (await crypto.encrypt(dek, snapshotBytes.toString("base64"))).value,
      "utf8",
    );
    checksum = `sha256:${createHash("sha256").update(encryptedBlob).digest("hex")}`;
    const server = startBackendServer(config, runtime.options);
    const events: string[] = [];
    const unsubscribe = runtime.options.eventBus?.subscribe((event) => {
      events.push(event.name);
    });

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey,
          keyVersion: 5,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedRuntimeAsset(seedDb, "bootstrap-asset");
        seedDb.exec(`
          UPDATE sync_cursor SET cursor = 3 WHERE id = 1;
          UPDATE sync_engine_state
          SET last_cycle_status = 'stale_cursor', last_error = 'stale'
          WHERE id = 1;
          INSERT INTO sync_outbox (
            event_id, entity, entity_id, op, client_timestamp, payload,
            payload_key_version, sent, status, retry_count, device_id, created_at
          )
          VALUES (
            'bootstrap-outbox', 'quote', 'local-manual', 'create',
            '2026-01-01T00:00:00Z', '{}', 5, 0, 'pending', 0,
            'device-runtime', '2026-01-01T00:00:00Z'
          );
          INSERT INTO quotes (
            id, asset_id, day, source, close, currency, created_at, timestamp
          )
          VALUES
            (
              'bootstrap-local-manual', 'bootstrap-asset', '2026-01-01',
              'MANUAL', '10', 'USD', '2026-01-01T00:00:00+00:00',
              '2026-01-01T00:00:00+00:00'
            ),
            (
              'bootstrap-local-provider', 'bootstrap-asset', '2026-01-03',
              'YAHOO', '99', 'USD', '2026-01-03T00:00:00+00:00',
              '2026-01-03T00:00:00+00:00'
            );
        `);
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const bootstrapResponse = await fetch(
        `${server.baseUrl}/api/v1/connect/device/bootstrap-snapshot`,
        { method: "POST" },
      );
      expect(bootstrapResponse.status).toBe(200);
      await expect(bootstrapResponse.json()).resolves.toEqual({
        status: "applied",
        message: "Snapshot bootstrap completed",
        snapshotId: "019bb9fe-f707-71e9-a40d-733575f4f246",
        cursor: 77,
      });
      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              { id: string; source: string; close: string },
              []
            >("SELECT id, source, close FROM quotes ORDER BY id ASC")
            .all(),
        ).toEqual([
          { id: "bootstrap-local-provider", source: "YAHOO", close: "99" },
          { id: "bootstrap-remote-manual", source: "MANUAL", close: "123" },
        ]);
        expect(
          verifyDb
            .query<{ cursor: number }, []>("SELECT cursor FROM sync_cursor WHERE id = 1")
            .get(),
        ).toEqual({ cursor: 77 });
        expect(
          verifyDb
            .query<
              {
                key_version: number;
                trust_state: string;
                last_bootstrap_at: string | null;
                min_snapshot_created_at: string | null;
              },
              []
            >(
              `
                SELECT key_version, trust_state, last_bootstrap_at, min_snapshot_created_at
                FROM sync_device_config
                WHERE device_id = 'device-runtime'
              `,
            )
            .get(),
        ).toMatchObject({
          key_version: 5,
          trust_state: "trusted",
          min_snapshot_created_at: null,
        });
        expect(
          verifyDb.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM sync_outbox").get(),
        ).toEqual({ count: 0 });
        expect(
          verifyDb
            .query<
              { last_cycle_status: string | null; last_error: string | null },
              []
            >("SELECT last_cycle_status, last_error FROM sync_engine_state WHERE id = 1")
            .get(),
        ).toEqual({ last_cycle_status: "ok", last_error: null });
        expect(
          verifyDb
            .query<
              { last_snapshot_restore_at: string | null },
              []
            >("SELECT last_snapshot_restore_at FROM sync_table_state WHERE table_name = 'quotes'")
            .get()?.last_snapshot_restore_at,
        ).toEqual(expect.any(String));
        expect(events).toContain(DEVICE_SYNC_PULL_COMPLETE_EVENT);
      } finally {
        verifyDb.close();
      }
      expect(deviceSyncRequests.slice(0, 4)).toEqual([
        "https://api.example.test/api/v1/sync/team/devices/device-runtime",
        "https://api.example.test/api/v1/sync/events/reconcile-ready-state",
        "https://api.example.test/api/v1/sync/snapshots/latest",
        "https://api.example.test/api/v1/sync/snapshots/019bb9fe-f707-71e9-a40d-733575f4f246",
      ]);
      expect(deviceSyncRequests).toContain(
        "https://api.example.test/api/v1/sync/team/devices/device-runtime",
      );
    } finally {
      unsubscribe?.();
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect start-background route to ready background loop", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-start-ready-"));
    const deviceSyncRequests: string[] = [];
    const rootKey = Buffer.alloc(32, 38).toString("base64");
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
        deviceSyncRequests.push(url);
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "NOOP", cursor: 0 });
        }
        if (url.endsWith("/api/v1/sync/events/push")) {
          return Response.json({
            accepted: [],
            duplicate: [],
            server_cursor: 0,
          });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey,
          keyVersion: 5,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
      );
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const startResponse = await fetch(
        `${server.baseUrl}/api/v1/connect/device/start-background`,
        { method: "POST" },
      );
      expect(startResponse.status).toBe(200);
      await expect(startResponse.json()).resolves.toEqual({
        status: "started",
        message: "Device sync background engine started",
      });
      await waitForCondition(() =>
        deviceSyncRequests.includes(
          "https://api.example.test/api/v1/sync/events/reconcile-ready-state",
        ),
      );
      const statusResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/engine-status`);
      expect(statusResponse.status).toBe(200);
      await expect(statusResponse.json()).resolves.toMatchObject({ backgroundRunning: true });

      const firstRequestCount = deviceSyncRequests.length;
      const createResponse = await fetch(`${server.baseUrl}/api/v1/accounts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Wake Brokerage",
          accountType: "SECURITIES",
          group: "Investing",
          currency: "USD",
          isDefault: false,
          isActive: true,
          trackingMode: "HOLDINGS",
          provider: "MANUAL",
        }),
      });
      expect(createResponse.status).toBe(200);
      await waitForCondition(
        () =>
          deviceSyncRequests
            .slice(firstRequestCount)
            .includes("https://api.example.test/api/v1/sync/events/reconcile-ready-state"),
        3_000,
      );

      const stopResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/stop-background`, {
        method: "POST",
      });
      expect(stopResponse.status).toBe(200);
      await expect(stopResponse.json()).resolves.toEqual({
        status: "stopped",
        message: "Device sync background engine stopped",
      });
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect reconcile-ready route for not-ready device", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-reconcile-not-ready-"));
    const deviceSyncRequests: string[] = [];
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
        deviceSyncRequests.push(url);
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "untrusted",
          trusted_key_version: 0,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
        }),
      );
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const reconcileResponse = await fetch(
        `${server.baseUrl}/api/v1/connect/device/reconcile-ready-state`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ allowOverwrite: false }),
        },
      );
      expect(reconcileResponse.status).toBe(200);
      await expect(reconcileResponse.json()).resolves.toMatchObject({
        status: "skipped_not_ready",
        message: "Device is not in READY state",
      });
      expect(deviceSyncRequests).toEqual([
        "https://api.example.test/api/v1/sync/team/devices/device-runtime",
        "https://api.example.test/api/v1/sync/team/devices?scope=my",
        "https://api.example.test/api/v1/sync/team/keys/initialize",
      ]);
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect enable route for existing ready identity", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-enable-ready-"));
    const deviceSyncRequests: string[] = [];
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
        deviceSyncRequests.push(url);
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
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
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const enableResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/enable`, {
        method: "POST",
      });
      expect(enableResponse.status).toBe(200);
      await expect(enableResponse.json()).resolves.toEqual({
        deviceId: "device-runtime",
        state: "READY",
        keyVersion: 5,
        serverKeyVersion: 5,
        needsPairing: false,
        trustedDevices: [],
      });
      expect(deviceSyncRequests).toEqual([
        "https://api.example.test/api/v1/sync/team/devices/device-runtime",
      ]);
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect enable route for existing stale identity", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-enable-stale-"));
    const deviceSyncRequests: string[] = [];
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
        deviceSyncRequests.push(url);
        if (url.endsWith("/api/v1/sync/team/devices?scope=my")) {
          return Response.json([
            {
              id: "trusted-device",
              display_name: "iPhone",
              platform: "ios",
              trust_state: "trusted",
              last_seen_at: null,
            },
          ]);
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 6,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
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
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const enableResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/enable`, {
        method: "POST",
      });
      expect(enableResponse.status).toBe(200);
      await expect(enableResponse.json()).resolves.toEqual({
        deviceId: "device-runtime",
        state: "STALE",
        keyVersion: 5,
        serverKeyVersion: 6,
        needsPairing: true,
        trustedDevices: [
          {
            id: "trusted-device",
            name: "iPhone",
            platform: "ios",
            lastSeenAt: null,
          },
        ],
      });
      expect(deviceSyncRequests).toEqual([
        "https://api.example.test/api/v1/sync/team/devices/device-runtime",
        "https://api.example.test/api/v1/sync/team/devices?scope=my",
      ]);
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect enable route for existing registered identity", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-enable-registered-"));
    const deviceSyncRequests: string[] = [];
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
        deviceSyncRequests.push(url);
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "untrusted",
          trusted_key_version: 0,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
        }),
      );
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const enableResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/enable`, {
        method: "POST",
      });
      expect(enableResponse.status).toBe(200);
      await expect(enableResponse.json()).resolves.toEqual({
        deviceId: "device-runtime",
        state: "REGISTERED",
        keyVersion: null,
        serverKeyVersion: 0,
        needsPairing: true,
        trustedDevices: [],
      });
      expect(deviceSyncRequests).toEqual([
        "https://api.example.test/api/v1/sync/team/devices/device-runtime",
        "https://api.example.test/api/v1/sync/team/devices?scope=my",
        "https://api.example.test/api/v1/sync/team/keys/initialize",
      ]);
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect enable route for fresh pairing-required enrollment", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-enable-fresh-"));
    const deviceSyncRequests: Array<{ url: string; body: Record<string, unknown> | null }> = [];
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
        const body =
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : null;
        deviceSyncRequests.push({ url, body });
        return Response.json({
          mode: "PAIR",
          device_id: "device-runtime",
          e2ee_key_version: 6,
          require_sas: true,
          pairing_ttl_seconds: 300,
          trusted_devices: [
            { id: "trusted-device", name: "iPhone", platform: "ios", last_seen_at: null },
          ],
        });
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

      const enableResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/enable`, {
        method: "POST",
      });
      expect(enableResponse.status).toBe(200);
      await expect(enableResponse.json()).resolves.toEqual({
        deviceId: "device-runtime",
        state: "REGISTERED",
        keyVersion: null,
        serverKeyVersion: 6,
        needsPairing: true,
        trustedDevices: [
          { id: "trusted-device", name: "iPhone", platform: "ios", lastSeenAt: null },
        ],
      });
      expect(deviceSyncRequests).toEqual([
        {
          url: "https://api.example.test/api/v1/sync/team/devices",
          body: expect.objectContaining({
            display_name: "Wealthfolio Server",
            device_nonce: expect.any(String),
          }),
        },
      ]);
      const identityRaw = await runtime.options.secretService?.getSecret("sync_identity");
      expect(JSON.parse(identityRaw ?? "{}")).toMatchObject({
        version: 2,
        deviceId: "device-runtime",
        rootKey: null,
        keyVersion: null,
      });
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect enable route through bootstrap key initialization", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-enable-bootstrap-"));
    const deviceSyncRequests: Array<{
      url: string;
      method: string;
      body: Record<string, unknown> | null;
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
        const body =
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : null;
        deviceSyncRequests.push({ url, method: init?.method ?? "GET", body });
        if (url.endsWith("/api/v1/sync/team/devices")) {
          return Response.json({
            mode: "BOOTSTRAP",
            device_id: "device-runtime",
            e2ee_key_version: 7,
          });
        }
        if (url.endsWith("/api/v1/sync/team/keys/initialize")) {
          return Response.json({
            mode: "BOOTSTRAP",
            challenge: "challenge-runtime",
            nonce: "nonce-runtime",
            key_version: 7,
          });
        }
        if (url.endsWith("/api/v1/sync/team/keys/initialize/commit")) {
          return Response.json({ success: true, key_state: "ACTIVE" });
        }
        throw new Error(`unexpected request: ${url}`);
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

      const enableResponse = await fetch(`${server.baseUrl}/api/v1/connect/device/enable`, {
        method: "POST",
      });
      expect(enableResponse.status).toBe(200);
      await expect(enableResponse.json()).resolves.toEqual({
        deviceId: "device-runtime",
        state: "READY",
        keyVersion: 7,
        serverKeyVersion: 7,
        needsPairing: false,
        trustedDevices: [],
      });

      const enrollRequest = deviceSyncRequests.find((request) =>
        request.url.endsWith("/api/v1/sync/team/devices"),
      );
      expect(enrollRequest).toMatchObject({
        method: "POST",
        body: {
          device_nonce: expect.any(String),
          display_name: "Wealthfolio Server",
        },
      });

      const commitRequest = deviceSyncRequests.find((request) =>
        request.url.endsWith("/api/v1/sync/team/keys/initialize/commit"),
      );
      expect(commitRequest?.body).toMatchObject({
        device_id: "device-runtime",
        key_version: 7,
        challenge_response: "0e3c1f799a2688e6a4094ab62dfd050dad7e109d10882a646e7f09d9fbd7247f",
      });
      expect(typeof commitRequest?.body?.device_key_envelope).toBe("string");
      expect(typeof commitRequest?.body?.signature).toBe("string");
      expect(commitRequest?.body).not.toHaveProperty("recovery_envelope");

      const identityRaw = await runtime.options.secretService?.getSecret("sync_identity");
      const identity = JSON.parse(identityRaw ?? "{}") as Record<string, unknown>;
      expect(identity).toMatchObject({
        version: 2,
        deviceId: "device-runtime",
        keyVersion: 7,
      });
      expect(typeof identity.deviceNonce).toBe("string");
      expect(typeof identity.rootKey).toBe("string");
      expect(typeof identity.deviceSecretKey).toBe("string");
      expect(typeof identity.devicePublicKey).toBe("string");
      expect(await runtime.options.secretService?.getSecret("sync_device_id")).toBe(
        "device-runtime",
      );

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              {
                key_version: number;
                trust_state: string;
                last_bootstrap_at: string | null;
                min_snapshot_created_at: string | null;
              },
              []
            >(
              "SELECT key_version, trust_state, last_bootstrap_at, min_snapshot_created_at FROM sync_device_config WHERE device_id = 'device-runtime'",
            )
            .get(),
        ).toMatchObject({
          key_version: 7,
          trust_state: "trusted",
          last_bootstrap_at: expect.any(String),
          min_snapshot_created_at: null,
        });
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect clear sync-data route to local cleanup", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-clear-sync-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
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
        seedDb
          .prepare(
            `
            INSERT INTO accounts (
              id, name, account_type, "group", currency, is_default, is_active,
              is_archived, tracking_mode
            )
            VALUES ('clear-account', 'Clear Account', 'CASH', NULL, 'USD', 0, 1, 0, 'HOLDINGS')
          `,
          )
          .run();
        seedDb
          .prepare(
            `
            INSERT INTO sync_outbox (
              event_id, entity, entity_id, op, client_timestamp, payload,
              payload_key_version, sent, status, retry_count, device_id, created_at
            )
            VALUES (
              'clear-event', 'account', 'clear-account', 'update',
              '2026-01-01T00:00:00Z', '{}', 5, 0, 'pending', 0,
              'device-runtime', '2026-01-01T00:00:00Z'
            )
          `,
          )
          .run();
        seedDb
          .prepare(
            `
            INSERT INTO sync_entity_metadata (
              entity, entity_id, last_event_id, last_client_timestamp, last_op, last_seq
            )
            VALUES ('account', 'clear-account', 'clear-event', '2026-01-01T00:00:00Z', 'update', 9)
          `,
          )
          .run();
        seedDb
          .prepare(
            `
            INSERT INTO sync_applied_events (event_id, seq, entity, entity_id, applied_at)
            VALUES ('applied-event', 10, 'account', 'clear-account', '2026-01-01T00:00:00Z')
          `,
          )
          .run();
        seedDb
          .prepare(
            `
            INSERT INTO sync_device_config (
              device_id, key_version, trust_state, last_bootstrap_at, min_snapshot_created_at
            )
            VALUES ('device-runtime', 5, 'trusted', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z')
          `,
          )
          .run();
        seedDb
          .prepare(
            `
            INSERT INTO sync_table_state (table_name, enabled)
            VALUES ('accounts', 1)
            ON CONFLICT(table_name) DO UPDATE SET enabled = excluded.enabled
          `,
          )
          .run();
        seedDb.prepare("UPDATE sync_cursor SET cursor = 55 WHERE id = 1").run();
        seedDb
          .prepare(
            `
            UPDATE sync_engine_state
            SET lock_version = 8,
                last_error = 'stale',
                consecutive_failures = 2,
                last_cycle_status = 'failed',
                last_cycle_duration_ms = 99
            WHERE id = 1
          `,
          )
          .run();
      } finally {
        seedDb.close();
      }

      const response = await fetch(`${server.baseUrl}/api/v1/connect/device/sync-data`, {
        method: "DELETE",
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toBeNull();
      expect(await runtime.options.secretService?.getSecret("sync_device_id")).toBeNull();
      expect(await runtime.options.secretService?.getSecret("sync_identity")).toBe(
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

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM accounts").get(),
        ).toEqual({ count: 1 });
        for (const tableName of [
          "sync_outbox",
          "sync_entity_metadata",
          "sync_applied_events",
          "sync_table_state",
          "sync_device_config",
        ]) {
          expect(
            verifyDb
              .query<{ count: number }, []>(`SELECT COUNT(*) AS count FROM "${tableName}"`)
              .get(),
          ).toEqual({ count: 0 });
        }
        expect(
          verifyDb
            .query<{ cursor: number }, []>("SELECT cursor FROM sync_cursor WHERE id = 1")
            .get(),
        ).toEqual({ cursor: 0 });
        expect(
          verifyDb
            .query<
              { lock_version: number; last_error: string | null; last_cycle_status: string | null },
              []
            >("SELECT lock_version, last_error, last_cycle_status FROM sync_engine_state WHERE id = 1")
            .get(),
        ).toEqual({ lock_version: 0, last_error: null, last_cycle_status: null });
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect reinitialize route through reset and reenroll", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-reinitialize-"));
    const deviceSyncRequests: Array<{ url: string; body: Record<string, unknown> | null }> = [];
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
        const body =
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : null;
        deviceSyncRequests.push({ url, body });
        if (url.endsWith("/api/v1/sync/team/keys/reset")) {
          return Response.json({ success: true, key_version: 5, reset_at: "2026-01-01T00:00:00Z" });
        }
        return Response.json({
          mode: "PAIR",
          device_id: "new-device",
          e2ee_key_version: 6,
          require_sas: true,
          pairing_ttl_seconds: 300,
          trusted_devices: [
            { id: "trusted-device", name: "iPhone", platform: "ios", last_seen_at: null },
          ],
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "existing-nonce",
          deviceId: "old-device",
          rootKey: "root-key",
          keyVersion: 5,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
      );
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const reinitializeResponse = await fetch(
        `${server.baseUrl}/api/v1/connect/device/reinitialize`,
        { method: "POST" },
      );
      expect(reinitializeResponse.status).toBe(200);
      await expect(reinitializeResponse.json()).resolves.toEqual({
        deviceId: "new-device",
        state: "REGISTERED",
        keyVersion: null,
        serverKeyVersion: 6,
        needsPairing: true,
        trustedDevices: [
          { id: "trusted-device", name: "iPhone", platform: "ios", lastSeenAt: null },
        ],
      });
      expect(deviceSyncRequests).toEqual([
        {
          url: "https://api.example.test/api/v1/sync/team/keys/reset",
          body: { reason: "reinitialize" },
        },
        {
          url: "https://api.example.test/api/v1/sync/team/devices",
          body: expect.objectContaining({ device_nonce: "existing-nonce" }),
        },
      ]);
      const identityRaw = await runtime.options.secretService?.getSecret("sync_identity");
      expect(JSON.parse(identityRaw ?? "{}")).toMatchObject({
        deviceNonce: "existing-nonce",
        deviceId: "new-device",
        rootKey: null,
        keyVersion: null,
      });
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect bootstrap overwrite check route with local data", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-overwrite-check-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey: Buffer.alloc(32, 42).toString("base64"),
          keyVersion: 2,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
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

      const response = await fetch(
        `${server.baseUrl}/api/v1/connect/device/bootstrap-overwrite-check`,
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        bootstrapRequired: true,
        hasLocalData: true,
        localRows: 1,
        nonEmptyTables: [{ table: "accounts", rows: 1 }],
      });
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect generate-snapshot route for untrusted device", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-generate-untrusted-"));
    const deviceSyncRequests: string[] = [];
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
        deviceSyncRequests.push(url);
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "untrusted",
          trusted_key_version: 2,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
        }),
      );
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const generateResponse = await fetch(
        `${server.baseUrl}/api/v1/connect/device/generate-snapshot`,
        { method: "POST" },
      );
      expect(generateResponse.status).toBe(200);
      await expect(generateResponse.json()).resolves.toEqual({
        status: "skipped",
        snapshotId: null,
        oplogSeq: null,
        message: "Current device is not trusted",
      });
      expect(deviceSyncRequests).toEqual([
        "https://api.example.test/api/v1/sync/team/devices/device-runtime",
      ]);
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect generate-snapshot route when latest snapshot covers cursor", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-generate-uploaded-"));
    const deviceSyncRequests: string[] = [];
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
        deviceSyncRequests.push(url);
        if (url.endsWith("/api/v1/sync/events/cursor")) {
          return Response.json({ cursor: 10 });
        }
        if (url.endsWith("/api/v1/sync/snapshots/latest")) {
          return Response.json({
            snapshot_id: "019bb9fe-f707-71e9-a40d-733575f4f246",
            oplog_seq: 10,
            created_at: "2026-01-01T00:00:00Z",
            schema_version: 1,
            covers_tables: [],
            size_bytes: 128,
            checksum: "sha256:snapshot",
          });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
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
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.prepare("UPDATE sync_cursor SET cursor = 10 WHERE id = 1").run();
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const generateResponse = await fetch(
        `${server.baseUrl}/api/v1/connect/device/generate-snapshot`,
        { method: "POST" },
      );
      expect(generateResponse.status).toBe(200);
      await expect(generateResponse.json()).resolves.toEqual({
        status: "uploaded",
        snapshotId: "019bb9fe-f707-71e9-a40d-733575f4f246",
        oplogSeq: 10,
        message: "Latest remote snapshot already covers current cursor",
      });
      expect(deviceSyncRequests).toEqual([
        "https://api.example.test/api/v1/sync/team/devices/device-runtime",
        "https://api.example.test/api/v1/sync/events/cursor",
        "https://api.example.test/api/v1/sync/snapshots/latest",
      ]);
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect generate-snapshot route to restore-required error", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-generate-restore-"));
    const deviceSyncRequests: string[] = [];
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
        deviceSyncRequests.push(url);
        if (url.endsWith("/api/v1/sync/events/cursor")) {
          return Response.json({ cursor: 8 });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
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
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.prepare("UPDATE sync_cursor SET cursor = 10 WHERE id = 1").run();
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const generateResponse = await fetch(
        `${server.baseUrl}/api/v1/connect/device/generate-snapshot`,
        { method: "POST" },
      );
      expect(generateResponse.status).toBe(500);
      await expect(generateResponse.json()).resolves.toMatchObject({
        code: "internal_error",
        message:
          "SYNC_SOURCE_RESTORE_REQUIRED: This device needs to set up sync again before you add another device.",
      });
      expect(deviceSyncRequests).toEqual([
        "https://api.example.test/api/v1/sync/team/devices/device-runtime",
        "https://api.example.test/api/v1/sync/events/cursor",
      ]);
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect generate-snapshot route to upload snapshot", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-generate-gated-"));
    const deviceSyncRequests: string[] = [];
    const rootKey = Buffer.alloc(32, 34).toString("base64");
    const crypto = createSyncCryptoService();
    const dek = (await crypto.deriveDek(rootKey, 5)).value;
    const expectedTables = [
      "platforms",
      "assets",
      "market_data_custom_providers",
      "quotes",
      "goals",
      "goal_plans",
      "ai_threads",
      "contribution_limits",
      "accounts",
      "import_runs",
      "activities",
      "import_templates",
      "import_account_templates",
      "taxonomies",
      "taxonomy_categories",
      "asset_taxonomy_assignments",
      "goals_allocation",
      "ai_messages",
      "ai_thread_tags",
      "holdings_snapshots",
      "portfolios",
      "portfolio_accounts",
    ];
    let capturedUpload: {
      headers: Headers;
      body: Buffer;
    } | null = null;
    let uploadAttempts = 0;
    const uploadEventIds: string[] = [];
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
        deviceSyncRequests.push(url);
        if (url.endsWith("/api/v1/sync/events/cursor")) {
          return Response.json({ cursor: 10 });
        }
        if (url.endsWith("/api/v1/sync/snapshots/latest")) {
          return Response.json(
            { code: "SNAPSHOT_NOT_FOUND", message: "not found" },
            { status: 404 },
          );
        }
        if (url.endsWith("/api/v1/sync/snapshots/upload")) {
          uploadAttempts += 1;
          const headers = new Headers(init?.headers);
          uploadEventIds.push(headers.get("x-snapshot-event-id") ?? "");
          const body = init?.body;
          capturedUpload = {
            headers,
            body:
              body instanceof Uint8Array
                ? Buffer.from(body)
                : Buffer.from(await new Response(body as BodyInit).arrayBuffer()),
          };
          if (uploadAttempts === 1) {
            return Response.json(
              { code: "SYNC_TRANSACTION_FAILED", message: "temporary transaction failure" },
              { status: 500 },
            );
          }
          return Response.json({
            snapshot_id: "snapshot-uploaded",
            r2_key: "snapshots/snapshot-uploaded",
            oplog_seq: 11,
            created_at: "2026-01-02T00:00:00Z",
          });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey,
          keyVersion: 5,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.prepare("UPDATE sync_cursor SET cursor = 10 WHERE id = 1").run();
        seedRuntimeAsset(seedDb, "snapshot-upload-asset");
        seedDb.exec(`
          INSERT INTO quotes (
            id, asset_id, day, source, close, currency, created_at, timestamp
          )
          VALUES
            (
              'manual-upload-quote', 'snapshot-upload-asset', '2026-01-01',
              'MANUAL', '42', 'USD', '2026-01-01T00:00:00+00:00',
              '2026-01-01T00:00:00+00:00'
            ),
            (
              'provider-upload-quote', 'snapshot-upload-asset', '2026-01-02',
              'YAHOO', '99', 'USD', '2026-01-02T00:00:00+00:00',
              '2026-01-02T00:00:00+00:00'
            );
        `);
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const generateResponse = await fetch(
        `${server.baseUrl}/api/v1/connect/device/generate-snapshot`,
        { method: "POST" },
      );
      expect(generateResponse.status).toBe(200);
      await expect(generateResponse.json()).resolves.toMatchObject({
        status: "uploaded",
        snapshotId: "snapshot-uploaded",
        oplogSeq: 11,
        message: "Snapshot uploaded",
      });
      expect(deviceSyncRequests).toEqual([
        "https://api.example.test/api/v1/sync/team/devices/device-runtime",
        "https://api.example.test/api/v1/sync/events/cursor",
        "https://api.example.test/api/v1/sync/snapshots/latest",
        "https://api.example.test/api/v1/sync/snapshots/upload",
        "https://api.example.test/api/v1/sync/snapshots/upload",
      ]);
      expect(uploadAttempts).toBe(2);
      expect(new Set(uploadEventIds).size).toBe(1);
      expect(capturedUpload).not.toBeNull();
      const upload = capturedUpload!;
      expect(upload.headers.get("authorization")).toBe("Bearer access-token");
      expect(upload.headers.get("x-wf-device-id")).toBe("device-runtime");
      expect(upload.headers.get("x-snapshot-schema-version")).toBe("1");
      expect(upload.headers.get("x-snapshot-covers-tables")).toBe(expectedTables.join(","));
      expect(upload.headers.get("x-snapshot-payload-key-version")).toBe("5");
      expect(upload.headers.get("x-snapshot-base-seq")).toBe("10");
      expect(upload.headers.get("x-snapshot-size-bytes")).toBe(String(upload.body.byteLength));
      expect(upload.headers.get("x-snapshot-checksum")).toBe(
        `sha256:${createHash("sha256").update(upload.body).digest("hex")}`,
      );
      const metadataCiphertext = upload.headers.get("x-snapshot-metadata-payload");
      expect(metadataCiphertext).toBeTruthy();
      const metadata = JSON.parse((await crypto.decrypt(dek, metadataCiphertext!)).value) as {
        schemaVersion: number;
        coversTables: string[];
      };
      expect(metadata).toMatchObject({
        schemaVersion: 1,
        coversTables: expectedTables,
      });
      const snapshotBase64 = (await crypto.decrypt(dek, upload.body.toString("utf8"))).value;
      const snapshotBytes = Buffer.from(snapshotBase64, "base64");
      expect(snapshotBytes.subarray(0, 16).toString("utf8")).toBe("SQLite format 3\u0000");
      const snapshotPath = path.join(appDataDir, "uploaded-snapshot.db");
      writeFileSync(snapshotPath, snapshotBytes);
      const snapshotDb = openSqliteDatabase(snapshotPath);
      try {
        expect(
          snapshotDb
            .query<
              { id: string; source: string },
              []
            >("SELECT id, source FROM quotes ORDER BY id ASC")
            .all(),
        ).toEqual([{ id: "manual-upload-quote", source: "MANUAL" }]);
      } finally {
        snapshotDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect snapshot upload cancellation into generate-snapshot retry", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-generate-cancel-"));
    const rootKey = Buffer.alloc(32, 36).toString("base64");
    const uploadEventIds: string[] = [];
    let uploadAttempts = 0;
    let server: ReturnType<typeof startBackendServer>;
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
        if (url.endsWith("/api/v1/sync/events/cursor")) {
          return Response.json({ cursor: 10 });
        }
        if (url.endsWith("/api/v1/sync/snapshots/latest")) {
          return Response.json(
            { code: "SNAPSHOT_NOT_FOUND", message: "not found" },
            { status: 404 },
          );
        }
        if (url.endsWith("/api/v1/sync/snapshots/upload")) {
          uploadAttempts += 1;
          const headers = new Headers(init?.headers);
          uploadEventIds.push(headers.get("x-snapshot-event-id") ?? "");
          await fetch(`${server.baseUrl}/api/v1/connect/device/cancel-snapshot`, {
            method: "POST",
          });
          return Response.json(
            { code: "SYNC_TRANSACTION_FAILED", message: "temporary transaction failure" },
            { status: 500 },
          );
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey,
          keyVersion: 5,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.prepare("UPDATE sync_cursor SET cursor = 10 WHERE id = 1").run();
      } finally {
        seedDb.close();
      }
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const generateResponse = await fetch(
        `${server.baseUrl}/api/v1/connect/device/generate-snapshot`,
        { method: "POST" },
      );
      expect(generateResponse.status).toBe(200);
      await expect(generateResponse.json()).resolves.toEqual({
        status: "cancelled",
        snapshotId: null,
        oplogSeq: null,
        message: "Snapshot upload cancelled during transfer",
      });
      expect(uploadAttempts).toBe(1);
      expect(uploadEventIds[0]).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime Connect snapshot cancellation during generate-snapshot preflight", async () => {
    const appDataDir = mkdtempSync(
      path.join(tmpdir(), "wealthfolio-runtime-generate-cancel-preflight-"),
    );
    const rootKey = Buffer.alloc(32, 37).toString("base64");
    const deviceSyncRequests: string[] = [];
    let server: ReturnType<typeof startBackendServer>;
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
        deviceSyncRequests.push(url);
        if (url.endsWith("/api/v1/sync/team/devices/device-runtime")) {
          await fetch(`${server.baseUrl}/api/v1/connect/device/cancel-snapshot`, {
            method: "POST",
          });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey,
          keyVersion: 5,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
      );
      const sessionResponse = await fetch(`${server.baseUrl}/api/v1/connect/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      });
      expect(sessionResponse.status).toBe(200);

      const generateResponse = await fetch(
        `${server.baseUrl}/api/v1/connect/device/generate-snapshot`,
        { method: "POST" },
      );
      expect(generateResponse.status).toBe(200);
      await expect(generateResponse.json()).resolves.toEqual({
        status: "cancelled",
        snapshotId: null,
        oplogSeq: null,
        message: "Snapshot upload cancelled before export",
      });
      expect(deviceSyncRequests).toEqual([
        "https://api.example.test/api/v1/sync/team/devices/device-runtime",
      ]);
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

  test("wires runtime device registration route", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-device-register-"));
    const deviceSyncRequests: Array<{
      url: string;
      method: string;
      body: string | null;
      authorization: string;
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
        });
        return Response.json({
          mode: "READY",
          device_id: "device-runtime",
          e2ee_key_version: 2,
          trust_state: "trusted",
        });
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

      const registerResponse = await fetch(`${server.baseUrl}/api/v1/sync/device/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: "MacBook",
          platform: "macos",
          instanceId: "instance-runtime",
          osVersion: "14.0",
          appVersion: "1.2.3",
        }),
      });
      expect(registerResponse.status).toBe(200);
      await expect(registerResponse.json()).resolves.toEqual({
        mode: "READY",
        device_id: "device-runtime",
        e2ee_key_version: 2,
        trust_state: "trusted",
      });
      expect(deviceSyncRequests).toEqual([
        {
          url: "https://api.example.test/api/v1/sync/team/devices",
          method: "POST",
          body: JSON.stringify({
            device_nonce: "instance-runtime",
            display_name: "MacBook",
            platform: "macos",
            os_version: "14.0",
            app_version: "1.2.3",
          }),
          authorization: "Bearer access-token",
        },
      ]);
      expect(await runtime.options.secretService?.getSecret("sync_device_id")).toBe(
        "device-runtime",
      );
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

  test("wires runtime issuer pairing cloud routes", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-pairing-issuer-"));
    const deviceSyncRequests: Array<{
      url: string;
      method: string;
      body: string | null;
      deviceId: string;
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
        });
        if (url.endsWith("/approve") || url.endsWith("/cancel")) {
          return Response.json({ success: true });
        }
        if (url.endsWith("/complete")) {
          return Response.json({ success: true, remote_seed_present: false });
        }
        if (init?.method === "POST") {
          return Response.json({
            pairing_id: "pairing-1",
            expires_at: "2026-01-01T00:00:00Z",
            key_version: 2,
            require_sas: true,
          });
        }
        return Response.json({
          pairing_id: "pairing-1",
          status: "open",
          claimer_device_id: null,
          claimer_ephemeral_pub: null,
          expires_at: "2026-01-01T00:00:00Z",
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

      const createResponse = await fetch(
        jsonRequest("/api/v1/sync/pairing", {
          codeHash: "hash",
          ephemeralPublicKey: "public-key",
        }),
      );
      expect(createResponse.status).toBe(200);
      await expect(createResponse.json()).resolves.toEqual({
        pairingId: "pairing-1",
        expiresAt: "2026-01-01T00:00:00Z",
        keyVersion: 2,
        requireSas: true,
      });

      const getResponse = await fetch(`${server.baseUrl}/api/v1/sync/pairing/pairing-1`);
      expect(getResponse.status).toBe(200);
      await expect(getResponse.json()).resolves.toEqual({
        pairingId: "pairing-1",
        status: "open",
        claimerDeviceId: null,
        claimerEphemeralPub: null,
        expiresAt: "2026-01-01T00:00:00Z",
      });

      const approveResponse = await fetch(
        new Request(`${server.baseUrl}/api/v1/sync/pairing/pairing-1/approve`, {
          method: "POST",
        }),
      );
      expect(approveResponse.status).toBe(200);
      await expect(approveResponse.json()).resolves.toEqual({ success: true });

      const completeResponse = await fetch(
        jsonRequest("/api/v1/sync/pairing/pairing-1/complete", {
          encryptedKeyBundle: "bundle",
          sasProof: { ok: true },
          signature: "signature",
        }),
      );
      expect(completeResponse.status).toBe(200);
      await expect(completeResponse.json()).resolves.toEqual({
        success: true,
        remoteSeedPresent: false,
      });

      const cancelResponse = await fetch(
        new Request(`${server.baseUrl}/api/v1/sync/pairing/pairing-1/cancel`, {
          method: "POST",
        }),
      );
      expect(cancelResponse.status).toBe(200);
      await expect(cancelResponse.json()).resolves.toEqual({ success: true });

      expect(deviceSyncRequests).toEqual([
        {
          url: "https://api.example.test/api/v1/sync/team/devices/device-runtime/pairings",
          method: "POST",
          body: JSON.stringify({ code_hash: "hash", ephemeral_public_key: "public-key" }),
          deviceId: "device-runtime",
        },
        {
          url: "https://api.example.test/api/v1/sync/team/devices/device-runtime/pairings/pairing-1",
          method: "GET",
          body: null,
          deviceId: "device-runtime",
        },
        {
          url: "https://api.example.test/api/v1/sync/team/devices/device-runtime/pairings/pairing-1/approve",
          method: "POST",
          body: null,
          deviceId: "device-runtime",
        },
        {
          url: "https://api.example.test/api/v1/sync/team/devices/device-runtime/pairings/pairing-1/complete",
          method: "POST",
          body: JSON.stringify({
            encrypted_key_bundle: "bundle",
            sas_proof: { ok: true },
            signature: "signature",
          }),
          deviceId: "device-runtime",
        },
        {
          url: "https://api.example.test/api/v1/sync/team/devices/device-runtime/pairings/pairing-1/cancel",
          method: "POST",
          body: null,
          deviceId: "device-runtime",
        },
      ]);
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime claimer pairing cloud routes", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-pairing-claimer-"));
    const deviceSyncRequests: Array<{
      url: string;
      method: string;
      body: string | null;
      deviceId: string;
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
        });
        if (url.endsWith("/messages")) {
          return Response.json({
            session_status: "approved",
            messages: [
              {
                id: "message-1",
                payload_type: "rk_transfer_v1",
                payload: "payload",
                created_at: "2026-01-01T00:00:00Z",
              },
            ],
          });
        }
        if (url.endsWith("/confirm")) {
          return Response.json({ success: true, key_version: 2, remote_seed_present: true });
        }
        return Response.json({
          session_id: "pairing-1",
          issuer_ephemeral_pub: "issuer-key",
          e2ee_key_version: 2,
          require_sas: true,
          expires_at: "2026-01-01T00:00:00Z",
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

      const claimResponse = await fetch(
        jsonRequest("/api/v1/sync/pairing/claim", {
          code: "123456",
          ephemeralPublicKey: "public-key",
        }),
      );
      expect(claimResponse.status).toBe(200);
      await expect(claimResponse.json()).resolves.toEqual({
        sessionId: "pairing-1",
        issuerEphemeralPub: "issuer-key",
        e2eeKeyVersion: 2,
        requireSas: true,
        expiresAt: "2026-01-01T00:00:00Z",
      });

      const messagesResponse = await fetch(
        `${server.baseUrl}/api/v1/sync/pairing/pairing-1/messages`,
      );
      expect(messagesResponse.status).toBe(200);
      await expect(messagesResponse.json()).resolves.toEqual({
        sessionStatus: "approved",
        messages: [
          {
            id: "message-1",
            payloadType: "rk_transfer_v1",
            payload: "payload",
            createdAt: "2026-01-01T00:00:00Z",
          },
        ],
      });

      const confirmResponse = await fetch(
        jsonRequest("/api/v1/sync/pairing/pairing-1/confirm", { proof: "proof" }),
      );
      const confirmBody = await confirmResponse.text();
      expect(confirmResponse.status, confirmBody).toBe(200);
      expect(JSON.parse(confirmBody)).toEqual({
        success: true,
        keyVersion: 2,
        remoteSeedPresent: true,
      });

      expect(deviceSyncRequests).toEqual([
        {
          url: "https://api.example.test/api/v1/sync/team/devices/device-runtime/pairings/claim",
          method: "POST",
          body: JSON.stringify({ code: "123456", ephemeral_public_key: "public-key" }),
          deviceId: "device-runtime",
        },
        {
          url: "https://api.example.test/api/v1/sync/team/devices/device-runtime/pairings/pairing-1/messages",
          method: "GET",
          body: null,
          deviceId: "device-runtime",
        },
        {
          url: "https://api.example.test/api/v1/sync/team/devices/device-runtime/pairings/pairing-1/confirm",
          method: "POST",
          body: JSON.stringify({ proof: "proof" }),
          deviceId: "device-runtime",
        },
      ]);
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime pairing transfer route to flush pending outbox", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-pairing-transfer-"));
    const requests: string[] = [];
    let pushKeyMismatch = false;
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
        if (url.endsWith("/api/v1/sync/team/devices/device-runtime")) {
          return Response.json({
            id: "device-runtime",
            display_name: "MacBook",
            platform: "mac",
            trust_state: "trusted",
            trusted_key_version: 2,
          });
        }
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "NOOP", cursor: 0 });
        }
        if (url.endsWith("/api/v1/sync/events/cursor")) {
          return Response.json({ cursor: 0 });
        }
        if (url.endsWith("/api/v1/sync/snapshots/latest")) {
          return Response.json({
            snapshot_id: "55555555-5555-4555-8555-555555555555",
            schema_version: 1,
            covers_tables: [],
            oplog_seq: 0,
            size_bytes: 128,
            checksum: "sha256:snapshot",
            created_at: "2026-05-14T00:00:00Z",
          });
        }
        if (url.endsWith("/api/v1/sync/events/push")) {
          if (pushKeyMismatch) {
            return Response.json(
              { code: "KEY_VERSION_MISMATCH", message: "old key" },
              { status: 400 },
            );
          }
          return Response.json({
            accepted: [{ event_id: "pending-event" }],
            duplicate: [],
            server_cursor: 0,
          });
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
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey: Buffer.alloc(32, 42).toString("base64"),
          keyVersion: 2,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
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
      expect(requests.map((request) => request.split("/").pop()).slice(0, 10)).toEqual([
        "token?grant_type=refresh_token",
        "device-runtime",
        "reconcile-ready-state",
        "token?grant_type=refresh_token",
        "device-runtime",
        "cursor",
        "latest",
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
              'pending-event', 'account', '33333333-3333-4333-8333-333333333333', 'create',
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
      expect(blockedResponse.status).toBe(200);
      await expect(blockedResponse.json()).resolves.toEqual({ success: true });
      expect(requests.map((request) => request.split("/").pop()).slice(0, 10)).toEqual([
        "token?grant_type=refresh_token",
        "device-runtime",
        "reconcile-ready-state",
        "push",
        "token?grant_type=refresh_token",
        "device-runtime",
        "cursor",
        "latest",
        "token?grant_type=refresh_token",
        "approve",
      ]);
      requests.length = 0;
      pushKeyMismatch = true;

      const blockedDb = openSqliteDatabase(runtime.dbPath);
      try {
        blockedDb
          .prepare(
            `
            INSERT INTO sync_outbox (
              event_id, entity, entity_id, op, client_timestamp, payload,
              payload_key_version, sent, status, retry_count, device_id, created_at
            )
            VALUES (
              'stale-event', 'account', '44444444-4444-4444-8444-444444444444', 'create',
              '2026-05-14T00:00:00Z', '{}', 1, 0, 'pending', 0,
              'device-runtime', '2026-05-14T00:00:00Z'
            )
          `,
          )
          .run();
      } finally {
        blockedDb.close();
      }

      const deadLetteredResponse = await fetch(
        jsonRequest("/api/v1/sync/pairing/complete-with-transfer", {
          pairingId: "pairing-1",
          encryptedKeyBundle: "bundle",
          sasProof: { ok: true },
          signature: "signature",
        }),
      );
      expect(deadLetteredResponse.status).toBe(500);
      await expect(deadLetteredResponse.json()).resolves.toMatchObject({
        code: "internal_error",
        message: "Pending sync cycle did not complete cleanly before transfer",
      });
      expect(requests.map((request) => request.split("/").pop()).slice(0, 4)).toEqual([
        "token?grant_type=refresh_token",
        "device-runtime",
        "reconcile-ready-state",
        "push",
      ]);
      requests.length = 0;
      pushKeyMismatch = false;

      const invalidEntityDb = openSqliteDatabase(runtime.dbPath);
      try {
        invalidEntityDb
          .prepare(
            `
            INSERT INTO sync_outbox (
              event_id, entity, entity_id, op, client_timestamp, payload,
              payload_key_version, sent, status, retry_count, device_id, created_at
            )
            VALUES (
              'invalid-entity-event', 'account', 'not-a-uuid', 'create',
              '2026-05-14T00:00:00Z', '{}', 2, 0, 'pending', 0,
              'device-runtime', '2026-05-14T00:00:00Z'
            )
          `,
          )
          .run();
      } finally {
        invalidEntityDb.close();
      }

      const invalidEntityResponse = await fetch(
        jsonRequest("/api/v1/sync/pairing/complete-with-transfer", {
          pairingId: "pairing-1",
          encryptedKeyBundle: "bundle",
          sasProof: { ok: true },
          signature: "signature",
        }),
      );
      expect(invalidEntityResponse.status).toBe(500);
      await expect(invalidEntityResponse.json()).resolves.toMatchObject({
        code: "internal_error",
        message: "Pending sync cycle did not complete cleanly before transfer",
      });
      expect(requests.map((request) => request.split("/").pop()).slice(0, 3)).toEqual([
        "token?grant_type=refresh_token",
        "device-runtime",
        "reconcile-ready-state",
      ]);
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime pairing transfer route to stop on non-ok cycle", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-pairing-cycle-gate-"));
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
        if (url.endsWith("/api/v1/sync/team/devices/device-runtime")) {
          return Response.json({
            id: "device-runtime",
            display_name: "MacBook",
            platform: "mac",
            trust_state: "trusted",
            trusted_key_version: 2,
          });
        }
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "WAIT_SNAPSHOT", cursor: 0 });
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
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey: Buffer.alloc(32, 42).toString("base64"),
          keyVersion: 2,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
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

      const response = await fetch(
        jsonRequest("/api/v1/sync/pairing/complete-with-transfer", {
          pairingId: "pairing-1",
          encryptedKeyBundle: "bundle",
          sasProof: { ok: true },
          signature: "signature",
        }),
      );
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toMatchObject({
        code: "internal_error",
        message: "Pending sync cycle did not complete cleanly before transfer",
      });
      expect(requests.map((request) => request.split("/").pop())).toEqual([
        "token?grant_type=refresh_token",
        "device-runtime",
        "reconcile-ready-state",
      ]);
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime pairing transfer route to upload bootstrap snapshot", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-pairing-bootstrap-"));
    const requests: string[] = [];
    let uploadAttempts = 0;
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
        if (url.endsWith("/api/v1/sync/team/devices/device-runtime")) {
          return Response.json({
            id: "device-runtime",
            display_name: "MacBook",
            platform: "mac",
            trust_state: "trusted",
            trusted_key_version: 2,
          });
        }
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "NOOP", cursor: 0 });
        }
        if (url.endsWith("/api/v1/sync/events/cursor")) {
          return Response.json({ cursor: 0 });
        }
        if (url.endsWith("/api/v1/sync/snapshots/latest")) {
          return Response.json(
            { code: "SNAPSHOT_NOT_FOUND", message: "not found" },
            { status: 404 },
          );
        }
        if (url.endsWith("/api/v1/sync/snapshots/upload")) {
          uploadAttempts += 1;
          return Response.json({
            snapshot_id: "snapshot-transfer",
            oplog_seq: 0,
            r2_key: "snapshots/snapshot-transfer",
            created_at: "2026-05-14T00:00:00Z",
          });
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
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey: Buffer.alloc(32, 42).toString("base64"),
          keyVersion: 2,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
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

      const completeResponse = await fetch(
        jsonRequest("/api/v1/sync/pairing/complete-with-transfer", {
          pairingId: "pairing-1",
          encryptedKeyBundle: "bundle",
          sasProof: { ok: true },
          signature: "signature",
        }),
      );
      expect(completeResponse.status).toBe(200);
      await expect(completeResponse.json()).resolves.toEqual({ success: true });
      expect(uploadAttempts).toBe(1);
      expect(requests.map((request) => request.split("/").pop()).slice(0, 11)).toEqual([
        "token?grant_type=refresh_token",
        "device-runtime",
        "reconcile-ready-state",
        "token?grant_type=refresh_token",
        "device-runtime",
        "cursor",
        "latest",
        "upload",
        "token?grant_type=refresh_token",
        "approve",
        "complete",
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
        if (url.endsWith("/api/v1/sync/team/devices/device-runtime")) {
          return Response.json({
            id: "device-runtime",
            display_name: "MacBook",
            platform: "mac",
            trust_state: "trusted",
            trusted_key_version: 2,
          });
        }
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "NOOP", cursor: 0 });
        }
        if (url.endsWith("/api/v1/sync/events/cursor")) {
          return Response.json({ cursor: 0 });
        }
        if (url.endsWith("/api/v1/sync/snapshots/latest")) {
          return Response.json({
            snapshot_id: "66666666-6666-4666-8666-666666666666",
            schema_version: 1,
            covers_tables: [],
            oplog_seq: 0,
            size_bytes: 128,
            checksum: "sha256:snapshot",
            created_at: "2026-05-14T00:00:00Z",
          });
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
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey: Buffer.alloc(32, 42).toString("base64"),
          keyVersion: 2,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
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
      expect(requests.map((request) => request.split("/").pop()).slice(0, 10)).toEqual([
        "token?grant_type=refresh_token",
        "device-runtime",
        "reconcile-ready-state",
        "token?grant_type=refresh_token",
        "device-runtime",
        "cursor",
        "latest",
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
        if (url.endsWith("/api/v1/sync/team/devices/device-runtime")) {
          return Response.json({
            id: "device-runtime",
            display_name: "MacBook",
            platform: "mac",
            trust_state: "trusted",
            trusted_key_version: 2,
          });
        }
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "NOOP", cursor: 0 });
        }
        if (url.endsWith("/api/v1/sync/events/cursor")) {
          return Response.json({ cursor: 0 });
        }
        if (url.endsWith("/api/v1/sync/snapshots/latest")) {
          return Response.json({
            snapshot_id: "77777777-7777-4777-8777-777777777777",
            schema_version: 1,
            covers_tables: [],
            oplog_seq: 0,
            size_bytes: 128,
            checksum: "sha256:snapshot",
            created_at: "2026-05-14T00:00:00Z",
          });
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
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey: Buffer.alloc(32, 43).toString("base64"),
          keyVersion: 2,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
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
      expect(requests.map((request) => request.split("/").pop()).slice(0, 9)).toEqual([
        "token?grant_type=refresh_token",
        "device-runtime",
        "reconcile-ready-state",
        "token?grant_type=refresh_token",
        "device-runtime",
        "cursor",
        "latest",
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
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey: Buffer.alloc(32, 43).toString("base64"),
          keyVersion: 2,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
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
        if (url.endsWith("/api/v1/sync/team/devices/device-runtime")) {
          return Response.json({
            id: "device-runtime",
            display_name: "MacBook",
            platform: "mac",
            trust_state: "trusted",
            trusted_key_version: 2,
          });
        }
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "WAIT_SNAPSHOT" });
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

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey: Buffer.alloc(32, 42).toString("base64"),
          keyVersion: 2,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
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
      const confirmBody = await confirmResponse.text();
      expect(confirmResponse.status, confirmBody).toBe(200);
      expect(JSON.parse(confirmBody)).toEqual({
        status: "waiting_snapshot",
        message: "Waiting for a trusted device to upload a snapshot",
        localRows: null,
        nonEmptyTables: null,
      });
      expect(deviceSyncRequests).toEqual(
        expect.arrayContaining([
          {
            url: "https://api.example.test/api/v1/sync/team/devices/device-runtime/pairings/pairing-wait/confirm",
            method: "POST",
            body: JSON.stringify({ proof: "proof" }),
          },
          {
            url: "https://api.example.test/api/v1/sync/team/devices/device-runtime",
            method: "GET",
            body: null,
          },
          {
            url: "https://api.example.test/api/v1/sync/events/reconcile-ready-state",
            method: "GET",
            body: null,
          },
          {
            url: "https://api.example.test/api/v1/sync/snapshots/latest",
            method: "GET",
            body: null,
          },
          {
            url: "https://api.example.test/api/v1/sync/events/reconcile-ready-state",
            method: "GET",
            body: null,
          },
        ]),
      );
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime bootstrap confirm route when no remote snapshot is required", async () => {
    const appDataDir = mkdtempSync(
      path.join(tmpdir(), "wealthfolio-runtime-bootstrap-confirm-no-remote-"),
    );
    const deviceSyncRequests: string[] = [];
    let reconcileCalls = 0;
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
        deviceSyncRequests.push(url);
        if (url.endsWith("/pairings/pairing-no-remote/confirm")) {
          return Response.json({ success: true, key_version: 5, remote_seed_present: true });
        }
        if (url.endsWith("/api/v1/sync/team/devices/device-runtime")) {
          return Response.json({
            id: "device-runtime",
            display_name: "MacBook",
            platform: "mac",
            trust_state: "trusted",
            trusted_key_version: 5,
          });
        }
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          reconcileCalls += 1;
          return Response.json({ action: reconcileCalls === 1 ? "BOOTSTRAP_SNAPSHOT" : "NOOP" });
        }
        if (url.endsWith("/api/v1/sync/snapshots/latest")) {
          return Response.json(
            { code: "SNAPSHOT_NOT_FOUND", message: "not found" },
            { status: 404 },
          );
        }
        return Response.json({
          cursor: 0,
          latest_snapshot: null,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey: Buffer.alloc(32, 41).toString("base64"),
          keyVersion: 5,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.exec(`
          INSERT INTO sync_device_config (
            device_id, key_version, trust_state, last_bootstrap_at, min_snapshot_created_at
          )
          VALUES ('device-runtime', 5, 'trusted', NULL, NULL);
        `);
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
            pairingId: "pairing-no-remote",
            proof: "proof",
            allowOverwrite: true,
          }),
        },
      );
      expect(confirmResponse.status).toBe(200);
      await expect(confirmResponse.json()).resolves.toEqual({
        status: "applied",
        message: "Snapshot bootstrap completed",
        localRows: null,
        nonEmptyTables: null,
      });
      expect(deviceSyncRequests).not.toContain(
        "https://api.example.test/api/v1/sync/snapshots/019bb9fe-f707-71e9-a40d-733575f4f246",
      );
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime bootstrap confirm route to apply available snapshot", async () => {
    const appDataDir = mkdtempSync(
      path.join(tmpdir(), "wealthfolio-runtime-bootstrap-apply-confirm-"),
    );
    const rootKey = Buffer.alloc(32, 39).toString("base64");
    const crypto = createSyncCryptoService();
    const dek = (await crypto.deriveDek(rootKey, 5)).value;
    const snapshotPath = path.join(appDataDir, "confirm-remote-snapshot.db");
    let encryptedBlob = Buffer.alloc(0);
    let checksum = "";
    const deviceSyncRequests: string[] = [];
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
        deviceSyncRequests.push(url);
        if (url.endsWith("/pairings/pairing-apply/confirm")) {
          return Response.json({ success: true, key_version: 5, remote_seed_present: true });
        }
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "BOOTSTRAP_SNAPSHOT" });
        }
        if (url.endsWith("/api/v1/sync/snapshots/latest")) {
          return Response.json({
            snapshot_id: "019bb9fe-f707-71e9-a40d-733575f4f246",
            oplog_seq: 88,
            created_at: "2026-01-02T00:00:00Z",
            schema_version: 1,
            covers_tables: ["quotes"],
            size_bytes: encryptedBlob.byteLength,
            checksum,
          });
        }
        if (url.endsWith("/api/v1/sync/snapshots/019bb9fe-f707-71e9-a40d-733575f4f246")) {
          return new Response(new Uint8Array(encryptedBlob), {
            headers: {
              "content-type": "application/octet-stream",
              "x-snapshot-schema-version": "1",
              "x-snapshot-covers-tables": "quotes",
              "x-snapshot-checksum": checksum,
            },
          });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          trusted_key_version: 5,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    copyFileSync(runtime.dbPath, snapshotPath);
    const snapshotDb = openSqliteDatabase(snapshotPath);
    try {
      seedRuntimeAsset(snapshotDb, "confirm-bootstrap-asset");
      snapshotDb.exec(`
        INSERT INTO quotes (
          id, asset_id, day, source, close, currency, created_at, timestamp
        )
        VALUES (
          'confirm-remote-manual', 'confirm-bootstrap-asset', '2026-01-02',
          'MANUAL', '456', 'USD', '2026-01-02T00:00:00+00:00',
          '2026-01-02T00:00:00+00:00'
        );
      `);
      snapshotDb.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } finally {
      snapshotDb.close();
    }
    const snapshotBytes = readFileSync(snapshotPath);
    encryptedBlob = Buffer.from(
      (await crypto.encrypt(dek, snapshotBytes.toString("base64"))).value,
      "utf8",
    );
    checksum = `sha256:${createHash("sha256").update(encryptedBlob).digest("hex")}`;
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey,
          keyVersion: 5,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedRuntimeAsset(seedDb, "confirm-bootstrap-asset");
        seedDb.exec(`
          INSERT INTO sync_device_config (
            device_id, key_version, trust_state, last_bootstrap_at, min_snapshot_created_at
          )
          VALUES ('device-runtime', 5, 'trusted', NULL, NULL);
        `);
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
            pairingId: "pairing-apply",
            proof: "proof",
            allowOverwrite: true,
          }),
        },
      );
      const confirmBody = await confirmResponse.text();
      expect(confirmResponse.status, confirmBody).toBe(200);
      expect(JSON.parse(confirmBody)).toEqual({
        status: "applied",
        message: "Snapshot bootstrap completed",
        localRows: null,
        nonEmptyTables: null,
      });
      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              { id: string; close: string },
              []
            >("SELECT id, close FROM quotes WHERE source = 'MANUAL' ORDER BY id ASC")
            .all(),
        ).toEqual([{ id: "confirm-remote-manual", close: "456" }]);
      } finally {
        verifyDb.close();
      }
      expect(deviceSyncRequests).toContain(
        "https://api.example.test/api/v1/sync/snapshots/019bb9fe-f707-71e9-a40d-733575f4f246",
      );
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime bootstrap confirm route to reject not-ready bootstrap", async () => {
    const appDataDir = mkdtempSync(
      path.join(tmpdir(), "wealthfolio-runtime-bootstrap-not-ready-confirm-"),
    );
    const deviceSyncRequests: string[] = [];
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
        deviceSyncRequests.push(url);
        if (url.endsWith("/pairings/pairing-not-ready/confirm")) {
          return Response.json({ success: true, key_version: 5, remote_seed_present: true });
        }
        if (url.endsWith("/api/v1/sync/snapshots/latest")) {
          return Response.json({
            snapshot_id: "019bb9fe-f707-71e9-a40d-733575f4f246",
            oplog_seq: 88,
            created_at: "2026-01-02T00:00:00Z",
            schema_version: 1,
            covers_tables: ["quotes"],
            size_bytes: 1,
            checksum: "sha256:not-used-before-not-ready",
          });
        }
        return Response.json({
          id: "device-runtime",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "untrusted",
          trusted_key_version: null,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey: Buffer.alloc(32, 40).toString("base64"),
          keyVersion: 5,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedDb.exec(`
          INSERT INTO sync_device_config (
            device_id, key_version, trust_state, last_bootstrap_at, min_snapshot_created_at
          )
          VALUES ('device-runtime', 5, 'trusted', NULL, NULL);
        `);
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
            pairingId: "pairing-not-ready",
            proof: "proof",
            allowOverwrite: true,
          }),
        },
      );
      expect(confirmResponse.status).toBe(500);
      await expect(confirmResponse.json()).resolves.toMatchObject({
        code: "internal_error",
        message: "Device is not in READY state",
      });
      expect(deviceSyncRequests).not.toContain(
        "https://api.example.test/api/v1/sync/snapshots/019bb9fe-f707-71e9-a40d-733575f4f246",
      );
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
        if (url.endsWith("/api/v1/sync/team/devices/device-runtime")) {
          return Response.json({
            id: "device-runtime",
            display_name: "MacBook",
            platform: "mac",
            trust_state: "trusted",
            trusted_key_version: 2,
          });
        }
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "WAIT_SNAPSHOT" });
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
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey: Buffer.alloc(32, 43).toString("base64"),
          keyVersion: 2,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
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
          url: "https://api.example.test/api/v1/sync/team/devices/device-runtime",
          method: "GET",
          body: null,
        },
        {
          url: "https://api.example.test/api/v1/sync/events/reconcile-ready-state",
          method: "GET",
          body: null,
        },
        {
          url: "https://api.example.test/api/v1/sync/snapshots/latest",
          method: "GET",
          body: null,
        },
        {
          url: "https://api.example.test/api/v1/sync/events/reconcile-ready-state",
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

  test("wires runtime pairing flow state to apply available snapshot", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-pairing-state-apply-"));
    const rootKey = Buffer.alloc(32, 46).toString("base64");
    const crypto = createSyncCryptoService();
    const dek = (await crypto.deriveDek(rootKey, 2)).value;
    const snapshotPath = path.join(appDataDir, "flow-remote-snapshot.db");
    let latestAvailable = false;
    let encryptedBlob = Buffer.alloc(0);
    let checksum = "";
    const deviceSyncRequests: string[] = [];
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
        deviceSyncRequests.push(url);
        if (url.endsWith("/pairings/pairing-apply-flow/confirm")) {
          return Response.json({ success: true, key_version: 2, remote_seed_present: true });
        }
        if (url.endsWith("/api/v1/sync/team/devices/device-runtime")) {
          return Response.json({
            id: "device-runtime",
            display_name: "MacBook",
            platform: "mac",
            trust_state: "trusted",
            trusted_key_version: 2,
          });
        }
        if (url.endsWith("/api/v1/sync/snapshots/latest")) {
          if (!latestAvailable) {
            return Response.json(
              { code: "SNAPSHOT_NOT_FOUND", message: "not found" },
              { status: 404 },
            );
          }
          return Response.json({
            snapshot_id: "019bb9fe-f707-71e9-a40d-733575f4f246",
            oplog_seq: 88,
            created_at: "2026-01-02T00:01:00Z",
            schema_version: 1,
            covers_tables: ["quotes"],
            size_bytes: encryptedBlob.byteLength,
            checksum,
          });
        }
        if (url.endsWith("/api/v1/sync/snapshots/019bb9fe-f707-71e9-a40d-733575f4f246")) {
          return new Response(new Uint8Array(encryptedBlob), {
            headers: {
              "content-type": "application/octet-stream",
              "x-snapshot-schema-version": "1",
              "x-snapshot-covers-tables": "quotes",
              "x-snapshot-checksum": checksum,
            },
          });
        }
        return Response.json({
          cursor: 0,
          latest_snapshot: null,
        });
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    copyFileSync(runtime.dbPath, snapshotPath);
    const snapshotDb = openSqliteDatabase(snapshotPath);
    try {
      seedRuntimeAsset(snapshotDb, "flow-bootstrap-asset");
      snapshotDb.exec(`
        INSERT INTO quotes (
          id, asset_id, day, source, close, currency, created_at, timestamp
        )
        VALUES (
          'flow-remote-manual', 'flow-bootstrap-asset', '2026-01-02',
          'MANUAL', '789', 'USD', '2026-01-02T00:00:00+00:00',
          '2026-01-02T00:00:00+00:00'
        );
      `);
      snapshotDb.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } finally {
      snapshotDb.close();
    }
    const snapshotBytes = readFileSync(snapshotPath);
    encryptedBlob = Buffer.from(
      (await crypto.encrypt(dek, snapshotBytes.toString("base64"))).value,
      "utf8",
    );
    checksum = `sha256:${createHash("sha256").update(encryptedBlob).digest("hex")}`;
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
          rootKey,
          keyVersion: 2,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
      );
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedRuntimeAsset(seedDb, "flow-bootstrap-asset");
        seedDb.exec(`
          INSERT INTO sync_device_config (
            device_id, key_version, trust_state, last_bootstrap_at, min_snapshot_created_at
          )
          VALUES ('device-runtime', 2, 'trusted', NULL, NULL);
        `);
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
          pairingId: "pairing-apply-flow",
          proof: "proof",
          minSnapshotCreatedAt: "2026-01-02T00:00:00Z",
        }),
      );
      const beginBody = await beginResponse.text();
      expect(beginResponse.status, beginBody).toBe(200);
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

      latestAvailable = true;
      const stateResponse = await fetch(jsonRequest("/api/v1/sync/pairing/flow/state", { flowId }));
      const stateBody = await stateResponse.text();
      expect(stateResponse.status, stateBody).toBe(200);
      expect(JSON.parse(stateBody)).toEqual({ flowId, phase: { phase: "success" } });

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              { id: string; close: string },
              []
            >("SELECT id, close FROM quotes WHERE source = 'MANUAL' ORDER BY id ASC")
            .all(),
        ).toEqual([{ id: "flow-remote-manual", close: "789" }]);
        expect(
          verifyDb
            .query<{ cursor: number }, []>("SELECT cursor FROM sync_cursor WHERE id = 1")
            .get()?.cursor,
        ).toBe(88);
        expect(
          verifyDb
            .query<
              { min_snapshot_created_at: string | null },
              []
            >("SELECT min_snapshot_created_at FROM sync_device_config WHERE device_id = 'device-runtime'")
            .get()?.min_snapshot_created_at,
        ).toBeNull();
      } finally {
        verifyDb.close();
      }
      expect(deviceSyncRequests).toContain(
        "https://api.example.test/api/v1/sync/snapshots/019bb9fe-f707-71e9-a40d-733575f4f246",
      );
      const missingStateResponse = await fetch(
        jsonRequest("/api/v1/sync/pairing/flow/state", { flowId }),
      );
      expect(missingStateResponse.status).toBe(500);
      await expect(missingStateResponse.json()).resolves.toMatchObject({
        message: "Flow not found",
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
        if (url.endsWith("/api/v1/sync/team/devices/device-runtime")) {
          return Response.json({
            id: "device-runtime",
            display_name: "MacBook",
            platform: "mac",
            trust_state: "trusted",
            trusted_key_version: 2,
          });
        }
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "WAIT_SNAPSHOT" });
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
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey: Buffer.alloc(32, 44).toString("base64"),
          keyVersion: 2,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
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
        if (url.endsWith("/api/v1/sync/team/devices/device-runtime")) {
          return Response.json({
            id: "device-runtime",
            display_name: "MacBook",
            platform: "mac",
            trust_state: "trusted",
            trusted_key_version: 2,
          });
        }
        if (url.endsWith("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "BOOTSTRAP_SNAPSHOT" });
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
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-runtime",
          deviceId: "device-runtime",
          rootKey: Buffer.alloc(32, 45).toString("base64"),
          keyVersion: 2,
          deviceSecretKey: "secret-key",
          devicePublicKey: "public-key",
        }),
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
      marketDataFetch: ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "https://fc.yahoo.com") {
          return Promise.resolve(
            new Response("", { headers: { "set-cookie": "B=route-sync; Path=/; Secure" } }),
          );
        }
        if (url === "https://query1.finance.yahoo.com/v1/test/getcrumb") {
          expect((init?.headers as Record<string, string>).Cookie).toBe("B=route-sync");
          return Promise.resolve(new Response("route-crumb"));
        }
        if (url.startsWith("https://query1.finance.yahoo.com/v8/finance/chart/ROUTE?")) {
          expect((init?.headers as Record<string, string>).Cookie).toBe("B=route-sync");
          const parsed = new URL(url);
          expect(parsed.searchParams.get("crumb")).toBe("route-crumb");
          return Promise.resolve(
            Response.json({
              chart: {
                result: [
                  {
                    meta: { currency: "USD" },
                    timestamp: [1767571200],
                    indicators: { quote: [{ close: [23.45] }] },
                  },
                ],
                error: null,
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
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedRuntimeAsset(seedDb, "runtime-market-sync-asset");
        seedDb
          .prepare(
            "UPDATE assets SET display_code = ?, instrument_symbol = ?, instrument_exchange_mic = ? WHERE id = ?",
          )
          .run("ROUTE", "ROUTE", "XNAS", "runtime-market-sync-asset");
      } finally {
        seedDb.close();
      }

      const response = await fetch(`${server.baseUrl}/api/v1/market-data/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assetIds: ["runtime-market-sync-asset"], refetchAll: false }),
      });
      expect(response.status).toBe(204);
      await waitForEventCount(events, "portfolio:update-complete", 1);
      expect(portfolioJobConfigs).toEqual([
        {
          accountIds: null,
          marketSyncMode: { type: "incremental", asset_ids: ["runtime-market-sync-asset"] },
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
      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              { asset_id: string; source: string; close: string; currency: string },
              []
            >("SELECT asset_id, source, close, currency FROM quotes WHERE asset_id = 'runtime-market-sync-asset'")
            .get(),
        ).toEqual({
          asset_id: "runtime-market-sync-asset",
          source: "YAHOO",
          close: "23.45",
          currency: "USD",
        });
      } finally {
        verifyDb.close();
      }
    } finally {
      unsubscribe?.();
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime market-data sync route to fall back from OpenFIGI to Yahoo quotes", async () => {
    const appDataDir = mkdtempSync(
      path.join(tmpdir(), "wealthfolio-runtime-openfigi-fallback-route-"),
    );
    const chartSymbols: string[] = [];
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      marketDataFetch: ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith("https://api.openfigi.com/")) {
          throw new Error(`unexpected OpenFIGI quote fetch: ${url}`);
        }
        if (url === "https://fc.yahoo.com") {
          return Promise.resolve(
            new Response("", { headers: { "set-cookie": "B=openfigi-fallback; Path=/; Secure" } }),
          );
        }
        if (url === "https://query1.finance.yahoo.com/v1/test/getcrumb") {
          expect((init?.headers as Record<string, string>).Cookie).toBe("B=openfigi-fallback");
          return Promise.resolve(new Response("openfigi-fallback-crumb"));
        }
        if (url.startsWith("https://query1.finance.yahoo.com/v8/finance/chart/AAPL?")) {
          expect((init?.headers as Record<string, string>).Cookie).toBe("B=openfigi-fallback");
          const parsed = new URL(url);
          expect(parsed.searchParams.get("crumb")).toBe("openfigi-fallback-crumb");
          chartSymbols.push("AAPL");
          return Promise.resolve(
            Response.json({
              chart: {
                result: [
                  {
                    meta: { currency: "USD" },
                    timestamp: [1767571200],
                    indicators: { quote: [{ close: [10.5] }] },
                  },
                ],
                error: null,
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
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedRuntimeAsset(seedDb, "runtime-openfigi-fallback-asset");
        seedDb
          .prepare(
            "UPDATE assets SET display_code = ?, instrument_symbol = ?, instrument_exchange_mic = ?, provider_config = ? WHERE id = ?",
          )
          .run(
            "AAPL",
            "AAPL",
            "XNAS",
            JSON.stringify({ preferred_provider: "OPENFIGI" }),
            "runtime-openfigi-fallback-asset",
          );
      } finally {
        seedDb.close();
      }

      const response = await fetch(`${server.baseUrl}/api/v1/market-data/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          assetIds: ["runtime-openfigi-fallback-asset"],
          refetchAll: false,
        }),
      });
      expect(response.status).toBe(204);
      expect(chartSymbols).toEqual(["AAPL"]);

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              { quote_source: string; close: string; currency: string; state_source: string },
              []
            >(
              `
                SELECT q.source AS quote_source, q.close, q.currency, s.data_source AS state_source
                FROM quotes q
                JOIN quote_sync_state s ON s.asset_id = q.asset_id
                WHERE q.asset_id = 'runtime-openfigi-fallback-asset'
              `,
            )
            .get(),
        ).toEqual({
          quote_source: "YAHOO",
          close: "10.5",
          currency: "USD",
          state_source: "YAHOO",
        });
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime market-data sync route to custom provider quotes", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-custom-sync-route-"));
    const requests: string[] = [];
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      marketDataFetch: ((input: RequestInfo | URL) => {
        const url = String(input);
        requests.push(url);
        if (url !== "https://prices.example.test/latest/FUND.TO") {
          throw new Error(`unexpected market data fetch: ${url}`);
        }
        return Promise.resolve(
          Response.json({
            price: 27.5,
            date: "2026-06-29",
            currency: "CAD",
          }),
        );
      }) as typeof fetch,
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
              INSERT INTO market_data_custom_providers (
                id, code, name, description, enabled, priority, config, created_at, updated_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
          )
          .run(
            "runtime-custom-provider-id",
            "my-feed",
            "My Feed",
            "Runtime custom feed",
            1,
            7,
            JSON.stringify({
              sources: [
                {
                  kind: "latest",
                  format: "json",
                  url: "https://prices.example.test/latest/{SYMBOL}",
                  pricePath: "$.price",
                  datePath: "$.date",
                  currencyPath: "$.currency",
                },
              ],
            }),
            "2026-05-14T00:00:00Z",
            "2026-05-14T00:00:00Z",
          );
        seedRuntimeAsset(seedDb, "runtime-custom-sync-asset");
        seedDb
          .prepare(
            "UPDATE assets SET display_code = ?, quote_ccy = ?, instrument_symbol = ?, instrument_exchange_mic = ?, provider_config = ? WHERE id = ?",
          )
          .run(
            "FUND",
            "CAD",
            "FUND",
            "XTSE",
            JSON.stringify({
              preferred_provider: "CUSTOM_SCRAPER",
              custom_provider_code: "my-feed",
              overrides: {
                "CUSTOM:my-feed": { type: "equity_symbol", symbol: "FUND.TO" },
              },
            }),
            "runtime-custom-sync-asset",
          );
      } finally {
        seedDb.close();
      }

      const response = await fetch(`${server.baseUrl}/api/v1/market-data/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assetIds: ["runtime-custom-sync-asset"], refetchAll: false }),
      });
      expect(response.status).toBe(204);
      expect(requests).toEqual(["https://prices.example.test/latest/FUND.TO"]);

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              { id: string; source: string; close: string; currency: string; data_source: string },
              []
            >(
              `
                SELECT q.id, q.source, q.close, q.currency, s.data_source
                FROM quotes q
                JOIN quote_sync_state s ON s.asset_id = q.asset_id
                WHERE q.asset_id = 'runtime-custom-sync-asset'
              `,
            )
            .get(),
        ).toEqual({
          id: "runtime-custom-sync-asset_2026-06-29_CUSTOM_SCRAPER:my-feed",
          source: "CUSTOM_SCRAPER:my-feed",
          close: "27.5",
          currency: "CAD",
          data_source: "CUSTOM_SCRAPER:my-feed",
        });
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime market-data sync route to MarketData.app provider quotes", async () => {
    const appDataDir = mkdtempSync(
      path.join(tmpdir(), "wealthfolio-runtime-marketdata-app-route-"),
    );
    const calls: string[] = [];
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      marketDataFetch: ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (!url.startsWith("https://api.marketdata.app/v1/")) {
          throw new Error(`unexpected market data fetch: ${url}`);
        }
        const headers = init?.headers as Record<string, string> | undefined;
        expect(headers?.Authorization).toBe("Bearer test-key");
        calls.push(url);
        const parsed = new URL(url);
        if (parsed.pathname === "/v1/stocks/candles/D/AAPL") {
          return Promise.resolve(
            Response.json({
              s: "ok",
              t: [1767571200],
              c: [10.5],
            }),
          );
        }
        if (parsed.pathname === "/v1/stocks/prices/AAPL/") {
          return Promise.resolve(
            Response.json({
              s: "ok",
              mid: [11.25],
              updated: [1767657600],
            }),
          );
        }
        throw new Error(`unexpected MarketData.app path: ${parsed.pathname}`);
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret("MARKETDATA_APP", "test-key");
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedRuntimeAsset(seedDb, "runtime-marketdata-app-asset");
        seedDb
          .prepare(
            "UPDATE assets SET display_code = ?, instrument_symbol = ?, instrument_exchange_mic = ?, provider_config = ? WHERE id = ?",
          )
          .run(
            "AAPL",
            "WRONG",
            "XNAS",
            JSON.stringify({
              preferred_provider: "MARKETDATA_APP",
              overrides: { MARKETDATA_APP: { symbol: "AAPL" } },
            }),
            "runtime-marketdata-app-asset",
          );
      } finally {
        seedDb.close();
      }

      const response = await fetch(`${server.baseUrl}/api/v1/market-data/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assetIds: ["runtime-marketdata-app-asset"], refetchAll: false }),
      });
      expect(response.status).toBe(204);
      expect(calls.map((url) => new URL(url).pathname)).toEqual([
        "/v1/stocks/candles/D/AAPL",
        "/v1/stocks/prices/AAPL/",
      ]);

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              { day: string; source: string; close: string; currency: string },
              []
            >("SELECT day, source, close, currency FROM quotes WHERE asset_id = 'runtime-marketdata-app-asset' ORDER BY day ASC")
            .all(),
        ).toEqual([
          { day: "2026-01-05", source: "MARKETDATA_APP", close: "10.5", currency: "USD" },
          { day: "2026-01-06", source: "MARKETDATA_APP", close: "11.25", currency: "USD" },
        ]);
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime market-data sync route to Finnhub provider quotes", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-finnhub-route-"));
    const calls: string[] = [];
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      marketDataFetch: ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (!url.startsWith("https://finnhub.io/api/v1/")) {
          throw new Error(`unexpected market data fetch: ${url}`);
        }
        const headers = init?.headers as Record<string, string> | undefined;
        expect(headers?.["X-Finnhub-Token"]).toBe("finnhub-key");
        calls.push(url);
        const parsed = new URL(url);
        expect(parsed.pathname).toBe("/api/v1/stock/candle");
        expect(parsed.searchParams.get("symbol")).toBe("AAPL");
        expect(parsed.searchParams.get("resolution")).toBe("D");
        return Promise.resolve(
          Response.json({
            s: "ok",
            t: [1767571200],
            o: [10],
            h: [12],
            l: [9],
            c: [11],
            v: [123456],
          }),
        );
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret("FINNHUB", "finnhub-key");
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedRuntimeAsset(seedDb, "runtime-finnhub-asset");
        seedDb
          .prepare(
            "UPDATE assets SET display_code = ?, instrument_symbol = ?, instrument_exchange_mic = ?, provider_config = ? WHERE id = ?",
          )
          .run(
            "AAPL",
            "WRONG",
            "XNAS",
            JSON.stringify({
              preferred_provider: "FINNHUB",
              overrides: { FINNHUB: { symbol: "AAPL" } },
            }),
            "runtime-finnhub-asset",
          );
      } finally {
        seedDb.close();
      }

      const response = await fetch(`${server.baseUrl}/api/v1/market-data/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assetIds: ["runtime-finnhub-asset"], refetchAll: false }),
      });
      expect(response.status).toBe(204);
      expect(calls).toHaveLength(1);

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              {
                source: string;
                open: string | null;
                high: string | null;
                low: string | null;
                close: string;
                volume: string | null;
                currency: string;
              },
              []
            >(
              "SELECT source, open, high, low, close, volume, currency FROM quotes WHERE asset_id = 'runtime-finnhub-asset'",
            )
            .get(),
        ).toEqual({
          source: "FINNHUB",
          open: "10",
          high: "12",
          low: "9",
          close: "11",
          volume: "123456",
          currency: "USD",
        });
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime market-data sync route to Alpha Vantage provider quotes", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-alpha-route-"));
    const calls: string[] = [];
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      marketDataFetch: ((input: RequestInfo | URL, init?: RequestInit) => {
        expect(init).toBeUndefined();
        const url = String(input);
        if (!url.startsWith("https://www.alphavantage.co/query")) {
          throw new Error(`unexpected market data fetch: ${url}`);
        }
        const parsed = new URL(url);
        expect(parsed.searchParams.get("apikey")).toBe("alpha-key");
        expect(parsed.searchParams.get("function")).toBe("TIME_SERIES_DAILY");
        expect(parsed.searchParams.get("outputsize")).toBe("compact");
        calls.push(parsed.searchParams.get("symbol") ?? "");
        return Promise.resolve(
          Response.json({
            "Time Series (Daily)": {
              "2026-06-29": {
                "1. open": "10",
                "2. high": "12",
                "3. low": "9",
                "4. close": "11",
                "5. volume": "123456",
              },
            },
          }),
        );
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret("ALPHA_VANTAGE", "alpha-key");
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedRuntimeAsset(seedDb, "runtime-alpha-asset");
        seedDb
          .prepare(
            "UPDATE assets SET display_code = ?, quote_ccy = ?, instrument_symbol = ?, instrument_exchange_mic = ?, provider_config = ? WHERE id = ?",
          )
          .run(
            "AAPL",
            "USD",
            "AAPL",
            "XTSE",
            JSON.stringify({ preferred_provider: "ALPHA_VANTAGE" }),
            "runtime-alpha-asset",
          );
      } finally {
        seedDb.close();
      }

      const response = await fetch(`${server.baseUrl}/api/v1/market-data/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assetIds: ["runtime-alpha-asset"], refetchAll: false }),
      });
      expect(response.status).toBe(204);
      expect(calls).toEqual(["AAPL.TRT"]);

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              {
                source: string;
                open: string | null;
                high: string | null;
                low: string | null;
                close: string;
                volume: string | null;
                currency: string;
              },
              []
            >(
              "SELECT source, open, high, low, close, volume, currency FROM quotes WHERE asset_id = 'runtime-alpha-asset'",
            )
            .get(),
        ).toEqual({
          source: "ALPHA_VANTAGE",
          open: "10",
          high: "12",
          low: "9",
          close: "11",
          volume: "123456",
          currency: "CAD",
        });
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime market-data sync route to Alpha Vantage FX and crypto quotes", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-alpha-pairs-route-"));
    const calls: string[] = [];
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      marketDataFetch: ((input: RequestInfo | URL, init?: RequestInit) => {
        expect(init).toBeUndefined();
        const url = String(input);
        if (!url.startsWith("https://www.alphavantage.co/query")) {
          throw new Error(`unexpected market data fetch: ${url}`);
        }
        const parsed = new URL(url);
        expect(parsed.searchParams.get("apikey")).toBe("alpha-key");
        const fn = parsed.searchParams.get("function");
        if (fn === "FX_DAILY") {
          expect(parsed.searchParams.get("from_symbol")).toBe("EUR");
          expect(parsed.searchParams.get("to_symbol")).toBe("USD");
          expect(parsed.searchParams.get("outputsize")).toBe("full");
          calls.push("FX_DAILY:EUR:USD:full");
          return Promise.resolve(
            Response.json({
              "Time Series FX (Daily)": {
                "2026-06-29": {
                  "1. open": "1.1",
                  "2. high": "1.3",
                  "3. low": "1.0",
                  "4. close": "1.2",
                },
              },
            }),
          );
        }
        if (fn === "DIGITAL_CURRENCY_DAILY") {
          expect(parsed.searchParams.get("symbol")).toBe("BTC");
          expect(parsed.searchParams.get("market")).toBe("CAD");
          expect(parsed.searchParams.has("outputsize")).toBe(false);
          calls.push("DIGITAL_CURRENCY_DAILY:BTC:CAD");
          return Promise.resolve(
            Response.json({
              "Time Series (Digital Currency Daily)": {
                "2026-06-29": {
                  "1a. open (CAD)": "140",
                  "1b. open (USD)": "100",
                  "2a. high (CAD)": "168",
                  "2b. high (USD)": "120",
                  "3a. low (CAD)": "126",
                  "3b. low (USD)": "90",
                  "4a. close (CAD)": "154",
                  "4b. close (USD)": "110",
                  "5. volume": "7",
                },
              },
            }),
          );
        }
        throw new Error(`unexpected Alpha Vantage function: ${fn ?? ""}`);
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret("ALPHA_VANTAGE", "alpha-key");
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedRuntimeAsset(seedDb, "runtime-alpha-fx-asset");
        seedDb
          .prepare(
            "UPDATE assets SET kind = ?, display_code = ?, quote_ccy = ?, instrument_type = ?, instrument_symbol = ?, provider_config = ? WHERE id = ?",
          )
          .run(
            "FX",
            "EUR/USD",
            "USD",
            "FX",
            "EUR",
            JSON.stringify({
              preferred_provider: "ALPHA_VANTAGE",
              overrides: { ALPHA_VANTAGE: { type: "fx_pair", from: "EUR", to: "USD" } },
            }),
            "runtime-alpha-fx-asset",
          );
        seedRuntimeAsset(seedDb, "runtime-alpha-crypto-asset");
        seedDb
          .prepare(
            "UPDATE assets SET display_code = ?, quote_ccy = ?, instrument_type = ?, instrument_symbol = ?, provider_config = ? WHERE id = ?",
          )
          .run(
            "BTC-CAD",
            "CAD",
            "CRYPTO",
            "BTC",
            JSON.stringify({
              preferred_provider: "ALPHA_VANTAGE",
              overrides: { ALPHA_VANTAGE: { type: "crypto_pair", symbol: "BTC", market: "CAD" } },
            }),
            "runtime-alpha-crypto-asset",
          );
      } finally {
        seedDb.close();
      }

      const response = await fetch(`${server.baseUrl}/api/v1/market-data/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          assetIds: ["runtime-alpha-fx-asset", "runtime-alpha-crypto-asset"],
          refetchAll: false,
        }),
      });
      expect(response.status).toBe(204);
      expect([...calls].sort()).toEqual([
        "DIGITAL_CURRENCY_DAILY:BTC:CAD",
        "FX_DAILY:EUR:USD:full",
      ]);

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              {
                asset_id: string;
                source: string;
                open: string | null;
                high: string | null;
                low: string | null;
                close: string;
                volume: string | null;
                currency: string;
              },
              []
            >(
              "SELECT asset_id, source, open, high, low, close, volume, currency FROM quotes WHERE asset_id IN ('runtime-alpha-fx-asset', 'runtime-alpha-crypto-asset') ORDER BY asset_id",
            )
            .all(),
        ).toEqual([
          {
            asset_id: "runtime-alpha-crypto-asset",
            source: "ALPHA_VANTAGE",
            open: "140",
            high: "168",
            low: "126",
            close: "154",
            volume: "7",
            currency: "CAD",
          },
          {
            asset_id: "runtime-alpha-fx-asset",
            source: "ALPHA_VANTAGE",
            open: "1.1",
            high: "1.3",
            low: "1.0",
            close: "1.2",
            volume: null,
            currency: "USD",
          },
        ]);
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime market-data sync route to Boerse Frankfurt quotes", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-boerse-route-"));
    const calls: string[] = [];
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      marketDataFetch: ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (!url.startsWith("https://api.live.deutsche-boerse.com/v1/")) {
          throw new Error(`unexpected market data fetch: ${url}`);
        }
        expect((init?.headers as Record<string, string>)["User-Agent"]).toContain(
          "Chrome/131.0.0.0",
        );
        calls.push(url);
        const parsed = new URL(url);
        if (parsed.pathname === "/v1/tradingview/search") {
          expect(parsed.searchParams.get("query")).toBe("SAP");
          expect(parsed.searchParams.get("limit")).toBe("5");
          return Promise.resolve(
            Response.json([
              {
                symbol: "XETR:DE0007164600",
                description: "SAP SE",
                exchange: "Xetra",
                type: "Aktie",
              },
            ]),
          );
        }
        if (parsed.pathname === "/v1/tradingview/history") {
          expect(parsed.searchParams.get("symbol")).toBe("XETR:DE0007164600");
          expect(parsed.searchParams.get("resolution")).toBe("1D");
          return Promise.resolve(
            Response.json({
              s: "ok",
              t: [1782691200],
              o: [69.5],
              h: [71],
              l: [68.75],
              c: [70.02],
              v: [98765],
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
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedRuntimeAsset(seedDb, "runtime-boerse-asset");
        seedDb
          .prepare(
            "UPDATE assets SET display_code = ?, quote_ccy = ?, instrument_symbol = ?, instrument_exchange_mic = ?, provider_config = ? WHERE id = ?",
          )
          .run(
            "SAP",
            "EUR",
            "SAP",
            "XETR",
            JSON.stringify({ preferred_provider: "BOERSE_FRANKFURT" }),
            "runtime-boerse-asset",
          );
      } finally {
        seedDb.close();
      }

      const response = await fetch(`${server.baseUrl}/api/v1/market-data/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assetIds: ["runtime-boerse-asset"], refetchAll: false }),
      });
      expect(response.status).toBe(204);
      expect(calls.map((url) => new URL(url).pathname)).toEqual([
        "/v1/tradingview/search",
        "/v1/tradingview/history",
      ]);

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              {
                source: string;
                open: string | null;
                high: string | null;
                low: string | null;
                close: string;
                volume: string | null;
                currency: string;
              },
              []
            >(
              "SELECT source, open, high, low, close, volume, currency FROM quotes WHERE asset_id = 'runtime-boerse-asset'",
            )
            .get(),
        ).toEqual({
          source: "BOERSE_FRANKFURT",
          open: "69.5",
          high: "71",
          low: "68.75",
          close: "70.02",
          volume: "98765",
          currency: "EUR",
        });
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime market-data sync route to Metal Price API quotes", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-metal-route-"));
    const calls: string[] = [];
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      marketDataFetch: ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (!url.startsWith("https://api.metalpriceapi.com/v1/")) {
          throw new Error(`unexpected market data fetch: ${url}`);
        }
        const headers = init?.headers as Record<string, string> | undefined;
        expect(headers?.["X-API-KEY"]).toBe("metal-key");
        const parsed = new URL(url);
        expect(parsed.pathname).toBe("/v1/timeframe");
        expect(parsed.searchParams.get("base")).toBe("USD");
        expect(parsed.searchParams.get("currencies")).toBe("XAU");
        calls.push(
          `${parsed.searchParams.get("start_date") ?? ""}:${parsed.searchParams.get("end_date") ?? ""}`,
        );
        return Promise.resolve(
          Response.json({
            success: true,
            rates: {
              "2026-01-05": { XAU: 0.0005 },
            },
          }),
        );
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret("METAL_PRICE_API", "metal-key");
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedRuntimeAsset(seedDb, "runtime-metal-asset");
        seedDb
          .prepare(
            "UPDATE assets SET display_code = ?, instrument_type = ?, instrument_symbol = ?, instrument_exchange_mic = NULL, provider_config = ? WHERE id = ?",
          )
          .run(
            "XAU",
            "METAL",
            "XAU",
            JSON.stringify({ preferred_provider: "METAL_PRICE_API" }),
            "runtime-metal-asset",
          );
      } finally {
        seedDb.close();
      }

      const response = await fetch(`${server.baseUrl}/api/v1/market-data/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assetIds: ["runtime-metal-asset"], refetchAll: false }),
      });
      expect(response.status).toBe(204);
      expect(calls).toHaveLength(1);

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        expect(
          verifyDb
            .query<
              { source: string; close: string; currency: string },
              []
            >("SELECT source, close, currency FROM quotes WHERE asset_id = 'runtime-metal-asset'")
            .get(),
        ).toEqual({
          source: "METAL_PRICE_API",
          close: "2000",
          currency: "USD",
        });
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime market-data sync route to US Treasury calculated bond quotes", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-treasury-route-"));
    const years: string[] = [];
    const treasuryXml = `<feed>
      <entry><content><m:properties>
        <d:NEW_DATE>2026-06-29T00:00:00</d:NEW_DATE>
        <d:BC_1YEAR>4</d:BC_1YEAR>
        <d:BC_2YEAR>4</d:BC_2YEAR>
        <d:BC_5YEAR>4</d:BC_5YEAR>
        <d:BC_10YEAR>4</d:BC_10YEAR>
      </m:properties></content></entry>
      <entry><content><m:properties>
        <d:NEW_DATE>2026-06-30T00:00:00</d:NEW_DATE>
        <d:BC_1YEAR>4.1</d:BC_1YEAR>
        <d:BC_2YEAR>4.1</d:BC_2YEAR>
        <d:BC_5YEAR>4.1</d:BC_5YEAR>
        <d:BC_10YEAR>4.1</d:BC_10YEAR>
      </m:properties></content></entry>
    </feed>`;
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      marketDataFetch: ((input: RequestInfo | URL) => {
        const url = String(input);
        if (
          !url.startsWith(
            "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml",
          )
        ) {
          throw new Error(`unexpected market data fetch: ${url}`);
        }
        const parsed = new URL(url);
        expect(parsed.searchParams.get("data")).toBe("daily_treasury_yield_curve");
        years.push(parsed.searchParams.get("field_tdr_date_value") ?? "");
        return Promise.resolve(new Response(treasuryXml));
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      const seedDb = openSqliteDatabase(runtime.dbPath);
      try {
        seedRuntimeAsset(seedDb, "runtime-treasury-bond");
        seedDb
          .prepare(
            "UPDATE assets SET display_code = ?, quote_ccy = ?, instrument_type = ?, instrument_symbol = ?, provider_config = ?, metadata = ? WHERE id = ?",
          )
          .run(
            "T 5%",
            "USD",
            "BOND",
            "US912810TH12",
            JSON.stringify({ preferred_provider: "US_TREASURY_CALC" }),
            JSON.stringify({
              bond: {
                maturityDate: "2031-06-30",
                couponRate: 0.05,
                faceValue: 1000,
                couponFrequency: "SEMI_ANNUAL",
              },
            }),
            "runtime-treasury-bond",
          );
      } finally {
        seedDb.close();
      }

      const response = await fetch(`${server.baseUrl}/api/v1/market-data/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          assetIds: ["runtime-treasury-bond"],
          refetchAll: false,
          refetchRecentDays: 2,
        }),
      });
      expect(response.status).toBe(204);
      expect(years).toEqual(["2026"]);

      const verifyDb = openSqliteDatabase(runtime.dbPath);
      try {
        const quotes = verifyDb
          .query<
            { day: string; source: string; close: string; currency: string },
            []
          >("SELECT day, source, close, currency FROM quotes WHERE asset_id = 'runtime-treasury-bond' ORDER BY day ASC")
          .all();
        expect(quotes).toHaveLength(1);
        expect(quotes.map((quote) => quote.source)).toEqual(["US_TREASURY_CALC"]);
        expect(quotes.every((quote) => quote.currency === "USD")).toBe(true);
        expect(quotes.every((quote) => Number(quote.close) > 0)).toBe(true);
      } finally {
        verifyDb.close();
      }
    } finally {
      server.stop();
      await runtime.close();
    }
  });

  test("wires runtime quote resolution route to Alpha Vantage option quotes", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-alpha-option-route-"));
    const calls: string[] = [];
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      marketDataFetch: ((input: RequestInfo | URL, init?: RequestInit) => {
        expect(init).toBeUndefined();
        const url = String(input);
        if (!url.startsWith("https://www.alphavantage.co/query")) {
          throw new Error(`unexpected market data fetch: ${url}`);
        }
        const parsed = new URL(url);
        expect(parsed.searchParams.get("apikey")).toBe("alpha-key");
        expect(parsed.searchParams.get("function")).toBe("REALTIME_OPTIONS");
        const call = `${parsed.searchParams.get("symbol")}:${parsed.searchParams.get("contract")}`;
        calls.push(call);
        return Promise.resolve(
          Response.json({
            data: [
              {
                contractID: "AAPL260117C00100000",
                last: "12.34",
                mark: "12.30",
                volume: "42",
                date: "2026-01-05",
              },
            ],
          }),
        );
      }) as typeof fetch,
      repositoryRoot,
      secretKey: config.secretKey,
    });
    const server = startBackendServer(config, runtime.options);

    try {
      await runtime.options.secretService?.setSecret("ALPHA_VANTAGE", "alpha-key");

      const response = await fetch(
        `${server.baseUrl}/api/v1/market-data/resolve-currency?symbol=AAPL260117C00100000&instrumentType=OPTION&quoteCcy=USD&providerId=ALPHA_VANTAGE`,
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        currency: "USD",
        price: 12.34,
        resolvedProviderId: "ALPHA_VANTAGE",
      });
      expect(calls).toEqual(["AAPL:AAPL260117C00100000"]);
    } finally {
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
        expect(JSON.parse(String(assignmentRows[1]?.payload))).toMatchObject({
          id: assignment.id,
          asset_id: "runtime-taxonomy-asset",
          taxonomy_id: taxonomy.id,
          category_id: category.id,
        });
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

async function waitForCondition(condition: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(condition()).toBe(true);
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
