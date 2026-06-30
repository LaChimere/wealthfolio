import { afterEach, describe, expect, it, vi } from "vitest";

import {
  listenBrokerSyncStart,
  listenFileDrop,
  listenMarketSyncComplete,
  listenPortfolioUpdateStart,
} from "./events";

class MockEventSource {
  static instances: MockEventSource[] = [];

  readonly listeners = new Map<string, Set<EventListener>>();
  readonly removed: { eventName: string; listener: EventListener }[] = [];
  onerror: ((error: unknown) => void) | null = null;
  closed = false;

  constructor(
    readonly url: string,
    readonly options?: EventSourceInit,
  ) {
    MockEventSource.instances.push(this);
  }

  addEventListener(eventName: string, listener: EventListener) {
    const listeners = this.listeners.get(eventName) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(eventName, listeners);
  }

  removeEventListener(eventName: string, listener: EventListener) {
    this.removed.push({ eventName, listener });
    this.listeners.get(eventName)?.delete(listener);
  }

  close() {
    this.closed = true;
  }

  dispatch(eventName: string, data: string | null) {
    for (const listener of this.listeners.get(eventName) ?? []) {
      listener({ data } as MessageEvent);
    }
  }
}

afterEach(() => {
  MockEventSource.instances = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("web event adapter", () => {
  it("shares a credentialed EventSource and parses JSON, null, and raw payloads", async () => {
    vi.stubGlobal("EventSource", MockEventSource);
    const portfolioHandler = vi.fn();
    const marketHandler = vi.fn();
    const brokerHandler = vi.fn();

    const unlistenPortfolio = await listenPortfolioUpdateStart(portfolioHandler);
    const unlistenMarket = await listenMarketSyncComplete(marketHandler);
    const unlistenBroker = await listenBrokerSyncStart(brokerHandler);
    const eventSource = MockEventSource.instances[0];

    expect(MockEventSource.instances).toHaveLength(1);
    expect(eventSource.url).toBe("/api/v1/events/stream");
    expect(eventSource.options).toEqual({ withCredentials: true });

    const marketPayload = {
      failed_syncs: [["BAD", "Symbol not found: BAD"]],
      skipped_reasons: [["SKIP", "Provider not supported for market sync: LEGACY_PROVIDER"]],
    };
    eventSource.dispatch("portfolio:update-start", JSON.stringify({ accountId: "account-1" }));
    eventSource.dispatch("market:sync-complete", JSON.stringify(marketPayload));
    eventSource.dispatch("broker:sync-start", "plain payload");

    expect(portfolioHandler).toHaveBeenCalledWith({
      event: "portfolio:update-start",
      id: 1,
      payload: { accountId: "account-1" },
    });
    expect(marketHandler).toHaveBeenCalledWith({
      event: "market:sync-complete",
      id: 2,
      payload: marketPayload,
    });
    expect(brokerHandler).toHaveBeenCalledWith({
      event: "broker:sync-start",
      id: 3,
      payload: "plain payload",
    });

    await unlistenPortfolio();
    expect(eventSource.closed).toBe(false);
    await unlistenMarket();
    await unlistenBroker();
    expect(eventSource.closed).toBe(true);
    expect(eventSource.removed.map((entry) => entry.eventName)).toEqual([
      "portfolio:update-start",
      "market:sync-complete",
      "broker:sync-start",
    ]);
  });

  it("rejects SSE listeners when EventSource is unavailable", async () => {
    vi.stubGlobal("EventSource", undefined);

    await expect(listenPortfolioUpdateStart(vi.fn())).rejects.toThrow(
      "EventSource is not available in this environment.",
    );
  });

  it("keeps desktop-only file-drop listeners as web no-ops", async () => {
    vi.stubGlobal("EventSource", MockEventSource);

    const unlisten = await listenFileDrop(vi.fn());
    await expect(unlisten()).resolves.toBeUndefined();
    expect(MockEventSource.instances).toHaveLength(0);
  });
});
