import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { isoDate, niceDate, niceTime, until } from "../../../shared/format";
import type { AuditRow, Doc, InvoiceStatus } from "../../../shared/types";
import { Icon } from "./Icon";

export function PageHead({ eyebrow, title, soft, lede, children }:
  { eyebrow: string; title: ReactNode; soft?: string; lede?: ReactNode; children?: ReactNode }) {
  return (
    <section className="head">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}{soft && <> <span className="soft">{soft}</span></>}</h1>
        {lede && <p className="muted" style={{ marginTop: 8, maxWidth: 620 }}>{lede}</p>}
      </div>
      {children && <div className="head-actions">{children}</div>}
    </section>
  );
}

export function Loading({ error }: { error?: string | null }) {
  return (
    <div className="empty">
      {error ? <><Icon name="alert" size={22} /><p style={{ marginTop: 10 }}>{error}</p></> : <span className="spinner" aria-label="Loading" />}
    </div>
  );
}

export function Crumbs({ parent, to, current }: { parent: string; to: string; current: string }) {
  return <div className="crumbs"><Link to={to}>{parent}</Link><span>/</span><span>{current}</span></div>;
}

// Vercel-style color coding: green = done, amber = needs a person, red = error or risk,
// blue = scheduled or human action, purple = AI. Every color also has a text label.
export type Tone = "green" | "amber" | "red" | "blue" | "purple" | "";

export const docBadge = (status: string) => `badge ${status === "Reviewed" ? "green" : "amber"}`;

const INVOICE_TONE: Record<InvoiceStatus, Tone> = { Paid: "green", "Part paid": "blue", Unpaid: "", Overdue: "red" };
export const invoiceBadge = (status: InvoiceStatus) => `badge ${INVOICE_TONE[status]}`;

const ACTION_TONE: Record<string, Tone> = {
  "Integrity alert": "red", "File overwritten": "red",
  "AI summary": "purple", "Hearing date found": "purple", "Asked the file": "purple",
  "Hearing confirmed": "green", Reviewed: "green", "Integrity verified": "green", Restored: "green", "Payment recorded": "green",
  Uploaded: "blue", "New version": "blue", "Reminder email sent": "blue",
  "Hearing removed": "amber",
};
export const actionTone = (action: string): Tone => ACTION_TONE[action] ?? "";

export function Timeline({ rows, hideDoc = false }: { rows: AuditRow[]; hideDoc?: boolean }) {
  if (!rows.length) return <div className="empty">Nothing yet.</div>;
  return (
    <div className="timeline">
      {rows.map((a) => (
        <div className="ev" key={a.id}>
          <span className={`pin ${actionTone(a.action)}`} />
          <div>
            <div className="what">
              {a.action}
              {!hideDoc && a.doc_title && a.document_id && (
                <> · <Link to={`/documents/${a.document_id}`} className="muted" style={{ fontWeight: 400 }}>{a.doc_title}</Link></>
              )}
              {!hideDoc && !a.document_id && a.client_name && (
                <> · <span className="muted" style={{ fontWeight: 400 }}>{a.client_name}</span></>
              )}
            </div>
            <div className="meta">{a.actor} · {niceTime(a.ts)}{a.detail && ` · ${a.detail}`}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Confirmed hearings ahead are blue, AI suggestions waiting for a person are amber, past ones stay gray. */
export function hearingTone(h: Doc): Tone {
  if (h.hearing_date < isoDate()) return "";
  return h.hearing_confirmed ? "blue" : "amber";
}

export function DateBox({ date, tone = "", small }: { date: string; tone?: Tone; small?: boolean }) {
  return (
    <div className={`datebox${small ? " sm" : ""} ${tone}`}>
      <div className="m">{niceDate(date, "%b")}</div>
      <div className="d">{niceDate(date, "%-d")}</div>
    </div>
  );
}

export function HearingRow({ h }: { h: Doc }) {
  const ahead = h.hearing_date >= isoDate();
  return (
    <Link className="row" to={`/documents/${h.id}`} style={{ gap: 20 }}>
      <DateBox date={h.hearing_date} tone={hearingTone(h)} />
      <div className="grow" style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 500 }}>{h.case_number || h.title}</div>
        <div className="small muted">
          {h.client_name || "No client"} · {h.title}{h.hearing_page ? ` · page ${h.hearing_page}` : ""}
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div className="small">{until(h.hearing_date)}</div>
        {ahead && (
          <div className="small faint">
            {h.hearing_confirmed
              ? (h.reminder_sent ? "Reminder sent" : "Reminder the day before")
              : <span className="text-amber">Open to confirm →</span>}
          </div>
        )}
      </div>
    </Link>
  );
}
