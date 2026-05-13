# Full-stack TypeScript Migration Plan

## Problem and approach

Migrate Wealthfolio from an Electron shell backed by a Rust sidecar to a
full-stack TypeScript/Bun backend without losing current desktop/web behavior.
The Rust backend remains the reference oracle until TS parity is proven; runtime
cutover happens as a whole backend instead of production dual-writing live
SQLite data.

## Current execution slice

PR 5 continues low-risk domain vertical slices with taxonomy/category mutation
parity after the settings, accounts, contribution limits, and taxonomy read
slices:

- Add TS taxonomy/category create, update, delete, move-category repository and
  service behavior with guarded route tests.
- Preserve Rust taxonomy/category mutation semantics: caller-supplied IDs,
  generated IDs when omitted, system taxonomy delete rejection, category
  child/assignment delete guards, idempotent missing deletes, and custom
  taxonomy sync bundle/delete hooks.
- Keep taxonomy assignment and import/export work in follow-up atomic sub-slices
  because those paths add separate upsert/replacement and JSON tree behavior.
- Keep routes guarded behind explicit TS runtime handler wiring and sidecar
  token checks in tests.

No production TS default, domain-level Rust/TS mixing in production, or Rust
accounts/settings/limits/taxonomies deletion is in scope for this slice.

## Next slices

1. Continue taxonomy sub-slices: assignments, import/export JSON, then
   migration/health endpoints.
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
