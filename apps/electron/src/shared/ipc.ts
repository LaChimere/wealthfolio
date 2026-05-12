export const ELECTRON_API_KEY = "wealthfolioElectron";

export const IPC_CHANNELS = {
  getRuntimeInfo: "wealthfolio:runtime-info",
  invoke: "wealthfolio:invoke",
} as const;

export const ELECTRON_COMMANDS = {
  get_accounts: {
    method: "GET",
    path: "/api/v1/accounts",
  },
  create_account: {
    method: "POST",
    path: "/api/v1/accounts",
  },
  update_account: {
    method: "PUT",
    path: "/api/v1/accounts",
  },
  delete_account: {
    method: "DELETE",
    path: "/api/v1/accounts",
  },
  get_settings: {
    method: "GET",
    path: "/api/v1/settings",
  },
  update_settings: {
    method: "PUT",
    path: "/api/v1/settings",
  },
  is_auto_update_check_enabled: {
    method: "GET",
    path: "/api/v1/settings/auto-update-enabled",
  },
} as const satisfies Record<
  string,
  { method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; path: string }
>;

export type ElectronCommand = keyof typeof ELECTRON_COMMANDS;

export interface RuntimeInfo {
  platform: string;
  appVersion: string;
  isPackaged: boolean;
  sidecar: SidecarRuntimeStatus;
}

export interface SidecarRuntimeStatus {
  ready: boolean;
  error?: string;
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
