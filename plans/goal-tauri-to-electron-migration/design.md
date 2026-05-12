# Design

## Feature summary

Migrate Wealthfolio desktop from Tauri to Electron while preserving the frontend adapter contract, Rust-backed business behavior, local data safety, web mode, and release quality. The split starts with contracts/tooling and a side-by-side Electron shell so each PR remains mergeable before the Tauri path is removed.

## Design posture

- Prefer an adapter-preserving migration over a rewrite: the existing `@/adapters` and `#platform` aliases are the best seam.
- Prefer reusing Rust core/storage/web-server behavior over duplicating financial logic in TypeScript.
- Prefer side-by-side Electron/Tauri support during migration, then remove Tauri only after Electron parity is verified.
- Prefer Bun/Biome/Lefthook migration in small steps to avoid mixing runtime migration with broad formatting churn.
- Treat documentation updates as part of each slice because the user granted standing approval.

## Core architecture decisions

### Rust bridge

Use a managed local Rust sidecar for Electron, based on the existing Axum server and Rust service graph. Electron main owns process lifecycle and privileged desktop features; the renderer talks only to the secure preload API. Main/preload forward domain commands to the local sidecar using the existing command-map semantics, and domain events flow back through SSE or an equivalent main-mediated event bridge.

The sidecar is not the current `apps/server` binary as-is. It needs an explicit desktop profile/startup builder for loopback-only auth, legacy data root, Rust keyring secrets, add-on root, domain events, and lifecycle behavior.

Rejected alternatives:

- **Rewrite financial/domain logic in TypeScript**: rejected because it duplicates tested Rust behavior and increases migration risk.
- **Native Node/N-API bindings for the full Rust command surface first**: rejected as a higher-complexity bridge that would require rebuilding most command registration and async/event plumbing before Electron can run.
- **Renderer fetches an unauthenticated loopback server directly**: rejected because Electron should keep backend coordinates/tokens in main/preload and avoid exposing privileged channels directly to renderer code.

### Desktop data root

Electron must preserve the legacy Tauri desktop data root. Before the Electron scaffold initializes app state, Electron main should resolve the existing Tauri `app_data_dir` path for the app identifier `com.teymz.wealthfolio`, set or pass that root as the desktop data directory, and configure the sidecar with an explicit database path under that root. PR 4 must not let Electron's default `app.getPath('userData')` create a divergent `Wealthfolio` data directory without a migration.

The exact OS paths and the sidecar/keyring/updater/OAuth decisions are documented in `/Users/lachimere/Projects/wealthfolio/docs/architecture/electron-migration.md`. PR 6 must add a test or smoke check that Electron points at the same `app.db` and backups root before any user data migration is attempted.

### Secrets/keyring

Desktop secrets must continue to use the Rust `keyring` crate namespace established by Tauri's `KeyringSecretStore` (`format_service_id(service)` + username `default`). The Electron sidecar desktop profile should use a shared Rust keyring-backed `SecretStore`; the existing server `secrets.json` store is for web/server mode and must not silently replace desktop keyring storage.

The keyring implementation should be factored out of `apps/tauri` into a shared crate or shared Rust module used by the desktop sidecar. The sidecar must not depend on `apps/tauri`.

### Local sidecar security

The sidecar should bind to loopback on an ephemeral or configured local port and require a per-run secret/token supplied by Electron main. CORS should be restricted to the Electron origin/dev server. Renderer code should call preload IPC rather than storing backend tokens or base URLs in app state.

### Updater/signing

Electron release work must choose an Electron update stack and feed format explicitly. Tauri's signed update metadata is not compatible with Electron updater metadata, so PR 8 must define the new update channel, metadata format, signing/notarization flow, and rollback strategy before replacing release workflows.

### OAuth/deep links

Desktop OAuth should be redesigned around Electron-supported flows: prefer external-browser login with a custom protocol/deep-link callback or a loopback callback managed by main, then forward completion events through the existing adapter event names. This replaces `tauri-plugin-web-auth-api` and must be validated before removing the Tauri path.

## PR sequence

### PR 1: Migration state and guardrails

