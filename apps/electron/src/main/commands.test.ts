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

  test("proxies create_account with the account request body", async () => {
    const calls: Array<[URL | RequestInfo, RequestInit | undefined]> = [];
    const fetchImpl: FetchLike = (url, init) => {
      calls.push([url, init]);
      return Promise.resolve(jsonResponse({ id: "account-2" }));
    };

    await expect(
      invokeSidecarCommand({
        command: "create_account",
        payload: { account: { name: "Brokerage", currency: "USD" } },
        sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
        fetchImpl,
      }),
    ).resolves.toEqual({ id: "account-2" });

    const [url, init] = calls[0];
    expect(url.toString()).toBe("http://127.0.0.1:18444/api/v1/accounts");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      Accept: "application/json",
      Authorization: "Bearer sidecar-token",
      "Content-Type": "application/json",
    });
    expect(init?.body).toBe(JSON.stringify({ name: "Brokerage", currency: "USD" }));
  });

  test("proxies update_account with an encoded account id", async () => {
    const calls: Array<[URL | RequestInfo, RequestInit | undefined]> = [];
    const fetchImpl: FetchLike = (url, init) => {
      calls.push([url, init]);
      return Promise.resolve(jsonResponse({ id: "acct 3" }));
    };

    await invokeSidecarCommand({
      command: "update_account",
      payload: { accountUpdate: { id: "acct 3", name: "Updated" } },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });

    const [url, init] = calls[0];
    expect(url.toString()).toBe("http://127.0.0.1:18444/api/v1/accounts/acct%203");
    expect(init?.method).toBe("PUT");
    expect(init?.body).toBe(JSON.stringify({ id: "acct 3", name: "Updated" }));
  });

  test("proxies delete_account with an encoded account id", async () => {
    const calls: Array<[URL | RequestInfo, RequestInit | undefined]> = [];
    const fetchImpl: FetchLike = (url, init) => {
      calls.push([url, init]);
      return Promise.resolve(new Response(null, { status: 204 }));
    };

    await expect(
      invokeSidecarCommand({
        command: "delete_account",
        payload: { accountId: "acct/4" },
        sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
        fetchImpl,
      }),
    ).resolves.toBeUndefined();

    const [url, init] = calls[0];
    expect(url.toString()).toBe("http://127.0.0.1:18444/api/v1/accounts/acct%2F4");
    expect(init?.method).toBe("DELETE");
  });

  test("rejects malformed account command payloads before fetch", async () => {
    const fetchImpl: FetchLike = () => {
      throw new Error("fetch should not be called");
    };

    await expect(
      invokeSidecarCommand({
        command: "update_account",
        payload: { accountUpdate: { name: "Missing ID" } },
        sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
        fetchImpl,
      }),
    ).rejects.toThrow(
      'Electron command "update_account" requires string payload field "accountUpdate.id".',
    );
  });

  test("proxies settings reads and auto-update setting reads", async () => {
    const urls: string[] = [];
    const fetchImpl: FetchLike = (url) => {
      urls.push(url.toString());
      return Promise.resolve(
        jsonResponse(url.toString().endsWith("auto-update-enabled") ? true : {}),
      );
    };

    await expect(
      invokeSidecarCommand({
        command: "get_settings",
        sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
        fetchImpl,
      }),
    ).resolves.toEqual({});
    await expect(
      invokeSidecarCommand({
        command: "is_auto_update_check_enabled",
        sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
        fetchImpl,
      }),
    ).resolves.toBe(true);

    expect(urls).toEqual([
      "http://127.0.0.1:18444/api/v1/settings",
      "http://127.0.0.1:18444/api/v1/settings/auto-update-enabled",
    ]);
  });

  test("proxies update_settings with the settings update request body", async () => {
    const calls: Array<[URL | RequestInfo, RequestInit | undefined]> = [];
    const fetchImpl: FetchLike = (url, init) => {
      calls.push([url, init]);
      return Promise.resolve(jsonResponse({ baseCurrency: "EUR" }));
    };

    await expect(
      invokeSidecarCommand({
        command: "update_settings",
        payload: { settingsUpdate: { baseCurrency: "EUR" } },
        sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
        fetchImpl,
      }),
    ).resolves.toEqual({ baseCurrency: "EUR" });

    const [url, init] = calls[0];
    expect(url.toString()).toBe("http://127.0.0.1:18444/api/v1/settings");
    expect(init?.method).toBe("PUT");
    expect(init?.headers).toEqual({
      Accept: "application/json",
      Authorization: "Bearer sidecar-token",
      "Content-Type": "application/json",
    });
    expect(init?.body).toBe(JSON.stringify({ baseCurrency: "EUR" }));
  });

  test("proxies portfolio update commands that return accepted with no body", async () => {
    const calls: Array<[URL | RequestInfo, RequestInit | undefined]> = [];
    const fetchImpl: FetchLike = (url, init) => {
      calls.push([url, init]);
      return Promise.resolve(new Response(null, { status: 202 }));
    };

    await expect(
      invokeSidecarCommand({
        command: "update_portfolio",
        sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
        fetchImpl,
      }),
    ).resolves.toBeUndefined();
    await expect(
      invokeSidecarCommand({
        command: "recalculate_portfolio",
        sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
        fetchImpl,
      }),
    ).resolves.toBeUndefined();

    expect(calls.map(([url, init]) => [url.toString(), init?.method])).toEqual([
      ["http://127.0.0.1:18444/api/v1/portfolio/update", "POST"],
      ["http://127.0.0.1:18444/api/v1/portfolio/recalculate", "POST"],
    ]);
  });

  test("proxies holdings read commands with encoded query parameters", async () => {
    const urls: string[] = [];
    const fetchImpl: FetchLike = (url) => {
      urls.push(url.toString());
      return Promise.resolve(jsonResponse([]));
    };

    await invokeSidecarCommand({
      command: "get_holdings",
      payload: { accountId: "account 1" },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "get_holding",
      payload: { accountId: "account 1", assetId: "asset/2" },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "get_asset_holdings",
      payload: { assetId: "asset/2" },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });

    expect(urls).toEqual([
      "http://127.0.0.1:18444/api/v1/holdings?accountId=account+1",
      "http://127.0.0.1:18444/api/v1/holdings/item?accountId=account+1&assetId=asset%2F2",
      "http://127.0.0.1:18444/api/v1/holdings/by-asset?assetId=asset%2F2",
    ]);
  });

  test("proxies valuation and allocation read commands", async () => {
    const urls: string[] = [];
    const fetchImpl: FetchLike = (url) => {
      urls.push(url.toString());
      return Promise.resolve(jsonResponse([]));
    };

    await invokeSidecarCommand({
      command: "get_historical_valuations",
      payload: { accountId: "account-1", startDate: "2024-01-01", endDate: "2024-02-01" },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "get_latest_valuations",
      payload: { accountIds: ["account-1", "account 2"] },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "get_portfolio_allocations",
      payload: { accountId: "account-1" },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "get_holdings_by_allocation",
      payload: {
        accountId: "account-1",
        taxonomyId: "taxonomy-1",
        categoryId: "category/1",
      },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });

    expect(urls).toEqual([
      "http://127.0.0.1:18444/api/v1/valuations/history?accountId=account-1&startDate=2024-01-01&endDate=2024-02-01",
      "http://127.0.0.1:18444/api/v1/valuations/latest?accountIds%5B%5D=account-1&accountIds%5B%5D=account+2",
      "http://127.0.0.1:18444/api/v1/allocations?accountId=account-1",
      "http://127.0.0.1:18444/api/v1/allocations/holdings?accountId=account-1&taxonomyId=taxonomy-1&categoryId=category%2F1",
    ]);
  });

  test("proxies performance commands with JSON request bodies", async () => {
    const calls: Array<[URL | RequestInfo, RequestInit | undefined]> = [];
    const fetchImpl: FetchLike = (url, init) => {
      calls.push([url, init]);
      return Promise.resolve(jsonResponse({ ok: true }));
    };

    await invokeSidecarCommand({
      command: "calculate_accounts_simple_performance",
      payload: { accountIds: ["account-1"] },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "calculate_performance_history",
      payload: { itemType: "ACCOUNT", itemId: "account-1", startDate: "2024-01-01" },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "calculate_performance_summary",
      payload: { itemType: "ACCOUNT", itemId: "account-1", endDate: "2024-02-01" },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });

    expect(calls.map(([url, init]) => [url.toString(), init?.method, init?.body])).toEqual([
      [
        "http://127.0.0.1:18444/api/v1/performance/accounts/simple",
        "POST",
        JSON.stringify({ accountIds: ["account-1"] }),
      ],
      [
        "http://127.0.0.1:18444/api/v1/performance/history",
        "POST",
        JSON.stringify({ itemType: "ACCOUNT", itemId: "account-1", startDate: "2024-01-01" }),
      ],
      [
        "http://127.0.0.1:18444/api/v1/performance/summary",
        "POST",
        JSON.stringify({ itemType: "ACCOUNT", itemId: "account-1", endDate: "2024-02-01" }),
      ],
    ]);
    for (const [, init] of calls) {
      expect(init?.headers).toEqual({
        Accept: "application/json",
        Authorization: "Bearer sidecar-token",
        "Content-Type": "application/json",
      });
    }
  });

  test("proxies income summary with optional account filtering", async () => {
    const urls: string[] = [];
    const fetchImpl: FetchLike = (url) => {
      urls.push(url.toString());
      return Promise.resolve(jsonResponse([]));
    };

    await invokeSidecarCommand({
      command: "get_income_summary",
      payload: { accountId: "account-1" },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "get_income_summary",
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });

    expect(urls).toEqual([
      "http://127.0.0.1:18444/api/v1/income/summary?accountId=account-1",
      "http://127.0.0.1:18444/api/v1/income/summary",
    ]);
  });

  test("rejects malformed settings update payloads before fetch", async () => {
    const fetchImpl: FetchLike = () => {
      throw new Error("fetch should not be called");
    };

    await expect(
      invokeSidecarCommand({
        command: "update_settings",
        payload: { settingsUpdate: null as unknown as Record<string, unknown> },
        sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
        fetchImpl,
      }),
    ).rejects.toThrow(
      'Electron command "update_settings" requires object payload field "settingsUpdate".',
    );
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
