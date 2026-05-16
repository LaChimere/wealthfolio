import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import {
  type AiMessageSyncEvent,
  createAiChatService,
  type AiThreadSyncEvent,
  type AiThreadTagSyncEvent,
} from "./ai-chat";

type SyncEvent =
  | { entity: "thread"; event: AiThreadSyncEvent }
  | { entity: "message"; event: AiMessageSyncEvent }
  | { entity: "tag"; event: AiThreadTagSyncEvent };

describe("TS AI chat domain", () => {
  test("lists threads with Rust-compatible ordering, limits, cursor, search, and tags", () => {
    const db = createAiChatDb();
    const service = createAiChatService(db);

    try {
      seedThread(db, {
        id: "thread-a",
        title: "Budget planning",
        updatedAt: "2026-01-02T00:00:00Z",
      });
      seedThread(db, {
        id: "thread-b",
        title: "Portfolio review",
        updatedAt: "2026-01-03T00:00:00Z",
      });
      seedThread(db, {
        id: "thread-pinned",
        title: "Pinned",
        isPinned: true,
        updatedAt: "2026-01-01T00:00:00Z",
      });
      seedTag(db, "thread-pinned", "favorite");

      const firstPage = service.listThreads({ limit: 2 });
      expect(firstPage).toMatchObject({
        hasMore: true,
        threads: [
          { id: "thread-pinned", tags: ["favorite"], isPinned: true },
          { id: "thread-b", tags: [], isPinned: false },
        ],
      });
      expect(firstPage.nextCursor).toBe("0:2026-01-03T00:00:00Z:thread-b");

      expect(service.listThreads({ cursor: firstPage.nextCursor ?? "" })).toMatchObject({
        hasMore: false,
        nextCursor: null,
        threads: [{ id: "thread-a" }],
      });
      expect(service.listThreads({ limit: 0 })).toMatchObject({
        hasMore: true,
        nextCursor: null,
        threads: [],
      });
      expect(service.listThreads({ search: "budget" })).toMatchObject({
        threads: [{ id: "thread-a" }],
      });
      expect(service.getThread("thread-pinned")).toMatchObject({
        id: "thread-pinned",
        tags: [],
      });
      expect(() => service.listThreads({ cursor: "" })).toThrow("Expected format");
    } finally {
      db.close();
    }
  });

  test("persists thread tags with Rust-compatible idempotency", () => {
    const db = createAiChatDb();
    const service = createAiChatService(db);

    try {
      seedThread(db, {
        id: "thread-a",
        title: "Budget planning",
        updatedAt: "2026-01-03T00:00:00Z",
      });
      seedThread(db, {
        id: "thread-b",
        title: "Portfolio review",
        updatedAt: "2026-01-02T00:00:00Z",
      });

      service.addTag("thread-a", "favorite");
      service.addTag("thread-a", "favorite");
      service.addTag("thread-a", "planning");
      service.addTag("thread-b", "favorite");

      expect(service.getTags("thread-a")).toEqual(["favorite", "planning"]);
      expect(service.getTags("missing")).toEqual([]);
      expect(service.listThreads({ limit: 10 })).toMatchObject({
        threads: [
          { id: "thread-a", tags: ["favorite", "planning"] },
          { id: "thread-b", tags: ["favorite"] },
        ],
      });
      expect(service.getThread("thread-a")).toMatchObject({ id: "thread-a", tags: [] });

      service.removeTag("thread-a", "missing");
      service.removeTag("thread-a", "favorite");
      expect(service.getTags("thread-a")).toEqual(["planning"]);
      expect(() => service.addTag("missing", "orphan")).toThrow();
    } finally {
      db.close();
    }
  });

  test("updates and deletes threads with missing-thread parity", async () => {
    const db = createAiChatDb();
    const service = createAiChatService(db);

    try {
      seedThread(db, { id: "thread-1", title: "Original" });
      seedMessage(db, {
        id: "message-1",
        threadId: "thread-1",
        role: "user",
        content: { schemaVersion: 1, parts: [{ type: "text", content: "Hello" }] },
      });

      expect(service.updateThread("thread-1", {})).toMatchObject({
        id: "thread-1",
        title: "Original",
        isPinned: false,
      });
      expect(service.updateThread("thread-1", { title: "Updated", isPinned: true })).toMatchObject({
        id: "thread-1",
        title: "Updated",
        isPinned: true,
      });
      expect(() => service.updateThread("missing", { title: "Missing" })).toThrow(
        "Thread missing not found",
      );

      await service.deleteThread("thread-1");
      expect(service.getThread("thread-1")).toBeNull();
      expect(service.getMessages("thread-1")).toEqual([]);
      await expect(service.deleteThread("thread-1")).resolves.toBeUndefined();
    } finally {
      db.close();
    }
  });

  test("reads messages and merges tool result patches", () => {
    const db = createAiChatDb();
    const service = createAiChatService(db);

    try {
      seedThread(db, { id: "thread-1", title: "Tools" });
      seedMessage(db, {
        id: "message-1",
        threadId: "thread-1",
        role: "assistant",
        content: {
          schemaVersion: 1,
          parts: [
            { type: "text", content: "Done" },
            {
              type: "toolResult",
              toolCallId: "tool-1",
              success: true,
              data: { status: "pending" },
              meta: { existing: true },
            },
          ],
        },
      });

      expect(service.getMessages("thread-1")).toEqual([
        expect.objectContaining({ id: "message-1", role: "assistant" }),
      ]);

      const updated = service.updateToolResult({
        threadId: "thread-1",
        toolCallId: "tool-1",
        resultPatch: { status: "submitted", activityId: "activity-1" },
      });
      expect(updated).toMatchObject({
        id: "message-1",
        content: {
          parts: [
            { type: "text" },
            {
              type: "toolResult",
              data: { status: "submitted", activityId: "activity-1" },
              meta: { existing: true, status: "submitted", activityId: "activity-1" },
            },
          ],
        },
      });
      expect(() =>
        service.updateToolResult({
          threadId: "thread-1",
          toolCallId: "missing-tool",
          resultPatch: {},
        }),
      ).toThrow("Tool result not found");
    } finally {
      db.close();
    }
  });

  test("queues AI chat thread, message, and tag sync callbacks for local mutations", async () => {
    const db = createAiChatDb();
    const syncEvents: SyncEvent[] = [];
    const service = createAiChatService(db, {
      queueThreadSyncEvent: (event) => syncEvents.push({ entity: "thread", event }),
      queueMessageSyncEvent: (event) => syncEvents.push({ entity: "message", event }),
      queueThreadTagSyncEvent: (event) => syncEvents.push({ entity: "tag", event }),
    });

    try {
      seedThread(db, { id: "thread-1", title: "Tools" });
      seedMessage(db, {
        id: "message-1",
        threadId: "thread-1",
        role: "assistant",
        content: {
          schemaVersion: 1,
          parts: [
            {
              type: "toolResult",
              toolCallId: "tool-1",
              success: true,
              data: { status: "pending" },
            },
          ],
        },
      });

      service.addTag("thread-1", "favorite");
      service.addTag("thread-1", "favorite");
      const tagId = readThreadTagId(db, "thread-1", "favorite");
      expect(syncEvents).toEqual([
        {
          entity: "tag",
          event: expect.objectContaining({
            tagId,
            operation: "Create",
            payload: expect.objectContaining({
              id: tagId,
              threadId: "thread-1",
              tag: "favorite",
            }),
          }),
        },
      ]);

      syncEvents.length = 0;
      service.updateThread("thread-1", { title: "Updated", isPinned: true });
      service.updateToolResult({
        threadId: "thread-1",
        toolCallId: "tool-1",
        resultPatch: { status: "submitted" },
      });
      service.removeTag("thread-1", "favorite");
      await service.deleteThread("thread-1");

      expect(syncEvents).toEqual([
        {
          entity: "thread",
          event: expect.objectContaining({
            threadId: "thread-1",
            operation: "Update",
            payload: expect.objectContaining({
              id: "thread-1",
              title: "Updated",
              isPinned: 1,
            }),
          }),
        },
        {
          entity: "message",
          event: expect.objectContaining({
            messageId: "message-1",
            operation: "Update",
            payload: expect.objectContaining({
              id: "message-1",
              threadId: "thread-1",
              contentJson: expect.stringContaining("submitted"),
            }),
          }),
        },
        {
          entity: "tag",
          event: {
            tagId,
            operation: "Delete",
            payload: { id: tagId },
          },
        },
        {
          entity: "thread",
          event: {
            threadId: "thread-1",
            operation: "Delete",
            payload: { id: "thread-1" },
          },
        },
      ]);
    } finally {
      db.close();
    }
  });

  test("reports streaming as a bounded deferred runtime", async () => {
    const db = createAiChatDb();
    const service = createAiChatService(db);

    try {
      await expect(service.sendMessage({ message: "hello" })).rejects.toMatchObject({
        code: "not_implemented",
        status: 501,
      });
    } finally {
      db.close();
    }
  });
});

function createAiChatDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE ai_threads (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT,
      config_snapshot TEXT,
      is_pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE ai_messages (
      id TEXT PRIMARY KEY NOT NULL,
      thread_id TEXT NOT NULL REFERENCES ai_threads(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE ai_thread_tags (
      id TEXT PRIMARY KEY NOT NULL,
      thread_id TEXT NOT NULL REFERENCES ai_threads(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(thread_id, tag)
    );
  `);
  return db;
}

function seedThread(
  db: Database,
  thread: {
    id: string;
    title: string;
    isPinned?: boolean;
    updatedAt?: string;
  },
): void {
  const createdAt = "2026-01-01T00:00:00Z";
  db.prepare(
    `
      INSERT INTO ai_threads (
        id, title, config_snapshot, is_pinned, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `,
  ).run(
    thread.id,
    thread.title,
    JSON.stringify({ schemaVersion: 1, providerId: "ollama" }),
    thread.isPinned ? 1 : 0,
    createdAt,
    thread.updatedAt ?? createdAt,
  );
}

function seedMessage(
  db: Database,
  message: {
    id: string;
    threadId: string;
    role: string;
    content: unknown;
  },
): void {
  db.prepare(
    `
      INSERT INTO ai_messages (id, thread_id, role, content_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `,
  ).run(
    message.id,
    message.threadId,
    message.role,
    JSON.stringify(message.content),
    "2026-01-01T00:00:00Z",
  );
}

function seedTag(db: Database, threadId: string, tag: string): void {
  db.prepare(
    `
      INSERT INTO ai_thread_tags (id, thread_id, tag, created_at)
      VALUES (?, ?, ?, ?)
    `,
  ).run(`${threadId}-${tag}`, threadId, tag, "2026-01-01T00:00:00Z");
}

function readThreadTagId(db: Database, threadId: string, tag: string): string {
  const row = db
    .query<
      { id: string },
      [string, string]
    >("SELECT id FROM ai_thread_tags WHERE thread_id = ? AND tag = ?")
    .get(threadId, tag);
  if (!row) {
    throw new Error(`missing tag ${threadId}:${tag}`);
  }
  return row.id;
}
