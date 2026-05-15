import type { TaxBucketBalances } from "./retirement-plan";

export const DEFAULT_DC_PAYOUT_ESTIMATE_RATE = 0.035;

const DEFAULT_BOND_VOLATILITY_RATIO = 0.35;
const MIN_RETURN_STANDARD_DEVIATION = 1e-9;
const DEFAULT_INFLATION_STANDARD_DEVIATION = 0.015;
const RETURN_INFLATION_CORRELATION = -0.25;
const MAX_REQUIRED_CAPITAL_DOUBLING_STEPS = 128;
const REQUIRED_CAPITAL_SEED_MULTIPLE = 30;
const FUNDING_TOLERANCE = 0.999;
const MATERIAL_SHORTFALL_RATE = 0.001;
const MIN_MATERIAL_SHORTFALL = 1;
const SPLITMIX64_INCREMENT = 0x9e37_79b9_7f4a_7c15n;
const SPLITMIX64_MULTIPLIER_1 = 0xbf58_476d_1ce4_e5b9n;
const SPLITMIX64_MULTIPLIER_2 = 0x94d0_49bb_1331_11ebn;
const FNV_OFFSET_BASIS_64 = 0xcbf2_9ce4_8422_2325n;
const FNV_PRIME_64 = 0x0000_0100_0000_01b3n;

export interface RetirementPlan {
  personal: PersonalProfile;
  expenses: ExpenseBudget;
  incomeStreams: RetirementIncomeStream[];
  investment: InvestmentAssumptions;
  tax: TaxProfile | null;
  currency: string;
}

export interface PersonalProfile {
  currentAge: number;
  targetRetirementAge: number;
  planningHorizonAge: number;
  currentAnnualSalary?: number | null;
  salaryGrowthRate?: number | null;
}

export interface ExpenseBudget {
  items: ExpenseBucket[];
}

export interface ExpenseBucket {
  id?: string | null;
  label?: string | null;
  monthlyAmount: number;
  inflationRate?: number | null;
  startAge?: number | null;
  endAge?: number | null;
  essential?: boolean | null;
}

export type StreamKind = "db" | "dc";

export interface RetirementIncomeStream {
  id: string;
  label: string;
  streamType: StreamKind;
  startAge: number;
  adjustForInflation: boolean;
  annualGrowthRate?: number | null;
  monthlyAmount?: number | null;
  linkedAccountId?: string | null;
  currentValue?: number | null;
  monthlyContribution?: number | null;
  accumulationReturn?: number | null;
}

export interface InvestmentAssumptions {
  preRetirementAnnualReturn: number;
  retirementAnnualReturn: number;
  annualInvestmentFeeRate: number;
  annualVolatility: number;
  inflationRate: number;
  monthlyContribution: number;
  contributionGrowthRate: number;
  glidePath?: GlidePathSettings | null;
}

export interface GlidePathSettings {
  enabled: boolean;
  bondAllocationAtFire: number;
  bondAllocationAtHorizon: number;
  bondReturnRate: number;
}

export interface TaxProfile {
  taxableWithdrawalRate: number;
  taxDeferredWithdrawalRate: number;
  taxFreeWithdrawalRate: number;
  earlyWithdrawalPenaltyRate?: number | null;
  earlyWithdrawalPenaltyAge?: number | null;
  countryCode?: string | null;
  withdrawalBuckets: TaxBucketBalances;
}

export interface WithdrawalOutcome {
  remainingBuckets: TaxBucketBalances;
  grossWithdrawal: number;
  spendingFunded: number;
  taxAmount: number;
}

export type RetirementTimingMode = "fire" | "traditional";
export type RetirementStartReason = "funded" | "target_age_forced";

export interface YearlySnapshot {
  age: number;
  year: number;
  phase: "accumulation" | "fire";
  portfolioValue: number;
  portfolioEndValue: number;
  annualContribution: number;
  annualWithdrawal: number;
  annualIncome: number;
  netWithdrawalFromPortfolio: number;
  pensionAssets: number;
  annualTaxes?: number;
  grossWithdrawal?: number;
  plannedExpenses?: number;
  fundedExpenses?: number;
  annualShortfall?: number;
}

export interface RetirementProjection {
  fireAge: number | null;
  fireYear: number | null;
  retirementStartAge: number | null;
  retirementStartReason?: RetirementStartReason;
  portfolioAtFire: number;
  fundedAtRetirement: boolean;
  coastFireAmount: number;
  coastFireReached: boolean;
  yearByYear: YearlySnapshot[];
}

export interface RetirementProjectionOptions {
  currentYear?: number;
}

export interface RetirementOverview {
  analysisMode: RetirementTimingMode;
  status: "on_track" | "at_risk" | "off_track" | "achieved";
  successStatus: "on_track" | "shortfall" | "depleted" | "overfunded";
  desiredFireAge: number;
  fiAge: number | null;
  retirementStartAge: number | null;
  retirementStartReason?: RetirementStartReason;
  fundedAtGoalAge: boolean;
  eventuallyReachesFi: boolean;
  fundedAtRetirementStart: boolean;
  portfolioNow: number;
  portfolioAtRetirementStart: number;
  netFireTarget: number;
  grossFireTarget: number;
  portfolioAtGoalAge: number;
  requiredCapitalReachable: boolean;
  requiredCapitalAtGoalAge: number;
  shortfallAtGoalAge: number;
  surplusAtGoalAge: number;
  fundedThroughAge: number | null;
  failureAge: number | null;
  spendingShortfallAge: number | null;
  requiredAdditionalMonthlyContribution: number;
  suggestedGoalAgeIfUnchanged: number | null;
  coastAmountToday: number;
  coastReached: boolean;
  progress: number;
  taxBucketBalances: TaxBucketBalances;
  budgetBreakdown: BudgetBreakdown;
  targetReconciliation: TargetReconciliation;
  trajectory: RetirementTrajectoryPoint[];
}

export interface RetirementTrajectoryPoint {
  age: number;
  year: number;
  phase: "accumulation" | "fire";
  portfolioStart: number;
  annualContribution: number;
  annualIncome: number;
  annualExpenses: number;
  netWithdrawalFromPortfolio: number;
  portfolioEnd: number;
  requiredCapital: number | null;
  pensionAssets: number;
  annualTaxes?: number;
  grossWithdrawal?: number;
  plannedExpenses?: number;
  fundedExpenses?: number;
  annualShortfall?: number;
}

export interface ScenarioResult {
  label: string;
  annualReturn: number;
  fireAge: number | null;
  portfolioAtHorizon: number;
  fundedAtGoalAge: boolean;
  success: boolean;
  failureAge?: number | null;
  spendingShortfallAge?: number | null;
  yearByYear: YearlySnapshot[];
}

export type StressTestId =
  | "return-drag"
  | "inflation-shock"
  | "spending-shock"
  | "retire-earlier"
  | "save-less"
  | "early-crash";

export type StressCategory = "market" | "inflation" | "spending" | "timing" | "saving";
export type StressSeverity = "low" | "medium" | "high";

export interface StressOutcome {
  fiAge: number | null;
  retirementStartAge: number | null;
  fundedAtGoalAge: boolean;
  shortfallAtGoalAge: number;
  portfolioAtHorizon: number;
  failureAge?: number | null;
  spendingShortfallAge?: number | null;
}

export interface StressDelta {
  fiAgeYears: number | null;
  shortfallAtGoalAge: number;
  portfolioAtHorizon: number;
}

export interface StressTestResult {
  id: StressTestId;
  label: string;
  description: string;
  category: StressCategory;
  baseline: StressOutcome;
  stressed: StressOutcome;
  delta: StressDelta;
  severity: StressSeverity;
}

export type DecisionSensitivityMap = "contribution-return" | "retirement-age-spending";

export interface DecisionSensitivityMatrix {
  rowLabel: string;
  columnLabel: string;
  rowValues: number[];
  columnValues: number[];
  rowLabels: string[];
  columnLabels: string[];
  cells: DecisionSensitivityCell[][];
  baselineRow?: number | null;
  baselineColumn?: number | null;
}

export interface DecisionSensitivityCell {
  fiAge: number | null;
  retirementStartAge: number | null;
  fundedAtGoalAge: boolean;
  shortfallAtGoalAge: number;
  portfolioAtHorizon: number;
}

export interface SorrScenario {
  label: string;
  returns: number[];
  portfolioPath: number[];
  finalValue: number;
  survived: boolean;
  failureAge?: number | null;
  spendingShortfallAge?: number | null;
}

export interface PercentilePaths {
  p10: number[];
  p25: number[];
  p50: number[];
  p75: number[];
  p90: number[];
}

