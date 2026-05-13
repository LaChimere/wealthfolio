#!/usr/bin/env node
import { spawn } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDir, "..");
const serverManifestPath = path.join(repositoryRoot, "apps", "server", "Cargo.toml");
const sidecarOutputDir = path.join(repositoryRoot, "apps", "electron", "resources", "sidecars");
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
  const buildArgs = [
    "build",
    "--release",
    "--manifest-path",
    serverManifestPath,
    "--features",
    "keyring-backend",
  ];
  if (target) {
    buildArgs.push("--target", target);
  }

  await run("cargo", buildArgs);

  const sourceBinaryPath = target
    ? path.join(repositoryRoot, "target", target, "release", descriptor.binaryName)
    : path.join(repositoryRoot, "target", "release", descriptor.binaryName);
  const sidecarOutputPath = path.join(
    sidecarOutputDir,
    `${descriptor.platform}-${descriptor.arch}`,
    descriptor.binaryName,
  );

  mkdirSync(path.dirname(sidecarOutputPath), { recursive: true });
  rmSync(sidecarOutputPath, { force: true });
  copyFileSync(sourceBinaryPath, sidecarOutputPath);
  if (descriptor.platform !== "win32") {
    chmodSync(sidecarOutputPath, 0o755);
  }

  console.log(`Staged Electron sidecar at ${path.relative(repositoryRoot, sidecarOutputPath)}`);
}

function resolveTargetDescriptor(target) {
  if (!target) {
    const platform = process.platform;
    return {
      arch: normalizeArch(process.arch),
      binaryName: platform === "win32" ? "wealthfolio-server.exe" : "wealthfolio-server",
      platform,
    };
  }

  const platform = target.includes("windows")
    ? "win32"
    : target.includes("apple-darwin")
      ? "darwin"
      : target.includes("linux")
        ? "linux"
        : process.platform;
  const arch = target.startsWith("aarch64")
    ? "arm64"
    : target.startsWith("x86_64")
      ? "x64"
      : normalizeArch(process.arch);

  return {
    arch,
    binaryName: platform === "win32" ? "wealthfolio-server.exe" : "wealthfolio-server",
    platform,
  };
}

function normalizeArch(arch) {
  return arch === "x64" || arch === "arm64" ? arch : arch;
}
