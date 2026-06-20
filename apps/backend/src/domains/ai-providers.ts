import type { Database } from "bun:sqlite";

import { rawJsonU32FieldIsValid } from "../json-raw";
import type { SecretService } from "./secrets";

export interface ModelCapabilities {
  tools: boolean;
  thinking: boolean;
  vision: boolean;
  streaming: boolean;
}

export interface ModelCapabilityOverrides {
  tools?: boolean;
  thinking?: boolean;
  vision?: boolean;
  streaming?: boolean;
}

export interface MergedModel {
  id: string;
  name?: string;
  capabilities: ModelCapabilities;
  isCatalog: boolean;
  isFavorite: boolean;
  hasCapabilityOverrides: boolean;
}

export interface ConnectionField {
  key: string;
  label: string;
  type: string;
  placeholder: string;
  required: boolean;
  helpUrl?: string;
}

export interface CapabilityInfo {
  name: string;
  description: string;
  icon: string;
}

export interface ProviderDefaultConfig {
  enabled?: boolean;
  priority?: number;
  url?: string;
}

export interface ProviderTuning {
  temperature?: number;
  maxTokens?: number;
  maxTokensThinking?: number;
  extraOptions?: Record<string, unknown>;
}

export interface ProviderTuningOverrides {
  temperature?: number;
  maxTokens?: number;
  maxTokensThinking?: number;
  extraOptionOverrides?: Record<string, number | boolean | string | null>;
}

export interface CatalogProvider {
  name: string;
  type: string;
  icon: string;
  description: string;
  envKey: string;
  defaultConfig?: ProviderDefaultConfig;
  connectionFields?: ConnectionField[];
  models: Record<string, { capabilities?: Partial<ModelCapabilities> }>;
  defaultModel: string;
  titleModelId?: string;
  documentationUrl: string;
  tuning?: ProviderTuning;
}

export interface AiProviderCatalog {
  providers: Record<string, CatalogProvider>;
  capabilities: Record<string, CapabilityInfo>;
}

export interface MergedProvider {
  id: string;
  name: string;
  type: string;
  icon: string;
  description: string;
  envKey: string;
  connectionFields: ConnectionField[];
  models: MergedModel[];
  defaultModel: string;
  documentationUrl: string;
  enabled: boolean;
  favorite: boolean;
  selectedModel?: string;
  customUrl?: string;
  priority: number;
  favoriteModels: string[];
  modelCapabilityOverrides: Record<string, ModelCapabilityOverrides>;
  toolsAllowlist?: string[] | null;
  hasApiKey: boolean;
  isDefault: boolean;
  supportsModelListing: boolean;
  catalogTuning?: ProviderTuning;
  tuningOverrides?: ProviderTuningOverrides;
  resolvedTuning?: ProviderTuning;
}

export interface AiProvidersResponse {
  providers: MergedProvider[];
  capabilities: Record<string, CapabilityInfo>;
  defaultProvider?: string | null;
}

export interface ModelCapabilityOverrideUpdate {
  modelId: string;
  overrides?: ModelCapabilityOverrides | null;
}

export interface AiProviderSettingsUpdate extends Record<string, unknown> {
  providerId: string;
  enabled?: boolean;
  favorite?: boolean;
  selectedModel?: string;
  customUrl?: string;
  priority?: number;
  modelCapabilityOverride?: ModelCapabilityOverrideUpdate | Record<string, unknown>;
  favoriteModels?: string[];
  toolsAllowlist?: string[] | null;
  tuningOverrides?: ProviderTuningOverrides | null;
}

export interface SetDefaultAiProviderRequest {
  providerId?: string | null;
}

export interface ListAiModelsResponse {
  models: Array<{
    id: string;
    name?: string | null;
  }>;
  supportsListing: boolean;
}

export interface AiChatProviderConfigRequest {
  providerId?: string;
  modelId?: string;
  thinking?: boolean;
}

export interface ResolvedAiChatProviderConfig {
  providerId: string;
  modelId: string;
  titleModelId?: string;
  providerType: string;
  baseUrl: string;
  apiKey?: string;
  capabilities: ModelCapabilities;
  toolsAllowlist?: string[] | null;
  tuning?: ProviderTuning;
}

