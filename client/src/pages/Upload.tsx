import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { Client, MatterRow, Meta } from "../../../shared/types";
import { api } from "../api";
import { Loading, PageHead } from "../components/common";
import { useFlash } from "../components/Flash";
import { Icon } from "../components/Icon";
import { useApi, useTitle } from "../hooks";

export function Upload() {
  useTitle("Upload");
  const { data, error } = useApi<{ clients: Client[]; matters: MatterRow[]; doc_types: string[] }>("/upload-options");
  const meta = useApi<Meta>("/meta").data;
  const maxMb = meta?.max_upload_mb ?? 20;
  const [params] = useSearchParams();
  const [file, setFile] = useState<File | null>(null);
  const [matter, setMatter] = useState(params.get("matter") ?? "");
  const [client, setClient] = useState(params.get("client") ?? "");
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const flash = useFlash();
  const navigate = useNavigate();

  if (!data) return <Loading error={error} />;

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!file) return flash("Choose a file to upload.", "error");
    if (file.size > maxMb * 1024 * 1024) return flash(`Files must be ${maxMb} MB or smaller.`, "error");
    setBusy(true);
    try {
      const form = new FormData(e.currentTarget);
      form.set("file", file);
      const r = await api.upload<{ id: number }>("/documents", form);
      flash("Uploaded. Check the summary and any date it found.");
      navigate(`/documents/${r.id}`);
    } catch (err) {
      flash((err as Error).message, "error");
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead title="Upload a document"
        lede="Orders, notices, pleadings, or photos of papers. LEX AI keeps a fingerprinted copy, reads it and suggests the next date." />

      <form className="stack" style={{ maxWidth: 820 }} onSubmit={submit}>
        <label className={`drop${over ? " over" : ""}`}
          onDragEnter={() => setOver(true)} onDragOver={() => setOver(true)}
          onDragLeave={() => setOver(false)} onDrop={() => setOver(false)}>
          <input type="file" accept=".pdf,.txt,.md,.png,.jpg,.jpeg,.webp"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <span className="icon-tile"><Icon name="upload" size={24} /></span>
          <h3>Drop a file here, or click to choose</h3>
          <p className="muted small" style={{ marginTop: 8 }}>PDF, TXT, PNG, JPG or WEBP · up to {maxMb} MB</p>
          {file && <div className="picked">{file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB</div>}
        </label>

        <div className="card">
          <div className="grid g2" style={{ gap: 20 }}>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>File under matter</span>
              <select className="input" name="matter_id" value={matter} onChange={(e) => setMatter(e.target.value)}>
                <option value="">Not filed yet, or a new case</option>
                {data.matters.map((m) => (
                  <option key={m.id} value={m.id}>{m.case_number ? `${m.case_number} · ${m.title}` : m.title}</option>
                ))}
              </select>
            </label>
            {!matter && (
              <>
                <label className="field">
                  <span>Client</span>
                  <select className="input" name="client_id" value={client} onChange={(e) => setClient(e.target.value)}>
                    <option value="">No client yet</option>
                    {data.clients.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.code}</option>)}
                    <option value="new">+ New client…</option>
                  </select>
                </label>
                {client === "new" ? (
                  <label className="field">
                    <span>New client name</span>
                    <input className="input" name="new_client" autoFocus />
                  </label>
                ) : (
                  <label className="field">
                    <span>Case number</span>
                    <input className="input" name="case_number" placeholder="Leave blank to read it from the file" />
                  </label>
                )}
              </>
            )}
            <label className="field">
              <span>Title</span>
              <input className="input" name="title" placeholder="Leave blank to use the file name" />
            </label>
            <label className="field">
              <span>Document type</span>
              <select className="input" name="doc_type" defaultValue="">
                <option value="">Detect from the file</option>
                {data.doc_types.map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>
          </div>
        </div>

        <div className="row wrap-row" style={{ gap: 16 }}>
          <button className="btn" type="submit" disabled={busy}><Icon name="upload" size={16} /> Upload</button>
          {busy && <span className="muted small">Reading the file{meta?.ai.enabled ? " with Groq" : ""}…</span>}
        </div>
      </form>
    </>
  );
}
