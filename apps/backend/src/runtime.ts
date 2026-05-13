import path from "node:path";

import {
  createAccountRepository,
  createAccountService,
  type AccountService,
} from "./domains/accounts";
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
  const initialized = initializeSqliteDatabase({
    appDataDir: resolveBackendAppDataDir(env, options.appDataDir),
    migrationsDir: resolveBackendMigrationsDir(env, options),
    env,
  });

  try {
    return createServicesFromDatabase(initialized, options.eventBus);
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
  eventBus = createEventBus(),
): SqliteBackedBackendServices {
  const { db } = initialized;
  const settingsService = createSettingsService(db);
  const baseCurrency = () => settingsService.getSettings().baseCurrency || undefined;
  const accountService = createRuntimeAccountService(db, eventBus, baseCurrency);

  const options: BackendRequestHandlerOptions = {
    accountService,
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
