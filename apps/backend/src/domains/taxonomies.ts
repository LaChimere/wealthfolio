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

export interface ClassificationMigrationStatus {
  needed: boolean;
  assetsWithLegacyData: number;
  assetsAlreadyMigrated: number;
}

export interface ClassificationMigrationAsset {
  id: string;
  symbol: string;
  name: string | null;
}

export interface ClassificationMigrationDetails {
  assetsNeedingMigration: ClassificationMigrationAsset[];
  assetsAlreadyMigrated: number;
}

export interface ClassificationMigrationResult {
  sectorsMigrated: number;
  countriesMigrated: number;
  assetsProcessed: number;
  errors: string[];
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
  getMigrationStatus(): ClassificationMigrationStatus;
  getLegacyClassificationMigrationDetails(): ClassificationMigrationDetails;
  migrateLegacyClassifications(assetIds?: readonly string[]): ClassificationMigrationResult;
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
  getMigrationStatus(): Promise<ClassificationMigrationStatus> | ClassificationMigrationStatus;
  getLegacyClassificationMigrationDetails():
    | Promise<ClassificationMigrationDetails>
    | ClassificationMigrationDetails;
  migrateLegacyClassifications(
    assetIds?: readonly string[],
  ): Promise<ClassificationMigrationResult> | ClassificationMigrationResult;
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

interface ClassificationAssetRow {
  id: string;
  name: string | null;
  display_code: string | null;
  metadata: string | null;
}

interface ClassificationAsset {
  id: string;
  name: string | null;
  displayCode: string | null;
  metadata: Record<string, unknown> | null;
}

interface LegacyClassification {
  name: string;
  weight: number;
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
    getMigrationStatus() {
      return getClassificationMigrationStatus(db);
    },
    getLegacyClassificationMigrationDetails() {
      return getClassificationMigrationDetails(db);
    },
    migrateLegacyClassifications(assetIds) {
      return migrateLegacyClassifications(db, this, assetIds);
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
      validateI32Field(newTaxonomy.sortOrder, "sortOrder");
      return repository.createTaxonomy(newTaxonomy);
    },
    async updateTaxonomy(taxonomy) {
      validateI32Field(taxonomy.sortOrder, "sortOrder");
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
      validateI32Field(newCategory.sortOrder, "sortOrder");
      return repository.createCategory(newCategory);
    },
    async updateCategory(category) {
      validateI32Field(category.sortOrder, "sortOrder");
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
      validateI32Field(position, "position");
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
      validateI32Field(assignment.weight, "weight");
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
    async getMigrationStatus() {
      return repository.getMigrationStatus();
    },
    async getLegacyClassificationMigrationDetails() {
      return repository.getLegacyClassificationMigrationDetails();
    },
    async migrateLegacyClassifications(assetIds) {
      return repository.migrateLegacyClassifications(assetIds);
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

function getClassificationMigrationStatus(db: Database): ClassificationMigrationStatus {
  const details = getClassificationMigrationDetails(db);
  return {
    needed: details.assetsNeedingMigration.length > 0,
    assetsWithLegacyData: details.assetsNeedingMigration.length,
    assetsAlreadyMigrated: details.assetsAlreadyMigrated,
  };
}

function getClassificationMigrationDetails(db: Database): ClassificationMigrationDetails {
  const assets = readClassificationAssets(db);
  const gicsTaxonomy = readTaxonomyWithCategoriesNullable(db, "industries_gics");
  const regionsTaxonomy = readTaxonomyWithCategoriesNullable(db, "regions");
  const assetsNeedingMigration: ClassificationMigrationAsset[] = [];
  let assetsAlreadyMigrated = 0;

  for (const asset of assets) {
    const legacy = getLegacyClassificationRecord(asset.metadata);
    const hasLegacySectors = hasLegacyClassificationValue(legacy?.sectors);
    const hasLegacyCountries = hasLegacyClassificationValue(legacy?.countries);
    if (!hasLegacySectors && !hasLegacyCountries) {
      continue;
    }

    const assignments = getAssetAssignmentsForDb(db, asset.id);
    const hasGicsAssignment =
      gicsTaxonomy !== null &&
      assignments.some((assignment) => assignment.taxonomyId === gicsTaxonomy.taxonomy.id);
    const hasRegionsAssignment =
      regionsTaxonomy !== null &&
      assignments.some((assignment) => assignment.taxonomyId === regionsTaxonomy.taxonomy.id);

    if ((hasLegacySectors && !hasGicsAssignment) || (hasLegacyCountries && !hasRegionsAssignment)) {
      assetsNeedingMigration.push({
        id: asset.id,
        symbol: asset.displayCode ?? "",
        name: asset.name,
      });
    } else if (hasGicsAssignment || hasRegionsAssignment) {
      assetsAlreadyMigrated += 1;
    }
  }

  return {
    assetsNeedingMigration,
    assetsAlreadyMigrated,
  };
}

function migrateLegacyClassifications(
  db: Database,
  repository: Pick<
    TaxonomyRepository,
    | "getAssetAssignments"
    | "getCategories"
    | "getTaxonomy"
    | "upsertAssignment"
    | "deleteAssetAssignments"
  >,
  assetIds?: readonly string[],
): ClassificationMigrationResult {
  const result: ClassificationMigrationResult = {
    sectorsMigrated: 0,
    countriesMigrated: 0,
    assetsProcessed: 0,
    errors: [],
  };
  const sectorMapping = buildSectorMapping();
  const countryMapping = buildCountryMapping();
  const gicsCategories = new Set(
    repository.getCategories("industries_gics").map((category) => category.id),
  );
  const regionsCategories = new Set(
    repository.getCategories("regions").map((category) => category.id),
  );
  const assetFilter = assetIds ? new Set(assetIds) : null;

  for (const asset of readClassificationAssets(db)) {
    if (assetFilter && !assetFilter.has(asset.id)) {
      continue;
    }
    const legacy = getLegacyClassificationRecord(asset.metadata);
    if (!legacy) {
      continue;
    }

    const existingAssignments = repository.getAssetAssignments(asset.id);
    const hasGics = existingAssignments.some(
      (assignment) => assignment.taxonomyId === "industries_gics",
    );
    const hasRegions = existingAssignments.some(
      (assignment) => assignment.taxonomyId === "regions",
    );
    let processed = false;

    if (!hasGics && Object.prototype.hasOwnProperty.call(legacy, "sectors")) {
      try {
        for (const sector of parseLegacyClassifications(legacy.sectors, "sectors")) {
          const categoryId = findMappedCategory(sector.name, sectorMapping);
          if (categoryId && gicsCategories.has(categoryId)) {
            try {
              assignAssetWithSingleSelectReplacement(repository, {
                assetId: asset.id,
                taxonomyId: "industries_gics",
                categoryId,
                weight: classificationWeight(sector.weight),
                source: "migrated",
              });
              result.sectorsMigrated += 1;
              processed = true;
            } catch (error) {
              result.errors.push(
                `Failed to assign sector '${sector.name}' to asset '${asset.id}': ${errorMessage(error)}`,
              );
            }
          }
        }
      } catch (error) {
        result.errors.push(
          `Failed to parse sectors for asset '${asset.id}': ${errorMessage(error)}`,
        );
      }
    }

    if (!hasRegions && Object.prototype.hasOwnProperty.call(legacy, "countries")) {
      try {
        for (const country of parseLegacyClassifications(legacy.countries, "countries")) {
          const categoryId = findMappedCategory(country.name, countryMapping);
          if (categoryId && regionsCategories.has(categoryId)) {
            try {
              assignAssetWithSingleSelectReplacement(repository, {
                assetId: asset.id,
                taxonomyId: "regions",
                categoryId,
                weight: classificationWeight(country.weight),
                source: "migrated",
              });
              result.countriesMigrated += 1;
              processed = true;
            } catch (error) {
              result.errors.push(
                `Failed to assign country '${country.name}' to asset '${asset.id}': ${errorMessage(error)}`,
              );
            }
          }
        }
      } catch (error) {
        result.errors.push(
          `Failed to parse countries for asset '${asset.id}': ${errorMessage(error)}`,
        );
      }
    }

    if (
      Object.prototype.hasOwnProperty.call(legacy, "sectors") ||
      Object.prototype.hasOwnProperty.call(legacy, "countries")
    ) {
      cleanupLegacyAssetMetadata(db, asset);
    }

    if (processed) {
      result.assetsProcessed += 1;
    }
  }

  return result;
}

function assignAssetWithSingleSelectReplacement(
  repository: Pick<
    TaxonomyRepository,
    "deleteAssetAssignments" | "getTaxonomy" | "upsertAssignment"
  >,
  assignment: NewAssetTaxonomyAssignment,
): AssetTaxonomyAssignment {
  const taxonomy = repository.getTaxonomy(assignment.taxonomyId);
  if (taxonomy?.isSingleSelect) {
    repository.deleteAssetAssignments(assignment.assetId, assignment.taxonomyId);
  }
  return repository.upsertAssignment(assignment);
}

function readClassificationAssets(db: Database): ClassificationAsset[] {
  return db
    .query<ClassificationAssetRow, []>(
      `
        SELECT id, name, display_code, metadata
        FROM assets
      `,
    )
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      displayCode: row.display_code,
      metadata: row.metadata ? parseMetadata(row.metadata, row.id) : null,
    }));
}

function parseMetadata(rawMetadata: string, assetId: string): Record<string, unknown> {
  const parsed = JSON.parse(rawMetadata) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`Invalid metadata for asset ${assetId}`);
  }
  return parsed;
}

