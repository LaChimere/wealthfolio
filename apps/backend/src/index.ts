export {
  loadBackendConfigFromEnv,
  parseListenAddress,
  type BackendRuntimeConfig,
  type CorsConfig,
  type ListenAddress,
} from "./config";
export {
  createBackendRequestHandler,
  runWithRequestTimeout,
  type BackendRequestHandlerOptions,
} from "./http";
export { startBackendServer, type BackendServerHandle } from "./server";
export {
  createEventBus,
  createEventStream,
  formatSseEvent,
  type BackendEvent,
  type BackendEventBus,
} from "./events";
export { sidecarTokenAuthorized } from "./sidecar-auth";
export {
  createSqliteBackedBackendServices,
  resolveBackendAppDataDir,
  resolveBackendMigrationsDir,
  type SqliteBackedBackendServices,
  type SqliteBackedBackendServicesOptions,
} from "./runtime";
export {
  ACCOUNTS_CHANGED_EVENT,
  TRACKING_MODE_CHANGED_EVENT,
  createAccountRepository,
  createAccountService,
  parseTrackingMode,
  type Account,
  type AccountListFilters,
  type AccountRepository,
  type AccountService,
  type AccountServiceOptions,
  type AccountUpdate,
  type AccountUpdateResult,
  type NewAccount,
  type TrackingMode,
} from "./domains/accounts";
export {
  ACTIVITY_IMPORT_CONTEXT_KIND,
  type ActivityParseCsvRequest,
  type ActivitySearchRequest,
  type ActivityService,
} from "./domains/activities";
export {
  AI_CHAT_ERROR_STATUS_BY_CODE,
  type AiChatListThreadsRequest,
  type AiChatService,
  type AiChatServiceErrorShape,
  type AiChatUpdateThreadRequest,
  type AiChatUpdateToolResultRequest,
} from "./domains/ai-chat";
export type {
  AddonRatingRequest,
  AddonService,
  AddonStagingInstallRequest,
  AddonZipExtractRequest,
  AddonZipInstallRequest,
} from "./domains/addons";
export type {
  AiProviderService,
  AiProviderSettingsUpdate,
  AiProvidersResponse,
  ListAiModelsResponse,
  SetDefaultAiProviderRequest,
} from "./domains/ai-providers";
export type {
  AlternativeAssetHolding,
  AlternativeAssetKindApi,
  AlternativeAssetService,
  CreateAlternativeAssetRequest,
  CreateAlternativeAssetResponse,
  LinkLiabilityRequest,
  UpdateAlternativeAssetDetailsRequest,
  UpdateAlternativeAssetValuationRequest,
  UpdateAlternativeAssetValuationResponse,
} from "./domains/alternative-assets";
export type {
  AppInfoResponse,
  AppUtilityService,
  BackupDatabaseResponse,
  BackupToPathResponse,
  UpdateCheckResponse,
} from "./domains/app-utilities";
export type { Asset, AssetService, NewAsset, UpdateAssetProfile } from "./domains/assets";
export type {
  ConnectDeviceSyncReconcileReadyRequest,
  ConnectDeviceSyncService,
  ConnectImportRunsRequest,
  ConnectService,
  ConnectSyncBrokerDataResult,
  ConnectSyncBrokerDataStatus,
} from "./domains/connect";
export {
  createContributionLimitRepository,
  createContributionLimitService,
  parseContributionLimitAccountIds,
  type AccountDeposit,
  type ContributionLimit,
  type ContributionLimitRepository,
  type ContributionLimitService,
  type ContributionLimitServiceOptions,
  type DepositsCalculation,
  type NewContributionLimit,
} from "./domains/contribution-limits";
export {
  createCustomProviderRepository,
  createCustomProviderService,
  type CustomProviderRepository,
  type CustomProviderRepositoryOptions,
  type CustomProviderService,
  type CustomProviderSource,
  type CustomProviderSourceFormat,
  type CustomProviderSourceKind,
  type CustomProviderSyncEvent,
  type CustomProviderSyncOperation,
  type CustomProviderWithSources,
  type NewCustomProvider,
  type NewCustomProviderSource,
  type UpdateCustomProvider,
} from "./domains/custom-providers";
export type {
  BeginPairingConfirmRequest,
  ClaimPairingRequest,
  CommitInitializeTeamKeysRequest,
  CommitRotateTeamKeysEnvelope,
  CommitRotateTeamKeysRequest,
  CompletePairingRequest,
  CompletePairingWithTransferRequest,
  ConfirmPairingRequest,
  ConfirmPairingWithBootstrapRequest,
  CreatePairingRequest,
  DeviceSyncService,
  PairingFlowIdRequest,
  RegisterDeviceRequest,
  ResetTeamSyncRequest,
  UpdateDeviceRequest,
} from "./domains/device-sync";
export {
  createExchangeRateRepository,
  createExchangeRateService,
  type ExchangeRate,
  type ExchangeRateAssetSyncEvent,
  type ExchangeRateAssetSyncOperation,
  type ExchangeRateRepository,
  type ExchangeRateRepositoryOptions,
  type ExchangeRateService,
  type FxAssetPayload,
  type NewExchangeRate,
} from "./domains/exchange-rates";
export {
  createGoalRepository,
  createGoalService,
  type Goal,
  type GoalAccount,
  type GoalAccountProvider,
  type GoalFundingRule,
  type GoalFundingRuleInput,
  type GoalPlan,
  type GoalRepository,
  type GoalRepositoryOptions,
  type GoalService,
  type GoalServiceOptions,
  type GoalSyncEntity,
  type GoalSyncEvent,
  type GoalSyncOperation,
  type NewGoal,
} from "./domains/goals";
export {
  DEFAULT_HEALTH_CONFIG,
  createHealthRepository,
  createHealthService,
  type HealthConfig,
  type HealthRepository,
  type HealthService,
  type IssueDismissal,
} from "./domains/health";
export type {
  HoldingInput,
  HoldingsImportRequest,
  HoldingsPositionInput,
  HoldingsService,
  HoldingsSnapshotInput,
  SaveManualHoldingsRequest,
} from "./domains/holdings";
export type { MarketDataService, ResolveSymbolQuoteRequest } from "./domains/market-data";
export {
  createMarketDataProviderRepository,
  createMarketDataProviderService,
  type MarketDataProviderRepository,
  type MarketDataProviderService,
  type MarketDataProviderServiceOptions,
  type MarketDataProviderSetting,
  type ProviderCapabilities,
  type ProviderInfo,
  type ProviderSyncError,
  type ProviderSyncStats,
  type ProviderUpdate,
} from "./domains/market-data-providers";
export {
  DEFAULT_HISTORY_DAYS,
  buildPortfolioRecalculateConfig,
  buildPortfolioUpdateConfig,
  type MarketSyncMode,
  type PortfolioJobConfig,
  type PortfolioJobService,
  type PortfolioRequestBody,
  type SnapshotRecalcMode,
  type ValuationRecalcMode,
} from "./domains/portfolio-jobs";
export type { PerformanceRequest, PortfolioMetricsService } from "./domains/portfolio-metrics";
export {
  DEFAULT_SETTINGS,
  canonicalizeTimezone,
  createSettingsService,
  getSetting,
  readSettings,
  writeSettingsUpdate,
  type Settings,
  type SettingsService,
  type SettingsUpdate,
} from "./domains/settings";
export type { SecretService } from "./domains/secrets";
export type {
  SyncCryptoEphemeralKeyPair,
  SyncCryptoService,
  SyncCryptoStringResponse,
} from "./domains/sync-crypto";
export {
  createTaxonomyRepository,
  createTaxonomyReadRepository,
  createTaxonomyReadService,
  createTaxonomyService,
  type AssetTaxonomyAssignment,
  type NewAssetTaxonomyAssignment,
  type NewTaxonomy,
  type NewTaxonomyCategory,
  type Taxonomy,
  type TaxonomyAssignmentSyncEvent,
  type TaxonomyCategory,
  type TaxonomyCategoryJson,
  type TaxonomyJson,
  type InstrumentMappingJson,
  type TaxonomyRepository,
  type TaxonomyRepositoryOptions,
  type TaxonomyReadRepository,
  type TaxonomyReadService,
  type TaxonomyService,
  type TaxonomySyncEvent,
  type TaxonomySyncOperation,
  type TaxonomySyncPayload,
  type TaxonomyWithCategories,
} from "./domains/taxonomies";
export {
  DEFAULT_MIGRATIONS_RELATIVE_PATH,
  DIESEL_SCHEMA_MIGRATIONS_TABLE,
  applyConnectionPragmas,
  backupDatabaseToFile,
  getAppliedMigrationVersions,
  getSqliteDbPath,
  initializeSqliteDatabase,
  loadSqlMigrations,
  openSqliteDatabase,
  resolveMigrationsDir,
  restoreDatabase,
  runPendingMigrations,
  type InitializedSqliteDatabase,
  type SqlMigration,
} from "./storage/sqlite";
