// File storage, SHA-256 fingerprints, versions and the audit log.

import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, readFileSync, rmSync, appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isoDateTime } from "../shared/format.js";
import type { IntegrityResult, Page, Version } from "../shared/types.js";
import { analyze, type Analysis } from "./ai.js";
import { UPLOAD_DIR, VAULT_DIR, all, get, run, scalar } from "./db.js";
import { extractPages, mimeFor } from "./extract.js";

export const now = () => isoDateTime();

export function log(action: string, detail = "", documentId: number | null = null, clientId: number | null = null,
                    actor = "Lawyer", matterId: number | null = null): number {
  if (documentId) {
    const doc = get<{ client_id: number | null; matter_id: number | null }>(
      "SELECT client_id, matter_id FROM documents WHERE id = ?", documentId);
    clientId ??= doc?.client_id ?? null;
    matterId ??= doc?.matter_id ?? null;
  }
  if (matterId && !clientId) {
    clientId = get<{ client_id: number | null }>("SELECT client_id FROM matters WHERE id = ?", matterId)?.client_id ?? null;
  }
  return run("INSERT INTO audit (ts, action, detail, document_id, client_id, actor, matter_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    now(), action, detail, documentId, clientId, actor, matterId);
}

/** Who wrote the summary, and why Groq didn't if it failed. */
export const summarizedBy = (a: Analysis) => (a.source === "groq" ? "Groq" : a.error ? `local reader. ${a.error}` : "local reader");

export const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

/** Write the working copy and a read-only locked copy. */
export function saveBlob(data: Buffer, filename: string): { digest: string; stored: string } {
  const digest = sha256(data);
  const stored = digest + path.extname(filename.toLowerCase());
  writeFileSync(path.join(UPLOAD_DIR, stored), data);
  const locked = path.join(VAULT_DIR, stored);
  if (!existsSync(locked)) {
    writeFileSync(locked, data);
    chmodSync(locked, 0o444);
  }
  return { digest, stored };
}

interface IngestOptions {
  title: string;
  clientId?: number | null;
  matterId?: number | null;
  caseNumber?: string;
  docType?: string;
  documentId?: number;
  analysis?: Analysis;
  actor?: string;
}

/**
 * Store a file, read it, summarize it and record everything.
 * With `documentId` the file becomes a new version of that document. Returns the document id.
 */
export async function ingest(data: Buffer, filename: string, opts: IngestOptions): Promise<number> {
  // Slow work (reading, AI) happens before any database write
  const { digest, stored } = saveBlob(data, filename);
  const { pages, note } = await extractPages(data, filename);
  const analysis = opts.analysis ?? (await analyze(pages));
  const ts = now();
  const fields = {
    summary: analysis.summary,
    key_points: JSON.stringify(analysis.key_points),
    ai_source: analysis.source,
    parties: analysis.parties,
    note,
    hearing_date: analysis.hearing_date,
    hearing_page: analysis.hearing_page,
    hearing_confirmed: 0,
    reminder_sent: 0,
    status: "Awaiting review",
    updated_at: ts,
  };

  let documentId = opts.documentId;
  let version = 1;
  if (documentId === undefined) {
    const row = {
      ...fields,
      title: opts.title,
      client_id: opts.clientId ?? null,
      matter_id: opts.matterId ?? null,
      case_number: opts.caseNumber || analysis.case_number,
      doc_type: opts.docType || analysis.doc_type || "Other",
      created_at: ts,
    };
    const cols = Object.keys(row);
    documentId = run(`INSERT INTO documents (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
      ...Object.values(row));
  } else {
    run(`UPDATE documents SET ${Object.keys(fields).map((k) => `${k} = ?`).join(", ")} WHERE id = ?`,
      ...Object.values(fields), documentId);
    version = scalar("SELECT COALESCE(MAX(version), 0) + 1 FROM versions WHERE document_id = ?", documentId);
  }
  run(`INSERT INTO versions (document_id, version, filename, stored_name, mime, size, sha256, pages, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    documentId, version, filename, stored, mimeFor(filename), data.length, digest, JSON.stringify(pages), ts);

  log(version === 1 ? "Uploaded" : "New version", `${filename} · v${version} · SHA-256 ${digest.slice(0, 12)}…`,
    documentId, opts.clientId ?? null, opts.actor ?? "Lawyer");
  log("AI summary", `Summarized by ${summarizedBy(analysis)}`, documentId, null, "Automation");
  if (fields.hearing_date) {
    log("Hearing date found", `${fields.hearing_date} on page ${fields.hearing_page ?? "?"} · waiting for lawyer to confirm`,
      documentId, null, "Automation");
  }
  return documentId;
}

export const latestVersion = (documentId: number) =>
  get<Version & { pages: string }>("SELECT * FROM versions WHERE document_id = ? ORDER BY version DESC LIMIT 1", documentId);

export const pagesOf = (v?: { pages: string }): Page[] => (v ? (JSON.parse(v.pages) as Page[]) : []);

function fileHash(file: string): string | null {
  return existsSync(file) ? sha256(readFileSync(file)) : null;
}

/** Re-hash every stored version. */
export function verify(documentId: number): IntegrityResult[] {
  return all<Version>("SELECT * FROM versions WHERE document_id = ? ORDER BY version", documentId).map((v) => {
    const actual = fileHash(path.join(UPLOAD_DIR, v.stored_name));
    return { version: v.version, expected: v.sha256, actual, ok: actual === v.sha256, stored_name: v.stored_name };
  });
}

/** Demo only: overwrite the working copy, the way an attacker or bad script would. */
export function tamper(storedName: string) {
  appendFileSync(path.join(UPLOAD_DIR, storedName), "\n[altered by an unauthorised script]\n");
}

/** Copy the locked version back over the working copy. */
export function restore(storedName: string): boolean {
  const src = path.join(VAULT_DIR, storedName);
  if (!existsSync(src)) return false;
  const dst = path.join(UPLOAD_DIR, storedName);
  rmSync(dst, { force: true });
  copyFileSync(src, dst);
  chmodSync(dst, 0o644);
  return true;
}
