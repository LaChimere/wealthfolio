import type { EventCallback, UnlistenFn } from "../types";
import { ELECTRON_API_KEY, type WealthfolioElectronApi } from "@wealthfolio/electron/shared/ipc";

const noopUnlisten: UnlistenFn = () => Promise.resolve();

function getElectronApi(): WealthfolioElectronApi {
  if (typeof window === "undefined" || !window[ELECTRON_API_KEY]) {
    throw new Error("Electron preload API is unavailable.");
  }

  return window[ELECTRON_API_KEY];
}

const listenElectronEvent = async <T>(
  eventName: string,
  handler: EventCallback<T>,
): Promise<UnlistenFn> => {
  return await getElectronApi().listen<T>(eventName, (event) => {
    handler({
      event: event.event,
      id: event.id,
      payload: event.payload,
    });
  });
};

const listenPendingElectronBridge = <T>(_handler: EventCallback<T>): Promise<UnlistenFn> => {
  return Promise.resolve(noopUnlisten);
};

export const listenFileDropHover = listenPendingElectronBridge;
export const listenFileDrop = listenPendingElectronBridge;
export const listenFileDropCancelled = listenPendingElectronBridge;
export const listenPortfolioUpdateStart = <T>(handler: EventCallback<T>): Promise<UnlistenFn> => {
  return listenElectronEvent("portfolio:update-start", handler);
};
export const listenPortfolioUpdateComplete = <T>(
  handler: EventCallback<T>,
): Promise<UnlistenFn> => {
  return listenElectronEvent("portfolio:update-complete", handler);
};
export const listenDatabaseRestored = listenPendingElectronBridge;
export const listenPortfolioUpdateError = <T>(handler: EventCallback<T>): Promise<UnlistenFn> => {
  return listenElectronEvent("portfolio:update-error", handler);
};
export const listenMarketSyncComplete = <T>(handler: EventCallback<T>): Promise<UnlistenFn> => {
  return listenElectronEvent("market:sync-complete", handler);
};
export const listenMarketSyncStart = <T>(handler: EventCallback<T>): Promise<UnlistenFn> => {
  return listenElectronEvent("market:sync-start", handler);
};
export const listenMarketSyncError = <T>(handler: EventCallback<T>): Promise<UnlistenFn> => {
  return listenElectronEvent("market:sync-error", handler);
};
export const listenBrokerSyncStart = <T>(handler: EventCallback<T>): Promise<UnlistenFn> => {
  return listenElectronEvent("broker:sync-start", handler);
};
export const listenBrokerSyncComplete = <T>(handler: EventCallback<T>): Promise<UnlistenFn> => {
  return listenElectronEvent("broker:sync-complete", handler);
};
export const listenBrokerSyncError = <T>(handler: EventCallback<T>): Promise<UnlistenFn> => {
  return listenElectronEvent("broker:sync-error", handler);
};
export const listenNavigateToRoute = <T>(handler: EventCallback<T>): Promise<UnlistenFn> => {
  return listenElectronEvent("navigate-to-route", handler);
};
export const listenDeepLink = async <T>(handler: EventCallback<T>): Promise<UnlistenFn> => {
  return await getElectronApi().listenDeepLink((event) => {
    handler({
      event: event.event,
      id: event.id,
      payload: event.payload as T,
    });
  });
};
export const listenUpdateAvailable = <T>(handler: EventCallback<T>): Promise<UnlistenFn> => {
  return listenElectronEvent("app:update-available", handler);
};
export const listenUpdateDownloadProgress = <T>(handler: EventCallback<T>): Promise<UnlistenFn> => {
  return listenElectronEvent("app:update-download-progress", handler);
};
