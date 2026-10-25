// Lex AI API: a small cloud vault for legal files, with Groq-powered reading.
// This module builds the Express app. server/index.ts serves it on a port;
// api/index.js runs it as a Vercel serverless function.

import { existsSync } from "node:fs";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { addDays, inr, isValidIsoDate, isoDate, niceDate, today } from "../shared/format.js";
import type { Client, Dashboard, Deadline, Doc, DocRow, Task, Version } from "../shared/types.js";
import * as ai from "./ai.js";
import { UPLOAD_DIR, all, get, run, scalar, transaction } from "./db.js";
import { DEADLINE_SQL, addHearing, createClient, hearings, linkDocument, matterRows, registerDiary } from "./diary.js";
import { allowed } from "./extract.js";
import { HttpError, id, str } from "./http.js";
import {
  INSTANCE, allInvoices, clientRows, counts, invoiceTotals, recentActivity, record, remindersDue, status,
} from "./queries.js";
import { seed } from "./seed.js";
import * as vault from "./vault.js";

// Vercel caps a function's request body at 4.5 MB, so uploads are smaller there
export const MAX_UPLOAD_MB = process.env.VERCEL ? 4 : 20;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 } });
export const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

app.use((req, res, next) => {
  const t0 = performance.now();
  const route = req.path; // read now: the /api router rewrites req.path before the response finishes
  res.setHeader("X-Served-By", INSTANCE);
  res.on("finish", () => {
    if (route.startsWith("/api") && route !== "/api/meta") record(performance.now() - t0, res.statusCode);
  });
  next();
});

const api = express.Router();

function getDoc(docId: number): Doc {
  const doc = get<Doc>(`SELECT d.*, c.name AS client_name, c.code AS client_code, m.title AS matter_title
                        FROM documents d LEFT JOIN clients c ON c.id = d.client_id
                        LEFT JOIN matters m ON m.id = d.matter_id WHERE d.id = ?`, docId);
  if (!doc) throw new HttpError(404, "That document doesn't exist.");
  return doc;
}

// ---------------------------------------------------------------- meta & dashboard

api.get("/meta", (_req, res) => {
  res.json({ instance: INSTANCE, ai: status().ai, counts: counts(), max_upload_mb: MAX_UPLOAD_MB });
});