export interface AiProviderService {
  getAiProviders(): Promise<AiProvidersResponse> | AiProvidersResponse;
  updateProviderSettings(request: AiProviderSettingsUpdate): Promise<void> | void;
  setDefaultProvider(request: SetDefaultAiProviderRequest): Promise<void> | void;
  listModels(providerId: string): Promise<ListAiModelsResponse> | ListAiModelsResponse;
  resolveChatProviderConfig(request?: AiChatProviderConfigRequest): ResolvedAiChatProviderConfig;
}

export interface CreateAiProviderServiceOptions {
  db: Database;
  secretService: SecretService;
  catalogJson: string;
  fetchModels?: (input: string, init?: RequestInit) => Promise<Response>;
}

interface ProviderUserSettings {
  enabled?: boolean;
  favorite?: boolean;
  selectedModel?: string;
  customUrl?: string;
  priority?: number;
  modelCapabilityOverrides?: Record<string, ModelCapabilityOverrides>;
  favoriteModels?: string[];
  toolsAllowlist?: string[] | null;
  tuningOverrides?: ProviderTuningOverrides;
}

interface StoredAiProviderSettings {
  schemaVersion: number;
  defaultProvider?: string | null;
  providers: Record<string, ProviderUserSettings>;
}

const AI_PROVIDER_SETTINGS_KEY = "ai_provider_settings";
const AI_PROVIDER_SETTINGS_SCHEMA_VERSION = 2;
const DEFAULT_PRIORITY = 100;
const I32_MIN = -2_147_483_648;
const I32_MAX = 2_147_483_647;
const U32_MAX = 4_294_967_295;
const LEGACY_VISIBLE_DATA_TOOLS = [
  "get_accounts",
  "get_holdings",
  "search_activities",
  "get_performance",
  "get_income",
  "get_asset_allocation",
  "get_valuation_history",
  "get_goals",
] as const;

