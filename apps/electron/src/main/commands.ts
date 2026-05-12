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
  try {
    response = await fetchImpl(url, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${sidecar.token}`,
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

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
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
