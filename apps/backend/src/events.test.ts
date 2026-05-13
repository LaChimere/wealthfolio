import { describe, expect, test } from "bun:test";

import { createEventBus, createEventStream, formatSseEvent } from "./events";

describe("TS backend event bus shell", () => {
  test("publishes events to subscribed listeners and supports unsubscribe", () => {
    const bus = createEventBus();
    const received: unknown[] = [];
    const unsubscribe = bus.subscribe((event) => received.push(event));

    bus.publish({ name: "portfolio:updated", payload: { accountId: "account-1" } });
    unsubscribe();
    bus.publish({ name: "portfolio:updated", payload: { accountId: "account-2" } });

    expect(received).toEqual([{ name: "portfolio:updated", payload: { accountId: "account-1" } }]);
  });

  test("formats events as server-sent event messages", () => {
    expect(formatSseEvent({ name: "portfolio_update_start" })).toBe(
      "event: portfolio_update_start\ndata: null\n\n",
    );
    expect(
      formatSseEvent({ name: "portfolio_update_complete", payload: { accountId: "acc-1" } }),
    ).toBe('event: portfolio_update_complete\ndata: {"accountId":"acc-1"}\n\n');
  });

  test("streams published events and unsubscribes on cancel", async () => {
    const bus = createEventBus();
    const stream = createEventStream(bus, 60_000);
    const reader = stream.getReader();

    bus.publish({ name: "market_sync_start", payload: { source: "YAHOO" } });
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe(
      'event: market_sync_start\ndata: {"source":"YAHOO"}\n\n',
    );

    await reader.cancel();
    expect(() =>
      bus.publish({ name: "market_sync_start", payload: { source: "FINNHUB" } }),
    ).not.toThrow();
  });
});
