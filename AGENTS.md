# AGENTS.md

AI agent guide for this repository. Covers behavioral rules, architecture, and
common task playbooks.

---

## Behavioral Guidelines

**These come first because they prevent the most mistakes.**

### 1. Think Before Coding

- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them—don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.

### 2. Simplicity First

- No features beyond what was asked.
- No abstractions for single-use code.
- No error handling for impossible scenarios.
- If 200 lines could be 50, rewrite it.

### 3. Surgical Changes

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated issues, mention them—don't fix them.
- Remove only what YOUR changes made unused.

### 4. Goal-Driven Execution

- Transform tasks into verifiable goals.
- For multi-step tasks, state a brief plan with verification steps.
- Unverified work is incomplete work.

### 5. Output Precision

- Lead with findings, not process descriptions.
- Use structured formats (lists, tables, code blocks).
- Include absolute file paths—never relative.

---

## Overview

- **Frontend**: React + Vite + Tailwind v4 + shadcn (`apps/frontend/`)
- **Desktop**: Electron main/preload with a Rust sidecar (`apps/electron/`,
  `apps/server/`, `crates/`)
- **Web mode**: Axum HTTP server (`apps/server/`)
- **TS backend migration**: Bun runtime skeleton (`apps/backend/`) being built
  as the eventual replacement for `apps/server/`
- **Packages**: `@wealthfolio/ui`, addon-sdk, addon-dev-tools (`packages/`)

## Code Layout

```
apps/frontend/
├── src/
│   ├── pages/          # Route pages
│   ├── components/     # Shared components
│   ├── features/       # Self-contained feature modules
│   ├── commands/       # Backend call wrappers (Desktop/Web)
│   ├── adapters/       # Runtime adapters (Electron/Web)
│   └── addons/         # Addon runtime

apps/electron/
└── src/                # Electron main/preload/shared IPC

apps/backend/
└── src/                # Bun/TypeScript backend runtime migration target

apps/server/src/
└── api/                # Axum HTTP handlers

crates/
├── core/               # Business logic, models, services
├── storage-sqlite/     # Diesel ORM, repositories, migrations
├── market-data/        # Market data providers
├── connect/            # External integrations
├── device-sync/        # Device sync, E2EE
└── ai/                 # AI providers and LLM integration
```

## Run Targets

| Task           | Command                    |
| -------------- | -------------------------- |
| Desktop dev    | `bun run dev:electron`     |
| Web dev        | `bun run dev:web`          |
| Tests (TS)     | `bun run test`             |
| Tests (Rust)   | `cargo test`               |
| Type check     | `bun run type-check`       |
| Lint           | `bun run lint`             |
| All checks     | `bun run check`            |
| Electron build | `bun run build:electron`   |
| Electron pkg   | `bun run package:electron` |
| Git hooks      | `bun run hooks:install`    |

`bun run dev:electron` uses an isolated `.dev` desktop data root and keyring
namespace. Packaged Electron builds reuse the legacy production desktop data
root for migration continuity.

---

## Agent Playbook

### Adding a feature with backend data

1. **Frontend route/UI** → `apps/frontend/src/pages/`,
   `apps/frontend/src/routes.tsx`
2. **Command wrapper** → `apps/frontend/src/commands/<domain>.ts` (follow
   `RUN_ENV` pattern)
3. **Electron IPC** → `apps/electron/src/shared/ipc.ts` +
   `apps/electron/src/main/commands.ts`
4. **Sidecar/Web endpoint** → `apps/server/src/api/`, call `crates/core` service
5. **Core logic** → `crates/core/` services/repos
6. **Tests** → Vitest for TS, `#[test]` for Rust

### UI patterns

- Components: `@wealthfolio/ui` and `packages/ui/src/components/`
- Forms: `react-hook-form` + `zod` schemas from
  `apps/frontend/src/lib/schemas.ts`
- Theme: tokens in `apps/frontend/src/globals.css`

### Architecture pattern

```
Frontend → Adapter (Electron/Web) → Command wrapper
                ↓
        Electron IPC + Rust sidecar | Axum HTTP
                ↓
           crates/core (business logic)
                ↓
           crates/storage-sqlite
```

---

## Conventions

### TypeScript

- Strict mode, no unused locals/params
- Prefer interfaces over types, avoid enums
- Functional components, named exports
- Directory names: lowercase-with-dashes

### Rust

- Idiomatic Rust, small focused functions
- `Result`/`Option`, propagate with `?`, `thiserror` for domain errors
- Keep Electron/Axum boundaries thin—delegate business logic to `crates/core`
- Migrations in `crates/storage-sqlite/migrations`

### Security

- All data local (SQLite), no cloud
- Secrets via OS keyring—never disk/localStorage
- Never log secrets or financial data

---

## Validation Checklist

Before completing any task:

- [ ] Builds: `bun run build`, `bun run build:electron`, or `cargo check`
- [ ] Tests pass: `bun run test` and/or `cargo test`
- [ ] Both desktop and web compile if touching shared code
- [ ] Changes are minimal and surgical

---

## Plan Mode

- Make plans extremely concise. Sacrifice grammar for brevity.
- End with unresolved questions, if any.

---

When in doubt, follow the nearest existing pattern.
