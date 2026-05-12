# Todo

## Active sequence

| ID | Status | Description | Evidence |
|---|---|---|---|
| migration-state | done | Create persistent goal/research/design/plan/todo artifacts and review the decomposition. | `plans/goal-tauri-to-electron-migration/*`; adapter parity test passed |
| architecture-decisions | pending | Verify and document the Rust sidecar, desktop data-root, keyring, updater, and OAuth decisions before Electron scaffold work. | Pending |
| guardrail-tests | pending | Strengthen adapter/IPC parity guardrails for an Electron adapter without changing runtime behavior. | Pending |
| bun-tooling | pending | Move JS package management/scripts to Bun and introduce Biome/Lefthook with minimal churn. | Pending |
| typescript-6 | pending | Upgrade TypeScript to 6 if Electron/tooling compatibility checks pass. | Pending |
| electron-scaffold | pending | Add Electron main/preload shell that can host the existing frontend side-by-side with Tauri. | Pending |
| electron-adapter | pending | Add Electron frontend adapter and typed IPC registry preserving shared adapter APIs. | Pending |
| rust-service-bridge | pending | Connect Electron to existing Rust-backed services, SQLite data dir behavior, and domain event streams. | Pending |
| native-parity | pending | Replace Tauri native desktop plugins/features with Electron equivalents. | Pending |
| electron-release | pending | Replace Tauri desktop packaging/release artifacts with Electron packaging while preserving server prebuilds. | Pending |
| tauri-cleanup | pending | Remove Tauri runtime/dependencies/docs only after Electron parity is verified. | Pending |

## Review checkpoints

| Checkpoint | Status | Notes |
|---|---|---|
| Design self-review | done | Refined bridge, data-root, keyring, updater, OAuth, Bun, and TS6 gates. |
| Rubber-duck design review | done | Re-review found no blockers for starting PR1/guardrail work. |
| Code review after first diff | pending | Run code-review or `pr-review-toolkit:review-pr` before committing the first code changes. |

## Non-blocking cautions carried forward

- PR 6 must create a desktop sidecar profile/startup builder; `apps/server` is not desktop-ready as-is.
- PR 6 must factor keyring-backed secret storage out of `apps/tauri` without creating a sidecar dependency on the Tauri app crate.
- PR 4 or earlier must write verified legacy Tauri data-root paths for macOS, Windows, and Linux before Electron initializes a data directory.
- PR 2 must prevent pnpm/Bun lockfile drift during any temporary side-by-side package manager window.
