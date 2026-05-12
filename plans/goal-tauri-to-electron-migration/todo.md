# Todo

## Active sequence

| ID                     | Status      | Description                                                                                                                   | Evidence                                                                                                                     |
| ---------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| migration-state        | done        | Create persistent goal/research/design/plan/todo artifacts and review the decomposition.                                      | `plans/goal-tauri-to-electron-migration/*`; adapter parity test passed                                                       |
| architecture-decisions | done        | Verify and document the Rust sidecar, desktop data-root, keyring, updater, and OAuth decisions before Electron scaffold work. | `/Users/lachimere/Projects/wealthfolio/docs/architecture/electron-migration.md`; diff check passed                           |
| guardrail-tests        | done        | Strengthen adapter/IPC parity guardrails for an Electron adapter without changing runtime behavior.                           | `apps/frontend/src/adapters/adapter-runtime-boundary.test.ts`; targeted lint/test and code review passed                     |
| bun-tooling            | done        | Move JS package management/scripts to Bun and introduce Biome/Lefthook with minimal churn.                                    | Bun migration committed; Biome/Lefthook baseline added; `bun run check` and `bun run hooks:run` passed.                      |
| typescript-6           | done        | Upgrade TypeScript to 6 if Electron/tooling compatibility checks pass.                                                        | TypeScript 6.0.3 installed across workspace; `bun run check`, full frontend tests, frontend/packages/addon builds passed.    |
| electron-scaffold      | done        | Add Electron main/preload shell that can host the existing frontend side-by-side with Tauri.                                  | `apps/electron`; `bun run check`, `bun run build:electron`, Electron tests, adapter tests, and Electron binary check passed. |
| electron-adapter       | done        | Add Electron frontend adapter and typed IPC registry preserving shared adapter APIs.                                          | `BUILD_TARGET=electron`; adapter/core/AI tests, web build, Tauri build, Electron build, and `bun run check` passed.          |
| rust-service-bridge    | in_progress | Connect Electron to existing Rust-backed services, SQLite data dir behavior, and domain event streams.                        | Sidecar lifecycle, account/settings, portfolio, snapshots/imports, activities, goals, and retirement proxy tests passed.     |
| native-parity          | pending     | Replace Tauri native desktop plugins/features with Electron equivalents.                                                      | Pending                                                                                                                      |
| electron-release       | pending     | Replace Tauri desktop packaging/release artifacts with Electron packaging while preserving server prebuilds.                  | Pending                                                                                                                      |
| tauri-cleanup          | pending     | Remove Tauri runtime/dependencies/docs only after Electron parity is verified.                                                | Pending                                                                                                                      |

## Review checkpoints

| Checkpoint                    | Status | Notes                                                                                                            |
| ----------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------- |
| Design self-review            | done   | Refined bridge, data-root, keyring, updater, OAuth, Bun, and TS6 gates.                                          |
| Rubber-duck design review     | done   | Re-review found no blockers for starting PR1/guardrail work.                                                     |
| Code review after first diff  | done   | Code-review found path handling issues in the guardrail test; fixes were re-reviewed with no remaining issues.   |
| Tooling/TS6 milestone review  | done   | PR review found docs/template/CLI/boundary-test gaps; fixes were applied and re-reviewed.                        |
| Electron scaffold review      | done   | Code-review found a startup error-handling gap; the guarded startup fix was re-reviewed with no blockers.        |
| Electron adapter review       | done   | Rubber-duck found web fallback/IPC allowlist risks; code-review found AI streaming zero-event risk; both fixed.  |
| Rust sidecar lifecycle review | done   | Code-review found process lifecycle and cleanup gaps; fixes were applied and re-reviewed with no blockers.       |
| Command proxy smoke review    | done   | Code-review found command error redaction and fail-closed gaps; fixes were re-reviewed with no high issues.      |
| Event bridge review           | done   | Rubber-duck flagged retry/abort/webContents/redaction risks; implementation review found no remaining issues.    |
| Portfolio proxy review        | done   | Code-review found no blocking issues in dashboard command mappings, JSON headers, empty responses, or redaction. |
| Goals proxy review            | done   | Code-review found no blocking issues in goals, funding, plan, or retirement simulation proxy mappings.           |
| Snapshot proxy review         | done   | Code-review found no blocking issues in snapshot query/body mappings, imports, empty responses, or redaction.    |
| Activities proxy review       | done   | Code-review found no blocking issues in activity CRUD/import/template route, body, query, or redaction handling. |

## Non-blocking cautions carried forward

- Remaining bridge work must expand Electron command proxy coverage and connect
  domain events through main-mediated sidecar IPC without exposing sidecar
  URL/token to the renderer.
- Remaining bridge work must factor keyring-backed secret storage out of
  `apps/tauri` without creating a sidecar dependency on the Tauri app crate.
- Verified legacy Tauri data-root paths are recorded in
  `/Users/lachimere/Projects/wealthfolio/docs/architecture/electron-migration.md`.
- PR 2 removed legacy pnpm lockfiles in the Bun migration slice, so there is no
  side-by-side package manager window to guard against.
