function unsupportedElectronNativeFeature(name: string): Error {
  return new Error(`${name} is not available until the Electron native bridge is connected.`);
}

export const openCsvFileDialog = (): Promise<null | string | string[]> => {
  return Promise.reject(unsupportedElectronNativeFeature("openCsvFileDialog"));
};

export const openFolderDialog = (): Promise<string | null> => {
  return Promise.reject(unsupportedElectronNativeFeature("openFolderDialog"));
};

export const openDatabaseFileDialog = (): Promise<string | null> => {
  return Promise.reject(unsupportedElectronNativeFeature("openDatabaseFileDialog"));
};

export const openFileSaveDialog = (
  _fileContent: string | Blob | Uint8Array,
  _fileName: string,
): Promise<boolean> => {
  return Promise.reject(unsupportedElectronNativeFeature("openFileSaveDialog"));
};

export const openUrlInBrowser = (url: string): Promise<void> => {
  window.open(url, "_blank", "noopener,noreferrer");
  return Promise.resolve();
};
