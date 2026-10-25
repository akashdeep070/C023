import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { daysFromToday, isoDate, niceDate, niceTime, until } from "../../../shared/format";
import type { AuditRow, Deadline, Hearing, InvoiceStatus } from "../../../shared/types";
import { Icon } from "./Icon";

export function PageHead({ eyebrow, title, lede, children }:
  { eyebrow?: string; title: ReactNode; lede?: ReactNode; children?: ReactNode }) {
  return (
    <section className="head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {lede && <p className="muted" style={{ marginTop: 8, maxWidth: 620 }}>{lede}</p>}
      </div>
      {children && <div className="head-actions">{children}</div>}
    </section>
  );
}

const SKELETON = [[38, 72], [90, 64, 82, 48]]; // bar widths in %, one array per plate

export function Loading({ error }: { error?: string | null }) {
  if (error) return <div className="empty" role="status"><Icon name="alert" size={22} /><p style={{ marginTop: 10 }}>{error}</p></div>;
  return (
    <div className="skeleton" role="status" aria-label="Loading">
      {SKELETON.map((bars, p) => (
        <div className="sk-plate" key={p} aria-hidden="true">
          {bars.map((w, i) => <div className="sk-line" key={i}><i style={{ width: `${w}%`, animationDelay: `${-1 - i * 0.3}s` }} /></div>)}
        </div>
      ))}
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
  "Outcome recorded": "green", "Deadline done": "green",
  Uploaded: "blue", "New version": "blue", "Reminder email sent": "blue", "Hearing listed": "blue", "Matter opened": "blue", "Draft created": "blue",
  "Hearing removed": "amber", "Deadline added": "amber", "Deadline reopened": "amber",
};
export const actionTone = (action: string): Tone => ACTION_TONE[action] ?? "";

/** Amber while a draft still has blanks to fill, green when it is ready. */
export function blanksBadge(n: number) {
  return n ? <span className="badge amber">{n} blank{n === 1 ? "" : "s"} left</span>
    : <span className="badge green"><Icon name="check" size={12} /> Ready</span>;
}

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

/** Upcoming hearings are blue; past ones stay gray. */
export const hearingTone = (date: string): Tone => (date >= isoDate() ? "blue" : "");

/** Overdue deadlines are red, ones due within a week amber. */
export function deadlineTone(d: Deadline): Tone {
  if (d.done) return "green";
  const n = daysFromToday(d.due);
  return n < 0 ? "red" : n <= 7 ? "amber" : "";
}

export function DateBox({ date, tone = "", small }: { date: string; tone?: Tone; small?: boolean }) {
  return (
    <div className={`datebox${small ? " sm" : ""} ${tone}`}>
      <div className="m">{niceDate(date, "%b")}</div>
      <div className="d">{niceDate(date, "%-d")}</div>
    </div>
  );
}

/** One listed hearing: date, case, purpose and what happened last time. */
export function HearingLine({ h, small }: { h: Hearing; small?: boolean }) {
  return (
    <Link className="row" to={`/matters/${h.matter_id}`} style={{ gap: 14 }}>
      <DateBox date={h.date} tone={hearingTone(h.date)} small={small} />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="ellipsis" style={{ fontWeight: 500 }}>{h.case_number || h.matter_title}</div>
        <div className="small muted ellipsis">
          {h.purpose || "Hearing"} · {h.client_name || h.matter_title}
        </div>
      </div>
      <div className="small muted nowrap">{until(h.date)}</div>
    </Link>
  );
}

export function DeadlineLine({ d, onToggle }: { d: Deadline; onToggle?: (d: Deadline) => void }) {
  const tone = deadlineTone(d);
  return (
    <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
      {onToggle && (
        <input type="checkbox" className="tick" checked={Boolean(d.done)} onChange={() => onToggle(d)}
          aria-label={d.done ? "Mark as not done" : "Mark as done"} />
      )}
      <div className="grow" style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 500, textDecoration: d.done ? "line-through" : undefined }}>{d.title}</div>
        <div className="small muted">
          {d.matter_id ? <Link to={`/matters/${d.matter_id}`}>{d.case_number || d.matter_title}</Link> : "No matter"}
          {d.rule && ` · ${d.rule}`}
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <span className={`badge ${tone}`}>{niceDate(d.due, "%-d %b")}</span>
        {!d.done && <div className={`small ${tone ? `text-${tone}` : "muted"}`} style={{ marginTop: 4 }}>{until(d.due)}</div>}
      </div>
    </div>
  );
}
