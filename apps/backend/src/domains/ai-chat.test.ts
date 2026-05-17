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
