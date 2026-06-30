import type { ExportDataType, ExportedFileFormat } from "@/lib/types";
import type { DataExportResult } from "../types";
import { invoke } from "./core";
import { openFileSaveDialog } from "./files";

type DataExportFileFormat = Exclude<ExportedFileFormat, "SQLite">;

interface ElectronExportContent {
  status: "content";
  filename: string;
  data: number[];
}

interface ElectronExportEmpty {
  status: "empty";
}

export const exportDataFile = async (
  format: DataExportFileFormat,
  data: ExportDataType,
): Promise<DataExportResult> => {
  const result = await invoke<ElectronExportContent | ElectronExportEmpty>("export_data_file", {
    format,
    data,
  });
  if (result.status === "empty") {
    return { status: "empty" };
  }
  const saved = await openFileSaveDialog(new Uint8Array(result.data), result.filename);
  return saved ? { status: "saved", filename: result.filename } : { status: "canceled" };
};
