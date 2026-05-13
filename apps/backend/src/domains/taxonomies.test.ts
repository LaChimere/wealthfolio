import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { createTaxonomyReadRepository, createTaxonomyReadService } from "./taxonomies";

describe("TS taxonomies read domain", () => {
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
