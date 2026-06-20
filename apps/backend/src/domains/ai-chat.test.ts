import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import {
  type AiMessageSyncEvent,
  createAiChatService,
  type AiThreadSyncEvent,
  type AiThreadTagSyncEvent,
} from "./ai-chat";
import type { ResolvedAiChatProviderConfig } from "./ai-providers";

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
      expect(() => service.listThreads({ limit: -1 })).toThrow("limit must be a u32 integer");
      expect(() => service.listThreads({ limit: 1.5 })).toThrow("limit must be a u32 integer");
      expect(() => service.listThreads({ limit: 4_294_967_296 })).toThrow(
        "limit must be a u32 integer",
      );
      expect(service.getThread("thread-pinned")).toMatchObject({
        id: "thread-pinned",
        tags: [],
      });
      expect(() => service.listThreads({ cursor: "" })).toThrow("Expected format");
      expect(service.listThreads({ cursor: "2:2026-01-03T00:00:00Z:thread-b" })).toMatchObject({
        threads: [{ id: "thread-pinned" }, { id: "thread-b" }, { id: "thread-a" }],
      });
      expect(service.listThreads({ cursor: "0:2026-01-03T00:00:00Z:" })).toMatchObject({
        threads: [{ id: "thread-a" }],
      });
      expect(() => service.listThreads({ cursor: "1e0:2026-01-03T00:00:00Z:thread-b" })).toThrow(
        "Invalid is_pinned value: 1e0",
      );
      expect(() =>
        service.listThreads({ cursor: "2147483648:2026-01-03T00:00:00Z:thread-b" }),
      ).toThrow("Invalid is_pinned value: 2147483648");
      expect(
        service.listThreads({ cursor: "+1:2026-01-01T00:00:00Z:thread-pinned" }),
      ).toMatchObject({
        threads: [{ id: "thread-b" }, { id: "thread-a" }],
      });
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

  test("nulls malformed thread config snapshots like Rust storage", () => {
    const db = createAiChatDb();
    const service = createAiChatService(db);

    try {
      seedThread(db, { id: "thread-1", title: "Valid" });
      expect(service.getThread("thread-1")?.config).toMatchObject({
        schemaVersion: 1,
        providerId: "ollama",
      });

      seedThread(db, { id: "thread-2", title: "Malformed" });
      db.prepare("UPDATE ai_threads SET config_snapshot = ? WHERE id = ?").run(
        JSON.stringify({
          schemaVersion: 4_294_967_296,
          providerId: "ollama",
          modelId: "llama3",
          promptTemplateId: "wealthfolio-assistant-v1",
          promptVersion: "1.0.0",
        }),
        "thread-2",
      );

      expect(service.getThread("thread-2")?.config).toBeNull();
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

  test("rejects stored message content whose schemaVersion is not u32", () => {
    const db = createAiChatDb();
    const service = createAiChatService(db);

    try {
      seedThread(db, { id: "thread-1", title: "Malformed" });
      seedMessage(db, {
        id: "message-1",
        threadId: "thread-1",
        role: "assistant",
        content: { schemaVersion: 4_294_967_296, parts: [] },
      });

      expect(() => service.getMessages("thread-1")).toThrow("Invalid AI message content JSON");
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

  test("streams OpenAI-compatible text and persists user and assistant messages", async () => {
    const db = createAiChatDb();
    const syncEvents: SyncEvent[] = [];
    const fetchCalls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const service = createAiChatService(db, {
      aiProviderService: createProviderResolver({
        providerId: "openai",
        modelId: "gpt-test",
        providerType: "api",
        baseUrl: "https://api.openai.test",
        apiKey: "secret-key",
      }),
      fetch: async (input, init) => {
        fetchCalls.push({
          url: String(input),
          body: JSON.parse(String(init?.body)),
        });
        return streamResponse([
          'data: {"choices":[{"delta":{"content":"Hel',
          'lo"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
          "data: [DONE]\n\n",
        ]);
      },
      queueThreadSyncEvent: (event) => syncEvents.push({ entity: "thread", event }),
      queueMessageSyncEvent: (event) => syncEvents.push({ entity: "message", event }),
      queueThreadTagSyncEvent: (event) => syncEvents.push({ entity: "tag", event }),
    });

    try {
      const events = await collectEvents(await service.sendMessage({ content: "Hello?" }));

      expect(events.map((event) => event.type)).toEqual([
        "system",
        "textDelta",
        "textDelta",
        "done",
      ]);
      expect(events[0]).toEqual({
        type: "system",
        threadId: expect.any(String),
        runId: expect.any(String),
        messageId: expect.any(String),
      });
      expect(events[3]).toMatchObject({
        type: "done",
        message: {
          id: events[0]?.messageId,
          threadId: events[0]?.threadId,
          role: "assistant",
          content: textContent("Hello world"),
        },
      });
      expect(fetchCalls[0]).toMatchObject({
        url: "https://api.openai.test/v1/chat/completions",
        body: {
          model: "gpt-test",
          stream: true,
          messages: [
            expect.objectContaining({ role: "system" }),
            { role: "user", content: "Hello?" },
          ],
        },
      });

      const threadId = String(events[0]?.threadId);
      expect(service.getThread(threadId)).toMatchObject({
        id: threadId,
        title: "Hello?",
        config: expect.objectContaining({
          providerId: "openai",
          modelId: "gpt-test",
          toolsAllowlist: [],
        }),
      });
      expect(service.getMessages(threadId)).toMatchObject([
        { role: "user", content: textContent("Hello?") },
        { role: "assistant", content: textContent("Hello world") },
      ]);
      expect(syncEvents.map((item) => [item.entity, item.event.operation])).toEqual([
        ["thread", "Create"],
        ["message", "Create"],
        ["message", "Create"],
        ["thread", "Update"],
      ]);
    } finally {
      db.close();
    }
  });

  test("parses streamed think tags into reasoning deltas and persisted parts", async () => {
    const db = createAiChatDb();
    const service = createAiChatService(db, {
      aiProviderService: createProviderResolver({
        providerId: "openai",
        modelId: "gpt-test",
        providerType: "api",
        baseUrl: "https://api.openai.test",
        apiKey: "secret-key",
      }),
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        if (body.stream === false) {
          return new Response("title unavailable", { status: 503 });
        }
        return streamResponse([
          'data: {"choices":[{"delta":{"content":"<think>risk"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":" math</think>Answer"}}]}\n\n',
          "data: [DONE]\n\n",
        ]);
      },
    });

    try {
      const events = await collectEvents(await service.sendMessage({ content: "Think" }));

      expect(events.map((event) => event.type)).toEqual([
        "system",
        "reasoningDelta",
        "textDelta",
        "done",
      ]);
      expect(events[1]).toMatchObject({ type: "reasoningDelta", delta: "risk math" });
      expect(events[2]).toMatchObject({ type: "textDelta", delta: "Answer" });
      expect(events[3]).toMatchObject({
        type: "done",
        message: {
          content: {
            schemaVersion: 1,
            parts: [
              { type: "reasoning", content: "risk math" },
              { type: "text", content: "Answer" },
            ],
          },
        },
      });
      const threadId = String(events[0]?.threadId);
      expect(service.getMessages(threadId)).toMatchObject([
        { role: "user", content: textContent("Think") },
        {
          role: "assistant",
          content: {
            parts: [
              { type: "reasoning", content: "risk math" },
              { type: "text", content: "Answer" },
            ],
          },
        },
      ]);
    } finally {
      db.close();
    }
  });

  test("preserves text before partial streamed think tags", async () => {
    const db = createAiChatDb();
    const service = createAiChatService(db, {
      aiProviderService: createProviderResolver({
        providerId: "openai",
        modelId: "gpt-test",
        providerType: "api",
        baseUrl: "https://api.openai.test",
        apiKey: "secret-key",
      }),
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        if (body.stream === false) {
          return new Response("title unavailable", { status: 503 });
        }
        return streamResponse([
          sseData({ choices: [{ delta: { content: "hello<th" } }] }),
          sseData({ choices: [{ delta: { content: "ink>risk</think>Done" } }] }),
          "data: [DONE]\n\n",
        ]);
      },
    });

    try {
      const events = await collectEvents(await service.sendMessage({ content: "Think split" }));

      expect(events.map((event) => event.type)).toEqual([
        "system",
        "textDelta",
        "reasoningDelta",
        "textDelta",
        "done",
      ]);
      expect(events[1]).toMatchObject({ type: "textDelta", delta: "hello" });
      expect(events[2]).toMatchObject({ type: "reasoningDelta", delta: "risk" });
      expect(events[3]).toMatchObject({ type: "textDelta", delta: "Done" });
      expect(events[4]).toMatchObject({
        type: "done",
        message: {
          content: {
            parts: [
              { type: "text", content: "hello" },
              { type: "reasoning", content: "risk" },
              { type: "text", content: "Done" },
            ],
          },
        },
      });
    } finally {
      db.close();
    }
  });

  test("streams provider-native reasoning deltas and persists ordered parts", async () => {
    const db = createAiChatDb();
    const service = createAiChatService(db, {
      aiProviderService: createProviderResolver({
        providerId: "openai",
        modelId: "gpt-test",
        providerType: "api",
        baseUrl: "https://api.openai.test",
        apiKey: "secret-key",
      }),
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        if (body.stream === false) {
          return new Response("title unavailable", { status: 503 });
        }
        return streamResponse([
          'data: {"choices":[{"delta":{"reasoning_content":"check risk"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"Answer"}}]}\n\n',
          "data: [DONE]\n\n",
        ]);
      },
    });

    try {
      const events = await collectEvents(
        await service.sendMessage({ content: "Native reasoning" }),
      );

      expect(events.map((event) => event.type)).toEqual([
        "system",
        "reasoningDelta",
        "textDelta",
        "done",
      ]);
      expect(events[1]).toMatchObject({ type: "reasoningDelta", delta: "check risk" });
      expect(events[2]).toMatchObject({ type: "textDelta", delta: "Answer" });
      expect(events[3]).toMatchObject({
        type: "done",
        message: {
          content: {
            parts: [
              { type: "reasoning", content: "check risk" },
              { type: "text", content: "Answer" },
            ],
          },
        },
      });
    } finally {
      db.close();
    }
  });

  test("streams Anthropic thinking deltas as reasoning", async () => {
    const db = createAiChatDb();
    const service = createAiChatService(db, {
      aiProviderService: createProviderResolver({
        providerId: "anthropic",
        modelId: "claude-test",
        providerType: "api",
        baseUrl: "https://api.anthropic.test",
        apiKey: "secret-key",
      }),
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        if (body.stream !== true) {
          return new Response("title unavailable", { status: 503 });
        }
        return streamResponse([
          'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"consider"}}\n\n',
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Done"}}\n\n',
        ]);
      },
    });

    try {
      const events = await collectEvents(
        await service.sendMessage({ content: "Anthropic native" }),
      );

      expect(events.map((event) => event.type)).toEqual([
        "system",
        "reasoningDelta",
        "textDelta",
        "done",
      ]);
      expect(events[1]).toMatchObject({ type: "reasoningDelta", delta: "consider" });
      expect(events[2]).toMatchObject({ type: "textDelta", delta: "Done" });
    } finally {
      db.close();
    }
  });

  test("streams Ollama thinking fields as reasoning", async () => {
    const db = createAiChatDb();
    const service = createAiChatService(db, {
      aiProviderService: createProviderResolver({
        providerId: "ollama",
        modelId: "llama3",
        providerType: "local",
        baseUrl: "http://localhost:11434/v1",
      }),
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        if (body.stream === false) {
          return new Response("title unavailable", { status: 503 });
        }
        return streamResponse([
          '{"message":{"thinking":"consider local"},"done":false}\n',
          '{"message":{"content":"Ready"},"done":false}\n',
          '{"done":true}\n',
        ]);
      },
    });

    try {
      const events = await collectEvents(await service.sendMessage({ content: "Ollama native" }));

      expect(events.map((event) => event.type)).toEqual([
        "system",
        "reasoningDelta",
        "textDelta",
        "done",
      ]);
      expect(events[1]).toMatchObject({
        type: "reasoningDelta",
        delta: "consider local",
      });
      expect(events[2]).toMatchObject({ type: "textDelta", delta: "Ready" });
    } finally {
      db.close();
    }
  });

  test("streams Google thought parts as reasoning", async () => {
    const db = createAiChatDb();
    const service = createAiChatService(db, {
      aiProviderService: createProviderResolver({
        providerId: "google",
        modelId: "gemini-test",
        providerType: "api",
        baseUrl: "https://generativelanguage.googleapis.com",
        apiKey: "secret-key",
      }),
      fetch: async (input) => {
        const url = String(input);
        if (!url.includes(":streamGenerateContent")) {
          return new Response("title unavailable", { status: 503 });
        }
        return streamResponse([
          'data: {"candidates":[{"content":{"parts":[{"text":"reflect","thought":true},{"text":"Visible"}]}}]}\n\n',
        ]);
      },
    });

    try {
      const events = await collectEvents(await service.sendMessage({ content: "Google native" }));

      expect(events.map((event) => event.type)).toEqual([
        "system",
        "reasoningDelta",
        "textDelta",
        "done",
      ]);
      expect(events[1]).toMatchObject({ type: "reasoningDelta", delta: "reflect" });
      expect(events[2]).toMatchObject({ type: "textDelta", delta: "Visible" });
    } finally {
      db.close();
    }
  });

  test("executes OpenAI-compatible tool calls, streams results, and persists ordered parts", async () => {
    const db = createAiChatDb();
    const fetchBodies: Array<Record<string, unknown>> = [];
    const executed: Array<{ name: string; args: unknown }> = [];
    const service = createAiChatService(db, {
      aiProviderService: createProviderResolver({
        providerId: "openai",
        modelId: "gpt-tools",
        providerType: "api",
        baseUrl: "https://api.openai.test",
        apiKey: "secret-key",
        capabilities: { tools: true, thinking: false, vision: false, streaming: true },
      }),
      tools: [
        {
          name: "get_accounts",
          description: "List accounts",
          parameters: { type: "object", properties: { active: { type: "boolean" } } },
          execute: (args) => {
            executed.push({ name: "get_accounts", args });
            return { data: { accounts: [{ id: "acct-1", name: "Brokerage" }] } };
          },
        },
        {
          name: "import_csv",
          description: "Infer CSV import mapping",
          parameters: { type: "object", properties: { csvContent: { type: "string" } } },
          execute: (args) => {
            executed.push({ name: "import_csv", args });
            return { data: { mappingConfidence: "HIGH" }, meta: { rows: 1 } };
          },
        },
      ],
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        if (body.stream === false) {
          return new Response("title unavailable", { status: 503 });
        }
        fetchBodies.push(body);
        if (fetchBodies.length === 1) {
          return streamResponse([
            sseData({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: "call-accounts",
                        type: "function",
                        function: {
                          name: "get_accounts",
                          arguments: '{"active":true}',
                        },
                      },
                      {
                        index: 1,
                        id: "call-import",
                        type: "function",
                        function: {
                          name: "import_csv",
                          arguments: '{"csvContent":"Date',
                        },
                      },
                    ],
                  },
                },
              ],
            }),
            sseData({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 1,
                        function: {
                          arguments: ',Symbol\\n2025-01-01,AAPL","accountId":"acct-1"}',
                        },
                      },
                    ],
                  },
                  finish_reason: "tool_calls",
                },
              ],
            }),
            "data: [DONE]\n\n",
          ]);
        }
        return streamResponse([
          sseData({ choices: [{ delta: { content: "Mapped the import." } }] }),
          "data: [DONE]\n\n",
        ]);
      },
    });

    try {
      const events = await collectEvents(
        await service.sendMessage({
          content: "Import this CSV",
          allowedTools: ["get_accounts", "import_csv"],
        }),
      );

      expect(events.map((event) => event.type)).toEqual([
        "system",
        "toolCall",
        "toolCall",
        "toolResult",
        "toolResult",
        "textDelta",
        "done",
      ]);
      expect(events[1]?.toolCall).toMatchObject({
        id: "call-accounts",
        name: "get_accounts",
        arguments: { active: true },
      });
      expect(events[2]?.toolCall).toMatchObject({
        id: "call-import",
        name: "import_csv",
        arguments: {
          csvContent: "Date,Symbol\n2025-01-01,AAPL",
          accountId: "acct-1",
        },
      });
      expect(events[4]?.result).toMatchObject({
        toolCallId: "call-import",
        success: true,
        data: { mappingConfidence: "HIGH" },
        meta: { rows: 1 },
      });
      expect(executed).toEqual([
        { name: "get_accounts", args: { active: true } },
        {
          name: "import_csv",
          args: { csvContent: "Date,Symbol\n2025-01-01,AAPL", accountId: "acct-1" },
        },
      ]);

      const firstRequest = fetchBodies[0];
      expect(firstRequest?.tools).toHaveLength(2);
      expect(firstRequest?.messages).toEqual([
        expect.objectContaining({
          role: "system",
          content: expect.stringContaining("Available tools: get_accounts, import_csv"),
        }),
        { role: "user", content: "Import this CSV" },
      ]);
      const followUpMessages = fetchBodies[1]?.messages as Array<Record<string, unknown>>;
      expect(followUpMessages).toEqual([
        expect.objectContaining({ role: "system" }),
        { role: "user", content: "Import this CSV" },
        expect.objectContaining({
          role: "assistant",
          tool_calls: [
            expect.objectContaining({ id: "call-accounts" }),
            expect.objectContaining({ id: "call-import" }),
          ],
        }),
        {
          role: "tool",
          tool_call_id: "call-accounts",
          content: '{"accounts":[{"id":"acct-1","name":"Brokerage"}]}',
        },
        { role: "tool", tool_call_id: "call-import", content: '{"mappingConfidence":"HIGH"}' },
      ]);

      expect(events[6]).toMatchObject({
        type: "done",
        message: {
          content: {
            parts: [
              {
                type: "toolCall",
                toolCallId: "call-accounts",
                name: "get_accounts",
                arguments: { active: true },
              },
              {
                type: "toolCall",
                toolCallId: "call-import",
                name: "import_csv",
                arguments: { csvContent: "<redacted>", accountId: "acct-1" },
              },
              {
                type: "toolResult",
                toolCallId: "call-accounts",
                success: true,
                data: { accounts: [{ id: "acct-1", name: "Brokerage" }] },
              },
              {
                type: "toolResult",
                toolCallId: "call-import",
                success: true,
                data: { mappingConfidence: "HIGH" },
                meta: { rows: 1 },
              },
              { type: "text", content: "Mapped the import." },
            ],
          },
        },
      });
    } finally {
      db.close();
    }
  });

  test("streams failed tool execution results and continues the provider round-trip", async () => {
    const db = createAiChatDb();
    const fetchBodies: Array<Record<string, unknown>> = [];
    const service = createAiChatService(db, {
      aiProviderService: createProviderResolver({
        providerId: "openai",
        modelId: "gpt-tools",
        providerType: "api",
        baseUrl: "https://api.openai.test",
        apiKey: "secret-key",
        capabilities: { tools: true, thinking: false, vision: false, streaming: true },
      }),
      tools: [
        {
          name: "get_accounts",
          description: "List accounts",
          parameters: { type: "object", properties: {} },
          execute: () => {
            throw new Error("account service unavailable");
          },
        },
      ],
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        if (body.stream === false) {
          return new Response("title unavailable", { status: 503 });
        }
        fetchBodies.push(body);
        if (fetchBodies.length === 1) {
          return streamResponse([
            sseData({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: "call-failing",
                        type: "function",
                        function: { name: "get_accounts", arguments: "{}" },
                      },
                    ],
                  },
                  finish_reason: "tool_calls",
                },
              ],
            }),
            "data: [DONE]\n\n",
          ]);
        }
        return streamResponse([
          sseData({ choices: [{ delta: { content: "I could not access accounts." } }] }),
          "data: [DONE]\n\n",
        ]);
      },
    });

    try {
      const events = await collectEvents(await service.sendMessage({ content: "Show accounts" }));

      expect(events.map((event) => event.type)).toEqual([
        "system",
        "toolCall",
        "toolResult",
        "textDelta",
        "done",
      ]);
      expect(events[2]?.result).toMatchObject({
        toolCallId: "call-failing",
        success: false,
        data: null,
        error: "account service unavailable",
      });
      const followUpMessages = fetchBodies[1]?.messages as Array<Record<string, unknown>>;
      expect(followUpMessages.at(-1)).toEqual({
        role: "tool",
        tool_call_id: "call-failing",
        content: '{"error":"account service unavailable"}',
      });
      expect(events[4]).toMatchObject({
        type: "done",
        message: {
          content: {
            parts: [
              { type: "toolCall", toolCallId: "call-failing" },
              {
                type: "toolResult",
                toolCallId: "call-failing",
                success: false,
                error: "account service unavailable",
              },
              { type: "text", content: "I could not access accounts." },
            ],
          },
        },
      });
    } finally {
      db.close();
    }
  });

  test("omits tool schemas when the model lacks tool capability", async () => {
    const db = createAiChatDb();
    const fetchBodies: Array<Record<string, unknown>> = [];
    const service = createAiChatService(db, {
      aiProviderService: createProviderResolver({
        providerId: "openai",
        modelId: "gpt-text",
        providerType: "api",
        baseUrl: "https://api.openai.test",
        apiKey: "secret-key",
        capabilities: { tools: false, thinking: false, vision: false, streaming: true },
      }),
      tools: [
        {
          name: "get_accounts",
          description: "List accounts",
          parameters: { type: "object", properties: {} },
          execute: () => ({ data: {} }),
        },
      ],
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        if (body.stream === false) {
          return new Response("title unavailable", { status: 503 });
        }
        fetchBodies.push(body);
        return streamResponse([
          sseData({ choices: [{ delta: { content: "No tools exposed." } }] }),
          "data: [DONE]\n\n",
        ]);
      },
    });

    try {
      const events = await collectEvents(await service.sendMessage({ content: "Show accounts" }));

      expect(events.map((event) => event.type)).toEqual(["system", "textDelta", "done"]);
      expect(fetchBodies[0]).not.toHaveProperty("tools");
      expect(fetchBodies[0]?.messages).toEqual([
        expect.objectContaining({
          role: "system",
          content: expect.stringContaining("Portfolio tools and mutation tools are not available"),
        }),
        { role: "user", content: "Show accounts" },
      ]);
    } finally {
      db.close();
    }
  });

  test("executes Ollama tool calls with the injected tool registry", async () => {
    const db = createAiChatDb();
    const fetchBodies: Array<Record<string, unknown>> = [];
    const service = createAiChatService(db, {
      aiProviderService: createProviderResolver({
        providerId: "ollama",
        modelId: "llama3",
        providerType: "local",
        baseUrl: "http://localhost:11434/v1",
        capabilities: { tools: true, thinking: false, vision: false, streaming: true },
      }),
      tools: [
        {
          name: "get_accounts",
          description: "List accounts",
          parameters: { type: "object", properties: {} },
          execute: () => ({ data: { accounts: [] } }),
        },
      ],
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        if (body.stream === false) {
          return new Response("title unavailable", { status: 503 });
        }
        fetchBodies.push(body);
        if (fetchBodies.length === 1) {
          return streamResponse([
            '{"message":{"tool_calls":[{"id":"ollama-call","function":{"name":"get_accounts","arguments":{}}}]},"done":false}\n',
            '{"done":true}\n',
          ]);
        }
        return streamResponse([
          '{"message":{"content":"No accounts found."},"done":false}\n',
          '{"done":true}\n',
        ]);
      },
    });

    try {
      const events = await collectEvents(await service.sendMessage({ content: "Show accounts" }));

      expect(events.map((event) => event.type)).toEqual([
        "system",
        "toolCall",
        "toolResult",
        "textDelta",
        "done",
      ]);
      expect(fetchBodies[0]?.tools).toHaveLength(1);
      expect(fetchBodies[1]?.messages).toEqual([
        expect.objectContaining({ role: "system" }),
        { role: "user", content: "Show accounts" },
        expect.objectContaining({
          role: "assistant",
          tool_calls: [
            expect.objectContaining({
              id: "ollama-call",
              function: expect.objectContaining({ name: "get_accounts" }),
            }),
          ],
        }),
        { role: "tool", tool_call_id: "ollama-call", content: '{"accounts":[]}' },
      ]);
    } finally {
      db.close();
    }
  });

  test("executes Anthropic tool_use blocks and sends grouped tool_result blocks", async () => {
    const db = createAiChatDb();
    const fetchBodies: Array<Record<string, unknown>> = [];
    const executed: Array<{ name: string; args: unknown }> = [];
    const service = createAiChatService(db, {
      aiProviderService: createProviderResolver({
        providerId: "anthropic",
        modelId: "claude-tools",
        providerType: "api",
        baseUrl: "https://api.anthropic.test",
        apiKey: "secret-key",
        capabilities: { tools: true, thinking: false, vision: false, streaming: true },
      }),
      tools: [
        {
          name: "get_accounts",
          description: "List accounts",
          parameters: {
            type: "object",
            properties: { displayMode: { type: "string" } },
          },
          execute: (args) => {
            executed.push({ name: "get_accounts", args });
            return { data: { accounts: [] } };
          },
        },
        {
          name: "failing_tool",
          description: "Fails for tests",
          parameters: { type: "object", properties: {} },
          execute: (args) => {
            executed.push({ name: "failing_tool", args });
            throw new Error("tool exploded");
          },
        },
      ],
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        if (body.stream !== true) {
          return new Response("title unavailable", { status: 503 });
        }
        fetchBodies.push(body);
        if (fetchBodies.length === 1) {
          return streamResponse([
            sseData({
              type: "content_block_start",
              index: 0,
              content_block: { type: "tool_use", id: "toolu-accounts", name: "get_accounts" },
            }),
            sseData({
              type: "content_block_delta",
              index: 0,
              delta: { type: "input_json_delta", partial_json: '{"display' },
            }),
            sseData({
              type: "content_block_delta",
              index: 0,
              delta: { type: "input_json_delta", partial_json: 'Mode":"compact"}' },
            }),
            sseData({ type: "content_block_stop", index: 0 }),
            sseData({
              type: "content_block_start",
              index: 1,
              content_block: { type: "tool_use", id: "toolu-failing", name: "failing_tool" },
            }),
            sseData({ type: "content_block_stop", index: 1 }),
          ]);
        }
        return streamResponse([
          sseData({
            type: "content_block_delta",
            delta: { type: "text_delta", text: "Checked the tools." },
          }),
        ]);
      },
    });

    try {
      const events = await collectEvents(
        await service.sendMessage({ content: "Use Anthropic tools" }),
      );

      expect(events.map((event) => event.type)).toEqual([
        "system",
        "toolCall",
        "toolCall",
        "toolResult",
        "toolResult",
        "textDelta",
        "done",
      ]);
      expect(events[1]?.toolCall).toMatchObject({
        id: "toolu-accounts",
        name: "get_accounts",
        arguments: { displayMode: "compact" },
      });
      expect(events[2]?.toolCall).toMatchObject({
        id: "toolu-failing",
        name: "failing_tool",
        arguments: {},
      });
      expect(events[4]?.result).toMatchObject({
        toolCallId: "toolu-failing",
        success: false,
        error: "tool exploded",
      });
      expect(executed).toEqual([
        { name: "get_accounts", args: { displayMode: "compact" } },
        { name: "failing_tool", args: {} },
      ]);

      expect(fetchBodies[0]).toMatchObject({
        system: expect.stringContaining("Available tools: get_accounts, failing_tool"),
        tools: [
          expect.objectContaining({
            name: "get_accounts",
            input_schema: expect.objectContaining({ type: "object" }),
          }),
          expect.objectContaining({ name: "failing_tool" }),
        ],
        messages: [{ role: "user", content: "Use Anthropic tools" }],
      });
      expect(fetchBodies[1]?.messages).toEqual([
        { role: "user", content: "Use Anthropic tools" },
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu-accounts",
              name: "get_accounts",
              input: { displayMode: "compact" },
            },
            { type: "tool_use", id: "toolu-failing", name: "failing_tool", input: {} },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu-accounts",
              content: '{"accounts":[]}',
            },
            {
              type: "tool_result",
              tool_use_id: "toolu-failing",
              content: "tool exploded",
              is_error: true,
            },
          ],
        },
      ]);
    } finally {
      db.close();
    }
  });

  test("executes Google function calls and omits synthetic function response ids", async () => {
    const db = createAiChatDb();
    const fetchBodies: Array<Record<string, unknown>> = [];
    const service = createAiChatService(db, {
      aiProviderService: createProviderResolver({
        providerId: "google",
        modelId: "gemini-tools",
        providerType: "api",
        baseUrl: "https://generativelanguage.googleapis.com",
        apiKey: "secret-key",
        capabilities: { tools: true, thinking: false, vision: false, streaming: true },
      }),
      tools: [
        {
          name: "get_accounts",
          description: "List accounts",
          parameters: {
            type: "object",
            properties: { displayMode: { type: "string" } },
          },
          execute: () => ({ data: { accounts: [{ id: "acct-1" }] } }),
        },
      ],
      fetch: async (input, init) => {
        const url = String(input);
        if (!url.includes(":streamGenerateContent")) {
          return new Response("title unavailable", { status: 503 });
        }
        const body = JSON.parse(String(init?.body));
        fetchBodies.push(body);
        if (fetchBodies.length === 1) {
          return streamResponse([
            sseData({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        functionCall: {
                          name: "get_accounts",
                          args: { displayMode: "compact" },
                        },
                      },
                    ],
                  },
                },
              ],
            }),
          ]);
        }
        return streamResponse([
          sseData({
            candidates: [{ content: { parts: [{ text: "Found one account." }] } }],
          }),
        ]);
      },
    });

    try {
      const events = await collectEvents(
        await service.sendMessage({ content: "Use Gemini tools" }),
      );

      expect(events.map((event) => event.type)).toEqual([
        "system",
        "toolCall",
        "toolResult",
        "textDelta",
        "done",
      ]);
      expect(events[1]?.toolCall).toMatchObject({
        id: expect.stringMatching(/^google-tool-call-/),
        name: "get_accounts",
        arguments: { displayMode: "compact" },
      });
      expect(fetchBodies[0]).toMatchObject({
        tools: [
          {
            functionDeclarations: [
              expect.objectContaining({
                name: "get_accounts",
                parameters: expect.objectContaining({ type: "object" }),
              }),
            ],
          },
        ],
        contents: [{ role: "user", parts: [{ text: "Use Gemini tools" }] }],
      });

      const followUpContents = fetchBodies[1]?.contents as Array<Record<string, unknown>>;
      expect(followUpContents).toEqual([
        { role: "user", parts: [{ text: "Use Gemini tools" }] },
        {
          role: "model",
          parts: [
            {
              functionCall: {
                name: "get_accounts",
                args: { displayMode: "compact" },
              },
            },
          ],
        },
        {
          role: "user",
          parts: [
            {
              functionResponse: {
                name: "get_accounts",
                response: { result: { accounts: [{ id: "acct-1" }] } },
              },
            },
          ],
        },
      ]);
      expect(
        (
          ((followUpContents[2]?.parts as Array<Record<string, unknown>>)[0]?.functionResponse ??
            {}) as Record<string, unknown>
        ).id,
      ).toBeUndefined();
    } finally {
      db.close();
    }
  });

  test("generates, persists, and emits refined thread titles", async () => {
    const db = createAiChatDb();
    const fetchBodies: Array<Record<string, unknown>> = [];
    const syncEvents: SyncEvent[] = [];
    const service = createAiChatService(db, {
      aiProviderService: createProviderResolver({
        providerId: "openai",
        modelId: "gpt-chat",
        titleModelId: "gpt-title",
        providerType: "api",
        baseUrl: "https://api.openai.test",
        apiKey: "secret-key",
      }),
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        fetchBodies.push(body);
        if (body.stream === false) {
          return Response.json({ choices: [{ message: { content: '"Portfolio Review"' } }] });
        }
        return streamResponse([
          'data: {"choices":[{"delta":{"content":"Done"}}]}\n\n',
          "data: [DONE]\n\n",
        ]);
      },
      queueThreadSyncEvent: (event) => syncEvents.push({ entity: "thread", event }),
      queueMessageSyncEvent: (event) => syncEvents.push({ entity: "message", event }),
      queueThreadTagSyncEvent: (event) => syncEvents.push({ entity: "tag", event }),
    });

    try {
      const events = await collectEvents(
        await service.sendMessage({ content: "Can you analyze my portfolio risk in detail?" }),
      );

      expect(events.map((event) => event.type)).toEqual([
        "system",
        "textDelta",
        "threadTitleUpdated",
        "done",
      ]);
      expect(events[2]).toMatchObject({
        type: "threadTitleUpdated",
        title: "Portfolio Review",
        threadId: events[0]?.threadId,
        runId: events[0]?.runId,
      });
      expect(fetchBodies[1]).toMatchObject({
        model: "gpt-title",
        stream: false,
        max_tokens: 20,
      });
      const titlePrompt = String(
        (fetchBodies[1]?.messages as Array<{ content: string }>)[0]?.content,
      );
      expect(titlePrompt).toContain("Generate a very short plain-text title");
      expect(titlePrompt).toContain("Can you analyze my portfolio risk in detail?");

      const threadId = String(events[0]?.threadId);
      expect(service.getThread(threadId)?.title).toBe("Portfolio Review");
      expect(syncEvents).toContainEqual(
        expect.objectContaining({
          entity: "thread",
          event: expect.objectContaining({
            operation: "Update",
            payload: expect.objectContaining({ title: "Portfolio Review" }),
          }),
        }),
      );
    } finally {
      db.close();
    }
  });

  test("keeps deterministic titles when title generation falls back to the current title", async () => {
    const db = createAiChatDb();
    const fetchBodies: Array<Record<string, unknown>> = [];
    const syncEvents: SyncEvent[] = [];
    const service = createAiChatService(db, {
      aiProviderService: createProviderResolver({
        providerId: "openai",
        modelId: "gpt-chat",
        providerType: "api",
        baseUrl: "https://api.openai.test",
        apiKey: "secret-key",
      }),
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        fetchBodies.push(body);
        if (body.stream === false) {
          return new Response("title unavailable", { status: 503 });
        }
        return streamResponse([
          'data: {"choices":[{"delta":{"content":"Done"}}]}\n\n',
          "data: [DONE]\n\n",
        ]);
      },
      queueThreadSyncEvent: (event) => syncEvents.push({ entity: "thread", event }),
      queueMessageSyncEvent: (event) => syncEvents.push({ entity: "message", event }),
      queueThreadTagSyncEvent: (event) => syncEvents.push({ entity: "tag", event }),
    });

    try {
      const events = await collectEvents(
        await service.sendMessage({
          content: "Review attachment",
          attachments: [{ name: "statement.csv", contentType: "text/csv", data: "symbol\nAAPL" }],
        }),
      );

      expect(events.map((event) => event.type)).toEqual(["system", "textDelta", "done"]);
      expect(fetchBodies).toHaveLength(2);
      const titlePrompt = String(
        (fetchBodies[1]?.messages as Array<{ content: string }>)[0]?.content,
      );
      expect(titlePrompt).toContain('Message:\n"Review attachment"');
      expect(titlePrompt).not.toContain("AAPL");
      const threadId = String(events[0]?.threadId);
      expect(service.getThread(threadId)?.title).toBe("Review attachment");
      expect(
        syncEvents.filter((item) => item.entity === "thread" && item.event.operation === "Update"),
      ).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  test("does not persist generated titles when provider streams fail", async () => {
    const db = createAiChatDb();
    const service = createAiChatService(db, {
      aiProviderService: createProviderResolver({
        providerId: "openai",
        modelId: "gpt-chat",
        titleModelId: "gpt-title",
        providerType: "api",
        baseUrl: "https://api.openai.test",
        apiKey: "secret-key",
      }),
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        if (body.stream === false) {
          return Response.json({ choices: [{ message: { content: "Generated Title" } }] });
        }
        return erroringStreamResponse(['data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n']);
      },
    });

    try {
      const events = await collectEvents(await service.sendMessage({ content: "Stream failure" }));

      expect(events.map((event) => event.type)).toEqual(["system", "textDelta", "error"]);
      const threadId = String(events[0]?.threadId);
      expect(service.getThread(threadId)?.title).toBe("Stream failure");
      expect(service.getMessages(threadId)).toMatchObject([{ role: "user" }]);
    } finally {
      db.close();
    }
  });

  test("streams Ollama text with parent-truncated history for existing threads", async () => {
    const db = createAiChatDb();
    const fetchBodies: Array<Record<string, unknown>> = [];
    const service = createAiChatService(db, {
      aiProviderService: createProviderResolver({
        providerId: "ollama",
        modelId: "llama3",
        providerType: "local",
        baseUrl: "http://localhost:11434/v1",
      }),
      fetch: async (_input, init) => {
        fetchBodies.push(JSON.parse(String(init?.body)));
        return streamResponse([
          '{"message":{"content":"Answer"},"done":false}\n',
          '{"done":true}\n',
        ]);
      },
    });

    try {
      seedThread(db, { id: "thread-1", title: "Existing" });
      seedMessage(db, {
        id: "before-parent",
        threadId: "thread-1",
        role: "user",
        content: textContent("Before parent"),
      });
      seedMessage(db, {
        id: "parent-message",
        threadId: "thread-1",
        role: "assistant",
        content: textContent("Parent answer"),
      });
      seedMessage(db, {
        id: "after-parent",
        threadId: "thread-1",
        role: "user",
        content: textContent("Should be truncated"),
      });

      const events = await collectEvents(
        await service.sendMessage({
          threadId: "thread-1",
          parentMessageId: "parent-message",
          content: "Continue",
        }),
      );

      expect(events.map((event) => event.type)).toEqual(["system", "textDelta", "done"]);
      expect(fetchBodies[0]).toMatchObject({
        model: "llama3",
        stream: true,
        messages: [
          expect.objectContaining({ role: "system" }),
          { role: "user", content: "Before parent" },
          { role: "assistant", content: "Parent answer" },
          { role: "user", content: "Continue" },
        ],
      });
    } finally {
      db.close();
    }
  });

  test("injects text attachments into provider prompts while persisting only markers", async () => {
    const db = createAiChatDb();
    const fetchBodies: Array<Record<string, unknown>> = [];
    const service = createAiChatService(db, {
      aiProviderService: createProviderResolver({
        providerId: "openai",
        modelId: "gpt-test",
        providerType: "api",
        baseUrl: "https://api.openai.test",
        apiKey: "secret-key",
      }),
      fetch: async (_input, init) => {
        fetchBodies.push(JSON.parse(String(init?.body)));
        return streamResponse([
          'data: {"choices":[{"delta":{"content":"Reviewed"}}]}\n\n',
          "data: [DONE]\n\n",
        ]);
      },
    });

    try {
      const events = await collectEvents(
        await service.sendMessage({
          content: "Review the attachment",
          attachments: [
            {
              name: "statement.csv",
              contentType: "text/csv; charset=utf-8",
              data: "symbol,amount\nAAPL,10",
            },
            {
              name: "notes.txt",
              contentType: "text/plain",
              data: "Cash reserve is high.",
            },
          ],
        }),
      );

      const messages = fetchBodies[0]?.messages as Array<{ role: string; content: string }>;
      const userPrompt = messages[messages.length - 1]?.content ?? "";
      expect(userPrompt).toContain("Text/CSV attachment content is included below");
      expect(userPrompt).toContain("For CSV imports, call import_csv when that tool is available");
      expect(userPrompt).toContain("[Attached file: statement.csv]\nsymbol,amount\nAAPL,10");
      expect(userPrompt).toContain("[Attached file: notes.txt]\nCash reserve is high.");

      const threadId = String(events[0]?.threadId);
      const persistedMessages = service.getMessages(threadId);
      expect(persistedMessages).toMatchObject([
        {
          role: "user",
          content: textContent("Review the attachment\n📎 statement.csv\n📎 notes.txt"),
        },
        { role: "assistant", content: textContent("Reviewed") },
      ]);
      expect(JSON.stringify(persistedMessages[0]?.content)).not.toContain("AAPL");
    } finally {
      db.close();
    }
  });

  test("sends OpenAI-compatible image attachments as image_url parts", async () => {
    const db = createAiChatDb();
    const fetchBodies: Array<Record<string, unknown>> = [];
    const service = createAiChatService(db, {
      aiProviderService: createProviderResolver({
        providerId: "openai",
        modelId: "gpt-vision",
        providerType: "api",
        baseUrl: "https://api.openai.test",
        apiKey: "secret-key",
        capabilities: { tools: false, thinking: false, vision: true, streaming: true },
      }),
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        if (body.stream === false) {
          return new Response("title unavailable", { status: 503 });
        }
        fetchBodies.push(body);
        return streamResponse([
          sseData({ choices: [{ delta: { content: "Reviewed the image." } }] }),
          "data: [DONE]\n\n",
        ]);
      },
    });

    try {
      const events = await collectEvents(
        await service.sendMessage({
          content: "Review screenshot",
          attachments: [
            {
              name: "scan.jpg",
              contentType: "image/jpg",
              data: "data:image/jpg;base64,aGVs",
            },
          ],
        }),
      );

      const userMessage = (fetchBodies[0]?.messages as Array<Record<string, unknown>>)[1];
      expect(userMessage?.content).toEqual([
        {
          type: "text",
          text: expect.stringContaining("Review screenshot"),
        },
        {
          type: "image_url",
          image_url: { url: "data:image/jpeg;base64,aGVs" },
        },
      ]);
      expect(String(JSON.stringify(userMessage?.content))).not.toContain("data:image/jpg");

      const threadId = String(events[0]?.threadId);
      const persistedMessages = service.getMessages(threadId);
      expect(persistedMessages[0]).toMatchObject({
        role: "user",
        content: textContent("Review screenshot\n📎 scan.jpg"),
      });
      expect(JSON.stringify(persistedMessages[0]?.content)).not.toContain("aGVs");
    } finally {
      db.close();
    }
  });

  test("sends OpenAI-compatible PDF attachments as file content parts", async () => {
    const db = createAiChatDb();
    const fetchBodies: Array<Record<string, unknown>> = [];
    const service = createAiChatService(db, {
      aiProviderService: createProviderResolver({
        providerId: "openrouter",
        modelId: "gpt-document",
        providerType: "api",
        baseUrl: "https://openrouter.test/api",
        apiKey: "secret-key",
        capabilities: { tools: false, thinking: false, vision: true, streaming: true },
      }),
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        if (body.stream === false) {
          return new Response("title unavailable", { status: 503 });
        }
        fetchBodies.push(body);
        return streamResponse([
          sseData({ choices: [{ delta: { content: "Reviewed the statement." } }] }),
          "data: [DONE]\n\n",
        ]);
      },
    });

    try {
      const events = await collectEvents(
        await service.sendMessage({
          content: "Review statement",
          attachments: [
            { name: "statement.pdf", contentType: "application/pdf", data: "JVBERi0=" },
          ],
        }),
      );

      const userMessage = (fetchBodies[0]?.messages as Array<Record<string, unknown>>)[1];
      expect(userMessage?.content).toEqual([
        {
          type: "text",
          text: expect.stringContaining("Review statement"),
        },
        {
          type: "file",
          file: {
            file_data: "data:application/pdf;base64,JVBERi0=",
            filename: "statement.pdf",
          },
        },
      ]);

      const threadId = String(events[0]?.threadId);
      const persistedMessages = service.getMessages(threadId);
      expect(persistedMessages[0]).toMatchObject({
        role: "user",
        content: textContent("Review statement\n📎 statement.pdf"),
      });
      expect(JSON.stringify(persistedMessages[0]?.content)).not.toContain("JVBERi0=");
    } finally {
      db.close();
    }
  });

  test("sends Ollama image attachments as image arrays", async () => {
    const db = createAiChatDb();
    const fetchBodies: Array<Record<string, unknown>> = [];
    const service = createAiChatService(db, {
      aiProviderService: createProviderResolver({
        providerId: "ollama",
        modelId: "llava",
        providerType: "local",
        baseUrl: "http://localhost:11434/v1",
        capabilities: { tools: false, thinking: false, vision: true, streaming: true },
      }),
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        if (body.stream === false) {
          return new Response("title unavailable", { status: 503 });
        }
        fetchBodies.push(body);
        return streamResponse([
          '{"message":{"content":"Reviewed the local image."},"done":false}\n',
          '{"done":true}\n',
        ]);
      },
    });

    try {
      const events = await collectEvents(
        await service.sendMessage({
          content: "Review local scan",
          attachments: [
            { name: "scan.png", contentType: "image/png", data: "data:image/png;base64,aGVs" },
          ],
        }),
      );

      const userMessage = (fetchBodies[0]?.messages as Array<Record<string, unknown>>)[1];
      expect(userMessage).toMatchObject({
        role: "user",
        content: expect.stringContaining("Review local scan"),
        images: ["aGVs"],
      });
      expect(String(JSON.stringify(userMessage))).not.toContain("data:image/png");

      const threadId = String(events[0]?.threadId);
      const persistedMessages = service.getMessages(threadId);
      expect(persistedMessages[0]).toMatchObject({
        role: "user",
        content: textContent("Review local scan\n📎 scan.png"),
      });
      expect(JSON.stringify(persistedMessages[0]?.content)).not.toContain("aGVs");
    } finally {
      db.close();
    }
  });

  test("sends Anthropic image and PDF attachments as native media blocks", async () => {
    const db = createAiChatDb();
    const fetchBodies: Array<Record<string, unknown>> = [];
    const service = createAiChatService(db, {
      aiProviderService: createProviderResolver({
        providerId: "anthropic",
        modelId: "claude-vision",
        providerType: "api",
        baseUrl: "https://api.anthropic.test",
        apiKey: "secret-key",
        capabilities: { tools: false, thinking: false, vision: true, streaming: true },
      }),
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body));
        if (body.stream !== true) {
          return new Response("title unavailable", { status: 503 });
        }
        fetchBodies.push(body);
        return streamResponse([
          sseData({
            type: "content_block_delta",
            delta: { type: "text_delta", text: "Extracted the statement." },
          }),
        ]);
      },
    });

    try {
      const events = await collectEvents(
        await service.sendMessage({
          content: "Extract transactions",
          attachments: [
            {
              name: "scan.jpg",
              contentType: "image/jpg",
              data: "data:image/jpg;base64,aGVsbG8=",
            },
            { name: "statement.pdf", contentType: "application/pdf", data: "JVBERi0=" },
          ],
        }),
      );

      const userMessage = (fetchBodies[0]?.messages as Array<Record<string, unknown>>)[0];
      expect(userMessage?.content).toEqual([
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/jpeg",
            data: "aGVsbG8=",
          },
        },
        {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: "JVBERi0=",
          },
        },
        {
          type: "text",
          text: expect.stringContaining("Image/PDF attachment content is included"),
        },
      ]);
      expect(String(JSON.stringify(userMessage?.content))).not.toContain("data:image/jpg");

      const threadId = String(events[0]?.threadId);
      const persistedMessages = service.getMessages(threadId);
      expect(persistedMessages[0]).toMatchObject({
        role: "user",
        content: textContent("Extract transactions\n📎 scan.jpg\n📎 statement.pdf"),
      });
      expect(JSON.stringify(persistedMessages[0]?.content)).not.toContain("aGVsbG8=");
    } finally {
      db.close();
    }
  });

  test("sends Google image and PDF attachments as inline data parts", async () => {
    const db = createAiChatDb();
    const fetchBodies: Array<Record<string, unknown>> = [];
    const service = createAiChatService(db, {
      aiProviderService: createProviderResolver({
        providerId: "google",
        modelId: "gemini-vision",
        providerType: "api",
        baseUrl: "https://generativelanguage.googleapis.com",
        apiKey: "secret-key",
        capabilities: { tools: false, thinking: false, vision: true, streaming: true },
      }),
      fetch: async (input, init) => {
        const url = String(input);
        if (!url.includes(":streamGenerateContent")) {
          return new Response("title unavailable", { status: 503 });
        }
        fetchBodies.push(JSON.parse(String(init?.body)));
        return streamResponse([
          sseData({
            candidates: [{ content: { parts: [{ text: "Reviewed the attachments." }] } }],
          }),
        ]);
      },
    });

    try {
      await collectEvents(
        await service.sendMessage({
          content: "Review statement",
          attachments: [
            { name: "scan.png", contentType: "image/png", data: "data:image/png;base64,aGVs" },
            { name: "statement.pdf", contentType: "application/pdf", data: "JVBERi0=" },
          ],
        }),
      );

      const parts = ((
        fetchBodies[0]?.contents as Array<{ parts: Array<Record<string, unknown>> }>
      )[0]?.parts ?? []) as Array<Record<string, unknown>>;
      expect(parts).toEqual([
        { inlineData: { mimeType: "image/png", data: "aGVs" } },
        { inlineData: { mimeType: "application/pdf", data: "JVBERi0=" } },
        { text: expect.stringContaining("Review statement") },
      ]);
    } finally {
      db.close();
    }
  });

  test("rejects missing API keys and unsupported attachments before persisting chat rows", async () => {
    const db = createAiChatDb();
    const service = createAiChatService(db, {
      aiProviderService: createProviderResolver({
        providerId: "openai",
        modelId: "gpt-test",
        providerType: "api",
        baseUrl: "https://api.openai.test",
      }),
    });

    try {
      await expect(service.sendMessage({ content: "Hello" })).rejects.toMatchObject({
        code: "missing_api_key",
        status: 400,
      });
      await expect(
        service.sendMessage({
          content: "Read this",
          attachments: [{ name: "scan.png", contentType: "image/png", data: "aGVsbG8=" }],
        }),
      ).rejects.toMatchObject({
        code: "not_implemented",
        status: 501,
      });
      expect(service.listThreads({ limit: 10 })).toMatchObject({ threads: [] });
    } finally {
      db.close();
    }
  });

  test("rejects multimodal attachments for unsupported providers and media types", async () => {
    const visionDisabledDb = createAiChatDb();
    const visionDisabledService = createAiChatService(visionDisabledDb, {
      aiProviderService: createProviderResolver({
        providerId: "anthropic",
        modelId: "claude-text",
        providerType: "api",
        baseUrl: "https://api.anthropic.test",
        apiKey: "secret-key",
        capabilities: { tools: false, thinking: false, vision: false, streaming: true },
      }),
    });
    const unsupportedTypeDb = createAiChatDb();
    const unsupportedTypeService = createAiChatService(unsupportedTypeDb, {
      aiProviderService: createProviderResolver({
        providerId: "anthropic",
        modelId: "claude-vision",
        providerType: "api",
        baseUrl: "https://api.anthropic.test",
        apiKey: "secret-key",
        capabilities: { tools: false, thinking: false, vision: true, streaming: true },
      }),
    });
    const ollamaPdfDb = createAiChatDb();
    const ollamaPdfService = createAiChatService(ollamaPdfDb, {
      aiProviderService: createProviderResolver({
        providerId: "ollama",
        modelId: "llava",
        providerType: "local",
        baseUrl: "http://localhost:11434/v1",
        capabilities: { tools: false, thinking: false, vision: true, streaming: true },
      }),
    });

    try {
      await expect(
        visionDisabledService.sendMessage({
          content: "Read this",
          attachments: [{ name: "scan.png", contentType: "image/png", data: "aGVsbG8=" }],
        }),
      ).rejects.toMatchObject({ code: "not_implemented", status: 501 });
      await expect(
        unsupportedTypeService.sendMessage({
          content: "Read this",
          attachments: [{ name: "scan.svg", contentType: "image/svg+xml", data: "aGVsbG8=" }],
        }),
      ).rejects.toMatchObject({ code: "not_implemented", status: 501 });
      await expect(
        ollamaPdfService.sendMessage({
          content: "Read PDF",
          attachments: [
            { name: "statement.pdf", contentType: "application/pdf", data: "JVBERi0=" },
          ],
        }),
      ).rejects.toMatchObject({ code: "not_implemented", status: 501 });
    } finally {
      visionDisabledDb.close();
      unsupportedTypeDb.close();
      ollamaPdfDb.close();
    }
  });

  test("validates attachment metadata and limits before persisting chat rows", async () => {
    const db = createAiChatDb();
    const service = createAiChatService(db, {
      aiProviderService: createProviderResolver({
        providerId: "openai",
        modelId: "gpt-test",
        providerType: "api",
        baseUrl: "https://api.openai.test",
        apiKey: "secret-key",
      }),
    });

    try {
      await expect(
        service.sendMessage({
          content: "Too many",
          attachments: Array.from({ length: 11 }, (_value, index) => ({
            name: `file-${index}.csv`,
            contentType: "text/csv",
            data: "a,b",
          })),
        }),
      ).rejects.toMatchObject({
        code: "invalid_input",
        status: 400,
      });
      await expect(
        service.sendMessage({
          content: "Bad name",
          attachments: [{ name: "bad\nname.csv", contentType: "text/csv", data: "a,b" }],
        }),
      ).rejects.toMatchObject({
        code: "invalid_input",
        status: 400,
      });
      await expect(
        service.sendMessage({
          content: "Bad content type",
          attachments: [{ name: "scan.png", contentType: "image/png\nfake", data: "aGVsbG8=" }],
        }),
      ).rejects.toMatchObject({
        code: "invalid_input",
        status: 400,
      });
      await expect(
        service.sendMessage({
          content: "Oversized UTF-8 text",
          attachments: [
            {
              name: "large.txt",
              contentType: "text/plain",
              data: "中".repeat(3_500_000),
            },
          ],
        }),
      ).rejects.toMatchObject({
        code: "invalid_input",
        status: 400,
      });
      expect(service.listThreads({ limit: 10 })).toMatchObject({ threads: [] });
    } finally {
      db.close();
    }
  });

  test("emits stream errors for provider failures without assistant persistence", async () => {
    const db = createAiChatDb();
    const service = createAiChatService(db, {
      aiProviderService: createProviderResolver({
        providerId: "openai",
        modelId: "gpt-test",
        providerType: "api",
        baseUrl: "https://api.openai.test",
        apiKey: "secret-key",
      }),
      fetch: async () => new Response("upstream unavailable", { status: 503 }),
    });

    try {
      const events = await collectEvents(await service.sendMessage({ content: "Hello" }));

      expect(events).toEqual([
        expect.objectContaining({ type: "system" }),
        expect.objectContaining({
          type: "error",
          code: "provider_error",
          message: expect.stringContaining("Provider returned error 503"),
        }),
      ]);
      const threadId = String(events[0]?.threadId);
      expect(service.getMessages(threadId)).toMatchObject([{ role: "user" }]);
    } finally {
      db.close();
    }
  });

  test("reports missing provider service as a configuration error", async () => {
    const db = createAiChatDb();
    const service = createAiChatService(db);

    try {
      await expect(service.sendMessage({ message: "hello" })).rejects.toMatchObject({
        code: "configuration_error",
        status: 500,
      });
    } finally {
      db.close();
    }
  });
});

