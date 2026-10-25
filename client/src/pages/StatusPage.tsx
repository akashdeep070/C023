import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { niceTime } from "../../../shared/format";
import type { AiHealth, Status } from "../../../shared/types";
import { api, browserGroqKey } from "../api";
import { Loading, PageHead } from "../components/common";
import { Icon } from "../components/Icon";
import { useApi, useTitle } from "../hooks";

type Check = { health: AiHealth | null; rejected: boolean };

/** Enough of a key to tell which one it is. */
const keyHint = (key: string) => (key.length > 12 ? `${key.slice(0, 4)}…${key.slice(-4)}` : "saved");

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
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const browserKey = browserGroqKey.get();
  const testGroq = useCallback(async () => {
    setTesting(true);
    try {
      setTested((await api.post<Check>("/ai/check")).health);
    } finally {
      setTesting(false);
    }
  }, []);
  // Test once when the page opens, so a wrong key shows up straight away
  const autoTested = useRef(false);
  useEffect(() => {
    if (s && (browserKey || (s.ai.enabled && !s.ai.health)) && !autoTested.current) {
      autoTested.current = true;
      testGroq();
    }
  }, [s, browserKey, testGroq]);

  // Try a pasted key first, and keep it in this browser unless Groq turns it down
  const saveKey = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const key = String(new FormData(form).get("key") ?? "").trim().replace(/^["']+|["']+$/g, "");
    if (!key) return;
    setTesting(true);
    setNote(null);
    try {
      const r = await api.post<Check>("/ai/check", {}, key);
      if (r.rejected) {
        setNote({ text: `${r.health!.error} It was not saved.`, ok: false });
        return;
      }
      autoTested.current = true; // just tested
      browserGroqKey.set(key);
      setTested(r.health);
      form.reset();
      setNote(r.health?.ok
        ? { text: "Saved in this browser. Groq is working.", ok: true }
        : { text: `Saved in this browser, but it could not be tested: ${r.health?.error}`, ok: false });
    } catch (err) {
      setNote({ text: (err as Error).message, ok: false });
    } finally {
      setTesting(false);
    }
  };
  const removeKey = () => {
    browserGroqKey.set(null);
    setTested(null);
    setNote({ text: s?.ai.enabled ? "Removed. The server's key is used again." : "Removed. The local reader is used now.", ok: true });
    reload();
  };

  if (!s) return <Loading error={error} />;
  const ready = Boolean(browserKey) || s.ai.enabled;
  // The browser's key is tested on its own. For the server's key, the test and the 5-second poll can
  // land on different Vercel instances, so show whichever result is newer.
  const groq = browserKey ? tested
    : s.ai.enabled ? [tested, s.ai.health].filter((h): h is AiHealth => !!h).sort((a, b) => b.at.localeCompare(a.at))[0] ?? null
      : null;
  const groqFailing = ready && groq?.ok === false;
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
          <div className={`num ${!ready ? "amber" : groqFailing ? "red" : ""}`}>{!ready ? "Local" : groqFailing ? "Error" : "Groq"}</div>
          <div className="kpi-sub mono" style={{ wordBreak: "break-all" }}>{ready ? s.ai.model : "Add a Groq key"}</div>
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
          <div className={`card${!ready ? " tone-amber" : groqFailing ? " tone-red" : ""}`} id="groq">
            <div className="card-head" style={{ marginBottom: 16 }}>
              <div>
                <h3>Groq AI</h3>
                <div className="small muted" style={{ marginTop: 4 }}>Summaries, next dates and answers</div>
              </div>
              {!ready ? <span className="badge amber">Not set up</span>
                : !groq ? <span className="badge">{testing ? "Testing…" : "Not tested"}</span>
                  : groq.ok ? <span className="badge green"><Icon name="check" size={12} /> Working</span>
                    : <span className="badge red">Not working</span>}
            </div>
            {ready ? (
              <>
                {groqFailing && <div className="check bad" style={{ marginBottom: 16 }}><Icon name="alert" size={17} /><span>{groq!.error}</span></div>}
                {groq?.ok && <p className="small muted" style={{ marginBottom: 16 }}>Answered in {groq.ms} ms · {niceTime(groq.at)}</p>}
                <dl className="kv" style={{ gridTemplateColumns: "64px 1fr", margin: "0 0 18px" }}>
                  <dt>Key</dt>
                  <dd>{browserKey ? <><span className="mono">{keyHint(browserKey)}</span> <span className="small muted">· in this browser</span></>
                    : <span className="small">On the server (<span className="mono">GROQ_API_KEY</span>)</span>}</dd>
                  <dt>Text</dt><dd className="mono" style={{ wordBreak: "break-all" }}>{s.ai.model}</dd>
                  <dt>Vision</dt><dd className="mono" style={{ wordBreak: "break-all" }}>{s.ai.vision_model}</dd>
                </dl>
                <div className="row wrap-row" style={{ gap: 8 }}>
                  <button className="btn ghost sm" onClick={testGroq} disabled={testing}>
                    <Icon name="refresh" size={14} /> {testing ? "Testing…" : "Test Groq"}
                  </button>
                  {browserKey && <button className="btn quiet sm text-red" onClick={removeKey}>Remove from this browser</button>}
                </div>
              </>
            ) : (
              <p className="small muted">
                Without a key, a local reader writes the summaries and finds dates. Get a free key
                at <a className="link" href="https://console.groq.com/keys" target="_blank" rel="noreferrer">console.groq.com/keys</a> and paste it here.
              </p>
            )}

            <form className="stack" style={{ gap: 8, marginTop: 20 }} onSubmit={saveKey}>
              <label className="field">
                <span>{ready ? "Use a different key" : "Paste your Groq API key"}</span>
                <input className="input" name="key" type="password" placeholder="gsk_…" autoComplete="off" spellCheck={false} />
              </label>
              <button className="btn sm" disabled={testing}>{testing ? "Testing the key…" : "Save and test"}</button>
            </form>
            {note && (
              <div className={`check${note.ok ? "" : " bad"}`} style={{ marginTop: 14 }} role="status">
                <Icon name={note.ok ? "check-circle" : "alert"} size={17} /><span>{note.text}</span>
              </div>
            )}
            <p className="small faint" style={{ marginTop: 14 }}>
              The key stays in this browser and goes to this app's server only with requests that use the AI. The server
              never stores it. On a shared computer, remove it when you're done. To set one key for everyone,
              add <span className="mono">GROQ_API_KEY</span> to <span className="mono">.env</span>, or on Vercel to the project's
              Environment Variables, then restart or redeploy.
            </p>
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
