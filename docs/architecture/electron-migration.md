# Electron Desktop Architecture

This document captures the desktop architecture after replacing the former Tauri
shell with Electron.

## Goals

- Keep the React/Vite UI and adapter contract stable while the desktop runtime
  changes.
- Run the Bun/TypeScript backend locally while preserving behavior proven
  against the legacy Rust reference implementation for SQLite storage, sync, AI,
  and market data services.
- Preserve local desktop data and secrets from earlier desktop releases.
- Keep web mode separate and functional throughout the migration.

## Runtime shape

Electron runs as a thin desktop shell around the existing frontend and a managed
local Bun/TypeScript backend sidecar.

```text
Renderer (React)
  -> secure preload API
  -> Electron main IPC
  -> loopback Bun/TypeScript sidecar
  -> TypeScript backend services
  -> SQLite/keyring/network providers
```

The renderer must not receive raw Node.js access, backend tokens, or the sidecar
base URL. Electron main owns sidecar lifecycle, native desktop integration, and
sidecar credentials.

## TypeScript backend sidecar profile

The sidecar is based on the Bun backend runtime with a dedicated desktop startup
profile:

- bind to loopback only, preferably on an ephemeral port;
- require a per-run secret or token known only to Electron main;
- restrict CORS to the Electron origin or Vite dev origin;
- use the resolved desktop data root instead of server defaults;
- use keyring-backed desktop secrets instead of the server `secrets.json` store;
- expose domain events through SSE or an equivalent main-mediated event bridge.

The current web server defaults are intentionally different: `apps/backend`
reads `WF_DB_PATH`, `WF_SECRET_KEY`, `WF_SECRET_BACKEND`, `WF_SECRET_FILE`,
auth, and CORS from environment variables for self-hosted deployments.

The Electron sidecar profile uses `WF_SIDECAR_TOKEN` to enable a fail-closed
bearer-token middleware on protected API routes. When that variable is set, the
backend refuses non-loopback `WF_LISTEN_ADDR` values and rejects empty tokens.
Electron main generates the token per run, keeps the base URL and token out of
the renderer, starts the backend through `bun run --cwd apps/backend start` in
development, and launches a bundled `wealthfolio-backend` executable from
Electron's `resources/sidecars` directory in packaged builds.

The Electron sidecar sets `WF_SECRET_BACKEND=keyring` so desktop provider
secrets are durable through the TypeScript backend's native keyring binding.
Packaged Electron builds stay in the same OS keyring namespace as earlier
desktop releases, while unpackaged Electron development sets
`WF_SECRET_NAMESPACE=dev` so dev provider credentials remain isolated. Electron
still generates a per-run `WF_SECRET_KEY` for the backend profile, but provider
secret storage no longer uses `WF_SECRET_FILE` in desktop mode.

## Data root compatibility

The existing Tauri desktop app stores its SQLite database under
`app_handle.path().app_data_dir()` with `app.db` inside that root. Packaged
Electron builds must resolve and reuse that same root before starting the
TypeScript backend so installed users keep their existing data.

The Tauri app identifier is `com.teymz.wealthfolio`.

| Platform | Tauri app data root                                          | SQLite path                                                         | Log path                                                          |
| -------- | ------------------------------------------------------------ | ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| macOS    | `$HOME/Library/Application Support/com.teymz.wealthfolio`    | `$HOME/Library/Application Support/com.teymz.wealthfolio/app.db`    | `$HOME/Library/Logs/com.teymz.wealthfolio`                        |
| Linux    | `${XDG_DATA_HOME:-$HOME/.local/share}/com.teymz.wealthfolio` | `${XDG_DATA_HOME:-$HOME/.local/share}/com.teymz.wealthfolio/app.db` | `${XDG_DATA_HOME:-$HOME/.local/share}/com.teymz.wealthfolio/logs` |
| Windows  | `%APPDATA%\\com.teymz.wealthfolio`                           | `%APPDATA%\\com.teymz.wealthfolio\\app.db`                          | `%LOCALAPPDATA%\\com.teymz.wealthfolio\\logs`                     |

