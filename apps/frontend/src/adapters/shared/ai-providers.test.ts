import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getAiProviders,
  listAiModels,
  setDefaultAiProvider,
  updateAiProviderSettings,
} from "./ai-providers";
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

describe("shared AI provider adapter", () => {
  it("delegates provider reads and mutations through the runtime adapter", async () => {
    const providers = { providers: [{ id: "openai" }], defaultProviderId: "openai" };
    const models = { models: [{ id: "gpt-4o" }] };
    invokeMock
      .mockResolvedValueOnce(providers)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(models);
    const settings = { providerId: "openai", enabled: true, apiKey: "secret" };
    const defaultRequest = { providerId: "openai" };

    await expect(getAiProviders()).resolves.toBe(providers);
    await expect(updateAiProviderSettings(settings)).resolves.toBeUndefined();
    await expect(setDefaultAiProvider(defaultRequest)).resolves.toBeUndefined();
    await expect(listAiModels("open/ai")).resolves.toBe(models);
    expect(invokeMock).toHaveBeenNthCalledWith(1, "get_ai_providers");
    expect(invokeMock).toHaveBeenNthCalledWith(2, "update_ai_provider_settings", {
      request: settings,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "set_default_ai_provider", {
      request: defaultRequest,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(4, "list_ai_models", {
      providerId: "open/ai",
    });
  });

  it("surfaces provider adapter failures", async () => {
    const error = new Error("backend unavailable");
    invokeMock.mockRejectedValueOnce(error);

    await expect(getAiProviders()).rejects.toBe(error);
  });
});
