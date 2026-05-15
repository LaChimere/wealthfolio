# Goal State

<!-- prettier-ignore-start -->
objective: "开始为项目进行全栈迁移至 ts。你可以多进行深度调研来了解项目，实现的时候进行原子化 commit，并且频繁进行多轮 review 和 refine 来及时确保项目采用的是最佳实践的方式来实现和迁移的。你的最终目的是完整迁移。"
status: active
slug: "goal-fullstack-ts-migration"
turns_used: 96
turn_budget: null
docs_update_approved: true
created_at: "2026-05-13T21:33:49+08:00"
updated_at: "2026-05-16T03:20:00+08:00"
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
- Turn 53: Added the read-only activities search runtime for the standalone TS
  backend: `/api/v1/activities/search` now queries SQLite with Rust-compatible
  archived-account filtering, account/type/keyword/date/instrument filters,
  `needsReview` status semantics, sort/pagination behavior, and
  `ActivityDetails` response mapping while write/import side effects remain
  deferred.
- Turn 54: Added the activities transfer link/unlink runtime for the standalone
  TS backend: `/api/v1/activities/link` and `/unlink` now persist transfer
  source-group links in SQLite with Rust-compatible type/same-account/linked
  guards, transfer-in/out return ordering, metadata `flow.is_external` mutation,
  user-modified flags, and partial-route inertness for remaining activity
  write/import operations.
- Turn 55: Added the single activity delete runtime for the standalone TS
  backend: `/api/v1/activities/{id}` DELETE now reads, deletes, and returns the
  removed SQLite activity row with Rust-compatible not-found behavior, metadata
  parsing, source identity preservation in the response, and deferred portfolio
  recalculation/device-sync side effects.
- Turn 56: Added bounded activity create/update runtime for the standalone TS
  backend: `POST`/`PUT /api/v1/activities` now persist existing-asset and cash
  activities in SQLite with Rust-compatible generated IDs, strict date
  normalization, idempotency-key computation and duplicate errors, source
  preservation, decimal patch semantics, minor-currency normalization,
  securities-transfer amount clearing, metadata behavior, and tests. Symbol-only
  asset resolution/creation, quote fallback writes, bulk/import execution,
  device-sync outbox, and portfolio recalculation remain deferred.
- Turn 57: Added bounded activity bulk mutation runtime for the standalone TS
  backend: `POST /api/v1/activities/bulk` now validates creates, updates, and
  deletes before writing, returns per-entry errors without partial persistence,
  preserves delete/update/create execution order, generated created mappings,
  and reuses the bounded existing-asset/cash create/update semantics.
  Symbol-only asset resolution/creation, quote fallback writes, CSV parse/import
  execution, device-sync outbox, and portfolio recalculation remain deferred.
- Turn 58: Added bounded symbol-only activity asset resolution for existing
  SQLite assets in the standalone TS backend: create/update/bulk writes can now
  resolve `asset.symbol` plus optional exchange MIC, instrument type, and quote
  currency hints without creating assets or writing quotes. Missing or ambiguous
  symbols fail before persistence; asset creation, quote fallback writes, CSV
  parse/import execution, device-sync outbox, and portfolio recalculation remain
  deferred.
- Turn 59: Added activity CSV parse runtime for the standalone TS backend:
  `/api/v1/activities/import/parse` now parses multipart CSV bytes with
  Rust-compatible delimiter detection, header/no-header handling, skip rows,
  empty-row filtering, UTF-8/UTF-16 BOM handling, Windows-1252 fallback
  warnings, quote characters, row normalization, structure warnings, detected
  config, and runtime route wiring. Import execution, asset preview resolution,
  asset creation, device-sync outbox, and portfolio recalculation remain
  deferred.
- Turn 60: Added read-only activity import asset preview runtime for the
  standalone TS backend: `/api/v1/activities/import/preview-assets` now returns
  existing-asset matches, bounded new-asset drafts, validation errors for
  missing accounts/metadata, and ambiguity-safe duplicate-symbol errors without
  creating assets or fetching providers. Import execution, asset creation,
  device-sync outbox, and portfolio recalculation remain deferred.