api.get("/dashboard", (_req, res) => {
  const t = today();
  const iso = isoDate(t);
  const week = isoDate(addDays(t, 7));
  const invoices = allInvoices();
  const unrecorded = hearings("WHERE h.date < ? AND h.outcome = '' ORDER BY h.date DESC", iso);

  // How many hearings are listed on each of the next 14 days
  const perDay = new Map(all<{ date: string; n: number }>(
    "SELECT date, COUNT(*) AS n FROM hearings WHERE date BETWEEN ? AND ? GROUP BY date", iso, isoDate(addDays(t, 13)),
  ).map((r) => [r.date, r.n]));
  const load = Array.from({ length: 14 }, (_, i) => {
    const day = isoDate(addDays(t, i));
    return { date: day, count: perDay.get(day) ?? 0 };
  });

  // Things that need the lawyer, most urgent first
  const tasks: Task[] = [];
  for (const h of unrecorded.slice(0, 4)) {
    tasks.push({ icon: "edit", tone: "amber", title: `Record what happened on ${niceDate(h.date, "%-d %b")}`,
      sub: `${h.case_number || h.matter_title}${h.purpose ? ` · ${h.purpose}` : ""}`, to: `/diary?date=${h.date}`, cta: "Record" });
  }
  for (const d of all<Doc>("SELECT * FROM documents WHERE hearing_date >= ? AND hearing_confirmed = 0 ORDER BY hearing_date", iso)) {
    tasks.push({ icon: "calendar", tone: "amber", title: `Confirm next date ${niceDate(d.hearing_date, "%-d %b")}`,
      sub: `Found in ${d.title}${d.hearing_page ? `, page ${d.hearing_page}` : ""}`, to: `/documents/${d.id}`, cta: "Check" });
  }
  const reminders = remindersDue();
  if (reminders) {
    tasks.push({ icon: "bell", tone: "blue", title: `${reminders} hearing reminder${reminders > 1 ? "s" : ""} to send`,
      sub: "Matters listed today or tomorrow", action: "remind", cta: "Send" });
  }
  for (const d of all<Doc>("SELECT * FROM documents WHERE status = 'Awaiting review' ORDER BY created_at DESC LIMIT 3")) {
    tasks.push({ icon: "file", tone: "purple", title: `Check the summary of ${d.title}`,
      sub: `${d.doc_type} · added ${niceDate(d.created_at)}`, to: `/documents/${d.id}`, cta: "Open" });
  }
  for (const i of invoices.filter((x) => x.status === "Overdue")) {
    tasks.push({ icon: "receipt", tone: "red", title: `${i.inv.number} is overdue`,
      sub: `${inr(i.balance)} due since ${niceDate(i.inv.due)}`, to: `/billing/${i.inv.id}`, cta: "Open" });
  }

  const body: Dashboard = {
    kpi: {
      today: scalar("SELECT COUNT(*) FROM hearings WHERE date = ?", iso),
      week: scalar("SELECT COUNT(*) FROM hearings WHERE date BETWEEN ? AND ?", iso, week),
      overdue: scalar("SELECT COUNT(*) FROM deadlines WHERE done = 0 AND due < ?", iso),
      due_week: scalar("SELECT COUNT(*) FROM deadlines WHERE done = 0 AND due BETWEEN ? AND ?", iso, week),
      unrecorded: unrecorded.length,
      outstanding: invoices.reduce((sum, i) => sum + i.balance, 0),
      invoices_due: invoices.filter((i) => i.balance > 0).length,
    },
    today: hearings("WHERE h.date = ? ORDER BY m.court, m.case_number", iso),
    upcoming: hearings("WHERE h.date > ? AND h.date <= ? ORDER BY h.date, m.court LIMIT 8", iso, week),
    deadlines: all<Deadline>(`${DEADLINE_SQL} WHERE d.done = 0 AND d.due <= ? ORDER BY d.due LIMIT 8`, week),
    load,
    tasks,
    recent: all<DocRow>(`SELECT d.*, c.name AS client_name, v.size, v.filename, v.version FROM documents d
                         LEFT JOIN clients c ON c.id = d.client_id
                         JOIN versions v ON v.document_id = d.id
                           AND v.version = (SELECT MAX(version) FROM versions WHERE document_id = d.id)
                         ORDER BY d.created_at DESC LIMIT 5`),
    activity: recentActivity(6),
  };
  res.json(body);
});

// ---------------------------------------------------------------- documents

api.get("/documents", (req, res) => {
  const q = str(req.query.q);
  const type = str(req.query.type);
  let sql = `SELECT d.*, c.name AS client_name, v.size, v.filename, v.version FROM documents d
             LEFT JOIN clients c ON c.id = d.client_id
             JOIN versions v ON v.document_id = d.id
               AND v.version = (SELECT MAX(version) FROM versions WHERE document_id = d.id)
             WHERE 1 = 1`;
  const args: string[] = [];
  if (q) {
    sql += ` AND (d.title LIKE ? OR d.case_number LIKE ? OR c.name LIKE ? OR d.parties LIKE ?
             OR d.summary LIKE ? OR v.pages LIKE ? OR d.hearing_date LIKE ? OR d.created_at LIKE ?)`;
    args.push(...Array(8).fill(`%${q}%`));
  }
  if (type) {
    sql += " AND d.doc_type = ?";
    args.push(type);
  }
  const t0 = performance.now();
  const rows = all<DocRow>(sql + " ORDER BY d.created_at DESC", ...args);
  res.json({
    rows,
    took: performance.now() - t0,
    types: all<{ doc_type: string }>("SELECT DISTINCT doc_type FROM documents ORDER BY doc_type").map((r) => r.doc_type),
  });
});

api.get("/upload-options", (_req, res) => {
  res.json({
    clients: all<Client>("SELECT * FROM clients ORDER BY name"),
    matters: matterRows("WHERE m.status = 'Open'"),
    doc_types: ai.DOC_TYPES,
  });
});

