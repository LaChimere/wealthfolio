import { loadBackendConfigFromEnv } from "./config";
import { createSqliteBackedBackendServices } from "./runtime";
import { startBackendServer } from "./server";

if (import.meta.main) {
  const config = loadBackendConfigFromEnv();
  const runtime = createSqliteBackedBackendServices({ secretKey: config.secretKey });
  let server: ReturnType<typeof startBackendServer>;
  try {
    server = startBackendServer(config, runtime.options);
  } catch (error) {
    runtime.close();
    throw error;
  }
  console.info(`Wealthfolio TS backend database path: ${runtime.dbPath}`);
  if (runtime.appliedMigrations.length > 0) {
    console.info(`Applied ${runtime.appliedMigrations.length} pending TS backend migrations`);
  }
  console.info(`Wealthfolio TS backend listening on ${server.baseUrl}`);

  const stop = () => {
    server.stop();
    runtime.close();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