export interface FinalPortfolioPercentiles {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface MonteCarloResult {
  successRate: number;
  medianFireAge?: number | null;
  percentiles: PercentilePaths;
  ageAxis: number[];
  finalPortfolioAtHorizon: FinalPortfolioPercentiles;
  nSimulations: number;
}

export interface BudgetBreakdown {
  totalMonthlyBudget: number;
  monthlyPortfolioWithdrawal: number;
  incomeStreams: BudgetStreamItem[];
  effectiveTaxRate?: number;
}

export interface BudgetStreamItem {
  label: string;
  monthlyAmount: number;
  percentageOfBudget: number;
}

export interface TargetReconciliation {
  targetAge: number;
  requiredCapitalReachable: boolean;
  inflationFactorToTarget: number;
  plannedAnnualExpensesTodayValue: number;
  plannedAnnualExpensesNominal: number;
  annualIncomeTodayValue: number;
  annualIncomeNominal: number;
  netAnnualSpendingGapTodayValue: number;
  netAnnualSpendingGapNominal: number;
  grossAnnualPortfolioWithdrawalTodayValue: number;
  grossAnnualPortfolioWithdrawalNominal: number;
  estimatedAnnualTaxesTodayValue: number;
  estimatedAnnualTaxesNominal: number;
  requiredCapitalTodayValue: number;
  requiredCapitalNominal: number;
  portfolioAtTargetTodayValue: number;
  portfolioAtTargetNominal: number;
  shortfallTodayValue: number;
  shortfallNominal: number;
  preRetirementNetReturn: number;
  retirementNetReturn: number;
  annualInvestmentFeeRate: number;
}

type TaxBucketKind = "taxable" | "taxDeferred" | "taxFree";
export type RequiredCapitalCache = Map<number, number | null>;

export function taxBucketTotal(buckets: TaxBucketBalances): number {
  return buckets.taxable + buckets.taxDeferred + buckets.taxFree;
}

export function scaleTaxBucketBalances(
  buckets: TaxBucketBalances,
  total: number,
): TaxBucketBalances {
  const sourceTotal = taxBucketTotal(buckets);
  if (total <= 0) {
    return emptyTaxBucketBalances();
  }
  if (sourceTotal <= 0) {
    return { taxable: total, taxDeferred: 0, taxFree: 0 };
  }
  const scale = total / sourceTotal;
  return {
    taxable: buckets.taxable * scale,
    taxDeferred: buckets.taxDeferred * scale,
    taxFree: buckets.taxFree * scale,
  };
}

export function initialWithdrawalBuckets(
  tax: TaxProfile | null,
  totalPortfolio: number,
): TaxBucketBalances {
  if (tax) {
    return scaleTaxBucketBalances(tax.withdrawalBuckets, Math.max(totalPortfolio, 0));
  }
  return { taxable: Math.max(totalPortfolio, 0), taxDeferred: 0, taxFree: 0 };
}

export function applyGrowthToTaxBuckets(
  buckets: TaxBucketBalances,
  annualReturn: number,
): TaxBucketBalances {
  const growth = 1 + annualReturn;
  if (!Number.isFinite(growth) || growth <= 0) {
    return emptyTaxBucketBalances();
  }
  return {
    taxable: buckets.taxable * growth,
    taxDeferred: buckets.taxDeferred * growth,
    taxFree: buckets.taxFree * growth,
  };
}

export function addContributionToTaxBuckets(
  buckets: TaxBucketBalances,
  contribution: number,
  tax: TaxProfile | null,
): TaxBucketBalances {
  if (contribution <= 0) {
    return buckets;
  }
  const allocation = tax
    ? scaleTaxBucketBalances(tax.withdrawalBuckets, contribution)
    : { taxable: contribution, taxDeferred: 0, taxFree: 0 };
  return {
    taxable: buckets.taxable + allocation.taxable,
    taxDeferred: buckets.taxDeferred + allocation.taxDeferred,
    taxFree: buckets.taxFree + allocation.taxFree,
  };
}

export function computeGrossWithdrawal(
  spendingGap: number,
  tax: TaxProfile | null,
  age: number,
): [grossWithdrawal: number, taxAmount: number] {
  if (spendingGap <= 0) {
    return [0, 0];
  }
  if (!tax) {
    return [spendingGap, 0];
  }

  const total = taxBucketTotal(tax.withdrawalBuckets);
  const rate =
    total > 0
      ? clamp(
          (tax.withdrawalBuckets.taxable / total) * effectiveTaxRate(tax, "taxable", age) +
            (tax.withdrawalBuckets.taxDeferred / total) *
              effectiveTaxRate(tax, "taxDeferred", age) +
            (tax.withdrawalBuckets.taxFree / total) * effectiveTaxRate(tax, "taxFree", age),
          0,
          0.99,
        )
      : effectiveTaxRate(tax, "taxable", age);

  const gross = spendingGap / (1 - rate);
  return [gross, gross - spendingGap];
}

export function applyPlannedSpendingWithdrawal(
  availableBuckets: TaxBucketBalances,
  totalExpenses: number,
  income: number,
  tax: TaxProfile | null,
  age: number,
): WithdrawalOutcome {
  return withdrawForNetTarget(Math.max(totalExpenses - income, 0), availableBuckets, tax, age);
}

export function netAnnualReturn(grossReturn: number, annualFeeRate: number): number {
  return Math.max(grossReturn - annualFeeRate, -0.99);
}

export function planAccumulationReturn(plan: RetirementPlan): number {
  return netAnnualReturn(
    plan.investment.preRetirementAnnualReturn,
    plan.investment.annualInvestmentFeeRate,
  );
}

export function planRetirementReturn(plan: RetirementPlan): number {
  return netAnnualReturn(
    plan.investment.retirementAnnualReturn,
    plan.investment.annualInvestmentFeeRate,
  );
}

export function boundedInflationFactor(rate: number, years: number): number {
  return clamp(Math.pow(1 + rate, years), 0.01, Number.MAX_VALUE);
}

export function endOfYearValueOfMonthlyContributions(
  monthlyAmount: number,
  annualReturn: number,
): number {
  if (monthlyAmount <= 0 || !Number.isFinite(monthlyAmount)) {
    return 0;
  }
  const monthlyGrowth = Math.pow(Math.max(1 + annualReturn, 0.01), 1 / 12);
  const monthlyReturn = monthlyGrowth - 1;
  if (Math.abs(monthlyReturn) <= 1e-9) {
    return monthlyAmount * 12;
  }
  return (monthlyAmount * (Math.pow(monthlyGrowth, 12) - 1)) / monthlyReturn;
}

export function annualExpensesAtYear(
  budget: ExpenseBudget,
  age: number,
  yearsFromNow: number,
  generalInflation: number,
): [totalExpenses: number, essentialExpenses: number] {
  let total = 0;
  let essential = 0;
  for (const bucket of budget.items) {
    if (bucket.startAge !== undefined && bucket.startAge !== null && age < bucket.startAge) {
      continue;
    }
    if (bucket.endAge !== undefined && bucket.endAge !== null && age >= bucket.endAge) {
      continue;
    }
    const rate = bucket.inflationRate ?? generalInflation;
    const annual = bucket.monthlyAmount * 12 * Math.pow(1 + rate, yearsFromNow);
    total += annual;
    if (bucket.essential ?? true) {
      essential += annual;
    }
  }
  return [total, essential];
}

export function annualExpensesAtYearStochastic(
  budget: ExpenseBudget,
  age: number,
  yearsFromNow: number,
  cumulativeInflation: number,
): [totalExpenses: number, essentialExpenses: number] {
  let total = 0;
  let essential = 0;
  for (const bucket of budget.items) {
    if (bucket.startAge !== undefined && bucket.startAge !== null && age < bucket.startAge) {
      continue;
    }
    if (bucket.endAge !== undefined && bucket.endAge !== null && age >= bucket.endAge) {
      continue;
    }
    const annual =
      bucket.inflationRate === undefined || bucket.inflationRate === null
        ? bucket.monthlyAmount * 12 * cumulativeInflation
        : bucket.monthlyAmount * 12 * Math.pow(1 + bucket.inflationRate, yearsFromNow);
    total += annual;
    if (bucket.essential ?? true) {
      essential += annual;
    }
  }
  return [total, essential];
}

export function resolvePlanDcPayouts(
  streams: RetirementIncomeStream[],
  currentAge: number,
  retirementAge: number,
  defaultAccumulationReturn: number,
): Map<string, number> {
  const payouts = new Map<string, number>();
  for (const stream of streams) {
    if (stream.streamType !== "dc") {
      continue;
    }
    if (stream.startAge <= currentAge) {
      const fallback =
        (Math.max(stream.currentValue ?? 0, 0) * DEFAULT_DC_PAYOUT_ESTIMATE_RATE) / 12;
      payouts.set(stream.id, Math.max(stream.monthlyAmount ?? fallback, 0));
      continue;
    }

    const totalYears = Math.max(stream.startAge - currentAge, 0);
    const contribYears = Math.max(Math.min(stream.startAge, retirementAge) - currentAge, 0);
    const growthOnlyYears = totalYears - contribYears;
    const rate = Math.max(stream.accumulationReturn ?? defaultAccumulationReturn, -0.99);
    const initial = stream.currentValue ?? 0;
    const monthlyContribution = stream.monthlyContribution ?? 0;
    const futureValueLump = initial * Math.pow(1 + rate, totalYears);
    const annualContributionEndValue = endOfYearValueOfMonthlyContributions(
      monthlyContribution,
      rate,
    );
    const futureValueAnnuityAtStop =
      rate > 1e-9
        ? (annualContributionEndValue * (Math.pow(1 + rate, contribYears) - 1)) / rate
        : monthlyContribution * 12 * contribYears;
    const futureValueAnnuity = futureValueAnnuityAtStop * Math.pow(1 + rate, growthOnlyYears);
    payouts.set(
      stream.id,
      ((futureValueLump + futureValueAnnuity) * DEFAULT_DC_PAYOUT_ESTIMATE_RATE) / 12,
    );
  }
  return payouts;
}

export function planIncomeAtAge(
  streams: RetirementIncomeStream[],
  resolvedPayouts: ReadonlyMap<string, number>,
  age: number,
  yearsFromNow: number,
  inflationRate: number,
): number {
  let total = 0;
  for (const stream of streams) {
    if (age < stream.startAge) {
      continue;
    }
    const baseMonthly = resolvedPayouts.get(stream.id) ?? stream.monthlyAmount ?? 0;
    const annual = baseMonthly * 12;
    if (stream.annualGrowthRate !== undefined && stream.annualGrowthRate !== null) {
      total += annual * Math.pow(1 + stream.annualGrowthRate, yearsFromNow);
    } else if (stream.adjustForInflation) {
      total += annual * Math.pow(1 + inflationRate, yearsFromNow);
    } else {
      total += annual;
    }
  }
  return total;
}

export function planIncomeAtAgeStochastic(
  streams: RetirementIncomeStream[],
  resolvedPayouts: ReadonlyMap<string, number>,
  age: number,
  yearsFromNow: number,
  inflationRate: number,
  cumulativeInflation?: number,
): number {
  let total = 0;
  for (const stream of streams) {
    if (age < stream.startAge) {
      continue;
    }
    const baseMonthly = resolvedPayouts.get(stream.id) ?? stream.monthlyAmount ?? 0;
    const annual = baseMonthly * 12;
    if (stream.annualGrowthRate !== undefined && stream.annualGrowthRate !== null) {
      total += annual * Math.pow(1 + stream.annualGrowthRate, yearsFromNow);
    } else if (stream.adjustForInflation) {
      total +=
        cumulativeInflation === undefined
          ? annual * Math.pow(1 + inflationRate, yearsFromNow)
          : annual * cumulativeInflation;
    } else {
      total += annual;
    }
  }
  return total;
}

export function stepPlanPensionFunds(
  streams: RetirementIncomeStream[],
  balances: Map<string, number>,
  age: number,
  inRetirement: boolean,
): void {
  for (const stream of streams) {
    const hasAccumulation = (stream.currentValue ?? 0) > 0 || (stream.monthlyContribution ?? 0) > 0;
    if (!hasAccumulation) {
      continue;
    }
    const current = balances.get(stream.id) ?? stream.currentValue ?? 0;
    if (age < stream.startAge) {
      const rate = stream.accumulationReturn ?? 0.04;
      const contributions = inRetirement ? 0 : (stream.monthlyContribution ?? 0) * 12;
      balances.set(stream.id, current * (1 + rate) + contributions);
    } else {
      balances.set(stream.id, 0);
    }
  }
}

export function planBlendedReturn(
  plan: RetirementPlan,
  yearIndex: number,
  inRetirement: boolean,
  retirementStartAge: number,
): number {
  const accumulationReturn = planAccumulationReturn(plan);
  const retirementReturn = planRetirementReturn(plan);
  if (!inRetirement) {
    return accumulationReturn;
  }

  const glidePath = plan.investment.glidePath;
  if (!glidePath?.enabled) {
    return retirementReturn;
  }
  const yearsToRetirement = Math.max(retirementStartAge - plan.personal.currentAge, 0);
  const yearsInRetirement = Math.max(plan.personal.planningHorizonAge - retirementStartAge, 1);
  const yearsFromRetirement = Math.max(yearIndex - yearsToRetirement, 0);
  const t = clamp(yearsFromRetirement / yearsInRetirement, 0, 1);
  const bondPct = clamp(
    glidePath.bondAllocationAtFire +
      t * (glidePath.bondAllocationAtHorizon - glidePath.bondAllocationAtFire),
    0,
    1,
  );
  const stockPct = 1 - bondPct;
  const bondReturn = netAnnualReturn(
    glidePath.bondReturnRate,
    plan.investment.annualInvestmentFeeRate,
  );
  return stockPct * retirementReturn + bondPct * bondReturn;
}

export function computeRequiredCapital(plan: RetirementPlan, retirementAge: number): number | null {
  return tryComputeRequiredCapital(plan, retirementAge);
}

export function requiredCapitalFor(
  plan: RetirementPlan,
  retirementAge: number,
  cache: RequiredCapitalCache,
): number | null {
  if (cache.has(retirementAge)) {
    return cache.get(retirementAge) ?? null;
  }
  const required = tryComputeRequiredCapital(plan, retirementAge);
  cache.set(retirementAge, required);
  return required;
}

export function tryComputeRequiredCapital(
  plan: RetirementPlan,
  retirementAge: number,
): number | null {
  if (retirementAge > plan.personal.planningHorizonAge) {
    return 0;
  }
  if (retirementFeasibleFromCapital(plan, retirementAge, 0)) {
    return 0;
  }

  let upperBound = Math.max(initialRequiredCapitalUpperBound(plan, retirementAge), 1);
  for (let step = 0; step < MAX_REQUIRED_CAPITAL_DOUBLING_STEPS; step += 1) {
    if (retirementFeasibleFromCapital(plan, retirementAge, upperBound)) {
      break;
    }
    if (!Number.isFinite(upperBound) || upperBound >= Number.MAX_VALUE / 2) {
      return null;
    }
    upperBound *= 2;
  }
  if (!retirementFeasibleFromCapital(plan, retirementAge, upperBound)) {
    return null;
  }

  let lowerBound = 0;
  for (let step = 0; step < 50; step += 1) {
    const midpoint = (lowerBound + upperBound) / 2;
    if (retirementFeasibleFromCapital(plan, retirementAge, midpoint)) {
      upperBound = midpoint;
    } else {
      lowerBound = midpoint;
    }
  }
  return upperBound;
}

export function retirementFeasibleFromCapital(
  plan: RetirementPlan,
  retirementAge: number,
  startingCapital: number,
): boolean {
  const currentAge = plan.personal.currentAge;
  const horizon = plan.personal.planningHorizonAge;
  const inflation = plan.investment.inflationRate;
  const yearsToRetirement = Math.max(retirementAge - currentAge, 0);
  const resolvedPayouts = resolvePlanDcPayouts(
    plan.incomeStreams,
    currentAge,
    retirementAge,
    planAccumulationReturn(plan),
  );

  let buckets = initialWithdrawalBuckets(plan.tax, Math.max(startingCapital, 0));
  const yearsInRetirement = Math.max(horizon - retirementAge, 0);
  for (let yearIndex = 0; yearIndex <= yearsInRetirement; yearIndex += 1) {
    const age = retirementAge + yearIndex;
    const yearsFromNow = yearsToRetirement + yearIndex;
    const annualReturn = planBlendedReturn(plan, yearsFromNow, true, retirementAge);
    const grownBuckets = applyGrowthToTaxBuckets(buckets, annualReturn);
    const [expenses] = annualExpensesAtYear(plan.expenses, age, yearsFromNow, inflation);
    const income = planIncomeAtAge(
      plan.incomeStreams,
      resolvedPayouts,
      age,
      yearsFromNow,
      inflation,
    );
    const outcome = applyPlannedSpendingWithdrawal(grownBuckets, expenses, income, plan.tax, age);
    const spendingGap = Math.max(expenses - income, 0);
    if (outcome.spendingFunded < spendingGap * FUNDING_TOLERANCE) {
      return false;
    }
    buckets = outcome.remainingBuckets;
  }
  return taxBucketTotal(buckets) > 0;
}

export function retirementStartDecision(
  mode: RetirementTimingMode,
  age: number,
  targetAge: number,
  portfolio: number,
  requiredCapital: number | null,
): RetirementStartReason | null {
  if (mode === "fire") {
    if (age >= targetAge && requiredCapital !== null && portfolio >= requiredCapital) {
      return "funded";
    }
    return null;
  }
  if (age >= targetAge && requiredCapital !== null && portfolio >= requiredCapital) {
    return "funded";
  }
  if (age >= targetAge) {
    return "target_age_forced";
  }
  return null;
}

export function projectRetirement(
  plan: RetirementPlan,
  currentPortfolio: number,
  options: RetirementProjectionOptions = {},
): RetirementProjection {
  return projectRetirementWithMode(plan, currentPortfolio, "fire", options);
}

export function projectRetirementWithMode(
  plan: RetirementPlan,
  currentPortfolio: number,
  mode: RetirementTimingMode,
  options: RetirementProjectionOptions = {},
): RetirementProjection {
  const cache: RequiredCapitalCache = new Map();
  return projectRetirementWithModeCached(plan, currentPortfolio, mode, cache, options);
}

export function projectRetirementWithModeCached(
  plan: RetirementPlan,
  currentPortfolio: number,
  mode: RetirementTimingMode,
  requiredCapitalCache: RequiredCapitalCache,
  options: RetirementProjectionOptions = {},
): RetirementProjection {
  const targetAtGoal = requiredCapitalFor(
    plan,
    plan.personal.targetRetirementAge,
    requiredCapitalCache,
  );
  const coastAmount = computeCoastAmountAtGoal(plan, targetAtGoal);
  const startYear = options.currentYear ?? new Date().getFullYear();
  const currentAge = plan.personal.currentAge;
  const horizonYears = Math.max(plan.personal.planningHorizonAge - currentAge, 1);
  const contributionGrowth =
    plan.personal.salaryGrowthRate ?? plan.investment.contributionGrowthRate;
  const inflation = plan.investment.inflationRate;

  let buckets = initialWithdrawalBuckets(plan.tax, currentPortfolio);
  let fireAge: number | null = null;
  let fireYear: number | null = null;
  let retirementStartAge: number | null = null;
  let retirementStartReason: RetirementStartReason | undefined;
  let portfolioAtFire = 0;
  let fundedAtRetirement = false;
  let inRetirement = false;
  let actualRetirementAge = plan.personal.targetRetirementAge;
  let resolvedPayouts: Map<string, number> | null = null;
  const yearByYear: YearlySnapshot[] = [];
  const pensionBalances = new Map(
    plan.incomeStreams.map((stream) => [stream.id, stream.currentValue ?? 0]),
  );

  for (let yearIndex = 0; yearIndex <= horizonYears; yearIndex += 1) {
    const age = currentAge + yearIndex;
    const year = startYear + yearIndex;
    const portfolio = taxBucketTotal(buckets);
    const pensionAssets = plan.incomeStreams
      .filter((stream) => {
        const hasAccumulation =
          (stream.currentValue ?? 0) > 0 || (stream.monthlyContribution ?? 0) > 0;
        return hasAccumulation && age < stream.startAge;
      })
      .reduce(
        (total, stream) => total + (pensionBalances.get(stream.id) ?? stream.currentValue ?? 0),
        0,
      );

    if (!inRetirement) {
      const required = requiredCapitalFor(plan, age, requiredCapitalCache);
      if (fireAge === null && required !== null && portfolio >= required) {
        fireAge = age;
        fireYear = year;
        portfolioAtFire = portfolio;
      }
      const startReason = retirementStartDecision(
        mode,
        age,
        plan.personal.targetRetirementAge,
        portfolio,
        required,
      );
      if (startReason !== null) {
        inRetirement = true;
        actualRetirementAge = age;
        retirementStartAge = age;
        retirementStartReason = startReason;
        if (startReason === "funded") {
          fundedAtRetirement = true;
        }
        resolvedPayouts = resolvePlanDcPayouts(
          plan.incomeStreams,
          currentAge,
          age,
          planAccumulationReturn(plan),
        );
      }
    }

    const annualReturn = planBlendedReturn(plan, yearIndex, inRetirement, actualRetirementAge);
    if (inRetirement) {
      const payouts = resolvedPayouts ?? new Map<string, number>();
      const [totalExpenses] = annualExpensesAtYear(plan.expenses, age, yearIndex, inflation);
      const income = planIncomeAtAge(plan.incomeStreams, payouts, age, yearIndex, inflation);
      const grownBuckets = applyGrowthToTaxBuckets(buckets, annualReturn);
      const outcome = applyPlannedSpendingWithdrawal(
        grownBuckets,
        totalExpenses,
        income,
        plan.tax,
        age,
      );
      const shortfall = Math.max(totalExpenses - outcome.spendingFunded - income, 0);
      const remainingBuckets = outcome.remainingBuckets;
      const portfolioEndValue = Math.max(taxBucketTotal(remainingBuckets), 0);
      yearByYear.push({
        age,
        year,
        phase: "fire",
        portfolioValue: Math.max(portfolio, 0),
        portfolioEndValue,
        annualContribution: 0,
        annualWithdrawal: outcome.spendingFunded + income,
        annualIncome: income,
        netWithdrawalFromPortfolio: outcome.spendingFunded,
        pensionAssets,
        annualTaxes: outcome.taxAmount,
        grossWithdrawal: outcome.grossWithdrawal,
        plannedExpenses: totalExpenses,
        fundedExpenses: outcome.spendingFunded + income,
        annualShortfall: shortfall,
      });
      buckets = remainingBuckets;
    } else {
      const monthlyContribution =
        plan.investment.monthlyContribution * Math.pow(1 + contributionGrowth, yearIndex);
      const annualContribution = monthlyContribution * 12;
      const contributionEndValue = endOfYearValueOfMonthlyContributions(
        monthlyContribution,
        annualReturn,
      );
      const grownBuckets = applyGrowthToTaxBuckets(buckets, annualReturn);
      const nextBuckets = addContributionToTaxBuckets(grownBuckets, contributionEndValue, plan.tax);
      const portfolioEndValue = Math.max(taxBucketTotal(nextBuckets), 0);
      yearByYear.push({
        age,
        year,
        phase: "accumulation",
        portfolioValue: portfolio,
        portfolioEndValue,
        annualContribution,
        annualWithdrawal: 0,
        annualIncome: 0,
        netWithdrawalFromPortfolio: 0,
        pensionAssets,
      });
      buckets = nextBuckets;
    }

    stepPlanPensionFunds(plan.incomeStreams, pensionBalances, age, inRetirement);
  }

  return {
    fireAge,
    fireYear,
    retirementStartAge,
    ...(retirementStartReason === undefined ? {} : { retirementStartReason }),
    portfolioAtFire,
    fundedAtRetirement,
    coastFireAmount: coastAmount,
    coastFireReached: targetAtGoal !== null && currentPortfolio >= coastAmount,
    yearByYear,
  };
}

export function computeRetirementOverview(
  plan: RetirementPlan,
  currentPortfolio: number,
  analysisMode: string,
  options: RetirementProjectionOptions = {},
): RetirementOverview {
  return computeRetirementOverviewWithMode(
    plan,
    currentPortfolio,
    retirementTimingModeFromString(analysisMode),
    options,
  );
}

export function computeRetirementOverviewWithMode(
  plan: RetirementPlan,
  currentPortfolio: number,
  mode: RetirementTimingMode,
  options: RetirementProjectionOptions = {},
): RetirementOverview {
  const requiredCapitalCache: RequiredCapitalCache = new Map();
  const netTargetToday = requiredCapitalFor(plan, plan.personal.currentAge, requiredCapitalCache);
  const requiredCapital = requiredCapitalFor(
    plan,
    plan.personal.targetRetirementAge,
    requiredCapitalCache,
  );
  const netTargetTodayValue = netTargetToday ?? 0;
  const requiredCapitalValue = requiredCapital ?? 0;
  const coast = computeCoastAmountAtGoal(plan, requiredCapital);
  const projection = projectRetirementWithModeCached(
    plan,
    currentPortfolio,
    mode,
    requiredCapitalCache,
    options,
  );

  const fiAge = projection.fireAge;
  const retirementStartAge = projection.retirementStartAge;
  const portfolioAtRetirementStart =
    retirementStartAge === null
      ? 0
      : (projection.yearByYear.find((snapshot) => snapshot.age === retirementStartAge)
          ?.portfolioValue ?? 0);
  const portfolioAtGoal =
    projection.yearByYear.find((snapshot) => snapshot.age === plan.personal.targetRetirementAge)
      ?.portfolioValue ?? 0;
  const requiredCapitalReachable = requiredCapital !== null;
  const fundedAtGoalAge = requiredCapital !== null && portfolioAtGoal >= requiredCapital;
  const shortfall = requiredCapital === null ? 0 : Math.max(requiredCapital - portfolioAtGoal, 0);
  const surplus = requiredCapital === null ? 0 : Math.max(portfolioAtGoal - requiredCapital, 0);
  const failureAge =
    projection.yearByYear.find(
      (snapshot) => snapshot.phase === "fire" && snapshot.portfolioValue <= 0,
    )?.age ?? null;
  const spendingShortfallAge =
    projection.yearByYear.find((snapshot) => hasMaterialSpendingShortfall(snapshot))?.age ?? null;
  const firstUnfundedAge =
    failureAge === null
      ? spendingShortfallAge
      : spendingShortfallAge === null
        ? failureAge
        : Math.min(failureAge, spendingShortfallAge);
  const fundedThroughAge =
    firstUnfundedAge === null
      ? plan.personal.planningHorizonAge
      : Math.max(firstUnfundedAge - 1, 0);
  const requiredAdditional =
    shortfall > 0
      ? solveRequiredAdditionalMonthly(plan, currentPortfolio, requiredCapitalValue)
      : 0;
  const suggestedAge = fundedAtGoalAge
    ? null
    : findFiAgeAccumulationOnly(plan, currentPortfolio, requiredCapitalCache);
  const effectiveFiAge = fiAge ?? suggestedAge;
  const eventuallyReachesFi = effectiveFiAge !== null;
  const hasRetirementGap = failureAge !== null || spendingShortfallAge !== null;
  const status = retirementOverviewStatus(
    requiredCapitalReachable,
    netTargetToday !== null,
    hasRetirementGap,
    currentPortfolio,
    netTargetTodayValue,
    fundedAtGoalAge,
    effectiveFiAge,
    plan.personal.targetRetirementAge,
  );
  const successStatus = retirementOverviewSuccessStatus(
    requiredCapitalReachable,
    failureAge,
    shortfall,
    spendingShortfallAge,
    requiredCapitalValue,
    surplus,
  );
  const progress =
    netTargetTodayValue > 0 ? Math.min(currentPortfolio / netTargetTodayValue, 1) : 0;
  const fireAgeForBudget = retirementStartAge ?? plan.personal.targetRetirementAge;

  return {
    analysisMode: mode,
    status,
    successStatus,
    desiredFireAge: plan.personal.targetRetirementAge,
    fiAge,
    retirementStartAge,
    ...(projection.retirementStartReason === undefined
      ? {}
      : { retirementStartReason: projection.retirementStartReason }),
    fundedAtGoalAge,
    eventuallyReachesFi,
    fundedAtRetirementStart: projection.fundedAtRetirement,
    portfolioNow: currentPortfolio,
    portfolioAtRetirementStart,
    netFireTarget: netTargetTodayValue,
    grossFireTarget: requiredCapitalValue,
    portfolioAtGoalAge: portfolioAtGoal,
    requiredCapitalReachable,
    requiredCapitalAtGoalAge: requiredCapitalValue,
    shortfallAtGoalAge: shortfall,
    surplusAtGoalAge: surplus,
    fundedThroughAge,
    failureAge,
    spendingShortfallAge,
    requiredAdditionalMonthlyContribution: requiredAdditional,
    suggestedGoalAgeIfUnchanged: suggestedAge,
    coastAmountToday: coast,
    coastReached: requiredCapitalReachable && currentPortfolio >= coast,
    progress,
    taxBucketBalances: plan.tax?.withdrawalBuckets ?? emptyTaxBucketBalances(),
    budgetBreakdown: computeBudgetBreakdown(plan, fireAgeForBudget),
    targetReconciliation: computeTargetReconciliation(
      plan,
      plan.personal.targetRetirementAge,
      requiredCapital,
      portfolioAtGoal,
    ),
    trajectory: buildTrajectory(projection.yearByYear, plan, requiredCapitalCache),
  };
}

export function runScenarioAnalysisWithMode(
  plan: RetirementPlan,
  currentPortfolio: number,
  mode: RetirementTimingMode,
): ScenarioResult[] {
  const scenarios: Array<[string, number]> = [
    ["Pessimistic", -0.02],
    ["Base case", 0],
    ["Optimistic", 0.015],
  ];

  return scenarios.map(([label, delta]) => {
    const adjusted: RetirementPlan = {
      ...plan,
      investment: {
        ...plan.investment,
        preRetirementAnnualReturn: plan.investment.preRetirementAnnualReturn + delta,
        retirementAnnualReturn: plan.investment.retirementAnnualReturn + delta,
      },
    };
    const projection = projectRetirementWithMode(adjusted, currentPortfolio, mode);
    const overview = computeRetirementOverviewWithMode(adjusted, currentPortfolio, mode);
    const lastSnapshot = projection.yearByYear.at(-1);
    const success =
      overview.successStatus === "on_track" || overview.successStatus === "overfunded";

    return {
      label,
      annualReturn: planAccumulationReturn(adjusted),
      fireAge: projection.fireAge,
      portfolioAtHorizon: lastSnapshot?.portfolioEndValue ?? 0,
      fundedAtGoalAge: overview.fundedAtGoalAge,
      success,
      failureAge: overview.failureAge,
      spendingShortfallAge: overview.spendingShortfallAge,
      yearByYear: projection.yearByYear,
    };
  });
}

export function runScenarioAnalysis(
  plan: RetirementPlan,
  currentPortfolio: number,
): ScenarioResult[] {
  return runScenarioAnalysisWithMode(plan, currentPortfolio, "fire");
}

export function runStressTestsWithMode(
  plan: RetirementPlan,
  currentPortfolio: number,
  mode: RetirementTimingMode,
): StressTestResult[] {
  const baselineOutcome = riskLabPlanOutcome(plan, currentPortfolio, mode);
  const baseline = stressOutcomeFromPlanOutcome(baselineOutcome);
  const severityBase = Math.max(baselineOutcome.requiredCapitalAtGoalAge, 1);
  const specs = [
    buildPlanStress(
      "return-drag",
      "Lower returns",
      "Pre-retirement and retirement returns are 2 percentage points lower.",
      "market",
      plan,
      currentPortfolio,
      mode,
      baseline,
      severityBase,
      applyReturnDragStress,
    ),
    buildPlanStress(
      "inflation-shock",
      "Inflation shock",
      "General inflation is 1.5 percentage points higher.",
      "inflation",
      plan,
      currentPortfolio,
      mode,
      baseline,
      severityBase,
      applyInflationShockStress,
    ),
    buildPlanStress(
      "spending-shock",
      "Higher spending",
      "All retirement spending lines are 10% higher.",
      "spending",
      plan,
      currentPortfolio,
      mode,
      baseline,
      severityBase,
      applySpendingShockStress,
    ),
    buildPlanStress(
      "retire-earlier",
      "Retire 2 years earlier",
      "Desired retirement age is moved two years earlier.",
      "timing",
      plan,
      currentPortfolio,
      mode,
      baseline,
      severityBase,
      applyRetireEarlierStress,
    ),
    buildPlanStress(
      "save-less",
      "Save less",
      "Monthly contributions are 25% lower.",
      "saving",
      plan,
      currentPortfolio,
      mode,
      baseline,
      severityBase,
      applySaveLessStress,
    ),
    buildEarlyCrashStress(plan, baselineOutcome, baseline, severityBase),
  ];

  return specs.sort(
    (left, right) =>
      severityRank(right.severity) - severityRank(left.severity) ||
      right.delta.shortfallAtGoalAge - left.delta.shortfallAtGoalAge,
  );
}

export function runStressTests(plan: RetirementPlan, currentPortfolio: number): StressTestResult[] {
  return runStressTestsWithMode(plan, currentPortfolio, "fire");
}

export function runDecisionSensitivityMatrixWithMode(
  plan: RetirementPlan,
  currentPortfolio: number,
  mode: RetirementTimingMode,
  map: DecisionSensitivityMap,
): DecisionSensitivityMatrix {
  if (map === "contribution-return") {
    return buildContributionReturnSensitivity(plan, currentPortfolio, mode);
  }
  return buildRetirementAgeSpendingSensitivity(plan, currentPortfolio, mode);
}

export function runSorr(
  plan: RetirementPlan,
  portfolioAtFire: number,
  retirementStartAge: number,
): SorrScenario[] {
  if (portfolioAtFire <= 0) {
    return [];
  }

  const resolvedPayouts = resolvePlanDcPayouts(
    plan.incomeStreams,
    plan.personal.currentAge,
    retirementStartAge,
    planAccumulationReturn(plan),
  );
  const retirementReturn = planRetirementReturn(plan);
  const years = Math.max(plan.personal.planningHorizonAge - retirementStartAge, 0);
  if (years === 0) {
    return [];
  }
  const yearsToFire = Math.max(retirementStartAge - plan.personal.currentAge, 0);
  const inflation = plan.investment.inflationRate;

  const crashYear1 = Array.from({ length: years }, () => retirementReturn);
  crashYear1[0] = -0.3;

  const crashYear5 = Array.from({ length: years }, () => retirementReturn);
  if (years >= 5) {
    crashYear5[4] = -0.3;
  }

  const doubleCrash = Array.from({ length: years }, () => retirementReturn);
  doubleCrash[0] = -0.25;
  if (years >= 5) {
    doubleCrash[4] = -0.2;
  }

  const lostDecade = Array.from({ length: years }, () => retirementReturn);
  for (let index = 0; index < Math.min(10, lostDecade.length); index += 1) {
    lostDecade[index] = 0;
  }

  const scenarios: Array<[string, number[]]> = [
    ["Base case", Array.from({ length: years }, () => retirementReturn)],
    ["Crash Year 1 (-30%)", crashYear1],
    ["Crash Year 5 (-30%)", crashYear5],
    ["Double Crash", doubleCrash],
    ["Lost Decade", lostDecade],
  ];

  return scenarios.map(([label, returns]) =>
    runSorrScenario(
      plan,
      portfolioAtFire,
      retirementStartAge,
      yearsToFire,
      inflation,
      resolvedPayouts,
      label,
      returns,
    ),
  );
}

export function runMonteCarlo(
  plan: RetirementPlan,
  currentPortfolio: number,
  nSimulations: number,
): MonteCarloResult {
  return runMonteCarloWithModeAndSeed(plan, currentPortfolio, nSimulations, "fire");
}

export function runMonteCarloWithMode(
  plan: RetirementPlan,
  currentPortfolio: number,
  nSimulations: number,
  mode: RetirementTimingMode,
): MonteCarloResult {
  return runMonteCarloWithModeAndSeed(plan, currentPortfolio, nSimulations, mode);
}

export function runMonteCarloWithModeAndSeed(
  plan: RetirementPlan,
  currentPortfolio: number,
  nSimulations: number,
  mode: RetirementTimingMode,
  seed?: number | bigint,
): MonteCarloResult {
  const simulationCount = Math.max(Math.trunc(nSimulations), 1);
  const currentAge = plan.personal.currentAge;
  const targetFireAge = plan.personal.targetRetirementAge;
  const planningHorizonAge = plan.personal.planningHorizonAge;
  const horizonYears = Math.max(planningHorizonAge - currentAge, 1);
  const inflationRate = plan.investment.inflationRate;
  const monthlyContribution = plan.investment.monthlyContribution;
  const contributionGrowth =
    plan.personal.salaryGrowthRate ?? plan.investment.contributionGrowthRate;
  const accumulationMean = planAccumulationReturn(plan);
  const retirementMean = planRetirementReturn(plan);
  const annualVolatility = plan.investment.annualVolatility;
  const annualFeeRate = plan.investment.annualInvestmentFeeRate;
  const baseSeed =
    seed === undefined
      ? retirementPlanSeed(plan, currentPortfolio, simulationCount, mode)
      : normalizeSeed(seed);

  const perAgeRequiredCapital = Array.from({ length: horizonYears + 1 }, (_, index) =>
    tryComputeRequiredCapital(plan, currentAge + index),
  );
  const perAgePayouts = Array.from({ length: horizonYears + 1 }, (_, index) =>
    resolvePlanDcPayouts(plan.incomeStreams, currentAge, currentAge + index, accumulationMean),
  );

  const simResults: Array<{
    path: number[];
    survived: boolean;
    fireAge: number | null;
  }> = [];

  for (let simIndex = 0; simIndex < simulationCount; simIndex += 1) {
    const simSeed = splitmix64(baseSeed ^ BigInt(simIndex));
    const rng = new SplitmixNormalSource(simSeed);
    let buckets = initialWithdrawalBuckets(plan.tax, currentPortfolio);
    let inFire = false;
    let simFireAge: number | null = null;
    let essentialFundedEveryYear = true;
    let cumulativeInflation = 1;
    let simRetirementAge = targetFireAge;
    let simResolvedPayouts: ReadonlyMap<string, number> | null = null;
    const path: number[] = [];

    for (let yearIndex = 0; yearIndex <= horizonYears; yearIndex += 1) {
      const age = currentAge + yearIndex;
      const portfolio = taxBucketTotal(buckets);
      path.push(Math.max(portfolio, 0));

      if (!inFire) {
        const required = perAgeRequiredCapital[yearIndex] ?? null;
        if (simFireAge === null && required !== null && portfolio >= required) {
          simFireAge = age;
        }
        if (retirementStartDecision(mode, age, targetFireAge, portfolio, required) !== null) {
          inFire = true;
          simRetirementAge = age;
          simResolvedPayouts = perAgePayouts[yearIndex] ?? new Map<string, number>();
        }
      }

      const [effectiveMean, effectiveStdDev] = blendedReturnParams(
        accumulationMean,
        retirementMean,
        annualVolatility,
        annualFeeRate,
        currentAge,
        simRetirementAge,
        planningHorizonAge,
        plan.investment.glidePath,
        yearIndex,
        inFire,
      );
      const [annualReturn, annualInflation] = sampleReturnAndInflation(
        rng,
        effectiveMean,
        effectiveStdDev,
        inflationRate,
      );

      if (inFire) {
        const payouts = simResolvedPayouts ?? new Map<string, number>();
        const grownBuckets = applyGrowthToTaxBuckets(buckets, annualReturn);
        const [totalExpenses, essentialExpenses] = annualExpensesAtYearStochastic(
          plan.expenses,
          age,
          yearIndex,
          cumulativeInflation,
        );
        const income = planIncomeAtAgeStochastic(
          plan.incomeStreams,
          payouts,
          age,
          yearIndex,
          inflationRate,
          cumulativeInflation,
        );
        const outcome = applyPlannedSpendingWithdrawal(
          grownBuckets,
          totalExpenses,
          income,
          plan.tax,
          age,
        );
        const essentialGap = Math.max(essentialExpenses - income, 0);
        if (outcome.spendingFunded < essentialGap * FUNDING_TOLERANCE) {
          essentialFundedEveryYear = false;
        }
        buckets = outcome.remainingBuckets;
      } else {
        const yearMonthlyContribution =
          monthlyContribution * Math.pow(1 + contributionGrowth, yearIndex);
        const annualContribution = endOfYearValueOfMonthlyContributions(
          yearMonthlyContribution,
          annualReturn,
        );
        const grownBuckets = applyGrowthToTaxBuckets(buckets, annualReturn);
        buckets = addContributionToTaxBuckets(grownBuckets, annualContribution, plan.tax);
      }

      cumulativeInflation *= 1 + annualInflation;
    }

    const endingPortfolio = taxBucketTotal(buckets);
    const portfolioSurvived = endingPortfolio > 0;
    simResults.push({
      path,
      survived:
        essentialFundedEveryYear &&
        portfolioSurvived &&
        (mode === "traditional" || simFireAge !== null),
      fireAge: simFireAge,
    });
  }

  const yearCount = horizonYears + 1;
  const survivedCount = simResults.filter((result) => result.survived).length;
  const fireAges = simResults
    .flatMap((result) => (result.fireAge === null ? [] : [result.fireAge]))
    .sort((left, right) => left - right);
  const p10: number[] = [];
  const p25: number[] = [];
  const p50: number[] = [];
  const p75: number[] = [];
  const p90: number[] = [];
  const ageAxis: number[] = [];

  for (let yearIndex = 0; yearIndex < yearCount; yearIndex += 1) {
    const values = simResults
      .map((result) => result.path[yearIndex] ?? 0)
      .sort((left, right) => left - right);
    p10.push(percentile(values, 0.1));
    p25.push(percentile(values, 0.25));
    p50.push(percentile(values, 0.5));
    p75.push(percentile(values, 0.75));
    p90.push(percentile(values, 0.9));
    ageAxis.push(currentAge + yearIndex);
  }

  const finalValues = simResults
    .map((result) => result.path.at(-1) ?? 0)
    .sort((left, right) => left - right);
  const medianFireAge =
    fireAges.length > 0 && fireAges.length * 2 >= simulationCount
      ? fireAges[Math.floor(fireAges.length / 2)]
      : null;

  return {
    successRate: survivedCount / simulationCount,
    medianFireAge,
    percentiles: {
      p10,
      p25,
      p50,
      p75,
      p90,
    },
    ageAxis,
    finalPortfolioAtHorizon: {
      p10: percentile(finalValues, 0.1),
      p25: percentile(finalValues, 0.25),
      p50: percentile(finalValues, 0.5),
      p75: percentile(finalValues, 0.75),
      p90: percentile(finalValues, 0.9),
    },
    nSimulations: simulationCount,
  };
}

export function blendedReturnParams(
  accumulationMean: number,
  retirementMean: number,
  baseStd: number,
  annualFeeRate: number,
  currentAge: number,
  retirementStartAge: number,
  planningHorizonAge: number,
  glidePath: GlidePathSettings | null | undefined,
  yearIndex: number,
  inRetirement: boolean,
): [mean: number, standardDeviation: number] {
  if (!inRetirement) {
    return [accumulationMean, baseStd];
  }
  if (!glidePath?.enabled) {
    return [retirementMean, baseStd];
  }
  const yearsToRetirement = Math.max(retirementStartAge - currentAge, 0);
  const yearsInRetirement = Math.max(planningHorizonAge - retirementStartAge, 1);
  const yearsFromRetirement = Math.max(yearIndex - yearsToRetirement, 0);
  const t = clamp(yearsFromRetirement / yearsInRetirement, 0, 1);
  const bondPct = clamp(
    glidePath.bondAllocationAtFire +
      t * (glidePath.bondAllocationAtHorizon - glidePath.bondAllocationAtFire),
    0,
    1,
  );
  const stockPct = 1 - bondPct;
  const bondMean = netAnnualReturn(glidePath.bondReturnRate, annualFeeRate);
  const bondStd = baseStd * DEFAULT_BOND_VOLATILITY_RATIO;
  return [
    stockPct * retirementMean + bondPct * bondMean,
    Math.sqrt(Math.pow(stockPct * baseStd, 2) + Math.pow(bondPct * bondStd, 2)),
  ];
}

export function hasMaterialSpendingShortfall(snapshot: YearlySnapshot): boolean {
  if (snapshot.phase !== "fire") {
    return false;
  }
  const shortfall = snapshot.annualShortfall ?? 0;
  if (shortfall <= 0) {
    return false;
  }
  const spendingGap = Math.max((snapshot.plannedExpenses ?? 0) - snapshot.annualIncome, 0);
  const tolerance = Math.max(spendingGap * MATERIAL_SHORTFALL_RATE, MIN_MATERIAL_SHORTFALL);
  return shortfall > tolerance;
}

interface RiskLabPlanOutcome {
  fiAge: number | null;
  retirementStartAge: number | null;
  fundedAtGoalAge: boolean;
  shortfallAtGoalAge: number;
  portfolioAtHorizon: number;
  portfolioAtRetirementStart: number;
  requiredCapitalAtGoalAge: number;
  failureAge: number | null;
  spendingShortfallAge: number | null;
}

function riskLabPlanOutcome(
  plan: RetirementPlan,
  currentPortfolio: number,
  mode: RetirementTimingMode,
): RiskLabPlanOutcome {
  const requiredCapitalCache: RequiredCapitalCache = new Map();
  const requiredCapital = requiredCapitalFor(
    plan,
    plan.personal.targetRetirementAge,
    requiredCapitalCache,
  );
  const requiredCapitalValue = requiredCapital ?? 0;
  const projection = projectRetirementWithModeCached(
    plan,
    currentPortfolio,
    mode,
    requiredCapitalCache,
  );
  const portfolioAtGoal =
    projection.yearByYear.find((snapshot) => snapshot.age === plan.personal.targetRetirementAge)
      ?.portfolioValue ?? 0;
  const portfolioAtRetirementStart =
    projection.retirementStartAge === null
      ? 0
      : (projection.yearByYear.find((snapshot) => snapshot.age === projection.retirementStartAge)
          ?.portfolioValue ?? 0);
  const failureAge =
    projection.yearByYear.find(
      (snapshot) => snapshot.phase === "fire" && snapshot.portfolioValue <= 0,
    )?.age ?? null;
  const spendingShortfallAge =
    projection.yearByYear.find((snapshot) => hasMaterialSpendingShortfall(snapshot))?.age ?? null;

  return {
    fiAge: projection.fireAge,
    retirementStartAge: projection.retirementStartAge,
    fundedAtGoalAge: requiredCapital !== null && portfolioAtGoal >= requiredCapital,
    shortfallAtGoalAge:
      requiredCapital === null ? 0 : Math.max(requiredCapital - portfolioAtGoal, 0),
    portfolioAtHorizon: projection.yearByYear.at(-1)?.portfolioEndValue ?? 0,
    portfolioAtRetirementStart,
    requiredCapitalAtGoalAge: requiredCapitalValue,
    failureAge,
    spendingShortfallAge,
  };
}

function buildPlanStress(
  id: StressTestId,
  label: string,
  description: string,
  category: StressCategory,
  plan: RetirementPlan,
  currentPortfolio: number,
  mode: RetirementTimingMode,
  baseline: StressOutcome,
  severityBase: number,
  mutate: (plan: RetirementPlan) => void,
): StressTestResult {
  const stressedPlan = cloneRetirementPlan(plan);
  mutate(stressedPlan);
  const outcome = riskLabPlanOutcome(stressedPlan, currentPortfolio, mode);
  return buildStressResult(
    id,
    label,
    description,
    category,
    baseline,
    stressOutcomeFromPlanOutcome(outcome),
    severityBase,
  );
}

function buildEarlyCrashStress(
  plan: RetirementPlan,
  baselineOutcome: RiskLabPlanOutcome,
  baseline: StressOutcome,
  severityBase: number,
): StressTestResult {
  const retirementAge = baselineOutcome.retirementStartAge;
  if (retirementAge === null) {
    return buildStressResult(
      "early-crash",
      "Retire into a crash",
      "A 30% market drop happens in the first retirement year.",
      "market",
      baseline,
      baseline,
      severityBase,
    );
  }

  const portfolioAtStart = Math.max(baselineOutcome.portfolioAtRetirementStart, 0);
  const crash = runSorr(plan, portfolioAtStart, retirementAge).find(
    (scenario) => scenario.label === "Crash Year 1 (-30%)",
  );
  const stressed: StressOutcome =
    crash === undefined
      ? {
          fiAge: baseline.fiAge,
          retirementStartAge: retirementAge,
          fundedAtGoalAge: false,
          shortfallAtGoalAge: baseline.shortfallAtGoalAge,
          portfolioAtHorizon: 0,
          failureAge: retirementAge,
          spendingShortfallAge: retirementAge,
        }
      : {
          fiAge: baseline.fiAge,
          retirementStartAge: retirementAge,
          fundedAtGoalAge: baseline.fundedAtGoalAge,
          shortfallAtGoalAge: baseline.shortfallAtGoalAge,
          portfolioAtHorizon: crash.finalValue,
          failureAge: crash.failureAge ?? (crash.survived ? null : retirementAge),
          spendingShortfallAge: crash.spendingShortfallAge,
        };

  return buildStressResult(
    "early-crash",
    "Retire into a crash",
    "A 30% market drop happens in the first retirement year.",
    "market",
    baseline,
    stressed,
    severityBase,
  );
}

function buildStressResult(
  id: StressTestId,
  label: string,
  description: string,
  category: StressCategory,
  baseline: StressOutcome,
  stressed: StressOutcome,
  severityBase: number,
): StressTestResult {
  const delta: StressDelta = {
    fiAgeYears:
      baseline.fiAge === null || stressed.fiAge === null ? null : stressed.fiAge - baseline.fiAge,
    shortfallAtGoalAge: stressed.shortfallAtGoalAge - baseline.shortfallAtGoalAge,
    portfolioAtHorizon: stressed.portfolioAtHorizon - baseline.portfolioAtHorizon,
  };
  return {
    id,
    label,
    description,
    category,
    baseline,
    stressed,
    delta,
    severity: classifyStress(baseline, stressed, delta, severityBase),
  };
}

function stressOutcomeFromPlanOutcome(outcome: RiskLabPlanOutcome): StressOutcome {
  return {
    fiAge: outcome.fiAge,
    retirementStartAge: outcome.retirementStartAge,
    fundedAtGoalAge: outcome.fundedAtGoalAge,
    shortfallAtGoalAge: outcome.shortfallAtGoalAge,
    portfolioAtHorizon: outcome.portfolioAtHorizon,
    failureAge: outcome.failureAge,
    spendingShortfallAge: outcome.spendingShortfallAge,
  };
}

function classifyStress(
  baseline: StressOutcome,
  stressed: StressOutcome,
  delta: StressDelta,
  severityBase: number,
): StressSeverity {
  const shortfallIncrease = Math.max(delta.shortfallAtGoalAge, 0);
  if (
    (stressed.failureAge !== null && stressed.failureAge !== undefined) ||
    (stressed.spendingShortfallAge !== null && stressed.spendingShortfallAge !== undefined) ||
    (baseline.fiAge !== null && stressed.fiAge === null) ||
    (delta.fiAgeYears !== null && delta.fiAgeYears >= 3) ||
    shortfallIncrease >= severityBase * 0.15
  ) {
    return "high";
  }
  if (
    (delta.fiAgeYears !== null && delta.fiAgeYears >= 1) ||
    shortfallIncrease >= severityBase * 0.05
  ) {
    return "medium";
  }
  return "low";
}

function severityRank(severity: StressSeverity): number {
  if (severity === "high") {
    return 2;
  }
  if (severity === "medium") {
    return 1;
  }
  return 0;
}

function applyReturnDragStress(plan: RetirementPlan): void {
  plan.investment.preRetirementAnnualReturn -= 0.02;
  plan.investment.retirementAnnualReturn -= 0.02;
}

function applyInflationShockStress(plan: RetirementPlan): void {
  plan.investment.inflationRate += 0.015;
}

function applySpendingShockStress(plan: RetirementPlan): void {
  for (const item of plan.expenses.items) {
    item.monthlyAmount *= 1.1;
  }
}

function applyRetireEarlierStress(plan: RetirementPlan): void {
  plan.personal.targetRetirementAge = Math.max(
    Math.max(plan.personal.targetRetirementAge - 2, 0),
    plan.personal.currentAge + 1,
  );
}

function applySaveLessStress(plan: RetirementPlan): void {
  plan.investment.monthlyContribution *= 0.75;
}

function cloneRetirementPlan(plan: RetirementPlan): RetirementPlan {
  return {
    ...plan,
    personal: { ...plan.personal },
    expenses: { ...plan.expenses, items: plan.expenses.items.map((item) => ({ ...item })) },
    incomeStreams: plan.incomeStreams.map((stream) => ({ ...stream })),
    investment: {
      ...plan.investment,
      glidePath: plan.investment.glidePath
        ? { ...plan.investment.glidePath }
        : plan.investment.glidePath,
    },
    tax:
      plan.tax == null
        ? null
        : {
            ...plan.tax,
            withdrawalBuckets: { ...plan.tax.withdrawalBuckets },
          },
  };
}

function buildContributionReturnSensitivity(
  plan: RetirementPlan,
  currentPortfolio: number,
  mode: RetirementTimingMode,
): DecisionSensitivityMatrix {
  const baseContribution = plan.investment.monthlyContribution;
  const baseNetReturn = planAccumulationReturn(plan);
  const contributionValues = contributionAxis(baseContribution);
  const returnValues = returnAxis(baseNetReturn);
  const baselineRow = returnValues.findIndex((value) => approxEq(value, baseNetReturn, 0.000001));
  const baselineColumn = contributionValues.findIndex((value) =>
    approxEq(value, baseContribution, 0.01),
  );
  const cells = returnValues.map((netReturn) =>
    contributionValues.map((contribution) => {
      const adjusted = cloneRetirementPlan(plan);
      adjusted.investment.monthlyContribution = contribution;
      applyReturnDelta(adjusted, netReturn - baseNetReturn);
      return decisionCellFromPlan(adjusted, currentPortfolio, mode);
    }),
  );

  return {
    rowLabel: "After-fee return",
    columnLabel: "Monthly contribution",
    rowValues: returnValues,
    columnValues: contributionValues,
    rowLabels: returnValues.map((value) => `${(value * 100).toFixed(1)}%`),
    columnLabels: contributionValues.map((value) => value.toFixed(0)),
    cells,
    baselineRow: baselineRow === -1 ? null : baselineRow,
    baselineColumn: baselineColumn === -1 ? null : baselineColumn,
  };
}

function buildRetirementAgeSpendingSensitivity(
  plan: RetirementPlan,
  currentPortfolio: number,
  mode: RetirementTimingMode,
): DecisionSensitivityMatrix {
  const baseRetirementAge = plan.personal.targetRetirementAge;
  const baseMonthlySpending = activeMonthlyExpenseToday(plan, baseRetirementAge);
  const spendingValues = spendingAxis(baseMonthlySpending);
  const retirementAgeValues = retirementAgeAxis(plan);
  const baselineRow = spendingValues.findIndex((value) =>
    approxEq(value, baseMonthlySpending, 0.01),
  );
  const baselineColumn = retirementAgeValues.findIndex((value) => value === baseRetirementAge);
  const cells = spendingValues.map((monthlySpending) =>
    retirementAgeValues.map((retirementAge) => {
      const adjusted = cloneRetirementPlan(plan);
      adjusted.personal.targetRetirementAge = retirementAge;
      setTotalMonthlyExpense(adjusted.expenses, baseMonthlySpending, monthlySpending);
      return decisionCellFromPlan(adjusted, currentPortfolio, mode);
    }),
  );

  return {
    rowLabel: "Monthly spending",
    columnLabel: "Retirement age",
    rowValues: spendingValues,
    columnValues: retirementAgeValues,
    rowLabels: spendingValues.map((value) => value.toFixed(0)),
    columnLabels: retirementAgeValues.map((value) => `${value}`),
    cells,
    baselineRow: baselineRow === -1 ? null : baselineRow,
    baselineColumn: baselineColumn === -1 ? null : baselineColumn,
  };
}

function decisionCellFromPlan(
  plan: RetirementPlan,
  currentPortfolio: number,
  mode: RetirementTimingMode,
): DecisionSensitivityCell {
  const outcome = riskLabPlanOutcome(plan, currentPortfolio, mode);
  const targetFactor = inflationFactorToAge(plan, plan.personal.targetRetirementAge);
  const horizonFactor = inflationFactorToAge(plan, plan.personal.planningHorizonAge);
  return {
    fiAge: outcome.fiAge,
    retirementStartAge: outcome.retirementStartAge,
    fundedAtGoalAge: outcome.fundedAtGoalAge,
    shortfallAtGoalAge: outcome.shortfallAtGoalAge / targetFactor,
    portfolioAtHorizon: outcome.portfolioAtHorizon / horizonFactor,
  };
}

function inflationFactorToAge(plan: RetirementPlan, age: number): number {
  const years = Math.max(age - plan.personal.currentAge, 0);
  return boundedInflationFactor(plan.investment.inflationRate, years);
}

function applyReturnDelta(plan: RetirementPlan, delta: number): void {
  plan.investment.preRetirementAnnualReturn = Math.max(
    plan.investment.preRetirementAnnualReturn + delta,
    -0.99,
  );
  plan.investment.retirementAnnualReturn = Math.max(
    plan.investment.retirementAnnualReturn + delta,
    -0.99,
  );
}

function contributionAxis(base: number): number[] {
  if (base <= 0) {
    return [0, 500, 1_000, 1_500, 2_000];
  }
  const values: number[] = [];
  for (const multiplier of [0.6, 0.8, 1.0, 1.2, 1.4]) {
    const value = approxEq(multiplier, 1, 0.000001) ? base : roundMoneyAxis(base * multiplier);
    pushUniqueAxisValue(values, value);
  }
  fillMoneyAxis(values, base);
  return values.sort((left, right) => left - right);
}

function returnAxis(base: number): number[] {
  return [-0.02, -0.01, 0, 0.01, 0.02].map((delta) => Math.max(base + delta, -0.95));
}

function spendingAxis(base: number): number[] {
  if (base <= 0) {
    return [0, 1_000, 2_000, 3_000, 4_000];
  }
  const values: number[] = [];
  for (const multiplier of [0.8, 0.9, 1.0, 1.1, 1.2]) {
    const value = approxEq(multiplier, 1, 0.000001) ? base : roundMoneyAxis(base * multiplier);
    pushUniqueAxisValue(values, value);
  }
  fillMoneyAxis(values, base);
  return values.sort((left, right) => left - right);
}

function retirementAgeAxis(plan: RetirementPlan): number[] {
  const target = plan.personal.targetRetirementAge;
  const minAge = plan.personal.currentAge + 1;
  const maxAge = plan.personal.planningHorizonAge;
  const values: number[] = [];
  for (const offset of [-3, -1, 0, 2, 4]) {
    const age = Math.min(Math.max(target + offset, minAge), maxAge);
    if (!values.includes(age)) {
      values.push(age);
    }
  }
  let next = target;
  while (values.length < 5 && next < maxAge) {
    next += 1;
    if (!values.includes(next)) {
      values.push(next);
    }
  }
  let previous = target;
  while (values.length < 5 && previous > minAge) {
    previous -= 1;
    if (!values.includes(previous)) {
      values.push(previous);
    }
  }
  return values.sort((left, right) => left - right);
}

function activeMonthlyExpenseToday(plan: RetirementPlan, age: number): number {
  return plan.expenses.items
    .filter(
      (item) =>
        (item.startAge === undefined || item.startAge === null || age >= item.startAge) &&
        (item.endAge === undefined || item.endAge === null || age < item.endAge),
    )
    .reduce((total, item) => total + item.monthlyAmount, 0);
}

function setTotalMonthlyExpense(
  expenses: ExpenseBudget,
  baseTotal: number,
  targetTotal: number,
): void {
  if (baseTotal > 0) {
    const factor = targetTotal / baseTotal;
    for (const item of expenses.items) {
      item.monthlyAmount *= factor;
    }
    return;
  }

  if (expenses.items[0]) {
    expenses.items[0].monthlyAmount = targetTotal;
  } else {
    expenses.items.push({ monthlyAmount: targetTotal, essential: true });
  }
}

function roundMoneyAxis(value: number): number {
  const step = Math.abs(value) >= 1_000 ? 100 : 50;
  return Math.round(value / step) * step;
}

function pushUniqueAxisValue(values: number[], value: number): void {
  if (!values.some((existing) => approxEq(existing, value, 0.01))) {
    values.push(Math.max(value, 0));
  }
}

function fillMoneyAxis(values: number[], base: number): void {
  const step = Math.max(roundMoneyAxis(Math.max(Math.abs(base) * 0.2, 100)), 100);
  let next = base + step;
  while (values.length < 5) {
    pushUniqueAxisValue(values, roundMoneyAxis(next));
    next += step;
  }
}

function approxEq(left: number, right: number, epsilon: number): boolean {
  return Math.abs(left - right) <= epsilon;
}

function percentile(sortedValues: number[], percentileRank: number): number {
  if (sortedValues.length === 0) {
    return 0;
  }
  const index = Math.floor(sortedValues.length * percentileRank);
  return sortedValues[Math.min(index, sortedValues.length - 1)] ?? 0;
}

interface NormalSource {
  nextStandardNormalPair(): [number, number];
}

class SplitmixNormalSource implements NormalSource {
  private state: bigint;

