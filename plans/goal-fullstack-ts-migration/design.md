# Design Document

> Purpose: document the solution design for review and approval before execution
> planning. Do not proceed to plan/execution until this design is approved.

## Objective

- What problem are we solving: replace the current Rust sidecar/server/domain
  backend with a TypeScript/Bun backend while preserving Wealthfolio behavior,
  SQLite data compatibility, Electron desktop behavior, and web mode.
- Link to research: `plans/goal-fullstack-ts-migration/research.md`

## Architecture / Approach

- High-level approach: staged migration with Rust as the reference oracle and
  TypeScript implementations kept inert until parity is proven. Runtime cutover
  is whole-backend, not production domain-by-domain, to avoid dual writers and
  duplicated background workers against the same SQLite database.
- Key components / layers involved:
  - `apps/electron` main/preload lifecycle and native IPC.
  - `apps/frontend/src/adapters/*` command contracts.
  - New TypeScript backend packages/apps for server runtime, domain services,
    SQLite repositories, migrations, event bus, secrets, sync, Connect, AI, and
    market data.
  - Existing Rust `apps/server` and `crates/*` as temporary reference
    implementation and parity oracle.
- Interaction / data flow:
  1. Frontend adapters keep calling stable command names.
  2. Rust remains the production/default backend until the TS backend can
     satisfy the full required command/API surface.
  3. TS domain implementations merge behind test-only or explicit dev flags
     while parity harnesses compare Rust and TS behavior on cloned fixture
     databases.
  4. Electron backend lifecycle supports whole-runtime selection: Rust sidecar,
     TS backend, or test harness. It must not run Rust and TS as concurrent
     production writers on the same live user database.
  5. Web mode exposes the same `/api/v1` HTTP contract from the active backend.
  6. Rust build/runtime paths are removed only after TS is the default and a
     stabilization review confirms no fallback requirement remains.

## Interface / API / Schema Design

- New or changed interfaces:
  - Add a TypeScript backend contract package generated or derived from existing
    command metadata in `apps/frontend/src/adapters/web/core.ts` and
    `apps/electron/src/shared/ipc.ts`.
  - Add a backend lifecycle abstraction in Electron main so startup/shutdown can
    support Rust sidecar or TS backend as a whole-runtime choice.
  - Add a parity harness that can run Rust and TS handlers against the same
    cloned fixture database/input and compare normalized outputs.
  - Add compatibility contracts for decimals, timestamps/dates, IDs, ordering,
    and error envelopes before migrating calculation-heavy domains.
- New or changed API endpoints:
  - No endpoint shape changes are intended during migration. `/api/v1` routes
    and Electron command names remain compatibility contracts.
  - Desktop-only native IPC remains in Electron main/preload and is not a TS
    backend HTTP contract unless explicitly designed later.
- New or changed data models / schemas:
  - No user-visible SQLite schema change in the base migration infrastructure.
  - The chosen TS storage foundation is `bun:sqlite` plus a thin repository and
    migration layer. It must read the existing SQL migration directories and
    preserve Diesel-compatible migration bookkeeping so Rust and TS can inspect
    the same database history during the transition.
- Contract compatibility notes:
  - Existing addon host APIs, Electron IPC command names, web command names,
    SSE/event names, and native desktop IPC must remain stable unless a later
    approved design explicitly changes them.
  - Financial decimals use an explicit decimal library, not JavaScript `number`,
    for stored/calculated money and quantity semantics. The base contract PR
    must map Rust `rust_decimal` rounding/serialization behavior to the chosen
    TS decimal implementation.
  - Timestamps use documented UTC/date-only serialization rules, including a
    truncation policy for precision Rust supports but JavaScript does not.

## Trade-off Analysis

### Option A (chosen)

- Summary: side-by-side TS implementation with Rust as reference oracle, but
  whole-backend runtime cutover only after parity is complete enough for the
  active backend surface.
- Pros:
  - Lowest risk for financial correctness and user data.
  - Each PR can be reviewed and merged independently.
  - Existing Rust tests and behavior remain available while TS coverage grows.
  - Avoids dual-writer and duplicated-background-worker hazards in production.
