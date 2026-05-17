import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import type { SecretService } from "./secrets";
import { createAiProviderService, normalizeToolsAllowlist } from "./ai-providers";

describe("TS AI provider domain", () => {
  test("merges catalog defaults, settings, secrets, models, tools, and tuning", () => {
    const { db, secrets } = createDbAndSecrets();
    secrets.set("ai_openai", "secret-key");
    db.prepare("INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?)").run(
      "ai_provider_settings",
      JSON.stringify({
        schemaVersion: 2,
        defaultProvider: "openai",
        providers: {
          openai: {
            enabled: true,
            favorite: true,
            selectedModel: "custom-model",
            priority: 0,
            modelCapabilityOverrides: { "custom-model": { tools: true } },
            favoriteModels: ["custom-model"],
            toolsAllowlist: [
              "get_accounts",
              "get_holdings",
              "search_activities",
              "get_performance",
              "get_income",
              "get_asset_allocation",
              "get_valuation_history",
              "get_goals",
            ],
            tuningOverrides: {
              temperature: 0.4,
              extraOptionOverrides: { seed: 42 },
            },
          },
          anthropic: {
            tuningOverrides: {
              extraOptionOverrides: { top_k: 40, top_p: 0.9, seed: 42 },
            },
          },
        },
      }),
    );
    const service = createAiProviderService({
      db,
      secretService: createMemorySecretService(secrets),
      catalogJson: testCatalogJson(),
    });

    const response = service.getAiProviders();

    expect(response.defaultProvider).toBe("openai");
    expect(response.providers.map((provider) => provider.id)).toEqual([
      "ollama",
      "openai",
      "anthropic",
      "google",
    ]);
    const openai = response.providers.find((provider) => provider.id === "openai");
    expect(openai).toMatchObject({
      enabled: true,
      favorite: true,
      hasApiKey: true,
      isDefault: true,
      priority: 20,
      toolsAllowlist: [
        "get_accounts",
        "get_holdings",
        "search_activities",
        "get_performance",
        "get_income",
        "get_asset_allocation",
        "get_valuation_history",
        "get_goals",
        "get_cash_balances",
        "record_activity",
        "record_activities",
        "import_csv",
        "get_health_status",
      ],
      resolvedTuning: {
        temperature: 0.4,
        maxTokens: 1024,
        extraOptions: { seed: 42 },
      },
    });
    expect(openai?.models.map((model) => model.id)).toEqual(["custom-model", "gpt-a", "gpt-b"]);
    expect(openai?.models[0]).toMatchObject({
      isCatalog: false,
      isFavorite: true,
      capabilities: { tools: true, thinking: false, vision: false, streaming: true },
    });
    expect(service.resolveChatProviderConfig()).toMatchObject({
      providerId: "openai",
      modelId: "custom-model",
      titleModelId: "gpt-b",
      apiKey: "secret-key",
    });
    const anthropic = response.providers.find((provider) => provider.id === "anthropic");
    expect(anthropic?.resolvedTuning?.extraOptions).toEqual({ seed: 42 });
  });

  test("persists provider settings updates with Rust-compatible clearing and validation", () => {
    const { db, secrets } = createDbAndSecrets();
    const service = createAiProviderService({
      db,
      secretService: createMemorySecretService(secrets),
      catalogJson: testCatalogJson(),
    });

    service.updateProviderSettings({
      providerId: "openai",
      enabled: true,
      customUrl: "",
      favoriteModels: ["gpt-b"],
      modelCapabilityOverride: { modelId: "gpt-b", overrides: { streaming: false } },
      toolsAllowlist: ["get_accounts"],
      tuningOverrides: { maxTokens: 2048 },
    });
    service.updateProviderSettings({
      providerId: "openai",
      modelCapabilityOverride: { modelId: "gpt-b", overrides: null },
    });

    const stored = JSON.parse(readSetting(db, "ai_provider_settings"));
    expect(stored.schemaVersion).toBe(2);
    expect(stored.providers.openai.customUrl).toBeUndefined();
    expect(stored.providers.openai.toolsAllowlist).toEqual(["get_accounts", "get_cash_balances"]);
    expect(stored.providers.openai.modelCapabilityOverrides).toEqual({});
    expect(stored.providers.openai.tuningOverrides).toEqual({ maxTokens: 2048 });

    expect(() =>
      service.updateProviderSettings({
        providerId: "missing",
      }),
    ).toThrow("Unknown provider: missing");
    expect(() =>
      service.updateProviderSettings({
        providerId: "openai",
        tuningOverrides: { maxTokens: 10 },
      }),
    ).toThrow("maxTokens must be between 256 and 131072");
    expect(() =>
      service.updateProviderSettings({
        providerId: "openai",
        tuningOverrides: { extraOptionOverrides: { nested: [] as unknown as string } },
      }),
    ).toThrow("arrays and objects are not user-editable");
  });

  test("sets and clears the default provider with provider validation", () => {
    const { db, secrets } = createDbAndSecrets();
    const service = createAiProviderService({
      db,
      secretService: createMemorySecretService(secrets),
      catalogJson: testCatalogJson(),
    });

    service.setDefaultProvider({ providerId: "openai" });
    expect(JSON.parse(readSetting(db, "ai_provider_settings")).defaultProvider).toBe("openai");

    service.setDefaultProvider({});
    expect(JSON.parse(readSetting(db, "ai_provider_settings")).defaultProvider).toBeUndefined();
    expect(() => service.setDefaultProvider({ providerId: "missing" })).toThrow(
      "Unknown provider: missing",
    );
  });

  test("lists models with provider-specific request and response formats", async () => {
    const { db, secrets } = createDbAndSecrets();
    for (const providerId of ["openai", "anthropic", "google"]) {
      secrets.set(`ai_${providerId}`, `${providerId}-key`);
    }
    const requests: Array<{ url: string; headers?: HeadersInit }> = [];
    const service = createAiProviderService({
      db,
      secretService: createMemorySecretService(secrets),
      catalogJson: testCatalogJson(),
      fetchModels: async (url, init) => {
        requests.push({ url, headers: init?.headers });
        if (url.includes("anthropic")) {
          return Response.json({ data: [{ id: "claude", display_name: "Claude" }] });
        }
        if (url.includes("generativelanguage")) {
          return Response.json({
            models: [
              { name: "models/gemini-pro", displayName: "Gemini Pro" },
              { name: "models/embedding-001", displayName: "Embedding" },
            ],
          });
        }
        if (url.includes("localhost")) {
          return Response.json({ models: [{ name: "llama3" }] });
        }
        return Response.json({ data: [{ id: "gpt-4.1" }] });
      },
    });

    await expect(service.listModels("openai")).resolves.toEqual({
      models: [{ id: "gpt-4.1", name: "gpt-4.1" }],
      supportsListing: true,
    });
    await expect(service.listModels("anthropic")).resolves.toEqual({
      models: [{ id: "claude", name: "Claude" }],
      supportsListing: true,
    });
    await expect(service.listModels("google")).resolves.toEqual({
      models: [{ id: "gemini-pro", name: "Gemini Pro" }],
      supportsListing: true,
    });
    await expect(service.listModels("ollama")).resolves.toEqual({
      models: [{ id: "llama3", name: "llama3" }],
      supportsListing: true,
    });

    expect(requests[0]).toMatchObject({
      url: "https://api.openai.com/v1/models",
      headers: { Authorization: "Bearer openai-key" },
    });
    expect(requests[1]).toMatchObject({
      url: "https://api.anthropic.com/v1/models",
      headers: { "x-api-key": "anthropic-key", "anthropic-version": "2023-06-01" },
    });
    expect(requests[2].url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models?key=google-key",
    );
    expect(requests[3]).toMatchObject({
      url: "http://localhost:11434/api/tags",
    });
  });

  test("rejects model listing for unknown providers and missing API keys", async () => {
    const { db, secrets } = createDbAndSecrets();
    const service = createAiProviderService({
      db,
      secretService: createMemorySecretService(secrets),
      catalogJson: testCatalogJson(),
    });

    await expect(service.listModels("missing")).rejects.toThrow("Unknown provider: missing");
    await expect(service.listModels("openai")).rejects.toThrow(
      "API key required for provider 'openai'",
    );
  });

  test("normalizes legacy grouped tool allowlists", () => {
    expect(normalizeToolsAllowlist([])).toEqual([]);
    expect(normalizeToolsAllowlist(["search_activities"])).toEqual([
      "search_activities",
      "record_activity",
      "record_activities",
      "import_csv",
    ]);
  });
});

