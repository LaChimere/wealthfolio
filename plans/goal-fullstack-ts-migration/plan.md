# Full-stack TypeScript Migration Plan

## Problem and approach

Migrate Wealthfolio from an Electron shell backed by a Rust sidecar to a
full-stack TypeScript/Bun backend without losing current desktop/web behavior.
The Rust backend remains the reference oracle until TS parity is proven; runtime
cutover happens as a whole backend instead of production dual-writing live
SQLite data.

## Current execution slice

PR 2 establishes the guarded TS backend runtime skeleton while keeping Rust as
the default backend:

- Add `apps/backend` as a Bun/TypeScript backend runtime migration target.
- Serve only health/readiness and auth-status skeleton routes.
- Mirror Rust fail-closed config checks for sidecar token, CORS/auth, listener,
  request timeout, and secret key basics.
- Add sidecar-token middleware helpers and guarded debug/test coverage.
- Add Electron runtime selection that defaults to Rust and can explicitly spawn
  the TS backend as a Bun child process in dev/test.

No domain command routing, production TS default, or Rust sidecar deletion is in
scope for PR 2.

## Next slices

1. Add TS SQLite migration/open/backup foundation compatible with current DBs.
2. Add compatibility preflights for keyring IDs, addon host, command aliases,
   and mixed-version sync expectations.
3. Migrate backend domains in vertical slices with Rust-vs-TS parity evidence.
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
- Full repo check before commit: `bun run check`
