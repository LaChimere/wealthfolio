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
    createdAt?: string;
    updatedAt?: string;
  },
): void {
  db.prepare(
    `
      INSERT INTO goals (
        id, title, description, target_amount, goal_type, status_lifecycle,
        status_health, priority, created_at, updated_at
      )
      VALUES (?, ?, NULL, ?, ?, ?, 'not_applicable', ?, ?, ?)
    `,
  ).run(
    goal.id,
    goal.title,
    goal.targetAmount ?? 100,
    goal.goalType ?? "custom_save_up",
    goal.statusLifecycle ?? "active",
    goal.priority ?? 0,
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
