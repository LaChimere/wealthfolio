# Goal State

<!-- prettier-ignore-start -->
objective: "开始为项目进行全栈迁移至 ts。你可以多进行深度调研来了解项目，实现的时候进行原子化 commit，并且频繁进行多轮 review 和 refine 来及时确保项目采用的是最佳实践的方式来实现和迁移的。你的最终目的是完整迁移。"
status: active
slug: "goal-fullstack-ts-migration"
turns_used: 52
turn_budget: null
docs_update_approved: true
created_at: "2026-05-13T21:33:49+08:00"
updated_at: "2026-05-14T12:54:12+08:00"
<!-- prettier-ignore-end -->

## Acceptance criteria

### User-visible behavior

- Electron desktop and web mode run from a TypeScript/Bun backend without
  requiring a Rust sidecar or Rust web server at runtime.
- Existing portfolio, account, activity, asset, goals, health, AI, add-on,
  Connect, device-sync, secrets, imports, backups, update, and native desktop
  workflows remain behaviorally compatible.
- Existing SQLite user data can be opened, migrated, backed up, and restored by
  the TypeScript backend without data loss.

### Implementation scope

- Replace `apps/server` and `crates/*` Rust runtime responsibilities with
  TypeScript/Bun packages while keeping Electron main/preload and frontend
  adapter APIs stable during migration.
- Preserve API/IPC command names, request/response shapes, event names, database
  schema semantics, and addon-facing host APIs until explicit compatibility
  changes are designed.
- Add a parity harness that can compare Rust and TypeScript behavior during the
  transition before removing the Rust implementation.
- Remove Rust build, package, sidecar, CI, release, and documentation paths only
  after TypeScript parity is proven.

### Validation

- Use contract/golden tests against existing Rust behavior for every migrated
  domain, especially calculations, imports, migrations, sync, secrets, and
  crypto.
- Keep `bun run check`, targeted TypeScript tests, Electron tests, web tests,
  and relevant integration/e2e checks passing at every slice.
- Run repeated self-review plus rubber-duck/code-review/pr-review refinement for
  high-risk slices before advancing.

### Docs/status

- Maintain
  `plans/goal-fullstack-ts-migration/{goal.md,research.md,design.md,plan.md,todo.md}`
  as the migration status anchor.
- Update `README.md`, `AGENTS.md`, architecture docs, release docs, and
  developer runbooks when confirmed changes make Rust-sidecar instructions
  stale.

### Deferred/out of scope

- Cosmetic UI redesign is out of scope. reason=out_of_scope
- Product feature expansion unrelated to Rust-to-TypeScript parity is out of
  scope. reason=out_of_scope

## Progress log

- Turn 0: Goal registered. Initial workflow classification requires research and
  design because this is a correctness-critical, multi-component backend rewrite
  with data, API, security, sync, and release impacts.
- Turn 1: Captured architecture research, drafted staged TS migration design,
  ran rubber-duck design review, and refined the design to address SQLite stack,
  dual-writer, normalization, keyring, device-sync, addon, rollback, benchmark,
  and CI risks before Gate 1.
- Turn 2: Implemented and refined the low-risk accounts TS domain slice:
  repository/service behavior, guarded HTTP routes, Rust-parity validation and
  events, transaction-bound create/update readbacks, orphaned asset cleanup
  hooks, and targeted backend tests.
- Turn 3: Implemented the low-risk contribution limits TS domain slice: CRUD
  repository/service parity, guarded `/api/v1/limits` routes, lightweight
  portfolio update hooks, empty-account deposits parity, injectable future
  deposit calculation, targeted backend tests, and review.
- Turn 4: Started the taxonomies TS migration as a smaller atomic sub-slice:
  read repository/service models, guarded `/api/v1/taxonomies` read routes,
  ordering/date/boolean parity coverage, and targeted backend checks.
- Turn 5: Extended the taxonomies TS slice with taxonomy/category create,
  update, delete, move-category behavior, custom-taxonomy sync hooks, system
  delete guards, child/assignment delete guards, guarded mutation routes, and
  targeted backend tests.
- Turn 6: Added the taxonomies assignment TS sub-slice: asset assignment reads,
  upsert conflict parity, single-select replacement behavior, delete behavior,
  optional assignment sync hooks, guarded assignment HTTP routes, and targeted
  backend tests.