export function createAiProviderService(
  options: CreateAiProviderServiceOptions,
): AiProviderService {
  const catalog = parseCatalog(options.catalogJson);
  const fetchModels = options.fetchModels ?? fetch;

  return {
    getAiProviders() {
      const userSettings = loadUserSettings(options.db, catalog);
      const providers = Object.entries(catalog.providers)
        .map(([id, catalogProvider]) =>
          mergeProvider(id, catalogProvider, userSettings, options.secretService),
        )
        .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

      const response: AiProvidersResponse = {
        providers,
        capabilities: catalog.capabilities,
      };
      if (userSettings.defaultProvider !== undefined) {
        response.defaultProvider = userSettings.defaultProvider;
      }
      return response;
    },

    updateProviderSettings(request) {
      assertKnownProvider(catalog, request.providerId);
      const settings = loadUserSettings(options.db, catalog);
      const providerSettings = settings.providers[request.providerId] ?? {};

      if ("enabled" in request) {
        providerSettings.enabled = request.enabled;
      }
      if ("favorite" in request) {
        providerSettings.favorite = request.favorite;
      }
      if ("selectedModel" in request && request.selectedModel !== undefined) {
        providerSettings.selectedModel = request.selectedModel;
      }
      if ("customUrl" in request && request.customUrl !== undefined) {
        providerSettings.customUrl = request.customUrl.trim() ? request.customUrl : undefined;
      }
      if (request.priority !== undefined) {
        validateI32Priority(request.priority);
        providerSettings.priority = request.priority;
      }
      if ("favoriteModels" in request && request.favoriteModels !== undefined) {
        providerSettings.favoriteModels = request.favoriteModels;
      }
      if ("toolsAllowlist" in request) {
        providerSettings.toolsAllowlist = normalizeToolsAllowlist(
          request.toolsAllowlist ?? undefined,
        );
      }
      if ("modelCapabilityOverride" in request && request.modelCapabilityOverride !== undefined) {
        applyModelCapabilityOverride(providerSettings, request.modelCapabilityOverride);
      }
      if ("tuningOverrides" in request) {
        providerSettings.tuningOverrides = normalizeTuningOverrideUpdate(request.tuningOverrides);
      }

      settings.providers[request.providerId] = providerSettings;
      settings.schemaVersion = AI_PROVIDER_SETTINGS_SCHEMA_VERSION;
      saveUserSettings(options.db, settings);
    },

    setDefaultProvider(request) {
      if (request.providerId !== undefined && request.providerId !== null) {
        assertKnownProvider(catalog, request.providerId);
      }
      const settings = loadUserSettings(options.db, catalog);
      settings.defaultProvider = request.providerId ?? undefined;
      settings.schemaVersion = AI_PROVIDER_SETTINGS_SCHEMA_VERSION;
      saveUserSettings(options.db, settings);
    },

    async listModels(providerId) {
      assertKnownProvider(catalog, providerId);
      const provider = catalog.providers[providerId];
      const apiKey = getProviderApiKey(options.secretService, providerId);
      if (provider.type === "api" && !apiKey) {
        throw new Error(`API key required for provider '${providerId}'`);
      }

      const baseUrl = providerBaseUrl(providerId, provider, loadUserSettings(options.db, catalog));
      const requestUrl = modelListUrl(providerId, baseUrl, apiKey);
      const response = await fetchModels(requestUrl, modelListRequestInit(providerId, apiKey));
      if (!response.ok) {
        throw new Error(`Provider returned error ${response.status}: ${await response.text()}`);
      }

      return {
        models: parseModelListResponse(providerId, await response.json()),
        supportsListing: true,
      };
    },

    resolveChatProviderConfig(request = {}) {
      const userSettings = loadUserSettings(options.db, catalog);
      const providerId = normalizeProviderId(
        request.providerId ?? userSettings.defaultProvider ?? undefined,
      );
      assertKnownProvider(catalog, providerId);

      const provider = catalog.providers[providerId];
      const providerUserSettings = userSettings.providers[providerId] ?? {};
      const requestedModel = request.modelId?.trim();
      const modelId =
        requestedModel && requestedModel.length > 0
          ? requestedModel
          : (providerUserSettings.selectedModel ?? provider.defaultModel);
      const capabilities = modelCapabilitiesFor(provider, providerUserSettings, modelId);
      if (request.thinking !== undefined) {
        capabilities.thinking = request.thinking;
      }
      const sanitizedOverrides = providerUserSettings.tuningOverrides
        ? sanitizeTuningOverrides(providerId, providerUserSettings.tuningOverrides)
        : undefined;
      const tuning = resolveProviderTuning(provider.tuning, sanitizedOverrides);
      const toolsAllowlist = normalizeToolsAllowlist(
        providerUserSettings.toolsAllowlist ?? undefined,
      );

      const resolved: ResolvedAiChatProviderConfig = {
        providerId,
        modelId,
        titleModelId: provider.titleModelId ?? provider.defaultModel,
        providerType: provider.type,
        baseUrl: providerBaseUrl(providerId, provider, userSettings),
        capabilities,
      };
      const apiKey = getProviderApiKey(options.secretService, providerId);
      if (apiKey !== undefined) {
        resolved.apiKey = apiKey;
      }
      if (toolsAllowlist !== undefined) {
        resolved.toolsAllowlist = toolsAllowlist;
      }
      if (tuning !== undefined) {
        resolved.tuning = tuning;
      }
      return resolved;
    },
  };
}

export function normalizeToolsAllowlist(
  toolsAllowlist: string[] | undefined,
): string[] | undefined {
  if (toolsAllowlist === undefined) {
    return undefined;
  }
  const tools = [...toolsAllowlist];
  if (tools.length === 0) {
    return tools;
  }

  if (tools.includes("get_accounts")) {
    pushOnce(tools, "get_cash_balances");
  }
  if (tools.includes("search_activities")) {
    pushOnce(tools, "record_activity");
    pushOnce(tools, "record_activities");
    pushOnce(tools, "import_csv");
  }
  if (LEGACY_VISIBLE_DATA_TOOLS.every((tool) => tools.includes(tool))) {
    pushOnce(tools, "get_health_status");
  }
  return tools;
}

