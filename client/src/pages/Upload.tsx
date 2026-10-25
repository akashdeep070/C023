import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { Client, Meta } from "../../../shared/types";
import { api } from "../api";
import { Loading, PageHead } from "../components/common";
import { useFlash } from "../components/Flash";
import { Icon } from "../components/Icon";
import { useApi, useTitle } from "../hooks";

const STEPS: [string, string, string, string][] = [
  ["fingerprint", "Fingerprint", "A SHA-256 hash proves the file is never changed later.", "green"],
  ["lock", "Locked copy", "A read-only copy is kept, like S3 Object Lock, so it can be restored.", "green"],
  ["scan", "Read", "Text is pulled from PDFs. Photos are read by Groq's vision model.", "purple"],
  ["sparkles", "Summarize", "A small Groq model writes a 3-line summary and finds the next hearing.", "purple"],
  ["user-check", "You confirm", "The AI suggests. You confirm the date before any reminder goes out.", "amber"],
];

export function Upload() {
  useTitle("Upload");
  const { data, error } = useApi<{ clients: Client[]; doc_types: string[] }>("/upload-options");
  const meta = useApi<Meta>("/meta").data;
  const maxMb = meta?.max_upload_mb ?? 20;
  const [params] = useSearchParams();
  const [file, setFile] = useState<File | null>(null);
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
      flash("Uploaded, fingerprinted and summarized.");
      navigate(`/documents/${r.id}`);
    } catch (err) {
      flash((err as Error).message, "error");
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead eyebrow="Upload" title="One upload page." soft="Every document."
        lede="Scans, photos and PDFs from WhatsApp, email or a pen drive all go here. Each file gets a SHA-256 fingerprint, a locked copy and an AI summary." />

      <form className="split" onSubmit={submit}>
        <div className="stack">
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
            <div className="grid g2" style={{ gap: 24 }}>
              <label className="field" style={{ gridColumn: "1 / -1" }}>
                <span>Title</span>
                <input className="input" name="title" placeholder="Leave blank to use the file name" />
              </label>
              <label className="field">
                <span>Client</span>
                <select className="input" name="client_id" value={client} onChange={(e) => setClient(e.target.value)}>
                  <option value="">No client yet</option>
                  {data.clients.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.code}</option>)}
                  <option value="new">+ New client…</option>
                </select>
              </label>
              {client === "new" && (
                <label className="field">
                  <span>New client name</span>
                  <input className="input" name="new_client" placeholder="e.g. Demo Client D" autoFocus />
                </label>
              )}
              <label className="field">
                <span>Case number</span>
                <input className="input" name="case_number" placeholder="Auto-detect, or e.g. CS 214/2026" />
              </label>
              <label className="field">
                <span>Document type</span>
                <select className="input" name="doc_type" defaultValue="">
                  <option value="">Auto-detect with AI</option>
                  {data.doc_types.map((t) => <option key={t}>{t}</option>)}
                </select>
              </label>
            </div>
          </div>

          <div className="row wrap-row" style={{ gap: 16 }}>
            <button className="btn" type="submit" disabled={busy}><Icon name="upload" size={16} /> Upload and read</button>
            {busy && <span className="muted small">Fingerprinting and reading with {meta?.ai.enabled ? "Groq" : "the local reader"}…</span>}
          </div>
        </div>

        <aside className="stack">
          <div className="card soft">
            <div className="label" style={{ marginBottom: 20 }}>What happens next</div>
            <div className="list">
              {STEPS.map(([icon, title, text, tone]) => (
                <div className="row" style={{ alignItems: "flex-start", gap: 16 }} key={title}>
                  <span className={`icon-tile ${tone}`}><Icon name={icon} size={17} /></span>
                  <div><h4>{title}</h4><p className="small muted" style={{ marginTop: 4 }}>{text}</p></div>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="label" style={{ marginBottom: 12 }}>Try it in the demo</div>
            <p className="small muted">
              Sample files live in the <span className="mono">samples/</span> folder. Upload <span className="mono">sample-bail-order.pdf</span> and
              ask “When was bail granted?”
            </p>
          </div>
        </aside>
      </form>
    </>
  );
}
