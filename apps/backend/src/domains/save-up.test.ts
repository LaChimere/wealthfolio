import { describe, expect, test } from "bun:test";

import { computeSaveUpOverview, previewSaveUpOverview, validateSaveUpInput } from "./save-up";

const fixedNow = new Date(2024, 0, 1, 12);

describe("TS save-up planning domain", () => {
  test("computes on-track previews with target-date projections", () => {
    const overview = previewSaveUpOverview(
      {
        currentValue: 0,
        targetAmount: 100_000,
        targetDate: "2034-01-01",
        monthlyContribution: 600,
        expectedAnnualReturn: 0.07,
      },
      { now: fixedNow },
    );

    expect(overview.health).toBe("on_track");
    expect(overview.progress).toBe(0);
    expect(overview.projectedValueAtTargetDate).toBeGreaterThan(100_000);
    expect(overview.requiredMonthlyContribution).toBeGreaterThan(500);
    expect(overview.requiredMonthlyContribution).toBeLessThan(700);
    expect(overview.projectedCompletionDate).not.toBeNull();
    expect(overview.trajectory).toHaveLength(121);
    expect(overview.trajectory[0]).toMatchObject({
      date: "2024-01",
      nominal: 0,
      optimistic: 0,
      pessimistic: 0,
      target: 100_000,
    });
    expect(overview.trajectory.at(-1)?.date).toBe("2034-01");
  });

  test("keeps open-ended previews not applicable while still searching completion", () => {
    const overview = previewSaveUpOverview(
      {
        currentValue: 5_000,
        targetAmount: 50_000,
        targetDate: null,
        monthlyContribution: 200,
        expectedAnnualReturn: 0.05,
      },
      { now: fixedNow },
    );

    expect(overview).toMatchObject({
      health: "not_applicable",
      projectedValueAtTargetDate: 0,
      requiredMonthlyContribution: 0,
      trajectory: [],
    });
    expect(overview.projectedCompletionDate).not.toBeNull();
  });

  test("validates Rust-compatible amount, return, date, and horizon limits", () => {
    expect(() =>
      validateSaveUpInput(
        {
          currentValue: 0,
          targetAmount: Number.POSITIVE_INFINITY,
          targetDate: "2030-01-01",
          monthlyContribution: 100,
          expectedAnnualReturn: 0.07,
        },
        { now: fixedNow },
      ),
    ).toThrow("Target amount must be between 0 and 1000000000000");

    expect(() =>
      validateSaveUpInput(
        {
          currentValue: 0,
          targetAmount: 1000,
          targetDate: "2030-01-01",
          monthlyContribution: 100,
          expectedAnnualReturn: 2,
        },
        { now: fixedNow },
      ),
    ).toThrow("Expected annual return must be between -20% and 50%");

    expect(() =>
      validateSaveUpInput(
        {
          currentValue: 0,
          targetAmount: 1000,
          targetDate: "2030-02-30",
          monthlyContribution: 100,
          expectedAnnualReturn: 0.07,
        },
        { now: fixedNow },
      ),
    ).toThrow("Target date must use YYYY-MM-DD");

    expect(() =>
      validateSaveUpInput(
        {
          currentValue: 0,
          targetAmount: 1000,
          targetDate: "2124-02-01",
          monthlyContribution: 100,
          expectedAnnualReturn: 0.07,
        },
        { now: fixedNow },
      ),
    ).toThrow("Target date must be within 100 years");
  });

  test("handles zero targets, negative current values, and unreachable completion", () => {
    const zeroTarget = previewSaveUpOverview(
      {
        currentValue: 1_000,
        targetAmount: 0,
        targetDate: "2030-01-01",
        monthlyContribution: 100,
        expectedAnnualReturn: 0.07,
      },
      { now: fixedNow },
    );
    expect(zeroTarget).toMatchObject({
      progress: 0,
      health: "not_applicable",
      projectedCompletionDate: null,
    });

    const unreachable = previewSaveUpOverview(
      {
        currentValue: -500,
        targetAmount: 1_000,
        targetDate: null,
        monthlyContribution: 0,
        expectedAnnualReturn: 0,
      },
      { now: fixedNow },
    );
    expect(unreachable.progress).toBe(0);
    expect(unreachable.projectedCompletionDate).toBeNull();
  });

  test("preserves Rust local-date month clamp behavior across leap years", () => {
    const overview = computeSaveUpOverview(
      {
        currentValue: 0,
        targetAmount: 200,
        targetDate: null,
        monthlyContribution: 100,
        expectedAnnualReturn: 0,
      },
      { now: new Date(2024, 0, 31, 12) },
    );

    expect(overview.projectedCompletionDate).toBe("2024-03-29");
  });

  test("handles past target dates with immediate required contribution", () => {
    const overview = previewSaveUpOverview(
      {
        currentValue: 10,
        targetAmount: 50,
        targetDate: "2024-01-01",
        monthlyContribution: 0,
        expectedAnnualReturn: 0,
      },
      { now: new Date(2024, 0, 31, 12) },
    );

    expect(overview.projectedValueAtTargetDate).toBe(10);
    expect(overview.requiredMonthlyContribution).toBe(40);
    expect(overview.health).toBe("off_track");
    expect(overview.trajectory).toEqual([]);
    expect(overview.projectedCompletionDate).toBeNull();
  });
});
