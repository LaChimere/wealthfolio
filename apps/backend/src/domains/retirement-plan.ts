export interface RetirementPlanValidationResult {
  settingsJson: string;
  dcLinkedAccountIds: string[];
}

export interface RetirementPlanSettingsResult extends RetirementPlanValidationResult {
  settings: Record<string, unknown>;
}

export interface TaxBucketBalances {
  taxable: number;
  taxDeferred: number;
  taxFree: number;
}

export type RetirementTimingMode = "fire" | "traditional";

interface RetirementPlanValidationOptions {
  asOf?: Date;
}

interface PersonalProfile {
  birthYearMonth?: string;
  currentAge: number;
  targetRetirementAge: number;
  planningHorizonAge: number;
}

interface InvestmentAssumptions {
  preRetirementAnnualReturn: number;
  retirementAnnualReturn: number;
  annualInvestmentFeeRate: number;
  annualVolatility: number;
  inflationRate: number;
  monthlyContribution: number;
  contributionGrowthRate: number;
}

const RETIREMENT_MIN_ANNUAL_RETURN = -0.2;
const RETIREMENT_MAX_ANNUAL_RETURN = 0.5;
const RETIREMENT_MAX_ANNUAL_INVESTMENT_FEE = 0.1;
const RETIREMENT_MAX_ANNUAL_VOLATILITY = 1;

export function validateAndNormalizeRetirementPlanSettings(
  settingsJson: string,
  options: RetirementPlanValidationOptions = {},
): RetirementPlanValidationResult {
  const result = parseValidateAndNormalizeRetirementPlanSettings(settingsJson, options);
  return {
    settingsJson: result.settingsJson,
    dcLinkedAccountIds: result.dcLinkedAccountIds,
  };
}

export function parseValidateAndNormalizeRetirementPlanSettings(
  settingsJson: string,
  options: RetirementPlanValidationOptions = {},
): RetirementPlanSettingsResult {
  const settings = parseRetirementPlanJson(settingsJson);
  const personal = readPersonalProfile(settings);
  const normalizedAge = personal.birthYearMonth
    ? ageFromBirthYearMonth(personal.birthYearMonth, options.asOf ?? new Date())
    : null;
  if (normalizedAge !== null) {
    personal.currentAge = normalizedAge;
    readRequiredRecord(settings, "personal").currentAge = normalizedAge;
  }

  const investment = readInvestmentAssumptions(settings);
  const dcLinkedAccountIds = validateRetirementPlan(settings, personal, investment);

  return {
    settings,
    settingsJson: JSON.stringify(settings),
    dcLinkedAccountIds,
  };
}

function parseRetirementPlanJson(settingsJson: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(settingsJson);
    if (!isRecord(parsed)) {
      throw new Error("retirement plan must be an object");
    }
    return parsed;
  } catch (error) {
    throw new Error(`Invalid input: Invalid retirement plan JSON: ${errorMessage(error)}`);
  }
}

function readPersonalProfile(settings: Record<string, unknown>): PersonalProfile {
  const personal = readRequiredRecord(settings, "personal");
  return {
    birthYearMonth: readOptionalString(personal, "birthYearMonth"),
    currentAge: readRequiredU32(personal, "personal.currentAge"),
    targetRetirementAge: readRequiredU32(personal, "personal.targetRetirementAge"),
    planningHorizonAge: readRequiredU32(personal, "personal.planningHorizonAge"),
  };
}

function readInvestmentAssumptions(settings: Record<string, unknown>): InvestmentAssumptions {
  const investment = readRequiredRecord(settings, "investment");
  return {
    preRetirementAnnualReturn:
      readOptionalFiniteNumber(
        investment,
        "preRetirementAnnualReturn",
        "investment.preRetirementAnnualReturn",
      ) ??
      readOptionalFiniteNumber(
        investment,
        "expectedAnnualReturn",
        "investment.expectedAnnualReturn",
      ) ??
      0.0577,
    retirementAnnualReturn:
      readOptionalFiniteNumber(
        investment,
        "retirementAnnualReturn",
        "investment.retirementAnnualReturn",
      ) ?? 0.0337,
    annualInvestmentFeeRate:
      readOptionalFiniteNumber(
        investment,
        "annualInvestmentFeeRate",
        "investment.annualInvestmentFeeRate",
      ) ?? 0.006,
    annualVolatility:
      readOptionalFiniteNumber(investment, "annualVolatility", "investment.annualVolatility") ??
      readOptionalFiniteNumber(
        investment,
        "expectedReturnStdDev",
        "investment.expectedReturnStdDev",
      ) ??
      0.12,
    inflationRate: readRequiredFiniteNumber(investment, "investment.inflationRate"),
    monthlyContribution: readRequiredFiniteNumber(investment, "investment.monthlyContribution"),
    contributionGrowthRate: readRequiredFiniteNumber(
      investment,
      "investment.contributionGrowthRate",
    ),
  };
}

