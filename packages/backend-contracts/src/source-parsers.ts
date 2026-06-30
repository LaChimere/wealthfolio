import { HTTP_METHODS, type CommandRoute, type HttpMethod } from "./command-surface";

export type CommandSourceName = "web" | "electron";

const ROUTE_ENTRY_RE =
  /([A-Za-z0-9_]+)\s*:\s*\{\s*method:\s*"([^"]+)"\s*,\s*path:\s*"([^"]+)"\s*,?\s*\}/g;

export function extractCommandObjectLiteral(source: string, exportName: string): string {
  const exportIndex = source.indexOf(`export const ${exportName}`);
  if (exportIndex < 0) {
    throw new Error(`Could not find exported command object ${exportName}.`);
  }

  const objectStart = source.indexOf("{", exportIndex);
  if (objectStart < 0) {
    throw new Error(`Could not find object literal for ${exportName}.`);
  }

  let depth = 0;
  for (let index = objectStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(objectStart, index + 1);
      }
    }
  }

  throw new Error(`Could not find end of object literal for ${exportName}.`);
}

export function parseCommandRoutesFromSource({
  source,
  exportName,
  sourceName,
}: {
  source: string;
  exportName: string;
  sourceName: CommandSourceName;
}): CommandRoute[] {
  const objectLiteral = extractCommandObjectLiteral(source, exportName);
  return [...objectLiteral.matchAll(ROUTE_ENTRY_RE)].map((match) => {
    const method = parseHttpMethod(match[2], match[1]);
    return {
      command: match[1],
      method,
      path: match[3],
      source: sourceName,
    };
  });
}

function parseHttpMethod(method: string, command: string): HttpMethod {
  if (HTTP_METHODS.includes(method as HttpMethod)) {
    return method as HttpMethod;
  }
  throw new Error(`Unsupported HTTP method "${method}" for command "${command}".`);
}