  constructor(seed: bigint) {
    this.state = BigInt.asUintN(64, seed);
  }

  nextStandardNormalPair(): [number, number] {
    const firstUniform = Math.max(this.nextUniform(), Number.MIN_VALUE);
    const secondUniform = this.nextUniform();
    const radius = Math.sqrt(-2 * Math.log(firstUniform));
    const theta = 2 * Math.PI * secondUniform;
    return [radius * Math.cos(theta), radius * Math.sin(theta)];
  }

  private nextUniform(): number {
    this.state = BigInt.asUintN(64, this.state + SPLITMIX64_INCREMENT);
    const value = splitmix64Mix(this.state);
    return Number(value >> 11n) / 9_007_199_254_740_992;
  }
}

function sampleReturnAndInflation(
  rng: NormalSource,
  returnMean: number,
  returnStdDev: number,
  inflationMean: number,
): [annualReturn: number, annualInflation: number] {
  const [zReturn, zOther] = rng.nextStandardNormalPair();
  const correlation = clamp(RETURN_INFLATION_CORRELATION, -0.99, 0.99);
  const zInflation = correlation * zReturn + Math.sqrt(1 - correlation * correlation) * zOther;
  return [
    sampleReturnFromStandard(returnMean, returnStdDev, zReturn),
    sampleInflationFromStandard(inflationMean, DEFAULT_INFLATION_STANDARD_DEVIATION, zInflation),
  ];
}

function sampleReturnFromStandard(mean: number, standardDeviation: number, zScore: number): number {
  if (!Number.isFinite(mean)) {
    return 0;
  }
  if (!Number.isFinite(standardDeviation) || standardDeviation <= MIN_RETURN_STANDARD_DEVIATION) {
    return mean;
  }
  const safeGrowth = Math.max(1 + mean, 0.01);
  return Math.exp(Math.log(safeGrowth) + standardDeviation * zScore) - 1;
}

function sampleInflationFromStandard(
  mean: number,
  standardDeviation: number,
  zScore: number,
): number {
  if (!Number.isFinite(mean)) {
    return 0;
  }
  if (!Number.isFinite(standardDeviation) || standardDeviation <= MIN_RETURN_STANDARD_DEVIATION) {
    return mean;
  }
  return Math.max(mean + standardDeviation * zScore, -0.99);
}

export function splitmix64(value: bigint): bigint {
  return splitmix64Mix(BigInt.asUintN(64, value + SPLITMIX64_INCREMENT));
}

function splitmix64Mix(value: bigint): bigint {
  let mixed = BigInt.asUintN(64, value);
  mixed = BigInt.asUintN(64, (mixed ^ (mixed >> 30n)) * SPLITMIX64_MULTIPLIER_1);
  mixed = BigInt.asUintN(64, (mixed ^ (mixed >> 27n)) * SPLITMIX64_MULTIPLIER_2);
  return BigInt.asUintN(64, mixed ^ (mixed >> 31n));
}

function normalizeSeed(seed: number | bigint): bigint {
  if (typeof seed === "bigint") {
    return BigInt.asUintN(64, seed);
  }
  return BigInt.asUintN(64, BigInt(Math.trunc(seed)));
}

function retirementPlanSeed(
  plan: RetirementPlan,
  currentPortfolio: number,
  nSimulations: number,
  mode: RetirementTimingMode,
): bigint {
  return fnv1a64(
    `${stableJsonStringify(plan)}|${currentPortfolio}|${Math.trunc(nSimulations)}|${mode}`,
  );
}

function fnv1a64(value: string): bigint {
  let hash = FNV_OFFSET_BASIS_64;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * FNV_PRIME_64);
  }
  return hash;
}

