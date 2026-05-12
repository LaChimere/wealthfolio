import { describe, expect, test } from "bun:test";

import { getAiChatStreamEventName, IPC_CHANNELS, type ElectronEventMessage } from "../shared/ipc";
import {
  createAiChatStreamManager,
  validateAiChatStreamStartRequest,
  type AiChatStreamOwner,
} from "./ai-chat-stream-manager";

const streamId = "123e4567-e89b-42d3-a456-426614174000";
const sidecar = {
  baseUrl: "http://127.0.0.1:43210",
  token: "sidecar-token",
};

describe("Electron AI chat stream manager", () => {
  test("sends stream events only to the originating owner", async () => {
    const owner = new FakeStreamOwner();
    const manager = createAiChatStreamManager({
      getSidecar: async () => sidecar,
      fetchImpl: async () =>
        streamResponse([
          '{"type":"textDelta","threadId":"t1","runId":"r1","messageId":"m1","delta":"hi"}\n',
          '{"type":"done","threadId":"t1","runId":"r1","messageId":"m1","message":{}}\n',
        ]),
    });

    await manager.start(owner, { streamId, request: { content: "hello" } });

    expect(owner.sent).toEqual([
      {
        channel: IPC_CHANNELS.serverEvent,
        message: {
          event: getAiChatStreamEventName(streamId),
          id: 1,
          payload: {
            type: "textDelta",
            threadId: "t1",
            runId: "r1",
            messageId: "m1",
            delta: "hi",
          },
        },
      },
      {
        channel: IPC_CHANNELS.serverEvent,
        message: {
          event: getAiChatStreamEventName(streamId),
          id: 2,
          payload: {
            type: "done",
            threadId: "t1",
            runId: "r1",
            messageId: "m1",
            message: {},
          },
        },
      },
    ]);
  });

  test("cancels a stream before sidecar readiness resolves", async () => {
    const owner = new FakeStreamOwner();
    let fetchCalled = false;
    let resolveSidecar: (value: typeof sidecar) => void = () => {};
    const manager = createAiChatStreamManager({
      getSidecar: () =>
        new Promise((resolve) => {
          resolveSidecar = resolve;
        }),
      fetchImpl: async () => {
        fetchCalled = true;
        return streamResponse([]);
      },
    });

    const startPromise = manager.start(owner, { streamId, request: { content: "hello" } });
    manager.cancel({ streamId });
    resolveSidecar(sidecar);
    await startPromise;

    expect(fetchCalled).toBe(false);
    expect(owner.sent).toEqual([]);
  });

  test("aborts an active stream when the owner is destroyed", async () => {
    const owner = new FakeStreamOwner();
    let requestSignal: AbortSignal | undefined;
    const manager = createAiChatStreamManager({
      getSidecar: async () => sidecar,
      fetchImpl: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          requestSignal = init?.signal as AbortSignal | undefined;
          requestSignal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    });

    const startPromise = manager.start(owner, { streamId, request: { content: "hello" } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    owner.destroy();
    await startPromise;

    expect(requestSignal?.aborted).toBe(true);
  });

  test("rejects malformed start payloads", () => {
    expect(() => validateAiChatStreamStartRequest({ streamId: "bad", request: {} })).toThrow(
      "Invalid Electron AI chat stream id.",
    );
    expect(() => validateAiChatStreamStartRequest({ streamId, request: null })).toThrow(
      "Invalid Electron AI chat stream request.",
    );
  });
});

class FakeStreamOwner implements AiChatStreamOwner {
  readonly sent: Array<{ channel: string; message: ElectronEventMessage }> = [];
  private destroyed = false;
  private destroyedListeners = new Set<() => void>();
  private navigationListeners = new Set<
    (event: unknown, url: string, isInPlace: boolean, isMainFrame: boolean) => void
  >();

  send(channel: string, message: ElectronEventMessage): void {
    if (this.destroyed) {
      throw new Error("owner destroyed");
    }
    this.sent.push({ channel, message });
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  once(eventName: "destroyed", listener: () => void): void {
    if (eventName === "destroyed") {
      this.destroyedListeners.add(listener);
    }
  }

  on(
    eventName: "did-start-navigation",
    listener: (event: unknown, url: string, isInPlace: boolean, isMainFrame: boolean) => void,
  ): void {
    if (eventName === "did-start-navigation") {
      this.navigationListeners.add(listener);
    }
  }

  off(eventName: "destroyed" | "did-start-navigation", listener: unknown): void {
    if (eventName === "destroyed" && typeof listener === "function") {
      this.destroyedListeners.delete(listener as () => void);
    }
    if (eventName === "did-start-navigation" && typeof listener === "function") {
      this.navigationListeners.delete(
        listener as (event: unknown, url: string, isInPlace: boolean, isMainFrame: boolean) => void,
      );
    }
  }

  destroy(): void {
    this.destroyed = true;
    for (const listener of this.destroyedListeners) {
      listener();
    }
  }
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
    {
      status: 200,
      headers: { "content-type": "application/x-ndjson" },
    },
  );
}