- Turn 61: Added read-only activity import validation runtime for the standalone
  TS backend: `/api/v1/activities/import/check` now validates mapped rows
  against accounts, existing assets, bounded symbol resolution, Rust-compatible
  create normalization, existing duplicate idempotency keys, and in-batch
  duplicate warnings without persisting imports. Import execution, asset
  creation, device-sync outbox, and portfolio recalculation remain deferred.
- Turn 62: Added bounded activity import apply runtime for the standalone TS
  backend: `/api/v1/activities/import` now validates apply rows, writes existing
  asset/cash activities with CSV source/import-run metadata, skips duplicates
  unless `forceImport` is set, preserves non-duplicate idempotency keys, returns
  Rust-compatible import summaries, and avoids partial writes on validation
  errors. Symbol-only asset creation, transfer-pair auto-linking, FX pair
  ensure, device-sync outbox, and portfolio recalculation remain deferred.
- Turn 63: Added activity import transfer-pair auto-linking for the standalone
  TS backend: inserted cross-account `TRANSFER_IN`/`TRANSFER_OUT` pairs with the
  same date, currency, symbol, and amount now receive a shared `source_group_id`
  and internal-flow metadata during `/api/v1/activities/import`. Symbol-only
  asset creation, FX pair ensure, device-sync outbox, and portfolio
  recalculation remain deferred.
- Turn 64: Wired activity import apply to the migrated TS exchange-rate runtime:
  `/api/v1/activities/import` now ensures required activity-currency and
  quote-currency FX pairs before writing import runs or activities, and aborts
  without partial activity/import-run writes if FX registration fails.
  Symbol-only asset creation, device-sync outbox, and portfolio recalculation
  remain deferred.
- Turn 65: Added bounded save-up goal-plan persistence for the standalone TS
  backend: `POST /api/v1/goals/plan` and `DELETE /api/v1/goals/{id}/plan` now
  upsert/delete `goal_plans` with Rust-compatible version increments, created-at
  preservation, summary defaulting, unknown settings preservation, unconditional
  204 deletes, and `goal_plans` sync events. Retirement plan validation, summary
  refresh, and goal calculations remain deferred.
- Turn 66: Added local AI chat thread/message persistence for the standalone TS
  backend: `/api/v1/ai/threads`, thread update/delete, message reads, and
  `/api/v1/ai/tool-result` now use SQLite-backed `ai_threads`/`ai_messages` data
  with Rust-compatible sort/search/cursor pagination, direct-thread empty tag
  behavior, tool-result patch merging, and explicit 501 responses for deferred
  chat streaming.
- Turn 67: Added bounded health status/check runtime for the standalone TS
  backend: `/api/v1/health/status` and `/api/v1/health/check` now return
  SQLite-backed account-configuration and timezone issues with severity rollups,
  dismissal filtering, stale-cache behavior, client-timezone cache keys, and
  runtime wiring. Calculation-heavy price/FX/classification/consistency checks,
  market-sync fixes, `/health/fix` dispatch, and Rust-generated dismissal-hash
  carryover remain deferred.
- Turn 68: Wired the bounded health classification fix path:
  `/api/v1/health/fix` now dispatches `migrate_legacy_classifications` through
  the migrated taxonomy runtime in standalone TS, while price sync, retry sync,
  FX fetch, and other health fix actions remain deferred.
- Turn 69: Added bounded legacy-classification health issue generation: the TS
  health status/check runtime now consumes migrated taxonomy migration status
  and emits `classification:legacy_migration:*` warning issues with
  `migrate_legacy_classifications` fix actions. Full affected-item parity and
  Rust-generated dismissal hashes remain deferred.
- Turn 70: Added bounded retirement goal-plan save runtime: the TS goals service
  now validates retirement plan JSON, normalizes `personal.currentAge` from
  `birthYearMonth`, preserves unknown frontend-owned settings, rejects duplicate
  and participating DC account links, and persists versioned `goal_plans` rows.
  Retirement simulations, summary refresh, and save-up overview calculations
  remain deferred.
