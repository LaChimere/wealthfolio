# Goal State

<!-- prettier-ignore-start -->
objective: "开始为项目进行全栈迁移至 ts。你可以多进行深度调研来了解项目，实现的时候进行原子化 commit，并且频繁进行多轮 review 和 refine 来及时确保项目采用的是最佳实践的方式来实现和迁移的。你的最终目的是完整迁移。"
status: active
slug: "goal-fullstack-ts-migration"
turns_used: 242
turn_budget: null
docs_update_approved: true
created_at: "2026-05-13T21:33:49+08:00"
updated_at: "2026-05-21T17:35:00+08:00"
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

## Deferred items

- Full health status/fix coverage remains an active follow-up. reason=taxonomy
  classification migration status/run, bounded account/timezone status/checks,
  legacy-classification health issue generation, `sync_prices`/`retry_sync` fix
  dispatch into the market-data sync seam, `fetch_fx` dispatch into the
  exchange-rate seam, targeted `migrate_classifications` dispatch into the
  taxonomy migration seam, service-level `migrate_legacy_classifications`
  dispatch, legacy-classification affected items, and no-op market sync modes,
  bounded price-staleness checks, bounded quote-sync error checks, bounded FX
  integrity issue generation, and bounded negative-balance data-consistency
  checks and targeted Yahoo-backed `sync_prices`/`retry_sync`/`fetch_fx`
  execution, Rust-compatible dismissal hash carryover, and market-sync
  failure/skipped-reason event payloads now have TS runtime parity, while
  broader classification, remaining data-consistency checks, all-provider market
  sync, Connect/device-sync background orchestration, automatic/background FX
  quote fetching, and remaining affected-item parity depend on holdings, quotes,
  FX, assets, valuation, and market sync parity.
- Custom provider `test-source` local source testing now has TS runtime parity.
  reason=external source fetches, secret-backed headers, parser/extractor
  behavior, response safety limits, and preview metadata are implemented in the
  standalone TS backend, and custom provider Create/Update/Delete callbacks now
  persist to runtime sync_outbox; broader market-data provider quote/import/sync
  runtime remains deferred below.
- FX currency converter, historical lookup, register-pair behavior, and runtime
  FX asset sync_outbox persistence now have TS runtime parity. reason=the
  standalone TS exchange-rate service initializes the historical converter, can
  register required FX assets, and persists FX asset Create/Delete callbacks
  without generated `instrument_key` payload fields, and exchange-rate mutations
  now enqueue full portfolio recalculation jobs; automatic market sync, provider
  HTTP, quote import/persistence, and quote outbox follow-ups remain deferred
  below.
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
  backfill, Börse Frankfurt historical/latest sync and quote resolution, and
  MarketData.app history/latest sync plus quote resolution now have TS runtime
  parity. reason=the standalone backend reads the Rust exchange catalog, writes
  local quote rows directly, can call Yahoo dividends/search/resolve through
  injectable HTTP paths, can resolve `CUSTOM:<code>` quote previews through the
  runtime custom-provider source/test-source service, can persist single latest
  custom provider quotes through targeted/incremental market sync for both
  explicit and general-purpose custom-provider assets, can backfill explicit and
  general-purpose historical custom-provider rows, can safely fall back to
  latest sources without purging historical quote rows, can resolve/fetch Börse
  Frankfurt `MIC:ISIN` history and latest price-information responses with bond
  percentage scaling, can fetch MarketData.app candle/latest endpoints with
  provider secrets and exchange-MIC currency precedence, and can merge search
  results against existing SQLite assets; remaining provider breadth and
  portfolio recalculation side effects remain active follow-ups.
- Actual portfolio job execution and broad domain-event worker behavior remain
  active follow-ups. reason=holdings snapshot mutation events now have bounded
  TS runtime parity and the Rust domain-event planner, injectable batch
  processor, and debounced worker helper now have TS ports, while real debounced
  portfolio jobs still depend on market sync, holdings, snapshot, valuation,
  account, health, and FX service parity beyond route-level job enqueue and SSE
  transport semantics.
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
  persistence for direct asset Create/Update/Delete callbacks. reason=asset
  create/update now preserves generated `instrument_key` behavior, duplicate
  returns, provider inference, sync-state reset, and Rust-shaped outbox payloads
  without generated `instrument_key`; quote-provider interactions, remaining
  quote sync outbox follow-ups outside migrated alternative-asset and
  market-data quote paths, auto-classification side effects, and portfolio
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
  these callbacks, and direct import apply can create provider-enriched assets
  from symbol-only market rows without a prior check round-trip; remaining quote
  sync outbox follow-ups outside migrated alternative-asset and market-data
  quote paths, provider-backed asset resolution outside activity import flows,
  device-sync push/pull runtime wiring, and portfolio recalculation side effects
  remain active follow-ups for dedicated activities/import/device-sync/portfolio
  parity slices.
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
- Real device-sync token minting, E2EE enrollment, sync engine, snapshot/upload
  runtime, repository resets, background workers, and secret side effects remain
  active follow-ups. reason=the standalone TS backend now wires disabled
  `/connect/device/*` feature-flag responses, while runtime behavior must move
  with dedicated Connect/device-sync parity slices.
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
  MarketData.app history/latest sync and quote resolution, market-sync result
  payloads, quote-triggered portfolio jobs, and bounded portfolio
  valuation/TOTAL recalculation have TS runtime coverage, while remaining
  provider breadth, background orchestration, automatic/background FX quote
  fetching, and remaining complex activity-derived snapshot behavior must move
  with dedicated market-data and portfolio parity slices.

## Blockers

- None.
