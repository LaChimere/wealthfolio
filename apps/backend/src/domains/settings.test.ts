import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import {
  DEFAULT_SETTINGS,
  canonicalizeTimezone,
  createSettingsService,
  getSetting,
} from "./settings";

describe("TS settings domain", () => {
  test("reads settings with Rust-compatible defaults and boolean parsing", () => {
    const db = createSettingsDb();
    db.query("INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)").run(
      "theme",
      "dark",
    );
    db.query("INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)").run(
      "auto_update_check_enabled",
      "not-a-bool",
    );
    const service = createSettingsService(db);

    try {
      expect(service.getSettings()).toEqual({
        ...DEFAULT_SETTINGS,
        theme: "dark",
        autoUpdateCheckEnabled: true,
      });
    } finally {
      db.close();
    }
  });

  test("updates only provided settings and canonicalizes timezones", async () => {
    const db = createSettingsDb();
    const service = createSettingsService(db);

    try {
      await expect(
        service.updateSettings({
          baseCurrency: "CAD",
          timezone: "America/Toronto",
          onboardingCompleted: true,
          syncEnabled: false,
        }),
      ).resolves.toEqual({
        ...DEFAULT_SETTINGS,
        baseCurrency: "CAD",
        timezone: "America/Toronto",
        onboardingCompleted: true,
        syncEnabled: false,
      });
      expect(getSetting(db, "auto_update_check_enabled")).toBe("true");
    } finally {
      db.close();
    }
  });

  test("registers distinct existing currencies when base currency changes", async () => {
    const db = createSettingsDb();
    db.query("INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)").run(
      "base_currency",
      "USD",
    );
    db.query("INSERT INTO accounts (id, currency) VALUES (?, ?), (?, ?), (?, ?)").run(
      "account-cad",
      "CAD",
      "account-usd",
      "USD",
      "account-eur",
      "EUR",
    );
    db.query("INSERT INTO assets (id, kind, quote_ccy) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)").run(
      "fx-gbp-usd",
      "FX",
      "GBP",
      "fx-cad-usd",
      "FX",
      "CAD",
      "asset-ignored",
      "INVESTMENT",
      "CHF",
    );
    const registeredPairs: [string, string][] = [];
    const warnings: string[] = [];
    const service = createSettingsService(db, {
      registerCurrencyPair: async (currency, baseCurrency) => {
        registeredPairs.push([currency, baseCurrency]);
        if (currency === "EUR") {
          throw new Error("provider unavailable");
        }
      },
      warn: (message) => warnings.push(message),
    });

    try {
      await expect(service.updateSettings({ baseCurrency: "JPY" })).resolves.toMatchObject({
        baseCurrency: "JPY",
      });

      expect(registeredPairs).toEqual([
        ["CAD", "JPY"],
        ["EUR", "JPY"],
        ["GBP", "JPY"],
        ["USD", "JPY"],
      ]);
      expect(warnings).toEqual([
        "Failed to register currency pair JPYEUR: provider unavailable. Skipping.",
      ]);
    } finally {
      db.close();
    }
  });

  test("rejects invalid timezone updates before writing", async () => {
    const db = createSettingsDb();
    const service = createSettingsService(db);

    try {
      await expect(service.updateSettings({ timezone: "not-a-timezone" })).rejects.toThrow(
        "Invalid timezone: not-a-timezone",
      );
      expect(getSetting(db, "timezone")).toBe("");
    } finally {
      db.close();
    }
  });

  test("reports auto-update preference with missing setting default", async () => {
    const db = createSettingsDb();
    const service = createSettingsService(db);

    try {
      expect(service.isAutoUpdateCheckEnabled()).toBe(true);
      await service.updateSettings({ autoUpdateCheckEnabled: false });
      expect(service.isAutoUpdateCheckEnabled()).toBe(false);
    } finally {
      db.close();
    }
  });

  test("canonicalizes valid IANA timezones using the platform timezone database", () => {
    expect(canonicalizeTimezone(" America/Toronto ")).toBe("America/Toronto");
    expect(() => canonicalizeTimezone("")).toThrow("Timezone cannot be empty");
  });
});

function createSettingsDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE app_settings (
      setting_key TEXT NOT NULL PRIMARY KEY,
      setting_value TEXT NOT NULL
    );
    CREATE TABLE accounts (
      id TEXT NOT NULL PRIMARY KEY,
      currency TEXT NOT NULL
    );
    CREATE TABLE assets (
      id TEXT NOT NULL PRIMARY KEY,
      kind TEXT NOT NULL,
      quote_ccy TEXT NOT NULL
    );
  `);
  return db;
}