- **Goal**: Record architecture research, migration contracts, and the first set of automated guardrails without changing runtime behavior.
- **Likely directories/files**: `plans/goal-tauri-to-electron-migration/*`, `apps/frontend/src/adapters/adapter-command-parity.test.ts`, docs if needed.
- **Dependencies**: None.
- **Allowed changes**: Planning artifacts, tests that document current command/event/file adapter contracts, non-runtime docs.
- **Prohibited changes**: Dependency manager switch, Electron runtime, Tauri removal, behavior changes.
- **Acceptance criteria**:
  - Goal, research, design, plan, and todo artifacts exist and reflect current evidence.
  - Existing frontend tests and adapter parity tests still pass without adding Electron-only expectations before an Electron adapter exists.
  - No application runtime behavior changes.
- **Validation commands**: `pnpm --filter frontend test adapter-command-parity.test.ts`, `git diff --check`.
- **Mergeability notes**: Safe to merge alone because it only adds planning/guardrail assets.

### PR 2: Bun/Biome/Lefthook baseline without runtime migration

- **Goal**: Introduce Bun as the JS package manager and add Biome/Lefthook conventions while preserving existing frontend/web/Tauri behavior.
- **Likely directories/files**: `package.json`, `bun.lock`, `biome.json`, `lefthook.yml`, `tsconfig*.json`, workspace package scripts, CI check workflow, docs/AGENTS run targets.
- **Dependencies**: PR 1.
- **Allowed changes**: Add `packageManager`, convert scripts from `pnpm` to `bun` where supported, keep temporary pnpm compatibility only if necessary, add Biome in a low-churn configuration, update lockfile, update docs. If Biome causes broad formatting churn, split formatter adoption into a separate atomic commit/PR after the Bun install path is proven.
- **Prohibited changes**: Electron runtime, Tauri removal, broad formatting-only rewrites unless required for Biome adoption.
- **Acceptance criteria**:
  - `bun install` succeeds and creates/updates the committed Bun lockfile.
  - Existing side-by-side Tauri commands still work through Bun or have a documented temporary compatibility command before Electron parity lands.
  - Existing TypeScript, lint/format, and unit test flows work through Bun scripts.
  - Lefthook can install/run the configured pre-commit checks.
  - CI uses Bun for JS dependency installation/checks without weakening Rust checks.
  - Legacy pnpm lockfile handling is explicit: either remove `pnpm-lock.yaml` in the same atomic change or add a temporary CI/check guard so Bun and pnpm lockfiles cannot silently drift.
- **Validation commands**: `bun install`, `bun run check`, `bun run test`, `bun tauri --version` or equivalent Tauri CLI compatibility check while Tauri remains, `cargo test --workspace`.
- **Mergeability notes**: This PR may keep legacy `pnpm` scripts temporarily if needed for release continuity, but Bun must be the documented path.

### PR 3: TypeScript 6 compatibility

- **Goal**: Upgrade TypeScript to 6 and fix strict typing incompatibilities across frontend, packages, addons, and Electron-ready build configs.
- **Likely directories/files**: Root and workspace `package.json`, `tsconfig*.json`, TypeScript source files exposed by compiler errors.
- **Dependencies**: PR 2.
- **Allowed changes**: TypeScript dependency upgrade, compiler config updates, type-only fixes, test updates for type changes.
- **Prohibited changes**: Runtime behavior changes, Electron runtime implementation, large refactors unrelated to compiler compatibility.
- **Acceptance criteria**:
  - Pre-flight compatibility is captured for Vite, Vitest, React 19 types, Electron types, Tauri types retained during side-by-side migration, workspace packages, and addon tooling.
  - Electron and repository tooling resolve TypeScript 6-compatible types.
  - Frontend, packages, addons, and root project references type-check.
  - Type-only fixes do not change runtime behavior.
- **Validation commands**: `bun run type-check`, `bun run build:types`, targeted package/addon type checks.
- **Mergeability notes**: Safe after all type checks pass; if a dependency blocks TS 6, record the blocker and pin the latest compatible version.

### PR 4: Electron shell scaffold

