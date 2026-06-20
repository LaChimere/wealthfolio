import { describe, expect, test } from "bun:test";

import { createSyncCryptoService } from "./sync-crypto";

const sequentialKey = Uint8Array.from({ length: 32 }, (_, index) => index);
const sequentialKeyBase64 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";

describe("TS sync crypto domain", () => {
  test("generates 32-byte root keys and deterministic versioned DEKs", () => {
    const service = createSyncCryptoService({
      randomBytes: (size) => sequentialBytes(size),
    });

    expect(service.generateRootKey()).toEqual({ value: sequentialKeyBase64 });
    expect(service.deriveDek(sequentialKeyBase64, 7)).toEqual({
      value: "4gGTWUD77uIcjqYFJNuwUsBccvAtWCzCVfm3VywwTQA=",
    });
    expect(service.deriveDek(sequentialKeyBase64, 8)).not.toEqual(
      service.deriveDek(sequentialKeyBase64, 7),
    );
    expect(() => service.deriveDek(sequentialKeyBase64, 1.5)).toThrow(
      "version must be a u32 integer",
    );
    expect(() => service.deriveDek(sequentialKeyBase64, 4_294_967_296)).toThrow(
      "version must be a u32 integer",
    );
    expect(() => service.deriveDek("not-base64", 1)).toThrow("Invalid root key");
  });

  test("matches X25519 shared-secret vectors and derives session keys", () => {
    const service = createSyncCryptoService();
    const aliceSecret = hexToBase64(
      "77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a",
    );
    const bobPublic = hexToBase64(
      "de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f",
    );

    const shared = service.computeSharedSecret(aliceSecret, bobPublic);

    expect(shared).toEqual({
      value: hexToBase64("4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742"),
    });
    expect(service.deriveSessionKey(sequentialKeyBase64, "pairing")).toEqual({
      value: "RCP1RX7xj3ueTSVhhh1gs3qIVX633BLkqGRgqv6ybjg=",
    });
  });

  test("generates compatible X25519 keypairs and symmetric shared secrets", () => {
    const seeds = [new Uint8Array(32).fill(1), new Uint8Array(32).fill(2)];
    const service = createSyncCryptoService({
      randomBytes: (size) => {
        const seed = seeds.shift();
        if (!seed || seed.byteLength !== size) {
          throw new Error("unexpected random request");
        }
        return seed;
      },
    });

    const alice = service.generateKeypair();
    const bob = service.generateKeypair();

    expect(Buffer.from(alice.publicKey, "base64").byteLength).toBe(32);
    expect(Buffer.from(alice.secretKey, "base64").byteLength).toBe(32);
    expect(service.computeSharedSecret(alice.secretKey, bob.publicKey)).toEqual(
      service.computeSharedSecret(bob.secretKey, alice.publicKey),
    );
  });

  test("encrypts as nonce-prefixed XChaCha20-Poly1305 and decrypts UTF-8 plaintext", () => {
    const nonce = Uint8Array.from({ length: 24 }, (_, index) => index + 11);
    const service = createSyncCryptoService({
      randomBytes: (size) => {
        expect(size).toBe(24);
        return nonce;
      },
    });

    const encrypted = service.encrypt(sequentialKeyBase64, "hello 世界");
    const data = Buffer.from(encrypted.value, "base64");

    expect(data.subarray(0, 24)).toEqual(Buffer.from(nonce));
    expect(service.decrypt(sequentialKeyBase64, encrypted.value)).toEqual({ value: "hello 世界" });
    expect(() =>
      service.decrypt(Buffer.from(new Uint8Array(32).fill(9)).toString("base64"), encrypted.value),
    ).toThrow("Decryption failed - invalid key or corrupted data");
    expect(() => service.decrypt(sequentialKeyBase64, Buffer.alloc(12).toString("base64"))).toThrow(
      "Ciphertext too short",
    );
  });

  test("generates and hashes normalized pairing codes", () => {
    const values = [0, 1, 2, 3, 4, 31];
    const service = createSyncCryptoService({
      randomBytes: (size) => {
        expect(size).toBe(4);
        const buffer = Buffer.alloc(4);
        buffer.writeUInt32BE(values.shift() ?? 0, 0);
        return buffer;
      },
    });

    expect(service.generatePairingCode()).toEqual({ value: "ABCDE9" });
    expect(service.hashPairingCode("AbC 1-2-3")).toEqual({
      value: "e0bebd22819993425814866b62701e2919ea26f1370499c1037b53b9d49c2c8a",
    });
  });

  test("computes HMACs, SAS codes, and UUID device IDs", () => {
    const service = createSyncCryptoService({
      randomUuid: () => "550e8400-e29b-41d4-a716-446655440000",
    });

    expect(service.hmacSha256(sequentialKeyBase64, "hello")).toEqual({
      value: "53c40272a70c15ca4ee0af4df1f155fd6c41e00ce2307d8987ecd4bb36a7e990",
    });
    expect(service.computeSas(sequentialKeyBase64)).toEqual({ value: "982647" });
    expect(service.generateDeviceId()).toEqual({
      value: "550e8400-e29b-41d4-a716-446655440000",
    });
  });
});

function sequentialBytes(size: number): Uint8Array {
  return Uint8Array.from({ length: size }, (_, index) => index);
}

function hexToBase64(hex: string): string {
  return Buffer.from(hex, "hex").toString("base64");
}
