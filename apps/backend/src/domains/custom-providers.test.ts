import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import {
  createCustomProviderRepository,
  createCustomProviderService,
  type CustomProviderSyncEvent,
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
