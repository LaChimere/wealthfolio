# Full-stack TypeScript Migration Plan

## Problem and approach

Migrate Wealthfolio from an Electron shell backed by a Rust sidecar to a
full-stack TypeScript/Bun backend without losing current desktop/web behavior.
The Rust backend remains the reference oracle until TS parity is proven; runtime
cutover happens as a whole backend instead of production dual-writing live
SQLite data.

## Current execution slice

PR 5 continues vertical slices with a low-risk AI chat/thread HTTP seam after
the activities/import route seam:

- Add an `AiChatService` interface and guarded `/ai/chat/stream`,
  `/ai/threads/*`, and `/ai/tool-result` route tests for NDJSON streaming,
  thread list/get/messages/update/delete, tag reads/no-op mutations, and tool
  result updates.
- Preserve Rust HTTP semantics for NDJSON headers and newline framing,
  pre-stream and mid-stream AI error shapes/statuses, stream cancellation,
  query/path decoding, `u32` limit validation, optional update body handling,
  JSON `null` thread responses, tag no-op body validation, missing-thread tag
  defaults, tool-result `resultPatch` presence, and sidecar bearer-token checks.
- Defer real AI chat service persistence, provider streaming, tool execution,
  thread storage, tag persistence, and tool-result mutation behavior to
  dedicated AI runtime parity slices.
- Keep routes guarded behind explicit TS runtime handler wiring and sidecar
  token checks in tests.

No production TS default, domain-level Rust/TS mixing in production, or Rust
accounts/settings/limits/taxonomies/custom-provider/goals/exchange-rate/health/provider-settings/portfolio-job/event-stream
secret storage, AI provider runtime, alternative asset runtime, asset runtime,
app utility runtime, portfolio metrics runtime, holdings runtime, add-on
runtime, market-data runtime, activities/import runtime, or AI chat runtime
deletion is in scope for this slice.

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
