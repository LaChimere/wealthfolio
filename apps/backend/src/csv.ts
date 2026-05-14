export function parseCsvRecords(body: string, options: { delimiter?: "," | ";" } = {}): string[][] {
  if (options.delimiter) {
    return tryParseCsv(body, options.delimiter);
  }
  const commaRecords = tryParseCsv(body, ",");
  if (commaRecords[0] && commaRecords[0].length > 1) {
    return commaRecords;
  }
  return tryParseCsv(body, ";");
}

function tryParseCsv(body: string, delimiter: "," | ";"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === '"') {
      if (inQuotes && body[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === delimiter && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && body[index + 1] === "\n") {
        index += 1;
      }
      row.push(field);
      pushCsvRow(rows, row);
      row = [];
      field = "";
      continue;
    }
    field += char;
  }

  row.push(field);
  pushCsvRow(rows, row);
  return rows;
}

function pushCsvRow(rows: string[][], row: string[]): void {
  if (row.length === 1 && row[0] === "") {
    return;
  }
  rows.push(row);
}