function getLegacyClassificationRecord(
  metadata: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const legacy = metadata?.legacy;
  return isRecord(legacy) ? legacy : null;
}

function hasLegacyClassificationValue(value: unknown): boolean {
  return value !== undefined && value !== null && (typeof value !== "string" || value.length > 0);
}

function parseLegacyClassifications(
  value: unknown,
  label: "sectors" | "countries",
): LegacyClassification[] {
  if (typeof value === "string") {
    if (value.length === 0) {
      return [];
    }
    try {
      return parseLegacyClassificationArray(JSON.parse(value), label);
    } catch (error) {
      throw new Error(`Failed to parse ${label} JSON: ${errorMessage(error)}`);
    }
  }
  if (Array.isArray(value)) {
    return parseLegacyClassificationArray(value, label);
  }
  if (value === null) {
    return [];
  }
  throw new Error(`Unexpected ${label} value type`);
}

function parseLegacyClassificationArray(
  value: unknown,
  label: "sectors" | "countries",
): LegacyClassification[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`${label}[${index}] must be an object`);
    }
    if (typeof entry.name !== "string") {
      throw new Error(`${label}[${index}].name must be a string`);
    }
    if (typeof entry.weight !== "number" || !Number.isFinite(entry.weight)) {
      throw new Error(`${label}[${index}].weight must be a finite number`);
    }
    return { name: entry.name, weight: entry.weight };
  });
}

