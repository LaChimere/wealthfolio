const MAX_SAVE_UP_AMOUNT = 1_000_000_000_000;
const MAX_SAVE_UP_MONTHLY_CONTRIBUTION = 1_000_000_000;
const MIN_SAVE_UP_ANNUAL_RETURN = -0.2;
const MAX_SAVE_UP_ANNUAL_RETURN = 0.5;
const MAX_SAVE_UP_HORIZON_MONTHS = 1200;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface PlainDate {
  year: number;
  month: number;
  day: number;
}

export interface SaveUpInput {
  currentValue: number;
  targetAmount: number;
  targetDate?: string | null;
  monthlyContribution: number;
  expectedAnnualReturn: number;
}

export interface SaveUpOverview {
  currentValue: number;
  targetAmount: number;
  progress: number;
  health: "on_track" | "at_risk" | "off_track" | "not_applicable";
  projectedValueAtTargetDate: number;
  requiredMonthlyContribution: number;
  projectedCompletionDate: string | null;
  trajectory: SaveUpTrajectoryPoint[];
}

export interface SaveUpTrajectoryPoint {
  date: string;
  nominal: number;
  optimistic: number;
  pessimistic: number;
  target: number;
}

export interface SaveUpComputationOptions {
  now?: Date;
}

export function previewSaveUpOverview(
  input: SaveUpInput,
  options: SaveUpComputationOptions = {},
): SaveUpOverview {
  validateSaveUpInput(input, options);
  return computeSaveUpOverview(input, options);
}

export function validateSaveUpInput(
  input: SaveUpInput,
  options: SaveUpComputationOptions = {},
): void {
  validateFiniteAmount(
    "Current value",
    input.currentValue,
    -MAX_SAVE_UP_AMOUNT,
    MAX_SAVE_UP_AMOUNT,
  );
  validateFiniteAmount("Target amount", input.targetAmount, 0, MAX_SAVE_UP_AMOUNT);
  validateFiniteAmount(
    "Monthly contribution",
    input.monthlyContribution,
    0,
    MAX_SAVE_UP_MONTHLY_CONTRIBUTION,
  );

  if (
    !Number.isFinite(input.expectedAnnualReturn) ||
    input.expectedAnnualReturn < MIN_SAVE_UP_ANNUAL_RETURN ||
    input.expectedAnnualReturn > MAX_SAVE_UP_ANNUAL_RETURN
  ) {
    throw new Error(
      `Expected annual return must be between ${MIN_SAVE_UP_ANNUAL_RETURN * 100}% and ${
        MAX_SAVE_UP_ANNUAL_RETURN * 100
      }%`,
    );
  }

  if (input.targetDate !== undefined && input.targetDate !== null) {
    const parsed = parseDate(input.targetDate);
    if (!parsed) {
      throw new Error("Target date must use YYYY-MM-DD");
    }
    if (monthsBetween(currentLocalDate(options.now), parsed) > MAX_SAVE_UP_HORIZON_MONTHS) {
      throw new Error("Target date must be within 100 years");
    }
  }
}

export function computeSaveUpOverview(
  input: SaveUpInput,
  options: SaveUpComputationOptions = {},
): SaveUpOverview {
  const now = currentLocalDate(options.now);
  const targetDate =
    input.targetDate === undefined || input.targetDate === null
      ? undefined
      : parseDate(input.targetDate);
  const progress =
    input.targetAmount > 0 ? clamp(input.currentValue / input.targetAmount, 0, 1) : 0;

  let projectedValueAtTargetDate = 0;
  let requiredMonthlyContribution = 0;
  let health: SaveUpOverview["health"] = "not_applicable";
  let trajectory: SaveUpTrajectoryPoint[] = [];

  if (targetDate) {
    projectedValueAtTargetDate = futureValue(
      input.currentValue,
      input.monthlyContribution,
      input.expectedAnnualReturn,
      now,
      targetDate,
    );
    requiredMonthlyContribution = solveRequiredMonthly(
      input.currentValue,
      input.targetAmount,
      input.expectedAnnualReturn,
      now,
      targetDate,
    );
    if (input.targetAmount <= 0) {
      health = "not_applicable";
    } else if (projectedValueAtTargetDate >= input.targetAmount) {
      health = "on_track";
    } else if (projectedValueAtTargetDate >= input.targetAmount * 0.9) {
      health = "at_risk";
    } else {
      health = "off_track";
    }

    const months = Math.min(monthsBetween(now, targetDate), MAX_SAVE_UP_HORIZON_MONTHS);
    trajectory = generateProjectionSeries(input, months, now);
  }

  const completionDate =
    input.targetAmount > 0
      ? findCompletionDate(
          input.currentValue,
          input.targetAmount,
          input.monthlyContribution,
          input.expectedAnnualReturn,
          now,
          targetDate
            ? clampInteger(monthsBetween(now, targetDate) * 3, 120, MAX_SAVE_UP_HORIZON_MONTHS)
            : 600,
        )
      : undefined;

  return {
    currentValue: input.currentValue,
    targetAmount: input.targetAmount,
    progress,
    health,
    projectedValueAtTargetDate,
    requiredMonthlyContribution,
    projectedCompletionDate: completionDate ? formatDate(completionDate) : null,
    trajectory,
  };
}

