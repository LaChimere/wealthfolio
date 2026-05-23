import type { ExportDataType, ExportedFileFormat } from "@/lib/types";
import type { DataExportResult } from "../types";

export const exportDataFile = async (
  _format: Exclude<ExportedFileFormat, "SQLite">,
  _data: ExportDataType,
): Promise<DataExportResult> => {
  throw new Error("Data file export is not available in the Electron adapter yet");
};
