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
      { name: "nested/main.js", content: "export const nested = true;", isMain: false },
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
        main: "dist/addon.js",
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
        main: "dist/addon.js",
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
      expect.objectContaining({ name: "manifest.json", isMain: false }),
      expect.objectContaining({ name: "dist/addon.js", isMain: true }),
    ]);
  });

  test("marks only the exact manifest main entry as the addon main file", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-addons-"));
    const service = createLocalAddonService({ appDataDir });
    const zipData = addonZip({
      "manifest.json": JSON.stringify({
        id: "exact-main",
        name: "Exact Main",
        version: "1.0.0",
        main: "main.js",
      }),
      "main.js": "export const root = true;",
      "nested/main.js": "export const nested = true;",
    });

    const extracted = (await service.extractAddonZip({ zipData })) as TestExtractedAddon;

    expect(extracted.files).toEqual([
      expect.objectContaining({ name: "manifest.json", isMain: false }),
      expect.objectContaining({ name: "main.js", isMain: true }),
      expect.objectContaining({ name: "nested/main.js", isMain: false }),
    ]);
  });

  test("loads legacy package-prefixed installs only when the package root is unambiguous", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-addons-"));
    writeAddon(appDataDir, "legacy-prefixed", {
      manifest: {
        id: "legacy-prefixed",
        name: "Legacy Prefixed",
        version: "1.0.0",
        main: "dist/addon.js",
        enabled: true,
      },
      files: {
        "pkg/dist/addon.js": "export default {};",
        "pkg/dist/other.js": "export const other = true;",
      },
    });
    writeAddon(appDataDir, "ambiguous-prefixed", {
      manifest: {
        id: "ambiguous-prefixed",
        name: "Ambiguous Prefixed",
        version: "1.0.0",
        main: "dist/addon.js",
        enabled: true,
      },
      files: {
        "pkg/dist/addon.js": "export default {};",
        "other/dist/addon.js": "export default {};",
      },
    });
    const service = createLocalAddonService({ appDataDir });

    const loaded = (await service.loadAddonForRuntime("legacy-prefixed")) as TestExtractedAddon;
    expect(loaded.files).toEqual([
      expect.objectContaining({ name: "pkg/dist/addon.js", isMain: true }),
      expect.objectContaining({ name: "pkg/dist/other.js", isMain: false }),
    ]);
    await expect(service.loadAddonForRuntime("ambiguous-prefixed")).rejects.toThrow(
      "Main addon file not found",
    );
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

  test("fetches store listings and submits ratings with Rust-compatible headers", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-addons-"));
    const calls: Array<{ body?: string; headers: Headers; url: string }> = [];
    const service = createLocalAddonService({
      appDataDir,
      appVersion: "3.4.0",
      instanceId: () => "",
      storeBaseUrl: "https://store.test/api/addons/",
      fetchStore: async (input, init) => {
        const url = String(input);
        calls.push({
          url,
          headers: new Headers(init?.headers),
          body: typeof init?.body === "string" ? init.body : undefined,
        });
        if (url === "https://store.test/api/addons") {
          return Response.json({ addons: [{ id: "store-addon" }] });
        }
        if (url === "https://store.test/api/addons/addon%2Fid/ratings" && init?.method !== "POST") {
          return Response.json({ ratings: [{ rating: 5, review: "Great" }] });
        }
        return Response.json({ ok: true });
      },
    });

    await expect(service.fetchStoreListings()).resolves.toEqual([{ id: "store-addon" }]);
    await expect(service.getRatings("addon/id")).resolves.toEqual([{ rating: 5, review: "Great" }]);
    await expect(
      service.submitRating({ addonId: "addon/id", rating: 5, review: "Great" }),
    ).resolves.toEqual({ ok: true });

    expect(calls).toEqual([
      expect.objectContaining({
        url: "https://store.test/api/addons",
        headers: expect.any(Headers),
      }),
      expect.objectContaining({
        url: "https://store.test/api/addons/addon%2Fid/ratings",
        headers: expect.any(Headers),
      }),
      expect.objectContaining({
        url: "https://store.test/api/addons/addon%2Fid/ratings",
        headers: expect.any(Headers),
        body: JSON.stringify({ rating: 5, review: "Great" }),
      }),
    ]);
    expect(calls[0]?.headers.get("user-agent")).toBe("Wealthfolio/3.4.0");
    expect(calls[0]?.headers.get("x-app-version")).toBe("3.4.0");
    expect(calls[0]?.headers.get("x-instance-id")).toBe("");
    expect(calls[1]?.headers.get("x-instance-id")).toBe("");

    await expect(service.submitRating({ addonId: "addon/id", rating: 0 })).rejects.toThrow(
      "Rating must be an integer between 1 and 5",
    );
    await expect(service.submitRating({ addonId: "addon/id", rating: 4.5 })).rejects.toThrow(
      "Rating must be an integer between 1 and 5",
    );
    expect(calls).toHaveLength(3);

    await expect(
      createLocalAddonService({
        appDataDir,
        storeBaseUrl: "https://store.test/api/addons",
        fetchStore: async () => Response.json({ ratings: {} }),
      }).getRatings("addon/id"),
    ).rejects.toThrow("'ratings' field is not an array in API response");

    await expect(
      createLocalAddonService({
        appDataDir,
        storeBaseUrl: "https://store.test/api/addons",
        fetchStore: async () => Response.json([{ id: "direct-addon" }]),
      }).fetchStoreListings(),
    ).resolves.toEqual([{ id: "direct-addon" }]);
  });

  test("checks addon updates and preserves per-addon failures", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-addons-"));
    writeAddon(appDataDir, "update-ok", {
      manifest: {
        id: "update-ok",
        name: "Update OK",
        version: "1.0.0",
        main: "main.js",
      },
      files: { "main.js": "export default {};" },
    });
    writeAddon(appDataDir, "update-fail", {
      manifest: {
        id: "update-fail",
        name: "Update Fail",
        version: "2.0.0",
        main: "main.js",
      },
      files: { "main.js": "export default {};" },
    });
    const service = createLocalAddonService({
      appDataDir,
      storeBaseUrl: "https://store.test/api/addons",
      fetchStore: async (input) => {
        const url = String(input);
        if (url.includes("addonId=update-ok&currentVersion=1.0.0")) {
          return Response.json({
            addonId: "update-ok",
            updateInfo: {
              currentVersion: "1.0.0",
              latestVersion: "1.1.0",
              updateAvailable: true,
            },
            error: null,
          });
        }
        return new Response("offline", { status: 500, statusText: "Internal Server Error" });
      },
    });

    await expect(service.checkAddonUpdate("update-ok")).resolves.toMatchObject({
      addonId: "update-ok",
      updateInfo: { latestVersion: "1.1.0", updateAvailable: true },
    });
    const allResults = (await service.checkAllAddonUpdates()) as Array<{
      addonId: string;
      error: string | null;
      updateInfo: Record<string, unknown>;
    }>;
    expect(allResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ addonId: "update-ok", error: null }),
        {
          addonId: "update-fail",
          updateInfo: {
            currentVersion: "2.0.0",
            latestVersion: "unknown",
            updateAvailable: false,
            downloadUrl: null,
            releaseNotes: null,
            releaseDate: null,
            changelogUrl: null,
            isCritical: null,
            hasBreakingChanges: null,
            minWealthfolioVersion: null,
          },
          error: "Update check API returned error 500 Internal Server Error: offline",
        },
      ]),
    );
  });

  test("downloads store addons to staging and updates while preserving enabled state", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-addons-"));
    writeAddon(appDataDir, "store-addon", {
      manifest: {
        id: "store-addon",
        name: "Store Addon",
        version: "1.0.0",
        main: "main.js",
        enabled: true,
      },
      files: { "main.js": "export default {};" },
    });
    const zipData = addonZip({
      "manifest.json": JSON.stringify({
        id: "store-addon",
        name: "Store Addon",
        version: "2.0.0",
        main: "main.js",
      }),
      "main.js": "export const updated = true;",
    });
    const calls: string[] = [];
    const service = createLocalAddonService({
      appDataDir,
      appVersion: "3.4.0",
      instanceId: "instance-1",
      storeBaseUrl: "https://store.test/api/addons",
      fetchStore: async (input, init) => {
        const url = String(input);
        calls.push(url);
        if (url === "https://store.test/api/addons/store-addon/download" && calls.length === 1) {
          expect(new Headers(init?.headers).get("x-instance-id")).toBe("instance-1");
          return Response.json({ downloadUrl: "https://cdn.test/store-addon.zip" });
        }
        if (url === "https://cdn.test/store-addon.zip") {
          expect(new Headers(init?.headers).get("x-instance-id")).toBeNull();
          return new Response(zipData);
        }
        return new Response(zipData, { headers: { "content-type": "application/zip" } });
      },
    });

    await expect(service.downloadAddonToStaging("store-addon")).resolves.toMatchObject({
      metadata: expect.objectContaining({ id: "store-addon", version: "2.0.0" }),
    });
    expect(existsSync(path.join(appDataDir, "addons", "staging", "store-addon.zip"))).toBe(true);

    await expect(service.updateAddonFromStore("store-addon")).resolves.toMatchObject({
      id: "store-addon",
      version: "2.0.0",
      enabled: true,
      source: "local",
    });
    expect(readFileSync(path.join(appDataDir, "addons", "store-addon", "main.js"), "utf8")).toBe(
      "export const updated = true;",
    );
  });

  test("rejects staged installs whose manifest id does not match the staged id", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-addons-"));
    const stagingDir = path.join(appDataDir, "addons", "staging");
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(
      path.join(stagingDir, "requested-addon.zip"),
      addonZip({
        "manifest.json": JSON.stringify({
          id: "other-addon",
          name: "Other Addon",
          version: "1.0.0",
          main: "main.js",
        }),
        "main.js": "export default {};",
      }),
    );
    const service = createLocalAddonService({ appDataDir });

    await expect(
      service.installAddonFromStaging({ addonId: "requested-addon", enableAfterInstall: true }),
    ).rejects.toThrow(
      "Downloaded addon id 'other-addon' does not match requested addon 'requested-addon'",
    );
    expect(existsSync(path.join(appDataDir, "addons", "other-addon"))).toBe(false);
  });

  test("rejects store updates whose manifest id does not match the requested add-on", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-addons-"));
    writeAddon(appDataDir, "requested-addon", {
      manifest: {
        id: "requested-addon",
        name: "Requested Addon",
        version: "1.0.0",
        main: "main.js",
        enabled: true,
      },
      files: {
        "main.js": "export const current = true;",
      },
    });
    const service = createLocalAddonService({
      appDataDir,
      storeBaseUrl: "https://store.test/api/addons",
      fetchStore: async () =>
        new Response(
          addonZip({
            "manifest.json": JSON.stringify({
              id: "other-addon",
              name: "Other Addon",
              version: "2.0.0",
              main: "main.js",
            }),
            "main.js": "export const other = true;",
          }),
        ),
    });

    await expect(service.updateAddonFromStore("requested-addon")).rejects.toThrow(
      "Downloaded addon id 'other-addon' does not match requested addon 'requested-addon'",
    );
    expect(
      readFileSync(path.join(appDataDir, "addons", "requested-addon", "main.js"), "utf8"),
    ).toBe("export const current = true;");
    expect(existsSync(path.join(appDataDir, "addons", "other-addon"))).toBe(false);
  });

  test("maps store download and staging validation failures", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-addons-"));
    const expectedErrors = new Map([
      [404, "Addon not found or coming soon"],
      [410, "Addon is inactive or deprecated"],
      [503, "Download service temporarily unavailable"],
    ]);

    for (const [status, message] of expectedErrors) {
      const service = createLocalAddonService({
        appDataDir,
        storeBaseUrl: "https://store.test/api/addons",
        fetchStore: async () => new Response("nope", { status }),
      });
      await expect(service.downloadAddonToStaging(`addon-${status}`)).rejects.toThrow(message);
    }

    await expect(
      createLocalAddonService({
        appDataDir,
        storeBaseUrl: "https://store.test/api/addons",
        fetchStore: async () => Response.json({}),
      }).downloadAddonToStaging("missing-url"),
    ).rejects.toThrow("Download API response missing downloadUrl field");
    await expect(
      createLocalAddonService({
        appDataDir,
        storeBaseUrl: "https://store.test/api/addons",
        fetchStore: async () => new Response(new Uint8Array([1, 2, 3])),
      }).downloadAddonToStaging("bad-zip"),
    ).rejects.toThrow("Invalid ZIP data: missing ZIP signature");
    await expect(
      createLocalAddonService({
        appDataDir,
        storeBaseUrl: "https://store.test/api/addons",
        fetchStore: async () =>
          new Response(
            addonZip({
              "main.js": "export default {};",
            }),
          ),
      }).downloadAddonToStaging("missing-manifest"),
    ).rejects.toThrow("ZIP addon must contain a manifest.json file with addon metadata");
    expect(existsSync(path.join(appDataDir, "addons", "staging", "missing-manifest.zip"))).toBe(
      false,
    );
    await expect(
      createLocalAddonService({
        appDataDir,
        storeBaseUrl: "https://store.test/api/addons",
        fetchStore: async () =>
          new Response(
            addonZip({
              "manifest.json": JSON.stringify({
                id: "other-addon",
                name: "Other Addon",
                version: "1.0.0",
                main: "main.js",
              }),
              "main.js": "export default {};",
            }),
          ),
      }).downloadAddonToStaging("requested-addon"),
    ).rejects.toThrow(
      "Downloaded addon id 'other-addon' does not match requested addon 'requested-addon'",
    );
    expect(existsSync(path.join(appDataDir, "addons", "staging", "requested-addon.zip"))).toBe(
      false,
    );
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

  test("guards unsafe paths and clears addon staging safely", async () => {
    const appDataDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-addons-"));
    const service = createLocalAddonService({ appDataDir });

    await expect(service.loadAddonForRuntime("../escape")).rejects.toThrow("Unsafe addon id");
    await expect(service.toggleAddon("../escape", true)).rejects.toThrow("Unsafe addon id");
    await expect(service.uninstallAddon("../escape")).rejects.toThrow("Unsafe addon id");
    await expect(
      service.installAddonZip({ zipData: new Uint8Array([1]), enableAfterInstall: true }),
    ).rejects.toThrow("Failed to read ZIP");

    await expect(service.clearAddonStaging()).resolves.toBeUndefined();
    expect(existsSync(path.join(appDataDir, "addons", "staging"))).toBe(true);
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
