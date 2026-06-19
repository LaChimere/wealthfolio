# Goal State

<!-- prettier-ignore-start -->
objective: "开始为项目进行全栈迁移至 ts。你可以多进行深度调研来了解项目，实现的时候进行原子化 commit，并且频繁进行多轮 review 和 refine 来及时确保项目采用的是最佳实践的方式来实现和迁移的。你的最终目的是完整迁移。"
status: active
slug: "goal-fullstack-ts-migration"
turns_used: 477
turn_budget: null
docs_update_approved: true
created_at: "2026-05-13T21:33:49+08:00"
updated_at: "2026-06-19T18:42:53+08:00"
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
  controls explicit database path selection, with explicit app-data and
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
  and explicit 501 gates for still-deferred allocations, snapshot writes, and
  imports. Targeted holdings/runtime tests and backend type-check passed.
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
  snapshot blobs. Deletion, save/import, and allocations remain explicitly
  gated. Targeted holdings/runtime tests and backend type-check passed.
- Turn 96: Added bounded holdings import check runtime parity:
  `/api/v1/snapshots/import/check` now verifies account existence, validates
  snapshot dates/quantities/average costs, reports existing snapshot dates, and
  resolves exact local asset symbol matches from SQLite. Provider-backed symbol
  search, actual import writes, and snapshot save/delete side effects remain
  explicitly gated. Targeted holdings/runtime tests and backend type-check
  passed.
- Turn 97: Added bounded live holdings fan-out runtime parity:
  `/api/v1/holdings` now reads the latest holdings snapshot and returns valued
  security, alternative-asset, and cash holdings with minor-currency
  normalization, quote source priority, contract multipliers, FX fallback
  behavior, expired option filtering, missing quote/asset handling, and
  base-value weights. Targeted holdings/runtime tests, backend type-check, full
  `bun run check`, and focused code review passed.
- Turn 98: Added bounded holding detail and by-asset fan-out runtime parity:
  `/api/v1/holdings/item` now returns the valued live holding for an
  account/asset or `null` for missing, zero, or expired positions, and
  `/api/v1/holdings/by-asset` now aggregates valued holdings across active
  accounts while preserving per-account weight semantics. Targeted
  holdings/runtime tests, backend type-check, full `bun run check`, and focused
  code review passed.
- Turn 99: Added bounded portfolio allocation runtime parity:
  `/api/v1/allocations` now rolls valued live holdings into taxonomy allocations
  with Rust-compatible cash handling, hierarchy rollups, Unknown buckets,
  partial assignment weights, custom taxonomy inclusion, camelCase DTOs, and
  omitted empty children; `/api/v1/allocations/holdings` now returns category
  drill-down holding summaries with weighted values and category weights.
  Targeted holdings/runtime tests, backend type-check, full `bun run check`, and
  focused code review passed.
- Turn 100: Added bounded holdings snapshot deletion runtime parity:
  `DELETE /api/v1/snapshots` now verifies the target snapshot, rejects missing
  and calculated snapshots with Rust-compatible messages, deletes
  manual/imported SQLite snapshot rows, and keeps broader recalculation side
  effects deferred. Targeted holdings/runtime tests, backend type-check, and
  full `bun run check` passed.
- Turn 101: Added bounded manual holdings snapshot save runtime parity:
  `POST /api/v1/snapshots` now validates accounts/dates/decimals, creates
  minimal manual assets, switches manual quote mode when requested, writes
  weighted manual quotes, aggregates duplicate same-asset positions, upserts
  stable manual snapshot rows, and creates the Rust-compatible synthetic
  backfill snapshot. Provider-backed lookup, FX pair registration, device-sync
  outbox, and portfolio recalculation side effects remain deferred. Targeted
  holdings/runtime tests, backend type-check, and full `bun run check` passed.
- Turn 102: Added bounded holdings snapshot import-write runtime parity:
  `POST /api/v1/snapshots/import` now validates the account once, imports valid
  snapshots independently, returns Rust-shaped imported/failed counts and
  per-date errors, persists imported rows as `CSV_IMPORT`, reuses local
  exact-symbol/minimal-asset creation, aggregates duplicate positions, ignores
  invalid optional average-cost strings as zero, filters zero cash/positions,
  and creates synthetic history backfill. Provider-backed symbol lookup, FX pair
  registration, device-sync outbox, and portfolio recalculation side effects
  remain deferred. Targeted holdings/runtime tests and backend type-check
  passed.
- Turn 103: Added bounded holdings snapshot FX pair side effects: manual and
  imported snapshot saves now collect holding, asset quote-currency, cash, and
  account-to-base currency pairs and call the migrated `ensureFxPairs` hook
  before persisting snapshots, preserving no-write behavior when FX registration
  fails. Provider-backed symbol lookup, device-sync outbox, and portfolio
  recalculation side effects remain deferred. Targeted holdings/runtime tests
  and backend type-check passed.
- Turn 104: Added provider-backed holdings import-check symbol lookup:
  `/api/v1/snapshots/import/check` can now use the migrated market-data search
  runtime after local exact-symbol lookup, accepts only exact provider symbol
  matches, maps provider currency/exchange/asset metadata to Rust-shaped symbol
  check results, keeps provider failures non-fatal, and direct import writes now
  reuse exact provider matches before creating new local market assets.
  Device-sync outbox and portfolio recalculation side effects remain deferred.
  Targeted holdings/runtime tests and backend type-check passed.
- Turn 105: Added holdings snapshot mutation event production: manual/imported
  snapshot saves now publish Rust-shaped `holdings_changed` followed by
  `manual_snapshot_saved`, manual/imported snapshot deletes publish
  `holdings_changed`, and the standalone TS runtime wires holdings to the shared
  event bus. Delete emission is an intentional bridge while Rust's inline delete
  valuation/TOTAL recalculation path remains deferred to the broader TS
  portfolio job worker slice. Targeted holdings/runtime tests and backend
  type-check passed.
- Turn 106: Added activity mutation event production: create, update, delete,
  bulk, import, transfer link, and transfer unlink now publish Rust-shaped
  `activities_changed` events through the shared standalone TS event bus with
  account/asset/currency sets and UTC earliest-activity timestamps. Targeted
  activities/runtime tests, backend type-check, full `bun run check`, and
  focused code review passed.
- Turn 107: Ported the Rust domain-event planning logic to TS: event batches can
  now derive full portfolio recalculation configs, broker-sync account IDs, and
  asset-enrichment IDs from Rust-shaped backend events without starting the
  worker yet. Targeted planner tests and backend type-check passed.
- Turn 108: Added an injectable TS domain-event batch processor that executes
  asset enrichment, portfolio job enqueue, and broker-sync callbacks in the Rust
  queue-worker order while returning the derived plan and propagating callback
  failures. Targeted domain-event tests and backend type-check passed.
- Turn 109: Added a TS domain-event worker helper that subscribes to the backend
  event bus, debounces batches, supports explicit flush/dispose, and surfaces
  scheduled processing failures through an error callback while keeping real
  runtime wiring deferred. Targeted domain-event tests and backend type-check
  passed.
- Turn 110: Added bounded symbol-based activity asset creation: manual
  create/update/bulk and CSV import now create local assets from explicit symbol
  metadata inside the same transaction, emit `assets_created` before
  `activities_changed`, preserve read-only import checks, and carry checked
  import asset IDs through apply. Targeted activities tests, backend type-check,
  full `bun run check`, and focused code review passed.
- Turn 111: Added bounded manual quote side effects for activity writes:
  price-bearing BUY/SELL/TRANSFER_IN create/update/bulk/import paths now update
  requested asset quote mode and upsert MANUAL quote rows transactionally while
  preserving MARKET assets and income activities. Targeted activities tests,
  backend type-check, full `bun run check`, and focused code review passed.
- Turn 112: Added bounded activity sync-event queuing for device-sync parity:
  create/update/delete, bulk, transfer link/unlink, and CSV import writes now
  produce post-transaction `activities` sync callback events with
  Rust-compatible `ActivityDB` payloads and outbox filtering rules. Targeted
  activities tests, backend type-check, full `bun run check`, and focused code
  review passed.
- Turn 113: Added CSV import-run sync-event queuing: activity import apply now
  queues a Rust-compatible `import_runs` Create callback before activity Create
  callbacks, with `ImportRunDB` payload shape and the Rust
  `should_sync_outbox_for_import_run` filter. Targeted activities tests, backend
  type-check, full `bun run check`, and focused code review passed.
- Turn 114: Added AI chat tag persistence parity: `/api/v1/ai/threads/{id}/tags`
  now reads SQLite `ai_thread_tags`, POST inserts tags idempotently, and DELETE
  removes tags idempotently while preserving Rust-compatible empty tags on
  direct `getThread` reads. Focused AI chat/HTTP tests, backend type-check, and
  full `bun run check` passed.
- Turn 115: Added activity-created asset sync-event queuing: activity
  create/update/bulk and CSV import paths now prepend Rust-shaped `assets`
  Create callback events for newly inserted explicit-symbol assets before
  dependent activity/import callbacks, without leaking events on failed writes.
  Targeted activities tests, backend type-check, and full `bun run check`
  passed.
- Turn 116: Added the first TS sync_outbox persistence wiring: a shared sync
  outbox queue now persists goal and activity/import/asset sync callbacks into
  `sync_outbox` plus `sync_entity_metadata` with Rust-compatible entity/op
  names, payload key normalization, key-version/device metadata, and runtime
  wiring. Targeted sync-outbox/runtime tests, backend type-check, and focused
  code review passed.
- Turn 117: Extended TS runtime sync_outbox wiring to exchange-rate FX asset
  callbacks: FX asset Create/Delete events now persist as `asset` outbox rows,
  and FX asset Create payloads no longer include the generated `instrument_key`
  column. Focused exchange-rate/runtime tests and backend type-check passed.
- Turn 118: Extended TS runtime sync_outbox wiring to custom provider callbacks:
  `/api/v1/custom-providers` Create/Update/Delete now persist `custom_provider`
  outbox rows keyed by provider UUID with normalized payloads. Focused
  custom-provider/runtime tests and backend type-check passed.
- Turn 119: Extended TS runtime sync_outbox wiring to taxonomy callbacks: custom
  taxonomy bundle events now persist as `custom_taxonomy` outbox rows with
  Rust-shaped nested taxonomy/category payloads, and asset taxonomy assignment
  Update/Delete callbacks persist as `asset_taxonomy_assignment` rows. Focused
  taxonomy/sync-outbox/runtime tests and backend type-check passed.
- Turn 120: Extended TS runtime sync_outbox wiring to direct asset callbacks:
  asset Create/Update/Delete events from create, profile update, quote-mode
  update, and delete now persist as `asset` outbox rows with Rust-shaped
  payloads that omit the generated `instrument_key`. Focused assets/runtime
  tests, backend type-check, full `bun run check`, and focused code review
  passed.
- Turn 121: Extended TS runtime sync_outbox wiring to alternative asset and UUID
  MANUAL quote callbacks: alternative asset create/update/delete and liability
  relink side effects now persist `asset` outbox rows, and alternative asset
  valuation/purchase quotes persist `quote` Create/Update rows only when they
  match Rust's MANUAL+UUID quote filter. Focused alternative-assets/runtime
  tests, backend type-check, full `bun run check`, and focused code review
  passed.
- Turn 122: Extended market-data quote sync callback parity: quote update,
  delete, and CSV import writes now route through the shared MANUAL+UUID quote
  filter, queue Delete when explicit UUID manual quotes are replaced/deleted,
  and persist runtime `quote` sync_outbox rows through the shared queue. Focused
  market-data/alternative-assets/runtime tests and backend type-check passed.
- Turn 123: Extended local AI chat persistence with sync callbacks for the
  already migrated mutation paths: thread Update/Delete, message tool-result
  Update, and thread-tag Create/Delete now queue Rust-shaped events and persist
  runtime `ai_thread`, `ai_message`, and `ai_thread_tag` sync_outbox rows.
  Focused AI chat/runtime tests, backend type-check, full `bun run check`, and
  focused code review passed.
- Turn 124: Extended contribution-limit sync callback parity:
  create/update/delete now queue Rust-shaped `ContributionLimitDB` events,
  missing deletes remain no-op for outbox emission, and the standalone runtime
  persists `contribution_limit` sync_outbox rows through the shared queue.
  Focused contribution-limit/runtime tests, backend type-check, full
  `bun run check`, and focused code review passed.
- Turn 125: Extended account sync callback parity: account create/update/delete
  now queue Rust-shaped `AccountDB` events with boolean payload fields, missing
  deletes remain no-op for outbox emission, and the standalone runtime persists
  `account` sync_outbox rows through the shared queue. Focused accounts/runtime
  tests, backend type-check, full `bun run check`, and focused code review
  passed.
- Turn 126: Extended import template sync callback parity: user import-template
  saves/deletes and account-template mapping/link updates now queue Rust-shaped
  `ImportTemplateDB` and `ImportAccountTemplateDB` events, suppress system
  template save events, preserve stable link entity IDs, and persist runtime
  `import_template`/`activity_import_profile` sync_outbox rows. Focused
  activities/runtime tests, backend type-check, full `bun run check`, and
  focused code review passed.
- Turn 127: Extended holdings snapshot sync callback parity: manual/imported
  snapshot saves and synthetic snapshot creation now queue Rust-shaped
  `AccountStateSnapshotDB` Create events, snapshot deletion queues filtered
  Delete events, and standalone runtime persists `snapshot` sync_outbox rows
  while preserving Rust's source and UUID filters. Focused holdings/runtime
  tests and backend type-check passed.
- Turn 128: Added disabled Connect runtime wiring for the standalone TS backend:
  cloud/connect action routes now return explicit feature-disabled 501
  responses, local Connect list routes return empty arrays like Rust feature-off
  builds, and broker sync profile routes are marked as an explicit TS migration
  gap pending activity profile persistence. Focused runtime tests and backend
  type-check passed.
- Turn 129: Added disabled device-sync runtime wiring for the standalone TS
  backend: `/connect/device/*`, device management, team-key/reset, and pairing
  routes now return explicit feature-disabled 501 responses instead of un-wired
  404s while real device-sync side effects remain deferred. Focused runtime
  tests and backend type-check passed.
- Turn 130: Added local broker sync profile persistence behind the standalone TS
  Connect runtime: profile reads now follow Rust account/broker/system/default
  precedence, profile rule saves merge patches into `BROKER_ACTIVITY`
  import-template rows, account-scoped saves upsert broker profile links, and
  runtime writes queue import-template/profile sync_outbox rows while cloud
  Connect remains disabled. Focused activities/runtime tests and backend
  type-check passed.
- Turn 131: Added bounded local quote-backed symbol performance history:
  `symbol` performance requests now calculate Rust-style cumulative returns,
  carry-forward missing quote days, annualized returns, volatility, and drawdown
  from existing SQLite quote asset IDs instead of returning 501, while
  provider-backed fetch/resolution remains deferred. Focused portfolio/runtime
  tests and backend type-check passed.
- Turn 132: Extended local symbol performance resolution so `symbol` history
  requests resolve existing local assets by exact `asset_id`, case-insensitive
  `display_code`, or case-insensitive `instrument_symbol` before reading quotes,
  while preserving the original response id and keeping provider fetch deferred.
  Focused portfolio tests, backend type-check, full check, and focused review
  passed.
- Turn 133: Wired local add-on filesystem runtime behavior into the standalone
  TS backend: installed add-on listing, enable toggles, uninstall, runtime file
  loading, enabled-on-startup loading, safe staging cleanup, explicit disabled
  archive/store errors, and route/runtime coverage now work against
  `appDataDir/addons` while zip extraction/install, store HTTP/update, full
  manifest/security validation, and sandbox host behavior remain deferred.
  Focused add-on/runtime tests and backend type-check passed.
- Turn 134: Wired explicit deferred runtime gates for standalone portfolio job
  execution and market-data sync execution: `/api/v1/portfolio/update`,
  `/api/v1/portfolio/recalculate`, `/api/v1/market-data/sync/history`, and
  `/api/v1/market-data/sync` now return 501 `not_implemented` instead of
  un-wired 404s while the real background runner, market sync, and recalculation
  side effects remain deferred. Focused portfolio/market-data/runtime tests and
  backend type-check passed.
- Turn 135: Normalized local add-on manifest parsing to match Rust metadata
  semantics: required `id`/`name`/`version`/`main`, optional scalar/null fields,
  legacy string permission conversion, object permission defaults, keyword
  string filtering, and runtime-field dropping now apply before listing/loading
  local add-ons. Focused add-on/runtime tests and backend type-check passed.
- Turn 136: Added local add-on ZIP archive extraction/install parity in the TS
  runtime: safe archive path validation, UTF-8 text decoding, manifest and main
  file detection, Rust-compatible permission detection/merging, install-time
  runtime manifest fields, staged `{addonId}.zip` install cleanup, route wiring,
  and `fflate` dependency management. Focused add-on/http/runtime tests, backend
  type-check, full `bun run check`, and focused code review passed.
- Turn 137: Added add-on store HTTP/update/download-staging parity in the TS
  runtime: store listing parsing, rating submission, update checks with
  per-add-on fallback errors, direct/redirected store ZIP downloads, staged ZIP
  validation, update installs that preserve existing enabled state, store
  headers with app version and instance ID, and standalone runtime wiring
  through settings-derived instance IDs. Focused add-on/http/runtime tests,
  backend type-check, full `bun run check`, and focused code review passed.
- Turn 138: Added frontend add-on runtime permission enforcement: installed
  manifest permissions now flow into addon contexts, SDK domain APIs are guarded
  at the type bridge, `sidebar.addItem`, `router.add`, and scoped secrets are
  guarded at the context boundary, bundled manifest category aliases remain
  compatible, and legacy/dev contexts without permission metadata stay
  unrestricted. Focused add-on frontend tests, frontend type-check, full
  `bun run check`, and focused code review passed.
- Turn 139: Added bounded text-only AI chat provider streaming in the standalone
  TS backend: provider config resolution is shared with AI provider settings,
  configured OpenAI-compatible/Ollama/Anthropic/Google streams emit Rust-shaped
  NDJSON events, user and assistant text messages persist with sync callbacks,
  new threads store config snapshots, parent-message edits truncate history, and
  unconfigured providers, missing API keys, attachments, and provider failures
  surface explicit errors. Backend type-check and focused backend AI/chat/http/
  runtime tests passed.
- Turn 140: Added frontend AI chat error-code aliasing for backend snake_case
  runtime errors so provider-not-configured, missing-key, provider-error,
  not-implemented, and related TS backend responses map to existing
  user-friendly chat messages instead of falling through to unknown-error UI.
  Focused AI assistant type tests passed.
- Turn 141: Added bounded text/CSV attachment support to TS AI chat streaming:
  attachment metadata and count/UTF-8 byte-size limits match the Rust reference,
  text-like attachments are injected into the provider prompt, persisted user
  messages store only filename markers, and image/PDF/binary attachments remain
  explicit deferred errors. Backend AI chat type-check and focused
  AI/chat/http/runtime tests passed.
- Turn 142: Added TS AI chat thread title generation/refinement: provider config
  now carries catalog title-model defaults, streaming emits
  `threadTitleUpdated`, generated titles persist only when the thread is still
  empty/initial, fallback titles use Rust-compatible word-boundary truncation,
  and title updates queue thread sync callbacks. Backend AI/provider type-check
  and focused AI/chat/provider/http/runtime tests passed after rubber-duck plan
  review.
- Turn 143: Added TS AI chat `<think>` fallback reasoning parsing: streamed
  think blocks now emit Rust-shaped `reasoningDelta` events, text after closing
  tags remains `textDelta`, and persisted assistant messages preserve ordered
  reasoning/text parts. Backend AI/provider type-check and focused
  AI/chat/provider/http/runtime tests passed.
- Turn 144: Added provider-native TS AI reasoning parsing for OpenAI-compatible,
  Anthropic, Ollama, and Gemini-style stream fields: native thinking/reasoning
  deltas now emit `reasoningDelta`, visible content remains `textDelta`, and
  assistant persistence preserves ordered reasoning/text parts. Backend
  AI/provider type-check and focused AI/chat/provider/http/runtime tests passed.
- Turn 145: Added bounded TS AI tool-call execution seam for OpenAI-compatible
  and Ollama providers: injected tools are filtered by model capability and
  allowlists, provider tool calls emit Rust-shaped `toolCall`/`toolResult`
  events, results are sent back for follow-up model text, and assistant
  persistence preserves ordered tool/text parts with `import_csv` CSV argument
  redaction. Backend AI/provider type-check and focused
  AI/chat/provider/http/runtime tests passed after rubber-duck plan review.
- Turn 146: Wired the first built-in TS AI portfolio tool: runtime chat now
  registers Rust-shaped `get_accounts`, returns active account id/name/type/
  currency/isActive data with Rust-compatible truncation metadata, and keeps
  OpenAI-compatible/Ollama tool execution behind provider capability/allowlist
  gates. Backend type-check and focused AI chat/tool/runtime/http tests passed.
- Turn 147: Wired the Rust-shaped `get_holdings` AI portfolio tool into the TS
  runtime registry: holdings service composition is shared with chat tools, cash
  positions are filtered, account names/base currency/view mode are returned,
  and Rust-compatible 100-holding truncation metadata is preserved. Backend
  type-check and focused AI chat/tool/runtime/http tests passed.
- Turn 148: Wired the Rust-shaped `get_cash_balances` AI portfolio tool into the
  TS runtime registry: active-account TOTAL expansion, direct account lookups,
  cash-only balance extraction, latest-valuation account-currency precedence,
  base-currency fallback/error behavior, and empty-account short-circuiting now
  match the Rust tool. Backend type-check and focused AI chat/tool/runtime/http
  tests passed.
- Turn 149: Wired the Rust-shaped `get_goals` AI portfolio tool into the TS
  runtime registry by sharing the runtime goal service with chat tools,
  returning persisted summary target/current/progress/deadline fields, achieved
  counts, and Rust-compatible 50-goal truncation metadata. Backend type-check
  and focused AI chat/tool/runtime/http tests passed.
