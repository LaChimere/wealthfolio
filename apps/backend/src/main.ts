import { loadBackendConfigFromEnv } from "./config";
import { startBackendServer } from "./server";

if (import.meta.main) {
  const config = loadBackendConfigFromEnv();
  const server = startBackendServer(config);
  console.info(`Wealthfolio TS backend listening on ${server.baseUrl}`);

  const stop = () => {
    server.stop();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
