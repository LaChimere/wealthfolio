import { ELECTRON_COMMANDS, type ElectronCommand } from "../shared/ipc";
import { sanitizeSidecarError, type SidecarHandle } from "./sidecar";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface InvokeSidecarCommandOptions {
  command: ElectronCommand;
  payload?: Record<string, unknown>;
  sidecar: Pick<SidecarHandle, "baseUrl" | "token">;
  fetchImpl?: FetchLike;
}

interface ResolvedSidecarCommandOptions {
  payload?: Record<string, unknown>;
  sidecar: Pick<SidecarHandle, "baseUrl" | "token">;
  fetchImpl: FetchLike;
}

export async function invokeSidecarCommand<T>({
  command,
  payload,
  sidecar,
  fetchImpl = fetch,
}: InvokeSidecarCommandOptions): Promise<T> {
  switch (command) {
    case "get_accounts":
      return await invokeGetAccounts<T>({ payload, sidecar, fetchImpl });
    case "create_account":
      return await invokeCreateAccount<T>({ payload, sidecar, fetchImpl });
    case "update_account":
      return await invokeUpdateAccount<T>({ payload, sidecar, fetchImpl });
    case "delete_account":
      return await invokeDeleteAccount<T>({ payload, sidecar, fetchImpl });
    case "get_settings":
    case "is_auto_update_check_enabled":
      return await invokeSimpleGet<T>({ command, sidecar, fetchImpl });
    case "update_settings":
      return await invokeUpdateSettings<T>({ payload, sidecar, fetchImpl });
    case "update_portfolio":
    case "recalculate_portfolio":
      return await invokePostOptionalJson<T>({ command, payload, sidecar, fetchImpl });
    case "get_holdings":
      return await invokeGetWithQuery<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        params: [["accountId", optionalString(payload?.accountId)]],
      });
    case "get_holding":
      return await invokeGetWithQuery<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        params: [
          ["accountId", optionalString(payload?.accountId)],
          ["assetId", optionalString(payload?.assetId)],
        ],
      });
    case "get_asset_holdings":
      return await invokeGetWithQuery<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        params: [["assetId", optionalString(payload?.assetId)]],
      });
    case "get_historical_valuations":
      return await invokeGetWithQuery<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        params: [
          ["accountId", optionalString(payload?.accountId)],
          ["startDate", optionalString(payload?.startDate)],
          ["endDate", optionalString(payload?.endDate)],
        ],
      });
    case "get_latest_valuations":
      return await invokeGetWithRepeatedQuery<T>({
        command,
        sidecar,
        fetchImpl,
        repeatedKey: "accountIds[]",
        values: optionalStringArray(payload?.accountIds),
      });
    case "get_portfolio_allocations":
      return await invokeGetWithQuery<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        params: [["accountId", optionalString(payload?.accountId)]],
      });
    case "get_holdings_by_allocation":
      return await invokeGetWithQuery<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        params: [
          ["accountId", optionalString(payload?.accountId)],
          ["taxonomyId", optionalString(payload?.taxonomyId)],
          ["categoryId", optionalString(payload?.categoryId)],
        ],
      });
    case "calculate_accounts_simple_performance":
    case "calculate_performance_history":
    case "calculate_performance_summary":
      return await invokePostJson<T>({ command, body: payload ?? {}, sidecar, fetchImpl });
    case "get_income_summary":
      return await invokeGetWithQuery<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        params: [["accountId", optionalString(payload?.accountId)]],
      });
    case "get_snapshots":
      return await invokeGetWithQuery<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        params: [
          ["accountId", optionalString(payload?.accountId)],
          ["dateFrom", optionalString(payload?.dateFrom)],
          ["dateTo", optionalString(payload?.dateTo)],
        ],
      });
    case "get_snapshot_by_date":
    case "delete_snapshot":
      return await invokeGetWithQuery<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        params: [
          ["accountId", optionalString(payload?.accountId)],
          ["date", optionalString(payload?.date)],
        ],
      });
    case "save_manual_holdings":
      return await invokePostJson<T>({
        command,
        body: {
          accountId: requireString(payload?.accountId, "accountId", command),
          holdings: requireArray(payload?.holdings, "holdings", command),
          cashBalances: requireRecord(payload?.cashBalances, "cashBalances", command),
          snapshotDate: optionalString(payload?.snapshotDate),
        },
        sidecar,
        fetchImpl,
      });
    case "import_holdings_csv":
    case "check_holdings_import":
      return await invokePostJson<T>({
        command,
        body: {
          accountId: requireString(payload?.accountId, "accountId", command),
          snapshots: requireArray(payload?.snapshots, "snapshots", command),
        },
        sidecar,
        fetchImpl,
      });
    case "search_activities":
    case "check_activities_import":
    case "preview_import_assets":
    case "import_activities":
      return await invokePostJson<T>({ command, body: payload ?? {}, sidecar, fetchImpl });
    case "create_activity":
    case "update_activity":
      return await invokePostJson<T>({
        command,
        body: requireRecord(payload?.activity, "activity", command),
        sidecar,
        fetchImpl,
      });
    case "save_activities":
      return await invokePostJson<T>({
        command,
        body: requireRecord(payload?.request, "request", command),
        sidecar,
        fetchImpl,
      });
    case "delete_activity":
      return await invokeActivityDelete<T>({ payload, sidecar, fetchImpl });
    case "link_transfer_activities":
    case "unlink_transfer_activities":
      return await invokePostJson<T>({
        command,
        body: {
          activityAId: requireString(payload?.activityAId, "activityAId", command),
          activityBId: requireString(payload?.activityBId, "activityBId", command),
        },
        sidecar,
        fetchImpl,
      });
    case "get_account_import_mapping":
      return await invokeGetWithQuery<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        params: [
          ["accountId", optionalString(payload?.accountId)],
          ["contextKind", optionalString(payload?.contextKind)],
        ],
      });
    case "save_account_import_mapping":
      return await invokePostJson<T>({
        command,
        body: { mapping: requireRecord(payload?.mapping, "mapping", command) },
        sidecar,
        fetchImpl,
      });
    case "list_import_templates":
      return await invokeSimpleGet<T>({ command, sidecar, fetchImpl });
    case "get_import_template":
    case "delete_import_template":
      return await invokeGetWithQuery<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        params: [["id", optionalString(payload?.id)]],
      });
    case "save_import_template":
      return await invokePostJson<T>({
        command,
        body: { template: requireRecord(payload?.template, "template", command) },
        sidecar,
        fetchImpl,
      });
    case "link_account_template":
      return await invokePostJson<T>({
        command,
        body: {
          accountId: requireString(payload?.accountId, "accountId", command),
          templateId: requireString(payload?.templateId, "templateId", command),
          contextKind: optionalString(payload?.contextKind),
        },
        sidecar,
        fetchImpl,
      });
    case "get_latest_exchange_rates":
      return await invokeSimpleGet<T>({ command, sidecar, fetchImpl });
    case "update_exchange_rate":
      return await invokePostJson<T>({
        command,
        body: requireRecord(payload?.rate, "rate", command),
        sidecar,
        fetchImpl,
      });
    case "add_exchange_rate":
      return await invokePostJson<T>({
        command,
        body: requireRecord(payload?.newRate, "newRate", command),
        sidecar,
        fetchImpl,
      });
    case "delete_exchange_rate":
      return await invokeExchangeRateDelete<T>({ payload, sidecar, fetchImpl });
    case "get_exchanges":
    case "get_market_data_providers":
    case "get_market_data_providers_settings":
    case "get_custom_providers":
      return await invokeSimpleGet<T>({ command, sidecar, fetchImpl });
    case "update_market_data_provider_settings":
      return await invokePostJson<T>({ command, body: payload ?? {}, sidecar, fetchImpl });
    case "create_custom_provider":
    case "test_custom_provider_source":
      return await invokePostJson<T>({
        command,
        body: requireRecord(payload?.payload, "payload", command),
        sidecar,
        fetchImpl,
      });
    case "update_custom_provider":
      return await invokeCustomProviderUpdate<T>({ payload, sidecar, fetchImpl });
    case "delete_custom_provider":
      return await invokeCustomProviderDelete<T>({ payload, sidecar, fetchImpl });
    case "get_contribution_limits":
      return await invokeSimpleGet<T>({ command, sidecar, fetchImpl });
    case "create_contribution_limit":
      return await invokePostJson<T>({
        command,
        body: requireRecord(payload?.newLimit, "newLimit", command),
        sidecar,
        fetchImpl,
      });
    case "update_contribution_limit":
      return await invokeContributionLimitUpdate<T>({ payload, sidecar, fetchImpl });
    case "delete_contribution_limit":
      return await invokeContributionLimitDelete<T>({ payload, sidecar, fetchImpl });
    case "calculate_deposits_for_contribution_limit":
      return await invokeContributionLimitDeposits<T>({ payload, sidecar, fetchImpl });
    case "get_assets":
      return await invokeSimpleGet<T>({ command, sidecar, fetchImpl });
    case "create_asset":
      return await invokePostJson<T>({
        command,
        body: requireRecord(payload?.payload, "payload", command),
        sidecar,
        fetchImpl,
      });
    case "delete_asset":
      return await invokeAssetDelete<T>({ payload, sidecar, fetchImpl });
    case "get_asset_profile":
      return await invokeGetWithQuery<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        params: [["assetId", requireString(payload?.assetId, "assetId", command)]],
      });
    case "update_asset_profile":
      return await invokeAssetProfileUpdate<T>({ payload, sidecar, fetchImpl });
    case "update_quote_mode":
      return await invokeQuoteModeUpdate<T>({ payload, sidecar, fetchImpl });
    case "search_symbol":
      return await invokeGetWithQuery<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        params: [["query", requireString(payload?.query, "query", command)]],
      });
    case "resolve_symbol_quote":
      return await invokeGetWithQuery<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        params: [
          ["symbol", requireString(payload?.symbol, "symbol", command)],
          ["exchangeMic", optionalString(payload?.exchangeMic)],
          ["instrumentType", optionalString(payload?.instrumentType)],
          ["providerId", optionalString(payload?.providerId)],
          ["quoteCcy", optionalString(payload?.quoteCcy)],
        ],
      });
    case "get_quote_history":
    case "fetch_yahoo_dividends":
      return await invokeGetWithQuery<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        params: [["symbol", requireString(payload?.symbol, "symbol", command)]],
      });
    case "get_latest_quotes":
      return await invokePostJson<T>({
        command,
        body: { assetIds: requireStringArray(payload?.assetIds, "assetIds", command) },
        sidecar,
        fetchImpl,
      });
    case "update_quote":
      return await invokeQuoteUpdate<T>({ payload, sidecar, fetchImpl });
    case "delete_quote":
      return await invokeQuoteDelete<T>({ payload, sidecar, fetchImpl });
    case "check_quotes_import":
      return await invokePostJson<T>({
        command,
        body: {
          content: requireArray(payload?.content, "content", command),
          hasHeaderRow: requireBoolean(payload?.hasHeaderRow, "hasHeaderRow", command),
        },
        sidecar,
        fetchImpl,
      });
    case "import_quotes_csv":
      return await invokePostJson<T>({
        command,
        body: {
          quotes: requireArray(payload?.quotes, "quotes", command),
          overwriteExisting: requireBoolean(
            payload?.overwriteExisting,
            "overwriteExisting",
            command,
          ),
        },
        sidecar,
        fetchImpl,
      });
    case "synch_quotes":
      return await invokePostOptionalJson<T>({ command, sidecar, fetchImpl });
    case "sync_market_data":
      return await invokePostJson<T>({
        command,
        body: {
          assetIds: optionalStringArray(payload?.assetIds),
          refetchAll: requireBoolean(payload?.refetchAll, "refetchAll", command),
          refetchRecentDays: optionalNumber(payload?.refetchRecentDays),
        },
        sidecar,
        fetchImpl,
      });
    case "get_taxonomies":
    case "get_migration_status":
      return await invokeSimpleGet<T>({ command, sidecar, fetchImpl });
    case "get_taxonomy":
    case "delete_taxonomy":
      return await invokeTaxonomyById<T>({ command, payload, sidecar, fetchImpl });
    case "create_taxonomy":
    case "update_taxonomy":
      return await invokePostJson<T>({
        command,
        body: requireRecord(payload?.taxonomy, "taxonomy", command),
        sidecar,
        fetchImpl,
      });
    case "create_category":
    case "update_category":
      return await invokePostJson<T>({
        command,
        body: requireRecord(payload?.category, "category", command),
        sidecar,
        fetchImpl,
      });
    case "delete_category":
      return await invokeCategoryDelete<T>({ payload, sidecar, fetchImpl });
    case "move_category":
      return await invokePostJson<T>({
        command,
        body: {
          taxonomyId: requireString(payload?.taxonomyId, "taxonomyId", command),
          categoryId: requireString(payload?.categoryId, "categoryId", command),
          newParentId: nullableString(payload?.newParentId),
          position: requireNumber(payload?.position, "position", command),
        },
        sidecar,
        fetchImpl,
      });
    case "import_taxonomy_json":
      return await invokePostJson<T>({
        command,
        body: { jsonStr: requireString(payload?.jsonStr, "jsonStr", command) },
        sidecar,
        fetchImpl,
      });
    case "export_taxonomy_json":
      return await invokeTaxonomyExport<T>({ payload, sidecar, fetchImpl });
    case "get_asset_taxonomy_assignments":
      return await invokeAssetTaxonomyAssignments<T>({ payload, sidecar, fetchImpl });
    case "assign_asset_to_category":
      return await invokePostJson<T>({
        command,
        body: requireRecord(payload?.assignment, "assignment", command),
        sidecar,
        fetchImpl,
      });
    case "remove_asset_taxonomy_assignment":
      return await invokeTaxonomyAssignmentDelete<T>({ payload, sidecar, fetchImpl });
    case "migrate_legacy_classifications":
      return await invokePostOptionalJson<T>({ command, sidecar, fetchImpl });
    case "get_health_status":
    case "run_health_checks":
      return await invokeHealthStatus<T>({ command, payload, sidecar, fetchImpl });
    case "get_dismissed_health_issues":
    case "get_health_config":
      return await invokeSimpleGet<T>({ command, sidecar, fetchImpl });
    case "dismiss_health_issue":
      return await invokePostJson<T>({
        command,
        body: {
          issueId: requireString(payload?.issueId, "issueId", command),
          dataHash: requireString(payload?.dataHash, "dataHash", command),
        },
        sidecar,
        fetchImpl,
      });
    case "restore_health_issue":
      return await invokePostJson<T>({
        command,
        body: { issueId: requireString(payload?.issueId, "issueId", command) },
        sidecar,
        fetchImpl,
      });
    case "execute_health_fix":
      return await invokePostJson<T>({
        command,
        body: requireRecord(payload?.action, "action", command),
        sidecar,
        fetchImpl,
      });
    case "update_health_config":
      return await invokePostJson<T>({
        command,
        body: requireRecord(payload?.config, "config", command),
        sidecar,
        fetchImpl,
      });
    case "get_goals":
      return await invokeSimpleGet<T>({ command, sidecar, fetchImpl });
    case "get_goal":
    case "delete_goal":
      return await invokeGoalById<T>({ command, payload, sidecar, fetchImpl });
    case "create_goal":
    case "update_goal":
      return await invokePostJson<T>({
        command,
        body: requireRecord(payload?.goal, "goal", command),
        sidecar,
        fetchImpl,
      });
    case "get_goal_funding":
      return await invokeGoalNested<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        suffix: "funding",
      });
    case "save_goal_funding":
      return await invokeGoalNested<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        suffix: "funding",
        body: requireArray(payload?.rules, "rules", command),
      });
    case "get_goal_plan":
    case "delete_goal_plan":
      return await invokeGoalNested<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        suffix: "plan",
      });
    case "save_goal_plan":
      return await invokePostJson<T>({
        command,
        body: requireRecord(payload?.plan, "plan", command),
        sidecar,
        fetchImpl,
      });
    case "refresh_goal_summary":
      return await invokeGoalNested<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        suffix: "refresh-summary",
      });
    case "refresh_all_goal_summaries":
      return await invokePostOptionalJson<T>({ command, sidecar, fetchImpl });
    case "get_retirement_overview":
      return await invokeGoalNested<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        suffix: "retirement/overview",
      });
    case "get_save_up_overview":
      return await invokeGoalNested<T>({
        command,
        payload,
        sidecar,
        fetchImpl,
        suffix: "save-up/overview",
      });
    case "preview_save_up_overview":
      return await invokePostJson<T>({
        command,
        body: requireRecord(payload?.input, "input", command),
        sidecar,
        fetchImpl,
      });
    case "calculate_retirement_projection":
    case "run_retirement_monte_carlo":
    case "run_retirement_stress_tests":
    case "run_retirement_scenario_analysis":
    case "run_retirement_decision_sensitivity_map":
    case "run_retirement_sorr":
      return await invokePostJson<T>({ command, body: payload ?? {}, sidecar, fetchImpl });
  }

  const unimplementedCommand: never = command;
  throw new Error(
    `Electron command "${unimplementedCommand}" passed validation but has no implementation.`,
  );
}