- **Goal**: Add an Electron main/preload process and desktop dev/build scripts that can host the existing Vite frontend without replacing Tauri yet.
- **Likely directories/files**: `apps/electron/`, root scripts, Electron tsconfig, Vite aliases for `BUILD_TARGET=electron`, package dependencies.
- **Dependencies**: PR 2; ideally PR 3.
- **Allowed changes**: Electron app scaffold, secure preload bridge skeleton, CSP/security defaults, dev server integration, native menu/window setup, docs.
- **Prohibited changes**: Removing Tauri, wiring financial commands through untyped IPC, disabling web mode.
- **Acceptance criteria**:
  - Root workspace config includes `apps/electron`.
  - Electron dev window loads the existing frontend.
  - Preload exposes only a minimal typed API surface.
  - Electron data-root initialization follows the legacy Tauri data-dir decision and does not initialize a divergent default data directory.
  - Tauri and web builds still compile.
- **Validation commands**: `bun run dev:electron` smoke check, `bun run build:electron`, `bun run type-check`, `bun run test`.
- **Mergeability notes**: Side-by-side scaffold is mergeable because the default desktop runtime can remain Tauri until parity lands.

### PR 5: Electron adapter and IPC contract

- **Goal**: Implement `apps/frontend/src/adapters/electron` and an Electron IPC command registry that preserves the shared adapter API and proves at least one real end-to-end command through the sidecar skeleton.
- **Likely directories/files**: `apps/frontend/src/adapters/electron/*`, `apps/electron/src/preload/*`, `apps/electron/src/main/ipc/*`, parity tests.
- **Dependencies**: PR 4.
- **Allowed changes**: Add Electron `invoke`, logger, events, files, settings, addons, AI streaming abstractions; expand parity tests to compare Electron/web/Tauri while Tauri remains; include one real safe command path such as app info or platform info to avoid stub-only parity.
- **Prohibited changes**: Business logic duplication, direct Node APIs in renderer, Tauri removal.
- **Acceptance criteria**:
  - `BUILD_TARGET=electron` resolves `@/adapters` and `#platform` to Electron implementations.
  - Adapter parity tests enforce command coverage for Electron IPC.
  - At least one real command completes through Electron renderer -> preload -> main -> sidecar or bridge.
  - Renderer has no direct access to privileged Node/Electron APIs outside preload.
- **Validation commands**: `bun run test -- adapter-command-parity`, `bun run type-check`, Electron smoke tests.
- **Mergeability notes**: Mergeable with incomplete command coverage only if the Electron target is clearly experimental and parity tests enumerate the remaining commands instead of passing vacuously.

### PR 6: Rust service reuse for Electron desktop

- **Goal**: Connect Electron IPC to the existing Rust service behavior with data-dir-compatible SQLite and background event streaming.
- **Likely directories/files**: `apps/server`, `apps/electron`, Rust app/server shared startup code, command registry, event bridge tests.
- **Dependencies**: PR 5.
- **Allowed changes**: Factor reusable Rust service startup from Tauri/server, extract a desktop sidecar profile/startup builder, factor shared Rust keyring secret storage out of Tauri, spawn or embed local backend for Electron, align app data dir, route commands and SSE/events, tests.
- **Prohibited changes**: Reimplementing financial calculations in TypeScript, changing DB schema without migration, silently moving user data.
- **Acceptance criteria**:
  - Electron desktop reads/writes the same logical app data location or performs an explicit tested migration.
  - The desktop sidecar uses shared keyring secrets instead of server `secrets.json`.
  - The sidecar binds loopback with per-run auth and does not expose backend coordinates or tokens directly to renderer code.
  - Core command flows work through Electron IPC/local backend.
  - Domain events reach the renderer with the existing event names.
- **Validation commands**: Rust tests, Electron integration tests, adapter parity tests, database path/migration tests.
- **Mergeability notes**: Keep Tauri until the Electron path covers the core command surface.

### PR 7: Native desktop feature parity

