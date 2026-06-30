#!/usr/bin/env node
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDir, "..");
const assetsRoot = path.resolve(
  repositoryRoot,
  process.argv[2] ?? "target/electron-release-assets",
);
const metadataNames = ["latest-mac.yml", "latest.yml", "latest-linux.yml"];

for (const metadataName of metadataNames) {
  const files = findFiles(assetsRoot, metadataName);
  if (files.length === 0) {
    continue;
  }

  const merged = mergeMetadata(files.map((file) => parseMetadata(readFileSync(file, "utf8"))));
  writeFileSync(path.join(assetsRoot, metadataName), serializeMetadata(merged));
}

function findFiles(root, filename) {
  const results = [];
  for (const entry of readdirSync(root)) {
    const fullPath = path.join(root, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...findFiles(fullPath, filename));
    } else if (entry === filename) {
      results.push(fullPath);
    }
  }
  return results;
}

function parseMetadata(content) {
  const metadata = { files: [] };
  let currentFile = null;

  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const fileMatch = line.match(/^  - ([^:]+):\s*(.*)$/);
    if (fileMatch) {
      currentFile = {};
      metadata.files.push(currentFile);
      currentFile[fileMatch[1]] = parseScalar(fileMatch[2]);
      continue;
    }
    const filePropertyMatch = line.match(/^    ([^:]+):\s*(.*)$/);
    if (filePropertyMatch && currentFile) {
      currentFile[filePropertyMatch[1]] = parseScalar(filePropertyMatch[2]);
      continue;
    }
    const propertyMatch = line.match(/^([^:]+):\s*(.*)$/);
    if (propertyMatch) {
      currentFile = null;
      if (propertyMatch[1] !== "files") {
        metadata[propertyMatch[1]] = parseScalar(propertyMatch[2]);
      }
    }
  }

  return metadata;
}

function mergeMetadata(items) {
  const [first] = items;
  const filesByUrl = new Map();
  for (const item of items) {
    for (const file of item.files) {
      filesByUrl.set(file.url, file);
    }
  }
  const files = [...filesByUrl.values()].sort((a, b) => String(a.url).localeCompare(String(b.url)));
  const primary = files[0];
  return {
    ...first,
    files,
    path: primary?.url ?? first.path,
    sha512: primary?.sha512 ?? first.sha512,
  };
}

function serializeMetadata(metadata) {
  const lines = [`version: ${metadata.version}`, "files:"];
  for (const file of metadata.files) {
    const entries = Object.entries(file);
    const [firstKey, firstValue] = entries[0];
    lines.push(`  - ${firstKey}: ${formatScalar(firstValue)}`);
    for (const [key, value] of entries.slice(1)) {
      lines.push(`    ${key}: ${formatScalar(value)}`);
    }
  }
  for (const key of ["path", "sha512", "releaseDate"]) {
    if (metadata[key] !== undefined) {
      lines.push(`${key}: ${formatScalar(metadata[key])}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function parseScalar(value) {
  if (/^\d+$/.test(value)) {
    return Number(value);
  }
  return value;
}

function formatScalar(value) {
  return String(value);
}