- Cons:
  - Longer window before users run TS backend by default.
  - Requires parity harnesses and fixture discipline before visible cutover.
  - Requires careful separation between test/dev flags and production behavior.
- Why chosen: the current backend is large, stateful, and correctness-critical;
  side-by-side implementation gives evidence before removing Rust while
  whole-backend cutover avoids unsafe mixed runtime behavior.

### Option B (rejected)

- Summary: big-bang rewrite all Rust crates and server into TS, then switch
  Electron/web at the end.
- Pros:
  - Avoids dual-runtime abstractions.
  - Potentially cleaner final architecture in one large diff.
- Cons:
  - Very high risk of data/calculation drift.
  - Hard to review, test, bisect, or roll back.
  - Blocks users from receiving incremental improvements.
- Why rejected: incompatible with the requested high quality, atomic commits,
  and frequent review/refine loop.

### Option C (rejected)

- Summary: production domain-by-domain routing where Rust and TS both run
  against the same live SQLite database during transition.
- Pros:
  - Earlier partial user-visible TS backend usage.
  - Smaller cutovers per domain.
- Cons:
  - Dual writers can race on SQLite despite WAL/busy-timeout.
  - Event buses, caches, background workers, sync outbox, and quote/device sync
    workers can duplicate work or diverge.
  - Operational failures may be intermittent and hard to reproduce.
- Why rejected: unsafe for a financial local-first app with background sync and
  event-driven side effects.

## Feature summary

- Summary: migrate Wealthfolio's Rust backend/sidecar to a TypeScript/Bun
  backend through a staged, contract-tested rewrite.
- Main constraints: preserve SQLite data, frontend adapter contracts, Electron
  desktop behavior, web API behavior, secrets/keyring safety, sync crypto, and
  financial calculation correctness.
- Why this split was chosen: base/fan-out/cleanup keeps trunk mergeable while
  allowing TS implementations and tests to land safely before a whole-backend
  cutover.

## PR sequence

### PR 1 — TS backend contract and parity foundation

- Goal: introduce shared TypeScript command/API/schema contracts, normalization
  contracts, and a parity test harness without changing runtime behavior.
- Likely directories/files:
  - `packages/backend-contracts/`
  - `packages/backend-test-fixtures/`
  - `apps/electron/src/shared/ipc.ts`
  - `apps/frontend/src/adapters/web/core.ts`
  - `apps/frontend/src/adapters/adapter-command-parity.test.ts`
  - `plans/goal-fullstack-ts-migration/*`
- Dependencies: current Electron migration branch.
- Allowed changes:
  - Extract or mirror command metadata into typed TS contracts.
  - Reconcile web vs Electron command registries and classify backend commands,
    Electron-native commands, and legacy aliases.
  - Add fixture/golden-test harness capable of invoking Rust reference endpoints
    against cloned fixture databases.
  - Add normalization contracts for decimals, dates/timestamps, IDs, error
    envelopes, and output ordering.
  - Add an addon host canary fixture that can validate backend-facing addon
    APIs.
- Prohibited changes:
  - No production routing changes.
  - No Rust removal.
  - No SQLite schema changes.
- Acceptance criteria:
  - Existing web/Electron command parity tests still pass.
  - New contract package can enumerate and classify the current command/API
    surface.
  - Decimal/time/error normalization rules are documented and tested against
    Rust fixtures.
  - A smoke parity test can compare at least health/settings/accounts read
    shapes between Rust and contract-normalized expected output.
  - Addon host canary test exists, even if it initially targets Rust only.
- Validation commands:
  - `bun run check`
  - `bun run test:electron`
  - targeted contract/parity harness tests
- Mergeability notes: trunk-safe because runtime behavior is unchanged.

### PR 2 — TS backend runtime skeleton

- Goal: add a Bun/TypeScript backend runtime with health/readiness, config,
  logging, auth/sidecar-token middleware parity, event bus shell, and Electron
  lifecycle abstraction, still defaulting production behavior to Rust.
