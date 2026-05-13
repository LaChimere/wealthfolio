# Full-stack TypeScript Migration Plan

## Problem and approach

Migrate Wealthfolio from an Electron shell backed by a Rust sidecar to a
full-stack TypeScript/Bun backend without losing current desktop/web behavior.
The Rust backend remains the reference oracle until TS parity is proven; runtime
cutover happens as a whole backend instead of production dual-writing live
SQLite data.

## Current execution slice

PR 5 continues vertical slices by wiring the already-ported SQLite-backed TS
services into the standalone TS backend runtime:

- Add a runtime composition module that initializes SQLite with the existing
  Rust migrations and injects settings, accounts, contribution limits,
  taxonomies, custom providers, goals, exchange-rate CRUD, local health
  dismissal/config, market-data provider settings, and event-stream services.
- Preserve the existing guarded handler model for unimplemented domains and keep
  Electron/Rust sidecar defaults unchanged until cutover gates are ready.
- Align TS runtime database resolution with desktop/web envs by honoring
  `WF_DB_PATH` before `DATABASE_URL`, and by supporting explicit app-data and
  migration-dir overrides for non-repo deployments.
- Defer real secrets, AI, Connect/device-sync, add-on, market-data provider,
  portfolio calculation, holdings, asset, app utility, and health-check runtimes
  to dedicated follow-up slices.

No production TS default, domain-level Rust/TS mixing in production, or Rust
accounts/settings/limits/taxonomies/custom-provider/goals/exchange-rate/health/provider-settings/portfolio-job/event-stream
secret storage, AI provider runtime, alternative asset runtime, asset runtime,
app utility runtime, portfolio metrics runtime, holdings runtime, add-on
runtime, market-data runtime, activities/import runtime, or AI chat runtime
deletion, real sync crypto runtime implementation, real health/classification
runtime implementation, real Connect runtime implementation, real device-sync
runtime implementation, or Rust runtime removal is in scope for this slice.

## Next slices

1. Continue remaining high-risk route seams before calculation-heavy work.
2. Migrate Connect/device-sync runtime behavior with dedicated service parity
   gates.
3. Migrate calculation-heavy domains with Rust-vs-TS parity evidence.
4. Cut over Electron/web to the TS backend by default after parity and rollback
   gates are satisfied.
5. Remove Rust backend/runtime artifacts only after the TS-only architecture is
   proven and documented.

## Verification

- Targeted package tests: `bun run --cwd packages/backend-contracts test`
- Targeted package type check:
  `bun run --cwd packages/backend-contracts type-check`
- Targeted backend runtime tests: `bun run --cwd apps/backend test`
- Targeted Electron lifecycle tests: `bun run --cwd apps/electron test`
- Targeted contract/preflight tests:
  `bun run --cwd packages/backend-contracts test`
- Full repo check before commit: `bun run check`
