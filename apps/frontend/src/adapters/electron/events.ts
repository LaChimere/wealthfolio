import type { EventCallback, UnlistenFn } from "../types";

const noopUnlisten: UnlistenFn = () => Promise.resolve();

const listenPendingElectronBridge = <T>(_handler: EventCallback<T>): Promise<UnlistenFn> => {
  return Promise.resolve(noopUnlisten);
};

export const listenFileDropHover = listenPendingElectronBridge;
export const listenFileDrop = listenPendingElectronBridge;
export const listenFileDropCancelled = listenPendingElectronBridge;
export const listenPortfolioUpdateStart = listenPendingElectronBridge;
export const listenPortfolioUpdateComplete = listenPendingElectronBridge;
export const listenDatabaseRestored = listenPendingElectronBridge;
export const listenPortfolioUpdateError = listenPendingElectronBridge;
export const listenMarketSyncComplete = listenPendingElectronBridge;
export const listenMarketSyncStart = listenPendingElectronBridge;
export const listenMarketSyncError = listenPendingElectronBridge;
export const listenBrokerSyncStart = listenPendingElectronBridge;
export const listenBrokerSyncComplete = listenPendingElectronBridge;
export const listenBrokerSyncError = listenPendingElectronBridge;
export const listenNavigateToRoute = listenPendingElectronBridge;
export const listenDeepLink = listenPendingElectronBridge;
