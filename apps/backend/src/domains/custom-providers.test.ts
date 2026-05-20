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

      expect(service.getAll()).toEqual([
        expect.objectContaining({ id: "low", sources: [] }),
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
      ]);
      expect(service.getSourceByKind("high", "latest")).toEqual(
        expect.objectContaining({ id: "high:latest" }),
      );
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
      ).rejects.toThrow("Invalid source format 'xml'");
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
        url: "https://api.example.test/{SYMBOL}?start={DATE:%Y-01-01}&end={TODAY}&from={FROM}&to={TO}&ccy={currency}&upper={CURRENCY}",
        pricePath: "$.body.fundPrice.content[-1:].price",
        openPath: "$.body.fundPrice.content[-1:].open",
        highPath: "$.body.fundPrice.content[-1:].high",
        lowPath: "$.body.fundPrice.content[-1:].low",
        volumePath: "$.body.fundPrice.content[-1:].volume",
        datePath: "$.body.fundPrice.content[-1:].effectiveDate",
        currencyPath: "$.body.fundPrice.content[-1:].currencyCode",
        factor: 2,
        invert: true,
        headers: '{"Authorization":"__SECRET__api_key","Accept":"application/vnd.test","X-Num":5}',
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
        "https://api.example.test/M219?start=2026-01-01&end=2026-05-04&from=2026-05-01&to=2026-05-04&ccy=gbp&upper=GBP",
      );
      expect(calls[0]?.headers.get("authorization")).toBe("resolved-secret");
      expect(calls[0]?.headers.get("accept")).toBe("application/vnd.test");
      expect(calls[0]?.headers.get("x-num")).toBeNull();
      expect(calls[0]?.headers.get("referer")).toBe("https://api.example.test/");
      expect(calls[0]?.headers.get("user-agent")).toContain("Chrome/131.0.0.0");

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
      expect(result.error?.length).toBeLessThan(520);
      expect(result.rawResponse).toContain("Forbidden body");
    } finally {
      httpDb.close();
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
