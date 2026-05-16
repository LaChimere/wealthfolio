import type { Database } from "bun:sqlite";

export type SyncOutboxOperation = "Create" | "Update" | "Delete";

export interface SyncOutboxQueueEvent {
  entity: string;
  entityId: string;
  operation: SyncOutboxOperation;
  payload: unknown;
}

export interface SyncOutboxQueue {
  queueSyncEvent(event: SyncOutboxQueueEvent): string;
}

interface SyncDeviceConfigRow {
  device_id: string;
  key_version: number | null;
}

const SYNC_ENTITY_BY_EVENT_ENTITY: Record<string, string> = {
  accounts: "account",
  assets: "asset",
  quotes: "quote",
  asset_taxonomy_assignments: "asset_taxonomy_assignment",
  activities: "activity",
  import_account_templates: "activity_import_profile",
  import_templates: "import_template",
  goals: "goal",
  goal_plans: "goal_plan",
  goals_allocation: "goals_allocation",
  ai_threads: "ai_thread",
  ai_messages: "ai_message",
  ai_thread_tags: "ai_thread_tag",
  contribution_limits: "contribution_limit",
  platforms: "platform",
  holdings_snapshots: "snapshot",
  taxonomies: "custom_taxonomy",
  market_data_custom_providers: "custom_provider",
  import_runs: "import_run",
};

export function createSyncOutboxQueue(db: Database): SyncOutboxQueue {
  return {
    queueSyncEvent(event) {
      return insertSyncOutboxEvent(db, event);
    },
  };
}

export function insertSyncOutboxEvent(db: Database, event: SyncOutboxQueueEvent): string {
  const eventId = uuidV7();
  const clientTimestamp = timestampNow();
  const createdAt = timestampNow();
  const entity = syncEntityName(event.entity);
  const operation = syncOperationName(event.operation);
  const payload = JSON.stringify(normalizeOutboxPayload(event.payload));
  const payloadKeyVersion = resolvePayloadKeyVersion(db);
  const deviceId = resolveLocalDeviceId(db);

  db.prepare(
    `
      INSERT INTO sync_outbox (
        event_id, entity, entity_id, op, client_timestamp, payload,
        payload_key_version, sent, status, retry_count, next_retry_at,
        last_error, last_error_code, device_id, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'pending', 0, NULL, NULL, NULL, ?, ?)
    `,
  ).run(
    eventId,
    entity,
    event.entityId,
    operation,
    clientTimestamp,
    payload,
    payloadKeyVersion,
    deviceId,
    createdAt,
  );
  upsertSyncEntityMetadata(db, {
    entity,
    entityId: event.entityId,
    eventId,
    clientTimestamp,
    operation,
  });
  return eventId;
}

function upsertSyncEntityMetadata(
  db: Database,
  input: {
    entity: string;
    entityId: string;
    eventId: string;
    clientTimestamp: string;
    operation: string;
  },
): void {
  const hasLastOp = tableColumns(db, "sync_entity_metadata").has("last_op");
  if (hasLastOp) {
    db.prepare(
      `
        INSERT INTO sync_entity_metadata (
          entity, entity_id, last_event_id, last_client_timestamp, last_op, last_seq
        )
        VALUES (?, ?, ?, ?, ?, 0)
        ON CONFLICT(entity, entity_id) DO UPDATE SET
          last_event_id = excluded.last_event_id,
          last_client_timestamp = excluded.last_client_timestamp,
          last_op = excluded.last_op
      `,
    ).run(input.entity, input.entityId, input.eventId, input.clientTimestamp, input.operation);
    return;
  }

  db.prepare(
    `
      INSERT INTO sync_entity_metadata (
        entity, entity_id, last_event_id, last_client_timestamp, last_seq
      )
      VALUES (?, ?, ?, ?, 0)
      ON CONFLICT(entity, entity_id) DO UPDATE SET
        last_event_id = excluded.last_event_id,
        last_client_timestamp = excluded.last_client_timestamp
    `,
  ).run(input.entity, input.entityId, input.eventId, input.clientTimestamp);
}

function resolvePayloadKeyVersion(db: Database): number {
  const row =
    db
      .query<{ key_version: number | null }, []>(
        `
          SELECT key_version
          FROM sync_device_config
          WHERE trust_state = 'trusted' AND key_version IS NOT NULL
          ORDER BY last_bootstrap_at DESC
          LIMIT 1
        `,
      )
      .get() ?? null;
  return Math.max(1, row?.key_version ?? 1);
}

function resolveLocalDeviceId(db: Database): string | null {
  const row =
    db
      .query<SyncDeviceConfigRow, []>(
        `
          SELECT device_id, key_version
          FROM sync_device_config
          WHERE trust_state = 'trusted'
          ORDER BY last_bootstrap_at DESC
          LIMIT 1
        `,
      )
      .get() ?? null;
  return row?.device_id ?? null;
}

function syncEntityName(entity: string): string {
  const normalized = entity.trim();
  const mapped = SYNC_ENTITY_BY_EVENT_ENTITY[normalized];
  if (!mapped) {
    throw new Error(`Unsupported sync outbox entity '${entity}'`);
  }
  return mapped;
}

function syncOperationName(operation: SyncOutboxOperation): string {
  switch (operation) {
    case "Create":
      return "create";
    case "Update":
      return "update";
    case "Delete":
      return "delete";
  }
}

function normalizeOutboxPayload(payload: unknown): unknown {
  if (!isRecord(payload)) {
    return payload;
  }
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    const normalizedKey = normalizePayloadKeyToSnakeCase(key);
    const column = normalizedKey.length > 0 ? normalizedKey : key;
    if (Object.hasOwn(normalized, column) && normalized[column] !== value) {
      throw new Error(`Outbox payload maps multiple values to column '${column}'`);
    }
    normalized[column] = value;
  }
  return normalized;
}

function normalizePayloadKeyToSnakeCase(key: string): string {
  return key
    .trim()
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1_$2")
    .replace(/[-\s]+/gu, "_")
    .toLowerCase();
}

function tableColumns(db: Database, tableName: string): Set<string> {
  return new Set(
    db
      .query<{ name: string }, [string]>("SELECT name FROM pragma_table_info(?)")
      .all(tableName)
      .map((row) => row.name),
  );
}

function uuidV7(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const timestamp = BigInt(Date.now());
  bytes[0] = Number((timestamp >> 40n) & 0xffn);
  bytes[1] = Number((timestamp >> 32n) & 0xffn);
  bytes[2] = Number((timestamp >> 24n) & 0xffn);
  bytes[3] = Number((timestamp >> 16n) & 0xffn);
  bytes[4] = Number((timestamp >> 8n) & 0xffn);
  bytes[5] = Number(timestamp & 0xffn);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/u, "$1-$2-$3-$4-$5");
}

function timestampNow(): string {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