- Turn 150: Wired the Rust-shaped `search_activities` AI portfolio tool into the
  TS runtime registry by sharing the runtime activity service with chat tools,
  mapping one-based tool pagination to zero-based backend search, resolving
  account names to ids, validating date filters, and returning Rust-compatible
  activity DTOs/metadata. Backend type-check and focused AI
  chat/tool/runtime/http tests passed.
- Turn 151: Wired the Rust-shaped `get_income` AI portfolio tool into the TS
  runtime registry by sharing the runtime portfolio metrics service with chat
  tools, mapping period selection, YoY optionality, type/month breakdowns, and
  sorted positive top income assets. Backend type-check and focused AI
  chat/tool/runtime/http tests passed.
- Turn 152: Wired the Rust-shaped `get_valuation_history` AI portfolio tool into
  the TS runtime registry by sharing holdings/account services with chat tools,
  supporting TOTAL aggregation across active accounts, single-account histories,
  Rust-compatible date defaults, base-currency conversion, sorting, and
  400-point truncation metadata. Backend type-check and focused AI
  chat/tool/runtime/http tests passed.
- Turn 153: Wired the Rust-shaped `get_asset_allocation` AI portfolio tool into
  the TS runtime registry by sharing holdings allocation services with chat
  tools, supporting allocation grouping by class/sector/region/risk/security
  type, Rust-compatible invalid grouping errors, and category drill-down holding
  output. Backend type-check and focused AI chat/tool/runtime/http tests passed.
- Turn 154: Wired the Rust-shaped `get_performance` AI portfolio tool into the
  TS runtime registry by sharing the portfolio metrics service with chat tools,
  mapping YTD/1M/3M/6M/1Y/ALL periods to calculation date ranges, preserving
  account/TOTAL requests, base-currency fallback, and optional metric omission.
  Backend type-check and focused AI chat/tool/runtime/http tests passed.
- Turn 155: Wired the Rust-shaped `get_health_status` AI tool into the TS
  runtime registry by adding cached-status access to the health service, sharing
  the runtime health service with chat tools, preserving NOT_COMPUTED behavior
  before a health check has run, and mapping cached issue
  severity/category/details output. Backend type-check and focused AI
  chat/health/runtime/http tests passed.
- Turn 156: Wired the Rust-shaped `record_activity` AI tool into the TS runtime
  registry as a no-side-effect draft builder: account resolution/auto-selection,
  activity validation, amount computation, subtype options, timezone-aware tool
  guidance, market symbol resolution with account-currency preference, and
  custom asset prompts are covered. Backend type-check, focused AI
  chat/tool/runtime/http tests, full `bun run check`, and focused code review
  passed.
- Turn 157: Wired the Rust-shaped `record_activities` AI tool into the TS
  runtime registry by reusing single-activity draft normalization for batch
  rows, adding 100-row limit enforcement, row-level validation errors,
  empty-batch behavior, available-account output, and resolved-asset
  de-duplication. Backend type-check, focused AI chat/tool/runtime/http tests,
  full `bun run check`, and focused code review passed.
- Turn 158: Wired the Rust-shaped `import_csv` AI tool into the TS runtime
  registry for CSV import mapping inference only: complete CSV content handling,
  saved-profile loading, parse-config precedence, field/activity mapping
  inference and merging, account sanitization, sample-row output, confidence
  badges, and CSV attachment prompt guidance are covered. Backend type-check,
  focused AI chat/tool/runtime/http tests, focused code review with a
  saved-profile flag fix, and full `bun run check` passed.
- Turn 159: Wired provider-native tool-call protocols for Anthropic and
  Gemini/Google into the TS AI chat loop: Anthropic tool schemas, block-indexed
  `tool_use` partial JSON assembly, grouped `tool_result` blocks with
  `is_error`, Gemini function declarations, function-call/function-response
  message turns, and synthetic-id suppression are covered. Backend type-check
  and focused AI chat/tool/runtime/http tests passed after rubber-duck plan
  review.
- Turn 160: Added provider-native multimodal attachment handling for Anthropic
  and Gemini/Google in the TS AI chat loop: image/PDF attachments are gated by
  provider vision capability and media-type allowlists, `image/jpg` normalizes
  to `image/jpeg`, data URL prefixes are stripped before provider requests,
  binary payloads are never inlined into prompts or persistence, and unsupported
  provider/media combinations fail before chat rows are created. Backend
  type-check and focused AI chat/runtime/http tests passed after rubber-duck
  plan review.
- Turn 161: Wired TS `WF_SECRET_BACKEND=keyring` startup to a native keyring
  secret service using `@napi-rs/keyring`, Rust-compatible desktop service IDs,
  the `default` username, `WF_SECRET_NAMESPACE` normalization, missing-entry
  null/idempotent delete behavior, and explicit native keyring errors without
  disk fallback. Rubber-duck review caught and the slice removed the insecure
  CLI `security -w <secret>` path; a second review found no blocking concerns.
  Focused secrets/runtime tests, a native keyring probe, backend type-check, and
  full `bun run check` passed.
- Turn 162: Added OpenAI-compatible and Ollama image attachment payload support
  to the TS AI chat loop: OpenAI-compatible providers send validated images as
  `image_url` content parts, Ollama sends validated images in `images` arrays,
  provider vision/media allowlists still reject unsupported images and PDFs,
  `image/jpg` normalizes to `image/jpeg`, data URL prefixes are stripped or
  reconstructed safely, and persisted chat rows keep only attachment filename
  markers. Focused AI chat tests and backend type-check passed after rubber-duck
  plan review.
- Turn 163: Wired TS Health Center `sync_prices` and `retry_sync` fix dispatch
  into the market-data sync seam: health fixes now validate Rust-compatible
  non-empty string-array payloads, delegate incremental asset sync to the
  runtime market-data service, clear cached status only after successful sync,
  preserve 400 empty-payload behavior, and surface the current market-sync 501
  instead of route-level 404. Focused health/runtime tests and backend
  type-check passed after rubber-duck plan review.
- Turn 164: Added Rust-compatible no-op market-data sync branches in the TS
  runtime seam: `MarketSyncMode::None` and explicit empty asset-target syncs now
  resolve successfully without touching the still-deferred provider sync engine,
  while broad incremental/history syncs continue to return explicit 501. Focused
  market-data/runtime tests and backend type-check passed.
- Turn 165: Wired Health Center `fetch_fx` fix dispatch into the TS
  exchange-rate seam: `fetch_fx` now validates currency-pair payloads, delegates
  valid pairs to `ensureFxPairs`, clears cached health status after successful
  registration, and is wired in standalone runtime while real provider-backed FX
  quote fetching remains part of the market-sync follow-up. Focused
  health/runtime tests and backend type-check passed.
- Turn 166: Wired targeted Health Center `migrate_classifications` fix dispatch
  into the TS taxonomy migration seam: health fixes now validate string-array
  payloads, pass selected asset IDs to legacy classification migration, allow
  empty payloads as a Rust-compatible no-op, clear cached status after
  successful migration, and preserve the existing full
  `migrate_legacy_classifications` path. Focused health/taxonomy/runtime/http
  tests, backend type-check, and rubber-duck plan review passed.
- Turn 167: Added Rust-shaped affected items for legacy-classification health
  issues in the TS runtime: taxonomy now exposes internal migration details with
  assets needing migration, health issues include `/holdings/{id}` affected-item
  routes with asset-symbol fallback names, and dismissal hashes now include the
  affected asset set when details are available. Focused health/taxonomy tests,
  backend type-check, and rubber-duck plan review passed.
- Turn 168: Added bounded price-staleness Health Center checks to the TS
  runtime: health now consolidates active-account holdings, uses latest quote
  snapshots, reports missing/stale market-priced assets with affected items and
  `sync_prices` fixes, preserves strict market-value severity escalation, and
  wires holdings/market-data providers into the standalone runtime. Focused
  health/runtime tests, backend type-check, full `bun run check`, and code
  review refinement passed.
- Turn 169: Added bounded FX integrity Health Center checks to the TS runtime:
  exchange rates now expose latest FX asset quote snapshots with nullable quote
  timestamps, health gathers active-account FX pair exposure from holdings,
  reports missing/stale exchange-rate issues with `fetch_fx` fixes, preserves
  strict market-value severity escalation, and keeps direct-before-inverse FX
  asset lookup parity. Focused health/exchange-rate/runtime tests, backend
  type-check, and rubber-duck/code-review refinements passed.
- Turn 170: Added bounded quote-sync error Health Center checks to the TS
  runtime: market data now exposes ordered quote-sync error snapshots, health
  reports persistent/recent quote sync failures with Rust-shaped affected items,
  details, retry fixes, and market-data navigation, and preserves unheld asset,
  manual quote-mode filtering, warning severity, and strict error escalation
  semantics. Focused health/market-data/runtime tests, backend type-check, and
  rubber-duck/code-review refinements passed.
- Turn 171: Added bounded data-consistency health checks for negative account
  balances: TS health now reports negative non-cash portfolio balances and
  negative cash-account balances from daily account valuations with Rust-shaped
  affected accounts, details, activity navigation, decimal formatting, and
  deterministic first-negative-row selection. Focused health/runtime tests,
  backend type-check, and rubber-duck/code-review refinements passed.
- Turn 172: Added bounded targeted Yahoo market-data sync execution in the TS
  runtime: explicit non-empty asset targets now fetch Yahoo historical quotes,
  reuse provider override/suffix symbol mapping, upsert provider quotes, update
  `quote_sync_state`, normalize Yahoo minor currencies, refresh crumbs on 401,
  preserve existing provider quotes on empty backfill windows, and keep broad
  market sync/history routes explicitly deferred. Focused market-data tests,
  backend type-check, full `bun run check`, rubber-duck plan review, and
  code-review refinement passed.
- Turn 173: Wired Health Center `fetch_fx` fixes through targeted FX quote sync:
  `ensureFxPairs` now returns created/existing direct or inverse FX asset IDs,
  health fixes register missing pairs then invoke targeted market-data sync when
  available, registration-only fallback remains intact for partial providers,
  and activity runtime wrappers ignore the returned IDs for existing behavior.
  Focused exchange-rate/health tests, backend type-check, full `bun run check`,
  rubber-duck plan review, and code review passed.
- Turn 174: Added standalone runtime coverage for the HTTP `fetch_fx` fix path:
  the low-risk runtime smoke now verifies `/api/v1/health/fix` registers an FX
  pair, uses the composed market-data service to fetch a Yahoo FX quote, and
  persists the quote in SQLite while preserving existing asset-list assertions.
  Focused runtime tests, backend type-check, and full `bun run check` passed.
- Turn 175: Added bounded broad Yahoo market-data sync execution in the TS
  runtime: `syncHistoryQuotes` now runs a broad 5-year Yahoo backfill,
  `/market-data/sync` broad incremental/refetch/backfill no longer return 501
  for local Yahoo assets, non-Yahoo providers remain skipped, inactive assets
  are included only for broad history, and broad backfill avoids catalog quote
  purges without sync/activity references. Focused market-data/runtime tests,
  type-check, full `bun run check`, rubber-duck plan review, and code review
  passed.
- Turn 176: Added bounded portfolio job execution in the standalone TS runtime:
  `/api/v1/portfolio/update` and `/api/v1/portfolio/recalculate` now run market
  sync events, derive account valuations from existing holdings snapshots,
  regenerate TOTAL snapshots from non-archived accounts, upsert
  `daily_account_valuation` rows transactionally, and roll back on missing TOTAL
  FX conversion instead of persisting mixed-currency data. Focused
  portfolio/runtime tests, type-check, full `bun run check`, rubber-duck plan
  review, and three code-review refinements passed.
- Turn 177: Added OpenAI-compatible Chat Completions PDF attachment payloads to
  the TS AI chat loop: validated PDFs now serialize as `type: "file"` content
  parts with data-URL `file_data` and `filename`, image serialization remains
  unchanged, persisted chat rows still keep only attachment markers, and Ollama
  PDFs remain rejected because the documented `/api/chat` multimodal surface is
  images-only. Focused AI chat tests and backend type-check passed.
- Turn 178: Preserved Rust Health Center dismissal carryover by replacing the TS
  health data-hash helper with a Rust `DefaultHasher`-compatible SipHash-1-3
  subset for string, severity, u32, and i32 components. Existing
  account/timezone, price-staleness, quote-sync, FX-integrity,
  legacy-classification, and negative-balance issue IDs now match Rust-generated
  vectors so matching `health_issue_dismissals` rows remain effective after TS
  cutover. Focused health tests, type-check, rubber-duck plan review, and
  focused code review passed.
- Turn 179: Added market-sync result accounting parity for the standalone TS
  runtime: market-data sync now returns Rust-shaped synced/failed/skipped quote
  counts plus failure and skipped-reason tuples, and portfolio job
  `market:sync-complete` events now forward those details instead of always
  publishing empty arrays. Focused market-data/portfolio tests, full
  `bun run check`, and focused code review passed.
- Turn 180: Completed service-level Health Center legacy-classification fix
  dispatch parity: the TS health service now handles its own generated
  `migrate_legacy_classifications` fix action by invoking the taxonomy migration
  provider without a targeted asset filter, in addition to the targeted
  `migrate_classifications` action, and `/health/fix` now delegates through the
  service when present so cache invalidation is preserved. Focused health/http
  tests and type-check passed after code-review refinement.
- Turn 181: Wired the existing domain-event worker into the standalone TS
  runtime: SQLite-backed services now create a worker bound to the shared event
  bus, timezone settings, and local portfolio job service so
  `holdings_changed`/related domain events can trigger debounced portfolio
  recalculation instead of only having isolated planner/processor helpers.
  Runtime close and database restore now use worker-level flush-and-dispose
  draining before SQLite shutdown. Focused runtime/domain-event tests, full
  `bun run check`, and final focused code review passed.
- Turn 182: Matched the Rust queue-worker post-portfolio behavior by adding an
  optional domain-event goal-summary refresh action after portfolio job
  execution and wiring the standalone TS runtime to rebuild active goal
  summaries from the latest SQLite account valuations. Refresh valuation-load
  failures, active-goal load failures, and per-goal failures are logged without
  failing the domain event batch, matching Rust's best-effort behavior. Focused
  processor/runtime tests, full `bun run check`, and focused code review passed
  after the best-effort active-goal-load refinement.
- Turn 183: Added bounded activity-derived holdings snapshot rebuilding for
  transaction-mode accounts in TS portfolio jobs: posted common activity flows
  replay into cumulative `CALCULATED` snapshots before valuation/TOTAL
  recalculation, `sinceDate` replay seeds from the latest prior snapshot,
  HOLDINGS-mode/manual snapshots are preserved, unsupported split/adjustment and
  asset-transfer cases warn rather than silently no-op, and standalone runtime
  `activities_changed` events now trigger the rebuild path. Focused
  portfolio/runtime tests and backend type-check passed.
- Turn 184: Added bounded `ADJUSTMENT` subtype parity for option expiries in TS
  activity snapshot replay: `OPTION_EXPIRY` activities now remove lots via FIFO
  without cash effects, preserving net contribution while reducing cost basis
  and market value. Focused portfolio tests and backend type-check passed.
- Turn 185: Added split preprocessing parity for TS activity snapshot replay:
  valid `SPLIT` ratios now adjust prior activity quantities/prices, same-day
  asset splits are deduplicated across transaction accounts, and since-date
  replay restarts from earliest activity when a split enters the recalculation
  range so historical lots are rebuilt split-adjusted. Focused portfolio tests
  and backend type-check passed.
- Turn 186: Added lot-level asset transfer parity for TS activity snapshot
  replay: same-day `TRANSFER_OUT` accounts now run before paired `TRANSFER_IN`
  accounts by `source_group_id`, same-account pairs avoid unit-price fallback,
  FIFO removed lots carry acquisition dates/cost basis into destination
  accounts, unpaired cached lots warn, and external transfer-ins use
  position-currency fallback lots with FX conversion. Focused portfolio/runtime
  tests, full `bun run check`, and three focused code-review passes completed.
- Turn 187: Matched Rust adjustment no-op parity for TS activity snapshot
  replay: non-`OPTION_EXPIRY` `ADJUSTMENT` activities now leave holdings, cash,
  and contribution state unchanged without warnings. Focused portfolio tests and
  backend type-check passed.
- Turn 188: Added Rust-compatible broker FX handling for TS BUY/SELL activity
  snapshot replay: BUY lots now convert unit price and fees into position
  currency, and BUY/SELL cash effects book in account currency when broker
  `fx_rate` is present. Focused portfolio tests, backend type-check, and focused
  code review passed.
- Turn 189: Added Rust-compatible option contract multiplier handling for TS
  activity snapshot replay: newly created positions now read OPTION metadata
  multipliers, default OPTION assets to 100, and carry multiplier effects
  through BUY/SELL cash, cost basis, lots, and valuation. Focused portfolio
  tests, backend type-check, and focused code review passed.
- Turn 190: Added Rust-compatible activity compiler parity for TS snapshot
  replay: DRIP, dividend-in-kind, and staking-reward activities now expand into
  income + BUY legs before split adjustment, respect `activity_type_override`,
  derive missing income/acquisition prices like Rust, and clear synthetic leg
  overrides. Focused portfolio/runtime tests, backend type-check, and focused
  code review passed.
- Turn 191: Wired market-data mutation side effects into TS portfolio jobs:
  manual quote update/delete/import routes now enqueue full recalculation jobs,
  and `/api/v1/market-data/sync` now enqueues an incremental portfolio job with
  the requested market-sync mode when a portfolio job service is present.
  Focused HTTP tests, backend type-check, full `bun run check`, and focused code
  review passed.
- Turn 192: Wired exchange-rate mutation side effects into TS portfolio jobs:
  add/update/delete FX rate routes now enqueue full recalculation jobs after
  successful mutations, matching Rust `trigger_full_portfolio_recalc` behavior.
  Focused HTTP tests, backend type-check, full `bun run check`, and focused code
  review passed.
- Turn 193: Wired alternative-asset mutation side effects into TS portfolio
  jobs: create, valuation update, and delete routes now enqueue incremental
  recalculation jobs after successful mutations, while metadata and liability
  link routes stay no-op for portfolio jobs like Rust. Focused HTTP tests,
  backend type-check, full `bun run check`, and focused code review passed.
- Turn 194: Wired settings mutation side effects into TS portfolio jobs:
  base-currency changes now enqueue a backfill-history full recalculation, while
  timezone-only changes enqueue a no-market-sync full recalculation. Focused
  HTTP tests, backend type-check, full `bun run check`, and focused code review
  passed.
- Turn 195: Addressed milestone review feedback for settings parity: TS settings
  updates now clear the health cache after successful mutation, matching Rust's
  `health_service.clear_cache()` side effect. Focused HTTP tests, backend
  type-check, full `bun run check`, and focused code review passed.
- Turn 196: Matched Rust portfolio-job market-sync success side effects in the
  TS runtime: successful market sync now clears the health cache before
  portfolio recalculation, and FX service reinitialization failures warn without
  aborting the job, while market-sync failures still abort before those
  success-only side effects and post-sync cache-clear failures do not publish
  misleading market-sync errors. Focused portfolio-job tests, backend
  type-check, full `bun run check`, and focused code review passed.
- Turn 197: Matched Rust queue-worker continuation semantics for domain-event
  portfolio jobs: portfolio job failures are reported through an explicit hook
  or default warning fallback, but no longer abort goal-summary refresh or
  downstream broker-sync planning; goal-summary refresh failures also warn
  without preventing broker sync. Focused domain-event processor tests, backend
  type-check, full `bun run check`, and focused code review passed.
- Turn 198: Tightened health-cache clear parity: TS health cache clearing is now
  modeled as an infallible synchronous service operation, and settings/portfolio
  callers warn without aborting committed settings changes or portfolio
  recalculation if a cache-clear callback unexpectedly throws. Focused HTTP and
  portfolio-job tests, backend type-check, full `bun run check`, and milestone
  review passed.
- Turn 199: Added SQLite-backed local Connect read parity for the standalone TS
  runtime: `/connect/synced-accounts`, `/connect/platforms`,
  `/connect/sync-states`, and `/connect/import-runs` now read local account,
  platform, sync-state, and import-run repositories with Rust-compatible
  ordering, enum fallback, JSON parsing, and timestamp serialization while
  cloud/session/sync operations remain explicitly disabled. Focused Connect
  runtime/HTTP tests and backend type-check passed.
- Turn 200: Tightened local Connect optional timestamp parity: invalid optional
  sync-state/import-run timestamps now deserialize to `null` like Rust instead
  of falling back to the current time. Focused Connect runtime tests and backend
  type-check passed.
- Turn 201: Tightened TS activity snapshot replay contribution FX parity: cash
  contribution fields now use transaction `fx_rate` for account-currency net
  contribution, fall back to FxService when `fx_rate` is absent, and compute
  base contribution through FxService instead of reusing account-currency
  `fx_rate`; position-currency transfer base contributions also avoid activity
  `fx_rate` when base currency equals account currency. Focused portfolio-job
  tests and backend type-check passed.
- Turn 202: Matched Rust activity snapshot cash-total FX fallback semantics:
  generated transaction-mode snapshots now use unconverted cash amounts for
  cash-total fields when FxService cannot provide a rate, while TOTAL snapshot
  recalculation keeps its strict FX gate. Focused portfolio-job tests and
  backend type-check passed.
- Turn 203: Matched Rust generated snapshot cost-basis currency semantics:
  activity-built transaction snapshots now convert each position's cost basis
  from position currency into account currency at the snapshot date, falling
  back to the unconverted amount if FxService cannot provide a rate. Full
  portfolio-job tests and backend type-check passed.
