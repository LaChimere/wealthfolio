import { describe, expect, test } from "bun:test";

import type { BackendRuntimeConfig } from "./config";
import { startBackendServer } from "./server";

const config: BackendRuntimeConfig = {
  listen: { host: "127.0.0.1", port: 0 },
  cors: { allowOrigins: ["*"] },
  requestTimeoutMs: 1_000,
  secretKey: new Uint8Array(32),
};

describe("TS backend server lifecycle", () => {
  test("starts and stops a Bun server handle", async () => {
    const server = startBackendServer(config);
    try {
      const response = await fetch(`${server.baseUrl}/api/v1/readyz`);

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe("ok");
    } finally {
      server.stop();
    }

    await expect(fetch(`${server.baseUrl}/api/v1/readyz`)).rejects.toThrow();
  });
});
