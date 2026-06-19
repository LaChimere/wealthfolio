import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { ACTIVITY_BULK_CREATED_ASSET_IDS } from "./activities";
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

function snapshotDownloadResponse(
  checksum = "sha256:16a0eeb0791b6c92451fd284dd9f599e0a7dbe7f6ebea6e2d2d06c7f74aec112",
  overrides: Record<string, string | null> = {},
): Response {
  const headers: Record<string, string> = {
    "x-snapshot-schema-version": "1",
    "x-snapshot-covers-tables": "accounts",
    "x-snapshot-checksum": checksum,
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) {
      delete headers[key];
    } else {
      headers[key] = value;
    }
  }
  return new Response("snapshot", {
    headers,
  });
}

function createDeviceSyncStateDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE sync_cursor (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      cursor BIGINT NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE sync_engine_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      lock_version INTEGER NOT NULL DEFAULT 0,
      last_push_at TEXT,
      last_pull_at TEXT,
      last_error TEXT,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      next_retry_at TEXT,
      last_cycle_status TEXT,
      last_cycle_duration_ms INTEGER
    );
    CREATE TABLE sync_device_config (
      device_id TEXT PRIMARY KEY NOT NULL,
      key_version INTEGER,
      trust_state TEXT NOT NULL DEFAULT 'untrusted',
      last_bootstrap_at TEXT,
      min_snapshot_created_at TEXT
    );
    CREATE TABLE sync_outbox (id TEXT PRIMARY KEY);
    CREATE TABLE sync_entity_metadata (id TEXT PRIMARY KEY);
    CREATE TABLE sync_applied_events (id TEXT PRIMARY KEY);
    CREATE TABLE sync_table_state (id TEXT PRIMARY KEY);
    INSERT INTO sync_cursor (id, cursor, updated_at) VALUES (1, 42, '2026-01-01T00:00:00Z');
    INSERT INTO sync_engine_state (id, lock_version, last_cycle_status, last_error)
      VALUES (1, 7, 'stale_cursor', 'stale');
    INSERT INTO sync_device_config (
      device_id, key_version, trust_state, last_bootstrap_at, min_snapshot_created_at
    ) VALUES ('old-device', 1, 'trusted', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z');
    INSERT INTO sync_outbox (id) VALUES ('pending-event');
    INSERT INTO sync_entity_metadata (id) VALUES ('meta');
    INSERT INTO sync_applied_events (id) VALUES ('applied');
    INSERT INTO sync_table_state (id) VALUES ('state');
  `);
  return db;
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
        if (String(input).endsWith("/api/v1/user/me")) {
          return Response.json({
            id: "user-1",
            fullName: null,
            email: "user@example.test",
            team: {
              id: "team-1",
              name: "Team",
              plan: "pro",
              subscriptionStatus: "active",
            },
          });
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

  test("forbids broker data sync when the Connect plan lacks broker sync", async () => {
    const db = new Database(":memory:");
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    const requests: string[] = [];
    const service = createLocalConnectService({
      db,
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test" },
      fetch: async (input, init) => {
        requests.push(`${init?.method ?? "GET"} ${String(input)}`);
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        if (String(input).endsWith("/api/v1/user/me")) {
          return Response.json({
            id: "user-1",
            team: {
              id: "team-1",
              name: "Team",
              plan: "basic",
              subscription_status: "active",
            },
          });
        }
        throw new Error(`broker sync should not fetch ${String(input)}`);
      },
      accountService: {
        getBaseCurrency: () => "USD",
        getAllAccounts: () => [],
        createAccount: async () => {
          throw new Error("should not create accounts when forbidden");
        },
      },
      activityService: {
        getBrokerSyncProfile: () => null,
        saveBrokerSyncProfileRules: (request) => request,
      },
    });

    try {
      await expect(service.syncBrokerData()).resolves.toEqual({ status: "forbidden" });
      expect(requests).toEqual([
        "POST https://auth.wealthfolio.app/auth/v1/token?grant_type=refresh_token",
        "GET https://api.example.test/api/v1/user/me",
      ]);
    } finally {
      db.close();
    }
  });

  test("forbids broker data sync when entitlement verification fails", async () => {
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
        return Response.json({ code: "ENTITLEMENT_UNAVAILABLE" }, { status: 503 });
      },
      accountService: {
        getBaseCurrency: () => "USD",
        getAllAccounts: () => [],
        createAccount: async () => {
          throw new Error("should not create accounts when entitlement fails");
        },
      },
      activityService: {
        getBrokerSyncProfile: () => null,
        saveBrokerSyncProfileRules: (request) => request,
      },
    });

    try {
      await expect(service.syncBrokerData()).resolves.toEqual({ status: "forbidden" });
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
        return Response.json({
          data: [{ id: "activity-1", symbol: { symbol: "AAPL", raw_symbol: "AAPL" } }],
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

  test("syncs pure cash broker activities through activity bulk mutation", async () => {
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
    const bulkRequests: Record<string, unknown>[] = [];
    const service = createLocalConnectService({
      db,
      secretService,
      fetch: async (input) => {
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        return Response.json({
          data: [
            {
              id: "cash-activity-1",
              type: "DEPOSIT",
              trade_date: "2026-01-05T10:00:00Z",
              amount: -125.5,
              currency: { code: "USD" },
              provider_type: "SNAPTRADE",
              external_reference_id: "external-1",
              description: "Cash deposit",
              needs_review: true,
            },
          ],
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
        bulkMutateActivities: (request) => {
          bulkRequests.push(request);
          return {
            created: [{ id: "created-activity" }],
            updated: [],
            deleted: [],
            createdMappings: [],
            errors: [],
          };
        },
      },
    });

    try {
      await expect(service.syncBrokerActivities()).resolves.toEqual({
        accountsSynced: 1,
        activitiesUpserted: 1,
        assetsInserted: 0,
        accountsFailed: 0,
        accountsWarned: 0,
        newAssetIds: [],
      });
      expect(bulkRequests).toEqual([
        {
          creates: [
            expect.objectContaining({
              accountId: "transaction-account",
              activityType: "DEPOSIT",
              activityDate: "2026-01-05T10:00:00Z",
              amount: "125.5",
              currency: "USD",
              sourceSystem: "SNAPTRADE",
              sourceRecordId: "external-1",
              status: "DRAFT",
              needsReview: true,
              allowMissingAsset: true,
            }),
          ],
          updates: [],
          deleteIds: [],
        },
      ]);
      expect(
        db
          .query<
            { sync_status: string; last_error: string | null },
            []
          >("SELECT sync_status, last_error FROM brokers_sync_state WHERE account_id = 'transaction-account' AND provider = 'SNAPTRADE'")
          .get(),
      ).toEqual({ sync_status: "IDLE", last_error: null });
    } finally {
      db.close();
    }
  });

  test("skips Rust-era broker activities matched by source identity", async () => {
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
      CREATE TABLE activities (
        id TEXT PRIMARY KEY NOT NULL,
        account_id TEXT NOT NULL,
        source_system TEXT,
        source_record_id TEXT,
        idempotency_key TEXT
      );
      INSERT INTO activities (
        id, account_id, source_system, source_record_id, idempotency_key
      ) VALUES (
        'legacy-activity-row', 'transaction-account', 'SNAPTRADE',
        'legacy-source-record', NULL
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
        return Response.json({
          data: [
            {
              id: "cash-activity-1",
              type: "DEPOSIT",
              source_record_id: "legacy-source-record",
              trade_date: "2026-01-05T10:00:00Z",
              amount: 125.5,
              provider_type: "SNAPTRADE",
            },
          ],
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
        bulkMutateActivities: () => {
          throw new Error("should not duplicate legacy broker activity");
        },
      },
    });

    try {
      await expect(service.syncBrokerActivities()).resolves.toMatchObject({
        accountsSynced: 1,
        accountsFailed: 0,
        activitiesUpserted: 0,
      });
      expect(
        db
          .query<
            { sync_status: string; last_error: string | null },
            []
          >("SELECT sync_status, last_error FROM brokers_sync_state WHERE account_id = 'transaction-account' AND provider = 'SNAPTRADE'")
          .get(),
      ).toEqual({ sync_status: "IDLE", last_error: null });
    } finally {
      db.close();
    }
  });

  test("skips already imported pure cash broker activities during overlap sync", async () => {
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
        'transaction-account', 'SNAPTRADE', NULL, '2026-01-05T00:00:00.000Z',
        '2026-01-05T00:00:00.000Z', NULL, NULL, 'IDLE',
        '2026-01-05T00:00:00.000Z', '2026-01-05T00:00:00.000Z'
      );
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    const bulkRequests: Record<string, unknown>[] = [];
    const service = createLocalConnectService({
      db,
      secretService,
      fetch: async (input) => {
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        return Response.json({
          data: [
            {
              id: "cash-activity-1",
              activity_type: "DEPOSIT",
              trade_date: "2026-01-05T10:00:00Z",
              amount: 125.5,
              currency: { code: "USD" },
              provider_type: "SNAPTRADE",
            },
            {
              id: "cash-activity-2",
              activity_type: "FEE",
              trade_date: "2026-01-05T11:00:00Z",
              amount: -5,
              currency: { code: "USD" },
              provider_type: "SNAPTRADE",
            },
          ],
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
        checkExistingDuplicates: (keys) => ({
          [keys.find((key) => key.endsWith(":cash-activity-1")) ?? ""]: "existing-activity",
        }),
        bulkMutateActivities: (request) => {
          bulkRequests.push(request);
          return {
            created: [{ id: "created-activity" }],
            updated: [],
            deleted: [],
            createdMappings: [],
            errors: [],
          };
        },
      },
    });

    try {
      await expect(service.syncBrokerActivities()).resolves.toMatchObject({
        accountsSynced: 1,
        accountsFailed: 0,
        activitiesUpserted: 1,
      });
      expect(bulkRequests).toHaveLength(1);
      expect(bulkRequests[0]?.creates as Array<Record<string, unknown>> | undefined).toEqual([
        expect.objectContaining({
          sourceRecordId: "cash-activity-2",
          idempotencyKey: "broker:SNAPTRADE:transaction-account:cash-activity-2",
        }),
      ]);
    } finally {
      db.close();
    }
  });

  test("treats duplicate broker cash bulk errors as benign fallback", async () => {
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
        return Response.json({
          data: [
            {
              id: "cash-activity-1",
              activity_type: "DEPOSIT",
              trade_date: "2026-01-05T10:00:00Z",
              amount: 125.5,
              provider_type: "SNAPTRADE",
            },
          ],
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
        bulkMutateActivities: () => ({
          created: [],
          updated: [],
          deleted: [],
          createdMappings: [],
          errors: [
            {
              id: "cash-activity-1",
              action: "create",
              message: "Duplicate activity detected. A matching activity already exists.",
            },
          ],
        }),
      },
    });

    try {
      await expect(service.syncBrokerActivities()).resolves.toMatchObject({
        accountsSynced: 1,
        accountsFailed: 0,
        activitiesUpserted: 0,
      });
      expect(
        db
          .query<
            { sync_status: string; last_error: string | null },
            []
          >("SELECT sync_status, last_error FROM brokers_sync_state WHERE account_id = 'transaction-account' AND provider = 'SNAPTRADE'")
          .get(),
      ).toEqual({ sync_status: "IDLE", last_error: null });
    } finally {
      db.close();
    }
  });

  test("syncs unknown broker activities without symbols as review drafts", async () => {
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
    const bulkRequests: Record<string, unknown>[] = [];
    const service = createLocalConnectService({
      db,
      secretService,
      fetch: async (input) => {
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        return Response.json({
          data: [
            {
              id: "unknown-activity-1",
              activity_type: "UNKNOWN",
              trade_date: "2026-01-05T10:00:00Z",
              amount: 42,
              provider_type: "SNAPTRADE",
              mapping_metadata: { confidence: 0.4, reasons: ["Unknown transaction type"] },
            },
          ],
        });
      },
      accountService: {
        getAllAccounts: () => [
          {
            id: "transaction-account",
            name: "Transactions",
            accountType: "SECURITIES",
            group: null,
            currency: "CAD",
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
        checkExistingDuplicates: () => ({}),
        bulkMutateActivities: (request) => {
          bulkRequests.push(request);
          return {
            created: [{ id: "created-activity" }],
            updated: [],
            deleted: [],
            createdMappings: [],
            errors: [],
          };
        },
      },
    });

    try {
      await expect(service.syncBrokerActivities()).resolves.toMatchObject({
        accountsSynced: 1,
        accountsFailed: 0,
        activitiesUpserted: 1,
      });
      expect(bulkRequests[0]?.creates as Array<Record<string, unknown>> | undefined).toEqual([
        expect.objectContaining({
          activityType: "UNKNOWN",
          status: "DRAFT",
          needsReview: true,
          currency: "CAD",
          sourceRecordId: "unknown-activity-1",
          idempotencyKey: "broker:SNAPTRADE:transaction-account:unknown-activity-1",
        }),
      ]);
    } finally {
      db.close();
    }
  });

  test("defaults missing broker activity types to unknown review drafts", async () => {
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
    const bulkRequests: Record<string, unknown>[] = [];
    const service = createLocalConnectService({
      db,
      secretService,
      fetch: async (input) => {
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        return Response.json({
          data: [
            {
              id: "missing-type-activity-1",
              trade_date: "2026-01-05T10:00:00Z",
              amount: 42,
              currency: { code: "USD" },
              provider_type: "SNAPTRADE",
            },
          ],
        });
      },
      accountService: {
        getAllAccounts: () => [
          {
            id: "transaction-account",
            name: "Transactions",
            accountType: "SECURITIES",
            group: null,
            currency: "CAD",
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
        checkExistingDuplicates: () => ({}),
        bulkMutateActivities: (request) => {
          bulkRequests.push(request);
          return {
            created: [{ id: "created-activity" }],
            updated: [],
            deleted: [],
            createdMappings: [],
            errors: [],
          };
        },
      },
    });

    try {
      await expect(service.syncBrokerActivities()).resolves.toMatchObject({
        accountsSynced: 1,
        accountsFailed: 0,
        activitiesUpserted: 1,
      });
      expect(bulkRequests[0]?.creates as Array<Record<string, unknown>> | undefined).toEqual([
        expect.objectContaining({
          activityType: "UNKNOWN",
          status: "DRAFT",
          needsReview: true,
          currency: "USD",
          sourceRecordId: "missing-type-activity-1",
          idempotencyKey: "broker:SNAPTRADE:transaction-account:missing-type-activity-1",
        }),
      ]);
    } finally {
      db.close();
    }
  });

  test("syncs asset-backed broker activities when the symbol matches an existing asset", async () => {
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
      CREATE TABLE assets (
        id TEXT PRIMARY KEY NOT NULL,
        display_code TEXT,
        instrument_symbol TEXT,
        instrument_exchange_mic TEXT
      );
      INSERT INTO assets (id, display_code, instrument_symbol, instrument_exchange_mic) VALUES
        ('asset-aapl-us', 'AAPL', 'AAPL', 'XNYS'),
        ('asset-aapl', 'AAPL', 'AAPL', 'XNAS');
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    const bulkRequests: Record<string, unknown>[] = [];
    const service = createLocalConnectService({
      db,
      secretService,
      fetch: async (input) => {
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        return Response.json({
          data: [
            {
              id: "buy-activity-1",
              activity_type: "BUY",
              trade_date: "2026-01-05T10:00:00Z",
              units: 2,
              price: 150,
              amount: 300,
              currency: { code: "USD" },
              raw_type: "BUY_STOCK",
              source_system: "SNAPTRADE",
              source_record_id: "source-buy-activity-1",
              source_group_id: "group-1",
              external_reference_id: "external-buy-activity-1",
              institution: "Example Brokerage",
              provider_type: "SNAPTRADE",
              mapping_metadata: {
                confidence: 0.9,
                reasons: ["Matched by symbol"],
                flow: { is_external: true },
              },
              symbol: {
                id: "broker-symbol-aapl",
                symbol: "AAPL",
                raw_symbol: "AAPL",
                figi_code: "BBG000B9XRY4",
                exchange: { mic_code: "XNAS" },
                type: { code: "EQUITY" },
                currency: { code: "USD" },
              },
            },
          ],
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
        checkExistingDuplicates: () => ({}),
        bulkMutateActivities: (request) => {
          bulkRequests.push(request);
          return {
            created: [{ id: "created-activity" }],
            updated: [],
            deleted: [],
            createdMappings: [],
            errors: [],
          };
        },
      },
    });

    try {
      await expect(service.syncBrokerActivities()).resolves.toMatchObject({
        accountsSynced: 1,
        accountsFailed: 0,
        activitiesUpserted: 1,
      });
      expect(bulkRequests[0]?.creates as Array<Record<string, unknown>> | undefined).toEqual([
        expect.objectContaining({
          activityType: "BUY",
          asset: { id: "asset-aapl", symbol: "AAPL" },
          quantity: "2",
          unitPrice: "150",
          amount: "300",
          sourceRecordId: "source-buy-activity-1",
          sourceGroupId: "group-1",
          idempotencyKey: "broker:SNAPTRADE:transaction-account:source-buy-activity-1",
          metadata: expect.objectContaining({
            raw_type: "BUY_STOCK",
            source_system: "SNAPTRADE",
            provider_type: "SNAPTRADE",
            source_record_id: "source-buy-activity-1",
            source_group_id: "group-1",
            external_reference_id: "external-buy-activity-1",
            institution: "Example Brokerage",
            confidence: 0.9,
            mapping_reasons: ["Matched by symbol"],
            flow: { is_external: true },
            symbol: {
              id: "broker-symbol-aapl",
              symbol: "AAPL",
              raw_symbol: "AAPL",
              figi_code: "BBG000B9XRY4",
              exchange_mic: "XNAS",
              symbol_type_code: "EQUITY",
              currency_code: "USD",
            },
          }),
        }),
      ]);
    } finally {
      db.close();
    }
  });

  test("syncs dividend broker activities when the symbol matches an existing asset", async () => {
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
      CREATE TABLE assets (
        id TEXT PRIMARY KEY NOT NULL,
        display_code TEXT,
        instrument_symbol TEXT
      );
      INSERT INTO assets (id, display_code, instrument_symbol) VALUES ('asset-aapl', 'AAPL', 'AAPL');
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    const bulkRequests: Record<string, unknown>[] = [];
    const service = createLocalConnectService({
      db,
      secretService,
      fetch: async (input) => {
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        return Response.json({
          data: [
            {
              id: "dividend-activity-1",
              type: "DIVIDEND",
              trade_date: "2026-01-05T10:00:00Z",
              amount: 12.34,
              currency: { code: "USD" },
              provider_type: "SNAPTRADE",
              symbol: { symbol: "AAPL", raw_symbol: "AAPL" },
            },
          ],
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
        checkExistingDuplicates: () => ({}),
        bulkMutateActivities: (request) => {
          bulkRequests.push(request);
          return {
            created: [{ id: "created-dividend" }],
            updated: [],
            deleted: [],
            createdMappings: [],
            errors: [],
          };
        },
      },
    });

    try {
      await expect(service.syncBrokerActivities()).resolves.toMatchObject({
        accountsSynced: 1,
        accountsFailed: 0,
        activitiesUpserted: 1,
      });
      expect(bulkRequests[0]?.creates as Array<Record<string, unknown>> | undefined).toEqual([
        expect.objectContaining({
          activityType: "DIVIDEND",
          asset: { id: "asset-aapl", symbol: "AAPL" },
          amount: "12.34",
          idempotencyKey: "broker:SNAPTRADE:transaction-account:dividend-activity-1",
        }),
      ]);
    } finally {
      db.close();
    }
  });

  test("syncs security transfer broker activities when the symbol matches an existing asset", async () => {
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
      CREATE TABLE assets (
        id TEXT PRIMARY KEY NOT NULL,
        display_code TEXT,
        instrument_symbol TEXT
      );
      INSERT INTO assets (id, display_code, instrument_symbol) VALUES ('asset-aapl', 'AAPL', 'AAPL');
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    const bulkRequests: Record<string, unknown>[] = [];
    const service = createLocalConnectService({
      db,
      secretService,
      fetch: async (input) => {
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        return Response.json({
          data: [
            {
              id: "transfer-activity-1",
              type: "TRANSFER_IN",
              trade_date: "2026-01-05T10:00:00Z",
              units: 3,
              price: 150,
              amount: 450,
              currency: { code: "USD" },
              provider_type: "SNAPTRADE",
              symbol: { symbol: "AAPL", raw_symbol: "AAPL" },
            },
          ],
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
        checkExistingDuplicates: () => ({}),
        bulkMutateActivities: (request) => {
          bulkRequests.push(request);
          return {
            created: [{ id: "created-transfer" }],
            updated: [],
            deleted: [],
            createdMappings: [],
            errors: [],
          };
        },
      },
    });

    try {
      await expect(service.syncBrokerActivities()).resolves.toMatchObject({
        accountsSynced: 1,
        accountsFailed: 0,
        activitiesUpserted: 1,
      });
      expect(bulkRequests[0]?.creates as Array<Record<string, unknown>> | undefined).toEqual([
        expect.objectContaining({
          activityType: "TRANSFER_IN",
          asset: { id: "asset-aapl", symbol: "AAPL" },
          quantity: "3",
          unitPrice: "150",
          amount: "450",
          idempotencyKey: "broker:SNAPTRADE:transaction-account:transfer-activity-1",
        }),
      ]);
    } finally {
      db.close();
    }
  });

  test("syncs asset-backed interest broker activities when the symbol matches an existing asset", async () => {
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
      CREATE TABLE assets (
        id TEXT PRIMARY KEY NOT NULL,
        display_code TEXT,
        instrument_symbol TEXT
      );
      INSERT INTO assets (id, display_code, instrument_symbol) VALUES ('asset-btc', 'BTC', 'BTC');
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    const bulkRequests: Record<string, unknown>[] = [];
    const service = createLocalConnectService({
      db,
      secretService,
      fetch: async (input) => {
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        return Response.json({
          data: [
            {
              id: "interest-activity-1",
              type: "INTEREST",
              trade_date: "2026-01-05T10:00:00Z",
              amount: 0.01,
              currency: { code: "BTC" },
              provider_type: "SNAPTRADE",
              symbol: { raw_symbol: "   ", symbol: "BTC-USD", type: { code: "CRYPTOCURRENCY" } },
            },
          ],
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
        checkExistingDuplicates: () => ({}),
        bulkMutateActivities: (request) => {
          bulkRequests.push(request);
          return {
            created: [{ id: "created-interest" }],
            updated: [],
            deleted: [],
            createdMappings: [],
            errors: [],
          };
        },
      },
    });

    try {
      await expect(service.syncBrokerActivities()).resolves.toMatchObject({
        accountsSynced: 1,
        accountsFailed: 0,
        activitiesUpserted: 1,
      });
      expect(bulkRequests[0]?.creates as Array<Record<string, unknown>> | undefined).toEqual([
        expect.objectContaining({
          activityType: "INTEREST",
          asset: { id: "asset-btc", symbol: "BTC" },
          amount: "0.01",
          currency: "BTC",
          idempotencyKey: "broker:SNAPTRADE:transaction-account:interest-activity-1",
        }),
      ]);
    } finally {
      db.close();
    }
  });

  test("keeps asset-backed interest when raw symbol is blank but display symbol is present", async () => {
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
      CREATE TABLE assets (
        id TEXT PRIMARY KEY NOT NULL,
        display_code TEXT,
        instrument_symbol TEXT
      );
      INSERT INTO assets (id, display_code, instrument_symbol) VALUES ('asset-btc', 'BTC', 'BTC');
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    const bulkRequests: Record<string, unknown>[] = [];
    const service = createLocalConnectService({
      db,
      secretService,
      fetch: async (input) => {
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        return Response.json({
          data: [
            {
              id: "interest-blank-raw-activity-1",
              type: "INTEREST",
              trade_date: "2026-01-05T10:00:00Z",
              amount: 0.01,
              currency: { code: "BTC" },
              provider_type: "SNAPTRADE",
              symbol: { raw_symbol: "", symbol: "BTC-USD", type: { code: "CRYPTOCURRENCY" } },
            },
          ],
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
        checkExistingDuplicates: () => ({}),
        bulkMutateActivities: (request) => {
          bulkRequests.push(request);
          return {
            created: [{ id: "created-interest" }],
            updated: [],
            deleted: [],
            createdMappings: [],
            errors: [],
          };
        },
      },
    });

    try {
      await expect(service.syncBrokerActivities()).resolves.toMatchObject({
        accountsSynced: 1,
        accountsFailed: 0,
        activitiesUpserted: 1,
      });
      expect(bulkRequests[0]?.creates as Array<Record<string, unknown>> | undefined).toEqual([
        expect.objectContaining({
          activityType: "INTEREST",
          asset: { id: "asset-btc", symbol: "BTC" },
          amount: "0.01",
          currency: "BTC",
          idempotencyKey: "broker:SNAPTRADE:transaction-account:interest-blank-raw-activity-1",
        }),
      ]);
    } finally {
      db.close();
    }
  });

  test("syncs symbol-less dividend broker activities as cash income", async () => {
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
    const bulkRequests: Record<string, unknown>[] = [];
    const service = createLocalConnectService({
      db,
      secretService,
      fetch: async (input) => {
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        return Response.json({
          data: [
            {
              id: "cash-dividend-activity-1",
              type: "DIVIDEND",
              trade_date: "2026-01-05T10:00:00Z",
              amount: 12.34,
              currency: { code: "USD" },
              provider_type: "SNAPTRADE",
            },
          ],
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
        checkExistingDuplicates: () => ({}),
        bulkMutateActivities: (request) => {
          bulkRequests.push(request);
          return {
            created: [{ id: "created-cash-dividend" }],
            updated: [],
            deleted: [],
            createdMappings: [],
            errors: [],
          };
        },
      },
    });

    try {
      await expect(service.syncBrokerActivities()).resolves.toMatchObject({
        accountsSynced: 1,
        accountsFailed: 0,
        activitiesUpserted: 1,
      });
      expect(bulkRequests[0]?.creates as Array<Record<string, unknown>> | undefined).toEqual([
        expect.objectContaining({
          activityType: "DIVIDEND",
          amount: "12.34",
          allowMissingAsset: true,
          sourceRecordId: "cash-dividend-activity-1",
        }),
      ]);
      expect((bulkRequests[0]?.creates as Array<Record<string, unknown>>)[0]).not.toHaveProperty(
        "asset",
      );
    } finally {
      db.close();
    }
  });

  test("syncs adjustment broker activities with optional asset identity", async () => {
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
      CREATE TABLE assets (
        id TEXT PRIMARY KEY NOT NULL,
        display_code TEXT,
        instrument_symbol TEXT
      );
      INSERT INTO assets (id, display_code, instrument_symbol) VALUES ('asset-aapl', 'AAPL', 'AAPL');
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    const bulkRequests: Record<string, unknown>[] = [];
    const service = createLocalConnectService({
      db,
      secretService,
      fetch: async (input) => {
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        return Response.json({
          data: [
            {
              id: "cash-adjustment-activity-1",
              type: "ADJUSTMENT",
              trade_date: "2026-01-05T10:00:00Z",
              amount: 12.34,
              currency: { code: "USD" },
              provider_type: "SNAPTRADE",
            },
            {
              id: "asset-adjustment-activity-1",
              type: "ADJUSTMENT",
              trade_date: "2026-01-05T11:00:00Z",
              amount: 1.5,
              currency: { code: "USD" },
              provider_type: "SNAPTRADE",
              symbol: { symbol: "AAPL", raw_symbol: "AAPL" },
            },
          ],
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
        checkExistingDuplicates: () => ({}),
        bulkMutateActivities: (request) => {
          bulkRequests.push(request);
          return {
            created: [{ id: "created-cash-adjustment" }, { id: "created-asset-adjustment" }],
            updated: [],
            deleted: [],
            createdMappings: [],
            errors: [],
          };
        },
      },
    });

    try {
      await expect(service.syncBrokerActivities()).resolves.toMatchObject({
        accountsSynced: 1,
        accountsFailed: 0,
        activitiesUpserted: 2,
      });
      expect(bulkRequests[0]?.creates as Array<Record<string, unknown>> | undefined).toEqual([
        expect.objectContaining({
          activityType: "ADJUSTMENT",
          amount: "12.34",
          allowMissingAsset: true,
          sourceRecordId: "cash-adjustment-activity-1",
        }),
        expect.objectContaining({
          activityType: "ADJUSTMENT",
          asset: { id: "asset-aapl", symbol: "AAPL" },
          amount: "1.5",
          idempotencyKey: "broker:SNAPTRADE:transaction-account:asset-adjustment-activity-1",
        }),
      ]);
      expect((bulkRequests[0]?.creates as Array<Record<string, unknown>>)[0]).not.toHaveProperty(
        "asset",
      );
    } finally {
      db.close();
    }
  });

  test("matches existing broker assets after Yahoo suffix normalization", async () => {
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
      CREATE TABLE assets (
        id TEXT PRIMARY KEY NOT NULL,
        display_code TEXT,
        instrument_symbol TEXT,
        instrument_exchange_mic TEXT
      );
      INSERT INTO assets (id, display_code, instrument_symbol, instrument_exchange_mic) VALUES
        ('asset-shop-us', 'SHOP', 'SHOP', 'XNYS'),
        ('asset-shop', 'SHOP', 'SHOP', 'XTSE');
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    const bulkRequests: Record<string, unknown>[] = [];
    const service = createLocalConnectService({
      db,
      secretService,
      exchangeMetadata: { yahooSuffixToMic: new Map([["TO", "XTSE"]]) },
      fetch: async (input) => {
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        return Response.json({
          data: [
            {
              id: "buy-activity-1",
              type: "BUY",
              trade_date: "2026-01-05T10:00:00Z",
              units: 2,
              price: 75,
              amount: 150,
              currency: { code: "CAD" },
              provider_type: "SNAPTRADE",
              symbol: { symbol: "SHOP.TO", raw_symbol: "   " },
            },
          ],
        });
      },
      accountService: {
        getAllAccounts: () => [
          {
            id: "transaction-account",
            name: "Transactions",
            accountType: "SECURITIES",
            group: null,
            currency: "CAD",
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
        checkExistingDuplicates: () => ({}),
        bulkMutateActivities: (request) => {
          bulkRequests.push(request);
          return {
            created: [{ id: "created-activity" }],
            updated: [],
            deleted: [],
            createdMappings: [],
            errors: [],
          };
        },
      },
    });

    try {
      await expect(service.syncBrokerActivities()).resolves.toMatchObject({
        accountsSynced: 1,
        accountsFailed: 0,
        activitiesUpserted: 1,
      });
      expect(bulkRequests[0]?.creates as Array<Record<string, unknown>> | undefined).toEqual([
        expect.objectContaining({
          activityType: "BUY",
          asset: { id: "asset-shop", symbol: "SHOP" },
          currency: "CAD",
          idempotencyKey: "broker:SNAPTRADE:transaction-account:buy-activity-1",
        }),
      ]);
    } finally {
      db.close();
    }
  });

  test("keeps suffixed broker symbols gated when only another exchange is local", async () => {
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
      CREATE TABLE assets (
        id TEXT PRIMARY KEY NOT NULL,
        display_code TEXT,
        instrument_symbol TEXT,
        instrument_exchange_mic TEXT
      );
      INSERT INTO assets (id, display_code, instrument_symbol, instrument_exchange_mic)
      VALUES ('asset-shop-us', 'SHOP', 'SHOP', 'XNYS');
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    const service = createLocalConnectService({
      db,
      secretService,
      exchangeMetadata: { yahooSuffixToMic: new Map([["TO", "XTSE"]]) },
      fetch: async (input) => {
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        return Response.json({
          data: [
            {
              id: "buy-activity-1",
              type: "BUY",
              trade_date: "2026-01-05T10:00:00Z",
              units: 2,
              price: 75,
              amount: 150,
              currency: { code: "CAD" },
              provider_type: "SNAPTRADE",
              symbol: { symbol: "SHOP.TO" },
            },
          ],
        });
      },
      accountService: {
        getAllAccounts: () => [
          {
            id: "transaction-account",
            name: "Transactions",
            accountType: "SECURITIES",
            group: null,
            currency: "CAD",
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
        checkExistingDuplicates: () => ({}),
        bulkMutateActivities: () => {
          throw new Error("should not attach broker activity to a different exchange");
        },
      },
    });

    try {
      await expect(service.syncBrokerActivities()).rejects.toMatchObject({
        code: "not_implemented",
        status: 501,
      });
    } finally {
      db.close();
    }
  });

  test("matches existing crypto broker assets by base symbol", async () => {
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
      CREATE TABLE assets (
        id TEXT PRIMARY KEY NOT NULL,
        display_code TEXT,
        instrument_symbol TEXT
      );
      INSERT INTO assets (id, display_code, instrument_symbol) VALUES
        ('asset-btc', 'BTC', 'BTC'),
        ('asset-x', 'X', 'X'),
        ('asset-x-ai', 'X-AI', 'X-AI');
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    const bulkRequests: Record<string, unknown>[] = [];
    const service = createLocalConnectService({
      db,
      secretService,
      fetch: async (input) => {
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        return Response.json({
          data: [
            {
              id: "crypto-buy-blank-raw-activity-1",
              type: "BUY",
              trade_date: "2026-01-05T10:00:00Z",
              units: 0.1,
              price: 100000,
              amount: 10000,
              currency: { code: "USD" },
              provider_type: "SNAPTRADE",
              symbol: { symbol: "BTC-USD", raw_symbol: "", type: { code: "CRYPTOCURRENCY" } },
            },
            {
              id: "crypto-buy-raw-pair-activity-1",
              type: "BUY",
              trade_date: "2026-01-05T11:00:00Z",
              units: 1,
              price: 10,
              amount: 10,
              currency: { code: "USD" },
              provider_type: "SNAPTRADE",
              symbol: {
                symbol: "WRONG-USD",
                raw_symbol: "X-AI-USD",
                type: { code: "CRYPTOCURRENCY" },
              },
            },
          ],
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
        checkExistingDuplicates: () => ({}),
        bulkMutateActivities: (request) => {
          bulkRequests.push(request);
          return {
            created: [{ id: "created-btc" }, { id: "created-x-ai" }],
            updated: [],
            deleted: [],
            createdMappings: [],
            errors: [],
          };
        },
      },
    });

    try {
      await expect(service.syncBrokerActivities()).resolves.toMatchObject({
        accountsSynced: 1,
        accountsFailed: 0,
        activitiesUpserted: 2,
      });
      expect(bulkRequests[0]?.creates as Array<Record<string, unknown>> | undefined).toEqual([
        expect.objectContaining({
          activityType: "BUY",
          asset: { id: "asset-btc", symbol: "BTC" },
          quantity: "0.1",
          unitPrice: "100000",
        }),
        expect.objectContaining({
          activityType: "BUY",
          asset: { id: "asset-x-ai", symbol: "X-AI" },
          quantity: "1",
          unitPrice: "10",
        }),
      ]);
    } finally {
      db.close();
    }
  });

  test("treats blank broker symbols on transfers as cash activities", async () => {
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
    const bulkRequests: Record<string, unknown>[] = [];
    const service = createLocalConnectService({
      db,
      secretService,
      fetch: async (input) => {
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        return Response.json({
          data: [
            {
              id: "cash-transfer-blank-symbol-1",
              type: "TRANSFER_IN",
              trade_date: "2026-01-05T10:00:00Z",
              amount: 100,
              currency: { code: "USD" },
              provider_type: "SNAPTRADE",
              symbol: { raw_symbol: "   ", symbol: "   " },
              option_symbol: { ticker: "" },
            },
          ],
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
        checkExistingDuplicates: () => ({}),
        bulkMutateActivities: (request) => {
          bulkRequests.push(request);
          return {
            created: [{ id: "created-cash-transfer" }],
            updated: [],
            deleted: [],
            createdMappings: [],
            errors: [],
          };
        },
      },
    });

    try {
      await expect(service.syncBrokerActivities()).resolves.toMatchObject({
        accountsSynced: 1,
        accountsFailed: 0,
        activitiesUpserted: 1,
      });
      expect(bulkRequests[0]?.creates as Array<Record<string, unknown>> | undefined).toEqual([
        expect.objectContaining({
          activityType: "TRANSFER_IN",
          amount: "100",
          allowMissingAsset: true,
          sourceRecordId: "cash-transfer-blank-symbol-1",
        }),
      ]);
      expect((bulkRequests[0]?.creates as Array<Record<string, unknown>>)[0]).not.toHaveProperty(
        "asset",
      );
    } finally {
      db.close();
    }
  });

  test("keeps asset-backed broker activities feature-gated when the symbol is not local", async () => {
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
      CREATE TABLE assets (
        id TEXT PRIMARY KEY NOT NULL,
        display_code TEXT,
        instrument_symbol TEXT
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
        return Response.json({
          data: [
            {
              id: "buy-activity-1",
              activity_type: "BUY",
              trade_date: "2026-01-05T10:00:00Z",
              units: 2,
              price: 150,
              amount: 300,
              currency: { code: "USD" },
              provider_type: "SNAPTRADE",
              symbol: { symbol: "AAPL", raw_symbol: "AAPL" },
            },
          ],
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
        checkExistingDuplicates: () => ({}),
        bulkMutateActivities: () => {
          throw new Error("should not import unknown broker symbols yet");
        },
      },
    });

    try {
      await expect(service.syncBrokerActivities()).rejects.toMatchObject({
        code: "not_implemented",
        status: 501,
      });
    } finally {
      db.close();
    }
  });

  test("syncs provider-resolved broker activities as new activity-created assets", async () => {
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
      CREATE TABLE assets (
        id TEXT PRIMARY KEY NOT NULL,
        display_code TEXT,
        instrument_symbol TEXT,
        instrument_exchange_mic TEXT
      );
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    const bulkRequests: Record<string, unknown>[] = [];
    const symbolSearchCalls: string[] = [];
    const service = createLocalConnectService({
      db,
      secretService,
      fetch: async (input) => {
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        return Response.json({
          data: [
            {
              id: "buy-activity-1",
              activity_type: "BUY",
              trade_date: "2026-01-05T10:00:00Z",
              units: 2,
              price: 150,
              amount: 300,
              currency: { code: "USD" },
              provider_type: "SNAPTRADE",
              symbol: { symbol: "AAPL", raw_symbol: "AAPL" },
            },
            {
              id: "buy-activity-2",
              activity_type: "BUY",
              trade_date: "2026-01-06T10:00:00Z",
              units: 1,
              price: 151,
              amount: 151,
              currency: { code: "USD" },
              provider_type: "SNAPTRADE",
              symbol: { symbol: "AAPL", raw_symbol: "AAPL" },
            },
          ],
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
      symbolSearch: (query) => {
        symbolSearchCalls.push(query);
        return query === "AAPL"
          ? [
              {
                symbol: "MSFT",
                shortName: "Microsoft Corporation",
                longName: "Microsoft Corporation",
                exchange: "NMS",
                exchangeMic: "XNAS",
                exchangeName: "NASDAQ",
                quoteType: "EQUITY",
                typeDisplay: "Equity",
                currency: "USD",
                dataSource: "YAHOO",
                isExisting: false,
                existingAssetId: null,
                index: "",
                score: 100,
              },
              {
                symbol: "AAPL",
                shortName: "Apple Inc.",
                longName: "Apple Inc.",
                exchange: "NMS",
                exchangeMic: "XNAS",
                exchangeName: "NASDAQ",
                quoteType: "EQUITY",
                typeDisplay: "Equity",
                currency: "USD",
                dataSource: "YAHOO",
                isExisting: false,
                existingAssetId: null,
                index: "",
                score: 99,
              },
            ]
          : [];
      },
      activityService: {
        getBrokerSyncProfile: () => null,
        saveBrokerSyncProfileRules: (request) => request,
        checkExistingDuplicates: () => ({}),
        bulkMutateActivities: (request) => {
          bulkRequests.push(request);
          const result = {
            created: [{ id: "created-activity-1" }, { id: "created-activity-2" }],
            updated: [],
            deleted: [],
            createdMappings: [],
            errors: [],
          };
          Object.defineProperty(result, ACTIVITY_BULK_CREATED_ASSET_IDS, {
            value: ["asset-aapl"],
            enumerable: false,
          });
          return result;
        },
      },
    });

    try {
      await expect(service.syncBrokerActivities()).resolves.toMatchObject({
        accountsSynced: 1,
        accountsFailed: 0,
        activitiesUpserted: 2,
        assetsInserted: 1,
        newAssetIds: ["asset-aapl"],
      });
      expect(symbolSearchCalls).toEqual(["AAPL"]);
      expect(bulkRequests[0]?.creates as Array<Record<string, unknown>> | undefined).toEqual([
        expect.objectContaining({
          accountId: "transaction-account",
          activityType: "BUY",
          quantity: "2",
          unitPrice: "150",
          amount: "300",
          currency: "USD",
          asset: {
            symbol: "AAPL",
            exchangeMic: "XNAS",
            instrumentType: "EQUITY",
            quoteCcy: "USD",
            quoteMode: "MARKET",
            name: "Apple Inc.",
          },
        }),
        expect.objectContaining({
          accountId: "transaction-account",
          activityType: "BUY",
          quantity: "1",
          unitPrice: "151",
          amount: "151",
          currency: "USD",
          asset: expect.objectContaining({
            symbol: "AAPL",
            exchangeMic: "XNAS",
          }),
        }),
      ]);
    } finally {
      db.close();
    }
  });

  test("provider-resolves suffixed broker raw symbols by normalized symbol and MIC", async () => {
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
      CREATE TABLE assets (
        id TEXT PRIMARY KEY NOT NULL,
        display_code TEXT,
        instrument_symbol TEXT,
        instrument_exchange_mic TEXT
      );
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    const bulkRequests: Record<string, unknown>[] = [];
    const service = createLocalConnectService({
      db,
      secretService,
      exchangeMetadata: { yahooSuffixToMic: new Map([["TO", "XTSE"]]) },
      fetch: async (input) => {
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        return Response.json({
          data: [
            {
              id: "buy-shop-tsx",
              activity_type: "BUY",
              trade_date: "2026-01-05T10:00:00Z",
              units: 2,
              price: 95,
              amount: 190,
              currency: { code: "CAD" },
              provider_type: "SNAPTRADE",
              symbol: {
                symbol: "SHOP",
                raw_symbol: "SHOP.TO",
                exchange: { mic_code: "XTSE" },
              },
            },
          ],
        });
      },
      accountService: {
        getAllAccounts: () => [
          {
            id: "transaction-account",
            name: "Transactions",
            accountType: "SECURITIES",
            group: null,
            currency: "CAD",
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
      symbolSearch: (query) =>
        query === "SHOP.TO"
          ? [
              {
                symbol: "SHOP.TO",
                shortName: "Shopify Inc.",
                longName: "Shopify Inc.",
                exchange: "TOR",
                exchangeMic: "XTSE",
                exchangeName: "TSX",
                quoteType: "EQUITY",
                typeDisplay: "Equity",
                currency: "CAD",
                dataSource: "YAHOO",
                isExisting: false,
                existingAssetId: null,
                index: "",
                score: 100,
              },
            ]
          : [],
      activityService: {
        getBrokerSyncProfile: () => null,
        saveBrokerSyncProfileRules: (request) => request,
        checkExistingDuplicates: () => ({}),
        bulkMutateActivities: (request) => {
          bulkRequests.push(request);
          return {
            created: [{ id: "created-activity" }],
            updated: [],
            deleted: [],
            createdMappings: [],
            errors: [],
          };
        },
      },
    });

    try {
      await expect(service.syncBrokerActivities()).resolves.toMatchObject({
        accountsSynced: 1,
        accountsFailed: 0,
        activitiesUpserted: 1,
      });
      expect(bulkRequests[0]?.creates as Array<Record<string, unknown>> | undefined).toEqual([
        expect.objectContaining({
          asset: {
            symbol: "SHOP.TO",
            exchangeMic: "XTSE",
            instrumentType: "EQUITY",
            quoteCcy: "CAD",
            quoteMode: "MARKET",
            name: "Shopify Inc.",
          },
        }),
      ]);
    } finally {
      db.close();
    }
  });

  test("provider-resolves crypto broker pairs by base symbol", async () => {
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
      CREATE TABLE assets (
        id TEXT PRIMARY KEY NOT NULL,
        display_code TEXT,
        instrument_symbol TEXT,
        instrument_exchange_mic TEXT
      );
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    const bulkRequests: Record<string, unknown>[] = [];
    const service = createLocalConnectService({
      db,
      secretService,
      fetch: async (input) => {
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        return Response.json({
          data: [
            {
              id: "buy-btc",
              activity_type: "BUY",
              trade_date: "2026-01-05T10:00:00Z",
              units: 0.5,
              price: 90000,
              amount: 45000,
              currency: { code: "USD" },
              provider_type: "SNAPTRADE",
              symbol: {
                symbol: "BTC-USD",
                raw_symbol: "BTC-USD",
                type: { code: "CRYPTOCURRENCY" },
              },
            },
          ],
        });
      },
      accountService: {
        getAllAccounts: () => [
          {
            id: "transaction-account",
            name: "Transactions",
            accountType: "CRYPTO",
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
      symbolSearch: (query) =>
        query === "BTC"
          ? [
              {
                symbol: "BTC-USD",
                shortName: "Bitcoin USD",
                longName: "Bitcoin USD",
                exchange: "CCC",
                exchangeMic: null,
                exchangeName: null,
                quoteType: "CRYPTOCURRENCY",
                typeDisplay: "Crypto",
                currency: "USD",
                dataSource: "YAHOO",
                isExisting: false,
                existingAssetId: null,
                index: "",
                score: 100,
              },
            ]
          : [],
      activityService: {
        getBrokerSyncProfile: () => null,
        saveBrokerSyncProfileRules: (request) => request,
        checkExistingDuplicates: () => ({}),
        bulkMutateActivities: (request) => {
          bulkRequests.push(request);
          return {
            created: [{ id: "created-activity" }],
            updated: [],
            deleted: [],
            createdMappings: [],
            errors: [],
          };
        },
      },
    });

    try {
      await expect(service.syncBrokerActivities()).resolves.toMatchObject({
        accountsSynced: 1,
        accountsFailed: 0,
        activitiesUpserted: 1,
      });
      expect(bulkRequests[0]?.creates as Array<Record<string, unknown>> | undefined).toEqual([
        expect.objectContaining({
          asset: {
            symbol: "BTC-USD",
            exchangeMic: undefined,
            instrumentType: "CRYPTO",
            quoteCcy: "USD",
            quoteMode: "MARKET",
            name: "Bitcoin USD",
          },
        }),
      ]);
    } finally {
      db.close();
    }
  });

  test("uses provider search existingAssetId for suffixed broker symbols", async () => {
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
      CREATE TABLE assets (
        id TEXT PRIMARY KEY NOT NULL,
        display_code TEXT,
        instrument_symbol TEXT,
        instrument_exchange_mic TEXT
      );
      INSERT INTO assets (id, display_code, instrument_symbol, instrument_exchange_mic)
      VALUES ('asset-shop', 'SHOP', 'SHOP', 'XTSE');
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    const bulkRequests: Record<string, unknown>[] = [];
    const service = createLocalConnectService({
      db,
      secretService,
      exchangeMetadata: { yahooSuffixToMic: new Map([["TO", "XTSE"]]) },
      fetch: async (input) => {
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        return Response.json({
          data: [
            {
              id: "buy-shop-existing",
              activity_type: "BUY",
              trade_date: "2026-01-05T10:00:00Z",
              units: 2,
              price: 95,
              amount: 190,
              currency: { code: "CAD" },
              provider_type: "SNAPTRADE",
              symbol: {
                symbol: "SHOP",
                raw_symbol: "SHOP.TO",
                exchange: { mic_code: "XTSE" },
              },
            },
          ],
        });
      },
      accountService: {
        getAllAccounts: () => [
          {
            id: "transaction-account",
            name: "Transactions",
            accountType: "SECURITIES",
            group: null,
            currency: "CAD",
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
      symbolSearch: (query) =>
        query === "SHOP.TO"
          ? [
              {
                symbol: "SHOP.TO",
                shortName: "Shopify Inc.",
                longName: "Shopify Inc.",
                exchange: "TOR",
                exchangeMic: "XTSE",
                exchangeName: "TSX",
                quoteType: "EQUITY",
                typeDisplay: "Equity",
                currency: "CAD",
                dataSource: "YAHOO",
                isExisting: true,
                existingAssetId: "asset-shop",
                index: "",
                score: 100,
              },
            ]
          : [],
      activityService: {
        getBrokerSyncProfile: () => null,
        saveBrokerSyncProfileRules: (request) => request,
        checkExistingDuplicates: () => ({}),
        bulkMutateActivities: (request) => {
          bulkRequests.push(request);
          return {
            created: [{ id: "created-activity" }],
            updated: [],
            deleted: [],
            createdMappings: [],
            errors: [],
          };
        },
      },
    });

    try {
      await expect(service.syncBrokerActivities()).resolves.toMatchObject({
        accountsSynced: 1,
        accountsFailed: 0,
        activitiesUpserted: 1,
        assetsInserted: 0,
        newAssetIds: [],
      });
      expect(bulkRequests[0]?.creates as Array<Record<string, unknown>> | undefined).toEqual([
        expect.objectContaining({
          asset: { id: "asset-shop", symbol: "SHOP.TO" },
        }),
      ]);
    } finally {
      db.close();
    }
  });

  test("syncs symbol-bearing broker activities with missing type as review drafts", async () => {
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
      CREATE TABLE assets (
        id TEXT PRIMARY KEY NOT NULL,
        display_code TEXT,
        instrument_symbol TEXT,
        instrument_exchange_mic TEXT
      );
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    const bulkRequests: Record<string, unknown>[] = [];
    const service = createLocalConnectService({
      db,
      secretService,
      fetch: async (input) => {
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        return Response.json({
          data: [
            {
              id: "missing-type-aapl",
              trade_date: "2026-01-05T10:00:00Z",
              units: 2,
              price: 150,
              amount: 300,
              currency: { code: "USD" },
              provider_type: "SNAPTRADE",
              symbol: { symbol: "AAPL", raw_symbol: "AAPL" },
            },
          ],
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
      symbolSearch: (query) =>
        query === "AAPL"
          ? [
              {
                symbol: "AAPL",
                shortName: "Apple Inc.",
                longName: "Apple Inc.",
                exchange: "NMS",
                exchangeMic: "XNAS",
                exchangeName: "NASDAQ",
                quoteType: "EQUITY",
                typeDisplay: "Equity",
                currency: "USD",
                dataSource: "YAHOO",
                isExisting: false,
                existingAssetId: null,
                index: "",
                score: 100,
              },
            ]
          : [],
      activityService: {
        getBrokerSyncProfile: () => null,
        saveBrokerSyncProfileRules: (request) => request,
        checkExistingDuplicates: () => ({}),
        bulkMutateActivities: (request) => {
          bulkRequests.push(request);
          return {
            created: [{ id: "created-activity" }],
            updated: [],
            deleted: [],
            createdMappings: [],
            errors: [],
          };
        },
      },
    });

    try {
      await expect(service.syncBrokerActivities()).resolves.toMatchObject({
        accountsSynced: 1,
        accountsFailed: 0,
        activitiesUpserted: 1,
      });
      expect(bulkRequests[0]?.creates as Array<Record<string, unknown>> | undefined).toEqual([
        expect.objectContaining({
          activityType: "UNKNOWN",
          status: "DRAFT",
          needsReview: true,
          asset: expect.objectContaining({
            symbol: "AAPL",
            exchangeMic: "XNAS",
          }),
        }),
      ]);
    } finally {
      db.close();
    }
  });

  test("syncs option broker activities when the compact OCC symbol matches an existing asset", async () => {
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
      CREATE TABLE assets (
        id TEXT PRIMARY KEY NOT NULL,
        display_code TEXT,
        instrument_symbol TEXT
      );
      INSERT INTO assets (id, display_code, instrument_symbol)
      VALUES ('option-aapl', 'AAPL261218C00240000', 'AAPL261218C00240000');
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    const bulkRequests: Record<string, unknown>[] = [];
    const service = createLocalConnectService({
      db,
      secretService,
      fetch: async (input) => {
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        return Response.json({
          data: [
            {
              id: "option-activity-1",
              activity_type: "BUY",
              option_type: "BUY_TO_OPEN",
              trade_date: "2026-01-05T10:00:00Z",
              units: 1,
              price: 12.5,
              amount: 1250,
              currency: { code: "USD" },
              provider_type: "SNAPTRADE",
              option_symbol: {
                ticker: "AAPL  261218C00240000",
                option_type: "CALL",
                underlying_symbol: { symbol: "AAPL" },
              },
            },
          ],
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
        checkExistingDuplicates: () => ({}),
        bulkMutateActivities: (request) => {
          bulkRequests.push(request);
          return {
            created: [{ id: "created-option" }],
            updated: [],
            deleted: [],
            createdMappings: [],
            errors: [],
          };
        },
      },
    });

    try {
      await expect(service.syncBrokerActivities()).resolves.toMatchObject({
        accountsSynced: 1,
        accountsFailed: 0,
        activitiesUpserted: 1,
      });
      expect(bulkRequests[0]?.creates as Array<Record<string, unknown>> | undefined).toEqual([
        expect.objectContaining({
          activityType: "BUY",
          subtype: "BUY_TO_OPEN",
          asset: { id: "option-aapl", symbol: "AAPL261218C00240000" },
          quantity: "1",
          unitPrice: "12.5",
          amount: "1250",
          metadata: expect.objectContaining({
            option_leg_type: "BUY_TO_OPEN",
            option_contract_type: "CALL",
            option_ticker: "AAPL  261218C00240000",
            option_underlying_symbol: "AAPL",
          }),
        }),
      ]);
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
        return Response.json({
          universalActivities: [
            { id: "activity-1", symbol: { symbol: "AAPL", raw_symbol: "AAPL" } },
          ],
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

  test("records broker activity failure when pagination is stuck", async () => {
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
        return Response.json({
          data: [{ id: "   ", description: "unmapped" }],
          pagination: { has_more: true },
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
      await expect(service.syncBrokerActivities()).resolves.toMatchObject({
        accountsSynced: 0,
        accountsFailed: 1,
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
        last_error:
          "Pagination appears stuck (same first activity id returned for multiple pages).",
      });
    } finally {
      db.close();
    }
  });

  test("keeps broker activity mapper gate ahead of stuck pagination guard", async () => {
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
        if (String(input).includes("offset=0")) {
          return Response.json({
            data: [{ id: "   ", description: "unmapped" }],
            pagination: { has_more: true },
          });
        }
        return Response.json({
          data: [
            { id: "   ", description: "same first id" },
            {
              id: "activity-1",
              description: "mappable",
              symbol: { symbol: "AAPL", raw_symbol: "AAPL" },
            },
          ],
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
    } finally {
      db.close();
    }
  });

  test("enables FRESH device sync through bootstrap key initialization", async () => {
    const db = createDeviceSyncStateDb();
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    const requests: Array<{ url: string; method: string; body: Record<string, unknown> | null }> =
      [];
    const service = createLocalConnectDeviceSyncService({
      db,
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test" },
      appVersion: "3.4.0",
      reinitializeDelayMs: 0,
      fetch: async (input, init) => {
        const body =
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : null;
        requests.push({ url: String(input), method: init?.method ?? "GET", body });
        const url = String(input);
        if (url.includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        if (url.endsWith("/api/v1/sync/team/devices")) {
          return Response.json({
            mode: "BOOTSTRAP",
            device_id: "device-1",
            e2ee_key_version: 3,
          });
        }
        if (url.endsWith("/api/v1/sync/team/keys/initialize")) {
          return Response.json({
            mode: "BOOTSTRAP",
            challenge: "challenge-1",
            nonce: "nonce-1",
            key_version: 3,
          });
        }
        if (url.endsWith("/api/v1/sync/team/keys/initialize/commit")) {
          return Response.json({ success: true, key_state: "ACTIVE" });
        }
        throw new Error(`unexpected request: ${url}`);
      },
    });

    try {
      await expect(service.enableDeviceSync()).resolves.toEqual({
        deviceId: "device-1",
        state: "READY",
        keyVersion: 3,
        serverKeyVersion: 3,
        needsPairing: false,
        trustedDevices: [],
      });

      const enrollBody = requests.find((request) =>
        request.url.endsWith("/api/v1/sync/team/devices"),
      )?.body;
      expect(enrollBody).toMatchObject({
        display_name: "Wealthfolio Server",
        platform:
          process.platform === "darwin"
            ? "mac"
            : process.platform === "win32"
              ? "windows"
              : process.platform === "linux"
                ? "linux"
                : "web",
        app_version: "3.4.0",
      });
      expect(typeof enrollBody?.device_nonce).toBe("string");

      const commitBody = requests.find((request) =>
        request.url.endsWith("/api/v1/sync/team/keys/initialize/commit"),
      )?.body;
      expect(commitBody).toMatchObject({
        device_id: "device-1",
        key_version: 3,
        challenge_response: "f5d35df7861e15897ad1fe167b9b76a5c6d01afe9d4cb565c2f0166ea49d61b7",
      });
      expect(typeof commitBody?.device_key_envelope).toBe("string");
      expect(typeof commitBody?.signature).toBe("string");
      expect(commitBody).not.toHaveProperty("recovery_envelope");

      const identity = JSON.parse(secretService.entries.get("sync_identity") ?? "{}") as Record<
        string,
        unknown
      >;
      expect(identity).toMatchObject({
        version: 2,
        deviceId: "device-1",
        keyVersion: 3,
      });
      expect(typeof identity.deviceNonce).toBe("string");
      expect(typeof identity.rootKey).toBe("string");
      expect(typeof identity.deviceSecretKey).toBe("string");
      expect(typeof identity.devicePublicKey).toBe("string");
      expect(secretService.entries.get("sync_device_id")).toBe("device-1");
      expect(
        db.query<{ cursor: number }, []>("SELECT cursor FROM sync_cursor WHERE id = 1").get(),
      ).toMatchObject({ cursor: 0 });
      expect(
        db
          .query<
            {
              key_version: number;
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
        key_version: 3,
        trust_state: "trusted",
        min_snapshot_created_at: null,
      });
      expect(
        db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM sync_outbox").get(),
      ).toMatchObject({ count: 0 });
      expect(
        db
          .query<
            { lock_version: number; last_cycle_status: string | null; last_error: string | null },
            []
          >("SELECT lock_version, last_cycle_status, last_error FROM sync_engine_state WHERE id = 1")
          .get(),
      ).toEqual({ lock_version: 0, last_cycle_status: null, last_error: null });
    } finally {
      db.close();
    }
  });

  test("adds a missing legacy device nonce before resuming existing sync", async () => {
    const db = new Database(":memory:");
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    secretService.entries.set(
      "sync_identity",
      JSON.stringify({
        version: 2,
        deviceId: "device-1",
        rootKey: "legacy-root-key",
        keyVersion: 2,
      }),
    );
    const requests: Array<{ url: string; method: string }> = [];
    const service = createLocalConnectDeviceSyncService({
      db,
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test" },
      fetch: async (input, init) => {
        const url = String(input);
        requests.push({ url, method: init?.method ?? "GET" });
        if (url.includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        if (url.endsWith("/api/v1/sync/team/devices/device-1")) {
          return Response.json({
            id: "device-1",
            display_name: "MacBook",
            platform: "mac",
            trust_state: "trusted",
            trusted_key_version: 2,
          });
        }
        throw new Error(`unexpected request: ${url}`);
      },
    });

    try {
      await expect(service.enableDeviceSync()).resolves.toEqual({
        deviceId: "device-1",
        state: "READY",
        keyVersion: 2,
        serverKeyVersion: 2,
        needsPairing: false,
        trustedDevices: [],
      });
      expect(requests.some((request) => request.url.endsWith("/api/v1/sync/team/devices"))).toBe(
        false,
      );
      const identity = JSON.parse(secretService.entries.get("sync_identity") ?? "{}") as Record<
        string,
        unknown
      >;
      expect(typeof identity.deviceNonce).toBe("string");
      expect(identity).toMatchObject({
        deviceId: "device-1",
        rootKey: "legacy-root-key",
        keyVersion: 2,
      });
    } finally {
      db.close();
    }
  });

  test("serializes Connect token restoration during concurrent state and enable calls", async () => {
    const db = createDeviceSyncStateDb();
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    let activeTokenRestores = 0;
    let maxActiveTokenRestores = 0;
    const requests: string[] = [];
    const service = createLocalConnectDeviceSyncService({
      db,
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test" },
      fetch: async (input, init) => {
        const url = String(input);
        requests.push(`${init?.method ?? "GET"} ${url}`);
        if (url.includes("/auth/v1/token")) {
          activeTokenRestores += 1;
          maxActiveTokenRestores = Math.max(maxActiveTokenRestores, activeTokenRestores);
          await new Promise((resolve) => setTimeout(resolve, 0));
          activeTokenRestores -= 1;
          return Response.json({
            access_token: "access-token",
            refresh_token: "rotated-refresh-token",
          });
        }
        if (url.endsWith("/api/v1/sync/team/devices") && init?.method === "POST") {
          return Response.json({
            mode: "BOOTSTRAP",
            device_id: "device-1",
            e2ee_key_version: 2,
          });
        }
        if (url.endsWith("/api/v1/sync/team/keys/initialize")) {
          return Response.json({
            mode: "BOOTSTRAP",
            challenge: "challenge-1",
            nonce: "nonce-1",
            key_version: 2,
          });
        }
        if (url.endsWith("/api/v1/sync/team/keys/initialize/commit")) {
          return Response.json({ success: true, key_state: "ACTIVE" });
        }
        if (url.endsWith("/api/v1/sync/team/devices/device-1")) {
          return Response.json({
            id: "device-1",
            display_name: "MacBook",
            platform: "mac",
            trust_state: "trusted",
            trusted_key_version: 2,
          });
        }
        throw new Error(`unexpected request: ${url}`);
      },
    });

    try {
      await expect(
        Promise.all([service.getDeviceSyncState(), service.enableDeviceSync()]),
      ).resolves.toHaveLength(2);
      expect(maxActiveTokenRestores).toBe(1);
      expect(requests.filter((request) => request.includes("/auth/v1/token"))).toHaveLength(2);
      expect(requests.filter((request) => request.endsWith("/api/v1/sync/team/devices"))).toEqual([
        "POST https://api.example.test/api/v1/sync/team/devices",
      ]);
      expect(secretService.entries.get("sync_refresh_token")).toBe("rotated-refresh-token");
    } finally {
      db.close();
    }
  });

  test("shares Connect token restoration between Connect and device-sync services", async () => {
    const db = new Database(":memory:");
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    let tokenRequests = 0;
    let activeTokenRestores = 0;
    let maxActiveTokenRestores = 0;
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/auth/v1/token")) {
        tokenRequests += 1;
        activeTokenRestores += 1;
        maxActiveTokenRestores = Math.max(maxActiveTokenRestores, activeTokenRestores);
        await new Promise((resolve) => setTimeout(resolve, 0));
        activeTokenRestores -= 1;
        return Response.json({
          access_token: "access-token",
          refresh_token: "rotated-refresh-token",
        });
      }
      throw new Error(`unexpected request: ${url}`);
    };
    const connectService = createLocalConnectService({
      db,
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test" },
      fetch: fetchImpl,
      accountService: {
        getAllAccounts: () => [],
        getBaseCurrency: () => "USD",
        createAccount: () => {
          throw new Error("not used");
        },
      },
      activityService: {
        getBrokerSyncProfile: () => {
          throw new Error("not used");
        },
        saveBrokerSyncProfileRules: () => {
          throw new Error("not used");
        },
      },
    });
    const deviceSyncService = createLocalConnectDeviceSyncService({
      db,
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test" },
      fetch: fetchImpl,
      restoreSyncSession: () => connectService.restoreSyncSession(),
    });

    try {
      await expect(
        Promise.all([connectService.restoreSyncSession(), deviceSyncService.getDeviceSyncState()]),
      ).resolves.toHaveLength(2);
      expect(tokenRequests).toBe(1);
      expect(maxActiveTokenRestores).toBe(1);
      expect(secretService.entries.get("sync_refresh_token")).toBe("rotated-refresh-token");
    } finally {
      db.close();
    }
  });

  test("serializes clearing local sync data with enable key initialization", async () => {
    const db = createDeviceSyncStateDb();
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    const service = createLocalConnectDeviceSyncService({
      db,
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test" },
      fetch: async (input, init) => {
        const url = String(input);
        if (url.includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        if (url.endsWith("/api/v1/sync/team/devices") && init?.method === "POST") {
          return Response.json({
            mode: "BOOTSTRAP",
            device_id: "device-1",
            e2ee_key_version: 2,
          });
        }
        if (url.endsWith("/api/v1/sync/team/keys/initialize")) {
          return Response.json({
            mode: "BOOTSTRAP",
            challenge: "challenge-1",
            nonce: "nonce-1",
            key_version: 2,
          });
        }
        if (url.endsWith("/api/v1/sync/team/keys/initialize/commit")) {
          return Response.json({ success: true, key_state: "ACTIVE" });
        }
        throw new Error(`unexpected request: ${url}`);
      },
    });

    try {
      await expect(
        Promise.all([service.enableDeviceSync(), service.clearDeviceSyncData()]),
      ).resolves.toHaveLength(2);
      const identity = JSON.parse(secretService.entries.get("sync_identity") ?? "{}") as Record<
        string,
        unknown
      >;
      expect(identity).toMatchObject({
        version: 2,
        deviceId: null,
        rootKey: null,
        keyVersion: null,
        deviceSecretKey: null,
        devicePublicKey: null,
      });
      expect(typeof identity.deviceNonce).toBe("string");
      expect(secretService.entries.get("sync_device_id")).toBeUndefined();
    } finally {
      db.close();
    }
  });

  test("enables FRESH device sync as registered when pairing is required", async () => {
    const db = createDeviceSyncStateDb();
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    const requests: string[] = [];
    const service = createLocalConnectDeviceSyncService({
      db,
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test" },
      reinitializeDelayMs: 0,
      fetch: async (input) => {
        const url = String(input);
        requests.push(url);
        if (url.includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        return Response.json({
          mode: "PAIR",
          device_id: "device-1",
          e2ee_key_version: 4,
          require_sas: true,
          pairing_ttl_seconds: 300,
          trusted_devices: [
            { id: "device-2", name: "iPhone", platform: "ios", last_seen_at: null },
          ],
        });
      },
    });

    try {
      await expect(service.enableDeviceSync()).resolves.toEqual({
        deviceId: "device-1",
        state: "REGISTERED",
        keyVersion: null,
        serverKeyVersion: 4,
        needsPairing: true,
        trustedDevices: [{ id: "device-2", name: "iPhone", platform: "ios", lastSeenAt: null }],
      });
      expect(requests.some((url) => url.includes("/sync/team/keys/initialize"))).toBe(false);
      const identity = JSON.parse(secretService.entries.get("sync_identity") ?? "{}") as Record<
        string,
        unknown
      >;
      expect(identity).toMatchObject({
        version: 2,
        deviceId: "device-1",
        rootKey: null,
        keyVersion: null,
        deviceSecretKey: null,
        devicePublicKey: null,
      });
      expect(secretService.entries.get("sync_device_id")).toBe("device-1");
      expect(
        db
          .query<
            { min_snapshot_created_at: string | null },
            []
          >("SELECT min_snapshot_created_at FROM sync_device_config WHERE device_id = 'old-device'")
          .get(),
      ).toEqual({ min_snapshot_created_at: null });
    } finally {
      db.close();
    }
  });

  test("reinitializes only after cloud reset succeeds and preserves the device nonce", async () => {
    const failingDb = createDeviceSyncStateDb();
    const failingSecretService = createMemorySecretService();
    const originalIdentity = {
      version: 2,
      deviceNonce: "existing-nonce",
      deviceId: "old-device",
      rootKey: "root",
      keyVersion: 1,
      deviceSecretKey: "secret",
      devicePublicKey: "public",
    };
    failingSecretService.entries.set("sync_refresh_token", "refresh-token");
    failingSecretService.entries.set("sync_identity", JSON.stringify(originalIdentity));
    const failingService = createLocalConnectDeviceSyncService({
      db: failingDb,
      secretService: failingSecretService,
      env: { CONNECT_API_URL: "https://api.example.test" },
      reinitializeDelayMs: 0,
      fetch: async (input) => {
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        return Response.json({ success: false, key_version: 1, reset_at: null });
      },
    });

    try {
      await expect(failingService.reinitializeDeviceSync()).rejects.toMatchObject({
        code: "internal_error",
        message:
          "Team sync reset was not accepted. Please verify account permissions and try again.",
      });
      expect(JSON.parse(failingSecretService.entries.get("sync_identity") ?? "{}")).toEqual(
        originalIdentity,
      );
    } finally {
      failingDb.close();
    }

    const db = createDeviceSyncStateDb();
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    secretService.entries.set("sync_identity", JSON.stringify(originalIdentity));
    const requests: Array<{ url: string; body: Record<string, unknown> | null }> = [];
    const service = createLocalConnectDeviceSyncService({
      db,
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test" },
      reinitializeDelayMs: 0,
      fetch: async (input, init) => {
        const url = String(input);
        const body =
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : null;
        requests.push({ url, body });
        if (url.includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        if (url.endsWith("/api/v1/sync/team/keys/reset")) {
          return Response.json({ success: true, key_version: 1, reset_at: "2026-01-01T00:00:00Z" });
        }
        return Response.json({
          mode: "PAIR",
          device_id: "new-device",
          e2ee_key_version: 4,
          require_sas: true,
          pairing_ttl_seconds: 300,
          trusted_devices: [
            { id: "device-2", name: "iPhone", platform: "ios", last_seen_at: null },
          ],
        });
      },
    });

    try {
      await expect(service.reinitializeDeviceSync()).resolves.toMatchObject({
        deviceId: "new-device",
        state: "REGISTERED",
        needsPairing: true,
      });
      expect(
        requests.find((request) => request.url.endsWith("/api/v1/sync/team/keys/reset"))?.body,
      ).toEqual({ reason: "reinitialize" });
      expect(
        requests.find((request) => request.url.endsWith("/api/v1/sync/team/devices"))?.body,
      ).toMatchObject({ device_nonce: "existing-nonce" });
      expect(JSON.parse(secretService.entries.get("sync_identity") ?? "{}")).toMatchObject({
        deviceNonce: "existing-nonce",
        deviceId: "new-device",
        rootKey: null,
        keyVersion: null,
      });
    } finally {
      db.close();
    }
  });

  test("re-enrolls device sync from RECOVERY state", async () => {
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
      fetch: async (input, init) => {
        const url = String(input);
        if (url.includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        if (url.endsWith("/api/v1/sync/team/devices") && init?.method === "POST") {
          return Response.json({
            mode: "PAIR",
            device_id: "device-2",
            e2ee_key_version: 3,
            require_sas: true,
            pairing_ttl_seconds: 300,
            trusted_devices: [
              { id: "trusted-1", name: "iPhone", platform: "ios", last_seen_at: null },
            ],
          });
        }
        return Response.json({ code: "DEVICE_NOT_FOUND", message: "not found" }, { status: 404 });
      },
    });

    try {
      await expect(service.enableDeviceSync()).resolves.toMatchObject({
        deviceId: "device-2",
        state: "REGISTERED",
        needsPairing: true,
      });
      expect(JSON.parse(secretService.entries.get("sync_identity") ?? "{}")).toMatchObject({
        deviceNonce: "nonce-1",
        deviceId: "device-2",
        rootKey: null,
        keyVersion: null,
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
      ).resolves.toMatchObject({
        status: "error",
        message: "Failed to read sync state: Failed to parse device response",
      });
    } finally {
      db.close();
    }
  });

  test("reconciles READY local state when bootstrap is already complete", async () => {
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
        const url = String(input);
        if (url.includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        if (url.includes("/api/v1/sync/events/reconcile-ready-state")) {
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
      await expect(
        service.reconcileDeviceSyncReadyState({ allowOverwrite: false }),
      ).resolves.toEqual({
        status: "ok",
        message: "Device sync reconcile completed",
        bootstrapAction: "NO_BOOTSTRAP",
        bootstrapStatus: "skipped",
        bootstrapMessage: "Snapshot bootstrap already completed",
        bootstrapSnapshotId: null,
        cycleStatus: null,
        cycleNeedsBootstrap: false,
        retryAttempted: false,
        retryCycleStatus: null,
        backgroundStatus: "skipped",
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
    const syncHeaders: Array<{
      url: string;
      clientRequestId: string | null;
      deviceId: string | null;
    }> = [];
    const service = createLocalConnectDeviceSyncService({
      db,
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test" },
      fetch: async (input, init) => {
        const url = String(input);
        requests.push(url);
        if (url.includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        const headers = new Headers(init?.headers);
        if (url.includes("/api/v1/sync/")) {
          syncHeaders.push({
            url,
            clientRequestId: headers.get("x-wf-client-request-id"),
            deviceId: headers.get("x-wf-device-id"),
          });
        }
        if (url.endsWith("/api/v1/sync/team/devices?scope=my")) {
          return listResponses.shift() ?? Response.json([]);
        }
        if (url.endsWith("/api/v1/sync/team/keys/initialize")) {
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
      expect(
        syncHeaders
          .filter((headers) => headers.url.includes("/api/v1/sync/team/devices"))
          .every(
            (headers) => headers.clientRequestId?.startsWith("app:") && headers.deviceId === null,
          ),
      ).toBe(true);
      expect(
        syncHeaders
          .filter((headers) => headers.url.endsWith("/api/v1/sync/team/keys/initialize"))
          .every(
            (headers) =>
              headers.clientRequestId?.startsWith("device-1:") && headers.deviceId === "device-1",
          ),
      ).toBe(true);
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

  test("skips background engine start when identity can run but session is unavailable", async () => {
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
      await expect(service.startDeviceSyncBackgroundEngine()).resolves.toEqual({
        status: "skipped",
        message: "Background engine not started: No sync session configured",
      });
    } finally {
      db.close();
    }
  });

  test("keeps background engine start feature-gated when sync state is READY", async () => {
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
        keyVersion: 1,
      }),
    );
    const service = createLocalConnectDeviceSyncService({
      db,
      secretService,
      fetch: async (input) => {
        const url = String(input);
        if (url.includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        return Response.json({
          id: "device-1",
          display_name: "MacBook",
          trust_state: "trusted",
          trusted_key_version: 1,
        });
      },
    });

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
      INSERT INTO sync_device_config (device_id, key_version, trust_state, last_bootstrap_at)
      VALUES ('device-1', 1, 'trusted', '2026-01-01T00:00:00Z');
    `);
    const service = createLocalConnectDeviceSyncService({
      db,
      secretService,
      fetch: async (input) => {
        const url = String(input);
        if (url.includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        return Response.json({
          id: "device-1",
          display_name: "MacBook",
          trust_state: "trusted",
          trusted_key_version: 1,
        });
      },
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
      expect(
        db
          .query<
            { key_version: number | null; trust_state: string; last_bootstrap_at: string | null },
            []
          >("SELECT key_version, trust_state, last_bootstrap_at FROM sync_device_config WHERE device_id = 'device-1'")
          .get(),
      ).toEqual({ key_version: null, trust_state: "untrusted", last_bootstrap_at: null });
      await expect(service.getDeviceSyncBootstrapOverwriteCheck()).resolves.toMatchObject({
        bootstrapRequired: true,
      });

      secretService.entries.set(
        "sync_identity",
        JSON.stringify({ version: 2, deviceNonce: "nonce-1", deviceId: "device-1" }),
      );
      await expect(service.triggerDeviceSyncCycle()).resolves.toMatchObject({
        status: "not_ready",
        lockVersion: 4,
        cursor: 9,
      });
      expect(
        db
          .query<
            { key_version: number | null; trust_state: string; last_bootstrap_at: string | null },
            []
          >("SELECT key_version, trust_state, last_bootstrap_at FROM sync_device_config WHERE device_id = 'device-1'")
          .get(),
      ).toEqual({ key_version: null, trust_state: "untrusted", last_bootstrap_at: null });
      await expect(service.getDeviceSyncBootstrapOverwriteCheck()).resolves.toMatchObject({
        bootstrapRequired: true,
      });

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
      await expect(service.triggerDeviceSyncCycle()).rejects.toMatchObject({
        code: "not_implemented",
        status: 501,
      });
    } finally {
      db.close();
    }
  });

  test("returns ok for READY trigger cycle when reconcile is NOOP and outbox is empty", async () => {
    const db = new Database(":memory:");
    const secretService = createMemorySecretService();
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
      CREATE TABLE sync_device_config (
        device_id TEXT PRIMARY KEY NOT NULL,
        key_version INTEGER,
        trust_state TEXT NOT NULL DEFAULT 'untrusted',
        last_bootstrap_at TEXT,
        min_snapshot_created_at TEXT
      );
      INSERT INTO sync_cursor (id, cursor, updated_at) VALUES (1, 9, '2026-01-01T00:00:00Z');
      INSERT INTO sync_engine_state (
        id, lock_version, last_cycle_status, last_error, consecutive_failures
      ) VALUES (1, 4, 'stale_cursor', 'stale', 3);
    `);
    secretService.entries.set("sync_refresh_token", "refresh-token");
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
    const requests: string[] = [];
    const service = createLocalConnectDeviceSyncService({
      db,
      secretService,
      fetch: async (input) => {
        const url = String(input);
        requests.push(url);
        if (url.includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        if (url.includes("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "NOOP" });
        }
        return Response.json({
          id: "device-1",
          display_name: "MacBook",
          trust_state: "trusted",
          trusted_key_version: 1,
        });
      },
    });

    try {
      await expect(service.triggerDeviceSyncCycle()).resolves.toEqual({
        status: "ok",
        lockVersion: 0,
        pushedCount: 0,
        pulledCount: 0,
        cursor: 9,
        needsBootstrap: false,
        bootstrapSnapshotId: null,
        bootstrapSnapshotSeq: null,
        deadLetterCount: 0,
      });
      expect(
        db
          .query<
            {
              last_cycle_status: string | null;
              last_error: string | null;
              consecutive_failures: number;
            },
            []
          >(
            "SELECT last_cycle_status, last_error, consecutive_failures FROM sync_engine_state WHERE id = 1",
          )
          .get(),
      ).toEqual({ last_cycle_status: "ok", last_error: null, consecutive_failures: 0 });
      expect(
        db
          .query<
            { key_version: number | null; trust_state: string; last_bootstrap_at: string | null },
            []
          >("SELECT key_version, trust_state, last_bootstrap_at FROM sync_device_config WHERE device_id = 'device-1'")
          .get(),
      ).toEqual({ key_version: 1, trust_state: "trusted", last_bootstrap_at: null });
      expect(requests).toEqual([
        "https://auth.wealthfolio.app/auth/v1/token?grant_type=refresh_token",
        "https://api.wealthfolio.app/api/v1/sync/team/devices/device-1",
        "https://api.wealthfolio.app/api/v1/sync/events/reconcile-ready-state",
      ]);

      db.query(
        `
          INSERT INTO sync_outbox (
            event_id, entity, entity_id, op, client_timestamp, payload,
            payload_key_version, sent, status, retry_count, device_id, created_at
          )
          VALUES (
            'event-1', 'account', 'account-1', 'update', '2026-01-01T00:00:00Z',
            '{}', 1, 0, 'pending', 0, 'device-1', '2026-01-01T00:00:00Z'
          )
        `,
      ).run();
      await expect(service.triggerDeviceSyncCycle()).rejects.toMatchObject({
        code: "not_implemented",
        status: 501,
      });
    } finally {
      db.close();
    }
  });

  test("returns wait_snapshot for READY trigger cycle when reconcile asks to wait", async () => {
    const db = new Database(":memory:");
    const secretService = createMemorySecretService();
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
        trust_state TEXT NOT NULL DEFAULT 'untrusted',
        last_bootstrap_at TEXT,
        min_snapshot_created_at TEXT
      );
      INSERT INTO sync_cursor (id, cursor, updated_at) VALUES (1, 11, '2026-01-01T00:00:00Z');
      INSERT INTO sync_engine_state (
        id, lock_version, last_cycle_status, last_error, consecutive_failures
      ) VALUES (1, 4, 'state_error', 'stale error', 3);
    `);
    secretService.entries.set("sync_refresh_token", "refresh-token");
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
    const requests: string[] = [];
    const service = createLocalConnectDeviceSyncService({
      db,
      secretService,
      fetch: async (input) => {
        const url = String(input);
        requests.push(url);
        if (url.includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        if (url.includes("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "WAIT_SNAPSHOT" });
        }
        return Response.json({
          id: "device-1",
          display_name: "MacBook",
          trust_state: "trusted",
          trusted_key_version: 1,
        });
      },
    });

    try {
      const before = Date.now();
      await expect(service.triggerDeviceSyncCycle()).resolves.toEqual({
        status: "wait_snapshot",
        lockVersion: 0,
        pushedCount: 0,
        pulledCount: 0,
        cursor: 11,
        needsBootstrap: false,
        bootstrapSnapshotId: null,
        bootstrapSnapshotSeq: null,
        deadLetterCount: 0,
      });
      const after = Date.now();
      const row = db
        .query<
          {
            last_cycle_status: string | null;
            last_error: string | null;
            consecutive_failures: number;
            next_retry_at: string | null;
          },
          []
        >(
          "SELECT last_cycle_status, last_error, consecutive_failures, next_retry_at FROM sync_engine_state WHERE id = 1",
        )
        .get();
      expect(row).toMatchObject({
        last_cycle_status: "wait_snapshot",
        last_error: "stale error",
        consecutive_failures: 3,
      });
      const retryAt = Date.parse(row?.next_retry_at ?? "");
      expect(retryAt).toBeGreaterThanOrEqual(before + 29_000);
      expect(retryAt).toBeLessThanOrEqual(after + 31_000);
      expect(requests).toEqual([
        "https://auth.wealthfolio.app/auth/v1/token?grant_type=refresh_token",
        "https://api.wealthfolio.app/api/v1/sync/team/devices/device-1",
        "https://api.wealthfolio.app/api/v1/sync/events/reconcile-ready-state",
      ]);
    } finally {
      db.close();
    }
  });

  test("returns stale_cursor for READY trigger cycle when reconcile requires bootstrap", async () => {
    const db = new Database(":memory:");
    const secretService = createMemorySecretService();
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
        trust_state TEXT NOT NULL DEFAULT 'untrusted',
        last_bootstrap_at TEXT,
        min_snapshot_created_at TEXT
      );
      INSERT INTO sync_cursor (id, cursor, updated_at) VALUES (1, 12, '2026-01-01T00:00:00Z');
      INSERT INTO sync_engine_state (
        id, lock_version, last_cycle_status, last_error, consecutive_failures, next_retry_at
      ) VALUES (1, 4, 'state_error', 'stale error', 3, '2030-01-01T00:00:00Z');
    `);
    secretService.entries.set("sync_refresh_token", "refresh-token");
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
    const service = createLocalConnectDeviceSyncService({
      db,
      secretService,
      fetch: async (input) => {
        const url = String(input);
        if (url.includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        if (url.includes("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({
            action: "BOOTSTRAP_SNAPSHOT",
            latest_snapshot: {
              snapshot_id: "snapshot-1",
              oplog_seq: 99,
            },
          });
        }
        return Response.json({
          id: "device-1",
          display_name: "MacBook",
          trust_state: "trusted",
          trusted_key_version: 1,
        });
      },
    });

    try {
      await expect(service.triggerDeviceSyncCycle()).resolves.toEqual({
        status: "stale_cursor",
        lockVersion: 0,
        pushedCount: 0,
        pulledCount: 0,
        cursor: 12,
        needsBootstrap: true,
        bootstrapSnapshotId: "snapshot-1",
        bootstrapSnapshotSeq: 99,
        deadLetterCount: 0,
      });
      expect(
        db
          .query<
            {
              last_cycle_status: string | null;
              last_error: string | null;
              consecutive_failures: number;
              next_retry_at: string | null;
            },
            []
          >(
            "SELECT last_cycle_status, last_error, consecutive_failures, next_retry_at FROM sync_engine_state WHERE id = 1",
          )
          .get(),
      ).toEqual({
        last_cycle_status: "stale_cursor",
        last_error: "stale error",
        consecutive_failures: 3,
        next_retry_at: null,
      });
    } finally {
      db.close();
    }
  });

  test("returns ok for READY pull-tail trigger cycle when cursors already match", async () => {
    const db = new Database(":memory:");
    const secretService = createMemorySecretService();
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
      CREATE TABLE sync_device_config (
        device_id TEXT PRIMARY KEY NOT NULL,
        key_version INTEGER,
        trust_state TEXT NOT NULL DEFAULT 'untrusted',
        last_bootstrap_at TEXT,
        min_snapshot_created_at TEXT
      );
      INSERT INTO sync_cursor (id, cursor, updated_at) VALUES (1, 12, '2026-01-01T00:00:00Z');
      INSERT INTO sync_engine_state (
        id, lock_version, last_cycle_status, last_error, consecutive_failures, next_retry_at
      ) VALUES (1, 4, 'state_error', 'stale error', 3, '2030-01-01T00:00:00Z');
    `);
    secretService.entries.set("sync_refresh_token", "refresh-token");
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
    let serverCursor = 12;
    const service = createLocalConnectDeviceSyncService({
      db,
      secretService,
      fetch: async (input) => {
        const url = String(input);
        if (url.includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        if (url.includes("/api/v1/sync/events/reconcile-ready-state")) {
          return Response.json({ action: "PULL_TAIL", cursor: serverCursor });
        }
        return Response.json({
          id: "device-1",
          display_name: "MacBook",
          trust_state: "trusted",
          trusted_key_version: 1,
        });
      },
    });

    try {
      await expect(service.triggerDeviceSyncCycle()).resolves.toEqual({
        status: "ok",
        lockVersion: 5,
        pushedCount: 0,
        pulledCount: 0,
        cursor: 12,
        needsBootstrap: false,
        bootstrapSnapshotId: null,
        bootstrapSnapshotSeq: null,
        deadLetterCount: 0,
      });
      expect(
        db
          .query<
            {
              lock_version: number;
              last_cycle_status: string | null;
              last_error: string | null;
              consecutive_failures: number;
              next_retry_at: string | null;
            },
            []
          >(
            "SELECT lock_version, last_cycle_status, last_error, consecutive_failures, next_retry_at FROM sync_engine_state WHERE id = 1",
          )
          .get(),
      ).toEqual({
        lock_version: 5,
        last_cycle_status: "ok",
        last_error: null,
        consecutive_failures: 0,
        next_retry_at: null,
      });

      serverCursor = 13;
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
      CREATE TABLE sync_cursor (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        cursor BIGINT NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE sync_device_config (
        device_id TEXT PRIMARY KEY NOT NULL,
        key_version INTEGER,
        trust_state TEXT NOT NULL DEFAULT 'untrusted',
        last_bootstrap_at TEXT
      );
      INSERT INTO sync_cursor (id, cursor, updated_at) VALUES (1, 10, '2026-01-01T00:00:00Z');
    `);
    db.prepare(
      "INSERT INTO sync_device_config (device_id, key_version, trust_state, last_bootstrap_at) VALUES ('legacy-device', 1, 'trusted', NULL)",
    ).run();
    let trustState = "untrusted";
    let serverCursor = 8;
    let failureMode: "none" | "device" | "cursor" = "none";
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
        if (String(input).includes("/api/v1/sync/events/cursor")) {
          if (failureMode === "cursor") {
            throw new Error("cursor offline");
          }
          return Response.json({ cursor: serverCursor });
        }
        if (failureMode === "device") {
          throw new Error("device offline");
        }
        return Response.json({
          id: "device-1",
          display_name: "MacBook",
          trust_state: trustState,
          trusted_key_version: 1,
        });
      },
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
      failureMode = "device";
      await expect(service.getDeviceSyncPairingSourceStatus()).rejects.toMatchObject({
        code: "internal_error",
        message: "device offline",
        status: 500,
      });
      failureMode = "none";
      await expect(service.getDeviceSyncPairingSourceStatus()).rejects.toMatchObject({
        code: "internal_error",
        message: "Current device is not ready to connect another device yet.",
        status: 500,
      });

      trustState = "trusted";
      failureMode = "cursor";
      await expect(service.getDeviceSyncPairingSourceStatus()).rejects.toMatchObject({
        code: "internal_error",
        message: "cursor offline",
        status: 500,
      });
      failureMode = "none";
      await expect(service.getDeviceSyncPairingSourceStatus()).resolves.toEqual({
        status: "restore_required",
        message: "This device needs to set up sync again before you add another device.",
        localCursor: 10,
        serverCursor: 8,
      });
      serverCursor = 10;
      await expect(service.getDeviceSyncPairingSourceStatus()).resolves.toEqual({
        status: "ready",
        message: "This device is ready to connect another device.",
        localCursor: 10,
        serverCursor: 10,
      });
      expect(
        requests.filter((request) => request.includes("/api/v1/sync/events/cursor")),
      ).toHaveLength(3);
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

  test("handles trusted generate-snapshot pre-export cursor checks", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE sync_cursor (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        cursor BIGINT NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      INSERT INTO sync_cursor (id, cursor, updated_at) VALUES (1, 10, '2026-01-01T00:00:00Z');
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_refresh_token", "refresh-token");
    secretService.entries.set(
      "sync_identity",
      JSON.stringify({ version: 2, deviceNonce: "nonce-1", deviceId: "device-1" }),
    );
    let serverCursor = 8;
    let latestSnapshotOplogSeq: number | null = null;
    const service = createLocalConnectDeviceSyncService({
      db,
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test" },
      fetch: async (input) => {
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        if (String(input).includes("/api/v1/sync/events/cursor")) {
          return Response.json({ cursor: serverCursor });
        }
        if (String(input).includes("/api/v1/sync/snapshots/latest")) {
          if (latestSnapshotOplogSeq === null) {
            return Response.json(
              { code: "SNAPSHOT_NOT_FOUND", message: "not found" },
              { status: 404 },
            );
          }
          return Response.json({
            snapshot_id: "019bb9fe-f707-71e9-a40d-733575f4f246",
            oplog_seq: latestSnapshotOplogSeq,
            created_at: "2026-01-01T00:00:00Z",
            schema_version: 1,
            covers_tables: [],
            size_bytes: 128,
            checksum: "sha256:snapshot",
          });
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
      await expect(service.generateDeviceSnapshotNow()).rejects.toMatchObject({
        code: "internal_error",
        status: 500,
        message:
          "SYNC_SOURCE_RESTORE_REQUIRED: This device needs to set up sync again before you add another device.",
      });
      serverCursor = 10;
      latestSnapshotOplogSeq = 10;
      await expect(service.generateDeviceSnapshotNow()).resolves.toEqual({
        status: "uploaded",
        snapshotId: "019bb9fe-f707-71e9-a40d-733575f4f246",
        oplogSeq: 10,
        message: "Latest remote snapshot already covers current cursor",
      });
      latestSnapshotOplogSeq = 9;
      await expect(service.generateDeviceSnapshotNow()).rejects.toMatchObject({
        code: "not_implemented",
        status: 501,
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
        "https://api.example.test/api/v1/sync/snapshots/latest",
      ]);
    } finally {
      db.close();
    }
  });

  test("requests bootstrap snapshot when READY freshness gate waits for upload", async () => {
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
      ) VALUES ('device-1', 2, 'trusted', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
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
        status: "requested",
        message: "Waiting for a snapshot generated after pairing confirmation",
        snapshotId: null,
        cursor: 42,
      });
      expect(
        db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM sync_outbox").get(),
      ).toEqual({ count: 1 });
    } finally {
      db.close();
    }
  });

  test("requests bootstrap snapshot when latest snapshot is older than freshness gate", async () => {
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
      ) VALUES ('device-1', 2, 'trusted', '2026-01-01T00:00:00Z', '2026-01-01T00:10:00Z');
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
    let remoteCursor = 99;
    const service = createLocalConnectDeviceSyncService({
      db,
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test" },
      fetch: async (input) => {
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        if (String(input).includes("/api/v1/sync/snapshots/019bb9fe-f707-71e9-a40d-733575f4f246")) {
          return snapshotDownloadResponse();
        }
        if (String(input).includes("/api/v1/sync/snapshots/latest")) {
          return Response.json({
            snapshot_id: "019bb9fe-f707-71e9-a40d-733575f4f246",
            oplog_seq: 42,
            created_at: "2026-01-01T00:00:00Z",
            schema_version: 1,
            covers_tables: [],
            size_bytes: 128,
            checksum: "sha256:16a0eeb0791b6c92451fd284dd9f599e0a7dbe7f6ebea6e2d2d06c7f74aec112",
          });
        }
        if (String(input).includes("/api/v1/sync/events/cursor")) {
          return Response.json({ cursor: remoteCursor, latest_snapshot: null });
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
        status: "requested",
        message: "Waiting for a snapshot generated after pairing confirmation",
        snapshotId: null,
        cursor: 42,
      });
      expect(
        db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM sync_outbox").get(),
      ).toEqual({ count: 1 });
      remoteCursor = 40;
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

  test("marks READY bootstrap complete when latest snapshot metadata is empty", async () => {
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
          return Response.json({
            snapshot_id: "",
            oplog_seq: 0,
            created_at: "2026-01-01T00:00:00Z",
            schema_version: 1,
            covers_tables: [],
            size_bytes: 0,
            checksum: "sha256:empty",
          });
        }
        if (String(input).includes("/api/v1/sync/events/cursor")) {
          return Response.json({ cursor: 42, latest_snapshot: null });
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
        "https://api.example.test/api/v1/sync/events/cursor",
        "https://api.example.test/api/v1/sync/events/reconcile-ready-state",
      ]);
      expect(
        db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM sync_outbox").get(),
      ).toEqual({ count: 0 });
    } finally {
      db.close();
    }
  });

  test("keeps READY bootstrap feature-gated for malformed empty snapshot metadata", async () => {
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
    let latestSnapshotResponse: Record<string, unknown> = {
      snapshot_id: "",
      oplog_seq: 0,
      created_at: "2026-01-01T00:00:00Z",
      schema_version: 1,
      covers_tables: [],
    };
    let cursorResponse: Record<string, unknown> = { cursor: 42, latest_snapshot: null };
    const service = createLocalConnectDeviceSyncService({
      db,
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test" },
      fetch: async (input) => {
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        if (String(input).includes("/api/v1/sync/snapshots/latest")) {
          return Response.json(latestSnapshotResponse);
        }
        if (String(input).includes("/api/v1/sync/events/cursor")) {
          return Response.json(cursorResponse);
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
      latestSnapshotResponse = {
        snapshot_id: "",
        oplog_seq: 0.5,
        created_at: "2026-01-01T00:00:00Z",
        schema_version: 1,
        covers_tables: [42],
        size_bytes: 0,
        checksum: "sha256:empty",
      };
      await expect(service.bootstrapDeviceSnapshot()).rejects.toMatchObject({
        code: "not_implemented",
        status: 501,
      });
      expect(
        db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM sync_outbox").get(),
      ).toEqual({ count: 1 });
      latestSnapshotResponse = {
        snapshot_id: "",
        oplog_seq: Number.MAX_SAFE_INTEGER + 1,
        created_at: "2026-01-01T00:00:00Z",
        schema_version: 2147483648,
        covers_tables: [],
        size_bytes: 0,
        checksum: "sha256:empty",
      };
      await expect(service.bootstrapDeviceSnapshot()).rejects.toMatchObject({
        code: "not_implemented",
        status: 501,
      });
      expect(
        db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM sync_outbox").get(),
      ).toEqual({ count: 1 });
      latestSnapshotResponse = {
        snapshot_id: "",
        oplog_seq: 0,
        created_at: "2026-01-01T00:00:00Z",
        schema_version: 1,
        covers_tables: [],
        size_bytes: 0,
        checksum: "sha256:empty",
      };
      cursorResponse = { cursor: 42, gc_watermark: "bad", latest_snapshot: null };
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

  test("requests READY bootstrap when missing snapshot reconcile still waits", async () => {
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
      await expect(service.bootstrapDeviceSnapshot()).resolves.toEqual({
        status: "requested",
        message: "Waiting for a trusted device to upload a snapshot",
        snapshotId: null,
        cursor: 42,
      });
      expect(
        db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM sync_outbox").get(),
      ).toEqual({ count: 1 });
    } finally {
      db.close();
    }
  });

  test("reports newer snapshot schema before bootstrap apply", async () => {
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
            schema_version: 2,
            covers_tables: [],
            size_bytes: 128,
            checksum: "sha256:snapshot",
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
        code: "internal_error",
        status: 500,
        message: "Snapshot schema version 2 is newer than local version 1. Please update the app.",
      });
      expect(
        db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM sync_outbox").get(),
      ).toEqual({ count: 1 });
    } finally {
      db.close();
    }
  });

  test("reports bootstrap snapshot download preflight errors", async () => {
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
    let mode:
      | "missing"
      | "transport"
      | "body"
      | "rate-limit"
      | "missing-schema-header"
      | "bad-schema-header"
      | "missing-covers-header"
      | "missing-checksum-header"
      | "bad-header"
      | "bad-metadata" = "missing";
    const service = createLocalConnectDeviceSyncService({
      db,
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test" },
      fetch: async (input) => {
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        if (String(input).includes("/api/v1/sync/snapshots/snapshot-1")) {
          if (mode === "missing") {
            return Response.json(
              { code: "SNAPSHOT_NOT_FOUND", message: "not found" },
              { status: 404 },
            );
          }
          if (mode === "transport") {
            throw new Error("snapshot download offline");
          }
          if (mode === "rate-limit") {
            return Response.json({ code: "RATE_LIMIT", message: "slow down" }, { status: 429 });
          }
          if (mode === "body") {
            return {
              ok: true,
              status: 200,
              headers: snapshotDownloadResponse().headers,
              arrayBuffer: async () => {
                throw new Error("snapshot body unreadable");
              },
            } as unknown as Response;
          }
          if (mode === "missing-schema-header") {
            return snapshotDownloadResponse(undefined, { "x-snapshot-schema-version": null });
          }
          if (mode === "bad-schema-header") {
            return snapshotDownloadResponse(undefined, { "x-snapshot-schema-version": "1.5" });
          }
          if (mode === "missing-covers-header") {
            return snapshotDownloadResponse(undefined, { "x-snapshot-covers-tables": null });
          }
          if (mode === "missing-checksum-header") {
            return snapshotDownloadResponse(undefined, { "x-snapshot-checksum": null });
          }
          return snapshotDownloadResponse(mode === "bad-header" ? "sha256:bad" : undefined);
        }
        if (String(input).includes("/api/v1/sync/snapshots/latest")) {
          return Response.json({
            snapshot_id: "snapshot-1",
            oplog_seq: 42,
            created_at: "2026-01-01T00:00:00Z",
            schema_version: 1,
            covers_tables: [],
            size_bytes: 128,
            checksum:
              mode === "bad-metadata"
                ? "sha256:bad-metadata"
                : "sha256:16a0eeb0791b6c92451fd284dd9f599e0a7dbe7f6ebea6e2d2d06c7f74aec112",
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
        code: "internal_error",
        status: 500,
        message: "Snapshot snapshot-1 is no longer available. No valid snapshot to download.",
      });
      mode = "transport";
      await expect(service.bootstrapDeviceSnapshot()).rejects.toMatchObject({
        code: "internal_error",
        status: 500,
        message: "snapshot download offline",
      });
      mode = "body";
      await expect(service.bootstrapDeviceSnapshot()).rejects.toMatchObject({
        code: "internal_error",
        status: 500,
        message: "snapshot body unreadable",
      });
      mode = "rate-limit";
      await expect(service.bootstrapDeviceSnapshot()).rejects.toMatchObject({
        code: "internal_error",
        status: 500,
        message: "API error (429): RATE_LIMIT: slow down",
      });
      mode = "missing-schema-header";
      await expect(service.bootstrapDeviceSnapshot()).rejects.toMatchObject({
        code: "internal_error",
        status: 500,
        message: "Invalid request: Missing header x-snapshot-schema-version",
      });
      mode = "bad-schema-header";
      await expect(service.bootstrapDeviceSnapshot()).rejects.toMatchObject({
        code: "internal_error",
        status: 500,
        message: "Invalid request: Invalid header x-snapshot-schema-version",
      });
      mode = "missing-covers-header";
      await expect(service.bootstrapDeviceSnapshot()).rejects.toMatchObject({
        code: "internal_error",
        status: 500,
        message: "Invalid request: Missing header x-snapshot-covers-tables",
      });
      mode = "missing-checksum-header";
      await expect(service.bootstrapDeviceSnapshot()).rejects.toMatchObject({
        code: "internal_error",
        status: 500,
        message: "Invalid request: Missing header x-snapshot-checksum",
      });
      mode = "bad-header";
      await expect(service.bootstrapDeviceSnapshot()).rejects.toMatchObject({
        code: "internal_error",
        status: 500,
        message:
          "Snapshot checksum mismatch (download header): expected=sha256:bad, got=sha256:16a0eeb0791b6c92451fd284dd9f599e0a7dbe7f6ebea6e2d2d06c7f74aec112",
      });
      mode = "bad-metadata";
      await expect(service.bootstrapDeviceSnapshot()).rejects.toMatchObject({
        code: "internal_error",
        status: 500,
        message:
          "Snapshot checksum mismatch (latest metadata): expected=sha256:bad-metadata, got=sha256:16a0eeb0791b6c92451fd284dd9f599e0a7dbe7f6ebea6e2d2d06c7f74aec112",
      });
      expect(
        db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM sync_outbox").get(),
      ).toEqual({ count: 1 });
    } finally {
      db.close();
    }
  });

  test("uses cursor fallback schema for non-UUID latest snapshot metadata", async () => {
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
    let latestSchemaVersion = 2;
    let cursorSchemaVersion = 1;
    const service = createLocalConnectDeviceSyncService({
      db,
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test" },
      fetch: async (input) => {
        if (String(input).includes("/auth/v1/token")) {
          return Response.json({ access_token: "access-token" });
        }
        if (String(input).includes("/api/v1/sync/snapshots/019bb9fe-f707-71e9-a40d-733575f4f246")) {
          return snapshotDownloadResponse();
        }
        if (String(input).includes("/api/v1/sync/snapshots/latest")) {
          return Response.json({
            snapshot_id: "legacy-snapshot-id",
            oplog_seq: 42,
            created_at: "2026-01-01T00:00:00Z",
            schema_version: latestSchemaVersion,
            covers_tables: [],
            size_bytes: 128,
            checksum: "sha256:snapshot",
          });
        }
        if (String(input).includes("/api/v1/sync/events/cursor")) {
          return Response.json({
            cursor: 42,
            latest_snapshot: {
              snapshot_id: "019bb9fe-f707-71e9-a40d-733575f4f246",
              schema_version: cursorSchemaVersion,
              oplog_seq: 42,
            },
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
      latestSchemaVersion = 1;
      cursorSchemaVersion = 2;
      await expect(service.bootstrapDeviceSnapshot()).rejects.toMatchObject({
        code: "internal_error",
        status: 500,
        message: "Snapshot schema version 2 is newer than local version 1. Please update the app.",
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
        if (String(input).includes("/api/v1/sync/snapshots/snapshot-1")) {
          return snapshotDownloadResponse();
        }
        if (String(input).includes("/api/v1/sync/snapshots/latest")) {
          return Response.json({
            snapshot_id: "snapshot-1",
            oplog_seq: 42,
            created_at: "2026-01-01T00:00:00Z",
            schema_version: 1,
            covers_tables: [],
            size_bytes: 128,
            checksum: "sha256:16a0eeb0791b6c92451fd284dd9f599e0a7dbe7f6ebea6e2d2d06c7f74aec112",
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

  test("keeps READY bootstrap feature-gated when cursor fallback has latest snapshot", async () => {
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
        if (String(input).includes("/api/v1/sync/snapshots/snapshot-1")) {
          return snapshotDownloadResponse();
        }
        if (String(input).includes("/api/v1/sync/snapshots/latest")) {
          return Response.json({
            snapshot_id: "",
            oplog_seq: 0,
            created_at: "2026-01-01T00:00:00Z",
            schema_version: 1,
            covers_tables: [],
            size_bytes: 0,
            checksum: "sha256:empty",
          });
        }
        if (String(input).includes("/api/v1/sync/events/cursor")) {
          return Response.json({
            cursor: 42,
            latest_snapshot: {
              snapshot_id: "snapshot-1",
              schema_version: 1,
              oplog_seq: 42,
            },
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