- Turn 204: Added bounded custom-provider-backed symbol quote resolution:
  `resolveSymbolQuote` now honors `CUSTOM:<code>` provider preferences by using
  the runtime custom-provider source/test-source service before Yahoo fallback,
  tries latest sources before historical fallback windows, returns
  `CUSTOM_SCRAPER:<code>` provider IDs, and wires the standalone runtime to
  share one custom provider service with market data. Focused market-data tests,
  backend type-check, full repository check, and focused code review passed.
- Turn 205: Added bounded custom-provider latest quote sync: targeted and
  incremental `syncMarketData` now syncs assets configured with
  `preferred_provider: CUSTOM_SCRAPER` plus `custom_provider_code`, honors
  `CUSTOM:<code>` symbol overrides, writes `CUSTOM_SCRAPER:<code>` quote rows
  without falling back to Yahoo, preserves zero-price quote persistence, and
  records the resolved custom source in quote sync state. Full historical custom
  sync and general-purpose custom provider sync remain explicitly skipped.
  Focused market-data tests, backend type-check, full `bun run check`, and
  focused code review passed.
- Turn 206: Added bounded general-purpose custom-provider latest sync:
  `CUSTOM_SCRAPER` assets without `custom_provider_code` now try enabled custom
  providers in priority order, require source URLs with `{SYMBOL}`, try latest
  sources before historical fallback sources, honor per-source `CUSTOM:<code>`
  symbol overrides, and persist `CUSTOM_SCRAPER:<code>` quote rows plus actual
  quote sync state sources. Historical custom provider backfill remains
  explicitly skipped. Focused market-data tests, backend type-check, full
  `bun run check`, and focused code review passed.
- Turn 207: Added bounded explicit custom-provider historical backfill:
  `backfill_history` now supports assets with `custom_provider_code` and a
  configured historical source by fetching multi-row custom-provider results,
  expanding `{FROM}`/`{TO}`, honoring `CUSTOM:<code>` symbol overrides, purging
  only existing `CUSTOM_SCRAPER:<code>` provider quotes on historical success,
  writing all extracted quote rows, and updating quote sync state. Latest
  fallback and general-purpose historical discovery remain explicitly deferred
  to avoid history-loss ambiguity during backfill. Focused custom-provider and
  market-data tests, backend type-check, full `bun run check`, and focused code
  review passed.
- Turn 208: Added bounded general-purpose custom-provider historical discovery:
  `backfill_history` for `CUSTOM_SCRAPER` assets without `custom_provider_code`
  now tries enabled historical sources whose URLs contain `{SYMBOL}` in provider
  priority order, honors per-source `CUSTOM:<code>` overrides, skips empty or
  failing sources, writes quotes under the actual `CUSTOM_SCRAPER:<code>`
  source, and keeps later sync attempts in general discovery mode even when sync
  state stores the last successful source. Latest fallback during backfill
  remains explicitly deferred. Focused market-data tests, backend type-check,
  full `bun run check`, focused code review, and targeted re-review passed.
- Turn 209: Added custom-provider latest fallback for historical backfill:
  explicit and general-purpose custom-provider `backfill_history` now falls back
  to latest sources only when no historical source candidates exist, writes a
  single `CUSTOM_SCRAPER:<code>` quote row, and updates quote sync state without
  purging existing historical provider quotes. Historical sources that exist but
  fail or return no rows still fail the backfill instead of masking errors.
  Focused market-data tests, backend type-check, full `bun run check`, focused
  review, and purge-safety re-review passed.
- Turn 210: Added Börse Frankfurt provider sync parity: targeted, incremental,
  broad, and history market-data sync now resolve exact-MIC ISINs, fetch
  historical quotes with browser headers and epoch-second ranges, persist
  `BOERSE_FRANKFURT` quote rows/state, treat provider `no_data` as clean
  zero-quote syncs, divide bond percentage prices deterministically, and resolve
  latest quote summaries through the price-information endpoint. Focused
  market-data tests, backend type-check, full `bun run check`, and focused code
  review passed after sharing the per-resolve ISIN cache.
- Turn 211: Added MarketData.app provider sync/resolve parity: targeted,
  incremental, broad, and history sync now use the configured provider API key,
  fetch candle history with bearer-authenticated trailing-slash endpoints,
  supplement current-day candles with the latest price without aborting
  successful history, persist `MARKETDATA_APP` quote rows/state, preserve
  exchange-MIC currency precedence, and resolve latest quote summaries through
  the prices endpoint. Focused market-data tests, backend type-check, full
  `bun run check`, and focused code review passed.
- Turn 212: Added Finnhub equity provider sync/resolve parity: targeted,
  incremental, broad, and history sync now use the runtime provider API key,
  fetch daily candle history with `X-Finnhub-Token`, persist `FINNHUB` quote
  rows/state, skip invalid candle timestamps like Rust, preserve exchange-MIC
  currency precedence, and resolve latest quote summaries through the quote
  endpoint. Focused market-data tests, backend type-check, full `bun run check`,
  and focused code review passed after the timestamp skip parity fix.
- Turn 213: Added Alpha Vantage provider sync/resolve parity: targeted,
  incremental, broad, and history sync now use the runtime provider API key,
  provider-specific MIC suffix/currency metadata, `TIME_SERIES_DAILY` equity
  quotes, `FX_DAILY` exchange-rate quotes, and `DIGITAL_CURRENCY_DAILY` crypto
  quotes, with Rust-compatible API error/rate-limit handling, date filtering,
  unsupported option failures, and latest quote resolution through daily series.
  Focused market-data tests, backend type-check, full `bun run check`,
  rubber-duck plan review, and focused code review passed after tightening
  crypto market-currency coverage.
- Turn 214: Added Metal Price API provider sync/resolve parity: targeted,
  incremental, broad, and history sync now use the runtime provider API key,
  token-authenticated timeframe/latest endpoints, supported metal symbols and
  weight suffix multipliers, Decimal-backed rate inversion, noon-UTC historical
  timestamps, empty-rate failure handling, quote sync state updates, and latest
  quote resolution for metal instruments. Focused market-data tests, backend
  type-check, full `bun run check`, and focused code review passed after adding
  empty timeframe response coverage.
- Turn 215: Added US Treasury calculated bond provider sync/resolve parity:
  targeted, incremental, broad, and history sync now auto-route US912 bond ISINs
  to `US_TREASURY_CALC`, parse Treasury.gov yearly XML yield curves with
  service-scoped caching, require bond maturity metadata, calculate coupon and
  zero-coupon prices from interpolated curves, persist 16:00 UTC quote
  rows/state, preserve single-year latest-curve fallback semantics, and resolve
  latest quotes for existing bond assets with metadata. Focused market-data
  tests, backend type-check, full `bun run check`, rubber-duck plan review, and
  focused code review passed.
- Turn 216: Added OpenFIGI bond search fallback parity: market-data search now
  falls through from empty or non-MIC Yahoo search results to OpenFIGI exact
  identifier mapping and free-text bond-sector search, posts Rust-compatible
  mapping/search bodies, tries FIGI identifier types in Rust order,
  de-duplicates by display name/exchange, preserves Rust's uppercased-query
  symbol behavior, and returns `OPENFIGI` bond search summaries. Focused
  market-data tests, backend type-check, full `bun run check`, and focused code
  review passed after correcting the free-text symbol parity issue.
- Turn 217: Added Finnhub and Alpha Vantage search fallback parity: market-data
  search now tries Finnhub and Alpha Vantage through the runtime secret service
  after empty or non-MIC Yahoo results before OpenFIGI, preserves Rust registry
  fallback semantics for the first non-empty non-MIC fallback, maps Finnhub
  security types and Yahoo suffix MICs, maps Alpha Vantage symbol-search type,
  currency, score, region, and API error/rate-limit behavior, and keeps the
  normal search merge/existing-asset de-duplication path. Focused market-data
  tests, backend type-check, full `bun run check`, and focused code review
  passed.
- Turn 218: Added provider-backed activity import asset preview resolution:
  runtime activity previews now use market-data symbol search plus exchange
  metadata to resolve missing equity exchange MICs before falling back to manual
  review, preserve Rust's bare-symbol-first then currency-suffix fallback
  behavior, prefer currency-matching MICs, retain provider names in new-asset
  drafts, cache searches per preview batch, and keep provider failures
  success-shaped as unresolved preview rows. Focused activities tests, backend
  type-check, full `bun run check`, rubber-duck plan review, and focused code
  review passed.
- Turn 219: Added provider-backed activity import check resolution: runtime
  import validation now enriches symbol-only market import rows with market-data
  symbol search, account/activity-currency-aware MIC selection, provider names,
  inferred equity type, and quote currency before normal read-only validation,
  keeps manual-quoted assets local, preserves unresolved provider misses as
  validation errors, and round-trips checked rows through import apply without
  re-resolving. Focused activities tests, backend type-check, full
  `bun run check`, rubber-duck plan review, and focused code review passed.
- Turn 220: Added ISIN-first activity import check resolution: runtime import
  validation now normalizes CSV ISIN keys, resolves existing local assets by
  `metadata.identifiers.isin` before provider calls, searches providers by ISIN
  before ticker fallback, and preserves the original import symbol while
  carrying provider/local MIC, name, type, and quote currency into the checked
  row. Focused activities tests, backend type-check, full `bun run check`, and
  focused code review passed.
- Turn 221: Added ISIN-first activity import asset preview resolution: runtime
  import asset previews now use candidate ISINs for local existing-asset matches
  before provider calls and pass normalized ISINs into provider search before
  ticker fallback, preserving the candidate symbol while carrying provider MICs
  and names into preview drafts. Focused activities tests, backend type-check,
  full `bun run check`, and focused code review passed.
- Turn 222: Added provider-backed activity import preview type/currency
  inference: runtime import asset previews now let provider search fill missing
  instrument type and quote currency before validation, reuse provider
  quote-type mapping for non-equity assets, avoid provider calls for manual or
  already complete non-equity previews, and preserve existing missing-exchange
  behavior for unresolved market equities. Focused activities tests, backend
  type-check, full `bun run check`, and focused code review passed.
- Turn 223: Added activity quote-mode asset side-effect sync parity: activity
  create/update/import paths that silently switch existing assets between MARKET
  and MANUAL now queue asset Update sync callbacks with Rust-shaped asset
  payloads, preserve Create-only callbacks for activity-created assets, and
  clear stale quote sync state when switching to MANUAL. Focused activities
  tests, backend type-check, and full `bun run check` passed.
- Turn 224: Added provider-backed direct activity import apply resolution:
  runtime import apply now uses the same symbol/ISIN provider-resolution helper
  as import check/preview before preflight validation, so symbol-only market
  rows can create provider-enriched assets even without a prior check
  round-trip. Focused activities tests, backend type-check, and full
  `bun run check` passed.
- Turn 225: Added provider-backed direct holdings import write resolution:
  imported holdings snapshots now reuse exact provider symbol matches before
  creating new local market assets, preserving local exact-symbol precedence and
  ignoring non-exact provider matches. Focused holdings tests and backend
  type-check, and full `bun run check` passed.
- Turn 226: Added holdings snapshot asset sync side-effect parity: manual and
  imported snapshot writes now queue Rust-shaped asset Create/Update callbacks
  for newly created, reactivated, or MANUAL quote-mode-updated assets before
  dependent snapshot callbacks, clear stale quote sync state when switching to
  MANUAL, and persist runtime `asset` sync_outbox rows without generated
  `instrument_key` payloads. Focused holdings/runtime tests, backend type-check,
  and full `bun run check` passed.
- Turn 227: Added provider-backed manual holdings save resolution: manual
  snapshot writes now reuse exact provider symbol matches before persistence to
  fill exchange MIC, name, and missing quote currency for market-priced assets,
  while preserving local exact-symbol precedence, ignoring non-exact provider
  matches, and skipping provider calls for MANUAL data-source assets. Focused
  holdings tests and backend type-check passed.
- Turn 228: Tightened holdings fallback manual quote row parity: manual snapshot
  fallback quotes now persist Rust-shaped OHLC/adjclose fields, null volume, and
  noon UTC timestamps while keeping deterministic non-UUID manual quote IDs out
  of sync_outbox. Focused holdings tests and backend type-check passed.
- Turn 229: Tightened holdings provider display-name fallback parity: exact
  provider matches now use trimmed long names first and fall back to short names
  for import checks and snapshot asset creation, avoiding blank asset names when
  providers omit long names. Focused holdings tests and backend type-check
  passed.
- Turn 230: Tightened AI activity draft provider display-name fallback parity:
  `record_activity` resolved assets now use trimmed provider long names first,
  then short names, then symbols, avoiding blank draft/resolved asset names when
  provider long names are empty. Focused AI chat tool tests and backend
  type-check passed.
- Turn 231: Added direct activity create/update FX pair registration parity:
  runtime-backed activity writes now ensure activity-currency and asset-currency
  pairs against the account currency before persistence, preserving no-write
  behavior when FX registration fails. Focused activity tests, backend
  type-check, and full `bun run check` passed.
- Turn 232: Extended direct activity FX pair registration parity to bulk
  mutations: bulk create/update now prepares rows before writes, ensures
  activity-currency and asset-currency pairs once for the batch, and preserves
  atomic no-write behavior when FX registration fails. Focused activity tests,
  backend type-check, and full `bun run check` passed.
- Turn 233: Tightened direct activity manual quote timestamp parity: manual
  fallback quotes now preserve raw date-only activity inputs for quote creation,
  producing noon UTC timestamps like Rust while keeping stored activities
  normalized. Focused activity tests, backend type-check, and full
  `bun run check` passed.
- Turn 234: Extended activity manual quote timestamp parity to import apply:
  checked import rows now preserve raw date-only quote inputs through apply so
  imported manual fallback quotes also get Rust-compatible noon UTC timestamps.
  Focused activity tests, backend type-check, and full `bun run check` passed.
- Turn 235: Tightened activity garbage-symbol validation parity: import asset
  preview, import check/apply, and direct symbol-based activity asset creation
  now reject Rust-incompatible all-dash and non-cash `$...` symbols before
  provider resolution or persistence. Focused activity tests, backend
  type-check, and full `bun run check` passed.
- Turn 236: Added Rust-compatible activity import symbol disposition: import
  check/apply now treats dividend/adjustment cash placeholders and never-asset
  activity symbols as cash movements, resolves asset transfer symbols only when
  quantity or price is present, and marks ambiguous transfer symbols for review.
  Focused activity tests, backend type-check, and full `bun run check` passed.
- Turn 237: Tightened live-holdings OCC option expiration parity: TS option
  expiration detection now accepts lowercase OCC option type markers like Rust,
  but requires a non-empty underlying and 8-digit strike before hiding expired
  holdings. Focused holdings tests and backend type-check passed.
- Turn 238: Tightened Health Center data-consistency error parity: negative
  account/cash balance lookup failures now warn and return no issues for that
  failed group while preserving other health checks, matching Rust's nonfatal
  valuation-service handling. Focused health tests and backend type-check
  passed.
- Turn 239: Tightened Health Center quote-read error parity: latest quote lookup
  failures now warn and continue price staleness analysis as missing quote data,
  while quote-sync snapshot failures warn and skip only that check. Focused
  health tests and backend type-check passed.
- Turn 240: Tightened Health Center FX-read error parity: latest FX snapshot
  failures now warn and continue FX integrity analysis as missing exchange-rate
  data instead of aborting the health run. Focused health tests, backend
  type-check, and full `bun run check` passed.
- Turn 241: Tightened Health Center legacy-classification read error parity:
  migration detail/status provider failures now warn and skip only the legacy
  classification issue, matching Rust's optional migration status gathering.
  Focused health tests, backend type-check, and full `bun run check` passed.
- Turn 242: Tightened local Connect import-run query parity: `runType` is now
  forwarded exactly as Axum receives it, including empty strings, so empty or
  whitespace-only filters no longer expand to all runs. Focused HTTP/runtime
  Connect tests, backend type-check, and full `bun run check` passed.
- Turn 243: Tightened latest exchange-rate error observability parity: missing
  latest FX rates now emit a warning before rethrowing, matching Rust's logged
  error path for unavailable exchange rates. Focused exchange-rate tests,
  backend type-check, and full `bun run check` passed.
- Turn 244: Tightened activity-derived snapshot replay parity: transaction-mode
  portfolio jobs now carry calculated holdings snapshots forward for every date
  through the calculation day, so valuations exist on non-activity days like
  Rust's daily snapshot replay. Focused portfolio-job tests, backend type-check,
  and full `bun run check` passed.
- Turn 245: Tightened activity-derived snapshot position serialization parity:
  transaction-mode snapshot replay now preserves zero-quantity positions when
  reading existing snapshots and writing calculated snapshots, matching Rust's
  snapshot JSON round-trip behavior, and zero-quantity seed positions no longer
  trigger quote-gap valuation skips. Focused portfolio-job tests and backend
  type-check plus full `bun run check` passed.
- Turn 246: Tightened runtime account FX registration parity: the standalone TS
  runtime now wires account creation to the local exchange-rate service, so
  non-base account creation registers the matching FX asset like Rust's account
  service. Focused runtime test, backend type-check, and full `bun run check`
  passed.
- Turn 247: Tightened settings base-currency FX registration parity: standalone
  TS settings updates now register existing account and FX-asset currencies
  against a changed base currency, continue past individual registration
  failures with warnings, and wire the behavior into runtime settings routes.
  Focused settings/runtime tests, backend type-check, and full `bun run check`
  passed.
- Turn 248: Added direct asset auto-classification parity: newly created TS
  runtime assets now assign Rust-compatible initial `instrument_type` and
  `asset_classes` taxonomy categories through the taxonomy service, skip
  duplicate-existing asset returns, and keep asset creation successful when
  classification assignment fails. Focused asset/runtime tests, backend
  type-check, and full `bun run check` passed.
- Turn 249: Added quote-sync position lifecycle reconciliation parity: TS
  portfolio jobs now reconcile quote sync state from the latest TOTAL holdings
  snapshot before market sync and after recalculation, reactivating open non-FX
  assets, creating/reopening MARKET sync states, applying Rust's quantity
  significance threshold, and closing active sync states when positions
  disappear while warning without aborting on reconciliation failures. Focused
  market-data/portfolio-job tests, backend test suite, backend type-check, and
  full `bun run check` passed.
- Turn 250: Matched Rust asset-enrichment lifecycle event parity in the TS
  domain-event processor: batches with `AssetsCreated` enrichment work now
  publish `asset:enrichment-start`, `asset:enrichment-progress`, and
  `asset:enrichment-complete` events around the enrichment callback, and the
  runtime worker passes the shared event bus into processor options. Focused
  domain-event processor/worker tests and backend type-check passed.
- Turn 251: Matched Rust broker-sync failure continuation semantics in the TS
  domain-event processor: tracking-mode-triggered broker sync callbacks now warn
  through an explicit error hook or default warning instead of failing the whole
  batch, preserving the derived broker sync plan. Focused domain-event processor
  tests and backend type-check passed.
- Turn 252: Added bounded asset enrichment execution in the standalone TS
  runtime: domain-event workers now call the SQLite-backed asset service for
  `AssetsCreated` batches, US Treasury bond assets can fetch and persist missing
  coupon/maturity metadata from TreasuryDirect, quote sync states skip already
  profile-enriched rows, and per-asset failures warn/count without aborting the
  batch. Generic provider profile enrichment remains deferred. Focused
  assets/runtime/domain-event tests, backend type-check, rubber-duck plan
  review, and focused code review passed.
- Turn 253: Added bounded Yahoo search profile enrichment for generic MARKET
  assets: TS asset enrichment now uses Yahoo search fallback endpoints to update
  provider names, infer missing instrument types, store `metadata.profile`
  `quoteType`, and mark profile-enriched rows, while rich quoteSummary sector
  and metric profiles plus provider-based auto-classification remain deferred.
  Focused asset tests, backend type-check, and focused code review passed.
- Turn 254: Matched the first provider-profile auto-classification side effect:
  assets enriched from Yahoo search profiles now run the existing automatic
  taxonomy assignment path after instrument-type inference, preserving
  best-effort warning behavior for assignment failures. Focused asset tests and
  backend type-check passed.
- Turn 255: Added rich Yahoo quoteSummary profile enrichment for standalone TS
  asset enrichment: Yahoo profiles now try crumb-authenticated quoteSummary
  before search fallback, reuse cached Yahoo crumbs across enrichment batches,
  persist provider sector/country JSON, industry, website, market metrics,
  notes, quote currency, and quote type metadata, then retain search fallback
  behavior when quoteSummary is unavailable. Focused asset enrichment tests,
  backend type-check, backend test suite, and full `bun run check` passed.
- Turn 256: Added Rust-style provider-profile taxonomy classification after TS
  asset enrichment: Yahoo quoteType values now drive provider-specific
  `instrument_type`/`asset_classes` assignments, rich sector weights classify
  into `industries_gics`, and provider country or exchange-MIC fallback
  classifies regions. Focused asset classification tests, backend type-check,
  backend test suite, full `bun run check`, and focused code review passed.
- Turn 257: Matched asset-enrichment sync callback side effects: successful TS
  profile enrichment now queues an asset Update payload through the runtime
  sync-event callback path, preserving generated `instrument_key` omission while
  leaving profile-enriched quote-sync state marking as a separate local update.
  Focused asset enrichment tests and backend type-check passed.
- Turn 258: Added Börse Frankfurt symbol search fallback parity: market-data
  search now tries Rust-ordered Börse Frankfurt TradingView search after Yahoo,
  Finnhub, Alpha Vantage, and OpenFIGI fallbacks, maps supported German security
  types to core quote types, preserves provider MIC/ISIN results, and infers
  exchange currency from the catalog. Focused market-data search tests, backend
  type-check, backend test suite, and full `bun run check` passed.
- Turn 259: Matched Rust domain-event asset-enrichment batch behavior: TS batch
  processing now chunks enrichment IDs in groups of five, applies a per-chunk
  timeout, records chunk failures as failed assets with warnings/hooks,
  publishes per-chunk progress, and still continues portfolio-job and
  goal-refresh work. Focused domain-event tests, backend type-check, backend
  test suite, and full `bun run check` passed.
