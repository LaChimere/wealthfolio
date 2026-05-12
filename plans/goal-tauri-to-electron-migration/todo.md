# Todo

## Active sequence

| ID                     | Status  | Description                                                                                                                   | Evidence                                                                                                 |
| ---------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| migration-state        | done    | Create persistent goal/research/design/plan/todo artifacts and review the decomposition.                                      | `plans/goal-tauri-to-electron-migration/*`; adapter parity test passed                                   |
| architecture-decisions | done    | Verify and document the Rust sidecar, desktop data-root, keyring, updater, and OAuth decisions before Electron scaffold work. | `/Users/lachimere/Projects/wealthfolio/docs/architecture/electron-migration.md`; diff check passed       |
| guardrail-tests        | done    | Strengthen adapter/IPC parity guardrails for an Electron adapter without changing runtime behavior.                           | `apps/frontend/src/adapters/adapter-runtime-boundary.test.ts`; targeted lint/test and code review passed |
| bun-tooling            | done    | Move JS package management/scripts to Bun and introduce Biome/Lefthook with minimal churn.                                    | Bun migration committed; Biome/Lefthook baseline added; `bun run check` and `bun run hooks:run` passed.  |
| typescript-6           | pending | Upgrade TypeScript to 6 if Electron/tooling compatibility checks pass.                                                        | Pending                                                                                                  |
| electron-scaffold      | pending | Add Electron main/preload shell that can host the existing frontend side-by-side with Tauri.                                  | Pending                                                                                                  |
| electron-adapter       | pending | Add Electron frontend adapter and typed IPC registry preserving shared adapter APIs.                                          | Pending                                                                                                  |
| rust-service-bridge    | pending | Connect Electron to existing Rust-backed services, SQLite data dir behavior, and domain event streams.                        | Pending                                                                                                  |
| native-parity          | pending | Replace Tauri native desktop plugins/features with Electron equivalents.                                                      | Pending                                                                                                  |
| electron-release       | pending | Replace Tauri desktop packaging/release artifacts with Electron packaging while preserving server prebuilds.                  | Pending                                                                                                  |
| tauri-cleanup          | pending | Remove Tauri runtime/dependencies/docs only after Electron parity is verified.                                                | Pending                                                                                                  |

## Review checkpoints

| Checkpoint                   | Status | Notes                                                                                                          |
| ---------------------------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| Design self-review           | done   | Refined bridge, data-root, keyring, updater, OAuth, Bun, and TS6 gates.                                        |
| Rubber-duck design review    | done   | Re-review found no blockers for starting PR1/guardrail work.                                                   |
| Code review after first diff | done   | Code-review found path handling issues in the guardrail test; fixes were re-reviewed with no remaining issues. |

## Non-blocking cautions carried forward

- PR 6 must create a desktop sidecar profile/startup builder; `apps/server` is
  not desktop-ready as-is.
- PR 6 must factor keyring-backed secret storage out of `apps/tauri` without
  creating a sidecar dependency on the Tauri app crate.
- Verified legacy Tauri data-root paths are recorded in
  `/Users/lachimere/Projects/wealthfolio/docs/architecture/electron-migration.md`.
- PR 2 removed legacy pnpm lockfiles in the Bun migration slice, so there is no
  side-by-side package manager window to guard against.
