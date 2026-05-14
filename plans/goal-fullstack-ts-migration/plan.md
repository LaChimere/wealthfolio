# Full-stack TypeScript Migration Plan

## Problem and approach

Migrate Wealthfolio from an Electron shell backed by a Rust sidecar to a
full-stack TypeScript/Bun backend without losing current desktop/web behavior.
The Rust backend remains the reference oracle until TS parity is proven; runtime
cutover happens as a whole backend instead of production dual-writing live
SQLite data.

## Current execution slice

PR 5 continues vertical slices by adding contribution-limit deposit calculation
runtime parity to the standalone TS backend:

- Replace the prior injectable-only contribution deposit seam with a
  SQLite-backed calculator wired into runtime composition.
- Mirror Rust contribution rules for `DEPOSIT`, `TRANSFER_IN`, `TRANSFER_OUT`,
  and `CREDIT`, including internal transfer-pair exclusion and external-flow
  metadata checks.
- Preserve Rust-style activity/account filtering, user-timezone year ranges,
  inclusive explicit end dates, FX conversion dates, and numeric response
  shapes.
- Preserve the existing guarded handler model for unimplemented/high-risk
  domains and keep Electron/Rust sidecar defaults unchanged until cutover gates
  are ready.

No production TS default, domain-level Rust/TS mixing in production, or Rust
accounts/settings/limits/taxonomies/custom-provider/goals/exchange-rate/health/provider-settings/portfolio-job/event-stream
provider sync, portfolio recalculation side effects, keyring storage, AI chat
runtime, alternative asset runtime, asset runtime, portfolio metrics runtime,
holdings runtime, add-on runtime, market-data runtime, activities/import
runtime, sync-crypto/device-sync integration, real health status/check/fix
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
