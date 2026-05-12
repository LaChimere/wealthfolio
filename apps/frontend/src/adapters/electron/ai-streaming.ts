import type { AiSendMessageRequest, AiStreamEvent } from "@/features/ai-assistant/types";

import { invoke } from "./core";

export async function* streamAiChat(
  request: AiSendMessageRequest,
  signal?: AbortSignal,
): AsyncGenerator<AiStreamEvent, void, undefined> {
  if (signal?.aborted) {
    return;
  }

  try {
    await invoke("stream_ai_chat", { request });
    yield {
      type: "error",
      threadId: "",
      runId: "",
      messageId: undefined,
      code: "network",
      message: "Electron AI streaming is not available until the native bridge is connected.",
    } as AiStreamEvent;
  } catch (error) {
    yield {
      type: "error",
      threadId: "",
      runId: "",
      messageId: undefined,
      code: "network",
      message: error instanceof Error ? error.message : String(error),
    } as AiStreamEvent;
  }
}
