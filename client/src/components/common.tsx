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

export const docBadge = (status: string) => `badge${status === "Reviewed" ? " solid" : ""}`;
export const invoiceBadge = (status: InvoiceStatus) =>
  `badge${status === "Overdue" ? " solid" : status === "Paid" ? " line" : ""}`;

const ALERTS = ["Integrity alert", "File overwritten"];
const AUTO = ["Automation", "Scheduler"];

export function Timeline({ rows, hideDoc = false }: { rows: AuditRow[]; hideDoc?: boolean }) {
  if (!rows.length) return <div className="empty">Nothing yet.</div>;
  return (
    <div className="timeline">
      {rows.map((a) => (
        <div className="ev" key={a.id}>
          <span className={`pin${ALERTS.includes(a.action) ? " alert" : AUTO.includes(a.actor) ? " auto" : ""}`} />
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

export function DateBox({ date, ink, small }: { date: string; ink?: boolean; small?: boolean }) {
  return (
    <div className={`datebox${small ? " sm" : ""}${ink ? " ink" : ""}`}>
      <div className="m">{niceDate(date, "%b")}</div>
      <div className="d">{niceDate(date, "%-d")}</div>
    </div>
  );
}

export function HearingRow({ h }: { h: Doc }) {
  const ahead = h.hearing_date >= isoDate();
  return (
    <Link className="row" to={`/documents/${h.id}`} style={{ gap: 20 }}>
      <DateBox date={h.hearing_date} ink={Boolean(h.hearing_confirmed) && ahead} />
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
            {h.hearing_confirmed ? (h.reminder_sent ? "Reminder sent" : "Reminder the day before") : "Open to confirm →"}
          </div>
        )}
      </div>
    </Link>
  );
}