- Turn 7: Completed the low-risk taxonomy import/export TS sub-slice: Portfolio
  Performance-compatible JSON parsing, recursive category flattening/export tree
  reconstruction, ignored instrument mappings parity, guarded import/export HTTP
  routes, and targeted backend tests.
- Turn 8: Implemented the low-risk custom provider CRUD TS slice: provider
  list/create/update/delete behavior, source config parsing, reserved-code and
  source validation, asset-reference delete guards, sync hooks keyed by provider
  UUID, guarded HTTP routes, and targeted backend tests.
- Turn 9: Implemented the scoped goals TS slice for base persistence: goal
  list/get/create/update/delete behavior, funding rule reads/replacement,
  read-only goal plan access, base-currency forcing at the HTTP seam, retirement
  seed funding, lifecycle/retirement uniqueness/capacity/DC-link guards, sync
  hooks, guarded HTTP routes, and targeted backend tests.
- Turn 10: Implemented the local exchange-rate TS slice: latest FX reads,
  add/update/delete behavior, FX asset creation, quote upserts, provider-config
  parity for common providers, asset sync hooks, guarded HTTP routes, and
  targeted backend tests.
- Turn 11: Implemented the low-risk health local-state TS slice: issue dismissal
  save/replace/restore/list behavior, in-memory health config defaults and
  validation, guarded `/api/v1/health/{dismiss,restore,dismissed,config}`
  routes, explicit deferred health status/check/fix behavior, and targeted
  backend tests.
- Turn 12: Implemented the low-risk market-data provider settings TS slice:
  provider info reads, priority/enabled updates, capabilities/API-key metadata,
  quote-sync asset/error stats, guarded `/api/v1/providers` and
  `/api/v1/providers/settings` routes, explicit deferred market-data
  search/quotes/sync behavior, and targeted backend tests.
- Turn 13: Implemented the low-risk portfolio job trigger TS slice: request
  normalization for update/recalculate jobs, Rust-compatible default market-sync
  modes, full vs incremental recalculation config, guarded
  `/api/v1/portfolio/{update,recalculate}` routes, explicit deferred SSE/job
  execution behavior, and targeted backend tests.
- Turn 14: Implemented the low-risk backend event stream TS slice: event bus SSE
  formatting, keep-alive stream plumbing, guarded `/api/v1/events/stream` route,
  exported stream helpers, and targeted backend tests.
- Turn 15: Implemented the low-risk secrets HTTP seam TS slice: injectable
  `SecretService`, guarded `/api/v1/secrets` set/get/delete route, validation
  for secret body/query input, and targeted backend tests.
- Turn 16: Implemented the low-risk AI provider HTTP seam TS slice: injectable
  `AiProviderService`, guarded `/api/v1/ai/providers` read/update/default/model
  routes, request validation, JSON `null` mutation responses, and targeted
  backend tests.
- Turn 17: Implemented the low-risk alternative assets HTTP seam TS slice:
  injectable `AlternativeAssetService`, guarded
  `/api/v1/alternative-assets`/`/api/v1/alternative-holdings` routes, request
  validation, decoded path IDs, 204 mutation responses, and targeted backend
  tests.
- Turn 18: Implemented the low-risk assets HTTP seam TS slice: injectable
  `AssetService`, guarded `/api/v1/assets` list/profile/create/update/quote-mode
  and delete routes, query/path decoding, quoteMode/pricingMode alias handling,
  null-as-omitted option behavior, and targeted backend tests.
- Turn 19: Implemented the low-risk app utility HTTP seam TS slice: injectable
  `AppUtilityService`, guarded `/api/v1/app/*` and
  `/api/v1/utilities/database/*` routes, update-check query parsing,
  backup/restore request validation, 204 restore responses, corrected
  `/settings/auto-update-enabled`, and targeted backend tests.
- Turn 20: Implemented the low-risk portfolio metrics HTTP seam TS slice:
  injectable `PortfolioMetricsService`, guarded `/api/v1/net-worth`,
  `/api/v1/performance/*`, and `/api/v1/income/summary` routes, date validation,
  empty account-list short-circuiting, tracking-mode parsing, and targeted
  backend tests.
