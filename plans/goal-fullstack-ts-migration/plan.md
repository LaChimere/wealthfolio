# Full-stack TypeScript Migration Plan

## Problem and approach

Migrate Wealthfolio from an Electron shell backed by a Rust sidecar to a
full-stack TypeScript/Bun backend without losing current desktop/web behavior.
The Rust backend remains the reference oracle until TS parity is proven; runtime
cutover happens as a whole backend instead of production dual-writing live
SQLite data.

## Current execution slice

PR 5 continues vertical slices by adding a contained market-data latest quote
snapshot runtime slice to the standalone TS backend:

- Add SQLite-backed `/api/v1/market-data/quotes/latest` behavior with the Rust
  latest-quote source priority (`MANUAL`, then `BROKER`, then providers).
- Read asset and quote-sync context to compute snapshot staleness, market
  effective dates, quote dates, and contextual no-quote reasons.
- Preserve Rust market-date behavior for exchange timezone, close-time grace,
  weekend rollback, and UTC fallback.
- Preserve Rust quote-currency reconciliation, including minor-unit currency
  spelling, and the no-quote reason priority ladder.
- Keep remaining high-risk market-data methods optional so provider
  search/resolve, Yahoo dividends, CSV import/check, sync, and recalculation
  side effects remain `404` until their dedicated parity slices.
- Preserve the existing guarded handler model for unimplemented/high-risk
  domains and keep Electron/Rust sidecar defaults unchanged until cutover gates
  are ready.

No production TS default, domain-level Rust/TS mixing in production, or Rust
accounts/settings/limits/taxonomies/custom-provider/goals/exchange-rate/health/provider-settings/portfolio-job/event-stream
provider sync, quote CSV import/check, portfolio recalculation side effects,
keyring storage, AI chat runtime, quote-provider interactions,
auto-classification side effects, portfolio metrics runtime, holdings runtime,
add-on runtime, broader market-data runtime, activities/import runtime,
sync-crypto/device-sync integration, real health status/check/fix runtime
implementation, real Connect runtime implementation, real device-sync runtime
implementation, or Rust runtime removal is in scope for this slice.

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
