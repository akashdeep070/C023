// Groq-backed AI helpers with a tiny local fallback.
//
// Everything here is deliberately cheap: a small, fast Groq model, short
// prompts built from only the most relevant pages, and capped output tokens.
// When no GROQ_API_KEY is set (or Groq is unreachable) the local fallback
// keeps the demo working with simple keyword and date matching.

import { isValidIsoDate, isoDate, isoDateTime } from "../shared/format.js";
import type { AiHealth, Page } from "../shared/types.js";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
// Vercel stops the function after 30 s (vercel.json), so give up on Groq well before that
// and let the local reader answer instead
const TIMEOUT_MS = 20_000;

export const DOC_TYPES = ["Order", "Judgment", "Petition", "Evidence", "Contract",
  "Notice", "Identity", "Affidavit", "Other"];

/** The key as pasted into .env or the Vercel dashboard, without stray spaces or quotes. */
const apiKey = () => (process.env.GROQ_API_KEY ?? "").trim().replace(/^["']+|["']+$/g, "");

export const enabled = () => apiKey().length > 0;
export const textModel = () => process.env.GROQ_MODEL || "llama-3.1-8b-instant";
export const visionModel = () => process.env.GROQ_VISION_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct";

type Message = { role: "system" | "user"; content: string | unknown[] };

/** A Groq failure, worded as what to do about it. */
class GroqError extends Error {}

let last: AiHealth | null = null;
/** How the latest Groq call on this instance went, or null before the first one. */
export const health = () => last;

function explain(status: number, body: string, model: string): string {
  let code = "";
  let message = body;
  try {
    const e = (JSON.parse(body) as { error?: { code?: string; message?: string } }).error;
    code = e?.code ?? "";
    message = e?.message ?? body;
  } catch { /* not JSON */ }
  const setting = model === visionModel() ? "GROQ_VISION_MODEL" : "GROQ_MODEL";
  if (status === 401 || code === "invalid_api_key") return "Groq rejected the API key. Check GROQ_API_KEY, then redeploy.";
  if (status === 404 || code === "model_not_found" || code === "model_decommissioned") {
    return `Groq does not offer the model ${model}. Set ${setting} to a current model.`;
  }
  if (status === 429) return "Groq's rate limit was reached. Wait a minute and try again.";
  if (status === 413) return "The request was too large for Groq.";
  if (status >= 500) return `Groq had a server error (${status}). Try again shortly.`;
  return `Groq returned ${status}: ${message.slice(0, 160)}`;
}

async function chat(messages: Message[], opts: { model?: string; json?: boolean; maxTokens?: number } = {}) {
  const model = opts.model ?? textModel();
  const t0 = performance.now();
  const done = (error = "") => { last = { ok: !error, at: isoDateTime(), ms: Math.round(performance.now() - t0), model, error }; };
  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.2,
        max_tokens: opts.maxTokens ?? 400,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch((err: Error) => {
      throw new GroqError(err.name === "TimeoutError"
        ? `Groq did not answer within ${TIMEOUT_MS / 1000} seconds.`
        : `Could not reach api.groq.com (${(err.cause as Error | undefined)?.message ?? err.message}).`);
    });
    if (!res.ok) throw new GroqError(explain(res.status, await res.text(), model));
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new GroqError("Groq sent back an empty answer.");
    done();
    return content;
  } catch (err) {
    done(err instanceof GroqError ? err.message : String(err));
    throw err;
  }
}

/** One tiny request that proves the key and the model work. */
export async function check(): Promise<AiHealth | null> {
  if (!enabled()) return null;
  await chat([{ role: "user", content: "Reply with OK." }], { maxTokens: 1 }).catch(() => {});
  return last;
}

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 200);

