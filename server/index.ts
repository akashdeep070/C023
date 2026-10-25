// Lex AI API: a small cloud vault for legal files, with Groq-powered reading.

import { existsSync } from "node:fs";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { addDays, inr, isValidIsoDate, isoDate, niceDate, parseDate, today } from "../shared/format.js";
import type { Client, Dashboard, Doc, DocRow, Task, Version } from "../shared/types.js";
import * as ai from "./ai.js";
import { UPLOAD_DIR, all, get, run, scalar, transaction } from "./db.js";
import { allowed } from "./extract.js";
import {
  INSTANCE, allInvoices, clientRows, counts, invoiceTotals, recentActivity, record, remindersDue, status,
} from "./queries.js";
import { seed } from "./seed.js";
import * as vault from "./vault.js";

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const app = express();
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
const id = (req: Request, key = "id") => {
  const n = Number(req.params[key]);
  if (!Number.isInteger(n)) throw new HttpError(404, "Not found");
  return n;
};
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function getDoc(docId: number): Doc {
  const doc = get<Doc>(`SELECT d.*, c.name AS client_name, c.code AS client_code
                        FROM documents d LEFT JOIN clients c ON c.id = d.client_id WHERE d.id = ?`, docId);
  if (!doc) throw new HttpError(404, "That document doesn't exist.");
  return doc;
}

function createClient(name: string, extra: Partial<Client> = {}): number {
  const n = scalar("SELECT COALESCE(MAX(CAST(SUBSTR(code, 4) AS INTEGER)), 13) + 1 FROM clients");
  const code = `CL-${String(n).padStart(3, "0")}`;
  const cid = run("INSERT INTO clients (code, name, matter, email, phone, lawyer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    code, name, extra.matter ?? "", extra.email ?? "", extra.phone ?? "", extra.lawyer ?? "", vault.now());
  vault.log("Client added", `${name} · ${code}`, null, cid);
  return cid;
}

// ---------------------------------------------------------------- meta & dashboard

api.get("/meta", (_req, res) => {
  res.json({ instance: INSTANCE, ai: status().ai, counts: counts() });
});

api.get("/dashboard", (_req, res) => {
  const t = today();
  const iso = isoDate(t);
  const invoices = allInvoices();
  const hearings = all<Doc>(`SELECT d.*, c.name AS client_name FROM documents d LEFT JOIN clients c ON c.id = d.client_id
                             WHERE d.hearing_date >= ? ORDER BY d.hearing_date LIMIT 6`, iso);

  // Actions logged per day for the last 14 days
  const perDay = new Map(all<{ day: string; n: number }>(
    "SELECT substr(ts, 1, 10) AS day, COUNT(*) AS n FROM audit WHERE ts >= ? GROUP BY 1", isoDate(addDays(t, -13)),
  ).map((r) => [r.day, r.n]));
  const chart = Array.from({ length: 14 }, (_, i) => {
    const day = isoDate(addDays(t, i - 13));
    return { date: day, count: perDay.get(day) ?? 0 };
  });

  // Things that need a person, most urgent first
  const tasks: Task[] = [];
  for (const d of all<Doc>("SELECT * FROM documents WHERE hearing_date >= ? AND hearing_confirmed = 0 ORDER BY hearing_date", iso)) {
    tasks.push({ icon: "calendar", title: `Confirm hearing on ${niceDate(d.hearing_date)}`,
      sub: `${d.case_number || d.title} · suggested by AI`, to: `/documents/${d.id}`, cta: "Review" });
  }
  const reminders = remindersDue();
  if (reminders) {
    tasks.push({ icon: "bell", title: `${reminders} reminder${reminders > 1 ? "s" : ""} due today`,
      sub: "Hearing tomorrow · email the lawyer", action: "remind", cta: "Send" });
  }
  for (const d of all<Doc>("SELECT * FROM documents WHERE status = 'Awaiting review' ORDER BY created_at DESC LIMIT 3")) {
    tasks.push({ icon: "sparkles", title: `Check AI summary: ${d.title}`,
      sub: `${d.doc_type} · added ${niceDate(d.created_at)}`, to: `/documents/${d.id}`, cta: "Open" });
  }
  for (const i of invoices.filter((x) => x.status === "Overdue")) {
    tasks.push({ icon: "receipt", title: `${i.inv.number} is overdue`,
      sub: `${inr(i.balance)} due since ${niceDate(i.inv.due)}`, to: `/billing/${i.inv.id}`, cta: "Open" });
  }

  const body: Dashboard = {
    kpi: {
      documents: scalar("SELECT COUNT(*) FROM documents"),
      new_week: scalar("SELECT COUNT(*) FROM documents WHERE created_at >= ?", isoDate(addDays(t, -6))),
      hearings_14: scalar("SELECT COUNT(*) FROM documents WHERE hearing_confirmed = 1 AND hearing_date BETWEEN ? AND ?",
        iso, isoDate(addDays(t, 14))),
      next_hearing: hearings.find((h) => h.hearing_confirmed)?.hearing_date ?? null,
      review: scalar("SELECT COUNT(*) FROM documents WHERE status = 'Awaiting review'"),
      outstanding: invoices.reduce((s, i) => s + i.balance, 0),
      invoices_due: invoices.filter((i) => i.balance > 0).length,
    },
    hearings,
    recent: all<DocRow>(`SELECT d.*, c.name AS client_name, v.size, v.filename, v.version FROM documents d
                         LEFT JOIN clients c ON c.id = d.client_id
                         JOIN versions v ON v.document_id = d.id
                           AND v.version = (SELECT MAX(version) FROM versions WHERE document_id = d.id)
                         ORDER BY d.created_at DESC LIMIT 5`),
    chart,
    tasks,
    health: status(),
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
  res.json({ clients: all<Client>("SELECT * FROM clients ORDER BY name"), doc_types: ai.DOC_TYPES });
});

api.post("/documents", upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) throw new HttpError(400, "Choose a file to upload.");
  if (!allowed(file.originalname)) throw new HttpError(400, "Lex AI accepts PDF, text and image files (PNG, JPG, WEBP).");
  let clientId: number | null = Number(req.body.client_id) || null;
  const newClient = str(req.body.new_client);
  if (req.body.client_id === "new") clientId = newClient ? createClient(newClient) : null;
  const title = str(req.body.title) ||
    path.parse(file.originalname).name.replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase());
  try {
    const docId = await vault.ingest(file.buffer, file.originalname, {
      title, clientId, caseNumber: str(req.body.case_number), docType: str(req.body.doc_type),
    });
    res.status(201).json({ id: docId });
  } catch (err) {
    throw new HttpError(422, `That file could not be read: ${String(err).slice(0, 160)}`);
  }
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
    vault.log("Hearing removed", "", docId);
    res.json({ message: "Hearing date removed." });
    return;
  }
  const date = str(req.body?.date);
  if (!isValidIsoDate(date)) throw new HttpError(400, "Enter a valid date.");
  run("UPDATE documents SET hearing_date = ?, hearing_confirmed = 1, reminder_sent = 0 WHERE id = ?", date, docId);
  const sendOn = isoDate(addDays(parseDate(date), -1));
  vault.log("Hearing confirmed", `${niceDate(date)} · reminder on ${niceDate(sendOn)}`, docId);
  res.json({ message: `Hearing confirmed. A reminder goes out on ${niceDate(sendOn)}.` });
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

