import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import {
  createTaxonomyReadRepository,
  createTaxonomyReadService,
  createTaxonomyRepository,
  createTaxonomyService,
  type TaxonomyAssignmentSyncEvent,
  type TaxonomySyncEvent,
} from "./taxonomies";

describe("TS taxonomies domain", () => {
  test("lists taxonomies ordered by sort order with Rust-compatible booleans and dates", () => {
    const db = createTaxonomiesDb();
    const service = createTaxonomyReadService(createTaxonomyReadRepository(db));

    try {
      seedTaxonomy(db, {
        id: "regions",
        name: "Regions",
        color: "#8b7ec8",
        isSystem: true,
        isSingleSelect: false,
        sortOrder: 40,
      });
      seedTaxonomy(db, {
        id: "custom_groups",
        name: "Custom Groups",
        color: "#878580",
        isSystem: false,
        isSingleSelect: true,
        sortOrder: 10,
      });
      db.prepare("UPDATE taxonomies SET created_at = ? WHERE id = ?").run(
        "2026-01-01 02:30:00.123456+02:30",
        "custom_groups",
      );
      db.prepare("UPDATE taxonomies SET updated_at = ? WHERE id = ?").run(
        "2026-01-01t00:00:00z",
        "custom_groups",
      );

      expect(service.getTaxonomies()).toEqual([
        expect.objectContaining({
          id: "custom_groups",
          isSystem: false,
          isSingleSelect: true,
          createdAt: "2026-01-01T00:00:00.123456",
          updatedAt: "2026-01-01T00:00:00",
        }),
        expect.objectContaining({
          id: "regions",
          isSystem: true,
          isSingleSelect: false,
        }),
      ]);
    } finally {
      db.close();
    }
  });

  test("returns taxonomy with categories ordered by sort order", () => {
    const db = createTaxonomiesDb();
    const service = createTaxonomyReadService(createTaxonomyReadRepository(db));

    try {
      seedTaxonomy(db, {
        id: "asset_classes",
        name: "Asset Classes",
        color: "#879a39",
        isSystem: true,
        isSingleSelect: false,
        sortOrder: 20,
      });
      seedCategory(db, {
        id: "EQUITY",
        taxonomyId: "asset_classes",
        name: "Equity",
        key: "EQUITY",
        color: "#4385be",
        sortOrder: 2,
      });
      seedCategory(db, {
        id: "CASH",
        taxonomyId: "asset_classes",
        name: "Cash",
        key: "CASH",
        color: "#879a39",
        sortOrder: 1,
      });

      expect(service.getTaxonomy("asset_classes")).toEqual({
        taxonomy: expect.objectContaining({ id: "asset_classes", name: "Asset Classes" }),
        categories: [
          expect.objectContaining({ id: "CASH", taxonomyId: "asset_classes" }),
          expect.objectContaining({ id: "EQUITY", taxonomyId: "asset_classes" }),
        ],
      });
      expect(service.getTaxonomy("missing")).toBeNull();
    } finally {
      db.close();
    }
  });

  test("creates, updates, and deletes custom taxonomies with sync hooks", async () => {
    const db = createTaxonomiesDb();
    const syncEvents: TaxonomySyncEvent[] = [];
    const service = createTaxonomyService(
      createTaxonomyRepository(db, { queueSyncEvent: (event) => syncEvents.push(event) }),
    );

    try {
      const created = await service.createTaxonomy({
        id: "strategy",
        name: "Strategy",
        color: "#4385be",
        description: "Custom strategy taxonomy",
        isSystem: false,
        isSingleSelect: true,
        sortOrder: 10,
      });
      expect(created).toMatchObject({
        id: "strategy",
        isSystem: false,
        isSingleSelect: true,
      });
      expect(syncEvents).toEqual([
        expect.objectContaining({
          taxonomyId: "strategy",
          operation: "Create",
          payload: {
            taxonomy: expect.objectContaining({ id: "strategy" }),
            categories: [],
          },
        }),
      ]);

      const updated = await service.updateTaxonomy({
        ...created,
        name: "Strategies",
        createdAt: "2025-01-01T00:00:00",
        isSingleSelect: false,
        sortOrder: 20,
      });
      expect(updated).toMatchObject({
        id: "strategy",
        name: "Strategies",
        createdAt: "2025-01-01T00:00:00",
        isSingleSelect: false,
        sortOrder: 20,
      });
      expect(syncEvents.at(-1)).toEqual(
        expect.objectContaining({
          taxonomyId: "strategy",
          operation: "Update",
          payload: expect.objectContaining({
            taxonomy: expect.objectContaining({ name: "Strategies" }),
          }),
        }),
      );
      await expect(
        service.createTaxonomy({
          id: "bad-priority",
          name: "Bad Priority",
          color: "#4385be",
          description: null,
          isSystem: false,
          isSingleSelect: true,
          sortOrder: 4.5,
        }),
      ).rejects.toThrow("sortOrder must be an integer between -2147483648 and 2147483647");
      await expect(
        service.updateTaxonomy({ ...updated, sortOrder: 2_147_483_648 }),
      ).rejects.toThrow("sortOrder must be an integer between -2147483648 and 2147483647");
      expect(syncEvents).toHaveLength(2);

      await expect(service.deleteTaxonomy("strategy")).resolves.toBe(1);
      expect(syncEvents.at(-1)).toEqual({
        taxonomyId: "strategy",
        operation: "Delete",
        payload: { id: "strategy" },
      });
      await expect(service.deleteTaxonomy("missing")).resolves.toBe(0);
    } finally {
      db.close();
    }
  });

  test("rejects system taxonomy deletes and skips sync for non-custom system taxonomy changes", async () => {
    const db = createTaxonomiesDb();
    const syncEvents: TaxonomySyncEvent[] = [];
    const service = createTaxonomyService(
      createTaxonomyRepository(db, { queueSyncEvent: (event) => syncEvents.push(event) }),
    );

    try {
      seedTaxonomy(db, {
        id: "asset_classes",
        name: "Asset Classes",
        color: "#879a39",
        isSystem: true,
        isSingleSelect: false,
        sortOrder: 20,
      });

      await expect(service.deleteTaxonomy("asset_classes")).rejects.toThrow(
        "Cannot delete system taxonomy",
      );
      await service.updateTaxonomy({
        id: "asset_classes",
        name: "Asset Classes",
        color: "#879a39",
        description: null,
        isSystem: true,
        isSingleSelect: false,
        sortOrder: 20,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      });
      expect(syncEvents).toEqual([]);
    } finally {
      db.close();
    }
  });

  test("creates, updates, moves, and deletes categories with child and assignment guards", async () => {
    const db = createTaxonomiesDb();
    const syncEvents: TaxonomySyncEvent[] = [];
    const service = createTaxonomyService(
      createTaxonomyRepository(db, { queueSyncEvent: (event) => syncEvents.push(event) }),
    );

    try {
      seedTaxonomy(db, {
        id: "custom_groups",
        name: "Custom Groups",
        color: "#878580",
        isSystem: true,
        isSingleSelect: false,
        sortOrder: 100,
      });

      const parent = await service.createCategory({
        id: "theme",
        taxonomyId: "custom_groups",
        name: "Theme",
        key: "theme",
        color: "#878580",
        sortOrder: 1,
      });
      const child = await service.createCategory({
        id: "ai",
        taxonomyId: "custom_groups",
        parentId: "theme",
        name: "AI",
        key: "ai",
        color: "#4385be",
        sortOrder: 2,
      });

      expect(syncEvents.at(-1)).toEqual(
        expect.objectContaining({
          taxonomyId: "custom_groups",
          operation: "Update",
          payload: expect.objectContaining({
            categories: expect.arrayContaining([expect.objectContaining({ id: "ai" })]),
          }),
        }),
      );

      await expect(service.deleteCategory("custom_groups", "theme")).rejects.toThrow(
        "Cannot delete category with children",
      );

      const moved = await service.moveCategory("custom_groups", "ai", null, 5);
      expect(moved).toMatchObject({ id: "ai", parentId: null, sortOrder: 5 });
      await expect(
        service.createCategory({
          id: "bad-sort",
          taxonomyId: "custom_groups",
          name: "Bad Sort",
          key: "bad-sort",
          color: "#4385be",
          sortOrder: 4.5,
        }),
      ).rejects.toThrow("sortOrder must be an integer between -2147483648 and 2147483647");
      await expect(
        service.moveCategory("custom_groups", "ai", null, 2_147_483_648),
      ).rejects.toThrow("position must be an integer between -2147483648 and 2147483647");

      db.prepare(
        `
          INSERT INTO asset_taxonomy_assignments (
            id, asset_id, taxonomy_id, category_id, weight, source
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `,
      ).run("assignment-1", "asset-1", "custom_groups", "ai", 10000, "manual");
      await expect(service.deleteCategory("custom_groups", "ai")).rejects.toThrow(
        "Cannot delete category with 1 asset assignments",
      );

      db.prepare("DELETE FROM asset_taxonomy_assignments WHERE id = ?").run("assignment-1");
      await expect(
        service.updateCategory({
          ...parent,
          createdAt: "2025-01-01T00:00:00",
          name: "Themes",
          sortOrder: 3,
        }),
      ).resolves.toMatchObject({
        id: "theme",
        createdAt: "2025-01-01T00:00:00",
        name: "Themes",
        sortOrder: 3,
      });
      await expect(
        service.updateCategory({ ...parent, sortOrder: -2_147_483_649 }),
      ).rejects.toThrow("sortOrder must be an integer between -2147483648 and 2147483647");
      await expect(service.deleteCategory("custom_groups", child.id)).resolves.toBe(1);
    } finally {
      db.close();
    }
  });

  test("upserts asset assignments and preserves original row identity on conflicts", async () => {
    const db = createTaxonomiesDb();
    const assignmentEvents: TaxonomyAssignmentSyncEvent[] = [];
    const service = createTaxonomyService(
      createTaxonomyRepository(db, {
        queueAssignmentSyncEvent: (event) => assignmentEvents.push(event),
      }),
    );

    try {
      seedTaxonomy(db, {
        id: "asset_classes",
        name: "Asset Classes",
        color: "#879a39",
        isSystem: true,
        isSingleSelect: false,
        sortOrder: 20,
      });
      seedCategory(db, {
        id: "EQUITY",
        taxonomyId: "asset_classes",
        name: "Equity",
        key: "EQUITY",
        color: "#4385be",
        sortOrder: 1,
      });

      const created = await service.assignAssetToCategory({
        id: "assignment-1",
        assetId: "asset-1",
        taxonomyId: "asset_classes",
        categoryId: "EQUITY",
        weight: 10_000,
        source: "manual",
      });
      const upserted = await service.assignAssetToCategory({
        id: "ignored-new-id",
        assetId: "asset-1",
        taxonomyId: "asset_classes",
        categoryId: "EQUITY",
        weight: 5_000,
        source: "provider",
      });

      expect(upserted).toMatchObject({
        id: created.id,
        weight: 5_000,
        source: "provider",
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      });
      expect(service.getAssetAssignments("asset-1")).toEqual([upserted]);
      expect(assignmentEvents).toEqual([
        expect.objectContaining({ assignmentId: "assignment-1", operation: "Update" }),
        expect.objectContaining({ assignmentId: "assignment-1", operation: "Update" }),
      ]);
      await expect(
        service.assignAssetToCategory({
          id: "bad-weight",
          assetId: "asset-2",
          taxonomyId: "asset_classes",
          categoryId: "EQUITY",
          weight: 4.5,
          source: "manual",
        }),
      ).rejects.toThrow("weight must be an integer between -2147483648 and 2147483647");
      await expect(
        service.assignAssetToCategory({
          id: "bad-weight",
          assetId: "asset-2",
          taxonomyId: "asset_classes",
          categoryId: "EQUITY",
          weight: 2_147_483_648,
          source: "manual",
        }),
      ).rejects.toThrow("weight must be an integer between -2147483648 and 2147483647");
      expect(assignmentEvents).toHaveLength(2);

      await expect(service.removeAssetAssignment("assignment-1")).resolves.toBe(1);
      expect(assignmentEvents.at(-1)).toEqual({
        assignmentId: "assignment-1",
        operation: "Delete",
        payload: { id: "assignment-1" },
      });
      await expect(service.removeAssetAssignment("missing")).resolves.toBe(0);
    } finally {
      db.close();
    }
  });

  test("replaces existing asset assignments for single-select taxonomies", async () => {
    const db = createTaxonomiesDb();
    const assignmentEvents: TaxonomyAssignmentSyncEvent[] = [];
    const service = createTaxonomyService(
      createTaxonomyRepository(db, {
        queueAssignmentSyncEvent: (event) => assignmentEvents.push(event),
      }),
    );

    try {
      seedTaxonomy(db, {
        id: "risk_category",
        name: "Risk Category",
        color: "#d14d41",
        isSystem: true,
        isSingleSelect: true,
        sortOrder: 50,
      });
      seedCategory(db, {
        id: "LOW",
        taxonomyId: "risk_category",
        name: "Low",
        key: "LOW",
        color: "#879a39",
        sortOrder: 1,
      });
      seedCategory(db, {
        id: "HIGH",
        taxonomyId: "risk_category",
        name: "High",
        key: "HIGH",
        color: "#d14d41",
        sortOrder: 2,
      });

      await service.assignAssetToCategory({
        id: "risk-low",
        assetId: "asset-1",
        taxonomyId: "risk_category",
        categoryId: "LOW",
        weight: 10_000,
        source: "manual",
      });
      const high = await service.assignAssetToCategory({
        id: "risk-high",
        assetId: "asset-1",
        taxonomyId: "risk_category",
        categoryId: "HIGH",
        weight: 10_000,
        source: "manual",
      });

      expect(service.getAssetAssignments("asset-1")).toEqual([high]);
      expect(assignmentEvents).toEqual([
        expect.objectContaining({ assignmentId: "risk-low", operation: "Update" }),
        { assignmentId: "risk-low", operation: "Delete", payload: { id: "risk-low" } },
        expect.objectContaining({ assignmentId: "risk-high", operation: "Update" }),
      ]);
    } finally {
      db.close();
    }
  });

  test("imports taxonomy JSON by flattening category trees", async () => {
    const db = createTaxonomiesDb();
    const service = createTaxonomyService(createTaxonomyRepository(db));

    try {
      const imported = await service.importTaxonomyJson(
        JSON.stringify({
          name: "Portfolio Performance Taxonomy",
          color: "#4385be",
          categories: [
            {
              name: "Equity",
              key: "equity",
              color: "#4385be",
              children: [
                {
                  name: "US Equity",
                  key: "us-equity",
                  color: "#8b7ec8",
                  description: "United States",
                },
              ],
            },
            {
              name: "Cash",
              key: "cash",
              color: "#879a39",
            },
          ],
          instruments: [
            {
              identifiers: { ticker: "IGNORED" },
              categories: [{ key: "equity", path: ["Equity"], weight: 1 }],
            },
          ],
        }),
      );
      const withCategories = service.getTaxonomy(imported.id);

      expect(imported).toMatchObject({
        name: "Portfolio Performance Taxonomy",
        color: "#4385be",
        isSystem: false,
        isSingleSelect: false,
        sortOrder: 0,
      });
      expect(withCategories?.categories).toEqual([
        expect.objectContaining({ parentId: null, name: "Equity", key: "equity", sortOrder: 0 }),
        expect.objectContaining({
          name: "US Equity",
          key: "us-equity",
          description: "United States",
          sortOrder: 1,
        }),
        expect.objectContaining({ parentId: null, name: "Cash", key: "cash", sortOrder: 2 }),
      ]);
      const equity = withCategories?.categories.find((category) => category.key === "equity");
      const usEquity = withCategories?.categories.find((category) => category.key === "us-equity");
      expect(usEquity?.parentId).toBe(equity?.id);
      await expect(service.importTaxonomyJson("{bad")).rejects.toThrow("Invalid JSON");
    } finally {
      db.close();
    }
  });

  test("exports taxonomy JSON as a sorted tree without instrument mappings", () => {
    const db = createTaxonomiesDb();
    const service = createTaxonomyService(createTaxonomyRepository(db));

    try {
      seedTaxonomy(db, {
        id: "asset_classes",
        name: "Asset Classes",
        color: "#879a39",
        isSystem: true,
        isSingleSelect: false,
        sortOrder: 20,
      });
      seedCategory(db, {
        id: "EQUITY",
        taxonomyId: "asset_classes",
        name: "Equity",
        key: "equity",
        color: "#4385be",
        sortOrder: 2,
      });
      seedCategory(db, {
        id: "US_EQUITY",
        taxonomyId: "asset_classes",
        parentId: "EQUITY",
        name: "US Equity",
        key: "us-equity",
        color: "#8b7ec8",
        description: "United States",
        sortOrder: 1,
      });
      seedCategory(db, {
        id: "CASH",
        taxonomyId: "asset_classes",
        name: "Cash",
        key: "cash",
        color: "#879a39",
        sortOrder: 1,
      });

      expect(JSON.parse(service.exportTaxonomyJson("asset_classes"))).toEqual({
        name: "Asset Classes",
        color: "#879a39",
        categories: [
          {
            name: "Cash",
            key: "cash",
            color: "#879a39",
            description: null,
            children: [],
          },
          {
            name: "Equity",
            key: "equity",
            color: "#4385be",
            description: null,
            children: [
              {
                name: "US Equity",
                key: "us-equity",
                color: "#8b7ec8",
                description: "United States",
                children: [],
              },
            ],
          },
        ],
        instruments: [],
      });
      expect(() => service.exportTaxonomyJson("missing")).toThrow("Taxonomy not found");
    } finally {
      db.close();
    }
  });

  test("reports legacy classification migration status with Rust-compatible counting", async () => {
    const db = createTaxonomiesDb();
    const service = createTaxonomyService(createTaxonomyRepository(db));

    try {
      seedClassificationTaxonomies(db);
      seedAsset(db, {
        id: "inactive-empty-array",
        isActive: false,
        metadata: { legacy: { sectors: [] } },
      });
      seedAsset(db, {
        id: "already-migrated",
        metadata: { legacy: { sectors: [{ name: "Technology", weight: 1 }] } },
      });
      await service.assignAssetToCategory({
        id: "existing-gics",
        assetId: "already-migrated",
        taxonomyId: "industries_gics",
        categoryId: "45",
        weight: 10_000,
        source: "manual",
      });
      seedAsset(db, {
        id: "null-legacy-value",
        metadata: { legacy: { countries: null } },
      });

      await expect(service.getMigrationStatus?.()).resolves.toEqual({
        needed: true,
        assetsWithLegacyData: 1,
        assetsAlreadyMigrated: 1,
      });
    } finally {
      db.close();
    }
  });

  test("migrates legacy sector and country assignments and cleans metadata", async () => {
    const db = createTaxonomiesDb();
    const service = createTaxonomyService(createTaxonomyRepository(db));

    try {
      seedClassificationTaxonomies(db);
      seedAsset(db, {
        id: "asset-legacy",
        name: "Apple Inc.",
        displayCode: "AAPL",
        metadata: {
          identifiers: { isin: "US0378331005" },
          legacy: {
            sectors: JSON.stringify([{ name: "Technology", weight: 0.33336 }]),
            countries: [{ name: "United States", weight: 1.5 }],
          },
        },
      });

      await expect(service.migrateLegacyClassifications?.()).resolves.toEqual({
        sectorsMigrated: 1,
        countriesMigrated: 1,
        assetsProcessed: 1,
        errors: [],
      });
      expect(service.getAssetAssignments("asset-legacy")).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            taxonomyId: "industries_gics",
            categoryId: "45",
            weight: 3334,
            source: "migrated",
          }),
          expect.objectContaining({
            taxonomyId: "regions",
            categoryId: "country_US",
            weight: 10_000,
            source: "migrated",
          }),
        ]),
      );
      expect(readAssetMetadata(db, "asset-legacy")).toEqual({
        identifiers: { isin: "US0378331005" },
      });

      await expect(service.migrateLegacyClassifications?.()).resolves.toEqual({
        sectorsMigrated: 0,
        countriesMigrated: 0,
        assetsProcessed: 0,
        errors: [],
      });
    } finally {
      db.close();
    }
  });

  test("limits legacy classification migration to requested asset IDs", async () => {
    const db = createTaxonomiesDb();
    const service = createTaxonomyService(createTaxonomyRepository(db));

    try {
      seedClassificationTaxonomies(db);
      seedAsset(db, {
        id: "selected",
        name: "Apple Inc.",
        displayCode: "AAPL",
        metadata: { legacy: { sectors: [{ name: "Technology", weight: 1 }] } },
      });
      seedAsset(db, {
        id: "unselected",
        displayCode: "MSFT",
        metadata: { legacy: { countries: [{ name: "United States", weight: 1 }] } },
      });

      await expect(service.getLegacyClassificationMigrationDetails?.()).resolves.toEqual({
        assetsNeedingMigration: [
          { id: "selected", symbol: "AAPL", name: "Apple Inc." },
          { id: "unselected", symbol: "MSFT", name: null },
        ],
        assetsAlreadyMigrated: 0,
      });

      await expect(
        service.migrateLegacyClassifications?.(["selected", "missing"]),
      ).resolves.toEqual({
        sectorsMigrated: 1,
        countriesMigrated: 0,
        assetsProcessed: 1,
        errors: [],
      });

      expect(service.getAssetAssignments("selected")).toEqual([
        expect.objectContaining({
          taxonomyId: "industries_gics",
          categoryId: "45",
          source: "migrated",
        }),
      ]);
      expect(service.getAssetAssignments("unselected")).toEqual([]);
      expect(readAssetMetadata(db, "selected")).toBeNull();
      expect(readAssetMetadata(db, "unselected")).toEqual({
        legacy: { countries: [{ name: "United States", weight: 1 }] },
      });
      await expect(service.getLegacyClassificationMigrationDetails?.()).resolves.toEqual({
        assetsNeedingMigration: [{ id: "unselected", symbol: "MSFT", name: null }],
        assetsAlreadyMigrated: 0,
      });

      await expect(service.migrateLegacyClassifications?.([])).resolves.toEqual({
        sectorsMigrated: 0,
        countriesMigrated: 0,
        assetsProcessed: 0,
        errors: [],
      });
      expect(readAssetMetadata(db, "unselected")).toEqual({
        legacy: { countries: [{ name: "United States", weight: 1 }] },
      });
    } finally {
      db.close();
    }
  });

  test("collects legacy migration parse errors while still cleaning metadata", async () => {
    const db = createTaxonomiesDb();
    const service = createTaxonomyService(createTaxonomyRepository(db));

    try {
      seedClassificationTaxonomies(db);
      seedAsset(db, {
        id: "bad-weight",
        metadata: { legacy: { sectors: [{ name: "Technology", weight: "bad" }] } },
      });
      seedAsset(db, {
        id: "unknown-sector",
        metadata: { legacy: { sectors: [{ name: "Unknown", weight: 0.75 }] } },
      });
      seedAsset(db, {
        id: "null-key",
        metadata: { identifiers: { cusip: "123" }, legacy: { sectors: null } },
      });

      const result = await service.migrateLegacyClassifications?.();

      expect(result).toMatchObject({
        sectorsMigrated: 0,
        countriesMigrated: 0,
        assetsProcessed: 0,
      });
      expect(result?.errors).toEqual([
        expect.stringContaining("Failed to parse sectors for asset 'bad-weight'"),
      ]);
      expect(service.getAssetAssignments("bad-weight")).toEqual([]);
      expect(service.getAssetAssignments("unknown-sector")).toEqual([]);
      expect(readAssetMetadata(db, "bad-weight")).toBeNull();
      expect(readAssetMetadata(db, "unknown-sector")).toBeNull();
      expect(readAssetMetadata(db, "null-key")).toEqual({ identifiers: { cusip: "123" } });
    } finally {
      db.close();
    }
  });
});

function createTaxonomiesDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE taxonomies (
      id TEXT NOT NULL PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#8abceb',
      description TEXT,
      is_system INTEGER NOT NULL DEFAULT 0,
      is_single_select INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z',
      updated_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z'
    );

    CREATE TABLE taxonomy_categories (
      id TEXT NOT NULL,
      taxonomy_id TEXT NOT NULL,
      parent_id TEXT,
      name TEXT NOT NULL,
      key TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#808080',
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z',
      updated_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z',
      PRIMARY KEY (taxonomy_id, id)
    );

    CREATE TABLE asset_taxonomy_assignments (
      id TEXT NOT NULL PRIMARY KEY,
      asset_id TEXT NOT NULL,
      taxonomy_id TEXT NOT NULL,
      category_id TEXT NOT NULL,
      weight INTEGER NOT NULL DEFAULT 10000,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z',
      updated_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00Z'
    );

    CREATE TABLE assets (
      id TEXT NOT NULL PRIMARY KEY,
      name TEXT,
      display_code TEXT,
      metadata TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );
  `);
  return db;
}

function seedTaxonomy(
  db: Database,
  taxonomy: {
    id: string;
    name: string;
    color: string;
    isSystem: boolean;
    isSingleSelect: boolean;
    sortOrder: number;
  },
): void {
  db.prepare(
    `
      INSERT INTO taxonomies (
        id, name, color, is_system, is_single_select, sort_order
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `,
  ).run(
    taxonomy.id,
    taxonomy.name,
    taxonomy.color,
    taxonomy.isSystem ? 1 : 0,
    taxonomy.isSingleSelect ? 1 : 0,
    taxonomy.sortOrder,
  );
}

function seedCategory(
  db: Database,
  category: {
    id: string;
    taxonomyId: string;
    parentId?: string | null;
    name: string;
    key: string;
    color: string;
    description?: string | null;
    sortOrder: number;
  },
): void {
  db.prepare(
    `
      INSERT INTO taxonomy_categories (
        id, taxonomy_id, parent_id, name, key, color, description, sort_order
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    category.id,
    category.taxonomyId,
    category.parentId ?? null,
    category.name,
    category.key,
    category.color,
    category.description ?? null,
    category.sortOrder,
  );
}

