import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { inr, niceDate } from "../../../shared/format";
import type { Client, InvoiceTotals } from "../../../shared/types";
import { api } from "../api";
import { Crumbs, Loading, invoiceBadge } from "../components/common";
import { useFlash } from "../components/Flash";
import { Icon } from "../components/Icon";
import { useApi, useTitle } from "../hooks";

export function InvoicePage() {
  const { id } = useParams();
  const { data, error, reload } = useApi<{ t: InvoiceTotals; client: Client }>(`/invoices/${id}`);
  const [method, setMethod] = useState("UPI");
  const [amount, setAmount] = useState<number | "">("");
  const flash = useFlash();
  useTitle(data?.t.inv.number ?? "Invoice");
  if (!data) return <Loading error={error} />;
  const { t, client: c } = data;

  const pay = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const r = await api.post(`/invoices/${id}/payments`, { amount: amount === "" ? t.balance : amount, method });
      flash(r.message ?? "Recorded.");
      setAmount("");
      reload();
    } catch (err) {
      flash((err as Error).message, "error");
    }
  };

  return (
    <>
      <div className="no-print"><Crumbs parent="Billing" to="/billing" current={t.inv.number} /></div>

      <div className="split">
        <article className="card invoice">
          <div className="row between" style={{ alignItems: "flex-start" }}>
            <div>
              <div className="label">Lex AI · Demo practice</div>
              <h2 style={{ marginTop: 10 }}>INVOICE</h2>
            </div>
            <span className={invoiceBadge(t.status)}>{t.status}</span>
          </div>

          <div className="row between wrap-row" style={{ marginTop: 36, alignItems: "flex-start", gap: 32 }}>
            <div>
              <div className="label">Billed to</div>
              <div style={{ fontSize: 18, fontWeight: 600, marginTop: 8 }}>{c.name}</div>
              <div className="small muted">{c.code}{t.inv.case_number && ` · ${t.inv.case_number}`}{c.matter && ` · ${c.matter}`}</div>
            </div>
            <div className="small">
              <div className="label">{t.inv.number}</div>
              <div style={{ marginTop: 8 }}>Issued: {niceDate(t.inv.issued)}</div>
              <div>Due: {niceDate(t.inv.due)}</div>
            </div>
          </div>

          <table className="table" style={{ marginTop: 40 }}>
            <thead><tr><th>Service</th><th className="r">Qty</th><th className="r">Rate</th><th className="r">Amount</th></tr></thead>
            <tbody>
              {t.lines.map((l) => (
                <tr key={l.id}><td>{l.service}</td><td className="r">{l.qty}</td><td className="r">{inr(l.rate)}</td><td className="r">{inr(l.qty * l.rate)}</td></tr>
              ))}
            </tbody>
          </table>

          <div className="totals" style={{ marginTop: 28 }}>
            <div className="row"><span className="muted">Total fees</span><span>{inr(t.total)}</span></div>
            {t.inv.retainer > 0 && <div className="row"><span className="muted">Retainer received</span><span>– {inr(t.inv.retainer)}</span></div>}
            {t.payments.map((p) => (
              <div className="row" key={p.id}>
                <span className="muted">Paid {niceDate(p.paid_on)}{p.method && ` · ${p.method}`}</span><span>– {inr(p.amount)}</span>
              </div>
            ))}
            <div className="row due"><span>Balance due</span><span>{inr(t.balance)}</span></div>
          </div>

          <p className="small faint" style={{ marginTop: 40 }}>Illustrative amounts. Tax treatment is configured separately.</p>
        </article>

        <aside className="stack no-print">
          <button className="btn block" onClick={() => window.print()}><Icon name="download" size={16} /> Download PDF invoice</button>
          <div className="card">
            <div className="label" style={{ marginBottom: 18 }}>Record a payment</div>
            {t.balance > 0 ? (
              <form className="stack" style={{ gap: 14 }} onSubmit={pay}>
                <label className="field"><span>Amount (₹)</span>
                  <input className="input" type="number" min={1} max={t.balance} placeholder={String(t.balance)}
                    value={amount} onChange={(e) => setAmount(e.target.value === "" ? "" : +e.target.value)} />
                </label>
                <label className="field"><span>Method</span>
                  <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
                    {["UPI", "Bank transfer", "Cheque", "Cash"].map((m) => <option key={m}>{m}</option>)}
                  </select>
                </label>
                <button className="btn ghost">Record payment</button>
              </form>
            ) : <div className="check"><Icon name="check-circle" size={17} /> Paid in full.</div>}
          </div>
          <Link className="card row" to={`/clients/${c.id}`} style={{ gap: 14 }}>
            <span className="icon-tile"><Icon name="user" size={17} /></span>
            <div className="grow"><div style={{ fontWeight: 500 }}>{c.name}</div><div className="small muted">Open client workspace</div></div>
            <Icon name="arrow-right" size={16} />
          </Link>
        </aside>
      </div>
    </>
  );
}
