# Full-stack TypeScript Migration Plan

## Problem and approach

Migrate Wealthfolio from an Electron shell backed by a Rust sidecar to a
full-stack TypeScript/Bun backend without losing current desktop/web behavior.
The Rust backend remains the reference oracle until TS parity is proven; runtime
cutover happens as a whole backend instead of production dual-writing live
SQLite data.

## Current execution slice

PR 5 continues vertical slices by extending contained activity
create/update/bulk, CSV parse, read-only asset-preview, read-only import
validation, bounded import-apply, save-up goal-plan persistence, local AI chat
thread/message persistence, bounded health status/check runtime, and bounded
health classification-fix runtime slices in the standalone TS backend:

- Add TS SQLite runtime behavior for `POST /api/v1/activities`,
  `PUT /api/v1/activities`, and `POST /api/v1/activities/bulk` when requests
  provide cash activity data, an existing `asset.id`, or an `asset.symbol` that
  resolves to exactly one existing SQLite asset.
- Preserve Rust-compatible generated activity IDs, strict date handling,
  subtype/status defaults, decimal patch semantics, absolute economic signs,
  minor-currency normalization, securities-transfer amount clearing,
  source/idempotency preservation, duplicate detection, bulk created mappings,
  per-entry bulk errors, atomic no-write-on-error behavior, and response
  mapping.
- Add activity CSV parsing for `/api/v1/activities/import/parse` with
  Rust-compatible delimiter detection, header/no-header handling, skip rows,
  empty-row filtering, UTF-8/UTF-16 BOM handling, Windows-1252 fallback
  warnings, quote characters, row normalization, structure warnings, detected
  config, and runtime route wiring.
- Add read-only asset preview for `/api/v1/activities/import/preview-assets`
  with existing-asset matches, bounded new-asset drafts, validation errors, and
  ambiguity-safe duplicate-symbol handling without provider fetches or writes.
- Add read-only import validation for `/api/v1/activities/import/check` with
  account checks, existing-asset resolution, bounded symbol resolution,
  create-normalization validation, existing duplicate warnings, and in-batch
  duplicate warnings without import writes.
- Add bounded import apply for `/api/v1/activities/import` with validation
  gating, existing-asset/cash activity inserts, CSV import-run metadata,
  duplicate skipping, `forceImport`, import summaries, and cross-account
  transfer-pair auto-linking plus FX pair ensure through the migrated
  exchange-rate runtime.
- Add bounded save-up goal-plan writes for `POST /api/v1/goals/plan` and
  `DELETE /api/v1/goals/{id}/plan`, including versioned `goal_plans` upserts,
  unknown settings preservation, unconditional 204 deletes, and `goal_plans`
  sync event queuing.
- Add local AI chat thread/message persistence for `/api/v1/ai/threads`,
  `/api/v1/ai/threads/{id}`, `/messages`, and `/api/v1/ai/tool-result`,
  including thread sort/search/cursor pagination, message reads, thread
  update/delete behavior, tool-result patch merging, and an explicit 501 for
  still-deferred AI chat streaming.
- Add bounded health status/check runtime for `/api/v1/health/status` and
  `/api/v1/health/check`, including account tracking-mode issues, timezone
  missing/invalid/mismatch issues with offset-equivalence parity, severity
  rollups, dismissal filtering, stale cache behavior, and standalone runtime
  wiring.
- Add bounded health fix runtime for `migrate_legacy_classifications` by
  dispatching `/api/v1/health/fix` through the migrated taxonomy runtime while
  keeping price sync, retry sync, FX fetch, and other fix actions deferred.
- Keep still-deferred symbol-only asset creation, quote fallback writes,
  provider-backed asset resolution, device-sync outbox emission, and portfolio
  recalculation side effects for dedicated parity slices.
- Keep retirement goal-plan validation/persistence, goal summary refresh, and
  retirement/save-up calculations deferred to dedicated goal/calculation parity
  slices.
- Preserve the existing guarded handler model for unimplemented/high-risk
  domains and keep Electron/Rust sidecar defaults unchanged until cutover gates
  are ready.

No production TS default, domain-level Rust/TS mixing in production, or Rust
accounts/settings/limits/taxonomies/custom-provider/goals/exchange-rate/health/provider-settings/portfolio-job/event-stream
provider sync, portfolio recalculation side effects, keyring storage, AI chat
streaming/provider/tool execution runtime, quote-provider interactions,
auto-classification side effects, portfolio metrics runtime, holdings runtime,
add-on runtime, broader market-data runtime, broader activities/import runtime
beyond mapping/templates/duplicate lookups, read-only search, transfer
link/unlink, single activity delete, and bounded
existing-asset/cash/symbol-resolved activity create/update/bulk persistence plus
CSV parse/read-only asset preview/read-only import validation and bounded import
apply, local AI chat thread/message persistence, bounded health account/timezone
status/checks, sync-crypto/device-sync integration, retirement goal-plan
validation/persistence or summary refresh, calculation-heavy health checks or
non-classification `/health/fix` execution, real Connect runtime implementation,
real device-sync runtime implementation, or Rust runtime removal is in scope for
this slice.

## Next slices

1. Continue remaining high-risk route seams before calculation-heavy work.
2. Migrate Connect/device-sync runtime behavior with dedicated service parity
   gates.
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
