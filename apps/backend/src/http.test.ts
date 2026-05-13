import { describe, expect, test } from "bun:test";

import type { BackendRuntimeConfig } from "./config";
import { createBackendRequestHandler, runWithRequestTimeout } from "./http";
import { sidecarTokenAuthorized } from "./sidecar-auth";

const config: BackendRuntimeConfig = {
  listen: { host: "127.0.0.1", port: 0 },
  cors: { allowOrigins: ["http://localhost:1420"] },
  requestTimeoutMs: 1_000,
  secretKey: new Uint8Array(32),
  sidecarToken: "sidecar-token",
};

describe("TS backend HTTP skeleton", () => {
  test("serves health, readiness, and auth status shapes", async () => {
    const handler = createBackendRequestHandler({ ...config, authPasswordHash: "hash" });

    await expect(
      (await handler(new Request("http://127.0.0.1/api/v1/healthz"))).text(),
    ).resolves.toBe("ok");
    await expect(
      (await handler(new Request("http://127.0.0.1/api/v1/readyz"))).text(),
    ).resolves.toBe("ok");
    await expect(
      (await handler(new Request("http://127.0.0.1/api/v1/auth/status"))).json(),
    ).resolves.toEqual({ requiresPassword: true });
  });

  test("enforces sidecar bearer token on guarded debug routes", async () => {
    const handler = createBackendRequestHandler(config, { includeDebugRoutes: true });
    const handlerWithoutToken = createBackendRequestHandler(
      {
        ...config,
        sidecarToken: undefined,
      },
      { includeDebugRoutes: true },
    );
    const protectedUrl = "http://127.0.0.1/api/v1/__ts-backend/protected-ping";

    expect((await handlerWithoutToken(new Request(protectedUrl))).status).toBe(401);
    expect((await handler(new Request(protectedUrl))).status).toBe(401);
    expect(
      (
        await handler(
          new Request(protectedUrl, {
            headers: { authorization: "Bearer wrong-token" },
          }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await handler(
          new Request(protectedUrl, {
            headers: { authorization: "Bearer sidecar-token" },
          }),
        )
      ).status,
    ).toBe(200);
  });

  test("matches sidecar bearer token case-insensitively without accepting partial tokens", () => {
    expect(
      sidecarTokenAuthorized(
        new Headers({ authorization: "bearer sidecar-token" }),
        "sidecar-token",
      ),
    ).toBe(true);
    expect(
      sidecarTokenAuthorized(new Headers({ authorization: "Bearer sidecar" }), "sidecar-token"),
    ).toBe(false);
  });

  test("applies explicit CORS origins and credentials", async () => {
    const handler = createBackendRequestHandler(config);
    const response = await handler(
      new Request("http://127.0.0.1/api/v1/healthz", {
        headers: { origin: "http://localhost:1420" },
      }),
    );

    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:1420");
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
  });

  test("returns timeout response when a handler exceeds the configured budget", async () => {
    const response = await runWithRequestTimeout(async () => {
      await Bun.sleep(20);
      return new Response("late");
    }, 1);

    expect(response.status).toBe(408);
    await expect(response.json()).resolves.toEqual({ code: 408, message: "Request timeout" });
  });
});
