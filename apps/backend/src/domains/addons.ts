import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { STATUS_CODES } from "node:http";
import path from "node:path";

import { unzipSync } from "fflate";

export interface AddonZipInstallRequest {
  zipData: Uint8Array;
  enableAfterInstall: boolean;
}

export interface AddonZipExtractRequest {
  zipData: Uint8Array;
}

export interface AddonRatingRequest {
  addonId: string;
  rating: number;
  review?: string;
}

export interface AddonStagingInstallRequest {
  addonId: string;
  enableAfterInstall: boolean;
}

export interface AddonService {
  listInstalledAddons(): Promise<unknown[]> | unknown[];
  installAddonZip(request: AddonZipInstallRequest): Promise<unknown> | unknown;
  toggleAddon(addonId: string, enabled: boolean): Promise<void> | void;
  uninstallAddon(addonId: string): Promise<void> | void;
  loadAddonForRuntime(addonId: string): Promise<unknown> | unknown;
  getEnabledAddonsOnStartup(): Promise<unknown[]> | unknown[];
  extractAddonZip(request: AddonZipExtractRequest): Promise<unknown> | unknown;
  fetchStoreListings(): Promise<unknown[]> | unknown[];
  getRatings(addonId: string): Promise<unknown[]> | unknown[];
  submitRating(request: AddonRatingRequest): Promise<unknown> | unknown;
  checkAddonUpdate(addonId: string): Promise<unknown> | unknown;
  checkAllAddonUpdates(): Promise<unknown[]> | unknown[];
  updateAddonFromStore(addonId: string): Promise<unknown> | unknown;
  downloadAddonToStaging(addonId: string): Promise<unknown> | unknown;
  installAddonFromStaging(request: AddonStagingInstallRequest): Promise<unknown> | unknown;
  clearAddonStaging(addonId?: string): Promise<void> | void;
}

export interface LocalAddonServiceOptions {
  appDataDir: string;
  appVersion?: string;
  fetchStore?: FetchStore;
  instanceId?: string | (() => string | undefined);
  storeBaseUrl?: string;
}

interface AddonManifestRecord extends Record<string, unknown> {
  id: string;
  name: string;
  version: string;
  description: string | null;
  author: string | null;
  sdkVersion: string | null;
  main: string;
  enabled: boolean | null;
  permissions: AddonPermissionRecord[] | null;
  homepage: string | null;
  repository: string | null;
  license: string | null;
  minWealthfolioVersion: string | null;
  keywords: string[] | null;
  icon: string | null;
  installedAt?: string;
  updatedAt?: string;
  source?: string;
  size?: number;
}

interface AddonPermissionRecord {
  category: string;
  functions: FunctionPermissionRecord[];
  purpose: string;
}

interface FunctionPermissionRecord {
  name: string;
  isDeclared: boolean;
  isDetected: boolean;
  detectedAt: string | null;
}

interface AddonFileRecord {
  name: string;
  content: string;
  isMain: boolean;
}

interface ExtractedAddonRecord {
  metadata: AddonManifestRecord;
  files: AddonFileRecord[];
}

interface InstalledAddonRecord {
  metadata: AddonManifestRecord;
  filePath: string;
  isZipAddon: boolean;
}

interface AddonStoreContext {
  appVersion?: string;
  fetchStore: FetchStore;
  instanceId?: string | (() => string | undefined);
  storeBaseUrl: string;
}

interface AddonUpdateCheckRecord {
  addonId: string;
  updateInfo: {
    currentVersion: string;
    latestVersion: string;
    updateAvailable: boolean;
    downloadUrl: string | null;
    releaseNotes: string | null;
    releaseDate: string | null;
    changelogUrl: string | null;
    isCritical: boolean | null;
    hasBreakingChanges: boolean | null;
    minWealthfolioVersion: string | null;
  };
  error: string | null;
}

type FetchStore = (input: string | URL, init?: RequestInit) => Promise<Response>;

