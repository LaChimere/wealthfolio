import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import { openSqliteDatabase } from "../storage/sqlite";
import { createAppUtilityService } from "./app-utilities";

const fixedNow = () => new Date(2026, 4, 6, 7, 8, 9);

describe("TS app utility domain", () => {
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
          platforms: { "web-docker-x86_64": { url: "https://example.test/download" } },
          changelog_url: "https://example.test/changelog",
          screenshots: ["https://example.test/screenshot.png", 123],
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
});
