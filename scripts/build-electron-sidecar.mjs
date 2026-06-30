#!/usr/bin/env node
import { spawn } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDir, "..");
const backendEntryPath = path.join(repositoryRoot, "apps", "backend", "src", "main.ts");
const sidecarOutputDir = path.join(repositoryRoot, "apps", "electron", "resources", "sidecars");
const sidecarBinaryBaseName = "wealthfolio-backend";
const sidecarAssetsDirName = "backend-assets";
const packageVersion = readPackageVersion();
const requestedTargets = parseTargets(process.env.WF_ELECTRON_SIDECAR_TARGETS);
const legacyTarget = process.env.WF_ELECTRON_SIDECAR_TARGET;
const targets = requestedTargets.length > 0 ? requestedTargets : [legacyTarget || undefined];

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: process.env,
      shell: false,
      stdio: "inherit",
      ...options,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} failed with ${signal ?? `exit code ${code}`}`));
    });
  });
}

for (const target of targets) {
  await buildAndStageSidecar(target);
}

function parseTargets(value) {
  return value
    ? value
        .split(/[,\s]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

async function buildAndStageSidecar(target) {
  const descriptor = resolveTargetDescriptor(target);
  const targetOutputDir = path.join(sidecarOutputDir, `${descriptor.platform}-${descriptor.arch}`);
  const sidecarOutputPath = path.join(targetOutputDir, descriptor.binaryName);
  rmSync(targetOutputDir, { force: true, recursive: true });
  mkdirSync(targetOutputDir, { recursive: true });

  const buildArgs = [
    "build",
    backendEntryPath,
    "--compile",
    `--target=${descriptor.bunTarget}`,
    "--define",
    `WF_COMPILED_APP_VERSION="${packageVersion}"`,
    "--outfile",
    sidecarOutputPath,
  ];
  if (descriptor.platform === "win32") {
    buildArgs.push("--windows-hide-console");
  }

  const bunBuildArtifactsBefore = listBunBuildArtifacts();
  try {
    await run("bun", buildArgs);
  } finally {
    cleanupNewBunBuildArtifacts(bunBuildArtifactsBefore);
  }
  if (descriptor.platform !== "win32") {
    chmodSync(sidecarOutputPath, 0o755);
  }
  stageBackendAssets(targetOutputDir, descriptor);

  if (shouldSmokeTest(descriptor)) {
    await smokeTestSidecar(sidecarOutputPath, path.join(targetOutputDir, sidecarAssetsDirName));
  }

  console.log(`Staged Electron TS backend at ${path.relative(repositoryRoot, sidecarOutputPath)}`);
}

function stageBackendAssets(targetOutputDir, descriptor) {
  const assetsOutputDir = path.join(targetOutputDir, sidecarAssetsDirName);
  rmSync(assetsOutputDir, { force: true, recursive: true });
  mkdirSync(assetsOutputDir, { recursive: true });
  cpSync(
    path.join(repositoryRoot, "crates/storage-sqlite/migrations"),
    path.join(assetsOutputDir, "migrations"),
    {
      recursive: true,
    },
  );
  copyFileSync(
    path.join(repositoryRoot, "crates/market-data/src/resolver/exchanges.json"),
    path.join(assetsOutputDir, "exchanges.json"),
  );
  copyFileSync(
    path.join(repositoryRoot, "crates/ai/src/ai_providers.json"),
    path.join(assetsOutputDir, "ai_providers.json"),
  );
  const nativeOutputDir = path.join(assetsOutputDir, "native");
  mkdirSync(nativeOutputDir, { recursive: true });
  copyFileSync(
    resolveKeyringNativeBindingPath(descriptor),
    path.join(nativeOutputDir, "keyring.node"),
  );
}

async function smokeTestSidecar(sidecarPath, assetsPath) {
  const tempDir = mkdtempSync(path.join(tmpdir(), "wealthfolio-electron-sidecar-smoke-"));
  const sidecarToken = Buffer.from("electron-sidecar-smoke-token").toString("base64url");
  const child = spawn(sidecarPath, [], {
    cwd: path.dirname(sidecarPath),
    env: {
      ...process.env,
      WF_AI_PROVIDER_CATALOG_PATH: path.join(assetsPath, "ai_providers.json"),
      WF_AUTH_REQUIRED: "false",
      WF_DB_PATH: path.join(tempDir, "app.db"),
      WF_EXCHANGE_CATALOG_PATH: path.join(assetsPath, "exchanges.json"),
      WF_LISTEN_ADDR: "127.0.0.1:0",
      WF_MIGRATIONS_DIR: path.join(assetsPath, "migrations"),
      WF_APP_VERSION: packageVersion,
      WF_SECRET_BACKEND: "keyring",
      WF_SECRET_KEY: Buffer.alloc(32).toString("base64"),
      WF_SIDECAR_TOKEN: sidecarToken,
      NAPI_RS_NATIVE_LIBRARY_PATH: path.join(assetsPath, "native", "keyring.node"),
    },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let spawnError;
  child.on("error", (error) => {
    spawnError = error;
  });
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  try {
    const baseUrl = await waitForSidecarUrl(
      child,
      () => stdout,
      () => spawnError,
    );
    await assertHttpStatus(`${baseUrl}/api/v1/readyz`, 200);
    const authHeaders = { authorization: `Bearer ${sidecarToken}` };
    const appInfoResponse = await assertHttpStatus(`${baseUrl}/api/v1/app/info`, 200, authHeaders);
    const appInfo = await appInfoResponse.json();
    if (appInfo.version !== packageVersion) {
      throw new Error(`Compiled backend app info returned version ${appInfo.version}`);
    }
    await assertHttpStatus(`${baseUrl}/api/v1/ai/providers`, 200, authHeaders);
  } catch (error) {
    throw new Error(
      `Compiled Electron TS backend smoke test failed: ${errorMessage(error)}\n${stdout}\n${stderr}`,
    );
  } finally {
    child.kill("SIGTERM");
    await waitForExit(child);
    rmSync(tempDir, { force: true, recursive: true });
  }

  async function assertHttpStatus(url, expectedStatus, headers = {}) {
    const response = await fetch(url, { headers });
    if (response.status !== expectedStatus) {
      throw new Error(`${url} returned HTTP ${response.status}; expected ${expectedStatus}`);
    }
    return response;
  }
}

async function waitForSidecarUrl(child, stdout, spawnError) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const error = spawnError();
    if (error) {
      throw error;
    }
    const match = stdout().match(/Wealthfolio TS backend listening on (http:\/\/[^\s]+)/);
    if (match) {
      return match[1];
    }
    if (child.exitCode !== null) {
      throw new Error(`compiled backend exited with code ${child.exitCode}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("timed out waiting for compiled backend startup");
}

