#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDir, "..");
const rendererDist = path.join(repositoryRoot, "dist");
const stagedRendererDist = path.join(repositoryRoot, "apps", "electron", "dist", "renderer");

if (!existsSync(path.join(rendererDist, "index.html"))) {
  throw new Error("Cannot stage Electron renderer: run the frontend Electron build first.");
}

mkdirSync(path.dirname(stagedRendererDist), { recursive: true });
rmSync(stagedRendererDist, { force: true, recursive: true });
cpSync(rendererDist, stagedRendererDist, { recursive: true });

console.log(`Staged Electron renderer at ${path.relative(repositoryRoot, stagedRendererDist)}`);
