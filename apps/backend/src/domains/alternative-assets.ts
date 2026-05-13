export type AlternativeAssetKindApi =
  | "property"
  | "vehicle"
  | "collectible"
  | "precious"
  | "liability"
  | "other";

export interface CreateAlternativeAssetRequest {
  kind: AlternativeAssetKindApi;
  name: string;
  currency: string;
  currentValue: string;
  valueDate: string;
  purchasePrice?: string;
  purchaseDate?: string;
  metadata?: Record<string, unknown>;
  linkedAssetId?: string;
}

export interface CreateAlternativeAssetResponse {
  assetId: string;
  quoteId: string;
}

export interface UpdateAlternativeAssetValuationRequest {
  value: string;
  date: string;
  notes?: string;
}

export interface UpdateAlternativeAssetValuationResponse {
  quoteId: string;
  valuationDate: string;
  value: string;
}

export interface LinkLiabilityRequest {
  targetAssetId: string;
}

export interface UpdateAlternativeAssetDetailsRequest {
  assetId: string;
  name?: string;
  metadata: Record<string, string | null>;
  notes?: string;
}

export interface AlternativeAssetHolding {
  id: string;
  kind: string;
  name: string;
  symbol: string;
  currency: string;
  marketValue: string;
  purchasePrice?: string;
  purchaseDate?: string;
  unrealizedGain?: string;
  unrealizedGainPct?: string;
  valuationDate: string;
  metadata?: Record<string, unknown>;
  linkedAssetId?: string;
  notes?: string | null;
}

export interface AlternativeAssetService {
  createAlternativeAsset(
    request: CreateAlternativeAssetRequest,
  ): Promise<CreateAlternativeAssetResponse> | CreateAlternativeAssetResponse;
  updateValuation(
    assetId: string,
    request: UpdateAlternativeAssetValuationRequest,
  ): Promise<UpdateAlternativeAssetValuationResponse> | UpdateAlternativeAssetValuationResponse;
  deleteAlternativeAsset(assetId: string): Promise<void> | void;
  linkLiability(liabilityId: string, request: LinkLiabilityRequest): Promise<void> | void;
  unlinkLiability(liabilityId: string): Promise<void> | void;
  updateAssetDetails(request: UpdateAlternativeAssetDetailsRequest): Promise<void> | void;
  getAlternativeHoldings(): Promise<AlternativeAssetHolding[]> | AlternativeAssetHolding[];
}
