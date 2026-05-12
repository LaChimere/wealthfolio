import { IPC_CHANNELS, type ElectronEventMessage } from "../shared/ipc";
import {
  getAiChatStreamEventName,
  sanitizeAiStreamError,
  streamSidecarAiChat,
  type AiStreamEventPayload,
} from "./ai-chat-stream";
import type { SidecarHandle } from "./sidecar";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type NavigationListener = (
  event: unknown,
  url: string,
  isInPlace: boolean,
  isMainFrame: boolean,
) => void;

export interface AiChatStreamOwner {
  send(channel: string, message: ElectronEventMessage): void;
  isDestroyed(): boolean;
  once(eventName: "destroyed", listener: () => void): unknown;
  on(eventName: "did-start-navigation", listener: NavigationListener): unknown;
  off(eventName: "destroyed", listener: () => void): unknown;
  off(eventName: "did-start-navigation", listener: NavigationListener): unknown;
}

export interface AiChatStreamManager {
  start(owner: AiChatStreamOwner, payload: unknown): Promise<void>;
  cancel(payload: unknown): void;
  cancelAll(): void;
}

export interface CreateAiChatStreamManagerOptions {
  getSidecar(): Promise<Pick<SidecarHandle, "baseUrl" | "token">>;
  fetchImpl?: FetchLike;
}

interface ActiveStream {
  controller: AbortController;
  cleanupOwnerListeners(): void;
}

const STREAM_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createAiChatStreamManager({
  getSidecar,
  fetchImpl,
}: CreateAiChatStreamManagerOptions): AiChatStreamManager {
  const streams = new Map<string, ActiveStream>();
  let nextEventId = 0;

  const start = async (owner: AiChatStreamOwner, payload: unknown): Promise<void> => {
    const { streamId, request } = validateAiChatStreamStartRequest(payload);
    if (streams.has(streamId)) {
      throw new Error(`Electron AI chat stream already exists: ${streamId}`);
    }

    const controller = new AbortController();
    const cleanupOwnerListeners = bindOwnerLifecycle(owner, controller);
    streams.set(streamId, { controller, cleanupOwnerListeners });

    let sidecar: Pick<SidecarHandle, "baseUrl" | "token"> | undefined;
    try {
      sidecar = await getSidecar();
      if (controller.signal.aborted) {
        return;
      }

      await streamSidecarAiChat({
        sidecar,
        request,
        signal: controller.signal,
        fetchImpl,
        onEvent(event) {
          if (!sendStreamEvent(owner, streamId, ++nextEventId, event)) {
            controller.abort();
          }
        },
      });
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      sendStreamEvent(owner, streamId, ++nextEventId, {
        type: "error",
        threadId: "",
        runId: "",
        messageId: undefined,
        code: "network",
        message: sanitizeAiStreamError(error, sidecar?.token ?? ""),
      });
    } finally {
      cleanupOwnerListeners();
      streams.delete(streamId);
    }
  };

  const cancel = (payload: unknown): void => {
    const streamId = validateAiChatStreamCancelRequest(payload);
    const stream = streams.get(streamId);
    if (!stream) {
      return;
    }

    stream.controller.abort();
    stream.cleanupOwnerListeners();
    streams.delete(streamId);
  };

  const cancelAll = (): void => {
    for (const streamId of streams.keys()) {
      cancel({ streamId });
    }
  };

  return { start, cancel, cancelAll };
}

export function validateAiChatStreamStartRequest(payload: unknown): {
  streamId: string;
  request: Record<string, unknown>;
} {
  const record = requireRecord(payload, "Invalid Electron AI chat stream start request.");
  const streamId = requireStreamId(record.streamId);
  const request = requireRecord(record.request, "Invalid Electron AI chat stream request.");
  return { streamId, request };
}

export function validateAiChatStreamCancelRequest(payload: unknown): string {
  const record = requireRecord(payload, "Invalid Electron AI chat stream cancel request.");
  return requireStreamId(record.streamId);
}

function bindOwnerLifecycle(owner: AiChatStreamOwner, controller: AbortController): () => void {
  const abort = () => controller.abort();
  const abortOnNavigation: NavigationListener = (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) {
      controller.abort();
    }
  };

  owner.once("destroyed", abort);
  owner.on("did-start-navigation", abortOnNavigation);

  let cleanedUp = false;
  return () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    owner.off("destroyed", abort);
    owner.off("did-start-navigation", abortOnNavigation);
  };
}

function sendStreamEvent(
  owner: AiChatStreamOwner,
  streamId: string,
  id: number,
  payload: AiStreamEventPayload,
): boolean {
  if (owner.isDestroyed()) {
    return false;
  }
  try {
    owner.send(IPC_CHANNELS.serverEvent, {
      event: getAiChatStreamEventName(streamId),
      id,
      payload,
    });
    return true;
  } catch {
    return false;
  }
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

function requireStreamId(value: unknown): string {
  if (typeof value !== "string" || !STREAM_ID_PATTERN.test(value)) {
    throw new Error("Invalid Electron AI chat stream id.");
  }
  return value;
}
