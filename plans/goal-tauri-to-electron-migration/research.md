# Research

## Summary

Wealthfolio is currently a React/Vite frontend with adapter-based desktop/web runtime seams, a Tauri desktop shell that wires Rust services and SQLite storage, and an Axum web server that already exposes HTTP/SSE equivalents for many backend calls. The migration should preserve the Rust service graph and replace the Tauri shell, frontend Tauri adapter, packaging, and JS tooling incrementally.

## Current architecture evidence

- Root workspaces and scripts use pnpm and Tauri-oriented commands in `/Users/lachimere/Projects/wealthfolio/package.json`.
- The frontend package depends on `@tauri-apps/api`, Tauri plugins, React 19, Vite 7, Vitest 3, and TypeScript 5.9 in `/Users/lachimere/Projects/wealthfolio/apps/frontend/package.json`.
- Vite aliases `@/adapters` and `#platform` to either Tauri or web implementations based on `BUILD_TARGET`, defaulting to `tauri`, in `/Users/lachimere/Projects/wealthfolio/apps/frontend/vite.config.ts`.
- `/Users/lachimere/Projects/wealthfolio/apps/frontend/src/adapters/index.ts` documents that the alias chooses `tauri/index.ts` or `web/index.ts`.
- `/Users/lachimere/Projects/wealthfolio/apps/frontend/src/adapters/types.ts` defines the shared `RunEnvs.DESKTOP | WEB` contract.
- `/Users/lachimere/Projects/wealthfolio/apps/frontend/src/adapters/tauri/index.ts` and `/Users/lachimere/Projects/wealthfolio/apps/frontend/src/adapters/web/index.ts` export mostly identical domain APIs and platform-specific settings/addons/files/events/streaming implementations.
- `/Users/lachimere/Projects/wealthfolio/apps/frontend/src/adapters/tauri/core.ts` centralizes Tauri `invoke` and Tauri logging behind the shared `#platform` seam.
- `/Users/lachimere/Projects/wealthfolio/apps/frontend/src/adapters/web/core.ts` centralizes the HTTP command map and web `invoke` implementation.
- `/Users/lachimere/Projects/wealthfolio/apps/frontend/src/adapters/adapter-command-parity.test.ts` enforces web command map coverage and Tauri command registration coverage.
- `/Users/lachimere/Projects/wealthfolio/apps/tauri/src/lib.rs` is the Tauri entry point for plugins, app data dir resolution, context initialization, domain event queue worker, startup sync, periodic market sync, deep links, menu setup, and the large Tauri invoke handler.
- `/Users/lachimere/Projects/wealthfolio/apps/tauri/src/commands/mod.rs` shows the domain command modules used by Tauri.
- `/Users/lachimere/Projects/wealthfolio/apps/server/src/api/shared.rs` shows web-mode background job/event behavior that can inform Electron event bridging.
- `/Users/lachimere/Projects/wealthfolio/.github/workflows/pr-check.yml` and `/Users/lachimere/Projects/wealthfolio/.github/workflows/release.yml` assume pnpm, Tauri build actions, and Linux WebKit dependencies.

## Tauri-specific frontend surfaces

- `apps/frontend/src/adapters/tauri/core.ts`: `@tauri-apps/api/core` and `@tauri-apps/plugin-log`.
- `apps/frontend/src/adapters/tauri/events.ts`: Tauri event `listen` and file-drop/deep-link/domain event names.
- `apps/frontend/src/adapters/tauri/files.ts`: Tauri dialog/fs/shell plugins and iOS mobile share fallback.
- `apps/frontend/src/adapters/tauri/ai-streaming.ts`: Tauri `Channel` streaming.
- `apps/frontend/src/lockdown.ts`: Tauri window access.
- `apps/frontend/src/lib/settings-provider.tsx`: dynamic `@tauri-apps/api/window` usage.
- `apps/frontend/src/hooks/use-updater.ts`: Tauri event listening around updater flow.
- `apps/frontend/src/features/devices-sync/components/pairing-flow/enter-code.tsx`: dynamic barcode scanner import.
- `apps/frontend/src/pages/settings/addons/hooks/use-addon-actions.ts`: dynamic dialog/fs import.
- `apps/frontend/src/hooks/use-haptic-feedback.ts`: dynamic haptics import.
- Wealthfolio Connect web auth currently uses `tauri-plugin-web-auth-api` in the frontend and must be replaced by Electron/browser-safe OAuth handling.

