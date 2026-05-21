import { describe, expect, test } from "bun:test";

import type { BackendEvent } from "../events";
import { createEventBus } from "../events";
import { ACTIVITIES_CHANGED_EVENT, ASSETS_CREATED_EVENT } from "./planner";
import { createDomainEventWorker } from "./worker";

describe("TS domain event worker", () => {
  test("debounces event bus batches before processing", async () => {
    const eventBus = createEventBus();
    const batches: BackendEvent[][] = [];
    const processed = Promise.withResolvers<void>();
    const worker = createDomainEventWorker(eventBus, {
      debounceMs: 5,
      async processBatch(events) {
        batches.push(events);
        processed.resolve();
        return { assetEnrichmentIds: [], portfolioJob: null, brokerSyncAccountIds: [] };
      },
    });

    try {
      eventBus.publish(event(ASSETS_CREATED_EVENT, { asset_ids: ["asset-1"] }));
      eventBus.publish(event(ACTIVITIES_CHANGED_EVENT, { account_ids: ["account-1"] }));

      expect(worker.pendingCount()).toBe(2);
      await processed.promise;
      expect(batches).toEqual([
        [
          event(ASSETS_CREATED_EVENT, { asset_ids: ["asset-1"] }),
          event(ACTIVITIES_CHANGED_EVENT, { account_ids: ["account-1"] }),
        ],
      ]);
      expect(worker.pendingCount()).toBe(0);
    } finally {
      worker.dispose();
    }
  });

  test("flushes synchronously and returns callback failures", async () => {
    const eventBus = createEventBus();
    const worker = createDomainEventWorker(eventBus, {
      debounceMs: 10_000,
      processBatch() {
        throw new Error("processor failed");
      },
    });

    try {
      eventBus.publish(event(ASSETS_CREATED_EVENT, { asset_ids: ["asset-1"] }));
      await expect(worker.flush()).rejects.toThrow("processor failed");
    } finally {
      worker.dispose();
    }
  });

  test("passes the source event bus to processor options", async () => {
    const eventBus = createEventBus();
    const published: BackendEvent[] = [];
    const unsubscribe = eventBus.subscribe((backendEvent) => {
      published.push(backendEvent);
    });
    const worker = createDomainEventWorker(eventBus, {
      debounceMs: 10_000,
      enrichAssets() {
        return { enriched: 1, skipped: 0, failed: 0 };
      },
    });

    try {
      eventBus.publish(event(ASSETS_CREATED_EVENT, { asset_ids: ["asset-1"] }));
      await worker.flush();
      expect(published).toEqual([
        event(ASSETS_CREATED_EVENT, { asset_ids: ["asset-1"] }),
        { name: "asset:enrichment-start", payload: { total: 1 } },
        { name: "asset:enrichment-progress", payload: { completed: 1, total: 1 } },
        { name: "asset:enrichment-complete", payload: { enriched: 1, skipped: 0, failed: 0 } },
      ]);
    } finally {
      unsubscribe();
      worker.dispose();
    }
  });

  test("surfaces scheduled failures through the error callback", async () => {
    const eventBus = createEventBus();
    const reported = Promise.withResolvers<{ error: unknown; events: BackendEvent[] }>();
    const worker = createDomainEventWorker(eventBus, {
      debounceMs: 5,
      onError(error, events) {
        reported.resolve({ error, events });
      },
      processBatch() {
        throw new Error("scheduled failure");
      },
    });

    try {
      const published = event(ASSETS_CREATED_EVENT, { asset_ids: ["asset-1"] });
      eventBus.publish(published);
      const result = await reported.promise;
      expect(result.error).toBeInstanceOf(Error);
      expect((result.error as Error).message).toBe("scheduled failure");
      expect(result.events).toEqual([published]);
    } finally {
      worker.dispose();
    }
  });

  test("dispose unsubscribes and clears pending events", async () => {
    const eventBus = createEventBus();
    const batches: BackendEvent[][] = [];
    const worker = createDomainEventWorker(eventBus, {
      debounceMs: 10_000,
      async processBatch(events) {
        batches.push(events);
        return { assetEnrichmentIds: [], portfolioJob: null, brokerSyncAccountIds: [] };
      },
    });

    eventBus.publish(event(ASSETS_CREATED_EVENT, { asset_ids: ["asset-1"] }));
    expect(worker.pendingCount()).toBe(1);
    worker.dispose();
    eventBus.publish(event(ASSETS_CREATED_EVENT, { asset_ids: ["asset-2"] }));
    await worker.flush();

    expect(worker.pendingCount()).toBe(0);
    expect(batches).toEqual([]);
  });

  test("flushAndDispose drains queued events without accepting new ones", async () => {
    const eventBus = createEventBus();
    const batches: BackendEvent[][] = [];
    const worker = createDomainEventWorker(eventBus, {
      debounceMs: 10_000,
      async processBatch(events) {
        batches.push(events);
        eventBus.publish(event(ASSETS_CREATED_EVENT, { asset_ids: ["nested"] }));
        return { assetEnrichmentIds: [], portfolioJob: null, brokerSyncAccountIds: [] };
      },
    });

    eventBus.publish(event(ASSETS_CREATED_EVENT, { asset_ids: ["asset-1"] }));
    await worker.flushAndDispose();
    eventBus.publish(event(ASSETS_CREATED_EVENT, { asset_ids: ["asset-2"] }));
    await worker.flush();

    expect(worker.pendingCount()).toBe(0);
    expect(batches).toEqual([[event(ASSETS_CREATED_EVENT, { asset_ids: ["asset-1"] })]]);
  });
});

function event(name: string, payload?: Record<string, unknown>): BackendEvent {
  return { name, payload };
}
