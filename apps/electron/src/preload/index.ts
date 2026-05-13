import { contextBridge, ipcRenderer, webUtils } from "electron";

import {
  ELECTRON_API_KEY,
  ELECTRON_FILE_DROP_EVENTS,
  IPC_CHANNELS,
  type ElectronEventMessage,
  type ElectronFileDropEventMessage,
  type ElectronFileDropPayload,
  type WealthfolioElectronApi,
} from "../shared/ipc";

let fileDragDepth = 0;

function hasDraggedFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

function getFilePaths(fileList: FileList | null | undefined): string[] {
  if (!fileList) {
    return [];
  }

  return Array.from(fileList)
    .map((file) => webUtils.getPathForFile(file))
    .filter((path) => path.length > 0);
}

function createFileDropPayload(event: DragEvent, includePaths: boolean): ElectronFileDropPayload {
  return {
    paths: includePaths ? getFilePaths(event.dataTransfer?.files) : [],
    position: {
      x: event.clientX,
      y: event.clientY,
    },
  };
}

function sendFileDropEvent(message: ElectronFileDropEventMessage): void {
  ipcRenderer.send(IPC_CHANNELS.fileDropEvent, message);
}

function registerFileDropForwarders(): void {
  window.addEventListener(
    "dragenter",
    (event) => {
      if (!hasDraggedFiles(event)) {
        return;
      }

      const wasOutsideWindow = fileDragDepth === 0;
      fileDragDepth += 1;
      event.preventDefault();
      if (wasOutsideWindow) {
        sendFileDropEvent({
          event: ELECTRON_FILE_DROP_EVENTS.hover,
          payload: createFileDropPayload(event, false),
        });
      }
    },
    { capture: true },
  );

  window.addEventListener(
    "dragover",
    (event) => {
      if (!hasDraggedFiles(event)) {
        return;
      }

      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
    },
    { capture: true },
  );

  window.addEventListener(
    "dragleave",
    (event) => {
      if (!hasDraggedFiles(event)) {
        return;
      }

      event.preventDefault();
      fileDragDepth = Math.max(0, fileDragDepth - 1);
      if (fileDragDepth === 0) {
        sendFileDropEvent({
          event: ELECTRON_FILE_DROP_EVENTS.cancelled,
          payload: null,
        });
      }
    },
    { capture: true },
  );

  window.addEventListener(
    "drop",
    (event) => {
      if (!hasDraggedFiles(event)) {
        return;
      }

      event.preventDefault();
      fileDragDepth = 0;
      sendFileDropEvent({
        event: ELECTRON_FILE_DROP_EVENTS.drop,
        payload: createFileDropPayload(event, true),
      });
    },
    { capture: true },
  );
}

const api: WealthfolioElectronApi = {
  getRuntimeInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getRuntimeInfo),
  invoke: (command, payload) => ipcRenderer.invoke(IPC_CHANNELS.invoke, { command, payload }),
  startAiChatStream: (streamId, request) =>
    ipcRenderer.invoke(IPC_CHANNELS.startAiChatStream, { streamId, request }),
  cancelAiChatStream: (streamId) =>
    ipcRenderer.invoke(IPC_CHANNELS.cancelAiChatStream, { streamId }),
  openCsvFileDialog: () => ipcRenderer.invoke(IPC_CHANNELS.openCsvFileDialog),
  openFolderDialog: () => ipcRenderer.invoke(IPC_CHANNELS.openFolderDialog),
  openDatabaseFileDialog: () => ipcRenderer.invoke(IPC_CHANNELS.openDatabaseFileDialog),
  openAddonPackageDialog: () => ipcRenderer.invoke(IPC_CHANNELS.openAddonPackageDialog),
  saveFileDialog: (request) => ipcRenderer.invoke(IPC_CHANNELS.saveFileDialog, request),
  openExternalUrl: (url) => ipcRenderer.invoke(IPC_CHANNELS.openExternalUrl, url),
  setWindowTheme: (theme) => ipcRenderer.invoke(IPC_CHANNELS.setWindowTheme, theme),
  getWindowTheme: () => ipcRenderer.invoke(IPC_CHANNELS.getWindowTheme),
  toggleWindowFullscreen: () => ipcRenderer.invoke(IPC_CHANNELS.toggleWindowFullscreen),
  listenDeepLink: async (handler) => {
    if (typeof handler !== "function") {
      throw new Error("Invalid Electron deep-link listener request.");
    }

    const listener = (_event: Electron.IpcRendererEvent, message: ElectronEventMessage) => {
      if (message?.event === "deep-link-received") {
        handler(message as ElectronEventMessage<string>);
      }
    };
    ipcRenderer.on(IPC_CHANNELS.serverEvent, listener);

    try {
      const pendingMessages = (await ipcRenderer.invoke(
        IPC_CHANNELS.startDeepLinkListener,
      )) as ElectronEventMessage<string>[];
      for (const message of pendingMessages) {
        handler(message);
      }
    } catch (error) {
      ipcRenderer.removeListener(IPC_CHANNELS.serverEvent, listener);
      throw error;
    }

    return async () => {
      ipcRenderer.removeListener(IPC_CHANNELS.serverEvent, listener);
      await ipcRenderer.invoke(IPC_CHANNELS.stopDeepLinkListener);
    };
  },
  listen: async (eventName, handler) => {
    if (typeof eventName !== "string" || typeof handler !== "function") {
      throw new Error("Invalid Electron event listener request.");
    }

    const listener = (_event: Electron.IpcRendererEvent, message: ElectronEventMessage) => {
      if (message?.event === eventName) {
        handler(message as Parameters<typeof handler>[0]);
      }
    };
    ipcRenderer.on(IPC_CHANNELS.serverEvent, listener);

    return async () => {
      ipcRenderer.removeListener(IPC_CHANNELS.serverEvent, listener);
    };
  },
};

registerFileDropForwarders();
contextBridge.exposeInMainWorld(ELECTRON_API_KEY, api);
