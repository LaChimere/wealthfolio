# Full-stack TypeScript Migration Plan

## Problem and approach

Migrate Wealthfolio from an Electron shell backed by a Rust sidecar to a
full-stack TypeScript/Bun backend without losing current desktop/web behavior.
The Rust backend remains the reference oracle until TS parity is proven; runtime
cutover happens as a whole backend instead of production dual-writing live
SQLite data.

## Current execution slice

PR 5 continues low-risk vertical slices with scoped goals base persistence after
custom providers:

- Add TS goals repository/service behavior and guarded route tests for
  list/get/create/update/delete, funding rule reads/replacement, and read-only
  goal plan access.
- Preserve Rust base-persistence semantics: list order by priority descending,
  generated goal/funding IDs, `targetAmount` null/zero mapping, lifecycle and
  retirement uniqueness guards, retirement seed funding from eligible accounts,
  cross-goal funding capacity validation, non-retirement tax-bucket clearing,
  DC-linked account guards, idempotent deletes, and sync hooks.
- Defer goal plan write/delete, summary refresh, save-up overview, and
  retirement simulation endpoints to dedicated calculation-heavy slices because
  they require retirement plan validation/calculation parity.
- Keep routes guarded behind explicit TS runtime handler wiring and sidecar
  token checks in tests.

No production TS default, domain-level Rust/TS mixing in production, or Rust
accounts/settings/limits/taxonomies/custom-provider/goals deletion is in scope
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
