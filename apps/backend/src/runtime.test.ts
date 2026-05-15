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

      const holdingsResponse = await fetch(`${server.baseUrl}/api/v1/holdings?accountId=missing`);
      expect(holdingsResponse.status).toBe(501);
      await expect(holdingsResponse.json()).resolves.toMatchObject({
        code: "not_implemented",
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
      } finally {
        server.stop();
      }
    } finally {
      runtime.close();
    }
  });
});

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
