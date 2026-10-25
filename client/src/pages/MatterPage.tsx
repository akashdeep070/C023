import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { inr, isoDate, niceDate, until } from "../../../shared/format";
import type { Deadline, MatterDetail } from "../../../shared/types";
import { api } from "../api";
import { Crumbs, DateBox, DeadlineLine, Loading, Timeline, docBadge, hearingTone, invoiceBadge } from "../components/common";
import { ClientUpdate, DraftsPanel, OutcomeForm, contextFromHearing } from "../components/diary";
import { useFlash } from "../components/Flash";
import { Icon } from "../components/Icon";
import { useApi, useTitle } from "../hooks";
import type { DraftContext } from "../../../shared/drafts";

export function MatterPage() {
  const { id } = useParams();
  const { data, error, reload } = useApi<MatterDetail>(`/matters/${id}`);
  const [recording, setRecording] = useState<number | null>(null);
  const [update, setUpdate] = useState<DraftContext | null>(null);
  const [editing, setEditing] = useState(false);
  const flash = useFlash();
  useTitle(data ? (data.matter.case_number || data.matter.title) : "Matter");

  if (!data) return <Loading error={error} />;
  const { matter: m, client, hearings, docs, deadlines, invoices } = data;
  const todayIso = isoDate();
  const next = [...hearings].reverse().find((h) => h.date >= todayIso) ?? null;
  const last = hearings.find((h) => h.date < todayIso && h.outcome) ?? null;
  const draftCtx: DraftContext = { matter: m, client, last, next, today: todayIso };

  const post = async (path: string, body: unknown, form?: HTMLFormElement) => {
    try {
      const r = await api.post(path, body);
      flash(r.message ?? "Saved.");
      form?.reset();
      reload();
      return true;
    } catch (err) {
      flash((err as Error).message, "error");
      return false;
    }
  };
  const addDate = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    post(`/matters/${id}/hearings`, Object.fromEntries(new FormData(e.currentTarget)), e.currentTarget);
  };
  const addDeadline = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    post("/deadlines", { ...Object.fromEntries(new FormData(e.currentTarget)), matter_id: m.id }, e.currentTarget);
  };
  const saveDetails = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (await post(`/matters/${id}`, Object.fromEntries(new FormData(e.currentTarget)))) setEditing(false);
  };
  const toggle = (d: Deadline) => post(`/deadlines/${d.id}/done`, { done: !d.done });

  return (
    <>
      <Crumbs parent="Matters" to="/matters" current={m.case_number || m.title} />
      <section className="head">
        <div>
          <div className="eyebrow">{m.court || "Not in court"}</div>
          <h1>{m.case_number ? `${m.case_number} · ${m.title}` : m.title}</h1>
          <div className="row wrap-row" style={{ marginTop: 14, gap: 8 }}>
            <span className={`badge ${m.status === "Open" ? "blue" : ""}`}>{m.status}</span>
            {m.stage && <span className="badge line">Stage: {m.stage}</span>}
            {client && <Link className="badge line" to={`/clients/${client.id}`}><Icon name="user" size={13} /> {client.name}{m.our_side && ` · ${m.our_side}`}</Link>}
            {m.opposite_party && <span className="badge line">Against {m.opposite_party}{m.opposite_counsel && ` (${m.opposite_counsel})`}</span>}
          </div>
        </div>
        <div className="head-actions">
          <Link className="btn ghost" to={`/upload?matter=${m.id}`}><Icon name="upload" size={16} /> Upload</Link>
          <button className="btn ghost" onClick={() => setEditing((x) => !x)}><Icon name="edit" size={16} /> Edit</button>
          <button className="btn ghost" onClick={() => post(`/matters/${id}`, { status: m.status === "Open" ? "Disposed" : "Open" })}>
            {m.status === "Open" ? "Mark disposed" : "Reopen"}
          </button>
        </div>
      </section>

      {editing && (
        <form className="card" style={{ marginBottom: 20 }} onSubmit={saveDetails}>
          <div className="grid g3" style={{ gap: 16 }}>
            {([["case_number", "Case number"], ["title", "Title"], ["court", "Court"], ["stage", "Stage"],
              ["our_side", "We act for the"], ["opposite_party", "Opposite party"], ["opposite_counsel", "Opposite counsel"]] as const).map(([f, label]) => (
              <label className="field" key={f}><span>{label}</span><input className="input" name={f} defaultValue={m[f]} /></label>
            ))}
          </div>
          <div className="row" style={{ gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
            <button type="button" className="btn ghost sm" onClick={() => setEditing(false)}>Cancel</button>
            <button className="btn sm">Save</button>
          </div>
        </form>
      )}

      <div className="split">
        <div className="stack">
          <div className="card">
            <div className="card-head">
              <div>
                <h3>Hearings</h3>
                <div className="small muted" style={{ marginTop: 4 }}>
                  {next ? `Next: ${niceDate(next.date, "%a %-d %b %Y")}${next.purpose ? `, ${next.purpose}` : ""}` : "No next date fixed"}
                </div>
              </div>
            </div>
            {m.status === "Open" && (
              <form className="row wrap-row" style={{ gap: 8, marginBottom: 20 }} onSubmit={addDate}>
                <input className="input" type="date" name="date" required style={{ width: 170 }} aria-label="Hearing date" />
                <input className="input grow" name="purpose" placeholder="Listed for, e.g. Framing of issues" style={{ minWidth: 200 }} />
                <button className="btn ghost"><Icon name="plus" size={15} /> Add date</button>
              </form>
            )}
            {update && <div style={{ marginBottom: 16 }}><ClientUpdate ctx={update} onClose={() => setUpdate(null)} /></div>}
            {hearings.length ? (
              <div className="list">
                {hearings.map((h) => (
                  <div key={h.id}>
                    <div className="row" style={{ gap: 14, alignItems: "flex-start" }}>
                      <DateBox date={h.date} tone={hearingTone(h.date)} small />
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 500 }}>{h.purpose || "Hearing"}</div>
                        <div className="small" style={{ marginTop: 2 }}>
                          {h.outcome ? <span className="muted">{h.outcome}</span>
                            : h.date < todayIso ? <span className="text-amber">Outcome not recorded</span>
                              : <span className="muted">{until(h.date)}{h.reminder_sent ? " · reminder sent" : ""}</span>}
                        </div>
                        {h.notes && <div className="small faint" style={{ marginTop: 2 }}>Note: {h.notes}</div>}
                      </div>
                      {!h.outcome && h.date <= todayIso && recording !== h.id && (
                        <button className="btn sm" onClick={() => { setRecording(h.id); setUpdate(null); }}>Record</button>
                      )}
                      {!h.outcome && h.date > todayIso && (
                        <button className="btn quiet sm" onClick={() => post(`/hearings/${h.id}/delete`, {})}>Remove</button>
                      )}
                    </div>
                    {recording === h.id && (
                      <div style={{ marginTop: 14 }}>
                        <OutcomeForm h={h} onCancel={() => setRecording(null)} onSaved={(outcome, nextDate) => {
                          setRecording(null);
                          setUpdate({ ...contextFromHearing(h, outcome, nextDate), matter: m, client });
                          reload();
                        }} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : <div className="empty">No hearings yet.</div>}
          </div>

          <div className="card">
            <div className="card-head"><h3>Drafts</h3></div>
            <DraftsPanel ctx={draftCtx} key={`${m.id}-${hearings.length}`} />
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Documents</h3>
              <Link className="btn quiet sm" to={`/upload?matter=${m.id}`}><Icon name="plus" size={14} /> Upload</Link>
            </div>
            {docs.length ? (
              <div className="list">
                {docs.map((d) => (
                  <Link className="row" to={`/documents/${d.id}`} key={d.id} style={{ gap: 14 }}>
                    <span className="icon-tile"><Icon name="file" size={17} /></span>
                    <div className="grow">
                      <div style={{ fontWeight: 500 }}>{d.title}</div>
                      <div className="small muted">{d.doc_type} · {niceDate(d.created_at)}</div>
                    </div>
                    <span className={docBadge(d.status)}>{d.status}</span>
                  </Link>
                ))}
              </div>
            ) : <div className="empty">No documents filed under this matter.</div>}
          </div>
        </div>

        <aside className="stack">
          <div className="card">
            <div className="card-head">
              <h3>Deadlines</h3>
              <Link className="btn quiet sm" to={`/deadlines?matter=${m.id}`}><Icon name="hourglass" size={14} /> Calculate</Link>
            </div>
            {deadlines.length ? (
              <div className="list" style={{ marginBottom: 16 }}>{deadlines.map((d) => <DeadlineLine d={d} key={d.id} onToggle={toggle} />)}</div>
            ) : <p className="small muted" style={{ marginBottom: 16 }}>Nothing due.</p>}
            <form className="stack" style={{ gap: 8 }} onSubmit={addDeadline}>
              <input className="input" name="title" placeholder="What is due, e.g. File rejoinder" required />
              <div className="row" style={{ gap: 8 }}>
                <input className="input grow" type="date" name="due" required aria-label="Due date" />
                <button className="btn ghost">Add</button>
              </div>
            </form>
          </div>

          {client && (
            <div className="card">
              <div className="card-head"><h3>Client</h3></div>
              <dl className="kv" style={{ margin: 0, gridTemplateColumns: "90px 1fr" }}>
                <dt>Name</dt><dd><Link to={`/clients/${client.id}`}>{client.name}</Link></dd>
                <dt>Phone</dt><dd>{client.phone || "—"}</dd>
                <dt>Email</dt><dd>{client.email || "—"}</dd>
                <dt>Lawyer</dt><dd>{client.lawyer || "—"}</dd>
              </dl>
            </div>
          )}

          <div className="card">
            <div className="card-head">
              <h3>Fees</h3>
              {client && <Link className="btn quiet sm" to={`/billing/new?client=${client.id}`}><Icon name="plus" size={14} /> Invoice</Link>}
            </div>
            {invoices.length ? (
              <div className="list">
                {invoices.map((t) => (
                  <Link className="row" to={`/billing/${t.inv.id}`} key={t.inv.id}>
                    <div className="grow"><div className="mono" style={{ fontWeight: 500 }}>{t.inv.number}</div>
                      <div className="small muted">Due {niceDate(t.inv.due)}</div></div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontWeight: 500 }}>{inr(t.balance)}</div>
                      <span className={invoiceBadge(t.status)}>{t.status}</span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : <p className="small muted">No invoices for this matter.</p>}
          </div>

          <div className="card">
            <div className="label" style={{ marginBottom: 18 }}>Activity</div>
            <Timeline rows={data.activity} />
          </div>
        </aside>
      </div>
    </>
  );
}
