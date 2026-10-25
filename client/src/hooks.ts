import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

/** Load JSON from the API. Keeps the last data while reloading so pages don't flicker. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path) return;
    let live = true;
    api.get<T>(path)
      .then((d) => { if (live) { setData(d); setError(null); } })
      .catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, reload };
}

export function useTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · LEX AI` : "LEX AI";
  }, [title]);
}
