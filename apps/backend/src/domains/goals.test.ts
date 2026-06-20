import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { createGoalRepository, createGoalService, type Goal, type GoalSyncEvent } from "./goals";

describe("TS goals domain", () => {
  test("lists goals by priority and maps zero target amounts to null", () => {
    const db = createGoalsDb();
    const service = createGoalService(createGoalRepository(db));

    try {
      seedGoal(db, { id: "low", title: "Low", priority: 1, targetAmount: 0 });
      seedGoal(db, { id: "high", title: "High", priority: 10, targetAmount: 500 });
      seedGoalPlan(db, {
        goalId: "high",
        planKind: "save_up",
        settingsJson: '{"monthlyContribution":100}',
      });

      expect(service.getGoals().map((goal) => goal.id)).toEqual(["high", "low"]);
      expect(service.getGoal("low")).toMatchObject({ targetAmount: null });
      expect(service.getGoalPlan("high")).toMatchObject({
        goalId: "high",
        planKind: "save_up",
        version: 1,
      });
      expect(service.getGoalPlan("missing")).toBeNull();
    } finally {
      db.close();
    }
  });

  test("creates goals with Rust-compatible defaults, generated IDs, base currency, and sync", async () => {
    const db = createGoalsDb();
    const syncEvents: GoalSyncEvent[] = [];
    const service = createGoalService(
      createGoalRepository(db, { queueSyncEvent: (event) => syncEvents.push(event) }),
      { baseCurrency: "USD" },
    );

    try {
      const created = await service.createGoal({
        id: "ignored",
        goalType: "custom_save_up",
        title: "Emergency Fund",
        targetAmount: null,
        currency: service.getBaseCurrency(),
      });

      expect(created).toMatchObject({
        goalType: "custom_save_up",
        title: "Emergency Fund",
        targetAmount: null,
        statusLifecycle: "active",
        statusHealth: "not_applicable",
        priority: 0,
        currency: "USD",
      });
      expect(created.id).not.toBe("ignored");
      expect(syncEvents).toEqual([
        expect.objectContaining({
          entity: "goals",
          entityId: created.id,
          operation: "Create",
          payload: expect.objectContaining({ targetAmount: 0 }),
        }),
      ]);
      await expect(
        service.createGoal({
          goalType: "custom_save_up",
          title: "Bad Status",
          statusLifecycle: "paused",
        }),
      ).rejects.toThrow("Unsupported goal lifecycle 'paused'");
      await expect(
        service.createGoal({
          goalType: "custom_save_up",
          title: "Bad Priority",
          priority: 4.5,
        }),
      ).rejects.toThrow("Priority must be an integer between -2147483648 and 2147483647");
      await expect(
        service.createGoal({
          goalType: "custom_save_up",
          title: "Bad Priority",
          priority: 2_147_483_648,
        }),
      ).rejects.toThrow("Priority must be an integer between -2147483648 and 2147483647");
      await expect(
        service.createGoal({
          goalType: "custom_save_up",
          title: "Bad Target",
          targetAmount: Number.POSITIVE_INFINITY,
        }),
      ).rejects.toThrow("targetAmount must be a finite number");
      expect(syncEvents).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  test("creates retirement goals with seeded funding rules and single-goal guard", async () => {
    const db = createGoalsDb();
    const service = createGoalService(createGoalRepository(db), {
      accountProvider: {
        getActiveNonArchivedAccounts: () => [
          { id: "brokerage", accountType: "SECURITIES" },
          { id: "cash", accountType: "CASH" },
          { id: "property", accountType: "REAL_ESTATE" },
        ],
      },
    });

    try {
      seedGoal(db, { id: "save-up", title: "Car", priority: 2, statusLifecycle: "active" });
      seedFundingRule(db, {
        id: "existing-share",
        goalId: "save-up",
        accountId: "brokerage",
        sharePercent: 25,
      });

      const created = await service.createGoal({
        goalType: "retirement",
        title: "Retirement",
      });
      expect(created.goalType).toBe("retirement");
      expect(service.getGoalFunding(created.id)).toEqual([
        expect.objectContaining({ accountId: "brokerage", sharePercent: 75 }),
        expect.objectContaining({ accountId: "cash", sharePercent: 100 }),
      ]);

      await expect(
        service.createGoal({ goalType: "retirement", title: "Second Retirement" }),
      ).rejects.toThrow("Only one active retirement goal is allowed");
    } finally {
      db.close();
    }
  });

  test("updates goals with lifecycle/type guards, preserved created_at, and new updated_at", async () => {
    const db = createGoalsDb();
    const service = createGoalService(createGoalRepository(db));

    try {
      seedGoal(db, {
        id: "goal-1",
        title: "Original",
        goalType: "custom_save_up",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      });

      const original = service.getGoal("goal-1");
      await expect(service.updateGoal({ ...original, goalType: "retirement" })).rejects.toThrow(
        "Goal type cannot be changed after creation",
      );

      const updated = await service.updateGoal({
        ...original,
        title: "Updated",
        statusLifecycle: "achieved",
        summaryCurrentValue: 25,
      });
      expect(updated).toMatchObject({
        id: "goal-1",
        title: "Updated",
        createdAt: "2026-01-01T00:00:00Z",
        summaryCurrentValue: 25,
      });
      expect(updated.updatedAt).not.toBe("2026-01-01T00:00:00Z");
      await expect(service.updateGoal({ ...updated, priority: 4.5 })).rejects.toThrow(
        "Priority must be an integer between -2147483648 and 2147483647",
      );
      await expect(service.updateGoal({ ...updated, priority: -2_147_483_649 })).rejects.toThrow(
        "Priority must be an integer between -2147483648 and 2147483647",
      );
      await expect(service.updateGoal({ ...updated, targetAmount: Number.NaN })).rejects.toThrow(
        "targetAmount must be a finite number",
      );
      await expect(
        service.updateGoal({ ...updated, summaryProgress: Number.POSITIVE_INFINITY }),
      ).rejects.toThrow("summaryProgress must be a finite number");
    } finally {
      db.close();
    }
  });

  test("saves funding rules with duplicate, capacity, tax bucket, and DC-link guards", async () => {
    const db = createGoalsDb();
    const service = createGoalService(createGoalRepository(db));

    try {
      seedGoal(db, { id: "active-other", title: "Other", statusLifecycle: "active" });
      seedGoal(db, { id: "save-up", title: "Save Up", goalType: "custom_save_up" });
      seedGoal(db, { id: "retirement", title: "Retirement", goalType: "retirement" });
      seedFundingRule(db, {
        id: "existing-share",
        goalId: "active-other",
        accountId: "brokerage",
        sharePercent: 80,
      });
      seedGoalPlan(db, {
        goalId: "retirement",
        planKind: "retirement",
        settingsJson: JSON.stringify({
          incomeStreams: [{ linkedAccountId: "pension" }],
        }),
      });

      await expect(
        service.saveGoalFunding("save-up", [
          { accountId: "brokerage", sharePercent: 10 },
          { accountId: "brokerage", sharePercent: 5 },
        ]),
      ).rejects.toThrow("Duplicate account 'brokerage'");
      await expect(
        service.saveGoalFunding("save-up", [{ accountId: "brokerage", sharePercent: 25 }]),
      ).rejects.toThrow(
        "Account 'brokerage' is overallocated: requested 25.0%, used elsewhere 80.0%, max available 20.0%",
      );
      await expect(
        service.saveGoalFunding("retirement", [
          { accountId: "cash", sharePercent: 10, taxBucket: "bad" },
        ]),
      ).rejects.toThrow("Unsupported tax bucket 'bad'");
      await expect(
        service.saveGoalFunding("retirement", [
          { accountId: "pension", sharePercent: 10, taxBucket: "tax_deferred" },
        ]),
      ).rejects.toThrow("linked to a pension fund");

      const saved = await service.saveGoalFunding("save-up", [
        { accountId: "brokerage", sharePercent: 20, taxBucket: "taxable" },
        { accountId: "cash", sharePercent: 100, taxBucket: "tax_free" },
      ]);
      expect(saved).toEqual([
        expect.objectContaining({ accountId: "brokerage", sharePercent: 20, taxBucket: null }),
        expect.objectContaining({ accountId: "cash", sharePercent: 100, taxBucket: null }),
      ]);
    } finally {
      db.close();
    }
  });

  test("saves and deletes save-up goal plans with versioning, sync, and unknown field preservation", async () => {
    const db = createGoalsDb();
    const syncEvents: GoalSyncEvent[] = [];
    const service = createGoalService(
      createGoalRepository(db, { queueSyncEvent: (event) => syncEvents.push(event) }),
    );

    try {
      seedGoal(db, { id: "goal-1", title: "Goal" });

      const settingsJson = JSON.stringify({
        monthlyContribution: 100,
        frontendOnly: { id: "draft-1", flags: ["keep"] },
      });
      const saved = await service.saveGoalPlan({
        goalId: "goal-1",
        planKind: "save_up",
        settingsJson,
        summaryJson: null,
      });
      expect(saved).toMatchObject({
        goalId: "goal-1",
        planKind: "save_up",
        plannerMode: null,
        settingsJson,
        summaryJson: "{}",
        version: 1,
      });

      const updatedSettingsJson = JSON.stringify({
        monthlyContribution: 125,
        frontendOnly: { id: "draft-1", flags: ["keep", "updated"] },
      });
      const updated = await service.saveGoalPlan({
        goalId: "goal-1",
        planKind: "save_up",
        settingsJson: updatedSettingsJson,
        summaryJson: '{"progress":0.25}',
      });
      expect(updated).toMatchObject({
        goalId: "goal-1",
        version: 2,
        createdAt: saved.createdAt,
        settingsJson: updatedSettingsJson,
        summaryJson: '{"progress":0.25}',
      });
      expect(JSON.parse(updated.settingsJson).frontendOnly.flags).toEqual(["keep", "updated"]);
      expect(syncEvents.map((event) => `${event.entity}:${event.operation}`)).toEqual([
        "goal_plans:Create",
        "goal_plans:Update",
      ]);

      await expect(service.deleteGoalPlan("goal-1")).resolves.toBe(1);
      await expect(service.deleteGoalPlan("goal-1")).resolves.toBe(0);
      expect(syncEvents.at(-1)).toEqual({
        entity: "goal_plans",
        entityId: "goal-1",
        operation: "Delete",
        payload: { id: "goal-1" },
      });
      expect(syncEvents.filter((event) => event.entity === "goal_plans")).toHaveLength(3);
    } finally {
      db.close();
    }
  });

  test("validates bounded goal plan save scope", async () => {
    const db = createGoalsDb();
    const service = createGoalService(createGoalRepository(db));

    try {
      seedGoal(db, { id: "save-up", title: "Save Up", goalType: "custom_save_up" });
      seedGoal(db, { id: "retirement", title: "Retirement", goalType: "retirement" });

      await expect(
        service.saveGoalPlan({
          goalId: "missing",
          planKind: "save_up",
          settingsJson: "{}",
        }),
      ).rejects.toThrow("Record not found: goal missing");
      await expect(
        service.saveGoalPlan({
          goalId: "save-up",
          planKind: "retirement",
          settingsJson: "{}",
        }),
      ).rejects.toThrow("Plan kind 'retirement' is not valid for goal type 'custom_save_up'");
      await expect(
        service.saveGoalPlan({
          goalId: "save-up",
          planKind: "save_up",
          plannerMode: "fire",
          settingsJson: "{}",
        }),
      ).rejects.toThrow("planner_mode is only valid for retirement plans");
      await expect(
        service.saveGoalPlan({
          goalId: "retirement",
          planKind: "retirement",
          settingsJson: "{",
        }),
      ).rejects.toThrow("Invalid retirement plan JSON");
    } finally {
      db.close();
    }
  });

  test("computes save-up overviews from funding valuations and plan settings", async () => {
    const db = createGoalsDb();
    const service = createGoalService(createGoalRepository(db), {
      now: () => new Date(2024, 0, 1, 12),
    });

    try {
      seedGoal(db, {
        id: "save-up",
        title: "House",
        targetAmount: 100_000,
        targetDate: "2034-01-01",
      });
      seedFundingRule(db, {
        id: "brokerage-rule",
        goalId: "save-up",
        accountId: "brokerage",
        sharePercent: 50,
      });
      seedFundingRule(db, {
        id: "cash-rule",
        goalId: "save-up",
        accountId: "cash",
        sharePercent: 25,
      });
      seedFundingRule(db, {
        id: "missing-rule",
        goalId: "save-up",
        accountId: "missing",
        sharePercent: 100,
      });
      seedGoalPlan(db, {
        goalId: "save-up",
        planKind: "save_up",
        settingsJson: JSON.stringify({
          monthlyContribution: 600,
          expectedAnnualReturn: 0.07,
        }),
      });

      const overview = await service.computeSaveUpOverview("save-up", {
        brokerage: 80_000,
        cash: 40_000,
      });

      expect(overview.currentValue).toBe(50_000);
      expect(overview.targetAmount).toBe(100_000);
      expect(overview.progress).toBe(0.5);
      expect(overview.health).toBe("on_track");
      expect(overview.projectedValueAtTargetDate).toBeGreaterThan(100_000);
      expect(overview.trajectory.at(0)?.date).toBe("2024-01");
      expect(overview.trajectory.at(-1)?.date).toBe("2034-01");
    } finally {
      db.close();
    }
  });

  test("uses Rust-compatible save-up overview defaults and settings parsing", async () => {
    const db = createGoalsDb();
    const service = createGoalService(createGoalRepository(db), {
      now: () => new Date(2024, 0, 1, 12),
    });

    try {
      seedGoal(db, {
        id: "default-plan",
        title: "Defaults",
        targetAmount: 10_000,
        targetDate: null,
      });
      const defaultOverview = await service.computeSaveUpOverview(
        "default-plan",
        new Map([["cash", 10_000]]),
      );
      expect(defaultOverview).toMatchObject({
        currentValue: 0,
        targetAmount: 10_000,
        health: "not_applicable",
        projectedCompletionDate: null,
      });

      seedGoal(db, {
        id: "nonnumeric-settings",
        title: "Nonnumeric Settings",
        targetAmount: 10_000,
        targetDate: "2025-01-01",
      });
      seedGoalPlan(db, {
        goalId: "nonnumeric-settings",
        planKind: "save_up",
        settingsJson: JSON.stringify({
          monthlyContribution: "100",
          expectedAnnualReturn: "0",
        }),
      });
      const nonnumericOverview = await service.computeSaveUpOverview("nonnumeric-settings", {});
      expect(nonnumericOverview.currentValue).toBe(0);
      expect(nonnumericOverview.projectedValueAtTargetDate).toBe(0);
      expect(nonnumericOverview.requiredMonthlyContribution).toBeGreaterThan(800);

      seedGoal(db, {
        id: "zero-settings",
        title: "Zero Settings",
        targetAmount: 10_000,
        targetDate: "2025-01-01",
      });
      seedGoalPlan(db, {
        goalId: "zero-settings",
        planKind: "save_up",
        settingsJson: JSON.stringify({
          monthlyContribution: 0,
          expectedAnnualReturn: 0,
        }),
      });
      const zeroOverview = await service.computeSaveUpOverview("zero-settings", {});
      expect(zeroOverview.requiredMonthlyContribution).toBe(834);
    } finally {
      db.close();
    }
  });

  test("preserves archived save-up summary current value fallback semantics", async () => {
    const db = createGoalsDb();
    const service = createGoalService(createGoalRepository(db), {
      now: () => new Date(2024, 0, 1, 12),
    });

    try {
      seedGoal(db, {
        id: "archived-zero",
        title: "Archived Zero",
        statusLifecycle: "archived",
        targetAmount: 10_000,
        summaryCurrentValue: 0,
      });
      seedFundingRule(db, {
        id: "archived-zero-rule",
        goalId: "archived-zero",
        accountId: "cash",
        sharePercent: 100,
      });
      await expect(
        service.computeSaveUpOverview("archived-zero", { cash: 5_000 }),
      ).resolves.toMatchObject({
        currentValue: 0,
      });

      seedGoal(db, {
        id: "archived-null",
        title: "Archived Null",
        statusLifecycle: "archived",
        targetAmount: 10_000,
        summaryCurrentValue: null,
      });
      seedFundingRule(db, {
        id: "archived-null-rule",
        goalId: "archived-null",
        accountId: "cash",
        sharePercent: 100,
      });
      await expect(
        service.computeSaveUpOverview("archived-null", { cash: 5_000 }),
      ).resolves.toMatchObject({
        currentValue: 5_000,
      });
    } finally {
      db.close();
    }
  });

  test("propagates malformed save-up overview settings JSON", async () => {
    const db = createGoalsDb();
    const service = createGoalService(createGoalRepository(db));

    try {
      seedGoal(db, { id: "bad-plan", title: "Bad Plan" });
      seedGoalPlan(db, {
        goalId: "bad-plan",
        planKind: "save_up",
        settingsJson: "{",
      });

      await expect(service.computeSaveUpOverview("bad-plan", {})).rejects.toThrow();
    } finally {
      db.close();
    }
  });

  test("refreshes non-retirement goal summaries with Rust-compatible health thresholds", async () => {
    const db = createGoalsDb();
    const service = createGoalService(createGoalRepository(db));

    try {
      const cases = [
        ["on-track", 10_000, "on_track"],
        ["at-risk", 9_000, "at_risk"],
        ["off-track", 8_999, "off_track"],
      ] as const;

      for (const [goalId, projectedValueAtTargetDate, statusHealth] of cases) {
        seedGoal(db, {
          id: goalId,
          title: goalId,
          targetAmount: 10_000,
          projectedCompletionDate: "2026-06-01",
          projectedValueAtTargetDate,
          summaryTargetAmount: 1,
        });
        seedFundingRule(db, {
          id: `${goalId}-rule`,
          goalId,
          accountId: "cash",
          sharePercent: 50,
        });

        const refreshed = await service.refreshGoalSummary(goalId, { cash: 10_000 });
        expect(refreshed).toMatchObject({
          summaryTargetAmount: 10_000,
          summaryCurrentValue: 5_000,
          summaryProgress: 0.5,
          projectedCompletionDate: "2026-06-01",
          projectedValueAtTargetDate,
          statusHealth,
        });
      }
    } finally {
      db.close();
    }
  });

  test("refreshes non-retirement goal summaries with target and lifecycle fallback parity", async () => {
    const db = createGoalsDb();
    const service = createGoalService(createGoalRepository(db));

    try {
      seedGoal(db, {
        id: "summary-target-fallback",
        title: "Summary Target",
        targetAmount: 0,
        summaryTargetAmount: 5_000,
        projectedValueAtTargetDate: 5_000,
      });
      seedFundingRule(db, {
        id: "summary-target-rule",
        goalId: "summary-target-fallback",
        accountId: "cash",
        sharePercent: 100,
      });
      await expect(
        service.refreshGoalSummary("summary-target-fallback", { cash: 2_500 }),
      ).resolves.toMatchObject({
        summaryTargetAmount: 5_000,
        summaryCurrentValue: 2_500,
        summaryProgress: 0.5,
        statusHealth: "on_track",
      });

      seedGoal(db, {
        id: "achieved-stored-zero",
        title: "Achieved Stored Zero",
        statusLifecycle: "achieved",
        targetAmount: 10_000,
        summaryCurrentValue: 0,
        projectedValueAtTargetDate: null,
      });
      seedFundingRule(db, {
        id: "achieved-stored-zero-rule",
        goalId: "achieved-stored-zero",
        accountId: "cash",
        sharePercent: 100,
      });
      await expect(
        service.refreshGoalSummary("achieved-stored-zero", { cash: 10_000 }),
      ).resolves.toMatchObject({
        summaryCurrentValue: 0,
        statusHealth: "on_track",
      });

      seedGoal(db, {
        id: "achieved-null-current",
        title: "Achieved Null Current",
        statusLifecycle: "achieved",
        targetAmount: 10_000,
        summaryCurrentValue: null,
        projectedValueAtTargetDate: null,
      });
      seedFundingRule(db, {
        id: "achieved-null-current-rule",
        goalId: "achieved-null-current",
        accountId: "cash",
        sharePercent: 100,
      });
      await expect(
        service.refreshGoalSummary("achieved-null-current", { cash: 7_500 }),
      ).resolves.toMatchObject({
        summaryCurrentValue: 7_500,
        summaryProgress: 0.75,
        statusHealth: "on_track",
      });
    } finally {
      db.close();
    }
  });

  test("refreshes retirement summaries without plans and from plan-backed overviews", async () => {
    const db = createGoalsDb();
    const service = createGoalService(createGoalRepository(db), {
      now: () => new Date("2026-01-15T12:00:00Z"),
    });

    try {
      seedGoal(db, {
        id: "retirement-no-plan",
        title: "Retirement No Plan",
        goalType: "retirement",
        targetAmount: 100_000,
        projectedCompletionDate: "2040-01-01",
        projectedValueAtTargetDate: 200_000,
      });
      seedFundingRule(db, {
        id: "retirement-no-plan-rule",
        goalId: "retirement-no-plan",
        accountId: "brokerage",
        sharePercent: 25,
      });
      await expect(
        service.refreshGoalSummary("retirement-no-plan", { brokerage: 80_000 }),
      ).resolves.toMatchObject({
        summaryTargetAmount: null,
        summaryCurrentValue: 20_000,
        summaryProgress: null,
        projectedCompletionDate: null,
        projectedValueAtTargetDate: null,
        statusHealth: "not_applicable",
      });

      seedGoal(db, {
        id: "retirement-plan",
        title: "Retirement Plan",
        goalType: "retirement",
      });
      seedGoalPlan(db, {
        goalId: "retirement-plan",
        planKind: "retirement",
        plannerMode: "traditional",
        settingsJson: JSON.stringify(validRetirementPlan({ tax: null })),
      });
      seedFundingRule(db, {
        id: "retirement-plan-rule",
        goalId: "retirement-plan",
        accountId: "brokerage",
        sharePercent: 50,
      });

      const overview = await service.computeRetirementOverview("retirement-plan", {
        brokerage: 200_000,
      });
      const refreshed = await service.refreshGoalSummary("retirement-plan", {
        brokerage: 200_000,
      });
      expect(refreshed).toMatchObject({
        summaryTargetAmount: overview.requiredCapitalAtGoalAge,
        summaryCurrentValue: 100_000,
        projectedCompletionDate: "2036-01-15",
        projectedValueAtTargetDate: overview.portfolioAtGoalAge,
      });
      expect(refreshed.summaryProgress).toBeGreaterThan(0);
      expect(["on_track", "at_risk", "off_track"]).toContain(refreshed.statusHealth);

      seedGoal(db, {
        id: "retirement-unreachable",
        title: "Retirement Unreachable",
        goalType: "retirement",
        summaryTargetAmount: 123_456,
      });
      seedGoalPlan(db, {
        goalId: "retirement-unreachable",
        planKind: "retirement",
        settingsJson: JSON.stringify(
          validRetirementPlan({
            expenses: {
              items: [{ id: "huge", label: "Huge", monthlyAmount: Number.MAX_VALUE / 4 }],
            },
          }),
        ),
      });
      const unreachable = await service.refreshGoalSummary("retirement-unreachable", {});
      expect(unreachable).toMatchObject({
        summaryTargetAmount: 123_456,
        summaryCurrentValue: 0,
        summaryProgress: 0,
      });
    } finally {
      db.close();
    }
  });

  test("saves retirement goal plans with validation, age normalization, sync, and unknown preservation", async () => {
    const db = createGoalsDb();
    const syncEvents: GoalSyncEvent[] = [];
    const service = createGoalService(
      createGoalRepository(db, { queueSyncEvent: (event) => syncEvents.push(event) }),
      { now: () => new Date("2026-04-21T12:00:00Z") },
    );

    try {
      seedGoal(db, { id: "retirement", title: "Retirement", goalType: "retirement" });
      const settings = validRetirementPlan({
        personal: {
          birthYearMonth: "1981-04",
          currentAge: 1,
          targetRetirementAge: 55,
          planningHorizonAge: 90,
          frontendOnlyPersonal: true,
        },
        frontendOnly: { draftId: "draft-1", flags: ["keep"] },
      });

      const saved = await service.saveGoalPlan({
        goalId: "retirement",
        planKind: "retirement",
        plannerMode: "traditional",
        settingsJson: JSON.stringify(settings),
        summaryJson: '{"status":"draft"}',
      });
      const persisted = JSON.parse(saved.settingsJson);

      expect(saved).toMatchObject({
        goalId: "retirement",
        planKind: "retirement",
        plannerMode: "traditional",
        summaryJson: '{"status":"draft"}',
        version: 1,
      });
      expect(persisted.personal.currentAge).toBe(45);
      expect(persisted.personal.frontendOnlyPersonal).toBe(true);
      expect(persisted.frontendOnly).toEqual({ draftId: "draft-1", flags: ["keep"] });
      expect(syncEvents).toEqual([
        expect.objectContaining({
          entity: "goal_plans",
          entityId: "retirement",
          operation: "Create",
          payload: expect.objectContaining({ planKind: "retirement" }),
        }),
      ]);
    } finally {
      db.close();
    }
  });

  test("normalizes retirement current age only for valid birth year-month values", async () => {
    const db = createGoalsDb();
    const service = createGoalService(createGoalRepository(db), {
      now: () => new Date("2026-04-21T12:00:00Z"),
    });

    try {
      const cases = [
        ["no-birth", undefined, 44],
        ["valid-before-birthday", "1981-05", 44],
        ["bad-month", "1981-13", 44],
        ["future-year", "2027-01", 44],
      ] as const;

      for (const [goalId, birthYearMonth, expectedAge] of cases) {
        seedGoal(db, { id: goalId, title: goalId, goalType: "retirement" });
        const personal = { currentAge: 44, targetRetirementAge: 55, planningHorizonAge: 90 };
        const settings =
          birthYearMonth === undefined
            ? validRetirementPlan({ personal })
            : validRetirementPlan({ personal: { ...personal, birthYearMonth } });
        const saved = await service.saveGoalPlan({
          goalId,
          planKind: "retirement",
          settingsJson: JSON.stringify(settings),
        });
        expect(JSON.parse(saved.settingsJson).personal.currentAge).toBe(expectedAge);
      }
    } finally {
      db.close();
    }
  });

  test("rejects retirement goal plans with duplicate or already participating DC account links", async () => {
    const db = createGoalsDb();
    const service = createGoalService(createGoalRepository(db));

    try {
      seedGoal(db, { id: "retirement", title: "Retirement", goalType: "retirement" });
      await expect(
        service.saveGoalPlan({
          goalId: "retirement",
          planKind: "retirement",
          settingsJson: JSON.stringify(
            validRetirementPlan({
              incomeStreams: [
                definedContributionStream({ id: "dc-1", linkedAccountId: "pension" }),
                definedContributionStream({ id: "dc-2", linkedAccountId: "pension" }),
              ],
            }),
          ),
        }),
      ).rejects.toThrow("Duplicate linked account 'pension' across DC income streams");
      await expect(
        service.saveGoalPlan({
          goalId: "retirement",
          planKind: "retirement",
          settingsJson: JSON.stringify(
            validRetirementPlan({
              incomeStreams: [
                definedContributionStream({ id: "dc-empty-1", linkedAccountId: "" }),
                definedContributionStream({ id: "dc-empty-2", linkedAccountId: "" }),
              ],
            }),
          ),
        }),
      ).rejects.toThrow("Duplicate linked account '' across DC income streams");

      seedFundingRule(db, {
        id: "participating",
        goalId: "retirement",
        accountId: "brokerage",
        sharePercent: 50,
      });
      await expect(
        service.saveGoalPlan({
          goalId: "retirement",
          planKind: "retirement",
          settingsJson: JSON.stringify(
            validRetirementPlan({
              incomeStreams: [definedContributionStream({ linkedAccountId: "brokerage" })],
            }),
          ),
        }),
      ).rejects.toThrow(
        "Account 'brokerage' has participating goal shares and cannot be linked as DC",
      );
    } finally {
      db.close();
    }
  });

  test("rejects invalid retirement plan settings with Rust-compatible validation errors", async () => {
    const db = createGoalsDb();
    const service = createGoalService(createGoalRepository(db));

    try {
      seedGoal(db, { id: "retirement", title: "Retirement", goalType: "retirement" });
      const cases = [
        [
          "age-horizon",
          validRetirementPlan({
            personal: { currentAge: 90, targetRetirementAge: 91, planningHorizonAge: 90 },
          }),
          "Current age must be less than planning horizon",
        ],
        [
          "target-age",
          validRetirementPlan({
            personal: { currentAge: 45, targetRetirementAge: 45, planningHorizonAge: 90 },
          }),
          "Target retirement age must be after current age",
        ],
        [
          "expense-range",
          validRetirementPlan({
            expenses: { items: [{ monthlyAmount: 5000, startAge: 70, endAge: 65 }] },
          }),
          "Spending To age must be after From age",
        ],
        [
          "return-range",
          validRetirementPlan({
            investment: { preRetirementAnnualReturn: 0.75 },
          }),
          "Return before retirement must be between -20% and 50%",
        ],
        [
          "missing-required",
          (() => {
            const plan = validRetirementPlan();
            delete (plan.personal as Record<string, unknown>).currentAge;
            return plan;
          })(),
          "personal.currentAge must be a non-negative integer",
        ],
      ] as const;

      for (const [label, settings, message] of cases) {
        await expect(
          service.saveGoalPlan({
            goalId: "retirement",
            planKind: "retirement",
            settingsJson: JSON.stringify(settings),
          }),
        ).rejects.toThrow(message);
      }
    } finally {
      db.close();
    }
  });

  test("prepares retirement inputs with Rust-compatible portfolio, tax buckets, and mode defaults", async () => {
    const db = createGoalsDb();
    const service = createGoalService(createGoalRepository(db));

    try {
      seedGoal(db, { id: "retirement", title: "Retirement", goalType: "retirement" });
      seedGoalPlan(db, {
        goalId: "retirement",
        planKind: "retirement",
        settingsJson: JSON.stringify(validRetirementPlan({ tax: null })),
      });
      seedFundingRule(db, {
        id: "brokerage-rule",
        goalId: "retirement",
        accountId: "brokerage",
        sharePercent: 50,
        taxBucket: "taxable",
      });
      seedFundingRule(db, {
        id: "rrsp-rule",
        goalId: "retirement",
        accountId: "rrsp",
        sharePercent: 100,
        taxBucket: "tax_deferred",
      });
      seedFundingRule(db, {
        id: "tfsa-rule",
        goalId: "retirement",
        accountId: "tfsa",
        sharePercent: 25,
        taxBucket: "tax-free",
      });
      seedFundingRule(db, {
        id: "debt-rule",
        goalId: "retirement",
        accountId: "debt",
        sharePercent: 100,
        taxBucket: "taxable",
      });

      const prepared = await service.prepareRetirementInput("retirement", {
        brokerage: 100_000,
        rrsp: 20_000,
        tfsa: 40_000,
        debt: -5_000,
      });

      expect(prepared.currentPortfolio).toBe(75_000);
      expect(prepared.plannerMode).toBe("fire");
      expect(prepared.plan.tax).toEqual({
        taxableWithdrawalRate: 0,
        taxDeferredWithdrawalRate: 0,
        taxFreeWithdrawalRate: 0,
        withdrawalBuckets: {
          taxable: 50_000,
          taxDeferred: 20_000,
          taxFree: 10_000,
        },
      });
    } finally {
      db.close();
    }
  });

  test("computes retirement overview from stored plans and planner mode", async () => {
    const db = createGoalsDb();
    const service = createGoalService(createGoalRepository(db));

    try {
      seedGoal(db, { id: "retirement", title: "Retirement", goalType: "retirement" });
      seedGoalPlan(db, {
        goalId: "retirement",
        planKind: "retirement",
        plannerMode: "traditional",
        settingsJson: JSON.stringify(validRetirementPlan({ tax: null })),
      });
      seedFundingRule(db, {
        id: "brokerage-rule",
        goalId: "retirement",
        accountId: "brokerage",
        sharePercent: 50,
        taxBucket: "taxable",
      });

      const overview = await service.computeRetirementOverview("retirement", {
        brokerage: 200_000,
      });

      expect(overview).toMatchObject({
        analysisMode: "traditional",
        portfolioNow: 100_000,
        taxBucketBalances: {
          taxable: 100_000,
          taxDeferred: 0,
          taxFree: 0,
        },
        targetReconciliation: {
          targetAge: 55,
        },
      });
    } finally {
      db.close();
    }
  });

  test("rejects retirement input preparation for non-retirement goals and missing plans", async () => {
    const db = createGoalsDb();
    const service = createGoalService(createGoalRepository(db));

    try {
      seedGoal(db, { id: "save-up", title: "Save Up" });
      await expect(service.prepareRetirementInput("save-up", {})).rejects.toThrow(
        "Goal save-up is not a retirement goal",
      );

      seedGoal(db, { id: "retirement", title: "Retirement", goalType: "retirement" });
      await expect(service.prepareRetirementInput("retirement", {})).rejects.toThrow(
        "No plan found for goal retirement",
      );
    } finally {
      db.close();
    }
  });

  test("replaces funding rules and deletes goals with Rust-compatible sync behavior", async () => {
    const db = createGoalsDb();
    const syncEvents: GoalSyncEvent[] = [];
    const service = createGoalService(
      createGoalRepository(db, { queueSyncEvent: (event) => syncEvents.push(event) }),
    );

    try {
      seedGoal(db, { id: "goal-1", title: "Goal" });
      seedFundingRule(db, {
        id: "old-rule",
        goalId: "goal-1",
        accountId: "brokerage",
        sharePercent: 50,
      });

      await service.saveGoalFunding("goal-1", [{ accountId: "cash", sharePercent: 100 }]);
      expect(syncEvents.map((event) => `${event.entity}:${event.operation}`)).toEqual([
        "goals_allocation:Delete",
        "goals_allocation:Create",
      ]);

      await expect(service.deleteGoal("missing")).resolves.toBe(0);
      await expect(service.deleteGoal("goal-1")).resolves.toBe(1);
      expect(syncEvents.at(-1)).toEqual({
        entity: "goals",
        entityId: "goal-1",
        operation: "Delete",
        payload: { id: "goal-1" },
      });
    } finally {
      db.close();
    }
  });
});

function createGoalsDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE goals (
      id TEXT NOT NULL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      target_amount REAL NOT NULL DEFAULT 0,
      goal_type TEXT NOT NULL DEFAULT 'custom_save_up',
      status_lifecycle TEXT NOT NULL DEFAULT 'active',
      status_health TEXT NOT NULL DEFAULT 'not_applicable',
      priority INTEGER NOT NULL DEFAULT 0,
      cover_image_key TEXT,
      currency TEXT,
      start_date TEXT,
      target_date TEXT,
      summary_current_value REAL,
      summary_progress REAL,
      projected_completion_date TEXT,
      projected_value_at_target_date REAL,
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      summary_target_amount REAL
    );

    CREATE TABLE goals_allocation (
      id TEXT NOT NULL PRIMARY KEY,
      goal_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      share_percent REAL NOT NULL DEFAULT 0,
      tax_bucket TEXT,
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE goal_plans (
      goal_id TEXT NOT NULL PRIMARY KEY,
      plan_kind TEXT NOT NULL,
      planner_mode TEXT,
      settings_json TEXT NOT NULL DEFAULT '{}',
      summary_json TEXT NOT NULL DEFAULT '{}',
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );
  `);
  return db;
}

function seedGoal(
  db: Database,
  goal: {
    id: string;
    title: string;
    goalType?: string;
    statusLifecycle?: string;
    priority?: number;
    targetAmount?: number;
    targetDate?: string | null;
    summaryCurrentValue?: number | null;
    projectedCompletionDate?: string | null;
    projectedValueAtTargetDate?: number | null;
    summaryTargetAmount?: number | null;
    createdAt?: string;
    updatedAt?: string;
  },
): void {
  db.prepare(
    `
      INSERT INTO goals (
        id, title, description, target_amount, goal_type, status_lifecycle,
        status_health, priority, target_date, summary_current_value,
        projected_completion_date, projected_value_at_target_date, summary_target_amount,
        created_at, updated_at
      )
      VALUES (?, ?, NULL, ?, ?, ?, 'not_applicable', ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    goal.id,
    goal.title,
    goal.targetAmount ?? 100,
    goal.goalType ?? "custom_save_up",
    goal.statusLifecycle ?? "active",
    goal.priority ?? 0,
    goal.targetDate ?? null,
    goal.summaryCurrentValue ?? null,
    goal.projectedCompletionDate ?? null,
    goal.projectedValueAtTargetDate ?? null,
    goal.summaryTargetAmount ?? null,
    goal.createdAt ?? "2026-01-01T00:00:00Z",
    goal.updatedAt ?? "2026-01-01T00:00:00Z",
  );
}

function seedFundingRule(
  db: Database,
  rule: {
    id: string;
    goalId: string;
    accountId: string;
    sharePercent: number;
    taxBucket?: string | null;
  },
): void {
  db.prepare(
    `
      INSERT INTO goals_allocation (
        id, goal_id, account_id, share_percent, tax_bucket, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    rule.id,
    rule.goalId,
    rule.accountId,
    rule.sharePercent,
    rule.taxBucket ?? null,
    "2026-01-01T00:00:00Z",
    "2026-01-01T00:00:00Z",
  );
}

function seedGoalPlan(
  db: Database,
  plan: {
    goalId: string;
    planKind: string;
    settingsJson: string;
    plannerMode?: string | null;
  },
): void {
  db.prepare(
    `
      INSERT INTO goal_plans (
        goal_id, plan_kind, planner_mode, settings_json, summary_json, version, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, '{}', 1, ?, ?)
    `,
  ).run(
    plan.goalId,
    plan.planKind,
    plan.plannerMode ?? null,
    plan.settingsJson,
    "2026-01-01T00:00:00Z",
    "2026-01-01T00:00:00Z",
  );
}

function validRetirementPlan(
  overrides: {
    personal?: Record<string, unknown>;
    expenses?: Record<string, unknown>;
    incomeStreams?: unknown[];
    investment?: Record<string, unknown>;
    tax?: unknown;
    frontendOnly?: unknown;
  } = {},
): Record<string, unknown> {
  return {
    personal: {
      currentAge: 45,
      targetRetirementAge: 55,
      planningHorizonAge: 90,
      ...overrides.personal,
    },
    expenses: {
      items: [{ id: "living", label: "Living", monthlyAmount: 6000 }],
      ...overrides.expenses,
    },
    incomeStreams: overrides.incomeStreams ?? [],
    investment: {
      preRetirementAnnualReturn: 0.057,
      retirementAnnualReturn: 0.034,
      annualInvestmentFeeRate: 0.006,
      annualVolatility: 0.12,
      inflationRate: 0.02,
      monthlyContribution: 3000,
      contributionGrowthRate: 0.02,
      glidePath: null,
      ...overrides.investment,
    },
    tax:
      overrides.tax === undefined
        ? {
            taxableWithdrawalRate: 0,
            taxDeferredWithdrawalRate: 0,
            taxFreeWithdrawalRate: 0,
            withdrawalBuckets: { taxable: 0, taxDeferred: 0, taxFree: 0 },
          }
        : overrides.tax,
    currency: "CAD",
    ...(overrides.frontendOnly === undefined ? {} : { frontendOnly: overrides.frontendOnly }),
  };
}

function definedContributionStream(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "dc",
    label: "Pension",
    streamType: "dc",
    startAge: 65,
    adjustForInflation: true,
    monthlyAmount: null,
    linkedAccountId: "pension",
    currentValue: 1000,
    monthlyContribution: 100,
    accumulationReturn: 0.04,
    ...overrides,
  };
}
