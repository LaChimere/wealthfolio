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
validation, bounded import-apply, activity mutation event production, goal-plan
persistence, local AI chat thread/message persistence, domain-event planning,
batch processing, and worker helper, bounded health status/check runtime, and
bounded health legacy-classification runtime slices in the standalone TS
backend:

- Add TS SQLite runtime behavior for `POST /api/v1/activities`,
  `PUT /api/v1/activities`, and `POST /api/v1/activities/bulk` when requests
  provide cash activity data, an existing `asset.id`, or an `asset.symbol` that
  resolves to exactly one existing SQLite asset or includes enough explicit
  metadata to create a bounded local asset.
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
  update/delete behavior, tool-result patch merging, thread tag add/remove/list
  persistence, and an explicit 501 for still-deferred AI chat streaming.
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
- Add bounded account performance history/summary runtime for
  `/api/v1/performance/history` and `/api/v1/performance/summary`, including
  account valuation history reads, TWR/MWR compounding, holdings-mode return
  behavior, annualized/simple returns, volatility, max drawdown, and explicit
  provider-backed symbol-history deferral.
- Add bounded holdings valuation read runtime for `/api/v1/valuations/history`
  and `/api/v1/valuations/latest`, including active-account defaulting,
  request-order preservation, filtered history ranges, numeric valuation fields,
  and explicit 501 gates for still-deferred snapshot writes and imports.
- Add bounded holdings snapshot metadata read runtime for `/api/v1/snapshots`,
  including account/date filters, source defaults, position/cash currency
  counts, and explicit 501 gates for still-deferred deletion, save/import, and
  allocations.
- Add bounded historical snapshot holdings read runtime for
  `/api/v1/snapshots/holdings`, including stored snapshot-to-holding conversion,
  asset metadata joins, cash balance holdings, zero-quantity/missing-asset
  filtering, base-currency injection, and explicit gates for still-deferred
  deletion, save/import, and allocations.
- Add bounded holdings import check runtime for
  `/api/v1/snapshots/import/check`, including account existence checks,
  date/quantity/average-cost validation, existing snapshot date detection, exact
  local asset symbol matching, and explicit gates for provider-backed symbol
  search plus import writes.
- Add bounded live holdings fan-out runtime for `/api/v1/holdings`, including
  latest snapshot reads, security/alternative/cash valuation, minor-currency
  normalization, quote source priority, contract multipliers, FX fallbacks,
  expired option filtering, base-value weights, and missing quote/asset
  handling.
- Add bounded holding detail and by-asset fan-out runtime for
  `/api/v1/holdings/item` and `/api/v1/holdings/by-asset`, including null
  missing/expired behavior, build-failure error parity, active-account fan-out,
  and per-account weight semantics.
- Add bounded portfolio allocation read runtime for `/api/v1/allocations` and
  `/api/v1/allocations/holdings`, including taxonomy rollups, cash bucket
  behavior, Unknown categories, partial assignment weights, custom taxonomies,
  omitted empty children, and weighted drill-down holding summaries.
- Add bounded holdings snapshot deletion runtime for `DELETE /api/v1/snapshots`,
  including missing/calculated snapshot guards, manual/imported row deletion,
  and explicit deferral of recalculation side effects.
- Add bounded manual holdings snapshot save runtime for
  `POST /api/v1/snapshots`, including account/date/decimal validation, minimal
  manual asset creation, manual quote-mode updates, weighted manual quote
  upserts, duplicate same-asset aggregation, stable snapshot IDs, manual
  snapshot upserts, and synthetic backfill snapshot creation.
- Add bounded holdings snapshot import-write runtime for
  `POST /api/v1/snapshots/import`, including top-level account validation,
  per-snapshot success/failure accounting, `CSV_IMPORT` snapshot persistence,
  local exact-symbol/minimal-asset creation, duplicate same-asset aggregation,
  invalid optional average-cost-to-zero behavior, and synthetic history
  backfill.
- Add bounded holdings snapshot FX side effects for manual and imported snapshot
  saves by collecting holding, asset quote-currency, cash, and account-to-base
  currency pairs and calling the migrated `ensureFxPairs` hook before snapshot
  persistence.
- Add provider-backed holdings import-check symbol lookup by routing
  `/api/v1/snapshots/import/check` through the migrated market-data search
  runtime after local exact-symbol lookup, requiring exact provider symbol
  matches, and treating provider failures as non-fatal misses.
- Add bounded holdings snapshot mutation event production by publishing
  Rust-shaped `holdings_changed` and `manual_snapshot_saved` events after
  successful manual/imported snapshot saves, publishing `holdings_changed` after
  manual/imported snapshot deletes, and wiring the standalone runtime shared
  event bus into holdings. Delete events are an intentional TS bridge until the
  broader TS portfolio job worker can replace Rust's inline delete recalculation
  path.
- Add bounded activity mutation event production by publishing Rust-shaped
  `activities_changed` events after successful create/update/delete, bulk,
  import, transfer link, and transfer unlink mutations with account/asset/
  currency sets plus UTC earliest-activity timestamps, and wiring the standalone
  runtime shared event bus into activities.
- Add bounded manual quote fallback writes for price-bearing activity
  create/update/bulk/import paths when assets are or are requested as MANUAL,
  including transaction-bound quote-mode updates and preserving MARKET-mode
  provider behavior.
