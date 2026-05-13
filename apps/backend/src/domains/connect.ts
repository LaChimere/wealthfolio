export interface ConnectImportRunsRequest {
  runType?: string;
  limit: number;
  offset: number;
}

export interface ConnectDeviceSyncReconcileReadyRequest {
  allowOverwrite: boolean;
}

export type ConnectSyncBrokerDataStatus = "accepted" | "forbidden" | "not_implemented";

export interface ConnectSyncBrokerDataResult {
  status: ConnectSyncBrokerDataStatus;
}

export interface ConnectService {
  storeSyncSession(refreshToken: string): Promise<void> | void;
  clearSyncSession(): Promise<void> | void;
  getSyncSessionStatus(): Promise<unknown> | unknown;
  restoreSyncSession(): Promise<unknown> | unknown;
  listBrokerConnections(): Promise<unknown[]> | unknown[];
  listBrokerAccounts(): Promise<unknown[]> | unknown[];
  syncBrokerData(): Promise<ConnectSyncBrokerDataResult> | ConnectSyncBrokerDataResult;
  syncBrokerConnections(): Promise<unknown> | unknown;
  syncBrokerAccounts(): Promise<unknown> | unknown;
  syncBrokerActivities(): Promise<unknown> | unknown;
  /**
   * Runtime implementations should preserve Rust feature-flag behavior by
   * returning an empty array when Connect sync is disabled.
   */
  getSyncedAccounts(): Promise<unknown[]> | unknown[];
  /**
   * Runtime implementations should preserve Rust feature-flag behavior by
   * returning an empty array when Connect sync is disabled.
   */
  getPlatforms(): Promise<unknown[]> | unknown[];
  /**
   * Runtime implementations should preserve Rust feature-flag behavior by
   * returning an empty array when Connect sync is disabled.
   */
  getBrokerSyncStates(): Promise<unknown[]> | unknown[];
  /**
   * Runtime implementations should preserve Rust feature-flag behavior by
   * returning an empty array when Connect sync is disabled.
   */
  getImportRuns(request: ConnectImportRunsRequest): Promise<unknown[]> | unknown[];
  getBrokerSyncProfile(accountId: string, sourceSystem: string): Promise<unknown> | unknown;
  saveBrokerSyncProfileRules(request: Record<string, unknown>): Promise<unknown> | unknown;
  getSubscriptionPlans(): Promise<unknown> | unknown;
  getSubscriptionPlansPublic(): Promise<unknown> | unknown;
  getUserInfo(): Promise<unknown> | unknown;
}

export interface ConnectDeviceSyncService {
  getDeviceSyncState(): Promise<unknown> | unknown;
  /**
   * Runtime implementations own all Rust-equivalent side effects, including
   * device-id secrets, snapshot cursors, repository resets, and engine startup.
   */
  enableDeviceSync(): Promise<unknown> | unknown;
  /**
   * Runtime implementations own all Rust-equivalent side effects, including
   * device-id secret cleanup, snapshot cursor cleanup, repository reset, and
   * engine shutdown.
   */
  clearDeviceSyncData(): Promise<void> | void;
  /**
   * Runtime implementations own all Rust-equivalent side effects, including
   * device-id secrets, snapshot cursors, repository resets, and engine startup.
   */
  reinitializeDeviceSync(): Promise<unknown> | unknown;
  getDeviceSyncEngineStatus(): Promise<unknown> | unknown;
  getDeviceSyncPairingSourceStatus(): Promise<unknown> | unknown;
  getDeviceSyncBootstrapOverwriteCheck(): Promise<unknown> | unknown;
  reconcileDeviceSyncReadyState(
    request: ConnectDeviceSyncReconcileReadyRequest,
  ): Promise<unknown> | unknown;
  bootstrapDeviceSnapshot(): Promise<unknown> | unknown;
  triggerDeviceSyncCycle(): Promise<unknown> | unknown;
  startDeviceSyncBackgroundEngine(): Promise<unknown> | unknown;
  stopDeviceSyncBackgroundEngine(): Promise<unknown> | unknown;
  generateDeviceSnapshotNow(): Promise<unknown> | unknown;
  cancelDeviceSnapshotUpload(): Promise<unknown> | unknown;
}
