const U32_MAX = 4_294_967_295n;

export function rawJsonU32FieldIsValid(json: string, field: string): boolean {
  const tokens = topLevelJsonFieldTokens(json, field);
  if (tokens.length !== 1) {
    return false;
  }
  const token = tokens[0]?.trim() ?? "";
  if (!/^(0|[1-9]\d*)$/.test(token)) {
    return false;
  }
  return BigInt(token) <= U32_MAX;
}

function topLevelJsonFieldTokens(json: string, field: string): string[] {
  const tokens: string[] = [];
  let index = skipWhitespace(json, 0);
  if (json[index] !== "{") {
    return tokens;
  }
  index += 1;

  while (index < json.length) {
    index = skipWhitespace(json, index);
    if (json[index] === "}") {
      return tokens;
    }
    if (json[index] === ",") {
      index += 1;
      continue;
    }
    if (json[index] !== '"') {
      return tokens;
    }

    const keyEnd = readJsonStringEnd(json, index);
    if (keyEnd === -1) {
      return tokens;
    }
    let key: string;
    try {
      key = JSON.parse(json.slice(index, keyEnd));
    } catch {
      return tokens;
    }

    index = skipWhitespace(json, keyEnd);
    if (json[index] !== ":") {
      return tokens;
    }
    index = skipWhitespace(json, index + 1);
    const valueStart = index;
    const valueEnd = skipJsonValue(json, valueStart);
    if (valueEnd === -1) {
      return tokens;
    }
    if (key === field) {
      tokens.push(json.slice(valueStart, valueEnd));
    }
    index = valueEnd;
  }

  return tokens;
}

function skipWhitespace(value: string, start: number): number {
  let index = start;
  while (/\s/.test(value[index] ?? "")) {
    index += 1;
  }
  return index;
}

function readJsonStringEnd(value: string, start: number): number {
  let escaped = false;
  for (let index = start + 1; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      return index + 1;
    }
  }
  return -1;
}

function skipJsonValue(value: string, start: number): number {
  const first = value[start];
  if (first === '"') {
    return readJsonStringEnd(value, start);
  }
  if (first === "{" || first === "[") {
    return skipJsonContainer(value, start);
  }
  let index = start;
  while (index < value.length && value[index] !== "," && value[index] !== "}") {
    index += 1;
  }
  return index;
}

function skipJsonContainer(value: string, start: number): number {
  const opener = value[start];
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === opener) {
      depth += 1;
      continue;
    }
    if (char === closer) {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }
  return -1;
}
