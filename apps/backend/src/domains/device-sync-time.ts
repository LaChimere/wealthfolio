export function normalizeSyncDatetime(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const candidates = [trimmed];
  if (trimmed.includes(" ")) {
    candidates.push(trimmed.replace(" ", "T"));
  }
  for (const candidate of candidates) {
    const normalizedOffset = normalizeRfc3339Offset(candidate);
    if (normalizedOffset !== null) {
      const parsed = parseRfc3339LikeDatetime(normalizedOffset);
      if (parsed !== null) {
        return parsed;
      }
    }
  }
  return parseNaiveUtcDatetime(trimmed);
}

function normalizeRfc3339Offset(value: string): string | null {
  const match = /^(.+?)([Zz]|[+-]\d{2}|[+-]\d{4}|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const prefix = match[1] ?? "";
  const suffix = match[2] ?? "";
  if (/^[Zz]$/.test(suffix)) {
    return `${prefix}Z`;
  }
  if (/^[+-]\d{2}$/.test(suffix)) {
    return `${prefix}${suffix}:00`;
  }
  if (/^[+-]\d{4}$/.test(suffix)) {
    return `${prefix}${suffix.slice(0, 3)}:${suffix.slice(3)}`;
  }
  return value;
}

function parseRfc3339LikeDatetime(value: string): string | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const parts = datetimePartsFromMatch(match);
  if (!validDateParts(parts)) {
    return null;
  }
  const zone = match[9] ?? "Z";
  const parsed = utcDateFromParts(parts, zone);
  if (parsed === null) {
    return null;
  }
  return formatSyncDatetime(parsed, parts.second === 60);
}

function parseNaiveUtcDatetime(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.(\d+))?$/.exec(value);
  if (!match) {
    return null;
  }
  const parts = datetimePartsFromMatch(match);
  if (!validDateParts(parts)) {
    return null;
  }
  const parsed = utcDateFromParts(parts, "Z");
  return parsed === null ? null : formatSyncDatetime(parsed, parts.second === 60);
}

function datetimePartsFromMatch(match: RegExpExecArray): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  ms: number;
} {
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6]),
    ms: Number((match[8] ?? "").padEnd(3, "0").slice(0, 3) || "0"),
  };
}

function validDateParts(parts: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  ms: number;
}): boolean {
  if (
    parts.month < 1 ||
    parts.month > 12 ||
    parts.hour > 23 ||
    parts.minute > 59 ||
    parts.second > 60
  ) {
    return false;
  }
  const date = new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      Math.min(parts.second, 59),
      parts.ms,
    ),
  );
  return (
    date.getUTCFullYear() === parts.year &&
    date.getUTCMonth() === parts.month - 1 &&
    date.getUTCDate() === parts.day &&
    date.getUTCHours() === parts.hour &&
    date.getUTCMinutes() === parts.minute
  );
}

function utcDateFromParts(
  parts: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
    ms: number;
  },
  zone: string,
): Date | null {
  const local = new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      Math.min(parts.second, 59),
      parts.ms,
    ),
  );
  if (Number.isNaN(local.getTime())) {
    return null;
  }
  if (zone === "Z") {
    return local;
  }
  const zoneMatch = /^([+-])(\d{2}):(\d{2})$/.exec(zone);
  if (!zoneMatch) {
    return null;
  }
  const zoneHour = Number(zoneMatch[2]);
  const zoneMinute = Number(zoneMatch[3]);
  if (zoneHour > 23 || zoneMinute > 59) {
    return null;
  }
  const offsetMinutes = Number(`${zoneMatch[1]}1`) * (zoneHour * 60 + zoneMinute);
  return new Date(local.getTime() - offsetMinutes * 60_000);
}

function formatSyncDatetime(value: Date, isLeapSecond: boolean): string {
  const iso = value.toISOString();
  return isLeapSecond ? `${iso.slice(0, 17)}60${iso.slice(19)}` : iso;
}
