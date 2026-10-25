import { useCallback, useEffect, useRef, useState } from "react";
import { niceTime } from "../../../shared/format";
import type { AiHealth, Status } from "../../../shared/types";
import { api } from "../api";
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

  const [tested, setTested] = useState<AiHealth | null>(null);
  const [testing, setTesting] = useState(false);
  const testGroq = useCallback(async () => {
    setTesting(true);
    try {
      setTested((await api.post<{ health: AiHealth | null }>("/ai/check")).health);
    } finally {
      setTesting(false);
    }
  }, []);
  // Test once when the page opens, so a wrong key shows up straight away
  const autoTested = useRef(false);
  useEffect(() => {
    if (s?.ai.enabled && !s.ai.health && !autoTested.current) {
      autoTested.current = true;
      testGroq();
    }
  }, [s, testGroq]);

  if (!s) return <Loading error={error} />;
  // On Vercel the test and the poll can land on different instances: show the newer result
  const groq = [tested, s.ai.health].filter((h): h is AiHealth => !!h).sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
  const groqFailing = s.ai.enabled && groq?.ok === false;
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
          <div className={`num ${!s.ai.enabled ? "amber" : groqFailing ? "red" : ""}`}>{!s.ai.enabled ? "Local" : groqFailing ? "Error" : "Groq"}</div>
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
          <div className={`card${!s.ai.enabled ? " tone-amber" : groqFailing ? " tone-red" : ""}`} id="groq">
            <div className="card-head" style={{ marginBottom: 16 }}>
              <div>
                <h3>Groq AI</h3>
                <div className="small muted" style={{ marginTop: 4 }}>Summaries, next dates and answers</div>
              </div>
              {!s.ai.enabled ? <span className="badge amber">Not set up</span>
                : !groq ? <span className="badge">Not tested</span>
                  : groq.ok ? <span className="badge green"><Icon name="check" size={12} /> Working</span>
                    : <span className="badge red">Not working</span>}
            </div>
            {s.ai.enabled ? (
              <>
                {groqFailing && <div className="check bad" style={{ marginBottom: 16 }}><Icon name="alert" size={17} /><span>{groq!.error}</span></div>}
                {groq?.ok && <p className="small muted" style={{ marginBottom: 16 }}>Answered in {groq.ms} ms · {niceTime(groq.at)}</p>}
                <dl className="kv" style={{ gridTemplateColumns: "64px 1fr", margin: "0 0 18px" }}>
                  <dt>Text</dt><dd className="mono" style={{ wordBreak: "break-all" }}>{s.ai.model}</dd>
                  <dt>Vision</dt><dd className="mono" style={{ wordBreak: "break-all" }}>{s.ai.vision_model}</dd>
                </dl>
                <button className="btn ghost sm" onClick={testGroq} disabled={testing}>
                  <Icon name="refresh" size={14} /> {testing ? "Testing…" : "Test Groq"}
                </button>
              </>
            ) : (
              <>
                <p className="small muted">Without a key, a local reader writes the summaries and finds dates. To use Groq:</p>
                <ol className="steps small">
                  <li>Get a free key at <a className="link" href="https://console.groq.com/keys" target="_blank" rel="noreferrer">console.groq.com/keys</a>.</li>
                  <li><b>On Vercel:</b> Project → Settings → Environment Variables. Add <span className="mono">GROQ_API_KEY</span>, then redeploy.</li>
                  <li><b>On your computer:</b> put it in <span className="mono">.env</span> and restart the app.</li>
                </ol>
              </>
            )}
          </div>
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
