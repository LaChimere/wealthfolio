# Full-stack TypeScript Migration Plan

## Problem and approach

Migrate Wealthfolio from an Electron shell backed by a Rust sidecar to a
full-stack TypeScript/Bun backend without losing current desktop/web behavior.
The Rust backend remains the reference oracle until TS parity is proven; runtime
cutover happens as a whole backend instead of production dual-writing live
SQLite data.

## Current execution slice

PR 5 continues vertical slices with market-data provider settings after the
local health-state slice:

- Add TS market-data provider settings repository/service behavior and guarded
  route tests for provider info reads plus priority/enabled updates.
- Preserve Rust provider-settings semantics: providers load from
  `market_data_providers`, capabilities are static by provider ID, API-key flags
  honor enabled/required-provider rules, quote sync stats and error attribution
  come from `quote_sync_state`, and update refreshes the injectable quote
  client.
- Defer market-data search, quote history/latest/update/delete/import, Yahoo
  dividends, symbol resolution, exchange list, and sync endpoints to later
  market-data/calculation slices because those paths require provider HTTP
  clients, quote import parsing, portfolio recalculation jobs, exchange
  metadata, and market sync parity.
- Keep routes guarded behind explicit TS runtime handler wiring and sidecar
  token checks in tests.

No production TS default, domain-level Rust/TS mixing in production, or Rust
accounts/settings/limits/taxonomies/custom-provider/goals/exchange-rate/health/provider-settings
deletion is in scope for this slice.

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
