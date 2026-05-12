import { getAiChatStreamEventName } from "../shared/ipc";
import { sanitizeSidecarError, type SidecarHandle } from "./sidecar";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface AiStreamEventPayload extends Record<string, unknown> {
  type: string;
}

export interface StreamSidecarAiChatOptions {
  sidecar: Pick<SidecarHandle, "baseUrl" | "token">;
  request: Record<string, unknown>;
  signal: AbortSignal;
  onEvent(event: AiStreamEventPayload): void;
  fetchImpl?: FetchLike;
}

export { getAiChatStreamEventName };

export async function streamSidecarAiChat({
  sidecar,
  request,
  signal,
  onEvent,
  fetchImpl = fetch,
}: StreamSidecarAiChatOptions): Promise<void> {
  let response: Response;
  try {
    response = await fetchImpl(new URL("/api/v1/ai/chat/stream", sidecar.baseUrl), {
      method: "POST",
      headers: {
        Accept: "application/x-ndjson",
        Authorization: `Bearer ${sidecar.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal,
    });
  } catch (error) {
    if (signal.aborted) {
      return;
    }
    throw new Error(
      `AI chat stream request failed: ${sanitizeAiStreamError(error, sidecar.token)}`,
    );
  }

  if (!response.ok) {
    const message = sanitizeAiStreamError(await readErrorMessage(response), sidecar.token);
    throw new Error(`AI chat stream failed with HTTP ${response.status}: ${message}`);
  }
  if (!response.body) {
    throw new Error("AI chat stream response did not include a readable body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        const finalEvent = parseNdjsonLine(buffer.trim());
        if (finalEvent) {
          onEvent(finalEvent);
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const parsed = parseNdjsonStreamBuffer(buffer);
      buffer = parsed.rest;

      for (const event of parsed.events) {
        onEvent(event);
        if (isTerminalAiStreamEvent(event)) {
          await reader.cancel().catch(() => undefined);
          return;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function parseNdjsonStreamBuffer(input: string): {
  events: AiStreamEventPayload[];
  rest: string;
} {
  const normalized = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const rest = lines.pop() ?? "";
  const events = lines
    .map((line) => parseNdjsonLine(line.trim()))
    .filter((event): event is AiStreamEventPayload => event !== null);
  return { events, rest };
}

export function isTerminalAiStreamEvent(event: AiStreamEventPayload): boolean {
  return event.type === "done" || event.type === "error";
}

export function sanitizeAiStreamError(error: unknown, token: string): string {
  const message = error instanceof Error ? error.message : String(error);
  const sanitized = sanitizeSidecarError(message);
  return token ? sanitized.replaceAll(token, "[redacted]") : sanitized;
}

function parseNdjsonLine(line: string): AiStreamEventPayload | null {
  if (!line) {
    return null;
  }
  try {
    const parsed = JSON.parse(line) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      typeof (parsed as { type?: unknown }).type === "string"
    ) {
      return parsed as AiStreamEventPayload;
    }
  } catch {
    console.warn("Received malformed AI chat stream event.");
  }
  return null;
}

async function readErrorMessage(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await response.json().catch(() => undefined)) as
      | { message?: unknown; error?: unknown }
      | undefined;
    const message = body?.message ?? body?.error;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  const body = await response.text().catch(() => "");
  return body.trim() || response.statusText || "Unknown sidecar error";
}
