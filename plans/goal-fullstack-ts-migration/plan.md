# Full-stack TypeScript Migration Plan

## Problem and approach

Migrate Wealthfolio from an Electron shell backed by a Rust sidecar to a
full-stack TypeScript/Bun backend without losing current desktop/web behavior.
The Rust backend remains the reference oracle until TS parity is proven; runtime
cutover happens as a whole backend instead of production dual-writing live
SQLite data.

## Current execution slice

PR 5 continues vertical slices with a guarded Connect broker/session HTTP seam
after the health/classification route seam:

- Add an injectable `ConnectService` seam for non-device `/api/v1/connect/*`
  routes covering session storage/status/restore, broker list/sync operations,
  local synced data reads, import-run queries, broker sync profiles,
  subscription plans, public plans, and user info.
- Preserve Rust HTTP semantics for JSON `null` session mutations, body-ignoring
  sync POST routes, 202/403/501 broker-sync trigger status, import-run query
  defaults/validation, direct broker-profile body pass-through, method/path
  inertness, and sidecar bearer-token checks.
- Keep `/api/v1/connect/device/*` out of scope for the dedicated device-sync
  runtime parity slice.
- Defer real Connect token lifecycle, cloud HTTP clients, broker sync
  orchestration, local sync repositories, entitlement checks, and event
  production to dedicated Connect runtime parity slices.
- Keep routes guarded behind explicit TS runtime handler wiring and sidecar
  token checks in tests.

No production TS default, domain-level Rust/TS mixing in production, or Rust
accounts/settings/limits/taxonomies/custom-provider/goals/exchange-rate/health/provider-settings/portfolio-job/event-stream
secret storage, AI provider runtime, alternative asset runtime, asset runtime,
app utility runtime, portfolio metrics runtime, holdings runtime, add-on
runtime, market-data runtime, activities/import runtime, or AI chat runtime
deletion, real sync crypto runtime implementation, real health/classification
runtime implementation, real Connect runtime implementation, or device-sync
runtime implementation is in scope for this slice.

## Next slices

1. Continue other low-risk/high-risk route seams before calculation-heavy work.
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
