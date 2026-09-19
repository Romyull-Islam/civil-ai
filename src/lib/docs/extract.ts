/**
 * Server-side text extraction for documents users attach to a chat: soil reports, proposals, BOQs, rate schedules.
 * PDF (unpdf / pdf.js), Word .docx (mammoth), Excel .xlsx and CSV (exceljs), plain text. The text is sent to the AI
 * model with the user's question; numbers in it count as grounded (they came from the user).
 */

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
/** Characters kept per document (≈ 10k tokens). Every model call re-reads attached documents, so this bounds cost. */
export const MAX_DOC_CHARS = 40000;

export type DocKind = "pdf" | "docx" | "xlsx" | "csv" | "text";
export interface ExtractedDoc { name: string; kind: DocKind; text: string; chars: number; truncated: boolean; pages?: number; sheets?: string[]; warning?: string }

export function kindOf(name: string, mime = ""): DocKind | null {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf") || mime === "application/pdf") return "pdf";
  if (n.endsWith(".docx") || mime.includes("wordprocessingml")) return "docx";
  if (n.endsWith(".xlsx") || mime.includes("spreadsheetml")) return "xlsx";
  if (n.endsWith(".csv") || mime === "text/csv") return "csv";
  if (/\.(txt|md|json)$/.test(n) || mime.startsWith("text/")) return "text";
  return null;
}

const tidy = (s: string) => s.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();

function finish(name: string, kind: DocKind, raw: string, extra: Partial<ExtractedDoc> = {}): ExtractedDoc {
  const text = tidy(raw);
  const truncated = text.length > MAX_DOC_CHARS;
  return { name, kind, text: truncated ? text.slice(0, MAX_DOC_CHARS) + "\n…[document shortened: the rest was not sent]" : text, chars: text.length, truncated, ...extra };
}

export async function extractDocument(buf: Buffer, name: string, mime = ""): Promise<ExtractedDoc> {
  const kind = kindOf(name, mime);
  if (!kind) throw new Error("Unsupported file type. Attach PDF, Word (.docx), Excel (.xlsx), CSV or text files, or images.");
  if (buf.byteLength > MAX_UPLOAD_BYTES) throw new Error(`File is larger than ${MAX_UPLOAD_BYTES / 1048576} MB`);

  if (kind === "pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const pages = (text as string[]).map((t, i) => `--- page ${i + 1} ---\n${t}`).join("\n\n");
    const letters = (text as string[]).join("").replace(/\s/g, "").length;
    const warning = letters < 40 * Math.max(1, totalPages) ? "This PDF has little or no selectable text (probably scanned). Attach photos of the important pages instead so the AI can read them." : undefined;
    return finish(name, "pdf", pages, { pages: totalPages, warning });
  }
  if (kind === "docx") {
    const mammoth = (await import("mammoth")).default;
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return finish(name, "docx", value);
  }
  if (kind === "xlsx" || kind === "csv") {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    if (kind === "xlsx") await wb.xlsx.load(buf as unknown as ArrayBuffer);
    else { const { Readable } = await import("node:stream"); await wb.csv.read(Readable.from(buf.toString("utf8"))); }
    const parts: string[] = [];
    const sheets: string[] = [];
    wb.eachSheet((ws) => {
      sheets.push(ws.name);
      const rows: string[] = [];
      ws.eachRow({ includeEmpty: false }, (row) => {
        const vals = (row.values as unknown[]).slice(1).map((v) => cellText(v));
        while (vals.length && vals[vals.length - 1] === "") vals.pop();
        if (vals.length) rows.push(vals.join(" | "));
      });
      parts.push(`--- sheet: ${ws.name} (${rows.length} rows) ---\n${rows.join("\n")}`);
    });
    return finish(name, kind, parts.join("\n\n"), { sheets });
  }
  return finish(name, "text", buf.toString("utf8"));
}

/** Readable value of an exceljs cell: formulas show their cached result, rich text is flattened, dates as ISO. */
function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: string; hyperlink?: string; error?: string };
    if (o.richText) return o.richText.map((r) => r.text).join("");
    if ("result" in o) return cellText(o.result);
    if (o.text) return o.text;
    if (o.error) return o.error;
    return "";
  }
  return String(v).replace(/\s*\n\s*/g, " ");
}