function validateFiniteAmount(label: string, value: number, min: number, max: number): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be between ${min.toFixed(0)} and ${max.toFixed(0)}`);
  }
}

function currentLocalDate(now = new Date()): PlainDate {
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
  };
}

function parseDate(value: string): PlainDate | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return undefined;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return undefined;
  }
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return undefined;
  }
  return { year, month, day };
}

function futureValue(
  principal: number,
  monthlyContribution: number,
  annualRate: number,
  startDate: PlainDate,
  endDate: PlainDate,
): number {
  if (compareDates(endDate, startDate) <= 0) {
    return principal;
  }

  const dailyRate = annualRate / 365;
  let balance = principal;
  let cursor = startDate;

  while (compareDates(cursor, endDate) < 0) {
    const monthEnd = {
      year: cursor.year,
      month: cursor.month,
      day: daysInMonth(cursor.year, cursor.month),
    };
    const periodEnd = compareDates(monthEnd, endDate) < 0 ? monthEnd : endDate;
    const days = daysBetween(cursor, periodEnd);
    if (days > 0) {
      balance *= Math.pow(1 + dailyRate, days);
    }
    if (compareDates(periodEnd, monthEnd) === 0 && compareDates(periodEnd, endDate) < 0) {
      balance += monthlyContribution;
    }
    cursor = addDays(periodEnd, 1);
  }

  return balance;
}

function solveRequiredMonthly(
  current: number,
  target: number,
  annualRate: number,
  startDate: PlainDate,
  endDate: PlainDate,
): number {
  if (compareDates(endDate, startDate) <= 0) {
    return Math.max(target - current, 0);
  }
  if (current >= target) {
    return 0;
  }

  let low = 0;
  let high = target;
  for (let index = 0; index < 50; index += 1) {
    const mid = (low + high) / 2;
    const projected = futureValue(current, mid, annualRate, startDate, endDate);
    if (projected < target) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return Math.ceil((low + high) / 2);
}

function findCompletionDate(
  current: number,
  target: number,
  monthlyContribution: number,
  annualRate: number,
  startDate: PlainDate,
  maxMonths: number,
): PlainDate | undefined {
  if (current >= target) {
    return startDate;
  }
  if (monthlyContribution <= 0 && annualRate <= 0) {
    return undefined;
  }

  const dailyRate = annualRate / 365;
  let balance = current;
  let cursor = startDate;

  for (let index = 1; index <= maxMonths; index += 1) {
    const days = daysInMonth(cursor.year, cursor.month);
    balance *= Math.pow(1 + dailyRate, days);
    balance += monthlyContribution;
    cursor = advanceMonth(cursor);
    if (balance >= target) {
      return cursor;
    }
  }
  return undefined;
}

function generateProjectionSeries(
  input: SaveUpInput,
  months: number,
  start: PlainDate,
): SaveUpTrajectoryPoint[] {
  if (months <= 0) {
    return [];
  }

  const rates = [
    ["pessimistic", Math.max(input.expectedAnnualReturn - 0.02, 0)],
    ["nominal", input.expectedAnnualReturn],
    ["optimistic", input.expectedAnnualReturn + 0.02],
  ] as const;
  const labels: string[] = [];
  const nominalValues: number[] = [];
  const optimisticValues: number[] = [];
  const pessimisticValues: number[] = [];

  for (const [scenario, rate] of rates) {
    const dailyRate = rate / 365;
    let balance = input.currentValue;
    let cursor = start;

    for (let monthIndex = 0; monthIndex <= months; monthIndex += 1) {
      if (scenario === "nominal") {
        labels.push(formatMonth(cursor));
        nominalValues.push(balance);
      } else if (scenario === "optimistic") {
        optimisticValues.push(balance);
      } else {
        pessimisticValues.push(balance);
      }

      if (monthIndex < months) {
        const days = daysInMonth(cursor.year, cursor.month);
        balance *= Math.pow(1 + dailyRate, days);
        balance += input.monthlyContribution;
        cursor = advanceMonth(cursor);
      }
    }
  }

  return labels.map((date, index) => ({
    date,
    nominal: nominalValues[index] ?? 0,
    optimistic: optimisticValues[index] ?? 0,
    pessimistic: pessimisticValues[index] ?? 0,
    target: input.targetAmount,
  }));
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function daysBetween(start: PlainDate, end: PlainDate): number {
  return dayNumber(end) - dayNumber(start);
}

function monthsBetween(start: PlainDate, end: PlainDate): number {
  return Math.max((end.year - start.year) * 12 + (end.month - start.month), 0);
}

function advanceMonth(date: PlainDate): PlainDate {
  const nextMonth = date.month === 12 ? 1 : date.month + 1;
  const nextYear = date.month === 12 ? date.year + 1 : date.year;
  return {
    year: nextYear,
    month: nextMonth,
    day: Math.min(date.day, daysInMonth(nextYear, nextMonth)),
  };
}

function addDays(date: PlainDate, days: number): PlainDate {
  const utcDate = new Date((dayNumber(date) + days) * MS_PER_DAY);
  return {
    year: utcDate.getUTCFullYear(),
    month: utcDate.getUTCMonth() + 1,
    day: utcDate.getUTCDate(),
  };
}

function compareDates(left: PlainDate, right: PlainDate): number {
  return dayNumber(left) - dayNumber(right);
}

function dayNumber(date: PlainDate): number {
  return Date.UTC(date.year, date.month - 1, date.day) / MS_PER_DAY;
}

function formatDate(date: PlainDate): string {
  return `${date.year}-${pad2(date.month)}-${pad2(date.day)}`;
}

function formatMonth(date: PlainDate): string {
  return `${date.year}-${pad2(date.month)}`;
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.trunc(clamp(value, min, max));
}
