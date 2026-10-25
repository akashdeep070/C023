import { useEffect } from "react";
import type { Status } from "../../../shared/types";
import { Loading, PageHead } from "../components/common";
import { Icon } from "../components/Icon";
import { useApi, useTitle } from "../hooks";

const SEVERITY: [string, string, string, string][] = [
  ["S1", "Site down, or a file altered", "15 min", "red"],
  ["S2", "Slow or failing for users", "1 h", "amber"],
  ["S3", "Backup app down, site still up", "4 h", "blue"],
  ["S4", "Cosmetic issue", "next day", ""],
];

export function StatusPage() {
  useTitle("Status & SLA");
  const { data: s, error, reload } = useApi<Status>("/status");

  // Live numbers: poll every 5 seconds while the page is open
  useEffect(() => {
    const t = setInterval(reload, 5000);
    return () => clearInterval(t);
  }, [reload]);

  if (!s) return <Loading error={error} />;
  const rows: [string, string, string, boolean, number][] = [
    ["Response time (P95)", "< 2 s", `${s.p95_ms.toFixed(0)} ms`, s.p95_ms < 2000, s.p95_ms / 2000],
    ["Average / P99", "Report", `${s.avg_ms.toFixed(0)} / ${s.p99_ms.toFixed(0)} ms`, true, s.p99_ms / 2000],
    ["Error rate", "< 1%", `${s.error_rate.toFixed(2)}%`, s.error_rate < 1, s.error_rate],
    ["Database", "Reachable", s.checks.database ? "OK" : "Down", s.checks.database, 0],
    ["File storage", "Writable", s.checks.storage ? "OK" : "Read-only", s.checks.storage, 0],
    ["File integrity", "100%", "Verify on each file", true, 0],
  ];
  const up = s.uptime_s;

  return (
    <>
      <PageHead eyebrow="System" title="Status & SLA"
        lede="Live numbers from the instance that answered. Behind nginx, refresh and watch it switch between app1 and app2." />

      <div className="grid g4 kpis">
        <div className="card kpi">
          <div className="label">Served by</div>
          <div className="num row" style={{ gap: 10 }}><span className="pulse blue" style={{ margin: 0 }} />{s.instance}</div>
          <div className="kpi-sub">Up {Math.floor(up / 3600)}h {Math.floor((up % 3600) / 60)}m {up % 60}s</div>
        </div>
        <div className="card kpi">
          <div className="label">Health</div>
          <div className={`num ${s.status === "ok" ? "green" : "red"}`}>{s.status === "ok" ? "Healthy" : "Degraded"}</div>
          <div className="kpi-sub mono">GET /health → {s.status === "ok" ? 200 : 503}</div>
        </div>
        <div className="card kpi">
          <div className="label">API requests</div>
          <div className="num">{s.requests}</div>
          <div className={`kpi-sub${s.errors ? " text-red" : ""}`}>{s.errors} errors on this instance</div>
        </div>
        <div className="card kpi">
          <div className="label">AI</div>
          <div className={`num ${s.ai.enabled ? "" : "amber"}`}>{s.ai.enabled ? "Groq" : "Local"}</div>
          <div className="kpi-sub mono" style={{ wordBreak: "break-all" }}>{s.ai.enabled ? s.ai.model : "Set GROQ_API_KEY"}</div>
        </div>
      </div>

      <div className="split section">
        <div className="card">
          <div className="card-head"><h3>SLA targets</h3><span className="label">Observed live · every 5 s</span></div>
          <table className="table stack-sm">
            <thead><tr><th>Metric</th><th>Target</th><th>Observed</th><th className="r">Result</th></tr></thead>
            <tbody>
              {rows.map(([name, target, observed, ok, ratio]) => (
                <tr key={name}>
                  <td className="t">{name}</td>
                  <td className="muted">{target}</td>
                  <td>
                    <div className="mono">{observed}</div>
                    {ratio > 0 && <div className={`meter${ok ? "" : " red"}`} style={{ marginTop: 8, maxWidth: 160 }}><i style={{ width: `${Math.min(ratio * 100, 100)}%` }} /></div>}
                  </td>
                  <td className="r"><span className={`badge ${ok ? "green" : "red"}`}>{ok ? "Met" : "Not met"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <aside className="stack">
          <div className="card">
            <div className="label" style={{ marginBottom: 20 }}>Incident severity &amp; response</div>
            <div className="list">
              {SEVERITY.map(([sev, what, time, tone]) => (
                <div className="row" style={{ gap: 14 }} key={sev}>
                  <span className={`badge mono ${tone}`} style={{ width: 40, justifyContent: "center" }}>{sev}</span>
                  <span className="grow small">{what}</span>
                  <span className="mono faint">{time}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card soft">
            <div className="label row text-red" style={{ marginBottom: 14, gap: 6 }}><Icon name="zap" size={13} /> Break it on purpose</div>
            <p className="small muted">
              Run <span className="mono">docker compose exec app1 kill 1</span>. nginx sends requests to app2 so the app keeps
              working, and Docker restarts app1 on its own.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
