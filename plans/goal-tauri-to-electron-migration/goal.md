# Goal State

| Field                | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| objective            | 对整个项目进行深度调研，了解这个项目是如何实现的。然后我需要你将这个基于 Tauri 的项目改造成基于 electron 的。我们的依赖需要尽量用当前最新的版本。项目需要用 typescript 6 （如果最新的 electron 支持的话），且用 bun 来进行管理。这是一个大型的迁移工程，你需要在实现过程中确保没有破坏项目的功能性。可以及时添加 UT、UI 等测试来确保没有破坏功能性，以及确保 high quality。 你可以参考 @~/Projects/volare/ 里面 biome、lefthook、tsconfig 等来确保项目的代码规范。你可以多进行深度调研来了解项目，实现的时候进行原子化 commit，并且频繁进行多轮 review 和 refine 来及时确保项目采用的是最佳实践的方式来实现和迁移的。你的最终目的是完整迁移。 |
| status               | active                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| slug                 | goal-tauri-to-electron-migration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| turns_used           | 27                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| turn_budget          | null                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| docs_update_approved | true                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| gate_policy          | Standing approval: self-review, rubber-duck/code-review/pr-review-toolkit:review-pr refine until no blocking comments, then auto-advance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| created_at           | 2026-05-12T23:20:57.639+08:00                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| updated_at           | 2026-05-13T07:05:00+08:00                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## Acceptance criteria

### User-visible behavior

- Desktop app runs on Electron instead of Tauri while preserving the existing
  Wealthfolio UI and desktop behavior.
- Web mode remains available and functionally equivalent to the pre-migration
  web build.
- Existing local SQLite data, backups, settings, add-ons, secrets, sync flows,
  update UX, deep links, file dialogs, and native shell interactions either keep
  working or have documented, tested migration behavior.

### Implementation scope

- Replace Tauri desktop runtime, plugins, IPC, menu, updater, deep-link,
  file/dialog/shell, logging, window-state, and packaging surfaces with Electron
  equivalents.
- Preserve the Rust business logic and SQLite storage behavior by keeping
  `crates/core`, `crates/storage-sqlite`, and related Rust service crates as the
  source of truth until a separately justified replacement exists.
- Introduce an Electron main/preload/IPC layer and a frontend Electron adapter
  without breaking the existing web adapter seam.
- Move JavaScript/TypeScript package management and scripts to Bun and use
  current compatible versions, including TypeScript 6 if Electron and repository
  tooling support it.
- Adopt Biome, Lefthook, and TypeScript configuration patterns informed by
  `/Users/lachimere/Projects/volare`, adapted to this monorepo.
- Update directly related documentation, including `AGENTS.md`, architecture
  docs, addon docs, and release/dev docs as behavior changes.

### Validation

- Keep or expand adapter parity tests so Electron IPC commands, frontend shared
  adapters, and web routes remain aligned.
- Add targeted unit/integration/UI tests around new Electron bridge behavior
  before removing the Tauri path.
- Run relevant Bun, TypeScript, lint/format, frontend tests, Rust tests, build
  checks, and Electron package/build checks at each migration slice.
- Use repeated self-review, rubber-duck review, code-review, and
  `pr-review-toolkit:review-pr` passes before advancing major gates or removing
  legacy paths.

### Docs/status

- Maintain
  `plans/goal-tauri-to-electron-migration/{research.md,design.md,plan.md,todo.md,goal.md}`
  as the migration status anchor.
- Update repository docs when confirmed changes make Tauri/pnpm instructions
  stale.
- Keep `AGENTS.md` aligned with the current architecture and run targets.

### Deferred/out of scope

- Rewriting Rust business logic in TypeScript is out of scope unless later
  evidence shows Electron cannot safely reuse the existing Rust crates.
  reason=out_of_scope
- Mobile app parity is out of scope for the Electron migration because Electron
  targets desktop. reason=out_of_scope
- Cosmetic UI redesign is out of scope. reason=out_of_scope

## Progress log

- Turn 0: Goal registered. Initial research found an adapter-based frontend
  seam, a Tauri/Rust desktop shell with core Rust services, and
  pnpm/ESLint/Prettier tooling that must be migrated in stages.
- Turn 1: Created migration state artifacts, selected the side-by-side Electron
  migration strategy, incorporated rubber-duck review feedback, and validated
  the current adapter parity test
  (`pnpm --filter frontend exec vitest run src/adapters/adapter-command-parity.test.ts --silent`).
- Turn 2: Documented the Electron migration architecture, including the local
  Rust sidecar profile, Tauri-compatible desktop data roots, keyring continuity,
  native feature replacements, updater/signing direction, and OAuth/deep-link
  strategy.
- Turn 3: Added a frontend runtime-boundary guardrail test that locks current
  non-adapter Tauri imports to an explicit allowlist and passed targeted
  lint/test plus code review.
- Turn 4: Migrated JavaScript workspace installation, scripts, CI/release
  workflows, Docker web build, addon tooling, and developer docs from pnpm to
  Bun while keeping Tauri commands available through Bun.
- Turn 5: Added Biome and Lefthook baseline tooling, wired Biome into Bun checks
  and CI helper scripts, and verified the Lefthook pre-commit path.
- Turn 6: Upgraded TypeScript across the workspace to 6.0.3, recorded the
  required TypeScript 6 deprecation setting, and verified package/frontend
  type-check, tests, and builds.