- Turn 71: Added bounded save-up preview calculation runtime:
  `POST /api/v1/goals/save-up/preview` now validates save-up inputs and returns
  Rust-compatible local-date projections, required monthly contribution,
  completion-date search, and trajectory output. Goal-id save-up overview,
  summary refresh, and retirement simulations remain deferred. Targeted tests,
  backend type-check, full `bun run check`, and focused review passed.
- Turn 72: Added bounded save-up goal overview service parity: the TS goals
  service now computes save-up overviews from funding-share valuation maps,
  optional plan settings with Rust `as_f64` default semantics, and
  achieved/archived summary-current-value fallback behavior. HTTP goal-id
  overview routing, summary refresh, and retirement simulations remain deferred.
  Targeted tests, backend type-check, and focused review passed.
- Turn 73: Added bounded goal summary refresh service parity for non-retirement
  goals and no-plan retirement goals: the TS goals service now updates the six
  Rust summary fields from funding-share valuation maps, preserves
  non-retirement projected fields, applies achieved health overrides and
  projected/target health thresholds, and keeps plan-backed retirement refresh
  explicitly deferred. HTTP summary refresh routing remains deferred. Targeted
  tests, backend type-check, and focused review passed.
- Turn 74: Added guarded valuation-backed goal calculation route seams:
  `POST /api/v1/goals/{id}/refresh-summary` and
  `GET /api/v1/goals/{id}/save-up/overview` now run through an injectable goal
  valuation provider, preserve sidecar auth/path decoding, return explicit 501
  when the runtime provider is absent, and return 503 for valuation-provider
  failures. Standalone runtime valuation-map construction remains deferred.
  Targeted tests, backend type-check, full `bun run check`, and focused review
  passed.
- Turn 75: Wired standalone runtime goal valuation-map construction from active,
  non-archived accounts and latest `daily_account_valuation` rows, added
  `POST /api/v1/goals/refresh-summaries`, and verified runtime
  `refresh-summary`/save-up overview routes use base-currency valuations instead
  of returning 501. Plan-backed retirement calculations remain deferred.
  Targeted tests, backend type-check, full `bun run check`, and focused review
  passed.
- Turn 76: Matched Rust goal save side effects by refreshing goal summaries
  after successful funding and goal-plan saves when a runtime valuation provider
  is available, while preserving save success if valuation-map construction or
  summary refresh fails. Targeted tests, backend type-check, full
  `bun run check`, and focused review passed.
- Turn 77: Added the first plan-backed retirement calculation prerequisite in
  the TS goals service: retirement input preparation now validates/normalizes
  stored plan JSON, computes funding-share current portfolio, injects
  non-negative tax-bucket balances into `tax.withdrawalBuckets`, and applies
  Rust-compatible `planner_mode` defaulting. Targeted domain tests and backend
  type-check passed.
- Turn 78: Split the retirement overview work after rubber-duck critique and
  ported the first deterministic calculation primitives into TS: tax bucket
  scaling/growth/contribution routing, gross-up and finite-bucket withdrawals,
  expense/income/DC payout helpers, return/glide-path helpers, and pension fund
  stepping. Targeted primitive tests and backend type-check passed.
- Turn 79: Extended the TS retirement calculation module with deterministic
  required-capital search and projection engine parity: schedule feasibility
  binary search, FIRE/traditional retirement-start decisions, yearly
  accumulation/retirement snapshots, coast amount, pension asset tracking, and
  deterministic current-year injection for tests. Targeted projection tests and
  backend type-check passed.
- Turn 80: Added deterministic retirement overview assembly in TS: target
  reconciliation, budget breakdown, required-capital trajectory, material
  spending-shortfall tolerance, required additional contribution, later-age FI
  suggestion, status/success-status mapping, and camelCase overview DTO fields.
  Targeted overview tests and backend type-check passed.
- Turn 81: Wired plan-backed retirement overview runtime in TS:
  `GET /api/v1/goals/{id}/retirement/overview` now uses the valuation provider,
  stored retirement plan, funding-share portfolio, tax-bucket balances, and
  stored/default planner mode to return deterministic overview DTOs with guarded
  501/503/error behavior. Targeted goals/http tests and backend type-check
  passed.
