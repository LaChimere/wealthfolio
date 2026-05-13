export interface Asset extends Record<string, unknown> {
  id: string;
}

export interface NewAsset extends Record<string, unknown> {
  kind: string;
  quoteMode: string;
  quoteCcy: string;
}

export interface UpdateAssetProfile extends Record<string, unknown> {
  name?: string;
  displayCode?: string;
  notes: string;
  kind?: string;
  quoteMode?: string;
  quoteCcy?: string;
  instrumentType?: string;
  instrumentSymbol?: string;
  instrumentExchangeMic?: string;
  providerConfig?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface AssetService {
  listAssets(): Promise<Asset[]> | Asset[];
  getAssetProfile(assetId: string): Promise<Asset> | Asset;
  createAsset(asset: NewAsset): Promise<Asset> | Asset;
  updateAssetProfile(assetId: string, profile: UpdateAssetProfile): Promise<Asset> | Asset;
  updateQuoteMode(assetId: string, quoteMode: string): Promise<Asset> | Asset;
  deleteAsset(assetId: string): Promise<void> | void;
}
