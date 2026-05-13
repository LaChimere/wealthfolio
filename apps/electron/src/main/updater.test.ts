import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import {
  createElectronUpdaterService,
  validateCheckForUpdatesOptions,
  type ElectronUpdaterApp,
  type UpdateDownloadProgress,
} from "./updater";

interface FakeUpdateInfo {
  version: string;
  files: [];
  path: string;
  sha512: string;
  releaseDate: string;
  releaseNotes?: string | Array<{ version: string; note: string | null }> | null;
  changelogUrl?: string;
  screenshots?: string[];
}

class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  logger: unknown = {};
  checkResults: Array<{ isUpdateAvailable: boolean; updateInfo: FakeUpdateInfo } | null> = [];
  downloaded = false;
  quitAndInstallCalls = 0;

  async checkForUpdates() {
    return this.checkResults.shift() ?? null;
  }

  async downloadUpdate() {
    this.downloaded = true;
    this.emit("download-progress", { transferred: 25, total: 100 });
    return ["/tmp/update"];
  }

  quitAndInstall() {
    this.quitAndInstallCalls += 1;
  }
}

function createTempResources(): string {
  const tempRoot = mkdtempSync(path.join(tmpdir(), "wealthfolio-electron-updater-test-"));
  writeFileSync(path.join(tempRoot, "app-update.yml"), "provider: github\n");
  return tempRoot;
}

function createUpdateInfo(overrides: Partial<FakeUpdateInfo> = {}): FakeUpdateInfo {
  return {
    version: "3.5.0",
    files: [],
    path: "Wealthfolio.zip",
    sha512: "sha512",
    releaseDate: "2026-01-01T00:00:00.000Z",
    releaseNotes: "Release notes",
    ...overrides,
  };
}

describe("Electron updater service", () => {
  test("maps electron-updater update information to the frontend update shape", async () => {
    const resourcesPath = createTempResources();
    const updater = new FakeUpdater();
    updater.checkResults.push({
      isUpdateAvailable: true,
      updateInfo: createUpdateInfo({
        changelogUrl: "https://example.com/changelog",
        screenshots: ["https://example.com/screenshot.png"],
      }),
    });

    try {
      const service = createElectronUpdaterService({
        app: { isPackaged: true, getVersion: () => "3.4.0" },
        resourcesPath,
        updater: updater as never,
        sendProgress() {},
      });

      await expect(service.checkForUpdates()).resolves.toEqual({
        currentVersion: "3.4.0",
        latestVersion: "3.5.0",
        notes: "Release notes",
        pubDate: "2026-01-01T00:00:00.000Z",
        isAppStoreBuild: false,
        changelogUrl: "https://example.com/changelog",
        screenshots: ["https://example.com/screenshot.png"],
      });
      expect(updater.autoDownload).toBe(false);
      expect(updater.autoInstallOnAppQuit).toBe(false);
      expect(updater.logger).toBeNull();
    } finally {
      rmSync(resourcesPath, { force: true, recursive: true });
    }
  });

  test("returns null for unpackaged startup checks and explicit errors for manual checks", async () => {
    const app: ElectronUpdaterApp = { isPackaged: false, getVersion: () => "3.4.0" };
    const service = createElectronUpdaterService({
      app,
      resourcesPath: tmpdir(),
      updater: new FakeUpdater() as never,
      sendProgress() {},
    });

    await expect(service.checkForUpdates()).resolves.toBeNull();
    await expect(service.checkForUpdates({ force: true })).rejects.toThrow(
      "Electron auto-update requires a packaged build.",
    );
    await expect(service.installUpdate()).rejects.toThrow(
      "Electron auto-update requires a packaged build.",
    );
  });

  test("fails packaged update operations when app-update.yml is missing", async () => {
    const resourcesPath = mkdtempSync(path.join(tmpdir(), "wealthfolio-electron-updater-missing-"));

    try {
      const service = createElectronUpdaterService({
        app: { isPackaged: true, getVersion: () => "3.4.0" },
        resourcesPath,
        updater: new FakeUpdater() as never,
        sendProgress() {},
      });

      await expect(service.checkForUpdates()).rejects.toThrow(/Missing .*app-update\.yml/);
      await expect(service.installUpdate()).rejects.toThrow(/Missing .*app-update\.yml/);
    } finally {
      rmSync(resourcesPath, { force: true, recursive: true });
    }
  });

  test("downloads an update, emits progress, and starts installer restart", async () => {
    const resourcesPath = createTempResources();
    const updater = new FakeUpdater();
    updater.checkResults.push({ isUpdateAvailable: true, updateInfo: createUpdateInfo() });
    const progress: UpdateDownloadProgress[] = [];

    try {
      const service = createElectronUpdaterService({
        app: { isPackaged: true, getVersion: () => "3.4.0" },
        resourcesPath,
        updater: updater as never,
        sendProgress: (event) => progress.push(event),
      });

      await service.installUpdate();

      expect(updater.downloaded).toBe(true);
      expect(updater.quitAndInstallCalls).toBe(1);
      expect(progress).toEqual([
        { downloaded: 25, total: 100, phase: "downloading" },
        { downloaded: 0, total: null, phase: "installing" },
      ]);
      expect(updater.listenerCount("download-progress")).toBe(0);
    } finally {
      rmSync(resourcesPath, { force: true, recursive: true });
    }
  });

  test("rejects malformed update check payloads", () => {
    expect(validateCheckForUpdatesOptions(undefined)).toEqual({});
    expect(validateCheckForUpdatesOptions({ force: true })).toEqual({ force: true });
    expect(() => validateCheckForUpdatesOptions({ force: "yes" })).toThrow(
      'requires boolean payload field "force"',
    );
    expect(() => validateCheckForUpdatesOptions([])).toThrow("requires an object payload");
  });
});