function cleanupLegacyAssetMetadata(db: Database, asset: ClassificationAsset): void {
  const identifiers = asset.metadata?.identifiers;
  const nextMetadata = identifiers === undefined ? null : JSON.stringify({ identifiers });
  db.prepare("UPDATE assets SET metadata = ? WHERE id = ?").run(nextMetadata, asset.id);
}

function getAssetAssignmentsForDb(db: Database, assetId: string): AssetTaxonomyAssignment[] {
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
}

function readTaxonomyWithCategoriesNullable(
  db: Database,
  id: string,
): TaxonomyWithCategories | null {
  const taxonomy = db
    .query<TaxonomyRow, [string]>(
      `
        SELECT ${taxonomyColumns()}
        FROM taxonomies
        WHERE id = ?
      `,
    )
    .get(id);
  if (!taxonomy) {
    return null;
  }
  return {
    taxonomy: taxonomyFromRow(taxonomy),
    categories: db
      .query<TaxonomyCategoryRow, [string]>(
        `
          SELECT ${taxonomyCategoryColumns()}
          FROM taxonomy_categories
          WHERE taxonomy_id = ?
          ORDER BY sort_order ASC
        `,
      )
      .all(id)
      .map(taxonomyCategoryFromRow),
  };
}

function classificationWeight(weight: number): number {
  return Math.max(0, Math.min(10_000, Math.round(weight * 10_000)));
}