- Turn 260: Tightened direct activity-created asset inference parity: direct TS
  activity writes now infer Rust-compatible crypto/FX/option/security instrument
  metadata from symbol/kind hints, create crypto pair assets such as `btc-usd`
  without explicit instrument metadata, and reject market securities missing an
  explicit quote currency with Rust's re-select-symbol error. Activity domain
  tests, backend type-check, backend test suite, and full `bun run check`
  passed.
- Turn 261: Added direct activity-created structured asset metadata parity:
  activity-created OPTION assets now normalize OCC symbols and persist
  Rust-shaped option specs, including `contract_multiplier` overrides, while
  activity-created BOND assets canonicalize CUSIPs to ISINs, persist Rust-shaped
  bond specs, and avoid Yahoo provider defaults. Activity domain tests, backend
  type-check, backend test suite, and full `bun run check` passed.
- Turn 262: Tightened activity import asset-preview draft parity: existing-asset
  preview drafts now include parsed Rust-shaped `provider_config` and `metadata`
  plus notes, and new provider-resolved drafts now include Rust-compatible
  explicit `id`, `providerConfig`, `notes`, and `metadata` nulls. Activity
  preview tests, activity domain tests, and backend type-check passed.
- Turn 263: Matched activity-created German ISIN equity provider routing:
  pending TS assets now infer Rust-compatible `BOERSE_FRANKFURT` provider config
  for XETR/XFRA ISIN equities while preserving Yahoo defaults for other market
  assets and null provider config for bonds/manual assets. Focused provider
  config test, activity domain tests, backend type-check, backend test suite,
  and full `bun run check` passed.
- Turn 264: Matched Rust Yahoo exchange-suffix canonicalization for
  activity-created market assets: TS pending asset creation now strips
  configured Yahoo suffixes, infers MICs such as `.DE` to `XETR`, and uses MIC
  currency as a quote-currency fallback before requiring re-selection. Focused
  suffix test, activity domain tests, backend type-check, backend test suite,
  and full `bun run check` passed.
- Turn 265: Matched Rust existing-asset lookup after Yahoo suffix
  canonicalization: TS activity symbol resolution now normalizes suffixed market
  symbols before querying existing SQLite assets, preventing duplicate asset
  creation for already-known XETR/XFRA-style symbols. Focused suffix lookup
  test, activity domain tests, backend type-check, backend test suite, and full
  `bun run check` passed.
- Turn 266: Extended Yahoo suffix existing-asset parity to import asset
  previews: TS preview now normalizes suffixed MIC-backed symbols before local
  asset lookup and provider fallback, so `.DE` imports match existing XETR
  assets instead of previewing duplicate new assets. Focused preview suffix
  test, activity domain tests, backend type-check, backend test suite, and full
  `bun run check` passed.
- Turn 267: Extended suffix-normalized local asset precedence to import
  check/apply: TS import validation now matches suffixed MIC-backed symbols to
  existing SQLite assets before provider search, enriches checked rows with the
  local asset metadata, and imports against the existing asset without creating
  a duplicate. Focused check/apply suffix test, activity domain tests, backend
  type-check, backend test suite, and full `bun run check` passed.
- Turn 268: Added Rust-compatible import asset-id hydration: TS import
  validation now fills missing symbol, symbol name, exchange MIC, instrument
  type, quote mode, quote currency, and currency from an existing asset ID
  before validation. Focused asset-id hydration test, activity domain tests,
  backend type-check, backend test suite, and full `bun run check` passed.
- Turn 269: Added Rust-compatible import activity currency validation: TS import
  checks now reject malformed non-account currency codes with the Rust
  `Invalid currency code: <account> or <activity>` error while preserving valid
  cross-currency cash movements. Focused currency validation test, activity
  domain tests, backend type-check, backend test suite, and full `bun run check`
  passed.
- Turn 270: Added Rust-compatible import subtype normalization: TS import checks
  now canonicalize known subtypes such as `drip` to `DRIP` and clear subtypes
  that duplicate the activity type before disposition/validation. Focused
  subtype normalization test, activity domain tests, backend type-check, backend
  test suite, and full `bun run check` passed.
- Turn 271: Added Rust-compatible empty-symbol validation for import rows that
  require asset resolution: TS import checks now return
  `Symbol is required for <activity> activities.` before falling through to
  generic asset resolution errors, while explicit asset IDs continue to hydrate
  and pass. Focused empty symbol validation test, activity domain tests, backend
  type-check, backend test suite, and full `bun run check` passed.
- Turn 272: Added Rust-compatible import `symbolName` fallback for staged new
  assets: TS import checks now populate missing symbol names with the normalized
  symbol when no existing asset or provider name is available. Focused symbol
  name fallback test, activity domain tests, backend type-check, backend test
  suite, and full `bun run check` passed.
- Turn 273: Added Rust-compatible staged import asset field hydration: TS import
  checks now copy normalized pending-asset symbol, MIC, instrument type, and
  quote currency back into checked rows before returning them to the frontend.
  Focused staged field hydration test, activity domain tests, backend
  type-check, backend test suite, and full `bun run check` passed.
- Turn 274: Added Rust-compatible import apply subtype normalization: TS import
  apply now canonicalizes subtypes and clears subtypes that duplicate the
  activity type before preflight validation and persistence, matching Rust's
  `normalize_for_insert` path. Focused apply subtype test, activity domain
  tests, backend type-check, backend test suite, and full `bun run check`
  passed.
- Turn 275: Added Rust-compatible import apply SPLIT currency fallback: TS
  import apply now replaces missing or malformed split currencies with the
  account currency before preflight validation and persistence, matching Rust's
  `normalize_for_insert` path. Focused split currency fallback test, activity
  domain tests, backend type-check, backend test suite, focused sync-outbox
  rerun, and full `bun run check` passed.
- Turn 276: Added Rust-compatible direct option symbol normalization coverage:
  TS direct activity-created OPTION assets now have parity tests for Fidelity
  compact broker symbols and space-padded OCC symbols normalizing to compact OCC
  identifiers with Rust-shaped option metadata. Focused option normalization
  test, activity domain tests, backend type-check, backend test suite, full
  `bun run check`, and `git diff --check` passed.
- Turn 277: Tightened Rust-compatible direct activity crypto-pair inference: TS
  now only infers CRYPTO from dash-pair symbols when the quote side is in Rust's
  implicit quote-code set, while explicit `kind: CRYPTO` still accepts wider
  broker pair symbols. Focused crypto inference test, activity domain tests,
  backend type-check, backend test suite, full `bun run check`, and
  `git diff --check` passed.
- Turn 278: Tightened Rust-compatible direct activity-created asset kind
  derivation: TS now derives activity-created asset kind from explicit
  instrument type like Rust, so conflicting alternative-kind hints cannot
  override EQUITY, OPTION, BOND, METAL, CRYPTO, or FX instrument
  classifications. Focused asset kind derivation test, activity domain tests,
  backend type-check, backend test suite, full `bun run check`, and
  `git diff --check` passed.
- Turn 279: Tightened Rust-compatible import check errors for unresolved market
  symbols: TS now maps missing-MIC market asset creation failures to Rust's
  `Could not find '<symbol>' in market data` validation message during import
  check while preserving apply-time validation behavior. Focused missing-MIC
  import check test, activity domain tests, backend type-check, backend test
  suite, full `bun run check`, and `git diff --check` passed.
- Turn 280: Tightened Rust-compatible direct activity instrument-type parsing:
  TS now trims explicit activity-created asset `instrumentType` hints before
  alias normalization like Rust, preventing space-padded `FX` inputs from
  falling through to the default EQUITY path. Focused trimmed instrument-type
  test, activity domain tests, backend type-check, backend test suite, full
  `bun run check`, and `git diff --check` passed.
- Turn 281: Tightened Rust-compatible direct activity quote-mode parsing: TS now
  preserves raw activity-created asset `quoteMode` hints for direct quote-mode
  normalization, so space-padded `manual` values fall through like Rust instead
  of creating MANUAL assets and fallback quotes. Focused quote-mode hint test,
  activity domain tests, backend type-check, backend test suite, full
  `bun run check`, and `git diff --check` passed.
- Turn 282: Tightened Rust-compatible import quote-mode parsing: TS import
  preview/check/apply paths now preserve raw `quoteMode` whitespace before
  quote-mode normalization, so space-padded `MANUAL` values no longer skip
  provider resolution or create manual assets/quotes unlike Rust. Focused import
  quote-mode tests, activity domain tests, backend type-check, backend test
  suite, full `bun run check`, and `git diff --check` passed.
- Turn 283: Added explicit import preview quote-mode coverage for the raw
  `quoteMode` parity path: space-padded `MANUAL` preview candidates now produce
  Rust-compatible missing-exchange feedback instead of auto-resolving as manual
  assets. Focused preview test, activity domain tests, backend type-check,
  backend test suite, full `bun run check`, and `git diff --check` passed.
- Turn 284: Tightened import preview lowercase quote-mode parity: lowercase
  `manual` preview hints now skip the missing-exchange error like Rust's
  case-insensitive manual check while still producing a MARKET draft like Rust's
  exact `MANUAL` draft conversion. Focused preview test, activity domain tests,
  backend type-check, backend test suite (rerun after known sync-outbox flake),
  full `bun run check`, and `git diff --check` passed.
- Turn 285: Tightened import preview quote-currency parity for Rust's activity
  `GBp` normalization quirk: explicit `GBp` import preview hints now normalize
  to `GBP` in activity import drafts while preserving the broader asset/FX minor
  currency handling elsewhere. Focused preview test, activity domain tests,
  backend type-check, backend test suite (rerun after known sync-outbox flake),
  full `bun run check`, and `git diff --check` passed.
- Turn 286: Tightened Health Center stale-dismissal observability parity: when a
  stale dismissal should be restored but repository removal fails, TS now logs a
  warning through the health service warning hook and still restores the issue
  like Rust's best-effort cleanup path. Focused stale-dismissal tests, health
  domain tests, backend type-check, backend test suite, full `bun run check`,
  and `git diff --check` passed.
- Turn 287: Tightened transaction snapshot replay parity for option sells with
  missing positions: TS now reads the sold asset's option contract multiplier
  for cash proceeds before warning and leaving the missing position absent,
  matching Rust's asset-cache cash-effect-first path. Focused portfolio job
  test, portfolio job tests, backend type-check, backend test suite, full
  `bun run check`, and `git diff --check` passed.
- Turn 288: Tightened FX inverse-rate safety parity: Rust now treats zero-valued
  inverse latest exchange rates as unavailable instead of dividing by zero,
  matching the TS exchange-rate service behavior. Focused TS/Rust FX tests, full
  TS exchange-rate tests, backend type-check, backend test suite, targeted Rust
  FX tests, `cargo check -p wealthfolio-core`, full `bun run check`, and
  `git diff --check` passed.
- Turn 289: Tightened direct activity bare-crypto lookup parity: symbol-only
  activities for common crypto tickers now carry the inferred CRYPTO instrument
  type into existing-asset lookup, so `BTC` resolves to an existing crypto asset
  instead of an equity/new-asset path like Rust. Focused activity tests,
  activity domain tests, backend type-check, backend test suite (rerun after
  known sync-outbox flake), full `bun run check`, and `git diff --check` passed.
- Turn 290: Tightened quote-sync health snapshot parity: TS quote sync error
  snapshots now report whether each asset has ever synced quotes, matching
  Rust's `has_synced_before` model, and health analysis preserves that field
  while retaining Rust's error-count severity thresholds for never-synced
  assets. Also made the sync-outbox metadata test deterministic by reading the
  update row by event ID instead of timestamp/UUID ordering. Focused quote-sync
  tests, market-data and health domain tests, sync-outbox tests, backend
  type-check, backend test suite, full `bun run check`, and `git diff --check`
  passed.
- Turn 291: Tightened transaction snapshot replay date parity: TS portfolio jobs
  now derive activity-local dates from the configured user timezone like Rust's
  `activity_date_in_tz`, pass that timezone through activity filtering, split
  preprocessing, grouping, same-day transfer ordering, and FX conversion dates,
  and the standalone runtime wires the portfolio job timezone from settings.
  Focused timezone/invalid-date tests, full portfolio job tests, backend
  type-check, backend test suite, full `bun run check`, and `git diff --check`
  passed.
- Turn 292: Tightened custom-provider default-price fallback parity: TS custom
  provider source tests and row fetches now return Rust-compatible static prices
  when the configured source URL is empty or the HTTP/body fetch fails, while
  successful responses with bad extraction still surface selector/path errors.
  Focused custom-provider tests, full custom-provider tests, custom-provider
  market-data tests, backend type-check, backend test suite, full
  `bun run check`, and `git diff --check` passed.
- Turn 293: Tightened custom-provider date parsing parity: TS market-data quote
  timestamping now accepts only full Rust-supported ISO dates, RFC3339
  datetimes, and known naive datetime formats instead of arbitrary `YYYY-MM-DD`
  prefixes, while preserving RFC3339 offset-local date behavior before applying
  `dateTimezone`. Focused custom-provider market-data tests, full market-data
  tests, backend type-check, backend test suite, full `bun run check`, and
  `git diff --check` passed.
- Turn 294: Tightened transaction snapshot position inception parity: TS
  activity-derived positions now recompute `inceptionDate` from remaining lots
  on every aggregate recalculation like Rust, so FIFO sells that remove the
  oldest lot advance inception to the next lot while `createdAt` remains the
  position creation date. Focused portfolio replay tests, full portfolio job
  tests, backend type-check, backend test suite, full `bun run check`, and
  `git diff --check` passed.
- Turn 295: Tightened Health Center account-configuration parity by aligning
  Rust's unconfigured-account aggregation with the TS runtime: archived accounts
  no longer produce setup-needed health issues, while other active-account
  health analysis remains unchanged. Focused Rust/TS health tests, full Rust
  core tests, Rust core check, full `bun run check`, and `git diff --check`
  passed.
- Turn 296: Tightened custom-provider UTF-8 response parity: TS source fetching
  now rejects invalid UTF-8 bodies like Rust instead of silently replacing
  bytes, and still uses `defaultPrice` fallback for invalid-body fetch failures.
  Focused and full custom-provider tests, backend type-check, backend test
  suite, full `bun run check`, and `git diff --check` passed.
- Turn 297: Tightened custom-provider transient fetch parity: TS source fetching
  now retries one network or HTTP 5xx failure before returning an error or
  applying `defaultPrice`, matching Rust's one-retry scraper fetch behavior
  while leaving 4xx and redirect handling unchanged. Focused and full
  custom-provider tests, backend type-check, backend test suite, full
  `bun run check`, and `git diff --check` passed.
- Turn 298: Tightened custom-provider HTML table header parity by aligning the
  Rust runtime table extractor with the TS backend's first-`td` header-row skip,
  including numeric-looking header rows. Focused Rust custom scraper tests
  passed; full Rust core tests, Rust core check, full `bun run check`, and
  `git diff --check` passed.
- Turn 299: Tightened custom-provider HTML locale fallback parity: TS runtime
  source row fetching now uses `<html lang>` as the locale fallback for HTML and
  HTML-table sources when no explicit locale is configured, matching Rust custom
  scraper runtime behavior while leaving test-source preview semantics
  unchanged. The account-FX runtime test now also stubs market-data fetches so
  cleanup-time enrichment cannot depend on external network availability.
  Focused custom-provider tests, backend type-check, backend test suite, full
  `bun run check`, and `git diff --check` passed.
- Turn 300: Tightened custom-provider date-template parity: TS `{DATE:...}`
  expansion now supports additional Rust/chrono-compatible directives for
  day-of-year, weekday names/numbers, century, compact date/time aliases, and
  `%h` month aliases so custom provider URLs no longer leak those tokens. The
  holdings snapshot sync-outbox runtime test now also stubs market-data fetches
  so cleanup-time enrichment cannot depend on external network availability.
  Focused custom-provider tests, backend type-check, backend test suite, full
  `bun run check`, and `git diff --check` passed.
- Turn 301: Tightened custom-provider source validation message parity: TS
  create/update validation now reports valid source kinds and formats in the
  same error text style as Rust, so invalid custom provider definitions surface
  actionable allowed-value lists. Focused custom-provider tests, backend
  type-check, backend test suite, full `bun run check`, and `git diff --check`
  passed.
- Turn 302: Tightened custom-provider stored config parsing parity: TS now
  treats any malformed source entry in a persisted provider config as a parse
  failure for the whole config, matching Rust serde behavior instead of silently
  dropping only the malformed source. Focused custom-provider tests, backend
  type-check, backend test suite, full `bun run check`, and `git diff --check`
  passed.
- Turn 303: Tightened custom-provider stored config warning parity: TS now emits
  a parse warning when persisted provider config has an invalid top-level
  `sources` shape, matching Rust's serde fallback observability instead of
  silently returning no sources. Focused custom-provider tests, backend
  type-check, backend test suite, full `bun run check`, and `git diff --check`
  passed.
- Turn 304: Tightened synced provider quote validation parity: TS market-data
  sync now applies Rust-compatible hard quote validation before persisting
  provider/custom-provider quotes, rejects invalid latest quotes, filters
  invalid historical rows, fails all-invalid historical batches, and skips
  negative-volume validation for FX instruments. Focused custom-provider
  latest/history validation tests, full market-data tests, runtime tests,
  backend test suite, full `bun run check`, and `git diff --check` passed.
- Turn 305: Tightened provider quote-resolution validation parity:
  `resolveSymbolQuote` now applies the same Rust-compatible hard quote
  validation to latest Yahoo, custom-provider, Börse Frankfurt, MarketData.app,
  Finnhub, Alpha Vantage, Metal Price API, and US Treasury quote summaries
  before returning a price. Focused invalid Yahoo/custom-provider resolve tests,
  full market-data tests, runtime tests, backend test suite, full
  `bun run check`, and `git diff --check` passed.
- Turn 306: Tightened exchange-rate converter refresh parity: manual TS
  exchange-rate add/update now refreshes the in-memory converter immediately
  like delete already did, so post-mutation conversions use the newly persisted
  FX quote instead of stale initialized graph data. Focused exchange-rate
  mutation tests, full exchange-rate tests, runtime tests, backend test suite,
  full `bun run check`, and `git diff --check` passed.
- Turn 307: Aligned Rust FX converter refresh behavior with the TS fix: Rust
  exchange-rate add/update now reinitializes the in-memory converter after
  saving a rate, so both runtimes use newly persisted FX quotes for immediate
  post-mutation conversions. Focused Rust FX service tests, Rust core check,
  focused TS exchange-rate test, and backend type-check passed.
- Turn 308: Tightened custom-provider historical latest fallback parity: TS
  custom-provider latest quote resolution and latest sync now fetch historical
  source rows through the runtime row extraction path and select the latest
  dated row, matching Rust's historical fallback instead of treating a
  historical source as a single test-source preview. Focused market-data tests,
  full market-data tests, runtime tests, backend type-check, backend test suite,
  and full `bun run check` passed.
- Turn 309: Added explicit OpenFIGI bond profile enrichment parity: TS asset
  enrichment now honors `preferred_provider: "OPENFIGI"` for BOND assets by
  calling OpenFIGI mapping with `ID_ISIN`, applying Rust-compatible
  `name - ticker` formatting, and preserving metadata when the provider only
  supplies a name. Focused/full assets tests, backend type-check, backend test
  suite, full `bun run check`, and `git diff --check` passed.
- Turn 310: Extended OpenFIGI bond profile enrichment to the default BOND
  profile path: TS now uses OpenFIGI for market-priced BOND assets without an
  explicit provider, matching Rust's provider ordering before Treasury metadata
  enrichment. Focused/full assets tests, backend type-check, backend test suite,
  full `bun run check`, and `git diff --check` passed.
- Turn 311: Added explicit Boerse Frankfurt profile enrichment parity for
  provider-preferred equity/bond assets: TS now resolves MIC/ticker values
  through TradingView search, fetches symbol profiles with the Rust user agent,
  applies provider descriptions as asset names, and preserves metadata for
  name-only profiles. Focused/full assets tests, backend type-check, backend
  test suite, full `bun run check`, and `git diff --check` passed.
- Turn 312: Strengthened Boerse Frankfurt bond profile parity evidence: TS tests
  now cover metadata-ISIN BOND enrichment using the TradingView symbols endpoint
  without search fallback, preserving existing identifiers while updating the
  profile name. Focused/full assets tests, backend type-check, backend test
  suite, full `bun run check`, and `git diff --check` passed.
- Turn 313: Tightened OpenFIGI profile override parity: TS BOND profile
  enrichment now resolves provider-specific OpenFIGI symbols before metadata
  identifiers and instrument symbols, matching Rust's provider override
  resolver. Focused/full assets tests, backend type-check, backend test suite,
  full `bun run check`, and `git diff --check` passed.
- Turn 314: Added explicit Finnhub equity profile enrichment parity: TS asset
  enrichment now reads the Finnhub API key from the runtime secret service,
  honors provider override symbols, fetches `/stock/profile2`, maps Rust-shaped
  profile metadata including market cap scaling, and skips no-key/empty-profile
  paths without marking assets enriched. Focused/full assets tests, backend
  type-check, backend test suite, full `bun run check`, and `git diff --check`
  passed.
- Turn 315: Added explicit Alpha Vantage equity/ETF profile enrichment parity:
  TS asset enrichment now reads the Alpha Vantage API key from the runtime
  secret service, honors provider override symbols and exchange suffix metadata,
  fetches `OVERVIEW` plus ETF sector profiles, maps Rust-shaped profile metadata
  and metrics, and skips no-key paths without marking assets enriched.
  Focused/full assets tests, backend type-check, backend test suite, full
  `bun run check`, and `git diff --check` passed.
