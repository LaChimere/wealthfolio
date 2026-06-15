import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import type { SecretService } from "./secrets";
import { createLocalConnectService } from "./connect";

function createMemorySecretService(): SecretService & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    setSecret(secretKey, secret) {
      entries.set(secretKey, secret);
    },
    getSecret(secretKey) {
      return entries.get(secretKey) ?? null;
    },
    deleteSecret(secretKey) {
      entries.delete(secretKey);
    },
  };
}

describe("TS Connect local session service", () => {
  test("stores, reports, and clears cloud refresh session secrets", async () => {
    const db = new Database(":memory:");
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_access_token", "legacy-access");
    const service = createLocalConnectService({
      db,
      secretService,
      accountService: { getAllAccounts: () => [] },
      activityService: {
        getBrokerSyncProfile: () => null,
        saveBrokerSyncProfileRules: (request) => request,
      },
    });

    try {
      await expect(service.getSyncSessionStatus()).resolves.toEqual({ isConfigured: false });

      await service.storeSyncSession("refresh-token");
      expect(secretService.entries.get("sync_refresh_token")).toBe("refresh-token");
      expect(secretService.entries.has("sync_access_token")).toBe(false);
      await expect(service.getSyncSessionStatus()).resolves.toEqual({ isConfigured: true });

      await service.clearSyncSession();
      expect(secretService.entries.has("sync_refresh_token")).toBe(false);
      expect(secretService.entries.has("sync_access_token")).toBe(false);
      await expect(service.getSyncSessionStatus()).resolves.toEqual({ isConfigured: false });
    } finally {
      db.close();
    }
  });

  test("restores sessions by refreshing access tokens and rotating refresh tokens", async () => {
    const db = new Database(":memory:");
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "old-refresh");
    secretService.entries.set("sync_access_token", "legacy-access");
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const service = createLocalConnectService({
      db,
      secretService,
      env: {
        CONNECT_AUTH_URL: "https://auth.example.test/",
        CONNECT_AUTH_PUBLISHABLE_KEY: "publishable-key",
      },
      fetch: async (input, init) => {
        requests.push({ url: String(input), init });
        return Response.json({
          access_token: "access-token",
          refresh_token: "rotated-refresh",
          expires_in: 3600,
        });
      },
      accountService: { getAllAccounts: () => [] },
      activityService: {
        getBrokerSyncProfile: () => null,
        saveBrokerSyncProfileRules: (request) => request,
      },
    });

    try {
      await expect(service.restoreSyncSession()).resolves.toEqual({
        accessToken: "access-token",
        refreshToken: "rotated-refresh",
      });
      expect(secretService.entries.get("sync_refresh_token")).toBe("rotated-refresh");
      expect(secretService.entries.has("sync_access_token")).toBe(false);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe(
        "https://auth.example.test/auth/v1/token?grant_type=refresh_token",
      );
      expect(requests[0]?.init?.headers).toMatchObject({
        apikey: "publishable-key",
        "content-type": "application/json",
      });
      expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
        refresh_token: "old-refresh",
      });
    } finally {
      db.close();
    }
  });

  test("clears invalid refresh sessions during restore", async () => {
    const db = new Database(":memory:");
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "expired-refresh");
    secretService.entries.set("sync_access_token", "legacy-access");
    const service = createLocalConnectService({
      db,
      secretService,
      fetch: async () =>
        Response.json(
          { error: "invalid_grant", error_description: "Refresh Token Not Found" },
          { status: 401 },
        ),
      accountService: { getAllAccounts: () => [] },
      activityService: {
        getBrokerSyncProfile: () => null,
        saveBrokerSyncProfileRules: (request) => request,
      },
    });

    try {
      await expect(service.restoreSyncSession()).rejects.toMatchObject({
        code: "forbidden",
        status: 403,
      });
      expect(secretService.entries.has("sync_refresh_token")).toBe(false);
      expect(secretService.entries.has("sync_access_token")).toBe(false);
    } finally {
      db.close();
    }
  });

  test("serializes concurrent restores so a stale refresh failure cannot clear a rotated token", async () => {
    const db = new Database(":memory:");
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "old-refresh");
    let calls = 0;
    const service = createLocalConnectService({
      db,
      secretService,
      fetch: async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return Response.json({
          access_token: "access-token",
          refresh_token: "rotated-refresh",
        });
      },
      accountService: { getAllAccounts: () => [] },
      activityService: {
        getBrokerSyncProfile: () => null,
        saveBrokerSyncProfileRules: (request) => request,
      },
    });

    try {
      await expect(
        Promise.all([service.restoreSyncSession(), service.restoreSyncSession()]),
      ).resolves.toEqual([
        { accessToken: "access-token", refreshToken: "rotated-refresh" },
        { accessToken: "access-token", refreshToken: "rotated-refresh" },
      ]);
      expect(calls).toBe(1);
      expect(secretService.entries.get("sync_refresh_token")).toBe("rotated-refresh");
    } finally {
      db.close();
    }
  });

  test("does not resurrect cleared sessions when an in-flight restore completes", async () => {
    const db = new Database(":memory:");
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "old-refresh");
    let releaseRefresh: (() => void) | undefined;
    const service = createLocalConnectService({
      db,
      secretService,
      fetch: async () => {
        await new Promise<void>((resolve) => {
          releaseRefresh = resolve;
        });
        return Response.json({
          access_token: "access-token",
          refresh_token: "rotated-refresh",
        });
      },
      accountService: { getAllAccounts: () => [] },
      activityService: {
        getBrokerSyncProfile: () => null,
        saveBrokerSyncProfileRules: (request) => request,
      },
    });

    try {
      const restorePromise = service.restoreSyncSession();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await service.clearSyncSession();
      releaseRefresh?.();

      await expect(restorePromise).rejects.toMatchObject({
        code: "forbidden",
        status: 403,
      });
      expect(secretService.entries.has("sync_refresh_token")).toBe(false);
    } finally {
      db.close();
    }
  });

  test("treats invalid OAuth error codes as invalid sessions even with generic descriptions", async () => {
    const db = new Database(":memory:");
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "expired-refresh");
    const service = createLocalConnectService({
      db,
      secretService,
      fetch: async () =>
        Response.json(
          { error: "invalid_grant", error_description: "bad request" },
          { status: 400 },
        ),
      accountService: { getAllAccounts: () => [] },
      activityService: {
        getBrokerSyncProfile: () => null,
        saveBrokerSyncProfileRules: (request) => request,
      },
    });

    try {
      await expect(service.restoreSyncSession()).rejects.toMatchObject({
        code: "forbidden",
        status: 403,
      });
      expect(secretService.entries.has("sync_refresh_token")).toBe(false);
    } finally {
      db.close();
    }
  });

  test("fetches public subscription plans from the Connect API", async () => {
    const db = new Database(":memory:");
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const service = createLocalConnectService({
      db,
      env: { CONNECT_API_URL: "https://api.example.test/" },
      fetch: async (input, init) => {
        requests.push({ url: String(input), init });
        return Response.json({ plans: [{ id: "free" }] });
      },
      accountService: { getAllAccounts: () => [] },
      activityService: {
        getBrokerSyncProfile: () => null,
        saveBrokerSyncProfileRules: (request) => request,
      },
    });

    try {
      await expect(service.getSubscriptionPlansPublic()).resolves.toEqual({
        plans: [{ id: "free" }],
      });
      expect(requests).toEqual([
        {
          url: "https://api.example.test/api/v1/subscription/plans",
          init: { method: "GET", headers: { "content-type": "application/json" } },
        },
      ]);
    } finally {
      db.close();
    }
  });

  test("fetches authenticated plans and maps user info with restored access tokens", async () => {
    const db = new Database(":memory:");
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    const requests: string[] = [];
    const service = createLocalConnectService({
      db,
      secretService,
      env: {
        CONNECT_AUTH_URL: "https://auth.example.test",
        CONNECT_API_URL: "https://api.example.test",
      },
      fetch: async (input, init) => {
        requests.push(`${init?.method ?? "GET"} ${String(input)}`);
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        expect(init?.headers).toMatchObject({
          authorization: "Bearer access-token",
          "content-type": "application/json",
        });
        if (String(input).endsWith("/api/v1/subscription/plans")) {
          return Response.json({ plans: [{ id: "pro" }] });
        }
        return Response.json({
          id: "user-1",
          fullName: "Ada Lovelace",
          email: "ada@example.test",
          avatarUrl: "https://example.test/avatar.png",
          locale: "en",
          weekStartsOnMonday: true,
          timezone: "UTC",
          timezoneAutoSync: false,
          timeFormat: 24,
          dateFormat: "yyyy-MM-dd",
          teamId: "team-1",
          teamRole: "owner",
          team: {
            id: "team-1",
            name: null,
            logoUrl: null,
            plan: "pro",
            subscriptionStatus: "active",
            subscriptionCurrentPeriodEnd: "2026-07-01T00:00:00Z",
            subscriptionCancelAtPeriodEnd: false,
            canceledAt: null,
            countryCode: "US",
            createdAt: "2026-01-01T00:00:00Z",
          },
        });
      },
      accountService: { getAllAccounts: () => [] },
      activityService: {
        getBrokerSyncProfile: () => null,
        saveBrokerSyncProfileRules: (request) => request,
      },
    });

    try {
      await expect(service.getSubscriptionPlans()).resolves.toEqual({ plans: [{ id: "pro" }] });
      await expect(service.getUserInfo()).resolves.toMatchObject({
        id: "user-1",
        full_name: "Ada Lovelace",
        avatar_url: "https://example.test/avatar.png",
        week_starts_on_monday: true,
        timezone_auto_sync: false,
        time_format: 24,
        date_format: "yyyy-MM-dd",
        team_id: "team-1",
        team_role: "owner",
        team: {
          id: "team-1",
          name: "",
          subscription_status: "active",
          subscription_current_period_end: "2026-07-01T00:00:00Z",
          subscription_cancel_at_period_end: false,
          country_code: "US",
          created_at: "2026-01-01T00:00:00Z",
        },
      });
      expect(requests).toEqual([
        "POST https://auth.example.test/auth/v1/token?grant_type=refresh_token",
        "GET https://api.example.test/api/v1/subscription/plans",
        "POST https://auth.example.test/auth/v1/token?grant_type=refresh_token",
        "GET https://api.example.test/api/v1/user/me",
      ]);
    } finally {
      db.close();
    }
  });

  test("shares one token restore across concurrent authenticated Connect reads", async () => {
    const db = new Database(":memory:");
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    let authCalls = 0;
    const service = createLocalConnectService({
      db,
      secretService,
      fetch: async (input) => {
        if (String(input).includes("/auth/v1/token")) {
          authCalls += 1;
          await new Promise((resolve) => setTimeout(resolve, 10));
          return Response.json({ access_token: "access-token" });
        }
        if (String(input).endsWith("/api/v1/subscription/plans")) {
          return Response.json({ plans: [{ id: "pro" }] });
        }
        return Response.json({ id: "user-1" });
      },
      accountService: { getAllAccounts: () => [] },
      activityService: {
        getBrokerSyncProfile: () => null,
        saveBrokerSyncProfileRules: (request) => request,
      },
    });

    try {
      await expect(
        Promise.all([service.getSubscriptionPlans(), service.getUserInfo()]),
      ).resolves.toEqual([{ plans: [{ id: "pro" }] }, expect.objectContaining({ id: "user-1" })]);
      expect(authCalls).toBe(1);
    } finally {
      db.close();
    }
  });

  test("lists broker connections and accounts from authenticated Connect API reads", async () => {
    const db = new Database(":memory:");
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    const service = createLocalConnectService({
      db,
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test" },
      fetch: async (input) => {
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        if (String(input).endsWith("/api/v1/sync/brokerage/connections")) {
          return Response.json({
            connections: [
              {
                id: "connection-row-id",
                authorization_id: "authorization-1",
                status: "connected",
                disabled: false,
                updated_at: "2026-01-02T00:00:00Z",
                name: "Main connection",
                brokerage: {
                  id: "brokerage-1",
                  slug: "snaptrade",
                  name: "SnapTrade",
                  display_name: "SnapTrade Display",
                  aws_s3_logo_url: "https://logo.example.test/logo.png",
                  aws_s3_square_logo_url: "https://logo.example.test/square.png",
                },
              },
              {
                id: "connection-row-2",
                brokerage_name: "Fallback Broker",
                brokerage_slug: "fallback",
              },
            ],
          });
        }
        return Response.json({
          accounts: [{ id: "broker-account-1", name: "Broker Account", currency: "USD" }],
        });
      },
      accountService: { getAllAccounts: () => [] },
      activityService: {
        getBrokerSyncProfile: () => null,
        saveBrokerSyncProfileRules: (request) => request,
      },
    });

    try {
      await expect(service.listBrokerConnections()).resolves.toEqual([
        {
          id: "authorization-1",
          brokerage: {
            id: "brokerage-1",
            slug: "snaptrade",
            name: "SnapTrade",
            display_name: "SnapTrade Display",
            aws_s3_logo_url: "https://logo.example.test/logo.png",
            aws_s3_square_logo_url: "https://logo.example.test/square.png",
          },
          type: null,
          status: "connected",
          disabled: false,
          disabled_date: null,
          updated_at: "2026-01-02T00:00:00Z",
          name: "Main connection",
        },
        {
          id: "connection-row-2",
          brokerage: {
            id: null,
            slug: "fallback",
            name: "Fallback Broker",
            display_name: "Fallback Broker",
            aws_s3_logo_url: null,
            aws_s3_square_logo_url: null,
          },
          type: null,
          status: null,
          disabled: false,
          disabled_date: null,
          updated_at: null,
          name: null,
        },
      ]);
      await expect(service.listBrokerAccounts()).resolves.toEqual([
        { id: "broker-account-1", name: "Broker Account", currency: "USD" },
      ]);
    } finally {
      db.close();
    }
  });

  test("syncs broker connections into local platforms", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE platforms (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT,
        url TEXT NOT NULL,
        external_id TEXT,
        kind TEXT NOT NULL DEFAULT 'BROKERAGE',
        website_url TEXT,
        logo_url TEXT
      );
      INSERT INTO platforms (id, name, url, external_id, kind, website_url, logo_url)
      VALUES ('existing', 'Old Name', 'https://old.example.test', 'old-id', 'BROKERAGE', NULL, NULL);
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    const service = createLocalConnectService({
      db,
      secretService,
      fetch: async (input) => {
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        return Response.json({
          connections: [
            {
              id: "row-1",
              brokerage: {
                id: "brokerage-1",
                slug: "new_broker",
                name: "New Broker",
                display_name: "New Broker Display",
                aws_s3_logo_url: "https://logo.example.test/logo.png",
                aws_s3_square_logo_url: "https://logo.example.test/square.png",
              },
            },
            {
              id: "row-2",
              brokerage: {
                id: "brokerage-2",
                slug: "existing",
                name: "Existing Broker",
                display_name: null,
                aws_s3_logo_url: "https://logo.example.test/existing.png",
                aws_s3_square_logo_url: null,
              },
            },
            { id: "row-3", brokerage: null },
          ],
        });
      },
      accountService: { getAllAccounts: () => [] },
      activityService: {
        getBrokerSyncProfile: () => null,
        saveBrokerSyncProfileRules: (request) => request,
      },
    });

    try {
      await expect(service.syncBrokerConnections()).resolves.toEqual({
        synced: 3,
        platformsCreated: 1,
        platformsUpdated: 1,
      });
      expect(
        db
          .query<
            {
              id: string;
              name: string | null;
              url: string;
              external_id: string | null;
              logo_url: string | null;
            },
            []
          >("SELECT id, name, url, external_id, logo_url FROM platforms ORDER BY id")
          .all(),
      ).toEqual([
        {
          id: "existing",
          name: "Existing Broker",
          url: "https://existing.com",
          external_id: "brokerage-2",
          logo_url: "https://logo.example.test/existing.png",
        },
        {
          id: "new_broker",
          name: "New Broker Display",
          url: "https://newbroker.com",
          external_id: "brokerage-1",
          logo_url: "https://logo.example.test/square.png",
        },
      ]);
    } finally {
      db.close();
    }
  });
});
