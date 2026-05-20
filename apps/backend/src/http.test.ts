import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";

import type { BackendRuntimeConfig } from "./config";
import { createAccountRepository, createAccountService } from "./domains/accounts";
import type { ActivityService } from "./domains/activities";
import type { AddonService } from "./domains/addons";
import type { AiChatService } from "./domains/ai-chat";
import type { AiProviderService } from "./domains/ai-providers";
import type { AlternativeAssetService } from "./domains/alternative-assets";
import type { AppUtilityService } from "./domains/app-utilities";
import type { AssetService } from "./domains/assets";
import type {
  ConnectDeviceSyncService,
  ConnectService,
  ConnectSyncBrokerDataStatus,
} from "./domains/connect";
import {
  createContributionLimitRepository,
  createContributionLimitService,
} from "./domains/contribution-limits";
import {
  createCustomProviderRepository,
  createCustomProviderService,
} from "./domains/custom-providers";
import type { DeviceSyncService } from "./domains/device-sync";
import { createExchangeRateRepository, createExchangeRateService } from "./domains/exchange-rates";
import { createGoalRepository, createGoalService } from "./domains/goals";
import { createHealthRepository, createHealthService, type HealthService } from "./domains/health";
import type { HoldingsService } from "./domains/holdings";
import type { MarketDataService } from "./domains/market-data";
import {
  createMarketDataProviderRepository,
  createMarketDataProviderService,
} from "./domains/market-data-providers";
import type { PortfolioJobConfig } from "./domains/portfolio-jobs";
import type { PortfolioMetricsService } from "./domains/portfolio-metrics";
import type { SecretService } from "./domains/secrets";
import { createSettingsService } from "./domains/settings";
import type { SyncCryptoService } from "./domains/sync-crypto";
import {
  createTaxonomyRepository,
  createTaxonomyService,
  type TaxonomyService,
} from "./domains/taxonomies";
import { createEventBus } from "./events";
import { createBackendRequestHandler, runWithRequestTimeout } from "./http";
import { sidecarTokenAuthorized } from "./sidecar-auth";

const config: BackendRuntimeConfig = {
  listen: { host: "127.0.0.1", port: 0 },
  cors: { allowOrigins: ["http://localhost:1420"] },
  requestTimeoutMs: 1_000,
  secretKey: new Uint8Array(32),
  sidecarToken: "sidecar-token",
};

