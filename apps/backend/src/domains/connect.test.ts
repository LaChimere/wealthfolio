import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import type { SecretService } from "./secrets";
import { createLocalConnectDeviceSyncService, createLocalConnectService } from "./connect";

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

describe("TS Connect local session service", () => {
  test("stores, reports, and clears cloud refresh session secrets", async () => {
    const db = new Database(":memory:");
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_access_token", "legacy-access");
    db.exec(`
      CREATE TABLE sync_device_config (
        device_id TEXT PRIMARY KEY NOT NULL,
        key_version INTEGER,
        trust_state TEXT NOT NULL DEFAULT 'untrusted',
        last_bootstrap_at TEXT,
        min_snapshot_created_at TEXT
      );
      INSERT INTO sync_device_config (
        device_id, key_version, trust_state, last_bootstrap_at, min_snapshot_created_at
      ) VALUES ('device-1', 1, 'trusted', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z');
    `);
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
      expect(
        db
          .query<
            { min_snapshot_created_at: string | null },
            []
          >("SELECT min_snapshot_created_at FROM sync_device_config WHERE device_id = 'device-1'")
          .get(),
      ).toEqual({ min_snapshot_created_at: null });
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
        return Response.json({ plans: [connectSubscriptionPlan("free")] });
      },
      accountService: { getAllAccounts: () => [] },
      activityService: {
        getBrokerSyncProfile: () => null,
        saveBrokerSyncProfileRules: (request) => request,
      },
    });

    try {
      await expect(service.getSubscriptionPlansPublic()).resolves.toEqual({
        plans: [connectSubscriptionPlan("free")],
      });
      expect(requests).toEqual([
        {
          url: "https://api.example.test/api/v1/subscription/plans",
          init: {
            method: "GET",
            headers: expect.objectContaining({
              "content-type": "application/json",
              "x-wf-client-request-id": expect.stringMatching(
                /^app:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
              ),
            }),
          },
        },
      ]);
    } finally {
      db.close();
    }
  });

  test("rejects malformed public subscription plan payloads", async () => {
    const db = new Database(":memory:");
    const service = createLocalConnectService({
      db,
      env: { CONNECT_API_URL: "https://api.example.test/" },
      fetch: async () =>
        Response.json({
          plans: [{ id: "free", name: "Free", description: "Missing pricing and limits" }],
        }),
      accountService: { getAllAccounts: () => [] },
      activityService: {
        getBrokerSyncProfile: () => null,
        saveBrokerSyncProfileRules: (request) => request,
      },
    });

    try {
      await expect(service.getSubscriptionPlansPublic()).rejects.toMatchObject({
        code: "internal_error",
        message: "Failed to parse plans response",
        status: 500,
      });
    } finally {
      db.close();
    }
  });

  test("does not parse public subscription plan error bodies", async () => {
    const db = new Database(":memory:");
    const service = createLocalConnectService({
      db,
      env: { CONNECT_API_URL: "https://api.example.test/" },
      fetch: async () =>
        Response.json({ message: "public plan failure should stay hidden" }, { status: 503 }),
      accountService: { getAllAccounts: () => [] },
      activityService: {
        getBrokerSyncProfile: () => null,
        saveBrokerSyncProfileRules: (request) => request,
      },
    });

    try {
      await expect(service.getSubscriptionPlansPublic()).rejects.toMatchObject({
        code: "internal_error",
        message: "API error 503",
        status: 500,
      });
    } finally {
      db.close();
    }
  });

  test("rejects malformed authenticated subscription plan scalar fields", async () => {
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
        return Response.json({
          plans: [
            {
              ...connectSubscriptionPlan("pro"),
              pricing: { monthly: "10", yearly: 100 },
            },
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
      await expect(service.getSubscriptionPlans()).rejects.toMatchObject({
        code: "internal_error",
        message: "Failed to parse plans response",
        status: 500,
      });
    } finally {
      db.close();
    }
  });

  test("rejects malformed subscription plan optional scalar fields", async () => {
    const db = new Database(":memory:");
    const service = createLocalConnectService({
      db,
      env: { CONNECT_API_URL: "https://api.example.test/" },
      fetch: async () =>
        Response.json({
          plans: [
            {
              ...connectSubscriptionPlan("free"),
              tagline: 123,
              isAvailable: "yes",
            },
          ],
        }),
      accountService: { getAllAccounts: () => [] },
      activityService: {
        getBrokerSyncProfile: () => null,
        saveBrokerSyncProfileRules: (request) => request,
      },
    });

    try {
      await expect(service.getSubscriptionPlansPublic()).rejects.toMatchObject({
        code: "internal_error",
        message: "Failed to parse plans response",
        status: 500,
      });
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
          "x-wf-client-request-id": expect.stringMatching(/^app:/),
        });
        if (String(input).endsWith("/api/v1/subscription/plans")) {
          return Response.json({ plans: [connectSubscriptionPlan("pro")] });
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
      await expect(service.getSubscriptionPlans()).resolves.toEqual({
        plans: [connectSubscriptionPlan("pro")],
      });
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

  test("rejects malformed Connect user info missing required ids", async () => {
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
        return Response.json({ email: "missing-id@example.test" });
      },
      accountService: { getAllAccounts: () => [] },
      activityService: {
        getBrokerSyncProfile: () => null,
        saveBrokerSyncProfileRules: (request) => request,
      },
    });

    try {
      await expect(service.getUserInfo()).rejects.toMatchObject({
        code: "internal_error",
        message: "Failed to parse user info",
        status: 500,
      });
    } finally {
      db.close();
    }
  });

  test("rejects malformed Connect user info with team missing required id", async () => {
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
        return Response.json({ id: "user-1", team: { name: "Team" } });
      },
      accountService: { getAllAccounts: () => [] },
      activityService: {
        getBrokerSyncProfile: () => null,
        saveBrokerSyncProfileRules: (request) => request,
      },
    });

    try {
      await expect(service.getUserInfo()).rejects.toMatchObject({
        code: "internal_error",
        message: "Failed to parse team info",
        status: 500,
      });
    } finally {
      db.close();
    }
  });

  test("rejects malformed Connect user info optional scalar fields", async () => {
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
        return Response.json({ id: "user-1", email: 123, weekStartsOnMonday: "true" });
      },
      accountService: { getAllAccounts: () => [] },
      activityService: {
        getBrokerSyncProfile: () => null,
        saveBrokerSyncProfileRules: (request) => request,
      },
    });

    try {
      await expect(service.getUserInfo()).rejects.toMatchObject({
        code: "internal_error",
        message: "Failed to parse user info",
        status: 500,
      });
    } finally {
      db.close();
    }
  });

  test("rejects malformed Connect user team optional scalar fields", async () => {
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
        return Response.json({
          id: "user-1",
          team: { id: "team-1", subscriptionCancelAtPeriodEnd: "false" },
        });
      },
      accountService: { getAllAccounts: () => [] },
      activityService: {
        getBrokerSyncProfile: () => null,
        saveBrokerSyncProfileRules: (request) => request,
      },
    });

    try {
      await expect(service.getUserInfo()).rejects.toMatchObject({
        code: "internal_error",
        message: "Failed to parse team info",
        status: 500,
      });
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
          return Response.json({ plans: [connectSubscriptionPlan("pro")] });
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
      ).resolves.toEqual([
        { plans: [connectSubscriptionPlan("pro")] },
        expect.objectContaining({ id: "user-1" }),
      ]);
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

  test("defaults missing broker connection and account arrays to empty lists", async () => {
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
        return Response.json({});
      },
      accountService: { getAllAccounts: () => [] },
      activityService: {
        getBrokerSyncProfile: () => null,
        saveBrokerSyncProfileRules: (request) => request,
      },
    });

    try {
      await expect(service.listBrokerConnections()).resolves.toEqual([]);
      await expect(service.listBrokerAccounts()).resolves.toEqual([]);
    } finally {
      db.close();
    }
  });

  test("rejects malformed broker connections missing required ids", async () => {
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
        return Response.json({ connections: [{ authorization_id: "authorization-1" }] });
      },
      accountService: { getAllAccounts: () => [] },
      activityService: {
        getBrokerSyncProfile: () => null,
        saveBrokerSyncProfileRules: (request) => request,
      },
    });

    try {
      await expect(service.listBrokerConnections()).rejects.toMatchObject({
        code: "internal_error",
        message: "Failed to parse connection response",
        status: 500,
      });
    } finally {
      db.close();
    }
  });

  test("rejects broker connection fields with invalid scalar types", async () => {
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
        return Response.json({
          connections: [{ id: "connection-1", authorization_id: 123, disabled: "false" }],
        });
      },
      accountService: { getAllAccounts: () => [] },
      activityService: {
        getBrokerSyncProfile: () => null,
        saveBrokerSyncProfileRules: (request) => request,
      },
    });

    try {
      await expect(service.listBrokerConnections()).rejects.toMatchObject({
        code: "internal_error",
        message: "Failed to parse connection response",
        status: 500,
      });
    } finally {
      db.close();
    }
  });

  test("rejects broker connection brokerage fields with invalid scalar types", async () => {
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
        return Response.json({
          connections: [{ id: "connection-1", brokerage: { id: 123, slug: "broker" } }],
        });
      },
      accountService: { getAllAccounts: () => [] },
      activityService: {
        getBrokerSyncProfile: () => null,
        saveBrokerSyncProfileRules: (request) => request,
      },
    });

    try {
      await expect(service.listBrokerConnections()).rejects.toMatchObject({
        code: "internal_error",
        message: "Failed to parse brokerage response",
        status: 500,
      });
    } finally {
      db.close();
    }
  });

  test("rejects broker connection fallback brokerage fields with invalid scalar types", async () => {
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
        return Response.json({ connections: [{ id: "connection-1", brokerage_name: 123 }] });
      },
      accountService: { getAllAccounts: () => [] },
      activityService: {
        getBrokerSyncProfile: () => null,
        saveBrokerSyncProfileRules: (request) => request,
      },
    });

    try {
      await expect(service.listBrokerConnections()).rejects.toMatchObject({
        code: "internal_error",
        message: "Failed to parse connection response",
        status: 500,
      });
    } finally {
      db.close();
    }
  });

  test("rejects malformed broker account entries", async () => {
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
        return Response.json({ accounts: ["not-an-account"] });
      },
      accountService: { getAllAccounts: () => [] },
      activityService: {
        getBrokerSyncProfile: () => null,
        saveBrokerSyncProfileRules: (request) => request,
      },
    });

    try {
      await expect(service.listBrokerAccounts()).rejects.toMatchObject({
        code: "internal_error",
        message: "Failed to parse accounts response",
        status: 500,
      });
    } finally {
      db.close();
    }
  });

  test("rejects broker account fields with invalid scalar types", async () => {
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
        return Response.json({ accounts: [{ id: 123, is_paper: "false" }] });
      },
      accountService: { getAllAccounts: () => [] },
      activityService: {
        getBrokerSyncProfile: () => null,
        saveBrokerSyncProfileRules: (request) => request,
      },
    });

    try {
      await expect(service.listBrokerAccounts()).rejects.toMatchObject({
        code: "internal_error",
        message: "Failed to parse accounts response",
        status: 500,
      });
    } finally {
      db.close();
    }
  });

  test("rejects broker account nested fields with invalid scalar types", async () => {
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
        return Response.json({
          accounts: [
            {
              id: "broker-account",
              balance: { total: { amount: "100", currency: "USD" } },
              owner: { user_id: 123, is_own_account: "true" },
              sync_status: { transactions: { initial_sync_completed: "false" } },
            },
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
      await expect(service.listBrokerAccounts()).rejects.toMatchObject({
        code: "internal_error",
        message: "Failed to parse accounts response",
        status: 500,
      });
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

  test("syncs new broker accounts into local accounts and skips existing provider accounts", async () => {
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
      VALUES ('snaptrade', 'SnapTrade', 'https://snaptrade.com', 'brokerage-1', 'BROKERAGE', NULL, NULL);
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    const localAccounts: Array<{ id: string; providerAccountId: string | null }> = [
      { id: "existing-local", providerAccountId: "existing-provider-account" },
    ];
    const createdAccounts: unknown[] = [];
    const service = createLocalConnectService({
      db,
      secretService,
      fetch: async (input) => {
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        return Response.json({
          accounts: [
            {
              id: "new-provider-account",
              name: "Broker Account",
              number: "****1234",
              type: "TFSA",
              currency: null,
              balance: { total: { currency: "CAD" } },
              status: "open",
              brokerage_authorization: "brokerage-1",
              institution_name: "SnapTrade",
              raw_type: "tfsa",
              owner: { user_id: "user-1", is_own_account: true },
            },
            { id: "existing-provider-account", name: "Existing Account" },
            { name: "Missing ID Account" },
            {
              id: "meta-provider-account",
              name: "Meta Brokerage Account",
              currency: "USD",
              meta: { brokerage: { id: "brokerage-1", name: "SnapTrade" } },
            },
          ],
        });
      },
      accountService: {
        getBaseCurrency: () => "USD",
        getAllAccounts: () =>
          localAccounts.map((account) => ({
            ...account,
            name: "",
            accountType: "",
            group: null,
            currency: "USD",
            isDefault: false,
            isActive: true,
            isArchived: false,
            trackingMode: "HOLDINGS",
            createdAt: "",
            updatedAt: "",
            platformId: null,
            accountNumber: null,
            meta: null,
            provider: null,
          })),
        createAccount: async (account) => {
          const created = {
            id: `created-local-${createdAccounts.length + 1}`,
            name: account.name,
            accountType: account.accountType,
            group: account.group ?? null,
            currency: account.currency,
            isDefault: account.isDefault,
            isActive: account.isActive,
            isArchived: account.isArchived ?? false,
            trackingMode: account.trackingMode ?? "NOT_SET",
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
            platformId: account.platformId ?? null,
            accountNumber: account.accountNumber ?? null,
            meta: account.meta ?? null,
            provider: account.provider ?? null,
            providerAccountId: account.providerAccountId ?? null,
          };
          createdAccounts.push(created);
          localAccounts.push({ id: created.id, providerAccountId: created.providerAccountId });
          return created;
        },
      },
      activityService: {
        getBrokerSyncProfile: () => null,
        saveBrokerSyncProfileRules: (request) => request,
      },
    });

    try {
      await expect(service.syncBrokerAccounts()).resolves.toEqual({
        synced: 4,
        created: 2,
        updated: 0,
        skipped: 2,
        createdAccounts: [
          ["created-local-1", "CAD"],
          ["created-local-2", "USD"],
        ],
        newAccountsInfo: [
          {
            localAccountId: "created-local-1",
            providerAccountId: "new-provider-account",
            defaultName: "Broker Account",
            currency: "CAD",
            institutionName: "SnapTrade",
          },
          {
            localAccountId: "created-local-2",
            providerAccountId: "meta-provider-account",
            defaultName: "Meta Brokerage Account",
            currency: "USD",
            institutionName: null,
          },
        ],
      });
      expect(createdAccounts).toEqual([
        expect.objectContaining({
          id: "created-local-1",
          name: "Broker Account",
          accountType: "TFSA",
          currency: "CAD",
          isActive: true,
          platformId: "snaptrade",
          accountNumber: "****1234",
          provider: "SNAPTRADE",
          providerAccountId: "new-provider-account",
          trackingMode: "HOLDINGS",
        }),
        expect.objectContaining({
          id: "created-local-2",
          name: "Meta Brokerage Account",
          platformId: "snaptrade",
          providerAccountId: "meta-provider-account",
        }),
      ]);
      expect(JSON.parse(String((createdAccounts[0] as { meta: string }).meta))).toMatchObject({
        institution_name: "SnapTrade",
        brokerage_authorization: "brokerage-1",
        raw_type: "tfsa",
        sync_enabled: true,
        owner: { user_id: "user-1", is_own_account: true },
      });
    } finally {
      db.close();
    }
  });

  test("treats activities-only sync as a no-op when all synced accounts are holdings-mode", async () => {
    const db = new Database(":memory:");
    const service = createLocalConnectService({
      db,
      accountService: {
        getAllAccounts: () => [
          {
            id: "holdings-account",
            name: "Holdings",
            accountType: "SECURITIES",
            group: null,
            currency: "USD",
            isDefault: false,
            isActive: true,
            isArchived: false,
            trackingMode: "HOLDINGS",
            createdAt: "",
            updatedAt: "",
            platformId: null,
            accountNumber: null,
            meta: null,
            provider: "SNAPTRADE",
            providerAccountId: "provider-account",
          },
        ],
        getBaseCurrency: () => "USD",
        createAccount: async () => {
          throw new Error("should not create accounts during activity sync");
        },
      },
      activityService: {
        getBrokerSyncProfile: () => null,
        saveBrokerSyncProfileRules: (request) => request,
      },
    });

    try {
      await expect(service.syncBrokerActivities()).resolves.toEqual({
        accountsSynced: 0,
        activitiesUpserted: 0,
        assetsInserted: 0,
        accountsFailed: 0,
        accountsWarned: 0,
        newAssetIds: [],
      });
    } finally {
      db.close();
    }
  });

  test("runs bounded broker data sync through migrated connection, account, and holdings no-op slices", async () => {
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
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    const localAccounts: Array<{
      id: string;
      providerAccountId: string | null;
      trackingMode: "HOLDINGS";
    }> = [];
    const service = createLocalConnectService({
      db,
      secretService,
      fetch: async (input) => {
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
        return Response.json({
          accounts: [
            {
              id: "broker-account-1",
              name: "Broker Account",
              currency: "USD",
              brokerage_authorization: "brokerage",
            },
          ],
        });
      },
      accountService: {
        getBaseCurrency: () => "USD",
        getAllAccounts: () =>
          localAccounts.map((account) => ({
            ...account,
            name: "Broker Account",
            accountType: "SECURITIES",
            group: null,
            currency: "USD",
            isDefault: false,
            isActive: true,
            isArchived: false,
            createdAt: "",
            updatedAt: "",
            platformId: "brokerage",
            accountNumber: null,
            meta: null,
            provider: "SNAPTRADE",
          })),
        createAccount: async (account) => {
          const created = {
            id: "created-local",
            providerAccountId: account.providerAccountId ?? null,
            trackingMode: (account.trackingMode ?? "NOT_SET") as "HOLDINGS",
          };
          localAccounts.push(created);
          return {
            ...created,
            name: account.name,
            accountType: account.accountType,
            group: account.group ?? null,
            currency: account.currency,
            isDefault: account.isDefault,
            isActive: account.isActive,
            isArchived: account.isArchived ?? false,
            createdAt: "",
            updatedAt: "",
            platformId: account.platformId ?? null,
            accountNumber: account.accountNumber ?? null,
            meta: account.meta ?? null,
            provider: account.provider ?? null,
          };
        },
      },
      activityService: {
        getBrokerSyncProfile: () => null,
        saveBrokerSyncProfileRules: (request) => request,
      },
    });

    try {
      await expect(service.syncBrokerData()).resolves.toEqual({ status: "accepted" });
      expect(localAccounts).toEqual([
        { id: "created-local", providerAccountId: "broker-account-1", trackingMode: "HOLDINGS" },
      ]);
    } finally {
      db.close();
    }
  });

  test("keeps transaction-mode activity sync feature-gated until broker activity mapping lands", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE brokers_sync_state (
        account_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        checkpoint_json TEXT,
        last_attempted_at TEXT,
        last_successful_at TEXT,
        last_error TEXT,
        last_run_id TEXT,
        sync_status TEXT NOT NULL DEFAULT 'IDLE',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (account_id, provider)
      );
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
        return Response.json({ data: [{ id: "activity-1" }] });
      },
      accountService: {
        getAllAccounts: () => [
          {
            id: "transaction-account",
            name: "Transactions",
            accountType: "SECURITIES",
            group: null,
            currency: "USD",
            isDefault: false,
            isActive: true,
            isArchived: false,
            trackingMode: "TRANSACTIONS",
            createdAt: "",
            updatedAt: "",
            platformId: null,
            accountNumber: null,
            meta: null,
            provider: "SNAPTRADE",
            providerAccountId: "provider-account",
          },
        ],
        getBaseCurrency: () => "USD",
        createAccount: async () => {
          throw new Error("should not create accounts during activity sync");
        },
      },
      activityService: {
        getBrokerSyncProfile: () => null,
        saveBrokerSyncProfileRules: (request) => request,
      },
    });

    try {
      await expect(service.syncBrokerActivities()).rejects.toMatchObject({
        code: "not_implemented",
        status: 501,
      });
      expect(
        db
          .query<
            { sync_status: string; last_error: string | null },
            []
          >("SELECT sync_status, last_error FROM brokers_sync_state WHERE account_id = 'transaction-account' AND provider = 'SNAPTRADE'")
          .get(),
      ).toEqual({
        sync_status: "FAILED",
        last_error: "Broker activity mapping is not yet available in the TS backend runtime",
      });
    } finally {
      db.close();
    }
  });

  test("recognizes broker activity page data aliases before applying mapper gate", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE brokers_sync_state (
        account_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        checkpoint_json TEXT,
        last_attempted_at TEXT,
        last_successful_at TEXT,
        last_error TEXT,
        last_run_id TEXT,
        sync_status TEXT NOT NULL DEFAULT 'IDLE',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (account_id, provider)
      );
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
        return Response.json({ universalActivities: [{ id: "activity-1" }] });
      },
      accountService: {
        getAllAccounts: () => [
          {
            id: "transaction-account",
            name: "Transactions",
            accountType: "SECURITIES",
            group: null,
            currency: "USD",
            isDefault: false,
            isActive: true,
            isArchived: false,
            trackingMode: "TRANSACTIONS",
            createdAt: "",
            updatedAt: "",
            platformId: null,
            accountNumber: null,
            meta: null,
            provider: "SNAPTRADE",
            providerAccountId: "provider-account",
          },
        ],
        getBaseCurrency: () => "USD",
        createAccount: async () => {
          throw new Error("should not create accounts during activity sync");
        },
      },
      activityService: {
        getBrokerSyncProfile: () => null,
        saveBrokerSyncProfileRules: (request) => request,
      },
    });

    try {
      await expect(service.syncBrokerActivities()).rejects.toMatchObject({
        code: "not_implemented",
        status: 501,
      });
      expect(
        db
          .query<
            { sync_status: string; last_error: string | null },
            []
          >("SELECT sync_status, last_error FROM brokers_sync_state WHERE account_id = 'transaction-account' AND provider = 'SNAPTRADE'")
          .get(),
      ).toEqual({
        sync_status: "FAILED",
        last_error: "Broker activity mapping is not yet available in the TS backend runtime",
      });
    } finally {
      db.close();
    }
  });

  test("syncs transaction accounts with empty broker activity pages", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE brokers_sync_state (
        account_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        checkpoint_json TEXT,
        last_attempted_at TEXT,
        last_successful_at TEXT,
        last_error TEXT,
        last_run_id TEXT,
        sync_status TEXT NOT NULL DEFAULT 'IDLE',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (account_id, provider)
      );
      INSERT INTO brokers_sync_state (
        account_id, provider, checkpoint_json, last_attempted_at, last_successful_at,
        last_error, last_run_id, sync_status, created_at, updated_at
      ) VALUES (
        'transaction-account', 'SNAPTRADE', NULL, '2026-01-09T00:00:00Z',
        '2026-01-10T00:00:00Z', NULL, NULL, 'IDLE',
        '2026-01-09T00:00:00Z', '2026-01-09T00:00:00Z'
      );
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    const requests: string[] = [];
    const service = createLocalConnectService({
      db,
      secretService,
      fetch: async (input) => {
        requests.push(String(input));
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        return Response.json({ data: [], pagination: { has_more: false } });
      },
      accountService: {
        getAllAccounts: () => [
          {
            id: "transaction-account",
            name: "Transactions",
            accountType: "SECURITIES",
            group: null,
            currency: "USD",
            isDefault: false,
            isActive: true,
            isArchived: false,
            trackingMode: "TRANSACTIONS",
            createdAt: "",
            updatedAt: "",
            platformId: null,
            accountNumber: null,
            meta: null,
            provider: "SNAPTRADE",
            providerAccountId: "provider-account",
          },
        ],
        getBaseCurrency: () => "USD",
        createAccount: async () => {
          throw new Error("should not create accounts during activity sync");
        },
      },
      activityService: {
        getBrokerSyncProfile: () => null,
        saveBrokerSyncProfileRules: (request) => request,
      },
    });

    try {
      await expect(service.syncBrokerActivities()).resolves.toEqual({
        accountsSynced: 1,
        activitiesUpserted: 0,
        assetsInserted: 0,
        accountsFailed: 0,
        accountsWarned: 0,
        newAssetIds: [],
      });
      const activityUrl = new URL(requests[1] ?? "");
      expect(activityUrl.pathname).toBe(
        "/api/v1/sync/brokerage/accounts/provider-account/activities",
      );
      expect([...activityUrl.searchParams.entries()].map(([key]) => key)).toEqual([
        "offset",
        "limit",
        "start_date",
        "end_date",
      ]);
      expect(activityUrl.searchParams.get("offset")).toBe("0");
      expect(activityUrl.searchParams.get("limit")).toBe("1000");
      expect(activityUrl.searchParams.get("start_date")).toBe("2026-01-09");
      const row = db
        .query<
          {
            sync_status: string;
            last_attempted_at: string | null;
            last_successful_at: string | null;
            last_error: string | null;
          },
          []
        >(
          "SELECT sync_status, last_attempted_at, last_successful_at, last_error FROM brokers_sync_state WHERE account_id = 'transaction-account' AND provider = 'SNAPTRADE'",
        )
        .get();
      expect(row?.sync_status).toBe("IDLE");
      expect(row?.last_attempted_at).toBeTruthy();
      expect(row?.last_successful_at).toBeTruthy();
      expect(row?.last_error).toBeNull();
    } finally {
      db.close();
    }
  });

  test("skips non-empty broker activity pages when every activity lacks a mappable id", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE brokers_sync_state (
        account_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        checkpoint_json TEXT,
        last_attempted_at TEXT,
        last_successful_at TEXT,
        last_error TEXT,
        last_run_id TEXT,
        sync_status TEXT NOT NULL DEFAULT 'IDLE',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (account_id, provider)
      );
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    const requests: string[] = [];
    const service = createLocalConnectService({
      db,
      secretService,
      fetch: async (input) => {
        requests.push(String(input));
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        if (String(input).includes("offset=0")) {
          return Response.json({
            data: [{ description: "missing id" }, { id: "   ", description: "blank id" }],
            pagination: { has_more: true },
          });
        }
        return Response.json({
          data: [],
          pagination: { has_more: false },
        });
      },
      accountService: {
        getAllAccounts: () => [
          {
            id: "transaction-account",
            name: "Transactions",
            accountType: "SECURITIES",
            group: null,
            currency: "USD",
            isDefault: false,
            isActive: true,
            isArchived: false,
            trackingMode: "TRANSACTIONS",
            createdAt: "",
            updatedAt: "",
            platformId: null,
            accountNumber: null,
            meta: null,
            provider: "SNAPTRADE",
            providerAccountId: "provider-account",
          },
        ],
        getBaseCurrency: () => "USD",
        createAccount: async () => {
          throw new Error("should not create accounts during activity sync");
        },
      },
      activityService: {
        getBrokerSyncProfile: () => null,
        saveBrokerSyncProfileRules: (request) => request,
      },
    });

    try {
      await expect(service.syncBrokerActivities()).resolves.toEqual({
        accountsSynced: 1,
        activitiesUpserted: 0,
        assetsInserted: 0,
        accountsFailed: 0,
        accountsWarned: 0,
        newAssetIds: [],
      });
      expect(
        db
          .query<
            { sync_status: string; last_error: string | null },
            []
          >("SELECT sync_status, last_error FROM brokers_sync_state WHERE account_id = 'transaction-account' AND provider = 'SNAPTRADE'")
          .get(),
      ).toEqual({
        sync_status: "IDLE",
        last_error: null,
      });
      const activityRequests = requests.filter((request) =>
        request.includes("/api/v1/sync/brokerage/accounts/provider-account/activities?"),
      );
      expect(activityRequests).toHaveLength(2);
      const firstActivityUrl = new URL(activityRequests[0] ?? "");
      const secondActivityUrl = new URL(activityRequests[1] ?? "");
      expect([...firstActivityUrl.searchParams.entries()].map(([key]) => key)).toEqual([
        "offset",
        "limit",
        "end_date",
      ]);
      expect(firstActivityUrl.searchParams.get("offset")).toBe("0");
      expect(secondActivityUrl.searchParams.get("offset")).toBe("2");
    } finally {
      db.close();
    }
  });

  test("records per-account failure when broker activity page fetch fails", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE brokers_sync_state (
        account_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        checkpoint_json TEXT,
        last_attempted_at TEXT,
        last_successful_at TEXT,
        last_error TEXT,
        last_run_id TEXT,
        sync_status TEXT NOT NULL DEFAULT 'IDLE',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (account_id, provider)
      );
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
        return Response.json({ message: "upstream unavailable" }, { status: 503 });
      },
      accountService: {
        getAllAccounts: () => [
          {
            id: "transaction-account",
            name: "Transactions",
            accountType: "SECURITIES",
            group: null,
            currency: "USD",
            isDefault: false,
            isActive: true,
            isArchived: false,
            trackingMode: "TRANSACTIONS",
            createdAt: "",
            updatedAt: "",
            platformId: null,
            accountNumber: null,
            meta: null,
            provider: "SNAPTRADE",
            providerAccountId: "provider-account",
          },
        ],
        getBaseCurrency: () => "USD",
        createAccount: async () => {
          throw new Error("should not create accounts during activity sync");
        },
      },
      activityService: {
        getBrokerSyncProfile: () => null,
        saveBrokerSyncProfileRules: (request) => request,
      },
    });

    try {
      await expect(service.syncBrokerActivities()).resolves.toMatchObject({
        accountsSynced: 0,
        activitiesUpserted: 0,
        assetsInserted: 0,
        accountsFailed: 1,
        accountsWarned: 0,
        newAssetIds: [],
      });
      expect(
        db
          .query<
            { sync_status: string; last_error: string | null },
            []
          >("SELECT sync_status, last_error FROM brokers_sync_state WHERE account_id = 'transaction-account' AND provider = 'SNAPTRADE'")
          .get(),
      ).toEqual({
        sync_status: "FAILED",
        last_error: "API error 503: upstream unavailable",
      });
    } finally {
      db.close();
    }
  });
});

