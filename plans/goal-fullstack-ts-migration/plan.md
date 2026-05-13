# Full-stack TypeScript Migration Plan

## Problem and approach

Migrate Wealthfolio from an Electron shell backed by a Rust sidecar to a
full-stack TypeScript/Bun backend without losing current desktop/web behavior.
The Rust backend remains the reference oracle until TS parity is proven; runtime
cutover happens as a whole backend instead of production dual-writing live
SQLite data.

## Current execution slice

PR 5 starts low-risk domain vertical slices with settings:

- Add TS settings models, repository/service behavior, and route tests.
- Preserve Rust defaults and boolean parsing for `app_settings`.
- Canonicalize and reject invalid IANA timezones before persistence.
- Keep the route guarded behind explicit TS runtime handler wiring and sidecar
  token checks in tests.

No production TS default, domain-level Rust/TS mixing in production, or Rust
settings deletion is in scope for this slice.

## Next slices

1. Continue low-risk domain slices: accounts, contribution limits, taxonomies,
   and other CRUD/read-heavy domains.
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
