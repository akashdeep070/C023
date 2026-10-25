// The case diary: matters, dated hearings with outcomes, deadlines, and the conflict check.

import type { Router } from "express";
import { addDays, isValidIsoDate, isoDate, niceDate, today } from "../shared/format.js";
import type { Client, ConflictHit, Deadline, DiaryData, Doc, Hearing, Matter, MatterRow } from "../shared/types.js";
import { all, get, run, scalar, transaction } from "./db.js";
import { HttpError, id, str } from "./http.js";
import { invoiceTotals, recentActivity, remindersDue } from "./queries.js";
import * as vault from "./vault.js";

type Arg = string | number | null;

// Each hearing comes with its matter, client, and the previous date's outcome,
// which is what a lawyer reads first when the matter is called out.
const HEARING_SQL = `
  SELECT h.*, m.case_number, m.title AS matter_title, m.court, m.stage, m.client_id,
         c.name AS client_name, c.phone AS client_phone,
         (SELECT p.date FROM hearings p WHERE p.matter_id = h.matter_id AND p.date < h.date ORDER BY p.date DESC LIMIT 1) AS prev_date,
         (SELECT p.outcome FROM hearings p WHERE p.matter_id = h.matter_id AND p.date < h.date ORDER BY p.date DESC LIMIT 1) AS prev_outcome
  FROM hearings h JOIN matters m ON m.id = h.matter_id LEFT JOIN clients c ON c.id = m.client_id`;

export const hearings = (where: string, ...args: Arg[]) => all<Hearing>(`${HEARING_SQL} ${where}`, ...args);

export const DEADLINE_SQL = `
  SELECT d.*, m.case_number, m.title AS matter_title, c.name AS client_name
  FROM deadlines d LEFT JOIN matters m ON m.id = d.matter_id LEFT JOIN clients c ON c.id = m.client_id`;

export function matterRows(where = "", ...args: Arg[]): MatterRow[] {
  const t = isoDate();
  return all<MatterRow>(`
    SELECT m.*, c.name AS client_name,
      (SELECT MIN(date) FROM hearings h WHERE h.matter_id = m.id AND h.date >= ?) AS next_hearing,
      (SELECT purpose FROM hearings h WHERE h.matter_id = m.id AND h.date >= ? ORDER BY date LIMIT 1) AS next_purpose,
      (SELECT date FROM hearings h WHERE h.matter_id = m.id AND h.date < ? ORDER BY date DESC LIMIT 1) AS last_date,
      (SELECT outcome FROM hearings h WHERE h.matter_id = m.id AND h.date < ? ORDER BY date DESC LIMIT 1) AS last_outcome,
      (SELECT COUNT(*) FROM deadlines d WHERE d.matter_id = m.id AND d.done = 0) AS open_deadlines,
      (SELECT COUNT(*) FROM documents d WHERE d.matter_id = m.id) AS docs
    FROM matters m LEFT JOIN clients c ON c.id = m.client_id
    ${where}
    ORDER BY m.status = 'Disposed', next_hearing IS NULL, next_hearing, m.id DESC`, t, t, t, t, ...args);
}

