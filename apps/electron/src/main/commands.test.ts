import { describe, expect, test } from "bun:test";

import type { ElectronCommand } from "../shared/ipc";
import { invokeSidecarCommand } from "./commands";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

describe("Electron sidecar command proxy", () => {
  test("proxies get_accounts through Electron main with sidecar auth", async () => {
    const calls: Array<[URL | RequestInfo, RequestInit | undefined]> = [];
    const fetchImpl: FetchLike = (url, init) => {
      calls.push([url, init]);
      return Promise.resolve(jsonResponse([{ id: "account-1" }]));
    };

    await expect(
      invokeSidecarCommand({
        command: "get_accounts",
        payload: { includeArchived: false },
        sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
        fetchImpl,
      }),
    ).resolves.toEqual([{ id: "account-1" }]);

    const [url, init] = calls[0];
    expect(url.toString()).toBe("http://127.0.0.1:18444/api/v1/accounts");
    expect(init?.method).toBe("GET");
    expect(init?.headers).toEqual({
      Accept: "application/json",
      Authorization: "Bearer sidecar-token",
    });
  });

  test("adds includeArchived query only when requested", async () => {
    const urls: string[] = [];
    const fetchImpl: FetchLike = (url) => {
      urls.push(url.toString());
      return Promise.resolve(jsonResponse([]));
    };

    await invokeSidecarCommand({
      command: "get_accounts",
      payload: { includeArchived: true },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });

    expect(urls).toEqual(["http://127.0.0.1:18444/api/v1/accounts?includeArchived=true"]);
  });

  test("does not leak sidecar URL or token in command errors", async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(
        jsonResponse(
          {
            message:
              "Connection failed to http://127.0.0.1:18444 with token=sidecar-token and sidecar-token",
          },
          { status: 401, statusText: "Unauthorized" },
        ),
      );

    await expect(
      invokeSidecarCommand({
        command: "get_accounts",
        sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
        fetchImpl,
      }),
    ).rejects.toThrow(
      'Electron sidecar command "get_accounts" failed with HTTP 401: Connection failed to [sidecar] with token=[redacted] and [redacted]',
    );

    await invokeSidecarCommand({
      command: "get_accounts",
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("127.0.0.1");
      expect(message).not.toContain("sidecar-token");
    });
  });

  test("sanitizes network errors before they cross the IPC boundary", async () => {
    const fetchImpl: FetchLike = () =>
      Promise.reject(new Error("connect ECONNREFUSED http://127.0.0.1:18444 token=sidecar-token"));

    await invokeSidecarCommand({
      command: "get_accounts",
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("connect ECONNREFUSED [sidecar] token=[redacted]");
      expect(message).not.toContain("127.0.0.1");
      expect(message).not.toContain("sidecar-token");
    });
  });

  test("fails closed if an allowlisted command has no proxy implementation", async () => {
    await expect(
      invokeSidecarCommand({
        command: "missing_command" as ElectronCommand,
        sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      }),
    ).rejects.toThrow(
      'Electron command "missing_command" passed validation but has no implementation.',
    );
  });

  test("does not corrupt sanitized errors when a malformed sidecar has no token", async () => {
    const fetchImpl: FetchLike = () =>
      Promise.resolve(
        jsonResponse(
          { message: "Connection failed to http://127.0.0.1:18444" },
          { status: 500, statusText: "Internal Server Error" },
        ),
      );

    await expect(
      invokeSidecarCommand({
        command: "get_accounts",
        sidecar: { baseUrl: "http://127.0.0.1:18444", token: "" },
        fetchImpl,
      }),
    ).rejects.toThrow(
      'Electron sidecar command "get_accounts" failed with HTTP 500: Connection failed to [sidecar]',
    );
  });
});
