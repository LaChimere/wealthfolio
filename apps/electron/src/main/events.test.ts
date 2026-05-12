import { describe, expect, test } from "bun:test";

import { parseSseMessages, sanitizeEventPayload } from "./events";

describe("Electron sidecar event bridge", () => {
  test("parses named SSE events with JSON payloads across chunks", () => {
    const first = parseSseMessages('event: portfolio:update-start\ndata: {"accountId":"a');
    expect(first).toEqual({
      messages: [],
      rest: 'event: portfolio:update-start\ndata: {"accountId":"a',
    });

    const second = parseSseMessages(`${first.rest}1"}\n\n`);
    expect(second).toEqual({
      messages: [{ event: "portfolio:update-start", payload: { accountId: "a1" } }],
      rest: "",
    });
  });

  test("handles CRLF, comments, null payloads, and multiline data", () => {
    const parsed = parseSseMessages(
      ": keep-alive\r\n\r\nevent: market:sync-error\r\ndata: first\r\ndata: second\r\n\r\nevent: broker:sync-complete\r\ndata: null\r\n\r\n",
    );

    expect(parsed).toEqual({
      messages: [
        { event: "market:sync-error", payload: "first\nsecond" },
        { event: "broker:sync-complete", payload: null },
      ],
      rest: "",
    });
  });

  test("sanitizes sidecar URLs and tokens in event payloads", () => {
    expect(
      sanitizeEventPayload(
        {
          message: "Failed http://127.0.0.1:18444 token=sidecar-token",
          nested: ["Bearer sidecar-token", "plain"],
        },
        "sidecar-token",
      ),
    ).toEqual({
      message: "Failed [sidecar] token=[redacted]",
      nested: ["Bearer [redacted]", "plain"],
    });
  });
});
