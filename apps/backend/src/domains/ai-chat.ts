import type { Database } from "bun:sqlite";

import type { AiProviderService, ResolvedAiChatProviderConfig } from "./ai-providers";

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

export interface AiChatServiceOptions {
  aiProviderService?: Pick<AiProviderService, "resolveChatProviderConfig">;
  fetch?: typeof fetch;
  queueThreadSyncEvent?: (event: AiThreadSyncEvent) => void;
  queueMessageSyncEvent?: (event: AiMessageSyncEvent) => void;
  queueThreadTagSyncEvent?: (event: AiThreadTagSyncEvent) => void;
}

export type AiChatSyncOperation = "Create" | "Update" | "Delete";

export interface AiThreadSyncEvent {
  threadId: string;
  operation: AiChatSyncOperation;
  payload: AiThreadRowPayload | { id: string };
}

export interface AiMessageSyncEvent {
  messageId: string;
  operation: AiChatSyncOperation;
  payload: AiMessageRowPayload | { id: string };
}

export interface AiThreadTagSyncEvent {
  tagId: string;
  operation: AiChatSyncOperation;
  payload: AiThreadTagRowPayload | { id: string };
}

export interface AiThreadRowPayload {
  id: string;
  title: string | null;
  configSnapshot: string | null;
  isPinned: number;
  createdAt: string;
  updatedAt: string;
}

export interface AiMessageRowPayload {
  id: string;
  threadId: string;
  role: string;
  contentJson: string;
  createdAt: string;
}

export interface AiThreadTagRowPayload {
  id: string;
  threadId: string;
  tag: string;
  createdAt: string;
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

interface AiThreadTagRow {
  id: string;
  thread_id: string;
  tag: string;
  created_at: string;
}

interface AiChatModelConfig {
  provider?: string;
  model?: string;
  thinking?: boolean;
}

interface AiChatSendMessageRequest {
  threadId?: string;
  content: string;
  config?: AiChatModelConfig;
  providerId?: string;
  modelId?: string;
  allowedTools?: string[];
  parentMessageId?: string;
  attachments?: AiChatAttachment[];
}

interface AiChatAttachment {
  name: string;
  contentType: string;
  data: string;
}

interface ProviderChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface AiChatStreamIds {
  threadId: string;
  runId: string;
  messageId: string;
}

interface AiChatTitleContext {
  currentTitle: string | null;
  initialTitle: string | null;
  isNewThread: boolean;
  userMessage: string;
}

interface ThreadTitleUpdatedStreamEvent {
  type: "threadTitleUpdated";
  threadId: string;
  runId: string;
  title: string;
}

const DEFAULT_THREAD_LIMIT = 20;
const MAX_THREAD_LIMIT = 100;
const MAX_HISTORY_CHARS = 120_000;
const MAX_ATTACHMENTS_COUNT = 10;
const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENTS_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENT_NAME_CHARS = 255;
const MAX_ATTACHMENT_CONTENT_TYPE_CHARS = 255;
const CHAT_CONFIG_SCHEMA_VERSION = 1;
const PROMPT_TEMPLATE_ID = "wealthfolio-assistant-v1";
const PROMPT_VERSION = "1.0.0";
const ATTACHMENT_MARKER = "📎 ";
const TITLE_FALLBACK_MAX_CHARS = 50;
const TITLE_PROMPT_MAX_CHARS = 200;
const TITLE_MAX_CHARS = 100;
const TITLE_MAX_TOKENS = 20;
const TEXT_ENCODER = new TextEncoder();
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const TEXT_ONLY_SYSTEM_PROMPT = [
  "You are Wealthfolio's AI assistant.",
  "The TypeScript backend runtime currently streams text responses only.",
  "Portfolio tools, mutation tools, and multimodal image/PDF attachments are not available in this runtime yet.",
  "Text and CSV attachment contents may be included directly in the user prompt.",
  "Do not claim that you accessed account, holding, activity, goal, or performance data.",
  "If the user asks for private portfolio data, clearly say that data access is unavailable in the current runtime.",
].join("\n");

export function createAiChatService(
  db: Database,
  options: AiChatServiceOptions = {},
): AiChatService {
  return {
    async sendMessage(rawRequest) {
      if (!options.aiProviderService) {
        throw aiChatError(
          "not_implemented",
          "AI chat streaming is not yet available in the TS backend runtime",
          501,
        );
      }

      const request = parseSendMessageRequest(rawRequest);
      const attachments = request.attachments ?? [];
      validateAttachments(attachments);
      const unsupportedAttachment = attachments.find(
        (attachment) => !isSupportedTextAttachment(attachment),
      );
      if (unsupportedAttachment) {
        throw aiChatError(
          "not_implemented",
          `AI chat ${safeContentTypeLabel(unsupportedAttachment.contentType)} attachments are not yet available in the TS backend runtime`,
          501,
        );
      }

      const providerConfig = options.aiProviderService.resolveChatProviderConfig({
        providerId: request.config?.provider ?? request.providerId,
        modelId: request.config?.model ?? request.modelId,
        thinking: request.config?.thinking,
      });
      if (providerConfig.providerType === "api" && !providerConfig.apiKey) {
        throw aiChatError(
          "missing_api_key",
          `API key required for provider '${providerConfig.providerId}'`,
          400,
        );
      }

      const prepared = db.transaction(() =>
        prepareSendMessage(db, request, providerConfig, options),
      )();
      const fetchImpl = options.fetch ?? fetch;
      return streamChatResponse(fetchImpl, providerConfig, prepared, db, options);
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
      db.transaction(() => {
        const row: AiThreadTagRow = {
          id: crypto.randomUUID(),
          thread_id: threadId,
          tag,
          created_at: timestampNow(),
        };
        const result = db
          .prepare(
            `
              INSERT OR IGNORE INTO ai_thread_tags (id, thread_id, tag, created_at)
              VALUES (?, ?, ?, ?)
            `,
          )
          .run(row.id, row.thread_id, row.tag, row.created_at);
        if (result.changes > 0) {
          queueThreadTagSyncEvent(options, row, "Create");
        }
      })();
    },
    removeTag(threadId, tag) {
      db.transaction(() => {
        const rows = db
          .query<
            AiThreadTagRow,
            [string, string]
          >("SELECT id, thread_id, tag, created_at FROM ai_thread_tags WHERE thread_id = ? AND tag = ?")
          .all(threadId, tag);
        db.prepare("DELETE FROM ai_thread_tags WHERE thread_id = ? AND tag = ?").run(threadId, tag);
        for (const row of rows) {
          queueThreadTagSyncDelete(options, row.id);
        }
      })();
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

      return db.transaction(() => {
        const updatedAt = timestampNow();
        db.prepare(
          `
            UPDATE ai_threads
            SET title = ?, is_pinned = ?, updated_at = ?
            WHERE id = ?
          `,
        ).run(nextTitle, boolToInt(nextIsPinned), updatedAt, threadId);
        const row = readRequiredThreadRow(db, threadId);
        queueThreadSyncEvent(options, row, "Update");
        return threadFromRow(row, []);
      })();
    },
    async deleteThread(threadId) {
      db.transaction(() => {
        db.prepare("DELETE FROM ai_messages WHERE thread_id = ?").run(threadId);
        db.prepare("DELETE FROM ai_thread_tags WHERE thread_id = ?").run(threadId);
        const result = db.prepare("DELETE FROM ai_threads WHERE id = ?").run(threadId);
        if (result.changes > 0) {
          queueThreadSyncDelete(options, threadId);
        }
      })();
    },
    updateToolResult(request) {
      return updateToolResult(db, request, options.queueMessageSyncEvent);
    },
  };
}

function parseSendMessageRequest(payload: Record<string, unknown>): AiChatSendMessageRequest {
  const content =
    typeof payload.content === "string"
      ? payload.content
      : typeof payload.message === "string"
        ? payload.message
        : "";
  const attachments = parseAttachments(payload.attachments);
  if (!content.trim() && attachments.length === 0) {
    throw aiChatError("invalid_input", "AI chat message content is required", 400);
  }

  return {
    content,
    ...(typeof payload.threadId === "string" && payload.threadId.trim()
      ? { threadId: payload.threadId }
      : {}),
    ...(typeof payload.providerId === "string" && payload.providerId.trim()
      ? { providerId: payload.providerId }
      : {}),
    ...(typeof payload.modelId === "string" && payload.modelId.trim()
      ? { modelId: payload.modelId }
      : {}),
    ...(typeof payload.parentMessageId === "string" && payload.parentMessageId.trim()
      ? { parentMessageId: payload.parentMessageId }
      : {}),
    ...(Array.isArray(payload.allowedTools)
      ? {
          allowedTools: payload.allowedTools.filter(
            (tool): tool is string => typeof tool === "string",
          ),
        }
      : {}),
    ...(isRecord(payload.config) ? { config: parseChatModelConfig(payload.config) } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}

function parseChatModelConfig(value: Record<string, unknown>): AiChatModelConfig {
  return {
    ...(typeof value.provider === "string" && value.provider.trim()
      ? { provider: value.provider }
      : {}),
    ...(typeof value.model === "string" && value.model.trim() ? { model: value.model } : {}),
    ...(typeof value.thinking === "boolean" ? { thinking: value.thinking } : {}),
  };
}

function parseAttachments(value: unknown): AiChatAttachment[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw aiChatError("invalid_input", "attachments must be an array", 400);
  }
  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw aiChatError("invalid_input", `attachments[${index}] must be an object`, 400);
    }
    const name = parseRequiredString(item.name, `attachments[${index}].name`);
    const contentType = parseRequiredString(item.contentType, `attachments[${index}].contentType`);
    const data = parseRequiredString(item.data, `attachments[${index}].data`);
    return { name, contentType, data };
  });
}

function parseRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw aiChatError("invalid_input", `${fieldName} is required`, 400);
  }
  return value;
}

function validateAttachments(attachments: AiChatAttachment[]): void {
  if (attachments.length > MAX_ATTACHMENTS_COUNT) {
    throw aiChatError(
      "invalid_input",
      `Too many attachments: ${attachments.length} (max ${MAX_ATTACHMENTS_COUNT})`,
      400,
    );
  }

  let totalSize = 0;
  for (const [index, attachment] of attachments.entries()) {
    validateAttachmentMetadata(attachment, index);
    const effectiveSize = attachmentEffectiveSize(attachment);
    if (effectiveSize > MAX_ATTACHMENT_SIZE_BYTES) {
      throw aiChatError(
        "invalid_input",
        `Attachment '${attachment.name}' too large (max ${MAX_ATTACHMENT_SIZE_BYTES / (1024 * 1024)} MB)`,
        400,
      );
    }
    totalSize += effectiveSize;
  }

  if (totalSize > MAX_TOTAL_ATTACHMENTS_BYTES) {
    throw aiChatError(
      "invalid_input",
      `Total attachment size too large (max ${MAX_TOTAL_ATTACHMENTS_BYTES / (1024 * 1024)} MB)`,
      400,
    );
  }
}

function validateAttachmentMetadata(attachment: AiChatAttachment, index: number): void {
  if (!attachment.name.trim()) {
    throw aiChatError("invalid_input", `attachments[${index}].name cannot be blank`, 400);
  }
  if (attachment.name.length > MAX_ATTACHMENT_NAME_CHARS) {
    throw aiChatError(
      "invalid_input",
      `attachments[${index}].name is too long (max ${MAX_ATTACHMENT_NAME_CHARS} characters)`,
      400,
    );
  }
  if (CONTROL_CHARACTER_PATTERN.test(attachment.name)) {
    throw aiChatError(
      "invalid_input",
      `attachments[${index}].name must not contain control characters`,
      400,
    );
  }
  if (attachment.contentType.length > MAX_ATTACHMENT_CONTENT_TYPE_CHARS) {
    throw aiChatError(
      "invalid_input",
      `attachments[${index}].contentType is too long (max ${MAX_ATTACHMENT_CONTENT_TYPE_CHARS} characters)`,
      400,
    );
  }
  if (CONTROL_CHARACTER_PATTERN.test(attachment.contentType)) {
    throw aiChatError(
      "invalid_input",
      `attachments[${index}].contentType must not contain control characters`,
      400,
    );
  }
}