function seedClassificationTaxonomies(db: Database): void {
  seedTaxonomy(db, {
    id: "industries_gics",
    name: "Industries",
    color: "#4385be",
    isSystem: true,
    isSingleSelect: false,
    sortOrder: 20,
  });
  seedCategory(db, {
    id: "45",
    taxonomyId: "industries_gics",
    name: "Information Technology",
    key: "45",
    color: "#4385be",
    sortOrder: 1,
  });
  seedTaxonomy(db, {
    id: "regions",
    name: "Regions",
    color: "#8b7ec8",
    isSystem: true,
    isSingleSelect: false,
    sortOrder: 30,
  });
  seedCategory(db, {
    id: "country_US",
    taxonomyId: "regions",
    name: "United States",
    key: "country_US",
    color: "#8b7ec8",
    sortOrder: 1,
  });
}

function seedAsset(
  db: Database,
  asset: {
    id: string;
    name?: string | null;
    displayCode?: string | null;
    metadata?: Record<string, unknown> | null;
    isActive?: boolean;
  },
): void {
  db.prepare(
    `
      INSERT INTO assets (id, name, display_code, metadata, is_active)
      VALUES (?, ?, ?, ?, ?)
    `,
  ).run(
    asset.id,
    asset.name ?? null,
    asset.displayCode ?? null,
    asset.metadata ? JSON.stringify(asset.metadata) : null,
    asset.isActive === false ? 0 : 1,
  );
}

function readAssetMetadata(db: Database, assetId: string): Record<string, unknown> | null {
  const row = db
    .query<{ metadata: string | null }, [string]>("SELECT metadata FROM assets WHERE id = ?")
    .get(assetId);
  return row?.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : null;
}
