export const ELECTRON_API_KEY = "wealthfolioElectron";

export const IPC_CHANNELS = {
  getRuntimeInfo: "wealthfolio:runtime-info",
  invoke: "wealthfolio:invoke",
  serverEvent: "wealthfolio:server-event",
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
  update_portfolio: {
    method: "POST",
    path: "/api/v1/portfolio/update",
  },
  recalculate_portfolio: {
    method: "POST",
    path: "/api/v1/portfolio/recalculate",
  },
  get_holdings: {
    method: "GET",
    path: "/api/v1/holdings",
  },
  get_holding: {
    method: "GET",
    path: "/api/v1/holdings/item",
  },
  get_asset_holdings: {
    method: "GET",
    path: "/api/v1/holdings/by-asset",
  },
  get_historical_valuations: {
    method: "GET",
    path: "/api/v1/valuations/history",
  },
  get_latest_valuations: {
    method: "GET",
    path: "/api/v1/valuations/latest",
  },
  get_portfolio_allocations: {
    method: "GET",
    path: "/api/v1/allocations",
  },
  get_holdings_by_allocation: {
    method: "GET",
    path: "/api/v1/allocations/holdings",
  },
  calculate_accounts_simple_performance: {
    method: "POST",
    path: "/api/v1/performance/accounts/simple",
  },
  calculate_performance_history: {
    method: "POST",
    path: "/api/v1/performance/history",
  },
  calculate_performance_summary: {
    method: "POST",
    path: "/api/v1/performance/summary",
  },
  get_income_summary: {
    method: "GET",
    path: "/api/v1/income/summary",
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

export interface ElectronEventMessage<T = unknown> {
  event: string;
  id: number;
  payload: T;
}

export interface WealthfolioElectronApi {
  getRuntimeInfo(): Promise<RuntimeInfo>;
  invoke<T>(command: string, payload?: Record<string, unknown>): Promise<T>;
  listen<T>(
    eventName: string,
    handler: (event: ElectronEventMessage<T>) => void,
  ): Promise<() => Promise<void>>;
}

export function isElectronCommand(command: string): command is ElectronCommand {
  return Object.hasOwn(ELECTRON_COMMANDS, command);
}
