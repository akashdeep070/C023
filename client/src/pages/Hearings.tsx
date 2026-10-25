import { useMemo, useState } from "react";
import { addDays, isoDate, strftime, today } from "../../../shared/format";
import type { Doc, HearingsData } from "../../../shared/types";
import { api } from "../api";
import { HearingRow, Loading, PageHead } from "../components/common";
import { useFlash } from "../components/Flash";
import { Icon } from "../components/Icon";
import { useApi, useTitle } from "../hooks";

/** Monday-first weeks covering the month that contains `first`. */
function monthWeeks(first: Date): Date[][] {
  const start = addDays(first, -((first.getDay() + 6) % 7));
  const weeks = Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, i) => addDays(start, w * 7 + i)));
  return weeks[5][0].getMonth() !== first.getMonth() ? weeks.slice(0, 5) : weeks;
}

export function Hearings() {
  useTitle("Hearings");
  const { data, error, reload } = useApi<HearingsData>("/hearings");
  const flash = useFlash();
  const now = today();
  const [month, setMonth] = useState(new Date(now.getFullYear(), now.getMonth(), 1));
  const weeks = useMemo(() => monthWeeks(month), [month]);
  const marks = useMemo(() => {
    const m = new Map<string, Doc[]>();
    for (const h of data?.all ?? []) m.set(h.hearing_date, [...(m.get(h.hearing_date) ?? []), h]);
    return m;
  }, [data]);

  if (!data) return <Loading error={error} />;

  const remind = async () => {
    const r = await api.post("/hearings/remind");
    flash(r.message ?? "Done.");
    reload();
  };
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));

  return (
    <>
      <PageHead eyebrow="Hearings" title="No hearing" soft="slips through."
        lede="The AI finds dates in orders and notices. You confirm them, and a reminder goes out the day before.">
        <button className="btn" onClick={remind}>
          <Icon name="bell" size={16} /> Send due reminders{data.due ? ` (${data.due})` : ""}
        </button>
      </PageHead>

      <div className="split">
        <div className="stack">
          {data.pending.length > 0 && (
            <div className="card" style={{ borderStyle: "dashed", borderColor: "var(--line-strong)" }}>
              <div className="card-head">
                <div>
                  <h3>Waiting for you to confirm</h3>
                  <div className="small muted" style={{ marginTop: 4 }}>Suggested by AI. No reminder until you confirm.</div>
                </div>
                <span className="badge dash">{data.pending.length}</span>
              </div>
              <div className="list">{data.pending.map((h) => <HearingRow h={h} key={h.id} />)}</div>
            </div>
          )}

          <div className="card">
            <div className="card-head"><h3>Upcoming</h3><span className="badge">{data.upcoming.length}</span></div>
            {data.upcoming.length
              ? <div className="list">{data.upcoming.map((h) => <HearingRow h={h} key={h.id} />)}</div>
              : <div className="empty">No confirmed hearings ahead.</div>}
          </div>

          {data.past.length > 0 && (
            <div className="card">
              <div className="card-head"><h3 className="muted">Past</h3></div>
              <div className="list" style={{ opacity: 0.7 }}>{data.past.map((h) => <HearingRow h={h} key={h.id} />)}</div>
            </div>
          )}
        </div>

        <aside className="stack">
          <div className="card">
            <div className="row between" style={{ marginBottom: 22 }}>
              <h3>{strftime(month, "%B %Y")}</h3>
              <div className="row" style={{ gap: 4 }}>
                <button className="btn quiet sm" onClick={() => shift(-1)} aria-label="Previous month"><Icon name="arrow-left" size={14} /></button>
                <button className="btn quiet sm" onClick={() => setMonth(new Date(now.getFullYear(), now.getMonth(), 1))}>Today</button>
                <button className="btn quiet sm" onClick={() => shift(1)} aria-label="Next month"><Icon name="arrow-right" size={14} /></button>
              </div>
            </div>
            <div className="cal">
              {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => <div className="dow" key={d}>{d}</div>)}
              {weeks.flat().map((d) => {
                const hs = marks.get(isoDate(d)) ?? [];
                const confirmed = hs.some((h) => h.hearing_confirmed);
                const cls = ["day", d.getMonth() !== month.getMonth() && "out", isoDate(d) === isoDate(now) && "today",
                  confirmed ? "has" : hs.length ? "pending" : ""].filter(Boolean).join(" ");
                return (
                  <div className={cls} key={isoDate(d)} title={hs.map((h) => h.case_number || h.title).join("; ") || undefined}>
                    {d.getDate()}
                  </div>
                );
              })}
            </div>
            <div className="legend label" style={{ marginTop: 22 }}>
              <span><i style={{ background: "var(--ink)" }} />Confirmed</span>
              <span><i style={{ border: "1.5px dashed var(--muted)" }} />To confirm</span>
            </div>
          </div>
          <div className="card soft">
            <div className="label" style={{ marginBottom: 14 }}>How reminders work</div>
            <p className="small muted">
              In production, EventBridge Scheduler triggers SNS email one day before each confirmed hearing. In this demo,
              “Send due reminders” does the same job and writes it to the audit log.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