- Turn 316: Tightened Health Center data-consistency parity: TS health checks
  now detect orphan activity account references, orphan activity asset
  references, and negative latest holdings positions from SQLite with
  Rust-shaped issue IDs/messages/navigation while preserving existing negative
  balance checks. Focused health tests, backend type-check, backend test suite,
  code review, full `bun run check`, and `git diff --check` passed.
- Turn 317: Tightened contribution-limit portfolio side-effect parity:
  standalone TS runtime contribution-limit create/update/delete now triggers the
  same lightweight no-market-sync portfolio update config as Rust, reusing
  shared fire-and-forget portfolio enqueue helpers. Focused
  contribution-limit/runtime tests, backend type-check, backend test suite, code
  review, full `bun run check`, and `git diff --check` passed.
- Turn 318: Strengthened asset-update portfolio side-effect parity evidence:
  standalone TS runtime asset profile and quote-mode mutations now have focused
  end-to-end coverage showing Rust-shaped `assets_updated` events flow through
  the domain-event worker into market-sync and portfolio-update events. Focused
  runtime tests, backend type-check, backend test suite, full `bun run check`,
  and `git diff --check` passed.
- Turn 319: Tightened direct activity bare-symbol asset lookup parity: TS direct
  activity writes now only match bare market symbols to no-MIC existing assets,
  while preserving Rust's globally unique OPTION/no-MIC behavior, so a bare
  symbol can no longer silently bind to a MIC-qualified equity. Focused
  activities tests, full activities tests, backend type-check, backend test
  suite, focused code review, full `bun run check`, and `git diff --check`
  passed.
- Turn 320: Tightened direct activity Yahoo futures suffix parity: TS
  activity-created asset normalization now strips Yahoo `=F` suffixes like Rust
  before local existing-asset matching, preventing duplicate futures-style
  assets such as `GC=F` when a canonical `GC` asset already exists. Focused
  futures-suffix test, full activities tests, backend type-check, backend test
  suite, full `bun run check`, and `git diff --check` passed.
- Turn 321: Aligned Rust add-on ZIP hardening with TS runtime limits: Rust
  extraction now rejects archives with more than 10,000 entries or more than
  50MB of uncompressed file content before reading entries, matching the TS
  add-on runtime bounds. Focused add-on rejection tests, full add-on Rust tests,
  `cargo check -p wealthfolio-core`, focused code review, full `bun run check`,
  and `git diff --check` passed.
- Turn 322: Removed the stale TS database-restore deferred HTTP guard:
  `AppUtilityService.restoreDatabase` is now required like the Rust route's
  restore implementation, and `/api/v1/utilities/database/restore` dispatches
  directly to the runtime restore service instead of exposing a synthetic 501
  branch. Focused app utility/HTTP tests, backend type-check, backend test
  suite, full `bun run check`, and `git diff --check` passed.
- Turn 323: Removed stale TS portfolio-metrics deferred method guards:
  performance and income methods are now required on `PortfolioMetricsService`
  like Rust's wired performance service routes, and HTTP routes dispatch
  directly instead of exposing synthetic 501 branches for methods the runtime
  always implements. Focused portfolio-metrics HTTP test, backend type-check,
  backend test suite, full `bun run check`, and `git diff --check` passed.
- Turn 324: Removed stale TS health runtime optional route guards: health
  status, health check, and health fix methods are now required on
  `HealthService` like Rust's wired health routes, and HTTP dispatch calls them
  directly instead of keeping synthetic 404 fallbacks for methods the runtime
  always implements. Focused health HTTP/domain tests, backend type-check,
  backend test suite, full `bun run check`, and `git diff --check` passed.
- Turn 325: Removed stale TS taxonomy migration optional route guards:
  classification migration status/details/run methods are now required on
  `TaxonomyService` like Rust's wired taxonomy migration routes, and HTTP
  migration endpoints dispatch directly instead of keeping synthetic 404
  fallbacks for methods the runtime always implements. Focused taxonomy HTTP and
  domain tests, backend type-check, backend test suite, full `bun run check`,
  and `git diff --check` passed.
- Turn 326: Strengthened Health Center timezone parity evidence: TS health tests
  now cover Rust's Australian offset-equivalence cases, proving
  Australia/Melbourne and Australia/Sydney do not emit a timezone warning while
  Australia/Melbourne and Australia/Perth still emit the warning. Focused health
  timezone test, full health tests, backend type-check, backend test suite, full
  `bun run check`, and `git diff --check` passed.
- Turn 327: Removed stale TS activity runtime optional route guards: activity
  search/write/import/template/duplicate methods are now required on
  `ActivityService` like Rust's wired activity routes, and HTTP dispatch calls
  them directly instead of keeping synthetic 404 fallbacks for methods the
  runtime always implements. Focused activity HTTP/domain tests, backend
  type-check, backend test suite, full `bun run check`, and `git diff --check`
  passed.
- Turn 328: Aligned TS update-check instance headers with Rust: TS app utility
  update checks now always include `X-Instance-Id`, using an empty string when
  no instance ID is available, matching Rust's always-sent header behavior.
  Focused app utility tests, backend type-check, backend test suite, full
  `bun run check`, and `git diff --check` passed.
- Turn 329: Removed stale TS market-data runtime optional route guards:
  exchange/search/resolve/quote/import/sync route methods are now required on
  `MarketDataService` like Rust's wired market-data routes, and HTTP dispatch
  calls them directly instead of keeping synthetic 404 fallbacks for methods the
  runtime always implements. Focused market-data HTTP/domain tests, backend
  type-check, backend test suite, full `bun run check`, and `git diff --check`
  passed.
- Turn 330: Strengthened portfolio job TOTAL holdings weight parity evidence:
  bounded TS portfolio valuation jobs now assert that the generated TOTAL
  snapshot produces live holdings whose weights sum to 1.0 and split correctly
  between security and cash holdings. Focused portfolio job test, full portfolio
  job tests, backend type-check, backend test suite, full `bun run check`, and
  `git diff --check` passed.
- Turn 331: Rebasing onto latest `origin/main` completed. Conflict resolution
  preserved the Electron/Bun/TS migration direction, respected upstream deletion
  of local sample add-ons and pnpm workspace files, removed legacy Tauri runtime
  paths during the Tauri-removal commit, regenerated `Cargo.lock`, restored the
  Electron adapter export surface after the rebase, and replaced type-bridge
  tests' deleted sample-addon manifest imports with inline permission fixtures.
  Full `bun run check` and `git diff --check` passed.
- Turn 332: Removed a post-rebase Tauri packaging residue: Electron builder now
  reads app icons from `assets/brand` instead of the deleted `apps/tauri/icons`
  tree. Icon path existence checks, Electron type-check, full `bun run check`,
  and `git diff --check` passed.
- Turn 333: Removed a post-rebase Tauri naming residue from local CI tooling:
  `scripts/ci-check.sh` now prepares a generic frontend `dist/index.html`
  placeholder instead of an `ensure_tauri_dist` helper. `bash -n`, full
  `bun run check`, and `git diff --check` passed.
- Turn 334: Removed user-visible Tauri wording from web adapter fallbacks:
  unsupported local backup and pending export paths now refer to desktop/native
  app support instead of the removed Tauri app. Frontend type-check, full
  `bun run check`, and `git diff --check` passed.
- Turn 335: Cut the Docker image from the Rust Axum server to the Bun TypeScript
  backend. The TS backend now supports `WF_STATIC_DIR` and serves the built
  frontend with SPA fallback outside `/api/*`, while the Dockerfile builds
  frontend assets and runs `bun apps/backend/src/main.ts` with only the runtime
  catalog/migration assets it needs. Focused static-server tests, backend
  type-check, full `bun run check`, and `git diff --check` passed.
- Turn 336: Cut local web development from the Rust Axum server to the Bun
  TypeScript backend. `scripts/dev-web.mjs` now starts
  `bun run --cwd apps/backend start`, sets safe local development defaults for
  listener, secret key, auth, and Vite proxy target, and `.env.web.example` now
  documents the Bun TypeScript backend instead of Axum.
  `node --check scripts/dev-web.mjs`, full `bun run check`, and
  `git diff --check` passed.
- Turn 337: Changed the Electron backend runtime default for non-packaged
  development to the Bun TypeScript backend. Packaged builds still fall back to
  the Rust sidecar until the TS backend is bundled, but dev Electron no longer
  defaults to `cargo run`/Rust. Focused Electron backend-runtime tests, Electron
  type-check, full `bun run check`, and `git diff --check` passed.
- Turn 338: Removed a Rust-era `DATABASE_URL` fallback from the local web dev
  log naming path. `scripts/dev-web.mjs --file-log` now derives log names only
  from `WF_DB_PATH` or the generic `app.db` fallback, matching the Bun
  TypeScript backend configuration. `node --check scripts/dev-web.mjs`, full
  `bun run check`, and `git diff --check` passed.
- Turn 339: Updated README web and Docker instructions away from the Rust Axum
  server. Web mode now documents the Bun TypeScript backend, server-only
  commands use `bun run --cwd apps/backend start`, and Docker build/runtime
  notes describe Bun backend assets instead of a `wealthfolio-server` binary.
  README grep checks, full `bun run check`, and `git diff --check` passed.
- Turn 340: Updated E2E scripts and documentation away from Rust/Axum web
  backend assumptions. `scripts/run-e2e.mjs` no longer injects `RUST_LOG`,
  `wait-for-both-servers-to-be-ready.sh` waits for the Bun backend listening
  message, and `e2e/README.md` no longer requires Rust for E2E setup.
  `node --check`, `bash -n`, full `bun run check`, and `git diff --check`
  passed.
- Turn 341: Re-synced the TS SQLite migration source-of-truth test after new
  Rust SQL migrations landed. The TS backend migration guard now expects 32
  migrations and the latest `2026-05-19-000001_lots_and_snapshot_positions`
  version. Focused SQLite tests, backend test suite, full `bun run check`, and
  `git diff --check` passed.
- Turn 342: Removed stale Connect broker-sync profile guards around required
  `ActivityService` methods. Local Connect profile reads/writes now delegate
  directly to the activity service instead of carrying an unreachable TS runtime
  501 fallback. Focused runtime/http Connect tests, backend test suite, full
  `bun run check`, and `git diff --check` passed.
- Turn 343: Wired TS backend and Electron test suites into repository CI/local
  full checks. Root scripts now expose `test:backend`, `test:electron`, and
  `test:all`; PR checks run backend and Electron tests after frontend tests; and
  `scripts/ci-check.sh --full` runs both suites. `bun run test:backend`,
  `bun run test:electron`, full `bun run check`, and `git diff --check` passed.
- Turn 344: Removed Rust-era desktop `DATABASE_URL` setup instructions from
  README and `.env.example`. Desktop now documents automatic Electron database
  path management and points web mode database configuration to `WF_DB_PATH` in
  `.env.web`. Full `bun run check` and `git diff --check` passed.
- Turn 345: Updated README backend technology and folder-structure summaries to
  identify the Bun TypeScript backend as the local web/Docker runtime and Rust
  Axum as the temporary sidecar/prebuild fallback. Full `bun run check` and
  `git diff --check` passed.
- Turn 346: Removed the stale Tauri VS Code extension recommendation from
  `.vscode/extensions.json`, so contributors are no longer prompted to install
  Tauri tooling after the runtime removal. JSON validation, full
  `bun run check`, and `git diff --check` passed.
- Turn 347: Cut packaged Electron from the Rust sidecar binary to a Bun-compiled
  TypeScript backend executable. `scripts/build-electron-sidecar.mjs` now
  compiles `apps/backend/src/main.ts`, stages SQLite migrations plus exchange
  and AI provider catalogs beside the binary, and smoke-tests the compiled
  backend through `/api/v1/readyz`; Electron `afterPack` copies the TS backend
  resources, packaged runtime defaults to TS, and release Electron sidecar
  targets use Bun compile targets without Rust setup/cache. Verified with
  `bun run build:electron:sidecar`, `bun run test:backend`,
  `bun run test:electron`, full `bun run check`, and `git diff --check`.
- Turn 348: Cut the standalone Linux prebuild release path from the Rust
  `wealthfolio-server` binary to a Bun-compiled TypeScript backend prebuild.
  Release now builds `wealthfolio-backend` with `bun build --compile`, stages
  migrations and runtime catalogs as `backend-assets`, smoke-tests the compiled
  backend with the same env paths used by systemd, uploads
  `wealthfolio-backend-*-linux-amd64` artifacts, and no longer runs the Rust
  server release-build checks in PR/local full checks. Verified with
  `bun build apps/backend/src/main.ts --compile --target=bun-linux-x64-baseline`,
  `bash -n scripts/ci-check.sh`, full `bun run check`, and `git diff --check`.
- Turn 349: Removed Electron's explicit Rust sidecar runtime fallback. Electron
  backend runtime selection now accepts only the TypeScript/Bun backend and
  rejects `WF_BACKEND_RUNTIME=rust`; the sidecar lifecycle helper no longer
  constructs `cargo run apps/server` or `wealthfolio-server` packaged commands.
  Verified with `bun run test:electron`, `bun run build:electron:sidecar`, full
  `bun run check`, and `git diff --check`.
- Turn 350: Refreshed architecture docs that still described Axum/Rust sidecar
  runtime paths. Adapter, Electron desktop, and AI assistant architecture docs
  now describe Electron/Web traffic going through the Bun/TypeScript backend, TS
  backend packaging assets, and TypeScript keyring sidecar behavior. Verified
  with targeted `rg` checks, full `bun run check`, and `git diff --check`.
- Turn 351: Removed the stale deferred portfolio job service/export/test now
  that the standalone TS runtime executes bounded portfolio valuation and
  activity replay jobs. Verified no `createDeferredPortfolioJobService` or
  `PortfolioJobNotImplementedError` references remain, plus
  `bun test apps/backend/src/domains/portfolio-jobs.test.ts`,
  `bun run --cwd apps/backend type-check`, full `bun run check`, and
  `git diff --check`.
- Turn 352: Removed stale exported `NotImplementedError` classes for holdings,
  portfolio metrics, and market data now that those domains have TS runtime
  implementations. Verified no stale class references remain, plus affected
  domain tests, `bun run --cwd apps/backend type-check`, full `bun run check`,
  and `git diff --check`.
- Turn 353: Fixed review-found packaged Bun backend regressions: staged the
  platform keyring native binding for Electron sidecars, loaded
  `NAPI_RS_NATIVE_LIBRARY_PATH` directly before the bundled keyring loader,
  embedded/injected app versions for compiled Electron/prebuild backends,
  extended sidecar smoke coverage to `/api/v1/app/info` and
  `/api/v1/ai/providers`, pinned release sidecar jobs to matching-arch runners,
  and fixed release upload/tag handling for workflow-dispatch paths. Verified
  with `bun run build:electron:sidecar`, `bun run test:backend`,
  `bun run test:electron`, targeted runtime/sidecar/secrets tests, full
  `bun run check`, and `git diff --check`.
- Turn 354: Removed stale goal valuation route messaging that reported
  valuation-backed goal/retirement routes as unavailable in the TS backend.
  Missing valuation providers now surface as explicit route configuration errors
  while the standalone runtime continues to provide the required provider.
  Verified with the focused HTTP goal valuation test, backend type-check, full
  `bun run check`, and `git diff --check`.
- Turn 355: Removed stale AI chat streaming messaging that reported chat as
  unavailable in the TS backend when the AI provider service was missing.
  Missing provider service now surfaces as a configuration error, while
  unsupported attachment/provider combinations continue to return explicit 501s.
  Verified with focused AI chat tests, backend type-check, full `bun run check`,
  and `git diff --check`.
- Turn 356: Refreshed README setup and backend/keyring wording after packaged
  Electron and prebuild cutover. Rust is now documented as legacy compatibility
  tooling, desktop keyring storage points to the TypeScript backend native
  binding, and stale `keyring-backend`/Rust keyring phrasing was removed.
  Verified with targeted `rg`, full `bun run check`, and `git diff --check`.
- Turn 357: Ported local Connect refresh-session persistence into the standalone
  TS runtime. `createLocalConnectService` now stores, clears, and reports the
  cloud refresh-token session through the shared `SecretService`, including
  best-effort cleanup of legacy access tokens, while token restore/cloud sync
  remains feature-gated. Verified with domain and runtime HTTP session tests,
  backend type-check, full `bun run check`, and `git diff --check`.
- Turn 358: Ported bounded Connect token restore lifecycle into the standalone
  TS runtime. Stored refresh tokens can now mint access tokens through the
  Connect auth endpoint, rotate refresh tokens, clean legacy access tokens, and
  clear invalid sessions on unauthorized refresh responses. Verified with
  Connect domain tests, runtime HTTP session restore coverage, backend
  type-check, full `bun run check`, and `git diff --check`.
- Turn 359: Fixed Connect token-restore review findings. Concurrent restore
  calls now share one in-flight refresh, invalid OAuth error codes such as
  `invalid_grant` clear the session even with generic descriptions, and disabled
  cloud-route coverage no longer treats migrated session routes as 501-only.
  Verified with Connect domain/runtime regression tests, backend type-check,
  full `bun run check`, and `git diff --check`.
- Turn 360: Ported the public Connect subscription plans route into the
  standalone TS runtime. `getSubscriptionPlansPublic` now fetches
  `/api/v1/subscription/plans` from `CONNECT_API_URL` with Rust-compatible
  default base URL behavior, while authenticated plans and broker/device sync
  remain feature-gated. Verified with Connect domain/runtime tests, backend
  type-check, full `bun run check`, and `git diff --check`.
- Turn 361: Ported authenticated Connect user/plans reads into the standalone TS
  runtime. `getSubscriptionPlans` and `getUserInfo` now restore an access token,
  call the Connect API with bearer auth, and map user/team fields to
  Rust-compatible response shapes. Authenticated reads share the same in-flight
  restore as `/connect/session/restore`, and pending restores cannot resurrect a
  cleared/replaced session. Verified with Connect domain/runtime tests, backend
  type-check, full `bun run check`, and `git diff --check`.
- Turn 362: Ported Connect broker connection/account cloud read routes into the
  standalone TS runtime. `/connect/connections` and `/connect/accounts` now use
  restored access tokens, fetch the Rust-compatible Connect API endpoints, and
  map broker connection fallback brokerage fields. Verified with Connect
  domain/runtime tests, backend type-check, full `bun run check`, and
  `git diff --check`.
- Turn 363: Ported the bounded Connect broker-connection sync path into the
  standalone TS runtime. `/connect/sync/connections` now fetches cloud
  connections with a restored access token and upserts brokerage platforms using
  the Rust-compatible slug/id, display-name, URL, external-id, and logo mapping.
  Verified with Connect domain/runtime tests, backend type-check, full
  `bun run check`, and `git diff --check`.
- Turn 364: Ported the bounded Connect broker-account sync path into the
  standalone TS runtime. `/connect/sync/accounts` now fetches broker accounts,
  skips missing/existing provider IDs, creates new SNAPTRADE HOLDINGS accounts
  through the account service, matches platforms by external ID/name, preserves
  broker metadata JSON, and returns Rust-compatible created/skipped/new-account
  payloads. Verified with Connect domain/runtime tests, backend type-check, full
  `bun run check`, and `git diff --check`.
- Turn 365: Ported the local device-sync engine status read into the standalone
  TS runtime. `/connect/device/engine-status` now reads `sync_cursor`,
  `sync_engine_state`, and `sync_device_config` from SQLite, maps
  Rust-compatible status fields, reports `backgroundRunning: false`, and derives
  bootstrap-required state from missing bootstrap data or stale cursors while
  other device-sync operations remain feature-gated. Verified with Connect
  domain/runtime tests, backend type-check, full `bun run check`, and
  `git diff --check`.
- Turn 366: Ported the local device-sync bootstrap overwrite check into the
  standalone TS runtime. `/connect/device/bootstrap-overwrite-check` now reads
  the same overwrite-risk table set from SQLite, applies Rust-compatible filters
  and row sorting, and returns bootstrap/local-data summaries while device-sync
  mutation routes remain feature-gated. Verified with Connect domain/runtime
  tests, backend type-check, full `bun run check`, and `git diff --check`.
- Turn 367: Ported the safe no-op branch of Connect activities-only sync into
  the standalone TS runtime. `/connect/sync/activities` now returns a
  Rust-compatible empty sync summary when all synced broker accounts are
  HOLDINGS-mode and keeps TRANSACTIONS-mode activity mapping feature-gated until
  the full broker activity mapper lands. Verified with Connect domain/runtime
  tests, backend type-check, full `bun run check`, and `git diff --check`.
- Turn 368: Ported local device-sync background-engine start/stop responses into
  the standalone TS runtime. Start returns Rust-compatible `skipped` when no
  sync identity is configured, stop returns `stopped`, and cloud/push/pull
  mutations remain feature-gated. Verified with Connect domain/runtime tests,
  backend type-check, full `bun run check`, and `git diff --check`.
- Turn 369: Ported the bounded all-holdings Connect full-sync path into the
  standalone TS runtime. `/connect/sync` now runs the migrated connections sync,
  accounts sync, and HOLDINGS-mode activities no-op path, returning accepted
  while TRANSACTIONS-mode broker activity mapping remains feature-gated.
  Verified with Connect domain/runtime tests, backend type-check, full
  `bun run check`, and `git diff --check`.
- Turn 370: Ported the empty TRANSACTIONS-mode Connect activities sync path into
  the standalone TS runtime. `/connect/sync/activities` now marks synced
  TRANSACTIONS accounts as attempted, fetches broker activity pages, finalizes
  success when no activities are returned, and keeps non-empty broker activity
  mapping feature-gated until the mapper lands. Verified with Connect
  domain/runtime tests, backend type-check, full `bun run check`, and
  `git diff --check`.
- Turn 371: Added Rust-compatible per-account failure handling for Connect
  activities-only sync. Broker activity page fetch failures now mark that
  account's sync state as FAILED, increment `accountsFailed`, and return the
  summary instead of aborting the whole route; non-empty pages remain gated
  until the full mapper lands. Verified with focused Connect tests, backend
  type-check, full `bun run check`, and `git diff --check`.
