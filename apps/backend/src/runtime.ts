import path from "node:path";
import { readFileSync } from "node:fs";

import {
  createAccountRepository,
  createAccountService,
  type AccountService,
  type AccountSyncEvent,
} from "./domains/accounts";
import { createLocalAddonService } from "./domains/addons";
import { createAiChatService } from "./domains/ai-chat";
import { createPortfolioAiChatTools } from "./domains/ai-chat-tools";
import { createAlternativeAssetService } from "./domains/alternative-assets";
import { createAiProviderService } from "./domains/ai-providers";
import { createAppUtilityService } from "./domains/app-utilities";
import { createAssetService, parseExchangeMetadataLookup } from "./domains/assets";
import {
  createDisabledConnectDeviceSyncService,
  createLocalConnectService,
} from "./domains/connect";
import {
  createContributionDepositCalculator,
  createContributionLimitRepository,
  createContributionLimitService,
} from "./domains/contribution-limits";
import { createActivityService } from "./domains/activities";
import {
  createCustomProviderRepository,
  createCustomProviderService,
} from "./domains/custom-providers";
import { createDisabledDeviceSyncService } from "./domains/device-sync";
import { createExchangeRateRepository, createExchangeRateService } from "./domains/exchange-rates";
import { createGoalRepository, createGoalService } from "./domains/goals";
import {
  createHealthRepository,
  createHealthService,
  type NegativeAccountBalanceInfo,
} from "./domains/health";
import { createHoldingsService } from "./domains/holdings";
import { createMarketDataService } from "./domains/market-data";
import {
  createMarketDataProviderRepository,
  createMarketDataProviderService,
} from "./domains/market-data-providers";
import { createLocalPortfolioJobService } from "./domains/portfolio-jobs";
import { createPortfolioMetricsService } from "./domains/portfolio-metrics";
import {
  createFileSecretService,
  createKeyringSecretService,
  deriveSecretsEncryptionKey,
} from "./domains/secrets";
import { createSettingsService } from "./domains/settings";
import { createSyncCryptoService } from "./domains/sync-crypto";
import {
  createTaxonomyRepository,
  createTaxonomyService,
  type Taxonomy,
  type TaxonomyCategory,
  type TaxonomySyncPayload,
} from "./domains/taxonomies";
import { createEventBus, type BackendEventBus } from "./events";
import type { BackendRequestHandlerOptions, GoalValuationProvider } from "./http";
import {
  initializeSqliteDatabase,
  resolveMigrationsDir,
  type InitializedSqliteDatabase,
} from "./storage/sqlite";
import { createSyncOutboxQueue } from "./sync-outbox";
import { createDomainEventWorker, type DomainEventWorkerHandle } from "./domain-events/worker";

export interface SqliteBackedBackendServicesOptions {
  appDataDir?: string;
  env?: NodeJS.ProcessEnv;
  eventBus?: BackendEventBus;
  migrationsDir?: string;
  repositoryRoot?: string;
  secretKey?: Uint8Array;
  aiProviderCatalogJson?: string;
  marketDataFetch?: typeof fetch;
  domainEventDebounceMs?: number;
}

export interface SqliteBackedBackendServices {
  options: BackendRequestHandlerOptions;
  dbPath: string;
  appliedMigrations: string[];
  domainEventWorker: DomainEventWorkerHandle;
  close(): Promise<void>;
}

export function createSqliteBackedBackendServices(
  options: SqliteBackedBackendServicesOptions = {},
): SqliteBackedBackendServices {
  const env = options.env ?? process.env;
  const appDataDir = resolveBackendAppDataDir(env, options.appDataDir);
  const repositoryRoot = options.repositoryRoot ?? defaultRepositoryRoot();
  const initialized = initializeSqliteDatabase({
    appDataDir,
    migrationsDir: resolveBackendMigrationsDir(env, { ...options, repositoryRoot }),
    env,
  });

  try {
    return createServicesFromDatabase(initialized, {
      appDataDir,
      env,
      eventBus: options.eventBus,
      repositoryRoot,
      secretKey: options.secretKey,
      aiProviderCatalogJson: options.aiProviderCatalogJson,
      marketDataFetch: options.marketDataFetch,
      ...(options.domainEventDebounceMs === undefined
        ? {}
        : { domainEventDebounceMs: options.domainEventDebounceMs }),
    });
  } catch (error) {
    initialized.db.close();
    throw error;
  }
}

