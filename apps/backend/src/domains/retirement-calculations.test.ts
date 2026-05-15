import { describe, expect, test } from "bun:test";

import {
  addContributionToTaxBuckets,
  annualExpensesAtYear,
  applyGrowthToTaxBuckets,
  applyPlannedSpendingWithdrawal,
  blendedReturnParams,
  boundedInflationFactor,
  computeGrossWithdrawal,
  computeRetirementOverview,
  endOfYearValueOfMonthlyContributions,
  hasMaterialSpendingShortfall,
  initialWithdrawalBuckets,
  netAnnualReturn,
  planAccumulationReturn,
  planBlendedReturn,
  planIncomeAtAge,
  planRetirementReturn,
  projectRetirement,
  projectRetirementWithMode,
  retirementFeasibleFromCapital,
  resolvePlanDcPayouts,
  runSorr,
  scaleTaxBucketBalances,
  stepPlanPensionFunds,
  tryComputeRequiredCapital,
  type RetirementPlan,
  type TaxProfile,
} from "./retirement-calculations";

describe("retirement calculation primitives", () => {
  test("matches Rust tax bucket scaling and initial bucket fallbacks", () => {
    expect(scaleTaxBucketBalances({ taxable: 50, taxDeferred: 50, taxFree: 0 }, 100_000)).toEqual({
      taxable: 50_000,
      taxDeferred: 50_000,
      taxFree: 0,
    });
    expect(scaleTaxBucketBalances({ taxable: 0, taxDeferred: 0, taxFree: 0 }, 10_000)).toEqual({
      taxable: 10_000,
      taxDeferred: 0,
      taxFree: 0,
    });
    expect(initialWithdrawalBuckets(null, 100_000)).toEqual({
      taxable: 100_000,
      taxDeferred: 0,
      taxFree: 0,
    });
    expect(initialWithdrawalBuckets(taxWithBuckets(), 120_000)).toEqual({
      taxable: 60_000,
      taxDeferred: 60_000,
      taxFree: 0,
    });
    expect(initialWithdrawalBuckets(null, -5_000)).toEqual({
      taxable: 0,
      taxDeferred: 0,
      taxFree: 0,
    });
  });

  test("matches Rust tax bucket growth and contribution allocation", () => {
    expect(applyGrowthToTaxBuckets({ taxable: 100, taxDeferred: 200, taxFree: 300 }, 0.1)).toEqual({
      taxable: 110.00000000000001,
      taxDeferred: 220.00000000000003,
      taxFree: 330,
    });
    expect(applyGrowthToTaxBuckets({ taxable: 100, taxDeferred: 200, taxFree: 300 }, -1)).toEqual({
      taxable: 0,
      taxDeferred: 0,
      taxFree: 0,
    });
    expect(
      addContributionToTaxBuckets(
        { taxable: 10_000, taxDeferred: 0, taxFree: 0 },
        10_000,
        taxWithBuckets(),
      ),
    ).toEqual({
      taxable: 15_000,
      taxDeferred: 5_000,
      taxFree: 0,
    });
    expect(
      addContributionToTaxBuckets({ taxable: 10_000, taxDeferred: 0, taxFree: 0 }, 10_000, null),
    ).toEqual({
      taxable: 20_000,
      taxDeferred: 0,
      taxFree: 0,
    });
  });

  test("matches Rust withdrawal gross-up and bucket draw order", () => {
    const [gross, taxAmount] = computeGrossWithdrawal(60_000, taxWithBuckets(), 60);
    expect(closeTo(gross, 80_000)).toBe(true);
    expect(closeTo(taxAmount, 20_000)).toBe(true);

    const penalized = applyPlannedSpendingWithdrawal(
      { taxable: 10_000, taxDeferred: 20_000, taxFree: 10_000 },
      30_000,
      0,
      {
        ...taxWithBuckets(),
        earlyWithdrawalPenaltyRate: 0.1,
        earlyWithdrawalPenaltyAge: 59,
      },
      55,
    );
    expect(closeTo(penalized.grossWithdrawal, 40_000)).toBe(true);
    expect(closeTo(penalized.spendingFunded, 30_000)).toBe(true);
    expect(closeTo(penalized.taxAmount, 10_000)).toBe(true);
    expect(penalized.remainingBuckets).toEqual({
      taxable: 0,
      taxDeferred: 0,
      taxFree: 0,
    });

    const cutoff = applyPlannedSpendingWithdrawal(
      { taxable: 0, taxDeferred: 10_000, taxFree: 0 },
      7_000,
      0,
      {
        ...taxWithBuckets(),
        earlyWithdrawalPenaltyRate: 0.1,
        earlyWithdrawalPenaltyAge: 59,
      },
      59,
    );
    expect(closeTo(cutoff.grossWithdrawal, 10_000)).toBe(true);
    expect(closeTo(cutoff.taxAmount, 3_000)).toBe(true);
  });

  test("matches Rust expense, income, and DC payout primitives", () => {
    const plan = basePlan();
    plan.expenses.items = [
      { monthlyAmount: 3_000, essential: true },
      { monthlyAmount: 500, inflationRate: 0.05, startAge: 65 },
      { monthlyAmount: 1_000, endAge: 60, essential: false },
    ];

    const [age65Expenses, age65Essential] = annualExpensesAtYear(
      plan.expenses,
      65,
      20,
      plan.investment.inflationRate,
    );
    const living = 3_000 * 12 * Math.pow(1.02, 20);
    const healthcare = 500 * 12 * Math.pow(1.05, 20);
    expect(closeTo(age65Expenses, living + healthcare)).toBe(true);
    expect(closeTo(age65Essential, living + healthcare)).toBe(true);

    const streams = [
      {
        id: "db",
        label: "DB",
        streamType: "db" as const,
        startAge: 65,
        adjustForInflation: true,
        monthlyAmount: 1_000,
      },
      {
        id: "dc-active",
        label: "Active DC",
        streamType: "dc" as const,
        startAge: 40,
        adjustForInflation: false,
        currentValue: 120_000,
      },
      {
        id: "dc-future",
        label: "Future DC",
        streamType: "dc" as const,
        startAge: 65,
        adjustForInflation: false,
        currentValue: 10_000,
        monthlyContribution: 500,
        accumulationReturn: 0.04,
      },
    ];
    const payouts = resolvePlanDcPayouts(streams, 45, 60, planAccumulationReturn(plan));
    expect(payouts.get("dc-active")).toBe(350);
    expect(payouts.get("dc-future")).toBeGreaterThan(0);
    expect(planIncomeAtAge(streams, payouts, 65, 20, 0.02)).toBeGreaterThan(12_000);
  });

  test("matches Rust return and contribution helpers", () => {
    const plan = basePlan();
    plan.investment.preRetirementAnnualReturn = 0.0577;
    plan.investment.retirementAnnualReturn = 0.0337;
    plan.investment.annualInvestmentFeeRate = 0.006;

    expect(closeTo(netAnnualReturn(0.0577, 0.006), 0.0517)).toBe(true);
    expect(netAnnualReturn(-2, 0)).toBe(-0.99);
    expect(closeTo(planAccumulationReturn(plan), 0.0517)).toBe(true);
    expect(closeTo(planRetirementReturn(plan), 0.0277)).toBe(true);
    expect(closeTo(planBlendedReturn(plan, 0, false, 55), 0.0517)).toBe(true);
    expect(closeTo(planBlendedReturn(plan, 20, true, 55), 0.0277)).toBe(true);

    const monthlyValue = endOfYearValueOfMonthlyContributions(1_000, 0.12);
    expect(monthlyValue).toBeGreaterThan(12_000);
    expect(endOfYearValueOfMonthlyContributions(1_000, 0)).toBe(12_000);
    expect(boundedInflationFactor(-2, 10)).toBe(1);
    expect(boundedInflationFactor(-2, 9)).toBe(0.01);
  });

  test("matches Rust glide path and pension fund stepping helpers", () => {
    const plan = basePlan();
    plan.investment.annualInvestmentFeeRate = 0;
    plan.investment.retirementAnnualReturn = 0.04;
    plan.investment.glidePath = {
      enabled: true,
      bondAllocationAtFire: 0.25,
      bondAllocationAtHorizon: 0.75,
      bondReturnRate: 0.02,
    };

    expect(closeTo(planBlendedReturn(plan, 10, true, 55), 0.035)).toBe(true);
    const [mean, stdDev] = blendedReturnParams(
      0.07,
      0.04,
      0.12,
      0,
      45,
      55,
      95,
      plan.investment.glidePath,
      10,
      true,
    );
    expect(closeTo(mean, 0.035)).toBe(true);
    expect(stdDev).toBeGreaterThan(0);

    const balances = new Map([["dc", 10_000]]);
    stepPlanPensionFunds(
      [
        {
          id: "dc",
          label: "DC",
          streamType: "dc",
          startAge: 65,
          adjustForInflation: false,
          currentValue: 10_000,
          monthlyContribution: 100,
          accumulationReturn: 0.04,
        },
      ],
      balances,
      45,
      false,
    );
    expect(balances.get("dc")).toBe(11_600);
    stepPlanPensionFunds(
      [
        {
          id: "dc",
          label: "DC",
          streamType: "dc",
          startAge: 65,
          adjustForInflation: false,
          currentValue: 10_000,
          monthlyContribution: 100,
          accumulationReturn: 0.04,
        },
      ],
      balances,
      65,
      true,
    );
    expect(balances.get("dc")).toBe(0);
  });

  test("matches Rust required capital search behavior", () => {
    const highReturn = basePlan();
    highReturn.investment.retirementAnnualReturn = 0.07;

    const lowReturn = basePlan();
    lowReturn.investment.retirementAnnualReturn = 0.03;

    const highReturnTarget = tryComputeRequiredCapital(
      highReturn,
      highReturn.personal.targetRetirementAge,
    );
    const lowReturnTarget = tryComputeRequiredCapital(
      lowReturn,
      lowReturn.personal.targetRetirementAge,
    );
    expect(highReturnTarget).not.toBeNull();
    expect(lowReturnTarget).not.toBeNull();
    expect(lowReturnTarget!).toBeGreaterThan(highReturnTarget!);

    const unreachable = basePlan();
    unreachable.expenses.items[0].monthlyAmount = Number.MAX_VALUE / 4;
    expect(tryComputeRequiredCapital(unreachable, unreachable.personal.targetRetirementAge)).toBe(
      null,
    );
  });

  test("matches Rust deterministic projection retirement timing semantics", () => {
    const plan = basePlan();
    plan.personal.currentAge = 35;
    const projection = projectRetirement(plan, 100_000, { currentYear: 2026 });

    expect(projection.fireAge).not.toBeNull();
    expect(projection.fireAge!).toBeLessThanOrEqual(plan.personal.targetRetirementAge);
    expect(projection.retirementStartAge).toBe(plan.personal.targetRetirementAge);
    expect(projection.retirementStartReason).toBe("funded");
    expect(projection.fundedAtRetirement).toBe(true);
    expect(projection.fireYear).toBe(2026 + projection.fireAge! - plan.personal.currentAge);
    expect(
      projection.yearByYear
        .filter((snapshot) => snapshot.age < plan.personal.targetRetirementAge)
        .every((snapshot) => snapshot.phase === "accumulation"),
    ).toBe(true);

    const targetSnapshot = projection.yearByYear.find(
      (snapshot) => snapshot.age === plan.personal.targetRetirementAge,
    );
    expect(targetSnapshot?.phase).toBe("fire");
    expect(targetSnapshot?.plannedExpenses).toBeGreaterThan(0);
    expect(targetSnapshot?.grossWithdrawal).toBeGreaterThan(0);
  });

  test("matches Rust traditional mode forced retirement semantics", () => {
    const plan = basePlan();
    plan.investment.monthlyContribution = 0;
    const projection = projectRetirementWithMode(plan, 0, "traditional", { currentYear: 2026 });

    expect(projection.fireAge).toBe(null);
    expect(projection.retirementStartAge).toBe(plan.personal.targetRetirementAge);
    expect(projection.retirementStartReason).toBe("target_age_forced");
    expect(projection.fundedAtRetirement).toBe(false);
    expect(
      projection.yearByYear.find((snapshot) => snapshot.age === plan.personal.targetRetirementAge)
        ?.phase,
    ).toBe("fire");
  });

  test("matches Rust projection continuity and feasibility checks", () => {
    const plan = basePlan();
    const projection = projectRetirement(plan, 100_000, { currentYear: 2026 });

    for (let index = 0; index < projection.yearByYear.length - 1; index += 1) {
      const current = projection.yearByYear[index];
      const next = projection.yearByYear[index + 1];
      expect(closeTo(current.portfolioEndValue, next.portfolioValue, 0.01)).toBe(true);
    }
    const requiredCapital = tryComputeRequiredCapital(plan, plan.personal.targetRetirementAge);
    expect(requiredCapital).not.toBeNull();
    expect(
      retirementFeasibleFromCapital(
        plan,
        plan.personal.targetRetirementAge,
        requiredCapital! * 1.001,
      ),
    ).toBe(true);
  });

  test("assembles Rust-compatible retirement overview targets and reconciliation", () => {
    const plan = basePlan();
    plan.personal.currentAge = 35;
    const overview = computeRetirementOverview(plan, 100_000, "fire", { currentYear: 2026 });

    expect(overview.analysisMode).toBe("fire");
    expect(overview.desiredFireAge).toBe(plan.personal.targetRetirementAge);
    expect(overview.portfolioNow).toBe(100_000);
    expect(overview.requiredCapitalReachable).toBe(true);
    expect(overview.targetReconciliation.targetAge).toBe(plan.personal.targetRetirementAge);
    expect(overview.targetReconciliation.inflationFactorToTarget).toBeGreaterThan(1);
    expect(
      closeTo(
        overview.targetReconciliation.requiredCapitalNominal,
        overview.requiredCapitalAtGoalAge,
        0.01,
      ),
    ).toBe(true);
    expect(overview.targetReconciliation.requiredCapitalTodayValue).toBeLessThan(
      overview.targetReconciliation.requiredCapitalNominal,
    );
    expect(overview.trajectory.at(-1)?.portfolioEnd).toBeGreaterThanOrEqual(0);
  });

  test("assembles Rust-compatible budget breakdown units and income percentages", () => {
    const plan = basePlan();
    plan.personal.currentAge = 35;
    plan.personal.targetRetirementAge = 65;
    plan.expenses.items[0].monthlyAmount = 1_000;
    plan.incomeStreams.push({
      id: "pension",
      label: "Pension",
      streamType: "db",
      startAge: 65,
      adjustForInflation: true,
      monthlyAmount: 500,
    });

    const overview = computeRetirementOverview(plan, 100_000, "fire", { currentYear: 2026 });
    const inflationFactor = Math.pow(1.02, 30);

    expect(
      closeTo(overview.budgetBreakdown.totalMonthlyBudget, 1_000 * inflationFactor, 0.01),
    ).toBe(true);
    expect(
      closeTo(overview.budgetBreakdown.incomeStreams[0].monthlyAmount, 500 * inflationFactor, 0.01),
    ).toBe(true);
    expect(closeTo(overview.budgetBreakdown.incomeStreams[0].percentageOfBudget, 0.5)).toBe(true);
  });

  test("assembles Rust-compatible underfunded and unreachable overview states", () => {
    const underfunded = basePlan();
    underfunded.personal.currentAge = 35;
    underfunded.personal.targetRetirementAge = 45;
    underfunded.investment.monthlyContribution = 500;
    const overview = computeRetirementOverview(underfunded, 50_000, "fire", { currentYear: 2026 });

    expect(overview.fundedAtGoalAge).toBe(false);
    expect(overview.eventuallyReachesFi).toBe(true);
    expect(overview.suggestedGoalAgeIfUnchanged).toBeGreaterThan(45);
    expect(overview.requiredAdditionalMonthlyContribution).toBeGreaterThan(0);

    const unreachable = basePlan();
    unreachable.expenses.items[0].monthlyAmount = Number.MAX_VALUE / 4;
    const unreachableOverview = computeRetirementOverview(unreachable, 0, "fire", {
      currentYear: 2026,
    });
    expect(unreachableOverview.requiredCapitalReachable).toBe(false);
    expect(unreachableOverview.successStatus).toBe("shortfall");
    expect(unreachableOverview.trajectory.every((point) => point.requiredCapital === null)).toBe(
      true,
    );
  });

  test("matches Rust material spending shortfall tolerance", () => {
    const snapshot = {
      age: 65,
      year: 2046,
      phase: "fire" as const,
      portfolioValue: 1_000_000,
      portfolioEndValue: 990_000,
      annualContribution: 0,
      annualWithdrawal: 59_950,
      annualIncome: 12_000,
      netWithdrawalFromPortfolio: 47_950,
      pensionAssets: 0,
      annualTaxes: 0,
      grossWithdrawal: 47_950,
      plannedExpenses: 60_000,
      fundedExpenses: 59_950,
      annualShortfall: 40,
    };

    expect(hasMaterialSpendingShortfall(snapshot)).toBe(false);
    expect(hasMaterialSpendingShortfall({ ...snapshot, annualShortfall: 500 })).toBe(true);
  });

  test("matches Rust sequence-of-returns scenario structure and survival semantics", () => {
    const plan = basePlan();
    plan.personal.currentAge = 45;
    plan.personal.targetRetirementAge = 55;
    plan.personal.planningHorizonAge = 60;
    plan.investment.retirementAnnualReturn = 0.05;
    plan.expenses.items[0].monthlyAmount = 1_000;

    const scenarios = runSorr(plan, 1_000_000, 55);

    expect(scenarios.map((scenario) => scenario.label)).toEqual([
      "Base case",
      "Crash Year 1 (-30%)",
      "Crash Year 5 (-30%)",
      "Double Crash",
      "Lost Decade",
    ]);
    expect(scenarios.every((scenario) => scenario.returns.length === 5)).toBe(true);
    expect(scenarios.every((scenario) => scenario.portfolioPath.length === 6)).toBe(true);
    const firstYearExpenses = 1_000 * 12 * Math.pow(1.02, 10);
    expect(closeTo(scenarios[0].portfolioPath[1], 1_000_000 * 1.05 - firstYearExpenses)).toBe(true);
    expect(scenarios[0].survived).toBe(true);
    expect(scenarios[0].failureAge).toBe(null);
    expect(scenarios[0].spendingShortfallAge).toBe(null);
    expect(scenarios[1].returns[0]).toBe(-0.3);
    expect(scenarios[1].finalValue).toBeLessThan(scenarios[0].finalValue);

    const glidePlan = {
      ...plan,
      investment: {
        ...plan.investment,
        glidePath: {
          enabled: true,
          bondAllocationAtFire: 1,
          bondAllocationAtHorizon: 1,
          bondReturnRate: 0.01,
        },
      },
    };
    expect(runSorr(glidePlan, 1_000_000, 55)[0].finalValue).toBeLessThan(scenarios[0].finalValue);

    const depleted = runSorr(
      { ...plan, expenses: { items: [{ monthlyAmount: 100_000 }] } },
      10_000,
      55,
    );
    expect(depleted[0].survived).toBe(false);
    expect(depleted[0].failureAge).toBe(56);
    expect(depleted[0].spendingShortfallAge).toBe(55);
    expect(runSorr(plan, 0, 55)).toEqual([]);
  });
});

function basePlan(): RetirementPlan {
  return {
    personal: {
      currentAge: 45,
      targetRetirementAge: 55,
      planningHorizonAge: 90,
    },
    expenses: {
      items: [{ monthlyAmount: 3_000 }],
    },
    incomeStreams: [],
    investment: {
      preRetirementAnnualReturn: 0.07,
      retirementAnnualReturn: 0.07,
      annualInvestmentFeeRate: 0,
      annualVolatility: 0.12,
      inflationRate: 0.02,
      monthlyContribution: 2_000,
      contributionGrowthRate: 0,
      glidePath: null,
    },
    tax: null,
    currency: "USD",
  };
}

function taxWithBuckets(): TaxProfile {
  return {
    taxableWithdrawalRate: 0.2,
    taxDeferredWithdrawalRate: 0.3,
    taxFreeWithdrawalRate: 0,
    earlyWithdrawalPenaltyRate: null,
    earlyWithdrawalPenaltyAge: null,
    countryCode: null,
    withdrawalBuckets: {
      taxable: 50_000,
      taxDeferred: 50_000,
      taxFree: 0,
    },
  };
}

function closeTo(actual: number, expected: number, epsilon = 0.000001): boolean {
  return Math.abs(actual - expected) <= epsilon;
}