- Turn 372: Ported local device-sync pairing-source precondition errors into the
  standalone TS runtime. `/connect/device/pairing-source-status` now reports the
  Rust-compatible no-identity and not-ready errors before cloud cursor checks,
  while trusted-device cloud cursor comparison remains feature-gated. Verified
  with Connect domain/runtime tests, backend type-check, full `bun run check`,
  and `git diff --check`.
- Turn 373: Ported the local device-sync snapshot-upload cancellation response
  into the standalone TS runtime. `/connect/device/cancel-snapshot` now returns
  Rust-compatible `cancel_requested`/message without cloud side effects, while
  snapshot generation/upload remains feature-gated. Verified with Connect
  domain/runtime tests, backend type-check, full `bun run check`, and
  `git diff --check`.
- Turn 374: Ported local device-sync snapshot bootstrap/generation precondition
  errors into the standalone TS runtime. `/connect/device/bootstrap-snapshot`
  and `/connect/device/generate-snapshot` now report Rust-compatible
  no-identity/no device-id errors before cloud upload paths, while
  trusted-device snapshot export/upload remains feature-gated. Verified with
  Connect domain/runtime tests, backend type-check, full `bun run check`, and
  `git diff --check`.
- Turn 375: Ported the local no-identity device-sync trigger-cycle path into the
  standalone TS runtime. `/connect/device/trigger-cycle` now records a
  Rust-compatible `config_error` engine outcome and returns the cycle summary
  with cursor/lock version and zero pushed/pulled counts before cloud push/pull
  paths. Verified with Connect domain/runtime tests, backend type-check, full
  `bun run check`, and `git diff --check`.
- Turn 376: Ported local device-sync clear-data side effects into the standalone
  TS runtime. `DELETE /connect/device/sync-data` now preserves the stored device
  nonce while clearing device identity/key material, deletes the legacy
  device-id secret, clears sync control-plane tables, resets cursor/engine
  state, preserves app data, and returns a JSON `null` success response; related
  local device-sync throws now reject asynchronously so HTTP routes return JSON
  domain errors. Verified with focused Connect device-sync tests, backend
  type-check, full `bun run check`, and `git diff --check`.
- Turn 377: Ported Connect session-clear freshness-gate side effects into the
  standalone TS runtime. `DELETE /connect/session` now clears
  `sync_device_config.min_snapshot_created_at` for all local device configs
  after removing refresh/access tokens, matching Rust logout/reset behavior
  without deleting device config rows. Verified with focused Connect session
  tests, backend type-check, backend test suite, full `bun run check`, and
  `git diff --check`.
- Turn 378: Ported the first non-empty broker activity page edge case into the
  standalone TS runtime. Transaction-mode Connect activity sync now skips
  non-empty activity pages when every returned activity lacks a non-blank broker
  `id`, matching Rust `map_broker_activity` returning no `NewActivity` rows,
  finalizes the account sync as successful with zero upserts, and keeps pages
  containing mappable activity IDs feature-gated until the full mapper lands.
  Verified with focused Connect broker activity tests, backend type-check,
  backend test suite, full `bun run check`, and `git diff --check`.
- Turn 379: Ported Connect broker activity pagination for the migrated
  empty/skip-only sync paths. Transaction-mode activity sync now follows
  Rust-compatible `has_more`/`total`/`limit` pagination, advances offsets by the
  received row count, continues across non-empty unmappable pages, records
  per-account fetch failures on any page, and still feature-gates the first page
  containing a mappable activity ID. Verified with focused Connect broker
  activity tests, backend type-check, backend test suite, full `bun run check`,
  and `git diff --check`.
- Turn 380: Cleaned stale frontend runtime comments that still referred to a
  Rust backend for device-sync state/enrollment, sync crypto, add-on manifest
  permissions, and AI activity payload compatibility. Comments now use neutral
  backend wording while preserving intentional Tauri-compatible event/API names.
  Verified with `rg` for remaining frontend Rust-backend wording, frontend
  type-check, full `bun run check`, and `git diff --check`.
- Turn 381: Refreshed `apps/server/README.md` after TS cutover. The Rust server
  README now describes `apps/server` as a legacy Axum compatibility/reference
  crate, points current web/Docker/Electron runtime usage to `apps/backend` and
  the root README, fixes the old `src-server`/`src-core` paths, and scopes
  environment variables to explicit legacy reference runs. Verified with
  targeted `rg`, full `bun run check`, and `git diff --check`.
- Turn 382: Ported broker activity page data aliases for the migrated
  empty/skip-only paths. Transaction-mode `/connect/sync/activities` now reads
  `data`, `activities`, `universalActivities`, and `universal_activities` like
  Rust's `PaginatedUniversalActivity` serde aliases, preventing aliased
  non-empty pages from being mistaken as empty and preserving the mapper feature
  gate when aliased rows contain mappable IDs. Verified with focused Connect
  broker activity tests, backend type-check, backend test suite, full
  `bun run check`, and `git diff --check`.
- Turn 383: Refreshed stale Tauri wording in the add-on SDK README. The
  `activities.getAll` tip now describes desktop and web runtimes generically,
  while intentional compatibility names elsewhere remain unchanged. Verified
  with targeted `rg`, full `bun run check`, and `git diff --check`.
- Turn 384: Tightened Connect broker activity request-shape parity.
  Activity-only sync now builds broker activity query strings in the Rust client
  order `offset`, `limit`, optional `start_date`, then `end_date`, and focused
  tests assert the exact parameter order including incremental sync start dates.
  Verified with focused Connect broker activity tests, backend type-check,
  backend test suite, full `bun run check`, and `git diff --check`.
- Turn 385: Refreshed root README backend technology/folder wording to match the
  TS cutover state. The README now describes Rust/Axum as legacy
  compatibility/reference tooling instead of a temporary runtime server, and
  labels `apps/server` as a legacy Rust compatibility/reference server. Verified
  with targeted `rg`, full `bun run check`, and `git diff --check`.
- Turn 386: Refreshed Electron architecture wording around the TS backend. The
  migration doc now says the Bun/TypeScript backend preserves behavior proven
  against the legacy Rust reference implementation, instead of implying the
  current runtime still uses legacy Rust business logic. Verified with targeted
  `rg`, full `bun run check`, and `git diff --check`.
- Turn 387: Tightened authenticated Connect API error parsing parity in the TS
  runtime. Bearer Connect requests now parse JSON error bodies and include
  cloud-provided `message`/`error` text in `API error <status>: ...` messages
  like the Rust authenticated client, so broker activity sync failures persist
  more actionable `last_error` values. Verified with focused Connect broker
  activity tests, backend type-check, backend test suite, full `bun run check`,
  and `git diff --check`.
- Turn 388: Matched Rust Connect broker list default-array parsing.
  Authenticated broker connection/account reads now treat missing `connections`
  or `accounts` fields as empty arrays, while still rejecting non-object
  responses and non-array fields. Verified with focused Connect broker list
  tests, backend type-check, backend test suite, full `bun run check`, and
  `git diff --check`.
- Turn 389: Tightened Connect user-info parsing parity. TS now rejects malformed
  `/connect/user` cloud responses when required user or team IDs are missing or
  non-string, matching Rust serde-required `ApiUser.id`/`ApiTeam.id` behavior
  instead of silently returning empty IDs. Verified with focused Connect
  user-info tests, backend type-check, backend test suite, full `bun run check`,
  and `git diff --check`.
- Turn 390: Tightened Connect broker read response validation. Broker connection
  entries now require the Rust-required `id` field even when `authorization_id`
  is present, broker account entries must be objects, and the old unused string
  fallback helper was removed. Verified with focused Connect broker read tests,
  backend type-check, backend test suite, full `bun run check`, and
  `git diff --check`.
- Turn 391: Extended Connect broker account scalar validation. Broker account
  reads now reject non-string values for Rust `Option<String>` account fields
  and non-boolean values for boolean account flags instead of silently dropping
  invalid values during TS mapping. Verified with focused Connect broker account
  tests, backend type-check, backend test suite, full `bun run check`, and
  `git diff --check`.
- Turn 392: Extended Connect broker connection brokerage validation. Nested and
  fallback brokerage fields now reject invalid non-string scalar values like
  Rust serde would, instead of silently nulling malformed brokerage IDs, names,
  slugs, or logo URLs during TS mapping. Verified with focused Connect broker
  connection tests, backend type-check, backend test suite, full
  `bun run check`, and `git diff --check`.
- Turn 393: Extended Connect user/team optional scalar validation. User info now
  rejects malformed optional string, boolean, and numeric fields on the user and
  team payloads, matching Rust serde behavior instead of silently nulling
  invalid cloud values. Verified with focused Connect user/team tests, backend
  type-check, backend test suite, full `bun run check`, and `git diff --check`.
- Turn 394: Extended Connect broker account nested validation. Broker account
  reads now reject malformed balance totals, owner fields, and sync-status
  detail fields when their scalar types do not match Rust models, instead of
  silently preserving invalid cloud payloads. Verified with focused Connect
  broker account tests, backend type-check, backend test suite, full
  `bun run check`, and `git diff --check`.
- Turn 395: Extended Connect broker connection scalar validation. Optional
  connection fields such as `authorization_id`, `status`, `updated_at`, `name`,
  and `disabled` now reject invalid scalar types like Rust serde instead of
  silently dropping or defaulting malformed cloud values. Verified with focused
  Connect broker connection tests, backend type-check, backend test suite, full
  `bun run check`, and `git diff --check`.
- Turn 396: Added Rust-shaped Connect subscription plan parsing. Public and
  authenticated plan reads now validate required plan, pricing, and limit
  fields, normalize serde-default fields such as `features`, availability flags,
  badge, and discount metadata, and reject malformed plan payloads instead of
  passing raw partial responses through. Verified with focused Connect
  plan/runtime tests, backend type-check, backend test suite, full
  `bun run check`, and `git diff --check`.
- Turn 397: Tightened Connect subscription plan optional scalar validation.
  Optional plan fields such as `tagline`, `isAvailable`, `isComingSoon`,
  `badge`, `yearlyDiscountPercent`, and `pricing.yearlyPerMonth` now reject
  malformed scalar types like Rust serde instead of being silently defaulted or
  nulled. Verified with focused Connect plan tests, backend type-check, backend
  test suite, full `bun run check`, and `git diff --check`.
- Turn 398: Ported the first safe local `/connect/device/sync-state` branch into
  the TS runtime. With a valid Connect session but no sync identity, or an
  identity with a nonce and no device ID, the route now returns Rust-compatible
  `FRESH` state; without a Connect session it returns the same forbidden session
  error before local state checks, and device-ID-present states remain
  feature-gated until cloud device verification lands. Verified with focused
  Connect device-sync tests, runtime smoke, backend type-check, backend test
  suite, full `bun run check`, and `git diff --check`.
- Turn 399: Added regression coverage for malformed local sync identity handling
  in the migrated `/connect/device/sync-state` branch. The TS runtime now has
  explicit parity coverage proving malformed identity JSON/field types surface
  parse errors after session restore instead of falling through to FRESH.
  Verified with focused Connect device-sync tests, backend type-check, backend
  test suite, full `bun run check`, and `git diff --check`.
- Turn 400: Tightened local device-sync background-start gating. The TS runtime
  now keeps start-background as a local `skipped` no-op only when sync identity
  is absent or not runnable; if local identity has both device ID and root key,
  the route stays feature-gated instead of incorrectly reporting that sync
  identity is not configured. Verified with focused Connect device-sync tests,
  runtime smoke, backend type-check, backend test suite, full `bun run check`,
  and `git diff --check`.
- Turn 401: Aligned local device-sync engine-status bootstrap detection with
  Rust's secret-store identity source. Engine status and bootstrap-overwrite
  checks now require bootstrap whenever sync identity is missing or malformed,
  and only use `sync_device_config` for the current identity device ID instead
  of any stale config row. Verified with focused Connect device-sync tests,
  runtime smoke, backend type-check, backend test suite, full `bun run check`,
  and `git diff --check`.
- Turn 402: Added Rust-compatible Connect client request IDs to TS cloud calls.
  Public and bearer-authenticated Connect requests now include
  `x-wf-client-request-id: app:<uuid>` alongside JSON content headers, matching
  the Rust Connect client request metadata behavior. Verified with focused
  Connect request-header tests, backend type-check, backend test suite, full
  `bun run check`, and `git diff --check`.
- Turn 403: Corrected public Connect plans error handling to match the Rust
  public client. Public `/connect/plans/public` failures now return status-only
  `API error <status>` messages instead of parsing cloud JSON error bodies,
  while authenticated/bearer Connect requests still preserve cloud error text.
  Verified with focused Connect plan/error tests, backend type-check, backend
  test suite, full `bun run check`, and `git diff --check`.
- Turn 404: Ported the first safe `/api/v1/sync/device/current`
  device-management branch into the TS runtime. With no Connect session the
  route now returns the same forbidden session error as token minting, and with
  a restored session but no local device ID it returns Rust-compatible
  `400 No device ID configured`; legacy `sync_device_id` fallback is preserved
  when `sync_identity` cannot be parsed, while actual cloud device reads remain
  feature-gated. Verified with focused device-sync/runtime tests, backend
  type-check, backend test suite, full `bun run check`, and `git diff --check`.
- Turn 405: Extended standalone `/api/v1/sync/devices` device-management
  preconditions. Listing devices now restores the Connect session first,
  returning the same forbidden session error when no session is configured, and
  remains feature-gated after a valid session until cloud device listing lands.
  Verified with focused device-sync/runtime tests, backend type-check, backend
  test suite, full `bun run check`, and `git diff --check`.
- Turn 406: Extended standalone device get/update/delete/revoke preconditions.
  `/api/v1/sync/device/{id}` and revoke now restore the Connect session before
  cloud work, return the same forbidden session error when no session is
  configured, and remain feature-gated after a valid session until cloud device
  management lands. Verified with focused device-sync/runtime tests, backend
  type-check, backend test suite, full `bun run check`, and `git diff --check`.
- Turn 407: Extended standalone team-key/reset device-sync preconditions. Team
  key initialize/commit/rotate/commit now restore the Connect session and report
  Rust-compatible `400 No device ID configured` when no local device ID exists,
  while reset-team-sync restores the session first; all remain feature-gated
  once prerequisites are satisfied. Verified with focused device-sync/runtime
  tests, backend type-check, backend test suite, full `bun run check`, and
  `git diff --check`.
- Turn 408: Extended standalone pairing preconditions for core
  `/api/v1/sync/pairing*` issuer/claimer routes. Create/get/approve/complete,
  cancel, claim, messages, and confirm now restore Connect session and report
  Rust-compatible missing-device-ID errors before cloud calls, while remaining
  feature-gated after prerequisites are satisfied. Verified with focused
  device-sync/runtime tests, backend type-check, backend test suite, full
  `bun run check`, and `git diff --check`.
- Turn 409: Extended standalone composite pairing transfer/bootstrap
  preconditions. `/api/v1/sync/pairing/complete-with-transfer` and
  `/api/v1/sync/pairing/confirm-with-bootstrap` now require a parseable
  `sync_identity` with a device ID before restoring the Connect session,
  matching the Rust engine path, and remain feature-gated after prerequisites
  are satisfied. Dual GPT/Claude xhigh review found and fixed an i32 identity
  parse gap for `version`/`keyVersion`. Verified with focused
  device-sync/runtime tests, backend type-check, backend test suite, full
  `bun run check`, and `git diff --check`.
- Turn 410: Extended standalone pairing flow coordinator preconditions and safe
  local responses. `/api/v1/sync/pairing/flow/begin` now follows the Rust engine
  identity/device-ID/session precondition order before remaining feature-gated,
  unknown flow `state`/`approve-overwrite` return Rust-compatible
  `Flow not found` errors, and `flow/cancel` returns the Rust-shaped local
  success no-op. Dual GPT/Claude xhigh review found no actionable issues.
  Verified with focused device-sync/runtime tests, backend type-check, backend
  test suite, full `bun run check`, and `git diff --check`.
- Turn 411: Extended standalone device registration preconditions.
  `/api/v1/sync/device/register` now restores the Connect session before the
  deferred cloud enrollment path, matching Rust's token-first register route,
  and remains feature-gated after a valid session. Dual GPT/Claude xhigh review
  found no actionable issues. Verified with focused device-sync/runtime tests,
  backend type-check, backend test suite, full `bun run check`, and
  `git diff --check`.
- Turn 412: Extended Connect device enable/reinitialize preconditions.
  `/api/v1/connect/device/enable` and `/api/v1/connect/device/reinitialize` now
  restore the Connect session before the deferred enroll/reinitialize paths,
  matching Rust's token-first Connect device routes, and remain feature-gated
  after a valid session. Dual GPT/Claude xhigh review found no actionable
  issues. Verified with focused Connect-device/runtime tests, backend
  type-check, backend test suite, full `bun run check`, and `git diff --check`.
- Turn 413: Extended Connect reconcile-ready-state local preconditions.
  `/api/v1/connect/device/reconcile-ready-state` now returns Rust-shaped
  reconcile results for token/sync-state read failures and non-READY local
  states, while keeping READY/cloud bootstrap paths feature-gated. Dual
  GPT/Claude xhigh review found no actionable issues. Verified with focused
  Connect-device/runtime tests, backend type-check, backend test suite, full
  `bun run check`, and `git diff --check`.
- Turn 414: Aligned Connect snapshot/bootstrap identity preconditions with the
  Rust engine. `/api/v1/connect/device/bootstrap-snapshot` and
  `/api/v1/connect/device/generate-snapshot` now read `sync_identity` from the
  secret store instead of stale `sync_device_config`, preserve the
  no-legacy-fallback behavior, report `No device ID configured` for nonce-only
  identities, and remain feature-gated once a device ID is present. Dual
  GPT/Claude xhigh review found no actionable issues. Verified with focused
  Connect-device/runtime tests, backend type-check, backend test suite, full
  `bun run check`, and `git diff --check`.
- Turn 415: Aligned Connect pairing-source status identity preconditions with
  the Rust engine. `/api/v1/connect/device/pairing-source-status` now reads
  `sync_identity` from the secret store instead of stale `sync_device_config`,
  reports missing identity/device-ID before token/cloud checks, maps token
  restore failures through the Rust-like internal-error path, and remains
  feature-gated after a valid session. Dual GPT/Claude xhigh review found no
  actionable issues. Verified with focused Connect-device/runtime tests, backend
  type-check, backend test suite, full `bun run check`, and `git diff --check`.
- Turn 416: Aligned Connect trigger-cycle identity preconditions with the Rust
  sync engine. `/api/v1/connect/device/trigger-cycle` now reads `sync_identity`
  from the secret store instead of stale `sync_device_config`, reports
  `config_error` only for missing/unparseable identity, reports `not_ready` for
  identity without a device ID or non-READY local sync state, maps token/state
  restore failures to `state_error`, and remains feature-gated for READY/cloud
  cycle paths. Dual GPT/Claude xhigh review found no actionable issues. Verified
  with focused Connect-device/runtime tests, backend type-check, backend test
  suite, full `bun run check`, and `git diff --check`.
- Turn 417: Tightened Connect-side `sync_identity` parsing to match Rust serde
  integer semantics. `version` now rejects `null`, floats, and out-of-range
  values like Rust's defaulted `i32`; `keyVersion` now accepts only nullable
  `i32` values, including raw JSON tokens such as `2.0`/`1e0` before
  `JSON.parse` erases token shape, across escaped/duplicate field spellings and
  device-ID-only consumers. Dual GPT/Claude xhigh review found and then verified
  the raw-token/device-ID-consumer fix. Verified with focused Connect-device
  tests, backend type-check, backend test suite, full `bun run check`, and
  `git diff --check`.
- Turn 418: Tightened standalone and Connect-device `sync_identity` parsing to
  match Rust serde identity semantics. Core standalone device-ID lookup now
  treats malformed stored identities as parse failures and falls back to the
  legacy device-ID key, while engine-style paths reject malformed
  `version`/`keyVersion` raw JSON tokens and duplicate known identity fields
  without legacy fallback. Dual GPT/Claude xhigh review found no actionable
  issues. Verified with focused Connect/device-sync tests, backend type-check,
  backend test suite, full `bun run check`, and `git diff --check`.
- Turn 419: Migrated standalone device listing from a feature gate to the TS
  cloud read path. `/api/v1/sync/devices` now restores the Connect session,
  sends Rust-shaped device-sync headers and request IDs to
  `/api/v1/sync/team/devices`, parses snake_case/camelCase cloud device fields
  into Rust-compatible camelCase responses, and preserves session precondition
  errors. Dual GPT/Claude xhigh review found no actionable issues after cloud
  error wrapping and optional-field validation fixes. Verified with focused
  device-sync tests, backend type-check, backend test suite, full
  `bun run check`, and `git diff --check`.
- Turn 420: Migrated standalone device get/current reads to the TS cloud path.
  `/api/v1/sync/device/{id}` now restores the Connect session and reads
  `/api/v1/sync/team/devices/{id}`, while `/api/v1/sync/device/current` keeps
  Rust's token-first and local-device-ID fallback behavior before the same cloud
  read. Device mutations remain feature-gated. Dual GPT/Claude xhigh review
  found no actionable issues. Verified with focused device-sync tests, backend
  type-check, backend test suite, full `bun run check`, and `git diff --check`.
- Turn 421: Migrated standalone device update/delete/revoke mutations to the TS
  cloud path. `/api/v1/sync/device/{id}` PATCH/DELETE and
  `/api/v1/sync/device/{id}/revoke` now restore the Connect session, call the
  Rust-compatible cloud endpoints, serialize `display_name`, and parse
  `SuccessResponse`. Dual GPT/Claude xhigh review found no actionable issues.
  Verified with focused device-sync tests, backend type-check, backend test
  suite, full `bun run check`, and `git diff --check`.
