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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("web FIRE planner adapter", () => {
  it("posts retirement simulation payloads to the TS backend routes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ projectedValue: 1 }))
      .mockResolvedValueOnce(Response.json({ successRate: 0.9 }))
      .mockResolvedValueOnce(Response.json([{ scenario: "early-loss" }]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(calculateRetirementProjection(plan, 250_000, "fire", "goal-1")).resolves.toEqual({
      projectedValue: 1,
    });
    await expect(
      runRetirementMonteCarlo(plan, 250_000, undefined, "fire", "goal-1", 1234),
    ).resolves.toEqual({ successRate: 0.9 });
    await expect(runRetirementSorr(plan, 1_000_000, 55, "goal-1")).resolves.toEqual([
      { scenario: "early-loss" },
    ]);

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/v1/goals/retirement/projection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan,
        currentPortfolio: 250_000,
        plannerMode: "fire",
        goalId: "goal-1",
      }),
      credentials: "same-origin",
      signal: expect.any(AbortSignal),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/v1/goals/retirement/monte-carlo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan,
        currentPortfolio: 250_000,
        nSims: 100_000,
        plannerMode: "fire",
        goalId: "goal-1",
        seed: 1234,
      }),
      credentials: "same-origin",
      signal: expect.any(AbortSignal),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/v1/goals/retirement/sequence-of-returns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan,
        portfolioAtFire: 1_000_000,
        retirementStartAge: 55,
        goalId: "goal-1",
      }),
      credentials: "same-origin",
      signal: expect.any(AbortSignal),
    });
  });
});
