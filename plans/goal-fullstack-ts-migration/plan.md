# Full-stack TypeScript Migration Plan

## Problem and approach

Migrate Wealthfolio from an Electron shell backed by a Rust sidecar to a
full-stack TypeScript/Bun backend without losing current desktop/web behavior.
The Rust backend remains the reference oracle until TS parity is proven; runtime
cutover happens as a whole backend instead of production dual-writing live
SQLite data.

## Current execution slice

PR 4 establishes compatibility preflights before domain migration begins:

- Lock desktop keyring service/account formatting, including Electron dev
  namespace behavior.
- Keep web/Electron command registry deltas explicit and tested.
- Keep addon host canary backend commands and required globals visible.
- Keep mixed-version device-sync/Connect commands visible before TS cutover.

No domain repositories, production TS default, or Rust runtime deletion is in
scope for PR 4.

## Next slices

1. Migrate backend domains in vertical slices with Rust-vs-TS parity evidence.
2. Cut over Electron/web to the TS backend by default after parity and rollback
   gates are satisfied.
3. Remove Rust backend/runtime artifacts only after the TS-only architecture is
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