- Turn 422: Migrated standalone team-key phase-one operations to the TS cloud
  path. `/api/v1/sync/keys/initialize` and `/api/v1/sync/keys/rotate` now
  restore the Connect session, resolve the local device ID, send Rust-compatible
  device-sync headers and JSON bodies, and parse
  BOOTSTRAP/PAIRING_REQUIRED/READY initialize results plus rotate challenges.
  Commit operations remain deferred. Dual GPT/Claude xhigh review found no
  actionable issues after response-shape and request-ID fixes. Verified with
  focused device-sync tests, backend type-check, backend test suite, full
  `bun run check`, and `git diff --check`.
- Turn 423: Migrated standalone team-key commit operations to the TS cloud path.
  `/api/v1/sync/keys/initialize/commit` and `/api/v1/sync/keys/rotate/commit`
  now restore the Connect session, resolve the local device ID, send
  Rust-compatible headers and snake_case payloads, and parse commit success
  responses. Dual GPT/Claude xhigh review found no actionable issues. Verified
  with focused device-sync tests, backend type-check, backend test suite, full
  `bun run check`, and `git diff --check`.
- Turn 424: Migrated standalone reset-team-sync to the TS cloud path.
  `/api/v1/sync/team/reset` now restores the Connect session, posts
  `/api/v1/sync/team/keys/reset`, omits `reason` when absent, parses
  `ResetTeamSyncResponse`, and preserves no-session errors. Dual GPT/Claude
  xhigh review found no actionable issues. Verified with focused device-sync
  tests, backend type-check, backend test suite, full `bun run check`, and
  `git diff --check`.
- Turn 425: Migrated issuer-side pairing create/get/approve/cancel operations to
  the TS cloud path. These routes now restore the Connect session, resolve the
  local device ID, send Rust-compatible device-scoped pairing endpoints and
  request IDs, parse create/get/success responses, and leave complete/claimer
  flows deferred. Dual GPT/Claude xhigh review found no actionable issues.
  Verified with focused device-sync tests, backend type-check, backend test
  suite, full `bun run check`, and `git diff --check`.
- Turn 426: Migrated claimer-side pairing claim/messages operations to the TS
  cloud path. `/api/v1/sync/pairing/claim` and
  `/api/v1/sync/pairing/{id}/messages` now restore the Connect session, resolve
  the local device ID, send Rust-compatible device-scoped endpoints and request
  IDs, parse claim/message responses, and leave confirm/complete flows deferred.
  Dual GPT/Claude xhigh review found no actionable issues. Verified with focused
  device-sync tests, backend type-check, backend test suite, full
  `bun run check`, and `git diff --check`.
- Turn 427: Migrated standalone device registration to the TS cloud path.
  `/api/v1/sync/device/register` now restores the Connect session, enrolls via
  `/api/v1/sync/team/devices`, maps request fields to Rust's
  `RegisterDeviceRequest`, persists the returned `sync_device_id`, and returns
  Rust-shaped enrollment responses. Dual GPT/Claude xhigh review found no
  actionable issues after persistence-error wrapping. Verified with focused
  device-sync tests, backend type-check, backend test suite, full
  `bun run check`, and `git diff --check`.
- Turn 428: Migrated issuer-side complete-pairing to the TS cloud path.
  `/api/v1/sync/pairing/{id}/complete` now restores the Connect session,
  resolves the local device ID, sends the Rust-compatible complete pairing
  payload, and parses `CompletePairingResponse`; post-complete background-engine
  start remains deferred to the sync-engine slice. Dual GPT/Claude xhigh review
  found no actionable issues. Verified with focused device-sync tests, backend
  type-check, backend test suite, full `bun run check`, and `git diff --check`.
- Turn 429: Migrated claimer-side confirm-pairing to the TS cloud path.
  `/api/v1/sync/pairing/{id}/confirm` now restores the Connect session, resolves
  the local device ID, sends Rust-compatible confirm payloads, parses
  `ConfirmPairingResponse`, and persists `minSnapshotCreatedAt` to SQLite when
  available using Rust-compatible timestamp normalization. Dual GPT/Claude xhigh
  review found no actionable issues after the timestamp parser fix. Verified
  with focused device-sync/runtime tests, backend type-check, backend test
  suite, full `bun run check`, and `git diff --check`.
- Turn 430: Migrated the safe composite confirm-with-bootstrap
  `already_complete` branch. The TS service now reuses the cloud confirm path,
  tolerates already-confirmed/already-completed retries like Rust, persists the
  freshness gate, returns Rust-shaped `already_complete` when bootstrap is not
  required, and keeps real bootstrap paths feature-gated. Verified with focused
  device-sync tests, backend type-check, backend test suite, full
  `bun run check`, and `git diff --check`.
- Turn 431: Migrated the safe pairing-flow begin success branch. The TS service
  now reuses cloud confirm, freshness persistence, and local bootstrap checks,
  returns Rust-shaped `{ flowId, phase: { phase: "success" } }` when bootstrap
  is not required, and keeps real bootstrap/overwrite flow paths feature-gated.
  Verified with focused device-sync tests, backend type-check, backend test
  suite, full `bun run check`, and `git diff --check`.
- Turn 432: Extended Connect device sync state beyond FRESH. The TS runtime now
  reads cloud device status for stored `sync_identity` device IDs and returns
  Rust-shaped READY, REGISTERED, STALE, and RECOVERY states for safe non-engine
  cases, while preserving FRESH and malformed-identity behavior. Verified with
  focused Connect-device tests, backend type-check, backend test suite, full
  `bun run check`, and `git diff --check`. Dual GPT/Claude xhigh review found no
  actionable issues.
- Turn 433: Added the safe Connect device enable resume path. When
  `/api/v1/connect/device/enable` finds an existing READY, REGISTERED, or STALE
  sync state, TS now returns Rust-shaped `EnableSyncResult`; true FRESH/RECOVERY
  enrollment paths remain feature-gated. Verified with focused Connect-device
  tests, backend type-check, backend test suite, full `bun run check`, and
  `git diff --check`.
- Turn 434: Added the safe Connect bootstrap snapshot not-ready branch.
  `/api/v1/connect/device/bootstrap-snapshot` now reads cloud sync state and
  returns Rust-shaped `skipped_not_ready` when the current device is not READY;
  actual READY snapshot bootstrap remains feature-gated. Verified with focused
  Connect-device tests, backend type-check, backend test suite, full
  `bun run check`, and `git diff --check`. Dual GPT/Claude xhigh review found no
  actionable issues after checking the Rust HTTP wrapper response shape.
- Turn 435: Added the safe Connect generate-snapshot non-trusted branch.
  `/api/v1/connect/device/generate-snapshot` now reads cloud device status and
  returns Rust-shaped skipped snapshot responses when the current device is not
  trusted, while actual trusted snapshot generation remains feature-gated.
  Verified with focused Connect-device tests, backend type-check, backend test
  suite, full `bun run check`, and `git diff --check`.
- Turn 436: Completed the safe Connect sync-state trusted-device and ORPHANED
  detection branch. The TS runtime now fetches trusted devices best-effort only
  in the same cases as Rust, probes initialize-team-keys when server key version
  is omitted, returns Rust-shaped ORPHANED/REGISTERED trusted-device data, and
  preserves READY/RECOVERY/FRESH behavior. Verified with focused Connect-device
  tests, backend type-check, backend test suite, full `bun run check`, and
  `git diff --check`.
- Turn 437: Added the safe standalone composite pairing overwrite-risk branch.
  `/api/v1/sync/pairing/confirm-with-bootstrap` now returns Rust-shaped
  `overwrite_required` responses after idempotent cloud confirm when bootstrap
  is required, overwrite is not approved, and local syncable data would be
  replaced. The local overwrite-risk table/filter rules are shared with Connect
  bootstrap checks to avoid parity drift, while actual snapshot
  bootstrap/sync-cycle application remains feature-gated. Verified with focused
  device-sync and Connect-device tests, backend type-check, backend test suite,
  full `bun run check`, `git diff --check`, and dual GPT/Claude xhigh review.
- Turn 438: Added the safe standalone pairing-flow overwrite branch and cancel
  cleanup parity. `/api/v1/sync/pairing/flow/begin` now returns Rust-shaped
  `overwrite_required` flow state after idempotent cloud confirm when bootstrap
  would replace local data, flow state can be read, approve remains explicitly
  feature-gated before real bootstrap/sync-cycle execution, and cancel performs
  Rust-like best-effort cloud cancel/device delete plus local sync identity,
  device-id, freshness, and sync-session cleanup while always removing the flow.
  Verified with focused device-sync tests, backend type-check, backend test
  suite, full `bun run check`, `git diff --check`, and dual GPT/Claude xhigh
  review/refine.
- Turn 439: Added the safe Connect bootstrap snapshot already-complete branch.
  `/api/v1/connect/device/bootstrap-snapshot` now returns Rust-shaped `skipped`
  responses for READY devices when local bootstrap is complete, no valid
  freshness gate is active, and cloud reconcile does not require a snapshot. The
  TS runtime now mirrors Rust's READY device-config best-effort persistence,
  invalid freshness-gate clearing, and reconcile `WAIT_SNAPSHOT`/
  `BOOTSTRAP_SNAPSHOT` guard while real snapshot download/apply remains
  feature-gated. Verified with focused Connect-device and device-sync tests,
  backend type-check, backend test suite, full `bun run check`,
  `git diff --check`, and dual GPT/Claude xhigh review/refine.
- Turn 440: Added the safe Connect bootstrap missing-snapshot/no-remote-snapshot
  branch. READY devices now handle Rust's 404 + reconcile `NOOP`/`PULL_TAIL`
  classification by resetting local sync session state, marking bootstrap
  complete with trusted device config, and returning Rust-shaped `skipped`
  responses with cursor `0`; the race where local bootstrap was already complete
  but initial reconcile requested a snapshot now follows the same safe
  reclassification path. Snapshot-required, active freshness-gate, and existing
  snapshot paths remain feature-gated without destructive reset. Verified with
  focused Connect-device and device-sync tests, backend type-check, backend test
  suite, full `bun run check`, `git diff --check`, and dual GPT/Claude xhigh
  review/refine.
- Turn 441: Completed the safe Connect bootstrap empty-snapshot cursor fallback.
  `/api/v1/connect/device/bootstrap-snapshot` now treats Rust-valid empty
  `/snapshots/latest` metadata as missing only when `/events/cursor` also has no
  latest snapshot, then follows the existing no-remote-snapshot mark-complete
  path. Existing snapshots, cursor fallback snapshots, malformed snapshot/cursor
  shapes, unsafe numeric ranges, active freshness gates, and snapshot-required
  reconcile states remain feature-gated without destructive reset. Verified with
  focused Connect-device and device-sync tests, backend type-check, backend test
  suite, full `bun run check`, `git diff --check`, and dual GPT/Claude xhigh
  review/refine.
- Turn 442: Added the safe Connect bootstrap missing-snapshot requested
  branches. READY devices now return Rust-shaped `requested` responses when a
  valid freshness gate is waiting for a post-pairing snapshot or when missing
  snapshot classification still reports `WAIT_SNAPSHOT`/`BOOTSTRAP_SNAPSHOT`. No
  destructive reset happens in these wait paths; `NOOP`/`PULL_TAIL` still uses
  the prior mark-complete branch, while existing/malformed snapshot paths remain
  feature-gated. Verified with focused Connect-device and device-sync tests,
  backend type-check, backend test suite, full `bun run check`,
  `git diff --check`, and dual GPT/Claude xhigh review.
- Turn 443: Added the safe Connect bootstrap snapshot schema-version branch with
  Rust-equivalent snapshot metadata resolution.
  `/api/v1/connect/device/bootstrap-snapshot` now reports Rust-shaped
  newer-schema errors before real snapshot apply, using the same
  `/snapshots/latest` vs `/events/cursor.latest_snapshot` selection rules for
  empty IDs, non-strict UUIDs, snapshotId validation fallbacks, cursor
  `oplogSeq`, and strict UUID preference. Malformed metadata and existing
  applyable snapshots remain feature-gated without destructive reset. Verified
  with focused Connect-device and device-sync tests, backend type-check, backend
  test suite, full `bun run check`, `git diff --check`, and dual GPT/Claude
  xhigh review/refine.
- Turn 444: Added the safe Connect bootstrap freshness-gate snapshot-present
  branch. READY devices with a valid freshness gate now return Rust-shaped
  `requested` responses when the latest snapshot is older than the gate beyond
  the 120-second leeway and does not cover the remote cursor, while snapshots
  that satisfy the gate remain feature-gated before real apply. The branch
  preserves sync outbox and returns Rust-shaped invalid-created-at errors.
  Verified with focused Connect-device and device-sync tests, backend
  type-check, backend test suite, full `bun run check`, `git diff --check`, and
  dual GPT/Claude xhigh review.
- Turn 445: Added safe Connect bootstrap snapshot download preflight errors.
  After snapshot metadata resolution, schema checks, and freshness checks, the
  TS runtime now performs a read-only snapshot download preflight and returns
  Rust-shaped internal errors for missing snapshots, download-header checksum
  mismatch, and latest-metadata checksum mismatch before the real apply path.
  Successful downloads still stop at the explicit feature gate. Verified with
  focused Connect-device and device-sync tests, backend type-check, backend test
  suite, full `bun run check`, `git diff --check`, and dual GPT/Claude xhigh
  review.
- Turn 446: Tightened safe Connect bootstrap snapshot download header
  validation. The TS runtime now mirrors Rust's required download headers before
  checksum comparison: `x-snapshot-schema-version` must parse as `i32`, and
  `x-snapshot-covers-tables` plus `x-snapshot-checksum` must be present. Missing
  or invalid headers return Rust-shaped `Invalid request` internal errors while
  preserving sync outbox and the explicit apply feature gate. Verified with
  focused Connect-device and device-sync tests, backend type-check, backend test
  suite, full `bun run check`, `git diff --check`, and dual GPT/Claude xhigh
  review.
- Turn 447: Added Connect device-sync pairing-source status parity. The TS
  runtime now reads the current cloud device and server cursor, returns
  Rust-shaped `ready` or `restore_required` responses based on local/server
  cursor comparison, returns the Rust internal error when the current device is
  not trusted, and maps device/cursor transport failures to internal errors.
  Verified with focused Connect-device tests, device-sync regression tests,
  backend type-check, backend test suite, full `bun run check`,
  `git diff --check`, and dual GPT/Claude xhigh review/refine.
- Turn 448: Added bounded Connect transaction-activity pagination safety parity.
  The migrated no-mapper activity-sync path now tracks page count and first
  activity IDs, fails only the current account when pagination repeats the same
  first activity ID, preserves the existing mapper feature gate when any
  mappable activity is present, and includes Rust's 10,000-page guard. Verified
  with focused Connect tests, backend type-check, backend test suite, full
  `bun run check`, `git diff --check`, and dual GPT/Claude xhigh review/refine.
- Turn 449: Added safe Connect generate-snapshot pre-export branches. Trusted
  devices now compare local and server cursors before export, return the
  Rust-shaped restore-required internal error when the local cursor is ahead,
  and return Rust-shaped `uploaded` when the latest remote snapshot already
  covers the local cursor. Real local snapshot export/upload remains
  feature-gated. Verified with focused Connect-device and device-sync tests,
  backend type-check, backend test suite, full `bun run check`,
  `git diff --check`, and dual GPT/Claude xhigh review.
- Turn 450: Hardened safe Connect bootstrap snapshot download HTTP error parity.
  Non-404 failed snapshot downloads now surface as Rust-shaped internal API
  errors instead of falling through to the feature gate, while 404, header
  validation, checksum mismatch, and successful-download apply-gate behavior
  remain unchanged. Verified with focused Connect-device and device-sync tests,
  backend type-check, backend test suite, full `bun run check`,
  `git diff --check`, and dual GPT/Claude xhigh review/refine.
- Turn 451: Ported bounded Connect device-sync enable/reinitialize enrollment
  parity. The TS runtime now resumes legacy identities after adding missing
  nonces, enrolls fresh/recovery devices, initializes BOOTSTRAP E2EE key
  material with Rust-shaped cloud requests, returns PAIR/ORPHANED registration
  states, preserves nonce on reinitialize reset, shares the Connect token
  restorer across normal Connect and device-sync paths, serializes token restore
  and clear/enable races, stores legacy device IDs, clears freshness gates, and
  marks READY bootstrap complete locally. Real push/pull/background sync and
  snapshot export/apply remain active follow-ups. Verified with focused
  Connect-device tests, backend type-check, backend test suite, full
  `bun run check`, `git diff --check`, and repeated dual GPT/Claude xhigh
  review/refine.
- Turn 452: Added bounded Connect broker-sync entitlement parity. The TS
  `/connect/sync` runtime now performs the Rust-shaped `has_broker_sync`
  preflight before starting migrated connection/account/activity slices,
  returning forbidden when user/team subscription metadata is missing, inactive,
  basic-plan, or entitlement verification fails, while preserving direct
  connection/account/activity sync behavior. Verified with focused Connect
  tests, runtime smoke, backend type-check, backend test suite, full
  `bun run check`, `git diff --check`, and dual GPT/Claude xhigh review.
- Turn 453: Added sync-outbox entity mapping parity for portfolio scopes. TS
  outbox events now support Rust `SyncEntity::Portfolio` and
  `SyncEntity::PortfolioAccount` via `portfolios` and `portfolio_accounts`
  table/event names, preserving payload normalization and sync metadata updates.
  Verified with focused sync-outbox tests, backend type-check, backend test
  suite, full `bun run check`, `git diff --check`, and dual GPT/Claude xhigh
  review.
- Turn 454: Stabilized E2E fixture/import/holdings parity. TS E2E fixture-backed
  Yahoo search/resolve/history now uses exact-symbol precedence over aliases,
  activity import apply reuses pending/existing assets and flushes domain-event
  portfolio recalculation before returning success, frontend import success
  invalidates holdings/portfolio caches, live holdings expose snapshot-position
  lots, and Bun server idle timeout is capped to the runtime maximum. Verified
  with targeted backend activity/market-data/holdings/http tests, frontend
  import hook tests, targeted multi-exchange E2E, full `bun run test:e2e`
  (88/88), full `bun run test:all`, full `bun run check`, and pre-commit checks.
- Turn 455: Addressed dual GPT/Claude xhigh review follow-ups for the E2E/import
  stabilization slice. Pending import asset reuse now constrains fallback
  matches by instrument type and FX/crypto quote currency, fixture-mode symbol
  search no longer falls through to live provider fallbacks, and live holdings
  list/detail lots now match Rust's detailed-only shape. Verified with affected
  backend domain tests, targeted asset-backed-income and multi-exchange E2E,
  full `bun run check`, pre-commit checks, and dual GPT/Claude xhigh re-review.
- Turn 456: Extended Connect broker activity sync to provider-backed new assets.
  Transaction-mode broker activities that do not match a local asset can now
  resolve exact provider search results through the migrated market-data symbol
  search, memoize per-symbol lookups, create activity-owned market assets
  through bulk activity mutation, and report created asset IDs/counts internally
  while preserving unresolved-symbol feature gates. Verified with focused and
  full Connect tests, backend suite, full `bun run check`, pre-commit checks,
  and dual GPT/Claude xhigh review/refine.
- Turn 457: Ported the bounded device-sync composite pairing transfer completion
  path. `completePairingWithTransfer` now uses the Rust-compatible cloud
  complete pairing endpoint after sync-identity and Connect-session
  prerequisites, sends the device-scoped encrypted key bundle/SAS
  proof/signature payload, maps the cloud complete response, and starts the
  pairing-complete callback best-effort while keeping bootstrap confirm/apply
  paths gated. Verified with focused device-sync/runtime tests, backend suite,
  full `bun run check`, pre-commit checks, and dual GPT/Claude xhigh review.
- Turn 458: Strengthened Connect broker provider-backed asset coverage for
  existing local assets returned by provider search. Suffixed broker symbols can
  now be proven to bind to `existingAssetId` search results without creating a
  duplicate asset. Verified with focused/full Connect tests, full
  `bun run check`, and pre-commit checks.
- Turn 459: Tightened device-sync begin-pairing confirmation parity for the
  no-local-DB runtime path. After sync-identity/session prerequisites and a
  successful cloud confirm request, `beginPairingConfirm` now returns the same
  success flow shape as the no-bootstrap local DB branch instead of feature
  gating. Verified with focused device-sync tests, pairing/runtime tests, full
  `bun run check`, pre-commit checks, and dual GPT/Claude xhigh review.
- Turn 460: Tightened device-sync bootstrap-confirm parity for the no-local-DB
  runtime path. After sync-identity/session prerequisites and successful cloud
  confirm, `confirmPairingWithBootstrap` now returns Rust-shaped
  `already_complete` when no local database/bootstrap state exists instead of
  feature-gating. Verified with focused device-sync tests, pairing/runtime
  tests, full `bun run check`, pre-commit checks, and dual GPT/Claude xhigh
  review.
- Turn 461: Tightened Connect broker UNKNOWN asset-backed activity parity.
  Symbol-bearing broker records with missing or explicit unknown activity type
  now sync as `UNKNOWN` review drafts through existing/provider-backed asset
  paths, while no-symbol unknown records still use the cash draft path. Verified
  with focused/full Connect tests, backend suite, full `bun run check`,
  pre-commit checks, and dual GPT/Claude xhigh review.
- Turn 462: Tightened Connect device-sync trigger-cycle precondition parity.
  `triggerDeviceSyncCycle` now restores the session, reads actual sync state,
  persists non-READY devices as untrusted with stale bootstrap timestamps
  cleared, returns `not_ready` for non-READY states, and keeps READY sync-engine
  execution gated. Verified with focused/full Connect tests, backend suite, full
  `bun run check`, pre-commit checks, and dual GPT/Claude xhigh review/refine.
