import type { AiSendMessageRequest, AiStreamEvent } from "@/features/ai-assistant/types";
import { getAiChatStreamEventName } from "@wealthfolio/electron/shared/ipc";

import { cancelAiChatStream, listen, logger, startAiChatStream } from "./core";

export async function* streamAiChat(
  request: AiSendMessageRequest,
  signal?: AbortSignal,
): AsyncGenerator<AiStreamEvent, void, undefined> {
  if (signal?.aborted) {
    return;
  }

  const streamId = crypto.randomUUID();
  const eventName = getAiChatStreamEventName(streamId);
  const queue: AiStreamEvent[] = [];
  let done = false;
  let terminalEventReceived = false;
  let started = false;
  let pendingResolve: (() => void) | null = null;
  let startPromise: Promise<void> | null = null;
  let unlisten: (() => Promise<void>) | null = null;

  const notifyPending = () => {
    pendingResolve?.();
    pendingResolve = null;
  };

  const enqueue = (event: AiStreamEvent) => {
    queue.push(event);
    notifyPending();
  };

  const abortHandler = () => notifyPending();

  try {
    unlisten = await listen<AiStreamEvent>(eventName, (event) => {
      enqueue(event.payload);
    });

    if (signal?.aborted) {
      return;
    }

    signal?.addEventListener("abort", abortHandler, { once: true });
    started = true;
    startPromise = startAiChatStream(streamId, request)
      .catch((error) => {
        enqueue(toStreamErrorEvent(error));
      })
      .finally(() => {
        done = true;
        notifyPending();
      });

    while (!done || queue.length > 0) {
      if (signal?.aborted) {
        break;
      }

      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          pendingResolve = resolve;
        });
        continue;
      }

      const next = queue.shift();
      if (!next) {
        continue;
      }

      yield next;
      if (next.type === "done" || next.type === "error") {
        terminalEventReceived = true;
        return;
      }
    }
  } catch (error) {
    yield {
      type: "error",
      threadId: "",
      runId: "",
      messageId: undefined,
      code: "network",
      message: error instanceof Error ? error.message : String(error),
    } as AiStreamEvent;
  } finally {
    signal?.removeEventListener("abort", abortHandler);
    await unlisten?.();
    if (started && !terminalEventReceived) {
      await cancelAiChatStream(streamId).catch((error) => {
        logger.warn("[Electron AI Stream] Failed to cancel stream:", error);
      });
    }
    void startPromise;
  }
}

function toStreamErrorEvent(error: unknown): AiStreamEvent {
  return {
    type: "error",
    threadId: "",
    runId: "",
    messageId: undefined,
    code: "network",
    message: error instanceof Error ? error.message : String(error),
  } as AiStreamEvent;
}
