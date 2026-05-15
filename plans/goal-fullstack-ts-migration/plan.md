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
validation, bounded import-apply, goal-plan persistence, local AI chat
thread/message persistence, bounded health status/check runtime, and bounded
health legacy-classification runtime slices in the standalone TS backend:

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
- Add bounded retirement goal-plan writes for `POST /api/v1/goals/plan`,
  including Rust-compatible retirement plan JSON validation, `birthYearMonth`
  current-age normalization, unknown settings preservation,
  duplicate/participating DC account link guards, versioned `goal_plans`
  upserts, and `goal_plans` sync event queuing.
- Add bounded save-up preview calculations for
  `POST /api/v1/goals/save-up/preview`, including Rust-compatible input
  validation, local-date projection math, monthly contribution solving,
  completion-date search, and trajectory generation.
- Add bounded save-up goal overview service parity, including funding-share
  valuation-map current values, optional plan settings defaults, and
  achieved/archived summary-current-value fallback behavior.
- Add bounded goal summary refresh service parity for non-retirement and no-plan
  retirement goals, including six-field summary updates, projected-field
  preservation/clearing, achieved health overrides, and projected/target health
  thresholds.
- Add guarded valuation-backed goal calculation route seams for
  `/api/v1/goals/{id}/refresh-summary` and `/api/v1/goals/{id}/save-up/overview`
  through an injectable valuation provider.
- Wire standalone runtime goal valuation-map construction from latest
  `daily_account_valuation` rows for active, non-archived accounts, and add
  guarded `/api/v1/goals/refresh-summaries` routing with per-goal error
  isolation.
- Refresh goal summaries after successful funding and goal-plan saves when a
  runtime valuation provider is available, preserving save success when the
  post-save refresh cannot run.
- Add the first plan-backed retirement calculation prerequisite by preparing
  Rust-compatible retirement simulation inputs in the TS goals service:
  normalized/validated plan JSON, funding-share current portfolio, tax-bucket
  balances injected into `tax.withdrawalBuckets`, and `planner_mode` defaulting
  to `fire`.
- Add the first deterministic retirement calculation primitives in TS:
  tax-bucket scaling/growth/contribution routing, gross-up and finite-bucket
  withdrawals, expense/income/DC payout helpers, return/glide-path helpers, and
  pension fund stepping.
- Add deterministic required-capital and projection engine parity in TS,
  including schedule-feasibility binary search, FIRE/traditional
  retirement-start decisions, yearly snapshots, coast amount, and pension asset
  tracking.
- Add deterministic retirement overview assembly in TS, including target
  reconciliation, budget breakdown, required-capital trajectory, material
  shortfall tolerance, required additional contribution, later-age FI
  suggestion, status mapping, and camelCase DTO fields.
- Add guarded plan-backed retirement overview routing for
  `GET /api/v1/goals/{id}/retirement/overview`, including valuation-provider
  501/503 handling, non-retirement/missing-plan errors, and stored/default
  planner-mode behavior.
- Add plan-backed retirement summary refresh parity by deriving retirement
  summary targets, projected dates/values, and health from deterministic
  overview output while preserving no-plan clearing and unreachable-target
  fallback behavior.
- Add guarded retirement projection routing for
  `POST /api/v1/goals/retirement/projection`, including direct plan validation,
  goal-backed input resolution, planner-mode handling, and valuation-provider
  501/503 behavior.
- Add guarded retirement Monte Carlo routing for
  `POST /api/v1/goals/retirement/monte-carlo`, including direct plan validation,
  goal-backed input resolution, planner-mode handling, HTTP simulation-count
  default/clamp behavior, deterministic seeded stochastic paths, Rust-compatible
  percentile/result DTOs, and valuation-provider 501/503 behavior.
- Add guarded retirement scenario-analysis routing for
  `POST /api/v1/goals/retirement/scenario-analysis`, including direct plan
  validation, goal-backed input resolution, planner-mode handling,
  Rust-compatible scenario deltas/result DTOs, and valuation-provider 501/503
  behavior.