function createDbAndSecrets(): { db: Database; secrets: Map<string, string> } {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE app_settings (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL)");
  return { db, secrets: new Map() };
}

function createMemorySecretService(secrets: Map<string, string>): SecretService {
  return {
    setSecret(secretKey, secret) {
      secrets.set(secretKey, secret);
    },
    getSecret(secretKey) {
      return secrets.get(secretKey) ?? null;
    },
    deleteSecret(secretKey) {
      secrets.delete(secretKey);
    },
  };
}

function readSetting(db: Database, key: string): string {
  const row = db
    .query<
      { setting_value: string },
      [string]
    >("SELECT setting_value FROM app_settings WHERE setting_key = ?")
    .get(key);
  if (!row) {
    throw new Error(`Missing setting ${key}`);
  }
  return row.setting_value;
}

function testCatalogJson(): string {
  return JSON.stringify({
    providers: {
      ollama: {
        name: "Ollama",
        type: "local",
        icon: "LogoOllama",
        description: "Local AI",
        envKey: "OLLAMA_API_KEY",
        defaultConfig: { enabled: true, priority: 10, url: "http://localhost:11434" },
        connectionFields: [],
        models: {
          llama3: { capabilities: { tools: false, thinking: true, vision: false } },
        },
        defaultModel: "llama3",
        documentationUrl: "https://ollama.test/docs",
      },
      openai: {
        name: "OpenAI",
        type: "api",
        icon: "LogoOpenAI",
        description: "OpenAI API",
        envKey: "OPENAI_API_KEY",
        defaultConfig: { enabled: false, priority: 20 },
        connectionFields: [],
        models: {
          "gpt-b": { capabilities: { tools: true, thinking: true, vision: true } },
          "gpt-a": { capabilities: { tools: true, thinking: false, vision: true } },
        },
        defaultModel: "gpt-a",
        titleModelId: "gpt-b",
        documentationUrl: "https://openai.test/docs",
        tuning: { temperature: 0.2, maxTokens: 1024 },
      },
      anthropic: {
        name: "Anthropic",
        type: "api",
        icon: "LogoAnthropic",
        description: "Anthropic API",
        envKey: "ANTHROPIC_API_KEY",
        defaultConfig: { enabled: false, priority: 30 },
        connectionFields: [],
        models: { claude: { capabilities: { tools: true, thinking: false, vision: true } } },
        defaultModel: "claude",
        documentationUrl: "https://anthropic.test/docs",
        tuning: { maxTokens: 4096, extraOptions: { seed: 1 } },
      },
      google: {
        name: "Google",
        type: "api",
        icon: "LogoGoogle",
        description: "Google API",
        envKey: "GEMINI_API_KEY",
        defaultConfig: { enabled: false, priority: 40 },
        connectionFields: [],
        models: { "gemini-pro": { capabilities: { tools: true, thinking: true, vision: true } } },
        defaultModel: "gemini-pro",
        documentationUrl: "https://google.test/docs",
      },
    },
    capabilities: {
      tools: { name: "Tools", description: "Can use tools", icon: "Wrench" },
    },
  });
}