- Turn 21: Implemented the low-risk holdings HTTP seam TS slice: injectable
  `HoldingsService`, guarded `/api/v1/holdings`, `/api/v1/valuations`,
  `/api/v1/allocations`, and `/api/v1/snapshots` routes, query/body/date
  validation, ordered repeated account ID parsing, null option normalization,
  200/204 mutation status parity, and targeted backend tests.
- Turn 22: Implemented the low-risk add-ons HTTP seam TS slice: injectable
  `AddonService`, guarded `/api/v1/addons/*` routes for installed/runtime/store
  and staging operations, zip payload decoding/validation, path decoding,
  default/null option handling, rating validation, 204 mutation parity, and
  targeted backend tests.
- Turn 23: Implemented the low-risk market-data HTTP seam TS slice: injectable
  `MarketDataService`, guarded `/api/v1/exchanges` and `/api/v1/market-data/*`
  routes, required/empty query handling, raw resolve query pass-through, quote
  path decoding and `asset_id` overwrite, byte-array and body validation,
  Rust-compatible sync-mode precedence, 204 mutation parity, and targeted
  backend tests.
- Turn 24: Implemented the low-risk activities/import HTTP seam TS slice:
  injectable `ActivityService`, guarded `/api/v1/activities/*` routes for
  search, create/update/bulk/delete, transfer link/unlink, import
  check/preview/apply, CSV parse, mapping, templates, account-template links,
  and duplicate checks; preserved search normalization, sort, date, multipart,
  wrapper-body, default context, path/query decoding, response-shape, and
  sidecar-auth route semantics; and added targeted backend tests.
- Turn 25: Implemented the low-risk AI chat/thread HTTP seam TS slice:
  injectable `AiChatService`, guarded `/api/v1/ai/chat/stream`,
  `/api/v1/ai/threads/*`, and `/api/v1/ai/tool-result` routes, NDJSON streaming
  headers/framing, Rust-shaped AI error status/body mapping, stream cancellation
  and mid-stream error events, thread query/path parsing, tag TODO no-op parity,
  tool-result validation, sidecar-auth route semantics, and targeted backend
  tests.
- Turn 26: Implemented the guarded sync crypto HTTP seam TS slice: injectable
  `SyncCryptoService`, guarded `/api/v1/sync/crypto/*` routes for root key, DEK
  derivation, keypair, shared/session key derivation, encrypt/decrypt,
  pairing-code/hash, HMAC, SAS, and device-id commands; preserved no-body route
  behavior, exact camelCase request fields, empty-string pass-through, u32
  version validation, keypair response shape, 400 crypto errors, sidecar-auth
  route semantics, and targeted backend tests.
- Turn 27: Implemented the guarded health runtime and classification migration
  HTTP seam TS slice: optional `HealthService` and `TaxonomyService` runtime
  methods for `/api/v1/health/status`, `/api/v1/health/check`,
  `/api/v1/health/fix`, and `/api/v1/taxonomies/migration/{status,run}`;
  preserved deferred behavior when optional methods are absent, client-timezone
  header parsing, no-body route behavior, fix-action payload validation,
  200/JSON response parity, sidecar-auth route semantics, and targeted backend
  tests.
- Turn 28: Implemented the guarded Connect broker/session HTTP seam TS slice:
  injectable `ConnectService` routes for non-device `/api/v1/connect/*` session,
  broker listing/sync, local synced data, import-run, broker profile, plan,
  public plan, and user-info endpoints; preserved JSON `null` session mutation
  responses, body-ignoring sync POST behavior, 202/403/501 sync trigger status
  mapping, import-run query defaults/validation, broker-profile request
  pass-through, explicit `/connect/device/*` exclusion, sidecar-auth route
  semantics, and targeted backend tests.
- Turn 29: Implemented the guarded Connect device-sync enrollment/engine HTTP
  seam TS slice: injectable `ConnectDeviceSyncService` routes for
  `/api/v1/connect/device/*` sync-state, enable, clear, reinitialize,
  engine-status, pairing-source-status, bootstrap overwrite check,
  reconcile-ready-state, bootstrap snapshot, manual cycle trigger, background
  engine start/stop, snapshot generation, and cancellation endpoints; preserved
  JSON `null` clear responses, body-ignoring no-body route behavior,
  `allowOverwrite` defaulting with snake_case ignored, explicit device path
  boundary handling, sidecar-auth route semantics, and targeted backend tests.
