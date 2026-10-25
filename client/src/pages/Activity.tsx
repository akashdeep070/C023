import { Link } from "react-router-dom";
import { niceTime } from "../../../shared/format";
import type { AuditRow } from "../../../shared/types";
import { Loading, PageHead, actionTone } from "../components/common";
import { useApi, useTitle } from "../hooks";

export function Activity() {
  useTitle("Audit log");
  const { data, error } = useApi<AuditRow[]>("/activity");

  return (
    <>
      <PageHead eyebrow="Audit trail" title="Who did what," soft="and when."
        lede="Every upload, view, AI run, confirmation, reminder and integrity check is recorded. In production this is CloudTrail plus the app's own log." />
      {!data ? <Loading error={error} /> : (
        <div className="card">
          {data.length ? (
            <div className="scroll-x">
              <table className="table compact stack-sm">
                <thead><tr><th>When</th><th>Action</th><th>Document / client</th><th>Detail</th><th className="r">By</th></tr></thead>
                <tbody>
                  {data.map((a) => (
                    <tr key={a.id}>
                      <td className="muted small nowrap">{niceTime(a.ts)}</td>
                      <td>
                        <span className={`badge ${actionTone(a.action)}`}>{a.action}</span>
                      </td>
                      <td>
                        {a.document_id && a.doc_title ? <Link className="t" to={`/documents/${a.document_id}`}>{a.doc_title}</Link>
                          : a.client_id && a.client_name ? <Link className="t" to={`/clients/${a.client_id}`}>{a.client_name}</Link>
                            : <span className="faint">—</span>}
                      </td>
                      <td className="small muted">{a.detail}</td>
                      <td className="r small nowrap">{a.actor}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="empty">No activity yet.</div>}
        </div>
      )}
    </>
  );
}
