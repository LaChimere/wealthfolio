import { ELECTRON_API_KEY, type WealthfolioElectronApi } from "@wealthfolio/electron/shared/ipc";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  listenNavigateToRoute,
  listenMarketSyncComplete,
  listenPortfolioUpdateStart,
  listenUpdateAvailable,
  listenUpdateDownloadProgress,
} from "./events";

function installElectronApi(api: Partial<WealthfolioElectronApi>) {
  window[ELECTRON_API_KEY] = {
    getRuntimeInfo: vi.fn(),
    invoke: vi.fn(),
    listen: vi.fn(),
    ...api,
  } as WealthfolioElectronApi;
}

afterEach(() => {
  delete window[ELECTRON_API_KEY];
});

describe("electron event adapter", () => {
  it("delegates portfolio and market event listeners through preload", async () => {
    const listen = vi.fn().mockResolvedValue(vi.fn());
    installElectronApi({ listen });

    const portfolioHandler = vi.fn();
    const marketHandler = vi.fn();
    await listenPortfolioUpdateStart(portfolioHandler);
    await listenMarketSyncComplete(marketHandler);

    expect(listen).toHaveBeenCalledWith("portfolio:update-start", expect.any(Function));
    expect(listen).toHaveBeenCalledWith("market:sync-complete", expect.any(Function));

    const [, portfolioBridgeHandler] = listen.mock.calls[0];
    portfolioBridgeHandler({ event: "portfolio:update-start", id: 1, payload: { ok: true } });
    expect(portfolioHandler).toHaveBeenCalledWith({
      event: "portfolio:update-start",
      id: 1,
      payload: { ok: true },
    });
  });

  it("delegates update event listeners through preload", async () => {
    const listen = vi.fn().mockResolvedValue(vi.fn());
    installElectronApi({ listen });

    await listenUpdateAvailable(vi.fn());
    await listenUpdateDownloadProgress(vi.fn());

    expect(listen).toHaveBeenCalledWith("app:update-available", expect.any(Function));
    expect(listen).toHaveBeenCalledWith("app:update-download-progress", expect.any(Function));
  });

  it("delegates native route navigation listeners through preload", async () => {
    const listen = vi.fn().mockResolvedValue(vi.fn());
    installElectronApi({ listen });

    const routeHandler = vi.fn();
    await listenNavigateToRoute(routeHandler);

    expect(listen).toHaveBeenCalledWith("navigate-to-route", expect.any(Function));
    const [, bridgeHandler] = listen.mock.calls[0];
    bridgeHandler({ event: "navigate-to-route", id: 2, payload: { route: "/settings/general" } });
    expect(routeHandler).toHaveBeenCalledWith({
      event: "navigate-to-route",
      id: 2,
      payload: { route: "/settings/general" },
    });
  });

  it("rejects server event listeners when preload is unavailable", async () => {
    await expect(listenPortfolioUpdateStart(vi.fn())).rejects.toThrow(
      "Electron preload API is unavailable.",
    );
  });
});