- Turn 82: Replaced the plan-backed retirement summary refresh deferral with TS
  runtime parity: summary refresh now derives target, projected completion date,
  projected value, and health from deterministic retirement overviews while
  preserving no-plan clearing, achieved health override, and unreachable-target
  fallback behavior. Targeted goals/http tests and backend type-check passed.
- Turn 83: Wired the first retirement simulation endpoint in TS:
  `POST /api/v1/goals/retirement/projection` now accepts direct plan payloads or
  goal-backed inputs, normalizes/validates standalone plans, reuses stored
  plan/funding/tax-bucket preparation for `goalId`, honors planner mode, and
  returns deterministic projection DTOs through the guarded HTTP route. Targeted
  HTTP tests and backend type-check passed.
- Turn 84: Added the deterministic sequence-of-returns retirement simulation
  endpoint in TS: `POST /api/v1/goals/retirement/sequence-of-returns` now
  supports direct plan payloads and goal-backed plan resolution, with
  Rust-compatible scenario labels, start-of-year path semantics, glide-path
  normal-year returns, grow-before-withdraw ordering, essential-spending failure
  ages, and valuation-provider 501/503 behavior. Targeted calculation/http
  tests, backend type-check, full `bun run check`, and focused review passed.
- Turn 85: Added deterministic retirement scenario-analysis runtime parity:
  `POST /api/v1/goals/retirement/scenario-analysis` now supports direct plan
  payloads and goal-backed input resolution, applies Rust-compatible
  pessimistic, base-case, and optimistic return deltas to accumulation and
  retirement returns, returns scenario DTOs from deterministic
  projection/overview outputs, and preserves valuation-provider 501/503
  behavior. Targeted calculation/http tests, backend type-check, full
  `bun run check`, and focused review passed.
- Turn 86: Added deterministic retirement stress-test runtime parity:
  `POST /api/v1/goals/retirement/stress-tests` now returns the six
  Rust-compatible stress scenarios with risk-lab baseline/stressed outcomes,
  deltas, severity classification, early-crash SORR integration, direct and
  goal-backed input paths, planner-mode handling, and valuation-provider 501/503
  behavior. Targeted calculation/http tests, backend type-check, full
  `bun run check`, and focused review passed.
- Turn 87: Added deterministic retirement decision-sensitivity runtime parity:
  `POST /api/v1/goals/retirement/decision-sensitivity-map` now returns
  Rust-compatible contribution/return and retirement-age/spending matrices with
  axis rounding/fill behavior, baseline indices, current-value cell scaling,
  direct and goal-backed input paths, planner-mode handling, and
  valuation-provider 501/503 behavior. Targeted calculation/http tests, backend
  type-check, full `bun run check`, and focused review passed.
- Turn 88: Added Monte Carlo retirement simulation runtime parity:
  `POST /api/v1/goals/retirement/monte-carlo` now supports direct and
  goal-backed inputs, HTTP `nSims` default/clamp behavior, deterministic seeded
  stochastic paths, Rust-compatible percentile DTOs, FIRE/traditional success
  semantics, stochastic expense/income inflation handling, and
  valuation-provider 501/503 behavior. Targeted calculation/http tests, backend
  type-check, full `bun run check`, rubber-duck critique, and focused code
  review passed.
- Turn 89: Added net-worth current/history runtime parity: the standalone TS
  backend now wires `/api/v1/net-worth` and `/api/v1/net-worth/history` to
  SQLite-backed calculations with Rust-compatible holdings snapshots, cash,
  standalone alternative assets, liabilities, minor-unit quote normalization, FX
  conversion/fallbacks, staleness, TOTAL valuation history, and filled
  alternative-asset quote history. Targeted portfolio/runtime tests, backend
  type-check, full `bun run check`, and focused code review passed.
