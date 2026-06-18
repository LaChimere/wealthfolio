import { Database } from "bun:sqlite";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";

export const DIESEL_SCHEMA_MIGRATIONS_TABLE = "__diesel_schema_migrations";
export const DEFAULT_MIGRATIONS_RELATIVE_PATH = "crates/storage-sqlite/migrations";

export interface SqlMigration {
  version: string;
  upSql: string;
  downSql: string;
  directory: string;
}

export interface InitializedSqliteDatabase {
  db: Database;
  dbPath: string;
  appliedMigrations: string[];
}

interface MigrationRow {
  version: string;
}

export function getSqliteDbPath(appDataDir: string, env: NodeJS.ProcessEnv = process.env): string {
  const wfDbPath = env.WF_DB_PATH?.trim();
  if (wfDbPath) {
    return isSqliteDbDirectoryPath(wfDbPath) ? path.join(wfDbPath, "app.db") : wfDbPath;
  }

  return path.join(appDataDir, "app.db");
}

export function isSqliteDbDirectoryPath(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.endsWith("/") || trimmed.endsWith("\\")) {
    return true;
  }
  try {
    return statSync(trimmed).isDirectory();
  } catch {
    return false;
  }
}

export function resolveMigrationsDir(repositoryRoot: string): string {
  return path.join(repositoryRoot, DEFAULT_MIGRATIONS_RELATIVE_PATH);
}

export function openSqliteDatabase(dbPath: string): Database {
  const dbDir = path.dirname(dbPath);
  mkdirSync(dbDir, { recursive: true });
  const db = new Database(dbPath, { create: true, readwrite: true });
  applyConnectionPragmas(db);
  return db;
}

export function initializeSqliteDatabase({
  appDataDir,
  migrationsDir,
  env = process.env,
}: {
  appDataDir: string;
  migrationsDir: string;
  env?: NodeJS.ProcessEnv;
}): InitializedSqliteDatabase {
  const dbPath = getSqliteDbPath(appDataDir, env);
  const db = openSqliteDatabase(dbPath);
  try {
    const appliedMigrations = runPendingMigrations(db, loadSqlMigrations(migrationsDir));
    return { db, dbPath, appliedMigrations };
  } catch (error) {
    db.close();
    throw error;
  }
}

export function loadSqlMigrations(migrationsDir: string): SqlMigration[] {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const directory = path.join(migrationsDir, entry.name);
      return {
        version: entry.name,
        upSql: readFileSync(path.join(directory, "up.sql"), "utf8"),
        downSql: readFileSync(path.join(directory, "down.sql"), "utf8"),
        directory,
      };
    })
    .sort((left, right) => left.version.localeCompare(right.version));
}

export function runPendingMigrations(db: Database, migrations: readonly SqlMigration[]): string[] {
  applyMigrationPragmas(db);
  try {
    ensureDieselMigrationTable(db);
    const applied = getAppliedMigrationVersions(db);
    const appliedNow: string[] = [];
    const insertMigration = db.prepare(
      `INSERT INTO ${DIESEL_SCHEMA_MIGRATIONS_TABLE} (version) VALUES (?)`,
    );

    for (const migration of migrations) {
      if (applied.has(migration.version)) {
        continue;
      }
      db.transaction(() => {
        db.exec(migration.upSql);
        insertMigration.run(migration.version);
      })();
      applied.add(migration.version);
      appliedNow.push(migration.version);
    }
    return appliedNow;
  } finally {
    restoreMigrationPragmas(db);
    try {
      db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    } catch (error) {
      console.warn(
        "WAL checkpoint after TS SQLite migration failed:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

export function getAppliedMigrationVersions(db: Database): Set<string> {
  ensureDieselMigrationTable(db);
  const rows = db
    .query<MigrationRow, []>(`SELECT version FROM ${DIESEL_SCHEMA_MIGRATIONS_TABLE}`)
    .all();
  return new Set(rows.map((row) => row.version));
}

export function backupDatabaseToFile(
  appDataDir: string,
  backupPath: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const dbPath = getSqliteDbPath(appDataDir, env);
  mkdirSync(path.dirname(backupPath), { recursive: true });
  rmSync(backupPath, { force: true });

  const db = openSqliteDatabase(dbPath);
  try {
    db.exec("PRAGMA wal_checkpoint(FULL);");
    db.exec(`VACUUM INTO '${escapeSqliteString(backupPath)}';`);
  } finally {
    db.close();
  }
}

export function restoreDatabase(
  appDataDir: string,
  backupFilePath: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!existsSync(backupFilePath)) {
    throw new Error("Backup file not found");
  }

  const dbPath = getSqliteDbPath(appDataDir, env);
  mkdirSync(path.dirname(dbPath), { recursive: true });
  createPreRestoreBackup(dbPath);
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
  copyFileSync(backupFilePath, dbPath);

  const backupWalPath = `${backupFilePath}-wal`;
  if (existsSync(backupWalPath)) {
    copyFileSync(backupWalPath, `${dbPath}-wal`);
  }
  const backupShmPath = `${backupFilePath}-shm`;
  if (existsSync(backupShmPath)) {
    copyFileSync(backupShmPath, `${dbPath}-shm`);
  }

  const db = openSqliteDatabase(dbPath);
  db.close();
}

function createPreRestoreBackup(dbPath: string): void {
  if (!existsSync(dbPath)) {
    return;
  }

  const backupPath = `${dbPath}.pre-restore-${formatLocalTimestamp(new Date())}`;
  copyFileSync(dbPath, backupPath);
  const walPath = `${dbPath}-wal`;
  if (existsSync(walPath)) {
    copyFileSync(walPath, `${backupPath}-wal`);
  }
  const shmPath = `${dbPath}-shm`;
  if (existsSync(shmPath)) {
    copyFileSync(shmPath, `${backupPath}-shm`);
  }
}

export function applyConnectionPragmas(db: Database): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 30000;
    PRAGMA synchronous = NORMAL;
  `);
}

function applyMigrationPragmas(db: Database): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = OFF;
    PRAGMA synchronous = OFF;
    PRAGMA cache_size = -64000;
    PRAGMA temp_store = MEMORY;
  `);
}

function restoreMigrationPragmas(db: Database): void {
  db.exec(`
    PRAGMA temp_store = DEFAULT;
    PRAGMA cache_size = -2000;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
  `);
}

function ensureDieselMigrationTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${DIESEL_SCHEMA_MIGRATIONS_TABLE} (
      version VARCHAR(50) PRIMARY KEY NOT NULL,
      run_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function escapeSqliteString(value: string): string {
  return value.replaceAll("'", "''");
}

function formatLocalTimestamp(date: Date): string {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "_",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}