function findMappedCategory(name: string, mapping: Map<string, string>): string | undefined {
  return mapping.get(name.toLowerCase().trim());
}

function buildSectorMapping(): Map<string, string> {
  return new Map([
    ["energy", "10"],
    ["basic materials", "15"],
    ["materials", "15"],
    ["industrials", "20"],
    ["consumer cyclical", "25"],
    ["consumer discretionary", "25"],
    ["consumer defensive", "30"],
    ["consumer staples", "30"],
    ["healthcare", "35"],
    ["health care", "35"],
    ["financial services", "40"],
    ["financial", "40"],
    ["financials", "40"],
    ["technology", "45"],
    ["information technology", "45"],
    ["communication services", "50"],
    ["telecommunications", "50"],
    ["utilities", "55"],
    ["real estate", "60"],
  ]);
}

function buildCountryMapping(): Map<string, string> {
  return new Map([
    ["united states", "country_US"],
    ["usa", "country_US"],
    ["us", "country_US"],
    ["u.s.", "country_US"],
    ["u.s.a.", "country_US"],
    ["america", "country_US"],
    ["canada", "country_CA"],
    ["mexico", "country_MX"],
    ["bermuda", "country_BM"],
    ["united kingdom", "country_GB"],
    ["uk", "country_GB"],
    ["great britain", "country_GB"],
    ["britain", "country_GB"],
    ["england", "country_GB"],
    ["germany", "country_DE"],
    ["france", "country_FR"],
    ["netherlands", "country_NL"],
    ["holland", "country_NL"],
    ["switzerland", "country_CH"],
    ["belgium", "country_BE"],
    ["austria", "country_AT"],
    ["luxembourg", "country_LU"],
    ["ireland", "country_IE"],
    ["sweden", "country_SE"],
    ["norway", "country_NO"],
    ["denmark", "country_DK"],
    ["finland", "country_FI"],
    ["iceland", "country_IS"],
    ["spain", "country_ES"],
    ["italy", "country_IT"],
    ["portugal", "country_PT"],
    ["greece", "country_GR"],
    ["poland", "country_PL"],
    ["russia", "country_RU"],
    ["czech republic", "country_CZ"],
    ["czechia", "country_CZ"],
    ["hungary", "country_HU"],
    ["romania", "country_RO"],
    ["ukraine", "country_UA"],
    ["japan", "country_JP"],
    ["china", "country_CN"],
    ["hong kong", "country_HK"],
    ["south korea", "country_KR"],
    ["korea", "country_KR"],
    ["taiwan", "country_TW"],
    ["mongolia", "country_MN"],
    ["singapore", "country_SG"],
    ["indonesia", "country_ID"],
    ["malaysia", "country_MY"],
    ["thailand", "country_TH"],
    ["vietnam", "country_VN"],
    ["philippines", "country_PH"],
    ["india", "country_IN"],
    ["pakistan", "country_PK"],
    ["bangladesh", "country_BD"],
    ["sri lanka", "country_LK"],
    ["israel", "country_IL"],
    ["turkey", "country_TR"],
    ["saudi arabia", "country_SA"],
    ["united arab emirates", "country_AE"],
    ["uae", "country_AE"],
    ["qatar", "country_QA"],
    ["kuwait", "country_KW"],
    ["australia", "country_AU"],
    ["new zealand", "country_NZ"],
    ["brazil", "country_BR"],
    ["argentina", "country_AR"],
    ["chile", "country_CL"],
    ["colombia", "country_CO"],
    ["peru", "country_PE"],
    ["venezuela", "country_VE"],
    ["south africa", "country_ZA"],
    ["egypt", "country_EG"],
    ["nigeria", "country_NG"],
    ["kenya", "country_KE"],
    ["morocco", "country_MA"],
    ["cayman islands", "country_KY"],
    ["puerto rico", "country_PR"],
    ["bahamas", "country_BS"],
  ]);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validateI32Field(value: number, field: string): void {
  if (!Number.isInteger(value) || value < -2_147_483_648 || value > 2_147_483_647) {
    throw new Error(
      `Invalid input: ${field} must be an integer between -2147483648 and 2147483647`,
    );
  }
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
