import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";

import { createLocalDeviceSyncService } from "./device-sync";
import type { SecretService } from "./secrets";

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

describe("TS local device sync service", () => {
  test("requires Connect session before device registration and enrolls after restore", async () => {
    const noSessionService = createLocalDeviceSyncService({
      connectService: {
        restoreSyncSession: () => {
          throw Object.assign(new Error("No sync session configured"), {
            code: "forbidden",
            status: 403,
          });
        },
      },
    });
    const request = {
      displayName: "MacBook",
      platform: "macos",
      instanceId: "instance-1",
    };

    await expect(noSessionService.registerDevice(request)).rejects.toMatchObject({
      code: "forbidden",
      status: 403,
    });

    const secretService = createMemorySecretService();
    const requests: Array<{ url: string; method: string; body: string | null }> = [];
    const restoredService = createLocalDeviceSyncService({
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test/" },
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
      fetch: async (input, init) => {
        requests.push({
          url: String(input),
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : null,
        });
        return Response.json({
          mode: "READY",
          device_id: "device-1",
          e2ee_key_version: 2,
          trust_state: "trusted",
        });
      },
    });
    await expect(
      restoredService.registerDevice({ ...request, osVersion: "14.0", appVersion: "1.2.3" }),
    ).resolves.toEqual({
      mode: "READY",
      device_id: "device-1",
      e2ee_key_version: 2,
      trust_state: "trusted",
    });
    expect(secretService.entries.get("sync_device_id")).toBe("device-1");
    expect(requests).toEqual([
      {
        url: "https://api.example.test/api/v1/sync/team/devices",
        method: "POST",
        body: JSON.stringify({
          device_nonce: "instance-1",
          display_name: "MacBook",
          platform: "macos",
          os_version: "14.0",
          app_version: "1.2.3",
        }),
      },
    ]);

    const failingSecretService = createMemorySecretService();
    const failingService = createLocalDeviceSyncService({
      secretService: {
        ...failingSecretService,
        setSecret: () => {
          throw new Error("keyring unavailable");
        },
      },
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
      fetch: async () =>
        Response.json({
          mode: "READY",
          device_id: "device-1",
          e2ee_key_version: 2,
          trust_state: "trusted",
        }),
    });
    await expect(failingService.registerDevice(request)).rejects.toMatchObject({
      code: "internal_error",
      message: "Failed to store device ID: keyring unavailable",
      status: 500,
    });

    let enrollBody =
      '{"mode":"READY","device_id":"device-1","e2ee_key_version":2.0,"trust_state":"trusted"}';
    const malformedResponseService = createLocalDeviceSyncService({
      secretService: createMemorySecretService(),
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
      fetch: async () =>
        new Response(enrollBody, { headers: { "content-type": "application/json" } }),
    });
    await expect(malformedResponseService.registerDevice(request)).rejects.toMatchObject({
      code: "internal_error",
      message: "Failed to parse enroll response",
      status: 500,
    });

    enrollBody =
      '{"mode":"PAIR","device_id":"device-1","e2ee_key_version":2,"e2eeKeyVersion":2,"require_sas":true,"pairing_ttl_seconds":60,"trusted_devices":[]}';
    await expect(malformedResponseService.registerDevice(request)).rejects.toMatchObject({
      code: "internal_error",
      message: "Failed to parse enroll response",
      status: 500,
    });
  });

  test("reports missing current device id after restoring Connect session", async () => {
    const secretService = createMemorySecretService();
    const service = createLocalDeviceSyncService({
      secretService,
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
      fetch: async () => Response.json({ success: true, key_version: 2 }),
    });

    await expect(service.getCurrentDevice()).rejects.toMatchObject({
      code: "bad_request",
      message: "No device ID configured",
      status: 400,
    });

    secretService.entries.set("sync_identity", '{"version":2.0,"deviceId":"device-1"}');
    await expect(service.getCurrentDevice()).rejects.toMatchObject({
      code: "bad_request",
      message: "No device ID configured",
      status: 400,
    });

    secretService.entries.set("sync_identity", '{"version":2,"deviceId":"a","deviceId":"b"}');
    await expect(service.getCurrentDevice()).rejects.toMatchObject({
      code: "bad_request",
      message: "No device ID configured",
      status: 400,
    });
  });

  test("falls back to legacy device id when sync identity cannot be parsed", async () => {
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_identity", "{not-json");
    secretService.entries.set("sync_device_id", "legacy-device");
    const requests: string[] = [];
    const service = createLocalDeviceSyncService({
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test" },
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
      fetch: async (input) => {
        requests.push(String(input));
        return Response.json({
          id: "legacy-device",
          userId: "user-1",
          displayName: "MacBook",
          platform: "mac",
          trustState: "trusted",
          createdAt: "2026-01-01T00:00:00Z",
        });
      },
    });

    await expect(service.getCurrentDevice()).resolves.toMatchObject({
      id: "legacy-device",
      userId: "user-1",
    });

    secretService.entries.set("sync_identity", '{"version":2.0,"deviceId":"device-1"}');
    await expect(service.getCurrentDevice()).resolves.toMatchObject({
      id: "legacy-device",
      userId: "user-1",
    });
    expect(requests).toEqual([
      "https://api.example.test/api/v1/sync/team/devices/legacy-device",
      "https://api.example.test/api/v1/sync/team/devices/legacy-device",
    ]);
  });

  test("reports sync identity preconditions for beginning pairing flow confirmation", async () => {
    const secretService = createMemorySecretService();
    const service = createLocalDeviceSyncService({
      secretService,
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
      fetch: async () => Response.json({ success: true, key_version: 2 }),
    });
    const request = { pairingId: "pairing-1", proof: "proof" };

    await expect(service.beginPairingConfirm?.(request)).rejects.toMatchObject({
      code: "internal_error",
      message: "No sync identity configured",
      status: 500,
    });

    secretService.entries.set("sync_identity", JSON.stringify({ version: 2, deviceId: null }));
    await expect(service.beginPairingConfirm?.(request)).rejects.toMatchObject({
      code: "internal_error",
      message: "No device ID configured",
      status: 500,
    });
  });

  test("returns success flow when beginning pairing confirmation has no local database", async () => {
    const secretService = createMemorySecretService();
    secretService.entries.set(
      "sync_identity",
      JSON.stringify({ version: 2, deviceNonce: "nonce-1", deviceId: "device-1" }),
    );
    secretService.entries.set("sync_device_id", "device-1");
    const noSessionService = createLocalDeviceSyncService({
      secretService,
      connectService: {
        restoreSyncSession: () => {
          throw Object.assign(new Error("No sync session configured"), {
            code: "forbidden",
            status: 403,
          });
        },
      },
    });
    await expect(
      noSessionService.beginPairingConfirm?.({ pairingId: "pairing-1", proof: "proof" }),
    ).rejects.toMatchObject({ code: "forbidden", status: 403 });

    const requests: Array<{ url: string; method: string; body: string | null; deviceId: string }> =
      [];
    const restoredService = createLocalDeviceSyncService({
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test/" },
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        requests.push({
          url: String(input),
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : null,
          deviceId: headers.get("x-wf-device-id") ?? "",
        });
        return Response.json({ success: true, key_version: 2 });
      },
    });
    const result = await restoredService.beginPairingConfirm?.({
      pairingId: "pairing-1",
      proof: "proof",
    });
    expect(result).toMatchObject({ phase: { phase: "success" } });
    expect(typeof (result as { flowId?: unknown })?.flowId).toBe("string");
    expect(requests).toEqual([
      {
        url: "https://api.example.test/api/v1/sync/team/devices/device-1/pairings/pairing-1/confirm",
        method: "POST",
        body: JSON.stringify({ proof: "proof" }),
        deviceId: "device-1",
      },
    ]);
  });
  test("returns success flow when pairing begin confirm needs no bootstrap", async () => {
    const db = new Database(":memory:");
    db.exec(`
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
      INSERT INTO sync_device_config (device_id, key_version, trust_state, last_bootstrap_at)
      VALUES ('device-1', 2, 'trusted', '2026-01-01T00:00:00Z');
      INSERT INTO sync_engine_state (id, lock_version, last_cycle_status) VALUES (1, 0, 'ok');
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set(
      "sync_identity",
      JSON.stringify({ version: 2, deviceNonce: "nonce-1", deviceId: "device-1" }),
    );
    secretService.entries.set("sync_device_id", "device-1");
    const service = createLocalDeviceSyncService({
      db,
      secretService,
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
      fetch: async () => Response.json({ success: true, key_version: 2 }),
    });

    try {
      await expect(
        service.beginPairingConfirm?.({ pairingId: "pairing-1", proof: "proof" }),
      ).resolves.toMatchObject({ phase: { phase: "success" } });
    } finally {
      db.close();
    }
  });

  test("returns overwrite flow when pairing begin confirm would replace local data", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE sync_device_config (
        device_id TEXT PRIMARY KEY NOT NULL,
        key_version INTEGER,
        trust_state TEXT NOT NULL DEFAULT 'untrusted',
        last_bootstrap_at TEXT,
        min_snapshot_created_at TEXT
      );
      CREATE TABLE accounts (id TEXT PRIMARY KEY NOT NULL);
      CREATE TABLE quotes (id TEXT PRIMARY KEY NOT NULL, source TEXT NOT NULL);
      INSERT INTO sync_device_config (device_id, key_version, trust_state, last_bootstrap_at)
      VALUES ('device-1', 2, 'untrusted', NULL);
      INSERT INTO accounts (id) VALUES ('account-1');
      INSERT INTO quotes (id, source) VALUES ('quote-1', 'MANUAL'), ('quote-2', 'YAHOO');
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set(
      "sync_identity",
      JSON.stringify({ version: 2, deviceNonce: "nonce-1", deviceId: "device-1" }),
    );
    secretService.entries.set("sync_device_id", "device-1");
    const requests: Array<{ url: string; method: string; body: string | null; deviceId: string }> =
      [];
    const service = createLocalDeviceSyncService({
      db,
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test/" },
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        requests.push({
          url: String(input),
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : null,
          deviceId: headers.get("x-wf-device-id") ?? "",
        });
        return Response.json({ success: true, key_version: 2 });
      },
    });

    try {
      const result = await service.beginPairingConfirm?.({
        pairingId: "pairing-1",
        proof: "proof",
      });
      expect(result).toMatchObject({
        phase: {
          phase: "overwrite_required",
          info: {
            localRows: 2,
            nonEmptyTables: [
              { table: "accounts", rows: 1 },
              { table: "quotes", rows: 1 },
            ],
          },
        },
      });
      expect(requests).toEqual([
        {
          url: "https://api.example.test/api/v1/sync/team/devices/device-1/pairings/pairing-1/confirm",
          method: "POST",
          body: JSON.stringify({ proof: "proof" }),
          deviceId: "device-1",
        },
      ]);

      const flowId = (result as { flowId: string }).flowId;
      await expect(service.getPairingFlowState?.({ flowId })).resolves.toEqual(result);
      await expect(service.cancelPairingFlow?.({ flowId })).resolves.toEqual({
        flowId,
        phase: { phase: "success" },
      });
      expect(requests).toEqual([
        {
          url: "https://api.example.test/api/v1/sync/team/devices/device-1/pairings/pairing-1/confirm",
          method: "POST",
          body: JSON.stringify({ proof: "proof" }),
          deviceId: "device-1",
        },
        {
          url: "https://api.example.test/api/v1/sync/team/devices/device-1/pairings/pairing-1/cancel",
          method: "POST",
          body: null,
          deviceId: "device-1",
        },
        {
          url: "https://api.example.test/api/v1/sync/team/devices/device-1",
          method: "DELETE",
          body: null,
          deviceId: "",
        },
      ]);
      await expect(service.getPairingFlowState?.({ flowId })).rejects.toMatchObject({
        code: "internal_error",
        message: "Flow not found",
        status: 500,
      });
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
        db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM sync_device_config").get()
          ?.count,
      ).toBe(0);
    } finally {
      db.close();
    }
  });

  test("approves overwrite flow while waiting for remote snapshot", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE sync_device_config (
        device_id TEXT PRIMARY KEY NOT NULL,
        key_version INTEGER,
        trust_state TEXT NOT NULL DEFAULT 'untrusted',
        last_bootstrap_at TEXT,
        min_snapshot_created_at TEXT
      );
      CREATE TABLE accounts (id TEXT PRIMARY KEY NOT NULL);
      INSERT INTO sync_device_config (device_id, key_version, trust_state, last_bootstrap_at)
      VALUES ('device-1', 2, 'untrusted', NULL);
      INSERT INTO accounts (id) VALUES ('account-1');
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set(
      "sync_identity",
      JSON.stringify({ version: 2, deviceNonce: "nonce-1", deviceId: "device-1" }),
    );
    secretService.entries.set("sync_device_id", "device-1");
    const requests: Array<{ url: string; method: string; body: string | null; deviceId: string }> =
      [];
    const service = createLocalDeviceSyncService({
      db,
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test/" },
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        requests.push({
          url: String(input),
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : null,
          deviceId: headers.get("x-wf-device-id") ?? "",
        });
        if (String(input).includes("/api/v1/sync/snapshots/latest")) {
          return Response.json(
            { code: "SNAPSHOT_NOT_FOUND", message: "not found" },
            { status: 404 },
          );
        }
        return Response.json({ success: true, key_version: 2 });
      },
    });

    try {
      const overwrite = await service.beginPairingConfirm?.({
        pairingId: "pairing-1",
        proof: "proof",
      });
      const flowId = (overwrite as { flowId: string }).flowId;

      await expect(service.approvePairingOverwrite?.({ flowId })).resolves.toEqual({
        flowId,
        phase: { phase: "syncing", detail: "waiting_snapshot" },
      });
      await expect(service.getPairingFlowState?.({ flowId })).resolves.toEqual({
        flowId,
        phase: { phase: "syncing", detail: "waiting_snapshot" },
      });
      await expect(service.approvePairingOverwrite?.({ flowId })).rejects.toMatchObject({
        code: "internal_error",
        message: "Flow is not in overwrite_required phase",
        status: 500,
      });
      expect(requests).toEqual([
        {
          url: "https://api.example.test/api/v1/sync/team/devices/device-1/pairings/pairing-1/confirm",
          method: "POST",
          body: JSON.stringify({ proof: "proof" }),
          deviceId: "device-1",
        },
        {
          url: "https://api.example.test/api/v1/sync/snapshots/latest",
          method: "GET",
          body: null,
          deviceId: "device-1",
        },
        {
          url: "https://api.example.test/api/v1/sync/snapshots/latest",
          method: "GET",
          body: null,
          deviceId: "device-1",
        },
      ]);

      requests.length = 0;
      await expect(
        service.confirmPairingWithBootstrap?.({
          pairingId: "pairing-1",
          proof: "proof",
          allowOverwrite: false,
        }),
      ).resolves.toEqual({
        status: "waiting_snapshot",
        message: "Snapshot is not available yet. Waiting for upload from a trusted device.",
        localRows: null,
        nonEmptyTables: null,
      });
      expect(requests).toEqual([
        {
          url: "https://api.example.test/api/v1/sync/team/devices/device-1/pairings/pairing-1/confirm",
          method: "POST",
          body: JSON.stringify({ proof: "proof" }),
          deviceId: "device-1",
        },
        {
          url: "https://api.example.test/api/v1/sync/snapshots/latest",
          method: "GET",
          body: null,
          deviceId: "device-1",
        },
      ]);
    } finally {
      db.close();
    }
  });

  test("ends approved waiting flow when remote snapshot appears before apply support", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE sync_device_config (
        device_id TEXT PRIMARY KEY NOT NULL,
        key_version INTEGER,
        trust_state TEXT NOT NULL DEFAULT 'untrusted',
        last_bootstrap_at TEXT,
        min_snapshot_created_at TEXT
      );
      CREATE TABLE accounts (id TEXT PRIMARY KEY NOT NULL);
      INSERT INTO sync_device_config (device_id, key_version, trust_state, last_bootstrap_at)
      VALUES ('device-1', 2, 'untrusted', NULL);
      INSERT INTO accounts (id) VALUES ('account-1');
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set(
      "sync_identity",
      JSON.stringify({ version: 2, deviceNonce: "nonce-1", deviceId: "device-1" }),
    );
    secretService.entries.set("sync_device_id", "device-1");
    let snapshotMissing = true;
    const service = createLocalDeviceSyncService({
      db,
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test/" },
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
      fetch: async (input) => {
        if (String(input).includes("/api/v1/sync/snapshots/latest")) {
          if (snapshotMissing) {
            return Response.json(
              { code: "SNAPSHOT_NOT_FOUND", message: "not found" },
              { status: 404 },
            );
          }
          return Response.json({
            snapshot_id: "snapshot-1",
            schema_version: 1,
            covers_tables: [],
            created_at: "2026-01-01T00:05:00Z",
            oplog_seq: 1,
            size_bytes: 0,
            checksum: "checksum-1",
          });
        }
        return Response.json({ success: true, key_version: 2 });
      },
    });

    try {
      const overwrite = await service.beginPairingConfirm?.({
        pairingId: "pairing-1",
        proof: "proof",
      });
      const flowId = (overwrite as { flowId: string }).flowId;
      await expect(service.approvePairingOverwrite?.({ flowId })).resolves.toEqual({
        flowId,
        phase: { phase: "syncing", detail: "waiting_snapshot" },
      });

      snapshotMissing = false;
      await expect(service.getPairingFlowState?.({ flowId })).resolves.toEqual({
        flowId,
        phase: { phase: "error", message: "Device sync feature is disabled in this build." },
      });
      await expect(service.getPairingFlowState?.({ flowId })).rejects.toMatchObject({
        code: "internal_error",
        message: "Flow not found",
        status: 500,
      });
      await expect(
        service.confirmPairingWithBootstrap?.({
          pairingId: "pairing-1",
          proof: "proof",
          allowOverwrite: false,
        }),
      ).resolves.toMatchObject({
        status: "overwrite_required",
        localRows: 1,
      });
    } finally {
      db.close();
    }
  });

  test("keeps approved waiting flow when latest snapshot misses freshness gate", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE sync_device_config (
        device_id TEXT PRIMARY KEY NOT NULL,
        key_version INTEGER,
        trust_state TEXT NOT NULL DEFAULT 'untrusted',
        last_bootstrap_at TEXT,
        min_snapshot_created_at TEXT
      );
      CREATE TABLE accounts (id TEXT PRIMARY KEY NOT NULL);
      INSERT INTO sync_device_config (device_id, key_version, trust_state, last_bootstrap_at)
      VALUES ('device-1', 2, 'untrusted', NULL);
      INSERT INTO accounts (id) VALUES ('account-1');
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set(
      "sync_identity",
      JSON.stringify({ version: 2, deviceNonce: "nonce-1", deviceId: "device-1" }),
    );
    secretService.entries.set("sync_device_id", "device-1");
    const service = createLocalDeviceSyncService({
      db,
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test/" },
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
      fetch: async (input) => {
        const url = String(input);
        if (url.includes("/api/v1/sync/events/cursor")) {
          return Response.json({ cursor: 2 });
        }
        if (url.includes("/api/v1/sync/snapshots/latest")) {
          return Response.json({
            snapshot_id: "snapshot-1",
            schema_version: 1,
            covers_tables: [],
            created_at: "2026-01-01T00:00:00Z",
            oplog_seq: 1,
            size_bytes: 0,
            checksum: "checksum-1",
          });
        }
        return Response.json({ success: true, key_version: 2 });
      },
    });

    try {
      const overwrite = await service.beginPairingConfirm?.({
        pairingId: "pairing-1",
        proof: "proof",
        minSnapshotCreatedAt: "2026-01-01T00:05:00Z",
      });
      const flowId = (overwrite as { flowId: string }).flowId;
      await expect(service.approvePairingOverwrite?.({ flowId })).resolves.toEqual({
        flowId,
        phase: { phase: "syncing", detail: "waiting_snapshot" },
      });
      await expect(service.getPairingFlowState?.({ flowId })).resolves.toEqual({
        flowId,
        phase: { phase: "syncing", detail: "waiting_snapshot" },
      });
      await expect(
        service.confirmPairingWithBootstrap?.({
          pairingId: "pairing-1",
          proof: "proof",
          allowOverwrite: false,
        }),
      ).resolves.toEqual({
        status: "waiting_snapshot",
        message: "Waiting for a snapshot generated after pairing confirmation",
        localRows: null,
        nonEmptyTables: null,
      });
    } finally {
      db.close();
    }
  });

  test("reports latest snapshot metadata preflight errors before pairing apply gate", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE sync_device_config (
        device_id TEXT PRIMARY KEY NOT NULL,
        key_version INTEGER,
        trust_state TEXT NOT NULL DEFAULT 'untrusted',
        last_bootstrap_at TEXT,
        min_snapshot_created_at TEXT
      );
      CREATE TABLE accounts (id TEXT PRIMARY KEY NOT NULL);
      INSERT INTO sync_device_config (device_id, key_version, trust_state, last_bootstrap_at)
      VALUES ('device-1', 2, 'untrusted', NULL);
      INSERT INTO accounts (id) VALUES ('account-1');
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set(
      "sync_identity",
      JSON.stringify({ version: 2, deviceNonce: "nonce-1", deviceId: "device-1" }),
    );
    secretService.entries.set("sync_device_id", "device-1");
    let snapshotResponse: Record<string, unknown> | string = {
      snapshot_id: "snapshot-1",
      schema_version: 2,
      covers_tables: [],
      created_at: "2026-01-01T00:05:00Z",
      oplog_seq: 1,
      size_bytes: 0,
      checksum: "checksum-1",
    };
    const service = createLocalDeviceSyncService({
      db,
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test/" },
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
      fetch: async (input) => {
        if (String(input).includes("/api/v1/sync/snapshots/latest")) {
          if (typeof snapshotResponse === "string") {
            return new Response(snapshotResponse, {
              headers: { "content-type": "application/json" },
            });
          }
          return Response.json(snapshotResponse);
        }
        return Response.json({ success: true, key_version: 2 });
      },
    });

    try {
      const overwrite = await service.beginPairingConfirm?.({
        pairingId: "pairing-1",
        proof: "proof",
      });
      const flowId = (overwrite as { flowId: string }).flowId;
      await expect(service.approvePairingOverwrite?.({ flowId })).resolves.toEqual({
        flowId,
        phase: {
          phase: "error",
          message:
            "Snapshot schema version 2 is newer than local version 1. Please update the app.",
        },
      });

      snapshotResponse = {
        snapshot_id: "",
        schema_version: 1,
        covers_tables: [],
        created_at: "2026-01-01T00:05:00Z",
        oplog_seq: 1,
        size_bytes: 0,
        checksum: "checksum-1",
      };
      await expect(
        service.confirmPairingWithBootstrap?.({
          pairingId: "pairing-2",
          proof: "proof",
          allowOverwrite: true,
        }),
      ).rejects.toThrow(
        "Latest snapshot metadata had empty snapshot_id. No valid snapshot available.",
      );

      snapshotResponse =
        '{"snapshot_id":"snapshot-1","schema_version":1.0,"covers_tables":[],"created_at":"2026-01-01T00:05:00Z","oplog_seq":1,"size_bytes":0,"checksum":"checksum-1"}';
      await expect(
        service.confirmPairingWithBootstrap?.({
          pairingId: "pairing-3",
          proof: "proof",
          allowOverwrite: true,
        }),
      ).rejects.toThrow("Failed to parse latest snapshot response");

      snapshotResponse =
        '{"snapshot_id":"snapshot-1","schema_version":1,"schemaVersion":1,"covers_tables":[],"created_at":"2026-01-01T00:05:00Z","oplog_seq":1e0,"size_bytes":0,"checksum":"checksum-1"}';
      await expect(
        service.confirmPairingWithBootstrap?.({
          pairingId: "pairing-4",
          proof: "proof",
          allowOverwrite: true,
        }),
      ).rejects.toThrow("Failed to parse latest snapshot response");

      snapshotResponse =
        '{"snapshot_id":"snapshot-1","schema_version":1,"covers_tables":[],"created_at":"2026-01-01T00:05:00Z","oplog_seq":1,"size_bytes":1.0,"checksum":"checksum-1"}';
      await expect(
        service.confirmPairingWithBootstrap?.({
          pairingId: "pairing-5",
          proof: "proof",
          allowOverwrite: true,
        }),
      ).rejects.toThrow("Failed to parse latest snapshot response");

      snapshotResponse = {
        snapshot_id: "snapshot-1",
        schema_version: 1,
        created_at: "2026-01-01T00:05:00Z",
        oplog_seq: 1,
        size_bytes: 0,
        checksum: "checksum-1",
      };
      await expect(
        service.confirmPairingWithBootstrap?.({
          pairingId: "pairing-6",
          proof: "proof",
          allowOverwrite: true,
        }),
      ).rejects.toThrow("Failed to parse latest snapshot response");
    } finally {
      db.close();
    }
  });

  test("removes pairing flow when cancel cleanup cannot update secrets", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE sync_device_config (
        device_id TEXT PRIMARY KEY NOT NULL,
        key_version INTEGER,
        trust_state TEXT NOT NULL DEFAULT 'untrusted',
        last_bootstrap_at TEXT,
        min_snapshot_created_at TEXT
      );
      CREATE TABLE accounts (id TEXT PRIMARY KEY NOT NULL);
      INSERT INTO sync_device_config (device_id, key_version, trust_state, last_bootstrap_at)
      VALUES ('device-1', 2, 'untrusted', NULL);
      INSERT INTO accounts (id) VALUES ('account-1');
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set(
      "sync_identity",
      JSON.stringify({ version: 2, deviceNonce: "nonce-1", deviceId: "device-1" }),
    );
    const service = createLocalDeviceSyncService({
      db,
      secretService: {
        ...secretService,
        setSecret() {
          throw new Error("keyring unavailable");
        },
      },
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
      fetch: async () => Response.json({ success: true, key_version: 2 }),
    });

    try {
      const result = (await service.beginPairingConfirm?.({
        pairingId: "pairing-1",
        proof: "proof",
      })) as { flowId: string };

      await expect(service.cancelPairingFlow?.({ flowId: result.flowId })).resolves.toEqual({
        flowId: result.flowId,
        phase: { phase: "success" },
      });
      await expect(service.getPairingFlowState?.({ flowId: result.flowId })).rejects.toMatchObject({
        code: "internal_error",
        message: "Flow not found",
        status: 500,
      });
    } finally {
      db.close();
    }
  });

  test("reports missing pairing flows and cancels missing flows locally", async () => {
    const service = createLocalDeviceSyncService({});

    await expect(service.getPairingFlowState?.({ flowId: "flow-1" })).rejects.toMatchObject({
      code: "internal_error",
      message: "Flow not found",
      status: 500,
    });
    await expect(service.approvePairingOverwrite?.({ flowId: "flow-1" })).rejects.toMatchObject({
      code: "internal_error",
      message: "Flow not found",
      status: 500,
    });
    await expect(service.cancelPairingFlow?.({ flowId: "flow-1" })).resolves.toEqual({
      flowId: "flow-1",
      phase: { phase: "success" },
    });
  });

  test("requires Connect session before listing devices", async () => {
    const service = createLocalDeviceSyncService({
      connectService: {
        restoreSyncSession: () => {
          throw Object.assign(new Error("No sync session configured"), {
            code: "forbidden",
            status: 403,
          });
        },
      },
    });

    await expect(service.listDevices()).rejects.toMatchObject({
      code: "forbidden",
      status: 403,
    });
  });

  test("lists devices from the cloud after restoring Connect session", async () => {
    const requests: Array<{ url: string; headers: Record<string, string> }> = [];
    const service = createLocalDeviceSyncService({
      env: { CONNECT_API_URL: "https://api.example.test/" },
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        requests.push({
          url: String(input),
          headers: {
            authorization: headers.get("authorization") ?? "",
            contentType: headers.get("content-type") ?? "",
            requestId: headers.get("x-wf-client-request-id") ?? "",
          },
        });
        return Response.json([
          {
            id: "device-1",
            user_id: "user-1",
            display_name: "MacBook",
            platform: "mac",
            trust_state: "trusted",
            trusted_key_version: 2,
            created_at: "2026-01-01T00:00:00Z",
            last_seen_at: null,
          },
        ]);
      },
    });

    await expect(service.listDevices("team")).resolves.toEqual([
      {
        id: "device-1",
        userId: "user-1",
        displayName: "MacBook",
        platform: "mac",
        devicePublicKey: null,
        trustState: "trusted",
        trustedKeyVersion: 2,
        osVersion: null,
        appVersion: null,
        lastSeenAt: null,
        createdAt: "2026-01-01T00:00:00Z",
      },
    ]);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://api.example.test/api/v1/sync/team/devices?scope=team");
    expect(requests[0]?.headers.authorization).toBe("Bearer token");
    expect(requests[0]?.headers.contentType).toBe("application/json");
    expect(requests[0]?.headers.requestId.startsWith("app:")).toBe(true);
  });

  test("maps device listing cloud failures to internal errors", async () => {
    const service = createLocalDeviceSyncService({
      env: { CONNECT_API_URL: "https://api.example.test" },
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
      fetch: async () =>
        Response.json(
          { code: "AUTH_EXPIRED", message: "expired" },
          { status: 403, headers: { "x-request-id": "server-request" } },
        ),
    });

    await expect(service.listDevices()).rejects.toMatchObject({
      code: "internal_error",
      message: expect.stringContaining("API error (403): AUTH_EXPIRED: expired"),
      status: 500,
    });

    const failingService = createLocalDeviceSyncService({
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
      fetch: async () => {
        throw new Error("network down");
      },
    });
    await expect(failingService.listDevices()).rejects.toMatchObject({
      code: "internal_error",
      message: "network down",
      status: 500,
    });
  });

  test("rejects malformed optional fields in cloud device listing", async () => {
    const service = createLocalDeviceSyncService({
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
      fetch: async () =>
        Response.json([
          {
            id: "device-1",
            user_id: "user-1",
            display_name: "MacBook",
            platform: "mac",
            trust_state: "trusted",
            created_at: "2026-01-01T00:00:00Z",
            last_seen_at: 123,
          },
        ]),
    });

    await expect(service.listDevices()).rejects.toMatchObject({
      code: "internal_error",
      message: "Failed to parse device response",
      status: 500,
    });
  });

  test("requires Connect session before device get, update, delete, and revoke", async () => {
    const service = createLocalDeviceSyncService({
      connectService: {
        restoreSyncSession: () => {
          throw Object.assign(new Error("No sync session configured"), {
            code: "forbidden",
            status: 403,
          });
        },
      },
    });

    await expect(service.getDevice("device-1")).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      service.updateDevice("device-1", { displayName: "Renamed" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(service.deleteDevice("device-1")).rejects.toMatchObject({ code: "forbidden" });
    await expect(service.revokeDevice("device-1")).rejects.toMatchObject({ code: "forbidden" });
  });

  test("runs device reads and mutations through cloud endpoints after session restore", async () => {
    const requests: Array<{ url: string; method: string; body: string | null }> = [];
    const service = createLocalDeviceSyncService({
      env: { CONNECT_API_URL: "https://api.example.test/" },
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
      fetch: async (input, init) => {
        requests.push({
          url: String(input),
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : null,
        });
        if (
          String(input).endsWith("/revoke") ||
          init?.method === "DELETE" ||
          init?.method === "PATCH"
        ) {
          return Response.json({ success: true });
        }
        return Response.json({
          id: "device-1",
          user_id: "user-1",
          display_name: "MacBook",
          platform: "mac",
          trust_state: "trusted",
          created_at: "2026-01-01T00:00:00Z",
        });
      },
    });

    await expect(service.getDevice("device-1")).resolves.toMatchObject({
      id: "device-1",
      userId: "user-1",
      displayName: "MacBook",
    });
    await expect(service.updateDevice("device-1", { displayName: "Renamed" })).resolves.toEqual({
      success: true,
    });
    await expect(service.deleteDevice("device-1")).resolves.toEqual({ success: true });
    await expect(service.revokeDevice("device-1")).resolves.toEqual({ success: true });
    expect(requests).toEqual([
      {
        url: "https://api.example.test/api/v1/sync/team/devices/device-1",
        method: "GET",
        body: null,
      },
      {
        url: "https://api.example.test/api/v1/sync/team/devices/device-1",
        method: "PATCH",
        body: JSON.stringify({ display_name: "Renamed" }),
      },
      {
        url: "https://api.example.test/api/v1/sync/team/devices/device-1",
        method: "DELETE",
        body: null,
      },
      {
        url: "https://api.example.test/api/v1/sync/team/devices/device-1/revoke",
        method: "POST",
        body: null,
      },
    ]);
  });

  test("reports missing device id for team key operations after session restore", async () => {
    const secretService = createMemorySecretService();
    const service = createLocalDeviceSyncService({
      secretService,
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
    });

    await expect(service.initializeTeamKeys?.()).rejects.toMatchObject({
      code: "bad_request",
      message: "No device ID configured",
      status: 400,
    });
    await expect(
      service.commitInitializeTeamKeys?.({
        keyVersion: 1,
        deviceKeyEnvelope: "envelope",
        signature: "signature",
      }),
    ).rejects.toMatchObject({ code: "bad_request" });
    await expect(service.rotateTeamKeys?.()).rejects.toMatchObject({ code: "bad_request" });
    await expect(
      service.commitRotateTeamKeys?.({
        newKeyVersion: 2,
        envelopes: [{ deviceId: "device-2", deviceKeyEnvelope: "envelope" }],
        signature: "signature",
      }),
    ).rejects.toMatchObject({ code: "bad_request" });
  });

  test("runs team key phase-one operations through cloud when device id is configured", async () => {
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_device_id", "device-1");
    const requests: Array<{
      url: string;
      method: string;
      body: string | null;
      deviceId: string;
      requestId: string;
    }> = [];
    const service = createLocalDeviceSyncService({
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test/" },
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        requests.push({
          url: String(input),
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : null,
          deviceId: headers.get("x-wf-device-id") ?? "",
          requestId: headers.get("x-wf-client-request-id") ?? "",
        });
        if (String(input).endsWith("/rotate")) {
          return Response.json({ challenge: "challenge", nonce: "nonce", new_key_version: 2 });
        }
        return Response.json({
          mode: "BOOTSTRAP",
          challenge: "challenge",
          nonce: "nonce",
          key_version: 1,
        });
      },
    });

    await expect(service.initializeTeamKeys?.()).resolves.toEqual({
      mode: "BOOTSTRAP",
      challenge: "challenge",
      nonce: "nonce",
      key_version: 1,
    });
    await expect(service.rotateTeamKeys?.()).resolves.toEqual({
      challenge: "challenge",
      nonce: "nonce",
      newKeyVersion: 2,
    });
    expect(
      requests.map((request) => ({
        url: request.url,
        method: request.method,
        body: request.body,
        deviceId: request.deviceId,
      })),
    ).toEqual([
      {
        url: "https://api.example.test/api/v1/sync/team/keys/initialize",
        method: "POST",
        body: JSON.stringify({ device_id: "device-1" }),
        deviceId: "device-1",
      },
      {
        url: "https://api.example.test/api/v1/sync/team/keys/rotate",
        method: "POST",
        body: JSON.stringify({ initiator_device_id: "device-1" }),
        deviceId: "device-1",
      },
    ]);
    expect(requests.map((request) => request.requestId)).toEqual([
      expect.stringMatching(/^device-1:/),
      expect.stringMatching(/^device-1:/),
    ]);

    let rotateBody = '{"challenge":"challenge","nonce":"nonce","new_key_version":2.0}';
    const malformedRotateService = createLocalDeviceSyncService({
      secretService,
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
      fetch: async () =>
        new Response(rotateBody, { headers: { "content-type": "application/json" } }),
    });
    await expect(malformedRotateService.rotateTeamKeys?.()).rejects.toMatchObject({
      code: "internal_error",
      message: "Failed to parse rotate keys response",
      status: 500,
    });

    rotateBody = '{"challenge":"challenge","nonce":"nonce","new_key_version":2,"newKeyVersion":2}';
    await expect(malformedRotateService.rotateTeamKeys?.()).rejects.toMatchObject({
      code: "internal_error",
      message: "Failed to parse rotate keys response",
      status: 500,
    });
  });

  test("preserves Rust initialize team key response field names", async () => {
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_device_id", "device-1");
    const responses = [
      {
        mode: "PAIRING_REQUIRED",
        e2ee_key_version: 3,
        require_sas: true,
        pairing_ttl_seconds: 300,
        trusted_devices: [{ id: "device-2", name: "iPhone", platform: "ios", last_seen_at: null }],
      },
      { mode: "READY", e2ee_key_version: 4 },
    ];
    const service = createLocalDeviceSyncService({
      secretService,
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
      fetch: async () => Response.json(responses.shift()),
    });

    await expect(service.initializeTeamKeys?.()).resolves.toEqual({
      mode: "PAIRING_REQUIRED",
      e2ee_key_version: 3,
      require_sas: true,
      pairing_ttl_seconds: 300,
      trusted_devices: [{ id: "device-2", name: "iPhone", platform: "ios", lastSeenAt: null }],
    });
    await expect(service.initializeTeamKeys?.()).resolves.toEqual({
      mode: "READY",
      e2ee_key_version: 4,
    });

    let initializeBody =
      '{"mode":"BOOTSTRAP","challenge":"challenge-1","nonce":"nonce-1","key_version":2.0}';
    const malformedService = createLocalDeviceSyncService({
      secretService,
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
      fetch: async () =>
        new Response(initializeBody, { headers: { "content-type": "application/json" } }),
    });
    await expect(malformedService.initializeTeamKeys?.()).rejects.toMatchObject({
      code: "internal_error",
      message: "Failed to parse initialize keys response",
      status: 500,
    });

    initializeBody =
      '{"mode":"PAIRING_REQUIRED","e2ee_key_version":3,"e2eeKeyVersion":3,"require_sas":true,"pairing_ttl_seconds":300,"trusted_devices":[]}';
    await expect(malformedService.initializeTeamKeys?.()).rejects.toMatchObject({
      code: "internal_error",
      message: "Failed to parse initialize keys response",
      status: 500,
    });

    initializeBody =
      '{"mode":"BOOTSTRAP","challenge":"challenge-1","challenge":"challenge-2","nonce":"nonce-1","key_version":2}';
    await expect(malformedService.initializeTeamKeys?.()).rejects.toMatchObject({
      code: "internal_error",
      message: "Failed to parse initialize keys response",
      status: 500,
    });
  });

  test("runs team key commit operations through cloud when device id is configured", async () => {
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_device_id", "device-1");
    const requests: Array<{ url: string; method: string; body: string | null; deviceId: string }> =
      [];
    const service = createLocalDeviceSyncService({
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test/" },
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        requests.push({
          url: String(input),
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : null,
          deviceId: headers.get("x-wf-device-id") ?? "",
        });
        if (String(input).endsWith("/rotate/commit")) {
          return Response.json({ success: true, key_version: 3 });
        }
        return Response.json({ success: true, key_state: "ACTIVE" });
      },
    });

    await expect(
      service.commitInitializeTeamKeys?.({
        keyVersion: 2,
        deviceKeyEnvelope: "envelope",
        signature: "signature",
        challengeResponse: "challenge",
        recoveryEnvelope: "recovery",
      }),
    ).resolves.toEqual({ success: true, keyState: "ACTIVE" });
    await expect(
      service.commitRotateTeamKeys?.({
        newKeyVersion: 3,
        envelopes: [{ deviceId: "device-2", deviceKeyEnvelope: "envelope-2" }],
        signature: "signature",
        challengeResponse: "challenge",
      }),
    ).resolves.toEqual({ success: true, keyVersion: 3 });
    expect(requests).toEqual([
      {
        url: "https://api.example.test/api/v1/sync/team/keys/initialize/commit",
        method: "POST",
        body: JSON.stringify({
          device_id: "device-1",
          key_version: 2,
          device_key_envelope: "envelope",
          signature: "signature",
          challenge_response: "challenge",
          recovery_envelope: "recovery",
        }),
        deviceId: "device-1",
      },
      {
        url: "https://api.example.test/api/v1/sync/team/keys/rotate/commit",
        method: "POST",
        body: JSON.stringify({
          new_key_version: 3,
          envelopes: [{ device_id: "device-2", device_key_envelope: "envelope-2" }],
          signature: "signature",
          challenge_response: "challenge",
        }),
        deviceId: "device-1",
      },
    ]);

    let commitInitializeBody = '{"success":true,"success":false,"key_state":"ACTIVE"}';
    const malformedCommitInitializeService = createLocalDeviceSyncService({
      secretService,
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
      fetch: async () =>
        new Response(commitInitializeBody, { headers: { "content-type": "application/json" } }),
    });
    await expect(
      malformedCommitInitializeService.commitInitializeTeamKeys?.({
        keyVersion: 2,
        deviceKeyEnvelope: "envelope",
        signature: "signature",
      }),
    ).rejects.toMatchObject({
      code: "internal_error",
      message: "Failed to parse commit initialize keys response",
      status: 500,
    });

    commitInitializeBody = '{"success":true,"key_state":"ACTIVE","keyState":"ACTIVE"}';
    await expect(
      malformedCommitInitializeService.commitInitializeTeamKeys?.({
        keyVersion: 2,
        deviceKeyEnvelope: "envelope",
        signature: "signature",
      }),
    ).rejects.toMatchObject({
      code: "internal_error",
      message: "Failed to parse commit initialize keys response",
      status: 500,
    });

    let commitRotateBody = '{"success":true,"key_version":3.0}';
    const malformedCommitRotateService = createLocalDeviceSyncService({
      secretService,
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
      fetch: async () =>
        new Response(commitRotateBody, { headers: { "content-type": "application/json" } }),
    });
    await expect(
      malformedCommitRotateService.commitRotateTeamKeys?.({
        newKeyVersion: 3,
        envelopes: [],
        signature: "signature",
      }),
    ).rejects.toMatchObject({
      code: "internal_error",
      message: "Failed to parse commit rotate keys response",
      status: 500,
    });

    commitRotateBody = '{"success":true,"key_version":3,"keyVersion":3}';
    await expect(
      malformedCommitRotateService.commitRotateTeamKeys?.({
        newKeyVersion: 3,
        envelopes: [],
        signature: "signature",
      }),
    ).rejects.toMatchObject({
      code: "internal_error",
      message: "Failed to parse commit rotate keys response",
      status: 500,
    });
  });

  test("requires Connect session before reset team sync and calls cloud after restore", async () => {
    const noSessionService = createLocalDeviceSyncService({
      connectService: {
        restoreSyncSession: () => {
          throw Object.assign(new Error("No sync session configured"), {
            code: "forbidden",
            status: 403,
          });
        },
      },
    });
    await expect(noSessionService.resetTeamSync?.({ reason: "test" })).rejects.toMatchObject({
      code: "forbidden",
      status: 403,
    });

    const requests: Array<{ url: string; method: string; body: string | null; deviceId: string }> =
      [];
    const restoredService = createLocalDeviceSyncService({
      env: { CONNECT_API_URL: "https://api.example.test/" },
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        requests.push({
          url: String(input),
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : null,
          deviceId: headers.get("x-wf-device-id") ?? "",
        });
        return Response.json({ success: true, key_version: 1, reset_at: "2026-01-01T00:00:00Z" });
      },
    });
    await expect(restoredService.resetTeamSync?.({ reason: "test" })).resolves.toEqual({
      success: true,
      keyVersion: 1,
      resetAt: "2026-01-01T00:00:00Z",
    });
    await expect(restoredService.resetTeamSync?.({})).resolves.toMatchObject({ success: true });
    expect(requests).toEqual([
      {
        url: "https://api.example.test/api/v1/sync/team/keys/reset",
        method: "POST",
        body: JSON.stringify({ reason: "test" }),
        deviceId: "",
      },
      {
        url: "https://api.example.test/api/v1/sync/team/keys/reset",
        method: "POST",
        body: JSON.stringify({}),
        deviceId: "",
      },
    ]);

    let resetBody = '{"success":true,"key_version":1.0,"reset_at":"2026-01-01T00:00:00Z"}';
    const malformedResetService = createLocalDeviceSyncService({
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
      fetch: async () =>
        new Response(resetBody, { headers: { "content-type": "application/json" } }),
    });
    await expect(malformedResetService.resetTeamSync?.({})).rejects.toMatchObject({
      code: "internal_error",
      message: "Failed to parse reset team sync response",
      status: 500,
    });

    resetBody = '{"success":true,"key_version":1,"keyVersion":1,"reset_at":null}';
    await expect(malformedResetService.resetTeamSync?.({})).rejects.toMatchObject({
      code: "internal_error",
      message: "Failed to parse reset team sync response",
      status: 500,
    });
  });

  test("reports missing device id for pairing operations after session restore", async () => {
    const secretService = createMemorySecretService();
    const service = createLocalDeviceSyncService({
      secretService,
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
    });

    await expect(
      service.createPairing?.({ codeHash: "hash", ephemeralPublicKey: "public-key" }),
    ).rejects.toMatchObject({ code: "bad_request", status: 400 });
    await expect(service.getPairing?.("pairing-1")).rejects.toMatchObject({
      code: "bad_request",
    });
    await expect(service.approvePairing?.("pairing-1")).rejects.toMatchObject({
      code: "bad_request",
    });
    await expect(
      service.completePairing?.("pairing-1", {
        encryptedKeyBundle: "bundle",
        sasProof: {},
        signature: "signature",
      }),
    ).rejects.toMatchObject({ code: "bad_request" });
    await expect(service.cancelPairing?.("pairing-1")).rejects.toMatchObject({
      code: "bad_request",
    });
    await expect(
      service.claimPairing?.({ code: "123456", ephemeralPublicKey: "public-key" }),
    ).rejects.toMatchObject({ code: "bad_request" });
    await expect(service.getPairingMessages?.("pairing-1")).rejects.toMatchObject({
      code: "bad_request",
    });
    await expect(service.confirmPairing?.("pairing-1", { proof: "proof" })).rejects.toMatchObject({
      code: "bad_request",
    });
  });

  test("runs issuer pairing operations through cloud when device id is configured", async () => {
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_device_id", "device-1");
    const requests: Array<{ url: string; method: string; body: string | null; deviceId: string }> =
      [];
    let pairingCompleteNotifications = 0;
    const service = createLocalDeviceSyncService({
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test/" },
      onPairingComplete: () => {
        pairingCompleteNotifications += 1;
        return new Promise(() => undefined);
      },
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        requests.push({
          url: String(input),
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : null,
          deviceId: headers.get("x-wf-device-id") ?? "",
        });
        const url = String(input);
        if (url.endsWith("/approve") || url.endsWith("/cancel")) {
          return Response.json({ success: true });
        }
        if (url.endsWith("/complete")) {
          return Response.json({ success: true, remote_seed_present: false });
        }
        if (init?.method === "POST") {
          return Response.json({
            pairing_id: "pairing-1",
            expires_at: "2026-01-01T00:00:00Z",
            key_version: 2,
            require_sas: true,
          });
        }
        return Response.json({
          pairing_id: "pairing-1",
          status: "open",
          claimer_device_id: null,
          claimer_ephemeral_pub: null,
          expires_at: "2026-01-01T00:00:00Z",
        });
      },
    });

    await expect(
      service.createPairing?.({ codeHash: "hash", ephemeralPublicKey: "public-key" }),
    ).resolves.toEqual({
      pairingId: "pairing-1",
      expiresAt: "2026-01-01T00:00:00Z",
      keyVersion: 2,
      requireSas: true,
    });
    await expect(service.getPairing?.("pairing-1")).resolves.toEqual({
      pairingId: "pairing-1",
      status: "open",
      claimerDeviceId: null,
      claimerEphemeralPub: null,
      expiresAt: "2026-01-01T00:00:00Z",
    });
    await expect(service.approvePairing?.("pairing-1")).resolves.toEqual({ success: true });
    await expect(
      service.completePairing?.("pairing-1", {
        encryptedKeyBundle: "bundle",
        sasProof: { ok: true },
        signature: "signature",
      }),
    ).resolves.toEqual({ success: true, remoteSeedPresent: false });
    expect(pairingCompleteNotifications).toBe(1);

    let createPairingBody =
      '{"pairing_id":"pairing-1","expires_at":"2026-01-01T00:00:00Z","key_version":2.0,"require_sas":true}';
    const malformedCreateService = createLocalDeviceSyncService({
      secretService,
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
      fetch: async () =>
        new Response(createPairingBody, { headers: { "content-type": "application/json" } }),
    });
    await expect(
      malformedCreateService.createPairing?.({
        codeHash: "hash",
        ephemeralPublicKey: "public-key",
      }),
    ).rejects.toMatchObject({
      code: "internal_error",
      message: "Failed to parse pairing response",
      status: 500,
    });

    createPairingBody =
      '{"pairing_id":"pairing-1","pairingId":"pairing-1","expires_at":"2026-01-01T00:00:00Z","key_version":2,"require_sas":true}';
    await expect(
      malformedCreateService.createPairing?.({
        codeHash: "hash",
        ephemeralPublicKey: "public-key",
      }),
    ).rejects.toMatchObject({
      code: "internal_error",
      message: "Failed to parse pairing response",
      status: 500,
    });

    const malformedCompleteService = createLocalDeviceSyncService({
      secretService,
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
      fetch: async () =>
        new Response('{"success":true,"remote_seed_present":false,"remoteSeedPresent":true}', {
          headers: { "content-type": "application/json" },
        }),
    });
    await expect(
      malformedCompleteService.completePairing?.("pairing-1", {
        encryptedKeyBundle: "bundle",
        sasProof: { ok: true },
        signature: "signature",
      }),
    ).rejects.toMatchObject({
      code: "internal_error",
      message: "Failed to parse complete pairing response",
      status: 500,
    });
    await expect(service.cancelPairing?.("pairing-1")).resolves.toEqual({ success: true });
    expect(requests).toEqual([
      {
        url: "https://api.example.test/api/v1/sync/team/devices/device-1/pairings",
        method: "POST",
        body: JSON.stringify({ code_hash: "hash", ephemeral_public_key: "public-key" }),
        deviceId: "device-1",
      },
      {
        url: "https://api.example.test/api/v1/sync/team/devices/device-1/pairings/pairing-1",
        method: "GET",
        body: null,
        deviceId: "device-1",
      },
      {
        url: "https://api.example.test/api/v1/sync/team/devices/device-1/pairings/pairing-1/approve",
        method: "POST",
        body: null,
        deviceId: "device-1",
      },
      {
        url: "https://api.example.test/api/v1/sync/team/devices/device-1/pairings/pairing-1/complete",
        method: "POST",
        body: JSON.stringify({
          encrypted_key_bundle: "bundle",
          sas_proof: { ok: true },
          signature: "signature",
        }),
        deviceId: "device-1",
      },
      {
        url: "https://api.example.test/api/v1/sync/team/devices/device-1/pairings/pairing-1/cancel",
        method: "POST",
        body: null,
        deviceId: "device-1",
      },
    ]);
  });

  test("runs claimer pairing operations through cloud when device id is configured", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE sync_device_config (
        device_id TEXT PRIMARY KEY NOT NULL,
        key_version INTEGER,
        trust_state TEXT NOT NULL DEFAULT 'untrusted',
        last_bootstrap_at TEXT,
        min_snapshot_created_at TEXT
      );
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_device_id", "device-1");
    const requests: Array<{ url: string; method: string; body: string | null; deviceId: string }> =
      [];
    const service = createLocalDeviceSyncService({
      db,
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test/" },
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        requests.push({
          url: String(input),
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : null,
          deviceId: headers.get("x-wf-device-id") ?? "",
        });
        if (String(input).endsWith("/messages")) {
          return Response.json({
            session_status: "approved",
            messages: [
              {
                id: "message-1",
                payload_type: "rk_transfer_v1",
                payload: "payload",
                created_at: "2026-01-01T00:00:00Z",
              },
            ],
          });
        }
        if (String(input).endsWith("/confirm")) {
          return Response.json({ success: true, key_version: 2, remote_seed_present: true });
        }
        return Response.json({
          session_id: "pairing-1",
          issuer_ephemeral_pub: "issuer-key",
          e2ee_key_version: 2,
          require_sas: true,
          expires_at: "2026-01-01T00:00:00Z",
        });
      },
    });

    try {
      await expect(
        service.claimPairing?.({ code: "123456", ephemeralPublicKey: "public-key" }),
      ).resolves.toEqual({
        sessionId: "pairing-1",
        issuerEphemeralPub: "issuer-key",
        e2eeKeyVersion: 2,
        requireSas: true,
        expiresAt: "2026-01-01T00:00:00Z",
      });
      let claimPairingBody =
        '{"session_id":"pairing-1","issuer_ephemeral_pub":"issuer-key","e2ee_key_version":2.0,"require_sas":true,"expires_at":"2026-01-01T00:00:00Z"}';
      const malformedClaimService = createLocalDeviceSyncService({
        secretService,
        connectService: {
          restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
        },
        fetch: async () =>
          new Response(claimPairingBody, { headers: { "content-type": "application/json" } }),
      });
      await expect(
        malformedClaimService.claimPairing?.({
          code: "123456",
          ephemeralPublicKey: "public-key",
        }),
      ).rejects.toMatchObject({
        code: "internal_error",
        message: "Failed to parse claim pairing response",
        status: 500,
      });

      claimPairingBody =
        '{"session_id":"pairing-1","sessionId":"pairing-1","issuer_ephemeral_pub":"issuer-key","e2ee_key_version":2,"require_sas":true,"expires_at":"2026-01-01T00:00:00Z"}';
      await expect(
        malformedClaimService.claimPairing?.({
          code: "123456",
          ephemeralPublicKey: "public-key",
        }),
      ).rejects.toMatchObject({
        code: "internal_error",
        message: "Failed to parse claim pairing response",
        status: 500,
      });
      await expect(service.getPairingMessages?.("pairing-1")).resolves.toEqual({
        sessionStatus: "approved",
        messages: [
          {
            id: "message-1",
            payloadType: "rk_transfer_v1",
            payload: "payload",
            createdAt: "2026-01-01T00:00:00Z",
          },
        ],
      });
      const malformedMessagesService = createLocalDeviceSyncService({
        secretService,
        connectService: {
          restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
        },
        fetch: async () =>
          new Response('{"session_status":"approved","sessionStatus":"approved","messages":[]}', {
            headers: { "content-type": "application/json" },
          }),
      });
      await expect(
        malformedMessagesService.getPairingMessages?.("pairing-1"),
      ).rejects.toMatchObject({
        code: "internal_error",
        message: "Failed to parse pairing messages response",
        status: 500,
      });
      const malformedNestedMessagesService = createLocalDeviceSyncService({
        secretService,
        connectService: {
          restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
        },
        fetch: async () =>
          new Response(
            '{"session_status":"approved","messages":[{"id":"message-1","payload_type":"rk_transfer_v1","payloadType":"rk_transfer_v1","payload":"payload","created_at":"2026-01-01T00:00:00Z"}]}',
            { headers: { "content-type": "application/json" } },
          ),
      });
      await expect(
        malformedNestedMessagesService.getPairingMessages?.("pairing-1"),
      ).rejects.toMatchObject({
        code: "internal_error",
        message: "Failed to parse pairing messages response",
        status: 500,
      });
      await expect(
        service.confirmPairing?.("pairing-1", {
          proof: "proof",
          minSnapshotCreatedAt: "2026-01-01 00:00:00.123456",
        }),
      ).resolves.toEqual({ success: true, keyVersion: 2, remoteSeedPresent: true });
      let confirmPairingBody = '{"success":true,"key_version":2.0,"remote_seed_present":true}';
      const malformedConfirmService = createLocalDeviceSyncService({
        db,
        secretService,
        connectService: {
          restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
        },
        fetch: async () =>
          new Response(confirmPairingBody, { headers: { "content-type": "application/json" } }),
      });
      await expect(
        malformedConfirmService.confirmPairing?.("pairing-1", {
          proof: "proof",
        }),
      ).rejects.toMatchObject({
        code: "internal_error",
        message: "Failed to parse confirm pairing response",
        status: 500,
      });

      confirmPairingBody =
        '{"success":true,"key_version":2,"keyVersion":2,"remote_seed_present":true}';
      await expect(
        malformedConfirmService.confirmPairing?.("pairing-1", {
          proof: "proof",
        }),
      ).rejects.toMatchObject({
        code: "internal_error",
        message: "Failed to parse confirm pairing response",
        status: 500,
      });
      expect(
        db
          .query<
            { min_snapshot_created_at: string | null },
            []
          >("SELECT min_snapshot_created_at FROM sync_device_config WHERE device_id = 'device-1'")
          .get(),
      ).toEqual({ min_snapshot_created_at: "2026-01-01T00:00:00.123Z" });
      expect(requests).toEqual([
        {
          url: "https://api.example.test/api/v1/sync/team/devices/device-1/pairings/claim",
          method: "POST",
          body: JSON.stringify({ code: "123456", ephemeral_public_key: "public-key" }),
          deviceId: "device-1",
        },
        {
          url: "https://api.example.test/api/v1/sync/team/devices/device-1/pairings/pairing-1/messages",
          method: "GET",
          body: null,
          deviceId: "device-1",
        },
        {
          url: "https://api.example.test/api/v1/sync/team/devices/device-1/pairings/pairing-1/confirm",
          method: "POST",
          body: JSON.stringify({ proof: "proof" }),
          deviceId: "device-1",
        },
      ]);
    } finally {
      db.close();
    }
  });

  test("ignores invalid min snapshot dates after confirming pairing", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE sync_device_config (
        device_id TEXT PRIMARY KEY NOT NULL,
        key_version INTEGER,
        trust_state TEXT NOT NULL DEFAULT 'untrusted',
        last_bootstrap_at TEXT,
        min_snapshot_created_at TEXT
      );
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_device_id", "device-1");
    const service = createLocalDeviceSyncService({
      db,
      secretService,
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
      fetch: async () => Response.json({ success: true, key_version: 2 }),
    });

    try {
      await expect(
        service.confirmPairing?.("pairing-1", {
          proof: "proof",
          minSnapshotCreatedAt: "2026-02-30T00:00:00Z",
        }),
      ).resolves.toEqual({ success: true, keyVersion: 2, remoteSeedPresent: null });
      expect(
        db
          .query<
            { min_snapshot_created_at: string | null },
            []
          >("SELECT min_snapshot_created_at FROM sync_device_config WHERE device_id = 'device-1'")
          .get(),
      ).toBeNull();
    } finally {
      db.close();
    }
  });

  test("reports sync identity preconditions for composite pairing operations", async () => {
    const secretService = createMemorySecretService();
    const service = createLocalDeviceSyncService({
      secretService,
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
    });
    const completeRequest = {
      pairingId: "pairing-1",
      encryptedKeyBundle: "bundle",
      sasProof: {},
      signature: "signature",
    };
    const confirmRequest = {
      pairingId: "pairing-1",
      allowOverwrite: false,
    };

    await expect(service.completePairingWithTransfer?.(completeRequest)).rejects.toMatchObject({
      code: "internal_error",
      message: "No sync identity configured",
      status: 500,
    });
    await expect(service.confirmPairingWithBootstrap?.(confirmRequest)).rejects.toMatchObject({
      code: "internal_error",
      message: "No sync identity configured",
      status: 500,
    });

    secretService.entries.set("sync_device_id", "legacy-device");
    await expect(service.completePairingWithTransfer?.(completeRequest)).rejects.toMatchObject({
      code: "internal_error",
      message: "No sync identity configured",
      status: 500,
    });

    secretService.entries.set(
      "sync_identity",
      JSON.stringify({ version: null, deviceId: "device-1" }),
    );
    await expect(service.completePairingWithTransfer?.(completeRequest)).rejects.toMatchObject({
      code: "internal_error",
      message: "No sync identity configured",
      status: 500,
    });

    secretService.entries.set(
      "sync_identity",
      JSON.stringify({ version: 2, deviceId: "device-1", keyVersion: 1.5 }),
    );
    await expect(service.completePairingWithTransfer?.(completeRequest)).rejects.toMatchObject({
      code: "internal_error",
      message: "No sync identity configured",
      status: 500,
    });

    secretService.entries.set("sync_identity", '{"version":2.0,"deviceId":"device-1"}');
    await expect(service.completePairingWithTransfer?.(completeRequest)).rejects.toMatchObject({
      code: "internal_error",
      message: "No sync identity configured",
      status: 500,
    });

    secretService.entries.set(
      "sync_identity",
      '{"version":2,"vers\\u0069on":2.0,"deviceId":"device-1"}',
    );
    await expect(service.completePairingWithTransfer?.(completeRequest)).rejects.toMatchObject({
      code: "internal_error",
      message: "No sync identity configured",
      status: 500,
    });

    secretService.entries.set(
      "sync_identity",
      '{"version":2,"keyVersion":1,"keyVersion":1e0,"deviceId":"device-1"}',
    );
    await expect(service.completePairingWithTransfer?.(completeRequest)).rejects.toMatchObject({
      code: "internal_error",
      message: "No sync identity configured",
      status: 500,
    });

    secretService.entries.set("sync_identity", '{"version":2,"version":3,"deviceId":"device-1"}');
    await expect(service.completePairingWithTransfer?.(completeRequest)).rejects.toMatchObject({
      code: "internal_error",
      message: "No sync identity configured",
      status: 500,
    });

    secretService.entries.set("sync_identity", '{"version":2,"deviceId":"a","deviceId":"b"}');
    await expect(service.completePairingWithTransfer?.(completeRequest)).rejects.toMatchObject({
      code: "internal_error",
      message: "No sync identity configured",
      status: 500,
    });

    secretService.entries.set("sync_identity", JSON.stringify({ version: 2, deviceId: null }));
    await expect(service.confirmPairingWithBootstrap?.(confirmRequest)).rejects.toMatchObject({
      code: "internal_error",
      message: "No device ID configured",
      status: 500,
    });

    const malformedGetService = createLocalDeviceSyncService({
      secretService,
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
      fetch: async () =>
        new Response(
          '{"pairing_id":"pairing-1","pairingId":"pairing-2","status":"open","claimer_device_id":null,"claimer_ephemeral_pub":null,"expires_at":"2026-01-01T00:00:00Z"}',
          { headers: { "content-type": "application/json" } },
        ),
    });
    await expect(malformedGetService.getPairing?.("pairing-1")).rejects.toMatchObject({
      code: "internal_error",
      message: "Failed to parse pairing response",
      status: 500,
    });
  });

  test("requires Connect session for composite pairing after sync identity is configured", async () => {
    const secretService = createMemorySecretService();
    secretService.entries.set(
      "sync_identity",
      JSON.stringify({ version: 2, deviceId: "device-1" }),
    );
    const service = createLocalDeviceSyncService({
      secretService,
      connectService: {
        restoreSyncSession: () => {
          throw Object.assign(new Error("No sync session configured"), {
            code: "forbidden",
            status: 403,
          });
        },
      },
    });

    await expect(
      service.completePairingWithTransfer?.({
        pairingId: "pairing-1",
        encryptedKeyBundle: "bundle",
        sasProof: {},
        signature: "signature",
      }),
    ).rejects.toMatchObject({ code: "forbidden", status: 403 });
  });

  test("completes composite pairing transfer after sync identity and session restore", async () => {
    const secretService = createMemorySecretService();
    secretService.entries.set(
      "sync_identity",
      JSON.stringify({ version: 2, deviceId: "device-1" }),
    );
    const requests: Array<{ url: string; method: string; body: string | null; deviceId: string }> =
      [];
    let pairingCompleteNotifications = 0;
    const service = createLocalDeviceSyncService({
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test/" },
      onPairingComplete: () => {
        pairingCompleteNotifications += 1;
      },
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        requests.push({
          url: String(input),
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : null,
          deviceId: headers.get("x-wf-device-id") ?? "",
        });
        return Response.json({ success: true, remote_seed_present: false });
      },
    });

    await expect(
      service.completePairingWithTransfer?.({
        pairingId: "pairing-1",
        encryptedKeyBundle: "bundle",
        sasProof: { ok: true },
        signature: "signature",
      }),
    ).resolves.toEqual({ success: true, remoteSeedPresent: false });
    expect(pairingCompleteNotifications).toBe(1);
    expect(requests).toEqual([
      {
        url: "https://api.example.test/api/v1/sync/team/devices/device-1/pairings/pairing-1/complete",
        method: "POST",
        body: JSON.stringify({
          encrypted_key_bundle: "bundle",
          sas_proof: { ok: true },
          signature: "signature",
        }),
        deviceId: "device-1",
      },
    ]);
  });

  test("returns already complete from bootstrap confirm when no local database exists", async () => {
    const secretService = createMemorySecretService();
    secretService.entries.set(
      "sync_identity",
      JSON.stringify({ version: 2, deviceId: "device-1" }),
    );
    const requests: Array<{ url: string; method: string; body: string | null; deviceId: string }> =
      [];
    const service = createLocalDeviceSyncService({
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test/" },
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        requests.push({
          url: String(input),
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : null,
          deviceId: headers.get("x-wf-device-id") ?? "",
        });
        return Response.json({ success: true, key_version: 2 });
      },
    });

    await expect(
      service.confirmPairingWithBootstrap?.({
        pairingId: "pairing-1",
        proof: "proof",
        allowOverwrite: false,
      }),
    ).resolves.toEqual({
      status: "already_complete",
      message: "No bootstrap needed",
      localRows: null,
      nonEmptyTables: null,
    });
    expect(requests).toEqual([
      {
        url: "https://api.example.test/api/v1/sync/team/devices/device-1/pairings/pairing-1/confirm",
        method: "POST",
        body: JSON.stringify({ proof: "proof" }),
        deviceId: "device-1",
      },
    ]);
  });

  test("returns already complete from composite confirm when bootstrap is not required", async () => {
    const db = new Database(":memory:");
    db.exec(`
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
      INSERT INTO sync_device_config (device_id, key_version, trust_state, last_bootstrap_at)
      VALUES ('device-1', 2, 'trusted', '2026-01-01T00:00:00Z');
      INSERT INTO sync_engine_state (id, lock_version, last_cycle_status) VALUES (1, 0, 'ok');
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set(
      "sync_identity",
      JSON.stringify({ version: 2, deviceId: "device-1" }),
    );
    const requests: Array<{ url: string; method: string; body: string | null; deviceId: string }> =
      [];
    const service = createLocalDeviceSyncService({
      db,
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test/" },
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        requests.push({
          url: String(input),
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : null,
          deviceId: headers.get("x-wf-device-id") ?? "",
        });
        return Response.json(
          { code: "PAIRING_ALREADY_CONFIRMED", message: "already confirmed" },
          { status: 409 },
        );
      },
    });

    try {
      await expect(
        service.confirmPairingWithBootstrap?.({
          pairingId: "pairing-1",
          proof: "proof",
          minSnapshotCreatedAt: "2026-01-01T00:00:00Z",
          allowOverwrite: false,
        }),
      ).resolves.toEqual({
        status: "already_complete",
        message: "No bootstrap needed",
        localRows: null,
        nonEmptyTables: null,
      });
      expect(requests).toEqual([
        {
          url: "https://api.example.test/api/v1/sync/team/devices/device-1/pairings/pairing-1/confirm",
          method: "POST",
          body: JSON.stringify({ proof: "proof" }),
          deviceId: "device-1",
        },
      ]);
    } finally {
      db.close();
    }
  });

  test("returns overwrite required from composite confirm before snapshot bootstrap", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE sync_device_config (
        device_id TEXT PRIMARY KEY NOT NULL,
        key_version INTEGER,
        trust_state TEXT NOT NULL DEFAULT 'untrusted',
        last_bootstrap_at TEXT,
        min_snapshot_created_at TEXT
      );
      CREATE TABLE accounts (id TEXT PRIMARY KEY NOT NULL);
      CREATE TABLE assets (id TEXT PRIMARY KEY NOT NULL, kind TEXT NOT NULL);
      CREATE TABLE quotes (id TEXT PRIMARY KEY NOT NULL, source TEXT NOT NULL);
      CREATE TABLE import_templates (id TEXT PRIMARY KEY NOT NULL, scope TEXT NOT NULL);
      INSERT INTO sync_device_config (device_id, key_version, trust_state, last_bootstrap_at)
      VALUES ('device-1', 2, 'untrusted', NULL);
      INSERT INTO accounts (id) VALUES ('account-1');
      INSERT INTO assets (id, kind) VALUES ('asset-1', 'PROPERTY'), ('asset-2', 'EQUITY');
      INSERT INTO quotes (id, source) VALUES ('quote-1', 'MANUAL'), ('quote-2', 'YAHOO');
      INSERT INTO import_templates (id, scope) VALUES ('template-1', 'USER'), ('template-2', 'SYSTEM');
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set(
      "sync_identity",
      JSON.stringify({ version: 2, deviceId: "device-1" }),
    );
    const requests: Array<{ url: string; method: string; body: string | null; deviceId: string }> =
      [];
    const service = createLocalDeviceSyncService({
      db,
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test/" },
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        requests.push({
          url: String(input),
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : null,
          deviceId: headers.get("x-wf-device-id") ?? "",
        });
        if (String(input).includes("/api/v1/sync/snapshots/latest")) {
          return Response.json(
            { code: "SNAPSHOT_NOT_FOUND", message: "not found" },
            { status: 404 },
          );
        }
        return Response.json({ success: true, key_version: 2 });
      },
    });

    try {
      await expect(
        service.confirmPairingWithBootstrap?.({
          pairingId: "pairing-1",
          proof: "proof",
          allowOverwrite: false,
        }),
      ).resolves.toEqual({
        status: "overwrite_required",
        message: "Local data (4 rows) will be replaced by remote snapshot",
        localRows: 4,
        nonEmptyTables: [
          { table: "accounts", rows: 1 },
          { table: "assets", rows: 1 },
          { table: "import_templates", rows: 1 },
          { table: "quotes", rows: 1 },
        ],
      });
      expect(requests).toEqual([
        {
          url: "https://api.example.test/api/v1/sync/team/devices/device-1/pairings/pairing-1/confirm",
          method: "POST",
          body: JSON.stringify({ proof: "proof" }),
          deviceId: "device-1",
        },
      ]);

      requests.length = 0;
      await expect(
        service.confirmPairingWithBootstrap?.({
          pairingId: "pairing-1",
          proof: "proof",
          allowOverwrite: true,
        }),
      ).resolves.toEqual({
        status: "waiting_snapshot",
        message: "Snapshot is not available yet. Waiting for upload from a trusted device.",
        localRows: null,
        nonEmptyTables: null,
      });
      expect(requests).toEqual([
        {
          url: "https://api.example.test/api/v1/sync/team/devices/device-1/pairings/pairing-1/confirm",
          method: "POST",
          body: JSON.stringify({ proof: "proof" }),
          deviceId: "device-1",
        },
        {
          url: "https://api.example.test/api/v1/sync/snapshots/latest",
          method: "GET",
          body: null,
          deviceId: "device-1",
        },
      ]);
    } finally {
      db.close();
    }
  });

  test("returns syncing flow when pairing begin confirm waits for remote snapshot", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE sync_device_config (
        device_id TEXT PRIMARY KEY NOT NULL,
        key_version INTEGER,
        trust_state TEXT NOT NULL DEFAULT 'untrusted',
        last_bootstrap_at TEXT,
        min_snapshot_created_at TEXT
      );
      INSERT INTO sync_device_config (device_id, key_version, trust_state, last_bootstrap_at)
      VALUES ('device-1', 2, 'untrusted', NULL);
    `);
    const secretService = createMemorySecretService();
    secretService.entries.set(
      "sync_identity",
      JSON.stringify({ version: 2, deviceNonce: "nonce-1", deviceId: "device-1" }),
    );
    secretService.entries.set("sync_device_id", "device-1");
    const requests: Array<{ url: string; method: string; body: string | null; deviceId: string }> =
      [];
    const service = createLocalDeviceSyncService({
      db,
      secretService,
      env: { CONNECT_API_URL: "https://api.example.test/" },
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        requests.push({
          url: String(input),
          method: init?.method ?? "GET",
          body: typeof init?.body === "string" ? init.body : null,
          deviceId: headers.get("x-wf-device-id") ?? "",
        });
        if (String(input).includes("/api/v1/sync/snapshots/latest")) {
          return Response.json(
            { code: "SNAPSHOT_NOT_FOUND", message: "not found" },
            { status: 404 },
          );
        }
        return Response.json({ success: true, key_version: 2 });
      },
    });

    try {
      const result = await service.beginPairingConfirm?.({
        pairingId: "pairing-1",
        proof: "proof",
      });
      expect(result).toMatchObject({
        phase: { phase: "syncing", detail: "waiting_snapshot" },
      });
      const flowId = (result as { flowId: string }).flowId;
      await expect(service.getPairingFlowState?.({ flowId })).resolves.toEqual(result);
      expect(requests).toEqual([
        {
          url: "https://api.example.test/api/v1/sync/team/devices/device-1/pairings/pairing-1/confirm",
          method: "POST",
          body: JSON.stringify({ proof: "proof" }),
          deviceId: "device-1",
        },
        {
          url: "https://api.example.test/api/v1/sync/snapshots/latest",
          method: "GET",
          body: null,
          deviceId: "device-1",
        },
        {
          url: "https://api.example.test/api/v1/sync/snapshots/latest",
          method: "GET",
          body: null,
          deviceId: "device-1",
        },
      ]);
    } finally {
      db.close();
    }
  });
});
