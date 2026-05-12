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
    "update_portfolio" | "recalculate_portfolio" | "refresh_all_goal_summaries"
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
    "get_settings" | "is_auto_update_check_enabled" | "get_goals" | "list_import_templates"
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

function requireString(value: unknown, field: string, command: ElectronCommand): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Electron command "${command}" requires string payload field "${field}".`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : undefined;
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