- Likely directories/files:
  - `apps/backend/` or `packages/backend/`
  - `apps/electron/src/main/*backend*`
  - `scripts/dev-electron.mjs`
  - CI/package scripts
- Dependencies: PR 1.
- Allowed changes:
  - Add TS HTTP server skeleton for `/api/v1/healthz` and `/api/v1/readyz`.
  - Add whole-runtime backend selector for test/dev use.
  - Add tests for startup/shutdown, token enforcement, CORS, timeout, and
    config.
  - Define desktop vs web semantics for the sidecar bearer token: loopback token
    remains required for local HTTP backends, while in-process Electron-only
    calls must still preserve a private main-process boundary.
- Prohibited changes:
  - No domain command switch except health/readiness in guarded dev/test mode.
  - No concurrent Rust/TS production writers against the same live DB.
  - No deletion of Rust sidecar packaging.
- Acceptance criteria:
  - Electron can start TS backend skeleton in a guarded dev/test mode.
  - Rust sidecar remains default.
  - Auth/token behavior matches current protected sidecar routes where HTTP is
    used.
  - Tests prove only one production backend owns a live user DB at a time.
- Validation commands:
  - `bun run check`
  - `bun run test:electron`
  - targeted backend runtime tests
- Mergeability notes: guarded behind explicit config; no user-visible behavior
  change.

### PR 3 — TS SQLite foundation

- Goal: introduce `bun:sqlite` access, migration tracking, backup/restore
  helpers, and read-only repository parity for low-risk tables.
- Likely directories/files:
  - TS backend storage package.
  - Existing SQL migration directory reader.
  - Contract fixtures for SQLite snapshots.
- Dependencies: PR 1, PR 2.
- Allowed changes:
  - Add a thin repository/migration layer over `bun:sqlite`.
  - Preserve existing SQL migrations and PRAGMA behavior.
  - Preserve Diesel-compatible migration bookkeeping or document/test a
    reversible equivalent.
  - Add read-only repositories for settings/accounts and utility backup/restore
    parity.
- Prohibited changes:
  - No schema rewrite or destructive migration.
  - No mutation-heavy domain switch.
- Acceptance criteria:
  - TS backend can open an existing Wealthfolio SQLite DB fixture.
  - Existing SQL migrations can be discovered/applied/tracked by TS without
    corrupting Diesel migration history.
  - WAL, foreign-key, busy-timeout, synchronous, and backup/restore behaviors
    are covered by tests.
  - Backup/restore and settings/accounts read parity pass against fixture DBs.
- Validation commands:
  - `bun run check`
  - targeted storage parity tests
  - backup/restore integration test
- Mergeability notes: still no default runtime cutover.

### PR 4 — Cross-cutting compatibility preflights

- Goal: prove compatibility assumptions that later slices depend on before large
  domain migration begins.
- Likely directories/files:
  - `packages/backend-contracts/`
  - TS storage/fixtures.
  - Electron keyring/native bridge tests.
  - Addon canary fixtures.
- Dependencies: PR 3.
- Allowed changes:
  - Audit exact desktop keyring service/account naming and dev/prod namespace
    behavior.
  - Add Rust-to-TS secret read compatibility tests where OS support is
    available, with skipped/diagnostic behavior for unsupported CI keyrings.
  - Add addon host canary execution against Rust reference and TS contract
    expectations.
  - Add mixed-version device-sync fixture design and crypto vector fixtures.
- Prohibited changes:
  - No secret fallback to disk in desktop mode.
  - No Connect/device-sync production cutover.
- Acceptance criteria:
  - Keyring service IDs and account names are documented and tested for prod/dev
    namespaces.
  - Keychain/code-signing ACL implications are documented for packaged Electron.
  - Addon canary establishes a baseline compatibility signal.
  - Mixed Rust/TS device-sync peer compatibility requirements are written as
    test fixtures before implementation.
- Validation commands:
  - `bun run check`
  - targeted keyring/addon/fixture tests
- Mergeability notes: prepares high-risk slices without changing runtime
  behavior.

### PR 5 — Low-risk domain vertical slices

