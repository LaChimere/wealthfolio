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
  get_snapshots: {
    method: "GET",
    path: "/api/v1/snapshots",
  },
  get_snapshot_by_date: {
    method: "GET",
    path: "/api/v1/snapshots/holdings",
  },
  delete_snapshot: {
    method: "DELETE",
    path: "/api/v1/snapshots",
  },
  save_manual_holdings: {
    method: "POST",
    path: "/api/v1/snapshots",
  },
  import_holdings_csv: {
    method: "POST",
    path: "/api/v1/snapshots/import",
  },
  check_holdings_import: {
    method: "POST",
    path: "/api/v1/snapshots/import/check",
  },
  search_activities: {
    method: "POST",
    path: "/api/v1/activities/search",
  },
  create_activity: {
    method: "POST",
    path: "/api/v1/activities",
  },
  update_activity: {
    method: "PUT",
    path: "/api/v1/activities",
  },
  save_activities: {
    method: "POST",
    path: "/api/v1/activities/bulk",
  },
  delete_activity: {
    method: "DELETE",
    path: "/api/v1/activities",
  },
  link_transfer_activities: {
    method: "POST",
    path: "/api/v1/activities/link",
  },
  unlink_transfer_activities: {
    method: "POST",
    path: "/api/v1/activities/unlink",
  },
  check_activities_import: {
    method: "POST",
    path: "/api/v1/activities/import/check",
  },
  preview_import_assets: {
    method: "POST",
    path: "/api/v1/activities/import/assets/preview",
  },
  import_activities: {
    method: "POST",
    path: "/api/v1/activities/import",
  },
  get_account_import_mapping: {
    method: "GET",
    path: "/api/v1/activities/import/mapping",
  },
  save_account_import_mapping: {
    method: "POST",
    path: "/api/v1/activities/import/mapping",
  },
  link_account_template: {
    method: "POST",
    path: "/api/v1/activities/import/templates/link",
  },
  list_import_templates: {
    method: "GET",
    path: "/api/v1/activities/import/templates",
  },
  get_import_template: {
    method: "GET",
    path: "/api/v1/activities/import/templates/item",
  },
  save_import_template: {
    method: "POST",
    path: "/api/v1/activities/import/templates",
  },
  delete_import_template: {
    method: "DELETE",
    path: "/api/v1/activities/import/templates",
  },
  get_latest_exchange_rates: {
    method: "GET",
    path: "/api/v1/exchange-rates/latest",
  },
  update_exchange_rate: {
    method: "PUT",
    path: "/api/v1/exchange-rates",
  },
  add_exchange_rate: {
    method: "POST",
    path: "/api/v1/exchange-rates",
  },
  delete_exchange_rate: {
    method: "DELETE",
    path: "/api/v1/exchange-rates",
  },
  get_exchanges: {
    method: "GET",
    path: "/api/v1/exchanges",
  },
  get_market_data_providers: {
    method: "GET",
    path: "/api/v1/providers",
  },
  get_market_data_providers_settings: {
    method: "GET",
    path: "/api/v1/providers/settings",
  },
  update_market_data_provider_settings: {
    method: "PUT",
    path: "/api/v1/providers/settings",
  },
  get_custom_providers: {
    method: "GET",
    path: "/api/v1/custom-providers",
  },
  create_custom_provider: {
    method: "POST",
    path: "/api/v1/custom-providers",
  },
  update_custom_provider: {
    method: "PUT",
    path: "/api/v1/custom-providers",
  },
  delete_custom_provider: {
    method: "DELETE",
    path: "/api/v1/custom-providers",
  },
  test_custom_provider_source: {
    method: "POST",
    path: "/api/v1/custom-providers/test-source",
  },
  get_contribution_limits: {
    method: "GET",
    path: "/api/v1/limits",
  },
  create_contribution_limit: {
    method: "POST",
    path: "/api/v1/limits",
  },
  update_contribution_limit: {
    method: "PUT",
    path: "/api/v1/limits",
  },
  delete_contribution_limit: {
    method: "DELETE",
    path: "/api/v1/limits",
  },
  calculate_deposits_for_contribution_limit: {
    method: "GET",
    path: "/api/v1/limits",
  },
  get_goals: {
    method: "GET",
    path: "/api/v1/goals",
  },
  get_goal: {
    method: "GET",
    path: "/api/v1/goals",
  },
  create_goal: {
    method: "POST",
    path: "/api/v1/goals",
  },
  update_goal: {
    method: "PUT",
    path: "/api/v1/goals",
  },
  delete_goal: {
    method: "DELETE",
    path: "/api/v1/goals",
  },
  get_goal_funding: {
    method: "GET",
    path: "/api/v1/goals",
  },
  save_goal_funding: {
    method: "PUT",
    path: "/api/v1/goals",
  },
  get_goal_plan: {
    method: "GET",
    path: "/api/v1/goals",
  },
  save_goal_plan: {
    method: "POST",
    path: "/api/v1/goals/plan",
  },
  delete_goal_plan: {
    method: "DELETE",
    path: "/api/v1/goals",
  },
  refresh_goal_summary: {
    method: "POST",
    path: "/api/v1/goals",
  },
  refresh_all_goal_summaries: {
    method: "POST",
    path: "/api/v1/goals/refresh-summaries",
  },
  get_retirement_overview: {
    method: "GET",
    path: "/api/v1/goals",
  },
  get_save_up_overview: {
    method: "GET",
    path: "/api/v1/goals",
  },
  preview_save_up_overview: {
    method: "POST",
    path: "/api/v1/goals/save-up/preview",
  },
  calculate_retirement_projection: {
    method: "POST",
    path: "/api/v1/goals/retirement/projection",
  },
  run_retirement_monte_carlo: {
    method: "POST",
    path: "/api/v1/goals/retirement/monte-carlo",
  },
  run_retirement_stress_tests: {
    method: "POST",
    path: "/api/v1/goals/retirement/stress-tests",
  },
  run_retirement_scenario_analysis: {
    method: "POST",
    path: "/api/v1/goals/retirement/scenario-analysis",
  },
  run_retirement_decision_sensitivity_map: {
    method: "POST",
    path: "/api/v1/goals/retirement/decision-sensitivity-map",
  },
  run_retirement_sorr: {
    method: "POST",
    path: "/api/v1/goals/retirement/sequence-of-returns",
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
