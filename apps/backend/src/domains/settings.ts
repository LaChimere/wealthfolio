import type { Database } from "bun:sqlite";

export interface Settings {
  theme: string;
  font: string;
  baseCurrency: string;
  timezone: string;
  instanceId: string;
  onboardingCompleted: boolean;
  autoUpdateCheckEnabled: boolean;
  menuBarVisible: boolean;
  syncEnabled: boolean;
}

export interface SettingsUpdate {
  theme?: string;
  font?: string;
  baseCurrency?: string;
  timezone?: string;
  onboardingCompleted?: boolean;
  autoUpdateCheckEnabled?: boolean;
  menuBarVisible?: boolean;
  syncEnabled?: boolean;
}

export interface SettingsService {
  getSettings(): Settings;
  updateSettings(update: SettingsUpdate): Promise<Settings>;
  isAutoUpdateCheckEnabled(): boolean;
}

export interface SettingsServiceOptions {
  registerCurrencyPair?: (currency: string, baseCurrency: string) => Promise<void>;
  warn?: (message: string) => void;
}

interface SettingRow {
  setting_key: string;
  setting_value: string;
}

type SettingsKey = keyof SettingsUpdate;

const SETTINGS_KEY_TO_DB_KEY = {
  theme: "theme",
  font: "font",
  baseCurrency: "base_currency",
  timezone: "timezone",
  onboardingCompleted: "onboarding_completed",
  autoUpdateCheckEnabled: "auto_update_check_enabled",
  menuBarVisible: "menu_bar_visible",
  syncEnabled: "sync_enabled",
} as const satisfies Record<SettingsKey, string>;

export const DEFAULT_SETTINGS: Settings = {
  theme: "light",
  font: "font-mono",
  baseCurrency: "",
  timezone: "",
  instanceId: "",
  onboardingCompleted: false,
  autoUpdateCheckEnabled: true,
  menuBarVisible: true,
  syncEnabled: true,
};

export function createSettingsService(
  db: Database,
  options: SettingsServiceOptions = {},
): SettingsService {
  return {
    getSettings() {
      return readSettings(db);
    },
    async updateSettings(update) {
      await registerFxPairsForBaseCurrencyUpdate(db, update, options);
      writeSettingsUpdate(db, update);
      return readSettings(db);
    },
    isAutoUpdateCheckEnabled() {
      const value = getSetting(db, "auto_update_check_enabled");
      return value === undefined ? true : parseBoolean(value, true);
    },
  };
}

async function registerFxPairsForBaseCurrencyUpdate(
  db: Database,
  update: SettingsUpdate,
  options: SettingsServiceOptions,
): Promise<void> {
  if (update.baseCurrency === undefined || !options.registerCurrencyPair) {
    return;
  }
  const newBaseCurrency = update.baseCurrency;
  if (getSetting(db, "base_currency") === newBaseCurrency) {
    return;
  }

  for (const currency of readDistinctCurrenciesExcludingBase(db, newBaseCurrency)) {
    try {
      await options.registerCurrencyPair(currency, newBaseCurrency);
    } catch (error) {
      options.warn?.(
        `Failed to register currency pair ${newBaseCurrency}${currency}: ${errorMessage(error)}. Skipping.`,
      );
    }
  }
}

function readDistinctCurrenciesExcludingBase(db: Database, baseCurrency: string): string[] {
  return db
    .query<{ currency: string }, [string, string]>(
      `
        SELECT quote_ccy AS currency
        FROM assets
        WHERE kind = 'FX'
          AND quote_ccy != ?
        UNION
        SELECT currency
        FROM accounts
        WHERE currency != ?
        ORDER BY currency ASC
      `,
    )
    .all(baseCurrency, baseCurrency)
    .map((row) => row.currency);
}

export function readSettings(db: Database): Settings {
  const settings = { ...DEFAULT_SETTINGS };
  const rows = db
    .query<SettingRow, []>("SELECT setting_key, setting_value FROM app_settings")
    .all();

  for (const row of rows) {
    applySettingValue(settings, row.setting_key, row.setting_value);
  }
  return settings;
}

export function writeSettingsUpdate(db: Database, update: SettingsUpdate): void {
  const insert = db.prepare(
    "INSERT OR REPLACE INTO app_settings (setting_key, setting_value) VALUES (?, ?)",
  );
  db.transaction(() => {
    for (const [key, dbKey] of Object.entries(SETTINGS_KEY_TO_DB_KEY) as [SettingsKey, string][]) {
      const value = update[key];
      if (value === undefined) {
        continue;
      }
      insert.run(dbKey, stringifySettingValue(key, value));
    }
  })();
}

export function getSetting(db: Database, key: string): string | undefined {
  const row = db
    .query<
      { setting_value: string },
      [string]
    >("SELECT setting_value FROM app_settings WHERE setting_key = ?")
    .get(key);
  if (row) {
    return row.setting_value;
  }
  return defaultSettingValue(key);
}

export function canonicalizeTimezone(timezone: string): string {
  const normalized = timezone.trim();
  if (!normalized) {
    throw new Error("Timezone cannot be empty");
  }
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: normalized }).resolvedOptions().timeZone;
  } catch {
    throw new Error(`Invalid timezone: ${normalized}`);
  }
}

function applySettingValue(settings: Settings, key: string, value: string): void {
  switch (key) {
    case "theme":
      settings.theme = value;
      break;
    case "font":
      settings.font = value;
      break;
    case "base_currency":
      settings.baseCurrency = value;
      break;
    case "timezone":
      settings.timezone = value;
      break;
    case "instance_id":
      settings.instanceId = value;
      break;
    case "onboarding_completed":
      settings.onboardingCompleted = parseBoolean(value, false);
      break;
    case "auto_update_check_enabled":
      settings.autoUpdateCheckEnabled = parseBoolean(value, true);
      break;
    case "menu_bar_visible":
      settings.menuBarVisible = parseBoolean(value, true);
      break;
    case "sync_enabled":
      settings.syncEnabled = parseBoolean(value, true);
      break;
  }
}

function stringifySettingValue(key: SettingsKey, value: string | boolean): string {
  if (key === "timezone") {
    return canonicalizeTimezone(String(value));
  }
  return String(value);
}

function defaultSettingValue(key: string): string | undefined {
  switch (key) {
    case "theme":
      return "light";
    case "font":
      return "font-mono";
    case "timezone":
      return "";
    case "onboarding_completed":
      return "false";
    case "auto_update_check_enabled":
      return "true";
    case "menu_bar_visible":
      return "true";
    case "sync_enabled":
      return "true";
    default:
      return undefined;
  }
}

function parseBoolean(value: string, defaultValue: boolean): boolean {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return defaultValue;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
