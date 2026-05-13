# Full-stack TypeScript Migration Plan

## Problem and approach

Migrate Wealthfolio from an Electron shell backed by a Rust sidecar to a
full-stack TypeScript/Bun backend without losing current desktop/web behavior.
The Rust backend remains the reference oracle until TS parity is proven; runtime
cutover happens as a whole backend instead of production dual-writing live
SQLite data.

## Current execution slice

PR 5 continues vertical slices with a guarded health runtime and classification
migration HTTP seam after the sync crypto route seam:

- Extend the existing `HealthService` and `TaxonomyService` seams with optional
  runtime methods for `/health/status`, `/health/check`, `/health/fix`, and
  `/taxonomies/migration/{status,run}` while preserving existing local-only
  health/config behavior when those methods are absent.
- Preserve Rust HTTP semantics for client-timezone header trimming, no-body
  health checks and migration runs, fix-action body validation with nullable
  payloads, JSON status/result responses, empty 200 fix responses, method/path
  inertness, and sidecar bearer-token checks.
- Defer real health checks, classification migration, market sync fix execution,
  health cache behavior, and taxonomy/asset side effects to dedicated
  health/classification runtime parity slices.
- Keep routes guarded behind explicit TS runtime handler wiring and sidecar
  token checks in tests.

No production TS default, domain-level Rust/TS mixing in production, or Rust
accounts/settings/limits/taxonomies/custom-provider/goals/exchange-rate/health/provider-settings/portfolio-job/event-stream
secret storage, AI provider runtime, alternative asset runtime, asset runtime,
app utility runtime, portfolio metrics runtime, holdings runtime, add-on
runtime, market-data runtime, activities/import runtime, or AI chat runtime
deletion, real sync crypto runtime implementation, or real health/classification
runtime implementation is in scope for this slice.

## Next slices

1. Continue other low-risk domain slices before calculation-heavy work.
2. Migrate taxonomy migration/health endpoints with the health/classification
   services.
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
