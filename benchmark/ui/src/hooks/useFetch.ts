import { useCallback, useEffect, useRef, useState } from "react";

// Hand-rolled data hook per p2-ui-architecture.md §3 + §4 — no fetching
// library. Returns the canonical { data, error, status, refetch } shape.
//
// `null` url is the "loading-without-fetching" escape hatch; useful when a
// required URL parameter (e.g. :run_id) is not yet known. The hook returns
// status: "idle" until the URL becomes a string.
//
// AbortController cancels in-flight requests on unmount or url change so a
// stale response cannot win a race against a fresh one.

export type FetchStatus = "idle" | "loading" | "success" | "error";

export interface UseFetchResult<T> {
  data: T | undefined;
  error: Error | undefined;
  status: FetchStatus;
  refetch: () => void;
}

export function useFetch<T>(url: string | null): UseFetchResult<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [status, setStatus] = useState<FetchStatus>(url ? "loading" : "idle");
  const [tick, setTick] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!url) {
      setStatus("idle");
      setData(undefined);
      setError(undefined);
      return;
    }

    const ac = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ac;
    setStatus("loading");
    setError(undefined);

    fetch(url, { signal: ac.signal, headers: { accept: "application/json" } })
      .then(async (res) => {
        if (!res.ok) {
          let detail = "";
          try {
            const body = await res.json();
            detail =
              typeof body?.error === "string"
                ? `: ${body.error}`
                : `: ${JSON.stringify(body)}`;
          } catch {
            // body wasn't JSON; fall through with empty detail.
          }
          throw new Error(`HTTP ${res.status} ${res.statusText}${detail}`);
        }
        return (await res.json()) as T;
      })
      .then((parsed) => {
        if (ac.signal.aborted) return;
        setData(parsed);
        setStatus("success");
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        setStatus("error");
      });

    return () => {
      ac.abort();
    };
  }, [url, tick]);

  const refetch = useCallback(() => setTick((n) => n + 1), []);

  return { data, error, status, refetch };
}

// Sibling for text-bodied endpoints (artifact pass-through, etc.).
export function useFetchText(url: string | null): UseFetchResult<string> {
  const [data, setData] = useState<string | undefined>(undefined);
  const [error, setError] = useState<Error | undefined>(undefined);
  const [status, setStatus] = useState<FetchStatus>(url ? "loading" : "idle");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!url) {
      setStatus("idle");
      setData(undefined);
      setError(undefined);
      return;
    }
    const ac = new AbortController();
    setStatus("loading");
    setError(undefined);

    fetch(url, { signal: ac.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        return await res.text();
      })
      .then((text) => {
        if (ac.signal.aborted) return;
        setData(text);
        setStatus("success");
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        setStatus("error");
      });

    return () => ac.abort();
  }, [url, tick]);

  const refetch = useCallback(() => setTick((n) => n + 1), []);
  return { data, error, status, refetch };
}