function mergeProvider(
  id: string,
  catalogProvider: CatalogProvider,
  userSettings: StoredAiProviderSettings,
  secretService: SecretService,
): MergedProvider {
  const catalogDefault = catalogProvider.defaultConfig ?? {};
  const user = userSettings.providers[id] ?? {
    enabled: catalogDefault.enabled ?? false,
    favorite: catalogDefault.enabled ?? false,
    customUrl: catalogDefault.url,
    priority: catalogDefault.priority ?? DEFAULT_PRIORITY,
  };
  const modelCapabilityOverrides = user.modelCapabilityOverrides ?? {};
  const favoriteModels = user.favoriteModels ?? [];
  const models = mergeModels(catalogProvider, user);
  const tuningOverrides = user.tuningOverrides;
  const sanitizedOverrides = tuningOverrides
    ? sanitizeTuningOverrides(id, tuningOverrides)
    : undefined;
  const resolvedTuning = resolveProviderTuning(catalogProvider.tuning, sanitizedOverrides);
  const priority =
    user.priority === 0 || user.priority === DEFAULT_PRIORITY
      ? (catalogDefault.priority ?? DEFAULT_PRIORITY)
      : (user.priority ?? catalogDefault.priority ?? DEFAULT_PRIORITY);

  const merged: MergedProvider = {
    id,
    name: catalogProvider.name,
    type: catalogProvider.type,
    icon: catalogProvider.icon,
    description: catalogProvider.description,
    envKey: catalogProvider.envKey,
    connectionFields: catalogProvider.connectionFields ?? [],
    models,
    defaultModel: catalogProvider.defaultModel,
    documentationUrl: catalogProvider.documentationUrl,
    enabled: user.enabled ?? false,
    favorite: user.favorite ?? false,
    priority,
    favoriteModels,
    modelCapabilityOverrides,
    hasApiKey: hasProviderApiKey(secretService, id),
    isDefault: userSettings.defaultProvider === id,
    supportsModelListing: true,
  };
  if (user.selectedModel !== undefined) {
    merged.selectedModel = user.selectedModel;
  }
  if (user.customUrl !== undefined) {
    merged.customUrl = user.customUrl;
  }
  const normalizedTools = normalizeToolsAllowlist(user.toolsAllowlist ?? undefined);
  if (normalizedTools !== undefined) {
    merged.toolsAllowlist = normalizedTools;
  }
  if (catalogProvider.tuning !== undefined) {
    merged.catalogTuning = catalogProvider.tuning;
  }
  if (tuningOverrides !== undefined) {
    merged.tuningOverrides = tuningOverrides;
  }
  if (resolvedTuning !== undefined) {
    merged.resolvedTuning = resolvedTuning;
  }
  return merged;
}

function mergeModels(catalogProvider: CatalogProvider, user: ProviderUserSettings): MergedModel[] {
  const favoriteModels = user.favoriteModels ?? [];
  const capabilityOverrides = user.modelCapabilityOverrides ?? {};
  const models: MergedModel[] = Object.entries(catalogProvider.models).map(([modelId, model]) => {
    const overrides = capabilityOverrides[modelId];
    return {
      id: modelId,
      capabilities: overrides
        ? applyCapabilityOverrides(defaultModelCapabilities(model.capabilities), overrides)
        : defaultModelCapabilities(model.capabilities),
      isCatalog: true,
      isFavorite: favoriteModels.includes(modelId),
      hasCapabilityOverrides: overrides !== undefined,
    };
  });

  const nonCatalogModelIds = new Set<string>();
  if (user.selectedModel && !(user.selectedModel in catalogProvider.models)) {
    nonCatalogModelIds.add(user.selectedModel);
  }
  for (const modelId of favoriteModels) {
    if (!(modelId in catalogProvider.models)) {
      nonCatalogModelIds.add(modelId);
    }
  }
  for (const modelId of Object.keys(capabilityOverrides)) {
    if (!(modelId in catalogProvider.models)) {
      nonCatalogModelIds.add(modelId);
    }
  }

  for (const modelId of nonCatalogModelIds) {
    const overrides = capabilityOverrides[modelId];
    const baseCapabilities: ModelCapabilities = {
      tools: false,
      thinking: false,
      vision: false,
      streaming: true,
    };
    models.push({
      id: modelId,
      name: modelId,
      capabilities: overrides
        ? applyCapabilityOverrides(baseCapabilities, overrides)
        : baseCapabilities,
      isCatalog: false,
      isFavorite: favoriteModels.includes(modelId),
      hasCapabilityOverrides: overrides !== undefined,
    });
  }

  return models.sort((a, b) => a.id.localeCompare(b.id));
}