## Tauri-specific backend surfaces

- Tauri runtime and plugins in `apps/tauri/src/lib.rs` and `apps/tauri/Cargo.toml` cover single-instance, log, shell, dialog, fs, deep-link, window-state, updater, barcode, haptics, web auth, and mobile share.
- Tauri menu handling lives in `/Users/lachimere/Projects/wealthfolio/apps/tauri/src/menu.rs`.
- Tauri updater flow lives in `/Users/lachimere/Projects/wealthfolio/apps/tauri/src/updater.rs`.
- Domain events are emitted from Rust to the UI through Tauri in `/Users/lachimere/Projects/wealthfolio/apps/tauri/src/events.rs` and domain event queue code under `/Users/lachimere/Projects/wealthfolio/apps/tauri/src/domain_events/`.
- Service initialization is centered in `/Users/lachimere/Projects/wealthfolio/apps/tauri/src/context/registry.rs` and `providers.rs`.
- SQLite uses an `app.db` under the app data directory, with backups under a backups folder, in `/Users/lachimere/Projects/wealthfolio/crates/storage-sqlite/src/db/mod.rs`.

## Tooling evidence

- Current root JS tooling is pnpm + ESLint + Prettier + TypeScript 5.9.3.
- Local installed Bun is `1.3.13`.
- Current npm latest checks returned Electron `42.0.1`, electron-builder `26.8.1`, TypeScript `6.0.3`, `@types/node` `25.7.0`, Biome `2.4.15`, and Lefthook `2.1.6`.
- `/Users/lachimere/Projects/volare/package.json` uses `packageManager: bun@1.3.13`, `typescript: ^6`, `@biomejs/biome`, Lefthook scripts, and Bun test scripts.
- `/Users/lachimere/Projects/volare/biome.json` uses Biome 2.4.13 with VCS integration, 2-space formatting, 100-column line width, single quotes, recommended lint rules, and organize imports.
- `/Users/lachimere/Projects/volare/lefthook.yml` runs `bun run check` and `bun run test:unit` in pre-commit.
- `/Users/lachimere/Projects/volare/tsconfig.json` uses strict TypeScript with bundler resolution and Bun types.

## Migration constraints

- Keep intermediate states mergeable: add Electron beside Tauri first, prove parity, then remove Tauri.
- Preserve frontend shared adapter contracts so most UI/features remain untouched.
- Preserve Rust service behavior and SQLite paths to avoid local data loss.
- Electron cannot cover mobile-only Tauri functionality; mobile-only code should be gated, removed, or documented as out of scope.
- CI/release migration must be staged because current workflows assume pnpm, Rust/Tauri, and Tauri release artifacts.
- TypeScript 6 must be adopted only after confirming repository package builds, Electron main/preload types, frontend types, and addon tooling compile.

## Decisions and open questions to resolve with evidence

- Chosen bridge direction: Electron should launch/manage a local loopback Rust sidecar based on the existing Axum server/service graph, with Electron preload/main providing the privileged desktop APIs. This avoids duplicating financial logic in TypeScript and reuses web-mode HTTP/SSE behavior.
- The sidecar must be configured for desktop data compatibility, not server defaults: `WF_DB_PATH` should point to the legacy desktop `app.db`, add-ons should live under the same legacy data root, and auth should use a per-run local token or equivalent loopback protection.
- Keyring continuity should be preserved by factoring Tauri's Rust keyring-backed `SecretStore` into a shared Rust surface used by the Electron sidecar desktop profile. The existing server file-backed `secrets.json` store is not acceptable for migrated desktop secrets unless an explicit migration is implemented.
- Data-dir compatibility requires pre-PR4 verification of Tauri `app_data_dir` on macOS, Windows, and Linux. Electron should set `userData` to the resolved legacy data root or pass that root directly to the sidecar before any database initialization.
- Open: exact Electron updater stack and feed format to replace Tauri signed update artifacts.
- Open: signing/notarization and release artifact parity for macOS, Windows, and Linux.
