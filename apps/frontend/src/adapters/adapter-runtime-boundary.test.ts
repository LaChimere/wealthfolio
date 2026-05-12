import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const frontendSrcDir = path.resolve(currentDir, "..");
const repoRoot = path.resolve(currentDir, "../../../..");
const tauriAdapterDir = path.join(frontendSrcDir, "adapters/tauri");

const TAURI_IMPORT_RE =
  /(?:from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"])/g;
const TAURI_SPECIFIER_RE = /^(@tauri-apps\/|tauri-plugin-)/;

const ALLOWED_NON_ADAPTER_TAURI_IMPORTS: Record<string, string[]> = {
  "apps/frontend/src/features/devices-sync/components/pairing-flow/enter-code.tsx": [
    "@tauri-apps/plugin-barcode-scanner",
  ],
  "apps/frontend/src/features/wealthfolio-connect/providers/wealthfolio-connect-provider.tsx": [
    "tauri-plugin-web-auth-api",
  ],
  "apps/frontend/src/hooks/use-haptic-feedback.ts": ["@tauri-apps/plugin-haptics"],
  "apps/frontend/src/hooks/use-updater.ts": ["@tauri-apps/api/event"],
  "apps/frontend/src/lib/settings-provider.tsx": ["@tauri-apps/api/window"],
  "apps/frontend/src/lockdown.ts": ["@tauri-apps/api/window"],
  "apps/frontend/src/pages/settings/addons/hooks/use-addon-actions.ts": [
    "@tauri-apps/plugin-dialog",
    "@tauri-apps/plugin-fs",
  ],
};

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return collectSourceFiles(entryPath);
    }
    return /\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.(ts|tsx)$/.test(entry.name)
      ? [entryPath]
      : [];
  });
}

function collectTauriImportsOutsideTauriAdapter(files: string[]): Record<string, string[]> {
  const importsByFile = new Map<string, Set<string>>();

  for (const file of files) {
    const relativeToTauriAdapter = path.relative(tauriAdapterDir, file);
    const isOutsideTauriAdapter =
      relativeToTauriAdapter === ".." ||
      relativeToTauriAdapter.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeToTauriAdapter);
    if (!isOutsideTauriAdapter) {
      continue;
    }

    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(TAURI_IMPORT_RE)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      if (!specifier || !TAURI_SPECIFIER_RE.test(specifier)) {
        continue;
      }

      const relativePath = path.relative(repoRoot, file).split(path.sep).join("/");
      const imports = importsByFile.get(relativePath) ?? new Set<string>();
      imports.add(specifier);
      importsByFile.set(relativePath, imports);
    }
  }

  return Object.fromEntries(
    [...importsByFile.entries()]
      .map(([file, imports]) => [file, [...imports].sort()] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

describe("adapter runtime boundary", () => {
  it("keeps non-adapter Tauri imports explicit for the Electron migration", () => {
    const actual = collectTauriImportsOutsideTauriAdapter(collectSourceFiles(frontendSrcDir));

    expect(actual).toEqual(ALLOWED_NON_ADAPTER_TAURI_IMPORTS);
  });
});