function modelCapabilitiesFor(
  catalogProvider: CatalogProvider,
  user: ProviderUserSettings,
  modelId: string,
): ModelCapabilities {
  return (
    mergeModels(catalogProvider, user).find((model) => model.id === modelId)?.capabilities ?? {
      tools: false,
      thinking: false,
      vision: false,
      streaming: true,
    }
  );
}

function normalizeProviderId(providerId: string | undefined): string {
  const trimmed = providerId?.trim() ?? "";
  if (trimmed.length === 0) {
    throw providerConfigError(
      "provider_not_configured",
      "AI provider is not configured. Select a provider before starting a chat.",
      400,
    );
  }
  return trimmed;
}

function providerConfigError(
  code: string,
  message: string,
  status: number,
): Error & { code: string; error: string; status: number } {
  const error = new Error(message) as Error & { code: string; error: string; status: number };
  error.code = code;
  error.error = message;
  error.status = status;
  return error;
}

function loadUserSettings(db: Database, catalog: AiProviderCatalog): StoredAiProviderSettings {
  const raw = getAppSetting(db, AI_PROVIDER_SETTINGS_KEY);
  if (raw) {
    try {
      if (!rawJsonU32FieldIsValid(raw, "schemaVersion")) {
        throw new Error("Invalid AI provider settings");
      }
      return normalizeStoredSettings(JSON.parse(raw));
    } catch {
      return createDefaultSettings(catalog);
    }
  }
  return createDefaultSettings(catalog);
}

function createDefaultSettings(catalog: AiProviderCatalog): StoredAiProviderSettings {
  const settings: StoredAiProviderSettings = {
    schemaVersion: AI_PROVIDER_SETTINGS_SCHEMA_VERSION,
    providers: {},
  };
  for (const [id, provider] of Object.entries(catalog.providers)) {
    if (provider.defaultConfig?.enabled) {
      settings.providers[id] = {
        enabled: true,
        favorite: true,
        customUrl: provider.defaultConfig.url,
      };
      settings.defaultProvider ??= id;
    }
  }
  return settings;
}

function saveUserSettings(db: Database, settings: StoredAiProviderSettings): void {
  db.prepare("INSERT OR REPLACE INTO app_settings (setting_key, setting_value) VALUES (?, ?)").run(
    AI_PROVIDER_SETTINGS_KEY,
    JSON.stringify(settings),
  );
}

function getAppSetting(db: Database, key: string): string | undefined {
  const row = db
    .query<
      { setting_value: string },
      [string]
    >("SELECT setting_value FROM app_settings WHERE setting_key = ?")
    .get(key);
  return row?.setting_value;
}

function normalizeStoredSettings(value: unknown): StoredAiProviderSettings {
  if (!isRecord(value)) {
    throw new Error("Invalid AI provider settings");
  }
  return {
    schemaVersion: normalizeStoredSchemaVersion(value.schemaVersion),
    defaultProvider:
      typeof value.defaultProvider === "string" || value.defaultProvider === null
        ? value.defaultProvider
        : undefined,
    providers: isRecord(value.providers)
      ? Object.fromEntries(
          Object.entries(value.providers)
            .filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]))
            .map(([providerId, provider]) => [providerId, normalizeProviderUserSettings(provider)]),
        )
      : {},
  };
}

function normalizeStoredSchemaVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > U32_MAX) {
    throw new Error("Invalid AI provider settings");
  }
  return value;
}

