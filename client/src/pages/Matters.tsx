import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { niceDate, until } from "../../../shared/format";
import type { Client, ConflictHit, MatterRow } from "../../../shared/types";
import { api } from "../api";
import { Loading, PageHead } from "../components/common";
import { useFlash } from "../components/Flash";
import { Icon } from "../components/Icon";
import { useApi, useTitle } from "../hooks";

const SIDES = ["Plaintiff", "Petitioner", "Applicant", "Complainant", "Appellant", "Defendant", "Respondent", "Accused", "Advisory"];

function NewMatter({ clients, onCancel }: { clients: Client[]; onCancel: () => void }) {
  const [params] = useSearchParams();
  const [client, setClient] = useState(params.get("client") ?? "");
  const [newClient, setNewClient] = useState("");
  const [opposite, setOpposite] = useState("");
  const [hits, setHits] = useState<ConflictHit[]>([]);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const flash = useFlash();

  const clientName = client === "new" ? newClient : clients.find((c) => String(c.id) === client)?.name ?? "";

  // Conflict check as you type: is the other side our client, or our client someone's opponent?
  useEffect(() => {
    const t = setTimeout(() => {
      if (!opposite.trim() && !clientName.trim()) { setHits([]); return; }
      const q = new URLSearchParams({ party: opposite, client: clientName });
      api.get<ConflictHit[]>(`/conflicts?${q}`).then(setHits).catch(() => setHits([]));
    }, 350);
    return () => clearTimeout(t);
  }, [opposite, clientName]);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (hits.length && !window.confirm("The conflict check found a match. Open the matter anyway?")) return;
    setBusy(true);
    try {
      const body = Object.fromEntries(new FormData(e.currentTarget));
      const r = await api.post<{ id: number; message: string }>("/matters", body);
      flash(r.message);
      navigate(`/matters/${r.id}`);
    } catch (err) {
      flash((err as Error).message, "error");
      setBusy(false);
    }
  };

  return (
    <form className="card" style={{ marginBottom: 20 }} onSubmit={submit}>
      <div className="card-head"><h3>New matter</h3></div>
      <div className="grid g3" style={{ gap: 18 }}>
        <label className="field">
          <span>Client</span>
          <select className="input" name="client_id" value={client} onChange={(e) => setClient(e.target.value)} required>
            <option value="">Choose a client</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value="new">+ New client…</option>
          </select>
        </label>
        {client === "new" && (
          <>
            <label className="field"><span>Client name</span>
              <input className="input" name="new_client" value={newClient} onChange={(e) => setNewClient(e.target.value)} required />
            </label>
            <label className="field"><span>Client phone</span><input className="input" name="phone" placeholder="+91" /></label>
          </>
        )}
        <label className="field"><span>We act for the</span>
          <select className="input" name="our_side" defaultValue="Plaintiff">{SIDES.map((s) => <option key={s}>{s}</option>)}</select>
        </label>
        <label className="field"><span>Opposite party</span>
          <input className="input" name="opposite_party" value={opposite} onChange={(e) => setOpposite(e.target.value)} placeholder="Name" />
        </label>
        <label className="field"><span>Opposite counsel</span><input className="input" name="opposite_counsel" placeholder="Optional" /></label>
        <label className="field"><span>Case number</span><input className="input" name="case_number" placeholder="e.g. CS 301/2026" /></label>
        <label className="field"><span>Court</span><input className="input" name="court" placeholder="e.g. City Civil Court, Mumbai" /></label>
        <label className="field"><span>Stage</span><input className="input" name="stage" placeholder="e.g. Filing" /></label>
        <label className="field"><span>Next date</span><input className="input" type="date" name="next_date" /></label>
        <label className="field"><span>Listed for</span><input className="input" name="next_purpose" placeholder="e.g. Admission" /></label>
      </div>

      {hits.length > 0 ? (
        <div className="check bad" style={{ marginTop: 18, alignItems: "flex-start" }}>
          <Icon name="alert" size={18} />
          <div>
            <b>Possible conflict of interest</b>
            {hits.map((h) => (
              <div className="small" key={h.kind + h.to} style={{ marginTop: 4 }}>
                {h.kind}: <Link to={h.to} style={{ textDecoration: "underline" }}>{h.name}</Link> ({h.detail})
              </div>
            ))}
          </div>
        </div>
      ) : (opposite || clientName) ? (
        <div className="check" style={{ marginTop: 18 }}><Icon name="shield" size={17} /> No conflicts found with your clients or opposite parties.</div>
      ) : null}

      <div className="row" style={{ gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
        <button className="btn" disabled={busy}>Open matter</button>
      </div>
    </form>
  );
}

export function Matters() {
  useTitle("Matters");
  const [params, setParams] = useSearchParams();
  const status = params.get("status") ?? "Open";
  const q = params.get("q") ?? "";
  const [text, setText] = useState(q);
  const [adding, setAdding] = useState(params.get("new") === "1");
  const { data, error } = useApi<{ rows: MatterRow[]; counts: { open: number; disposed: number } }>(
    `/matters?${new URLSearchParams({ q, status })}`);
  const clients = useApi<{ clients: Client[] }>("/upload-options").data?.clients ?? [];
  const navigate = useNavigate();

  const set = (next: Record<string, string>) => {
    const p = new URLSearchParams({ q, status, ...next });
    if (!p.get("q")) p.delete("q");
    if (p.get("status") === "Open") p.delete("status");
    setParams(p);
  };

  return (
    <>
      <PageHead title="Matters" lede="Every case and advisory file, with its court, stage, last outcome and next date.">
        <button className="btn" onClick={() => setAdding((a) => !a)}><Icon name="plus" size={16} /> New matter</button>
      </PageHead>

      {adding && <NewMatter clients={clients} onCancel={() => setAdding(false)} />}

      <div className="row wrap-row" style={{ marginBottom: 16, gap: 10 }}>
        <form className="search" onSubmit={(e) => { e.preventDefault(); set({ q: text.trim() }); }}>
          <Icon name="search" size={18} />
          <input className="input" value={text} onChange={(e) => setText(e.target.value)}
            placeholder="Search case number, parties, court or client" />
        </form>
        <div className="tabs">
          {[["Open", data?.counts.open], ["Disposed", data?.counts.disposed], ["All", undefined]].map(([s, n]) => (
            <button key={s} className={status === s ? "on" : ""} onClick={() => set({ status: String(s) })}>
              {s}{n !== undefined ? ` · ${n}` : ""}
            </button>
          ))}
        </div>
      </div>

      {!data ? <Loading error={error} /> : (
        <div className="card">
          {data.rows.length ? (
            <div className="scroll-x">
              <table className="table compact stack-sm">
                <thead><tr><th>Matter</th><th>Court</th><th>Stage</th><th>Last date</th><th>Next date</th><th className="r">Due</th></tr></thead>
                <tbody>
                  {data.rows.map((m) => (
                    <tr className="link" key={m.id} onClick={() => navigate(`/matters/${m.id}`)}>
                      <td>
                        <Link className="t" to={`/matters/${m.id}`}>{m.case_number || m.title}</Link>
                        <div className="s">{m.case_number ? m.title : m.our_side}{m.client_name && ` · ${m.client_name}`}</div>
                      </td>
                      <td className="small">{m.court ? m.court.split(" · ")[0] : <span className="muted">Not in court</span>}</td>
                      <td className="small">{m.stage || "—"}</td>
                      <td className="small" style={{ maxWidth: 240 }}>
                        {m.last_date ? (
                          <>
                            <div className="nowrap">{niceDate(m.last_date, "%-d %b")}</div>
                            <div className={`ellipsis ${m.last_outcome ? "muted" : "text-amber"}`}>{m.last_outcome || "Outcome not recorded"}</div>
                          </>
                        ) : <span className="muted">—</span>}
                      </td>
                      <td className="small">
                        {m.next_hearing ? (
                          <>
                            <span className="badge blue">{niceDate(m.next_hearing, "%-d %b")}</span>
                            <div className="muted" style={{ marginTop: 4 }}>{until(m.next_hearing)}</div>
                          </>
                        ) : <span className="muted">{m.status === "Disposed" ? "Disposed" : "Not fixed"}</span>}
                      </td>
                      <td className="r">{m.open_deadlines ? <span className="badge amber">{m.open_deadlines}</span> : <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="empty">No matters match.</div>}
        </div>
      )}
    </>
  );
}
