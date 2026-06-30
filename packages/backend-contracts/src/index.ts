export {
  classifyCommandSurface,
  createRouteMap,
  normalizeApiPath,
  type ClassifiedCommand,
  type CommandRoute,
  type CommandSurface,
  type CommandSurfaceStats,
  type CommandSurfaceSource,
  type CommandType,
  type HttpMethod,
  type RouteMap,
} from "./command-surface";
export {
  extractCommandObjectLiteral,
  parseCommandRoutesFromSource,
  type CommandSourceName,
} from "./source-parsers";
export {
  normalizeDecimalString,
  normalizeErrorEnvelope,
  normalizeOutputForParity,
  normalizeTemporalString,
  type NormalizedErrorEnvelope,
} from "./normalization";
export {
  ADDON_HOST_CANARY_CONTRACT,
  PARITY_SMOKE_COMMANDS,
  type AddonHostCanaryContract,
  type ParitySmokeCommand,
} from "./parity-fixtures";
export {
  ADDON_HOST_PREFLIGHT,
  EXPECTED_ELECTRON_NATIVE_COMMANDS,
  EXPECTED_ELECTRON_ONLY_BACKEND_COMMANDS,
  EXPECTED_WEB_ONLY_BACKEND_COMMANDS,
  MIXED_VERSION_SYNC_PREFLIGHT_COMMANDS,
  SECRET_ENTRY_USERNAME,
  SECRET_SERVICE_PREFIX,
  assertExpectedCompatibilityPreflights,
  createCommandCompatibilityReport,
  formatDesktopSecretServiceId,
  formatSecretServiceId,
  normalizeSecretNamespace,
  type CommandCompatibilityReport,
} from "./compatibility-preflights";