const DEFAULT_ADDON_STORE_API_BASE_URL = "https://wealthfolio.app/api/addons";
const MAX_ADDON_ZIP_ENTRIES = 10_000;
const MAX_ADDON_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const RUST_STATUS_REASON_OVERRIDES: Record<number, string> = {
  418: "I'm a teapot",
  509: "<unknown status code>",
};
const PERMISSION_PATTERNS = [
  [
    "portfolio",
    [
      "getHoldings",
      "getHolding",
      "update",
      "recalculate",
      "getIncomeSummary",
      "getHistoricalValuations",
      "getLatestValuations",
    ],
    "Access to portfolio holdings, valuations, and performance",
  ],
  [
    "activities",
    [
      "getAll",
      "search",
      "create",
      "update",
      "saveMany",
      "import",
      "checkImport",
      "getImportMapping",
      "saveImportMapping",
    ],
    "Access to transaction history and activity management",
  ],
  ["accounts", ["getAll", "create"], "Access to account information and management"],
  [
    "market-data",
    [
      "searchTicker",
      "syncHistory",
      "sync",
      "getProviders",
      "getProfile",
      "updateProfile",
      "updateDataSource",
    ],
    "Access to quotes and market data",
  ],
  ["quotes", ["update", "getHistory"], "Access to quote management"],
  [
    "performance",
    ["calculateHistory", "calculateSummary", "calculateAccountsSimple"],
    "Access to performance calculations",
  ],
  [
    "financial-planning",
    ["getAll", "create", "update", "updateAllocations", "getAllocations", "calculateDeposits"],
    "Access to goals and contribution limits",
  ],
  ["currency", ["getAll", "update", "add"], "Access to exchange rates and currency data"],
  ["settings", ["get", "update", "backupDatabase"], "Access to application settings"],
  ["files", ["openCsvDialog", "openSaveDialog"], "Access to file dialogs"],
  [
    "events",
    [
      "onDropHover",
      "onDrop",
      "onDropCancelled",
      "onUpdateStart",
      "onUpdateComplete",
      "onUpdateError",
      "onSyncStart",
      "onSyncComplete",
    ],
    "Access to application events",
  ],
  ["ui", ["sidebar.addItem", "router.add", "onDisable"], "User interface and navigation"],
] as const;

export function createLocalAddonService(options: LocalAddonServiceOptions): AddonService {
  const appDataDir = path.resolve(options.appDataDir);
  const storeContext: AddonStoreContext = {
    appVersion: options.appVersion,
    fetchStore: options.fetchStore ?? fetch,
    instanceId: options.instanceId,
    storeBaseUrl: normalizeStoreBaseUrl(options.storeBaseUrl ?? DEFAULT_ADDON_STORE_API_BASE_URL),
  };

  return {
    async listInstalledAddons() {
      return listInstalledAddons(appDataDir);
    },

    async installAddonZip(request) {
      return installAddonZip(appDataDir, request);
    },

    async toggleAddon(addonId, enabled) {
      const addonDir = getAddonPath(appDataDir, addonId);
      const manifest = readManifestOrError(addonDir);
      writeManifest(addonDir, { ...manifest, enabled });
    },

    async uninstallAddon(addonId) {
      const addonDir = getAddonPath(appDataDir, addonId);
      if (!existsSync(addonDir)) {
        throw new Error("Addon not found");
      }
      rmSync(addonDir, { recursive: true, force: false });
    },

    async loadAddonForRuntime(addonId) {
      return loadAddonForRuntime(appDataDir, addonId);
    },

    async getEnabledAddonsOnStartup() {
      const installed = listInstalledAddons(appDataDir);
      const enabled: ExtractedAddonRecord[] = [];
      for (const addon of installed) {
        if (!manifestEnabled(addon.metadata)) {
          continue;
        }
        try {
          enabled.push(loadAddonForRuntime(appDataDir, addon.metadata.id));
        } catch {
          // Match Rust startup behavior: skip a broken enabled addon without
          // preventing other enabled addons from loading.
        }
      }
      return enabled;
    },

    async extractAddonZip(request) {
      return extractAddonZip(request.zipData);
    },

    async fetchStoreListings() {
      return fetchAddonStoreListings(storeContext);
    },

    async getRatings(addonId) {
      return fetchAddonRatings(storeContext, addonId);
    },

    async submitRating(request) {
      return submitAddonRating(storeContext, request);
    },

    async checkAddonUpdate(addonId) {
      return checkAddonUpdate(appDataDir, storeContext, addonId);
    },

    async checkAllAddonUpdates() {
      return checkAllAddonUpdates(appDataDir, storeContext);
    },

    async updateAddonFromStore(addonId) {
      return updateAddonFromStore(appDataDir, storeContext, addonId);
    },

    async downloadAddonToStaging(addonId) {
      const zipData = await downloadAddonFromStore(storeContext, addonId);
      validateAddonZipDataForStaging(zipData);
      const extracted = extractAddonZip(zipData);
      ensureAddonManifestMatchesRequest(extracted.metadata, addonId);
      saveAddonToStaging(appDataDir, addonId, zipData);
      return extracted;
    },

    async installAddonFromStaging(request) {
      const zipPath = getStagingZipPath(appDataDir, request.addonId);
      if (!existsSync(zipPath)) {
        throw new Error(`Staged addon file not found for addon: ${request.addonId}`);
      }
      const zipData = readFileSync(zipPath);
      ensureAddonManifestMatchesRequest(extractAddonZip(zipData).metadata, request.addonId);
      const manifest = installAddonZip(appDataDir, {
        zipData,
        enableAfterInstall: request.enableAfterInstall,
      });
      rmSync(zipPath, { force: true });
      return manifest;
    },

    async clearAddonStaging(addonId) {
      clearAddonStaging(appDataDir, addonId);
    },
  };
}

