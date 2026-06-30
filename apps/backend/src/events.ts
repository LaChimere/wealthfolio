export interface BackendEvent<TPayload = unknown> {
  name: string;
  payload?: TPayload;
}

export interface BackendEventBus {
  publish(event: BackendEvent): void;
  subscribe(listener: (event: BackendEvent) => void): () => void;
}

export function createEventBus(): BackendEventBus {
  const listeners = new Set<(event: BackendEvent) => void>();
  return {
    publish(event) {
      for (const listener of listeners) {
        listener(event);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function createEventStream(
  eventBus: BackendEventBus,
  keepAliveMs = 15_000,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let active = true;
  let unsubscribe: (() => void) | undefined;
  let keepAlive: Timer | undefined;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const enqueue = (message: string) => {
        if (active) {
          controller.enqueue(encoder.encode(message));
        }
      };

      unsubscribe = eventBus.subscribe((event) => {
        enqueue(formatSseEvent(event));
      });
      keepAlive = setInterval(() => {
        enqueue(": keep-alive\n\n");
      }, keepAliveMs);
    },
    cancel() {
      active = false;
      unsubscribe?.();
      if (keepAlive) {
        clearInterval(keepAlive);
      }
    },
  });
}

export function formatSseEvent(event: BackendEvent): string {
  return `event: ${event.name}\ndata: ${JSON.stringify(event.payload ?? null)}\n\n`;
}
