import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { filesize, isoDate, niceDate, niceTime, until } from "../../../shared/format";
import type { AskResult, DocumentDetail, IntegrityResult, Meta } from "../../../shared/types";
import { api } from "../api";
import { Crumbs, Loading, Timeline, docBadge } from "../components/common";
import { useFlash } from "../components/Flash";
import { Icon } from "../components/Icon";
import { useApi, useTitle } from "../hooks";

const SUGGESTIONS = ["When is the next hearing?", "What was ordered?", "Who are the parties?", "What amount is involved?"];

interface QA { q: string; a?: AskResult; failed?: string }

export function DocumentPage() {
  const { id } = useParams();
  const { data, error, reload } = useApi<DocumentDetail>(`/documents/${id}`);
  const meta = useApi<Meta>("/meta").data;
  const flash = useFlash();
  const [integrity, setIntegrity] = useState<IntegrityResult[] | null>(null);
  const [asks, setAsks] = useState<QA[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  useTitle(data?.doc.title ?? "Document");

  useEffect(() => { setIntegrity(null); setAsks([]); }, [id]);
  useEffect(() => { if (data) setDate(data.doc.hearing_date); }, [data]);

  if (!data) return <Loading error={error} />;
  const { doc, versions, pages, key_points } = data;
  const upcoming = Boolean(doc.hearing_confirmed) && doc.hearing_date >= isoDate();
  const suggested = !doc.hearing_confirmed && doc.hearing_date >= isoDate();

  /** Run a POST action, show its message, then refresh the page data. */
  const act = async (key: string, path: string, body?: unknown) => {
    setBusy(key);
    try {
      const r = await api.post<{ message?: string; kind?: "ok" | "error"; results?: IntegrityResult[] }>(path, body);
      if (r.results) setIntegrity(r.results);
      if (r.message) flash(r.message, r.kind ?? "ok");
      reload();
    } catch (e) {
      flash((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  const ask = async (q: string) => {
    if (!q.trim() || asking) return;
    setAsking(true);
    setQuestion("");
    setAsks((list) => [{ q }, ...list]);
    try {
      const a = await api.post<AskResult>(`/documents/${id}/ask`, { question: q });
      setAsks((list) => list.map((x, i) => (i === 0 ? { ...x, a } : x)));
    } catch (e) {
      setAsks((list) => list.map((x, i) => (i === 0 ? { ...x, failed: (e as Error).message } : x)));
    }
    setAsking(false);
    reload();
  };

  const uploadVersion = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy("version");
    try {
      const r = await api.upload(`/documents/${id}/version`, new FormData(form));
      flash(r.message ?? "Saved.");
      form.reset();
      setIntegrity(null);
      reload();
    } catch (err) {
      flash((err as Error).message, "error");
    }
    setBusy(null);
  };

  const bad = integrity?.filter((r) => !r.ok) ?? [];

  return (
    <>
      <Crumbs parent="Documents" to="/documents" current={doc.case_number || doc.doc_type} />

      <section className="head">
        <div>
          <div className="eyebrow">{doc.doc_type}{doc.case_number && ` · ${doc.case_number}`}</div>
          <h1>{doc.title}</h1>
          <div className="row wrap-row" style={{ marginTop: 16, gap: 10 }}>
            <span className={docBadge(doc.status)}>{doc.status}</span>
            {doc.client_name && doc.client_id && (
              <Link className="badge line" to={`/clients/${doc.client_id}`}><Icon name="user" size={13} /> {doc.client_name}</Link>
            )}
            {doc.parties && <span className="badge line">{doc.parties}</span>}
          </div>
        </div>
        <div className="head-actions">
          <a className="btn ghost" href={`/api/documents/${doc.id}/file/${versions[0].version}`} target="_blank" rel="noreferrer"
            onClick={() => setTimeout(reload, 500)}>
            <Icon name="eye" size={16} /> Open file
          </a>
          {doc.status !== "Reviewed" && (
            <button className="btn" disabled={busy === "review"} onClick={() => act("review", `/documents/${id}/review`)}>
              <Icon name="check" size={16} /> Mark reviewed
            </button>
          )}
        </div>
      </section>

      <div className="split">
        <div className="stack">
          <div className="card">
            <div className="card-head">
              <div className="row" style={{ gap: 14 }}>
                <span className="icon-tile purple"><Icon name="sparkles" size={18} /></span>
                <div>
                  <h3>AI summary</h3>
                  <div className="small muted">
                    {doc.ai_source === "groq" ? `Groq · ${meta?.ai.model ?? "llama"}` : "Local reader"} · a draft for you to check
                  </div>
                </div>
              </div>
              <button className="btn quiet sm" title="Read the file again" disabled={busy === "reread"}
                onClick={() => act("reread", `/documents/${id}/reanalyze`)}>
                <Icon name="refresh" size={15} /> {busy === "reread" ? "Reading…" : "Re-read"}
              </button>
            </div>
            <p className="summary">{doc.summary}</p>
            {key_points.length > 0 && (
              <>
                <div className="divider" />
                <div className="label" style={{ marginBottom: 16 }}>Key points</div>
                <ul className="points">{key_points.map((k) => <li key={k}>{k}</li>)}</ul>
              </>
            )}
            {doc.note && <div className="check amber" style={{ marginTop: 24 }}><Icon name="alert" size={17} /> {doc.note}</div>}
          </div>

          <div className="card">
            <div className="card-head">
              <div className="row" style={{ gap: 14 }}>
                <span className="icon-tile purple"><Icon name="message" size={18} /></span>
                <div>
                  <h3>Ask the file</h3>
                  <div className="small muted">Plain-English questions. Every answer shows the page it came from.</div>
                </div>
              </div>
            </div>
            {asks.length > 0 && (
              <div className="ask-log">
                {asks.map((x, i) => (
                  <div className="qa" key={asks.length - i}>
                    <div className="q">{x.q}</div>
                    {x.a ? (
                      <div className="a">
                        {x.a.answer}
                        <span className="label">
                          {x.a.page ? `Page ${x.a.page} · ` : ""}{x.a.source === "groq" ? "Groq" : "Local reader"} · {x.a.ms} ms
                        </span>
                      </div>
                    ) : <div className="a muted">{x.failed ?? "Thinking…"}</div>}
                  </div>
                ))}
              </div>
            )}
            <form className="row" onSubmit={(e) => { e.preventDefault(); ask(question); }}>
              <input className="input grow" value={question} onChange={(e) => setQuestion(e.target.value)}
                placeholder="e.g. When is the next hearing?" autoComplete="off" maxLength={300} />
              <button className="btn" disabled={asking}>{asking ? "Reading…" : "Ask"}</button>
            </form>
            <div className="suggest">
              {SUGGESTIONS.map((s) => <button type="button" key={s} onClick={() => ask(s)}>{s}</button>)}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <h3>Extracted text</h3>
                <div className="small muted">{pages.length} page{pages.length === 1 ? "" : "s"} · searchable</div>
              </div>
            </div>
            <div className="pages">
              {pages.map(([num, text], i) => (
                <details className="page-text" open={i === 0} key={num}>
                  <summary><span className="label">Page {num}</span><span className="small faint">{text.length} characters</span></summary>
                  <pre>{text || "No text on this page."}</pre>
                </details>
              ))}
            </div>
          </div>
        </div>

        <aside className="stack">
          <div className={`card${upcoming ? " tone-blue" : suggested ? " tone-amber" : ""}`}>
            <div className="row" style={{ gap: 14, marginBottom: 22 }}>
              <span className={`icon-tile${upcoming ? " blue" : suggested ? " amber" : ""}`}><Icon name="calendar" size={18} /></span>
              <div>
                <h3>Next hearing</h3>
                <div className="small muted">
                  {!doc.hearing_date ? "None found in this file"
                    : doc.hearing_confirmed ? <span className="text-blue">Confirmed by lawyer</span>
                      : <span className="text-amber">Suggested by AI{doc.hearing_page ? ` · page ${doc.hearing_page}` : ""} · please confirm</span>}
                </div>
              </div>
            </div>
            {doc.hearing_date && (
              <>
                <div className={upcoming ? "text-blue" : suggested ? "text-amber" : ""}
                  style={{ fontSize: 34, fontWeight: 600, letterSpacing: "-.04em", lineHeight: 1.1 }}>
                  {niceDate(doc.hearing_date, "%-d %B %Y")}
                </div>
                <div className="small muted" style={{ marginTop: 6 }}>
                  {until(doc.hearing_date)}{upcoming && ` · reminder ${doc.reminder_sent ? "sent" : "the day before"}`}
                </div>
              </>
            )}
            <form className="row" style={{ marginTop: 22 }}
              onSubmit={(e) => { e.preventDefault(); act("hearing", `/documents/${id}/hearing`, { action: "confirm", date }); }}>
              <input className="input grow" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              <button className={`btn${upcoming ? " ghost" : ""}`} disabled={busy === "hearing"}>
                {doc.hearing_confirmed ? "Update" : "Confirm"}
              </button>
            </form>
            {doc.hearing_date && (
              <button className="btn quiet sm" style={{ padding: 0, marginTop: 8 }}
                onClick={() => act("hearing", `/documents/${id}/hearing`, { action: "clear" })}>Remove date</button>
            )}
          </div>

          <div className="card" id="integrity">
            <div className="row" style={{ gap: 14, marginBottom: 22 }}>
              <span className="icon-tile green"><Icon name="fingerprint" size={18} /></span>
              <div>
                <h3>Proof &amp; versions</h3>
                <div className="small muted">SHA-256 fingerprint and a locked copy of every version</div>
              </div>
            </div>
            {integrity && (
              <div className={`check${bad.length ? " bad" : ""}`} style={{ marginBottom: 20 }}>
                <Icon name={bad.length ? "alert" : "shield"} size={18} />
                <span>
                  {bad.length
                    ? `${bad.length} version${bad.length > 1 ? "s" : ""} changed after upload. The locked copy is safe.`
                    : `All ${integrity.length} version${integrity.length > 1 ? "s" : ""} match. Untouched since upload.`}
                </span>
              </div>
            )}
            <div className="list">
              {versions.map((v) => (
                <div key={v.id}>
                  <div className="row between">
                    <a className="link" href={`/api/documents/${doc.id}/file/${v.version}?dl=1`} style={{ fontWeight: 500 }}>v{v.version} · {v.filename}</a>
                    <span className="small muted nowrap">{filesize(v.size)}</span>
                  </div>
                  <div className="hash" style={{ marginTop: 6 }}>{v.sha256}</div>
                  <div className="small faint" style={{ marginTop: 4 }}>{niceTime(v.uploaded_at)}</div>
                </div>
              ))}
            </div>
            <div className="row wrap-row" style={{ marginTop: 22, gap: 8 }}>
              <button className="btn sm" disabled={busy === "verify"} onClick={() => act("verify", `/documents/${id}/verify`)}>
                <Icon name="shield" size={15} /> Verify now
              </button>
              {bad.length > 0 && (
                <button className="btn ghost sm" disabled={busy === "restore"} onClick={() => act("restore", `/documents/${id}/restore`)}>
                  <Icon name="history" size={15} /> Restore locked copy
                </button>
              )}
            </div>
            <div className="divider" />
            <form onSubmit={uploadVersion}>
              <div className="label" style={{ marginBottom: 10 }}>Upload a new version</div>
              <div className="row">
                <input className="input grow" type="file" name="file" required style={{ paddingTop: 10, fontSize: 13 }} />
                <button className="btn ghost sm" style={{ height: 46 }} disabled={busy === "version"}>Save</button>
              </div>
            </form>
            <button className="btn quiet sm text-red" style={{ padding: 0, marginTop: 14 }} title="For the class demo"
              onClick={() => {
                if (window.confirm("Demo: overwrite the working copy to show tamper detection?")) {
                  setIntegrity(null);
                  act("tamper", `/documents/${id}/tamper`);
                }
              }}>
              <Icon name="zap" size={14} /> Demo: simulate a tampering script
            </button>
          </div>

          <div className="card">
            <div className="label" style={{ marginBottom: 22 }}>Audit trail</div>
            <Timeline rows={data.activity} hideDoc />
          </div>
        </aside>
      </div>
    </>
  );
}