function listInstalledAddons(appDataDir: string): InstalledAddonRecord[] {
  const addonsDir = ensureAddonsDirectory(appDataDir);
  const installed: InstalledAddonRecord[] = [];
  for (const entry of readdirSync(addonsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      continue;
    }
    const addonDir = path.join(addonsDir, entry.name);
    const manifest = readManifestIfExists(addonDir);
    if (!manifest) {
      continue;
    }
    installed.push({
      metadata: manifest,
      filePath: addonDir,
      isZipAddon: readdirSync(addonDir).length > 2,
    });
  }
  return installed;
}

function loadAddonForRuntime(appDataDir: string, addonId: string): ExtractedAddonRecord {
  const addonDir = getAddonPath(appDataDir, addonId);
  const manifest = readManifestOrError(addonDir);
  if (!manifestEnabled(manifest)) {
    throw new Error("Addon is disabled");
  }

  const main = manifestMain(manifest);
  const files: AddonFileRecord[] = [];
  readAddonFilesRecursive(addonDir, addonDir, files);

  const normalizedMain = normalizeAddonFilePath(main);
  markRuntimeMainFile(files, normalizedMain);
  if (!files.some((file) => file.isMain)) {
    throw new Error("Main addon file not found");
  }

  return { metadata: manifest, files };
}

function installAddonZip(appDataDir: string, request: AddonZipInstallRequest): AddonManifestRecord {
  const extracted = extractAddonZip(request.zipData);
  const addonDir = getAddonPath(appDataDir, extracted.metadata.id);

  if (existsSync(addonDir)) {
    rmSync(addonDir, { recursive: true, force: false });
  }
  mkdirSync(addonDir, { recursive: true });

  for (const file of extracted.files) {
    writeAddonArchiveFile(addonDir, file);
  }

  const installed = installManifest(extracted.metadata, request.enableAfterInstall);
  writeManifest(addonDir, installed);
  return installed;
}

function extractAddonZip(zipData: Uint8Array): ExtractedAddonRecord {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zipData);
  } catch (error) {
    throw new Error(`Failed to read ZIP: ${errorMessage(error)}`);
  }

  const entryList = Object.entries(entries);
  if (entryList.length > MAX_ADDON_ZIP_ENTRIES) {
    throw new Error(`Addon ZIP contains too many entries: ${entryList.length}`);
  }

  let totalBytes = 0;
  const rawFiles: Array<{ name: string; content: string }> = [];

  for (const [fileName, contentBytes] of entryList) {
    if (fileName.endsWith("/")) {
      continue;
    }
    validateAddonArchivePath(fileName);
    totalBytes += contentBytes.byteLength;
    if (totalBytes > MAX_ADDON_UNCOMPRESSED_BYTES) {
      throw new Error("Addon ZIP uncompressed size exceeds the supported limit");
    }

    const content = decodeAddonArchiveText(fileName, contentBytes);
    rawFiles.push({ name: fileName, content });
  }

  const manifestFiles = rawFiles.filter(
    (file) => path.posix.basename(file.name) === "manifest.json",
  );
  if (manifestFiles.length === 0) {
    throw new Error("ZIP addon must contain a manifest.json file with addon metadata");
  }
  if (manifestFiles.length > 1) {
    throw new Error("ZIP addon must contain exactly one manifest.json file");
  }

  const manifestFile = manifestFiles[0];
  const manifestDir = path.posix.dirname(manifestFile.name);
  const packageRoot = manifestDir === "." ? "" : `${manifestDir}/`;
  const manifestContent = manifestFile.content;
  const metadata = parseAddonManifest(JSON.parse(manifestContent));
  const main = normalizeAddonFilePath(manifestMain(metadata));
  validateAddonArchivePath(main);
  const files = rawFiles
    .flatMap((file): AddonFileRecord[] => {
      if (packageRoot && !file.name.startsWith(packageRoot)) {
        return [];
      }
      const relativeName = packageRoot ? file.name.slice(packageRoot.length) : file.name;
      return [{ name: relativeName, content: file.content, isMain: false }];
    })
    .filter((file) => file.name.length > 0);
  for (const file of files) {
    file.isMain = normalizeAddonFilePath(file.name) === main;
  }
  if (!files.some((file) => file.isMain)) {
    throw new Error(
      `Main addon file '${main}' not found. Available files: ${files
        .map((file) => file.name)
        .join(", ")}`,
    );
  }

  metadata.permissions = mergeAddonPermissions(metadata.permissions, detectAddonPermissions(files));
  return { metadata, files };
}

async function fetchAddonStoreListings(context: AddonStoreContext): Promise<unknown[]> {
  const responseJson = await fetchAddonStoreJson<unknown>(context, context.storeBaseUrl, "Store", {
    requireInstanceId: true,
  });
  if (Array.isArray(responseJson)) {
    return responseJson;
  }
  if (!isRecord(responseJson)) {
    throw new Error("Invalid API response structure");
  }
  const addons = responseJson.addons;
  if (Array.isArray(addons)) {
    return addons;
  }
  if (addons !== undefined) {
    throw new Error("'addons' field is not an array in API response");
  }
  throw new Error("Invalid API response structure");
}