- Turn 7: Ran a full milestone review, fixed review findings in addon CLI
  failure handling, addon templates/docs, adapter runtime boundary coverage, and
  TypeScript 6 deprecation scoping.
- Turn 8: Added the Bun-managed Electron main/preload scaffold with secure
  window defaults, minimal typed runtime IPC, legacy Tauri data-root path tests,
  root dev/build/test wiring, CI change detection, AGENTS run-target docs, and a
  code-review refinement for guarded startup error handling.
- Turn 9: Added `BUILD_TARGET=electron` frontend adapter resolution, an Electron
  adapter that routes domain calls through typed preload IPC instead of web REST
  fallbacks, IPC/runtime-boundary tests, Electron renderer build wiring, and
  review-refined pending-bridge behavior for AI streaming and native features.
- Turn 10: Started the Rust service bridge by adding a loopback-only sidecar
  server profile with per-run bearer-token middleware, Electron main sidecar
  lifecycle management, legacy Tauri DB/addon roots, isolated temporary desktop
  secret storage, readiness/crash/shutdown handling, lifecycle tests, and
  review-refined cleanup behavior.
- Turn 11: Added the first Electron renderer-to-sidecar command smoke path for
  `get_accounts`, with main-process IPC validation, fail-closed command
  dispatch, sidecar bearer-token proxying, URL/token error redaction, and
  review-refined proxy tests.
- Turn 12: Expanded the Electron account command proxy to cover create, update,
  and delete with server-matched paths, encoded identifiers, body validation,
  tests for malformed payloads, and review-confirmed account API parity.
- Turn 13: Added Electron settings read/update and auto-update preference proxy
  coverage, kept Electron app info path fields blank to avoid DB/log path
  leakage, and added targeted Electron/frontend tests with review-confirmed
  settings API parity.
- Turn 14: Added the Electron domain event bridge by connecting Electron main to
  the sidecar SSE stream with bearer auth, retry/abort lifecycle handling,
  webContents-safe IPC broadcasting, recursive event payload redaction, and
  renderer listener mappings for portfolio, market, and broker sync events.
- Turn 15: Expanded the Electron sidecar command proxy to cover portfolio
  update/recalculate plus holdings, valuation, allocation, performance, and
  income dashboard data. Fixed JSON body headers and 202/empty response
  handling, added command mapping tests, and completed code review with no
  blocking issues.
- Turn 16: Expanded the Electron sidecar command proxy to cover goals, goal
  funding, goal plans, refreshes, save-up overviews, retirement overviews, and
  retirement simulation endpoints with encoded goal IDs, direct JSON bodies,
  malformed-payload tests, and no-blocker code review.
- Turn 17: Added Electron sidecar proxy coverage for snapshot listing, snapshot
  date reads, snapshot deletion, manual holdings saves, and holdings CSV
  check/import requests with query/body mapping tests and no-blocker code
  review.
- Turn 18: Added Electron sidecar proxy coverage for activity search, create,
  update, bulk save, delete, transfer link/unlink, activity imports, import
  mappings, import templates, and account-template linking with mapping tests
  and no-blocker code review.
- Turn 19: Added Electron sidecar proxy coverage for exchange-rate reads, add,
  update, and delete. Review caught an unrealistic test payload; tests now
  mirror the frontend/backend schema and re-review found no remaining issues.
- Turn 20: Added Electron sidecar proxy coverage for exchanges, market data
  provider settings, custom provider CRUD, and custom provider source tests with
  mapping tests and no-blocker code review.
- Turn 21: Added Electron sidecar proxy coverage for contribution limit list,
  create, update, delete, and deposit-calculation endpoints with encoded limit
  IDs, direct JSON bodies, mapping tests, and no-blocker code review.
- Turn 22: Added Electron sidecar proxy coverage for asset CRUD/profile/pricing
  mode commands plus market-data symbol search, quote history/dividends,
  latest/manual quote updates, quote CSV import, and market-data sync. Review
  found a missing `refetchAll` validation, which was fixed and re-reviewed with
  no remaining blockers.
- Turn 23: Added Electron sidecar proxy coverage for taxonomy CRUD, category
  CRUD/move, taxonomy import/export, asset taxonomy assignments, and legacy
  classification migration endpoints with encoded path tests and no-blocker code
  review.
- Turn 24: Added Electron sidecar proxy coverage for Health Center status/check,
  dismiss/restore, dismissed issue reads, fix execution, and config
  reads/updates while preserving `X-Client-Timezone` forwarding for health
  checks. Code review found no blockers.
- Turn 25: Added Electron sidecar proxy coverage for Net Worth current and
  history reads with optional/current date query mapping, required date-range
  validation, mapping tests, and no-blocker code review.
- Turn 26: Fixed Web adapter liability link/unlink routes to match the Rust
  `/alternative-assets/{id}/link-liability` endpoint before adding Electron
  alternative-asset parity. Added adapter route tests and code review found no
  blockers.
- Turn 27: Added Electron sidecar proxy coverage for alternative asset create,
  valuation, delete, liability link/unlink, metadata update, and alternative
  holdings reads. Review found metadata values needed string-record validation;
  the fix was applied and re-reviewed with no remaining blockers.

## Deferred items

- Mobile-specific Tauri features (iOS haptics, barcode scanner,
  ASWebAuthenticationSession, mobile share) will not be ported to Electron.
  reason=out_of_scope

## Blockers

- None.
