import { contextBridge, ipcRenderer } from "electron";

import {
  ELECTRON_API_KEY,
  IPC_CHANNELS,
  type ElectronEventMessage,
  type WealthfolioElectronApi,
} from "../shared/ipc";

const api: WealthfolioElectronApi = {
  getRuntimeInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getRuntimeInfo),
  invoke: (command, payload) => ipcRenderer.invoke(IPC_CHANNELS.invoke, { command, payload }),
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

contextBridge.exposeInMainWorld(ELECTRON_API_KEY, api);
