/**
 * Type utilities for bridging between main app and addon SDK types
 * These utilities help convert between the main app's internal types and the SDK's public types
 */

import type { EventCallback, UnlistenFn } from "@/adapters";
import type {
  Account,
  AccountValuation,
  Activity,
  ActivityBulkMutationRequest,
  ActivityBulkMutationResult,
  ActivityCreate,
  ActivityDetails,
  ActivityImport,
  ActivitySearchResponse,
  ActivityUpdate,
  Asset,
  CheckHoldingsImportResult,
  ContributionLimit,
  DepositsCalculation,
  ExchangeRate,
  Goal,
  GoalFundingRule,
  GoalFundingRuleInput,
  Holding,
  HoldingsSnapshotInput,
  ImportActivitiesResult,
  ImportHoldingsCsvResult,
  ImportMappingData,
  IncomeSummary,
  MarketDataProviderInfo,
  NewContributionLimit,
  PerformanceMetrics,
  Quote,
  SnapshotInfo,
  SymbolSearchResult,
  Settings,
  SimplePerformanceMetrics,
  UpdateAssetProfile,
} from "@/lib/types";
import type { HoldingInput } from "@/adapters";
import type {
  FunctionPermission,
  Goal as SDKGoal,
  GoalAllocation as SDKGoalAllocation,
  HostAPI as SDKHostAPI,
  Permission,
  QueryCacheFacade,
} from "@wealthfolio/addon-sdk";

/**
 * Internal HostAPI interface that matches the actual command function signatures
 * This allows us to maintain type safety internally while providing a clean SDK interface
 */
export interface InternalHostAPI {
  // Core data access
  getHoldings(accountId: string): Promise<Holding[]>;
  getActivities(accountId?: string): Promise<ActivityDetails[]>;
  getAccounts(): Promise<Account[]>;

  // Exchange rates
  getExchangeRates(): Promise<ExchangeRate[]>;
  updateExchangeRate(updatedRate: ExchangeRate): Promise<ExchangeRate>;
  addExchangeRate(newRate: Omit<ExchangeRate, "id">): Promise<ExchangeRate>;

  // Contribution limits
  getContributionLimit(): Promise<ContributionLimit[]>;
  createContributionLimit(newLimit: NewContributionLimit): Promise<ContributionLimit>;
  updateContributionLimit(
    id: string,
    updatedLimit: NewContributionLimit,
  ): Promise<ContributionLimit>;
  calculateDepositsForLimit(limitId: string): Promise<DepositsCalculation>;

  // Goals
  getGoals(): Promise<Goal[]>;
  createGoal(goal: unknown): Promise<Goal>;
  updateGoal(goal: unknown): Promise<Goal>;
  getGoalFunding(goalId: string): Promise<GoalFundingRule[]>;
  saveGoalFunding(goalId: string, rules: GoalFundingRuleInput[]): Promise<GoalFundingRule[]>;

  // Market data
  searchTicker(query: string): Promise<SymbolSearchResult[]>;
  fetchYahooDividends(symbol: string): Promise<{ amount: number; date: number }[]>;
  syncHistoryQuotes(): Promise<void>;
  getAssetProfile(assetId: string): Promise<Asset>;
  updateAssetProfile(payload: UpdateAssetProfile): Promise<Asset>;
  updateQuoteMode(assetId: string, quoteMode: string): Promise<Asset>;
  updateQuote(symbol: string, quote: Quote): Promise<void>;
  syncMarketData(
    assetIds: string[],
    refetchAll: boolean,
    refetchRecentDays?: number,
  ): Promise<void>;
  getQuoteHistory(symbol: string): Promise<Quote[]>;
  getMarketDataProviders(): Promise<MarketDataProviderInfo[]>;

