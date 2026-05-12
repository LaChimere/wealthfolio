import { describe, expect, test } from "bun:test";

import {
  parseNdjsonStreamBuffer,
  streamSidecarAiChat,
  type AiStreamEventPayload,
} from "./ai-chat-stream";

const sidecar = {
  baseUrl: "http://127.0.0.1:43210",
  token: "sidecar-token",
};

describe("Electron AI chat stream fetcher", () => {
  test("posts to the sidecar stream endpoint and parses NDJSON across chunks", async () => {
    const events: AiStreamEventPayload[] = [];
    let requestUrl = "";
    let requestInit: RequestInit | undefined;

    await streamSidecarAiChat({
      sidecar,
      request: { content: "show holdings" },
      signal: new AbortController().signal,
      fetchImpl: async (input, init) => {
        requestUrl = String(input);
        requestInit = init;
        return streamResponse([
          '{"type":"system","threadId":"t',
          '1","runId":"r1","messageId":"m1"}\n{"type":"done","threadId":"t1","runId":"r1","messageId":"m1","message":{}}\n{"type":"textDelta","delta":"ignored"}\n',
        ]);
      },
      onEvent(event) {
        events.push(event);
      },
    });

    expect(requestUrl).toBe("http://127.0.0.1:43210/api/v1/ai/chat/stream");
    expect(requestInit?.method).toBe("POST");
    expect(requestInit?.headers).toEqual({
      Accept: "application/x-ndjson",
      Authorization: "Bearer sidecar-token",
      "Content-Type": "application/json",
    });
    expect(requestInit?.body).toBe(JSON.stringify({ content: "show holdings" }));
    expect(events.map((event) => event.type)).toEqual(["system", "done"]);
  });

  test("keeps a partial NDJSON line buffered until it completes", () => {
    const first = parseNdjsonStreamBuffer('{"type":"textDelta","delta":"hel');
    expect(first).toEqual({
      events: [],
      rest: '{"type":"textDelta","delta":"hel',
    });

    const second = parseNdjsonStreamBuffer(`${first.rest}lo"}\n`);
    expect(second).toEqual({
      events: [{ type: "textDelta", delta: "hello" }],
      rest: "",
    });
  });

  test("redacts sidecar URL and token from HTTP error messages", async () => {
    const error = await captureError(() =>
      streamSidecarAiChat({
        sidecar,
        request: { content: "hello" },
        signal: new AbortController().signal,
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              error:
                "failed http://127.0.0.1:43210 with Bearer sidecar-token and token=sidecar-token",
            }),
            {
              status: 502,
              headers: { "content-type": "application/json" },
            },
          ),
        onEvent() {
          throw new Error("unexpected event");
        },
      }),
    );

    expect(String(error)).toContain("[sidecar]");
    expect(String(error)).not.toContain("127.0.0.1:43210");
    expect(String(error)).not.toContain("sidecar-token");
  });
});

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
    {
      status: 200,
      headers: { "content-type": "application/x-ndjson" },
    },
  );
}

async function captureError(callback: () => Promise<void>): Promise<unknown> {
  try {
    await callback();
  } catch (error) {
    return error;
  }
  throw new Error("Expected callback to throw.");
}
