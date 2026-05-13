# Goal State

<!-- prettier-ignore-start -->
objective: "开始为项目进行全栈迁移至 ts。你可以多进行深度调研来了解项目，实现的时候进行原子化 commit，并且频繁进行多轮 review 和 refine 来及时确保项目采用的是最佳实践的方式来实现和迁移的。你的最终目的是完整迁移。"
status: active
slug: "goal-fullstack-ts-migration"
turns_used: 31
turn_budget: null
docs_update_approved: true
created_at: "2026-05-13T21:33:49+08:00"
updated_at: "2026-05-14T05:18:49+08:00"
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

## Deferred items

- Taxonomy migration/health endpoints remain active follow-ups. reason=they
  depend on health/assets/classification services and should move with that
  higher-risk slice.
- Custom provider `test-source` remains an active follow-up. reason=it depends
  on external HTTP fetches, secrets, parser/extractor behavior, and response
  safety limits that belong in a dedicated external-I/O slice.
- Goals plan write/delete, summary refresh, save-up overview, and retirement
  simulation endpoints remain active follow-ups. reason=they require retirement
  plan validation/calculation parity and should move in dedicated
  calculation-heavy slices.
- FX currency converter, historical lookup, register-pair, and automatic market
  sync behavior remain active follow-ups. reason=they depend on calculation,
  quote history, and provider sync parity beyond local exchange-rate CRUD.
- Health status/check/fix endpoints and classification migration behavior remain
  active follow-ups. reason=they depend on holdings, quotes, FX, assets,
  valuation, taxonomy, market sync, and classification migration parity beyond
  local health dismissal/config state.
- Market-data search, quote history/latest/update/delete/import, Yahoo
  dividends, symbol resolution, exchange list, and sync endpoints remain active
  follow-ups. reason=they depend on provider HTTP clients, quote import parsing,
  portfolio recalculation jobs, exchange metadata, and market sync parity beyond
  local provider settings.
- Actual portfolio job execution and event production remain active follow-ups.
  reason=they depend on market sync, holdings, snapshot, valuation, account,
  health, and FX service parity beyond route-level job enqueue and SSE transport
  semantics.
- Real secret persistence/keyring integration remains an active follow-up.
  reason=this slice only adds the guarded HTTP seam, while production secrets
  must move with a dedicated runtime/keyring parity slice.
- AI provider catalog merging, settings persistence, provider API calls, and
  secret-backed model listing remain active follow-ups. reason=this slice only
  adds the guarded route seam, while runtime behavior must move with dedicated
  AI/secrets parity slices.
- Alternative asset persistence, quote writes, liability metadata merging,
  holdings/net-worth calculations, and portfolio job enqueue behavior remain
  active follow-ups. reason=this slice only adds the guarded HTTP seam, while
  runtime behavior must move with asset/portfolio calculation parity slices.
- Asset repository persistence, profile/quote-mode side effects, quote-provider
  interactions, activity guards, and portfolio recalculation behavior remain
  active follow-ups. reason=this slice only adds the guarded HTTP seam, while
  runtime behavior must move with asset/market-data/portfolio parity slices.
- App runtime metadata, update HTTP requests/cache, backup/restore file I/O, and
  path normalization remain active follow-ups. reason=this slice only adds the
  guarded HTTP seam, while runtime behavior must move with dedicated app utility
  parity slices.
- Net-worth, performance, income, holdings, FX, and valuation calculations
  remain active follow-ups. reason=this slice only adds the guarded HTTP seam,
  while runtime behavior must move with dedicated portfolio calculation parity
  slices.
- Activity persistence, import parsing/mapping/template storage, duplicate
  lookups, transfer mutation behavior, asset preview resolution, and portfolio
  recalculation side effects remain active follow-ups. reason=this slice only
  adds the guarded HTTP seam, while runtime behavior must move with dedicated
  activities/import/portfolio parity slices.
- AI chat persistence, provider streaming, tool execution, thread storage, tag
  persistence, and tool-result mutation behavior remain active follow-ups.
  reason=this slice only adds the guarded HTTP seam, while runtime behavior must
  move with dedicated AI runtime parity slices.
- Real sync crypto implementation, key material handling, WebCrypto/libsodium
  selection, and device-sync integration remain active follow-ups. reason=this
  slice only adds the guarded HTTP seam, while runtime behavior must move with a
  dedicated sync-crypto/device-sync parity slice.
- Real health checks, classification migration, market sync fix execution,
  health cache behavior, and taxonomy/asset side effects remain active
  follow-ups. reason=this slice only adds optional guarded HTTP seams, while
  runtime behavior must move with a dedicated health/classification parity
  slice.
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
- Holdings fan-out, valuation history/latest calculations, allocation
  calculations, snapshot persistence/reconciliation, import symbol lookup, and
  portfolio recalculation side effects remain active follow-ups. reason=this
  slice only adds the guarded HTTP seam, while runtime behavior must move with
  dedicated holdings/portfolio parity slices.
- Add-on filesystem extraction, manifest validation, sandbox/runtime loading,
  store HTTP requests, staging I/O, and update behavior remain active
  follow-ups. reason=this slice only adds the guarded HTTP seam, while runtime
  behavior must move with dedicated add-on parity slices.
- Exchange metadata, provider HTTP clients, Yahoo dividends, quote
  persistence/import parsing, market sync execution, and portfolio recalculation
  side effects remain active follow-ups. reason=this slice only adds the guarded
  HTTP seam, while runtime behavior must move with dedicated market-data and
  portfolio parity slices.

## Blockers

- None.
