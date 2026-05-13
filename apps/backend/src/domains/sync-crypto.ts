import { createHash, createHmac, hkdfSync, randomBytes, randomUUID } from "node:crypto";

import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";

export interface SyncCryptoStringResponse {
  value: string;
}

export interface SyncCryptoEphemeralKeyPair {
  publicKey: string;
  secretKey: string;
}

export interface SyncCryptoService {
  generateRootKey(): Promise<SyncCryptoStringResponse> | SyncCryptoStringResponse;
  deriveDek(
    rootKey: string,
    version: number,
  ): Promise<SyncCryptoStringResponse> | SyncCryptoStringResponse;
  generateKeypair(): Promise<SyncCryptoEphemeralKeyPair> | SyncCryptoEphemeralKeyPair;
  computeSharedSecret(
    ourSecret: string,
    theirPublic: string,
  ): Promise<SyncCryptoStringResponse> | SyncCryptoStringResponse;
  deriveSessionKey(
    sharedSecret: string,
    context: string,
  ): Promise<SyncCryptoStringResponse> | SyncCryptoStringResponse;
  encrypt(
    key: string,
    plaintext: string,
  ): Promise<SyncCryptoStringResponse> | SyncCryptoStringResponse;
  decrypt(
    key: string,
    ciphertext: string,
  ): Promise<SyncCryptoStringResponse> | SyncCryptoStringResponse;
  generatePairingCode(): Promise<SyncCryptoStringResponse> | SyncCryptoStringResponse;
  hashPairingCode(code: string): Promise<SyncCryptoStringResponse> | SyncCryptoStringResponse;
  hmacSha256(
    key: string,
    data: string,
  ): Promise<SyncCryptoStringResponse> | SyncCryptoStringResponse;
  computeSas(sharedSecret: string): Promise<SyncCryptoStringResponse> | SyncCryptoStringResponse;
  generateDeviceId(): Promise<SyncCryptoStringResponse> | SyncCryptoStringResponse;
}

export interface SyncCryptoServiceOptions {
  randomBytes?: (size: number) => Uint8Array;
  randomUuid?: () => string;
}

const KEY_SIZE = 32;
const NONCE_SIZE = 24;
const PAIRING_CODE_LENGTH = 6;
const PAIRING_CODE_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const UTF8_ENCODER = new TextEncoder();

