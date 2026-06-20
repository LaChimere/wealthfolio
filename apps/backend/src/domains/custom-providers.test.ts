import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import {
  createCustomProviderRepository,
  createCustomProviderService,
  type CustomProviderServiceOptions,
  type CustomProviderSyncEvent,
  type TestSourceRequest,
} from "./custom-providers";

describe("TS custom providers domain", () => {
  test("lists providers by priority and parses source config with Rust-compatible IDs", () => {
    const db = createCustomProvidersDb();
    const warnings: string[] = [];
    const service = createCustomProviderService(
      createCustomProviderRepository(db, { warn: (message) => warnings.push(message) }),
    );

    try {
      seedCustomProvider(db, {
        id: "uuid-high",
        code: "high",
        name: "High Priority",
        priority: 20,
        config: JSON.stringify({
          sources: [
            {
              kind: "latest",
              format: "json",
              url: "https://example.test/latest/{SYMBOL}",
              pricePath: "$.price",
            },
          ],
        }),
      });
      seedCustomProvider(db, {
        id: "uuid-low",
        code: "low",
        name: "Low Priority",
        priority: 10,
        config: "{bad",
      });
      seedCustomProvider(db, {
        id: "uuid-mixed",
        code: "mixed",
        name: "Mixed Priority",
        priority: 15,
        config: JSON.stringify({
          sources: [
            {
              kind: "latest",
              format: "json",
              url: "https://example.test/latest/{SYMBOL}",
              pricePath: "$.price",
            },
            {
              kind: "historical",
              format: "csv",
              url: "https://example.test/history/{SYMBOL}",
            },
          ],
        }),
      });
      seedCustomProvider(db, {
        id: "uuid-invalid-shape",
        code: "invalid-shape",
        name: "Invalid Shape",
        priority: 18,
        config: JSON.stringify({ source: [] }),
      });

      expect(service.getAll()).toEqual([
        expect.objectContaining({ id: "low", sources: [] }),
        expect.objectContaining({ id: "mixed", sources: [] }),
        expect.objectContaining({ id: "invalid-shape", sources: [] }),
        expect.objectContaining({
          id: "high",
          sources: [
            expect.objectContaining({
              id: "high:latest",
              providerId: "high",
              kind: "latest",
              datePath: null,
            }),
          ],
        }),
      ]);
      expect(warnings).toEqual([
        expect.stringContaining("Failed to parse config JSON for provider 'low'"),
        expect.stringContaining("Failed to parse config JSON for provider 'mixed'"),
        expect.stringContaining("Failed to parse config JSON for provider 'invalid-shape'"),
      ]);
      expect(service.getSourceByKind("high", "latest")).toEqual(
        expect.objectContaining({ id: "high:latest" }),
      );
      expect(service.getSourceByKind("mixed", "latest")).toBeNull();
      expect(service.getSourceByKind("missing", "latest")).toBeNull();
    } finally {
      db.close();
    }
  });

  test("creates providers with normalized code, defaults, source validation, and sync UUID", async () => {
    const db = createCustomProvidersDb();
    const syncEvents: CustomProviderSyncEvent[] = [];
    const service = createCustomProviderService(
      createCustomProviderRepository(db, { queueSyncEvent: (event) => syncEvents.push(event) }),
    );

    try {
      const created = await service.create({
        code: " Demo-Provider ",
        name: "Demo Provider",
        sources: [
          {
            kind: "latest",
            format: "json",
            url: "https://example.test/latest/{SYMBOL}",
            pricePath: "$.price",
          },
        ],
      });

      expect(created).toMatchObject({
        id: "demo-provider",
        name: "Demo Provider",
        description: "",
        enabled: true,
        priority: 50,
        sources: [expect.objectContaining({ id: "demo-provider:latest", datePath: null })],
      });
      expect(syncEvents).toEqual([
        expect.objectContaining({
          providerUuid: expect.not.stringContaining("demo-provider"),
          operation: "Create",
          payload: expect.objectContaining({ code: "demo-provider", enabled: true }),
        }),
      ]);
      await expect(
        service.create({
          code: "manual",
          name: "Reserved",
          sources: [],
        }),
      ).rejects.toThrow("Code 'manual' is reserved");
      await expect(
        service.create({
          code: "bad_code",
          name: "Bad Code",
          sources: [],
        }),
      ).rejects.toThrow("Code must contain only lowercase letters, numbers, and hyphens");
      await expect(
        service.create({
          code: "bad-kind",
          name: "Bad Kind",
          sources: [
            {
              kind: "current" as "latest",
              format: "json",
              url: "https://example.test",
              pricePath: "$.price",
            },
          ],
        }),
      ).rejects.toThrow("Invalid source kind 'current'. Must be one of: latest, historical");
      await expect(
        service.create({
          code: "bad-format",
          name: "Bad Format",
          sources: [
            {
              kind: "latest",
              format: "xml" as "json",
              url: "https://example.test",
              pricePath: "$.price",
            },
          ],
        }),
      ).rejects.toThrow("Invalid source format 'xml'. Must be one of: json, html, html_table, csv");
      await expect(
        service.create({
          code: "bad-priority",
          name: "Bad Priority",
          priority: 4.5,
          sources: [
            {
              kind: "latest",
              format: "json",
              url: "https://example.test",
              pricePath: "$.price",
            },
          ],
        }),
      ).rejects.toThrow("Priority must be an integer between -2147483648 and 2147483647");
      await expect(
        service.create({
          code: "bad-factor",
          name: "Bad Factor",
          sources: [
            {
              kind: "latest",
              format: "json",
              url: "https://example.test",
              pricePath: "$.price",
              factor: Number.POSITIVE_INFINITY,
            },
          ],
        }),
      ).rejects.toThrow("factor must be a finite number");
      await expect(
        service.create({
          code: "bad-priority",
          name: "Bad Priority",
          priority: 2_147_483_648,
          sources: [
            {
              kind: "latest",
              format: "json",
              url: "https://example.test",
              pricePath: "$.price",
            },
          ],
        }),
      ).rejects.toThrow("Priority must be an integer between -2147483648 and 2147483647");
    } finally {
      db.close();
    }
  });

  test("updates providers while preserving omitted fields and replacing explicit empty sources", async () => {
    const db = createCustomProvidersDb();
    const syncEvents: CustomProviderSyncEvent[] = [];
    const service = createCustomProviderService(
      createCustomProviderRepository(db, { queueSyncEvent: (event) => syncEvents.push(event) }),
    );

    try {
      seedCustomProvider(db, {
        id: "uuid-demo",
        code: "demo",
        name: "Demo",
        description: "Initial",
        enabled: true,
        priority: 15,
        config: JSON.stringify({
          sources: [
            {
              kind: "historical",
              format: "csv",
              url: "https://example.test/history/{SYMBOL}",
              pricePath: "1",
            },
          ],
        }),
      });

      const renamed = await service.update("demo", {
        name: "Demo Updated",
        description: null,
        enabled: null,
        sources: null,
      });
      expect(renamed).toMatchObject({
        id: "demo",
        name: "Demo Updated",
        description: "Initial",
        enabled: true,
        priority: 15,
        sources: [expect.objectContaining({ kind: "historical" })],
      });

      const clearedSources = await service.update("demo", {
        sources: [],
        enabled: false,
      });
      expect(clearedSources).toMatchObject({
        id: "demo",
        enabled: false,
        sources: [],
      });
      expect(syncEvents.map((event) => event.operation)).toEqual(["Update", "Update"]);
      expect(syncEvents.every((event) => event.providerUuid === "uuid-demo")).toBe(true);
      await expect(service.update("demo", { priority: 4.5 })).rejects.toThrow(
        "Priority must be an integer between -2147483648 and 2147483647",
      );
      await expect(service.update("demo", { priority: -2_147_483_649 })).rejects.toThrow(
        "Priority must be an integer between -2147483648 and 2147483647",
      );
      await expect(
        service.update("demo", {
          sources: [
            {
              kind: "historical",
              format: "csv",
              url: "https://example.test/history/{SYMBOL}",
              pricePath: "1",
              defaultPrice: Number.NaN,
            },
          ],
        }),
      ).rejects.toThrow("defaultPrice must be a finite number");
      expect(syncEvents.map((event) => event.operation)).toEqual(["Update", "Update"]);
    } finally {
      db.close();
    }
  });

  test("guards deletes by provider existence and both asset reference forms", async () => {
    const db = createCustomProvidersDb();
    const syncEvents: CustomProviderSyncEvent[] = [];
    const service = createCustomProviderService(
      createCustomProviderRepository(db, { queueSyncEvent: (event) => syncEvents.push(event) }),
    );

    try {
      seedCustomProvider(db, {
        id: "uuid-demo",
        code: "demo",
        name: "Demo",
        priority: 10,
      });

      await expect(service.delete("missing")).rejects.toThrow(
        "Provider 'missing' not found or is not a custom provider",
      );
      seedAssetProviderConfig(db, "asset-json", '{"custom_provider_code":"demo"}');
      seedAssetProviderConfig(db, "asset-override", '{"overrides":{"CUSTOM:demo":true}}');
      await expect(service.delete("demo")).rejects.toThrow(
        "Cannot delete 'demo': 2 asset(s) still use it as preferred provider",
      );

      db.prepare("DELETE FROM assets").run();
      await expect(service.delete("demo")).resolves.toBeUndefined();
      expect(syncEvents).toEqual([
        {
          providerUuid: "uuid-demo",
          operation: "Delete",
          payload: { id: "uuid-demo" },
        },
      ]);
    } finally {
      db.close();
    }
  });

  test("tests JSON sources with template expansion, headers, secrets, and OHLC extraction", async () => {
    const db = createCustomProvidersDb();
    const calls: Array<{ url: string; headers: Headers }> = [];
    const service = createCustomProviderService(createCustomProviderRepository(db), {
      fetchImpl: ((input, init) => {
        calls.push({ url: input.toString(), headers: new Headers(init?.headers) });
        return Promise.resolve(
          jsonResponse({
            body: {
              fundPrice: {
                content: [
                  {
                    price: "2",
                    open: "1",
                    high: "2",
                    low: "0",
                    volume: "10",
                    effectiveDate: "2026-05-03",
                    currencyCode: "GBP",
                  },
                  {
                    price: "4",
                    open: "2",
                    high: "1",
                    low: "0",
                    volume: "20",
                    effectiveDate: "2026-05-04",
                    currencyCode: "GBP",
                  },
                ],
              },
            },
          }),
        );
      }) satisfies NonNullable<CustomProviderServiceOptions["fetchImpl"]>,
      now: () => new Date("2026-05-04T12:34:56Z"),
      secretService: {
        setSecret() {},
        getSecret(secretKey) {
          return secretKey === "api_key" ? "resolved-secret" : null;
        },
        deleteSecret() {},
      },
    });

    try {
      const request: TestSourceRequest = {
        format: "json",
        url: "https://api.example.test/{SYMBOL}?start={DATE:%Y-01-01}&end={TODAY}&from={FROM}&to={TO}&ccy={currency}&upper={CURRENCY}&doy={DATE:%j}&weekday={DATE:%a-%A-%u-%w}&compact={DATE:%C-%D-%R-%h}",
        pricePath: "$.body.fundPrice.content[-1:].price",
        openPath: "$.body.fundPrice.content[-1:].open",
        highPath: "$.body.fundPrice.content[-1:].high",
        lowPath: "$.body.fundPrice.content[-1:].low",
        volumePath: "$.body.fundPrice.content[-1:].volume",
        datePath: "$.body.fundPrice.content[-1:].effectiveDate",
        currencyPath: "$.body.fundPrice.content[-1:].currencyCode",
        factor: 2,
        invert: true,
        headers: JSON.stringify({
          Authorization: "__SECRET__api_key",
          Accept: "application/vnd.test",
          "X-Num": 5,
          "Bad Header": "ignored",
          "X-Bad": "line\nbreak",
          "X-Ctrl": "bad\u001fvalue",
          "X-Del": "bad\u007fvalue",
          "X-Tab": "ok\tvalue",
          "X-Accent": "café",
        }),
        symbol: "M219",
        currency: "gbp",
        from: "2026-05-01",
        to: "2026-05-04",
      };
      const result = await service.testSource(request);

      expect(result).toMatchObject({
        success: true,
        statusCode: 200,
        price: 0.125,
        open: 0.25,
        high: 0.5,
        low: 0,
        volume: 20,
        date: "2026-05-04",
        currency: "GBP",
      });
      expect(calls[0]?.url).toBe(
        "https://api.example.test/M219?start=2026-01-01&end=2026-05-04&from=2026-05-01&to=2026-05-04&ccy=gbp&upper=GBP&doy=124&weekday=Mon-Monday-1-1&compact=20-05/04/26-12:34-May",
      );
      expect(calls[0]?.headers.get("authorization")).toBe("resolved-secret");
      expect(calls[0]?.headers.get("accept")).toBe("application/vnd.test");
      expect(calls[0]?.headers.get("x-num")).toBeNull();
      expect(calls[0]?.headers.get("x-bad")).toBeNull();
      expect(calls[0]?.headers.get("x-ctrl")).toBeNull();
      expect(calls[0]?.headers.get("x-del")).toBeNull();
      expect(calls[0]?.headers.get("x-tab")).toBe("ok\tvalue");
      expect(calls[0]?.headers.get("x-accent")).toBe("café");
      expect(Array.from(calls[0]?.headers.keys() ?? [])).not.toContain("bad header");
      expect(calls[0]?.headers.get("referer")).toBe("https://api.example.test/");
      expect(calls[0]?.headers.get("user-agent")).toContain("Chrome/131.0.0.0");

      await expect(
        service.testSource({
          ...baseTestSourceRequest(),
          headers: JSON.stringify({
            "Bad Secret": "__SECRET__missing_secret",
          }),
        }),
      ).rejects.toThrow("Secret 'missing_secret' not found");

      const rows = await service.fetchSourceRows({
        ...request,
        pricePath: "$.body.fundPrice.content[*].price",
        openPath: "$.body.fundPrice.content[*].open",
        highPath: "$.body.fundPrice.content[*].high",
        lowPath: "$.body.fundPrice.content[*].low",
        volumePath: "$.body.fundPrice.content[*].volume",
        datePath: "$.body.fundPrice.content[*].effectiveDate",
        currencyPath: "$.body.fundPrice.content[*].currencyCode",
      });
      expect(rows).toEqual({
        statusCode: 200,
        currency: "GBP",
        rows: [
          {
            price: 0.25,
            open: 0.5,
            high: 0.25,
            low: 0,
            volume: 10,
            date: "2026-05-03",
          },
          {
            price: 0.125,
            open: 0.25,
            high: 0.5,
            low: 0,
            volume: 20,
            date: "2026-05-04",
          },
        ],
      });

      const jsonLocaleService = createCustomProviderService(createCustomProviderRepository(db), {
        fetchImpl: (() =>
          Promise.resolve(
            jsonResponse({
              price: "4,832",
              prices: ["4,832"],
            }),
          )) satisfies NonNullable<CustomProviderServiceOptions["fetchImpl"]>,
      });
      await expect(
        jsonLocaleService.testSource({
          ...baseTestSourceRequest(),
          locale: "de-DE",
        }),
      ).resolves.toMatchObject({
        success: true,
        price: 4832,
      });
      await expect(
        jsonLocaleService.fetchSourceRows({
          ...baseTestSourceRequest(),
          pricePath: "$.prices[*]",
          locale: "de-DE",
        }),
      ).resolves.toEqual({
        statusCode: 200,
        currency: "USD",
        rows: [
          {
            price: 4.832,
            open: null,
            high: null,
            low: null,
            volume: null,
            date: null,
          },
        ],
      });

      const earlyCalls: string[] = [];
      const earlyNow = new Date(Date.UTC(2000, 0, 1, 12, 34, 56));
      earlyNow.setUTCFullYear(0, 1, 29);
      const earlyService = createCustomProviderService(createCustomProviderRepository(db), {
        fetchImpl: ((input) => {
          earlyCalls.push(input.toString());
          return Promise.resolve(
            jsonResponse({
              price: "1",
              effectiveDate: "0000-02-29",
              currencyCode: "USD",
            }),
          );
        }) satisfies NonNullable<CustomProviderServiceOptions["fetchImpl"]>,
        now: () => earlyNow,
      });
      await expect(
        earlyService.testSource({
          ...baseTestSourceRequest(),
          url: "https://api.example.test/{SYMBOL}?year={DATE:%Y}&full={DATE:%F}&century={DATE:%C}&doy={DATE:%j}&weekday={DATE:%a-%A-%u-%w}&short={DATE:%D-%h}",
          datePath: "$.effectiveDate",
          currencyPath: "$.currencyCode",
        }),
      ).resolves.toMatchObject({ success: true, date: "0000-02-29" });
      expect(earlyCalls).toEqual([
        "https://api.example.test/AAPL?year=0000&full=0000-02-29&century=00&doy=060&weekday=Tue-Tuesday-2-2&short=02/29/00-Feb",
      ]);
    } finally {
      db.close();
    }
  });

  test("distinguishes network failures, HTTP failures, oversized responses, and redirects", async () => {
    const networkDb = createCustomProvidersDb();
    const networkService = createCustomProviderService(createCustomProviderRepository(networkDb), {
      fetchImpl: (() => Promise.reject(new Error("connection refused"))) satisfies NonNullable<
        CustomProviderServiceOptions["fetchImpl"]
      >,
    });
    try {
      await expect(networkService.testSource(baseTestSourceRequest())).resolves.toMatchObject({
        success: false,
        statusCode: null,
        error: "HTTP request failed: connection refused",
        rawResponse: null,
      });
    } finally {
      networkDb.close();
    }

    const httpDb = createCustomProvidersDb();
    const httpService = createCustomProviderService(createCustomProviderRepository(httpDb), {
      fetchImpl: (() =>
        Promise.resolve(
          new Response("Forbidden body".repeat(60), { status: 403 }),
        )) satisfies NonNullable<CustomProviderServiceOptions["fetchImpl"]>,
    });
    try {
      const result = await httpService.testSource(baseTestSourceRequest());
      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(403);
      expect(result.error).toStartWith("HTTP 403");
      expect(result.error?.length).toBeLessThanOrEqual(520);
      expect(result.rawResponse).toContain("Forbidden body");
    } finally {
      httpDb.close();
    }

    const statusTextDb = createCustomProvidersDb();
    const statusTextService = createCustomProviderService(
      createCustomProviderRepository(statusTextDb),
      {
        fetchImpl: (() =>
          Promise.resolve(
            new Response("teapot", {
              status: 418,
              statusText: "Custom Teapot",
            }),
          )) satisfies NonNullable<CustomProviderServiceOptions["fetchImpl"]>,
      },
    );
    try {
      await expect(statusTextService.testSource(baseTestSourceRequest())).resolves.toMatchObject({
        success: false,
        statusCode: 418,
        error: "HTTP 418 I'm a teapot: teapot",
      });
    } finally {
      statusTextDb.close();
    }

    const unknownStatusDb = createCustomProvidersDb();
    const unknownStatusService = createCustomProviderService(
      createCustomProviderRepository(unknownStatusDb),
      {
        fetchImpl: (() =>
          Promise.resolve(
            new Response("unknown", {
              status: 520,
              statusText: "Unknown Custom",
            }),
          )) satisfies NonNullable<CustomProviderServiceOptions["fetchImpl"]>,
      },
    );
    try {
      await expect(unknownStatusService.testSource(baseTestSourceRequest())).resolves.toMatchObject(
        {
          success: false,
          statusCode: 520,
          error: "HTTP 520 <unknown status code>: unknown",
        },
      );
    } finally {
      unknownStatusDb.close();
    }

    const nodeOnlyStatusDb = createCustomProvidersDb();
    const nodeOnlyStatusService = createCustomProviderService(
      createCustomProviderRepository(nodeOnlyStatusDb),
      {
        fetchImpl: (() =>
          Promise.resolve(
            new Response("node-only", {
              status: 509,
              statusText: "Bandwidth Limit Exceeded",
            }),
          )) satisfies NonNullable<CustomProviderServiceOptions["fetchImpl"]>,
      },
    );
    try {
      await expect(
        nodeOnlyStatusService.testSource(baseTestSourceRequest()),
      ).resolves.toMatchObject({
        success: false,
        statusCode: 509,
        error: "HTTP 509 <unknown status code>: node-only",
      });
    } finally {
      nodeOnlyStatusDb.close();
    }

    const oversizedDb = createCustomProvidersDb();
    const oversizedService = createCustomProviderService(
      createCustomProviderRepository(oversizedDb),
      {
        fetchImpl: (() =>
          Promise.resolve(
            new Response("not read", { status: 200, headers: { "content-length": "11" } }),
          )) satisfies NonNullable<CustomProviderServiceOptions["fetchImpl"]>,
        responseSizeLimitBytes: 10,
      },
    );
    try {
      await expect(oversizedService.testSource(baseTestSourceRequest())).resolves.toMatchObject({
        success: false,
        statusCode: 200,
        error: "Response body too large (11 bytes, max 10)",
      });
    } finally {
      oversizedDb.close();
    }

    const invalidUtf8Db = createCustomProvidersDb();
    const invalidUtf8Service = createCustomProviderService(
      createCustomProviderRepository(invalidUtf8Db),
      {
        fetchImpl: (() =>
          Promise.resolve(
            new Response(new Uint8Array([0xff]), { status: 200 }),
          )) satisfies NonNullable<CustomProviderServiceOptions["fetchImpl"]>,
      },
    );
    try {
      const result = await invalidUtf8Service.testSource(baseTestSourceRequest());
      expect(result).toMatchObject({
        success: false,
        statusCode: 200,
        rawResponse: null,
      });
      expect(result.error).toStartWith("Response body is not valid UTF-8:");
    } finally {
      invalidUtf8Db.close();
    }

    const retryDb = createCustomProvidersDb();
    let serverRetryCalls = 0;
    const retryService = createCustomProviderService(createCustomProviderRepository(retryDb), {
      fetchImpl: (() => {
        serverRetryCalls += 1;
        return Promise.resolve(
          serverRetryCalls === 1
            ? new Response("temporary outage", { status: 503 })
            : jsonResponse({ price: 64 }),
        );
      }) satisfies NonNullable<CustomProviderServiceOptions["fetchImpl"]>,
    });
    try {
      await expect(retryService.testSource(baseTestSourceRequest())).resolves.toMatchObject({
        success: true,
        price: 64,
      });
      expect(serverRetryCalls).toBe(2);
    } finally {
      retryDb.close();
    }

    const networkRetryDb = createCustomProvidersDb();
    let networkRetryCalls = 0;
    const networkRetryService = createCustomProviderService(
      createCustomProviderRepository(networkRetryDb),
      {
        fetchImpl: (() => {
          networkRetryCalls += 1;
          return networkRetryCalls === 1
            ? Promise.reject(new Error("socket hang up"))
            : jsonResponse({ price: 65 });
        }) satisfies NonNullable<CustomProviderServiceOptions["fetchImpl"]>,
      },
    );
    try {
      await expect(networkRetryService.testSource(baseTestSourceRequest())).resolves.toMatchObject({
        success: true,
        price: 65,
      });
      expect(networkRetryCalls).toBe(2);
    } finally {
      networkRetryDb.close();
    }

    const redirectDb = createCustomProvidersDb();
    const redirectCalls: string[] = [];
    const redirectService = createCustomProviderService(
      createCustomProviderRepository(redirectDb),
      {
        fetchImpl: ((input) => {
          redirectCalls.push(input.toString());
          return Promise.resolve(
            redirectCalls.length <= 5
              ? new Response(null, {
                  status: 302,
                  headers: { location: `/hop-${redirectCalls.length}` },
                })
              : jsonResponse({ price: 42 }),
          );
        }) satisfies NonNullable<CustomProviderServiceOptions["fetchImpl"]>,
      },
    );
    try {
      await expect(redirectService.testSource(baseTestSourceRequest())).resolves.toMatchObject({
        success: true,
        price: 42,
      });
      expect(redirectCalls).toEqual([
        "https://example.test/quote",
        "https://example.test/hop-1",
        "https://example.test/hop-2",
        "https://example.test/hop-3",
        "https://example.test/hop-4",
        "https://example.test/hop-5",
      ]);
    } finally {
      redirectDb.close();
    }
  });

  test("uses default prices for empty URLs and fetch failures like Rust", async () => {
    const db = createCustomProvidersDb();
    const calls: string[] = [];
    const service = createCustomProviderService(createCustomProviderRepository(db), {
      fetchImpl: ((input) => {
        const url = input.toString();
        calls.push(url);
        if (url.includes("invalid-utf8")) {
          return Promise.resolve(new Response(new Uint8Array([0xff]), { status: 200 }));
        }
        if (url.includes("network")) {
          return Promise.reject(new Error("connection refused"));
        }
        return Promise.resolve(new Response("Service down", { status: 503 }));
      }) satisfies NonNullable<CustomProviderServiceOptions["fetchImpl"]>,
    });

    try {
      await expect(
        service.testSource({
          ...baseTestSourceRequest(),
          url: "",
          defaultPrice: 12.34,
          currency: "CAD",
          factor: 2,
          invert: true,
        }),
      ).resolves.toMatchObject({
        success: true,
        statusCode: null,
        price: 12.34,
        currency: "CAD",
      });

      await expect(
        service.fetchSourceRows({
          ...baseTestSourceRequest(),
          url: "",
          defaultPrice: 56.78,
          currency: "EUR",
        }),
      ).resolves.toEqual({
        statusCode: null,
        currency: "EUR",
        rows: [
          {
            price: 56.78,
            open: null,
            high: null,
            low: null,
            volume: null,
            date: null,
          },
        ],
      });

      await expect(
        service.testSource({
          ...baseTestSourceRequest(),
          url: "https://example.test/network",
          defaultPrice: 9.5,
        }),
      ).resolves.toMatchObject({
        success: true,
        statusCode: null,
        price: 9.5,
        currency: "USD",
      });

      await expect(
        service.testSource({
          ...baseTestSourceRequest(),
          url: "https://example.test/http",
          defaultPrice: 8.75,
          currency: "GBP",
        }),
      ).resolves.toMatchObject({
        success: true,
        statusCode: 503,
        price: 8.75,
        currency: "GBP",
        rawResponse: null,
      });

      await expect(
        service.testSource({
          ...baseTestSourceRequest(),
          url: "https://example.test/invalid-utf8",
          defaultPrice: 7.25,
          currency: "AUD",
        }),
      ).resolves.toMatchObject({
        success: true,
        statusCode: 200,
        price: 7.25,
        currency: "AUD",
      });
      await expect(
        service.testSource({
          ...baseTestSourceRequest(),
          factor: Number.POSITIVE_INFINITY,
        }),
      ).rejects.toThrow("factor must be a finite number");
      await expect(
        service.fetchSourceRows({
          ...baseTestSourceRequest(),
          defaultPrice: Number.NaN,
        }),
      ).rejects.toThrow("defaultPrice must be a finite number");

      expect(calls).toEqual([
        "https://example.test/network",
        "https://example.test/network",
        "https://example.test/http",
        "https://example.test/http",
        "https://example.test/invalid-utf8",
      ]);
    } finally {
      db.close();
    }
  });

  test("tests CSV sources with delimiter detection, last-row extraction, and locale parsing", async () => {
    const db = createCustomProvidersDb();
    const service = createCustomProviderService(createCustomProviderRepository(db), {
      fetchImpl: (() =>
        Promise.resolve(
          new Response(
            [
              "datetime;open;high;low;close;volume",
              "2026-05-03;1.234,56;1.300,00;1.200,00;4,832;100",
              "2026-05-04;2.000,00;2.100,00;1.900,00;1.234,56;200",
            ].join("\n"),
            { status: 200 },
          ),
        )) satisfies NonNullable<CustomProviderServiceOptions["fetchImpl"]>,
    });

    try {
      const result = await service.testSource({
        ...baseTestSourceRequest(),
        format: "csv",
        pricePath: "close",
        openPath: "open",
        highPath: "high",
        lowPath: "low",
        volumePath: "volume",
        datePath: "datetime",
        locale: "de-DE",
      });

      expect(result).toMatchObject({
        success: true,
        price: 1234.56,
        open: 2000,
        high: 2100,
        low: 1900,
        volume: 200,
        date: "2026-05-04",
      });

      const csvRows = await service.fetchSourceRows({
        ...baseTestSourceRequest(),
        format: "csv",
        pricePath: "close",
        datePath: "datetime",
        locale: "de-DE",
      });
      expect(csvRows).toMatchObject({
        statusCode: 200,
        currency: "USD",
        rows: [
          { price: 4.832, date: "2026-05-03" },
          { price: 1234.56, date: "2026-05-04" },
        ],
      });

      const rustUnsignedColumnResult = await service.testSource({
        ...baseTestSourceRequest(),
        format: "csv",
        pricePath: "+04",
        locale: "de-DE",
      });
      expect(rustUnsignedColumnResult).toMatchObject({
        success: true,
        price: 1234.56,
      });

      for (const pricePath of ["4.0", "4e0", " 4"]) {
        const invalidColumnResult = await service.testSource({
          ...baseTestSourceRequest(),
          format: "csv",
          pricePath,
          locale: "de-DE",
        });
        expect(invalidColumnResult).toMatchObject({
          success: false,
          error: `Could not extract price from CSV using column '${pricePath}'`,
          price: null,
        });
      }
    } finally {
      db.close();
    }
  });

  test("tests HTML sources with CSS extraction and detected element context", async () => {
    const db = createCustomProvidersDb();
    const service = createCustomProviderService(createCustomProviderRepository(db), {
      fetchImpl: (() =>
        Promise.resolve(
          new Response(
            `<html lang="de"><body><div class="quote"><span>Official Close</span><strong id="price">1.234,56 €</strong></div></body></html>`,
            { status: 200 },
          ),
        )) satisfies NonNullable<CustomProviderServiceOptions["fetchImpl"]>,
    });

    try {
      const result = await service.testSource({
        ...baseTestSourceRequest(),
        format: "html",
        pricePath: "#price",
        locale: "de-DE",
      });

      expect(result).toMatchObject({
        success: true,
        price: 1234.56,
        rawResponse: null,
      });
      expect(result.detectedElements).toEqual([
        expect.objectContaining({
          selector: "#price",
          value: 1234.56,
          text: "1.234,56 €",
          label: "Official Close",
        }),
      ]);
    } finally {
      db.close();
    }
  });

  test("tests HTML table sources with Rust-compatible header-row handling", async () => {
    const db = createCustomProvidersDb();
    const service = createCustomProviderService(createCustomProviderRepository(db), {
      fetchImpl: (() =>
        Promise.resolve(
          new Response(
            `<html><body><table>
              <tr><td>Datum</td><td>Erster</td><td>Hoch</td><td>Tief</td><td>Schluss</td><td>Volumen</td></tr>
              <tr><td>04.05.26</td><td>781,68 €</td><td>794,70 €</td><td>781,68 €</td><td>794,70 €</td><td>1.589 €</td></tr>
              <tr><td>30.04.26</td><td>805,57 €</td><td>805,57 €</td><td>798,89 €</td><td>798,89 €</td><td>0 €</td></tr>
            </table></body></html>`,
            { status: 200 },
          ),
        )) satisfies NonNullable<CustomProviderServiceOptions["fetchImpl"]>,
    });

    try {
      const result = await service.testSource({
        ...baseTestSourceRequest(),
        format: "html_table",
        pricePath: "0:4",
        datePath: "0:0",
        volumePath: "0:5",
        locale: "de-DE",
      });

      expect(result).toMatchObject({
        success: true,
        price: 794.7,
        volume: 1589,
        date: "04.05.26",
      });
      expect(result.detectedTables?.[0]).toMatchObject({
        rowCount: 2,
        columns: [
          { index: 0, header: "Datum", role: "date" },
          { index: 1, header: "Erster", role: null },
          { index: 2, header: "Hoch", role: "high" },
          { index: 3, header: "Tief", role: "low" },
          { index: 4, header: "Schluss", role: "close" },
          { index: 5, header: "Volumen", role: "volume" },
        ],
      });

      const previewResult = await service.testSource({
        ...baseTestSourceRequest(),
        format: "html_table",
        pricePath: "",
        locale: "de-DE",
      });
      expect(previewResult).toMatchObject({
        success: true,
        price: null,
        error: null,
      });
      expect(previewResult.detectedTables?.length).toBe(1);

      const rustUnsignedPathResult = await service.testSource({
        ...baseTestSourceRequest(),
        format: "html_table",
        pricePath: "+00:04",
        locale: "de-DE",
      });
      expect(rustUnsignedPathResult).toMatchObject({
        success: true,
        price: 794.7,
      });

      const exponentPathResult = await service.testSource({
        ...baseTestSourceRequest(),
        format: "html_table",
        pricePath: "0e0:4",
        locale: "de-DE",
      });
      expect(exponentPathResult).toMatchObject({
        success: true,
        error: null,
        price: null,
      });
      expect(exponentPathResult.detectedTables?.length).toBe(1);

      const decimalPathResult = await service.testSource({
        ...baseTestSourceRequest(),
        format: "html_table",
        pricePath: "0:4.0",
        locale: "de-DE",
      });
      expect(decimalPathResult).toMatchObject({
        success: true,
        error: null,
        price: null,
      });

      const whitespacePathResult = await service.testSource({
        ...baseTestSourceRequest(),
        format: "html_table",
        pricePath: " 0:4",
        locale: "de-DE",
      });
      expect(whitespacePathResult).toMatchObject({
        success: true,
        error: null,
        price: null,
      });
    } finally {
      db.close();
    }
  });

  test("fetches HTML rows using lang locale fallback like Rust runtime", async () => {
    const db = createCustomProvidersDb();
    const service = createCustomProviderService(createCustomProviderRepository(db), {
      fetchImpl: ((input) =>
        Promise.resolve(
          new Response(
            input.toString().endsWith("/table")
              ? `<html lang="de-DE"><body><table>
                <tr><td>Datum</td><td>Schluss</td><td>Volumen</td></tr>
                <tr><td>2026-05-04</td><td>4,832 €</td><td>1.234</td></tr>
              </table></body></html>`
              : `<html lang="de-DE"><body><strong id="price">4,832 €</strong></body></html>`,
            { status: 200 },
          ),
        )) satisfies NonNullable<CustomProviderServiceOptions["fetchImpl"]>,
    });

    try {
      await expect(
        service.fetchSourceRows({
          ...baseTestSourceRequest(),
          format: "html",
          url: "https://example.test/quote",
          pricePath: "#price",
        }),
      ).resolves.toEqual({
        statusCode: 200,
        currency: "USD",
        rows: [
          {
            price: 4.832,
            open: null,
            high: null,
            low: null,
            volume: null,
            date: null,
          },
        ],
      });

      await expect(
        service.fetchSourceRows({
          ...baseTestSourceRequest(),
          format: "html_table",
          url: "https://example.test/table",
          pricePath: "0:1",
          datePath: "0:0",
          volumePath: "0:2",
        }),
      ).resolves.toEqual({
        statusCode: 200,
        currency: "USD",
        rows: [
          {
            price: 4.832,
            open: null,
            high: null,
            low: null,
            volume: 1234,
            date: "2026-05-04",
          },
        ],
      });
    } finally {
      db.close();
    }
  });
});

function createCustomProvidersDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE market_data_custom_providers (
      id TEXT NOT NULL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 50,
      config TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE assets (
      id TEXT NOT NULL PRIMARY KEY,
      provider_config TEXT
    );
  `);
  return db;
}

function seedCustomProvider(
  db: Database,
  provider: {
    id: string;
    code: string;
    name: string;
    description?: string;
    enabled?: boolean;
    priority: number;
    config?: string | null;
  },
): void {
  db.prepare(
    `
      INSERT INTO market_data_custom_providers (
        id, code, name, description, enabled, priority, config, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    provider.id,
    provider.code,
    provider.name,
    provider.description ?? "",
    provider.enabled === false ? 0 : 1,
    provider.priority,
    provider.config ?? null,
    "2026-01-01T00:00:00Z",
    "2026-01-01T00:00:00Z",
  );
}

function seedAssetProviderConfig(db: Database, id: string, providerConfig: string): void {
  db.prepare("INSERT INTO assets (id, provider_config) VALUES (?, ?)").run(id, providerConfig);
}

function baseTestSourceRequest(): TestSourceRequest {
  return {
    format: "json",
    url: "https://example.test/quote",
    pricePath: "$.price",
    symbol: "AAPL",
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
}