- Goal: implement settings, accounts, contribution limits, taxonomies, and other
  CRUD/read-heavy domains in TS, validated by parity tests but not switched on
  by default.
- Likely directories/files:
  - TS backend domain/repository packages.
  - Contract/golden fixtures.
  - Electron/backend routing tests for guarded TS runtime.
- Dependencies: PR 4.
- Allowed changes:
  - Domain-specific TS services and repositories.
  - Test/dev-only whole-runtime TS execution for migrated domains against cloned
    fixture DBs.
  - Tests travel with each migrated domain.
- Prohibited changes:
  - No production domain-level switch.
  - No market-data sync, device-sync, Connect, AI, or secrets cutover.
  - No cleanup of Rust implementations yet.
- Acceptance criteria:
  - Each migrated domain has Rust-vs-TS parity tests for reads, writes,
    validation, errors, and events.
  - Web/Electron adapters do not change public signatures.
  - Event semantics are either matched or explicitly marked pending for the
    final runtime cutover gate.
- Validation commands:
  - `bun run check`
  - targeted domain parity tests
  - relevant frontend/Electron tests
- Mergeability notes: domains can fan out after PR 4, but each PR remains inert
  for production until TS cutover.

### PR 6a — Holdings, valuation, and snapshots

- Goal: migrate holdings calculation, daily valuations, snapshots, and account
  valuation reads/writes with strict decimal/time parity.
- Dependencies: PR 5 storage/domain foundations.
- Acceptance criteria:
  - Golden portfolio fixtures match Rust for holdings, latest/historical
    valuations, and snapshots.
  - Decimal rounding and date handling match documented PR 1 contracts.
- Validation commands:
  - `bun run check`
  - targeted holdings/valuation/snapshot parity tests
- Mergeability notes: inert for production until TS cutover.

### PR 6b — Performance, income, FX, and net worth

- Goal: migrate performance summaries/history, income summaries, exchange rates,
  currency conversion, and net worth.
- Dependencies: PR 6a fixtures and decimal/time contracts.
- Acceptance criteria:
  - Financial outputs match Rust reference on canonical portfolio fixtures.
  - No loose tolerances are used without documented decimal rationale.
- Validation commands:
  - `bun run check`
  - targeted performance/income/FX/net-worth parity tests
- Mergeability notes: inert for production until TS cutover.

### PR 6c — Activities and imports

- Goal: migrate activities CRUD, transfer linking, CSV parsing, import preview,
  duplicate detection, and templates.
- Dependencies: PR 5 plus storage/import fixtures.
- Acceptance criteria:
  - CSV/import fixtures match Rust accepted/rejected rows and normalized
    activity outputs.
  - Idempotency and import-run persistence match existing behavior.
- Validation commands:
  - `bun run check`
  - targeted activity/import parity tests
- Mergeability notes: inert for production until TS cutover.

### PR 6d — Assets, quotes, market data, and providers

- Goal: migrate asset CRUD/profile/pricing mode, quote history/dividends/manual
  updates, provider settings, custom providers, and market-data sync logic.
- Dependencies: PR 6a/6b where valuation and FX are needed.
- Acceptance criteria:
  - Provider timeout/error behavior is explicit and tested.
  - Quote sync fixtures and provider config persistence match Rust.
- Validation commands:
  - `bun run check`
  - targeted asset/quote/provider parity tests
- Mergeability notes: inert for production until TS cutover.

### PR 6e — Goals, retirement, and Health Center

- Goal: migrate goals, funding, plans, save-up/retirement projections, stress
  tests, and Health Center diagnostics.
- Dependencies: PR 6a/6b domain calculation fixtures.
- Acceptance criteria:
  - Retirement and health outputs match Rust reference on canonical fixtures.
  - Health dismissal/config persistence remains compatible.
- Validation commands:
  - `bun run check`
  - targeted goals/retirement/health parity tests
- Mergeability notes: inert for production until TS cutover.

### PR 7 — High-risk services: secrets, sync, Connect, AI, add-ons

- Goal: migrate keyring/file secrets, sync crypto, device sync, Wealthfolio
  Connect, AI provider/chat streaming/tools, and addon backend operations after
  lower-risk domains are stable.