  // Portfolio
  updatePortfolio(): Promise<void>;
  recalculatePortfolio(): Promise<void>;
  getIncomeSummary(accountId?: string): Promise<IncomeSummary[]>;
  getHistoricalValuations(
    accountId?: string,
    startDate?: string,
    endDate?: string,
  ): Promise<AccountValuation[]>;
  getLatestValuations(accountIds: string[]): Promise<AccountValuation[]>;
  calculatePerformanceHistory(
    itemType: "account" | "symbol",
    itemId: string,
    startDate: string,
    endDate: string,
  ): Promise<PerformanceMetrics>;
  calculatePerformanceSummary(args: {
    itemType: "account" | "symbol";
    itemId: string;
    startDate?: string | null;
    endDate?: string | null;
  }): Promise<PerformanceMetrics>;
  calculateAccountsSimplePerformance(accountIds: string[]): Promise<SimplePerformanceMetrics[]>;
  getHolding(accountId: string, assetId: string): Promise<Holding | null>;

  // Settings
  getSettings(): Promise<Settings>;
  updateSettings(settingsUpdate: Partial<Settings>): Promise<Settings>;
  backupDatabase(): Promise<{ filename: string }>;

  // Account management
  createAccount(account: unknown): Promise<Account>;
  updateAccount(account: unknown): Promise<Account>;

  // Activity management
  searchActivities(
    page: number,
    pageSize: number,
    filters: { accountIds?: string | string[]; activityTypes?: string | string[]; symbol?: string },
    searchKeyword: string,
    sort?: { id: string; desc?: boolean },
  ): Promise<ActivitySearchResponse>;
  createActivity(activity: ActivityCreate): Promise<Activity>;
  updateActivity(activity: ActivityUpdate): Promise<Activity>;
  saveActivities(request: ActivityBulkMutationRequest): Promise<ActivityBulkMutationResult>;

  // File operations
  openCsvFileDialog(): Promise<null | string | string[]>;
  openFileSaveDialog(fileContent: Uint8Array | Blob | string, fileName: string): Promise<unknown>;

  // Event listeners - Import
  listenImportFileDropHover<T>(handler: EventCallback<T>): Promise<UnlistenFn>;
  listenImportFileDrop<T>(handler: EventCallback<T>): Promise<UnlistenFn>;
  listenImportFileDropCancelled<T>(handler: EventCallback<T>): Promise<UnlistenFn>;

  // Event listeners - Portfolio
  listenPortfolioUpdateStart<T>(handler: EventCallback<T>): Promise<UnlistenFn>;
  listenPortfolioUpdateComplete<T>(handler: EventCallback<T>): Promise<UnlistenFn>;
  listenPortfolioUpdateError<T>(handler: EventCallback<T>): Promise<UnlistenFn>;
  listenMarketSyncStart<T>(handler: EventCallback<T>): Promise<UnlistenFn>;
  listenMarketSyncComplete<T>(handler: EventCallback<T>): Promise<UnlistenFn>;
  listenMarketSyncError<T>(handler: EventCallback<T>): Promise<UnlistenFn>;

  // Activity import
  importActivities(params: { activities: ActivityImport[] }): Promise<ImportActivitiesResult>;
  checkActivitiesImport(params: { activities: ActivityImport[] }): Promise<ActivityImport[]>;
  getAccountImportMapping(accountId: string, contextKind?: string): Promise<ImportMappingData>;
  saveAccountImportMapping(mapping: ImportMappingData): Promise<ImportMappingData>;

  // Snapshots
  getSnapshots(accountId: string, dateFrom?: string, dateTo?: string): Promise<SnapshotInfo[]>;
  getSnapshotByDate(accountId: string, date: string): Promise<Holding[]>;
  saveManualHoldings(
    accountId: string,
    holdings: HoldingInput[],
    cashBalances: Record<string, string>,
    snapshotDate?: string,
  ): Promise<void>;
  checkHoldingsImport(
    accountId: string,
    snapshots: HoldingsSnapshotInput[],
  ): Promise<CheckHoldingsImportResult>;
  importHoldingsCsv(
    accountId: string,
    snapshots: HoldingsSnapshotInput[],
  ): Promise<ImportHoldingsCsvResult>;
  deleteSnapshot(accountId: string, date: string): Promise<void>;

