import { copyFileSync, cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";

import type { BackendRuntimeConfig } from "./config";
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
} from "./domain-events/planner";

const repositoryRoot = path.resolve(import.meta.dir, "../../..");
const config: BackendRuntimeConfig = {
  listen: { host: "127.0.0.1", port: 0 },
  cors: { allowOrigins: ["*"] },
  requestTimeoutMs: 1_000,
  secretKey: new Uint8Array(32),
};

describe("TS backend runtime composition", () => {
  test("resolves runtime data and migration roots from explicit options and env", () => {
    expect(resolveBackendAppDataDir({}, "/tmp/app-data")).toBe("/tmp/app-data");
    expect(resolveBackendAppDataDir({ WF_APP_DATA_DIR: "/tmp/env-data" })).toBe("/tmp/env-data");
    expect(resolveBackendAppDataDir({ WF_DB_PATH: "/tmp/custom-db/app.db" })).toBe(
      "/tmp/custom-db",
    );
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
      expect(runtime.options.appUtilityService?.getAppInfo()).toMatchObject({ version: "9.8.7" });
    } finally {
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

  test("wires local Connect runtime behavior with disabled cloud routes", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-connect-disabled-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
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

    try {
      const jsonHeaders = { "content-type": "application/json" };
      for (const request of [
        new Request(`${server.baseUrl}/api/v1/connect/session`, {
          method: "POST",
          headers: jsonHeaders,
          body: JSON.stringify({ refreshToken: "refresh-token" }),
        }),
        new Request(`${server.baseUrl}/api/v1/connect/session`, { method: "DELETE" }),
        new Request(`${server.baseUrl}/api/v1/connect/session/status`),
        new Request(`${server.baseUrl}/api/v1/connect/session/restore`),
        new Request(`${server.baseUrl}/api/v1/connect/connections`),
        new Request(`${server.baseUrl}/api/v1/connect/accounts`),
        new Request(`${server.baseUrl}/api/v1/connect/sync/connections`, { method: "POST" }),
        new Request(`${server.baseUrl}/api/v1/connect/sync/accounts`, { method: "POST" }),
        new Request(`${server.baseUrl}/api/v1/connect/sync/activities`, { method: "POST" }),
        new Request(`${server.baseUrl}/api/v1/connect/plans`),
        new Request(`${server.baseUrl}/api/v1/connect/plans/public`),
        new Request(`${server.baseUrl}/api/v1/connect/user`),
      ]) {
        const response = await fetch(request);
        expect(response.status).toBe(501);
      }

      const syncResponse = await fetch(`${server.baseUrl}/api/v1/connect/sync`, {
        method: "POST",
      });
      expect(syncResponse.status).toBe(501);

      const syncedAccountsResponse = await fetch(
        `${server.baseUrl}/api/v1/connect/synced-accounts`,
      );
      expect(syncedAccountsResponse.status).toBe(200);
      await expect(syncedAccountsResponse.json()).resolves.toEqual([
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
      ]);

      const platformsResponse = await fetch(`${server.baseUrl}/api/v1/connect/platforms`);
      expect(platformsResponse.status).toBe(200);
      await expect(platformsResponse.json()).resolves.toEqual([
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
      expect(emptyRunTypeImportRunsResponse.status).toBe(200);
      await expect(emptyRunTypeImportRunsResponse.json()).resolves.toEqual([]);

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

      for (const request of [
        new Request(`${server.baseUrl}/api/v1/connect/device/sync-state`),
        new Request(`${server.baseUrl}/api/v1/connect/device/enable`, { method: "POST" }),
        new Request(`${server.baseUrl}/api/v1/connect/device/sync-data`, { method: "DELETE" }),
        new Request(`${server.baseUrl}/api/v1/connect/device/reinitialize`, { method: "POST" }),
        new Request(`${server.baseUrl}/api/v1/connect/device/engine-status`),
        new Request(`${server.baseUrl}/api/v1/connect/device/pairing-source-status`),
        new Request(`${server.baseUrl}/api/v1/connect/device/bootstrap-overwrite-check`),
        jsonRequest("/api/v1/connect/device/reconcile-ready-state", { allowOverwrite: false }),
        new Request(`${server.baseUrl}/api/v1/connect/device/bootstrap-snapshot`, {
          method: "POST",
        }),
        new Request(`${server.baseUrl}/api/v1/connect/device/trigger-cycle`, { method: "POST" }),
        new Request(`${server.baseUrl}/api/v1/connect/device/start-background`, {
          method: "POST",
        }),
        new Request(`${server.baseUrl}/api/v1/connect/device/stop-background`, { method: "POST" }),
        new Request(`${server.baseUrl}/api/v1/connect/device/generate-snapshot`, {
          method: "POST",
        }),
        new Request(`${server.baseUrl}/api/v1/connect/device/cancel-snapshot`, { method: "POST" }),
        jsonRequest("/api/v1/sync/device/register", {
          displayName: "MacBook",
          platform: "macos",
          instanceId: "instance-1",
        }),
        new Request(`${server.baseUrl}/api/v1/sync/device/current`),
        new Request(`${server.baseUrl}/api/v1/sync/devices?scope=team`),
        new Request(`${server.baseUrl}/api/v1/sync/device/device-1`),
        new Request(`${server.baseUrl}/api/v1/sync/device/device-1`, {
          method: "PATCH",
          headers: jsonHeaders,
          body: JSON.stringify({ displayName: "Renamed" }),
        }),
        new Request(`${server.baseUrl}/api/v1/sync/device/device-1`, { method: "DELETE" }),
        new Request(`${server.baseUrl}/api/v1/sync/device/device-1/revoke`, { method: "POST" }),
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
        jsonRequest("/api/v1/sync/pairing", {
          codeHash: "hash",
          ephemeralPublicKey: "public-key",
        }),
        jsonRequest("/api/v1/sync/pairing/claim", {
          code: "123456",
          ephemeralPublicKey: "public-key",
        }),
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
        jsonRequest("/api/v1/sync/pairing/flow/state", { flowId: "flow-1" }),
        jsonRequest("/api/v1/sync/pairing/flow/approve-overwrite", { flowId: "flow-1" }),
        jsonRequest("/api/v1/sync/pairing/flow/cancel", { flowId: "flow-1" }),
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
        expect(response.status).toBe(501);
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

  test("persists runtime account sync callbacks to sync_outbox", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-account-sync-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });

    try {
      const { accountService } = runtime.options;
      const created = await accountService.createAccount({
        name: "Brokerage",
        accountType: "SECURITIES",
        group: "Investing",
        currency: "CAD",
        isDefault: true,
        isActive: true,
        trackingMode: "TRANSACTIONS",
        accountNumber: "123",
        meta: '{"source":"broker"}',
        provider: "SNAPTRADE",
        providerAccountId: "provider-account-1",
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
          meta: '{"source":"broker"}',
          provider: "SNAPTRADE",
          provider_account_id: "provider-account-1",
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
          meta: '{"source":"broker"}',
          provider: "SNAPTRADE",
          provider_account_id: "provider-account-1",
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