async function submitAddonRating(
  context: AddonStoreContext,
  request: AddonRatingRequest,
): Promise<unknown> {
  if (!Number.isInteger(request.rating) || request.rating < 1 || request.rating > 5) {
    throw new Error("Rating must be an integer between 1 and 5");
  }
  const body: Record<string, unknown> = { rating: request.rating };
  if (request.review !== undefined) {
    body.review = request.review;
  }
  const response = await context.fetchStore(
    `${context.storeBaseUrl}/${encodeURIComponent(request.addonId)}/ratings`,
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: addonStoreHeaders(context, {
        extraHeaders: { "Content-Type": "application/json" },
        requireInstanceId: true,
      }),
    },
  );
  if (!response.ok) {
    await safeResponseText(response);
    throw new Error(`Failed to submit rating: HTTP ${formatResponseStatus(response)}`);
  }
  return parseJsonText(await response.text(), "Rating submission API response");
}

async function fetchAddonRatings(context: AddonStoreContext, addonId: string): Promise<unknown[]> {
  const responseJson = await fetchAddonStoreJson<unknown>(
    context,
    `${context.storeBaseUrl}/${encodeURIComponent(addonId)}/ratings`,
    "Rating list",
    { requireInstanceId: true },
  );
  if (Array.isArray(responseJson)) {
    return responseJson;
  }
  if (!isRecord(responseJson)) {
    throw new Error("Invalid API response structure");
  }
  const ratings = responseJson.ratings;
  if (Array.isArray(ratings)) {
    return ratings;
  }
  if (ratings !== undefined) {
    throw new Error("'ratings' field is not an array in API response");
  }
  throw new Error("Invalid API response structure");
}

async function checkAddonUpdate(
  appDataDir: string,
  context: AddonStoreContext,
  addonId: string,
): Promise<unknown> {
  const addonDir = getAddonPath(appDataDir, addonId);
  const manifest = readManifestOrError(addonDir);
  return checkAddonUpdateFromApi(context, addonId, manifest.version);
}

async function checkAllAddonUpdates(
  appDataDir: string,
  context: AddonStoreContext,
): Promise<unknown[]> {
  const results: unknown[] = [];
  for (const addon of listInstalledAddons(appDataDir)) {
    const addonId = addon.metadata.id;
    try {
      results.push(await checkAddonUpdateFromApi(context, addonId, addon.metadata.version));
    } catch (error) {
      results.push({
        addonId,
        updateInfo: {
          currentVersion: addon.metadata.version,
          latestVersion: "unknown",
          updateAvailable: false,
          downloadUrl: null,
          releaseNotes: null,
          releaseDate: null,
          changelogUrl: null,
          isCritical: null,
          hasBreakingChanges: null,
          minWealthfolioVersion: null,
        },
        error: errorMessage(error),
      });
    }
  }
  return results;
}

async function checkAddonUpdateFromApi(
  context: AddonStoreContext,
  addonId: string,
  currentVersion: string,
): Promise<AddonUpdateCheckRecord> {
  const query = new URLSearchParams({ addonId, currentVersion });
  const responseJson = await fetchAddonStoreJson<unknown>(
    context,
    `${context.storeBaseUrl}/update-check?${query.toString()}`,
    "Update check",
    { requireInstanceId: true },
  );
  return parseAddonUpdateCheckResponse(responseJson);
}

function parseAddonUpdateCheckResponse(value: unknown): AddonUpdateCheckRecord {
  if (!isRecord(value)) {
    throw new Error("Invalid update check response structure");
  }
  const updateInfo = value.updateInfo;
  if (!isRecord(updateInfo)) {
    throw new Error("Invalid update check response structure");
  }
  return {
    addonId: requiredApiString(value.addonId, "addonId"),
    updateInfo: {
      currentVersion: requiredApiString(updateInfo.currentVersion, "updateInfo.currentVersion"),
      latestVersion: requiredApiString(updateInfo.latestVersion, "updateInfo.latestVersion"),
      updateAvailable: requiredApiBoolean(updateInfo.updateAvailable, "updateInfo.updateAvailable"),
      downloadUrl: optionalApiString(updateInfo.downloadUrl, "updateInfo.downloadUrl"),
      releaseNotes: optionalApiString(updateInfo.releaseNotes, "updateInfo.releaseNotes"),
      releaseDate: optionalApiString(updateInfo.releaseDate, "updateInfo.releaseDate"),
      changelogUrl: optionalApiString(updateInfo.changelogUrl, "updateInfo.changelogUrl"),
      isCritical: optionalApiBoolean(updateInfo.isCritical, "updateInfo.isCritical"),
      hasBreakingChanges: optionalApiBoolean(
        updateInfo.hasBreakingChanges,
        "updateInfo.hasBreakingChanges",
      ),
      minWealthfolioVersion: optionalApiString(
        updateInfo.minWealthfolioVersion,
        "updateInfo.minWealthfolioVersion",
      ),
    },
    error: optionalApiString(value.error, "error"),
  };
}