  // Logger functions (internal - these are the raw logger functions)
  logError(message: string): void;
  logInfo(message: string): void;
  logWarn(message: string): void;
  logTrace(message: string): void;
  logDebug(message: string): void;

  // Navigation functions
  navigateToRoute(route: string): Promise<void>;

  // Query functions
  getQueryClient(): QueryCacheFacade | undefined;
  invalidateQueries(queryKey: string | string[]): void;
  refetchQueries(queryKey: string | string[]): void;

  // Toast functions
  toastSuccess(message: string): void;
  toastError(message: string): void;
  toastWarning(message: string): void;
  toastInfo(message: string): void;
}

type RuntimeFunctionPermission = FunctionPermission | string;

export type RuntimeAddonPermission = Omit<Permission, "functions"> & {
  readonly functions: readonly RuntimeFunctionPermission[];
};

export interface AddonPermissionGuard {
  readonly isRestricted: boolean;
  assertAllowed(permissionPath: string): void;
}

interface CreateAddonPermissionGuardOptions {
  addonId?: string;
  permissions?: readonly RuntimeAddonPermission[] | null;
  onDenied?: (message: string) => void;
}

const MARKET_PERMISSION_PATHS = {
  searchTicker: ["api.market.searchTicker"],
  syncHistory: ["api.market.syncHistory"],
  sync: ["api.market.sync"],
  getProviders: ["api.market.getProviders"],
  fetchDividends: ["api.market.fetchDividends"],
  getProfile: ["api.assets.getProfile"],
  updateProfile: ["api.assets.updateProfile"],
  updateDataSource: ["api.assets.updateQuoteMode"],
} as const;

const EXCHANGE_RATE_PERMISSION_PATHS = {
  getAll: ["api.exchangeRates.getAll"],
  update: ["api.exchangeRates.update"],
  add: ["api.exchangeRates.add"],
} as const;

const GOAL_PERMISSION_PATHS = {
  getAll: ["api.goals.getAll"],
  create: ["api.goals.create"],
  update: ["api.goals.update"],
  getFunding: ["api.goals.getFunding"],
  saveFunding: ["api.goals.saveFunding"],
  getAllocations: ["api.goals.getAllocations"],
  updateAllocations: ["api.goals.updateAllocations"],
  calculateDeposits: ["api.contributionLimits.calculateDeposits"],
} as const;

const CONTRIBUTION_LIMIT_PERMISSION_PATHS = {
  getAll: ["api.contributionLimits.getAll"],
  create: ["api.contributionLimits.create"],
  update: ["api.contributionLimits.update"],
  calculateDeposits: ["api.contributionLimits.calculateDeposits"],
} as const;

