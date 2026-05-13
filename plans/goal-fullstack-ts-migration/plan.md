# Full-stack TypeScript Migration Plan

## Problem and approach

Migrate Wealthfolio from an Electron shell backed by a Rust sidecar to a
full-stack TypeScript/Bun backend without losing current desktop/web behavior.
The Rust backend remains the reference oracle until TS parity is proven; runtime
cutover happens as a whole backend instead of production dual-writing live
SQLite data.

## Current execution slice

PR 5 continues low-risk domain vertical slices with taxonomy read parity after
the settings, accounts, and contribution limits slices:

- Add TS taxonomy read models, repository/service behavior, and guarded route
  tests.
- Preserve Rust taxonomy/category read semantics: sort order, boolean mapping,
  timestamp shape, and `null` missing detail responses.
- Keep taxonomy mutation/assignment/import-export work in follow-up atomic
  sub-slices because those paths involve validation, sync bundles, and migration
  services.
- Keep routes guarded behind explicit TS runtime handler wiring and sidecar
  token checks in tests.

No production TS default, domain-level Rust/TS mixing in production, or Rust
accounts/settings/limits/taxonomies deletion is in scope for this slice.

## Next slices

1. Continue taxonomy sub-slices: mutation/category CRUD, assignments,
   import/export JSON, sync hooks, then migration/health endpoints.
2. Migrate calculation-heavy domains with Rust-vs-TS parity evidence.
3. Cut over Electron/web to the TS backend by default after parity and rollback
   gates are satisfied.
4. Remove Rust backend/runtime artifacts only after the TS-only architecture is
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
