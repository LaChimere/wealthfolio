import { ELECTRON_API_KEY, type WealthfolioElectronApi } from "@wealthfolio/electron/shared/ipc";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AiSendMessageRequest } from "@/features/ai-assistant/types";
import { streamAiChat } from "./ai-streaming";

function installElectronApi(api: Partial<WealthfolioElectronApi>) {
  window[ELECTRON_API_KEY] = {
    getRuntimeInfo: vi.fn(),
    invoke: vi.fn(),
    ...api,
  } as WealthfolioElectronApi;
}

afterEach(() => {
  delete window[ELECTRON_API_KEY];
});

describe("electron AI streaming adapter", () => {
  it("yields an explicit error event while the Electron streaming bridge is pending", async () => {
    installElectronApi({ invoke: vi.fn().mockResolvedValue(undefined) });

    const events = [];
    for await (const event of streamAiChat({} as AiSendMessageRequest)) {
      events.push(event);
    }

    expect(events).toEqual([
      expect.objectContaining({
        type: "error",
        message: "Electron AI streaming is not available until the native bridge is connected.",
      }),
    ]);
  });
});