const PERMISSION_PATHS_BY_CATEGORY: Record<string, Record<string, readonly string[]>> = {
  accounts: {
    getAll: ["api.accounts.getAll"],
    create: ["api.accounts.create"],
  },
  portfolio: {
    getHoldings: ["api.portfolio.getHoldings"],
    getHolding: ["api.portfolio.getHolding"],
    update: ["api.portfolio.update"],
    recalculate: ["api.portfolio.recalculate"],
    getIncomeSummary: ["api.portfolio.getIncomeSummary"],
    getHistoricalValuations: ["api.portfolio.getHistoricalValuations"],
    getLatestValuations: ["api.portfolio.getLatestValuations"],
  },
  activities: {
    getAll: ["api.activities.getAll"],
    search: ["api.activities.search"],
    create: ["api.activities.create"],
    update: ["api.activities.update"],
    saveMany: ["api.activities.saveMany"],
    import: ["api.activities.import"],
    checkImport: ["api.activities.checkImport"],
    getImportMapping: ["api.activities.getImportMapping"],
    saveImportMapping: ["api.activities.saveImportMapping"],
  },
  "market-data": MARKET_PERMISSION_PATHS,
  market: MARKET_PERMISSION_PATHS,
  assets: {
    getProfile: ["api.assets.getProfile"],
    updateProfile: ["api.assets.updateProfile"],
    updateQuoteMode: ["api.assets.updateQuoteMode"],
    updateDataSource: ["api.assets.updateQuoteMode"],
  },
  quotes: {
    update: ["api.quotes.update"],
    getHistory: ["api.quotes.getHistory"],
  },
  performance: {
    calculateHistory: ["api.performance.calculateHistory"],
    calculateSummary: ["api.performance.calculateSummary"],
    calculateAccountsSimple: ["api.performance.calculateAccountsSimple"],
  },
  currency: EXCHANGE_RATE_PERMISSION_PATHS,
  exchangeRates: EXCHANGE_RATE_PERMISSION_PATHS,
  "financial-planning": GOAL_PERMISSION_PATHS,
  goals: GOAL_PERMISSION_PATHS,
  "contribution-limits": CONTRIBUTION_LIMIT_PERMISSION_PATHS,
  contributionLimits: CONTRIBUTION_LIMIT_PERMISSION_PATHS,
  settings: {
    get: ["api.settings.get"],
    update: ["api.settings.update"],
    backupDatabase: ["api.settings.backupDatabase"],
  },
  files: {
    openCsvDialog: ["api.files.openCsvDialog"],
    openSaveDialog: ["api.files.openSaveDialog"],
  },
  query: {
    getClient: ["api.query.getClient"],
    invalidateQueries: ["api.query.invalidateQueries"],
    refetchQueries: ["api.query.refetchQueries"],
  },
  snapshots: {
    getAll: ["api.snapshots.getAll"],
    getByDate: ["api.snapshots.getByDate"],
    save: ["api.snapshots.save"],
    checkImport: ["api.snapshots.checkImport"],
    importSnapshots: ["api.snapshots.importSnapshots"],
    delete: ["api.snapshots.delete"],
  },
  events: {
    onDropHover: ["api.events.import.onDropHover"],
    onDrop: ["api.events.import.onDrop"],
    onDropCancelled: ["api.events.import.onDropCancelled"],
    onUpdateStart: ["api.events.portfolio.onUpdateStart"],
    onUpdateComplete: ["api.events.portfolio.onUpdateComplete"],
    onUpdateError: ["api.events.portfolio.onUpdateError"],
    onSyncStart: ["api.events.market.onSyncStart"],
    onSyncComplete: ["api.events.market.onSyncComplete"],
    onSyncError: ["api.events.market.onSyncError"],
  },
  "events.import": {
    onDropHover: ["api.events.import.onDropHover"],
    onDrop: ["api.events.import.onDrop"],
    onDropCancelled: ["api.events.import.onDropCancelled"],
  },
  "events.portfolio": {
    onUpdateStart: ["api.events.portfolio.onUpdateStart"],
    onUpdateComplete: ["api.events.portfolio.onUpdateComplete"],
    onUpdateError: ["api.events.portfolio.onUpdateError"],
  },
  "events.market": {
    onSyncStart: ["api.events.market.onSyncStart"],
    onSyncComplete: ["api.events.market.onSyncComplete"],
    onSyncError: ["api.events.market.onSyncError"],
  },
  secrets: {
    set: ["api.secrets.set"],
    get: ["api.secrets.get"],
    delete: ["api.secrets.delete"],
  },
  ui: {
    "sidebar.addItem": ["context.sidebar.addItem"],
    "router.add": ["context.router.add"],
    onDisable: ["context.onDisable"],
  },
};

const UNRESTRICTED_PERMISSION_GUARD: AddonPermissionGuard = {
  isRestricted: false,
  assertAllowed: () => undefined,
};