function normalizeProviderUserSettings(value: Record<string, unknown>): ProviderUserSettings {
  const settings: ProviderUserSettings = {};
  if (typeof value.enabled === "boolean") {
    settings.enabled = value.enabled;
  }
  if (typeof value.favorite === "boolean") {
    settings.favorite = value.favorite;
  }
  if (typeof value.selectedModel === "string") {
    settings.selectedModel = value.selectedModel;
  }
  if (typeof value.customUrl === "string") {
    settings.customUrl = value.customUrl;
  }
  if (value.priority !== undefined) {
    if (typeof value.priority !== "number" || !isI32Integer(value.priority)) {
      throw new Error("Invalid AI provider settings");
    }
    settings.priority = value.priority;
  }
  if (isStringArray(value.favoriteModels)) {
    settings.favoriteModels = value.favoriteModels;
  }
  if (isStringArray(value.toolsAllowlist)) {
    settings.toolsAllowlist = normalizeToolsAllowlist(value.toolsAllowlist);
  }
  if (isRecord(value.modelCapabilityOverrides)) {
    settings.modelCapabilityOverrides = normalizeModelCapabilityOverridesMap(
      value.modelCapabilityOverrides,
    );
  }
  if (isRecord(value.tuningOverrides)) {
    settings.tuningOverrides = parseTuningOverrides(value.tuningOverrides);
  }
  return settings;
}

function applyModelCapabilityOverride(
  providerSettings: ProviderUserSettings,
  update: ModelCapabilityOverrideUpdate | Record<string, unknown>,
): void {
  if (!isRecord(update) || typeof update.modelId !== "string") {
    throw new Error("modelCapabilityOverride.modelId is required");
  }
  providerSettings.modelCapabilityOverrides ??= {};
  if (update.overrides === undefined || update.overrides === null) {
    delete providerSettings.modelCapabilityOverrides[update.modelId];
    return;
  }
  if (!isRecord(update.overrides)) {
    throw new Error("modelCapabilityOverride.overrides must be an object or null");
  }
  providerSettings.modelCapabilityOverrides[update.modelId] = parseModelCapabilityOverrides(
    update.overrides,
  );
}

function normalizeModelCapabilityOverridesMap(
  value: Record<string, unknown>,
): Record<string, ModelCapabilityOverrides> {
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]))
      .map(([modelId, overrides]) => [modelId, parseModelCapabilityOverrides(overrides)]),
  );
}

function parseModelCapabilityOverrides(value: Record<string, unknown>): ModelCapabilityOverrides {
  const overrides: ModelCapabilityOverrides = {};
  for (const key of ["tools", "thinking", "vision", "streaming"] as const) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== "boolean") {
        throw new Error(`modelCapabilityOverride.overrides.${key} must be a boolean`);
      }
      overrides[key] = value[key];
    }
  }
  return overrides;
}

function normalizeTuningOverrideUpdate(
  update: ProviderTuningOverrides | Record<string, unknown> | null | undefined,
): ProviderTuningOverrides | undefined {
  if (update === null || update === undefined) {
    return undefined;
  }
  if (!isRecord(update)) {
    throw new Error("tuningOverrides must be an object or null");
  }
  const overrides = parseTuningOverrides(update);
  return tuningOverridesEmpty(overrides) ? undefined : overrides;
}

function validateI32Priority(priority: number): void {
  if (!isI32Integer(priority)) {
    throw new Error(
      "Invalid input: Priority must be an integer between -2147483648 and 2147483647",
    );
  }
}

function isI32Integer(value: number): boolean {
  return Number.isInteger(value) && value >= I32_MIN && value <= I32_MAX;
}

