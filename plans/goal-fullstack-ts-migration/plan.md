# Full-stack TypeScript Migration Plan

## Problem and approach

Migrate Wealthfolio from an Electron shell backed by a Rust sidecar to a
full-stack TypeScript/Bun backend without losing current desktop/web behavior.
The Rust backend remains the reference oracle until TS parity is proven; runtime
cutover happens as a whole backend instead of production dual-writing live
SQLite data.

## Current execution slice

PR 5 continues low-risk domain vertical slices with taxonomy assignment parity
after the settings, accounts, contribution limits, taxonomy read, and
taxonomy/category mutation slices:

- Add TS asset taxonomy assignment reads, upserts, deletes, and guarded route
  tests.
- Preserve Rust assignment semantics: natural-key upsert by
  `assetId/taxonomyId/categoryId`, original row identity/timestamps on conflict,
  single-select taxonomy replacement, idempotent missing deletes, and optional
  assignment sync hooks.
- Keep taxonomy import/export work in a follow-up atomic sub-slice because it
  adds recursive JSON tree behavior.
- Keep routes guarded behind explicit TS runtime handler wiring and sidecar
  token checks in tests.

No production TS default, domain-level Rust/TS mixing in production, or Rust
accounts/settings/limits/taxonomies deletion is in scope for this slice.

## Next slices

1. Continue taxonomy sub-slices: import/export JSON, then migration/health
   endpoints.
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
