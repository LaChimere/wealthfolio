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
