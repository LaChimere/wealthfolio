export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];
export type CommandSurfaceSource = "web" | "electron";
export type CommandType =
  | "backend"
  | "electron-native"
  | "electron-only-backend"
  | "web-only-backend";

export interface CommandRoute {
  command: string;
  method: HttpMethod;
  path: string;
  source: CommandSurfaceSource;
}

export type RouteMap = Map<string, CommandRoute>;

export interface ClassifiedCommand {
  command: string;
  type: CommandType;
  web?: CommandRoute;
  electron?: CommandRoute;
  normalizedPath?: string;
}

export interface CommandSurfaceStats {
  web: number;
  electron: number;
  shared: number;
  electronOnly: number;
  webOnly: number;
  backend: number;
  electronNative: number;
}

export interface CommandSurface {
  commands: ClassifiedCommand[];
  stats: CommandSurfaceStats;
}

const ELECTRON_NATIVE_COMMANDS = new Set(["check_for_updates", "install_app_update"]);

export function createRouteMap(routes: CommandRoute[]): RouteMap {
  return new Map(routes.map((route) => [route.command, route]));
}

export function normalizeApiPath(route: Pick<CommandRoute, "path" | "source">): string {
  if (route.path.startsWith("/api/v1/") || route.path === "/api/v1") {
    return route.path;
  }
  if (route.path.startsWith("/__electron_native/")) {
    return route.path;
  }
  if (!route.path.startsWith("/")) {
    return route.source === "web" ? `/api/v1/${route.path}` : route.path;
  }
  return route.source === "web" ? `/api/v1${route.path}` : route.path;
}

export function classifyCommandSurface({
  web,
  electron,
}: {
  web: Iterable<CommandRoute>;
  electron: Iterable<CommandRoute>;
}): CommandSurface {
  const webRoutes = createRouteMap([...web]);
  const electronRoutes = createRouteMap([...electron]);
  const commandNames = [...new Set([...webRoutes.keys(), ...electronRoutes.keys()])].sort();

  const commands = commandNames.map<ClassifiedCommand>((command) => {
    const webRoute = webRoutes.get(command);
    const electronRoute = electronRoutes.get(command);
    const representativeRoute = electronRoute ?? webRoute;
    const normalizedPath = representativeRoute ? normalizeApiPath(representativeRoute) : undefined;
    return {
      command,
      type: classifyCommand(command, webRoute, electronRoute),
      web: webRoute,
      electron: electronRoute,
      normalizedPath,
    };
  });

  return {
    commands,
    stats: {
      web: webRoutes.size,
      electron: electronRoutes.size,
      shared: commands.filter((command) => command.web && command.electron).length,
      electronOnly: commands.filter((command) => command.electron && !command.web).length,
      webOnly: commands.filter((command) => command.web && !command.electron).length,
      backend: commands.filter((command) => command.type !== "electron-native").length,
      electronNative: commands.filter((command) => command.type === "electron-native").length,
    },
  };
}

function classifyCommand(
  command: string,
  webRoute: CommandRoute | undefined,
  electronRoute: CommandRoute | undefined,
): CommandType {
  if (
    ELECTRON_NATIVE_COMMANDS.has(command) ||
    electronRoute?.path.startsWith("/__electron_native/") === true
  ) {
    return "electron-native";
  }
  if (electronRoute && !webRoute) {
    return "electron-only-backend";
  }
  if (webRoute && !electronRoute) {
    return "web-only-backend";
  }
  return "backend";
}