- Turn 90: Added income summary runtime parity: `/api/v1/income/summary` now
  uses SQLite-backed income activities with archived-account filtering,
  account-scoped filtering, asset-backed DRIP/staking fallback amounts, latest
  FX conversion/fallbacks, configured-timezone current date, period totals,
  monthly averages, YoY growth, and by-month/type/asset/currency/account
  breakdowns. Targeted portfolio/runtime tests, backend type-check, and focused
  code review passed.
- Turn 91: Added simple account performance runtime parity:
  `/api/v1/performance/accounts/simple` now uses SQLite-backed latest and exact
  previous-day account valuations, Rust-compatible default active-account
  selection, TOTAL portfolio weighting, cumulative/day return formulas,
  clamping/null edge cases, and numeric JSON response fields. Targeted
  portfolio/runtime tests and backend type-check passed.
- Turn 92: Added account performance history/summary runtime parity:
  `/api/v1/performance/history` and `/api/v1/performance/summary` now calculate
  account TWR/MWR, holdings-mode period returns, annualized/simple returns,
  volatility, max drawdown, empty-response and negative-history error behavior
  from SQLite `daily_account_valuation` rows. Symbol summary keeps Rust empty
  response behavior, while provider-backed symbol history remains explicitly
  gated with 501. Targeted portfolio/runtime tests and backend type-check
  passed.
- Turn 93: Added holdings valuation read runtime parity: standalone TS now wires
  `/api/v1/valuations/history` and `/api/v1/valuations/latest` to SQLite
  `daily_account_valuation` rows, including active-account default lookup,
  request-order preservation, filtered history ranges, numeric valuation fields,
  and explicit 501 gates for still-deferred holdings fan-out, allocations,
  snapshots, and imports. Targeted holdings/runtime tests and backend type-check
  passed.
- Turn 94: Added holdings snapshot metadata read runtime parity:
  `/api/v1/snapshots` now reads SQLite `holdings_snapshots` rows with optional
  date filters and returns Rust-shaped snapshot IDs, dates, sources, position
  counts, and cash currency counts. Snapshot-to-holdings conversion, deletion,
  save/import, and allocation fan-out remain explicitly gated. Targeted
  holdings/runtime tests and backend type-check passed.
- Turn 95: Added historical snapshot holdings read runtime parity:
  `/api/v1/snapshots/holdings` now converts a stored holdings snapshot into
  Rust-shaped security/alternative/cash holdings, including asset metadata,
  zero-quantity filtering, missing-asset skipping, base-currency injection, cash
  balance conversion, and Rust-compatible empty JSON fallback for stored
  snapshot blobs. Live holdings fan-out/valuation, single holding detail, asset
  fan-out, deletion, save/import, and allocations remain explicitly gated.
  Targeted holdings/runtime tests and backend type-check passed.
- Turn 96: Added bounded holdings import check runtime parity:
  `/api/v1/snapshots/import/check` now verifies account existence, validates
  snapshot dates/quantities/average costs, reports existing snapshot dates, and
  resolves exact local asset symbol matches from SQLite. Provider-backed symbol
  search, actual import writes, snapshot save/delete side effects, and live
  holdings fan-out remain explicitly gated. Targeted holdings/runtime tests and
  backend type-check passed.

## Deferred items

- Full health status/fix coverage remains an active follow-up. reason=taxonomy
  classification migration status/run, bounded account/timezone status/checks,
  and legacy-classification health issue generation now have TS runtime parity,
  while price staleness, quote sync, FX, broader classification,
  data-consistency checks, market sync fixes, non-classification `/health/fix`
  dispatch, full affected-item parity, and Rust-generated dismissal-hash
  carryover depend on holdings, quotes, FX, assets, valuation, and market sync
  parity.
- Custom provider `test-source` local source testing now has TS runtime parity.
  reason=external source fetches, secret-backed headers, parser/extractor
  behavior, response safety limits, and preview metadata are implemented in the
  standalone TS backend; broader market-data provider quote/import/sync runtime
  remains deferred below.
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
- Full health status/fix coverage remains an active follow-up. reason=legacy
  classification migration now has TS runtime parity through taxonomy endpoints,
  bounded account/timezone status/checks are wired into standalone runtime, and
  legacy classification migration issues are surfaced in health status, while
  price, quote sync, FX, broader classification, consistency checks, and
  non-classification fix execution depend on holdings, quotes, FX, assets,
  valuation, and market sync parity beyond local health dismissal/config state.
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
- AI chat provider execution, streaming, title generation, tool execution, tag
  mutations, attachment handling, and device-sync outbox behavior remain active
  follow-ups. reason=AI provider catalog/settings/model listing and local
  thread/message persistence now have TS runtime parity, while chat execution
  belongs in dedicated AI runtime slices.
