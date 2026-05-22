import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { createSyncOutboxQueue, insertSyncOutboxEvent } from "./sync-outbox";

describe("TS sync outbox queue", () => {
  test("persists Rust-compatible outbox rows and entity metadata", () => {
    const db = createSyncOutboxDb();
    const queue = createSyncOutboxQueue(db);

    try {
      const eventId = queue.queueSyncEvent({
        entity: "goal_plans",
        entityId: "goal-1",
        operation: "Create",
        payload: {
          goalId: "goal-1",
          planKind: "save_up",
          plannerMode: null,
          settingsJson: "{}",
          version: 1,
        },
      });

      expect(eventId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      );
      expect(readOutboxRows(db)).toEqual([
        expect.objectContaining({
          event_id: eventId,
          entity: "goal_plan",
          entity_id: "goal-1",
          op: "create",
          payload_key_version: 7,
          sent: 0,
          status: "pending",
          retry_count: 0,
          device_id: "device-1",
        }),
      ]);
      expect(JSON.parse(String(readOutboxRows(db)[0]?.payload))).toEqual({
        goal_id: "goal-1",
        plan_kind: "save_up",
        planner_mode: null,
        settings_json: "{}",
        version: 1,
      });
      expect(readMetadataRows(db)).toEqual([
        expect.objectContaining({
          entity: "goal_plan",
          entity_id: "goal-1",
          last_event_id: eventId,
          last_op: "create",
          last_seq: 0,
        }),
      ]);

      const updateEventId = queue.queueSyncEvent({
        entity: "goals",
        entityId: "goal-1",
        operation: "Update",
        payload: { id: "goal-1", statusHealth: "on_track" },
      });
      const updateRow = readOutboxRows(db).find((row) => row.event_id === updateEventId);
      expect(JSON.parse(String(updateRow?.payload))).toEqual({
        id: "goal-1",
        status_health: "on_track",
      });
      expect(
        readMetadataRows(db).find((row) => row.entity === "goal" && row.entity_id === "goal-1"),
      ).toMatchObject({
        last_event_id: updateEventId,
        last_op: "update",
      });
    } finally {
      db.close();
    }
  });

  test("rejects unsupported event entities and conflicting payload aliases", () => {
    const db = createSyncOutboxDb();

    try {
      expect(() =>
        insertSyncOutboxEvent(db, {
          entity: "unknown",
          entityId: "row-1",
          operation: "Create",
          payload: { id: "row-1" },
        }),
      ).toThrow("Unsupported sync outbox entity");
      expect(() =>
        insertSyncOutboxEvent(db, {
          entity: "goals",
          entityId: "goal-1",
          operation: "Update",
          payload: { statusHealth: "on_track", status_health: "off_track" },
        }),
      ).toThrow("Outbox payload maps multiple values");
      expect(readOutboxRows(db)).toEqual([]);
    } finally {
      db.close();
    }
  });
});

function createSyncOutboxDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE sync_outbox (
      event_id TEXT PRIMARY KEY NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      op TEXT NOT NULL,
      client_timestamp TEXT NOT NULL,
      payload TEXT NOT NULL,
      payload_key_version INTEGER NOT NULL,
      sent INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      retry_count INTEGER NOT NULL DEFAULT 0,
      next_retry_at TEXT,
      last_error TEXT,
      last_error_code TEXT,
      device_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE sync_entity_metadata (
      entity TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      last_event_id TEXT NOT NULL,
      last_client_timestamp TEXT NOT NULL,
      last_seq BIGINT NOT NULL DEFAULT 0,
      last_op TEXT NOT NULL DEFAULT 'update',
      PRIMARY KEY (entity, entity_id)
    );

    CREATE TABLE sync_device_config (
      device_id TEXT PRIMARY KEY NOT NULL,
      key_version INTEGER,
      trust_state TEXT NOT NULL DEFAULT 'untrusted',
      last_bootstrap_at TEXT
    );

    INSERT INTO sync_device_config (device_id, key_version, trust_state, last_bootstrap_at)
    VALUES ('device-1', 7, 'trusted', '2026-01-01T00:00:00Z');
  `);
  return db;
}

function readOutboxRows(db: Database): Array<Record<string, unknown>> {
  return db
    .query<Record<string, unknown>, []>("SELECT * FROM sync_outbox ORDER BY created_at, event_id")
    .all();
}

function readMetadataRows(db: Database): Array<Record<string, unknown>> {
  return db
    .query<
      Record<string, unknown>,
      []
    >("SELECT * FROM sync_entity_metadata ORDER BY entity, entity_id")
    .all();
}
