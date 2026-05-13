import type { RunEnv } from "../types";
import { RunEnvs } from "../types";

export { getRuntimeInfo, isDesktop, isWeb, logger } from "./core";

export const RUN_ENV: RunEnv = RunEnvs.ELECTRON;

export type { EventCallback, Logger, RunEnv, UnlistenFn } from "../types";
export { RunEnvs } from "../types";
export type {
  AddonFile,
  AddonInstallResult,
  AddonManifest,
  AddonUpdateCheckResult,
  AddonUpdateInfo,
  AddonValidationResult,
  AppInfo,
  BackendEnableSyncResult,
  BackendSyncBackgroundEngineResult,
  BackendSyncBootstrapOverwriteCheckResult,
  BackendSyncBootstrapResult,
  BackendSyncCycleResult,
  BackendSyncEngineStatusResult,
  BackendSyncReconcileReadyResult,
  BackendSyncSnapshotUploadResult,
  BackendSyncStateResult,
  EphemeralKeyPair,
  ExtractedAddon,
  FunctionPermission,
  ImportRunsRequest,
  InstalledAddon,
  MarketDataProviderSetting,
  Permission,
  PlatformCapabilities,
  PlatformInfo,
  ProviderCapabilities,
  UpdateCheckPayload,
  UpdateCheckResult,
  UpdateThreadRequest,
  UpdateToolResultRequest,
} from "../types";

export type {
  AiChatMessage,
  AiChatModelConfig,
  AiSendMessageRequest,
  AiStreamEvent,
  AiThread,
  AiToolCall,
  AiToolResult,
  AiUsageStats,
  ListThreadsRequest,
  ThreadPage,
} from "@/features/ai-assistant/types";

export * from "../shared/accounts";
export * from "../shared/activities";
export { parseCsv } from "./activities";
export * from "../shared/portfolio";
export * from "../shared/market-data";
export * from "../shared/custom-provider";
export * from "../shared/goals";
export * from "../shared/taxonomies";
export * from "../shared/alternative-assets";
export * from "../shared/contribution-limits";
export * from "../shared/exchange-rates";
export * from "../shared/secrets";
export * from "../shared/connect";
export * from "../shared/ai-providers";
export * from "../shared/ai-threads";
export * from "../shared/health";

export {
  backupDatabase,
  backupDatabaseToPath,
  checkForUpdates,
  getAppInfo,
  getPlatform,
  getSettings,
  installUpdate,
  isAutoUpdateCheckEnabled,
  restoreDatabase,
  updateSettings,
} from "./settings";

export {
  checkAddonUpdate,
  checkAllAddonUpdates,
  clearAddonStaging,
  downloadAddonForReview,
  extractAddon,
  extractAddonZip,
  fetchAddonStoreListings,
  getAddonRatings,
  getEnabledAddons,
  getEnabledAddonsOnStartup,
  getInstalledAddons,
  installAddon,
  installAddonFile,
  installAddonZip,
  installFromStaging,
  listInstalledAddons,
  loadAddon,
  loadAddonForRuntime,
  submitAddonRating,
  toggleAddon,
  uninstallAddon,
  updateAddon,
} from "./addons";

export { streamAiChat } from "./ai-streaming";

export {
  listenBrokerSyncComplete,
  listenBrokerSyncError,
  listenBrokerSyncStart,
  listenDatabaseRestored,
  listenDeepLink,
  listenFileDrop,
  listenFileDropCancelled,
  listenFileDropHover,
  listenMarketSyncComplete,
  listenMarketSyncError,
  listenMarketSyncStart,
  listenNavigateToRoute,
  listenPortfolioUpdateComplete,
  listenPortfolioUpdateError,
  listenPortfolioUpdateStart,
} from "./events";

export {
  openAddonPackageDialog,
  openCsvFileDialog,
  openDatabaseFileDialog,
  openFileSaveDialog,
  openFolderDialog,
  openUrlInBrowser,
} from "./files";

export {
  syncComputeSas,
  syncComputeSharedSecret,
  syncDecrypt,
  syncDeriveDek,
  syncDeriveSessionKey,
  syncEncrypt,
  syncGenerateDeviceId,
  syncGenerateKeypair,
  syncGeneratePairingCode,
  syncGenerateRootKey,
  syncHashPairingCode,
  syncHmacSha256,
} from "./crypto";

export {
  calculateRetirementProjection,
  runRetirementDecisionSensitivityMap,
  runRetirementMonteCarlo,
  runRetirementScenarioAnalysis,
  runRetirementSorr,
  runRetirementStressTests,
} from "./fire-planner";
