import type { Database } from "bun:sqlite";

import {
  parseValidateAndNormalizeRetirementPlanSettings,
  validateAndNormalizeRetirementPlanSettings,
  type RetirementTimingMode,
  type TaxBucketBalances,
} from "./retirement-plan";
import {
  computeRetirementOverviewWithMode,
  type RetirementOverview,
  type RetirementPlan,
} from "./retirement-calculations";
import { previewSaveUpOverview, type SaveUpOverview } from "./save-up";

export interface Goal {
  id: string;
  goalType: string;
  title: string;
  description: string | null;
  targetAmount: number | null;
  statusLifecycle: string;
  statusHealth: string;
  priority: number;
  coverImageKey: string | null;
  currency: string | null;
  startDate: string | null;
  targetDate: string | null;
  summaryCurrentValue: number | null;
  summaryProgress: number | null;
  projectedCompletionDate: string | null;
  projectedValueAtTargetDate: number | null;
  createdAt: string;
  updatedAt: string;
  summaryTargetAmount: number | null;
}

export interface NewGoal {
  id?: string | null;
  goalType: string;
  title: string;
  description?: string | null;
  targetAmount?: number | null;
  statusLifecycle?: string | null;
  statusHealth?: string | null;
  priority?: number | null;
  coverImageKey?: string | null;
  currency?: string | null;
  startDate?: string | null;
  targetDate?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface GoalFundingRule {
  id: string;
  goalId: string;
  accountId: string;
  sharePercent: number;
  taxBucket: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GoalFundingRuleInput {
  accountId: string;
  sharePercent: number;
  taxBucket?: string | null;
}

export interface GoalPlan {
  goalId: string;
  planKind: string;
  plannerMode: string | null;
  settingsJson: string;
  summaryJson: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface SaveGoalPlan {
  goalId: string;
  planKind: string;
  plannerMode?: string | null;
  settingsJson: string;
  summaryJson?: string | null;
}

export interface GoalSummaryUpdate {
  summaryTargetAmount: number | null;
  summaryCurrentValue: number | null;
  summaryProgress: number | null;
  projectedCompletionDate: string | null;
  projectedValueAtTargetDate: number | null;
  statusHealth: string;
}

export interface PreparedRetirementSimulationInput {
  plan: RetirementPlan;
  currentPortfolio: number;
  plannerMode: RetirementTimingMode;
}

export type GoalValuationMap =
  | ReadonlyMap<string, number>
  | Readonly<Record<string, number | undefined>>;

export interface GoalAccount {
  id: string;
  accountType: string;
}

export interface GoalAccountProvider {
  getActiveNonArchivedAccounts(): GoalAccount[];
}

export type GoalSyncEntity = "goals" | "goals_allocation" | "goal_plans";
export type GoalSyncOperation = "Create" | "Update" | "Delete";

export interface GoalSyncEvent {
  entity: GoalSyncEntity;
  entityId: string;
  operation: GoalSyncOperation;
  payload: GoalRowPayload | GoalFundingRuleRowPayload | GoalPlanRowPayload | { id: string };
}

export interface GoalRepositoryOptions {
  queueSyncEvent?: (event: GoalSyncEvent) => void;
}

export interface GoalServiceOptions {
  accountProvider?: GoalAccountProvider;
  baseCurrency?: string | (() => string | undefined);
  now?: () => Date;
}

export interface GoalRepository {
  loadGoals(): Goal[];
  loadGoal(goalId: string): Goal;
  insertNewGoal(newGoal: NewGoal): Goal;
  insertGoalWithFunding(newGoal: NewGoal, fundingRules: GoalFundingRuleInput[]): Goal;
  updateGoal(goal: Goal): Goal;
  deleteGoal(goalId: string): number;
  loadFundingRules(goalId: string): GoalFundingRule[];
  loadParticipatingFundingRules(): GoalFundingRule[];
  saveGoalFunding(goalId: string, rules: GoalFundingRuleInput[]): GoalFundingRule[];
  loadGoalPlan(goalId: string): GoalPlan | null;
  saveGoalPlan(plan: SaveGoalPlan): GoalPlan;
  deleteGoalPlan(goalId: string): number;
  updateGoalSummaryFields(goalId: string, update: GoalSummaryUpdate): void;
}

export interface GoalService {
  getGoals(): Goal[];
  getGoal(goalId: string): Goal;
  createGoal(newGoal: NewGoal): Promise<Goal>;
  updateGoal(goal: Goal): Promise<Goal>;
  deleteGoal(goalId: string): Promise<number>;
  getGoalFunding(goalId: string): GoalFundingRule[];
  saveGoalFunding(goalId: string, rules: GoalFundingRuleInput[]): Promise<GoalFundingRule[]>;
  getGoalPlan(goalId: string): GoalPlan | null;
  saveGoalPlan(plan: SaveGoalPlan): Promise<GoalPlan>;
  deleteGoalPlan(goalId: string): Promise<number>;
  computeSaveUpOverview(goalId: string, valuationMap: GoalValuationMap): Promise<SaveUpOverview>;
  computeRetirementOverview(
    goalId: string,
    valuationMap: GoalValuationMap,
  ): Promise<RetirementOverview>;
  prepareRetirementInput(
    goalId: string,
    valuationMap: GoalValuationMap,
  ): Promise<PreparedRetirementSimulationInput>;
  refreshGoalSummary(goalId: string, valuationMap: GoalValuationMap): Promise<Goal>;
  getBaseCurrency(): string | undefined;
}

interface GoalRow {
  id: string;
  title: string;
  description: string | null;
  target_amount: number;
  goal_type: string;
  status_lifecycle: string;
  status_health: string;
  priority: number;
  cover_image_key: string | null;
  currency: string | null;
  start_date: string | null;
  target_date: string | null;
  summary_current_value: number | null;
  summary_progress: number | null;
  projected_completion_date: string | null;
  projected_value_at_target_date: number | null;
  created_at: string;
  updated_at: string;
  summary_target_amount: number | null;
}

interface GoalFundingRuleRow {
  id: string;
  goal_id: string;
  account_id: string;
  share_percent: number;
  tax_bucket: string | null;
  created_at: string;
  updated_at: string;
}

interface GoalPlanRow {
  goal_id: string;
  plan_kind: string;
  planner_mode: string | null;
  settings_json: string;
  summary_json: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface GoalRowPayload extends Goal {
  targetAmount: number;
}

export interface GoalFundingRuleRowPayload extends GoalFundingRule {}

export interface GoalPlanRowPayload extends GoalPlan {}

interface RetirementGoalSummary {
  target: number | null;
  projectedCompletionDate: string | null;
  projectedValueAtTargetDate: number;
  status: RetirementOverview["status"];
}

const GOAL_LIFECYCLE_ACTIVE = "active";
const GOAL_LIFECYCLE_ACHIEVED = "achieved";
const GOAL_LIFECYCLE_ARCHIVED = "archived";
const GOAL_HEALTH_NOT_APPLICABLE = "not_applicable";
const RETIREMENT_ELIGIBLE_ACCOUNT_TYPES = new Set(["SECURITIES", "CASH", "CRYPTOCURRENCY"]);

export function createGoalRepository(
  db: Database,
  options: GoalRepositoryOptions = {},
): GoalRepository {
  return {
    loadGoals() {
      return db
        .query<GoalRow, []>(
          `
            SELECT ${goalColumns()}
            FROM goals
            ORDER BY priority DESC
          `,
        )
        .all()
        .map(goalFromRow);
    },
    loadGoal(goalId) {
      return goalFromRow(readGoalRowById(db, goalId));
    },
    insertNewGoal(newGoal) {
      let created: GoalRow | undefined;
      db.transaction(() => {
        created = insertGoalRow(db, newGoal);
        queueGoalSync(options, created, "Create");
      })();
      if (!created) {
        throw new Error("Record not found: goal");
      }
      return goalFromRow(created);
    },
    insertGoalWithFunding(newGoal, fundingRules) {
      let created: GoalRow | undefined;
      db.transaction(() => {
        created = insertGoalRow(db, newGoal);
        queueGoalSync(options, created, "Create");
        if (created.status_lifecycle === GOAL_LIFECYCLE_ACTIVE) {
          validateGoalFundingCapacity(db, created.id, fundingRules);
        }
        for (const rule of fundingRules) {
          const row = insertFundingRuleRow(db, created.id, rule);
          queueFundingSync(options, row, "Create");
        }
      })();
      if (!created) {
        throw new Error("Record not found: goal");
      }
      return goalFromRow(created);
    },
    updateGoal(goal) {
      let updated: GoalRow | undefined;
      db.transaction(() => {
        const currentStatusLifecycle = readGoalRowById(db, goal.id).status_lifecycle;
        if (
          currentStatusLifecycle !== GOAL_LIFECYCLE_ACTIVE &&
          goal.statusLifecycle === GOAL_LIFECYCLE_ACTIVE
        ) {
          validateGoalFundingCapacity(db, goal.id, loadFundingInputs(db, goal.id));
        }
        const updatedAt = timestampNow();
        db.prepare(
          `
            UPDATE goals
            SET
              title = ?,
              description = ?,
              target_amount = ?,
              goal_type = ?,
              status_lifecycle = ?,
              status_health = ?,
              priority = ?,
              cover_image_key = ?,
              currency = ?,
              start_date = ?,
              target_date = ?,
              summary_current_value = ?,
              summary_progress = ?,
              projected_completion_date = ?,
              projected_value_at_target_date = ?,
              created_at = ?,
              updated_at = ?,
              summary_target_amount = ?
            WHERE id = ?
          `,
        ).run(
          goal.title,
          goal.description,
          goal.targetAmount ?? 0,
          goal.goalType,
          goal.statusLifecycle,
          goal.statusHealth,
          goal.priority,
          goal.coverImageKey,
          goal.currency,
          goal.startDate,
          goal.targetDate,
          goal.summaryCurrentValue,
          goal.summaryProgress,
          goal.projectedCompletionDate,
          goal.projectedValueAtTargetDate,
          goal.createdAt,
          updatedAt,
          goal.summaryTargetAmount,
          goal.id,
        );
        updated = readGoalRowById(db, goal.id);
        queueGoalSync(options, updated, "Update");
      })();
      if (!updated) {
        throw new Error(`Record not found: goal ${goal.id}`);
      }
      return goalFromRow(updated);
    },
    deleteGoal(goalId) {
      let changes = 0;
      db.transaction(() => {
        const result = db.prepare("DELETE FROM goals WHERE id = ?").run(goalId);
        changes = result.changes;
        if (changes > 0) {
          queueSyncDelete(options, "goals", goalId);
        }
      })();
      return changes;
    },
    loadFundingRules(goalId) {
      return loadFundingRows(db, goalId).map(fundingRuleFromRow);
    },
    loadParticipatingFundingRules() {
      return db
        .query<GoalFundingRuleRow, [string]>(
          `
            SELECT ${fundingRuleColumns()}
            FROM goals_allocation
            INNER JOIN goals ON goals.id = goals_allocation.goal_id
            WHERE goals.status_lifecycle = ?
          `,
        )
        .all(GOAL_LIFECYCLE_ACTIVE)
        .map(fundingRuleFromRow);
    },
    saveGoalFunding(goalId, rules) {
      let saved: GoalFundingRuleRow[] = [];
      db.transaction(() => {
        validateGoalFundingCapacity(db, goalId, rules);
        const existing = loadFundingRows(db, goalId);
        db.prepare("DELETE FROM goals_allocation WHERE goal_id = ?").run(goalId);
        for (const oldRule of existing) {
          queueSyncDelete(options, "goals_allocation", oldRule.id);
        }
        saved = rules.map((rule) => {
          const row = insertFundingRuleRow(db, goalId, rule);
          queueFundingSync(options, row, "Create");
          return row;
        });
      })();
      return saved.map(fundingRuleFromRow);
    },
    loadGoalPlan(goalId) {
      const row = db
        .query<GoalPlanRow, [string]>(
          `
            SELECT goal_id, plan_kind, planner_mode, settings_json, summary_json, version, created_at, updated_at
            FROM goal_plans
            WHERE goal_id = ?
          `,
        )
        .get(goalId);
      return row ? goalPlanFromRow(row) : null;
    },
    saveGoalPlan(plan) {
      let saved: GoalPlanRow | undefined;
      db.transaction(() => {
        const existing = db
          .query<GoalPlanRow, [string]>(
            `
              SELECT goal_id, plan_kind, planner_mode, settings_json, summary_json, version, created_at, updated_at
              FROM goal_plans
              WHERE goal_id = ?
            `,
          )
          .get(plan.goalId);
        const now = timestampNow();
        const row: GoalPlanRow = {
          goal_id: plan.goalId,
          plan_kind: plan.planKind,
          planner_mode: plan.plannerMode ?? null,
          settings_json: plan.settingsJson,
          summary_json: plan.summaryJson ?? "{}",
          version: existing ? existing.version + 1 : 1,
          created_at: existing?.created_at ?? now,
          updated_at: now,
        };
        db.prepare(
          `
            INSERT INTO goal_plans (
              goal_id, plan_kind, planner_mode, settings_json, summary_json, version, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(goal_id) DO UPDATE SET
              plan_kind = excluded.plan_kind,
              planner_mode = excluded.planner_mode,
              settings_json = excluded.settings_json,
              summary_json = excluded.summary_json,
              version = excluded.version,
              created_at = excluded.created_at,
              updated_at = excluded.updated_at
          `,
        ).run(
          row.goal_id,
          row.plan_kind,
          row.planner_mode,
          row.settings_json,
          row.summary_json,
          row.version,
          row.created_at,
          row.updated_at,
        );
        saved = readGoalPlanRowById(db, plan.goalId);
        queueGoalPlanSync(options, saved, existing ? "Update" : "Create");
      })();
      if (!saved) {
        throw new Error("Record not found: goal plan");
      }
      return goalPlanFromRow(saved);
    },
    deleteGoalPlan(goalId) {
      let affected = 0;
      db.transaction(() => {
        affected = db.prepare("DELETE FROM goal_plans WHERE goal_id = ?").run(goalId).changes;
        if (affected > 0) {
          queueSyncDelete(options, "goal_plans", goalId);
        }
      })();
      return affected;
    },
    updateGoalSummaryFields(goalId, update) {
      db.prepare(
        `
          UPDATE goals
          SET
            summary_target_amount = ?,
            summary_current_value = ?,
            summary_progress = ?,
            projected_completion_date = ?,
            projected_value_at_target_date = ?,
            status_health = ?
          WHERE id = ?
        `,
      ).run(
        update.summaryTargetAmount,
        update.summaryCurrentValue,
        update.summaryProgress,
        update.projectedCompletionDate,
        update.projectedValueAtTargetDate,
        update.statusHealth,
        goalId,
      );
    },
  };
}

export function createGoalService(
  repository: GoalRepository,
  options: GoalServiceOptions = {},
): GoalService {
  const prepareRetirementInputForGoal = (
    goalId: string,
    valuationMap: GoalValuationMap,
  ): PreparedRetirementSimulationInput => {
    const goal = repository.loadGoal(goalId);
    if (goal.goalType !== "retirement") {
      throw new Error(`Invalid input: Goal ${goalId} is not a retirement goal`);
    }
    const storedPlan = repository.loadGoalPlan(goalId);
    if (!storedPlan) {
      throw new Error(`Invalid input: No plan found for goal ${goalId}`);
    }

    const normalized = parseValidateAndNormalizeRetirementPlanSettings(storedPlan.settingsJson, {
      asOf: options.now?.(),
    });
    const fundingRules = repository.loadFundingRules(goalId);
    const taxBucketBalances = computeTaxBucketBalances(fundingRules, valuationMap);
    const planWithBuckets = injectTaxBucketBalances(normalized.settings, taxBucketBalances);

    return {
      plan: planWithBuckets,
      currentPortfolio: computeGoalValueFromShares(fundingRules, valuationMap),
      plannerMode: retirementTimingModeFromString(storedPlan.plannerMode ?? "fire"),
    };
  };

  return {
    getGoals() {
      return repository.loadGoals();
    },
    getGoal(goalId) {
      return repository.loadGoal(goalId);
    },
    async createGoal(newGoal) {
      const isRetirement = newGoal.goalType === "retirement";
      if (newGoal.statusLifecycle !== undefined && newGoal.statusLifecycle !== null) {
        validateGoalLifecycle(newGoal.statusLifecycle);
      }
      if (isRetirement) {
        assertSingleRetirementGoal(repository.loadGoals());
        const seedRules = buildRetirementSeedRules(
          options.accountProvider?.getActiveNonArchivedAccounts() ?? [],
          repository.loadParticipatingFundingRules(),
        );
        return repository.insertGoalWithFunding(newGoal, seedRules);
      }
      return repository.insertNewGoal(newGoal);
    },
    async updateGoal(goal) {
      const existing = repository.loadGoal(goal.id);
      if (existing.goalType !== goal.goalType) {
        throw new Error("Invalid input: Goal type cannot be changed after creation");
      }
      validateGoalLifecycle(goal.statusLifecycle);
      if (goal.goalType === "retirement" && goal.statusLifecycle !== GOAL_LIFECYCLE_ARCHIVED) {
        assertSingleRetirementGoal(repository.loadGoals(), goal.id);
      }
      if (
        existing.statusLifecycle !== GOAL_LIFECYCLE_ACTIVE &&
        goal.statusLifecycle === GOAL_LIFECYCLE_ACTIVE
      ) {
        validateFundingCapacity(
          goal.id,
          fundingRulesAsInput(repository.loadFundingRules(goal.id)),
          repository.loadParticipatingFundingRules(),
        );
      }
      return repository.updateGoal(goal);
    },
    async deleteGoal(goalId) {
      return repository.deleteGoal(goalId);
    },
    getGoalFunding(goalId) {
      return repository.loadFundingRules(goalId);
    },
    async saveGoalFunding(goalId, rules) {
      const goal = repository.loadGoal(goalId);
      const isRetirement = goal.goalType === "retirement";
      validateGoalFundingInputRules(rules);

      const nextRules = isRetirement
        ? rules.map((rule) => ({ ...rule }))
        : rules.map((rule) => ({ ...rule, taxBucket: null }));

      if (isRetirement) {
        validateRetirementFundingRules(nextRules);
        validateDefinedContributionLinks(repository.loadGoalPlan(goalId), nextRules);
      }

      validateFundingCapacity(goalId, nextRules, repository.loadParticipatingFundingRules());
      return repository.saveGoalFunding(goalId, nextRules);
    },
    getGoalPlan(goalId) {
      return repository.loadGoalPlan(goalId);
    },
    async saveGoalPlan(plan) {
      const goal = repository.loadGoal(plan.goalId);
      const valid =
        goal.goalType === "retirement"
          ? plan.planKind === "retirement"
          : plan.planKind === "save_up";
      if (!valid) {
        throw new Error(
          `Invalid input: Plan kind '${plan.planKind}' is not valid for goal type '${goal.goalType}'`,
        );
      }
      if (
        plan.plannerMode !== undefined &&
        plan.plannerMode !== null &&
        plan.planKind !== "retirement"
      ) {
        throw new Error("Invalid input: planner_mode is only valid for retirement plans");
      }
      if (plan.planKind === "retirement") {
        const validated = validateAndNormalizeRetirementPlanSettings(plan.settingsJson, {
          asOf: options.now?.(),
        });
        const participatingRules =
          validated.dcLinkedAccountIds.length > 0 ? repository.loadParticipatingFundingRules() : [];
        for (const accountId of validated.dcLinkedAccountIds) {
          if (participatingRules.some((rule) => rule.accountId === accountId)) {
            throw new Error(
              `Invalid input: Account '${accountId}' has participating goal shares and cannot be linked as DC`,
            );
          }
        }
        return repository.saveGoalPlan({ ...plan, settingsJson: validated.settingsJson });
      }
      return repository.saveGoalPlan(plan);
    },
    async deleteGoalPlan(goalId) {
      return repository.deleteGoalPlan(goalId);
    },
    async computeSaveUpOverview(goalId, valuationMap) {
      const goal = repository.loadGoal(goalId);
      const plan = repository.loadGoalPlan(goalId);
      const fundingRules = repository.loadFundingRules(goalId);
      const currentValue = computeSummaryCurrentValue(goal, fundingRules, valuationMap);
      const settings = parseSaveUpPlanSettings(plan);
      return previewSaveUpOverview(
        {
          currentValue,
          targetAmount: goal.targetAmount ?? 0,
          targetDate: goal.targetDate,
          monthlyContribution: settings.monthlyContribution,
          expectedAnnualReturn: settings.expectedAnnualReturn,
        },
        { now: options.now?.() },
      );
    },
    async prepareRetirementInput(goalId, valuationMap) {
      return prepareRetirementInputForGoal(goalId, valuationMap);
    },
    async computeRetirementOverview(goalId, valuationMap) {
      const prepared = prepareRetirementInputForGoal(goalId, valuationMap);
      return computeRetirementOverviewWithMode(
        prepared.plan,
        prepared.currentPortfolio,
        prepared.plannerMode,
      );
    },
    async refreshGoalSummary(goalId, valuationMap) {
      const goal = repository.loadGoal(goalId);
      const fundingRules = repository.loadFundingRules(goalId);
      const isRetirement = goal.goalType === "retirement";
      const plan = isRetirement ? repository.loadGoalPlan(goalId) : null;
      const retirementSummary =
        isRetirement && plan
          ? computeRetirementSummary(prepareRetirementInputForGoal(goalId, valuationMap), options)
          : null;

      const currentValue = computeSummaryCurrentValue(goal, fundingRules, valuationMap);
      const target = isRetirement
        ? plan
          ? (retirementSummary?.target ?? goal.summaryTargetAmount)
          : null
        : (goal.targetAmount ?? goal.summaryTargetAmount);
      const progress = target !== null && target > 0 ? Math.min(currentValue / target, 1) : null;
      const projectedValueAtTargetDate =
        isRetirement && !plan
          ? null
          : (retirementSummary?.projectedValueAtTargetDate ?? goal.projectedValueAtTargetDate);
      const statusHealth =
        goal.statusLifecycle === GOAL_LIFECYCLE_ACHIEVED
          ? "on_track"
          : isRetirement
            ? retirementSummary
              ? retirementGoalHealthFromOverviewStatus(retirementSummary.status)
              : "not_applicable"
            : goalSummaryHealth(false, projectedValueAtTargetDate, target);

      repository.updateGoalSummaryFields(goalId, {
        summaryTargetAmount: target,
        summaryCurrentValue: currentValue,
        summaryProgress: progress,
        projectedCompletionDate:
          isRetirement && !plan
            ? null
            : (retirementSummary?.projectedCompletionDate ?? goal.projectedCompletionDate),
        projectedValueAtTargetDate,
        statusHealth,
      });
      return repository.loadGoal(goalId);
    },
    getBaseCurrency() {
      return resolveBaseCurrency(options);
    },
  };
}

function insertGoalRow(db: Database, newGoal: NewGoal): GoalRow {
  const id = crypto.randomUUID();
  const now = timestampNow();
  db.prepare(
    `
      INSERT INTO goals (
        id, title, description, target_amount, goal_type, status_lifecycle,
        status_health, priority, cover_image_key, currency, start_date, target_date,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    id,
    newGoal.title,
    newGoal.description ?? null,
    newGoal.targetAmount ?? 0,
    newGoal.goalType,
    newGoal.statusLifecycle ?? GOAL_LIFECYCLE_ACTIVE,
    newGoal.statusHealth ?? GOAL_HEALTH_NOT_APPLICABLE,
    newGoal.priority ?? 0,
    newGoal.coverImageKey ?? null,
    newGoal.currency ?? null,
    newGoal.startDate ?? null,
    newGoal.targetDate ?? null,
    newGoal.createdAt ?? now,
    newGoal.updatedAt ?? now,
  );
  return readGoalRowById(db, id);
}

function insertFundingRuleRow(
  db: Database,
  goalId: string,
  rule: GoalFundingRuleInput,
): GoalFundingRuleRow {
  const id = crypto.randomUUID();
  const now = timestampNow();
  db.prepare(
    `
      INSERT INTO goals_allocation (
        id, goal_id, account_id, share_percent, tax_bucket, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(id, goalId, rule.accountId, rule.sharePercent, rule.taxBucket ?? null, now, now);
  return readFundingRuleRowById(db, id);
}

function readGoalRowById(db: Database, goalId: string): GoalRow {
  const row = db
    .query<GoalRow, [string]>(
      `
        SELECT ${goalColumns()}
        FROM goals
        WHERE id = ?
      `,
    )
    .get(goalId);
  if (!row) {
    throw new Error(`Record not found: goal ${goalId}`);
  }
  return row;
}

function readFundingRuleRowById(db: Database, ruleId: string): GoalFundingRuleRow {
  const row = db
    .query<GoalFundingRuleRow, [string]>(
      `
        SELECT ${fundingRuleColumns()}
        FROM goals_allocation
        WHERE id = ?
      `,
    )
    .get(ruleId);
  if (!row) {
    throw new Error(`Record not found: goal funding rule ${ruleId}`);
  }
  return row;
}

function loadFundingRows(db: Database, goalId: string): GoalFundingRuleRow[] {
  return db
    .query<GoalFundingRuleRow, [string]>(
      `
        SELECT ${fundingRuleColumns()}
        FROM goals_allocation
        WHERE goal_id = ?
      `,
    )
    .all(goalId);
}

function loadFundingInputs(db: Database, goalId: string): GoalFundingRuleInput[] {
  return loadFundingRows(db, goalId).map((rule) => ({
    accountId: rule.account_id,
    sharePercent: rule.share_percent,
    taxBucket: rule.tax_bucket,
  }));
}

function goalColumns(): string {
  return [
    "id",
    "title",
    "description",
    "target_amount",
    "goal_type",
    "status_lifecycle",
    "status_health",
    "priority",
    "cover_image_key",
    "currency",
    "start_date",
    "target_date",
    "summary_current_value",
    "summary_progress",
    "projected_completion_date",
    "projected_value_at_target_date",
    "created_at",
    "updated_at",
    "summary_target_amount",
  ].join(", ");
}

function fundingRuleColumns(): string {
  return [
    "goals_allocation.id",
    "goal_id",
    "account_id",
    "share_percent",
    "tax_bucket",
    "goals_allocation.created_at",
    "goals_allocation.updated_at",
  ].join(", ");
}

function goalFromRow(row: GoalRow): Goal {
  return {
    id: row.id,
    goalType: row.goal_type,
    title: row.title,
    description: row.description,
    targetAmount: row.target_amount === 0 ? null : row.target_amount,
    statusLifecycle: row.status_lifecycle,
    statusHealth: row.status_health,
    priority: row.priority,
    coverImageKey: row.cover_image_key,
    currency: row.currency,
    startDate: row.start_date,
    targetDate: row.target_date,
    summaryCurrentValue: row.summary_current_value,
    summaryProgress: row.summary_progress,
    projectedCompletionDate: row.projected_completion_date,
    projectedValueAtTargetDate: row.projected_value_at_target_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    summaryTargetAmount: row.summary_target_amount,
  };
}

function fundingRuleFromRow(row: GoalFundingRuleRow): GoalFundingRule {
  return {
    id: row.id,
    goalId: row.goal_id,
    accountId: row.account_id,
    sharePercent: row.share_percent,
    taxBucket: row.tax_bucket,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function goalPlanFromRow(row: GoalPlanRow): GoalPlan {
  return {
    goalId: row.goal_id,
    planKind: row.plan_kind,
    plannerMode: row.planner_mode,
    settingsJson: row.settings_json,
    summaryJson: row.summary_json,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function readGoalPlanRowById(db: Database, goalId: string): GoalPlanRow {
  const row = db
    .query<GoalPlanRow, [string]>(
      `
        SELECT goal_id, plan_kind, planner_mode, settings_json, summary_json, version, created_at, updated_at
        FROM goal_plans
        WHERE goal_id = ?
      `,
    )
    .get(goalId);
  if (!row) {
    throw new Error(`Record not found: goal plan '${goalId}'`);
  }
  return row;
}

function validateGoalLifecycle(statusLifecycle: string): void {
  if (
    statusLifecycle !== GOAL_LIFECYCLE_ACTIVE &&
    statusLifecycle !== GOAL_LIFECYCLE_ACHIEVED &&
    statusLifecycle !== GOAL_LIFECYCLE_ARCHIVED
  ) {
    throw new Error(`Invalid input: Unsupported goal lifecycle '${statusLifecycle}'`);
  }
}

function assertSingleRetirementGoal(goals: Goal[], excludedGoalId?: string): void {
  const existing = goals.some(
    (goal) =>
      goal.id !== excludedGoalId &&
      goal.goalType === "retirement" &&
      goal.statusLifecycle !== GOAL_LIFECYCLE_ARCHIVED,
  );
  if (existing) {
    throw new Error("Invalid input: Only one active retirement goal is allowed");
  }
}

function buildRetirementSeedRules(
  eligibleAccounts: GoalAccount[],
  participatingRules: GoalFundingRule[],
): GoalFundingRuleInput[] {
  const existingShareTotals = buildAccountShareTotals(participatingRules);
  return eligibleAccounts
    .filter((account) => RETIREMENT_ELIGIBLE_ACCOUNT_TYPES.has(account.accountType))
    .map((account) => ({
      accountId: account.id,
      sharePercent: clamp(100 - (existingShareTotals.get(account.id) ?? 0), 0, 100),
      taxBucket: null,
    }))
    .filter((rule) => rule.sharePercent > 0);
}

function validateGoalFundingInputRules(rules: GoalFundingRuleInput[]): void {
  const seenAccounts = new Set<string>();
  for (const rule of rules) {
    if (seenAccounts.has(rule.accountId)) {
      throw new Error(`Invalid input: Duplicate account '${rule.accountId}' in funding rules`);
    }
    seenAccounts.add(rule.accountId);
    validateSharePercent(rule.sharePercent);
  }
}

function validateRetirementFundingRules(rules: GoalFundingRuleInput[]): void {
  for (const rule of rules) {
    if (!isSupportedTaxBucket(rule.taxBucket ?? null)) {
      throw new Error(`Invalid input: Unsupported tax bucket '${rule.taxBucket ?? ""}'`);
    }
  }
}

function validateDefinedContributionLinks(
  plan: GoalPlan | null,
  rules: GoalFundingRuleInput[],
): void {
  if (!plan) {
    return;
  }
  let settings: unknown;
  try {
    settings = JSON.parse(plan.settingsJson);
  } catch {
    return;
  }
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
    return;
  }
  const incomeStreams = (settings as Record<string, unknown>).incomeStreams;
  if (!Array.isArray(incomeStreams)) {
    return;
  }
  for (const stream of incomeStreams) {
    if (typeof stream !== "object" || stream === null || Array.isArray(stream)) {
      continue;
    }
    const linkedAccountId = (stream as Record<string, unknown>).linkedAccountId;
    if (
      typeof linkedAccountId === "string" &&
      rules.some((rule) => rule.accountId === linkedAccountId)
    ) {
      throw new Error(
        `Invalid input: Account '${linkedAccountId}' is linked to a pension fund and cannot be added to funding rules`,
      );
    }
  }
}

function parseSaveUpPlanSettings(plan: GoalPlan | null): {
  monthlyContribution: number;
  expectedAnnualReturn: number;
} {
  if (!plan) {
    return { monthlyContribution: 0, expectedAnnualReturn: 0.07 };
  }
  const settings: unknown = JSON.parse(plan.settingsJson);
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
    return { monthlyContribution: 0, expectedAnnualReturn: 0.07 };
  }
  const object = settings as Record<string, unknown>;
  return {
    monthlyContribution:
      typeof object.monthlyContribution === "number" ? object.monthlyContribution : 0,
    expectedAnnualReturn:
      typeof object.expectedAnnualReturn === "number" ? object.expectedAnnualReturn : 0.07,
  };
}

function computeSummaryCurrentValue(
  goal: Goal,
  fundingRules: GoalFundingRule[],
  valuationMap: GoalValuationMap,
): number {
  if (
    (goal.statusLifecycle === GOAL_LIFECYCLE_ACHIEVED ||
      goal.statusLifecycle === GOAL_LIFECYCLE_ARCHIVED) &&
    goal.summaryCurrentValue !== null
  ) {
    return goal.summaryCurrentValue;
  }
  return computeGoalValueFromShares(fundingRules, valuationMap);
}

function computeGoalValueFromShares(
  fundingRules: GoalFundingRule[],
  valuationMap: GoalValuationMap,
): number {
  let value = 0;
  for (const rule of fundingRules) {
    const accountValue = accountValuation(valuationMap, rule.accountId);
    if (accountValue !== undefined) {
      value += (accountValue * rule.sharePercent) / 100;
    }
  }
  return value === 0 ? 0 : value;
}

function computeTaxBucketBalances(
  fundingRules: GoalFundingRule[],
  valuationMap: GoalValuationMap,
): TaxBucketBalances {
  const balances: TaxBucketBalances = {
    taxable: 0,
    taxDeferred: 0,
    taxFree: 0,
  };
  for (const rule of fundingRules) {
    const accountValue = accountValuation(valuationMap, rule.accountId);
    if (accountValue === undefined) {
      continue;
    }
    const shareValue = Math.max((accountValue * rule.sharePercent) / 100, 0);
    switch (rule.taxBucket) {
      case "tax_deferred":
      case "tax-deferred":
        balances.taxDeferred += shareValue;
        break;
      case "tax_free":
      case "tax-free":
        balances.taxFree += shareValue;
        break;
      case "taxable":
      case null:
        balances.taxable += shareValue;
        break;
      default:
        console.warn(
          `Unknown goal funding tax bucket '${rule.taxBucket}' for rule ${rule.id}; treating as taxable`,
        );
        balances.taxable += shareValue;
        break;
    }
  }
  return balances;
}

function injectTaxBucketBalances(
  settings: Record<string, unknown>,
  taxBucketBalances: TaxBucketBalances,
): RetirementPlan {
  const tax = isRecord(settings.tax)
    ? { ...settings.tax }
    : {
        taxableWithdrawalRate: 0,
        taxDeferredWithdrawalRate: 0,
        taxFreeWithdrawalRate: 0,
      };
  return {
    ...settings,
    tax: {
      ...tax,
      withdrawalBuckets: taxBucketBalances,
    },
  } as RetirementPlan;
}

function computeRetirementSummary(
  prepared: PreparedRetirementSimulationInput,
  options: GoalServiceOptions,
): RetirementGoalSummary {
  const overview = computeRetirementOverviewWithMode(
    prepared.plan,
    prepared.currentPortfolio,
    prepared.plannerMode,
  );
  const completionAge =
    prepared.plannerMode === "fire"
      ? (overview.fiAge ??
        overview.suggestedGoalAgeIfUnchanged ??
        prepared.plan.personal.targetRetirementAge)
      : prepared.plan.personal.targetRetirementAge;

  return {
    target: overview.requiredCapitalReachable ? overview.requiredCapitalAtGoalAge : null,
    projectedCompletionDate: dateForPlanAge(prepared.plan, completionAge, options.now?.()),
    projectedValueAtTargetDate: overview.portfolioAtGoalAge,
    status: overview.status,
  };
}

function dateForPlanAge(plan: RetirementPlan, age: number, now = new Date()): string | null {
  const years = Math.trunc(age) - plan.personal.currentAge;
  if (years < 0) {
    return null;
  }
  const current = {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
  };
  const targetYear = current.year + years;
  return formatDate({
    year: targetYear,
    month: current.month,
    day: Math.min(current.day, daysInMonth(targetYear, current.month)),
  });
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function formatDate(date: { year: number; month: number; day: number }): string {
  return `${date.year}-${pad2(date.month)}-${pad2(date.day)}`;
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function retirementGoalHealthFromOverviewStatus(status: RetirementOverview["status"]): string {
  switch (status) {
    case "achieved":
    case "on_track":
      return "on_track";
    case "at_risk":
      return "at_risk";
    case "off_track":
      return "off_track";
    default:
      return "not_applicable";
  }
}

function retirementTimingModeFromString(value: string): RetirementTimingMode {
  return value === "traditional" ? "traditional" : "fire";
}

function goalSummaryHealth(
  isRetirement: boolean,
  projectedValueAtTargetDate: number | null,
  target: number | null,
): string {
  if (isRetirement) {
    return "not_applicable";
  }
  if (projectedValueAtTargetDate !== null && target !== null && target > 0) {
    const ratio = projectedValueAtTargetDate / target;
    if (ratio >= 1) {
      return "on_track";
    }
    if (ratio >= 0.9) {
      return "at_risk";
    }
    return "off_track";
  }
  return "not_applicable";
}

function accountValuation(valuationMap: GoalValuationMap, accountId: string): number | undefined {
  if (isReadonlyMap(valuationMap)) {
    return valuationMap.get(accountId);
  }
  return valuationMap[accountId];
}

function isReadonlyMap(
  valuationMap: GoalValuationMap,
): valuationMap is ReadonlyMap<string, number> {
  return typeof (valuationMap as ReadonlyMap<string, number>).get === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateGoalFundingCapacity(
  db: Database,
  goalId: string,
  rules: GoalFundingRuleInput[],
): void {
  validateFundingCapacity(
    goalId,
    rules,
    db
      .query<GoalFundingRuleRow, [string, string]>(
        `
          SELECT ${fundingRuleColumns()}
          FROM goals_allocation
          INNER JOIN goals ON goals.id = goals_allocation.goal_id
          WHERE goals.status_lifecycle = ?
            AND goals_allocation.goal_id != ?
        `,
      )
      .all(GOAL_LIFECYCLE_ACTIVE, goalId)
      .map(fundingRuleFromRow),
  );
}

function validateFundingCapacity(
  goalId: string,
  rules: GoalFundingRuleInput[],
  participatingRules: GoalFundingRule[],
): void {
  const accountTotals = new Map<string, number>();
  for (const rule of participatingRules) {
    if (rule.goalId === goalId) {
      continue;
    }
    accountTotals.set(rule.accountId, (accountTotals.get(rule.accountId) ?? 0) + rule.sharePercent);
  }

  for (const rule of rules) {
    validateSharePercent(rule.sharePercent);
    const usedElsewhere = accountTotals.get(rule.accountId) ?? 0;
    const combined = usedElsewhere + rule.sharePercent;
    if (combined > 100) {
      const maxAvailable = Math.max(100 - usedElsewhere, 0);
      throw new Error(
        `Invalid input: Account '${rule.accountId}' is overallocated: requested ${rule.sharePercent.toFixed(1)}%, used elsewhere ${usedElsewhere.toFixed(1)}%, max available ${maxAvailable.toFixed(1)}%`,
      );
    }
    accountTotals.set(rule.accountId, combined);
  }
}

function validateSharePercent(sharePercent: number): void {
  if (!Number.isFinite(sharePercent) || sharePercent < 0 || sharePercent > 100) {
    throw new Error("Invalid input: share_percent must be between 0 and 100");
  }
}

function isSupportedTaxBucket(taxBucket: string | null): boolean {
  return (
    taxBucket === null ||
    taxBucket === "taxable" ||
    taxBucket === "tax_deferred" ||
    taxBucket === "tax-deferred" ||
    taxBucket === "tax_free" ||
    taxBucket === "tax-free"
  );
}

function fundingRulesAsInput(rules: GoalFundingRule[]): GoalFundingRuleInput[] {
  return rules.map((rule) => ({
    accountId: rule.accountId,
    sharePercent: rule.sharePercent,
    taxBucket: rule.taxBucket,
  }));
}

function buildAccountShareTotals(rules: GoalFundingRule[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const rule of rules) {
    totals.set(rule.accountId, (totals.get(rule.accountId) ?? 0) + rule.sharePercent);
  }
  return totals;
}

function queueGoalSync(
  options: GoalRepositoryOptions,
  row: GoalRow,
  operation: Exclude<GoalSyncOperation, "Delete">,
): void {
  options.queueSyncEvent?.({
    entity: "goals",
    entityId: row.id,
    operation,
    payload: goalRowPayload(row),
  });
}

function queueFundingSync(
  options: GoalRepositoryOptions,
  row: GoalFundingRuleRow,
  operation: Exclude<GoalSyncOperation, "Delete">,
): void {
  options.queueSyncEvent?.({
    entity: "goals_allocation",
    entityId: row.id,
    operation,
    payload: fundingRowPayload(row),
  });
}

function queueGoalPlanSync(
  options: GoalRepositoryOptions,
  row: GoalPlanRow,
  operation: Exclude<GoalSyncOperation, "Delete">,
): void {
  options.queueSyncEvent?.({
    entity: "goal_plans",
    entityId: row.goal_id,
    operation,
    payload: goalPlanRowPayload(row),
  });
}

function queueSyncDelete(
  options: GoalRepositoryOptions,
  entity: GoalSyncEntity,
  entityId: string,
): void {
  options.queueSyncEvent?.({
    entity,
    entityId,
    operation: "Delete",
    payload: { id: entityId },
  });
}

function goalRowPayload(row: GoalRow): GoalRowPayload {
  return {
    ...goalFromRow(row),
    targetAmount: row.target_amount,
  };
}

function fundingRowPayload(row: GoalFundingRuleRow): GoalFundingRuleRowPayload {
  return fundingRuleFromRow(row);
}

function goalPlanRowPayload(row: GoalPlanRow): GoalPlanRowPayload {
  return goalPlanFromRow(row);
}

function resolveBaseCurrency(options: GoalServiceOptions): string | undefined {
  const baseCurrency =
    typeof options.baseCurrency === "function" ? options.baseCurrency() : options.baseCurrency;
  return baseCurrency && baseCurrency.trim() ? baseCurrency : undefined;
}

function timestampNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
