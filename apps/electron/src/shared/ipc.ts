export const ELECTRON_API_KEY = "wealthfolioElectron";

export const IPC_CHANNELS = {
  getRuntimeInfo: "wealthfolio:runtime-info",
  invoke: "wealthfolio:invoke",
} as const;

export const ELECTRON_COMMANDS = {} as const satisfies Record<string, unknown>;

export type ElectronCommand = keyof typeof ELECTRON_COMMANDS;

export interface RuntimeInfo {
  platform: string;
  appVersion: string;
  isPackaged: boolean;
}

export interface ElectronInvokeRequest {
  command: string;
  payload?: Record<string, unknown>;
}

export interface WealthfolioElectronApi {
  getRuntimeInfo(): Promise<RuntimeInfo>;
  invoke<T>(command: string, payload?: Record<string, unknown>): Promise<T>;
}

export function isElectronCommand(command: string): command is ElectronCommand {
  return Object.hasOwn(ELECTRON_COMMANDS, command);
}