api.post("/documents", upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) throw new HttpError(400, "Choose a file to upload.");
  if (!allowed(file.originalname)) throw new HttpError(400, "Lex AI accepts PDF, text and image files (PNG, JPG, WEBP).");
  let clientId: number | null = Number(req.body.client_id) || null;
  let caseNumber = str(req.body.case_number);
  // Uploading from a matter files the document straight under it
  const matter = Number(req.body.matter_id)
    ? get<{ id: number; client_id: number | null; case_number: string }>("SELECT * FROM matters WHERE id = ?", Number(req.body.matter_id))
    : undefined;
  if (matter) {
    clientId = matter.client_id;
    caseNumber = caseNumber || matter.case_number;
  } else if (req.body.client_id === "new") {
    const newClient = str(req.body.new_client);
    clientId = newClient ? createClient(newClient) : null;
  }
  const title = str(req.body.title) ||
    path.parse(file.originalname).name.replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase());
  let docId: number;
  try {
    docId = await vault.ingest(file.buffer, file.originalname, {
      title, clientId, matterId: matter?.id ?? null, caseNumber, docType: str(req.body.doc_type),
    });
  } catch (err) {
    throw new HttpError(422, `That file could not be read: ${String(err).slice(0, 160)}`);
  }
  linkDocument(docId);
  res.status(201).json({ id: docId });
});

api.get("/documents/:id", (req, res) => {
  const docId = id(req);
  const doc = getDoc(docId);
  const versions = all<Version & { pages: string }>("SELECT * FROM versions WHERE document_id = ? ORDER BY version DESC", docId);
  res.json({
    doc,
    versions: versions.map(({ pages: _pages, ...v }) => v),
    pages: vault.pagesOf(versions[0]),
    key_points: JSON.parse(doc.key_points || "[]"),
    activity: recentActivity(12, "WHERE a.document_id = ?", docId),
  });
});

api.get("/documents/:id/file/:version", (req, res) => {
  const docId = id(req);
  const v = get<Version>("SELECT * FROM versions WHERE document_id = ? AND version = ?", docId, id(req, "version"));
  if (!v) throw new HttpError(404, "That version doesn't exist.");
  vault.log("Opened", `${v.filename} · v${v.version}`, docId);
  res.type(v.mime);
  if (req.query.dl === "1") res.attachment(v.filename);
  else res.setHeader("Content-Disposition", `inline; filename="${v.filename.replace(/"/g, "")}"`);
  res.sendFile(path.resolve(UPLOAD_DIR, v.stored_name));
});

api.post("/documents/:id/version", upload.single("file"), async (req, res) => {
  const docId = id(req);
  const doc = getDoc(docId);
  if (!req.file || !allowed(req.file.originalname)) throw new HttpError(400, "Choose a PDF, text or image file.");
  await vault.ingest(req.file.buffer, req.file.originalname, { title: doc.title, documentId: docId });
  res.json({ message: "New version saved. Earlier versions are kept." });
});

api.post("/documents/:id/reanalyze", async (req, res) => {
  const docId = id(req);
  getDoc(docId);
  const result = await ai.analyze(vault.pagesOf(vault.latestVersion(docId)));
  run(`UPDATE documents SET summary = ?, key_points = ?, ai_source = ?, parties = COALESCE(NULLIF(?, ''), parties),
       hearing_date = ?, hearing_page = ?, hearing_confirmed = 0, updated_at = ? WHERE id = ?`,
    result.summary, JSON.stringify(result.key_points), result.source, result.parties,
    result.hearing_date, result.hearing_page, vault.now(), docId);
  vault.log("AI summary", "Re-read by " + (result.source === "groq" ? "Groq" : "local reader"), docId, null, "Automation");
  res.json(result.error
    ? { message: "Groq was unreachable, so the local reader was used.", kind: "error" }
    : { message: "Summary refreshed." });
});

api.post("/documents/:id/review", (req, res) => {
  const docId = id(req);
  getDoc(docId);
  run("UPDATE documents SET status = 'Reviewed', updated_at = ? WHERE id = ?", vault.now(), docId);
  vault.log("Reviewed", "Summary checked by lawyer", docId);
  res.json({ message: "Marked as reviewed." });
});

api.post("/documents/:id/hearing", (req, res) => {
  const docId = id(req);
  getDoc(docId);
  if (req.body?.action === "clear") {
    run("UPDATE documents SET hearing_date = '', hearing_page = NULL, hearing_confirmed = 0 WHERE id = ?", docId);
    vault.log("AI date dismissed", "", docId);
    res.json({ message: "Date dismissed." });
    return;
  }
  const date = str(req.body?.date);
  if (!isValidIsoDate(date)) throw new HttpError(400, "Enter a valid date.");
  // Confirming puts the date in the matter's diary, opening the matter if needed
  const matterId = transaction(() => {
    const mid = linkDocument(docId, true)!;
    addHearing(mid, date, str(req.body?.purpose), docId);
    run("UPDATE documents SET hearing_date = ?, hearing_confirmed = 1 WHERE id = ?", date, docId);
    vault.log("Hearing confirmed", `${niceDate(date)} · added to the diary`, docId);
    return mid;
  });
  res.json({ message: `Added to the diary for ${niceDate(date, "%a %-d %b %Y")}.`, matter_id: matterId });
});

