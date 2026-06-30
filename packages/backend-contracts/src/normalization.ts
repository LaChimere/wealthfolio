import Decimal from "decimal.js";

export interface NormalizedErrorEnvelope {
  message: string;
  code?: string;
  status?: number;
}

export function normalizeDecimalString(value: string | number | Decimal): string {
  const decimal = new Decimal(value);
  if (!decimal.isFinite()) {
    throw new Error(`Cannot normalize non-finite decimal value "${value}".`);
  }
  return decimal.isZero() ? "0" : decimal.toString();
}

export function normalizeTemporalString(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Cannot normalize invalid temporal value "${value}".`);
  }
  return date.toISOString();
}

export function normalizeErrorEnvelope(error: unknown): NormalizedErrorEnvelope {
  if (error instanceof Error) {
    return { message: error.message };
  }
  if (typeof error === "string") {
    return { message: error };
  }
  if (isErrorRecord(error)) {
    return {
      message: typeof error.message === "string" ? error.message : String(error),
      code: typeof error.code === "string" ? error.code : undefined,
      status: typeof error.status === "number" ? error.status : undefined,
    };
  }
  return { message: String(error) };
}

export function normalizeOutputForParity(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeOutputForParity(item));
  }
  if (!isErrorRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, normalizeOutputForParity(entryValue)]),
  );
}

function isErrorRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
