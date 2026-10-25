import { niceDate } from "../../../shared/format";

/** One series (actions per day) as thin bars, with a hover/focus tooltip on each day. */
export function ActivityChart({ data }: { data: { date: string; count: number }[] }) {
  const peak = Math.max(1, ...data.map((d) => d.count));
  return (
    <>
      <div className="chart" role="img" aria-label={`Bar chart of actions logged per day over the last ${data.length} days`}>
        <div className="chart-plot">
          <div className="chart-grid">
            {[peak, Math.round(peak / 2), 0].map((v, i) => <div className="gl" key={i}><span>{v}</span></div>)}
          </div>
          <div className="chart-bars">
            {data.map((d, i) => (
              <div className={`col${i === data.length - 1 ? " is-today" : ""}`} tabIndex={0} key={d.date}
                aria-label={`${niceDate(d.date, "%-d %b")}: ${d.count} actions`}>
                <div className="bar-fill" style={{ height: `${(d.count / peak) * 100}%` }} />
                <div className="tip"><b>{d.count}</b> action{d.count === 1 ? "" : "s"}<br /><span>{niceDate(d.date, "%a %-d %b")}</span></div>
              </div>
            ))}
          </div>
        </div>
        <div className="chart-x">
          {data.map((d, i) => (
            <span key={d.date}>{i === data.length - 1 ? "Today" : i % 2 === 0 ? niceDate(d.date, "%-d") : ""}</span>
          ))}
        </div>
      </div>
      <table className="sr-only">
        <caption>Actions logged per day</caption>
        <tbody>
          <tr><th>Date</th><th>Actions</th></tr>
          {data.map((d) => <tr key={d.date}><td>{niceDate(d.date)}</td><td>{d.count}</td></tr>)}
        </tbody>
      </table>
    </>
  );
}
