import { isoDate, niceDate } from "../../../shared/format";

/** One series per day as thin bars, with a hover/focus tooltip on each day. */
export function DayBars({ data, unit, label }: { data: { date: string; count: number }[]; unit: string; label: string }) {
  const peak = Math.max(1, ...data.map((d) => d.count));
  const todayIso = isoDate();
  const plural = (n: number) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  return (
    <>
      <div className="chart" role="img" aria-label={label}>
        <div className="chart-plot">
          <div className="chart-grid">
            {[peak, Math.round(peak / 2), 0].map((v, i) => <div className="gl" key={i}><span>{v}</span></div>)}
          </div>
          <div className="chart-bars">
            {data.map((d) => (
              <div className={`col${d.date === todayIso ? " is-today" : ""}`} tabIndex={0} key={d.date}
                aria-label={`${niceDate(d.date, "%-d %b")}: ${plural(d.count)}`}>
                <div className="bar-fill" style={{ height: `${(d.count / peak) * 100}%` }} />
                <div className="tip"><b>{plural(d.count)}</b><br /><span>{niceDate(d.date, "%a %-d %b")}</span></div>
              </div>
            ))}
          </div>
        </div>
        <div className="chart-x">
          {data.map((d, i) => (
            <span key={d.date} className={d.date === todayIso ? "now" : ""}>
              {d.date === todayIso ? "Today" : i % 2 === 0 ? niceDate(d.date, "%-d") : ""}
            </span>
          ))}
        </div>
      </div>
      <div className="sr-only"><table>
        <caption>{label}</caption>
        <tbody>
          <tr><th>Date</th><th>{unit}s</th></tr>
          {data.map((d) => <tr key={d.date}><td>{niceDate(d.date)}</td><td>{d.count}</td></tr>)}
        </tbody>
      </table></div>
    </>
  );
}
