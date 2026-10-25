// Where drafts are kept. Locally and in Docker the server's database holds them.
// On Vercel every function instance has its own short-lived database, so a draft saved on
// one instance could be missing on the next ("That draft doesn't exist"). There, drafts are
// kept in this browser instead, and the server only fills in new ones from their template.

import { useCallback, useEffect, useState } from "react";
import { isoDate, isoDateTime } from "../../shared/format";
import type { TemplateContext } from "../../shared/templates";
import { countBlanks, countWords } from "../../shared/templates";
import type { DraftDetail, DraftRow, DraftWithMatter, MatterDetail, MatterRow, Meta } from "../../shared/types";
import { api } from "./api";

export type DraftChange = { title: string; html: string; matter_id: number | null };

/** A save that failed. Network trouble and server errors (5xx) are worth retrying. */
export class SaveError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface DraftStore {
  inBrowser: boolean;
  list(matterId?: number): Promise<DraftRow[]>;
  create(templateId: string, matterId: number | null): Promise<number>;
  get(id: number): Promise<DraftDetail>;
  save(id: number, change: DraftChange): Promise<string>; // the new updated_at
  /** Last-chance save while the tab closes. False when it can't, so the browser should warn. */
  saveOnUnload(id: number, change: DraftChange): boolean;
  copy(id: number, current?: { title: string; html: string }): Promise<number>;
  remove(id: number): Promise<string>;
}

/** The matter, client and hearings that fill a draft's blanks. */
export async function matterContext(matterId: number | null): Promise<Omit<TemplateContext, "today">> {
  const none = { matter: null, client: null, last: null, next: null };
  const d = matterId ? await api.get<MatterDetail>(`/matters/${matterId}`).catch(() => null) : null;
  if (!d) return none;
  const today = isoDate();
  return {
    matter: d.matter,
    client: d.client,
    next: [...d.hearings].reverse().find((h) => h.date >= today) ?? null, // hearings come newest first
    last: d.hearings.find((h) => h.date < today && h.outcome) ?? null,
  };
}

const matterLabel = (m: { case_number: string; title: string }) => (m.case_number ? `${m.case_number} · ${m.title}` : m.title);

// ------------------------------------------------------------ the server's database