api.post("/documents/:id/verify", (req, res) => {
  const docId = id(req);
  getDoc(docId);
  const results = vault.verify(docId);
  const bad = results.filter((r) => !r.ok);
  if (bad.length) {
    vault.log("Integrity alert", `${bad.length} version(s) do not match their SHA-256 fingerprint`, docId, null, "Automation");
  } else {
    vault.log("Integrity verified", `${results.length} version(s) match SHA-256`, docId, null, "Automation");
  }
  res.json({
    results,
    message: bad.length ? "Fingerprint mismatch. The file was changed after upload." : "Every version matches its SHA-256 fingerprint.",
    kind: bad.length ? "error" : "ok",
  });
});

api.post("/documents/:id/tamper", (req, res) => {
  const docId = id(req);
  getDoc(docId);
  const v = vault.latestVersion(docId)!;
  vault.tamper(v.stored_name);
  vault.log("File overwritten", `v${v.version} changed outside Lex AI (demo)`, docId, null, "Unknown script");
  res.json({ message: "Demo: the working copy was overwritten. Now run Verify.", kind: "error" });
});

api.post("/documents/:id/restore", (req, res) => {
  const docId = id(req);
  getDoc(docId);
  const restored = vault.verify(docId).filter((r) => !r.ok && vault.restore(r.stored_name)).map((r) => r.version);
  vault.log("Restored", restored.length ? `Locked copy restored for v${restored.join(", v")}` : "Nothing to restore", docId);
  res.json({
    results: vault.verify(docId),
    message: restored.length ? "Restored from the locked copy." : "Nothing needed restoring.",
  });
});

api.post("/documents/:id/ask", async (req, res) => {
  const docId = id(req);
  getDoc(docId);
  const question = str(req.body?.question).slice(0, 300);
  if (!question) throw new HttpError(400, "Type a question.");
  const t0 = performance.now();
  const result = await ai.ask(question, vault.pagesOf(vault.latestVersion(docId)));
  vault.log("Asked the file", question, docId);
  res.json({ ...result, ms: Math.round(performance.now() - t0) });
});

// ---------------------------------------------------------------- clients

api.get("/clients", (req, res) => {
  const q = str(req.query.q);
  const everyone = clientRows();
  res.json({
    rows: q ? clientRows(q) : everyone,
    stats: {
      clients: everyone.length,
      matters: everyone.reduce((s, r) => s + r.matters, 0),
      invoices_due: allInvoices().filter((i) => i.balance > 0).length,
      outstanding: everyone.reduce((s, r) => s + r.balance, 0),
    },
  });
});

api.post("/clients", (req, res) => {
  const name = str(req.body?.name);
  if (!name) throw new HttpError(400, "A client needs a name.");
  const cid = createClient(name, {
    matter: str(req.body.matter), email: str(req.body.email), phone: str(req.body.phone), lawyer: str(req.body.lawyer),
  });
  res.status(201).json({ id: cid, message: "Client added." });
});

api.get("/clients/:id", (req, res) => {
  const cid = id(req);
  const client = get<Client>("SELECT * FROM clients WHERE id = ?", cid);
  if (!client) throw new HttpError(404, "That client doesn't exist.");
  const docs = all<Doc>("SELECT * FROM documents WHERE client_id = ? ORDER BY created_at DESC", cid);
  const invoices = all<{ id: number }>("SELECT id FROM invoices WHERE client_id = ? ORDER BY issued DESC", cid)
    .map((r) => invoiceTotals(r.id)!);
  res.json({
    client, docs, matters: matterRows("WHERE m.client_id = ?", cid), invoices,
    balance: invoices.reduce((s, i) => s + i.balance, 0),
    activity: recentActivity(15, "WHERE a.client_id = ?", cid),
  });
});

// ---------------------------------------------------------------- billing

