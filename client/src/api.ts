// Tiny fetch wrapper. Any change to data tells the layout to refresh its counts.

export class ApiError extends Error {}

export const CHANGED = "lex:changed";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, init);
  const body = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  if (!res.ok) throw new ApiError(body?.error ?? `Request failed (${res.status})`);
  if (init.method && init.method !== "GET") window.dispatchEvent(new Event(CHANGED));
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T = { message?: string; kind?: "ok" | "error" }>(path: string, data?: unknown) =>
    request<T>(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data ?? {}),
    }),
  upload: <T = { id?: number; message?: string }>(path: string, form: FormData) =>
    request<T>(path, { method: "POST", body: form }),
};