describe("TS Connect device sync local service", () => {
  test("returns local FRESH sync state after restoring a Connect session without sync identity", async () => {
    const db = new Database(":memory:");
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    const requests: string[] = [];
    const service = createLocalConnectDeviceSyncService({
      db,
      secretService,
      env: {
        CONNECT_AUTH_URL: "https://auth.example.test",
        CONNECT_AUTH_PUBLISHABLE_KEY: "publishable-key",
      },
      fetch: async (input) => {
        requests.push(String(input));
        return Response.json({ access_token: "access-token" });
      },
    });

    try {
      await expect(service.getDeviceSyncState()).resolves.toEqual({
        state: "FRESH",
        deviceId: null,
        deviceName: null,
        keyVersion: null,
        serverKeyVersion: null,
        isTrusted: false,
        trustedDevices: [],
      });
      expect(requests).toEqual([
        "https://auth.example.test/auth/v1/token?grant_type=refresh_token",
      ]);
    } finally {
      db.close();
    }
  });

  test("returns local FRESH sync state when identity has nonce but no device id", async () => {
    const db = new Database(":memory:");
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    secretService.entries.set(
      "sync_identity",
      JSON.stringify({ version: 2, deviceNonce: "nonce-1" }),
    );
    const service = createLocalConnectDeviceSyncService({
      db,
      secretService,
      fetch: async () => Response.json({ access_token: "access-token" }),
    });

    try {
      await expect(service.getDeviceSyncState()).resolves.toMatchObject({
        state: "FRESH",
        deviceId: null,
        isTrusted: false,
        trustedDevices: [],
      });
    } finally {
      db.close();
    }
  });

  test("rejects malformed sync identity during local device sync state checks", async () => {
    const db = new Database(":memory:");
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    secretService.entries.set("sync_identity", JSON.stringify({ deviceNonce: 42 }));
    const service = createLocalConnectDeviceSyncService({
      db,
      secretService,
      fetch: async () => Response.json({ access_token: "access-token" }),
    });

    try {
      await expect(service.getDeviceSyncState()).rejects.toMatchObject({
        code: "internal_error",
        message: "Failed to parse identity",
        status: 500,
      });
      secretService.entries.set(
        "sync_identity",
        JSON.stringify({ version: null, deviceId: "device-1" }),
      );
      await expect(service.getDeviceSyncState()).rejects.toMatchObject({
        code: "internal_error",
        message: "Failed to parse identity",
        status: 500,
      });
      secretService.entries.set("sync_identity", '{"version":2.0,"deviceId":"device-1"}');
      await expect(service.getDeviceSyncState()).rejects.toMatchObject({
        code: "internal_error",
        message: "Failed to parse identity",
        status: 500,
      });
      secretService.entries.set(
        "sync_identity",
        '{"version":2,"deviceId":"device-1","keyVersion":1e0}',
      );
      await expect(service.getDeviceSyncState()).rejects.toMatchObject({
        code: "internal_error",
        message: "Failed to parse identity",
        status: 500,
      });
      secretService.entries.set(
        "sync_identity",
        '{"version":2,"vers\\u0069on":2.0,"deviceId":"device-1"}',
      );
      await expect(service.getDeviceSyncState()).rejects.toMatchObject({
        code: "internal_error",
        message: "Failed to parse identity",
        status: 500,
      });
      secretService.entries.set(
        "sync_identity",
        '{"version":2,"keyVersion":1,"keyVersion":1e0,"deviceId":"device-1"}',
      );
      await expect(service.getDeviceSyncState()).rejects.toMatchObject({
        code: "internal_error",
        message: "Failed to parse identity",
        status: 500,
      });
      secretService.entries.set("sync_identity", '{"version":2,"version":3,"deviceId":"device-1"}');
      await expect(service.getDeviceSyncState()).rejects.toMatchObject({
        code: "internal_error",
        message: "Failed to parse identity",
        status: 500,
      });
      secretService.entries.set("sync_identity", '{"version":2,"deviceId":"a","deviceId":"b"}');
      await expect(service.getDeviceSyncState()).rejects.toMatchObject({
        code: "internal_error",
        message: "Failed to parse identity",
        status: 500,
      });
      secretService.entries.set(
        "sync_identity",
        JSON.stringify({ version: 2, deviceId: "device-1", keyVersion: 1.5 }),
      );
      await expect(service.getDeviceSyncState()).rejects.toMatchObject({
        code: "internal_error",
        message: "Failed to parse identity",
        status: 500,
      });
    } finally {
      db.close();
    }
  });

  test("requires a Connect session before local device sync state checks", async () => {
    const db = new Database(":memory:");
    const secretService = createMemorySecretService();
    const service = createLocalConnectDeviceSyncService({
      db,
      secretService,
      fetch: async () => Response.json({ access_token: "access-token" }),
    });

    try {
      await expect(service.getDeviceSyncState()).rejects.toMatchObject({
        code: "forbidden",
        status: 403,
      });
    } finally {
      db.close();
    }
  });

  test("requires a Connect session before enable and returns existing sync state when configured", async () => {
    const db = new Database(":memory:");
    const secretService = createMemorySecretService();
    const service = createLocalConnectDeviceSyncService({
      db,
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test" },
      fetch: async (input) => {
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        return Response.json({
          id: "device-1",
          display_name: "MacBook",
          trust_state: "trusted",
          trusted_key_version: 2,
        });
      },
    });

    try {
      await expect(service.enableDeviceSync()).rejects.toMatchObject({
        code: "forbidden",
        status: 403,
      });
      await expect(service.reinitializeDeviceSync()).rejects.toMatchObject({
        code: "forbidden",
        status: 403,
      });

      secretService.entries.set("sync_refresh_token", "refresh-token");
      secretService.entries.set(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-1",
          deviceId: "device-1",
          rootKey: "root-key",
          keyVersion: 2,
        }),
      );
      await expect(service.enableDeviceSync()).resolves.toEqual({
        deviceId: "device-1",
        state: "READY",
        keyVersion: 2,
        serverKeyVersion: 2,
        needsPairing: false,
        trustedDevices: [],
      });
      await expect(service.reinitializeDeviceSync()).rejects.toMatchObject({
        code: "not_implemented",
        status: 501,
      });
    } finally {
      db.close();
    }
  });

  test("keeps enable feature-gated for RECOVERY sync state", async () => {
    const db = new Database(":memory:");
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    secretService.entries.set(
      "sync_identity",
      JSON.stringify({
        version: 2,
        deviceNonce: "nonce-1",
        deviceId: "device-1",
        rootKey: "root-key",
        keyVersion: 2,
      }),
    );
    const service = createLocalConnectDeviceSyncService({
      db,
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test" },
      fetch: async (input) => {
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        return Response.json({ code: "DEVICE_NOT_FOUND", message: "not found" }, { status: 404 });
      },
    });

    try {
      await expect(service.enableDeviceSync()).rejects.toMatchObject({
        code: "not_implemented",
        status: 501,
      });
    } finally {
      db.close();
    }
  });

  test("reconciles ready state locally for auth and non-ready preconditions", async () => {
    const db = new Database(":memory:");
    const secretService = createMemorySecretService();
    const service = createLocalConnectDeviceSyncService({
      db,
      secretService,
      fetch: async () => Response.json({ access_token: "access-token" }),
    });

    try {
      await expect(
        service.reconcileDeviceSyncReadyState({ allowOverwrite: false }),
      ).resolves.toMatchObject({
        status: "error",
        message: "Failed to read sync state: No sync session configured",
        bootstrapAction: "NO_BOOTSTRAP",
        bootstrapStatus: "not_attempted",
        backgroundStatus: "skipped",
      });

      secretService.entries.set("sync_refresh_token", "refresh-token");
      await expect(
        service.reconcileDeviceSyncReadyState({ allowOverwrite: false }),
      ).resolves.toMatchObject({
        status: "skipped_not_ready",
        message: "Device is not in READY state",
        bootstrapAction: "NO_BOOTSTRAP",
        bootstrapStatus: "not_attempted",
        backgroundStatus: "skipped",
      });

      secretService.entries.set("sync_identity", JSON.stringify({ deviceNonce: 42 }));
      await expect(
        service.reconcileDeviceSyncReadyState({ allowOverwrite: false }),
      ).resolves.toMatchObject({
        status: "error",
        message: "Failed to read sync state: Failed to parse identity",
      });

      secretService.entries.set(
        "sync_identity",
        JSON.stringify({ version: 2, deviceNonce: "nonce-1", deviceId: "device-1" }),
      );
      await expect(
        service.reconcileDeviceSyncReadyState({ allowOverwrite: false }),
      ).rejects.toMatchObject({
        code: "not_implemented",
        status: 501,
      });
    } finally {
      db.close();
    }
  });

  test("reads READY, REGISTERED, and RECOVERY sync states from cloud device status", async () => {
    const db = new Database(":memory:");
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    const deviceResponses: Response[] = [
      Response.json({
        id: "device-1",
        display_name: "MacBook",
        platform: "mac",
        trust_state: "trusted",
        trusted_key_version: 2,
      }),
      Response.json({
        id: "device-1",
        display_name: "MacBook",
        platform: "mac",
        trust_state: "trusted",
        trusted_key_version: 2,
      }),
      Response.json({
        id: "device-1",
        display_name: "MacBook",
        platform: "mac",
        trust_state: "untrusted",
        trusted_key_version: 2,
      }),
      Response.json({
        id: "device-1",
        display_name: "MacBook",
        platform: "mac",
        trust_state: "untrusted",
        trusted_key_version: 2,
      }),
      Response.json({
        id: "device-1",
        display_name: "MacBook",
        platform: "mac",
        trust_state: "untrusted",
      }),
      Response.json({ code: "DEVICE_NOT_FOUND", message: "not found" }, { status: 404 }),
    ];
    const listResponses: Response[] = [
      Response.json([
        {
          id: "trusted-device",
          display_name: "iPhone",
          platform: "ios",
          trust_state: "trusted",
          last_seen_at: "2026-01-01T00:00:00Z",
        },
      ]),
      Response.json([]),
      Response.json([]),
    ];
    const requests: string[] = [];
    const service = createLocalConnectDeviceSyncService({
      db,
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test" },
      fetch: async (input) => {
        requests.push(String(input));
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        if (String(input).endsWith("/api/v1/sync/team/devices?scope=my")) {
          return listResponses.shift() ?? Response.json([]);
        }
        if (String(input).endsWith("/api/v1/sync/team/keys/initialize")) {
          return Response.json({
            mode: "PAIRING_REQUIRED",
            e2ee_key_version: 3,
            require_sas: true,
            pairing_ttl_seconds: 300,
            trusted_devices: [],
          });
        }
        return deviceResponses.shift() ?? Response.json({}, { status: 500 });
      },
    });

    try {
      secretService.entries.set(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-1",
          deviceId: "device-1",
          rootKey: "root-key",
          keyVersion: 2,
        }),
      );
      await expect(service.getDeviceSyncState()).resolves.toMatchObject({
        state: "READY",
        deviceId: "device-1",
        deviceName: "MacBook",
        keyVersion: 2,
        serverKeyVersion: 2,
        isTrusted: true,
        trustedDevices: [],
      });

      secretService.entries.set(
        "sync_identity",
        JSON.stringify({
          version: 2,
          deviceNonce: "nonce-1",
          deviceId: "device-1",
          keyVersion: 2,
        }),
      );
      await expect(service.getDeviceSyncState()).resolves.toMatchObject({
        state: "REGISTERED",
        deviceId: "device-1",
        keyVersion: null,
        serverKeyVersion: 2,
        isTrusted: true,
        trustedDevices: [],
      });

      await expect(service.getDeviceSyncState()).resolves.toMatchObject({
        state: "REGISTERED",
        deviceId: "device-1",
        keyVersion: null,
        serverKeyVersion: 2,
        isTrusted: false,
        trustedDevices: [
          {
            id: "trusted-device",
            name: "iPhone",
            platform: "ios",
            lastSeenAt: "2026-01-01T00:00:00Z",
          },
        ],
      });

      secretService.entries.set(
        "sync_identity",
        JSON.stringify({ version: 2, deviceNonce: "nonce-1", deviceId: "device-1" }),
      );
      await expect(service.getDeviceSyncState()).resolves.toMatchObject({
        state: "ORPHANED",
        deviceId: "device-1",
        keyVersion: null,
        serverKeyVersion: 2,
        isTrusted: false,
        trustedDevices: [],
      });

      await expect(service.getDeviceSyncState()).resolves.toMatchObject({
        state: "ORPHANED",
        deviceId: "device-1",
        keyVersion: null,
        serverKeyVersion: null,
        isTrusted: false,
        trustedDevices: [],
      });

      await expect(service.getDeviceSyncState()).resolves.toMatchObject({
        state: "RECOVERY",
        deviceId: "device-1",
        deviceName: null,
        isTrusted: false,
      });
      expect(
        requests.filter((request) => request.includes("/api/v1/sync/team/devices/device-1")),
      ).toHaveLength(6);
      expect(
        requests.filter((request) => request.endsWith("/api/v1/sync/team/devices?scope=my")),
      ).toHaveLength(3);
      expect(
        requests.filter((request) => request.endsWith("/api/v1/sync/team/keys/initialize")),
      ).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  test("reads local sync engine status and bootstrap requirement", async () => {
    const db = new Database(":memory:");
    const secretService = createMemorySecretService();
    secretService.entries.set(
      "sync_identity",
      JSON.stringify({
        version: 2,
        deviceNonce: "nonce-1",
        deviceId: "device-1",
        rootKey: "root-key",
        keyVersion: 7,
      }),
    );
    db.exec(`
      CREATE TABLE sync_cursor (id INTEGER PRIMARY KEY CHECK (id = 1), cursor BIGINT NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
      CREATE TABLE sync_engine_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        lock_version BIGINT NOT NULL DEFAULT 0,
        last_push_at TEXT,
        last_pull_at TEXT,
        last_error TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        next_retry_at TEXT,
        last_cycle_status TEXT,
        last_cycle_duration_ms BIGINT
      );
      CREATE TABLE sync_device_config (
        device_id TEXT PRIMARY KEY NOT NULL,
        key_version INTEGER,
        trust_state TEXT NOT NULL DEFAULT 'untrusted',
        last_bootstrap_at TEXT
      );
      INSERT INTO sync_cursor (id, cursor, updated_at) VALUES (1, 42, '2026-01-01T00:00:00Z');
      INSERT INTO sync_engine_state (
        id, lock_version, last_push_at, last_pull_at, last_error, consecutive_failures,
        next_retry_at, last_cycle_status, last_cycle_duration_ms
      ) VALUES (
        1, 5, '2026-01-02T00:00:00Z', '2026-01-03T00:00:00Z', 'last-error', 2,
        '2026-01-04T00:00:00Z', 'ok', 123
      );
      INSERT INTO sync_device_config (device_id, key_version, trust_state, last_bootstrap_at)
      VALUES ('device-1', 7, 'trusted', '2026-01-01T00:00:00Z');
    `);
    const service = createLocalConnectDeviceSyncService({ db, secretService });

    try {
      await expect(service.getDeviceSyncEngineStatus()).resolves.toEqual({
        cursor: 42,
        lastPushAt: "2026-01-02T00:00:00Z",
        lastPullAt: "2026-01-03T00:00:00Z",
        lastError: "last-error",
        consecutiveFailures: 2,
        nextRetryAt: "2026-01-04T00:00:00Z",
        lastCycleStatus: "ok",
        lastCycleDurationMs: 123,
        backgroundRunning: false,
        bootstrapRequired: false,
      });

      db.prepare(
        "UPDATE sync_engine_state SET last_cycle_status = 'stale_cursor' WHERE id = 1",
      ).run();
      await expect(service.getDeviceSyncEngineStatus()).resolves.toMatchObject({
        bootstrapRequired: true,
      });
      await expect(service.getDeviceSyncBootstrapOverwriteCheck()).resolves.toEqual({
        bootstrapRequired: true,
        hasLocalData: false,
        localRows: 0,
        nonEmptyTables: [],
      });
    } finally {
      db.close();
    }
  });

  test("summarizes local overwrite risk rows for bootstrap checks", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE sync_cursor (id INTEGER PRIMARY KEY CHECK (id = 1), cursor BIGINT NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
      CREATE TABLE sync_engine_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        lock_version BIGINT NOT NULL DEFAULT 0,
        last_push_at TEXT,
        last_pull_at TEXT,
        last_error TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        next_retry_at TEXT,
        last_cycle_status TEXT,
        last_cycle_duration_ms BIGINT
      );
      CREATE TABLE sync_device_config (
        device_id TEXT PRIMARY KEY NOT NULL,
        key_version INTEGER,
        trust_state TEXT NOT NULL DEFAULT 'untrusted',
        last_bootstrap_at TEXT
      );
      CREATE TABLE accounts (id TEXT PRIMARY KEY NOT NULL);
      CREATE TABLE assets (id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL);
      CREATE TABLE quotes (id TEXT PRIMARY KEY NOT NULL, source TEXT NOT NULL);
      CREATE TABLE import_templates (id TEXT PRIMARY KEY NOT NULL, scope TEXT NOT NULL);
      INSERT INTO sync_cursor (id, cursor, updated_at) VALUES (1, 0, '2026-01-01T00:00:00Z');
      INSERT INTO sync_engine_state (id, lock_version) VALUES (1, 0);
      INSERT INTO accounts (id) VALUES ('account-1');
      INSERT INTO assets (id, kind) VALUES ('asset-1', 'PROPERTY'), ('asset-2', 'EQUITY');
      INSERT INTO quotes (id, source) VALUES ('quote-1', 'MANUAL'), ('quote-2', 'YAHOO');
      INSERT INTO import_templates (id, scope) VALUES ('template-1', 'USER'), ('template-2', 'SYSTEM');
    `);
    const service = createLocalConnectDeviceSyncService({ db });

    try {
      await expect(service.getDeviceSyncBootstrapOverwriteCheck()).resolves.toEqual({
        bootstrapRequired: true,
        hasLocalData: true,
        localRows: 4,
        nonEmptyTables: [
          { table: "accounts", rows: 1 },
          { table: "assets", rows: 1 },
          { table: "import_templates", rows: 1 },
          { table: "quotes", rows: 1 },
        ],
      });
    } finally {
      db.close();
    }
  });

  test("returns local background and snapshot cancellation no-op responses", async () => {
    const db = new Database(":memory:");
    const service = createLocalConnectDeviceSyncService({ db });

    try {
      await expect(service.startDeviceSyncBackgroundEngine()).resolves.toEqual({
        status: "skipped",
        message: "Background engine not started because sync identity is not configured",
      });
      expect(service.stopDeviceSyncBackgroundEngine()).toEqual({
        status: "stopped",
        message: "Device sync background engine stopped",
      });
      expect(service.cancelDeviceSnapshotUpload()).toEqual({
        status: "cancel_requested",
        message: "Snapshot upload cancellation requested",
      });
    } finally {
      db.close();
    }
  });

  test("keeps background engine start feature-gated when sync identity can run", async () => {
    const db = new Database(":memory:");
    const secretService = createMemorySecretService();
    secretService.entries.set(
      "sync_identity",
      JSON.stringify({
        version: 2,
        deviceNonce: "nonce-1",
        deviceId: "device-1",
        rootKey: "root-key",
        keyVersion: 1,
      }),
    );
    const service = createLocalConnectDeviceSyncService({ db, secretService });

    try {
      await expect(service.startDeviceSyncBackgroundEngine()).rejects.toMatchObject({
        code: "not_implemented",
        status: 501,
      });
    } finally {
      db.close();
    }
  });

  test("clears local device sync session data while preserving app data and device nonce", async () => {
    const db = new Database(":memory:");
    const secretService = createMemorySecretService();
    secretService.entries.set(
      "sync_identity",
      JSON.stringify({
        version: 2,
        deviceNonce: "nonce-1",
        deviceId: "device-1",
        rootKey: "root-key",
        keyVersion: 3,
        deviceSecretKey: "secret-key",
        devicePublicKey: "public-key",
      }),
    );
    secretService.entries.set("sync_device_id", "device-1");
    db.exec(`
      CREATE TABLE accounts (id TEXT PRIMARY KEY NOT NULL);
      CREATE TABLE sync_cursor (id INTEGER PRIMARY KEY CHECK (id = 1), cursor BIGINT NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
      CREATE TABLE sync_outbox (
        event_id TEXT PRIMARY KEY NOT NULL,
        entity TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        op TEXT NOT NULL,
        client_timestamp TEXT NOT NULL,
        payload TEXT NOT NULL,
        payload_key_version INTEGER NOT NULL,
        sent INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        retry_count INTEGER NOT NULL DEFAULT 0,
        next_retry_at TEXT,
        last_error TEXT,
        last_error_code TEXT,
        device_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE sync_entity_metadata (
        entity TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        last_event_id TEXT NOT NULL,
        last_client_timestamp TEXT NOT NULL,
        last_op TEXT NOT NULL DEFAULT 'update',
        last_seq BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (entity, entity_id)
      );
      CREATE TABLE sync_device_config (
        device_id TEXT PRIMARY KEY NOT NULL,
        key_version INTEGER,
        trust_state TEXT NOT NULL DEFAULT 'untrusted',
        last_bootstrap_at TEXT,
        min_snapshot_created_at TEXT
      );
      CREATE TABLE sync_engine_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        lock_version BIGINT NOT NULL DEFAULT 0,
        last_push_at TEXT,
        last_pull_at TEXT,
        last_error TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        next_retry_at TEXT,
        last_cycle_status TEXT,
        last_cycle_duration_ms BIGINT
      );
      CREATE TABLE sync_table_state (table_name TEXT PRIMARY KEY NOT NULL, enabled INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE sync_applied_events (
        event_id TEXT PRIMARY KEY NOT NULL,
        seq BIGINT NOT NULL,
        entity TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      INSERT INTO accounts (id) VALUES ('account-keep');
      INSERT INTO sync_cursor (id, cursor, updated_at) VALUES (1, 42, '2026-01-01T00:00:00Z');
      INSERT INTO sync_outbox (
        event_id, entity, entity_id, op, client_timestamp, payload, payload_key_version,
        sent, status, retry_count, device_id, created_at
      ) VALUES (
        'event-1', 'account', 'account-1', 'update', '2026-01-01T00:00:00Z', '{}', 3,
        0, 'pending', 0, 'device-1', '2026-01-01T00:00:00Z'
      );
      INSERT INTO sync_entity_metadata (
        entity, entity_id, last_event_id, last_client_timestamp, last_op, last_seq
      ) VALUES ('account', 'account-1', 'event-1', '2026-01-01T00:00:00Z', 'update', 9);
      INSERT INTO sync_applied_events (
        event_id, seq, entity, entity_id, applied_at
      ) VALUES ('event-applied', 10, 'account', 'account-1', '2026-01-01T00:00:00Z');
      INSERT INTO sync_device_config (
        device_id, key_version, trust_state, last_bootstrap_at, min_snapshot_created_at
      ) VALUES ('device-1', 3, 'trusted', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z');
      INSERT INTO sync_engine_state (
        id, lock_version, last_push_at, last_pull_at, last_error, consecutive_failures,
        next_retry_at, last_cycle_status, last_cycle_duration_ms
      ) VALUES (
        1, 7, '2026-01-02T00:00:00Z', '2026-01-03T00:00:00Z', 'stale', 2,
        '2026-01-04T00:00:00Z', 'failed', 50
      );
      INSERT INTO sync_table_state (table_name, enabled) VALUES ('accounts', 1);
    `);
    const service = createLocalConnectDeviceSyncService({ db, secretService });

    try {
      await service.clearDeviceSyncData();

      expect(JSON.parse(secretService.entries.get("sync_identity") ?? "{}")).toEqual({
        version: 2,
        deviceNonce: "nonce-1",
        deviceId: null,
        rootKey: null,
        keyVersion: null,
        deviceSecretKey: null,
        devicePublicKey: null,
      });
      expect(secretService.entries.has("sync_device_id")).toBe(false);
      expect(
        db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM accounts").get(),
      ).toEqual({
        count: 1,
      });
      for (const tableName of [
        "sync_outbox",
        "sync_entity_metadata",
        "sync_applied_events",
        "sync_table_state",
        "sync_device_config",
      ]) {
        expect(
          db.query<{ count: number }, []>(`SELECT COUNT(*) AS count FROM "${tableName}"`).get(),
        ).toEqual({ count: 0 });
      }
      expect(
        db.query<{ cursor: number }, []>("SELECT cursor FROM sync_cursor WHERE id = 1").get(),
      ).toEqual({ cursor: 0 });
      expect(
        db
          .query<
            { lock_version: number; last_error: string | null; last_cycle_status: string | null },
            []
          >("SELECT lock_version, last_error, last_cycle_status FROM sync_engine_state WHERE id = 1")
          .get(),
      ).toEqual({ lock_version: 0, last_error: null, last_cycle_status: null });
    } finally {
      db.close();
    }
  });

  test("rejects malformed sync identity during local device sync clear", async () => {
    const db = new Database(":memory:");
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_identity", JSON.stringify({ deviceNonce: 42 }));
    secretService.entries.set("sync_device_id", "device-1");
    const service = createLocalConnectDeviceSyncService({ db, secretService });

    try {
      await expect(service.clearDeviceSyncData()).rejects.toThrow("Failed to parse identity");
      expect(secretService.entries.get("sync_identity")).toBe(JSON.stringify({ deviceNonce: 42 }));
      expect(secretService.entries.get("sync_device_id")).toBe("device-1");
    } finally {
      db.close();
    }
  });

  test("records config error for local trigger cycle without sync identity", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE sync_cursor (id INTEGER PRIMARY KEY CHECK (id = 1), cursor BIGINT NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
      CREATE TABLE sync_engine_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        lock_version BIGINT NOT NULL DEFAULT 0,
        last_push_at TEXT,
        last_pull_at TEXT,
        last_error TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        next_retry_at TEXT,
        last_cycle_status TEXT,
        last_cycle_duration_ms BIGINT
      );
      CREATE TABLE sync_device_config (
        device_id TEXT PRIMARY KEY NOT NULL,
        key_version INTEGER,
        trust_state TEXT NOT NULL DEFAULT 'untrusted',
        last_bootstrap_at TEXT
      );
      INSERT INTO sync_cursor (id, cursor, updated_at) VALUES (1, 7, '2026-01-01T00:00:00Z');
      INSERT INTO sync_engine_state (id, lock_version) VALUES (1, 3);
    `);
    const service = createLocalConnectDeviceSyncService({ db });

    try {
      await expect(service.triggerDeviceSyncCycle()).resolves.toEqual({
        status: "config_error",
        lockVersion: 3,
        pushedCount: 0,
        pulledCount: 0,
        cursor: 7,
        needsBootstrap: false,
        bootstrapSnapshotId: null,
        bootstrapSnapshotSeq: null,
        deadLetterCount: 0,
      });
      expect(
        db
          .query<
            { last_cycle_status: string | null; last_error: string | null },
            []
          >("SELECT last_cycle_status, last_error FROM sync_engine_state WHERE id = 1")
          .get(),
      ).toEqual({
        last_cycle_status: "config_error",
        last_error: "No sync identity configured. Please enable sync first.",
      });
    } finally {
      db.close();
    }
  });

  test("uses sync identity for local trigger cycle preconditions", async () => {
    const db = new Database(":memory:");
    const secretService = createMemorySecretService();
    db.exec(`
      CREATE TABLE sync_cursor (id INTEGER PRIMARY KEY CHECK (id = 1), cursor BIGINT NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
      CREATE TABLE sync_engine_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        lock_version BIGINT NOT NULL DEFAULT 0,
        last_push_at TEXT,
        last_pull_at TEXT,
        last_error TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        next_retry_at TEXT,
        last_cycle_status TEXT,
        last_cycle_duration_ms BIGINT
      );
      CREATE TABLE sync_device_config (
        device_id TEXT PRIMARY KEY NOT NULL,
        key_version INTEGER,
        trust_state TEXT NOT NULL DEFAULT 'untrusted',
        last_bootstrap_at TEXT
      );
      INSERT INTO sync_cursor (id, cursor, updated_at) VALUES (1, 9, '2026-01-01T00:00:00Z');
      INSERT INTO sync_engine_state (id, lock_version) VALUES (1, 4);
      INSERT INTO sync_device_config (device_id, key_version, trust_state, last_bootstrap_at)
      VALUES ('legacy-device', 1, 'trusted', '2026-01-01T00:00:00Z');
    `);
    const service = createLocalConnectDeviceSyncService({
      db,
      secretService,
      fetch: async () => Response.json({ access_token: "access-token" }),
    });

    try {
      await expect(service.triggerDeviceSyncCycle()).resolves.toMatchObject({
        status: "config_error",
        lockVersion: 4,
        cursor: 9,
      });

      secretService.entries.set("sync_identity", JSON.stringify({ version: 2, deviceId: null }));
      await expect(service.triggerDeviceSyncCycle()).resolves.toMatchObject({
        status: "not_ready",
        lockVersion: 4,
        cursor: 9,
      });

      secretService.entries.set(
        "sync_identity",
        JSON.stringify({ version: 2, deviceId: "device-1" }),
      );
      await expect(service.triggerDeviceSyncCycle()).resolves.toMatchObject({
        status: "state_error",
        lockVersion: 4,
        cursor: 9,
      });
      expect(
        db
          .query<
            { last_cycle_status: string | null; last_error: string | null },
            []
          >("SELECT last_cycle_status, last_error FROM sync_engine_state WHERE id = 1")
          .get(),
      ).toEqual({
        last_cycle_status: "state_error",
        last_error: "Failed to read sync state: No sync session configured",
      });

      secretService.entries.set("sync_refresh_token", "refresh-token");
      await expect(service.triggerDeviceSyncCycle()).resolves.toMatchObject({
        status: "not_ready",
        lockVersion: 4,
        cursor: 9,
      });

      secretService.entries.set(
        "sync_identity",
        JSON.stringify({ version: 2, deviceNonce: "nonce-1", deviceId: "device-1" }),
      );
      await expect(service.triggerDeviceSyncCycle()).rejects.toMatchObject({
        code: "not_implemented",
        status: 501,
      });
    } finally {
      db.close();
    }
  });

  test("reports local pairing source status preconditions before cloud cursor checks", async () => {
    const db = new Database(":memory:");
    const secretService = createMemorySecretService();
    db.exec(`
      CREATE TABLE sync_device_config (
        device_id TEXT PRIMARY KEY NOT NULL,
        key_version INTEGER,
        trust_state TEXT NOT NULL DEFAULT 'untrusted',
        last_bootstrap_at TEXT
      );
    `);
    db.prepare(
      "INSERT INTO sync_device_config (device_id, key_version, trust_state, last_bootstrap_at) VALUES ('legacy-device', 1, 'trusted', NULL)",
    ).run();
    const service = createLocalConnectDeviceSyncService({
      db,
      secretService,
      fetch: async () => Response.json({ access_token: "access-token" }),
    });

    try {
      await expect(service.getDeviceSyncPairingSourceStatus()).rejects.toThrow(
        "No sync identity configured. Please enable sync first.",
      );
      secretService.entries.set("sync_identity", JSON.stringify({ version: 2, deviceId: null }));
      await expect(service.getDeviceSyncPairingSourceStatus()).rejects.toThrow(
        "No device ID configured",
      );
      secretService.entries.set(
        "sync_identity",
        JSON.stringify({ version: 2, deviceId: "device-1" }),
      );
      await expect(service.getDeviceSyncPairingSourceStatus()).rejects.toMatchObject({
        code: "internal_error",
        message: "No sync session configured",
        status: 500,
      });
      secretService.entries.set("sync_refresh_token", "refresh-token");
      await expect(service.getDeviceSyncPairingSourceStatus()).rejects.toMatchObject({
        code: "not_implemented",
        status: 501,
      });
    } finally {
      db.close();
    }
  });

  test("reports local snapshot preconditions before cloud upload paths", async () => {
    const db = new Database(":memory:");
    const secretService = createMemorySecretService();
    db.exec(`
      CREATE TABLE sync_device_config (
        device_id TEXT PRIMARY KEY NOT NULL,
        key_version INTEGER,
        trust_state TEXT NOT NULL DEFAULT 'untrusted',
        last_bootstrap_at TEXT
      );
    `);
    db.prepare(
      "INSERT INTO sync_device_config (device_id, key_version, trust_state, last_bootstrap_at) VALUES ('legacy-device', 1, 'trusted', NULL)",
    ).run();
    const service = createLocalConnectDeviceSyncService({ db, secretService });

    try {
      await expect(service.bootstrapDeviceSnapshot()).rejects.toThrow(
        "No sync identity configured. Please enable sync first.",
      );
      await expect(service.generateDeviceSnapshotNow()).rejects.toThrow(
        "No sync identity configured. Please enable sync first.",
      );

      secretService.entries.set("sync_identity", '{"version":2.0,"deviceId":"device-1"}');
      await expect(service.bootstrapDeviceSnapshot()).rejects.toThrow(
        "No sync identity configured. Please enable sync first.",
      );

      secretService.entries.set("sync_identity", JSON.stringify({ version: 2, deviceId: null }));
      await expect(service.bootstrapDeviceSnapshot()).rejects.toThrow("No device ID configured");

      secretService.entries.set(
        "sync_identity",
        JSON.stringify({ version: 2, deviceId: "device-1" }),
      );
      await expect(service.generateDeviceSnapshotNow()).rejects.toMatchObject({
        code: "forbidden",
        status: 403,
      });
    } finally {
      db.close();
    }
  });

  test("skips snapshot operations when cloud sync state is not ready", async () => {
    const db = new Database(":memory:");
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    secretService.entries.set(
      "sync_identity",
      JSON.stringify({ version: 2, deviceNonce: "nonce-1", deviceId: "device-1" }),
    );
    const service = createLocalConnectDeviceSyncService({
      db,
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test" },
      fetch: async (input) => {
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        return Response.json({
          id: "device-1",
          display_name: "MacBook",
          trust_state: "untrusted",
          trusted_key_version: 2,
        });
      },
    });

    try {
      await expect(service.bootstrapDeviceSnapshot()).resolves.toEqual({
        status: "skipped_not_ready",
        message: "Device is not in READY state",
        snapshotId: null,
        cursor: null,
      });
      await expect(service.generateDeviceSnapshotNow()).resolves.toEqual({
        status: "skipped",
        snapshotId: null,
        oplogSeq: null,
        message: "Current device is not trusted",
      });
    } finally {
      db.close();
    }
  });

  test("skips bootstrap snapshot when READY local bootstrap is already complete", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE sync_cursor (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        cursor BIGINT NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE sync_engine_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        lock_version BIGINT NOT NULL DEFAULT 0,
        last_push_at TEXT,
        last_pull_at TEXT,
        last_error TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        next_retry_at TEXT,
        last_cycle_status TEXT,
        last_cycle_duration_ms BIGINT
      );
      CREATE TABLE sync_device_config (
        device_id TEXT PRIMARY KEY NOT NULL,
        key_version INTEGER,
        trust_state TEXT NOT NULL DEFAULT 'trusted',
        last_bootstrap_at TEXT,
        min_snapshot_created_at TEXT
      );
      INSERT INTO sync_cursor (id, cursor, updated_at) VALUES (1, 42, '2026-01-01T00:00:00Z');
      INSERT INTO sync_engine_state (id, lock_version, last_cycle_status) VALUES (1, 0, 'ok');
      INSERT INTO sync_device_config (
        device_id, key_version, trust_state, last_bootstrap_at, min_snapshot_created_at
      ) VALUES ('device-1', 1, 'untrusted', '2026-01-01T00:00:00Z', NULL);
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    secretService.entries.set(
      "sync_identity",
      JSON.stringify({
        version: 2,
        deviceNonce: "nonce-1",
        deviceId: "device-1",
        rootKey: "root-key",
        keyVersion: 2,
      }),
    );
    const requests: string[] = [];
    const service = createLocalConnectDeviceSyncService({
      db,
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test" },
      fetch: async (input) => {
        requests.push(String(input));
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        if (String(input).includes("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "NOOP" });
        }
        return Response.json({
          id: "device-1",
          display_name: "MacBook",
          trust_state: "trusted",
          trusted_key_version: 2,
        });
      },
    });

    try {
      await expect(service.bootstrapDeviceSnapshot()).resolves.toEqual({
        status: "skipped",
        message: "Snapshot bootstrap already completed",
        snapshotId: null,
        cursor: 42,
      });
      expect(requests).toEqual([
        "https://auth.wealthfolio.app/auth/v1/token?grant_type=refresh_token",
        "https://api.example.test/api/v1/sync/team/devices/device-1",
        "https://api.example.test/api/v1/sync/events/reconcile-ready-state",
      ]);
      expect(
        db
          .query<
            { key_version: number | null; trust_state: string; last_bootstrap_at: string | null },
            []
          >("SELECT key_version, trust_state, last_bootstrap_at FROM sync_device_config WHERE device_id = 'device-1'")
          .get(),
      ).toEqual({
        key_version: 2,
        trust_state: "trusted",
        last_bootstrap_at: "2026-01-01T00:00:00Z",
      });
    } finally {
      db.close();
    }
  });

  test("keeps bootstrap snapshot feature-gated when READY reconcile requires snapshot", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE sync_cursor (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        cursor BIGINT NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE sync_engine_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        lock_version BIGINT NOT NULL DEFAULT 0,
        last_push_at TEXT,
        last_pull_at TEXT,
        last_error TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        next_retry_at TEXT,
        last_cycle_status TEXT,
        last_cycle_duration_ms BIGINT
      );
      CREATE TABLE sync_device_config (
        device_id TEXT PRIMARY KEY NOT NULL,
        key_version INTEGER,
        trust_state TEXT NOT NULL DEFAULT 'trusted',
        last_bootstrap_at TEXT,
        min_snapshot_created_at TEXT
      );
      INSERT INTO sync_cursor (id, cursor, updated_at) VALUES (1, 42, '2026-01-01T00:00:00Z');
      INSERT INTO sync_engine_state (id, lock_version, last_cycle_status) VALUES (1, 0, 'ok');
      INSERT INTO sync_device_config (
        device_id, key_version, trust_state, last_bootstrap_at, min_snapshot_created_at
      ) VALUES ('device-1', 2, 'trusted', '2026-01-01T00:00:00Z', NULL);
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    secretService.entries.set(
      "sync_identity",
      JSON.stringify({
        version: 2,
        deviceNonce: "nonce-1",
        deviceId: "device-1",
        rootKey: "root-key",
        keyVersion: 2,
      }),
    );
    const service = createLocalConnectDeviceSyncService({
      db,
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test" },
      fetch: async (input) => {
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        if (String(input).includes("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "WAIT_SNAPSHOT" });
        }
        return Response.json({
          id: "device-1",
          display_name: "MacBook",
          trust_state: "trusted",
          trusted_key_version: 2,
        });
      },
    });

    try {
      await expect(service.bootstrapDeviceSnapshot()).rejects.toMatchObject({
        code: "not_implemented",
        status: 501,
      });
    } finally {
      db.close();
    }
  });

  test("keeps bootstrap snapshot feature-gated when READY freshness gate is active", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE sync_cursor (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        cursor BIGINT NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE sync_engine_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        lock_version BIGINT NOT NULL DEFAULT 0,
        last_push_at TEXT,
        last_pull_at TEXT,
        last_error TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        next_retry_at TEXT,
        last_cycle_status TEXT,
        last_cycle_duration_ms BIGINT
      );
      CREATE TABLE sync_device_config (
        device_id TEXT PRIMARY KEY NOT NULL,
        key_version INTEGER,
        trust_state TEXT NOT NULL DEFAULT 'trusted',
        last_bootstrap_at TEXT,
        min_snapshot_created_at TEXT
      );
      INSERT INTO sync_cursor (id, cursor, updated_at) VALUES (1, 42, '2026-01-01T00:00:00Z');
      INSERT INTO sync_engine_state (id, lock_version, last_cycle_status) VALUES (1, 0, 'ok');
      INSERT INTO sync_device_config (
        device_id, key_version, trust_state, last_bootstrap_at, min_snapshot_created_at
      ) VALUES ('device-1', 2, 'trusted', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    secretService.entries.set(
      "sync_identity",
      JSON.stringify({
        version: 2,
        deviceNonce: "nonce-1",
        deviceId: "device-1",
        rootKey: "root-key",
        keyVersion: 2,
      }),
    );
    const requests: string[] = [];
    const service = createLocalConnectDeviceSyncService({
      db,
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test" },
      fetch: async (input) => {
        requests.push(String(input));
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        return Response.json({
          id: "device-1",
          display_name: "MacBook",
          trust_state: "trusted",
          trusted_key_version: 2,
        });
      },
    });

    try {
      await expect(service.bootstrapDeviceSnapshot()).rejects.toMatchObject({
        code: "not_implemented",
        status: 501,
      });
      expect(requests).toEqual([
        "https://auth.wealthfolio.app/auth/v1/token?grant_type=refresh_token",
        "https://api.example.test/api/v1/sync/team/devices/device-1",
      ]);
    } finally {
      db.close();
    }
  });

  test("drops invalid bootstrap freshness gates before READY completed skip", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE sync_cursor (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        cursor BIGINT NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE sync_engine_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        lock_version BIGINT NOT NULL DEFAULT 0,
        last_push_at TEXT,
        last_pull_at TEXT,
        last_error TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        next_retry_at TEXT,
        last_cycle_status TEXT,
        last_cycle_duration_ms BIGINT
      );
      CREATE TABLE sync_device_config (
        device_id TEXT PRIMARY KEY NOT NULL,
        key_version INTEGER,
        trust_state TEXT NOT NULL DEFAULT 'trusted',
        last_bootstrap_at TEXT,
        min_snapshot_created_at TEXT
      );
      INSERT INTO sync_cursor (id, cursor, updated_at) VALUES (1, 42, '2026-01-01T00:00:00Z');
      INSERT INTO sync_engine_state (id, lock_version, last_cycle_status) VALUES (1, 0, 'ok');
      INSERT INTO sync_device_config (
        device_id, key_version, trust_state, last_bootstrap_at, min_snapshot_created_at
      ) VALUES ('device-1', 2, 'trusted', '2026-01-01T00:00:00Z', '2026-02-30T00:00:00Z');
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    secretService.entries.set(
      "sync_identity",
      JSON.stringify({
        version: 2,
        deviceNonce: "nonce-1",
        deviceId: "device-1",
        rootKey: "root-key",
        keyVersion: 2,
      }),
    );
    const service = createLocalConnectDeviceSyncService({
      db,
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test" },
      fetch: async (input) => {
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        if (String(input).includes("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "NOOP" });
        }
        return Response.json({
          id: "device-1",
          display_name: "MacBook",
          trust_state: "trusted",
          trusted_key_version: 2,
        });
      },
    });

    try {
      await expect(service.bootstrapDeviceSnapshot()).resolves.toMatchObject({
        status: "skipped",
        message: "Snapshot bootstrap already completed",
      });
      expect(
        db
          .query<
            { min_snapshot_created_at: string | null },
            []
          >("SELECT min_snapshot_created_at FROM sync_device_config WHERE device_id = 'device-1'")
          .get(),
      ).toEqual({ min_snapshot_created_at: null });
    } finally {
      db.close();
    }
  });

  test("skips bootstrap snapshot when READY config persistence is best-effort", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE sync_cursor (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        cursor BIGINT NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE sync_engine_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        lock_version BIGINT NOT NULL DEFAULT 0,
        last_push_at TEXT,
        last_pull_at TEXT,
        last_error TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        next_retry_at TEXT,
        last_cycle_status TEXT,
        last_cycle_duration_ms BIGINT
      );
      CREATE TABLE sync_device_config (
        device_id TEXT PRIMARY KEY NOT NULL,
        last_bootstrap_at TEXT
      );
      INSERT INTO sync_cursor (id, cursor, updated_at) VALUES (1, 42, '2026-01-01T00:00:00Z');
      INSERT INTO sync_engine_state (id, lock_version, last_cycle_status) VALUES (1, 0, 'ok');
      INSERT INTO sync_device_config (device_id, last_bootstrap_at)
      VALUES ('device-1', '2026-01-01T00:00:00Z');
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    secretService.entries.set(
      "sync_identity",
      JSON.stringify({
        version: 2,
        deviceNonce: "nonce-1",
        deviceId: "device-1",
        rootKey: "root-key",
        keyVersion: 2,
      }),
    );
    const service = createLocalConnectDeviceSyncService({
      db,
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test" },
      fetch: async (input) => {
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        if (String(input).includes("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "NOOP" });
        }
        return Response.json({
          id: "device-1",
          display_name: "MacBook",
          trust_state: "trusted",
          trusted_key_version: 2,
        });
      },
    });

    try {
      await expect(service.bootstrapDeviceSnapshot()).resolves.toEqual({
        status: "skipped",
        message: "Snapshot bootstrap already completed",
        snapshotId: null,
        cursor: 42,
      });
    } finally {
      db.close();
    }
  });

  test("marks READY bootstrap complete when no remote snapshot is required", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE sync_cursor (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        cursor BIGINT NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE sync_engine_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        lock_version BIGINT NOT NULL DEFAULT 0,
        last_push_at TEXT,
        last_pull_at TEXT,
        last_error TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        next_retry_at TEXT,
        last_cycle_status TEXT,
        last_cycle_duration_ms BIGINT
      );
      CREATE TABLE sync_device_config (
        device_id TEXT PRIMARY KEY NOT NULL,
        key_version INTEGER,
        trust_state TEXT NOT NULL DEFAULT 'trusted',
        last_bootstrap_at TEXT,
        min_snapshot_created_at TEXT
      );
      CREATE TABLE sync_outbox (id TEXT PRIMARY KEY NOT NULL);
      INSERT INTO sync_cursor (id, cursor, updated_at) VALUES (1, 42, '2026-01-01T00:00:00Z');
      INSERT INTO sync_engine_state (id, lock_version, last_cycle_status) VALUES (1, 7, 'ok');
      INSERT INTO sync_device_config (
        device_id, key_version, trust_state, last_bootstrap_at, min_snapshot_created_at
      ) VALUES ('device-1', 2, 'trusted', NULL, NULL);
      INSERT INTO sync_outbox (id) VALUES ('event-1');
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    secretService.entries.set(
      "sync_identity",
      JSON.stringify({
        version: 2,
        deviceNonce: "nonce-1",
        deviceId: "device-1",
        rootKey: "root-key",
        keyVersion: 2,
      }),
    );
    const requests: string[] = [];
    const service = createLocalConnectDeviceSyncService({
      db,
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test" },
      fetch: async (input) => {
        requests.push(String(input));
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        if (String(input).includes("/api/v1/sync/snapshots/latest")) {
          return Response.json(
            { code: "SNAPSHOT_NOT_FOUND", message: "not found" },
            { status: 404 },
          );
        }
        if (String(input).includes("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "NOOP" });
        }
        return Response.json({
          id: "device-1",
          display_name: "MacBook",
          trust_state: "trusted",
          trusted_key_version: 2,
        });
      },
    });

    try {
      await expect(service.bootstrapDeviceSnapshot()).resolves.toEqual({
        status: "skipped",
        message: "No remote snapshot is required for this device",
        snapshotId: null,
        cursor: 0,
      });
      expect(requests).toEqual([
        "https://auth.wealthfolio.app/auth/v1/token?grant_type=refresh_token",
        "https://api.example.test/api/v1/sync/team/devices/device-1",
        "https://api.example.test/api/v1/sync/events/reconcile-ready-state",
        "https://api.example.test/api/v1/sync/snapshots/latest",
        "https://api.example.test/api/v1/sync/events/reconcile-ready-state",
      ]);
      expect(
        db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM sync_outbox").get(),
      ).toEqual({
        count: 0,
      });
      expect(
        db
          .query<
            {
              key_version: number | null;
              trust_state: string;
              last_bootstrap_at: string | null;
              min_snapshot_created_at: string | null;
            },
            []
          >(
            "SELECT key_version, trust_state, last_bootstrap_at, min_snapshot_created_at FROM sync_device_config WHERE device_id = 'device-1'",
          )
          .get(),
      ).toMatchObject({
        key_version: 2,
        trust_state: "trusted",
        min_snapshot_created_at: null,
      });
    } finally {
      db.close();
    }
  });

  test("marks completed READY bootstrap complete after reconcile snapshot race clears", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE sync_cursor (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        cursor BIGINT NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE sync_engine_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        lock_version BIGINT NOT NULL DEFAULT 0,
        last_push_at TEXT,
        last_pull_at TEXT,
        last_error TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        next_retry_at TEXT,
        last_cycle_status TEXT,
        last_cycle_duration_ms BIGINT
      );
      CREATE TABLE sync_device_config (
        device_id TEXT PRIMARY KEY NOT NULL,
        key_version INTEGER,
        trust_state TEXT NOT NULL DEFAULT 'trusted',
        last_bootstrap_at TEXT,
        min_snapshot_created_at TEXT
      );
      CREATE TABLE sync_outbox (id TEXT PRIMARY KEY NOT NULL);
      INSERT INTO sync_cursor (id, cursor, updated_at) VALUES (1, 42, '2026-01-01T00:00:00Z');
      INSERT INTO sync_engine_state (id, lock_version, last_cycle_status) VALUES (1, 7, 'ok');
      INSERT INTO sync_device_config (
        device_id, key_version, trust_state, last_bootstrap_at, min_snapshot_created_at
      ) VALUES ('device-1', 2, 'trusted', '2026-01-01T00:00:00Z', NULL);
      INSERT INTO sync_outbox (id) VALUES ('event-1');
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    secretService.entries.set(
      "sync_identity",
      JSON.stringify({
        version: 2,
        deviceNonce: "nonce-1",
        deviceId: "device-1",
        rootKey: "root-key",
        keyVersion: 2,
      }),
    );
    const reconcileActions = ["WAIT_SNAPSHOT", "NOOP"];
    const service = createLocalConnectDeviceSyncService({
      db,
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test" },
      fetch: async (input) => {
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        if (String(input).includes("/api/v1/sync/snapshots/latest")) {
          return Response.json(
            { code: "SNAPSHOT_NOT_FOUND", message: "not found" },
            { status: 404 },
          );
        }
        if (String(input).includes("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: reconcileActions.shift() ?? "NOOP" });
        }
        return Response.json({
          id: "device-1",
          display_name: "MacBook",
          trust_state: "trusted",
          trusted_key_version: 2,
        });
      },
    });

    try {
      await expect(service.bootstrapDeviceSnapshot()).resolves.toEqual({
        status: "skipped",
        message: "No remote snapshot is required for this device",
        snapshotId: null,
        cursor: 0,
      });
      expect(
        db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM sync_outbox").get(),
      ).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });

  test("keeps READY missing-snapshot bootstrap feature-gated when reconcile still waits", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE sync_cursor (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        cursor BIGINT NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE sync_engine_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        lock_version BIGINT NOT NULL DEFAULT 0,
        last_push_at TEXT,
        last_pull_at TEXT,
        last_error TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        next_retry_at TEXT,
        last_cycle_status TEXT,
        last_cycle_duration_ms BIGINT
      );
      CREATE TABLE sync_device_config (
        device_id TEXT PRIMARY KEY NOT NULL,
        key_version INTEGER,
        trust_state TEXT NOT NULL DEFAULT 'trusted',
        last_bootstrap_at TEXT,
        min_snapshot_created_at TEXT
      );
      CREATE TABLE sync_outbox (id TEXT PRIMARY KEY NOT NULL);
      INSERT INTO sync_cursor (id, cursor, updated_at) VALUES (1, 42, '2026-01-01T00:00:00Z');
      INSERT INTO sync_engine_state (id, lock_version, last_cycle_status) VALUES (1, 7, 'ok');
      INSERT INTO sync_device_config (
        device_id, key_version, trust_state, last_bootstrap_at, min_snapshot_created_at
      ) VALUES ('device-1', 2, 'trusted', NULL, NULL);
      INSERT INTO sync_outbox (id) VALUES ('event-1');
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    secretService.entries.set(
      "sync_identity",
      JSON.stringify({
        version: 2,
        deviceNonce: "nonce-1",
        deviceId: "device-1",
        rootKey: "root-key",
        keyVersion: 2,
      }),
    );
    const service = createLocalConnectDeviceSyncService({
      db,
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test" },
      fetch: async (input) => {
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        if (String(input).includes("/api/v1/sync/snapshots/latest")) {
          return Response.json(
            { code: "SNAPSHOT_NOT_FOUND", message: "not found" },
            { status: 404 },
          );
        }
        if (String(input).includes("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "WAIT_SNAPSHOT" });
        }
        return Response.json({
          id: "device-1",
          display_name: "MacBook",
          trust_state: "trusted",
          trusted_key_version: 2,
        });
      },
    });

    try {
      await expect(service.bootstrapDeviceSnapshot()).rejects.toMatchObject({
        code: "not_implemented",
        status: 501,
      });
      expect(
        db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM sync_outbox").get(),
      ).toEqual({ count: 1 });
    } finally {
      db.close();
    }
  });

  test("keeps READY bootstrap feature-gated when latest snapshot exists", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE sync_cursor (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        cursor BIGINT NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE sync_engine_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        lock_version BIGINT NOT NULL DEFAULT 0,
        last_push_at TEXT,
        last_pull_at TEXT,
        last_error TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        next_retry_at TEXT,
        last_cycle_status TEXT,
        last_cycle_duration_ms BIGINT
      );
      CREATE TABLE sync_device_config (
        device_id TEXT PRIMARY KEY NOT NULL,
        key_version INTEGER,
        trust_state TEXT NOT NULL DEFAULT 'trusted',
        last_bootstrap_at TEXT,
        min_snapshot_created_at TEXT
      );
      CREATE TABLE sync_outbox (id TEXT PRIMARY KEY NOT NULL);
      INSERT INTO sync_cursor (id, cursor, updated_at) VALUES (1, 42, '2026-01-01T00:00:00Z');
      INSERT INTO sync_engine_state (id, lock_version, last_cycle_status) VALUES (1, 7, 'ok');
      INSERT INTO sync_device_config (
        device_id, key_version, trust_state, last_bootstrap_at, min_snapshot_created_at
      ) VALUES ('device-1', 2, 'trusted', NULL, NULL);
      INSERT INTO sync_outbox (id) VALUES ('event-1');
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    secretService.entries.set(
      "sync_identity",
      JSON.stringify({
        version: 2,
        deviceNonce: "nonce-1",
        deviceId: "device-1",
        rootKey: "root-key",
        keyVersion: 2,
      }),
    );
    const service = createLocalConnectDeviceSyncService({
      db,
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test" },
      fetch: async (input) => {
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        if (String(input).includes("/api/v1/sync/snapshots/latest")) {
          return Response.json({
            snapshot_id: "snapshot-1",
            oplog_seq: 42,
            created_at: "2026-01-01T00:00:00Z",
            schema_version: 1,
          });
        }
        if (String(input).includes("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "NOOP" });
        }
        return Response.json({
          id: "device-1",
          display_name: "MacBook",
          trust_state: "trusted",
          trusted_key_version: 2,
        });
      },
    });

    try {
      await expect(service.bootstrapDeviceSnapshot()).rejects.toMatchObject({
        code: "not_implemented",
        status: 501,
      });
      expect(
        db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM sync_outbox").get(),
      ).toEqual({ count: 1 });
    } finally {
      db.close();
    }
  });
});
