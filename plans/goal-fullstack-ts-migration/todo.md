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
    dividends, symbol search, and resolve-currency now have TS runtime parity;
    activities import mapping/template storage, duplicate lookup, read-only
    search, transfer link/unlink, single delete behavior, bounded
    existing-asset/cash create/update/bulk persistence, symbol-only resolution
    to existing assets, bounded symbol-based asset creation from explicit
    metadata, CSV parse, and read-only import asset preview now have TS runtime
    parity; save-up and retirement goal-plan writes plus save-up preview
    calculations and save-up goal overview service logic now have bounded TS
    runtime parity; non-retirement and no-plan retirement summary refresh
    service logic, guarded valuation-provider HTTP route seams, standalone
    runtime valuation-map construction, refresh-all summary routing, save-time
    summary refresh side effects, Rust-compatible retirement input preparation,
    deterministic retirement calculation primitives, deterministic
    required-capital/projection engine behavior, deterministic retirement
    overview assembly, HTTP retirement overview routing, plan-backed retirement
    summary refresh, retirement projection routing, Monte Carlo routing,
    scenario-analysis routing, sequence-of-returns routing, stress-tests
    routing, and decision-sensitivity routing now have bounded TS runtime
    parity; automatic FX market sync/provider HTTP behavior plus broader
    market-data sync behavior are deferred to calculation/market-data slices;
    actual portfolio job execution and event production are deferred to
    portfolio/calculation slices; TS file-backed secret persistence is wired
    into standalone runtime while real keyring integration is deferred to a
    runtime/keyring parity slice; AI provider catalog/settings/model-listing
    runtime behavior is wired into standalone runtime while AI chat execution is
    deferred to AI runtime parity slices; alternative asset persistence, manual
    valuation quotes, liability link/unlink metadata behavior, and holdings
    reads now have TS runtime parity, while portfolio job enqueue and
    recalculation side effects are deferred to portfolio parity slices; asset
    read/create/profile/quote-mode and delete behavior now have TS runtime
    parity, while quote-provider interactions, auto-classification, and
    portfolio recalculation side effects are deferred to
    asset/market-data/portfolio parity slices; app utility database restore now
    has TS runtime parity with restart-required readiness after file restore;
    contribution-limit deposit calculation now has TS runtime parity with SQLite
    activity reads, Rust-compatible contribution rules, user-timezone year
    ranges, and FX conversion dates; current/history net-worth, income summary,
    simple account performance, account performance history/summary
    calculations, holdings valuation reads, holdings snapshot metadata reads,
    historical snapshot holdings reads, holdings import checks, live holdings
    fan-out, holding detail/by-asset fan-out, allocation reads, snapshot
    deletion, bounded manual/imported snapshot saves, snapshot FX pair
    registration, and holdings snapshot mutation event production now have TS
    runtime parity, while provider-backed symbol performance history is deferred
    to portfolio/market-data parity slices; actual portfolio job execution and
    inline valuation recalculation are deferred to holdings/portfolio parity
    slices; add-on filesystem extraction, runtime loading, store HTTP, staging
    I/O, and update behavior are deferred to add-on runtime parity slices;
    market-data market sync and portfolio recalculation behavior are deferred to
    market-data/portfolio parity slices; activity mutation event production,
    activity sync-event callback queuing, and domain-event planning/batch
    processing/worker helper now have TS runtime parity, while provider-backed
    asset resolution, import-run/asset sync outbox follow-ups, real sync_outbox
    persistence/runtime wiring, and portfolio recalculation side effects are
    deferred to activities/import/device-sync runtime parity slices; AI chat
    persistence and tool-result mutation now have TS runtime parity, while
    provider streaming, tool execution, tag persistence, and attachments are
    deferred to AI runtime parity slices; device-sync integration for sync
    crypto is deferred to device-sync runtime parity slices; bounded
    account/timezone health status/checks, cache behavior, legacy-classification
    health issues, and classification migration health-fix dispatch now have TS
    runtime parity, while calculation-heavy health checks, market sync fix
    execution, and non-classification `/health/fix` dispatch are deferred to
    health/calculation parity slices; real Connect token lifecycle, cloud HTTP
    clients, broker sync orchestration, local sync repositories, subscription
    entitlement checks, event production, E2EE enrollment, sync engine,
    snapshot/upload runtime, feature-flag errors, background workers,
    device-sync cloud clients, token lifecycle, team-key operations, key
    material handling, pairing flows, freshness gate persistence, bootstrap
    transfer, and secret side effects are deferred to Connect/device-sync parity
    slices.
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
  Coverage includes `WF_DB_PATH` precedence over `DATABASE_URL`, explicit/env
  app-data and migration-dir resolution, migration replay into a temporary DB,
  standalone TS server startup with SQLite-backed settings/accounts routes,
  settings persistence through the runtime handler, and idempotent runtime
  close.
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
  wiring, and portfolio recalculation remain deferred.
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
  attachment handling, tag mutations, and device-sync outbox writes remain
  deferred.
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
  empty responses, and explicit 501 gating for provider-backed symbol history.
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
  flush-time failure propagation while real runtime service wiring remains
  deferred.

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
  chat thread/message persistence, non-retirement/no-plan retirement summary
  refresh service logic, deterministic retirement calculation primitives,
  projection engine, overview assembly, guarded retirement overview HTTP
  routing, plan-backed retirement summary refresh, retirement projection
  routing, Monte Carlo routing, scenario-analysis routing, sequence-of-returns
  routing, stress-tests routing, decision-sensitivity routing, bounded health
  status/check slices, bounded health classification-fix runtime, bounded
  legacy-classification health issue runtime, current/history net-worth runtime,
  income summary runtime, simple account performance runtime, account
  performance history/summary runtime, holdings valuation read runtime, holdings
  snapshot metadata/runtime conversion/import-check reads, live holdings fan-out
  runtime, holding detail/by-asset fan-out runtime, allocation read runtime,
  snapshot deletion runtime, bounded manual snapshot save runtime, and bounded
  snapshot import-write runtime plus snapshot FX pair registration,
  provider-backed import-check lookup, holdings snapshot event production, and
  activity mutation event production plus domain-event planning/batch
  processing/worker helper implemented; broader migration remains active.
