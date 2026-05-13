import { describe, expect, test } from "bun:test";

import {
  openAddonPackageDialog,
  openCsvFileDialog,
  openDatabaseFileDialog,
  openExternalUrl,
  openFolderDialog,
  saveFileDialog,
} from "./native";

function createDialog(openResult: { canceled: boolean; filePaths: string[] }) {
  return {
    openCalls: [] as unknown[],
    saveCalls: [] as unknown[],
    async showOpenDialog(options: unknown) {
      this.openCalls.push(options);
      return openResult;
    },
    async showSaveDialog(options: unknown) {
      this.saveCalls.push(options);
      return { canceled: false, filePath: "/tmp/export.csv" };
    },
  };
}

describe("Electron native bridge", () => {
  test("opens CSV, folder, and database dialogs with Tauri-compatible return shapes", async () => {
    const csvDialog = createDialog({ canceled: false, filePaths: ["/tmp/import.csv"] });
    await expect(openCsvFileDialog(csvDialog)).resolves.toBe("/tmp/import.csv");
    expect(csvDialog.openCalls[0]).toEqual({
      filters: [{ name: "CSV", extensions: ["csv"] }],
      properties: ["openFile"],
    });

    const folderDialog = createDialog({ canceled: false, filePaths: ["/tmp/exports"] });
    await expect(openFolderDialog(folderDialog)).resolves.toBe("/tmp/exports");
    expect(folderDialog.openCalls[0]).toEqual({ properties: ["openDirectory"] });

    const databaseDialog = createDialog({ canceled: true, filePaths: [] });
    await expect(openDatabaseFileDialog(databaseDialog)).resolves.toBeNull();
  });

  test("opens and reads addon package ZIP files in Electron main", async () => {
    const dialog = createDialog({ canceled: false, filePaths: ["/tmp/addons/example.zip"] });

    await expect(
      openAddonPackageDialog(dialog, async (filePath) => {
        expect(filePath).toBe("/tmp/addons/example.zip");
        return new Uint8Array([80, 75, 3, 4]);
      }),
    ).resolves.toEqual({
      fileName: "example.zip",
      data: new Uint8Array([80, 75, 3, 4]),
    });
    expect(dialog.openCalls[0]).toEqual({
      filters: [{ name: "Addon Packages", extensions: ["zip"] }],
      properties: ["openFile"],
    });

    await expect(
      openAddonPackageDialog(createDialog({ canceled: true, filePaths: [] }), async () => {
        throw new Error("read should not be called");
      }),
    ).resolves.toBeNull();
  });

  test("saves string and byte content through the native save dialog", async () => {
    const dialog = createDialog({ canceled: false, filePaths: [] });
    const writes: Array<{ path: string; content: number[] }> = [];

    await expect(
      saveFileDialog(
        { fileName: "export.csv", content: "a,b" },
        dialog,
        async (filePath, content) => {
          writes.push({ path: filePath, content: [...content] });
        },
      ),
    ).resolves.toBe(true);
    await expect(
      saveFileDialog(
        { fileName: "backup.bin", content: new Uint8Array([1, 2, 3]) },
        dialog,
        async (filePath, content) => {
          writes.push({ path: filePath, content: [...content] });
        },
      ),
    ).resolves.toBe(true);
    await expect(
      saveFileDialog(
        { fileName: "array.bin", content: [4, 5, 6] },
        dialog,
        async (filePath, content) => {
          writes.push({ path: filePath, content: [...content] });
        },
      ),
    ).resolves.toBe(true);
    await expect(
      saveFileDialog(
        { fileName: "buffer.bin", content: Uint8Array.from([7, 8, 9]).buffer },
        dialog,
        async (filePath, content) => {
          writes.push({ path: filePath, content: [...content] });
        },
      ),
    ).resolves.toBe(true);

    expect(dialog.saveCalls[0]).toEqual({
      defaultPath: "export.csv",
      filters: [{ name: "export.csv", extensions: ["csv"] }],
    });
    expect(writes).toEqual([
      { path: "/tmp/export.csv", content: [97, 44, 98] },
      { path: "/tmp/export.csv", content: [1, 2, 3] },
      { path: "/tmp/export.csv", content: [4, 5, 6] },
      { path: "/tmp/export.csv", content: [7, 8, 9] },
    ]);
  });

  test("returns false when save is cancelled and rejects malformed save payloads", async () => {
    const dialog = {
      async showOpenDialog() {
        return { canceled: false, filePaths: [] };
      },
      async showSaveDialog() {
        return { canceled: true };
      },
    };

    await expect(
      saveFileDialog({ fileName: "export.csv", content: "ok" }, dialog, async () => {}),
    ).resolves.toBe(false);
    await expect(saveFileDialog(null, dialog, async () => {})).rejects.toThrow(
      "Invalid save file request.",
    );
    await expect(
      saveFileDialog({ fileName: "", content: "ok" }, dialog, async () => {}),
    ).rejects.toThrow("Invalid save file name.");
    await expect(
      saveFileDialog(
        { fileName: "x", content: [999] },
        createDialog({ canceled: false, filePaths: [] }),
        async () => {},
      ),
    ).rejects.toThrow("Invalid save file content.");
    await expect(
      saveFileDialog(
        { fileName: "x", content: [1, "bad", 3] },
        createDialog({ canceled: false, filePaths: [] }),
        async () => {},
      ),
    ).rejects.toThrow("Invalid save file content.");
  });

  test("opens only safe external URL protocols", async () => {
    const opened: string[] = [];
    const shell = {
      async openExternal(url: string) {
        opened.push(url);
      },
    };

    await openExternalUrl("https://wealthfolio.app/docs", shell);
    await openExternalUrl("mailto:support@wealthfolio.app", shell);
    await expect(openExternalUrl("file:///etc/passwd", shell)).rejects.toThrow(
      "Unsupported external URL protocol: file:",
    );
    await expect(openExternalUrl("javascript:alert(1)", shell)).rejects.toThrow(
      "Unsupported external URL protocol: javascript:",
    );
    await expect(openExternalUrl("data:text/html,<script></script>", shell)).rejects.toThrow(
      "Unsupported external URL protocol: data:",
    );
    await expect(openExternalUrl(null, shell)).rejects.toThrow("Invalid external URL.");
    await expect(openExternalUrl("not a url", shell)).rejects.toThrow();

    expect(opened).toEqual(["https://wealthfolio.app/docs", "mailto:support@wealthfolio.app"]);
  });
});
