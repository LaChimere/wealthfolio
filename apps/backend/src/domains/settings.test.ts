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

  test("updates only provided settings and canonicalizes timezones", () => {
    const db = createSettingsDb();
    const service = createSettingsService(db);

    try {
      expect(
        service.updateSettings({
          baseCurrency: "CAD",
          timezone: "America/Toronto",
          onboardingCompleted: true,
          syncEnabled: false,
        }),
      ).toEqual({
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

  test("rejects invalid timezone updates before writing", () => {
    const db = createSettingsDb();
    const service = createSettingsService(db);

    try {
      expect(() => service.updateSettings({ timezone: "not-a-timezone" })).toThrow(
        "Invalid timezone: not-a-timezone",
      );
      expect(getSetting(db, "timezone")).toBe("");
    } finally {
      db.close();
    }
  });

  test("reports auto-update preference with missing setting default", () => {
    const db = createSettingsDb();
    const service = createSettingsService(db);

    try {
      expect(service.isAutoUpdateCheckEnabled()).toBe(true);
      service.updateSettings({ autoUpdateCheckEnabled: false });
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
  `);
  return db;
}
