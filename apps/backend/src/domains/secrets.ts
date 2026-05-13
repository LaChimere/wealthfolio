import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { hkdfSync, randomBytes } from "node:crypto";

import { chacha20poly1305 } from "@noble/ciphers/chacha.js";

export interface SecretService {
  setSecret(secretKey: string, secret: string): Promise<void> | void;
  getSecret(secretKey: string): Promise<string | null> | string | null;
  deleteSecret(secretKey: string): Promise<void> | void;
}

export interface FileSecretServiceOptions {
  secretsFilePath: string;
  encryptionKey?: Uint8Array;
  rawKeyForMigration?: Uint8Array;
  randomBytes?: (length: number) => Uint8Array;
}

export const SECRET_SERVICE_PREFIX = "wealthfolio_";

const CURRENT_VERSION = 1;
const CHACHA20_POLY1305_NONCE_LENGTH = 12;

interface PlainSecrets {
  version: number;
  secrets: Record<string, string>;
}

interface EncryptedSecrets {
  version: number;
  nonce: string;
  ciphertext: string;
}

export function createFileSecretService(options: FileSecretServiceOptions): SecretService {
  const filePath = options.secretsFilePath;
  const encryptionKey = normalizeEncryptionKey(options.encryptionKey, "encryptionKey");
  const rawKeyForMigration = normalizeEncryptionKey(
    options.rawKeyForMigration,
    "rawKeyForMigration",
  );
  migrateRawKeySecretsIfNeeded(filePath, encryptionKey, rawKeyForMigration, options.randomBytes);

  return {
    setSecret(secretKey, secret) {
      const store = loadSecretStore(filePath, encryptionKey);
      store[formatSecretServiceId(secretKey)] = secret;
      persistSecretStore(filePath, encryptionKey, store, options.randomBytes);
    },
    getSecret(secretKey) {
      const store = loadSecretStore(filePath, encryptionKey);
      return store[formatSecretServiceId(secretKey)] ?? null;
    },
    deleteSecret(secretKey) {
      const store = loadSecretStore(filePath, encryptionKey);
      delete store[formatSecretServiceId(secretKey)];
      persistSecretStore(filePath, encryptionKey, store, options.randomBytes);
    },
  };
}

export function deriveSecretsEncryptionKey(masterKey: Uint8Array): Uint8Array {
  return new Uint8Array(
    hkdfSync("sha256", Buffer.from(masterKey), Buffer.alloc(0), "wealthfolio-secrets", 32),
  );
}

export function formatSecretServiceId(service: string): string {
  return `${SECRET_SERVICE_PREFIX}${service.toLowerCase()}`;
}

function migrateRawKeySecretsIfNeeded(
  filePath: string,
  encryptionKey: Buffer | undefined,
  rawKeyForMigration: Buffer | undefined,
  randomByteSource: ((length: number) => Uint8Array) | undefined,
): void {
  if (!existsSync(filePath) || !encryptionKey || !rawKeyForMigration) {
    return;
  }

  try {
    loadSecretStore(filePath, encryptionKey);
    return;
  } catch {
    // Match the Rust runtime: a derived-key failure may indicate a legacy raw-key file.
  }

  let migrated: Record<string, string>;
  try {
    migrated = loadSecretStore(filePath, rawKeyForMigration);
  } catch {
    // Rust construction also succeeds when neither key can decrypt; the first read surfaces it.
    return;
  }
  persistSecretStore(filePath, encryptionKey, migrated, randomByteSource);
}

function loadSecretStore(
  filePath: string,
  encryptionKey: Buffer | undefined,
): Record<string, string> {
  if (!existsSync(filePath)) {
    return {};
  }

  const raw = readFileSync(filePath);
  if (raw.length === 0) {
    return {};
  }

  const parsed = JSON.parse(raw.toString("utf8")) as unknown;
  if (isRecord(parsed) && "ciphertext" in parsed) {
    if (!encryptionKey) {
      throw new Error("WF_SECRET_KEY must be set to decrypt the secrets file");
    }
    return decryptSecretStore(parseEncryptedSecrets(parsed), encryptionKey);
  }

  return parsePlainSecrets(parsed).secrets;
}