/** Join pages with [Page n] markers, stopping at `limit` characters. */
function paged(pages: Page[], limit: number): string {
  const out: string[] = [];
  let used = 0;
  for (const [num, text] of pages) {
    let chunk = `[Page ${num}]\n${text.trim()}\n`;
    if (used + chunk.length > limit) chunk = chunk.slice(0, Math.max(0, limit - used));
    out.push(chunk);
    used += chunk.length;
    if (used >= limit) break;
  }
  return out.join("\n");
}

// ---------------------------------------------------------------- dates

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MON = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DATE_PATTERNS: [RegExp, "dmy" | "mdy" | "iso" | "num"][] = [
  [new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MON},?\\s+(\\d{4})\\b`, "gi"), "dmy"],
  [new RegExp(`\\b${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "gi"), "mdy"],
  [/\b(\d{4})-(\d{2})-(\d{2})\b/g, "iso"],
  [/\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/g, "num"],
];
const HEARING_CUE = /(next\s+(?:date|hearing)|hearing|listed|list(?:ed)?\s+(?:on|for)|adjourned|posted\s+(?:to|for)|returnable)/gi;

function makeDate(y: number, m: number, d: number): string | null {
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return isValidIsoDate(iso) ? iso : null;
}

function findDates(text: string): { pos: number; date: string }[] {
  const found: { pos: number; date: string }[] = [];
  for (const [rx, kind] of DATE_PATTERNS) {
    for (const m of text.matchAll(rx)) {
      let date: string | null = null;
      if (kind === "dmy") date = makeDate(+m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], +m[1]);
      else if (kind === "mdy") date = makeDate(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]);
      else if (kind === "iso") date = makeDate(+m[1], +m[2], +m[3]);
      else date = makeDate(+m[3], +m[2], +m[1]); // dd/mm/yyyy, the usual Indian court format
      if (date) found.push({ pos: m.index ?? 0, date });
    }
  }
  return found.sort((a, b) => a.pos - b.pos);
}

/** The latest date that follows a hearing cue, with its page. */
export function findHearing(pages: Page[]): { date: string; page: number | null } {
  let best: { date: string; page: number } | null = null;
  for (const [num, text] of pages) {
    for (const cue of text.matchAll(HEARING_CUE)) {
      const end = (cue.index ?? 0) + cue[0].length;
      const first = findDates(text.slice(end, end + 160))[0];
      if (first && (!best || first.date > best.date)) best = { date: first.date, page: num };
    }
  }
  return best ?? { date: "", page: null };
}

// ---------------------------------------------------------------- local fallback

const STOP = new Set(`a an and are as at be by for from has have in is it its of on or that the this to was were will with
what when where which who why how did does do any all can i we you they he she his her their our there been into
about not no yes`.split(/\s+/));

const words = (text: string) => (text.toLowerCase().match(/[a-z0-9₹]+/g) ?? []).filter((w) => !STOP.has(w) && w.length > 1);

