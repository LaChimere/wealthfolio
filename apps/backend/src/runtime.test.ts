import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import type { BackendRuntimeConfig } from "./config";
import {
  createSqliteBackedBackendServices,
  resolveBackendAppDataDir,
  resolveBackendMigrationsDir,
} from "./runtime";
import { startBackendServer } from "./server";
import { openSqliteDatabase } from "./storage/sqlite";

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

  test("starts a TS server with SQLite-backed low-risk services", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      marketDataFetch: ((input: RequestInfo | URL) => {
        expect([
          "https://query2.finance.yahoo.com/v1/finance/search?q=SHOP",
          "https://query1.finance.yahoo.com/v1/finance/search?q=SHOP",
        ]).toContain(String(input));
        return Promise.resolve(Response.json({ quotes: [] }));
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
          body: JSON.stringify({ itemType: "symbol", itemId: "SPY" }),
        },
      );
      expect(symbolPerformanceHistoryResponse.status).toBe(501);
      await expect(symbolPerformanceHistoryResponse.json()).resolves.toMatchObject({
        code: "not_implemented",
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
      expect(aiStreamResponse.status).toBe(501);
      await expect(aiStreamResponse.json()).resolves.toMatchObject({
        code: "not_implemented",
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

      const healthDeferredFixResponse = await fetch(`${server.baseUrl}/api/v1/health/fix`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "sync_prices", label: "Sync Prices", payload: [] }),
      });
      expect(healthDeferredFixResponse.status).toBe(404);

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
      await expect(assetsResponse.json()).resolves.toEqual([
        expect.objectContaining({
          id: alternativeAsset.assetId,
          kind: "PROPERTY",
          quoteMode: "MANUAL",
          exchangeName: null,
        }),
      ]);

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
      runtime.close();
    }

    expect(() => runtime.close()).not.toThrow();
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
      runtime.close();
    }
  });

  test("persists runtime direct asset sync callbacks to sync_outbox", () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-asset-sync-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
    });

    try {
      const { assetService } = runtime.options;
      const created = assetService.createAsset({
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
      } finally {
        db.close();
      }
    } finally {
      runtime.close();
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
      runtime.close();
    }
  });

  test("persists runtime market-data UUID manual quote deletes to sync_outbox", () => {
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
      runtime.close();
    }
  });

  test("persists runtime AI chat sync callbacks to sync_outbox", () => {
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
      runtime.close();
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
      runtime.close();
    }
  });

  test("persists runtime holdings snapshot sync callbacks to sync_outbox", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-snapshot-sync-"));
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
          ["snapshot", "create"],
          ["snapshot", "create"],
          ["snapshot", "delete"],
        ]);
        expect(JSON.parse(String(rows[0]?.payload))).toMatchObject({
          account_id: "account-1",
          snapshot_date: "2026-04-02",
          source: "MANUAL_ENTRY",
          net_contribution_base: "0",
          cash_total_account_currency: "0",
          cash_total_base_currency: "0",
        });
        expect(JSON.parse(String(rows[1]?.payload))).toMatchObject({
          account_id: "account-1",
          snapshot_date: "2026-01-02",
          source: "SYNTHETIC",
        });
        expect(JSON.parse(String(rows[2]?.payload))).toEqual({ id: rows[0]?.entity_id });
      } finally {
        db.close();
      }
    } finally {
      runtime.close();
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
      runtime.close();
    }
  });

  test("persists runtime contribution-limit sync callbacks to sync_outbox", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-limit-sync-"));
    const runtime = createSqliteBackedBackendServices({
      appDataDir,
      repositoryRoot,
      secretKey: config.secretKey,
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
      } finally {
        db.close();
      }
    } finally {
      runtime.close();
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
      runtime.close();
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
      runtime.close();
    }
  });

  test("fails startup explicitly when TS runtime keyring secrets are requested", () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-runtime-keyring-"));

    expect(() =>
      createSqliteBackedBackendServices({
        appDataDir,
        env: { WF_SECRET_BACKEND: "keyring" },
        repositoryRoot,
        secretKey: config.secretKey,
      }),
    ).toThrow("WF_SECRET_BACKEND=keyring is not yet available in the TS backend runtime");
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
      runtime.close();
    }
  });
});

function readRuntimeSyncOutbox(
  db: ReturnType<typeof openSqliteDatabase>,
): Array<Record<string, unknown>> {
  return db.query<Record<string, unknown>, []>("SELECT * FROM sync_outbox ORDER BY rowid").all();
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
