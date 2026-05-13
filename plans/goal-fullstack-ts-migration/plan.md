# Full-stack TypeScript Migration Plan

## Problem and approach

Migrate Wealthfolio from an Electron shell backed by a Rust sidecar to a
full-stack TypeScript/Bun backend without losing current desktop/web behavior.
The Rust backend remains the reference oracle until TS parity is proven; runtime
cutover happens as a whole backend instead of production dual-writing live
SQLite data.

## Current execution slice

PR 3 establishes the TS SQLite foundation while Rust remains the runtime source
of truth:

- Use `bun:sqlite` for the TS storage layer.
- Load the existing Rust/Diesel SQL migration directory as the TS source of
  truth.
- Preserve Diesel-compatible `__diesel_schema_migrations` bookkeeping.
- Apply the same connection and migration PRAGMA profiles used by Rust.
- Add backup/restore helpers compatible with the current `VACUUM INTO` and
  pre-restore backup behavior.

No domain repositories, production TS default, or Rust storage deletion is in
scope for PR 3.

## Next slices

1. Add compatibility preflights for keyring IDs, addon host, command aliases,
   and mixed-version sync expectations.
2. Migrate backend domains in vertical slices with Rust-vs-TS parity evidence.
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
- Full repo check before commit: `bun run check`
