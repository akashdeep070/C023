// Pieces of the case diary used on several pages: recording what happened at a
// hearing, telling the client, drafting, and the month calendar.

import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { clientUpdate, whatsappLink, type DraftContext } from "../../../shared/drafts";
import { addDays, isoDate, niceDate, niceTime, parseDate, strftime } from "../../../shared/format";
import { templateById } from "../../../shared/templates";
import type { Client, DraftRow, Hearing, Matter } from "../../../shared/types";
import { api } from "../api";
import { useApi } from "../hooks";
import { blanksBadge } from "./common";
import { useFlash } from "./Flash";
import { Icon } from "./Icon";

const QUICK_OUTCOMES = ["Adjourned at the request of the other side", "Adjourned, court did not take up the matter",
  "Arguments heard", "Evidence recorded", "Order reserved", "Disposed of"];

/** Build draft context from a hearing row, which already carries its matter and client. */
export function contextFromHearing(h: Hearing, outcome: string, next: { date: string; purpose: string } | null): DraftContext {
  const matter = { id: h.matter_id, client_id: h.client_id, case_number: h.case_number, title: h.matter_title, court: h.court,
    our_side: "", stage: h.stage, opposite_party: "", opposite_counsel: "", status: "Open", created_at: "" } as Matter;
  const client = h.client_name ? ({ name: h.client_name, phone: h.client_phone ?? "", lawyer: "" } as Client) : null;
  return {
    matter, client, today: isoDate(),
    last: { ...h, outcome },
    next: next?.date ? ({ ...h, date: next.date, purpose: next.purpose, outcome: "" } as Hearing) : null,
  };
}

/** After a hearing: what happened, and the next date. */
export function OutcomeForm({ h, onSaved, onCancel }:
  { h: Hearing; onSaved: (outcome: string, next: { date: string; purpose: string } | null) => void; onCancel: () => void }) {
  const [outcome, setOutcome] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [nextPurpose, setNextPurpose] = useState(h.purpose);
  const [stage, setStage] = useState(h.stage);
  const [notes, setNotes] = useState("");
  const [disposed, setDisposed] = useState(false);
  const [busy, setBusy] = useState(false);
  const flash = useFlash();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post(`/hearings/${h.id}/outcome`, {
        outcome, notes, stage, disposed, next_date: disposed ? "" : nextDate, next_purpose: nextPurpose,
      });
      flash(r.message ?? "Saved.");
      onSaved(outcome, disposed || !nextDate ? null : { date: nextDate, purpose: nextPurpose });
    } catch (err) {
      flash((err as Error).message, "error");
      setBusy(false);
    }
  };

  return (
    <form className="outcome" onSubmit={submit}>
      <label className="field">
        <span>What happened on {niceDate(h.date, "%-d %b")}</span>
        <textarea className="input" rows={2} value={outcome} onChange={(e) => setOutcome(e.target.value)} required
          placeholder="e.g. Arguments heard in part. Defendant sought time to file written statement." autoFocus />
      </label>
      <div className="suggest" style={{ marginTop: 0 }}>
        {QUICK_OUTCOMES.map((q) => (
          <button type="button" key={q} onClick={() => { setOutcome(q); if (q === "Disposed of") setDisposed(true); }}>{q}</button>
        ))}
      </div>
      <div className="grid g3" style={{ gap: 14 }}>
        <label className="field">
          <span>Next date</span>
          <input className="input" type="date" value={nextDate} min={isoDate(addDays(parseDate(h.date), 1))}
            onChange={(e) => setNextDate(e.target.value)} disabled={disposed} />
        </label>
        <label className="field">
          <span>Listed for</span>
          <input className="input" value={nextPurpose} onChange={(e) => setNextPurpose(e.target.value)} disabled={disposed}
            placeholder="e.g. Evidence" />
        </label>
        <label className="field">
          <span>Stage</span>
          <input className="input" value={stage} onChange={(e) => setStage(e.target.value)} placeholder="e.g. Evidence" />
        </label>
      </div>
      <label className="field">
        <span>Notes for the file (optional)</span>
        <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Who appeared, directions given, documents to bring" />
      </label>
      <div className="row wrap-row between">
        <label className="row small" style={{ gap: 8 }}>
          <input type="checkbox" className="tick" checked={disposed} onChange={(e) => setDisposed(e.target.checked)} />
          Matter disposed
        </label>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn ghost sm" onClick={onCancel}>Cancel</button>
          <button className="btn sm" disabled={busy}><Icon name="check" size={14} /> Save</button>
        </div>
      </div>
    </form>
  );
}

/** The message to send the client after a hearing, ready for WhatsApp or SMS. */
export function ClientUpdate({ ctx, onClose }: { ctx: DraftContext; onClose: () => void }) {
  const [text, setText] = useState(() => clientUpdate(ctx));
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); }
  };
  return (
    <div className="client-update">
      <div className="row between" style={{ marginBottom: 10 }}>
        <div className="label text-green">Tell {ctx.client?.name ?? "the client"}</div>
        <button className="btn quiet sm" onClick={onClose} aria-label="Close"><Icon name="x" size={14} /></button>
      </div>
      <textarea className="input" rows={7} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row wrap-row" style={{ gap: 8, marginTop: 10 }}>
        <a className="btn sm" href={whatsappLink(ctx.client?.phone, text)} target="_blank" rel="noreferrer">
          <Icon name="send" size={14} /> Send on WhatsApp
        </a>
        <button className="btn ghost sm" onClick={copy}><Icon name="copy" size={14} /> {copied ? "Copied" : "Copy"}</button>
      </div>
    </div>
  );
}