- Turn 30: Implemented the guarded device-sync device-management HTTP seam TS
  slice: injectable `DeviceSyncService` routes for `/api/v1/sync/device/*` and
  `/api/v1/sync/devices` register/current/get/list/update/delete/revoke
  endpoints; preserved camelCase request validation, optional/null update
  behavior, empty-string scope passthrough, static-vs-dynamic route boundaries,
  malformed path encoding errors, decoded path IDs, sidecar-auth route
  semantics, synchronous/asynchronous service error mapping, and targeted
  backend tests.
- Turn 31: Implemented the guarded device-sync team-key/reset HTTP seam TS
  slice: optional `DeviceSyncService` methods for
  `/api/v1/sync/keys/initialize`, `/initialize/commit`, `/rotate`,
  `/rotate/commit`, and `/api/v1/sync/team/reset`; preserved no-body start-route
  behavior, commit/reset JSON validation, i32 key version bounds, optional
  challenge/recovery/reason field handling, envelope validation, sidecar-auth
  route semantics, route inertness when optional methods are absent, and
  targeted backend tests.
- Turn 32: Implemented the guarded device-sync pairing HTTP seam TS slice:
  optional `DeviceSyncService` methods for issuer, claimer, composite, and
  pairing-flow `/api/v1/sync/pairing*` routes; preserved required camelCase body
  validation, body-ignoring approve/cancel routes, `sasProof` JSON-value
  presence, optional snapshot/proof fields, decoded pairing IDs, reserved static
  route boundaries, malformed path encoding errors, sidecar-auth route
  semantics, and targeted backend tests.
- Turn 33: Added standalone TS backend runtime composition for already-ported
  SQLite-backed domains: startup now initializes the existing Rust migrations,
  wires settings, accounts, contribution limits, taxonomies, custom providers,
  goals, exchange-rate CRUD, local health dismissal/config, market-data provider
  settings, and event-stream services into the TS request handler; `WF_DB_PATH`
  now takes precedence over `DATABASE_URL`, with explicit app-data and
  migration-dir resolution tests.
- Turn 34: Added safe app utility runtime parity for the standalone TS backend:
  app info, update-check mapping/cache with injectable fetch, base64 backup, and
  backup-to-path now have a real TS service wired into runtime composition;
  restore remains explicit `501` until the TS backend can safely restart or
  rebuild services after replacing the active database.
- Turn 35: Added file-backed secrets runtime parity for the standalone TS
  backend: Rust-compatible service ID normalization, HKDF-derived
  ChaCha20-Poly1305 encrypted writes, legacy plaintext reads, raw-key migration,
  runtime `/api/v1/secrets` wiring, and explicit startup failure for unsupported
  TS keyring mode.
- Turn 36: Added AI provider settings/catalog runtime parity for the standalone
  TS backend: catalog merge and sorting, SQLite settings persistence,
  secret-backed API-key flags, grouped tool allowlist normalization, tuning
  validation/sanitization, default-provider updates, model-list parsing with
  injectable fetch, and runtime `/api/v1/ai/providers` wiring.
- Turn 37: Added sync crypto runtime parity for the standalone TS backend:
  root-key generation, versioned DEK derivation, X25519 key exchange,
  session-key derivation, nonce-prefixed XChaCha20-Poly1305 encrypt/decrypt,
  pairing-code hashing, HMAC-SHA256, SAS computation, UUID device IDs, runtime
  `/api/v1/sync/crypto/*` wiring, and deterministic Rust/RFC-compatible test
  vectors.
- Turn 38: Added legacy classification migration runtime parity for the
  standalone TS backend: taxonomy migration status/run methods now scan existing
  assets for legacy sector/country metadata, map Rust-compatible GICS/region
  categories, create migrated taxonomy assignments, clean legacy metadata with
  Rust-compatible identifier preservation, collect per-asset migration errors,
  and activate `/api/v1/taxonomies/migration/{status,run}` in runtime.
- Turn 39: Added custom provider `test-source` runtime parity for the standalone
  TS backend: source tests now expand Rust-compatible templates, resolve secret
  headers, enforce browser-like HTTP headers, redirect and response-size guards,
  extract JSON/HTML/HTML-table/CSV prices and OHLCV fields, return detected HTML
  previews/tables, and activate `/api/v1/custom-providers/test-source` in
  runtime.
