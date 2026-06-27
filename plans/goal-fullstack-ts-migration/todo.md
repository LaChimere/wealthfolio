# Task Checklist

> Purpose: execution-phase checklist derived from
> `plans/goal-fullstack-ts-migration/plan.md`. Treat this as the progress truth
> source.

## Task

- Summary: Migrate Wealthfolio from Electron + Rust sidecar/backend to
  full-stack TypeScript/Bun.
- Links:
  - `plans/goal-fullstack-ts-migration/goal.md`
  - `plans/goal-fullstack-ts-migration/research.md`
  - `plans/goal-fullstack-ts-migration/design.md`

## Plan Reference

- Plan version/date: PR sequence v1.
- Approved by (if applicable): user instructed implementation to start after
  planning.

## Checklist

### Preparation

- [x] Register persistent goal state.
  - Evidence: `plans/goal-fullstack-ts-migration/goal.md`
- [x] Capture initial architecture research and migration constraints.
  - Evidence: `plans/goal-fullstack-ts-migration/research.md`
- [x] Draft staged PR decomposition/design.
  - Evidence: `plans/goal-fullstack-ts-migration/design.md`
- [x] Gate 1: approve design before implementation planning.
  - Evidence: user instructed to stop planning and start implementation.

### Implementation

- [x] PR 1: TS backend contract foundation.
  - Acceptance criteria: current command/API surface is represented in typed TS
    contracts and parity harness smoke coverage exists without runtime changes.
  - Evidence: `packages/backend-contracts` package with command-surface parser,
    classification tests, normalization helpers, parity smoke commands, and
    addon-host canary contract.
- [x] PR 2: TS backend runtime skeleton.
  - Acceptance criteria: guarded TS backend skeleton supports health/readiness,
    sidecar-token/auth parity, and Electron lifecycle tests while Rust remains
    default.
  - Evidence: `apps/backend` Bun runtime skeleton with config/auth/CORS/timeout
    tests; Electron runtime selector defaults to Rust and can explicitly spawn
    TS backend in dev/test.
- [x] PR 3: TS SQLite foundation.
  - Acceptance criteria: TS storage can open existing DBs, preserve migration
    history/PRAGMAs, and pass read/backup/restore parity fixtures.
  - Evidence: `apps/backend/src/storage/sqlite.ts` uses `bun:sqlite`, existing
    Rust migration files, Diesel-compatible migration history, Rust-aligned
    PRAGMAs, and backup/restore fixtures.
- [x] PR 4: Cross-cutting compatibility preflights.
  - Acceptance criteria: keyring service IDs, addon canary, command registry
    classification, and mixed-version sync fixture requirements are documented
    and tested without runtime behavior changes.
  - Evidence: `packages/backend-contracts/src/compatibility-preflights.ts`
    defines and tests keyring service IDs, command deltas, addon host canary
    requirements, and mixed-version sync command visibility.
- [ ] PR 5+: Domain vertical slices.
  - Acceptance criteria: each migrated domain has Rust-vs-TS parity for reads,
    writes, validation, errors, events, and adapter behavior while remaining
    inert for production until TS cutover.
  - Evidence: settings, accounts, contribution limits, taxonomy, custom
    provider, scoped goals, local exchange-rate, local health, market-data
    provider settings, portfolio job trigger, event stream, secrets, AI
    provider, AI chat, sync crypto, Connect broker/session and device-sync
    enrollment/engine, device-sync device management, team-key/reset, and
    pairing, standalone runtime composition for already-ported SQLite-backed
    domains, contribution-limit deposit calculation runtime, alternative-assets
    runtime, contained asset read/quote-mode/delete runtime, asset
    create/profile mutation runtime, safe app utility runtime, custom provider
    test-source runtime, alternative assets, assets, portfolio metrics,
    holdings, add-ons, market-data, and activities TS repository/service or
    route config implementations plus guarded/runtime route tests in
    `apps/backend/src/domains/settings.ts`,
    `apps/backend/src/domains/accounts.ts`,
    `apps/backend/src/domains/contribution-limits.ts`,
    `apps/backend/src/domains/taxonomies.ts`,
    `apps/backend/src/domains/custom-providers.ts`,
    `apps/backend/src/domains/goals.ts`,
    `apps/backend/src/domains/exchange-rates.ts`,
    `apps/backend/src/domains/health.ts`,
    `apps/backend/src/domains/market-data-providers.ts`,
    `apps/backend/src/domains/portfolio-jobs.ts`,
    `apps/backend/src/domains/holdings.ts`,
    `apps/backend/src/domains/addons.ts`,
    `apps/backend/src/domains/market-data.ts`,
    `apps/backend/src/domains/activities.ts`,
    `apps/backend/src/domains/ai-chat.ts`,
    `apps/backend/src/domains/sync-crypto.ts`,
    `apps/backend/src/domains/device-sync.ts`,
    `apps/backend/src/domains/connect.ts`, `apps/backend/src/events.ts`,
    `apps/backend/src/runtime.ts`, and `apps/backend/src/http.test.ts`. Sync
    crypto now has a standalone TS runtime implementation for local primitives,
    while device-sync key material side effects remain deferred to device-sync
    runtime slices. Legacy classification migration status/run, bounded
    account/timezone health status/check behavior, and legacy-classification
    health issue generation now have TS runtime behavior, while broader
    price/FX/classification/consistency health checks and non-classification
    `/health/fix` behavior are deferred to health/calculation service slices;
    custom provider `test-source` now has TS runtime behavior for external
    source testing; FX converter/history and register-pair behavior now have TS
    runtime parity; market-data exchange list, local quote
    history/update/delete, latest quote snapshots, quote CSV check/import, Yahoo
    dividends, symbol search, resolve-currency, targeted Yahoo quote-history
    sync for explicit asset targets, and bounded broad Yahoo sync/history for
    local assets now have TS runtime parity; activities import mapping/template
    storage, duplicate lookup, read-only search, transfer link/unlink, single
    delete behavior, bounded existing-asset/cash create/update/bulk persistence,
    symbol-only resolution to existing assets, bounded symbol-based asset
    creation from explicit metadata, CSV parse, and read-only import asset
    preview now have TS runtime parity; save-up and retirement goal-plan writes
    plus save-up preview calculations and save-up goal overview service logic
    now have bounded TS runtime parity; non-retirement and no-plan retirement
    summary refresh service logic, guarded valuation-provider HTTP route seams,
    standalone runtime valuation-map construction, refresh-all summary routing,
    save-time summary refresh side effects, Rust-compatible retirement input
    preparation, deterministic retirement calculation primitives, deterministic
    required-capital/projection engine behavior, deterministic retirement
    overview assembly, HTTP retirement overview routing, plan-backed retirement
    summary refresh, retirement projection routing, Monte Carlo routing,
    scenario-analysis routing, sequence-of-returns routing, stress-tests
    routing, and decision-sensitivity routing now have bounded TS runtime
    parity; automatic/background FX quote fetching and all-provider market-data
    sync execution remain deferred and move to calculation/market-data slices;
    bounded portfolio job execution, event production, valuation recalculation
    from existing holdings snapshots, TOTAL snapshot rebuilding, bounded
    transaction-account snapshot rebuilding from posted common activities, and
    contribution-limit lightweight portfolio update side effects now run in the
    standalone TS runtime; BUY/SELL broker FX handling, option contract
    multipliers, option-expiry adjustments, split preprocessing, lot-level asset
    transfers, other adjustment no-op behavior, and
    DRIP/dividend-in-kind/staking reward activity compiler expansion now run in
    the standalone TS runtime; TS file-backed secret persistence and native
    keyring-backed `WF_SECRET_BACKEND=keyring` are wired into standalone runtime
    and packaged Electron now launches the Bun-compiled TS backend with the
    keyring-backed desktop environment, while cross-platform keyring CI remains
    deferred to a runtime/keyring parity slice; AI provider
    catalog/settings/model-listing runtime behavior, bounded native/fallback
    text/reasoning AI chat provider streaming, generated thread titles,
    OpenAI-compatible/Ollama/Anthropic/Gemini injected tool-call execution,
    built-in `get_accounts`, `get_holdings`, `get_cash_balances`, `get_goals`,
    `search_activities`, `get_performance`, `get_income`,
    `get_valuation_history`, `get_asset_allocation`, `get_health_status`,
    `record_activity`, `record_activities`, and `import_csv`, text/CSV
    attachment prompt injection, Anthropic/Gemini image/PDF native media
    payloads, OpenAI-compatible image/PDF media payloads, and Ollama image media
    payloads are wired into standalone runtime while Ollama PDF attachment
    payloads remain unsupported by the documented `/api/chat` images-only API;
    alternative asset persistence, manual valuation quotes, liability
    link/unlink metadata behavior, holdings reads, bounded portfolio job
    valuation/TOTAL recalculation, bounded transaction-account activity snapshot
    rebuilding, BUY/SELL broker FX handling, option contract multipliers,
    option-expiry adjustments, split preprocessing, lot-level asset-transfer
    replay, other adjustment no-op behavior, and DRIP/dividend-in-kind/staking
    reward activity compiler expansion now have TS runtime parity; asset
    read/create/profile/quote-mode/delete behavior and initial
    auto-classification side effects now have TS runtime parity, while
    quote-provider interactions and portfolio recalculation side effects are
    deferred to asset/market-data/portfolio parity slices; app utility database
    restore now has TS runtime parity with restart-required readiness after file
    restore; contribution-limit deposit calculation now has TS runtime parity
    with SQLite activity reads, Rust-compatible contribution rules,
    user-timezone year ranges, and FX conversion dates; current/history
    net-worth, income summary, simple account performance, account performance
    history/summary calculations, local quote-backed symbol performance history
    with local asset/display/instrument-symbol resolution, holdings valuation
    reads, holdings snapshot metadata reads, historical snapshot holdings reads,
    holdings import checks, live holdings fan-out, holding detail/by-asset
    fan-out, allocation reads, snapshot deletion, bounded manual/imported
    snapshot saves, snapshot FX pair registration, holdings snapshot mutation
    event production, bounded portfolio job inline valuation/TOTAL
    recalculation, bounded transaction-account activity snapshot rebuilding,
    BUY/SELL broker FX handling, option contract multipliers, option-expiry
    adjustments, split preprocessing, lot-level asset-transfer replay, other
    adjustment no-op behavior, and DRIP/dividend-in-kind/staking-reward activity
    compiler expansion now have TS runtime parity, while provider-backed symbol
    fetch/resolution is deferred to portfolio/market-data parity slices; add-on
    local filesystem listing, toggles, uninstall, runtime loading,
    enabled-startup loading, staging cleanup, Rust-compatible manifest
    normalization, local ZIP extraction/install, permission detection/merging,
    staged ZIP install, store listings/ratings/update checks, store download
    staging, and store update installs and frontend manifest-permission
    enforcement for SDK domain APIs, UI registration, and scoped secrets now
    have TS runtime parity, while add-on security scanning, full sandbox
    isolation, and query-cache hardening are deferred to add-on runtime parity
    slices; targeted and bounded broad Yahoo market-data sync, bounded
    custom-provider-backed symbol quote resolution, targeted/general-purpose
    custom-provider latest and historical sync, custom latest fallback during
    backfill, Börse Frankfurt historical/latest sync and quote resolution,
    MarketData.app history/latest sync and quote resolution, Finnhub
    equity/FX/crypto history/latest sync and quote resolution, Alpha Vantage
    equity/FX/crypto history/latest sync plus real-time option quote resolution,
    Metal Price API metal history/latest sync and quote resolution, US Treasury
    calculated bond history/latest sync and quote resolution, OpenFIGI bond
    search fallback, Finnhub/Alpha Vantage search fallbacks, Börse Frankfurt
    search fallback, provider-backed activity import asset preview symbol
    resolution, Rust-shaped activity import asset preview drafts for existing
    and provider-resolved assets, provider-backed activity import check
    resolution, provider-backed direct holdings snapshot write resolution,
    ISIN-first activity import check resolution, ISIN-first activity import
    asset preview resolution, and provider-backed preview type/quote-currency
    inference now have TS runtime parity, while remaining provider breadth and
    background orchestration remain deferred to market-data/portfolio parity
    slices; market-sync result accounting, portfolio `market:sync-complete`
    failure/skipped-reason payloads, and market-data quote/sync portfolio job
    side effects now have TS parity; activity mutation event production,
    activity/import-run/activity-created-asset sync-event callback queuing,
    sync_outbox persistence for migrated goal/activity callbacks, FX asset
    callbacks, custom provider callbacks, custom taxonomy bundle callbacks,
    asset taxonomy assignment callbacks, direct asset Create/Update/Delete
    callbacks, alternative asset/UUID MANUAL quote callbacks, market-data quote
    update/delete/import callbacks, holdings snapshot asset callbacks, and local
    AI chat thread/message/tag callbacks, contribution-limit callbacks, account
    callbacks, import template/account-template callbacks, holdings snapshot
    callbacks, quote-sync position lifecycle reconciliation around portfolio
    jobs, activity snapshot cash contribution/cash-total/cost-basis FX parity,
    domain-event planning/batch processing/worker helper, asset-enrichment
    chunk/failure continuation, standalone runtime domain-event worker wiring to
    local portfolio jobs, post-portfolio active goal-summary refresh,
    broker-sync failure continuation, and bounded asset-enrichment execution for
    US Treasury bond metadata plus Yahoo quoteSummary/search profile enrichment
    with provider-profile taxonomy assignment and asset Update sync callbacks,
    plus direct activity-created crypto/FX/option/security instrument inference,
    structured OPTION/BOND metadata, Rust-shaped import preview draft
    serialization for existing/new assets, Börse Frankfurt provider preference
    inference for XETR/XFRA ISIN equities, Yahoo suffix-to-MIC canonicalization
    with MIC quote-currency fallback plus existing-asset lookup normalization
    across direct activity, import asset preview, and import check/apply paths,
    Rust-compatible asset-id hydration, symbol-name fallback, staged
    pending-asset symbol/MIC/type/quote-currency hydration, check/apply subtype
    normalization, apply-time SPLIT currency fallback, currency validation, and
    empty required-symbol validation for import validation, and Rust-compatible
    quote-currency errors for incomplete market securities, now have TS runtime
    parity, while broader provider-backed asset resolution outside the activity
    preview/check/apply round-trip and remaining quote sync outbox follow-ups
    outside migrated alternative-asset and market-data quote paths, device-sync
    push/pull runtime wiring, and remaining device-sync side effects are
    deferred to activities/import/device-sync runtime parity slices; AI chat
    persistence, tag persistence, tool-result mutation, local AI chat
    sync_outbox callbacks, native/fallback text/reasoning provider streaming,
    generated thread titles, OpenAI-compatible/Ollama/Anthropic/Gemini injected
    tool-call execution, built-in `get_accounts`, `get_holdings`,
    `get_cash_balances`, `get_goals`, `search_activities`, `get_performance`,
    `get_income`, `get_valuation_history`, `get_asset_allocation`,
    `get_health_status`, `record_activity`, `record_activities`, and
    `import_csv`, text/CSV attachment prompt injection, Anthropic/Gemini
    image/PDF native media payloads, OpenAI-compatible image/PDF media payloads,
    and Ollama image media payloads now have TS runtime parity, while Ollama PDF
    attachment payloads remain unsupported by the documented `/api/chat`
    images-only API; device-sync integration for sync crypto is deferred to
    device-sync runtime parity slices; bounded account/timezone health
    status/checks, cache behavior, legacy-classification health issues and
    affected items, classification migration health-fix dispatch,
    `sync_prices`/`retry_sync` dispatch into the market-data sync seam,
    `fetch_fx` dispatch into exchange-rate pair registration and targeted
    market-data sync, targeted `migrate_classifications` dispatch into the
    taxonomy migration seam, and service-level `migrate_legacy_classifications`
    dispatch, bounded price-staleness Health Center checks, bounded quote-sync
    error checks, bounded FX integrity issue generation, bounded
    negative-balance data-consistency checks, orphan activity account/asset
    checks, negative latest-position checks, and Rust-compatible health
    dismissal hash carryover now have TS runtime parity; market-data no-op sync
    modes plus targeted and bounded broad Yahoo provider-backed asset/FX sync,
    custom-provider latest/history/fallback sync, Börse Frankfurt provider sync,
    MarketData.app provider sync, Finnhub equity/FX/crypto provider sync, Alpha
    Vantage equity/FX/crypto provider sync plus real-time option quote
    resolution, Metal Price API metal provider sync, US Treasury calculated bond
    provider sync, and OpenFIGI bond search fallback now execute in TS,
    including market-sync failure/skipped-reason payload propagation, while
    remaining provider breadth, background orchestration, automatic/background
    FX quote fetching, and portfolio recalculation remain deferred; remaining
    calculation-heavy health checks are deferred to health/calculation parity
    slices; disabled Connect feature-flag responses, local Connect
    synced-account/platform/sync-state/import-run reads, local broker sync
    profile persistence, disabled device-sync route responses, and local
    device-sync status/precondition/no-op/clear-data behavior now have TS
    runtime parity; Connect token restore, device-sync fresh/recovery
    enrollment, BOOTSTRAP E2EE key initialization, PAIR/ORPHANED registration
    responses, reinitialize reset ordering, legacy device-id storage, freshness
    cleanup, and READY bootstrap-complete side effects now have bounded TS
    runtime parity; broker-sync entitlement preflights now have TS runtime
    parity for `/connect/sync`, while broker sync orchestration, event
    production, sync engine push/pull, trusted-device snapshot/upload runtime,
    background workers, remaining device-sync cloud clients, team-key operations
    beyond initialization, pairing flows, freshness gate persistence, bootstrap
    transfer, and remaining secret side effects are deferred to
    Connect/device-sync parity slices.
- [ ] PR 8: Default TS backend cutover.
  - Acceptance criteria: Electron and web use TS backend by default with
    rollback/fallback documented for stabilization plus benchmark gates.
  - Evidence: pending.
- [ ] PR 9: Rust removal cleanup.
  - Acceptance criteria: Rust runtime/build/release paths are removed after TS
    parity and docs describe TS-only architecture.
  - Evidence: pending.

### Acceptance Gate (before proposing PR)

- [ ] All acceptance criteria above are met with evidence.
- [ ] Diff is consistent with approved plan (no scope creep, no missing pieces).
- [ ] Applicable verification level executed.

If any check fails, follow the recovery flow defined in the active framework
contract:

1. Can fix directly -> fix and re-verify
2. Plan is infeasible -> update `plan.md`, re-submit for Gate 2
3. Design is invalid -> update `design.md`, re-submit for Gate 1 -> Gate 2
4. Stuck -> stop and report to user with evidence of what was attempted

### Verification (Evidence)

- [x] Run lint/typecheck: `bun run check` (attach output/excerpt).
- [x] Run unit tests: targeted TS backend/domain tests (attach output/excerpt).
- [ ] Run integration/e2e or before/after check: parity harness and selected
      Electron/web smoke flows (attach proof).
  - Evidence: standalone runtime smoke now covers HTTP `fetch_fx` -> FX asset
    registration -> targeted Yahoo quote persistence in
    `apps/backend/src/runtime.test.ts`, and runtime market-data smoke now covers
    broad history/incremental sync returning 204 instead of 501.
- [ ] Capture logs/metrics for performance-sensitive calculation/import slices.

### Review / Packaging

- [ ] Summarize changes (what/why).
- [ ] Confirm no scope creep / unrelated cleanup.
- [ ] Check whether related docs need updating.
- [ ] Prepare PR description / changelog notes (if applicable).

## Evidence Log

- `research/decomposition`: initial evidence and PR sequence recorded in
  `research.md` and `design.md`.
- `pr1-contract-foundation`: targeted checks passed:
  `bun run --cwd packages/backend-contracts test` and
  `bun run --cwd packages/backend-contracts type-check`.
- `pr1-repo-check`: full repo check passed with `bun run check`.
- `pr2-runtime-skeleton`: targeted checks passed:
  `bun run --cwd apps/backend test`, `bun run --cwd apps/backend type-check`,
  `bun run --cwd apps/electron test`, and
  `bun run --cwd apps/electron type-check`.
- `pr2-repo-check`: full repo check passed with `bun run check`.
- `pr2-review-fix`: code review found the guarded debug route was open when no
  sidecar token was configured; fixed it to fail closed and re-ran targeted
  checks plus `bun run check`.
- `pr3-sqlite-foundation`: targeted checks passed:
  `bun run --cwd apps/backend test` and `bun run --cwd apps/backend type-check`.
- `pr3-repo-check`: full repo check passed with `bun run check`.
- `pr3-review-fix`: code review requested whitespace-only `DATABASE_URL`
  coverage; added the edge-case test and re-ran backend checks plus
  `bun run check`.
- `pr4-compat-preflights`: targeted checks passed:
  `bun run --cwd packages/backend-contracts test` and
  `bun run --cwd packages/backend-contracts type-check`.
- `pr4-repo-check`: full repo check passed with `bun run check`.
- `pr5-settings-domain`: targeted checks passed:
  `bun run --cwd apps/backend test` and `bun run --cwd apps/backend type-check`.
- `pr5-settings-repo-check`: full repo check passed with `bun run check`.
- `pr5-accounts-domain`: targeted checks passed:
  `bun run --cwd apps/backend type-check` and `bun run --cwd apps/backend test`.
  Accounts coverage includes generated IDs, list filters/sort order, immutable
  update fields, archive/tracking-mode preservation, Rust-compatible group
  clearing, delete events, orphaned investment cleanup hooks, and guarded HTTP
  routes.
- `pr5-accounts-review`: code review found transaction-boundary and event
  snapshot issues during refinement; create/update now read back inside
  transaction boundaries and update events use transaction-captured before/after
  snapshots. Final review found no remaining actionable issues.
- `pr5-accounts-repo-check`: full repo check passed with `bun run check`.
- `pr5-contribution-limits-domain`: targeted checks passed:
  `bun run --cwd apps/backend type-check` and `bun run --cwd apps/backend test`.
  Coverage includes generated IDs, update optional-field nulling, idempotent
  deletes, lightweight portfolio update hooks, empty-account deposit zero
  results, injectable deposit calculation, and guarded HTTP routes.
- `pr5-contribution-limits-review`: code review found no remaining actionable
  issues.
- `pr5-contribution-limits-repo-check`: full repo check passed with
  `bun run check`.
- `pr5-taxonomies-read-domain`: targeted checks passed:
  `bun run --cwd apps/backend type-check` and `bun run --cwd apps/backend test`.
  Coverage includes taxonomy sort order, boolean/date mapping, category sort
  order, missing taxonomy `null` responses, and guarded HTTP read routes.
- `pr5-taxonomies-read-review`: code review found no actionable correctness,
  security, route compatibility, type-safety, or test coverage issues.
- `pr5-taxonomies-read-repo-check`: full repo check passed with `bun run check`.
- `pr5-taxonomies-crud-mutations`: targeted checks passed:
  `bun run --cwd apps/backend type-check` and `bun run --cwd apps/backend test`.
  Coverage includes supplied/generated taxonomy/category IDs, taxonomy
  create/update/delete, system taxonomy delete rejection, non-custom system sync
  suppression, custom taxonomy sync bundle/delete hooks, category child and
  asset assignment delete guards, move-category behavior, and guarded HTTP
  mutation routes.
- `pr5-taxonomies-crud-review`: code review flagged mutable `created_at` fields
  on update; Rust repository updates from the full submitted Taxonomy/Category
  structs, so the TS slice kept parity and added explicit tests for that
  behavior. No remaining actionable issues.
- `pr5-taxonomies-crud-repo-check`: full repo check passed with `bun run check`.
- `pr5-taxonomies-assignments`: targeted checks passed:
  `bun run --cwd apps/backend type-check` and `bun run --cwd apps/backend test`.
  Coverage includes asset assignment reads, natural-key upsert behavior,
  original row identity/timestamps on conflict, single-select replacement,
  idempotent missing deletes, optional assignment sync hooks, and guarded HTTP
  assignment routes.
- `pr5-taxonomies-assignments-review`: first review flagged two possible issues;
  both were rechecked against Rust parity and TS runtime behavior, then a
  focused second review found no remaining actionable issues.
- `pr5-taxonomies-assignments-repo-check`: full repo check passed with
  `bun run check`.
- `pr5-taxonomies-import-export`: targeted checks passed:
  `bun run --cwd apps/backend type-check` and `bun run --cwd apps/backend test`.
  Coverage includes JSON validation, recursive import flattening, pre-order sort
  values, parent links, export tree sorting, ignored instrument mappings parity,
  missing taxonomy errors, and guarded HTTP import/export routes.
- `pr5-taxonomies-import-export-review`: first review raised transaction
  atomicity as a concern; Rust uses separate create and bulk-category writes, so
  the TS slice kept parity. Focused second review found no remaining actionable
  issues.
- `pr5-taxonomies-import-export-repo-check`: full repo check passed with
  `bun run check`.
- `pr5-custom-providers-crud`: targeted checks passed:
  `bun run --cwd apps/backend type-check` and `bun run --cwd apps/backend test`.
  Coverage includes provider-code route identity, UUID sync identity, list
  priority order, create defaults and reserved-code validation, source config
  parsing and validation, omitted-field update preservation, explicit empty
  `sources` replacement, delete existence checks, both asset reference delete
  guards, guarded HTTP CRUD routes, and deferred `test-source` behavior.
- `pr5-custom-providers-crud-review`: code review found no actionable issues
  across Rust parity, route compatibility/security, type-safety, or test
  coverage.
- `pr5-custom-providers-crud-repo-check`: full repo check passed with
  `bun run check`.
- `pr5-goals-crud-funding`: targeted checks passed:
  `bun run --cwd apps/backend type-check` and `bun run --cwd apps/backend test`.
  Coverage includes priority-desc goal reads, zero-target null mapping,
  generated IDs/defaults/base currency, lifecycle and goal-type guards,
  retirement single goal guard, seeded retirement funding, funding
  duplicate/range/capacity/tax bucket/DC-link guards, non-retirement tax bucket
  clearing, funding replacement sync hooks, idempotent goal delete sync
  behavior, read-only plan access, guarded HTTP CRUD/funding routes, and
  deferred plan-write behavior.
- `pr5-goals-crud-funding-review`: code review found no actionable issues across
  Rust parity, route compatibility/security, type-safety, or test coverage.
- `pr5-goals-crud-funding-repo-check`: full repo check passed with
  `bun run check`.
- `pr5-exchange-rates-crud`: targeted checks passed:
  `bun run --cwd apps/backend type-check` and `bun run --cwd apps/backend test`.
  Coverage includes FX asset display ordering, latest quote selection, no-quote
  provider fallback, generated FX assets and instrument keys, provider config
  parity for Yahoo, quote upserts, manual update source behavior, decimal-string
  validation, quote-plus-asset deletes, asset sync hooks, guarded HTTP CRUD
  routes, and local-only scope.
- `pr5-exchange-rates-crud-review`: code review raised FX quote `volume` null
  versus zero as a possible parity issue; Rust `QuoteDB::from(&Quote)` maps zero
  volume to `NULL`, so no code change was required. No remaining actionable
  issues.
- `pr5-exchange-rates-crud-repo-check`: full repo check passed with
  `bun run check`.
- `pr5-health-local-state`: targeted checks passed:
  `bun run --cwd apps/backend type-check` and `bun run --cwd apps/backend test`.
  Coverage includes health dismissal upsert/replace, idempotent restore,
  dismissed issue ID reads, in-memory health config defaults and validation,
  guarded HTTP dismissal/config routes, and deferred health status behavior.
- `pr5-health-local-state-review`: code review found no actionable issues across
  Rust parity, route compatibility/security, type-safety, silent failure
  handling, or test coverage.
- `pr5-health-local-state-repo-check`: full repo check passed with
  `bun run check`.
- `pr5-market-data-provider-settings`: targeted checks passed:
  `bun run --cwd apps/backend type-check` and `bun run --cwd apps/backend test`.
  Coverage includes provider priority ordering, static capabilities, API-key
  requirement/secret flags, quote-sync asset counts, provider error attribution,
  provider update and refresh hooks, guarded HTTP providers/settings routes, and
  deferred market-data search behavior.
- `pr5-market-data-provider-settings-review`: code review found no actionable
  issues across Rust parity, route compatibility/security, type-safety, silent
  failure handling, or test coverage.
- `pr5-market-data-provider-settings-repo-check`: full repo check passed with
  `bun run check`.
- `pr5-portfolio-job-triggers`: targeted checks passed:
  `bun run --cwd apps/backend type-check` and `bun run --cwd apps/backend test`.
  Coverage includes empty-body update/recalculate defaults, explicit
  `marketSyncMode` preservation, incremental vs full recalculation modes,
  guarded HTTP portfolio routes, and deferred event-stream behavior.
- `pr5-portfolio-job-triggers-review`: code review found one `asset_ids: null`
  parity gap for explicit `marketSyncMode` parsing; fixed it, added explicit
  coverage, and re-review found no actionable issues.
- `pr5-portfolio-job-triggers-repo-check`: full repo check passed with
  `bun run check`.
- `pr5-event-stream-transport`: targeted checks passed:
  `bun run --cwd apps/backend type-check` and `bun run --cwd apps/backend test`.
  Coverage includes SSE event formatting, payload-less `null` data, stream
  subscription/cancel behavior, guarded HTTP event-stream route, stream headers,
  and event delivery through the TS event bus.
- `pr5-event-stream-transport-review`: code review found no actionable issues
  across Rust transport parity, route compatibility/security, stream cleanup,
  type-safety, or test coverage.
- `pr5-event-stream-transport-repo-check`: full repo check passed with
  `bun run check`.
- `pr5-secrets-route-seam`: targeted checks passed:
  `bun run --cwd apps/backend type-check` and `bun run --cwd apps/backend test`.
  Coverage includes injectable secret set/get/delete behavior, guarded HTTP
  route access, body/query validation, 204 mutation responses, JSON string/null
  reads, and deferred real keyring storage.
- `pr5-secrets-route-seam-review`: code review found no actionable issues across
  Rust route parity, sidecar auth, route inertness, type-safety, or test
  coverage.
- `pr5-secrets-route-seam-repo-check`: full repo check passed with
  `bun run check`.
- `pr5-ai-provider-route-seam`: targeted checks passed:
  `bun run --cwd apps/backend type-check` and `bun run --cwd apps/backend test`.
  Coverage includes injectable provider read/update/default/model-list behavior,
  guarded HTTP route access, providerId validation, decoded provider model path
  IDs, JSON `null` mutation responses, route inertness without injection, and
  deferred real catalog/settings/secrets/provider HTTP behavior.
- `pr5-ai-provider-route-seam-review`: code review found no actionable issues
  across Rust route parity, sidecar auth, route inertness, type-safety, or test
  coverage.
- `pr5-ai-provider-route-seam-repo-check`: full repo check passed with
  `bun run check`.
- `pr5-alternative-assets-route-seam`: targeted checks passed:
  `bun run --cwd apps/backend type-check` and `bun run --cwd apps/backend test`.
  Coverage includes injectable create/valuation/delete/link/unlink/metadata and
  holdings behavior, guarded HTTP route access, decoded path IDs, request
  validation, 204 mutation responses, route inertness without injection, and
  deferred real asset/quote/portfolio-job behavior.
- `pr5-alternative-assets-route-seam-review`: first review found metadata
  removal and `notes: null` parity gaps; fixed empty-string metadata removal to
  null, omitted null notes like Rust `Option<String>`, re-ran targeted backend
  checks, and final review found no actionable issues.
- `pr5-alternative-assets-route-seam-repo-check`: full repo check passed with
  `bun run check`.
- `pr5-assets-route-seam`: targeted checks passed:
  `bun run --cwd apps/backend type-check` and `bun run --cwd apps/backend test`.
  Coverage includes injectable asset
  list/profile/create/update/quote-mode/delete behavior, guarded HTTP route
  access, query/path decoding, quoteMode/pricingMode alias handling, required
  profile notes, null-as-omitted option handling, 204 delete responses, route
  inertness without injection, and deferred real asset/quote/portfolio behavior.
- `pr5-assets-route-seam-review`: first reviews found `isActive` default parity
  and reserved path delete-collision gaps; fixed the Rust default, rejected
  `isActive: null`, guarded reserved delete paths, re-ran targeted backend
  checks, and final review found no actionable issues.
- `pr5-assets-route-seam-repo-check`: full repo check passed with
  `bun run check`.
- `pr5-app-utility-route-seam`: targeted checks passed:
  `bun run --cwd apps/backend type-check` and `bun run --cwd apps/backend test`.
  Coverage includes injectable app info, update check, backup, backup-to-path,
  and restore behavior, guarded HTTP route access, force query parsing, body
  validation, 204 restore responses, route inertness without injection,
  corrected `/settings/auto-update-enabled`, and deferred real
  update/backup/restore behavior.
- `pr5-app-utility-route-seam-review`: code review found no actionable issues
  across Rust route parity, sidecar auth, route inertness, type-safety, or test
  coverage.
- `pr5-app-utility-route-seam-repo-check`: full repo check passed with
  `bun run check`.
- `pr5-portfolio-metrics-route-seam`: targeted checks passed:
  `bun run --cwd apps/backend type-check` and `bun run --cwd apps/backend test`.
  Coverage includes injectable net-worth, net-worth-history, simple account
  performance, performance history/summary, and income summary behavior, guarded
  HTTP route access, date validation, empty account-list short-circuiting,
  tracking-mode parsing, route inertness without injection, and deferred real
  portfolio metric calculations.
- `pr5-portfolio-metrics-route-seam-review`: code review found no actionable
  issues across Rust route parity, sidecar auth, date validation, type-safety,
  error handling, or test coverage.
- `pr5-portfolio-metrics-route-seam-repo-check`: full repo check passed with
  `bun run check`.
- `pr5-holdings-route-seam`: targeted checks passed:
  `bun run --cwd apps/backend type-check` and `bun run --cwd apps/backend test`.
  Coverage includes injectable holdings reads, holding item null responses,
  asset-holdings reads, valuation history/latest reads, allocation reads,
  snapshot reads/deletes/saves, holdings import/check behavior, guarded HTTP
  route access, missing-vs-empty query handling, ordered repeated `accountIds`,
  snapshot date validation, JSON `null` option normalization, 200/204 mutation
  statuses, route inertness without injection, and deferred real
  holdings/valuation/allocation/snapshot runtime behavior.
- `pr5-holdings-route-seam-review`: rubber-duck and code review found no
  actionable issues after confirming snapshot date validation, import/check
  invalid-date pass-through, holding null responses, ordered repeated query
  parsing, sidecar auth, route inertness, type-safety, and test coverage.
- `pr5-holdings-route-seam-repo-check`: full repo check passed with
  `bun run check`.
- `pr5-addons-route-seam`: targeted checks passed:
  `bun run --cwd apps/backend type-check` and `bun run --cwd apps/backend test`.
  Coverage includes injectable installed add-ons, zip install/extract,
  toggle/uninstall/runtime loading, startup loading, store
  listings/ratings/check operations, staging download/install/cleanup, guarded
  HTTP route access, route inertness without injection, zipDataB64 precedence,
  invalid/missing zip payload errors, byte-array validation, path decoding,
  default/null option handling, unconditional empty rating reads, `u8` rating
  validation, 204 mutation statuses, and deferred real add-on
  runtime/store/staging behavior.
- `pr5-addons-route-seam-review`: rubber-duck and code review found no
  actionable issues after confirming route coverage, ratings read parity,
  zipDataB64 precedence/no fallback, byte validation, Rust-style zip error
  status, option defaults/null handling, path decoding, sidecar auth, route
  inertness, type-safety, and test coverage.
- `pr5-addons-route-seam-repo-check`: full repo check passed with
  `bun run check`.
- `pr5-market-data-route-seam`: targeted checks passed:
  `bun run --cwd apps/backend type-check` and `bun run --cwd apps/backend test`.
  Coverage includes injectable exchange lists, symbol search/resolve, quote
  history/latest/update/delete, Yahoo dividends, quote import/check, sync
  history, market sync, guarded HTTP route access, route inertness without
  injection, required-vs-empty query handling, raw instrument-type pass-through,
  path decoding, quote `asset_id` overwrite, u8 byte validation, required
  boolean/array body validation, sync-mode precedence, sync-history body
  ignoring, 204 mutation statuses, and deferred real provider/quote/import/sync
  runtime behavior.
- `pr5-market-data-route-seam-review`: rubber-duck and code review found no
  actionable issues after confirming route coverage, provider-route separation,
  query parsing parity, raw resolve query pass-through, quote path decoding and
  `asset_id` overwrite, camelCase latest quotes body handling, u8/import body
  validation, sync-history body ignoring, sync-mode precedence, sidecar auth,
  route inertness, type-safety, and test coverage.
- `pr5-market-data-route-seam-repo-check`: full repo check passed with
  `bun run check`.
- `pr5-activities-route-seam`: targeted checks passed:
  `bun run --cwd apps/backend type-check` and `bun run --cwd apps/backend test`.
  Coverage includes injectable activity search, create/update/bulk/delete,
  transfer link/unlink, import check/preview/apply, multipart CSV parse, import
  mapping, templates, account-template links, duplicate checks, guarded HTTP
  route access, route inertness without injection, search filter normalization,
  sort object/array handling, date validation, JSON body pass-through, tuple
  response preservation, wrapper-body validation, default/empty import context
  behavior, path/query decoding, and deferred real activities/import runtime
  behavior.
- `pr5-activities-route-seam-review`: code review found no actionable issues
  across Rust route parity, frontend adapter compatibility, sidecar auth, route
  inertness, multipart parsing, type-safety, error handling, or test coverage.
- `pr5-activities-route-seam-repo-check`: full repo check passed with
  `bun run check`.
- `pr5-ai-chat-route-seam`: targeted checks passed:
  `bun run --cwd apps/backend type-check` and `bun run --cwd apps/backend test`.
  Coverage includes injectable NDJSON chat streaming, pre-stream AI error status
  mapping, mid-stream terminal error events, serialization fallback events,
  stream cancellation, thread list/get/messages/update/delete, tag reads and
  no-op mutations, tool-result updates, guarded HTTP route access, route
  inertness without injection, `u32` limit validation, encoded-slash path
  decoding, null thread responses, empty/missing tag defaults, required tag body
  validation, `resultPatch` presence validation, and deferred real AI runtime
  behavior.
- `pr5-ai-chat-route-seam-review`: rubber-duck and code review found no
  actionable issues after confirming NDJSON streaming parity, AI error
  status/body mapping, mid-stream and serialization error events, stream
  cancellation, query/path decoding, thread/tag/tool route semantics, sidecar
  auth, route inertness, type-safety, and test coverage.
- `pr5-ai-chat-route-seam-repo-check`: full repo check passed with
  `bun run check`.
- `pr5-sync-crypto-route-seam`: targeted checks passed:
  `bun run --cwd apps/backend type-check` and `bun run --cwd apps/backend test`.
  Coverage includes injectable root key, DEK derivation, keypair, shared/session
  key derivation, encrypt/decrypt, pairing-code/hash, HMAC, SAS, and device-id
  commands, guarded HTTP route access, route inertness without injection,
  no-body route body ignoring, exact camelCase field validation, snake_case
  rejection, empty-string pass-through, `u32` version boundaries, keypair
  response shape, service error mapping, positional argument forwarding, and
  deferred real sync crypto runtime behavior.
- `pr5-sync-crypto-route-seam-review`: rubber-duck and code review found no
  actionable issues after confirming EphemeralKeyPair shape, no-body route
  behavior, exact field validation, u32 version parity, empty-string
  pass-through, service error mapping, sidecar auth, route inertness, sensitive
  data handling, and test coverage.
- `pr5-sync-crypto-route-seam-repo-check`: full repo check passed with
  `bun run check`.
- `pr5-health-classification-route-seam`: targeted checks passed:
  `bun run --cwd apps/backend type-check` and `bun run --cwd apps/backend test`.
  Coverage includes optional injectable health status/check/fix and taxonomy
  migration status/run methods, guarded HTTP route access, route inertness
  without injection or optional methods, client-timezone header trimming,
  no-body check/migration behavior, fix-action nullable payload validation,
  JSON/empty response shapes, sidecar auth, and deferred real
  health/classification runtime behavior.
- `pr5-health-classification-route-seam-review`: code review found and the slice
  fixed one `executeFix` method-binding issue; targeted checks and a focused
  re-review then found no remaining actionable issues across optional-method
  inertness, no-body route handling, timezone parsing, fix-action validation,
  sidecar auth, type-safety, and test coverage.
- `pr5-health-classification-route-seam-repo-check`: full repo check passed with
  `bun run check`.
- `pr5-connect-route-seam`: targeted checks passed:
  `bun run --cwd apps/backend type-check` and `bun run --cwd apps/backend test`.
  Coverage includes injectable non-device Connect session, broker listing/sync,
  local synced data, import runs, broker sync profile, subscription plan, public
  plan, and user-info routes, guarded HTTP route access, route inertness without
  injection, explicit `/connect/device/*` exclusion, session JSON `null`
  mutation responses, body-ignoring sync POST routes, 202/403/501 sync trigger
  status mapping, import-run query defaults/validation, direct broker-profile
  body pass-through, sidecar auth, and deferred real Connect/device-sync runtime
  behavior.
- `pr5-connect-route-seam-review`: rubber-duck and code review found no
  actionable issues after confirming route coverage, sidecar auth, non-device
  route boundaries, request validation, response status/body shapes,
  type-safety, and test coverage.
- `pr5-connect-route-seam-repo-check`: full repo check passed with
  `bun run check`.
- `pr5-connect-device-sync-route-seam`: targeted checks passed:
  `bun run --cwd apps/backend type-check` and `bun run --cwd apps/backend test`.
  Coverage includes injectable Connect device sync state, enable, clear,
  reinitialize, engine status, pairing-source status, bootstrap overwrite check,
  reconcile-ready-state, bootstrap snapshot, cycle trigger, background engine
  start/stop, snapshot generation, and snapshot cancellation routes, guarded
  HTTP route access, route inertness without injection, JSON `null` clear
  responses, body-ignoring no-body routes, `allowOverwrite` defaulting and
  camelCase-only request handling, explicit device path boundaries, sidecar
  auth, and deferred real Connect/device-sync runtime behavior.
- `pr5-connect-device-sync-route-seam-review`: rubber-duck and code review found
  no actionable issues after confirming route parity, sidecar auth, path
  boundaries, body/no-body behavior, JSON `null` clear responses,
  reconcile-ready-state validation/defaulting, type-safety, docs accuracy, and
  test coverage.
- `pr5-connect-device-sync-route-seam-repo-check`: full repo check passed with
  `bun run check`.
- `pr5-device-sync-device-management-route-seam`: targeted checks passed:
  `bun run --cwd apps/backend type-check` and `bun run --cwd apps/backend test`.
  Coverage includes injectable device register, current-device lookup, device
  lookup, list, update, delete, and revoke routes, guarded HTTP route access,
  route inertness without injection, static-vs-dynamic route boundaries,
  malformed path encoding errors, decoded path IDs, camelCase register
  validation, optional/null update display-name behavior, empty-string scope
  passthrough, sync and async service error mapping, sidecar auth, and deferred
  real device-sync runtime behavior.
- `pr5-device-sync-device-management-route-seam-review`: rubber-duck and code
  review found and the slice fixed one bare `/sync/device` path-claim issue;
  targeted checks, full repo check, and focused re-review then found no
  remaining actionable issues across route boundaries, sidecar auth, path
  decoding, request validation, error mapping, type-safety, docs accuracy, and
  test coverage.
- `pr5-device-sync-device-management-route-seam-repo-check`: full repo check
  passed with `bun run check`.
- `pr5-device-sync-team-key-route-seam`: targeted checks passed:
  `bun run --cwd apps/backend type-check` and `bun run --cwd apps/backend test`.
  Coverage includes optional injectable team-key initialize, initialize commit,
  rotate, rotate commit, and team reset routes, guarded HTTP route access, route
  inertness without optional methods, no-body start-route behavior, commit/reset
  JSON validation, i32 key-version bounds, optional challenge/recovery/reason
  fields, envelope validation, sidecar auth, pairing route exclusion, and
  deferred real device-sync key/runtime behavior.
- `pr5-device-sync-team-key-route-seam-review`: code review found no actionable
  issues after confirming route parity, sidecar auth, optional-method inertness,
  no-body route behavior, JSON validation, key-version bounds, envelope parsing,
  route boundaries, type exports, docs accuracy, and test coverage.
- `pr5-device-sync-team-key-route-seam-repo-check`: full repo check passed with
  `bun run check`.
- `pr5-device-sync-pairing-route-seam`: targeted checks passed:
  `bun run --cwd apps/backend type-check` and `bun run --cwd apps/backend test`.
  Coverage includes optional injectable pairing issuer, claimer, composite, and
  flow-coordinator routes, guarded HTTP route access, route inertness without
  optional methods, required camelCase body validation, body-ignoring
  approve/cancel routes, `sasProof` JSON-value presence, optional snapshot/proof
  fields, decoded pairing IDs, malformed path encoding errors, reserved static
  route boundaries, sidecar auth, and deferred real device-sync pairing runtime
  behavior.
- `pr5-device-sync-pairing-route-seam-review`: code review found no actionable
  issues after confirming route parity, static-vs-dynamic route ordering,
  reserved path segments, malformed path decoding, body/no-body behavior,
  `sasProof` validation, optional-method inertness, sidecar auth, type-safety,
  and test coverage.
- `pr5-device-sync-pairing-route-seam-repo-check`: full repo check passed with
  `bun run check`.
- `pr5-runtime-composition`: targeted checks passed:
  `bun run --cwd apps/backend type-check` and `bun run --cwd apps/backend test`.
  Coverage includes `WF_DB_PATH` database path resolution, explicit/env app-data
  and migration-dir resolution, migration replay into a temporary DB, standalone
  TS server startup with SQLite-backed settings/accounts routes, settings
  persistence through the runtime handler, and idempotent runtime close. Later
  cutover cleanup removed the remaining TS `DATABASE_URL` fallback.
- `pr5-runtime-composition-review`: code review found no actionable issues after
  confirming env-path precedence, migration strategy, resource cleanup, service
  wiring boundaries, Electron/Rust default isolation, type-safety, and test
  coverage.
- `pr5-runtime-composition-repo-check`: full repo check passed with
  `bun run check`.
- `pr5-app-utility-runtime`: targeted checks passed:
  `bun run --cwd apps/backend type-check` and `bun run --cwd apps/backend test`.
  Coverage includes runtime app info, update-check 404/cache/response mapping
  with injectable fetch, instance-id headers, base64 backup, backup-to-path with
  `file://` normalization, `WF_DB_PATH`-aware backup helpers, standalone runtime
  app-info route wiring, and explicit `501` restore behavior while restart-safe
  TS restore remains deferred.
- `pr5-app-utility-runtime-review`: code review found no actionable issues after
  confirming restore gating, env/path handling, Rust response-shape parity,
  backup resource lifecycle, type-safety, and test coverage.
- `pr5-app-utility-runtime-repo-check`: full repo check passed with
  `bun run check`.
- `pr5-secrets-runtime`: targeted checks passed:
  `bun run --cwd apps/backend type-check` and `bun run --cwd apps/backend test`.
  Coverage includes Rust-compatible service ID formatting, encrypted
  set/get/delete behavior, plaintext legacy-file reads, raw-key to HKDF-derived
  key migration, no-key encrypted-store errors, file permission checks,
  standalone runtime route wiring, and explicit TS runtime startup failure for
  `WF_SECRET_BACKEND=keyring`.
- `pr5-secrets-runtime-review`: code review found no actionable issues after
  confirming ChaCha20-Poly1305 format compatibility, HKDF key derivation,
  service ID normalization, migration behavior, keyring startup failure, file
  write security, and test coverage.
- `pr5-secrets-runtime-repo-check`: full repo check passed with `bun run check`.
- `pr5-ai-provider-runtime`: targeted checks passed:
  `bun run --cwd apps/backend type-check` and `bun run --cwd apps/backend test`.
  Coverage includes catalog/settings merge and sorting, secret-backed API-key
  flags, non-catalog model inclusion, grouped tool allowlist expansion,
  anthropic tuning sanitization, tuning validation, custom URL/default-provider
  clearing, model capability override removal, provider-specific model-list
  request/response parsing with injectable fetch, missing-key validation, and
  standalone runtime route wiring.
- `pr5-ai-provider-runtime-review`: code review found no actionable issues after
  confirming settings persistence shape, catalog sourcing, sorting/merge parity,
  secret handling, tool/tuning normalization, model-list parsing, runtime
  wiring, and test coverage.
- `pr5-ai-provider-runtime-repo-check`: full repo check passed with
  `bun run check`.
- `pr5-sync-crypto-runtime`: targeted checks passed:
  `bun run --cwd apps/backend type-check` and `bun run --cwd apps/backend test`.
  Coverage includes root-key generation, versioned DEK derivation, RFC 7748
  X25519 shared-secret vectors, generated keypair symmetry, session-key
  derivation, nonce-prefixed XChaCha20-Poly1305 encryption/decryption,
  normalized pairing-code hashing, HMAC-SHA256, SAS codes, UUID device IDs, and
  standalone runtime route wiring.
- `pr5-sync-crypto-runtime-review`: code review raised the X25519 package
  subpath as a possible issue; package exports and direct ESM import
  verification confirmed `@noble/curves/ed25519.js` is the supported path for
  v2.2.0. No code change was needed.
- `pr5-sync-crypto-runtime-repo-check`: full repo check passed with
  `bun run check`.
- `pr5-classification-migration-runtime`: targeted checks passed:
  `bun run --cwd apps/backend type-check` and `bun run --cwd apps/backend test`.
  Coverage includes Rust-compatible legacy sector/country status counting
  without active-asset filtering, non-string legacy value handling, migrated
  GICS/region assignment creation, JSON-string and raw-array parsing, weight
  rounding/clamping, existing-assignment skips, parse-error collection,
  idempotent cleanup, metadata `identifiers` preservation, metadata `NULL`
  cleanup when identifiers are absent, and standalone runtime route wiring for
  `/api/v1/taxonomies/migration/status`.
- `pr5-classification-migration-runtime-review`: rubber-duck critique identified
  parity risks around active-asset filtering, key-presence cleanup, metadata
  `NULL` cleanup, parse-error collection, and assets-processed accounting; the
  implementation and tests cover those cases. Focused code review then found no
  actionable issues.
- `pr5-custom-provider-test-source-runtime`: targeted checks passed:
  `bun run --cwd apps/backend type-check` and `bun run --cwd apps/backend test`.
  Coverage includes Rust-compatible template expansion, browser-like and
  user-supplied headers, secret-backed header resolution, non-string header
  skipping, redirect limiting, byte-based response-size guards, network and HTTP
  failure result shapes, JSONPath extraction, factor/invert behavior, JSON
  currency/date/OHLCV fields, CSV delimiter/last-row extraction, locale-aware
  numeric parsing, HTML CSS extraction with detected element previews,
  HTML-table header-row handling, detected table metadata, preview-only table
  success, and guarded HTTP/runtime route wiring.
- `pr5-fx-runtime`: targeted checks passed:
  `bun run --cwd apps/backend type-check` and `bun run --cwd apps/backend test`.
  Coverage includes initialized historical converter behavior, nearest-date
  graph conversions, direct and inverse latest rates, Decimal-backed scalar
  conversions, minor currency normalization, full-timestamp historical range
  boundaries, Yahoo/manual pair registration, assets-created events, inverse
  registration skips, dated fallback warnings, and converter refresh after FX
  deletes. Focused review found and fixed the missing dated fallback warning
  parity gap; re-review found no remaining actionable issues. Full repository
  check passed with `bun run check`.
- `pr5-app-utility-restore-runtime`: targeted checks passed:
  `bun run --cwd apps/backend type-check -- --pretty false` and
  `bun run --cwd apps/backend test`. Coverage includes normalized `file://`
  restore paths, missing-backup validation before runtime prepare, live-runtime
  restore through HTTP, restored SQLite file contents after restart, `readyz`
  and route-level restart-required `503` behavior, and in-flight restore guard
  behavior during the settle window. Rubber-duck critique identified the live
  Bun SQLite handle risk, so the implementation closes the handle and gates
  subsequent requests instead of reusing stale services. Focused review found
  and fixed restore settle-delay and best-effort checkpoint/journal parity gaps;
  final review found no remaining actionable issues. Full repository check
  passed with `bun run check`.
- `pr5-contribution-deposit-runtime`: targeted checks passed:
  `bun run --cwd apps/backend type-check -- --pretty false` and
  `bun run --cwd apps/backend test`. Coverage includes SQLite activity/account
  filtering, deposit/credit/transfer contribution rules, internal transfer-pair
  exclusion, external-flow metadata handling, missing counted-amount errors,
  archived-account exclusion, explicit inclusive date ranges, user-timezone
  default year boundaries, and FX conversion dates. Rubber-duck critique and
  focused code review found no remaining actionable issues. Full repository
  check passed with `bun run check`.
- `pr5-alternative-assets-runtime`: targeted checks passed:
  `bun run --cwd apps/backend type-check -- --pretty false` and
  `bun run --cwd apps/backend test src/domains/alternative-assets.test.ts src/runtime.test.ts`.
  Coverage includes asset/manual-quote creation, same-day manual quote
  replacement, asset-created events, latest-quote holdings reads, decimal gain
  ratios, liability link metadata replacement, unlink no-op parity, asset delete
  liability unlinking, metadata removal asymmetry, purchase quote creation,
  input validation, and standalone runtime route wiring. Rubber-duck critique
  and focused code review found no remaining actionable issues. Full repository
  check passed with `bun run check`.
- `pr5-assets-contained-runtime`: targeted checks passed:
  `bun run --cwd apps/backend type-check -- --pretty false` and
  `bun run --cwd apps/backend test src/domains/assets.test.ts src/runtime.test.ts`.
  Coverage includes asset list/profile response mapping, Rust exchange-name
  enrichment from the existing exchange catalog, invalid JSON metadata fallback,
  exact quote-mode validation, manual-mode sync-state cleanup, `assets_updated`
  events, delete activity guards, quote/sync-state cleanup, explicit
  create/profile deferral until canonicalization is ported, and standalone
  runtime route wiring. Rubber-duck critique narrowed the slice away from unsafe
  create/profile mutation, and focused code review found no remaining actionable
  issues. Full repository check passed with `bun run check`.
- `pr5-assets-mutation-runtime`: targeted checks passed:
  `bun run --cwd apps/backend type-check -- --pretty false` and
  `bun run --cwd apps/backend test src/domains/assets.test.ts src/runtime.test.ts`.
  Coverage includes create/profile SQLite writes, Rust-compatible
  equity/option/metal Yahoo suffix canonicalization, crypto and FX pair
  canonicalization, bond CUSIP-to-ISIN conversion, duplicate `instrument_key`
  returns without duplicate create events, German ISIN provider inference,
  optional profile notes/omitted-field preservation, MARKET MIC quote-currency
  refresh, quote sync-state reset, empty final `quote_ccy` rejection, and
  standalone runtime route wiring. Focused code review found and fixed optional
  profile notes, empty quote-currency update, and transaction-bound duplicate
  detection gaps; re-review found no remaining actionable issues.
- `pr5-market-data-quote-crud-runtime`: targeted checks passed:
  `bun run --cwd apps/backend type-check -- --pretty false` and
  `bun run --cwd apps/backend test src/domains/market-data.test.ts src/runtime.test.ts src/http.test.ts`.
  Coverage includes Rust-compatible exchange-list parsing, quote history mapping
  and descending day order, manual quote update with path-owned asset IDs,
  deterministic manual quote IDs, provider-row replacement, same-day/source ID
  preservation, zero optional OHLCV storage as `NULL`, minor-unit currency
  spelling preservation, idempotent quote deletes, invalid update rejection, and
  standalone runtime route wiring while search/import/sync stay optional and
  deferred. Rubber-duck critique split latest snapshot and CSV import into later
  slices; focused code review found no remaining actionable issues.
- `pr5-market-data-latest-snapshot-runtime`: targeted checks passed:
  `bun run --cwd apps/backend type-check -- --pretty false` and
  `bun run --cwd apps/backend test src/domains/market-data.test.ts src/runtime.test.ts src/http.test.ts`.
  Coverage includes Rust-compatible latest-quote source priority, duplicate
  asset-ID de-duplication, exchange timezone/close/weekend effective dates,
  stale snapshot flags, inactive asset staleness, minor-unit currency spelling
  preservation, no-quote reason priority, and standalone runtime route wiring.
  Focused code review found no actionable issues. Full repository check passed
  with `bun run check`.
- `pr5-market-data-quote-import-runtime`: targeted checks passed:
  `bun run --cwd apps/backend type-check -- --pretty false` and
  `bun run --cwd apps/backend test src/domains/market-data.test.ts src/runtime.test.ts src/domains/custom-providers.test.ts`.
  Coverage includes Rust-compatible CSV header/no-header parsing,
  case-insensitive required columns, comma-thousands and `.5` decimals, asset
  matching by ID, display code, and Yahoo suffix, invalid row statuses/messages,
  warning rows, missing-header/empty-file errors, overwrite=false duplicate
  detection across all quote sources, overwrite=true manual upserts, noon UTC
  timestamps, zero-to-NULL OHLCV storage, existing manual ID preservation,
  shared custom provider CSV parser coverage, and standalone runtime route
  wiring. Focused code review found no actionable issues. Full backend tests and
  full repository check passed with `bun run --cwd apps/backend test` and
  `bun run check`.
- `pr5-market-data-yahoo-dividends-runtime`: targeted checks passed:
  `bun run --cwd apps/backend test src/domains/market-data.test.ts`, plus
  backend type-check and full backend test with
  `bun run --cwd apps/backend type-check -- --pretty false` and
  `bun run --cwd apps/backend test`. Coverage includes Rust-compatible Yahoo
  cookie/crumb reuse, two-year daily chart query parameters, dividend event
  extraction/order, cached crumb reuse, 401 crumb invalidation, symbol-not-found
  mapping, and Yahoo chart no-data mapping. Follow-up code review found no
  remaining actionable issues. Full repository check passed with
  `bun run check`.
- `pr5-market-data-search-runtime`: targeted checks passed:
  `bun run --cwd apps/backend test src/domains/market-data.test.ts src/runtime.test.ts`,
  backend type-check with
  `bun run --cwd apps/backend type-check -- --pretty false`, and full backend
  tests with `bun run --cwd apps/backend test`. Coverage includes existing
  SQLite asset search, Yahoo raw search request/header behavior, exchange
  code/suffix MIC mapping, provider currency preservation, canonical
  instrument-key de-dupe, secondary Yahoo search fallback, provider failure
  fallback to existing assets, and runtime route wiring with injectable fetch.
  Rubber-duck critique and two code-review passes found no remaining actionable
  issues after suffix-case hardening. Full repository check passed with
  `bun run check`.
- `pr5-market-data-resolve-runtime`: targeted checks passed:
  `bun run --cwd apps/backend test src/domains/market-data.test.ts`, backend
  type-check with `bun run --cwd apps/backend type-check -- --pretty false`, and
  full backend tests with `bun run --cwd apps/backend test`. Coverage includes
  empty/default responses, non-Yahoo provider preferences, Yahoo suffix
  stripping without double suffixing, quoteSummary price/currency extraction,
  401 crumb retry, crypto pair provider-symbol reconstruction, and BOND default
  behavior. Rubber-duck critique and code review found no remaining actionable
  issues after locking Rust-compatible case-sensitive provider matching. Full
  repository check passed with `bun run check`.
- `pr5-activities-import-template-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/activities.test.ts apps/backend/src/http.test.ts apps/backend/src/runtime.test.ts`
  and backend type-check with
  `bun run --cwd apps/backend type-check -- --pretty false`. Coverage includes
  Rust-compatible default import mappings, ACTIVITY/HOLDINGS context
  normalization, account-local template IDs, template config JSON
  casing/defaults, shared-template relinking with stable link row IDs, CSV
  template filtering/order, missing-template defaults, template link/delete
  cascade, duplicate idempotency-key lookups including empty and chunked input,
  partial activities route inertness, and standalone runtime route wiring.
  Rubber-duck critique identified the partial-route interception and link-row
  identity risks; the implementation guards each activities route method and
  tests row-ID preservation. Device-sync outbox emission for these writes
  remains deferred to sync parity slices.
- `pr5-activities-search-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/activities.test.ts apps/backend/src/runtime.test.ts`
  and backend type-check with
  `bun run --cwd apps/backend type-check -- --pretty false`. Coverage includes
  Rust-compatible archived-account filtering, keyword/date/instrument/status
  filters, `needsReview` status semantics, date sorting with created-at
  tiebreaks, asset-id sort behavior, pagination metadata, cash-activity empty
  asset mapping, status fallback, amount fallback, invalid metadata fallback,
  and standalone runtime route wiring. Rubber-duck critique narrowed the slice
  away from create/update/delete/bulk/transfer writes so asset resolution,
  decimal patch semantics, device-sync outbox, and portfolio recalculation stay
  deferred to dedicated parity slices.
- `pr5-activities-transfer-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/activities.test.ts apps/backend/src/http.test.ts apps/backend/src/runtime.test.ts`,
  backend type-check with
  `bun run --cwd apps/backend type-check -- --pretty false`, and full backend
  tests with `bun run --cwd apps/backend test`. Coverage includes same-ID,
  same-account, wrong-type, already-linked, unlinked, and mismatched-group
  guards; transfer-in/out return ordering; shared `sourceGroupId` assignment;
  unlink clearing; metadata `flow.is_external` mutation with sibling-key
  preservation; `isUserModified` flags; and route/runtime wiring while
  create/update/delete/bulk/import side effects stay deferred.
- `pr5-activities-delete-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/activities.test.ts apps/backend/src/http.test.ts apps/backend/src/runtime.test.ts`
  and backend type-check with
  `bun run --cwd apps/backend type-check -- --pretty false`. Coverage includes
  read-before-delete response mapping, metadata parsing, source identity return
  fields, row removal, missing-row errors, and route/runtime wiring while
  create/update/bulk/import side effects and recalculation stay deferred.
- `pr5-activities-create-update-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/activities.test.ts apps/backend/src/runtime.test.ts`
  and `bun run --filter @wealthfolio/backend type-check`. Coverage includes
  generated activity IDs, strict RFC3339/YYYY-MM-DD date normalization,
  Rust-compatible idempotency key computation and duplicate errors, source
  defaults/preservation, subtype/status defaults and clearing, decimal patch
  semantics, absolute economic signs, minor-currency normalization, securities
  transfer amount clearing, metadata preservation, and existing-asset/cash
  persistence. Rubber-duck critique added coverage for validation order,
  idempotency parity, and minor-currency normalization. Symbol-only asset
  resolution/creation, quote fallback writes, bulk mutation, import execution,
  device-sync outbox, and portfolio recalculation remain deferred.
- `pr5-activities-bulk-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/activities.test.ts apps/backend/src/runtime.test.ts`
  and `bun run --filter @wealthfolio/backend type-check`. Coverage includes
  bounded create/update/delete preparation, created identifier mappings,
  delete/update/create persistence order, duplicate idempotency errors,
  missing-row update/delete errors, and no-write-on-error atomicity while
  symbol-only asset resolution, quote fallback writes, CSV import execution,
  device-sync outbox, and portfolio recalculation remain deferred.
- `pr5-activities-symbol-resolution-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/activities.test.ts apps/backend/src/runtime.test.ts`
  and `bun run --filter @wealthfolio/backend type-check`. Coverage includes
  create and update writes resolving symbol-only activity inputs to exactly one
  existing SQLite asset using symbol plus optional exchange MIC/instrument type
  hints, no-write errors for missing symbols, ambiguity-safe duplicate-symbol
  failures, and successful disambiguation via hints. Focused review found no
  blocking issues; the review-identified hint coverage gap was added. Full
  repository check passed with `bun run check`. Asset creation, quote fallback
  writes, CSV import execution, device-sync outbox, and portfolio recalculation
  remain deferred.
- `pr5-activities-csv-parse-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/activities.test.ts apps/backend/src/runtime.test.ts`
  and `bun run --filter @wealthfolio/backend type-check`. Coverage includes
  Rust-compatible delimiter auto-detection, explicit tab delimiter handling,
  UTF-8/UTF-16 BOM handling, Windows-1252 fallback warnings, header and
  generated no-header columns, structure warnings for extra columns, row
  truncation, empty-file and over-skip validation, detected config response
  fields, and standalone runtime route wiring for multipart
  `/api/v1/activities/import/parse` while import execution, asset preview,
  device-sync outbox, and portfolio recalculation remain deferred.
- `pr5-activities-asset-preview-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/activities.test.ts apps/backend/src/runtime.test.ts`
  and `bun run --filter @wealthfolio/backend type-check`. Coverage includes
  existing-asset matches with draft mapping, bounded manual new-asset drafts,
  missing-exchange `NEEDS_FIXING` results, missing-account validation,
  ambiguity-safe duplicate-symbol errors, and no provider fetches or writes
  while import execution, asset creation, device-sync outbox, and portfolio
  recalculation remain deferred.
- `pr5-activities-import-check-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/activities.test.ts apps/backend/src/runtime.test.ts`
  and `bun run --filter @wealthfolio/backend type-check`. Coverage includes
  mapped-row account validation, existing-asset use, bounded symbol resolution,
  Rust-compatible create normalization, existing duplicate idempotency-key
  warnings, in-batch duplicate warnings, and standalone runtime route wiring
  while import execution, asset creation, device-sync outbox, and portfolio
  recalculation remain deferred.
- `pr5-activities-import-apply-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/activities.test.ts apps/backend/src/runtime.test.ts`
  and `bun run --filter @wealthfolio/backend type-check`. Coverage includes
  apply-time validation without partial writes, existing-asset/cash activity
  inserts, CSV source/import-run metadata, DRAFT/POSTED status mapping,
  duplicate skipping, all-duplicate import-run creation, `forceImport`
  idempotency-key clearing only for duplicate rows, non-duplicate key
  preservation, and standalone runtime route wiring while transfer-pair
  auto-linking, FX pair ensure, device-sync outbox, and portfolio recalculation
  remained deferred at that slice.
- `pr5-activities-import-transfer-link-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/activities.test.ts apps/backend/src/runtime.test.ts`
  and `bun run --filter @wealthfolio/backend type-check`. Coverage includes
  cross-account `TRANSFER_IN`/`TRANSFER_OUT` import pair matching by date,
  currency, symbol, and amount, shared `source_group_id` writes, internal-flow
  metadata replacement, response source-group mapping, and preserving duplicate
  filtering before pairing while FX pair ensure, device-sync outbox, and
  portfolio recalculation remained deferred at that slice.
- `pr5-activities-import-fx-ensure-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/activities.test.ts apps/backend/src/runtime.test.ts`
  and `bun run --filter @wealthfolio/backend type-check`. Coverage includes
  collecting activity-currency/account-currency and
  quote-currency/account-currency pairs for inserted rows, runtime wiring to the
  migrated exchange-rate service, de-duplicated pair ensure calls before
  activity/import-run writes, and no partial writes when FX registration fails
  while device-sync outbox and portfolio recalculation remain deferred.
- `pr5-activities-symbol-asset-creation`: targeted checks passed:
  `bun test apps/backend/src/domains/activities.test.ts`,
  `bun run --filter @wealthfolio/backend type-check`, and full `bun run check`.
  Coverage includes transaction-bound local asset creation from explicit
  activity symbol metadata, read-only import checks that stage but do not write
  assets, checked-import asset IDs carried into apply, import `assetsCreated`
  summaries, new-asset `assets_created` events before `activities_changed`, FX
  pair collection from pending assets, and focused code review with no remaining
  actionable issues. Provider-backed asset resolution, device-sync outbox, and
  portfolio recalculation remain deferred.
- `pr5-activities-manual-quote-side-effects`: targeted checks passed:
  `bun test apps/backend/src/domains/activities.test.ts`,
  `bun run --filter @wealthfolio/backend type-check`, and full `bun run check`.
  Coverage includes requested MANUAL quote-mode updates, MANUAL quote upserts
  for BUY/SELL/TRANSFER_IN create/update/import paths, preserved MARKET-mode and
  income-activity no-write behavior, deterministic quote IDs, pending-asset
  quote writes in import, transaction-bound writes, and focused code review with
  no blocking issues. Provider-backed asset resolution, device-sync outbox, and
  portfolio recalculation remain deferred.
- `pr5-activities-sync-event-queueing`: targeted checks passed:
  `bun test apps/backend/src/domains/activities.test.ts`,
  `bun run --filter @wealthfolio/backend type-check -- --pretty false`, and full
  `bun run check`. Coverage includes Rust `should_sync_outbox_for_activity`
  filtering, post-transaction Create/Update/Delete activity sync callback events
  for create/update/delete, bulk, transfer link, and CSV import writes, bulk
  no-event behavior on validation errors, Rust-shaped ActivityDB payloads, and
  focused code review with no material issues. Provider-backed asset resolution,
  import-run/asset sync outbox follow-ups, real sync_outbox persistence/runtime
  wiring, and portfolio recalculation remained deferred at that slice.
- `pr5-activities-import-run-sync-event-queueing`: targeted checks passed:
  `bun test apps/backend/src/domains/activities.test.ts`,
  `bun run --filter @wealthfolio/backend type-check -- --pretty false`, and full
  `bun run check`. Coverage includes CSV import-run Create sync callback events
  queued before per-activity Create callbacks, Rust-shaped ImportRunDB payloads,
  Rust `should_sync_outbox_for_import_run` filtering, and focused code review
  with no material issues. Provider-backed asset resolution, activity-created
  asset sync outbox follow-ups, real sync_outbox persistence/runtime wiring, and
  portfolio recalculation remained deferred at that slice.
- `pr5-activities-created-asset-sync-event-queueing`: targeted checks passed:
  `bun test apps/backend/src/domains/activities.test.ts` and
  `bun run --filter @wealthfolio/backend type-check -- --pretty false`; full
  repository check passed with `bun run check`. Coverage includes Rust-shaped
  AssetDB payloads for explicit-symbol assets created by activity create and CSV
  import paths, asset Create event ordering before dependent import/activity
  sync callbacks, no generated `instrument_key` in the payload, no events or
  asset persistence on failed bulk writes, and post-transaction queueing only.
  Remaining asset update/quote sync callbacks, sync_outbox persistence/runtime
  wiring, and portfolio recalculation remained deferred at that slice.
- `pr5-sync-outbox-runtime-wiring`: targeted checks passed:
  `bun test apps/backend/src/sync-outbox.test.ts apps/backend/src/runtime.test.ts --grep "sync outbox|goal valuation"`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes Rust-compatible entity/op mapping for goal/activity callback
  events, shallow payload key normalization, pending sync_outbox row inserts,
  trusted device key-version/device-id resolution, sync_entity_metadata upserts,
  unsupported entity/conflicting alias failures, runtime goal outbox wiring, and
  local-only summary refresh behavior. Remaining sync engine push/pull,
  encryption/cloud client runtime, and broader domain outbox wiring remain
  deferred.
- `pr5-fx-asset-sync-outbox-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/exchange-rates.test.ts apps/backend/src/runtime.test.ts --grep "exchange rates|FX asset sync|runtime FX|goal valuation"`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes runtime exchange-rate FX asset Create/Delete callback
  persistence to `sync_outbox`, Rust-compatible `asset` entity/op rows, delete
  payloads, and Create payloads without generated `instrument_key`.
- `pr5-custom-provider-sync-outbox-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/custom-providers.test.ts apps/backend/src/runtime.test.ts --grep "custom providers|custom provider sync|runtime custom provider"`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes runtime custom provider Create/Update/Delete callback
  persistence to UUID-keyed `custom_provider` outbox rows and normalized
  payloads.
- `pr5-taxonomy-sync-outbox-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/taxonomies.test.ts apps/backend/src/sync-outbox.test.ts apps/backend/src/runtime.test.ts --grep "taxonom|sync outbox|runtime taxonomy"`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes runtime custom taxonomy Create/Update/Delete bundle
  persistence to `custom_taxonomy` outbox rows with Rust-shaped nested
  taxonomy/category payloads, plus asset taxonomy assignment Update/Delete
  persistence to `asset_taxonomy_assignment` rows.
- `pr5-goal-plan-save-up-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/goals.test.ts apps/backend/src/http.test.ts`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes save-up `goal_plans` upsert/delete runtime, version
  increments, created-at preservation, unknown settings preservation, summary
  defaulting, `goal_plans` sync Create/Update/Delete events,
  `POST /api/v1/goals/plan`, and unconditional 204 plan deletes while summary
  refresh and goal calculations remain deferred.
- `pr5-goal-plan-retirement-save-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/goals.test.ts apps/backend/src/runtime.test.ts apps/backend/src/http.test.ts`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes retirement `goal_plans` upsert runtime, retirement plan JSON
  validation, `birthYearMonth` current-age normalization, unknown frontend-owned
  settings preservation, duplicate DC linked-account guards, participating-share
  DC link rejection, planner-mode persistence, sync Create events, and continued
  deferral of retirement simulations, summary refresh, and save-up overview
  calculations.
- `pr5-goal-save-up-preview-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/save-up.test.ts apps/backend/src/http.test.ts apps/backend/src/domains/goals.test.ts`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes Rust-compatible save-up input validation, local-date future
  value projection, required monthly contribution solving, open-ended and past
  target-date behavior, zero-target/unreachable completion handling, leap-year
  month-clamp behavior, and guarded `/api/v1/goals/save-up/preview` route wiring
  while goal-id save-up overview, summary refresh, and retirement simulations
  remain deferred. Full repository check passed with `bun run check`, and
  focused review found no actionable issues.
- `pr5-goal-save-up-overview-service`: targeted checks passed:
  `bun test apps/backend/src/domains/goals.test.ts apps/backend/src/domains/save-up.test.ts`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes funding-share valuation-map current values, missing
  valuation behavior, missing plan defaults, non-numeric plan setting defaults,
  numeric zero setting preservation, malformed settings JSON propagation, and
  achieved/archived summary-current-value fallback semantics while HTTP goal-id
  overview routing, summary refresh, and retirement simulations remain deferred.
- `pr5-goal-summary-refresh-service`: targeted checks passed:
  `bun test apps/backend/src/domains/goals.test.ts apps/backend/src/domains/save-up.test.ts`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes Rust-compatible non-retirement summary field updates,
  funding-share current values, target vs summary-target fallback, progress
  capping, projected-field preservation, health threshold boundaries, achieved
  health override, achieved/archived current-value fallback, no-plan retirement
  summary clearing, and explicit deferral of plan-backed retirement summary
  refresh while HTTP summary refresh routing remains deferred.
- `pr5-ai-chat-persistence-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/ai-chat.test.ts apps/backend/src/runtime.test.ts apps/backend/src/http.test.ts`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes SQLite-backed thread listing with pinned/updated/id
  ordering, title search, cursor pagination, empty-cursor validation, `limit=0`
  parity, tag loading for lists, Rust-compatible empty tags for direct thread
  reads, thread update/delete behavior, message reads, tool-result patch
  merging, standalone runtime route wiring, and an explicit `501` for deferred
  AI chat streaming while provider streaming, title generation, tool execution,
  attachment handling, and device-sync outbox writes remain deferred.
- `pr5-ai-chat-text-streaming-runtime`: targeted checks passed:
  `bun run --cwd apps/backend type-check -- --pretty false` and
  `bun run --cwd apps/backend test --run src/domains/ai-chat.test.ts src/domains/ai-providers.test.ts src/http.test.ts src/runtime.test.ts`.
  Coverage includes provider-config resolution wiring, OpenAI-compatible SSE
  chunk buffering, Ollama NDJSON streaming, Rust-shaped `system`/`textDelta`/
  `done` events with persisted assistant message payloads, new-thread config
  snapshots, parent-truncated history, missing-key and attachment pre-stream
  errors, provider stream error events, and standalone runtime
  provider-not-configured behavior.
- `pr5-ai-chat-error-code-frontend`: targeted check passed:
  `bun run --cwd apps/frontend test --run src/features/ai-assistant/types.test.ts`.
  Coverage includes mapping TS backend snake_case chat errors such as
  `provider_not_configured`, `missing_api_key`, `provider_error`, and
  `not_implemented` to the existing user-friendly frontend chat error messages.
- `pr5-ai-chat-text-attachments-runtime`: targeted checks passed:
  `bun run --cwd apps/backend type-check -- --pretty false` and
  `bun run --cwd apps/backend test --run src/domains/ai-chat.test.ts src/runtime.test.ts src/http.test.ts`.
  Coverage includes attachment metadata guards, Rust-aligned attachment
  count/UTF-8 byte-size validation, text/CSV prompt injection, persisted
  filename markers without raw attachment content, unsupported image attachment
  deferral, and existing provider streaming/runtime route behavior.
- `pr5-ai-chat-title-runtime`: targeted checks passed:
  `bun run --cwd apps/backend type-check -- --pretty false` and
  `bun run --cwd apps/backend test --run src/domains/ai-chat.test.ts src/domains/ai-providers.test.ts src/runtime.test.ts src/http.test.ts`.
  Coverage includes catalog title-model resolution, generated title cleanup,
  `threadTitleUpdated` events, persisted thread title updates with sync
  callbacks, deterministic fallback/no-op behavior, attachment-content exclusion
  from title prompts, stream-failure title persistence suppression, and existing
  provider streaming/runtime route behavior.
- `pr5-ai-chat-reasoning-runtime`: targeted checks passed:
  `bun run --cwd apps/backend type-check -- --pretty false` and
  `bun run --cwd apps/backend test --run src/domains/ai-chat.test.ts src/domains/ai-providers.test.ts src/runtime.test.ts src/http.test.ts`.
  Coverage includes streamed `<think>` fallback parsing, Rust-shaped
  `reasoningDelta` events, ordered reasoning/text assistant content persistence,
  and existing title/provider streaming/runtime route behavior.
- `pr5-ai-chat-native-reasoning-runtime`: targeted checks passed:
  `bun run --cwd apps/backend type-check -- --pretty false` and
  `bun run --cwd apps/backend test --run src/domains/ai-chat.test.ts src/domains/ai-providers.test.ts src/runtime.test.ts src/http.test.ts`.
  Coverage includes OpenAI-compatible `reasoning_content`, Anthropic
  `thinking_delta`, Ollama/Gemini-style native thinking fields, Rust-shaped
  `reasoningDelta` events, ordered reasoning/text assistant content persistence,
  and existing title/provider streaming/runtime route behavior.
- `pr5-ai-chat-tool-execution-seam`: targeted checks passed:
  `bun run --cwd apps/backend type-check -- --pretty false` and
  `bun run --cwd apps/backend test --run src/domains/ai-chat.test.ts src/domains/ai-providers.test.ts src/runtime.test.ts src/http.test.ts`.
  Coverage includes OpenAI-compatible streamed/split tool-call assembly,
  multiple tool calls in one round, Ollama tool calls, injected tool execution,
  failed tool execution as `success:false` `toolResult`, follow-up provider
  requests with tool messages, capability-gated tool schema omission,
  Rust-shaped `toolCall`/`toolResult` events, ordered assistant content
  persistence, and `import_csv` CSV argument redaction.
- `pr5-ai-chat-get-accounts-tool`: targeted checks passed:
  `bun run --cwd apps/backend type-check -- --pretty false` and
  `bun run --cwd apps/backend test --run src/domains/ai-chat-tools.test.ts src/domains/ai-chat.test.ts src/runtime.test.ts src/http.test.ts`.
  Coverage includes the runtime-registered Rust-compatible `get_accounts` tool
  definition, active account DTO shape, 50-account truncation metadata,
  OpenAI-compatible/Ollama execution seam compatibility, and existing runtime
  route behavior.
- `pr5-ai-chat-get-holdings-tool`: targeted checks passed:
  `bun run --cwd apps/backend type-check -- --pretty false` and
  `bun run --cwd apps/backend test --run src/domains/ai-chat-tools.test.ts src/domains/ai-chat.test.ts src/runtime.test.ts src/http.test.ts`.
  Coverage includes the runtime-registered Rust-compatible `get_holdings` tool
  definition, default TOTAL/treemap arguments, account-name lookup, cash holding
  filtering, base-currency/view-mode output, 100-holding truncation metadata,
  OpenAI-compatible/Ollama execution seam compatibility, and existing runtime
  route behavior.
- `pr5-ai-chat-get-cash-balances-tool`: targeted checks passed:
  `bun run --cwd apps/backend type-check -- --pretty false` and
  `bun run --cwd apps/backend test --run src/domains/ai-chat-tools.test.ts src/domains/ai-chat.test.ts src/runtime.test.ts src/http.test.ts`.
  Coverage includes the runtime-registered Rust-compatible `get_cash_balances`
  tool definition, TOTAL/empty-account defaults, active-account expansion,
  cash-only filtering, latest-valuation precedence, zero-base valuation
  fallback, unconvertible-currency errors, and existing runtime route behavior.
- `pr5-ai-chat-get-goals-tool`: targeted checks passed:
  `bun run --cwd apps/backend type-check -- --pretty false` and
  `bun run --cwd apps/backend test --run src/domains/ai-chat-tools.test.ts src/domains/ai-chat.test.ts src/runtime.test.ts src/http.test.ts`.
  Coverage includes the runtime-registered Rust-compatible `get_goals` tool
  definition, persisted summary target/current/progress/deadline mapping,
  achieved counts, total target/current sums, 50-goal truncation metadata, and
  existing runtime route behavior.
- `pr5-ai-chat-search-activities-tool`: targeted checks passed:
  `bun run --cwd apps/backend type-check -- --pretty false` and
  `bun run --cwd apps/backend test --run src/domains/ai-chat-tools.test.ts src/domains/ai-chat.test.ts src/runtime.test.ts src/http.test.ts`.
  Coverage includes the runtime-registered Rust-compatible `search_activities`
  tool definition, one-based to zero-based pagination, 200-row page-size clamp,
  account-name/id/TOTAL resolution, date validation, DTO number parsing and
  amount fallback, total-page/total-amount metadata, and existing runtime route
  behavior.
- `pr5-ai-chat-get-income-tool`: targeted checks passed:
  `bun run --cwd apps/backend type-check -- --pretty false` and
  `bun run --cwd apps/backend test --run src/domains/ai-chat-tools.test.ts src/domains/ai-chat.test.ts src/runtime.test.ts src/http.test.ts`.
  Coverage includes the runtime-registered Rust-compatible `get_income` tool
  definition, default/uppercase period selection, missing-period errors,
  optional YoY growth omission, income type/month breakdown mapping, sorted
  positive top-asset selection, and existing runtime route behavior.
- `pr5-ai-chat-get-performance-tool`: targeted checks passed:
  `bun run --cwd apps/backend type-check -- --pretty false` and
  `bun run --cwd apps/backend test --run src/domains/ai-chat-tools.test.ts src/domains/ai-chat.test.ts src/runtime.test.ts src/http.test.ts`.
  Coverage includes the runtime-registered Rust-compatible `get_performance`
  tool definition, default/explicit period date ranges, TOTAL and account-scoped
  requests, base-currency fallback, optional metric omission, and existing
  runtime route behavior.
- `pr5-ai-chat-get-valuation-history-tool`: targeted checks passed:
  `bun run --cwd apps/backend type-check -- --pretty false` and
  `bun run --cwd apps/backend test --run src/domains/ai-chat-tools.test.ts src/domains/ai-chat.test.ts src/runtime.test.ts src/http.test.ts`.
  Coverage includes the runtime-registered Rust-compatible
  `get_valuation_history` tool definition, explicit and default date ranges,
  TOTAL active-account aggregation, single-account valuation mapping, FX-to-base
  conversion, date sorting, 400-point truncation metadata, and existing runtime
  route behavior.
- `pr5-ai-chat-get-asset-allocation-tool`: targeted checks passed:
  `bun run --cwd apps/backend type-check -- --pretty false` and
  `bun run --cwd apps/backend test --run src/domains/ai-chat-tools.test.ts src/domains/ai-chat.test.ts src/runtime.test.ts src/http.test.ts`.
  Coverage includes the runtime-registered Rust-compatible
  `get_asset_allocation` tool definition, default class grouping, requested
  taxonomy selection across all grouping variants, invalid group errors,
  category drill-down holding mapping, and existing runtime route behavior.
- `pr5-ai-chat-get-health-status-tool`: targeted checks passed:
  `bun run --cwd apps/backend type-check -- --pretty false` and
  `bun run --cwd apps/backend test --run src/domains/ai-chat-tools.test.ts src/domains/ai-chat.test.ts src/domains/health.test.ts src/runtime.test.ts src/http.test.ts`.
  Coverage includes cached health status access without running checks, the
  runtime-registered Rust-compatible `get_health_status` tool definition,
  NOT_COMPUTED output when no cached check exists, cached issue field mapping,
  and existing runtime route behavior.
- `pr5-ai-chat-record-activity-tool`: targeted checks passed:
  `bun run --cwd apps/backend type-check -- --pretty false` and
  `bun run --cwd apps/backend test --run src/domains/ai-chat-tools.test.ts src/domains/ai-chat.test.ts src/runtime.test.ts src/http.test.ts`.
  Coverage includes the runtime-registered Rust-compatible `record_activity`
  draft tool definition, timezone/current-date guidance, account resolution and
  single-account auto-selection, symbol resolution with account-currency
  preference, amount computation, custom asset prompts, invalid type/date
  validation, and subtype-specific requirements. Full repository check passed
  with `bun run check`, and focused code review found no blocking issues after
  account-currency symbol preference was added.
- `pr5-ai-chat-record-activities-tool`: targeted checks passed:
  `bun run --cwd apps/backend type-check -- --pretty false` and
  `bun run --cwd apps/backend test --run src/domains/ai-chat-tools.test.ts src/domains/ai-chat.test.ts src/runtime.test.ts src/http.test.ts`.
  Coverage includes the runtime-registered Rust-compatible `record_activities`
  batch draft tool definition, shared single-row normalization, empty-batch
  behavior, 100-row batch limit, validation summaries, row-level error strings,
  available-account output, resolved-asset de-duplication, and existing runtime
  route behavior. Full repository check passed with `bun run check`, and focused
  code review found no blocking issues.
- `pr5-ai-chat-import-csv-tool`: targeted checks passed:
  `bun run --cwd apps/backend type-check -- --pretty false` and
  `bun run --cwd apps/backend test --run src/domains/ai-chat-tools.test.ts src/domains/ai-chat.test.ts src/runtime.test.ts src/http.test.ts`.
  Coverage includes the runtime-registered Rust-compatible `import_csv` mapping
  inference tool definition, complete CSV content handling, empty CSV rejection,
  LLM mapping merge and sanitization, saved-profile fallback, parse-config
  precedence, activity mapping inference, account sanitization, sample-row and
  confidence output, and CSV attachment prompt guidance. Full repository check
  passed with `bun run check`; focused code review found and the slice fixed a
  saved-profile flag edge case.
- `pr5-ai-chat-provider-tool-protocols`: targeted checks passed:
  `bun run --cwd apps/backend type-check -- --pretty false` and
  `bun run --cwd apps/backend test --run src/domains/ai-chat.test.ts src/domains/ai-chat-tools.test.ts src/runtime.test.ts src/http.test.ts`.
  Coverage includes Anthropic tool schemas, streamed `tool_use` block starts,
  partial JSON argument reassembly, empty-argument tool calls, grouped
  `tool_result` user blocks, Anthropic tool errors with `is_error`, Gemini
  function declarations, function-call/function-response turns, and suppression
  of synthetic Gemini response ids after rubber-duck plan review.
- `pr5-ai-chat-multimodal-attachments`: targeted checks passed:
  `bun run --cwd apps/backend type-check -- --pretty false` and
  `bun run --cwd apps/backend test --run src/domains/ai-chat.test.ts src/runtime.test.ts src/http.test.ts`.
  Coverage includes Anthropic image/PDF content blocks, Gemini inlineData parts,
  provider vision gating, strict image/PDF media-type allowlists, `image/jpg` to
  `image/jpeg` normalization, data URL base64-prefix stripping, binary payload
  exclusion from prompt text and persisted message content, and unsupported
  provider/media rejection before chat rows are created after rubber-duck plan
  review.
- `pr5-ai-chat-openai-ollama-image-attachments`: targeted checks passed:
  `bun test apps/backend/src/domains/ai-chat.test.ts --timeout 30000` and
  `bun run --cwd apps/backend type-check -- --pretty false`. Coverage includes
  OpenAI-compatible `image_url` content parts, Ollama `images` arrays, provider
  vision gating, image allowlists, OpenAI/Ollama PDF rejection before chat rows
  are created, `image/jpg` to `image/jpeg` normalization, data URL stripping and
  reconstruction, persisted marker-only user messages, and rubber-duck plan
  review.
- `pr5-keyring-secret-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/secrets.test.ts apps/backend/src/runtime.test.ts --timeout 30000`.
  Coverage includes Rust-compatible desktop service ID namespace formatting,
  native `@napi-rs/keyring` entry set/get/delete wiring, missing-keychain-entry
  null and idempotent delete behavior, native keyring error propagation,
  standalone runtime `WF_SECRET_BACKEND=keyring` startup wiring, and a local
  native keyring set/get/delete probe. Rubber-duck review found and the slice
  removed the insecure CLI `security -w <secret>` path; a second review found no
  blocking concerns. Backend type-check and full `bun run check` passed.
- `pr5-health-price-sync-fix-dispatch`: targeted checks passed:
  `bun test apps/backend/src/domains/health.test.ts apps/backend/src/runtime.test.ts --timeout 30000`
  and `bun run --cwd apps/backend type-check -- --pretty false`. Coverage
  includes `sync_prices`/`retry_sync` payload validation, Rust-compatible empty
  asset-list 400 behavior, delegation to incremental market-data sync, cached
  status invalidation only after successful sync, standalone runtime wiring, and
  the current explicit 501 response while market-data sync execution remains
  deferred. Rubber-duck plan review caught the empty-payload status branch
  before implementation.
- `pr5-health-fx-fix-dispatch`: targeted checks passed:
  `bun test apps/backend/src/domains/health.test.ts apps/backend/src/runtime.test.ts --timeout 30000`
  and `bun run --cwd apps/backend type-check -- --pretty false`. Coverage
  includes `fetch_fx` currency-pair payload parsing, invalid-pair 400 behavior,
  delegation to `exchangeRateService.ensureFxPairs`, cached status invalidation
  after successful FX pair registration, standalone runtime wiring, and
  continued deferral of real provider-backed FX quote fetching to market-sync
  parity.
- `pr5-market-sync-noop-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/market-data.test.ts apps/backend/src/runtime.test.ts --timeout 30000`
  and `bun run --cwd apps/backend type-check -- --pretty false`. Coverage
  includes `MarketSyncMode::None` no-op behavior, explicit empty asset-target
  no-op behavior for incremental/refetch/backfill modes, runtime
  `/api/v1/market-data/sync` empty-target 204 responses, and continued explicit
  501 responses for broad provider-backed sync execution.
- `pr5-health-targeted-classification-fix-dispatch`: targeted checks passed:
  `bun test apps/backend/src/http.test.ts apps/backend/src/domains/health.test.ts apps/backend/src/domains/taxonomies.test.ts apps/backend/src/runtime.test.ts --timeout 30000`
  and `bun run --cwd apps/backend type-check -- --pretty false`. Coverage
  includes `migrate_classifications` string-array payload validation,
  empty-array no-op behavior, provider-missing 404 behavior, dispatch to
  taxonomy legacy migration with selected asset IDs, selected-only taxonomy
  migration/metadata cleanup, missing asset ID no-op handling, standalone
  runtime wiring, and rubber-duck plan review.
- `pr5-health-legacy-classification-affected-items`: targeted checks passed:
  `bun test apps/backend/src/domains/health.test.ts apps/backend/src/domains/taxonomies.test.ts --timeout 30000`
  and `bun run --cwd apps/backend type-check -- --pretty false`. Coverage
  includes internal taxonomy migration details without changing public migration
  status shape, assets-needing-migration details after targeted migration,
  Rust-shaped legacy-classification affected items with `/holdings/{id}` route
  encoding, asset-symbol name fallback, and dismissal hash changes when the
  affected asset set or already-migrated count changes. Rubber-duck plan review
  found no blockers.
- `pr5-health-price-staleness-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/health.test.ts apps/backend/src/runtime.test.ts --timeout 30000`
  and `bun run --cwd apps/backend type-check -- --pretty false`. Coverage
  includes active-account holding consolidation, case-insensitive market pricing
  mode filtering, manual/zero-value handling, missing quote errors, stale quote
  warnings, strict `>` market-value critical escalation, affected-item routes,
  `sync_prices` fix actions, standalone runtime provider wiring, and quote
  timestamp-first staleness calculation refinement after code review. Full
  `bun run check` passed.
- `pr5-health-fx-integrity-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/health.test.ts apps/backend/src/domains/exchange-rates.test.ts apps/backend/src/runtime.test.ts --timeout 30000`
  and `bun run --cwd apps/backend type-check -- --pretty false`. Coverage
  includes latest FX asset quote snapshots with nullable quote timestamps,
  active-account FX exposure gathering from holdings, cash/non-instrument
  affected market value inclusion, instrument-only signed denominator behavior,
  missing/stale FX issue generation, strict `>` market-value critical
  escalation, direct-before-inverse FX asset lookup, `fetch_fx` fix actions, and
  account-provider capability gating after review.
- `pr5-health-quote-sync-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/health.test.ts apps/backend/src/domains/market-data.test.ts apps/backend/src/runtime.test.ts --timeout 30000`
  and `bun run --cwd apps/backend type-check -- --pretty false`. Coverage
  includes ordered quote-sync error snapshots, asset-symbol fallback,
  manual-quote-mode filtering, persistent/recent error grouping, unheld zero-MV
  sync-error assets, first-five detail cap with overflow, 80-character error
  truncation, persistent-only market-data navigation, warning severity
  non-escalation, strict `>` persistent critical escalation, and `retry_sync`
  fix actions.
- `pr5-health-negative-balance-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/health.test.ts apps/backend/src/runtime.test.ts --timeout 30000`
  and `bun run --cwd apps/backend type-check -- --pretty false`. Coverage
  includes non-cash negative portfolio balance warnings, cash-account negative
  balance info issues, affected account routes, activity navigation, decimal
  details formatting, likely-cause text, active-account CASH/non-CASH splitting,
  runtime `daily_account_valuation` provider wiring, and deterministic
  first-negative-row tie handling after code review.
- `pr5-health-status-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/health.test.ts apps/backend/src/runtime.test.ts apps/backend/src/http.test.ts`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes bounded account tracking-mode and timezone
  missing/invalid/mismatch status checks, Rust-compatible timezone
  offset-equivalence behavior, severity rollups, issue-count response shape,
  dismissal filtering and cache invalidation, stale-cache responses keyed by
  client timezone, standalone runtime route wiring for `/api/v1/health/status`
  and `/api/v1/health/check`, and deferred `/health/fix` behavior while
  price/quote/FX/classification/consistency checks, market-sync fixes, and
  Rust-generated dismissal-hash carryover remain deferred.
- `pr5-health-classification-fix-runtime`: targeted checks passed:
  `bun test apps/backend/src/runtime.test.ts apps/backend/src/http.test.ts` and
  `bun run --filter @wealthfolio/backend type-check -- --pretty false`. Coverage
  includes `/api/v1/health/fix` dispatch for `migrate_legacy_classifications`
  through the migrated taxonomy runtime, preserving guarded route behavior and
  keeping price sync, retry sync, FX fetch, and other health fix actions
  deferred.
- `pr5-health-legacy-classification-issue-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/health.test.ts apps/backend/src/runtime.test.ts apps/backend/src/http.test.ts`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes taxonomy migration status consumption, generated
  `classification:legacy_migration:*` warning issues, migrated classification
  fix action payloads, severity rollup, standalone runtime wiring, and continued
  deferral of full affected-item parity and Rust-generated dismissal hashes.
- `pr5-retirement-overview-route-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/goals.test.ts apps/backend/src/http.test.ts`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes `GoalService.computeRetirementOverview`,
  `GET /api/v1/goals/{id}/retirement/overview`, valuation-provider 501/503
  behavior, non-retirement and missing-plan errors, funding-share current
  portfolio, tax-bucket injection, and stored/default planner mode handling.
- `pr5-retirement-summary-refresh-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/goals.test.ts apps/backend/src/http.test.ts`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes plan-backed retirement summary target derivation, projected
  completion dates, projected value at target date, overview-status health
  mapping, no-plan clearing, unreachable-target summary fallback, and HTTP
  refresh-summary routing through the existing valuation-provider seam.
- `pr5-retirement-projection-route-runtime`: targeted checks passed:
  `bun test apps/backend/src/http.test.ts` and
  `bun run --filter @wealthfolio/backend type-check -- --pretty false`. Coverage
  includes `POST /api/v1/goals/retirement/projection` for direct plan payloads
  and goal-backed requests, standalone plan validation/normalization, stored
  plan/funding/tax-bucket resolution, planner-mode handling, and
  valuation-provider 501/503 behavior.
- `pr5-retirement-scenario-route-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/retirement-calculations.test.ts apps/backend/src/http.test.ts`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes Rust-compatible scenario labels and return deltas, adjusted
  accumulation/retirement returns, deterministic projection/overview-derived
  scenario DTOs, `POST /api/v1/goals/retirement/scenario-analysis` direct plan
  and goal-backed requests, planner-mode handling, and valuation-provider
  501/503 behavior. Full repository check passed with `bun run check`; focused
  code review found no significant issues.
- `pr5-retirement-sorr-route-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/retirement-calculations.test.ts apps/backend/src/http.test.ts`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes Rust-compatible sequence-of-returns scenario labels,
  grow-before-withdraw ordering, start-of-year portfolio path semantics,
  glide-path-adjusted normal returns, essential-spending failure ages,
  `POST /api/v1/goals/retirement/sequence-of-returns` direct plan and
  goal-backed requests, and valuation-provider 501/503 behavior. Full repository
  check passed with `bun run check`; focused code review found and fixed
  ordering/path/glide parity gaps, then re-review found no remaining actionable
  issues.
- `pr5-retirement-stress-route-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/retirement-calculations.test.ts apps/backend/src/http.test.ts`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes Rust-compatible risk-lab plan outcomes, return/inflation/
  spending/timing/saving stress mutators, early-crash SORR integration, stress
  delta and severity classification, deterministic severity/shortfall ordering,
  `POST /api/v1/goals/retirement/stress-tests` direct plan and goal-backed
  requests, planner-mode handling, and valuation-provider 501/503 behavior. Full
  repository check passed with `bun run check`; focused code review found no
  significant issues.
- `pr5-retirement-decision-sensitivity-route-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/retirement-calculations.test.ts apps/backend/src/http.test.ts`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes Rust-compatible contribution/return and
  retirement-age/spending axes, axis rounding/fill behavior, baseline indices,
  current-value cell scaling,
  `POST /api/v1/goals/retirement/decision-sensitivity-map` direct plan and
  goal-backed requests, planner-mode handling, and valuation-provider 501/503
  behavior. Full repository check passed with `bun run check`; focused code
  review found no significant issues.
- `pr5-retirement-monte-carlo-route-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/retirement-calculations.test.ts apps/backend/src/http.test.ts`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes Rust-compatible stochastic expense/income inflation
  semantics, splitmix64 seeding, deterministic seeded/no-seed Monte Carlo runs,
  start-of-year path percentile output, FIRE median-age gating, HTTP `nSims`
  default/clamp behavior, `POST /api/v1/goals/retirement/monte-carlo` direct
  plan and goal-backed requests, planner-mode handling, and valuation-provider
  501/503 behavior. Full repository check passed with `bun run check`;
  rubber-duck critique and focused code review found no significant issues.
- `pr5-net-worth-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/portfolio-metrics.test.ts apps/backend/src/runtime.test.ts`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes `/api/v1/net-worth` and `/api/v1/net-worth/history`
  standalone runtime wiring, latest holdings snapshot valuation, cash
  conversion, standalone alternative assets, liabilities, minor-currency quote
  normalization, FX conversion fallbacks, no-account empty response parity,
  staleness metadata, TOTAL valuation history, seed quote and daily
  carry-forward behavior for alternative assets, and explicit 501 responses for
  still-deferred performance/income route methods. Full repository check passed
  with `bun run check`; focused code review found no significant issues.
- `pr5-income-summary-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/portfolio-metrics.test.ts apps/backend/src/runtime.test.ts`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes `/api/v1/income/summary` standalone runtime wiring,
  SQLite-backed income activity reads, archived-account exclusion, optional
  account filtering, asset-backed DRIP/staking fallback amounts, FX conversion
  fallback behavior, configured-timezone current-date period logic, total/YTD
  prior-year summaries, monthly averages, YoY growth, and by-month/type/asset/
  currency/account breakdowns. Focused code review found no significant issues.
- `pr5-simple-performance-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/portfolio-metrics.test.ts apps/backend/src/runtime.test.ts`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes `/api/v1/performance/accounts/simple` standalone runtime
  wiring, omitted-account active-account lookup, explicit empty-account
  short-circuit behavior, request-order preservation, missing valuation skips,
  exact previous-day valuation lookup, TOTAL row round-tripping, portfolio
  weight null/clamp behavior, cumulative/day return formulas, field-specific
  rounding, and JSON number/null response parity.
- `pr5-account-performance-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/portfolio-metrics.test.ts apps/backend/src/runtime.test.ts`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes account-scoped `/api/v1/performance/history` and
  `/api/v1/performance/summary` standalone runtime wiring, valuation history
  reads, empty history responses, insufficient-summary errors, negative-history
  validation, TWR/MWR compounding, holdings-mode null TWR/MWR fields and period
  returns, annualized/simple returns, volatility, max drawdown, symbol summary
  empty responses, and local symbol-history provider fetch deferral.
- `pr5-symbol-performance-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/portfolio-metrics.test.ts --test-name-pattern "symbol performance|empty responses"`,
  `bun test apps/backend/src/runtime.test.ts --test-name-pattern "starts a TS server"`,
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes local quote-backed `symbol` performance history from SQLite
  `quotes`, local asset/display/instrument-symbol resolution, missing quote-day
  carry-forward, empty missing-symbol responses, annualized returns, volatility,
  max drawdown, runtime HTTP wiring, and explicit provider-backed
  fetch/resolution deferral.
- `pr5-symbol-performance-resolution`: targeted checks passed:
  `bun test apps/backend/src/domains/portfolio-metrics.test.ts --test-name-pattern "symbol performance|empty responses"`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`. Full
  repository check and focused code review also passed. Coverage includes local
  asset-id/display-code/instrument-symbol lookup before quote reads while
  preserving original response IDs and avoiding provider fetches.
- `pr5-holdings-valuation-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/holdings.test.ts apps/backend/src/runtime.test.ts`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes `/api/v1/valuations/history` and `/api/v1/valuations/latest`
  standalone runtime wiring, active-account default lookup, request-order
  preservation, filtered historical valuation reads, Decimal-as-number response
  mapping, missing-account skips, and explicit 501 gates for allocation,
  snapshot write, and import routes that still need dedicated parity slices.
- `pr5-holdings-snapshot-metadata-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/holdings.test.ts apps/backend/src/runtime.test.ts`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes `/api/v1/snapshots` standalone runtime wiring, SQLite
  `holdings_snapshots` metadata reads, optional date filters, source defaults,
  position/cash currency counts, and empty missing-account responses.
- `pr5-holdings-snapshot-holdings-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/holdings.test.ts apps/backend/src/runtime.test.ts`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes `/api/v1/snapshots/holdings` standalone runtime wiring,
  stored snapshot-to-holding conversion, asset metadata joins, security,
  alternative-asset, and cash holdings, zero-quantity and missing-asset
  filtering, base-currency injection, malformed/non-object JSON fallback, and
  missing-snapshot error mapping.
- `pr5-holdings-import-check-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/holdings.test.ts apps/backend/src/runtime.test.ts`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes `/api/v1/snapshots/import/check` standalone runtime wiring,
  account existence checks, date/quantity/average-cost validation, existing
  snapshot date detection, and local exact asset-symbol matching with trimmed
  symbols while provider-backed symbol search and import writes remained
  deferred at that slice.
- `pr5-live-holdings-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/holdings.test.ts apps/backend/src/runtime.test.ts`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes `/api/v1/holdings` standalone runtime wiring, latest
  snapshot reads, security/alternative/cash valuation, minor-currency
  normalization, quote source priority, contract multipliers, FX fallback
  behavior, no-quote cost-basis preservation, expired option filtering, missing
  asset skipping, and base-value portfolio weights. Full repository check passed
  with `bun run check`; focused code review found no significant issues.
- `pr5-holdings-detail-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/holdings.test.ts apps/backend/src/runtime.test.ts`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes `/api/v1/holdings/item` and `/api/v1/holdings/by-asset`
  standalone runtime wiring, valued holding detail reuse of live account
  holdings, null missing/zero/expired-position behavior, build-failure error
  parity, active-account by-asset fan-out, and per-account portfolio weights.
  Full repository check passed with `bun run check`; focused code review found
  no significant issues.
- `pr5-holdings-allocation-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/holdings.test.ts apps/backend/src/runtime.test.ts`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes `/api/v1/allocations` and `/api/v1/allocations/holdings`
  standalone runtime wiring, taxonomy rollups, cash bucket behavior, Unknown
  categories, partial assignment weights, custom taxonomies, omitted empty
  children, and weighted drill-down holding summaries. Full repository check
  passed with `bun run check`; focused code review found no significant issues.
- `pr5-holdings-snapshot-delete-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/holdings.test.ts apps/backend/src/runtime.test.ts`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes `DELETE /api/v1/snapshots` standalone runtime wiring,
  missing/calculated snapshot guards, manual/imported row deletion, and explicit
  deferral of portfolio recalculation side effects. Full repository check passed
  with `bun run check`.
- `pr5-holdings-manual-snapshot-save-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/holdings.test.ts apps/backend/src/runtime.test.ts`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes `POST /api/v1/snapshots` standalone runtime wiring, account
  and date validation, decimal validation, minimal manual asset creation, manual
  quote-mode updates, weighted manual quote upserts for duplicate same-asset
  inputs, stable snapshot ID upserts, zero-quantity/cash filtering, and
  synthetic backfill snapshot creation. Full repository check passed with
  `bun run check`.
- `pr5-holdings-snapshot-import-write-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/holdings.test.ts apps/backend/src/runtime.test.ts`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes `POST /api/v1/snapshots/import` standalone runtime wiring,
  top-level account validation, per-snapshot imported/failed counts and per-date
  errors, `CSV_IMPORT` snapshot persistence, local exact-symbol/minimal-asset
  creation, duplicate same-asset aggregation, invalid optional average-cost
  strings treated as zero, zero cash/position filtering, and synthetic backfill
  snapshot creation while provider-backed symbol lookup, FX pair registration,
  device-sync outbox, and portfolio recalculation side effects remain deferred.
- `pr5-holdings-snapshot-fx-pairs-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/holdings.test.ts apps/backend/src/runtime.test.ts`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes manual and imported snapshot saves collecting holding,
  existing asset quote-currency, cash, and account-to-base currency pairs,
  invoking the migrated `ensureFxPairs` hook before persistence, and preserving
  no-write behavior when FX registration fails while provider-backed symbol
  lookup, device-sync outbox, and portfolio recalculation side effects remain
  deferred.
- `pr5-holdings-import-check-provider-lookup-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/holdings.test.ts apps/backend/src/runtime.test.ts`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes `/api/v1/snapshots/import/check` using the migrated
  market-data search runtime after local exact-symbol lookup, exact provider
  symbol match requirements, provider currency/exchange/asset metadata mapping,
  and non-fatal provider failure fallback while device-sync outbox and portfolio
  recalculation side effects remain deferred.
- `pr5-holdings-snapshot-events-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/holdings.test.ts apps/backend/src/runtime.test.ts`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes Rust-shaped `holdings_changed` and `manual_snapshot_saved`
  event emission after successful manual/imported snapshot saves,
  `holdings_changed` emission after manual/imported snapshot deletes, no event
  emission for failed imported/calculated-delete mutations, event ordering,
  asset ID payloads from persisted positions, and standalone runtime event-bus
  wiring while device-sync outbox and actual portfolio job execution/inline
  valuation recalculation remain deferred.
- `pr5-activities-mutation-events-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/activities.test.ts apps/backend/src/runtime.test.ts`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes Rust-shaped `activities_changed` event emission after
  successful create, update, delete, transfer link/unlink, bulk, and import
  mutations; UTC `earliest_activity_at_utc` serialization; old/new update
  account/asset/currency sets; Rust-compatible bulk old account/asset and new
  currency aggregation; no emission for failed create/bulk/import or
  all-duplicate imports; standalone runtime event-bus wiring; full repository
  check with `bun run check`; and focused code review.
- `pr5-domain-event-planner-runtime`: targeted checks passed:
  `bun test apps/backend/src/domain-events/planner.test.ts` and
  `bun run --filter @wealthfolio/backend type-check -- --pretty false`. Coverage
  includes Rust-compatible portfolio job planning from activity, holdings,
  account, manual-snapshot, device-sync pull, assets-updated, and assets-created
  events; user-timezone conversion for activity timestamps;
  holdings-to-transactions recalc gating; broker-sync tracking-mode transition
  filtering; and asset-enrichment de-duplication while actual debounced worker
  execution remains deferred.
- `pr5-domain-event-processor-runtime`: targeted checks passed:
  `bun test apps/backend/src/domain-events/planner.test.ts apps/backend/src/domain-events/processor.test.ts`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes Rust queue-worker action ordering for asset enrichment,
  portfolio job enqueue, and broker sync; returning the derived processing plan
  when callbacks are absent; and propagating callback failures instead of
  reporting success while real debounced worker/runtime wiring remains deferred.
- `pr5-domain-event-worker-runtime`: targeted checks passed:
  `bun test apps/backend/src/domain-events/planner.test.ts apps/backend/src/domain-events/processor.test.ts apps/backend/src/domain-events/worker.test.ts`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes event-bus subscription, debounce batching, explicit
  flush/dispose behavior, pending-event clearing, scheduled error reporting, and
  flush-time failure propagation while real runtime service wiring remained
  deferred at that helper-slice stage.
- `pr5-ai-chat-tags-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/ai-chat.test.ts apps/backend/src/http.test.ts --grep "AI chat|routes migrated AI chat"`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`; full
  repository check passed with `bun run check`. Coverage includes SQLite-backed
  `ai_thread_tags` reads, idempotent tag inserts, idempotent removals,
  missing-thread FK behavior, list-thread tag loading, direct `getThread`
  empty-tag parity, and HTTP tag add/list/remove routing.
- `pr5-direct-asset-sync-outbox-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/assets.test.ts apps/backend/src/runtime.test.ts --grep "asset sync|TS assets domain"`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes direct asset create, profile update, quote-mode update, and
  delete sync callbacks, duplicate/missing failure suppression, standalone
  runtime `sync_outbox` rows, normalized `asset` payloads, and generated
  `instrument_key` omission. Full repository check passed with `bun run check`;
  focused code review found no significant issues.
- `pr5-alternative-asset-quote-sync-outbox-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/alternative-assets.test.ts apps/backend/src/runtime.test.ts --grep "alternative asset|alternative assets|sync_outbox"`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes alternative asset Create/Update/Delete callbacks, liability
  link/unlink/delete ordering, MANUAL+UUID quote Create/Update filtering,
  purchase/current valuation quote payloads, no quote Delete callbacks on
  alternative asset deletion, and runtime `asset`/`quote` sync_outbox rows. Full
  repository check passed with `bun run check`; focused code review found no
  required code changes after verifying payload casing is normalized by the
  shared sync outbox writer.
- `pr5-market-data-quote-sync-outbox-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/market-data.test.ts apps/backend/src/domains/alternative-assets.test.ts apps/backend/src/runtime.test.ts --grep "quote sync|market-data|alternative asset|alternative assets|sync_outbox"`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes market-data quote update/delete/import callbacks, shared
  MANUAL+UUID filtering, deterministic manual/provider no-op cases, explicit
  UUID manual quote replacement Delete callbacks, imported existing UUID manual
  quote Update callbacks, and runtime `quote` sync_outbox Delete rows.
- `pr5-ai-chat-sync-outbox-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/ai-chat.test.ts apps/backend/src/runtime.test.ts --grep "AI chat|AI chat sync|sync_outbox"`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes local AI chat thread Update/Delete callbacks, message
  tool-result Update callbacks, thread-tag Create/Delete callbacks, idempotent
  tag no-op behavior, and runtime `ai_thread`/`ai_message`/`ai_thread_tag`
  sync_outbox rows. Full repository check passed with `bun run check`; focused
  code review found no significant issues after confirming boolean-to-i32
  normalization is intentional for Rust payload parity.
- `pr5-contribution-limit-sync-outbox-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/contribution-limits.test.ts apps/backend/src/runtime.test.ts --test-name-pattern "contribution-limit sync|contribution limits domain"`.
  Coverage includes contribution-limit Create/Update/Delete callbacks,
  Rust-shaped payload fields, missing-delete sync no-op behavior, and runtime
  `contribution_limit` sync_outbox rows. Backend type-check and full repository
  check passed; focused code review found no significant issues.
- `pr5-account-sync-outbox-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/accounts.test.ts apps/backend/src/runtime.test.ts --test-name-pattern "account sync|TS accounts domain"`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes account Create/Update/Delete callbacks, Rust-shaped payload
  fields with boolean values, preserved broker-managed fields on update,
  missing-delete sync no-op behavior, and runtime `account` sync_outbox rows.
  Full repository check passed; focused code review found no significant issues
  after verifying callbacks are dispatched only after successful transactions.
- `pr5-import-template-sync-outbox-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/activities.test.ts apps/backend/src/runtime.test.ts --test-name-pattern "import template sync|import template and account-template|TS activities import domain"`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes user import-template Update/Delete callbacks,
  system-template save suppression, account-template profile Update callbacks,
  stable link entity IDs, account-local mapping updates without import-template
  events, unconditional template Delete emission, and runtime
  `import_template`/`activity_import_profile` sync_outbox rows. Full repository
  check passed; focused code review found no significant issues.
- `pr5-broker-sync-profile-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/activities.test.ts --test-name-pattern "broker sync profiles|broker sync profile rules"`,
  `bun test apps/backend/src/runtime.test.ts --test-name-pattern "disabled Connect runtime behavior|broker sync profile callbacks"`,
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes Rust-compatible account/broker/system/default profile
  precedence, account and broker-scope patch-merge saves, account profile links,
  disabled cloud Connect behavior, and runtime
  `import_template`/`activity_import_profile` sync_outbox rows for broker
  profile saves.
- `pr5-addons-local-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/addons.test.ts apps/backend/src/runtime.test.ts`
  and `bun run --cwd apps/backend type-check`. Coverage includes
  `appDataDir/addons` listing, Rust-compatible top-level `isZipAddon` detection,
  `manifest.json` exclusion from runtime files, Rust-compatible main-file
  matching, enable toggles, uninstall, enabled-on-startup broken-add-on skips,
  path-traversal guards, safe staging cleanup, standalone runtime route wiring,
  and explicit 501s for deferred archive/store operations.
- `pr5-portfolio-market-sync-deferred-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/portfolio-jobs.test.ts apps/backend/src/domains/market-data.test.ts apps/backend/src/runtime.test.ts`
  and `bun run --cwd apps/backend type-check`. Coverage includes explicit
  deferred `not_implemented` errors for portfolio job execution, market-data
  history sync, and market-data sync execution plus standalone runtime 501
  responses for `/api/v1/portfolio/{update,recalculate}` and
  `/api/v1/market-data/sync*`.
- `pr5-addons-manifest-normalization`: targeted checks passed:
  `bun test apps/backend/src/domains/addons.test.ts apps/backend/src/runtime.test.ts`
  and `bun run --cwd apps/backend type-check`. Coverage includes Rust-compatible
  required manifest fields, optional scalar/null mapping, legacy string
  permission conversion, object permission defaults, keyword string filtering,
  runtime-field dropping, and standalone runtime compatibility.
- `pr5-addons-zip-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/addons.test.ts apps/backend/src/runtime.test.ts apps/backend/src/http.test.ts`
  and `bun run --cwd apps/backend type-check`. Coverage includes local ZIP
  extraction, archive path traversal rejection, fatal UTF-8 decoding, manifest
  and main-file detection, Rust-compatible permission detection/merging, install
  runtime fields, disabled-load behavior after install, staged `{addonId}.zip`
  install cleanup, and standalone runtime extract/install route wiring. Full
  repository check passed with `bun run check`; focused code review found no
  significant issues.
- `pr5-addons-store-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/addons.test.ts apps/backend/src/runtime.test.ts apps/backend/src/http.test.ts`
  and `bun run --cwd apps/backend type-check`. Coverage includes store listing
  response parsing, rating validation/submission headers, update-check URLs,
  per-add-on update fallback errors, JSON download redirects, binary ZIP
  downloads, staged ZIP signature/parse validation, update installs preserving
  existing enabled state, and standalone runtime instance-id/app-version wiring.
  Full repository check passed with `bun run check`; focused code review found
  no significant issues.
- `pr5-addons-runtime-permission-guard`: targeted checks passed:
  `bun run --cwd apps/frontend test --run src/addons/type-bridge.test.ts src/addons/addons-runtime-context.test.ts`
  and `bun run --cwd apps/frontend type-check -- --pretty false`. Coverage
  includes SDK bridge permission allow/deny behavior, bundled manifest category
  alias compatibility, declared/detected function filtering, UI registration
  guards, scoped secret guards, and legacy/dev unrestricted fallback when
  permission metadata is absent. Full repository check passed with
  `bun run check`; focused code review found no significant issues.
- `pr5-portfolio-job-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/portfolio-jobs.test.ts apps/backend/src/runtime.test.ts`
  and `bun run type-check`. Coverage includes portfolio update/recalculate
  runtime 202 responses, Rust-canonical market/portfolio event order, bounded
  valuation writes from existing holdings snapshots, weekend/as-of quote
  valuation, active/non-archived TOTAL aggregation, explicit archived-account
  targets, non-base account FX conversion, missing-TOTAL-FX rollback, and
  deferred-service 501 fallback. Full repository check passed with
  `bun run check`; rubber-duck plan review and focused code reviews found no
  remaining significant issues.
- `pr5-market-sync-result-payloads`: targeted checks passed:
  `bun test apps/backend/src/domains/market-data.test.ts apps/backend/src/domains/portfolio-jobs.test.ts`
  and `bun run check`. Coverage includes empty-result sync modes, broad Yahoo
  sync counts, non-Yahoo skipped-reason reporting, targeted Yahoo failure
  tuples, and portfolio `market:sync-complete` payload forwarding. Focused code
  review found no significant issues.
- `pr5-market-data-portfolio-job-side-effects`: targeted checks passed:
  `bun test apps/backend/src/http.test.ts --test-name-pattern "market data mutation side effects"`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes manual quote update/delete/import routes enqueuing full
  portfolio recalculation jobs, plus `/api/v1/market-data/sync` enqueuing an
  incremental portfolio job with the requested market-sync mode when a portfolio
  job service owns execution.
- `pr5-exchange-rate-portfolio-job-side-effects`: targeted checks passed:
  `bun test apps/backend/src/http.test.ts --test-name-pattern "exchange rate CRUD"`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes exchange-rate add/update/delete routes enqueuing full
  portfolio recalculation jobs after successful FX mutations.
- `pr5-alternative-asset-portfolio-job-side-effects`: targeted checks passed:
  `bun test apps/backend/src/http.test.ts --test-name-pattern "alternative assets seam"`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes alternative-asset create, valuation update, and delete
  routes enqueuing incremental portfolio recalculation jobs after successful
  mutations, while metadata and liability link/unlink routes do not enqueue
  portfolio jobs.
- `pr5-settings-portfolio-job-side-effects`: targeted checks passed:
  `bun test apps/backend/src/http.test.ts --test-name-pattern "settings domain"`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes timezone-only settings updates enqueuing no-market-sync full
  recalculation jobs, theme-only updates staying no-op for portfolio jobs, and
  base-currency updates taking precedence with a backfill-history full
  recalculation job when timezone also changes. Milestone review follow-up also
  confirmed each successful settings update clears the health cache like Rust.
- `pr5-portfolio-job-market-sync-side-effects`: targeted checks passed:
  `bun test apps/backend/src/domains/portfolio-jobs.test.ts --test-name-pattern "bounded portfolio valuation jobs|aborts portfolio update when market sync fails|continues portfolio update when health cache clear fails"`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes successful portfolio-job market sync clearing the health
  cache before recalculation and FX service reinitialization failures warning
  without aborting the portfolio update, while market sync failures publish
  `market:sync-error` and abort before health-cache clear, FX reinitialization,
  or portfolio recalculation. Unexpected post-sync health-cache clear failures
  warn without publishing a misleading market-sync error or aborting portfolio
  recalculation, matching Rust `process_portfolio_job`.
- `pr5-health-cache-clear-best-effort`: targeted checks passed:
  `bun test apps/backend/src/http.test.ts --test-name-pattern "settings domain"`
  and
  `bun test apps/backend/src/domains/portfolio-jobs.test.ts --test-name-pattern "continues portfolio update when health cache clear fails"`,
  plus `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes health cache clearing modeled as an infallible synchronous
  service operation, settings updates preserving successful responses when an
  unexpected cache-clear callback throws, and portfolio jobs warning without
  aborting recalculation after a successful market sync.
- `pr5-health-legacy-fix-service-dispatch`: targeted checks passed:
  `bun test apps/backend/src/domains/health.test.ts apps/backend/src/http.test.ts --test-name-pattern "classification migration fixes|unsupported or malformed|routes migrated health runtime"`
  and `bun run type-check`. Coverage includes service-level
  `migrate_legacy_classifications` dispatch to full taxonomy migration without a
  targeted asset filter, alongside existing targeted `migrate_classifications`
  dispatch, plus `/health/fix` delegation through HealthService when a
  dispatcher is present so cache invalidation is preserved. Focused code review
  found and the slice fixed the HTTP special-case cache-invalidation gap.
- `pr5-domain-event-runtime-wiring`: targeted checks passed:
  `bun test apps/backend/src/runtime.test.ts apps/backend/src/domain-events/worker.test.ts --test-name-pattern "domain event"`
  and `bun run type-check`. Coverage includes standalone SQLite runtime worker
  creation against the shared event bus, settings-backed timezone, local
  portfolio job service, close-time worker flush, `holdings_changed` triggering
  market/portfolio event emission plus valuation/TOTAL recalculation, and worker
  flush-and-dispose draining before runtime close/database restore. Full
  repository check passed with `bun run check`; final focused code review found
  no remaining significant issues after the shutdown race fix.
- `pr5-domain-event-goal-summary-refresh`: targeted checks passed:
  `bun test apps/backend/src/domain-events/processor.test.ts apps/backend/src/runtime.test.ts --test-name-pattern "domain event|planned actions"`
  plus the focused best-effort refresh-failure case, `bun run type-check`, and
  full `bun run check`. Coverage includes Rust queue-worker action order with
  goal-summary refresh after portfolio job execution and before broker sync,
  standalone runtime valuation-map reuse, active funded goal summary refresh
  after a `holdings_changed` portfolio recalculation, no refresh when portfolio
  jobs are only planned, and best-effort logging for valuation-load,
  active-goal-load, and per-goal refresh failures.
- `pr5-domain-event-asset-enrichment-events`: targeted checks passed:
  `bun test apps/backend/src/domain-events/processor.test.ts apps/backend/src/domain-events/worker.test.ts`
  and `bun run --cwd apps/backend type-check -- --pretty false`. Coverage
  includes Rust-shaped `asset:enrichment-start`, `asset:enrichment-progress`,
  and `asset:enrichment-complete` publishing around asset enrichment callbacks
  plus runtime worker propagation of the shared event bus into processor
  options.
- `pr5-domain-event-asset-enrichment-continuation`: targeted checks passed:
  `bun test apps/backend/src/domain-events/processor.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  and full `bun run check`. Coverage includes Rust-compatible enrichment
  chunking in groups of five, per-chunk timeout plumbing, warning/error-hook
  reporting for failed chunks, failed-asset counting, per-chunk progress events,
  and portfolio-job plus goal-refresh continuation after enrichment chunk
  failures.
- `pr5-domain-event-portfolio-failure-continuation`: targeted checks passed:
  `bun test apps/backend/src/domain-events/processor.test.ts --test-name-pattern "Rust queue-worker order|continues goal refresh and broker sync when a portfolio job fails|logs portfolio job failures when no explicit error hook is provided|continues broker sync when goal summary refresh fails"`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes portfolio job failures being reported through the explicit
  domain-event error hook while goal-summary refresh and downstream broker-sync
  planning continue, with a default warning fallback when no hook is provided,
  and goal-summary refresh failures warning without preventing broker sync,
  matching Rust queue-worker continuation semantics without silent failures.
- `pr5-domain-event-broker-failure-continuation`: targeted checks passed:
  `bun test apps/backend/src/domain-events/processor.test.ts` and
  `bun run --cwd apps/backend type-check`. Coverage includes broker sync
  callback failures being reported through an explicit error hook or default
  warning fallback while the domain-event batch still resolves with the derived
  broker sync account plan, matching Rust's spawned broker-sync warning path.
- `pr5-asset-enrichment-runtime`: targeted checks passed:
  `bun test apps/backend/src/domains/assets.test.ts apps/backend/src/runtime.test.ts --test-name-pattern "enriches US Treasury|skips already profile|keeps enrichment batches|asset-created events"`,
  `bun test apps/backend/src/domains/assets.test.ts apps/backend/src/domain-events/processor.test.ts apps/backend/src/domain-events/worker.test.ts apps/backend/src/runtime.test.ts --test-name-pattern "assets domain|domain event|asset-created events"`,
  and `bun run --cwd apps/backend type-check`. Coverage includes SQLite-backed
  `enrichAssets` de-duplication, already-profile-enriched quote-sync skip
  behavior, UPDATE-only profile-enriched marking, bounded TreasuryDirect US912
  bond coupon/maturity metadata persistence, best-effort per-asset failure
  counting/warnings, runtime worker wiring, and lifecycle event emission without
  network for non-market assets. Generic provider profile enrichment remains
  deferred.
- `pr5-yahoo-profile-enrichment`: targeted checks passed:
  `bun test apps/backend/src/domains/assets.test.ts --test-name-pattern "enriches Yahoo|enriches US Treasury|skips already profile|keeps enrichment batches"`
  and `bun run --cwd apps/backend type-check`. Coverage includes Yahoo search
  profile enrichment through query2/query1 fallback, provider name updates,
  missing instrument-type inference from quote type,
  `metadata.profile.quoteType` persistence, profile-enriched marking,
  custom-provider profile skip behavior, and focused code review. Rich
  quoteSummary sector/metric profiles are covered by
  `pr5-yahoo-quotesummary-profile-enrichment`.
- `pr5-enrichment-auto-classification`: targeted checks passed:
  `bun test apps/backend/src/domains/assets.test.ts --test-name-pattern "enriches Yahoo|enriches US Treasury|skips already profile|keeps enrichment batches"`
  and `bun run --cwd apps/backend type-check`. Coverage includes running the
  existing automatic taxonomy assignment path after Yahoo profile enrichment
  infers a missing instrument type, while preserving best-effort warning
  behavior for assignment failures.
- `pr5-yahoo-quotesummary-profile-enrichment`: targeted checks passed:
  `bun test apps/backend/src/domains/assets.test.ts --test-name-pattern "Yahoo quoteSummary|Yahoo search profiles|US Treasury|already profile|best-effort"`
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  and `bun run check`. Coverage includes crumb-authenticated Yahoo quoteSummary
  profile enrichment before search fallback, cached crumb reuse across
  enrichment batches, provider sector/country JSON, industry, website, notes,
  quote currency, quote type, market cap, PE ratio, dividend yield, and 52-week
  metric metadata persistence, profile-enriched marking, and search fallback
  preservation when quoteSummary is unavailable.
- `pr5-provider-profile-classification`: targeted checks passed:
  `bun test apps/backend/src/domains/assets.test.ts --test-name-pattern "provider sectors|Yahoo search profiles|classification fails"`
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  and `bun run check`. Focused code review found no correctness issues. Coverage
  includes provider quoteType mapping to `instrument_type` and `asset_classes`,
  Yahoo sector-weight mapping to `industries_gics`, exchange-MIC country
  fallback to `regions`, and preservation of initial-classification warning
  behavior for non-profile enrichment paths.
- `pr5-asset-enrichment-sync-callbacks`: targeted checks passed:
  `bun test apps/backend/src/domains/assets.test.ts --test-name-pattern "Yahoo quoteSummary|provider sectors|Yahoo search profiles|US Treasury|already profile|best-effort"`
  and `bun run --cwd apps/backend type-check`. Coverage includes successful
  profile enrichment queuing an asset Update sync-event callback with
  Rust-shaped payloads that omit generated `instrumentKey`, while
  `profile_enriched_at` remains a local quote-sync state update.
- `pr5-activity-derived-snapshot-rebuild`: targeted checks passed:
  `bun test apps/backend/src/domains/portfolio-jobs.test.ts apps/backend/src/runtime.test.ts`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes transaction-mode replay from posted common activity flows
  into cumulative `CALCULATED` snapshots before valuation/TOTAL recalculation,
  DRAFT activity exclusion, HOLDINGS-mode/manual snapshot preservation,
  `sinceDate` seeding from the latest prior snapshot, and runtime
  `activities_changed` events triggering the rebuild path.
- `pr5-option-expiry-snapshot-rebuild`: targeted checks passed:
  `bun test apps/backend/src/domains/portfolio-jobs.test.ts --timeout 30000` and
  `bun run --filter @wealthfolio/backend type-check -- --pretty false`. Coverage
  includes `ADJUSTMENT`/`OPTION_EXPIRY` replay removing lots via FIFO without
  cash effects while preserving net contribution and reducing cost basis.
- `pr5-split-snapshot-rebuild`: targeted checks passed:
  `bun test apps/backend/src/domains/portfolio-jobs.test.ts --timeout 30000` and
  `bun run --filter @wealthfolio/backend type-check -- --pretty false`. Coverage
  includes split-ratio preprocessing for prior activity quantity/unit-price,
  same-day split deduplication across transaction accounts, and since-date
  replay restarting from earliest activity when a split enters the recalculation
  range.
- `pr5-health-fx-read-error-parity`: targeted checks passed:
  `bun test apps/backend/src/domains/health.test.ts`,
  `bun run --cwd apps/backend type-check`, and `bun run check`. Coverage
  includes Rust-compatible nonfatal latest FX snapshot read failures, warning
  emission, and fallback FX integrity analysis that reports affected pairs as
  missing exchange rates instead of aborting the health run.
- `pr5-health-legacy-classification-read-error-parity`: targeted checks passed:
  `bun test apps/backend/src/domains/health.test.ts`,
  `bun run --cwd apps/backend type-check`, and `bun run check`. Coverage
  includes Rust-compatible nonfatal legacy classification migration
  detail/status read failures, warning emission, and preservation of other
  health issues.
- `pr5-connect-import-run-filter-parity`: targeted checks passed:
  `bun test apps/backend/src/http.test.ts --test-name-pattern "Connect broker"`,
  `bun test apps/backend/src/runtime.test.ts --test-name-pattern "local Connect runtime behavior"`,
  `bun run --cwd apps/backend type-check`, and `bun run check`. Coverage
  includes exact `runType` query forwarding for local import-run reads,
  preserving Rust's empty-string filtering behavior.
- `pr5-exchange-rate-latest-error-observability`: targeted checks passed:
  `bun test apps/backend/src/domains/exchange-rates.test.ts` and
  `bun run --cwd apps/backend type-check`, plus full `bun run check`. Coverage
  includes Rust-compatible warning emission before missing latest exchange-rate
  errors are rethrown.
- `pr5-activity-daily-snapshot-replay`: targeted checks passed:
  `bun test apps/backend/src/domains/portfolio-jobs.test.ts --timeout 30000`,
  `bun run --cwd apps/backend type-check`, and `bun run check`. Coverage
  includes Rust-compatible carry-forward calculated snapshots and valuations for
  non-activity days through the portfolio calculation day.
- `pr5-activity-zero-position-snapshot-parity`: targeted checks passed:
  `bun test apps/backend/src/domains/portfolio-jobs.test.ts --timeout 30000` and
  `bun run --cwd apps/backend type-check`, plus full `bun run check`. Coverage
  includes Rust-compatible preservation of zero-quantity positions when reading
  seed snapshots and writing calculated activity-derived snapshots, without
  treating zero-quantity seed positions as quote-gap valuation blockers.
- `pr5-runtime-account-fx-registration`: targeted checks passed:
  `bun test apps/backend/src/runtime.test.ts --test-name-pattern "non-base account"`
  and `bun run --cwd apps/backend type-check`, plus full `bun run check`.
  Coverage includes Rust-compatible FX asset registration when the standalone TS
  runtime creates an account whose currency differs from the configured base
  currency.
- `pr5-settings-base-currency-fx-registration`: targeted checks passed:
  `bun test apps/backend/src/domains/settings.test.ts`,
  `bun test apps/backend/src/runtime.test.ts --test-name-pattern "non-base account|low-risk services"`,
  and `bun run --cwd apps/backend type-check`, plus full `bun run check`.
  Coverage includes Rust-compatible registration of existing account and
  FX-asset currencies when the standalone TS runtime changes base currency,
  including warn-and-continue behavior for per-pair registration failures.

## Result

- Outcome: PR 1 contract foundation, PR 2 guarded TS backend runtime skeleton,
  PR 3 TS SQLite foundation, and PR 4 compatibility preflights implemented; PR 5
  settings, accounts, contribution limits, taxonomy read, and taxonomy/category
  mutation, assignment, import/export, custom provider CRUD, and scoped goals
  CRUD/funding plus local exchange-rate CRUD and local health dismissal/config
  plus market-data provider settings, portfolio job trigger, event stream,
  secrets route seam, AI provider route seam, alternative assets route seam,
  assets route seam, app utility route seam, portfolio metrics route seam,
  holdings route seam, add-ons route seam, market-data route seam,
  activities/import route seam, AI chat route seam, sync crypto route seam, and
  health/classification route seam, Connect broker/session route seam, Connect
  device-sync enrollment/engine route seam, device-sync device-management route
  seam, device-sync team-key/reset route seam, device-sync pairing route seam,
  standalone TS runtime composition for already-ported SQLite-backed domains,
  safe app utility runtime, file-backed secrets runtime, AI provider
  settings/catalog runtime, sync crypto runtime, legacy classification migration
  runtime, custom provider test-source runtime, FX converter/register runtime,
  app utility database restore runtime, contribution-limit deposit calculation
  runtime, alternative-assets runtime, contained asset read/quote-mode/delete
  runtime, asset create/profile mutation runtime, market-data quote CRUD
  runtime, market-data latest snapshot runtime, market-data quote CSV
  check/import runtime, market-data Yahoo dividends runtime, market-data symbol
  search and resolve-currency runtime, activities import
  mapping/template/duplicate lookup runtime, read-only activity search runtime,
  transfer link/unlink runtime, single activity delete runtime, bounded
  existing-asset/cash activity create/update/bulk runtime, and existing-asset
  symbol resolution, CSV parse, read-only import asset preview, and read-only
  import validation plus bounded import apply and import transfer-pair auto-link
  plus import FX pair ensure, save-up and retirement goal-plan persistence,
  save-up preview calculation runtime, save-up goal overview service logic, AI
  chat thread/message/tag persistence, non-retirement/no-plan retirement summary
  refresh service logic, deterministic retirement calculation primitives,
  projection engine, overview assembly, guarded retirement overview HTTP
  routing, plan-backed retirement summary refresh, retirement projection
  routing, Monte Carlo routing, scenario-analysis routing, sequence-of-returns
  routing, stress-tests routing, decision-sensitivity routing, bounded health
  status/check slices, bounded health classification-fix runtime, bounded
  legacy-classification health issue runtime, current/history net-worth runtime,
  income summary runtime, simple account performance runtime, account
  performance history/summary runtime, local quote-backed symbol performance
  runtime, holdings valuation read runtime, holdings snapshot metadata/runtime
  conversion/import-check reads, live holdings fan-out runtime, holding
  detail/by-asset fan-out runtime, allocation read runtime, snapshot deletion
  runtime, bounded manual snapshot save runtime, and bounded snapshot
  import-write runtime plus snapshot FX pair registration, provider-backed
  import-check lookup, holdings snapshot event production, and activity mutation
  event production plus activity/import-run/activity-created asset sync-event
  callback queuing, sync_outbox persistence for migrated goal/activity callbacks
  plus FX asset, custom provider, custom taxonomy, asset taxonomy assignment,
  direct asset, alternative asset/UUID quote, market-data quote, local AI chat,
  contribution-limit, account, import-template/account-template, and broker sync
  profile callbacks, domain-event planning/batch-processing/worker helper, local
  add-on filesystem runtime with Rust-compatible manifest normalization, local
  ZIP archive extraction/install/staging install, add-on
  store/update/download-staging runtime behavior, frontend add-on
  manifest-permission enforcement, AI chat native/fallback text/reasoning
  streaming plus generated thread titles,
  OpenAI-compatible/Ollama/Anthropic/Gemini injected tool-call execution,
  built-in `get_accounts`/`get_holdings`/
  `get_cash_balances`/`get_goals`/`search_activities`/`get_performance`/
  `get_income`/`get_valuation_history`/`get_asset_allocation`/
  `get_health_status`/`record_activity`/`record_activities`/`import_csv`,
  text/CSV attachment prompt injection, Anthropic/Gemini image/PDF native media
  payloads, OpenAI-compatible image/PDF and Ollama image media payloads, bounded
  portfolio job valuation/TOTAL recalculation runtime, bounded
  transaction-account activity snapshot rebuilding, BUY/SELL broker FX handling,
  option contract multipliers, option-expiry adjustment replay, split
  preprocessing, lot-level asset-transfer replay, other adjustment no-op
  behavior, market-sync result/payload parity, market-data quote/sync portfolio
  job side effects, exchange-rate mutation portfolio job side effects,
  alternative-asset mutation portfolio job side effects, and settings
  base-currency/timezone portfolio job plus health-cache-clear side effects, and
  portfolio-job market-sync health-cache/FX-reinitialize side effects,
  best-effort health-cache clear failure handling, quote-sync position lifecycle
  reconciliation around portfolio jobs, and domain-event portfolio-failure
  continuation semantics, activity snapshot cash
  contribution/cash-total/cost-basis FX parity, and SQLite-backed local Connect
  synced-account/platform/sync-state/import-run reads implemented; broader
  migration remains active.
- `pr5-connect-local-read-runtime`: targeted checks passed:
  `bun test apps/backend/src/runtime.test.ts --test-name-pattern "local Connect"`,
  `bun test apps/backend/src/http.test.ts --test-name-pattern "Connect"`, and
  `bun run --filter @wealthfolio/backend type-check -- --pretty false`. Coverage
  includes standalone runtime SQLite-backed Connect synced-account, platform,
  broker sync-state, and import-run local reads; AccountService-backed
  synced-account filtering, Rust-compatible local route ordering, `SYNCING` and
  `NEEDS_REVIEW` status mapping, import-run enum fallback, malformed JSON
  fallback, optional invalid timestamp `null` fallback, `runType` filtering, and
  empty `runType` defaulting while cloud session/list/sync operations remain
  explicitly disabled.
- `pr5-activity-snapshot-contribution-fx`: targeted checks passed:
  `bun test apps/backend/src/domains/portfolio-jobs.test.ts --test-name-pattern "cash contribution|transfer activity fx rate|portfolio valuation jobs|rolls back TOTAL"`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes Rust-compatible activity snapshot cash contribution FX
  rules: account net contribution uses activity `fx_rate` when present, falls
  back to FxService when absent, and base net contribution uses FxService rather
  than the activity account-currency `fx_rate`, including position-currency
  transfer contribution edges where base currency equals account currency.
- `pr5-activity-snapshot-cash-total-fx`: targeted checks passed:
  `bun test apps/backend/src/domains/portfolio-jobs.test.ts --test-name-pattern "cash contribution|unconverted cash totals|rolls back TOTAL"`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`.
  Coverage includes Rust-compatible generated snapshot cash-total fallback when
  FxService is unavailable while preserving strict TOTAL recalculation rollback
  on required FX gaps.
- `pr5-activity-snapshot-cost-basis-fx`: targeted checks passed:
  `bun test apps/backend/src/domains/portfolio-jobs.test.ts` and
  `bun run --filter @wealthfolio/backend type-check -- --pretty false`. Coverage
  includes Rust-compatible generated snapshot `cost_basis` conversion from
  position currency to account currency at the snapshot date, including BUY/SELL
  and transfer replay paths plus missing-FX fallback to the unconverted cost
  basis.
- `pr5-market-data-custom-provider-resolve`: targeted checks passed:
  `bun test apps/backend/src/domains/market-data.test.ts` and
  `bun run --filter @wealthfolio/backend type-check -- --pretty false`. Coverage
  includes `resolveSymbolQuote` honoring `CUSTOM:<code>` provider preferences
  through the runtime custom-provider source/test-source service, trying latest
  sources before historical fallback windows, returning `CUSTOM_SCRAPER:<code>`
  provider IDs, and avoiding Yahoo fallback when the requested custom provider
  resolves a price. Full repository check passed with `bun run check`; focused
  code review identified a historical fallback test gap, the implementation
  covered it, and re-review found no remaining actionable issues.
- `pr5-market-data-custom-provider-latest-sync`: verification passed:
  `bun test apps/backend/src/domains/market-data.test.ts` and
  `bun run --filter @wealthfolio/backend type-check -- --pretty false`, full
  `bun run check`, and focused code review. Coverage includes
  targeted/incremental market sync for assets with
  `preferred_provider: CUSTOM_SCRAPER` and `custom_provider_code`,
  `CUSTOM:<code>` symbol overrides, no Yahoo fallback, persisted
  `CUSTOM_SCRAPER:<code>` quote rows, zero-price quote persistence,
  date-timezone normalization, quote sync state source updates, and explicit
  skips for historical custom backfill.
- `pr5-market-data-general-custom-provider-latest-sync`: verification passed:
  `bun test apps/backend/src/domains/market-data.test.ts` and
  `bun run --filter @wealthfolio/backend type-check -- --pretty false`, full
  `bun run check`, and focused code review. Coverage includes `CUSTOM_SCRAPER`
  assets without `custom_provider_code` using enabled custom providers in
  priority order, skipping disabled and non-`{SYMBOL}` sources, trying latest
  before historical fallback sources, honoring per-source `CUSTOM:<code>` symbol
  overrides, persisting `CUSTOM_SCRAPER:<code>` quote rows, and updating quote
  sync state to the actual successful source.
- `pr5-market-data-explicit-custom-provider-history-sync`: verification passed:
  `bun test apps/backend/src/domains/custom-providers.test.ts apps/backend/src/domains/market-data.test.ts`
  and `bun run --filter @wealthfolio/backend type-check -- --pretty false`, full
  `bun run check`, and focused code review. Coverage includes multi-row JSON
  custom-provider row extraction with `{FROM}`/`{TO}` expansion, explicit
  `custom_provider_code` historical backfill, per-provider `CUSTOM:<code>`
  symbol overrides, provider-only quote purging on historical success, persisted
  `CUSTOM_SCRAPER:<code>` quote rows with OHLCV fields, and quote sync state
  updates. Latest fallback and general-purpose historical discovery remain
  explicitly deferred.
- `pr5-market-data-general-custom-provider-history-sync`: verification passed:
  `bun test apps/backend/src/domains/market-data.test.ts`,
  `bun run --filter @wealthfolio/backend type-check -- --pretty false`, full
  `bun run check`, focused code review, and targeted re-review. Coverage
  includes general-purpose `CUSTOM_SCRAPER` historical discovery across enabled
  providers in priority order, skipping disabled/non-`{SYMBOL}` sources,
  per-source `CUSTOM:<code>` symbol overrides, empty-source fallback, persisted
  `CUSTOM_SCRAPER:<code>` historical quote rows, provider-only quote purging on
  success, sync state updates to the actual source, and a second sync proving
  state-derived source IDs do not get misread as asset `custom_provider_code`.
- `pr5-market-data-custom-provider-history-latest-fallback`: verification
  passed: `bun test apps/backend/src/domains/market-data.test.ts`,
  `bun run --filter @wealthfolio/backend type-check -- --pretty false`, full
  `bun run check`, focused code review, and purge-safety re-review. Coverage
  includes explicit and general-purpose custom-provider backfill falling back to
  latest sources only when no historical source candidates exist, latest
  fallback requests without `{FROM}`/`{TO}` ranges, preserved existing
  historical provider quotes during fallback, persisted single latest
  `CUSTOM_SCRAPER:<code>` quote rows, and quote sync state updates.
- `pr5-market-data-boerse-frankfurt-sync`: verification passed:
  `bun test apps/backend/src/domains/market-data.test.ts`,
  `bun run --filter @wealthfolio/backend type-check -- --pretty false`, full
  `bun run check`, and focused code review. Coverage includes targeted,
  incremental, broad, and history sync for `BOERSE_FRANKFURT` assets, exact-MIC
  ISIN search resolution, `MIC:ISIN` history requests with browser headers and
  epoch-second windows, clean `no_data` zero-quote syncs, deterministic bond
  percentage scaling, quote sync state source updates, and latest
  price-information quote resolution for equities and bonds.
- `pr5-market-data-marketdata-app-sync`: verification passed:
  `bun test apps/backend/src/domains/market-data.test.ts`,
  `bun run --filter @wealthfolio/backend type-check -- --pretty false`, full
  `bun run check`, and focused code review. Coverage includes targeted,
  incremental, broad, and history sync for `MARKETDATA_APP` assets using the
  runtime secret service, bearer-authenticated candle and latest endpoints with
  trailing slash parity, current-day latest supplementation that preserves
  successful history when realtime fetch fails, missing-key sync failures,
  provider override symbols, exchange-MIC currency precedence, quote sync state
  source updates, and latest price quote resolution.
- `pr5-market-data-finnhub-sync`: verification passed:
  `bun test apps/backend/src/domains/market-data.test.ts`,
  `bun run --filter @wealthfolio/backend type-check -- --pretty false`, full
  `bun run check`, and focused code review. Coverage includes targeted,
  incremental, broad, and history sync for `FINNHUB` equity assets using the
  runtime secret service, `X-Finnhub-Token` daily candle and quote endpoint
  requests, provider override symbols, exchange-MIC currency precedence, invalid
  historical timestamp skipping, quote sync state source updates, missing-key
  sync failures, and latest price quote resolution.
- `pr5-market-data-alpha-vantage-sync`: verification passed:
  `bun test apps/backend/src/domains/market-data.test.ts`,
  `bun run --filter @wealthfolio/backend type-check -- --pretty false`, full
  `bun run check`, rubber-duck plan review, and focused code review. Coverage
  includes targeted, incremental, broad, and history sync for `ALPHA_VANTAGE`
  equity, FX, and crypto assets using the runtime secret service,
  provider-specific MIC suffix/currency metadata, endpoint-specific outputsize
  parameters, API-level error/rate-limit handling, non-rate informational
  message tolerance, inclusive date filtering, market-currency crypto fields,
  unsupported option sync failures without provider calls, quote sync state
  source updates, and latest price quote resolution through daily time-series
  endpoints.
- `pr5-market-data-metal-price-api-sync`: verification passed:
  `bun test apps/backend/src/domains/market-data.test.ts`,
  `bun run --filter @wealthfolio/backend type-check -- --pretty false`, full
  `bun run check`, and focused code review. Coverage includes targeted,
  incremental, broad, and history sync for `METAL_PRICE_API` metal assets using
  the runtime secret service, `X-API-KEY` timeframe/latest endpoint requests,
  supported metal symbols, weight suffix multipliers, Decimal-backed rate
  inversion from base-currency rates to metal prices, noon-UTC historical
  timestamps, empty timeframe response failures, quote sync state source
  updates, and latest price quote resolution.
- `pr5-market-data-us-treasury-calc-sync`: verification passed:
  `bun test apps/backend/src/domains/market-data.test.ts`,
  `bun run --cwd apps/backend type-check`, full `bun run check`, rubber-duck
  plan review, and focused code review. Coverage includes targeted, incremental,
  broad, and history sync for `US_TREASURY_CALC` US912 bond assets, Treasury.gov
  yearly XML yield-curve fetching with service-scoped caching, invalid entry and
  self-closing tenor tolerance, bond metadata validation, coupon and zero-coupon
  pricing formulas, single-year latest curve fallback, quote sync state
  source/error updates, and latest quote resolution for existing bond assets
  with metadata.
- `pr5-market-data-openfigi-search`: verification passed:
  `bun test apps/backend/src/domains/market-data.test.ts`,
  `bun run --cwd apps/backend type-check`, full `bun run check`, and focused
  code review. Coverage includes OpenFIGI fallback after empty or non-MIC Yahoo
  search results, exact identifier mapping for ISIN/FIGI/CUSIP with Rust-ordered
  id types, free-text `/v3/search` requests, bond-sector filtering,
  display-name/exchange de-duplication, Rust-compatible uppercased-query result
  symbols, `OPENFIGI` data-source tagging, and existing-asset de-duplication
  through the normal market-data search merge path.
- `pr5-market-data-provider-search-fallbacks`: verification passed:
  `bun test apps/backend/src/domains/market-data.test.ts`,
  `bun run --cwd apps/backend type-check`, full `bun run check`, and focused
  code review. Coverage includes search fallback from empty/non-MIC Yahoo
  results to Finnhub and Alpha Vantage through runtime provider secrets, Rust
  registry first-non-empty fallback semantics, Finnhub `/search` token header,
  security type mapping and Yahoo-suffix MIC inference, Alpha Vantage
  `SYMBOL_SEARCH` request/API error handling, type/currency/score/region
  mapping, and continued OpenFIGI fallback after provider API fallbacks are
  empty.
- `pr5-market-data-boerse-search-fallback`: verification passed:
  `bun test apps/backend/src/domains/market-data.test.ts --test-name-pattern "Boerse Frankfurt after OpenFIGI|search falls back|searches OpenFIGI"`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  and full `bun run check`. Coverage includes Rust-ordered Börse Frankfurt
  fallback after empty Yahoo/OpenFIGI results, TradingView search request
  headers/limit, supported German type mapping, unsupported type filtering,
  provider MIC/ISIN preservation, exchange-catalog currency inference, and
  `BOERSE_FRANKFURT` data-source tagging.
- `pr5-activities-import-preview-provider-resolution`: verification passed:
  `bun test apps/backend/src/domains/activities.test.ts`,
  `bun run --cwd apps/backend type-check`, full `bun run check`, rubber-duck
  plan review, and focused code review. Coverage includes runtime wiring from
  activity previews to market-data symbol search, exchange metadata reuse,
  Rust-compatible bare-symbol-first then currency-suffix search candidates,
  preferred-currency MIC selection, provider-name propagation into new-asset
  drafts, per-preview search caching, and unresolved/missing-exchange fallback
  when provider search returns no MIC or fails.
- `pr5-activities-import-check-provider-resolution`: verification passed:
  `bun test apps/backend/src/domains/activities.test.ts`,
  `bun run --cwd apps/backend type-check`, full `bun run check`, rubber-duck
  plan review, and focused code review. Coverage includes provider-backed import
  check enrichment for symbol-only market rows, activity/account currency-aware
  MIC selection, provider-name propagation, inferred equity type and quote
  currency for import round-trips, unresolved provider misses remaining
  validation errors, and manual quoted assets staying local without provider
  calls.
- `pr5-activities-import-check-missing-mic-error`: verification passed: focused
  missing-MIC import check test,
  `bun test apps/backend/src/domains/activities.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  full `bun run check`, and `git diff --check`. Coverage includes unresolved
  market asset import checks returning Rust's
  `Could not find '<symbol>' in market data. Please search for the correct ticker symbol.`
  validation message instead of leaking the lower-level asset creation MIC
  error.
- `pr5-activities-import-check-isin-resolution`: verification passed:
  `bun test apps/backend/src/domains/activities.test.ts`,
  `bun run --cwd apps/backend type-check`, full `bun run check`, and focused
  code review. Coverage includes normalized CSV ISIN keys, local
  `metadata.identifiers.isin` lookup before provider calls, provider ISIN search
  before ticker fallback, preserved original import symbols, and MIC/name/type/
  quote-currency enrichment for checked rows.
- `pr5-activities-import-preview-isin-resolution`: verification passed:
  `bun test apps/backend/src/domains/activities.test.ts`,
  `bun run --cwd apps/backend type-check`, full `bun run check`, and focused
  code review. Coverage includes candidate ISIN local existing-asset previews,
  provider ISIN search before ticker fallback, preserved candidate symbols, and
  provider MIC/name enrichment in new-asset preview drafts.
- `pr5-activities-import-preview-provider-inference`: verification passed:
  `bun test apps/backend/src/domains/activities.test.ts`,
  `bun run --cwd apps/backend type-check`, full `bun run check`, and focused
  code review. Coverage includes provider-backed preview inference for missing
  instrument type and quote currency, provider quote-type mapping for non-equity
  assets, no provider calls for manual or complete non-equity previews, and
  existing missing-exchange behavior for unresolved market equities.
- `pr5-activities-quote-mode-asset-sync`: focused verification passed:
  `bun test apps/backend/src/domains/activities.test.ts` and
  `bun run --cwd apps/backend type-check`, plus full `bun run check`. Coverage
  includes activity create/update/import paths queuing asset Update sync events
  when an existing asset quote mode changes, preserving activity-created assets
  as Create events, and clearing stale quote sync state when switching an asset
  to MANUAL through activity side effects.
- `pr5-activities-import-apply-provider-resolution`: focused verification
  passed: `bun test apps/backend/src/domains/activities.test.ts` and
  `bun run --cwd apps/backend type-check`, plus full `bun run check`. Coverage
  includes direct import apply using provider search and currency-aware Yahoo
  suffix fallback to enrich symbol-only market rows with MIC, name, instrument
  type, and quote currency before creating assets.
- `pr5-activities-direct-asset-inference`: focused verification passed:
  `bun test apps/backend/src/domains/activities.test.ts` and
  `bun run --cwd apps/backend type-check`, plus
  `bun run --cwd apps/backend test` and full `bun run check`. Coverage includes
  direct activity writes inferring crypto pair assets from Rust-compatible
  symbol/kind heuristics, preserving activity-created asset sync payload shape,
  and rejecting incomplete market security symbols with Rust's quote-currency
  re-selection error.
- `pr5-activities-direct-crypto-inference-quotes`: verification passed: focused
  crypto inference test, `bun test apps/backend/src/domains/activities.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  full `bun run check`, and `git diff --check`. Coverage includes implicit
  crypto-pair inference only for Rust's supported quote-code set while
  preserving explicit `kind: CRYPTO` pair parsing for wider broker symbols.
- `pr5-activities-direct-asset-kind-derivation`: verification passed: focused
  asset kind derivation test,
  `bun test apps/backend/src/domains/activities.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  full `bun run check`, and `git diff --check`. Coverage includes explicit
  instrument type taking precedence over conflicting alternative-kind hints for
  activity-created assets, matching Rust's `kind_from_instrument_type` behavior.
- `pr5-activities-direct-instrument-type-trim`: verification passed: focused
  trimmed instrument-type test,
  `bun test apps/backend/src/domains/activities.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  full `bun run check`, and `git diff --check`. Coverage includes direct
  activity-created asset `instrumentType` hints being trimmed before alias
  normalization so space-padded `FX` inputs follow Rust's explicit instrument
  type path instead of falling through to default security inference.
- `pr5-activities-direct-quote-mode-trim`: verification passed: focused
  quote-mode hint test, `bun test apps/backend/src/domains/activities.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  full `bun run check`, and `git diff --check`. Coverage includes direct
  activity-created asset `quoteMode` hints preserving raw whitespace before
  direct quote-mode normalization so space-padded `manual` falls through like
  Rust instead of creating MANUAL assets and fallback quotes.
- `pr5-activities-import-quote-mode-trim`: verification passed: focused import
  quote-mode tests, `bun test apps/backend/src/domains/activities.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  full `bun run check`, and `git diff --check`. Coverage includes import
  preview/check/apply paths preserving raw `quoteMode` whitespace before
  quote-mode normalization so space-padded `MANUAL` values do not skip provider
  resolution or create manual assets/quotes unlike Rust.
- `pr5-activities-import-preview-quote-mode-trim-coverage`: verification passed:
  focused import preview test,
  `bun test apps/backend/src/domains/activities.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  full `bun run check`, and `git diff --check`. Coverage explicitly proves
  space-padded `MANUAL` import-preview candidates produce Rust-compatible
  missing-exchange feedback instead of auto-resolving as manual assets.
- `pr5-activities-import-preview-lowercase-quote-mode`: verification passed:
  focused import preview test,
  `bun test apps/backend/src/domains/activities.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`
  rerun after the known sync-outbox flake, full `bun run check`, and
  `git diff --check`. Coverage proves lowercase `manual` preview hints skip the
  missing-exchange error like Rust while still producing a MARKET draft unless
  the raw value is exactly `MANUAL`.
- `pr5-activities-import-preview-gbp-quote-currency`: verification passed:
  focused import preview test,
  `bun test apps/backend/src/domains/activities.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`
  rerun after the known sync-outbox flake, full `bun run check`, and
  `git diff --check`. Coverage proves explicit `GBp` quote-currency hints in
  activity import previews normalize to `GBP` like Rust's activity import
  `normalize_quote_ccy` path.
- `pr5-health-stale-dismissal-warning`: verification passed: focused
  stale-dismissal tests, `bun test apps/backend/src/domains/health.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  full `bun run check`, and `git diff --check`. Coverage proves stale dismissal
  removal failures warn and still restore the issue like Rust's best-effort
  cleanup path.
- `pr5-portfolio-missing-option-sell-cash`: verification passed: focused
  portfolio job test,
  `bun test apps/backend/src/domains/portfolio-jobs.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  full `bun run check`, and `git diff --check`. Coverage proves option sell
  activities for missing positions still apply cash proceeds with the asset
  contract multiplier, warn, and leave positions absent like Rust.
- `pr5-fx-zero-inverse-rate`: verification passed: focused TS/Rust FX tests,
  `bun test apps/backend/src/domains/exchange-rates.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  `cargo test -p wealthfolio-core fx::fx_service`,
  `cargo check -p wealthfolio-core`, full `bun run check`, and
  `git diff --check`. Coverage proves zero-valued inverse latest exchange rates
  are treated as unavailable instead of being inverted.
- `pr5-activities-bare-crypto-existing-lookup`: verification passed: focused
  activity tests, `bun test apps/backend/src/domains/activities.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`
  rerun after the known sync-outbox flake, full `bun run check`, and
  `git diff --check`. Coverage proves symbol-only direct activities for common
  crypto tickers resolve to existing CRYPTO assets even when an equity shares
  the same display code.
- `pr5-activities-direct-asset-metadata`: focused verification passed:
  `bun test apps/backend/src/domains/activities.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  and full `bun run check`. Coverage includes direct activity-created OPTION
  assets normalizing OCC symbols and persisting Rust-shaped option specs with
  `contract_multiplier` overrides, plus BOND CUSIP-to-ISIN canonicalization,
  Rust-shaped bond specs, and no Yahoo provider default for bond assets.
- `pr5-activities-direct-option-normalization`: verification passed: focused
  option normalization test,
  `bun test apps/backend/src/domains/activities.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  full `bun run check`, and `git diff --check`. Coverage includes direct
  activity-created OPTION assets normalizing Fidelity compact broker symbols
  such as `-MU270115C600` and space-padded OCC symbols to compact OCC
  identifiers while persisting Rust-shaped option metadata.
- `pr5-holdings-import-write-provider-resolution`: focused verification passed:
  `bun test apps/backend/src/domains/holdings.test.ts` and
  `bun run --cwd apps/backend type-check`, plus full `bun run check`. Coverage
  includes direct imported snapshot writes reusing exact provider symbol matches
  to set name, exchange MIC, and missing quote currency before creating local
  market assets, while preserving local exact-symbol precedence and ignoring
  non-exact provider matches.
- `pr5-holdings-snapshot-asset-sync`: focused verification passed:
  `bun test apps/backend/src/domains/holdings.test.ts`,
  `bun test apps/backend/src/runtime.test.ts`,
  `bun run --cwd apps/backend type-check`, and full `bun run check`. Coverage
  includes manual/imported holdings snapshot writes queuing Rust-shaped asset
  Create/Update callbacks for newly created, reactivated, and MANUAL
  quote-mode-updated assets before snapshot callbacks, clearing stale quote sync
  state when switching to MANUAL, persisting runtime `asset` sync_outbox rows,
  and omitting generated `instrument_key` from asset payloads.
- `pr5-holdings-manual-save-provider-resolution`: focused verification passed:
  `bun test apps/backend/src/domains/holdings.test.ts` and
  `bun run --cwd apps/backend type-check`. Coverage includes manual holdings
  saves reusing exact provider symbol matches to fill exchange MIC, name, and
  missing quote currency before creating market assets, while ignoring non-exact
  provider matches and skipping provider calls for MANUAL data-source assets.
- `pr5-holdings-manual-quote-row-parity`: focused verification passed:
  `bun test apps/backend/src/domains/holdings.test.ts` and
  `bun run --cwd apps/backend type-check`. Coverage includes manual snapshot
  fallback quotes persisting deterministic non-UUID manual quote IDs, full
  OHLC/adjclose values, null volume, currency, and noon UTC timestamps matching
  the Rust quote-service path.
- `pr5-holdings-provider-name-fallback`: focused verification passed:
  `bun test apps/backend/src/domains/holdings.test.ts` and
  `bun run --cwd apps/backend type-check`. Coverage includes provider
  exact-match enrichment falling back from blank long names to short names for
  import checks and snapshot asset creation.
- `pr5-ai-chat-record-activity-name-fallback`: focused verification passed:
  `bun test apps/backend/src/domains/ai-chat-tools.test.ts` and
  `bun run --cwd apps/backend type-check`. Coverage includes provider-backed
  `record_activity` asset drafts falling back from blank long names to short
  names before using symbols.
- `pr5-activities-direct-fx-pairs`: verification passed:
  `bun test apps/backend/src/domains/activities.test.ts`,
  `bun run --cwd apps/backend type-check`, and full `bun run check`. Coverage
  includes direct activity create/update paths ensuring activity-currency and
  asset-currency FX pairs before writes and preserving no-write behavior when FX
  registration fails.
- `pr5-activities-bulk-fx-pairs`: verification passed:
  `bun test apps/backend/src/domains/activities.test.ts`,
  `bun run --cwd apps/backend type-check`, and full `bun run check`. Coverage
  includes bulk activity create/update paths deduplicating and ensuring
  activity-currency and asset-currency FX pairs before writes while preserving
  batch atomicity on FX registration failure.
- `pr5-activities-manual-quote-timestamp`: verification passed:
  `bun test apps/backend/src/domains/activities.test.ts`,
  `bun run --cwd apps/backend type-check`, and full `bun run check`. Coverage
  includes direct activity manual fallback quotes using raw date-only inputs for
  noon UTC quote timestamps while stored activity dates remain normalized.
- `pr5-activities-import-manual-quote-timestamp`: verification passed:
  `bun test apps/backend/src/domains/activities.test.ts`,
  `bun run --cwd apps/backend type-check`, and full `bun run check`. Coverage
  includes import validation/apply preserving raw date-only quote inputs for
  manual fallback quotes so imported quotes use Rust-compatible noon UTC
  timestamps while imported activity dates remain normalized.
- `pr5-activities-garbage-symbol-validation`: verification passed:
  `bun test apps/backend/src/domains/activities.test.ts`,
  `bun run --cwd apps/backend type-check`, and full `bun run check`. Coverage
  includes import asset previews, import check/apply preflight, and direct
  symbol-based activity asset creation rejecting all-dash and non-cash `$...`
  symbols before provider resolution or persistence.
- `pr5-activities-import-symbol-disposition`: verification passed:
  `bun test apps/backend/src/domains/activities.test.ts`,
  `bun run --cwd apps/backend type-check`, and full `bun run check`. Coverage
  includes Rust-compatible import symbol classification for dividend/adjustment
  cash placeholders, never-asset cash movements, asset transfers with quantity
  or price, and ambiguous transfer symbols that must be reviewed instead of
  being silently imported as cash.
- `pr5-holdings-occ-expiration-parity`: verification passed:
  `bun test apps/backend/src/domains/holdings.test.ts` and
  `bun run --cwd apps/backend type-check`. Coverage includes live-holdings
  expired-option filtering accepting lowercase OCC option type markers while
  preserving Rust's rejection of malformed OCC symbols with no underlying before
  the date/type/strike suffix.
- `pr5-health-negative-balance-error-parity`: verification passed:
  `bun test apps/backend/src/domains/health.test.ts` and
  `bun run --cwd apps/backend type-check`. Coverage includes Rust-compatible
  nonfatal handling for failed negative account-balance lookups: the failed
  investment/cash group warns and contributes no issue while other data
  consistency checks continue.
- `pr5-health-quote-read-error-parity`: verification passed:
  `bun test apps/backend/src/domains/health.test.ts` and
  `bun run --cwd apps/backend type-check`. Coverage includes Rust-compatible
  nonfatal latest-quote failures for price staleness (treated as missing quote
  data) and quote-sync error snapshot failures (skipping only quote-sync
  issues).
- `pr5-asset-auto-classification-parity`: verification passed:
  `bun test apps/backend/src/domains/assets.test.ts apps/backend/src/runtime.test.ts --test-name-pattern "auto-classifies|auto-classification|direct asset sync"`,
  `bun run --cwd apps/backend type-check`, and `bun run check`. Coverage
  includes Rust-compatible initial `instrument_type` and `asset_classes`
  taxonomy assignment for newly created direct assets, duplicate-existing asset
  returns without reclassification, nonfatal classification assignment failures,
  and runtime sync_outbox persistence for auto-created taxonomy assignments.
- `pr5-quote-sync-position-lifecycle`: verification passed:
  `bun test apps/backend/src/domains/market-data.test.ts apps/backend/src/domains/portfolio-jobs.test.ts --test-name-pattern "position status|quote sync position"`,
  `bun run --cwd apps/backend type-check -- --pretty false`,
  `bun run --cwd apps/backend test`, and `bun run check`. Coverage includes
  Rust-compatible quote-sync position status reconciliation from latest TOTAL
  snapshots before market sync and after recalculation, nonzero significant
  long/short quantity handling with dust-threshold filtering, FX-asset skipping,
  inactive asset reactivation, MARKET sync state creation/reopen/close priority
  updates, and best-effort warning behavior when reconciliation fails.
- `pr5-activities-import-preview-suffix-existing-match`: verification passed:
  `bun test apps/backend/src/domains/activities.test.ts --test-name-pattern "previews import assets by matching yahoo-suffixed symbols to existing assets"`,
  `bun test apps/backend/src/domains/activities.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  and full `bun run check`. Coverage includes import asset previews normalizing
  configured Yahoo suffixes such as `.DE` before existing SQLite asset lookup
  and provider fallback, avoiding duplicate new-asset previews for known
  MIC-backed XETR/XFRA-style assets.
- `pr5-activities-import-check-suffix-existing-match`: verification passed:
  `bun test apps/backend/src/domains/activities.test.ts --test-name-pattern "checks and imports yahoo-suffixed symbols by matching existing assets before providers"`,
  `bun test apps/backend/src/domains/activities.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  and full `bun run check`. Coverage includes import check/apply normalizing
  configured Yahoo suffixes before provider search, enriching checked rows from
  the local existing asset, importing against that existing asset, and avoiding
  duplicate asset creation for known MIC-backed XETR/XFRA-style symbols.
- `pr5-activities-import-asset-id-hydration`: verification passed:
  `bun test apps/backend/src/domains/activities.test.ts --test-name-pattern "hydrates import activities from existing asset ids like Rust"`,
  `bun test apps/backend/src/domains/activities.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  and full `bun run check`. Coverage includes import validation hydrating
  missing symbol, symbol name, exchange MIC, instrument type, quote mode, quote
  currency, and activity currency from the referenced existing asset before
  validation.
- `pr5-activities-import-currency-validation`: verification passed:
  `bun test apps/backend/src/domains/activities.test.ts --test-name-pattern "validates import activity currency codes like Rust"`,
  `bun test apps/backend/src/domains/activities.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  and full `bun run check`. Coverage includes import validation rejecting
  malformed non-account currency codes with Rust-compatible error text while
  preserving valid cross-currency cash movements.
- `pr5-activities-import-subtype-normalization`: verification passed:
  `bun test apps/backend/src/domains/activities.test.ts --test-name-pattern "canonicalizes and clears import activity subtypes like Rust"`,
  `bun test apps/backend/src/domains/activities.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  and full `bun run check`. Coverage includes import validation canonicalizing
  known subtypes such as `drip` to `DRIP`, clearing subtypes that duplicate the
  activity type case-insensitively, and running disposition/validation against
  the normalized subtype.
- `pr5-activities-import-empty-symbol-validation`: verification passed:
  `bun test apps/backend/src/domains/activities.test.ts --test-name-pattern "validates empty import symbols for asset-backed activity rows like Rust"`,
  `bun test apps/backend/src/domains/activities.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  and full `bun run check`. Coverage includes import validation returning
  Rust-compatible `Symbol is required for <activity> activities.` errors for
  empty BUY/SPLIT/asset-backed income symbols while preserving explicit asset ID
  hydration without requiring a symbol.
- `pr5-activities-import-symbol-name-fallback`: verification passed:
  `bun test apps/backend/src/domains/activities.test.ts --test-name-pattern "fills import symbol names from normalized symbols for new assets like Rust"`,
  `bun test apps/backend/src/domains/activities.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  and full `bun run check`. Coverage includes import validation populating
  missing `symbolName` with the normalized symbol for staged new assets when
  neither a local existing asset nor provider-supplied name is available.
- `pr5-activities-import-staged-asset-hydration`: verification passed:
  `bun test apps/backend/src/domains/activities.test.ts --test-name-pattern "hydrates staged import asset fields from normalized symbols like Rust"`,
  `bun test apps/backend/src/domains/activities.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  and full `bun run check`. Coverage includes import validation returning the
  normalized pending-asset symbol, exchange MIC, instrument type, and quote
  currency for new staged assets before the import apply step persists them.
- `pr5-activities-import-apply-subtype-normalization`: verification passed:
  `bun test apps/backend/src/domains/activities.test.ts --test-name-pattern "clears duplicate import subtypes during apply like Rust"`,
  `bun test apps/backend/src/domains/activities.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  and full `bun run check`. Coverage includes import apply canonicalizing
  subtypes and clearing duplicate activity-type subtypes before validation,
  returned rows, and persisted activity storage.
- `pr5-activities-import-apply-split-currency-fallback`: verification passed:
  `bun test apps/backend/src/domains/activities.test.ts --test-name-pattern "falls back to account currency for invalid split import apply currencies like Rust"`,
  `bun test apps/backend/src/domains/activities.test.ts`,
  `bun run --cwd apps/backend type-check`,
  `bun test apps/backend/src/sync-outbox.test.ts`,
  `bun run --cwd apps/backend test`, and full `bun run check`. Coverage includes
  import apply replacing malformed SPLIT currencies with the account currency
  before returned rows and persisted activity storage.
- `pr5-health-quote-sync-has-synced`: verification passed:
  `bun test apps/backend/src/domains/market-data.test.ts --test-name-pattern "quote sync error snapshots"`,
  `bun test apps/backend/src/domains/health.test.ts --test-name-pattern "quote sync"`,
  `bun test apps/backend/src/domains/market-data.test.ts`,
  `bun test apps/backend/src/domains/health.test.ts`,
  `bun test ./apps/backend/src/sync-outbox.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  full `bun run check`, and `git diff --check`. Coverage includes quote sync
  error snapshots exposing Rust-compatible `hasSyncedBefore` values from local
  quotes, Health Center preserving the field for never-synced assets while
  keeping Rust's 1-5 warning/6+ error thresholds, and deterministic sync-outbox
  event payload assertions.
- `pr5-portfolio-activity-timezone-replay`: verification passed:
  `bun test apps/backend/src/domains/portfolio-jobs.test.ts --test-name-pattern "user timezone|invalid activity dates"`,
  `bun test apps/backend/src/domains/portfolio-jobs.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  full `bun run check`, and `git diff --check`. Coverage includes transaction
  replay grouping a `2025-01-01T07:30:00Z` BUY into the `2024-12-31` snapshot
  for `America/Los_Angeles`, carrying the resulting position/cash into the next
  day, and keeping invalid activity dates as explicit replay failures.
- `pr5-custom-provider-default-price-fallback`: verification passed:
  `bun test apps/backend/src/domains/custom-providers.test.ts --test-name-pattern "default prices|source fetch|CSV sources|HTML sources|HTML table"`,
  `bun test apps/backend/src/domains/custom-providers.test.ts`,
  `bun test apps/backend/src/domains/market-data.test.ts --test-name-pattern "custom provider"`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  full `bun run check`, and `git diff --check`. Coverage includes empty-source
  URL fallback without fetching, network and HTTP failure fallback to the
  configured static price/currency, historical row fallback for
  `fetchSourceRows`, and unchanged CSV/HTML/table extraction behavior.
- `pr5-custom-provider-date-parse-strictness`: verification passed:
  `bun test apps/backend/src/domains/market-data.test.ts --test-name-pattern "targeted custom provider latest|invalid ISO prefixes|custom provider"`,
  `bun test apps/backend/src/domains/market-data.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  full `bun run check`, and `git diff --check`. Coverage includes RFC3339 offset
  datetimes preserving the source-local date before `dateTimezone` conversion
  and invalid ISO-prefixed strings falling back to `now` like Rust instead of
  being accepted as valid quote dates.
- `pr5-portfolio-position-inception-recalc`: verification passed:
  `bun test apps/backend/src/domains/portfolio-jobs.test.ts --test-name-pattern "FIFO sells|paired same-day asset transfers|cross-currency sell|invalid activity dates|user timezone"`,
  `bun test apps/backend/src/domains/portfolio-jobs.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  full `bun run check`, and `git diff --check`. Coverage includes FIFO sell
  removal of the oldest lot advancing `inceptionDate` to the next remaining lot,
  unchanged `createdAt` semantics, and transferred-lot inception preservation.
- `pr5-health-archived-unconfigured-accounts`: verification passed:
  `cargo test -p wealthfolio-core health::service::tests::test_unconfigured_accounts_excludes_archived_accounts --quiet`,
  `cargo test -p wealthfolio-core health --quiet`,
  `cargo check -p wealthfolio-core --quiet`,
  `bun test apps/backend/src/domains/health.test.ts`,
  `cargo test -p wealthfolio-core --quiet`, full `bun run check`, and
  `git diff --check`. Coverage includes archived `NOT_SET` accounts no longer
  contributing to Rust account-configuration health issues, matching the TS
  runtime's active non-archived account setup check.
- `pr5-custom-provider-utf8-response-parity`: verification passed:
  `bun test apps/backend/src/domains/custom-providers.test.ts --test-name-pattern "source fetch|default prices"`,
  `bun test apps/backend/src/domains/custom-providers.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  full `bun run check`, and `git diff --check`. Coverage includes invalid UTF-8
  response bodies returning a Rust-compatible source-test error and invalid-body
  fetch failures falling back to configured `defaultPrice`.
- `pr5-custom-provider-transient-retry-parity`: verification passed:
  `bun test apps/backend/src/domains/custom-providers.test.ts --test-name-pattern "network failures|default prices"`,
  `bun test apps/backend/src/domains/custom-providers.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  full `bun run check`, and `git diff --check`. Coverage includes a single retry
  after network and HTTP 5xx fetch failures before returning an error or
  applying configured `defaultPrice`, while 4xx responses and redirect behavior
  remain unchanged.
- `pr5-custom-provider-html-table-header-parity`: verification passed:
  `cargo test -p wealthfolio-core quotes::custom_scraper_provider --quiet`,
  `cargo test -p wealthfolio-core --quiet`,
  `cargo check -p wealthfolio-core --quiet`, full `bun run check`, and
  `git diff --check`. Coverage includes Rust runtime HTML-table extraction
  skipping a first `<td>` header row even when the header cells are
  numeric-looking, matching the TS backend table extraction path.
- `pr5-custom-provider-html-lang-locale-parity`: verification passed:
  `bun test apps/backend/src/domains/custom-providers.test.ts` and
  `bun run --cwd apps/backend type-check`; final validation passed with
  `bun run --cwd apps/backend test`, full `bun run check`, and
  `git diff --check`. Coverage includes runtime HTML and HTML-table source row
  fetching without an explicit locale using `<html lang>` for European decimal
  parsing, matching Rust custom scraper runtime behavior, plus deterministic
  account-FX runtime test cleanup with market-data fetches stubbed.
- `pr5-custom-provider-date-template-parity`: verification passed:
  `bun test apps/backend/src/domains/custom-providers.test.ts` and
  `bun run --cwd apps/backend type-check`; final validation passed with
  `bun run --cwd apps/backend test`, full `bun run check`, and
  `git diff --check`. Coverage includes `{DATE:...}` expansion for
  Rust/chrono-style day-of-year, weekday names and numbers, century, compact
  date/time aliases, and `%h` month aliases in custom provider URLs, plus
  deterministic holdings snapshot sync-outbox runtime test cleanup with
  market-data fetches stubbed.
- `pr5-custom-provider-source-validation-message-parity`: verification passed:
  `bun test apps/backend/src/domains/custom-providers.test.ts` and
  `bun run --cwd apps/backend type-check`; final validation passed with
  `bun run --cwd apps/backend test`, full `bun run check`, and
  `git diff --check`. Coverage includes invalid custom provider source kinds and
  formats reporting Rust-compatible allowed-value lists in validation errors.
- `pr5-custom-provider-stored-config-parse-parity`: verification passed:
  `bun test apps/backend/src/domains/custom-providers.test.ts` and
  `bun run --cwd apps/backend type-check`; final validation passed with
  `bun run --cwd apps/backend test`, full `bun run check`, and
  `git diff --check`. Coverage includes persisted provider configs with mixed
  valid and malformed source entries returning no sources, matching Rust's
  whole-config serde fallback instead of retaining partial sources.
- `pr5-custom-provider-stored-config-warning-parity`: verification passed:
  `bun test apps/backend/src/domains/custom-providers.test.ts` and
  `bun run --cwd apps/backend type-check`; final validation passed with
  `bun run --cwd apps/backend test`, full `bun run check`, and
  `git diff --check`. Coverage includes persisted provider configs with invalid
  top-level `sources` shapes warning before returning no sources, matching Rust
  serde fallback observability.
- `pr5-market-data-provider-quote-validation`: verification passed:
  `bun test apps/backend/src/domains/market-data.test.ts --test-name-pattern "custom provider latest|explicit custom provider historical|invalid synced"`,
  `bun run --cwd apps/backend type-check`,
  `bun test apps/backend/src/domains/market-data.test.ts`,
  `bun test apps/backend/src/runtime.test.ts`,
  `bun run --cwd apps/backend test`, full `bun run check`, and
  `git diff --check`. Coverage includes latest synced custom-provider
  negative-close rejection without persistence, sync-state failure recording,
  historical invalid-row filtering before persistence, and provider write
  validation applying Rust's hard negative-price/OHLC/non-FX-volume checks.
- `pr5-market-data-resolved-quote-validation`: verification passed:
  `bun test apps/backend/src/domains/market-data.test.ts --test-name-pattern "invalid Yahoo quote summaries|invalid custom provider quote summaries|resolves Yahoo quote summary|custom provider quote summaries"`,
  `bun run --cwd apps/backend type-check`,
  `bun test apps/backend/src/domains/market-data.test.ts`,
  `bun test apps/backend/src/runtime.test.ts`,
  `bun run --cwd apps/backend test`, full `bun run check`, and
  `git diff --check`. Coverage includes invalid latest Yahoo and custom-provider
  quote summaries resolving to no quote instead of surfacing negative prices,
  while the shared validation helper applies the same hard provider quote checks
  to all provider-backed `resolveSymbolQuote` paths.
- `pr5-exchange-rate-converter-refresh`: verification passed:
  `bun test apps/backend/src/domains/exchange-rates.test.ts --test-name-pattern "manual rate mutations|updates exchange rates|converts currencies"`,
  `bun run --cwd apps/backend type-check`,
  `bun test apps/backend/src/domains/exchange-rates.test.ts`,
  `bun test apps/backend/src/runtime.test.ts`,
  `bun run --cwd apps/backend test`, full `bun run check`, and
  `git diff --check`. Coverage includes an initialized converter using a newly
  updated manual FX quote immediately after mutation instead of stale
  pre-mutation graph data.
- `pr5-rust-fx-converter-refresh-alignment`: verification passed:
  `cargo test -p wealthfolio-core fx::fx_service::tests --quiet`,
  `cargo check -p wealthfolio-core --quiet`,
  `bun test apps/backend/src/domains/exchange-rates.test.ts --test-name-pattern "manual rate mutations"`,
  and `bun run --cwd apps/backend type-check`. Coverage includes Rust
  `FxService` refreshing its initialized converter after add/update saves so it
  matches the TS exchange-rate refresh behavior.
- `pr5-custom-provider-historical-latest-fallback`: verification passed:
  `bun test apps/backend/src/domains/market-data.test.ts --test-name-pattern "historical custom provider sources for quote summaries|general-purpose latest quotes from latest historical custom rows"`,
  `bun test apps/backend/src/domains/market-data.test.ts`,
  `bun test apps/backend/src/runtime.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  and full `bun run check`. Coverage includes explicit custom-provider quote
  summaries and general-purpose latest sync using historical row extraction with
  a 90-day range and choosing the newest dated row, matching Rust's
  latest-from-historical fallback behavior.
- `pr5-openfigi-bond-profile-enrichment`: verification passed:
  `bun test apps/backend/src/domains/assets.test.ts --test-name-pattern "OpenFIGI bond profiles|US Treasury bond metadata|unsupported market profiles"`,
  `bun test apps/backend/src/domains/assets.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  full `bun run check`, and `git diff --check`. Coverage includes explicit
  OpenFIGI BOND profile enrichment through the mapping API with `ID_ISIN`,
  Rust-compatible `name - ticker` formatting, profile-enriched marking, and
  metadata preservation for name-only provider profiles.
- `pr5-openfigi-default-bond-profile`: verification passed:
  `bun test apps/backend/src/domains/assets.test.ts --test-name-pattern "OpenFIGI bond profiles|US Treasury bond metadata|unsupported market profiles"`,
  `bun test apps/backend/src/domains/assets.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  full `bun run check`, and `git diff --check`. Coverage includes OpenFIGI as
  the default TS profile provider for market-priced BOND assets without an
  explicit provider, including OpenFIGI profile lookup before US Treasury bond
  metadata enrichment like Rust's provider order.
- `pr5-boerse-frankfurt-profile-enrichment`: verification passed:
  `bun test apps/backend/src/domains/assets.test.ts --test-name-pattern "Boerse Frankfurt .* profiles|OpenFIGI bond profiles|US Treasury bond metadata"`,
  `bun test apps/backend/src/domains/assets.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  full `bun run check`, and `git diff --check`. Coverage includes explicit
  Boerse Frankfurt equity and bond profile enrichment through TradingView search
  and symbols endpoints, Rust-compatible MIC venue matching, user-agent use,
  provider description name updates, metadata-ISIN bond lookup, profile-enriched
  marking, and metadata preservation for name-only provider profiles.
- `pr5-openfigi-profile-override`: verification passed:
  `bun test apps/backend/src/domains/assets.test.ts --test-name-pattern "OpenFIGI bond profiles|Boerse Frankfurt .* profiles|US Treasury bond metadata"`,
  `bun test apps/backend/src/domains/assets.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  full `bun run check`, and `git diff --check`. Coverage includes OpenFIGI BOND
  profile enrichment using provider-specific override symbols before metadata
  identifiers or instrument symbols, matching Rust's provider override resolver.
- `pr5-finnhub-profile-enrichment`: verification passed:
  `bun test apps/backend/src/domains/assets.test.ts --test-name-pattern "Finnhub equity profiles|unsupported market profiles"`,
  `bun test apps/backend/src/domains/assets.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  full `bun run check`, and `git diff --check`. Coverage includes explicit
  Finnhub EQUITY profile enrichment with runtime secret-service API keys,
  provider override symbol precedence, `X-Finnhub-Token` requests,
  Rust-compatible profile metadata mapping and market-cap scaling, and no-key or
  empty-profile skip behavior that leaves assets unmarked.
- `pr5-alpha-vantage-profile-enrichment`: verification passed:
  `bun test apps/backend/src/domains/assets.test.ts --test-name-pattern "Alpha Vantage equity profiles|unsupported market profiles"`,
  `bun test apps/backend/src/domains/assets.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  full `bun run check`, and `git diff --check`. Coverage includes explicit Alpha
  Vantage EQUITY/ETF profile enrichment with runtime secret-service API keys,
  provider override symbol precedence, exchange suffix metadata, `OVERVIEW` plus
  `ETF_PROFILE` requests, Rust-compatible profile metadata and metric mapping,
  and no-key skip behavior that leaves assets unmarked.
- `pr5-health-data-consistency-parity`: verification passed:
  `bun test apps/backend/src/domains/health.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  full `bun run check`, and `git diff --check`. Coverage includes orphan
  activity account references, orphan activity asset references, negative latest
  holdings positions, Rust-shaped data hashes/messages/navigation, and
  preservation of existing negative-balance checks.
- `pr5-contribution-limit-portfolio-update`: verification passed:
  `bun test apps/backend/src/domains/contribution-limits.test.ts`,
  `bun test apps/backend/src/runtime.test.ts -t "contribution-limit"`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  full `bun run check`, and `git diff --check`. Coverage includes standalone
  runtime create/update/delete/idempotent-delete mutations triggering
  Rust-compatible no-market-sync incremental portfolio update events while sync
  outbox behavior remains unchanged.
- `pr5-asset-update-portfolio-side-effects`: verification passed:
  `bun test apps/backend/src/runtime.test.ts -t "asset-updated events"`,
  `bun test apps/backend/src/runtime.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  full `bun run check`, and `git diff --check`. Coverage includes standalone
  runtime asset profile and quote-mode mutations publishing `assets_updated` and
  the domain-event worker triggering market-sync plus portfolio-update events,
  matching Rust's asset-update portfolio side-effect path.
- `pr5-activity-bare-symbol-mic-parity`: verification passed:
  `bun test apps/backend/src/domains/activities.test.ts -t "rejects unsupported or invalid activity creates before persistence|matches bare direct activity symbols"`,
  `bun test apps/backend/src/domains/activities.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  focused code review, full `bun run check`, and `git diff --check`. Coverage
  includes direct activity bare-symbol lookup rejecting a MIC-qualified equity
  match without an explicit MIC, ignoring legacy rows without `instrument_type`,
  and still matching typed no-MIC existing assets, mirroring Rust's asset lookup
  rules.
- `pr5-activity-yahoo-futures-suffix-parity`: verification passed:
  `bun test apps/backend/src/domains/activities.test.ts -t "futures suffix"`,
  `bun test apps/backend/src/domains/activities.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  full `bun run check`, and `git diff --check`. Coverage includes direct
  activity-created asset normalization stripping Yahoo `=F` futures suffixes
  before existing-asset lookup, matching Rust `strip_yahoo_suffix` behavior and
  preventing duplicate `GC=F` assets when canonical `GC` already exists.
- `pr5-addon-zip-bound-parity`: verification passed:
  `cargo test -p wealthfolio-core test_extract_addon_zip_rejects --quiet`,
  `cargo test -p wealthfolio-core addons::tests --quiet`,
  `cargo check -p wealthfolio-core --quiet`, focused code review, full
  `bun run check`, and `git diff --check`. Coverage includes Rust add-on ZIP
  extraction rejecting archives with more than 10,000 entries and rejecting
  archives whose declared uncompressed file content exceeds 50MB, matching TS
  add-on runtime hardening.
- `pr5-app-utility-restore-route-parity`: verification passed:
  `bun test apps/backend/src/domains/app-utilities.test.ts apps/backend/src/http.test.ts -t "database|app utility"`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  full `bun run check`, and `git diff --check`. Coverage includes the TS
  database restore HTTP route dispatching to the required restore service
  directly instead of retaining the stale 501 deferred branch, matching Rust's
  always-wired restore route.
- `pr5-portfolio-metrics-required-methods`: verification passed:
  `bun test apps/backend/src/http.test.ts -t "portfolio metrics"`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  full `bun run check`, and `git diff --check`. Coverage includes required TS
  portfolio performance and income service methods with direct HTTP dispatch,
  removing stale per-method 501 guards for runtime methods that are always
  implemented.
- `pr5-health-required-methods`: verification passed:
  `bun run --cwd apps/backend type-check`,
  `bun test apps/backend/src/http.test.ts -t "health"`,
  `bun test apps/backend/src/domains/health.test.ts`,
  `bun run --cwd apps/backend test`, full `bun run check`, and
  `git diff --check`. Coverage includes required TS health status/check/fix
  service methods with direct HTTP dispatch, removing stale optional 404 guards
  for runtime methods that are always implemented.
- `pr5-taxonomy-migration-required-methods`: verification passed:
  `bun run --cwd apps/backend type-check`,
  `bun test apps/backend/src/http.test.ts -t "taxonomy"`,
  `bun test apps/backend/src/domains/taxonomies.test.ts`,
  `bun run --cwd apps/backend test`, full `bun run check`, and
  `git diff --check`. Coverage includes required TS classification migration
  status/details/run service methods with direct HTTP dispatch, removing stale
  optional 404 guards for runtime methods that are always implemented.
- `pr5-health-australian-timezone-evidence`: verification passed:
  `bun test apps/backend/src/domains/health.test.ts -t "timezone validity"`,
  `bun test apps/backend/src/domains/health.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  full `bun run check`, and `git diff --check`. Coverage includes
  Australia/Melbourne and Australia/Sydney offset-equivalence producing no
  warning, and Australia/Melbourne versus Australia/Perth still producing
  Rust-compatible timezone mismatch warnings.
- `pr5-activity-required-methods`: verification passed:
  `bun run --cwd apps/backend type-check`,
  `bun test apps/backend/src/http.test.ts -t "activities"`,
  `bun test apps/backend/src/domains/activities.test.ts`,
  `bun run --cwd apps/backend test`, full `bun run check`, and
  `git diff --check`. Coverage includes required TS activity
  search/write/import/template/duplicate service methods with direct HTTP
  dispatch, removing stale optional 404 guards for runtime methods that are
  always implemented.
- `pr5-app-utility-instance-header-parity`: verification passed:
  `bun test apps/backend/src/domains/app-utilities.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  full `bun run check`, and `git diff --check`. Coverage includes TS update
  checks always sending `X-Instance-Id`, including the empty-string case,
  matching Rust's update-check request headers.
- `pr5-market-data-required-methods`: verification passed:
  `bun run --cwd apps/backend type-check`,
  `bun test apps/backend/src/http.test.ts -t "market data"`,
  `bun test apps/backend/src/domains/market-data.test.ts`,
  `bun run --cwd apps/backend test`, full `bun run check`, and
  `git diff --check`. Coverage includes required TS market-data
  exchange/search/resolve/quote/import/sync service methods with direct HTTP
  dispatch, removing stale optional 404 guards for runtime methods that are
  always implemented.
- `pr5-total-holdings-weight-evidence`: verification passed:
  `bun test apps/backend/src/domains/portfolio-jobs.test.ts -t "bounded portfolio valuation"`,
  `bun test apps/backend/src/domains/portfolio-jobs.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run --cwd apps/backend test`,
  full `bun run check`, and `git diff --check`. Coverage includes generated
  TOTAL snapshot holdings weights summing to 1.0 and splitting as 0.8 security /
  0.2 cash for the bounded portfolio valuation fixture.
- `rebase-origin-main-2026-05-23`: verification passed: `git fetch origin main`,
  `git rebase origin/main`, full `bun run check`, and `git diff --check`.
  Conflict resolution kept Bun/Electron/TS migration choices, respected upstream
  deletion of local sample add-ons and pnpm workspace files, removed legacy
  Tauri runtime paths during the Tauri-removal commit, regenerated `Cargo.lock`,
  restored Electron adapter exports required by frontend consumers, and replaced
  deleted sample-addon manifest imports in type-bridge tests with inline
  permission fixtures.
- `pr5-electron-brand-icon-paths`: verification passed:
  `test -f assets/brand/app-icon.icns`, `test -f assets/brand/app-icon.ico`,
  `test -f assets/brand/icon.png`, `bun run --cwd apps/electron type-check`,
  full `bun run check`, and `git diff --check`. Coverage includes Electron
  builder icon paths no longer referencing deleted `apps/tauri/icons` files.
- `pr5-ci-check-tauri-name-cleanup`: verification passed:
  `bash -n scripts/ci-check.sh`, full `bun run check`, and `git diff --check`.
  Coverage includes local CI preparing a generic frontend `dist/index.html`
  placeholder without the stale `ensure_tauri_dist` helper name.
- `pr5-web-adapter-tauri-wording-cleanup`: verification passed:
  `bun run --cwd apps/frontend type-check`, full `bun run check`, and
  `git diff --check`. Coverage includes web adapter unsupported-operation
  messages no longer referring users to the removed Tauri app.
- `pr5-docker-ts-backend-cutover`: verification passed:
  `bun test apps/backend/src/config.test.ts apps/backend/src/http.test.ts -t "static|sidecar profile"`,
  `bun run --cwd apps/backend type-check`, full `bun run check`, and
  `git diff --check`. Coverage includes `WF_STATIC_DIR` config parsing, TS
  backend static asset serving with SPA fallback outside `/api/*`, and the
  Dockerfile no longer building or running `wealthfolio-server` from Rust.
- `pr5-dev-web-ts-backend-cutover`: verification passed:
  `node --check scripts/dev-web.mjs`, full `bun run check`, and
  `git diff --check`. Coverage includes `bun run dev:web` launching the Bun
  TypeScript backend instead of
  `cargo run --manifest-path apps/server/Cargo.toml` and `.env.web.example`
  documenting the Bun backend.
- `pr5-electron-default-ts-runtime`: verification passed:
  `bun test apps/electron/src/main/backend-runtime.test.ts`,
  `bun run --cwd apps/electron type-check`, full `bun run check`, and
  `git diff --check`. Coverage includes non-packaged Electron defaulting to the
  Bun TypeScript backend; packaged TS backend bundling/cutover is covered by the
  later `pr5-electron-packaged-ts-sidecar` evidence.
- `pr5-dev-web-database-url-cleanup`: verification passed:
  `node --check scripts/dev-web.mjs`, full `bun run check`, and
  `git diff --check`. Coverage includes `scripts/dev-web.mjs --file-log`
  deriving log names from `WF_DB_PATH` or `app.db`, without the Rust-era
  `DATABASE_URL` fallback.
- `pr5-readme-web-docker-ts-backend`: verification passed:
  `grep -n "Axum server\\|Axum backend\\|cargo run --manifest-path apps/server\\|cargo build --release\\|wealthfolio-server binary\\|/usr/local/bin/wealthfolio-server" README.md`,
  full `bun run check`, and `git diff --check`. Coverage includes README web
  mode and Docker sections documenting the Bun TypeScript backend instead of the
  Rust Axum server path.
- `pr5-e2e-bun-backend-cleanup`: verification passed:
  `node --check scripts/run-e2e.mjs`,
  `bash -n scripts/wait-for-both-servers-to-be-ready.sh`, full `bun run check`,
  and `git diff --check`. Coverage includes E2E no longer passing `RUST_LOG` to
  the Bun backend, wait-script readiness checks no longer mentioning Axum, and
  E2E setup docs no longer requiring Rust for the backend server.
- `pr5-sqlite-migration-count-refresh`: verification passed:
  `bun test apps/backend/src/storage/sqlite.test.ts`,
  `bun run --cwd apps/backend test`, full `bun run check`, and
  `git diff --check`. Coverage includes TS storage parity tests recognizing the
  current Rust migration source of truth: 32 migrations ending at
  `2026-05-19-000001_lots_and_snapshot_positions`.
- `pr5-connect-profile-guard-cleanup`: verification passed:
  `bun test apps/backend/src/runtime.test.ts -t "broker sync profile"`,
  `bun test apps/backend/src/http.test.ts -t "Connect"`,
  `bun run --cwd apps/backend test`, full `bun run check`, and
  `git diff --check`. Coverage includes local Connect broker-sync profile
  read/write delegation to required `ActivityService` methods without
  unreachable TS runtime 501 guards.
- `pr5-backend-electron-test-ci-wiring`: verification passed:
  `bash -n scripts/ci-check.sh`, `bun run test:backend`,
  `bun run test:electron`, full `bun run check`, and `git diff --check`.
  Coverage includes root scripts, PR CI, and local full-check wiring for TS
  backend and Electron tests so migration regressions are no longer hidden
  behind frontend-only `bun run test`.
- `pr5-env-database-url-cleanup`: verification passed: full `bun run check` and
  `git diff --check`. Coverage includes README and `.env.example` no longer
  instructing desktop users to configure `DATABASE_URL`; web database
  configuration points to `WF_DB_PATH` in `.env.web`.
- `pr5-readme-backend-summary-refresh`: verification passed: full
  `bun run check` and `git diff --check`. Coverage includes README technology
  and folder-structure sections naming `apps/backend` as the Bun TypeScript
  backend runtime and `apps/server` as the temporary Rust compatibility server.
- `pr5-vscode-tauri-extension-cleanup`: verification passed:
  `python3 -m json.tool .vscode/extensions.json`, full `bun run check`, and
  `git diff --check`. Coverage includes VS Code recommendations no longer
  prompting developers to install the Tauri extension after Tauri runtime
  removal.
- `pr5-electron-packaged-ts-sidecar`: verification passed:
  `bun run build:electron:sidecar`, `bun run test:backend`,
  `bun run test:electron`, full `bun run check`, and `git diff --check`.
  Coverage includes Bun-compiling `apps/backend/src/main.ts` into the packaged
  Electron sidecar executable, staging SQLite migrations plus exchange and AI
  provider catalogs beside the binary, smoke-testing the compiled backend via
  `/api/v1/readyz`, copying TS backend resources in `afterPack`, defaulting
  packaged Electron runtime to TS, and removing Rust setup/cache from the
  Electron release job's sidecar build.
- `pr5-standalone-prebuild-ts-backend`: verification passed:
  `bun build apps/backend/src/main.ts --compile --target=bun-linux-x64-baseline`,
  `bash -n scripts/ci-check.sh`, full `bun run check`, and `git diff --check`.
  Coverage includes release building `wealthfolio-backend` from the Bun
  TypeScript backend instead of `cargo build --manifest-path apps/server`,
  staging `backend-assets` with migrations and runtime catalogs, smoke-testing
  the compiled backend with prebuild env paths, publishing
  `wealthfolio-backend-*-linux-amd64` tarballs, updating the systemd/quick-start
  prebuild docs, and removing Rust server release-build checks from PR/local
  full checks.
- `pr5-electron-rust-runtime-fallback-removal`: verification passed:
  `bun run test:electron`, `bun run build:electron:sidecar`, full
  `bun run check`, and `git diff --check`. Coverage includes Electron accepting
  only the TypeScript/Bun backend runtime, rejecting `WF_BACKEND_RUNTIME=rust`,
  and removing Electron main helpers that constructed `cargo run apps/server` or
  packaged `wealthfolio-server` commands.
- `pr5-architecture-docs-ts-backend-refresh`: verification passed: targeted `rg`
  checks against `docs/architecture/adapters.md`,
  `docs/architecture/electron-migration.md`, and
  `docs/architecture/ai-assistant-architecture.md`, full `bun run check`, and
  `git diff --check`. Coverage includes adapter, Electron desktop, and AI
  assistant architecture docs describing the Bun/TypeScript backend runtime,
  packaged TS backend assets, and TypeScript keyring sidecar behavior instead of
  stale Axum/Rust sidecar paths.
- `pr5-portfolio-job-deferred-cleanup`: verification passed:
  `rg "createDeferredPortfolioJobService|PortfolioJobNotImplementedError|Portfolio job execution is not yet available" apps/backend/src`,
  `bun test apps/backend/src/domains/portfolio-jobs.test.ts`,
  `bun run --cwd apps/backend type-check`, full `bun run check`, and
  `git diff --check`. Coverage includes removing the stale deferred portfolio
  job service/export/test now that the standalone TS runtime executes bounded
  portfolio valuation and activity replay jobs.
- `pr5-domain-not-implemented-error-cleanup`: verification passed:
  `rg "HoldingsNotImplementedError|PortfolioMetricsNotImplementedError|MarketDataNotImplementedError" apps/backend/src`,
  `bun test apps/backend/src/domains/holdings.test.ts apps/backend/src/domains/portfolio-metrics.test.ts apps/backend/src/domains/market-data.test.ts`,
  `bun run --cwd apps/backend type-check`, full `bun run check`, and
  `git diff --check`. Coverage includes removing stale exported
  `NotImplementedError` classes for TS-backed holdings, portfolio metrics, and
  market-data domains.
- `pr5-packaged-bun-backend-review-fixes`: verification passed:
  `bun run build:electron:sidecar`, `bun run test:backend`,
  `bun run test:electron`,
  `bun test apps/backend/src/runtime.test.ts -t "packaged app version|packaged runtime resource paths"`,
  `bun test apps/electron/src/main/sidecar.test.ts`,
  `bun test apps/backend/src/domains/secrets.test.ts`, full `bun run check`, and
  `git diff --check`. Coverage includes staging the target keyring native
  binding beside packaged Electron sidecars, loading
  `NAPI_RS_NATIVE_LIBRARY_PATH` directly in the TS keyring service, embedding or
  injecting app versions for compiled Electron/prebuild backends, extending
  compiled sidecar smoke tests to `/api/v1/app/info` and `/api/v1/ai/providers`,
  pinning Electron release jobs to matching-architecture runners, uploading only
  release files, and using one canonical release tag/version for workflow
  dispatch prebuild artifacts.
- `pr5-goal-valuation-route-config-cleanup`: verification passed:
  `bun test apps/backend/src/http.test.ts -t "goal valuation provider|retirement"`,
  `bun run --cwd apps/backend type-check`, full `bun run check`, and
  `git diff --check`. Coverage includes replacing stale "not available in the TS
  backend runtime yet" goal/retirement valuation route responses with an
  explicit configuration error while the standalone runtime continues to provide
  the valuation provider.
- `pr5-ai-chat-config-error-cleanup`: verification passed:
  `bun test apps/backend/src/domains/ai-chat.test.ts -t "configuration error|unsupported attachments|missing API keys"`,
  `bun run --cwd apps/backend type-check`, full `bun run check`, and
  `git diff --check`. Coverage includes replacing stale "AI chat streaming is
  not yet available in the TS backend runtime" responses with a configuration
  error when the AI provider service is missing, while preserving explicit 501s
  for unsupported attachment/provider combinations.
- `pr5-readme-keyring-runtime-refresh`: verification passed:
  `rg "keyring-backend|shared Rust \`keyring\` backend|Complete Rust development
  setup|Rust sidecar|prebuild fallback|sidecar fallback" README.md`, full `bun
  run check`, and `git diff --check`. Coverage includes README prerequisites,
  DevContainer features, backend technology summary, folder structure, and API
  key/keyring storage text reflecting the Bun/TypeScript backend plus legacy
  Rust compatibility tooling.
- `pr5-connect-session-secret-runtime`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun test apps/backend/src/runtime.test.ts -t "Connect refresh sessions|broker sync profile"`,
  `bun run --cwd apps/backend type-check`, full `bun run check`, and
  `git diff --check`. Coverage includes standalone TS runtime Connect session
  store/status/clear backed by `SecretService`, with legacy access-token
  cleanup, while cloud access-token restore and broker/device sync remain
  feature-gated.
- `pr5-connect-token-restore-runtime`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun test apps/backend/src/runtime.test.ts -t "Connect refresh sessions|broker sync profile"`,
  `bun run --cwd apps/backend type-check`, full `bun run check`, and
  `git diff --check`. Coverage includes refresh-token restore through the
  Connect auth endpoint, refresh-token rotation, legacy access-token cleanup,
  invalid-session cleanup on unauthorized refresh responses, and runtime HTTP
  `/connect/session/restore` wiring.
- `pr5-connect-token-restore-review-fixes`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun test apps/backend/src/runtime.test.ts -t "Connect refresh sessions|disabled cloud routes|broker sync profile"`,
  `bun run --cwd apps/backend type-check`, full `bun run check`, and
  `git diff --check`. Coverage includes serializing concurrent token restores,
  classifying invalid OAuth error codes independently from generic descriptions,
  avoiding stale-refresh cleanup races, and updating disabled-cloud route tests
  for migrated Connect session routes.
- `pr5-connect-public-plans-runtime`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun test apps/backend/src/runtime.test.ts -t "disabled cloud routes|Connect refresh sessions|broker sync profile"`,
  `bun run --cwd apps/backend type-check`, full `bun run check`, and
  `git diff --check`. Coverage includes standalone TS runtime
  `/connect/plans/public` fetching public subscription plans from
  `CONNECT_API_URL` with the Rust-compatible default base URL while
  authenticated plans and broker/device sync remain feature-gated.
- `pr5-connect-authenticated-user-plans-runtime`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun test apps/backend/src/runtime.test.ts -t "disabled cloud routes|Connect refresh sessions|broker sync profile"`,
  `bun run --cwd apps/backend type-check`, full `bun run check`, and
  `git diff --check`. Coverage includes authenticated `/connect/plans` and
  `/connect/user` calls through restored access tokens, bearer-auth Connect API
  requests, Rust-compatible user/team response field mapping, shared in-flight
  token restores for concurrent authenticated reads, and guards preventing
  pending restores from resurrecting cleared or replaced sessions.
- `pr5-connect-broker-read-runtime`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun test apps/backend/src/runtime.test.ts -t "disabled cloud routes|Connect refresh sessions|broker sync profile"`,
  `bun run --cwd apps/backend type-check`, full `bun run check`, and
  `git diff --check`. Coverage includes authenticated `/connect/connections` and
  `/connect/accounts` cloud reads through restored access tokens,
  Rust-compatible connection ID/brokerage fallback mapping, and account response
  pass-through.
- `pr5-connect-sync-connections-runtime`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun test apps/backend/src/runtime.test.ts -t "disabled cloud routes|Connect refresh sessions|broker sync profile"`,
  `bun run --cwd apps/backend type-check`, full `bun run check`, and
  `git diff --check`. Coverage includes `/connect/sync/connections` fetching
  cloud connections with a restored access token and upserting brokerage
  platforms with Rust-compatible slug/id, display-name, URL, external-id, and
  logo mapping.
- `pr5-connect-sync-accounts-runtime`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun test apps/backend/src/runtime.test.ts -t "disabled cloud routes|Connect refresh sessions|broker sync profile"`,
  `bun run --cwd apps/backend type-check`, full `bun run check`, and
  `git diff --check`. Coverage includes `/connect/sync/accounts` fetching broker
  accounts with a restored access token, skipping missing/existing provider IDs,
  creating SNAPTRADE HOLDINGS accounts through the account service, matching
  platforms by external ID/name, preserving broker metadata JSON, and returning
  Rust-compatible created/skipped/new-account payloads.
- `pr5-device-sync-engine-status-runtime`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "device sync local|stores, reports"`,
  `bun test apps/backend/src/runtime.test.ts -t "device-sync state|disabled cloud routes"`,
  `bun run --cwd apps/backend type-check`, full `bun run check`, and
  `git diff --check`. Coverage includes local `/connect/device/engine-status`
  reading `sync_cursor`, `sync_engine_state`, and `sync_device_config` from
  SQLite, Rust-compatible response field mapping, bootstrap-required detection
  from missing bootstrap data or stale cursors, and keeping cloud/device
  mutation routes feature-gated.
- `pr5-device-sync-bootstrap-overwrite-runtime`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "device sync local|overwrite risk|stores, reports"`,
  `bun test apps/backend/src/runtime.test.ts -t "device-sync state|disabled cloud routes"`,
  `bun run --cwd apps/backend type-check`, full `bun run check`, and
  `git diff --check`. Coverage includes local
  `/connect/device/bootstrap-overwrite-check` reading the Rust overwrite-risk
  table set from SQLite, applying manual/user-data filters, sorting
  non-empty-table counts by rows then table, and keeping device-sync mutation
  routes feature-gated.
- `pr5-connect-sync-activities-holdings-noop`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun test apps/backend/src/runtime.test.ts -t "disabled cloud routes|Connect refresh sessions|broker sync profile"`,
  `bun run --cwd apps/backend type-check`, full `bun run check`, and
  `git diff --check`. Coverage includes `/connect/sync/activities` returning a
  Rust-compatible empty summary when all synced broker accounts are
  HOLDINGS-mode and keeping TRANSACTIONS-mode broker activity mapping
  feature-gated until the full mapper lands.
- `pr5-device-sync-background-noop-runtime`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "background engine|device sync local"`,
  `bun test apps/backend/src/runtime.test.ts -t "device-sync state|disabled cloud routes"`,
  `bun run --cwd apps/backend type-check`, full `bun run check`, and
  `git diff --check`. Coverage includes local `/connect/device/start-background`
  returning Rust-compatible `skipped` when no sync identity is configured,
  `/connect/device/stop-background` returning `stopped`, and keeping
  cloud/push/pull mutations feature-gated.
- `pr5-connect-bounded-full-sync-runtime`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun test apps/backend/src/runtime.test.ts -t "disabled cloud routes|Connect refresh sessions|broker sync profile"`,
  `bun run --cwd apps/backend type-check`, full `bun run check`, and
  `git diff --check`. Coverage includes `/connect/sync` running the migrated
  connections sync, accounts sync, and HOLDINGS-mode activities no-op path,
  returning accepted while TRANSACTIONS-mode broker activity mapping remains
  feature-gated.
- `pr5-connect-activities-empty-page-runtime`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "activity sync|empty broker activity|transaction-mode"`,
  `bun test apps/backend/src/runtime.test.ts -t "disabled cloud routes|Connect refresh sessions|broker sync profile"`,
  `bun run --cwd apps/backend type-check`, full `bun run check`, and
  `git diff --check`. Coverage includes marking TRANSACTIONS accounts as
  attempted, fetching broker activity pages, finalizing success when no
  activities are returned, and preserving explicit 501 behavior for non-empty
  pages until broker activity mapping lands.
- `pr5-connect-activities-fetch-failure-runtime`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "activity page|empty broker activity|transaction-mode"`,
  `bun run --cwd apps/backend type-check`, full `bun run check`, and
  `git diff --check`. Coverage includes broker activity page fetch failures
  marking the account sync state as FAILED, incrementing `accountsFailed`, and
  returning the summary without aborting the whole activities-only route.
- `pr5-device-sync-pairing-source-preconditions`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "pairing source|device sync local"`,
  `bun test apps/backend/src/runtime.test.ts -t "device-sync state|disabled cloud routes"`,
  `bun run --cwd apps/backend type-check`, full `bun run check`, and
  `git diff --check`. Coverage includes local
  `/connect/device/pairing-source-status` returning Rust-compatible no-identity
  and not-ready errors before cloud cursor checks, while trusted-device cursor
  comparison remains feature-gated.
- `pr5-device-sync-cancel-snapshot-noop`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "snapshot cancellation|background|device sync local"`,
  `bun test apps/backend/src/runtime.test.ts -t "device-sync state|disabled cloud routes"`,
  `bun run --cwd apps/backend type-check`, full `bun run check`, and
  `git diff --check`. Coverage includes local `/connect/device/cancel-snapshot`
  returning Rust-compatible `cancel_requested`/message while snapshot
  generation/upload remains feature-gated.
- `pr5-device-sync-snapshot-preconditions`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "snapshot preconditions|device sync local"`,
  `bun test apps/backend/src/runtime.test.ts -t "device-sync state|disabled cloud routes"`,
  `bun run --cwd apps/backend type-check`, full `bun run check`, and
  `git diff --check`. Coverage includes local
  `/connect/device/bootstrap-snapshot` and `/connect/device/generate-snapshot`
  returning Rust-compatible no-identity and no-device-id errors before cloud
  upload paths, while trusted-device snapshot export/upload remains
  feature-gated.
- `pr5-device-sync-trigger-cycle-precondition`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "trigger cycle|device sync local"`,
  `bun test apps/backend/src/runtime.test.ts -t "device-sync state|disabled cloud routes"`,
  `bun run --cwd apps/backend type-check`, full `bun run check`, and
  `git diff --check`. Coverage includes local `/connect/device/trigger-cycle`
  recording a Rust-compatible `config_error` engine outcome and returning the
  cycle summary with cursor/lock version and zero pushed/pulled counts before
  cloud push/pull paths.
- `pr5-device-sync-clear-data-runtime`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts apps/backend/src/runtime.test.ts -t "device sync"`,
  `bun run --cwd apps/backend type-check`, full `bun run check`, and
  `git diff --check`. Coverage includes local `DELETE /connect/device/sync-data`
  preserving the sync identity device nonce, clearing device identity/key
  material, deleting the legacy device-id secret, resetting sync cursor/engine
  state, clearing sync control-plane tables, preserving app data, returning JSON
  `null`, and ensuring migrated local device-sync route errors are catchable
  HTTP domain rejections.
- `pr5-connect-session-freshness-clear`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts apps/backend/src/runtime.test.ts -t "Connect refresh sessions|stores Connect refresh sessions|stores, reports"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes
  `DELETE /connect/session` clearing local
  `sync_device_config.min_snapshot_created_at` after refresh/access token
  cleanup without deleting device config rows, matching Rust logout/reset
  freshness-gate cleanup.
- `pr5-connect-activity-skip-missing-ids`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "activity pages|broker activity|transaction-mode"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes transaction-mode
  `/connect/sync/activities` accepting non-empty broker activity pages when
  every activity lacks a non-blank `id`, finalizing sync success with zero
  upserts like Rust's `map_broker_activity` skip path, and preserving the
  explicit mapper feature gate for pages containing mappable activity IDs.
- `pr5-connect-activity-pagination`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "activity pages|broker activity|transaction-mode"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes
  `/connect/sync/activities` following Rust-compatible activity page pagination
  via `has_more`/`total`/`limit`, advancing offsets by received rows, continuing
  over non-empty unmappable pages, recording per-account fetch failures on any
  page, and preserving the mapper feature gate for the first mappable activity
  page.
- `pr5-frontend-rust-backend-wording-cleanup`: verification passed:
  `rg "Rust backend|rust backend|processed by Rust backend|Delegates to Rust backend" apps/frontend/src`,
  `bun run --cwd apps/frontend type-check -- --pretty false`, full
  `bun run check`, and `git diff --check`. Coverage includes device-sync service
  comments, sync crypto comments, add-on manifest permission comments, and AI
  activity payload compatibility comments now using neutral backend wording
  while preserving intentional Tauri-compatible event/API names.
- `pr5-server-readme-legacy-refresh`: verification passed:
  `rg "src-server|src-core|Pull the latest published server image|This crate runs the HTTP API|Current local web, Docker|apps/backend" apps/server/README.md`,
  full `bun run check`, and `git diff --check`. Coverage includes
  `apps/server/README.md` describing the Rust server as a legacy Axum
  compatibility/reference crate, pointing current web/Docker/Electron runtime
  usage to `apps/backend` and the root README, fixing old
  `src-server`/`src-core` paths, and scoping environment variables to explicit
  legacy reference runs.
- `pr5-connect-activity-page-aliases`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "activity page|broker activity|transaction-mode|aliases"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes
  `/connect/sync/activities` recognizing broker activity arrays from `data`,
  `activities`, `universalActivities`, and `universal_activities` like Rust's
  serde aliases, preventing aliased non-empty pages from being mistaken as empty
  and preserving the mapper feature gate for aliased mappable activity rows.
- `pr5-addon-sdk-desktop-wording-cleanup`: verification passed:
  `rg "desktop \\(Tauri\\)|Tauri app|Tauri-compatible|Tauri" packages/addon-sdk/README.md`,
  full `bun run check`, and `git diff --check`. Coverage includes the add-on SDK
  `activities.getAll` tip now describing desktop and web runtimes generically
  while preserving intentional compatibility names elsewhere.
- `pr5-connect-activity-query-shape`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "syncs transaction accounts with empty broker activity pages|activity pages|broker activity|transaction-mode"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes broker activity
  request query strings using Rust client parameter order: `offset`, `limit`,
  optional `start_date`, then `end_date`, with focused assertions for
  incremental start-date syncs.
- `pr5-readme-legacy-runtime-wording`: verification passed:
  `rg "temporary Rust compatibility server|Temporary Rust compatibility server|legacy Rust compatibility/reference|Axum" README.md`,
  full `bun run check`, and `git diff --check`. Coverage includes README backend
  technology and folder structure wording now describing Rust/Axum as legacy
  compatibility/reference tooling and `apps/server` as a legacy Rust
  compatibility/reference server instead of a temporary runtime server.
- `pr5-electron-architecture-reference-wording`: verification passed:
  `rg "legacy Rust business logic|legacy Rust reference implementation|Bun/TypeScript backend locally" docs/architecture/electron-migration.md`,
  full `bun run check`, and `git diff --check`. Coverage includes the Electron
  architecture doc describing the TS backend as preserving behavior proven
  against the legacy Rust reference implementation rather than implying the
  current runtime still uses legacy Rust business logic.
- `pr5-connect-api-error-body-parsing`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "activity page fetch fails|broker activity|transaction-mode"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes authenticated
  bearer Connect requests parsing JSON error bodies to include cloud-provided
  `message`/`error` text in `API error <status>: ...` messages, so broker
  activity sync failures persist more actionable `last_error` values.
- `pr5-connect-broker-list-default-arrays`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "broker connection|broker account|empty lists"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes authenticated
  broker connection/account reads treating missing `connections` or `accounts`
  fields as empty arrays like Rust serde defaults, while still rejecting
  non-object responses and non-array fields.
- `pr5-connect-user-info-required-ids`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "user info|authenticated plans"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes `/connect/user`
  rejecting malformed cloud responses when required user or team IDs are missing
  or non-string, matching Rust serde-required `ApiUser.id`/`ApiTeam.id` behavior
  instead of silently returning empty IDs.
- `pr5-connect-broker-read-entry-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "broker connection|broker account|empty lists|malformed broker"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes broker connection
  entries requiring the Rust-required `id` field even when `authorization_id` is
  present, broker account entries rejecting non-object values, and removal of
  the old unused string fallback helper.
- `pr5-connect-broker-account-scalar-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "broker account|malformed broker|empty lists"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes broker account
  reads rejecting non-string values for Rust `Option<String>` account fields and
  non-boolean values for boolean account flags instead of silently dropping
  invalid values during TS mapping.
- `pr5-connect-brokerage-scalar-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "broker connection|brokerage fields|malformed broker"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes nested and fallback
  brokerage fields rejecting invalid non-string scalar values like Rust serde
  would, instead of silently nulling malformed brokerage IDs, names, slugs, or
  logo URLs during TS mapping.
- `pr5-connect-user-team-scalar-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "user team|user info|authenticated plans"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes `/connect/user`
  rejecting malformed optional string, boolean, and numeric fields on user/team
  payloads, matching Rust serde behavior instead of silently nulling invalid
  cloud values.
- `pr5-connect-broker-account-nested-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "broker account|nested fields|malformed broker|empty lists"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes broker account
  reads rejecting malformed balance totals, owner fields, and sync-status detail
  fields when their scalar types do not match Rust models, instead of silently
  preserving invalid cloud payloads.
- `pr5-connect-broker-connection-scalar-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "broker connection|malformed broker"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes optional broker
  connection fields such as `authorization_id`, `status`, `updated_at`, `name`,
  and `disabled` rejecting invalid scalar types like Rust serde instead of
  silently dropping or defaulting malformed cloud values.
- `pr5-connect-plan-response-parsing`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "subscription plan|authenticated plans|public subscription|concurrent authenticated"`,
  `bun test apps/backend/src/runtime.test.ts -t "wires local Connect runtime behavior"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes public and
  authenticated plan reads validating required plan/pricing/limit fields,
  normalizing serde-default fields (`features`, availability flags, badge,
  discount metadata), and rejecting malformed plan payloads instead of returning
  raw partial responses.
- `pr5-connect-plan-optional-scalar-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "subscription plan|authenticated plans|public subscription|concurrent authenticated"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes optional plan
  fields such as `tagline`, `isAvailable`, `isComingSoon`, `badge`,
  `yearlyDiscountPercent`, and `pricing.yearlyPerMonth` rejecting malformed
  scalar types like Rust serde instead of being silently defaulted or nulled.
- `pr5-connect-device-sync-state-fresh`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "sync state|device sync local|Connect session"`,
  `bun test apps/backend/src/runtime.test.ts -t "disabled device sync runtime behavior"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes
  `/connect/device/sync-state` returning Rust-compatible `FRESH` when a valid
  Connect session exists but no sync identity is configured, or the identity has
  a nonce without device ID; missing Connect sessions return forbidden before
  local state checks, and device-ID-present states remain feature-gated pending
  cloud device verification.
- `pr5-connect-device-sync-state-identity-errors`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "sync state|device sync local|Connect session|malformed sync identity"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes malformed local
  sync identity JSON/field types surfacing parse errors after Connect session
  restore in `/connect/device/sync-state`, instead of falling through to FRESH.
- `pr5-connect-device-sync-background-runnable-gate`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "background engine|snapshot cancellation|device sync local"`,
  `bun test apps/backend/src/runtime.test.ts -t "disabled device sync runtime behavior"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes
  `/connect/device/start-background` returning local `skipped` only when sync
  identity is absent or not runnable, while a local identity with both device ID
  and root key remains feature-gated until background engine runtime lands.
- `pr5-connect-device-sync-engine-identity-bootstrap`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "engine status|overwrite risk|bootstrap requirement"`,
  `bun test apps/backend/src/runtime.test.ts -t "disabled device sync runtime behavior"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes engine-status and
  bootstrap-overwrite checks requiring bootstrap when sync identity is missing
  or malformed, and using `sync_device_config` only for the current identity
  device ID instead of any stale config row.
- `pr5-connect-client-request-id-headers`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "public subscription|authenticated plans|broker connection|activity page"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes public and
  bearer-authenticated Connect requests adding
  `x-wf-client-request-id: app:<uuid>` with JSON content headers, matching Rust
  Connect client request metadata behavior.
- `pr5-connect-public-plan-error-status`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "public subscription|API error|authenticated plans|activity page fetch"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes public
  `/connect/plans/public` failures returning status-only `API error <status>`
  messages instead of parsing cloud JSON error bodies, while authenticated
  bearer Connect requests still preserve cloud error text.
- `pr5-device-sync-current-device-preconditions`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun test apps/backend/src/runtime.test.ts -t "disabled device sync runtime behavior"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes
  `/api/v1/sync/device/current` returning the Connect session forbidden error
  before local checks when no session is configured, returning
  `400 No device ID configured` after session restore when no local device ID is
  present, preserving legacy `sync_device_id` fallback when `sync_identity`
  cannot be parsed, and keeping actual cloud device reads feature-gated.
- `pr5-device-sync-list-devices-preconditions`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun test apps/backend/src/runtime.test.ts -t "disabled device sync runtime behavior"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes
  `/api/v1/sync/devices` restoring the Connect session first, returning the same
  forbidden session error when no session is configured, and remaining
  feature-gated after a valid session until cloud device listing lands.
- `pr5-device-sync-device-management-preconditions`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun test apps/backend/src/runtime.test.ts -t "disabled device sync runtime behavior"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes
  `/api/v1/sync/device/{id}` get/update/delete and revoke restoring the Connect
  session before cloud work, returning the same forbidden session error when no
  session is configured, and remaining feature-gated after a valid session until
  cloud device management lands.
- `pr5-device-sync-team-key-preconditions`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun test apps/backend/src/runtime.test.ts -t "disabled device sync runtime behavior"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes team key
  initialize/commit/rotate/commit restoring Connect session and reporting
  Rust-compatible `400 No device ID configured` when no local device ID exists,
  reset-team-sync restoring session first, and all paths remaining feature-gated
  after prerequisites are satisfied.
- `pr5-device-sync-pairing-preconditions`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun test apps/backend/src/runtime.test.ts -t "disabled device sync runtime behavior"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes core
  `/api/v1/sync/pairing*` issuer/claimer routes creating/getting/approving/
  completing/canceling/claiming/messaging/confirming pairing after restoring
  Connect session, reporting Rust-compatible missing-device-ID errors before
  cloud calls, and remaining feature-gated after prerequisites are satisfied.
- `pr5-device-sync-composite-pairing-preconditions`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun test apps/backend/src/runtime.test.ts -t "disabled device sync runtime behavior"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes
  `/api/v1/sync/pairing/complete-with-transfer` and
  `/api/v1/sync/pairing/confirm-with-bootstrap` requiring a parseable
  `sync_identity` with a device ID before restoring the Connect session,
  preserving Rust's no-legacy-fallback composite engine precondition, rejecting
  malformed non-i32 `version`/`keyVersion` identity values after dual GPT/Claude
  xhigh review, and remaining feature-gated after prerequisites are satisfied.
- `pr5-device-sync-pairing-flow-preconditions`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun test apps/backend/src/runtime.test.ts -t "disabled device sync runtime behavior"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes
  `/api/v1/sync/pairing/flow/begin` requiring a parseable `sync_identity` with a
  device ID before restoring the Connect session, preserving Rust's
  no-legacy-fallback flow engine precondition, unknown flow
  `state`/`approve-overwrite` returning `Flow not found`, and `flow/cancel`
  returning the Rust-shaped local success no-op. Dual GPT/Claude xhigh review
  found no actionable issues.
- `pr5-device-sync-register-preconditions`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun test apps/backend/src/runtime.test.ts -t "disabled device sync runtime behavior"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes
  `/api/v1/sync/device/register` restoring the Connect session before deferred
  cloud enrollment work, returning the same forbidden session error when no
  session is configured, remaining feature-gated after a valid session, and dual
  GPT/Claude xhigh review finding no actionable issues.
- `pr5-connect-device-enable-preconditions`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "device sync local service"`,
  `bun test apps/backend/src/runtime.test.ts -t "disabled device sync runtime behavior"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes
  `/api/v1/connect/device/enable` and `/api/v1/connect/device/reinitialize`
  restoring the Connect session before deferred enroll/reinitialize work,
  returning the same forbidden session error when no session is configured, and
  remaining feature-gated after a valid session. Dual GPT/Claude xhigh review
  found no actionable issues.
- `pr5-connect-device-reconcile-preconditions`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "device sync local service"`,
  `bun test apps/backend/src/runtime.test.ts -t "disabled device sync runtime behavior"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes
  `/api/v1/connect/device/reconcile-ready-state` returning Rust-shaped reconcile
  results for token/sync-state read failures and non-READY local states, while
  keeping READY/cloud bootstrap paths feature-gated. Dual GPT/Claude xhigh
  review found no actionable issues.
- `pr5-connect-device-snapshot-identity-preconditions`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "device sync local service"`,
  `bun test apps/backend/src/runtime.test.ts -t "disabled device sync runtime behavior"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes
  `/api/v1/connect/device/bootstrap-snapshot` and
  `/api/v1/connect/device/generate-snapshot` reading `sync_identity` from the
  secret store instead of stale `sync_device_config`, preserving Rust's
  no-legacy-fallback snapshot engine precondition, reporting
  `No device ID configured` for nonce-only identities, and remaining
  feature-gated once a device ID is present. Dual GPT/Claude xhigh review found
  no actionable issues.
- `pr5-connect-device-pairing-source-identity-preconditions`: verification
  passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "device sync local service"`,
  `bun test apps/backend/src/runtime.test.ts -t "disabled device sync runtime behavior"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes
  `/api/v1/connect/device/pairing-source-status` reading `sync_identity` from
  the secret store instead of stale `sync_device_config`, reporting missing
  identity/device-ID before token/cloud checks, mapping token restore failures
  through the Rust-like internal-error path, and remaining feature-gated after a
  valid session. Dual GPT/Claude xhigh review found no actionable issues.
- `pr5-connect-device-trigger-cycle-identity-preconditions`: verification
  passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "device sync local service"`,
  `bun test apps/backend/src/runtime.test.ts -t "disabled device sync runtime behavior"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes
  `/api/v1/connect/device/trigger-cycle` reading `sync_identity` from the secret
  store instead of stale `sync_device_config`, reporting `config_error` only for
  missing/unparseable identity, reporting `not_ready` for identity without a
  device ID or non-READY local sync state, mapping token/state restore failures
  to `state_error`, and remaining feature-gated for READY/cloud cycle paths.
  Dual GPT/Claude xhigh review found no actionable issues.
- `pr5-connect-device-sync-identity-i32-parse`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "device sync local service"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes Connect-side
  `sync_identity` parsing rejecting `version: null`, non-integer
  `version`/`keyVersion` raw JSON tokens such as `2.0`/`1e0`, and other
  non-Rust-shaped identity fields before local device-sync state checks,
  including escaped/duplicate field spellings and device-ID-only consumers. Dual
  GPT/Claude xhigh review found and then verified the raw-token/device-ID
  consumer fix.
- `pr5-device-sync-identity-i32-parse`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "device sync local service"`,
  `bun test apps/backend/src/domains/device-sync.test.ts`, and
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes standalone and
  Connect-device `sync_identity` parsing rejecting `version: null`, non-integer
  `version`/`keyVersion` raw JSON tokens such as `2.0`/`1e0`, duplicate known
  identity fields, core device-ID legacy fallback on malformed identity, and
  composite/flow no-legacy-fallback behavior. Dual GPT/Claude xhigh review found
  no actionable issues.
- `pr5-device-sync-list-devices-cloud-read`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes
  `/api/v1/sync/devices` restoring the Connect session, calling
  `/api/v1/sync/team/devices` with bearer auth, JSON content type, and
  `x-wf-client-request-id: app:<uuid>`, forwarding scope, mapping
  snake_case/camelCase cloud device fields to Rust-compatible camelCase response
  objects, wrapping cloud failures as local 500s, rejecting malformed optional
  device fields, and preserving no-session errors. Dual GPT/Claude xhigh review
  found no actionable issues after the error/optional-field fixes.
- `pr5-device-sync-device-read-cloud`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes
  `/api/v1/sync/device/{id}` restoring the Connect session and reading
  `/api/v1/sync/team/devices/{id}`, `/api/v1/sync/device/current` preserving
  token-first behavior and malformed-identity legacy fallback before cloud read,
  update/delete/revoke remaining feature-gated, and dual GPT/Claude xhigh review
  finding no actionable issues.
- `pr5-device-sync-device-mutations-cloud`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes
  `/api/v1/sync/device/{id}` PATCH/DELETE and `/api/v1/sync/device/{id}/revoke`
  restoring the Connect session, calling the Rust-compatible cloud endpoints,
  serializing `display_name`, parsing `SuccessResponse`, and preserving
  no-session errors. Dual GPT/Claude xhigh review found no actionable issues.
- `pr5-device-sync-team-key-phase-one-cloud`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes
  `/api/v1/sync/keys/initialize` and `/api/v1/sync/keys/rotate` restoring the
  Connect session, resolving the local device ID, sending Rust-compatible
  `x-wf-device-id` headers and JSON bodies, parsing BOOTSTRAP/PAIRING_REQUIRED/
  READY initialize results and rotate challenges, and leaving commit operations
  deferred. Dual GPT/Claude xhigh review found no actionable issues after
  response-shape and request-ID fixes.
- `pr5-device-sync-team-key-commit-cloud`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes
  `/api/v1/sync/keys/initialize/commit` and `/api/v1/sync/keys/rotate/commit`
  restoring the Connect session, resolving the local device ID, sending
  Rust-compatible `x-wf-device-id` headers and snake_case payloads, and parsing
  commit success responses. Dual GPT/Claude xhigh review found no actionable
  issues.
- `pr5-device-sync-reset-team-cloud`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes
  `/api/v1/sync/team/reset` restoring the Connect session, posting
  `/api/v1/sync/team/keys/reset`, omitting `reason` when absent, parsing
  `ResetTeamSyncResponse`, preserving no-session errors, and dual GPT/Claude
  xhigh review finding no actionable issues.
- `pr5-device-sync-issuer-pairing-cloud`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes issuer-side
  `/api/v1/sync/pairing` create, get, approve, and cancel operations restoring
  the Connect session, resolving the local device ID, sending Rust-compatible
  device-scoped pairing endpoints/request IDs, parsing create/get/success
  responses, leaving complete/claimer flows deferred, and dual GPT/Claude xhigh
  review finding no actionable issues.
- `pr5-device-sync-claimer-pairing-cloud`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes
  `/api/v1/sync/pairing/claim` and `/api/v1/sync/pairing/{id}/messages`
  restoring the Connect session, resolving the local device ID, sending
  Rust-compatible device-scoped endpoints/request IDs, parsing claim/message
  responses, leaving confirm/complete flows deferred, and dual GPT/Claude xhigh
  review finding no actionable issues.
- `pr5-device-sync-register-cloud`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes
  `/api/v1/sync/device/register` restoring the Connect session, enrolling via
  `/api/v1/sync/team/devices`, mapping request fields to Rust's
  `RegisterDeviceRequest`, persisting the returned `sync_device_id`, and
  returning Rust-shaped enrollment responses. Dual GPT/Claude xhigh review found
  no actionable issues after persistence-error wrapping.
- `pr5-device-sync-complete-pairing-cloud`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes
  `/api/v1/sync/pairing/{id}/complete` restoring the Connect session, resolving
  the local device ID, sending Rust-compatible complete pairing payloads,
  parsing `CompletePairingResponse`, and deferring post-complete
  background-engine start to the sync-engine slice. Dual GPT/Claude xhigh review
  found no actionable issues.
- `pr5-device-sync-confirm-pairing-cloud`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes
  `/api/v1/sync/pairing/{id}/confirm` restoring the Connect session, resolving
  the local device ID, sending Rust-compatible confirm payloads, parsing
  `ConfirmPairingResponse`, and persisting `minSnapshotCreatedAt` to SQLite when
  available with Rust-compatible timestamp normalization. It also wires
  complete-pairing post-success background-start notification as a non-blocking
  best-effort hook. Dual GPT/Claude xhigh review found no actionable issues
  after the timestamp parser and fire-and-forget hook fixes.
- `pr5-connect-ready-overwrite-approval`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "ready reconcile overwrite|best-effort|reconciles ready state locally|bootstrap requirement|overwrite risk"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  `reconcile-ready-state` retaining approved ready-state overwrite permissions
  across Rust-shaped waiting/error outcomes, bootstrap-overwrite checks masking
  local data while approval is active, approval clearing when bootstrap is no
  longer required, and best-effort approval identity reads when the secret store
  fails.
- `pr5-device-sync-pairing-overwrite-approval`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts -t "overwrite flow|remote snapshot|waiting flow|freshness gate|composite confirm before snapshot bootstrap|begin confirm waits"`,
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  pairing-flow overwrite approval, approval reuse by composite confirm,
  waiting-snapshot flow polling, terminal gated-apply cleanup once a fresh
  snapshot exists, and freshness-gate retention for stale snapshots that do not
  cover the remote cursor.
- `pr5-device-sync-pairing-snapshot-metadata-preflight`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts -t "metadata preflight|freshness gate|waiting flow|remote snapshot"`,
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  requiring Rust-shaped latest snapshot metadata before the explicit apply gate,
  returning update-required errors for newer schema versions, rejecting empty
  snapshot IDs, and preserving freshness-gate waiting behavior.
- `pr5-device-sync-pairing-snapshot-raw-validation`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts -t "metadata preflight|freshness gate|waiting flow|remote snapshot"`,
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  rejecting duplicate latest-snapshot snake/camel alias fields and raw
  float/exponent numeric tokens for Rust integer fields before the explicit
  apply gate.
- `pr5-device-sync-pairing-snapshot-full-shape`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts -t "metadata preflight|freshness gate|waiting flow|remote snapshot"`,
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  requiring the full Rust `SnapshotLatestResponse` field set before the explicit
  apply gate: `snapshot_id`, `schema_version`, `covers_tables`, `created_at`,
  `oplog_seq`, `size_bytes`, and `checksum`, plus raw integer validation for
  `size_bytes`.
- `pr5-device-sync-enroll-raw-validation`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts -t "device registration"`,
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  preserving Rust-shaped register-device cloud requests and secret persistence
  while rejecting duplicate enrollment response aliases and raw float/exponent
  integer tokens before storing `sync_device_id`.
- `pr5-device-sync-initialize-keys-raw-validation`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts -t "initialize team key response|team key phase-one|device reads and mutations"`,
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  preserving BOOTSTRAP/PAIRING_REQUIRED/READY response mapping while rejecting
  duplicate BOOTSTRAP fields, duplicate snake/camel aliases, and raw
  float/exponent integer tokens for Rust `InitializeKeysResult` i32 fields.
- `pr5-device-sync-rotate-keys-raw-validation`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts -t "team key phase-one|rotate|device reads and mutations"`,
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  preserving rotate-team-key response mapping while rejecting duplicate
  `challenge`/`nonce`/`new_key_version` fields or aliases and raw float/exponent
  integer tokens for Rust `RotateKeysResponse.new_key_version`.
- `pr5-device-sync-commit-rotate-keys-raw-validation`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts -t "team key commit|commit rotate|device reads and mutations"`,
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  preserving commit-rotate response mapping while rejecting duplicate
  `success`/`key_version` fields or aliases and raw float/exponent integer
  tokens for Rust `CommitRotateKeysResponse.key_version`.
- `pr5-device-sync-reset-team-raw-validation`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts -t "reset team sync"`,
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  preserving reset-team response mapping while rejecting duplicate
  `success`/`key_version`/`reset_at` fields or aliases and raw float/exponent
  integer tokens for Rust `ResetTeamSyncResponse.key_version`.
- `pr5-device-sync-commit-initialize-keys-raw-validation`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts -t "team key commit"`,
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  preserving commit-initialize response mapping while rejecting duplicate
  `success` and `key_state` fields or aliases for Rust
  `CommitInitializeKeysResponse`.
- `pr5-device-sync-create-pairing-raw-validation`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts -t "issuer pairing"`,
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  preserving create-pairing response mapping while rejecting duplicate
  `pairing_id`/`expires_at`/`key_version`/`require_sas` fields or aliases and
  raw float/exponent integer tokens for Rust
  `CreatePairingResponse.key_version`.
- `pr5-device-sync-get-pairing-raw-validation`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts -t "issuer pairing"`,
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  preserving get-pairing response mapping while rejecting duplicate
  `pairing_id`/`status`/`claimer_device_id`/`claimer_ephemeral_pub`/`expires_at`
  fields or aliases for Rust `GetPairingResponse`.
- `pr5-device-sync-claim-pairing-raw-validation`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts -t "claimer pairing"`,
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  preserving claim-pairing response mapping while rejecting duplicate
  `session_id`/`issuer_ephemeral_pub`/`e2ee_key_version`/`require_sas`/
  `expires_at` fields or aliases and raw float/exponent integer tokens for Rust
  `ClaimPairingResponse.e2ee_key_version`.
- `pr5-device-sync-complete-pairing-raw-validation`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts -t "issuer pairing|composite pairing transfer|claimer pairing|invalid min snapshot"`,
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  preserving issuer/composite complete-pairing response mapping while rejecting
  duplicate `success` and `remote_seed_present` fields or aliases for Rust
  `CompletePairingResponse`.
- `pr5-device-sync-confirm-pairing-raw-validation`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts -t "claimer pairing|invalid min snapshot"`,
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  preserving confirm-pairing response mapping while rejecting duplicate
  `success`/`key_version`/`remote_seed_present` fields or aliases and raw
  float/exponent integer tokens for Rust `ConfirmPairingResponse.key_version`.
- `pr5-device-sync-pairing-messages-raw-validation`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts -t "claimer pairing"`,
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  preserving pairing-messages response mapping while rejecting duplicate
  top-level `session_status` and `messages` fields or aliases for Rust
  `PairingMessagesResponse`.
- `pr5-device-sync-pairing-message-item-raw-validation`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts -t "claimer pairing"`,
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  preserving pairing-message item mapping while rejecting duplicate `id`,
  `payload_type`, `payload`, and `created_at` fields or aliases for Rust
  `PairingMessage`.
- `pr5-device-sync-pairing-success-raw-validation`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts -t "issuer pairing"`,
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  preserving approve/cancel pairing response mapping while rejecting duplicate
  `success` fields for Rust `SuccessResponse`.
- `pr5-device-sync-device-success-raw-validation`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts -t "device reads and mutations"`,
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  preserving update/delete/revoke device response mapping while rejecting
  duplicate `success` fields for Rust `SuccessResponse`.
- `pr5-device-sync-composite-confirm-raw-validation`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts -t "begin confirm needs no bootstrap|composite confirm when bootstrap is not required"`,
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  validating composite confirm cloud responses before bootstrap/no-bootstrap
  branching while preserving already-confirmed retry handling.
- `pr5-device-sync-single-device-raw-validation`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts -t "lists devices|device reads and mutations|current device"`,
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  preserving get/current-device response mapping while rejecting duplicate
  `Device` snake/camel alias fields for Rust `Device`; list-device array raw
  validation remains a follow-up.
- `pr5-device-sync-list-device-raw-validation`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts -t "lists devices|optional fields in cloud device listing|device reads and mutations"`,
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  preserving list-device response mapping while rejecting duplicate `Device`
  snake/camel alias fields in each returned array item.
- `pr5-device-sync-cursor-freshness-raw-validation`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts -t "freshness gate|waiting flow|remote snapshot"`,
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  preserving conservative freshness-gate waiting behavior when cursor responses
  contain malformed `cursor`, `gc_watermark`, or `latest_snapshot` fields,
  including Rust i32/i64 range checks.
- `pr5-connect-device-enroll-raw-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "FRESH device sync|malformed Connect enrollment|legacy device nonce"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  validating raw Connect enrollment responses before storing sync identity or
  initializing keys, preserving valid BOOTSTRAP/PAIR/READY behavior while
  rejecting duplicate aliases and float/exponent i32 tokens.
- `pr5-connect-device-initialize-keys-raw-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "FRESH device sync|malformed Connect initialize|malformed Connect enrollment|legacy device nonce"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  validating raw Connect InitializeKeysResult responses before storing trusted
  key material, preserving valid BOOTSTRAP behavior while rejecting duplicate
  aliases and float/exponent i32 tokens.
- `pr5-connect-device-commit-initialize-raw-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "FRESH device sync|malformed Connect commit initialize|malformed Connect initialize|malformed Connect enrollment|legacy device nonce"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  validating raw Connect CommitInitializeKeysResponse responses before storing
  trusted key material, preserving valid BOOTSTRAP behavior while requiring
  Rust-shaped `success` and `key_state` fields and rejecting duplicate aliases.
- `pr5-connect-device-reset-team-raw-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "reinitializes only after cloud reset succeeds|FRESH device sync|malformed Connect commit initialize|malformed Connect initialize|malformed Connect enrollment|legacy device nonce"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  validating raw Connect ResetTeamSyncResponse responses before clearing or
  replacing local sync identity, requiring Rust-shaped `success` and
  `key_version`, strict optional `reset_at`, duplicate-alias rejection, and raw
  integer-token checks.
- `pr5-connect-device-response-raw-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "malformed Connect device response|reads READY|serializes Connect token restoration"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  validating raw single-device responses before sync-state mapping and rejecting
  duplicate Rust Device snake/camel aliases like serde.
- `pr5-connect-trusted-device-list-raw-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "malformed Connect trusted-device list|malformed Connect device response|reads READY"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  validating raw trusted-device list entries before REGISTERED/ORPHANED
  decisions, strict optional last-seen parsing, and preserving raw-token/parsed
  index alignment across non-object array entries after review found the initial
  desync bypass.
- `pr5-connect-orphan-detection-initialize-raw-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "orphan-detection initialize|malformed Connect trusted-device list|reads READY"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  reusing raw InitializeKeysResult validation for the best-effort ORPHANED probe
  so malformed PAIRING_REQUIRED responses conservatively preserve REGISTERED.
- `pr5-connect-trusted-device-summary-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "trusted device summaries|FRESH device sync|malformed Connect initialize|orphan-detection initialize"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  shared enroll/initialize trusted-device summaries rejecting non-string
  `last_seen_at` values before trusted key material can be stored.
- `pr5-connect-token-refresh-response-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "refresh token response|restores sessions|clears invalid refresh"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  refresh-token success responses rejecting duplicate fields, non-string
  optional refresh tokens, and raw float/exponent `expires_in` tokens before
  rotating the stored refresh token.
- `pr5-connect-token-refresh-error-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "malformed OAuth error|invalid OAuth|clears invalid refresh|refresh token response"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  malformed OAuth refresh error bodies with duplicate/non-string
  `error`/`error_description` fields falling back to raw body text before
  stale-session invalidation.
- `pr5-connect-device-optional-field-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "malformed Connect device response|reads READY"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  the Connect sync-state device mapper rejecting malformed present optional Rust
  `Device` string fields while still accepting the endpoint's subset shape.
- `pr5-connect-trusted-device-list-optional-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "malformed Connect trusted-device list|reads READY"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  best-effort trusted-device list reads rejecting malformed present optional
  Rust `Device` string fields before REGISTERED/ORPHANED decisions.
- `pr5-connect-device-sync-api-error-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "bootstrap snapshot download preflight|bootstrap snapshot download"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  device-sync cloud error bodies with duplicate or malformed structured fields
  falling back to raw request-failed text instead of JSON.parse last-wins
  values.
- `pr5-connect-api-error-response-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "malformed authenticated Connect API error|public subscription plan error|authenticated subscription"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  authenticated Connect API error bodies with duplicate or malformed structured
  fields falling back to status-only errors instead of JSON.parse last-wins
  values.
- `pr5-device-sync-api-error-response-validation`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts -t "device listing cloud failures|runs device reads"`,
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  standalone device-sync cloud error bodies with duplicate/malformed structured
  fields falling back to raw request-failed text instead of JSON.parse last-wins
  values.
- `pr5-connect-user-info-raw-alias-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "entitlement user info|lacks broker sync|duplicate Connect user info"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  authenticated user-info reads rejecting duplicate user/team snake/camel
  aliases and broker-sync entitlement failing closed when subscription aliases
  conflict.
- `pr5-connect-broker-connection-alias-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "duplicate broker connection|syncs broker connections"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  broker connection reads and platform-sync persistence rejecting duplicate
  connection and nested brokerage snake/camel aliases before mapping or writing
  platform rows.
- `pr5-connect-broker-account-alias-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "duplicate broker account|syncs new broker accounts|malformed broker account"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  broker account reads and sync persistence rejecting duplicate account,
  balance, owner, and sync-status aliases before mapping or creating local
  accounts, including `account_type`/`accountType` conflicts found during
  review.
- `pr5-connect-broker-activity-page-alias-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "broker activity page|duplicate page aliases|transaction accounts with empty"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  broker activity sync rejecting duplicate top-level activity-list aliases,
  pagination aliases, and pagination fields before mapper or pagination
  behavior.
- `pr5-connect-broker-activity-pagination-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "duplicate page aliases|transaction accounts with empty|pagination"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  broker activity sync rejecting malformed pagination scalar values and raw
  float/exponent integer tokens for `has_more`/`total`/`limit`/`offset`.
- `pr5-connect-broker-activity-item-alias-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "duplicate page aliases|broker activity page|transaction accounts with empty"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  broker activity page validation rejecting duplicate top-level activity item
  aliases such as `trade_date`/`tradeDate` before mapper logic.
- `pr5-connect-broker-activity-nested-alias-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "duplicate page aliases|broker activity page|transaction accounts with empty"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  broker activity page validation rejecting duplicate nested symbol/option
  aliases such as `raw_symbol`/`rawSymbol` before mapper logic.
- `pr5-connect-broker-activity-mapping-metadata-validation`: verification
  passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "duplicate page aliases|broker activity page|transaction accounts with empty"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  broker activity page validation rejecting duplicate/malformed nested
  `mapping_metadata` fields before review/draft decisions.
- `pr5-connect-broker-activity-scalar-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "duplicate page aliases|broker activity page|transaction accounts with empty"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  broker activity page validation rejecting malformed top-level scalar tokens,
  non-finite parsed numeric values, malformed currency shapes, and duplicate
  `currency.code` before mapper fallback.
- `pr5-connect-broker-activity-nested-scalar-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "duplicate page aliases|skips non-empty broker activity pages|broker activity page|transaction accounts with empty"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  broker activity page validation rejecting malformed nested symbol, option,
  exchange, currency, and symbol-type scalar tokens while preserving Rust serde
  ignored-unknown-field behavior for nested objects.
- `pr5-connect-broker-activity-mapping-metadata-scalar-validation`: verification
  passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "duplicate page aliases|provider-resolved broker activities|skips non-empty broker activity pages|broker activity page|transaction accounts with empty"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  broker activity page validation rejecting malformed
  `mapping_metadata.reasons`, non-object `flow`, and present-null/non-boolean
  `flow.is_external`, while treating camel `isExternal` as a Rust-ignored
  unknown field.
- `pr5-connect-broker-activity-nested-object-shape-validation`: verification
  passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "duplicate page aliases|skips non-empty broker activity pages|broker activity page|transaction accounts with empty"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  broker activity page validation rejecting scalar/array values for struct-typed
  fields such as `symbol`, `option_symbol`, `mapping_metadata`, nested
  exchange/currency/type, and option `underlying_symbol`, while preserving
  missing/null handling.
- `pr5-connect-broker-activity-page-container-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "duplicate page aliases|broker activity page|transaction accounts with empty"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  broker activity page validation rejecting non-object page bodies, non-array
  activity-list fields, non-object activity entries, and malformed pagination
  containers before empty/skip-only fallback.
- `pr5-connect-broker-activity-needs-review-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "pure cash broker activities|duplicate page aliases|skips non-empty broker activity pages|broker activity page|transaction accounts with empty"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  broker activity page validation rejecting present-null/non-boolean
  `needs_review`, defaulting missing values to false, and treating camel
  `needsReview` as Rust-ignored unknown input.
- `pr5-connect-broker-activity-currency-shape-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "duplicate page aliases|skips non-empty broker activity pages|broker activity page|transaction accounts with empty"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  broker activity page validation rejecting scalar/array top-level `currency`
  values, validating `id`/`code`/`name` string fields, and preserving
  missing/null currency handling.
- `pr5-connect-broker-activity-has-more-alias-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "duplicate page aliases|transaction accounts with empty|pagination|broker activity page"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  pagination parsing validating only Rust's `has_more` field while treating
  camel `hasMore` as an ignored unknown field.
- `pr5-connect-broker-activity-is-supported-alias-validation`: verification
  passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "duplicate page aliases|skips non-empty broker activity pages|broker activity page|transaction accounts with empty"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  nested symbol-type parsing validating only Rust's `is_supported` field while
  treating camel `isSupported` as an ignored unknown field.
- `pr5-connect-broker-activity-mapping-metadata-alias-validation`: verification
  passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "duplicate page aliases|skips non-empty broker activity pages|broker activity page|provider-resolved broker activities|transaction accounts with empty"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  broker activity parsing, review decisions, and metadata construction using
  only Rust's `mapping_metadata` field while treating camel `mappingMetadata` as
  an ignored unknown field.
- `pr5-connect-broker-activity-fx-rate-alias-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "duplicate page aliases|skips non-empty broker activity pages|broker activity page|transaction accounts with empty"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  broker activity validation and create-input mapping using only Rust's
  `fx_rate` field while treating camel `fxRate` as an ignored unknown field.
- `pr5-connect-broker-activity-source-key-alias-validation`: verification
  passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "duplicate page aliases|skips non-empty broker activity pages|broker activity page|provider-resolved broker activities|transaction accounts with empty"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  broker activity validation, source-record selection, create-input mapping, and
  metadata construction using only Rust's snake-case source keys while treating
  camel source keys as ignored unknown fields.
- `pr5-connect-broker-activity-provider-external-key-validation`: verification
  passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "duplicate page aliases|skips non-empty broker activity pages|broker activity page|provider-resolved broker activities|transaction accounts with empty"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  broker activity validation, source-system/source-record fallback, comments,
  and metadata construction using only Rust's snake-case provider/external keys
  while treating camel keys as ignored unknown fields.
- `pr5-connect-broker-activity-option-symbol-key-validation`: verification
  passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "duplicate page aliases|skips non-empty broker activity pages|broker activity page|option broker activities|transaction accounts with empty"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  broker activity validation, option activity detection, and metadata
  construction using top-level `option_symbol` plus nested option-symbol
  snake-case fields while treating camel option keys as ignored unknown fields.
- `pr5-connect-broker-activity-symbol-key-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "duplicate page aliases|skips non-empty broker activity pages|broker activity page|provider-resolved broker activities|transaction accounts with empty|crypto broker"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  broker activity validation, symbol/crypto matching, exchange MIC handling, and
  metadata construction using Rust symbol keys (`raw_symbol`, `figi_code`,
  `type`, exchange `mic_code`) while treating camel/unknown symbol keys as
  ignored unknown fields.
- `pr5-connect-broker-activity-raw-option-date-key-validation`: verification
  passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "duplicate page aliases|skips non-empty broker activity pages|broker activity page|option broker activities|transaction accounts with empty"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  broker activity validation and create-input/metadata mapping using Rust
  snake-case `raw_type`, `option_type`, `trade_date`, and `settlement_date`
  fields while treating camel raw/option/date keys as ignored unknown fields.
- `pr5-connect-broker-activity-type-key-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "duplicate page aliases|skips non-empty broker activity pages|broker activity page|transaction accounts with empty|pure cash broker activities|provider-resolved broker activities|option broker activities"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  broker activity validation and create-input mapping using only Rust's JSON
  `type` key while treating `activity_type`/`activityType` as ignored unknown
  fields.
- `pr5-connect-broker-account-type-key-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "broker account aliases|syncs new broker accounts|broker account fields|broker account nested"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  broker account validation, account type inference, and account metadata using
  only Rust's JSON `type` field plus snake-case `raw_type`, while treating
  `account_type`/`accountType`/`rawType` as ignored unknown fields.
- `pr5-connect-broker-account-number-key-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "broker account aliases|syncs new broker accounts|broker account fields|broker account nested"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  broker account validation, account creation, and display-name fallback using
  Rust's `account_number` plus serde alias `number`, while treating camel
  `accountNumber` as an ignored unknown field.
- `pr5-connect-broker-account-legacy-key-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "broker account aliases|syncs new broker accounts|broker account fields|broker account nested"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  broker account validation, new-account info, display-name/platform matching,
  and account metadata construction using snake-case `brokerage_authorization`,
  `institution_name`, and `created_date`, while treating camel legacy metadata
  keys as ignored unknown fields.
- `pr5-connect-broker-account-default-bool-key-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "broker account aliases|syncs new broker accounts|broker account fields|broker account nested"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  broker account validation and metadata construction using snake-case
  `is_paper`, `sync_enabled`, and `shared_with_household`, rejecting present
  null/non-boolean snake values, preserving Rust defaults, and treating camel
  boolean keys as ignored unknown fields.
- `pr5-connect-broker-account-sync-status-key-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "broker account aliases|syncs new broker accounts|broker account fields|broker account nested"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  broker account validation and metadata construction using snake-case
  `sync_status` plus nested snake-case status detail fields, while treating
  camel `syncStatus` and nested camel detail fields as ignored unknown fields.
- `pr5-connect-broker-account-owner-key-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "broker account aliases|syncs new broker accounts|broker account fields|broker account nested"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  broker account validation and metadata construction using Rust owner keys
  (`user_id`, `full_name` plus `user_full_name`, `email`, `avatar_url`, and
  `is_own_account`), rejecting malformed/duplicate known fields, preserving
  default owner booleans, and treating camel owner keys as ignored unknown
  fields.
- `pr5-connect-broker-connection-top-level-key-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "broker connections|connection aliases|connection fields"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  broker connection validation and mapping using Rust intermediate API
  connection fields (`authorization_id`, `brokerage_name`, `brokerage_slug`,
  `updated_at`) in snake case only while treating camel connection keys as
  ignored unknown fields.
- `pr5-connect-broker-connection-brokerage-key-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "broker connections|connection aliases|connection fields|brokerage fields"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  nested brokerage validation and mapping using Rust intermediate API brokerage
  fields (`display_name`, `aws_s3_logo_url`, `aws_s3_square_logo_url`) in snake
  case only while treating camel brokerage keys as ignored unknown fields.
- `pr5-connect-optional-number-finite-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "broker account nested|subscription plan optional|authenticated subscription|user info"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  shared Connect optional-number validation rejecting non-finite parsed values
  such as broker account `balance.total.amount: 1e999` while preserving existing
  malformed-string rejection.
- `pr5-connect-broker-connection-brokerage-object-validation`: verification
  passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "broker connections|connection aliases|connection fields|brokerage fields"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  connection validation rejecting scalar/array `brokerage` values while
  preserving missing/null/object behavior and top-level brokerage fallback.
- `pr5-connect-user-team-alias-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "user info|entitlement user info|authenticated plans"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun test apps/backend/src/runtime.test.ts -t "wires local Connect runtime behavior"`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  user/team info parsing using camelCase Connect API team input fields, ignoring
  malformed snake-case team fields as unknown input, preserving snake-case
  mapped output, and updating the runtime Connect fixture to use the
  Rust-compatible team wire key.
- `pr5-connect-user-info-top-level-alias-validation`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "user info|entitlement user info|authenticated plans"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun test apps/backend/src`, full
  `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage includes
  user info parsing using camelCase Connect API top-level fields, ignoring
  malformed snake-case top-level fields as unknown input, and preserving
  snake-case mapped output.
- `pr5-device-sync-composite-confirm-already-complete`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes
  `confirm-with-bootstrap` reusing the cloud confirm path, tolerating
  already-confirmed/already-completed retries, persisting freshness gates, and
  returning Rust-shaped `already_complete` when bootstrap is not required while
  keeping real bootstrap paths feature-gated.
- `pr5-device-sync-pairing-flow-begin-success`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes pairing
  `flow/begin` reusing cloud confirm, tolerating already-confirmed retries,
  persisting freshness gates, returning Rust-shaped success flow responses when
  bootstrap is not required, and keeping real bootstrap/overwrite flow paths
  feature-gated.
- `pr5-connect-device-sync-state-cloud`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "device sync local service"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes
  `/api/v1/connect/device/sync-state` reading cloud device status for stored
  `sync_identity` device IDs and returning Rust-shaped READY, REGISTERED, STALE,
  and RECOVERY states for safe non-engine cases while preserving FRESH and
  malformed-identity behavior. Dual GPT/Claude xhigh review found no actionable
  issues.
- `pr5-connect-device-enable-existing-state`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "device sync local service"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes
  `/api/v1/connect/device/enable` returning Rust-shaped `EnableSyncResult` for
  existing READY/REGISTERED/STALE sync states while keeping true FRESH/RECOVERY
  enrollment paths feature-gated. Dual GPT/Claude xhigh review found no
  actionable issues.
- `pr5-connect-device-bootstrap-not-ready`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "device sync local service"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes
  `/api/v1/connect/device/bootstrap-snapshot` reading cloud sync state and
  returning Rust-shaped `skipped_not_ready` when the current device is not
  READY, while keeping actual READY snapshot bootstrap feature-gated. Dual
  GPT/Claude xhigh review found no actionable issues after checking the Rust
  HTTP wrapper response shape.
- `pr5-connect-device-generate-snapshot-not-trusted`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "device sync local service"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes
  `/api/v1/connect/device/generate-snapshot` reading cloud device status and
  returning Rust-shaped skipped snapshot responses when the current device is
  not trusted, while keeping actual trusted snapshot generation feature-gated.
  Dual GPT/Claude xhigh review found no actionable issues.
- `pr5-connect-device-sync-state-orphaned`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "device sync local service"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes trusted-device list
  reads gated like Rust, best-effort trusted-device fetch failures,
  initialize-team-key probing when server key version is omitted, and
  Rust-shaped REGISTERED/ORPHANED trusted-device sync-state results.
- `pr5-device-sync-confirm-bootstrap-overwrite-required`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun test apps/backend/src/domains/connect.test.ts -t "device sync local service"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes idempotent cloud
  pairing confirm followed by Rust-shaped `overwrite_required` when bootstrap is
  required, overwrite is not approved, and local syncable rows exist. The local
  overwrite-risk table/filter rules are now shared with Connect bootstrap
  checks. Dual GPT/Claude xhigh review found no actionable issues.
- `pr5-device-sync-pairing-flow-overwrite-required`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes idempotent cloud
  pairing confirm followed by Rust-shaped `overwrite_required` flow state, flow
  state reads, approve remaining explicitly feature-gated before real
  bootstrap/sync-cycle application, cancel removing the flow, Rust-like
  best-effort cloud cancel plus headerless device delete, local identity/device
  ID/session cleanup, and cleanup-failure resilience. Dual GPT/Claude xhigh
  review found and verified fixes for cancel cleanup and delete-header parity.
- `pr5-connect-device-bootstrap-already-complete`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "device sync local service"`,
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes READY
  already-bootstrapped `skipped` responses, best-effort identity-derived device
  config persistence, invalid freshness-gate clearing, valid freshness-gate 501
  fallthrough, and reconcile `WAIT_SNAPSHOT` feature-gated fallthrough. Dual
  GPT/Claude xhigh review found and verified fixes for reconcile gating,
  freshness-gate normalization, and best-effort config persistence.
- `pr5-connect-device-bootstrap-missing-snapshot`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "device sync local service"`,
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes READY
  bootstrap-required 404 + reconcile `NOOP` reset/mark-complete `skipped`
  responses, the completed-local + initial `WAIT_SNAPSHOT` race clearing after a
  second `NOOP`, and destructive-boundary preservation for continuing
  `WAIT_SNAPSHOT` or existing-snapshot paths. Dual GPT/Claude xhigh review found
  and verified the race-path and reset-boundary refinements.
- `pr5-connect-device-bootstrap-empty-snapshot-fallback`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "device sync local service"`,
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes Rust-valid empty
  `/snapshots/latest` metadata plus empty `/events/cursor.latest_snapshot`
  completing bootstrap, cursor fallback snapshots preserving the 501 boundary,
  and malformed snapshot/cursor payloads preserving sync outbox without
  destructive reset. Dual GPT/Claude xhigh review found and verified shape,
  integer range, and cursor `gc_watermark` validator refinements.
- `pr5-connect-device-bootstrap-requested`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "device sync local service"`,
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes active freshness
  gate + missing latest snapshot returning Rust-shaped `requested`, missing
  snapshot classification `WAIT_SNAPSHOT`/`BOOTSTRAP_SNAPSHOT` returning
  Rust-shaped `requested`, and sync outbox preservation in wait paths. Dual
  GPT/Claude xhigh review found no actionable issues.
- `pr5-connect-device-bootstrap-schema-version`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "device sync local service"`,
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes newer snapshot
  schema 500 responses before real apply, Rust-equivalent non-strict UUID cursor
  fallback schema selection, snapshotId-validation cursor fallback support, and
  strict malformed-metadata boundaries that preserve sync outbox. Dual
  GPT/Claude xhigh review found and verified cursor-resolution parity.
- `pr5-connect-device-bootstrap-freshness-gate`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "device sync local service"`,
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes valid freshness
  gates with older latest snapshots returning Rust-shaped `requested`, remote
  cursor coverage preserving the feature-gated apply boundary, sync outbox
  preservation, and invalid latest `created_at` error parity. Dual GPT/Claude
  xhigh review found no actionable issues.
- `pr5-connect-device-bootstrap-download-preflight`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "device sync local service"`,
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes snapshot download
  404 errors, download-header checksum mismatch, latest-metadata checksum
  mismatch, successful download preflight preserving the explicit apply 501, and
  sync outbox preservation. Dual GPT/Claude xhigh review found no actionable
  issues.
- `pr5-connect-device-bootstrap-download-headers`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "device sync local service"`,
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes missing/invalid
  `x-snapshot-schema-version`, missing `x-snapshot-covers-tables`, missing
  `x-snapshot-checksum`, and Rust-shaped `Invalid request` errors before
  checksum comparison. Dual GPT/Claude xhigh review found no actionable issues.
- `pr5-connect-device-pairing-source-status`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "device sync local service"`,
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes untrusted-device
  internal errors, `restore_required` when local cursor is ahead of server,
  `ready` when cursors are aligned, and device/cursor transport failures mapping
  to internal errors. Dual GPT/Claude xhigh review found and verified the
  transport-error mapping fix.
- `pr5-connect-activity-pagination-guard`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "TS Connect local session service"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes repeated first
  activity ID stuck-pagination failure recording, per-account failure summary,
  and mapper-gate precedence when a page has any mappable activity. Dual
  GPT/Claude xhigh review found and verified the mapper-gate ordering fix.
- `pr5-connect-device-generate-snapshot-pre-export`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "device sync local service"`,
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes restore-required
  internal errors when local cursor is ahead of server, latest remote snapshot
  already covering the local cursor returning Rust-shaped `uploaded`, and the
  real export/upload path preserving the explicit 501 gate. Dual GPT/Claude
  xhigh review found no actionable issues.
- `pr5-connect-device-bootstrap-download-http-errors`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "device sync local service"`,
  `bun test apps/backend/src/domains/device-sync.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes non-404 snapshot
  download HTTP failures returning Rust-shaped internal API errors instead of
  the feature gate, plus preservation of existing 404/header/checksum/apply-gate
  behavior. Dual GPT/Claude xhigh review found no actionable issues after the
  non-404 error mapping fix.
- `pr5-connect-device-enrollment-reinitialize`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "device sync"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes FRESH BOOTSTRAP
  enrollment/key commit/identity persistence, PAIR registration without key
  material, legacy identity nonce-before-resume behavior, Connect/device-sync
  shared token-restore coalescing, enable/clear serialization, reinitialize
  reset failure preserving identity, successful reinitialize nonce preservation,
  and RECOVERY re-enrollment. Dual GPT/Claude xhigh review found and verified
  fixes for nonce-before-resume, token restore serialization, clear/enable
  races, and shared Connect/device-sync token-restorer coalescing.
- `pr5-connect-broker-entitlement`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts -t "broker data sync"`,
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun test apps/backend/src/runtime.test.ts -t "local Connect runtime"`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes allowed active
  non-basic plans, basic-plan forbidden responses before connection/account
  fetches, entitlement verification failures mapping to forbidden, and runtime
  smoke behavior. Dual GPT/Claude xhigh review found no actionable issues.
- `pr5-sync-outbox-portfolio-entities`: verification passed:
  `bun test apps/backend/src/sync-outbox.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run test:backend`, full
  `bun run check`, and `git diff --check`. Coverage includes `portfolios` ->
  `portfolio` and `portfolio_accounts` -> `portfolio_account` mapping, outbox
  row persistence, and metadata upserts. Dual GPT/Claude xhigh review found no
  actionable issues.
- `pr5-electron-command-bridge-runtime`: verification passed:
  `bun test apps/electron/src/main/commands.test.ts apps/backend/src/http.test.ts`,
  `bun run --cwd apps/electron type-check`,
  `bun run --cwd apps/backend type-check`, full `bun run type-check`,
  `bun run lint`, and `git diff --check`. Coverage includes Electron
  allowlist/proxy support for portfolio CRUD, scope-based
  holdings/allocation/income query routing across Electron and the backend
  parser, malformed scope rejection before fetch, and a clean
  `bun run dev:electron` startup with renderer and sidecar ready. Dual
  GPT/Claude xhigh review found and verified fixes for the unreachable income
  summary query route and canonical `TOTAL` account routing for dashboard query
  routes and portfolio-history export.
- `pr5-dashboard-account-list-scope`: verification passed:
  `bun test apps/backend/src/domains/holdings.test.ts apps/backend/src/domains/portfolio-metrics.test.ts apps/backend/src/http.test.ts apps/electron/src/main/commands.test.ts`
  plus `bun run --cwd apps/backend test`, `bun run --cwd apps/electron test`,
  full `bun run type-check`, `bun run format:check`, `bun run lint`, and
  `git diff --check`. Coverage includes portfolio and multi-account dashboard
  scopes resolving to account IDs, account-list aggregation for holdings,
  allocations, allocation drill-down, and income summaries, Rust-compatible
  merged holding rows by asset/cash key with source account IDs, aggregate
  holding weight recalculation across selected accounts, and Electron preserving
  portfolio scope payloads through the sidecar bridge. Dual GPT/Claude xhigh
  review found and verified fixes for Electron/backend Portfolio discriminant
  casing, merged account-list holdings, and empty account-scope guards that
  prevent portfolio or multi-account filters from broadening to all accounts.
- `pr5-addon-exact-main-resolution`: verification passed:
  `bun test apps/backend/src/domains/addons.test.ts`,
  `bun run --cwd apps/backend test`, full `bun run type-check`,
  `bun run format:check`, `bun run lint`, and `git diff --check`. Coverage
  includes ZIP packages using the manifest directory as the package root, exact
  `manifest.main` entry matching instead of suffix matching, and local runtime
  loading no longer marking nested files with the same basename as additional
  main files. Dual GPT/Claude xhigh review found no blocking issues and prompted
  a compatibility refinement for already-installed legacy package-prefixed
  add-ons when the package root is unambiguous.
- `pr5-holdings-lots-read-model`: verification passed:
  `bun test apps/backend/src/domains/holdings.test.ts apps/backend/src/http.test.ts`
  plus `bun run --cwd apps/backend test`, full `bun run type-check`,
  `bun run format:check`, `bun run lint`, and `git diff --check`. Coverage
  includes `/api/v1/holdings/lots` delegating through the holdings service,
  transaction lot rows from `lots`, option contract multiplier parity, nonzero
  ratio fallbacks for split ratios and snapshot-position contract multipliers,
  optional latest HOLDINGS-mode `snapshot_positions` rows, and JSON fallback for
  snapshots that predate relational positions. Electron command parity now
  proxies `get_asset_lots` through the sidecar. Dual GPT/Claude xhigh review
  found and verified fixes for option multiplier metadata, nonzero ratio parity,
  bytewise sort parity, and missing Electron command registration.
- `pr5-addon-store-ratings-read`: verification passed:
  `bun test apps/backend/src/domains/addons.test.ts apps/backend/src/http.test.ts apps/electron/src/main/commands.test.ts`,
  `bun run --cwd apps/backend test`, `bun run --cwd apps/electron test`, full
  `bun run type-check`, `bun run format:check`, `bun run lint`, and
  `git diff --check`. Coverage includes `GET /addons/store/ratings` validating
  `addonId`, calling the store ratings endpoint through
  `AddonService.getRatings`, accepting array or `{ ratings }` responses,
  surfacing malformed ratings payloads, and preserving Electron/web command
  query routing.
- `pr5-electron-data-file-export`: verification passed:
  `bun test apps/electron/src/main/commands.test.ts`,
  `bun run --cwd apps/frontend test --run src/adapters/electron/exports.test.ts src/adapters/electron/files.test.ts`,
  `bun run --cwd apps/electron test`, full `bun run type-check`,
  `bun run format:check`, `bun run lint`, and `git diff --check`. Coverage
  includes Electron main fetching non-JSON export bytes from
  `/utilities/export/{data}/{format}`, preserving filename/empty-export
  semantics, renderer-side native save dialog integration, and cancellation
  returning a non-saved result.
- `pr5-electron-app-info-sidecar`: verification passed:
  `bun test apps/electron/src/main/commands.test.ts` and
  `bun run --cwd apps/frontend test --run src/adapters/electron/settings.test.ts`,
  plus full `bun run type-check`, `bun run format:check`, `bun run lint`, and
  `git diff --check`. Coverage includes Electron IPC registration for
  `get_app_info`, Electron main proxying `/api/v1/app/info`, and the Electron
  settings adapter returning TS sidecar app-info paths instead of placeholder
  empty paths.
- `pr5-electron-device-sync-command-map`: verification passed:
  `bun test apps/electron/src/main/commands.test.ts` and full
  `bun run type-check`, `bun run format:check`, `bun run lint`, and
  `git diff --check`. Coverage includes Electron IPC and command proxy mappings
  for `register_device`, `initialize_team_keys`, `commit_initialize_team_keys`,
  `rotate_team_keys`, and `commit_rotate_team_keys`, matching existing TS
  sidecar routes while keeping deeper cloud/runtime behavior gated in the
  backend service. Recent review also verified backend-contracts command-surface
  guardrails were refreshed for the newly shared commands and Electron-only
  `export_data_file`.
- `pr5-web-csv-file-picker`: verification passed:
  `bun run --cwd apps/frontend test --run src/adapters/web/files.test.ts` and
  `bun run --cwd apps/frontend type-check`, plus `bun run format:check`,
  `bun run lint`, and `git diff --check`. Coverage initially added web CSV
  selection via hidden file input, CSV extension/MIME validation, text content
  loading, cancel/focus cleanup, and existing add-on ZIP picker behavior. Later
  review found this violated the add-on file-path contract, so the shared web
  `openCsvFileDialog` path API now rejects instead of returning fake path
  strings; browser CSV import continues to use its own file-input flow.
- `pr5-web-settings-failure-surfacing`: verification passed:
  `bun run --cwd apps/frontend test --run src/adapters/web/settings.test.ts`,
  `bun run type-check`, `bun run format:check`, `bun run lint`, and
  `git diff --check`. Coverage includes web `getSettings` and `getAppInfo`
  surfacing backend failures instead of returning empty placeholder data.
- `pr5-web-settings-review-fixes`: dual GPT/Claude xhigh review found
  retry/contract issues; verification passed:
  `bun run --cwd apps/frontend test --run src/pages/layouts/app-layout.test.tsx src/adapters/web/files.test.ts src/adapters/web/settings.test.ts`,
  `bun run type-check`, `bun run format:check`, `bun run lint`, and
  `git diff --check`. Coverage includes retryable settings-load error UI,
  About-page app-info rejection handling, web CSV dialog path-contract
  enforcement, and web file-save error surfacing.
- `pr5-settings-auto-update-failure-surfacing`: verification passed:
  `bun run --cwd apps/frontend test --run src/adapters/web/settings.test.ts src/adapters/electron/settings.test.ts`,
  `bun run type-check`, `bun run format:check`, `bun run lint`, and
  `git diff --check`. Coverage includes web/Electron auto-update preference
  reads surfacing backend/sidecar failures instead of defaulting to enabled.
- `pr5-alpha-vantage-option-resolve`: verification passed:
  `bun test apps/backend/src/domains/market-data.test.ts --test-name-pattern "Alpha Vantage"`,
  full `bun test apps/backend/src/domains/market-data.test.ts`,
  `bun run type-check`, `bun run format:check`, `bun run lint`, and
  `git diff --check`. Coverage includes preferred-provider OPTION quote
  resolution through Alpha Vantage `REALTIME_OPTIONS`, underlying/OCC contract
  routing, latest quote parsing, and keeping historical option sync
  intentionally unsupported like Rust.
- `pr5-quote-resolve-error-surfacing`: verification passed:
  `bun run --cwd apps/frontend test --run src/adapters/shared/market-data.test.ts src/pages/activity/components/forms/fields/__tests__/symbol-search.test.tsx`,
  `bun run type-check`, `bun run format:check`, `bun run lint`, and
  `git diff --check`. Coverage includes shared `resolveSymbolQuote` surfacing
  backend failures and the activity import grid catching unavailable quote
  confirmation explicitly.
- `pr5-connect-ready-reconcile-local-bootstrap`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts --test-name-pattern "reconciles"`,
  full `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run type-check`, `bun run format:check`, `bun run lint`, and
  `git diff --check`. Coverage includes `/connect/device/reconcile-ready-state`
  reading full local/cloud sync state, returning Rust-shaped error and
  skipped-not-ready responses, and reporting skipped bootstrap action/status
  when local bootstrap is already complete.
- `pr5-device-sync-request-id-scope`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts --test-name-pattern "READY, REGISTERED"`,
  `bun run type-check`, `bun run format:check`, `bun run lint`, and
  `git diff --check`. Coverage includes preserving Rust app-scoped request IDs
  for device get/list reads while retaining device-scoped request IDs on
  team-key/event/cursor/snapshot paths that pass a device ID.
- `pr5-ts-database-url-fallback-removal`: verification passed:
  `bun test apps/backend/src/storage/sqlite.test.ts apps/backend/src/runtime.test.ts --test-name-pattern "database path|runtime data"`,
  `bun run --cwd apps/backend type-check`, `bun run format:check`,
  `bun run lint`, `git diff --check`, and full `bun run check`. Coverage
  includes TS backend runtime and SQLite storage ignoring Rust-era
  `DATABASE_URL` and using `WF_DB_PATH` or app-data defaults only.
- `pr5-wf-db-path-directory-support`: verification passed:
  `bun test apps/backend/src/storage/sqlite.test.ts apps/backend/src/runtime.test.ts --test-name-pattern "database path|runtime data"`,
  `bun run --cwd apps/backend type-check`, `bun run format:check`,
  `bun run lint`, and `git diff --check`. Coverage includes `WF_DB_PATH`
  accepting directory-style values and resolving them to `<dir>/app.db`,
  matching README and `.env.web.example` configuration semantics.
- `pr5-addon-store-staging-validation`: verification passed:
  `bun test apps/backend/src/domains/addons.test.ts --test-name-pattern "staging"`,
  full `bun test apps/backend/src/domains/addons.test.ts`, `bun run type-check`,
  `bun run format:check`, `bun run lint`, and `git diff --check`. Coverage
  includes store-downloaded ZIPs being signature-checked and fully
  extracted/validated before writing to staging, so invalid packages do not
  leave staged files behind.
- `pr5-addon-query-cache-facade`: verification passed:
  `bun run --cwd apps/frontend test --run src/addons/addons-runtime-context.test.ts src/addons/type-bridge.test.ts`,
  `bun run --cwd apps/frontend type-check`,
  `bun run --cwd packages/addon-sdk type-check`, `bun run format:check`,
  `bun run lint`, and `git diff --check`. Coverage includes add-on `getClient()`
  returning a limited invalidate/refetch facade instead of the raw app
  QueryClient, plus SDK source comments matching the restricted runtime
  contract.
- `pr5-addon-query-cache-facade-types`: verification passed:
  `bun run --cwd packages/addon-sdk type-check`,
  `bun run --cwd apps/frontend type-check`,
  `bun run --cwd apps/frontend test --run src/addons/addons-runtime-context.test.ts src/addons/type-bridge.test.ts`,
  `bun run format:check`, `bun run lint`, and `git diff --check`. Coverage
  includes the SDK exporting a typed `QueryCacheFacade` and the frontend
  type-bridge matching the limited query cache runtime contract.
- `pr5-addon-query-cache-global-hardening`: GPT xhigh review found the full
  React Query client was still globally reachable; verification passed:
  `bun run --cwd apps/frontend test -- addons-runtime-context.test.ts --run`,
  direct `bun test apps/frontend/src/addons/addons-runtime-context.test.ts`,
  `bun run type-check`, `bun run format:check`, `bun run lint`, and
  `git diff --check`. The host QueryClient is now registered in module scope for
  the add-on runtime facade instead of exposed on `window`; the broader
  `docs/addons/shared-query-client-design.md` refresh remains approval-gated.
- `pr5-e2e-bun-backend-port-alignment`: verification passed:
  `node --check scripts/run-e2e.mjs`,
  `bash -n scripts/wait-for-both-servers-to-be-ready.sh`,
  `bun run format:check`, `bun run lint`, and `git diff --check`. Coverage
  includes E2E waiting for the Bun web backend default port `8080`, matching
  `dev:web`.
- `pr5-asset-provider-hints-refresh`: verification passed:
  `bun run --cwd apps/frontend type-check`, `bun run format:check`,
  `bun run lint`, and `git diff --check`. Coverage includes replacing stale
  CoinGecko/TwelveData asset override placeholders with examples for the current
  built-in providers exposed by the TS backend.
- `pr5-backend-timeout-default-guard`: verification passed:
  `bun test apps/backend/src/config.test.ts --test-name-pattern "timeout"`,
  `bun run --cwd apps/backend type-check`, `bun run format:check`,
  `bun run lint`, and `git diff --check`. Coverage includes pinning the TS
  backend's default request timeout to the Rust-compatible 300 seconds.
- `pr5-review-addon-dbpath-requestid-fixes`: GPT xhigh review found guard gaps;
  verification passed:
  `bun test apps/backend/src/domains/addons.test.ts --test-name-pattern "staging|manifest id"`,
  `bun test apps/backend/src/storage/sqlite.test.ts apps/backend/src/runtime.test.ts --test-name-pattern "database path|runtime data"`,
  `bun test apps/backend/src/domains/connect.test.ts --test-name-pattern "READY, REGISTERED"`,
  `bun run type-check`, `bun run format:check`, `bun run lint`, and
  `git diff --check`. Coverage includes add-on store/staging manifest-id
  binding, preserving extensionless `WF_DB_PATH` file paths unless the path is
  an explicit/existing directory, and endpoint-specific Connect request-id scope
  assertions.
- `pr5-connect-broker-cash-activity-sync`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts --test-name-pattern "pure cash"`,
  full `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run type-check`, `bun run format:check`, `bun run lint`, and
  `git diff --check`. Coverage includes pure cash broker activity pages mapping
  to activity bulk creates, broker sync state success, imported-activity counts,
  and preserving the feature gate for asset-backed broker activity mapping.
- `pr5-connect-broker-cash-duplicate-overlap`: Claude xhigh review found an
  overlap-window duplicate failure; verification passed:
  `bun test apps/backend/src/domains/connect.test.ts --test-name-pattern "already imported pure cash"`,
  full `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run type-check`, `bun run format:check`, `bun run lint`, and
  `git diff --check`. Coverage includes explicit broker idempotency keys and
  prefiltering already-imported broker cash activities before bulk mutation.
- `pr5-connect-broker-unknown-cash-drafts`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts --test-name-pattern "unknown broker|pure cash|already imported pure cash"`,
  full `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run type-check`, `bun run format:check`, `bun run lint`, and
  `git diff --check`. Coverage includes explicit `UNKNOWN` broker activities
  without symbols being imported as draft/review cash activities while
  missing-type broker records remain feature-gated.
- `pr5-connect-broker-cash-duplicate-error-fallback`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts --test-name-pattern "duplicate broker cash|already imported pure cash"`,
  full `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run type-check`, `bun run format:check`, `bun run lint`, and
  `git diff --check`. Coverage includes treating duplicate broker cash bulk
  errors as benign when duplicate prefiltering is unavailable, while preserving
  account failure for non-duplicate import errors.
- `pr5-connect-broker-existing-asset-activities`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts --test-name-pattern "asset-backed broker"`,
  full `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run type-check`, `bun run format:check`, `bun run lint`, and
  `git diff --check`. Coverage includes asset-backed broker activities mapping
  to existing local assets by broker symbol, preserving idempotency/source
  metadata, and keeping missing/new asset broker resolution gated.
- `pr5-connect-broker-option-existing-asset-coverage`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts --test-name-pattern "option broker|asset-backed broker"`,
  `bun run --cwd apps/backend type-check`, `bun run format:check`,
  `bun run lint`, and `git diff --check`. Coverage includes broker option
  activities compacting padded OCC tickers and mapping them to existing local
  option assets.
- `pr5-connect-broker-unknown-asset-guard`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts --test-name-pattern "asset-backed broker|option broker"`,
  `bun run --cwd apps/backend type-check`, `bun run format:check`,
  `bun run lint`, and `git diff --check`. Coverage includes keeping asset-backed
  broker activities feature-gated when their symbol does not match an existing
  local asset.
- `pr5-connect-broker-real-payload-parity`: GPT xhigh review found real Connect
  broker payload and duplicate gaps; verification passed:
  `bun test apps/backend/src/domains/connect.test.ts --test-name-pattern "broker activities|broker cash|asset-backed broker|option broker"`,
  full `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run format:check`,
  `bun run lint`, and `git diff --check`. Coverage includes real `type`
  payloads, explicit broker review flags, Rust-compatible review
  confidence/reason thresholds, source-record fallbacks, and skipping Rust-era
  broker activities matched by source identity before bulk mutation.
- `pr5-connect-broker-missing-type-unknown`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts --test-name-pattern "feature-gated|aliases|mapper gate|missing broker activity types"`,
  full `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run format:check`,
  `bun run lint`, and `git diff --check`. Coverage includes broker activities
  without a `type` importing as `UNKNOWN` review drafts when no symbol is
  present, matching Rust's default activity type, while unsupported
  symbol-bearing broker activities remain mapper-gated.
- `pr5-connect-broker-metadata-parity`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts --test-name-pattern "asset-backed broker|option broker"`,
  full `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run format:check`,
  `bun run lint`, and `git diff --check`. Coverage includes Rust-shaped broker
  metadata fields for mapping confidence/reasons/flow, provider/source identity,
  source group/external references, institution, symbol identity, and option
  leg/ticker/underlying metadata while preserving the existing broker source
  marker.
- `pr5-connect-broker-yahoo-suffix-symbols`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts --test-name-pattern "Yahoo suffix|asset-backed broker|option broker"`,
  full `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run format:check`,
  `bun run lint`, and `git diff --check`. Coverage includes threading exchange
  metadata into Connect broker sync and stripping known Yahoo exchange suffixes
  before existing-asset lookup, while preserving option OCC and crypto
  normalization paths.
- `pr5-connect-broker-crypto-symbol-coverage`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts --test-name-pattern "crypto broker|Yahoo suffix|asset-backed broker"`,
  full `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run format:check`,
  `bun run lint`, and `git diff --check`. Coverage includes broker
  cryptocurrency symbols such as `BTC-USD` matching existing local crypto assets
  by base symbol before bulk activity mutation.
- `pr5-connect-broker-blank-symbol-fallback`: Claude xhigh review found blank
  broker `raw_symbol` values could block crypto fallback; verification passed:
  `bun test apps/backend/src/domains/connect.test.ts --test-name-pattern "crypto broker|Yahoo suffix|asset-backed broker"`,
  full `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run format:check`,
  `bun run lint`, and `git diff --check`. Coverage includes blank/whitespace
  broker `raw_symbol` values falling through to symbol-pair or Yahoo-suffix
  normalization instead of failing the account sync.
- `pr5-connect-broker-symbol-review-fixes`: GPT xhigh review found exchange and
  hyphenated-crypto symbol gaps; verification passed:
  `bun test apps/backend/src/domains/connect.test.ts --test-name-pattern "crypto broker|Yahoo suffix|suffixed broker|asset-backed broker"`,
  full `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run format:check`,
  `bun run lint`, and `git diff --check`. Coverage includes using Yahoo suffix
  MICs to choose the matching local listed asset, keeping suffixed broker
  symbols gated when only another exchange is local, and parsing crypto pairs
  from the last hyphen so symbols like `X-AI-USD` map to `X-AI`.
- `pr5-connect-broker-security-transfer-existing-asset`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts --test-name-pattern "security transfer|asset-backed broker|pure cash"`,
  full `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run format:check`,
  `bun run lint`, and `git diff --check`. Coverage includes
  `TRANSFER_IN`/`TRANSFER_OUT` broker activities with symbols mapping to
  existing local assets while symbol-less transfers continue through the cash
  path.
- `pr5-connect-broker-review-followups`: GPT/Claude xhigh review found broker
  symbol edge cases; verification passed:
  `bun test apps/backend/src/domains/connect.test.ts --test-name-pattern "blank broker symbols|crypto broker|asset-backed broker"`,
  full `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run format:check`,
  `bun run lint`, and `git diff --check`. Coverage includes broker raw-symbol
  exchange MIC disambiguation, crypto raw-symbol pair normalization, and
  blank/whitespace broker symbols on cash-like transfers routing to the cash
  path instead of failing account sync.
- `pr5-connect-broker-asset-backed-interest`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts --test-name-pattern "asset-backed interest|security transfer|pure cash|unknown broker"`,
  full `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run format:check`,
  `bun run lint`, and `git diff --check`. Coverage includes symbol-bearing
  broker `INTEREST` activities mapping to existing local assets while
  symbol-less interest remains on the cash path.
- `pr5-connect-broker-dividend-existing-asset`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts --test-name-pattern "dividend broker|asset-backed broker|asset-backed interest|security transfer"`,
  full `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run format:check`,
  `bun run lint`, and `git diff --check`. Coverage includes broker `DIVIDEND`
  activities mapping to existing local assets through the same bounded
  existing-asset broker path.
- `pr5-connect-broker-income-review-fixes`: GPT xhigh review found income mapper
  edge cases; verification passed:
  `bun test apps/backend/src/domains/connect.test.ts --test-name-pattern "symbol-less dividend|asset-backed interest|dividend broker|pure cash|blank broker symbols"`,
  full `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run format:check`,
  `bun run lint`, and `git diff --check`. Coverage includes blank raw symbols
  falling through to later broker symbol candidates and symbol-less broker
  `DIVIDEND` activities importing as cash income instead of failing sync.
- `pr5-connect-broker-blank-raw-interest-coverage`: Claude xhigh review called
  out the blank-raw/populated-symbol income case; verification passed:
  `bun test apps/backend/src/domains/connect.test.ts --test-name-pattern "blank raw|symbol-less dividend|asset-backed interest"`,
  full `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run format:check`,
  `bun run lint`, and `git diff --check`. Coverage includes broker `INTEREST`
  activities with blank `raw_symbol` and populated crypto pair symbols retaining
  asset-backed mapping.
- `pr5-connect-broker-adjustment-optional-asset`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts --test-name-pattern "adjustment broker|symbol-less dividend|asset-backed interest"`,
  full `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend type-check`, `bun run format:check`,
  `bun run lint`, and `git diff --check`. Coverage includes broker `ADJUSTMENT`
  activities importing as cash when symbol-less and mapping to existing local
  assets when a symbol is present.
- `pr5-rust-server-config-test-fixture`: verification passed:
  `cargo test -p wealthfolio-server --test income_summary_api` and full
  `cargo test`. Coverage includes updating the Rust server income-summary API
  test fixture for the current `Config` shape with explicit `sidecar: None`, so
  Rust oracle tests compile during migration validation.
- `pr5-e2e-runner-ts-backend-readiness`: verification passed:
  `node --check scripts/run-e2e.mjs`, `bun run --cwd apps/frontend type-check`,
  `bun run --cwd apps/frontend lint -- src/components/update-dialog.tsx`,
  `bun run check`, `cargo test`, and `bun run test:e2e` progressing into the
  Playwright suite. Coverage includes probing the TS backend via
  `http://127.0.0.1:8080/api/v1/healthz` and suppressing the update dialog only
  under the E2E Vite flag so it cannot intercept Playwright clicks. Remaining
  E2E failures are functional migration gaps, not startup/update-dialog
  blockers.
- `pr5-alpha-vantage-option-mark-fallback`: GPT xhigh review found a zero-last
  regression; verification passed:
  `bun test apps/backend/src/domains/market-data.test.ts --test-name-pattern "Alpha Vantage option"`,
  full `bun test apps/backend/src/domains/market-data.test.ts`,
  `bun run type-check`, `bun run format:check`, `bun run lint`, and
  `git diff --check`. Coverage includes Alpha Vantage option quotes treating
  zero `last` prices as missing and falling back to nonzero `mark`.
- `pr5-e2e-fixture-import-holdings-parity`: verification passed: targeted
  backend activity/market-data/holdings/http tests, the frontend import-mutation
  hook test, targeted multi-exchange E2E, full `bun run test:e2e` (88/88), full
  `bun run test:all`, and full `bun run check`. Coverage includes E2E
  fixture-backed Yahoo search, resolve, and history with exact-symbol precedence
  over aliases, exchange-qualified import preview preservation, pending-asset
  reuse during import apply, FX asset conflict recovery, activity import
  flushing domain events before returning success, live holdings lot projection
  from snapshot positions, and frontend query invalidation for import-driven
  holdings/portfolio refreshes.
- `pr5-e2e-fixture-import-review-fixes`: dual GPT/Claude xhigh review follow-up
  verification passed: affected backend activity/market-data/holdings tests,
  targeted asset-backed-income and multi-exchange E2E, full `bun run check`, and
  dual GPT/Claude xhigh re-review. Coverage includes quote-currency/type-safe
  pending-asset reuse fallback for FX/crypto imports, fixture-mode symbol search
  avoiding live provider fallbacks, and Rust-like detailed-only holding lots.
- `pr5-connect-broker-provider-backed-assets`: verification passed:
  `bun test apps/backend/src/domains/connect.test.ts`,
  `bun run --cwd apps/backend test`, full `bun run check`, and dual GPT/Claude
  xhigh review/refine. Coverage includes exact symbol+MIC provider matching,
  Yahoo suffix normalization for raw broker symbols like `SHOP.TO`, per-symbol
  search memoization within broker sync, activity-created provider asset
  payloads, created asset summary accounting via an internal non-enumerable bulk
  result marker, existingAssetId provider search reuse for suffixed symbols, and
  continued feature-gating for unresolved broker assets.
- `pr5-device-sync-complete-pairing-transfer`: verification passed:
  `bun test apps/backend/src/domains/device-sync.test.ts apps/backend/src/runtime.test.ts --test-name-pattern "device sync|pairing"`,
  `bun run --cwd apps/backend test`, full `bun run check`, and dual GPT/Claude
  xhigh review. Coverage includes composite sync-identity/session preconditions,
  Rust-compatible device-scoped complete-pairing cloud request payloads,
  complete response mapping, best-effort pairing-complete callback behavior, and
  retained bootstrap confirm/apply feature gates.
- `pr5-device-sync-begin-pairing-no-db`: verification passed: focused
  begin-pairing device-sync tests, pairing/runtime tests, full `bun run check`,
  and dual GPT/Claude xhigh review. Coverage includes sync-identity/session
  preconditions, cloud confirm request shape, success flow response when no
  local DB/bootstrap state exists, and preserved confirm error propagation.
- `pr5-device-sync-bootstrap-confirm-no-db`: verification passed: focused
  bootstrap-confirm device-sync tests, pairing/runtime tests, full
  `bun run check`, and dual GPT/Claude xhigh review. Coverage includes cloud
  confirm request shape, Rust-shaped `already_complete` response when no local
  DB/bootstrap state exists, and retained local DB
  already-complete/overwrite-required branches.
- `pr5-connect-broker-unknown-asset-backed`: verification passed: focused/full
  Connect tests, backend suite, full `bun run check`, and dual GPT/Claude xhigh
  review. Coverage includes symbol-bearing missing/UNKNOWN type broker
  activities importing as asset-backed `UNKNOWN` draft/review activities through
  existing/provider-backed asset resolution while preserving no-symbol unknown
  cash draft behavior.
- `pr5-connect-trigger-cycle-not-ready`: verification passed: focused/full
  Connect tests, backend suite, full `bun run check`, and dual GPT/Claude xhigh
  review/refine. Coverage includes state read before trigger-cycle execution,
  `not_ready` results for non-READY states, untrusted device-config persistence
  with stale bootstrap timestamps cleared, and retained READY sync-engine
  feature gate.
- `pr5-connect-background-engine-preconditions`: verification passed:
  focused/full Connect tests, full `bun run check`, and dual GPT/Claude xhigh
  review. Coverage includes explicit skipped responses when sync identity,
  session, or state are not ready, and retained READY-state background-engine
  feature gate.
- `pr5-connect-broker-provider-crypto-assets`: verification passed: focused/full
  Connect tests, full `bun run check`, and dual GPT/Claude xhigh review.
  Coverage includes provider-backed crypto pair results like `BTC-USD` matching
  broker base symbols and creating CRYPTO activity-owned asset payloads.
- `pr5-asset-e2e-fixture-profile-enrichment`: verification passed: focused
  assets and market-data backend tests, backend type-check, full
  `bun run check`, pre-commit checks, and dual GPT/Claude xhigh review/refine.
  Coverage includes E2E fixture-backed Yahoo profile enrichment without live
  fetches, synthetic FX fixture profiles, exact-symbol precedence over colliding
  aliases such as `APC`/`APC.DE`, fixture country metadata for region
  classification, and fixture misses failing without falling through to live
  Yahoo.
- `pr5-connect-trigger-cycle-ready-noop`: verification passed: focused
  Connect/device-sync tests, backend type-check, full `bun run check`, backend
  suite, pre-commit checks, and dual GPT/Claude xhigh review/refine. Coverage
  includes READY + reconcile `NOOP` + empty due pending outbox returning
  Rust-shaped `ok`, trusted device-config persistence, successful cycle
  `consecutive_failures` reset, and pending outbox retaining the sync-engine
  feature gate.
- `pr5-connect-trigger-cycle-wait-snapshot`: verification passed: focused
  Connect/device-sync tests, backend type-check, full `bun run check`, backend
  suite, pre-commit checks, and dual GPT/Claude xhigh review. Coverage includes
  READY + reconcile `WAIT_SNAPSHOT` returning Rust-shaped `wait_snapshot`,
  30-second retry scheduling, preserving existing engine error/failure fields,
  and avoiding the gated push/pull engine.
- `pr5-connect-trigger-cycle-bootstrap-snapshot`: verification passed: focused
  Connect/device-sync tests, backend type-check, full `bun run check`, backend
  suite, pre-commit checks, and dual GPT/Claude xhigh review. Coverage includes
  READY + reconcile `BOOTSTRAP_SNAPSHOT` returning Rust-shaped `stale_cursor`,
  clearing retry timing, preserving existing engine error/failure fields, and
  carrying bootstrap snapshot id/sequence metadata while avoiding gated
  push/pull.
- `pr5-connect-trigger-cycle-idle-pull-tail`: verification passed: focused
  Connect/device-sync tests, backend type-check, full `bun run check`, backend
  suite, pre-commit checks, and dual GPT/Claude xhigh review. Coverage includes
  READY + reconcile `PULL_TAIL` with server cursor already at/before local
  cursor and no due pending outbox returning Rust-shaped `ok`, simulated
  cycle-lock acquisition, success error/failure clearing, and
  cursor-advanced/pending paths retaining the push/pull feature gate.
- `pr5-connect-trigger-cycle-pull-tail-default-cursor`: verification passed:
  focused Connect/device-sync tests, backend type-check, full `bun run check`,
  backend suite, pre-commit checks, and dual GPT/Claude xhigh review. Coverage
  includes missing reconcile cursor defaulting to `0` like Rust before the idle
  `PULL_TAIL` check, while cursor-advanced and pending paths remain gated.
- `pr5-connect-trigger-cycle-cursor-token-validation`: verification passed:
  focused Connect/device-sync tests, backend type-check, full `bun run check`,
  backend suite, pre-commit checks, and dual GPT/Claude xhigh review/refine.
  Coverage includes malformed non-null cursor tokens such as strings and raw
  JSON floats staying gated, while missing/null cursors keep Rust-compatible `0`
  defaults for idle `PULL_TAIL`.
- `agent-runtime-guidance-refresh`: verification passed: formatting check, full
  `bun run check`, pre-commit checks, and dual GPT/Claude xhigh review/refine.
  Coverage includes `AGENTS.md` and `.claude/CLAUDE.md` describing
  `apps/backend` as the current Bun TypeScript backend runtime,
  `apps/server`/`crates` as legacy Rust/Axum parity references, and shared Rust
  migrations as the active schema source.
- `pr5-connect-reconcile-snapshot-ref-validation`: verification passed: focused
  Connect/device-sync tests, backend type-check, full `bun run check`, backend
  suite, pre-commit checks, and dual GPT/Claude xhigh review/refine. Coverage
  includes required `latest_snapshot`/`latestSnapshot` snapshot id, schema
  version, and oplog sequence fields; duplicate cursor/snapshot fields; raw JSON
  float numeric tokens; and action-only helper invalidation before bootstrap
  no-op decisions.
- `pr5-connect-reconcile-action-validation`: verification passed: focused
  Connect/device-sync tests, backend type-check, full `bun run check`, backend
  suite, pre-commit checks, and dual GPT/Claude xhigh review/refine. Coverage
  includes requiring exactly one string `action` in reconcile responses and
  keeping duplicate/missing/malformed action payloads gated before trigger-cycle
  and bootstrap action-only decisions.
- `pr5-connect-latest-snapshot-metadata-validation`: verification passed:
  focused Connect/device-sync tests, backend type-check, full `bun run check`,
  backend suite, pre-commit checks, and dual GPT/Claude xhigh review/refine.
  Coverage includes `/sync/snapshots/latest` and cursor fallback
  `latest_snapshot` metadata raw-token validation, duplicate snake/camel alias
  field rejection, raw float/exponent numeric token rejection, and preserving
  genuinely missing/null cursor latest snapshots.
- `pr5-connect-cursor-response-metadata-validation`: verification passed:
  focused Connect/device-sync tests, backend type-check, full `bun run check`,
  backend suite, pre-commit checks, and dual GPT/Claude xhigh review/refine.
  Coverage includes applying raw cursor response validation to pairing-source
  status, generate-snapshot preflight, and cursor-latest fallback paths,
  including optional `gcWatermark`/`gc_watermark` integer/null token validation.
- `pr5-device-sync-composite-confirm-waiting-snapshot`: verification passed:
  focused device-sync tests, backend type-check, full `bun run check`, backend
  suite, pre-commit checks, and dual GPT/Claude xhigh review. Coverage includes
  `confirmPairingWithBootstrap` returning Rust-shaped `waiting_snapshot` after
  cloud confirm and overwrite approval when `/sync/snapshots/latest` is 404,
  while keeping actual snapshot apply gated.
- `pr5-device-sync-begin-confirm-waiting-snapshot-flow`: verification passed:
  focused device-sync tests, backend type-check, full `bun run check`, backend
  suite, pre-commit checks, and dual GPT/Claude xhigh review. Coverage includes
  `beginPairingConfirm` creating a Rust-shaped
  `{ phase: "syncing", detail: "waiting_snapshot" }` flow after cloud confirm
  when bootstrap is required, overwrite risk is clear, and latest snapshot
  is 404.
- `pr5-connect-user-info-time-format-i32`: verification passed: focused
  user-info tests, full Connect tests, full `bun run check`, pre-commit checks,
  and dual GPT/Claude xhigh review. Coverage includes Rust `Option<i32>` parity
  for camelCase `timeFormat`, including null/missing handling and rejection of
  parsed floats, raw fractional integer tokens such as `24.0`, and out-of-range
  i32 values.
- `pr5-connect-subscription-plan-i32`: verification passed: focused
  subscription-plan tests, full Connect tests, full `bun run check`, pre-commit
  checks, and dual GPT/Claude xhigh review/refine. Coverage includes Rust `i32`
  parity for `householdSize`, `devices`, numeric `institutionConnections`, and
  optional `yearlyDiscountPercent`, including raw fractional JSON tokens such as
  `4.0` and parsed out-of-range values.
- `pr5-connect-subscription-plan-default-bool`: verification passed: focused
  subscription-plan tests, full Connect tests, full `bun run check`, pre-commit
  checks, and dual GPT/Claude xhigh review/refine. Coverage includes Rust
  `#[serde(default)] bool` parity for `isAvailable` and `isComingSoon`,
  including missing-field defaults plus present-null, non-boolean, and duplicate
  raw-key rejection.
- `pr5-connect-subscription-plan-duplicates`: verification passed: focused
  subscription-plan tests, full Connect tests, full `bun run check`, pre-commit
  checks, and dual GPT/Claude xhigh review. Coverage includes raw duplicate-key
  rejection for known top-level `SubscriptionPlan` fields, nested `PlanPricing`
  fields, and nested `PlanLimits` fields while preserving ignored unknown-field
  behavior.
- `pr5-connect-trusted-device-summary-duplicates`: verification passed: focused
  enroll/initialize-key tests, full Connect tests, full `bun run check`,
  pre-commit checks, and dual GPT/Claude xhigh review. Coverage includes raw
  duplicate-key rejection for known `TrustedDeviceSummary` fields and
  `lastSeenAt`/`last_seen_at` aliases in both enroll `PAIR` and initialize-key
  `PAIRING_REQUIRED` responses while preserving ignored unknown-field behavior.
- `pr5-connect-device-finite-number`: verification passed: focused device
  response tests, full Connect tests, full `bun run check`, pre-commit checks,
  and dual GPT/Claude xhigh review. Coverage includes Rust `Option<f64>` parity
  for device `trustedKeyVersion` / `trusted_key_version`, rejecting raw
  out-of-range numeric tokens such as `1e999` that `JSON.parse` converts to
  `Infinity`.
- `pr5-device-sync-device-finite-number`: verification passed: focused device
  listing tests, full standalone device-sync tests, full `bun run check`,
  pre-commit checks, and dual GPT/Claude xhigh review. Coverage includes Rust
  `Option<f64>` parity for standalone device-sync `trustedKeyVersion` /
  `trusted_key_version`, rejecting raw out-of-range numeric tokens such as
  `1e999` that `JSON.parse` converts to `Infinity`.
- `pr5-device-sync-trusted-device-summary-duplicates`: verification passed:
  focused enroll/initialize-key tests, full standalone device-sync tests, full
  `bun run check`, pre-commit checks, and dual GPT/Claude xhigh review/refine.
  Coverage includes raw duplicate-key rejection for known `TrustedDeviceSummary`
  fields and `lastSeenAt`/`last_seen_at` aliases in enroll `PAIR` and
  initialize-key `PAIRING_REQUIRED` responses while preserving ignored
  unknown-field behavior for non-pair modes.
- `pr5-device-sync-snapshot-cursor-i64`: verification passed: focused snapshot
  freshness tests, full standalone device-sync tests, full `bun run check`,
  pre-commit checks, and dual GPT/Claude xhigh review/refine. Coverage includes
  raw signed-i64 parsing for `oplogSeq`/`oplog_seq`, `sizeBytes`/`size_bytes`,
  and cursor responses, including over-safe values whose exact comparison would
  be lost through `JSON.parse` number rounding.
- `pr5-connect-local-snapshot-cursor-i64`: verification passed: focused Connect
  snapshot/cursor tests, full Connect tests, full `bun run check`, pre-commit
  checks, and dual GPT/Claude xhigh review/refine. Coverage includes raw
  signed-i64 parsing for Connect-local snapshot metadata, cursor latest-snapshot
  fallback, and internal freshness-gate cursor comparison, with safeguards so
  public JSON outputs stay serializable.
- `pr5-connect-token-expires-i64`: verification passed: focused token restore
  tests, full Connect tests, full `bun run check`, pre-commit checks, and dual
  GPT/Claude xhigh review. Coverage includes Rust `Option<i64>` parity for
  refresh-token response `expires_in`, accepting raw signed-i64 values such as
  `9223372036854775807` without producing BigInt output.
- `pr5-device-sync-transfer-response-shape`: verification passed: focused
  composite pairing tests, full standalone device-sync tests, full
  `bun run check`, pre-commit checks, and dual GPT/Claude xhigh review. Coverage
  includes Rust composite route response shape `{ success: true }` after
  validating and discarding the cloud complete-pairing response payload.
- `pr5-device-sync-transfer-approve-before-complete`: verification passed:
  focused composite pairing tests, full standalone device-sync tests, full
  `bun run check`, pre-commit checks, and dual GPT/Claude xhigh review. Coverage
  includes Rust approve-before-complete ordering plus 400/409 already-approved
  idempotency for `completePairingWithTransfer`, and non-idempotent approval
  failures short-circuiting before `/complete`; sync-cycle/snapshot upload
  orchestration remains a follow-up.
- `pr5-device-sync-transfer-bootstrap-gate`: verification passed: focused
  composite pairing tests, full standalone device-sync tests, full
  `bun run check`, pre-commit checks, and dual GPT/Claude xhigh review. Coverage
  includes fail-closed 501 behavior before approve/complete cloud mutations when
  local snapshot bootstrap is still required; full sync-cycle/snapshot upload
  orchestration remains a follow-up.
- `pr5-device-sync-transfer-outbox-gate`: verification passed: focused composite
  pairing tests, full standalone device-sync tests, full `bun run check`,
  pre-commit checks, and dual GPT/Claude xhigh review/refine. Coverage includes
  fail-closed 501 behavior before approve/complete cloud mutations when modern
  `sync_outbox` has unsent pending rows, while sent rows do not gate; full
  sync-cycle/snapshot upload orchestration remains a follow-up.
- `pr5-addon-rating-bounds`: verification passed: focused HTTP tests, full
  `bun run check`, pre-commit checks, and dual GPT/Claude xhigh review. Coverage
  includes Rust-compatible add-on store submit-rating bounds (`1..=5`) at the
  HTTP seam before service dispatch while preserving malformed/u8 parse
  rejection.
- `pr5-alternative-assets-as-of-quotes`: verification passed: focused
  alternative-assets tests, full `bun run check`, pre-commit checks, and dual
  GPT/Claude xhigh review/refine. Coverage includes Rust-compatible latest quote
  selection for holdings (`day <= local today`) so future-dated alternative
  asset valuation/payoff rows do not affect current holdings.
- `pr5-health-config-u32-hours`: verification passed: focused HTTP tests, full
  `bun run check`, pre-commit checks, and dual GPT/Claude xhigh review/refine.
  Coverage includes Rust-compatible `u32` parsing for price/FX stale-hour config
  fields before service dispatch, with negative and over-u32 values rejected for
  every stale-hour field.
- `pr5-taxonomy-i32-numeric-fields`: verification passed: focused HTTP tests,
  full `bun run check`, pre-commit checks, and dual GPT/Claude xhigh review.
  Coverage includes Rust-compatible `i32` parsing for taxonomy/category sort
  orders, category move positions, and assignment weights before service
  dispatch, with out-of-range values rejected for each route.
- `pr5-addon-rating-integer`: verification passed: focused add-on domain tests,
  full `bun run check`, pre-commit checks, and dual GPT/Claude xhigh review.
  Coverage includes Rust-compatible integer rating validation in the direct
  add-on domain service path, so fractional ratings are rejected before store
  dispatch in addition to HTTP seam validation.
- `pr5-alternative-assets-guardrails`: verification passed: focused
  alternative-assets tests, full `bun run check`, pre-commit checks, and dual
  GPT/Claude xhigh review/refine. Coverage includes same-day MANUAL-over-BROKER
  holdings quote priority and requested-only metadata key deletion with
  unspecified metadata preservation.
- `pr5-market-data-provider-priority-i32`: verification passed: focused HTTP
  tests, full `bun run check`, pre-commit checks, and dual GPT/Claude xhigh
  review. Coverage includes Rust-compatible `i32` parsing for market-data
  provider settings priority before service dispatch.
- `pr5-goal-priority-i32`: verification passed: focused HTTP tests, full
  `bun run check`, pre-commit checks, and dual GPT/Claude xhigh review. Coverage
  includes Rust-compatible `i32` parsing for goal create/update priority fields
  before service dispatch.
- `pr5-custom-provider-priority-i32`: verification passed: focused HTTP tests,
  full `bun run check`, pre-commit checks, and dual GPT/Claude xhigh review.
  Coverage includes Rust-compatible `i32` parsing for custom-provider
  create/update priority fields before service dispatch.
- `pr5-custom-provider-domain-priority-i32`: verification passed: focused
  custom-provider domain tests, full `bun run check`, pre-commit checks, and
  dual GPT/Claude xhigh review. Coverage includes Rust-compatible `Option<i32>`
  validation for direct custom-provider create/update calls before repository
  persistence.
- `pr5-goal-domain-priority-i32`: verification passed: focused goal domain
  tests, full `bun run check`, pre-commit checks, and dual GPT/Claude xhigh
  review. Coverage includes Rust-compatible `i32`/`Option<i32>` validation for
  direct goal create/update calls before repository persistence.
- `pr5-taxonomy-domain-i32-fields`: verification passed: focused taxonomy domain
  tests, full `bun run check`, pre-commit checks, and dual GPT/Claude xhigh
  review. Coverage includes Rust-compatible `i32` validation for direct taxonomy
  sort orders, category sort orders, move positions, and assignment weights
  before repository persistence or side effects.
- `pr5-market-data-provider-domain-priority-i32`: verification passed: focused
  provider domain tests, full `bun run check`, pre-commit checks, and dual
  GPT/Claude xhigh review. Coverage includes Rust-compatible `i32` validation
  for direct market-data provider settings priority before repository update or
  refresh side effects.
- `pr5-custom-provider-source-finite-numbers`: verification passed: focused
  custom-provider domain tests, full `bun run check`, pre-commit checks, and
  dual GPT/Claude xhigh review. Coverage includes Rust-compatible finite
  `Option<f64>` validation for direct source `factor` and `defaultPrice` values
  before persistence, fetch, or fallback side effects.
- `pr5-goal-domain-finite-numbers`: verification passed: focused goal domain
  tests, full `bun run check`, pre-commit checks, and dual GPT/Claude xhigh
  review. Coverage includes Rust/serde-compatible finite numeric validation for
  direct goal target, summary, progress, and projected value fields before
  repository persistence.
- `pr5-contribution-limit-numeric-bounds`: verification passed: focused
  contribution-limit domain tests, full `bun run check`, pre-commit checks, and
  dual GPT/Claude xhigh review. Coverage includes Rust-compatible `i32` year and
  finite `f64` limit-amount validation before persistence or portfolio-update
  side effects.
- `pr5-contribution-limit-route-year-i32`: verification passed: focused HTTP
  tests, full `bun run check`, pre-commit checks, and dual GPT/Claude xhigh
  review. Coverage includes Rust-compatible `i32` contribution-year parsing
  before create/update service dispatch.
- `pr5-health-initial-config-validation`: verification passed: focused health
  tests, full `bun run check`, pre-commit checks, and dual GPT/Claude xhigh
  review. Coverage includes constructor-time Rust-compatible u32/finite-f64
  validation for health config thresholds.
- `pr5-alternative-assets-timezone-fixture`: verification passed: focused
  alternative-assets tests in default timezone and `TZ=US/Hawaii`, full
  `bun run check`, pre-commit checks, and dual GPT/Claude xhigh re-review.
  Coverage fixes the milestone-review finding that local-date as-of quote tests
  could fail or use stale quotes in negative timezones.
- `pr5-exchange-rate-conversion-amount-validation`: verification passed: focused
  exchange-rate tests, full `bun run check`, pre-commit checks, and dual
  GPT/Claude xhigh review/refine. Coverage includes rejecting invalid FX
  conversion amount strings while accepting finite Decimal exponent notation
  from internal callers.
- `pr5-exchange-rate-historical-days-validation`: verification passed: focused
  exchange-rate tests, full `bun run check`, pre-commit checks, and dual
  GPT/Claude xhigh review/refine. Coverage includes rejecting fractional,
  non-finite, and Date-range-overflow historical day counts before repository
  reads.
- `pr5-market-sync-day-window-validation`: verification passed: focused HTTP
  tests, full `bun run check`, pre-commit checks, and dual GPT/Claude xhigh
  review/refine. Coverage includes rejecting market-sync day counts that would
  produce unsupported or extended-year sync windows before service dispatch.
- `pr5-assets-treasury-detail-validation`: verification passed: focused assets
  tests, full `bun run check`, pre-commit checks, and dual GPT/Claude xhigh
  review. Coverage includes ignoring invalid Treasury bond detail payloads
  before non-finite numeric values can be serialized into asset metadata.
- `pr5-market-data-direct-sync-day-validation`: verification passed: focused
  market-data tests, full `bun run check`, pre-commit checks, and dual
  GPT/Claude xhigh review. Coverage includes rejecting unsupported direct
  `syncMarketData` day windows before execution, including empty-target no-op
  calls.
- `pr5-activity-search-pagination-validation`: verification passed: focused
  activity and HTTP tests, full `bun run check`, pre-commit checks, and dual
  GPT/Claude xhigh review. Coverage includes rejecting unsafe pagination values
  and unsafe computed offsets before SQLite search queries at HTTP and direct
  service boundaries.
- `pr5-market-data-direct-sync-day-integers`: verification passed: focused
  market-data tests, full `bun run check`, pre-commit checks, and dual
  GPT/Claude xhigh review. Coverage includes rejecting fractional direct
  `syncMarketData` day counts before sync-window execution.
- `pr5-connect-import-run-pagination-validation`: verification passed: full
  Connect tests, full `bun run check`, pre-commit checks, and dual GPT/Claude
  xhigh review. Coverage includes rejecting unsafe direct local import-run
  `limit`/`offset` values before SQLite reads.
- `pr5-ai-chat-thread-limit-validation`: verification passed: focused AI chat
  tests, full `bun run check`, pre-commit checks, and dual GPT/Claude xhigh
  review. Coverage includes rejecting invalid direct AI thread-list limits
  before SQLite reads, matching HTTP u32 query parsing.
- `pr5-data-export-activity-page-parity`: verification passed: focused
  data-export tests, full `bun run check`, pre-commit checks, and dual
  GPT/Claude xhigh review. Coverage includes Rust-compatible page-zero activity
  search for data exports so exported activity rows are not skipped.
- `pr5-data-export-parser-case-parity`: verification passed: focused data-export
  tests, full `bun run check`, pre-commit checks, and dual GPT/Claude xhigh
  review. Coverage includes Rust-compatible case-sensitive data type parsing
  while preserving case-insensitive file format parsing.
- `pr5-data-export-filename-local-date`: verification passed: focused
  data-export tests, full `bun run check`, pre-commit checks, and dual
  GPT/Claude xhigh review/refine. Coverage includes Rust-compatible local-date
  export filenames without mutating process timezone in tests.
- `pr5-ai-chat-thread-cursor-validation`: verification passed: focused AI chat
  tests, full `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage
  includes rejecting non-generated pinned cursor prefixes such as `2` and `1e0`
  plus empty updated-at/id fields before SQLite cursor filtering.
- `pr5-holdings-lots-query-bool-parity`: verification passed: focused HTTP
  tests, full `bun run check`, and dual GPT/Claude xhigh review. Coverage
  includes Rust-compatible `includeSnapshotPositions` parsing for holdings lots:
  absent defaults to false, lowercase `true`/`false` are accepted, and malformed
  query values reject before service dispatch.
- `pr5-app-update-force-query-bool-parity`: verification passed: focused HTTP
  tests, full `bun run check`, and dual GPT/Claude xhigh review. Coverage
  includes Rust-compatible `force` query parsing for app update checks: absent
  defaults to false, lowercase `true`/`false` are accepted, and malformed query
  values reject before update-check dispatch.
- `pr5-account-list-include-archived-bool-parity`: verification passed: focused
  HTTP tests, full `bun run check`, and dual GPT/Claude xhigh review. Coverage
  includes Rust-compatible `includeArchived` query parsing for account list
  reads: absent defaults to false, lowercase `true`/`false` are accepted, and
  malformed query values reject before account service dispatch.
- `pr5-http-date-proleptic-year-validation`: verification passed: focused HTTP
  tests, full `bun run check`, and dual GPT/Claude xhigh review/refine. Coverage
  includes accepting Rust-compatible early proleptic leap days such as
  `0004-02-29` while preserving modern leap-day validation such as `2024-02-29`
  and existing invalid-date rejection.
- `pr5-http-u32-leading-plus-query-parity`: verification passed: focused HTTP
  tests, full `bun run check`, and dual GPT/Claude xhigh review. Coverage
  includes accepting percent-encoded leading-plus unsigned integers such as
  `%2B1` for `u32` query fields while preserving unsigned and u32 bounds
  rejection.
- `pr5-alpha-vantage-proleptic-date-validation`: verification passed: focused
  market-data tests, full `bun run check`, and dual GPT/Claude xhigh review.
  Coverage includes resolving an Alpha Vantage daily quote dated `0004-02-29`
  while preserving existing invalid-date filtering and modern date behavior.
- `pr5-ai-chat-thread-cursor-i32-parity`: verification passed: focused AI chat
  tests, full `bun run check`, and dual GPT/Claude xhigh review. Coverage
  resolves periodic-review feedback by accepting Rust-compatible signed `i32`
  pinned cursor values such as `2` and `+1`, rejecting exponent/overflow values,
  and no longer rejecting empty later cursor fields.
- `pr5-health-price-staleness-proleptic-date-parity`: verification passed:
  focused health tests, full `bun run check`, and dual GPT/Claude xhigh review.
  Coverage includes counting early proleptic-year trading days without
  JavaScript's 1900-year remap so `0004-02-27` to `0004-03-01` remains a
  one-trading-day warning instead of an over-counted critical issue.
- `pr5-activity-date-proleptic-year-validation`: verification passed: focused
  activity tests, full `bun run check`, and dual GPT/Claude xhigh review.
  Coverage includes creating an activity on Rust-compatible `0000-02-29` while
  preserving existing invalid date rejection.
- `pr5-holdings-synthetic-proleptic-date-parity`: verification passed: focused
  holdings tests, full `bun run check`, and dual GPT/Claude xhigh review/refine.
  Coverage includes clamping `0000-05-31` to a synthetic `0000-02-29` snapshot
  and skipping unsupported negative-year synthetic dates instead of writing
  malformed rows.
- `pr5-save-up-proleptic-date-arithmetic`: verification passed: focused save-up
  tests, full `bun run check`, and dual GPT/Claude xhigh review. Coverage
  includes accepting `0000-02-29` targets and accruing a one-day projection from
  `0000-02-28` without JavaScript's 1900-year remap.
- `pr5-date-batch-review-followups`: verification passed: focused
  save-up/holdings tests, full `bun run check`, and dual GPT/Claude xhigh
  review. Coverage includes zero-padded early save-up projected completion dates
  such as `0000-03-28` and explicit documentation of the holdings negative-year
  synthetic snapshot skip.
- `pr5-portfolio-metrics-proleptic-date-arithmetic`: verification passed:
  focused portfolio-metrics tests, full `bun run check`, and dual GPT/Claude
  xhigh review. Coverage includes stale-asset day counts from `0000-02-29` to
  `0000-05-30` crossing the Rust-compatible >90 day threshold.
- `pr5-retirement-goal-proleptic-date-format`: verification passed: focused
  goals tests, full `bun run check`, and dual GPT/Claude xhigh review. Coverage
  includes a FIRE retirement summary on `0000-02-29` emitting a zero-padded
  projected completion date without JavaScript's 1900-year remap.
- `pr5-custom-provider-proleptic-date-placeholders`: verification passed:
  focused custom-provider tests, full `bun run check`, and dual GPT/Claude xhigh
  review. Coverage includes UTC template expansion for `0000-02-29` with
  Rust-compatible `%Y`, `%F`, `%C`, and `%j` outputs.
- `pr5-contribution-limit-proleptic-year-bounds`: verification passed: focused
  contribution-limit tests, full `bun run check`, and dual GPT/Claude xhigh
  review/refine. Coverage includes contribution year `0` UTC boundaries and
  America/Los_Angeles year-zero activity inclusion/FX dates without JavaScript's
  1900-year or Intl AD-year remaps.
- `pr5-portfolio-sort-order-i32-parity`: verification passed: focused
  portfolio/http tests, full `bun run check`, and dual GPT/Claude xhigh review.
  Coverage includes rejecting HTTP out-of-i32 `sortOrder` before service
  dispatch and direct service fractional/out-of-i32 sort orders before account
  checks or persistence.
- `pr5-expanded-year-contribution-fx-followups`: verification passed: focused
  exchange-rate/contribution tests, full `bun run check`, and dual GPT/Claude
  xhigh review. Coverage includes parsed-instant filtering for contribution year
  `10000`, date-only `+10000-01-01` activity inclusion, real FX conversion for
  `+10000-01-01`, and latest FX selection at `+10001`.
- `pr5-contribution-rfc3339-validation`: verification passed: focused
  contribution-limit tests, full `bun run check`, and dual GPT/Claude xhigh
  review. Coverage includes rejecting invalid explicit range date-times such as
  `+10000-02-30T00:00:00Z`, `2026-04-31T00:00:00Z`, and
  `2026-01-01T00:00:00+24:00`.
- `pr5-sync-crypto-dek-version-u32`: verification passed: focused sync-crypto
  tests, full `bun run check`, and dual GPT/Claude xhigh review. Coverage
  includes rejecting direct fractional and over-u32 DEK versions before key
  derivation.
- `pr5-device-sync-team-key-version-i32`: verification passed: focused
  device-sync tests, full `bun run check`, and dual GPT/Claude xhigh review.
  Coverage includes rejecting direct fractional and over-i32 team-key commit
  versions before session lookup or cloud requests.
- `pr5-fx-expanded-history-range-parity`: verification passed: focused
  exchange-rate tests, full `bun run check`, and dual GPT/Claude xhigh review.
  Coverage includes Rust-style `+00:00` start-boundary rows, mixed
  `9999`/`+10000` historical ranges, and invalid-offset quote exclusion during
  converter initialization.
- `pr5-ai-provider-priority-i32`: verification passed: focused AI provider/HTTP
  tests and full `bun run check`. Coverage includes rejecting HTTP/direct
  priority values outside Rust `i32` before dispatch/persistence and falling
  back to catalog defaults when stored AI provider settings contain malformed
  priority data.
- `pr5-retirement-plan-age-u32`: verification passed: focused goals/HTTP tests
  and full `bun run check`. Coverage includes rejecting nested retirement-plan
  age values above Rust `u32` before goal-plan persistence or direct retirement
  route calculations, while preserving existing negative/fraction validation
  messages.
- `pr5-ai-import-csv-skip-rows`: verification passed: focused AI chat tool tests
  and full `bun run check`. Coverage includes rejecting malformed
  `skipTopRows`/`skipBottomRows` values before CSV parsing instead of silently
  dropping them, matching Rust serde `Option<usize>` tool argument behavior.
- `pr5-ai-provider-settings-schema-u32`: verification passed: focused AI
  provider tests and full `bun run check`. Coverage includes falling back to
  catalog defaults when stored `ai_provider_settings.schemaVersion` is malformed
  or outside Rust `u32`.
- `pr5-ai-message-content-schema-u32`: verification passed: focused AI chat
  tests and full `bun run check`. Coverage includes rejecting stored
  `ai_messages.content_json` `schemaVersion` values outside Rust `u32` instead
  of silently defaulting them.
- `pr5-ai-thread-config-snapshot-parse`: verification passed: focused AI chat
  tests and full `bun run check`. Coverage includes returning `null` for
  malformed stored `ai_threads.config_snapshot` JSON or non-u32 `schemaVersion`,
  matching Rust best-effort config deserialization.
- `pr5-ai-raw-schema-version-tokens`: verification passed: focused AI
  provider/chat tests and full `bun run check`. Coverage includes rejecting
  Rust-invalid raw `schemaVersion` float/exponent JSON tokens in stored provider
  settings, message content, and thread config snapshots, and accepting explicit
  `null` for Rust `Option` fields in thread configs.
- `pr5-backup-filename-proleptic-date`: verification passed: focused app utility
  tests and full `bun run check`. Coverage includes accepting Rust-compatible
  year-zero leap-day backup filenames while continuing to reject invalid
  month/day/time rollovers.
- `pr5-app-update-semver-compare`: verification passed: focused app utility
  tests and full `bun run check`. Coverage includes Rust-compatible semver
  prerelease ordering and invalid latest-version fallback behavior for update
  availability.
- `pr5-app-update-semver-precision`: verification passed: focused app utility
  tests and full `bun run check`. Coverage includes large u64-safe semver core
  component comparisons, over-u64 latest-version fallback, and numeric
  prerelease comparison without JS `number` precision loss.
- `pr5-app-update-response-serde`: verification passed: focused app utility
  tests and full `bun run check`. Coverage includes rejecting malformed update
  response screenshots instead of silently filtering non-string entries while
  preserving Rust-compatible required payload fields.
- `pr5-app-update-semver-build-metadata`: verification passed: focused app
  utility tests and full `bun run check`. Coverage includes Rust-compatible
  build metadata ordering for update availability.
- `pr5-app-update-semver-build-leading-zero`: verification passed: focused app
  utility tests and full `bun run check`. Coverage includes Rust-compatible
  numeric build metadata ordering for leading-zero identifiers such as `+00`.
- `pr5-backup-delete-not-found`: verification passed: focused app utility/HTTP
  tests and full `bun run check`. Coverage includes mapping missing backup
  directories/files to 404 style errors and catching synchronous DELETE service
  failures in the route.
- `pr5-backup-download-canonical-path`: verification passed: focused HTTP tests
  and full `bun run check`. Coverage includes canonical backup download reads,
  missing backup 404s, and valid-named symlink escape rejection.
- `pr5-backup-list-rfc3339-timestamp`: verification passed: focused app utility
  tests and full `bun run check`. Coverage includes Rust chrono-compatible UTC
  RFC3339 `modifiedAt` formatting for backup listings.
- `pr5-backup-review-followups`: verification passed: focused app
  utility/HTTP/runtime tests and full `bun run check`. Coverage includes runtime
  `appDataDir` handler wiring for downloads, symlink-skipping backup listings,
  and bigint mtimeNs-based modifiedAt formatting.
- `pr5-backup-timestamp-autosi`: verification passed: focused app utility tests
  and full `bun run check`. Coverage includes Rust chrono-compatible AutoSi
  fractional timestamp widths for backup listing `modifiedAt`.
- `pr5-addon-update-response-serde`: verification passed: focused add-on tests
  and full `bun run check`. Coverage includes typed Rust-shaped
  `AddonUpdateCheckResult` parsing and per-addon fallback errors for malformed
  update-check API responses.
- `pr5-addon-rating-error-parity`: verification passed: focused add-on tests and
  full `bun run check`. Coverage includes Rust-compatible non-success rating
  submission error messages while preserving store request headers and success
  JSON parsing.
- `pr5-addon-staged-missing-file`: verification passed: focused add-on tests and
  full `bun run check`. Coverage includes Rust-compatible missing staged ZIP
  errors before filesystem reads.
- `pr5-addon-store-status-format`: verification passed: focused add-on tests and
  full `bun run check`. Coverage includes canonical Rust-compatible HTTP reason
  phrases for add-on store error messages.
- `pr5-addon-store-status-table`: verification passed: focused add-on tests and
  full `bun run check`. Coverage includes less-common standard HTTP status
  reasons such as 422 for add-on store errors.
- `pr5-addon-store-status-overrides`: verification passed: focused add-on tests
  and full `bun run check`. Coverage includes Rust-specific HTTP status reason
  overrides for add-on store errors such as 418 and 509.
- `pr5-addon-store-status-unknown`: verification passed: focused add-on tests
  and full `bun run check`. Coverage includes Rust-compatible
  `<unknown status code>` fallback text for non-standard add-on store statuses.
- `pr5-addon-runtime-manifest-fields`: verification passed: focused add-on tests
  and full `bun run check`. Coverage includes preserving valid runtime manifest
  fields on read and writing Rust-style UTC RFC3339 `installedAt` values on
  local installs.
- `pr5-addon-runtime-status-review-fixes`: verification passed: focused add-on
  tests and full `bun run check`. Coverage includes clearing runtime-only fields
  from ZIP/package manifest installs and exercising 509/unknown status reason
  parity.
- `pr5-addon-installed-manifest-read-parity`: verification passed: focused
  add-on tests and full `bun run check`. Coverage includes clearing runtime-only
  fields on installed manifest reads like Rust while preserving fresh runtime
  metadata in install return values.
- `pr5-health-rfc3339-timestamps`: verification passed: focused health tests and
  full `bun run check`. Coverage includes Rust chrono-style UTC RFC3339 issue
  timestamps, status `checkedAt`, and timestamp fallbacks.
- `pr5-provider-sync-rfc3339-timestamps`: verification passed: focused
  market-data provider tests and full `bun run check`. Coverage includes Rust
  `DateTime<Utc>::to_rfc3339()`-style `lastSyncedAt` values from provider sync
  stats.
- `pr5-health-provider-timestamp-review-fixes`: verification passed: focused
  health/provider tests and full `bun run check`. Coverage includes chrono serde
  `Z` health API timestamps, `+00:00` dismissal storage timestamps, and
  microsecond-precision provider sync `lastSyncedAt` normalization.
- `pr5-custom-provider-table-path-integers`: verification passed: focused
  custom-provider tests. Coverage includes Rust `usize::parse`-compatible
  HTML-table path parsing for plus/leading-zero decimal components and rejection
  of whitespace, decimal, and exponent path components.
- `pr5-custom-provider-csv-column-integers`: verification passed: focused
  custom-provider tests. Coverage includes Rust `usize::parse`-compatible CSV
  numeric column indices, including plus-prefixed decimal indices and rejection
  of decimal/exponent/whitespace numeric-looking column strings.
- `pr5-custom-provider-json-preview-locale`: verification passed: focused
  custom-provider tests. Coverage includes test-source JSON numeric-string
  parsing ignoring configured locale like Rust preview behavior while preserving
  auto-detection for comma-separated values.
- `pr5-custom-provider-json-sync-locale-review`: verification passed: focused
  custom-provider tests. Coverage includes production JSON row extraction using
  configured locale like Rust custom scraper sync while preview extraction stays
  locale-free.
- `pr5-custom-provider-invalid-header-skip`: verification passed: focused
  custom-provider tests. Coverage includes skipping invalid user header names
  and values like Rust header parsing while preserving valid/secret headers.
- `pr5-custom-provider-row-currency-default`: verification passed: focused
  custom-provider tests. Coverage includes defaulting production JSON/CSV/HTML
  row fetch currencies to `USD` when no currency hint/path is present, matching
  Rust custom scraper quote generation.
- `pr5-custom-provider-http-status-text`: verification passed: focused
  custom-provider tests. Coverage includes canonical Rust-compatible status
  reason phrases and `<unknown status code>` fallback for source HTTP errors.
- `pr5-custom-provider-review-fixes`: verification passed: focused
  custom-provider tests. Coverage includes rejecting Rust-invalid control
  characters in user header values, the Node-only 509 status override, and CSV
  row currency defaulting to `USD`.
- `pr5-custom-provider-header-rereview-fixes`: verification passed: focused
  custom-provider tests. Coverage includes resolving secret header values before
  invalid-name skipping and preserving Rust-valid tab/non-ASCII header values
  while rejecting invalid controls and DEL.
- `pr5-custom-provider-nonascii-header-coverage`: verification passed: focused
  custom-provider tests. Coverage includes Rust-valid Latin-1-compatible header
  values and higher Unicode values that Bun `Headers.set` cannot represent
  directly.
- `pr5-custom-provider-utf8-header-rereview-fix`: verification passed: focused
  custom-provider tests. Coverage includes passing raw non-ASCII header values
  through Bun Fetch when accepted and skipping Bun-unsupported higher Unicode
  values instead of sending byte-string double-encoded bytes.
- `pr5-yahoo-http-status-text`: verification passed: focused market-data tests.
  Coverage includes canonical Rust-compatible status reason phrases and
  `<unknown status code>` fallback for Yahoo provider HTTP errors.
- `pr5-market-data-provider-http-status-text`: verification passed: focused
  market-data tests. Coverage includes canonical Rust-compatible status reason
  phrases for direct non-Yahoo provider HTTP errors, with MarketData.app 509
  failure-state coverage.
- `pr5-assets-provider-http-status-text`: verification passed: focused asset
  tests. Coverage includes canonical Rust-compatible status reason phrases and
  `<unknown status code>` fallback for asset enrichment provider HTTP failures.
- `pr5-provider-status-review-fixes`: verification passed: focused
  market-data/assets tests. Coverage includes Finnhub JSON error bodies for
  asset enrichment, Boerse Frankfurt search-specific HTTP status wording in
  market-data and asset profile paths, and canonical Yahoo crumb status
  formatting.
- `pr5-provider-status-rereview-fix`: verification passed: focused market-data
  tests. Coverage includes preserving generic Rust `HTTP ...` status wording for
  Boerse Frankfurt resolved quote price endpoint failures.
- `pr5-app-update-non404-response-parsing`: verification passed: focused
  app-utilities tests. Coverage includes Rust-compatible behavior where only 404
  maps to no-update and all other HTTP responses are parsed as update payloads.
- `pr5-app-update-invalid-json-error`: verification passed: focused
  app-utilities tests. Coverage includes wrapping invalid update response JSON
  parse failures with Rust-compatible `Failed to parse update response` errors.
- `pr5-app-update-request-error`: verification passed: focused app-utilities
  tests. Coverage includes wrapping update endpoint fetch failures with
  Rust-compatible `Failed to query update endpoint` errors.
- `pr5-health-dismissal-rfc3339-parse`: verification passed: focused health
  tests. Coverage includes strict Rust-compatible stored dismissal timestamp
  parsing with fallback for date-only and calendar-rollover strings.
- `pr5-provider-sync-timestamp-rfc3339-parse`: verification passed: focused
  market-data provider tests. Coverage includes rejecting malformed
  `last_synced_at` values and strict RFC3339 parsing/fallback for sync-error
  `updated_at`.
- `pr5-provider-sync-timestamp-offset-review`: verification passed: focused
  market-data provider tests. Coverage includes accepting valid non-UTC RFC3339
  `last_synced_at` values and normalizing them to UTC like Rust.
- `pr5-provider-sync-timestamp-fractional-offset`: verification passed: focused
  market-data provider tests. Coverage includes preserving microsecond
  fractional precision for non-UTC `last_synced_at` values normalized to UTC.
- `pr5-ai-chat-stored-timestamp-rfc3339`: verification passed: focused AI chat
  tests. Coverage includes strict Rust-compatible stored thread/message
  timestamp parsing, non-UTC offset normalization with microsecond precision,
  and invalid timestamp fallback.
- `pr5-exchange-rate-timestamp-strict-parse`: verification passed: focused
  exchange-rate tests. Coverage includes rejecting invalid calendar-rollover FX
  quote timestamps for ordering while preserving valid offset normalization.
- `pr5-exchange-rate-timestamp-review-fixes`: verification passed: focused
  exchange-rate tests. Coverage includes Rust-compatible raw `MAX(timestamp)`
  latest FX quote selection and chrono serde-style `Z` timestamp output with
  microsecond precision.
- `pr5-exchange-rate-timestamp-rereview-fixes`: verification passed: focused
  exchange-rate tests. Coverage includes direct latest FX raw timestamp
  ordering, tied raw max replacement parity, and millisecond-aware parsed
  instants with full fractional output preservation.
- `pr5-activity-date-fractional-rfc3339`: verification passed: focused
  activities tests. Coverage includes direct activity create RFC3339 offset
  normalization preserving microsecond fractional precision.
- `pr5-activity-manual-quote-timestamp-rfc3339`: verification passed: focused
  activities tests. Coverage includes activity-created manual quote timestamps
  using Rust `to_rfc3339()` `+00:00` formatting with microsecond precision.
- `pr5-activity-date-rfc3339-review-fixes`: verification passed: focused
  activities tests. Coverage includes chrono-compatible truncation of fractional
  seconds beyond nanoseconds and valid boundary-year offset formatting.
- `pr5-activity-date-subnanosecond-review-fix`: verification passed: focused
  activities tests. Coverage includes omitting fractional output when
  sub-nanosecond input truncates to zero nanoseconds like chrono.
- `pr5-activity-import-run-timestamps`: verification passed: focused activities
  tests. Coverage includes Rust `to_rfc3339()` `+00:00` storage formatting for
  completed import run timestamp fields.
- `pr5-activity-manual-quote-expanded-date`: verification passed: focused
  activities tests. Coverage includes signed/expanded-year-aware manual quote
  day extraction and Rust-style quote `created_at` storage formatting.
- `pr5-taxonomy-naive-timestamp-serialization`: verification passed: focused
  taxonomy tests. Coverage includes Rust `NaiveDateTime` JSON shape without
  timezone suffixes, offset/fraction normalization, and update-created timestamp
  storage in Rust-compatible `...Z` form.
- `pr5-assets-naive-timestamp-serialization`: verification passed: focused asset
  tests. Coverage includes Rust `text_to_datetime` read semantics for RFC3339
  offsets/fractions, SQLite current-timestamp strings, date-only strings, and
  invalid fallback with `NaiveDateTime` JSON output.
- `pr5-naive-timestamp-review-fixes`: verification passed: focused
  asset/taxonomy tests. Coverage includes chrono-compatible RFC3339 space
  separators, lowercase `t`/`z`, and signed/expanded-year formatting for asset
  timestamp UTC rollovers.
- `pr5-naive-timestamp-leap-storage-fixes`: verification passed: focused
  asset/taxonomy tests. Coverage includes chrono-compatible RFC3339 leap seconds
  and rejecting invalid taxonomy update-created timestamp storage inputs.
- `pr5-naive-timestamp-bare-leap-fix`: verification passed: focused
  asset/taxonomy tests. Coverage includes chrono-compatible bare
  `NaiveDateTime`/SQLite timestamp leap seconds.
- `pr5-activity-event-earliest-timestamp`: verification passed: focused
  activities tests. Coverage includes chrono serde-style `Z` output and
  microsecond precision for `activities_changed.earliest_activity_at_utc`.
- `pr5-activity-event-earliest-rereview-fix`: verification passed: focused
  activities tests. Coverage includes nanosecond-aware earliest event comparison
  and chrono-compatible leap-second parsing.
- `pr5-activity-rfc3339-parser-variants`: verification passed: focused
  activities tests. Coverage includes chrono-compatible lowercase `t`/`z` and
  space-separated RFC3339 activity date parsing.
- `pr5-activity-audit-timestamps`: verification passed: focused activities
  tests. Coverage includes Rust `to_rfc3339()` `+00:00` storage formatting for
  newly created activity `created_at`/`updated_at` fields.
- `pr5-device-sync-datetime-parser-variants`: verification passed: focused
  device-sync tests. Coverage includes chrono-compatible lowercase RFC3339
  `t`/`z` parsing through the shared device-sync datetime helper while keeping
  Rust-style millisecond `Z` normalization.
- `pr5-ai-chat-write-timestamps`: verification passed: focused AI chat tests.
  Coverage includes Rust `Utc::now().to_rfc3339()` style `+00:00` storage for
  newly written thread metadata and tag timestamps through the shared AI chat
  timestamp helper.
- `pr5-market-data-quote-timestamps`: verification passed: focused market-data
  tests. Coverage includes Rust `DateTime<Utc>::to_rfc3339()` style `+00:00`
  quote `timestamp`/`created_at` formatting for manual quote writes and
  quote-history reads.
- `pr5-market-data-quote-read-shape-review-fix`: verification passed: focused
  market-data tests. Coverage distinguishes Rust DB storage `+00:00` quote
  timestamps from Rust API serde `Z` quote-history read timestamps.
- `pr5-portfolios-timestamps`: verification passed: focused portfolios tests.
  Coverage includes Rust repository-style second-level UTC `Z` storage for
  portfolio and portfolio-account timestamps.
- `pr5-custom-provider-crud-timestamps`: verification passed: focused
  custom-provider tests. Coverage includes Rust `Utc::now().to_rfc3339()` style
  `+00:00` storage and sync payload timestamps for custom provider creates.
- `pr5-market-data-quote-timestamp-parse`: verification passed: focused
  market-data tests. Coverage includes rejecting malformed/date-only/calendar
  rollover manual quote timestamps, accepting chrono-compatible leap seconds,
  and preserving microsecond fractions in DB storage plus quote-history reads.
- `pr5-market-data-quote-offset-review-fix`: verification passed: focused
  market-data tests. Coverage includes accepting chrono/Rust-serde-compatible
  `+HHMM` quote timestamp offsets while still rejecting unsupported `+HH`
  offsets.
- `pr5-data-export-http-route-coverage`: verification passed: focused HTTP
  tests. Coverage includes data-export auth gating, Rust-shaped response
  headers, 204 empty responses, invalid parameter 400s, and route miss 404s.
- `pr5-assets-write-timestamps`: verification passed: focused asset tests.
  Coverage includes Rust `Utc::now().to_rfc3339()` style `+00:00` storage and
  sync payload timestamps for asset create/update while preserving
  `NaiveDateTime` API reads.
- `pr5-holdings-manual-quote-parity`: verification passed: focused holdings
  tests. Coverage includes Rust manual snapshot quote IDs
  (`YYYYMMDD_ASSETIDUPPER`) and `+00:00` DB timestamp formatting.
- `pr5-assets-quote-mode-timestamp-parity-correction`: verification passed:
  focused asset and activity tests. Coverage includes preserving existing
  `updated_at` values for asset-service and activity-triggered quote-mode
  updates like Rust `update_quote_mode`.
- `pr5-assets-sync-state-reset-timestamps`: verification passed: focused asset
  tests. Coverage includes Rust `+00:00` `updated_at` storage when asset profile
  changes reset quote sync state.
- `pr5-taxonomies-write-timestamps`: verification passed: focused taxonomy
  tests. Coverage includes Rust `Utc::now().to_rfc3339()` style `+00:00` storage
  for taxonomy writes while preserving `NaiveDateTime` API reads.
- `pr5-direct-asset-create-timestamps`: verification passed: focused activity
  and holdings tests. Coverage includes Rust `+00:00` `created_at`/`updated_at`
  storage for activity-created and holdings-created direct asset inserts.
- `pr5-market-data-sync-state-timestamps`: verification passed: focused
  market-data tests. Coverage includes Rust `+00:00` timestamp storage for
  active/inactive/open quote sync state lifecycle writes.
- `pr5-activity-import-template-timestamps`: verification passed: focused
  activity tests. Coverage includes Rust `NaiveDateTime` JSON-shaped timestamps
  in import template and import-account-template sync payloads.
- `pr5-connect-broker-sync-state-timestamps`: verification passed: focused
  Connect tests. Coverage includes Rust `Utc::now().to_rfc3339()` style `+00:00`
  timestamps for broker sync state attempt/success/failure rows.
- `pr5-fx-asset-create-timestamps`: verification passed: focused exchange-rate
  tests. Coverage includes Rust `Utc::now().to_rfc3339()` style `+00:00`
  timestamps for newly created FX assets and sync payloads.
- `pr5-holdings-calculated-at-timestamps`: verification passed: focused holdings
  tests. Coverage includes Rust `NaiveDateTime`-style UTC `calculated_at`
  timestamps for manual and synthetic holdings snapshots.
- `pr5-contribution-limit-timestamps`: verification passed: focused
  contribution-limit tests. Coverage includes Rust `NaiveDateTime` JSON-shaped
  timestamps in contribution-limit create/update sync payloads.
- `pr5-account-sync-payload-timestamps`: verification passed: focused account
  tests. Coverage includes Rust `NaiveDateTime` JSON-shaped timestamps in
  account create/update sync payloads.
- `pr5-contribution-limit-payload-timestamp-review-fix`: verification passed:
  focused contribution-limit tests. Coverage includes normalizing legacy
  space-separated contribution-limit timestamps at the sync payload boundary.
- `pr5-addon-detected-permission-timestamps`: verification passed: focused
  add-on tests. Coverage includes Rust `Utc::now().to_rfc3339()` style `+00:00`
  timestamps for statically detected add-on permissions.
- `pr5-device-sync-leap-second-timestamps`: verification passed: focused
  device-sync tests. Coverage includes chrono-compatible leap-second parsing
  with Rust millisecond `Z` normalization.
- `pr5-health-fx-invalid-timestamps`: verification passed: focused health tests.
  Coverage includes treating invalid latest FX quote timestamps as missing rates
  in FX integrity health checks.
- `pr5-health-fx-strict-timestamp-review-fix`: verification passed: focused
  health tests. Coverage includes rejecting calendar-rollover FX quote
  timestamps before stale/fresh comparisons.
- `pr5-data-export-runtime-route-smoke`: verification passed: runtime tests.
  Coverage includes SQLite-backed standalone runtime wiring for
  `/api/v1/utilities/export` and Rust-compatible empty export 204 responses.
- `pr5-data-export-runtime-nonempty-smoke`: verification passed: runtime tests
  and full check. Coverage includes SQLite-backed standalone runtime account
  creation followed by non-empty `/api/v1/utilities/export/accounts/json`
  responses.
- `pr5-health-fx-parser-review-fix`: verification passed: focused health tests.
  Coverage includes chrono-compatible leap-second, lowercase `t/z`,
  space-separated, and colon-offset RFC3339 FX quote timestamps staying
  stale/fresh-classifiable instead of being treated as missing rates.
- `pr5-health-fx-malformed-review-fix`: verification passed: focused health and
  exchange-rate tests. Coverage includes malformed present FX quote timestamps
  falling back to fresh/classifiable behavior like Rust `QuoteDB -> Quote`
  `Utc::now()` fallback instead of becoming missing-rate issues.
- `pr5-electron-data-root-doc-cleanup`: verification passed: Markdown format
  check. Scope is a docs-only cleanup removing stale desktop `DATABASE_URL`
  wording from the Electron migration architecture data-root section.
- `pr5-roadmap-backend-runtime-wording`: verification passed: Markdown format
  check. Scope is a docs-only cleanup naming the Bun/TypeScript REST API server
  in the roadmap while preserving the legacy Axum reference note.
- `pr5-health-fx-compact-offset-review-fix`: verification passed: focused health
  and exchange-rate tests. Coverage includes compact `+HHMM` FX quote timestamps
  following Rust `QuoteDB` strict `parse_from_rfc3339` fallback-to-fresh
  behavior instead of parsing as valid RFC3339.
- `pr5-web-update-current-version`: verification passed: focused frontend web
  adapter tests. Coverage includes update-available responses populating
  `UpdateInfo.currentVersion` from backend app info instead of an empty string,
  while no-update responses skip the extra app-info call.
- `pr5-alpha-vantage-option-sync-message`: verification passed: focused
  market-data tests. Coverage includes historical OPTION sync failures reporting
  Rust provider-style unsupported `historical_quotes` operation text instead of
  TS-runtime-specific wording.
- `pr5-finnhub-fx-crypto-sync`: verification passed: focused Finnhub market-data
  tests. Coverage includes preferred Finnhub FX and CRYPTO assets syncing
  historical candle rows through Rust provider-style `OANDA:<from>_<to>` and
  `BINANCE:<base><quote>` symbols, with Rust Finnhub provider capabilities
  aligned to include FX and CRYPTO.
- `pr5-finnhub-fx-crypto-resolve`: verification passed: focused Finnhub
  market-data tests. Coverage includes preferred Finnhub FX and CRYPTO latest
  quote resolution through Rust provider-style `OANDA:<from>_<to>` and
  `BINANCE:<base><quote>` `/quote` symbols.
- `pr5-finnhub-capability-metadata`: verification passed: focused
  provider-settings tests. Coverage includes TS provider info and Rust
  provider-settings metadata advertising Finnhub `Stocks • Crypto • Forex`
  capabilities after the Rust provider capability expansion.
- `pr5-finnhub-review-fixes`: verification passed: focused Rust
  resolver/provider and TS Finnhub tests. Coverage includes Rust Finnhub
  resolver support for FX/CRYPTO, plus Rust and TS historical candle endpoint
  routing to `/forex/candle` and `/crypto/candle`.
- `pr5-finnhub-provider-settings-rust-test`: verification passed: focused Rust
  provider-settings test. Coverage pins Finnhub `Stocks • Crypto • Forex`
  capability text and core features in Rust provider-settings metadata.
- `pr5-metal-provider-capability-metadata`: verification passed: focused Rust
  and TS provider-settings tests. Coverage includes Metal Price API advertising
  both `Real-time` and `Historical` capability features after existing timeframe
  sync support.
- `pr5-finnhub-pair-shaped-resolve`: verification passed: focused Finnhub
  market-data tests. Coverage includes TS Finnhub latest quote resolution
  canonicalizing pair-shaped FX/CRYPTO inputs like `EURUSD` and `BTC-USDT`
  before building `OANDA:`/`BINANCE:` request symbols.
- `pr5-alpha-vantage-option-capability-metadata`: verification passed: focused
  Rust and TS provider-settings tests. Coverage includes Alpha Vantage
  advertising `Stocks • Crypto • Forex • Options (real-time only)` after
  existing `REALTIME_OPTIONS` latest quote support, without implying historical
  option support.
- `pr5-openfigi-quote-fetch-fallback`: verification passed: focused market-data
  tests. Coverage includes preferred `OPENFIGI` profile/search assets falling
  back to Yahoo quote sync instead of being skipped as provider-not-implemented.
- `pr5-unsupported-preferred-provider-fallback`: verification passed: focused
  market-data tests. Coverage includes preferred `MARKETDATA_APP` non-equity,
  `ALPHA_VANTAGE` OPTION historical sync, `METAL_PRICE_API` non-metal, `FINNHUB`
  metal, `BOERSE_FRANKFURT` crypto assets, and US Treasury bonds with
  unsupported preferred providers falling back to a fetch-capable provider
  instead of failing before provider fallback can occur.
- `pr5-alpha-option-capability-review-fix`: verification passed: focused Rust
  and TS provider-settings tests. Coverage clarifies Alpha Vantage option
  capability text as real-time-only after review feedback.
- `pr5-provider-fallback-review-fix`: verification passed: focused market-data
  tests. Coverage removes the stale Alpha Vantage option-history failure
  assertion and preserves US Treasury calculated fallback for Treasury bonds
  with unsupported preferred providers. It also ignores stale high error counts
  from the old provider when a fallback provider is selected and removes the
  now-unreachable Alpha Vantage option-history failure branch. Fallback provider
  failures start at error count 1 instead of inheriting old-provider counts.
- `pr5-ai-chat-nonvision-attachment-parity`: verification passed: focused AI
  chat tests. Coverage includes image/PDF attachments on non-vision models
  returning Rust-shaped invalid-input errors before provider/media support
  checks.
- `pr5-ai-chat-unsupported-media-review-fix`: verification passed: focused AI
  chat tests. Coverage includes unsupported image/PDF subtypes and Ollama PDFs
  returning invalid-input on non-vision models, while vision-enabled unsupported
  provider/media combinations keep explicit 501 gates.
- `pr5-ai-chat-invalid-input-frontend-message`: verification passed: focused
  frontend AI type tests. Coverage includes backend `invalid_input` chat errors
  preserving raw actionable messages while other known codes keep friendly
  frontend text.
- `pr5-ai-chat-uppercase-error-aliases`: verification passed: focused frontend
  AI type tests. Coverage includes Rust-style uppercase AI error codes mapping
  to friendly frontend categories while `INVALID_INPUT` preserves raw actionable
  messages, and stream error rendering now routes through the parser.
- `pr5-data-export-runtime-activity-smoke`: verification passed: focused runtime
  tests. Coverage includes SQLite-backed standalone runtime activity rows
  exported through `/api/v1/utilities/export/activities/json`.
- `pr5-data-export-runtime-portfolio-history-smoke`: verification passed:
  focused runtime tests. Coverage includes SQLite-backed standalone runtime
  TOTAL valuations exported through
  `/api/v1/utilities/export/portfolio-history/json`.
- `pr5-data-export-runtime-goal-smoke`: verification passed: focused runtime
  tests. Coverage includes SQLite-backed standalone runtime goals exported
  through `/api/v1/utilities/export/goals/json`.
- `pr5-data-export-web-adapter-coverage`: verification passed: focused frontend
  adapter tests. Coverage includes backend filename downloads, 204 empty
  exports, and unauthorized/error propagation in the web export adapter.
- `pr5-data-export-electron-proxy-coverage`: verification passed: focused
  Electron command tests. Coverage includes empty export responses and fallback
  filenames when backend `Content-Disposition` is absent.
- `pr5-data-export-runtime-lifecycle-cleanup`: verification passed: focused
  runtime export tests. Activity and portfolio-history export smokes now close
  runtime services even if test seeding fails before server startup.
- `pr5-health-affected-route-encoding`: verification passed: full health domain
  tests. Health affected-item account/holding routes now use Rust-compatible
  `urlencoding::encode` semantics for JS-reserved route characters.
- `pr5-electron-backup-list-delete-proxy`: verification passed: focused Electron
  command tests, frontend Electron settings adapter tests, and backend-contract
  guard tests. Electron now proxies backup list/delete commands through the TS
  sidecar instead of keeping them web-only.
- `pr5-health-http-fix-route-evidence`: verification passed: focused HTTP health
  route test. The health HTTP smoke now covers `/api/v1/health/fix` `executeFix`
  dispatch and Rust-shaped unavailable-provider errors instead of asserting a
  stale deferred route 404.
- `pr5-ai-attachment-error-wording-cleanup`: verification passed: focused AI
  chat attachment tests. Unsupported attachment/provider errors keep explicit
  `not_implemented` 501 behavior but no longer mention the TS backend runtime.
- `pr5-connect-feature-gate-wording-cleanup`: verification passed: focused
  Connect feature-gate tests. Broker activity mapping and disabled broker sync
  profile errors keep explicit `not_implemented` behavior without saying TS
  backend runtime.
- `pr5-electron-database-restore-event`: verification passed: focused Electron
  event adapter tests and Electron type-check. Successful `restore_database`
  sidecar commands now emit `database:restored`, and the Electron adapter
  forwards it to the existing global refresh/toast listener.
- `pr5-electron-activity-parse-adapter-coverage`: verification passed: focused
  frontend Electron activities adapter tests. Coverage proves `File` bytes and
  parse config are forwarded to the `parse_csv` Electron command.
- `pr5-electron-settings-adapter-coverage`: verification passed: focused
  frontend Electron settings adapter tests. Coverage includes backup, backup to
  path, restore, update commands, and platform-info sidecar/runtime delegation.
- `pr5-adapter-command-surface-guard-hardening`: verification passed: focused
  adapter command parity tests. Electron command extraction now reads only the
  exported `ELECTRON_COMMANDS` object and excludes unrelated IPC object keys
  such as file-drop `position`.
- `pr5-backend-contract-command-surface-refresh`: verification passed: focused
  backend-contract command-surface tests. Guard counts now reflect Electron
  backup list/delete command parity: 252 Electron commands, 234 shared commands,
  and one remaining web-only backend command.
- `pr5-electron-connect-import-runs-alias-coverage`: verification passed:
  focused Electron Connect command tests. Coverage includes `get_import_runs`
  alias route/query serialization and malformed numeric query validation.
- `pr5-web-activity-parse-adapter-coverage`: verification passed: focused
  frontend web activities adapter tests. Coverage includes multipart file/config
  POST behavior and backend JSON/text parse error surfacing.
- `pr5-addon-adapter-coverage`: verification passed: focused frontend add-on
  adapter tests. Web and Electron adapters now cover zip byte payload
  conversion, compatibility aliases, enabled/installed reads, and rating bounds
  before submit.
- `pr5-fire-planner-adapter-coverage`: verification passed: focused frontend
  FIRE planner adapter tests. Web/Electron adapters now cover projection, Monte
  Carlo defaults/seed, and sequence-of-returns payloads; stale web desktop-only
  comment removed.
- `pr5-web-ai-streaming-adapter-coverage`: verification passed: focused frontend
  web AI streaming tests. Coverage includes POST request shape, chunked NDJSON
  parsing through terminal `done`, backend JSON error events, and null-body
  network errors.
- `pr5-web-sse-event-adapter-coverage`: verification passed: focused frontend
  web event tests. Coverage includes credentialed EventSource setup,
  JSON/null/raw payload parsing, shared connection cleanup, EventSource
  unavailable errors, and web no-op desktop-only listeners.
- `pr5-event-contract-name-alignment`: verification passed: focused backend
  event and backend-contract tests. Backend SSE tests and add-on host canary
  fixture now use current `portfolio:update-*` and `market:sync-*` event names.
- `pr5-broker-sync-start-global-listener`: verification passed: focused global
  listener hook test. `broker:sync-start` now shows the existing broker sync
  loading toast and participates in listener cleanup.
- `pr5-addon-event-canary-coverage`: verification passed: focused
  backend-contract command-surface tests. Required add-on host canary event
  names are now asserted across TS backend event publisher plus web/Electron
  adapters.
- `pr5-web-settings-backup-adapter-coverage`: verification passed: focused
  frontend web settings adapter tests. Coverage includes server-side
  backup/list/delete/download URL behavior and desktop/native-only backup helper
  rejection.
- `pr5-ai-provider-adapter-coverage`: verification passed: focused frontend
  adapter tests. Shared AI provider adapter coverage includes provider
  reads/mutations/model listing/failure surfacing, and web command parity pins
  provider-id URL encoding for `list_ai_models`.
- `pr5-connect-broker-sync-events`: verification passed: focused Connect broker
  sync and global listener tests. Accepted local broker sync now publishes
  `broker:sync-start` plus Rust-shaped success/error payloads, including
  synced-account setup prompts and account-level failure errors.
- `pr5-broker-sync-toast-race-cleanup`: verification passed: focused broker sync
  hook tests. Loading state now comes from `broker:sync-start` SSE events,
  preventing synchronous TS sync completion from being followed by a stale
  mutation-success loading toast.
- `pr5-connect-import-runs-pagination-hardening`: verification passed: focused
  Connect domain and HTTP route tests. Import-run listing now rejects
  non-positive limits and negative offsets before local DB reads.
- `pr5-broker-sync-new-account-modal-routing`: verification passed: focused
  global listener hook tests. Broker sync "New accounts found" review actions
  now dispatch `open-new-accounts-modal` with synced account details instead of
  navigating away.
- `pr5-web-activity-parse-auth-parity`: verification passed: focused web
  activity adapter tests. HTTP 401 CSV parse responses now notify the global
  auth handler before surfacing the backend parse error.
- `pr5-web-sync-crypto-command-parity`: verification passed: focused web crypto
  and backend-contract tests. Web sync-crypto now uses the same command names as
  Electron for E2EE operations, shrinking Electron-only backend command deltas.
- `pr5-web-parse-csv-command-parity`: verification passed: focused web activity
  and backend-contract tests. Web activity CSV parsing now uses the shared
  `parse_csv` command name while preserving multipart upload, auth handling, and
  parse error wrapping.
- `pr5-web-export-fallback-filename-coverage`: verification passed: focused web
  export adapter tests. No-`Content-Disposition` web exports now have fallback
  filename coverage matching Electron export proxy coverage.
- `pr5-web-export-command-parity`: verification passed: focused web export and
  backend-contract tests. Web data exports now use the shared `export_data_file`
  command while preserving binary payload handling, unauthorized notifications,
  fallback filenames, and save-dialog behavior.
- `pr5-connect-import-run-type-contract`: verification passed: focused Connect
  domain, HTTP, and Electron command tests. Import-run filters now reject
  arbitrary run types and use canonical `SYNC | IMPORT` values across callers.
- `pr5-connect-import-run-type-review-fix`: verification passed. Runtime smoke
  coverage now expects blank `runType` to fail with the canonical
  `SYNC | IMPORT` validation error.
- `pr5-web-parse-csv-blob-pass-through`: verification passed. Web CSV parsing
  now passes the `File` through `parse_csv` as a Blob instead of materializing a
  boxed number array, while preserving numeric content payload compatibility.
- `pr5-minor-currency-normalization-parity`: verification passed. TS
  normalization tables now match Rust for KWF (0.001) and include USX as a USD
  minor unit across activity, holdings, portfolio, exchange-rate, and
  market-data paths.
- `pr5-stale-runtime-wording-cleanup`: verification passed. Remaining migrated
  AI prompt/web adapter wording no longer calls the current chat path a
  TypeScript-backend limitation or shared sync-crypto commands web stubs.
- `pr5-market-data-minor-factor-review-fix`: verification passed. Yahoo
  historical price normalization now uses per-currency factors so KWF applies
  Rust's 0.001 factor instead of a hard-coded 1/100 minor-currency divisor.
- `pr5-check-update-command-alias`: verification passed. Electron now exposes
  the web `check_update` backend command as a sidecar alias while keeping native
  updater commands separate, eliminating the last web-only backend command
  delta.
- `pr5-zero-backend-command-deltas`: verification passed. Web now has
  controlled-error aliases for desktop-only database path backup/restore
  commands, so backend command-surface deltas are zero and only Electron-native
  updater commands remain one-sided.
- `pr5-health-runtime-data-consistency-smoke`: verification passed.
  Runtime-backed `/api/v1/health/check` coverage now seeds SQLite snapshots and
  expects negative latest-position data-consistency issues through real service
  wiring.
- `pr5-health-runtime-orphan-activity-smoke`: verification passed.
  Runtime-backed `/api/v1/health/check` coverage now seeds legacy orphan
  activity references and expects account/asset orphan data-consistency issues
  through the real runtime schema.
- `pr5-health-runtime-negative-balance-smoke`: verification passed.
  Runtime-backed `/api/v1/health/check` coverage now seeds
  `daily_account_valuation` rows and expects negative investment/cash balance
  data-consistency issues through real service wiring.
- `pr5-health-runtime-quote-sync-smoke`: verification passed. Runtime-backed
  `/api/v1/health/check` coverage now seeds `quote_sync_state` rows and expects
  retryable quote-sync price-staleness issues through real service wiring.
- `pr5-health-runtime-fx-integrity-smoke`: verification passed. Runtime-backed
  `/api/v1/health/check` coverage now seeds foreign-currency holdings with
  missing FX quotes and expects `fetch_fx` FX integrity issues through real
  service wiring.
- `pr5-runtime-snapshot-event-portfolio-job-smoke`: verification passed.
  Runtime-backed `POST /api/v1/snapshots` coverage now expects holdings events
  to drive portfolio valuation and goal-summary recalculation through the real
  domain-event worker.
- `pr5-runtime-activity-create-event-smoke`: verification passed. Runtime-backed
  `POST /api/v1/activities` coverage now expects activity events to drive
  transaction snapshot rebuilding and portfolio valuation through the real
  domain-event worker.
- `pr5-runtime-database-backup-routes-smoke`: verification passed.
  Runtime-backed database utility coverage now expects backup, list, download,
  and delete routes to operate against the real app data backup directory.
- `pr5-runtime-activity-update-event-smoke`: verification passed. Runtime-backed
  `PUT /api/v1/activities` coverage now expects activity events to rebuild
  transaction snapshots with updated quantities/cost basis through the real
  domain-event worker.
- `pr5-runtime-activity-delete-event-smoke`: verification passed. Runtime-backed
  `DELETE /api/v1/activities/:id` coverage now expects activity events to
  rebuild transaction snapshots after deletions through the real domain-event
  worker.
- `pr5-runtime-bulk-activity-event-smoke`: verification passed. Runtime-backed
  `POST /api/v1/activities/bulk` coverage now expects activity events to rebuild
  transaction snapshots after bulk creates through the real domain-event worker.
- `pr5-runtime-activity-import-event-smoke`: verification passed. Runtime-backed
  successful `POST /api/v1/activities/import` coverage now expects activity
  events to rebuild transaction snapshots after imports through the real
  domain-event worker.
- `pr5-runtime-bulk-activity-update-delete-smoke`: verification passed.
  Runtime-backed `POST /api/v1/activities/bulk` coverage now expects existing
  row updates and `deleteIds` to rebuild transaction snapshots through the real
  domain-event worker.
- `pr5-runtime-account-update-event-smoke`: verification passed. Runtime-backed
  `PUT /api/v1/accounts/:id` coverage now expects account events to drive
  portfolio valuation and goal-summary recalculation through the real
  domain-event worker.
- `pr5-runtime-asset-profile-event-smoke`: verification passed. Runtime-backed
  `PUT /api/v1/assets/profile/:id` coverage now expects asset events to drive
  portfolio valuation recalculation through the real domain-event worker.
- `pr5-runtime-asset-quote-mode-event-smoke`: verification passed.
  Runtime-backed `PUT /api/v1/assets/pricing-mode/:id` coverage now expects
  asset events to drive portfolio valuation recalculation through the real
  domain-event worker.
- `pr5-runtime-tracking-mode-event-smoke`: verification passed. Runtime-backed
  `PUT /api/v1/accounts/:id` coverage now expects HOLDINGS-to-TRANSACTIONS
  tracking-mode events to rebuild transaction snapshots through the real
  domain-event worker.
- `pr5-runtime-asset-create-enrichment-smoke`: verification passed.
  Runtime-backed `POST /api/v1/assets` coverage now expects asset-created events
  to drive the asset enrichment worker without provider fetches for manual
  property assets.
- `pr5-runtime-snapshot-import-event-smoke`: verification passed. Runtime-backed
  `POST /api/v1/snapshots/import` coverage now expects holdings events to drive
  portfolio valuation recalculation through the real domain-event worker.
- `pr5-runtime-snapshot-delete-event-smoke`: verification passed. Runtime-backed
  `DELETE /api/v1/snapshots` coverage now expects holdings events to remove
  stale valuation rows for deleted manual snapshots through the real
  domain-event worker; review follow-ups now flush after save first and prove
  account-level plus aggregate TOTAL valuation rows exist before deletion and
  are removed afterward.
- `pr5-runtime-portfolio-crud-sync-outbox-smoke`: verification passed.
  Runtime-backed portfolio CRUD route coverage now expects
  `POST/GET/PUT/DELETE /api/v1/portfolios` to persist portfolio and
  portfolio-account sync_outbox callbacks.
- `pr5-runtime-contribution-limit-route-smoke`: verification passed.
  Runtime-backed contribution-limit CRUD route coverage now expects
  `POST/GET/PUT/DELETE /api/v1/limits` to persist contribution-limit sync_outbox
  callbacks and trigger portfolio events.
- `pr5-runtime-custom-provider-test-source-route-smoke`: verification passed.
  Runtime-backed custom-provider coverage now expects
  `POST /api/v1/custom-providers/test-source` to perform provider fetch,
  extraction, and preview shaping through the HTTP seam.
- `pr5-runtime-taxonomy-route-sync-outbox-smoke`: verification passed.
  Runtime-backed taxonomy/category/assignment route coverage now expects HTTP
  routes to persist custom-taxonomy and asset-taxonomy-assignment sync_outbox
  callbacks.
- `pr5-runtime-goal-route-sync-outbox-smoke`: verification passed.
  Runtime-backed goal route coverage now expects goal create/update/delete and
  funding replacement HTTP routes to persist goal and goals_allocation
  sync_outbox callbacks.
- `pr5-runtime-goal-plan-route-sync-outbox-smoke`: verification passed.
  Runtime-backed goal-plan route coverage now expects save-up plan
  create/update/get/delete HTTP routes to persist goal_plan sync_outbox
  callbacks.
- `pr5-runtime-account-route-sync-outbox-smoke`: verification passed.
  Runtime-backed account route coverage now expects account create/update/list
  and delete HTTP routes to persist account sync_outbox callbacks.
- `pr5-runtime-asset-route-sync-outbox-smoke`: verification passed.
  Runtime-backed asset route coverage now expects asset create/profile
  update/pricing-mode update/delete HTTP routes to persist asset sync_outbox
  callbacks.
- `pr5-runtime-import-template-route-sync-outbox-smoke`: verification passed.
  Runtime-backed import-template route coverage now expects template
  create/list/get/link/delete HTTP routes to persist import_template and
  activity_import_profile sync_outbox callbacks.
- `pr5-account-create-sync-outbox-provider-filter`: verification passed. TS
  account sync now suppresses account Create sync_outbox rows for broker-linked
  accounts with provider_account_id, matching Rust, while local account
  create/update/delete sync rows remain covered.
- `pr5-runtime-alternative-asset-route-sync-outbox-smoke`: verification passed.
  Runtime-backed alternative-asset route coverage now expects create/valuation
  update/delete HTTP routes to persist asset and quote sync_outbox callbacks and
  trigger portfolio recalculation.
- `pr5-runtime-quote-delete-route-sync-outbox-smoke`: verification passed.
  Runtime-backed market-data quote delete route coverage now expects
  `DELETE /api/v1/market-data/quotes/id/:id` to persist quote delete sync_outbox
  callbacks and trigger portfolio recalculation.
- `pr5-runtime-ai-chat-route-sync-outbox-smoke`: verification passed.
  Runtime-backed AI chat route coverage now expects thread update/delete, tag
  create/delete, and tool-result update HTTP routes to persist ai_thread,
  ai_thread_tag, and ai_message sync_outbox callbacks.
- `pr5-runtime-quote-update-route-sync-outbox-smoke`: verification passed.
  Runtime-backed market-data quote update route coverage now expects
  `PUT /api/v1/market-data/quotes/:assetId` to persist UUID manual quote update
  sync_outbox callbacks and trigger portfolio recalculation.
- `pr5-runtime-quote-import-route-sync-outbox-smoke`: verification passed.
  Runtime-backed market-data quote import route coverage now expects
  `POST /api/v1/market-data/quotes/import` to persist UUID manual quote update
  sync_outbox callbacks while deterministic non-UUID manual imports remain
  local-only.
- `pr5-runtime-quote-update-route-explicit-id-review-fix`: verification passed.
  Runtime-backed quote update route coverage now includes real explicit-ID
  manual quote edits and expects Rust-compatible UUID delete/recreate sync
  behavior alongside id-less UUID update sync.
- `pr5-runtime-snapshot-route-sync-outbox-smoke`: verification passed.
  Runtime-backed holdings snapshot route coverage now expects
  `POST/DELETE /api/v1/snapshots` to persist manual, synthetic, and delete
  snapshot sync_outbox callbacks.
- `pr5-runtime-activity-route-sync-outbox-smoke`: verification passed.
  Runtime-backed activity route coverage now expects `POST/PUT/DELETE` activity
  routes to persist create/update/delete activity sync_outbox callbacks with
  Rust-compatible user-modified flags.
- `pr5-runtime-explicit-quote-edit-recreate-review-fix`: verification passed.
  Runtime-backed quote update route coverage now also verifies the deterministic
  manual quote row is recreated after the UUID delete sync_outbox callback.
- `pr5-runtime-bulk-activity-route-sync-outbox-smoke`: verification passed.
  Runtime-backed bulk activity route coverage now expects
  `POST /api/v1/activities/bulk` to persist delete/update/create activity
  sync_outbox callbacks in Rust-compatible bulk operation order.
- `pr5-runtime-activity-import-route-sync-outbox-smoke`: verification passed.
  Runtime-backed activity import route coverage now expects
  `POST /api/v1/activities/import` to persist import_run and imported activity
  sync_outbox callbacks.
- `pr5-runtime-transfer-link-route-sync-outbox-smoke`: verification passed.
  Runtime-backed transfer link route coverage now expects activity link/unlink
  HTTP routes to persist paired activity update sync_outbox callbacks with
  user-modified transfer metadata.
- `pr5-runtime-exchange-rate-route-event-smoke`: verification passed.
  Runtime-backed exchange-rate route coverage now expects create/update/delete
  HTTP routes to enqueue portfolio recalculation jobs.
- `pr5-runtime-activity-import-lifecycle-review-fix`: verification passed. TS
  activity imports now mirror Rust import-run lifecycle with RUNNING create,
  imported activity create, and APPLIED update sync_outbox callbacks; transfer
  route coverage verifies flow metadata transitions, and exchange-rate route
  coverage verifies one portfolio completion per mutation.
- `pr5-runtime-import-mapping-route-sync-outbox-smoke`: verification passed.
  Runtime-backed import-mapping route coverage now expects save/get HTTP routes
  to preserve account-template link identity and persist activity_import_profile
  sync_outbox callbacks.
- `pr5-runtime-liability-link-route-sync-outbox-smoke`: verification passed.
  Runtime-backed liability link route coverage now expects alternative-asset
  liability link/unlink HTTP routes to persist the Rust-compatible liability
  asset update callback while unlink remains local/no-op.
- `pr5-runtime-alternative-metadata-route-sync-outbox-smoke`: verification
  passed. Runtime-backed alternative-asset metadata route coverage now expects
  metadata update HTTP routes to persist asset update and UUID manual quote
  create sync_outbox callbacks.
- `pr5-runtime-market-sync-route-event-smoke`: verification passed.
  Runtime-backed market-data sync route coverage now expects
  `POST /api/v1/market-data/sync` to enqueue portfolio jobs and emit
  market/portfolio lifecycle events without live provider fetches for empty
  explicit targets.
- `pr5-runtime-settings-timezone-route-event-smoke`: verification passed.
  Runtime-backed settings route coverage now expects timezone updates through
  `PUT /api/v1/settings` to enqueue portfolio recalculation jobs.
- `pr5-runtime-settings-base-currency-route-event-smoke`: verification passed.
  Runtime-backed settings route coverage now expects base-currency updates
  through `PUT /api/v1/settings` to enqueue full portfolio recalculation with
  market-sync lifecycle events.
- `pr5-runtime-event-route-config-review-fix`: verification passed.
  Runtime-backed route smokes now capture portfolio job configs for market-data
  sync, settings timezone, settings base-currency, and exchange-rate mutations
  rather than relying only on lifecycle event names.
- `pr5-runtime-provider-settings-route-smoke`: verification passed.
  Runtime-backed provider settings route coverage now expects GET/PUT provider
  settings routes to persist provider priority/enabled state and preserve
  priority ordering.
- `pr5-runtime-connect-sync-route-event-smoke`: verification passed.
  Runtime-backed Connect sync route coverage now expects
  `POST /api/v1/connect/sync` to emit broker sync start/complete events with
  connection, account, and activity summary payloads.
- `pr5-runtime-ai-provider-route-smoke`: verification passed. Runtime-backed AI
  provider route coverage now expects provider settings/default HTTP routes to
  persist selected model, priority, favorite models, tool allowlist, and default
  provider state.
- `pr5-runtime-connect-external-sync-outbox-suppression`: verification passed.
  Runtime-backed Connect broker route coverage now expects broker-created
  external platforms/accounts not to enqueue local platform/account sync_outbox
  rows.
- `pr5-runtime-ai-provider-models-route-smoke`: verification passed.
  Runtime-backed AI provider model-listing route coverage now injects the AI
  model fetch seam and expects `/api/v1/ai/providers/:id/models` to call the
  expected provider endpoint without live network access.
- `pr5-runtime-ai-provider-openai-models-route-smoke`: verification passed.
  Runtime-backed AI provider model-listing route coverage now also expects
  API-key-backed OpenAI model listing to read the runtime secret service and
  send the expected Authorization header.
- `pr5-runtime-device-sync-transfer-route-smoke`: verification passed.
  Runtime-backed device-sync pairing transfer route coverage now passes
  env/fetch seams into device-sync and expects complete-with-transfer success
  with clear outbox, then pending sync_outbox gating before cloud complete
  calls.
- `pr5-runtime-device-sync-bootstrap-confirm-route-smoke`: verification passed.
  Runtime-backed device-sync bootstrap confirm route coverage now expects
  confirm-with-bootstrap to return already_complete when local bootstrap is
  complete while still sending expected cloud confirm request metadata.
- `pr5-runtime-device-sync-overwrite-required-route-smoke`: verification passed.
  Runtime-backed device-sync bootstrap confirm route coverage now expects
  confirm-with-bootstrap to report local overwrite risk before snapshot polling
  when bootstrap is required and local user data exists.
- `pr5-runtime-device-sync-pairing-flow-approval-route-smoke`: verification
  passed. Runtime-backed device-sync pairing flow coverage now expects flow
  begin to return overwrite_required for local data, approve-overwrite to
  transition to waiting_snapshot when no cloud snapshot exists, and flow state
  to preserve the waiting status.
- `pr5-runtime-device-sync-pairing-flow-cancel-route-smoke`: verification
  passed. Runtime-backed device-sync pairing flow cancel coverage now expects
  flow cancel to reach cloud cancel/delete best-effort calls, remove the flow,
  clear local sync identity while preserving nonce, delete the legacy device-id
  secret, and reset local sync session config.
- `pr5-runtime-device-sync-pairing-flow-begin-success-route-smoke`: verification
  passed. Runtime-backed device-sync pairing flow begin coverage now expects
  flow begin to return a Rust-shaped success phase after cloud confirm when
  local bootstrap is already complete, without polling snapshot metadata.
- `pr5-runtime-device-sync-route-review`: dual-model review passed. Claude Opus
  4.8 xhigh and GPT-5.5 xhigh reviewed the latest overwrite-required,
  pairing-flow begin, approve-overwrite, and cancel-cleanup runtime route smokes
  and found no actionable issues.
- `pr5-runtime-device-sync-pairing-flow-begin-waiting-route-smoke`: verification
  passed. Runtime-backed device-sync pairing flow begin coverage now expects
  clear local data to skip overwrite prompts, poll latest snapshot metadata, and
  store a waiting_snapshot flow when the cloud has no snapshot yet.
- `pr5-runtime-device-sync-pairing-flow-snapshot-error-route-smoke`:
  verification passed. Runtime-backed device-sync pairing flow approval coverage
  now expects newer snapshot schema metadata to surface the Rust-shaped terminal
  error before bootstrap apply and remove the flow.
- `pr5-runtime-device-sync-bootstrap-confirm-waiting-route-smoke`: verification
  passed. Runtime-backed device-sync confirm-with-bootstrap coverage now expects
  clear local data to skip overwrite prompts, poll latest snapshot metadata, and
  return the Rust-shaped waiting_snapshot response when the cloud has no
  snapshot yet.
- Follow-ups: continue other low-risk domain slices; broader health
  price/quote/FX/classification/consistency checks and real market sync fix
  execution move with the health/calculation services; the automatic FX market
  sync/provider HTTP behavior plus broader market-data provider resolution/sync
  behavior move with calculation/market-data slices after the current FX
  registration/no-op/portfolio-recalculation parity and explicit runtime 501
  gates; background portfolio worker orchestration moves with
  portfolio/calculation slices after the current bounded portfolio
  valuation/activity-replay runtime; cross-platform keyring CI moves with a
  dedicated runtime parity slice; AI chat richer provider/tool orchestration and
  any future Ollama PDF support move with AI runtime parity slices if Ollama
  documents non-image file inputs; asset quote-provider interactions and broader
  provider-driven portfolio recalculation side effects move with
  asset/market-data/portfolio parity slices after direct profile and quote-mode
  route recalculation coverage; remaining provider breadth and background
  orchestration move with market-data/portfolio parity slices; remaining
  provider-backed symbol fetch/resolution and sync breadth moves with
  market-data/provider parity slices; full portfolio snapshot rebuilding side
  effects move with holdings/portfolio parity slices; add-on security scanning,
  full sandbox isolation, and query-cache hardening move with add-on runtime
  parity slices; provider-backed asset resolution, remaining quote sync-outbox
  emission outside migrated alternative-asset and market-data quote paths,
  remaining activity/provider-backed asset resolution beyond import flows, sync
  engine push/pull, and portfolio recalculation side effects move with
  activities/import/device-sync runtime parity slices; device-sync integration
  for sync crypto moves with device-sync parity slices; broader health checks
  and real market sync fix execution move with health/calculation parity slices;
  real Connect token lifecycle, cloud HTTP clients, broker sync orchestration,
  subscription entitlement checks, event production, E2EE enrollment, sync
  engine, trusted-device snapshot/upload runtime, feature-flag errors,
  background workers, device-sync cloud clients, token lifecycle, team-key
  operations, key material handling, pairing flows, remaining freshness gate
  persistence, bootstrap transfer, and remaining secret side effects move with
  Connect/device-sync parity slices.
