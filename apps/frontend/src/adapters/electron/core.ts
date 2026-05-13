import {
  ELECTRON_API_KEY,
  type ElectronEventMessage,
  type WealthfolioElectronApi,
} from "@wealthfolio/electron/shared/ipc";

import type { Logger } from "../types";

export const isDesktop = true;
export const isWeb = false;

const DEFAULT_INVOKE_TIMEOUT_MS = 300_000;

export const logger: Logger = {
  error: (...args: unknown[]) => console.error(...args),
  warn: (...args: unknown[]) => console.warn(...args),
  info: (...args: unknown[]) => console.info(...args),
  debug: (...args: unknown[]) => console.debug(...args),
  trace: (...args: unknown[]) => console.trace(...args),
};

export function getElectronApi(): WealthfolioElectronApi {
  if (typeof window === "undefined" || !window[ELECTRON_API_KEY]) {
    throw new Error("Electron preload API is unavailable.");
  }

  return window[ELECTRON_API_KEY];
}

export const getRuntimeInfo = () => getElectronApi().getRuntimeInfo();

export const listen = async <T>(
  eventName: string,
  handler: (event: ElectronEventMessage<T>) => void,
) => getElectronApi().listen<T>(eventName, handler);

export const invoke = async <T>(command: string, payload?: Record<string, unknown>): Promise<T> => {
  try {
    return await Promise.race([
      getElectronApi().invoke<T>(command, payload),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Command "${command}" timed out`)),
          DEFAULT_INVOKE_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch (error) {
    logger.error(`[Electron Invoke] Command "${command}" failed: ${error}`);
    throw error;
  }
};

export const startAiChatStream = async (streamId: string, request: unknown): Promise<void> => {
  await getElectronApi().startAiChatStream(streamId, request);
};

export const cancelAiChatStream = async (streamId: string): Promise<void> => {
  await getElectronApi().cancelAiChatStream(streamId);
};