- Turn 40: Added FX converter/register runtime parity for the standalone TS
  backend: exchange-rate services now initialize a Decimal-backed historical
  converter from SQLite quotes, support nearest-date graph conversions, inverse
  rate fallback, minor-unit normalization, historical range reads, register
  Yahoo/manual FX pairs, emit assets-created events, and refresh converter state
  after FX deletes.
- Turn 41: Added app utility database restore runtime parity for the standalone
  TS backend: restore now normalizes file paths, validates backup files before
  closing the live SQLite handle, performs best-effort WAL checkpoint/journal
  cleanup, waits for file handles to settle, restores the backup, and puts the
  HTTP runtime into restart-required `503` mode until the app restarts.
- Turn 42: Added contribution-limit deposit calculation runtime parity for the
  standalone TS backend: limit deposit reads now query SQLite
  activities/accounts, apply Rust-compatible contribution rules for deposits,
  credits, and transfers, use user-timezone year ranges and FX conversion dates,
  and return numeric contribution totals through the existing `/api/v1/limits`
  runtime wiring.
- Turn 43: Added alternative-assets runtime parity for the standalone TS
  backend: `/api/v1/alternative-assets` and `/api/v1/alternative-holdings` now
  create manual asset/quote records, update valuations and metadata, link
  liabilities with Rust-compatible metadata semantics, delete assets with
  liability unlinking, emit asset-created events, and list holdings from latest
  manual quotes.
- Turn 44: Added a contained general-assets runtime slice for the standalone TS
  backend: `/api/v1/assets` now lists assets, reads profiles, updates quote
  mode, and deletes unused assets from SQLite with Rust-compatible
  `exchangeName` enrichment, invalid JSON fallback, activity delete guards,
  quote/sync-state cleanup, and `assets_updated` events. Asset create/profile
  mutation remains explicitly deferred until market identity canonicalization is
  ported.
- Turn 45: Added general asset create/profile mutation runtime for the
  standalone TS backend: asset creation and profile updates now canonicalize
  equity/option/metal Yahoo suffixes, crypto pairs, FX pairs, and bond CUSIPs;
  preserve generated `instrument_key` stability and duplicate returns; infer the
  Rust-compatible German ISIN provider config; refresh quote currency on MARKET
  MIC changes; reset existing quote sync state on pricing-identity changes; and
  emit asset-created/updated events through the runtime route wiring.
- Turn 46: Added a contained market-data quote CRUD runtime slice for the
  standalone TS backend: `/api/v1/exchanges`, quote history, manual quote
  update/upsert, and quote delete now read/write SQLite with Rust-compatible
  exchange list filtering, path-owned `asset_id`, deterministic manual quote
  IDs, existing same-day/source ID preservation, optional OHLCV zero-to-null
  storage, invalid stored timestamp fallback, idempotent deletes, and optional
  route methods that kept provider/search/import/sync behavior deferred at that
  point in the migration.
- Turn 47: Added market-data latest quote snapshot runtime for the standalone TS
  backend: `/api/v1/market-data/quotes/latest` now reads SQLite latest quotes
  with Rust-compatible source priority, asset quote-currency reconciliation,
  exchange timezone/close/weekend effective dates, stale flags, quote sync-state
  no-quote reasons, duplicate asset-ID de-duplication, and runtime route wiring.
- Turn 48: Added market-data quote CSV check/import runtime for the standalone
  TS backend: `/api/v1/market-data/quotes/check` and `/import` now parse
  Rust-compatible CSV rows, validate quote imports, match assets by ID/display
  code/Yahoo suffix, import manual quotes with overwrite/duplicate semantics,
  preserve existing manual row IDs, and share CSV parsing with custom providers.
- Turn 49: Added the addon-compatible Yahoo dividends runtime for the standalone
  TS backend: `/api/v1/market-data/yahoo/dividends/{symbol}` now uses an
  injectable Yahoo HTTP client path with Rust-compatible cookie/crumb reuse,
  two-year daily chart query parameters, dividend event extraction, 401 crumb
  reset, symbol-not-found/no-data errors, and Yahoo chart provider-error
  mapping.
- Turn 50: Added the market-data symbol search runtime for the standalone TS
  backend: `/api/v1/market-data/search` now merges existing SQLite assets with
  injectable Yahoo raw search results, including exchange code/suffix MIC
  mapping, provider/exchange-inferred currency provenance, canonical
  instrument-key de-dupe, secondary Yahoo search fallback, provider failure
  fallback, and existing-first/score ordering.
