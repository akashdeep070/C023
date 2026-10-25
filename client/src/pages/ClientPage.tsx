import { Link, useParams } from "react-router-dom";
import { inr, niceDate } from "../../../shared/format";
import type { ClientDetail } from "../../../shared/types";
import { Crumbs, Loading, PageHead, Timeline, docBadge, invoiceBadge } from "../components/common";
import { Icon } from "../components/Icon";
import { useApi, useTitle } from "../hooks";

export function ClientPage() {
  const { id } = useParams();
  const { data, error } = useApi<ClientDetail>(`/clients/${id}`);
  useTitle(data?.client.name ?? "Client");
  if (!data) return <Loading error={error} />;
  const { client: c, docs, matters, invoices, balance } = data;

  return (
    <>
      <Crumbs parent="Clients" to="/clients" current={c.code} />
      <PageHead eyebrow={`${c.code}${c.matter ? ` · ${c.matter}` : ""}`} title={c.name}>
        <Link className="btn ghost" to={`/billing/new?client=${c.id}`}><Icon name="receipt" size={16} /> New invoice</Link>
        <Link className="btn" to={`/upload?client=${c.id}`}><Icon name="upload" size={16} /> Upload for client</Link>
      </PageHead>

      <div className="grid g4 kpis" style={{ marginBottom: 20 }}>
        <div className="card kpi"><div className="label">Matters</div><div className="num">{matters.length}</div></div>
        <div className="card kpi"><div className="label">Documents</div><div className="num">{docs.length}</div></div>
        <div className="card kpi"><div className="label">Invoices</div><div className="num">{invoices.length}</div></div>
        <div className="card kpi"><div className="label">Balance due</div><div className={`num ${balance ? "amber" : "green"}`}>{inr(balance)}</div></div>
      </div>

      <div className="split">
        <div className="stack">
          <div className="card">
            <div className="card-head"><h3>Matters</h3></div>
            {matters.length ? (
              <table className="table stack-sm">
                <thead><tr><th>Case</th><th>Documents</th><th className="r">Next hearing</th></tr></thead>
                <tbody>
                  {matters.map((m) => (
                    <tr key={m.case}><td className="t">{m.case}</td><td>{m.docs}</td><td className="r">{m.next ? niceDate(m.next) : "Not scheduled"}</td></tr>
                  ))}
                </tbody>
              </table>
            ) : <div className="empty">No matters yet.</div>}
          </div>

          <div className="card">
            <div className="card-head"><h3>Documents</h3></div>
            {docs.length ? (
              <div className="list">
                {docs.map((d) => (
                  <Link className="row" to={`/documents/${d.id}`} style={{ gap: 14 }} key={d.id}>
                    <span className="icon-tile"><Icon name="file" size={17} /></span>
                    <div className="grow">
                      <div style={{ fontWeight: 500 }}>{d.title}</div>
                      <div className="small muted">{d.doc_type} · {d.case_number || "No case"} · {niceDate(d.created_at)}</div>
                    </div>
                    <span className={docBadge(d.status)}>{d.status}</span>
                  </Link>
                ))}
              </div>
            ) : <div className="empty">No documents yet.</div>}
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Invoices</h3>
              <Link className="btn quiet sm" to={`/billing/new?client=${c.id}`}><Icon name="plus" size={14} /> New</Link>
            </div>
            {invoices.length ? (
              <div className="list">
                {invoices.map((t) => (
                  <Link className="row" to={`/billing/${t.inv.id}`} style={{ gap: 14 }} key={t.inv.id}>
                    <span className={`icon-tile ${t.status === "Overdue" ? "red" : t.balance ? "amber" : "green"}`}><Icon name="receipt" size={17} /></span>
                    <div className="grow">
                      <div className="mono" style={{ fontWeight: 500 }}>{t.inv.number}</div>
                      <div className="small muted">Issued {niceDate(t.inv.issued)} · due {niceDate(t.inv.due)}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontWeight: 500 }}>{inr(t.balance)}</div>
                      <span className={invoiceBadge(t.status)} style={{ marginTop: 4 }}>{t.status}</span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : <div className="empty">No invoices yet.</div>}
          </div>
        </div>

        <aside className="stack">
          <div className="card">
            <div className="row" style={{ gap: 14, marginBottom: 24 }}>
              <span className="icon-tile"><Icon name="user" size={18} /></span>
              <h3>Profile</h3>
            </div>
            <dl className="kv" style={{ margin: 0 }}>
              <dt>Email</dt><dd>{c.email || "—"}</dd>
              <dt>Phone</dt><dd>{c.phone || "—"}</dd>
              <dt>Lawyer</dt><dd>{c.lawyer || "—"}</dd>
              <dt>Since</dt><dd>{niceDate(c.created_at)}</dd>
            </dl>
          </div>
          <div className="card">
            <div className="label" style={{ marginBottom: 22 }}>Case activity timeline</div>
            <Timeline rows={data.activity} />
          </div>
        </aside>
      </div>
    </>
  );
}