- Likely directories/files:
  - TS backend secrets/sync/connect/AI/addon packages.
  - Electron native/keyring bridge where needed.
  - E2E and contract fixtures.
- Dependencies: PR 4 preflights and sufficient PR 5/6 domain support.
- Allowed changes:
  - Strong contract and e2e tests before each cutover.
  - Explicit secret namespace/keyring compatibility tests.
  - Streaming and background worker lifecycle tests.
  - Mixed Rust/TS device-peer compatibility tests for sync payloads and vector
    clocks.
- Prohibited changes:
  - No fallback that stores secrets on disk in desktop mode.
  - No crypto behavior change without fixture proof.
  - No Connect token lifecycle change without refresh/error-path tests.
- Acceptance criteria:
  - E2EE crypto vectors match Rust.
  - Device sync state/outbox/applied-event behavior is compatible with existing
    data.
  - A Rust-backed device and TS-backed device can sync bidirectionally against a
    controlled fixture without divergence before mixed-version rollout.
  - Connect token lifecycle and AI streaming preserve current API behavior.
  - Addon install/runtime APIs pass canary compatibility tests.
- Validation commands:
  - `bun run check`
  - targeted sync/crypto/secret/AI/addon contract tests
  - relevant e2e flows where feasible
- Mergeability notes: serial within each high-risk subsystem.

### PR 8 — Default TS backend cutover

- Goal: make TypeScript backend the default for Electron and web while retaining
  Rust as an emergency/reference fallback for a bounded stabilization milestone.
- Likely directories/files:
  - Electron backend lifecycle.
  - Web/dev scripts.
  - CI/release configs.
  - Docs/runbooks.
- Dependencies: all required domain parity PRs.
- Allowed changes:
  - Flip default runtime selection to TS.
  - Add rollback switch and release notes.
  - Run broader validation matrix and performance benchmarks.
- Prohibited changes:
  - No Rust deletion in the same PR.
  - No fallback removal.
- Acceptance criteria:
  - Electron and web run against TS backend by default.
  - Existing SQLite production-style DB fixture opens and passes smoke flows.
  - Rust fallback remains available and documented.
  - Rollback triggers are documented, including startup failure, migration
    failure, parity-regression signal, sync divergence signal, and performance
    regression beyond the approved benchmark threshold.
  - Canonical portfolio/import benchmarks are captured before and after cutover;
    TS must meet the approved threshold before release.
- Validation commands:
  - `bun run check`
  - `bun run build:electron`
  - `bun run test:electron`
  - frontend tests
  - targeted e2e smoke flows
  - cutover benchmark command(s)
- Mergeability notes: high-risk; requires Gate 3 review before merge.

### PR 9 — Rust removal cleanup

- Goal: remove Rust workspace, sidecar binaries, Cargo tooling, Rust CI/release
  paths, and stale docs after TS backend is fully default and stable.
- Likely directories/files:
  - `Cargo.toml`, `Cargo.lock`
  - `apps/server/`
  - `crates/`
  - Electron packaging scripts
  - CI/release workflows
  - README/AGENTS/docs
- Dependencies: PR 8 stabilization review confirms fallback can be removed.
- Allowed changes:
  - Delete Rust runtime/build artifacts.
  - Remove sidecar packaging and fallback switches.
  - Update docs and validation commands.
- Prohibited changes:
  - No new feature work.
  - No behavior changes beyond removing obsolete paths.
- Acceptance criteria:
  - No runtime/build/test references to Rust remain except historical docs.
  - Electron and web builds/tests pass on TS-only stack.
  - Docs accurately describe full-stack TS architecture.
- Validation commands:
  - `bun run check`
  - `bun run build:electron`
  - `bun run test:electron`
  - frontend/unit/e2e smoke checks
- Mergeability notes: final cleanup PR only after proven TS parity.

## Parallelization readiness

- Serial prerequisites: PR 1, PR 2, PR 3, and PR 4 must happen in order because
  all later slices depend on contracts, runtime lifecycle, SQLite access, and
  cross-cutting compatibility preflights.
