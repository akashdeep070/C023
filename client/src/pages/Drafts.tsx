import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { niceTime } from "../../../shared/format";
import { TEMPLATES, preview, type DocTemplate } from "../../../shared/templates";
import type { DraftRow, MatterRow } from "../../../shared/types";
import { api } from "../api";
import { Loading, PageHead, blanksBadge } from "../components/common";
import { useFlash } from "../components/Flash";
import { Icon } from "../components/Icon";
import { useApi, useTitle } from "../hooks";

// Built once: the gallery shows each template with its blanks highlighted
const PREVIEWS = new Map(TEMPLATES.map((t) => [t.id, preview(t)]));

export function Drafts() {
  useTitle("Drafts");
  const [params, setParams] = useSearchParams();
  const matter = params.get("matter") ?? "";
  const { data: drafts, error, reload } = useApi<DraftRow[]>("/drafts");
  const { data: options } = useApi<{ matters: MatterRow[] }>("/upload-options");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const navigate = useNavigate();
  const flash = useFlash();

  const start = async (t: DocTemplate) => {
    setBusy(t.id);
    try {
      const r = await api.post<{ id: number }>("/drafts", { template_id: t.id, matter_id: matter || null });
      navigate(`/drafts/${r.id}`);
    } catch (err) {
      flash((err as Error).message, "error");
      setBusy(null);
    }
  };
  const act = async (path: string, then?: (r: { id?: number }) => void) => {
    try {
      const r = await api.post<{ id?: number; message?: string }>(path);
      flash(r.message ?? "Done.");
      then ? then(r) : reload();
    } catch (err) {
      flash((err as Error).message, "error");
    }
  };

  const needle = q.trim().toLowerCase();
  const shown = (drafts ?? []).filter((d) =>
    !needle || [d.title, d.case_number, d.matter_title, d.client_name].some((v) => v?.toLowerCase().includes(needle)));

  return (
    <>
      <PageHead eyebrow="Drafting" title="Drafts" lede="Start from a template. Blanks the matter can answer are filled in for you; the rest are highlighted." />

      <section className="tpl-band">
        <div className="row between wrap-row" style={{ marginBottom: 20, gap: 16 }}>
          <h3>Start a new document</h3>
          <label className="row small" style={{ gap: 10 }}>
            <span className="muted nowrap">Fill in from</span>
            <select className="input" style={{ height: 36, width: 280, fontSize: 13 }} value={matter}
              onChange={(e) => setParams(e.target.value ? { matter: e.target.value } : {})} aria-label="Matter to fill in from">
              <option value="">No matter</option>
              {options?.matters.map((m) => (
                <option key={m.id} value={m.id}>{m.case_number ? `${m.case_number} · ${m.title}` : m.title}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="tpl-grid">
          {TEMPLATES.map((t) => (
            <button className="tpl" key={t.id} onClick={() => start(t)} disabled={busy !== null} title={t.blurb}>
              <div className="tpl-thumb">
                {t.id === "blank"
                  ? <span className="tpl-plus"><Icon name="plus" size={40} stroke={1.4} /></span>
                  : <div className="tpl-mini doc-text" dangerouslySetInnerHTML={{ __html: PREVIEWS.get(t.id)! }} />}
                {busy === t.id && <span className="tpl-busy"><span className="spinner" /></span>}
              </div>
              <div className="tpl-name">{t.name}</div>
              <div className="tpl-group">{t.fromFile ? <><Icon name="file" size={12} /> From your files</> : t.group}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="section card">
        <div className="card-head" style={{ alignItems: "center" }}>
          <div>
            <h3>Recent documents</h3>
            <div className="small muted" style={{ marginTop: 4 }}>Saved as you type</div>
          </div>
          <div className="search" style={{ maxWidth: 300 }}>
            <Icon name="search" size={16} />
            <input className="input" style={{ height: 40, fontSize: 14 }} placeholder="Search drafts" value={q}
              onChange={(e) => setQ(e.target.value)} aria-label="Search drafts" />
          </div>
        </div>
        {!drafts ? <Loading error={error} /> : shown.length ? (
          <div className="scroll-x">
            <table className="table compact stack-sm">
              <thead><tr><th>Name</th><th>Matter</th><th>Blanks</th><th>Last edited</th><th className="r"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {shown.map((d) => (
                  <tr key={d.id} className="link" onClick={() => navigate(`/drafts/${d.id}`)}>
                    <td>
                      <div className="row" style={{ gap: 12 }}>
                        <span className="icon-tile blue" style={{ width: 34, height: 34 }}><Icon name="file-pen" size={16} /></span>
                        <Link className="t" to={`/drafts/${d.id}`} onClick={(e) => e.stopPropagation()}>{d.title}</Link>
                      </div>
                    </td>
                    <td className="small">
                      {d.matter_id ? <><div>{d.case_number || d.matter_title}</div><div className="muted">{d.client_name}</div></> : <span className="muted">—</span>}
                    </td>
                    <td>{blanksBadge(d.blanks)}</td>
                    <td className="small muted nowrap">{niceTime(d.updated_at)}</td>
                    <td className="r nowrap" onClick={(e) => e.stopPropagation()}>
                      <button className="btn quiet sm" title="Make a copy" aria-label={`Make a copy of ${d.title}`}
                        onClick={() => act(`/drafts/${d.id}/copy`, (r) => navigate(`/drafts/${r.id}`))}><Icon name="copy" size={15} /></button>
                      <button className="btn quiet sm text-red" title="Delete" aria-label={`Delete ${d.title}`}
                        onClick={() => window.confirm(`Delete "${d.title}"? This cannot be undone.`) && act(`/drafts/${d.id}/delete`)}>
                        <Icon name="trash" size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="empty">{needle ? "No drafts match that search." : "No drafts yet. Pick a template above."}</div>}
      </section>
    </>
  );
}
