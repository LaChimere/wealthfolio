import { ADDON_HOST_CANARY_CONTRACT } from "./parity-fixtures";
import type { CommandSurface } from "./command-surface";

export const SECRET_SERVICE_PREFIX = "wealthfolio_";
export const SECRET_ENTRY_USERNAME = "default";

export const EXPECTED_ELECTRON_NATIVE_COMMANDS = [
  "check_for_updates",
  "install_app_update",
] as const;

export const EXPECTED_ELECTRON_ONLY_BACKEND_COMMANDS = [
  "backup_database_to_path",
  "export_data_file",
  "parse_csv",
  "restore_database",
  "sync_compute_sas",
  "sync_compute_shared_secret",
  "sync_decrypt",
  "sync_derive_dek",
  "sync_derive_session_key",
  "sync_encrypt",
  "sync_generate_device_id",
  "sync_generate_keypair",
  "sync_generate_pairing_code",
  "sync_generate_root_key",
  "sync_hash_pairing_code",
  "sync_hmac_sha256",
] as const;

export const EXPECTED_WEB_ONLY_BACKEND_COMMANDS = [
  "check_update",
  "delete_database_backup",
  "list_database_backups",
] as const;

export const MIXED_VERSION_SYNC_PREFLIGHT_COMMANDS = [
  "get_sync_session_status",
  "get_device_sync_state",
  "sync_generate_keypair",
  "sync_compute_shared_secret",
  "sync_derive_session_key",
  "sync_encrypt",
  "sync_decrypt",
  "register_device",
  "list_devices",
  "create_pairing",
  "confirm_pairing",
  "complete_pairing_with_transfer",
] as const;

export const ADDON_HOST_PREFLIGHT = {
  ...ADDON_HOST_CANARY_CONTRACT,
  requiredGlobals: ["React", "ReactDOM.createPortal"] as const,
  requiredBackendCommands: ADDON_HOST_CANARY_CONTRACT.requiredCommands,
};

export interface CommandCompatibilityReport {
  electronNative: string[];
  electronOnlyBackend: string[];
  webOnlyBackend: string[];
}

export function formatSecretServiceId(service: string): string {
  return `${SECRET_SERVICE_PREFIX}${service.toLowerCase()}`;
}

export function formatDesktopSecretServiceId(service: string, namespace?: string | null): string {
  const serviceId = formatSecretServiceId(service);
  const normalizedNamespace = normalizeSecretNamespace(namespace);
  if (!normalizedNamespace) {
    return serviceId;
  }
  const serviceSuffix = serviceId.startsWith(SECRET_SERVICE_PREFIX)
    ? serviceId.slice(SECRET_SERVICE_PREFIX.length)
    : serviceId;
  return `${SECRET_SERVICE_PREFIX}${normalizedNamespace}_${serviceSuffix}`;
}

export function normalizeSecretNamespace(namespace?: string | null): string | undefined {
  const normalized = (namespace ?? "")
    .trim()
    .split("")
    .flatMap((character) => {
      if (/[A-Za-z0-9]/.test(character)) {
        return character.toLowerCase();
      }
      if (character === "-" || character === "_") {
        return "_";
      }
      return [];
    })
    .join("");
  return normalized || undefined;
}

export function createCommandCompatibilityReport(
  surface: CommandSurface,
): CommandCompatibilityReport {
  return {
    electronNative: commandsByType(surface, "electron-native"),
    electronOnlyBackend: commandsByType(surface, "electron-only-backend"),
    webOnlyBackend: commandsByType(surface, "web-only-backend"),
  };
}

export function assertExpectedCompatibilityPreflights(surface: CommandSurface): void {
  const report = createCommandCompatibilityReport(surface);
  assertSameMembers(
    "electron-native command delta",
    report.electronNative,
    EXPECTED_ELECTRON_NATIVE_COMMANDS,
  );
  assertSameMembers(
    "electron-only backend command delta",
    report.electronOnlyBackend,
    EXPECTED_ELECTRON_ONLY_BACKEND_COMMANDS,
  );
  assertSameMembers(
    "web-only backend command delta",
    report.webOnlyBackend,
    EXPECTED_WEB_ONLY_BACKEND_COMMANDS,
  );
}

function commandsByType(surface: CommandSurface, type: CommandSurface["commands"][number]["type"]) {
  return surface.commands
    .filter((command) => command.type === type)
    .map((command) => command.command)
    .sort();
}

function assertSameMembers(name: string, actual: readonly string[], expected: readonly string[]) {
  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  if (JSON.stringify(sortedActual) !== JSON.stringify(sortedExpected)) {
    throw new Error(
      `Unexpected ${name}: expected [${sortedExpected.join(", ")}], got [${sortedActual.join(
        ", ",
      )}]`,
    );
  }
}
