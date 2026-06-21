import { afterEach, describe, expect, it, vi } from "vitest";

import type { AiSendMessageRequest, AiStreamEvent } from "@/features/ai-assistant/types";
import { streamAiChat } from "./ai-streaming";

const request: AiSendMessageRequest = { content: "Show holdings", threadId: "thread-1" };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("web AI streaming adapter", () => {
  it("posts chat requests and parses chunked NDJSON events until done", async () => {
    const controller = new AbortController();
    const stream = ndjsonStream([
      '{"type":"system","threadId":"thread-1","runId":"run-1","messageId":"msg-1"}\n{"type":"text',
      'Delta","threadId":"thread-1","runId":"run-1","messageId":"msg-1","delta":"Hi"}\n',
      '{"type":"done","threadId":"thread-1","runId":"run-1","messageId":"msg-1","message":{"id":"msg-1"}}\n',
      '{"type":"textDelta","threadId":"thread-1","runId":"run-1","messageId":"msg-1","delta":"ignored"}\n',
    ]);
    const fetchMock = vi.fn().mockResolvedValue(new Response(stream));
    vi.stubGlobal("fetch", fetchMock);

    const events = await collectStream(streamAiChat(request, controller.signal));

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/ai/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
      credentials: "same-origin",
    });
    expect(events.map((event) => event.type)).toEqual(["system", "textDelta", "done"]);
    expect(events[1]).toMatchObject({ type: "textDelta", delta: "Hi" });
  });

  it("yields backend JSON error responses as terminal error events", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { code: "invalid_input", error: "The current model does not support attachments" },
            { status: 400, statusText: "Bad Request" },
          ),
        ),
    );

    await expect(collectStream(streamAiChat(request))).resolves.toEqual([
      expect.objectContaining({
        type: "error",
        code: "invalid_input",
        message: "The current model does not support attachments",
      }),
    ]);
  });

  it("yields network errors when the response body is null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));

    await expect(collectStream(streamAiChat(request))).resolves.toEqual([
      expect.objectContaining({
        type: "error",
        code: "network",
        message: "Response body is null",
      }),
    ]);
  });
});

function ndjsonStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

async function collectStream(stream: AsyncGenerator<AiStreamEvent>): Promise<AiStreamEvent[]> {
  const events: AiStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}
