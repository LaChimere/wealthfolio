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
  command: Extract<ElectronCommand, "update_portfolio" | "recalculate_portfolio">;
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
  body: Record<string, unknown>;
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

async function invokeSimpleGet<T>({
  command,
  sidecar,
  fetchImpl,
}: {
  command: Extract<ElectronCommand, "get_settings" | "is_auto_update_check_enabled">;
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
