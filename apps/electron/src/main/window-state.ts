import { mkdirSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface PersistedWindowState {
  height: number;
  maximized: boolean;
  width: number;
  x?: number;
  y?: number;
}

export interface WindowStatePersistence {
  load(): Promise<PersistedWindowState | null>;
  save(state: PersistedWindowState): Promise<void>;
  saveSync(state: PersistedWindowState): void;
}

const MIN_WINDOW_HEIGHT = 480;
const MIN_WINDOW_WIDTH = 720;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidDimension(value: unknown, minimum: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum;
}

function isValidCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

export function validateWindowState(value: unknown): PersistedWindowState | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    !isValidDimension(value.width, MIN_WINDOW_WIDTH) ||
    !isValidDimension(value.height, MIN_WINDOW_HEIGHT)
  ) {
    return null;
  }

  const state: PersistedWindowState = {
    height: value.height,
    maximized: value.maximized === true,
    width: value.width,
  };

  if (isValidCoordinate(value.x) && isValidCoordinate(value.y)) {
    state.x = value.x;
    state.y = value.y;
  }

  return state;
}

export function createWindowStatePersistence(filePath: string): WindowStatePersistence {
  return {
    async load() {
      try {
        const content = await readFile(filePath, "utf8");
        return validateWindowState(JSON.parse(content));
      } catch (error) {
        if (isMissingFileError(error)) {
          return null;
        }
        throw error;
      }
    },
    async save(state) {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    },
    saveSync(state) {
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    },
  };
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}
