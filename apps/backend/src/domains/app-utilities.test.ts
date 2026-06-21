import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import { openSqliteDatabase } from "../storage/sqlite";
import { createAppUtilityService, isValidBackupFilename } from "./app-utilities";

const fixedNow = () => new Date(2026, 4, 6, 7, 8, 9);

describe("TS app utility domain", () => {
  test("validates backup filenames with Rust-compatible proleptic dates", () => {
    expect(isValidBackupFilename("wealthfolio_backup_00000229_000000.db")).toBe(true);
    expect(isValidBackupFilename("wealthfolio_backup_19000229_000000.db")).toBe(false);
    expect(isValidBackupFilename("wealthfolio_backup_20260431_000000.db")).toBe(false);
    expect(isValidBackupFilename("wealthfolio_backup_20260506_240000.db")).toBe(false);
  });

  test("returns app info from runtime options", () => {
    const service = createAppUtilityService({
      appDataDir: "/tmp/wealthfolio-data",
      appVersion: "3.4.0",
      dbPath: "/tmp/wealthfolio-data/app.db",
      logsDir: "/tmp/wealthfolio-data/logs",
    });

    expect(service.getAppInfo()).toEqual({
      version: "3.4.0",
      dbPath: "/tmp/wealthfolio-data/app.db",
      logsDir: "/tmp/wealthfolio-data/logs",
    });
  });

  test("checks updates with Rust-compatible 404 handling, response mapping, and cache", async () => {
    const calls: string[] = [];
    const service = createAppUtilityService({
      appDataDir: "/tmp/wealthfolio-data",
      appVersion: "3.4.0",
      arch: "x64",
      dbPath: "/tmp/wealthfolio-data/app.db",
      fetchUpdate: async (input, init) => {
        calls.push(input);
        expect(init?.headers).toMatchObject({
          "X-Client-Runtime": "web-docker",
          "X-Instance-Id": "instance-1",
        });
        if (calls.length === 1) {
          return new Response(null, { status: 404 });
        }
        return Response.json({
          version: "3.5.0",
          notes: "Release notes",
          pub_date: "2026-05-06",
          pubDate: "ignored",
          platforms: { "web-docker-x86_64": { url: "https://example.test/download" } },
          changelog_url: "https://example.test/changelog",
          changelogUrl: "https://example.test/ignored",
          screenshots: ["https://example.test/screenshot.png"],
        });
      },
      instanceId: () => "instance-1",
      logsDir: "/tmp/wealthfolio-data/logs",
      now: fixedNow,
      target: "web-docker",
    });

    await expect(service.checkUpdate(false)).resolves.toEqual({
      updateAvailable: false,
      latestVersion: "3.4.0",
      notes: null,
      pubDate: null,
      downloadUrl: null,
      changelogUrl: null,
      screenshots: null,
    });
    await expect(service.checkUpdate(false)).resolves.toEqual({
      updateAvailable: false,
      latestVersion: "3.4.0",
      notes: null,
      pubDate: null,
      downloadUrl: null,
      changelogUrl: null,
      screenshots: null,
    });
    await expect(service.checkUpdate(true)).resolves.toEqual({
      updateAvailable: true,
      latestVersion: "3.5.0",
      notes: "Release notes",
      pubDate: "2026-05-06",
      downloadUrl: "https://example.test/download",
      changelogUrl: "https://example.test/changelog",
      screenshots: ["https://example.test/screenshot.png"],
    });
    expect(calls).toEqual([
      "https://wealthfolio.app/releases/web-docker/x86_64/3.4.0",
      "https://wealthfolio.app/releases/web-docker/x86_64/3.4.0",
    ]);
  });

  test("sends an empty instance-id update header like Rust", async () => {
    const service = createAppUtilityService({
      appDataDir: "/tmp/wealthfolio-data",
      appVersion: "3.4.0",
      dbPath: "/tmp/wealthfolio-data/app.db",
      fetchUpdate: async (_input, init) => {
        expect(init?.headers).toMatchObject({
          "X-Client-Runtime": "web-docker",
          "X-Instance-Id": "",
        });
        return new Response(null, { status: 404 });
      },
      instanceId: "",
      logsDir: "/tmp/wealthfolio-data/logs",
    });

    await expect(service.checkUpdate(false)).resolves.toMatchObject({
      updateAvailable: false,
      latestVersion: "3.4.0",
    });
  });

  test("parses non-404 update responses regardless of HTTP status like Rust", async () => {
    const service = createAppUtilityService({
      appDataDir: "/tmp/wealthfolio-data",
      appVersion: "3.4.0",
      arch: "x64",
      dbPath: "/tmp/wealthfolio-data/app.db",
      fetchUpdate: async () =>
        Response.json(
          {
            version: "3.5.0",
            notes: "Release notes",
            pub_date: "2026-05-06",
            platforms: { "web-docker-x86_64": { url: "https://example.test/download" } },
          },
          { status: 500 },
        ),
      logsDir: "/tmp/wealthfolio-data/logs",
      target: "web-docker",
    });

    await expect(service.checkUpdate(true)).resolves.toMatchObject({
      updateAvailable: true,
      latestVersion: "3.5.0",
      notes: "Release notes",
      pubDate: "2026-05-06",
      downloadUrl: "https://example.test/download",
    });
  });

  test("compares update versions with Rust semver fallback semantics", async () => {
    const prereleaseService = createAppUtilityService({
      appDataDir: "/tmp/wealthfolio-data",
      appVersion: "3.4.0-0",
      arch: "x64",
      dbPath: "/tmp/wealthfolio-data/app.db",
      fetchUpdate: async () =>
        Response.json({
          version: "3.4.0",
          platforms: {},
        }),
      logsDir: "/tmp/wealthfolio-data/logs",
      target: "web-docker",
    });
    await expect(prereleaseService.checkUpdate(true)).resolves.toMatchObject({
      updateAvailable: true,
      latestVersion: "3.4.0",
    });

    const invalidLatestService = createAppUtilityService({
      appDataDir: "/tmp/wealthfolio-data",
      appVersion: "3.4.0",
      arch: "x64",
      dbPath: "/tmp/wealthfolio-data/app.db",
      fetchUpdate: async () =>
        Response.json({
          version: "3.4.1e1",
          platforms: {},
        }),
      logsDir: "/tmp/wealthfolio-data/logs",
      target: "web-docker",
    });
    await expect(invalidLatestService.checkUpdate(true)).resolves.toMatchObject({
      updateAvailable: false,
      latestVersion: "3.4.1e1",
    });

    const largeVersionService = createAppUtilityService({
      appDataDir: "/tmp/wealthfolio-data",
      appVersion: "9007199254740992.0.0",
      arch: "x64",
      dbPath: "/tmp/wealthfolio-data/app.db",
      fetchUpdate: async () =>
        Response.json({
          version: "9007199254740993.0.0",
          platforms: {},
        }),
      logsDir: "/tmp/wealthfolio-data/logs",
      target: "web-docker",
    });
    await expect(largeVersionService.checkUpdate(true)).resolves.toMatchObject({
      updateAvailable: true,
      latestVersion: "9007199254740993.0.0",
    });

    const overflowLatestService = createAppUtilityService({
      appDataDir: "/tmp/wealthfolio-data",
      appVersion: "1.0.0",
      arch: "x64",
      dbPath: "/tmp/wealthfolio-data/app.db",
      fetchUpdate: async () =>
        Response.json({
          version: "18446744073709551616.0.0",
          platforms: {},
        }),
      logsDir: "/tmp/wealthfolio-data/logs",
      target: "web-docker",
    });
    await expect(overflowLatestService.checkUpdate(true)).resolves.toMatchObject({
      updateAvailable: false,
      latestVersion: "18446744073709551616.0.0",
    });

    const buildMetadataService = createAppUtilityService({
      appDataDir: "/tmp/wealthfolio-data",
      appVersion: "1.0.0+1",
      arch: "x64",
      dbPath: "/tmp/wealthfolio-data/app.db",
      fetchUpdate: async () =>
        Response.json({
          version: "1.0.0+2",
          platforms: {},
        }),
      logsDir: "/tmp/wealthfolio-data/logs",
      target: "web-docker",
    });
    await expect(buildMetadataService.checkUpdate(true)).resolves.toMatchObject({
      updateAvailable: true,
      latestVersion: "1.0.0+2",
    });

    const leadingZeroBuildService = createAppUtilityService({
      appDataDir: "/tmp/wealthfolio-data",
      appVersion: "1.0.0+1",
      arch: "x64",
      dbPath: "/tmp/wealthfolio-data/app.db",
      fetchUpdate: async () =>
        Response.json({
          version: "1.0.0+00",
          platforms: {},
        }),
      logsDir: "/tmp/wealthfolio-data/logs",
      target: "web-docker",
    });
    await expect(leadingZeroBuildService.checkUpdate(true)).resolves.toMatchObject({
      updateAvailable: false,
      latestVersion: "1.0.0+00",
    });

    const malformedPayloadService = createAppUtilityService({
      appDataDir: "/tmp/wealthfolio-data",
      appVersion: "3.4.0",
      arch: "x64",
      dbPath: "/tmp/wealthfolio-data/app.db",
      fetchUpdate: async () =>
        Response.json({
          version: "3.5.0",
          platforms: {},
          screenshots: ["https://example.test/screenshot.png", 123],
        }),
      logsDir: "/tmp/wealthfolio-data/logs",
      target: "web-docker",
    });
    await expect(malformedPayloadService.checkUpdate(true)).rejects.toThrow(
      "Failed to parse update response: screenshots must be an array of strings",
    );
  });

  test("creates base64 and path backups from the configured app data dir", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-app-utils-"));
    const dbPath = path.join(appDataDir, "app.db");
    const db = openSqliteDatabase(dbPath);
    db.exec("CREATE TABLE entries (id TEXT PRIMARY KEY, value TEXT NOT NULL);");
    db.query("INSERT INTO entries (id, value) VALUES (?, ?)").run("entry-1", "backup-value");
    db.close();

    const backupDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-app-utils-backup-"));
    const service = createAppUtilityService({
      appDataDir,
      appVersion: "3.4.0",
      dbPath,
      logsDir: path.join(appDataDir, "logs"),
      now: fixedNow,
    });

    const backup = await service.backupDatabase();
    expect(backup.filename).toBe("wealthfolio_backup_20260506_070809.db");
    expect(Buffer.from(backup.dataB64, "base64").byteLength).toBeGreaterThan(0);

    const pathBackup = await service.backupDatabaseToPath(`file://${backupDir}`);
    expect(pathBackup.path).toBe(path.join(backupDir, "wealthfolio_backup_20260506_070809.db"));
    expect(existsSync(pathBackup.path)).toBe(true);

    const backupDb = openSqliteDatabase(pathBackup.path);
    try {
      expect(
        backupDb
          .query<{ value: string }, []>("SELECT value FROM entries WHERE id = 'entry-1';")
          .get()?.value,
      ).toBe("backup-value");
    } finally {
      backupDb.close();
    }
  });

  test("lists backup modified times with Rust-compatible RFC3339 UTC formatting", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-app-utils-list-"));
    const backupDir = path.join(appDataDir, "backups");
    mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, "wealthfolio_backup_20260506_070809.db");
    writeFileSync(backupPath, "backup");
    const modifiedAt = new Date("2026-05-06T07:08:09.120Z");
    utimesSync(backupPath, modifiedAt, modifiedAt);
    writeFileSync(path.join(backupDir, "ignored.txt"), "ignored");
    if (process.platform !== "win32") {
      const outsideDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-app-utils-list-outside-"));
      const outsideFile = path.join(outsideDir, "outside.db");
      writeFileSync(outsideFile, "outside");
      symlinkSync(outsideFile, path.join(backupDir, "wealthfolio_backup_20260507_070809.db"));
    }
    const service = createAppUtilityService({
      appDataDir,
      appVersion: "3.4.0",
      dbPath: path.join(appDataDir, "app.db"),
      logsDir: path.join(appDataDir, "logs"),
    });

    await expect(service.listDatabaseBackups()).resolves.toEqual([
      {
        filename: "wealthfolio_backup_20260506_070809.db",
        sizeBytes: 6,
        modifiedAt: "2026-05-06T07:08:09.120+00:00",
      },
    ]);
  });

  test("restores database from normalized backup paths after preparing runtime", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-app-utils-restore-"));
    const dbPath = path.join(appDataDir, "app.db");
    let db = openSqliteDatabase(dbPath);
    db.exec("CREATE TABLE entries (id TEXT PRIMARY KEY, value TEXT NOT NULL);");
    db.query("INSERT INTO entries (id, value) VALUES (?, ?)").run("entry-1", "before");
    db.close();

    const backupDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-app-utils-restore-backup-"));
    let prepareCalls = 0;
    const service = createAppUtilityService({
      appDataDir,
      appVersion: "3.4.0",
      dbPath,
      logsDir: path.join(appDataDir, "logs"),
      now: fixedNow,
      prepareDatabaseRestore: () => {
        prepareCalls += 1;
      },
      restoreSettleDelayMs: 0,
    });

    const backup = await service.backupDatabaseToPath(backupDir);

    db = openSqliteDatabase(dbPath);
    db.query("UPDATE entries SET value = ? WHERE id = ?").run("after", "entry-1");
    db.close();

    await service.restoreDatabase(`file://${backup.path}`);

    const restored = openSqliteDatabase(dbPath);
    try {
      expect(prepareCalls).toBe(1);
      expect(
        restored
          .query<{ value: string }, []>("SELECT value FROM entries WHERE id = 'entry-1';")
          .get()?.value,
      ).toBe("before");
    } finally {
      restored.close();
    }
  });

  test("does not prepare runtime when restore backup is missing", async () => {
    const service = createAppUtilityService({
      appDataDir: "/tmp/wealthfolio-data",
      appVersion: "3.4.0",
      dbPath: "/tmp/wealthfolio-data/app.db",
      logsDir: "/tmp/wealthfolio-data/logs",
      prepareDatabaseRestore: () => {
        throw new Error("should not prepare");
      },
    });

    await expect(service.restoreDatabase("/tmp/wealthfolio-missing-backup.db")).rejects.toThrow(
      "Backup file not found",
    );
  });

  test("maps missing backup deletes to Rust-compatible not found errors", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-app-utils-delete-"));
    const service = createAppUtilityService({
      appDataDir,
      appVersion: "3.4.0",
      dbPath: path.join(appDataDir, "app.db"),
      logsDir: path.join(appDataDir, "logs"),
    });

    try {
      await service.deleteDatabaseBackup("wealthfolio_backup_20260506_070809.db");
      throw new Error("expected delete to fail");
    } catch (error) {
      expect(error).toMatchObject({ message: "Backup not found", status: 404 });
    }
  });
});
