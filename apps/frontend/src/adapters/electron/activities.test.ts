import { ELECTRON_API_KEY, type WealthfolioElectronApi } from "@wealthfolio/electron/shared/ipc";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseCsv } from "./activities";

function installElectronApi(api: Partial<WealthfolioElectronApi>) {
  window[ELECTRON_API_KEY] = {
    getRuntimeInfo: vi.fn(),
    invoke: vi.fn(),
    writeLog: vi.fn().mockResolvedValue(undefined),
    ...api,
  } as WealthfolioElectronApi;
}

afterEach(() => {
  delete window[ELECTRON_API_KEY];
  vi.restoreAllMocks();
});

describe("electron activities adapter", () => {
  it("parses CSV files through Electron main with byte content", async () => {
    const parsed = { headers: ["Date", "Amount"], rows: [{ Date: "2026-06-21", Amount: "42" }] };
    const bridgeInvoke = vi.fn().mockResolvedValue(parsed);
    installElectronApi({ invoke: bridgeInvoke });
    const file = new File(
      [new Uint8Array([0xef, 0xbb, 0xbf]), "Date,Amount\n2026-06-21,42"],
      "import.csv",
      {
        type: "text/csv",
      },
    );
    const config = { delimiter: ",", mappings: { date: "Date", amount: "Amount" } };

    await expect(parseCsv(file, config)).resolves.toEqual(parsed);
    expect(bridgeInvoke).toHaveBeenCalledWith("parse_csv", {
      content: [
        0xef, 0xbb, 0xbf, 68, 97, 116, 101, 44, 65, 109, 111, 117, 110, 116, 10, 50, 48, 50, 54, 45,
        48, 54, 45, 50, 49, 44, 52, 50,
      ],
      config,
    });
  });
});
