# Full-stack TypeScript Migration Plan

## Problem and approach

Migrate Wealthfolio from an Electron shell backed by a Rust sidecar to a
full-stack TypeScript/Bun backend without losing current desktop/web behavior.
The Rust backend remains the reference oracle until TS parity is proven; runtime
cutover happens as a whole backend instead of production dual-writing live
SQLite data.

## Current execution slice

PR 5 continues vertical slices with a low-risk activities/import HTTP seam after
the market-data route seam:

- Add an `ActivityService` interface and guarded `/activities/*` route tests for
  search, create/update/bulk/delete, transfer link/unlink, import check/preview
  /apply, CSV parse, mapping, templates, account-template links, and duplicate
  checks.
- Preserve Rust HTTP semantics for search filter normalization, sort
  object/array handling, date validation, JSON body pass-through, tuple-shaped
  link/unlink responses, multipart CSV parsing, mapping/template wrapper bodies,
  default `ACTIVITY` import context, duplicate response wrapping, path/query
  decoding, and sidecar bearer-token checks.
- Defer real activity persistence, import parsing/mapping/template storage,
  duplicate lookups, transfer mutation behavior, asset preview resolution, and
  portfolio recalculation side effects to dedicated activities/import/runtime
  parity slices.
- Keep routes guarded behind explicit TS runtime handler wiring and sidecar
  token checks in tests.

No production TS default, domain-level Rust/TS mixing in production, or Rust
accounts/settings/limits/taxonomies/custom-provider/goals/exchange-rate/health/provider-settings/portfolio-job/event-stream
secret storage, AI provider runtime, alternative asset runtime, asset runtime,
app utility runtime, portfolio metrics runtime, holdings runtime, add-on
runtime, market-data runtime, or activities/import runtime deletion is in scope
for this slice.

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
