export const ELECTRON_API_KEY = "wealthfolioElectron";

export const IPC_CHANNELS = {
  getRuntimeInfo: "wealthfolio:runtime-info",
  invoke: "wealthfolio:invoke",
  serverEvent: "wealthfolio:server-event",
  startAiChatStream: "wealthfolio:ai-chat-stream:start",
  cancelAiChatStream: "wealthfolio:ai-chat-stream:cancel",
  openCsvFileDialog: "wealthfolio:native:open-csv-file-dialog",
  openFolderDialog: "wealthfolio:native:open-folder-dialog",
  openDatabaseFileDialog: "wealthfolio:native:open-database-file-dialog",
  saveFileDialog: "wealthfolio:native:save-file-dialog",
  openExternalUrl: "wealthfolio:native:open-external-url",
} as const;

export const AI_CHAT_STREAM_EVENT_PREFIX = "ai-chat:stream:";

export function getAiChatStreamEventName(streamId: string): string {
  return `${AI_CHAT_STREAM_EVENT_PREFIX}${streamId}`;
}

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
  check_for_updates: {
    method: "GET",
    path: "/api/v1/app/check-update",
  },
  install_app_update: {
    method: "POST",
    path: "/__electron_native/install-update",
  },
  backup_database: {
    method: "POST",
    path: "/api/v1/utilities/database/backup",
  },
  backup_database_to_path: {
    method: "POST",
    path: "/api/v1/utilities/database/backup-to-path",
  },
  restore_database: {
    method: "POST",
    path: "/api/v1/utilities/database/restore",
  },
  set_secret: {
    method: "POST",
    path: "/api/v1/secrets",
  },
  get_secret: {
    method: "GET",
    path: "/api/v1/secrets",
  },
  delete_secret: {
    method: "DELETE",
    path: "/api/v1/secrets",
  },
  sync_generate_root_key: {
    method: "POST",
    path: "/api/v1/sync/crypto/generate-root-key",
  },
  sync_derive_dek: {
    method: "POST",
    path: "/api/v1/sync/crypto/derive-dek",
  },
  sync_generate_keypair: {
    method: "POST",
    path: "/api/v1/sync/crypto/generate-keypair",
  },
  sync_compute_shared_secret: {
    method: "POST",
    path: "/api/v1/sync/crypto/compute-shared-secret",
  },
  sync_derive_session_key: {
    method: "POST",
    path: "/api/v1/sync/crypto/derive-session-key",
  },
  sync_encrypt: {
    method: "POST",
    path: "/api/v1/sync/crypto/encrypt",
  },
  sync_decrypt: {
    method: "POST",
    path: "/api/v1/sync/crypto/decrypt",
  },
  sync_generate_pairing_code: {
    method: "POST",
    path: "/api/v1/sync/crypto/generate-pairing-code",
  },
  sync_hash_pairing_code: {
    method: "POST",
    path: "/api/v1/sync/crypto/hash-pairing-code",
  },
  sync_hmac_sha256: {
    method: "POST",
    path: "/api/v1/sync/crypto/hmac-sha256",
  },
  sync_compute_sas: {
    method: "POST",
    path: "/api/v1/sync/crypto/compute-sas",
  },
  sync_generate_device_id: {
    method: "POST",
    path: "/api/v1/sync/crypto/generate-device-id",
  },
  store_sync_session: {
    method: "POST",
    path: "/api/v1/connect/session",
  },
  clear_sync_session: {
    method: "DELETE",
    path: "/api/v1/connect/session",
  },
  get_sync_session_status: {
    method: "GET",
    path: "/api/v1/connect/session/status",
  },
  restore_sync_session: {
    method: "GET",
    path: "/api/v1/connect/session/restore",
  },
  list_broker_connections: {
    method: "GET",
    path: "/api/v1/connect/connections",
  },
  list_broker_accounts: {
    method: "GET",
    path: "/api/v1/connect/accounts",
  },
  sync_broker_data: {
    method: "POST",
    path: "/api/v1/connect/sync",
  },
  broker_ingest_run: {
    method: "POST",
    path: "/api/v1/connect/sync",
  },
  sync_broker_connections: {
    method: "POST",
    path: "/api/v1/connect/sync/connections",
  },
  sync_broker_accounts: {
    method: "POST",
    path: "/api/v1/connect/sync/accounts",
  },
  sync_broker_activities: {
    method: "POST",
    path: "/api/v1/connect/sync/activities",
  },
  get_subscription_plans: {
    method: "GET",
    path: "/api/v1/connect/plans",
  },
  get_subscription_plans_public: {
    method: "GET",
    path: "/api/v1/connect/plans/public",
  },
  get_user_info: {
    method: "GET",
    path: "/api/v1/connect/user",
  },
  get_synced_accounts: {
    method: "GET",
    path: "/api/v1/connect/synced-accounts",
  },
  get_platforms: {
    method: "GET",
    path: "/api/v1/connect/platforms",
  },
  get_broker_sync_states: {
    method: "GET",
    path: "/api/v1/connect/sync-states",
  },
  get_broker_ingest_states: {
    method: "GET",
    path: "/api/v1/connect/sync-states",
  },
  get_import_runs: {
    method: "GET",
    path: "/api/v1/connect/import-runs",
  },
  get_data_import_runs: {
    method: "GET",
    path: "/api/v1/connect/import-runs",
  },
  get_broker_sync_profile: {
    method: "GET",
    path: "/api/v1/connect/broker-sync-profile",
  },
  save_broker_sync_profile_rules: {
    method: "POST",
    path: "/api/v1/connect/broker-sync-profile",
  },
  get_device_sync_state: {
    method: "GET",
    path: "/api/v1/connect/device/sync-state",
  },
  enable_device_sync: {
    method: "POST",
    path: "/api/v1/connect/device/enable",
  },
  clear_device_sync_data: {
    method: "DELETE",
    path: "/api/v1/connect/device/sync-data",
  },
  reinitialize_device_sync: {
    method: "POST",
    path: "/api/v1/connect/device/reinitialize",
  },
  device_sync_engine_status: {
    method: "GET",
    path: "/api/v1/connect/device/engine-status",
  },
  device_sync_pairing_source_status: {
    method: "GET",
    path: "/api/v1/connect/device/pairing-source-status",
  },
  device_sync_bootstrap_overwrite_check: {
    method: "GET",
    path: "/api/v1/connect/device/bootstrap-overwrite-check",
  },
  device_sync_reconcile_ready_state: {
    method: "POST",
    path: "/api/v1/connect/device/reconcile-ready-state",
  },
  device_sync_bootstrap_snapshot_if_needed: {
    method: "POST",
    path: "/api/v1/connect/device/bootstrap-snapshot",
  },
  device_sync_trigger_cycle: {
    method: "POST",
    path: "/api/v1/connect/device/trigger-cycle",
  },
  device_sync_start_background_engine: {
    method: "POST",
    path: "/api/v1/connect/device/start-background",
  },
  device_sync_stop_background_engine: {
    method: "POST",
    path: "/api/v1/connect/device/stop-background",
  },
  device_sync_generate_snapshot_now: {
    method: "POST",
    path: "/api/v1/connect/device/generate-snapshot",
  },
  device_sync_cancel_snapshot_upload: {
    method: "POST",
    path: "/api/v1/connect/device/cancel-snapshot",
  },
  get_device: {
    method: "GET",
    path: "/api/v1/sync/device",
  },
  list_devices: {
    method: "GET",
    path: "/api/v1/sync/devices",
  },
  update_device: {
    method: "PATCH",
    path: "/api/v1/sync/device",
  },
  delete_device: {
    method: "DELETE",
    path: "/api/v1/sync/device",
  },
  revoke_device: {
    method: "POST",
    path: "/api/v1/sync/device",
  },
  reset_team_sync: {
    method: "POST",
    path: "/api/v1/sync/team/reset",
  },
  create_pairing: {
    method: "POST",
    path: "/api/v1/sync/pairing",
  },
  get_pairing: {
    method: "GET",
    path: "/api/v1/sync/pairing",
  },
  approve_pairing: {
    method: "POST",
    path: "/api/v1/sync/pairing",
  },
  complete_pairing: {
    method: "POST",
    path: "/api/v1/sync/pairing",
  },
  cancel_pairing: {
    method: "POST",
    path: "/api/v1/sync/pairing",
  },
  claim_pairing: {
    method: "POST",
    path: "/api/v1/sync/pairing/claim",
  },
  get_pairing_messages: {
    method: "GET",
    path: "/api/v1/sync/pairing",
  },
  confirm_pairing: {
    method: "POST",
    path: "/api/v1/sync/pairing",
  },
  complete_pairing_with_transfer: {
    method: "POST",
    path: "/api/v1/sync/pairing/complete-with-transfer",
  },
  confirm_pairing_with_bootstrap: {
    method: "POST",
    path: "/api/v1/sync/pairing/confirm-with-bootstrap",
  },
  begin_pairing_confirm: {
    method: "POST",
    path: "/api/v1/sync/pairing/flow/begin",
  },
  get_pairing_flow_state: {
    method: "POST",
    path: "/api/v1/sync/pairing/flow/state",
  },
  approve_pairing_overwrite: {
    method: "POST",
    path: "/api/v1/sync/pairing/flow/approve-overwrite",
  },
  cancel_pairing_flow: {
    method: "POST",
    path: "/api/v1/sync/pairing/flow/cancel",
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
  parse_csv: {
    method: "POST",
    path: "/api/v1/activities/import/parse",
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
  get_assets: {
    method: "GET",
    path: "/api/v1/assets",
  },
  create_asset: {
    method: "POST",
    path: "/api/v1/assets",
  },
  delete_asset: {
    method: "DELETE",
    path: "/api/v1/assets",
  },
  get_asset_profile: {
    method: "GET",
    path: "/api/v1/assets/profile",
  },
  update_asset_profile: {
    method: "PUT",
    path: "/api/v1/assets/profile",
  },
  update_quote_mode: {
    method: "PUT",
    path: "/api/v1/assets/pricing-mode",
  },
  search_symbol: {
    method: "GET",
    path: "/api/v1/market-data/search",
  },
  resolve_symbol_quote: {
    method: "GET",
    path: "/api/v1/market-data/resolve-currency",
  },
  get_quote_history: {
    method: "GET",
    path: "/api/v1/market-data/quotes/history",
  },
  fetch_yahoo_dividends: {
    method: "GET",
    path: "/api/v1/market-data/yahoo/dividends",
  },
  get_latest_quotes: {
    method: "POST",
    path: "/api/v1/market-data/quotes/latest",
  },
  update_quote: {
    method: "PUT",
    path: "/api/v1/market-data/quotes",
  },
  delete_quote: {
    method: "DELETE",
    path: "/api/v1/market-data/quotes/id",
  },
  check_quotes_import: {
    method: "POST",
    path: "/api/v1/market-data/quotes/check",
  },
  import_quotes_csv: {
    method: "POST",
    path: "/api/v1/market-data/quotes/import",
  },
  synch_quotes: {
    method: "POST",
    path: "/api/v1/market-data/sync/history",
  },
  sync_market_data: {
    method: "POST",
    path: "/api/v1/market-data/sync",
  },
  get_taxonomies: {
    method: "GET",
    path: "/api/v1/taxonomies",
  },
  get_taxonomy: {
    method: "GET",
    path: "/api/v1/taxonomies",
  },
  create_taxonomy: {
    method: "POST",
    path: "/api/v1/taxonomies",
  },
  update_taxonomy: {
    method: "PUT",
    path: "/api/v1/taxonomies",
  },
  delete_taxonomy: {
    method: "DELETE",
    path: "/api/v1/taxonomies",
  },
  create_category: {
    method: "POST",
    path: "/api/v1/taxonomies/categories",
  },
  update_category: {
    method: "PUT",
    path: "/api/v1/taxonomies/categories",
  },
  delete_category: {
    method: "DELETE",
    path: "/api/v1/taxonomies",
  },
  move_category: {
    method: "POST",
    path: "/api/v1/taxonomies/categories/move",
  },
  import_taxonomy_json: {
    method: "POST",
    path: "/api/v1/taxonomies/import",
  },
  export_taxonomy_json: {
    method: "GET",
    path: "/api/v1/taxonomies",
  },
  get_asset_taxonomy_assignments: {
    method: "GET",
    path: "/api/v1/taxonomies/assignments/asset",
  },
  assign_asset_to_category: {
    method: "POST",
    path: "/api/v1/taxonomies/assignments",
  },
  remove_asset_taxonomy_assignment: {
    method: "DELETE",
    path: "/api/v1/taxonomies/assignments",
  },
  get_migration_status: {
    method: "GET",
    path: "/api/v1/taxonomies/migration/status",
  },
  migrate_legacy_classifications: {
    method: "POST",
    path: "/api/v1/taxonomies/migration/run",
  },
  get_health_status: {
    method: "GET",
    path: "/api/v1/health/status",
  },
  run_health_checks: {
    method: "POST",
    path: "/api/v1/health/check",
  },
  dismiss_health_issue: {
    method: "POST",
    path: "/api/v1/health/dismiss",
  },
  restore_health_issue: {
    method: "POST",
    path: "/api/v1/health/restore",
  },
  get_dismissed_health_issues: {
    method: "GET",
    path: "/api/v1/health/dismissed",
  },
  execute_health_fix: {
    method: "POST",
    path: "/api/v1/health/fix",
  },
  get_health_config: {
    method: "GET",
    path: "/api/v1/health/config",
  },
  update_health_config: {
    method: "PUT",
    path: "/api/v1/health/config",
  },
  list_installed_addons: {
    method: "GET",
    path: "/api/v1/addons/installed",
  },
  install_addon_zip: {
    method: "POST",
    path: "/api/v1/addons/install-zip",
  },
  toggle_addon: {
    method: "POST",
    path: "/api/v1/addons/toggle",
  },
  uninstall_addon: {
    method: "DELETE",
    path: "/api/v1/addons",
  },
  load_addon_for_runtime: {
    method: "GET",
    path: "/api/v1/addons/runtime",
  },
  get_enabled_addons_on_startup: {
    method: "GET",
    path: "/api/v1/addons/enabled-on-startup",
  },
  extract_addon_zip: {
    method: "POST",
    path: "/api/v1/addons/extract",
  },
  fetch_addon_store_listings: {
    method: "GET",
    path: "/api/v1/addons/store/listings",
  },
  submit_addon_rating: {
    method: "POST",
    path: "/api/v1/addons/store/ratings",
  },
  get_addon_ratings: {
    method: "GET",
    path: "/api/v1/addons/store/ratings",
  },
  check_addon_update: {
    method: "POST",
    path: "/api/v1/addons/store/check-update",
  },
  check_all_addon_updates: {
    method: "POST",
    path: "/api/v1/addons/store/check-all",
  },
  update_addon_from_store_by_id: {
    method: "POST",
    path: "/api/v1/addons/store/update",
  },
  download_addon_to_staging: {
    method: "POST",
    path: "/api/v1/addons/store/staging/download",
  },
  install_addon_from_staging: {
    method: "POST",
    path: "/api/v1/addons/store/install-from-staging",
  },
  clear_addon_staging: {
    method: "DELETE",
    path: "/api/v1/addons/store/staging",
  },
  get_net_worth: {
    method: "GET",
    path: "/api/v1/net-worth",
  },
  get_net_worth_history: {
    method: "GET",
    path: "/api/v1/net-worth/history",
  },
  get_ai_providers: {
    method: "GET",
    path: "/api/v1/ai/providers",
  },
  update_ai_provider_settings: {
    method: "PUT",
    path: "/api/v1/ai/providers/settings",
  },
  set_default_ai_provider: {
    method: "POST",
    path: "/api/v1/ai/providers/default",
  },
  list_ai_models: {
    method: "GET",
    path: "/api/v1/ai/providers",
  },
  list_ai_threads: {
    method: "GET",
    path: "/api/v1/ai/threads",
  },
  get_ai_thread: {
    method: "GET",
    path: "/api/v1/ai/threads",
  },
  get_ai_thread_messages: {
    method: "GET",
    path: "/api/v1/ai/threads",
  },
  update_ai_thread: {
    method: "PUT",
    path: "/api/v1/ai/threads",
  },
  delete_ai_thread: {
    method: "DELETE",
    path: "/api/v1/ai/threads",
  },
  add_ai_thread_tag: {
    method: "POST",
    path: "/api/v1/ai/threads",
  },
  remove_ai_thread_tag: {
    method: "DELETE",
    path: "/api/v1/ai/threads",
  },
  get_ai_thread_tags: {
    method: "GET",
    path: "/api/v1/ai/threads",
  },
  update_tool_result: {
    method: "PATCH",
    path: "/api/v1/ai/tool-result",
  },
  create_alternative_asset: {
    method: "POST",
    path: "/api/v1/alternative-assets",
  },
  update_alternative_asset_valuation: {
    method: "PUT",
    path: "/api/v1/alternative-assets",
  },
  delete_alternative_asset: {
    method: "DELETE",
    path: "/api/v1/alternative-assets",
  },
  link_liability: {
    method: "POST",
    path: "/api/v1/alternative-assets",
  },
  unlink_liability: {
    method: "DELETE",
    path: "/api/v1/alternative-assets",
  },
  update_alternative_asset_metadata: {
    method: "PUT",
    path: "/api/v1/alternative-assets",
  },
  get_alternative_holdings: {
    method: "GET",
    path: "/api/v1/alternative-holdings",
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

export interface ElectronSaveFileRequest {
  content: string | Uint8Array | number[];
  fileName: string;
}

export interface WealthfolioElectronApi {
  getRuntimeInfo(): Promise<RuntimeInfo>;
  invoke<T>(command: string, payload?: Record<string, unknown>): Promise<T>;
  startAiChatStream(streamId: string, request: unknown): Promise<void>;
  cancelAiChatStream(streamId: string): Promise<void>;
  openCsvFileDialog(): Promise<null | string | string[]>;
  openFolderDialog(): Promise<string | null>;
  openDatabaseFileDialog(): Promise<string | null>;
  saveFileDialog(request: ElectronSaveFileRequest): Promise<boolean>;
  openExternalUrl(url: string): Promise<void>;
  listen<T>(
    eventName: string,
    handler: (event: ElectronEventMessage<T>) => void,
  ): Promise<() => Promise<void>>;
}

export function isElectronCommand(command: string): command is ElectronCommand {
  return Object.hasOwn(ELECTRON_COMMANDS, command);
}
