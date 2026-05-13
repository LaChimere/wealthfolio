# Full-stack TypeScript Migration Plan

## Problem and approach

Migrate Wealthfolio from an Electron shell backed by a Rust sidecar to a
full-stack TypeScript/Bun backend without losing current desktop/web behavior.
The Rust backend remains the reference oracle until TS parity is proven; runtime
cutover happens as a whole backend instead of production dual-writing live
SQLite data.

## Current execution slice

PR 5 continues vertical slices with a guarded sync crypto HTTP seam after the AI
chat route seam:

- Add a `SyncCryptoService` interface and guarded `/sync/crypto/*` route tests
  for root key, DEK derivation, keypair, shared/session key derivation,
  encrypt/decrypt, pairing-code/hash, HMAC, SAS, and device-id commands.
- Preserve Rust HTTP semantics for POST-only routes, no-body endpoints ignoring
  invalid request bodies, exact camelCase body fields, empty-string
  pass-through, `u32` version validation, direct `{ value }` and
  `{ publicKey, secretKey }` response shapes, 400 crypto operation errors, route
  inertness, and sidecar bearer-token checks.
- Defer real TypeScript cryptographic implementation, key material handling,
  WebCrypto/libsodium selection, and device-sync integration to dedicated
  sync-crypto/runtime parity slices.
- Keep routes guarded behind explicit TS runtime handler wiring and sidecar
  token checks in tests.

No production TS default, domain-level Rust/TS mixing in production, or Rust
accounts/settings/limits/taxonomies/custom-provider/goals/exchange-rate/health/provider-settings/portfolio-job/event-stream
secret storage, AI provider runtime, alternative asset runtime, asset runtime,
app utility runtime, portfolio metrics runtime, holdings runtime, add-on
runtime, market-data runtime, activities/import runtime, or AI chat runtime
deletion, or real sync crypto runtime implementation is in scope for this slice.

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
