import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import {
  createTaxonomyReadRepository,
  createTaxonomyReadService,
  createTaxonomyRepository,
  createTaxonomyService,
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

      expect(service.getTaxonomies()).toEqual([
        expect.objectContaining({
          id: "custom_groups",
          isSystem: false,
          isSingleSelect: true,
          createdAt: "2026-01-01T00:00:00Z",
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
        createdAt: "2025-01-01T00:00:00Z",
        isSingleSelect: false,
        sortOrder: 20,
      });
      expect(updated).toMatchObject({
        id: "strategy",
        name: "Strategies",
        createdAt: "2025-01-01T00:00:00Z",
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
          createdAt: "2025-01-01T00:00:00Z",
          name: "Themes",
          sortOrder: 3,
        }),
      ).resolves.toMatchObject({
        id: "theme",
        createdAt: "2025-01-01T00:00:00Z",
        name: "Themes",
        sortOrder: 3,
      });
      await expect(service.deleteCategory("custom_groups", child.id)).resolves.toBe(1);
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
    name: string;
    key: string;
    color: string;
    sortOrder: number;
  },
): void {
  db.prepare(
    `
      INSERT INTO taxonomy_categories (
        id, taxonomy_id, name, key, color, sort_order
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `,
  ).run(
    category.id,
    category.taxonomyId,
    category.name,
    category.key,
    category.color,
    category.sortOrder,
  );
}
