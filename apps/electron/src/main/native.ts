import type { IpcMain, OpenDialogOptions, SaveDialogOptions } from "electron";
import { readFile as readFileFromDisk, writeFile as writeFileToDisk } from "node:fs/promises";
import path from "node:path";

import {
  IPC_CHANNELS,
  type ElectronOpenFileResult,
  type ElectronSaveFileRequest,
} from "../shared/ipc";

interface DialogResult {
  canceled: boolean;
  filePaths: string[];
}

interface SaveDialogResult {
  canceled: boolean;
  filePath?: string;
}

interface NativeDialog {
  showOpenDialog(options: OpenDialogOptions): Promise<DialogResult>;
  showSaveDialog(options: SaveDialogOptions): Promise<SaveDialogResult>;
}

interface NativeShell {
  openExternal(url: string): Promise<void>;
}

export interface NativeIpcDependencies {
  ipcMain: Pick<IpcMain, "handle">;
  dialog: NativeDialog;
  shell: NativeShell;
  readFile?: (filePath: string) => Promise<Uint8Array>;
  writeFile?: (filePath: string, content: Uint8Array) => Promise<void>;
}

export function registerNativeIpcHandlers(deps: NativeIpcDependencies): void {
  deps.ipcMain.handle(IPC_CHANNELS.openCsvFileDialog, async () => {
    return await openCsvFileDialog(deps.dialog);
  });
  deps.ipcMain.handle(IPC_CHANNELS.openFolderDialog, async () => {
    return await openFolderDialog(deps.dialog);
  });
  deps.ipcMain.handle(IPC_CHANNELS.openDatabaseFileDialog, async () => {
    return await openDatabaseFileDialog(deps.dialog);
  });
  deps.ipcMain.handle(IPC_CHANNELS.openAddonPackageDialog, async () => {
    return await openAddonPackageDialog(deps.dialog, deps.readFile ?? readFileFromDisk);
  });
  deps.ipcMain.handle(IPC_CHANNELS.saveFileDialog, async (_event, request: unknown) => {
    return await saveFileDialog(request, deps.dialog, deps.writeFile ?? writeFileToDisk);
  });
  deps.ipcMain.handle(IPC_CHANNELS.openExternalUrl, async (_event, url: unknown) => {
    await openExternalUrl(url, deps.shell);
  });
}

export async function openCsvFileDialog(dialog: NativeDialog): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    filters: [{ name: "CSV", extensions: ["csv"] }],
    properties: ["openFile"],
  });

  return firstSelectedPath(result);
}

export async function openFolderDialog(dialog: NativeDialog): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
  });

  return firstSelectedPath(result);
}

export async function openDatabaseFileDialog(dialog: NativeDialog): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
  });

  return firstSelectedPath(result);
}

export async function openAddonPackageDialog(
  dialog: NativeDialog,
  readFile: (filePath: string) => Promise<Uint8Array>,
): Promise<ElectronOpenFileResult | null> {
  const result = await dialog.showOpenDialog({
    filters: [{ name: "Addon Packages", extensions: ["zip"] }],
    properties: ["openFile"],
  });
  const filePath = firstSelectedPath(result);
  if (!filePath) {
    return null;
  }

  return {
    fileName: path.basename(filePath),
    data: new Uint8Array(await readFile(filePath)),
  };
}

interface ParsedSaveFileRequest {
  content: unknown;
  fileName: string;
}

export async function saveFileDialog(
  request: unknown,
  dialog: NativeDialog,
  writeFile: (filePath: string, content: Uint8Array) => Promise<void>,
): Promise<boolean> {
  const { content, fileName } = parseSaveFileRequest(request);
  const normalizedContent = normalizeFileContent(content);
  const result = await dialog.showSaveDialog(buildSaveDialogOptions(fileName));
  if (result.canceled || !result.filePath) {
    return false;
  }

  await writeFile(result.filePath, normalizedContent);
  return true;
}

export async function openExternalUrl(url: unknown, shell: NativeShell): Promise<void> {
  if (typeof url !== "string") {
    throw new Error("Invalid external URL.");
  }
  const parsed = new URL(url);
  if (!["http:", "https:", "mailto:"].includes(parsed.protocol)) {
    throw new Error(`Unsupported external URL protocol: ${parsed.protocol}`);
  }

  await shell.openExternal(parsed.toString());
}

function firstSelectedPath(result: DialogResult): string | null {
  if (result.canceled) {
    return null;
  }

  return result.filePaths[0] ?? null;
}

function parseSaveFileRequest(request: unknown): ParsedSaveFileRequest {
  if (!request || typeof request !== "object") {
    throw new Error("Invalid save file request.");
  }
  const candidate = request as Partial<ElectronSaveFileRequest>;
  if (typeof candidate.fileName !== "string" || candidate.fileName.trim() === "") {
    throw new Error("Invalid save file name.");
  }

  return {
    fileName: candidate.fileName,
    content: candidate.content,
  };
}

function buildSaveDialogOptions(fileName: string): SaveDialogOptions {
  const extension = path.extname(fileName).replace(/^\./, "");
  return {
    defaultPath: fileName,
    filters: extension ? [{ name: fileName, extensions: [extension] }] : undefined,
  };
}

function normalizeFileContent(content: unknown): Uint8Array {
  if (typeof content === "string") {
    return new TextEncoder().encode(content);
  }
  if (content instanceof Uint8Array) {
    return content;
  }
  if (content instanceof ArrayBuffer) {
    return new Uint8Array(content);
  }
  if (Array.isArray(content) && content.every(isByte)) {
    return Uint8Array.from(content);
  }

  throw new Error("Invalid save file content.");
}

function isByte(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255;
}