function parseTuningOverrides(value: Record<string, unknown>): ProviderTuningOverrides {
  const overrides: ProviderTuningOverrides = {};
  if (value.temperature !== undefined) {
    if (typeof value.temperature !== "number" || !Number.isFinite(value.temperature)) {
      throw new Error("tuning_overrides: temperature must be a finite number");
    }
    if (value.temperature < 0 || value.temperature > 2) {
      throw new Error(
        `tuning_overrides: temperature must be between 0.0 and 2.0 (got ${value.temperature})`,
      );
    }
    overrides.temperature = value.temperature;
  }
  for (const key of ["maxTokens", "maxTokensThinking"] as const) {
    const valueForKey = value[key];
    if (valueForKey !== undefined) {
      if (
        typeof valueForKey !== "number" ||
        !Number.isInteger(valueForKey) ||
        valueForKey < 256 ||
        valueForKey > 131_072
      ) {
        throw new Error(
          `tuning_overrides: ${key} must be between 256 and 131072 (got ${valueForKey})`,
        );
      }
      overrides[key] = valueForKey;
    }
  }
  if (value.extraOptionOverrides !== undefined) {
    if (!isRecord(value.extraOptionOverrides)) {
      throw new Error("tuning_overrides: extraOptionOverrides must be an object");
    }
    overrides.extraOptionOverrides = {};
    for (const [key, extraValue] of Object.entries(value.extraOptionOverrides)) {
      if (
        extraValue !== null &&
        typeof extraValue !== "number" &&
        typeof extraValue !== "boolean" &&
        typeof extraValue !== "string"
      ) {
        throw new Error(
          `tuning_overrides: extraOptionOverrides.${key}: arrays and objects are not user-editable (catalog-only)`,
        );
      }
      overrides.extraOptionOverrides[key] = extraValue;
    }
  }
  return overrides;
}

function sanitizeTuningOverrides(
  providerId: string,
  overrides: ProviderTuningOverrides,
): ProviderTuningOverrides {
  if (providerId !== "anthropic" || !overrides.extraOptionOverrides) {
    return overrides;
  }
  const extraOptionOverrides = { ...overrides.extraOptionOverrides };
  delete extraOptionOverrides.top_k;
  delete extraOptionOverrides.top_p;
  return { ...overrides, extraOptionOverrides };
}

function resolveProviderTuning(
  catalogTuning: ProviderTuning | undefined,
  overrides: ProviderTuningOverrides | undefined,
): ProviderTuning | undefined {
  if (!catalogTuning && !overrides) {
    return undefined;
  }
  const resolved: ProviderTuning = { ...(catalogTuning ?? {}) };
  if (overrides?.temperature !== undefined) {
    resolved.temperature = overrides.temperature;
  }
  if (overrides?.maxTokens !== undefined) {
    resolved.maxTokens = overrides.maxTokens;
  }
  if (overrides?.maxTokensThinking !== undefined) {
    resolved.maxTokensThinking = overrides.maxTokensThinking;
  }
  if (overrides?.extraOptionOverrides && Object.keys(overrides.extraOptionOverrides).length > 0) {
    resolved.extraOptions = {
      ...(catalogTuning?.extraOptions ?? {}),
      ...overrides.extraOptionOverrides,
    };
  }
  return resolved;
}

function tuningOverridesEmpty(overrides: ProviderTuningOverrides): boolean {
  return (
    overrides.temperature === undefined &&
    overrides.maxTokens === undefined &&
    overrides.maxTokensThinking === undefined &&
    Object.keys(overrides.extraOptionOverrides ?? {}).length === 0
  );
}

function defaultModelCapabilities(
  capabilities: Partial<ModelCapabilities> | undefined,
): ModelCapabilities {
  return {
    tools: capabilities?.tools ?? false,
    thinking: capabilities?.thinking ?? false,
    vision: capabilities?.vision ?? false,
    streaming: capabilities?.streaming ?? true,
  };
}

function applyCapabilityOverrides(
  base: ModelCapabilities,
  overrides: ModelCapabilityOverrides,
): ModelCapabilities {
  return {
    tools: overrides.tools ?? base.tools,
    thinking: overrides.thinking ?? base.thinking,
    vision: overrides.vision ?? base.vision,
    streaming: overrides.streaming ?? base.streaming,
  };
}

function parseCatalog(catalogJson: string): AiProviderCatalog {
  const catalog = JSON.parse(catalogJson) as unknown;
  if (!isRecord(catalog) || !isRecord(catalog.providers) || !isRecord(catalog.capabilities)) {
    throw new Error("Invalid AI provider catalog");
  }
  return catalog as unknown as AiProviderCatalog;
}