function validateRetirementPlan(
  settings: Record<string, unknown>,
  personal: PersonalProfile,
  investment: InvestmentAssumptions,
): string[] {
  if (personal.currentAge >= personal.planningHorizonAge) {
    throw new Error("Invalid input: Current age must be less than planning horizon");
  }
  if (personal.targetRetirementAge <= personal.currentAge) {
    throw new Error("Invalid input: Target retirement age must be after current age");
  }
  if (personal.targetRetirementAge > personal.planningHorizonAge) {
    throw new Error("Invalid input: Target retirement age must be before planning horizon");
  }

  const personalRecord = readRequiredRecord(settings, "personal");
  const currentAnnualSalary = readOptionalFiniteNumber(
    personalRecord,
    "currentAnnualSalary",
    "personal.currentAnnualSalary",
  );
  if (currentAnnualSalary !== null) {
    validateNonNegativeAmount("Current salary", currentAnnualSalary);
  }
  const salaryGrowthRate = readOptionalFiniteNumber(
    personalRecord,
    "salaryGrowthRate",
    "personal.salaryGrowthRate",
  );
  if (salaryGrowthRate !== null) {
    validateFiniteRange("Salary growth", salaryGrowthRate, -0.5, 0.5);
  }

  validateExpenses(settings);
  validateInvestment(investment);
  const dcLinkedAccountIds = validateIncomeStreams(settings, personal);
  validateTaxProfile(settings, personal);
  readRequiredString(settings, "currency");
  return dcLinkedAccountIds;
}

function validateExpenses(settings: Record<string, unknown>): void {
  const expenses = readRequiredRecord(settings, "expenses");
  const items = readOptionalArray(expenses, "items", "expenses.items") ?? [];
  for (const [index, item] of items.entries()) {
    if (!isRecord(item)) {
      throw new Error(
        `Invalid input: Invalid retirement plan JSON: expenses.items[${index}] must be an object`,
      );
    }
    const monthlyAmount = readRequiredFiniteNumber(item, `expenses.items[${index}].monthlyAmount`);
    validateNonNegativeAmount("Retirement spending", monthlyAmount);
    const inflationRate = readOptionalFiniteNumber(
      item,
      "inflationRate",
      `expenses.items[${index}].inflationRate`,
    );
    if (inflationRate !== null) {
      validateFiniteRange("Spending inflation override", inflationRate, -0.1, 0.2);
    }
    const startAge = readOptionalU32(item, "startAge", `expenses.items[${index}].startAge`);
    const endAge = readOptionalU32(item, "endAge", `expenses.items[${index}].endAge`);
    if (startAge !== null && endAge !== null && startAge >= endAge) {
      throw new Error("Invalid input: Spending To age must be after From age");
    }
  }
}

function validateInvestment(investment: InvestmentAssumptions): void {
  validateFiniteRange(
    "Return before retirement",
    investment.preRetirementAnnualReturn,
    RETIREMENT_MIN_ANNUAL_RETURN,
    RETIREMENT_MAX_ANNUAL_RETURN,
  );
  validateFiniteRange(
    "Return during retirement",
    investment.retirementAnnualReturn,
    RETIREMENT_MIN_ANNUAL_RETURN,
    RETIREMENT_MAX_ANNUAL_RETURN,
  );
  validateFiniteRange(
    "Annual investment fee",
    investment.annualInvestmentFeeRate,
    0,
    RETIREMENT_MAX_ANNUAL_INVESTMENT_FEE,
  );
  validateFiniteRange(
    "Annual volatility",
    investment.annualVolatility,
    0,
    RETIREMENT_MAX_ANNUAL_VOLATILITY,
  );
  validateFiniteRange("Inflation", investment.inflationRate, -0.1, 0.2);
  validateNonNegativeAmount("Monthly contribution", investment.monthlyContribution);
  validateFiniteRange("Contribution growth", investment.contributionGrowthRate, -0.5, 0.5);
  if (
    investment.preRetirementAnnualReturn - investment.annualInvestmentFeeRate <= -0.99 ||
    investment.retirementAnnualReturn - investment.annualInvestmentFeeRate <= -0.99
  ) {
    throw new Error("Invalid input: Return after fees must be greater than -99%");
  }
}

