import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { createActivityService } from "./activities";

describe("TS activities import domain", () => {
  test("returns Rust-compatible default import mapping with legacy context normalization", async () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);

    try {
      const mapping = await service.getImportMapping?.("account-1", "ACTIVITY");

      expect(mapping).toMatchObject({
        accountId: "account-1",
        contextKind: "CSV_ACTIVITY",
        name: "",
        fieldMappings: {
          date: "date",
          symbol: "symbol",
          quantity: "quantity",
          activityType: "activityType",
        },
        activityMappings: {
          BUY: ["BUY"],
          SELL: ["SELL"],
          ADJUSTMENT: ["ADJUSTMENT"],
        },
      });
      expect(mapping?.templateId).toBeUndefined();
    } finally {
      db.close();
    }
  });

  test("saves account-local import mappings and preserves link identity on updates", async () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);

    try {
      const first = await service.saveImportMapping?.({
        accountId: "account-1",
        importType: "HOLDINGS",
        name: "Holdings CSV",
        fieldMappings: { symbol: ["Ticker", "Symbol"], quantity: "Qty" },
        activityMappings: { BUY: ["Buy"] },
        symbolMappings: { BRK_B: "BRK-B" },
        accountMappings: { External: "account-1" },
        symbolMappingMeta: { BRK_B: { exchangeMic: "XNYS", symbolName: "Berkshire" } },
        parseConfig: { delimiter: ",", hasHeaderRow: true },
      });
      const linkId = readLinkId(db, "account-1", "CSV_HOLDINGS");

      expect(first).toMatchObject({
        accountId: "account-1",
        contextKind: "CSV_HOLDINGS",
        name: "Holdings CSV",
      });
      expect(readLinkedTemplateId(db, "account-1", "CSV_HOLDINGS")).toBe("acct_account-1_holdings");
      expect(JSON.parse(readTemplateConfig(db, "acct_account-1_holdings"))).toEqual({
        fieldMappings: { symbol: ["Ticker", "Symbol"], quantity: "Qty" },
        activityMappings: { BUY: ["Buy"] },
        symbolMappings: { BRK_B: "BRK-B" },
        accountMappings: { External: "account-1" },
        symbolMappingMeta: { BRK_B: { exchangeMic: "XNYS", symbolName: "Berkshire" } },
        parseConfig: { delimiter: ",", hasHeaderRow: true },
      });

      await service.saveImportMapping?.({
        accountId: "account-1",
        contextKind: "CSV_HOLDINGS",
        name: "Holdings CSV v2",
        fieldMappings: { symbol: "Symbol" },
      });

      expect(readLinkId(db, "account-1", "CSV_HOLDINGS")).toBe(linkId);
      expect((await service.getImportMapping?.("account-1", "CSV_HOLDINGS"))?.name).toBe(
        "Holdings CSV v2",
      );
    } finally {
      db.close();
    }
  });

  test("relinks shared templates to account-local mappings without changing link row identity", async () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);

    try {
      await service.saveImportTemplate?.({
        id: "system_like",
        name: "Shared",
        scope: "SYSTEM",
        kind: "CSV_ACTIVITY",
        fieldMappings: { date: "Date" },
      });
      await service.linkAccountTemplate?.("account-1", "system_like", "ACTIVITY");
      const linkId = readLinkId(db, "account-1", "CSV_ACTIVITY");

      await service.saveImportMapping?.({
        accountId: "account-1",
        contextKind: "ACTIVITY",
        name: "Account CSV",
        fieldMappings: { date: "Trade Date" },
      });

      expect(readLinkId(db, "account-1", "CSV_ACTIVITY")).toBe(linkId);
      expect(readLinkedTemplateId(db, "account-1", "CSV_ACTIVITY")).toBe("acct_account-1");
      expect((await service.getImportMapping?.("account-1", "ACTIVITY"))?.fieldMappings).toEqual({
        date: "Trade Date",
      });
    } finally {
      db.close();
    }
  });

  test("lists, reads, saves, links, and deletes import templates with Rust-compatible scope and kind behavior", async () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);

    try {
      insertTemplate(db, {
        id: "broker",
        name: "Broker",
        scope: "SYSTEM",
        kind: "BROKER_ACTIVITY",
      });
      insertTemplate(db, {
        id: "system",
        name: "System",
        scope: "SYSTEM",
        kind: "CSV_ACTIVITY",
      });
      insertTemplate(db, {
        id: "user_upper",
        name: "Upper",
        scope: "USER",
        kind: "CSV_HOLDINGS",
      });
      insertTemplate(db, {
        id: "user_lower",
        name: "Lower",
        scope: "user",
        kind: "CSV_ACTIVITY",
      });

      expect((await service.listImportTemplates?.())?.map((template) => template.id)).toEqual([
        "system",
        "user_upper",
        "user_lower",
      ]);
      expect(await service.getImportTemplate?.("missing")).toMatchObject({
        id: "missing",
        scope: "USER",
        kind: "CSV_ACTIVITY",
        fieldMappings: expect.objectContaining({ date: "date" }),
      });

      const saved = await service.saveImportTemplate?.({
        id: "custom",
        name: "Custom",
        scope: "USER",
        kind: "CSV_HOLDINGS",
        fieldMappings: { symbol: "Ticker" },
        parseConfig: { delimiter: ";" },
      });
      expect(saved).toMatchObject({ id: "custom", kind: "CSV_HOLDINGS" });
      await service.linkAccountTemplate?.("account-2", "custom", "HOLDINGS");
      expect(readLinkedTemplateId(db, "account-2", "CSV_HOLDINGS")).toBe("custom");

      await service.deleteImportTemplate?.("custom");
      expect(readLinkedTemplateId(db, "account-2", "CSV_HOLDINGS")).toBeNull();
    } finally {
      db.close();
    }
  });

  test("checks existing duplicate idempotency keys with empty input and chunked lookups", async () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);

    try {
      insertActivity(db, "activity-1", "key-1");
      insertActivity(db, "activity-2", "key-2");
      insertActivity(db, "activity-null", null);

      expect(await service.checkExistingDuplicates?.([])).toEqual({});
      expect(
        await service.checkExistingDuplicates?.([
          "missing",
          ...Array.from({ length: 500 }, (_, index) => `other-${index}`),
          "key-2",
          "key-1",
        ]),
      ).toEqual({ "key-1": "activity-1", "key-2": "activity-2" });
    } finally {
      db.close();
    }
  });
});

function createActivitiesDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE import_templates (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL DEFAULT 'USER',
      kind TEXT NOT NULL DEFAULT 'CSV_ACTIVITY',
      source_system TEXT NOT NULL DEFAULT '',
      config_version INTEGER NOT NULL DEFAULT 1,
      config TEXT NOT NULL DEFAULT '{}',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE import_account_templates (
      id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL,
      context_kind TEXT NOT NULL DEFAULT 'CSV_ACTIVITY',
      source_system TEXT NOT NULL DEFAULT '',
      template_id TEXT NOT NULL REFERENCES import_templates(id) ON DELETE CASCADE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (account_id, context_kind, source_system)
    );

    CREATE TABLE activities (
      id TEXT PRIMARY KEY NOT NULL,
      idempotency_key TEXT
    );

    CREATE UNIQUE INDEX ux_activities_idempotency_key
    ON activities(idempotency_key)
    WHERE idempotency_key IS NOT NULL;
  `);
  return db;
}

function insertTemplate(
  db: Database,
  template: { id: string; name: string; scope: string; kind: string },
): void {
  db.query(
    `
      INSERT INTO import_templates (
        id, name, scope, kind, source_system, config_version, config, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, '', 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
  ).run(
    template.id,
    template.name,
    template.scope,
    template.kind,
    JSON.stringify({
      fieldMappings: { date: "Date" },
      activityMappings: { BUY: ["Buy"] },
      symbolMappings: {},
      accountMappings: {},
      symbolMappingMeta: {},
      parseConfig: { delimiter: "," },
    }),
  );
}

function insertActivity(db: Database, id: string, idempotencyKey: string | null): void {
  db.query("INSERT INTO activities (id, idempotency_key) VALUES (?, ?)").run(id, idempotencyKey);
}

function readLinkId(db: Database, accountId: string, contextKind: string): string | null {
  return readLinkValue(db, accountId, contextKind, "id");
}

function readLinkedTemplateId(db: Database, accountId: string, contextKind: string): string | null {
  return readLinkValue(db, accountId, contextKind, "template_id");
}

function readLinkValue(
  db: Database,
  accountId: string,
  contextKind: string,
  column: "id" | "template_id",
): string | null {
  const row = db
    .query<
      { value: string },
      [string, string]
    >(`SELECT ${column} AS value FROM import_account_templates WHERE account_id = ? AND context_kind = ?`)
    .get(accountId, contextKind);
  return row?.value ?? null;
}

function readTemplateConfig(db: Database, templateId: string): string {
  const row = db
    .query<{ config: string }, [string]>("SELECT config FROM import_templates WHERE id = ?")
    .get(templateId);
  if (!row) {
    throw new Error(`Missing template ${templateId}`);
  }
  return row.config;
}
