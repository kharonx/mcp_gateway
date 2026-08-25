/**
 * Text extraction for common office attachment/document formats so the AI
 * client receives readable text instead of base64 where possible.
 * Supported: DOCX, XLSX, PPTX, PDF, TXT, CSV, JSON, HTML, VTT.
 * Everything else (incl. images) is returned as base64 with metadata.
 */

export interface ExtractedContent {
  kind: "text" | "base64";
  text?: string;
  base64?: string;
  contentType: string;
  fileName?: string;
  sizeBytes: number;
  truncated: boolean;
  note?: string;
}

const TEXT_TYPES = /^(text\/|application\/(json|xml|javascript|x-ndjson))/i;
const MAX_TEXT_CHARS = 500_000;

function ext(name: string | undefined): string {
  return (name ?? "").toLowerCase().split(".").pop() ?? "";
}

async function extractDocx(buf: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer: buf });
  return result.value;
}

async function extractXlsx(buf: Buffer): Promise<string> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "buffer" });
  const parts: string[] = [];
  for (const name of wb.SheetNames) {
    parts.push(`--- Sheet: ${name} ---`);
    parts.push(XLSX.utils.sheet_to_csv(wb.Sheets[name]));
  }
  return parts.join("\n");
}

async function extractPptx(buf: Buffer): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buf);
  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)?.[0] ?? 0) - Number(b.match(/\d+/)?.[0] ?? 0));
  const parts: string[] = [];
  for (const name of slideNames) {
    const xml = await zip.files[name].async("string");
    const texts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
    parts.push(`--- Slide ${name.match(/\d+/)?.[0]} ---`);
    parts.push(texts.join(" "));
  }
  return parts.join("\n");
}

async function extractPdf(buf: Buffer): Promise<string> {
  const mod = await import("pdf-parse/lib/pdf-parse.js");
  const pdfParse = (mod as unknown as { default: (b: Buffer) => Promise<{ text: string }> }).default;
  const result = await pdfParse(buf);
  return result.text;
}

export async function extractContent(
  buffer: Buffer,
  contentType: string,
  fileName?: string,
  fetchedTruncated = false
): Promise<ExtractedContent> {
  const e = ext(fileName);
  const base = {
    contentType,
    fileName,
    sizeBytes: buffer.length,
    truncated: fetchedTruncated,
  };
  try {
    let text: string | undefined;
    if (e === "docx" || contentType.includes("wordprocessingml")) text = await extractDocx(buffer);
    else if (e === "xlsx" || contentType.includes("spreadsheetml")) text = await extractXlsx(buffer);
    else if (e === "pptx" || contentType.includes("presentationml")) text = await extractPptx(buffer);
    else if (e === "pdf" || contentType.includes("application/pdf")) text = await extractPdf(buffer);
    else if (TEXT_TYPES.test(contentType) || ["txt", "csv", "md", "json", "html", "htm", "vtt", "log", "xml", "loop", "fluid", "pod"].includes(e)) {
      text = buffer.toString("utf8");
    }
    if (text !== undefined) {
      const truncatedText = text.length > MAX_TEXT_CHARS;
      return {
        ...base,
        kind: "text",
        text: truncatedText ? text.slice(0, MAX_TEXT_CHARS) : text,
        truncated: base.truncated || truncatedText,
        note: truncatedText ? `Text truncated to ${MAX_TEXT_CHARS} characters.` : undefined,
      };
    }
  } catch (err) {
    return {
      ...base,
      kind: "base64",
      base64: buffer.toString("base64"),
      note: `Text extraction failed (${err instanceof Error ? err.message : String(err)}); returning base64.`,
    };
  }
  return {
    ...base,
    kind: "base64",
    base64: buffer.toString("base64"),
    note: "Binary content returned as base64 (no text extractor for this type).",
  };
}
