/** RFC 4180 CSV parser: quoted fields, escaped quotes, embedded commas and newlines, CRLF. */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const endRow = (): void => {
    row.push(field);
    field = "";
    // Skip fully blank lines
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };

  while (i < src.length) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
      i++;
    } else if (ch === ",") {
      row.push(field);
      field = "";
      i++;
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      endRow();
      i++;
    } else {
      field += ch;
      i++;
    }
  }
  if (inQuotes) throw new Error("Unterminated quoted field in CSV");
  if (field !== "" || row.length > 0) endRow();
  return rows;
}
