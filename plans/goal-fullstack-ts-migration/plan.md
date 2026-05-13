# Full-stack TypeScript Migration Plan

## Problem and approach

Migrate Wealthfolio from an Electron shell backed by a Rust sidecar to a
full-stack TypeScript/Bun backend without losing current desktop/web behavior.
The Rust backend remains the reference oracle until TS parity is proven; runtime
cutover happens as a whole backend instead of production dual-writing live
SQLite data.

## Current execution slice

PR 5 continues vertical slices with a guarded device-sync team-key/reset HTTP
seam after the device-management route seam:

- Extend the injectable `DeviceSyncService` seam with optional team-key/reset
  methods for
  `/api/v1/sync/keys/{initialize,initialize/commit,rotate,rotate/commit}` and
  `/api/v1/sync/team/reset`.
- Preserve Rust HTTP semantics for body-ignoring initialize/rotate start routes,
  JSON body validation on commit/reset routes, i32 key-version bounds, optional
  challenge/recovery/reason fields, envelope validation, method/path inertness,
  and sidecar bearer-token checks.
- Keep service implementations responsible for Rust-equivalent token, cloud,
  device-id lookup, E2EE, key material, and reset side effects.
- Defer pairing flows, real key crypto/cloud runtime, feature-flag errors, and
  broader device-sync runtime behavior to dedicated follow-up slices.
- Keep routes guarded behind explicit TS runtime handler wiring and sidecar
  token checks in tests.

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
