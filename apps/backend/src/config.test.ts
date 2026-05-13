import { describe, expect, test } from "bun:test";

import { loadBackendConfigFromEnv, parseListenAddress } from "./config";

const secretKey = "012345678901234567890123456789!!";

describe("TS backend config", () => {
  test("parses sidecar profile env with loopback listener", () => {
    const config = loadBackendConfigFromEnv({
      WF_AUTH_REQUIRED: "false",
      WF_LISTEN_ADDR: "127.0.0.1:0",
      WF_SECRET_KEY: secretKey,
      WF_SIDECAR_TOKEN: "sidecar-token",
      WF_CORS_ALLOW_ORIGINS: "http://localhost:1420,http://127.0.0.1:1420",
    });

    expect(config.listen).toEqual({ host: "127.0.0.1", port: 0 });
    expect(config.secretKey).toHaveLength(32);
    expect(config.sidecarToken).toBe("sidecar-token");
    expect(config.cors.allowOrigins).toEqual(["http://localhost:1420", "http://127.0.0.1:1420"]);
  });

  test("rejects empty sidecar token", () => {
    expect(() =>
      loadBackendConfigFromEnv({
        WF_AUTH_REQUIRED: "false",
        WF_LISTEN_ADDR: "127.0.0.1:0",
        WF_SECRET_KEY: secretKey,
        WF_SIDECAR_TOKEN: "   ",
      }),
    ).toThrow("WF_SIDECAR_TOKEN must not be empty when set");
  });

  test("rejects missing or malformed secret keys", () => {
    expect(() =>
      loadBackendConfigFromEnv({
        WF_AUTH_REQUIRED: "false",
        WF_LISTEN_ADDR: "127.0.0.1:0",
      }),
    ).toThrow("WF_SECRET_KEY must be set and contain a 32-byte key");

    expect(() =>
      loadBackendConfigFromEnv({
        WF_AUTH_REQUIRED: "false",
        WF_LISTEN_ADDR: "127.0.0.1:0",
        WF_SECRET_KEY: "too-short",
      }),
    ).toThrow("WF_SECRET_KEY must be base64 encoded or a 32-byte ASCII string");
  });

  test("rejects sidecar token on non-loopback listener", () => {
    expect(() =>
      loadBackendConfigFromEnv({
        WF_AUTH_REQUIRED: "false",
        WF_LISTEN_ADDR: "0.0.0.0:8088",
        WF_SECRET_KEY: secretKey,
        WF_SIDECAR_TOKEN: "sidecar-token",
      }),
    ).toThrow("WF_SIDECAR_TOKEN requires a loopback WF_LISTEN_ADDR");
  });

  test("rejects wildcard CORS when auth is enabled", () => {
    expect(() =>
      loadBackendConfigFromEnv({
        WF_AUTH_PASSWORD_HASH:
          "$argon2id$v=19$m=1,t=1,p=1$aaaaaaaaaaaaaaaaaaaaaa$bbbbbbbbbbbbbbbbbbbbbb",
        WF_LISTEN_ADDR: "127.0.0.1:0",
        WF_SECRET_KEY: secretKey,
      }),
    ).toThrow('WF_CORS_ALLOW_ORIGINS cannot be "*" when authentication is enabled');
  });

  test("rejects unauthenticated non-loopback listener unless explicitly disabled", () => {
    expect(() =>
      loadBackendConfigFromEnv({
        WF_LISTEN_ADDR: "0.0.0.0:8088",
        WF_SECRET_KEY: secretKey,
      }),
    ).toThrow("Refusing to start");

    expect(
      loadBackendConfigFromEnv({
        WF_AUTH_REQUIRED: "false",
        WF_LISTEN_ADDR: "0.0.0.0:8088",
        WF_SECRET_KEY: secretKey,
      }).listen,
    ).toEqual({ host: "0.0.0.0", port: 8088 });
  });

  test("parses bracketed IPv6 listeners", () => {
    expect(parseListenAddress("[::1]:9000")).toEqual({ host: "::1", port: 9000 });
  });
});
