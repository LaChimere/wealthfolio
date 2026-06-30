import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";

import { createWindowStatePersistence, validateWindowState } from "./window-state";

describe("Electron window state", () => {
  test("validates persisted bounds before applying them", () => {
    expect(
      validateWindowState({
        height: 900,
        maximized: true,
        width: 1200,
        x: 20,
        y: 30,
      }),
    ).toEqual({
      height: 900,
      maximized: true,
      width: 1200,
      x: 20,
      y: 30,
    });

    expect(validateWindowState({ height: 100, width: 1200 })).toBeNull();
    expect(validateWindowState({ height: 900, width: 100 })).toBeNull();
    expect(validateWindowState({ height: 900.5, width: 1200 })).toBeNull();
  });

  test("loads and saves window state files", async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), "wealthfolio-window-state-test-"));
    const statePath = path.join(tempRoot, "nested", "window-state.json");
    const persistence = createWindowStatePersistence(statePath);

    try {
      await expect(persistence.load()).resolves.toBeNull();
      await persistence.save({ height: 960, maximized: false, width: 1440, x: 10, y: 20 });

      expect(JSON.parse(readFileSync(statePath, "utf8"))).toEqual({
        height: 960,
        maximized: false,
        width: 1440,
        x: 10,
        y: 20,
      });
      await expect(persistence.load()).resolves.toEqual({
        height: 960,
        maximized: false,
        width: 1440,
        x: 10,
        y: 20,
      });

      persistence.saveSync({ height: 800, maximized: true, width: 1200 });
      await expect(persistence.load()).resolves.toEqual({
        height: 800,
        maximized: true,
        width: 1200,
      });
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });
});