export function createClient(name: string, extra: Partial<Client> = {}): number {
  const n = scalar("SELECT COALESCE(MAX(CAST(SUBSTR(code, 4) AS INTEGER)), 13) + 1 FROM clients");
  const code = `CL-${String(n).padStart(3, "0")}`;
  const cid = run("INSERT INTO clients (code, name, matter, email, phone, lawyer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    code, name, extra.matter ?? "", extra.email ?? "", extra.phone ?? "", extra.lawyer ?? "", vault.now());
  vault.log("Client added", `${name} · ${code}`, null, cid);
  return cid;
}

/** The matter for a case number (and client), opened if it doesn't exist yet. */
export function findOrCreateMatter(clientId: number | null, caseNumber: string, title: string): number {
  const cn = caseNumber.trim();
  if (cn) {
    const found = get<{ id: number }>(
      `SELECT id FROM matters WHERE lower(trim(case_number)) = lower(?)
         AND (? IS NULL OR client_id IS NULL OR client_id = ?) ORDER BY id LIMIT 1`, cn, clientId, clientId);
    if (found) {
      if (clientId) run("UPDATE matters SET client_id = COALESCE(client_id, ?) WHERE id = ?", clientId, found.id);
      return found.id;
    }
  }
  const mid = run("INSERT INTO matters (client_id, case_number, title, created_at) VALUES (?, ?, ?, ?)",
    clientId, cn, title, vault.now());
  vault.log("Matter opened", cn || title, null, clientId, "Lawyer", mid);
  return mid;
}

/** File a document under its matter when it has a case number. Returns the matter id, if any. */
export function linkDocument(docId: number, force = false): number | null {
  const doc = get<Doc>("SELECT * FROM documents WHERE id = ?", docId);
  if (!doc) return null;
  if (doc.matter_id) return doc.matter_id;
  if (!doc.case_number && !force) return null; // general client papers stay unfiled
  const mid = findOrCreateMatter(doc.client_id, doc.case_number, doc.parties || doc.title);
  run("UPDATE documents SET matter_id = ? WHERE id = ?", mid, docId);
  run("UPDATE audit SET matter_id = ? WHERE document_id = ? AND matter_id IS NULL", mid, docId);
  return mid;
}

/** Put a date in the diary. A matter has at most one hearing per day. */
export function addHearing(matterId: number, date: string, purpose: string, documentId: number | null = null): number {
  const existing = get<{ id: number; purpose: string }>("SELECT id, purpose FROM hearings WHERE matter_id = ? AND date = ?", matterId, date);
  if (existing) {
    if (purpose && !existing.purpose) run("UPDATE hearings SET purpose = ? WHERE id = ?", purpose, existing.id);
    return existing.id;
  }
  const hid = run("INSERT INTO hearings (matter_id, date, purpose, document_id, created_at) VALUES (?, ?, ?, ?, ?)",
    matterId, date, purpose, documentId, vault.now());
  vault.log("Hearing listed", `${niceDate(date)}${purpose ? ` · ${purpose}` : ""}`, null, null, "Lawyer", matterId);
  return hid;
}

// ---------------------------------------------------------------- conflict check

const norm = (s: string) => s.toLowerCase()
  .replace(/\b(pvt|private|ltd|limited|llp|inc|co|the|m\/s|mr|mrs|ms|dr|adv|shri|smt)\b\.?/g, " ")
  .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const same = (a: string, b: string) => a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a));

/**
 * Before taking a matter: is the other side already our client, or is our new
 * client already on the other side of one of our matters?
 */
export function conflicts(party: string, clientName: string, excludeMatter: number | null = null): ConflictHit[] {
  const hits: ConflictHit[] = [];
  const p = norm(party);
  if (p) {
    for (const c of all<Client>("SELECT * FROM clients")) {
      if (same(norm(c.name), p)) {
        hits.push({ kind: "The other side is already your client", name: c.name,
          detail: `${c.code}${c.matter ? ` · ${c.matter}` : ""}`, to: `/clients/${c.id}` });
      }
    }
  }
  const cn = norm(clientName);
  if (cn) {
    for (const m of all<Matter>("SELECT * FROM matters WHERE opposite_party != ''")) {
      if (m.id !== excludeMatter && same(norm(m.opposite_party), cn)) {
        hits.push({ kind: "Your client is the opposite party in another matter", name: m.opposite_party,
          detail: m.case_number || m.title, to: `/matters/${m.id}` });
      }
    }
  }
  return hits;
}

// ---------------------------------------------------------------- routes

const MATTER_FIELDS = ["case_number", "title", "court", "our_side", "stage", "opposite_party", "opposite_counsel"] as const;

export function getMatter(mid: number): Matter {
  const m = get<Matter>("SELECT m.*, c.name AS client_name FROM matters m LEFT JOIN clients c ON c.id = m.client_id WHERE m.id = ?", mid);
  if (!m) throw new HttpError(404, "That matter doesn't exist.");
  return m;
}