const serverStore: DraftStore = {
  inBrowser: false,
  list: (matterId) => api.get<DraftRow[]>(matterId ? `/drafts?matter=${matterId}` : "/drafts"),
  create: async (templateId, matterId) => (await api.post<{ id: number }>("/drafts", { template_id: templateId, matter_id: matterId })).id,
  get: (id) => api.get<DraftDetail>(`/drafts/${id}`),
  // Autosave skips api.post, which would make the sidebar reload its counts after every pause in typing
  async save(id, change) {
    const res = await fetch(`/api/drafts/${id}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change),
    }).catch(() => { throw new SaveError(0, "Can't reach the server. Trying again in a few seconds."); });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new SaveError(res.status, out.error ?? `Save failed (${res.status})`);
    return out.updated_at;
  },
  saveOnUnload(id, change) {
    const body = JSON.stringify(change);
    if (body.length > 60_000) return false; // too big for a request that outlives the page
    fetch(`/api/drafts/${id}`, { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body });
    return true;
  },
  copy: async (id) => (await api.post<{ id: number }>(`/drafts/${id}/copy`)).id,
  remove: async (id) => (await api.post(`/drafts/${id}/delete`)).message ?? "Deleted.",
};

// ------------------------------------------------------------ this browser (Vercel)

const KEY = "lex-drafts";
type Kept = Record<string, DraftWithMatter>;

const readAll = (): Kept => {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}") as Kept; } catch { return {}; }
};
function writeAll(all: Kept) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    throw new SaveError(507, "This browser has no room left for drafts. Delete some old drafts to keep saving.");
  }
}
const toRow = ({ html: _html, ...row }: DraftWithMatter): DraftRow => row;
const nextId = (all: Kept) => Math.max(0, ...Object.keys(all).map(Number)) + 1;
const missing = () => new Error("That draft isn't in this browser. On this site, drafts are kept in the browser they were written in.");

// The server's demo drafts, copied in the first time this browser opens Drafts
let seeding: Promise<void> | null = null;
function copyDemoDrafts() {
  seeding ??= (async () => {
    try { if (localStorage.getItem(`${KEY}-seeded`)) return; } catch { return; }
    const all = readAll();
    for (const row of await api.get<DraftRow[]>("/drafts").catch(() => [])) {
      const d = all[row.id] ? null : await api.get<DraftDetail>(`/drafts/${row.id}`).catch(() => null);
      if (d) all[row.id] = { ...row, html: d.draft.html };
    }
    try {
      writeAll(all);
      localStorage.setItem(`${KEY}-seeded`, "1");
    } catch { /* storage blocked: drafts still work for this visit */ }
  })();
  return seeding;
}

const browserStore: DraftStore = {
  inBrowser: true,
  async list(matterId) {
    await copyDemoDrafts();
    return Object.values(readAll())
      .filter((d) => !matterId || d.matter_id === matterId)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map(toRow);
  },
  async create(templateId, matterId) {
    await copyDemoDrafts();
    // The server fills the template from the matter; the result is kept here
    const { draft } = await api.post<{ draft: DraftWithMatter }>("/drafts", { template_id: templateId, matter_id: matterId });
    const all = readAll();
    const id = nextId(all);
    all[id] = { ...draft, id };
    writeAll(all);
    return id;
  },
  async get(id) {
    await copyDemoDrafts();
    const draft = readAll()[id];
    if (!draft) throw missing();
    const [ctx, options] = await Promise.all([
      matterContext(draft.matter_id),
      api.get<{ matters: MatterRow[] }>("/upload-options").catch(() => ({ matters: [] as MatterRow[] })),
    ]);
    return { draft, ...ctx, matters: options.matters.map((m) => ({ id: m.id, label: matterLabel(m) })) };
  },
  async save(id, change) {
    const before = readAll()[id];
    if (!before) throw new SaveError(404, "This draft was deleted.");
    const ctx = change.matter_id !== before.matter_id ? await matterContext(change.matter_id) : null;
    const all = readAll();
    const updated_at = isoDateTime();
    all[id] = {
      ...before, ...change, updated_at, words: countWords(change.html), blanks: countBlanks(change.html),
      ...(ctx && { case_number: ctx.matter?.case_number ?? null, matter_title: ctx.matter?.title ?? null, client_name: ctx.client?.name ?? null }),
    };
    writeAll(all);
    return updated_at;
  },
  saveOnUnload(id, change) {
    const all = readAll();
    if (!all[id]) return true;
    all[id] = { ...all[id], ...change, updated_at: isoDateTime(), words: countWords(change.html), blanks: countBlanks(change.html) };
    try { writeAll(all); return true; } catch { return false; }
  },
  async copy(id, current) {
    const all = readAll();
    if (!all[id]) throw missing();
    const newId = nextId(all);
    const now = isoDateTime();
    const from = { ...all[id], ...current };
    all[newId] = { ...from, id: newId, title: `Copy of ${from.title}`, created_at: now, updated_at: now };
    writeAll(all);
    return newId;
  },
  async remove(id) {
    const all = readAll();
    const title = all[id]?.title;
    delete all[id];
    writeAll(all);
    return title ? `Deleted "${title}".` : "Deleted.";
  },
};

// ------------------------------------------------------------ picking one

let chosen: Promise<DraftStore> | null = null;

/** The store for this deployment, decided once from /api/meta. */
export function draftStore(): Promise<DraftStore> {
  chosen ??= api.get<Meta>("/meta")
    .then((m) => (m.drafts_in_browser ? browserStore : serverStore))
    .catch(() => {
      chosen = null; // ask again next time
      return serverStore;
    });
  return chosen;
}

/** Drafts for a page, newest first; with `matterId`, only that matter's. */
export function useDrafts(matterId?: number) {
  const [drafts, setDrafts] = useState<DraftRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inBrowser, setInBrowser] = useState(false);
  const reload = useCallback(() => {
    draftStore()
      .then((store) => { setInBrowser(store.inBrowser); return store.list(matterId); })
      .then((rows) => { setDrafts(rows); setError(null); }, (err: Error) => setError(err.message));
  }, [matterId]);
  useEffect(reload, [reload]);
  return { drafts, error, reload, inBrowser };
}