Electron must not silently initialize its default `app.getPath('userData')`
directory as the Wealthfolio data root unless it is explicitly set to the legacy
Tauri path or a tested one-shot migration is implemented.

Unpackaged Electron development intentionally uses a separate `.dev` desktop
root so `bun run dev:electron` cannot read or mutate an installed production
database:

| Platform | Electron dev app data root                                       | SQLite path                                                             | Log path                                                              |
| -------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------- |
| macOS    | `$HOME/Library/Application Support/com.teymz.wealthfolio.dev`    | `$HOME/Library/Application Support/com.teymz.wealthfolio.dev/app.db`    | `$HOME/Library/Logs/com.teymz.wealthfolio.dev`                        |
| Linux    | `${XDG_DATA_HOME:-$HOME/.local/share}/com.teymz.wealthfolio.dev` | `${XDG_DATA_HOME:-$HOME/.local/share}/com.teymz.wealthfolio.dev/app.db` | `${XDG_DATA_HOME:-$HOME/.local/share}/com.teymz.wealthfolio.dev/logs` |
| Windows  | `%APPDATA%\\com.teymz.wealthfolio.dev`                           | `%APPDATA%\\com.teymz.wealthfolio.dev\\app.db`                          | `%LOCALAPPDATA%\\com.teymz.wealthfolio.dev\\logs`                     |

## Secrets and keyring

Packaged desktop secrets continue using the same Rust keyring namespace as
earlier desktop releases:

- service key: `wealthfolio_<lowercase service>`;
- username: `default`;
- backend: Rust uses the `keyring` crate through the shared
  `wealthfolio-desktop-secrets` crate; the TypeScript/Bun runtime uses the
  `@napi-rs/keyring` native binding.

This shared namespace is intentional for migration continuity: Electron can read
the same existing keyring entries written by earlier desktop releases.

Development secrets use `wealthfolio_dev_<service>` keyring service IDs through
`WF_SECRET_NAMESPACE=dev`.

The server file-backed secret store remains valid for web/self-hosted mode and
is still the default when `WF_SECRET_BACKEND` is unset or set to `file`.
`WF_SECRET_BACKEND=keyring` is a desktop mode. The TS runtime wires the same
service IDs through the native keyring binding. Unavailable OS keyring providers
or native bindings surface errors instead of falling back to disk.

## Frontend adapter strategy

Keep the adapter seam:

- `@/adapters` resolves to the active runtime implementation;
- `#platform` resolves to runtime-specific `invoke`, logging, and platform
  flags;
- `RUN_ENV` distinguishes `"electron"` and `"web"`, while `isDesktop` remains
  `true` for the desktop shell.

The Electron adapter preserves existing command names and typed adapter exports.
Command parity tests compare Electron IPC coverage with the existing web command
map so renderer invocations stay registered.

