import { describe, expect, test } from "bun:test";

import { ELECTRON_FILE_DROP_EVENTS } from "../shared/ipc";
import { validateFileDropEventMessage } from "./file-drop";

describe("Electron file-drop bridge", () => {
  test("validates Tauri-compatible hover/drop payloads", () => {
    expect(
      validateFileDropEventMessage({
        event: ELECTRON_FILE_DROP_EVENTS.drop,
        payload: {
          paths: ["/tmp/import.csv"],
          position: { x: 10, y: 20 },
        },
      }),
    ).toEqual({
      event: "tauri://file-drop",
      payload: {
        paths: ["/tmp/import.csv"],
        position: { x: 10, y: 20 },
      },
    });

    expect(
      validateFileDropEventMessage({
        event: ELECTRON_FILE_DROP_EVENTS.cancelled,
        payload: { ignored: true },
      }),
    ).toEqual({
      event: "tauri://file-drop-cancelled",
      payload: null,
    });
  });

  test("rejects malformed file-drop IPC messages", () => {
    expect(() => validateFileDropEventMessage({ event: "other", payload: null })).toThrow(
      "Invalid file-drop event.",
    );
    expect(() =>
      validateFileDropEventMessage({
        event: ELECTRON_FILE_DROP_EVENTS.drop,
        payload: { paths: ["/tmp/import.csv"], position: { x: Number.NaN, y: 1 } },
      }),
    ).toThrow("Invalid file-drop position.");
    expect(() =>
      validateFileDropEventMessage({
        event: ELECTRON_FILE_DROP_EVENTS.hover,
        payload: { paths: [42], position: { x: 1, y: 2 } },
      }),
    ).toThrow("Invalid file-drop paths.");
  });
});