- Fan-out candidates: after PR 4, low-risk domains can fan out by ownership area
  if path ownership is explicit. PR 6a-6e can fan out only after their shared
  decimal/time/storage fixtures stabilize and dependencies are respected.
- Serial high-risk work: secrets, sync crypto, device sync, Connect token
  lifecycle, and AI streaming should remain mostly serial or isolated by
  worktree/branch because they share security and background-runtime contracts.
- Note: this is readiness guidance only; use `plan-parallel-work` before
  assigning multiple agents or worktrees.

## Key Design Decisions

- Decision 1: Rust remains the reference implementation until parity is proven.
  - Context: the current backend has many domains, migrations, financial
    calculations, and security-sensitive sync flows.
  - Choice: side-by-side implementation with parity harness and whole-backend
    runtime cutover.
  - Rationale: enables atomic commits and reviewable slices without production
    dual-writer hazards.

- Decision 2: command/API shapes are migration contracts.
  - Context: frontend adapters and addon APIs already depend on stable command
    names and DTOs.
  - Choice: extract/centralize contracts before implementation slices.
  - Rationale: prevents drift and gives TS backend a typed target.

- Decision 3: `bun:sqlite` plus a thin migration/repository layer is the initial
  TS storage foundation.
  - Context: the app already uses SQLite and Bun; preserving existing SQL
    migration history is more important than adopting an ORM with incompatible
    migration ownership.
  - Choice: keep existing SQL migrations as the source of truth and add typed
    repositories over `bun:sqlite`.
  - Rationale: minimizes data migration risk and keeps Rust/TS migration history
    interoperable during transition.

- Decision 4: Rust removal is cleanup, not part of the first TS cutover.
  - Context: deleting fallback and reference code too early removes the oracle.
  - Choice: keep Rust through TS default cutover, then delete in a final
    cleanup.
  - Rationale: safer rollback and easier parity debugging.

## Impact Assessment

- Affected modules / services: Electron main lifecycle, frontend adapters,
  backend APIs, all Rust domain/storage crates, SQLite migrations, CI/release,
  docs, addon SDK/runtime, device sync, Connect, AI, market data.
- Public API / schema compatibility: must remain stable until explicitly
  changed.
- Data migration needs: existing SQLite files must continue to open; migration
  history and PRAGMA behavior must be preserved by the `bun:sqlite` migration
  layer or replaced only by a tested, reversible equivalent.
- Performance implications: TS calculations and SQLite access must be
  benchmarked before PR 8 cutover, because that is when users would experience
  regressions.
- Security considerations: desktop secrets/keyring, sidecar token replacement,
  auth, sync crypto, Connect tokens, and AI provider secrets require explicit
  parity/e2e tests.
- CI considerations: the dual Rust/TS parity window will increase CI cost. The
  base plan should separate targeted PR gates from broader scheduled or
  milestone validation once the harness exists.

## Open Questions

- Which exact TS decimal library and rounding configuration best matches
  `rust_decimal` across current fixtures?
- Should Electron's final TS backend be in-process or loopback HTTP by default,
  after PR 2 proves both lifecycle options?
- Which fixture datasets should become the canonical golden suite for financial
  calculations and imports?
- What stabilization evidence is sufficient to remove the Rust fallback after PR
  8?

## Review Notes / Annotations

- Rubber-duck review before Gate 1 flagged SQLite stack deferral, production
  dual-writer risk, missing decimal/time/error contracts, understated keyring
  risk, oversized calculation PR scope, missing rollback criteria, mixed-version
  device-sync risk, command-registry delta, addon host compatibility, benchmark
  placement, CI cost, and sidecar-token semantics. This revision addresses those
  by choosing `bun:sqlite`, requiring whole-backend runtime cutover, moving
  normalization contracts to PR 1, adding PR 4 compatibility preflights,
  splitting calculation/import work into PR 6a-6e, adding rollback/benchmark
  gates to PR 8, and documenting CI/token considerations.

## Approval

- [ ] Design approved by:
- Date:
