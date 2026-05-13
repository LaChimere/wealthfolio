export interface BackendEvent<TPayload = unknown> {
  name: string;
  payload: TPayload;
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
