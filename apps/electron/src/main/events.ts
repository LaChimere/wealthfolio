import { setTimeout as delay } from "node:timers/promises";

import type { ElectronEventMessage } from "../shared/ipc";
import { sanitizeSidecarError, type SidecarHandle } from "./sidecar";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface SidecarEventBridgeHandle {
  stop(): void;
}

export interface StartSidecarEventBridgeOptions {
  sidecar: Pick<SidecarHandle, "baseUrl" | "token">;
  send(message: ElectronEventMessage): void;
  fetchImpl?: FetchLike;
  retryDelayMs?: number;
}

interface ParsedSseMessage {
  event: string;
  payload: unknown;
}

export function startSidecarEventBridge({
  sidecar,
  send,
  fetchImpl = fetch,
  retryDelayMs = 1_000,
}: StartSidecarEventBridgeOptions): SidecarEventBridgeHandle {
  const controller = new AbortController();
  let stopped = false;
  let nextEventId = 0;

  const run = async () => {
    while (!stopped) {
      try {
        await readSidecarEvents({
          sidecar,
          fetchImpl,
          signal: controller.signal,
          onMessage(message) {
            send({
              event: message.event,
              id: ++nextEventId,
              payload: sanitizeEventPayload(message.payload, sidecar.token),
            });
          },
        });
      } catch (error) {
        if (stopped || controller.signal.aborted) {
          return;
        }
        console.warn(
          `Electron sidecar event stream failed: ${sanitizeSidecarError(formatError(error))}`,
        );
      }

      try {
        await delay(retryDelayMs, undefined, { signal: controller.signal });
      } catch {
        return;
      }
    }
  };

  void run();

  return {
    stop() {
      stopped = true;
      controller.abort();
    },
  };
}

async function readSidecarEvents({
  sidecar,
  fetchImpl,
  signal,
  onMessage,
}: {
  sidecar: Pick<SidecarHandle, "baseUrl" | "token">;
  fetchImpl: FetchLike;
  signal: AbortSignal;
  onMessage(message: ParsedSseMessage): void;
}): Promise<void> {
  const response = await fetchImpl(new URL("/api/v1/events/stream", sidecar.baseUrl), {
    headers: {
      Accept: "text/event-stream",
      Authorization: `Bearer ${sidecar.token}`,
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Event stream returned HTTP ${response.status}`);
  }
  if (!response.body) {
    throw new Error("Event stream response did not include a readable body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseMessages(buffer);
    buffer = parsed.rest;
    for (const message of parsed.messages) {
      onMessage(message);
    }
  }
}

export function parseSseMessages(input: string): {
  messages: ParsedSseMessage[];
  rest: string;
} {
  const normalized = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const boundary = normalized.lastIndexOf("\n\n");
  if (boundary === -1) {
    return { messages: [], rest: normalized };
  }

  const complete = normalized.slice(0, boundary);
  const rest = normalized.slice(boundary + 2);
  const messages = complete
    .split("\n\n")
    .map(parseSseBlock)
    .filter((message): message is ParsedSseMessage => message !== null);

  return { messages, rest };
}

function parseSseBlock(block: string): ParsedSseMessage | null {
  let event = "message";
  const dataLines: string[] = [];

  for (const line of block.split("\n")) {
    if (!line || line.startsWith(":")) {
      continue;
    }

    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? "" : line.slice(separator + 1);
    if (value.startsWith(" ")) {
      value = value.slice(1);
    }

    if (field === "event") {
      event = value || "message";
    } else if (field === "data") {
      dataLines.push(value);
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return {
    event,
    payload: parseSsePayload(dataLines.join("\n")),
  };
}

function parseSsePayload(data: string): unknown {
  if (!data || data === "null") {
    return null;
  }
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
}

export function sanitizeEventPayload(payload: unknown, token: string): unknown {
  if (typeof payload === "string") {
    const sanitized = sanitizeSidecarError(payload);
    return token ? sanitized.replaceAll(token, "[redacted]") : sanitized;
  }
  if (Array.isArray(payload)) {
    return payload.map((item) => sanitizeEventPayload(item, token));
  }
  if (payload && typeof payload === "object") {
    return Object.fromEntries(
      Object.entries(payload).map(([key, value]) => [key, sanitizeEventPayload(value, token)]),
    );
  }
  return payload;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
