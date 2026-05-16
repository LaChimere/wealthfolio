import type { Database } from "bun:sqlite";

export const AI_CHAT_ERROR_STATUS_BY_CODE: Record<string, number> = {
  INVALID_INPUT: 400,
  MISSING_API_KEY: 400,
  PROVIDER_ERROR: 502,
  TOOL_NOT_FOUND: 400,
  TOOL_NOT_ALLOWED: 403,
  TOOL_EXECUTION_FAILED: 500,
  THREAD_NOT_FOUND: 404,
  INVALID_CURSOR: 400,
  CORE_ERROR: 500,
  INTERNAL_ERROR: 500,
  invalid_input: 400,
  missing_api_key: 400,
  provider_error: 502,
  tool_not_found: 400,
  tool_not_allowed: 403,
  tool_execution_failed: 500,
  thread_not_found: 404,
  invalid_cursor: 400,
  core_error: 500,
  internal_error: 500,
  not_found: 404,
};

export interface AiChatServiceErrorShape {
  code?: string;
  error?: string;
  message?: string;
  status?: number;
}

export interface AiChatListThreadsRequest {
  cursor?: string;
  limit?: number;
  search?: string;
}

export interface AiChatUpdateThreadRequest {
  title?: string;
  isPinned?: boolean;
}

export interface AiChatUpdateToolResultRequest {
  threadId: string;
  toolCallId: string;
  resultPatch: unknown;
}

