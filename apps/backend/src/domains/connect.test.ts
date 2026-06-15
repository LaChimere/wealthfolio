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

  test("keeps transaction-mode activity sync feature-gated until broker activity mapping lands", async () => {
    const db = new Database(":memory:");
    const service = createLocalConnectService({
      db,
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
    } finally {
      db.close();
    }
  });
});

describe("TS Connect device sync local service", () => {
  test("reads local sync engine status and bootstrap requirement", () => {
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
    const service = createLocalConnectDeviceSyncService({ db });

    try {
      expect(service.getDeviceSyncEngineStatus()).toEqual({
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
      expect(service.getDeviceSyncEngineStatus()).toMatchObject({ bootstrapRequired: true });
      expect(service.getDeviceSyncBootstrapOverwriteCheck()).toEqual({
        bootstrapRequired: true,
        hasLocalData: false,
        localRows: 0,
        nonEmptyTables: [],
      });
    } finally {
      db.close();
    }
  });

  test("summarizes local overwrite risk rows for bootstrap checks", () => {
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
      expect(service.getDeviceSyncBootstrapOverwriteCheck()).toEqual({
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

  test("returns local background engine start and stop no-op responses", () => {
    const db = new Database(":memory:");
    const service = createLocalConnectDeviceSyncService({ db });

    try {
      expect(service.startDeviceSyncBackgroundEngine()).toEqual({
        status: "skipped",
        message: "Background engine not started because sync identity is not configured",
      });
      expect(service.stopDeviceSyncBackgroundEngine()).toEqual({
        status: "stopped",
        message: "Device sync background engine stopped",
      });
    } finally {
      db.close();
    }
  });
});
