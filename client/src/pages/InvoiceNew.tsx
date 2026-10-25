import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { addDays, inr, isoDate, today } from "../../../shared/format";
import type { Client } from "../../../shared/types";
import { api } from "../api";
import { Crumbs, Loading, PageHead } from "../components/common";
import { useFlash } from "../components/Flash";
import { Icon } from "../components/Icon";
import { useApi, useTitle } from "../hooks";

interface Line { key: number; service: string; qty: number; rate: number }

let nextKey = 3;

export function InvoiceNew() {
  useTitle("New invoice");
  const { data, error } = useApi<{ clients: Client[] }>("/upload-options");
  const [params] = useSearchParams();
  const [clientId, setClientId] = useState(params.get("client") ?? "");
  const [caseNumber, setCaseNumber] = useState("");
  const [issued, setIssued] = useState(isoDate());
  const [due, setDue] = useState(isoDate(addDays(today(), 14)));
  const [retainer, setRetainer] = useState(0);
  const [lines, setLines] = useState<Line[]>([
    { key: 1, service: "Consultation", qty: 1, rate: 2000 },
    { key: 2, service: "Document review", qty: 1, rate: 5000 },
  ]);
  const [busy, setBusy] = useState(false);
  const flash = useFlash();
  const navigate = useNavigate();

  if (!data) return <Loading error={error} />;

  const total = lines.reduce((s, l) => s + (l.qty || 0) * (l.rate || 0), 0);
  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post<{ id: number; message: string }>("/invoices", {
        client_id: Number(clientId), case_number: caseNumber, issued, due, retainer, lines,
      });
      flash(r.message);
      navigate(`/billing/${r.id}`);
    } catch (err) {
      flash((err as Error).message, "error");
      setBusy(false);
    }
  };

  return (
    <>
      <Crumbs parent="Billing" to="/billing" current="New invoice" />
      <PageHead eyebrow="New invoice" title="Fees, expenses" soft="and retainers." />

      <form className="split" onSubmit={submit}>
        <div className="card">
          <div className="grid g2" style={{ gap: 24 }}>
            <label className="field">
              <span>Client</span>
              <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)} required>
                <option value="">Choose a client</option>
                {data.clients.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.code}</option>)}
              </select>
            </label>
            <label className="field"><span>Case number</span>
              <input className="input" value={caseNumber} onChange={(e) => setCaseNumber(e.target.value)} placeholder="Optional" />
            </label>
            <label className="field"><span>Issued</span>
              <input className="input" type="date" value={issued} onChange={(e) => setIssued(e.target.value)} />
            </label>
            <label className="field"><span>Due</span>
              <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </label>
          </div>

          <div className="divider" />
          <div className="lines">
            <div className="line label" style={{ marginBottom: 4 }}><span>Service</span><span>Qty</span><span>Rate (₹)</span><span /></div>
            {lines.map((l) => (
              <div className="line" key={l.key}>
                <input className="input" value={l.service} placeholder="e.g. Court appearance"
                  onChange={(e) => update(l.key, { service: e.target.value })} />
                <input className="input" type="number" min={1} value={l.qty} onChange={(e) => update(l.key, { qty: +e.target.value })} />
                <input className="input" type="number" min={0} value={l.rate} onChange={(e) => update(l.key, { rate: +e.target.value })} />
                <button type="button" className="btn quiet sm" style={{ height: 46 }} aria-label="Remove line"
                  onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Icon name="x" size={15} /></button>
              </div>
            ))}
          </div>
          <button type="button" className="btn ghost sm"
            onClick={() => setLines((ls) => [...ls, { key: nextKey++, service: "", qty: 1, rate: 0 }])}>
            <Icon name="plus" size={14} /> Add line
          </button>

          <div className="divider" />
          <label className="field" style={{ maxWidth: 240 }}><span>Retainer received (₹)</span>
            <input className="input" type="number" min={0} value={retainer} onChange={(e) => setRetainer(+e.target.value)} />
          </label>
        </div>

        <aside className="card stack" style={{ position: "sticky", top: 88 }}>
          <div className="label">Preview</div>
          <div className="totals" style={{ width: "100%" }}>
            <div className="row"><span className="muted">Total fees</span><span>{inr(total)}</span></div>
            <div className="row"><span className="muted">Retainer</span><span>– {inr(retainer)}</span></div>
            <div className="row due"><span>Balance due</span><span>{inr(Math.max(total - retainer, 0))}</span></div>
          </div>
          <button className="btn block" disabled={busy}>Create invoice</button>
          <p className="small faint">Illustrative amounts. Tax is configured separately.</p>
        </aside>
      </form>
    </>
  );
}