function permissionFunctionName(permission: RuntimeFunctionPermission): string {
  return typeof permission === "string" ? permission : permission.name;
}

function permissionFunctionIsGranted(permission: RuntimeFunctionPermission): boolean {
  return typeof permission === "string" || permission.isDeclared || permission.isDetected;
}

export function buildAllowedAddonPermissionPaths(
  permissions: readonly RuntimeAddonPermission[],
): Set<string> {
  const allowedPaths = new Set<string>();

  for (const permission of permissions) {
    const pathsByFunction = PERMISSION_PATHS_BY_CATEGORY[permission.category];
    if (!pathsByFunction) {
      continue;
    }

    for (const functionPermission of permission.functions) {
      if (!permissionFunctionIsGranted(functionPermission)) {
        continue;
      }

      const functionName = permissionFunctionName(functionPermission);
      const paths = pathsByFunction[functionName];
      if (!paths) {
        continue;
      }

      for (const path of paths) {
        allowedPaths.add(path);
      }
    }
  }

  return allowedPaths;
}

export function createAddonPermissionGuard({
  addonId,
  permissions,
  onDenied,
}: CreateAddonPermissionGuardOptions): AddonPermissionGuard {
  if (permissions == null) {
    return UNRESTRICTED_PERMISSION_GUARD;
  }

  const allowedPaths = buildAllowedAddonPermissionPaths(permissions);
  const normalizedAddonId = addonId?.trim() || "unknown-addon";

  return {
    isRestricted: true,
    assertAllowed: (permissionPath: string) => {
      if (allowedPaths.has(permissionPath)) {
        return;
      }

      const message = `Addon ${normalizedAddonId} is not permitted to call ${permissionPath}`;
      onDenied?.(message);
      throw new Error(message);
    },
  };
}

function guardAddonApiCall<TArgs extends unknown[], TResult>(
  permissionGuard: AddonPermissionGuard,
  permissionPath: string,
  fn: (...args: TArgs) => TResult,
): (...args: TArgs) => TResult {
  return (...args: TArgs) => {
    permissionGuard.assertAllowed(permissionPath);
    return fn(...args);
  };
}

/**
 * Type bridge utility to convert between internal and SDK types
 * This handles the mapping between the actual implementation types and the public SDK types
 */