export function registerDiary(api: Router) {
  api.get("/matters", (req, res) => {
    const q = str(req.query.q);
    const status = str(req.query.status) || "Open";
    const where: string[] = [];
    const args: Arg[] = [];
    if (status !== "All") { where.push("m.status = ?"); args.push(status); }
    if (q) {
      where.push(`(m.case_number LIKE ? OR m.title LIKE ? OR m.court LIKE ? OR m.opposite_party LIKE ? OR c.name LIKE ?)`);
      args.push(...Array(5).fill(`%${q}%`));
    }
    res.json({
      rows: matterRows(where.length ? `WHERE ${where.join(" AND ")}` : "", ...args),
      counts: { open: scalar("SELECT COUNT(*) FROM matters WHERE status = 'Open'"),
                disposed: scalar("SELECT COUNT(*) FROM matters WHERE status = 'Disposed'") },
    });
  });

  api.get("/conflicts", (req, res) => {
    res.json(conflicts(str(req.query.party), str(req.query.client), Number(req.query.exclude) || null));
  });

  api.post("/matters", (req, res) => {
    const b = req.body ?? {};
    let clientId: number | null = Number(b.client_id) || null;
    if (b.client_id === "new") {
      const name = str(b.new_client);
      if (!name) throw new HttpError(400, "Enter the new client's name.");
      clientId = createClient(name, { phone: str(b.phone) });
    }
    const client = clientId ? get<Client>("SELECT * FROM clients WHERE id = ?", clientId) : undefined;
    const opposite = str(b.opposite_party);
    const defending = /defend|respond|accused/i.test(str(b.our_side));
    const title = str(b.title) || (client && opposite
      ? (defending ? `${opposite} vs ${client.name}` : `${client.name} vs ${opposite}`)
      : client?.name ?? opposite);
    if (!title) throw new HttpError(400, "Give the matter a client, an opposite party or a title.");
    const next = str(b.next_date);
    if (next && !isValidIsoDate(next)) throw new HttpError(400, "The next date is not a valid date.");

    const mid = transaction(() => {
      const newId = run(`INSERT INTO matters (client_id, case_number, title, court, our_side, stage, opposite_party, opposite_counsel, created_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, clientId, str(b.case_number), title, str(b.court), str(b.our_side),
        str(b.stage), opposite, str(b.opposite_counsel), vault.now());
      vault.log("Matter opened", str(b.case_number) || title, null, clientId, "Lawyer", newId);
      if (next) addHearing(newId, next, str(b.next_purpose));
      return newId;
    });
    res.status(201).json({ id: mid, message: "Matter opened." });
  });

  api.get("/matters/:id", (req, res) => {
    const mid = id(req);
    const matter = getMatter(mid);
    const invoiceIds = matter.client_id
      ? all<{ id: number }>("SELECT id FROM invoices WHERE client_id = ? AND case_number = ? ORDER BY issued DESC",
        matter.client_id, matter.case_number)
      : [];
    res.json({
      matter,
      client: matter.client_id ? get<Client>("SELECT * FROM clients WHERE id = ?", matter.client_id) ?? null : null,
      hearings: hearings("WHERE h.matter_id = ? ORDER BY h.date DESC", mid),
      docs: all<Doc>("SELECT * FROM documents WHERE matter_id = ? ORDER BY created_at DESC", mid),
      deadlines: all<Deadline>(`${DEADLINE_SQL} WHERE d.matter_id = ? ORDER BY d.done, d.due`, mid),
      invoices: invoiceIds.map((r) => invoiceTotals(r.id)!),
      activity: recentActivity(20, "WHERE a.matter_id = ?", mid),
    });
  });

  api.post("/matters/:id", (req, res) => {
    const mid = id(req);
    const before = getMatter(mid);
    const b = req.body ?? {};
    const sets: string[] = [];
    const args: Arg[] = [];
    for (const f of MATTER_FIELDS) {
      if (typeof b[f] === "string") { sets.push(`${f} = ?`); args.push(b[f].trim()); }
    }
    if (b.status === "Open" || b.status === "Disposed") { sets.push("status = ?"); args.push(b.status); }
    if (!sets.length) throw new HttpError(400, "Nothing to update.");
    run(`UPDATE matters SET ${sets.join(", ")} WHERE id = ?`, ...args, mid);
    const changed = MATTER_FIELDS.filter((f) => typeof b[f] === "string" && b[f].trim() !== before[f]);
    if (b.status && b.status !== before.status) changed.push("status" as never);
    vault.log("Matter updated", changed.join(", ").replace(/_/g, " ") || "No changes", null, null, "Lawyer", mid);
    res.json({ message: b.status === "Disposed" && before.status !== "Disposed" ? "Matter marked as disposed." : "Matter updated." });
  });

  api.post("/matters/:id/hearings", (req, res) => {
    const mid = id(req);
    getMatter(mid);
    const date = str(req.body?.date);
    if (!isValidIsoDate(date)) throw new HttpError(400, "Enter a valid date.");
    addHearing(mid, date, str(req.body?.purpose));
    res.status(201).json({ message: `Listed for ${niceDate(date, "%a %-d %b %Y")}.` });
  });

  api.get("/diary", (req, res) => {
    const date = isValidIsoDate(req.query.date) ? (req.query.date as string) : isoDate();
    const month = /^\d{4}-\d{2}$/.test(str(req.query.month)) ? str(req.query.month) : date.slice(0, 7);
    const days = new Map<string, { date: string; hearings: number; deadlines: number }>();
    const mark = (d: string) => days.get(d) ?? days.set(d, { date: d, hearings: 0, deadlines: 0 }).get(d)!;
    for (const r of all<{ date: string; n: number }>("SELECT date, COUNT(*) AS n FROM hearings WHERE date LIKE ? GROUP BY date", `${month}%`)) {
      mark(r.date).hearings = r.n;
    }
    for (const r of all<{ due: string; n: number }>("SELECT due, COUNT(*) AS n FROM deadlines WHERE done = 0 AND due LIKE ? GROUP BY due", `${month}%`)) {
      mark(r.due).deadlines = r.n;
    }
    const body: DiaryData = {
      date,
      hearings: hearings("WHERE h.date = ? ORDER BY m.court, m.case_number", date),
      deadlines: all<Deadline>(`${DEADLINE_SQL} WHERE d.due = ? AND d.done = 0 ORDER BY d.id`, date),
      pending: all<Doc>(`SELECT d.*, c.name AS client_name FROM documents d LEFT JOIN clients c ON c.id = d.client_id
                         WHERE d.hearing_date >= ? AND d.hearing_confirmed = 0 ORDER BY d.hearing_date`, isoDate()),
      unrecorded: hearings("WHERE h.date < ? AND h.outcome = '' ORDER BY h.date DESC LIMIT 20", isoDate()),
      month: [...days.values()],
      due_reminders: remindersDue(),
    };
    res.json(body);
  });

  api.post("/hearings/:id/outcome", (req, res) => {
    const h = get<Hearing>("SELECT * FROM hearings WHERE id = ?", id(req));
    if (!h) throw new HttpError(404, "That hearing doesn't exist.");
    const b = req.body ?? {};
    const outcome = str(b.outcome);
    if (!outcome) throw new HttpError(400, "Write down what happened at the hearing.");
    const next = str(b.next_date);
    const disposed = b.disposed === true;
    if (next && (!isValidIsoDate(next) || next <= h.date)) throw new HttpError(400, "The next date must come after this hearing.");
    transaction(() => {
      run("UPDATE hearings SET outcome = ?, notes = ? WHERE id = ?", outcome, str(b.notes), h.id);
      if (str(b.stage)) run("UPDATE matters SET stage = ? WHERE id = ?", str(b.stage), h.matter_id);
      if (disposed) run("UPDATE matters SET status = 'Disposed' WHERE id = ?", h.matter_id);
      vault.log("Outcome recorded", `${niceDate(h.date)}: ${outcome}`, null, null, "Lawyer", h.matter_id);
      if (next && !disposed) addHearing(h.matter_id, next, str(b.next_purpose));
    });
    res.json({
      message: disposed ? "Outcome saved and the matter is marked disposed."
        : next ? `Outcome saved. Next date ${niceDate(next, "%a %-d %b")} is in the diary.` : "Outcome saved.",
    });
  });

  api.post("/hearings/:id/delete", (req, res) => {
    const h = get<Hearing>("SELECT * FROM hearings WHERE id = ?", id(req));
    if (!h) throw new HttpError(404, "That hearing doesn't exist.");
    if (h.outcome) throw new HttpError(400, "This hearing already has an outcome, so it stays in the record.");
    run("DELETE FROM hearings WHERE id = ?", h.id);
    vault.log("Hearing removed", niceDate(h.date), null, null, "Lawyer", h.matter_id);
    res.json({ message: "Removed from the diary." });
  });

  api.post("/hearings/remind", (_req, res) => {
    const due = hearings(`WHERE h.reminder_sent = 0 AND h.outcome = '' AND h.date BETWEEN ? AND ?`,
      isoDate(), isoDate(addDays(today(), 1)));
    transaction(() => {
      for (const h of due) {
        run("UPDATE hearings SET reminder_sent = 1 WHERE id = ?", h.id);
        vault.log("Reminder email sent", `${h.case_number || h.matter_title} on ${niceDate(h.date)}${h.purpose ? ` · ${h.purpose}` : ""}`,
          null, null, "Scheduler", h.matter_id);
      }
    });
    res.json({ message: due.length ? `${due.length} reminder email${due.length > 1 ? "s" : ""} sent.` : "No reminders are due yet." });
  });

  api.get("/deadlines", (_req, res) => {
    res.json({
      open: all<Deadline>(`${DEADLINE_SQL} WHERE d.done = 0 ORDER BY d.due`),
      done: all<Deadline>(`${DEADLINE_SQL} WHERE d.done = 1 ORDER BY d.due DESC LIMIT 10`),
      matters: all<{ id: number; label: string }>(`SELECT m.id, CASE WHEN m.case_number != '' THEN m.case_number || ' · ' || m.title
                                                    ELSE m.title END AS label FROM matters m WHERE m.status = 'Open' ORDER BY label`),
    });
  });

  api.post("/deadlines", (req, res) => {
    const b = req.body ?? {};
    const title = str(b.title);
    const due = str(b.due);
    const matterId = Number(b.matter_id) || null;
    if (!title) throw new HttpError(400, "Say what is due.");
    if (!isValidIsoDate(due)) throw new HttpError(400, "Enter a valid due date.");
    if (matterId) getMatter(matterId);
    run("INSERT INTO deadlines (matter_id, title, due, rule, created_at) VALUES (?, ?, ?, ?, ?)",
      matterId, title, due, str(b.rule), vault.now());
    vault.log("Deadline added", `${title} · due ${niceDate(due)}`, null, null, "Lawyer", matterId);
    res.status(201).json({ message: `Deadline added for ${niceDate(due, "%a %-d %b %Y")}.` });
  });

  api.post("/deadlines/:id/done", (req, res) => {
    const d = get<Deadline>("SELECT * FROM deadlines WHERE id = ?", id(req));
    if (!d) throw new HttpError(404, "That deadline doesn't exist.");
    const done = req.body?.done !== false;
    run("UPDATE deadlines SET done = ? WHERE id = ?", done ? 1 : 0, d.id);
    vault.log(done ? "Deadline done" : "Deadline reopened", d.title, null, null, "Lawyer", d.matter_id);
    res.json({ message: done ? "Marked as done." : "Reopened." });
  });
}
