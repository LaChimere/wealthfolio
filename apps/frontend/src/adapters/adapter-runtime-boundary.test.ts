import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const frontendSrcDir = path.resolve(currentDir, "..");
const repoRoot = path.resolve(currentDir, "../../../..");
const tauriAdapterDir = path.join(frontendSrcDir, "adapters/tauri");
const electronAdapterDir = path.join(frontendSrcDir, "adapters/electron");

const IMPORT_RE =
  /(?:from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"])/g;
const TAURI_SPECIFIER_RE = /^(@tauri-apps\/|tauri-plugin-|@\/adapters\/tauri(?:\/|$)|#platform$)/;
const ELECTRON_SPECIFIER_RE = /^@wealthfolio\/electron(?:\/|$)/;

const ALLOWED_NON_ADAPTER_TAURI_IMPORTS: Record<string, string[]> = {
  "apps/frontend/src/adapters/shared/platform.ts": ["#platform"],
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
};

const ALLOWED_NON_ADAPTER_ELECTRON_IMPORTS: Record<string, string[]> = {
  "apps/frontend/src/types/global.d.ts": ["@wealthfolio/electron/shared/ipc"],
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

function collectImportsOutsideAdapter(
  files: string[],
  adapterDir: string,
  specifierRe: RegExp,
): Record<string, string[]> {
  const importsByFile = new Map<string, Set<string>>();

  for (const file of files) {
    const relativeToAdapter = path.relative(adapterDir, file);
    const isOutsideAdapter =
      relativeToAdapter === ".." ||
      relativeToAdapter.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeToAdapter);
    if (!isOutsideAdapter) {
      continue;
    }

    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(IMPORT_RE)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      if (!specifier || !specifierRe.test(specifier)) {
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
    const actual = collectImportsOutsideAdapter(
      collectSourceFiles(frontendSrcDir),
      tauriAdapterDir,
      TAURI_SPECIFIER_RE,
    );

    expect(actual).toEqual(ALLOWED_NON_ADAPTER_TAURI_IMPORTS);
  });

  it("keeps Electron IPC imports inside the Electron adapter seam", () => {
    const actual = collectImportsOutsideAdapter(
      collectSourceFiles(frontendSrcDir),
      electronAdapterDir,
      ELECTRON_SPECIFIER_RE,
    );

    expect(actual).toEqual(ALLOWED_NON_ADAPTER_ELECTRON_IMPORTS);
  });
});