The sidecar command paths cover account list/create/update/delete, portfolio
CRUD, settings read/update/auto-update preference reads, portfolio
update/recalculate, and portfolio dashboard data such as holdings, valuations,
allocations, performance summaries, income summaries, goals, goal funding/plans,
retirement planner simulations, activity CRUD/import-template workflows,
exchange-rate management, contribution limits, asset profiles, market data quote
search/history/import/sync operations, taxonomies, taxonomy assignments,
taxonomy migration helpers, Health Center status/fix/config operations, and Net
Worth calculations/history, AI provider settings/model listing, non-streaming AI
thread/tool-result operations, alternative asset/liability operations, and
market data provider/custom-provider settings, and add-on install/runtime/store
staging operations. Durable keyring-backed secret set/get/delete commands are
also proxied through the sidecar. Device-sync crypto helpers proxy through the
sidecar crypto endpoints and unwrap server `{ value }` responses to preserve the
existing adapter return shape. Wealthfolio Connect session, broker sync/listing,
subscription/user, local broker data, import-run, and broker-sync-profile
commands proxy through the sidecar Connect endpoints. Device-sync state,
enable/clear/reinitialize, background engine status/start/stop,
bootstrap/reconcile, trigger-cycle, and snapshot generation/cancellation
commands proxy through the sidecar Connect device endpoints. Device-sync device
management, team reset, pairing, composite pairing transfer/bootstrap, and
pairing-flow coordinator commands proxy through the sidecar sync endpoints with
path identifiers encoded in Electron main. Snapshot management, holdings CSV
import, activity CSV parsing, data file exports, and database backup/restore
also proxy through the sidecar so manual/imported holdings updates and utility
operations stay in the backend. Add-on zip payloads are validated as byte arrays
in Electron main and forwarded to the sidecar as base64 JSON fields. AI chat
NDJSON streaming uses dedicated start/cancel IPC channels because it cannot
safely use the request/response JSON command proxy; Electron main owns the
sidecar fetch, streams parsed events only to the originating `webContents`, and
aborts streams when the owner closes or navigates. Electron update checks and
installation are handled in Electron main through `electron-updater`, not the
backend sidecar, because Electron updater metadata is incompatible with the
legacy Tauri update endpoint. The renderer still calls the typed preload IPC
bridge, Electron main validates each command against an explicit allowlist,
waits for sidecar readiness when a command needs backend services, and proxies
those requests to the loopback sidecar with the per-run bearer token.
Account-scope dashboard commands must keep the frontend scope shape, Electron
proxy, and backend parser compatible: single-account scopes can use legacy query
routes, while all, portfolio, and multi-account scopes use the POST query routes
for holdings, allocations, allocation drill-down, and income summaries.
All-account scopes use the canonical `TOTAL` snapshot, while portfolio and
multi-account scopes resolve to their selected account IDs and use account-list
aggregation in the backend holdings and portfolio-metrics services. Sidecar base
URLs and tokens must stay confined to Electron main; public runtime status and
command errors must redact loopback URLs and token-shaped values before crossing
IPC. Electron app info must use sanitized runtime metadata and must not expose
desktop DB or log paths to the renderer. JSON request bodies must be sent with
`Content-Type: application/json`, and accepted/no-content sidecar responses must
cross IPC as `undefined`.

Electron domain events use the same trust boundary. Electron main owns the
authenticated SSE connection to `/api/v1/events/stream`, retries it with
backoff, stops it with the sidecar lifecycle, and broadcasts only
`{ event, id, payload }` messages through preload IPC. Event payloads are
recursively redacted for loopback URLs and token-shaped strings before they
reach the renderer. Native desktop-only events also use this boundary: menu
route navigation emits existing route events, and deep links are validated by
Electron main before they are forwarded as `deep-link-received` events. File
drop events are captured by the sandboxed preload, converted to Tauri-compatible
event names, validated by Electron main, and sent back only to the originating
renderer.

## Native desktop features

The Electron preload exposes native file-dialog and shell operations as typed
dedicated IPC methods, not as renderer Node APIs:

- CSV/database/folder open dialogs are owned by Electron main and return
  `string | null` shapes.
- Save dialogs are owned by Electron main; renderer content is converted to
  string/bytes before IPC, and main writes the selected path after cancellation
  checks.
- Add-on package selection is also owned by the adapter seam: Electron main
  reads the selected ZIP bytes, and web mode keeps using an
  `<input type="file">`.
- External URL opening is owned by Electron main and is limited to `http:`,
  `https:`, and `mailto:` protocols before calling `shell.openExternal`.
- Application menu actions are owned by Electron main. Menu-triggered route
  navigation and update-available notifications are forwarded through the typed
  preload event listener API; renderer code does not import Electron event APIs
  directly for those flows.
- Window theme and fullscreen operations are behind the runtime adapter seam.
  Electron main owns `nativeTheme` updates and focused-window fullscreen
  toggles.
