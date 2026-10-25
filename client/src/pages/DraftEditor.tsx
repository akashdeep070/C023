// A Google Docs-style editor for drafts: an A4 page, a formatting toolbar,
// autosave, and a side panel to fill blanks, follow the outline and link a matter.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { isoDate, niceDate, niceTime } from "../../../shared/format";
import { blankHtml, fieldValues, templateById, type FieldKey, type TemplateContext } from "../../../shared/templates";
import type { DraftDetail } from "../../../shared/types";
import { api } from "../api";
import { Loading } from "../components/common";
import { useFlash } from "../components/Flash";
import { Icon } from "../components/Icon";
import { useApi, useTitle } from "../hooks";
import { cleanHtml, download, fileName, wordFile } from "../richtext";

const A4_WIDTH = 794; // px at 96 dpi
const A4_RATIO = 297 / 210;

type SaveState = "saved" | "saving" | "unsaved" | "error";
type Pending = { title?: string; html?: boolean; matter_id?: number | null };
type MatterContext = Omit<TemplateContext, "today">;
interface BlankGroup { label: string; count: number; key: string | null }
interface Stats { words: number; pages: number; blanks: BlankGroup[]; headings: { level: number; text: string }[] }
interface Format { block: string; bold: boolean; italic: boolean; underline: boolean; strike: boolean; ol: boolean; ul: boolean; align: string }

const NO_FORMAT: Format = { block: "p", bold: false, italic: false, underline: false, strike: false, ol: false, ul: false, align: "left" };
const STYLES = [["p", "Normal text"], ["h1", "Heading 1"], ["h2", "Heading 2"], ["h3", "Heading 3"]];
const ZOOMS = ["fit", "50", "75", "90", "100", "125", "150"];
const SAVE_LABEL: Record<SaveState, [string, string]> = {
  saved: ["cloud-check", "All changes saved"], saving: ["cloud", "Saving…"],
  unsaved: ["cloud", "Unsaved changes"], error: ["cloud-off", "Not saved"],
};

function readFormat(): Format {
  const on = (cmd: string) => { try { return document.queryCommandState(cmd); } catch { return false; } };
  const block = (document.queryCommandValue("formatBlock") || "p").toLowerCase();
  return {
    block: ["h1", "h2", "h3"].includes(block) ? block : "p",
    bold: on("bold"), italic: on("italic"), underline: on("underline"), strike: on("strikeThrough"),
    ol: on("insertOrderedList"), ul: on("insertUnorderedList"),
    align: on("justifyCenter") ? "center" : on("justifyRight") ? "right" : on("justifyFull") ? "justify" : "left",
  };
}

const tableHtml = (rows: number, cols: number) =>
  `<table><tbody>${`<tr>${"<td><br></td>".repeat(cols)}</tr>`.repeat(rows)}</tbody></table><p><br></p>`;

export function DraftEditor() {
  const { id } = useParams();
  const { data, error } = useApi<DraftDetail>(`/drafts/${id}`);
  if (!data || String(data.draft.id) !== id) return <Loading error={error} />;
  return <Editor key={data.draft.id} detail={data} />;
}