export function resolveBackendAppDataDir(
  env: NodeJS.ProcessEnv = process.env,
  appDataDir?: string,
): string {
  const explicitAppDataDir = appDataDir?.trim();
  if (explicitAppDataDir) {
    return explicitAppDataDir;
  }

  const envAppDataDir = env.WF_APP_DATA_DIR?.trim();
  if (envAppDataDir) {
    return envAppDataDir;
  }

  const envDbPath = env.WF_DB_PATH?.trim() || env.DATABASE_URL?.trim();
  if (envDbPath) {
    return path.dirname(envDbPath);
  }

  return path.resolve(process.cwd(), "db");
}

export function resolveBackendMigrationsDir(
  env: NodeJS.ProcessEnv = process.env,
  options: Pick<SqliteBackedBackendServicesOptions, "migrationsDir" | "repositoryRoot"> = {},
): string {
  const explicitMigrationsDir = options.migrationsDir?.trim();
  if (explicitMigrationsDir) {
    return explicitMigrationsDir;
  }

  const envMigrationsDir = env.WF_MIGRATIONS_DIR?.trim();
  if (envMigrationsDir) {
    return envMigrationsDir;
  }

  return resolveMigrationsDir(options.repositoryRoot ?? defaultRepositoryRoot());
}

function createServicesFromDatabase(
  initialized: InitializedSqliteDatabase,
  runtimeOptions: {
    appDataDir: string;
    env: NodeJS.ProcessEnv;
    eventBus?: BackendEventBus;
    repositoryRoot: string;
    secretKey?: Uint8Array;
    aiProviderCatalogJson?: string;
    marketDataFetch?: typeof fetch;
    domainEventDebounceMs?: number;
  },
): SqliteBackedBackendServices {
  const eventBus = runtimeOptions.eventBus ?? createEventBus();
  const { db } = initialized;
  let closed = false;
  let restartRequired = false;
  let domainEventWorker: DomainEventWorkerHandle | undefined;
  const closeDatabase = () => {
    if (!closed) {
      db.close();
      closed = true;
    }
  };
  const flushAndDisposeDomainEventWorker = async () => {
    const worker = domainEventWorker;
    if (!worker) {
      return;
    }
    await worker.flushAndDispose();
  };
  const prepareDatabaseRestore = async () => {
    await flushAndDisposeDomainEventWorker();
    if (!closed) {
      try {
        db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
      } catch (error) {
        console.warn("WAL checkpoint before database restore failed:", errorMessage(error));
      }
      try {
        db.exec("PRAGMA journal_mode = DELETE;");
      } catch (error) {
        console.warn(
          "Switching SQLite journal mode before database restore failed:",
          errorMessage(error),
        );
      }
      closeDatabase();
    }
    restartRequired = true;
  };
  const settingsService = createSettingsService(db);
  const baseCurrency = () => settingsService.getSettings().baseCurrency || undefined;
  const syncOutboxQueue = createSyncOutboxQueue(db);
  const accountService = createRuntimeAccountService(db, eventBus, baseCurrency, (event) => {
    syncOutboxQueue.queueSyncEvent({
      entity: "accounts",
      entityId: event.accountId,
      operation: event.operation,
      payload: event.payload,
    });
  });
  const exchangeRateService = createExchangeRateService(
    createExchangeRateRepository(db, {
      queueAssetSyncEvent: (event) => {
        syncOutboxQueue.queueSyncEvent({
          entity: "assets",
          entityId: event.assetId,
          operation: event.operation,
          payload: event.payload,
        });
      },
    }),
    {
      eventBus,
    },
  );
  exchangeRateService.initialize();
  const marketDataService = createMarketDataService(db, {
    exchangeCatalogJson: readExchangeCatalogJson(runtimeOptions.repositoryRoot),
    fetch: runtimeOptions.marketDataFetch,
    queueQuoteSyncEvent: (event) => {
      syncOutboxQueue.queueSyncEvent({
        entity: "quotes",
        entityId: event.quoteId,
        operation: event.operation,
        payload: event.payload,
      });
    },
  });
  const appDataDir = runtimeOptions.appDataDir;
  const secretService = createRuntimeSecretService({
    appDataDir,
    env: runtimeOptions.env,
    secretKey: runtimeOptions.secretKey,
  });
  const aiProviderService = secretService
    ? createAiProviderService({
        db,
        secretService,
        catalogJson:
          runtimeOptions.aiProviderCatalogJson ??
          readAiProviderCatalogJson(runtimeOptions.repositoryRoot),
      })
    : undefined;
  const taxonomyService = createTaxonomyService(
    createTaxonomyRepository(db, {
      queueSyncEvent: (event) => {
        syncOutboxQueue.queueSyncEvent({
          entity: "taxonomies",
          entityId: event.taxonomyId,
          operation: event.operation,
          payload: taxonomySyncPayloadForOutbox(event.payload),
        });
      },
      queueAssignmentSyncEvent: (event) => {
        syncOutboxQueue.queueSyncEvent({
          entity: "asset_taxonomy_assignments",
          entityId: event.assignmentId,
          operation: event.operation,
          payload: event.payload,
        });
      },
    }),
  );

  const activityService = createActivityService(db, {
    eventBus,
    ensureFxPairs: async (pairs) => {
      await exchangeRateService.ensureFxPairs(pairs);
    },
    queueSyncEvent: (event) => {
      syncOutboxQueue.queueSyncEvent(event);
    },
  });
  const holdingsService = createHoldingsService(db, {
    baseCurrency,
    eventBus,
    exchangeRateService,
    queueSnapshotSyncEvent: (event) => {
      syncOutboxQueue.queueSyncEvent({
        entity: "holdings_snapshots",
        entityId: event.snapshotId,
        operation: event.operation,
        payload: event.payload,
      });
    },
    symbolSearch: (query) => marketDataService.searchSymbol?.(query) ?? [],
  });
  const goalService = createGoalService(
    createGoalRepository(db, {
      queueSyncEvent: (event) => {
        syncOutboxQueue.queueSyncEvent(event);
      },
    }),
    {
      accountProvider: accountService,
      baseCurrency,
    },
  );
  const portfolioMetricsService = createPortfolioMetricsService(db, {
    baseCurrency,
    exchangeRateService,
    timezone: () => settingsService.getSettings().timezone,
  });
  const healthService = createHealthService(createHealthRepository(db), undefined, {
    accountProvider: accountService,
    classificationMigrationProvider: taxonomyService,
    exchangeRateProvider: exchangeRateService,
    holdingsProvider: holdingsService,
    marketDataQuoteProvider: marketDataService,
    marketDataSyncProvider: marketDataService,
    settingsProvider: settingsService,
    valuationProvider: createNegativeBalanceProvider(db),
  });
  const portfolioJobService = createLocalPortfolioJobService(db, {
    baseCurrency: () => settingsService.getSettings().baseCurrency || "USD",
    eventBus,
    exchangeRateService,
    marketDataService,
  });
  domainEventWorker = createDomainEventWorker(eventBus, {
    ...(runtimeOptions.domainEventDebounceMs === undefined
      ? {}
      : { debounceMs: runtimeOptions.domainEventDebounceMs }),
    portfolioJobService,
    timezone: () => settingsService.getSettings().timezone,
    onError(error, events) {
      const eventNames = events.map((event) => event.name).join(", ");
      console.warn(`Domain event processing failed for [${eventNames}]: ${errorMessage(error)}`);
    },
  });

  const options: BackendRequestHandlerOptions = {
    accountService,
    activityService,
    addonService: createLocalAddonService({
      appDataDir,
      appVersion: readPackageVersion(runtimeOptions.repositoryRoot),
      instanceId: () => settingsService.getSettings().instanceId,
    }),
    alternativeAssetService: createAlternativeAssetService(db, {
      eventBus,
      queueAssetSyncEvent: (event) => {
        syncOutboxQueue.queueSyncEvent({
          entity: "assets",
          entityId: event.assetId,
          operation: event.operation,
          payload: event.payload,
        });
      },
      queueQuoteSyncEvent: (event) => {
        syncOutboxQueue.queueSyncEvent({
          entity: "quotes",
          entityId: event.quoteId,
          operation: event.operation,
          payload: event.payload,
        });
      },
    }),
    assetService: createAssetService(db, {
      eventBus,
      exchangeMetadata: readExchangeMetadataLookup(runtimeOptions.repositoryRoot),
      queueSyncEvent: (event) => {
        syncOutboxQueue.queueSyncEvent({
          entity: "assets",
          entityId: event.assetId,
          operation: event.operation,
          payload: event.payload,
        });
      },
    }),
    aiProviderService,
    aiChatService: createAiChatService(db, {
      aiProviderService,
      tools: createPortfolioAiChatTools({
        accountService,
        activityService,
        holdingsService,
        goalService,
        healthService,
        marketDataService,
        portfolioMetricsService,
        baseCurrency,
        timezone: () => settingsService.getSettings().timezone,
      }),
      queueThreadSyncEvent: (event) => {
        syncOutboxQueue.queueSyncEvent({
          entity: "ai_threads",
          entityId: event.threadId,
          operation: event.operation,
          payload: event.payload,
        });
      },
      queueMessageSyncEvent: (event) => {
        syncOutboxQueue.queueSyncEvent({
          entity: "ai_messages",
          entityId: event.messageId,
          operation: event.operation,
          payload: event.payload,
        });
      },
      queueThreadTagSyncEvent: (event) => {
        syncOutboxQueue.queueSyncEvent({
          entity: "ai_thread_tags",
          entityId: event.tagId,
          operation: event.operation,
          payload: event.payload,
        });
      },
    }),
    appUtilityService: createAppUtilityService({
      appDataDir,
      appVersion: readPackageVersion(runtimeOptions.repositoryRoot),
      dbPath: initialized.dbPath,
      env: runtimeOptions.env,
      instanceId: () => settingsService.getSettings().instanceId,
      logsDir: runtimeOptions.env.WF_LOGS_DIR?.trim() || path.join(appDataDir, "logs"),
      prepareDatabaseRestore,
    }),
    connectDeviceSyncService: createDisabledConnectDeviceSyncService(),
    connectService: createLocalConnectService(activityService),
    contributionLimitService: createContributionLimitService(
      createContributionLimitRepository(db, {
        queueSyncEvent: (event) =>
          syncOutboxQueue.queueSyncEvent({
            entity: "contribution_limits",
            entityId: event.limitId,
            operation: event.operation,
            payload: event.payload,
          }),
      }),
      {
        baseCurrency,
        calculateDeposits: createContributionDepositCalculator(
          db,
          exchangeRateService,
          () => settingsService.getSettings().timezone,
        ),
      },
    ),
    customProviderService: createCustomProviderService(
      createCustomProviderRepository(db, {
        queueSyncEvent: (event) => {
          syncOutboxQueue.queueSyncEvent({
            entity: "market_data_custom_providers",
            entityId: event.providerUuid,
            operation: event.operation,
            payload: event.payload,
          });
        },
      }),
      {
        secretService,
      },
    ),
    eventBus,
    deviceSyncService: createDisabledDeviceSyncService(),
    exchangeRateService,
    goalService,
    goalValuationProvider: createGoalValuationProvider(db, accountService),
    healthService,
    holdingsService,
    marketDataProviderService: createMarketDataProviderService(
      createMarketDataProviderRepository(db),
    ),
    marketDataService,
    portfolioJobService,
    portfolioMetricsService,
    restartRequired: () => restartRequired,
    secretService,
    settingsService,
    syncCryptoService: createSyncCryptoService(),
    taxonomyService,
  };

  return {
    options,
    dbPath: initialized.dbPath,
    appliedMigrations: initialized.appliedMigrations,
    domainEventWorker,
    async close() {
      try {
        await flushAndDisposeDomainEventWorker();
      } finally {
        closeDatabase();
      }
    },
  };
}

