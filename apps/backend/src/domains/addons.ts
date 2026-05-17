import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

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
}

interface AddonManifestRecord extends Record<string, unknown> {
  id: string;
  name: string;
  version: string;
  main?: string;
  enabled?: boolean;
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

export class AddonNotImplementedError extends Error {
  readonly status = 501;
  readonly code = "not_implemented";

  constructor(message: string) {
    super(message);
    this.name = "AddonNotImplementedError";
  }
}

const ADDON_ARCHIVE_DISABLED_MESSAGE =
  "Addon archive extraction and installation are not yet available in the TS backend runtime.";
const ADDON_STORE_DISABLED_MESSAGE =
  "Addon store HTTP and update operations are not yet available in the TS backend runtime.";

export function createLocalAddonService(options: LocalAddonServiceOptions): AddonService {
  const appDataDir = path.resolve(options.appDataDir);

  return {
    async listInstalledAddons() {
      return listInstalledAddons(appDataDir);
    },

    async installAddonZip() {
      throw archiveDisabled();
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

    async extractAddonZip() {
      throw archiveDisabled();
    },

    async fetchStoreListings() {
      throw storeDisabled();
    },

    async submitRating() {
      throw storeDisabled();
    },

    async checkAddonUpdate() {
      throw storeDisabled();
    },

    async checkAllAddonUpdates() {
      throw storeDisabled();
    },

    async updateAddonFromStore() {
      throw storeDisabled();
    },

    async downloadAddonToStaging() {
      throw storeDisabled();
    },

    async installAddonFromStaging() {
      throw archiveDisabled();
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
  for (const file of files) {
    const normalizedName = normalizeAddonFilePath(file.name);
    file.isMain = normalizedName === normalizedMain || normalizedName.endsWith(normalizedMain);
  }
  if (!files.some((file) => file.isMain)) {
    throw new Error("Main addon file not found");
  }

  return { metadata: manifest, files };
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
  const target = path.resolve(stagingDir, addonId);
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
  const id = value.id;
  const name = value.name;
  const version = value.version;
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error("manifest id must be a non-empty string");
  }
  if (typeof name !== "string" || name.trim() === "") {
    throw new Error("manifest name must be a non-empty string");
  }
  if (typeof version !== "string" || version.trim() === "") {
    throw new Error("manifest version must be a non-empty string");
  }
  if (value.main !== undefined && value.main !== null && typeof value.main !== "string") {
    throw new Error("manifest main must be a string when present");
  }
  if (value.enabled !== undefined && value.enabled !== null && typeof value.enabled !== "boolean") {
    throw new Error("manifest enabled must be a boolean when present");
  }
  return value as AddonManifestRecord;
}

function writeManifest(addonDir: string, manifest: AddonManifestRecord): void {
  writeFileSync(path.join(addonDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

function manifestEnabled(manifest: AddonManifestRecord): boolean {
  return manifest.enabled ?? true;
}

function manifestMain(manifest: AddonManifestRecord): string {
  if (!manifest.main) {
    throw new Error("Main file not specified");
  }
  return manifest.main;
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

function normalizeAddonFilePath(value: string): string {
  return value.replaceAll(path.sep, "/");
}

function clearAddonStaging(appDataDir: string, addonId?: string): void {
  const stagingPath = getStagingPath(appDataDir, addonId);
  rmSync(stagingPath, { recursive: true, force: true });
}

function archiveDisabled(): AddonNotImplementedError {
  return new AddonNotImplementedError(ADDON_ARCHIVE_DISABLED_MESSAGE);
}

function storeDisabled(): AddonNotImplementedError {
  return new AddonNotImplementedError(ADDON_STORE_DISABLED_MESSAGE);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
