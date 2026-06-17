import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveSymbolQuote } from "./market-data";
import { invoke } from "./platform";

vi.mock("./platform", () => ({
  invoke: vi.fn(),
  logger: {
    error: vi.fn(),
  },
}));

const invokeMock = vi.mocked(invoke);

afterEach(() => {
  vi.clearAllMocks();
});

describe("shared market-data adapter", () => {
  it("loads resolved quotes through the runtime adapter", async () => {
    const resolved = { currency: "USD", price: 12.34, resolvedProviderId: "YAHOO" };
    invokeMock.mockResolvedValueOnce(resolved);

    await expect(resolveSymbolQuote("AAPL", "XNAS", "EQUITY", "YAHOO", "USD")).resolves.toBe(
      resolved,
    );
    expect(invokeMock).toHaveBeenCalledWith("resolve_symbol_quote", {
      symbol: "AAPL",
      exchangeMic: "XNAS",
      instrumentType: "EQUITY",
      providerId: "YAHOO",
      quoteCcy: "USD",
    });
  });

  it("surfaces quote resolution failures", async () => {
    const error = new Error("backend unavailable");
    invokeMock.mockRejectedValueOnce(error);

    await expect(resolveSymbolQuote("AAPL")).rejects.toBe(error);
  });
});