function persistSecretStore(
  filePath: string,
  encryptionKey: Buffer | undefined,
  secrets: Record<string, string>,
  randomByteSource: ((length: number) => Uint8Array) | undefined,
): void {
  const plain: PlainSecrets = { version: CURRENT_VERSION, secrets };
  const persisted = encryptionKey
    ? encryptSecretStore(plain, encryptionKey, randomByteSource)
    : plain;
  writeSecretFileAtomically(filePath, JSON.stringify(persisted, null, 2));
}

function encryptSecretStore(
  plain: PlainSecrets,
  encryptionKey: Buffer,
  randomByteSource: ((length: number) => Uint8Array) | undefined,
): EncryptedSecrets {
  const nonce = Buffer.from(
    randomByteSource?.(CHACHA20_POLY1305_NONCE_LENGTH) ??
      randomBytes(CHACHA20_POLY1305_NONCE_LENGTH),
  );
  if (nonce.length !== CHACHA20_POLY1305_NONCE_LENGTH) {
    throw new Error("Secret nonce source must return exactly 12 bytes");
  }

  const ciphertext = chacha20poly1305(encryptionKey, nonce).encrypt(
    new TextEncoder().encode(JSON.stringify(plain)),
  );

  return {
    version: CURRENT_VERSION,
    nonce: nonce.toString("base64"),
    ciphertext: Buffer.from(ciphertext).toString("base64"),
  };
}

function decryptSecretStore(
  encrypted: EncryptedSecrets,
  encryptionKey: Buffer,
): Record<string, string> {
  const nonce = decodeBase64(encrypted.nonce, "nonce");
  if (nonce.length !== CHACHA20_POLY1305_NONCE_LENGTH) {
    throw new Error("Failed to decrypt secrets file: invalid nonce length");
  }
  const ciphertextAndTag = decodeBase64(encrypted.ciphertext, "ciphertext");
  if (ciphertextAndTag.length < 16) {
    throw new Error("Failed to decrypt secrets file: ciphertext is too short");
  }

  try {
    const plaintext = chacha20poly1305(encryptionKey, nonce).decrypt(ciphertextAndTag);
    return parsePlainSecrets(JSON.parse(new TextDecoder().decode(plaintext))).secrets;
  } catch {
    throw new Error("Failed to decrypt secrets file");
  }
}

function writeSecretFileAtomically(filePath: string, content: string): void {
  const parent = path.dirname(filePath);
  mkdirSync(parent, { recursive: true });
  const tempPath = path.join(
    parent,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${randomBytes(6).toString("hex")}.tmp`,
  );
  try {
    writeFileSync(tempPath, content, { mode: 0o600 });
    renameSync(tempPath, filePath);
  } catch (error) {
    try {
      unlinkSync(tempPath);
    } catch {
      // Ignore cleanup errors and surface the original write failure.
    }
    throw error;
  }
}

function parsePlainSecrets(value: unknown): PlainSecrets {
  if (!isRecord(value)) {
    throw new Error("Invalid secrets file");
  }
  if (typeof value.version !== "number") {
    throw new Error("Invalid secrets file version");
  }
  if (!isRecord(value.secrets)) {
    throw new Error("Invalid secrets map");
  }

  const secrets: Record<string, string> = {};
  for (const [key, secret] of Object.entries(value.secrets)) {
    if (typeof secret !== "string") {
      throw new Error(`Invalid secret value for ${key}`);
    }
    secrets[key] = secret;
  }
  return { version: value.version, secrets };
}

function parseEncryptedSecrets(value: Record<string, unknown>): EncryptedSecrets {
  if (typeof value.version !== "number") {
    throw new Error("Invalid secrets file version");
  }
  if (typeof value.nonce !== "string") {
    throw new Error("Invalid secrets file nonce");
  }
  if (typeof value.ciphertext !== "string") {
    throw new Error("Invalid secrets file ciphertext");
  }
  return { version: value.version, nonce: value.nonce, ciphertext: value.ciphertext };
}

function normalizeEncryptionKey(key: Uint8Array | undefined, name: string): Buffer | undefined {
  if (key === undefined) {
    return undefined;
  }
  if (key.length !== 32) {
    throw new Error(`${name} must contain exactly 32 bytes`);
  }
  return Buffer.from(key);
}

function decodeBase64(value: string, field: string): Buffer {
  if (value.length % 4 !== 0 || !/^[+/0-9A-Za-z]*={0,2}$/.test(value)) {
    throw new Error(`Failed to decode ${field}`);
  }
  return Buffer.from(value, "base64");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
