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
  });

  test("falls back to legacy device id when sync identity cannot be parsed", async () => {
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_identity", "{not-json");
    secretService.entries.set("sync_device_id", "legacy-device");
    const service = createLocalDeviceSyncService({
      secretService,
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
    });

    await expect(service.getCurrentDevice()).rejects.toMatchObject({
      code: "not_implemented",
      status: 501,
    });
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

  test("keeps device listing feature-gated after restoring Connect session", async () => {
    const service = createLocalDeviceSyncService({
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
    });

    await expect(service.listDevices()).rejects.toMatchObject({
      code: "not_implemented",
      status: 501,
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

  test("keeps device get, update, delete, and revoke feature-gated after session restore", async () => {
    const service = createLocalDeviceSyncService({
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
    });

    await expect(service.getDevice("device-1")).rejects.toMatchObject({ code: "not_implemented" });
    await expect(
      service.updateDevice("device-1", { displayName: "Renamed" }),
    ).rejects.toMatchObject({ code: "not_implemented" });
    await expect(service.deleteDevice("device-1")).rejects.toMatchObject({
      code: "not_implemented",
    });
    await expect(service.revokeDevice("device-1")).rejects.toMatchObject({
      code: "not_implemented",
    });
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

  test("keeps team key operations feature-gated when device id is configured", async () => {
    const secretService = createMemorySecretService();
    secretService.entries.set("sync_device_id", "device-1");
    const service = createLocalDeviceSyncService({
      secretService,
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
    });

    await expect(service.initializeTeamKeys?.()).rejects.toMatchObject({
      code: "not_implemented",
      status: 501,
    });
    await expect(service.rotateTeamKeys?.()).rejects.toMatchObject({ code: "not_implemented" });
  });

  test("requires Connect session before reset team sync and keeps it feature-gated after restore", async () => {
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

    const restoredService = createLocalDeviceSyncService({
      connectService: {
        restoreSyncSession: () => ({ accessToken: "token", refreshToken: "refresh" }),
      },
    });
    await expect(restoredService.resetTeamSync?.({ reason: "test" })).rejects.toMatchObject({
      code: "not_implemented",
      status: 501,
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
