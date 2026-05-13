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
    provider, AI chat, sync crypto, alternative assets, assets, app utilities,
    portfolio metrics, holdings, add-ons, market-data, and activities TS
    repository/service or route config implementations plus guarded route tests
    in `apps/backend/src/domains/settings.ts`,
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
    `apps/backend/src/domains/sync-crypto.ts`, `apps/backend/src/events.ts`, and
    `apps/backend/src/http.test.ts`. Health status/check/fix and taxonomy
    migration endpoints are deferred to the health/classification service slice;
    custom provider `test-source` is deferred to an external-I/O slice; goals
    plan writes and calculation endpoints are deferred to calculation-heavy
    slices; FX converter/history and provider sync behavior plus broader
    market-data quote/search/import/sync behavior are deferred to
    calculation/market-data slices; actual portfolio job execution and event
    production are deferred to portfolio/calculation slices; real secret
    persistence/keyring integration is deferred to a runtime/keyring parity
    slice; AI provider catalog/settings/model-listing runtime behavior is
    deferred to AI/secrets parity slices; alternative asset
    persistence/quotes/holdings/job behavior is deferred to asset/portfolio
    parity slices; asset persistence/profile/quote-mode behavior is deferred to
    asset/market-data/portfolio parity slices; app runtime metadata,
    update-check HTTP/cache, backup/restore I/O, and path normalization are
    deferred to app utility parity slices; portfolio metric calculations are
    deferred to portfolio calculation parity slices; holdings fan-out,
    valuations, allocations, snapshots, imports, and portfolio recalculation
    side effects are deferred to holdings/portfolio parity slices; add-on
    filesystem extraction, runtime loading, store HTTP, staging I/O, and update
    behavior are deferred to add-on runtime parity slices; exchange metadata,
    provider HTTP, Yahoo dividends, quote import/persistence, market sync, and
    portfolio recalculation behavior are deferred to market-data/portfolio
    parity slices; activity persistence, import parsing/mapping/template
    storage, duplicate lookups, transfer mutation behavior, asset preview
    resolution, and portfolio recalculation side effects are deferred to
    activities/import runtime parity slices; AI chat persistence, provider
    streaming, tool execution, thread storage, tag persistence, and tool-result
    mutation behavior are deferred to AI runtime parity slices; real sync crypto
    implementation, key material handling, WebCrypto/libsodium selection, and
    device-sync integration are deferred to sync-crypto/device-sync parity
    slices; real health checks, classification migration, market sync fix
    execution, health cache behavior, and taxonomy/asset side effects are
    deferred to health/classification parity slices.
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
  health/classification route seam slices implemented; broader migration remains
  active.
- Follow-ups: continue other low-risk domain slices; taxonomy migration/health
  endpoints move with the health/classification services; custom provider
  `test-source` moves with external-I/O services; goals plan write/delete,
  summary refresh, save-up overview, and retirement simulation endpoints move
  with calculation-heavy goal slices; FX converter/history/register-pair and
  provider sync plus broader market-data quote/search/import/sync behavior move
  with calculation/market-data slices; actual portfolio job execution and event
  production move with portfolio/calculation slices; real secret persistence and
  keyring integration move with a dedicated runtime parity slice; AI provider
  catalog/settings/model-listing runtime behavior moves with AI/secrets parity
  slices; alternative asset persistence/quotes/holdings/job behavior moves with
  asset/portfolio parity slices; asset persistence/profile/quote-mode behavior
  moves with asset/market-data/portfolio parity slices; app runtime metadata,
  update-check HTTP/cache, backup/restore I/O, and path normalization move with
  app utility parity slices; portfolio metric calculations move with portfolio
  calculation parity slices; holdings fan-out, valuations, allocations,
  snapshots, imports, and portfolio recalculation side effects move with
  holdings/portfolio parity slices; add-on filesystem extraction, runtime
  loading, store HTTP, staging I/O, and update behavior move with add-on runtime
  parity slices; exchange metadata, provider HTTP, Yahoo dividends, quote
  import/persistence, market sync, and portfolio recalculation behavior move
  with market-data/portfolio parity slices; activity persistence, import
  parsing/mapping/template storage, duplicate lookups, transfer mutation
  behavior, asset preview resolution, and portfolio recalculation side effects
  move with activities/import runtime parity slices; AI chat persistence,
  provider streaming, tool execution, thread storage, tag persistence, and
  tool-result mutation behavior move with AI runtime parity slices; real sync
  crypto implementation, key material handling, WebCrypto/libsodium selection,
  and device-sync integration move with sync-crypto/device-sync parity slices;
  real health checks, classification migration, market sync fix execution,
  health cache behavior, and taxonomy/asset side effects move with
  health/classification parity slices.