function requiredApiString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid update check response: ${field} must be a string`);
  }
  return value;
}

function requiredApiBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Invalid update check response: ${field} must be a boolean`);
  }
  return value;
}

function optionalApiString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`Invalid update check response: ${field} must be a string`);
  }
  return value;
}

function optionalApiBoolean(value: unknown, field: string): boolean | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "boolean") {
    throw new Error(`Invalid update check response: ${field} must be a boolean`);
  }
  return value;
}

async function updateAddonFromStore(
  appDataDir: string,
  context: AddonStoreContext,
  addonId: string,
): Promise<AddonManifestRecord> {
  const addonDir = getAddonPath(appDataDir, addonId);
  const wasEnabled = readManifestIfExists(addonDir)?.enabled ?? false;
  const zipData = await downloadAddonFromStore(context, addonId);
  const extracted = extractAddonZip(zipData);
  ensureAddonManifestMatchesRequest(extracted.metadata, addonId);

  if (existsSync(addonDir)) {
    rmSync(addonDir, { recursive: true, force: false });
  }
  mkdirSync(addonDir, { recursive: true });

  for (const file of extracted.files) {
    writeAddonArchiveFile(addonDir, file);
  }

  const installed = installManifest(extracted.metadata, wasEnabled);
  writeManifest(addonDir, installed);
  return installed;
}

async function downloadAddonFromStore(
  context: AddonStoreContext,
  addonId: string,
): Promise<Uint8Array> {
  const response = await context.fetchStore(
    `${context.storeBaseUrl}/${encodeURIComponent(addonId)}/download`,
    { headers: addonStoreHeaders(context, { requireInstanceId: true }) },
  );
  const contentType = response.headers.get("content-type") ?? "unknown";
  if (!response.ok) {
    const errorText = await safeResponseText(response);
    if (response.status === 404) {
      throw new Error("Addon not found or coming soon");
    }
    if (response.status === 410) {
      throw new Error("Addon is inactive or deprecated");
    }
    if (response.status === 503) {
      throw new Error("Download service temporarily unavailable");
    }
    throw new Error(`Download API returned error ${formatResponseStatus(response)}: ${errorText}`);
  }

  if (contentType.includes("application/json")) {
    const responseJson = parseJsonText(await response.text(), "download response");
    if (!isRecord(responseJson) || typeof responseJson.downloadUrl !== "string") {
      throw new Error("Download API response missing downloadUrl field");
    }
    return downloadAddonPackage(context, responseJson.downloadUrl);
  }

  return new Uint8Array(await response.arrayBuffer());
}

function ensureAddonManifestMatchesRequest(manifest: AddonManifestRecord, addonId: string): void {
  if (manifest.id !== addonId) {
    throw new Error(
      `Downloaded addon id '${manifest.id}' does not match requested addon '${addonId}'`,
    );
  }
}

async function downloadAddonPackage(
  context: AddonStoreContext,
  downloadUrl: string,
): Promise<Uint8Array> {
  const response = await context.fetchStore(downloadUrl, {
    headers: addonStoreHeaders(context, { requireInstanceId: false }),
  });
  if (!response.ok) {
    throw new Error(`Download failed with status: ${formatResponseStatus(response)}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function saveAddonToStaging(appDataDir: string, addonId: string, zipData: Uint8Array): void {
  validateAddonZipDataForStaging(zipData);
  const zipPath = getStagingZipPath(appDataDir, addonId);
  mkdirSync(path.dirname(zipPath), { recursive: true });
  writeFileSync(zipPath, zipData);
}

function validateAddonZipDataForStaging(zipData: Uint8Array): void {
  if (zipData.byteLength === 0) {
    throw new Error("Cannot stage empty addon data");
  }
  if (
    zipData.byteLength < 4 ||
    zipData[0] !== 0x50 ||
    zipData[1] !== 0x4b ||
    zipData[2] !== 0x03 ||
    zipData[3] !== 0x04
  ) {
    throw new Error(`Invalid ZIP data: missing ZIP signature (got ${zipData.byteLength} bytes)`);
  }
  try {
    unzipSync(zipData);
  } catch (error) {
    throw new Error(`Invalid ZIP data for staging: ${errorMessage(error)}`);
  }
}

async function fetchAddonStoreJson<T>(
  context: AddonStoreContext,
  url: string,
  operation: string,
  options: {
    body?: BodyInit;
    headers?: HeadersInit;
    method?: string;
    requireInstanceId?: boolean;
  } = {},
): Promise<T> {
  const response = await context.fetchStore(url, {
    method: options.method,
    body: options.body,
    headers: addonStoreHeaders(context, {
      extraHeaders: options.headers,
      requireInstanceId: options.requireInstanceId ?? false,
    }),
  });
  if (!response.ok) {
    const errorText = await safeResponseText(response);
    throw new Error(
      `${operation} API returned error ${formatResponseStatus(response)}: ${errorText}`,
    );
  }
  return parseJsonText(await response.text(), `${operation} API response`) as T;
}

function addonStoreHeaders(
  context: AddonStoreContext,
  options: { extraHeaders?: HeadersInit; requireInstanceId: boolean },
): Headers {
  const headers = new Headers(options.extraHeaders);
  headers.set(
    "User-Agent",
    context.appVersion ? `Wealthfolio/${context.appVersion}` : "Wealthfolio",
  );
  if (context.appVersion !== undefined) {
    headers.set("X-App-Version", context.appVersion);
  }
  const instanceId = resolveInstanceId(context.instanceId);
  if (options.requireInstanceId && instanceId !== undefined) {
    headers.set("X-Instance-Id", instanceId);
  }
  return headers;
}

function resolveInstanceId(
  instanceId: string | (() => string | undefined) | undefined,
): string | undefined {
  return typeof instanceId === "function" ? instanceId() : instanceId;
}

function normalizeStoreBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function parseJsonText(text: string, subject: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Failed to parse ${subject} as JSON: ${errorMessage(error)}`);
  }
}