async function invokeGetAccounts<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const url = new URL(ELECTRON_COMMANDS.get_accounts.path, sidecar.baseUrl);
  if (payload?.includeArchived === true) {
    url.searchParams.set("includeArchived", "true");
  }

  return await fetchSidecarJson<T>({
    command: "get_accounts",
    fetchImpl,
    sidecar,
    url,
    init: { method: ELECTRON_COMMANDS.get_accounts.method },
  });
}

async function invokeCreateAccount<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const account = requireRecord(payload?.account, "account", "create_account");
  return await fetchSidecarJson<T>({
    command: "create_account",
    fetchImpl,
    sidecar,
    url: new URL(ELECTRON_COMMANDS.create_account.path, sidecar.baseUrl),
    init: {
      method: ELECTRON_COMMANDS.create_account.method,
      body: JSON.stringify(account),
    },
  });
}

async function invokeUpdateAccount<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const accountUpdate = requireRecord(payload?.accountUpdate, "accountUpdate", "update_account");
  const accountId = requireString(accountUpdate.id, "accountUpdate.id", "update_account");
  return await fetchSidecarJson<T>({
    command: "update_account",
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS.update_account.path}/${encodeURIComponent(accountId)}`,
      sidecar.baseUrl,
    ),
    init: {
      method: ELECTRON_COMMANDS.update_account.method,
      body: JSON.stringify(accountUpdate),
    },
  });
}

async function invokeDeleteAccount<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const accountId = requireString(payload?.accountId, "accountId", "delete_account");
  return await fetchSidecarJson<T>({
    command: "delete_account",
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS.delete_account.path}/${encodeURIComponent(accountId)}`,
      sidecar.baseUrl,
    ),
    init: { method: ELECTRON_COMMANDS.delete_account.method },
  });
}

