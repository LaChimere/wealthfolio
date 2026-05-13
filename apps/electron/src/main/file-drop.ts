import {
  ELECTRON_FILE_DROP_EVENTS,
  type ElectronFileDropEventMessage,
  type ElectronFileDropEventName,
  type ElectronFileDropPayload,
} from "../shared/ipc";

const FILE_DROP_EVENT_NAMES = new Set<string>(Object.values(ELECTRON_FILE_DROP_EVENTS));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFileDropEventName(value: unknown): value is ElectronFileDropEventName {
  return typeof value === "string" && FILE_DROP_EVENT_NAMES.has(value);
}

function validateFileDropPayload(payload: unknown): ElectronFileDropPayload {
  if (!isRecord(payload) || !Array.isArray(payload.paths) || !isRecord(payload.position)) {
    throw new Error("Invalid file-drop payload.");
  }

  if (!payload.paths.every((path) => typeof path === "string")) {
    throw new Error("Invalid file-drop paths.");
  }

  const { x, y } = payload.position;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  ) {
    throw new Error("Invalid file-drop position.");
  }

  return {
    paths: [...payload.paths],
    position: { x, y },
  };
}

export function validateFileDropEventMessage(message: unknown): ElectronFileDropEventMessage {
  if (!isRecord(message) || !isFileDropEventName(message.event)) {
    throw new Error("Invalid file-drop event.");
  }

  if (message.event === ELECTRON_FILE_DROP_EVENTS.cancelled) {
    return {
      event: message.event,
      payload: null,
    };
  }

  return {
    event: message.event,
    payload: validateFileDropPayload(message.payload),
  };
}
