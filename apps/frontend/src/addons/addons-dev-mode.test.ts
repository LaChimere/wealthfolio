import { afterEach, describe, expect, it, vi } from "vitest";

import { addonDevManager } from "./addons-dev-mode";

const originalFetch = globalThis.fetch;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
const originalReactDOM = (globalThis as unknown as { ReactDOM?: unknown }).ReactDOM;

afterEach(() => {
  globalThis.fetch = originalFetch;
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
  (globalThis as unknown as { ReactDOM?: unknown }).ReactDOM = originalReactDOM;
  vi.restoreAllMocks();
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
});
