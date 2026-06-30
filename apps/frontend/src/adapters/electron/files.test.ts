import { ELECTRON_API_KEY, type WealthfolioElectronApi } from "@wealthfolio/electron/shared/ipc";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  openAddonPackageDialog,
  openCsvFileDialog,
  openDatabaseFileDialog,
  openFileSaveDialog,
  openFolderDialog,
  openUrlInBrowser,
} from "./files";

function installElectronApi(api: Partial<WealthfolioElectronApi>) {
  window[ELECTRON_API_KEY] = {
    getRuntimeInfo: vi.fn(),
    invoke: vi.fn(),
    openCsvFileDialog: vi.fn(),
    openFolderDialog: vi.fn(),
    openDatabaseFileDialog: vi.fn(),
    openAddonPackageDialog: vi.fn(),
    saveFileDialog: vi.fn(),
    openExternalUrl: vi.fn(),
    ...api,
  } as WealthfolioElectronApi;
}

afterEach(() => {
  delete window[ELECTRON_API_KEY];
});

describe("electron files adapter", () => {
  it("delegates native open dialogs through the preload bridge", async () => {
    const openCsv = vi.fn().mockResolvedValue("/tmp/import.csv");
    const openFolder = vi.fn().mockResolvedValue("/tmp/exports");
    const openDatabase = vi.fn().mockResolvedValue("/tmp/app.db");
    installElectronApi({
      openCsvFileDialog: openCsv,
      openFolderDialog: openFolder,
      openDatabaseFileDialog: openDatabase,
    });

    await expect(openCsvFileDialog()).resolves.toBe("/tmp/import.csv");
    await expect(openFolderDialog()).resolves.toBe("/tmp/exports");
    await expect(openDatabaseFileDialog()).resolves.toBe("/tmp/app.db");
  });

  it("delegates addon package selection through the preload bridge", async () => {
    const openAddonPackage = vi.fn().mockResolvedValue({
      fileName: "example.zip",
      data: new Uint8Array([80, 75]),
    });
    installElectronApi({ openAddonPackageDialog: openAddonPackage });

    await expect(openAddonPackageDialog()).resolves.toEqual({
      fileName: "example.zip",
      data: new Uint8Array([80, 75]),
    });
    expect(openAddonPackage).toHaveBeenCalledOnce();
  });

  it("converts Blob saves to bytes before crossing the bridge", async () => {
    const saveFileDialog = vi.fn().mockResolvedValue(true);
    installElectronApi({ saveFileDialog });

    await expect(openFileSaveDialog(new Blob(["hello"]), "export.txt")).resolves.toBe(true);

    expect(saveFileDialog).toHaveBeenCalledWith({
      fileName: "export.txt",
      content: new Uint8Array([104, 101, 108, 108, 111]),
    });
  });

  it("delegates external URL opening through the preload bridge", async () => {
    const openExternalUrl = vi.fn().mockResolvedValue(undefined);
    installElectronApi({ openExternalUrl });

    await openUrlInBrowser("https://wealthfolio.app");

    expect(openExternalUrl).toHaveBeenCalledWith("https://wealthfolio.app");
  });
});
