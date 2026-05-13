import { appendFile } from "node:fs/promises";

import { ELECTRON_LOG_LEVELS, type ElectronLogLevel } from "../shared/ipc";

export interface ElectronLogMessage {
  level: ElectronLogLevel;
  message: string;
}

export interface ElectronLogWriter {
  write(level: ElectronLogLevel, message: string): Promise<void>;
}

const MAX_LOG_MESSAGE_LENGTH = 16_384;
const LOG_LEVEL_SET = new Set<string>(ELECTRON_LOG_LEVELS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncateLogMessage(message: string): string {
  if (message.length <= MAX_LOG_MESSAGE_LENGTH) {
    return message;
  }

  return `${message.slice(0, MAX_LOG_MESSAGE_LENGTH)}... [truncated]`;
}

function isElectronLogLevel(value: unknown): value is ElectronLogLevel {
  return typeof value === "string" && LOG_LEVEL_SET.has(value);
}

export function validateLogMessage(message: unknown): ElectronLogMessage {
  if (
    !isRecord(message) ||
    !isElectronLogLevel(message.level) ||
    typeof message.message !== "string"
  ) {
    throw new Error("Invalid Electron log message.");
  }

  return {
    level: message.level,
    message: truncateLogMessage(message.message),
  };
}

export function formatLogEntry(
  level: ElectronLogLevel,
  message: string,
  timestamp = new Date(),
): string {
  return `${timestamp.toISOString()} [${level.toUpperCase()}] ${message}\n`;
}

export function createElectronLogWriter(
  logFilePath: string,
  writeFile: typeof appendFile = appendFile,
): ElectronLogWriter {
  return {
    async write(level, message) {
      await writeFile(logFilePath, formatLogEntry(level, truncateLogMessage(message)), "utf8");
    },
  };
}