async function safeResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function formatResponseStatus(response: Response): string {
  const reason =
    RUST_STATUS_REASON_OVERRIDES[response.status] ??
    STATUS_CODES[response.status] ??
    "<unknown status code>";
  return `${response.status} ${reason}`;
}

function ensureAddonsDirectory(appDataDir: string): string {
  const addonsDir = path.join(appDataDir, "addons");
  mkdirSync(addonsDir, { recursive: true });
  return addonsDir;
}

function getAddonPath(appDataDir: string, addonId: string): string {
  const addonsDir = ensureAddonsDirectory(appDataDir);
  const addonDir = path.resolve(addonsDir, addonId);
  if (!pathInside(addonDir, addonsDir)) {
    throw new Error(`Unsafe addon id '${addonId}'`);
  }
  return addonDir;
}

function getStagingPath(appDataDir: string, addonId?: string): string {
  const stagingDir = path.join(ensureAddonsDirectory(appDataDir), "staging");
  if (addonId === undefined) {
    return stagingDir;
  }
  return getStagingZipPath(appDataDir, addonId);
}

function getStagingZipPath(appDataDir: string, addonId: string): string {
  const stagingDir = path.join(ensureAddonsDirectory(appDataDir), "staging");
  const target = path.resolve(stagingDir, `${addonId}.zip`);
  if (!pathInside(target, stagingDir)) {
    throw new Error(`Unsafe addon id '${addonId}'`);
  }
  return target;
}

function pathInside(candidate: string, root: string): boolean {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedRoot = path.resolve(root);
  return (
    resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
  );
}

function readManifestIfExists(addonDir: string): AddonManifestRecord | null {
  const manifestPath = path.join(addonDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    return null;
  }
  const content = readFileSync(manifestPath, "utf8");
  try {
    return parseAddonManifest(JSON.parse(content));
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to parse manifest ${manifestPath}: ${error.message}`);
    }
    throw error;
  }
}

function readManifestOrError(addonDir: string): AddonManifestRecord {
  const manifest = readManifestIfExists(addonDir);
  if (!manifest) {
    throw new Error(`Addon manifest not found in ${addonDir}`);
  }
  return manifest;
}

function parseAddonManifest(value: unknown): AddonManifestRecord {
  if (!isRecord(value)) {
    throw new Error("manifest is not an object");
  }
  const id = requiredManifestString(value.id, "id");
  const name = requiredManifestString(value.name, "name");
  const version = requiredManifestString(value.version, "version");
  const main = requiredManifestString(value.main, "main");
  return {
    id,
    name,
    version,
    description: optionalManifestString(value.description),
    author: optionalManifestString(value.author),
    sdkVersion: optionalManifestString(value.sdkVersion),
    main,
    enabled: typeof value.enabled === "boolean" ? value.enabled : null,
    permissions: parseAddonPermissions(value.permissions),
    homepage: optionalManifestString(value.homepage),
    repository: optionalManifestString(value.repository),
    license: optionalManifestString(value.license),
    minWealthfolioVersion: optionalManifestString(value.minWealthfolioVersion),
    keywords: parseOptionalStringArray(value.keywords),
    icon: optionalManifestString(value.icon),
  };
}

function writeManifest(addonDir: string, manifest: AddonManifestRecord): void {
  writeFileSync(path.join(addonDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

function installManifest(
  manifest: AddonManifestRecord,
  enableAfterInstall: boolean,
): AddonManifestRecord {
  return {
    ...manifest,
    enabled: enableAfterInstall,
    installedAt: toRustUtcRfc3339(new Date()),
    source: "local",
  };
}

function toRustUtcRfc3339(date: Date): string {
  const iso = date.toISOString();
  if (iso.endsWith(".000Z")) {
    return `${iso.slice(0, -5)}+00:00`;
  }
  return iso.replace(/Z$/u, "+00:00");
}

function manifestEnabled(manifest: AddonManifestRecord): boolean {
  return manifest.enabled ?? true;
}

function manifestMain(manifest: AddonManifestRecord): string {
  return manifest.main;
}

function requiredManifestString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Missing '${field}' field in manifest.json`);
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new Error(`Missing '${field}' field in manifest.json`);
  }
  return trimmed;
}

