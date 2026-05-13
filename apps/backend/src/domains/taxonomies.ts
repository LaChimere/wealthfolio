import type { Database } from "bun:sqlite";

export interface Taxonomy {
  id: string;
  name: string;
  color: string;
  description: string | null;
  isSystem: boolean;
  isSingleSelect: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface NewTaxonomy {
  id?: string | null;
  name: string;
  color: string;
  description?: string | null;
  isSystem: boolean;
  isSingleSelect: boolean;
  sortOrder: number;
}

export interface TaxonomyCategory {
  id: string;
  taxonomyId: string;
  parentId: string | null;
  name: string;
  key: string;
  color: string;
  description: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface NewTaxonomyCategory {
  id?: string | null;
  taxonomyId: string;
  parentId?: string | null;
  name: string;
  key: string;
  color: string;
  description?: string | null;
  sortOrder: number;
}

export interface TaxonomyWithCategories {
  taxonomy: Taxonomy;
  categories: TaxonomyCategory[];
}

export interface AssetTaxonomyAssignment {
  id: string;
  assetId: string;
  taxonomyId: string;
  categoryId: string;
  weight: number;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface NewAssetTaxonomyAssignment {
  id?: string | null;
  assetId: string;
  taxonomyId: string;
  categoryId: string;
  weight: number;
  source: string;
}

export interface TaxonomyJson {
  name: string;
  color: string;
  categories: TaxonomyCategoryJson[];
  instruments?: InstrumentMappingJson[];
}

export interface TaxonomyCategoryJson {
  name: string;
  key: string;
  color: string;
  description?: string | null;
  children?: TaxonomyCategoryJson[];
}

export interface InstrumentMappingJson {
  identifiers: {
    name?: string | null;
    ticker?: string | null;
    isin?: string | null;
  };
  categories: {
    key: string;
    path: string[];
    weight: number;
  }[];
}

export type TaxonomySyncOperation = "Create" | "Update" | "Delete";

export interface TaxonomySyncEvent {
  taxonomyId: string;
  operation: TaxonomySyncOperation;
  payload: TaxonomySyncPayload | { id: string };
}

export interface TaxonomySyncPayload {
  taxonomy: Taxonomy;
  categories: TaxonomyCategory[];
}

export interface TaxonomyAssignmentSyncEvent {
  assignmentId: string;
  operation: Extract<TaxonomySyncOperation, "Update" | "Delete">;
  payload: AssetTaxonomyAssignment | { id: string };
}

export interface TaxonomyRepositoryOptions {
  queueSyncEvent?: (event: TaxonomySyncEvent) => void;
  queueAssignmentSyncEvent?: (event: TaxonomyAssignmentSyncEvent) => void;
}

export interface TaxonomyReadRepository {
  getTaxonomies(): Taxonomy[];
  getTaxonomy(id: string): Taxonomy | null;
  getCategories(taxonomyId: string): TaxonomyCategory[];
  getTaxonomyWithCategories(id: string): TaxonomyWithCategories | null;
}

export interface TaxonomyRepository extends TaxonomyReadRepository {
  createTaxonomy(newTaxonomy: NewTaxonomy): Taxonomy;
  updateTaxonomy(taxonomy: Taxonomy): Taxonomy;
  deleteTaxonomy(id: string): number;
  getCategory(taxonomyId: string, categoryId: string): TaxonomyCategory | null;
  getAssetAssignments(assetId: string): AssetTaxonomyAssignment[];
  getCategoryAssignments(taxonomyId: string, categoryId: string): AssetTaxonomyAssignment[];
  upsertAssignment(assignment: NewAssetTaxonomyAssignment): AssetTaxonomyAssignment;
  deleteAssignment(id: string): number;
  deleteAssetAssignments(assetId: string, taxonomyId: string): number;
  bulkCreateCategories(categories: NewTaxonomyCategory[]): number;
  createCategory(newCategory: NewTaxonomyCategory): TaxonomyCategory;
  updateCategory(category: TaxonomyCategory): TaxonomyCategory;
  deleteCategory(taxonomyId: string, categoryId: string): number;
}

export interface TaxonomyReadService {
  getTaxonomies(): Taxonomy[];
  getTaxonomy(id: string): TaxonomyWithCategories | null;
}

export interface TaxonomyService extends TaxonomyReadService {
  createTaxonomy(newTaxonomy: NewTaxonomy): Promise<Taxonomy>;
  updateTaxonomy(taxonomy: Taxonomy): Promise<Taxonomy>;
  deleteTaxonomy(id: string): Promise<number>;
  createCategory(newCategory: NewTaxonomyCategory): Promise<TaxonomyCategory>;
  updateCategory(category: TaxonomyCategory): Promise<TaxonomyCategory>;
  deleteCategory(taxonomyId: string, categoryId: string): Promise<number>;
  moveCategory(
    taxonomyId: string,
    categoryId: string,
    newParentId: string | null,
    position: number,
  ): Promise<TaxonomyCategory>;
  getAssetAssignments(assetId: string): AssetTaxonomyAssignment[];
  assignAssetToCategory(assignment: NewAssetTaxonomyAssignment): Promise<AssetTaxonomyAssignment>;
  removeAssetAssignment(id: string): Promise<number>;
  importTaxonomyJson(jsonStr: string): Promise<Taxonomy>;
  exportTaxonomyJson(id: string): string;
  getMigrationStatus?(): Promise<unknown> | unknown;
  migrateLegacyClassifications?(): Promise<unknown> | unknown;
}

interface TaxonomyRow {
  id: string;
  name: string;
  color: string;
  description: string | null;
  is_system: number | boolean;
  is_single_select: number | boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface TaxonomyCategoryRow {
  id: string;
  taxonomy_id: string;
  parent_id: string | null;
  name: string;
  key: string;
  color: string;
  description: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface AssetTaxonomyAssignmentRow {
  id: string;
  asset_id: string;
  taxonomy_id: string;
  category_id: string;
  weight: number;
  source: string;
  created_at: string;
  updated_at: string;
}

export function createTaxonomyReadRepository(db: Database): TaxonomyReadRepository {
  return createTaxonomyRepository(db);
}

export function createTaxonomyRepository(
  db: Database,
  options: TaxonomyRepositoryOptions = {},
): TaxonomyRepository {
  const getTaxonomy = (id: string): Taxonomy | null => {
    const row = db
      .query<TaxonomyRow, [string]>(
        `
          SELECT ${taxonomyColumns()}
          FROM taxonomies
          WHERE id = ?
        `,
      )
      .get(id);
    return row ? taxonomyFromRow(row) : null;
  };
  const getCategories = (taxonomyId: string): TaxonomyCategory[] =>
    db
      .query<TaxonomyCategoryRow, [string]>(
        `
          SELECT ${taxonomyCategoryColumns()}
          FROM taxonomy_categories
          WHERE taxonomy_id = ?
          ORDER BY sort_order ASC
        `,
      )
      .all(taxonomyId)
      .map(taxonomyCategoryFromRow);
  const getTaxonomyWithCategories = (id: string): TaxonomyWithCategories | null => {
    const taxonomy = getTaxonomy(id);
    if (!taxonomy) {
      return null;
    }
    return {
      taxonomy,
      categories: getCategories(id),
    };
  };

  return {
    getTaxonomies() {
      return db
        .query<TaxonomyRow, []>(
          `
            SELECT ${taxonomyColumns()}
            FROM taxonomies
            ORDER BY sort_order ASC
          `,
        )
        .all()
        .map(taxonomyFromRow);
    },
    getTaxonomy,
    getCategories,
    getTaxonomyWithCategories,
    createTaxonomy(newTaxonomy) {
      const id = newTaxonomy.id || crypto.randomUUID();
      const now = timestampNow();
      db.transaction(() => {
        db.prepare(
          `
            INSERT INTO taxonomies (
              id, name, color, description, is_system, is_single_select, sort_order, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        ).run(
          id,
          newTaxonomy.name,
          newTaxonomy.color,
          newTaxonomy.description ?? null,
          boolToInt(newTaxonomy.isSystem),
          boolToInt(newTaxonomy.isSingleSelect),
          newTaxonomy.sortOrder,
          now,
          now,
        );
        queueCustomTaxonomyBundle(db, options, id, "Create");
      })();
      return readTaxonomyById(db, id);
    },
    updateTaxonomy(taxonomy) {
      const updatedAt = timestampNow();
      db.transaction(() => {
        db.prepare(
          `
            UPDATE taxonomies
            SET
              name = ?,
              color = ?,
              description = ?,
              is_system = ?,
              is_single_select = ?,
              sort_order = ?,
              created_at = ?,
              updated_at = ?
            WHERE id = ?
          `,
        ).run(
          taxonomy.name,
          taxonomy.color,
          taxonomy.description ?? null,
          boolToInt(taxonomy.isSystem),
          boolToInt(taxonomy.isSingleSelect),
          taxonomy.sortOrder,
          taxonomy.createdAt,
          updatedAt,
          taxonomy.id,
        );
        queueCustomTaxonomyBundle(db, options, taxonomy.id, "Update");
      })();
      return readTaxonomyById(db, taxonomy.id);
    },
    deleteTaxonomy(id) {
      let affected = 0;
      db.transaction(() => {
        const isSyncable = isSyncableTaxonomy(db, id);
        affected = db.prepare("DELETE FROM taxonomies WHERE id = ?").run(id).changes;
        if (affected > 0 && isSyncable) {
          queueCustomTaxonomyDelete(options, id);
        }
      })();
      return affected;
    },
    getCategory(taxonomyId, categoryId) {
      const row = db
        .query<TaxonomyCategoryRow, [string, string]>(
          `
            SELECT ${taxonomyCategoryColumns()}
            FROM taxonomy_categories
            WHERE taxonomy_id = ? AND id = ?
          `,
        )
        .get(taxonomyId, categoryId);
      return row ? taxonomyCategoryFromRow(row) : null;
    },
    getAssetAssignments(assetId) {
      return db
        .query<AssetTaxonomyAssignmentRow, [string]>(
          `
            SELECT ${assetTaxonomyAssignmentColumns()}
            FROM asset_taxonomy_assignments
            WHERE asset_id = ?
          `,
        )
        .all(assetId)
        .map(assetTaxonomyAssignmentFromRow);
    },
    getCategoryAssignments(taxonomyId, categoryId) {
      return db
        .query<AssetTaxonomyAssignmentRow, [string, string]>(
          `
            SELECT ${assetTaxonomyAssignmentColumns()}
            FROM asset_taxonomy_assignments
            WHERE taxonomy_id = ? AND category_id = ?
          `,
        )
        .all(taxonomyId, categoryId)
        .map(assetTaxonomyAssignmentFromRow);
    },
    upsertAssignment(assignment) {
      const id = assignment.id || crypto.randomUUID();
      const now = timestampNow();
      let saved: AssetTaxonomyAssignment | undefined;
      db.transaction(() => {
        const existing = findAssignmentByNaturalKey(
          db,
          assignment.assetId,
          assignment.taxonomyId,
          assignment.categoryId,
        );
        if (existing) {
          db.prepare(
            `
              UPDATE asset_taxonomy_assignments
              SET weight = ?, source = ?
              WHERE id = ?
            `,
          ).run(assignment.weight, assignment.source, existing.id);
          saved = readAssignmentById(db, existing.id);
        } else {
          db.prepare(
            `
              INSERT INTO asset_taxonomy_assignments (
                id, asset_id, taxonomy_id, category_id, weight, source, created_at, updated_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `,
          ).run(
            id,
            assignment.assetId,
            assignment.taxonomyId,
            assignment.categoryId,
            assignment.weight,
            assignment.source,
            now,
            now,
          );
          saved = readAssignmentById(db, id);
        }
        queueAssignmentUpdate(options, saved);
      })();
      if (!saved) {
        throw new Error(`Record not found: taxonomy assignment ${id}`);
      }
      return saved;
    },
    deleteAssignment(id) {
      let affected = 0;
      db.transaction(() => {
        affected = db
          .prepare("DELETE FROM asset_taxonomy_assignments WHERE id = ?")
          .run(id).changes;
        if (affected > 0) {
          queueAssignmentDelete(options, id);
        }
      })();
      return affected;
    },
    deleteAssetAssignments(assetId, taxonomyId) {
      let affected = 0;
      db.transaction(() => {
        const existingIds = db
          .query<{ id: string }, [string, string]>(
            `
              SELECT id
              FROM asset_taxonomy_assignments
              WHERE asset_id = ? AND taxonomy_id = ?
            `,
          )
          .all(assetId, taxonomyId)
          .map((row) => row.id);
        affected = db
          .prepare("DELETE FROM asset_taxonomy_assignments WHERE asset_id = ? AND taxonomy_id = ?")
          .run(assetId, taxonomyId).changes;
        for (const assignmentId of existingIds) {
          queueAssignmentDelete(options, assignmentId);
        }
      })();
      return affected;
    },
    bulkCreateCategories(categories) {
      if (categories.length === 0) {
        return 0;
      }
      let count = 0;
      const taxonomyId = categories[0]?.taxonomyId;
      db.transaction(() => {
        for (const category of categories) {
          const id = category.id || crypto.randomUUID();
          const now = timestampNow();
          db.prepare(
            `
              INSERT INTO taxonomy_categories (
                id, taxonomy_id, parent_id, name, key, color, description, sort_order, created_at, updated_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
          ).run(
            id,
            category.taxonomyId,
            category.parentId ?? null,
            category.name,
            category.key,
            category.color,
            category.description ?? null,
            category.sortOrder,
            now,
            now,
          );
          count += 1;
        }
        if (taxonomyId) {
          queueCustomTaxonomyBundle(db, options, taxonomyId, "Update");
        }
      })();
      return count;
    },
    createCategory(newCategory) {
      const id = newCategory.id || crypto.randomUUID();
      const now = timestampNow();
      db.transaction(() => {
        db.prepare(
          `
            INSERT INTO taxonomy_categories (
              id, taxonomy_id, parent_id, name, key, color, description, sort_order, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        ).run(
          id,
          newCategory.taxonomyId,
          newCategory.parentId ?? null,
          newCategory.name,
          newCategory.key,
          newCategory.color,
          newCategory.description ?? null,
          newCategory.sortOrder,
          now,
          now,
        );
        queueCustomTaxonomyBundle(db, options, newCategory.taxonomyId, "Update");
      })();
      return readCategoryById(db, newCategory.taxonomyId, id);
    },
    updateCategory(category) {
      const updatedAt = timestampNow();
      db.transaction(() => {
        db.prepare(
          `
            UPDATE taxonomy_categories
            SET
              parent_id = ?,
              name = ?,
              key = ?,
              color = ?,
              description = ?,
              sort_order = ?,
              created_at = ?,
              updated_at = ?
            WHERE taxonomy_id = ? AND id = ?
          `,
        ).run(
          category.parentId ?? null,
          category.name,
          category.key,
          category.color,
          category.description ?? null,
          category.sortOrder,
          category.createdAt,
          updatedAt,
          category.taxonomyId,
          category.id,
        );
        queueCustomTaxonomyBundle(db, options, category.taxonomyId, "Update");
      })();
      return readCategoryById(db, category.taxonomyId, category.id);
    },
    deleteCategory(taxonomyId, categoryId) {
      let affected = 0;
      db.transaction(() => {
        const isSyncable = isSyncableTaxonomy(db, taxonomyId);
        affected = db
          .prepare("DELETE FROM taxonomy_categories WHERE taxonomy_id = ? AND id = ?")
          .run(taxonomyId, categoryId).changes;
        if (affected > 0 && isSyncable) {
          queueCustomTaxonomyBundle(db, options, taxonomyId, "Update");
        }
      })();
      return affected;
    },
  };
}

export function createTaxonomyReadService(repository: TaxonomyReadRepository): TaxonomyReadService {
  return {
    getTaxonomies() {
      return repository.getTaxonomies();
    },
    getTaxonomy(id) {
      return repository.getTaxonomyWithCategories(id);
    },
  };
}

export function createTaxonomyService(repository: TaxonomyRepository): TaxonomyService {
  return {
    ...createTaxonomyReadService(repository),
    async createTaxonomy(newTaxonomy) {
      return repository.createTaxonomy(newTaxonomy);
    },
    async updateTaxonomy(taxonomy) {
      return repository.updateTaxonomy(taxonomy);
    },
    async deleteTaxonomy(id) {
      const taxonomy = repository.getTaxonomy(id);
      if (taxonomy?.isSystem) {
        throw new Error("Invalid input: Cannot delete system taxonomy");
      }
      return repository.deleteTaxonomy(id);
    },
    async createCategory(newCategory) {
      return repository.createCategory(newCategory);
    },
    async updateCategory(category) {
      return repository.updateCategory(category);
    },
    async deleteCategory(taxonomyId, categoryId) {
      const categories = repository.getCategories(taxonomyId);
      const hasChildren = categories.some((category) => category.parentId === categoryId);
      if (hasChildren) {
        throw new Error("Invalid input: Cannot delete category with children");
      }

      const assignments = repository.getCategoryAssignments(taxonomyId, categoryId);
      if (assignments.length > 0) {
        throw new Error(
          `Invalid input: Cannot delete category with ${assignments.length} asset assignments`,
        );
      }

      return repository.deleteCategory(taxonomyId, categoryId);
    },
    async moveCategory(taxonomyId, categoryId, newParentId, position) {
      const category = repository.getCategory(taxonomyId, categoryId);
      if (!category) {
        throw new Error("Record not found: Category not found");
      }
      return repository.updateCategory({
        ...category,
        parentId: newParentId,
        sortOrder: position,
      });
    },
    getAssetAssignments(assetId) {
      return repository.getAssetAssignments(assetId);
    },
    async assignAssetToCategory(assignment) {
      const taxonomy = repository.getTaxonomy(assignment.taxonomyId);
      if (taxonomy?.isSingleSelect) {
        repository.deleteAssetAssignments(assignment.assetId, assignment.taxonomyId);
      }
      return repository.upsertAssignment(assignment);
    },
    async removeAssetAssignment(id) {
      return repository.deleteAssignment(id);
    },
    async importTaxonomyJson(jsonStr) {
      const taxonomyJson = parseTaxonomyJson(jsonStr);
      const taxonomy = repository.createTaxonomy({
        name: taxonomyJson.name,
        color: taxonomyJson.color,
        description: null,
        isSystem: false,
        isSingleSelect: false,
        sortOrder: 0,
      });
      const categories = flattenTaxonomyJsonCategories(taxonomy.id, taxonomyJson.categories);
      repository.bulkCreateCategories(categories);
      return taxonomy;
    },
    exportTaxonomyJson(id) {
      const taxonomyWithCategories = repository.getTaxonomyWithCategories(id);
      if (!taxonomyWithCategories) {
        throw new Error("Record not found: Taxonomy not found");
      }
      return JSON.stringify(
        {
          name: taxonomyWithCategories.taxonomy.name,
          color: taxonomyWithCategories.taxonomy.color,
          categories: taxonomyCategoriesToJson(taxonomyWithCategories.categories),
          instruments: [],
        } satisfies Required<TaxonomyJson>,
        null,
        2,
      );
    },
  };
}

function taxonomyColumns(): string {
  return [
    "id",
    "name",
    "color",
    "description",
    "is_system",
    "is_single_select",
    "sort_order",
    "created_at",
    "updated_at",
  ].join(", ");
}

function taxonomyCategoryColumns(): string {
  return [
    "id",
    "taxonomy_id",
    "parent_id",
    "name",
    "key",
    "color",
    "description",
    "sort_order",
    "created_at",
    "updated_at",
  ].join(", ");
}

function assetTaxonomyAssignmentColumns(): string {
  return [
    "id",
    "asset_id",
    "taxonomy_id",
    "category_id",
    "weight",
    "source",
    "created_at",
    "updated_at",
  ].join(", ");
}

function taxonomyFromRow(row: TaxonomyRow): Taxonomy {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    description: row.description,
    isSystem: Boolean(row.is_system),
    isSingleSelect: Boolean(row.is_single_select),
    sortOrder: row.sort_order,
    createdAt: toApiDate(row.created_at),
    updatedAt: toApiDate(row.updated_at),
  };
}

function readTaxonomyById(db: Database, id: string): Taxonomy {
  const row = db
    .query<TaxonomyRow, [string]>(
      `
        SELECT ${taxonomyColumns()}
        FROM taxonomies
        WHERE id = ?
      `,
    )
    .get(id);
  if (!row) {
    throw new Error(`Record not found: taxonomy ${id}`);
  }
  return taxonomyFromRow(row);
}

function taxonomyCategoryFromRow(row: TaxonomyCategoryRow): TaxonomyCategory {
  return {
    id: row.id,
    taxonomyId: row.taxonomy_id,
    parentId: row.parent_id,
    name: row.name,
    key: row.key,
    color: row.color,
    description: row.description,
    sortOrder: row.sort_order,
    createdAt: toApiDate(row.created_at),
    updatedAt: toApiDate(row.updated_at),
  };
}

function readCategoryById(db: Database, taxonomyId: string, categoryId: string): TaxonomyCategory {
  const row = db
    .query<TaxonomyCategoryRow, [string, string]>(
      `
        SELECT ${taxonomyCategoryColumns()}
        FROM taxonomy_categories
        WHERE taxonomy_id = ? AND id = ?
      `,
    )
    .get(taxonomyId, categoryId);
  if (!row) {
    throw new Error(`Record not found: taxonomy category ${taxonomyId}/${categoryId}`);
  }
  return taxonomyCategoryFromRow(row);
}

function readAssignmentById(db: Database, id: string): AssetTaxonomyAssignment {
  const row = db
    .query<AssetTaxonomyAssignmentRow, [string]>(
      `
        SELECT ${assetTaxonomyAssignmentColumns()}
        FROM asset_taxonomy_assignments
        WHERE id = ?
      `,
    )
    .get(id);
  if (!row) {
    throw new Error(`Record not found: taxonomy assignment ${id}`);
  }
  return assetTaxonomyAssignmentFromRow(row);
}

function findAssignmentByNaturalKey(
  db: Database,
  assetId: string,
  taxonomyId: string,
  categoryId: string,
): AssetTaxonomyAssignment | null {
  const row = db
    .query<AssetTaxonomyAssignmentRow, [string, string, string]>(
      `
        SELECT ${assetTaxonomyAssignmentColumns()}
        FROM asset_taxonomy_assignments
        WHERE asset_id = ? AND taxonomy_id = ? AND category_id = ?
      `,
    )
    .get(assetId, taxonomyId, categoryId);
  return row ? assetTaxonomyAssignmentFromRow(row) : null;
}

function assetTaxonomyAssignmentFromRow(row: AssetTaxonomyAssignmentRow): AssetTaxonomyAssignment {
  return {
    id: row.id,
    assetId: row.asset_id,
    taxonomyId: row.taxonomy_id,
    categoryId: row.category_id,
    weight: row.weight,
    source: row.source,
    createdAt: toApiDate(row.created_at),
    updatedAt: toApiDate(row.updated_at),
  };
}

function parseTaxonomyJson(jsonStr: string): TaxonomyJson {
  try {
    const parsed = JSON.parse(jsonStr) as unknown;
    if (!isRecord(parsed)) {
      throw new Error("expected an object");
    }
    const name = parsed.name;
    const color = parsed.color;
    const categories = parsed.categories;
    if (typeof name !== "string") {
      throw new Error("name must be a string");
    }
    if (typeof color !== "string") {
      throw new Error("color must be a string");
    }
    if (!Array.isArray(categories)) {
      throw new Error("categories must be an array");
    }
    return {
      name,
      color,
      categories: categories.map(parseTaxonomyCategoryJson),
      instruments: Array.isArray(parsed.instruments)
        ? (parsed.instruments as InstrumentMappingJson[])
        : [],
    };
  } catch (error) {
    throw new Error(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseTaxonomyCategoryJson(value: unknown): TaxonomyCategoryJson {
  if (!isRecord(value)) {
    throw new Error("category must be an object");
  }
  const name = value.name;
  const key = value.key;
  const color = value.color;
  const description = value.description;
  const children = value.children;
  if (typeof name !== "string") {
    throw new Error("category.name must be a string");
  }
  if (typeof key !== "string") {
    throw new Error("category.key must be a string");
  }
  if (typeof color !== "string") {
    throw new Error("category.color must be a string");
  }
  if (description !== undefined && description !== null && typeof description !== "string") {
    throw new Error("category.description must be a string or null");
  }
  if (children !== undefined && !Array.isArray(children)) {
    throw new Error("category.children must be an array");
  }
  return {
    name,
    key,
    color,
    description: description ?? null,
    children: children?.map(parseTaxonomyCategoryJson) ?? [],
  };
}

function flattenTaxonomyJsonCategories(
  taxonomyId: string,
  categories: TaxonomyCategoryJson[],
): NewTaxonomyCategory[] {
  const flattened: NewTaxonomyCategory[] = [];
  let sortOrder = 0;

  const visit = (items: TaxonomyCategoryJson[], parentId: string | null): void => {
    for (const category of items) {
      const id = crypto.randomUUID();
      flattened.push({
        id,
        taxonomyId,
        parentId,
        name: category.name,
        key: category.key,
        color: category.color,
        description: category.description ?? null,
        sortOrder,
      });
      sortOrder += 1;
      visit(category.children ?? [], id);
    }
  };

  visit(categories, null);
  return flattened;
}

function taxonomyCategoriesToJson(categories: TaxonomyCategory[]): TaxonomyCategoryJson[] {
  const childrenByParentId = new Map<string | null, TaxonomyCategory[]>();
  for (const category of categories) {
    const children = childrenByParentId.get(category.parentId) ?? [];
    children.push(category);
    childrenByParentId.set(category.parentId, children);
  }
  for (const children of childrenByParentId.values()) {
    children.sort((left, right) => left.sortOrder - right.sortOrder);
  }

  const build = (parentId: string | null): TaxonomyCategoryJson[] => {
    const children = childrenByParentId.get(parentId) ?? [];
    return children.map((category) => ({
      name: category.name,
      key: category.key,
      color: category.color,
      description: category.description,
      children: build(category.id),
    }));
  };

  return build(null);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function queueAssignmentUpdate(
  options: TaxonomyRepositoryOptions,
  assignment: AssetTaxonomyAssignment | undefined,
): void {
  if (!assignment) {
    return;
  }
  options.queueAssignmentSyncEvent?.({
    assignmentId: assignment.id,
    operation: "Update",
    payload: assignment,
  });
}

function queueAssignmentDelete(options: TaxonomyRepositoryOptions, assignmentId: string): void {
  options.queueAssignmentSyncEvent?.({
    assignmentId,
    operation: "Delete",
    payload: { id: assignmentId },
  });
}

function isSyncableTaxonomy(db: Database, taxonomyId: string): boolean {
  if (taxonomyId === "custom_groups") {
    return true;
  }
  const row = db
    .query<
      { is_system: number | boolean },
      [string]
    >("SELECT is_system FROM taxonomies WHERE id = ?")
    .get(taxonomyId);
  return row ? !Boolean(row.is_system) : false;
}

function queueCustomTaxonomyBundle(
  db: Database,
  options: TaxonomyRepositoryOptions,
  taxonomyId: string,
  operation: Exclude<TaxonomySyncOperation, "Delete">,
): void {
  if (!options.queueSyncEvent || !isSyncableTaxonomy(db, taxonomyId)) {
    return;
  }
  const taxonomy = readTaxonomyById(db, taxonomyId);
  options.queueSyncEvent({
    taxonomyId,
    operation,
    payload: {
      taxonomy,
      categories: db
        .query<TaxonomyCategoryRow, [string]>(
          `
            SELECT ${taxonomyCategoryColumns()}
            FROM taxonomy_categories
            WHERE taxonomy_id = ?
            ORDER BY sort_order ASC
          `,
        )
        .all(taxonomyId)
        .map(taxonomyCategoryFromRow),
    },
  });
}

function queueCustomTaxonomyDelete(options: TaxonomyRepositoryOptions, taxonomyId: string): void {
  options.queueSyncEvent?.({
    taxonomyId,
    operation: "Delete",
    payload: { id: taxonomyId },
  });
}

function boolToInt(value: boolean): number {
  return value ? 1 : 0;
}

function timestampNow(): string {
  return new Date().toISOString();
}

function toApiDate(value: string): string {
  return value.includes(" ") ? value.replace(" ", "T") : value;
}