export function createSyncCryptoService(options: SyncCryptoServiceOptions = {}): SyncCryptoService {
  const secureRandomBytes = options.randomBytes ?? randomBytes;
  const secureRandomUuid = options.randomUuid ?? randomUUID;

  function nextBytes(size: number, label: string): Uint8Array {
    const bytes = secureRandomBytes(size);
    if (bytes.byteLength !== size) {
      throw new Error(`${label} source must return exactly ${size} bytes`);
    }
    return bytes;
  }

  return {
    generateRootKey() {
      return { value: encodeBase64(nextBytes(KEY_SIZE, "Root key")) };
    },

    deriveDek(rootKey, version) {
      const rootKeyBytes = decodeBase64Bytes(rootKey, "root key", KEY_SIZE);
      const dek = hkdfSha256(rootKeyBytes, textBytes(`v${version}`), textBytes("wealthfolio-dek"));
      return { value: encodeBase64(dek) };
    },

    generateKeypair() {
      const secretKey = nextBytes(KEY_SIZE, "X25519 secret key");
      const publicKey = x25519.getPublicKey(secretKey);
      return {
        publicKey: encodeBase64(publicKey),
        secretKey: encodeBase64(secretKey),
      };
    },

    computeSharedSecret(ourSecret, theirPublic) {
      const secretKey = decodeBase64Bytes(ourSecret, "secret key", KEY_SIZE);
      const publicKey = decodeBase64Bytes(theirPublic, "public key", KEY_SIZE);
      return { value: encodeBase64(x25519.getSharedSecret(secretKey, publicKey)) };
    },

    deriveSessionKey(sharedSecret, context) {
      const sharedSecretBytes = decodeBase64Bytes(sharedSecret, "shared secret");
      const sessionKey = hkdfSha256(
        sharedSecretBytes,
        new Uint8Array(),
        textBytes(`wealthfolio-session-${context}`),
      );
      return { value: encodeBase64(sessionKey) };
    },

    encrypt(key, plaintext) {
      const keyBytes = decodeBase64Bytes(key, "key", KEY_SIZE);
      const nonce = nextBytes(NONCE_SIZE, "XChaCha20-Poly1305 nonce");
      const ciphertext = xchacha20poly1305(keyBytes, nonce).encrypt(textBytes(plaintext));
      return { value: encodeBase64(concatBytes(nonce, ciphertext)) };
    },

    decrypt(key, ciphertext) {
      const keyBytes = decodeBase64Bytes(key, "key", KEY_SIZE);
      const data = decodeBase64Bytes(ciphertext, "ciphertext");
      if (data.byteLength < NONCE_SIZE) {
        throw new Error("Ciphertext too short");
      }
      const nonce = data.slice(0, NONCE_SIZE);
      const encrypted = data.slice(NONCE_SIZE);
      let plaintext: Uint8Array;
      try {
        plaintext = xchacha20poly1305(keyBytes, nonce).decrypt(encrypted);
      } catch {
        throw new Error("Decryption failed - invalid key or corrupted data");
      }

      try {
        return { value: UTF8_DECODER.decode(plaintext) };
      } catch (error) {
        throw new Error(
          `Invalid UTF-8 in plaintext: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },

    generatePairingCode() {
      let code = "";
      for (let index = 0; index < PAIRING_CODE_LENGTH; index += 1) {
        const randomValue = Buffer.from(nextBytes(4, "Pairing code")).readUInt32BE(0);
        code += PAIRING_CODE_CHARSET[randomValue % PAIRING_CODE_CHARSET.length];
      }
      return { value: code };
    },

    hashPairingCode(code) {
      const normalized = code.toUpperCase().replaceAll(/[^A-Z0-9]/g, "");
      return { value: createHash("sha256").update(normalized, "utf8").digest("hex") };
    },

    hmacSha256(key, data) {
      const keyBytes = decodeBase64Bytes(key, "HMAC key");
      return { value: createHmac("sha256", keyBytes).update(data, "utf8").digest("hex") };
    },

    computeSas(sharedSecret) {
      const sharedSecretBytes = decodeBase64Bytes(sharedSecret, "shared secret");
      const sasBytes = hkdfSha256(
        sharedSecretBytes,
        new Uint8Array(),
        textBytes("wealthfolio-sas"),
        4,
      );
      const value = Buffer.from(sasBytes).readUInt32BE(0) % 1_000_000;
      return { value: value.toString().padStart(6, "0") };
    },

    generateDeviceId() {
      return { value: secureRandomUuid() };
    },
  };
}

function hkdfSha256(
  inputKeyMaterial: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length = KEY_SIZE,
): Uint8Array {
  return new Uint8Array(hkdfSync("sha256", inputKeyMaterial, salt, info, length));
}

function decodeBase64Bytes(input: string, label: string, expectedLength?: number): Uint8Array {
  if (!BASE64_PATTERN.test(input)) {
    throw new Error(`Invalid ${label}: invalid base64`);
  }

  const bytes = Buffer.from(input, "base64");
  if (expectedLength !== undefined && bytes.byteLength !== expectedLength) {
    throw new Error(
      `${capitalize(label)} must be ${expectedLength} bytes, got ${bytes.byteLength}`,
    );
  }

  return new Uint8Array(bytes);
}

function encodeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function textBytes(value: string): Uint8Array {
  return UTF8_ENCODER.encode(value);
}

function concatBytes(first: Uint8Array, second: Uint8Array): Uint8Array {
  const result = new Uint8Array(first.byteLength + second.byteLength);
  result.set(first);
  result.set(second, first.byteLength);
  return result;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
