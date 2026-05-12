export const ELECTRON_API_KEY = "wealthfolioElectron";

export const IPC_CHANNELS = {
  getRuntimeInfo: "wealthfolio:runtime-info",
} as const;

export interface RuntimeInfo {
  platform: NodeJS.Platform;
  appVersion: string;
  isPackaged: boolean;
}

export interface WealthfolioElectronApi {
  getRuntimeInfo(): Promise<RuntimeInfo>;
}
