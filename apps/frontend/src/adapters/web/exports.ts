import type { ExportDataType, ExportedFileFormat } from "@/lib/types";
import type { DataExportResult } from "../types";
import { invoke } from "./core";

type DataExportFileFormat = Exclude<ExportedFileFormat, "SQLite">;

const fallbackFileName = (data: ExportDataType, format: DataExportFileFormat): string => {
  const currentDate = new Date().toISOString().split("T")[0];
  return `${data}_${currentDate}.${format.toLowerCase()}`;
};

type WebExportContent = { status: "content"; filename?: string; data: number[] };
type WebExportEmpty = { status: "empty" };

const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const exportDataFile = async (
  format: DataExportFileFormat,
  data: ExportDataType,
): Promise<DataExportResult> => {
  const result = await invoke<WebExportContent | WebExportEmpty>("export_data_file", {
    format,
    data,
  });
  if (result.status === "empty") {
    return { status: "empty" };
  }

  const filename = result.filename ?? fallbackFileName(data, format);
  const blob = new Blob([new Uint8Array(result.data)]);
  downloadBlob(blob, filename);

  return { status: "saved", filename };
};
