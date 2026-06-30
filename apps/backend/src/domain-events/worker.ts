import type { BackendEvent, BackendEventBus } from "../events";
import {
  processDomainEventBatch,
  type DomainEventProcessingPlan,
  type DomainEventProcessorOptions,
} from "./processor";

export interface DomainEventWorkerOptions extends DomainEventProcessorOptions {
  debounceMs?: number;
  onError?: (error: unknown, events: BackendEvent[]) => void;
  onProcessed?: (plan: DomainEventProcessingPlan, events: BackendEvent[]) => void;
  processBatch?: (
    events: BackendEvent[],
    options: DomainEventProcessorOptions,
  ) => Promise<DomainEventProcessingPlan>;
}

export interface DomainEventWorkerHandle {
  dispose(): void;
  flush(): Promise<void>;
  flushAndDispose(): Promise<void>;
  pendingCount(): number;
}

export function createDomainEventWorker(
  eventBus: BackendEventBus,
  options: DomainEventWorkerOptions = {},
): DomainEventWorkerHandle {
  const {
    debounceMs = 1_000,
    onError,
    onProcessed,
    processBatch = processDomainEventBatch,
    ...processorOptions
  } = options;
  const pendingEvents: BackendEvent[] = [];
  let disposed = false;
  let debounceTimer: Timer | undefined;
  let processing: Promise<void> | null = null;

  const clearDebounce = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = undefined;
    }
  };

  const schedule = () => {
    if (disposed || processing || pendingEvents.length === 0) {
      return;
    }
    clearDebounce();
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      void processPending(true);
    }, debounceMs);
  };

  const reportScheduledError = (error: unknown, events: BackendEvent[]) => {
    if (onError) {
      onError(error, events);
      return;
    }
    queueMicrotask(() => {
      throw error;
    });
  };

  const processPending = async (scheduled: boolean): Promise<void> => {
    if (processing) {
      return processing;
    }
    const batch = pendingEvents.splice(0);
    if (batch.length === 0) {
      return;
    }

    processing = (async () => {
      const plan = await processBatch(batch, {
        ...processorOptions,
        eventBus: processorOptions.eventBus ?? eventBus,
      });
      onProcessed?.(plan, batch);
    })().finally(() => {
      processing = null;
      schedule();
    });

    try {
      await processing;
    } catch (error) {
      if (scheduled) {
        reportScheduledError(error, batch);
        return;
      }
      throw error;
    }
  };

  const unsubscribe = eventBus.subscribe((event) => {
    if (disposed) {
      return;
    }
    pendingEvents.push(event);
    schedule();
  });

  const disposeImmediate = () => {
    disposed = true;
    clearDebounce();
    pendingEvents.length = 0;
    unsubscribe();
  };

  const flush = async () => {
    clearDebounce();
    while (processing || pendingEvents.length > 0) {
      if (processing) {
        await processing;
      } else {
        await processPending(false);
      }
    }
  };

  return {
    dispose() {
      disposeImmediate();
    },
    async flush() {
      await flush();
    },
    async flushAndDispose() {
      disposed = true;
      clearDebounce();
      unsubscribe();
      try {
        await flush();
      } finally {
        pendingEvents.length = 0;
      }
    },
    pendingCount() {
      return pendingEvents.length;
    },
  };
}
