import type { EventCallback, UnlistenFn } from "../types";
import {
  ELECTRON_API_KEY,
  ELECTRON_FILE_DROP_EVENTS,
  type WealthfolioElectronApi,
} from "@wealthfolio/electron/shared/ipc";

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

export const listenFileDropHover = <T>(handler: EventCallback<T>): Promise<UnlistenFn> => {
  return listenElectronEvent(ELECTRON_FILE_DROP_EVENTS.hover, handler);
};
export const listenFileDrop = <T>(handler: EventCallback<T>): Promise<UnlistenFn> => {
  return listenElectronEvent(ELECTRON_FILE_DROP_EVENTS.drop, handler);
};
export const listenFileDropCancelled = <T>(handler: EventCallback<T>): Promise<UnlistenFn> => {
  return listenElectronEvent(ELECTRON_FILE_DROP_EVENTS.cancelled, handler);
};
export const listenPortfolioUpdateStart = <T>(handler: EventCallback<T>): Promise<UnlistenFn> => {
  return listenElectronEvent("portfolio:update-start", handler);
};
export const listenPortfolioUpdateComplete = <T>(
  handler: EventCallback<T>,
): Promise<UnlistenFn> => {
  return listenElectronEvent("portfolio:update-complete", handler);
};
export const listenDatabaseRestored = <T>(handler: EventCallback<T>): Promise<UnlistenFn> => {
  return listenElectronEvent("database:restored", handler);
};
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
