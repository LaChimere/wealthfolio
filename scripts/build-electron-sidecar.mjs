#!/usr/bin/env node
import { spawn } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDir, "..");
const binaryName = process.platform === "win32" ? "wealthfolio-server.exe" : "wealthfolio-server";
const serverManifestPath = path.join(repositoryRoot, "apps", "server", "Cargo.toml");
const sourceBinaryPath = path.join(repositoryRoot, "target", "release", binaryName);
const sidecarOutputDir = path.join(repositoryRoot, "apps", "electron", "resources", "sidecars");
const sidecarOutputPath = path.join(sidecarOutputDir, binaryName);

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

await run("cargo", [
  "build",
  "--release",
  "--manifest-path",
  serverManifestPath,
  "--features",
  "keyring-backend",
]);

mkdirSync(sidecarOutputDir, { recursive: true });
rmSync(sidecarOutputPath, { force: true });
copyFileSync(sourceBinaryPath, sidecarOutputPath);
if (process.platform !== "win32") {
  chmodSync(sidecarOutputPath, 0o755);
}

console.log(`Staged Electron sidecar at ${path.relative(repositoryRoot, sidecarOutputPath)}`);