function optionalManifestString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseOptionalStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value.filter((item): item is string => typeof item === "string");
}

function parseAddonPermissions(value: unknown): AddonPermissionRecord[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value.map((permission) => {
    if (!isRecord(permission)) {
      throw new Error("Missing 'category' field in permission");
    }
    const category = requiredPermissionString(permission.category, "category", "permission");
    const purpose = requiredPermissionString(permission.purpose, "purpose", "permission");
    if (!Array.isArray(permission.functions)) {
      throw new Error("Missing or invalid 'functions' field in permission");
    }
    return {
      category,
      functions: permission.functions.map(parseFunctionPermission),
      purpose,
    };
  });
}

function parseFunctionPermission(value: unknown): FunctionPermissionRecord {
  if (typeof value === "string") {
    return {
      name: requiredPermissionString(value, "name", "function permission"),
      isDeclared: true,
      isDetected: false,
      detectedAt: null,
    };
  }
  if (!isRecord(value)) {
    throw new Error("Missing 'name' field in function permission");
  }
  return {
    name: requiredPermissionString(value.name, "name", "function permission"),
    isDeclared: typeof value.isDeclared === "boolean" ? value.isDeclared : true,
    isDetected: typeof value.isDetected === "boolean" ? value.isDetected : false,
    detectedAt: optionalManifestString(value.detectedAt),
  };
}

function requiredPermissionString(value: unknown, field: string, subject: string): string {
  if (typeof value !== "string") {
    throw new Error(`Missing '${field}' field in ${subject}`);
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new Error(`Missing '${field}' field in ${subject}`);
  }
  return trimmed;
}

function validateAddonArchivePath(fileName: string): void {
  if (fileName === "") {
    throw new Error("Unsafe addon archive path: path is empty");
  }
  if (fileName.includes("\\")) {
    throw new Error(`Unsafe addon archive path '${fileName}': backslashes are not allowed`);
  }
  if (/^[A-Za-z]:/.test(fileName)) {
    throw new Error(
      `Unsafe addon archive path '${fileName}': Windows drive prefixes are not allowed`,
    );
  }
  if (path.posix.isAbsolute(fileName)) {
    throw new Error(`Unsafe addon archive path '${fileName}': absolute paths are not allowed`);
  }

  let hasNormalComponent = false;
  for (const component of fileName.split("/")) {
    if (component === "..") {
      throw new Error(`Unsafe addon archive path '${fileName}': parent traversal is not allowed`);
    }
    if (component === "" || component === ".") {
      throw new Error(`Unsafe addon archive path '${fileName}'`);
    }
    hasNormalComponent = true;
  }
  if (!hasNormalComponent) {
    throw new Error(`Unsafe addon archive path '${fileName}': no file components found`);
  }
}

function writeAddonArchiveFile(addonDir: string, file: AddonFileRecord): void {
  validateAddonArchivePath(file.name);
  const filePath = path.resolve(addonDir, file.name);
  if (!pathInside(filePath, addonDir)) {
    throw new Error(`Unsafe addon archive path '${file.name}': parent traversal is not allowed`);
  }
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, file.content);
}

function decodeAddonArchiveText(fileName: string, content: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch (error) {
    throw new Error(`Failed to read file ${fileName}: ${errorMessage(error)}`);
  }
}

function detectAddonPermissions(addonFiles: AddonFileRecord[]): AddonPermissionRecord[] {
  const detectedByCategory = new Map<string, Set<string>>();

  for (const file of addonFiles) {
    for (const [category, functions] of PERMISSION_PATTERNS) {
      for (const functionName of functions) {
        if (addonFileUsesFunction(file.content, category, functionName)) {
          const categoryFunctions = detectedByCategory.get(category) ?? new Set<string>();
          categoryFunctions.add(functionName);
          detectedByCategory.set(category, categoryFunctions);
        }
      }
    }
  }

  const detectedAt = new Date().toISOString();
  return Array.from(detectedByCategory.entries()).map(([category, functions]) => {
    const pattern = PERMISSION_PATTERNS.find(([candidate]) => candidate === category);
    return {
      category,
      functions: Array.from(functions)
        .sort((left, right) => left.localeCompare(right))
        .map((name) => ({
          name,
          isDeclared: false,
          isDetected: true,
          detectedAt,
        })),
      purpose: pattern?.[2] ?? `Access to ${category} functions`,
    };
  });
}

