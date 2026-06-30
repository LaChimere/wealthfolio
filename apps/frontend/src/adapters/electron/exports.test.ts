import { ELECTRON_API_KEY, type WealthfolioElectronApi } from "@wealthfolio/electron/shared/ipc";
import { afterEach, describe, expect, it, vi } from "vitest";

import { exportDataFile } from "./exports";

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

describe("electron exports adapter", () => {
  it("fetches export content through Electron main and saves it with the native picker", async () => {
    const invoke = vi.fn().mockResolvedValue({
      status: "content",
      filename: "accounts_2026-06-17.csv",
      data: [97, 44, 98],
    });
    const saveFileDialog = vi.fn().mockResolvedValue(true);
    installElectronApi({ invoke, saveFileDialog });

    await expect(exportDataFile("CSV", "accounts")).resolves.toEqual({
      status: "saved",
      filename: "accounts_2026-06-17.csv",
    });
    expect(invoke).toHaveBeenCalledWith("export_data_file", {
      format: "CSV",
      data: "accounts",
    });
    expect(saveFileDialog).toHaveBeenCalledWith({
      fileName: "accounts_2026-06-17.csv",
      content: new Uint8Array([97, 44, 98]),
    });
  });

  it("returns empty or canceled export results without pretending a file was saved", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ status: "empty" })
      .mockResolvedValueOnce({ status: "content", filename: "goals.json", data: [123, 125] });
    const saveFileDialog = vi.fn().mockResolvedValue(false);
    installElectronApi({ invoke, saveFileDialog });

    await expect(exportDataFile("JSON", "goals")).resolves.toEqual({ status: "empty" });
    await expect(exportDataFile("JSON", "goals")).resolves.toEqual({ status: "canceled" });
    expect(saveFileDialog).toHaveBeenCalledOnce();
  });
});
