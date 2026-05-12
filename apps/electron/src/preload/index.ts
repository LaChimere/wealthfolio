import { contextBridge, ipcRenderer } from "electron";

import { ELECTRON_API_KEY, IPC_CHANNELS, type WealthfolioElectronApi } from "../shared/ipc";

const api: WealthfolioElectronApi = {
  getRuntimeInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getRuntimeInfo),
  invoke: (command, payload) => ipcRenderer.invoke(IPC_CHANNELS.invoke, { command, payload }),
};

contextBridge.exposeInMainWorld(ELECTRON_API_KEY, api);