const SPLIT = /(?<!\bRs\.)(?<!\bNo\.)(?<!\bMr\.)(?<!\bMs\.)(?<!\bDr\.)(?<!\bAdv\.)(?<!\bvs\.)(?<!\bPvt\.)(?<!\b[A-Z]\.)(?<=[.!?])\s+(?!No\.|Ltd\b)(?=[A-Z0-9"“(])/;

function isHeading(line: string): boolean {
  const letters = [...line].filter((c) => /[a-z]/i.test(c));
  const shouty = letters.length > 0 && letters.filter((c) => c === c.toUpperCase()).length / letters.length > 0.6;
  return shouty || (line.split(/\s+/).length < 8 && !/[.:;,]$/.test(line));
}

function sentences(text: string, bodyOnly = false): string[] {
  if (bodyOnly) text = text.split("\n").filter((l) => !isHeading(l.trim())).join("\n");
  return text.replace(/\s+/g, " ").trim().split(SPLIT).map((s) => s.trim()).filter((s) => s.length > 20);
}

const KEY = /\b(order(?:ed)?|grant(?:ed)?|direct(?:ed|s)?|bail|dismiss(?:ed)?|allow(?:ed)?|adjourn(?:ed)?|hearing|bond|rs\.?|compensation|injunction|deadline|due)\b|₹/i;
const CASE_NO = /\b((?:[A-Z][A-Za-z.()]*[ ]){0,3}(?:No\.[ ]*)?\d{1,6}[ ]*(?:\/|[ ]+of[ ]+)[ ]*\d{4})\b/;
const TYPE_HINTS: [string, RegExp][] = [["Judgment", /\bjudgment\b/i], ["Order", /\border\b|\bbail is granted\b/i],
  ["Notice", /\bnotice\b/i], ["Petition", /\bplaint\b|\bpetition\b/i], ["Contract", /\bagreement\b|\bcontract\b/i],
  ["Affidavit", /\baffidavit\b/i], ["Identity", /\baadhaar\b|\bpassport no\b|\bidentity\b/i]];
const ROLE = /\s*(?:\.{2,}|…)?\s*(?:applicant|plaintiff|petitioner|appellant|respondent|defendant|accused)s?\s*$/i;

function findParties(text: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 40);
  for (let i = 0; i < lines.length; i++) {
    if (/^(?:versus|vs\.?|v\.)$/i.test(lines[i]) && i > 0 && i < lines.length - 1) {
      return `${lines[i - 1].replace(ROLE, "")} vs ${lines[i + 1].replace(ROLE, "")}`;
    }
    const m = lines[i].match(/^(.{3,60}?)\s+(?:versus|vs\.?|v\.)\s+(.{3,60})$/i);
    if (m) return `${m[1].replace(ROLE, "")} vs ${m[2].replace(ROLE, "")}`;
  }
  return "";
}

export interface Analysis {
  summary: string;
  key_points: string[];
  doc_type: string;
  parties: string;
  case_number: string;
  hearing_date: string;
  hearing_page: number | null;
  source: "groq" | "local";
  error?: string;
}

function localAnalyze(pages: Page[]): Analysis {
  const full = pages.map(([, t]) => t).join("\n");
  const sents = sentences(full, true).length ? sentences(full, true) : sentences(full);
  const keyed = sents.slice(1).filter((s) => KEY.test(s));
  const picked = keyed.length ? [...sents.slice(0, 1), ...keyed.slice(0, 2)] : sents.slice(0, 3);
  const { date, page } = findHearing(pages);
  return {
    summary: picked.join(" ").slice(0, 520) || "No readable text was found in this file.",
    key_points: keyed.filter((s) => !picked.includes(s)).slice(0, 3).map((s) => s.slice(0, 180)),
    doc_type: TYPE_HINTS.find(([, rx]) => rx.test(full.slice(0, 3000)))?.[0] ?? "",
    parties: findParties(full),
    case_number: full.match(CASE_NO)?.[1].trim() ?? "",
    hearing_date: date,
    hearing_page: page,
    source: "local",
  };
}

function localAnswer(question: string, pages: Page[]): { answer: string; page: number | null } {
  const q = new Set(words(question));
  let best = { score: 0, text: "", page: null as number | null };
  for (const [num, text] of pages) {
    for (const s of sentences(text)) {
      const score = words(s).filter((w, i, arr) => q.has(w) && arr.indexOf(w) === i).length;
      if (score > best.score) best = { score, text: s, page: num };
    }
  }
  return best.text ? { answer: best.text, page: best.page } : { answer: "I could not find that in this file.", page: null };
}

function topPages(question: string, pages: Page[], k = 3): Page[] {
  const q = new Set(words(question));
  const score = (t: string) => new Set(words(t).filter((w) => q.has(w))).size;
  const keep = new Set([...pages].sort((a, b) => score(b[1]) - score(a[1])).slice(0, k).map(([n]) => n));
  return pages.filter(([n]) => keep.has(n));
}

// ---------------------------------------------------------------- public API

const analyzePrompt = () => `You read legal documents for a small Indian law practice.
Reply with JSON only, using exactly these keys:
{"summary": "3 short sentences in plain English: the facts, what was ordered or asked, and the next step",
 "key_points": ["up to 4 short points, each under 20 words"],
 "doc_type": "one of: ${DOC_TYPES.join(", ")}",
 "parties": "who is involved, e.g. 'State vs R. Sharma'",
 "case_number": "the case number exactly as written, or empty string",
 "hearing_date": "the NEXT hearing or listing date as YYYY-MM-DD, or empty string",
 "hearing_page": page number where that date appears, or null}
Only use facts in the document. Never invent dates. Today is ${isoDate()}.`;

/** Summarize a document and pull out its next hearing date. */
export async function analyze(pages: Page[]): Promise<Analysis> {
  const local = localAnalyze(pages);
  if (!enabled() || !pages.some(([, t]) => t.trim())) return local;
  try {
    const raw = await chat(
      [{ role: "system", content: analyzePrompt() }, { role: "user", content: paged(pages, 9000) }],
      { json: true, maxTokens: 450 },
    );
    const data = JSON.parse(raw) as Record<string, unknown>;
    const out: Analysis = {
      summary: String(data.summary || local.summary).trim(),
      key_points: (Array.isArray(data.key_points) ? data.key_points : []).slice(0, 4).map((k) => String(k).trim()),
      doc_type: DOC_TYPES.includes(String(data.doc_type)) ? String(data.doc_type) : "",
      parties: String(data.parties || "").trim(),
      case_number: String(data.case_number || "").trim(),
      hearing_date: isValidIsoDate(data.hearing_date) ? data.hearing_date : "",
      hearing_page: Number.isInteger(data.hearing_page) ? (data.hearing_page as number) : null,
      source: "groq",
    };
    if (!out.hearing_date && local.hearing_date) {
      out.hearing_date = local.hearing_date;
      out.hearing_page = local.hearing_page;
    }
    return out;
  } catch (err) {
    return { ...local, error: reason(err) }; // network, key, quota, bad JSON: fall back to the local reader
  }
}

const ASK_PROMPT = `Answer the lawyer's question using ONLY the pages below.
Reply with JSON only: {"answer": "one or two sentences", "page": page number the answer came from, or null}.
If the pages do not contain the answer, say "Not found in this file." and use null for page.`;

export async function ask(question: string, pages: Page[]) {
  const context = topPages(question, pages);
  if (enabled() && context.some(([, t]) => t.trim())) {
    try {
      const raw = await chat(
        [{ role: "system", content: ASK_PROMPT },
         { role: "user", content: `${paged(context, 6000)}\n\nQuestion: ${question}` }],
        { json: true, maxTokens: 200 },
      );
      const data = JSON.parse(raw) as { answer?: unknown; page?: unknown };
      return {
        answer: String(data.answer || "Not found in this file.").trim(),
        page: Number.isInteger(data.page) ? (data.page as number) : null,
        source: "groq" as const,
      };
    } catch (err) {
      return { ...localAnswer(question, pages), source: "local" as const, error: reason(err) };
    }
  }
  return { ...localAnswer(question, pages), source: "local" as const };
}

/** Transcribe text from a photo or scan with Groq's vision model. */
export async function readImage(data: Buffer, mime: string): Promise<{ text: string; note: string }> {
  if (!enabled()) return { text: "", note: "Add a GROQ_API_KEY to read text from photos and scans." };
  if (data.length > 4 * 1024 * 1024) return { text: "", note: "Images over 4 MB can't be read by the AI. Try a smaller photo." };
  try {
    const text = await chat([{
      role: "user",
      content: [
        { type: "text", text: "Transcribe all text in this document image exactly. Output only the text." },
        { type: "image_url", image_url: { url: `data:${mime};base64,${data.toString("base64")}` } },
      ],
    }], { model: visionModel(), maxTokens: 1500 });
    return { text: text.trim(), note: "" };
  } catch (err) {
    return { text: "", note: `The AI could not read this image. ${reason(err)}` };
  }
}
