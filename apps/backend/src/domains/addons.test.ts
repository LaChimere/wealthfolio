import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";

import { createLocalAddonService } from "./addons";

interface TestInstalledAddon {
  metadata: TestAddonManifest;
  filePath: string;
  isZipAddon: boolean;
}

interface TestAddonManifest {
  id: string;
  name: string;
  version: string;
  description: string | null;
  author: string | null;
  sdkVersion: string | null;
  main: string;
  enabled: boolean | null;
  permissions: TestAddonPermission[] | null;
  homepage: string | null;
  repository: string | null;
  license: string | null;
  minWealthfolioVersion: string | null;
  keywords: string[] | null;
  icon: string | null;
}

interface TestAddonPermission {
  category: string;
  functions: Array<{
    name: string;
    isDeclared: boolean;
    isDetected: boolean;
    detectedAt: string | null;
  }>;
  purpose: string;
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
        metadata: normalizedManifest({
          id: "demo-addon",
          name: "Demo Addon",
          version: "1.0.0",
          main: "main.js",
          enabled: true,
        }),
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

  test("normalizes manifests with Rust-compatible optional fields and permissions", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-addons-"));
    writeAddon(appDataDir, "metadata-addon", {
      manifest: {
        id: "metadata-addon",
        name: "Metadata Addon",
        version: "1.0.0",
        main: "main.js",
        description: 123,
        enabled: "yes",
        installedAt: "ignored",
        source: "store",
        keywords: ["wealth", 123, "local"],
        permissions: [
          {
            category: "portfolio",
            purpose: "Read portfolio data",
            functions: [
              "getHoldings",
              {
                name: "getAccounts",
                isDeclared: false,
                isDetected: true,
                detectedAt: "2026-05-17T00:00:00Z",
              },
            ],
          },
        ],
      },
      files: {
        "main.js": "export default {};",
      },
    });
    const service = createLocalAddonService({ appDataDir });

    const installed = (await service.listInstalledAddons()) as TestInstalledAddon[];
    const metadata = installed[0]?.metadata;
    if (!metadata) {
      throw new Error("Expected metadata-addon to be installed");
    }
    expect(metadata).toEqual(
      normalizedManifest({
        id: "metadata-addon",
        name: "Metadata Addon",
        version: "1.0.0",
        main: "main.js",
        enabled: null,
        keywords: ["wealth", "local"],
        permissions: [
          {
            category: "portfolio",
            purpose: "Read portfolio data",
            functions: [
              {
                name: "getHoldings",
                isDeclared: true,
                isDetected: false,
                detectedAt: null,
              },
              {
                name: "getAccounts",
                isDeclared: false,
                isDetected: true,
                detectedAt: "2026-05-17T00:00:00Z",
              },
            ],
          },
        ],
      }),
    );
    expect("installedAt" in metadata).toBe(false);
    expect("source" in metadata).toBe(false);
  });

  test("extracts addon ZIPs with manifest normalization and permission detection", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-addons-"));
    const service = createLocalAddonService({ appDataDir });
    const zipData = addonZip({
      "pkg/manifest.json": JSON.stringify({
        id: "zip-addon",
        name: "Zip Addon",
        version: "1.0.0",
        main: "addon.js",
        permissions: [
          {
            category: "portfolio",
            purpose: "Read holdings",
            functions: ["getHoldings"],
          },
        ],
      }),
      "pkg/dist/addon.js": "ctx.api.portfolio.getHoldings(); ctx.api.market.sync();",
    });

    const extracted = (await service.extractAddonZip({ zipData })) as TestExtractedAddon;

    expect(extracted.metadata).toEqual(
      normalizedManifest({
        id: "zip-addon",
        name: "Zip Addon",
        version: "1.0.0",
        main: "addon.js",
        permissions: [
          {
            category: "portfolio",
            purpose: "Read holdings",
            functions: [
              {
                name: "getHoldings",
                isDeclared: true,
                isDetected: true,
                detectedAt: expect.any(String) as string,
              },
            ],
          },
          {
            category: "market-data",
            purpose: "Access to quotes and market data",
            functions: [
              {
                name: "sync",
                isDeclared: false,
                isDetected: true,
                detectedAt: expect.any(String) as string,
              },
            ],
          },
        ],
      }),
    );
    expect(extracted.files).toEqual([
      expect.objectContaining({ name: "pkg/manifest.json", isMain: false }),
      expect.objectContaining({ name: "pkg/dist/addon.js", isMain: true }),
    ]);
  });

  test("installs addon ZIPs and staged addon ZIP files locally", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-addons-"));
    const service = createLocalAddonService({ appDataDir });
    const zipData = addonZip({
      "manifest.json": JSON.stringify({
        id: "installed-addon",
        name: "Installed Addon",
        version: "1.0.0",
        main: "main.js",
      }),
      "main.js": "export default {};",
    });

    const installed = (await service.installAddonZip({
      zipData,
      enableAfterInstall: false,
    })) as TestAddonManifest & { installedAt: string; source: string };
    expect(installed).toMatchObject({
      id: "installed-addon",
      enabled: false,
      source: "local",
      installedAt: expect.any(String),
    });
    expect(
      readFileSync(path.join(appDataDir, "addons", "installed-addon", "main.js"), "utf8"),
    ).toBe("export default {};");
    await expect(service.loadAddonForRuntime("installed-addon")).rejects.toThrow(
      "Addon is disabled",
    );
    await service.toggleAddon("installed-addon", true);
    await expect(service.loadAddonForRuntime("installed-addon")).resolves.toMatchObject({
      metadata: expect.objectContaining({ id: "installed-addon" }),
      files: [expect.objectContaining({ name: "main.js", isMain: true })],
    });

    const stagedZip = addonZip({
      "manifest.json": JSON.stringify({
        id: "staged-addon",
        name: "Staged Addon",
        version: "1.0.0",
        main: "main.js",
      }),
      "main.js": "export const staged = true;",
    });
    const stagingDir = path.join(appDataDir, "addons", "staging");
    mkdirSync(stagingDir, { recursive: true });
    const stagedZipPath = path.join(stagingDir, "staged-addon.zip");
    writeFileSync(stagedZipPath, stagedZip);

    await expect(
      service.installAddonFromStaging({ addonId: "staged-addon", enableAfterInstall: true }),
    ).resolves.toMatchObject({
      id: "staged-addon",
      enabled: true,
      source: "local",
    });
    expect(existsSync(stagedZipPath)).toBe(false);
    await expect(service.loadAddonForRuntime("staged-addon")).resolves.toMatchObject({
      files: [expect.objectContaining({ name: "main.js", isMain: true })],
    });
  });

  test("rejects unsafe and invalid addon ZIP archives", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-addons-"));
    const service = createLocalAddonService({ appDataDir });

    await expect(
      service.extractAddonZip({
        zipData: addonZip({
          "../evil.js": "export default {};",
          "manifest.json": JSON.stringify({
            id: "unsafe",
            name: "Unsafe",
            version: "1.0.0",
            main: "evil.js",
          }),
        }),
      }),
    ).rejects.toThrow("parent traversal");
    await expect(
      service.extractAddonZip({
        zipData: addonZip({
          "manifest.json": JSON.stringify({
            id: "missing-main",
            name: "Missing Main",
            version: "1.0.0",
            main: "missing.js",
          }),
          "main.js": "export default {};",
        }),
      }),
    ).rejects.toThrow("Main addon file 'missing.js' not found");
    await expect(
      service.extractAddonZip({
        zipData: addonZip({
          "manifest.json": JSON.stringify({
            id: "binary",
            name: "Binary",
            version: "1.0.0",
            main: "main.js",
          }),
          "main.js": new Uint8Array([0xff]),
        }),
      }),
    ).rejects.toThrow("Failed to read file main.js");
  });

  test("rejects empty required manifest fields before runtime loading", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-addons-"));
    writeAddon(appDataDir, "empty-main", {
      manifest: {
        id: "empty-main",
        name: "Empty Main",
        version: "1.0.0",
        main: "  ",
      },
      files: {
        "main.js": "export default {};",
      },
    });
    const service = createLocalAddonService({ appDataDir });

    await expect(service.loadAddonForRuntime("empty-main")).rejects.toThrow(
      "Missing 'main' field in manifest.json",
    );
  });

  test("rejects empty required permission fields", async () => {
    const cases = [
      {
        addonId: "empty-category",
        permission: { category: "", purpose: "Read data", functions: ["getHoldings"] },
        message: "Missing 'category' field in permission",
      },
      {
        addonId: "empty-purpose",
        permission: { category: "portfolio", purpose: "  ", functions: ["getHoldings"] },
        message: "Missing 'purpose' field in permission",
      },
      {
        addonId: "empty-function",
        permission: {
          category: "portfolio",
          purpose: "Read data",
          functions: [{ name: "\t", isDeclared: true }],
        },
        message: "Missing 'name' field in function permission",
      },
    ];

    for (const testCase of cases) {
      const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-addons-"));
      writeAddon(appDataDir, testCase.addonId, {
        manifest: {
          id: testCase.addonId,
          name: "Invalid Permission",
          version: "1.0.0",
          main: "main.js",
          permissions: [testCase.permission],
        },
        files: {
          "main.js": "export default {};",
        },
      });
      const service = createLocalAddonService({ appDataDir });

      await expect(service.listInstalledAddons()).rejects.toThrow(testCase.message);
    }
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
    ).rejects.toThrow("Failed to read ZIP");
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
    manifest: Record<string, unknown>;
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

function addonZip(files: Record<string, string | Uint8Array>): Uint8Array {
  return zipSync(
    Object.fromEntries(
      Object.entries(files).map(([name, content]) => [
        name,
        typeof content === "string" ? strToU8(content) : content,
      ]),
    ),
  );
}

function normalizedManifest(
  manifest: Pick<TestAddonManifest, "id" | "name" | "version" | "main"> &
    Partial<TestAddonManifest>,
): TestAddonManifest {
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description ?? null,
    author: manifest.author ?? null,
    sdkVersion: manifest.sdkVersion ?? null,
    main: manifest.main,
    enabled: manifest.enabled ?? null,
    permissions: manifest.permissions ?? null,
    homepage: manifest.homepage ?? null,
    repository: manifest.repository ?? null,
    license: manifest.license ?? null,
    minWealthfolioVersion: manifest.minWealthfolioVersion ?? null,
    keywords: manifest.keywords ?? null,
    icon: manifest.icon ?? null,
  };
}
