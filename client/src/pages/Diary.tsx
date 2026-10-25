import { Fragment, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { DraftContext } from "../../../shared/drafts";
import { addDays, isoDate, niceDate, parseDate, until } from "../../../shared/format";
import type { Deadline, DiaryData } from "../../../shared/types";
import { api } from "../api";
import { DeadlineLine, Loading, PageHead } from "../components/common";
import { ClientUpdate, MonthCalendar, OutcomeForm, contextFromHearing } from "../components/diary";
import { useFlash } from "../components/Flash";
import { Icon } from "../components/Icon";
import { useApi, useTitle } from "../hooks";

export function Diary() {
  useTitle("Diary");
  const [params, setParams] = useSearchParams();
  const date = params.get("date") || isoDate();
  const [month, setMonth] = useState(date.slice(0, 7));
  const { data, error, reload } = useApi<DiaryData>(`/diary?date=${date}&month=${month}`);
  const [recording, setRecording] = useState<number | null>(null);
  const [update, setUpdate] = useState<{ hearingId: number; ctx: DraftContext } | null>(null);
  const flash = useFlash();

  const go = (d: string) => {
    setParams(d === isoDate() ? {} : { date: d });
    setMonth(d.slice(0, 7));
    setRecording(null);
    setUpdate(null);
  };
  const shift = (n: number) => go(isoDate(addDays(parseDate(date), n)));

  const remind = async () => {
    const r = await api.post("/hearings/remind");
    flash(r.message ?? "Done.");
    reload();
  };
  const toggle = async (d: Deadline) => {
    await api.post(`/deadlines/${d.id}/done`, { done: !d.done });
    reload();
  };

  const isToday = date === isoDate();

  return (
    <>
      <PageHead eyebrow={isToday ? "Today" : until(date)} title={`Diary · ${niceDate(date, "%A, %-d %B %Y")}`}>
        <div className="row wrap-row no-print" style={{ gap: 6 }}>
          <button className="btn ghost sm" onClick={() => shift(-1)} aria-label="Previous day"><Icon name="arrow-left" size={14} /></button>
          {!isToday && <button className="btn ghost sm" onClick={() => go(isoDate())}>Today</button>}
          <input className="input" type="date" value={date} onChange={(e) => e.target.value && go(e.target.value)}
            style={{ height: 34, width: 150, fontSize: 13 }} aria-label="Pick a date" />
          <button className="btn ghost sm" onClick={() => shift(1)} aria-label="Next day"><Icon name="arrow-right" size={14} /></button>
          <button className="btn ghost sm" onClick={() => window.print()}><Icon name="printer" size={14} /> Print</button>
          <button className="btn sm" onClick={remind}>
            <Icon name="bell" size={14} /> Send reminders{data?.due_reminders ? ` (${data.due_reminders})` : ""}
          </button>
        </div>
      </PageHead>

      {!data ? <Loading error={error} /> : (
        <div className="split">
          <div className="stack">
            <div className="card">
              <div className="card-head">
                <div>
                  <h3>Cause list</h3>
                  <div className="small muted" style={{ marginTop: 4 }}>
                    {data.hearings.length ? `${data.hearings.length} matter${data.hearings.length === 1 ? "" : "s"} listed` : "Nothing listed"}
                  </div>
                </div>
              </div>
              {data.hearings.length ? (
                <div className="scroll-x">
                  <table className="table compact causelist">
                    <thead>
                      <tr><th>#</th><th>Case and court</th><th>Listed for</th><th>Previous date</th><th className="r no-print">Outcome</th></tr>
                    </thead>
                    <tbody>
                      {data.hearings.map((h, i) => (
                        <Fragment key={h.id}>
                          <tr>
                            <td className="muted">{i + 1}</td>
                            <td>
                              <Link className="t" to={`/matters/${h.matter_id}`}>{h.case_number || h.matter_title}</Link>
                              <div className="s">{h.matter_title}{h.client_name && ` · for ${h.client_name}`}</div>
                              <div className="s">{h.court || "Court not set"}</div>
                            </td>
                            <td className="small">{h.purpose || "—"}</td>
                            <td className="small">
                              {h.prev_date ? (
                                <>
                                  <div className="nowrap">{niceDate(h.prev_date, "%-d %b")}</div>
                                  <div className={h.prev_outcome ? "muted" : "text-amber"}>{h.prev_outcome || "Outcome not recorded"}</div>
                                </>
                              ) : <span className="muted">First listing</span>}
                            </td>
                            <td className="r no-print">
                              {h.outcome
                                ? <span className="badge green" title={h.outcome}><Icon name="check" size={12} /> Recorded</span>
                                : h.date <= isoDate()
                                  ? <button className="btn sm" onClick={() => { setRecording(h.id); setUpdate(null); }}>Record</button>
                                  : <span className="small muted">{until(h.date)}</span>}
                            </td>
                          </tr>
                          {h.outcome && (
                            <tr className="outcome-row"><td /><td colSpan={4} className="small"><b>Outcome:</b> {h.outcome}</td></tr>
                          )}
                          {recording === h.id && (
                            <tr className="no-print"><td colSpan={5}>
                              <OutcomeForm h={h} onCancel={() => setRecording(null)}
                                onSaved={(outcome, next) => {
                                  setRecording(null);
                                  setUpdate({ hearingId: h.id, ctx: contextFromHearing(h, outcome, next) });
                                  reload();
                                }} />
                            </td></tr>
                          )}
                          {update?.hearingId === h.id && (
                            <tr className="no-print"><td colSpan={5}><ClientUpdate ctx={update.ctx} onClose={() => setUpdate(null)} /></td></tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty">
                  <p>No matters are listed on this day.</p>
                  <Link className="btn ghost sm" style={{ marginTop: 14 }} to="/matters">Add a date from a matter</Link>
                </div>
              )}
            </div>

            {data.deadlines.length > 0 && (
              <div className="card">
                <div className="card-head"><h3>Due this day</h3><span className="badge amber">{data.deadlines.length}</span></div>
                <div className="list">{data.deadlines.map((d) => <DeadlineLine d={d} key={d.id} onToggle={toggle} />)}</div>
              </div>
            )}
          </div>

          <aside className="stack no-print">
            <div className="card">
              <MonthCalendar month={month} marks={data.month} selected={date} onPick={go} onMonth={setMonth} />
            </div>

            {data.unrecorded.length > 0 && (
              <div className="card tone-amber">
                <div className="card-head">
                  <div>
                    <h3>Outcome not recorded</h3>
                    <div className="small muted" style={{ marginTop: 4 }}>Past dates with nothing written down</div>
                  </div>
                  <span className="badge amber">{data.unrecorded.length}</span>
                </div>
                <div className="list">
                  {data.unrecorded.map((h) => (
                    <button className="row link-row" key={h.id} onClick={() => { go(h.date); setRecording(h.id); }}>
                      <div className="grow" style={{ textAlign: "left" }}>
                        <div style={{ fontWeight: 500 }}>{h.case_number || h.matter_title}</div>
                        <div className="small muted">{niceDate(h.date, "%a %-d %b")} · {h.purpose || "Hearing"}</div>
                      </div>
                      <span className="small text-amber nowrap">Record →</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {data.pending.length > 0 && (
              <div className="card">
                <div className="card-head">
                  <div>
                    <h3>Dates found in documents</h3>
                    <div className="small muted" style={{ marginTop: 4 }}>Check each one before it goes in the diary</div>
                  </div>
                </div>
                <div className="list">
                  {data.pending.map((d) => (
                    <Link className="row" to={`/documents/${d.id}`} key={d.id}>
                      <div className="grow">
                        <div style={{ fontWeight: 500 }}>{niceDate(d.hearing_date, "%a %-d %b %Y")}</div>
                        <div className="small muted">{d.case_number || d.title}{d.hearing_page ? ` · page ${d.hearing_page}` : ""}</div>
                      </div>
                      <span className="small text-amber nowrap">Check →</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </div>
      )}
    </>
  );
}
