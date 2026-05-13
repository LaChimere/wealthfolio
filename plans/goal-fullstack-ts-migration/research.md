# Research Log

> Purpose: capture facts, evidence, and unknowns before planning/implementation.
> This is the review surface for understanding and diagnosis.

## Task

- Summary: Migrate Wealthfolio from the current Electron + Rust sidecar/backend
  architecture to full-stack TypeScript/Bun while preserving behavior and data.
- Links: User request in this session; branch
  `feat/fullstack-ts-migration-prep`.

## Current Behavior

- Observed behavior: Electron desktop runs a Bun/TypeScript main/preload shell,
  but Electron still starts a Rust Axum sidecar for backend APIs and business
  logic.
- Expected behavior: Final state removes the Rust sidecar/server/runtime path
  and replaces backend/storage/domain responsibilities with TypeScript/Bun.
- Scope affected: Electron main sidecar lifecycle, frontend adapter command
  contracts, Axum API routes, Rust business crates, SQLite storage/migrations,
  secrets/keyring, device sync, Connect, AI streaming, addon/runtime APIs, CI,
  packaging, and docs.

## Environment

- OS: macOS/Darwin.
- Runtime/tool versions: Bun-managed monorepo; Electron and TypeScript versions
  are defined in `package.json` and `apps/electron/package.json`.
- Repro command(s):
  - `bun run dev:electron` currently starts Electron plus a Rust sidecar.
  - `bun run check` is the repo-level TypeScript/lint/format gate.

## Evidence

- Rust workspace members are `apps/server` plus all `crates/*` members
  (`Cargo.toml:1-6`), with workspace dependencies for Tokio, serde, Diesel,
  rusqlite, reqwest, crypto, and internal crates (`Cargo.toml:19-72`).
- Rust backend domains are split across `wealthfolio-core`,
  `wealthfolio-storage-sqlite`, `wealthfolio-market-data`,
  `wealthfolio-connect`, `wealthfolio-device-sync`, `wealthfolio-ai`, and
  `wealthfolio-desktop-secrets` (`crates/*/Cargo.toml`,
  `crates/core/src/lib.rs:1-35`, `crates/storage-sqlite/src/lib.rs:1-63`,
  `crates/ai/src/lib.rs:1-156`, `crates/device-sync/src/lib.rs:1-52`,
  `crates/connect/src/lib.rs:1-37`).
- The Rust sidecar constructs a large `AppState` with account, settings,
  holdings, valuation, allocation, quote, snapshot, performance, income, goals,
  limits, FX, activity, asset, taxonomy, net worth, alternative assets, addons,
  Connect sync, AI, device sync, health, custom providers, repositories, event
  bus, and secret store (`apps/server/src/main_lib.rs:63-106`,
  `apps/server/src/main_lib.rs:150-520`).
- Axum routes are organized by 24 API modules and merged under `/api/v1`, with
  sidecar bearer-token protection when `WF_SIDECAR_TOKEN` is configured
  (`apps/server/src/api.rs:21-49`, `apps/server/src/api.rs:87-147`,
  `apps/server/src/api.rs:156-188`).
- Electron currently injects sidecar environment (`WF_DB_PATH`, `WF_ADDONS_DIR`,
  `WF_SECRET_BACKEND=keyring`, `WF_SECRET_KEY`, `WF_SIDECAR_TOKEN`,
  `WF_LISTEN_ADDR`) and starts either `cargo run` in dev or a packaged
  `wealthfolio-server` binary (`apps/electron/src/main/sidecar.ts:62-99`,
  `apps/electron/src/main/sidecar.ts:102-154`).
- The frontend runtime seam is already adapter-based: the default export points
  at Electron for type-checking while Vite aliases Electron or web at build time
  (`apps/frontend/src/adapters/index.ts:1-5`). Electron calls a preload `invoke`
  API (`apps/frontend/src/adapters/electron/core.ts:48-87`), while web maps
  command names to `/api/v1` HTTP routes
  (`apps/frontend/src/adapters/web/core.ts:13-140`).
- Adapter command parity is guarded by tests that scan shared/web/electron
  adapter callsites and compare them to web/electron command registries
  (`apps/frontend/src/adapters/adapter-command-parity.test.ts:53-100`).
- Current command surface is large: 218 web command entries, 239 Electron IPC
  command entries, 24 server API modules, 30 SQLite migration directories, 1,586
  Rust test markers, and 74 TypeScript test files were counted from the current
  branch.
