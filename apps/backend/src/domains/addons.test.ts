import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import { createLocalAddonService } from "./addons";

interface TestInstalledAddon {
  metadata: {
    id: string;
    name: string;
    version: string;
    main?: string;
    enabled?: boolean;
  };
  filePath: string;
  isZipAddon: boolean;
}

interface TestExtractedAddon {
  metadata: TestInstalledAddon["metadata"];
  files: Array<{
    name: string;
    content: string;
    isMain: boolean;
  }>;
}

describe("TS addon domain", () => {
  test("lists, loads, toggles, and uninstalls local filesystem addons", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-addons-"));
    const addonDir = writeAddon(appDataDir, "demo-addon", {
      manifest: {
        id: "demo-addon",
        name: "Demo Addon",
        version: "1.0.0",
        main: "main.js",
        enabled: true,
      },
      files: {
        "main.js": "export const root = true;",
        "nested/main.js": "export const nested = true;",
      },
    });
    const service = createLocalAddonService({ appDataDir });

    await expect(service.listInstalledAddons()).resolves.toEqual([
      {
        metadata: {
          id: "demo-addon",
          name: "Demo Addon",
          version: "1.0.0",
          main: "main.js",
          enabled: true,
        },
        filePath: addonDir,
        isZipAddon: true,
      },
    ]);

    const loaded = (await service.loadAddonForRuntime("demo-addon")) as TestExtractedAddon;
    expect(loaded.metadata.id).toBe("demo-addon");
    expect(loaded.files).toEqual([
      { name: "main.js", content: "export const root = true;", isMain: true },
      { name: "nested/main.js", content: "export const nested = true;", isMain: true },
    ]);
    expect(loaded.files.some((file) => file.name === "manifest.json")).toBe(false);
    await expect(service.getEnabledAddonsOnStartup()).resolves.toHaveLength(1);

    await service.toggleAddon("demo-addon", false);
    expect(JSON.parse(readFileSync(path.join(addonDir, "manifest.json"), "utf8"))).toMatchObject({
      enabled: false,
    });
    await expect(service.loadAddonForRuntime("demo-addon")).rejects.toThrow("Addon is disabled");
    await expect(service.getEnabledAddonsOnStartup()).resolves.toEqual([]);

    await service.uninstallAddon("demo-addon");
    expect(existsSync(addonDir)).toBe(false);
    await expect(service.listInstalledAddons()).resolves.toEqual([]);
  });

  test("uses Rust-compatible top-level entry count for the ZIP addon flag", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-addons-"));
    writeAddon(appDataDir, "single-file", {
      manifest: {
        id: "single-file",
        name: "Single File",
        version: "1.0.0",
        main: "main.js",
      },
      files: {
        "main.js": "export default {};",
      },
    });
    writeAddon(appDataDir, "multi-entry", {
      manifest: {
        id: "multi-entry",
        name: "Multi Entry",
        version: "1.0.0",
        main: "main.js",
      },
      files: {
        "main.js": "export default {};",
        "README.md": "# Multi Entry",
      },
    });
    const service = createLocalAddonService({ appDataDir });

    const installed = (await service.listInstalledAddons()) as TestInstalledAddon[];
    expect(
      installed
        .map((addon) => [addon.metadata.id, addon.isZipAddon])
        .sort(([left], [right]) => String(left).localeCompare(String(right))),
    ).toEqual([
      ["multi-entry", true],
      ["single-file", false],
    ]);
  });

  test("returns empty startup lists and skips broken enabled addons", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-addons-"));
    const service = createLocalAddonService({ appDataDir });

    await expect(service.listInstalledAddons()).resolves.toEqual([]);
    await expect(service.getEnabledAddonsOnStartup()).resolves.toEqual([]);

    writeAddon(appDataDir, "good-addon", {
      manifest: {
        id: "good-addon",
        name: "Good Addon",
        version: "1.0.0",
        main: "main.js",
      },
      files: {
        "main.js": "export default {};",
      },
    });
    writeAddon(appDataDir, "broken-addon", {
      manifest: {
        id: "broken-addon",
        name: "Broken Addon",
        version: "1.0.0",
        main: "missing.js",
      },
      files: {
        "main.js": "export default {};",
      },
    });

    const enabledAddons = (await service.getEnabledAddonsOnStartup()) as TestExtractedAddon[];
    expect(enabledAddons.map((addon) => addon.metadata.id)).toEqual(["good-addon"]);
  });

  test("guards unsafe paths and returns explicit disabled errors for deferred addon behavior", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-addons-"));
    const service = createLocalAddonService({ appDataDir });

    await expect(service.loadAddonForRuntime("../escape")).rejects.toThrow("Unsafe addon id");
    await expect(service.toggleAddon("../escape", true)).rejects.toThrow("Unsafe addon id");
    await expect(service.uninstallAddon("../escape")).rejects.toThrow("Unsafe addon id");
    await expect(
      service.installAddonZip({ zipData: new Uint8Array([1]), enableAfterInstall: true }),
    ).rejects.toMatchObject({ status: 501, code: "not_implemented" });
    await expect(service.fetchStoreListings()).rejects.toMatchObject({
      status: 501,
      code: "not_implemented",
    });

    await expect(service.clearAddonStaging()).resolves.toBeUndefined();
    await expect(service.clearAddonStaging("missing-addon")).resolves.toBeUndefined();
  });
});

function writeAddon(
  appDataDir: string,
  addonId: string,
  addon: {
    manifest: TestInstalledAddon["metadata"];
    files: Record<string, string>;
  },
): string {
  const addonDir = path.join(appDataDir, "addons", addonId);
  mkdirSync(addonDir, { recursive: true });
  writeFileSync(path.join(addonDir, "manifest.json"), JSON.stringify(addon.manifest, null, 2));
  for (const [name, content] of Object.entries(addon.files)) {
    const filePath = path.join(addonDir, name);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }
  return addonDir;
}