- Turn 51: Added the market-data resolve-currency runtime for the standalone TS
  backend: `/api/v1/market-data/resolve-currency` now resolves Yahoo-backed
  latest quote currency/price with suffix stripping, candidate fallback,
  equity/crypto/FX provider-symbol construction, provider preference handling,
  quoteSummary parsing, BOND default behavior, and 401 crumb retry.
- Turn 52: Added the activities import mapping/template runtime for the
  standalone TS backend: import mapping reads/writes, reusable template
  list/get/save/delete, account-template links, and duplicate idempotency-key
  lookups now use SQLite directly with Rust-compatible context normalization,
  config JSON casing/defaults, account-local template IDs, link row-id
  preservation, template ordering/filtering, and partial-route inertness for
  still-deferred activity operations.

## Deferred items

- Health status/check/fix endpoints remain active follow-ups. reason=taxonomy
  classification migration status/run now has TS runtime parity, while broader
  health checks, market sync fixes, caching, and `/health/fix` dispatch depend
  on holdings, quotes, FX, assets, valuation, and market sync parity.
- Custom provider `test-source` local source testing now has TS runtime parity.
  reason=external source fetches, secret-backed headers, parser/extractor
  behavior, response safety limits, and preview metadata are implemented in the
  standalone TS backend; broader market-data provider quote/import/sync runtime
  remains deferred below.
- Goals plan write/delete, summary refresh, save-up overview, and retirement
  simulation endpoints remain active follow-ups. reason=they require retirement
  plan validation/calculation parity and should move in dedicated
  calculation-heavy slices.
- FX currency converter, historical lookup, and register-pair behavior now have
  TS runtime parity. reason=the standalone TS exchange-rate service initializes
  the historical converter and can register required FX assets; automatic market
  sync, provider HTTP, quote import/persistence, and portfolio recalculation
  side effects remain deferred below.
- Alternative asset persistence, manual valuation quotes, liability metadata
  linking/unlinking quirks, and alternative holdings reads now have TS runtime
  parity. reason=the standalone TS backend writes `assets`/`quotes` directly and
  preserves Rust response/metadata behavior; portfolio job enqueue and broader
  portfolio recalculation side effects remain deferred to portfolio parity
  slices.
- Health status/check/fix endpoints remain active follow-ups. reason=legacy
  classification migration now has TS runtime parity through taxonomy endpoints,
  while broader health checks and fix execution depend on holdings, quotes, FX,
  assets, valuation, and market sync parity beyond local health dismissal/config
  state.
- Market-data exchange list, local quote history/update/delete, latest quote
  snapshots, quote CSV check/import, addon-compatible Yahoo dividends, symbol
  search, and Yahoo-backed symbol quote resolution now have TS runtime parity.
  reason=the standalone backend reads the Rust exchange catalog, writes local
  quote rows directly, can call Yahoo dividends/search/resolve through
  injectable HTTP paths, and can merge search results against existing SQLite
  assets; market sync and portfolio recalculation side effects remain active
  follow-ups.
- Actual portfolio job execution and event production remain active follow-ups.
  reason=they depend on market sync, holdings, snapshot, valuation, account,
  health, and FX service parity beyond route-level job enqueue and SSE transport
  semantics.
- Real keyring integration remains an active follow-up. reason=file-backed
  secret persistence now has TS runtime parity, while OS keyring support must
  move with a dedicated runtime/keyring parity slice.
- AI chat provider execution, streaming, thread persistence, and tool runtime
  behavior remain active follow-ups. reason=AI provider catalog/settings and
  model listing now have TS runtime parity, while chat execution belongs in a
  dedicated AI runtime slice.
- Alternative asset persistence, quote writes, liability metadata merging,
  holdings/net-worth calculations, and portfolio job enqueue behavior remain
  active follow-ups. reason=this slice only adds the guarded HTTP seam, while
  runtime behavior must move with asset/portfolio calculation parity slices.
- Asset create/profile mutation and market identity canonicalization now have TS
  runtime parity for direct SQLite-backed routes. reason=asset create/update now
  preserves generated `instrument_key` behavior, duplicate returns, provider
  inference, and sync-state reset; quote-provider interactions,
  auto-classification side effects, and portfolio recalculation behavior remain
  active follow-ups.