function attachmentEffectiveSize(attachment: AiChatAttachment): number {
  if (isBinaryAttachment(attachment)) {
    return Math.floor((attachment.data.length * 3) / 4);
  }
  return TEXT_ENCODER.encode(attachment.data).byteLength;
}

function isBinaryAttachment(attachment: AiChatAttachment): boolean {
  const contentType = normalizeContentType(attachment.contentType);
  return contentType.startsWith("image/") || contentType === "application/pdf";
}

function isSupportedTextAttachment(attachment: AiChatAttachment): boolean {
  const contentType = normalizeContentType(attachment.contentType);
  return (
    contentType === "text/csv" ||
    contentType === "application/csv" ||
    contentType === "application/json" ||
    contentType.startsWith("text/")
  );
}

function normalizeContentType(contentType: string): string {
  return contentType.toLowerCase().split(";")[0]?.trim() ?? "";
}

function safeContentTypeLabel(contentType: string): string {
  return normalizeContentType(contentType).slice(0, 100) || "unknown";
}

function prepareSendMessage(
  db: Database,
  request: AiChatSendMessageRequest,
  providerConfig: ResolvedAiChatProviderConfig,
  options: AiChatServiceOptions,
): {
  ids: AiChatStreamIds;
  messages: ProviderChatMessage[];
  title: AiChatTitleContext;
} {
  const now = timestampNow();
  const isNewThread = !request.threadId;
  const threadRow = request.threadId
    ? readRequiredThreadRow(db, request.threadId)
    : insertThreadRow(db, {
        id: crypto.randomUUID(),
        title: deriveInitialThreadTitle(request.content),
        configSnapshot: JSON.stringify(chatConfigSnapshot(providerConfig)),
        createdAt: now,
        updatedAt: now,
      });
  if (isNewThread) {
    queueThreadSyncEvent(options, threadRow, "Create");
  }

  const threadId = threadRow.id;
  const previousRows = db
    .query<AiMessageRow, [string]>(
      `
        SELECT id, thread_id, role, content_json, created_at
        FROM ai_messages
        WHERE thread_id = ?
        ORDER BY created_at ASC
      `,
    )
    .all(threadId);
  const historyRows = truncateHistoryAtParent(previousRows, request.parentMessageId);

  const userMessageRow = insertMessageRow(db, {
    id: crypto.randomUUID(),
    threadId,
    role: "user",
    content: textMessageContent(persistedUserMessageText(request)),
    createdAt: now,
  });
  queueMessageSyncEvent(options.queueMessageSyncEvent, userMessageRow, "Create");
  if (!isNewThread) {
    touchThread(db, options, threadId, now);
  }

  return {
    ids: {
      threadId,
      runId: crypto.randomUUID(),
      messageId: crypto.randomUUID(),
    },
    messages: buildProviderMessages(historyRows, providerPromptText(request)),
    title: {
      currentTitle: threadRow.title,
      initialTitle: isNewThread ? threadRow.title : null,
      isNewThread,
      userMessage: request.content,
    },
  };
}

function persistedUserMessageText(request: AiChatSendMessageRequest): string {
  const attachmentMarkers = (request.attachments ?? []).map(
    (attachment) => `${ATTACHMENT_MARKER}${attachment.name}`,
  );
  if (attachmentMarkers.length === 0) {
    return request.content;
  }
  return [request.content, ...attachmentMarkers].filter((part) => part.length > 0).join("\n");
}

function providerPromptText(request: AiChatSendMessageRequest): string {
  const attachments = request.attachments ?? [];
  if (attachments.length === 0) {
    return request.content;
  }

  const lines = [
    "[INSTRUCTION: Text/CSV attachment content is included below. Use it directly; tools and file imports are unavailable in the TypeScript runtime.]",
  ];
  if (request.content.trim()) {
    lines.push("", request.content);
  }
  for (const attachment of attachments) {
    lines.push("", `[Attached file: ${attachment.name}]`, attachment.data);
  }
  return lines.join("\n");
}