const QUICK_TEMPLATES = ["adjournment", "s138-notice", "file-note"];

/** A matter's documents in the editor, quick starts from the usual templates, and the client message. */
export function DraftsPanel({ ctx }: { ctx: DraftContext }) {
  const { data: drafts } = useApi<DraftRow[]>(`/drafts?matter=${ctx.matter.id}`);
  const [text, setText] = useState(() => clientUpdate(ctx));
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const flash = useFlash();
  const start = async (templateId: string) => {
    setBusy(true);
    try {
      const r = await api.post<{ id: number }>("/drafts", { template_id: templateId, matter_id: ctx.matter.id });
      navigate(`/drafts/${r.id}`);
    } catch (err) {
      flash((err as Error).message, "error");
      setBusy(false);
    }
  };
  return (
    <div className="stack" style={{ gap: 16 }}>
      {drafts?.length ? (
        <div className="list">
          {drafts.map((d) => (
            <Link className="row" to={`/drafts/${d.id}`} key={d.id} style={{ gap: 14 }}>
              <span className="icon-tile blue"><Icon name="file-pen" size={17} /></span>
              <div className="grow">
                <div style={{ fontWeight: 500 }}>{d.title}</div>
                <div className="small muted">Edited {niceTime(d.updated_at)}</div>
              </div>
              {blanksBadge(d.blanks)}
            </Link>
          ))}
        </div>
      ) : null}
      <div className="row wrap-row" style={{ gap: 8 }}>
        {QUICK_TEMPLATES.map((id) => (
          <button className="btn ghost sm" key={id} disabled={busy} onClick={() => start(id)}>
            <Icon name="plus" size={14} /> {templateById(id)!.name}
          </button>
        ))}
        <Link className="btn quiet sm" to={`/drafts?matter=${ctx.matter.id}`}>All templates →</Link>
      </div>
      <div className="divider" style={{ margin: "8px 0" }} />
      <div className="label">Message to the client</div>
      <textarea className="input draft" rows={9} value={text} onChange={(e) => setText(e.target.value)} aria-label="Message to the client" />
      <div className="row wrap-row" style={{ gap: 8 }}>
        <a className="btn sm" href={whatsappLink(ctx.client?.phone, text)} target="_blank" rel="noreferrer">
          <Icon name="send" size={14} /> Send on WhatsApp
        </a>
        <button className="btn ghost sm" onClick={async () => {
          try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); }
        }}><Icon name="copy" size={14} /> {copied ? "Copied" : "Copy"}</button>
      </div>
    </div>
  );
}

/** A Monday-first month grid. Days with hearings are blue; days with deadlines get an amber dot. */
export function MonthCalendar({ month, marks, selected, onPick, onMonth }: {
  month: string; // YYYY-MM
  marks: { date: string; hearings: number; deadlines: number }[];
  selected: string;
  onPick: (date: string) => void;
  onMonth: (month: string) => void;
}) {
  const first = parseDate(`${month}-01`);
  const start = addDays(first, -((first.getDay() + 6) % 7));
  const weeks = Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, i) => addDays(start, w * 7 + i)));
  const shown = weeks[5][0].getMonth() !== first.getMonth() ? weeks.slice(0, 5) : weeks;
  const byDate = new Map(marks.map((m) => [m.date, m]));
  const shift = (n: number) => onMonth(isoDate(new Date(first.getFullYear(), first.getMonth() + n, 1)).slice(0, 7));
  const todayIso = isoDate();

  return (
    <div>
      <div className="row between" style={{ marginBottom: 16 }}>
        <h3>{strftime(first, "%B %Y")}</h3>
        <div className="row" style={{ gap: 4 }}>
          <button className="btn quiet sm" onClick={() => shift(-1)} aria-label="Previous month"><Icon name="arrow-left" size={14} /></button>
          <button className="btn quiet sm" onClick={() => shift(1)} aria-label="Next month"><Icon name="arrow-right" size={14} /></button>
        </div>
      </div>
      <div className="cal">
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => <div className="dow" key={d}>{d}</div>)}
        {shown.flat().map((d) => {
          const iso = isoDate(d);
          const m = byDate.get(iso);
          const cls = ["day", "pick", d.getMonth() !== first.getMonth() && "out", iso === todayIso && "today",
            m?.hearings && "has", iso === selected && "selected"].filter(Boolean).join(" ");
          return (
            <button className={cls} key={iso} onClick={() => onPick(iso)}
              title={m ? `${m.hearings} hearing(s), ${m.deadlines} deadline(s)` : undefined}>
              {d.getDate()}
              {m?.deadlines ? <i className="due-dot" /> : null}
            </button>
          );
        })}
      </div>
      <div className="legend label" style={{ marginTop: 16 }}>
        <span><i className="blue" />Hearings</span>
        <span><i className="dot-amber" />Deadline</span>
      </div>
    </div>
  );
}