export function createSDKHostAPIBridge(
  internalAPI: InternalHostAPI,
  addonId?: string,
  permissionGuard: AddonPermissionGuard = UNRESTRICTED_PERMISSION_GUARD,
): Omit<SDKHostAPI, "secrets"> {
  const guarded = <TArgs extends unknown[], TResult>(
    permissionPath: string,
    fn: (...args: TArgs) => TResult,
  ) => guardAddonApiCall(permissionGuard, permissionPath, fn);

  // Create logger with addon prefix
  const createAddonLogger = (prefix: string) => ({
    error: (message: string) => internalAPI.logError(`[${prefix}] ${message}`),
    info: (message: string) => internalAPI.logInfo(`[${prefix}] ${message}`),
    warn: (message: string) => internalAPI.logWarn(`[${prefix}] ${message}`),
    trace: (message: string) => internalAPI.logTrace(`[${prefix}] ${message}`),
    debug: (message: string) => internalAPI.logDebug(`[${prefix}] ${message}`),
  });

  const toSDKGoal = (goal: Goal): SDKGoal => {
    const targetAmount = goal.targetAmount ?? goal.summaryTargetAmount ?? 0;

    return {
      id: goal.id,
      goalType: goal.goalType,
      title: goal.title,
      description: goal.description ?? undefined,
      targetAmount,
      statusLifecycle: goal.statusLifecycle,
      statusHealth: goal.statusHealth,
      priority: goal.priority,
      coverImageKey: goal.coverImageKey ?? undefined,
      currency: goal.currency ?? undefined,
      startDate: goal.startDate ?? undefined,
      targetDate: goal.targetDate ?? undefined,
      summaryCurrentValue: goal.summaryCurrentValue ?? undefined,
      summaryProgress: goal.summaryProgress ?? undefined,
      projectedCompletionDate: goal.projectedCompletionDate ?? undefined,
      projectedValueAtTargetDate: goal.projectedValueAtTargetDate ?? undefined,
      summaryTargetAmount: goal.summaryTargetAmount ?? targetAmount,
      createdAt: goal.createdAt ?? undefined,
      updatedAt: goal.updatedAt ?? undefined,
    };
  };

  const toSDKGoalAllocation = (rule: GoalFundingRule): SDKGoalAllocation => ({
    id: rule.id,
    goalId: rule.goalId,
    accountId: rule.accountId,
    sharePercent: rule.sharePercent,
    taxBucket: rule.taxBucket,
  });

  const toGoalFundingRuleInput = (allocation: SDKGoalAllocation): GoalFundingRuleInput => {
    if (!Number.isFinite(allocation.sharePercent)) {
      throw new Error("Goal allocation sharePercent must be a number");
    }
    return {
      accountId: allocation.accountId,
      sharePercent: allocation.sharePercent,
      taxBucket: allocation.taxBucket,
    };
  };

  const getGoalAllocations = async (): Promise<SDKGoalAllocation[]> => {
    const goals = await internalAPI.getGoals();
    const allocations = await Promise.all(goals.map((goal) => internalAPI.getGoalFunding(goal.id)));
    return allocations.flat().map(toSDKGoalAllocation);
  };

  const getGoalFunding = async (goalId: string): Promise<SDKGoalAllocation[]> => {
    const rules = await internalAPI.getGoalFunding(goalId);
    return rules.map(toSDKGoalAllocation);
  };

  const saveGoalFunding = async (
    goalId: string,
    allocations: SDKGoalAllocation[],
  ): Promise<SDKGoalAllocation[]> => {
    const rules = await internalAPI.saveGoalFunding(
      goalId,
      allocations.map(toGoalFundingRuleInput),
    );
    return rules.map(toSDKGoalAllocation);
  };

  const updateGoalAllocations = async (allocations: SDKGoalAllocation[]): Promise<void> => {
    const byGoalId = new Map<string, GoalFundingRuleInput[]>();
    for (const allocation of allocations) {
      const rules = byGoalId.get(allocation.goalId) ?? [];
      rules.push(toGoalFundingRuleInput(allocation));
      byGoalId.set(allocation.goalId, rules);
    }

    await Promise.all(
      Array.from(byGoalId, ([goalId, rules]) => internalAPI.saveGoalFunding(goalId, rules)),
    );
  };

  return {
    accounts: {
      getAll: guarded("api.accounts.getAll", internalAPI.getAccounts),
      create: guarded("api.accounts.create", internalAPI.createAccount),
    },
    portfolio: {
      getHoldings: guarded("api.portfolio.getHoldings", internalAPI.getHoldings),
      getHolding: guarded("api.portfolio.getHolding", internalAPI.getHolding),
      update: guarded("api.portfolio.update", internalAPI.updatePortfolio),
      recalculate: guarded("api.portfolio.recalculate", internalAPI.recalculatePortfolio),
      getIncomeSummary: guarded("api.portfolio.getIncomeSummary", internalAPI.getIncomeSummary),
      getHistoricalValuations: guarded(
        "api.portfolio.getHistoricalValuations",
        internalAPI.getHistoricalValuations,
      ),
      getLatestValuations: guarded(
        "api.portfolio.getLatestValuations",
        internalAPI.getLatestValuations,
      ),
    },
    activities: {
      getAll: guarded("api.activities.getAll", internalAPI.getActivities),
      search: guarded("api.activities.search", internalAPI.searchActivities),
      create: guarded("api.activities.create", internalAPI.createActivity),
      update: guarded("api.activities.update", internalAPI.updateActivity),
      saveMany: guarded(
        "api.activities.saveMany",
        (input: ActivityUpdate[] | ActivityBulkMutationRequest) =>
          Array.isArray(input)
            ? internalAPI.saveActivities({ updates: input })
            : internalAPI.saveActivities(input),
      ),
      import: guarded("api.activities.import", (activities: ActivityImport[]) =>
        internalAPI.importActivities({ activities }),
      ),
      checkImport: guarded("api.activities.checkImport", (activities: ActivityImport[]) =>
        internalAPI.checkActivitiesImport({ activities }),
      ),
      getImportMapping: guarded(
        "api.activities.getImportMapping",
        internalAPI.getAccountImportMapping,
      ),
      saveImportMapping: guarded(
        "api.activities.saveImportMapping",
        internalAPI.saveAccountImportMapping,
      ),
    },
    market: {
      searchTicker: guarded("api.market.searchTicker", internalAPI.searchTicker),
      syncHistory: guarded("api.market.syncHistory", internalAPI.syncHistoryQuotes),
      sync: guarded("api.market.sync", internalAPI.syncMarketData),
      getProviders: guarded("api.market.getProviders", internalAPI.getMarketDataProviders),
      fetchDividends: guarded("api.market.fetchDividends", internalAPI.fetchYahooDividends),
    },
    assets: {
      getProfile: guarded("api.assets.getProfile", internalAPI.getAssetProfile),
      updateProfile: guarded("api.assets.updateProfile", internalAPI.updateAssetProfile),
      updateQuoteMode: guarded("api.assets.updateQuoteMode", internalAPI.updateQuoteMode),
    },
    quotes: {
      update: guarded("api.quotes.update", internalAPI.updateQuote),
      getHistory: guarded("api.quotes.getHistory", internalAPI.getQuoteHistory),
    },
    performance: {
      calculateHistory: guarded(
        "api.performance.calculateHistory",
        internalAPI.calculatePerformanceHistory,
      ),
      calculateSummary: guarded(
        "api.performance.calculateSummary",
        internalAPI.calculatePerformanceSummary,
      ),
      calculateAccountsSimple: guarded(
        "api.performance.calculateAccountsSimple",
        internalAPI.calculateAccountsSimplePerformance,
      ),
    },
    exchangeRates: {
      getAll: guarded("api.exchangeRates.getAll", internalAPI.getExchangeRates),
      update: guarded("api.exchangeRates.update", internalAPI.updateExchangeRate),
      add: guarded("api.exchangeRates.add", internalAPI.addExchangeRate),
    },
    contributionLimits: {
      getAll: guarded("api.contributionLimits.getAll", internalAPI.getContributionLimit),
      create: guarded("api.contributionLimits.create", internalAPI.createContributionLimit),
      update: guarded("api.contributionLimits.update", internalAPI.updateContributionLimit),
      calculateDeposits: guarded(
        "api.contributionLimits.calculateDeposits",
        internalAPI.calculateDepositsForLimit,
      ),
    },
    goals: {
      getAll: guarded("api.goals.getAll", async () =>
        (await internalAPI.getGoals()).map(toSDKGoal),
      ),
      create: guarded("api.goals.create", async (goal) =>
        toSDKGoal(await internalAPI.createGoal(goal)),
      ),
      update: guarded("api.goals.update", async (goal) =>
        toSDKGoal(await internalAPI.updateGoal(goal)),
      ),
      getFunding: guarded("api.goals.getFunding", getGoalFunding),
      saveFunding: guarded("api.goals.saveFunding", saveGoalFunding),
      getAllocations: guarded("api.goals.getAllocations", getGoalAllocations),
      updateAllocations: guarded("api.goals.updateAllocations", updateGoalAllocations),
    },
    settings: {
      get: guarded("api.settings.get", internalAPI.getSettings),
      update: guarded("api.settings.update", internalAPI.updateSettings),
      backupDatabase: guarded("api.settings.backupDatabase", internalAPI.backupDatabase),
    },
    files: {
      openCsvDialog: guarded("api.files.openCsvDialog", internalAPI.openCsvFileDialog),
      openSaveDialog: guarded("api.files.openSaveDialog", internalAPI.openFileSaveDialog),
    },
    snapshots: {
      getAll: guarded("api.snapshots.getAll", internalAPI.getSnapshots),
      getByDate: guarded("api.snapshots.getByDate", internalAPI.getSnapshotByDate),
      save: guarded("api.snapshots.save", internalAPI.saveManualHoldings),
      checkImport: guarded("api.snapshots.checkImport", internalAPI.checkHoldingsImport),
      importSnapshots: guarded("api.snapshots.importSnapshots", internalAPI.importHoldingsCsv),
      delete: guarded("api.snapshots.delete", internalAPI.deleteSnapshot),
    },

    logger: createAddonLogger(addonId || "unknown-addon"),

    events: {
      import: {
        onDropHover: <T>(handler: EventCallback<T>) => {
          permissionGuard.assertAllowed("api.events.import.onDropHover");
          return internalAPI.listenImportFileDropHover(handler);
        },
        onDrop: <T>(handler: EventCallback<T>) => {
          permissionGuard.assertAllowed("api.events.import.onDrop");
          return internalAPI.listenImportFileDrop(handler);
        },
        onDropCancelled: <T>(handler: EventCallback<T>) => {
          permissionGuard.assertAllowed("api.events.import.onDropCancelled");
          return internalAPI.listenImportFileDropCancelled(handler);
        },
      },
      portfolio: {
        onUpdateStart: <T>(handler: EventCallback<T>) => {
          permissionGuard.assertAllowed("api.events.portfolio.onUpdateStart");
          return internalAPI.listenPortfolioUpdateStart(handler);
        },
        onUpdateComplete: <T>(handler: EventCallback<T>) => {
          permissionGuard.assertAllowed("api.events.portfolio.onUpdateComplete");
          return internalAPI.listenPortfolioUpdateComplete(handler);
        },
        onUpdateError: <T>(handler: EventCallback<T>) => {
          permissionGuard.assertAllowed("api.events.portfolio.onUpdateError");
          return internalAPI.listenPortfolioUpdateError(handler);
        },
      },
      market: {
        onSyncStart: <T>(handler: EventCallback<T>) => {
          permissionGuard.assertAllowed("api.events.market.onSyncStart");
          return internalAPI.listenMarketSyncStart(handler);
        },
        onSyncComplete: <T>(handler: EventCallback<T>) => {
          permissionGuard.assertAllowed("api.events.market.onSyncComplete");
          return internalAPI.listenMarketSyncComplete(handler);
        },
        onSyncError: <T>(handler: EventCallback<T>) => {
          permissionGuard.assertAllowed("api.events.market.onSyncError");
          return internalAPI.listenMarketSyncError(handler);
        },
      },
    },

    navigation: {
      navigate: internalAPI.navigateToRoute,
    },

    query: {
      getClient: () => {
        permissionGuard.assertAllowed("api.query.getClient");
        const queryClient = internalAPI.getQueryClient();
        if (!queryClient) {
          return undefined;
        }
        return {
          invalidateQueries: guarded("api.query.invalidateQueries", queryClient.invalidateQueries),
          refetchQueries: guarded("api.query.refetchQueries", queryClient.refetchQueries),
        };
      },
      invalidateQueries: guarded("api.query.invalidateQueries", internalAPI.invalidateQueries),
      refetchQueries: guarded("api.query.refetchQueries", internalAPI.refetchQueries),
    },

    toast: {
      success: internalAPI.toastSuccess,
      error: internalAPI.toastError,
      warning: internalAPI.toastWarning,
      info: internalAPI.toastInfo,
    },
  };
}
