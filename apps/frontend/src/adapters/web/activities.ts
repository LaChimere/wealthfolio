// Web-specific activity commands
import type { ParseConfig, ParsedCsvResult } from "@/lib/types";
import { invoke, logger } from "./core";

/**
 * Parse a CSV file with the given configuration.
 * Web implementation: routes through the shared parse_csv command.
 */
export const parseCsv = async (file: File, config: ParseConfig): Promise<ParsedCsvResult> => {
  try {
    return await invoke<ParsedCsvResult>("parse_csv", { file, config });
  } catch (err) {
    logger.error("Error parsing CSV file:", err);
    if (err instanceof Error && !err.message.startsWith("Failed to parse CSV:")) {
      throw new Error(`Failed to parse CSV: ${err.message}`);
    }
    throw err;
  }
};
