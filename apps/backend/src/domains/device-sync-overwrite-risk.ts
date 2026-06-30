import type { Database } from "bun:sqlite";

const OVERWRITE_RISK_TABLE_COUNTS: ReadonlyArray<readonly [string, string | null]> = [
  ["platforms", null],
  ["market_data_custom_providers", null],
  ["accounts", null],
  [
    "assets",
    "kind IN ('PROPERTY', 'VEHICLE', 'COLLECTIBLE', 'PRECIOUS_METAL', 'PRIVATE_EQUITY', 'LIABILITY', 'OTHER')",
  ],
  ["quotes", "source = 'MANUAL'"],
  ["goals", null],
  ["goal_plans", null],
  ["ai_threads", null],
  ["ai_messages", null],
  ["ai_thread_tags", null],
  ["contribution_limits", null],
  ["import_runs", "UPPER(run_type) = 'IMPORT' AND UPPER(source_system) IN ('CSV', 'MANUAL')"],
  [
    "activities",
    "is_user_modified = 1 OR UPPER(COALESCE(source_system, '')) IN ('MANUAL', 'CSV') OR ((import_run_id IS NULL OR TRIM(import_run_id) = '') AND (source_record_id IS NULL OR TRIM(source_record_id) = ''))",
  ],
  ["import_templates", "UPPER(scope) != 'SYSTEM'"],
  ["import_account_templates", null],
  ["taxonomies", "is_system = 0"],
  ["taxonomy_categories", "taxonomy_id = 'custom_groups'"],
  ["asset_taxonomy_assignments", null],
  ["goals_allocation", null],
];

export function localOverwriteRiskSummary(db: Database): {
  totalRows: number;
  nonEmptyTables: Array<{ table: string; rows: number }>;
} {
  let totalRows = 0;
  const nonEmptyTables: Array<{ table: string; rows: number }> = [];
  for (const [table, filter] of OVERWRITE_RISK_TABLE_COUNTS) {
    if (!sqliteTableExists(db, table)) {
      continue;
    }
    const sql = `SELECT COUNT(*) AS count FROM "${table}"${filter ? ` WHERE ${filter}` : ""}`;
    const row = db.query<{ count: number }, []>(sql).get();
    const count = row?.count ?? 0;
    totalRows += count;
    if (count > 0) {
      nonEmptyTables.push({ table, rows: count });
    }
  }
  nonEmptyTables.sort(
    (left, right) => right.rows - left.rows || left.table.localeCompare(right.table),
  );
  return { totalRows, nonEmptyTables };
}

function sqliteTableExists(db: Database, tableName: string): boolean {
  return (
    db
      .query<
        { name: string },
        [string]
      >("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName) !== null
  );
}
