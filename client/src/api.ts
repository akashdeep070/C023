// Tiny fetch wrapper. Any change to data tells the layout to refresh its counts.

export class ApiError extends Error {}

export const CHANGED = "lex:changed";

const GROQ_KEY = "lex-groq-key";

/** A Groq API key pasted in this browser. It is sent with requests that may use the AI, never stored on the server. */
export const browserGroqKey = {
  get(): string {
    try { return localStorage.getItem(GROQ_KEY) ?? ""; } catch { return ""; }
  },
  set(key: string | null) {
    try {
      if (key) localStorage.setItem(GROQ_KEY, key);
      else localStorage.removeItem(GROQ_KEY);
    } catch { /* storage blocked: the key lasts until the page closes at most */ }
    window.dispatchEvent(new Event(CHANGED));
  },
};

async function request<T>(path: string, init: RequestInit = {}, groqKey = browserGroqKey.get()): Promise<T> {
  // Only requests that change something can call the AI (upload, re-read, ask, test)
  if (groqKey && init.method && init.method !== "GET") {
    init = { ...init, headers: { ...(init.headers as Record<string, string>), "X-Groq-Key": groqKey } };
  }
  const res = await fetch(`/api${path}`, init);
  const body = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) throw new ApiError(body?.error ?? `Request failed (${res.status})`);
  if (init.method && init.method !== "GET") window.dispatchEvent(new Event(CHANGED));
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  /** `groqKey` tries a key that isn't saved yet. */
  post: <T = { message?: string; kind?: "ok" | "error" }>(path: string, data?: unknown, groqKey?: string) =>
    request<T>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data ?? {}),
    }, groqKey),
  upload: <T = { id?: number; message?: string }>(path: string, form: FormData) =>
    request<T>(path, { method: "POST", body: form }),
};
