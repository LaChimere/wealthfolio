import { ELECTRON_API_KEY, type WealthfolioElectronApi } from "@wealthfolio/electron/shared/ipc";
import { afterEach, describe, expect, it, vi } from "vitest";

import { invoke, isDesktop, isWeb } from "./core";

function installElectronApi(api: Partial<WealthfolioElectronApi>) {
  window[ELECTRON_API_KEY] = {
    getRuntimeInfo: vi.fn(),
    invoke: vi.fn(),
    ...api,
  } as WealthfolioElectronApi;
}

afterEach(() => {
  delete window[ELECTRON_API_KEY];
});

describe("electron adapter core", () => {
  it("marks Electron as a desktop runtime without enabling web auth behavior", () => {
    expect(isDesktop).toBe(true);
    expect(isWeb).toBe(false);
  });

  it("delegates command invocation through the preload bridge", async () => {
    const bridgeInvoke = vi.fn().mockResolvedValue({ ok: true });
    installElectronApi({ invoke: bridgeInvoke });

    await expect(invoke("get_accounts", { includeArchived: false })).resolves.toEqual({
      ok: true,
    });
    expect(bridgeInvoke).toHaveBeenCalledWith("get_accounts", { includeArchived: false });
  });

  it("rejects when the preload bridge is unavailable", async () => {
    await expect(invoke("get_accounts")).rejects.toThrow("Electron preload API is unavailable.");
  });
});
