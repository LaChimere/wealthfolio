import { afterEach, describe, expect, it, vi } from "vitest";

import { addonDevManager } from "./addons-dev-mode";

const originalFetch = globalThis.fetch;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
const originalReactDOM = (globalThis as unknown as { ReactDOM?: unknown }).ReactDOM;

afterEach(() => {
  const globals = globalThis as unknown as {
    __ASYNC_DEV_ADDON_ENABLED__?: boolean;
    __ASYNC_DEV_ADDON_DISABLED__?: boolean;
    __DEV_ADDONS__?: Map<string, { disable?: () => void }>;
  };
  vi.restoreAllMocks();
  globalThis.fetch = originalFetch;
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
  (globalThis as unknown as { ReactDOM?: unknown }).ReactDOM = originalReactDOM;
  delete globals.__ASYNC_DEV_ADDON_ENABLED__;
  delete globals.__ASYNC_DEV_ADDON_DISABLED__;
  globals.__DEV_ADDONS__?.clear();
  addonDevManager.disableDevMode();
});

describe("addon development mode", () => {
  it("revokes addon blob URLs when dev addon imports fail", async () => {
    const blobUrl = "data:text/javascript,throw%20new%20Error(%22boom%22)";
    URL.createObjectURL = (() => blobUrl) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue(blobUrl);
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    (globalThis as unknown as { ReactDOM?: { createPortal: () => null } }).ReactDOM = {
      createPortal: () => null,
    };
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/health")) {
        return new Response(null, { status: 200 });
      }
      if (url.endsWith("/addon.js")) {
        return new Response('throw new Error("boom")', { status: 200 });
      }
      if (url.endsWith("/manifest.json")) {
        return Response.json({ id: "dev-addon", name: "Dev Addon" });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    addonDevManager.registerDevServer({ id: "dev-addon", name: "Dev Addon", port: 3001 });

    await expect(addonDevManager.loadAddonFromDevServer("dev-addon")).resolves.toBe(false);

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith(blobUrl);
  });

  it("awaits async dev addon enable functions before storing disable hooks", async () => {
    const blobUrl = [
      "data:text/javascript,",
      encodeURIComponent(`
        export default async function enable() {
          globalThis.__ASYNC_DEV_ADDON_ENABLED__ = true;
          return {
            disable() {
              globalThis.__ASYNC_DEV_ADDON_DISABLED__ = true;
            },
          };
        }
      `),
    ].join("");
    URL.createObjectURL = (() => blobUrl) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
    vi.spyOn(URL, "createObjectURL").mockReturnValue(blobUrl);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    (globalThis as unknown as { ReactDOM?: { createPortal: () => null } }).ReactDOM = {
      createPortal: () => null,
    };
    const globals = globalThis as unknown as {
      __ASYNC_DEV_ADDON_ENABLED__?: boolean;
      __ASYNC_DEV_ADDON_DISABLED__?: boolean;
      __DEV_ADDONS__?: Map<string, { disable?: () => void }>;
    };
    delete globals.__ASYNC_DEV_ADDON_ENABLED__;
    delete globals.__ASYNC_DEV_ADDON_DISABLED__;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/health")) {
        return new Response(null, { status: 200 });
      }
      if (url.endsWith("/addon.js")) {
        return new Response("export default async function enable() {}", { status: 200 });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    addonDevManager.registerDevServer({ id: "async-addon", name: "Async Addon", port: 3001 });

    await expect(addonDevManager.loadAddonFromDevServer("async-addon")).resolves.toBe(true);

    expect(globals.__ASYNC_DEV_ADDON_ENABLED__).toBe(true);
    const disable = globals.__DEV_ADDONS__?.get("async-addon")?.disable;
    expect(disable).toEqual(expect.any(Function));

    disable?.();

    expect(globals.__ASYNC_DEV_ADDON_DISABLED__).toBe(true);
  });

  it("loads dev addons with installed-addon enable export styles", async () => {
    const addonSources = [
      {
        id: "default-object-addon",
        globalName: "__DEFAULT_OBJECT_ADDON_ENABLED__",
        source: `
          export default {
            enable() {
              globalThis.__DEFAULT_OBJECT_ADDON_ENABLED__ = true;
              return {};
            },
          };
        `,
      },
      {
        id: "named-enable-addon",
        globalName: "__NAMED_ENABLE_ADDON_ENABLED__",
        source: `
          export function enable() {
            globalThis.__NAMED_ENABLE_ADDON_ENABLED__ = true;
            return {};
          }
        `,
      },
      {
        id: "legacy-addon",
        globalName: "__LEGACY_ADDON_ENABLED__",
        source: `
          export function PortfolioTrackerAddon() {
            globalThis.__LEGACY_ADDON_ENABLED__ = true;
            return {};
          }
        `,
      },
    ] as const;
    const blobUrls = addonSources.map(
      ({ source }) => `data:text/javascript,${encodeURIComponent(source)}`,
    );
    URL.createObjectURL = (() => blobUrls[0] ?? "") as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      const blobUrl = blobUrls.shift();
      if (!blobUrl) {
        throw new Error("Unexpected addon blob creation");
      }
      return blobUrl;
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    (globalThis as unknown as { ReactDOM?: { createPortal: () => null } }).ReactDOM = {
      createPortal: () => null,
    };
    const globals = globalThis as unknown as Record<string, boolean | undefined>;
    for (const addon of addonSources) {
      delete globals[addon.globalName];
    }
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/health")) {
        return new Response(null, { status: 200 });
      }
      if (url.endsWith("/addon.js")) {
        return new Response("export default function enable() {}", { status: 200 });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    for (const addon of addonSources) {
      addonDevManager.registerDevServer({
        id: addon.id,
        name: addon.id,
        port: 3001,
      });
      await expect(addonDevManager.loadAddonFromDevServer(addon.id)).resolves.toBe(true);
      expect(globals[addon.globalName]).toBe(true);
    }
  });

  it("rejects dev addons without a valid enable export", async () => {
    const blobUrl = "data:text/javascript,export%20const%20metadata%20%3D%20%7B%7D";
    URL.createObjectURL = (() => blobUrl) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;
    vi.spyOn(URL, "createObjectURL").mockReturnValue(blobUrl);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    (globalThis as unknown as { ReactDOM?: { createPortal: () => null } }).ReactDOM = {
      createPortal: () => null,
    };
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/health")) {
        return new Response(null, { status: 200 });
      }
      if (url.endsWith("/addon.js")) {
        return new Response("export const metadata = {}", { status: 200 });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    addonDevManager.registerDevServer({ id: "invalid-addon", name: "Invalid Addon", port: 3001 });

    await expect(addonDevManager.loadAddonFromDevServer("invalid-addon")).resolves.toBe(false);

    expect(addonDevManager.getStatus().servers).toContainEqual(
      expect.objectContaining({ id: "invalid-addon", status: "error" }),
    );
  });
});