- Alternative asset persistence, quote writes, liability metadata merging, and
  current/history net-worth calculations now have bounded TS runtime parity.
  reason=the standalone backend reads/writes local asset/quote records and can
  calculate net-worth from latest holdings snapshots plus standalone alternative
  assets; holdings fan-out, broader valuation calculations, and portfolio job
  enqueue behavior remain active follow-ups.
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
- Net-worth current/history, income summary, simple account performance, and
  account performance history/summary now have bounded TS runtime parity, while
  provider-backed symbol performance history, holdings import provider-backed
  symbol search, live holdings fan-out/allocations/snapshot writes/imports, and
  broader valuation calculations remain active follow-ups. reason=the standalone
  backend can calculate `/api/v1/net-worth`, `/api/v1/net-worth/history`,
  `/api/v1/income/summary`, `/api/v1/performance/accounts/simple`, and
  account-scoped `/api/v1/performance/{history,summary}`,
  `/api/v1/valuations/{history,latest}`, `/api/v1/snapshots`,
  `/api/v1/snapshots/holdings`, and `/api/v1/snapshots/import/check`; remaining
  portfolio metrics still need dedicated calculation parity slices.
- Activity import mapping/template storage, duplicate lookups, read-only
  activity search, transfer link/unlink mutations, single activity deletes,
  bounded existing-asset/cash activity create/update/bulk persistence, and
  bounded symbol-only resolution to existing assets, CSV parse, read-only import
  asset preview, read-only import validation, bounded import apply, and import
  transfer-pair auto-linking now have TS runtime parity. reason=the standalone
  backend reads/writes `import_templates`, `import_account_templates`, activity
  idempotency keys, activity search rows, transfer source-group metadata,
  deleted activity rows, and bounded manual create/update/bulk rows directly
  with Rust-compatible defaults, filters, ordering, response mapping, transfer
  guards, decimal semantics, date normalization, duplicate detection, created
  mappings, and no-write-on-error bulk behavior, while existing symbol-only
  inputs are resolved locally with ambiguity-safe errors and CSV bytes are
  parsed with Rust-compatible detected config, structure warnings, UTF-16 BOM
  handling, and Windows-1252 fallback warnings, import asset candidates are
  previewed as existing matches, bounded drafts, or explicit fixing errors, and
  mapped import rows are validated read-only with duplicate warnings; apply rows
  are persisted with CSV import-run metadata, duplicate skipping/force-import
  behavior, cross-account transfer-pair source-group metadata, and FX pair
  ensure through the TS exchange-rate runtime; symbol-only asset creation, quote
  fallback writes, provider-backed asset resolution, device-sync outbox emission
  for writes, and portfolio recalculation side effects remain active follow-ups
  for dedicated activities/import/portfolio parity slices.
- AI chat provider streaming, title generation, tool execution, tag mutations,
  attachment handling, and outbox writes remain active follow-ups. reason=local
  thread/message persistence and tool-result mutation now have TS runtime
  parity, while model/provider orchestration and sync side effects must move
  with dedicated AI runtime parity slices.
- Device-sync integration for sync crypto remains an active follow-up.
  reason=this slice adds the local TS crypto primitives, while cloud/client key
  material side effects must move with dedicated device-sync runtime slices.
- Full health checks, market sync fix execution, and non-classification
  `/health/fix` dispatch remain active follow-ups. reason=taxonomy migration
  endpoints, bounded account/timezone status/checks, legacy-classification
  health issues, and the classification migration health fix now have TS runtime
  parity, while calculation-heavy health runtime behavior must move with
  dedicated health/calculation parity slices.
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
