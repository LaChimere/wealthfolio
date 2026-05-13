import { describe, expect, test } from "bun:test";

import { createEventBus } from "./events";

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
});
