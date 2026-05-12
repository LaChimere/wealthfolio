import type { ParseConfig, ParsedCsvResult } from "@/lib/types";

import { invoke, logger } from "./core";

export const parseCsv = async (file: File, config: ParseConfig): Promise<ParsedCsvResult> => {
  try {
    const buffer = await file.arrayBuffer();
    const content = Array.from(new Uint8Array(buffer));
    return await invoke<ParsedCsvResult>("parse_csv", { content, config });
  } catch (error) {
    logger.error("Error parsing CSV file:", error);
    throw error;
  }
};
