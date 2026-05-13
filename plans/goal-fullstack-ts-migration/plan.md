# Full-stack TypeScript Migration Plan

## Problem and approach

Migrate Wealthfolio from an Electron shell backed by a Rust sidecar to a
full-stack TypeScript/Bun backend without losing current desktop/web behavior.
The Rust backend remains the reference oracle until TS parity is proven; runtime
cutover happens as a whole backend instead of production dual-writing live
SQLite data.

## Current execution slice

PR 5 continues vertical slices with a low-risk add-ons HTTP seam after the
holdings route seam:

- Add an `AddonService` interface and guarded `/addons` route tests for
  installed add-ons, zip install/extract, toggle/uninstall/runtime loading,
  startup loading, store listings/ratings/update checks, staging
  download/install, and staging cleanup.
- Preserve Rust HTTP semantics for route methods, path decoding, zipDataB64
  precedence over zipData, byte-array validation, enable-after-install defaults,
  `u8` rating validation, `Option<String>` null normalization, unconditional
  empty rating reads, 204 mutation statuses, and sidecar bearer-token checks.
- Defer real add-on filesystem extraction, manifest validation, sandbox/runtime
  loading, store HTTP requests, staging I/O, and add-on update behavior to
  dedicated add-on runtime parity slices.
- Keep routes guarded behind explicit TS runtime handler wiring and sidecar
  token checks in tests.

No production TS default, domain-level Rust/TS mixing in production, or Rust
accounts/settings/limits/taxonomies/custom-provider/goals/exchange-rate/health/provider-settings/portfolio-job/event-stream
secret storage, AI provider runtime, alternative asset runtime, asset runtime,
app utility runtime, portfolio metrics runtime, holdings runtime, or add-on
runtime deletion is in scope for this slice.

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
