# Full-stack TypeScript Migration Plan

## Problem and approach

Migrate Wealthfolio from an Electron shell backed by a Rust sidecar to a
full-stack TypeScript/Bun backend without losing current desktop/web behavior.
The Rust backend remains the reference oracle until TS parity is proven; runtime
cutover happens as a whole backend instead of production dual-writing live
SQLite data.

## Current execution slice

PR 1 establishes the TS backend contract foundation only:

- Represent the current web and Electron command surfaces in typed TS helpers.
- Classify backend, Electron-native, Electron-only, and web-only command gaps.
- Define deterministic parity normalization for decimals, temporal values,
  errors, and object snapshots.
- Add smoke parity and addon-host canary fixtures for later runtime/domain
  slices.
- Make the package part of the Bun/TypeScript workspace checks.

No runtime behavior changes are in scope for PR 1.

## Next slices

1. Add guarded TS backend runtime skeleton while Rust remains default.
2. Add TS SQLite migration/open/backup foundation compatible with current DBs.
3. Add compatibility preflights for keyring IDs, addon host, command aliases,
   and mixed-version sync expectations.
4. Migrate backend domains in vertical slices with Rust-vs-TS parity evidence.
5. Cut over Electron/web to the TS backend by default after parity and rollback
   gates are satisfied.
6. Remove Rust backend/runtime artifacts only after the TS-only architecture is
   proven and documented.

## Verification

- Targeted package tests: `bun run --cwd packages/backend-contracts test`
- Targeted package type check:
  `bun run --cwd packages/backend-contracts type-check`
- Full repo check before commit: `bun run check`