- Electron restores and persists the main window's normal bounds/maximized state
  in `electron-window-state.json` under the resolved desktop data root. On
  macOS, the Electron window uses a hidden-inset titlebar and
  `data-desktop-drag-region` markers map to Electron drag regions through CSS.
- Wealthfolio deep links are owned by Electron main. The app registers the
  `wealthfolio://` protocol, enforces a single-instance lock before sidecar
  startup, queues callback URLs until the renderer's dedicated deep-link
  listener drains them, and only forwards validated URLs to the main window.
- File-drop import events preserve the Tauri add-on API names
  (`tauri://file-drop-hover`, `tauri://file-drop`, and
  `tauri://file-drop-cancelled`). Preload extracts dropped file paths through
  Electron `webUtils`, sends them over a dedicated IPC channel, and main
  validates payload shape before forwarding.
- Renderer and sidecar logs are written through Electron main to
  `wealthfolio-electron.log` under the resolved desktop log root. Renderer
  logging keeps console output for developer tools, but persistent writes cross
  a typed preload IPC method with level/message validation.

The Electron main/preload layer now owns the desktop-native responsibilities
that were previously provided by Tauri plugins. Mobile-only Tauri features are
not part of the Electron migration.

## Updates, signing, and packaging

Use Electron-native release tooling for desktop artifacts. The intended stack is
`electron-builder` for packaging/signing and `electron-updater` for update
metadata and install flow, unless later platform testing disproves that choice.

The Electron packaging path stages the Vite renderer into
`apps/electron/dist/renderer`, Bun-compiles `apps/backend/src/main.ts` into a
`wealthfolio-backend` executable, stages it with `backend-assets` in
`apps/electron/resources/sidecars/<platform>-<arch>`, and packages the app with
`electron-builder`. The `afterPack` hook copies the matching staged backend
binary and assets into the packaged app's `resources/sidecars` directory for
each Electron target architecture. The packaged main process resolves the
renderer from the asar app path and resolves the sidecar from
`process.resourcesPath`, so it no longer depends on the repository checkout at
runtime. Use `bun run package:electron` for the full local packaging flow.

Electron update checks and installs are main-process only. The renderer invokes
the existing `check_for_updates` and `install_app_update` command names through
the preload bridge, but Electron main routes them to `electron-updater` instead
of the sidecar. Startup checks in unpackaged development builds return `null`;
manual checks and installs fail explicitly unless the app is packaged and
`app-update.yml` is present. Download progress is forwarded to the renderer as
`app:update-download-progress`, followed by an `installing` phase before
`quitAndInstall()`.

Tauri updater metadata and signing are not compatible with Electron updater
metadata. Electron packaging is configured for a GitHub provider
(`wealthfolio/wealthfolio`) so `electron-builder` can generate
electron-updater-compatible metadata. The release workflow builds Electron
artifacts per platform/architecture, uploads them as workflow artifacts, then a
single publish job merges `latest*.yml` metadata before uploading to a draft
GitHub release. That merge step prevents per-architecture jobs from overwriting
each other's updater metadata. Platform signing/notarization and rollback policy
still need production-secret validation.

## OAuth and deep links

Electron desktop OAuth uses the existing external-browser flow and a custom
protocol callback handled by Electron main. Callback URLs must start with
`wealthfolio://`, are never logged with query strings, and are delivered through
the `listenDeepLink` adapter only after the renderer has registered a dedicated
listener. The existing Wealthfolio Connect provider parses the forwarded URL and
stores refresh tokens through the TypeScript sidecar/keyring path.

## Validation expectations

- Verify data-root pointer equality before any Electron database initialization.
- Test that desktop sidecar secrets use keyring, not `secrets.json`.
- Test that AI chat streams stay owner-window scoped, redact sidecar
  credentials, handle malformed/non-OK streams, and cancel before sidecar
  readiness.
- Keep command parity tests green while adding Electron coverage.
- Smoke test Electron renderer -> preload -> main -> sidecar with at least one
  real command before expanding the command surface.
- Keep web mode checks passing throughout the migration.
