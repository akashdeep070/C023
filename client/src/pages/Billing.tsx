import { Link, useNavigate } from "react-router-dom";
import { inr, niceDate } from "../../../shared/format";
import type { InvoiceTotals } from "../../../shared/types";
import { Loading, PageHead, invoiceBadge } from "../components/common";
import { Icon } from "../components/Icon";
import { useApi, useTitle } from "../hooks";

interface Data { rows: InvoiceTotals[]; totals: { billed: number; received: number; outstanding: number } }

export function Billing() {
  useTitle("Billing");
  const { data, error } = useApi<Data>("/invoices");
  const navigate = useNavigate();

  return (
    <>
      <PageHead eyebrow="Billing" title="Bill by client." soft="Export a clear PDF."
        lede="Itemized invoices, recorded payments and printable receipts, linked to the right client and case.">
        <Link className="btn" to="/billing/new"><Icon name="plus" size={16} /> New invoice</Link>
      </PageHead>

      {!data ? <Loading error={error} /> : (
        <>
          <div className="grid g3" style={{ marginBottom: 20 }}>
            <div className="card kpi"><div className="label">Billed</div><div className="num">{inr(data.totals.billed)}</div></div>
            <div className="card kpi"><div className="label">Received</div><div className="num green">{inr(data.totals.received)}</div></div>
            <div className="card kpi"><div className="label">Outstanding</div><div className={`num ${data.totals.outstanding ? "amber" : "green"}`}>{inr(data.totals.outstanding)}</div></div>
          </div>

          <div className="card">
            {data.rows.length ? (
              <div className="scroll-x">
                <table className="table stack-sm">
                  <thead><tr><th>Invoice</th><th>Client</th><th>Issued</th><th>Due</th><th>Status</th><th className="r">Total</th><th className="r">Balance</th></tr></thead>
                  <tbody>
                    {data.rows.map((t) => (
                      <tr className="link" key={t.inv.id} onClick={() => navigate(`/billing/${t.inv.id}`)}>
                        <td>
                          <Link className="t mono" to={`/billing/${t.inv.id}`}>{t.inv.number}</Link>
                          <div className="s">{t.inv.case_number || "General"}</div>
                        </td>
                        <td>{t.client_name}</td>
                        <td className="muted">{niceDate(t.inv.issued)}</td>
                        <td className="muted">{niceDate(t.inv.due)}</td>
                        <td><span className={invoiceBadge(t.status)}>{t.status}</span></td>
                        <td className="r">{inr(t.total)}</td>
                        <td className={`r ${t.status === "Overdue" ? "text-red" : t.balance ? "text-amber" : "text-green"}`} style={{ fontWeight: 500 }}>{inr(t.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="empty">No invoices yet.</div>}
          </div>

          <div className="card soft" style={{ marginTop: 20 }}>
            <div className="row wrap-row" style={{ gap: 12 }}>
              {["Draft", "Lawyer approval", "PDF invoice", "Record payment", "Receipt", "Updated balance"].map((s, i, all) => (
                <span className="row" style={{ gap: 12 }} key={s}>
                  <span className="chip">{s}</span>
                  {i < all.length - 1 && <span className="faint"><Icon name="arrow-right" size={14} /></span>}
                </span>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
