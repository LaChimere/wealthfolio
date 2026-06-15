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
});
