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

export interface TaxonomyWithCategories {
  taxonomy: Taxonomy;
  categories: TaxonomyCategory[];
}

export interface TaxonomyReadRepository {
  getTaxonomies(): Taxonomy[];
  getTaxonomy(id: string): Taxonomy | null;
  getCategories(taxonomyId: string): TaxonomyCategory[];
  getTaxonomyWithCategories(id: string): TaxonomyWithCategories | null;
}

export interface TaxonomyReadService {
  getTaxonomies(): Taxonomy[];
  getTaxonomy(id: string): TaxonomyWithCategories | null;
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

export function createTaxonomyReadRepository(db: Database): TaxonomyReadRepository {
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
    getTaxonomyWithCategories(id) {
      const taxonomy = getTaxonomy(id);
      if (!taxonomy) {
        return null;
      }
      return {
        taxonomy,
        categories: getCategories(id),
      };
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

function toApiDate(value: string): string {
  return value.includes(" ") ? value.replace(" ", "T") : value;
}
