# Electron Migration Architecture

This document captures the migration decisions for replacing the current Tauri
desktop shell with Electron. It describes the target architecture, not the
current production runtime.

## Goals

- Keep the React/Vite UI and adapter contract stable while the desktop runtime
  changes.
- Reuse the existing Rust business logic, SQLite storage, sync, AI, and market
  data services instead of rewriting financial logic in TypeScript.
- Preserve local desktop data and secrets during the Tauri-to-Electron cutover.
- Keep web mode separate and functional throughout the migration.

## Runtime shape

Electron should run as a thin desktop shell around the existing frontend and a
managed local Rust sidecar.

```text
Renderer (React)
  -> secure preload API
  -> Electron main IPC
  -> loopback Rust sidecar
  -> existing Rust services
  -> SQLite/keyring/network providers
```

The renderer must not receive raw Node.js access, backend tokens, or the sidecar
base URL. Electron main owns sidecar lifecycle, native desktop integration, and
sidecar credentials.

## Rust sidecar profile

The sidecar should be based on the existing Axum server/service graph, but it
cannot be the current server binary as-is. Desktop needs a dedicated sidecar
profile or startup builder with these properties:

- bind to loopback only, preferably on an ephemeral port;
- require a per-run secret or token known only to Electron main;
- restrict CORS to the Electron origin or Vite dev origin;
- use the legacy desktop data root instead of server defaults;
- use Rust keyring-backed secrets instead of the server `secrets.json` store;
- expose domain events through SSE or an equivalent main-mediated event bridge.

The current web server defaults are intentionally different: `apps/server` reads
`WF_DB_PATH`, `WF_SECRET_KEY`, `WF_SECRET_BACKEND`, `WF_SECRET_FILE`, auth, and
CORS from environment variables for self-hosted deployments.

The initial Electron sidecar profile uses `WF_SIDECAR_TOKEN` to enable a
fail-closed bearer-token middleware on protected API routes. When that variable
is set, the server refuses non-loopback `WF_LISTEN_ADDR` values and rejects
empty tokens. Electron main generates the token per run, keeps the base URL and
token out of the renderer, and starts the server through `cargo run` only in
development until release packaging provides a bundled sidecar binary.

The Electron sidecar sets `WF_SECRET_BACKEND=keyring` and starts the server with
the `keyring-backend` feature so desktop provider secrets are durable and stay
in the same OS keyring namespace as Tauri. Electron still generates a per-run
`WF_SECRET_KEY` for the sidecar's server profile, but provider secret storage no
longer uses `WF_SECRET_FILE` in desktop mode.

## Data root compatibility

The existing Tauri desktop app stores its SQLite database under
`app_handle.path().app_data_dir()`, and storage code appends `app.db` unless
`DATABASE_URL` is set. Electron must resolve and reuse that same root before
starting the sidecar.

The Tauri app identifier is `com.teymz.wealthfolio`.

| Platform | Tauri app data root                                          | SQLite path                                                         | Log path                                                          |
| -------- | ------------------------------------------------------------ | ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| macOS    | `$HOME/Library/Application Support/com.teymz.wealthfolio`    | `$HOME/Library/Application Support/com.teymz.wealthfolio/app.db`    | `$HOME/Library/Logs/com.teymz.wealthfolio`                        |
| Linux    | `${XDG_DATA_HOME:-$HOME/.local/share}/com.teymz.wealthfolio` | `${XDG_DATA_HOME:-$HOME/.local/share}/com.teymz.wealthfolio/app.db` | `${XDG_DATA_HOME:-$HOME/.local/share}/com.teymz.wealthfolio/logs` |
| Windows  | `%APPDATA%\\com.teymz.wealthfolio`                           | `%APPDATA%\\com.teymz.wealthfolio\\app.db`                          | `%LOCALAPPDATA%\\com.teymz.wealthfolio\\logs`                     |

Electron must not silently initialize its default `app.getPath('userData')`
directory as the Wealthfolio data root unless it is explicitly set to the legacy
Tauri path or a tested one-shot migration is implemented.

## Secrets and keyring

Desktop secrets must continue using the same Rust keyring namespace as the Tauri
app:

- service key: `wealthfolio_core::secrets::format_service_id(service)`;
- username: `default`;
- backend: the Rust `keyring` crate through the shared
  `wealthfolio-desktop-secrets` crate.

This shared namespace is intentional for migration continuity: Electron can read
the same existing keyring entries that Tauri wrote. Developers should avoid
running Tauri and Electron against the same profile concurrently because both
desktop runtimes target the same `wealthfolio_*` keyring entries.