async function invokeGetWithQuery<T>({
  command,
  sidecar,
  fetchImpl,
  params,
}: {
  command: ElectronCommand;
  payload?: Record<string, unknown>;
  sidecar: Pick<SidecarHandle, "baseUrl" | "token">;
  fetchImpl: FetchLike;
  params: Array<[string, string | undefined]>;
}): Promise<T> {
  const url = new URL(ELECTRON_COMMANDS[command].path, sidecar.baseUrl);
  for (const [key, value] of params) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }
  return await fetchSidecarJson<T>({
    command,
    fetchImpl,
    sidecar,
    url,
    init: { method: ELECTRON_COMMANDS[command].method },
  });
}

async function invokeGetWithRepeatedQuery<T>({
  command,
  sidecar,
  fetchImpl,
  repeatedKey,
  values,
}: {
  command: ElectronCommand;
  sidecar: Pick<SidecarHandle, "baseUrl" | "token">;
  fetchImpl: FetchLike;
  repeatedKey: string;
  values: string[] | undefined;
}): Promise<T> {
  const url = new URL(ELECTRON_COMMANDS[command].path, sidecar.baseUrl);
  for (const value of values ?? []) {
    url.searchParams.append(repeatedKey, value);
  }
  return await fetchSidecarJson<T>({
    command,
    fetchImpl,
    sidecar,
    url,
    init: { method: ELECTRON_COMMANDS[command].method },
  });
}

