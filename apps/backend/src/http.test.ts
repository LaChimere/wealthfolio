import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";

import type { BackendRuntimeConfig } from "./config";
import { createAccountRepository, createAccountService } from "./domains/accounts";
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
import {
  createMarketDataProviderRepository,
  createMarketDataProviderService,
} from "./domains/market-data-providers";
import type { PortfolioJobConfig } from "./domains/portfolio-jobs";
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
            new Request("http://127.0.0.1/api/v1/settings/auto-update", {
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