function validateIncomeStreams(
  settings: Record<string, unknown>,
  personal: PersonalProfile,
): string[] {
  const incomeStreams = readRequiredArray(settings, "incomeStreams");
  const dcLinkedAccountIds: string[] = [];
  for (const [index, stream] of incomeStreams.entries()) {
    if (!isRecord(stream)) {
      throw new Error(
        `Invalid input: Invalid retirement plan JSON: incomeStreams[${index}] must be an object`,
      );
    }
    readRequiredString(stream, `incomeStreams[${index}].id`);
    readRequiredString(stream, `incomeStreams[${index}].label`);
    const streamType = readRequiredString(stream, `incomeStreams[${index}].streamType`);
    if (streamType !== "db" && streamType !== "dc") {
      throw new Error(
        `Invalid input: Invalid retirement plan JSON: incomeStreams[${index}].streamType must be 'db' or 'dc'`,
      );
    }
    const startAge = readRequiredU32(stream, `incomeStreams[${index}].startAge`);
    readRequiredBoolean(stream, `incomeStreams[${index}].adjustForInflation`);
    if (startAge > personal.planningHorizonAge) {
      throw new Error("Invalid input: Income start age must be within the planning horizon");
    }
    const monthlyAmount = readOptionalFiniteNumber(
      stream,
      "monthlyAmount",
      `incomeStreams[${index}].monthlyAmount`,
    );
    if (monthlyAmount !== null) {
      validateNonNegativeAmount("Income amount", monthlyAmount);
    }
    const annualGrowthRate = readOptionalFiniteNumber(
      stream,
      "annualGrowthRate",
      `incomeStreams[${index}].annualGrowthRate`,
    );
    if (annualGrowthRate !== null) {
      validateFiniteRange("Income growth", annualGrowthRate, -0.1, 0.2);
    }
    const currentValue = readOptionalFiniteNumber(
      stream,
      "currentValue",
      `incomeStreams[${index}].currentValue`,
    );
    if (currentValue !== null) {
      validateNonNegativeAmount("Defined-contribution current value", currentValue);
    }
    const monthlyContribution = readOptionalFiniteNumber(
      stream,
      "monthlyContribution",
      `incomeStreams[${index}].monthlyContribution`,
    );
    if (monthlyContribution !== null) {
      validateNonNegativeAmount("Defined-contribution contribution", monthlyContribution);
    }
    const accumulationReturn = readOptionalFiniteNumber(
      stream,
      "accumulationReturn",
      `incomeStreams[${index}].accumulationReturn`,
    );
    if (accumulationReturn !== null) {
      validateFiniteRange(
        "Defined-contribution return",
        accumulationReturn,
        RETIREMENT_MIN_ANNUAL_RETURN,
        RETIREMENT_MAX_ANNUAL_RETURN,
      );
    }
    const linkedAccountId = readOptionalString(stream, "linkedAccountId");
    if (streamType === "dc" && linkedAccountId !== undefined) {
      dcLinkedAccountIds.push(linkedAccountId);
    }
  }

  const seen = new Set<string>();
  for (const linkedAccountId of dcLinkedAccountIds) {
    if (seen.has(linkedAccountId)) {
      throw new Error(
        `Invalid input: Duplicate linked account '${linkedAccountId}' across DC income streams`,
      );
    }
    seen.add(linkedAccountId);
  }
  return dcLinkedAccountIds;
}

function validateTaxProfile(settings: Record<string, unknown>, personal: PersonalProfile): void {
  const tax = settings.tax;
  if (tax === undefined || tax === null) {
    return;
  }
  if (!isRecord(tax)) {
    throw new Error("Invalid input: Invalid retirement plan JSON: tax must be an object or null");
  }
  validateFiniteRange(
    "Taxable withdrawal tax rate",
    readRequiredFiniteNumber(tax, "tax.taxableWithdrawalRate"),
    0,
    1,
  );
  validateFiniteRange(
    "Tax-deferred withdrawal tax rate",
    readRequiredFiniteNumber(tax, "tax.taxDeferredWithdrawalRate"),
    0,
    1,
  );
  validateFiniteRange(
    "Tax-free withdrawal tax rate",
    readRequiredFiniteNumber(tax, "tax.taxFreeWithdrawalRate"),
    0,
    1,
  );
  const earlyWithdrawalPenaltyRate = readOptionalFiniteNumber(
    tax,
    "earlyWithdrawalPenaltyRate",
    "tax.earlyWithdrawalPenaltyRate",
  );
  if (earlyWithdrawalPenaltyRate !== null) {
    validateFiniteRange("Early withdrawal penalty", earlyWithdrawalPenaltyRate, 0, 1);
  }
  const earlyWithdrawalPenaltyAge = readOptionalU32(
    tax,
    "earlyWithdrawalPenaltyAge",
    "tax.earlyWithdrawalPenaltyAge",
  );
  if (
    earlyWithdrawalPenaltyAge !== null &&
    earlyWithdrawalPenaltyAge > personal.planningHorizonAge
  ) {
    throw new Error(
      "Invalid input: Early withdrawal penalty age must be within the planning horizon",
    );
  }
}