- Turn 463: Tightened Connect device-sync background-engine start preconditions.
  `startDeviceSyncBackgroundEngine` now skips with explicit messages when sync
  identity, session, or actual sync state are not ready, and only preserves the
  feature gate for READY-state real background engine execution. Verified with
  focused/full Connect tests, full `bun run check`, pre-commit checks, and dual
  GPT/Claude xhigh review.
- Turn 464: Extended Connect broker provider-backed asset resolution to crypto
  pairs. Provider search results such as `BTC-USD` now match broker crypto base
  symbols like `BTC`, allowing broker crypto activities to create CRYPTO
  activity-owned assets through the migrated bulk activity path. Verified with
  focused/full Connect tests, full `bun run check`, pre-commit checks, and dual
  GPT/Claude xhigh review.
- Turn 465: Added E2E fixture-backed asset profile enrichment parity. In
  `WEALTHFOLIO_E2E=1`, Yahoo profile enrichment now uses the same fixture
  catalog style as market-data search/resolve/history, including exact-symbol
  precedence over aliases, synthetic FX profiles, country metadata, and no live
  Yahoo fallback on fixture misses. Verified with focused assets/market-data
  backend tests, backend type-check, full `bun run check`, pre-commit checks,
  and dual GPT/Claude xhigh review/refine.
- Turn 466: Ported the safe Connect device-sync trigger-cycle READY/NOOP branch.
  When the restored device is READY, cloud reconcile returns `NOOP`, and local
  `sync_outbox` has no due pending rows, TS now persists trusted device config,
  clears successful cycle error/failure counters, and returns Rust-shaped `ok`
  without attempting push/pull. Pending outbox or non-NOOP READY cases remain
  feature-gated. Verified with focused Connect/device-sync tests, backend
  type-check, full `bun run check`, backend suite, pre-commit checks, and dual
  GPT/Claude xhigh review/refine.
- Turn 467: Ported the safe Connect device-sync trigger-cycle `WAIT_SNAPSHOT`
  branch. READY devices whose cloud reconcile action is `WAIT_SNAPSHOT` now set
  the cycle outcome to `wait_snapshot`, schedule the Rust-compatible 30-second
  retry, preserve existing engine error/failure fields like Rust, and return a
  Rust-shaped zero-push/pull result without entering the gated push/pull engine.
  Verified with focused Connect/device-sync tests, backend type-check, full
  `bun run check`, backend suite, pre-commit checks, and dual GPT/Claude xhigh
  review.
- Turn 468: Ported the safe Connect device-sync trigger-cycle
  `BOOTSTRAP_SNAPSHOT` branch. READY devices whose cloud reconcile action asks
  for bootstrap now set the cycle outcome to `stale_cursor`, clear retry timing,
  preserve existing engine error/failure fields like Rust, and return
  Rust-shaped bootstrap snapshot id/sequence metadata without entering gated
  push/pull. Verified with focused Connect/device-sync tests, backend
  type-check, full `bun run check`, backend suite, pre-commit checks, and dual
  GPT/Claude xhigh review.
- Turn 469: Ported the safe Connect device-sync trigger-cycle idle `PULL_TAIL`
  branch. READY devices whose cloud reconcile cursor is already at or behind the
  local cursor and whose due pending outbox is empty now simulate Rust
  cycle-lock acquisition, mark `ok`, clear success error/failure state, and
  return a Rust-shaped zero-push/pull result. Cursor-advanced or pending-outbox
  `PULL_TAIL` paths remain gated for the real push/pull engine. Verified with
  focused Connect/device-sync tests, backend type-check, full `bun run check`,
  backend suite, pre-commit checks, and dual GPT/Claude xhigh review.
- Turn 470: Tightened Connect trigger-cycle `PULL_TAIL` cursor default parity.
  Missing reconcile cursors now default to `0` like Rust before the idle
  `PULL_TAIL` check, so READY/no-pending cycles can return Rust-shaped `ok`
  instead of staying gated when the cloud omits the cursor. Verified with
  focused Connect/device-sync tests, backend type-check, full `bun run check`,
  backend suite, pre-commit checks, and dual GPT/Claude xhigh review.
- Turn 471: Tightened Connect reconcile cursor token validation parity. Non-null
  malformed cursor tokens such as strings or JSON floats now keep the idle
  `PULL_TAIL` no-op path gated, while missing/null cursors still default to `0`
  like Rust. This avoids reporting `ok` for cloud responses Rust serde would
  reject. Verified with focused Connect/device-sync tests, backend type-check,
  full `bun run check`, backend suite, pre-commit checks, and dual GPT/Claude
  xhigh review/refine.
- Turn 472: Refreshed agent guidance for the current Bun/TypeScript backend
  runtime. `AGENTS.md` and `.claude/CLAUDE.md` now describe Electron/web using
  `apps/backend`, `apps/server`/`crates` as legacy Rust/Axum parity references,
  and the shared Rust migrations as the active schema source for Bun SQLite.
  Verified with formatting checks, full `bun run check`, pre-commit checks, and
  dual GPT/Claude xhigh review/refine.
- Turn 473: Tightened Connect reconcile latest-snapshot validation parity.
  Non-null malformed `latest_snapshot` / `latestSnapshot` payloads, duplicate
  cursor/snapshot fields, and float/exponent numeric tokens now keep safe
  trigger-cycle/action-only paths gated instead of being treated as valid Rust
  responses. Missing/null latest snapshots remain allowed. Verified with focused
  Connect/device-sync tests, backend type-check, full `bun run check`, backend
  suite, pre-commit checks, and dual GPT/Claude xhigh review/refine.
- Turn 474: Tightened Connect reconcile action validation parity. Reconcile
  responses must now include exactly one string `action`; duplicate, missing, or
  non-string action fields keep trigger-cycle and action-only bootstrap
  decisions gated like Rust serde rejection. Verified with focused
  Connect/device-sync tests, backend type-check, full `bun run check`, backend
  suite, pre-commit checks, and dual GPT/Claude xhigh review/refine.
- Turn 475: Tightened Connect latest-snapshot metadata validation parity.
  `/sync/snapshots/latest` and cursor fallback `latest_snapshot` metadata now
  reject duplicate snake/camel alias fields and raw float/exponent numeric
  tokens like Rust serde, while preserving genuinely missing/null cursor latest
  snapshots. Verified with focused Connect/device-sync tests, backend
  type-check, full `bun run check`, backend suite, pre-commit checks, and dual
  GPT/Claude xhigh review/refine.
- Turn 476: Applied cursor raw-token validation to every local Connect
  `/sync/events/cursor` parser. Pairing-source status, generate-snapshot
  preflight, and cursor-latest fallback now all reject malformed optional
  `gcWatermark`/`gc_watermark` tokens such as JSON floats before using cursor
  data. Verified with focused Connect/device-sync tests, backend type-check,
  full `bun run check`, backend suite, pre-commit checks, and dual GPT/Claude
  xhigh review/refine.
- Turn 477: Ported the safe device-sync composite pairing confirm
  `waiting_snapshot` result. After cloud confirm and overwrite approval, the TS
  service now checks latest snapshot availability and returns the Rust-shaped
  `waiting_snapshot` response on 404 while keeping actual snapshot apply gated.
  Verified with focused device-sync tests, backend type-check, full
  `bun run check`, backend suite, pre-commit checks, and dual GPT/Claude xhigh
  review.

## Deferred items

- Full health status/fix coverage remains an active follow-up. reason=taxonomy
  classification migration status/run, bounded account/timezone status/checks,
  legacy-classification health issue generation, `sync_prices`/`retry_sync` fix
  dispatch into the market-data sync seam, `fetch_fx` dispatch into the
  exchange-rate seam, targeted `migrate_classifications` dispatch into the
  taxonomy migration seam, service-level `migrate_legacy_classifications`
  dispatch, legacy-classification affected items, and no-op market sync modes,
  bounded price-staleness checks, bounded quote-sync error checks, bounded FX
  integrity issue generation, bounded data-consistency checks for negative
  balances, orphan activity account/asset references, and negative latest
  positions, targeted Yahoo-backed `sync_prices`/`retry_sync`/`fetch_fx`
  execution, Rust-compatible dismissal hash carryover, and market-sync
  failure/skipped-reason event payloads now have TS runtime parity, while
  broader classification, all-provider market sync, Connect/device-sync
  background orchestration, automatic/background FX quote fetching, and
  remaining affected-item parity depend on holdings, quotes, FX, assets,
  valuation, and market sync parity.
- Custom provider `test-source` local source testing now has TS runtime parity.
  reason=external source fetches, secret-backed headers, parser/extractor
  behavior, response safety limits, and preview metadata are implemented in the
  standalone TS backend, and custom provider Create/Update/Delete callbacks now
  persist to runtime sync_outbox; broader market-data provider quote/import/sync
  runtime remains deferred below.
- FX currency converter, historical lookup, register-pair behavior, and runtime
  FX asset sync_outbox persistence now have TS runtime parity. reason=the Rust
  and standalone TS exchange-rate services initialize and refresh the historical
  converter after rate mutations, the TS runtime can register required FX
  assets, and persists FX asset Create/Delete callbacks without generated
  `instrument_key` payload fields, and exchange-rate mutations now enqueue full
  portfolio recalculation jobs; automatic market sync, provider HTTP, quote
  import/persistence, and quote outbox follow-ups remain deferred below.
- Alternative asset persistence, manual valuation quotes, liability metadata
  linking/unlinking quirks, alternative holdings reads, and alternative
  asset/UUID quote sync_outbox persistence now have TS runtime parity.
  reason=the standalone TS backend writes `assets`/`quotes` directly, preserves
  Rust response/metadata behavior, persists asset callbacks plus MANUAL+UUID
  quote callbacks, intentionally omits quote delete outbox rows on alternative
  asset deletion, and enqueues incremental portfolio jobs for create, valuation
  update, and delete; broader portfolio recalculation side effects remain
  deferred to portfolio parity slices.
- Full health status/fix coverage remains an active follow-up. reason=legacy
  classification migration now has TS runtime parity through taxonomy endpoints,
  bounded account/timezone status/checks are wired into standalone runtime, and
  legacy classification migration issues plus targeted migration fix dispatch
  are surfaced in health status, while price, quote sync, FX, broader
  classification, consistency checks, and provider-backed fix execution depend
  on holdings, quotes, FX, assets, valuation, and market sync parity beyond
  local health dismissal/config state.
- Market-data exchange list, local quote history/update/delete, latest quote
  snapshots, quote CSV check/import, addon-compatible Yahoo dividends, symbol
  search, Yahoo-backed symbol quote resolution, and bounded
  custom-provider-backed symbol quote resolution, targeted and general-purpose
  custom-provider latest quote sync, explicit plus general-purpose
  custom-provider historical backfill, latest-source fallback during custom
  backfill, synced and resolved provider quote hard-validation, Börse Frankfurt
  historical/latest sync and quote resolution, and MarketData.app history/latest
  sync plus quote resolution now have TS runtime parity. reason=the standalone
  backend reads the Rust exchange catalog, writes local quote rows directly, can
  call Yahoo dividends/search/resolve through injectable HTTP paths, can resolve
  `CUSTOM:<code>` quote previews through the runtime custom-provider
  source/test-source service, can persist single latest custom provider quotes
  through targeted/incremental market sync for both explicit and general-purpose
  custom-provider assets, can backfill explicit and general-purpose historical
  custom-provider rows, can safely fall back to latest sources without purging
  historical quote rows, validates provider quote writes and quote-resolution
  results against Rust's negative-price/OHLC/volume hard checks before
  persistence or response, can resolve/fetch Börse Frankfurt `MIC:ISIN` history
  and latest price-information responses with bond percentage scaling, can fetch
  MarketData.app candle/latest endpoints with provider secrets and exchange-MIC
  currency precedence, can merge search results against existing SQLite assets,
  and now reconciles quote-sync position lifecycle from latest TOTAL holdings
  snapshots around portfolio jobs; remaining provider breadth and broader
  portfolio recalculation side effects remain active follow-ups.
- Actual portfolio job execution and broad domain-event worker behavior remain
  active follow-ups. reason=holdings snapshot mutation events now have bounded
  TS runtime parity and the Rust domain-event planner, injectable batch
  processor, asset-enrichment chunk/failure continuation behavior, and debounced
  worker helper now have TS ports, while real debounced portfolio jobs still
  depend on market sync, holdings, snapshot, valuation, account, health, and FX
  service parity beyond route-level job enqueue and SSE transport semantics.
- Packaged keyring cutover and cross-platform keyring CI remain active
  follow-ups. reason=file-backed secret persistence and native
  `WF_SECRET_BACKEND=keyring` now have TS runtime parity, while production
  desktop cutover and OS-provider validation across release targets still need a
  dedicated runtime/keyring slice.
- AI chat tool execution, richer provider orchestration, and multimodal
  PDF/binary attachment behavior remain active follow-ups. reason=AI provider
  catalog/settings/model listing, local thread/message/tag persistence,
  sync_outbox callbacks for local AI chat mutations, native/fallback
  text/reasoning streaming, generated thread titles, OpenAI-compatible/Ollama
  injected tool-call execution, built-in `get_accounts`, `get_holdings`,
  `get_cash_balances`, `get_goals`, `search_activities`, `get_performance`,
  `get_income`, `get_valuation_history`, `get_asset_allocation`, and
  `get_health_status`, bounded text/CSV attachment prompt injection,
  Anthropic/Gemini image/PDF media payloads, OpenAI-compatible image/PDF media
  payloads, and Ollama image payloads now have TS runtime parity, while Ollama
  native PDF support remains unsupported by documented `/api/chat` payloads and
  richer orchestration belongs in dedicated AI runtime slices.
- Alternative asset persistence, quote writes, liability metadata merging, and
  current/history net-worth calculations now have bounded TS runtime parity.
  reason=the standalone backend reads/writes local asset/quote records and can
  calculate net-worth from latest holdings snapshots plus standalone alternative
  assets; broader valuation calculations and portfolio job enqueue behavior
  remain active follow-ups.
- Asset create/profile mutation and market identity canonicalization now have TS
  runtime parity for direct SQLite-backed routes, including runtime sync_outbox
  persistence for direct asset Create/Update/Delete callbacks and initial
  taxonomy auto-classification side effects. reason=asset create/update now
  preserves generated `instrument_key` behavior, duplicate returns, provider
  inference, sync-state reset, Rust-shaped outbox payloads without generated
  `instrument_key`, and Rust-compatible initial
  `instrument_type`/`asset_classes` assignments for newly created assets;
  quote-provider interactions, remaining quote sync outbox follow-ups outside
  migrated alternative-asset and market-data quote paths, and portfolio
  recalculation behavior remain active follow-ups.
- App utility database restore runtime now has TS runtime parity. reason=the
  standalone backend performs file-level restore after closing the live database
  handle and explicitly reports restart-required readiness afterward; future
  polish can improve long-running file-copy offload but no Rust route behavior
  remains blocked on a `501`.
- Net-worth current/history, income summary, simple account performance, account
  performance history/summary, local quote-backed symbol performance history,
  holdings allocation reads, snapshot deletion, and bounded manual/imported
  snapshot saves with FX pair registration and mutation event production now
  have bounded TS runtime parity, while provider-backed symbol fetch/resolution
  and broader valuation calculations remain active follow-ups. reason=the
  standalone backend can calculate `/api/v1/net-worth`,
  `/api/v1/net-worth/history`, `/api/v1/income/summary`,
  `/api/v1/performance/accounts/simple`, and account-scoped
  `/api/v1/performance/{history,summary}` plus local quote-backed symbol
  `/api/v1/performance/history`, `/api/v1/valuations/{history,latest}`,
  `/api/v1/snapshots`, `/api/v1/snapshots/holdings`,
  `/api/v1/snapshots/import/check`, `DELETE /api/v1/snapshots`, and bounded
  `POST /api/v1/snapshots`, plus `/api/v1/holdings`, `/api/v1/allocations`, and
  `/api/v1/allocations/holdings`, and publish holdings snapshot mutation events;
  remaining portfolio metrics, debounced job execution, and inline valuation
  recalculation still need dedicated calculation/import parity slices.
- Activity import mapping/template storage, duplicate lookups, read-only
  activity search, transfer link/unlink mutations, single activity deletes,
  bounded existing-asset/cash activity create/update/bulk persistence, and
  bounded symbol-only resolution to existing assets, bounded symbol-based asset
  creation from explicit metadata, CSV parse, read-only import asset preview,
  read-only import validation, bounded import apply, and import transfer-pair
  auto-linking now have TS runtime parity. reason=the standalone backend
  reads/writes `import_templates`, `import_account_templates`, activity
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
  behavior, cross-account transfer-pair source-group metadata, FX pair ensure
  through the TS exchange-rate runtime, Rust-shaped mutation event production,
  transactional `assets_created` events for newly staged assets, and
  Rust-compatible MANUAL quote fallback writes for price-bearing activity
  writes, Rust-compatible activity sync-event callback queuing for write paths,
  CSV import-run sync-event callback queuing, activity-created asset Create
  sync-event callback queuing, activity quote-mode asset Update callback queuing
  with stale quote sync-state cleanup, and runtime sync_outbox persistence for
  these callbacks, direct activity-created OPTION/BOND structured metadata, and
  direct import apply can create provider-enriched assets from symbol-only
  market rows without a prior check round-trip; remaining quote sync outbox
  follow-ups outside migrated alternative-asset and market-data quote paths,
  provider-backed asset resolution outside activity import flows, device-sync
  push/pull runtime wiring, and portfolio recalculation side effects remain
  active follow-ups for dedicated activities/import/device-sync/portfolio parity
  slices.
- AI chat tool execution, multimodal PDF provider behavior, and full tool-result
  side effects remain active follow-ups. reason=local thread/message
  persistence, tool-result mutation, tag persistence, sync callbacks, text-only
  provider streaming, `<think>` reasoning deltas, generated thread titles, and
  bounded text/CSV attachment prompt injection, Anthropic/Gemini image/PDF
  payloads, OpenAI-compatible image/PDF payloads, and Ollama image payloads now
  have TS runtime parity, while richer orchestration must move with dedicated AI
  runtime parity slices.
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
  reason=the standalone TS backend now wires disabled Connect feature-flag
  behavior, empty local Connect list routes, and local broker sync profile
  persistence, while real runtime behavior must move with dedicated
  Connect/device-sync parity slices.
- Real device-sync token minting, E2EE enrollment, sync engine, trusted-device
  snapshot/upload runtime, background workers, and remaining secret/freshness
  side effects remain active follow-ups. reason=the standalone TS backend now
  wires local status/precondition/no-op and clear-data behavior for
  `/connect/device/*`, plus Connect session-clear freshness-gate cleanup, while
  cloud runtime behavior must move with dedicated Connect/device-sync parity
  slices.
- Real device-sync cloud clients, token lifecycle, device-id secret storage,
  enrollment side effects, team-key operations, pairing flows, and E2EE runtime
  remain active follow-ups. reason=the standalone TS backend now wires disabled
  device-management feature-flag responses, while runtime behavior must move
  with dedicated device-sync parity slices.
- Real device-sync team-key cloud calls, key material handling, device identity
  lookup, reset side effects, pairing flows, and E2EE runtime remain active
  follow-ups. reason=the standalone TS backend now wires disabled team-key/reset
  feature-flag responses, while runtime behavior must move with dedicated
  device-sync parity slices.
- Real device-sync pairing cloud calls, E2EE key exchange, freshness gate
  persistence, bootstrap transfer, background engine startup, and pairing-flow
  runtime remain active follow-ups. reason=the standalone TS backend now wires
  disabled pairing feature-flag responses, while runtime behavior must move with
  dedicated device-sync parity slices.
- Complex holdings snapshot reconciliation from activities remains an active
  follow-up. reason=holdings fan-out, valuation reads, allocation reads,
  manual/imported snapshot deletion, bounded manual snapshot saves, bounded
  snapshot import writes, snapshot FX pair registration, provider-backed
  import-check symbol lookup, snapshot mutation event production, and bounded
  portfolio job valuation/TOTAL recalculation from existing snapshots plus
  bounded transaction-account replay for posted BUY/SELL/cash-flow activities,
  including broker FX cash/lot conversion and option contract multipliers,
  option-expiry adjustments, other adjustment no-op behavior, split
  preprocessing, and lot-level asset transfers now have TS runtime parity, while
  broader provider-driven enrichment and background worker orchestration must
  move with dedicated holdings/portfolio parity slices.
- Add-on security scanning, full sandbox isolation, and query-cache hardening
  remain active follow-ups. reason=the standalone TS backend now supports local
  installed add-on listing, Rust-compatible manifest normalization, toggles,
  uninstall, runtime file loading, enabled-on-startup loading, local ZIP
  extraction/install, add-on store listings/ratings/update checks/download
  staging/update installs, staged `{addonId}.zip` install cleanup, and safe
  staging cleanup from `appDataDir/addons`, and the frontend now enforces
  manifest permissions for SDK domain APIs, UI registration, and scoped secrets,
  while archive security scanning, complete browser sandbox isolation, and React
  Query cache access hardening still need dedicated add-on parity slices.
- Market-data provider breadth and background orchestration remain active
  follow-ups. reason=exchange metadata, local quote persistence/import, Yahoo
  dividends/search/resolve, bounded custom-provider symbol quote resolution,
  targeted custom-provider latest sync, targeted Yahoo sync, bounded broad Yahoo
  sync/history, explicit/general-purpose custom-provider history and latest
  fallback sync, Börse Frankfurt historical/latest sync and quote resolution,
  Börse Frankfurt symbol search fallback, MarketData.app history/latest sync and
  quote resolution, market-sync result payloads, quote-triggered portfolio jobs,
  and bounded portfolio valuation/TOTAL recalculation have TS runtime coverage,
  while remaining provider breadth, background orchestration,
  automatic/background FX quote fetching, and remaining complex activity-derived
  snapshot behavior must move with dedicated market-data and portfolio parity
  slices.

## Blockers

- None.
