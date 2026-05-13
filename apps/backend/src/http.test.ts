import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";

import type { BackendRuntimeConfig } from "./config";
import { createAccountRepository, createAccountService } from "./domains/accounts";
import type { AddonService } from "./domains/addons";
import type { AiProviderService } from "./domains/ai-providers";
import type { AlternativeAssetService } from "./domains/alternative-assets";
import type { AppUtilityService } from "./domains/app-utilities";
import type { AssetService } from "./domains/assets";
import {
  createContributionLimitRepository,
  createContributionLimitService,
} from "./domains/contribution-limits";
import {
  createCustomProviderRepository,
  createCustomProviderService,
} from "./domains/custom-providers";
import { createExchangeRateRepository, createExchangeRateService } from "./domains/exchange-rates";
import { createGoalRepository, createGoalService } from "./domains/goals";
import { createHealthRepository, createHealthService } from "./domains/health";
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
import { createTaxonomyRepository, createTaxonomyService } from "./domains/taxonomies";
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
          method: "POST",
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
      customProviderService: createCustomProviderService(createCustomProviderRepository(db)),
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
          body: JSON.stringify({}),
        }),
      );
      expect(testSourceResponse.status).toBe(404);
    } finally {
      db.close();
    }
  });

  test("routes migrated exchange rate CRUD only when a service is provided", async () => {
    const db = createExchangeRatesDb();
    const handler = createBackendRequestHandler(config, {
      exchangeRateService: createExchangeRateService(createExchangeRateRepository(db)),
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

      const deferredStatusResponse = await handler(
        new Request("http://127.0.0.1/api/v1/health/status", {
          headers: { authorization: "Bearer sidecar-token" },
        }),
      );
      expect(deferredStatusResponse.status).toBe(404);
    } finally {
      db.close();
    }
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

  test("routes migrated alternative assets seam only when a service is provided", async () => {
    const calls: Array<[string, unknown]> = [];
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
    const handler = createBackendRequestHandler(config, { alternativeAssetService });

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

      const deferredPlanWrite = await handler(
        new Request("http://127.0.0.1/api/v1/goals/plan", {
          method: "POST",
          headers: {
            authorization: "Bearer sidecar-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({ goalId: created.id }),
        }),
      );
      expect(deferredPlanWrite.status).toBe(404);

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
