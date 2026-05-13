export interface AiProvidersResponse {
  providers: unknown[];
  capabilities: Record<string, unknown>;
  defaultProvider?: string | null;
}

export interface AiProviderSettingsUpdate extends Record<string, unknown> {
  providerId: string;
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

export interface AiProviderService {
  getAiProviders(): Promise<AiProvidersResponse> | AiProvidersResponse;
  updateProviderSettings(request: AiProviderSettingsUpdate): Promise<void> | void;
  setDefaultProvider(request: SetDefaultAiProviderRequest): Promise<void> | void;
  listModels(providerId: string): Promise<ListAiModelsResponse> | ListAiModelsResponse;
}
