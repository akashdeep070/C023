import { Fragment, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import type { Meta } from "../../../shared/types";
import { CHANGED, api, browserGroqKey } from "../api";
import { FlashOutlet } from "./Flash";
import { Icon } from "./Icon";

type NavItem = { to: string; label: string; icon: string; count?: keyof Meta["counts"]; tone?: "amber" | "red" };
const NAV: { group: string; items: NavItem[] }[] = [
  { group: "Workspace", items: [
    { to: "/", label: "Overview", icon: "grid" },
    { to: "/drafts", label: "Drafts", icon: "file-pen" },
    { to: "/diary", label: "Diary", icon: "calendar", count: "today" },
    { to: "/matters", label: "Matters", icon: "briefcase", count: "matters" },
    { to: "/deadlines", label: "Deadlines", icon: "hourglass", count: "overdue", tone: "red" },
    { to: "/documents", label: "Documents", icon: "file", count: "documents" },
    { to: "/clients", label: "Clients", icon: "users", count: "clients" },
  ] },
  { group: "Finance", items: [{ to: "/billing", label: "Billing", icon: "receipt", count: "invoices_due", tone: "amber" }] },
  { group: "System", items: [
    { to: "/activity", label: "Audit log", icon: "history" },
    { to: "/status", label: "Status & SLA", icon: "activity" },
  ] },
];

const CRUMBS: [RegExp, string][] = [
  [/^\/$/, "Overview"], [/^\/upload/, "Upload"], [/^\/documents\/\d+/, "Document"], [/^\/documents/, "Documents"],
  [/^\/drafts\/\d+/, "Draft"], [/^\/drafts/, "Drafts"],
  [/^\/diary/, "Diary"], [/^\/matters\/\d+/, "Matter"], [/^\/matters/, "Matters"], [/^\/deadlines/, "Deadlines"],
  [/^\/clients\/\d+/, "Client"], [/^\/clients/, "Clients"], [/^\/billing\/new/, "New invoice"],
  [/^\/billing\/\d+/, "Invoice"], [/^\/billing/, "Billing"], [/^\/activity/, "Audit log"], [/^\/status/, "Status & SLA"],
];

// Pulse color, label and note for the AI engine in the sidebar (no note: show the model)
const AI_STATE = {
  ok: ["green", "Groq connected", ""], ready: ["green", "Groq ready", ""], browser: ["green", "Groq ready", "key in this browser"],
  error: ["red", "Groq not working", "open Status to fix"], local: ["amber", "Local reader", "add a Groq key"],
} as const;

const isMobile = () => window.matchMedia("(max-width: 900px)").matches;

export function Layout() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const search = useRef<HTMLInputElement>(null);

  // Counts in the sidebar refresh on every page change and after every edit
  useEffect(() => {
    const load = () => api.get<Meta>("/meta").then(setMeta).catch(() => {});
    load();
    window.addEventListener(CHANGED, load);
    return () => window.removeEventListener(CHANGED, load);
  }, [location.pathname]);

  useEffect(() => {
    document.documentElement.classList.remove("drawer");
    window.scrollTo(0, 0);
  }, [location.pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") document.documentElement.classList.remove("drawer");
      const tag = (document.activeElement as HTMLElement | null)?.tagName ?? "";
      if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(tag)) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const toggleMenu = () => {
    const root = document.documentElement;
    if (isMobile()) {
      root.classList.toggle("drawer");
      return;
    }
    root.classList.toggle("rail");
    try { localStorage.setItem("lex-rail", root.classList.contains("rail") ? "1" : "0"); } catch { /* private mode */ }
  };

  const onSearch = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const q = search.current?.value.trim() ?? "";
    navigate(q ? `/documents?q=${encodeURIComponent(q)}` : "/documents");
  };

  const crumb = CRUMBS.find(([rx]) => rx.test(location.pathname))?.[1] ?? "LEX AI";
  const ai = meta?.ai;
  // A key pasted in this browser is used before the server's
  const aiState = browserGroqKey.get() ? "browser" : !ai?.enabled ? "local" : !ai.health ? "ready" : ai.health.ok ? "ok" : "error";
  const counts = meta?.counts;
  const instance = meta?.instance ?? "…";

  return (
    <div className="shell">
      <aside className="side" id="side" aria-label="Main menu">
        <div className="side-top">
          <Link className="brand" to="/">
            <span className="mark"><Icon name="logo" size={18} stroke={1.8} /></span>
            <span className="brand-text"><b>LEX AI</b></span>
          </Link>
        </div>

        <Link className="btn block side-cta" to="/upload" title="Upload">
          <Icon name="upload" size={16} /><span className="side-label">Upload file</span>
        </Link>

        <nav className="side-nav">
          {NAV.map(({ group, items }) => (
            <Fragment key={group}>
              <div className="side-group">{group}</div>
              {items.map((item) => {
                const n = item.count && counts ? counts[item.count] : 0;
                return (
                  <NavLink key={item.to} to={item.to} end={item.to === "/"} title={item.label}
                    className={({ isActive }) => `side-link${isActive ? " on" : ""}`}>
                    <Icon name={item.icon} size={18} />
                    <span className="side-label">{item.label}</span>
                    {n ? <span className={`side-count ${item.tone ?? ""}`}>{n}</span> : null}
                  </NavLink>
                );
              })}
            </Fragment>
          ))}
        </nav>

        <div className="side-foot">
          <Link className="engine" to="/status#groq" title={ai?.health?.error || "AI status"}>
            <span className={`pulse ${AI_STATE[aiState][0]}`} />
            <div className="side-label">
              <div className="small" style={{ fontWeight: 500 }}>{AI_STATE[aiState][1]}</div>
              <div className="mono faint" style={{ fontSize: 11 }}>
                {AI_STATE[aiState][2] || ai?.model.split("/").pop()}
              </div>
            </div>
          </Link>
          <div className="me">
            <span className="avatar">RM</span>
            <div className="side-label">
              <div className="small" style={{ fontWeight: 500 }}>Adv. R. Mehta</div>
              <div className="small faint">Lawyer · Admin</div>
            </div>
          </div>
        </div>
      </aside>
      <div className="scrim" onClick={() => document.documentElement.classList.remove("drawer")} />

      <div className="main">
        <header className="bar">
          <button className="icon-btn" type="button" onClick={toggleMenu} aria-label="Toggle menu" aria-controls="side">
            <Icon name="menu" size={20} />
          </button>
          <div className="bar-title"><span className="faint">LEX AI</span><span className="faint">/</span><b>{crumb}</b></div>
          <form className="bar-search" role="search" onSubmit={onSearch}>
            <Icon name="search" size={16} />
            <input ref={search} name="q" placeholder="Search files, cases, parties…" aria-label="Search documents" />
            <kbd>/</kbd>
          </form>
          <div className="bar-right">
            <Link className="pill" to="/status" title="Instance that served the API"><span className="pulse on" />{instance}</Link>
            <Link className="icon-btn" to="/" aria-label="Things that need attention"
              title={`${counts?.alerts ?? 0} item${counts?.alerts === 1 ? "" : "s"} need attention`}>
              <Icon name="bell" size={18} />
              {counts?.alerts ? <span className="dot-count">{counts.alerts}</span> : null}
            </Link>
            <span className="avatar sm">RM</span>
          </div>
        </header>

        <main className="page">
          <div className="wrap">
            <FlashOutlet />
            <Outlet />
          </div>
        </main>

        <footer className="foot">
          <div className="wrap">
            <span className="label">LEX AI · Sample data</span>
            <span className="label">Served by {instance}</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
