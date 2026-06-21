import { ELECTRON_API_KEY, type WealthfolioElectronApi } from "@wealthfolio/electron/shared/ipc";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RetirementPlan } from "@/features/goals/retirement-planner/types";
import {
  calculateRetirementProjection,
  runRetirementMonteCarlo,
  runRetirementSorr,
} from "./fire-planner";

const plan: RetirementPlan = {
  version: "v3",
  personal: { currentAge: 40, targetRetirementAge: 55, planningHorizonAge: 90 },
  expenses: { items: [] },
  incomeStreams: [],
  investment: {
    preRetirementAnnualReturn: 0.05,
    retirementAnnualReturn: 0.04,
    annualInvestmentFeeRate: 0.002,
    annualVolatility: 0.12,
    inflationRate: 0.02,
    monthlyContribution: 1000,
    contributionGrowthRate: 0.01,
  },
  currency: "USD",
};

function installElectronApi(api: Partial<WealthfolioElectronApi>) {
  window[ELECTRON_API_KEY] = {
    getRuntimeInfo: vi.fn(),
    invoke: vi.fn(),
    writeLog: vi.fn().mockResolvedValue(undefined),
    ...api,
  } as WealthfolioElectronApi;
}

afterEach(() => {
  delete window[ELECTRON_API_KEY];
  vi.restoreAllMocks();
});

describe("electron FIRE planner adapter", () => {
  it("delegates retirement simulation payloads through the preload bridge", async () => {
    const bridgeInvoke = vi
      .fn()
      .mockResolvedValueOnce({ projectedValue: 1 })
      .mockResolvedValueOnce({ successRate: 0.9 })
      .mockResolvedValueOnce([{ scenario: "early-loss" }]);
    installElectronApi({ invoke: bridgeInvoke });

    await expect(calculateRetirementProjection(plan, 250_000, "fire", "goal-1")).resolves.toEqual({
      projectedValue: 1,
    });
    await expect(
      runRetirementMonteCarlo(plan, 250_000, undefined, "fire", "goal-1", 1234),
    ).resolves.toEqual({ successRate: 0.9 });
    await expect(runRetirementSorr(plan, 1_000_000, 55, "goal-1")).resolves.toEqual([
      { scenario: "early-loss" },
    ]);

    expect(bridgeInvoke).toHaveBeenNthCalledWith(1, "calculate_retirement_projection", {
      plan,
      currentPortfolio: 250_000,
      plannerMode: "fire",
      goalId: "goal-1",
    });
    expect(bridgeInvoke).toHaveBeenNthCalledWith(2, "run_retirement_monte_carlo", {
      plan,
      currentPortfolio: 250_000,
      nSims: 100_000,
      plannerMode: "fire",
      goalId: "goal-1",
      seed: 1234,
    });
    expect(bridgeInvoke).toHaveBeenNthCalledWith(3, "run_retirement_sorr", {
      plan,
      portfolioAtFire: 1_000_000,
      retirementStartAge: 55,
      goalId: "goal-1",
    });
  });
});
