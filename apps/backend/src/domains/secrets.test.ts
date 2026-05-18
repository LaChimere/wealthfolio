import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import {
  createFileSecretService,
  createKeyringSecretService,
  deriveSecretsEncryptionKey,
  formatDesktopSecretServiceId,
  formatSecretServiceId,
  type KeyringEntryFactory,
} from "./secrets";

const rawKey = new Uint8Array(32).fill(7);
const derivedKey = deriveSecretsEncryptionKey(rawKey);

describe("TS secrets domain", () => {
  test("formats secret service IDs with the Rust-compatible prefix and lowercase key", () => {
    expect(formatSecretServiceId("Provider/ApiKey")).toBe("wealthfolio_provider/apikey");
  });

  test("formats namespaced desktop secret service IDs like the Rust keyring store", () => {
    expect(formatDesktopSecretServiceId("OPENFIGI", undefined)).toBe("wealthfolio_openfigi");
    expect(formatDesktopSecretServiceId("OPENFIGI", "Dev-Test")).toBe(
      "wealthfolio_dev_test_openfigi",
    );
  });

  test("uses native keyring entries for namespaced desktop secrets", () => {
    const stored = new Map<string, string>();
    const calls: Array<{
      action: "set" | "get" | "delete";
      service: string;
      username: string;
      secret?: string;
    }> = [];
    const createEntry: KeyringEntryFactory = (service, username) => {
      const key = `${service}:${username}`;
      return {
        setPassword(secret) {
          calls.push({ action: "set", service, username, secret });
          stored.set(key, secret);
        },
        getPassword() {
          calls.push({ action: "get", service, username });
          return stored.get(key) ?? null;
        },
        deletePassword() {
          calls.push({ action: "delete", service, username });
          return stored.delete(key);
        },
      };
    };
    const service = createKeyringSecretService({
      namespace: "Dev-Test",
      createEntry,
    });

    service.setSecret("Provider/ApiKey", "new-secret");
    expect(service.getSecret("Provider/ApiKey")).toBe("new-secret");
    service.deleteSecret("Provider/ApiKey");

    expect(calls).toEqual([
      {
        action: "set",
        service: "wealthfolio_dev_test_provider/apikey",
        username: "default",
        secret: "new-secret",
      },
      {
        action: "get",
        service: "wealthfolio_dev_test_provider/apikey",
        username: "default",
      },
      {
        action: "delete",
        service: "wealthfolio_dev_test_provider/apikey",
        username: "default",
      },
    ]);
  });

  test("treats missing keychain entries as null and idempotent deletes", () => {
    const service = createKeyringSecretService({
      createEntry: () => ({
        setPassword() {},
        getPassword() {
          return null;
        },
        deletePassword() {
          return false;
        },
      }),
    });

    expect(service.getSecret("missing")).toBeNull();
    expect(service.deleteSecret("missing")).toBeUndefined();
  });

  test("normalizes native no-entry errors to missing secrets", () => {
    const noEntry = Object.assign(new Error("The specified item could not be found"), {
      code: 44,
      stderr: "The specified item could not be found in the keychain.",
    });
    const service = createKeyringSecretService({
      createEntry: () => ({
        setPassword() {},
        getPassword() {
          throw noEntry;
        },
        deletePassword() {
          throw noEntry;
        },
      }),
    });

    expect(service.getSecret("missing")).toBeNull();
    expect(service.deleteSecret("missing")).toBeUndefined();
  });

  test("propagates native keyring operational errors", () => {
    const locked = new Error("keychain is locked");
    const service = createKeyringSecretService({
      createEntry: () => ({
        setPassword() {
          throw locked;
        },
        getPassword() {
          throw locked;
        },
        deletePassword() {
          throw locked;
        },
      }),
    });

    expect(() => service.setSecret("alpha", "secret")).toThrow("keychain is locked");
    expect(() => service.getSecret("alpha")).toThrow("keychain is locked");
    expect(() => service.deleteSecret("alpha")).toThrow("keychain is locked");
  });

  test("round-trips encrypted string secrets without writing plaintext", () => {
    const filePath = secretFilePath();
    const service = createFileSecretService({
      secretsFilePath: filePath,
      encryptionKey: derivedKey,
    });

    service.setSecret("Provider/ApiKey", "secret-value");
    expect(service.getSecret("provider/apikey")).toBe("secret-value");

    const persisted = readFileSync(filePath, "utf8");
    expect(persisted).toContain('"ciphertext"');
    expect(persisted).not.toContain("secret-value");
    expect((statSync(filePath).mode & 0o777).toString(8)).toBe("600");

    const reopened = createFileSecretService({
      secretsFilePath: filePath,
      encryptionKey: derivedKey,
    });
    expect(reopened.getSecret("Provider/ApiKey")).toBe("secret-value");

    reopened.deleteSecret("provider/apikey");
    expect(reopened.getSecret("Provider/ApiKey")).toBeNull();
  });

  test("migrates raw-key encrypted files to the derived secrets key", () => {
    const filePath = secretFilePath();
    const legacy = createFileSecretService({
      secretsFilePath: filePath,
      encryptionKey: rawKey,
    });
    legacy.setSecret("LegacyProvider", "legacy-secret");

    const migrated = createFileSecretService({
      secretsFilePath: filePath,
      encryptionKey: derivedKey,
      rawKeyForMigration: rawKey,
    });
    expect(migrated.getSecret("legacyprovider")).toBe("legacy-secret");

    const derivedOnly = createFileSecretService({
      secretsFilePath: filePath,
      encryptionKey: derivedKey,
    });
    expect(derivedOnly.getSecret("LegacyProvider")).toBe("legacy-secret");
  });

  test("reads legacy plaintext stores and encrypts subsequent writes", () => {
    const filePath = secretFilePath();
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        secrets: { wealthfolio_alpha: "legacy-secret" },
      }),
    );

    const service = createFileSecretService({
      secretsFilePath: filePath,
      encryptionKey: derivedKey,
    });
    expect(service.getSecret("alpha")).toBe("legacy-secret");

    service.setSecret("beta", "new-secret");
    const persisted = readFileSync(filePath, "utf8");
    expect(persisted).toContain('"ciphertext"');
    expect(persisted).not.toContain("legacy-secret");
    expect(persisted).not.toContain("new-secret");
  });

  test("surfaces encrypted store failures when no key is available", () => {
    const filePath = secretFilePath();
    createFileSecretService({
      secretsFilePath: filePath,
      encryptionKey: derivedKey,
    }).setSecret("alpha", "secret");

    const unkeyed = createFileSecretService({ secretsFilePath: filePath });
    expect(() => unkeyed.getSecret("alpha")).toThrow(
      "WF_SECRET_KEY must be set to decrypt the secrets file",
    );
  });
});

function secretFilePath(): string {
  let index = 0;
  let dir = "";
  do {
    dir = path.join(tmpdir(), `wealthfolio-secrets-${process.pid}-${index++}`);
  } while (existsSync(dir));
  return path.join(dir, "secrets.json");
}
