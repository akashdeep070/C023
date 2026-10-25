import { Link, useNavigate } from "react-router-dom";
import { inr, niceDate, strftime, today, until, filesize } from "../../../shared/format";
import type { Dashboard as Data } from "../../../shared/types";
import { api } from "../api";
import { ActivityChart } from "../components/ActivityChart";
import { DateBox, Loading, PageHead, Timeline, docBadge, hearingTone } from "../components/common";
import { useFlash } from "../components/Flash";
import { HeroBanner } from "../components/Illustration";
import { Icon } from "../components/Icon";
import { useApi, useTitle } from "../hooks";

// Each kind of task gets the color of the work it needs
const TASK_TONE: Record<string, string> = { calendar: "amber", bell: "blue", sparkles: "purple", receipt: "red" };

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function Dashboard() {
  useTitle("Overview");
  const { data, error, reload } = useApi<Data>("/dashboard");
  const flash = useFlash();
  const navigate = useNavigate();
  if (!data) return <Loading error={error} />;
  const { kpi, tasks, health, chart } = data;

  const sendReminders = async () => {
    const r = await api.post("/hearings/remind");
    flash(r.message ?? "Done.");
    reload();
  };

  const up = health.uptime_s;
  // [label, value, tone of the status dot]
  const healthRows: [string, string, "green" | "amber" | "red"][] = [
    ["Instance", health.instance, "green"],
    ["Uptime", `${Math.floor(up / 3600)}h ${String(Math.floor((up % 3600) / 60)).padStart(2, "0")}m`, "green"],
    ["Response P95", `${health.p95_ms.toFixed(0)} ms`, health.p95_ms < 2000 ? "green" : "red"],
    ["Error rate", `${health.error_rate.toFixed(2)}%`, health.error_rate < 1 ? "green" : "red"],
    ["Database", health.checks.database ? "Connected" : "Down", health.checks.database ? "green" : "red"],
    ["File storage", health.checks.storage ? "Writable" : "Read-only", health.checks.storage ? "green" : "red"],
    ["AI engine", health.ai.enabled ? `Groq · ${health.ai.model.split("/").pop()}` : "Local reader", health.ai.enabled ? "green" : "amber"],
  ];

  return (
    <>
      <PageHead eyebrow={strftime(today(), "%A, %-d %B %Y")} title={`${greeting()}, Adv. Mehta.`}
        lede={tasks.length
          ? `${tasks.length} item${tasks.length === 1 ? " needs" : "s need"} your attention today.`
          : "Nothing needs your attention. Every file is safe."}>
        <Link className="btn ghost" to="/billing/new"><Icon name="receipt" size={16} /> New invoice</Link>
        <Link className="btn" to="/upload"><Icon name="upload" size={16} /> Upload file</Link>
      </PageHead>

      <HeroBanner />

      <div className="grid g4 kpis">
        <Link className="card kpi" to="/documents">
          <div className="kpi-top"><span className="label">Documents</span><span className="icon-tile blue"><Icon name="file" size={17} /></span></div>
          <div className="num">{kpi.documents}</div>
          <div className="kpi-sub"><span className="delta"><Icon name="trending" size={13} /> {kpi.new_week}</span> added this week</div>
        </Link>
        <Link className="card kpi" to="/hearings">
          <div className="kpi-top"><span className="label">Hearings · 14 days</span><span className="icon-tile blue"><Icon name="calendar" size={17} /></span></div>
          <div className="num">{kpi.hearings_14}</div>
          <div className="kpi-sub">
            {kpi.next_hearing ? `Next ${niceDate(kpi.next_hearing, "%-d %b")} · ${until(kpi.next_hearing).toLowerCase()}` : "None scheduled"}
          </div>
        </Link>
        <Link className="card kpi" to="/documents">
          <div className="kpi-top"><span className="label">Awaiting review</span><span className="icon-tile purple"><Icon name="sparkles" size={17} /></span></div>
          <div className={`num${kpi.review ? " amber" : ""}`}>{kpi.review}</div>
          <div className="kpi-sub">AI summaries to check</div>
        </Link>
        <Link className="card kpi" to="/billing">
          <div className="kpi-top"><span className="label">Outstanding</span><span className="icon-tile amber"><Icon name="receipt" size={17} /></span></div>
          <div className={`num${kpi.outstanding ? " amber" : " green"}`}>{inr(kpi.outstanding)}</div>
          <div className="kpi-sub">{kpi.invoices_due} invoice{kpi.invoices_due === 1 ? "" : "s"} unpaid</div>
        </Link>
      </div>

      <div className="panel-grid section">
        <div className="card chart-card">
          <div className="card-head">
            <div>
              <div className="label">Activity · last 14 days</div>
              <div className="row" style={{ gap: 10, marginTop: 10, alignItems: "baseline" }}>
                <span style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-.04em", lineHeight: 1 }}>
                  {chart.reduce((s, c) => s + c.count, 0)}
                </span>
                <span className="small muted">actions logged</span>
              </div>
            </div>
            <Link className="btn quiet sm" to="/activity">Audit log <Icon name="arrow-right" size={14} /></Link>
          </div>
          <ActivityChart data={chart} />
        </div>

        <div className="card">
          <div className="card-head">
            <div className="label">System health</div>
            <span className={`badge ${health.status === "ok" ? "green" : "red"}`}>
              <span className="dot" />{health.status === "ok" ? "Operational" : "Degraded"}
            </span>
          </div>
          <div className="health">
            {healthRows.map(([k, v, tone]) => (
              <div className="hrow" key={k}>
                <span className={`pulse ${tone}`} />
                <span className="muted">{k}</span>
                <span className="mono hval">{v}</span>
              </div>
            ))}
          </div>
          <Link className="btn ghost sm block" style={{ marginTop: 20 }} to="/status">Open SLA dashboard</Link>
        </div>
      </div>

      <div className="panel-grid section">
        <div className="card">
          <div className="card-head">
            <div className="label">Needs attention</div>
            <span className={`badge ${tasks.length ? "amber" : "green"}`}>{tasks.length}</span>
          </div>
          {tasks.length ? (
            <div className="list">
              {tasks.map((t) => (
                <div className="row" style={{ gap: 14 }} key={t.title}>
                  <span className={`icon-tile ${TASK_TONE[t.icon] ?? ""}`}><Icon name={t.icon} size={17} /></span>
                  <div className="grow">
                    <div className="ellipsis" style={{ fontWeight: 500 }}>{t.title}</div>
                    <div className="small muted">{t.sub}</div>
                  </div>
                  {t.action === "remind"
                    ? <button className="btn sm" onClick={sendReminders}>{t.cta}</button>
                    : <button className="btn ghost sm" onClick={() => navigate(t.to!)}>{t.cta}</button>}
                </div>
              ))}
            </div>
          ) : (
            <div className="empty text-green"><Icon name="check-circle" size={22} /><p style={{ marginTop: 10 }}>All clear.</p></div>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <div className="label">Upcoming hearings</div>
            <Link className="btn quiet sm" to="/hearings">Calendar <Icon name="arrow-right" size={14} /></Link>
          </div>
          {data.hearings.length ? (
            <div className="list">
              {data.hearings.map((h) => (
                <Link className="row" to={`/documents/${h.id}`} style={{ gap: 14 }} key={h.id}>
                  <DateBox date={h.hearing_date} tone={hearingTone(h)} small />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="ellipsis" style={{ fontWeight: 500 }}>{h.case_number || h.title}</div>
                    <div className="small muted">
                      {h.client_name || "No client"} · {h.hearing_confirmed ? until(h.hearing_date) : <span className="text-amber">to confirm</span>}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : <div className="empty">No hearings ahead.</div>}
        </div>
      </div>

      <div className="panel-grid section">
        <div className="card">
          <div className="card-head">
            <div className="label">Recent documents</div>
            <Link className="btn quiet sm" to="/documents">View all <Icon name="arrow-right" size={14} /></Link>
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
          <div className="card-head">
            <div className="label">Live activity</div>
            <span className="badge blue"><span className="pulse blue" style={{ margin: 0 }} />Live</span>
          </div>
          <Timeline rows={data.activity} />
        </div>
      </div>

      <section className="section card">
        <div className="row between wrap-row" style={{ marginBottom: 22 }}>
          <div className="label">Pipeline · what happens after one upload</div>
          <div className="legend label">
            <span><i className="ai" />AI</span>
            <span><i className="auto" />Automation</span>
            <span><i className="human" />Human check</span>
          </div>
        </div>
        <div className="pipe">
          {[
            ["", "upload", "Upload", "Lawyer"],
            ["auto", "fingerprint", "Fingerprint", "SHA-256 + locked copy"],
            ["ai", "scan", "Read", "PDF text · Groq vision"],
            ["ai", "sparkles", "Summarize + date", `Groq · ${health.ai.model.split("/").pop()}`],
            ["human", "user-check", "Confirm date", "Lawyer"],
            ["auto", "bell", "Reminder", "A day before"],
          ].map(([kind, icon, label, who]) => (
            <div className={`step ${kind}`} key={label}>
              <Icon name={icon} size={20} /><div className="label">{label}</div><div className="who">{who}</div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
