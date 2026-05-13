import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import {
  createFileSecretService,
  deriveSecretsEncryptionKey,
  formatSecretServiceId,
} from "./secrets";

const rawKey = new Uint8Array(32).fill(7);
const derivedKey = deriveSecretsEncryptionKey(rawKey);

describe("TS secrets domain", () => {
  test("formats secret service IDs with the Rust-compatible prefix and lowercase key", () => {
    expect(formatSecretServiceId("Provider/ApiKey")).toBe("wealthfolio_provider/apikey");
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
