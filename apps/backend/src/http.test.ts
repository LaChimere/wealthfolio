import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";

import type { BackendRuntimeConfig } from "./config";
import { createAccountRepository, createAccountService } from "./domains/accounts";
import {
  createContributionLimitRepository,
  createContributionLimitService,
} from "./domains/contribution-limits";
import { createSettingsService } from "./domains/settings";
import { createTaxonomyReadRepository, createTaxonomyReadService } from "./domains/taxonomies";
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
      taxonomyService: createTaxonomyReadService(createTaxonomyReadRepository(db)),
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
  `);
  return db;
}