function Editor({ detail }: { detail: DraftDetail }) {
  const { draft } = detail;
  const page = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const range = useRef<Range | null>(null);   // the last selection inside the page
  const pending = useRef<Pending>({});
  const saveTimer = useRef(0);
  const statsTimer = useRef(0);
  const [title, setTitle] = useState(draft.title);
  const [save, setSave] = useState<SaveState>("saved");
  const [savedAt, setSavedAt] = useState(draft.updated_at);
  const [saveError, setSaveError] = useState("");
  const [ctx, setCtx] = useState<MatterContext>({ matter: detail.matter, client: detail.client, last: detail.last, next: detail.next });
  const [stats, setStats] = useState<Stats>({ words: draft.words, pages: 1, blanks: [], headings: [] });
  const [format, setFormat] = useState(NO_FORMAT);
  const [tab, setTab] = useState<"blanks" | "outline" | "details">("blanks");
  const [zoom, setZoom] = useState("fit");
  const [fit, setFit] = useState(1);
  const [panel, setPanel] = useState(true);
  const navigate = useNavigate();
  const flash = useFlash();
  const template = templateById(draft.template_id);
  useTitle(title.trim() || "Untitled document");

  // ------------------------------------------------------------ saving

  const flush = useCallback(async () => {
    window.clearTimeout(saveTimer.current);
    const changes = pending.current;
    if (!Object.keys(changes).length) return;
    const body: Record<string, unknown> = { ...changes };
    delete body.html;
    if (changes.html) {
      if (!page.current) return; // never save an empty page by accident
      body.html = page.current.innerHTML;
    }
    pending.current = {};
    setSave("saving");
    let retry = true; // network trouble and server errors are retried; a refused save waits for the next edit
    try {
      const res = await fetch(`/api/drafts/${draft.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        retry = res.status >= 500;
        throw new Error(out.error ?? `Save failed (${res.status})`);
      }
      setSavedAt(out.updated_at);
      setSave(Object.keys(pending.current).length ? "unsaved" : "saved");
    } catch (err) {
      pending.current = { ...changes, ...pending.current };
      setSave("error");
      setSaveError(retry ? "Can't reach the server. Trying again in a few seconds." : (err as Error).message);
      if (retry) saveTimer.current = window.setTimeout(flush, 5000);
    }
  }, [draft.id]);

  const queue = useCallback((change: Pending) => {
    Object.assign(pending.current, change);
    setSave("unsaved");
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(flush, 800);
  }, [flush]);

  // ------------------------------------------------------------ word count, blanks, outline

  const measure = useCallback(() => {
    const el = page.current;
    if (!el) return;
    const groups = new Map<string, BlankGroup>();
    for (const m of el.querySelectorAll<HTMLElement>("mark.blank")) {
      const label = m.textContent ?? "";
      const g = groups.get(label) ?? { label, count: 0, key: m.dataset.key ?? null };
      g.count += 1;
      groups.set(label, g);
    }
    setStats({
      words: (el.innerText.match(/\S+/g) ?? []).length,
      pages: Math.max(1, Math.ceil(el.offsetHeight / el.offsetWidth / A4_RATIO - 0.02)),
      blanks: [...groups.values()],
      headings: [...el.querySelectorAll("h1, h2, h3")].map((h) => ({ level: Number(h.tagName[1]), text: h.textContent?.trim() || "Untitled heading" })),
    });
  }, []);

  const changed = useCallback(() => {
    queue({ html: true });
    window.clearTimeout(statsTimer.current);
    statsTimer.current = window.setTimeout(measure, 250);
  }, [queue, measure]);

  // Load the page once. React never re-renders its contents; the browser edits them.
  useLayoutEffect(() => {
    page.current!.innerHTML = cleanHtml(draft.html) || "<p><br></p>";
    document.execCommand("defaultParagraphSeparator", false, "p");
    measure();
    return () => { flush(); }; // runs while the page still exists
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Give the page room: fold the sidebar into icons while editing
    const root = document.documentElement;
    const hadRail = root.classList.contains("rail");
    root.classList.add("rail");

    const onUnload = (e: BeforeUnloadEvent) => {
      if (!Object.keys(pending.current).length || !page.current) return;
      const body = JSON.stringify({ ...pending.current, html: page.current.innerHTML });
      if (body.length > 60_000) { e.preventDefault(); return; } // too big to send while closing; ask the browser to warn
      fetch(`/api/drafts/${draft.id}`, { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body });
    };
    let frame = 0;
    const onSelection = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const sel = window.getSelection();
        if (!sel?.rangeCount || !page.current?.contains(sel.anchorNode)) return;
        range.current = sel.getRangeAt(0).cloneRange();
        setFormat(readFormat());
      });
    };
    const fitObserver = new ResizeObserver(([entry]) => setFit(Math.min(1, (entry.contentRect.width - 8) / A4_WIDTH)));
    fitObserver.observe(canvas.current!);
    window.addEventListener("beforeunload", onUnload);
    document.addEventListener("selectionchange", onSelection);
    return () => {
      if (!hadRail) root.classList.remove("rail");
      window.removeEventListener("beforeunload", onUnload);
      document.removeEventListener("selectionchange", onSelection);
      cancelAnimationFrame(frame);
      fitObserver.disconnect();
      window.clearTimeout(statsTimer.current);
    };
  }, [draft.id]);

  // ------------------------------------------------------------ editing

  const select = (node: Node) => {
    const r = document.createRange();
    r.selectNodeContents(node);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(r);
  };

  /** Put focus and the last selection back in the page (toolbar selects take focus away). */
  const restore = () => {
    const el = page.current!;
    if (document.activeElement === el) return;
    el.focus({ preventScroll: true });
    if (range.current) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range.current);
    }
  };

  const exec = (cmd: string, value?: string) => {
    restore();
    document.execCommand(cmd, false, value);
    changed();
    setFormat(readFormat());
  };

  // Typing over a blank turns it into plain text, keeping the caret where it was
  const settleBlank = () => {
    const sel = window.getSelection();
    const node = sel?.anchorNode;
    const el = node?.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element | null);
    const mark = el?.closest?.("mark.blank");
    if (!sel || !mark || !page.current?.contains(mark)) return;
    const text = mark.textContent ?? "";
    if (/^\[[^\]]*\]$/.test(text)) return;
    const before = document.createRange();
    before.selectNodeContents(mark);
    before.setEnd(sel.anchorNode!, sel.anchorOffset);
    const offset = before.toString().length;
    const plain = document.createTextNode(text);
    mark.replaceWith(plain);
    const caret = document.createRange();
    caret.setStart(plain, Math.min(offset, text.length));
    sel.removeAllRanges();
    sel.addRange(caret);
  };

  const onInput = () => {
    settleBlank();
    changed();
  };

  const onClick = (e: MouseEvent) => {
    const mark = (e.target as HTMLElement).closest("mark.blank");
    if (mark) select(mark); // one click selects the whole blank, so typing replaces it
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      flush();
    } else if (e.key === "Tab") {
      const node = window.getSelection()?.anchorNode;
      const inCell = (node?.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element | null))?.closest("td, th");
      if (inCell) return; // Tab moves between table cells as usual
      e.preventDefault();
      exec(e.shiftKey ? "outdent" : "indent");
    }
  };

  const onPaste = (e: ClipboardEvent) => {
    e.preventDefault();
    const html = e.clipboardData.getData("text/html");
    if (html) document.execCommand("insertHTML", false, cleanHtml(html));
    else document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
    changed();
  };

  const insertBlank = () => {
    restore();
    const label = window.getSelection()?.toString().trim().replace(/^\[|\]$/g, "") || "blank";
    exec("insertHTML", `${blankHtml(label)}&nbsp;`);
  };

  // ------------------------------------------------------------ blanks

  const marks = (match: (m: HTMLElement) => boolean) =>
    [...page.current!.querySelectorAll<HTMLElement>("mark.blank")].filter(match);

  const replace = (list: HTMLElement[], value: (m: HTMLElement) => string | undefined) => {
    let n = 0;
    for (const m of list) {
      const v = value(m);
      if (!v) continue;
      m.replaceWith(document.createTextNode(v));
      n += 1;
    }
    page.current!.normalize();
    if (n) { queue({ html: true }); measure(); }
    return n;
  };

  const values = fieldValues({ ...ctx, today: isoDate() });
  const fromMatter = (b: BlankGroup) => (b.key ? values[b.key as FieldKey] : undefined);
  const fillable = stats.blanks.reduce((n, b) => n + (fromMatter(b) ? b.count : 0), 0);
  const keyed = stats.blanks.reduce((n, b) => n + (b.key ? b.count : 0), 0);
  const blanksLeft = stats.blanks.reduce((n, b) => n + b.count, 0);

  const fillFromMatter = () => {
    const n = replace(marks((m) => !!m.dataset.key), (m) => values[m.dataset.key as FieldKey]);
    flash(`Filled ${n} blank${n === 1 ? "" : "s"} from ${ctx.matter?.case_number || ctx.matter?.title}.`);
  };
  const findBlank = (label: string) => {
    const m = marks((x) => x.textContent === label)[0];
    if (!m) return;
    m.scrollIntoView({ block: "center", behavior: "smooth" });
    page.current!.focus({ preventScroll: true });
    select(m);
  };
  const goHeading = (i: number) => {
    const h = page.current!.querySelectorAll("h1, h2, h3")[i];
    h?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  // ------------------------------------------------------------ file actions

  const rename = (value: string) => {
    setTitle(value);
    queue({ title: value });
  };
  const linkMatter = async (value: string) => {
    queue({ matter_id: value ? Number(value) : null });
    await flush();
    const d = await api.get<DraftDetail>(`/drafts/${draft.id}`);
    setCtx({ matter: d.matter, client: d.client, last: d.last, next: d.next });
  };
  const print = async () => {
    await flush();
    window.print();
  };
  const exportWord = () => download(wordFile(title, page.current!.innerHTML), fileName(title, "doc"));
  const exportText = () => download(new Blob([page.current!.innerText], { type: "text/plain" }), fileName(title, "txt"));
  const copy = async () => {
    await flush();
    const r = await api.post<{ id: number }>(`/drafts/${draft.id}/copy`);
    flash("Copy made. You are editing the copy.");
    navigate(`/drafts/${r.id}`);
  };
  const remove = async () => {
    if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return;
    pending.current = {};
    window.clearTimeout(saveTimer.current);
    const r = await api.post(`/drafts/${draft.id}/delete`);
    flash(r.message ?? "Deleted.");
    navigate("/drafts");
  };

  const scale = zoom === "fit" ? fit : Number(zoom) / 100;
  const [saveIcon, saveText] = SAVE_LABEL[save];

  const tool = (icon: string, label: string, run: () => void, on?: boolean) => (
    <button type="button" className="tb-btn" title={label} aria-label={label} aria-pressed={on}
      onMouseDown={(e) => e.preventDefault()} onClick={run}>
      <Icon name={icon} size={17} />
    </button>
  );

  return (
    <div className="doc-app">
      <header className="doc-head no-print">
        <Link to="/drafts" className="doc-icon" title="All drafts" aria-label="All drafts"><Icon name="file-pen" size={20} /></Link>
        <div className="grow">
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            <input className="doc-title" value={title} onChange={(e) => rename(e.target.value)} aria-label="Document title"
              onBlur={() => !title.trim() && rename("Untitled document")} size={Math.min(Math.max(title.length, 12), 60)} />
            <span className={`doc-save ${save}`} title={save === "error" ? saveError : `Last saved ${niceTime(savedAt)}`} role="status">
              <Icon name={saveIcon} size={15} /> {saveText}
            </span>
          </div>
          <div className="doc-menus">
            <Menu label="File" items={[
              { icon: "plus", label: "New document", run: () => navigate("/drafts") },
              { icon: "copy", label: "Make a copy", run: copy },
              "-",
              { icon: "download", label: "Download Word (.doc)", run: exportWord },
              { icon: "file", label: "Download plain text (.txt)", run: exportText },
              { icon: "printer", label: "Print or save as PDF", hint: "Ctrl+P", run: print },
              "-",
              { icon: "trash", label: "Delete", run: remove, danger: true },
            ]} />
            <Menu label="Insert" items={[
              { icon: "brackets", label: "Blank to fill in", run: insertBlank },
              { icon: "table", label: "Table, 3 × 3", run: () => exec("insertHTML", tableHtml(3, 3)) },
              { icon: "page-break", label: "Page break", run: () => exec("insertHTML", '<hr class="page-break"><p><br></p>') },
              { icon: "calendar", label: "Today's date", run: () => exec("insertText", niceDate(isoDate(), "%-d %B %Y")) },
            ]} />
            <span className="doc-meta">
              {template && template.id !== "blank" && <>{template.name} · </>}
              {ctx.matter && <><Link to={`/matters/${ctx.matter.id}`}>{ctx.matter.case_number || ctx.matter.title}</Link> · </>}
              {stats.words.toLocaleString("en-IN")} words
            </span>
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn ghost sm" onClick={print}><Icon name="printer" size={15} /> Print</button>
          <button className="btn sm" onClick={exportWord}><Icon name="download" size={15} /> Word</button>
          <button className="icon-btn" onClick={() => setPanel((x) => !x)} aria-pressed={panel}
            title={panel ? "Hide side panel" : "Show side panel"} aria-label="Side panel"><Icon name="panel-right" size={18} /></button>
        </div>
      </header>

      <div className="doc-toolbar no-print" role="toolbar" aria-label="Formatting">
        {tool("undo", "Undo (Ctrl+Z)", () => exec("undo"))}
        {tool("redo", "Redo (Ctrl+Y)", () => exec("redo"))}
        {tool("printer", "Print (Ctrl+P)", print)}
        <select className="tb-select zoom" value={zoom} onChange={(e) => setZoom(e.target.value)} aria-label="Zoom">
          {ZOOMS.map((z) => <option key={z} value={z}>{z === "fit" ? "Fit" : `${z}%`}</option>)}
        </select>
        <span className="tb-sep" />
        <select className="tb-select" value={format.block} onChange={(e) => exec("formatBlock", `<${e.target.value}>`)} aria-label="Text style">
          {STYLES.map(([tag, label]) => <option key={tag} value={tag}>{label}</option>)}
        </select>
        <span className="tb-sep" />
        {tool("bold", "Bold (Ctrl+B)", () => exec("bold"), format.bold)}
        {tool("italic", "Italic (Ctrl+I)", () => exec("italic"), format.italic)}
        {tool("underline", "Underline (Ctrl+U)", () => exec("underline"), format.underline)}
        {tool("strike", "Strikethrough", () => exec("strikeThrough"), format.strike)}
        {tool("brackets", "Insert a blank to fill in", insertBlank)}
        <span className="tb-sep" />
        {tool("align-left", "Align left", () => exec("justifyLeft"), format.align === "left")}
        {tool("align-center", "Centre", () => exec("justifyCenter"), format.align === "center")}
        {tool("align-right", "Align right", () => exec("justifyRight"), format.align === "right")}
        {tool("align-justify", "Justify", () => exec("justifyFull"), format.align === "justify")}
        <span className="tb-sep" />
        {tool("list-ordered", "Numbered list", () => exec("insertOrderedList"), format.ol)}
        {tool("list", "Bulleted list", () => exec("insertUnorderedList"), format.ul)}
        {tool("outdent", "Decrease indent (Shift+Tab)", () => exec("outdent"))}
        {tool("indent", "Increase indent (Tab)", () => exec("indent"))}
        <span className="tb-sep" />
        {tool("table", "Insert table", () => exec("insertHTML", tableHtml(3, 3)))}
        {tool("eraser", "Clear formatting", () => exec("removeFormat"))}
      </div>

      <div className={`doc-body${panel ? "" : " wide"}`}>
        <div className="doc-canvas" ref={canvas}>
          <div ref={page} className="doc-page doc-text" contentEditable suppressContentEditableWarning spellCheck
            role="textbox" aria-multiline="true" aria-label={title} style={{ zoom: scale }}
            onInput={onInput} onClick={onClick} onKeyDown={onKeyDown} onPaste={onPaste} />
        </div>

        {panel && (
          <aside className="doc-side no-print">
            <div className="tabs" role="tablist" style={{ display: "flex" }}>
              {([["blanks", `Blanks${blanksLeft ? ` (${blanksLeft})` : ""}`], ["outline", "Outline"], ["details", "Details"]] as const).map(([key, label]) => (
                <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? "on" : ""} style={{ flex: 1 }}
                  onClick={() => setTab(key)}>{label}</button>
              ))}
            </div>

            {tab === "blanks" && (blanksLeft ? (
              <div className="stack" style={{ gap: 14 }}>
                <p className="small muted">Click a blank to find it in the page, or type here to fill every copy of it at once.</p>
                {fillable > 0 && (
                  <button className="btn sm block" onClick={fillFromMatter}>
                    <Icon name="briefcase" size={15} /> Fill {fillable} from {ctx.matter?.case_number || "the matter"}
                  </button>
                )}
                {!ctx.matter && keyed > 0 && (
                  <button className="doc-hint" onClick={() => setTab("details")}>
                    Link a matter to fill {keyed} blank{keyed === 1 ? "" : "s"} automatically →
                  </button>
                )}
                <div className="blank-list">
                  {stats.blanks.map((b) => (
                    <BlankRow key={b.label} blank={b} onFind={() => findBlank(b.label)}
                      onFill={(v) => replace(marks((m) => m.textContent === b.label), () => v)} />
                  ))}
                </div>
              </div>
            ) : (
              <div className="check"><Icon name="check-circle" size={17} /> No blanks left. Ready to print.</div>
            ))}

            {tab === "outline" && (stats.headings.length ? (
              <nav className="outline" aria-label="Document outline">
                {stats.headings.map((h, i) => (
                  <button key={i} className={`lvl-${h.level}`} onClick={() => goHeading(i)}>{h.text}</button>
                ))}
              </nav>
            ) : <p className="small muted">Headings you add with the text style menu appear here.</p>)}

            {tab === "details" && (
              <div className="stack" style={{ gap: 18 }}>
                <label className="field">
                  <span>Matter</span>
                  <select className="input" value={ctx.matter?.id ?? ""} onChange={(e) => linkMatter(e.target.value)}>
                    <option value="">Not linked</option>
                    {detail.matters.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </label>
                {ctx.matter && <Link className="small link" to={`/matters/${ctx.matter.id}`}>Open the matter →</Link>}
                <dl className="kv" style={{ gridTemplateColumns: "84px 1fr", margin: 0 }}>
                  <dt>Template</dt>
                  <dd>{template?.name ?? "—"}{template?.fromFile && <div className="small muted">Made from {template.fromFile}</div>}</dd>
                  <dt>Length</dt><dd>{stats.words.toLocaleString("en-IN")} words, about {stats.pages} page{stats.pages === 1 ? "" : "s"}</dd>
                  <dt>Created</dt><dd>{niceTime(draft.created_at)}</dd>
                  <dt>Saved</dt><dd>{niceTime(savedAt)}</dd>
                </dl>
                <div className="row wrap-row" style={{ gap: 8 }}>
                  <button className="btn ghost sm" onClick={copy}><Icon name="copy" size={14} /> Make a copy</button>
                  <button className="btn quiet sm text-red" onClick={remove}><Icon name="trash" size={14} /> Delete</button>
                </div>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

function BlankRow({ blank, onFind, onFill }: { blank: BlankGroup; onFind: () => void; onFill: (value: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <form className="blank-row" onSubmit={(e) => { e.preventDefault(); if (value.trim()) onFill(value.trim()); }}>
      <button type="button" className="blank-chip" onClick={onFind} title="Show it in the page">
        {blank.label}{blank.count > 1 && <span className="faint"> ×{blank.count}</span>}
      </button>
      <div className="row" style={{ gap: 6 }}>
        <input className="input" value={value} onChange={(e) => setValue(e.target.value)} aria-label={`Fill ${blank.label}`}
          placeholder={blank.count > 1 ? `Fill all ${blank.count}` : "Type to fill"} />
        <button className="btn ghost sm" disabled={!value.trim()}>Fill</button>
      </div>
    </form>
  );
}

type MenuItem = { icon: string; label: string; run: () => void; hint?: string; danger?: boolean } | "-";

/** A small drop-down menu, like a menu-bar entry. Mouse-down keeps the page's selection. */
function Menu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof globalThis.KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button type="button" className="menu-btn" aria-haspopup="menu" aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen((x) => !x)}>{label}</button>
      {open && (
        <div className="menu-pop" role="menu">
          {items.map((item, i) => item === "-" ? <div className="menu-sep" key={i} /> : (
            <button type="button" role="menuitem" key={item.label} className={item.danger ? "text-red" : ""}
              onMouseDown={(e) => e.preventDefault()} onClick={() => { setOpen(false); item.run(); }}>
              <Icon name={item.icon} size={15} /><span className="grow">{item.label}</span>
              {item.hint && <kbd>{item.hint}</kbd>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
