// Web-specific activity commands
import type { ParseConfig, ParsedCsvResult } from "@/lib/types";
import { invoke, logger } from "./core";

/**
 * Parse a CSV file with the given configuration.
 * Web implementation: POSTs multipart form data to /api/v1/activities/import/parse.
 */
export const parseCsv = async (file: File, config: ParseConfig): Promise<ParsedCsvResult> => {
  try {
    const buffer = await file.arrayBuffer();
    const content = Array.from(new Uint8Array(buffer));
    return await invoke<ParsedCsvResult>("parse_csv", { content, config });
  } catch (err) {
    logger.error("Error parsing CSV file:", err);
    if (err instanceof Error && !err.message.startsWith("Failed to parse CSV:")) {
      throw new Error(`Failed to parse CSV: ${err.message}`);
    }
    throw err;
  }
};