function listBunBuildArtifacts() {
  return new Set(
    readdirSync(repositoryRoot).filter((entry) =>
      /^\.[0-9a-f]+-[0-9a-f]+\.bun-build$/i.test(entry),
    ),
  );
}

function cleanupNewBunBuildArtifacts(previousArtifacts) {
  for (const artifact of listBunBuildArtifacts()) {
    if (!previousArtifacts.has(artifact)) {
      unlinkSync(path.join(repositoryRoot, artifact));
    }
  }
}

function readPackageVersion() {
  const packageJson = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
  if (typeof packageJson.version !== "string" || !packageJson.version.trim()) {
    throw new Error("package.json must contain a non-empty version.");
  }
  return packageJson.version.trim();
}

function resolveKeyringNativeBindingPath(descriptor) {
  const native = keyringNativeBindingDescriptor(descriptor);
  const directPath = path.join(repositoryRoot, "node_modules", native.packageName, native.fileName);
  if (fileExists(directPath)) {
    return directPath;
  }

  const bunStoreDir = path.join(repositoryRoot, "node_modules", ".bun");
  for (const entry of readdirSync(bunStoreDir)) {
    const candidate = path.join(
      bunStoreDir,
      entry,
      "node_modules",
      native.packageName,
      native.fileName,
    );
    if (fileExists(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Missing ${native.packageName}/${native.fileName}; install dependencies for ${descriptor.platform}-${descriptor.arch} before building the Electron backend sidecar.`,
  );
}

function keyringNativeBindingDescriptor(descriptor) {
  if (descriptor.platform === "darwin") {
    return {
      packageName: `@napi-rs/keyring-darwin-${descriptor.arch}`,
      fileName: `keyring.darwin-${descriptor.arch}.node`,
    };
  }
  if (descriptor.platform === "win32") {
    return {
      packageName: `@napi-rs/keyring-win32-${descriptor.arch}-msvc`,
      fileName: `keyring.win32-${descriptor.arch}-msvc.node`,
    };
  }
  if (descriptor.platform === "linux") {
    return {
      packageName: `@napi-rs/keyring-linux-${descriptor.arch}-gnu`,
      fileName: `keyring.linux-${descriptor.arch}-gnu.node`,
    };
  }
  throw new Error(`Unsupported keyring native binding platform "${descriptor.platform}".`);
}

function fileExists(filePath) {
  return existsSync(filePath);
}

function waitForExit(child) {
  if (child.pid === undefined) {
    return Promise.resolve();
  }
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => child.once("exit", resolve));
}

function shouldSmokeTest(descriptor) {
  if (process.env.WF_ELECTRON_SIDECAR_SMOKE === "false") {
    return false;
  }
  return (
    descriptor.platform === process.platform && descriptor.arch === normalizeArch(process.arch)
  );
}

function resolveTargetDescriptor(target) {
  if (!target) {
    return descriptorFor(process.platform, normalizeArch(process.arch));
  }

  const normalized = target.trim();
  const bunTarget = normalized.match(/^bun-(darwin|linux|windows)-(x64|arm64)(?:-.+)?$/);
  if (bunTarget) {
    return descriptorFor(bunPlatformToNodePlatform(bunTarget[1]), bunTarget[2], normalized);
  }

  throw new Error(`Unsupported Electron TS backend target "${target}".`);
}

function descriptorFor(
  platform,
  arch,
  bunTarget = `bun-${nodePlatformToBunPlatform(platform)}-${arch}`,
) {
  return {
    arch,
    binaryName: platform === "win32" ? `${sidecarBinaryBaseName}.exe` : sidecarBinaryBaseName,
    bunTarget,
    platform,
  };
}

function nodePlatformToBunPlatform(platform) {
  if (platform === "win32") {
    return "windows";
  }
  if (platform === "darwin" || platform === "linux") {
    return platform;
  }
  throw new Error(`Unsupported Electron TS backend platform "${platform}".`);
}

function bunPlatformToNodePlatform(platform) {
  return platform === "windows" ? "win32" : platform;
}

function normalizeArch(arch) {
  return arch === "x64" || arch === "arm64" ? arch : arch;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
