import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { filesize, niceDate } from "../../../shared/format";
import type { DocRow } from "../../../shared/types";
import { Loading, PageHead, docBadge } from "../components/common";
import { Icon } from "../components/Icon";
import { useApi, useTitle } from "../hooks";

export function Documents() {
  useTitle("Documents");
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const type = params.get("type") ?? "";
  const [text, setText] = useState(q);
  useEffect(() => setText(q), [q]);
  const { data, error } = useApi<{ rows: DocRow[]; took: number; types: string[] }>(
    `/documents?${new URLSearchParams({ q, type })}`,
  );
  const navigate = useNavigate();

  const set = (next: { q?: string; type?: string }) => {
    const p = new URLSearchParams();
    const nq = next.q ?? q;
    const nt = next.type ?? type;
    if (nq) p.set("q", nq);
    if (nt) p.set("type", nt);
    setParams(p);
  };
  const submit = (e: FormEvent) => { e.preventDefault(); set({ q: text.trim() }); };

  return (
    <>
      <PageHead eyebrow="Documents" title="Find any file" soft="in seconds."
        lede="Search by case number, party, client, date, or any word inside the document. Try “Sharma”.">
        <Link className="btn" to="/upload"><Icon name="upload" size={16} /> Upload file</Link>
      </PageHead>

      <form className="row wrap-row" onSubmit={submit} style={{ marginBottom: 20 }}>
        <label className="search">
          <Icon name="search" size={18} />
          <input className="input" value={text} onChange={(e) => setText(e.target.value)}
            placeholder="Search case number, party, client or text…" autoFocus />
        </label>
        <select className="input" style={{ width: 180, height: 50 }} value={type} onChange={(e) => set({ type: e.target.value })}>
          <option value="">All types</option>
          {data?.types.map((t) => <option key={t}>{t}</option>)}
        </select>
        <button className="btn" style={{ height: 50 }}>Search</button>
      </form>

      {!data ? <Loading error={error} /> : (
        <>
          <p className="label" style={{ margin: "24px 0 16px" }}>
            {data.rows.length} file{data.rows.length === 1 ? "" : "s"}{q && ` matching “${q}”`} · {data.took.toFixed(1)} ms
            {(q || type) && <> · <Link to="/documents" style={{ textDecoration: "underline" }}>Clear</Link></>}
          </p>
          <div className="card">
            {data.rows.length ? (
              <div className="scroll-x">
                <table className="table stack-sm">
                  <thead><tr><th>Document</th><th>Client</th><th>Type</th><th>Hearing</th><th>Status</th><th className="r">Added</th></tr></thead>
                  <tbody>
                    {data.rows.map((d) => (
                      <tr className="link" key={d.id} onClick={() => navigate(`/documents/${d.id}`)}>
                        <td>
                          <div className="row" style={{ gap: 14 }}>
                            <span className="icon-tile"><Icon name="file" size={17} /></span>
                            <div>
                              <Link className="t" to={`/documents/${d.id}`}>{d.title}</Link>
                              <div className="s">{d.case_number || "No case number"} · {filesize(d.size)}{d.version > 1 && ` · v${d.version}`}</div>
                            </div>
                          </div>
                        </td>
                        <td>{d.client_name || "—"}</td>
                        <td><span className="badge line">{d.doc_type}</span></td>
                        <td>
                          {d.hearing_date
                            ? <>{niceDate(d.hearing_date)}{!d.hearing_confirmed && <span className="faint small"> · to confirm</span>}</>
                            : <span className="faint">—</span>}
                        </td>
                        <td><span className={docBadge(d.status)}>{d.status}</span></td>
                        <td className="r muted small nowrap">{niceDate(d.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty">
                <p>No files match.</p>
                <Link className="btn ghost sm" style={{ marginTop: 16 }} to="/upload">Upload a file</Link>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