function insertThreadRow(
  db: Database,
  thread: {
    id: string;
    title: string | null;
    configSnapshot: string;
    createdAt: string;
    updatedAt: string;
  },
): AiThreadRow {
  db.prepare(
    `
      INSERT INTO ai_threads (id, title, config_snapshot, is_pinned, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
  ).run(thread.id, thread.title, thread.configSnapshot, 0, thread.createdAt, thread.updatedAt);
  return readRequiredThreadRow(db, thread.id);
}

function insertMessageRow(
  db: Database,
  message: {
    id: string;
    threadId: string;
    role: string;
    content: AiChatMessageContent;
    createdAt: string;
  },
): AiMessageRow {
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
    message.createdAt,
  );
  return readRequiredMessageRow(db, message.id);
}

function touchThread(
  db: Database,
  options: AiChatServiceOptions,
  threadId: string,
  updatedAt: string,
): void {
  db.prepare("UPDATE ai_threads SET updated_at = ? WHERE id = ?").run(updatedAt, threadId);
  const row = readRequiredThreadRow(db, threadId);
  queueThreadSyncEvent(options, row, "Update");
}

function chatConfigSnapshot(providerConfig: ResolvedAiChatProviderConfig): Record<string, unknown> {
  return {
    schemaVersion: CHAT_CONFIG_SCHEMA_VERSION,
    providerId: providerConfig.providerId,
    modelId: providerConfig.modelId,
    promptTemplateId: PROMPT_TEMPLATE_ID,
    promptVersion: PROMPT_VERSION,
    toolsAllowlist: [],
  };
}

function deriveInitialThreadTitle(content: string): string | null {
  return truncateToTitle(content, TITLE_FALLBACK_MAX_CHARS) || null;
}

function truncateHistoryAtParent(
  rows: AiMessageRow[],
  parentMessageId: string | undefined,
): AiMessageRow[] {
  if (!parentMessageId) {
    return rows;
  }
  const parentIndex = rows.findIndex((row) => row.id === parentMessageId);
  return parentIndex >= 0 ? rows.slice(0, parentIndex + 1) : rows;
}

function buildProviderMessages(
  rows: AiMessageRow[],
  currentContent: string,
): ProviderChatMessage[] {
  const history: ProviderChatMessage[] = [];
  let remainingBudget = MAX_HISTORY_CHARS;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const message = messageFromRow(rows[index] as AiMessageRow);
    if (message.role !== "user" && message.role !== "assistant") {
      continue;
    }
    const content = textContentFromMessage(message);
    if (!content) {
      continue;
    }
    if (content.length > remainingBudget) {
      break;
    }
    remainingBudget -= content.length;
    history.push({
      role: message.role === "assistant" ? "assistant" : "user",
      content,
    });
  }
  history.reverse();
  history.push({ role: "user", content: currentContent });
  return [{ role: "system", content: TEXT_ONLY_SYSTEM_PROMPT }, ...history];
}

function textContentFromMessage(message: AiChatMessage): string {
  return message.content.parts
    .filter(
      (part): part is AiChatMessagePart & { content: string } =>
        part.type === "text" && typeof part.content === "string",
    )
    .map((part) => part.content)
    .join("");
}

function textMessageContent(content: string): AiChatMessageContent {
  return {
    schemaVersion: 1,
    parts: [{ type: "text", content }],
  };
}

function assistantMessageContent(parts: AiChatMessagePart[]): AiChatMessageContent {
  return {
    schemaVersion: 1,
    parts: parts.length > 0 ? parts : [{ type: "text", content: "" }],
  };
}

async function* streamChatResponse(
  fetchImpl: typeof fetch,
  providerConfig: ResolvedAiChatProviderConfig,
  prepared: {
    ids: AiChatStreamIds;
    messages: ProviderChatMessage[];
    title: AiChatTitleContext;
  },
  db: Database,
  options: AiChatServiceOptions,
): AsyncIterable<unknown> {
  yield {
    type: "system",
    threadId: prepared.ids.threadId,
    runId: prepared.ids.runId,
    messageId: prepared.ids.messageId,
  };

  const assistantParts: AiChatMessagePart[] = [];
  const thinkParser = new ThinkTagParser();
  let titlePromise: Promise<string> | null = null;
  const ensureTitleGenerationStarted = (): Promise<string> => {
    titlePromise ??= generateThreadTitle(fetchImpl, providerConfig, prepared.title.userMessage);
    return titlePromise;
  };
  try {
    for await (const delta of streamProviderText(fetchImpl, providerConfig, prepared.messages)) {
      for (const segment of thinkParser.process(delta)) {
        if (!segment.content) {
          continue;
        }
        appendAssistantPart(assistantParts, segment.type, segment.content);
        yield streamDeltaEvent(prepared.ids, segment);
        ensureTitleGenerationStarted();
      }
    }
  } catch (error) {
    await Promise.resolve(titlePromise).catch(() => null);
    yield {
      type: "error",
      threadId: prepared.ids.threadId,
      runId: prepared.ids.runId,
      messageId: prepared.ids.messageId,
      code: aiChatErrorCode(error, "provider_error"),
      message: errorMessage(error),
    };
    return;
  }

  for (const segment of thinkParser.flush()) {
    if (!segment.content) {
      continue;
    }
    appendAssistantPart(assistantParts, segment.type, segment.content);
    yield streamDeltaEvent(prepared.ids, segment);
    ensureTitleGenerationStarted();
  }

  ensureTitleGenerationStarted();
  const generatedTitle = await (titlePromise ?? Promise.resolve(""));
  const titleEvent = persistGeneratedThreadTitle(
    generatedTitle,
    prepared.ids,
    prepared.title,
    db,
    options,
  );
  if (titleEvent) {
    yield titleEvent;
  }

  const assistantMessage = db.transaction(() => {
    const createdAt = timestampNow();
    const row = insertMessageRow(db, {
      id: prepared.ids.messageId,
      threadId: prepared.ids.threadId,
      role: "assistant",
      content: assistantMessageContent(assistantParts),
      createdAt,
    });
    queueMessageSyncEvent(options.queueMessageSyncEvent, row, "Create");
    touchThread(db, options, prepared.ids.threadId, createdAt);
    return messageFromRow(row);
  })();

  yield {
    type: "done",
    threadId: prepared.ids.threadId,
    runId: prepared.ids.runId,
    messageId: prepared.ids.messageId,
    message: assistantMessage,
  };
}

interface AssistantStreamSegment {
  type: "text" | "reasoning";
  content: string;
}

function streamDeltaEvent(
  ids: AiChatStreamIds,
  segment: AssistantStreamSegment,
): Record<string, unknown> {
  return {
    type: segment.type === "reasoning" ? "reasoningDelta" : "textDelta",
    threadId: ids.threadId,
    runId: ids.runId,
    messageId: ids.messageId,
    delta: segment.content,
  };
}

function appendAssistantPart(
  parts: AiChatMessagePart[],
  type: "text" | "reasoning",
  content: string,
): void {
  if (!content) {
    return;
  }
  const previous = parts[parts.length - 1];
  if (previous?.type === type && typeof previous.content === "string") {
    previous.content += content;
    return;
  }
  parts.push({ type, content });
}

class ThinkTagParser {
  private buffer = "";
  private inThinkBlock = false;

  process(delta: string): AssistantStreamSegment[] {
    if (!this.inThinkBlock && !delta.includes("<") && this.buffer.length === 0) {
      return [{ type: "text", content: delta }];
    }

    this.buffer += delta;
    const segments: AssistantStreamSegment[] = [];

    while (true) {
      if (this.inThinkBlock) {
        const endIndex = this.buffer.indexOf("</think>");
        if (endIndex >= 0) {
          if (endIndex > 0) {
            segments.push({ type: "reasoning", content: this.buffer.slice(0, endIndex) });
          }
          this.buffer = this.buffer.slice(endIndex + "</think>".length);
          this.inThinkBlock = false;
        } else if (
          this.buffer.length > "</think>".length &&
          !this.buffer.endsWith("<") &&
          !this.buffer.endsWith("</")
        ) {
          const safeLength = this.buffer.length - "</think>".length;
          segments.push({ type: "reasoning", content: this.buffer.slice(0, safeLength) });
          this.buffer = this.buffer.slice(safeLength);
          break;
        } else {
          break;
        }
      } else {
        const startIndex = this.buffer.indexOf("<think>");
        if (startIndex >= 0) {
          if (startIndex > 0) {
            segments.push({ type: "text", content: this.buffer.slice(0, startIndex) });
          }
          this.buffer = this.buffer.slice(startIndex + "<think>".length);
          this.inThinkBlock = true;
        } else if (this.buffer.length > "<think>".length && !this.buffer.endsWith("<")) {
          const safeLength = this.buffer.length - "<think>".length;
          segments.push({ type: "text", content: this.buffer.slice(0, safeLength) });
          this.buffer = this.buffer.slice(safeLength);
          break;
        } else {
          break;
        }
      }
    }

    return segments;
  }

  flush(): AssistantStreamSegment[] {
    if (!this.buffer) {
      return [];
    }
    const content = this.buffer;
    this.buffer = "";
    return [{ type: this.inThinkBlock ? "reasoning" : "text", content }];
  }
}

function persistGeneratedThreadTitle(
  generatedTitle: string,
  ids: AiChatStreamIds,
  titleContext: AiChatTitleContext,
  db: Database,
  options: AiChatServiceOptions,
): ThreadTitleUpdatedStreamEvent | null {
  if (!shouldAttemptTitleGeneration(titleContext)) {
    return null;
  }

  const nextTitle = generatedTitle.trim().slice(0, TITLE_MAX_CHARS);
  if (!nextTitle) {
    return null;
  }

  const updated = db.transaction(() => {
    const thread = readThreadRow(db, ids.threadId);
    if (!thread) {
      return false;
    }

    const currentTitle = thread.title?.trim() ?? "";
    if (!shouldUpdateGeneratedTitle(currentTitle, titleContext.initialTitle)) {
      return false;
    }
    if (currentTitle === nextTitle) {
      return false;
    }

    db.prepare("UPDATE ai_threads SET title = ?, updated_at = ? WHERE id = ?").run(
      nextTitle,
      timestampNow(),
      ids.threadId,
    );
    queueThreadSyncEvent(options, readRequiredThreadRow(db, ids.threadId), "Update");
    return true;
  })();

  return updated
    ? {
        type: "threadTitleUpdated",
        threadId: ids.threadId,
        runId: ids.runId,
        title: nextTitle,
      }
    : null;
}

function shouldAttemptTitleGeneration(titleContext: AiChatTitleContext): boolean {
  return titleContext.isNewThread || !titleContext.currentTitle?.trim();
}

function shouldUpdateGeneratedTitle(currentTitle: string, initialTitle: string | null): boolean {
  if (initialTitle === null) {
    return currentTitle.length === 0;
  }
  return currentTitle.length === 0 || currentTitle === initialTitle.trim();
}

async function generateThreadTitle(
  fetchImpl: typeof fetch,
  providerConfig: ResolvedAiChatProviderConfig,
  userMessage: string,
): Promise<string> {
  const titleModelId = providerConfig.titleModelId?.trim() || providerConfig.modelId;
  for (const modelId of titleModelCandidates(titleModelId, providerConfig.modelId)) {
    try {
      return await generateThreadTitleWithModel(fetchImpl, providerConfig, modelId, userMessage);
    } catch {
      // Fall through to the next model or deterministic fallback, matching Rust behavior.
    }
  }
  return truncateToTitle(userMessage, TITLE_FALLBACK_MAX_CHARS);
}

function titleModelCandidates(titleModelId: string, chatModelId: string): string[] {
  return titleModelId === chatModelId ? [chatModelId] : [titleModelId, chatModelId];
}

async function generateThreadTitleWithModel(
  fetchImpl: typeof fetch,
  providerConfig: ResolvedAiChatProviderConfig,
  modelId: string,
  userMessage: string,
): Promise<string> {
  const prompt = titlePrompt(userMessage);
  const titleConfig: ResolvedAiChatProviderConfig = { ...providerConfig, modelId };
  const rawTitle = await fetchProviderTitle(fetchImpl, titleConfig, prompt);
  const title = cleanGeneratedTitle(rawTitle);
  if (!title || title.length > TITLE_MAX_CHARS) {
    throw aiChatError("provider_error", "Generated title too long or empty", 502);
  }
  return title;
}

function titlePrompt(userMessage: string): string {
  return [
    "Generate a very short plain-text title (max 4 words) for this chat message.",
    "Rules:",
    "- Return ONLY the title text",
    "- No markdown (no **bold**, no *italics*, no backticks)",
    "- No quotes",
    '- No leading "Title:" prefix',
    "",
    "Message:",
    `"${truncateToTitle(userMessage, TITLE_PROMPT_MAX_CHARS)}"`,
    "",
    "Title:",
  ].join("\n");
}

async function fetchProviderTitle(
  fetchImpl: typeof fetch,
  providerConfig: ResolvedAiChatProviderConfig,
  prompt: string,
): Promise<string> {
  switch (providerConfig.providerId) {
    case "ollama":
      return fetchOllamaTitle(fetchImpl, providerConfig, prompt);
    case "anthropic":
      return fetchAnthropicTitle(fetchImpl, providerConfig, prompt);
    case "google":
    case "gemini":
      return fetchGoogleTitle(fetchImpl, providerConfig, prompt);
    case "openai":
    case "groq":
    case "openrouter":
    default:
      return fetchOpenAiCompatibleTitle(fetchImpl, providerConfig, prompt);
  }
}

async function fetchOpenAiCompatibleTitle(
  fetchImpl: typeof fetch,
  providerConfig: ResolvedAiChatProviderConfig,
  prompt: string,
): Promise<string> {
  const response = await fetchImpl(openAiChatUrl(providerConfig.baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(providerConfig.apiKey ? { authorization: `Bearer ${providerConfig.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: providerConfig.modelId,
      messages: [{ role: "user", content: prompt }],
      stream: false,
      max_tokens: TITLE_MAX_TOKENS,
    }),
  });
  await assertProviderResponseOk(response);
  const payload = await response.json();
  const choice = parseArrayField(isRecord(payload) ? payload.choices : undefined)[0];
  if (isRecord(choice) && isRecord(choice.message) && typeof choice.message.content === "string") {
    return choice.message.content;
  }
  throw aiChatError("provider_error", "Provider title response is missing content", 502);
}

