// Turn an uploaded file into a list of [page_number, text].

import path from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import type { Page } from "../shared/types.js";
import { readImage } from "./ai.js";

const ALLOWED: Record<string, string> = {
  ".pdf": "application/pdf", ".txt": "text/plain", ".md": "text/plain",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
};
const MAX_PDF_PAGES = 60; // keeps extraction cheap on a t3.micro
const PAGE_CHARS = 2500;

const ext = (filename: string) => path.extname(filename.toLowerCase());
export const allowed = (filename: string) => ext(filename) in ALLOWED;
export const mimeFor = (filename: string) => ALLOWED[ext(filename)] ?? "application/octet-stream";

/** Split long plain text into ~2,500 character "pages" at paragraph breaks. */
function chunk(text: string): string[] {
  const pages: string[] = [];
  let cur = "";
  for (const para of text.split("\n\n")) {
    if (cur && cur.length + para.length > PAGE_CHARS) {
      pages.push(cur);
      cur = "";
    }
    cur += para + "\n\n";
  }
  if (cur.trim()) pages.push(cur);
  return pages.length ? pages : [""];
}

/** Returns the pages plus a note explaining anything the user should know. */
export async function extractPages(data: Buffer, filename: string, groqKey?: string): Promise<{ pages: Page[]; note: string }> {
  const e = ext(filename);
  if (e === ".pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(data));
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const pages: Page[] = text.slice(0, MAX_PDF_PAGES).map((t, i) => [i + 1, t.trim()]);
    let note = totalPages > MAX_PDF_PAGES ? `Only the first ${MAX_PDF_PAGES} pages were read.` : "";
    if (!pages.some(([, t]) => t)) note = "This PDF has no text layer (it is a scan). Upload the pages as photos to read them with AI.";
    return { pages, note };
  }
  if (e === ".txt" || e === ".md") {
    const text = data.toString("utf8").replace(/\r\n/g, "\n");
    const parts = text.includes("\f") ? text.split("\f") : chunk(text);
    return { pages: parts.map((p, i) => [i + 1, p.trim()]), note: "" };
  }
  const { text, note } = await readImage(data, ALLOWED[e], groqKey);
  return { pages: [[1, text]], note };
}
