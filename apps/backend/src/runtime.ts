import path from "node:path";
import { readFileSync } from "node:fs";

import {
  createAccountRepository,
  createAccountService,
  type AccountService,
} from "./domains/accounts";
import { createAlternativeAssetService } from "./domains/alternative-assets";
import { createAiProviderService } from "./domains/ai-providers";
import { createAppUtilityService } from "./domains/app-utilities";
import { createAssetService, parseExchangeNameLookup } from "./domains/assets";
import {
  createContributionDepositCalculator,
  createContributionLimitRepository,
  createContributionLimitService,
} from "./domains/contribution-limits";
import {
  createCustomProviderRepository,
  createCustomProviderService,
} from "./domains/custom-providers";
import { createExchangeRateRepository, createExchangeRateService } from "./domains/exchange-rates";
import { createGoalRepository, createGoalService } from "./domains/goals";
import { createHealthRepository, createHealthService } from "./domains/health";
import {
  createMarketDataProviderRepository,
  createMarketDataProviderService,
} from "./domains/market-data-providers";
import { createFileSecretService, deriveSecretsEncryptionKey } from "./domains/secrets";
import { createSettingsService } from "./domains/settings";
import { createSyncCryptoService } from "./domains/sync-crypto";
import { createTaxonomyRepository, createTaxonomyService } from "./domains/taxonomies";
import { createEventBus, type BackendEventBus } from "./events";
import type { BackendRequestHandlerOptions } from "./http";
import {
  initializeSqliteDatabase,
  resolveMigrationsDir,
  type InitializedSqliteDatabase,
} from "./storage/sqlite";

export interface SqliteBackedBackendServicesOptions {
  appDataDir?: string;
  env?: NodeJS.ProcessEnv;
  eventBus?: BackendEventBus;
  migrationsDir?: string;
  repositoryRoot?: string;
  secretKey?: Uint8Array;
  aiProviderCatalogJson?: string;
}

export interface SqliteBackedBackendServices {
  options: BackendRequestHandlerOptions;
  dbPath: string;
  appliedMigrations: string[];
  close(): void;
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
  },
): SqliteBackedBackendServices {
  const eventBus = runtimeOptions.eventBus ?? createEventBus();
  const { db } = initialized;
  let closed = false;
  let restartRequired = false;
  const closeDatabase = () => {
    if (!closed) {
      db.close();
      closed = true;
    }
  };
  const prepareDatabaseRestore = () => {
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
  const accountService = createRuntimeAccountService(db, eventBus, baseCurrency);
  const exchangeRateService = createExchangeRateService(createExchangeRateRepository(db), {
    eventBus,
  });
  exchangeRateService.initialize();
  const appDataDir = runtimeOptions.appDataDir;
  const secretService = createRuntimeSecretService({
    appDataDir,
    env: runtimeOptions.env,
    secretKey: runtimeOptions.secretKey,
  });

  const options: BackendRequestHandlerOptions = {
    accountService,
    alternativeAssetService: createAlternativeAssetService(db, { eventBus }),
    assetService: createAssetService(db, {
      eventBus,
      exchangeNameByMic: readExchangeNameLookup(runtimeOptions.repositoryRoot),
    }),
    aiProviderService: secretService
      ? createAiProviderService({
          db,
          secretService,
          catalogJson:
            runtimeOptions.aiProviderCatalogJson ??
            readAiProviderCatalogJson(runtimeOptions.repositoryRoot),
        })
      : undefined,
    appUtilityService: createAppUtilityService({
      appDataDir,
      appVersion: readPackageVersion(runtimeOptions.repositoryRoot),
      dbPath: initialized.dbPath,
      env: runtimeOptions.env,
      instanceId: () => settingsService.getSettings().instanceId,
      logsDir: runtimeOptions.env.WF_LOGS_DIR?.trim() || path.join(appDataDir, "logs"),
      prepareDatabaseRestore,
    }),
    contributionLimitService: createContributionLimitService(
      createContributionLimitRepository(db),
      {
        baseCurrency,
        calculateDeposits: createContributionDepositCalculator(
          db,
          exchangeRateService,
          () => settingsService.getSettings().timezone,
        ),
      },
    ),
    customProviderService: createCustomProviderService(createCustomProviderRepository(db), {
      secretService,
    }),
    eventBus,
    exchangeRateService,
    goalService: createGoalService(createGoalRepository(db), {
      accountProvider: accountService,
      baseCurrency,
    }),
    healthService: createHealthService(createHealthRepository(db)),
    marketDataProviderService: createMarketDataProviderService(
      createMarketDataProviderRepository(db),
    ),
    restartRequired: () => restartRequired,
    secretService,
    settingsService,
    syncCryptoService: createSyncCryptoService(),
    taxonomyService: createTaxonomyService(createTaxonomyRepository(db)),
  };

  return {
    options,
    dbPath: initialized.dbPath,
    appliedMigrations: initialized.appliedMigrations,
    close() {
      closeDatabase();
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
    throw new Error("WF_SECRET_BACKEND=keyring is not yet available in the TS backend runtime");
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

function createRuntimeAccountService(
  db: InitializedSqliteDatabase["db"],
  eventBus: BackendEventBus,
  baseCurrency: () => string | undefined,
): AccountService {
  return createAccountService(createAccountRepository(db), {
    baseCurrency,
    eventBus,
  });
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

function readExchangeNameLookup(repositoryRoot: string): Map<string, string> {
  return parseExchangeNameLookup(
    readFileSync(
      path.join(repositoryRoot, "crates/market-data/src/resolver/exchanges.json"),
      "utf8",
    ),
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readAiProviderCatalogJson(repositoryRoot: string): string {
  return readFileSync(path.join(repositoryRoot, "crates/ai/src/ai_providers.json"), "utf8");
}
