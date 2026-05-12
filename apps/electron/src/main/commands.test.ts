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

  test("proxies snapshot reads and deletes with query parameters", async () => {
    const calls: Array<[URL | RequestInfo, RequestInit | undefined]> = [];
    const fetchImpl: FetchLike = (url, init) => {
      calls.push([url, init]);
      return Promise.resolve(
        init?.method === "DELETE" ? new Response(null, { status: 204 }) : jsonResponse([]),
      );
    };

    await invokeSidecarCommand({
      command: "get_snapshots",
      payload: { accountId: "account 1", dateFrom: "2024-01-01", dateTo: "2024-02-01" },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "get_snapshot_by_date",
      payload: { accountId: "account 1", date: "2024-01-15" },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await expect(
      invokeSidecarCommand({
        command: "delete_snapshot",
        payload: { accountId: "account 1", date: "2024-01-15" },
        sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
        fetchImpl,
      }),
    ).resolves.toBeUndefined();

    expect(calls.map(([url, init]) => [url.toString(), init?.method])).toEqual([
      [
        "http://127.0.0.1:18444/api/v1/snapshots?accountId=account+1&dateFrom=2024-01-01&dateTo=2024-02-01",
        "GET",
      ],
      [
        "http://127.0.0.1:18444/api/v1/snapshots/holdings?accountId=account+1&date=2024-01-15",
        "GET",
      ],
      ["http://127.0.0.1:18444/api/v1/snapshots?accountId=account+1&date=2024-01-15", "DELETE"],
    ]);
  });

  test("proxies manual holdings and CSV snapshot import bodies", async () => {
    const calls: Array<[URL | RequestInfo, RequestInit | undefined]> = [];
    const fetchImpl: FetchLike = (url, init) => {
      calls.push([url, init]);
      return Promise.resolve(
        url.toString().endsWith("/snapshots")
          ? new Response(null, { status: 200 })
          : jsonResponse({ ok: true }),
      );
    };

    await expect(
      invokeSidecarCommand({
        command: "save_manual_holdings",
        payload: {
          accountId: "account-1",
          holdings: [{ symbol: "AAPL" }],
          cashBalances: { USD: "100" },
          snapshotDate: "2024-01-15",
        },
        sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
        fetchImpl,
      }),
    ).resolves.toBeUndefined();
    await invokeSidecarCommand({
      command: "check_holdings_import",
      payload: { accountId: "account-1", snapshots: [{ date: "2024-01-15" }] },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "import_holdings_csv",
      payload: { accountId: "account-1", snapshots: [{ date: "2024-01-15" }] },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });

    expect(calls.map(([url, init]) => [url.toString(), init?.method, init?.body])).toEqual([
      [
        "http://127.0.0.1:18444/api/v1/snapshots",
        "POST",
        JSON.stringify({
          accountId: "account-1",
          holdings: [{ symbol: "AAPL" }],
          cashBalances: { USD: "100" },
          snapshotDate: "2024-01-15",
        }),
      ],
      [
        "http://127.0.0.1:18444/api/v1/snapshots/import/check",
        "POST",
        JSON.stringify({ accountId: "account-1", snapshots: [{ date: "2024-01-15" }] }),
      ],
      [
        "http://127.0.0.1:18444/api/v1/snapshots/import",
        "POST",
        JSON.stringify({ accountId: "account-1", snapshots: [{ date: "2024-01-15" }] }),
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

  test("rejects malformed snapshot command payloads before fetch", async () => {
    const fetchImpl: FetchLike = () => {
      throw new Error("fetch should not be called");
    };

    await expect(
      invokeSidecarCommand({
        command: "save_manual_holdings",
        payload: { accountId: "account-1", holdings: {}, cashBalances: {} },
        sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
        fetchImpl,
      }),
    ).rejects.toThrow(
      'Electron command "save_manual_holdings" requires array payload field "holdings".',
    );
  });

  test("proxies core activity commands with JSON bodies and encoded ids", async () => {
    const calls: Array<[URL | RequestInfo, RequestInit | undefined]> = [];
    const fetchImpl: FetchLike = (url, init) => {
      calls.push([url, init]);
      return Promise.resolve(jsonResponse({ ok: true }));
    };

    await invokeSidecarCommand({
      command: "search_activities",
      payload: { page: 1, pageSize: 25 },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "create_activity",
      payload: { activity: { accountId: "acct-1", activityType: "BUY" } },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "update_activity",
      payload: { activity: { id: "activity/1", activityType: "SELL" } },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "save_activities",
      payload: { request: { create: [{ activityType: "DIVIDEND" }] } },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "delete_activity",
      payload: { activityId: "activity/1" },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "link_transfer_activities",
      payload: { activityAId: "a-1", activityBId: "b-1" },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "unlink_transfer_activities",
      payload: { activityAId: "a-1", activityBId: "b-1" },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });

    expect(calls.map(([url, init]) => [url.toString(), init?.method, init?.body])).toEqual([
      [
        "http://127.0.0.1:18444/api/v1/activities/search",
        "POST",
        JSON.stringify({ page: 1, pageSize: 25 }),
      ],
      [
        "http://127.0.0.1:18444/api/v1/activities",
        "POST",
        JSON.stringify({ accountId: "acct-1", activityType: "BUY" }),
      ],
      [
        "http://127.0.0.1:18444/api/v1/activities",
        "PUT",
        JSON.stringify({ id: "activity/1", activityType: "SELL" }),
      ],
      [
        "http://127.0.0.1:18444/api/v1/activities/bulk",
        "POST",
        JSON.stringify({ create: [{ activityType: "DIVIDEND" }] }),
      ],
      ["http://127.0.0.1:18444/api/v1/activities/activity%2F1", "DELETE", undefined],
      [
        "http://127.0.0.1:18444/api/v1/activities/link",
        "POST",
        JSON.stringify({ activityAId: "a-1", activityBId: "b-1" }),
      ],
      [
        "http://127.0.0.1:18444/api/v1/activities/unlink",
        "POST",
        JSON.stringify({ activityAId: "a-1", activityBId: "b-1" }),
      ],
    ]);
  });

  test("proxies activity import and template commands", async () => {
    const calls: Array<[URL | RequestInfo, RequestInit | undefined]> = [];
    const fetchImpl: FetchLike = (url, init) => {
      calls.push([url, init]);
      return Promise.resolve(jsonResponse({ ok: true }));
    };

    await invokeSidecarCommand({
      command: "check_activities_import",
      payload: { activities: [{ id: "import-1" }] },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "preview_import_assets",
      payload: { candidates: [{ symbol: "AAPL" }] },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "import_activities",
      payload: { activities: [{ id: "import-1" }] },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "get_account_import_mapping",
      payload: { accountId: "account 1", contextKind: "activity" },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "save_account_import_mapping",
      payload: { mapping: { accountId: "account 1" } },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "list_import_templates",
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "get_import_template",
      payload: { id: "template/1" },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "save_import_template",
      payload: { template: { id: "template/1" } },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "delete_import_template",
      payload: { id: "template/1" },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "link_account_template",
      payload: { accountId: "account 1", templateId: "template/1", contextKind: "activity" },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });

    expect(calls.map(([url, init]) => [url.toString(), init?.method, init?.body])).toEqual([
      [
        "http://127.0.0.1:18444/api/v1/activities/import/check",
        "POST",
        JSON.stringify({ activities: [{ id: "import-1" }] }),
      ],
      [
        "http://127.0.0.1:18444/api/v1/activities/import/assets/preview",
        "POST",
        JSON.stringify({ candidates: [{ symbol: "AAPL" }] }),
      ],
      [
        "http://127.0.0.1:18444/api/v1/activities/import",
        "POST",
        JSON.stringify({ activities: [{ id: "import-1" }] }),
      ],
      [
        "http://127.0.0.1:18444/api/v1/activities/import/mapping?accountId=account+1&contextKind=activity",
        "GET",
        undefined,
      ],
      [
        "http://127.0.0.1:18444/api/v1/activities/import/mapping",
        "POST",
        JSON.stringify({ mapping: { accountId: "account 1" } }),
      ],
      ["http://127.0.0.1:18444/api/v1/activities/import/templates", "GET", undefined],
      [
        "http://127.0.0.1:18444/api/v1/activities/import/templates/item?id=template%2F1",
        "GET",
        undefined,
      ],
      [
        "http://127.0.0.1:18444/api/v1/activities/import/templates",
        "POST",
        JSON.stringify({ template: { id: "template/1" } }),
      ],
      [
        "http://127.0.0.1:18444/api/v1/activities/import/templates?id=template%2F1",
        "DELETE",
        undefined,
      ],
      [
        "http://127.0.0.1:18444/api/v1/activities/import/templates/link",
        "POST",
        JSON.stringify({
          accountId: "account 1",
          templateId: "template/1",
          contextKind: "activity",
        }),
      ],
    ]);
  });

  test("rejects malformed activity command payloads before fetch", async () => {
    const fetchImpl: FetchLike = () => {
      throw new Error("fetch should not be called");
    };

    await expect(
      invokeSidecarCommand({
        command: "create_activity",
        payload: { activity: [] },
        sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
        fetchImpl,
      }),
    ).rejects.toThrow(
      'Electron command "create_activity" requires object payload field "activity".',
    );
  });

  test("proxies exchange rate commands", async () => {
    const calls: Array<[URL | RequestInfo, RequestInit | undefined]> = [];
    const fetchImpl: FetchLike = (url, init) => {
      calls.push([url, init]);
      return Promise.resolve(
        init?.method === "DELETE"
          ? new Response(null, { status: 204 })
          : jsonResponse({ ok: true }),
      );
    };

    await invokeSidecarCommand({
      command: "get_latest_exchange_rates",
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "update_exchange_rate",
      payload: {
        rate: {
          id: "fx-1",
          fromCurrency: "USD",
          toCurrency: "CAD",
          rate: "1.4",
          source: "MANUAL",
          timestamp: "2024-01-15T00:00:00Z",
        },
      },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "add_exchange_rate",
      payload: {
        newRate: {
          fromCurrency: "EUR",
          toCurrency: "CAD",
          rate: "1.5",
          source: "MANUAL",
          timestamp: "2024-01-15T00:00:00Z",
        },
      },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await expect(
      invokeSidecarCommand({
        command: "delete_exchange_rate",
        payload: { rateId: "USD/CAD" },
        sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
        fetchImpl,
      }),
    ).resolves.toBeUndefined();

    expect(calls.map(([url, init]) => [url.toString(), init?.method, init?.body])).toEqual([
      ["http://127.0.0.1:18444/api/v1/exchange-rates/latest", "GET", undefined],
      [
        "http://127.0.0.1:18444/api/v1/exchange-rates",
        "PUT",
        JSON.stringify({
          id: "fx-1",
          fromCurrency: "USD",
          toCurrency: "CAD",
          rate: "1.4",
          source: "MANUAL",
          timestamp: "2024-01-15T00:00:00Z",
        }),
      ],
      [
        "http://127.0.0.1:18444/api/v1/exchange-rates",
        "POST",
        JSON.stringify({
          fromCurrency: "EUR",
          toCurrency: "CAD",
          rate: "1.5",
          source: "MANUAL",
          timestamp: "2024-01-15T00:00:00Z",
        }),
      ],
      ["http://127.0.0.1:18444/api/v1/exchange-rates/USD%2FCAD", "DELETE", undefined],
    ]);
  });

  test("proxies market data provider and custom provider commands", async () => {
    const calls: Array<[URL | RequestInfo, RequestInit | undefined]> = [];
    const fetchImpl: FetchLike = (url, init) => {
      calls.push([url, init]);
      return Promise.resolve(
        init?.method === "DELETE"
          ? new Response(null, { status: 200 })
          : jsonResponse({ ok: true }),
      );
    };

    await invokeSidecarCommand({
      command: "get_exchanges",
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "get_market_data_providers",
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "get_market_data_providers_settings",
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "update_market_data_provider_settings",
      payload: { providerId: "yahoo", priority: 1, enabled: true },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "get_custom_providers",
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "create_custom_provider",
      payload: { payload: { name: "Custom" } },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "update_custom_provider",
      payload: { providerId: "provider/1", payload: { name: "Updated" } },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await expect(
      invokeSidecarCommand({
        command: "delete_custom_provider",
        payload: { providerId: "provider/1" },
        sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
        fetchImpl,
      }),
    ).resolves.toBeUndefined();
    await invokeSidecarCommand({
      command: "test_custom_provider_source",
      payload: { payload: { providerId: "provider/1", sourceId: "source-1" } },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });

    expect(calls.map(([url, init]) => [url.toString(), init?.method, init?.body])).toEqual([
      ["http://127.0.0.1:18444/api/v1/exchanges", "GET", undefined],
      ["http://127.0.0.1:18444/api/v1/providers", "GET", undefined],
      ["http://127.0.0.1:18444/api/v1/providers/settings", "GET", undefined],
      [
        "http://127.0.0.1:18444/api/v1/providers/settings",
        "PUT",
        JSON.stringify({ providerId: "yahoo", priority: 1, enabled: true }),
      ],
      ["http://127.0.0.1:18444/api/v1/custom-providers", "GET", undefined],
      [
        "http://127.0.0.1:18444/api/v1/custom-providers",
        "POST",
        JSON.stringify({ name: "Custom" }),
      ],
      [
        "http://127.0.0.1:18444/api/v1/custom-providers/provider%2F1",
        "PUT",
        JSON.stringify({ name: "Updated" }),
      ],
      ["http://127.0.0.1:18444/api/v1/custom-providers/provider%2F1", "DELETE", undefined],
      [
        "http://127.0.0.1:18444/api/v1/custom-providers/test-source",
        "POST",
        JSON.stringify({ providerId: "provider/1", sourceId: "source-1" }),
      ],
    ]);
  });

  test("proxies contribution limit commands", async () => {
    const calls: Array<[URL | RequestInfo, RequestInit | undefined]> = [];
    const fetchImpl: FetchLike = (url, init) => {
      calls.push([url, init]);
      return Promise.resolve(
        init?.method === "DELETE"
          ? new Response(null, { status: 204 })
          : jsonResponse({ ok: true }),
      );
    };

    await invokeSidecarCommand({
      command: "get_contribution_limits",
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "create_contribution_limit",
      payload: { newLimit: { groupName: "RRSP", limitAmount: "1000" } },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "update_contribution_limit",
      payload: { id: "limit/1", updatedLimit: { groupName: "TFSA", limitAmount: "2000" } },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await expect(
      invokeSidecarCommand({
        command: "delete_contribution_limit",
        payload: { id: "limit/1" },
        sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
        fetchImpl,
      }),
    ).resolves.toBeUndefined();
    await invokeSidecarCommand({
      command: "calculate_deposits_for_contribution_limit",
      payload: { limitId: "limit/1" },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });

    expect(calls.map(([url, init]) => [url.toString(), init?.method, init?.body])).toEqual([
      ["http://127.0.0.1:18444/api/v1/limits", "GET", undefined],
      [
        "http://127.0.0.1:18444/api/v1/limits",
        "POST",
        JSON.stringify({ groupName: "RRSP", limitAmount: "1000" }),
      ],
      [
        "http://127.0.0.1:18444/api/v1/limits/limit%2F1",
        "PUT",
        JSON.stringify({ groupName: "TFSA", limitAmount: "2000" }),
      ],
      ["http://127.0.0.1:18444/api/v1/limits/limit%2F1", "DELETE", undefined],
      ["http://127.0.0.1:18444/api/v1/limits/limit%2F1/deposits", "GET", undefined],
    ]);
  });

  test("proxies asset profile commands", async () => {
    const calls: Array<[URL | RequestInfo, RequestInit | undefined]> = [];
    const fetchImpl: FetchLike = (url, init) => {
      calls.push([url, init]);
      return Promise.resolve(
        init?.method === "DELETE"
          ? new Response(null, { status: 204 })
          : jsonResponse({ ok: true }),
      );
    };

    await invokeSidecarCommand({
      command: "get_assets",
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "create_asset",
      payload: { payload: { symbol: "AAPL", name: "Apple Inc." } },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "get_asset_profile",
      payload: { assetId: "asset/1" },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "update_asset_profile",
      payload: { id: "asset/1", payload: { name: "Apple" } },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "update_quote_mode",
      payload: { id: "asset/1", quoteMode: "manual" },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await expect(
      invokeSidecarCommand({
        command: "delete_asset",
        payload: { id: "asset/1" },
        sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
        fetchImpl,
      }),
    ).resolves.toBeUndefined();

    expect(calls.map(([url, init]) => [url.toString(), init?.method, init?.body])).toEqual([
      ["http://127.0.0.1:18444/api/v1/assets", "GET", undefined],
      [
        "http://127.0.0.1:18444/api/v1/assets",
        "POST",
        JSON.stringify({ symbol: "AAPL", name: "Apple Inc." }),
      ],
      ["http://127.0.0.1:18444/api/v1/assets/profile?assetId=asset%2F1", "GET", undefined],
      [
        "http://127.0.0.1:18444/api/v1/assets/profile/asset%2F1",
        "PUT",
        JSON.stringify({ name: "Apple" }),
      ],
      [
        "http://127.0.0.1:18444/api/v1/assets/pricing-mode/asset%2F1",
        "PUT",
        JSON.stringify({ quoteMode: "manual" }),
      ],
      ["http://127.0.0.1:18444/api/v1/assets/asset%2F1", "DELETE", undefined],
    ]);
  });

  test("proxies market data quote commands", async () => {
    const calls: Array<[URL | RequestInfo, RequestInit | undefined]> = [];
    const fetchImpl: FetchLike = (url, init) => {
      calls.push([url, init]);
      return Promise.resolve(
        init?.method === "DELETE" || url.toString().endsWith("/market-data/sync/history")
          ? new Response(null, { status: 204 })
          : jsonResponse({ ok: true }),
      );
    };

    await invokeSidecarCommand({
      command: "search_symbol",
      payload: { query: "AAPL US" },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "resolve_symbol_quote",
      payload: {
        symbol: "SHOP",
        exchangeMic: "XTSE",
        instrumentType: "equity",
        providerId: "yahoo",
        quoteCcy: "CAD",
      },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "get_quote_history",
      payload: { symbol: "BRK.B" },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "fetch_yahoo_dividends",
      payload: { symbol: "AAPL" },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "get_latest_quotes",
      payload: { assetIds: ["asset/1", "asset-2"] },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "update_quote",
      payload: { symbol: "asset/1", quote: { close: 123.45 } },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await expect(
      invokeSidecarCommand({
        command: "delete_quote",
        payload: { id: "quote/1" },
        sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
        fetchImpl,
      }),
    ).resolves.toBeUndefined();
    await invokeSidecarCommand({
      command: "check_quotes_import",
      payload: { content: [115, 121, 109], hasHeaderRow: true },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "import_quotes_csv",
      payload: { quotes: [{ symbol: "AAPL" }], overwriteExisting: false },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await expect(
      invokeSidecarCommand({
        command: "synch_quotes",
        sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
        fetchImpl,
      }),
    ).resolves.toBeUndefined();
    await invokeSidecarCommand({
      command: "sync_market_data",
      payload: { assetIds: ["asset/1"], refetchAll: false, refetchRecentDays: 30 },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });

    expect(calls.map(([url, init]) => [url.toString(), init?.method, init?.body])).toEqual([
      ["http://127.0.0.1:18444/api/v1/market-data/search?query=AAPL+US", "GET", undefined],
      [
        "http://127.0.0.1:18444/api/v1/market-data/resolve-currency?symbol=SHOP&exchangeMic=XTSE&instrumentType=equity&providerId=yahoo&quoteCcy=CAD",
        "GET",
        undefined,
      ],
      ["http://127.0.0.1:18444/api/v1/market-data/quotes/history?symbol=BRK.B", "GET", undefined],
      ["http://127.0.0.1:18444/api/v1/market-data/yahoo/dividends?symbol=AAPL", "GET", undefined],
      [
        "http://127.0.0.1:18444/api/v1/market-data/quotes/latest",
        "POST",
        JSON.stringify({ assetIds: ["asset/1", "asset-2"] }),
      ],
      [
        "http://127.0.0.1:18444/api/v1/market-data/quotes/asset%2F1",
        "PUT",
        JSON.stringify({ close: 123.45 }),
      ],
      ["http://127.0.0.1:18444/api/v1/market-data/quotes/id/quote%2F1", "DELETE", undefined],
      [
        "http://127.0.0.1:18444/api/v1/market-data/quotes/check",
        "POST",
        JSON.stringify({ content: [115, 121, 109], hasHeaderRow: true }),
      ],
      [
        "http://127.0.0.1:18444/api/v1/market-data/quotes/import",
        "POST",
        JSON.stringify({ quotes: [{ symbol: "AAPL" }], overwriteExisting: false }),
      ],
      ["http://127.0.0.1:18444/api/v1/market-data/sync/history", "POST", undefined],
      [
        "http://127.0.0.1:18444/api/v1/market-data/sync",
        "POST",
        JSON.stringify({ assetIds: ["asset/1"], refetchAll: false, refetchRecentDays: 30 }),
      ],
    ]);
  });

  test("rejects malformed asset and quote command payloads before fetch", async () => {
    let called = false;
    const fetchImpl: FetchLike = () => {
      called = true;
      return Promise.resolve(jsonResponse({}));
    };

    await expect(
      invokeSidecarCommand({
        command: "update_quote_mode",
        payload: { id: "asset-1" },
        sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
        fetchImpl,
      }),
    ).rejects.toThrow('requires string payload field "quoteMode"');
    await expect(
      invokeSidecarCommand({
        command: "get_latest_quotes",
        payload: { assetIds: ["asset-1", 1] },
        sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
        fetchImpl,
      }),
    ).rejects.toThrow('requires string array payload field "assetIds"');
    await expect(
      invokeSidecarCommand({
        command: "sync_market_data",
        payload: { assetIds: ["asset-1"] },
        sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
        fetchImpl,
      }),
    ).rejects.toThrow('requires boolean payload field "refetchAll"');

    expect(called).toBe(false);
  });

  test("proxies taxonomy commands", async () => {
    const calls: Array<[URL | RequestInfo, RequestInit | undefined]> = [];
    const fetchImpl: FetchLike = (url, init) => {
      calls.push([url, init]);
      return Promise.resolve(
        init?.method === "DELETE"
          ? new Response(null, { status: 204 })
          : jsonResponse({ ok: true }),
      );
    };

    await invokeSidecarCommand({
      command: "get_taxonomies",
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "get_taxonomy",
      payload: { id: "taxonomy/1" },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "create_taxonomy",
      payload: { taxonomy: { name: "Asset Class" } },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "update_taxonomy",
      payload: { taxonomy: { id: "taxonomy/1", name: "Sector" } },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await expect(
      invokeSidecarCommand({
        command: "delete_taxonomy",
        payload: { id: "taxonomy/1" },
        sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
        fetchImpl,
      }),
    ).resolves.toBeUndefined();
    await invokeSidecarCommand({
      command: "create_category",
      payload: { category: { taxonomyId: "taxonomy/1", name: "Equity" } },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "update_category",
      payload: { category: { id: "category/1", name: "Stocks" } },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await expect(
      invokeSidecarCommand({
        command: "delete_category",
        payload: { taxonomyId: "taxonomy/1", categoryId: "category/1" },
        sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
        fetchImpl,
      }),
    ).resolves.toBeUndefined();
    await invokeSidecarCommand({
      command: "move_category",
      payload: {
        taxonomyId: "taxonomy/1",
        categoryId: "category/1",
        newParentId: null,
        position: 2,
      },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "import_taxonomy_json",
      payload: { jsonStr: '{"name":"Imported"}' },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "export_taxonomy_json",
      payload: { id: "taxonomy/1" },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "get_asset_taxonomy_assignments",
      payload: { assetId: "asset/1" },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "assign_asset_to_category",
      payload: { assignment: { assetId: "asset/1", categoryId: "category/1" } },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await expect(
      invokeSidecarCommand({
        command: "remove_asset_taxonomy_assignment",
        payload: { id: "assignment/1" },
        sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
        fetchImpl,
      }),
    ).resolves.toBeUndefined();
    await invokeSidecarCommand({
      command: "get_migration_status",
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "migrate_legacy_classifications",
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });

    expect(calls.map(([url, init]) => [url.toString(), init?.method, init?.body])).toEqual([
      ["http://127.0.0.1:18444/api/v1/taxonomies", "GET", undefined],
      ["http://127.0.0.1:18444/api/v1/taxonomies/taxonomy%2F1", "GET", undefined],
      ["http://127.0.0.1:18444/api/v1/taxonomies", "POST", JSON.stringify({ name: "Asset Class" })],
      [
        "http://127.0.0.1:18444/api/v1/taxonomies",
        "PUT",
        JSON.stringify({ id: "taxonomy/1", name: "Sector" }),
      ],
      ["http://127.0.0.1:18444/api/v1/taxonomies/taxonomy%2F1", "DELETE", undefined],
      [
        "http://127.0.0.1:18444/api/v1/taxonomies/categories",
        "POST",
        JSON.stringify({ taxonomyId: "taxonomy/1", name: "Equity" }),
      ],
      [
        "http://127.0.0.1:18444/api/v1/taxonomies/categories",
        "PUT",
        JSON.stringify({ id: "category/1", name: "Stocks" }),
      ],
      [
        "http://127.0.0.1:18444/api/v1/taxonomies/taxonomy%2F1/categories/category%2F1",
        "DELETE",
        undefined,
      ],
      [
        "http://127.0.0.1:18444/api/v1/taxonomies/categories/move",
        "POST",
        JSON.stringify({
          taxonomyId: "taxonomy/1",
          categoryId: "category/1",
          newParentId: null,
          position: 2,
        }),
      ],
      [
        "http://127.0.0.1:18444/api/v1/taxonomies/import",
        "POST",
        JSON.stringify({ jsonStr: '{"name":"Imported"}' }),
      ],
      ["http://127.0.0.1:18444/api/v1/taxonomies/taxonomy%2F1/export", "GET", undefined],
      ["http://127.0.0.1:18444/api/v1/taxonomies/assignments/asset/asset%2F1", "GET", undefined],
      [
        "http://127.0.0.1:18444/api/v1/taxonomies/assignments",
        "POST",
        JSON.stringify({ assetId: "asset/1", categoryId: "category/1" }),
      ],
      ["http://127.0.0.1:18444/api/v1/taxonomies/assignments/assignment%2F1", "DELETE", undefined],
      ["http://127.0.0.1:18444/api/v1/taxonomies/migration/status", "GET", undefined],
      ["http://127.0.0.1:18444/api/v1/taxonomies/migration/run", "POST", undefined],
    ]);
  });

  test("rejects malformed taxonomy command payloads before fetch", async () => {
    let called = false;
    const fetchImpl: FetchLike = () => {
      called = true;
      return Promise.resolve(jsonResponse({}));
    };

    await expect(
      invokeSidecarCommand({
        command: "delete_category",
        payload: { taxonomyId: "taxonomy-1" },
        sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
        fetchImpl,
      }),
    ).rejects.toThrow('requires string payload field "categoryId"');
    await expect(
      invokeSidecarCommand({
        command: "move_category",
        payload: { taxonomyId: "taxonomy-1", categoryId: "category-1" },
        sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
        fetchImpl,
      }),
    ).rejects.toThrow('requires number payload field "position"');
    await expect(
      invokeSidecarCommand({
        command: "import_taxonomy_json",
        payload: { jsonStr: "" },
        sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
        fetchImpl,
      }),
    ).rejects.toThrow('requires string payload field "jsonStr"');

    expect(called).toBe(false);
  });

  test("proxies goal CRUD commands with encoded goal ids and JSON bodies", async () => {
    const calls: Array<[URL | RequestInfo, RequestInit | undefined]> = [];
    const fetchImpl: FetchLike = (url, init) => {
      calls.push([url, init]);
      return Promise.resolve(
        init?.method === "DELETE"
          ? new Response(null, { status: 204 })
          : jsonResponse({ ok: true }),
      );
    };

    await invokeSidecarCommand({
      command: "get_goals",
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "get_goal",
      payload: { goalId: "goal/1" },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "create_goal",
      payload: { goal: { name: "Retire" } },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "update_goal",
      payload: { goal: { id: "goal/1", name: "Retire early" } },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await expect(
      invokeSidecarCommand({
        command: "delete_goal",
        payload: { goalId: "goal/1" },
        sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
        fetchImpl,
      }),
    ).resolves.toBeUndefined();

    expect(calls.map(([url, init]) => [url.toString(), init?.method, init?.body])).toEqual([
      ["http://127.0.0.1:18444/api/v1/goals", "GET", undefined],
      ["http://127.0.0.1:18444/api/v1/goals/goal%2F1", "GET", undefined],
      ["http://127.0.0.1:18444/api/v1/goals", "POST", JSON.stringify({ name: "Retire" })],
      [
        "http://127.0.0.1:18444/api/v1/goals",
        "PUT",
        JSON.stringify({ id: "goal/1", name: "Retire early" }),
      ],
      ["http://127.0.0.1:18444/api/v1/goals/goal%2F1", "DELETE", undefined],
    ]);
    expect(calls[2][1]?.headers).toEqual({
      Accept: "application/json",
      Authorization: "Bearer sidecar-token",
      "Content-Type": "application/json",
    });
  });

  test("proxies goal funding, plan, and refresh commands", async () => {
    const calls: Array<[URL | RequestInfo, RequestInit | undefined]> = [];
    const fetchImpl: FetchLike = (url, init) => {
      calls.push([url, init]);
      return Promise.resolve(
        init?.method === "DELETE"
          ? new Response(null, { status: 204 })
          : jsonResponse({ ok: true }),
      );
    };

    await invokeSidecarCommand({
      command: "get_goal_funding",
      payload: { goalId: "goal 1" },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "save_goal_funding",
      payload: { goalId: "goal 1", rules: [{ accountId: "acct-1" }] },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "get_goal_plan",
      payload: { goalId: "goal 1" },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "save_goal_plan",
      payload: { plan: { goalId: "goal 1", planKind: "retirement" } },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "delete_goal_plan",
      payload: { goalId: "goal 1" },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "refresh_goal_summary",
      payload: { goalId: "goal 1" },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "refresh_all_goal_summaries",
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });

    expect(calls.map(([url, init]) => [url.toString(), init?.method, init?.body])).toEqual([
      ["http://127.0.0.1:18444/api/v1/goals/goal%201/funding", "GET", undefined],
      [
        "http://127.0.0.1:18444/api/v1/goals/goal%201/funding",
        "PUT",
        JSON.stringify([{ accountId: "acct-1" }]),
      ],
      ["http://127.0.0.1:18444/api/v1/goals/goal%201/plan", "GET", undefined],
      [
        "http://127.0.0.1:18444/api/v1/goals/plan",
        "POST",
        JSON.stringify({ goalId: "goal 1", planKind: "retirement" }),
      ],
      ["http://127.0.0.1:18444/api/v1/goals/goal%201/plan", "DELETE", undefined],
      ["http://127.0.0.1:18444/api/v1/goals/goal%201/refresh-summary", "POST", undefined],
      ["http://127.0.0.1:18444/api/v1/goals/refresh-summaries", "POST", undefined],
    ]);
  });

  test("proxies retirement overview and simulation commands", async () => {
    const calls: Array<[URL | RequestInfo, RequestInit | undefined]> = [];
    const fetchImpl: FetchLike = (url, init) => {
      calls.push([url, init]);
      return Promise.resolve(jsonResponse({ ok: true }));
    };

    await invokeSidecarCommand({
      command: "get_retirement_overview",
      payload: { goalId: "goal-1" },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "get_save_up_overview",
      payload: { goalId: "goal-1" },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    await invokeSidecarCommand({
      command: "preview_save_up_overview",
      payload: { input: { targetAmount: 1000 } },
      sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
      fetchImpl,
    });
    for (const command of [
      "calculate_retirement_projection",
      "run_retirement_monte_carlo",
      "run_retirement_stress_tests",
      "run_retirement_scenario_analysis",
      "run_retirement_decision_sensitivity_map",
      "run_retirement_sorr",
    ] satisfies ElectronCommand[]) {
      await invokeSidecarCommand({
        command,
        payload: { goalId: "goal-1", plan: { age: 40 }, currentPortfolio: 1000 },
        sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
        fetchImpl,
      });
    }

    expect(calls.map(([url, init]) => [url.toString(), init?.method, init?.body])).toEqual([
      ["http://127.0.0.1:18444/api/v1/goals/goal-1/retirement/overview", "GET", undefined],
      ["http://127.0.0.1:18444/api/v1/goals/goal-1/save-up/overview", "GET", undefined],
      [
        "http://127.0.0.1:18444/api/v1/goals/save-up/preview",
        "POST",
        JSON.stringify({ targetAmount: 1000 }),
      ],
      [
        "http://127.0.0.1:18444/api/v1/goals/retirement/projection",
        "POST",
        JSON.stringify({ goalId: "goal-1", plan: { age: 40 }, currentPortfolio: 1000 }),
      ],
      [
        "http://127.0.0.1:18444/api/v1/goals/retirement/monte-carlo",
        "POST",
        JSON.stringify({ goalId: "goal-1", plan: { age: 40 }, currentPortfolio: 1000 }),
      ],
      [
        "http://127.0.0.1:18444/api/v1/goals/retirement/stress-tests",
        "POST",
        JSON.stringify({ goalId: "goal-1", plan: { age: 40 }, currentPortfolio: 1000 }),
      ],
      [
        "http://127.0.0.1:18444/api/v1/goals/retirement/scenario-analysis",
        "POST",
        JSON.stringify({ goalId: "goal-1", plan: { age: 40 }, currentPortfolio: 1000 }),
      ],
      [
        "http://127.0.0.1:18444/api/v1/goals/retirement/decision-sensitivity-map",
        "POST",
        JSON.stringify({ goalId: "goal-1", plan: { age: 40 }, currentPortfolio: 1000 }),
      ],
      [
        "http://127.0.0.1:18444/api/v1/goals/retirement/sequence-of-returns",
        "POST",
        JSON.stringify({ goalId: "goal-1", plan: { age: 40 }, currentPortfolio: 1000 }),
      ],
    ]);
  });

  test("rejects malformed goal command payloads before fetch", async () => {
    const fetchImpl: FetchLike = () => {
      throw new Error("fetch should not be called");
    };

    await expect(
      invokeSidecarCommand({
        command: "save_goal_funding",
        payload: { goalId: "goal-1", rules: {} },
        sidecar: { baseUrl: "http://127.0.0.1:18444", token: "sidecar-token" },
        fetchImpl,
      }),
    ).rejects.toThrow('Electron command "save_goal_funding" requires array payload field "rules".');
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