async function invokePostOptionalJson<T>({
  command,
  payload,
  sidecar,
  fetchImpl,
}: {
  command: Extract<
    ElectronCommand,
    | "update_portfolio"
    | "recalculate_portfolio"
    | "refresh_all_goal_summaries"
    | "synch_quotes"
    | "migrate_legacy_classifications"
  >;
  payload?: Record<string, unknown>;
  sidecar: Pick<SidecarHandle, "baseUrl" | "token">;
  fetchImpl: FetchLike;
}): Promise<T> {
  return await fetchSidecarJson<T>({
    command,
    fetchImpl,
    sidecar,
    url: new URL(ELECTRON_COMMANDS[command].path, sidecar.baseUrl),
    init: {
      method: ELECTRON_COMMANDS[command].method,
      body: payload ? JSON.stringify(payload) : undefined,
    },
  });
}

async function invokePostJson<T>({
  command,
  body,
  sidecar,
  fetchImpl,
}: {
  command: ElectronCommand;
  body: unknown;
  sidecar: Pick<SidecarHandle, "baseUrl" | "token">;
  fetchImpl: FetchLike;
}): Promise<T> {
  return await fetchSidecarJson<T>({
    command,
    fetchImpl,
    sidecar,
    url: new URL(ELECTRON_COMMANDS[command].path, sidecar.baseUrl),
    init: {
      method: ELECTRON_COMMANDS[command].method,
      body: JSON.stringify(body),
    },
  });
}

