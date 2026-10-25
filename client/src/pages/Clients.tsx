import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { inr, niceDate } from "../../../shared/format";
import type { ClientRow } from "../../../shared/types";
import { api } from "../api";
import { Loading, PageHead } from "../components/common";
import { useFlash } from "../components/Flash";
import { Icon } from "../components/Icon";
import { useApi, useTitle } from "../hooks";

interface Data { rows: ClientRow[]; stats: { clients: number; matters: number; invoices_due: number; outstanding: number } }

export function Clients() {
  useTitle("Clients");
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [text, setText] = useState(q);
  const [adding, setAdding] = useState(false);
  const { data, error } = useApi<Data>(`/clients?q=${encodeURIComponent(q)}`);
  const navigate = useNavigate();
  const flash = useFlash();

  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    try {
      const r = await api.post<{ id: number; message: string }>("/clients", Object.fromEntries(new FormData(e.currentTarget)));
      flash(r.message);
      navigate(`/clients/${r.id}`);
    } catch (err) {
      flash((err as Error).message, "error");
    }
  };

  return (
    <>
      <PageHead eyebrow="Clients" title="One client. Every case." soft="One workspace."
        lede="A directory that connects contacts, matters, documents, hearing dates and billing.">
        <button className="btn" onClick={() => setAdding((a) => !a)}><Icon name="plus" size={16} /> Add client</button>
      </PageHead>

      {!data ? <Loading error={error} /> : (
        <>
          <div className="grid g4 kpis">
            <div className="card kpi"><div className="label">Active clients</div><div className="num">{data.stats.clients}</div></div>
            <div className="card kpi"><div className="label">Open matters</div><div className="num">{data.stats.matters}</div></div>
            <div className="card kpi"><div className="label">Invoices due</div><div className={`num${data.stats.invoices_due ? " amber" : ""}`}>{data.stats.invoices_due}</div></div>
            <div className="card kpi"><div className="label">Outstanding</div><div className={`num ${data.stats.outstanding ? "amber" : "green"}`}>{inr(data.stats.outstanding)}</div></div>
          </div>

          <div className="card section">
            {adding && (
              <form className="card soft" style={{ marginBottom: 28 }} onSubmit={add}>
                <div className="grid g3" style={{ gap: 20 }}>
                  <label className="field"><span>Name</span><input className="input" name="name" required placeholder="Demo Client D" autoFocus /></label>
                  <label className="field"><span>Matter</span><input className="input" name="matter" placeholder="e.g. Civil matter" /></label>
                  <label className="field"><span>Assigned lawyer</span><input className="input" name="lawyer" placeholder="Adv. R. Mehta" /></label>
                  <label className="field"><span>Email</span><input className="input" type="email" name="email" /></label>
                  <label className="field"><span>Phone</span><input className="input" name="phone" /></label>
                  <div className="field"><span>&nbsp;</span><button className="btn" style={{ height: 46 }}>Save client</button></div>
                </div>
              </form>
            )}

            <form className="row" style={{ marginBottom: 24 }}
              onSubmit={(e) => { e.preventDefault(); setParams(text.trim() ? { q: text.trim() } : {}); }}>
              <label className="search">
                <Icon name="search" size={18} />
                <input className="input" value={text} onChange={(e) => setText(e.target.value)}
                  placeholder="Search client, case number or assigned lawyer" />
              </label>
            </form>

            {data.rows.length ? (
              <div className="scroll-x">
                <table className="table stack-sm">
                  <thead><tr><th>Client</th><th>Matters</th><th>Documents</th><th>Next hearing</th><th>Lawyer</th><th className="r">Balance due</th></tr></thead>
                  <tbody>
                    {data.rows.map((c) => (
                      <tr className="link" key={c.id} onClick={() => navigate(`/clients/${c.id}`)}>
                        <td>
                          <Link className="t" to={`/clients/${c.id}`}>{c.name}</Link>
                          <div className="s">{c.code}{c.matter && ` · ${c.matter}`}</div>
                        </td>
                        <td>{c.matters} active</td>
                        <td>{c.docs}</td>
                        <td>{c.next_hearing ? niceDate(c.next_hearing) : "Not scheduled"}</td>
                        <td className="muted">{c.lawyer || "—"}</td>
                        <td className={`r${c.balance ? " text-amber" : ""}`} style={{ fontWeight: 500 }}>{inr(c.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="empty">No clients match “{q}”.</div>}
          </div>
        </>
      )}
    </>
  );
}