function createRuntimeSecretService(runtimeOptions: {
  appDataDir: string;
  env: NodeJS.ProcessEnv;
  secretKey?: Uint8Array;
}): BackendRequestHandlerOptions["secretService"] {
  const backend = parseSecretBackend(runtimeOptions.env.WF_SECRET_BACKEND);
  if (backend === "keyring") {
    return createKeyringSecretService({
      namespace: runtimeOptions.env.WF_SECRET_NAMESPACE,
    });
  }
  if (!runtimeOptions.secretKey) {
    return undefined;
  }

  return createFileSecretService({
    secretsFilePath:
      runtimeOptions.env.WF_SECRET_FILE?.trim() ||
      path.join(runtimeOptions.appDataDir, "secrets.json"),
    encryptionKey: deriveSecretsEncryptionKey(runtimeOptions.secretKey),
    rawKeyForMigration: runtimeOptions.secretKey,
  });
}

function parseSecretBackend(raw: string | undefined): "file" | "keyring" {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return "file";
  }
  const normalized = trimmed.toLowerCase();
  if (normalized === "file" || normalized === "keyring") {
    return normalized;
  }
  throw new Error(`Invalid WF_SECRET_BACKEND value '${trimmed}'. Expected 'file' or 'keyring'.`);
}

function taxonomySyncPayloadForOutbox(payload: TaxonomySyncPayload | { id: string }): unknown {
  if (!("taxonomy" in payload)) {
    return payload;
  }
  return {
    taxonomy: taxonomyRowPayload(payload.taxonomy),
    categories: payload.categories.map(taxonomyCategoryRowPayload),
  };
}