function addonFileUsesFunction(content: string, category: string, functionName: string): boolean {
  if (functionName.includes(".")) {
    const [namespace, method] = functionName.split(".");
    if (
      namespace &&
      method &&
      [`.${namespace}.${method}(`, `${namespace}.${method}(`, `ctx.${namespace}.${method}(`].some(
        (pattern) => content.includes(pattern),
      )
    ) {
      return true;
    }
  }

  const apiCategory = apiCategoryForPermission(category, functionName);
  const apiPatterns = [
    `api.${apiCategory}.${functionName}(`,
    `.api.${apiCategory}.${functionName}(`,
    `ctx.api.${apiCategory}.${functionName}(`,
  ];
  if (apiPatterns.some((pattern) => content.includes(pattern))) {
    return true;
  }

  if (category === "events") {
    const eventPatterns = [
      `ctx.api.events.import.${functionName}(`,
      `ctx.api.events.portfolio.${functionName}(`,
      `ctx.api.events.market.${functionName}(`,
      `api.events.import.${functionName}(`,
      `api.events.portfolio.${functionName}(`,
      `api.events.market.${functionName}(`,
    ];
    if (eventPatterns.some((pattern) => content.includes(pattern))) {
      return true;
    }
  }

  return category === "ui" && functionName === "onDisable" && content.includes("ctx.onDisable(");
}

function apiCategoryForPermission(category: string, functionName: string): string {
  if (category === "currency") {
    return "exchangeRates";
  }
  if (category === "financial-planning") {
    return functionName === "calculateDeposits" ? "contributionLimits" : "goals";
  }
  if (
    category === "market-data" &&
    (functionName === "getProfile" ||
      functionName === "updateProfile" ||
      functionName === "updateDataSource")
  ) {
    return "assets";
  }
  return category === "market-data" ? "market" : category;
}

function mergeAddonPermissions(
  declared: AddonPermissionRecord[] | null,
  detected: AddonPermissionRecord[],
): AddonPermissionRecord[] {
  const merged: AddonPermissionRecord[] = (declared ?? []).map((permission) => ({
    ...permission,
    functions: permission.functions.map((func) => ({ ...func })),
  }));

  for (const detectedPermission of detected) {
    const existing = merged.find(
      (permission) => permission.category === detectedPermission.category,
    );
    if (!existing) {
      merged.push(detectedPermission);
      continue;
    }
    for (const detectedFunction of detectedPermission.functions) {
      const existingFunction = existing.functions.find(
        (func) => func.name === detectedFunction.name,
      );
      if (existingFunction) {
        existingFunction.isDetected = true;
        existingFunction.detectedAt = detectedFunction.detectedAt;
      } else {
        existing.functions.push(detectedFunction);
      }
    }
  }

  return merged;
}

function readAddonFilesRecursive(
  currentDir: string,
  baseDir: string,
  files: AddonFileRecord[],
): void {
  for (const entry of readdirSync(currentDir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (entry.isSymbolicLink()) {
      continue;
    }
    const entryPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      readAddonFilesRecursive(entryPath, baseDir, files);
      continue;
    }
    if (!entry.isFile() || entry.name === "manifest.json") {
      continue;
    }
    files.push({
      name: normalizeAddonFilePath(path.relative(baseDir, entryPath)),
      content: readFileSync(entryPath, "utf8"),
      isMain: false,
    });
  }
}

function markRuntimeMainFile(files: AddonFileRecord[], normalizedMain: string): void {
  for (const file of files) {
    file.isMain = normalizeAddonFilePath(file.name) === normalizedMain;
  }
  if (files.some((file) => file.isMain)) {
    return;
  }

  const topLevelDirs = new Set(
    files
      .map((file) => normalizeAddonFilePath(file.name).split("/"))
      .filter((parts) => parts.length > 1)
      .map((parts) => parts[0]),
  );
  if (topLevelDirs.size !== 1) {
    return;
  }
  const [legacyPackageRoot] = [...topLevelDirs];
  const legacyMain = `${legacyPackageRoot}/${normalizedMain}`;
  for (const file of files) {
    file.isMain = normalizeAddonFilePath(file.name) === legacyMain;
  }
}

function normalizeAddonFilePath(value: string): string {
  return value.replaceAll(path.sep, "/");
}

function clearAddonStaging(appDataDir: string, addonId?: string): void {
  const stagingPath = getStagingPath(appDataDir, addonId);
  rmSync(stagingPath, { recursive: true, force: true });
  if (addonId === undefined) {
    mkdirSync(stagingPath, { recursive: true });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
