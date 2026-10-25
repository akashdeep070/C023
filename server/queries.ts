// Read-side queries shared by several routes.

import { accessSync, constants } from "node:fs";
import os from "node:os";
import { addDays, isoDate, today } from "../shared/format.js";
import type { AuditRow, ClientRow, Counts, Invoice, InvoiceLine, InvoiceTotals, Payment, Status } from "../shared/types.js";
import * as ai from "./ai.js";
import { UPLOAD_DIR, all, get, scalar } from "./db.js";

export const INSTANCE = process.env.INSTANCE_NAME
  || (process.env.VERCEL_REGION ? `vercel-${process.env.VERCEL_REGION}` : os.hostname());
const STARTED = Date.now();
export const metrics = { latency: [] as number[], requests: 0, errors: 0 };

export function record(ms: number, status: number) {
  metrics.requests += 1;
  metrics.latency.push(ms);
  if (metrics.latency.length > 2000) metrics.latency.shift();
  if (status >= 500) metrics.errors += 1;
}

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.round((p / 100) * (s.length - 1)))];
}

export function status(): Status {
  const lat = metrics.latency;
  let database = true;
  let storage = true;
  try { scalar("SELECT 1"); } catch { database = false; }
  try { accessSync(UPLOAD_DIR, constants.W_OK); } catch { storage = false; }
  return {
    status: database && storage ? "ok" : "degraded",
    instance: INSTANCE,
    uptime_s: Math.round((Date.now() - STARTED) / 1000),
    requests: metrics.requests,
    errors: metrics.errors,
    error_rate: metrics.requests ? (metrics.errors / metrics.requests) * 100 : 0,
    avg_ms: lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : 0,
    p95_ms: percentile(lat, 95),
    p99_ms: percentile(lat, 99),
    checks: { database, storage },
    ai: { enabled: ai.enabled(), model: ai.textModel(), vision_model: ai.visionModel() },
  };
}

export function invoiceTotals(invoiceId: number): InvoiceTotals | undefined {
  const inv = get<Invoice>("SELECT * FROM invoices WHERE id = ?", invoiceId);
  if (!inv) return undefined;
  const lines = all<InvoiceLine>("SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id", invoiceId);
  const payments = all<Payment>("SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_on", invoiceId);
  const total = lines.reduce((s, l) => s + l.qty * l.rate, 0);
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  const balance = total - inv.retainer - paid;
  const status = balance <= 0 ? "Paid" : inv.due < isoDate() ? "Overdue" : inv.retainer || paid ? "Part paid" : "Unpaid";
  return { inv, lines, payments, total, paid, balance: Math.max(balance, 0), status };
}

export const allInvoices = () =>
  all<{ id: number }>("SELECT id FROM invoices").map((r) => invoiceTotals(r.id)!);

export function clientRows(q = ""): ClientRow[] {
  let sql = `
    SELECT c.*,
      (SELECT COUNT(*) FROM matters m WHERE m.client_id = c.id AND m.status = 'Open') AS matters,
      (SELECT COUNT(*) FROM documents d WHERE d.client_id = c.id) AS docs,
      (SELECT MIN(h.date) FROM hearings h JOIN matters m ON m.id = h.matter_id
         WHERE m.client_id = c.id AND h.date >= ?) AS next_hearing
    FROM clients c`;
  const args: string[] = [isoDate()];
  if (q) {
    sql += ` WHERE c.name LIKE ? OR c.code LIKE ? OR c.lawyer LIKE ? OR c.matter LIKE ?
             OR c.id IN (SELECT client_id FROM matters WHERE case_number LIKE ?)`;
    args.push(...Array(5).fill(`%${q}%`));
  }
  return all<Omit<ClientRow, "balance" | "invoices">>(sql + " ORDER BY c.code", ...args).map((c) => {
    const ids = all<{ id: number }>("SELECT id FROM invoices WHERE client_id = ?", c.id);
    return { ...c, balance: ids.reduce((s, r) => s + invoiceTotals(r.id)!.balance, 0), invoices: ids.length };
  });
}

export function recentActivity(limit = 8, where = "", ...args: (string | number)[]): AuditRow[] {
  return all<AuditRow>(`SELECT a.*, d.title AS doc_title, c.name AS client_name FROM audit a
                        LEFT JOIN documents d ON d.id = a.document_id
                        LEFT JOIN clients c ON c.id = a.client_id
                        ${where} ORDER BY a.ts DESC, a.id DESC LIMIT ?`, ...args, limit);
}

/** Hearings today or tomorrow that still need a reminder. */
export function remindersDue(): number {
  return scalar(`SELECT COUNT(*) FROM hearings WHERE reminder_sent = 0 AND outcome = '' AND date BETWEEN ? AND ?`,
    isoDate(), isoDate(addDays(today(), 1)));
}

export function counts(): Counts {
  const t = isoDate();
  const toConfirm = scalar("SELECT COUNT(*) FROM documents WHERE hearing_date >= ? AND hearing_confirmed = 0", t);
  const unrecorded = scalar("SELECT COUNT(*) FROM hearings WHERE date < ? AND outcome = ''", t);
  const overdue = scalar("SELECT COUNT(*) FROM deadlines WHERE done = 0 AND due < ?", t);
  const reminders = remindersDue();
  return {
    documents: scalar("SELECT COUNT(*) FROM documents"),
    clients: scalar("SELECT COUNT(*) FROM clients"),
    matters: scalar("SELECT COUNT(*) FROM matters WHERE status = 'Open'"),
    today: scalar("SELECT COUNT(*) FROM hearings WHERE date = ?", t),
    to_confirm: toConfirm,
    unrecorded,
    overdue,
    due_week: scalar("SELECT COUNT(*) FROM deadlines WHERE done = 0 AND due BETWEEN ? AND ?", t, isoDate(addDays(today(), 7))),
    reminders,
    alerts: toConfirm + unrecorded + overdue + reminders,
    invoices_due: allInvoices().filter((i) => i.balance > 0).length,
  };
}