function taxonomyRowPayload(taxonomy: Taxonomy): Record<string, unknown> {
  return {
    id: taxonomy.id,
    name: taxonomy.name,
    color: taxonomy.color,
    description: taxonomy.description,
    is_system: taxonomy.isSystem ? 1 : 0,
    is_single_select: taxonomy.isSingleSelect ? 1 : 0,
    sort_order: taxonomy.sortOrder,
    created_at: taxonomy.createdAt,
    updated_at: taxonomy.updatedAt,
  };
}

function taxonomyCategoryRowPayload(category: TaxonomyCategory): Record<string, unknown> {
  return {
    id: category.id,
    taxonomy_id: category.taxonomyId,
    parent_id: category.parentId,
    name: category.name,
    key: category.key,
    color: category.color,
    description: category.description,
    sort_order: category.sortOrder,
    created_at: category.createdAt,
    updated_at: category.updatedAt,
  };
}

function createRuntimeAccountService(
  db: InitializedSqliteDatabase["db"],
  eventBus: BackendEventBus,
  baseCurrency: () => string | undefined,
  queueSyncEvent?: (event: AccountSyncEvent) => void,
): AccountService {
  return createAccountService(createAccountRepository(db, { queueSyncEvent }), {
    baseCurrency,
    eventBus,
  });
}

