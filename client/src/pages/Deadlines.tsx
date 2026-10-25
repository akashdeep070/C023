import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { daysFromToday, isoDate, niceDate, until } from "../../../shared/format";
import { RULES, compute } from "../../../shared/limitation";
import type { Deadline } from "../../../shared/types";
import { api } from "../api";
import { DeadlineLine, Loading, PageHead } from "../components/common";
import { useFlash } from "../components/Flash";
import { Icon } from "../components/Icon";
import { useApi, useTitle } from "../hooks";

interface Data { open: Deadline[]; done: Deadline[]; matters: { id: number; label: string }[] }

const GROUPS = [...new Set(RULES.map((r) => r.group))];

function Calculator({ matters, onAdded }: { matters: Data["matters"]; onAdded: () => void }) {
  const [params] = useSearchParams();
  const [ruleId, setRuleId] = useState(RULES[0].id);
  const [start, setStart] = useState(isoDate());
  const [exclude, setExclude] = useState(0);
  const [matter, setMatter] = useState(params.get("matter") ?? "");
  const flash = useFlash();
  const rule = RULES.find((r) => r.id === ruleId)!;
  const result = useMemo(() => (start ? compute(rule, start, exclude) : null), [rule, start, exclude]);
  const left = result ? daysFromToday(result.last) : 0;

  const add = async () => {
    if (!result) return;
    try {
      const r = await api.post("/deadlines", {
        title: rule.label, due: result.last, rule: rule.ref, matter_id: Number(matter) || null,
      });
      flash(r.message ?? "Added.");
      onAdded();
    } catch (err) {
      flash((err as Error).message, "error");
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h3>Limitation calculator</h3>
          <div className="small muted" style={{ marginTop: 4 }}>Common periods under Indian law</div>
        </div>
        <span className="icon-tile amber"><Icon name="hourglass" size={17} /></span>
      </div>
      <div className="stack" style={{ gap: 14 }}>
        <label className="field"><span>What are you filing?</span>
          <select className="input" value={ruleId} onChange={(e) => setRuleId(e.target.value)}>
            {GROUPS.map((g) => (
              <optgroup label={g} key={g}>
                {RULES.filter((r) => r.group === g).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="field"><span>{rule.from}</span>
          <input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="field"><span>Days to exclude (e.g. waiting for a certified copy)</span>
          <input className="input" type="number" min={0} value={exclude} onChange={(e) => setExclude(Math.max(0, +e.target.value))} />
        </label>
      </div>

      {result && (
        <div className={`limit-result ${left < 0 ? "red" : left <= 7 ? "amber" : "blue"}`}>
          <div className="label">Last date</div>
          <div className="big">{niceDate(result.last, "%a, %-d %B %Y")}</div>
          <div className="small">{left < 0 ? `Expired ${until(result.last).toLowerCase()}` : until(result.last)}</div>
          {result.closedDay && <div className="small" style={{ marginTop: 6 }}>Falls on a Sunday. If the court is closed, you may file on the day it reopens (s.4).</div>}
          {result.outer && rule.outer && (
            <div className="small" style={{ marginTop: 8 }}><b>Outer limit {niceDate(result.outer, "%-d %b %Y")}.</b> {rule.outer.note}</div>
          )}
        </div>
      )}
      <p className="small muted" style={{ marginTop: 12 }}>
        {rule.ref}.{rule.note ? ` ${rule.note}` : ""} Check the statute and court rules before relying on this date.
      </p>

      <div className="divider" />
      <div className="row" style={{ gap: 8 }}>
        <select className="input grow" value={matter} onChange={(e) => setMatter(e.target.value)} aria-label="Matter">
          <option value="">No matter</option>
          {matters.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <button className="btn" onClick={add} disabled={!result}><Icon name="plus" size={15} /> Add deadline</button>
      </div>
    </div>
  );
}

export function Deadlines() {
  useTitle("Deadlines");
  const { data, error, reload } = useApi<Data>("/deadlines");

  const toggle = async (d: Deadline) => {
    await api.post(`/deadlines/${d.id}/done`, { done: !d.done });
    reload();
  };

  const groups = data ? [
    { name: "Overdue", tone: "red", rows: data.open.filter((d) => daysFromToday(d.due) < 0) },
    { name: "Due in the next 7 days", tone: "amber", rows: data.open.filter((d) => { const n = daysFromToday(d.due); return n >= 0 && n <= 7; }) },
    { name: "Later", tone: "", rows: data.open.filter((d) => daysFromToday(d.due) > 7) },
  ] : [];

  return (
    <>
      <PageHead title="Deadlines" lede="Filing dates and limitation periods. Tick them off as you go." />
      {!data ? <Loading error={error} /> : (
        <div className="split">
          <div className="stack">
            {groups.map((g) => (
              <div className="card" key={g.name}>
                <div className="card-head">
                  <h3 className={g.tone ? `text-${g.tone}` : ""}>{g.name}</h3>
                  <span className={`badge ${g.rows.length ? g.tone : ""}`}>{g.rows.length}</span>
                </div>
                {g.rows.length
                  ? <div className="list">{g.rows.map((d) => <DeadlineLine d={d} key={d.id} onToggle={toggle} />)}</div>
                  : <p className="small muted">Nothing here.</p>}
              </div>
            ))}
            {data.done.length > 0 && (
              <details className="card">
                <summary className="row between" style={{ cursor: "pointer" }}><h3>Done recently</h3><span className="badge green">{data.done.length}</span></summary>
                <div className="list" style={{ marginTop: 18 }}>{data.done.map((d) => <DeadlineLine d={d} key={d.id} onToggle={toggle} />)}</div>
              </details>
            )}
          </div>
          <aside className="stack">
            <Calculator matters={data.matters} onAdded={reload} />
          </aside>
        </div>
      )}
    </>
  );
}
