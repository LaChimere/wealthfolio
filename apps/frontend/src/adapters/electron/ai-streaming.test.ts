import {
  ELECTRON_API_KEY,
  getAiChatStreamEventName,
  type ElectronEventMessage,
  type WealthfolioElectronApi,
} from "@wealthfolio/electron/shared/ipc";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AiSendMessageRequest, AiStreamEvent } from "@/features/ai-assistant/types";
import { streamAiChat } from "./ai-streaming";

const streamId = "123e4567-e89b-42d3-a456-426614174000";
const request: AiSendMessageRequest = { content: "Show holdings" };

function installElectronApi(api: Partial<WealthfolioElectronApi>) {
  window[ELECTRON_API_KEY] = {
    getRuntimeInfo: vi.fn(),
    invoke: vi.fn(),
    startAiChatStream: vi.fn(),
    cancelAiChatStream: vi.fn(),
    listen: vi.fn(),
    ...api,
  } as WealthfolioElectronApi;
}

afterEach(() => {
  delete window[ELECTRON_API_KEY];
  vi.restoreAllMocks();
});

describe("electron AI streaming adapter", () => {
  it("streams events through the dedicated Electron IPC bridge", async () => {
    mockStreamId();
    let bridgeHandler: ((event: ElectronEventMessage<AiStreamEvent>) => void) | undefined;
    const unlisten = vi.fn().mockResolvedValue(undefined);
    const listen = vi.fn(async (_eventName, handler) => {
      bridgeHandler = handler as (event: ElectronEventMessage<AiStreamEvent>) => void;
      return unlisten;
    });
    const startAiChatStream = vi.fn(async () => {
      bridgeHandler?.({
        event: getAiChatStreamEventName(streamId),
        id: 1,
        payload: {
          type: "system",
          threadId: "t1",
          runId: "r1",
          messageId: "m1",
        } as AiStreamEvent,
      });
      bridgeHandler?.({
        event: getAiChatStreamEventName(streamId),
        id: 2,
        payload: {
          type: "done",
          threadId: "t1",
          runId: "r1",
          messageId: "m1",
          message: {},
        } as AiStreamEvent,
      });
    });
    const cancelAiChatStream = vi.fn();
    installElectronApi({ listen, startAiChatStream, cancelAiChatStream });

    const events = [];
    for await (const event of streamAiChat(request)) {
      events.push(event);
    }

    expect(listen).toHaveBeenCalledWith(getAiChatStreamEventName(streamId), expect.any(Function));
    expect(startAiChatStream).toHaveBeenCalledWith(streamId, request);
    expect(cancelAiChatStream).not.toHaveBeenCalled();
    expect(unlisten).toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual(["system", "done"]);
  });

  it("yields a terminal error event when the stream start fails", async () => {
    mockStreamId();
    const listen = vi.fn(async () => vi.fn().mockResolvedValue(undefined));
    const startAiChatStream = vi.fn().mockRejectedValue(new Error("sidecar unavailable"));
    const cancelAiChatStream = vi.fn();
    installElectronApi({ listen, startAiChatStream, cancelAiChatStream });

    const events = [];
    for await (const event of streamAiChat(request)) {
      events.push(event);
    }

    expect(events).toEqual([
      expect.objectContaining({
        type: "error",
        message: "sidecar unavailable",
      }),
    ]);
    expect(cancelAiChatStream).not.toHaveBeenCalled();
  });

  it("cancels and unlistens when aborted before a terminal event", async () => {
    mockStreamId();
    const controller = new AbortController();
    const unlisten = vi.fn().mockResolvedValue(undefined);
    const listen = vi.fn(async () => unlisten);
    const startAiChatStream = vi.fn(() => new Promise<void>(() => undefined));
    const cancelAiChatStream = vi.fn().mockResolvedValue(undefined);
    installElectronApi({ listen, startAiChatStream, cancelAiChatStream });

    const iterator = streamAiChat(request, controller.signal);
    const next = iterator.next();
    await new Promise((resolve) => setTimeout(resolve, 0));

    controller.abort();
    await expect(next).resolves.toEqual({ done: true, value: undefined });

    expect(cancelAiChatStream).toHaveBeenCalledWith(streamId);
    expect(unlisten).toHaveBeenCalled();
  });
});

function mockStreamId() {
  vi.spyOn(crypto, "randomUUID").mockReturnValue(streamId);
}
