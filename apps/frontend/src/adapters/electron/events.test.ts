import { ELECTRON_API_KEY, type WealthfolioElectronApi } from "@wealthfolio/electron/shared/ipc";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  listenDeepLink,
  listenFileDrop,
  listenFileDropCancelled,
  listenFileDropHover,
  listenDatabaseRestored,
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
    listenDeepLink: vi.fn(),
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

  it("delegates database restore listeners through preload", async () => {
    const listen = vi.fn().mockResolvedValue(vi.fn());
    installElectronApi({ listen });

    const restoredHandler = vi.fn();
    await listenDatabaseRestored(restoredHandler);

    expect(listen).toHaveBeenCalledWith("database:restored", expect.any(Function));
    const [, bridgeHandler] = listen.mock.calls[0];
    bridgeHandler({ event: "database:restored", id: 5, payload: null });
    expect(restoredHandler).toHaveBeenCalledWith({
      event: "database:restored",
      id: 5,
      payload: null,
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

  it("delegates Electron file-drop listeners using Tauri-compatible event names", async () => {
    const listen = vi.fn().mockResolvedValue(vi.fn());
    installElectronApi({ listen });

    const hoverHandler = vi.fn();
    const dropHandler = vi.fn();
    const cancelledHandler = vi.fn();
    await listenFileDropHover(hoverHandler);
    await listenFileDrop(dropHandler);
    await listenFileDropCancelled(cancelledHandler);

    expect(listen).toHaveBeenCalledWith("tauri://file-drop-hover", expect.any(Function));
    expect(listen).toHaveBeenCalledWith("tauri://file-drop", expect.any(Function));
    expect(listen).toHaveBeenCalledWith("tauri://file-drop-cancelled", expect.any(Function));

    const [, dropBridgeHandler] = listen.mock.calls[1];
    dropBridgeHandler({
      event: "tauri://file-drop",
      id: 4,
      payload: { paths: ["/tmp/import.csv"], position: { x: 1, y: 2 } },
    });
    expect(dropHandler).toHaveBeenCalledWith({
      event: "tauri://file-drop",
      id: 4,
      payload: { paths: ["/tmp/import.csv"], position: { x: 1, y: 2 } },
    });
  });

  it("delegates deep-link listeners through the preload drain/listen bridge", async () => {
    const unlisten = vi.fn();
    const listenDeepLinkBridge = vi.fn().mockResolvedValue(unlisten);
    installElectronApi({ listenDeepLink: listenDeepLinkBridge });

    const deepLinkHandler = vi.fn();
    await expect(listenDeepLink(deepLinkHandler)).resolves.toBe(unlisten);

    expect(listenDeepLinkBridge).toHaveBeenCalledWith(expect.any(Function));
    const [bridgeHandler] = listenDeepLinkBridge.mock.calls[0];
    bridgeHandler({
      event: "deep-link-received",
      id: 3,
      payload: "wealthfolio://auth/callback?code=abc",
    });
    expect(deepLinkHandler).toHaveBeenCalledWith({
      event: "deep-link-received",
      id: 3,
      payload: "wealthfolio://auth/callback?code=abc",
    });
  });

  it("rejects server event listeners when preload is unavailable", async () => {
    await expect(listenPortfolioUpdateStart(vi.fn())).rejects.toThrow(
      "Electron preload API is unavailable.",
    );
  });
});