- SQLite is mature and migration-heavy: `crates/storage-sqlite/src/db/mod.rs`
  initializes WAL/foreign-key/busy-timeout PRAGMAs and embedded Diesel
  migrations (`crates/storage-sqlite/src/db/mod.rs:20-45`,
  `crates/storage-sqlite/src/db/mod.rs:60-123`); schema includes many domain,
  AI, sync, market-data, and portfolio tables
  (`crates/storage-sqlite/src/schema.rs:3-240`).
- Device sync persists sync cursor/outbox/entity metadata/device config/engine
  state/table state/applied events and seeds synced tables
  (`crates/storage-sqlite/migrations/2026-02-12-000001_device_sync_foundation/up.sql:1-104`).

## Code Reading Notes

- `apps/electron/src/main/sidecar.ts` — current Electron dependency point on
  Rust; this should become a TS backend lifecycle interface before replacement.
- `apps/electron/src/shared/ipc.ts` — canonical Electron command/event surface
  that can seed TypeScript backend route/contract metadata.
- `apps/frontend/src/adapters/web/core.ts` — existing web command-to-HTTP map;
  useful as a source for backend contract generation and parity tests.
- `apps/server/src/api.rs` — current HTTP route composition and auth/token
  layering; TS server must match protected/public route behavior.
- `apps/server/src/main_lib.rs` — service graph wiring; reveals migration order
  and high-coupling areas.
- `crates/core/src/lib.rs` — database-agnostic domain services; likely maps to
  TS domain packages.
- `crates/storage-sqlite/src/lib.rs` and `crates/storage-sqlite/src/schema.rs` —
  SQLite repositories/schema; the most important data compatibility surface.
- `crates/device-sync/src/lib.rs`, `crates/connect/src/lib.rs`,
  `crates/ai/src/lib.rs` — high-risk late migration areas due to E2EE, cloud
  token lifecycle, and streaming/tool orchestration.

## Hypotheses (ranked)

1. A side-by-side TypeScript backend plus parity harness is the safest path. The
   Rust implementation should remain the reference until enough domains have
   contract/golden coverage to prove TS parity.
2. Migrating storage/contracts before domain logic reduces churn. The command
   registries and SQLite schema can become shared generated/typed contracts that
   both the frontend and TS backend consume.
3. Sync, secrets, Connect, and AI should migrate late. They combine external
   services, key material, crypto, streaming, and persisted sync metadata, so
   they need stronger contract/e2e coverage than basic CRUD domains.

## Experiments Run

- Command/action: Counted command/API/test/migration surfaces with ripgrep/find.
- Result: 218 web commands, 239 Electron commands, 24 server API modules, 30
  SQLite migration directories, 1,586 Rust test markers, 74 TypeScript test
  files.
- Interpretation: The rewrite is too broad for one PR and needs staged
  contracts, parity harnesses, and domain-by-domain migration.
- Command/action: Ran independent rubber-duck design review against `goal.md`,
  `research.md`, `design.md`, and `todo.md`.
- Result: Review flagged SQLite stack deferral, unsafe production dual-writer
  risk, missing decimal/time/error contracts, understated keyring risk,
  oversized calculation scope, missing rollback criteria, mixed-version
  device-sync risk, command-registry delta, addon host compatibility, benchmark
  placement, CI cost, and sidecar-token semantics.
- Interpretation: Gate 1 design must choose storage direction, prohibit
  production Rust/TS dual writers, move normalization contracts up front, add
  compatibility preflights, and split calculation/high-risk slices more sharply.

## Open Questions / Unknowns

- Which TS SQLite layer should be adopted for long-term maintenance: Drizzle,
  Kysely, Prisma, raw `bun:sqlite`, or a small repository layer over
  `bun:sqlite`?
- Should the TS backend expose HTTP for web and an in-process adapter for
  Electron, or keep a local HTTP server for both modes during the transition?
- Which Rust domains have enough fixture coverage to serve as golden tests, and
  where do we need to add fixtures before migration?
- How should legacy Diesel migrations be represented after Rust removal:
  preserved SQL migration history, generated Drizzle/Kysely migrations, or a
  one-time baseline plus forward migrations?

## Recommendation for Plan

- Proposed direction: create a base PR that introduces TypeScript backend
  contracts and a parity harness without behavior change, then migrate domains
  in small inert/test-backed slices while Rust remains the reference
  implementation. Use whole-backend runtime cutover rather than production
  domain-by-domain routing to avoid dual writers. Defer sync/secrets/Connect/AI
  until after storage and core CRUD/calculation parity is proven.
- Risks: financial calculation drift, SQLite migration incompatibility, event
  semantics drift, secret/keyring namespace mistakes, E2EE sync breakage,
  long-running Rust/TS dual-maintenance window.
- Suggested verification level: L2 for most slices (contract/integration parity)
  and L3 when removing Rust runtime or changing sync/crypto/secrets.