async function invokeActivityDelete<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const activityId = requireString(payload?.activityId, "activityId", "delete_activity");
  return await fetchSidecarJson<T>({
    command: "delete_activity",
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS.delete_activity.path}/${encodeURIComponent(activityId)}`,
      sidecar.baseUrl,
    ),
    init: { method: ELECTRON_COMMANDS.delete_activity.method },
  });
}

async function invokeExchangeRateDelete<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const rateId = requireString(payload?.rateId, "rateId", "delete_exchange_rate");
  return await fetchSidecarJson<T>({
    command: "delete_exchange_rate",
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS.delete_exchange_rate.path}/${encodeURIComponent(rateId)}`,
      sidecar.baseUrl,
    ),
    init: { method: ELECTRON_COMMANDS.delete_exchange_rate.method },
  });
}

async function invokeCustomProviderUpdate<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const providerId = requireString(payload?.providerId, "providerId", "update_custom_provider");
  const providerPayload = requireRecord(payload?.payload, "payload", "update_custom_provider");
  return await fetchSidecarJson<T>({
    command: "update_custom_provider",
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS.update_custom_provider.path}/${encodeURIComponent(providerId)}`,
      sidecar.baseUrl,
    ),
    init: {
      method: ELECTRON_COMMANDS.update_custom_provider.method,
      body: JSON.stringify(providerPayload),
    },
  });
}

async function invokeCustomProviderDelete<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const providerId = requireString(payload?.providerId, "providerId", "delete_custom_provider");
  return await fetchSidecarJson<T>({
    command: "delete_custom_provider",
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS.delete_custom_provider.path}/${encodeURIComponent(providerId)}`,
      sidecar.baseUrl,
    ),
    init: { method: ELECTRON_COMMANDS.delete_custom_provider.method },
  });
}

async function invokeContributionLimitUpdate<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const id = requireString(payload?.id, "id", "update_contribution_limit");
  const updatedLimit = requireRecord(
    payload?.updatedLimit,
    "updatedLimit",
    "update_contribution_limit",
  );
  return await fetchSidecarJson<T>({
    command: "update_contribution_limit",
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS.update_contribution_limit.path}/${encodeURIComponent(id)}`,
      sidecar.baseUrl,
    ),
    init: {
      method: ELECTRON_COMMANDS.update_contribution_limit.method,
      body: JSON.stringify(updatedLimit),
    },
  });
}

async function invokeContributionLimitDelete<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const id = requireString(payload?.id, "id", "delete_contribution_limit");
  return await fetchSidecarJson<T>({
    command: "delete_contribution_limit",
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS.delete_contribution_limit.path}/${encodeURIComponent(id)}`,
      sidecar.baseUrl,
    ),
    init: { method: ELECTRON_COMMANDS.delete_contribution_limit.method },
  });
}

async function invokeContributionLimitDeposits<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const limitId = requireString(
    payload?.limitId,
    "limitId",
    "calculate_deposits_for_contribution_limit",
  );
  return await fetchSidecarJson<T>({
    command: "calculate_deposits_for_contribution_limit",
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS.calculate_deposits_for_contribution_limit.path}/${encodeURIComponent(
        limitId,
      )}/deposits`,
      sidecar.baseUrl,
    ),
    init: { method: ELECTRON_COMMANDS.calculate_deposits_for_contribution_limit.method },
  });
}

async function invokeAssetDelete<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const id = requireString(payload?.id, "id", "delete_asset");
  return await fetchSidecarJson<T>({
    command: "delete_asset",
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS.delete_asset.path}/${encodeURIComponent(id)}`,
      sidecar.baseUrl,
    ),
    init: { method: ELECTRON_COMMANDS.delete_asset.method },
  });
}

async function invokeAssetProfileUpdate<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const id = requireString(payload?.id, "id", "update_asset_profile");
  const assetPayload = requireRecord(payload?.payload, "payload", "update_asset_profile");
  return await fetchSidecarJson<T>({
    command: "update_asset_profile",
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS.update_asset_profile.path}/${encodeURIComponent(id)}`,
      sidecar.baseUrl,
    ),
    init: {
      method: ELECTRON_COMMANDS.update_asset_profile.method,
      body: JSON.stringify(assetPayload),
    },
  });
}

async function invokeQuoteModeUpdate<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const id = requireString(payload?.id, "id", "update_quote_mode");
  const quoteMode = requireString(payload?.quoteMode, "quoteMode", "update_quote_mode");
  return await fetchSidecarJson<T>({
    command: "update_quote_mode",
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS.update_quote_mode.path}/${encodeURIComponent(id)}`,
      sidecar.baseUrl,
    ),
    init: {
      method: ELECTRON_COMMANDS.update_quote_mode.method,
      body: JSON.stringify({ quoteMode }),
    },
  });
}

async function invokeQuoteUpdate<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const symbol = requireString(payload?.symbol, "symbol", "update_quote");
  const quote = requireRecord(payload?.quote, "quote", "update_quote");
  return await fetchSidecarJson<T>({
    command: "update_quote",
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS.update_quote.path}/${encodeURIComponent(symbol)}`,
      sidecar.baseUrl,
    ),
    init: {
      method: ELECTRON_COMMANDS.update_quote.method,
      body: JSON.stringify(quote),
    },
  });
}

async function invokeQuoteDelete<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const id = requireString(payload?.id, "id", "delete_quote");
  return await fetchSidecarJson<T>({
    command: "delete_quote",
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS.delete_quote.path}/${encodeURIComponent(id)}`,
      sidecar.baseUrl,
    ),
    init: { method: ELECTRON_COMMANDS.delete_quote.method },
  });
}

async function invokeTaxonomyById<T>({
  command,
  payload,
  sidecar,
  fetchImpl,
}: {
  command: Extract<ElectronCommand, "get_taxonomy" | "delete_taxonomy">;
  payload?: Record<string, unknown>;
  sidecar: Pick<SidecarHandle, "baseUrl" | "token">;
  fetchImpl: FetchLike;
}): Promise<T> {
  const id = requireString(payload?.id, "id", command);
  return await fetchSidecarJson<T>({
    command,
    fetchImpl,
    sidecar,
    url: new URL(`${ELECTRON_COMMANDS[command].path}/${encodeURIComponent(id)}`, sidecar.baseUrl),
    init: { method: ELECTRON_COMMANDS[command].method },
  });
}

async function invokeCategoryDelete<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const taxonomyId = requireString(payload?.taxonomyId, "taxonomyId", "delete_category");
  const categoryId = requireString(payload?.categoryId, "categoryId", "delete_category");
  return await fetchSidecarJson<T>({
    command: "delete_category",
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS.delete_category.path}/${encodeURIComponent(
        taxonomyId,
      )}/categories/${encodeURIComponent(categoryId)}`,
      sidecar.baseUrl,
    ),
    init: { method: ELECTRON_COMMANDS.delete_category.method },
  });
}

async function invokeTaxonomyExport<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const id = requireString(payload?.id, "id", "export_taxonomy_json");
  return await fetchSidecarJson<T>({
    command: "export_taxonomy_json",
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS.export_taxonomy_json.path}/${encodeURIComponent(id)}/export`,
      sidecar.baseUrl,
    ),
    init: { method: ELECTRON_COMMANDS.export_taxonomy_json.method },
  });
}

async function invokeAssetTaxonomyAssignments<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const assetId = requireString(payload?.assetId, "assetId", "get_asset_taxonomy_assignments");
  return await fetchSidecarJson<T>({
    command: "get_asset_taxonomy_assignments",
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS.get_asset_taxonomy_assignments.path}/${encodeURIComponent(assetId)}`,
      sidecar.baseUrl,
    ),
    init: { method: ELECTRON_COMMANDS.get_asset_taxonomy_assignments.method },
  });
}

async function invokeTaxonomyAssignmentDelete<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const id = requireString(payload?.id, "id", "remove_asset_taxonomy_assignment");
  return await fetchSidecarJson<T>({
    command: "remove_asset_taxonomy_assignment",
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS.remove_asset_taxonomy_assignment.path}/${encodeURIComponent(id)}`,
      sidecar.baseUrl,
    ),
    init: { method: ELECTRON_COMMANDS.remove_asset_taxonomy_assignment.method },
  });
}

async function invokeHealthStatus<T>({
  command,
  payload,
  sidecar,
  fetchImpl,
}: {
  command: Extract<ElectronCommand, "get_health_status" | "run_health_checks">;
  payload?: Record<string, unknown>;
  sidecar: Pick<SidecarHandle, "baseUrl" | "token">;
  fetchImpl: FetchLike;
}): Promise<T> {
  const clientTimezone = resolveClientTimezone(payload);
  return await fetchSidecarJson<T>({
    command,
    fetchImpl,
    sidecar,
    url: new URL(ELECTRON_COMMANDS[command].path, sidecar.baseUrl),
    init: {
      method: ELECTRON_COMMANDS[command].method,
      headers: clientTimezone ? { "X-Client-Timezone": clientTimezone } : undefined,
    },
  });
}

async function invokeGoalById<T>({
  command,
  payload,
  sidecar,
  fetchImpl,
}: {
  command: Extract<ElectronCommand, "get_goal" | "delete_goal">;
  payload?: Record<string, unknown>;
  sidecar: Pick<SidecarHandle, "baseUrl" | "token">;
  fetchImpl: FetchLike;
}): Promise<T> {
  const goalId = requireString(payload?.goalId, "goalId", command);
  return await fetchSidecarJson<T>({
    command,
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS[command].path}/${encodeURIComponent(goalId)}`,
      sidecar.baseUrl,
    ),
    init: { method: ELECTRON_COMMANDS[command].method },
  });
}

async function invokeGoalNested<T>({
  command,
  payload,
  sidecar,
  fetchImpl,
  suffix,
  body,
}: {
  command: Extract<
    ElectronCommand,
    | "get_goal_funding"
    | "save_goal_funding"
    | "get_goal_plan"
    | "delete_goal_plan"
    | "refresh_goal_summary"
    | "get_retirement_overview"
    | "get_save_up_overview"
  >;
  payload?: Record<string, unknown>;
  sidecar: Pick<SidecarHandle, "baseUrl" | "token">;
  fetchImpl: FetchLike;
  suffix: string;
  body?: unknown;
}): Promise<T> {
  const goalId = requireString(payload?.goalId, "goalId", command);
  return await fetchSidecarJson<T>({
    command,
    fetchImpl,
    sidecar,
    url: new URL(
      `${ELECTRON_COMMANDS[command].path}/${encodeURIComponent(goalId)}/${suffix}`,
      sidecar.baseUrl,
    ),
    init: {
      method: ELECTRON_COMMANDS[command].method,
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  });
}

async function invokeSimpleGet<T>({
  command,
  sidecar,
  fetchImpl,
}: {
  command: Extract<
    ElectronCommand,
    | "get_settings"
    | "is_auto_update_check_enabled"
    | "get_goals"
    | "list_import_templates"
    | "get_latest_exchange_rates"
    | "get_exchanges"
    | "get_market_data_providers"
    | "get_market_data_providers_settings"
    | "get_custom_providers"
    | "get_contribution_limits"
    | "get_assets"
    | "get_taxonomies"
    | "get_migration_status"
    | "get_dismissed_health_issues"
    | "get_health_config"
  >;
  sidecar: Pick<SidecarHandle, "baseUrl" | "token">;
  fetchImpl: FetchLike;
}): Promise<T> {
  return await fetchSidecarJson<T>({
    command,
    fetchImpl,
    sidecar,
    url: new URL(ELECTRON_COMMANDS[command].path, sidecar.baseUrl),
    init: { method: ELECTRON_COMMANDS[command].method },
  });
}

async function invokeUpdateSettings<T>({
  payload,
  sidecar,
  fetchImpl,
}: ResolvedSidecarCommandOptions): Promise<T> {
  const settingsUpdate = requireRecord(
    payload?.settingsUpdate,
    "settingsUpdate",
    "update_settings",
  );
  return await fetchSidecarJson<T>({
    command: "update_settings",
    fetchImpl,
    sidecar,
    url: new URL(ELECTRON_COMMANDS.update_settings.path, sidecar.baseUrl),
    init: {
      method: ELECTRON_COMMANDS.update_settings.method,
      body: JSON.stringify(settingsUpdate),
    },
  });
}

async function fetchSidecarJson<T>({
  command,
  fetchImpl,
  sidecar,
  url,
  init,
}: {
  command: ElectronCommand;
  fetchImpl: FetchLike;
  sidecar: Pick<SidecarHandle, "token">;
  url: URL;
  init: RequestInit;
}): Promise<T> {
  let response: Response;
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${sidecar.token}`,
  };
  if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  try {
    response = await fetchImpl(url, {
      ...init,
      headers: {
        ...headers,
        ...init.headers,
      },
    });
  } catch (error) {
    throw new Error(
      `Electron sidecar command "${command}" failed: ${sanitizeCommandError(formatError(error), sidecar)}`,
    );
  }

  if (!response.ok) {
    const message = sanitizeCommandError(await readErrorMessage(response), sidecar);
    throw new Error(
      `Electron sidecar command "${command}" failed with HTTP ${response.status}: ${message}`,
    );
  }

  if (response.status === 204 || response.status === 202) {
    return undefined as T;
  }

  const text = await response.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

function sanitizeCommandError(error: string, sidecar: Pick<SidecarHandle, "token">): string {
  const sanitized = sanitizeSidecarError(error);
  return sidecar.token ? sanitized.replaceAll(sidecar.token, "[redacted]") : sanitized;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requireRecord(
  value: unknown,
  field: string,
  command: ElectronCommand,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Electron command "${command}" requires object payload field "${field}".`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, field: string, command: ElectronCommand): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Electron command "${command}" requires array payload field "${field}".`);
  }
  return value;
}

function requireStringArray(value: unknown, field: string, command: ElectronCommand): string[] {
  const items = requireArray(value, field, command);
  if (items.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error(
      `Electron command "${command}" requires string array payload field "${field}".`,
    );
  }
  return items as string[];
}

function requireString(value: unknown, field: string, command: ElectronCommand): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Electron command "${command}" requires string payload field "${field}".`);
  }
  return value;
}

function requireBoolean(value: unknown, field: string, command: ElectronCommand): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Electron command "${command}" requires boolean payload field "${field}".`);
  }
  return value;
}

function requireNumber(value: unknown, field: string, command: ElectronCommand): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Electron command "${command}" requires number payload field "${field}".`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function optionalStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function resolveClientTimezone(payload: Record<string, unknown> | undefined): string | undefined {
  const payloadTimezone = optionalString(payload?.clientTimezone)?.trim();
  if (payloadTimezone) {
    return payloadTimezone;
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
}

async function readErrorMessage(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await response.json().catch(() => undefined)) as
      | { message?: unknown; error?: unknown }
      | undefined;
    const message = body?.message ?? body?.error;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  const body = await response.text().catch(() => "");
  return body.trim() || response.statusText || "Unknown sidecar error";
}
