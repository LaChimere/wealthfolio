import path from "node:path";
import { readFileSync } from "node:fs";

import {
  createAccountRepository,
  createAccountService,
  type AccountService,
} from "./domains/accounts";
import { createAppUtilityService } from "./domains/app-utilities";
import {
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
import { createSettingsService } from "./domains/settings";
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
  },
): SqliteBackedBackendServices {
  const eventBus = runtimeOptions.eventBus ?? createEventBus();
  const { db } = initialized;
  const settingsService = createSettingsService(db);
  const baseCurrency = () => settingsService.getSettings().baseCurrency || undefined;
  const accountService = createRuntimeAccountService(db, eventBus, baseCurrency);
  const appDataDir = runtimeOptions.appDataDir;

  const options: BackendRequestHandlerOptions = {
    accountService,
    appUtilityService: createAppUtilityService({
      appDataDir,
      appVersion: readPackageVersion(runtimeOptions.repositoryRoot),
      dbPath: initialized.dbPath,
      env: runtimeOptions.env,
      instanceId: () => settingsService.getSettings().instanceId,
      logsDir: runtimeOptions.env.WF_LOGS_DIR?.trim() || path.join(appDataDir, "logs"),
    }),
    contributionLimitService: createContributionLimitService(
      createContributionLimitRepository(db),
      {
        baseCurrency,
      },
    ),
    customProviderService: createCustomProviderService(createCustomProviderRepository(db)),
    eventBus,
    exchangeRateService: createExchangeRateService(createExchangeRateRepository(db)),
    goalService: createGoalService(createGoalRepository(db), {
      accountProvider: accountService,
      baseCurrency,
    }),
    healthService: createHealthService(createHealthRepository(db)),
    marketDataProviderService: createMarketDataProviderService(
      createMarketDataProviderRepository(db),
    ),
    settingsService,
    taxonomyService: createTaxonomyService(createTaxonomyRepository(db)),
  };

  let closed = false;
  return {
    options,
    dbPath: initialized.dbPath,
    appliedMigrations: initialized.appliedMigrations,
    close() {
      if (!closed) {
        db.close();
        closed = true;
      }
    },
  };
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
