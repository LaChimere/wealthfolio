import { describe, expect, test } from "bun:test";

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
  test("requires Connect session before device registration and keeps it feature-gated after restore", async () => {
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

    const restoredService = createLocalDeviceSyncService({
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
    });
    await expect(restoredService.registerDevice(request)).rejects.toMatchObject({
      code: "not_implemented",
      status: 501,
    });
  });

  test("reports missing current device id after restoring Connect session", async () => {
    const secretService = createMemorySecretService();
    const service = createLocalDeviceSyncService({
      secretService,
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
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

  test("keeps beginning pairing flow confirmation feature-gated after prerequisites", async () => {
    const secretService = createMemorySecretService();
    secretService.entries.set(
      "sync_identity",
      JSON.stringify({ version: 2, deviceId: "device-1" }),
    );
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

    const restoredService = createLocalDeviceSyncService({
      secretService,
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
    });
    await expect(
      restoredService.beginPairingConfirm?.({ pairingId: "pairing-1", proof: "proof" }),
    ).rejects.toMatchObject({ code: "not_implemented", status: 501 });
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
    expect(service.cancelPairingFlow?.({ flowId: "flow-1" })).toEqual({
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

  test("keeps pairing operations feature-gated when device id is configured", async () => {
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_device_id", "device-1");
    const service = createLocalDeviceSyncService({
      secretService,
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
    });

    await expect(
      service.createPairing?.({ codeHash: "hash", ephemeralPublicKey: "public-key" }),
    ).rejects.toMatchObject({ code: "not_implemented", status: 501 });
    await expect(service.getPairing?.("pairing-1")).rejects.toMatchObject({
      code: "not_implemented",
    });
    await expect(service.confirmPairing?.("pairing-1", { proof: "proof" })).rejects.toMatchObject({
      code: "not_implemented",
    });
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

  test("keeps composite pairing feature-gated after sync identity and session restore", async () => {
    const secretService = createMemorySecretService();
    secretService.entries.set(
      "sync_identity",
      JSON.stringify({ version: 2, deviceId: "device-1" }),
    );
    const service = createLocalDeviceSyncService({
      secretService,
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
    });

    await expect(
      service.completePairingWithTransfer?.({
        pairingId: "pairing-1",
        encryptedKeyBundle: "bundle",
        sasProof: {},
        signature: "signature",
      }),
    ).rejects.toMatchObject({ code: "not_implemented", status: 501 });
    await expect(
      service.confirmPairingWithBootstrap?.({
        pairingId: "pairing-1",
        allowOverwrite: false,
      }),
    ).rejects.toMatchObject({ code: "not_implemented", status: 501 });
  });
});