function createGoalValuationProvider(
  db: InitializedSqliteDatabase["db"],
  accountService: AccountService,
): GoalValuationProvider {
  return {
    async getGoalValuationMap() {
      const accountIds = accountService.getActiveNonArchivedAccounts().map((account) => account.id);
      if (accountIds.length === 0) {
        return {};
      }
      const placeholders = accountIds.map(() => "?").join(", ");
      const rows = db
        .query<DailyAccountValuationRow, string[]>(
          `
            WITH ranked_valuations AS (
              SELECT
                account_id,
                fx_rate_to_base,
                total_value,
                ROW_NUMBER() OVER (
                  PARTITION BY account_id
                  ORDER BY valuation_date DESC
                ) AS rn
              FROM daily_account_valuation
              WHERE account_id IN (${placeholders})
            )
            SELECT account_id, fx_rate_to_base, total_value
            FROM ranked_valuations
            WHERE rn = 1
          `,
        )
        .all(...accountIds);

      return Object.fromEntries(
        rows.map((row) => [
          row.account_id,
          parseDecimalText(row.total_value, 0) * parseDecimalText(row.fx_rate_to_base, 1),
        ]),
      );
    },
  };
}

function createNegativeBalanceProvider(db: InitializedSqliteDatabase["db"]) {
  return {
    getAccountsWithNegativeBalance(accountIds: string[]): NegativeAccountBalanceInfo[] {
      if (accountIds.length === 0 || !sqliteTableExists(db, "daily_account_valuation")) {
        return [];
      }
      const placeholders = accountIds.map(() => "?").join(", ");
      return db
        .query<
          {
            account_id: string;
            valuation_date: string;
            account_currency: string;
            cash_balance: string;
            total_value: string;
          },
          string[]
        >(
          `
            WITH negative_valuations AS (
              SELECT
                account_id,
                valuation_date,
                account_currency,
                cash_balance,
                total_value,
                ROW_NUMBER() OVER (
                  PARTITION BY account_id
                  -- Rust uses MIN(valuation_date); keep first-date semantics but
                  -- choose a deterministic row when recalculations duplicate a day.
                  ORDER BY valuation_date ASC, id ASC
                ) AS rn
              FROM daily_account_valuation
              WHERE account_id IN (${placeholders})
                AND CAST(total_value AS REAL) < 0
            )
            SELECT account_id, valuation_date, account_currency, cash_balance, total_value
            FROM negative_valuations
            WHERE rn = 1
            ORDER BY account_id ASC
          `,
        )
        .all(...accountIds)
        .map((row) => ({
          accountId: row.account_id,
          firstNegativeDate: row.valuation_date,
          cashBalance: row.cash_balance,
          totalValue: row.total_value,
          accountCurrency: row.account_currency,
        }));
    },
  };
}

interface DailyAccountValuationRow {
  account_id: string;
  fx_rate_to_base: string;
  total_value: string;
}

function sqliteTableExists(db: InitializedSqliteDatabase["db"], tableName: string): boolean {
  const row = db
    .query<
      { name: string },
      [string]
    >("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);
  return row !== null;
}

function parseDecimalText(value: string, fallback: number): number {
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function defaultRepositoryRoot(): string {
  return path.resolve(import.meta.dir, "../../..");
}

function readPackageVersion(repositoryRoot: string): string {
  try {
    const packageJson = JSON.parse(
      readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
    ) as { version?: unknown };
    return typeof packageJson.version === "string" ? packageJson.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function readExchangeMetadataLookup(repositoryRoot: string) {
  return parseExchangeMetadataLookup(readExchangeCatalogJson(repositoryRoot));
}

function readExchangeCatalogJson(repositoryRoot: string): string {
  return readFileSync(
    path.join(repositoryRoot, "crates/market-data/src/resolver/exchanges.json"),
    "utf8",
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readAiProviderCatalogJson(repositoryRoot: string): string {
  return readFileSync(path.join(repositoryRoot, "crates/ai/src/ai_providers.json"), "utf8");
}