- Add bounded activity sync-event queuing for create/update/delete, bulk,
  transfer link/unlink, and CSV import writes, including Rust-compatible
  ActivityDB payloads, post-transaction callback ordering, and Rust
  `should_sync_outbox_for_activity` filtering semantics while keeping real
  sync_outbox persistence/runtime wiring deferred.
- Add bounded CSV import-run sync-event queuing for activity imports, including
  Rust-compatible ImportRunDB payloads, import-run-before-activity callback
  ordering, and Rust `should_sync_outbox_for_import_run` filtering semantics.
- Add bounded activity-created asset sync-event queuing for explicit-symbol
  asset inserts performed by activity create/update/bulk/import paths, including
  Rust-compatible AssetDB payloads and post-transaction callback ordering before
  dependent activity/import events.
- Add first TS sync_outbox persistence wiring by routing migrated goal and
  activity/import/asset sync callbacks through a shared outbox writer with
  Rust-compatible entity/op names, payload normalization, device/key metadata,
  and `sync_entity_metadata` updates.
- Extend sync_outbox runtime wiring to exchange-rate FX asset callbacks,
  including Rust-compatible AssetDB Create/Delete payloads that omit generated
  `instrument_key` fields.
- Extend sync_outbox runtime wiring to custom provider Create/Update/Delete
  callbacks, preserving UUID-keyed `custom_provider` rows and normalized
  payloads.
- Extend sync_outbox runtime wiring to custom taxonomy bundle callbacks and
  asset taxonomy assignment callbacks, preserving Rust-shaped nested
  `custom_taxonomy` payloads and `asset_taxonomy_assignment` rows.
- Extend sync_outbox runtime wiring to direct asset callbacks from create,
  profile update, quote-mode update, and delete, preserving Rust-shaped `asset`
  payloads without generated `instrument_key` fields.
- Extend sync_outbox runtime wiring to alternative asset callbacks and
  alternative asset UUID MANUAL quote callbacks, preserving Rust-shaped `asset`
  and `quote` payloads, create/update/delete ordering, MANUAL+UUID quote
  filtering, and no quote delete outbox rows for alternative asset deletion.
- Extend sync_outbox runtime wiring to market-data quote update/delete/import
  writes, preserving Rust's MANUAL+UUID quote filter, deterministic manual quote
  no-op behavior, explicit UUID manual quote Delete emission, and normalized
  runtime `quote` payloads.
- Extend sync_outbox runtime wiring to local AI chat mutations for the already
  migrated persistence paths, preserving Rust-shaped `ai_thread`, `ai_message`,
  and `ai_thread_tag` Update/Create/Delete payloads while provider chat
  execution remains deferred.
- Extend sync_outbox runtime wiring to contribution-limit Create/Update/Delete
  callbacks, preserving Rust-shaped `contribution_limit` payloads and missing
  delete no-op behavior.
- Add bounded TS domain-event planning by deriving portfolio job configs,
  broker-sync account IDs, and asset-enrichment IDs from Rust-shaped backend
  event batches while keeping the actual debounced worker execution deferred.
- Add bounded TS domain-event batch processing by invoking injected asset
  enrichment, portfolio job enqueue, and broker-sync callbacks in Rust
  queue-worker order while keeping the real debounced worker/runtime wiring
  deferred.
- Add a bounded TS domain-event worker helper that subscribes to the backend
  event bus, debounces event batches, supports explicit flush/dispose, and
  surfaces scheduled processing failures without wiring real runtime services
  yet.
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
- Keep still-deferred provider-backed asset resolution, remaining quote sync
  outbox follow-ups outside migrated alternative-asset and market-data quote
  paths, device-sync push/pull runtime wiring, and actual portfolio job
  execution/valuation recalculation for dedicated parity slices.
- Preserve the existing guarded handler model for unimplemented/high-risk
  domains and keep Electron/Rust sidecar defaults unchanged until cutover gates
  are ready.

No production TS default, domain-level Rust/TS mixing in production, or Rust
accounts/settings/limits/taxonomies/custom-provider/goals/exchange-rate/health/provider-settings/portfolio-job/event-stream
provider sync, actual portfolio job execution, keyring storage, AI chat
streaming/provider/tool execution runtime, quote-provider interactions,
auto-classification side effects, portfolio metrics runtime beyond
current/historical net-worth, income summary, simple account performance,
account performance history/summary, valuation reads, snapshot metadata,
historical snapshot holdings reads, holdings import checks, live holdings
fan-out, holding detail/by-asset fan-out, allocation reads, snapshot deletion,
bounded manual snapshot saves, bounded snapshot import writes, add-on runtime,
broader market-data runtime beyond mapping/templates/duplicate lookups,
read-only search, transfer link/unlink, single activity delete, and bounded
existing-asset/cash/symbol-resolved and bounded symbol-created activity
create/update/bulk persistence plus CSV parse/read-only asset preview/read-only
import validation, bounded import apply, activity mutation event production,
activity/import/asset sync-event callback queuing, and domain-event
planning/batch processing/worker helper, save-up preview calculations, local AI
chat thread/message/tag persistence, bounded health account/timezone
status/checks and legacy-classification issue generation,
sync-crypto/device-sync integration, calculation-heavy health checks or
non-classification `/health/fix` execution, holdings inline portfolio
recalculation/job execution, real Connect runtime implementation, real
device-sync runtime implementation, or Rust runtime removal is in scope for this
slice.

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
