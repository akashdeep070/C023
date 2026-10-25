// Helpers for the document editor: keep saved and pasted HTML to a small set of
// tags, and export a draft as a Word file or plain text.

const KEEP = new Set(["P", "H1", "H2", "H3", "B", "STRONG", "I", "EM", "U", "S", "STRIKE", "SUB", "SUP", "BR", "HR", "UL", "OL", "LI",
  "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "MARK", "SPAN", "BLOCKQUOTE", "DIV", "A"]);
// Dropped with everything inside them. Any other tag is unwrapped and its text kept.
const DROP = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "TEMPLATE", "HEAD", "TITLE", "META", "LINK", "NOSCRIPT",
  "SVG", "MATH", "IMG", "VIDEO", "AUDIO", "CANVAS", "FORM", "INPUT", "BUTTON", "SELECT", "TEXTAREA"]);
const STYLES = ["text-align", "margin-left", "font-weight", "font-style", "text-decoration"];
const CLASSES = new Set(["blank", "page-break"]);

function copyAttributes(from: Element, to: HTMLElement) {
  const style = (from as HTMLElement).style;
  const kept = style ? STYLES.map((prop) => [prop, style.getPropertyValue(prop)]).filter(([, v]) => v && !/url|expression/i.test(v)) : [];
  if (kept.length) to.setAttribute("style", kept.map(([k, v]) => `${k}: ${v};`).join(" "));
  const cls = [...from.classList].filter((c) => CLASSES.has(c));
  if (cls.length) to.className = cls.join(" ");
  const key = from.getAttribute("data-key");
  if (key && /^[a-z_]+$/.test(key)) to.setAttribute("data-key", key);
  for (const span of ["colspan", "rowspan"]) {
    const n = from.getAttribute(span);
    if (n && /^\d{1,2}$/.test(n)) to.setAttribute(span, n);
  }
  const href = from.getAttribute("href");
  if (from.tagName === "A" && href && /^(https?:|mailto:)/i.test(href)) to.setAttribute("href", href);
}

function copyChildren(from: Node, to: Node, doc: Document) {
  for (const child of Array.from(from.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      to.appendChild(doc.createTextNode(child.textContent ?? ""));
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as Element;
    const tag = el.tagName.toUpperCase();
    if (DROP.has(tag)) continue;
    if (!KEEP.has(tag)) {
      copyChildren(el, to, doc);
      continue;
    }
    const copy = doc.createElement(tag.toLowerCase());
    copyAttributes(el, copy);
    to.appendChild(copy);
    copyChildren(el, copy, doc);
  }
}

/** Parse in an inert document (nothing runs or loads) and rebuild only what the editor allows. */
export function cleanHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, "text/html");
  const out = doc.createElement("div");
  copyChildren(doc.body, out, doc);
  return out.innerHTML;
}

const escapeText = (s: string) => s.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch]!);

export const fileName = (title: string, ext: string) => `${title.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80) || "Untitled"}.${ext}`;

/** Word opens an HTML file saved as .doc, keeping headings, tables and alignment. */
export function wordFile(title: string, html: string): Blob {
  const body = html
    .replace(/<mark class="blank"[^>]*>/g, '<span style="background: #ffe0a3;">')
    .replace(/<\/mark>/g, "</span>")
    .replace(/<hr class="page-break">/g, '<br clear="all" style="page-break-before: always;">');
  const doc = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${escapeText(title)}</title>
<style>
@page { size: 21cm 29.7cm; margin: 2.54cm; }
body { font-family: "Times New Roman", serif; font-size: 12pt; line-height: 1.5; }
h1 { font-size: 18pt; } h2 { font-size: 14pt; } h3 { font-size: 12pt; }
table { border-collapse: collapse; width: 100%; }
td, th { border: 1px solid #000; padding: 4px 6px; font-size: 9pt; vertical-align: top; }
</style></head><body>${body}</body></html>`;
  return new Blob(["﻿", doc], { type: "application/msword" });
}

export function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
