import { ELECTRON_API_KEY, type WealthfolioElectronApi } from "@wealthfolio/electron/shared/ipc";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  extractAddon,
  getEnabledAddons,
  getInstalledAddons,
  installAddon,
  installAddonFile,
  submitAddonRating,
} from "./addons";

function installElectronApi(api: Partial<WealthfolioElectronApi>) {
  window[ELECTRON_API_KEY] = {
    getRuntimeInfo: vi.fn(),
    invoke: vi.fn(),
    writeLog: vi.fn().mockResolvedValue(undefined),
    ...api,
  } as WealthfolioElectronApi;
}

afterEach(() => {
  delete window[ELECTRON_API_KEY];
  vi.restoreAllMocks();
});

describe("electron addons adapter", () => {
  it("delegates zip bytes and alias commands through the preload bridge", async () => {
    const extracted = { manifest: { id: "addon-1" }, files: [] };
    const installed = { id: "addon-1", name: "Addon" };
    const enabled = [{ manifest: { id: "addon-1" }, files: [] }];
    const bridgeInvoke = vi
      .fn()
      .mockResolvedValueOnce(extracted)
      .mockResolvedValueOnce(installed)
      .mockResolvedValueOnce([installed])
      .mockResolvedValueOnce(enabled);
    installElectronApi({ invoke: bridgeInvoke });

    await expect(extractAddon(new Uint8Array([1, 2, 255]))).resolves.toBe(extracted);
    await expect(installAddon(new Uint8Array([80, 75, 3, 4]), true)).resolves.toBe(installed);
    await expect(getInstalledAddons()).resolves.toEqual([installed]);
    await expect(getEnabledAddons()).resolves.toBe(enabled);
    expect(bridgeInvoke).toHaveBeenNthCalledWith(1, "extract_addon_zip", {
      zipData: [1, 2, 255],
    });
    expect(bridgeInvoke).toHaveBeenNthCalledWith(2, "install_addon_zip", {
      zipData: [80, 75, 3, 4],
      enableAfterInstall: true,
    });
    expect(bridgeInvoke).toHaveBeenNthCalledWith(3, "list_installed_addons", undefined);
    expect(bridgeInvoke).toHaveBeenNthCalledWith(4, "get_enabled_addons_on_startup", undefined);
  });

  it("validates rating bounds before submitting addon ratings", async () => {
    const bridgeInvoke = vi.fn().mockResolvedValue({ ok: true });
    installElectronApi({ invoke: bridgeInvoke });

    await expect(submitAddonRating("addon-1", 6)).rejects.toThrow("Rating must be between 1 and 5");
    expect(bridgeInvoke).not.toHaveBeenCalled();
    await expect(submitAddonRating("addon-1", 5, "Great")).resolves.toEqual({ ok: true });
    expect(bridgeInvoke).toHaveBeenCalledWith("submit_addon_rating", {
      addonId: "addon-1",
      rating: 5,
      review: "Great",
    });
  });

  it("rejects unsupported single-file addon installs without invoking Electron", async () => {
    const bridgeInvoke = vi.fn();
    installElectronApi({ invoke: bridgeInvoke });

    await expect(installAddonFile("addon.js", "secret source", true)).rejects.toThrow(
      "installAddonFile is not supported in Electron; use installAddonZip instead: addon.js, true",
    );
    await expect(installAddonFile("addon.js", "secret source", true)).rejects.not.toThrow(
      "secret source",
    );
    expect(bridgeInvoke).not.toHaveBeenCalled();
  });
});
