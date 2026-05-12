# Plan

## Approach

Use an adapter-preserving, side-by-side migration. First lock the evidence and contracts, then move JS tooling to Bun/Biome/Lefthook and TypeScript 6, then add Electron next to Tauri, prove Electron adapter/IPC parity, reuse the Rust service graph safely, replace native desktop features and packaging, and remove Tauri only after Electron is verified.

## Execution slices

1. Commit migration state and guardrails.
2. Verify and document the Rust sidecar, data-root, and keyring decisions before Electron scaffold work.
3. Add/adjust parity tests for Electron-ready adapter contracts without behavior changes.
4. Migrate JS package management to Bun and introduce Biome/Lefthook with minimal churn.
5. Upgrade to TypeScript 6 if checks confirm compatibility.
6. Add Electron app scaffold and secure preload bridge.
7. Add Electron frontend adapter and IPC registry with one real command through the bridge.
8. Connect Electron to Rust-backed services and event streams.
9. Implement native desktop feature parity.
10. Replace release packaging with Electron artifacts.
11. Remove Tauri runtime and stale docs/dependencies.

## Review and refinement policy

- Before each major implementation slice, re-read `goal.md`, `research.md`, `design.md`, and `todo.md`.
- Use rubber-duck review for non-trivial design/implementation steps and code-review or `pr-review-toolkit:review-pr` for meaningful diffs.
- Refine until no blocking comments remain, then continue automatically under the user's standing approval.
- Keep commits atomic and mergeable.

## Validation strategy

- Planning/guardrails: `git diff --check`, targeted adapter parity tests.
- Tooling: `bun install`, `bun run check`, `bun run test`, `bun run type-check`.
- Rust/service behavior: `cargo test --workspace`, `cargo clippy --workspace --all-targets --all-features`.
- Electron: Electron dev smoke, build/package checks, IPC/adapter tests, UI/e2e checks when runtime behavior changes.
- Cleanup: repository search for stale Tauri/pnpm references and full relevant checks.

## Notes

- Documentation updates are approved for this migration and should move with the slice that makes them true.
- `AGENTS.md` exists and must be updated when run targets or architecture change.
- Avoid over-design: prefer the current adapter seam and existing Rust services unless evidence requires a different architecture.
