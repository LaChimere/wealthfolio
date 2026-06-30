export function sidecarTokenAuthorized(headers: Headers, expectedToken: string): boolean {
  const headerValue = headers.get("authorization");
  if (!headerValue) {
    return false;
  }

  const [scheme, token] = splitAuthorizationHeader(headerValue);
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return false;
  }
  return constantTimeEqual(
    new TextEncoder().encode(token.trim()),
    new TextEncoder().encode(expectedToken),
  );
}

function splitAuthorizationHeader(value: string): [string | undefined, string | undefined] {
  const separator = value.indexOf(" ");
  if (separator < 0) {
    return [undefined, undefined];
  }
  return [value.slice(0, separator), value.slice(separator + 1)];
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  const maxLength = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let index = 0; index < maxLength; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return diff === 0;
}