// ---------------------------------------------------------------- hearings

api.get("/hearings", (_req, res) => {
  const iso = isoDate();
  const rows = all<Doc>(`SELECT d.*, c.name AS client_name FROM documents d LEFT JOIN clients c ON c.id = d.client_id
                         WHERE d.hearing_date != '' ORDER BY d.hearing_date`);
  res.json({
    upcoming: rows.filter((r) => r.hearing_confirmed && r.hearing_date >= iso),
    pending: rows.filter((r) => !r.hearing_confirmed && r.hearing_date >= iso),
    past: rows.filter((r) => r.hearing_date < iso).reverse().slice(0, 8),
    due: remindersDue(),
    all: rows,
  });
});

api.post("/hearings/remind", (_req, res) => {
  const due = all<Doc & { lawyer: string }>(`SELECT d.*, c.lawyer FROM documents d LEFT JOIN clients c ON c.id = d.client_id
    WHERE hearing_confirmed = 1 AND reminder_sent = 0 AND hearing_date BETWEEN ? AND ?`,
  isoDate(), isoDate(addDays(today(), 1)));
  transaction(() => {
    for (const d of due) {
      run("UPDATE documents SET reminder_sent = 1 WHERE id = ?", d.id);
      vault.log("Reminder email sent", `To ${d.lawyer || "the lawyer"}: ${d.case_number || d.title} on ${niceDate(d.hearing_date)}`,
        d.id, null, "Scheduler");
    }
  });
  res.json({ message: due.length ? `${due.length} reminder email(s) sent.` : "No reminders are due yet." });
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
  const matters = new Map<string, { case: string; docs: number; next: string | null }>();
  for (const d of docs) {
    const key = d.case_number || "General";
    const m = matters.get(key) ?? { case: key, docs: 0, next: null };
    m.docs += 1;
    if (d.hearing_confirmed && d.hearing_date >= isoDate() && (!m.next || d.hearing_date < m.next)) m.next = d.hearing_date;
    matters.set(key, m);
  }
  const invoices = all<{ id: number }>("SELECT id FROM invoices WHERE client_id = ? ORDER BY issued DESC", cid)
    .map((r) => invoiceTotals(r.id)!);
  res.json({
    client, docs, matters: [...matters.values()], invoices,
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
    res.status(413).json({ error: "Files must be 20 MB or smaller." });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

if (scalar("SELECT COUNT(*) FROM documents") === 0 && (process.env.SEED_DEMO ?? "1") === "1") {
  await seed();
}

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => console.log(`Lex AI API on http://localhost:${PORT} (${INSTANCE})`));