- **Goal**: Replace Tauri plugins with Electron equivalents for menu, file dialogs, shell, updater, deep links, single instance, window state, logging, add-ons, and OAuth.
- **Likely directories/files**: Electron main/preload modules, frontend platform-specific hooks, settings/addons/connect docs/tests.
- **Dependencies**: PR 6.
- **Allowed changes**: Electron menu/events, updater stack, protocol/deep-link handling, file save/open, external browser, logging, OAuth callback flow, E2E/UI tests.
- **Prohibited changes**: Mobile-only Tauri feature porting unless needed for desktop, unrelated UI redesign.
- **Acceptance criteria**:
  - Existing desktop UX flows have Electron equivalents or documented desktop-safe replacements.
  - Update/deep-link/file dialog/shell/addon/OAuth paths are covered by targeted tests or reproducible smoke checks.
  - Web mode remains unaffected.
- **Validation commands**: Electron UI/e2e smoke tests, targeted unit tests, `bun run test`, `cargo test --workspace`.
- **Mergeability notes**: This is the main parity gate before making Electron the default.

### PR 8: Electron packaging and release

- **Goal**: Replace Tauri release packaging with Electron packaging/signing/update artifacts while retaining server prebuild release behavior.
- **Likely directories/files**: `electron-builder` config, `.github/workflows/*`, packaging docs, updater metadata handling.
- **Dependencies**: PR 7.
- **Allowed changes**: Electron-builder config, CI matrix, signing/notarization wiring, artifact naming, update feed docs, Linux/Windows/macOS package checks.
- **Prohibited changes**: Weakening CI verification, removing standalone server prebuild unless explicitly replaced.
- **Acceptance criteria**:
  - Update channel/feed/signature format is documented and no longer depends on Tauri `latest.json` semantics.
  - macOS signing/notarization, Windows signing/installer, and Linux packaging expectations are documented or covered by CI.
  - CI can build Electron artifacts for supported desktop platforms.
  - Release workflow no longer depends on Tauri action for desktop app artifacts.
  - Server prebuild workflow still produces the standalone server tarball.
- **Validation commands**: platform build checks where feasible, CI dry-run equivalents, `bun run build:electron`.
- **Mergeability notes**: Can merge before Tauri cleanup if release still publishes both or Electron artifacts are clearly marked.

### PR 9: Tauri removal and documentation cleanup

- **Goal**: Remove Tauri runtime, dependencies, scripts, docs, and stale architecture references after Electron is the verified desktop runtime.
- **Likely directories/files**: `apps/tauri`, root/workspace dependencies, frontend Tauri adapter, docs, AGENTS, CI/release workflows.
- **Dependencies**: PR 8.
- **Allowed changes**: Delete Tauri-only code, remove Tauri dependencies/config, rename runtime terminology from Tauri to Electron/desktop where appropriate.
- **Prohibited changes**: Removing Rust core/server/storage code still used by Electron or web mode.
- **Acceptance criteria**:
  - No production code imports `@tauri-apps/*` or Tauri plugins.
  - Docs and run targets describe Electron/Bun accurately.
  - Electron desktop and web mode checks pass.
- **Validation commands**: `rg "@tauri-apps|tauri-plugin|Tauri|tauri"`, `bun run check`, `bun run test`, `cargo test --workspace`, Electron package/build checks.
- **Mergeability notes**: Final cleanup only after all parity evidence is recorded.

## Parallelization readiness

- PRs 1-5 should be mostly serial because they define shared contracts and build seams.
- After PR 5, Rust service reuse (PR 6), native feature parity (parts of PR 7), and packaging research (PR 8) can be prepared in parallel with explicit branch/worktree ownership.
- PR 9 must be serial and last.

## Risks

- **Contract churn**: IPC names, payload casing, and event names must remain stable for shared adapters and add-ons.
- **Data migration hazards**: Electron `userData` path may differ from Tauri `app_data_dir`; changing it without migration risks orphaning local SQLite data.
- **Security hazards**: Electron preload must avoid broad Node exposure in the renderer.
- **Release hazards**: Tauri updater/signing artifacts are not directly compatible with Electron update tooling.
- **Conflict hotspots**: Root scripts, frontend Vite aliases, adapter exports, CI workflows, docs, and `AGENTS.md`.
- **Rollback**: Keep Tauri path until Electron parity and release artifacts are verified.

## Gate policy

The user granted standing approval to auto-advance gates. For each major gate, run self-review and an appropriate rubber-duck/code-review pass, refine until no blocking comments remain, record evidence in this plan set, and continue.