async function fetchOllamaTitle(
  fetchImpl: typeof fetch,
  providerConfig: ResolvedAiChatProviderConfig,
  prompt: string,
): Promise<string> {
  const response = await fetchImpl(ollamaChatUrl(providerConfig.baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: providerConfig.modelId,
      messages: [{ role: "user", content: prompt }],
      stream: false,
      options: { num_predict: TITLE_MAX_TOKENS },
    }),
  });
  await assertProviderResponseOk(response);
  const payload = await response.json();
  if (isRecord(payload) && typeof payload.error === "string") {
    throw aiChatError("provider_error", payload.error, 502);
  }
  if (
    isRecord(payload) &&
    isRecord(payload.message) &&
    typeof payload.message.content === "string"
  ) {
    return payload.message.content;
  }
  throw aiChatError("provider_error", "Provider title response is missing content", 502);
}

async function fetchAnthropicTitle(
  fetchImpl: typeof fetch,
  providerConfig: ResolvedAiChatProviderConfig,
  prompt: string,
): Promise<string> {
  const response = await fetchImpl(anthropicMessagesUrl(providerConfig.baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      ...(providerConfig.apiKey ? { "x-api-key": providerConfig.apiKey } : {}),
    },
    body: JSON.stringify({
      model: providerConfig.modelId,
      max_tokens: TITLE_MAX_TOKENS,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  await assertProviderResponseOk(response);
  const payload = await response.json();
  if (isRecord(payload)) {
    for (const part of parseArrayField(payload.content)) {
      if (isRecord(part) && typeof part.text === "string") {
        return part.text;
      }
    }
  }
  throw aiChatError("provider_error", "Provider title response is missing content", 502);
}

async function fetchGoogleTitle(
  fetchImpl: typeof fetch,
  providerConfig: ResolvedAiChatProviderConfig,
  prompt: string,
): Promise<string> {
  const response = await fetchImpl(googleGenerateContentUrl(providerConfig, false), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: TITLE_MAX_TOKENS },
    }),
  });
  await assertProviderResponseOk(response);
  const payload = await response.json();
  if (isRecord(payload)) {
    for (const candidate of parseArrayField(payload.candidates)) {
      if (!isRecord(candidate) || !isRecord(candidate.content)) {
        continue;
      }
      for (const part of parseArrayField(candidate.content.parts)) {
        if (isRecord(part) && typeof part.text === "string") {
          return part.text;
        }
      }
    }
  }
  throw aiChatError("provider_error", "Provider title response is missing content", 502);
}