async function collectEvents(
  iterable: AsyncIterable<unknown>,
): Promise<Array<Record<string, unknown>>> {
  const events: Array<Record<string, unknown>> = [];
  for await (const event of iterable) {
    events.push(event as Record<string, unknown>);
  }
  return events;
}

function createProviderResolver(
  config: Partial<ResolvedAiChatProviderConfig> &
    Pick<ResolvedAiChatProviderConfig, "providerId" | "modelId" | "providerType" | "baseUrl">,
): { resolveChatProviderConfig(): ResolvedAiChatProviderConfig } {
  return {
    resolveChatProviderConfig() {
      return {
        capabilities: { tools: false, thinking: false, vision: false, streaming: true },
        ...config,
      };
    },
  };
}

function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
  );
}

function sseData(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function erroringStreamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let index = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index < chunks.length) {
          controller.enqueue(encoder.encode(chunks[index] as string));
          index += 1;
          return;
        }
        controller.error(new Error("provider stream failed"));
      },
    }),
  );
}

function textContent(content: string): {
  schemaVersion: number;
  parts: Array<{ type: string; content: string }>;
} {
  return {
    schemaVersion: 1,
    parts: [{ type: "text", content }],
  };
}

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
    JSON.stringify({
      schemaVersion: 1,
      providerId: "ollama",
      modelId: "llama3",
      promptTemplateId: "wealthfolio-assistant-v1",
      promptVersion: "1.0.0",
    }),
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
