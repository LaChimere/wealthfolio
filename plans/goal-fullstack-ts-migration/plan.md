# Full-stack TypeScript Migration Plan

## Problem and approach

Migrate Wealthfolio from an Electron shell backed by a Rust sidecar to a
full-stack TypeScript/Bun backend without losing current desktop/web behavior.
The Rust backend remains the reference oracle until TS parity is proven; runtime
cutover happens as a whole backend instead of production dual-writing live
SQLite data.

## Current execution slice

PR 5 continues vertical slices with a guarded device-sync device-management HTTP
seam after the Connect device-sync route seam:

- Add an injectable `DeviceSyncService` seam for `/api/v1/sync/device/*` and
  `/api/v1/sync/devices` routes covering register, current-device lookup, device
  lookup, list, update, delete, and revoke.
- Preserve Rust HTTP semantics for required camelCase register fields, optional
  update display names, empty-string scope passthrough, static-vs-dynamic route
  boundaries, decoded path IDs, malformed path encoding errors, method/path
  inertness, and sidecar bearer-token checks.
- Keep service implementations responsible for Rust-equivalent token, cloud,
  device-id secret, and enrollment side effects.
- Defer team keys, pairing, E2EE, token lifecycle, feature-flag errors, and
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
