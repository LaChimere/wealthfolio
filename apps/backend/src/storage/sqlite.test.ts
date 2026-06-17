import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import {
  DIESEL_SCHEMA_MIGRATIONS_TABLE,
  backupDatabaseToFile,
  getAppliedMigrationVersions,
  getSqliteDbPath,
  initializeSqliteDatabase,
  loadSqlMigrations,
  openSqliteDatabase,
  restoreDatabase,
  resolveMigrationsDir,
  runPendingMigrations,
  type SqlMigration,
} from "./sqlite";

const repositoryRoot = path.resolve(import.meta.dir, "../../../..");

describe("TS SQLite storage foundation", () => {
  test("resolves database path with WF_DB_PATH precedence", () => {
    expect(getSqliteDbPath("/data/root", {})).toBe(path.join("/data/root", "app.db"));
    expect(getSqliteDbPath("/data/root", { DATABASE_URL: "/tmp/custom.db" })).toBe(
      path.join("/data/root", "app.db"),
    );
    expect(
      getSqliteDbPath("/data/root", {
        DATABASE_URL: "/tmp/database-url.db",
        WF_DB_PATH: "/tmp/wf-db-path.db",
      }),
    ).toBe("/tmp/wf-db-path.db");
    expect(getSqliteDbPath("/data/root", { WF_DB_PATH: "/tmp/wf-db-dir" })).toBe(
      path.join("/tmp/wf-db-dir", "app.db"),
    );
    expect(getSqliteDbPath("/data/root", { WF_DB_PATH: "/tmp/wf-db-dir/" })).toBe(
      path.join("/tmp/wf-db-dir", "app.db"),
    );
  });

  test("opens SQLite databases with Rust-compatible connection pragmas", () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-sqlite-pragmas-"));
    const db = openSqliteDatabase(path.join(appDataDir, "app.db"));

    try {
      expect(
        db.query<{ journal_mode: string }, []>("PRAGMA journal_mode;").get()?.journal_mode,
      ).toBe("wal");
      expect(
        db.query<{ foreign_keys: number }, []>("PRAGMA foreign_keys;").get()?.foreign_keys,
      ).toBe(1);
      expect(db.query<{ timeout: number }, []>("PRAGMA busy_timeout;").get()?.timeout).toBe(30_000);
    } finally {
      db.close();
    }
  });

  test("loads current Rust SQL migrations as the TS source of truth", () => {
    const migrations = loadSqlMigrations(resolveMigrationsDir(repositoryRoot));

    expect(migrations).toHaveLength(32);
    expect(migrations[0]?.version).toBe("2023-11-08-162221_init_db");
    expect(migrations.at(-1)?.version).toBe("2026-05-19-000001_lots_and_snapshot_positions");
    expect(migrations.every((migration) => migration.upSql.trim().length > 0)).toBe(true);
    expect(migrations.every((migration) => typeof migration.downSql === "string")).toBe(true);
  });

  test("runs pending migrations once and records Diesel-compatible history", () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-sqlite-migrations-"));
    const migrations = createMigrationFixture(appDataDir);
    const db = openSqliteDatabase(path.join(appDataDir, "app.db"));

    try {
      expect(runPendingMigrations(db, migrations)).toEqual([
        "2026-01-01-000001_create_fixture_accounts",
        "2026-01-02-000001_add_fixture_account",
      ]);
      expect(runPendingMigrations(db, migrations)).toEqual([]);
      expect([...getAppliedMigrationVersions(db)]).toEqual(
        migrations.map((migration) => migration.version),
      );
      expect(
        db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM fixture_accounts;").get()
          ?.count,
      ).toBe(1);
      expect(
        db
          .query<
            { name: string },
            []
          >(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${DIESEL_SCHEMA_MIGRATIONS_TABLE}';`)
          .get()?.name,
      ).toBe(DIESEL_SCHEMA_MIGRATIONS_TABLE);
    } finally {
      db.close();
    }
  });

  test("initializes a DB with migrations and returns the applied versions", () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-sqlite-init-"));
    const migrations = createMigrationFixture(appDataDir);
    const migrationsDir = path.dirname(migrations[0].directory);

    const initialized = initializeSqliteDatabase({ appDataDir, migrationsDir });

    try {
      expect(initialized.dbPath).toBe(path.join(appDataDir, "app.db"));
      expect(initialized.appliedMigrations).toHaveLength(2);
    } finally {
      initialized.db.close();
    }
  });

  test("creates self-contained backups and restores the main DB file", () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-sqlite-backup-"));
    const dbPath = path.join(appDataDir, "app.db");
    const backupPath = path.join(appDataDir, "backups", "backup.db");
    let db = openSqliteDatabase(dbPath);
    db.exec("CREATE TABLE entries (id TEXT PRIMARY KEY, value TEXT NOT NULL);");
    db.query("INSERT INTO entries (id, value) VALUES (?, ?)").run("entry-1", "before");
    db.close();

    backupDatabaseToFile(appDataDir, backupPath);

    db = openSqliteDatabase(dbPath);
    db.query("UPDATE entries SET value = ? WHERE id = ?").run("after", "entry-1");
    db.close();

    restoreDatabase(appDataDir, backupPath);

    const restored = openSqliteDatabase(dbPath);
    try {
      expect(readFileSync(backupPath).byteLength).toBeGreaterThan(0);
      expect(readdirSync(appDataDir).some((entry) => entry.includes(".pre-restore-"))).toBe(true);
      expect(restored.query<{ value: string }, []>("SELECT value FROM entries;").get()?.value).toBe(
        "before",
      );
    } finally {
      restored.close();
    }
  });
});

function createMigrationFixture(root: string): SqlMigration[] {
  const migrationsRoot = path.join(root, "migrations");
  writeMigration(
    migrationsRoot,
    "2026-01-01-000001_create_fixture_accounts",
    "CREATE TABLE fixture_accounts (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL);",
  );
  writeMigration(
    migrationsRoot,
    "2026-01-02-000001_add_fixture_account",
    "INSERT INTO fixture_accounts (id, name) VALUES ('fixture-account-1', 'Fixture');",
  );
  return loadSqlMigrations(migrationsRoot);
}

function writeMigration(root: string, version: string, upSql: string): void {
  const directory = path.join(root, version);
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "up.sql"), upSql);
  writeFileSync(path.join(directory, "down.sql"), "-- fixture down migration\n");
}
