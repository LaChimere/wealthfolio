import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getEnabledAddons,
  getInstalledAddons,
  installAddon,
  installAddonFile,
  submitAddonRating,
} from "./addons";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("web addons adapter", () => {
  it("delegates addon aliases through the web backend commands", async () => {
    const installed = { id: "addon-1", name: "Addon" };
    const enabled = [{ manifest: { id: "addon-1" }, files: [] }];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ id: "addon-1", name: "Addon" }))
      .mockResolvedValueOnce(Response.json([installed]))
      .mockResolvedValueOnce(Response.json(enabled));
    vi.stubGlobal("fetch", fetchMock);

    await expect(installAddon(new Uint8Array([80, 75, 3, 4]), true)).resolves.toEqual(installed);
    await expect(getInstalledAddons()).resolves.toEqual([installed]);
    await expect(getEnabledAddons()).resolves.toEqual(enabled);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/v1/addons/install-zip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ zipDataB64: "UEsDBA==", enableAfterInstall: true }),
      credentials: "same-origin",
      signal: expect.any(AbortSignal),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/v1/addons/installed", {
      method: "GET",
      headers: {},
      body: undefined,
      credentials: "same-origin",
      signal: expect.any(AbortSignal),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/v1/addons/enabled-on-startup", {
      method: "GET",
      headers: {},
      body: undefined,
      credentials: "same-origin",
      signal: expect.any(AbortSignal),
    });
  });

  it("validates rating bounds before posting addon ratings", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(submitAddonRating("addon-1", 0)).rejects.toThrow("Rating must be between 1 and 5");
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(submitAddonRating("addon-1", 4, "Nice")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/addons/store/ratings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addonId: "addon-1", rating: 4, review: "Nice" }),
      credentials: "same-origin",
      signal: expect.any(AbortSignal),
    });
  });

  it("rejects unsupported single-file addon installs without echoing file contents", async () => {
    await expect(installAddonFile("addon.js", "secret source", true)).rejects.toThrow(
      "installAddonFile is not supported in web; use installAddonZip instead: addon.js, true",
    );
    await expect(installAddonFile("addon.js", "secret source", true)).rejects.not.toThrow(
      "secret source",
    );
  });
});