function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`);
  return `{${entries.join(",")}}`;
}

function runSorrScenario(
  plan: RetirementPlan,
  portfolioAtFire: number,
  retirementStartAge: number,
  yearsToFire: number,
  inflation: number,
  resolvedPayouts: ReadonlyMap<string, number>,
  label: string,
  returns: number[],
): SorrScenario {
  let buckets = initialWithdrawalBuckets(plan.tax, portfolioAtFire);
  const path: number[] = [];
  let spendingShortfallAge: number | null = null;
  let essentialFundedEveryYear = true;

  for (let year = 0; year < returns.length; year += 1) {
    path.push(Math.max(taxBucketTotal(buckets), 0));
    const age = retirementStartAge + year;
    const yearsFromNow = yearsToFire + year;
    const [expenses, essentialExpenses] = annualExpensesAtYear(
      plan.expenses,
      age,
      yearsFromNow,
      inflation,
    );
    const annualIncome = planIncomeAtAge(
      plan.incomeStreams,
      resolvedPayouts,
      age,
      yearsFromNow,
      inflation,
    );
    const essentialGap = Math.max(essentialExpenses - annualIncome, 0);
    const glideMean = planBlendedReturn(plan, yearsFromNow, true, retirementStartAge);
    const effectiveReturn =
      Math.abs(returns[year] - planRetirementReturn(plan)) < 1e-9 ? glideMean : returns[year];
    const grownBuckets = applyGrowthToTaxBuckets(buckets, effectiveReturn);

    const withdrawal = applyPlannedSpendingWithdrawal(
      grownBuckets,
      expenses,
      annualIncome,
      plan.tax,
      age,
    );
    const funded = withdrawal.spendingFunded;

    if (spendingShortfallAge === null && funded < essentialGap * FUNDING_TOLERANCE) {
      essentialFundedEveryYear = false;
      spendingShortfallAge = age;
    }

    buckets = withdrawal.remainingBuckets;
    if (!Number.isFinite(taxBucketTotal(buckets))) {
      buckets = emptyTaxBucketBalances();
    }
  }

  const portfolio = taxBucketTotal(buckets);
  path.push(Math.max(portfolio, 0));
  const portfolioSurvived = portfolio > 0;
  const failureIndex = portfolioSurvived ? -1 : path.findIndex((value) => value <= 0);

  return {
    label,
    returns,
    portfolioPath: path,
    finalValue: portfolio,
    survived: essentialFundedEveryYear && portfolioSurvived,
    failureAge: failureIndex === -1 ? null : retirementStartAge + failureIndex,
    spendingShortfallAge,
  };
}

function initialRequiredCapitalUpperBound(plan: RetirementPlan, retirementAge: number): number {
  const yearsFromNow = Math.max(retirementAge - plan.personal.currentAge, 0);
  const resolvedPayouts = resolvePlanDcPayouts(
    plan.incomeStreams,
    plan.personal.currentAge,
    retirementAge,
    planAccumulationReturn(plan),
  );
  const [annualExpenses] = annualExpensesAtYear(
    plan.expenses,
    retirementAge,
    yearsFromNow,
    plan.investment.inflationRate,
  );
  const annualIncome = planIncomeAtAge(
    plan.incomeStreams,
    resolvedPayouts,
    retirementAge,
    yearsFromNow,
    plan.investment.inflationRate,
  );
  return Math.max(annualExpenses - annualIncome, 0) * REQUIRED_CAPITAL_SEED_MULTIPLE;
}

function computeCoastAmountAtGoal(plan: RetirementPlan, targetAtGoal: number | null): number {
  const years = plan.personal.targetRetirementAge - plan.personal.currentAge;
  if (years <= 0) {
    return targetAtGoal ?? 0;
  }
  return targetAtGoal === null
    ? 0
    : targetAtGoal / Math.pow(1 + planAccumulationReturn(plan), years);
}

function computeBudgetBreakdown(plan: RetirementPlan, retirementAge: number): BudgetBreakdown {
  const yearsFromNow = Math.max(retirementAge - plan.personal.currentAge, 0);
  const [annualBudget] = annualExpensesAtYear(
    plan.expenses,
    retirementAge,
    yearsFromNow,
    plan.investment.inflationRate,
  );
  const totalMonthlyBudget = annualBudget / 12;
  const resolved = resolvePlanDcPayouts(
    plan.incomeStreams,
    plan.personal.currentAge,
    retirementAge,
    planAccumulationReturn(plan),
  );
  const totalIncomeMonthly =
    planIncomeAtAge(
      plan.incomeStreams,
      resolved,
      retirementAge,
      yearsFromNow,
      plan.investment.inflationRate,
    ) / 12;
  const incomeStreams: BudgetStreamItem[] = [];
  for (const stream of plan.incomeStreams) {
    if (stream.startAge > retirementAge) {
      continue;
    }
    const baseMonthly = resolved.get(stream.id) ?? stream.monthlyAmount ?? 0;
    const annual =
      stream.annualGrowthRate !== undefined && stream.annualGrowthRate !== null
        ? baseMonthly * 12 * Math.pow(1 + stream.annualGrowthRate, yearsFromNow)
        : stream.adjustForInflation
          ? baseMonthly * 12 * Math.pow(1 + plan.investment.inflationRate, yearsFromNow)
          : baseMonthly * 12;
    const monthly = annual / 12;
    incomeStreams.push({
      label: stream.label,
      monthlyAmount: monthly,
      percentageOfBudget: totalMonthlyBudget > 0 ? monthly / totalMonthlyBudget : 0,
    });
  }

  const netGapAnnual = Math.max(totalMonthlyBudget - totalIncomeMonthly, 0) * 12;
  const [grossGapAnnual, taxGapAnnual] = computeGrossWithdrawal(
    netGapAnnual,
    plan.tax,
    retirementAge,
  );
  const monthlyPortfolioWithdrawal = grossGapAnnual / 12;
  const effectiveTaxRate =
    grossGapAnnual > 0 ? clamp(taxGapAnnual / grossGapAnnual, 0, 0.99) : plan.tax ? 0 : undefined;

  return {
    totalMonthlyBudget,
    monthlyPortfolioWithdrawal,
    incomeStreams,
    ...(effectiveTaxRate === undefined ? {} : { effectiveTaxRate }),
  };
}

function computeTargetReconciliation(
  plan: RetirementPlan,
  retirementAge: number,
  requiredCapital: number | null,
  portfolioAtTarget: number,
): TargetReconciliation {
  const yearsToTarget = Math.max(retirementAge - plan.personal.currentAge, 0);
  const inflationFactor = boundedInflationFactor(plan.investment.inflationRate, yearsToTarget);
  const todayValue = (value: number) => value / inflationFactor;
  const [plannedExpensesNominal] = annualExpensesAtYear(
    plan.expenses,
    retirementAge,
    yearsToTarget,
    plan.investment.inflationRate,
  );
  const resolved = resolvePlanDcPayouts(
    plan.incomeStreams,
    plan.personal.currentAge,
    retirementAge,
    planAccumulationReturn(plan),
  );
  const annualIncomeNominal = planIncomeAtAge(
    plan.incomeStreams,
    resolved,
    retirementAge,
    yearsToTarget,
    plan.investment.inflationRate,
  );
  const netGapNominal = Math.max(plannedExpensesNominal - annualIncomeNominal, 0);
  const [grossWithdrawalNominal, taxesNominal] = computeGrossWithdrawal(
    netGapNominal,
    plan.tax,
    retirementAge,
  );
  const requiredCapitalNominal = requiredCapital ?? 0;
  const shortfallNominal =
    requiredCapital === null ? 0 : Math.max(requiredCapital - portfolioAtTarget, 0);

  return {
    targetAge: retirementAge,
    requiredCapitalReachable: requiredCapital !== null,
    inflationFactorToTarget: inflationFactor,
    plannedAnnualExpensesTodayValue: todayValue(plannedExpensesNominal),
    plannedAnnualExpensesNominal: plannedExpensesNominal,
    annualIncomeTodayValue: todayValue(annualIncomeNominal),
    annualIncomeNominal,
    netAnnualSpendingGapTodayValue: todayValue(netGapNominal),
    netAnnualSpendingGapNominal: netGapNominal,
    grossAnnualPortfolioWithdrawalTodayValue: todayValue(grossWithdrawalNominal),
    grossAnnualPortfolioWithdrawalNominal: grossWithdrawalNominal,
    estimatedAnnualTaxesTodayValue: todayValue(taxesNominal),
    estimatedAnnualTaxesNominal: taxesNominal,
    requiredCapitalTodayValue: todayValue(requiredCapitalNominal),
    requiredCapitalNominal,
    portfolioAtTargetTodayValue: todayValue(portfolioAtTarget),
    portfolioAtTargetNominal: portfolioAtTarget,
    shortfallTodayValue: todayValue(shortfallNominal),
    shortfallNominal,
    preRetirementNetReturn: planAccumulationReturn(plan),
    retirementNetReturn: planRetirementReturn(plan),
    annualInvestmentFeeRate: plan.investment.annualInvestmentFeeRate,
  };
}

function buildTrajectory(
  yearByYear: YearlySnapshot[],
  plan: RetirementPlan,
  requiredCapitalCache: RequiredCapitalCache,
): RetirementTrajectoryPoint[] {
  const goalAge = plan.personal.targetRetirementAge;
  const targetAtGoal = requiredCapitalFor(plan, goalAge, requiredCapitalCache);
  return yearByYear.map((snapshot) => {
    const requiredCapital =
      snapshot.age <= goalAge
        ? targetAtGoal === null
          ? null
          : requiredBalanceAfterRemainingContributions(plan, snapshot.age, goalAge, targetAtGoal)
        : requiredCapitalFor(plan, snapshot.age, requiredCapitalCache);
    return {
      age: snapshot.age,
      year: snapshot.year,
      phase: snapshot.phase,
      portfolioStart: snapshot.portfolioValue,
      annualContribution: snapshot.annualContribution,
      annualIncome: snapshot.annualIncome,
      annualExpenses: snapshot.plannedExpenses ?? snapshot.annualWithdrawal,
      netWithdrawalFromPortfolio: snapshot.netWithdrawalFromPortfolio,
      portfolioEnd: snapshot.portfolioEndValue,
      requiredCapital,
      pensionAssets: snapshot.pensionAssets,
      ...(snapshot.annualTaxes === undefined ? {} : { annualTaxes: snapshot.annualTaxes }),
      ...(snapshot.grossWithdrawal === undefined
        ? {}
        : { grossWithdrawal: snapshot.grossWithdrawal }),
      ...(snapshot.plannedExpenses === undefined
        ? {}
        : { plannedExpenses: snapshot.plannedExpenses }),
      ...(snapshot.fundedExpenses === undefined ? {} : { fundedExpenses: snapshot.fundedExpenses }),
      ...(snapshot.annualShortfall === undefined
        ? {}
        : { annualShortfall: snapshot.annualShortfall }),
    };
  });
}

function requiredBalanceAfterRemainingContributions(
  plan: RetirementPlan,
  age: number,
  goalAge: number,
  targetAtGoal: number,
): number {
  if (age >= goalAge) {
    return Math.max(targetAtGoal, 0);
  }
  const growthFactor = Math.max(1 + planAccumulationReturn(plan), 0.000001);
  const contributionGrowth =
    plan.personal.salaryGrowthRate ?? plan.investment.contributionGrowthRate;
  const firstOffset = Math.max(age - plan.personal.currentAge, 0);
  const goalOffset = Math.max(goalAge - plan.personal.currentAge, 0);
  let requiredNext = Math.max(targetAtGoal, 0);
  for (let offset = goalOffset - 1; offset >= firstOffset; offset -= 1) {
    const monthlyContribution =
      plan.investment.monthlyContribution * Math.pow(1 + contributionGrowth, offset);
    const annualContribution = endOfYearValueOfMonthlyContributions(
      monthlyContribution,
      planAccumulationReturn(plan),
    );
    requiredNext = Math.max(requiredNext - annualContribution, 0) / growthFactor;
  }
  return requiredNext;
}

function solveRequiredAdditionalMonthly(
  plan: RetirementPlan,
  currentPortfolio: number,
  requiredCapital: number,
): number {
  const projectedAtGoal = (extraMonthly: number): number => {
    const adjusted: RetirementPlan = {
      ...plan,
      investment: {
        ...plan.investment,
        monthlyContribution: plan.investment.monthlyContribution + extraMonthly,
      },
    };
    return (
      projectRetirement(adjusted, currentPortfolio).yearByYear.find(
        (snapshot) => snapshot.age === plan.personal.targetRetirementAge,
      )?.portfolioValue ?? 0
    );
  };

  let lowerBound = 0;
  let upperBound = Math.max(requiredCapital / 12, 1);
  for (let step = 0; step < 32; step += 1) {
    if (projectedAtGoal(upperBound) >= requiredCapital) {
      break;
    }
    if (!Number.isFinite(upperBound) || upperBound >= Number.MAX_VALUE / 2) {
      return upperBound;
    }
    upperBound *= 2;
  }
  if (projectedAtGoal(upperBound) < requiredCapital) {
    return upperBound;
  }
  for (let step = 0; step < 50; step += 1) {
    const midpoint = (lowerBound + upperBound) / 2;
    if (projectedAtGoal(midpoint) >= requiredCapital) {
      upperBound = midpoint;
    } else {
      lowerBound = midpoint;
    }
  }
  return (lowerBound + upperBound) / 2;
}

function findFiAgeAccumulationOnly(
  plan: RetirementPlan,
  currentPortfolio: number,
  requiredCapitalCache: RequiredCapitalCache,
): number | null {
  const currentAge = plan.personal.currentAge;
  const horizon = plan.personal.planningHorizonAge;
  const contributionGrowth =
    plan.personal.salaryGrowthRate ?? plan.investment.contributionGrowthRate;
  const annualReturn = planAccumulationReturn(plan);
  let portfolio = currentPortfolio;
  for (let yearIndex = 0; yearIndex <= Math.max(horizon - currentAge, 0); yearIndex += 1) {
    const age = currentAge + yearIndex;
    const required = requiredCapitalFor(plan, age, requiredCapitalCache);
    if (required !== null && portfolio >= required) {
      return age;
    }
    const monthlyContribution =
      plan.investment.monthlyContribution * Math.pow(1 + contributionGrowth, yearIndex);
    const annualContribution = endOfYearValueOfMonthlyContributions(
      monthlyContribution,
      annualReturn,
    );
    portfolio = portfolio * (1 + annualReturn) + annualContribution;
  }
  return null;
}

function retirementOverviewStatus(
  requiredCapitalReachable: boolean,
  netTargetTodayReachable: boolean,
  hasRetirementGap: boolean,
  currentPortfolio: number,
  netTargetTodayValue: number,
  fundedAtGoalAge: boolean,
  effectiveFiAge: number | null,
  targetRetirementAge: number,
): RetirementOverview["status"] {
  if (!requiredCapitalReachable || !netTargetTodayReachable) {
    return "off_track";
  }
  if (hasRetirementGap) {
    return "at_risk";
  }
  if (currentPortfolio >= netTargetTodayValue) {
    return "achieved";
  }
  if (fundedAtGoalAge) {
    return "on_track";
  }
  if (effectiveFiAge !== null && effectiveFiAge <= targetRetirementAge + 3) {
    return "at_risk";
  }
  return "off_track";
}

function retirementOverviewSuccessStatus(
  requiredCapitalReachable: boolean,
  failureAge: number | null,
  shortfall: number,
  spendingShortfallAge: number | null,
  requiredCapitalValue: number,
  surplus: number,
): RetirementOverview["successStatus"] {
  if (!requiredCapitalReachable) {
    return "shortfall";
  }
  if (failureAge !== null) {
    return "depleted";
  }
  if (shortfall > 0 || spendingShortfallAge !== null) {
    return "shortfall";
  }
  if (requiredCapitalValue > 0 && surplus >= requiredCapitalValue * 0.1) {
    return "overfunded";
  }
  return "on_track";
}

function retirementTimingModeFromString(value: string): RetirementTimingMode {
  return value === "traditional" ? "traditional" : "fire";
}

function withdrawForNetTarget(
  netTarget: number,
  buckets: TaxBucketBalances,
  tax: TaxProfile | null,
  age: number,
): WithdrawalOutcome {
  if (netTarget <= 0 || taxBucketTotal(buckets) <= 0) {
    return {
      remainingBuckets: buckets,
      grossWithdrawal: 0,
      spendingFunded: 0,
      taxAmount: 0,
    };
  }

  const remaining = { ...buckets };
  let remainingNet = netTarget;
  let grossWithdrawal = 0;
  let spendingFunded = 0;
  let taxAmount = 0;

  for (const kind of ["taxable", "taxDeferred", "taxFree"] satisfies TaxBucketKind[]) {
    if (remainingNet <= 0) {
      break;
    }
    const availableGross = bucketBalance(remaining, kind);
    if (availableGross <= 0) {
      continue;
    }
    const rate = effectiveTaxRateForKind(tax, kind, age);
    const netPerGross = Math.max(1 - rate, 0.01);
    const neededGross = remainingNet / netPerGross;
    const grossFromBucket = Math.min(availableGross, neededGross);
    const netFromBucket = grossFromBucket * netPerGross;

    setBucketBalance(remaining, kind, availableGross - grossFromBucket);
    grossWithdrawal += grossFromBucket;
    spendingFunded += netFromBucket;
    taxAmount += grossFromBucket - netFromBucket;
    remainingNet -= netFromBucket;
  }

  return {
    remainingBuckets: remaining,
    grossWithdrawal,
    spendingFunded,
    taxAmount,
  };
}

function effectiveTaxRateForKind(tax: TaxProfile | null, kind: TaxBucketKind, age: number): number {
  return tax ? effectiveTaxRate(tax, kind, age) : 0;
}

function effectiveTaxRate(tax: TaxProfile, kind: TaxBucketKind, age: number): number {
  let rate =
    kind === "taxable"
      ? tax.taxableWithdrawalRate
      : kind === "taxDeferred"
        ? tax.taxDeferredWithdrawalRate
        : tax.taxFreeWithdrawalRate;
  if (
    kind === "taxDeferred" &&
    tax.earlyWithdrawalPenaltyRate !== undefined &&
    tax.earlyWithdrawalPenaltyRate !== null &&
    tax.earlyWithdrawalPenaltyAge !== undefined &&
    tax.earlyWithdrawalPenaltyAge !== null &&
    age < tax.earlyWithdrawalPenaltyAge
  ) {
    rate += tax.earlyWithdrawalPenaltyRate;
  }
  return clamp(rate, 0, 0.99);
}

function bucketBalance(buckets: TaxBucketBalances, kind: TaxBucketKind): number {
  if (kind === "taxable") {
    return buckets.taxable;
  }
  if (kind === "taxDeferred") {
    return buckets.taxDeferred;
  }
  return buckets.taxFree;
}

function setBucketBalance(buckets: TaxBucketBalances, kind: TaxBucketKind, value: number): void {
  if (kind === "taxable") {
    buckets.taxable = Math.max(value, 0);
  } else if (kind === "taxDeferred") {
    buckets.taxDeferred = Math.max(value, 0);
  } else {
    buckets.taxFree = Math.max(value, 0);
  }
}

function emptyTaxBucketBalances(): TaxBucketBalances {
  return { taxable: 0, taxDeferred: 0, taxFree: 0 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