- Follow-ups: continue other low-risk domain slices; broader health
  price/quote/FX/classification/consistency checks and non-classification
  `/health/fix` execution move with the health/calculation services; the
  automatic FX market sync/provider HTTP behavior plus broader market-data
  provider resolution/sync behavior move with calculation/market-data slices;
  actual portfolio job execution moves with portfolio/calculation slices; OS
  keyring integration moves with a dedicated runtime parity slice; AI chat
  provider streaming, title generation, tool execution, tag mutations,
  attachment handling, and outbox writes move with AI runtime parity slices;
  alternative asset portfolio job enqueue and recalculation side effects move
  with portfolio parity slices; asset quote-provider interactions,
  auto-classification, and portfolio recalculation side effects move with
  asset/market-data/portfolio parity slices; market-data market sync and
  quote-triggered recalculation side effects move with market-data/portfolio
  parity slices; provider-backed symbol performance history moves with
  market-data/provider parity slices; portfolio recalculation side effects move
  with holdings/portfolio parity slices; add-on filesystem extraction, runtime
  loading, store HTTP, staging I/O, and update behavior move with add-on runtime
  parity slices; provider-backed asset resolution, device-sync outbox emission
  for activity writes, and portfolio recalculation side effects move with
  activities/import runtime parity slices; device-sync integration for sync
  crypto moves with device-sync parity slices; broader health checks, market
  sync fix execution, and non-classification `/health/fix` dispatch move with
  health/calculation parity slices; real Connect token lifecycle, cloud HTTP
  clients, broker sync orchestration, local sync repositories, subscription
  entitlement checks, event production, E2EE enrollment, sync engine,
  snapshot/upload runtime, feature-flag errors, background workers, device-sync
  cloud clients, token lifecycle, team-key operations, key material handling,
  pairing flows, freshness gate persistence, bootstrap transfer, and secret side
  effects move with Connect/device-sync parity slices.
