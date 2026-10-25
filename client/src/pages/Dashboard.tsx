import { Link, useNavigate } from "react-router-dom";
import { filesize, inr, niceDate, strftime, today } from "../../../shared/format";
import type { Dashboard as Data } from "../../../shared/types";
import { api } from "../api";
import { DayBars } from "../components/DayBars";
import { DeadlineLine, HearingLine, Loading, PageHead, Timeline, docBadge } from "../components/common";
import { useFlash } from "../components/Flash";
import { Icon } from "../components/Icon";
import { useApi, useTitle } from "../hooks";

export function Dashboard() {
  useTitle("Overview");
  const { data, error, reload } = useApi<Data>("/dashboard");
  const flash = useFlash();
  const navigate = useNavigate();
  if (!data) return <Loading error={error} />;
  const { kpi, tasks } = data;

  const sendReminders = async () => {
    const r = await api.post("/hearings/remind");
    flash(r.message ?? "Done.");
    reload();
  };
  const toggle = async (id: number, done: boolean) => {
    await api.post(`/deadlines/${id}/done`, { done });
    reload();
  };

  const summary = [
    `${kpi.today} matter${kpi.today === 1 ? "" : "s"} listed today`,
    kpi.overdue ? `${kpi.overdue} deadline${kpi.overdue === 1 ? "" : "s"} overdue` : "",
    kpi.unrecorded ? `${kpi.unrecorded} outcome${kpi.unrecorded === 1 ? "" : "s"} to record` : "",
  ].filter(Boolean).join(" · ");

  return (
    <>
      <PageHead eyebrow={strftime(today(), "%A, %-d %B %Y")} title="Overview" lede={summary}>
        <Link className="btn ghost" to="/upload"><Icon name="upload" size={16} /> Upload</Link>
        <Link className="btn" to="/diary"><Icon name="calendar" size={16} /> Open today's diary</Link>
      </PageHead>

      <div className="grid g4 kpis">
        <Link className="card kpi" to="/diary">
          <div className="kpi-top"><span className="label">Listed today</span><span className="icon-tile blue"><Icon name="scale" size={17} /></span></div>
          <div className="num">{kpi.today}</div>
          <div className="kpi-sub">{kpi.week} in the next 7 days</div>
        </Link>
        <Link className="card kpi" to="/deadlines">
          <div className="kpi-top"><span className="label">Deadlines this week</span><span className="icon-tile amber"><Icon name="hourglass" size={17} /></span></div>
          <div className={`num${kpi.overdue ? " red" : kpi.due_week ? " amber" : ""}`}>{kpi.due_week + kpi.overdue}</div>
          <div className={`kpi-sub${kpi.overdue ? " text-red" : ""}`}>{kpi.overdue ? `${kpi.overdue} overdue` : "None overdue"}</div>
        </Link>
        <Link className="card kpi" to="/diary">
          <div className="kpi-top"><span className="label">Outcomes to record</span><span className="icon-tile amber"><Icon name="edit" size={17} /></span></div>
          <div className={`num${kpi.unrecorded ? " amber" : " green"}`}>{kpi.unrecorded}</div>
          <div className="kpi-sub">Past dates with no note</div>
        </Link>
        <Link className="card kpi" to="/billing">
          <div className="kpi-top"><span className="label">Fees outstanding</span><span className="icon-tile"><Icon name="receipt" size={17} /></span></div>
          <div className={`num${kpi.outstanding ? " amber" : " green"}`}>{inr(kpi.outstanding)}</div>
          <div className="kpi-sub">{kpi.invoices_due} invoice{kpi.invoices_due === 1 ? "" : "s"} unpaid</div>
        </Link>
      </div>

      <div className="panel-grid section">
        <div className="card">
          <div className="card-head">
            <div className="label">Today's cause list</div>
            <Link className="btn quiet sm" to="/diary">Diary <Icon name="arrow-right" size={14} /></Link>
          </div>
          {data.today.length ? (
            <div className="list">
              {data.today.map((h) => (
                <div className="row" key={h.id} style={{ gap: 14, alignItems: "flex-start" }}>
                  <span className="icon-tile blue"><Icon name="scale" size={17} /></span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <Link to={`/matters/${h.matter_id}`} style={{ fontWeight: 500 }}>{h.case_number || h.matter_title}</Link>
                    <div className="small muted">{h.court || "—"} · {h.purpose || "Hearing"}</div>
                    <div className="small" style={{ marginTop: 4 }}>
                      {h.prev_date
                        ? <><span className="muted">Last date {niceDate(h.prev_date, "%-d %b")}: </span>
                            {h.prev_outcome || <span className="text-amber">outcome not recorded</span>}</>
                        : <span className="muted">First listing</span>}
                    </div>
                  </div>
                  {h.outcome
                    ? <span className="badge green">Recorded</span>
                    : <button className="btn ghost sm" onClick={() => navigate("/diary")}>Record</button>}
                </div>
              ))}
            </div>
          ) : <div className="empty">Nothing listed today.</div>}
        </div>

        <div className="card">
          <div className="card-head">
            <div className="label">Needs attention</div>
            <span className={`badge ${tasks.length ? "amber" : "green"}`}>{tasks.length}</span>
          </div>
          {tasks.length ? (
            <div className="list">
              {tasks.map((t) => (
                <div className="row" style={{ gap: 12 }} key={t.title + t.sub}>
                  <span className={`icon-tile ${t.tone}`}><Icon name={t.icon} size={16} /></span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="ellipsis" style={{ fontWeight: 500 }}>{t.title}</div>
                    <div className="small muted ellipsis">{t.sub}</div>
                  </div>
                  {t.action === "remind"
                    ? <button className="btn sm" onClick={sendReminders}>{t.cta}</button>
                    : <button className="btn ghost sm" onClick={() => navigate(t.to!)}>{t.cta}</button>}
                </div>
              ))}
            </div>
          ) : <div className="empty text-green"><Icon name="check-circle" size={22} /><p style={{ marginTop: 10 }}>All clear.</p></div>}
        </div>
      </div>

      <div className="panel-grid section">
        <div className="card chart-card">
          <div className="card-head">
            <div>
              <div className="label">Hearings · next 14 days</div>
              <div className="small muted" style={{ marginTop: 8 }}>Plan your week around the busy days</div>
            </div>
          </div>
          <DayBars data={data.load} unit="hearing" label="Bar chart of hearings listed on each of the next 14 days" />
          {data.upcoming.length > 0 && (
            <div className="list" style={{ marginTop: 22 }}>
              {data.upcoming.slice(0, 4).map((h) => <HearingLine h={h} key={h.id} small />)}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <div className="label">Deadlines</div>
            <Link className="btn quiet sm" to="/deadlines">All <Icon name="arrow-right" size={14} /></Link>
          </div>
          {data.deadlines.length
            ? <div className="list">{data.deadlines.map((d) => <DeadlineLine d={d} key={d.id} onToggle={(x) => toggle(x.id, !x.done)} />)}</div>
            : <div className="empty">Nothing due this week.</div>}
        </div>
      </div>

      <div className="panel-grid section">
        <div className="card">
          <div className="card-head">
            <div className="label">Recent documents</div>
            <Link className="btn quiet sm" to="/documents">All <Icon name="arrow-right" size={14} /></Link>
          </div>
          <div className="scroll-x">
            <table className="table compact stack-sm">
              <thead><tr><th>Document</th><th>Client</th><th>Status</th><th className="r">Added</th></tr></thead>
              <tbody>
                {data.recent.map((d) => (
                  <tr className="link" key={d.id} onClick={() => navigate(`/documents/${d.id}`)}>
                    <td>
                      <Link className="t" to={`/documents/${d.id}`}>{d.title}</Link>
                      <div className="s">{d.doc_type} · {d.case_number || "No case"} · {filesize(d.size)}</div>
                    </td>
                    <td className="muted">{d.client_name || "—"}</td>
                    <td><span className={docBadge(d.status)}>{d.status}</span></td>
                    <td className="r small muted nowrap">{niceDate(d.created_at, "%-d %b")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><div className="label">Recent activity</div></div>
          <Timeline rows={data.activity} />
        </div>
      </div>
    </>
  );
}