describe("TS backend HTTP skeleton", () => {
  test("serves health, readiness, and auth status shapes", async () => {
    const handler = createBackendRequestHandler({ ...config, authPasswordHash: "hash" });

    await expect(
      (await handler(new Request("http://127.0.0.1/api/v1/healthz"))).text(),
    ).resolves.toBe("ok");
    await expect(
      (await handler(new Request("http://127.0.0.1/api/v1/readyz"))).text(),
    ).resolves.toBe("ok");
    await expect(
      (await handler(new Request("http://127.0.0.1/api/v1/auth/status"))).json(),
    ).resolves.toEqual({ requiresPassword: true });
  });

  test("returns restart-required while database restore is still settling", async () => {
    let restartRequired = false;
    let releaseRestore: () => void = () => {};
    const restoreBlocked = new Promise<void>((resolve) => {
      releaseRestore = resolve;
    });
    const appUtilityService: AppUtilityService = {
      getAppInfo() {
        return { version: "1.0.0", dbPath: "/tmp/wealthfolio.db", logsDir: "/tmp/logs" };
      },
      checkUpdate() {
        return {
          updateAvailable: false,
          latestVersion: "1.0.0",
          notes: null,
          pubDate: null,
          downloadUrl: null,
          changelogUrl: null,
          screenshots: null,
        };
      },
      backupDatabase() {
        return { filename: "wealthfolio_backup.db", dataB64: "" };
      },
      backupDatabaseToPath() {
        return { path: "/tmp/wealthfolio_backup.db" };
      },
      async restoreDatabase() {
        restartRequired = true;
        await restoreBlocked;
      },
    };
    const handler = createBackendRequestHandler(config, {
      appUtilityService,
      restartRequired: () => restartRequired,
    });

    const restorePromise = handler(
      new Request("http://127.0.0.1/api/v1/utilities/database/restore", {
        method: "POST",
        headers: {
          authorization: "Bearer sidecar-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ backupFilePath: "/tmp/backup.db" }),
      }),
    );
    for (let attempt = 0; attempt < 10 && !restartRequired; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(restartRequired).toBe(true);
    expect((await handler(new Request("http://127.0.0.1/api/v1/readyz"))).status).toBe(503);
    expect((await handler(new Request("http://127.0.0.1/api/v1/auth/status"))).status).toBe(503);

    releaseRestore();
    expect((await restorePromise).status).toBe(204);
  });

  test("enforces sidecar bearer token on guarded debug routes", async () => {
    const handler = createBackendRequestHandler(config, { includeDebugRoutes: true });
    const handlerWithoutToken = createBackendRequestHandler(
      {
        ...config,
        sidecarToken: undefined,
      },
      { includeDebugRoutes: true },
    );
    const protectedUrl = "http://127.0.0.1/api/v1/__ts-backend/protected-ping";

    expect((await handlerWithoutToken(new Request(protectedUrl))).status).toBe(401);
    expect((await handler(new Request(protectedUrl))).status).toBe(401);
    expect(
      (
        await handler(
          new Request(protectedUrl, {
            headers: { authorization: "Bearer wrong-token" },
          }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await handler(
          new Request(protectedUrl, {
            headers: { authorization: "Bearer sidecar-token" },
          }),
        )
      ).status,
    ).toBe(200);
  });

  test("matches sidecar bearer token case-insensitively without accepting partial tokens", () => {
    expect(
      sidecarTokenAuthorized(
        new Headers({ authorization: "bearer sidecar-token" }),
        "sidecar-token",
      ),
    ).toBe(true);
    expect(
      sidecarTokenAuthorized(new Headers({ authorization: "Bearer sidecar" }), "sidecar-token"),
    ).toBe(false);
  });

  test("applies explicit CORS origins and credentials", async () => {
    const handler = createBackendRequestHandler(config);
    const response = await handler(
      new Request("http://127.0.0.1/api/v1/healthz", {
        headers: { origin: "http://localhost:1420" },
      }),
    );

    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:1420");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
  });

  test("returns timeout response when a handler exceeds the configured budget", async () => {
    const response = await runWithRequestTimeout(async () => {
      await Bun.sleep(20);
      return new Response("late");
    }, 1);

    expect(response.status).toBe(408);
    await expect(response.json()).resolves.toEqual({ code: 408, message: "Request timeout" });
  });

  test("routes migrated settings domain only when a service is provided", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE app_settings (
        setting_key TEXT NOT NULL PRIMARY KEY,
        setting_value TEXT NOT NULL
      );
    `);
    const handler = createBackendRequestHandler(config, {
      settingsService: createSettingsService(db),
    });

    try {
      expect((await handler(new Request("http://127.0.0.1/api/v1/settings"))).status).toBe(401);
      const updateResponse = await handler(
        new Request("http://127.0.0.1/api/v1/settings", {
          method: "PUT",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({ theme: "dark", timezone: "America/Toronto" }),
        }),
      );
      const updatedSettings = await updateResponse.json();

      expect(updateResponse.status).toBe(200);
      expect(updatedSettings).toMatchObject({
        theme: "dark",
        timezone: "America/Toronto",
      });
      await expect(
        (
          await handler(
            new Request("http://127.0.0.1/api/v1/settings/auto-update-enabled", {
              headers: { authorization: "Bearer sidecar-token" },
            }),
          )
        ).json(),
      ).resolves.toBe(true);
    } finally {
      db.close();
    }
  });

  test("routes migrated accounts domain only when a service is provided", async () => {
    const db = createAccountsDb();
    const handler = createBackendRequestHandler(config, {
      accountService: createAccountService(createAccountRepository(db)),
    });

    try {
      expect((await handler(new Request("http://127.0.0.1/api/v1/accounts"))).status).toBe(401);

      const createResponse = await handler(
        new Request("http://127.0.0.1/api/v1/accounts", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: "Brokerage",
            accountType: "SECURITIES",
            currency: "USD",
            isDefault: false,
            isActive: true,
          }),
        }),
      );
      const createdAccount = await createResponse.json();
      expect(createResponse.status).toBe(200);
      expect(createdAccount).toMatchObject({
        name: "Brokerage",
        currency: "USD",
        isArchived: false,
        trackingMode: "NOT_SET",
      });

      const updateResponse = await handler(
        new Request(`http://127.0.0.1/api/v1/accounts/${createdAccount.id}`, {
          method: "PUT",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: "Brokerage Archived",
            accountType: "SECURITIES",
            currency: "CAD",
            isDefault: false,
            isActive: false,
            isArchived: true,
            trackingMode: "HOLDINGS",
          }),
        }),
      );
      const updatedAccount = await updateResponse.json();
      expect(updateResponse.status).toBe(200);
      expect(updatedAccount).toMatchObject({
        id: createdAccount.id,
        name: "Brokerage Archived",
        currency: "USD",
        isArchived: true,
        trackingMode: "HOLDINGS",
      });

      const listResponse = await handler(
        new Request("http://127.0.0.1/api/v1/accounts", {
          headers: { authorization: "Bearer sidecar-token" },
        }),
      );
      expect(await listResponse.json()).toEqual([]);

      const includeArchivedResponse = await handler(
        new Request("http://127.0.0.1/api/v1/accounts?includeArchived=true", {
          headers: { authorization: "Bearer sidecar-token" },
        }),
      );
      expect(await includeArchivedResponse.json()).toHaveLength(1);

      const deleteResponse = await handler(
        new Request(`http://127.0.0.1/api/v1/accounts/${createdAccount.id}`, {
          method: "DELETE",
          headers: { authorization: "Bearer sidecar-token" },
        }),
      );
      expect(deleteResponse.status).toBe(204);
    } finally {
      db.close();
    }
  });

  test("routes migrated addons seam only when a service is provided", async () => {
    const calls: Array<[string, unknown]> = [];
    const addonService: AddonService = {
      listInstalledAddons() {
        calls.push(["list-installed", undefined]);
        return [{ id: "addon-1" }];
      },
      installAddonZip(request) {
        calls.push([
          "install-zip",
          { zipData: Array.from(request.zipData), enableAfterInstall: request.enableAfterInstall },
        ]);
        return { id: "installed" };
      },
      toggleAddon(addonId, enabled) {
        calls.push(["toggle", { addonId, enabled }]);
      },
      uninstallAddon(addonId) {
        calls.push(["uninstall", addonId]);
      },
      loadAddonForRuntime(addonId) {
        calls.push(["runtime", addonId]);
        return { id: addonId, files: [] };
      },
      getEnabledAddonsOnStartup() {
        calls.push(["enabled-on-startup", undefined]);
        return [{ id: "enabled" }];
      },
      extractAddonZip(request) {
        calls.push(["extract", Array.from(request.zipData)]);
        return { manifest: { id: "extracted" } };
      },
      fetchStoreListings() {
        calls.push(["store-listings", undefined]);
        return [{ id: "store-addon" }];
      },
      submitRating(request) {
        calls.push(["submit-rating", request]);
        return { ok: true };
      },
      checkAddonUpdate(addonId) {
        calls.push(["check-update", addonId]);
        return { addonId, updateAvailable: false };
      },
      checkAllAddonUpdates() {
        calls.push(["check-all", undefined]);
        return [];
      },
      updateAddonFromStore(addonId) {
        calls.push(["store-update", addonId]);
        return { id: addonId };
      },
      downloadAddonToStaging(addonId) {
        calls.push(["staging-download", addonId]);
        return { id: addonId };
      },
      installAddonFromStaging(request) {
        calls.push(["staging-install", request]);
        return { id: request.addonId };
      },
      clearAddonStaging(addonId) {
        calls.push(["staging-clear", addonId]);
      },
    };
    const handler = createBackendRequestHandler(config, { addonService });
    const authHeaders = { authorization: "Bearer sidecar-token" };
    const jsonHeaders = { ...authHeaders, "content-type": "application/json" };

    expect((await handler(new Request("http://127.0.0.1/api/v1/addons/installed"))).status).toBe(
      401,
    );
    expect(
      (
        await createBackendRequestHandler(config)(
          new Request("http://127.0.0.1/api/v1/addons/installed", { headers: authHeaders }),
        )
      ).status,
    ).toBe(404);

    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/addons/installed", { headers: authHeaders }),
        )
      ).json(),
    ).resolves.toEqual([{ id: "addon-1" }]);

    await handler(
      new Request("http://127.0.0.1/api/v1/addons/install-zip", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ zipData: [9], zipDataB64: "AQID", enableAfterInstall: null }),
      }),
    );
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/addons/install-zip", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ zipData: [9], zipDataB64: "not-base64" }),
          }),
        )
      ).status,
    ).toBe(500);
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/addons/install-zip", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ zipData: [256] }),
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/addons/install-zip", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ enableAfterInstall: false }),
          }),
        )
      ).status,
    ).toBe(500);

    const toggleResponse = await handler(
      new Request("http://127.0.0.1/api/v1/addons/toggle", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ addonId: "addon-1", enabled: false }),
      }),
    );
    expect(toggleResponse.status).toBe(204);

    await handler(
      new Request("http://127.0.0.1/api/v1/addons/runtime/addon%2Fid", {
        headers: authHeaders,
      }),
    );
    await handler(
      new Request("http://127.0.0.1/api/v1/addons/enabled-on-startup", {
        headers: authHeaders,
      }),
    );
    await handler(
      new Request("http://127.0.0.1/api/v1/addons/extract", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ zipData: [4, 5], enableAfterInstall: false }),
      }),
    );
    await handler(
      new Request("http://127.0.0.1/api/v1/addons/store/listings", {
        headers: authHeaders,
      }),
    );
    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/addons/store/ratings?addonId=addon-1", {
            headers: authHeaders,
          }),
        )
      ).json(),
    ).resolves.toEqual([]);
    await handler(
      new Request("http://127.0.0.1/api/v1/addons/store/ratings", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ addonId: "addon-1", rating: 255, review: null }),
      }),
    );
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/addons/store/ratings", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ addonId: "addon-1", rating: 256 }),
          }),
        )
      ).status,
    ).toBe(400);
    await handler(
      new Request("http://127.0.0.1/api/v1/addons/store/check-update", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ addonId: "addon-1" }),
      }),
    );
    await handler(
      new Request("http://127.0.0.1/api/v1/addons/store/check-all", {
        method: "POST",
        headers: authHeaders,
        body: "not json",
      }),
    );
    await handler(
      new Request("http://127.0.0.1/api/v1/addons/store/update", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ addonId: "addon-1" }),
      }),
    );
    await handler(
      new Request("http://127.0.0.1/api/v1/addons/store/staging/download", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ addonId: "addon-1" }),
      }),
    );
    await handler(
      new Request("http://127.0.0.1/api/v1/addons/store/install-from-staging", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ addonId: "addon-1", enableAfterInstall: null }),
      }),
    );
    const clearResponse = await handler(
      new Request("http://127.0.0.1/api/v1/addons/store/staging?addonId=", {
        method: "DELETE",
        headers: authHeaders,
      }),
    );
    expect(clearResponse.status).toBe(204);
    const uninstallResponse = await handler(
      new Request("http://127.0.0.1/api/v1/addons/addon%20id", {
        method: "DELETE",
        headers: authHeaders,
      }),
    );
    expect(uninstallResponse.status).toBe(204);

    expect(calls).toEqual([
      ["list-installed", undefined],
      ["install-zip", { zipData: [1, 2, 3], enableAfterInstall: true }],
      ["toggle", { addonId: "addon-1", enabled: false }],
      ["runtime", "addon/id"],
      ["enabled-on-startup", undefined],
      ["extract", [4, 5]],
      ["store-listings", undefined],
      ["submit-rating", { addonId: "addon-1", rating: 255 }],
      ["check-update", "addon-1"],
      ["check-all", undefined],
      ["store-update", "addon-1"],
      ["staging-download", "addon-1"],
      ["staging-install", { addonId: "addon-1", enableAfterInstall: true }],
      ["staging-clear", ""],
      ["uninstall", "addon id"],
    ]);
  });

  test("routes migrated activities seam only when a service is provided", async () => {
    const calls: Array<[string, unknown]> = [];
    const activityService: ActivityService = {
      searchActivities(request) {
        calls.push(["search", request]);
        return { activities: [], page: request.page };
      },
      createActivity(activity) {
        calls.push(["create", activity]);
        return { ...activity, id: "activity-1" };
      },
      updateActivity(activity) {
        calls.push(["update", activity]);
        return activity;
      },
      bulkMutateActivities(request) {
        calls.push(["bulk", request]);
        return { success: true };
      },
      deleteActivity(id) {
        calls.push(["delete", id]);
        return { id };
      },
      linkTransferActivities(activityAId, activityBId) {
        calls.push(["link", { activityAId, activityBId }]);
        return [{ id: activityAId }, { id: activityBId }];
      },
      unlinkTransferActivities(activityAId, activityBId) {
        calls.push(["unlink", { activityAId, activityBId }]);
        return [{ id: activityAId }, { id: activityBId }];
      },
      checkActivitiesImport(activities) {
        calls.push(["check-import", activities]);
        return activities;
      },
      previewImportAssets(candidates) {
        calls.push(["preview-assets", candidates]);
        return candidates;
      },
      importActivities(activities) {
        calls.push(["import", activities]);
        return { imported: activities.length };
      },
      parseCsv(request) {
        calls.push(["parse-csv", { content: Array.from(request.content), config: request.config }]);
        return { rows: [] };
      },
      getImportMapping(accountId, contextKind) {
        calls.push(["get-mapping", { accountId, contextKind }]);
        return { accountId, contextKind };
      },
      saveImportMapping(mapping) {
        calls.push(["save-mapping", mapping]);
        return mapping;
      },
      listImportTemplates() {
        calls.push(["list-templates", undefined]);
        return [{ id: "template-1" }];
      },
      getImportTemplate(id) {
        calls.push(["get-template", id]);
        return { id };
      },
      saveImportTemplate(template) {
        calls.push(["save-template", template]);
        return template;
      },
      deleteImportTemplate(id) {
        calls.push(["delete-template", id]);
      },
      linkAccountTemplate(accountId, templateId, contextKind) {
        calls.push(["link-template", { accountId, templateId, contextKind }]);
      },
      checkExistingDuplicates(idempotencyKeys) {
        calls.push(["duplicates", idempotencyKeys]);
        return { [idempotencyKeys[0] ?? ""]: "activity-1" };
      },
    };
    const handler = createBackendRequestHandler(config, { activityService });
    const authHeaders = { authorization: "Bearer sidecar-token" };
    const jsonHeaders = { ...authHeaders, "content-type": "application/json" };

    expect((await handler(new Request("http://127.0.0.1/api/v1/activities/search"))).status).toBe(
      401,
    );
    expect(
      (
        await createBackendRequestHandler(config)(
          new Request("http://127.0.0.1/api/v1/activities/search", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ page: 0, pageSize: 25 }),
          }),
        )
      ).status,
    ).toBe(404);

    const searchResponse = await handler(
      new Request("http://127.0.0.1/api/v1/activities/search", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          page: 0,
          pageSize: 25,
          accountIdFilter: "account-1",
          activityTypeFilter: ["BUY"],
          instrumentTypeFilter: "EQUITY",
          assetIdKeyword: "AAPL",
          needsReviewFilter: true,
          dateFrom: "2024-01-01",
          dateTo: "2024-12-31",
          sort: [
            { id: "activityDate", desc: true },
            { id: "ignored", desc: false },
          ],
        }),
      }),
    );
    expect(searchResponse.status).toBe(200);

    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/activities/search", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ page: "0", pageSize: 25 }),
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/activities/search", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ page: 0, pageSize: 25, dateFrom: "01/01/2024" }),
          }),
        )
      ).status,
    ).toBe(400);

    await handler(
      new Request("http://127.0.0.1/api/v1/activities", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ id: "activity-1", type: "BUY" }),
      }),
    );
    await handler(
      new Request("http://127.0.0.1/api/v1/activities", {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({ id: "activity-1", type: "SELL" }),
      }),
    );
    await handler(
      new Request("http://127.0.0.1/api/v1/activities/bulk", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ create: [{ id: "activity-2" }] }),
      }),
    );
    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/activities/link", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ activityAId: "activity-1", activityBId: "activity-2" }),
          }),
        )
      ).json(),
    ).resolves.toEqual([{ id: "activity-1" }, { id: "activity-2" }]);
    await handler(
      new Request("http://127.0.0.1/api/v1/activities/unlink", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ activityAId: "activity-1", activityBId: "activity-2" }),
      }),
    );
    await handler(
      new Request("http://127.0.0.1/api/v1/activities/activity%2F1", {
        method: "DELETE",
        headers: authHeaders,
      }),
    );

    await handler(
      new Request("http://127.0.0.1/api/v1/activities/import/check", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ activities: [{ id: "activity-3" }] }),
      }),
    );
    await handler(
      new Request("http://127.0.0.1/api/v1/activities/import/assets/preview", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ candidates: [{ symbol: "AAPL" }] }),
      }),
    );
    await handler(
      new Request("http://127.0.0.1/api/v1/activities/import", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ activities: [{ id: "activity-4" }] }),
      }),
    );
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/activities/import", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ activities: {} }),
          }),
        )
      ).status,
    ).toBe(400);

    const formData = new FormData();
    formData.append("ignored", "value");
    formData.append("file", new Blob([Uint8Array.from([65, 66])]), "activities.csv");
    formData.append("config", JSON.stringify({ delimiter: "," }));
    await handler(
      new Request("http://127.0.0.1/api/v1/activities/import/parse", {
        method: "POST",
        headers: authHeaders,
        body: formData,
      }),
    );
    const missingFileForm = new FormData();
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/activities/import/parse", {
            method: "POST",
            headers: authHeaders,
            body: missingFileForm,
          }),
        )
      ).status,
    ).toBe(400);
    const invalidConfigForm = new FormData();
    invalidConfigForm.append("file", new Blob([Uint8Array.from([65])]), "activities.csv");
    invalidConfigForm.append("config", "not json");
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/activities/import/parse", {
            method: "POST",
            headers: authHeaders,
            body: invalidConfigForm,
          }),
        )
      ).status,
    ).toBe(400);

    await handler(
      new Request(
        "http://127.0.0.1/api/v1/activities/import/mapping?accountId=account-1&contextKind=",
        { headers: authHeaders },
      ),
    );
    await handler(
      new Request("http://127.0.0.1/api/v1/activities/import/mapping?accountId=account-2", {
        headers: authHeaders,
      }),
    );
    await handler(
      new Request("http://127.0.0.1/api/v1/activities/import/mapping", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ mapping: { accountId: "account-1" } }),
      }),
    );
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/activities/import/mapping", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ accountId: "account-1" }),
          }),
        )
      ).status,
    ).toBe(400);

    await handler(
      new Request("http://127.0.0.1/api/v1/activities/import/templates", {
        headers: authHeaders,
      }),
    );
    await handler(
      new Request("http://127.0.0.1/api/v1/activities/import/templates/item?id=template-1", {
        headers: authHeaders,
      }),
    );
    await handler(
      new Request("http://127.0.0.1/api/v1/activities/import/templates", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ template: { id: "template-1" } }),
      }),
    );
    await handler(
      new Request("http://127.0.0.1/api/v1/activities/import/templates/link", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ accountId: "account-1", templateId: "template-1" }),
      }),
    );
    const deleteTemplateResponse = await handler(
      new Request("http://127.0.0.1/api/v1/activities/import/templates?id=template-1", {
        method: "DELETE",
        headers: authHeaders,
      }),
    );
    expect(deleteTemplateResponse.status).toBe(200);
    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/activities/import/check-duplicates", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ idempotencyKeys: ["key-1"] }),
          }),
        )
      ).json(),
    ).resolves.toEqual({ duplicates: { "key-1": "activity-1" } });

    expect(calls).toEqual([
      [
        "search",
        {
          page: 0,
          pageSize: 25,
          accountIds: ["account-1"],
          activityTypes: ["BUY"],
          instrumentTypes: ["EQUITY"],
          assetIdKeyword: "AAPL",
          sort: { id: "activityDate", desc: true },
          needsReview: true,
          dateFrom: "2024-01-01",
          dateTo: "2024-12-31",
        },
      ],
      ["create", { id: "activity-1", type: "BUY" }],
      ["update", { id: "activity-1", type: "SELL" }],
      ["bulk", { create: [{ id: "activity-2" }] }],
      ["link", { activityAId: "activity-1", activityBId: "activity-2" }],
      ["unlink", { activityAId: "activity-1", activityBId: "activity-2" }],
      ["delete", "activity/1"],
      ["check-import", [{ id: "activity-3" }]],
      ["preview-assets", [{ symbol: "AAPL" }]],
      ["import", [{ id: "activity-4" }]],
      ["parse-csv", { content: [65, 66], config: { delimiter: "," } }],
      ["get-mapping", { accountId: "account-1", contextKind: "" }],
      ["get-mapping", { accountId: "account-2", contextKind: "ACTIVITY" }],
      ["save-mapping", { accountId: "account-1" }],
      ["list-templates", undefined],
      ["get-template", "template-1"],
      ["save-template", { id: "template-1" }],
      [
        "link-template",
        { accountId: "account-1", templateId: "template-1", contextKind: "ACTIVITY" },
      ],
      ["delete-template", "template-1"],
      ["duplicates", ["key-1"]],
    ]);
  });

  test("routes migrated contribution limits domain only when a service is provided", async () => {
    const db = createContributionLimitsDb();
    const notifications: string[] = [];
    const handler = createBackendRequestHandler(config, {
      contributionLimitService: createContributionLimitService(
        createContributionLimitRepository(db),
        {
          baseCurrency: "CAD",
          notifyPortfolioUpdate: () => notifications.push("updated"),
        },
      ),
    });

    try {
      expect((await handler(new Request("http://127.0.0.1/api/v1/limits"))).status).toBe(401);

      const createResponse = await handler(
        new Request("http://127.0.0.1/api/v1/limits", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            groupName: "TFSA",
            contributionYear: 2026,
            limitAmount: 7_000,
            accountIds: "account-1",
          }),
        }),
      );
      const createdLimit = await createResponse.json();
      expect(createResponse.status).toBe(200);
      expect(createdLimit).toMatchObject({
        groupName: "TFSA",
        contributionYear: 2026,
        limitAmount: 7_000,
        accountIds: "account-1",
      });

      const updateResponse = await handler(
        new Request(`http://127.0.0.1/api/v1/limits/${createdLimit.id}`, {
          method: "PUT",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            groupName: "TFSA",
            contributionYear: 2027,
            limitAmount: 7_500,
          }),
        }),
      );
      const updatedLimit = await updateResponse.json();
      expect(updateResponse.status).toBe(200);
      expect(updatedLimit).toMatchObject({
        id: createdLimit.id,
        contributionYear: 2027,
        limitAmount: 7_500,
        accountIds: null,
      });

      const depositsResponse = await handler(
        new Request(`http://127.0.0.1/api/v1/limits/${createdLimit.id}/deposits`, {
          headers: { authorization: "Bearer sidecar-token" },
        }),
      );
      await expect(depositsResponse.json()).resolves.toEqual({
        total: 0,
        baseCurrency: "CAD",
        byAccount: {},
      });

      const listResponse = await handler(
        new Request("http://127.0.0.1/api/v1/limits", {
          headers: { authorization: "Bearer sidecar-token" },
        }),
      );
      expect(await listResponse.json()).toHaveLength(1);

      const deleteResponse = await handler(
        new Request(`http://127.0.0.1/api/v1/limits/${createdLimit.id}`, {
          method: "DELETE",
          headers: { authorization: "Bearer sidecar-token" },
        }),
      );
      expect(deleteResponse.status).toBe(204);
      expect(notifications).toEqual(["updated", "updated", "updated"]);
    } finally {
      db.close();
    }
  });

  test("routes migrated taxonomy read domain only when a service is provided", async () => {
    const db = createTaxonomiesDb();
    const handler = createBackendRequestHandler(config, {
      taxonomyService: createTaxonomyService(createTaxonomyRepository(db)),
    });

    try {
      expect((await handler(new Request("http://127.0.0.1/api/v1/taxonomies"))).status).toBe(401);

      db.prepare(
        `
          INSERT INTO taxonomies (
            id, name, color, is_system, is_single_select, sort_order
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `,
      ).run("strategy", "Strategy", "#4385be", 0, 1, 10);
      db.prepare(
        `
          INSERT INTO taxonomy_categories (
            id, taxonomy_id, name, key, color, sort_order
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `,
      ).run("growth", "strategy", "Growth", "growth", "#4385be", 1);

      const listResponse = await handler(
        new Request("http://127.0.0.1/api/v1/taxonomies", {
          headers: { authorization: "Bearer sidecar-token" },
        }),
      );
      expect(await listResponse.json()).toEqual([
        expect.objectContaining({ id: "strategy", isSingleSelect: true }),
      ]);

      const detailResponse = await handler(
        new Request("http://127.0.0.1/api/v1/taxonomies/strategy", {
          headers: { authorization: "Bearer sidecar-token" },
        }),
      );
      await expect(detailResponse.json()).resolves.toEqual({
        taxonomy: expect.objectContaining({ id: "strategy" }),
        categories: [expect.objectContaining({ id: "growth", taxonomyId: "strategy" })],
      });
    } finally {
      db.close();
    }
  });

  test("routes migrated taxonomy and category mutations only when a service is provided", async () => {
    const db = createTaxonomiesDb();
    const handler = createBackendRequestHandler(config, {
      taxonomyService: createTaxonomyService(createTaxonomyRepository(db)),
    });

    try {
      const createTaxonomyResponse = await handler(
        new Request("http://127.0.0.1/api/v1/taxonomies", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            id: "strategy",
            name: "Strategy",
            color: "#4385be",
            description: null,
            isSystem: false,
            isSingleSelect: true,
            sortOrder: 10,
          }),
        }),
      );
      const createdTaxonomy = await createTaxonomyResponse.json();
      expect(createTaxonomyResponse.status).toBe(200);
      expect(createdTaxonomy).toMatchObject({ id: "strategy", isSingleSelect: true });

      const updateTaxonomyResponse = await handler(
        new Request("http://127.0.0.1/api/v1/taxonomies", {
          method: "PUT",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            ...createdTaxonomy,
            name: "Strategies",
            isSingleSelect: false,
          }),
        }),
      );
      expect(await updateTaxonomyResponse.json()).toMatchObject({
        id: "strategy",
        name: "Strategies",
        isSingleSelect: false,
      });

      const createCategoryResponse = await handler(
        new Request("http://127.0.0.1/api/v1/taxonomies/categories", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            id: "growth",
            taxonomyId: "strategy",
            name: "Growth",
            key: "growth",
            color: "#4385be",
            sortOrder: 1,
          }),
        }),
      );
      const createdCategory = await createCategoryResponse.json();
      expect(createCategoryResponse.status).toBe(200);
      expect(createdCategory).toMatchObject({ id: "growth", taxonomyId: "strategy" });

      const moveCategoryResponse = await handler(
        new Request("http://127.0.0.1/api/v1/taxonomies/categories/move", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            taxonomyId: "strategy",
            categoryId: "growth",
            newParentId: null,
            position: 5,
          }),
        }),
      );
      expect(await moveCategoryResponse.json()).toMatchObject({
        id: "growth",
        parentId: null,
        sortOrder: 5,
      });

      const assignResponse = await handler(
        new Request("http://127.0.0.1/api/v1/taxonomies/assignments", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            id: "assignment-1",
            assetId: "asset-1",
            taxonomyId: "strategy",
            categoryId: "growth",
            weight: 10_000,
            source: "manual",
          }),
        }),
      );
      expect(await assignResponse.json()).toMatchObject({
        id: "assignment-1",
        assetId: "asset-1",
        categoryId: "growth",
      });

      const assignmentsResponse = await handler(
        new Request("http://127.0.0.1/api/v1/taxonomies/assignments/asset/asset-1", {
          headers: { authorization: "Bearer sidecar-token" },
        }),
      );
      expect(await assignmentsResponse.json()).toEqual([
        expect.objectContaining({ id: "assignment-1", taxonomyId: "strategy" }),
      ]);

      const removeAssignmentResponse = await handler(
        new Request("http://127.0.0.1/api/v1/taxonomies/assignments/assignment-1", {
          method: "DELETE",
          headers: { authorization: "Bearer sidecar-token" },
        }),
      );
      expect(removeAssignmentResponse.status).toBe(204);

      const deleteCategoryResponse = await handler(
        new Request("http://127.0.0.1/api/v1/taxonomies/strategy/categories/growth", {
          method: "DELETE",
          headers: { authorization: "Bearer sidecar-token" },
        }),
      );
      expect(deleteCategoryResponse.status).toBe(204);

      const deleteTaxonomyResponse = await handler(
        new Request("http://127.0.0.1/api/v1/taxonomies/strategy", {
          method: "DELETE",
          headers: { authorization: "Bearer sidecar-token" },
        }),
      );
      expect(deleteTaxonomyResponse.status).toBe(204);
    } finally {
      db.close();
    }
  });

  test("routes migrated taxonomy import and export only when a service is provided", async () => {
    const db = createTaxonomiesDb();
    const handler = createBackendRequestHandler(config, {
      taxonomyService: createTaxonomyService(createTaxonomyRepository(db)),
    });

    try {
      const importResponse = await handler(
        new Request("http://127.0.0.1/api/v1/taxonomies/import", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            jsonStr: JSON.stringify({
              name: "Imported",
              color: "#4385be",
              categories: [
                {
                  name: "Equity",
                  key: "equity",
                  color: "#4385be",
                  children: [{ name: "US", key: "us", color: "#8b7ec8" }],
                },
              ],
            }),
          }),
        }),
      );
      const imported = await importResponse.json();
      expect(importResponse.status).toBe(200);
      expect(imported).toMatchObject({ name: "Imported", isSystem: false });

      const exportResponse = await handler(
        new Request(`http://127.0.0.1/api/v1/taxonomies/${imported.id}/export`, {
          headers: { authorization: "Bearer sidecar-token" },
        }),
      );
      const exported = JSON.parse(await exportResponse.json());
      expect(exported).toMatchObject({
        name: "Imported",
        color: "#4385be",
        instruments: [],
      });
      expect(exported.categories[0]).toMatchObject({
        name: "Equity",
        children: [expect.objectContaining({ name: "US" })],
      });
    } finally {
      db.close();
    }
  });

  test("routes migrated custom provider CRUD only when a service is provided", async () => {
    const db = createCustomProvidersDb();
    const handler = createBackendRequestHandler(config, {
      customProviderService: createCustomProviderService(createCustomProviderRepository(db), {
        fetchImpl: () => Promise.resolve(new Response(JSON.stringify({ price: 12.34 }))),
      }),
    });

    try {
      expect((await handler(new Request("http://127.0.0.1/api/v1/custom-providers"))).status).toBe(
        401,
      );

      const createResponse = await handler(
        new Request("http://127.0.0.1/api/v1/custom-providers", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            code: " Demo ",
            name: "Demo",
            sources: [
              {
                kind: "latest",
                format: "json",
                url: "https://example.test/{SYMBOL}",
                pricePath: "$.price",
              },
            ],
          }),
        }),
      );
      const created = await createResponse.json();
      expect(createResponse.status).toBe(200);
      expect(created).toMatchObject({
        id: "demo",
        description: "",
        enabled: true,
        priority: 50,
        sources: [expect.objectContaining({ id: "demo:latest" })],
      });

      const updateResponse = await handler(
        new Request("http://127.0.0.1/api/v1/custom-providers/demo", {
          method: "PUT",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({ name: "Demo Updated", sources: [] }),
        }),
      );
      expect(await updateResponse.json()).toMatchObject({
        id: "demo",
        name: "Demo Updated",
        sources: [],
      });

      const listResponse = await handler(
        new Request("http://127.0.0.1/api/v1/custom-providers", {
          headers: { authorization: "Bearer sidecar-token" },
        }),
      );
      expect(await listResponse.json()).toEqual([expect.objectContaining({ id: "demo" })]);

      const deleteResponse = await handler(
        new Request("http://127.0.0.1/api/v1/custom-providers/demo", {
          method: "DELETE",
          headers: { authorization: "Bearer sidecar-token" },
        }),
      );
      expect(deleteResponse.status).toBe(204);

      const testSourceResponse = await handler(
        new Request("http://127.0.0.1/api/v1/custom-providers/test-source", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            format: "json",
            url: "https://example.test/quote",
            pricePath: "$.price",
            symbol: "AAPL",
          }),
        }),
      );
      expect(testSourceResponse.status).toBe(200);
      expect(await testSourceResponse.json()).toMatchObject({ success: true, price: 12.34 });
    } finally {
      db.close();
    }
  });

  test("routes migrated exchange rate CRUD only when a service is provided", async () => {
    const db = createExchangeRatesDb();
    const enqueued: PortfolioJobConfig[] = [];
    const handler = createBackendRequestHandler(config, {
      exchangeRateService: createExchangeRateService(createExchangeRateRepository(db)),
      portfolioJobService: {
        enqueuePortfolioJob(config) {
          enqueued.push(config);
        },
      },
    });

    try {
      expect(
        (await handler(new Request("http://127.0.0.1/api/v1/exchange-rates/latest"))).status,
      ).toBe(401);

      const createResponse = await handler(
        new Request("http://127.0.0.1/api/v1/exchange-rates", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            fromCurrency: "EUR",
            toCurrency: "USD",
            rate: "1.20",
            source: "YAHOO",
          }),
        }),
      );
      const created = await createResponse.json();
      expect(createResponse.status).toBe(200);
      expect(created).toMatchObject({
        fromCurrency: "EUR",
        toCurrency: "USD",
        rate: "1.20",
        source: "YAHOO",
      });

      const updateResponse = await handler(
        new Request("http://127.0.0.1/api/v1/exchange-rates", {
          method: "PUT",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({ ...created, rate: "1.25", source: "IGNORED" }),
        }),
      );
      expect(await updateResponse.json()).toMatchObject({
        id: created.id,
        rate: "1.25",
        source: "MANUAL",
      });

      const latestResponse = await handler(
        new Request("http://127.0.0.1/api/v1/exchange-rates/latest", {
          headers: { authorization: "Bearer sidecar-token" },
        }),
      );
      expect(await latestResponse.json()).toEqual([expect.objectContaining({ id: created.id })]);

      const deleteResponse = await handler(
        new Request(`http://127.0.0.1/api/v1/exchange-rates/${created.id}`, {
          method: "DELETE",
          headers: { authorization: "Bearer sidecar-token" },
        }),
      );
      expect(deleteResponse.status).toBe(204);

      const fullRecalculation: PortfolioJobConfig = {
        accountIds: null,
        marketSyncMode: { type: "none" },
        snapshotMode: "full",
        valuationMode: "full",
        sinceDate: null,
      };
      expect(enqueued).toEqual([fullRecalculation, fullRecalculation, fullRecalculation]);
    } finally {
      db.close();
    }
  });

  test("routes migrated health dismissals and config only when a service is provided", async () => {
    const db = createHealthDb();
    const handler = createBackendRequestHandler(config, {
      healthService: createHealthService(createHealthRepository(db)),
    });

    try {
      expect((await handler(new Request("http://127.0.0.1/api/v1/health/dismissed"))).status).toBe(
        401,
      );

      const dismissResponse = await handler(
        new Request("http://127.0.0.1/api/v1/health/dismiss", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({ issueId: "price_stale:AAPL", dataHash: "hash-1" }),
        }),
      );
      expect(dismissResponse.status).toBe(200);
      expect(await dismissResponse.text()).toBe("");

      const dismissedResponse = await handler(
        new Request("http://127.0.0.1/api/v1/health/dismissed", {
          headers: { authorization: "Bearer sidecar-token" },
        }),
      );
      expect(await dismissedResponse.json()).toEqual(["price_stale:AAPL"]);

      const configResponse = await handler(
        new Request("http://127.0.0.1/api/v1/health/config", {
          headers: { authorization: "Bearer sidecar-token" },
        }),
      );
      expect(await configResponse.json()).toMatchObject({
        priceStaleWarningHours: 24,
        priceStaleCriticalHours: 72,
      });

      const updateConfigResponse = await handler(
        new Request("http://127.0.0.1/api/v1/health/config", {
          method: "PUT",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            priceStaleWarningHours: 12,
            priceStaleCriticalHours: 48,
            fxStaleWarningHours: 24,
            fxStaleCriticalHours: 72,
            mvEscalationThreshold: 0.3,
            classificationWarnThreshold: 0.05,
          }),
        }),
      );
      expect(updateConfigResponse.status).toBe(200);

      const invalidConfigResponse = await handler(
        new Request("http://127.0.0.1/api/v1/health/config", {
          method: "PUT",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            priceStaleWarningHours: 72,
            priceStaleCriticalHours: 48,
            fxStaleWarningHours: 24,
            fxStaleCriticalHours: 72,
            mvEscalationThreshold: 0.3,
            classificationWarnThreshold: 0.05,
          }),
        }),
      );
      expect(invalidConfigResponse.status).toBe(400);

      const restoreResponse = await handler(
        new Request("http://127.0.0.1/api/v1/health/restore", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({ issueId: "price_stale:AAPL" }),
        }),
      );
      expect(restoreResponse.status).toBe(200);

      const statusResponse = await handler(
        new Request("http://127.0.0.1/api/v1/health/status", {
          headers: { authorization: "Bearer sidecar-token" },
        }),
      );
      expect(statusResponse.status).toBe(200);
      await expect(statusResponse.json()).resolves.toMatchObject({
        overallSeverity: "INFO",
        issueCounts: {},
        issues: [],
      });

      const deferredFixResponse = await handler(
        new Request("http://127.0.0.1/api/v1/health/fix", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({ id: "sync_prices", label: "Sync Prices", payload: ["asset-1"] }),
        }),
      );
      expect(deferredFixResponse.status).toBe(404);
    } finally {
      db.close();
    }
  });

  test("routes migrated health runtime and classification migration seams when service methods are provided", async () => {
    const calls: Array<[string, unknown]> = [];
    const healthService: HealthService = {
      dismissIssue() {
        throw new Error("not used");
      },
      restoreIssue() {
        throw new Error("not used");
      },
      getDismissedIds() {
        return Promise.resolve([]);
      },
      getConfig() {
        return Promise.resolve({
          priceStaleWarningHours: 24,
          priceStaleCriticalHours: 72,
          fxStaleWarningHours: 24,
          fxStaleCriticalHours: 72,
          mvEscalationThreshold: 0.3,
          classificationWarnThreshold: 0.05,
        });
      },
      updateConfig() {
        return Promise.resolve();
      },
      getHealthStatus(clientTimezone) {
        calls.push(["health-status", clientTimezone]);
        return { isStale: false, issues: [] };
      },
      runHealthChecks(clientTimezone) {
        calls.push(["health-check", clientTimezone]);
        return { isStale: false, checked: true };
      },
      executeFix(action) {
        calls.push(["health-fix", action]);
        return Promise.resolve();
      },
    };
    const taxonomyService: TaxonomyService = {
      getTaxonomies() {
        return [];
      },
      getTaxonomy() {
        return null;
      },
      createTaxonomy() {
        throw new Error("not used");
      },
      updateTaxonomy() {
        throw new Error("not used");
      },
      deleteTaxonomy() {
        throw new Error("not used");
      },
      createCategory() {
        throw new Error("not used");
      },
      updateCategory() {
        throw new Error("not used");
      },
      deleteCategory() {
        throw new Error("not used");
      },
      moveCategory() {
        throw new Error("not used");
      },
      getAssetAssignments() {
        return [];
      },
      assignAssetToCategory() {
        throw new Error("not used");
      },
      removeAssetAssignment() {
        throw new Error("not used");
      },
      importTaxonomyJson() {
        throw new Error("not used");
      },
      exportTaxonomyJson() {
        throw new Error("not used");
      },
      getMigrationStatus() {
        calls.push(["migration-status", undefined]);
        return { needed: true };
      },
      migrateLegacyClassifications() {
        calls.push(["migration-run", undefined]);
        return { migrated: 2 };
      },
    };
    const handler = createBackendRequestHandler(config, { healthService, taxonomyService });
    const authHeaders = { authorization: "Bearer sidecar-token" };
    const jsonHeaders = { ...authHeaders, "content-type": "application/json" };

    expect((await handler(new Request("http://127.0.0.1/api/v1/health/status"))).status).toBe(401);
    expect(
      (
        await createBackendRequestHandler(config)(
          new Request("http://127.0.0.1/api/v1/health/status", { headers: authHeaders }),
        )
      ).status,
    ).toBe(404);

    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/health/status", {
            headers: { ...authHeaders, "x-client-timezone": " America/Toronto " },
          }),
        )
      ).json(),
    ).resolves.toEqual({ isStale: false, issues: [] });
    await handler(
      new Request("http://127.0.0.1/api/v1/health/check", {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: "not json",
      }),
    );
    const fixResponse = await handler(
      new Request("http://127.0.0.1/api/v1/health/fix", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          id: "migrate_legacy_classifications",
          label: "Migrate",
          payload: null,
        }),
      }),
    );
    expect(fixResponse.status).toBe(200);
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/health/fix", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ id: "bad", label: "Bad" }),
          }),
        )
      ).status,
    ).toBe(400);

    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/taxonomies/migration/status", {
            headers: authHeaders,
          }),
        )
      ).json(),
    ).resolves.toEqual({ needed: true });
    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/taxonomies/migration/run", {
            method: "POST",
            headers: { ...authHeaders, "content-type": "application/json" },
            body: "not json",
          }),
        )
      ).json(),
    ).resolves.toEqual({ migrated: 2 });

    expect(calls).toEqual([
      ["health-status", "America/Toronto"],
      ["health-check", undefined],
      ["health-fix", { id: "migrate_legacy_classifications", label: "Migrate", payload: null }],
      ["migration-status", undefined],
      ["migration-run", undefined],
    ]);
  });

  test("routes migrated market data provider settings only when a service is provided", async () => {
    const db = createMarketDataProvidersDb();
    const handler = createBackendRequestHandler(config, {
      marketDataProviderService: createMarketDataProviderService(
        createMarketDataProviderRepository(db),
        { readSecret: (providerId) => (providerId === "ALPHA_VANTAGE" ? "secret" : null) },
      ),
    });

    try {
      expect((await handler(new Request("http://127.0.0.1/api/v1/providers"))).status).toBe(401);

      const providersResponse = await handler(
        new Request("http://127.0.0.1/api/v1/providers/settings", {
          headers: { authorization: "Bearer sidecar-token" },
        }),
      );
      expect(await providersResponse.json()).toEqual([
        expect.objectContaining({ id: "YAHOO", priority: 1, hasApiKey: true }),
        expect.objectContaining({ id: "ALPHA_VANTAGE", priority: 3, hasApiKey: true }),
        expect.objectContaining({ id: "FINNHUB", priority: 4, hasApiKey: false }),
      ]);

      const updateResponse = await handler(
        new Request("http://127.0.0.1/api/v1/providers/settings", {
          method: "PUT",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({ providerId: "FINNHUB", priority: 0, enabled: true }),
        }),
      );
      expect(updateResponse.status).toBe(204);

      const updatedResponse = await handler(
        new Request("http://127.0.0.1/api/v1/providers", {
          headers: { authorization: "Bearer sidecar-token" },
        }),
      );
      expect((await updatedResponse.json())[0]).toMatchObject({
        id: "FINNHUB",
        priority: 0,
        enabled: true,
      });

      const deferredSearchResponse = await handler(
        new Request("http://127.0.0.1/api/v1/market-data/search?query=AAPL", {
          headers: { authorization: "Bearer sidecar-token" },
        }),
      );
      expect(deferredSearchResponse.status).toBe(404);
    } finally {
      db.close();
    }
  });

  test("routes migrated market data seam only when a service is provided", async () => {
    const calls: Array<[string, unknown]> = [];
    const marketDataService: MarketDataService = {
      getExchanges() {
        calls.push(["exchanges", undefined]);
        return [{ mic: "XNAS" }];
      },
      searchSymbol(query) {
        calls.push(["search", query]);
        return [{ symbol: query }];
      },
      resolveSymbolQuote(request) {
        calls.push(["resolve", request]);
        return { symbol: request.symbol, currency: "USD" };
      },
      getQuoteHistory(symbol) {
        calls.push(["history", symbol]);
        return [{ asset_id: symbol }];
      },
      fetchYahooDividends(symbol) {
        calls.push(["dividends", symbol]);
        return [{ symbol }];
      },
      getLatestQuotes(assetIds) {
        calls.push(["latest", assetIds]);
        return { [assetIds[0] ?? ""]: { close: "1.00" } };
      },
      updateQuote(symbol, quote) {
        calls.push(["update-quote", { symbol, quote }]);
      },
      deleteQuote(id) {
        calls.push(["delete-quote", id]);
      },
      checkQuotesImport(content, hasHeaderRow) {
        calls.push(["check-import", { content: Array.from(content), hasHeaderRow }]);
        return [];
      },
      importQuotesCsv(quotes, overwriteExisting) {
        calls.push(["import-quotes", { quotes, overwriteExisting }]);
        return quotes;
      },
      syncHistoryQuotes() {
        calls.push(["sync-history", undefined]);
      },
      syncMarketData(marketSyncMode) {
        calls.push(["sync-market", marketSyncMode]);
      },
    };
    const handler = createBackendRequestHandler(config, { marketDataService });
    const authHeaders = { authorization: "Bearer sidecar-token" };
    const jsonHeaders = { ...authHeaders, "content-type": "application/json" };

    expect((await handler(new Request("http://127.0.0.1/api/v1/exchanges"))).status).toBe(401);
    expect(
      (
        await createBackendRequestHandler(config)(
          new Request("http://127.0.0.1/api/v1/exchanges", { headers: authHeaders }),
        )
      ).status,
    ).toBe(404);

    await expect(
      (
        await handler(new Request("http://127.0.0.1/api/v1/exchanges", { headers: authHeaders }))
      ).json(),
    ).resolves.toEqual([{ mic: "XNAS" }]);
    await handler(
      new Request("http://127.0.0.1/api/v1/market-data/search?query=", {
        headers: authHeaders,
      }),
    );
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/market-data/search", {
            headers: authHeaders,
          }),
        )
      ).status,
    ).toBe(400);
    await expect(
      (
        await handler(
          new Request(
            "http://127.0.0.1/api/v1/market-data/resolve-currency?symbol=AAPL&exchangeMic=XNAS&instrumentType=UNKNOWN&quoteCcy=USD&providerId=YAHOO",
            { headers: authHeaders },
          ),
        )
      ).json(),
    ).resolves.toEqual({ symbol: "AAPL", currency: "USD" });
    await handler(
      new Request("http://127.0.0.1/api/v1/market-data/quotes/history?symbol=AAPL", {
        headers: authHeaders,
      }),
    );
    await handler(
      new Request("http://127.0.0.1/api/v1/market-data/yahoo/dividends?symbol=AAPL", {
        headers: authHeaders,
      }),
    );
    await handler(
      new Request("http://127.0.0.1/api/v1/market-data/quotes/latest", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ assetIds: ["asset-1"] }),
      }),
    );
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/market-data/quotes/latest", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ asset_ids: ["asset-1"] }),
          }),
        )
      ).status,
    ).toBe(400);

    const updateQuoteResponse = await handler(
      new Request("http://127.0.0.1/api/v1/market-data/quotes/SYM%2F1", {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({ asset_id: "wrong", assetId: "wrongCamel", close: "12.34" }),
      }),
    );
    expect(updateQuoteResponse.status).toBe(204);
    const deleteQuoteResponse = await handler(
      new Request("http://127.0.0.1/api/v1/market-data/quotes/id/quote%2F1", {
        method: "DELETE",
        headers: authHeaders,
      }),
    );
    expect(deleteQuoteResponse.status).toBe(204);

    await handler(
      new Request("http://127.0.0.1/api/v1/market-data/quotes/check", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ content: [65], hasHeaderRow: true }),
      }),
    );
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/market-data/quotes/check", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ content: [1.5], hasHeaderRow: true }),
          }),
        )
      ).status,
    ).toBe(400);
    await handler(
      new Request("http://127.0.0.1/api/v1/market-data/quotes/import", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ quotes: [{ assetId: "asset-1" }], overwriteExisting: false }),
      }),
    );
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/market-data/quotes/import", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ quotes: [] }),
          }),
        )
      ).status,
    ).toBe(400);

    const syncHistoryResponse = await handler(
      new Request("http://127.0.0.1/api/v1/market-data/sync/history", {
        method: "POST",
        headers: authHeaders,
        body: "not json",
      }),
    );
    expect(syncHistoryResponse.status).toBe(204);
    const syncMarketResponse = await handler(
      new Request("http://127.0.0.1/api/v1/market-data/sync", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ assetIds: null, refetchAll: true, refetchRecentDays: 7 }),
      }),
    );
    expect(syncMarketResponse.status).toBe(204);
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/market-data/sync", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ assetIds: ["asset-2"] }),
          }),
        )
      ).status,
    ).toBe(400);

    expect(calls).toEqual([
      ["exchanges", undefined],
      ["search", ""],
      [
        "resolve",
        {
          symbol: "AAPL",
          exchangeMic: "XNAS",
          instrumentType: "UNKNOWN",
          quoteCcy: "USD",
          providerId: "YAHOO",
        },
      ],
      ["history", "AAPL"],
      ["dividends", "AAPL"],
      ["latest", ["asset-1"]],
      [
        "update-quote",
        {
          symbol: "SYM/1",
          quote: { asset_id: "SYM/1", assetId: "wrongCamel", close: "12.34" },
        },
      ],
      ["delete-quote", "quote/1"],
      ["check-import", { content: [65], hasHeaderRow: true }],
      ["import-quotes", { quotes: [{ assetId: "asset-1" }], overwriteExisting: false }],
      ["sync-history", undefined],
      ["sync-market", { type: "refetch_recent", asset_ids: null, days: 7 }],
    ]);
  });

  test("enqueues portfolio jobs for market data mutation side effects", async () => {
    const calls: string[] = [];
    const enqueued: PortfolioJobConfig[] = [];
    const marketDataService: MarketDataService = {
      updateQuote() {
        calls.push("update-quote");
      },
      deleteQuote() {
        calls.push("delete-quote");
      },
      importQuotesCsv() {
        calls.push("import-quotes");
        return [];
      },
    };
    const handler = createBackendRequestHandler(config, {
      marketDataService,
      portfolioJobService: {
        enqueuePortfolioJob(config) {
          enqueued.push(config);
        },
      },
    });
    const authHeaders = { authorization: "Bearer sidecar-token" };
    const jsonHeaders = { ...authHeaders, "content-type": "application/json" };

    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/market-data/quotes/asset-1", {
            method: "PUT",
            headers: jsonHeaders,
            body: JSON.stringify({ close: "12.34" }),
          }),
        )
      ).status,
    ).toBe(204);
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/market-data/quotes/id/quote-1", {
            method: "DELETE",
            headers: authHeaders,
          }),
        )
      ).status,
    ).toBe(204);
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/market-data/quotes/import", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ quotes: [{ assetId: "asset-1" }], overwriteExisting: false }),
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/market-data/sync", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ assetIds: ["asset-1"], refetchAll: false }),
          }),
        )
      ).status,
    ).toBe(204);

    const quoteMutationRecalculation: PortfolioJobConfig = {
      accountIds: null,
      marketSyncMode: { type: "none" },
      snapshotMode: "full",
      valuationMode: "full",
      sinceDate: null,
    };
    expect(calls).toEqual(["update-quote", "delete-quote", "import-quotes"]);
    expect(enqueued).toEqual([
      quoteMutationRecalculation,
      quoteMutationRecalculation,
      quoteMutationRecalculation,
      {
        accountIds: null,
        marketSyncMode: { type: "incremental", asset_ids: ["asset-1"] },
        snapshotMode: "incremental_from_last",
        valuationMode: "incremental_from_last",
        sinceDate: null,
      },
    ]);
  });

  test("routes migrated portfolio job triggers only when a service is provided", async () => {
    const enqueued: PortfolioJobConfig[] = [];
    const handler = createBackendRequestHandler(config, {
      portfolioJobService: {
        enqueuePortfolioJob(config) {
          enqueued.push(config);
        },
      },
    });

    expect((await handler(new Request("http://127.0.0.1/api/v1/portfolio/update"))).status).toBe(
      401,
    );

    const updateResponse = await handler(
      new Request("http://127.0.0.1/api/v1/portfolio/update", {
        method: "POST",
        headers: { authorization: "Bearer sidecar-token" },
      }),
    );
    expect(updateResponse.status).toBe(202);
    expect(enqueued[0]).toEqual({
      accountIds: null,
      marketSyncMode: { type: "incremental", asset_ids: null },
      snapshotMode: "incremental_from_last",
      valuationMode: "incremental_from_last",
      sinceDate: null,
    });

    const explicitIncrementalResponse = await handler(
      new Request("http://127.0.0.1/api/v1/portfolio/update", {
        method: "POST",
        headers: {
          authorization: "Bearer sidecar-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ marketSyncMode: { type: "incremental" } }),
      }),
    );
    expect(explicitIncrementalResponse.status).toBe(202);
    expect(enqueued[1]?.marketSyncMode).toEqual({ type: "incremental", asset_ids: null });

    const emptyRecalculateResponse = await handler(
      new Request("http://127.0.0.1/api/v1/portfolio/recalculate", {
        method: "POST",
        headers: { authorization: "Bearer sidecar-token" },
      }),
    );
    expect(emptyRecalculateResponse.status).toBe(202);
    expect(enqueued[2]?.marketSyncMode).toEqual({
      type: "backfill_history",
      asset_ids: null,
      days: 1_825,
    });

    const recalculateResponse = await handler(
      new Request("http://127.0.0.1/api/v1/portfolio/recalculate", {
        method: "POST",
        headers: {
          authorization: "Bearer sidecar-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          accountIds: ["acc-1"],
          marketSyncMode: { type: "refetch_recent", asset_ids: ["asset-1"], days: 7 },
        }),
      }),
    );
    expect(recalculateResponse.status).toBe(202);
    expect(enqueued[3]).toEqual({
      accountIds: ["acc-1"],
      marketSyncMode: { type: "refetch_recent", asset_ids: ["asset-1"], days: 7 },
      snapshotMode: "full",
      valuationMode: "full",
      sinceDate: null,
    });

    const deferredEventsResponse = await handler(
      new Request("http://127.0.0.1/api/v1/events/stream", {
        headers: { authorization: "Bearer sidecar-token" },
      }),
    );
    expect(deferredEventsResponse.status).toBe(404);
  });

  test("routes migrated portfolio metrics seam only when a service is provided", async () => {
    const calls: Array<[string, unknown]> = [];
    const portfolioMetricsService: PortfolioMetricsService = {
      getNetWorth(date) {
        calls.push(["net-worth", date]);
        return { totalAssets: "100.00", totalLiabilities: "25.00", netWorth: "75.00" };
      },
      getNetWorthHistory(startDate, endDate) {
        calls.push(["net-worth-history", { startDate, endDate }]);
        return [{ date: startDate, netWorth: "75.00" }];
      },
      calculateAccountsSimplePerformance(accountIds) {
        calls.push(["accounts-simple", accountIds]);
        return [{ accountId: accountIds?.[0], simpleReturn: 0.1 }];
      },
      calculatePerformanceHistory(request) {
        calls.push(["performance-history", request]);
        return { twr: 0.12, mwr: 0.08 };
      },
      calculatePerformanceSummary(request) {
        calls.push(["performance-summary", request]);
        return { twr: 0.1, mwr: 0.07 };
      },
      getIncomeSummary(accountId) {
        calls.push(["income-summary", accountId]);
        return [{ accountId, amount: "12.34" }];
      },
    };
    const handler = createBackendRequestHandler(config, { portfolioMetricsService });

    expect((await handler(new Request("http://127.0.0.1/api/v1/net-worth"))).status).toBe(401);
    expect(
      (
        await createBackendRequestHandler(config)(
          new Request("http://127.0.0.1/api/v1/net-worth", {
            headers: { authorization: "Bearer sidecar-token" },
          }),
        )
      ).status,
    ).toBe(404);

    expect(
      await (
        await handler(
          new Request("http://127.0.0.1/api/v1/net-worth?date=2026-05-14", {
            headers: { authorization: "Bearer sidecar-token" },
          }),
        )
      ).json(),
    ).toEqual({ totalAssets: "100.00", totalLiabilities: "25.00", netWorth: "75.00" });

    expect(
      await (
        await handler(
          new Request(
            "http://127.0.0.1/api/v1/net-worth/history?startDate=2026-05-01&endDate=2026-05-14",
            { headers: { authorization: "Bearer sidecar-token" } },
          ),
        )
      ).json(),
    ).toEqual([{ date: "2026-05-01", netWorth: "75.00" }]);

    expect(
      await (
        await handler(
          new Request("http://127.0.0.1/api/v1/performance/accounts/simple", {
            method: "POST",
            headers: {
              authorization: "Bearer sidecar-token",
              "content-type": "application/json",
            },
            body: JSON.stringify({ accountIds: [] }),
          }),
        )
      ).json(),
    ).toEqual([]);

    await handler(
      new Request("http://127.0.0.1/api/v1/performance/accounts/simple", {
        method: "POST",
        headers: {
          authorization: "Bearer sidecar-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ accountIds: ["acc-1"] }),
      }),
    );

    await handler(
      new Request("http://127.0.0.1/api/v1/performance/history", {
        method: "POST",
        headers: {
          authorization: "Bearer sidecar-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          itemType: "account",
          itemId: "acc-1",
          startDate: "2026-05-01",
          endDate: "2026-05-14",
          trackingMode: "HOLDINGS",
        }),
      }),
    );

    await handler(
      new Request("http://127.0.0.1/api/v1/performance/summary", {
        method: "POST",
        headers: {
          authorization: "Bearer sidecar-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ itemType: "account", itemId: "acc-1", trackingMode: "UNKNOWN" }),
      }),
    );

    await handler(
      new Request("http://127.0.0.1/api/v1/income/summary?accountId=acc-1", {
        headers: { authorization: "Bearer sidecar-token" },
      }),
    );

    const invalidDateResponse = await handler(
      new Request("http://127.0.0.1/api/v1/net-worth?date=2026-02-31", {
        headers: { authorization: "Bearer sidecar-token" },
      }),
    );
    expect(invalidDateResponse.status).toBe(400);

    expect(calls).toEqual([
      ["net-worth", "2026-05-14"],
      ["net-worth-history", { startDate: "2026-05-01", endDate: "2026-05-14" }],
      ["accounts-simple", ["acc-1"]],
      [
        "performance-history",
        {
          itemType: "account",
          itemId: "acc-1",
          startDate: "2026-05-01",
          endDate: "2026-05-14",
          trackingMode: "HOLDINGS",
        },
      ],
      ["performance-summary", { itemType: "account", itemId: "acc-1" }],
      ["income-summary", "acc-1"],
    ]);
  });

  test("routes migrated holdings seam only when a service is provided", async () => {
    const calls: Array<[string, unknown]> = [];
    const holdingsService: HoldingsService = {
      getHoldings(accountId) {
        calls.push(["holdings", accountId]);
        return [{ accountId }];
      },
      getHolding(accountId, assetId) {
        calls.push(["holding", { accountId, assetId }]);
        return assetId === "missing" ? null : { accountId, assetId };
      },
      getAssetHoldings(assetId) {
        calls.push(["asset-holdings", assetId]);
        return [{ assetId }];
      },
      getHistoricalValuations(accountId, startDate, endDate) {
        calls.push(["historical-valuations", { accountId, startDate, endDate }]);
        return [{ accountId, date: startDate }];
      },
      getLatestValuations(accountIds) {
        calls.push(["latest-valuations", accountIds]);
        return [{ accountIds }];
      },
      getPortfolioAllocations(accountId) {
        calls.push(["allocations", accountId]);
        return { accountId, byAssetClass: [] };
      },
      getHoldingsByAllocation(accountId, taxonomyId, categoryId) {
        calls.push(["allocation-holdings", { accountId, taxonomyId, categoryId }]);
        return { categoryId, holdings: [] };
      },
      getSnapshots(accountId, dateFrom, dateTo) {
        calls.push(["snapshots", { accountId, dateFrom, dateTo }]);
        return [{ accountId, snapshotDate: dateFrom }];
      },
      getSnapshotByDate(accountId, date) {
        calls.push(["snapshot-holdings", { accountId, date }]);
        return [{ accountId, date }];
      },
      deleteSnapshot(accountId, date) {
        calls.push(["delete-snapshot", { accountId, date }]);
      },
      saveManualHoldings(request) {
        calls.push(["save-manual-holdings", request]);
      },
      checkHoldingsImport(request) {
        calls.push(["check-holdings-import", request]);
        return { existingDates: [], symbols: [], validationErrors: [] };
      },
      importHoldingsCsv(request) {
        calls.push(["import-holdings-csv", request]);
        return { snapshotsImported: request.snapshots.length, snapshotsFailed: 0, errors: [] };
      },
    };
    const handler = createBackendRequestHandler(config, { holdingsService });
    const authHeaders = { authorization: "Bearer sidecar-token" };
    const jsonHeaders = { ...authHeaders, "content-type": "application/json" };

    expect(
      (await handler(new Request("http://127.0.0.1/api/v1/holdings?accountId=acc-1"))).status,
    ).toBe(401);
    expect(
      (
        await createBackendRequestHandler(config)(
          new Request("http://127.0.0.1/api/v1/holdings?accountId=acc-1", {
            headers: authHeaders,
          }),
        )
      ).status,
    ).toBe(404);

    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/holdings?accountId=", { headers: authHeaders }),
        )
      ).json(),
    ).resolves.toEqual([{ accountId: "" }]);
    const missingHoldingResponse = await handler(
      new Request("http://127.0.0.1/api/v1/holdings/item?accountId=acc-1&assetId=missing", {
        headers: authHeaders,
      }),
    );
    expect(missingHoldingResponse.status).toBe(200);
    await expect(missingHoldingResponse.json()).resolves.toBeNull();

    await handler(
      new Request("http://127.0.0.1/api/v1/holdings/by-asset?assetId=asset-1", {
        headers: authHeaders,
      }),
    );
    await handler(
      new Request(
        "http://127.0.0.1/api/v1/valuations/history?accountId=acc-1&startDate=2026-05-01&endDate=2026-05-14",
        { headers: authHeaders },
      ),
    );
    await handler(
      new Request("http://127.0.0.1/api/v1/valuations/latest?accountIds[]=acc-1&accountIds=acc-2", {
        headers: authHeaders,
      }),
    );
    await handler(
      new Request("http://127.0.0.1/api/v1/valuations/latest?accountIds=acc-1,acc-2", {
        headers: authHeaders,
      }),
    );
    await handler(
      new Request("http://127.0.0.1/api/v1/valuations/latest", { headers: authHeaders }),
    );
    await handler(
      new Request("http://127.0.0.1/api/v1/allocations?accountId=acc-1", {
        headers: authHeaders,
      }),
    );
    await handler(
      new Request(
        "http://127.0.0.1/api/v1/allocations/holdings?accountId=acc-1&taxonomyId=tax-1&categoryId=cat-1",
        { headers: authHeaders },
      ),
    );
    await handler(
      new Request(
        "http://127.0.0.1/api/v1/snapshots?accountId=acc-1&dateFrom=2026-05-01&dateTo=2026-05-14",
        { headers: authHeaders },
      ),
    );
    await handler(
      new Request("http://127.0.0.1/api/v1/snapshots/holdings?accountId=acc-1&date=2026-05-14", {
        headers: authHeaders,
      }),
    );
    const deleteResponse = await handler(
      new Request("http://127.0.0.1/api/v1/snapshots?accountId=acc-1&date=2026-05-14", {
        method: "DELETE",
        headers: authHeaders,
      }),
    );
    expect(deleteResponse.status).toBe(204);

    const saveResponse = await handler(
      new Request("http://127.0.0.1/api/v1/snapshots", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          accountId: "acc-1",
          holdings: [
            {
              assetId: "asset-1",
              symbol: "AAPL",
              quantity: "2",
              currency: "USD",
              averageCost: null,
            },
          ],
          cashBalances: { USD: "100.00" },
          snapshotDate: "2026-05-14",
        }),
      }),
    );
    expect(saveResponse.status).toBe(200);
    await expect(saveResponse.text()).resolves.toBe("");

    await handler(
      new Request("http://127.0.0.1/api/v1/snapshots/import/check", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          accountId: "acc-1",
          snapshots: [
            {
              date: "not-a-date",
              positions: [{ symbol: "MSFT", quantity: "1", currency: "USD", avgCost: null }],
              cashBalances: { USD: "50.00" },
            },
          ],
        }),
      }),
    );
    await handler(
      new Request("http://127.0.0.1/api/v1/snapshots/import", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          accountId: "acc-1",
          snapshots: [
            {
              date: "not-a-date",
              positions: [{ symbol: "MSFT", quantity: "1", currency: "USD" }],
              cashBalances: { USD: "50.00" },
            },
          ],
        }),
      }),
    );

    expect(
      (
        await handler(
          new Request(
            "http://127.0.0.1/api/v1/valuations/history?accountId=acc-1&startDate=2026-02-31",
            { headers: authHeaders },
          ),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/snapshots", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({
              accountId: "acc-1",
              holdings: [],
              cashBalances: {},
              snapshotDate: "2026-02-31",
            }),
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/snapshots", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ accountId: "acc-1", holdings: [] }),
          }),
        )
      ).status,
    ).toBe(400);

    expect(calls).toEqual([
      ["holdings", ""],
      ["holding", { accountId: "acc-1", assetId: "missing" }],
      ["asset-holdings", "asset-1"],
      [
        "historical-valuations",
        { accountId: "acc-1", startDate: "2026-05-01", endDate: "2026-05-14" },
      ],
      ["latest-valuations", ["acc-1", "acc-2"]],
      ["latest-valuations", ["acc-1,acc-2"]],
      ["latest-valuations", undefined],
      ["allocations", "acc-1"],
      ["allocation-holdings", { accountId: "acc-1", taxonomyId: "tax-1", categoryId: "cat-1" }],
      ["snapshots", { accountId: "acc-1", dateFrom: "2026-05-01", dateTo: "2026-05-14" }],
      ["snapshot-holdings", { accountId: "acc-1", date: "2026-05-14" }],
      ["delete-snapshot", { accountId: "acc-1", date: "2026-05-14" }],
      [
        "save-manual-holdings",
        {
          accountId: "acc-1",
          holdings: [{ assetId: "asset-1", symbol: "AAPL", quantity: "2", currency: "USD" }],
          cashBalances: { USD: "100.00" },
          snapshotDate: "2026-05-14",
        },
      ],
      [
        "check-holdings-import",
        {
          accountId: "acc-1",
          snapshots: [
            {
              date: "not-a-date",
              positions: [{ symbol: "MSFT", quantity: "1", currency: "USD" }],
              cashBalances: { USD: "50.00" },
            },
          ],
        },
      ],
      [
        "import-holdings-csv",
        {
          accountId: "acc-1",
          snapshots: [
            {
              date: "not-a-date",
              positions: [{ symbol: "MSFT", quantity: "1", currency: "USD" }],
              cashBalances: { USD: "50.00" },
            },
          ],
        },
      ],
    ]);
  });

  test("routes migrated event stream only when an event bus is provided", async () => {
    const eventBus = createEventBus();
    const handler = createBackendRequestHandler(config, { eventBus });

    expect((await handler(new Request("http://127.0.0.1/api/v1/events/stream"))).status).toBe(401);

    const response = await handler(
      new Request("http://127.0.0.1/api/v1/events/stream", {
        headers: { authorization: "Bearer sidecar-token" },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    eventBus.publish({ name: "portfolio_update_start", payload: { accountId: "acc-1" } });
    const event = await reader?.read();
    expect(new TextDecoder().decode(event?.value)).toBe(
      'event: portfolio_update_start\ndata: {"accountId":"acc-1"}\n\n',
    );
    await reader?.cancel();
  });

  test("routes migrated AI provider seam only when a service is provided", async () => {
    const updates: unknown[] = [];
    const defaults: unknown[] = [];
    const listedModels: string[] = [];
    const aiProviderService: AiProviderService = {
      getAiProviders() {
        return {
          providers: [{ id: "openai", enabled: true }],
          capabilities: { tools: { name: "Tools" } },
          defaultProvider: "openai",
        };
      },
      updateProviderSettings(request) {
        updates.push(request);
      },
      setDefaultProvider(request) {
        defaults.push(request);
      },
      listModels(providerId) {
        listedModels.push(providerId);
        return { models: [{ id: "gpt-4.1", name: "GPT-4.1" }], supportsListing: true };
      },
      resolveChatProviderConfig() {
        return {
          providerId: "openai",
          modelId: "gpt-4.1",
          providerType: "api",
          baseUrl: "https://api.openai.test",
          apiKey: "secret-key",
          capabilities: { tools: false, thinking: false, vision: false, streaming: true },
        };
      },
    };
    const handler = createBackendRequestHandler(config, { aiProviderService });

    expect((await handler(new Request("http://127.0.0.1/api/v1/ai/providers"))).status).toBe(401);
    expect(
      (
        await createBackendRequestHandler(config)(
          new Request("http://127.0.0.1/api/v1/ai/providers", {
            headers: { authorization: "Bearer sidecar-token" },
          }),
        )
      ).status,
    ).toBe(404);

    const providersResponse = await handler(
      new Request("http://127.0.0.1/api/v1/ai/providers", {
        headers: { authorization: "Bearer sidecar-token" },
      }),
    );
    expect(await providersResponse.json()).toEqual({
      providers: [{ id: "openai", enabled: true }],
      capabilities: { tools: { name: "Tools" } },
      defaultProvider: "openai",
    });

    const updateResponse = await handler(
      new Request("http://127.0.0.1/api/v1/ai/providers/settings", {
        method: "PUT",
        headers: {
          authorization: "Bearer sidecar-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          providerId: "openai",
          enabled: true,
          favorite: false,
          selectedModel: "gpt-4.1",
          customUrl: "",
          priority: 10,
          favoriteModels: ["gpt-4.1"],
          toolsAllowlist: null,
          modelCapabilityOverride: { modelId: "gpt-4.1", overrides: { tools: true } },
          tuningOverrides: null,
        }),
      }),
    );
    expect(updateResponse.status).toBe(200);
    expect(await updateResponse.json()).toBeNull();
    expect(updates).toEqual([
      {
        providerId: "openai",
        enabled: true,
        favorite: false,
        selectedModel: "gpt-4.1",
        customUrl: "",
        priority: 10,
        favoriteModels: ["gpt-4.1"],
        toolsAllowlist: null,
        modelCapabilityOverride: { modelId: "gpt-4.1", overrides: { tools: true } },
        tuningOverrides: null,
      },
    ]);

    const defaultResponse = await handler(
      new Request("http://127.0.0.1/api/v1/ai/providers/default", {
        method: "POST",
        headers: {
          authorization: "Bearer sidecar-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ providerId: null }),
      }),
    );
    expect(defaultResponse.status).toBe(200);
    expect(await defaultResponse.json()).toBeNull();
    expect(defaults).toEqual([{ providerId: null }]);

    const modelsResponse = await handler(
      new Request("http://127.0.0.1/api/v1/ai/providers/openai%2Fcompatible/models", {
        headers: { authorization: "Bearer sidecar-token" },
      }),
    );
    expect(await modelsResponse.json()).toEqual({
      models: [{ id: "gpt-4.1", name: "GPT-4.1" }],
      supportsListing: true,
    });
    expect(listedModels).toEqual(["openai/compatible"]);

    const invalidResponse = await handler(
      new Request("http://127.0.0.1/api/v1/ai/providers/settings", {
        method: "PUT",
        headers: {
          authorization: "Bearer sidecar-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ enabled: true }),
      }),
    );
    expect(invalidResponse.status).toBe(400);
  });

  test("routes migrated AI chat seam only when a service is provided", async () => {
    const calls: Array<[string, unknown]> = [];
    let streamCancelled = false;
    const aiChatService: AiChatService = {
      async sendMessage(request) {
        calls.push(["stream", request]);
        if (request.mode === "reject") {
          throw Object.assign(new Error("Provider unavailable"), { code: "PROVIDER_ERROR" });
        }
        if (request.mode === "throw-mid") {
          return (async function* () {
            yield { type: "system", threadId: "thread-1", runId: "run-1", messageId: null };
            throw Object.assign(new Error("Tool failed"), { code: "TOOL_EXECUTION_FAILED" });
          })();
        }
        if (request.mode === "serialize-error") {
          return (async function* () {
            yield { value: BigInt(1) };
          })();
        }
        if (request.mode === "cancel") {
          return (async function* () {
            try {
              yield { type: "system", threadId: "thread-1", runId: "run-1", messageId: null };
              yield { type: "done", threadId: "thread-1", runId: "run-1", messageId: "msg-1" };
            } finally {
              streamCancelled = true;
            }
          })();
        }
        return (async function* () {
          yield { type: "system", threadId: "thread-1", runId: "run-1", messageId: null };
          yield { type: "done", threadId: "thread-1", runId: "run-1", messageId: "msg-1" };
        })();
      },
      listThreads(request) {
        calls.push(["list-threads", request]);
        return { threads: [], nextCursor: null, hasMore: false };
      },
      getThread(threadId) {
        calls.push(["get-thread", threadId]);
        return threadId === "missing" ? null : { id: threadId, tags: ["tag/1"] };
      },
      getMessages(threadId) {
        calls.push(["messages", threadId]);
        return [{ id: "message-1", threadId }];
      },
      getTags(threadId) {
        calls.push(["get-tags", threadId]);
        return threadId === "missing" ? [] : ["tag/1"];
      },
      addTag(threadId, tag) {
        calls.push(["add-tag", { threadId, tag }]);
      },
      removeTag(threadId, tag) {
        calls.push(["remove-tag", { threadId, tag }]);
      },
      updateThread(threadId, request) {
        calls.push(["update-thread", { threadId, request }]);
        return { id: threadId, ...request };
      },
      deleteThread(threadId) {
        calls.push(["delete-thread", threadId]);
      },
      updateToolResult(request) {
        calls.push(["tool-result", request]);
        return { id: "message-1", toolCallId: request.toolCallId };
      },
    };
    const handler = createBackendRequestHandler(config, { aiChatService });
    const authHeaders = { authorization: "Bearer sidecar-token" };
    const jsonHeaders = { ...authHeaders, "content-type": "application/json" };

    for (const request of [
      new Request("http://127.0.0.1/api/v1/ai/chat/stream", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ message: "hello" }),
      }),
      new Request("http://127.0.0.1/api/v1/ai/threads", { headers: authHeaders }),
      new Request("http://127.0.0.1/api/v1/ai/threads/thread-1/tags/tag-1", {
        method: "DELETE",
        headers: authHeaders,
      }),
      new Request("http://127.0.0.1/api/v1/ai/tool-result", {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ threadId: "thread-1", toolCallId: "tool-1", resultPatch: null }),
      }),
    ]) {
      expect((await createBackendRequestHandler(config)(request)).status).toBe(404);
    }
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/ai/chat/stream", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ message: "hello" }),
          }),
        )
      ).status,
    ).toBe(401);
    expect((await handler(new Request("http://127.0.0.1/api/v1/ai/threads"))).status).toBe(401);

    const streamResponse = await handler(
      new Request("http://127.0.0.1/api/v1/ai/chat/stream", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ message: "hello" }),
      }),
    );
    expect(streamResponse.status).toBe(200);
    expect(streamResponse.headers.get("content-type")).toBe("application/x-ndjson");
    expect(streamResponse.headers.get("cache-control")).toBe("no-cache");
    expect(streamResponse.headers.get("connection")).toBe("keep-alive");
    await expect(streamResponse.text()).resolves.toBe(
      '{"type":"system","threadId":"thread-1","runId":"run-1","messageId":null}\n' +
        '{"type":"done","threadId":"thread-1","runId":"run-1","messageId":"msg-1"}\n',
    );

    const rejectResponse = await handler(
      new Request("http://127.0.0.1/api/v1/ai/chat/stream", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ mode: "reject" }),
      }),
    );
    expect(rejectResponse.status).toBe(502);
    await expect(rejectResponse.json()).resolves.toEqual({
      code: "PROVIDER_ERROR",
      error: "Provider unavailable",
    });

    const midStreamResponse = await handler(
      new Request("http://127.0.0.1/api/v1/ai/chat/stream", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ mode: "throw-mid" }),
      }),
    );
    await expect(midStreamResponse.text()).resolves.toBe(
      '{"type":"system","threadId":"thread-1","runId":"run-1","messageId":null}\n' +
        '{"type":"error","threadId":"","runId":"","messageId":null,"code":"TOOL_EXECUTION_FAILED","message":"Tool failed"}\n',
    );

    const serializationResponse = await handler(
      new Request("http://127.0.0.1/api/v1/ai/chat/stream", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ mode: "serialize-error" }),
      }),
    );
    await expect(serializationResponse.text()).resolves.toContain('"code":"serialization_error"');

    const cancelResponse = await handler(
      new Request("http://127.0.0.1/api/v1/ai/chat/stream", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ mode: "cancel" }),
      }),
    );
    const cancelReader = cancelResponse.body?.getReader();
    expect(cancelReader).toBeDefined();
    await cancelReader?.read();
    await cancelReader?.cancel();
    expect(streamCancelled).toBe(true);

    await handler(
      new Request("http://127.0.0.1/api/v1/ai/threads?cursor=&limit=0&search=", {
        headers: authHeaders,
      }),
    );
    for (const limit of ["", "-1", "1.5", "abc", "4294967296"]) {
      expect(
        (
          await handler(
            new Request(`http://127.0.0.1/api/v1/ai/threads?limit=${limit}`, {
              headers: authHeaders,
            }),
          )
        ).status,
      ).toBe(400);
    }

    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/ai/threads/thread%2F1", {
            headers: authHeaders,
          }),
        )
      ).json(),
    ).resolves.toEqual({ id: "thread/1", tags: ["tag/1"] });
    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/ai/threads/missing", {
            headers: authHeaders,
          }),
        )
      ).json(),
    ).resolves.toBeNull();
    await handler(
      new Request("http://127.0.0.1/api/v1/ai/threads/thread%2F1/messages", {
        headers: authHeaders,
      }),
    );
    await handler(
      new Request("http://127.0.0.1/api/v1/ai/threads/thread%2F1", {
        method: "PUT",
        headers: jsonHeaders,
        body: JSON.stringify({ title: null, isPinned: true }),
      }),
    );
    const deleteThreadResponse = await handler(
      new Request("http://127.0.0.1/api/v1/ai/threads/thread%2F1", {
        method: "DELETE",
        headers: authHeaders,
      }),
    );
    expect(deleteThreadResponse.status).toBe(204);

    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/ai/threads/thread%2F1/tags", {
            headers: authHeaders,
          }),
        )
      ).json(),
    ).resolves.toEqual(["tag/1"]);
    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/ai/threads/missing/tags", {
            headers: authHeaders,
          }),
        )
      ).json(),
    ).resolves.toEqual([]);
    const addTagResponse = await handler(
      new Request("http://127.0.0.1/api/v1/ai/threads/thread%2F1/tags", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ tag: "tag/1" }),
      }),
    );
    expect(addTagResponse.status).toBe(204);
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/ai/threads/thread%2F1/tags", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({}),
          }),
        )
      ).status,
    ).toBe(400);
    const removeTagResponse = await handler(
      new Request("http://127.0.0.1/api/v1/ai/threads/thread%2F1/tags/tag%2F1", {
        method: "DELETE",
        headers: authHeaders,
      }),
    );
    expect(removeTagResponse.status).toBe(204);

    await handler(
      new Request("http://127.0.0.1/api/v1/ai/tool-result", {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ threadId: "thread/1", toolCallId: "tool/1", resultPatch: null }),
      }),
    );
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/ai/tool-result", {
            method: "PATCH",
            headers: jsonHeaders,
            body: JSON.stringify({ threadId: "thread/1", toolCallId: "tool/1" }),
          }),
        )
      ).status,
    ).toBe(400);

    expect(calls).toEqual([
      ["stream", { message: "hello" }],
      ["stream", { mode: "reject" }],
      ["stream", { mode: "throw-mid" }],
      ["stream", { mode: "serialize-error" }],
      ["stream", { mode: "cancel" }],
      ["list-threads", { cursor: "", limit: 0, search: "" }],
      ["get-thread", "thread/1"],
      ["get-thread", "missing"],
      ["messages", "thread/1"],
      ["update-thread", { threadId: "thread/1", request: { isPinned: true } }],
      ["delete-thread", "thread/1"],
      ["get-tags", "thread/1"],
      ["get-tags", "missing"],
      ["add-tag", { threadId: "thread/1", tag: "tag/1" }],
      ["remove-tag", { threadId: "thread/1", tag: "tag/1" }],
      ["tool-result", { threadId: "thread/1", toolCallId: "tool/1", resultPatch: null }],
    ]);
  });

  test("routes migrated alternative assets seam only when a service is provided", async () => {
    const calls: Array<[string, unknown]> = [];
    const enqueued: PortfolioJobConfig[] = [];
    const alternativeAssetService: AlternativeAssetService = {
      createAlternativeAsset(request) {
        calls.push(["create", request]);
        return { assetId: "asset-1", quoteId: "quote-1" };
      },
      updateValuation(assetId, request) {
        calls.push(["valuation", { assetId, request }]);
        return { quoteId: "quote-2", valuationDate: "2026-05-14", value: "125000.00" };
      },
      deleteAlternativeAsset(assetId) {
        calls.push(["delete", assetId]);
      },
      linkLiability(liabilityId, request) {
        calls.push(["link", { liabilityId, request }]);
      },
      unlinkLiability(liabilityId) {
        calls.push(["unlink", liabilityId]);
      },
      updateAssetDetails(request) {
        calls.push(["metadata", request]);
      },
      getAlternativeHoldings() {
        calls.push(["holdings", null]);
        return [
          {
            id: "asset-1",
            kind: "property",
            name: "Cabin",
            symbol: "Property",
            currency: "USD",
            marketValue: "125000.00",
            valuationDate: "2026-05-14T00:00:00Z",
            metadata: { city: "Paris" },
            notes: null,
          },
        ];
      },
    };
    const handler = createBackendRequestHandler(config, {
      alternativeAssetService,
      portfolioJobService: {
        enqueuePortfolioJob(config) {
          enqueued.push(config);
        },
      },
    });

    expect(
      (await handler(new Request("http://127.0.0.1/api/v1/alternative-holdings"))).status,
    ).toBe(401);
    expect(
      (
        await createBackendRequestHandler(config)(
          new Request("http://127.0.0.1/api/v1/alternative-holdings", {
            headers: { authorization: "Bearer sidecar-token" },
          }),
        )
      ).status,
    ).toBe(404);

    const createResponse = await handler(
      new Request("http://127.0.0.1/api/v1/alternative-assets", {
        method: "POST",
        headers: {
          authorization: "Bearer sidecar-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          kind: "property",
          name: "Cabin",
          currency: "USD",
          currentValue: "125000.00",
          valueDate: "2026-05-14",
          purchasePrice: "100000.00",
          purchaseDate: "2024-01-01",
          metadata: { city: "Paris" },
          linkedAssetId: "liability-1",
        }),
      }),
    );
    expect(createResponse.status).toBe(200);
    expect(await createResponse.json()).toEqual({ assetId: "asset-1", quoteId: "quote-1" });

    const valuationResponse = await handler(
      new Request("http://127.0.0.1/api/v1/alternative-assets/asset%2F1/valuation", {
        method: "PUT",
        headers: {
          authorization: "Bearer sidecar-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ value: "125000.00", date: "2026-05-14", notes: "Appraisal" }),
      }),
    );
    expect(await valuationResponse.json()).toEqual({
      quoteId: "quote-2",
      valuationDate: "2026-05-14",
      value: "125000.00",
    });

    const linkResponse = await handler(
      new Request("http://127.0.0.1/api/v1/alternative-assets/liability%2F1/link-liability", {
        method: "POST",
        headers: {
          authorization: "Bearer sidecar-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ targetAssetId: "asset-1" }),
      }),
    );
    expect(linkResponse.status).toBe(204);

    const unlinkResponse = await handler(
      new Request("http://127.0.0.1/api/v1/alternative-assets/liability%2F1/link-liability", {
        method: "DELETE",
        headers: { authorization: "Bearer sidecar-token" },
      }),
    );
    expect(unlinkResponse.status).toBe(204);

    const metadataResponse = await handler(
      new Request("http://127.0.0.1/api/v1/alternative-assets/asset%2F1/metadata", {
        method: "PUT",
        headers: {
          authorization: "Bearer sidecar-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ metadata: { city: "" }, name: "Cabin 2", notes: null }),
      }),
    );
    expect(metadataResponse.status).toBe(204);

    const deleteResponse = await handler(
      new Request("http://127.0.0.1/api/v1/alternative-assets/asset%2F1", {
        method: "DELETE",
        headers: { authorization: "Bearer sidecar-token" },
      }),
    );
    expect(deleteResponse.status).toBe(204);

    const holdingsResponse = await handler(
      new Request("http://127.0.0.1/api/v1/alternative-holdings", {
        headers: { authorization: "Bearer sidecar-token" },
      }),
    );
    expect(await holdingsResponse.json()).toEqual([
      {
        id: "asset-1",
        kind: "property",
        name: "Cabin",
        symbol: "Property",
        currency: "USD",
        marketValue: "125000.00",
        valuationDate: "2026-05-14T00:00:00Z",
        metadata: { city: "Paris" },
        notes: null,
      },
    ]);

    const invalidResponse = await handler(
      new Request("http://127.0.0.1/api/v1/alternative-assets", {
        method: "POST",
        headers: {
          authorization: "Bearer sidecar-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ kind: "stock" }),
      }),
    );
    expect(invalidResponse.status).toBe(400);
    expect(calls).toEqual([
      [
        "create",
        {
          kind: "property",
          name: "Cabin",
          currency: "USD",
          currentValue: "125000.00",
          valueDate: "2026-05-14",
          purchasePrice: "100000.00",
          purchaseDate: "2024-01-01",
          metadata: { city: "Paris" },
          linkedAssetId: "liability-1",
        },
      ],
      [
        "valuation",
        {
          assetId: "asset/1",
          request: { value: "125000.00", date: "2026-05-14", notes: "Appraisal" },
        },
      ],
      ["link", { liabilityId: "liability/1", request: { targetAssetId: "asset-1" } }],
      ["unlink", "liability/1"],
      ["metadata", { assetId: "asset/1", metadata: { city: null }, name: "Cabin 2" }],
      ["delete", "asset/1"],
      ["holdings", null],
    ]);
    const incrementalRecalculation: PortfolioJobConfig = {
      accountIds: null,
      marketSyncMode: { type: "none" },
      snapshotMode: "incremental_from_last",
      valuationMode: "incremental_from_last",
      sinceDate: null,
    };
    expect(enqueued).toEqual([
      incrementalRecalculation,
      incrementalRecalculation,
      incrementalRecalculation,
    ]);
  });

  test("routes migrated assets seam only when a service is provided", async () => {
    const calls: Array<[string, unknown]> = [];
    const asset = {
      id: "asset-1",
      kind: "INVESTMENT",
      name: "Apple",
      quoteMode: "MARKET",
      quoteCcy: "USD",
      createdAt: "2026-05-14T00:00:00",
      updatedAt: "2026-05-14T00:00:00",
    };
    const assetService: AssetService = {
      listAssets() {
        calls.push(["list", null]);
        return [asset];
      },
      getAssetProfile(assetId) {
        calls.push(["profile", assetId]);
        return { ...asset, id: assetId };
      },
      createAsset(request) {
        calls.push(["create", request]);
        return { ...asset, id: request.id ?? "asset-2" };
      },
      updateAssetProfile(assetId, profile) {
        calls.push(["update", { assetId, profile }]);
        return { ...asset, id: assetId, ...profile };
      },
      updateQuoteMode(assetId, quoteMode) {
        calls.push(["quote-mode", { assetId, quoteMode }]);
        return { ...asset, id: assetId, quoteMode };
      },
      deleteAsset(assetId) {
        calls.push(["delete", assetId]);
      },
    };
    const handler = createBackendRequestHandler(config, { assetService });

    expect((await handler(new Request("http://127.0.0.1/api/v1/assets"))).status).toBe(401);
    expect(
      (
        await createBackendRequestHandler(config)(
          new Request("http://127.0.0.1/api/v1/assets", {
            headers: { authorization: "Bearer sidecar-token" },
          }),
        )
      ).status,
    ).toBe(404);

    const listResponse = await handler(
      new Request("http://127.0.0.1/api/v1/assets", {
        headers: { authorization: "Bearer sidecar-token" },
      }),
    );
    expect(await listResponse.json()).toEqual([asset]);

    const createResponse = await handler(
      new Request("http://127.0.0.1/api/v1/assets", {
        method: "POST",
        headers: {
          authorization: "Bearer sidecar-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          id: "asset/2",
          kind: "INVESTMENT",
          quoteMode: "MARKET",
          quoteCcy: "USD",
          name: "Apple",
          providerConfig: { source: "manual" },
          metadata: { sector: "Tech" },
        }),
      }),
    );
    expect((await createResponse.json()).id).toBe("asset/2");

    const profileResponse = await handler(
      new Request("http://127.0.0.1/api/v1/assets/profile?assetId=asset%2F2", {
        headers: { authorization: "Bearer sidecar-token" },
      }),
    );
    expect((await profileResponse.json()).id).toBe("asset/2");

    const updateResponse = await handler(
      new Request("http://127.0.0.1/api/v1/assets/profile/asset%2F2", {
        method: "PUT",
        headers: {
          authorization: "Bearer sidecar-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          notes: "",
          name: null,
          displayCode: "AAPL",
          quoteMode: null,
          providerConfig: null,
          metadata: { logo: "apple" },
        }),
      }),
    );
    expect(updateResponse.status).toBe(200);

    const quoteModeResponse = await handler(
      new Request("http://127.0.0.1/api/v1/assets/pricing-mode/asset%2F2", {
        method: "PUT",
        headers: {
          authorization: "Bearer sidecar-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ pricingMode: "MANUAL" }),
      }),
    );
    expect((await quoteModeResponse.json()).quoteMode).toBe("MANUAL");

    const deleteResponse = await handler(
      new Request("http://127.0.0.1/api/v1/assets/asset%2F2", {
        method: "DELETE",
        headers: { authorization: "Bearer sidecar-token" },
      }),
    );
    expect(deleteResponse.status).toBe(204);

    const reservedDeleteResponse = await handler(
      new Request("http://127.0.0.1/api/v1/assets/profile", {
        method: "DELETE",
        headers: { authorization: "Bearer sidecar-token" },
      }),
    );
    expect(reservedDeleteResponse.status).toBe(404);
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/assets/pricing-mode", {
            method: "DELETE",
            headers: { authorization: "Bearer sidecar-token" },
          }),
        )
      ).status,
    ).toBe(404);

    const missingQueryResponse = await handler(
      new Request("http://127.0.0.1/api/v1/assets/profile", {
        headers: { authorization: "Bearer sidecar-token" },
      }),
    );
    expect(missingQueryResponse.status).toBe(400);

    const invalidCreateResponse = await handler(
      new Request("http://127.0.0.1/api/v1/assets", {
        method: "POST",
        headers: {
          authorization: "Bearer sidecar-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          kind: "INVESTMENT",
          quoteMode: "MARKET",
          quoteCcy: "USD",
          isActive: null,
        }),
      }),
    );
    expect(invalidCreateResponse.status).toBe(400);
    expect(calls).toEqual([
      ["list", null],
      [
        "create",
        {
          kind: "INVESTMENT",
          quoteMode: "MARKET",
          quoteCcy: "USD",
          id: "asset/2",
          name: "Apple",
          isActive: true,
          providerConfig: { source: "manual" },
          metadata: { sector: "Tech" },
        },
      ],
      ["profile", "asset/2"],
      [
        "update",
        {
          assetId: "asset/2",
          profile: { notes: "", displayCode: "AAPL", metadata: { logo: "apple" } },
        },
      ],
      ["quote-mode", { assetId: "asset/2", quoteMode: "MANUAL" }],
      ["delete", "asset/2"],
    ]);
  });

  test("routes migrated app utility seam only when a service is provided", async () => {
    const calls: Array<[string, unknown]> = [];
    const appUtilityService: AppUtilityService = {
      getAppInfo() {
        calls.push(["info", null]);
        return { version: "1.0.0", dbPath: "/tmp/wealthfolio.db", logsDir: "/tmp/logs" };
      },
      checkUpdate(force) {
        calls.push(["check-update", force]);
        return {
          updateAvailable: false,
          latestVersion: "1.0.0",
          notes: null,
          pubDate: null,
          downloadUrl: null,
          changelogUrl: null,
          screenshots: null,
        };
      },
      backupDatabase() {
        calls.push(["backup", null]);
        return { filename: "wealthfolio_backup.db", dataB64: "YmFja3Vw" };
      },
      backupDatabaseToPath(backupDir) {
        calls.push(["backup-to-path", backupDir]);
        return { path: `${backupDir}/wealthfolio_backup.db` };
      },
      restoreDatabase(backupFilePath) {
        calls.push(["restore", backupFilePath]);
      },
    };
    const handler = createBackendRequestHandler(config, { appUtilityService });

    expect((await handler(new Request("http://127.0.0.1/api/v1/app/info"))).status).toBe(401);
    expect(
      (
        await createBackendRequestHandler(config)(
          new Request("http://127.0.0.1/api/v1/app/info", {
            headers: { authorization: "Bearer sidecar-token" },
          }),
        )
      ).status,
    ).toBe(404);

    const appInfoResponse = await handler(
      new Request("http://127.0.0.1/api/v1/app/info", {
        headers: { authorization: "Bearer sidecar-token" },
      }),
    );
    expect(await appInfoResponse.json()).toEqual({
      version: "1.0.0",
      dbPath: "/tmp/wealthfolio.db",
      logsDir: "/tmp/logs",
    });

    const updateResponse = await handler(
      new Request("http://127.0.0.1/api/v1/app/check-update?force=true", {
        headers: { authorization: "Bearer sidecar-token" },
      }),
    );
    expect(await updateResponse.json()).toEqual({
      updateAvailable: false,
      latestVersion: "1.0.0",
      notes: null,
      pubDate: null,
      downloadUrl: null,
      changelogUrl: null,
      screenshots: null,
    });

    const backupResponse = await handler(
      new Request("http://127.0.0.1/api/v1/utilities/database/backup", {
        method: "POST",
        headers: { authorization: "Bearer sidecar-token" },
      }),
    );
    expect(await backupResponse.json()).toEqual({
      filename: "wealthfolio_backup.db",
      dataB64: "YmFja3Vw",
    });

    const backupToPathResponse = await handler(
      new Request("http://127.0.0.1/api/v1/utilities/database/backup-to-path", {
        method: "POST",
        headers: {
          authorization: "Bearer sidecar-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ backupDir: "/tmp/backups" }),
      }),
    );
    expect(await backupToPathResponse.json()).toEqual({
      path: "/tmp/backups/wealthfolio_backup.db",
    });

    const restoreResponse = await handler(
      new Request("http://127.0.0.1/api/v1/utilities/database/restore", {
        method: "POST",
        headers: {
          authorization: "Bearer sidecar-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ backupFilePath: "/tmp/backups/wealthfolio_backup.db" }),
      }),
    );
    expect(restoreResponse.status).toBe(204);

    const restoreUnavailableResponse = await createBackendRequestHandler(config, {
      appUtilityService: { ...appUtilityService, restoreDatabase: undefined },
    })(
      new Request("http://127.0.0.1/api/v1/utilities/database/restore", {
        method: "POST",
        headers: {
          authorization: "Bearer sidecar-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ backupFilePath: "/tmp/backups/wealthfolio_backup.db" }),
      }),
    );
    expect(restoreUnavailableResponse.status).toBe(501);

    const invalidResponse = await handler(
      new Request("http://127.0.0.1/api/v1/utilities/database/backup-to-path", {
        method: "POST",
        headers: {
          authorization: "Bearer sidecar-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      }),
    );
    expect(invalidResponse.status).toBe(400);
    expect(calls).toEqual([
      ["info", null],
      ["check-update", true],
      ["backup", null],
      ["backup-to-path", "/tmp/backups"],
      ["restore", "/tmp/backups/wealthfolio_backup.db"],
    ]);
  });

  test("routes migrated secrets seam only when a service is provided", async () => {
    const secrets = new Map<string, string>();
    const secretService: SecretService = {
      setSecret(secretKey, secret) {
        secrets.set(secretKey, secret);
      },
      getSecret(secretKey) {
        return secrets.get(secretKey) ?? null;
      },
      deleteSecret(secretKey) {
        secrets.delete(secretKey);
      },
    };
    const handler = createBackendRequestHandler(config, { secretService });

    expect((await handler(new Request("http://127.0.0.1/api/v1/secrets"))).status).toBe(401);

    const setResponse = await handler(
      new Request("http://127.0.0.1/api/v1/secrets", {
        method: "POST",
        headers: {
          authorization: "Bearer sidecar-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ secretKey: "provider/key", secret: "secret-value" }),
      }),
    );
    expect(setResponse.status).toBe(204);

    const getResponse = await handler(
      new Request("http://127.0.0.1/api/v1/secrets?secretKey=provider%2Fkey", {
        headers: { authorization: "Bearer sidecar-token" },
      }),
    );
    expect(await getResponse.json()).toBe("secret-value");

    const deleteResponse = await handler(
      new Request("http://127.0.0.1/api/v1/secrets?secretKey=provider%2Fkey", {
        method: "DELETE",
        headers: { authorization: "Bearer sidecar-token" },
      }),
    );
    expect(deleteResponse.status).toBe(204);

    const missingResponse = await handler(
      new Request("http://127.0.0.1/api/v1/secrets", {
        headers: { authorization: "Bearer sidecar-token" },
      }),
    );
    expect(missingResponse.status).toBe(400);
  });

  test("routes migrated sync crypto seam only when a service is provided", async () => {
    const calls: Array<[string, unknown]> = [];
    const syncCryptoService: SyncCryptoService = {
      generateRootKey() {
        calls.push(["generate-root-key", undefined]);
        return { value: "root-key" };
      },
      deriveDek(rootKey, version) {
        calls.push(["derive-dek", { rootKey, version }]);
        return { value: `${rootKey}:${version}` };
      },
      generateKeypair() {
        calls.push(["generate-keypair", undefined]);
        return { publicKey: "public-key", secretKey: "secret-key" };
      },
      computeSharedSecret(ourSecret, theirPublic) {
        calls.push(["compute-shared-secret", { ourSecret, theirPublic }]);
        return { value: `${ourSecret}:${theirPublic}` };
      },
      deriveSessionKey(sharedSecret, context) {
        calls.push(["derive-session-key", { sharedSecret, context }]);
        return { value: `${sharedSecret}:${context}` };
      },
      encrypt(key, plaintext) {
        calls.push(["encrypt", { key, plaintext }]);
        return { value: "ciphertext" };
      },
      decrypt(key, ciphertext) {
        calls.push(["decrypt", { key, ciphertext }]);
        if (ciphertext === "bad") {
          throw new Error("invalid ciphertext");
        }
        return { value: "plaintext" };
      },
      generatePairingCode() {
        calls.push(["generate-pairing-code", undefined]);
        return { value: "123456" };
      },
      hashPairingCode(code) {
        calls.push(["hash-pairing-code", code]);
        return { value: `hash:${code}` };
      },
      hmacSha256(key, data) {
        calls.push(["hmac-sha256", { key, data }]);
        return { value: `${key}:${data}` };
      },
      computeSas(sharedSecret) {
        calls.push(["compute-sas", sharedSecret]);
        return { value: "123-456" };
      },
      generateDeviceId() {
        calls.push(["generate-device-id", undefined]);
        return { value: "device-1" };
      },
    };
    const handler = createBackendRequestHandler(config, { syncCryptoService });
    const authHeaders = { authorization: "Bearer sidecar-token" };
    const jsonHeaders = { ...authHeaders, "content-type": "application/json" };

    expect(
      (await handler(new Request("http://127.0.0.1/api/v1/sync/crypto/generate-root-key"))).status,
    ).toBe(401);
    expect(
      (
        await createBackendRequestHandler(config)(
          new Request("http://127.0.0.1/api/v1/sync/crypto/generate-root-key", {
            method: "POST",
            headers: authHeaders,
          }),
        )
      ).status,
    ).toBe(404);

    const rootKeyResponse = await handler(
      new Request("http://127.0.0.1/api/v1/sync/crypto/generate-root-key", {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: "not json",
      }),
    );
    expect(await rootKeyResponse.json()).toEqual({ value: "root-key" });

    await handler(
      new Request("http://127.0.0.1/api/v1/sync/crypto/derive-dek", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ rootKey: "", version: 4_294_967_295 }),
      }),
    );
    for (const body of [
      { root_key: "root-key", version: 1 },
      { rootKey: 123, version: 1 },
      { rootKey: "root-key", version: "1" },
      { rootKey: "root-key", version: null },
      { rootKey: "root-key", version: 1.5 },
      { rootKey: "root-key", version: -1 },
      { rootKey: "root-key", version: 4_294_967_296 },
    ]) {
      expect(
        (
          await handler(
            new Request("http://127.0.0.1/api/v1/sync/crypto/derive-dek", {
              method: "POST",
              headers: jsonHeaders,
              body: JSON.stringify(body),
            }),
          )
        ).status,
      ).toBe(400);
    }

    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/sync/crypto/generate-keypair", {
            method: "POST",
            headers: authHeaders,
          }),
        )
      ).json(),
    ).resolves.toEqual({ publicKey: "public-key", secretKey: "secret-key" });
    await handler(
      new Request("http://127.0.0.1/api/v1/sync/crypto/compute-shared-secret", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ ourSecret: "", theirPublic: "" }),
      }),
    );
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/sync/crypto/compute-shared-secret", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ our_secret: "", their_public: "" }),
          }),
        )
      ).status,
    ).toBe(400);
    await handler(
      new Request("http://127.0.0.1/api/v1/sync/crypto/derive-session-key", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ sharedSecret: "", context: "" }),
      }),
    );
    await handler(
      new Request("http://127.0.0.1/api/v1/sync/crypto/encrypt", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ key: "", plaintext: "" }),
      }),
    );
    await handler(
      new Request("http://127.0.0.1/api/v1/sync/crypto/decrypt", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ key: "", ciphertext: "" }),
      }),
    );
    const decryptErrorResponse = await handler(
      new Request("http://127.0.0.1/api/v1/sync/crypto/decrypt", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ key: "", ciphertext: "bad" }),
      }),
    );
    expect(decryptErrorResponse.status).toBe(400);
    await expect(decryptErrorResponse.json()).resolves.toEqual({
      code: 400,
      message: "invalid ciphertext",
    });
    await handler(
      new Request("http://127.0.0.1/api/v1/sync/crypto/generate-pairing-code", {
        method: "POST",
        headers: authHeaders,
      }),
    );
    await handler(
      new Request("http://127.0.0.1/api/v1/sync/crypto/hash-pairing-code", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ code: "" }),
      }),
    );
    await handler(
      new Request("http://127.0.0.1/api/v1/sync/crypto/hmac-sha256", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ key: "", data: "" }),
      }),
    );
    await handler(
      new Request("http://127.0.0.1/api/v1/sync/crypto/compute-sas", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ sharedSecret: "" }),
      }),
    );
    await handler(
      new Request("http://127.0.0.1/api/v1/sync/crypto/generate-device-id", {
        method: "POST",
        headers: authHeaders,
      }),
    );

    expect(calls).toEqual([
      ["generate-root-key", undefined],
      ["derive-dek", { rootKey: "", version: 4_294_967_295 }],
      ["generate-keypair", undefined],
      ["compute-shared-secret", { ourSecret: "", theirPublic: "" }],
      ["derive-session-key", { sharedSecret: "", context: "" }],
      ["encrypt", { key: "", plaintext: "" }],
      ["decrypt", { key: "", ciphertext: "" }],
      ["decrypt", { key: "", ciphertext: "bad" }],
      ["generate-pairing-code", undefined],
      ["hash-pairing-code", ""],
      ["hmac-sha256", { key: "", data: "" }],
      ["compute-sas", ""],
      ["generate-device-id", undefined],
    ]);
  });

  test("routes migrated Connect broker and session seam only when a service is provided", async () => {
    const calls: Array<[string, unknown]> = [];
    let syncBrokerDataStatus: ConnectSyncBrokerDataStatus = "accepted";
    const connectService: ConnectService = {
      storeSyncSession(refreshToken) {
        calls.push(["store-session", refreshToken]);
      },
      clearSyncSession() {
        calls.push(["clear-session", undefined]);
      },
      getSyncSessionStatus() {
        calls.push(["session-status", undefined]);
        return { isConfigured: true };
      },
      restoreSyncSession() {
        calls.push(["restore-session", undefined]);
        return { accessToken: "access-token", refreshToken: "refresh-token" };
      },
      listBrokerConnections() {
        calls.push(["list-connections", undefined]);
        return [{ id: "connection-1" }];
      },
      listBrokerAccounts() {
        calls.push(["list-accounts", undefined]);
        return [{ id: "account-1" }];
      },
      syncBrokerData() {
        calls.push(["sync-data", undefined]);
        return { status: syncBrokerDataStatus };
      },
      syncBrokerConnections() {
        calls.push(["sync-connections", undefined]);
        return { created: 1 };
      },
      syncBrokerAccounts() {
        calls.push(["sync-accounts", undefined]);
        return { created: 2 };
      },
      syncBrokerActivities() {
        calls.push(["sync-activities", undefined]);
        return { activitiesUpserted: 3 };
      },
      getSyncedAccounts() {
        calls.push(["synced-accounts", undefined]);
        return [{ id: "local-account" }];
      },
      getPlatforms() {
        calls.push(["platforms", undefined]);
        return [{ id: "platform-1" }];
      },
      getBrokerSyncStates() {
        calls.push(["sync-states", undefined]);
        return [{ sourceSystem: "snaptrade" }];
      },
      getImportRuns(request) {
        calls.push(["import-runs", request]);
        return [{ id: "run-1" }];
      },
      getBrokerSyncProfile(accountId, sourceSystem) {
        calls.push(["broker-sync-profile", { accountId, sourceSystem }]);
        return { accountId, sourceSystem, rules: [] };
      },
      saveBrokerSyncProfileRules(request) {
        calls.push(["save-broker-sync-profile", request]);
        return { rules: request.rules };
      },
      getSubscriptionPlans() {
        calls.push(["plans", undefined]);
        return { plans: [{ id: "pro" }] };
      },
      getSubscriptionPlansPublic() {
        calls.push(["plans-public", undefined]);
        return { plans: [{ id: "free" }] };
      },
      getUserInfo() {
        calls.push(["user-info", undefined]);
        return { id: "user-1" };
      },
    };
    const handler = createBackendRequestHandler(config, { connectService });
    const authHeaders = { authorization: "Bearer sidecar-token" };
    const jsonHeaders = { ...authHeaders, "content-type": "application/json" };

    expect(
      (await handler(new Request("http://127.0.0.1/api/v1/connect/session/status"))).status,
    ).toBe(401);
    expect(
      (
        await createBackendRequestHandler(config)(
          new Request("http://127.0.0.1/api/v1/connect/session/status", {
            headers: { authorization: "Bearer wrong-token" },
          }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await createBackendRequestHandler(config)(
          new Request("http://127.0.0.1/api/v1/connect/session/status", {
            headers: authHeaders,
          }),
        )
      ).status,
    ).toBe(404);

    const storeResponse = await handler(
      new Request("http://127.0.0.1/api/v1/connect/session", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ refreshToken: "refresh-token" }),
      }),
    );
    expect(storeResponse.status).toBe(200);
    expect(await storeResponse.text()).toBe("null");
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/connect/session", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ refresh_token: "refresh-token" }),
          }),
        )
      ).status,
    ).toBe(400);

    const clearResponse = await handler(
      new Request("http://127.0.0.1/api/v1/connect/session", {
        method: "DELETE",
        headers: authHeaders,
      }),
    );
    expect(clearResponse.status).toBe(200);
    expect(await clearResponse.text()).toBe("null");
    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/connect/session/status", {
            headers: authHeaders,
          }),
        )
      ).json(),
    ).resolves.toEqual({ isConfigured: true });
    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/connect/session/restore", {
            headers: authHeaders,
          }),
        )
      ).json(),
    ).resolves.toEqual({ accessToken: "access-token", refreshToken: "refresh-token" });

    for (const [path, expected] of [
      ["/api/v1/connect/connections", [{ id: "connection-1" }]],
      ["/api/v1/connect/accounts", [{ id: "account-1" }]],
      ["/api/v1/connect/synced-accounts", [{ id: "local-account" }]],
      ["/api/v1/connect/platforms", [{ id: "platform-1" }]],
      ["/api/v1/connect/sync-states", [{ sourceSystem: "snaptrade" }]],
      ["/api/v1/connect/plans", { plans: [{ id: "pro" }] }],
      ["/api/v1/connect/plans/public", { plans: [{ id: "free" }] }],
      ["/api/v1/connect/user", { id: "user-1" }],
    ] as const) {
      await expect(
        (
          await handler(
            new Request(`http://127.0.0.1${path}`, {
              headers: authHeaders,
            }),
          )
        ).json(),
      ).resolves.toEqual(expected);
    }

    const syncResponse = await handler(
      new Request("http://127.0.0.1/api/v1/connect/sync", {
        method: "POST",
        headers: authHeaders,
        body: "not-json",
      }),
    );
    expect(syncResponse.status).toBe(202);
    expect(await syncResponse.text()).toBe("");
    syncBrokerDataStatus = "forbidden";
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/connect/sync", {
            method: "POST",
            headers: authHeaders,
          }),
        )
      ).status,
    ).toBe(403);
    syncBrokerDataStatus = "not_implemented";
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/connect/sync", {
            method: "POST",
            headers: authHeaders,
          }),
        )
      ).status,
    ).toBe(501);
    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/connect/sync/connections", {
            method: "POST",
            headers: authHeaders,
            body: "not-json",
          }),
        )
      ).json(),
    ).resolves.toEqual({ created: 1 });
    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/connect/sync/accounts", {
            method: "POST",
            headers: authHeaders,
          }),
        )
      ).json(),
    ).resolves.toEqual({ created: 2 });
    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/connect/sync/activities", {
            method: "POST",
            headers: authHeaders,
          }),
        )
      ).json(),
    ).resolves.toEqual({ activitiesUpserted: 3 });

    await handler(
      new Request("http://127.0.0.1/api/v1/connect/import-runs", {
        headers: authHeaders,
      }),
    );
    await handler(
      new Request("http://127.0.0.1/api/v1/connect/import-runs?runType=broker&limit=10&offset=-1", {
        headers: authHeaders,
      }),
    );
    for (const query of ["limit=", "limit=1.5", "limit=9007199254740992"]) {
      expect(
        (
          await handler(
            new Request(`http://127.0.0.1/api/v1/connect/import-runs?${query}`, {
              headers: authHeaders,
            }),
          )
        ).status,
      ).toBe(400);
    }

    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/connect/broker-sync-profile?accountId=acct-1", {
            headers: authHeaders,
          }),
        )
      ).status,
    ).toBe(400);
    await expect(
      (
        await handler(
          new Request(
            "http://127.0.0.1/api/v1/connect/broker-sync-profile?accountId=acct-1&sourceSystem=snaptrade",
            { headers: authHeaders },
          ),
        )
      ).json(),
    ).resolves.toEqual({ accountId: "acct-1", sourceSystem: "snaptrade", rules: [] });
    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/connect/broker-sync-profile", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ rules: [{ id: "rule-1" }] }),
          }),
        )
      ).json(),
    ).resolves.toEqual({ rules: [{ id: "rule-1" }] });
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/connect/broker-sync-profile", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify([]),
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/connect/device/sync-state", {
            headers: authHeaders,
          }),
        )
      ).status,
    ).toBe(404);
    expect((await handler(new Request("http://127.0.0.1/api/v1/connect/device-foo"))).status).toBe(
      401,
    );

    expect(calls).toEqual([
      ["store-session", "refresh-token"],
      ["clear-session", undefined],
      ["session-status", undefined],
      ["restore-session", undefined],
      ["list-connections", undefined],
      ["list-accounts", undefined],
      ["synced-accounts", undefined],
      ["platforms", undefined],
      ["sync-states", undefined],
      ["plans", undefined],
      ["plans-public", undefined],
      ["user-info", undefined],
      ["sync-data", undefined],
      ["sync-data", undefined],
      ["sync-data", undefined],
      ["sync-connections", undefined],
      ["sync-accounts", undefined],
      ["sync-activities", undefined],
      ["import-runs", { limit: 50, offset: 0, runType: undefined }],
      ["import-runs", { limit: 10, offset: -1, runType: "broker" }],
      ["broker-sync-profile", { accountId: "acct-1", sourceSystem: "snaptrade" }],
      ["save-broker-sync-profile", { rules: [{ id: "rule-1" }] }],
    ]);
  });

  test("routes migrated Connect device sync seam only when a service is provided", async () => {
    const calls: Array<[string, unknown]> = [];
    const connectDeviceSyncService: ConnectDeviceSyncService = {
      getDeviceSyncState() {
        calls.push(["sync-state", undefined]);
        return { state: "READY" };
      },
      enableDeviceSync() {
        calls.push(["enable", undefined]);
        return { state: "READY", deviceId: "device-1" };
      },
      clearDeviceSyncData() {
        calls.push(["clear-sync-data", undefined]);
      },
      reinitializeDeviceSync() {
        calls.push(["reinitialize", undefined]);
        return { state: "READY", deviceId: "device-2" };
      },
      getDeviceSyncEngineStatus() {
        calls.push(["engine-status", undefined]);
        return { backgroundRunning: true };
      },
      getDeviceSyncPairingSourceStatus() {
        calls.push(["pairing-source-status", undefined]);
        return { status: "ready" };
      },
      getDeviceSyncBootstrapOverwriteCheck() {
        calls.push(["bootstrap-overwrite-check", undefined]);
        return { bootstrapRequired: false };
      },
      reconcileDeviceSyncReadyState(request) {
        calls.push(["reconcile-ready-state", request]);
        return { status: "ready", allowOverwrite: request.allowOverwrite };
      },
      bootstrapDeviceSnapshot() {
        calls.push(["bootstrap-snapshot", undefined]);
        return { status: "skipped" };
      },
      triggerDeviceSyncCycle() {
        calls.push(["trigger-cycle", undefined]);
        return { status: "ok", pushedCount: 0 };
      },
      startDeviceSyncBackgroundEngine() {
        calls.push(["start-background", undefined]);
        return { status: "started" };
      },
      stopDeviceSyncBackgroundEngine() {
        calls.push(["stop-background", undefined]);
        return { status: "stopped" };
      },
      generateDeviceSnapshotNow() {
        calls.push(["generate-snapshot", undefined]);
        return { status: "uploaded", snapshotId: "snapshot-1" };
      },
      cancelDeviceSnapshotUpload() {
        calls.push(["cancel-snapshot", undefined]);
        return { status: "cancel_requested" };
      },
    };
    const handler = createBackendRequestHandler(config, { connectDeviceSyncService });
    const authHeaders = { authorization: "Bearer sidecar-token" };
    const jsonHeaders = { ...authHeaders, "content-type": "application/json" };

    expect(
      (await handler(new Request("http://127.0.0.1/api/v1/connect/device/sync-state"))).status,
    ).toBe(401);
    expect(
      (
        await createBackendRequestHandler(config)(
          new Request("http://127.0.0.1/api/v1/connect/device/sync-state", {
            headers: authHeaders,
          }),
        )
      ).status,
    ).toBe(404);

    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/connect/device/sync-state", {
            headers: authHeaders,
          }),
        )
      ).json(),
    ).resolves.toEqual({ state: "READY" });
    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/connect/device/enable", {
            method: "POST",
            headers: authHeaders,
            body: "not-json",
          }),
        )
      ).json(),
    ).resolves.toEqual({ state: "READY", deviceId: "device-1" });

    const clearResponse = await handler(
      new Request("http://127.0.0.1/api/v1/connect/device/sync-data", {
        method: "DELETE",
        headers: authHeaders,
        body: "not-json",
      }),
    );
    expect(clearResponse.status).toBe(200);
    expect(clearResponse.headers.get("content-type")).toBe("application/json");
    expect(await clearResponse.text()).toBe("null");

    for (const [path, expected] of [
      ["/api/v1/connect/device/reinitialize", { state: "READY", deviceId: "device-2" }],
      ["/api/v1/connect/device/bootstrap-snapshot", { status: "skipped" }],
      ["/api/v1/connect/device/trigger-cycle", { status: "ok", pushedCount: 0 }],
      ["/api/v1/connect/device/start-background", { status: "started" }],
      ["/api/v1/connect/device/stop-background", { status: "stopped" }],
      [
        "/api/v1/connect/device/generate-snapshot",
        { status: "uploaded", snapshotId: "snapshot-1" },
      ],
      ["/api/v1/connect/device/cancel-snapshot", { status: "cancel_requested" }],
    ] as const) {
      await expect(
        (
          await handler(
            new Request(`http://127.0.0.1${path}`, {
              method: "POST",
              headers: authHeaders,
              body: "not-json",
            }),
          )
        ).json(),
      ).resolves.toEqual(expected);
    }

    for (const [path, expected] of [
      ["/api/v1/connect/device/engine-status", { backgroundRunning: true }],
      ["/api/v1/connect/device/pairing-source-status", { status: "ready" }],
      ["/api/v1/connect/device/bootstrap-overwrite-check", { bootstrapRequired: false }],
    ] as const) {
      await expect(
        (
          await handler(
            new Request(`http://127.0.0.1${path}`, {
              headers: authHeaders,
            }),
          )
        ).json(),
      ).resolves.toEqual(expected);
    }

    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/connect/device/reconcile-ready-state", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({}),
          }),
        )
      ).json(),
    ).resolves.toEqual({ status: "ready", allowOverwrite: false });
    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/connect/device/reconcile-ready-state", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ allowOverwrite: true }),
          }),
        )
      ).json(),
    ).resolves.toEqual({ status: "ready", allowOverwrite: true });
    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/connect/device/reconcile-ready-state", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ allow_overwrite: true }),
          }),
        )
      ).json(),
    ).resolves.toEqual({ status: "ready", allowOverwrite: false });
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/connect/device/reconcile-ready-state", {
            method: "POST",
            headers: authHeaders,
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/connect/device/reconcile-ready-state", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ allowOverwrite: "yes" }),
          }),
        )
      ).status,
    ).toBe(400);
    expect((await handler(new Request("http://127.0.0.1/api/v1/connect/devicefoo"))).status).toBe(
      401,
    );

    expect(calls).toEqual([
      ["sync-state", undefined],
      ["enable", undefined],
      ["clear-sync-data", undefined],
      ["reinitialize", undefined],
      ["bootstrap-snapshot", undefined],
      ["trigger-cycle", undefined],
      ["start-background", undefined],
      ["stop-background", undefined],
      ["generate-snapshot", undefined],
      ["cancel-snapshot", undefined],
      ["engine-status", undefined],
      ["pairing-source-status", undefined],
      ["bootstrap-overwrite-check", undefined],
      ["reconcile-ready-state", { allowOverwrite: false }],
      ["reconcile-ready-state", { allowOverwrite: true }],
      ["reconcile-ready-state", { allowOverwrite: false }],
    ]);
  });

  test("routes migrated device sync device management seam only when a service is provided", async () => {
    const calls: Array<[string, unknown]> = [];
    const deviceSyncService: DeviceSyncService = {
      registerDevice(request) {
        calls.push(["register", request]);
        return { kind: "ready", deviceId: "device-1" };
      },
      getCurrentDevice() {
        calls.push(["get-current", undefined]);
        return { id: "current-device" };
      },
      getDevice(deviceId) {
        calls.push(["get-device", deviceId]);
        if (deviceId === "missing") {
          throw new Error("No device ID configured");
        }
        return { id: deviceId };
      },
      listDevices(scope) {
        calls.push(["list-devices", scope]);
        return [{ id: "device-1" }];
      },
      updateDevice(deviceId, request) {
        calls.push(["update-device", { deviceId, request }]);
        return { success: true };
      },
      deleteDevice(deviceId) {
        calls.push(["delete-device", deviceId]);
        return { success: true };
      },
      revokeDevice(deviceId) {
        calls.push(["revoke-device", deviceId]);
        return { success: true };
      },
    };
    const handler = createBackendRequestHandler(config, { deviceSyncService });
    const authHeaders = { authorization: "Bearer sidecar-token" };
    const jsonHeaders = { ...authHeaders, "content-type": "application/json" };

    expect((await handler(new Request("http://127.0.0.1/api/v1/sync/devices"))).status).toBe(401);
    expect(
      (
        await createBackendRequestHandler(config)(
          new Request("http://127.0.0.1/api/v1/sync/devices", { headers: authHeaders }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await createBackendRequestHandler(config)(
          new Request("http://127.0.0.1/api/v1/sync/devices", {
            headers: { authorization: "Bearer wrong-token" },
          }),
        )
      ).status,
    ).toBe(401);

    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/sync/device/register", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({
              displayName: "MacBook",
              platform: "macos",
              osVersion: null,
              appVersion: "3.4.0",
              instanceId: "instance-1",
              ignored: true,
            }),
          }),
        )
      ).json(),
    ).resolves.toEqual({ kind: "ready", deviceId: "device-1" });
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/sync/device/register", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({
              display_name: "MacBook",
              platform: "macos",
              instanceId: "instance-1",
            }),
          }),
        )
      ).status,
    ).toBe(400);

    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/sync/device/current", { headers: authHeaders }),
        )
      ).json(),
    ).resolves.toEqual({ id: "current-device" });
    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/sync/device/device%3A1%2Ftwo", {
            headers: authHeaders,
          }),
        )
      ).json(),
    ).resolves.toEqual({ id: "device:1/two" });
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/sync/device/%E0%A4%A", {
            headers: authHeaders,
          }),
        )
      ).status,
    ).toBe(400);
    const missingDeviceResponse = await handler(
      new Request("http://127.0.0.1/api/v1/sync/device/missing", {
        headers: authHeaders,
      }),
    );
    expect(missingDeviceResponse.status).toBe(400);
    await expect(missingDeviceResponse.json()).resolves.toEqual({
      code: 400,
      message: "No device ID configured",
    });

    await handler(
      new Request("http://127.0.0.1/api/v1/sync/devices", {
        headers: authHeaders,
      }),
    );
    await handler(
      new Request("http://127.0.0.1/api/v1/sync/devices?scope=", {
        headers: authHeaders,
      }),
    );
    await handler(
      new Request("http://127.0.0.1/api/v1/sync/devices?scope=team", {
        headers: authHeaders,
      }),
    );

    for (const body of [
      {},
      { displayName: null },
      { displayName: "" },
      { displayName: "Renamed Device" },
    ]) {
      await expect(
        (
          await handler(
            new Request("http://127.0.0.1/api/v1/sync/device/device%3A1", {
              method: "PATCH",
              headers: jsonHeaders,
              body: JSON.stringify(body),
            }),
          )
        ).json(),
      ).resolves.toEqual({ success: true });
    }
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/sync/device/device%3A1", {
            method: "PATCH",
            headers: jsonHeaders,
            body: JSON.stringify({ displayName: 123 }),
          }),
        )
      ).status,
    ).toBe(400);
    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/sync/device/device%3A1", {
            method: "DELETE",
            headers: authHeaders,
          }),
        )
      ).json(),
    ).resolves.toEqual({ success: true });
    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/sync/device/device%3A1/revoke", {
            method: "POST",
            headers: authHeaders,
          }),
        )
      ).json(),
    ).resolves.toEqual({ success: true });

    for (const request of [
      new Request("http://127.0.0.1/api/v1/sync/device/register", { headers: authHeaders }),
      new Request("http://127.0.0.1/api/v1/sync/device/current", {
        method: "PATCH",
        headers: jsonHeaders,
        body: JSON.stringify({ displayName: "blocked" }),
      }),
      new Request("http://127.0.0.1/api/v1/sync/device", { headers: authHeaders }),
      new Request("http://127.0.0.1/api/v1/sync/device-foo", { headers: authHeaders }),
      new Request("http://127.0.0.1/api/v1/sync/keys/initialize", { headers: authHeaders }),
    ]) {
      expect((await handler(request)).status).toBe(404);
    }

    expect(calls).toEqual([
      [
        "register",
        {
          displayName: "MacBook",
          platform: "macos",
          osVersion: undefined,
          appVersion: "3.4.0",
          instanceId: "instance-1",
        },
      ],
      ["get-current", undefined],
      ["get-device", "device:1/two"],
      ["get-device", "missing"],
      ["list-devices", undefined],
      ["list-devices", ""],
      ["list-devices", "team"],
      ["update-device", { deviceId: "device:1", request: { displayName: undefined } }],
      ["update-device", { deviceId: "device:1", request: { displayName: undefined } }],
      ["update-device", { deviceId: "device:1", request: { displayName: "" } }],
      ["update-device", { deviceId: "device:1", request: { displayName: "Renamed Device" } }],
      ["delete-device", "device:1"],
      ["revoke-device", "device:1"],
    ]);
  });

  test("routes migrated device sync team key seam only when service methods are provided", async () => {
    const calls: Array<[string, unknown]> = [];
    const deviceSyncService: DeviceSyncService = {
      registerDevice() {
        throw new Error("not used");
      },
      getCurrentDevice() {
        throw new Error("not used");
      },
      getDevice() {
        throw new Error("not used");
      },
      listDevices() {
        throw new Error("not used");
      },
      updateDevice() {
        throw new Error("not used");
      },
      deleteDevice() {
        throw new Error("not used");
      },
      revokeDevice() {
        throw new Error("not used");
      },
      initializeTeamKeys() {
        calls.push(["initialize-team-keys", undefined]);
        return { status: "initialized" };
      },
      commitInitializeTeamKeys(request) {
        calls.push(["commit-initialize-team-keys", request]);
        return { success: true };
      },
      rotateTeamKeys() {
        calls.push(["rotate-team-keys", undefined]);
        return { status: "rotating" };
      },
      commitRotateTeamKeys(request) {
        calls.push(["commit-rotate-team-keys", request]);
        return { success: true };
      },
      resetTeamSync(request) {
        calls.push(["reset-team-sync", request]);
        return { success: true };
      },
    };
    const handler = createBackendRequestHandler(config, { deviceSyncService });
    const authHeaders = { authorization: "Bearer sidecar-token" };
    const jsonHeaders = { ...authHeaders, "content-type": "application/json" };

    expect(
      (await handler(new Request("http://127.0.0.1/api/v1/sync/keys/initialize"))).status,
    ).toBe(401);
    expect(
      (
        await createBackendRequestHandler(config)(
          new Request("http://127.0.0.1/api/v1/sync/keys/initialize", { headers: authHeaders }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await createBackendRequestHandler(config, {
          deviceSyncService: {
            registerDevice() {
              throw new Error("not used");
            },
            getCurrentDevice() {
              throw new Error("not used");
            },
            getDevice() {
              throw new Error("not used");
            },
            listDevices() {
              return [];
            },
            updateDevice() {
              throw new Error("not used");
            },
            deleteDevice() {
              throw new Error("not used");
            },
            revokeDevice() {
              throw new Error("not used");
            },
          },
        })(new Request("http://127.0.0.1/api/v1/sync/keys/initialize", { headers: authHeaders }))
      ).status,
    ).toBe(404);

    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/sync/keys/initialize", {
            method: "POST",
            headers: authHeaders,
            body: "not-json",
          }),
        )
      ).json(),
    ).resolves.toEqual({ status: "initialized" });
    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/sync/keys/rotate", {
            method: "POST",
            headers: authHeaders,
            body: "not-json",
          }),
        )
      ).json(),
    ).resolves.toEqual({ status: "rotating" });

    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/sync/keys/initialize/commit", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({
              keyVersion: 2_147_483_647,
              deviceKeyEnvelope: "envelope",
              signature: "signature",
              challengeResponse: null,
              recoveryEnvelope: "recovery",
              ignored: true,
            }),
          }),
        )
      ).json(),
    ).resolves.toEqual({ success: true });
    for (const body of [
      { key_version: 1, deviceKeyEnvelope: "envelope", signature: "signature" },
      { keyVersion: 2_147_483_648, deviceKeyEnvelope: "envelope", signature: "signature" },
      { keyVersion: 1, deviceKeyEnvelope: 123, signature: "signature" },
    ]) {
      expect(
        (
          await handler(
            new Request("http://127.0.0.1/api/v1/sync/keys/initialize/commit", {
              method: "POST",
              headers: jsonHeaders,
              body: JSON.stringify(body),
            }),
          )
        ).status,
      ).toBe(400);
    }

    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/sync/keys/rotate/commit", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({
              newKeyVersion: -2_147_483_648,
              envelopes: [{ deviceId: "device-1", deviceKeyEnvelope: "envelope-1" }],
              signature: "signature",
              challengeResponse: "challenge",
            }),
          }),
        )
      ).json(),
    ).resolves.toEqual({ success: true });
    for (const body of [
      { newKeyVersion: 1, envelopes: "not-array", signature: "signature" },
      { newKeyVersion: 1, envelopes: [{ device_id: "device-1" }], signature: "signature" },
      { newKeyVersion: 1, envelopes: [], signature: 123 },
    ]) {
      expect(
        (
          await handler(
            new Request("http://127.0.0.1/api/v1/sync/keys/rotate/commit", {
              method: "POST",
              headers: jsonHeaders,
              body: JSON.stringify(body),
            }),
          )
        ).status,
      ).toBe(400);
    }

    for (const body of [{}, { reason: null }, { reason: "user-request" }]) {
      await expect(
        (
          await handler(
            new Request("http://127.0.0.1/api/v1/sync/team/reset", {
              method: "POST",
              headers: jsonHeaders,
              body: JSON.stringify(body),
            }),
          )
        ).json(),
      ).resolves.toEqual({ success: true });
    }
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/sync/team/reset", {
            method: "POST",
            headers: authHeaders,
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/sync/team/reset", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ reason: 123 }),
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/sync/pairing", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ codeHash: "hash", ephemeralPublicKey: "key" }),
          }),
        )
      ).status,
    ).toBe(404);

    expect(calls).toEqual([
      ["initialize-team-keys", undefined],
      ["rotate-team-keys", undefined],
      [
        "commit-initialize-team-keys",
        {
          keyVersion: 2_147_483_647,
          deviceKeyEnvelope: "envelope",
          signature: "signature",
          challengeResponse: undefined,
          recoveryEnvelope: "recovery",
        },
      ],
      [
        "commit-rotate-team-keys",
        {
          newKeyVersion: -2_147_483_648,
          envelopes: [{ deviceId: "device-1", deviceKeyEnvelope: "envelope-1" }],
          signature: "signature",
          challengeResponse: "challenge",
        },
      ],
      ["reset-team-sync", { reason: undefined }],
      ["reset-team-sync", { reason: undefined }],
      ["reset-team-sync", { reason: "user-request" }],
    ]);
  });

  test("routes migrated device sync pairing seam only when service methods are provided", async () => {
    const calls: Array<[string, unknown]> = [];
    const deviceSyncService: DeviceSyncService = {
      registerDevice() {
        throw new Error("not used");
      },
      getCurrentDevice() {
        throw new Error("not used");
      },
      getDevice() {
        throw new Error("not used");
      },
      listDevices() {
        throw new Error("not used");
      },
      updateDevice() {
        throw new Error("not used");
      },
      deleteDevice() {
        throw new Error("not used");
      },
      revokeDevice() {
        throw new Error("not used");
      },
      createPairing(request) {
        calls.push(["create-pairing", request]);
        return { id: "pairing-1" };
      },
      getPairing(pairingId) {
        calls.push(["get-pairing", pairingId]);
        return { id: pairingId };
      },
      approvePairing(pairingId) {
        calls.push(["approve-pairing", pairingId]);
        return { success: true };
      },
      completePairing(pairingId, request) {
        calls.push(["complete-pairing", { pairingId, request }]);
        return { success: true };
      },
      cancelPairing(pairingId) {
        calls.push(["cancel-pairing", pairingId]);
        return { success: true };
      },
      claimPairing(request) {
        calls.push(["claim-pairing", request]);
        return { id: "claimed" };
      },
      getPairingMessages(pairingId) {
        calls.push(["pairing-messages", pairingId]);
        return { messages: [] };
      },
      confirmPairing(pairingId, request) {
        calls.push(["confirm-pairing", { pairingId, request }]);
        return { success: true };
      },
      completePairingWithTransfer(request) {
        calls.push(["complete-pairing-with-transfer", request]);
        return { success: true };
      },
      confirmPairingWithBootstrap(request) {
        calls.push(["confirm-pairing-with-bootstrap", request]);
        return { status: "ready" };
      },
      beginPairingConfirm(request) {
        calls.push(["begin-pairing-confirm", request]);
        return { flowId: "flow-1" };
      },
      getPairingFlowState(request) {
        calls.push(["pairing-flow-state", request]);
        return { status: "waiting" };
      },
      approvePairingOverwrite(request) {
        calls.push(["approve-pairing-overwrite", request]);
        return { status: "approved" };
      },
      cancelPairingFlow(request) {
        calls.push(["cancel-pairing-flow", request]);
        return { status: "cancelled" };
      },
    };
    const handler = createBackendRequestHandler(config, { deviceSyncService });
    const authHeaders = { authorization: "Bearer sidecar-token" };
    const jsonHeaders = { ...authHeaders, "content-type": "application/json" };

    expect((await handler(new Request("http://127.0.0.1/api/v1/sync/pairing"))).status).toBe(401);
    expect(
      (
        await createBackendRequestHandler(config)(
          new Request("http://127.0.0.1/api/v1/sync/pairing", { headers: authHeaders }),
        )
      ).status,
    ).toBe(404);

    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/sync/pairing", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ codeHash: "hash", ephemeralPublicKey: "public-key" }),
          }),
        )
      ).json(),
    ).resolves.toEqual({ id: "pairing-1" });
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/sync/pairing", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ code_hash: "hash", ephemeralPublicKey: "public-key" }),
          }),
        )
      ).status,
    ).toBe(400);

    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/sync/pairing/pair%3A1%2Ftwo", {
            headers: authHeaders,
          }),
        )
      ).json(),
    ).resolves.toEqual({ id: "pair:1/two" });
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/sync/pairing/%E0%A4%A", {
            headers: authHeaders,
          }),
        )
      ).status,
    ).toBe(400);

    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/sync/pairing/pair%3A1/approve", {
            method: "POST",
            headers: authHeaders,
            body: "not-json",
          }),
        )
      ).json(),
    ).resolves.toEqual({ success: true });
    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/sync/pairing/pair%3A1/complete", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({
              encryptedKeyBundle: "bundle",
              sasProof: null,
              signature: "signature",
            }),
          }),
        )
      ).json(),
    ).resolves.toEqual({ success: true });
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/sync/pairing/pair%3A1/complete", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ encryptedKeyBundle: "bundle", signature: "signature" }),
          }),
        )
      ).status,
    ).toBe(400);
    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/sync/pairing/pair%3A1/cancel", {
            method: "POST",
            headers: authHeaders,
            body: "not-json",
          }),
        )
      ).json(),
    ).resolves.toEqual({ success: true });

    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/sync/pairing/claim", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ code: "123456", ephemeralPublicKey: "claimer-key" }),
          }),
        )
      ).json(),
    ).resolves.toEqual({ id: "claimed" });
    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/sync/pairing/pair%3A1/messages", {
            headers: authHeaders,
          }),
        )
      ).json(),
    ).resolves.toEqual({ messages: [] });
    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/sync/pairing/pair%3A1/confirm", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ proof: "proof", minSnapshotCreatedAt: null }),
          }),
        )
      ).json(),
    ).resolves.toEqual({ success: true });
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/sync/pairing/pair%3A1/confirm", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ minSnapshotCreatedAt: "2026-05-14T00:00:00Z" }),
          }),
        )
      ).status,
    ).toBe(400);

    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/sync/pairing/complete-with-transfer", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({
              pairingId: "pairing-1",
              encryptedKeyBundle: "bundle",
              sasProof: { ok: true },
              signature: "signature",
            }),
          }),
        )
      ).json(),
    ).resolves.toEqual({ success: true });
    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/sync/pairing/confirm-with-bootstrap", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({
              pairingId: "pairing-1",
              proof: null,
              minSnapshotCreatedAt: "2026-05-14T00:00:00Z",
              allowOverwrite: true,
            }),
          }),
        )
      ).json(),
    ).resolves.toEqual({ status: "ready" });
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/sync/pairing/confirm-with-bootstrap", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ pairingId: "pairing-1" }),
          }),
        )
      ).status,
    ).toBe(400);

    await expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/sync/pairing/flow/begin", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({
              pairingId: "pairing-1",
              proof: "proof",
              minSnapshotCreatedAt: undefined,
            }),
          }),
        )
      ).json(),
    ).resolves.toEqual({ flowId: "flow-1" });
    for (const [path, expected] of [
      ["/api/v1/sync/pairing/flow/state", { status: "waiting" }],
      ["/api/v1/sync/pairing/flow/approve-overwrite", { status: "approved" }],
      ["/api/v1/sync/pairing/flow/cancel", { status: "cancelled" }],
    ] as const) {
      await expect(
        (
          await handler(
            new Request(`http://127.0.0.1${path}`, {
              method: "POST",
              headers: jsonHeaders,
              body: JSON.stringify({ flowId: "flow-1" }),
            }),
          )
        ).json(),
      ).resolves.toEqual(expected);
    }
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/sync/pairing/flow/state", {
            method: "POST",
            headers: jsonHeaders,
            body: JSON.stringify({ flow_id: "flow-1" }),
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handler(
          new Request("http://127.0.0.1/api/v1/sync/pairing/flow", {
            headers: authHeaders,
          }),
        )
      ).status,
    ).toBe(404);

    expect(calls).toEqual([
      ["create-pairing", { codeHash: "hash", ephemeralPublicKey: "public-key" }],
      ["get-pairing", "pair:1/two"],
      ["approve-pairing", "pair:1"],
      [
        "complete-pairing",
        {
          pairingId: "pair:1",
          request: { encryptedKeyBundle: "bundle", sasProof: null, signature: "signature" },
        },
      ],
      ["cancel-pairing", "pair:1"],
      ["claim-pairing", { code: "123456", ephemeralPublicKey: "claimer-key" }],
      ["pairing-messages", "pair:1"],
      [
        "confirm-pairing",
        { pairingId: "pair:1", request: { proof: "proof", minSnapshotCreatedAt: undefined } },
      ],
      [
        "complete-pairing-with-transfer",
        {
          pairingId: "pairing-1",
          encryptedKeyBundle: "bundle",
          sasProof: { ok: true },
          signature: "signature",
        },
      ],
      [
        "confirm-pairing-with-bootstrap",
        {
          pairingId: "pairing-1",
          proof: undefined,
          minSnapshotCreatedAt: "2026-05-14T00:00:00Z",
          allowOverwrite: true,
        },
      ],
      [
        "begin-pairing-confirm",
        { pairingId: "pairing-1", proof: "proof", minSnapshotCreatedAt: undefined },
      ],
      ["pairing-flow-state", { flowId: "flow-1" }],
      ["approve-pairing-overwrite", { flowId: "flow-1" }],
      ["cancel-pairing-flow", { flowId: "flow-1" }],
    ]);
  });

  test("routes migrated goals CRUD, funding, and plan reads only when a service is provided", async () => {
    const db = createGoalsDb();
    const goalService = createGoalService(createGoalRepository(db), { baseCurrency: "USD" });
    const handler = createBackendRequestHandler(config, { goalService });

    try {
      expect((await handler(new Request("http://127.0.0.1/api/v1/goals"))).status).toBe(401);

      const createResponse = await handler(
        new Request("http://127.0.0.1/api/v1/goals", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            goalType: "custom_save_up",
            title: "Emergency Fund",
            targetAmount: 5000,
          }),
        }),
      );
      const created = await createResponse.json();
      expect(createResponse.status).toBe(200);
      expect(created).toMatchObject({
        goalType: "custom_save_up",
        title: "Emergency Fund",
        currency: "USD",
        statusLifecycle: "active",
      });

      const planResponse = await handler(
        new Request(`http://127.0.0.1/api/v1/goals/${created.id}/plan`, {
          headers: { authorization: "Bearer sidecar-token" },
        }),
      );
      expect(await planResponse.json()).toBeNull();

      const fundingResponse = await handler(
        new Request(`http://127.0.0.1/api/v1/goals/${created.id}/funding`, {
          method: "PUT",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify([{ accountId: "cash", sharePercent: 100, taxBucket: "taxable" }]),
        }),
      );
      expect(await fundingResponse.json()).toEqual([
        expect.objectContaining({ accountId: "cash", sharePercent: 100, taxBucket: null }),
      ]);

      const updateResponse = await handler(
        new Request("http://127.0.0.1/api/v1/goals", {
          method: "PUT",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({ ...created, title: "Emergency Fund Updated" }),
        }),
      );
      expect(await updateResponse.json()).toMatchObject({
        id: created.id,
        title: "Emergency Fund Updated",
        currency: "USD",
      });

      const listResponse = await handler(
        new Request("http://127.0.0.1/api/v1/goals", {
          headers: { authorization: "Bearer sidecar-token" },
        }),
      );
      expect(await listResponse.json()).toEqual([expect.objectContaining({ id: created.id })]);

      const savePlanResponse = await handler(
        new Request("http://127.0.0.1/api/v1/goals/plan", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            goalId: created.id,
            planKind: "save_up",
            settingsJson: '{"monthlyContribution":100}',
            summaryJson: null,
          }),
        }),
      );
      expect(savePlanResponse.status).toBe(200);
      await expect(savePlanResponse.json()).resolves.toMatchObject({
        goalId: created.id,
        planKind: "save_up",
        settingsJson: '{"monthlyContribution":100}',
        summaryJson: "{}",
        version: 1,
      });

      await expect(
        (
          await handler(
            new Request(`http://127.0.0.1/api/v1/goals/${created.id}/plan`, {
              headers: { authorization: "Bearer sidecar-token" },
            }),
          )
        ).json(),
      ).resolves.toMatchObject({ goalId: created.id, version: 1 });

      const invalidPlanResponse = await handler(
        new Request("http://127.0.0.1/api/v1/goals/plan", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({ goalId: created.id, planKind: "save_up" }),
        }),
      );
      expect(invalidPlanResponse.status).toBe(400);

      const previewResponse = await handler(
        new Request("http://127.0.0.1/api/v1/goals/save-up/preview", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            currentValue: 1000,
            targetAmount: 5000,
            targetDate: null,
            monthlyContribution: 250,
            expectedAnnualReturn: 0.05,
          }),
        }),
      );
      expect(previewResponse.status).toBe(200);
      await expect(previewResponse.json()).resolves.toMatchObject({
        currentValue: 1000,
        targetAmount: 5000,
        progress: 0.2,
        health: "not_applicable",
        projectedValueAtTargetDate: 0,
        requiredMonthlyContribution: 0,
        trajectory: [],
      });

      const invalidPreviewResponse = await handler(
        new Request("http://127.0.0.1/api/v1/goals/save-up/preview", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            currentValue: 1000,
            targetAmount: 5000,
            targetDate: null,
            monthlyContribution: 250,
            expectedAnnualReturn: 2,
          }),
        }),
      );
      expect(invalidPreviewResponse.status).toBe(400);
      await expect(invalidPreviewResponse.json()).resolves.toMatchObject({
        message: "Expected annual return must be between -20% and 50%",
      });

      const deletePlanResponse = await handler(
        new Request(`http://127.0.0.1/api/v1/goals/${created.id}/plan`, {
          method: "DELETE",
          headers: { authorization: "Bearer sidecar-token" },
        }),
      );
      expect(deletePlanResponse.status).toBe(204);
      expect(
        (
          await handler(
            new Request(`http://127.0.0.1/api/v1/goals/${created.id}/plan`, {
              method: "DELETE",
              headers: { authorization: "Bearer sidecar-token" },
            }),
          )
        ).status,
      ).toBe(204);

      const deleteResponse = await handler(
        new Request(`http://127.0.0.1/api/v1/goals/${created.id}`, {
          method: "DELETE",
          headers: { authorization: "Bearer sidecar-token" },
        }),
      );
      expect(deleteResponse.status).toBe(204);
    } finally {
      db.close();
    }
  });

  test("routes migrated goal valuation-backed calculations only with a provider", async () => {
    const db = createGoalsDb();
    const goalService = createGoalService(createGoalRepository(db), {
      now: () => new Date(2024, 0, 1, 12),
    });
    let providerCalls = 0;
    const handler = createBackendRequestHandler(config, {
      goalService,
      goalValuationProvider: {
        async getGoalValuationMap() {
          providerCalls += 1;
          return { brokerage: 200_000, cash: 1000 };
        },
      },
    });

    try {
      seedHttpGoal(db, {
        id: "goal 1",
        title: "Goal",
        targetAmount: 1000,
        projectedCompletionDate: "2026-06-01",
        projectedValueAtTargetDate: 950,
      });
      seedHttpFundingRule(db, {
        id: "funding-1",
        goalId: "goal 1",
        accountId: "cash",
        sharePercent: 50,
      });

      expect(
        (
          await handler(
            new Request("http://127.0.0.1/api/v1/goals/goal%201/refresh-summary", {
              method: "POST",
            }),
          )
        ).status,
      ).toBe(401);

      const refreshResponse = await handler(
        new Request("http://127.0.0.1/api/v1/goals/goal%201/refresh-summary", {
          method: "POST",
          headers: { authorization: "Bearer sidecar-token" },
        }),
      );
      expect(refreshResponse.status).toBe(200);
      await expect(refreshResponse.json()).resolves.toMatchObject({
        id: "goal 1",
        summaryCurrentValue: 500,
        summaryProgress: 0.5,
        statusHealth: "at_risk",
      });
      expect(providerCalls).toBe(1);

      const overviewResponse = await handler(
        new Request("http://127.0.0.1/api/v1/goals/goal%201/save-up/overview", {
          headers: { authorization: "Bearer sidecar-token" },
        }),
      );
      expect(overviewResponse.status).toBe(200);
      await expect(overviewResponse.json()).resolves.toMatchObject({
        currentValue: 500,
        targetAmount: 1000,
        progress: 0.5,
      });
      expect(providerCalls).toBe(2);

      const directProjectionResponse = await handler(
        new Request("http://127.0.0.1/api/v1/goals/retirement/projection", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            plan: validHttpRetirementPlan(),
            currentPortfolio: 100_000,
            plannerMode: "traditional",
          }),
        }),
      );
      expect(directProjectionResponse.status).toBe(200);
      const directProjection = await directProjectionResponse.json();
      expect(directProjection).toMatchObject({ retirementStartAge: 55 });
      expect(directProjection.yearByYear[0]).toMatchObject({ portfolioValue: 100_000 });
      expect(providerCalls).toBe(2);

      const directMonteCarloResponse = await handler(
        new Request("http://127.0.0.1/api/v1/goals/retirement/monte-carlo", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            plan: validHttpRetirementPlan(),
            currentPortfolio: 100_000,
            plannerMode: "traditional",
            nSims: 16,
            seed: 42,
          }),
        }),
      );
      expect(directMonteCarloResponse.status).toBe(200);
      const directMonteCarlo = await directMonteCarloResponse.json();
      expect(directMonteCarlo).toMatchObject({
        nSimulations: 16,
        successRate: expect.any(Number),
        finalPortfolioAtHorizon: {
          p50: expect.any(Number),
        },
      });
      expect("medianFireAge" in directMonteCarlo).toBe(true);
      expect(directMonteCarlo.ageAxis[0]).toBe(45);
      expect(directMonteCarlo.percentiles.p50).toHaveLength(directMonteCarlo.ageAxis.length);
      expect(providerCalls).toBe(2);

      const clampedMonteCarloResponse = await handler(
        new Request("http://127.0.0.1/api/v1/goals/retirement/monte-carlo", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            plan: validHttpRetirementPlan({
              personal: { currentAge: 54, targetRetirementAge: 55, planningHorizonAge: 55 },
            }),
            currentPortfolio: 100_000,
            nSims: 0,
            seed: 7,
          }),
        }),
      );
      expect(clampedMonteCarloResponse.status).toBe(200);
      await expect(clampedMonteCarloResponse.json()).resolves.toMatchObject({
        nSimulations: 1,
        ageAxis: [54, 55],
      });
      expect(providerCalls).toBe(2);

      const defaultMonteCarloResponse = await handler(
        new Request("http://127.0.0.1/api/v1/goals/retirement/monte-carlo", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            plan: validHttpRetirementPlan({
              personal: { currentAge: 54, targetRetirementAge: 55, planningHorizonAge: 55 },
            }),
            currentPortfolio: 100_000,
            seed: 7,
          }),
        }),
      );
      expect(defaultMonteCarloResponse.status).toBe(200);
      await expect(defaultMonteCarloResponse.json()).resolves.toMatchObject({
        nSimulations: 10_000,
        ageAxis: [54, 55],
      });
      expect(providerCalls).toBe(2);

      const directScenarioResponse = await handler(
        new Request("http://127.0.0.1/api/v1/goals/retirement/scenario-analysis", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            plan: validHttpRetirementPlan(),
            currentPortfolio: 100_000,
            plannerMode: "traditional",
          }),
        }),
      );
      expect(directScenarioResponse.status).toBe(200);
      const directScenarios = await directScenarioResponse.json();
      expect(directScenarios.map((scenario: { label: string }) => scenario.label)).toEqual([
        "Pessimistic",
        "Base case",
        "Optimistic",
      ]);
      expect(directScenarios[1]).toMatchObject({
        fireAge: null,
        fundedAtGoalAge: expect.any(Boolean),
      });
      expect(providerCalls).toBe(2);

      const directStressResponse = await handler(
        new Request("http://127.0.0.1/api/v1/goals/retirement/stress-tests", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            plan: validHttpRetirementPlan(),
            currentPortfolio: 100_000,
            plannerMode: "traditional",
          }),
        }),
      );
      expect(directStressResponse.status).toBe(200);
      const directStress = await directStressResponse.json();
      expect(new Set(directStress.map((stress: { id: string }) => stress.id))).toEqual(
        new Set([
          "return-drag",
          "inflation-shock",
          "spending-shock",
          "retire-earlier",
          "save-less",
          "early-crash",
        ]),
      );
      expect(directStress[0]).toMatchObject({
        severity: expect.any(String),
        baseline: expect.any(Object),
        stressed: expect.any(Object),
      });
      expect(providerCalls).toBe(2);

      const directDecisionResponse = await handler(
        new Request("http://127.0.0.1/api/v1/goals/retirement/decision-sensitivity-map", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            plan: validHttpRetirementPlan(),
            currentPortfolio: 100_000,
            plannerMode: "traditional",
            map: "contribution-return",
          }),
        }),
      );
      expect(directDecisionResponse.status).toBe(200);
      const directDecision = await directDecisionResponse.json();
      expect(directDecision).toMatchObject({
        rowLabel: "After-fee return",
        columnLabel: "Monthly contribution",
        baselineRow: expect.any(Number),
        baselineColumn: expect.any(Number),
      });
      expect(directDecision.cells).toHaveLength(5);
      expect(providerCalls).toBe(2);

      const directSorrResponse = await handler(
        new Request("http://127.0.0.1/api/v1/goals/retirement/sequence-of-returns", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            plan: validHttpRetirementPlan(),
            portfolioAtFire: 5_000_000,
            retirementStartAge: 55,
          }),
        }),
      );
      expect(directSorrResponse.status).toBe(200);
      const directSorr = await directSorrResponse.json();
      expect(directSorr).toHaveLength(5);
      expect(directSorr[0]).toMatchObject({
        label: "Base case",
        survived: true,
        failureAge: null,
      });
      expect(directSorr[1].returns[0]).toBe(-0.3);
      expect(providerCalls).toBe(2);

      const invalidProjectionResponse = await handler(
        new Request("http://127.0.0.1/api/v1/goals/retirement/projection", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            plan: validHttpRetirementPlan({
              personal: { currentAge: 45, targetRetirementAge: 40 },
            }),
            currentPortfolio: 100_000,
          }),
        }),
      );
      expect(invalidProjectionResponse.status).toBe(400);
      await expect(invalidProjectionResponse.json()).resolves.toMatchObject({
        message: "Invalid input: Target retirement age must be after current age",
      });
      expect(providerCalls).toBe(2);

      const domainErrorResponse = await handler(
        new Request("http://127.0.0.1/api/v1/goals/missing/save-up/overview", {
          headers: { authorization: "Bearer sidecar-token" },
        }),
      );
      expect(domainErrorResponse.status).toBe(400);
      expect(providerCalls).toBe(3);

      const refreshAllResponse = await handler(
        new Request("http://127.0.0.1/api/v1/goals/refresh-summaries", {
          method: "POST",
          headers: { authorization: "Bearer sidecar-token" },
        }),
      );
      expect(refreshAllResponse.status).toBe(200);
      await expect(refreshAllResponse.json()).resolves.toEqual([
        expect.objectContaining({
          id: "goal 1",
          summaryCurrentValue: 500,
          summaryProgress: 0.5,
        }),
      ]);
      expect(providerCalls).toBe(4);

      for (const [goalId, plannerMode, expectedMode] of [
        ["retirement-fire", null, "fire"],
        ["retirement-traditional", "traditional", "traditional"],
      ] as const) {
        seedHttpGoal(db, {
          id: goalId,
          title: goalId,
          goalType: "retirement",
        });
        seedHttpGoalPlan(db, {
          goalId,
          planKind: "retirement",
          plannerMode,
          settingsJson: JSON.stringify(validHttpRetirementPlan()),
        });
        seedHttpFundingRule(db, {
          id: `${goalId}-funding`,
          goalId,
          accountId: "brokerage",
          sharePercent: 50,
          taxBucket: "tax_deferred",
        });

        const retirementOverviewResponse = await handler(
          new Request(`http://127.0.0.1/api/v1/goals/${goalId}/retirement/overview`, {
            headers: { authorization: "Bearer sidecar-token" },
          }),
        );
        expect(retirementOverviewResponse.status).toBe(200);
        await expect(retirementOverviewResponse.json()).resolves.toMatchObject({
          analysisMode: expectedMode,
          portfolioNow: 100_000,
          taxBucketBalances: { taxable: 0, taxDeferred: 100_000, taxFree: 0 },
          targetReconciliation: { targetAge: 55 },
        });
      }
      expect(providerCalls).toBe(6);

      const retirementRefreshResponse = await handler(
        new Request("http://127.0.0.1/api/v1/goals/retirement-traditional/refresh-summary", {
          method: "POST",
          headers: { authorization: "Bearer sidecar-token" },
        }),
      );
      expect(retirementRefreshResponse.status).toBe(200);
      await expect(retirementRefreshResponse.json()).resolves.toMatchObject({
        summaryCurrentValue: 100_000,
        projectedCompletionDate: "2034-01-01",
      });
      expect(providerCalls).toBe(7);

      const goalProjectionResponse = await handler(
        new Request("http://127.0.0.1/api/v1/goals/retirement/projection", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            plan: validHttpRetirementPlan(),
            currentPortfolio: 1,
            plannerMode: "fire",
            goalId: "retirement-traditional",
          }),
        }),
      );
      expect(goalProjectionResponse.status).toBe(200);
      const goalProjection = await goalProjectionResponse.json();
      expect(goalProjection).toMatchObject({ retirementStartAge: 55 });
      expect(goalProjection.yearByYear[0]).toMatchObject({ portfolioValue: 100_000 });
      expect(providerCalls).toBe(8);

      const goalMonteCarloResponse = await handler(
        new Request("http://127.0.0.1/api/v1/goals/retirement/monte-carlo", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            plan: validHttpRetirementPlan({ personal: { currentAge: 30 } }),
            currentPortfolio: 1,
            plannerMode: "fire",
            goalId: "retirement-traditional",
            nSims: 16,
            seed: 42,
          }),
        }),
      );
      expect(goalMonteCarloResponse.status).toBe(200);
      const goalMonteCarlo = await goalMonteCarloResponse.json();
      expect(goalMonteCarlo).toMatchObject({
        nSimulations: 16,
        successRate: expect.any(Number),
      });
      expect(goalMonteCarlo.ageAxis[0]).toBe(45);
      expect(providerCalls).toBe(9);

      const goalScenarioResponse = await handler(
        new Request("http://127.0.0.1/api/v1/goals/retirement/scenario-analysis", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            plan: validHttpRetirementPlan({ personal: { currentAge: 30 } }),
            currentPortfolio: 1,
            plannerMode: "fire",
            goalId: "retirement-traditional",
          }),
        }),
      );
      expect(goalScenarioResponse.status).toBe(200);
      const goalScenarios = await goalScenarioResponse.json();
      expect(goalScenarios[0]).toMatchObject({
        label: "Pessimistic",
      });
      expect(goalScenarios[0].yearByYear[0]).toMatchObject({ portfolioValue: 100_000 });
      expect(providerCalls).toBe(10);

      const goalStressResponse = await handler(
        new Request("http://127.0.0.1/api/v1/goals/retirement/stress-tests", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            plan: validHttpRetirementPlan({ personal: { currentAge: 30 } }),
            currentPortfolio: 1,
            plannerMode: "fire",
            goalId: "retirement-traditional",
          }),
        }),
      );
      expect(goalStressResponse.status).toBe(200);
      const goalStress = await goalStressResponse.json();
      expect(goalStress).toHaveLength(6);
      expect(typeof goalStress[0].baseline.fundedAtGoalAge).toBe("boolean");
      expect(providerCalls).toBe(11);

      const goalDecisionResponse = await handler(
        new Request("http://127.0.0.1/api/v1/goals/retirement/decision-sensitivity-map", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            plan: validHttpRetirementPlan({ personal: { currentAge: 30 } }),
            currentPortfolio: 1,
            plannerMode: "fire",
            goalId: "retirement-traditional",
            map: "retirement-age-spending",
          }),
        }),
      );
      expect(goalDecisionResponse.status).toBe(200);
      const goalDecision = await goalDecisionResponse.json();
      expect(goalDecision).toMatchObject({
        rowLabel: "Monthly spending",
        columnLabel: "Retirement age",
      });
      expect(goalDecision.cells[0][0]).toMatchObject({
        fundedAtGoalAge: expect.any(Boolean),
      });
      expect(providerCalls).toBe(12);

      const goalSorrResponse = await handler(
        new Request("http://127.0.0.1/api/v1/goals/retirement/sequence-of-returns", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            plan: validHttpRetirementPlan({ personal: { currentAge: 30 } }),
            portfolioAtFire: 100_000,
            retirementStartAge: 55,
            goalId: "retirement-traditional",
          }),
        }),
      );
      expect(goalSorrResponse.status).toBe(200);
      const goalSorr = await goalSorrResponse.json();
      expect(goalSorr[0]).toMatchObject({
        label: "Base case",
      });
      expect(goalSorr[0].portfolioPath).toHaveLength(36);
      expect(providerCalls).toBe(13);

      const nonRetirementOverviewResponse = await handler(
        new Request("http://127.0.0.1/api/v1/goals/goal%201/retirement/overview", {
          headers: { authorization: "Bearer sidecar-token" },
        }),
      );
      expect(nonRetirementOverviewResponse.status).toBe(400);
      await expect(nonRetirementOverviewResponse.json()).resolves.toMatchObject({
        message: "Invalid input: Goal goal 1 is not a retirement goal",
      });

      seedHttpGoal(db, {
        id: "retirement-no-plan",
        title: "Retirement No Plan",
        goalType: "retirement",
      });
      const missingPlanResponse = await handler(
        new Request("http://127.0.0.1/api/v1/goals/retirement-no-plan/retirement/overview", {
          headers: { authorization: "Bearer sidecar-token" },
        }),
      );
      expect(missingPlanResponse.status).toBe(400);
      await expect(missingPlanResponse.json()).resolves.toMatchObject({
        message: "Invalid input: No plan found for goal retirement-no-plan",
      });
      expect(providerCalls).toBe(15);
    } finally {
      db.close();
    }
  });

  test("refreshes goal summaries after funding and plan saves when valuations are available", async () => {
    const db = createGoalsDb();
    const goalService = createGoalService(createGoalRepository(db), {
      now: () => new Date(2024, 0, 1, 12),
    });
    let providerCalls = 0;
    const handler = createBackendRequestHandler(config, {
      goalService,
      goalValuationProvider: {
        async getGoalValuationMap() {
          providerCalls += 1;
          return { cash: 1000 };
        },
      },
    });

    try {
      seedHttpGoal(db, {
        id: "goal 1",
        title: "Goal",
        targetAmount: 1000,
      });

      const fundingResponse = await handler(
        new Request("http://127.0.0.1/api/v1/goals/goal%201/funding", {
          method: "PUT",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify([{ accountId: "cash", sharePercent: 25 }]),
        }),
      );
      expect(fundingResponse.status).toBe(200);
      await expect(fundingResponse.json()).resolves.toEqual([
        expect.objectContaining({ goalId: "goal 1", accountId: "cash", sharePercent: 25 }),
      ]);
      expect(providerCalls).toBe(1);
      expect(goalService.getGoal("goal 1")).toMatchObject({
        summaryCurrentValue: 250,
        summaryProgress: 0.25,
      });

      const planResponse = await handler(
        new Request("http://127.0.0.1/api/v1/goals/plan", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            goalId: "goal 1",
            planKind: "save_up",
            settingsJson: JSON.stringify({ monthlyContribution: 25 }),
          }),
        }),
      );
      expect(planResponse.status).toBe(200);
      await expect(planResponse.json()).resolves.toMatchObject({
        goalId: "goal 1",
        planKind: "save_up",
      });
      expect(providerCalls).toBe(2);
      expect(goalService.getGoal("goal 1")).toMatchObject({
        summaryCurrentValue: 250,
        summaryProgress: 0.25,
      });
    } finally {
      db.close();
    }
  });

  test("keeps goal valuation-backed routes explicitly deferred without a provider", async () => {
    const db = createGoalsDb();
    const goalService = createGoalService(createGoalRepository(db));
    const handler = createBackendRequestHandler(config, { goalService });
    const failingHandler = createBackendRequestHandler(config, {
      goalService,
      goalValuationProvider: {
        async getGoalValuationMap() {
          throw new Error("valuation unavailable");
        },
      },
    });

    try {
      for (const [method, path] of [
        ["POST", "/api/v1/goals/refresh-summaries"],
        ["POST", "/api/v1/goals/goal-1/refresh-summary"],
        ["GET", "/api/v1/goals/goal-1/save-up/overview"],
        ["GET", "/api/v1/goals/goal-1/retirement/overview"],
      ] as const) {
        const response = await handler(
          new Request(`http://127.0.0.1${path}`, {
            method,
            headers: { authorization: "Bearer sidecar-token" },
          }),
        );
        expect(response.status).toBe(501);
        await expect(response.json()).resolves.toMatchObject({
          message: "Goal valuation provider is not available in the TS backend runtime yet",
        });
      }

      const projectionNoProviderResponse = await handler(
        new Request("http://127.0.0.1/api/v1/goals/retirement/projection", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            plan: validHttpRetirementPlan(),
            currentPortfolio: 1,
            goalId: "goal-1",
          }),
        }),
      );
      expect(projectionNoProviderResponse.status).toBe(501);
      await expect(projectionNoProviderResponse.json()).resolves.toMatchObject({
        message: "Goal valuation provider is not available in the TS backend runtime yet",
      });

      const monteCarloNoProviderResponse = await handler(
        new Request("http://127.0.0.1/api/v1/goals/retirement/monte-carlo", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            plan: validHttpRetirementPlan(),
            currentPortfolio: 1,
            goalId: "goal-1",
            nSims: 1,
            seed: 42,
          }),
        }),
      );
      expect(monteCarloNoProviderResponse.status).toBe(501);
      await expect(monteCarloNoProviderResponse.json()).resolves.toMatchObject({
        message: "Goal valuation provider is not available in the TS backend runtime yet",
      });

      const scenarioNoProviderResponse = await handler(
        new Request("http://127.0.0.1/api/v1/goals/retirement/scenario-analysis", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            plan: validHttpRetirementPlan(),
            currentPortfolio: 1,
            goalId: "goal-1",
          }),
        }),
      );
      expect(scenarioNoProviderResponse.status).toBe(501);
      await expect(scenarioNoProviderResponse.json()).resolves.toMatchObject({
        message: "Goal valuation provider is not available in the TS backend runtime yet",
      });

      const stressNoProviderResponse = await handler(
        new Request("http://127.0.0.1/api/v1/goals/retirement/stress-tests", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            plan: validHttpRetirementPlan(),
            currentPortfolio: 1,
            goalId: "goal-1",
          }),
        }),
      );
      expect(stressNoProviderResponse.status).toBe(501);
      await expect(stressNoProviderResponse.json()).resolves.toMatchObject({
        message: "Goal valuation provider is not available in the TS backend runtime yet",
      });

      const decisionNoProviderResponse = await handler(
        new Request("http://127.0.0.1/api/v1/goals/retirement/decision-sensitivity-map", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            plan: validHttpRetirementPlan(),
            currentPortfolio: 1,
            goalId: "goal-1",
            map: "contribution-return",
          }),
        }),
      );
      expect(decisionNoProviderResponse.status).toBe(501);
      await expect(decisionNoProviderResponse.json()).resolves.toMatchObject({
        message: "Goal valuation provider is not available in the TS backend runtime yet",
      });

      const sorrNoProviderResponse = await handler(
        new Request("http://127.0.0.1/api/v1/goals/retirement/sequence-of-returns", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            plan: validHttpRetirementPlan(),
            portfolioAtFire: 1,
            retirementStartAge: 55,
            goalId: "goal-1",
          }),
        }),
      );
      expect(sorrNoProviderResponse.status).toBe(501);
      await expect(sorrNoProviderResponse.json()).resolves.toMatchObject({
        message: "Goal valuation provider is not available in the TS backend runtime yet",
      });

      const providerErrorResponse = await failingHandler(
        new Request("http://127.0.0.1/api/v1/goals/goal-1/retirement/overview", {
          headers: { authorization: "Bearer sidecar-token" },
        }),
      );
      expect(providerErrorResponse.status).toBe(503);
      await expect(providerErrorResponse.json()).resolves.toMatchObject({
        message: "valuation unavailable",
      });

      const projectionProviderErrorResponse = await failingHandler(
        new Request("http://127.0.0.1/api/v1/goals/retirement/projection", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            plan: validHttpRetirementPlan(),
            currentPortfolio: 1,
            goalId: "goal-1",
          }),
        }),
      );
      expect(projectionProviderErrorResponse.status).toBe(503);
      await expect(projectionProviderErrorResponse.json()).resolves.toMatchObject({
        message: "valuation unavailable",
      });

      const monteCarloProviderErrorResponse = await failingHandler(
        new Request("http://127.0.0.1/api/v1/goals/retirement/monte-carlo", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            plan: validHttpRetirementPlan(),
            currentPortfolio: 1,
            goalId: "goal-1",
            nSims: 1,
            seed: 42,
          }),
        }),
      );
      expect(monteCarloProviderErrorResponse.status).toBe(503);
      await expect(monteCarloProviderErrorResponse.json()).resolves.toMatchObject({
        message: "valuation unavailable",
      });

      const scenarioProviderErrorResponse = await failingHandler(
        new Request("http://127.0.0.1/api/v1/goals/retirement/scenario-analysis", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            plan: validHttpRetirementPlan(),
            currentPortfolio: 1,
            goalId: "goal-1",
          }),
        }),
      );
      expect(scenarioProviderErrorResponse.status).toBe(503);
      await expect(scenarioProviderErrorResponse.json()).resolves.toMatchObject({
        message: "valuation unavailable",
      });

      const stressProviderErrorResponse = await failingHandler(
        new Request("http://127.0.0.1/api/v1/goals/retirement/stress-tests", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            plan: validHttpRetirementPlan(),
            currentPortfolio: 1,
            goalId: "goal-1",
          }),
        }),
      );
      expect(stressProviderErrorResponse.status).toBe(503);
      await expect(stressProviderErrorResponse.json()).resolves.toMatchObject({
        message: "valuation unavailable",
      });

      const decisionProviderErrorResponse = await failingHandler(
        new Request("http://127.0.0.1/api/v1/goals/retirement/decision-sensitivity-map", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            plan: validHttpRetirementPlan(),
            currentPortfolio: 1,
            goalId: "goal-1",
            map: "contribution-return",
          }),
        }),
      );
      expect(decisionProviderErrorResponse.status).toBe(503);
      await expect(decisionProviderErrorResponse.json()).resolves.toMatchObject({
        message: "valuation unavailable",
      });

      const sorrProviderErrorResponse = await failingHandler(
        new Request("http://127.0.0.1/api/v1/goals/retirement/sequence-of-returns", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            plan: validHttpRetirementPlan(),
            portfolioAtFire: 1,
            retirementStartAge: 55,
            goalId: "goal-1",
          }),
        }),
      );
      expect(sorrProviderErrorResponse.status).toBe(503);
      await expect(sorrProviderErrorResponse.json()).resolves.toMatchObject({
        message: "valuation unavailable",
      });
    } finally {
      db.close();
    }
  });
});

function createAccountsDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE accounts (
      id TEXT NOT NULL PRIMARY KEY,
      name TEXT NOT NULL,
      account_type TEXT NOT NULL DEFAULT 'SECURITIES',
      "group" TEXT,
      currency TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      platform_id TEXT,
      account_number TEXT,
      meta TEXT,
      provider TEXT,
      provider_account_id TEXT,
      is_archived INTEGER NOT NULL DEFAULT 0,
      tracking_mode TEXT NOT NULL DEFAULT 'NOT_SET'
    );
  `);
  return db;
}

function createContributionLimitsDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE contribution_limits (
      id TEXT PRIMARY KEY NOT NULL,
      group_name TEXT NOT NULL,
      contribution_year INTEGER NOT NULL,
      limit_amount NUMERIC NOT NULL,
      account_ids TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      start_date TIMESTAMP NULL,
      end_date TIMESTAMP NULL
    );
  `);
  return db;
}

function createCustomProvidersDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE market_data_custom_providers (
      id TEXT NOT NULL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 50,
      config TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE assets (
      id TEXT NOT NULL PRIMARY KEY,
      provider_config TEXT
    );
  `);
  return db;
}

function createExchangeRatesDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE assets (
      id TEXT NOT NULL PRIMARY KEY,
      kind TEXT NOT NULL,
      name TEXT,
      display_code TEXT,
      notes TEXT,
      metadata TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      quote_mode TEXT NOT NULL DEFAULT 'MARKET',
      quote_ccy TEXT NOT NULL,
      instrument_type TEXT,
      instrument_symbol TEXT,
      instrument_exchange_mic TEXT,
      instrument_key TEXT GENERATED ALWAYS AS (
        CASE
          WHEN instrument_type = 'FX' AND instrument_symbol IS NOT NULL
          THEN 'FX:' || instrument_symbol || '/' || quote_ccy
          ELSE instrument_symbol
        END
      ) STORED,
      provider_config TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE quotes (
      id TEXT NOT NULL PRIMARY KEY,
      asset_id TEXT NOT NULL,
      day TEXT NOT NULL,
      source TEXT NOT NULL,
      open TEXT,
      high TEXT,
      low TEXT,
      close TEXT NOT NULL,
      adjclose TEXT,
      volume TEXT,
      currency TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );
  `);
  return db;
}

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

function createMarketDataProvidersDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE market_data_providers (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      url TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      logo_filename TEXT,
      last_synced_at TEXT,
      last_sync_status TEXT,
      last_sync_error TEXT,
      provider_type TEXT NOT NULL DEFAULT 'builtin',
      config TEXT
    );

    CREATE TABLE quote_sync_state (
      asset_id TEXT PRIMARY KEY NOT NULL,
      last_synced_at TEXT,
      data_source TEXT NOT NULL,
      error_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      updated_at TEXT NOT NULL
    );

    INSERT INTO market_data_providers (
      id, name, description, url, priority, enabled, logo_filename, provider_type
    )
    VALUES
      ('YAHOO', 'Yahoo Finance', 'Yahoo provider', 'https://finance.yahoo.com/', 1, 1, 'yahoo-finance.png', 'builtin'),
      ('ALPHA_VANTAGE', 'Alpha Vantage', 'Alpha provider', 'https://www.alphavantage.co/', 3, 1, 'alpha-vantage.png', 'builtin'),
      ('FINNHUB', 'Finnhub', 'Finnhub provider', 'https://finnhub.io/', 4, 0, 'finnhub.png', 'builtin');
  `);
  return db;
}

function createGoalsDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE goals (
      id TEXT NOT NULL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      target_amount REAL NOT NULL DEFAULT 0,
      goal_type TEXT NOT NULL DEFAULT 'custom_save_up',
      status_lifecycle TEXT NOT NULL DEFAULT 'active',
      status_health TEXT NOT NULL DEFAULT 'not_applicable',
      priority INTEGER NOT NULL DEFAULT 0,
      cover_image_key TEXT,
      currency TEXT,
      start_date TEXT,
      target_date TEXT,
      summary_current_value REAL,
      summary_progress REAL,
      projected_completion_date TEXT,
      projected_value_at_target_date REAL,
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      summary_target_amount REAL
    );

    CREATE TABLE goals_allocation (
      id TEXT NOT NULL PRIMARY KEY,
      goal_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      share_percent REAL NOT NULL DEFAULT 0,
      tax_bucket TEXT,
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE goal_plans (
      goal_id TEXT NOT NULL PRIMARY KEY,
      plan_kind TEXT NOT NULL,
      planner_mode TEXT,
      settings_json TEXT NOT NULL DEFAULT '{}',
      summary_json TEXT NOT NULL DEFAULT '{}',
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );
  `);
  return db;
}

