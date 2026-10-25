// The document editor's storage: drafts started from a template and saved as HTML.

import type { Router } from "express";
import { isoDate } from "../shared/format.js";
import { countBlanks, countWords, render, templateById, type TemplateContext } from "../shared/templates.js";
import type { Client, Draft, DraftDetail, DraftRow, DraftWithMatter } from "../shared/types.js";
import { all, get, run } from "./db.js";
import { getMatter, hearings } from "./diary.js";
import { HttpError, id, str } from "./http.js";
import * as vault from "./vault.js";

const MAX_HTML = 900_000; // stays under the 1 MB JSON body limit

const rowSql = (withHtml = false) => `
  SELECT d.id, d.title, d.template_id, d.matter_id, d.words, d.blanks, d.created_at, d.updated_at,${withHtml ? " d.html," : ""}
         m.case_number, m.title AS matter_title, c.name AS client_name
  FROM drafts d LEFT JOIN matters m ON m.id = d.matter_id LEFT JOIN clients c ON c.id = m.client_id`;

function getDraft(draftId: number): Draft {
  const d = get<Draft>("SELECT * FROM drafts WHERE id = ?", draftId);
  if (!d) throw new HttpError(404, "That draft doesn't exist.");
  return d;
}

/** The matter, client and hearings a template needs to fill its blanks. */
function matterContext(matterId: number | null): TemplateContext {
  const today = isoDate();
  if (!matterId) return { matter: null, client: null, last: null, next: null, today };
  const matter = getMatter(matterId);
  return {
    matter,
    client: matter.client_id ? get<Client>("SELECT * FROM clients WHERE id = ?", matter.client_id) ?? null : null,
    next: hearings("WHERE h.matter_id = ? AND h.date >= ? ORDER BY h.date LIMIT 1", matterId, today)[0] ?? null,
    last: hearings("WHERE h.matter_id = ? AND h.date < ? AND h.outcome != '' ORDER BY h.date DESC LIMIT 1", matterId, today)[0] ?? null,
    today,
  };
}

export function createDraft(templateId: string, matterId: number | null = null): number {
  const t = templateById(templateId);
  if (!t) throw new HttpError(400, "Pick a template.");
  const ctx = matterContext(matterId);
  const html = render(t, ctx);
  const ref = ctx.matter ? ctx.matter.case_number || ctx.client?.name || ctx.matter.title : "";
  const title = t.id === "blank" ? "Untitled document" : ref ? `${t.name}, ${ref}` : t.name;
  const ts = vault.now();
  const draftId = run(`INSERT INTO drafts (title, html, template_id, matter_id, words, blanks, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, title, html, t.id, matterId, countWords(html), countBlanks(html), ts, ts);
  vault.log("Draft created", title, null, null, "Lawyer", matterId);
  return draftId;
}

const matterId = (v: unknown): number | null => {
  const n = Number(v);
  if (!v || !Number.isInteger(n)) return null;
  getMatter(n); // 404s if it doesn't exist
  return n;
};

export function registerDrafts(api: Router) {
  api.get("/drafts", (req, res) => {
    const q = str(req.query.q);
    const where: string[] = [];
    const args: (string | number)[] = [];
    const matter = Number(req.query.matter);
    if (Number.isInteger(matter) && matter > 0) { where.push("d.matter_id = ?"); args.push(matter); }
    if (q) {
      where.push("(d.title LIKE ? OR m.case_number LIKE ? OR m.title LIKE ? OR c.name LIKE ?)");
      args.push(...Array(4).fill(`%${q}%`));
    }
    const rows = all<DraftRow>(`${rowSql()} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY d.updated_at DESC`, ...args);
    res.json(rows);
  });

  // Returns the filled-in draft too, so a browser that keeps its own drafts (on Vercel) can store it
  api.post("/drafts", (req, res) => {
    const draftId = createDraft(str(req.body?.template_id) || "blank", matterId(req.body?.matter_id));
    const draft = get<DraftWithMatter>(`${rowSql(true)} WHERE d.id = ?`, draftId)!;
    res.json({ id: draftId, draft });
  });

  api.get("/drafts/:id", (req, res) => {
    const draft = getDraft(id(req));
    const { matter, client, last, next } = matterContext(draft.matter_id);
    const matters = all<{ id: number; case_number: string; title: string }>(
      "SELECT id, case_number, title FROM matters ORDER BY status = 'Disposed', id DESC")
      .map((m) => ({ id: m.id, label: m.case_number ? `${m.case_number} · ${m.title}` : m.title }));
    res.json({ draft, matter, client, last, next, matters } satisfies DraftDetail);
  });

  // Autosave: any of title, html and matter_id
  api.post("/drafts/:id", (req, res) => {
    const draft = getDraft(id(req));
    const b = req.body ?? {};
    const title = typeof b.title === "string" ? b.title.trim().slice(0, 200) || "Untitled document" : draft.title;
    const html = typeof b.html === "string" ? b.html : draft.html;
    if (html.length > MAX_HTML) throw new HttpError(413, "This document is too long to save. Split it into two.");
    const linked = "matter_id" in b ? matterId(b.matter_id) : draft.matter_id;
    const ts = vault.now();
    const words = countWords(html);
    const blanks = countBlanks(html);
    run("UPDATE drafts SET title = ?, html = ?, matter_id = ?, words = ?, blanks = ?, updated_at = ? WHERE id = ?",
      title, html, linked, words, blanks, ts, draft.id);
    res.json({ updated_at: ts, words, blanks, title });
  });

  api.post("/drafts/:id/copy", (req, res) => {
    const d = getDraft(id(req));
    const ts = vault.now();
    const title = `Copy of ${d.title}`;
    const copyId = run(`INSERT INTO drafts (title, html, template_id, matter_id, words, blanks, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, title, d.html, d.template_id, d.matter_id, d.words, d.blanks, ts, ts);
    vault.log("Draft created", title, null, null, "Lawyer", d.matter_id);
    res.json({ id: copyId, message: "Copy made." });
  });

  api.post("/drafts/:id/delete", (req, res) => {
    const d = getDraft(id(req));
    run("DELETE FROM drafts WHERE id = ?", d.id);
    vault.log("Draft deleted", d.title, null, null, "Lawyer", d.matter_id);
    res.json({ message: `Deleted "${d.title}".` });
  });
}