function validateFiniteRange(label: string, value: number, min: number, max: number): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(
      `Invalid input: ${label} must be between ${(min * 100).toFixed(0)}% and ${(max * 100).toFixed(0)}%`,
    );
  }
}

function validateNonNegativeAmount(label: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid input: ${label} cannot be negative`);
  }
}

function ageFromBirthYearMonth(birthYearMonth: string, asOf: Date): number | null {
  const match = /^(\d{4})-(\d{2})$/.exec(birthYearMonth);
  if (!match) {
    return null;
  }
  const birthYear = Number(match[1]);
  const birthMonth = Number(match[2]);
  const currentYear = asOf.getFullYear();
  const currentMonth = asOf.getMonth() + 1;
  if (!Number.isInteger(birthYear) || !Number.isInteger(birthMonth)) {
    return null;
  }
  if (birthMonth < 1 || birthMonth > 12 || birthYear > currentYear) {
    return null;
  }
  const age = currentYear - birthYear - (currentMonth < birthMonth ? 1 : 0);
  return age >= 0 ? age : null;
}

function readRequiredRecord(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const candidate = value[key];
  if (!isRecord(candidate)) {
    throw new Error(`Invalid input: Invalid retirement plan JSON: ${key} must be an object`);
  }
  return candidate;
}

function readRequiredArray(value: Record<string, unknown>, key: string): unknown[] {
  const candidate = value[key];
  if (!Array.isArray(candidate)) {
    throw new Error(`Invalid input: Invalid retirement plan JSON: ${key} must be an array`);
  }
  return candidate;
}

function readOptionalArray(
  value: Record<string, unknown>,
  key: string,
  label: string,
): unknown[] | null {
  const candidate = value[key];
  if (candidate === undefined || candidate === null) {
    return null;
  }
  if (!Array.isArray(candidate)) {
    throw new Error(`Invalid input: Invalid retirement plan JSON: ${label} must be an array`);
  }
  return candidate;
}

function readRequiredString(value: Record<string, unknown>, label: string): string {
  const key = label.slice(label.lastIndexOf(".") + 1);
  const candidate = value[key];
  if (typeof candidate !== "string") {
    throw new Error(`Invalid input: Invalid retirement plan JSON: ${label} must be a string`);
  }
  return candidate;
}

function readOptionalString(value: Record<string, unknown>, key: string): string | undefined {
  const candidate = value[key];
  if (candidate === undefined || candidate === null) {
    return undefined;
  }
  if (typeof candidate !== "string") {
    throw new Error(`Invalid input: Invalid retirement plan JSON: ${key} must be a string`);
  }
  return candidate;
}

function readRequiredBoolean(value: Record<string, unknown>, label: string): boolean {
  const key = label.slice(label.lastIndexOf(".") + 1);
  const candidate = value[key];
  if (typeof candidate !== "boolean") {
    throw new Error(`Invalid input: Invalid retirement plan JSON: ${label} must be a boolean`);
  }
  return candidate;
}

function readRequiredU32(value: Record<string, unknown>, label: string): number {
  const key = label.slice(label.lastIndexOf(".") + 1);
  const candidate = value[key];
  if (!Number.isInteger(candidate) || (candidate as number) < 0) {
    throw new Error(
      `Invalid input: Invalid retirement plan JSON: ${label} must be a non-negative integer`,
    );
  }
  return candidate as number;
}

function readOptionalU32(
  value: Record<string, unknown>,
  key: string,
  label: string,
): number | null {
  const candidate = value[key];
  if (candidate === undefined || candidate === null) {
    return null;
  }
  if (!Number.isInteger(candidate) || (candidate as number) < 0) {
    throw new Error(
      `Invalid input: Invalid retirement plan JSON: ${label} must be a non-negative integer`,
    );
  }
  return candidate as number;
}

function readRequiredFiniteNumber(value: Record<string, unknown>, label: string): number {
  const key = label.slice(label.lastIndexOf(".") + 1);
  const candidate = value[key];
  if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
    throw new Error(
      `Invalid input: Invalid retirement plan JSON: ${label} must be a finite number`,
    );
  }
  return candidate;
}

function readOptionalFiniteNumber(
  value: Record<string, unknown>,
  key: string,
  label: string,
): number | null {
  const candidate = value[key];
  if (candidate === undefined || candidate === null) {
    return null;
  }
  if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
    throw new Error(
      `Invalid input: Invalid retirement plan JSON: ${label} must be a finite number`,
    );
  }
  return candidate;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
