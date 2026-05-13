export interface AddonZipInstallRequest {
  zipData: Uint8Array;
  enableAfterInstall: boolean;
}

export interface AddonZipExtractRequest {
  zipData: Uint8Array;
}

export interface AddonRatingRequest {
  addonId: string;
  rating: number;
  review?: string;
}

export interface AddonStagingInstallRequest {
  addonId: string;
  enableAfterInstall: boolean;
}

export interface AddonService {
  listInstalledAddons(): Promise<unknown[]> | unknown[];
  installAddonZip(request: AddonZipInstallRequest): Promise<unknown> | unknown;
  toggleAddon(addonId: string, enabled: boolean): Promise<void> | void;
  uninstallAddon(addonId: string): Promise<void> | void;
  loadAddonForRuntime(addonId: string): Promise<unknown> | unknown;
  getEnabledAddonsOnStartup(): Promise<unknown[]> | unknown[];
  extractAddonZip(request: AddonZipExtractRequest): Promise<unknown> | unknown;
  fetchStoreListings(): Promise<unknown[]> | unknown[];
  submitRating(request: AddonRatingRequest): Promise<unknown> | unknown;
  checkAddonUpdate(addonId: string): Promise<unknown> | unknown;
  checkAllAddonUpdates(): Promise<unknown[]> | unknown[];
  updateAddonFromStore(addonId: string): Promise<unknown> | unknown;
  downloadAddonToStaging(addonId: string): Promise<unknown> | unknown;
  installAddonFromStaging(request: AddonStagingInstallRequest): Promise<unknown> | unknown;
  clearAddonStaging(addonId?: string): Promise<void> | void;
}