- Add guarded sequence-of-returns retirement routing for
  `POST /api/v1/goals/retirement/sequence-of-returns`, including direct plan
  validation, goal-backed plan resolution, Rust-compatible scenario/path
  semantics, glide-path return handling, and valuation-provider 501/503
  behavior.
- Add guarded retirement stress-test routing for
  `POST /api/v1/goals/retirement/stress-tests`, including direct plan
  validation, goal-backed input resolution, planner-mode handling,
  Rust-compatible stress scenarios/outcomes/deltas/severity ordering,
  early-crash SORR integration, and valuation-provider 501/503 behavior.
- Add guarded retirement decision-sensitivity routing for
  `POST /api/v1/goals/retirement/decision-sensitivity-map`, including direct
  plan validation, goal-backed input resolution, planner-mode handling,
  Rust-compatible contribution/return and retirement-age/spending matrices,
  current-value cell scaling, and valuation-provider 501/503 behavior.
- Add local AI chat thread/message persistence for `/api/v1/ai/threads`,
  `/api/v1/ai/threads/{id}`, `/messages`, and `/api/v1/ai/tool-result`,
  including thread sort/search/cursor pagination, message reads, thread
  update/delete behavior, tool-result patch merging, and an explicit 501 for
  still-deferred AI chat streaming.
- Add bounded net-worth current/history runtime for `/api/v1/net-worth` and
  `/api/v1/net-worth/history`, including latest holdings snapshots, cash
  balances, standalone alternative assets/liabilities, minor-currency quote
  normalization, FX conversion/fallback behavior, staleness metadata, TOTAL
  account valuation history, and filled alternative-asset quote history.
- Add bounded income summary runtime for `/api/v1/income/summary`, including
  income activity reads, account filtering, asset-backed income fallback
  amounts, FX conversion/fallback behavior, period totals, monthly averages, YoY
  growth, and breakdowns by month/type/asset/currency/account.
- Add bounded simple account performance runtime for
  `/api/v1/performance/accounts/simple`, including active-account defaulting,
  latest and exact previous-day valuation reads, TOTAL portfolio weighting,
  cumulative/day return formulas, and null/clamp edge cases.
- Add bounded health status/check runtime for `/api/v1/health/status` and
  `/api/v1/health/check`, including account tracking-mode issues, timezone
  missing/invalid/mismatch issues with offset-equivalence parity, severity
  rollups, dismissal filtering, stale cache behavior, and standalone runtime
  wiring.
- Add bounded health fix runtime for `migrate_legacy_classifications` by
  dispatching `/api/v1/health/fix` through the migrated taxonomy runtime while
  keeping price sync, retry sync, FX fetch, and other fix actions deferred.
- Add bounded legacy-classification health issue generation by surfacing
  migrated taxonomy migration status as `classification:legacy_migration:*`
  health issues with a `migrate_legacy_classifications` fix action.
- Keep still-deferred symbol-only asset creation, quote fallback writes,
  provider-backed asset resolution, device-sync outbox emission, and portfolio
  recalculation side effects for dedicated parity slices.
- Preserve the existing guarded handler model for unimplemented/high-risk
  domains and keep Electron/Rust sidecar defaults unchanged until cutover gates
  are ready.

No production TS default, domain-level Rust/TS mixing in production, or Rust
accounts/settings/limits/taxonomies/custom-provider/goals/exchange-rate/health/provider-settings/portfolio-job/event-stream
provider sync, portfolio recalculation side effects, keyring storage, AI chat
streaming/provider/tool execution runtime, quote-provider interactions,
auto-classification side effects, portfolio metrics runtime beyond
current/historical net-worth, income summary, and simple account performance,
holdings runtime, add-on runtime, broader market-data runtime beyond
mapping/templates/duplicate lookups, read-only search, transfer link/unlink,
single activity delete, and bounded existing-asset/cash/symbol-resolved activity
create/update/bulk persistence plus CSV parse/read-only asset preview/read-only
import validation and bounded import apply, save-up preview calculations, local
AI chat thread/message persistence, bounded health account/timezone
status/checks and legacy-classification issue generation,
sync-crypto/device-sync integration, calculation-heavy health checks or
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
