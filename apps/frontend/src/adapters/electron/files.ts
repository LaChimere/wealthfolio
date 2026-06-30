import { getElectronApi } from "./core";

export interface OpenAddonPackageDialogResult {
  data: Uint8Array;
  fileName: string;
}

async function toSaveContent(
  fileContent: string | Blob | Uint8Array,
): Promise<string | Uint8Array> {
  if (typeof fileContent === "string" || fileContent instanceof Uint8Array) {
    return fileContent;
  }

  return new Uint8Array(await fileContent.arrayBuffer());
}

export const openCsvFileDialog = (): Promise<null | string | string[]> => {
  return getElectronApi().openCsvFileDialog();
};

export const openFolderDialog = (): Promise<string | null> => {
  return getElectronApi().openFolderDialog();
};

export const openDatabaseFileDialog = (): Promise<string | null> => {
  return getElectronApi().openDatabaseFileDialog();
};

export const openAddonPackageDialog = (): Promise<OpenAddonPackageDialogResult | null> => {
  return getElectronApi().openAddonPackageDialog();
};

export const openFileSaveDialog = async (
  fileContent: string | Blob | Uint8Array,
  fileName: string,
): Promise<boolean> => {
  const content = await toSaveContent(fileContent);
  return getElectronApi().saveFileDialog({ content, fileName });
};

export const openUrlInBrowser = (url: string): Promise<void> => {
  return getElectronApi().openExternalUrl(url);
};

export const saveAppDataFileViaPicker = (
  _relativePath: string,
  _fileName: string,
): Promise<boolean> => {
  return Promise.reject(new Error("Pending app data file exports are only supported on mobile"));
};