function assertKnownProvider(catalog: AiProviderCatalog, providerId: string): void {
  if (!(providerId in catalog.providers)) {
    throw new Error(`Unknown provider: ${providerId}`);
  }
}

function getProviderApiKey(secretService: SecretService, providerId: string): string | undefined {
  const secret = secretService.getSecret(`ai_${providerId}`);
  if (secret instanceof Promise) {
    throw new Error(
      "Async secret services are not supported by the synchronous AI provider runtime",
    );
  }
  return secret?.trim() ? secret : undefined;
}

function hasProviderApiKey(secretService: SecretService, providerId: string): boolean {
  return getProviderApiKey(secretService, providerId) !== undefined;
}

function providerBaseUrl(
  providerId: string,
  provider: CatalogProvider,
  userSettings: StoredAiProviderSettings,
): string {
  return (
    userSettings.providers[providerId]?.customUrl ||
    provider.defaultConfig?.url ||
    defaultProviderBaseUrl(providerId)
  );
}

function defaultProviderBaseUrl(providerId: string): string {
  switch (providerId) {
    case "anthropic":
      return "https://api.anthropic.com";
    case "openai":
      return "https://api.openai.com";
    case "groq":
      return "https://api.groq.com/openai";
    case "openrouter":
      return "https://openrouter.ai/api";
    case "google":
      return "https://generativelanguage.googleapis.com";
    case "ollama":
      return "http://localhost:11434";
    default:
      return "https://api.openai.com";
  }
}

function modelListUrl(providerId: string, baseUrl: string, apiKey: string | undefined): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (providerId === "ollama") {
    return `${normalized}/api/tags`;
  }
  if (providerId === "google") {
    const url = new URL(`${normalized}/v1beta/models`);
    if (apiKey) {
      url.searchParams.set("key", apiKey);
    }
    return url.toString();
  }
  return `${normalized}/v1/models`;
}

function modelListRequestInit(providerId: string, apiKey: string | undefined): RequestInit {
  const headers: Record<string, string> = {};
  if (apiKey) {
    if (providerId === "anthropic") {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else if (providerId !== "google") {
      headers.Authorization = `Bearer ${apiKey}`;
    }
  }
  return { headers };
}

function parseModelListResponse(
  providerId: string,
  payload: unknown,
): ListAiModelsResponse["models"] {
  if (!isRecord(payload)) {
    throw new Error("Failed to parse provider response");
  }
  if (providerId === "anthropic") {
    const data = parseArray(payload.data, "Anthropic");
    return data.map((item) => {
      const model = parseRecord(item, "Anthropic model");
      return {
        id: parseStringField(model.id, "Anthropic model id"),
        name: typeof model.display_name === "string" ? model.display_name : undefined,
      };
    });
  }
  if (providerId === "ollama") {
    const models = parseArray(payload.models, "Ollama");
    return models.map((item) => {
      const model = parseRecord(item, "Ollama model");
      const name = parseStringField(model.name, "Ollama model name");
      return { id: name, name };
    });
  }
  if (providerId === "google") {
    const models = parseArray(payload.models, "Google");
    return models
      .map((item) => parseRecord(item, "Google model"))
      .filter((model) => typeof model.name === "string" && model.name.includes("gemini"))
      .map((model) => {
        const rawName = parseStringField(model.name, "Google model name");
        return {
          id: rawName.replace(/^models\//, ""),
          name: typeof model.displayName === "string" ? model.displayName : undefined,
        };
      });
  }
  const data = parseArray(payload.data, "provider");
  return data.map((item) => {
    const model = parseRecord(item, "provider model");
    const id = parseStringField(model.id, "provider model id");
    return { id, name: id };
  });
}

function pushOnce(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Failed to parse ${label} response`);
  }
  return value;
}

function parseRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Failed to parse ${label}`);
  }
  return value;
}

function parseStringField(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`Failed to parse ${label}`);
  }
  return value;
}