export interface AiChatThread extends Record<string, unknown> {
  id: string;
  title: string | null;
  isPinned: boolean;
  tags: string[];
  config: unknown | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiChatMessage extends Record<string, unknown> {
  id: string;
  threadId: string;
  role: string;
  content: AiChatMessageContent;
  createdAt: string;
}

export interface AiChatMessageContent {
  schemaVersion: number;
  parts: AiChatMessagePart[];
  truncated?: boolean;
}

export interface AiChatMessagePart extends Record<string, unknown> {
  type: string;
}

export interface AiChatThreadPage {
  threads: AiChatThread[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface AiChatService {
  sendMessage(
    request: Record<string, unknown>,
  ): Promise<AsyncIterable<unknown>> | AsyncIterable<unknown>;
  listThreads(request: AiChatListThreadsRequest): Promise<unknown> | unknown;
  getThread(
    threadId: string,
  ): Promise<Record<string, unknown> | null> | Record<string, unknown> | null;
  getMessages(threadId: string): Promise<unknown[]> | unknown[];
  getTags(threadId: string): Promise<string[]> | string[];
  addTag(threadId: string, tag: string): Promise<void> | void;
  removeTag(threadId: string, tag: string): Promise<void> | void;
  updateThread(threadId: string, request: AiChatUpdateThreadRequest): Promise<unknown> | unknown;
  deleteThread(threadId: string): Promise<void> | void;
  updateToolResult(request: AiChatUpdateToolResultRequest): Promise<unknown> | unknown;
}

interface AiThreadRow {
  id: string;
  title: string | null;
  config_snapshot: string | null;
  is_pinned: number | boolean;
  created_at: string;
  updated_at: string;
}

interface AiMessageRow {
  id: string;
  thread_id: string;
  role: string;
  content_json: string;
  created_at: string;
}

const DEFAULT_THREAD_LIMIT = 20;
const MAX_THREAD_LIMIT = 100;

export function createAiChatService(db: Database): AiChatService {
  return {
    async sendMessage() {
      throw aiChatError(
        "not_implemented",
        "AI chat streaming is not yet available in the TS backend runtime",
        501,
      );
    },
    listThreads(request) {
      return listThreads(db, request);
    },
    getThread(threadId) {
      const row = readThreadRow(db, threadId);
      return row ? threadFromRow(row, []) : null;
    },
    getMessages(threadId) {
      return db
        .query<AiMessageRow, [string]>(
          `
            SELECT id, thread_id, role, content_json, created_at
            FROM ai_messages
            WHERE thread_id = ?
            ORDER BY created_at ASC
          `,
        )
        .all(threadId)
        .map(messageFromRow);
    },
    getTags(threadId) {
      return loadThreadTagList(db, threadId);
    },
    addTag(threadId, tag) {
      db.prepare(
        `
          INSERT OR IGNORE INTO ai_thread_tags (id, thread_id, tag, created_at)
          VALUES (?, ?, ?, ?)
        `,
      ).run(crypto.randomUUID(), threadId, tag, timestampNow());
    },
    removeTag(threadId, tag) {
      db.prepare("DELETE FROM ai_thread_tags WHERE thread_id = ? AND tag = ?").run(threadId, tag);
    },
    updateThread(threadId, request) {
      const existing = readThreadRow(db, threadId);
      if (!existing) {
        throw aiChatError("thread_not_found", `Thread ${threadId} not found`, 404);
      }

      const nextTitle =
        request.title !== undefined && request.title !== null ? request.title : existing.title;
      const nextIsPinned =
        request.isPinned !== undefined && request.isPinned !== null
          ? request.isPinned
          : intToBool(existing.is_pinned);

      if (nextTitle === existing.title && nextIsPinned === intToBool(existing.is_pinned)) {
        return threadFromRow(existing, []);
      }

      const updatedAt = timestampNow();
      db.prepare(
        `
          UPDATE ai_threads
          SET title = ?, is_pinned = ?, updated_at = ?
          WHERE id = ?
        `,
      ).run(nextTitle, boolToInt(nextIsPinned), updatedAt, threadId);
      return threadFromRow(readRequiredThreadRow(db, threadId), []);
    },
    async deleteThread(threadId) {
      db.transaction(() => {
        db.prepare("DELETE FROM ai_messages WHERE thread_id = ?").run(threadId);
        db.prepare("DELETE FROM ai_thread_tags WHERE thread_id = ?").run(threadId);
        db.prepare("DELETE FROM ai_threads WHERE id = ?").run(threadId);
      })();
    },
    updateToolResult(request) {
      return updateToolResult(db, request);
    },
  };
}

function listThreads(db: Database, request: AiChatListThreadsRequest): AiChatThreadPage {
  const limit = Math.min(request.limit ?? DEFAULT_THREAD_LIMIT, MAX_THREAD_LIMIT);
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  const search = request.search?.trim();
  if (search) {
    clauses.push("title LIKE ?");
    params.push(`%${search}%`);
  }

  const cursor = request.cursor;
  if (cursor !== undefined) {
    const parsed = parseThreadCursor(cursor);
    clauses.push(
      `
        (
          is_pinned < ?
          OR (is_pinned = ? AND updated_at < ?)
          OR (is_pinned = ? AND updated_at = ? AND id < ?)
        )
      `,
    );
    params.push(
      parsed.isPinned,
      parsed.isPinned,
      parsed.updatedAt,
      parsed.isPinned,
      parsed.updatedAt,
      parsed.id,
    );
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .query<AiThreadRow, [...Array<string | number>, number]>(
      `
        SELECT id, title, config_snapshot, is_pinned, created_at, updated_at
        FROM ai_threads
        ${whereClause}
        ORDER BY is_pinned DESC, updated_at DESC, id DESC
        LIMIT ?
      `,
    )
    .all(...params, limit + 1);

  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const tagMap = loadThreadTags(
    db,
    pageRows.map((row) => row.id),
  );
  const threads = pageRows.map((row) => threadFromRow(row, tagMap.get(row.id) ?? []));
  return {
    threads,
    nextCursor: hasMore
      ? pageRows.at(-1)
        ? encodeThreadCursor(pageRows.at(-1) as AiThreadRow)
        : null
      : null,
    hasMore,
  };
}

function updateToolResult(db: Database, request: AiChatUpdateToolResultRequest): AiChatMessage {
  const messages = db
    .query<AiMessageRow, [string]>(
      `
        SELECT id, thread_id, role, content_json, created_at
        FROM ai_messages
        WHERE thread_id = ?
        ORDER BY created_at ASC
      `,
    )
    .all(request.threadId);

  for (const row of messages) {
    const message = messageFromRow(row);
    const part = message.content.parts.find(
      (candidate) => candidate.type === "toolResult" && candidate.toolCallId === request.toolCallId,
    );
    if (!part) {
      continue;
    }

    if (isRecord(request.resultPatch)) {
      if (isRecord(part.data)) {
        part.data = { ...part.data, ...request.resultPatch };
      }
      const existingMeta = isRecord(part.meta) ? part.meta : {};
      part.meta = { ...existingMeta, ...request.resultPatch };
    }

    db.prepare("UPDATE ai_messages SET content_json = ? WHERE id = ?").run(
      JSON.stringify(message.content),
      message.id,
    );
    return message;
  }

  throw aiChatError(
    "invalid_input",
    `Tool result not found for tool_call_id: ${request.toolCallId}`,
    400,
  );
}

function loadThreadTags(db: Database, threadIds: string[]): Map<string, string[]> {
  const tags = new Map<string, string[]>();
  for (const threadId of threadIds) {
    tags.set(threadId, loadThreadTagList(db, threadId));
  }
  return tags;
}

function loadThreadTagList(db: Database, threadId: string): string[] {
  return db
    .query<{ tag: string }, [string]>(
      `
        SELECT tag
        FROM ai_thread_tags
        WHERE thread_id = ?
      `,
    )
    .all(threadId)
    .map((row) => row.tag);
}

function readThreadRow(db: Database, threadId: string): AiThreadRow | null {
  return (
    db
      .query<AiThreadRow, [string]>(
        `
          SELECT id, title, config_snapshot, is_pinned, created_at, updated_at
          FROM ai_threads
          WHERE id = ?
        `,
      )
      .get(threadId) ?? null
  );
}

function readRequiredThreadRow(db: Database, threadId: string): AiThreadRow {
  const row = readThreadRow(db, threadId);
  if (!row) {
    throw aiChatError("thread_not_found", `Thread ${threadId} not found`, 404);
  }
  return row;
}

function threadFromRow(row: AiThreadRow, tags: string[]): AiChatThread {
  return {
    id: row.id,
    title: row.title,
    isPinned: intToBool(row.is_pinned),
    tags,
    config: parseJsonOrNull(row.config_snapshot),
    createdAt: parseTimestampOrNow(row.created_at),
    updatedAt: parseTimestampOrNow(row.updated_at),
  };
}

function messageFromRow(row: AiMessageRow): AiChatMessage {
  return {
    id: row.id,
    threadId: row.thread_id,
    role: normalizeRole(row.role),
    content: parseMessageContent(row.content_json),
    createdAt: parseTimestampOrNow(row.created_at),
  };
}

function parseMessageContent(contentJson: string): AiChatMessageContent {
  const parsed = parseJsonOrNull(contentJson);
  if (!isRecord(parsed) || !Array.isArray(parsed.parts)) {
    throw aiChatError("invalid_input", "Invalid AI message content JSON", 400);
  }
  const schemaVersion =
    typeof parsed.schemaVersion === "number" && Number.isInteger(parsed.schemaVersion)
      ? parsed.schemaVersion
      : 1;
  return {
    schemaVersion,
    parts: parsed.parts.filter(isRecord) as AiChatMessagePart[],
    ...(parsed.truncated === true ? { truncated: true } : {}),
  };
}

function parseThreadCursor(cursor: string): { isPinned: number; updatedAt: string; id: string } {
  const firstSeparator = cursor.indexOf(":");
  const lastSeparator = cursor.lastIndexOf(":");
  if (firstSeparator <= 0 || lastSeparator <= firstSeparator) {
    throw aiChatError(
      "invalid_cursor",
      `Expected format 'is_pinned:updated_at:id', got '${cursor}'`,
      400,
    );
  }
  const isPinned = Number(cursor.slice(0, firstSeparator));
  if (!Number.isInteger(isPinned)) {
    throw aiChatError(
      "invalid_cursor",
      `Invalid is_pinned value: ${cursor.slice(0, firstSeparator)}`,
      400,
    );
  }
  return {
    isPinned,
    updatedAt: cursor.slice(firstSeparator + 1, lastSeparator),
    id: cursor.slice(lastSeparator + 1),
  };
}

function encodeThreadCursor(row: AiThreadRow): string {
  return `${boolToInt(intToBool(row.is_pinned))}:${row.updated_at}:${row.id}`;
}

function normalizeRole(role: string): string {
  const normalized = role.toLowerCase();
  if (
    normalized === "user" ||
    normalized === "assistant" ||
    normalized === "system" ||
    normalized === "tool"
  ) {
    return normalized;
  }
  throw aiChatError("invalid_input", `Unknown role: ${role}`, 400);
}

function parseJsonOrNull(value: string | null): unknown {
  if (value === null) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function intToBool(value: number | boolean): boolean {
  return value === true || value === 1;
}

function boolToInt(value: boolean): number {
  return value ? 1 : 0;
}

function parseTimestampOrNow(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? timestampNow() : parsed.toISOString();
}

function timestampNow(): string {
  return new Date().toISOString();
}

function aiChatError(
  code: string,
  message: string,
  status?: number,
): Error & AiChatServiceErrorShape {
  const error = new Error(message) as Error & AiChatServiceErrorShape;
  error.code = code;
  error.error = message;
  error.status = status;
  return error;
}