function seedHttpGoal(
  db: Database,
  goal: {
    id: string;
    title: string;
    goalType?: string;
    targetAmount?: number;
    projectedCompletionDate?: string | null;
    projectedValueAtTargetDate?: number | null;
  },
): void {
  db.prepare(
    `
      INSERT INTO goals (
        id, title, description, target_amount, goal_type, status_lifecycle,
        status_health, priority, projected_completion_date, projected_value_at_target_date,
        created_at, updated_at
      )
      VALUES (?, ?, NULL, ?, ?, 'active', 'not_applicable', 0, ?, ?, ?, ?)
    `,
  ).run(
    goal.id,
    goal.title,
    goal.targetAmount ?? 100,
    goal.goalType ?? "custom_save_up",
    goal.projectedCompletionDate ?? null,
    goal.projectedValueAtTargetDate ?? null,
    "2026-01-01T00:00:00Z",
    "2026-01-01T00:00:00Z",
  );
}

function seedHttpFundingRule(
  db: Database,
  rule: {
    id: string;
    goalId: string;
    accountId: string;
    sharePercent: number;
    taxBucket?: string | null;
  },
): void {
  db.prepare(
    `
      INSERT INTO goals_allocation (
        id, goal_id, account_id, share_percent, tax_bucket, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    rule.id,
    rule.goalId,
    rule.accountId,
    rule.sharePercent,
    rule.taxBucket ?? null,
    "2026-01-01T00:00:00Z",
    "2026-01-01T00:00:00Z",
  );
}

function seedHttpGoalPlan(
  db: Database,
  plan: {
    goalId: string;
    planKind: string;
    settingsJson: string;
    plannerMode?: string | null;
  },
): void {
  db.prepare(
    `
      INSERT INTO goal_plans (
        goal_id, plan_kind, planner_mode, settings_json, summary_json, version, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, '{}', 1, ?, ?)
    `,
  ).run(
    plan.goalId,
    plan.planKind,
    plan.plannerMode ?? null,
    plan.settingsJson,
    "2026-01-01T00:00:00Z",
    "2026-01-01T00:00:00Z",
  );
}

function validHttpRetirementPlan(
  overrides: {
    personal?: Record<string, unknown>;
    expenses?: Record<string, unknown>;
    incomeStreams?: unknown[];
    investment?: Record<string, unknown>;
    tax?: unknown;
  } = {},
): Record<string, unknown> {
  return {
    personal: {
      currentAge: 45,
      targetRetirementAge: 55,
      planningHorizonAge: 90,
      ...overrides.personal,
    },
    expenses: {
      items: [{ id: "living", label: "Living", monthlyAmount: 6000 }],
      ...overrides.expenses,
    },
    incomeStreams: overrides.incomeStreams ?? [],
    investment: {
      preRetirementAnnualReturn: 0.057,
      retirementAnnualReturn: 0.034,
      annualInvestmentFeeRate: 0.006,
      annualVolatility: 0.12,
      inflationRate: 0.02,
      monthlyContribution: 3000,
      contributionGrowthRate: 0.02,
      glidePath: null,
      ...overrides.investment,
    },
    tax: overrides.tax === undefined ? null : overrides.tax,
    currency: "USD",
  };
}

function createTaxonomiesDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE taxonomies (
      id TEXT NOT NULL PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#8abceb',
      description TEXT,
      is_system INTEGER NOT NULL DEFAULT 0,
      is_single_select INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z',
      updated_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z'
    );

    CREATE TABLE taxonomy_categories (
      id TEXT NOT NULL,
      taxonomy_id TEXT NOT NULL,
      parent_id TEXT,
      name TEXT NOT NULL,
      key TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#808080',
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z',
      updated_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z',
      PRIMARY KEY (taxonomy_id, id)
    );

    CREATE TABLE asset_taxonomy_assignments (
      id TEXT NOT NULL PRIMARY KEY,
      asset_id TEXT NOT NULL,
      taxonomy_id TEXT NOT NULL,
      category_id TEXT NOT NULL,
      weight INTEGER NOT NULL DEFAULT 10000,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z',
      updated_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z'
    );
  `);
  return db;
}