function cleanGeneratedTitle(raw: string): string {
  let title =
    raw
      .split(/\r?\n/)
      .find((line) => line.trim().length > 0)
      ?.trim() ?? raw.trim();

  for (let index = 0; index < 4; index += 1) {
    const trimmed = title.trim();
    let next = trimmed;
    if (
      ((trimmed.startsWith("**") && trimmed.endsWith("**")) ||
        (trimmed.startsWith("__") && trimmed.endsWith("__"))) &&
      trimmed.length > 4
    ) {
      next = trimmed.slice(2, -2).trim();
    } else if (
      ((trimmed.startsWith("`") && trimmed.endsWith("`")) ||
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
        (trimmed.startsWith("*") && trimmed.endsWith("*"))) &&
      trimmed.length > 2
    ) {
      next = trimmed.slice(1, -1).trim();
    }
    if (next === trimmed) {
      break;
    }
    title = next;
  }

  return title
    .trim()
    .replace(/^[*_"'`]+|[*_"'`]+$/gu, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

function truncateToTitle(text: string, maxChars: number): string {
  const trimmed = text.trim();
  const chars = [...trimmed];
  if (chars.length <= maxChars) {
    return trimmed;
  }

  const truncatedChars = chars.slice(0, maxChars);
  let lastWhitespaceIndex = -1;
  for (let index = 0; index < truncatedChars.length; index += 1) {
    if (/\s/u.test(truncatedChars[index] as string)) {
      lastWhitespaceIndex = index;
    }
  }

  const title =
    lastWhitespaceIndex > maxChars / 2
      ? truncatedChars.slice(0, lastWhitespaceIndex).join("")
      : truncatedChars.join("");
  return `${title.trim()}...`;
}

async function* streamProviderText(
  fetchImpl: typeof fetch,
  providerConfig: ResolvedAiChatProviderConfig,
  messages: ProviderChatMessage[],
): AsyncIterable<string> {
  switch (providerConfig.providerId) {
    case "ollama":
      yield* streamOllamaText(fetchImpl, providerConfig, messages);
      return;
    case "anthropic":
      yield* streamAnthropicText(fetchImpl, providerConfig, messages);
      return;
    case "google":
    case "gemini":
      yield* streamGoogleText(fetchImpl, providerConfig, messages);
      return;
    case "openai":
    case "groq":
    case "openrouter":
    default:
      yield* streamOpenAiCompatibleText(fetchImpl, providerConfig, messages);
  }
}

async function* streamOpenAiCompatibleText(
  fetchImpl: typeof fetch,
  providerConfig: ResolvedAiChatProviderConfig,
  messages: ProviderChatMessage[],
): AsyncIterable<string> {
  const response = await fetchImpl(openAiChatUrl(providerConfig.baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(providerConfig.apiKey ? { authorization: `Bearer ${providerConfig.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: providerConfig.modelId,
      messages,
      stream: true,
      ...openAiTuningBody(providerConfig),
    }),
  });
  await assertProviderResponseOk(response);
  yield* parseSseDeltas(response, (payload) => {
    const choice = parseArrayField(payload.choices)[0];
    if (!isRecord(choice) || !isRecord(choice.delta)) {
      return [];
    }
    return typeof choice.delta.content === "string" ? [choice.delta.content] : [];
  });
}

async function* streamOllamaText(
  fetchImpl: typeof fetch,
  providerConfig: ResolvedAiChatProviderConfig,
  messages: ProviderChatMessage[],
): AsyncIterable<string> {
  const response = await fetchImpl(ollamaChatUrl(providerConfig.baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: providerConfig.modelId,
      messages,
      stream: true,
      options: ollamaOptions(providerConfig),
    }),
  });
  await assertProviderResponseOk(response);
  yield* parseNdjsonDeltas(response, (payload) => {
    if (typeof payload.error === "string") {
      throw aiChatError("provider_error", payload.error, 502);
    }
    if (isRecord(payload.message) && typeof payload.message.content === "string") {
      return [payload.message.content];
    }
    return [];
  });
}

async function* streamAnthropicText(
  fetchImpl: typeof fetch,
  providerConfig: ResolvedAiChatProviderConfig,
  messages: ProviderChatMessage[],
): AsyncIterable<string> {
  const system = messages.find((message) => message.role === "system")?.content;
  const response = await fetchImpl(anthropicMessagesUrl(providerConfig.baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      ...(providerConfig.apiKey ? { "x-api-key": providerConfig.apiKey } : {}),
    },
    body: JSON.stringify({
      model: providerConfig.modelId,
      max_tokens: providerMaxTokens(providerConfig),
      stream: true,
      ...(system ? { system } : {}),
      messages: messages
        .filter((message) => message.role !== "system")
        .map((message) => ({ role: message.role, content: message.content })),
    }),
  });
  await assertProviderResponseOk(response);
  yield* parseSseDeltas(response, (payload) => {
    if (payload.type === "error" && isRecord(payload.error)) {
      throw aiChatError(
        "provider_error",
        typeof payload.error.message === "string" ? payload.error.message : "Anthropic error",
        502,
      );
    }
    if (
      payload.type === "content_block_delta" &&
      isRecord(payload.delta) &&
      typeof payload.delta.text === "string"
    ) {
      return [payload.delta.text];
    }
    return [];
  });
}

async function* streamGoogleText(
  fetchImpl: typeof fetch,
  providerConfig: ResolvedAiChatProviderConfig,
  messages: ProviderChatMessage[],
): AsyncIterable<string> {
  const system = messages.find((message) => message.role === "system")?.content;
  const response = await fetchImpl(googleGenerateContentUrl(providerConfig, true), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: messages
        .filter((message) => message.role !== "system")
        .map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.content }],
        })),
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      generationConfig: googleGenerationConfig(providerConfig),
      ...googleExtraOptions(providerConfig),
    }),
  });
  await assertProviderResponseOk(response);
  yield* parseSseDeltas(response, (payload) => {
    const candidates = parseArrayField(payload.candidates);
    const deltas: string[] = [];
    for (const candidate of candidates) {
      if (!isRecord(candidate) || !isRecord(candidate.content)) {
        continue;
      }
      for (const part of parseArrayField(candidate.content.parts)) {
        if (isRecord(part) && typeof part.text === "string") {
          deltas.push(part.text);
        }
      }
    }
    return deltas;
  });
}

async function* parseSseDeltas(
  response: Response,
  extract: (payload: Record<string, unknown>) => string[],
): AsyncIterable<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw aiChatError("provider_error", "Provider response body is empty", 502);
  }

  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        yield* parseSseBuffer(buffer, extract);
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        yield* parseSseFrame(frame, extract);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function* parseSseBuffer(
  buffer: string,
  extract: (payload: Record<string, unknown>) => string[],
): Iterable<string> {
  const trimmed = buffer.trim();
  if (!trimmed) {
    return;
  }
  for (const frame of trimmed.split(/\r?\n\r?\n/)) {
    yield* parseSseFrame(frame, extract);
  }
}

function* parseSseFrame(
  frame: string,
  extract: (payload: Record<string, unknown>) => string[],
): Iterable<string> {
  const dataLines = frame
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  if (dataLines.length === 0) {
    return;
  }
  const data = dataLines.join("\n").trim();
  if (!data || data === "[DONE]") {
    return;
  }
  const payload = JSON.parse(data) as unknown;
  if (!isRecord(payload)) {
    return;
  }
  if (isRecord(payload.error)) {
    throw aiChatError(
      "provider_error",
      typeof payload.error.message === "string" ? payload.error.message : "Provider error",
      502,
    );
  }
  yield* extract(payload);
}

async function* parseNdjsonDeltas(
  response: Response,
  extract: (payload: Record<string, unknown>) => string[],
): AsyncIterable<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw aiChatError("provider_error", "Provider response body is empty", 502);
  }

  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        yield* parseNdjsonBuffer(buffer, extract);
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        yield* parseNdjsonLine(line, extract);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function* parseNdjsonBuffer(
  buffer: string,
  extract: (payload: Record<string, unknown>) => string[],
): Iterable<string> {
  for (const line of buffer.split(/\r?\n/)) {
    yield* parseNdjsonLine(line, extract);
  }
}

function* parseNdjsonLine(
  line: string,
  extract: (payload: Record<string, unknown>) => string[],
): Iterable<string> {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }
  const payload = JSON.parse(trimmed) as unknown;
  if (isRecord(payload)) {
    yield* extract(payload);
  }
}

async function assertProviderResponseOk(response: Response): Promise<void> {
  if (response.ok) {
    return;
  }
  const body = await response.text();
  throw aiChatError(
    "provider_error",
    `Provider returned error ${response.status}${body ? `: ${body}` : ""}`,
    502,
  );
}

function openAiChatUrl(baseUrl: string): string {
  const normalized = trimTrailingSlash(baseUrl);
  return normalized.endsWith("/v1")
    ? `${normalized}/chat/completions`
    : `${normalized}/v1/chat/completions`;
}

function ollamaChatUrl(baseUrl: string): string {
  const normalized = trimTrailingSlash(baseUrl).replace(/\/v1$/, "");
  return `${normalized}/api/chat`;
}

function anthropicMessagesUrl(baseUrl: string): string {
  const normalized = trimTrailingSlash(baseUrl);
  return normalized.endsWith("/v1") ? `${normalized}/messages` : `${normalized}/v1/messages`;
}

function googleGenerateContentUrl(
  providerConfig: ResolvedAiChatProviderConfig,
  stream: boolean,
): string {
  const normalized = trimTrailingSlash(providerConfig.baseUrl);
  const base = normalized.endsWith("/v1beta") ? normalized : `${normalized}/v1beta`;
  const model = providerConfig.modelId.replace(/^models\//, "");
  const method = stream ? "streamGenerateContent" : "generateContent";
  const url = new URL(`${base}/models/${encodeURIComponent(model)}:${method}`);
  if (stream) {
    url.searchParams.set("alt", "sse");
  }
  if (providerConfig.apiKey) {
    url.searchParams.set("key", providerConfig.apiKey);
  }
  return url.toString();
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function openAiTuningBody(providerConfig: ResolvedAiChatProviderConfig): Record<string, unknown> {
  return {
    ...(providerConfig.tuning?.temperature !== undefined
      ? { temperature: providerConfig.tuning.temperature }
      : {}),
    ...(providerConfig.tuning?.maxTokens !== undefined
      ? { max_tokens: providerConfig.tuning.maxTokens }
      : {}),
    ...(isRecord(providerConfig.tuning?.extraOptions) ? providerConfig.tuning.extraOptions : {}),
  };
}

function ollamaOptions(providerConfig: ResolvedAiChatProviderConfig): Record<string, unknown> {
  return {
    ...(isRecord(providerConfig.tuning?.extraOptions) ? providerConfig.tuning.extraOptions : {}),
    ...(providerConfig.tuning?.temperature !== undefined
      ? { temperature: providerConfig.tuning.temperature }
      : {}),
    ...(providerConfig.tuning?.maxTokens !== undefined
      ? { num_predict: providerConfig.tuning.maxTokens }
      : {}),
  };
}

function googleGenerationConfig(
  providerConfig: ResolvedAiChatProviderConfig,
): Record<string, unknown> | undefined {
  const config: Record<string, unknown> = {};
  if (providerConfig.tuning?.temperature !== undefined) {
    config.temperature = providerConfig.tuning.temperature;
  }
  if (providerConfig.tuning?.maxTokens !== undefined) {
    config.maxOutputTokens = providerConfig.tuning.maxTokens;
  }
  return Object.keys(config).length > 0 ? config : undefined;
}

function googleExtraOptions(providerConfig: ResolvedAiChatProviderConfig): Record<string, unknown> {
  return isRecord(providerConfig.tuning?.extraOptions) ? providerConfig.tuning.extraOptions : {};
}

function providerMaxTokens(providerConfig: ResolvedAiChatProviderConfig): number {
  return providerConfig.capabilities.thinking && providerConfig.tuning?.maxTokensThinking
    ? providerConfig.tuning.maxTokensThinking
    : (providerConfig.tuning?.maxTokens ?? 4096);
}

function parseArrayField(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function aiChatErrorCode(error: unknown, fallback: string): string {
  return isRecord(error) && typeof error.code === "string" ? error.code : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function updateToolResult(
  db: Database,
  request: AiChatUpdateToolResultRequest,
  queueSyncEvent?: (event: AiMessageSyncEvent) => void,
): AiChatMessage {
  return db.transaction(() => {
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
        (candidate) =>
          candidate.type === "toolResult" && candidate.toolCallId === request.toolCallId,
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
      const updatedRow = readRequiredMessageRow(db, message.id);
      queueMessageSyncEvent(queueSyncEvent, updatedRow, "Update");
      return message;
    }

    throw aiChatError(
      "invalid_input",
      `Tool result not found for tool_call_id: ${request.toolCallId}`,
      400,
    );
  })();
}

function queueThreadSyncEvent(
  options: AiChatServiceOptions,
  row: AiThreadRow,
  operation: Exclude<AiChatSyncOperation, "Delete">,
): void {
  options.queueThreadSyncEvent?.({
    threadId: row.id,
    operation,
    payload: threadRowPayload(row),
  });
}

function queueThreadSyncDelete(options: AiChatServiceOptions, threadId: string): void {
  options.queueThreadSyncEvent?.({
    threadId,
    operation: "Delete",
    payload: { id: threadId },
  });
}

function queueMessageSyncEvent(
  queueSyncEvent: ((event: AiMessageSyncEvent) => void) | undefined,
  row: AiMessageRow,
  operation: Exclude<AiChatSyncOperation, "Delete">,
): void {
  queueSyncEvent?.({
    messageId: row.id,
    operation,
    payload: messageRowPayload(row),
  });
}

function queueThreadTagSyncEvent(
  options: AiChatServiceOptions,
  row: AiThreadTagRow,
  operation: Exclude<AiChatSyncOperation, "Delete">,
): void {
  options.queueThreadTagSyncEvent?.({
    tagId: row.id,
    operation,
    payload: threadTagRowPayload(row),
  });
}

function queueThreadTagSyncDelete(options: AiChatServiceOptions, tagId: string): void {
  options.queueThreadTagSyncEvent?.({
    tagId,
    operation: "Delete",
    payload: { id: tagId },
  });
}

function threadRowPayload(row: AiThreadRow): AiThreadRowPayload {
  return {
    id: row.id,
    title: row.title,
    configSnapshot: row.config_snapshot,
    isPinned: boolToInt(intToBool(row.is_pinned)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function messageRowPayload(row: AiMessageRow): AiMessageRowPayload {
  return {
    id: row.id,
    threadId: row.thread_id,
    role: row.role,
    contentJson: row.content_json,
    createdAt: row.created_at,
  };
}

function threadTagRowPayload(row: AiThreadTagRow): AiThreadTagRowPayload {
  return {
    id: row.id,
    threadId: row.thread_id,
    tag: row.tag,
    createdAt: row.created_at,
  };
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

function readRequiredMessageRow(db: Database, messageId: string): AiMessageRow {
  const row = db
    .query<AiMessageRow, [string]>(
      `
        SELECT id, thread_id, role, content_json, created_at
        FROM ai_messages
        WHERE id = ?
      `,
    )
    .get(messageId);
  if (!row) {
    throw aiChatError("invalid_input", `Message ${messageId} not found`, 400);
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
