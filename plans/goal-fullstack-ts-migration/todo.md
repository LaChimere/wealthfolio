# Task Checklist

> Purpose: execution-phase checklist derived from
> `plans/goal-fullstack-ts-migration/plan.md`. Treat this as the progress truth
> source.

## Task

- Summary: Migrate Wealthfolio from Electron + Rust sidecar/backend to
  full-stack TypeScript/Bun.
- Links:
  - `plans/goal-fullstack-ts-migration/goal.md`
  - `plans/goal-fullstack-ts-migration/research.md`
  - `plans/goal-fullstack-ts-migration/design.md`

## Plan Reference

- Plan version/date: pending Gate 1 design approval.
- Approved by (if applicable): pending.

## Checklist

### Preparation

- [x] Register persistent goal state.
  - Evidence: `plans/goal-fullstack-ts-migration/goal.md`
- [x] Capture initial architecture research and migration constraints.
  - Evidence: `plans/goal-fullstack-ts-migration/research.md`
- [x] Draft staged PR decomposition/design.
  - Evidence: `plans/goal-fullstack-ts-migration/design.md`
- [ ] Gate 1: approve design before implementation planning.
  - Evidence: pending.

### Implementation

- [ ] PR 1: TS backend contract foundation.
  - Acceptance criteria: current command/API surface is represented in typed TS
    contracts and parity harness smoke coverage exists without runtime changes.
  - Evidence: pending.
- [ ] PR 2: TS backend runtime skeleton.
  - Acceptance criteria: guarded TS backend skeleton supports health/readiness,
    sidecar-token/auth parity, and Electron lifecycle tests while Rust remains
    default.
  - Evidence: pending.
- [ ] PR 3: TS SQLite foundation.
  - Acceptance criteria: TS storage can open existing DBs, preserve migration
    history/PRAGMAs, and pass read/backup/restore parity fixtures.
  - Evidence: pending.
- [ ] PR 4: Cross-cutting compatibility preflights.
  - Acceptance criteria: keyring service IDs, addon canary, command registry
    classification, and mixed-version sync fixture requirements are documented
    and tested without runtime behavior changes.
  - Evidence: pending.
- [ ] PR 5+: Domain vertical slices.
  - Acceptance criteria: each migrated domain has Rust-vs-TS parity for reads,
    writes, validation, errors, events, and adapter behavior while remaining
    inert for production until TS cutover.
  - Evidence: pending.
- [ ] PR 8: Default TS backend cutover.
  - Acceptance criteria: Electron and web use TS backend by default with
    rollback/fallback documented for stabilization plus benchmark gates.
  - Evidence: pending.
- [ ] PR 9: Rust removal cleanup.
  - Acceptance criteria: Rust runtime/build/release paths are removed after TS
    parity and docs describe TS-only architecture.
  - Evidence: pending.

### Acceptance Gate (before proposing PR)

- [ ] All acceptance criteria above are met with evidence.
- [ ] Diff is consistent with approved plan (no scope creep, no missing pieces).
- [ ] Applicable verification level executed.

If any check fails, follow the recovery flow defined in the active framework
contract:

1. Can fix directly -> fix and re-verify
2. Plan is infeasible -> update `plan.md`, re-submit for Gate 2
3. Design is invalid -> update `design.md`, re-submit for Gate 1 -> Gate 2
4. Stuck -> stop and report to user with evidence of what was attempted

### Verification (Evidence)

- [ ] Run lint/typecheck: `bun run check` (attach output/excerpt).
- [ ] Run unit tests: targeted TS backend/domain tests (attach output/excerpt).
- [ ] Run integration/e2e or before/after check: parity harness and selected
      Electron/web smoke flows (attach proof).
- [ ] Capture logs/metrics for performance-sensitive calculation/import slices.

### Review / Packaging

- [ ] Summarize changes (what/why).
- [ ] Confirm no scope creep / unrelated cleanup.
- [ ] Check whether related docs need updating.
- [ ] Prepare PR description / changelog notes (if applicable).

## Evidence Log

- `research/decomposition`: initial evidence and PR sequence recorded in
  `research.md` and `design.md`.

## Result

- Outcome: pending.
- Follow-ups: resolve Gate 1 design approval, then translate design into
  `plan.md` and implementation todos.