- App utility database restore runtime now has TS runtime parity. reason=the
  standalone backend performs file-level restore after closing the live database
  handle and explicitly reports restart-required readiness afterward; future
  polish can improve long-running file-copy offload but no Rust route behavior
  remains blocked on a `501`.
- Net-worth, performance, income, holdings, FX, and valuation calculations
  remain active follow-ups. reason=this slice only adds the guarded HTTP seam,
  while runtime behavior must move with dedicated portfolio calculation parity
  slices.
- Activity import mapping/template storage and duplicate lookups now have TS
  runtime parity. reason=the standalone backend reads/writes `import_templates`,
  `import_account_templates`, and activity idempotency keys directly with
  Rust-compatible defaults and route inertness; activity persistence, CSV
  parse/import execution, transfer mutation behavior, asset preview resolution,
  device-sync outbox emission for these writes, and portfolio recalculation side
  effects remain active follow-ups for dedicated activities/import/portfolio
  parity slices.
- AI chat persistence, provider streaming, tool execution, thread storage, tag
  persistence, and tool-result mutation behavior remain active follow-ups.
  reason=this slice only adds the guarded HTTP seam, while runtime behavior must
  move with dedicated AI runtime parity slices.
- Device-sync integration for sync crypto remains an active follow-up.
  reason=this slice adds the local TS crypto primitives, while cloud/client key
  material side effects must move with dedicated device-sync runtime slices.
- Real health checks, market sync fix execution, health cache behavior, and
  `/health/fix` dispatch remain active follow-ups. reason=taxonomy migration
  endpoints now have TS runtime parity, while broader health runtime behavior
  must move with dedicated health/calculation parity slices.
- Real Connect token lifecycle, cloud HTTP clients, broker sync orchestration,
  local sync repositories, subscription entitlement checks, event production,
  and device-sync enrollment/engine behavior remain active follow-ups.
  reason=this slice only adds the guarded non-device Connect HTTP seam, while
  runtime behavior must move with dedicated Connect/device-sync parity slices.
- Real device-sync token minting, E2EE enrollment, sync engine, snapshot/upload
  runtime, repository resets, feature-flag errors, background workers, and
  secret side effects remain active follow-ups. reason=this slice only adds the
  guarded Connect device-sync HTTP seam, while runtime behavior must move with
  dedicated Connect/device-sync parity slices.
- Real device-sync cloud clients, token lifecycle, device-id secret storage,
  enrollment side effects, team-key operations, pairing flows, feature-flag
  errors, and E2EE runtime remain active follow-ups. reason=this slice only adds
  the guarded device-management HTTP seam, while runtime behavior must move with
  dedicated device-sync parity slices.
- Real device-sync team-key cloud calls, key material handling, device identity
  lookup, reset side effects, pairing flows, feature-flag errors, and E2EE
  runtime remain active follow-ups. reason=this slice only adds the guarded
  team-key/reset HTTP seam, while runtime behavior must move with dedicated
  device-sync parity slices.
- Real device-sync pairing cloud calls, E2EE key exchange, freshness gate
  persistence, bootstrap transfer, background engine startup, feature-flag
  errors, and pairing-flow runtime remain active follow-ups. reason=this slice
  only adds the guarded pairing HTTP seam, while runtime behavior must move with
  dedicated device-sync parity slices.
- Holdings fan-out, valuation history/latest calculations, allocation
  calculations, snapshot persistence/reconciliation, import symbol lookup, and
  portfolio recalculation side effects remain active follow-ups. reason=this
  slice only adds the guarded HTTP seam, while runtime behavior must move with
  dedicated holdings/portfolio parity slices.
- Add-on filesystem extraction, manifest validation, sandbox/runtime loading,
  store HTTP requests, staging I/O, and update behavior remain active
  follow-ups. reason=this slice only adds the guarded HTTP seam, while runtime
  behavior must move with dedicated add-on parity slices.
- Market-data market sync execution and portfolio recalculation side effects
  remain active follow-ups. reason=exchange metadata, local quote
  persistence/import, Yahoo dividends/search/resolve have TS runtime coverage,
  while sync and recalculation behavior must move with dedicated market-data and
  portfolio parity slices.

## Blockers

- None.