The server file-backed secret store remains valid for web/self-hosted mode and
is still the default when `WF_SECRET_BACKEND` is unset or set to `file`.
`WF_SECRET_BACKEND=keyring` is a desktop sidecar mode and requires a server
binary compiled with the `keyring-backend` Cargo feature. On Linux, the OS
keyring backend requires a working desktop secret-service provider/session; if
that provider is unavailable, secret reads/writes surface the keyring error
instead of falling back to disk.

## Frontend adapter strategy

Keep the adapter seam:

- `@/adapters` resolves to the active runtime implementation;
- `#platform` resolves to runtime-specific `invoke`, logging, and platform
  flags;
- `RUN_ENV` distinguishes `"desktop"` (Tauri), `"electron"`, and `"web"`, while
  `isDesktop` remains `true` for both desktop shells.

The Electron adapter should preserve existing command names and typed adapter
exports. Command parity tests should compare Electron IPC coverage with the
existing web command map and, while Tauri remains, the Tauri command registry.
Until the sidecar bridge is connected, Electron domain commands must reject
through the preload IPC bridge instead of falling back to browser REST calls or
exposing a backend URL to the renderer.

The sidecar command paths cover account list/create/update/delete, settings
read/update/auto-update preference reads, portfolio update/recalculate, and
read-only portfolio dashboard data such as holdings, valuations, allocations,
performance summaries, income summaries, goals, goal funding/plans, retirement
planner simulations, activity CRUD/import-template workflows, exchange-rate
management, contribution limits, asset profiles, market data quote
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
import, activity CSV parsing, database backup/restore, and update checks also
proxy through the sidecar so manual/imported holdings updates and utility
operations stay in Rust. Electron update installation is still blocked until the
Electron updater/release pipeline is implemented. Add-on zip payloads are
validated as byte arrays in Electron main and forwarded to the sidecar as base64
JSON fields. AI chat NDJSON streaming uses dedicated start/cancel IPC channels
because it cannot safely use the request/response JSON command proxy; Electron
main owns the sidecar fetch, streams parsed events only to the originating
`webContents`, and aborts streams when the owner closes or navigates. The
renderer still calls the typed preload IPC bridge, Electron main validates each
command against an explicit allowlist, waits for sidecar readiness, and proxies
to the loopback sidecar with the per-run bearer token. Sidecar base URLs and
tokens must stay confined to Electron main; public runtime status and command
errors must redact loopback URLs and token-shaped values before crossing IPC.
Electron app info must use sanitized runtime metadata and must not expose
desktop DB or log paths to the renderer. JSON request bodies must be sent with
`Content-Type: application/json`, and accepted/no-content sidecar responses must
cross IPC as `undefined`.

Electron domain events use the same trust boundary. Electron main owns the
authenticated SSE connection to `/api/v1/events/stream`, retries it with
backoff, stops it with the sidecar lifecycle, and broadcasts only
`{ event, id, payload }` messages through preload IPC. Event payloads are
recursively redacted for loopback URLs and token-shaped strings before they
reach the renderer. Native desktop-only events such as file drop, deep links,
and route navigation stay pending until their Electron-native replacements are
implemented.

## Native desktop features

The Electron preload exposes native file-dialog and shell operations as typed
dedicated IPC methods, not as renderer Node APIs:

- CSV/database/folder open dialogs are owned by Electron main and return
  Tauri-compatible `string | null` shapes.
- Save dialogs are owned by Electron main; renderer content is converted to
  string/bytes before IPC, and main writes the selected path after cancellation
  checks.
- External URL opening is owned by Electron main and is limited to `http:`,
  `https:`, and `mailto:` protocols before calling `shell.openExternal`.

Electron must replace the following Tauri plugin responsibilities before the
Tauri path is removed:

- menu events and route navigation;
- file-drop and deep-link events;
- single-instance behavior;
- window state and titlebar behavior;
- app logging;
- updater progress events;
- OAuth callback handling for Wealthfolio Connect.

Mobile-only Tauri features are not part of the Electron migration.

## Updates, signing, and packaging

Use Electron-native release tooling for desktop artifacts. The intended stack is
`electron-builder` for packaging/signing and `electron-updater` for update
metadata and install flow, unless later platform testing disproves that choice.

Tauri updater metadata and signing are not compatible with Electron updater
metadata. The release migration must define the new update feed, metadata
format, signature/notarization flow, and rollback strategy before removing the
Tauri release workflow.

## OAuth and deep links

Replace `tauri-plugin-web-auth-api` with an Electron-supported desktop OAuth
flow. Prefer external-browser login with either:

- a custom protocol/deep-link callback handled by Electron main; or
- a short-lived loopback callback handled by Electron main.

Electron main should validate the callback, store or forward tokens through the
Rust sidecar/keyring path, and emit existing adapter event names to the
renderer.

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
