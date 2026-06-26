import { afterEach, describe, expect, it, vi } from "vitest";

import {
  syncComputeSharedSecret,
  syncEncrypt,
  syncGenerateKeypair,
  syncGenerateRootKey,
} from "./crypto";
import { invoke } from "./core";

vi.mock("./core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

afterEach(() => {
  vi.clearAllMocks();
});

describe("web sync crypto adapter", () => {
  it("delegates string-returning crypto commands through the web command registry", async () => {
    invokeMock
      .mockResolvedValueOnce({ value: "root-key" })
      .mockResolvedValueOnce({ value: "shared-secret" })
      .mockResolvedValueOnce({ value: "ciphertext" });

    await expect(syncGenerateRootKey()).resolves.toBe("root-key");
    await expect(syncComputeSharedSecret("secret", "public")).resolves.toBe("shared-secret");
    await expect(syncEncrypt("key", "plaintext")).resolves.toBe("ciphertext");
    expect(invokeMock).toHaveBeenNthCalledWith(1, "sync_generate_root_key");
    expect(invokeMock).toHaveBeenNthCalledWith(2, "sync_compute_shared_secret", {
      ourSecret: "secret",
      theirPublic: "public",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "sync_encrypt", {
      key: "key",
      plaintext: "plaintext",
    });
  });

  it("delegates keypair commands without unwrapping value fields", async () => {
    const keypair = { publicKey: "public", secretKey: "secret" };
    invokeMock.mockResolvedValueOnce(keypair);

    await expect(syncGenerateKeypair()).resolves.toBe(keypair);
    expect(invokeMock).toHaveBeenCalledWith("sync_generate_keypair");
  });
});
