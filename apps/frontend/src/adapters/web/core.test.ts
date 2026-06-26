import { afterEach, describe, expect, it, vi } from "vitest";

import { invoke } from "./core";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("web core invoke", () => {
  it("keeps desktop-only database path commands as controlled web errors", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(invoke("backup_database_to_path", { backupDir: "/tmp" })).rejects.toThrow(
      "Backing up to a local path is only supported in the desktop app",
    );
    await expect(invoke("restore_database", { backupFilePath: "/tmp/app.db" })).rejects.toThrow(
      "Restore in web mode requires stopping Wealthfolio and replacing app.db",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
