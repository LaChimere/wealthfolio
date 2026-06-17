import { describe, expect, it, vi } from "vitest";

import type { Settings } from "@/lib/types";
import { getAppInfo, getSettings } from "./settings";
import { invoke } from "./core";

vi.mock("./core", () => ({
  API_PREFIX: "/api/v1",
  invoke: vi.fn(),
  logger: {
    error: vi.fn(),
  },
}));

const invokeMock = vi.mocked(invoke);

describe("web settings adapter", () => {
  it("loads settings through the backend", async () => {
    const settings = { baseCurrency: "USD" } as Settings;
    invokeMock.mockResolvedValueOnce(settings);

    await expect(getSettings()).resolves.toBe(settings);
    expect(invokeMock).toHaveBeenCalledWith("get_settings");
  });

  it("surfaces settings fetch failures", async () => {
    const error = new Error("backend unavailable");
    invokeMock.mockRejectedValueOnce(error);

    await expect(getSettings()).rejects.toBe(error);
  });

  it("loads app info through the backend", async () => {
    const appInfo = {
      version: "3.4.0",
      dbPath: "/safe/app.db",
      logsDir: "/safe/logs",
    };
    invokeMock.mockResolvedValueOnce(appInfo);

    await expect(getAppInfo()).resolves.toBe(appInfo);
    expect(invokeMock).toHaveBeenCalledWith("get_app_info");
  });

  it("surfaces app info fetch failures", async () => {
    const error = new Error("backend unavailable");
    invokeMock.mockRejectedValueOnce(error);

    await expect(getAppInfo()).rejects.toBe(error);
  });
});
