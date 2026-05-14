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

      const accountsResponse = await fetch(`${server.baseUrl}/api/v1/accounts`);
      expect(accountsResponse.status).toBe(200);
      await expect(accountsResponse.json()).resolves.toEqual([]);

      const aiProvidersResponse = await fetch(`${server.baseUrl}/api/v1/ai/providers`);
      expect(aiProvidersResponse.status).toBe(200);
      await expect(aiProvidersResponse.json()).resolves.toMatchObject({
        capabilities: { tools: { name: "Tools" } },
        providers: expect.arrayContaining([expect.objectContaining({ id: "ollama" })]),
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
});
