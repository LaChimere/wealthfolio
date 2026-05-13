# Adapter Architecture

Wealthfolio uses compile-time adapters so the React app can run in Electron
desktop builds and browser/web builds with the same feature-level imports.

## Runtime targets

- **Electron desktop**: `@/adapters` resolves to
  `apps/frontend/src/adapters/electron` and commands cross the secure preload
  IPC bridge before Electron main proxies Rust-backed operations to the
  authenticated sidecar.
- **Web**: `@/adapters` resolves to `apps/frontend/src/adapters/web` and
  commands call REST endpoints on the Axum server.

## Build-time resolution

`apps/frontend/vite.config.ts` selects the adapter with `BUILD_TARGET`:

```ts
const buildTarget = process.env.BUILD_TARGET || "web";
```

The root scripts set this explicitly:

```json
{
  "scripts": {
    "dev": "bun run --cwd apps/frontend dev",
    "dev:electron": "bun run scripts/dev-electron.mjs",
    "build": "bun run --cwd apps/frontend build",
    "build:electron": "bun run --cwd apps/frontend build:electron && bun run --cwd apps/electron build && bun run --cwd apps/electron stage:renderer"
  }
}
```

For TypeScript outside Vite, `apps/frontend/src/adapters/index.ts` re-exports
the Electron adapter by default. Web and Electron builds still receive the
correct runtime implementation through Vite aliases.

## Unified interface

Feature code imports typed functions from `@/adapters` instead of importing
Electron, Node.js, or HTTP clients directly:

```ts
import { getAccounts, isDesktop, logger } from "@/adapters";

const accounts = await getAccounts();
```

Adapters expose shared runtime flags, logging, command wrappers, event
listeners, file dialogs, update helpers, and addon operations. Desktop-only work
must stay behind adapter functions so web bundles do not include Electron code
and renderer code does not gain raw Node.js access.

## Adding commands

1. Add the typed adapter export in `apps/frontend/src/adapters/electron` and, if
   needed, the matching web adapter export.
2. Register Electron IPC metadata in `apps/electron/src/shared/ipc.ts` and route
   it through `apps/electron/src/main/commands.ts`.
3. Add or reuse the Axum sidecar/web endpoint under `apps/server/src/api/`.
4. Keep business logic in `crates/core` or the relevant shared Rust crate.
5. Add/update adapter parity tests so Electron IPC, web mappings, and frontend
   invocations stay aligned.

## Trust boundary

Renderer code never receives sidecar URLs, sidecar tokens, database paths, log
paths, or raw Electron/Node.js APIs. Electron main owns native APIs, sidecar
lifecycle, authenticated sidecar requests, update installation, file dialogs,
deep links, and event redaction.
