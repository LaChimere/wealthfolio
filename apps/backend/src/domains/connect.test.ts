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
});