api.get("/invoices", (_req, res) => {
  const rows = all<{ id: number; client_name: string }>(`SELECT i.id, c.name AS client_name FROM invoices i
    JOIN clients c ON c.id = i.client_id ORDER BY i.issued DESC, i.id DESC`)
    .map((r) => ({ ...invoiceTotals(r.id)!, client_name: r.client_name }));
  res.json({
    rows,
    totals: {
      billed: rows.reduce((s, r) => s + r.total, 0),
      received: rows.reduce((s, r) => s + r.total - r.balance, 0),
      outstanding: rows.reduce((s, r) => s + r.balance, 0),
    },
  });
});

api.post("/invoices", (req, res) => {
  const b = req.body ?? {};
  const clientId = Number(b.client_id);
  const lines = (Array.isArray(b.lines) ? b.lines : [])
    .map((l: { service?: unknown; qty?: unknown; rate?: unknown }) =>
      ({ service: str(l.service), qty: Math.max(0, Math.round(Number(l.qty) || 0)), rate: Math.max(0, Math.round(Number(l.rate) || 0)) }))
    .filter((l: { service: string }) => l.service);
  if (!clientId || !get("SELECT 1 FROM clients WHERE id = ?", clientId) || !lines.length) {
    throw new HttpError(400, "Pick a client and add at least one line.");
  }
  const year = today().getFullYear();
  const invoiceId = transaction(() => {
    let n = scalar("SELECT COUNT(*) FROM invoices") + 14;
    let number = `INV-${year}-${String(n).padStart(3, "0")}`;
    while (get("SELECT 1 FROM invoices WHERE number = ?", number)) number = `INV-${year}-${String(++n).padStart(3, "0")}`;
    const newId = run("INSERT INTO invoices (number, client_id, case_number, issued, due, retainer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      number, clientId, str(b.case_number), isValidIsoDate(b.issued) ? b.issued : isoDate(),
      isValidIsoDate(b.due) ? b.due : isoDate(addDays(today(), 14)), Math.max(0, Math.round(Number(b.retainer) || 0)), vault.now());
    for (const l of lines) run("INSERT INTO invoice_items (invoice_id, service, qty, rate) VALUES (?, ?, ?, ?)", newId, l.service, l.qty, l.rate);
    vault.log("Invoice issued", number, null, clientId);
    return newId;
  });
  res.status(201).json({ id: invoiceId, message: `${invoiceTotals(invoiceId)!.inv.number} created.` });
});

api.get("/invoices/:id", (req, res) => {
  const t = invoiceTotals(id(req));
  if (!t) throw new HttpError(404, "That invoice doesn't exist.");
  res.json({ t, client: get<Client>("SELECT * FROM clients WHERE id = ?", t.inv.client_id) });
});

api.post("/invoices/:id/payments", (req, res) => {
  const t = invoiceTotals(id(req));
  if (!t) throw new HttpError(404, "That invoice doesn't exist.");
  const amount = Math.round(Number(req.body?.amount) || 0);
  if (amount <= 0) throw new HttpError(400, "Enter an amount.");
  run("INSERT INTO payments (invoice_id, amount, method, paid_on) VALUES (?, ?, ?, ?)",
    t.inv.id, amount, str(req.body.method), isoDate());
  vault.log("Payment recorded", `${inr(amount)} on ${t.inv.number}`, null, t.inv.client_id);
  res.json({ message: `${inr(amount)} recorded.` });
});

// ---------------------------------------------------------------- activity & status

registerDiary(api);
api.get("/activity", (_req, res) => res.json(recentActivity(200)));
api.get("/status", (_req, res) => res.json(status()));
api.use((_req, _res, next) => next(new HttpError(404, "Not found")));

app.use("/api", api);

app.get("/health", (_req, res) => {
  const s = status();
  res.status(s.status === "ok" ? 200 : 503).json(s);
});

// The built React app, with client-side routing falling back to index.html
const CLIENT_DIR = path.resolve("dist/client");
if (existsSync(path.join(CLIENT_DIR, "index.html"))) {
  app.use(express.static(CLIENT_DIR, { index: false, maxAge: "1h" }));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(CLIENT_DIR, "index.html")));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ error: `Files must be ${MAX_UPLOAD_MB} MB or smaller.` });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

/** Resolves once demo data is in place. Wait for it before serving requests. */
export const ready: Promise<void> =
  scalar("SELECT COUNT(*) FROM documents") === 0 && (process.env.SEED_DEMO ?? "1") === "1" ? seed() : Promise.resolve();
