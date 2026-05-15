import type { TaxBucketBalances } from "./retirement-plan";

export const DEFAULT_DC_PAYOUT_ESTIMATE_RATE = 0.035;

const DEFAULT_BOND_VOLATILITY_RATIO = 0.35;
const MAX_REQUIRED_CAPITAL_DOUBLING_STEPS = 128;
const REQUIRED_CAPITAL_SEED_MULTIPLE = 30;
const FUNDING_TOLERANCE = 0.999;

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
